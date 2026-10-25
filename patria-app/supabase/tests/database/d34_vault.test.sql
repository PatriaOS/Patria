-- pgTAP: LEG01 slice 2 voice notes and Only me (D34).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(33);

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
CREATE OR REPLACE FUNCTION tests_dummy_nonce()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('11', 24), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_cek()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('22', 48), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_ct()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('33', 64), 'hex'); $$;

GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_pub(text) TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_cek() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_ct() TO authenticated;

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-d34@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-d34@example.com', 'Marco');
SELECT tests_create_auth_user('33333333-3333-3333-3333-333333333333', 'jordan-d34@example.com', 'Jordan');
SELECT tests_create_auth_user('44444444-4444-4444-4444-444444444444', 'rosa-d34@example.com', 'Rosa');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('D34 Rivera', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'D34 Rivera') AS rivera;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT rivera, user_id, role
FROM fx,
LATERAL (VALUES
  ('22222222-2222-2222-2222-222222222222'::uuid, 'co_admin'::public.space_role),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'teen'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'elder')
) AS v(user_id, role);

INSERT INTO public.device_keys (user_id, device_id, public_key) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', tests_dummy_pub('elena-d')),
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

INSERT INTO public.recovery_public_keys (family_space_id, user_id, public_key, recovery_key_epoch)
SELECT rivera, '11111111-1111-1111-1111-111111111111', tests_dummy_pub('elena-rk'), 1 FROM fx;
INSERT INTO public.recovery_public_keys (family_space_id, user_id, public_key, recovery_key_epoch)
SELECT rivera, '44444444-4444-4444-4444-444444444444', tests_dummy_pub('rosa-rk'), 1 FROM fx;

INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT rivera, '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 'a', 'accepted',
       '11111111-1111-1111-1111-111111111111' FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT rivera, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444444', 'b', 'accepted',
       '11111111-1111-1111-1111-111111111111' FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       '11111111-1111-1111-1111-111111111111', 'a', 'accepted',
       '44444444-4444-4444-4444-444444444444' FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT rivera, '44444444-4444-4444-4444-444444444444',
       '22222222-2222-2222-2222-222222222222', 'b', 'accepted',
       '44444444-4444-4444-4444-444444444444' FROM fx;

SELECT is(
  (SELECT c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'personal_key_wraps'),
  true,
  'personal_key_wraps forces RLS'
);
SELECT is(
  (SELECT c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'personal_key_under_recovery'),
  true,
  'personal_key_under_recovery forces RLS'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.create_personal_key(
         (SELECT rivera FROM fx),
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid, 'd9999999-9999-9999-9999-999999999999'],
         ARRAY[tests_dummy_box(), tests_dummy_box()],
         tests_dummy_box()
       )$sql$,
  '42501',
  NULL,
  'create_personal_key refuses a wrap set that is not the approved devices'
);
SELECT lives_ok(
  $sql$SELECT public.create_personal_key(
         (SELECT rivera FROM fx),
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid],
         ARRAY[tests_dummy_box()],
         tests_dummy_box()
       )$sql$,
  'writer can create a personal key for the exact approved device set'
);
SELECT throws_ok(
  $sql$SELECT public.create_personal_key(
         (SELECT rivera FROM fx),
         ARRAY['d1111111-1111-1111-1111-111111111111'::uuid],
         ARRAY[tests_dummy_box()],
         tests_dummy_box()
       )$sql$,
  '42501',
  NULL,
  'create_personal_key refuses a second key'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch, visibility,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111aa', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, NULL, 'private',
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'author can insert an Only me entry'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch, visibility,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111bb', rivera,
                '11111111-1111-1111-1111-111111111111', 'decision', 1, 1, 'family',
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'author can insert a family entry'
);
SELECT throws_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch, visibility,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111cc', rivera,
                '11111111-1111-1111-1111-111111111111',
                'e1111111-1111-1111-1111-1111111111bb',
                'decision', 1, NULL, 'private',
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  '42501',
  NULL,
  'a follow-up cannot use a different visibility from its parent'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch, visibility,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e1111111-1111-1111-1111-1111111111dd', rivera,
                '11111111-1111-1111-1111-111111111111',
                'e1111111-1111-1111-1111-1111111111bb',
                'decision', 1, 1, 'family',
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'a follow-up can match its parent visibility'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'vault',
         (SELECT rivera FROM fx)::text || '/e1111111-1111-1111-1111-1111111111aa/a1111111-1111-1111-1111-111111111111',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'author can upload a vault object for their own entry'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'vault',
         (SELECT rivera FROM fx)::text || '/e1111111-1111-1111-1111-1111111111ff/a1111111-1111-1111-1111-111111111112',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'writer can upload a vault object before the entry row exists'
);
SELECT throws_ok(
  $sql$SELECT public.replace_recovery_public_key(
         (SELECT rivera FROM fx),
         tests_dummy_pub('elena-rk-2'),
         2,
         NULL
       )$sql$,
  '42501',
  NULL,
  'recovery public key change is refused without a personal seal'
);
SELECT lives_ok(
  $sql$SELECT public.replace_recovery_public_key(
         (SELECT rivera FROM fx),
         tests_dummy_pub('elena-rk-2'),
         2,
         tests_dummy_box()
       )$sql$,
  'recovery public key change accepts a new personal seal'
);
SELECT is(
  (SELECT count(*)::int FROM public.personal_key_under_recovery
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'Elena cannot delete her recovery seal directly'
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
         ARRAY['e1111111-1111-1111-1111-1111111111bb'::uuid, 'e1111111-1111-1111-1111-1111111111dd'],
         ARRAY[tests_dummy_cek(), tests_dummy_cek()],
         ARRAY[tests_dummy_nonce(), tests_dummy_nonce()]
       )$sql$,
  'rotation exact set is family rows only'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE visibility = 'private'$sql$,
  'another adult cannot see Only me rows'
);
SELECT is_empty(
  $sql$SELECT 1 FROM public.personal_key_wraps$sql$,
  'another member cannot read personal key wraps'
);
SELECT is_empty(
  $sql$SELECT 1 FROM storage.objects WHERE bucket_id = 'vault'
        AND name LIKE '%/e1111111-1111-1111-1111-1111111111aa/%'$sql$,
  'another member cannot read an Only me voice object'
);
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE visibility = 'private'$sql$,
  'a teen cannot see Only me rows'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE visibility = 'private'$sql$,
  'another writer cannot see Only me rows'
);
SELECT lives_ok(
  $sql$SELECT public.create_personal_key(
         (SELECT rivera FROM fx),
         ARRAY['d4444444-4444-4444-4444-444444444444'::uuid],
         ARRAY[tests_dummy_box()],
         tests_dummy_box()
       )$sql$,
  'elder can create their own personal key'
);
SELECT lives_ok(
  $sql$INSERT INTO public.vault_entries (
         id, family_space_id, author_id, kind, version, key_epoch, visibility,
         content_nonce, ciphertext, cek_nonce, wrapped_cek
       ) SELECT 'e4444444-4444-4444-4444-4444444444aa', rivera,
                '44444444-4444-4444-4444-444444444444', 'decision', 1, NULL, 'private',
                tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek()
       FROM fx$sql$,
  'elder can insert an Only me entry'
);
RESET ROLE;

SELECT is(
  (SELECT key_epoch FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-1111111111aa'),
  NULL,
  'rotation leaves Only me key_epoch null'
);
SELECT is(
  (SELECT key_epoch FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-1111111111bb'),
  2,
  'rotation advances family entry epochs'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.commit_vault_visibility_switch(
         'e1111111-1111-1111-1111-1111111111aa',
         'family',
         1,
         2,
         tests_dummy_nonce(), tests_dummy_ct(), tests_dummy_nonce(), tests_dummy_cek(),
         ARRAY[]::uuid[],
         ARRAY[]::integer[],
         ARRAY[]::integer[],
         ARRAY[]::bytea[],
         ARRAY[]::bytea[],
         ARRAY[]::bytea[],
         ARRAY[]::bytea[]
       )$sql$,
  'author can switch an Only me parent to Family with no follow-ups'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd = 'UPDATE'
      AND policyname LIKE 'vault_objects%'),
  0,
  'vault objects have no UPDATE policy so clients insert once'
);

UPDATE public.space_members
SET role = 'extended_relative'
WHERE family_space_id = (SELECT rivera FROM fx)
  AND user_id = '44444444-4444-4444-4444-444444444444';

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE id = 'e4444444-4444-4444-4444-4444444444aa'$sql$,
  'a role change without the family key keeps Only me rows'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.personal_key_under_recovery
        WHERE user_id = '44444444-4444-4444-4444-444444444444'$sql$,
  'a role change keeps the personal key'
);
RESET ROLE;

DELETE FROM public.space_members
WHERE family_space_id = (SELECT rivera FROM fx)
  AND user_id = '44444444-4444-4444-4444-444444444444';

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE id = 'e4444444-4444-4444-4444-4444444444aa'$sql$,
  'membership delete removes Only me rows'
);
SELECT isnt_empty(
  $sql$SELECT 1 FROM public.vault_entries WHERE id = 'e1111111-1111-1111-1111-1111111111bb'$sql$,
  'membership delete keeps family rows'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.personal_key_under_recovery
    WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'membership delete removes the personal recovery seal'
);
SELECT is(
  (SELECT count(*)::int FROM public.personal_key_wraps
    WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'membership delete removes personal device wraps'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.personal_key_under_recovery
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'direct delete of a personal recovery seal is refused'
);
RESET ROLE;

SELECT finish();
ROLLBACK;
