-- pgTAP: LEG02 Slice B2 — keepers tables, RLS, due gates, withdraw cleanup.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(24);

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
RETURNS void LANGUAGE sql AS $$
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
CREATE OR REPLACE FUNCTION tests_dummy_holder()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('07', 80), 'hex'); $$;
CREATE OR REPLACE FUNCTION tests_dummy_pair()
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('08', 64), 'hex'); $$;

GRANT EXECUTE ON FUNCTION tests_dummy_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_cek() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_ct() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_box() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_p256() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_x25519() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_wrapped_private() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_holder() TO authenticated;
GRANT EXECUTE ON FUNCTION tests_dummy_pair() TO authenticated;

SELECT tests_create_auth_user('a1111111-1111-1111-1111-111111111111', 'author-b2@example.com', 'Author');
SELECT tests_create_auth_user('b2222222-2222-2222-2222-222222222222', 'recip-b2@example.com', 'Recipient');
SELECT tests_create_auth_user('c3333333-3333-3333-3333-333333333333', 'keepera-b2@example.com', 'KeeperA');
SELECT tests_create_auth_user('d4444444-4444-4444-4444-444444444444', 'keeperb-b2@example.com', 'KeeperB');
SELECT tests_create_auth_user('e5555555-5555-5555-5555-555555555555', 'keeperc-b2@example.com', 'KeeperC');
SELECT tests_create_auth_user('f6666666-6666-6666-6666-666666666666', 'teen-b2@example.com', 'Teen');

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('LEG02 B2', 'Mom', 'America/Chicago');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'LEG02 B2') AS space_id;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT space_id, user_id, role
FROM fx,
LATERAL (VALUES
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'co_admin'::public.space_role),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'elder'),
  ('d4444444-4444-4444-4444-444444444444'::uuid, 'elder'),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'elder'),
  ('f6666666-6666-6666-6666-666666666666'::uuid, 'teen')
) AS v(user_id, role);

-- Devices + family key wraps + recovery for author, recipient, three keepers (not teen).
INSERT INTO public.device_keys (user_id, device_id, public_key) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'da111111-1111-1111-1111-111111111111', tests_dummy_pub('a')),
  ('b2222222-2222-2222-2222-222222222222', 'db222222-2222-2222-2222-222222222222', tests_dummy_pub('b')),
  ('c3333333-3333-3333-3333-333333333333', 'dc333333-3333-3333-3333-333333333333', tests_dummy_pub('c')),
  ('d4444444-4444-4444-4444-444444444444', 'dd444444-4444-4444-4444-444444444444', tests_dummy_pub('d')),
  ('e5555555-5555-5555-5555-555555555555', 'de555555-5555-5555-5555-555555555555', tests_dummy_pub('e'));

INSERT INTO public.family_key_meta (family_space_id, key_epoch, recovery_key_epoch)
SELECT space_id, 1, 1 FROM fx;

INSERT INTO public.family_key_wraps (
  family_space_id, user_id, device_id, wrapped_key, key_epoch, approved_by
)
SELECT space_id, u, d, tests_dummy_box(), 1, 'a1111111-1111-1111-1111-111111111111'::uuid
FROM fx,
LATERAL (VALUES
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'da111111-1111-1111-1111-111111111111'::uuid),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'db222222-2222-2222-2222-222222222222'::uuid),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'dc333333-3333-3333-3333-333333333333'::uuid),
  ('d4444444-4444-4444-4444-444444444444'::uuid, 'dd444444-4444-4444-4444-444444444444'::uuid),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'de555555-5555-5555-5555-555555555555'::uuid)
) AS v(u, d);

INSERT INTO public.letterbox_keys (
  family_space_id, user_id, public_key, private_nonce, wrapped_private
)
SELECT space_id, u, tests_dummy_x25519(), tests_dummy_nonce(), tests_dummy_wrapped_private()
FROM fx,
LATERAL (VALUES
  ('a1111111-1111-1111-1111-111111111111'::uuid),
  ('b2222222-2222-2222-2222-222222222222'::uuid),
  ('c3333333-3333-3333-3333-333333333333'::uuid),
  ('d4444444-4444-4444-4444-444444444444'::uuid),
  ('e5555555-5555-5555-5555-555555555555'::uuid),
  ('f6666666-6666-6666-6666-666666666666'::uuid)
) AS v(u);

-- Recovery public + 2 accepted contacts for keepers and recipient/author.
INSERT INTO public.recovery_public_keys (family_space_id, user_id, public_key, recovery_key_epoch)
SELECT space_id, u, tests_dummy_x25519(), 1
FROM fx,
LATERAL (VALUES
  ('a1111111-1111-1111-1111-111111111111'::uuid),
  ('b2222222-2222-2222-2222-222222222222'::uuid),
  ('c3333333-3333-3333-3333-333333333333'::uuid),
  ('d4444444-4444-4444-4444-444444444444'::uuid),
  ('e5555555-5555-5555-5555-555555555555'::uuid)
) AS v(u);

INSERT INTO public.recovery_contacts (
  family_space_id, member_id, user_id, slot, status, created_by
)
SELECT space_id, member_id, contact_id, slot, 'accepted', member_id
FROM fx,
LATERAL (VALUES
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'c3333333-3333-3333-3333-333333333333'::uuid, 'a'::public.recovery_contact_slot),
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'b'),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'c3333333-3333-3333-3333-333333333333'::uuid, 'a'),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'b'),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'a'),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'b'),
  ('d4444444-4444-4444-4444-444444444444'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'a'),
  ('d4444444-4444-4444-4444-444444444444'::uuid, 'c3333333-3333-3333-3333-333333333333'::uuid, 'b'),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'a'),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'c3333333-3333-3333-3333-333333333333'::uuid, 'b')
) AS v(member_id, contact_id, slot);

SELECT has_table('public'::name, 'letter_keepers'::name);
SELECT has_table('public'::name, 'letter_keeper_pair_boxes'::name);
SELECT has_table('public'::name, 'letter_keeper_recipient_secrets'::name);

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT 1 FROM public.letter_keeper_pair_boxes$$,
  '42501',
  NULL,
  'authenticated cannot SELECT pair boxes'
);
RESET ROLE;

-- Eligibility
SELECT ok(
  public.letter_keeper_eligible(
    (SELECT space_id FROM fx),
    'c3333333-3333-3333-3333-333333333333',
    'a1111111-1111-1111-1111-111111111111',
    'b2222222-2222-2222-2222-222222222222'
  ),
  'elder with letterbox+recovery is eligible'
);
SELECT ok(
  NOT public.letter_keeper_eligible(
    (SELECT space_id FROM fx),
    'f6666666-6666-6666-6666-666666666666',
    'a1111111-1111-1111-1111-111111111111',
    'b2222222-2222-2222-2222-222222222222'
  ),
  'teen is not eligible'
);

-- Seal with keepers
CREATE TEMP TABLE letter_fx (letter_id uuid);
INSERT INTO letter_fx (letter_id) VALUES ('11111111-1111-4111-8111-111111111111');
GRANT SELECT ON TABLE letter_fx TO authenticated, anon;

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility,
  trigger_kind, trigger_at, status, version
)
SELECT
  letter_id, space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Author', 'surprise', 'date', now() + interval '30 days', 'draft', 1
FROM fx, letter_fx;

SELECT lives_ok(
  $sql$
  SELECT public.seal_letter(
    (SELECT letter_id FROM letter_fx),
    1,
    'Author',
    'surprise',
    now() + interval '30 days',
    tests_dummy_nonce(),
    tests_dummy_ct(),
    NULL,
    'hash',
    'fingerprint12',
    tests_dummy_nonce(),
    tests_dummy_cek(),
    tests_dummy_box(),
    tests_dummy_p256(),
    tests_dummy_box(),
    false,
    NULL,
    'date',
    NULL,
    ARRAY[
      'c3333333-3333-3333-3333-333333333333'::uuid,
      'd4444444-4444-4444-4444-444444444444'::uuid,
      'e5555555-5555-5555-5555-555555555555'::uuid
    ],
    ARRAY['a','b','c'],
    ARRAY[tests_dummy_holder(), tests_dummy_holder(), tests_dummy_holder()],
    (SELECT public_key FROM public.letterbox_keys
      WHERE user_id = 'b2222222-2222-2222-2222-222222222222'
      LIMIT 1),
    ARRAY['ab','ac','bc'],
    ARRAY[tests_dummy_pair(), tests_dummy_pair(), tests_dummy_pair()]
  )
  $sql$,
  'seal_letter accepts three eligible keepers'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.letter_keepers WHERE letter_id = (SELECT letter_id FROM letter_fx)),
  3,
  'three keeper rows after seal'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_keeper_pair_boxes WHERE letter_id = (SELECT letter_id FROM letter_fx)),
  3,
  'three pair boxes after seal'
);

-- Keeper SELECT own wrap only
SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.letter_keepers),
  1,
  'keeper sees only own wrap'
);
SELECT throws_ok(
  $$SELECT 1 FROM public.letter_keeper_pair_boxes$$,
  '42501',
  NULL,
  'keeper cannot SELECT pair boxes'
);
RESET ROLE;

-- Before due: release and fetch refuse
SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.release_keeper_holder_to_recipient(
    (SELECT letter_id FROM letter_fx), tests_dummy_holder()
  )$sql$,
  '42501',
  NULL,
  'keeper release refused before due'
);
RESET ROLE;

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT * FROM public.fetch_letter_keeper_pair_box(
    (SELECT letter_id FROM letter_fx), 'ab'
  )$sql$,
  '42501',
  NULL,
  'recipient pair fetch refused before due'
);
RESET ROLE;

-- Advance due
UPDATE public.letters
SET trigger_at = now() - interval '1 hour'
WHERE id = (SELECT letter_id FROM letter_fx);

SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.release_keeper_holder_to_recipient(
    (SELECT letter_id FROM letter_fx), tests_dummy_holder()
  )$sql$,
  'keeper release after due'
);
RESET ROLE;

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.fetch_letter_keeper_pair_box(
    (SELECT letter_id FROM letter_fx), 'ab'
  )) = 1,
  'recipient can fetch pair box after due'
);
SELECT ok(
  (SELECT count(*) FROM public.letter_keeper_help_for_recipient((SELECT letter_id FROM letter_fx))) = 3,
  'recipient sees three keepers with slots'
);
SELECT ok(
  (SELECT bool_or(has_helped) FROM public.letter_keeper_help_for_recipient((SELECT letter_id FROM letter_fx))),
  'recipient sees has_helped for released keeper'
);
RESET ROLE;

-- PUBLIC/anon revoked
SELECT throws_ok(
  $$SET ROLE anon; SELECT public.letters_for_keepers()$$,
  NULL,
  NULL,
  'anon cannot execute letters_for_keepers'
);
RESET ROLE;

-- Recipient left → not_allowed
UPDATE public.letters
SET recipient_left_at = now()
WHERE id = (SELECT letter_id FROM letter_fx);
SELECT tests_jwt('d4444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.release_keeper_holder_to_recipient(
    (SELECT letter_id FROM letter_fx), tests_dummy_holder()
  )$sql$,
  '42501',
  NULL,
  'keeper release refused when recipient left'
);
RESET ROLE;
UPDATE public.letters SET recipient_left_at = NULL WHERE id = (SELECT letter_id FROM letter_fx);

-- Withdraw deletes keeper rows (status is pending from keeper help — set sealed as postgres).
UPDATE public.letters
SET status = 'sealed', pending_at = NULL
WHERE id = (SELECT letter_id FROM letter_fx);
SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$SELECT public.withdraw_letter((SELECT letter_id FROM letter_fx))$sql$,
  'withdraw_letter succeeds'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.letter_keepers WHERE letter_id = (SELECT letter_id FROM letter_fx)),
  0,
  'withdraw deletes letter_keepers'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_keeper_pair_boxes WHERE letter_id = (SELECT letter_id FROM letter_fx)),
  0,
  'withdraw deletes pair boxes'
);
SELECT is(
  (SELECT count(*)::integer FROM public.letter_keeper_recipient_secrets WHERE letter_id = (SELECT letter_id FROM letter_fx)),
  0,
  'withdraw deletes recipient secrets'
);

-- Keeper leave event on a fresh letter
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility,
  trigger_kind, trigger_at, status, version
)
SELECT
  '22222222-2222-4222-8222-222222222222',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Author', 'announced', 'date', now() + interval '10 days', 'sealed', 1
FROM fx;

INSERT INTO public.letter_keepers (
  letter_id, version, slot, keeper_id, wrapped_holder_secret, pinned_recipient_letterbox_public
)
SELECT
  '22222222-2222-4222-8222-222222222222', 1, 'a',
  'c3333333-3333-3333-3333-333333333333',
  tests_dummy_holder(),
  lb.public_key
FROM public.letterbox_keys AS lb
WHERE lb.user_id = 'b2222222-2222-2222-2222-222222222222'
LIMIT 1;

DELETE FROM public.space_members
WHERE user_id = 'c3333333-3333-3333-3333-333333333333'
  AND family_space_id = (SELECT space_id FROM fx);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.letter_events
    WHERE letter_id = '22222222-2222-4222-8222-222222222222'
      AND event_type = 'keeper_left'
  ),
  'keeper leave records keeper_left event'
);

SELECT * FROM finish();
ROLLBACK;
