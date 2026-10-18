-- HMAC source keys are insert-or-fetch only. A second device must not replace the secret.

DROP POLICY IF EXISTS memory_source_keys_owner ON public.memory_source_keys;

CREATE POLICY memory_source_keys_select ON public.memory_source_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY memory_source_keys_insert ON public.memory_source_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

REVOKE UPDATE, DELETE ON public.memory_source_keys FROM authenticated;
GRANT SELECT, INSERT ON public.memory_source_keys TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_memory_source_key()
RETURNS bytea
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  out_secret bytea;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE insufficient_privilege USING MESSAGE = 'not signed in';
  END IF;
  INSERT INTO public.memory_source_keys (user_id, secret)
  VALUES (auth.uid(), extensions.gen_random_bytes(32))
  ON CONFLICT (user_id) DO NOTHING;
  SELECT secret INTO STRICT out_secret
  FROM public.memory_source_keys
  WHERE user_id = auth.uid();
  RETURN out_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_memory_source_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_memory_source_key() TO authenticated;
