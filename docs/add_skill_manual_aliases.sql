-- ScorCraft — Feature 2: manual (recruiter-added) skill aliases.
--
-- The AI alias suggester misses some obvious human equivalents (e.g.
-- OS = "Operating System" = "OperatingSystem"). The job-creation UI now lets a
-- recruiter type their own aliases via a "+" button next to each skill. Those
-- manual aliases are always folded into skill_aliases (so the technical scorer
-- matches them), and ALSO stored raw in skill_manual_aliases so the editor can
-- re-render them as distinct "manual" chips when the job is re-opened.
--
-- This column is OPTIONAL: api/jobs.py introspects the schema and only writes it
-- if it exists, so job save works with or without this migration (without it,
-- manual aliases still reach the scorer via skill_aliases — they just lose the
-- "manual" styling on re-edit). Run it in Supabase Dashboard → SQL Editor.
--
-- Safe to run multiple times (IF NOT EXISTS).

alter table public.job_descriptions
  add column if not exists skill_manual_aliases jsonb default '{}'::jsonb;
