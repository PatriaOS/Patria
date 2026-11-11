-- pgTAP: expire_pending_devices — 8d never-approved gone; 6d stays; approved of any age stays;
-- other members' devices unaffected; audit event; cron job present.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(11);

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

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-expire@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-expire@example.com', 'Marco');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Expire Pending Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'Expire Pending Family') AS space_id;
GRANT SELECT ON TABLE fx TO authenticated, anon;

-- Invite Marco as elder.
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.invites (family_space_id, invited_by, email, role, default_circle_id)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'marco-expire@example.com',
  'elder',
  (SELECT id FROM public.circles WHERE family_space_id = space_id AND kind = 'household' LIMIT 1)
FROM fx;
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.accept_invite((SELECT token FROM public.invites WHERE email = 'marco-expire@example.com' LIMIT 1));
RESET ROLE;

-- Devices:
-- Elena 8d pending (no wrap) → expire
-- Elena 6d pending (no wrap) → keep
-- Elena approved, aged 30d → keep
-- Marco approved, aged 30d → keep (other user unaffected)
INSERT INTO public.device_keys (user_id, device_id, public_key, created_at)
VALUES
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111118'::uuid,
    tests_dummy_pub('elena-8d'),
    now() - interval '8 days'
  ),
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111116'::uuid,
    tests_dummy_pub('elena-6d'),
    now() - interval '6 days'
  ),
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'd1111111-1111-1111-1111-111111111130'::uuid,
    tests_dummy_pub('elena-ok'),
    now() - interval '30 days'
  ),
  (
    '22222222-2222-2222-2222-222222222222'::uuid,
    'd2222222-2222-2222-2222-222222222230'::uuid,
    tests_dummy_pub('marco-ok'),
    now() - interval '30 days'
  );

INSERT INTO public.family_key_meta (family_space_id, key_epoch)
SELECT space_id, 1 FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111130'::uuid,
  tests_dummy_box(),
  1,
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx
UNION ALL
SELECT
  space_id,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'd2222222-2222-2222-2222-222222222230'::uuid,
  tests_dummy_box(),
  1,
  '11111111-1111-1111-1111-111111111111'::uuid
FROM fx;

INSERT INTO public.device_approval_notices (family_space_id, user_id, device_id)
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111118'::uuid
FROM fx
UNION ALL
SELECT
  space_id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd1111111-1111-1111-1111-111111111116'::uuid
FROM fx;

SELECT ok(
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
  'pg_cron extension is installed'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'patria-expire-pending-devices' AND active
  ),
  'patria-expire-pending-devices cron job is scheduled and active'
);

SELECT is(
  (SELECT public.expire_pending_devices()),
  1,
  'expires exactly one 8-day never-approved device'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.device_keys
    WHERE device_id = 'd1111111-1111-1111-1111-111111111118'::uuid
  ),
  '8-day never-approved Elena device is removed'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.device_keys
    WHERE device_id = 'd1111111-1111-1111-1111-111111111116'::uuid
  ),
  '6-day never-approved Elena device stays'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.device_keys
    WHERE device_id = 'd1111111-1111-1111-1111-111111111130'::uuid
  )
  AND EXISTS (
    SELECT 1 FROM public.family_key_wraps
    WHERE device_id = 'd1111111-1111-1111-1111-111111111130'::uuid
  ),
  'approved Elena device of any age stays with its wrap'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.device_keys
    WHERE device_id = 'd2222222-2222-2222-2222-222222222230'::uuid
  )
  AND EXISTS (
    SELECT 1 FROM public.family_key_wraps
    WHERE device_id = 'd2222222-2222-2222-2222-222222222230'::uuid
  ),
  'other user approved device stays with its wrap'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.device_events
    WHERE device_id = 'd1111111-1111-1111-1111-111111111118'::uuid
      AND event_type = 'pending request expired'
      AND family_space_id = (SELECT space_id FROM fx)
  ),
  'records pending request expired device event'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.device_approval_notices
    WHERE device_id = 'd1111111-1111-1111-1111-111111111118'::uuid
  ),
  'expired pending notice is cleared'
);

SELECT throws_ok(
  $$SET ROLE anon; SELECT public.expire_pending_devices()$$,
  NULL,
  NULL,
  'anon cannot execute expire_pending_devices'
);
RESET ROLE;

SELECT throws_ok(
  $$SET ROLE authenticated; SELECT public.expire_pending_devices()$$,
  NULL,
  NULL,
  'authenticated cannot execute expire_pending_devices'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
