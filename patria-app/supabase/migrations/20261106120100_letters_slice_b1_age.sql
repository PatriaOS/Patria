-- LEG02 Slice B1: adult date_of_birth + age letter triggers (D43).
-- Author never reads recipient DOB or trigger_dob_snapshot; seal_letter
-- computes trigger_at server-side in the family time zone.

-- ---------------------------------------------------------------------------
-- profiles.date_of_birth — column grants: no SELECT for authenticated.
-- Self updates own row (RLS). Self/admin read via profile_date_of_birth RPC.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date;

GRANT UPDATE (display_name, email, updated_at, date_of_birth)
  ON TABLE public.profiles TO authenticated;

-- Readable only by the person or a family admin of a shared space.
CREATE OR REPLACE FUNCTION public.profile_date_of_birth(p_user_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  allowed boolean := false;
BEGIN
  IF me IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF me = p_user_id THEN
    allowed := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.space_members AS mine
      JOIN public.space_members AS theirs
        ON theirs.family_space_id = mine.family_space_id
       AND theirs.user_id = p_user_id
      WHERE mine.user_id = me
        AND public.is_space_admin(mine.family_space_id, me)
    ) INTO allowed;
  END IF;
  IF NOT allowed THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT p.date_of_birth FROM public.profiles AS p WHERE p.id = p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_date_of_birth(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_date_of_birth(uuid) TO authenticated;

COMMENT ON FUNCTION public.profile_date_of_birth(uuid) IS
  'Returns date_of_birth for self or a shared-space family admin. Peers get NULL.';

COMMENT ON COLUMN public.profiles.date_of_birth IS
  'Adult birthday. No authenticated SELECT grant; read via profile_date_of_birth. '
  'Self may UPDATE own row. seal_letter (definer) reads for age triggers.';

-- ---------------------------------------------------------------------------
-- Age trigger columns on letters (not updatable by authenticated — D43).
-- letter_trigger_kind 'age' was added in 20261106120000 (separate transaction).
-- ---------------------------------------------------------------------------
ALTER TABLE public.letters
  ADD COLUMN IF NOT EXISTS trigger_age integer,
  ADD COLUMN IF NOT EXISTS trigger_dob_snapshot date;

ALTER TABLE public.letters
  DROP CONSTRAINT IF EXISTS letters_trigger_age_range;
ALTER TABLE public.letters
  ADD CONSTRAINT letters_trigger_age_range
  CHECK (trigger_age IS NULL OR (trigger_age >= 1 AND trigger_age <= 120));

ALTER TABLE public.letters
  DROP CONSTRAINT IF EXISTS letters_trigger_age_fields;
ALTER TABLE public.letters
  ADD CONSTRAINT letters_trigger_age_fields
  CHECK (
    (
      trigger_kind = 'date'
      AND trigger_age IS NULL
      AND trigger_dob_snapshot IS NULL
    )
    OR (
      trigger_kind = 'age'
      AND trigger_age IS NOT NULL
      AND trigger_dob_snapshot IS NOT NULL
    )
    OR (
      -- Drafts may still be date-shaped before first seal.
      status = 'draft'
      AND trigger_kind = 'date'
    )
  );

-- Snapshot must never leave the server to authenticated clients.
-- Table-level SELECT grants new columns automatically; replace with column grants.
REVOKE SELECT ON TABLE public.letters FROM authenticated;
GRANT SELECT (
  id,
  family_space_id,
  author_id,
  recipient_id,
  from_label,
  visibility,
  trigger_kind,
  trigger_age,
  trigger_at,
  status,
  version,
  keepers_may_release_early,
  content_hash,
  fingerprint,
  voice_object_path,
  recipient_left_at,
  sealed_at,
  pending_at,
  released_at,
  withdrawn_at,
  created_at,
  updated_at
) ON TABLE public.letters TO authenticated;
-- Keep INSERT for drafts (and DELETE unused by the app).
GRANT INSERT, DELETE ON TABLE public.letters TO authenticated;

COMMENT ON COLUMN public.letters.trigger_age IS
  'Target age for age-trigger letters. Readable; only set via seal_letter / set_letter_age.';
COMMENT ON COLUMN public.letters.trigger_dob_snapshot IS
  'Frozen DOB at seal. No authenticated SELECT. DOB edits never move trigger_at.';

-- Protect age fields the same way as trigger_at / trigger_kind.
CREATE OR REPLACE FUNCTION public.trg_letters_protect_trigger_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.trigger_at IS DISTINCT FROM OLD.trigger_at
       OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind
       OR NEW.trigger_age IS DISTINCT FROM OLD.trigger_age
       OR NEW.trigger_dob_snapshot IS DISTINCT FROM OLD.trigger_dob_snapshot
     ) THEN
    IF coalesce(current_setting('patria.allow_letter_trigger_change', true), '') = '1' THEN
      RETURN NEW;
    END IF;
    IF current_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Birthday / age date math (Feb 29 → Mar 1 in non-leap years).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.letter_is_leap_year(p_year integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_year % 4 = 0) AND (p_year % 100 <> 0 OR p_year % 400 = 0);
$$;

CREATE OR REPLACE FUNCTION public.letter_birthday_ymd(p_dob date, p_age integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  y integer;
  m integer;
  d integer;
BEGIN
  IF p_dob IS NULL OR p_age IS NULL OR p_age < 1 OR p_age > 120 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  y := EXTRACT(YEAR FROM p_dob)::integer + p_age;
  m := EXTRACT(MONTH FROM p_dob)::integer;
  d := EXTRACT(DAY FROM p_dob)::integer;
  IF m = 2 AND d = 29 AND NOT public.letter_is_leap_year(y) THEN
    RETURN make_date(y, 3, 1);
  END IF;
  RETURN make_date(y, m, d);
END;
$$;

CREATE OR REPLACE FUNCTION public.letter_age_trigger_at(
  p_dob date,
  p_age integer,
  p_timezone text
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT public.sync_at_local(
    btrim(p_timezone),
    public.letter_birthday_ymd(p_dob, p_age),
    TIME '00:00'
  );
$$;

REVOKE ALL ON FUNCTION public.letter_is_leap_year(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.letter_birthday_ymd(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.letter_age_trigger_at(date, integer, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing SELECT: hide trigger_at from authors of age letters; omit snapshot.
-- INSERT drafts still go to public.letters.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.letters_for_api
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.family_space_id,
  l.author_id,
  l.recipient_id,
  l.from_label,
  l.visibility,
  l.trigger_kind,
  l.trigger_age,
  CASE
    WHEN l.trigger_kind = 'age'
      AND l.author_id = auth.uid()
      AND l.recipient_id IS DISTINCT FROM auth.uid()
    THEN NULL
    ELSE l.trigger_at
  END AS trigger_at,
  l.status,
  l.version,
  l.keepers_may_release_early,
  l.content_hash,
  l.fingerprint,
  l.voice_object_path,
  l.recipient_left_at,
  l.sealed_at,
  l.pending_at,
  l.released_at,
  l.withdrawn_at,
  l.created_at,
  l.updated_at
FROM public.letters AS l;

GRANT SELECT ON public.letters_for_api TO authenticated;

COMMENT ON VIEW public.letters_for_api IS
  'Letters SELECT for the app. Age-letter authors get NULL trigger_at; '
  'trigger_dob_snapshot is never exposed.';

-- ---------------------------------------------------------------------------
-- seal_letter: date path unchanged; age path computes trigger_at server-side.
-- DROP every prior overload so CREATE is unambiguous for callers/tests.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'seal_letter'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END;
$$;

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
  p_trigger_age integer DEFAULT NULL
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
  boolean, text, public.letter_trigger_kind, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seal_letter(
  uuid, integer, text, public.letter_visibility, timestamptz,
  bytea, bytea, bytea, text, text, bytea, bytea, bytea, bytea, bytea,
  boolean, text, public.letter_trigger_kind, integer
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Author may change age while sealed; recompute from frozen snapshot only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_letter_age(
  p_letter_id uuid,
  p_trigger_age integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  letter public.letters%ROWTYPE;
  tz text;
  computed_at timestamptz;
  today_local date;
  recip_name text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_trigger_age IS NULL OR p_trigger_age < 1 OR p_trigger_age > 120 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.author_id IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status <> 'sealed' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_kind <> 'age' OR letter.trigger_dob_snapshot IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT btrim(fs.timezone) INTO tz
  FROM public.family_spaces AS fs
  WHERE fs.id = letter.family_space_id;

  SELECT p.display_name INTO recip_name
  FROM public.profiles AS p
  WHERE p.id = letter.recipient_id;

  today_local := public.sync_local_date(now(), tz);
  IF public.letter_birthday_ymd(letter.trigger_dob_snapshot, p_trigger_age) <= today_local THEN
    RAISE EXCEPTION 'letter_age_already:%', coalesce(nullif(btrim(recip_name), ''), 'them')
      USING ERRCODE = 'P0001';
  END IF;

  computed_at := public.letter_age_trigger_at(
    letter.trigger_dob_snapshot, p_trigger_age, tz
  );

  PERFORM set_config('patria.allow_letter_trigger_change', '1', true);

  UPDATE public.letters
  SET
    trigger_age = p_trigger_age,
    trigger_at = computed_at,
    updated_at = now()
  WHERE id = p_letter_id;

  PERFORM set_config('patria.allow_letter_trigger_change', '', true);

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id, 'open_age_changed', me
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_letter_age(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_letter_age(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.set_letter_age(uuid, integer) IS
  'Author-only. While sealed, change trigger_age for an age letter; recompute '
  'from trigger_dob_snapshot (never live DOB).';

-- set_letter_open_date stays date-only (already checks trigger_kind = date).
