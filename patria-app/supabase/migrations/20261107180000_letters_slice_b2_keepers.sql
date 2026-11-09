-- LEG02 Slice B2: optional 3 keepers (2-of-3 holder secrets + pairwise shareP boxes).
-- Keepers substitute for KMS after due; recipient still needs shareR.
-- No new letters columns. No hosted migrate until Femi approves.

CREATE TYPE public.letter_keeper_slot AS ENUM ('a', 'b', 'c');
CREATE TYPE public.letter_keeper_pair_id AS ENUM ('ab', 'ac', 'bc');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.letter_keepers (
  letter_id uuid NOT NULL REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  slot public.letter_keeper_slot NOT NULL,
  keeper_id uuid NOT NULL REFERENCES public.profiles (id),
  wrapped_holder_secret bytea NOT NULL CHECK (octet_length(wrapped_holder_secret) >= 64),
  -- Recipient letterbox public pinned at seal (also AEAD-bound in the wrap).
  pinned_recipient_letterbox_public bytea NOT NULL CHECK (
    octet_length(pinned_recipient_letterbox_public) = 32
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (letter_id, version, slot),
  UNIQUE (letter_id, version, keeper_id)
);

CREATE TABLE public.letter_keeper_pair_boxes (
  letter_id uuid NOT NULL REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  pair_id public.letter_keeper_pair_id NOT NULL,
  sealed_share_p bytea NOT NULL CHECK (octet_length(sealed_share_p) >= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (letter_id, version, pair_id)
);

CREATE TABLE public.letter_keeper_recipient_secrets (
  letter_id uuid NOT NULL REFERENCES public.letters (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  from_keeper_id uuid NOT NULL REFERENCES public.profiles (id),
  slot public.letter_keeper_slot NOT NULL,
  wrapped_holder_secret bytea NOT NULL CHECK (octet_length(wrapped_holder_secret) >= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (letter_id, version, from_keeper_id),
  UNIQUE (letter_id, version, slot)
);

CREATE INDEX letter_keepers_keeper_idx ON public.letter_keepers (keeper_id);
CREATE INDEX letter_keeper_recipient_secrets_letter_idx
  ON public.letter_keeper_recipient_secrets (letter_id);

ALTER TABLE public.letter_keepers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_keepers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_keeper_pair_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_keeper_pair_boxes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.letter_keeper_recipient_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letter_keeper_recipient_secrets FORCE ROW LEVEL SECURITY;

-- Keepers may read only their own wrap + pinned recipient public for this letter/version.
CREATE POLICY letter_keepers_select ON public.letter_keepers
  FOR SELECT TO authenticated
  USING (keeper_id = auth.uid());

-- Pair boxes: no authenticated policies (deny all client access).

-- Recipient may read holder wraps resealed to them (includes slot).
CREATE POLICY letter_keeper_recipient_secrets_select ON public.letter_keeper_recipient_secrets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.letters AS l
      WHERE l.id = letter_keeper_recipient_secrets.letter_id
        AND l.recipient_id = auth.uid()
        AND l.version = letter_keeper_recipient_secrets.version
    )
  );

REVOKE ALL ON TABLE public.letter_keepers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.letter_keeper_pair_boxes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.letter_keeper_recipient_secrets FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.letter_keepers TO authenticated;
GRANT SELECT ON TABLE public.letter_keeper_recipient_secrets TO authenticated;
-- letter_keeper_pair_boxes: no grant to authenticated

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_keepers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_keeper_pair_boxes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_keeper_recipient_secrets TO service_role;

COMMENT ON TABLE public.letter_keepers IS
  'Per-keeper holder secret wrap (letterbox). Plaintext never on server. Optional 0 or 3.';
COMMENT ON TABLE public.letter_keeper_pair_boxes IS
  'Pairwise sealed shareP. No client SELECT; recipient fetches via RPC after due.';
COMMENT ON TABLE public.letter_keeper_recipient_secrets IS
  'Holder secrets resealed to recipient letterbox after due. Includes slot for pair selection.';

-- ---------------------------------------------------------------------------
-- Eligibility: adult (admin/co_admin/elder) + letterbox + recovery; not author/recipient.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.letter_keeper_eligible(
  _space_id uuid,
  _user_id uuid,
  _author_id uuid,
  _recipient_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Do not call space_role(_space_id, _user_id): that helper ignores _user_id and
  -- returns only auth.uid()'s role. Check the candidate keeper's membership row.
  SELECT
    _user_id IS DISTINCT FROM _author_id
    AND _user_id IS DISTINCT FROM _recipient_id
    AND EXISTS (
      SELECT 1
      FROM public.space_members AS m
      WHERE m.family_space_id = _space_id
        AND m.user_id = _user_id
        AND m.role IN ('family_admin', 'co_admin', 'elder')
        AND (
          m.role <> 'caregiver'
          OR m.caregiver_access_ends_at > now()
        )
    )
    AND public.has_recovery_setup(_space_id, _user_id)
    AND EXISTS (
      SELECT 1
      FROM public.letterbox_keys AS lb
      WHERE lb.family_space_id = _space_id
        AND lb.user_id = _user_id
    );
$$;

REVOKE ALL ON FUNCTION public.letter_keeper_eligible(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letter_keeper_eligible(uuid, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Keeper metadata for assigned keepers (no trigger_at / content).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.letters_for_keepers()
RETURNS TABLE (
  letter_id uuid,
  family_space_id uuid,
  version integer,
  status public.letter_status,
  author_id uuid,
  author_name text,
  recipient_id uuid,
  recipient_name text,
  slot public.letter_keeper_slot,
  due boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.family_space_id,
    l.version,
    l.status,
    l.author_id,
    coalesce(nullif(btrim(pa.display_name), ''), 'Someone'),
    l.recipient_id,
    coalesce(nullif(btrim(pr.display_name), ''), 'Someone'),
    k.slot,
    (
      l.trigger_at <= now()
      AND l.status IN ('sealed', 'pending')
    ) AS due
  FROM public.letter_keepers AS k
  JOIN public.letters AS l
    ON l.id = k.letter_id
   AND l.version = k.version
  JOIN public.profiles AS pa ON pa.id = l.author_id
  JOIN public.profiles AS pr ON pr.id = l.recipient_id
  WHERE k.keeper_id = auth.uid()
    AND l.status IN ('sealed', 'pending', 'released')
    AND public.is_family_member(l.family_space_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.letters_for_keepers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letters_for_keepers() TO authenticated;

-- Recipient: keeper names, slots, has_helped, and wraps when helped.
CREATE OR REPLACE FUNCTION public.letter_keeper_help_for_recipient(p_letter_id uuid)
RETURNS TABLE (
  slot public.letter_keeper_slot,
  keeper_id uuid,
  keeper_name text,
  has_helped boolean,
  wrapped_holder_secret bytea
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letter public.letters%ROWTYPE;
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id;
  IF NOT FOUND OR letter.recipient_id IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    k.slot,
    k.keeper_id,
    coalesce(nullif(btrim(p.display_name), ''), 'Someone')::text,
    (rs.from_keeper_id IS NOT NULL),
    rs.wrapped_holder_secret
  FROM public.letter_keepers AS k
  JOIN public.profiles AS p ON p.id = k.keeper_id
  LEFT JOIN public.letter_keeper_recipient_secrets AS rs
    ON rs.letter_id = k.letter_id
   AND rs.version = k.version
   AND rs.from_keeper_id = k.keeper_id
  WHERE k.letter_id = p_letter_id
    AND k.version = letter.version
  ORDER BY k.slot;
END;
$$;

REVOKE ALL ON FUNCTION public.letter_keeper_help_for_recipient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letter_keeper_help_for_recipient(uuid) TO authenticated;

-- Author: current keepers (names + slots) and whether any has left the family.
CREATE OR REPLACE FUNCTION public.letter_keepers_for_author(p_letter_id uuid)
RETURNS TABLE (
  slot public.letter_keeper_slot,
  keeper_id uuid,
  keeper_name text,
  still_member boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letter public.letters%ROWTYPE;
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id;
  IF NOT FOUND OR letter.author_id IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    k.slot,
    k.keeper_id,
    coalesce(nullif(btrim(p.display_name), ''), 'Someone')::text,
    public.is_family_member(letter.family_space_id, k.keeper_id)
  FROM public.letter_keepers AS k
  JOIN public.profiles AS p ON p.id = k.keeper_id
  WHERE k.letter_id = p_letter_id
    AND k.version = letter.version
  ORDER BY k.slot;
END;
$$;

REVOKE ALL ON FUNCTION public.letter_keepers_for_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letter_keepers_for_author(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- After due: keeper rewraps holder to recipient (ciphertext only).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_keeper_holder_to_recipient(
  p_letter_id uuid,
  p_wrapped_holder_secret bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
  keeper_row public.letter_keepers%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_at > now() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('sealed', 'pending') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_wrapped_holder_secret IS NULL OR octet_length(p_wrapped_holder_secret) < 64 THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO keeper_row
  FROM public.letter_keepers AS k
  WHERE k.letter_id = p_letter_id
    AND k.version = letter.version
    AND k.keeper_id = me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.letter_keeper_recipient_secrets (
    letter_id, version, from_keeper_id, slot, wrapped_holder_secret
  ) VALUES (
    p_letter_id, letter.version, me, keeper_row.slot, p_wrapped_holder_secret
  )
  ON CONFLICT (letter_id, version, from_keeper_id) DO UPDATE
  SET wrapped_holder_secret = excluded.wrapped_holder_secret,
      slot = excluded.slot;

  IF letter.status = 'sealed' THEN
    UPDATE public.letters
    SET status = 'pending', pending_at = now(), updated_at = now()
    WHERE id = p_letter_id;
    PERFORM public.record_letter_event(p_letter_id, letter.family_space_id, 'pending', NULL);
  END IF;

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id, 'keeper_helped', me
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_keeper_holder_to_recipient(uuid, bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_keeper_holder_to_recipient(uuid, bytea) TO authenticated;

-- ---------------------------------------------------------------------------
-- After due: recipient fetches one pairwise shareP box.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_letter_keeper_pair_box(
  p_letter_id uuid,
  p_pair_id public.letter_keeper_pair_id
)
RETURNS TABLE (
  version integer,
  pair_id public.letter_keeper_pair_id,
  sealed_share_p bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id;
  IF NOT FOUND OR letter.recipient_id IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_at > now() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('sealed', 'pending', 'released') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.version, b.pair_id, b.sealed_share_p
  FROM public.letter_keeper_pair_boxes AS b
  WHERE b.letter_id = p_letter_id
    AND b.version = letter.version
    AND b.pair_id = p_pair_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_letter_keeper_pair_box(uuid, public.letter_keeper_pair_id)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_letter_keeper_pair_box(uuid, public.letter_keeper_pair_id)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Extend seal_letter with optional keeper payloads (0 or exactly 3).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea,
  boolean, text, public.letter_trigger_kind, integer
);

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
  p_voice_object_path text DEFAULT NULL,
  p_trigger_kind public.letter_trigger_kind DEFAULT 'date',
  p_trigger_age integer DEFAULT NULL,
  p_keeper_ids uuid[] DEFAULT NULL,
  p_keeper_slots text[] DEFAULT NULL,
  p_keeper_wrapped_secrets bytea[] DEFAULT NULL,
  p_pinned_recipient_letterbox_public bytea DEFAULT NULL,
  p_pair_ids text[] DEFAULT NULL,
  p_pair_sealed_shares bytea[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
  kind public.letter_trigger_kind := coalesce(p_trigger_kind, 'date');
  tz text;
  dob date;
  recip_name text;
  computed_at timestamptz;
  snap date;
  age_val integer;
  today_local date;
  keeper_count integer := coalesce(cardinality(p_keeper_ids), 0);
  i integer;
  kid uuid;
  kslot public.letter_keeper_slot;
  pair public.letter_keeper_pair_id;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.author_id IS DISTINCT FROM me THEN
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

  -- Keepers: omit entirely (0) or exactly 3.
  IF keeper_count NOT IN (0, 3) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF keeper_count = 3 THEN
    IF coalesce(cardinality(p_keeper_slots), 0) <> 3
      OR coalesce(cardinality(p_keeper_wrapped_secrets), 0) <> 3
      OR coalesce(cardinality(p_pair_ids), 0) <> 3
      OR coalesce(cardinality(p_pair_sealed_shares), 0) <> 3
      OR p_pinned_recipient_letterbox_public IS NULL
      OR octet_length(p_pinned_recipient_letterbox_public) <> 32
    THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF (
      SELECT count(DISTINCT x) FROM unnest(p_keeper_ids) AS x
    ) <> 3 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF (
      SELECT count(DISTINCT x) FROM unnest(p_keeper_slots) AS x
    ) <> 3 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF (
      SELECT count(DISTINCT x) FROM unnest(p_pair_ids) AS x
    ) <> 3 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    FOR i IN 1..3 LOOP
      kid := p_keeper_ids[i];
      IF NOT public.letter_keeper_eligible(
        letter.family_space_id, kid, letter.author_id, letter.recipient_id
      ) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
      IF p_keeper_slots[i] NOT IN ('a', 'b', 'c') THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
      IF p_pair_ids[i] NOT IN ('ab', 'ac', 'bc') THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
      IF octet_length(p_keeper_wrapped_secrets[i]) < 64 THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
      IF octet_length(p_pair_sealed_shares[i]) < 32 THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
    END LOOP;
    -- Pinned key must match the recipient's current letterbox public.
    IF NOT EXISTS (
      SELECT 1
      FROM public.letterbox_keys AS lb
      WHERE lb.family_space_id = letter.family_space_id
        AND lb.user_id = letter.recipient_id
        AND lb.public_key = p_pinned_recipient_letterbox_public
    ) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT btrim(fs.timezone) INTO tz
  FROM public.family_spaces AS fs
  WHERE fs.id = letter.family_space_id;
  IF tz IS NULL OR tz = '' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT p.display_name INTO recip_name
  FROM public.profiles AS p
  WHERE p.id = letter.recipient_id;

  IF kind = 'date' THEN
    IF p_trigger_at IS NULL OR p_trigger_at <= now() THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    computed_at := p_trigger_at;
    age_val := NULL;
    snap := NULL;
  ELSIF kind = 'age' THEN
    IF p_trigger_age IS NULL OR p_trigger_age < 1 OR p_trigger_age > 120 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    age_val := p_trigger_age;
    SELECT p.date_of_birth INTO dob
    FROM public.profiles AS p
    WHERE p.id = letter.recipient_id;
    IF dob IS NULL THEN
      RAISE EXCEPTION 'letter_age_no_dob:%', coalesce(nullif(btrim(recip_name), ''), 'them')
        USING ERRCODE = 'P0001';
    END IF;
    snap := dob;
    computed_at := public.letter_age_trigger_at(snap, age_val, tz);
    today_local := public.sync_local_date(now(), tz);
    IF public.letter_birthday_ymd(snap, age_val) <= today_local THEN
      RAISE EXCEPTION 'letter_age_already:%', coalesce(nullif(btrim(recip_name), ''), 'them')
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.letter_payloads WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_author_shares WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_recipient_shares WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_patria_shares WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_keepers WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_keeper_pair_boxes WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_keeper_recipient_secrets WHERE letter_id = p_letter_id;

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

  IF keeper_count = 3 THEN
    FOR i IN 1..3 LOOP
      kslot := p_keeper_slots[i]::public.letter_keeper_slot;
      INSERT INTO public.letter_keepers (
        letter_id, version, slot, keeper_id,
        wrapped_holder_secret, pinned_recipient_letterbox_public
      ) VALUES (
        p_letter_id, p_version, kslot, p_keeper_ids[i],
        p_keeper_wrapped_secrets[i], p_pinned_recipient_letterbox_public
      );
    END LOOP;
    FOR i IN 1..3 LOOP
      pair := p_pair_ids[i]::public.letter_keeper_pair_id;
      INSERT INTO public.letter_keeper_pair_boxes (
        letter_id, version, pair_id, sealed_share_p
      ) VALUES (
        p_letter_id, p_version, pair, p_pair_sealed_shares[i]
      );
    END LOOP;
  END IF;

  PERFORM set_config('patria.allow_letter_trigger_change', '1', true);

  UPDATE public.letters
  SET
    from_label = btrim(p_from_label),
    visibility = p_visibility,
    trigger_kind = kind,
    trigger_at = computed_at,
    trigger_age = age_val,
    trigger_dob_snapshot = snap,
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

  PERFORM set_config('patria.allow_letter_trigger_change', '', true);

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id,
    CASE WHEN letter.status = 'sealed' THEN 'resealed' ELSE 'sealed' END,
    me
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea,
  boolean, text, public.letter_trigger_kind, integer,
  uuid[], text[], bytea[], bytea, text[], bytea[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea,
  boolean, text, public.letter_trigger_kind, integer,
  uuid[], text[], bytea[], bytea, text[], bytea[]
) TO authenticated;

-- ---------------------------------------------------------------------------
-- withdraw_letter: delete keeper rows then letter (pgTAP asserts cleanup).
-- ---------------------------------------------------------------------------

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
  IF NOT FOUND OR letter.author_id IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('draft', 'sealed') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM public.record_letter_event(p_letter_id, letter.family_space_id, 'withdrawn', me);

  DELETE FROM public.letter_keepers WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_keeper_pair_boxes WHERE letter_id = p_letter_id;
  DELETE FROM public.letter_keeper_recipient_secrets WHERE letter_id = p_letter_id;
  DELETE FROM public.letters WHERE id = p_letter_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Keeper leaves family → author Needs you (event).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_space_members_letter_keeper_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.letter_events (letter_id, family_space_id, actor_id, event_type)
  SELECT l.id, l.family_space_id, OLD.user_id, 'keeper_left'
  FROM public.letters AS l
  JOIN public.letter_keepers AS k
    ON k.letter_id = l.id
   AND k.version = l.version
   AND k.keeper_id = OLD.user_id
  WHERE l.family_space_id = OLD.family_space_id
    AND l.status IN ('sealed', 'pending');

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS space_members_letter_keeper_left ON public.space_members;
CREATE TRIGGER space_members_letter_keeper_left
  AFTER DELETE ON public.space_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_space_members_letter_keeper_left();
