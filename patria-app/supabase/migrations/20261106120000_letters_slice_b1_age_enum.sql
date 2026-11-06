-- LEG02 Slice B1: add letter_trigger_kind = age (own transaction so CHECK can use it).
ALTER TYPE public.letter_trigger_kind ADD VALUE IF NOT EXISTS 'age';
