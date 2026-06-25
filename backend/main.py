"""
ScorCraft by HYROI Solutions — FastAPI Backend
Merged scoring (ScorQ) + crafting (CraftQ) pipeline.
"""
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

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
    "https://scor-craft-cx1s0a723-sunanda-2822s-projects.vercel.app",
]
if settings.FRONTEND_URL:
    _allowed_origins.append(settings.FRONTEND_URL.rstrip("/"))
# De-dupe while preserving order (FRONTEND_URL may repeat one of the above).
_allowed_origins = list(dict.fromkeys(_allowed_origins))

_allowed_origin_regex = re.compile(r"https://.*\.(app\.github\.dev|vercel\.app)")


def _origin_allowed(origin: str) -> bool:
    """Mirror CORSMiddleware's allow rules for use in exception handlers."""
    if not origin:
        return False
    return origin in _allowed_origins or bool(_allowed_origin_regex.fullmatch(origin))


def _cors_headers(request: Request) -> dict:
    """CORS headers to attach to error responses generated above (outside)
    CORSMiddleware — e.g. unhandled 500s from ServerErrorMiddleware, which
    otherwise reach the browser with no Access-Control-Allow-Origin and show
    up as a misleading 'CORS error'."""
    origin = request.headers.get("origin", "")
    if not _origin_allowed(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


# CORSMiddleware must be the OUTERMOST middleware so it wraps every response,
# including errors. It is the only middleware here, so it is already outermost;
# if more middleware is added later, keep this add_middleware call LAST (Starlette
# wraps the last-added middleware outermost).
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://.*\.(app\.github\.dev|vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Even with CORSMiddleware installed, unhandled exceptions are turned into 500s
# by Starlette's ServerErrorMiddleware, which sits ABOVE CORSMiddleware — so
# those responses never pass back through it and arrive at the browser without
# CORS headers. These handlers regenerate the error responses WITH CORS headers
# so the frontend sees the real status (401/500) instead of a generic CORS wall.
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={**(exc.headers or {}), **_cors_headers(request)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
        headers=_cors_headers(request),
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
