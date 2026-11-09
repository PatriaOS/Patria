-- letter_keeper_eligible must check the *candidate keeper's* role.
-- public.space_role(_space_id, _user_id) intentionally ignores _user_id and
-- returns only auth.uid()'s role (D7 lock_definer_helpers). Using it here made
-- eligibility follow the caller, so postgres/e2e checks returned NULL/false and
-- an admin author would effectively skip the keeper role gate.

CREATE OR REPLACE FUNCTION public.letter_keeper_eligible(
  _space_id uuid,
  _user_id uuid,
  _author_id uuid,
  _recipient_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS DISTINCT FROM _author_id
    AND _user_id IS DISTINCT FROM _recipient_id
    AND EXISTS (
      SELECT 1
      FROM public.space_members AS m
      WHERE m.family_space_id = _space_id
        AND m.user_id = _user_id
        AND m.role IN ('family_admin', 'co_admin', 'elder')
        AND (
          m.role <> 'caregiver'
          OR m.caregiver_access_ends_at > now()
        )
    )
    AND public.has_recovery_setup(_space_id, _user_id)
    AND EXISTS (
      SELECT 1
      FROM public.letterbox_keys AS lb
      WHERE lb.family_space_id = _space_id
        AND lb.user_id = _user_id
    );
$$;

REVOKE ALL ON FUNCTION public.letter_keeper_eligible(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letter_keeper_eligible(uuid, uuid, uuid, uuid) TO authenticated;
