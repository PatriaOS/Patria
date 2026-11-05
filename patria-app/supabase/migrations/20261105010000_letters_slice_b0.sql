-- LEG02 Slice B0: author may change open date while sealed; protect trigger_at;
-- fail loudly if pg_cron is missing when scheduling mark_due_letters.

-- ---------------------------------------------------------------------------
-- Block direct authenticated changes to trigger_at / trigger_kind.
-- Allowed only when patria.allow_letter_trigger_change = '1' (SECURITY DEFINER
-- RPCs), or when running as postgres / supabase_admin (migrations, pgTAP,
-- local e2e SQL). Never a client-facing shortcut.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_letters_protect_trigger_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.trigger_at IS DISTINCT FROM OLD.trigger_at
       OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind
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

DROP TRIGGER IF EXISTS letters_protect_trigger_at ON public.letters;
CREATE TRIGGER letters_protect_trigger_at
  BEFORE UPDATE ON public.letters
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_letters_protect_trigger_at();

REVOKE ALL ON FUNCTION public.trg_letters_protect_trigger_at() FROM PUBLIC, anon, authenticated;

-- seal_letter must opt in when writing trigger_at
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

  PERFORM set_config('patria.allow_letter_trigger_change', '1', true);

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

  PERFORM set_config('patria.allow_letter_trigger_change', '', true);

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id,
    CASE WHEN letter.status = 'sealed' THEN 'resealed' ELSE 'sealed' END,
    me
  );
END;
$$;

-- Change open day only: no payload / share rewrite. trigger_at is not in AAD or
-- the seal code (content hash only), so shares stay valid.
CREATE OR REPLACE FUNCTION public.set_letter_open_date(
  p_letter_id uuid,
  p_trigger_at timestamptz
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
  IF p_trigger_at IS NULL OR p_trigger_at <= now() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO letter FROM public.letters WHERE id = p_letter_id FOR UPDATE;
  IF NOT FOUND OR letter.author_id <> me THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.status <> 'sealed' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_kind <> 'date' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_family_member(letter.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('patria.allow_letter_trigger_change', '1', true);

  UPDATE public.letters
  SET
    trigger_at = p_trigger_at,
    updated_at = now()
  WHERE id = p_letter_id;

  PERFORM set_config('patria.allow_letter_trigger_change', '', true);

  PERFORM public.record_letter_event(
    p_letter_id, letter.family_space_id, 'open_date_changed', me
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_letter_open_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_letter_open_date(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.set_letter_open_date(uuid, timestamptz) IS
  'Author-only. While sealed, change trigger_at for a date letter without resealing shares.';

-- ---------------------------------------------------------------------------
-- pg_cron: fail loudly if missing (Slice A skipped quietly; hosted needed a
-- manual enable). Try CREATE EXTENSION once; still raise if unavailable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  jid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION pg_cron;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'pg_cron is required for patria-mark-due-letters. Enable the pg_cron extension, then re-run this migration. (%)',
          SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION
      'pg_cron is required for patria-mark-due-letters. Enable the pg_cron extension, then re-run this migration.';
  END IF;

  FOR jid IN
    SELECT jobid FROM cron.job WHERE jobname = 'patria-mark-due-letters'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;

  PERFORM cron.schedule(
    'patria-mark-due-letters',
    '*/15 * * * *',
    $cron$SELECT public.mark_due_letters();$cron$
  );
END;
$$;
