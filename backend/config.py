"""
ScorCraft — Central config. Reads from .env
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "ScorCraft by HYROI Solutions"
    APP_VERSION: str = "1.0.0"

    # ── Supabase ─────────────────────────────────────────────
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    RESUME_STORAGE_BUCKET: str = os.getenv("RESUME_STORAGE_BUCKET", "resumes")
    ORIGINAL_BUCKET: str = os.getenv("ORIGINAL_BUCKET", "original-resumes")
    FORMATTED_BUCKET: str = os.getenv("FORMATTED_BUCKET", "formatted-resumes")

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
