-- =============================================================================
-- Hosted TEST DATA ONLY — delete two locked-out / leftover test families
-- =============================================================================
-- Target names (confirm ids in A before anything destructive):
--   • "The Paul family"
--   • "The Femi Family"
-- Keep auth users: femipaul7535+test1/2/3@gmail.com (never delete auth.users).
--
-- Order (do not skip):
--   A) List family_spaces → confirm the two UUIDs
--   B) List EVERY storage bucket + count objects under those UUID prefixes
--   C) Dry-run COUNT of database rows that will be deleted
--   → Then delete storage FILES first (dashboard or
--     docs/runbooks/hosted-delete-test-families-storage.sh — never commit keys)
--   D) SQL transaction: database rows only (no storage.objects DELETE)
--   E) Clean the three test users' leftover key rows (keep accounts)
--
-- Do NOT DELETE FROM storage.objects — Supabase protects storage tables, and
-- SQL would not remove the underlying files anyway.
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

SELECT id, name, created_at
FROM public.family_spaces
WHERE name IN ('The Paul family', 'The Femi Family')
ORDER BY name;

-- -----------------------------------------------------------------------------
-- B. Storage inventory — every bucket, objects under the two family_space_id
-- prefixes (memories, vault/letter voice notes, and any other bucket).
-- Replace the two UUIDs. SELECT only — no deletes.
-- -----------------------------------------------------------------------------
WITH target AS (
  SELECT unnest(ARRAY[
    'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid, -- The Paul family
    'd3cafe84-d175-4716-856a-1242a3066d44'::uuid  -- The Femi Family
  ]) AS id
)
SELECT
  b.id AS bucket_id,
  b.name AS bucket_name,
  b.public AS is_public,
  (
    SELECT count(*)::bigint
    FROM storage.objects AS o
    WHERE o.bucket_id = b.id
      AND EXISTS (
        SELECT 1 FROM target AS t WHERE o.name LIKE t.id::text || '/%'
      )
  ) AS objects_under_target_prefixes
FROM storage.buckets AS b
ORDER BY b.id;

-- Paths you will delete via Storage API / dashboard (export for the Mac script):
WITH target AS (
  SELECT unnest(ARRAY[
    'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid,
    'd3cafe84-d175-4716-856a-1242a3066d44'::uuid
  ]) AS id
)
SELECT o.bucket_id, o.name
FROM storage.objects AS o
JOIN target AS t ON o.name LIKE t.id::text || '/%'
ORDER BY o.bucket_id, o.name;

-- >>> STOP: delete those files with hosted-delete-test-families-storage.sh
-- >>> (or Dashboard: Storage → each bucket → folder named each UUID → Delete)
-- >>> Re-run the bucket count query above until every objects_under_target_prefixes is 0.
-- >>> Only then continue to C / D.

-- -----------------------------------------------------------------------------
-- C. Dry run — COUNTS of database rows for the two family_space_ids only
-- Replace the two UUIDs. No deletes.
-- -----------------------------------------------------------------------------
WITH target AS (
  SELECT id
  FROM public.family_spaces
  WHERE id IN (
    'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid, -- The Paul family
    'd3cafe84-d175-4716-856a-1242a3066d44'::uuid  -- The Femi Family
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
) AS counts
ORDER BY tbl;

-- -----------------------------------------------------------------------------
-- D. Delete transaction — database rows ONLY.
-- Ready-to-run copy with hosted ids:
--   docs/runbooks/hosted-delete-test-families-step-d.sql
--
-- Cascade alone fails: on_key_holder_departure() inserts device_removed_notices
-- after family_spaces is already gone (FK 23503). Fix: explicit child deletes,
-- then DISABLE TRIGGER space_members_key_holder_departure only for the
-- family_spaces DELETE, then ENABLE again. Ends with COMMIT (Editor-safe).
-- Guards: exactly two targets by id+name, no storage leftovers, other families
-- unchanged. Auth users are not deleted.
-- -----------------------------------------------------------------------------
-- (Paste hosted-delete-test-families-step-d.sql into the SQL Editor for D.)

-- -----------------------------------------------------------------------------
-- E. Clean the three test users only (after D committed). Keeps auth.users.
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

BEGIN;

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
    RAISE EXCEPTION 'Test users still have % membership(s). Finish D first. Aborting E.', left_over;
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
