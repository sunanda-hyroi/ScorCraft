"""
ScorCraft — Central config. Reads from .env
"""
import logging
import os
import re
from dotenv import load_dotenv

load_dotenv()

_logger = logging.getLogger("scorcraft.config")

# Supabase Storage bucket names are limited to letters, digits and . _ - ; any
# other character makes Storage reject the request with "Bucket name invalid".
_BUCKET_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _bucket(env_name: str, default: str) -> str:
    """Read a storage bucket name from the environment, defensively.

    Two real-world failure modes are handled so a misconfigured env var can
    never produce an invalid bucket name (Storage 400 "Bucket name invalid"):

    1. Quotes / trailing newline or spaces — common on Railway/PaaS — are
       stripped.
    2. A value containing characters illegal in a bucket name (e.g. a secret or
       password accidentally pasted into the wrong variable) is rejected and the
       safe default is used instead. Such a value can never work, so falling
       back is strictly better than guaranteed failure. A warning is logged so
       the misconfiguration is still visible.
    """
    raw = os.getenv(env_name, "") or ""
    cleaned = raw.strip().strip('"').strip("'").strip()
    if not cleaned:
        return default
    if not _BUCKET_RE.match(cleaned):
        _logger.warning(
            "%s=%r is not a valid bucket name — falling back to %r. "
            "Check the env var (a secret may be pasted into the wrong variable).",
            env_name, cleaned, default,
        )
        return default
    return cleaned


class Settings:
    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "RecruitCraft by HYROI Solutions"
    APP_VERSION: str = "1.0.0"

    # Port the server binds to. On Railway (and most PaaS) the platform injects
    # PORT at runtime; locally it defaults to 8000. uvicorn is launched with
    # --port $PORT (see Procfile / railway.toml), this mirrors it for any code
    # that needs the value.
    PORT: int = int(os.getenv("PORT", "8000"))

    # Production frontend origin (Vercel URL) allowed by CORS. Set after the
    # frontend is deployed, e.g. https://recruitcraft.vercel.app
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "")

    # ── Supabase ─────────────────────────────────────────────
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    RESUME_STORAGE_BUCKET: str = _bucket("RESUME_STORAGE_BUCKET", "resumes")
    ORIGINAL_BUCKET: str = _bucket("ORIGINAL_BUCKET", "original-resumes")
    FORMATTED_BUCKET: str = _bucket("FORMATTED_BUCKET", "formatted-resumes")

    # ── AI — OpenAI only ─────────────────────────────────────
    AI_PROVIDER: str = "openai"
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")

    # Scoring AI settings
    AI_MAX_TOKENS: int = int(os.getenv("AI_MAX_TOKENS", "1500"))
    AI_TEMPERATURE: float = float(os.getenv("AI_TEMPERATURE", "0.1"))

    # Crafting AI settings
    CRAFT_MAX_TOKENS: int = int(os.getenv("CRAFT_MAX_TOKENS", "4096"))
    CRAFT_TEMPERATURE: float = float(os.getenv("CRAFT_TEMPERATURE", "0.1"))

    # ── File handling ────────────────────────────────────────
    ALLOWED_EXTENSIONS: list = [".pdf", ".docx", ".doc"]
    MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10MB

    # ── Cleanup ──────────────────────────────────────────────
    CLEANUP_AFTER_DAYS: int = int(os.getenv("CLEANUP_AFTER_DAYS", "7"))
    CLEANUP_SECRET: str = os.getenv("CLEANUP_SECRET", "")


settings = Settings()
