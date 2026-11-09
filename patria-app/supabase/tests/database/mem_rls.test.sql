-- pgTAP: MEM01 slice 1 memory_items and storage.objects (D29 role table).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth, storage;

SELECT plan(57);

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

SELECT tests_create_auth_user('11111111-1111-1111-1111-111111111111', 'elena-mem@example.com', 'Elena');
SELECT tests_create_auth_user('22222222-2222-2222-2222-222222222222', 'marco-mem@example.com', 'Marco');
SELECT tests_create_auth_user('33333333-3333-3333-3333-333333333333', 'jordan-mem@example.com', 'Jordan');
SELECT tests_create_auth_user('44444444-4444-4444-4444-444444444444', 'rosa-mem@example.com', 'Rosa');
SELECT tests_create_auth_user('55555555-5555-5555-5555-555555555555', 'alex-mem@example.com', 'Alex');
SELECT tests_create_auth_user('77777777-7777-7777-7777-777777777777', 'pat-mem@example.com', 'Pat');
SELECT tests_create_auth_user('99999999-9999-9999-9999-999999999999', 'chris-mem@example.com', 'Chris');
SELECT tests_create_auth_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other-mem@example.com', 'Other');

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Mem Rivera', 'Mom');
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Mem Other', NULL);
RESET ROLE;

RESET ROLE;
CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'Mem Rivera') AS rivera,
  (SELECT id FROM public.family_spaces WHERE name = 'Mem Other') AS other,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'Mem Rivera' AND c.kind = 'household'
  ) AS household,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'Mem Rivera' AND c.kind = 'extended_family'
  ) AS extended;
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

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '22222222-2222-2222-2222-222222222222');
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '33333333-3333-3333-3333-333333333333');
SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '44444444-4444-4444-4444-444444444444');
SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '55555555-5555-5555-5555-555555555555');
SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '77777777-7777-7777-7777-777777777777');
SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SELECT public.ensure_only_me_circle((SELECT rivera FROM fx), '99999999-9999-9999-9999-999999999999');

INSERT INTO public.circle_members (circle_id, user_id)
SELECT household, u FROM fx
CROSS JOIN (VALUES
  ('22222222-2222-2222-2222-222222222222'::uuid),
  ('33333333-3333-3333-3333-333333333333'::uuid),
  ('44444444-4444-4444-4444-444444444444'::uuid)
) AS x(u)
WHERE NOT EXISTS (
  SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = household AND cm.user_id = u
);

INSERT INTO public.circle_members (circle_id, user_id)
SELECT extended, u FROM fx
CROSS JOIN (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid),
  ('44444444-4444-4444-4444-444444444444'::uuid),
  ('55555555-5555-5555-5555-555555555555'::uuid)
) AS x(u)
WHERE NOT EXISTS (
  SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = extended AND cm.user_id = u
);

-- is_memory_role must check the other user (not the caller via space_role).
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SELECT ok(
  public.is_memory_role(
    (SELECT rivera FROM fx),
    '22222222-2222-2222-2222-222222222222'
  ),
  'admin caller: is_memory_role true for co_admin member'
);
SELECT ok(
  NOT public.is_memory_role(
    (SELECT rivera FROM fx),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'admin caller: is_memory_role false for user in another family'
);

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

INSERT INTO public.memory_items (
  id, family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  (SELECT rivera FROM fx),
  (SELECT household FROM fx),
  '11111111-1111-1111-1111-111111111111',
  'HH',
  now(),
  800,
  600,
  'uploading'
);

INSERT INTO public.memory_items (
  id, family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
) VALUES (
  'a2222222-2222-2222-2222-222222222222',
  (SELECT rivera FROM fx),
  (SELECT extended FROM fx),
  '11111111-1111-1111-1111-111111111111',
  'EXT',
  now(),
  800,
  600,
  'uploading'
);

INSERT INTO public.memory_items (
  id, family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
) VALUES (
  'a3333333-3333-3333-3333-333333333333',
  (SELECT rivera FROM fx),
  (
    SELECT id FROM public.circles
    WHERE family_space_id = (SELECT rivera FROM fx)
      AND kind = 'only_me'
      AND owner_user_id = '11111111-1111-1111-1111-111111111111'
  ),
  '11111111-1111-1111-1111-111111111111',
  'ME',
  now(),
  800,
  600,
  'uploading'
);

INSERT INTO public.memory_items (
  id, family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
) VALUES (
  'a4444444-4444-4444-4444-444444444444',
  (SELECT rivera FROM fx),
  (SELECT household FROM fx),
  '11111111-1111-1111-1111-111111111111',
  'UP',
  now(),
  800,
  600,
  'uploading'
);
RESET ROLE;

-- Storage objects only while uploading.
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a1111111-1111-1111-1111-111111111111/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'uploader can insert household full.jpg'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a1111111-1111-1111-1111-111111111111/thumb.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'uploader can insert household thumb.jpg'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a2222222-2222-2222-2222-222222222222/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'uploader can insert extended full.jpg'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a2222222-2222-2222-2222-222222222222/thumb.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'uploader can insert extended thumb.jpg'
);
SELECT lives_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a3333333-3333-3333-3333-333333333333/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  'uploader can insert only-me full.jpg'
);
SELECT throws_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT other FROM fx)::text || '/a1111111-1111-1111-1111-111111111111/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'cannot upload into another family folder'
);
SELECT throws_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'cannot upload into another item folder'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
INSERT INTO public.memory_items (
  id, family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
) VALUES (
  'a5555555-5555-5555-5555-555555555555',
  (SELECT rivera FROM fx),
  (SELECT household FROM fx),
  '22222222-2222-2222-2222-222222222222',
  'MARCO',
  now(),
  100,
  100,
  'uploading'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO storage.objects (bucket_id, name, owner)
       VALUES (
         'memories',
         (SELECT rivera FROM fx)::text || '/a5555555-5555-5555-5555-555555555555/full.jpg',
         '11111111-1111-1111-1111-111111111111'
       )$sql$,
  '42501',
  NULL,
  'cannot upload into someone else''s item'
);
UPDATE public.memory_items SET status = 'ready'
 WHERE id IN (
   'a1111111-1111-1111-1111-111111111111',
   'a2222222-2222-2222-2222-222222222222',
   'a3333333-3333-3333-3333-333333333333'
 );
RESET ROLE;

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.memory_items'::regclass),
  'RLS forced on memory_items'
);
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'memories'),
  false,
  'memories bucket is not public'
);

-- Ready rows: who can read records (both ways).
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'), 1, 'admin reads household');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'), 1, 'admin reads extended');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'ME'), 1, 'admin reads own Only Me');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'UP'), 1, 'uploader reads own uploading row');
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'), 1, 'co admin reads household');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'), 1, 'co admin in Extended Family reads it');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'ME'), 0, 'co admin cannot read Only Me');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'UP'), 0, 'co admin cannot see uploading');
RESET ROLE;

SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'), 1, 'teen reads household');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'), 1, 'teen in Extended Family reads it');
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'), 1, 'elder reads household');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'), 1, 'elder in extended reads it');
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'), 0, 'extended relative cannot read household');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'), 1, 'extended relative reads extended');
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE caption = 'ME'), 0, 'extended relative cannot read Only Me');
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items), 0, 'caregiver sees no memories');
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items), 0, 'successor sees no memories');
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.memory_items WHERE family_space_id = (SELECT rivera FROM fx)), 0, 'other family sees no memories');
RESET ROLE;

-- Files follow the same helper.
SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'memories'
      AND name LIKE '%/a1111111-1111-1111-1111-111111111111/%'),
  0,
  'extended relative cannot read household files'
);
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'memories'
      AND name LIKE '%/a2222222-2222-2222-2222-222222222222/%'),
  2,
  'extended relative can read extended files'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'memories'
      AND name LIKE '%/a1111111-1111-1111-1111-111111111111/%'),
  2,
  'co admin can read household files'
);
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'memories'
      AND name LIKE '%/a2222222-2222-2222-2222-222222222222/%'),
  2,
  'co admin can read extended files'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'memories'), 0, 'caregiver cannot read memory files');
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'memories'), 0, 'successor cannot read memory files');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'memories'), 0, 'anon cannot read memory files');
SELECT is((SELECT count(*)::int FROM public.memory_items), 0, 'anon cannot read memory rows');
RESET ROLE;

-- Insert by role into household vs extended.
SELECT tests_jwt('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT household FROM fx),
         '33333333-3333-3333-3333-333333333333',
         'TEEN-HH', now(), 10, 10, 'uploading'
       )$sql$,
  'teen can insert into household'
);
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT household FROM fx),
         '33333333-3333-3333-3333-333333333333',
         'TEEN-HH-RET', now(), 10, 10, 'uploading'
       ) RETURNING id$sql$,
  'uploader INSERT RETURNING is allowed for their uploading row'
);
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT extended FROM fx),
         '33333333-3333-3333-3333-333333333333',
         'TEEN-EXT', now(), 10, 10, 'uploading'
       )$sql$,
  'teen can insert into Extended Family'
);
RESET ROLE;

SELECT tests_jwt('44444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT extended FROM fx),
         '44444444-4444-4444-4444-444444444444',
         'ELDER-EXT', now(), 10, 10, 'uploading'
       )$sql$,
  'elder can insert into extended'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT extended FROM fx),
         '55555555-5555-5555-5555-555555555555',
         'EXT-EXT', now(), 10, 10, 'uploading'
       )$sql$,
  'extended relative can insert into extended'
);
SELECT throws_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT household FROM fx),
         '55555555-5555-5555-5555-555555555555',
         'EXT-HH', now(), 10, 10, 'uploading'
       )$sql$,
  '42501',
  NULL,
  'extended relative cannot insert into household'
);
RESET ROLE;

SELECT tests_jwt('77777777-7777-7777-7777-777777777777');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT household FROM fx),
         '77777777-7777-7777-7777-777777777777',
         'CARE', now(), 10, 10, 'uploading'
       )$sql$,
  '42501',
  NULL,
  'caregiver cannot insert memories'
);
RESET ROLE;

SELECT tests_jwt('99999999-9999-9999-9999-999999999999');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (
           SELECT id FROM public.circles
           WHERE family_space_id = (SELECT rivera FROM fx)
             AND kind = 'only_me'
             AND owner_user_id = '99999999-9999-9999-9999-999999999999'
         ),
         '99999999-9999-9999-9999-999999999999',
         'SUCC', now(), 10, 10, 'uploading'
       )$sql$,
  '42501',
  NULL,
  'successor cannot insert memories'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.memory_items WHERE caption = 'EXT'),
  1,
  'co admin can see an Extended Family photo they did not upload'
);
DELETE FROM public.memory_items WHERE caption = 'HH';
SELECT is(
  (SELECT count(*)::int FROM public.memory_items WHERE caption = 'HH'),
  1,
  'co admin delete of admin household photo changes nothing'
);
RESET ROLE;

SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $sql$UPDATE public.memory_items SET circle_id = (SELECT household FROM fx)
       WHERE id = 'a2222222-2222-2222-2222-222222222222'$sql$,
  'uploader can move own photo'
);
SELECT ok(
  public.can_delete_memory_object(
    (SELECT rivera FROM fx)::text || '/a1111111-1111-1111-1111-111111111111/full.jpg'
  ),
  'uploader may delete own files through Storage'
);
SELECT lives_ok(
  $sql$DELETE FROM public.memory_items WHERE id = 'a1111111-1111-1111-1111-111111111111'$sql$,
  'uploader can delete own row after files'
);
RESET ROLE;

SELECT tests_jwt('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.can_delete_memory_object(
    (SELECT rivera FROM fx)::text || '/a2222222-2222-2222-2222-222222222222/full.jpg'
  ),
  'non-uploader cannot delete another member''s files'
);
RESET ROLE;

-- Removed member loses access.
SELECT tests_jwt('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
DELETE FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555';
SELECT is(
  (SELECT count(*)::int FROM public.space_members WHERE user_id = '55555555-5555-5555-5555-555555555555'),
  0,
  'admin removes the extended relative'
);
RESET ROLE;

SELECT tests_jwt('55555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT coalesce(string_agg(caption, ',' ORDER BY caption), '') FROM public.memory_items),
  '',
  'removed member sees no memory rows'
);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'memories'), 0, 'removed member sees no memory files');
SELECT ok(
  NOT public.can_view_memory('a2222222-2222-2222-2222-222222222222'),
  'removed member cannot view an extended photo'
);
RESET ROLE;

SELECT tests_jwt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $sql$INSERT INTO public.memory_items (
         family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
       ) VALUES (
         (SELECT rivera FROM fx),
         (SELECT household FROM fx),
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'OTHER', now(), 10, 10, 'uploading'
       )$sql$,
  '42501',
  NULL,
  'other family cannot insert into this space'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
