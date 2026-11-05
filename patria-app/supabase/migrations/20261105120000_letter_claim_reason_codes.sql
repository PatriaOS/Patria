-- Distinct claim_letter_patria_share refuse reasons for letter-release logs.
-- Same checks as before; messages become not_recipient / not_due / recipient_left / bad_status.

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
