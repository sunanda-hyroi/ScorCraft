"""
ScorCraft by HYROI Solutions — FastAPI Backend
Merged scoring (ScorQ) + crafting (CraftQ) pipeline.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth import router as auth_router
from api.jobs import router as jobs_router
from api.scoring import router as scoring_router
from api.results import router as results_router
from api.crafting import router as crafting_router
from api.download import router as download_router
from config import settings

app = FastAPI(
    title="ScorCraft API — HYROI Solutions",
    description="Score resumes with AI, then craft shortlisted ones into polished documents.",
    version="1.0.0",
)

# CORS — explicit allow-list (works with credentials, unlike "*"). Local dev +
# the production Vercel origins, plus FRONTEND_URL (overridable via env) and a
# regex covering Codespaces forwarded ports and every Vercel preview deployment.
_allowed_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "https://recruitcraft.vercel.app",
    "https://recruitcraft-sunanda-hyrois-projects.vercel.app",
]
if settings.FRONTEND_URL:
    _allowed_origins.append(settings.FRONTEND_URL.rstrip("/"))
# De-dupe while preserving order (FRONTEND_URL may repeat one of the above).
_allowed_origins = list(dict.fromkeys(_allowed_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://.*\.(app\.github\.dev|vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── ScorQ pipeline (score first) ─────────────────────────────
app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(scoring_router)
app.include_router(results_router)

# ── CraftQ pipeline (craft shortlisted) ─────────────────────
app.include_router(crafting_router)
app.include_router(download_router)


def _is_real(value: str) -> bool:
    """A credential is 'real' if present and not a .env.example placeholder."""
    if not value:
        return False
    placeholders = ("your-", "sk-your", "your_project")
    return not any(p in value for p in placeholders)


@app.get("/health")
async def health():
    supabase_ok = _is_real(settings.SUPABASE_URL) and _is_real(settings.SUPABASE_SERVICE_KEY)
    openai_ok = _is_real(settings.OPENAI_API_KEY)
    return {
        "status": "healthy",
        "app": "RecruitCraft",
        "version": "1.0.0",
        "pipeline": "score → filter → craft → download",
        # `configured` tells the frontend whether live scoring/crafting is
        # possible. When false the UI runs in demo mode (mock data).
        "configured": supabase_ok and openai_ok,
        "supabase": supabase_ok,
        "openai": openai_ok,
    }
