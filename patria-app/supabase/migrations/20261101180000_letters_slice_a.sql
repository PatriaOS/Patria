-- LEG02 Slice A (D42): Letters to the Future — date triggers, automatic path.
-- Family timezone; letters metadata; payloads; author/recipient/patria shares; events.

-- ---------------------------------------------------------------------------
-- Family timezone
-- ---------------------------------------------------------------------------

ALTER TABLE public.family_spaces
  ADD COLUMN IF NOT EXISTS timezone text;

-- Backfill from sync schedule when present.
UPDATE public.family_spaces AS fs
SET timezone = s.timezone
FROM public.sync_schedules AS s
WHERE s.family_space_id = fs.id
  AND fs.timezone IS NULL
  AND s.timezone IS NOT NULL
  AND btrim(s.timezone) <> '';

-- Remaining spaces: America/New_York as a last-resort marker for existing rows
-- without a sync schedule. New creates require an explicit client timezone
-- (device TZ). Never leave NULL.
UPDATE public.family_spaces
SET timezone = 'America/New_York'
WHERE timezone IS NULL OR btrim(timezone) = '';

ALTER TABLE public.family_spaces
  ALTER COLUMN timezone SET DEFAULT 'America/New_York';

ALTER TABLE public.family_spaces
  ALTER COLUMN timezone SET NOT NULL;

ALTER TABLE public.family_spaces
  DROP CONSTRAINT IF EXISTS family_spaces_timezone_nonempty;

ALTER TABLE public.family_spaces
  ADD CONSTRAINT family_spaces_timezone_nonempty
  CHECK (char_length(btrim(timezone)) > 0);

-- Replace the two-argument create; app always passes device TZ. SQL default is
-- a non-UTC IANA zone for older callers/tests only — never UTC.
DROP FUNCTION IF EXISTS public.create_family_space(text, text);

CREATE OR REPLACE FUNCTION public.create_family_space(
  p_name text,
  p_relationship_label text DEFAULT NULL,
  p_timezone text DEFAULT 'America/New_York'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  space_id uuid;
  household_id uuid;
  tz text := nullif(btrim(coalesce(p_timezone, '')), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Family space name is required' USING ERRCODE = 'check_violation';
  END IF;
  IF tz IS NULL THEN
    RAISE EXCEPTION 'Time zone is required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.family_spaces (name, created_by, timezone)
  VALUES (btrim(p_name), uid, tz)
  RETURNING id INTO space_id;

  INSERT INTO public.circles (family_space_id, name, kind)
  VALUES (space_id, 'Household', 'household')
  RETURNING id INTO household_id;

  INSERT INTO public.circles (family_space_id, name, kind)
  VALUES
    (space_id, 'Extended Family', 'extended_family'),
    (space_id, 'Close Friends', 'close_friends');

  INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
  VALUES (space_id, uid, 'family_admin', p_relationship_label);

  INSERT INTO public.circle_item_type_defaults (family_space_id, item_type, circle_id)
  SELECT space_id, t.item_type, household_id
  FROM (
    VALUES
      ('photo'::public.item_type),
      ('story'::public.item_type),
      ('note'::public.item_type),
      ('task'::public.item_type),
      ('document'::public.item_type)
  ) AS t(item_type);

  RETURN space_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_family_space(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_family_space(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_family_timezone(p_space_id uuid, p_timezone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  tz text := nullif(btrim(coalesce(p_timezone, '')), '');
BEGIN
  IF me IS NULL OR NOT public.is_space_admin(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF tz IS NULL THEN
    RAISE EXCEPTION 'Time zone is required' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.family_spaces
  SET timezone = tz, updated_at = now()
  WHERE id = p_space_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_family_timezone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_timezone(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Letters schema
-- ---------------------------------------------------------------------------

CREATE TYPE public.letter_visibility AS ENUM ('surprise', 'announced');
CREATE TYPE public.letter_trigger_kind AS ENUM ('date'); -- age in Slice B
CREATE TYPE public.letter_status AS ENUM (
  'draft',
  'sealed',
  'pending',
  'released',
  'withdrawn'
);

CREATE TABLE public.letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles (id),
  recipient_id uuid NOT NULL REFERENCES public.profiles (id),
  from_label text NOT NULL CHECK (char_length(btrim(from_label)) > 0),
  visibility public.letter_visibility NOT NULL DEFAULT 'surprise',
  trigger_kind public.letter_trigger_kind NOT NULL DEFAULT 'date',
  trigger_at timestamptz NOT NULL,
  status public.letter_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  keepers_may_release_early boolean NOT NULL DEFAULT false,
  content_hash text,
  fingerprint text,
  voice_object_path text,
  recipient_left_at timestamptz,
  sealed_at timestamptz,
  pending_at timestamptz,
  released_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT letters_author_ne_recipient CHECK (author_id <> recipient_id)
);

CREATE INDEX letters_space_author_idx ON public.letters (family_space_id, author_id);
CREATE INDEX letters_space_recipient_idx ON public.letters (family_space_id, recipient_id);
CREATE INDEX letters_due_idx ON public.letters (status, trigger_at)
  WHERE status = 'sealed' AND recipient_left_at IS NULL;

CREATE TABLE public.letter_payloads (
  letter_id uuid PRIMARY KEY REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  content_nonce bytea NOT NULL CHECK (octet_length(content_nonce) = 24),
  ciphertext bytea NOT NULL CHECK (
    octet_length(ciphertext) >= 17 AND octet_length(ciphertext) <= 65536
  ),
  voice_ciphertext bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.letter_author_shares (
  letter_id uuid PRIMARY KEY REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  cek_nonce bytea NOT NULL CHECK (octet_length(cek_nonce) = 24),
  wrapped_cek bytea NOT NULL CHECK (octet_length(wrapped_cek) = 48),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-member letterbox: X25519 public key readable by writers; private half
-- wrapped to the member's personal key (reaches all phones + recovery).
CREATE TABLE public.letterbox_keys (
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
  private_nonce bytea NOT NULL CHECK (octet_length(private_nonce) = 24),
  wrapped_private bytea NOT NULL CHECK (octet_length(wrapped_private) = 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_space_id, user_id)
);

-- shareR sealed to the recipient letterbox public key (one wrap per letter).
CREATE TABLE public.letter_recipient_shares (
  letter_id uuid PRIMARY KEY REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  wrapped_share bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No SELECT for authenticated. Service role / security definer only.
CREATE TABLE public.letter_patria_shares (
  letter_id uuid PRIMARY KEY REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  ephemeral_public bytea NOT NULL CHECK (octet_length(ephemeral_public) = 33),
  sealed_share bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.letter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL,
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles (id),
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX letter_events_letter_idx ON public.letter_events (letter_id);
CREATE INDEX letter_events_space_idx ON public.letter_events (family_space_id);

ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_payloads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_author_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_author_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letterbox_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letterbox_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_recipient_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_recipient_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_patria_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_patria_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_events FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_family_member(_space_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.space_members AS m
    WHERE m.family_space_id = _space_id
      AND m.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.letter_writer_ready(_space_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vault_writer_ready(_space_id, _user_id);
$$;

CREATE OR REPLACE FUNCTION public.letter_recipient_ready(_space_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_key_eligible_member(_space_id, _user_id)
    AND public.has_recovery_setup(_space_id, _user_id)
    AND EXISTS (
      SELECT 1
      FROM public.family_key_wraps AS w
      JOIN public.family_key_meta AS m
        ON m.family_space_id = w.family_space_id
       AND m.key_epoch = w.key_epoch
      JOIN public.device_keys AS d
        ON d.user_id = w.user_id
       AND d.device_id = w.device_id
       AND d.rejected_at IS NULL
      WHERE w.family_space_id = _space_id
        AND w.user_id = _user_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.letterbox_keys AS lb
      WHERE lb.family_space_id = _space_id
        AND lb.user_id = _user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_see_letter_row(_letter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.letters AS l
    WHERE l.id = _letter_id
      AND (
        l.author_id = auth.uid()
        OR (
          l.recipient_id = auth.uid()
          AND l.status IN ('pending', 'released')
        )
        OR (
          l.recipient_id = auth.uid()
          AND l.visibility = 'announced'
          AND l.status IN ('sealed', 'pending', 'released')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_letter_payload(_letter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.letters AS l
    WHERE l.id = _letter_id
      AND (
        (l.author_id = auth.uid() AND l.status IN ('draft', 'sealed', 'pending', 'released'))
        OR (
          l.recipient_id = auth.uid()
          AND l.status IN ('pending', 'released')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.record_letter_event(
  p_letter_id uuid,
  p_family_space_id uuid,
  p_event_type text,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.letter_events (letter_id, family_space_id, actor_id, event_type)
  VALUES (p_letter_id, p_family_space_id, p_actor_id, p_event_type);
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

CREATE POLICY letters_select ON public.letters
  FOR SELECT TO authenticated
  USING (public.can_see_letter_row(id));

CREATE POLICY letters_insert ON public.letters
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_family_member(family_space_id)
    AND public.letter_writer_ready(family_space_id, auth.uid())
    AND public.letter_recipient_ready(family_space_id, recipient_id)
    AND public.is_family_member(family_space_id, recipient_id)
  );

CREATE POLICY letters_update ON public.letters
  FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.is_family_member(family_space_id)
    AND status IN ('draft', 'sealed')
  )
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_family_member(family_space_id)
  );

CREATE POLICY letters_delete ON public.letters
  FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.is_family_member(family_space_id)
    AND status IN ('draft', 'sealed')
  );

CREATE POLICY letter_payloads_select ON public.letter_payloads
  FOR SELECT TO authenticated
  USING (public.can_read_letter_payload(letter_id));

CREATE POLICY letter_payloads_insert ON public.letter_payloads
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = auth.uid()
        AND public.is_family_member(l.family_space_id)
    )
  );

CREATE POLICY letter_payloads_update ON public.letter_payloads
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = auth.uid()
        AND l.status IN ('draft', 'sealed')
        AND public.is_family_member(l.family_space_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id AND l.author_id = auth.uid()
    )
  );

CREATE POLICY letter_payloads_delete ON public.letter_payloads
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = auth.uid()
        AND public.is_family_member(l.family_space_id)
    )
  );

CREATE POLICY letter_author_shares_select ON public.letter_author_shares
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id AND l.author_id = auth.uid()
    )
  );

CREATE POLICY letter_author_shares_insert ON public.letter_author_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = auth.uid()
        AND public.is_family_member(l.family_space_id)
    )
  );

CREATE POLICY letter_author_shares_update ON public.letter_author_shares
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = auth.uid()
        AND public.is_family_member(l.family_space_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id AND l.author_id = auth.uid()
    )
  );

CREATE POLICY letter_author_shares_delete ON public.letter_author_shares
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id AND l.author_id = auth.uid()
    )
  );

CREATE POLICY letterbox_keys_select ON public.letterbox_keys
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      public.is_family_member(family_space_id)
      AND public.letter_writer_ready(family_space_id, (SELECT auth.uid()))
    )
  );

CREATE POLICY letterbox_keys_insert ON public.letterbox_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_family_member(family_space_id));

CREATE POLICY letterbox_keys_update ON public.letterbox_keys
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY letterbox_keys_delete ON public.letterbox_keys
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY letter_recipient_shares_select ON public.letter_recipient_shares
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.recipient_id = (SELECT auth.uid())
        AND l.status IN ('pending', 'released')
        AND l.recipient_left_at IS NULL
    )
  );

CREATE POLICY letter_recipient_shares_insert ON public.letter_recipient_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = (SELECT auth.uid())
        AND l.status IN ('draft', 'sealed')
    )
  );

CREATE POLICY letter_recipient_shares_delete ON public.letter_recipient_shares
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id
        AND l.author_id = (SELECT auth.uid())
    )
  );

-- letter_patria_shares: no policies for authenticated → deny all client access.
-- Service role bypasses RLS for letter-release.

CREATE POLICY letter_events_select ON public.letter_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.letters AS l
      WHERE l.id = letter_id AND l.author_id = auth.uid()
    )
    OR public.is_family_member(family_space_id)
      AND EXISTS (
        SELECT 1 FROM public.letters AS l
        WHERE l.id = letter_id AND l.recipient_id = auth.uid()
          AND l.status IN ('pending', 'released')
      )
  );

REVOKE ALL ON TABLE public.letters FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letter_payloads FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letter_author_shares FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letterbox_keys FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letter_recipient_shares FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letter_patria_shares FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.letter_events FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_payloads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_author_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letterbox_keys TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.letter_recipient_shares TO authenticated;
GRANT SELECT ON TABLE public.letter_events TO authenticated;
-- letter_patria_shares: no grant to authenticated

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_patria_shares TO service_role;

-- ---------------------------------------------------------------------------
-- Seal / withdraw / due / leave RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seal_letter(
  p_letter_id uuid,
  p_version integer,
  p_from_label text,
  p_visibility public.letter_visibility,
  p_trigger_at timestamptz,
  p_content_nonce bytea,
  p_ciphertext bytea,
  p_voice_ciphertext bytea,
  p_content_hash text,
  p_fingerprint text,
  p_author_cek_nonce bytea,
  p_author_wrapped_cek bytea,
  p_recipient_wrapped_share bytea,
  p_patria_ephemeral_public bytea,
  p_patria_sealed_share bytea,
  p_keepers_may_release_early boolean DEFAULT false,
  p_voice_object_path text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.author_id <> me THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('draft', 'sealed') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.letter_writer_ready(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.letter_recipient_ready(letter.family_space_id, letter.recipient_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_patria_ephemeral_public) <> 33 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_wrapped_share IS NULL OR octet_length(p_recipient_wrapped_share) < 32 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.letter_payloads WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_author_shares WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_recipient_shares WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_patria_shares WHERE letter_id = p_letter_id;

  INSERT INTO public.letter_payloads (
    letter_id, version, content_nonce, ciphertext, voice_ciphertext
  ) VALUES (
    p_letter_id, p_version, p_content_nonce, p_ciphertext, p_voice_ciphertext
  );

  INSERT INTO public.letter_author_shares (
    letter_id, version, cek_nonce, wrapped_cek
  ) VALUES (
    p_letter_id, p_version, p_author_cek_nonce, p_author_wrapped_cek
  );

  INSERT INTO public.letter_recipient_shares (
    letter_id, version, wrapped_share
  ) VALUES (
    p_letter_id, p_version, p_recipient_wrapped_share
  );

  INSERT INTO public.letter_patria_shares (
    letter_id, version, ephemeral_public, sealed_share
  ) VALUES (
    p_letter_id, p_version, p_patria_ephemeral_public, p_patria_sealed_share
  );

  UPDATE public.letters
  SET
    from_label = btrim(p_from_label),
    visibility = p_visibility,
    trigger_kind = 'date',
    trigger_at = p_trigger_at,
    status = 'sealed',
    version = p_version,
    keepers_may_release_early = coalesce(p_keepers_may_release_early, false),
    content_hash = p_content_hash,
    fingerprint = p_fingerprint,
    voice_object_path = p_voice_object_path,
    sealed_at = now(),
    pending_at = NULL,
    released_at = NULL,
    withdrawn_at = NULL,
    updated_at = now()
  WHERE id = p_letter_id;

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id,
    CASE WHEN letter.status = 'sealed' THEN 'resealed' ELSE 'sealed' END,
    me
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_letter(p_letter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.author_id <> me THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('draft', 'sealed') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM public.record_letter_event(p_letter_id, letter.family_space_id, 'withdrawn', me);

  -- Destroy content and every share; keep events only.
  DELETE FROM public.letters WHERE id = p_letter_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_due_letters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT l.id, l.family_space_id, fs.timezone, l.trigger_at
    FROM public.letters AS l
    JOIN public.family_spaces AS fs ON fs.id = l.family_space_id
    WHERE l.status = 'sealed'
      AND l.recipient_left_at IS NULL
      AND l.trigger_at <= now()
  LOOP
    UPDATE public.letters
    SET status = 'pending', pending_at = now(), updated_at = now()
    WHERE id = r.id AND status = 'sealed';
    IF FOUND THEN
      n := n + 1;
      PERFORM public.record_letter_event(r.id, r.family_space_id, 'pending', NULL);
    END IF;
  END LOOP;
  RETURN n;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_letterbox_key(
  p_space_id uuid,
  p_public_key bytea,
  p_private_nonce bytea,
  p_wrapped_private bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.is_family_member(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_public_key) <> 32
     OR octet_length(p_private_nonce) <> 24
     OR octet_length(p_wrapped_private) <> 48 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.letterbox_keys (
    family_space_id, user_id, public_key, private_nonce, wrapped_private
  ) VALUES (
    p_space_id, me, p_public_key, p_private_nonce, p_wrapped_private
  )
  ON CONFLICT (family_space_id, user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.create_letterbox_key(uuid, bytea, bytea, bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_letterbox_key(uuid, bytea, bytea, bytea) TO authenticated;

-- Claim patria share after trigger. Callable only via service role Edge Function.
CREATE OR REPLACE FUNCTION public.claim_letter_patria_share(p_letter_id uuid, p_recipient_id uuid)
RETURNS TABLE (ephemeral_public bytea, sealed_share bytea, version integer, content_hash text, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letter public.letters%ROWTYPE;
BEGIN
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
  END IF;
  IF letter.recipient_id <> p_recipient_id THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_at > now() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('sealed', 'pending', 'released') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF letter.status = 'sealed' THEN
    UPDATE public.letters
    SET status = 'pending', pending_at = now(), updated_at = now()
    WHERE id = p_letter_id;
    PERFORM public.record_letter_event(p_letter_id, letter.family_space_id, 'pending', NULL);
  END IF;

  RETURN QUERY
  SELECT s.ephemeral_public, s.sealed_share, s.version, letter.content_hash, letter.fingerprint
  FROM public.letter_patria_shares AS s
  WHERE s.letter_id = p_letter_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_letter_released(p_letter_id uuid, p_recipient_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letter public.letters%ROWTYPE;
BEGIN
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.recipient_id <> p_recipient_id THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('pending', 'released') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status = 'pending' THEN
    UPDATE public.letters
    SET status = 'released', released_at = now(), updated_at = now()
    WHERE id = p_letter_id;
    PERFORM public.record_letter_event(p_letter_id, letter.family_space_id, 'released', p_recipient_id);
  END IF;
END;
$$;

-- Author leave: withdraw listed letters, keep the rest (drop author shares only).
CREATE OR REPLACE FUNCTION public.leave_family_with_letters(
  p_space_id uuid,
  p_withdraw_letter_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  lid uuid;
  letter public.letters%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT public.is_family_member(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  FOREACH lid IN ARRAY coalesce(p_withdraw_letter_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO letter FROM public.letters WHERE id = lid FOR UPDATE;
    IF FOUND AND letter.author_id = me AND letter.family_space_id = p_space_id
       AND letter.status IN ('draft', 'sealed') THEN
      PERFORM public.record_letter_event(lid, p_space_id, 'withdrawn', me);
      DELETE FROM public.letters WHERE id = lid;
    END IF;
  END LOOP;

  -- Kept sealed letters: drop author reread wrap; release path stays.
  DELETE FROM public.letter_author_shares AS s
  USING public.letters AS l
  WHERE s.letter_id = l.id
    AND l.family_space_id = p_space_id
    AND l.author_id = me
    AND l.status IN ('sealed', 'pending');

  DELETE FROM public.space_members
  WHERE family_space_id = p_space_id AND user_id = me;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_space_members_letter_recipient_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.letters
  SET recipient_left_at = now(), updated_at = now()
  WHERE family_space_id = OLD.family_space_id
    AND recipient_id = OLD.user_id
    AND status IN ('draft', 'sealed', 'pending')
    AND recipient_left_at IS NULL;

  INSERT INTO public.letter_events (letter_id, family_space_id, actor_id, event_type)
  SELECT l.id, l.family_space_id, OLD.user_id, 'recipient_left'
  FROM public.letters AS l
  WHERE l.family_space_id = OLD.family_space_id
    AND l.recipient_id = OLD.user_id
    AND l.recipient_left_at IS NOT NULL
    AND l.status IN ('sealed', 'pending');

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS space_members_letter_recipient_left ON public.space_members;
CREATE TRIGGER space_members_letter_recipient_left
  AFTER DELETE ON public.space_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_space_members_letter_recipient_left();

-- pg_cron when available (hosted); local tests call mark_due_letters() directly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'patria-mark-due-letters',
      '*/15 * * * *',
      $cron$SELECT public.mark_due_letters();$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- cron optional locally
END;
$$;

REVOKE ALL ON FUNCTION public.is_family_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.letter_writer_ready(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.letter_recipient_ready(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_letter_row(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_letter_payload(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_letter_event(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea, boolean, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_letter(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_due_letters() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_letter_patria_share(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_letter_released(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_family_with_letters(uuid, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_family_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.letter_writer_ready(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.letter_recipient_ready(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_letter_row(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_letter_payload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea, boolean, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_letter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_family_with_letters(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_due_letters() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_letter_patria_share(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_letter_released(uuid, uuid) TO service_role;

COMMENT ON TABLE public.letter_patria_shares IS
  'Patria ECDH-sealed CEK share. No authenticated SELECT. letter-release only after trigger_at.';
COMMENT ON COLUMN public.letters.keepers_may_release_early IS
  'Slice B: when true, keepers may start early release. Slice A stores the flag only.';
