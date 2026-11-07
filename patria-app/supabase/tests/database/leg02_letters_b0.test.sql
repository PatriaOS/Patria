-- pgTAP: LEG02 Slice B0 — set_letter_open_date + trigger_at protection + pg_cron.
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

SELECT tests_create_auth_user('a1111111-1111-1111-1111-111111111111', 'author-b0@example.com', 'Author');
SELECT tests_create_auth_user('b2222222-2222-2222-2222-222222222222', 'recip-b0@example.com', 'Recipient');
SELECT tests_create_auth_user('c3333333-3333-3333-3333-333333333333', 'other-b0@example.com', 'Other');

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('LEG02 B0', 'Mom', 'America/Chicago');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM public.family_spaces WHERE name = 'LEG02 B0') AS space_id;
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

SELECT has_function('public'::name, 'set_letter_open_date'::name, ARRAY['uuid', 'timestamptz']);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
  'pg_cron extension is installed'
);
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'patria-mark-due-letters' AND active),
  'patria-mark-due-letters cron job is scheduled and active'
);

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.letters (
  id, family_space_id, author_id, recipient_id, from_label, visibility, trigger_at, status
)
SELECT
  'e0b00000-0000-0000-0000-000000000001',
  space_id,
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'Mum',
  'surprise',
  now() + interval '100 days',
  'draft'
FROM fx;
SELECT public.seal_letter(
  'e0b00000-0000-0000-0000-000000000001',
  1, 'Mum', 'surprise', now() + interval '100 days',
  tests_dummy_nonce(), tests_dummy_ct(), NULL,
  'bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234bbbb1234',
  'bbbb1234bbbb',
  tests_dummy_nonce(), tests_dummy_cek(),
  tests_dummy_box(), tests_dummy_p256(), tests_dummy_box(), false, NULL
);

SELECT lives_ok(
  $sql$SELECT public.set_letter_open_date(
    'e0b00000-0000-0000-0000-000000000001',
    now() + interval '200 days'
  )$sql$,
  'author set_letter_open_date while sealed'
);
SELECT ok(
  (SELECT trigger_at > now() + interval '150 days'
   FROM public.letters_for_api WHERE id = 'e0b00000-0000-0000-0000-000000000001'),
  'trigger_at moved forward (date letter via letters_for_api)'
);
SELECT ok(
  (SELECT count(*)::int FROM public.letter_events
   WHERE letter_id = 'e0b00000-0000-0000-0000-000000000001'
     AND event_type = 'open_date_changed') >= 1,
  'open_date_changed event recorded'
);

SELECT throws_ok(
  $sql$UPDATE public.letters
    SET trigger_at = now() + interval '300 days'
    WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'authenticated cannot UPDATE trigger_at directly'
);
-- Allow flag is transaction-scoped (set_config third arg true). Even with it on,
-- column privileges still block a client UPDATE of trigger_at.
SELECT lives_ok(
  $sql$SELECT set_config('patria.allow_letter_trigger_change', '1', true)$sql$,
  'authenticated may set the allow GUC in this transaction'
);
SELECT throws_ok(
  $sql$UPDATE public.letters
    SET trigger_at = now() + interval '350 days'
    WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501',
  NULL,
  'authenticated cannot UPDATE trigger_at even after set_config allow flag'
);
SELECT ok(
  position(
    $$set_config('patria.allow_letter_trigger_change', '1', true)$$
    in pg_get_functiondef('public.set_letter_open_date(uuid,timestamptz)'::regprocedure)
  ) > 0,
  'set_letter_open_date uses set_config(..., true) so the allow flag is transaction scoped'
);
SELECT throws_ok(
  $sql$SELECT public.set_letter_open_date(
    'e0b00000-0000-0000-0000-000000000001',
    now() - interval '1 day'
  )$sql$,
  '42501',
  'Not allowed',
  'past open date is refused'
);
RESET ROLE;

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.set_letter_open_date(
    'e0b00000-0000-0000-0000-000000000001',
    now() + interval '250 days'
  )$sql$,
  '42501',
  'Not allowed',
  'recipient cannot set_letter_open_date'
);
RESET ROLE;

SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.set_letter_open_date(
    'e0b00000-0000-0000-0000-000000000001',
    now() + interval '250 days'
  )$sql$,
  '42501',
  'Not allowed',
  'other member cannot set_letter_open_date'
);
RESET ROLE;

-- postgres may still advance trigger_at for local tests; then mark pending
UPDATE public.letters
SET status = 'pending',
    pending_at = now()
WHERE id = 'e0b00000-0000-0000-0000-000000000001';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$SELECT public.set_letter_open_date(
    'e0b00000-0000-0000-0000-000000000001',
    now() + interval '10 days'
  )$sql$,
  '42501',
  'Not allowed',
  'author cannot change open date after pending'
);

-- App only INSERTs drafts; no authenticated UPDATE on any letters column.
-- Put the letter back to sealed for author UPDATE probes (postgres role).
RESET ROLE;
UPDATE public.letters
SET status = 'sealed', pending_at = NULL
WHERE id = 'e0b00000-0000-0000-0000-000000000001';

SELECT tests_jwt('a1111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$UPDATE public.letters SET status = 'released' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE status'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET version = 99 WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE version'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET recipient_id = 'c3333333-3333-3333-3333-333333333333' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE recipient_id'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET author_id = 'b2222222-2222-2222-2222-222222222222' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE author_id'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET family_space_id = family_space_id WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE family_space_id'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET content_hash = 'x' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE content_hash'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET fingerprint = 'x' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE fingerprint'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET recipient_left_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE recipient_left_at'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET sealed_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE sealed_at'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET pending_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE pending_at'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET released_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE released_at'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET withdrawn_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE withdrawn_at'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET from_label = 'Hacked' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE from_label directly'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET id = 'e0b00000-0000-0000-0000-000000000099' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE id'
);
SELECT throws_ok(
  $sql$UPDATE public.letters SET created_at = now() WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'author cannot UPDATE created_at'
);
RESET ROLE;

SELECT tests_jwt('b2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$UPDATE public.letters SET from_label = 'Hacked' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'recipient cannot UPDATE any letters column'
);
RESET ROLE;

SELECT tests_jwt('c3333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$UPDATE public.letters SET from_label = 'Hacked' WHERE id = 'e0b00000-0000-0000-0000-000000000001'$sql$,
  '42501', NULL, 'other member cannot UPDATE any letters column'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
