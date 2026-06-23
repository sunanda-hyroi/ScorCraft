"""
Base adapter interface — all AI providers implement this
"""
from abc import ABC, abstractmethod
from typing import Dict, Tuple


class BaseAdapter(ABC):
    @abstractmethod
    async def score(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> Tuple[str, int]:
        """
        Score a resume.
        Returns: (response_text, tokens_used)
        """
        pass
