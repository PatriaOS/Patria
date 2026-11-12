-- Keepers must see Help after mark_due_letters (status pending), not only when
-- the due boolean happens to decode. Make due explicit: past trigger and still
-- waiting for release/open (sealed or pending).

CREATE OR REPLACE FUNCTION public.letters_for_keepers()
RETURNS TABLE (
  letter_id uuid,
  family_space_id uuid,
  version integer,
  status public.letter_status,
  author_id uuid,
  author_name text,
  recipient_id uuid,
  recipient_name text,
  slot public.letter_keeper_slot,
  due boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.family_space_id,
    l.version,
    l.status,
    l.author_id,
    coalesce(nullif(btrim(pa.display_name), ''), 'Someone'),
    l.recipient_id,
    coalesce(nullif(btrim(pr.display_name), ''), 'Someone'),
    k.slot,
    (
      l.trigger_at <= now()
      AND l.status IN ('sealed', 'pending')
    ) AS due
  FROM public.letter_keepers AS k
  JOIN public.letters AS l
    ON l.id = k.letter_id
   AND l.version = k.version
  JOIN public.profiles AS pa ON pa.id = l.author_id
  JOIN public.profiles AS pr ON pr.id = l.recipient_id
  WHERE k.keeper_id = auth.uid()
    AND l.status IN ('sealed', 'pending', 'released')
    AND public.is_family_member(l.family_space_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.letters_for_keepers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letters_for_keepers() TO authenticated;
