## Development Rules
- Make file edits without asking for confirmation
- Run tests automatically after changes
- Install required packages when needed
- Fix linting, typecheck, and build errors automatically
- If a build or test fails, diagnose and fix it before reporting back
- Continue until implementation is complete and verified
- Only stop to ask me when you need a product decision, not a technical one
- After any code change, run the relevant build/test command to verify
- Restart servers when config or backend files change

# ScorCraft by HYROI Solutions


## What is this?
ScorCraft is a recruitment tool that scores resumes against jobs (ScorQ engine) and formats shortlisted ones into polished documents (CraftQ engine). Built for internal use by HYROI Solutions recruiters. Output shared with end clients.

## Pipeline
Score first → recruiter reviews → selects candidates above cutoff → craft selected → edit → download

## Tech stack
- Backend: FastAPI (Python 3.12)
- Frontend: Next.js 14 + TypeScript + Tailwind CSS
- Database: Supabase (Postgres + Auth + Storage)
- AI: OpenAI GPT-4o (single provider for both scoring and crafting)
- PDF: ReportLab
- DOCX: python-docx

## Key commands
```bash
# Backend
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

## Architecture
- `backend/services/scorer.py` + `backend/services/rule_engine/` + `backend/services/ai/` = ScorQ scoring pipeline (DO NOT MODIFY)
- `backend/services/ai_processor.py` = CraftQ AI extraction via OpenAI
- `backend/services/pdf_generator.py` = Resume PDF + Scorecard PDF + Combined PDF
- `backend/api/scoring.py` = Score endpoints
- `backend/api/crafting.py` = Craft endpoints  
- `backend/api/download.py` = Download endpoints

## Critical rules
1. ScorQ scoring logic must not change — rule engine overrides AI scores
2. No automatic SHORTLIST/REVIEW/PASS tags — recruiter sets cutoff manually
3. Action items are INTERNAL ONLY — never in downloaded documents
4. PI masking removes email + phone from ALL outputs when enabled
5. Employment history is nested: Company → Projects (not flat)
6. Certification expiry dates required — if missing, flag as action item
7. Combined PDF = resume pages + full scorecard as last page
8. OpenAI GPT-4o only — no other providers
9. Tables must use fixed widths with word-wrap (no overflow)

## Branding
- Navy: #1A2744, Gold: #C8963E, Indigo: #4338CA
- Scoring engine branded as "ScorQ by HYROI Solutions"
- App branded as "ScorCraft by HYROI Solutions"

## Database
Supabase tables: job_descriptions, candidates, scores, scoring_sessions (existing), crafted_resumes (new)
Storage buckets: resumes, original-resumes, formatted-resumes

## Env vars needed
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, OPENAI_API_KEY, OPENAI_MODEL=gpt-4o
