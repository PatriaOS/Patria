-- Recovery pair boxes: atomic repair commit, events, helper-refresh notices.
-- Build new epoch ciphertext on the client first; this RPC switches the public
-- key and drops the old epoch only after the new ab + holders are present.
-- Failure rolls back — member is no worse off than before.

CREATE TABLE public.recovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recovery_events IS
  'Audit for recovery setup and repair. No key material.';

CREATE INDEX recovery_events_space_user_idx
  ON public.recovery_events (family_space_id, user_id, created_at DESC);

ALTER TABLE public.recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_events FORCE ROW LEVEL SECURITY;

CREATE POLICY recovery_events_select ON public.recovery_events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_space_admin(family_space_id)
  );

REVOKE ALL ON TABLE public.recovery_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.recovery_events TO authenticated;

CREATE TABLE public.recovery_helper_refresh_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_space_id, member_id, contact_user_id)
);

COMMENT ON TABLE public.recovery_helper_refresh_notices IS
  'Shown to a recovery contact when the member refreshed helper wraps. No action needed.';

ALTER TABLE public.recovery_helper_refresh_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_helper_refresh_notices FORCE ROW LEVEL SECURITY;

CREATE POLICY recovery_helper_refresh_notices_select ON public.recovery_helper_refresh_notices
  FOR SELECT TO authenticated
  USING (
    contact_user_id = auth.uid()
    OR member_id = auth.uid()
    OR public.is_space_admin(family_space_id)
  );

CREATE POLICY recovery_helper_refresh_notices_delete ON public.recovery_helper_refresh_notices
  FOR DELETE TO authenticated
  USING (contact_user_id = auth.uid());

REVOKE ALL ON TABLE public.recovery_helper_refresh_notices FROM PUBLIC, anon;
GRANT SELECT, DELETE ON TABLE public.recovery_helper_refresh_notices TO authenticated;

CREATE OR REPLACE FUNCTION public.has_open_recovery_request(p_space_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.space_members AS m
       WHERE m.family_space_id = p_space_id
         AND m.user_id = auth.uid()
     ) THEN
    RETURN false;
  END IF;
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.is_space_admin(p_space_id) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.recovery_requests AS r
    WHERE r.family_space_id = p_space_id
      AND r.user_id = p_user_id
      AND r.completed_at IS NULL
      AND r.cancelled_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_open_recovery_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_open_recovery_request(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_recovery_repair(
  p_space_id uuid,
  p_old_epoch integer,
  p_new_epoch integer,
  p_public_key bytea,
  p_family_key_epoch integer,
  p_wrapped_family_key bytea,
  p_personal_seal bytea,
  p_contact_user_ids uuid[],
  p_contact_device_ids uuid[],
  p_wrapped_holder_secrets bytea[],
  p_ab_box bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  n integer;
  i integer;
  contact uuid;
BEGIN
  IF me IS NULL OR NOT public.is_key_eligible_member(p_space_id, me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF public.has_open_recovery_request(p_space_id, me) THEN
    RAISE EXCEPTION 'recovery request open' USING ERRCODE = 'P0001';
  END IF;
  IF octet_length(p_public_key) IS DISTINCT FROM 32
     OR octet_length(p_wrapped_family_key) < 64
     OR octet_length(p_ab_box) < 64
     OR p_new_epoch < 1
     OR p_new_epoch <= p_old_epoch
     OR p_family_key_epoch < 1 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  n := COALESCE(cardinality(p_contact_user_ids), 0);
  IF n = 0
     OR cardinality(p_contact_device_ids) IS DISTINCT FROM n
     OR cardinality(p_wrapped_holder_secrets) IS DISTINCT FROM n THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  FOR i IN 1..n LOOP
    IF p_contact_user_ids[i] IS NULL
       OR p_contact_device_ids[i] IS NULL
       OR octet_length(p_wrapped_holder_secrets[i]) < 64 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.recovery_contacts AS c
      WHERE c.family_space_id = p_space_id
        AND c.member_id = me
        AND c.user_id = p_contact_user_ids[i]
        AND c.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- New epoch ciphertext first (safe if we abort before the public-key switch).
  FOR i IN 1..n LOOP
    INSERT INTO public.recovery_contact_secrets (
      family_space_id, member_id, user_id, device_id, wrapped_secret, recovery_key_epoch
    ) VALUES (
      p_space_id, me, p_contact_user_ids[i], p_contact_device_ids[i],
      p_wrapped_holder_secrets[i], p_new_epoch
    )
    ON CONFLICT (family_space_id, member_id, user_id, device_id, recovery_key_epoch)
    DO UPDATE SET wrapped_secret = EXCLUDED.wrapped_secret;
  END LOOP;

  INSERT INTO public.recovery_pair_wraps (
    family_space_id, user_id, recovery_key_epoch, pair_id, wrapped_recovery_key
  ) VALUES (
    p_space_id, me, p_new_epoch, 'ab', p_ab_box
  )
  ON CONFLICT (family_space_id, user_id, recovery_key_epoch, pair_id)
  DO UPDATE SET wrapped_recovery_key = EXCLUDED.wrapped_recovery_key;

  INSERT INTO public.family_key_under_recovery (
    family_space_id, user_id, key_epoch, wrapped_family_key
  ) VALUES (
    p_space_id, me, p_family_key_epoch, p_wrapped_family_key
  )
  ON CONFLICT (family_space_id, user_id, key_epoch)
  DO UPDATE SET wrapped_family_key = EXCLUDED.wrapped_family_key;

  IF EXISTS (
    SELECT 1 FROM public.personal_key_under_recovery
    WHERE family_space_id = p_space_id AND user_id = me
  ) THEN
    IF p_personal_seal IS NULL OR octet_length(p_personal_seal) < 64 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    UPDATE public.personal_key_under_recovery
    SET wrapped_key = p_personal_seal
    WHERE family_space_id = p_space_id AND user_id = me;
  END IF;

  -- Switch the live public key only after new ciphertext is in place.
  INSERT INTO public.recovery_public_keys (
    family_space_id, user_id, public_key, recovery_key_epoch
  ) VALUES (
    p_space_id, me, p_public_key, p_new_epoch
  )
  ON CONFLICT (family_space_id, user_id) DO UPDATE
  SET public_key = EXCLUDED.public_key,
      recovery_key_epoch = EXCLUDED.recovery_key_epoch,
      created_at = now();

  DELETE FROM public.recovery_pair_wraps
  WHERE family_space_id = p_space_id
    AND user_id = me
    AND recovery_key_epoch = p_old_epoch;

  DELETE FROM public.recovery_contact_secrets
  WHERE family_space_id = p_space_id
    AND member_id = me
    AND recovery_key_epoch = p_old_epoch;

  INSERT INTO public.recovery_events (
    family_space_id, user_id, event_type, detail
  ) VALUES (
    p_space_id, me, 'recovery repaired',
    'epoch ' || p_old_epoch::text || ' -> ' || p_new_epoch::text
  );

  FOR contact IN
    SELECT DISTINCT unnest(p_contact_user_ids)
  LOOP
    INSERT INTO public.recovery_helper_refresh_notices (
      family_space_id, member_id, contact_user_id
    ) VALUES (
      p_space_id, me, contact
    )
    ON CONFLICT (family_space_id, member_id, contact_user_id) DO UPDATE
    SET created_at = now();
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.commit_recovery_repair(
  uuid, integer, integer, bytea, integer, bytea, bytea, uuid[], uuid[], bytea[], bytea
) IS
  'Atomically commit a repaired recovery epoch after new holders+ab are supplied. Refuses while a recovery request is open.';

REVOKE ALL ON FUNCTION public.commit_recovery_repair(
  uuid, integer, integer, bytea, integer, bytea, bytea, uuid[], uuid[], bytea[], bytea
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_recovery_repair(
  uuid, integer, integer, bytea, integer, bytea, bytea, uuid[], uuid[], bytea[], bytea
) TO authenticated;
