# ScorCraft by HYROI Solutions — Complete Build Specification

## What is this document?
This is a complete specification to build ScorCraft, a recruitment tool that merges two existing products (ScorQ + CraftQ) into one unified pipeline. Feed this to Claude Code along with the existing codebase ZIPs.

---

## 1. PRODUCT OVERVIEW

**ScorCraft** = ScorQ (resume scoring) + CraftQ (resume formatting) merged into one sequential pipeline.

**Users**: Recruiters at HYROI Solutions (internal tool)
**End output**: Crafted resumes + scorecards shared with end clients
**AI provider**: OpenAI GPT-4o (single provider, no multi-provider switching)

### Pipeline flow (sequential, NOT parallel):
```
Create Job → Upload Resumes (batch) → Score ALL (ScorQ engine) → 
Recruiter reviews ranked results → Filters by adjustable cutoff → 
Selects candidates → Craft selected (CraftQ engine) → 
Edit in editor → Download (Resume / Scorecard / Combined PDF)
```

### Key principle: Score FIRST, then Craft
- Scoring runs on ALL uploaded resumes
- Only resumes the recruiter manually selects get crafted
- This saves AI costs (no formatting wasted on rejected candidates)

---

## 2. EXISTING CODEBASES (reference)

### ScorQ (resume scoring)
- **Stack**: Next.js + TypeScript frontend, FastAPI + Python backend, Supabase
- **Key backend files**:
  - `backend/services/scorer.py` — orchestrates scoring pipeline
  - `backend/services/ai/prompt_builder.py` — builds AI scoring prompt
  - `backend/services/ai/response_parser.py` — parses AI response + applies rule overrides
  - `backend/services/ai/adapters/openai_adapter.py` — OpenAI API call
  - `backend/services/rule_engine/` — deterministic scoring (technical, experience, education, stability)
  - `backend/services/resume_compressor.py` — section-aware text compression
  - `backend/services/contact_parser.py` — extracts name/email/phone
  - `backend/services/text_extractor.py` — PDF/DOCX text extraction
  - `backend/api/scoring.py` — /single and /batch endpoints
  - `backend/api/jobs.py` — CRUD for job descriptions
  - `backend/api/results.py` — fetch scored results
  - `backend/api/auth.py` — Supabase auth
- **Scoring logic** (MUST preserve exactly):
  - Rule engine runs FIRST (skill matching with aliases, experience parsing, education detection, stability analysis)
  - AI scores second (prompted with rule engine results for context)
  - Response parser OVERRIDES AI with deterministic rules (must-have ceiling, weighted recalculation)
  - Weights are configurable per job: technical (default 40%), experience (25%), education (15%), soft_skills (10%), stability (10%)
- **Frontend**: Next.js app with job creation form, file upload, ScoreCard component, scorecard PDF export

### CraftQ (resume formatting)
- **Stack**: React (CRA) frontend, FastAPI + Python backend, Supabase
- **Key backend files**:
  - `app/services/ai_processor.py` — AI extraction/rewriting (Groq/Gemini/Claude — replace with OpenAI only)
  - `app/services/docx_generator.py` — python-docx DOCX generation
  - `app/services/extractor.py` — text extraction from PDF/DOCX
  - `app/main.py` — upload, format, download, edit endpoints; also has PDF generation via ReportLab
- **AI extraction prompt**: Extracts candidate_info, executive_summary (8-12 bullets), core_competencies, project_experience, education, certifications, technical_competencies, missing_critical_info
- **Frontend**: Dashboard with upload, formatted resume preview, editor modal, download buttons

---

## 3. MERGED ARCHITECTURE

### Tech stack
- **Backend**: FastAPI (Python 3.12)
- **Frontend**: Next.js 14+ with TypeScript and Tailwind CSS
- **Database**: Supabase (Postgres + Auth + Storage)
- **AI**: OpenAI GPT-4o (single provider)
- **PDF generation**: ReportLab
- **DOCX generation**: python-docx

### Backend directory structure
```
scorcraft/
├── backend/
│   ├── main.py                      # FastAPI app, CORS, router registration
│   ├── config.py                    # All env vars, OpenAI-only config
│   ├── requirements.txt
│   ├── .env.example
│   ├── db/
│   │   └── supabase_client.py       # Supabase client init
│   ├── models/
│   │   └── schemas.py               # Pydantic models
│   ├── api/
│   │   ├── auth.py                  # Supabase JWT auth (from ScorQ)
│   │   ├── jobs.py                  # Job CRUD (from ScorQ)
│   │   ├── scoring.py               # Score single/batch (from ScorQ)
│   │   ├── results.py               # Fetch results (from ScorQ)
│   │   ├── crafting.py              # NEW: craft single/batch, edit/save
│   │   └── download.py              # NEW: resume PDF, scorecard PDF, combined PDF, DOCX
│   └── services/
│       ├── scorer.py                # ScorQ scoring orchestrator
│       ├── ai_processor.py          # NEW: OpenAI resume extraction for crafting
│       ├── docx_generator.py        # Enhanced DOCX generation
│       ├── pdf_generator.py         # NEW: resume PDF + scorecard PDF + combined PDF
│       ├── text_extractor.py        # PDF/DOCX text extraction
│       ├── contact_parser.py        # Email/phone/name extraction
│       ├── resume_compressor.py     # Section-aware compression
│       ├── ai/                      # ScorQ AI pipeline (keep as-is)
│       │   ├── prompt_builder.py
│       │   ├── response_parser.py
│       │   ├── router.py            # Simplified to OpenAI-only
│       │   ├── jd_extractor.py
│       │   └── adapters/
│       │       ├── base.py
│       │       └── openai_adapter.py
│       └── rule_engine/             # ScorQ rule engine (keep as-is)
│           ├── technical_scorer.py
│           ├── experience_scorer.py
│           ├── education_scorer.py
│           ├── stability_scorer.py
│           └── skill_taxonomy.py
```

### Frontend directory structure
```
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Landing / dashboard
│   │   ├── jobs/
│   │   │   ├── page.tsx             # Job list
│   │   │   └── [id]/page.tsx        # Job detail + scoring
│   │   └── craft/
│   │       └── [scoreId]/page.tsx   # Craft + edit + download
│   ├── components/
│   │   ├── Header.tsx               # ScorCraft branding
│   │   ├── StepBar.tsx              # Pipeline progress indicator
│   │   ├── JobSelector.tsx          # Job creation/selection
│   │   ├── ResumeUploader.tsx       # Batch upload with drag-drop
│   │   ├── ScoringProgress.tsx      # Animated scoring progress
│   │   ├── ResultsTable.tsx         # Ranked results with filters
│   │   ├── CandidateRow.tsx         # Expandable candidate scorecard row
│   │   ├── ScoreCard.tsx            # Full ScorQ scorecard (matches existing PDF design)
│   │   ├── CraftSettings.tsx        # PI masking toggle, logo upload, letterhead config
│   │   ├── CraftQueue.tsx           # Craft queue with batch/individual craft
│   │   ├── ResumeEditor.tsx         # Split-screen: edit form + live preview
│   │   ├── ResumePreview.tsx        # Formatted resume preview
│   │   ├── DownloadModal.tsx        # Resume PDF/DOCX, Scorecard PDF, Combined PDF
│   │   └── ActionItems.tsx          # Internal-only gaps/checklist
│   ├── lib/
│   │   ├── api.ts                   # API client (fetch wrapper)
│   │   └── supabase.ts              # Supabase client
│   └── types/
│       └── index.ts                 # TypeScript interfaces
```

### Database schema (Supabase)

Existing tables from ScorQ (DO NOT modify):
- `job_descriptions` — jobs with skills, weights, thresholds
- `candidates` — name, email, phone, resume path
- `scores` — score results linked to candidates + jobs
- `scoring_sessions` — batch scoring sessions

NEW table to add:
```sql
CREATE TABLE crafted_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    score_id UUID REFERENCES scores(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    job_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
    structured_data JSONB NOT NULL DEFAULT '{}',
    missing_report JSONB DEFAULT '{}',
    formatted_file_path TEXT,
    craft_settings JSONB DEFAULT '{}',
    status TEXT DEFAULT 'crafted' CHECK (status IN ('crafted', 'edited', 'downloaded')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Also create Supabase storage bucket: `formatted-resumes` (private, 10MB max)

---

## 4. DETAILED FEATURE REQUIREMENTS

### 4.1 Scoring (ScorQ pipeline — keep existing logic)
- Job creation with must-have/good-to-have/bonus skills and custom weights
- Batch upload (PDF/DOCX, up to 20 files)
- ScorQ scoring: text extraction → contact parsing → rule engine → AI scoring → response parsing → rule overrides
- Store raw resume text in scores table (needed later for crafting)
- DO NOT add automatic SHORTLIST/REVIEW/PASS tags. The recruiter sets a cutoff slider and manually decides.

### 4.2 Results review screen
- Summary bar: total scored, above cutoff count, below cutoff count
- **Adjustable cutoff slider** (0-100) — recruiter drags to set the threshold. Above/below labels update dynamically
- **Score range filter** — show only candidates within a min-max score range
- **PI masking toggle** — one click to mask all phone/email across the UI
- **Craft settings panel** (expandable):
  - Company name, tagline, email, phone (for letterhead/footer)
  - Logo upload with info icon: "PNG or SVG, 300×80px min, 3:1 to 5:1 ratio, transparent background, max 2MB"
  - Logo preview + remove button
- **Candidate rows** (expandable):
  - Collapsed: checkbox, score badge, name, email, phone, 4 category mini-scores, above/below cutoff tag, gap count
  - Expanded: full category breakdown with bars, matched/missing skills, AI reasoning, highlights, red flags, action items (labeled "internal only"), buttons: View Scorecard, Craft Resume, Download
- **Selection**: Select all, individual checkboxes, "Move to craft →" button for selected
- Candidate rows with score ≥ cutoff get green border, below get default

### 4.3 Scorecard (must match existing ScorQ PDF design exactly)
Reference the uploaded ScorQ scorecard PDF. The design is:
- **Header**: Navy background. Left: "ScorQ by HYROI Solutions" + "AI-powered resume scoring". Right: "CANDIDATE SCORECARD" + date
- **Candidate info bar**: Light background. Left: bold name, email icon + email, phone icon + phone. Right: 4 score boxes (Technical %, Experience %, Education %, Stability %) each with colored label, large percentage, and progress bar
- **Score breakdown**: 2x2 grid. Each card: icon + category name + percentage + progress bar + AI reasoning paragraph explaining the score
- **Matched skills**: Chips/badges with skill names
- **Highlights**: Bullet points of key strengths
- **AI Assessment**: Warm orange/amber background box with overall AI reasoning paragraph
- **Footer**: "Generated by ScorQ · HYROI Solutions" + date

### 4.4 Crafting pipeline
- **Entry**: Selected candidates from results → moved to craft queue
- **Batch craft**: One button to craft all selected at once
- **Individual craft**: Click "Craft resume" per candidate
- Crafting calls OpenAI to extract + rewrite resume content into structured JSON
- After crafting: shows Crafted ✓ badge, enables Edit + Download buttons

### 4.5 Resume editor (split-screen modal)
- **Left panel**: Edit form
  - Contact info: name, email, phone, location, experience years, notice period
  - Executive summary: numbered textarea rows (8-12 bullets)
  - Employment history: nested — Company (editable) → Projects within company (editable), each with responsibilities
  - Certifications: name, issuer, expiry date (if missing, show warning)
- **Right panel**: Live preview of the formatted resume that updates as you type
- **Buttons**: Save changes, Save & download, Cancel

### 4.6 Resume format (structured output)
The AI should return and the document should follow this structure:

```
[HEADER: Candidate name, contact info (masked if PI mask is on)]

EXECUTIVE SUMMARY
• 8-12 bullet points

CORE COMPETENCIES
| Domain | Skills | Tools |

EMPLOYMENT HISTORY
  Company 1 — Role | Location
  Duration: Start – End
    ├── Project 1.1 (Duration)
    │   • Responsibility bullets
    │   Tech: skills used
    ├── Project 1.2 (Duration)
    │   • Responsibility bullets

  Company 2 — Role | Location
    ├── Project 2.1 ...

EDUCATION & CERTIFICATIONS
  Degree — Institution, Year
  | Certification | Issuer | Expiry |
  (⚠ Missing expiry → action item for recruiter)

TECHNICAL COMPETENCIES
  Programming Languages: ...
  Tools & Technologies: ...
  Platforms: ...

[FOOTER: Company logo + name + tagline | "Generated by ScorCraft · Confidential"]
```

IMPORTANT table formatting rules:
- All tables must use fixed column widths with word-wrap
- Text must NEVER overflow outside table cells
- Use `tableLayout: fixed` in CSS, `WORDWRAP` in ReportLab

### 4.7 Download options
Three download options (no action items in any download):
1. **Resume only** — PDF or DOCX. Formatted resume with letterhead footer
2. **Scorecard only** — PDF. Full ScorQ scorecard matching existing design
3. **Combined: Resume + Scorecard** — PDF. Resume pages followed by full scorecard as LAST PAGE

PI masking applies to all downloads when enabled.
Logo appears in footer of all downloaded documents.

### 4.8 Action items (INTERNAL ONLY)
Action items are for the recruiter inside the tool. They are NEVER included in any downloaded document.
Sources of action items:
- Missing phone number
- Missing email
- Missing notice period
- Missing current location
- Certification expiry date not specified
- LinkedIn profile missing
- Education details incomplete
- Missing must-have skills (from scoring)
- Red flags from scoring

Display with yellow background, checkbox-style list, labeled "internal only"

---

## 5. API ENDPOINTS

### Existing (from ScorQ — keep as-is):
```
POST   /api/v1/scoring/single     — Score one resume
POST   /api/v1/scoring/batch      — Score multiple resumes
GET    /api/v1/results/session/:id — Get session results
GET    /api/v1/results/score/:id   — Get single score
POST   /api/v1/jobs               — Create job
GET    /api/v1/jobs               — List jobs
GET    /api/v1/jobs/:id           — Get job
PUT    /api/v1/jobs/:id           — Update job
```

### New (crafting pipeline):
```
POST   /api/v1/craft/single       — Craft one scored resume
  Body: { score_id, settings: { mask_pi, company_name, company_tagline, logo_storage_path } }
  Returns: { craft_id, structured_data, missing_report, download_url }

POST   /api/v1/craft/batch        — Craft multiple scored resumes
  Body: { score_ids: [], settings: {} }

PUT    /api/v1/craft/:id          — Update crafted resume (save editor changes)
  Body: structured_data (full JSON)
  Returns: regenerated DOCX + updated missing_report

GET    /api/v1/download/:id/docx         — Download resume as DOCX
GET    /api/v1/download/:id/resume-pdf   — Download resume as PDF
GET    /api/v1/download/:id/scorecard-pdf — Download scorecard as PDF
GET    /api/v1/download/:id/combined-pdf  — Download resume + scorecard as combined PDF
```

---

## 6. ENVIRONMENT VARIABLES

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
RESUME_STORAGE_BUCKET=resumes
ORIGINAL_BUCKET=original-resumes
FORMATTED_BUCKET=formatted-resumes
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o
AI_MAX_TOKENS=1500
AI_TEMPERATURE=0.1
CRAFT_MAX_TOKENS=4096
CRAFT_TEMPERATURE=0.1
```

---

## 7. BRANDING

- **App name**: ScorCraft
- **Byline**: by HYROI Solutions
- **Navy**: #1A2744
- **Gold**: #C8963E
- **Indigo accent**: #4338CA
- **Logo format**: "Scor" in white, "Craft" in gold
- **Scorecard branding**: "ScorQ by HYROI Solutions" (the scoring engine keeps its name)
- **Footer on all documents**: Company logo (if uploaded) + company name + "Generated by ScorCraft · Confidential"

---

## 8. IMPLEMENTATION ORDER

Build in this order:

### Phase 1: Backend merge
1. Set up project structure with both codebases
2. Create unified config.py (OpenAI-only)
3. Create unified main.py with all routers
4. Keep ALL ScorQ scoring files unchanged (rule_engine/, ai/, scorer.py, etc.)
5. Create `services/ai_processor.py` — OpenAI resume extraction for crafting
6. Create `api/crafting.py` — craft single/batch/edit endpoints
7. Create `services/pdf_generator.py` — resume PDF + scorecard PDF + combined PDF
8. Create `api/download.py` — download endpoints
9. Enhance `services/docx_generator.py` — nested employment history, certification table with expiry, letterhead footer, fixed table widths
10. Run Supabase migration SQL
11. Test all endpoints

### Phase 2: Frontend
1. Set up Next.js 14 + TypeScript + Tailwind
2. Build components in this order:
   a. Header + StepBar (pipeline progress)
   b. JobSelector (from ScorQ, simplified)
   c. ResumeUploader (batch drag-drop)
   d. ScoringProgress (animated)
   e. ResultsTable + CandidateRow (the main screen — filters, cutoff slider, selection)
   f. CraftSettings (PI mask toggle, logo upload, letterhead)
   g. ScoreCard component (match existing PDF design exactly)
   h. CraftQueue (batch/individual craft)
   i. ResumeEditor (split-screen with live preview)
   j. ResumePreview (formatted output)
   k. DownloadModal (3 options)
   l. ActionItems (internal-only checklist)
3. Wire up API calls
4. Test full flow end-to-end

---

## 9. CRITICAL RULES

1. **Scoring logic must not change** — the ScorQ rule engine and AI pipeline work. Don't modify them.
2. **No automatic SHORTLIST/REVIEW/PASS tags** — recruiter sets cutoff slider manually
3. **Action items are INTERNAL ONLY** — never in downloads, never shared with clients
4. **PI masking** removes email + phone from both the UI display AND all downloaded documents when enabled
5. **Tables must not overflow** — use fixed widths and word-wrap everywhere (CSS: `table-layout: fixed; word-break: break-word`, ReportLab: fixed colWidths + WORDWRAP)
6. **Employment history is nested**: Company → Projects (not flat project list)
7. **Certifications need expiry dates** — if missing, flag as action item for recruiter
8. **Scorecard design must match existing ScorQ PDF** exactly (see section 4.3)
9. **Combined PDF** = resume pages + scorecard as last page. No action items.
10. **OpenAI only** — no Groq, no Gemini, no Anthropic in the crafting pipeline

---

## 10. GETTING STARTED WITH CLAUDE CODE

### Prerequisites
- Node.js 18+ (for Claude Code and Next.js frontend)
- Python 3.12 (for backend)
- Supabase project (with existing ScorQ tables)
- OpenAI API key

### Setup steps
```bash
# 1. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 2. Clone or create your repo
mkdir scorcraft && cd scorcraft
git init

# 3. Start Claude Code
claude

# 4. Paste this entire spec as your first message, then say:
# "Build the ScorCraft backend first, following the spec exactly. 
#  Start with the project structure, then config, then merge the 
#  scoring and crafting pipelines."
```

### If you have the existing codebases:
```bash
# Put both ZIPs in the repo root
# Tell Claude Code:
# "I have scorq-main.zip and resume-builder-main.zip in the root.
#  Extract them as references, then build the merged ScorCraft 
#  project following the spec. Keep all ScorQ scoring logic unchanged.
#  Create the new crafting pipeline with OpenAI only."
```

### Useful Claude Code commands during build:
- `/init` — initialize the project with CLAUDE.md memory file
- Ask Claude Code to run the backend: `uvicorn main:app --reload --port 8000`
- Ask it to run the frontend: `cd frontend && npm run dev`
- Ask it to run the migration: "Run the migration SQL in Supabase"
- Ask it to test: "Test the scoring endpoint with a sample PDF"
