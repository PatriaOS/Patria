-- MEM01 slice 2: videos, library connections, owner-only HMAC keys, tombstones (D31).

CREATE TYPE public.memory_item_kind AS ENUM ('photo', 'video');
CREATE TYPE public.memory_item_source AS ENUM ('picker', 'library_sync');
CREATE TYPE public.memory_library_mode AS ENUM ('all_new', 'selected_albums');

ALTER TABLE public.memory_items
  ADD COLUMN kind public.memory_item_kind NOT NULL DEFAULT 'photo',
  ADD COLUMN duration_seconds integer,
  ADD COLUMN source public.memory_item_source NOT NULL DEFAULT 'picker',
  ADD COLUMN source_hash text,
  ADD COLUMN added_automatically boolean NOT NULL DEFAULT false;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_photo_duration CHECK (
    kind <> 'photo' OR duration_seconds IS NULL
  ),
  ADD CONSTRAINT memory_items_video_duration CHECK (
    kind <> 'video' OR (duration_seconds IS NOT NULL AND duration_seconds > 0 AND duration_seconds <= 60)
  );

CREATE UNIQUE INDEX memory_items_source_hash_unique
  ON public.memory_items (uploader_id, family_space_id, source_hash)
  WHERE source_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.memory_fill_paths()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  full_name text;
BEGIN
  full_name := CASE WHEN NEW.kind = 'video' THEN 'full.mp4' ELSE 'full.jpg' END;
  NEW.full_path := NEW.family_space_id::text || '/' || NEW.id::text || '/' || full_name;
  NEW.thumb_path := NEW.family_space_id::text || '/' || NEW.id::text || '/thumb.jpg';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.memory_object_parts(object_name text)
RETURNS TABLE (family_space_id uuid, item_id uuid, file_name text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  parts text[];
BEGIN
  parts := string_to_array(object_name, '/');
  IF array_length(parts, 1) IS DISTINCT FROM 3 THEN
    RETURN;
  END IF;
  IF parts[3] IS NULL OR parts[3] NOT IN ('full.jpg', 'full.mp4', 'full.mov', 'thumb.jpg') THEN
    RETURN;
  END IF;
  BEGIN
    family_space_id := parts[1]::uuid;
    item_id := parts[2]::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN;
  END;
  file_name := parts[3];
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_memory_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memory_object_parts(object_name) AS p
    JOIN public.memory_items AS m ON m.id = p.item_id
    WHERE m.family_space_id = p.family_space_id
      AND (
        (p.file_name IN ('full.jpg', 'full.mp4', 'full.mov') AND m.full_path = object_name)
        OR (p.file_name = 'thumb.jpg' AND m.thumb_path = object_name)
      )
      AND public.can_view_memory(m.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_memory_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memory_object_parts(object_name) AS p
    JOIN public.memory_items AS m ON m.id = p.item_id
    WHERE m.family_space_id = p.family_space_id
      AND m.uploader_id = auth.uid()
      AND (
        (p.file_name IN ('full.jpg', 'full.mp4', 'full.mov') AND m.full_path = object_name)
        OR (p.file_name = 'thumb.jpg' AND m.thumb_path = object_name)
      )
      AND public.is_memory_role(m.family_space_id, auth.uid())
  );
$$;

CREATE TABLE public.memory_source_keys (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  secret bytea NOT NULL CHECK (octet_length(secret) = 32),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memory_source_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_source_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_source_keys_owner ON public.memory_source_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.memory_item_tombstones (
  uploader_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uploader_id, family_space_id, source_hash)
);

ALTER TABLE public.memory_item_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_item_tombstones FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_item_tombstones_owner ON public.memory_item_tombstones
  FOR ALL TO authenticated
  USING (uploader_id = auth.uid())
  WITH CHECK (uploader_id = auth.uid());

CREATE OR REPLACE FUNCTION public.trg_memory_items_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.added_automatically
     AND OLD.source_hash IS NOT NULL
  THEN
    INSERT INTO public.memory_item_tombstones (uploader_id, family_space_id, source_hash)
    VALUES (OLD.uploader_id, OLD.family_space_id, OLD.source_hash)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER memory_items_tombstone
  AFTER DELETE ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_memory_items_tombstone();

CREATE OR REPLACE FUNCTION public.trg_memory_items_clear_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'picker' AND NEW.source_hash IS NOT NULL THEN
    DELETE FROM public.memory_item_tombstones
    WHERE uploader_id = NEW.uploader_id
      AND family_space_id = NEW.family_space_id
      AND source_hash = NEW.source_hash;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_items_clear_tombstone
  AFTER INSERT ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_memory_items_clear_tombstone();

CREATE TABLE public.memory_library_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  mode public.memory_library_mode NOT NULL,
  circle_id uuid NOT NULL REFERENCES public.circles (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  allow_cellular boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  needs_circle boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, family_space_id, device_id)
);

ALTER TABLE public.memory_library_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_library_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_library_connections_owner ON public.memory_library_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_memory_role(family_space_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.circles AS c
      WHERE c.id = circle_id AND c.family_space_id = memory_library_connections.family_space_id
    )
  );

CREATE OR REPLACE FUNCTION public.trg_space_members_drop_library_connections()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.memory_library_connections
  WHERE family_space_id = OLD.family_space_id
    AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER space_members_drop_library_connections
  AFTER DELETE ON public.space_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_space_members_drop_library_connections();

UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'video/mp4', 'video/quicktime']::text[]
WHERE id = 'memories';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_source_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_item_tombstones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_library_connections TO authenticated;

REVOKE ALL ON FUNCTION public.trg_memory_items_tombstone() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_memory_items_clear_tombstone() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_space_members_drop_library_connections() FROM PUBLIC;
