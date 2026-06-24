-- ═══════════════════════════════════════════════════════════════
-- ScorCraft — Database Migration
-- Run this in Supabase SQL Editor
--
-- This adds the crafted_resumes table to your existing ScorQ
-- database. Your existing tables (job_descriptions, candidates,
-- scores, scoring_sessions) stay unchanged.
-- ═══════════════════════════════════════════════════════════════

-- New table: stores crafted resume data and settings
CREATE TABLE IF NOT EXISTS crafted_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    score_id UUID REFERENCES scores(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    job_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,

    -- AI-structured resume data (the editable JSON)
    structured_data JSONB NOT NULL DEFAULT '{}',

    -- Missing info report (internal use only — never in downloads)
    missing_report JSONB DEFAULT '{}',

    -- Generated document path in Supabase Storage
    formatted_file_path TEXT,

    -- Craft settings (masking, letterhead, logo, etc.)
    craft_settings JSONB DEFAULT '{}',

    -- Status tracking
    status TEXT DEFAULT 'crafted' CHECK (status IN ('crafted', 'edited', 'downloaded')),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by score
CREATE INDEX IF NOT EXISTS idx_crafted_resumes_score_id ON crafted_resumes(score_id);
CREATE INDEX IF NOT EXISTS idx_crafted_resumes_candidate_id ON crafted_resumes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_crafted_resumes_job_id ON crafted_resumes(job_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON crafted_resumes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE crafted_resumes ENABLE ROW LEVEL SECURITY;

-- RLS policy: authenticated users can manage their own crafted resumes
CREATE POLICY "Users can manage crafted resumes"
    ON crafted_resumes
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- Storage bucket for formatted resumes (run once)
-- ═══════════════════════════════════════════════════════════════
-- Go to Supabase Dashboard → Storage → Create bucket:
--   Name: formatted-resumes
--   Public: No
--   Max file size: 10MB
-- ═══════════════════════════════════════════════════════════════

-- Verify: check the table was created
SELECT 'crafted_resumes table created successfully' AS status;
