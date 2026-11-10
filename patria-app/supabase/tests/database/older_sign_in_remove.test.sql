-- pgTAP: remove a second device (older sign-in on the phone) — wraps gone, notice written,
-- other members cannot remove it. Client "Older sign in" labeling is covered in unit tests.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(8);

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

CREATE OR REPLACE FUNCTION tests_dummy_box()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('aa', 80), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_pub(p_seed text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT decode(rpad(encode(convert_to(p_seed, 'utf8'), 'hex'), 64, '11'), 'hex');
$$;

GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_pub(text) TO authenticated;

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-older@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-older@example.com', 'Marco');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Older Sign In Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'Older Sign In Family') AS space_id;
GRANT SELECT ON TABLE fx TO authenticated, anon;

-- Invite Marco as elder so he is a family member who must not remove Elena's device.
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'marco-older@example.com',
  'elder',
  (SELECT id FROM public.circles WHERE family_space_id = space_id AND kind = 'household' LIMIT 1)
FROM fx;
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.accept_invite((SELECT token FROM public.invites WHERE email = 'marco-older@example.com' LIMIT 1));
RESET ROLE;

-- Elena: current phone + older phone (second device identity on the server).
INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    tests_dummy_pub('elena-1')
  ),
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111112'::uuid,
    tests_dummy_pub('elena-2')
  );

INSERT INTO public.family_key_meta (family_space_id, key_epoch)
SELECT space_id, 1 FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111111'::uuid,
  tests_dummy_box(),
  1,
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx;
INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111112'::uuid,
  tests_dummy_box(),
  1,
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx;

INSERT INTO public.personal_key_wraps (
  family_space_id, user_id, device_id, wrapped_key
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111111'::uuid,
  tests_dummy_box()
FROM fx;
INSERT INTO public.personal_key_wraps (
  family_space_id, user_id, device_id, wrapped_key
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111112'::uuid,
  tests_dummy_box()
FROM fx;

-- (c) Other member cannot remove Elena's older phone.
SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.remove_own_device(
         (SELECT space_id FROM fx),
         'd1111111-1111-1111-1111-111111111112'
       )$sql$,
  '42501',
  NULL,
  'other member cannot remove Elena older phone'
);
-- Other member also cannot see Elena's personal wraps.
SELECT is(
  (
    SELECT count(*)::integer FROM public.personal_key_wraps
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
  ),
  0,
  'other member cannot read Elena personal wraps'
);
RESET ROLE;

-- (b) Owner removes the older phone: wraps gone + device_removed_notices row.
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.remove_own_device(
         (SELECT space_id FROM fx),
         'd1111111-1111-1111-1111-111111111112'
       )$sql$,
  'owner can remove their older phone'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE device_id = 'd1111111-1111-1111-1111-111111111112'
  ),
  0,
  'removing older phone deletes its family wrap'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.personal_key_wraps
    WHERE device_id = 'd1111111-1111-1111-1111-111111111112'
  ),
  0,
  'removing older phone deletes its personal wrap'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.device_keys
    WHERE device_id = 'd1111111-1111-1111-1111-111111111112'
  ),
  0,
  'removing older phone deletes its device key'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.device_removed_notices
    WHERE device_id = 'd1111111-1111-1111-1111-111111111112'
      AND user_id = '11111111-1111-1111-1111-111111111111'
  ),
  1,
  'removing older phone records a device_removed_notices event'
);
SELECT is(
  (
    SELECT count(*)::integer FROM public.family_key_wraps
    WHERE device_id = 'd1111111-1111-1111-1111-111111111111'
  ),
  1,
  'current phone wrap stays after older phone is removed'
);

SELECT * FROM finish();
ROLLBACK;
