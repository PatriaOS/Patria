-- Distinct claim_letter_patria_share refuse reasons for letter-release logs.
-- Recipient/author comparisons use IS DISTINCT FROM so a NULL recipient_id
-- (Slice B) never compares equal via <> and accidentally pass the check.

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
  -- Recipient check first so not_due is only meaningful for the real recipient.
  IF letter.recipient_id IS DISTINCT FROM p_recipient_id THEN
    RAISE EXCEPTION 'not_recipient' USING ERRCODE = '42501';
  END IF;
  IF letter.recipient_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'recipient_left' USING ERRCODE = '42501';
  END IF;
  IF letter.trigger_at > now() THEN
    RAISE EXCEPTION 'not_due' USING ERRCODE = '42501';
  END IF;
  IF letter.status NOT IN ('sealed', 'pending', 'released') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '42501';
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

COMMENT ON FUNCTION public.claim_letter_patria_share(uuid, uuid) IS
  'Service-role only. Returns patria share after trigger; refuse reasons: not_recipient, recipient_left, not_due, bad_status.';

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
  IF NOT FOUND OR letter.recipient_id IS DISTINCT FROM p_recipient_id THEN
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

-- Author checks: treat NULL author the same as a mismatch (should not happen).
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
  DELETE FROM public.letters WHERE id = p_letter_id;
END;
$$;

-- Author ≠ recipient when either side is NULL must not pass (Slice B nullable recipient).
ALTER TABLE public.letters
  DROP CONSTRAINT IF EXISTS letters_author_ne_recipient;
ALTER TABLE public.letters
  ADD CONSTRAINT letters_author_ne_recipient
  CHECK (author_id IS DISTINCT FROM recipient_id);

-- seal_letter: author check uses IS DISTINCT FROM (NULL-safe).
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
