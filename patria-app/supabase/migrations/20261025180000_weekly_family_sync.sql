-- GOV02 slice 1 / D35: Weekly Family Sync (Standard tier, RLS by meeting circle).

CREATE TYPE public.sync_agenda_kind AS ENUM ('win', 'discuss', 'decide', 'plan');
CREATE TYPE public.sync_meeting_status AS ENUM ('upcoming', 'in_progress', 'finished', 'skipped');
CREATE TYPE public.sync_step AS ENUM ('wins', 'look_ahead', 'decide', 'gratitude');

CREATE TABLE public.sync_schedules (
  family_space_id uuid PRIMARY KEY REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  local_time time NOT NULL,
  timezone text NOT NULL CHECK (char_length(btrim(timezone)) > 0),
  circle_id uuid NOT NULL REFERENCES public.circles (id),
  updated_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sync_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles (id),
  scheduled_for timestamptz NOT NULL,
  status public.sync_meeting_status NOT NULL DEFAULT 'upcoming',
  started_by uuid REFERENCES public.profiles (id),
  started_at timestamptz,
  finished_at timestamptz,
  priority_text text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sync_meetings_space_scheduled_uidx
  ON public.sync_meetings (family_space_id, scheduled_for);

CREATE UNIQUE INDEX sync_meetings_one_in_progress_uidx
  ON public.sync_meetings (family_space_id)
  WHERE status = 'in_progress';

CREATE INDEX sync_meetings_space_status_idx
  ON public.sync_meetings (family_space_id, status, scheduled_for DESC);

CREATE TABLE public.sync_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.sync_meetings (id) ON DELETE CASCADE,
  kind public.sync_agenda_kind NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) > 0 AND char_length(title) <= 200),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 4000),
  author_user_id uuid NOT NULL REFERENCES public.profiles (id),
  attributed_child_id uuid REFERENCES public.child_profiles (id) ON DELETE SET NULL,
  discussed_at timestamptz,
  decision_text text NOT NULL DEFAULT '' CHECK (char_length(decision_text) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_agenda_meeting_idx ON public.sync_agenda_items (meeting_id, kind);

CREATE TABLE public.sync_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.sync_meetings (id) ON DELETE CASCADE,
  step public.sync_step NOT NULL,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 8000),
  updated_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_notes_one_per_step UNIQUE (meeting_id, step)
);

CREATE TABLE public.sync_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.sync_meetings (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) > 0 AND char_length(title) <= 200),
  owner_user_id uuid REFERENCES public.profiles (id),
  owner_child_id uuid REFERENCES public.child_profiles (id) ON DELETE SET NULL,
  backup_user_id uuid REFERENCES public.profiles (id),
  backup_child_id uuid REFERENCES public.child_profiles (id) ON DELETE SET NULL,
  due_on date,
  done_at timestamptz,
  done_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_tasks_owner_xor CHECK (
    (owner_user_id IS NOT NULL AND owner_child_id IS NULL)
    OR (owner_user_id IS NULL AND owner_child_id IS NOT NULL)
  ),
  CONSTRAINT sync_tasks_backup_xor CHECK (
    (backup_user_id IS NULL AND backup_child_id IS NULL)
    OR (backup_user_id IS NOT NULL AND backup_child_id IS NULL)
    OR (backup_user_id IS NULL AND backup_child_id IS NOT NULL)
  )
);

CREATE INDEX sync_tasks_space_due_idx ON public.sync_tasks (family_space_id, due_on, done_at);

CREATE OR REPLACE FUNCTION public.trg_sync_guard_family_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  circle_space uuid;
  circle_kind public.circle_kind;
  meeting_space uuid;
  child_space uuid;
BEGIN
  IF TG_TABLE_NAME = 'sync_schedules' THEN
    SELECT c.family_space_id, c.kind INTO circle_space, circle_kind
    FROM public.circles AS c WHERE c.id = NEW.circle_id;
    IF circle_space IS DISTINCT FROM NEW.family_space_id
       OR circle_kind NOT IN ('household', 'extended_family') THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sync_meetings' THEN
    SELECT c.family_space_id INTO circle_space FROM public.circles AS c WHERE c.id = NEW.circle_id;
    IF circle_space IS DISTINCT FROM NEW.family_space_id THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('sync_agenda_items', 'sync_notes', 'sync_tasks') THEN
    SELECT m.family_space_id INTO meeting_space
    FROM public.sync_meetings AS m WHERE m.id = NEW.meeting_id;
    IF meeting_space IS DISTINCT FROM NEW.family_space_id THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'sync_agenda_items' AND NEW.attributed_child_id IS NOT NULL THEN
    SELECT cp.family_space_id INTO child_space
    FROM public.child_profiles AS cp WHERE cp.id = NEW.attributed_child_id;
    IF child_space IS DISTINCT FROM NEW.family_space_id THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'sync_tasks' THEN
    IF NEW.owner_child_id IS NOT NULL THEN
      SELECT cp.family_space_id INTO child_space
      FROM public.child_profiles AS cp WHERE cp.id = NEW.owner_child_id;
      IF child_space IS DISTINCT FROM NEW.family_space_id THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.backup_child_id IS NOT NULL THEN
      SELECT cp.family_space_id INTO child_space
      FROM public.child_profiles AS cp WHERE cp.id = NEW.backup_child_id;
      IF child_space IS DISTINCT FROM NEW.family_space_id THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_schedules_guard
  BEFORE INSERT OR UPDATE ON public.sync_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_guard_family_links();
CREATE TRIGGER sync_meetings_guard
  BEFORE INSERT OR UPDATE ON public.sync_meetings
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_guard_family_links();
CREATE TRIGGER sync_agenda_guard
  BEFORE INSERT OR UPDATE ON public.sync_agenda_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_guard_family_links();
CREATE TRIGGER sync_notes_guard
  BEFORE INSERT OR UPDATE ON public.sync_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_guard_family_links();
CREATE TRIGGER sync_tasks_guard
  BEFORE INSERT OR UPDATE ON public.sync_tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_guard_family_links();

ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_meetings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_agenda_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_tasks FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.in_sync_circle(_circle_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.circle_members AS cm
    WHERE cm.circle_id = _circle_id
      AND cm.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_sync(_family_space_id uuid, _circle_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circles AS c
      WHERE c.id = _circle_id
        AND c.family_space_id = _family_space_id
        AND c.kind IN ('household', 'extended_family')
    )
    AND public.in_sync_circle(_circle_id, _user_id);
$$;

CREATE OR REPLACE FUNCTION public.sync_circle_rank(_circle_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE c.kind
    WHEN 'household' THEN 1
    WHEN 'extended_family' THEN 2
    ELSE 99
  END
  FROM public.circles AS c
  WHERE c.id = _circle_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_circle_is_same_or_narrower(_from uuid, _to uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sync_circle_rank(_to) <= public.sync_circle_rank(_from);
$$;

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

  INSERT INTO public.sync_meetings (
    family_space_id, circle_id, scheduled_for, status
  ) VALUES (
    p_space_id, sched.circle_id, p_scheduled_for, 'upcoming'
  )
  ON CONFLICT (family_space_id, scheduled_for) DO NOTHING
  RETURNING id INTO meeting_id;

  IF meeting_id IS NULL THEN
    SELECT id INTO meeting_id
    FROM public.sync_meetings
    WHERE family_space_id = p_space_id
      AND scheduled_for = p_scheduled_for;
  END IF;

  RETURN meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_sync_meeting(p_meeting_id uuid)
RETURNS public.sync_meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  meeting public.sync_meetings%ROWTYPE;
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

  UPDATE public.sync_meetings
  SET
    status = 'in_progress',
    started_by = me,
    started_at = now(),
    updated_at = now()
  WHERE id = p_meeting_id
    AND status = 'upcoming'
  RETURNING * INTO meeting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'P0001';
  END IF;
  RETURN meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_sync_meeting(
  p_meeting_id uuid,
  p_priority_text text,
  p_summary jsonb,
  p_next_scheduled_for timestamptz
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

  next_id := public.ensure_next_meeting(meeting.family_space_id, p_next_scheduled_for);

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
  p_next_scheduled_for timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  upcoming_id uuid;
  meeting_id uuid;
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

  INSERT INTO public.sync_schedules (
    family_space_id, weekday, local_time, timezone, circle_id, updated_by
  ) VALUES (
    p_space_id, p_weekday, p_local_time, btrim(p_timezone), p_circle_id, me
  )
  ON CONFLICT (family_space_id) DO UPDATE
  SET
    weekday = excluded.weekday,
    local_time = excluded.local_time,
    timezone = excluded.timezone,
    circle_id = excluded.circle_id,
    updated_by = me,
    updated_at = now();

  SELECT id INTO upcoming_id
  FROM public.sync_meetings
  WHERE family_space_id = p_space_id
    AND status = 'upcoming'
  ORDER BY scheduled_for ASC
  LIMIT 1;

  IF upcoming_id IS NOT NULL THEN
    -- Day/time only: keep the meeting's frozen circle and agenda (D35).
    UPDATE public.sync_meetings
    SET
      scheduled_for = p_next_scheduled_for,
      updated_at = now()
    WHERE id = upcoming_id;
    RETURN upcoming_id;
  END IF;

  meeting_id := public.ensure_next_meeting(p_space_id, p_next_scheduled_for);
  RETURN meeting_id;
END;
$$;

CREATE POLICY sync_schedules_select ON public.sync_schedules
  FOR SELECT TO authenticated
  USING (public.can_view_sync(family_space_id, circle_id));

CREATE POLICY sync_schedules_insert ON public.sync_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.is_space_admin(family_space_id));

CREATE POLICY sync_schedules_update ON public.sync_schedules
  FOR UPDATE TO authenticated
  USING (public.is_space_admin(family_space_id))
  WITH CHECK (public.is_space_admin(family_space_id));

CREATE POLICY sync_meetings_select ON public.sync_meetings
  FOR SELECT TO authenticated
  USING (public.can_view_sync(family_space_id, circle_id));

CREATE POLICY sync_agenda_select ON public.sync_agenda_items
  FOR SELECT TO authenticated
  USING (
    public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_agenda_insert ON public.sync_agenda_items
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
    AND (
      attributed_child_id IS NULL
      OR public.is_space_admin(family_space_id)
    )
  );

CREATE POLICY sync_agenda_update ON public.sync_agenda_items
  FOR UPDATE TO authenticated
  USING (
    (
      author_user_id = auth.uid()
      OR public.is_space_admin(family_space_id)
    )
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  )
  WITH CHECK (
    (
      author_user_id = auth.uid()
      OR public.is_space_admin(family_space_id)
    )
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_agenda_delete ON public.sync_agenda_items
  FOR DELETE TO authenticated
  USING (
    (
      author_user_id = auth.uid()
      OR public.is_space_admin(family_space_id)
    )
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_notes_select ON public.sync_notes
  FOR SELECT TO authenticated
  USING (
    public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_notes_write ON public.sync_notes
  FOR ALL TO authenticated
  USING (
    public.is_space_admin(family_space_id)
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  )
  WITH CHECK (
    public.is_space_admin(family_space_id)
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_tasks_select ON public.sync_tasks
  FOR SELECT TO authenticated
  USING (
    public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_tasks_insert ON public.sync_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_space_admin(family_space_id)
    AND public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
  );

CREATE POLICY sync_tasks_update ON public.sync_tasks
  FOR UPDATE TO authenticated
  USING (
    public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
    AND (
      public.is_space_admin(family_space_id)
      OR owner_user_id = auth.uid()
      OR backup_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_view_sync(
      family_space_id,
      (SELECT m.circle_id FROM public.sync_meetings AS m WHERE m.id = meeting_id)
    )
    AND (
      public.is_space_admin(family_space_id)
      OR owner_user_id = auth.uid()
      OR backup_user_id = auth.uid()
    )
  );

REVOKE ALL ON FUNCTION public.in_sync_circle(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_sync(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_circle_rank(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_circle_is_same_or_narrower(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_next_meeting(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_sync_meeting(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_sync_meeting(uuid, text, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_sync_schedule(uuid, smallint, time, text, uuid, timestamptz)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.in_sync_circle(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_sync(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_circle_rank(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_circle_is_same_or_narrower(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_next_meeting(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_sync_meeting(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sync_meeting(uuid, text, jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sync_schedule(uuid, smallint, time, text, uuid, timestamptz)
  TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.sync_schedules TO authenticated;
GRANT SELECT ON public.sync_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_agenda_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sync_tasks TO authenticated;
