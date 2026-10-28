-- pgTAP: GOV02 / D37 frequency, RSVP, move, SQL next occurrence.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = extensions, public, auth;

SELECT plan(25);

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

SELECT tests_create_auth_user('b0111111-1111-1111-1111-111111111111', 'd37-admin@example.com', 'D37 Admin');
SELECT tests_create_auth_user('b0222222-2222-2222-2222-222222222222', 'd37-co@example.com', 'D37 Co');
SELECT tests_create_auth_user('b0333333-3333-3333-3333-333333333333', 'd37-ext@example.com', 'D37 Ext');
SELECT tests_create_auth_user('b0444444-4444-4444-4444-444444444444', 'd37-other@example.com', 'D37 Other');

SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.create_family_space('D37 Family', 'Mom');
RESET ROLE;

CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.family_spaces WHERE name = 'D37 Family') AS space,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'D37 Family' AND c.kind = 'household'
  ) AS household,
  (
    SELECT c.id FROM public.circles AS c
    JOIN public.family_spaces AS s ON s.id = c.family_space_id
    WHERE s.name = 'D37 Family' AND c.kind = 'extended_family'
  ) AS extended;
GRANT SELECT ON TABLE fx TO authenticated, anon;

INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT space, 'b0222222-2222-2222-2222-222222222222'::uuid, 'co_admin', 'Dad'
FROM fx;
INSERT INTO public.space_members (family_space_id, user_id, role, relationship_label)
SELECT space, 'b0333333-3333-3333-3333-333333333333'::uuid, 'extended_relative', NULL
FROM fx;

-- Occurrence fixtures (mirror syncOccurrenceCases.json).
CREATE TEMP TABLE occ_cases (
  id text PRIMARY KEY,
  frequency public.sync_frequency,
  monthly_mode public.sync_monthly_mode,
  monthly_ordinal smallint,
  month_day smallint,
  timezone text,
  weekday smallint,
  local_time time,
  anchor_local_date date,
  after_ts timestamptz,
  expected timestamptz
);

INSERT INTO occ_cases VALUES
  ('weekly_chicago_spring_dst', 'weekly', NULL, NULL, NULL, 'America/Chicago', 0, '18:30', NULL,
   '2026-03-07 12:00:00+00', '2026-03-08 23:30:00+00'),
  ('weekly_chicago_fall_dst', 'weekly', NULL, NULL, NULL, 'America/Chicago', 0, '18:30', NULL,
   '2026-10-31 12:00:00+00', '2026-11-02 00:30:00+00'),
  ('biweekly_across_spring_dst', 'every_two_weeks', NULL, NULL, NULL, 'America/Chicago', 0, '18:30', '2026-03-01',
   '2026-03-01 12:00:00+00', '2026-03-02 00:30:00+00'),
  ('biweekly_second_slot', 'every_two_weeks', NULL, NULL, NULL, 'America/Chicago', 0, '18:30', '2026-03-01',
   '2026-03-02 00:30:00+00', '2026-03-15 23:30:00+00'),
  ('monthly_same_date_31_february', 'monthly', 'same_date', NULL, 31, 'America/Chicago', 0, '19:00', NULL,
   '2026-02-01 12:00:00+00', '2026-03-01 01:00:00+00'),
  ('monthly_same_date_31_april', 'monthly', 'same_date', NULL, 31, 'America/Chicago', 0, '19:00', NULL,
   '2026-04-01 12:00:00+00', '2026-05-01 00:00:00+00'),
  ('monthly_first_sunday', 'monthly', 'same_weekday', 1, NULL, 'America/Chicago', 0, '18:30', NULL,
   '2026-05-01 12:00:00+00', '2026-05-03 23:30:00+00'),
  ('monthly_last_sunday', 'monthly', 'same_weekday', -1, NULL, 'America/Chicago', 0, '18:30', NULL,
   '2026-05-01 12:00:00+00', '2026-05-31 23:30:00+00');

-- Build a real schedule row shape via a disposable table clone of columns.
CREATE TEMP TABLE occ_results AS
SELECT
  c.id,
  public.next_sync_occurrence(
    (
      SELECT ROW(
        fx.space,
        c.weekday,
        c.local_time,
        c.timezone,
        fx.household,
        NULL::uuid,
        now(),
        now(),
        c.frequency,
        c.monthly_mode,
        c.monthly_ordinal,
        c.month_day,
        coalesce(c.anchor_local_date, DATE '2026-01-01')
      )::public.sync_schedules
      FROM fx
    ),
    c.after_ts
  ) AS got,
  c.expected
FROM occ_cases AS c;

SELECT is(got, expected, id)
FROM occ_results
ORDER BY id;

-- Schedule + RSVP setup.
SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.upsert_sync_schedule(
  (SELECT space FROM fx),
  0::smallint,
  '18:30'::time,
  'America/Chicago',
  (SELECT household FROM fx),
  'weekly'
);
RESET ROLE;

-- Pin upcoming far enough ahead for answer writes.
UPDATE public.sync_meetings
SET scheduled_for = now() + INTERVAL '7 days'
WHERE family_space_id = (SELECT space FROM fx)
  AND status = 'upcoming';

CREATE TEMP TABLE meet AS
SELECT id AS meeting_id
FROM public.sync_meetings
WHERE family_space_id = (SELECT space FROM fx)
  AND status = 'upcoming'
LIMIT 1;
GRANT SELECT ON TABLE meet TO authenticated, anon;

-- Co-admin answers Going.
SELECT tests_jwt('b0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.set_sync_meeting_answer(
    (SELECT meeting_id FROM meet),
    'going'::public.sync_rsvp
  )$$,
  'circle member can answer Going'
);
SELECT is(
  (SELECT answer::text FROM public.sync_meeting_answers WHERE user_id = 'b0222222-2222-2222-2222-222222222222'),
  'going',
  'Going answer is stored'
);
-- Change to Can't make it.
SELECT public.set_sync_meeting_answer(
  (SELECT meeting_id FROM meet),
  'cant'::public.sync_rsvp
);
SELECT is(
  (SELECT answer::text FROM public.sync_meeting_answers WHERE user_id = 'b0222222-2222-2222-2222-222222222222'),
  'cant',
  'member can change answer before start'
);
RESET ROLE;

-- Admin can read answers.
SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.sync_meeting_answers),
  1,
  'circle admin can read answers'
);
RESET ROLE;

-- Extended-only cannot see Household answers or meeting.
SELECT tests_jwt('b0333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.sync_meeting_answers),
  0,
  'outside circle cannot read answers'
);
SELECT throws_ok(
  $$SELECT public.set_sync_meeting_answer(
    (SELECT meeting_id FROM meet),
    'going'::public.sync_rsvp
  )$$,
  '42501',
  'Not allowed',
  'outside circle cannot answer'
);
RESET ROLE;

-- Outsider cannot insert for another user via table.
SELECT tests_jwt('b0444444-4444-4444-4444-444444444444');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.sync_meeting_answers (meeting_id, user_id, answer)
      VALUES (%L::uuid, 'b0111111-1111-1111-1111-111111111111'::uuid, 'going')
    $sql$,
    (SELECT meeting_id FROM meet)
  ),
  '42501',
  NULL,
  'outsider cannot insert an answer row'
);
RESET ROLE;

-- Member cannot write another user's answer.
SELECT tests_jwt('b0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.sync_meeting_answers (meeting_id, user_id, answer)
      VALUES (%L::uuid, 'b0111111-1111-1111-1111-111111111111'::uuid, 'going')
    $sql$,
    (SELECT meeting_id FROM meet)
  ),
  '42501',
  NULL,
  'member cannot insert an answer for someone else'
);
RESET ROLE;

-- Move this meeting: non-admin rejected.
SELECT tests_jwt('b0333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$
      SELECT public.move_sync_meeting(%L::uuid, now() + INTERVAL '2 days')
    $sql$,
    (SELECT meeting_id FROM meet)
  ),
  '42501',
  'Not allowed',
  'non-admin cannot move a meeting'
);
RESET ROLE;

-- Move rejects past time.
SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $sql$
      SELECT public.move_sync_meeting(%L::uuid, now() - INTERVAL '1 hour')
    $sql$,
    (SELECT meeting_id FROM meet)
  ),
  '22023',
  'Not allowed',
  'move_sync_meeting rejects a time in the past'
);

-- Move success clears answers.
SELECT ok(
  (public.move_sync_meeting(
    (SELECT meeting_id FROM meet),
    now() + INTERVAL '3 days'
  )).moved_individually,
  'move_sync_meeting sets moved_individually'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_meeting_answers WHERE meeting_id = (SELECT meeting_id FROM meet)),
  0,
  'move this meeting clears answers on the affected meeting'
);
RESET ROLE;

-- Re-answer, then all-future schedule change clears answers on unmoved meeting.
-- First clear moved flag / set unmoved upcoming for series test.
UPDATE public.sync_meetings
SET moved_individually = false,
    scheduled_for = now() + INTERVAL '10 days'
WHERE id = (SELECT meeting_id FROM meet);

SELECT tests_jwt('b0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.set_sync_meeting_answer(
  (SELECT meeting_id FROM meet),
  'going'::public.sync_rsvp
);
RESET ROLE;

SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (
    public.upsert_sync_schedule(
      (SELECT space FROM fx),
      1::smallint,
      '19:00'::time,
      'America/Chicago',
      (SELECT household FROM fx),
      'weekly'
    )->>'moved_preserved'
  ),
  'false',
  'all-future schedule change retimes an unmoved upcoming'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_meeting_answers WHERE meeting_id = (SELECT meeting_id FROM meet)),
  0,
  'all-future schedule change clears answers on the affected upcoming'
);
RESET ROLE;

-- Moved upcoming is preserved across all-future.
UPDATE public.sync_meetings
SET moved_individually = true,
    scheduled_for = now() + INTERVAL '4 days'
WHERE id = (SELECT meeting_id FROM meet);

SELECT tests_jwt('b0111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT is(
  (
    public.upsert_sync_schedule(
      (SELECT space FROM fx),
      2::smallint,
      '20:00'::time,
      'America/Chicago',
      (SELECT household FROM fx),
      'weekly'
    )->>'moved_preserved'
  ),
  'true',
  'all-future leaves a moved upcoming alone'
);
SELECT ok(
  (
    SELECT moved_individually AND scheduled_for IS DISTINCT FROM public.next_sync_occurrence(s, now())
    FROM public.sync_meetings AS m
    JOIN public.sync_schedules AS s ON s.family_space_id = m.family_space_id
    WHERE m.id = (SELECT meeting_id FROM meet)
  ),
  'moved upcoming stays off the new series slot'
);
RESET ROLE;

-- Answer rejected after scheduled_for (plant past upcoming then try).
UPDATE public.sync_meetings
SET scheduled_for = now() - INTERVAL '1 minute',
    moved_individually = false,
    status = 'upcoming'
WHERE id = (SELECT meeting_id FROM meet);

SELECT tests_jwt('b0222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.set_sync_meeting_answer(
    (SELECT meeting_id FROM meet),
    'going'::public.sync_rsvp
  )$$,
  'P0001',
  'Not allowed',
  'answer rejected after scheduled start'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
