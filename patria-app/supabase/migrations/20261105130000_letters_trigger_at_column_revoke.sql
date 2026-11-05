-- Authenticated clients must not UPDATE trigger_at / trigger_kind even if they
-- call set_config('patria.allow_letter_trigger_change', '1', true). Table-level
-- UPDATE overrides column REVOKE, so replace it with an explicit column list that
-- omits those two. SECURITY DEFINER RPCs (seal_letter, set_letter_open_date) run
-- as the function owner and keep full privileges.

REVOKE UPDATE ON TABLE public.letters FROM authenticated;

GRANT UPDATE (
  id,
  family_space_id,
  author_id,
  recipient_id,
  from_label,
  visibility,
  status,
  version,
  keepers_may_release_early,
  content_hash,
  fingerprint,
  voice_object_path,
  recipient_left_at,
  sealed_at,
  pending_at,
  released_at,
  withdrawn_at,
  created_at,
  updated_at
) ON TABLE public.letters TO authenticated;
