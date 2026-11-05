-- pgTAP: LEG02 Slice A letters (D42) — RLS before/after release, patria share locked.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(37);

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

GRANT EXECUTE ON FUNCTION tests_dummy_pub(text) TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_cek() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_ct() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_p256() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_x25519() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_wrapped_private() TO authenticated;

SELECT tests_create_auth_user('a1111111-1111-1111-1111-111111111111', 'author-leg02@example.com', 'Author');
SELECT tests_create_auth_user('b2222222-2222-2222-2222-222222222222', 'recip-leg02@example.com', 'Recipient');
SELECT tests_create_auth_user('c3333333-3333-3333-3333-333333333333', 'other-leg02@example.com', 'Other');
SELECT tests_create_auth_user('d4444444-4444-4444-4444-444444444444', 'out-leg02@example.com', 'Outsider');

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('LEG02 Letters', 'Mom', 'America/Chicago');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'LEG02 Letters') AS space_id;
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

SELECT ok(
  (SELECT timezone FROM public.family_spaces WHERE id = (SELECT space_id FROM fx)) = 'America/Chicago',
  'family timezone stored from create'
);

-- Author inserts draft then seals via RPC
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e1111111-1111-1111-1111-111111111111',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  now() + interval '7 days',
  'draft'
FROM fx;

SELECT lives_ok(
  $$
  SELECT public.seal_letter(
    'e1111111-1111-1111-1111-111111111111',
    1,
    'Mum',
    'surprise',
    now() + interval '7 days',
    tests_dummy_nonce(),
    tests_dummy_ct(),
    NULL,
    'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
    'abcd1234abcd',
    tests_dummy_nonce(),
    tests_dummy_cek(),
    tests_dummy_box(),
    tests_dummy_p256(),
    tests_dummy_box(),
    false,
    NULL
  )
  $$,
  'author can seal'
);
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  'sealed',
  'letter is sealed'
);

-- Letterbox public keys: writers can read; non-admins cannot read others' device_keys
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer
   FROM public.letterbox_keys
   WHERE user_id = 'b2222222-2222-2222-2222-222222222222'),
  1,
  'ready author can read recipient letterbox public key'
);
RESET ROLE;
SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer
   FROM public.letterbox_keys
   WHERE user_id = 'a1111111-1111-1111-1111-111111111111'),
  1,
  'co-admin writer can read another member letterbox public key'
);
RESET ROLE;
-- Elders are key-eligible but not space admins: they must not read others' device_keys.
SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer
   FROM public.device_keys
   WHERE user_id = 'b2222222-2222-2222-2222-222222222222'),
  0,
  'elder cannot read another member device_keys'
);
SELECT is(
  (SELECT to_regprocedure('public.letter_recipient_devices(uuid, uuid)') IS NULL),
  true,
  'letter_recipient_devices RPC is gone'
);
RESET ROLE;
SELECT tests_jwt('d4444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.create_letterbox_key(
    (SELECT space_id FROM fx),
    tests_dummy_x25519(),
    tests_dummy_nonce(),
    tests_dummy_wrapped_private()
  )$$,
  '42501',
  NULL,
  'outsider cannot create a letterbox in the family'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letterbox_keys),
  0,
  'outsider cannot read letterbox rows'
);
RESET ROLE;

-- Surprise: recipient sees no row before release
SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  0,
  'surprise recipient sees no row while sealed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_payloads WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  0,
  'surprise recipient cannot read payload while sealed'
);
SELECT throws_ok(
  $$SELECT ephemeral_public FROM public.letter_patria_shares WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'$$,
  '42501',
  NULL,
  'authenticated cannot select patria shares'
);
RESET ROLE;

-- Other family member sees nothing
SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  0,
  'other member sees no letter'
);
RESET ROLE;

-- Outsider sees nothing
SELECT tests_jwt('d4444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  0,
  'outsider sees no letter'
);
RESET ROLE;

-- Author can read author share and payload
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letter_author_shares WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'author reads author share'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_payloads WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'author reads payload while sealed'
);
-- Recipient cannot read author share
RESET ROLE;
SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letter_author_shares WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  0,
  'recipient cannot read author share'
);
RESET ROLE;

-- Announced letter: recipient sees metadata while sealed, not payload
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e2222222-2222-2222-2222-222222222222',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'announced',
  now() + interval '30 days',
  'draft'
FROM fx;

SELECT public.seal_letter(
  'e2222222-2222-2222-2222-222222222222',
  1,
  'Mum',
  'announced',
  now() + interval '30 days',
  tests_dummy_nonce(),
  tests_dummy_ct(),
  NULL,
  'bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234',
  'bbbb1234bbbb',
  tests_dummy_nonce(),
  tests_dummy_cek(),
  tests_dummy_box(),
  tests_dummy_p256(),
  tests_dummy_box(),
  false,
  NULL
);
RESET ROLE;

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e2222222-2222-2222-2222-222222222222'),
  1,
  'announced recipient sees row while sealed'
);
SELECT is(
  (SELECT from_label FROM public.letters WHERE id = 'e2222222-2222-2222-2222-222222222222'),
  'Mum',
  'announced recipient sees From label'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_payloads WHERE letter_id = 'e2222222-2222-2222-2222-222222222222'),
  0,
  'announced recipient cannot read payload while sealed'
);
RESET ROLE;

-- Mark due + pending: surprise recipient can see
UPDATE public.letters
SET trigger_at = now() - interval '1 minute'
WHERE id = 'e1111111-1111-1111-1111-111111111111';

SELECT is(public.mark_due_letters() >= 1, true, 'mark_due_letters flips due sealed letters');

SELECT is(
  (SELECT status::text FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  'pending',
  'due letter is pending'
);

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'recipient sees surprise letter after pending'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_payloads WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'recipient can read payload when pending'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_recipient_shares WHERE letter_id = 'e1111111-1111-1111-1111-111111111111'),
  1,
  'recipient can read letterbox share when pending'
);
RESET ROLE;

-- Service role claim patria share
SET LOCAL ROLE service_role;
SELECT ok(
  (SELECT count(*) FROM public.claim_letter_patria_share(
    'e1111111-1111-1111-1111-111111111111',
    'b2222222-2222-2222-2222-222222222222'
  )) = 1,
  'service role claims patria share after trigger'
);
SELECT public.mark_letter_released(
  'e1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222'
);
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.letters WHERE id = 'e1111111-1111-1111-1111-111111111111'),
  'released',
  'letter released'
);

-- Claim before trigger fails (announced letter still in future)
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT * FROM public.claim_letter_patria_share(
    'e2222222-2222-2222-2222-222222222222',
    'b2222222-2222-2222-2222-222222222222'
  )$$,
  '42501',
  'not_due',
  'claim before trigger_at is not_due'
);
SELECT throws_ok(
  $$SELECT * FROM public.claim_letter_patria_share(
    'e1111111-1111-1111-1111-111111111111',
    'd4444444-4444-4444-4444-444444444444'
  )$$,
  '42501',
  'not_recipient',
  'claim by non-recipient is not_recipient'
);
RESET ROLE;

-- Withdraw destroys payload and shares; events remain
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.withdraw_letter('e2222222-2222-2222-2222-222222222222');
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.letters WHERE id = 'e2222222-2222-2222-2222-222222222222'),
  0,
  'withdraw deletes letter row'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_payloads WHERE letter_id = 'e2222222-2222-2222-2222-222222222222'),
  0,
  'withdraw deletes payload'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_patria_shares WHERE letter_id = 'e2222222-2222-2222-2222-222222222222'),
  0,
  'withdraw deletes patria share'
);
SELECT ok(
  (SELECT count(*) FROM public.letter_events WHERE letter_id = 'e2222222-2222-2222-2222-222222222222' AND event_type = 'withdrawn') >= 1,
  'withdraw keeps letter_events'
);

-- Recipient leave marks sealed letter
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e3333333-3333-3333-3333-333333333333',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  now() + interval '100 days',
  'draft'
FROM fx;
SELECT public.seal_letter(
  'e3333333-3333-3333-3333-333333333333',
  1, 'Mum', 'surprise', now() + interval '100 days',
  tests_dummy_nonce(), tests_dummy_ct(), NULL,
  'cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234cccc1234',
  'cccc1234cccc',
  tests_dummy_nonce(), tests_dummy_cek(),
  tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(), false, NULL
);
RESET ROLE;

DELETE FROM public.space_members
WHERE user_id = 'b2222222-2222-2222-2222-222222222222'
  AND family_space_id = (SELECT space_id FROM fx);

SELECT ok(
  (SELECT recipient_left_at IS NOT NULL FROM public.letters WHERE id = 'e3333333-3333-3333-3333-333333333333'),
  'recipient leave stamps recipient_left_at'
);
SELECT is(
  (SELECT status::text FROM public.letters WHERE id = 'e3333333-3333-3333-3333-333333333333'),
  'sealed',
  'recipient leave does not release the letter'
);

-- Claim refuse reasons stay strict after leave / on draft
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT * FROM public.claim_letter_patria_share(
    'e3333333-3333-3333-3333-333333333333',
    'b2222222-2222-2222-2222-222222222222'
  )$$,
  '42501',
  'recipient_left',
  'claim after recipient left is recipient_left'
);
RESET ROLE;

INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e4444444-4444-4444-4444-444444444444',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'c3333333-3333-3333-3333-333333333333',
  'Mum',
  'surprise',
  now() - interval '1 day',
  'draft'
FROM fx;

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT * FROM public.claim_letter_patria_share(
    'e4444444-4444-4444-4444-444444444444',
    'c3333333-3333-3333-3333-333333333333'
  )$$,
  '42501',
  'bad_status',
  'claim on draft is bad_status'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
