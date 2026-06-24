"""
AI Router — reads AI_PROVIDER from .env and routes to correct adapter.
To switch models: change AI_PROVIDER in .env. No code change needed.
"""
from config import settings
from services.ai.adapters.base import BaseAdapter


def get_adapter() -> BaseAdapter:
    provider = settings.AI_PROVIDER.lower()

    if provider == "openai":
        from services.ai.adapters.openai_adapter import OpenAIAdapter
        return OpenAIAdapter()

    elif provider == "anthropic":
        from services.ai.adapters.anthropic_adapter import AnthropicAdapter
        return AnthropicAdapter()

    elif provider == "google":
        from services.ai.adapters.google_adapter import GoogleAdapter
        return GoogleAdapter()

    elif provider == "grok":
        from services.ai.adapters.grok_adapter import GrokAdapter
        return GrokAdapter()

    else:
        raise ValueError(
            f"Unknown AI_PROVIDER: '{provider}'. "
            f"Must be one of: openai, anthropic, google, grok"
        )
