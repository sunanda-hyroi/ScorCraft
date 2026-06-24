-- ScorCraft — optional job_descriptions fields for the ported ScorQ job-creation flow.
--
-- The current job_descriptions table stores skills as must/good/bonus arrays and
-- per-category weight_* columns. The ScorQ creation UI also captures experience
-- range, education requirement, custom AI instructions, per-skill equivalents,
-- and the canonical required_skills/skill_importance maps.
--
-- These columns are OPTIONAL: the backend (api/jobs.py) introspects the schema and
-- only writes columns that exist, so job creation works with or without this
-- migration. Run it (Supabase Dashboard → SQL Editor) to persist these extra
-- fields and have the ScorQ scorer honor experience/education/equivalents.
--
-- Safe to run multiple times (IF NOT EXISTS).

alter table public.job_descriptions
  add column if not exists required_skills    jsonb   default '[]'::jsonb,
  add column if not exists skill_importance   jsonb   default '{}'::jsonb,
  add column if not exists skill_equivalents  jsonb   default '{}'::jsonb,
  add column if not exists nice_to_have_skills text[] default '{}',
  add column if not exists experience_min     integer default 0,
  add column if not exists experience_max     integer default 0,
  add column if not exists education_required  text   default '',
  add column if not exists custom_instructions text   default '';
