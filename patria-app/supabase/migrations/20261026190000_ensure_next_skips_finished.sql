-- After finish, ensure_next_meeting must not treat a finished row at the same
-- scheduled_for as the next upcoming meeting. Prefer an open row; otherwise
-- create the following week's slot.

CREATE OR REPLACE FUNCTION public.ensure_next_meeting(
  p_space_id uuid,
  p_scheduled_for timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  sched public.sync_schedules%ROWTYPE;
  meeting_id uuid;
  try_at timestamptz := p_scheduled_for;
  attempt int;
BEGIN
  IF me IS NULL OR public.space_role(p_space_id, me) IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO sched FROM public.sync_schedules WHERE family_space_id = p_space_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_view_sync(p_space_id, sched.circle_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '22023';
  END IF;

  FOR attempt IN 1..3 LOOP
    INSERT INTO public.sync_meetings (
      family_space_id, circle_id, scheduled_for, status
    ) VALUES (
      p_space_id, sched.circle_id, try_at, 'upcoming'
    )
    ON CONFLICT (family_space_id, scheduled_for) DO NOTHING
    RETURNING id INTO meeting_id;

    IF meeting_id IS NULL THEN
      SELECT id INTO meeting_id
      FROM public.sync_meetings
      WHERE family_space_id = p_space_id
        AND scheduled_for = try_at
        AND status IN ('upcoming', 'in_progress');
    END IF;

    IF meeting_id IS NOT NULL THEN
      RETURN meeting_id;
    END IF;

    -- Slot taken only by a finished/skipped meeting — try the next week.
    try_at := try_at + interval '7 days';
  END LOOP;

  RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
END;
$$;
