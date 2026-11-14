-- Additive only: preserves all existing battlecards, prices, history and policies.
-- Run once in Supabase SQL Editor before researching comparison profiles.
alter table public.battlecards
  add column if not exists comparison_profile jsonb;

comment on column public.battlecards.comparison_profile is
  'Homepage comparison facts with verbatim evidence, source URL and capture time. Null means not researched.';
