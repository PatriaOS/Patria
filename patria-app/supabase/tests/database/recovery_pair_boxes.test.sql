-- pgTAP: commit_recovery_repair writes ab + event + contact notices; refuse open request.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(10);

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

SELECT has_function('public'::name, 'commit_recovery_repair'::name);
SELECT has_table('public'::name, 'recovery_events'::name);
SELECT has_table('public'::name, 'recovery_helper_refresh_notices'::name);

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-pair@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-pair@example.com', 'Marco');
SELECT tests_create_auth_user('33333333-3333-3333-3333-333333333333', 'rosa-pair@example.com', 'Rosa');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Pair Boxes Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'Pair Boxes Family') AS space_id;
GRANT SELECT ON TABLE fx TO authenticated, anon;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'marco-pair@example.com',
  'elder',
  (SELECT id FROM public.circles WHERE family_space_id = space_id AND kind = 'household' LIMIT 1)
FROM fx;
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'rosa-pair@example.com',
  'elder',
  (SELECT id FROM public.circles WHERE family_space_id = space_id AND kind = 'household' LIMIT 1)
FROM fx;
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.accept_invite((SELECT token FROM public.invites WHERE email = 'marco-pair@example.com' LIMIT 1));
RESET ROLE;
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT public.accept_invite((SELECT token FROM public.invites WHERE email = 'rosa-pair@example.com' LIMIT 1));
RESET ROLE;

INSERT INTO public.device_keys (user_id, device_id, public_key)
VALUES
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    tests_dummy_pub('elena')
  ),
  (
    '22222222-2222-2222-2222-222222222222'::uuid,
    'd2222222-2222-2222-2222-222222222222'::uuid,
    tests_dummy_pub('marco')
  ),
  (
    '33333333-3333-3333-3333-333333333333'::uuid,
    'd3333333-3333-3333-3333-333333333333'::uuid,
    tests_dummy_pub('rosa')
  );

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

INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a',
  'accepted',
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx;
INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid,
  'b',
  'accepted',
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx;

INSERT INTO public.recovery_public_keys (
  family_space_id, user_id, public_key, recovery_key_epoch
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  tests_dummy_pub('old-rk'),
  1
FROM fx;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  format(
    $sql$SELECT public.commit_recovery_repair(
      %L::uuid, 1, 2, %L::bytea, 1, %L::bytea, NULL,
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::bytea, %L::bytea],
      %L::bytea
    )$sql$,
    (SELECT space_id FROM fx),
    tests_dummy_pub('new-rk'),
    tests_dummy_box(),
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    'd2222222-2222-2222-2222-222222222222',
    'd3333333-3333-3333-3333-333333333333',
    tests_dummy_box(),
    tests_dummy_box(),
    tests_dummy_box()
  ),
  'commit_recovery_repair succeeds'
);
RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.recovery_pair_wraps
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND family_space_id = (SELECT space_id FROM fx)
      AND recovery_key_epoch = 2
      AND pair_id = 'ab'
  ),
  'repair leaves ab at the new epoch (accepted 2 implies ab)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.recovery_events
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND event_type = 'recovery repaired'
  ),
  'repair records a recovery event'
);

SELECT is(
  (
    SELECT count(*)::int FROM public.recovery_helper_refresh_notices
    WHERE member_id = '11111111-1111-1111-1111-111111111111'
      AND family_space_id = (SELECT space_id FROM fx)
  ),
  2,
  'repair notifies both contacts'
);

-- Seed old-epoch pair wrap so a failed repair must leave it.
INSERT INTO public.recovery_pair_wraps (
  family_space_id, user_id, recovery_key_epoch, pair_id, wrapped_recovery_key
)
SELECT space_id, '11111111-1111-1111-1111-111111111111'::uuid, 2, 'bp', tests_dummy_box()
FROM fx
ON CONFLICT DO NOTHING;

INSERT INTO public.personal_key_under_recovery (
  family_space_id, user_id, wrapped_key
)
SELECT space_id, '11111111-1111-1111-1111-111111111111'::uuid, tests_dummy_box()
FROM fx
ON CONFLICT DO NOTHING;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$SELECT public.commit_recovery_repair(
      %L::uuid, 2, 3, %L::bytea, 1, %L::bytea, NULL,
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::bytea, %L::bytea],
      %L::bytea
    )$sql$,
    (SELECT space_id FROM fx),
    tests_dummy_pub('fail-rk'),
    tests_dummy_box(),
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    'd2222222-2222-2222-2222-222222222222',
    'd3333333-3333-3333-3333-333333333333',
    tests_dummy_box(),
    tests_dummy_box(),
    tests_dummy_box()
  ),
  '42501',
  NULL,
  'repair with missing personal seal rolls back'
);
RESET ROLE;

SELECT ok(
  (
    SELECT recovery_key_epoch = 2
    FROM public.recovery_public_keys
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND family_space_id = (SELECT space_id FROM fx)
  ),
  'failed repair leaves the previous epoch public key'
);

INSERT INTO public.recovery_requests (
  family_space_id, user_id, new_device_id
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111111'::uuid
FROM fx;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$SELECT public.commit_recovery_repair(
      %L::uuid, 2, 3, %L::bytea, 1, %L::bytea, NULL,
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::uuid, %L::uuid],
      ARRAY[%L::bytea, %L::bytea],
      %L::bytea
    )$sql$,
    (SELECT space_id FROM fx),
    tests_dummy_pub('open-rk'),
    tests_dummy_box(),
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    'd2222222-2222-2222-2222-222222222222',
    'd3333333-3333-3333-3333-333333333333',
    tests_dummy_box(),
    tests_dummy_box(),
    tests_dummy_box()
  ),
  'P0001',
  NULL,
  'repair refused while a recovery request is open'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
