-- GOV02 slice 2 / D37: frequency, RSVP answers, SQL-owned next occurrence.

CREATE TYPE public.sync_frequency AS ENUM ('weekly', 'every_two_weeks', 'monthly');
CREATE TYPE public.sync_monthly_mode AS ENUM ('same_weekday', 'same_date');
CREATE TYPE public.sync_rsvp AS ENUM ('going', 'cant');

ALTER TABLE public.sync_schedules
  ADD COLUMN frequency public.sync_frequency NOT NULL DEFAULT 'weekly',
  ADD COLUMN monthly_mode public.sync_monthly_mode,
  ADD COLUMN monthly_ordinal smallint,
  ADD COLUMN month_day smallint,
  ADD COLUMN anchor_local_date date;

ALTER TABLE public.sync_schedules
  ADD CONSTRAINT sync_schedules_monthly_ordinal_chk
    CHECK (monthly_ordinal IS NULL OR monthly_ordinal IN (-1, 1, 2, 3, 4)),
  ADD CONSTRAINT sync_schedules_month_day_chk
    CHECK (month_day IS NULL OR (month_day BETWEEN 1 AND 31)),
  ADD CONSTRAINT sync_schedules_monthly_fields_chk
    CHECK (
      (frequency <> 'monthly' AND monthly_mode IS NULL AND monthly_ordinal IS NULL AND month_day IS NULL)
      OR (
        frequency = 'monthly'
        AND monthly_mode = 'same_weekday'
        AND monthly_ordinal IS NOT NULL
        AND month_day IS NULL
      )
      OR (
        frequency = 'monthly'
        AND monthly_mode = 'same_date'
        AND month_day IS NOT NULL
        AND monthly_ordinal IS NULL
      )
    );

ALTER TABLE public.sync_meetings
  ADD COLUMN moved_individually boolean NOT NULL DEFAULT false;

CREATE TABLE public.sync_meeting_answers (
  meeting_id uuid NOT NULL REFERENCES public.sync_meetings (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id),
  answer public.sync_rsvp NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX sync_meeting_answers_user_idx
  ON public.sync_meeting_answers (user_id, meeting_id);

ALTER TABLE public.sync_meeting_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_meeting_answers FORCE ROW LEVEL SECURITY;

CREATE POLICY sync_meeting_answers_select ON public.sync_meeting_answers
  FOR SELECT TO authenticated
  USING (
    public.can_view_sync(
      (SELECT m.family_space_id FROM public.sync_meetings AS m WHERE m.id = meeting_id),
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_meeting_answers_insert ON public.sync_meeting_answers
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.sync_meetings AS m
      WHERE m.id = meeting_id
        AND m.status = 'upcoming'
        AND m.scheduled_for > now()
        AND public.can_view_sync(m.family_space_id, m.circle_id)
    )
  );

CREATE POLICY sync_meeting_answers_update ON public.sync_meeting_answers
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.sync_meetings AS m
      WHERE m.id = meeting_id
        AND m.status = 'upcoming'
        AND m.scheduled_for > now()
        AND public.can_view_sync(m.family_space_id, m.circle_id)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.sync_meetings AS m
      WHERE m.id = meeting_id
        AND m.status = 'upcoming'
        AND m.scheduled_for > now()
        AND public.can_view_sync(m.family_space_id, m.circle_id)
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.sync_meeting_answers TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_local_date(p_ts timestamptz, p_tz text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_ts AT TIME ZONE p_tz)::date;
$$;

CREATE OR REPLACE FUNCTION public.sync_at_local(
  p_tz text,
  p_day date,
  p_local_time time
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_day + p_local_time) AT TIME ZONE p_tz;
$$;

CREATE OR REPLACE FUNCTION public.sync_last_day_of_month(p_year int, p_month int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXTRACT(
    DAY FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')
  )::int;
$$;

CREATE OR REPLACE FUNCTION public.sync_nth_weekday_of_month(
  p_year int,
  p_month int,
  p_weekday int,
  p_ordinal int
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  first_day date := make_date(p_year, p_month, 1);
  first_wd int := EXTRACT(DOW FROM first_day)::int;
  delta int;
  candidate date;
  last_day date;
BEGIN
  IF p_ordinal = -1 THEN
    last_day := make_date(p_year, p_month, public.sync_last_day_of_month(p_year, p_month));
    delta := (EXTRACT(DOW FROM last_day)::int - p_weekday + 7) % 7;
    RETURN last_day - delta;
  END IF;
  delta := (p_weekday - first_wd + 7) % 7;
  candidate := first_day + delta + ((p_ordinal - 1) * 7);
  IF EXTRACT(MONTH FROM candidate)::int <> p_month THEN
    RETURN NULL;
  END IF;
  RETURN candidate;
END;
$$;

-- Next weekday occurrence strictly after p_after (used for weekly and anchors).
CREATE OR REPLACE FUNCTION public.sync_next_weekday_after(
  p_tz text,
  p_weekday smallint,
  p_local_time time,
  p_after timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  after_day date := (p_after AT TIME ZONE p_tz)::date;
  candidate_day date;
  candidate timestamptz;
BEGIN
  candidate_day := after_day + ((p_weekday - EXTRACT(DOW FROM after_day)::int + 7) % 7);
  candidate := public.sync_at_local(p_tz, candidate_day, p_local_time);
  IF candidate <= p_after THEN
    candidate_day := candidate_day + 7;
    candidate := public.sync_at_local(p_tz, candidate_day, p_local_time);
  END IF;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_sync_occurrence(
  p_sched public.sync_schedules,
  p_after timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tz text := btrim(p_sched.timezone);
  after_day date := (p_after AT TIME ZONE tz)::date;
  candidate_day date;
  candidate timestamptz;
  y int;
  m int;
  try_month int;
  try_year int;
  clamped int;
  i int;
BEGIN
  IF p_sched.frequency = 'weekly' THEN
    RETURN public.sync_next_weekday_after(tz, p_sched.weekday, p_sched.local_time, p_after);
  END IF;

  IF p_sched.frequency = 'every_two_weeks' THEN
    IF p_sched.anchor_local_date IS NULL THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '22023';
    END IF;
    candidate_day := p_sched.anchor_local_date;
    IF EXTRACT(DOW FROM candidate_day)::int <> p_sched.weekday THEN
      candidate_day := candidate_day
        + ((p_sched.weekday - EXTRACT(DOW FROM candidate_day)::int + 7) % 7);
    END IF;
    WHILE public.sync_at_local(tz, candidate_day, p_sched.local_time) <= p_after LOOP
      candidate_day := candidate_day + 14;
    END LOOP;
    RETURN public.sync_at_local(tz, candidate_day, p_sched.local_time);
  END IF;

  -- monthly
  y := EXTRACT(YEAR FROM after_day)::int;
  m := EXTRACT(MONTH FROM after_day)::int;

  FOR i IN 0..36 LOOP
    try_year := y + ((m - 1 + i) / 12);
    try_month := ((m - 1 + i) % 12) + 1;

    IF p_sched.monthly_mode = 'same_date' THEN
      clamped := LEAST(p_sched.month_day, public.sync_last_day_of_month(try_year, try_month));
      candidate_day := make_date(try_year, try_month, clamped);
    ELSE
      candidate_day := public.sync_nth_weekday_of_month(
        try_year, try_month, p_sched.weekday, p_sched.monthly_ordinal
      );
      IF candidate_day IS NULL THEN
        CONTINUE;
      END IF;
    END IF;

    candidate := public.sync_at_local(tz, candidate_day, p_sched.local_time);
    IF candidate > p_after THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
END;
$$;

-- Backfill: weekly default already set; set anchor from upcoming or next weekly.
UPDATE public.sync_schedules AS s
SET anchor_local_date = coalesce(
  (
    SELECT public.sync_local_date(m.scheduled_for, s.timezone)
    FROM public.sync_meetings AS m
    WHERE m.family_space_id = s.family_space_id
      AND m.status = 'upcoming'
    ORDER BY m.scheduled_for ASC
    LIMIT 1
  ),
  public.sync_local_date(
    public.sync_next_weekday_after(s.timezone, s.weekday, s.local_time, now()),
    s.timezone
  )
)
WHERE s.anchor_local_date IS NULL;

ALTER TABLE public.sync_schedules
  ALTER COLUMN anchor_local_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_next_meeting(p_space_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  sched public.sync_schedules%ROWTYPE;
  meeting_id uuid;
  try_at timestamptz;
  attempt int;
  existing uuid;
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

  SELECT id INTO existing
  FROM public.sync_meetings
  WHERE family_space_id = p_space_id
    AND status = 'upcoming'
  ORDER BY scheduled_for ASC
  LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  try_at := public.next_sync_occurrence(sched, now());

  FOR attempt IN 1..8 LOOP
    BEGIN
      INSERT INTO public.sync_meetings (
        family_space_id, circle_id, scheduled_for, status, moved_individually
      ) VALUES (
        p_space_id, sched.circle_id, try_at, 'upcoming', false
      )
      ON CONFLICT (family_space_id, scheduled_for) DO NOTHING
      RETURNING id INTO meeting_id;
    EXCEPTION
      WHEN unique_violation THEN
        meeting_id := NULL;
    END;

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

    try_at := public.next_sync_occurrence(sched, try_at);
  END LOOP;

  RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_sync_meeting(
  p_meeting_id uuid,
  p_priority_text text,
  p_summary jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  meeting public.sync_meetings%ROWTYPE;
  next_id uuid;
  item public.sync_agenda_items%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO meeting FROM public.sync_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_space_admin(meeting.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF meeting.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.sync_meetings
  SET
    status = 'finished',
    finished_at = now(),
    priority_text = coalesce(p_priority_text, ''),
    summary = coalesce(p_summary, '{}'::jsonb),
    updated_at = now()
  WHERE id = p_meeting_id;

  next_id := public.ensure_next_meeting(meeting.family_space_id);

  FOR item IN
    SELECT * FROM public.sync_agenda_items
    WHERE meeting_id = p_meeting_id
      AND discussed_at IS NULL
  LOOP
    IF public.sync_circle_is_same_or_narrower(
      meeting.circle_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = next_id)
    ) THEN
      UPDATE public.sync_agenda_items
      SET meeting_id = next_id, updated_at = now()
      WHERE id = item.id;
    END IF;
  END LOOP;

  RETURN next_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_sync_schedule(
  p_space_id uuid,
  p_weekday smallint,
  p_local_time time,
  p_timezone text,
  p_circle_id uuid,
  p_frequency public.sync_frequency DEFAULT 'weekly',
  p_monthly_mode public.sync_monthly_mode DEFAULT NULL,
  p_monthly_ordinal smallint DEFAULT NULL,
  p_month_day smallint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  upcoming public.sync_meetings%ROWTYPE;
  v_meeting_id uuid;
  next_at timestamptz;
  moved_preserved boolean := false;
  sched public.sync_schedules%ROWTYPE;
  old_frequency public.sync_frequency;
  new_anchor date;
  mode public.sync_monthly_mode;
  ordinal smallint;
  monthday smallint;
BEGIN
  IF me IS NULL OR NOT public.is_space_admin(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.circles AS c
    WHERE c.id = p_circle_id
      AND c.family_space_id = p_space_id
      AND c.kind IN ('household', 'extended_family')
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_frequency = 'monthly' THEN
    mode := p_monthly_mode;
    IF mode = 'same_weekday' THEN
      ordinal := p_monthly_ordinal;
      monthday := NULL;
    ELSIF mode = 'same_date' THEN
      monthday := p_month_day;
      ordinal := NULL;
    ELSE
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '22023';
    END IF;
  ELSE
    mode := NULL;
    ordinal := NULL;
    monthday := NULL;
  END IF;

  SELECT frequency INTO old_frequency
  FROM public.sync_schedules
  WHERE family_space_id = p_space_id;

  -- Provisional anchor: next weekday local date (refined after row exists).
  new_anchor := public.sync_local_date(
    public.sync_next_weekday_after(btrim(p_timezone), p_weekday, p_local_time, now()),
    btrim(p_timezone)
  );

  INSERT INTO public.sync_schedules (
    family_space_id, weekday, local_time, timezone, circle_id, updated_by,
    frequency, monthly_mode, monthly_ordinal, month_day, anchor_local_date
  ) VALUES (
    p_space_id, p_weekday, p_local_time, btrim(p_timezone), p_circle_id, me,
    p_frequency, mode, ordinal, monthday, new_anchor
  )
  ON CONFLICT (family_space_id) DO UPDATE
  SET
    weekday = excluded.weekday,
    local_time = excluded.local_time,
    timezone = excluded.timezone,
    circle_id = excluded.circle_id,
    frequency = excluded.frequency,
    monthly_mode = excluded.monthly_mode,
    monthly_ordinal = excluded.monthly_ordinal,
    month_day = excluded.month_day,
    updated_by = me,
    updated_at = now(),
    -- Refresh anchor when creating biweekly series or switching onto it.
    anchor_local_date = CASE
      WHEN excluded.frequency = 'every_two_weeks'
        AND (
          public.sync_schedules.frequency IS DISTINCT FROM 'every_two_weeks'
          OR public.sync_schedules.anchor_local_date IS NULL
        )
      THEN excluded.anchor_local_date
      ELSE public.sync_schedules.anchor_local_date
    END;

  SELECT * INTO sched FROM public.sync_schedules WHERE family_space_id = p_space_id;

  -- Prefer upcoming's local date as biweekly anchor when switching onto biweekly.
  IF p_frequency = 'every_two_weeks'
     AND (old_frequency IS DISTINCT FROM 'every_two_weeks' OR old_frequency IS NULL) THEN
    SELECT public.sync_local_date(m.scheduled_for, sched.timezone) INTO new_anchor
    FROM public.sync_meetings AS m
    WHERE m.family_space_id = p_space_id
      AND m.status = 'upcoming'
    ORDER BY m.scheduled_for ASC
    LIMIT 1;
    IF new_anchor IS NOT NULL THEN
      UPDATE public.sync_schedules
      SET anchor_local_date = new_anchor
      WHERE family_space_id = p_space_id;
      SELECT * INTO sched FROM public.sync_schedules WHERE family_space_id = p_space_id;
    END IF;
  END IF;

  SELECT * INTO upcoming
  FROM public.sync_meetings
  WHERE family_space_id = p_space_id
    AND status = 'upcoming'
  ORDER BY scheduled_for ASC
  LIMIT 1;

  next_at := public.next_sync_occurrence(sched, now());

  IF upcoming.id IS NULL THEN
    v_meeting_id := public.ensure_next_meeting(p_space_id);
    RETURN jsonb_build_object('meeting_id', v_meeting_id, 'moved_preserved', false);
  END IF;

  IF upcoming.moved_individually THEN
    moved_preserved := true;
    v_meeting_id := upcoming.id;
  ELSE
    -- Skip slots already taken by another meeting (usually finished/skipped).
    WHILE EXISTS (
      SELECT 1
      FROM public.sync_meetings AS m
      WHERE m.family_space_id = p_space_id
        AND m.scheduled_for = next_at
        AND m.id IS DISTINCT FROM upcoming.id
    ) LOOP
      next_at := public.next_sync_occurrence(sched, next_at);
    END LOOP;

    UPDATE public.sync_meetings
    SET
      scheduled_for = next_at,
      updated_at = now()
    WHERE id = upcoming.id
      AND status = 'upcoming'
      AND moved_individually = false
    RETURNING id INTO v_meeting_id;

    IF v_meeting_id IS NULL THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.sync_meeting_answers WHERE meeting_id = v_meeting_id;
  END IF;

  RETURN jsonb_build_object(
    'meeting_id', v_meeting_id,
    'moved_preserved', moved_preserved
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.move_sync_meeting(
  p_meeting_id uuid,
  p_new_scheduled_for timestamptz
)
RETURNS public.sync_meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  meeting public.sync_meetings%ROWTYPE;
  sched public.sync_schedules%ROWTYPE;
  follow_on timestamptz;
  updated public.sync_meetings%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO meeting FROM public.sync_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_space_admin(meeting.family_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF meeting.status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_scheduled_for IS NULL OR p_new_scheduled_for <= now() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO sched FROM public.sync_schedules WHERE family_space_id = meeting.family_space_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0002';
  END IF;

  follow_on := public.next_sync_occurrence(sched, meeting.scheduled_for);
  IF p_new_scheduled_for >= follow_on THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sync_meetings
  SET
    scheduled_for = p_new_scheduled_for,
    moved_individually = true,
    updated_at = now()
  WHERE id = p_meeting_id
    AND status = 'upcoming'
  RETURNING * INTO updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.sync_meeting_answers AS a WHERE a.meeting_id = p_meeting_id;
  RETURN updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sync_meeting_answer(
  p_meeting_id uuid,
  p_answer public.sync_rsvp
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  meeting public.sync_meetings%ROWTYPE;
BEGIN
  IF me IS NULL OR p_answer IS NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO meeting FROM public.sync_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_view_sync(meeting.family_space_id, meeting.circle_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF meeting.status IS DISTINCT FROM 'upcoming' OR meeting.scheduled_for <= now() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sync_meeting_answers (meeting_id, user_id, answer)
  VALUES (p_meeting_id, me, p_answer)
  ON CONFLICT (meeting_id, user_id) DO UPDATE
  SET answer = excluded.answer, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_next_meeting(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.ensure_next_meeting(uuid, timestamptz);

REVOKE ALL ON FUNCTION public.finish_sync_meeting(uuid, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.finish_sync_meeting(uuid, text, jsonb, timestamptz);

REVOKE ALL ON FUNCTION public.upsert_sync_schedule(uuid, smallint, time, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.upsert_sync_schedule(uuid, smallint, time, text, uuid, timestamptz);

REVOKE ALL ON FUNCTION public.ensure_next_meeting(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_sync_meeting(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_sync_schedule(
  uuid, smallint, time, text, uuid, public.sync_frequency, public.sync_monthly_mode, smallint, smallint
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_sync_meeting(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sync_meeting_answer(uuid, public.sync_rsvp) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ensure_next_meeting(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sync_meeting(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sync_schedule(
  uuid, smallint, time, text, uuid, public.sync_frequency, public.sync_monthly_mode, smallint, smallint
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_sync_meeting(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sync_meeting_answer(uuid, public.sync_rsvp) TO authenticated;
