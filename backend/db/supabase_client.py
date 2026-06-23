"""
Supabase client — use service key for backend operations.

Initialization is LAZY: the real client is constructed on first attribute
access, not at import time. This lets the API boot in a degraded mode (e.g.
`/health`) without Supabase credentials present. Any endpoint that actually
touches the database will raise a clear error if the keys are missing.
"""
from supabase import create_client, Client
from config import settings


def get_client() -> Client:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_KEY in backend/.env to use database-backed "
            "endpoints."
        )
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)


class _LazySupabase:
    """Proxy that builds the real Supabase client on first use."""

    _client: Client | None = None

    def _ensure(self) -> Client:
        if self._client is None:
            self._client = get_client()
        return self._client

    def __getattr__(self, name):
        return getattr(self._ensure(), name)


# Importers do `from db.supabase_client import supabase`; keep that name.
supabase = _LazySupabase()
