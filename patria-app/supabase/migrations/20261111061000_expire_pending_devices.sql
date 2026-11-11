-- Expire never-approved pending device requests after 7 days.
-- Never-approved = no family_key_wraps and no personal_key_wraps for that device.
-- Never deletes wraps. Audits via device_events. Daily pg_cron job.

CREATE TABLE public.device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  family_space_id uuid REFERENCES public.family_spaces (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.device_events IS
  'Append-only device access audit. No keys. Written by SECURITY DEFINER helpers only.';

CREATE INDEX device_events_user_idx ON public.device_events (user_id, device_id);
CREATE INDEX device_events_space_idx ON public.device_events (family_space_id);
CREATE INDEX device_events_type_idx ON public.device_events (event_type, created_at);

ALTER TABLE public.device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_events FORCE ROW LEVEL SECURITY;

CREATE POLICY device_events_select ON public.device_events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      family_space_id IS NOT NULL
      AND public.is_key_admin_member(family_space_id, auth.uid())
    )
  );

REVOKE ALL ON TABLE public.device_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.device_events TO authenticated;

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
          user_id, device_id, family_space_id, event_type, actor_id
        )
        VALUES (r.user_id, r.device_id, space, 'pending request expired', NULL);
      END LOOP;
    ELSE
      INSERT INTO public.device_events (
        user_id, device_id, family_space_id, event_type, actor_id
      )
      VALUES (r.user_id, r.device_id, NULL, 'pending request expired', NULL);
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
  'Deletes never-approved device_keys older than 7 days. Never removes wraps. Writes device_events.';

REVOKE ALL ON FUNCTION public.expire_pending_devices() FROM PUBLIC, anon;
-- Cron / service only; clients re-request via normal waiting flow.
REVOKE ALL ON FUNCTION public.expire_pending_devices() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_devices() TO service_role;

-- pg_cron: fail loudly if missing (same pattern as patria-mark-due-letters).
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
          'pg_cron is required for patria-expire-pending-devices. Enable the pg_cron extension, then re-run this migration. (%)',
          SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION
      'pg_cron is required for patria-expire-pending-devices. Enable the pg_cron extension, then re-run this migration.';
  END IF;

  FOR jid IN
    SELECT jobid FROM cron.job WHERE jobname = 'patria-expire-pending-devices'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;

  PERFORM cron.schedule(
    'patria-expire-pending-devices',
    '15 4 * * *',
    $cron$SELECT public.expire_pending_devices();$cron$
  );
END;
$$;
