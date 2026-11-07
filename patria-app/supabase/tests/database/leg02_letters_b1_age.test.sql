-- pgTAP: LEG02 Slice B1 — age triggers, DOB column grants, freeze, refusals.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(31);

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
CREATE OR REPLACE FUNCTION tests_dummy_box()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('aa', 80), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_p256()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('04', 33), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_x25519()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('05', 32), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_wrapped_private()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('06', 48), 'hex'); $$;

GRANT EXECUTE ON FUNCTION tests_dummy_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_cek() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_ct() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_p256() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_x25519() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_wrapped_private() TO authenticated;

SELECT tests_create_auth_user('a1111111-1111-1111-1111-111111111111', 'author-b1@example.com', 'Author');
SELECT tests_create_auth_user('b2222222-2222-2222-2222-222222222222', 'recip-b1@example.com', 'Recipient');
SELECT tests_create_auth_user('c3333333-3333-3333-3333-333333333333', 'elder-b1@example.com', 'Elder');

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('LEG02 B1', 'Mom', 'America/Chicago');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'LEG02 B1') AS space_id;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT space_id, user_id, role
FROM fx,
LATERAL (VALUES
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'co_admin'::public.space_role),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'elder')
) AS v(user_id, role);

INSERT INTO public.device_keys (user_id, device_id, public_key) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'da111111-1111-1111-1111-111111111111', tests_dummy_pub('a')),
  ('b2222222-2222-2222-2222-222222222222', 'db222222-2222-2222-2222-222222222222', tests_dummy_pub('b'));

INSERT INTO public.family_key_meta (family_space_id, key_epoch, recovery_key_epoch)
SELECT space_id, 1, 1 FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT
  space_id,
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'da111111-1111-1111-1111-111111111111'::uuid,
  tests_dummy_box(),
  1,
  'a1111111-1111-1111-1111-111111111111'::uuid
FROM fx
UNION ALL
SELECT
  space_id,
  'b2222222-2222-2222-2222-222222222222'::uuid,
  'db222222-2222-2222-2222-222222222222'::uuid,
  tests_dummy_box(),
  1,
  'a1111111-1111-1111-1111-111111111111'::uuid
FROM fx;

INSERT INTO public.recovery_public_keys (family_space_id, user_id, public_key, recovery_key_epoch)
SELECT space_id, 'a1111111-1111-1111-1111-111111111111'::uuid, tests_dummy_pub('ar'), 1 FROM fx
UNION ALL
SELECT space_id, 'b2222222-2222-2222-2222-222222222222'::uuid, tests_dummy_pub('br'), 1 FROM fx;

INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT space_id, 'a1111111-1111-1111-1111-111111111111'::uuid,
       'b2222222-2222-2222-2222-222222222222'::uuid, 'a', 'accepted',
       'a1111111-1111-1111-1111-111111111111'::uuid FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT space_id, 'a1111111-1111-1111-1111-111111111111'::uuid,
       'c3333333-3333-3333-3333-333333333333'::uuid, 'b', 'accepted',
       'a1111111-1111-1111-1111-111111111111'::uuid FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT space_id, 'b2222222-2222-2222-2222-222222222222'::uuid,
       'a1111111-1111-1111-1111-111111111111'::uuid, 'a', 'accepted',
       'b2222222-2222-2222-2222-222222222222'::uuid FROM fx;
INSERT INTO public.recovery_contacts (family_space_id, member_id, user_id, slot, status, created_by)
SELECT space_id, 'b2222222-2222-2222-2222-222222222222'::uuid,
       'c3333333-3333-3333-3333-333333333333'::uuid, 'b', 'accepted',
       'b2222222-2222-2222-2222-222222222222'::uuid FROM fx;

INSERT INTO public.letterbox_keys (
  family_space_id, user_id, public_key, private_nonce, wrapped_private
)
SELECT space_id, 'a1111111-1111-1111-1111-111111111111'::uuid,
       tests_dummy_x25519(), tests_dummy_nonce(), tests_dummy_wrapped_private() FROM fx
UNION ALL
SELECT space_id, 'b2222222-2222-2222-2222-222222222222'::uuid,
       tests_dummy_x25519(), tests_dummy_nonce(), tests_dummy_wrapped_private() FROM fx;

SELECT has_function('public'::name, 'set_letter_age'::name, ARRAY['uuid', 'integer']);
SELECT has_function('public'::name, 'profile_date_of_birth'::name, ARRAY['uuid']);
SELECT has_view('public'::name, 'letters_for_api'::name);

-- Column grant: authenticated cannot SELECT date_of_birth on profiles.
SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT date_of_birth FROM public.profiles
    WHERE id = 'b2222222-2222-2222-2222-222222222222'$sql$,
  '42501',
  NULL,
  'authenticated cannot SELECT profiles.date_of_birth column'
);
-- Self can update own birthday and read via RPC.
SELECT lives_ok(
  $sql$UPDATE public.profiles
    SET date_of_birth = DATE '2008-06-15'
    WHERE id = 'b2222222-2222-2222-2222-222222222222'$sql$,
  'recipient can set own date_of_birth'
);
SELECT is(
  public.profile_date_of_birth('b2222222-2222-2222-2222-222222222222'),
  DATE '2008-06-15',
  'self can read own DOB via profile_date_of_birth'
);
RESET ROLE;

-- Elder (not admin) cannot read peer DOB via RPC.
SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  public.profile_date_of_birth('b2222222-2222-2222-2222-222222222222'),
  NULL,
  'non-admin peer cannot read another adult DOB'
);
RESET ROLE;

-- Family admin can read member DOB via RPC.
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  public.profile_date_of_birth('b2222222-2222-2222-2222-222222222222'),
  DATE '2008-06-15',
  'family admin can read member DOB via profile_date_of_birth'
);

-- Refuse age seal with no DOB on a fresh recipient path: clear DOB as postgres.
RESET ROLE;
UPDATE public.profiles
SET date_of_birth = NULL
WHERE id = 'b2222222-2222-2222-2222-222222222222';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e1b10000-0000-0000-0000-000000000001',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  '9999-01-01T00:00:00Z',
  'draft'
FROM fx;

SELECT throws_ok(
  $sql$SELECT public.seal_letter(
    'e1b10000-0000-0000-0000-000000000001',
    1, 'Mum', 'surprise', NULL,
    tests_dummy_nonce(), tests_dummy_ct(), NULL,
    'bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234',
    'bbbb1234bbbb',
    tests_dummy_nonce(), tests_dummy_cek(),
    tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(),
    false, NULL, 'age', 18
  )$sql$,
  'P0001',
  NULL,
  'seal_letter refuses age when recipient has no birthday'
);
RESET ROLE;

-- Restore DOB; seal age letter (far future age).
UPDATE public.profiles
SET date_of_birth = DATE '2008-06-15'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.seal_letter(
    'e1b10000-0000-0000-0000-000000000001',
    1, 'Mum', 'surprise', NULL,
    tests_dummy_nonce(), tests_dummy_ct(), NULL,
    'bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234',
    'bbbb1234bbbb',
    tests_dummy_nonce(), tests_dummy_cek(),
    tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(),
    false, NULL, 'age', 30
  )$sql$,
  'author can seal an age letter'
);
-- Author view redacts trigger_at for age letters.
SELECT is(
  (SELECT trigger_at FROM public.letters_for_api
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  NULL,
  'letters_for_api hides trigger_at from age-letter author'
);
SELECT is(
  (SELECT trigger_age FROM public.letters_for_api
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  30,
  'author can read trigger_age via letters_for_api'
);
SELECT throws_ok(
  $sql$SELECT trigger_dob_snapshot FROM public.letters
    WHERE id = 'e1b10000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'author cannot SELECT trigger_dob_snapshot'
);
SELECT throws_ok(
  $sql$SELECT trigger_at FROM public.letters
    WHERE id = 'e1b10000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'author cannot SELECT trigger_at from letters for an age letter'
);
SELECT throws_ok(
  $sql$SELECT public.set_letter_open_date(
    'e1b10000-0000-0000-0000-000000000001',
    now() + interval '200 days'
  )$sql$,
  '42501',
  'Not allowed',
  'set_letter_open_date refuses age letters'
);
SELECT lives_ok(
  $sql$SELECT public.set_letter_age('e1b10000-0000-0000-0000-000000000001', 35)$sql$,
  'author can change age while sealed'
);
SELECT is(
  (SELECT trigger_age FROM public.letters_for_api
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  35,
  'set_letter_age updates trigger_age'
);
RESET ROLE;

-- Snapshot + kind stored (postgres reads the revoked column).
SELECT ok(
  (SELECT trigger_kind = 'age' AND trigger_age = 35
     AND trigger_dob_snapshot = DATE '2008-06-15'
   FROM public.letters WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  'age letter stores kind, age, and DOB snapshot'
);

-- Freeze: changing live DOB does not move trigger_at.
CREATE TEMP TABLE snap AS
SELECT trigger_at, trigger_dob_snapshot
FROM public.letters
WHERE id = 'e1b10000-0000-0000-0000-000000000001';

UPDATE public.profiles
SET date_of_birth = DATE '1990-01-01'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

SELECT is(
  (SELECT l.trigger_at FROM public.letters l
   WHERE l.id = 'e1b10000-0000-0000-0000-000000000001'),
  (SELECT trigger_at FROM snap),
  'DOB edit after seal does not move trigger_at'
);
SELECT is(
  (SELECT l.trigger_dob_snapshot FROM public.letters l
   WHERE l.id = 'e1b10000-0000-0000-0000-000000000001'),
  (SELECT trigger_dob_snapshot FROM snap),
  'DOB edit after seal leaves snapshot frozen'
);

-- Recipient cannot change trigger fields.
SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.set_letter_age('e1b10000-0000-0000-0000-000000000001', 40)$sql$,
  '42501',
  'Not allowed',
  'recipient cannot set_letter_age'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET trigger_age = 99
    WHERE id = 'e1b10000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'recipient cannot UPDATE trigger_age directly'
);
-- Surprise RLS hides the row from the recipient; announce then check the date.
RESET ROLE;
UPDATE public.letters
SET visibility = 'announced'
WHERE id = 'e1b10000-0000-0000-0000-000000000001';

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT trigger_at IS NOT NULL FROM public.letters_for_api
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  'recipient can see trigger_at for an announced age letter via letters_for_api'
);
-- Surprise still hides the row from the recipient on the base table and the view.
RESET ROLE;
UPDATE public.letters
SET visibility = 'surprise'
WHERE id = 'e1b10000-0000-0000-0000-000000000001';

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters_for_api
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  0,
  'surprise age letter is hidden from recipient on letters_for_api'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letters
   WHERE id = 'e1b10000-0000-0000-0000-000000000001'),
  0,
  'surprise age letter is hidden from recipient on letters'
);
RESET ROLE;
UPDATE public.letters
SET visibility = 'announced'
WHERE id = 'e1b10000-0000-0000-0000-000000000001';

-- Feb 29 → Mar 1 in non-leap years; family TZ midnight.
RESET ROLE;
UPDATE public.profiles
SET date_of_birth = DATE '2000-02-29'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e1b10000-0000-0000-0000-000000000002',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  '9999-01-01T00:00:00Z',
  'draft'
FROM fx;
-- Age 1 from 2000-02-29 → 2001-03-01; already past, so use a future age from a young DOB.
RESET ROLE;
UPDATE public.profiles
SET date_of_birth = DATE '2020-02-29'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.seal_letter(
    'e1b10000-0000-0000-0000-000000000002',
    1, 'Mum', 'surprise', NULL,
    tests_dummy_nonce(), tests_dummy_ct(), NULL,
    'cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234',
    'cccc1234cccc',
    tests_dummy_nonce(), tests_dummy_cek(),
    tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(),
    false, NULL, 'age', 18
  )$sql$,
  'seal age letter with Feb 29 DOB'
);
-- Base-table trigger_at is not granted to authenticated; verify as postgres.
RESET ROLE;
SELECT is(
  public.sync_local_date(
    (SELECT trigger_at FROM public.letters WHERE id = 'e1b10000-0000-0000-0000-000000000002'),
    'America/Chicago'
  ),
  DATE '2038-03-01',
  'Feb 29 DOB at age 18 in non-leap year opens Mar 1 Chicago'
);
SELECT is(
  (SELECT trigger_at FROM public.letters WHERE id = 'e1b10000-0000-0000-0000-000000000002'),
  public.sync_at_local('America/Chicago', DATE '2038-03-01', TIME '00:00'),
  'age trigger_at is midnight in the family time zone'
);
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

-- Already that age or older.
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e1b10000-0000-0000-0000-000000000003',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  '9999-01-01T00:00:00Z',
  'draft'
FROM fx;
SELECT throws_ok(
  $sql$SELECT public.seal_letter(
    'e1b10000-0000-0000-0000-000000000003',
    1, 'Mum', 'surprise', NULL,
    tests_dummy_nonce(), tests_dummy_ct(), NULL,
    'dddd1234dddd1234dddd1234dddd1234dddd1234dddd1234dddd1234dddd1234',
    'dddd1234dddd',
    tests_dummy_nonce(), tests_dummy_cek(),
    tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(),
    false, NULL, 'age', 5
  )$sql$,
  'P0001',
  NULL,
  'seal_letter refuses when recipient is already that age or older'
);
RESET ROLE;

-- No authenticated UPDATE grant on new letters columns (table-level UPDATE revoked).
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$UPDATE public.letters SET trigger_age = 50
    WHERE id = 'e1b10000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'authenticated cannot UPDATE trigger_age on letters'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET trigger_dob_snapshot = DATE '1999-01-01'
    WHERE id = 'e1b10000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'authenticated cannot UPDATE trigger_dob_snapshot on letters'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
