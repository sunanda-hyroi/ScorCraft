-- ScorCraft — Feature 3: Job versioning columns for job_descriptions.
--
-- Editing a job that already has scored candidates must NOT mutate the original
-- row (those candidates were scored against it). Instead the backend creates a
-- new row as the next version, links it to the lineage via parent_job_id, and
-- archives the original. These columns enable that.
--
-- The backend introspects the schema and only versions when these columns exist,
-- so it keeps working (falling back to in-place update) BEFORE this migration is
-- run. Run this in the Supabase Dashboard → SQL Editor, then restart the backend.
--
-- Safe to run multiple times (IF NOT EXISTS).

alter table public.job_descriptions
  -- 1 for the original; incremented for each subsequent edit-with-scores.
  add column if not exists version integer default 1,
  -- Points at the lineage root (the very first version's id). NULL for v1.
  add column if not exists parent_job_id uuid
    references public.job_descriptions(id) on delete set null,
  -- Denormalized count of candidates scored against this job (best-effort cache;
  -- the API also computes this live from the scores table).
  add column if not exists candidates_scored_count integer default 0;

-- Backfill existing rows so version is never NULL.
update public.job_descriptions set version = 1 where version is null;

-- Helpful index for walking a version lineage.
create index if not exists idx_job_descriptions_parent
  on public.job_descriptions (parent_job_id);
