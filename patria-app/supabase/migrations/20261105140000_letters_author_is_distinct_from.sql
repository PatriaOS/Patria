-- Align author checks with letters-release-fix: IS DISTINCT FROM.

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
  IF NOT FOUND OR letter.author_id IS DISTINCT FROM me THEN
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
