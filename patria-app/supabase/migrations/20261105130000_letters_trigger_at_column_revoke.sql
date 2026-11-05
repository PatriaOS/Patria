-- Authenticated clients must not UPDATE any letters column directly.
-- The app only INSERTs drafts; every change goes through SECURITY DEFINER RPCs
-- (seal_letter, set_letter_open_date, withdraw_letter, claim/mark via service_role).
-- Table-level UPDATE previously overrode column REVOKE and let a client change
-- status / trigger_at / hashes after setting the allow GUC.

REVOKE UPDATE ON TABLE public.letters FROM authenticated;

-- Keep INSERT (draft create) and SELECT / DELETE as already granted by Slice A.
-- DELETE is unused by the app (withdraw_letter is definer); leave it for now.

COMMENT ON TABLE public.letters IS
  'Letters to the Future. Authenticated: SELECT/INSERT drafts only; no UPDATE. '
  'All mutations after insert use SECURITY DEFINER RPCs. Slice B: new columns '
  'are not updatable by authenticated unless justified in the PR.';
