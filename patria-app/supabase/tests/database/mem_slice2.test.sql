-- pgTAP: MEM01 slice 2 connections, tombstones, hashes, videos (D31).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth, storage;

SELECT plan(22);

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

SELECT tests_create_auth_user('a2111111-1111-1111-1111-111111111111', 's2-admin@example.com', 'S2 Admin');
SELECT tests_create_auth_user('a2222222-2222-2222-2222-222222222222', 's2-elder@example.com', 'S2 Elder');
SELECT tests_create_auth_user('a2333333-3333-3333-3333-333333333333', 's2-ext@example.com', 'S2 Ext');
SELECT tests_create_auth_user('a2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's2-other@example.com', 'S2 Other');

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Slice2 Family', 'Mom');
RESET ROLE;

SELECT tests_jwt('a2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Slice2 Other', NULL);
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'Slice2 Family') AS space,
  (SELECT id FROM public.family_spaces WHERE name = 'Slice2 Other') AS other,
  (
    SELECT c.id FROM public.circles c
    JOIN public.family_spaces s ON s.id = c.family_space_id
    WHERE s.name = 'Slice2 Family' AND c.kind = 'household'
  ) AS household,
  (
    SELECT c.id FROM public.circles c
    JOIN public.family_spaces s ON s.id = c.family_space_id
    WHERE s.name = 'Slice2 Family' AND c.kind = 'extended_family'
  ) AS extended;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT space, 'a2222222-2222-2222-2222-222222222222', 'elder' FROM fx;
INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT space, 'a2333333-3333-3333-3333-333333333333', 'extended_relative' FROM fx;

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'memories'),
  52428800::bigint,
  'memories bucket allows 50 MB for video'
);
SELECT ok(
  (SELECT allowed_mime_types @> ARRAY['image/jpeg', 'video/mp4', 'video/quicktime']::text[]
     FROM storage.buckets WHERE id = 'memories'),
  'bucket allows jpeg, mp4 and quicktime'
);

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_source_keys (user_id, secret)
VALUES ('a2111111-1111-1111-1111-111111111111', decode(repeat('11', 32), 'hex'));
SELECT is((SELECT count(*)::int FROM public.memory_source_keys), 1, 'owner can store their HMAC key');
SELECT throws_ok(
  $sql$INSERT INTO public.memory_source_keys (user_id, secret)
       VALUES ('a2111111-1111-1111-1111-111111111111', decode(repeat('22', 32), 'hex'))$sql$,
  '23505',
  NULL,
  'a second insert does not create another HMAC key'
);
SELECT is(
  (SELECT encode(secret, 'hex') FROM public.memory_source_keys WHERE user_id = 'a2111111-1111-1111-1111-111111111111'),
  repeat('11', 32),
  'losing the insert race does not replace the HMAC key'
);
SELECT throws_ok(
  $sql$UPDATE public.memory_source_keys SET secret = decode(repeat('ff', 32), 'hex')$sql$,
  '42501',
  NULL,
  'HMAC key cannot be replaced'
);
SELECT is(
  encode(public.get_or_create_memory_source_key(), 'hex'),
  repeat('11', 32),
  'get_or_create returns the existing HMAC key'
);
RESET ROLE;

SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_source_keys), 0, 'other member cannot read HMAC keys');
SELECT throws_ok(
  $sql$INSERT INTO public.memory_source_keys (user_id, secret)
       VALUES ('a2111111-1111-1111-1111-111111111111', decode(repeat('22', 32), 'hex'))$sql$,
  '42501',
  NULL,
  'cannot create an HMAC key for someone else'
);
RESET ROLE;

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_library_connections (
  user_id, family_space_id, device_id, mode, circle_id, started_at
) SELECT
  'a2111111-1111-1111-1111-111111111111',
  space,
  'd2111111-1111-1111-1111-111111111111',
  'all_new',
  household,
  date_trunc('day', now())
FROM fx;
SELECT is((SELECT count(*)::int FROM public.memory_library_connections), 1, 'owner can create a connection');
RESET ROLE;

SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_library_connections), 0, 'elder cannot read another member connection');
SELECT throws_ok(
  $sql$INSERT INTO public.memory_library_connections (
         user_id, family_space_id, device_id, mode, circle_id, started_at
       ) SELECT
         'a2111111-1111-1111-1111-111111111111',
         space,
         'd2222222-2222-2222-2222-222222222222',
         'all_new',
         household,
         now()
       FROM fx$sql$,
  '42501',
  NULL,
  'cannot create a connection for someone else'
);
RESET ROLE;

SELECT tests_jwt('a2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.memory_library_connections WHERE family_space_id = (SELECT space FROM fx)),
  0,
  'other family cannot read connections'
);
RESET ROLE;

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_items (
  family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status,
  source, source_hash, added_automatically
) SELECT space, household, 'a2111111-1111-1111-1111-111111111111', 'AUTO', now(), 10, 10, 'uploading',
  'library_sync', 'hash-auto-1', true FROM fx;
UPDATE public.memory_items SET status = 'ready' WHERE caption = 'AUTO';
DELETE FROM public.memory_items WHERE caption = 'AUTO';
SELECT is(
  (SELECT count(*)::int FROM public.memory_item_tombstones WHERE source_hash = 'hash-auto-1'),
  1,
  'deleting a sync item writes a tombstone'
);
INSERT INTO public.memory_items (
  family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status,
  source, source_hash, added_automatically
) SELECT space, household, 'a2111111-1111-1111-1111-111111111111', 'HAND', now(), 10, 10, 'uploading',
  'picker', 'hash-auto-1', false FROM fx;
SELECT is(
  (SELECT count(*)::int FROM public.memory_item_tombstones WHERE source_hash = 'hash-auto-1'),
  0,
  'adding the photo by hand clears the tombstone'
);
RESET ROLE;

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_items (
  family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status,
  kind, duration_seconds, source, source_hash
) SELECT space, extended, 'a2111111-1111-1111-1111-111111111111', 'VID', now(), 10, 10, 'uploading',
  'video', 12, 'picker', 'hash-vid-1' FROM fx;
UPDATE public.memory_items SET status = 'ready' WHERE caption = 'VID';
RESET ROLE;

INSERT INTO public.space_members (family_space_id, user_id, role)
SELECT other, 'a2111111-1111-1111-1111-111111111111', 'co_admin' FROM fx;

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status,
         source, source_hash
       ) SELECT other, (
           SELECT c.id FROM public.circles c WHERE c.family_space_id = (SELECT other FROM fx) AND c.kind = 'household'
         ),
         'a2111111-1111-1111-1111-111111111111', 'OTHERFAM', now(), 10, 10, 'uploading',
         'picker', 'hash-vid-1' FROM fx$sql$,
  'same photo can still go to a different family'
);
SELECT throws_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status,
         source, source_hash
       ) SELECT space, household, 'a2111111-1111-1111-1111-111111111111', 'DUP', now(), 10, 10, 'uploading',
         'picker', 'hash-vid-1' FROM fx$sql$,
  NULL,
  NULL,
  'same photo cannot be inserted twice in one family'
);
RESET ROLE;

SELECT tests_jwt('a2333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'VID'), 1, 'extended relative sees video in Extended Family');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HAND'), 0, 'extended relative cannot see household items');
RESET ROLE;

SELECT tests_jwt('a2111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
UPDATE public.memory_items SET circle_id = (SELECT household FROM fx) WHERE caption = 'VID';
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE source_hash = 'hash-vid-1' AND family_space_id = (SELECT space FROM fx)), 1, 'moving circles does not create a new row');
RESET ROLE;

SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.memory_item_tombstones (
         uploader_id, family_space_id, source_hash
       ) SELECT 'a2111111-1111-1111-1111-111111111111', space, 'nope' FROM fx$sql$,
  '42501',
  NULL,
  'cannot write someone else tombstone'
);
RESET ROLE;

SELECT tests_jwt('a2222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_library_connections (
  user_id, family_space_id, device_id, mode, circle_id, started_at
) SELECT
  'a2222222-2222-2222-2222-222222222222',
  space,
  'd2222222-2222-2222-2222-222222222222',
  'all_new',
  household,
  now()
FROM fx;
RESET ROLE;

DELETE FROM public.space_members
WHERE user_id = 'a2222222-2222-2222-2222-222222222222'
  AND family_space_id = (SELECT space FROM fx);
SELECT is(
  (SELECT count(*)::int FROM public.memory_library_connections WHERE user_id = 'a2222222-2222-2222-2222-222222222222'),
  0,
  'leaving the family deletes the connection'
);

SELECT * FROM finish();
ROLLBACK;
