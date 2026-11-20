-- pgTAP: list_invites_for_me / invite_token_for_me / decline_invite_for_me (D48).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(12);

CREATE OR REPLACE FUNCTION tests_create_auth_user(p_id uuid, p_email text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    p_id, 'authenticated', 'authenticated', p_email,
    crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email', p_id::text, now(), now(), now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION tests_jwt(p_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_id::text, true);
  SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', p_id::text, 'role', 'authenticated')::text,
    true
  );
$$;

SELECT tests_create_auth_user('a1111111-1111-1111-1111-111111111111', 'if-admin@example.com', 'IF Admin');
SELECT tests_create_auth_user('a2222222-2222-2222-2222-222222222222', 'if-invitee@example.com', 'IF Invitee');
SELECT tests_create_auth_user('a3333333-3333-3333-3333-333333333333', 'if-other@example.com', 'IF Other');

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('IF Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE ifx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'IF Family') AS space,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'IF Family' AND c.kind = 'household'
  ) AS household;
GRANT SELECT ON TABLE ifx TO authenticated, anon;

-- Pending invite for invitee
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT space, 'a1111111-1111-1111-1111-111111111111', 'if-invitee@example.com', 'elder', household
FROM ifx;

CREATE TEMP TABLE if_pending AS
SELECT id, token FROM public.invites
WHERE email = 'if-invitee@example.com' AND status = 'pending'
ORDER BY created_at DESC LIMIT 1;
GRANT SELECT ON TABLE if_pending TO authenticated, anon;

-- Expired
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id, expires_at)
SELECT space, 'a1111111-1111-1111-1111-111111111111', 'if-invitee@example.com', 'teen', household, now() - interval '1 day'
FROM ifx;

-- Revoked
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id, status)
SELECT space, 'a1111111-1111-1111-1111-111111111111', 'if-invitee@example.com', 'teen', household, 'revoked'
FROM ifx;

-- Declined
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id, status)
SELECT space, 'a1111111-1111-1111-1111-111111111111', 'if-invitee@example.com', 'teen', household, 'declined'
FROM ifx;

-- Matching invitee sees only the pending unexpired row; no token column
SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.list_invites_for_me()),
  1,
  'invitee sees exactly one pending unexpired invite'
);

SELECT is(
  (SELECT family_space_name FROM public.list_invites_for_me() LIMIT 1),
  'IF Family',
  'list returns family name'
);

SELECT is(
  (SELECT inviter_display_name FROM public.list_invites_for_me() LIMIT 1),
  'IF Admin',
  'list returns inviter display name'
);

SELECT is(
  (SELECT role::text FROM public.list_invites_for_me() LIMIT 1),
  'elder',
  'list returns role'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.list_invites_for_me() AS r
    WHERE to_jsonb(r) ? 'token'
  ),
  0,
  'list result has no token field'
);

SELECT is(
  public.invite_token_for_me((SELECT id FROM if_pending)),
  (SELECT token FROM if_pending),
  'invitee can fetch token for their own pending invite'
);

RESET ROLE;

-- Other authenticated user sees nothing and gets NULL token
SELECT tests_jwt('a3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.list_invites_for_me()),
  0,
  'another user cannot see invites for someone else'
);

SELECT is(
  public.invite_token_for_me((SELECT id FROM if_pending)),
  NULL,
  'another user gets NULL for someone else invite id'
);

RESET ROLE;

-- Decline for me
SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.decline_invite_for_me((SELECT id FROM if_pending));
SELECT is(
  (SELECT count(*)::int FROM public.list_invites_for_me()),
  0,
  'declined invite disappears from list'
);
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.invites WHERE id = (SELECT id FROM if_pending)),
  'declined',
  'decline_invite_for_me sets declined'
);

-- anon cannot execute
SET LOCAL ROLE anon;
SELECT throws_ok(
  $sql$SELECT * FROM public.list_invites_for_me()$sql$,
  '42501',
  NULL,
  'anon cannot execute list_invites_for_me'
);
SELECT throws_ok(
  format(
    $sql$SELECT public.invite_token_for_me(%L::uuid)$sql$,
    (SELECT id FROM if_pending)
  ),
  '42501',
  NULL,
  'anon cannot execute invite_token_for_me'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
