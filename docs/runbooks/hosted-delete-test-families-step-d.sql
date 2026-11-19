-- =============================================================================
-- Step D — delete the two hosted test families (database rows only)
-- =============================================================================
-- Preconditions:
--   • Storage files already removed (SQL section B counts at 0 for both UUIDs)
--   • Run as a role that can DISABLE TRIGGER on space_members (SQL Editor / postgres)
--
-- Why the trigger disable: DELETE family_spaces cascades to space_members.
-- AFTER DELETE fires on_key_holder_departure(), which INSERTs device_removed_notices
-- for the departed member's device_keys. By then family_spaces is already gone →
-- FK 23503. We disable only that departure trigger for this transaction.
-- enforce_at_least_one_admin already allows deletes when the family row is gone.
--
-- Ids (hosted):
--   de75626b-6d6e-42ab-be52-49fee7764d95  The Paul family
--   d3cafe84-d175-4716-856a-1242a3066d44  The Femi Family
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _patria_delete_targets ON COMMIT DROP AS
SELECT id, name
FROM public.family_spaces
WHERE id IN (
  'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid, -- The Paul family
  'd3cafe84-d175-4716-856a-1242a3066d44'::uuid  -- The Femi Family
);

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

-- Refuse if storage objects still exist under these prefixes (any bucket)
DO $$
DECLARE
  leftover bigint;
BEGIN
  SELECT count(*) INTO leftover
  FROM storage.objects AS o
  WHERE EXISTS (
    SELECT 1 FROM _patria_delete_targets AS t
    WHERE o.name LIKE t.id::text || '/%'
  );
  IF leftover <> 0 THEN
    RAISE EXCEPTION
      '% storage.objects row(s) still under target prefixes. Delete files via Storage API/dashboard first. Aborting.',
      leftover;
  END IF;
END $$;

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

-- Explicit pre-delete of rows that notices/triggers touch while the family still exists.
-- (Cascade would also remove these; doing it first keeps the wipe predictable.)
DELETE FROM public.device_removed_notices
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.device_approval_notices
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_helper_refresh_notices
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_events
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_request_helpers AS h
USING public.recovery_requests AS r
WHERE h.request_id = r.id
  AND r.family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_requests
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_contact_secrets
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_contacts
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_pair_wraps
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.recovery_public_keys
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.personal_key_under_recovery
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.personal_key_wraps
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.family_key_wraps
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.family_key_under_recovery
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.family_key_meta
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.letterbox_keys
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

-- Letters (child tables cascade from letters; delete letters while family exists)
DELETE FROM public.letters
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.vault_entries
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.memory_items
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.memory_item_tombstones
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.memory_library_connections
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_meeting_answers AS a
USING public.sync_meetings AS m
WHERE a.meeting_id = m.id
  AND m.family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_agenda_items
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_notes
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_tasks
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_meetings
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.sync_schedules
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.invites
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.child_profiles
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

DELETE FROM public.device_events
WHERE family_space_id IN (SELECT id FROM _patria_delete_targets);

-- Narrow: stop on_key_holder_departure from inserting device_removed_notices
-- after cascade has already removed family_spaces.
ALTER TABLE public.space_members DISABLE TRIGGER space_members_key_holder_departure;

-- Cascade remaining children (members, circles, etc.) then the family rows.
DELETE FROM public.family_spaces
WHERE id IN (SELECT id FROM _patria_delete_targets);

ALTER TABLE public.space_members ENABLE TRIGGER space_members_key_holder_departure;

DO $$
DECLARE
  drift int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.family_spaces
    WHERE id IN (
      'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid,
      'd3cafe84-d175-4716-856a-1242a3066d44'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'Target family_spaces still present after delete.';
  END IF;

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
    RAISE EXCEPTION 'Other family row counts drifted (%). Rolling back.', drift;
  END IF;
END $$;

SELECT 'targets gone' AS check,
       NOT EXISTS (
         SELECT 1 FROM public.family_spaces
         WHERE id IN (
           'de75626b-6d6e-42ab-be52-49fee7764d95'::uuid,
           'd3cafe84-d175-4716-856a-1242a3066d44'::uuid
         )
       ) AS ok;

SELECT * FROM _patria_other_family_counts ORDER BY name;

COMMIT;
