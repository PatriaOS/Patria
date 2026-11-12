-- is_memory_role must check the candidate _user_id, not the caller.
-- public.space_role(_space_id, _user_id) intentionally ignores _user_id and
-- returns only auth.uid()'s role (D7 lock_definer_helpers).

CREATE OR REPLACE FUNCTION public.is_memory_role(_space_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.space_members AS m
    WHERE m.family_space_id = _space_id
      AND m.user_id = _user_id
      AND m.role IN (
        'family_admin',
        'co_admin',
        'teen',
        'elder',
        'extended_relative'
      )
      AND (
        m.role <> 'caregiver'
        OR m.caregiver_access_ends_at > now()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_memory_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_memory_role(uuid, uuid) TO authenticated;
