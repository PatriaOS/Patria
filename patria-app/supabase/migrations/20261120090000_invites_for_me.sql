-- Invites for you: list / accept-token / decline by verified auth.users email (D48).
-- Never returns token from the list RPC. search_path locked empty; all names qualified.

CREATE OR REPLACE FUNCTION public.list_invites_for_me()
RETURNS TABLE (
  id uuid,
  family_space_name text,
  inviter_display_name text,
  role public.space_role,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    i.id,
    fs.name,
    COALESCE(p.display_name, ''),
    i.role,
    i.expires_at
  FROM public.invites AS i
  INNER JOIN auth.users AS u
    ON u.id = auth.uid()
   AND u.email_confirmed_at IS NOT NULL
   AND lower(btrim(u.email)) = lower(btrim(i.email))
  INNER JOIN public.family_spaces AS fs ON fs.id = i.family_space_id
  INNER JOIN public.profiles AS p ON p.id = i.invited_by
  WHERE i.status = 'pending'
    AND i.expires_at > pg_catalog.now()
  ORDER BY i.expires_at ASC, i.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.invite_token_for_me(p_invite_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.token
  FROM public.invites AS i
  INNER JOIN auth.users AS u
    ON u.id = auth.uid()
   AND u.email_confirmed_at IS NOT NULL
   AND lower(btrim(u.email)) = lower(btrim(i.email))
  WHERE i.id = p_invite_id
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();
$$;

CREATE OR REPLACE FUNCTION public.decline_invite_for_me(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.invites AS i
  SET status = 'declined'
  FROM auth.users AS u
  WHERE i.id = p_invite_id
    AND u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL
    AND lower(btrim(u.email)) = lower(btrim(i.email))
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now();
END;
$$;

REVOKE ALL ON FUNCTION public.list_invites_for_me() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_invites_for_me() FROM anon;
REVOKE ALL ON FUNCTION public.invite_token_for_me(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_token_for_me(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.decline_invite_for_me(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_invite_for_me(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_invites_for_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_token_for_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_invite_for_me(uuid) TO authenticated;
