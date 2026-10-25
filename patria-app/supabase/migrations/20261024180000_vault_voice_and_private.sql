-- LEG01 slice 2 (D34): voice notes and Only me entries.

ALTER TABLE public.vault_entries
  DROP CONSTRAINT IF EXISTS vault_entries_key_epoch_check;

ALTER TABLE public.vault_entries
  ALTER COLUMN key_epoch DROP NOT NULL;

ALTER TABLE public.vault_entries
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'family';

ALTER TABLE public.vault_entries
  DROP CONSTRAINT IF EXISTS vault_entries_visibility_check;

ALTER TABLE public.vault_entries
  ADD CONSTRAINT vault_entries_visibility_check
  CHECK (visibility IN ('family', 'private'));

ALTER TABLE public.vault_entries
  DROP CONSTRAINT IF EXISTS vault_entries_epoch_visibility_check;

ALTER TABLE public.vault_entries
  ADD CONSTRAINT vault_entries_epoch_visibility_check
  CHECK (
    (visibility = 'family' AND key_epoch IS NOT NULL AND key_epoch >= 1)
    OR (visibility = 'private' AND key_epoch IS NULL)
  );

CREATE TABLE public.personal_key_wraps (
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  wrapped_key bytea NOT NULL CHECK (octet_length(wrapped_key) >= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_space_id, user_id, device_id)
);

CREATE TABLE public.personal_key_under_recovery (
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  wrapped_key bytea NOT NULL CHECK (octet_length(wrapped_key) >= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_space_id, user_id)
);

ALTER TABLE public.personal_key_wraps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_key_wraps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.personal_key_under_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_key_under_recovery FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vault_writer_ready(_space_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_key_eligible_member(_space_id, _user_id)
    AND EXISTS (
      SELECT 1
      FROM public.space_members AS m
      WHERE m.family_space_id = _space_id
        AND m.user_id = _user_id
        AND public.is_vault_writer_role(m.role)
    )
    AND public.has_current_family_key_wrap(_space_id, _user_id)
    AND public.has_recovery_setup(_space_id, _user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_read_vault_entry(_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vault_entries AS v
    WHERE v.id = _entry_id
      AND (
        (
          v.visibility = 'family'
          AND public.is_key_eligible_member(v.family_space_id, auth.uid())
        )
        OR (
          v.visibility = 'private'
          AND v.author_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM public.space_members AS m
            WHERE m.family_space_id = v.family_space_id
              AND m.user_id = auth.uid()
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.approved_personal_devices(_space_id uuid, _user_id uuid)
RETURNS TABLE (device_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.device_id
  FROM public.family_key_wraps AS w
  JOIN public.family_key_meta AS m
    ON m.family_space_id = w.family_space_id
   AND m.key_epoch = w.key_epoch
  JOIN public.device_keys AS d
    ON d.user_id = w.user_id
   AND d.device_id = w.device_id
   AND d.rejected_at IS NULL
  WHERE w.family_space_id = _space_id
    AND w.user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.create_personal_key(
  p_space_id uuid,
  p_device_ids uuid[],
  p_wrapped_keys bytea[],
  p_sealed_key bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  i integer;
BEGIN
  IF me IS NULL OR NOT public.vault_writer_ready(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_device_ids) IS DISTINCT FROM cardinality(p_wrapped_keys)
     OR cardinality(p_device_ids) IS NULL
     OR cardinality(p_device_ids) = 0
     OR octet_length(p_sealed_key) < 64 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_wrapped_keys) AS offered(wrapped)
    WHERE octet_length(offered.wrapped) < 64
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.personal_key_under_recovery
    WHERE family_space_id = p_space_id AND user_id = me
  ) OR EXISTS (
    SELECT 1
    FROM public.personal_key_wraps
    WHERE family_space_id = p_space_id AND user_id = me
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF (
    SELECT count(*) FROM unnest(p_device_ids) AS offered(id)
  ) IS DISTINCT FROM (
    SELECT count(DISTINCT id) FROM unnest(p_device_ids) AS offered(id)
  ) OR EXISTS (
    SELECT device_id FROM public.approved_personal_devices(p_space_id, me)
    EXCEPT
    SELECT id FROM unnest(p_device_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM unnest(p_device_ids) AS offered(id)
    EXCEPT
    SELECT device_id FROM public.approved_personal_devices(p_space_id, me)
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.personal_key_under_recovery (family_space_id, user_id, wrapped_key)
  VALUES (p_space_id, me, p_sealed_key);

  FOR i IN 1..cardinality(p_device_ids) LOOP
    INSERT INTO public.personal_key_wraps (
      family_space_id, user_id, device_id, wrapped_key
    ) VALUES (
      p_space_id, me, p_device_ids[i], p_wrapped_keys[i]
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_recovery_public_key(
  p_space_id uuid,
  p_public_key bytea,
  p_recovery_key_epoch integer,
  p_personal_seal bytea DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  has_personal boolean;
BEGIN
  IF me IS NULL OR NOT public.is_key_eligible_member(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_public_key) IS DISTINCT FROM 32 OR p_recovery_key_epoch < 1 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.personal_key_under_recovery
    WHERE family_space_id = p_space_id AND user_id = me
  ) INTO has_personal;
  IF has_personal AND (p_personal_seal IS NULL OR octet_length(p_personal_seal) < 64) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.recovery_public_keys (
    family_space_id, user_id, public_key, recovery_key_epoch
  ) VALUES (
    p_space_id, me, p_public_key, p_recovery_key_epoch
  )
  ON CONFLICT (family_space_id, user_id) DO UPDATE
  SET public_key = excluded.public_key,
      recovery_key_epoch = excluded.recovery_key_epoch,
      created_at = now();

  IF has_personal THEN
    UPDATE public.personal_key_under_recovery
    SET wrapped_key = p_personal_seal
    WHERE family_space_id = p_space_id AND user_id = me;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_vault_visibility_switch(
  p_parent_id uuid,
  p_visibility text,
  p_parent_expected_version integer,
  p_parent_key_epoch integer,
  p_parent_content_nonce bytea,
  p_parent_ciphertext bytea,
  p_parent_cek_nonce bytea,
  p_parent_wrapped_cek bytea,
  p_child_ids uuid[],
  p_child_expected_versions integer[],
  p_child_key_epochs integer[],
  p_child_content_nonces bytea[],
  p_child_ciphertexts bytea[],
  p_child_cek_nonces bytea[],
  p_child_wrapped_ceks bytea[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  parent public.vault_entries;
  i integer;
BEGIN
  IF me IS NULL OR p_visibility NOT IN ('family', 'private') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO parent FROM public.vault_entries WHERE id = p_parent_id FOR UPDATE;
  IF parent.id IS NULL OR parent.author_id IS DISTINCT FROM me OR parent.parent_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF parent.version IS DISTINCT FROM p_parent_expected_version THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_expected_versions)
     OR cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_key_epochs)
     OR cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_content_nonces)
     OR cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_ciphertexts)
     OR cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_cek_nonces)
     OR cardinality(p_child_ids) IS DISTINCT FROM cardinality(p_child_wrapped_ceks) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT id FROM public.vault_entries
    WHERE parent_entry_id = p_parent_id
    EXCEPT
    SELECT id FROM unnest(p_child_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM unnest(p_child_ids) AS offered(id)
    EXCEPT
    SELECT id FROM public.vault_entries
    WHERE parent_entry_id = p_parent_id
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_visibility = 'family' THEN
    IF p_parent_key_epoch IS DISTINCT FROM public.current_family_key_epoch(parent.family_space_id) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  ELSIF p_parent_key_epoch IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('patria.vault_switch', '1', true);

  UPDATE public.vault_entries
  SET visibility = p_visibility,
      version = p_parent_expected_version + 1,
      key_epoch = p_parent_key_epoch,
      content_nonce = p_parent_content_nonce,
      ciphertext = p_parent_ciphertext,
      cek_nonce = p_parent_cek_nonce,
      wrapped_cek = p_parent_wrapped_cek
  WHERE id = p_parent_id;

  FOR i IN 1..COALESCE(cardinality(p_child_ids), 0) LOOP
    UPDATE public.vault_entries
    SET visibility = p_visibility,
        version = p_child_expected_versions[i] + 1,
        key_epoch = p_child_key_epochs[i],
        content_nonce = p_child_content_nonces[i],
        ciphertext = p_child_ciphertexts[i],
        cek_nonce = p_child_cek_nonces[i],
        wrapped_cek = p_child_wrapped_ceks[i]
    WHERE id = p_child_ids[i]
      AND author_id = me
      AND parent_entry_id = p_parent_id
      AND version = p_child_expected_versions[i];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  PERFORM set_config('patria.vault_switch', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_object_parts(object_name text)
RETURNS TABLE (family_space_id uuid, entry_id uuid, audio_id uuid)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    split_part(object_name, '/', 1)::uuid,
    split_part(object_name, '/', 2)::uuid,
    split_part(object_name, '/', 3)::uuid
  WHERE object_name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$';
$$;

CREATE OR REPLACE FUNCTION public.can_upload_vault_object(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts record;
  entry public.vault_entries;
BEGIN
  SELECT * INTO parts FROM public.vault_object_parts(object_name);
  IF parts.family_space_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.vault_writer_ready(parts.family_space_id, auth.uid()) THEN
    RETURN false;
  END IF;
  SELECT * INTO entry FROM public.vault_entries WHERE id = parts.entry_id;
  IF entry.id IS NULL THEN
    RETURN true;
  END IF;
  RETURN entry.family_space_id = parts.family_space_id AND entry.author_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_vault_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vault_object_parts(object_name) AS p
    JOIN public.vault_entries AS v ON v.id = p.entry_id
    WHERE v.family_space_id = p.family_space_id
      AND public.can_read_vault_entry(v.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_vault_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vault_object_parts(object_name) AS p
    JOIN public.vault_entries AS v ON v.id = p.entry_id
    WHERE v.family_space_id = p.family_space_id
      AND v.author_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_vault_objects()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects AS o
  WHERE o.bucket_id = 'vault'
    AND o.created_at < now() - interval '1 hour'
    AND EXISTS (
      SELECT 1
      FROM public.vault_object_parts(o.name) AS p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.vault_entries AS v WHERE v.id = p.entry_id
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_vault_objects_for_entries(p_entry_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) = 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects AS o
  WHERE o.bucket_id = 'vault'
    AND EXISTS (
      SELECT 1
      FROM public.vault_object_parts(o.name) AS p
      WHERE p.entry_id = ANY (p_entry_ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_vault_entries_delete_objects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.delete_vault_objects_for_entries(ARRAY[OLD.id]);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS vault_entries_delete_objects ON public.vault_entries;
CREATE TRIGGER vault_entries_delete_objects
  AFTER DELETE ON public.vault_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_vault_entries_delete_objects();

CREATE OR REPLACE FUNCTION public.trg_space_members_drop_private_vault()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gone uuid[];
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
  INTO gone
  FROM public.vault_entries
  WHERE family_space_id = OLD.family_space_id
    AND author_id = OLD.user_id
    AND visibility = 'private';
  PERFORM public.delete_vault_objects_for_entries(gone);
  DELETE FROM public.vault_entries
  WHERE family_space_id = OLD.family_space_id
    AND author_id = OLD.user_id
    AND visibility = 'private';
  DELETE FROM public.personal_key_wraps
  WHERE family_space_id = OLD.family_space_id AND user_id = OLD.user_id;
  DELETE FROM public.personal_key_under_recovery
  WHERE family_space_id = OLD.family_space_id AND user_id = OLD.user_id;
  PERFORM public.cleanup_orphaned_vault_objects();
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS space_members_drop_private_vault ON public.space_members;
CREATE TRIGGER space_members_drop_private_vault
  AFTER DELETE ON public.space_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_space_members_drop_private_vault();

CREATE OR REPLACE FUNCTION public.vault_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF NEW.parent_entry_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.vault_entries AS parent
        WHERE parent.id = NEW.parent_entry_id
          AND parent.family_space_id = NEW.family_space_id
          AND parent.author_id = NEW.author_id
          AND parent.parent_entry_id IS NULL
          AND parent.visibility IS NOT DISTINCT FROM NEW.visibility
      ) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.family_space_id IS DISTINCT FROM OLD.family_space_id
     OR NEW.parent_entry_id IS DISTINCT FROM OLD.parent_entry_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF NEW.version = OLD.version THEN
    IF NEW.ciphertext IS DISTINCT FROM OLD.ciphertext
       OR NEW.content_nonce IS DISTINCT FROM OLD.content_nonce
       OR NEW.visibility IS DISTINCT FROM OLD.visibility THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF current_setting('patria.vault_switch', true) IS DISTINCT FROM '1'
     AND NEW.parent_entry_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.vault_entries AS parent
       WHERE parent.id = NEW.parent_entry_id
         AND parent.visibility IS DISTINCT FROM NEW.visibility
     ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS vault_entries_select ON public.vault_entries;
CREATE POLICY vault_entries_select ON public.vault_entries
  FOR SELECT TO authenticated
  USING (public.can_read_vault_entry(id));

DROP POLICY IF EXISTS vault_entries_insert ON public.vault_entries;
CREATE POLICY vault_entries_insert ON public.vault_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.vault_writer_ready(family_space_id, auth.uid())
    AND (
      (
        visibility = 'family'
        AND key_epoch IS NOT DISTINCT FROM public.current_family_key_epoch(family_space_id)
      )
      OR (
        visibility = 'private'
        AND key_epoch IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.personal_key_wraps AS w
          WHERE w.family_space_id = vault_entries.family_space_id
            AND w.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS vault_entries_update ON public.vault_entries;
CREATE POLICY vault_entries_update ON public.vault_entries
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.space_members AS m
      WHERE m.family_space_id = vault_entries.family_space_id
        AND m.user_id = auth.uid()
    )
    AND (
      (
        visibility = 'family'
        AND public.is_key_eligible_member(family_space_id, auth.uid())
        AND key_epoch IS NOT DISTINCT FROM public.current_family_key_epoch(family_space_id)
      )
      OR (
        visibility = 'private'
        AND key_epoch IS NULL
      )
    )
  );

CREATE POLICY personal_key_wraps_select ON public.personal_key_wraps
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY personal_key_wraps_insert ON public.personal_key_wraps
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.personal_key_under_recovery AS r
      WHERE r.family_space_id = personal_key_wraps.family_space_id
        AND r.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.approved_personal_devices(
        personal_key_wraps.family_space_id,
        auth.uid()
      ) AS d
      WHERE d.device_id = personal_key_wraps.device_id
    )
  );

CREATE POLICY personal_key_wraps_delete ON public.personal_key_wraps
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY personal_key_under_recovery_select ON public.personal_key_under_recovery
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.rotate_family_key(
  p_space_id uuid,
  p_expected_epoch integer,
  p_user_ids uuid[],
  p_device_ids uuid[],
  p_wrapped_keys bytea[],
  p_seal_user_ids uuid[],
  p_sealed_keys bytea[],
  p_entry_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_wrapped_ceks bytea[] DEFAULT ARRAY[]::bytea[],
  p_cek_nonces bytea[] DEFAULT ARRAY[]::bytea[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  current_epoch integer;
  next_epoch integer;
  expected_devices integer;
  expected_seals integer;
  i integer;
BEGIN
  IF me IS NULL OR NOT public.is_space_admin(p_space_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_user_ids) IS DISTINCT FROM cardinality(p_device_ids)
     OR cardinality(p_user_ids) IS DISTINCT FROM cardinality(p_wrapped_keys)
     OR cardinality(p_seal_user_ids) IS DISTINCT FROM cardinality(p_sealed_keys)
     OR cardinality(p_entry_ids) IS DISTINCT FROM cardinality(p_wrapped_ceks)
     OR cardinality(p_entry_ids) IS DISTINCT FROM cardinality(p_cek_nonces) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_wrapped_ceks) AS offered(wrapped)
    WHERE octet_length(offered.wrapped) IS DISTINCT FROM 48
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_cek_nonces) AS offered(nonce)
    WHERE octet_length(offered.nonce) IS DISTINCT FROM 24
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT key_epoch INTO current_epoch
  FROM public.family_key_meta
  WHERE family_space_id = p_space_id
  FOR UPDATE;
  IF current_epoch IS NULL OR current_epoch IS DISTINCT FROM p_expected_epoch THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*) FROM unnest(p_entry_ids) AS offered(id)
  ) IS DISTINCT FROM (
    SELECT count(DISTINCT id) FROM unnest(p_entry_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM public.vault_entries
    WHERE family_space_id = p_space_id
      AND visibility = 'family'
      AND key_epoch = current_epoch
    EXCEPT
    SELECT id FROM unnest(p_entry_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM unnest(p_entry_ids) AS offered(id)
    EXCEPT
    SELECT id FROM public.vault_entries
    WHERE family_space_id = p_space_id
      AND visibility = 'family'
      AND key_epoch = current_epoch
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO expected_devices
  FROM public.family_key_wraps AS w
  JOIN public.device_keys AS d
    ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
  JOIN public.space_members AS m
    ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
  WHERE w.family_space_id = p_space_id
    AND w.key_epoch = current_epoch
    AND public.is_key_holder_role(m.role);

  IF expected_devices IS DISTINCT FROM cardinality(p_device_ids) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT user_id, device_id
    FROM unnest(p_user_ids, p_device_ids) AS offered(user_id, device_id)
    EXCEPT
    SELECT w.user_id, w.device_id
    FROM public.family_key_wraps AS w
    JOIN public.device_keys AS d
      ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
    JOIN public.space_members AS m
      ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
    WHERE w.family_space_id = p_space_id
      AND w.key_epoch = current_epoch
      AND public.is_key_holder_role(m.role)
  ) OR EXISTS (
    SELECT w.user_id, w.device_id
    FROM public.family_key_wraps AS w
    JOIN public.device_keys AS d
      ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
    JOIN public.space_members AS m
      ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
    WHERE w.family_space_id = p_space_id
      AND w.key_epoch = current_epoch
      AND public.is_key_holder_role(m.role)
    EXCEPT
    SELECT user_id, device_id FROM unnest(p_user_ids, p_device_ids) AS offered(user_id, device_id)
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO expected_seals
  FROM public.recovery_public_keys AS r
  JOIN public.space_members AS m
    ON m.family_space_id = r.family_space_id AND m.user_id = r.user_id
  WHERE r.family_space_id = p_space_id
    AND public.is_key_holder_role(m.role);
  IF expected_seals IS DISTINCT FROM cardinality(p_seal_user_ids) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT user_id FROM unnest(p_seal_user_ids) AS offered(user_id)
    EXCEPT
    SELECT r.user_id
    FROM public.recovery_public_keys AS r
    JOIN public.space_members AS m
      ON m.family_space_id = r.family_space_id AND m.user_id = r.user_id
    WHERE r.family_space_id = p_space_id
      AND public.is_key_holder_role(m.role)
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  next_epoch := current_epoch + 1;
  UPDATE public.family_key_meta
  SET key_epoch = next_epoch, updated_at = now()
  WHERE family_space_id = p_space_id;

  FOR i IN 1..COALESCE(cardinality(p_device_ids), 0) LOOP
    INSERT INTO public.family_key_wraps (
      family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
    ) VALUES (
      p_space_id, p_user_ids[i], p_device_ids[i], p_wrapped_keys[i], next_epoch, me
    );
  END LOOP;

  FOR i IN 1..COALESCE(cardinality(p_seal_user_ids), 0) LOOP
    INSERT INTO public.family_key_under_recovery (
      family_space_id, user_id, key_epoch, wrapped_family_key
    ) VALUES (
      p_space_id, p_seal_user_ids[i], next_epoch, p_sealed_keys[i]
    );
  END LOOP;

  FOR i IN 1..COALESCE(cardinality(p_entry_ids), 0) LOOP
    UPDATE public.vault_entries
    SET wrapped_cek = p_wrapped_ceks[i],
        cek_nonce = p_cek_nonces[i],
        key_epoch = next_epoch
    WHERE id = p_entry_ids[i]
      AND family_space_id = p_space_id
      AND visibility = 'family'
      AND key_epoch = current_epoch;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  UPDATE public.family_spaces SET rotation_needed = false WHERE id = p_space_id;
  RETURN next_epoch;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_own_device(
  p_space_id uuid,
  p_device_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  leftover integer;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.device_keys AS d
    WHERE d.user_id = me AND d.device_id = p_device_id
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_key_eligible_member(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.device_removed_notices (family_space_id, user_id, device_id)
  VALUES (p_space_id, me, p_device_id);

  DELETE FROM public.family_key_wraps
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND device_id = p_device_id;
  DELETE FROM public.personal_key_wraps
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND device_id = p_device_id;
  DELETE FROM public.device_approval_notices
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND device_id = p_device_id;
  DELETE FROM public.recovery_contact_secrets
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND device_id = p_device_id;
  DELETE FROM public.recovery_requests
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND new_device_id = p_device_id
    AND completed_at IS NULL;

  SELECT count(*)::integer INTO leftover
  FROM (
    SELECT 1 FROM public.family_key_wraps
    WHERE user_id = me AND device_id = p_device_id
    UNION ALL
    SELECT 1 FROM public.personal_key_wraps
    WHERE user_id = me AND device_id = p_device_id
    UNION ALL
    SELECT 1 FROM public.device_approval_notices
    WHERE user_id = me AND device_id = p_device_id
    UNION ALL
    SELECT 1 FROM public.recovery_contact_secrets
    WHERE user_id = me AND device_id = p_device_id
    UNION ALL
    SELECT 1 FROM public.recovery_requests
    WHERE user_id = me AND new_device_id = p_device_id
  ) AS leftover_rows;

  IF leftover = 0 THEN
    DELETE FROM public.device_keys
    WHERE user_id = me AND device_id = p_device_id;
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vault',
  'vault',
  false,
  7340032,
  ARRAY['application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 7340032,
  allowed_mime_types = ARRAY['application/octet-stream']::text[];

DROP POLICY IF EXISTS vault_objects_select ON storage.objects;
CREATE POLICY vault_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vault'
    AND public.can_view_vault_object(name)
  );

DROP POLICY IF EXISTS vault_objects_insert ON storage.objects;
CREATE POLICY vault_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vault'
    AND public.can_upload_vault_object(name)
  );

DROP POLICY IF EXISTS vault_objects_delete ON storage.objects;
CREATE POLICY vault_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vault'
    AND public.can_delete_vault_object(name)
  );

REVOKE ALL ON TABLE public.personal_key_wraps FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.personal_key_under_recovery FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.personal_key_wraps TO authenticated;
GRANT SELECT ON TABLE public.personal_key_under_recovery TO authenticated;

REVOKE ALL ON FUNCTION public.vault_writer_ready(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_vault_entry(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approved_personal_devices(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_personal_key(uuid, uuid[], bytea[], bytea) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_recovery_public_key(uuid, bytea, integer, bytea) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_vault_visibility_switch(
  uuid, text, integer, integer, bytea, bytea, bytea, bytea,
  uuid[], integer[], integer[], bytea[], bytea[], bytea[], bytea[]
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vault_object_parts(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_upload_vault_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_vault_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_vault_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cleanup_orphaned_vault_objects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_vault_objects_for_entries(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_vault_entries_delete_objects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_space_members_drop_private_vault() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.vault_writer_ready(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_vault_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approved_personal_devices(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_personal_key(uuid, uuid[], bytea[], bytea) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_recovery_public_key(uuid, bytea, integer, bytea) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_vault_visibility_switch(
  uuid, text, integer, integer, bytea, bytea, bytea, bytea,
  uuid[], integer[], integer[], bytea[], bytea[], bytea[], bytea[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_object_parts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_vault_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_vault_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_vault_object(text) TO authenticated;
