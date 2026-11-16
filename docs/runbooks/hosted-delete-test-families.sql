-- =============================================================================
-- Hosted TEST DATA ONLY — delete two locked-out / leftover test families
-- =============================================================================
-- Target names (confirm ids in section A before any delete):
--   • "The Paul family"
--   • "The Femi Family"
-- Keep auth users: femipaul7535+test1/2/3@gmail.com (do not delete auth.users).
--
-- DO NOT RUN AGAINST HOSTED until you have:
--   1) pasted the two UUIDs from A into the target CTE in B/C/D
--   2) reviewed B dry-run counts
--   3) deleted storage objects (E) — SQL does not remove Storage files
--
-- Scope: only those family_space ids (+ optional user-scoped key cleanup for the
-- three test emails in D). No other families. No other users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. List every family_space (confirm the two ids)
-- -----------------------------------------------------------------------------
SELECT
  fs.id,
  fs.name,
  fs.created_at,
  (
    SELECT count(*)::int
    FROM public.space_members AS sm
    WHERE sm.family_space_id = fs.id
  ) AS member_count
FROM public.family_spaces AS fs
ORDER BY fs.created_at;

-- Optional: pin the two by name (still confirm ids before delete)
SELECT id, name, created_at
FROM public.family_spaces
WHERE name IN ('The Paul family', 'The Femi Family')
ORDER BY name;

-- -----------------------------------------------------------------------------
-- B. Dry run — COUNTS only for the two target family_space_ids
-- Replace the two UUIDs below with the ids from A.
-- -----------------------------------------------------------------------------
WITH target AS (
  SELECT id
  FROM public.family_spaces
  WHERE id IN (
    '00000000-0000-0000-0000-000000000001'::uuid, -- The Paul family
    '00000000-0000-0000-0000-000000000002'::uuid  -- The Femi Family
  )
),
letter_ids AS (
  SELECT l.id
  FROM public.letters AS l
  WHERE l.family_space_id IN (SELECT id FROM target)
)
SELECT * FROM (
  SELECT 'family_spaces' AS tbl, count(*)::bigint AS n
  FROM public.family_spaces WHERE id IN (SELECT id FROM target)
  UNION ALL SELECT 'space_members', count(*) FROM public.space_members WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'child_profiles', count(*) FROM public.child_profiles WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'circles', count(*) FROM public.circles WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'circle_members', count(*) FROM public.circle_members cm
    JOIN public.circles c ON c.id = cm.circle_id WHERE c.family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'circle_item_type_defaults', count(*) FROM public.circle_item_type_defaults WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'invites', count(*) FROM public.invites WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'device_events', count(*) FROM public.device_events WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'device_approval_notices', count(*) FROM public.device_approval_notices WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'device_removed_notices', count(*) FROM public.device_removed_notices WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'family_key_meta', count(*) FROM public.family_key_meta WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'family_key_wraps', count(*) FROM public.family_key_wraps WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'family_key_under_recovery', count(*) FROM public.family_key_under_recovery WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'letterbox_keys', count(*) FROM public.letterbox_keys WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'letters', count(*) FROM public.letters WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'letter_payloads', count(*) FROM public.letter_payloads WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_author_shares', count(*) FROM public.letter_author_shares WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_recipient_shares', count(*) FROM public.letter_recipient_shares WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_patria_shares', count(*) FROM public.letter_patria_shares WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_events', count(*) FROM public.letter_events WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'letter_keepers', count(*) FROM public.letter_keepers WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_keeper_pair_boxes', count(*) FROM public.letter_keeper_pair_boxes WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'letter_keeper_recipient_secrets', count(*) FROM public.letter_keeper_recipient_secrets WHERE letter_id IN (SELECT id FROM letter_ids)
  UNION ALL SELECT 'memory_items', count(*) FROM public.memory_items WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'memory_item_tombstones', count(*) FROM public.memory_item_tombstones WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'memory_library_connections', count(*) FROM public.memory_library_connections WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'vault_entries', count(*) FROM public.vault_entries WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'personal_key_wraps', count(*) FROM public.personal_key_wraps WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'personal_key_under_recovery', count(*) FROM public.personal_key_under_recovery WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_public_keys', count(*) FROM public.recovery_public_keys WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_contacts', count(*) FROM public.recovery_contacts WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_contact_secrets', count(*) FROM public.recovery_contact_secrets WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_pair_wraps', count(*) FROM public.recovery_pair_wraps WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_requests', count(*) FROM public.recovery_requests WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_request_helpers', count(*) FROM public.recovery_request_helpers h
    JOIN public.recovery_requests r ON r.id = h.request_id WHERE r.family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_events', count(*) FROM public.recovery_events WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'recovery_helper_refresh_notices', count(*) FROM public.recovery_helper_refresh_notices WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_schedules', count(*) FROM public.sync_schedules WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_meetings', count(*) FROM public.sync_meetings WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_agenda_items', count(*) FROM public.sync_agenda_items WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_notes', count(*) FROM public.sync_notes WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_tasks', count(*) FROM public.sync_tasks WHERE family_space_id IN (SELECT id FROM target)
  UNION ALL SELECT 'sync_meeting_answers', count(*) FROM public.sync_meeting_answers a
    JOIN public.sync_meetings m ON m.id = a.meeting_id WHERE m.family_space_id IN (SELECT id FROM target)
  -- Storage object rows (metadata). Files still need section E.
  UNION ALL SELECT 'storage.objects (memories+vault paths)', count(*)
  FROM storage.objects AS o
  WHERE o.bucket_id IN ('memories', 'vault')
    AND EXISTS (
      SELECT 1 FROM target AS t WHERE o.name LIKE t.id::text || '/%'
    )
) AS counts
ORDER BY tbl;

-- Clearer storage breakdown (same two ids — replace placeholders):
WITH target AS (
  SELECT unnest(ARRAY[
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ]) AS id
)
SELECT o.bucket_id, count(*)::bigint AS object_rows,
       coalesce(sum(o.metadata->>'size')::bigint, 0) AS size_hint
FROM storage.objects AS o
JOIN target AS t ON o.name LIKE t.id::text || '/%'
WHERE o.bucket_id IN ('memories', 'vault')
GROUP BY o.bucket_id
ORDER BY o.bucket_id;

-- -----------------------------------------------------------------------------
-- C. Delete transaction (SQL rows only). Replace the two UUIDs.
-- Most child tables are ON DELETE CASCADE from family_spaces; letter_* cascade
-- from letters. We still delete the two family_spaces rows explicitly.
-- Final check: other families' space_members counts unchanged.
-- -----------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _patria_delete_targets ON COMMIT DROP AS
SELECT id, name
FROM public.family_spaces
WHERE id IN (
  '00000000-0000-0000-0000-000000000001'::uuid, -- The Paul family
  '00000000-0000-0000-0000-000000000002'::uuid  -- The Femi Family
);

-- Safety: must be exactly those two names
DO $$
BEGIN
  IF (SELECT count(*) FROM _patria_delete_targets) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 target family_spaces; found %. Aborting.',
      (SELECT count(*) FROM _patria_delete_targets);
  END IF;
  IF EXISTS (
    SELECT 1 FROM _patria_delete_targets
    WHERE name NOT IN ('The Paul family', 'The Femi Family')
  ) THEN
    RAISE EXCEPTION 'Target id maps to an unexpected name. Aborting.';
  END IF;
END $$;

-- Snapshot other families (must match after delete)
CREATE TEMP TABLE _patria_other_family_counts ON COMMIT DROP AS
SELECT
  fs.id,
  fs.name,
  (SELECT count(*) FROM public.space_members sm WHERE sm.family_space_id = fs.id) AS members,
  (SELECT count(*) FROM public.memory_items mi WHERE mi.family_space_id = fs.id) AS memories,
  (SELECT count(*) FROM public.vault_entries ve WHERE ve.family_space_id = fs.id) AS vault,
  (SELECT count(*) FROM public.letters l WHERE l.family_space_id = fs.id) AS letters
FROM public.family_spaces AS fs
WHERE fs.id NOT IN (SELECT id FROM _patria_delete_targets);

-- Optional: remove storage.objects metadata for those prefixes (files still need E)
DELETE FROM storage.objects AS o
WHERE o.bucket_id IN ('memories', 'vault')
  AND EXISTS (
    SELECT 1 FROM _patria_delete_targets AS t
    WHERE o.name LIKE t.id::text || '/%'
  );

-- Cascades wipe members, keys, letters, memories, vault, sync, recovery, etc.
DELETE FROM public.family_spaces
WHERE id IN (SELECT id FROM _patria_delete_targets);

-- Final check: other families unchanged
DO $$
DECLARE
  drift int;
BEGIN
  SELECT count(*) INTO drift
  FROM _patria_other_family_counts AS before
  FULL OUTER JOIN (
    SELECT
      fs.id,
      (SELECT count(*) FROM public.space_members sm WHERE sm.family_space_id = fs.id) AS members,
      (SELECT count(*) FROM public.memory_items mi WHERE mi.family_space_id = fs.id) AS memories,
      (SELECT count(*) FROM public.vault_entries ve WHERE ve.family_space_id = fs.id) AS vault,
      (SELECT count(*) FROM public.letters l WHERE l.family_space_id = fs.id) AS letters
    FROM public.family_spaces AS fs
  ) AS after ON before.id = after.id
  WHERE before.id IS NULL
     OR after.id IS NULL
     OR before.members IS DISTINCT FROM after.members
     OR before.memories IS DISTINCT FROM after.memories
     OR before.vault IS DISTINCT FROM after.vault
     OR before.letters IS DISTINCT FROM after.letters;

  IF drift <> 0 THEN
    RAISE EXCEPTION 'Other family row counts drifted (%). ROLLBACK.', drift;
  END IF;
END $$;

-- Inspect, then COMMIT; or ROLLBACK;
SELECT 'targets gone' AS check,
       NOT EXISTS (
         SELECT 1 FROM public.family_spaces
         WHERE id IN (SELECT id FROM _patria_delete_targets)
       ) AS ok;
SELECT * FROM _patria_other_family_counts ORDER BY name;

-- COMMIT;
-- ROLLBACK;

-- -----------------------------------------------------------------------------
-- D. Clean the three test users only (after C). Keeps auth.users + profiles.
-- Clears device/personal/letterbox/recovery rows not tied to a remaining family.
-- -----------------------------------------------------------------------------
WITH test_users AS (
  SELECT u.id, u.email
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
SELECT email, id FROM test_users ORDER BY email;

-- Dry-run counts for D (same three emails):
WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
SELECT * FROM (
  SELECT 'device_keys' AS tbl, count(*)::bigint AS n
  FROM public.device_keys WHERE user_id IN (SELECT id FROM test_users)
  UNION ALL SELECT 'device_approval_notices (orphaned space)', count(*)
  FROM public.device_approval_notices n
  WHERE n.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (SELECT 1 FROM public.family_spaces fs WHERE fs.id = n.family_space_id)
  UNION ALL SELECT 'personal_key_wraps (no remaining membership)', count(*)
  FROM public.personal_key_wraps w
  WHERE w.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.user_id = w.user_id AND sm.family_space_id = w.family_space_id
    )
  UNION ALL SELECT 'personal_key_under_recovery (no membership)', count(*)
  FROM public.personal_key_under_recovery w
  WHERE w.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.user_id = w.user_id AND sm.family_space_id = w.family_space_id
    )
  UNION ALL SELECT 'letterbox_keys (no membership)', count(*)
  FROM public.letterbox_keys k
  WHERE k.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.user_id = k.user_id AND sm.family_space_id = k.family_space_id
    )
  UNION ALL SELECT 'recovery_public_keys (no membership)', count(*)
  FROM public.recovery_public_keys k
  WHERE k.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.user_id = k.user_id AND sm.family_space_id = k.family_space_id
    )
  UNION ALL SELECT 'recovery_contacts as owner (no membership)', count(*)
  FROM public.recovery_contacts c
  WHERE c.user_id IN (SELECT id FROM test_users)
    AND NOT EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.user_id = c.user_id AND sm.family_space_id = c.family_space_id
    )
  UNION ALL SELECT 'memory_source_keys', count(*)
  FROM public.memory_source_keys WHERE user_id IN (SELECT id FROM test_users)
) AS d
ORDER BY tbl;

-- Apply D (run after C committed). Still only the three emails.
BEGIN;

-- Refuse if any of the three still belongs to a family (wrong ids / incomplete C).
DO $$
DECLARE
  left_over int;
BEGIN
  SELECT count(*) INTO left_over
  FROM public.space_members AS sm
  JOIN auth.users AS u ON u.id = sm.user_id
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  );
  IF left_over <> 0 THEN
    RAISE EXCEPTION 'Test users still have % membership(s). Finish C first. Aborting D.', left_over;
  END IF;
END $$;

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.device_approval_notices AS n
WHERE n.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (SELECT 1 FROM public.family_spaces fs WHERE fs.id = n.family_space_id);

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.personal_key_wraps AS w
WHERE w.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.user_id = w.user_id AND sm.family_space_id = w.family_space_id
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.personal_key_under_recovery AS w
WHERE w.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.user_id = w.user_id AND sm.family_space_id = w.family_space_id
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.letterbox_keys AS k
WHERE k.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.user_id = k.user_id AND sm.family_space_id = k.family_space_id
  );

-- Secrets reference device_keys; clear orphaned rows for these users (any role).
WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.recovery_contact_secrets AS s
WHERE (s.user_id IN (SELECT id FROM test_users) OR s.member_id IN (SELECT id FROM test_users))
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.family_space_id = s.family_space_id
      AND sm.user_id IN (SELECT id FROM test_users)
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.recovery_contacts AS c
WHERE (c.user_id IN (SELECT id FROM test_users) OR c.member_id IN (SELECT id FROM test_users))
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.family_space_id = c.family_space_id
      AND sm.user_id IN (SELECT id FROM test_users)
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.recovery_pair_wraps AS w
WHERE w.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.user_id = w.user_id AND sm.family_space_id = w.family_space_id
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.recovery_public_keys AS k
WHERE k.user_id IN (SELECT id FROM test_users)
  AND NOT EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.user_id = k.user_id AND sm.family_space_id = k.family_space_id
  );

WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.memory_source_keys
WHERE user_id IN (SELECT id FROM test_users);

-- Last: device_keys (referenced by wraps/secrets — those must be gone first)
WITH test_users AS (
  SELECT u.id
  FROM auth.users AS u
  WHERE u.email IN (
    'femipaul7535+test1@gmail.com',
    'femipaul7535+test2@gmail.com',
    'femipaul7535+test3@gmail.com'
  )
)
DELETE FROM public.device_keys
WHERE user_id IN (SELECT id FROM test_users);

-- Confirm: three users have zero memberships (expected after wiping both test families)
SELECT u.email, count(sm.*) AS remaining_memberships
FROM auth.users AS u
LEFT JOIN public.space_members AS sm ON sm.user_id = u.id
WHERE u.email IN (
  'femipaul7535+test1@gmail.com',
  'femipaul7535+test2@gmail.com',
  'femipaul7535+test3@gmail.com'
)
GROUP BY u.email
ORDER BY u.email;

-- COMMIT;
-- ROLLBACK;

-- -----------------------------------------------------------------------------
-- E. Storage files (SQL cannot reliably purge object bytes on hosted)
-- -----------------------------------------------------------------------------
-- Paths are `{family_space_id}/...` in buckets `memories` and `vault`.
--
-- Dashboard:
--   1. Supabase → Storage → bucket `memories`
--   2. Open folder named each deleted family UUID; delete the folder
--   3. Repeat for bucket `vault`
--
-- Or Management API / supabase-js as service role (run locally, not in SQL Editor):
--
--   // scripts sketch — DO NOT commit service role keys
--   import { createClient } from '@supabase/supabase-js'
--   const admin = createClient(HOSTED_URL, SERVICE_ROLE_KEY)
--   const spaceIds = ['uuid-paul', 'uuid-femi']
--   for (const bucket of ['memories', 'vault']) {
--     for (const spaceId of spaceIds) {
--       const { data: entries } = await admin.storage.from(bucket).list(spaceId, { limit: 1000 })
--       // recursively list/remove; or remove by paths collected from storage.objects before C
--     }
--   }
--
-- Before C, you can export paths:
--   SELECT bucket_id, name FROM storage.objects
--   WHERE bucket_id IN ('memories','vault')
--     AND (name LIKE '<paul-uuid>/%' OR name LIKE '<femi-uuid>/%');
