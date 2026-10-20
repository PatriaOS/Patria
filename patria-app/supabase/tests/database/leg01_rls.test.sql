-- pgTAP: LEG01 slice 1 vault_entries RLS, sizes, and atomic rotation (D33).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(41);

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

CREATE OR REPLACE FUNCTION tests_dummy_nonce()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(repeat('11', 24), 'hex');
$$;

CREATE OR REPLACE FUNCTION tests_dummy_cek()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(repeat('22', 48), 'hex');
$$;

CREATE OR REPLACE FUNCTION tests_dummy_ct()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(repeat('33', 64), 'hex');
$$;

GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_pub(text) TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_cek() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_ct() TO authenticated;

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-leg@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-leg@example.com', 'Marco');
SELECT tests_create_auth_user('33333333-3333-3333-3333-333333333333', 'jordan-leg@example.com', 'Jordan');
SELECT tests_create_auth_user('44444444-4444-4444-4444-444444444444', 'rosa-leg@example.com', 'Rosa');
SELECT tests_create_auth_user('55555555-5555-5555-5555-555555555555', 'alex-leg@example.com', 'Alex');
SELECT tests_create_auth_user('77777777-7777-7777-7777-777777777777', 'pat-leg@example.com', 'Pat');
SELECT tests_create_auth_user('99999999-9999-9999-9999-999999999999', 'chris-leg@example.com', 'Chris');
SELECT tests_create_auth_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other-leg@example.com', 'Other');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Leg Rivera', 'Mom');
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Leg Other', NULL);
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'Leg Rivera') AS rivera,
  (SELECT id FROM public.family_spaces WHERE name = 'Leg Other') AS other;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, user_id, role
FROM fx,
LATERAL (VALUES
  ('22222222-2222-2222-2222-222222222222'::uuid, 'co_admin'::public.space_role),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'teen'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'elder'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'extended_relative'),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'caregiver'),
  ('99999999-9999-9999-9999-999999999999'::uuid, 'successor')
) AS v(user_id, role);

INSERT INTO public.device_keys (user_id, device_id, public_key) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', tests_dummy_pub('elena-d')),
  ('22222222-2222-2222-2222-222222222222', 'd2222222-2222-2222-2222-222222222222', tests_dummy_pub('marco-d')),
  ('44444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444', tests_dummy_pub('rosa-d'));

INSERT INTO public.family_key_meta (family_space_id, key_epoch, recovery_key_epoch)
SELECT rivera, 1, 1 FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT rivera, '11111111-1111-1111-1111-111111111111',
       'd1111111-1111-1111-1111-111111111111',
       tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       'd4444444-4444-4444-4444-444444444444',
       tests_dummy_box(), 1, '11111111-1111-1111-1111-111111111111'
FROM fx;

INSERT INTO public.recovery_public_keys (
  family_space_id, user_id, public_key, recovery_key_epoch
)
SELECT rivera, '11111111-1111-1111-1111-111111111111', tests_dummy_pub('elena-rk'), 1
FROM fx;

INSERT INTO public.recovery_public_keys (
  family_space_id, user_id, public_key, recovery_key_epoch
)
SELECT rivera, '44444444-4444-4444-4444-444444444444', tests_dummy_pub('rosa-rk'), 1
FROM fx;

INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT rivera, '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 'a', 'accepted',
       '11111111-1111-1111-1111-111111111111'
FROM fx;
INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT rivera, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444444', 'b', 'accepted',
       '11111111-1111-1111-1111-111111111111'
FROM fx;
INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       '11111111-1111-1111-1111-111111111111', 'a', 'accepted',
       '44444444-4444-4444-4444-444444444444'
FROM fx;
INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       '22222222-2222-2222-2222-222222222222', 'b', 'accepted',
       '44444444-4444-4444-4444-444444444444'
FROM fx;

SELECT has_table('public'::name, 'vault_entries'::name);
SELECT col_type_is('public'::name, 'vault_entries'::name, 'content_nonce'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'vault_entries'::name, 'cek_nonce'::name, 'bytea'::name);
SELECT col_type_is('public'::name, 'vault_entries'::name, 'wrapped_cek'::name, 'bytea'::name);
SELECT is(
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'vault_entries'),
  true,
  'vault_entries has RLS'
);
SELECT is(
  (SELECT c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'vault_entries'),
  true,
  'vault_entries forces RLS'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111111', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'admin with wrap and recovery can insert a decision'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111aa', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 9,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'insert at a stale epoch is refused'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111bb', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                decode(repeat('11', 23), 'hex'), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '23514',
  NULL,
  'content_nonce must be 24 bytes'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111cc', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), decode(repeat('11', 25), 'hex'), tests_dummy_cek()
       FROM fx$sql$,
  '23514',
  NULL,
  'cek_nonce must be 24 bytes'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111dd', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), decode(repeat('22', 47), 'hex')
       FROM fx$sql$,
  '23514',
  NULL,
  'wrapped_cek must be 48 bytes'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111ee', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), decode(repeat('22', 49), 'hex')
       FROM fx$sql$,
  '23514',
  NULL,
  'wrapped_cek longer than 48 bytes is refused'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111ff', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), decode(repeat('33', 16), 'hex'), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '23514',
  NULL,
  'ciphertext shorter than 17 bytes is refused'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111100', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), decode(repeat('33', 65537), 'hex'), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '23514',
  NULL,
  'ciphertext longer than 64 KB is refused'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111201', rivera,
                '11111111-1111-1111-1111-111111111111',
                'e1111111-1111-1111-1111-111111111111',
                'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'author can add a follow-up under their decision'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111202', rivera,
                '11111111-1111-1111-1111-111111111111',
                'e1111111-1111-1111-1111-111111111201',
                'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'follow-ups cannot nest'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e3333333-3333-3333-3333-333333333333', rivera,
                '33333333-3333-3333-3333-333333333333', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'teen cannot write a decision'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-111111111111'$sql$,
  'teen can read family decisions'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e5555555-5555-5555-5555-555555555555', rivera,
                '55555555-5555-5555-5555-555555555555', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'extended relative cannot write a decision'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries$sql$,
  'extended relative cannot read vault entries'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries$sql$,
  'caregiver cannot read vault entries'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e2222222-2222-2222-2222-222222222222', rivera,
                '22222222-2222-2222-2222-222222222222', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'writer without a current wrap cannot insert'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e2222222-2222-2222-2222-222222222201', rivera,
                '22222222-2222-2222-2222-222222222222',
                'e1111111-1111-1111-1111-111111111111',
                'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'only the author can add a follow-up'
);
SELECT lives_ok(
  $sql$UPDATE public.vault_entries SET version = 2, ciphertext = tests_dummy_ct()
       WHERE id = 'e1111111-1111-1111-1111-111111111111'$sql$,
  'non-author update is a no-op under RLS'
);
SELECT is(
  (SELECT version FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'only the author can edit'
);
SELECT lives_ok(
  $sql$DELETE FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-111111111111'$sql$,
  'non-author delete is a no-op under RLS'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-111111111111'$sql$,
  'only the author can delete'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e4444444-4444-4444-4444-444444444444', rivera,
                '44444444-4444-4444-4444-444444444444', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'elder with wrap and recovery can insert a decision'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.vault_entries
       SET version = 2, ciphertext = tests_dummy_ct(),
           content_nonce = tests_dummy_nonce(),
           cek_nonce = tests_dummy_nonce(),
           wrapped_cek = tests_dummy_cek()
       WHERE id = 'e1111111-1111-1111-1111-111111111111'$sql$,
  'author can edit their decision'
);
SELECT throws_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT rivera FROM fx),
         1,
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY[]::uuid[],
         ARRAY[]::bytea[],
         ARRAY[]::bytea[]
       )$sql$,
  '42501',
  NULL,
  'rotation is refused when a vault entry is missing from the set'
);
RESET ROLE;

SELECT is(
  (SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = (SELECT rivera FROM fx)),
  1,
  'refused rotation leaves the epoch unchanged'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT rivera FROM fx),
         1,
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY[
           'e1111111-1111-1111-1111-111111111111'::uuid,
           'e1111111-1111-1111-1111-111111111201',
           'e4444444-4444-4444-4444-444444444444',
           'e1111111-1111-1111-1111-111111111111'
         ],
         ARRAY[tests_dummy_cek(), tests_dummy_cek(), tests_dummy_cek(), tests_dummy_cek()],
         ARRAY[tests_dummy_nonce(), tests_dummy_nonce(), tests_dummy_nonce(), tests_dummy_nonce()]
       )$sql$,
  '42501',
  NULL,
  'rotation is refused when an entry id is repeated'
);
SELECT throws_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT rivera FROM fx),
         1,
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY[
           'e1111111-1111-1111-1111-111111111111'::uuid,
           'e1111111-1111-1111-1111-111111111201',
           'e4444444-4444-4444-4444-444444444444'
         ],
         ARRAY[tests_dummy_cek(), tests_dummy_cek(), decode(repeat('22', 47), 'hex')],
         ARRAY[tests_dummy_nonce(), tests_dummy_nonce(), tests_dummy_nonce()]
       )$sql$,
  '42501',
  NULL,
  'rotation is refused when a rewrapped CEK is the wrong size'
);
SELECT lives_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT rivera FROM fx),
         1,
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY['11111111-1111-1111-1111-111111111111'::uuid, '44444444-4444-4444-4444-444444444444'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         ARRAY[
           'e1111111-1111-1111-1111-111111111111'::uuid,
           'e1111111-1111-1111-1111-111111111201',
           'e4444444-4444-4444-4444-444444444444'
         ],
         ARRAY[tests_dummy_cek(), tests_dummy_cek(), tests_dummy_cek()],
         ARRAY[tests_dummy_nonce(), tests_dummy_nonce(), tests_dummy_nonce()]
       )$sql$,
  'rotation commits when every current-epoch vault CEK is rewrapped'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111300', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'insert at the old epoch after rotation is refused'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-111111111301', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 2,
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'insert at the new epoch after rotation is allowed'
);
RESET ROLE;

SELECT is(
  (SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = (SELECT rivera FROM fx)),
  2,
  'successful rotation advances the epoch'
);
SELECT is(
  (SELECT key_epoch FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  2,
  'rewrapped vault rows move to the new epoch'
);

DELETE FROM public.space_members
WHERE family_space_id = (SELECT rivera FROM fx)
  AND user_id = '11111111-1111-1111-1111-111111111111';

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE author_id = '11111111-1111-1111-1111-111111111111'$sql$,
  'remaining key holders still read entries after the author leaves'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries$sql$,
  'a former member cannot read vault entries'
);
RESET ROLE;

INSERT INTO public.family_key_meta (family_space_id, key_epoch, recovery_key_epoch)
SELECT other, 1, 1 FROM fx;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.rotate_family_key(
         (SELECT other FROM fx),
         1,
         ARRAY[]::uuid[],
         ARRAY[]::uuid[],
         ARRAY[]::bytea[],
         ARRAY[]::uuid[],
         ARRAY[]::bytea[],
         ARRAY[]::uuid[],
         ARRAY[]::bytea[],
         ARRAY[]::bytea[]
       )$sql$,
  'rotation of a family with an empty vault commits'
);
RESET ROLE;

SELECT finish();
ROLLBACK;
