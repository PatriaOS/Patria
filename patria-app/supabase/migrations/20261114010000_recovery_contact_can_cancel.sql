-- Accepted recovery contacts for the recovering member may cancel an open
-- request (helper card "This wasn't me"), same as the member or a family admin.
-- Records a recovery event the member can read; only open requests may cancel.
CREATE OR REPLACE FUNCTION public.cancel_recovery_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.recovery_requests;
  me uuid := auth.uid();
  updated integer;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO req FROM public.recovery_requests WHERE id = p_request_id;
  IF req.id IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF req.user_id IS DISTINCT FROM me
     AND NOT public.is_space_admin(req.family_space_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.recovery_contacts AS c
       WHERE c.family_space_id = req.family_space_id
         AND c.member_id = req.user_id
         AND c.user_id = me
         AND c.status = 'accepted'
     ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF req.completed_at IS NOT NULL OR req.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.recovery_requests
  SET cancelled_at = now(), cancelled_by = me
  WHERE id = p_request_id AND cancelled_at IS NULL AND completed_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.recovery_events (
    family_space_id, user_id, event_type, detail
  ) VALUES (
    req.family_space_id,
    req.user_id,
    'recovery cancelled',
    'cancelled_by=' || me::text
  );
END;
$$;
