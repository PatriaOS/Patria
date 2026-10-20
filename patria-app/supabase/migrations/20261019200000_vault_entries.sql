-- LEG01 slice 1: E2E-encrypted decision entries, atomic CEK rewrap on family key rotation (D33).

CREATE OR REPLACE FUNCTION public.is_vault_writer_role(p_role public.space_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_role IN ('family_admin', 'co_admin', 'elder');
$$;

CREATE OR REPLACE FUNCTION public.current_family_key_epoch(_space_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = _space_id;
$$;

CREATE OR REPLACE FUNCTION public.has_current_family_key_wrap(_space_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_key_wraps AS w
    JOIN public.family_key_meta AS m
      ON m.family_space_id = w.family_space_id
     AND m.key_epoch = w.key_epoch
    WHERE w.family_space_id = _space_id
      AND w.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_recovery_setup(_space_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.recovery_public_keys AS r
      WHERE r.family_space_id = _space_id
        AND r.user_id = _user_id
    )
    AND (
      SELECT count(*)
      FROM public.recovery_contacts AS c
      WHERE c.family_space_id = _space_id
        AND c.member_id = _user_id
        AND c.status = 'accepted'
    ) >= 2;
$$;

CREATE TABLE public.vault_entries (
  id uuid PRIMARY KEY,
  family_space_id uuid NOT NULL REFERENCES public.family_spaces (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles (id),
  parent_entry_id uuid REFERENCES public.vault_entries (id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'decision' CHECK (kind = 'decision'),
  version integer NOT NULL CHECK (version >= 1),
  key_epoch integer NOT NULL CHECK (key_epoch >= 1),
  content_nonce bytea NOT NULL CHECK (octet_length(content_nonce) = 24),
  ciphertext bytea NOT NULL CHECK (
    octet_length(ciphertext) >= 17 AND octet_length(ciphertext) <= 65536
  ),
  cek_nonce bytea NOT NULL CHECK (octet_length(cek_nonce) = 24),
  wrapped_cek bytea NOT NULL CHECK (octet_length(wrapped_cek) = 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id)
);

CREATE INDEX vault_entries_family_created_idx
  ON public.vault_entries (family_space_id, created_at DESC);

ALTER TABLE public.vault_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_entries FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vault_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF NEW.parent_entry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.vault_entries AS parent
      WHERE parent.id = NEW.parent_entry_id
        AND parent.family_space_id = NEW.family_space_id
        AND parent.author_id = NEW.author_id
        AND parent.parent_entry_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.family_space_id IS DISTINCT FROM OLD.family_space_id
     OR NEW.parent_entry_id IS DISTINCT FROM OLD.parent_entry_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF NEW.version = OLD.version THEN
    IF NEW.ciphertext IS DISTINCT FROM OLD.ciphertext
       OR NEW.content_nonce IS DISTINCT FROM OLD.content_nonce THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vault_entries_guard ON public.vault_entries;
CREATE TRIGGER vault_entries_guard
  BEFORE INSERT OR UPDATE ON public.vault_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.vault_entries_guard();

CREATE POLICY vault_entries_select ON public.vault_entries
  FOR SELECT TO authenticated
  USING (public.is_key_eligible_member(family_space_id, auth.uid()));

CREATE POLICY vault_entries_insert ON public.vault_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_key_eligible_member(family_space_id, auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.space_members AS m
      WHERE m.family_space_id = vault_entries.family_space_id
        AND m.user_id = auth.uid()
        AND public.is_vault_writer_role(m.role)
    )
    AND public.has_current_family_key_wrap(family_space_id, auth.uid())
    AND public.has_recovery_setup(family_space_id, auth.uid())
    AND key_epoch IS NOT DISTINCT FROM public.current_family_key_epoch(family_space_id)
  );

CREATE POLICY vault_entries_update ON public.vault_entries
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_key_eligible_member(family_space_id, auth.uid())
    AND key_epoch IS NOT DISTINCT FROM public.current_family_key_epoch(family_space_id)
  );

CREATE POLICY vault_entries_delete ON public.vault_entries
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

REVOKE ALL ON TABLE public.vault_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vault_entries TO authenticated;

REVOKE ALL ON FUNCTION public.is_vault_writer_role(public.space_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_family_key_epoch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_current_family_key_wrap(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_recovery_setup(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vault_entries_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_vault_writer_role(public.space_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_family_key_epoch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_current_family_key_wrap(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_recovery_setup(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.rotate_family_key(uuid, integer, uuid[], uuid[], bytea[], uuid[], bytea[]);

CREATE OR REPLACE FUNCTION public.rotate_family_key(
  p_space_id uuid,
  p_expected_epoch integer,
  p_user_ids uuid[],
  p_device_ids uuid[],
  p_wrapped_keys bytea[],
  p_seal_user_ids uuid[],
  p_sealed_keys bytea[],
  p_entry_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_wrapped_ceks bytea[] DEFAULT ARRAY[]::bytea[],
  p_cek_nonces bytea[] DEFAULT ARRAY[]::bytea[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  current_epoch integer;
  next_epoch integer;
  expected_devices integer;
  expected_seals integer;
  i integer;
BEGIN
  IF me IS NULL OR NOT public.is_space_admin(p_space_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_user_ids) IS DISTINCT FROM cardinality(p_device_ids)
     OR cardinality(p_user_ids) IS DISTINCT FROM cardinality(p_wrapped_keys)
     OR cardinality(p_seal_user_ids) IS DISTINCT FROM cardinality(p_sealed_keys)
     OR cardinality(p_entry_ids) IS DISTINCT FROM cardinality(p_wrapped_ceks)
     OR cardinality(p_entry_ids) IS DISTINCT FROM cardinality(p_cek_nonces) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_wrapped_ceks) AS offered(wrapped)
    WHERE octet_length(offered.wrapped) IS DISTINCT FROM 48
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_cek_nonces) AS offered(nonce)
    WHERE octet_length(offered.nonce) IS DISTINCT FROM 24
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT key_epoch INTO current_epoch
  FROM public.family_key_meta
  WHERE family_space_id = p_space_id
  FOR UPDATE;
  IF current_epoch IS NULL OR current_epoch IS DISTINCT FROM p_expected_epoch THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*) FROM unnest(p_entry_ids) AS offered(id)
  ) IS DISTINCT FROM (
    SELECT count(DISTINCT id) FROM unnest(p_entry_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM public.vault_entries
    WHERE family_space_id = p_space_id AND key_epoch = current_epoch
    EXCEPT
    SELECT id FROM unnest(p_entry_ids) AS offered(id)
  ) OR EXISTS (
    SELECT id FROM unnest(p_entry_ids) AS offered(id)
    EXCEPT
    SELECT id FROM public.vault_entries
    WHERE family_space_id = p_space_id AND key_epoch = current_epoch
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO expected_devices
  FROM public.family_key_wraps AS w
  JOIN public.device_keys AS d
    ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
  JOIN public.space_members AS m
    ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
  WHERE w.family_space_id = p_space_id
    AND w.key_epoch = current_epoch
    AND public.is_key_holder_role(m.role);

  IF expected_devices IS DISTINCT FROM cardinality(p_device_ids) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT user_id, device_id
    FROM unnest(p_user_ids, p_device_ids) AS offered(user_id, device_id)
    EXCEPT
    SELECT w.user_id, w.device_id
    FROM public.family_key_wraps AS w
    JOIN public.device_keys AS d
      ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
    JOIN public.space_members AS m
      ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
    WHERE w.family_space_id = p_space_id
      AND w.key_epoch = current_epoch
      AND public.is_key_holder_role(m.role)
  ) OR EXISTS (
    SELECT w.user_id, w.device_id
    FROM public.family_key_wraps AS w
    JOIN public.device_keys AS d
      ON d.user_id = w.user_id AND d.device_id = w.device_id AND d.rejected_at IS NULL
    JOIN public.space_members AS m
      ON m.family_space_id = w.family_space_id AND m.user_id = w.user_id
    WHERE w.family_space_id = p_space_id
      AND w.key_epoch = current_epoch
      AND public.is_key_holder_role(m.role)
    EXCEPT
    SELECT user_id, device_id FROM unnest(p_user_ids, p_device_ids) AS offered(user_id, device_id)
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO expected_seals
  FROM public.recovery_public_keys AS r
  JOIN public.space_members AS m
    ON m.family_space_id = r.family_space_id AND m.user_id = r.user_id
  WHERE r.family_space_id = p_space_id
    AND public.is_key_holder_role(m.role);
  IF expected_seals IS DISTINCT FROM cardinality(p_seal_user_ids) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT user_id FROM unnest(p_seal_user_ids) AS offered(user_id)
    EXCEPT
    SELECT r.user_id
    FROM public.recovery_public_keys AS r
    JOIN public.space_members AS m
      ON m.family_space_id = r.family_space_id AND m.user_id = r.user_id
    WHERE r.family_space_id = p_space_id
      AND public.is_key_holder_role(m.role)
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  next_epoch := current_epoch + 1;
  UPDATE public.family_key_meta
  SET key_epoch = next_epoch, updated_at = now()
  WHERE family_space_id = p_space_id;

  FOR i IN 1..COALESCE(cardinality(p_device_ids), 0) LOOP
    INSERT INTO public.family_key_wraps (
      family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
    ) VALUES (
      p_space_id, p_user_ids[i], p_device_ids[i], p_wrapped_keys[i], next_epoch, me
    );
  END LOOP;

  FOR i IN 1..COALESCE(cardinality(p_seal_user_ids), 0) LOOP
    INSERT INTO public.family_key_under_recovery (
      family_space_id, user_id, key_epoch, wrapped_family_key
    ) VALUES (
      p_space_id, p_seal_user_ids[i], next_epoch, p_sealed_keys[i]
    );
  END LOOP;

  FOR i IN 1..COALESCE(cardinality(p_entry_ids), 0) LOOP
    UPDATE public.vault_entries
    SET wrapped_cek = p_wrapped_ceks[i],
        cek_nonce = p_cek_nonces[i],
        key_epoch = next_epoch
    WHERE id = p_entry_ids[i]
      AND family_space_id = p_space_id
      AND key_epoch = current_epoch;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  UPDATE public.family_spaces SET rotation_needed = false WHERE id = p_space_id;
  RETURN next_epoch;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_family_key(
  uuid, integer, uuid[], uuid[], bytea[], uuid[], bytea[], uuid[], bytea[], bytea[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_family_key(
  uuid, integer, uuid[], uuid[], bytea[], uuid[], bytea[], uuid[], bytea[], bytea[]
) TO authenticated;
