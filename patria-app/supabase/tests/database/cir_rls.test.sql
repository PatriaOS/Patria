-- pgTAP: family isolation and DECISIONS.md D8 permission matrix.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(316);
UPDATE public.patria_key_settings SET recovery_wait = interval '48 hours' WHERE singleton = 1;

CREATE OR REPLACE FUNCTION tests_create_auth_user(p_id uuid, p_email text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    p_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email',
    p_id::text,
    now(),
    now(),
    now()
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

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena@example.com', 'Elena Rivera');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco@example.com', 'Marco Rivera');
SELECT tests_create_auth_user('33333333-3333-3333-3333-333333333333', 'jordan@example.com', 'Jordan Rivera');
SELECT tests_create_auth_user('44444444-4444-4444-4444-444444444444', 'rosa@example.com', 'Rosa Rivera');
SELECT tests_create_auth_user('55555555-5555-5555-5555-555555555555', 'cousin@example.com', 'Alex Cousin');
SELECT tests_create_auth_user('66666666-6666-6666-6666-666666666666', 'uncle@example.com', 'Sam Uncle');
SELECT tests_create_auth_user('77777777-7777-7777-7777-777777777777', 'sitter@example.com', 'Pat Sitter');
SELECT tests_create_auth_user('88888888-8888-8888-8888-888888888888', 'oldsitter@example.com', 'Old Sitter');
SELECT tests_create_auth_user('99999999-9999-9999-9999-999999999999', 'heir@example.com', 'Chris Heir');
SELECT tests_create_auth_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other@example.com', 'Other Admin');
SELECT tests_create_auth_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invitee@example.com', 'New Invitee');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('The Rivera Family', 'Mom');
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('The Other Family', NULL);
RESET ROLE;

RESET ROLE;
CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'The Rivera Family') AS rivera,
  (SELECT id FROM public.family_spaces WHERE name = 'The Other Family') AS other,
  (
    SELECT c.id
    FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'The Rivera Family' AND c.kind = 'household'
  ) AS household;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT rivera, user_id, role, label
FROM fx,
LATERAL (VALUES
  ('22222222-2222-2222-2222-222222222222'::uuid, 'co_admin'::public.space_role, 'Dad'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'teen', NULL),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'elder', 'Grandparent'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'extended_relative', NULL),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'extended_relative', NULL),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'caregiver', NULL),
  ('88888888-8888-8888-8888-888888888888'::uuid, 'caregiver', NULL),
  ('99999999-9999-9999-9999-999999999999'::uuid, 'successor', NULL)
) AS v(user_id, role, label);

UPDATE public.space_members
SET caregiver_access_ends_at = now() - interval '1 hour'
WHERE user_id = '88888888-8888-8888-8888-888888888888';

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '22222222-2222-2222-2222-222222222222');
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '33333333-3333-3333-3333-333333333333');
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '44444444-4444-4444-4444-444444444444');
SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '55555555-5555-5555-5555-555555555555');
SELECT tests_jwt('66666666-6666-6666-6666-666666666666');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '66666666-6666-6666-6666-666666666666');
SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '77777777-7777-7777-7777-777777777777');
SELECT tests_jwt('88888888-8888-8888-8888-888888888888');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '88888888-8888-8888-8888-888888888888');
SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '99999999-9999-9999-9999-999999999999');

INSERT INTO public.child_profiles (id, family_space_id, display_name, date_of_birth, created_by)
SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', rivera, 'Lily', (CURRENT_DATE - 2555), '11111111-1111-1111-1111-111111111111'
FROM fx;

INSERT INTO public.circle_members (circle_id, user_id)
SELECT c.id, u
FROM fx
JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'household'
CROSS JOIN (VALUES
  ('22222222-2222-2222-2222-222222222222'::uuid),
  ('33333333-3333-3333-3333-333333333333'::uuid),
  ('44444444-4444-4444-4444-444444444444'::uuid)
) AS x(u)
WHERE NOT EXISTS (
  SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = c.id AND cm.user_id = u
);

INSERT INTO public.circle_members (circle_id, child_profile_id)
SELECT c.id, 'cccccccc-cccc-cccc-cccc-cccccccccccc'
FROM fx
JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'household'
WHERE NOT EXISTS (
  SELECT 1 FROM public.circle_members cm
  WHERE cm.circle_id = c.id AND cm.child_profile_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
);

INSERT INTO public.circle_members (circle_id, user_id)
SELECT c.id, u
FROM fx
JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'extended_family'
CROSS JOIN (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid),
  ('44444444-4444-4444-4444-444444444444'::uuid),
  ('55555555-5555-5555-5555-555555555555'::uuid)
) AS x(u)
WHERE NOT EXISTS (
  SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = c.id AND cm.user_id = u
);

INSERT INTO public.circles (id, family_space_id, name, kind)
SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd', rivera, 'Mom''s side', 'custom' FROM fx;

INSERT INTO public.circle_members (circle_id, user_id)
VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666');

SELECT has_table('public'::name, 'profiles'::name);
SELECT has_table('public'::name, 'family_spaces'::name);
SELECT has_table('public'::name, 'space_members'::name);
SELECT has_table('public'::name, 'child_profiles'::name);
SELECT has_table('public'::name, 'circles'::name);
SELECT has_table('public'::name, 'circle_members'::name);
SELECT has_table('public'::name, 'circle_item_type_defaults'::name);
SELECT has_table('public'::name, 'invites'::name);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass), 'RLS on profiles');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.family_spaces'::regclass), 'RLS on family_spaces');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.space_members'::regclass), 'RLS on space_members');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.child_profiles'::regclass), 'RLS on child_profiles');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circles'::regclass), 'RLS on circles');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circle_members'::regclass), 'RLS on circle_members');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circle_item_type_defaults'::regclass), 'RLS on circle_item_type_defaults');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invites'::regclass), 'RLS on invites');

-- Isolation
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT other FROM fx)), 0, 'admin cannot see another family space');
SELECT is((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT other FROM fx)), 0, 'admin cannot see another family members');
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 0, 'other admin cannot see Rivera space');
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  public.space_role((SELECT other FROM fx), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  NULL,
  'cannot learn another family role through space_role'
);
SELECT is(
  public.is_space_admin((SELECT other FROM fx), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'cannot probe another family through is_space_admin'
);
SELECT is(
  public.can_view_member(
    (SELECT other FROM fx),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  false,
  'cannot learn another family membership through can_view_member'
);
SELECT is(
  public.space_role((SELECT rivera FROM fx), '22222222-2222-2222-2222-222222222222')::text,
  'family_admin',
  'space_role ignores a supplied user id and returns the caller'
);
SELECT throws_ok(
  $sql$SELECT public.ensure_only_me_circle((SELECT other FROM fx), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$sql$,
  '42501',
  NULL,
  'cannot create Only Me in another family'
);
SELECT throws_ok(
  $sql$SELECT email FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'$sql$,
  '42501',
  NULL,
  'column privileges block selecting profile emails'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SELECT is(
  public.admin_member_email((SELECT rivera FROM fx), '22222222-2222-2222-2222-222222222222'),
  (SELECT email FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'),
  'admin can read a member email through the admin rpc'
);

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.admin_member_email((SELECT rivera FROM fx), '11111111-1111-1111-1111-111111111111')$sql$,
  '42501',
  NULL,
  'teen cannot read member emails through the admin rpc'
);
RESET ROLE;

-- View space name
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'admin can view space name');
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'co admin can view space name');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'teen can view space name');
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'elder can view space name');
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'extended relative can view space name');
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT isnt_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'active caregiver can view space name');
RESET ROLE;

SELECT tests_jwt('88888888-8888-8888-8888-888888888888');
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'expired caregiver cannot view space name');
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)', 'successor cannot view space name');
RESET ROLE;

-- View member list
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT cmp_ok((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), '>=', 8, 'admin sees all members');
SELECT isnt_empty('SELECT 1 FROM public.child_profiles WHERE family_space_id = (SELECT rivera FROM fx)', 'admin sees child profiles');
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT cmp_ok((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), '>=', 8, 'co admin sees all members');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT cmp_ok((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), '>=', 8, 'teen sees all members');
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT cmp_ok((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), '>=', 8, 'elder sees all members');
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) > 0 FROM public.space_members WHERE user_id = '11111111-1111-1111-1111-111111111111'), 'extended relative sees members in a shared circle');
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '66666666-6666-6666-6666-666666666666'), 1, 'extended relative sees other members of Extended Family');
SELECT is((SELECT count(*)::int FROM public.child_profiles WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 0, 'extended relative does not see a child only in Household');
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), 1, 'caregiver cannot view the member list (own row only)');
SELECT is_empty('SELECT 1 FROM public.child_profiles WHERE family_space_id = (SELECT rivera FROM fx)', 'caregiver cannot see child profiles');
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)), 1, 'successor cannot view the member list (own row only)');
RESET ROLE;

-- Rename
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'The Rivera Household' WHERE id = (SELECT rivera FROM fx);
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Household', 'co admin can rename family space');
UPDATE public.family_spaces SET name = 'The Rivera Family' WHERE id = (SELECT rivera FROM fx);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'Hacked' WHERE id = (SELECT rivera FROM fx);
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Family', 'teen cannot rename family space');
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'Hacked' WHERE id = (SELECT rivera FROM fx);
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Family', 'elder cannot rename');
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'Hacked' WHERE id = (SELECT rivera FROM fx);
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Family', 'extended relative cannot rename');
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'Hacked' WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Family', 'caregiver cannot rename');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
UPDATE public.family_spaces SET name = 'Hacked' WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT name FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 'The Rivera Family', 'successor cannot rename');

-- Invite
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'invitee@example.com', 'teen', c.id
FROM fx
JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'household';
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'admin can invite any role');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
       SELECT rivera, '33333333-3333-3333-3333-333333333333', 'teen-invite@example.com', 'teen', c.id
       FROM fx JOIN public.circles c ON c.family_space_id = fx.rivera AND c.kind = 'household'$sql$,
  '42501',
  NULL,
  'teen cannot invite'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
       SELECT rivera, '44444444-4444-4444-4444-444444444444', 'elder-invite@example.com', 'elder', c.id
       FROM fx JOIN public.circles c ON c.family_space_id = fx.rivera AND c.kind = 'household'$sql$,
  '42501',
  NULL,
  'elder cannot invite'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
       SELECT rivera, '55555555-5555-5555-5555-555555555555', 'ext-invite@example.com', 'teen', c.id
       FROM fx JOIN public.circles c ON c.family_space_id = fx.rivera AND c.kind = 'household'$sql$,
  '42501',
  NULL,
  'extended relative cannot invite'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
       SELECT rivera, '77777777-7777-7777-7777-777777777777', 'care-invite@example.com', 'teen', c.id
       FROM fx JOIN public.circles c ON c.family_space_id = fx.rivera AND c.kind = 'household'$sql$,
  '42501',
  NULL,
  'caregiver cannot invite'
);
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
         VALUES (%L, '99999999-9999-9999-9999-999999999999', 'succ-invite@example.com', 'teen', %L)$sql$,
    (SELECT rivera FROM fx),
    (SELECT household FROM fx)
  ),
  '42501',
  NULL,
  'successor cannot invite'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
SELECT is((SELECT status::text FROM public.invites WHERE email = 'invitee@example.com'), 'revoked', 'co admin can revoke a pending invite');
RESET ROLE;

INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'invitee@example.com', 'teen', c.id
FROM fx
JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'household';

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'teen cannot revoke an invite');

-- D8 Revoke a pending invite: No
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'elder cannot revoke an invite');

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'extended relative cannot revoke an invite');

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'caregiver cannot revoke an invite');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
UPDATE public.invites SET status = 'revoked' WHERE email = 'invitee@example.com' AND status = 'pending';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invites WHERE email = 'invitee@example.com' AND status = 'pending'), 1, 'successor cannot revoke an invite');

-- Child profiles
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Luis', '11111111-1111-1111-1111-111111111111' FROM fx
       RETURNING id$sql$,
  'admin can add a child profile'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Mia', '22222222-2222-2222-2222-222222222222' FROM fx
       RETURNING id$sql$,
  'co admin can add a child profile'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Nope', '33333333-3333-3333-3333-333333333333' FROM fx$sql$,
  '42501',
  NULL,
  'teen cannot add a child profile'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Nope', '44444444-4444-4444-4444-444444444444' FROM fx$sql$,
  '42501',
  NULL,
  'elder cannot add a child profile'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Nope', '55555555-5555-5555-5555-555555555555' FROM fx$sql$,
  '42501',
  NULL,
  'extended relative cannot add a child profile'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Nope', '77777777-7777-7777-7777-777777777777' FROM fx$sql$,
  '42501',
  NULL,
  'caregiver cannot add a child profile'
);
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.child_profiles (family_space_id, display_name, created_by)
       SELECT rivera, 'Nope', '99999999-9999-9999-9999-999999999999' FROM fx$sql$,
  '42501',
  NULL,
  'successor cannot add a child profile'
);
RESET ROLE;

-- Change role
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'elder' WHERE user_id = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 'elder', 'admin can change a member role');
UPDATE public.space_members SET role = 'teen' WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'family_admin' WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 'teen', 'teen cannot change roles');

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'teen' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'elder', 'elder cannot change roles');

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'teen' WHERE user_id = '55555555-5555-5555-5555-555555555555';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555'), 'extended_relative', 'extended relative cannot change roles');

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'teen' WHERE user_id = '77777777-7777-7777-7777-777777777777';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '77777777-7777-7777-7777-777777777777'), 'caregiver', 'caregiver cannot change roles');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'teen' WHERE user_id = '99999999-9999-9999-9999-999999999999';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '99999999-9999-9999-9999-999999999999'), 'successor', 'successor cannot change roles');

-- D8 Remove a member: Yes (family admin) / Leave
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '66666666-6666-6666-6666-666666666666';
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '66666666-6666-6666-6666-666666666666'), 0, 'admin can remove a member');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 1, 'teen cannot remove a member');

-- D8 Remove a member: No
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 1, 'elder cannot remove a member');

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 1, 'extended relative cannot remove a member');

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 1, 'caregiver cannot remove a member');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 1, 'successor cannot remove a member');

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '33333333-3333-3333-3333-333333333333'), 0, 'teen can leave the family space');

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '33333333-3333-3333-3333-333333333333', 'teen' FROM fx;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '22222222-2222-2222-2222-222222222222';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '22222222-2222-2222-2222-222222222222'), 0, 'co admin can leave when another admin remains');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$DELETE FROM public.space_members WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  '23514',
  NULL,
  'last admin cannot leave'
);
RESET ROLE;

-- D7 last remaining Family admin or Co admin cannot self-demote until another admin exists
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$UPDATE public.space_members SET role = 'teen' WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  '23514',
  NULL,
  'last admin cannot change their own role'
);
RESET ROLE;

INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT rivera, '22222222-2222-2222-2222-222222222222', 'co_admin', 'Dad' FROM fx;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'teen' WHERE user_id = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '11111111-1111-1111-1111-111111111111'), 'teen', 'admin can change their own role when another admin remains');
RESET ROLE;
UPDATE public.space_members SET role = 'family_admin' WHERE user_id = '11111111-1111-1111-1111-111111111111';

-- D8 Leave the family space: Yes
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '11111111-1111-1111-1111-111111111111'), 0, 'family admin can leave when another admin remains');
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '11111111-1111-1111-1111-111111111111', 'family_admin' FROM fx;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 0, 'elder can leave the family space');
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '44444444-4444-4444-4444-444444444444', 'elder' FROM fx;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555'), 0, 'extended relative can leave the family space');
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '55555555-5555-5555-5555-555555555555', 'extended_relative' FROM fx;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '77777777-7777-7777-7777-777777777777';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '77777777-7777-7777-7777-777777777777'), 0, 'caregiver can leave the family space');
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '77777777-7777-7777-7777-777777777777', 'caregiver' FROM fx;

-- Custom circles
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.circles (family_space_id, name, kind)
SELECT rivera, 'Care team', 'custom' FROM fx;
SELECT isnt_empty($$SELECT 1 FROM public.circles WHERE name = 'Care team'$$, 'admin can create a custom circle');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.circles (family_space_id, name, kind) SELECT rivera, 'Nope', 'custom' FROM fx$sql$,
  '42501',
  NULL,
  'teen cannot create a custom circle'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.circles (family_space_id, name, kind) SELECT rivera, 'Nope', 'custom' FROM fx$sql$,
  '42501',
  NULL,
  'elder cannot create a custom circle'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.circles (family_space_id, name, kind) SELECT rivera, 'Nope', 'custom' FROM fx$sql$,
  '42501',
  NULL,
  'extended relative cannot create a custom circle'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.circles (family_space_id, name, kind) SELECT rivera, 'Nope', 'custom' FROM fx$sql$,
  '42501',
  NULL,
  'caregiver cannot create a custom circle'
);
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.circles (family_space_id, name, kind) SELECT rivera, 'Nope', 'custom' FROM fx$sql$,
  '42501',
  NULL,
  'successor cannot create a custom circle'
);
RESET ROLE;

-- Default circles per item type
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'extended_family')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'co admin can change default circles per item type'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'household')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
RESET ROLE;
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'teen cannot change default circles'
);

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'household')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
RESET ROLE;
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'caregiver cannot change default circles'
);

-- D8 Change default circles per item type: No
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'household')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
RESET ROLE;
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'elder cannot change default circles'
);

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'household')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
RESET ROLE;
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'extended relative cannot change default circles'
);

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
UPDATE public.circle_item_type_defaults
SET circle_id = (SELECT c.id FROM public.circles c JOIN fx ON c.family_space_id = fx.rivera WHERE c.kind = 'household')
WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo';
RESET ROLE;
SELECT is(
  (
    SELECT c.kind::text
    FROM public.circle_item_type_defaults d
    JOIN public.circles c ON c.id = d.circle_id
    JOIN fx ON d.family_space_id = fx.rivera
    WHERE d.item_type = 'photo'
  ),
  'extended_family',
  'successor cannot change default circles'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'successor', 'admin can name a successor');
UPDATE public.space_members SET role = 'elder' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'elder', 'teen cannot name successors');

-- D8 Name successors: No
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '55555555-5555-5555-5555-555555555555';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555'), 'extended_relative', 'elder cannot name successors');

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'elder', 'extended relative cannot name successors');

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'elder', 'caregiver cannot name successors');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
UPDATE public.space_members SET role = 'successor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
RESET ROLE;
SELECT is((SELECT role::text FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'), 'elder', 'successor cannot name successors');

-- Delete space
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 1, 'teen cannot delete the family space');

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 1, 'elder cannot delete the family space');

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 1, 'extended relative cannot delete the family space');

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 1, 'caregiver cannot delete the family space');

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT rivera FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)), 1, 'successor cannot delete the family space');

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE id = (SELECT other FROM fx);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE id = (SELECT other FROM fx)), 0, 'admin can delete their family space');

-- D8 Delete the family space: Yes (co admin)
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Disposable Co Admin Space', NULL);
RESET ROLE;
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT id, '22222222-2222-2222-2222-222222222222', 'co_admin'
FROM public.family_spaces WHERE name = 'Disposable Co Admin Space';
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
DELETE FROM public.family_spaces WHERE name = 'Disposable Co Admin Space';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.family_spaces WHERE name = 'Disposable Co Admin Space'), 0, 'co admin can delete the family space');

-- Accept once
RESET ROLE;
CREATE TEMP TABLE invite_tok (
  kind text PRIMARY KEY,
  token text NOT NULL
);
INSERT INTO invite_tok (kind, token)
SELECT 'pending', token
FROM public.invites
WHERE email = 'invitee@example.com' AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1;
GRANT SELECT ON TABLE invite_tok TO authenticated, anon;

SELECT tests_jwt('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT public.accept_invite((SELECT token FROM invite_tok WHERE kind = 'pending'));
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 1, 'matching email can accept a pending invite once');
SELECT throws_ok(
  format($sql$SELECT public.accept_invite(%L)$sql$, (SELECT token FROM invite_tok WHERE kind = 'pending')),
  '23505',
  NULL,
  'invite cannot be accepted a second time'
);
RESET ROLE;

INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id, expires_at)
SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'invitee@example.com', 'teen', fx.household, now() - interval '1 day'
FROM fx;
INSERT INTO invite_tok (kind, token)
SELECT 'expired', token
FROM public.invites
WHERE email = 'invitee@example.com' AND expires_at < now()
ORDER BY created_at DESC
LIMIT 1;

SELECT tests_jwt('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format($sql$SELECT public.accept_invite(%L)$sql$, (SELECT token FROM invite_tok WHERE kind = 'expired')),
  '23514',
  NULL,
  'expired invite cannot be accepted'
);
RESET ROLE;

-- D12 revoked (never accepted) invite cannot be accepted
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'invitee@example.com', 'teen', fx.household
FROM fx;
UPDATE public.invites
SET status = 'revoked'
WHERE id = (
  SELECT id FROM public.invites
  WHERE email = 'invitee@example.com' AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1
);
INSERT INTO invite_tok (kind, token)
SELECT 'revoked', token
FROM public.invites
WHERE email = 'invitee@example.com' AND status = 'revoked'
ORDER BY created_at DESC
LIMIT 1;
SELECT tests_jwt('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$SELECT public.accept_invite(%L)$sql$,
    (SELECT token FROM invite_tok WHERE kind = 'revoked')
  ),
  '23514',
  NULL,
  'revoked invite cannot be accepted'
);
RESET ROLE;

SELECT throws_ok(
  $sql$UPDATE public.space_members
       SET caregiver_access_ends_at = now() + interval '40 days'
       WHERE user_id = '77777777-7777-7777-7777-777777777777'$sql$,
  '23514',
  NULL,
  'caregiver access cannot exceed 30 days'
);

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '99999999-9999-9999-9999-999999999999';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.space_members WHERE user_id = '99999999-9999-9999-9999-999999999999'), 0, 'successor can leave the family space');

INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'decline@example.com', 'elder', fx.household
FROM fx;
INSERT INTO invite_tok (kind, token)
SELECT 'declined', token
FROM public.invites
WHERE email = 'decline@example.com' AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1;

SELECT is(
  (SELECT inviter_display_name FROM public.get_invite_preview(
    (SELECT token FROM invite_tok WHERE kind = 'declined')
  )),
  'Elena Rivera',
  'invite preview includes who invited'
);

SELECT public.decline_invite(
  (SELECT token FROM invite_tok WHERE kind = 'declined')
);

SELECT is(
  (SELECT status::text FROM public.invites WHERE email = 'decline@example.com' ORDER BY created_at DESC LIMIT 1),
  'declined',
  'decline invalidates a pending invite'
);

SELECT is_empty(
  format(
    $sql$SELECT * FROM public.get_invite_preview(%L)$sql$,
    (SELECT token FROM invite_tok WHERE kind = 'declined')
  ),
  'declined invite has no preview'
);

SELECT tests_jwt('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$SELECT public.accept_invite(%L)$sql$,
    (SELECT token FROM invite_tok WHERE kind = 'declined')
  ),
  '23514',
  NULL,
  'declined invite cannot be accepted'
);
RESET ROLE;

RESET ROLE;
SELECT tests_create_auth_user(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'autoprofile@example.com',
  'Auto Profile'
);
SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'Auto Profile',
  'new auth user gets a profile automatically'
);

RESET ROLE;

-- CIR05 family key tables and wrap rules (KEYS.md / D21–D23).
CREATE OR REPLACE FUNCTION tests_dummy_box()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(repeat('aa', 80), 'hex');
$$;

CREATE OR REPLACE FUNCTION tests_dummy_pub(p_seed text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(rpad(encode(convert_to(p_seed, 'utf8'), 'hex'), 64, '11'), 'hex');
$$;

GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_pub(text) TO authenticated;

SELECT has_table('public'::name, 'device_keys'::name);
SELECT has_table('public'::name, 'family_key_meta'::name);
SELECT has_table('public'::name, 'family_key_wraps'::name);
SELECT hasnt_table('public'::name, 'recovery_key_wraps'::name);
SELECT has_table('public'::name, 'recovery_public_keys'::name);
SELECT has_table('public'::name, 'family_key_under_recovery'::name);
SELECT has_table('public'::name, 'device_approval_notices'::name);
SELECT has_table('public'::name, 'recovery_contacts'::name);
SELECT has_table('public'::name, 'recovery_contact_secrets'::name);
SELECT has_table('public'::name, 'recovery_pair_wraps'::name);
SELECT has_table('public'::name, 'recovery_requests'::name);
SELECT has_table('public'::name, 'patria_key_settings'::name);

SELECT col_type_is('public'::name, 'device_keys'::name, 'public_key'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'family_key_wraps'::name, 'wrapped_key'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'recovery_public_keys'::name, 'public_key'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'family_key_under_recovery'::name, 'wrapped_family_key'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'recovery_pair_wraps'::name, 'wrapped_recovery_key'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'recovery_contact_secrets'::name, 'wrapped_secret'::name, 'bytea'::name);

SELECT has_table('public'::name, 'recovery_request_helpers'::name);
SELECT has_table('public'::name, 'device_removed_notices'::name);
SELECT has_column(
  'public'::name,
  'recovery_requests'::name,
  'expires_at'::name,
  'recovery requests expire seven days after not_before'
);
SELECT hasnt_column('public'::name, 'recovery_requests'::name, 'printed_code'::name);
SELECT hasnt_column('public'::name, 'recovery_requests'::name, 'printed_code_hash'::name);
SELECT hasnt_column('public'::name, 'recovery_pair_wraps'::name, 'printed_code_hash'::name);
SELECT hasnt_column('public'::name, 'recovery_pair_wraps'::name, 'mnemonic'::name);
SELECT hasnt_column('public'::name, 'family_key_wraps'::name, 'family_key'::name);
SELECT hasnt_column('public'::name, 'recovery_public_keys'::name, 'private_key'::name);
SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        table_name LIKE 'family_key%'
        OR table_name LIKE 'recovery%'
        OR table_name IN ('device_keys', 'device_approval_notices', 'patria_key_settings')
      )
      AND (
        column_name ILIKE '%print%'
        OR column_name ILIKE '%mnemonic%'
        OR column_name ILIKE '%paper%'
        OR column_name ILIKE '%verifier%'
      )
  ),
  0,
  'no printed-code hash or verifier columns'
);

SELECT is(
  public.recovery_wait_interval(),
  interval '48 hours',
  'recovery wait default is exactly 48 hours'
);
SELECT is(
  (SELECT recovery_wait FROM public.patria_key_settings WHERE singleton = 1),
  interval '48 hours',
  'patria_key_settings.recovery_wait defaults to 48 hours'
);

INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'd1111111-1111-1111-1111-111111111111',
    tests_dummy_pub('elena-1')
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'd1111111-1111-1111-1111-111111111112',
    tests_dummy_pub('elena-2')
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'd2222222-2222-2222-2222-222222222221',
    tests_dummy_pub('marco-1')
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'd2222222-2222-2222-2222-222222222222',
    tests_dummy_pub('marco-2')
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'd3333333-3333-3333-3333-333333333331',
    tests_dummy_pub('jordan-1')
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'd4444444-4444-4444-4444-444444444441',
    tests_dummy_pub('rosa-1')
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'd5555555-5555-5555-5555-555555555551',
    tests_dummy_pub('cousin-1')
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    tests_dummy_pub('other-1')
  ),
  (
    '77777777-7777-7777-7777-777777777777',
    'd7777777-7777-7777-7777-777777777771',
    tests_dummy_pub('sitter-1')
  ),
  (
    '99999999-9999-9999-9999-999999999999',
    'd9999999-9999-9999-9999-999999999991',
    tests_dummy_pub('heir-1')
  );

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_meta (family_space_id, key_epoch, recovery_key_epoch)
       SELECT rivera, 1, 1 FROM fx$sql$,
  'admin can insert family key metadata'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111111',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'founding admin can wrap their own first device'
);
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_public_keys (
         family_space_id, user_id, public_key, recovery_key_epoch
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                tests_dummy_pub('elena-rk'), 1
       FROM fx$sql$,
  'founding admin can store their recovery public key'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_under_recovery (
         family_space_id, user_id, key_epoch, wrapped_family_key
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111', 1, tests_dummy_box() FROM fx$sql$,
  'admin can store family key sealed to their recovery public key'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222221',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can wrap another member first device'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '33333333-3333-3333-3333-333333333333',
                'd3333333-3333-3333-3333-333333333331',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can wrap a teen first device'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '44444444-4444-4444-4444-444444444444',
                'd4444444-4444-4444-4444-444444444441',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can wrap an elder first device'
);
RESET ROLE;
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT user_id FROM public.eligible_recovery_contacts(
         (SELECT rivera FROM fx)
       )
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'elder sees a let-in family admin as an eligible recovery contact'
);
SELECT throws_ok(
  $sql$SELECT device_id FROM public.approved_devices_for_member(
         (SELECT rivera FROM fx),
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'elder cannot list another member''s approved devices'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'elder cannot read another member wrap'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.device_keys
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'elder cannot read another member device'
);
RESET ROLE;
SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.eligible_recovery_contacts(
         (SELECT rivera FROM fx)
       )$sql$,
  'caregiver gets no eligible recovery contacts'
);
SELECT throws_ok(
  $sql$SELECT device_id FROM public.approved_devices_for_member(
         (SELECT rivera FROM fx),
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'caregiver cannot list another member''s let-in devices'
);
RESET ROLE;
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '55555555-5555-5555-5555-555555555555',
                'd5555555-5555-5555-5555-555555555551',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'admin cannot wrap an extended relative'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '77777777-7777-7777-7777-777777777777',
                'd7777777-7777-7777-7777-777777777771',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'admin cannot wrap a caregiver'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '99999999-9999-9999-9999-999999999999',
                'd9999999-9999-9999-9999-999999999991',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'admin cannot wrap a successor'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, 'cccccccc-cccc-cccc-cccc-cccccccccccc',
                'd1111111-1111-1111-1111-111111111111',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'children have no device wraps'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222222',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'admin cannot wrap another member extra device'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111111',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '23505',
  NULL,
  'wrap unique key prevents overwrite or replay'
);
SELECT table_privs_are(
  'public'::name,
  'family_key_wraps'::name,
  'authenticated'::name,
  ARRAY['INSERT', 'SELECT']::text[],
  'family key wraps are insert and select only for authenticated'
);
SELECT table_privs_are(
  'public'::name,
  'recovery_public_keys'::name,
  'authenticated'::name,
  ARRAY['DELETE', 'INSERT', 'SELECT']::text[],
  'recovery public keys are insert select and delete for authenticated'
);
SELECT throws_ok(
  $sql$INSERT INTO public.recovery_public_keys (
         family_space_id, user_id, public_key, recovery_key_epoch
       ) SELECT rivera, '33333333-3333-3333-3333-333333333333',
                tests_dummy_pub('jordan-rk'), 1
       FROM fx$sql$,
  '42501',
  NULL,
  'cannot store another member recovery public key'
);
SELECT is(
  (SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'admin cannot read another member family key wrap'
);
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_requests (family_space_id, user_id, new_device_id, not_before)
       SELECT rivera, '11111111-1111-1111-1111-111111111111',
              'd1111111-1111-1111-1111-111111111112',
              now() - interval '1 hour'
       FROM fx$sql$,
  'member can open a recovery request'
);
SELECT ok(
  (
    SELECT not_before - started_at = interval '48 hours'
    FROM public.recovery_requests
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'server stamps not_before as now plus 48 hours ignoring the client'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_under_recovery$sql$,
  'sealed family key under recovery is hidden before not_before'
);
SELECT throws_ok(
  $sql$SELECT public.complete_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE user_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)
       )$sql$,
  '42501',
  NULL,
  'recovery cannot complete before not_before'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222222',
                tests_dummy_box(), 1, '22222222-2222-2222-2222-222222222222'
       FROM fx$sql$,
  'member can wrap their own extra device'
);
SELECT is(
  (SELECT count(*)::integer FROM public.family_key_wraps),
  2,
  'member reads only their own family key wraps'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'member cannot read another member wrap'
);
RESET ROLE;

-- Co-admin wrapping teen extra would be unique fail if teen already wrapped; use cousin device as extra for jordan is wrong user.
-- Co-admin trying to wrap marco extra already covered as admin. Co-admin wrapping jordan extra:
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'd3333333-3333-3333-3333-333333333332',
  tests_dummy_pub('jordan-2')
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '33333333-3333-3333-3333-333333333333',
                'd3333333-3333-3333-3333-333333333332',
                tests_dummy_box(), 1, '22222222-2222-2222-2222-222222222222'
       FROM fx$sql$,
  '42501',
  NULL,
  'co admin cannot wrap another member extra device'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '44444444-4444-4444-4444-444444444444',
                'd4444444-4444-4444-4444-444444444441',
                tests_dummy_box(), 1, '33333333-3333-3333-3333-333333333333'
       FROM fx$sql$,
  '42501',
  NULL,
  'teen cannot wrap another member'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'teen cannot read an admin wrap'
);
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE family_space_id = (SELECT rivera FROM fx)$sql$,
  'other family cannot read Rivera wraps'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
                tests_dummy_box(), 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       FROM fx$sql$,
  '42501',
  NULL,
  'other family cannot insert a wrap into Rivera'
);
SELECT throws_ok(
  $sql$UPDATE public.patria_key_settings SET recovery_wait = interval '1 second'$sql$,
  '42501',
  NULL,
  'authenticated clients cannot shorten the recovery wait'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE user_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)
       )$sql$,
  'requester can cancel recovery'
);
SELECT throws_ok(
  $sql$SELECT public.complete_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE user_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)
       )$sql$,
  '42501',
  NULL,
  'cancelled recovery cannot be completed'
);
RESET ROLE;

UPDATE public.patria_key_settings SET recovery_wait = interval '2 minutes';
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_requests (family_space_id, user_id, new_device_id)
       SELECT rivera, '33333333-3333-3333-3333-333333333333',
              'd3333333-3333-3333-3333-333333333332'
       FROM fx$sql$,
  'recovery request can be created while wait is lowered for tests'
);
RESET ROLE;
SELECT ok(
  (
    SELECT not_before - started_at = interval '2 minutes'
    FROM public.recovery_requests
    WHERE user_id = '33333333-3333-3333-3333-333333333333'
  ),
  'superuser can lower recovery wait on this project for tests'
);
UPDATE public.patria_key_settings SET recovery_wait = interval '48 hours';
SELECT is(
  public.recovery_wait_interval(),
  interval '48 hours',
  'recovery wait restored to 48 hours'
);

-- Remove Marco; wraps must go and he must read nothing.
DELETE FROM public.space_members
WHERE user_id = '22222222-2222-2222-2222-222222222222'
  AND family_space_id = (SELECT rivera FROM fx);

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps$sql$,
  'removed member cannot read family key wraps'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = '22222222-2222-2222-2222-222222222222'
  ),
  0,
  'member removal deletes that member wraps'
);

-- Restore Marco so later D8 tests that expect the co-admin still work.
INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT rivera, '22222222-2222-2222-2222-222222222222', 'co_admin', 'Dad' FROM fx;
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SELECT public.ensure_only_me_circle(
  (SELECT rivera FROM fx),
  '22222222-2222-2222-2222-222222222222'
);

-- Other family was deleted in the D8 delete-space checks. Recreate it so
-- the founding ceremony can run against a live space that has no key yet.
RESET ROLE;
INSERT INTO public.family_spaces (id, name, created_by)
SELECT other, 'The Other Family', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
FROM fx;
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT other, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'family_admin'
FROM fx;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.commit_family_key_ceremony(
         (SELECT other FROM fx),
         'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
         tests_dummy_pub('other-1'),
         tests_dummy_box(),
         1
       )$sql$,
  'admin of that space can commit founding keys atomically'
);
SELECT throws_ok(
  $sql$SELECT public.commit_family_key_ceremony(
         (SELECT other FROM fx),
         'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
         tests_dummy_pub('other-1'),
         tests_dummy_box(),
         1
       )$sql$,
  '23505',
  NULL,
  'only one family key per space and epoch'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.commit_family_key_ceremony(
         (SELECT other FROM fx),
         'd1111111-1111-1111-1111-111111111111',
         tests_dummy_pub('elena-1'),
         tests_dummy_box(),
         1
       )$sql$,
  '42501',
  NULL,
  'cannot commit founding keys for another family'
);
SELECT throws_ok(
  $sql$SELECT public.commit_family_key_ceremony(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111111',
         tests_dummy_pub('elena-1'),
         tests_dummy_box(),
         1
       )$sql$,
  '23505',
  NULL,
  'second founding ceremony for the same space fails'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.commit_family_key_ceremony(
         (SELECT rivera FROM fx),
         'd3333333-3333-3333-3333-333333333331',
         tests_dummy_pub('jordan-1'),
         tests_dummy_box(),
         1
       )$sql$,
  '42501',
  NULL,
  'teen cannot commit founding keys'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.family_key_meta WHERE family_space_id = (SELECT other FROM fx)),
  1,
  'other family has exactly one key meta row after a successful ceremony'
);

RESET ROLE;
INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    tests_dummy_pub('invitee-1')
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    tests_dummy_pub('invitee-2')
  );
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'teen' FROM fx;

SELECT tests_jwt('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
       SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
       FROM fx$sql$,
  'key eligible member can request a first-device notice'
);
SELECT throws_ok(
  $sql$INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
       SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
       FROM fx$sql$,
  '23505',
  NULL,
  'only one approval notice per device in a family'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
                tests_dummy_box(), 1, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       FROM fx$sql$,
  '42501',
  NULL,
  'members cannot approve themselves'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
       SELECT rivera, '55555555-5555-5555-5555-555555555555',
              'd5555555-5555-5555-5555-555555555551'
       FROM fx$sql$,
  '42501',
  NULL,
  'ineligible roles cannot create an approval notice'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'cannot approve a first device in another family'
);
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
                tests_dummy_box(), 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       FROM fx$sql$,
  'only admins of that family can approve a first device'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND device_id = 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
  ),
  1,
  'Yes: admin can approve a key-eligible member first device'
);
SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
                tests_dummy_box(), 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       FROM fx$sql$,
  '42501',
  NULL,
  'approval is only for a first device of a key eligible member'
);
RESET ROLE;
INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
SELECT other, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
       'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
FROM fx;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
DELETE FROM public.device_approval_notices
WHERE device_id = 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer FROM public.device_approval_notices
    WHERE device_id = 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
  ),
  1,
  'cross family notice delete fails'
);

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$DELETE FROM public.device_approval_notices
       WHERE device_id = 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
          OR device_id = 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'$sql$,
  'admin can close a first-device notice'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '77777777-7777-7777-7777-777777777777',
                'd7777777-7777-7777-7777-777777777771',
                tests_dummy_box(), 1, '77777777-7777-7777-7777-777777777777'
       FROM fx$sql$,
  '42501',
  NULL,
  'no wrap for ineligible roles'
);
RESET ROLE;

SELECT has_column(
  'public'::name,
  'device_keys'::name,
  'rejected_at'::name,
  'rejected extra devices are marked on device_keys'
);
SELECT has_column(
  'public'::name,
  'device_approval_notices'::name,
  'kind'::name,
  'approval notices distinguish first, extra, and rejected'
);

RESET ROLE;
INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'd1111111-1111-1111-1111-111111111113',
    tests_dummy_pub('elena-3')
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'd2222222-2222-2222-2222-222222222223',
    tests_dummy_pub('marco-3')
  );

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111112',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'only the same user can wrap to their additional device'
);
SELECT lives_ok(
  $sql$INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
       SELECT rivera, '11111111-1111-1111-1111-111111111111',
              'd1111111-1111-1111-1111-111111111113'
       FROM fx$sql$,
  'member can request an extra-device notice'
);
SELECT is(
  (
    SELECT kind FROM public.device_approval_notices
    WHERE device_id = 'd1111111-1111-1111-1111-111111111113'
  ),
  'extra_device',
  'extra-device notices are stamped extra_device'
);
SELECT lives_ok(
  $sql$SELECT public.reject_own_pending_device(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111113'
       )$sql$,
  'member can reject a pending extra device'
);
SELECT is(
  (
    SELECT kind FROM public.device_approval_notices
    WHERE device_id = 'd1111111-1111-1111-1111-111111111113'
  ),
  'rejected_device',
  'rejected extra devices notify as rejected_device'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111113',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'a rejected device can never be wrapped'
);
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222221',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can wrap the restored member first device'
);
SELECT throws_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222223',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'admins cannot wrap another member additional device'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222222',
                tests_dummy_box(), 1, '22222222-2222-2222-2222-222222222222'
       FROM fx$sql$,
  'member extra-device wrap after restore still works'
);
SELECT throws_ok(
  $sql$SELECT public.remove_own_device(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'another user cannot remove your device'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.remove_own_device(
         (SELECT rivera FROM fx),
         'd2222222-2222-2222-2222-222222222221'
       )$sql$,
  '42501',
  NULL,
  'owner-only removal cannot target another member device'
);
SELECT lives_ok(
  $sql$SELECT public.remove_own_device(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111112'
       )$sql$,
  'member can remove another of their own devices'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND device_id = 'd1111111-1111-1111-1111-111111111112'
  ),
  0,
  'removal deletes only that device wraps'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND device_id = 'd1111111-1111-1111-1111-111111111111'
  ),
  1,
  'removal leaves this phone wrap in place'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.device_keys
       WHERE device_id = 'd1111111-1111-1111-1111-111111111112'$sql$,
  'removal deletes that device public key'
);

SELECT has_column(
  'public'::name,
  'recovery_contacts'::name,
  'status'::name,
  'recovery contacts have an accept status'
);

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.recovery_contacts (
         family_space_id, member_id, user_id, slot, created_by
       ) SELECT rivera, '77777777-7777-7777-7777-777777777777',
                '44444444-4444-4444-4444-444444444444',
                'a', '77777777-7777-7777-7777-777777777777'
       FROM fx$sql$,
  '42501',
  NULL,
  'caregivers cannot create recovery contacts'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.recovery_contacts (
         family_space_id, member_id, user_id, slot, created_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                '33333333-3333-3333-3333-333333333333',
                'a', '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  '42501',
  NULL,
  'ineligible roles cannot be recovery contacts'
);
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_contacts (
         family_space_id, member_id, user_id, slot, created_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222',
                'a', '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can invite an eligible co admin as a recovery contact'
);
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_contacts (
         family_space_id, member_id, user_id, slot, created_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                '44444444-4444-4444-4444-444444444444',
                'b', '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'admin can invite an eligible elder as a recovery contact'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.recovery_contacts SET status = 'accepted'
       WHERE user_id = '22222222-2222-2222-2222-222222222222'$sql$,
  'contact can accept their invite'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_contact_secrets (
         family_space_id, member_id, user_id, device_id, wrapped_secret, recovery_key_epoch
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222',
                'd2222222-2222-2222-2222-222222222221',
                tests_dummy_box(), 1
       FROM fx$sql$,
  'admin can wrap a holder secret after accept'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.recovery_contact_secrets$sql$,
  'admin cannot read another member holder secret'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.recovery_contact_secrets),
  1,
  'a contact reads only their own secret'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.recovery_contact_secrets$sql$,
  'the other contact cannot read this holder secret'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.recovery_contacts SET status = 'accepted'
       WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'elder contact can accept'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.recovery_contacts (
         family_space_id, member_id, user_id, slot, created_by
       ) SELECT rivera, '44444444-4444-4444-4444-444444444444',
                '11111111-1111-1111-1111-111111111111',
                'a', '44444444-4444-4444-4444-444444444444'
       FROM fx$sql$,
  'elder can name a let-in family admin as their recovery contact'
);
RESET ROLE;
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.recovery_contacts SET status = 'accepted'
       WHERE member_id = '44444444-4444-4444-4444-444444444444'
         AND user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'family admin can accept as the elder''s recovery contact'
);
RESET ROLE;
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT device_id FROM public.recovery_contact_public_keys(
         (SELECT rivera FROM fx),
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'elder can fetch an accepted contact''s let-in public keys'
);
SELECT is_empty(
  $sql$SELECT device_id FROM public.recovery_contact_public_keys(
         (SELECT rivera FROM fx),
         '22222222-2222-2222-2222-222222222222'
       )$sql$,
  'elder cannot fetch keys for someone who is not their accepted contact'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'elder still cannot read another member wrap'
);
RESET ROLE;
SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT device_id FROM public.recovery_contact_public_keys(
         (SELECT rivera FROM fx),
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'caregiver gets no recovery contact public keys'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111114'::uuid,
         tests_dummy_pub('elena-4')
       )$sql$,
  'requester can start recovery'
);
RESET ROLE;
SELECT ok(
  (
    SELECT expires_at = not_before + interval '7 days'
    FROM public.recovery_requests
    WHERE new_device_id = 'd1111111-1111-1111-1111-111111111114'
  ),
  'server stamps expires_at as not_before plus 7 days'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111114')
       )$sql$,
  'requester can cancel recovery from their account'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111115'::uuid,
         tests_dummy_pub('elena-5')
       )$sql$,
  'requester can start a new recovery request'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111116'::uuid,
         tests_dummy_pub('elena-6')
       )$sql$,
  'starting a new request is allowed'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer FROM public.recovery_requests
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND completed_at IS NULL
      AND cancelled_at IS NULL
  ),
  1,
  'starting a new recovery request cancels the previous open one'
);

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111116')
       )$sql$,
  'an accepted recovery contact can cancel (helper This wasn’t me)'
);
RESET ROLE;
SELECT is(
  (
    SELECT cancelled_by FROM public.recovery_requests
    WHERE new_device_id = 'd1111111-1111-1111-1111-111111111116'
  ),
  '44444444-4444-4444-4444-444444444444',
  'contact cancel records cancelled_by as that accepted contact'
);
SELECT ok(
  (
    SELECT cancelled_at IS NOT NULL
    FROM public.recovery_requests
    WHERE new_device_id = 'd1111111-1111-1111-1111-111111111116'
  ),
  'contact cancel only applies to an open request (marks cancelled_at)'
);
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.recovery_events
       WHERE user_id = '11111111-1111-1111-1111-111111111111'
         AND event_type = 'recovery cancelled'
         AND detail LIKE '%44444444-4444-4444-4444-444444444444%'$sql$,
  'contact cancel records a recovery event the member can read (notified)'
);
SELECT throws_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111116')
       )$sql$,
  '42501',
  NULL,
  'cannot cancel a request that is already cancelled'
);
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111117'::uuid,
         tests_dummy_pub('elena-7')
       )$sql$,
  'requester can start again after contact cancel'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111117')
       )$sql$,
  '42501',
  NULL,
  'another family member who is not an admin cannot cancel'
);
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111117')
       )$sql$,
  '42501',
  NULL,
  'other family cannot cancel recovery'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.approve_recovery_helper(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111117'),
         'b',
         tests_dummy_box()
       )$sql$,
  '42501',
  NULL,
  'contacts cannot approve before not_before'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.cancel_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111117')
       )$sql$,
  'a family admin can cancel recovery'
);
RESET ROLE;
SELECT is(
  (
    SELECT cancelled_by FROM public.recovery_requests
    WHERE new_device_id = 'd1111111-1111-1111-1111-111111111117'
  ),
  '22222222-2222-2222-2222-222222222222',
  'cancel records who cancelled'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111118'::uuid,
         tests_dummy_pub('elena-8')
       )$sql$,
  'requester can start recovery to complete'
);
RESET ROLE;

UPDATE public.recovery_requests
SET not_before = now() - interval '1 hour',
    expires_at = now() + interval '6 days'
WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118';

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT device_id FROM public.recovery_request_device_public_key(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118')
       )$sql$,
  'accepted contact can fetch the new phone public key'
);
RESET ROLE;
SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT device_id FROM public.recovery_request_device_public_key(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118')
       )$sql$,
  'caregiver gets no recovery request device public key'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.complete_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118')
       )$sql$,
  '42501',
  NULL,
  'complete without a helper wrap is refused'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.approve_recovery_helper(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118'),
         'b',
         tests_dummy_box()
       )$sql$,
  'accepted contact can approve after not_before'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.family_key_wraps (
         family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
       ) SELECT rivera, '11111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111118',
                tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
       FROM fx$sql$,
  'new device can record its wrap after reconstructing locally'
);
SELECT lives_ok(
  $sql$SELECT public.complete_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118')
       )$sql$,
  'requester can complete after a helper and a wrap'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND device_id = 'd1111111-1111-1111-1111-111111111111'
  ),
  1,
  'complete does not revoke old devices'
);
SELECT ok(
  (
    SELECT completed_at IS NOT NULL FROM public.recovery_requests
    WHERE new_device_id = 'd1111111-1111-1111-1111-111111111118'
  ),
  'complete marks the request complete'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.start_recovery_request(
         (SELECT rivera FROM fx),
         'd1111111-1111-1111-1111-111111111119'::uuid,
         tests_dummy_pub('elena-9')
       )$sql$,
  'requester can start a request used for expiry'
);
RESET ROLE;

UPDATE public.recovery_requests
SET not_before = now() - interval '8 days',
    expires_at = now() - interval '1 second'
WHERE new_device_id = 'd1111111-1111-1111-1111-111111111119';

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.approve_recovery_helper(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111119'),
         'b',
         tests_dummy_box()
       )$sql$,
  '42501',
  NULL,
  'expired requests cannot be approved'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.complete_recovery_request(
         (SELECT id FROM public.recovery_requests
          WHERE new_device_id = 'd1111111-1111-1111-1111-111111111119')
       )$sql$,
  '42501',
  NULL,
  'expired requests cannot be completed'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.device_removed_notices
    WHERE device_id = 'd1111111-1111-1111-1111-111111111112'
  ),
  1,
  'removing a phone notifies admins'
);

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.device_removed_notices$sql$,
  'other family cannot read device-removed notices'
);
RESET ROLE;

UPDATE public.family_spaces
SET rotation_needed = false
WHERE id = (SELECT rivera FROM fx);
INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
) SELECT rivera, '44444444-4444-4444-4444-444444444444',
         'd4444444-4444-4444-4444-444444444441',
         tests_dummy_box(), 2, '11111111-1111-1111-1111-111111111111'
FROM fx;
INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'd4444444-4444-4444-4444-444444444442',
  tests_dummy_pub('elder-leave')
)
ON CONFLICT DO NOTHING;
INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       'd4444444-4444-4444-4444-444444444441'
FROM fx
ON CONFLICT DO NOTHING;
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
INSERT INTO public.recovery_requests (family_space_id, user_id, new_device_id)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       'd4444444-4444-4444-4444-444444444442'
FROM fx;
SELECT lives_ok(
  $sql$DELETE FROM public.space_members WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'elder can self-leave'
);
RESET ROLE;
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'self-leave deletes wraps at every epoch'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.device_keys
       WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'self-leave keeps the account device key pair'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.device_approval_notices
       WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'self-leave removes this family device notices'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.recovery_contacts
       WHERE user_id = '44444444-4444-4444-4444-444444444444'
          OR member_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'self-leave drops the person as a recovery contact'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.recovery_requests
    WHERE user_id = '44444444-4444-4444-4444-444444444444'
      AND cancelled_at IS NOT NULL
      AND completed_at IS NULL
  ),
  1,
  'self-leave cancels open recovery requests'
);
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  true,
  'self-leave of a key holder flags rotation'
);
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '44444444-4444-4444-4444-444444444444', 'elder' FROM fx;
INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
) SELECT rivera, '44444444-4444-4444-4444-444444444444',
         'd4444444-4444-4444-4444-444444444441',
         tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
FROM fx;
INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, created_by, status
) SELECT rivera, '11111111-1111-1111-1111-111111111111',
         '44444444-4444-4444-4444-444444444444',
         'b', '11111111-1111-1111-1111-111111111111', 'accepted'
FROM fx;
UPDATE public.family_spaces
SET rotation_needed = false
WHERE id = (SELECT rivera FROM fx);
SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$DELETE FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555'$sql$,
  'extended relative can self-leave'
);
RESET ROLE;
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  false,
  'self-leave of a non key holder does not flag rotation'
);
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, '55555555-5555-5555-5555-555555555555', 'extended_relative' FROM fx;

UPDATE public.family_spaces
SET rotation_needed = false
WHERE id = (SELECT rivera FROM fx);
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  false,
  'rotation is not needed before a key holder leaves'
);
SELECT lives_ok(
  $sql$DELETE FROM public.space_members
       WHERE family_space_id = (SELECT rivera FROM fx)
         AND user_id = '55555555-5555-5555-5555-555555555555'$sql$,
  'extended relative can be removed without key rotation'
);
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  false,
  'removing a non key holder does not flag rotation'
);
SELECT lives_ok(
  $sql$DELETE FROM public.space_members
       WHERE family_space_id = (SELECT rivera FROM fx)
         AND user_id = '22222222-2222-2222-2222-222222222222'$sql$,
  'admin can remove a key holder'
);
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  true,
  'removing a key holder flags rotation'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps
       WHERE user_id = '22222222-2222-2222-2222-222222222222'$sql$,
  'removed key holder wraps are deleted'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.space_members
       WHERE family_space_id = (SELECT rivera FROM fx)
         AND user_id = '22222222-2222-2222-2222-222222222222'$sql$,
  'removed key holder membership row is gone'
);
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)$sql$,
  'removed member cannot read the family space'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.space_members WHERE family_space_id = (SELECT rivera FROM fx)$sql$,
  'removed member cannot read family members'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps WHERE family_space_id = (SELECT rivera FROM fx)$sql$,
  'removed member cannot read family wraps'
);
RESET ROLE;
SELECT is_empty(
  $sql$SELECT 1 FROM public.recovery_contacts
       WHERE user_id = '22222222-2222-2222-2222-222222222222'
          OR member_id = '22222222-2222-2222-2222-222222222222'$sql$,
  'removed person is dropped as a recovery contact'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.recovery_public_keys
       WHERE user_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'remaining member recovery public key stays until they redo'
);
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT rivera FROM fx),
         (SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = (SELECT rivera FROM fx)),
         COALESCE(ARRAY_AGG(t.user_id ORDER BY t.user_id, t.device_id), ARRAY[]::uuid[]),
         COALESCE(ARRAY_AGG(t.device_id ORDER BY t.user_id, t.device_id), ARRAY[]::uuid[]),
         COALESCE(ARRAY_AGG(tests_dummy_box() ORDER BY t.user_id, t.device_id), ARRAY[]::bytea[]),
         COALESCE(
           (SELECT ARRAY_AGG(r.user_id ORDER BY r.user_id)
            FROM public.recovery_public_keys AS r
            WHERE r.family_space_id = (SELECT rivera FROM fx)),
           ARRAY[]::uuid[]
         ),
         COALESCE(
           (SELECT ARRAY_AGG(tests_dummy_box() ORDER BY r.user_id)
            FROM public.recovery_public_keys AS r
            WHERE r.family_space_id = (SELECT rivera FROM fx)),
           ARRAY[]::bytea[]
         )
       )
       FROM public.rotation_wrap_targets((SELECT rivera FROM fx)) AS t$sql$,
  'admin can rotate remaining wraps and sealed boxes'
);
RESET ROLE;
SELECT is(
  (SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = (SELECT rivera FROM fx)),
  2,
  'rotation advances the family key epoch'
);
SELECT is(
  (SELECT rotation_needed FROM public.family_spaces WHERE id = (SELECT rivera FROM fx)),
  false,
  'successful rotation clears the flag'
);
INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT rivera, '22222222-2222-2222-2222-222222222222', 'co_admin', 'Dad' FROM fx;
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.family_key_wraps WHERE key_epoch = 2$sql$,
  'removed then restored member cannot read the new epoch wrap'
);
RESET ROLE;

-- D8 Yes cells as the signed-in admin, including RETURNING (how the app writes).
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
       SELECT fx.rivera, '11111111-1111-1111-1111-111111111111', 'd8-yes@example.com', 'teen', c.id
       FROM fx
       JOIN public.circles AS c ON c.family_space_id = fx.rivera AND c.kind = 'household'
       RETURNING id$sql$,
  'admin can invite a member (RETURNING)'
);
SELECT lives_ok(
  $sql$UPDATE public.invites SET status = 'revoked'
       WHERE email = 'd8-yes@example.com' AND status = 'pending'
       RETURNING id$sql$,
  'admin can revoke a pending invite (RETURNING)'
);
SELECT lives_ok(
  $sql$UPDATE public.space_members SET role = 'teen'
       WHERE user_id = '33333333-3333-3333-3333-333333333333'
       RETURNING id$sql$,
  'admin can change a member role (RETURNING)'
);
SELECT lives_ok(
  $sql$DELETE FROM public.space_members
       WHERE user_id = '55555555-5555-5555-5555-555555555555'
       RETURNING id$sql$,
  'admin can remove a member (RETURNING)'
);
SELECT lives_ok(
  $sql$UPDATE public.family_spaces SET name = 'The Rivera Family'
       WHERE id = (SELECT rivera FROM fx)
       RETURNING id$sql$,
  'admin can rename the family space (RETURNING)'
);
SELECT lives_ok(
  $sql$UPDATE public.circle_item_type_defaults
       SET circle_id = circle_id
       WHERE family_space_id = (SELECT rivera FROM fx) AND item_type = 'photo'
       RETURNING id$sql$,
  'admin can change default circles per item type (RETURNING)'
);
SELECT lives_ok(
  $sql$UPDATE public.space_members SET role = 'successor'
       WHERE user_id = '44444444-4444-4444-4444-444444444444'
       RETURNING id$sql$,
  'admin can name a successor (RETURNING)'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.family_spaces SET name = 'The Rivera Family'
       WHERE id = (SELECT rivera FROM fx)
       RETURNING id$sql$,
  'co admin can rename the family space (RETURNING)'
);
RESET ROLE;

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
