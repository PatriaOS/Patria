-- Record let-in notice clearance on the same pending-expiry device event.
-- Notices were already deleted in expire_pending_devices; detail makes that auditable.

ALTER TABLE public.device_events
  ADD COLUMN IF NOT EXISTS detail text;

COMMENT ON COLUMN public.device_events.detail IS
  'Optional audit note. For pending request expired: let-in notice cleared when a notice existed.';

CREATE OR REPLACE FUNCTION public.expire_pending_devices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
  space uuid;
  leftover integer;
BEGIN
  FOR r IN
    SELECT d.user_id, d.device_id
    FROM public.device_keys AS d
    WHERE d.created_at <= now() - interval '7 days'
      AND d.rejected_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.family_key_wraps AS w
        WHERE w.user_id = d.user_id AND w.device_id = d.device_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.personal_key_wraps AS w
        WHERE w.user_id = d.user_id AND w.device_id = d.device_id
      )
  LOOP
    -- Audit one row per space that had a pending notice; otherwise one row with null space.
    IF EXISTS (
      SELECT 1
      FROM public.device_approval_notices AS n
      WHERE n.user_id = r.user_id AND n.device_id = r.device_id
    ) THEN
      FOR space IN
        SELECT DISTINCT n.family_space_id
        FROM public.device_approval_notices AS n
        WHERE n.user_id = r.user_id AND n.device_id = r.device_id
      LOOP
        INSERT INTO public.device_events (
          user_id, device_id, family_space_id, event_type, actor_id, detail
        )
        VALUES (
          r.user_id,
          r.device_id,
          space,
          'pending request expired',
          NULL,
          'let-in notice cleared'
        );
      END LOOP;
    ELSE
      INSERT INTO public.device_events (
        user_id, device_id, family_space_id, event_type, actor_id, detail
      )
      VALUES (r.user_id, r.device_id, NULL, 'pending request expired', NULL, NULL);
    END IF;

    DELETE FROM public.device_approval_notices
    WHERE user_id = r.user_id AND device_id = r.device_id;

    DELETE FROM public.recovery_contact_secrets
    WHERE user_id = r.user_id AND device_id = r.device_id;

    DELETE FROM public.recovery_requests
    WHERE user_id = r.user_id
      AND new_device_id = r.device_id
      AND completed_at IS NULL;

    SELECT count(*)::integer INTO leftover
    FROM (
      SELECT 1 FROM public.family_key_wraps
      WHERE user_id = r.user_id AND device_id = r.device_id
      UNION ALL
      SELECT 1 FROM public.personal_key_wraps
      WHERE user_id = r.user_id AND device_id = r.device_id
      UNION ALL
      SELECT 1 FROM public.device_approval_notices
      WHERE user_id = r.user_id AND device_id = r.device_id
      UNION ALL
      SELECT 1 FROM public.recovery_contact_secrets
      WHERE user_id = r.user_id AND device_id = r.device_id
      UNION ALL
      SELECT 1 FROM public.recovery_requests
      WHERE user_id = r.user_id AND new_device_id = r.device_id
    ) AS leftover_rows;

    IF leftover = 0 THEN
      DELETE FROM public.device_keys
      WHERE user_id = r.user_id AND device_id = r.device_id;
      IF FOUND THEN
        n := n + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.expire_pending_devices() IS
  'Deletes never-approved device_keys older than 7 days and their let-in notices. Never removes wraps. Writes device_events (detail=let-in notice cleared when a notice existed).';

REVOKE ALL ON FUNCTION public.expire_pending_devices() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_pending_devices() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_devices() TO service_role;
