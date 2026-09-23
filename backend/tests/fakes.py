"""Поддельный клиент модели: отвечает заранее заданным разбором, без сети и без ключа."""
import asyncio
from types import SimpleNamespace

from app.router.router import _LLMRoute


def llm_route(scenarios, *, alternatives=(), language="ru", situation="test", slots=(), is_continuation=False) -> _LLMRoute:
    """scenarios: [(scenario_id, confidence, reason, quote)]; alternatives: [(scenario_id, confidence)]."""
    return _LLMRoute.model_validate({
        "situation": situation,
        "language": language,
        "response_language": "kk" if language == "kk" else "ru",
        "is_continuation": is_continuation,
        "scenarios": [{"scenario_id": i, "confidence": c, "reason": r, "quote": q} for i, c, r, q in scenarios],
        "alternatives": [{"scenario_id": i, "confidence": c} for i, c in alternatives],
        "slots": [{"name": n, "value": v} for n, v in slots],
    })


class FakeModelClient:
    """Повторяет форму AsyncOpenAI: client.responses.parse(...) -> объект с output_parsed и usage."""

    def __init__(self, parsed: _LLMRoute | None = None, *, delay_s: float = 0.0, error: Exception | None = None):
        self.calls: list[dict] = []
        self.responses = SimpleNamespace(parse=self._parse)
        self._parsed, self._delay_s, self._error = parsed, delay_s, error

    async def _parse(self, **kwargs):
        self.calls.append(kwargs)
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._error:
            raise self._error
        return SimpleNamespace(output_parsed=self._parsed, usage=None, status="completed", incomplete_details=None)
