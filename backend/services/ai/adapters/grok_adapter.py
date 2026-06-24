"""
Grok adapter — xAI Grok models (uses OpenAI-compatible API)
"""
from typing import Tuple
from openai import AsyncOpenAI
from config import settings
from services.ai.adapters.base import BaseAdapter


class GrokAdapter(BaseAdapter):
    def __init__(self):
        # Grok uses OpenAI-compatible API with different base URL
        self.client = AsyncOpenAI(
            api_key=settings.GROK_API_KEY,
            base_url="https://api.x.ai/v1",
        )
        self.model = settings.GROK_MODEL

    async def score(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> Tuple[str, int]:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text = response.choices[0].message.content or ""
        tokens = response.usage.total_tokens if response.usage else 0
        return text, tokens
