-- letters_for_api: authenticated SELECT only (no PUBLIC / anon).
REVOKE ALL ON TABLE public.letters_for_api FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.letters_for_api TO authenticated;
