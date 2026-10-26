-- Fix shared sync guard: only read NEW columns that exist on the firing table.
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

  IF TG_TABLE_NAME = 'sync_agenda_items' THEN
    IF NEW.attributed_child_id IS NOT NULL THEN
      SELECT cp.family_space_id INTO child_space
      FROM public.child_profiles AS cp WHERE cp.id = NEW.attributed_child_id;
      IF child_space IS DISTINCT FROM NEW.family_space_id THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
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
