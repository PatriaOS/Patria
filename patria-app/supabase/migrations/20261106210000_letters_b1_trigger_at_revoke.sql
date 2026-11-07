-- LEG02 B1 review: trigger_at must not be readable from public.letters by
-- authenticated (age authors could learn the recipient birthday). Serve
-- redacted trigger_at only via letters_for_api (SECURITY DEFINER). mark_due_letters
-- and claim stay SECURITY DEFINER on the base table and are unchanged.

REVOKE SELECT ON TABLE public.letters FROM authenticated;
GRANT SELECT (
  id,
  family_space_id,
  author_id,
  recipient_id,
  from_label,
  visibility,
  trigger_kind,
  trigger_age,
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
-- trigger_at and trigger_dob_snapshot: no authenticated SELECT.
GRANT INSERT, DELETE ON TABLE public.letters TO authenticated;

DROP VIEW IF EXISTS public.letters_for_api;

-- Owner reads trigger_at; callers only see rows can_see_letter_row allows, with
-- age-author trigger_at redacted. security_invoker=false (DEFINER).
CREATE VIEW public.letters_for_api
WITH (security_invoker = false) AS
SELECT
  l.id,
  l.family_space_id,
  l.author_id,
  l.recipient_id,
  l.from_label,
  l.visibility,
  l.trigger_kind,
  l.trigger_age,
  CASE
    WHEN l.trigger_kind = 'age'
      AND l.author_id = (SELECT auth.uid())
      AND l.recipient_id IS DISTINCT FROM (SELECT auth.uid())
    THEN NULL
    ELSE l.trigger_at
  END AS trigger_at,
  l.status,
  l.version,
  l.keepers_may_release_early,
  l.content_hash,
  l.fingerprint,
  l.voice_object_path,
  l.recipient_left_at,
  l.sealed_at,
  l.pending_at,
  l.released_at,
  l.withdrawn_at,
  l.created_at,
  l.updated_at
FROM public.letters AS l
WHERE public.can_see_letter_row(l.id);

GRANT SELECT ON public.letters_for_api TO authenticated;

COMMENT ON VIEW public.letters_for_api IS
  'Letters SELECT for the app (SECURITY DEFINER). Age-letter authors get NULL '
  'trigger_at; trigger_dob_snapshot is never exposed. Base-table trigger_at is '
  'not granted to authenticated.';
