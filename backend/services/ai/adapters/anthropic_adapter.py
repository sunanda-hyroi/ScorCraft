"""
Anthropic adapter — Claude models
"""
from typing import Tuple
import anthropic
from config import settings
from services.ai.adapters.base import BaseAdapter


class AnthropicAdapter(BaseAdapter):
    def __init__(self):
        self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.ANTHROPIC_MODEL

    async def score(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> Tuple[str, int]:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text if response.content else ""
        tokens = response.usage.input_tokens + response.usage.output_tokens
        return text, tokens
