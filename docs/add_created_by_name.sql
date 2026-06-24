-- ScorCraft — user attribution on jobs.
--
-- Stores a human-readable creator name alongside the existing user_id so the Job
-- Dashboard can show "Created by: <name>" and filter by creator without a second
-- lookup. The backend derives the value from Supabase auth (user_metadata name,
-- else the email local-part) at create time.
--
-- The backend introspects the schema and only writes this column when it exists,
-- so it keeps working before this migration is applied. Run in the Supabase
-- Dashboard → SQL Editor, then restart the backend.
--
-- Safe to run multiple times (IF NOT EXISTS).

alter table public.job_descriptions
  add column if not exists created_by_name text;
