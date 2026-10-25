-- pgTAP: GOV02 / D35 Weekly Family Sync — circle freeze, carry-over, ensure_next, CAS start.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(27);

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

SELECT tests_create_auth_user('a0111111-1111-1111-1111-111111111111', 'gov02-admin@example.com', 'Gov Admin');
SELECT tests_create_auth_user('a0222222-2222-2222-2222-222222222222', 'gov02-co@example.com', 'Gov Co');
SELECT tests_create_auth_user('a0333333-3333-3333-3333-333333333333', 'gov02-ext@example.com', 'Gov Ext');
SELECT tests_create_auth_user('a0444444-4444-4444-4444-444444444444', 'gov02-other@example.com', 'Gov Other');

SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Gov02 Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'Gov02 Family') AS space,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'Gov02 Family' AND c.kind = 'household'
  ) AS household,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'Gov02 Family' AND c.kind = 'extended_family'
  ) AS extended;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT space, 'a0222222-2222-2222-2222-222222222222'::uuid, 'co_admin', 'Dad'
FROM fx;
INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT space, 'a0333333-3333-3333-3333-333333333333'::uuid, 'extended_relative', NULL
FROM fx;

-- Schedule on Household.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.upsert_sync_schedule(
  (SELECT space FROM fx),
  0::smallint,
  '18:30'::time,
  'America/Chicago',
  (SELECT household FROM fx),
  '2030-01-06 00:30:00+00'::timestamptz
);
RESET ROLE;

SELECT is(
  (SELECT circle_id FROM public.sync_schedules WHERE family_space_id = (SELECT space FROM fx)),
  (SELECT household FROM fx),
  'schedule stores Household circle'
);

SELECT is(
  (SELECT status::text FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx)),
  'upcoming',
  'upsert creates one upcoming meeting'
);

SELECT is(
  (SELECT circle_id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx)),
  (SELECT household FROM fx),
  'upcoming meeting freezes Household circle at creation'
);

-- Idempotent ensure_next_meeting.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  public.ensure_next_meeting(
    (SELECT space FROM fx),
    '2030-01-06 00:30:00+00'::timestamptz
  ),
  public.ensure_next_meeting(
    (SELECT space FROM fx),
    '2030-01-06 00:30:00+00'::timestamptz
  ),
  'ensure_next_meeting is idempotent for the same scheduled_for'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx)),
  1,
  'two phones cannot create duplicate upcoming rows'
);

-- Agenda on Household meeting; extended relative cannot see it.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.sync_agenda_items (
  family_space_id, meeting_id, kind, title, author_user_id
)
SELECT
  (SELECT space FROM fx),
  m.id,
  'win',
  'Picnic win',
  'a0111111-1111-1111-1111-111111111111'::uuid
FROM public.sync_meetings AS m
WHERE m.family_space_id = (SELECT space FROM fx);
RESET ROLE;

SELECT tests_jwt('a0333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.sync_agenda_items),
  0,
  'extended relative outside Household cannot see Household agenda'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_meetings),
  0,
  'extended relative outside Household cannot see Household meeting'
);
RESET ROLE;

SELECT tests_jwt('a0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.sync_agenda_items),
  1,
  'co-admin in Household can see agenda'
);
RESET ROLE;

-- Widen schedule to Extended Family; past/upcoming Household meeting stays frozen.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.upsert_sync_schedule(
  (SELECT space FROM fx),
  0::smallint,
  '19:00'::time,
  'America/Chicago',
  (SELECT extended FROM fx),
  '2030-01-06 01:00:00+00'::timestamptz
);
RESET ROLE;

SELECT is(
  (SELECT circle_id FROM public.sync_schedules WHERE family_space_id = (SELECT space FROM fx)),
  (SELECT extended FROM fx),
  'schedule can move to Extended Family'
);

SELECT is(
  (SELECT circle_id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx)),
  (SELECT household FROM fx),
  'widening schedule never rewrites the upcoming meeting circle'
);

SELECT is(
  (SELECT scheduled_for FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx)),
  '2030-01-06 01:00:00+00'::timestamptz,
  'changing day or time moves upcoming scheduled_for'
);

SELECT tests_jwt('a0333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.sync_meetings),
  0,
  'after widen, Household meeting still hidden from extended-only member'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_agenda_items),
  0,
  'after widen, Household agenda still hidden from extended-only member'
);
RESET ROLE;

-- CAS start: only one admin wins.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (public.start_sync_meeting(
    (SELECT id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx))
  )).status::text,
  'in_progress',
  'admin can start upcoming meeting'
);
RESET ROLE;

SELECT tests_jwt('a0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    'SELECT public.start_sync_meeting(%L::uuid)',
    (SELECT id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx))
  ),
  'P0001',
  'Not allowed',
  'second admin cannot start an already in-progress meeting'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::int
    FROM public.sync_meetings
    WHERE family_space_id = (SELECT space FROM fx)
      AND status = 'in_progress'
  ),
  1,
  'at most one in_progress meeting per family'
);

SELECT is(
  (
    SELECT started_by
    FROM public.sync_meetings
    WHERE family_space_id = (SELECT space FROM fx)
  ),
  'a0111111-1111-1111-1111-111111111111'::uuid,
  'started_by is the winning admin'
);

-- Finish with undiscussed item; next circle is Extended (wider) → no carry-over.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.finish_sync_meeting(
  (SELECT id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx) AND status = 'in_progress'),
  'One calm week',
  '{"steps":4}'::jsonb,
  '2030-01-13 01:00:00+00'::timestamptz
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::int
    FROM public.sync_meetings
    WHERE family_space_id = (SELECT space FROM fx)
      AND status = 'finished'
  ),
  1,
  'finish marks the meeting finished'
);

SELECT is(
  (
    SELECT circle_id
    FROM public.sync_meetings
    WHERE family_space_id = (SELECT space FROM fx)
      AND status = 'upcoming'
  ),
  (SELECT extended FROM fx),
  'next meeting uses the current schedule circle (Extended)'
);

SELECT is(
  (
    SELECT meeting_id
    FROM public.sync_agenda_items
    WHERE title = 'Picnic win'
  ),
  (
    SELECT id
    FROM public.sync_meetings
    WHERE family_space_id = (SELECT space FROM fx)
      AND status = 'finished'
  ),
  'undiscussed item stays on old meeting when next circle is wider'
);

-- New Household-scoped meeting: carry-over when next is same or narrower.
SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
-- Move schedule back to Household so the next finish creates a narrower circle.
SELECT public.upsert_sync_schedule(
  (SELECT space FROM fx),
  0::smallint,
  '19:00'::time,
  'America/Chicago',
  (SELECT household FROM fx),
  '2030-01-20 01:00:00+00'::timestamptz
);
-- Current upcoming is still Extended (frozen). Finish it after starting.
SELECT public.start_sync_meeting(
  (SELECT id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx) AND status = 'upcoming')
);
INSERT INTO public.sync_agenda_items (
  family_space_id, meeting_id, kind, title, author_user_id
)
SELECT
  (SELECT space FROM fx),
  m.id,
  'discuss',
  'Carry me',
  'a0111111-1111-1111-1111-111111111111'::uuid
FROM public.sync_meetings AS m
WHERE m.family_space_id = (SELECT space FROM fx)
  AND m.status = 'in_progress';
SELECT public.finish_sync_meeting(
  (SELECT id FROM public.sync_meetings WHERE family_space_id = (SELECT space FROM fx) AND status = 'in_progress'),
  'Priority two',
  '{}'::jsonb,
  '2030-01-27 01:00:00+00'::timestamptz
);
RESET ROLE;

SELECT is(
  (
    SELECT m.circle_id
    FROM public.sync_agenda_items AS a
    JOIN public.sync_meetings AS m ON m.id = a.meeting_id
    WHERE a.title = 'Carry me'
  ),
  (SELECT household FROM fx),
  'undiscussed item carries to next when next circle is same or narrower'
);

SELECT is(
  (
    SELECT m.status::text
    FROM public.sync_agenda_items AS a
    JOIN public.sync_meetings AS m ON m.id = a.meeting_id
    WHERE a.title = 'Carry me'
  ),
  'upcoming',
  'carried item lives on the new upcoming meeting'
);

-- Outsider sees nothing.
SELECT tests_jwt('a0444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.sync_schedules), 0, 'outsider sees no schedule');
SELECT is((SELECT count(*)::int FROM public.sync_meetings), 0, 'outsider sees no meetings');
SELECT is((SELECT count(*)::int FROM public.sync_agenda_items), 0, 'outsider sees no agenda');
RESET ROLE;

-- Child attribution must be same family.
INSERT INTO public.child_profiles (id, family_space_id, display_name, created_by)
SELECT
  'c0111111-1111-1111-1111-111111111111'::uuid,
  (SELECT space FROM fx),
  'Lily',
  'a0111111-1111-1111-1111-111111111111'::uuid;

SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.sync_agenda_items (
  family_space_id, meeting_id, kind, title, author_user_id, attributed_child_id
)
SELECT
  (SELECT space FROM fx),
  m.id,
  'win',
  'Lily win',
  'a0111111-1111-1111-1111-111111111111'::uuid,
  'c0111111-1111-1111-1111-111111111111'::uuid
FROM public.sync_meetings AS m
WHERE m.family_space_id = (SELECT space FROM fx)
  AND m.status = 'upcoming';
RESET ROLE;

SELECT ok(
  EXISTS (SELECT 1 FROM public.sync_agenda_items WHERE title = 'Lily win'),
  'admin can attribute agenda to a child in the same family'
);

SELECT tests_create_auth_user('a0555555-5555-5555-5555-555555555555', 'gov02-other2@example.com', 'Other Fam');
SELECT tests_jwt('a0555555-5555-5555-5555-555555555555');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('Other Gov Family', NULL);
RESET ROLE;

INSERT INTO public.child_profiles (id, family_space_id, display_name, created_by)
SELECT
  'c0222222-2222-2222-2222-222222222222'::uuid,
  (SELECT id FROM public.family_spaces WHERE name = 'Other Gov Family'),
  'Other Kid',
  'a0555555-5555-5555-5555-555555555555'::uuid;

SELECT tests_jwt('a0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.sync_agenda_items (
        family_space_id, meeting_id, kind, title, author_user_id, attributed_child_id
      ) VALUES (
        %L::uuid,
        (SELECT id FROM public.sync_meetings
         WHERE family_space_id = %L::uuid AND status = 'upcoming' LIMIT 1),
        'win',
        'Bad child',
        'a0111111-1111-1111-1111-111111111111'::uuid,
        'c0222222-2222-2222-2222-222222222222'::uuid
      )
    $sql$,
    (SELECT space FROM fx),
    (SELECT space FROM fx)
  ),
  '42501',
  'Not allowed',
  'attributed child from another family is refused'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
