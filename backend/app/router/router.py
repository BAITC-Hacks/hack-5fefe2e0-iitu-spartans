"""LLM-роутер: реплика + состояние диалога -> сценарии по контракту README (structured output)."""
import time
from enum import Enum
from functools import lru_cache
from typing import Literal

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.config import settings
from app.dataset import SYSTEM_INTENTS, load
from app.router.prompt import dynamic_input, static_prompt

DEFAULT_ROUTER_MODEL = "gpt-5.4-mini"  # выбор по docs/ROUTER_LOG.md

_ds = load()
# Enum из данных: модель физически не может вернуть несуществующий ID сценария или слота
RouteId = Enum("RouteId", {i: i for i in [*_ds.scenarios, *sorted(SYSTEM_INTENTS)]}, type=str)
SlotName = Enum("SlotName", {s: s for s in _ds.slots}, type=str)


# --- схема ответа LLM (strict JSON schema) ---

class _Pick(BaseModel):
    quote: str  # фрагмент реплики с этим запросом: фиксирует порядок упоминания
    scenario_id: RouteId
    confidence: float
    reason: str


class _Alt(BaseModel):
    scenario_id: RouteId
    confidence: float


class _SlotValue(BaseModel):
    name: SlotName
    value: str


class _LLMRoute(BaseModel):
    situation: str  # короткий разбор до выбора: когда/где/роль/есть ли полис
    language: Literal["ru", "kk", "mixed"]
    response_language: Literal["ru", "kk"]
    is_continuation: bool
    scenarios: list[_Pick]
    alternatives: list[_Alt]
    slots: list[_SlotValue]


# --- публичный контракт ---

class ScenarioPick(BaseModel):
    scenario_id: str
    confidence: float
    reason: str = ""


class RouterResult(BaseModel):
    scenarios: list[ScenarioPick]
    alternatives: list[ScenarioPick]
    language: Literal["ru", "kk", "mixed"]
    response_language: Literal["ru", "kk"]
    situation: str
    slots: dict[str, str]
    is_continuation: bool
    latency_ms: int
    model: str
    usage: dict[str, int] = Field(default_factory=dict)


class DialogState(BaseModel):
    active_scenario: str | None = None
    pending_question: str | None = None
    stack: list[str] = Field(default_factory=list)
    slots: dict[str, str] = Field(default_factory=dict)
    response_language: Literal["ru", "kk"] | None = None
    last_turns: list[dict[str, str]] = Field(default_factory=list)  # [{"role": "client"|"bot", "text": ...}], 1–2 последние


@lru_cache
def _client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.openai_api_key or None)


def _is_reasoning(model: str) -> bool:
    return model.startswith(("gpt-5", "o"))


async def route(utterance: str, state: DialogState | None = None, *, model: str | None = None) -> RouterResult:
    model = model or settings.router_model or DEFAULT_ROUTER_MODEL
    kwargs = {}
    if _is_reasoning(model):
        kwargs["reasoning"] = {"effort": settings.router_reasoning_effort or "none"}
    else:
        kwargs["temperature"] = 0

    if settings.router_service_tier:
        kwargs["service_tier"] = settings.router_service_tier

    started = time.perf_counter()
    resp = await _client().responses.parse(
        model=model,
        instructions=static_prompt(),
        input=dynamic_input(utterance, state.model_dump(exclude_none=True) if state else None),
        text_format=_LLMRoute,
        max_output_tokens=settings.router_max_output_tokens,
        prompt_cache_key="voice-router",
        store=False,
        **kwargs,
    )
    latency_ms = round((time.perf_counter() - started) * 1000)

    out = resp.output_parsed
    if out is None:
        raise RuntimeError(f"router returned no parsed output (status={resp.status}, incomplete={resp.incomplete_details})")

    # дубликаты убираем, порядок упоминания сохраняем
    seen: set[str] = set()
    picks = []
    for p in out.scenarios:
        if p.scenario_id.value not in seen:
            seen.add(p.scenario_id.value)
            picks.append(ScenarioPick(scenario_id=p.scenario_id.value, confidence=p.confidence, reason=p.reason))
    # инвариант контракта: системный интент не соседствует с бизнес-сценарием
    if any(p.scenario_id not in SYSTEM_INTENTS for p in picks):
        picks = [p for p in picks if p.scenario_id not in SYSTEM_INTENTS]
    if not picks:
        picks = [ScenarioPick(scenario_id="SYS_UNCLEAR", confidence=0.0, reason="router returned no scenarios")]

    u = resp.usage
    return RouterResult(
        scenarios=picks,
        alternatives=[
            ScenarioPick(scenario_id=a.scenario_id.value, confidence=a.confidence)
            for a in out.alternatives
            if a.scenario_id.value not in seen
        ],
        language=out.language,
        response_language=out.response_language,
        situation=out.situation,
        slots={s.name.value: s.value for s in out.slots},
        is_continuation=out.is_continuation,
        latency_ms=latency_ms,
        model=model,
        usage={
            "input": u.input_tokens,
            "cached": u.input_tokens_details.cached_tokens,
            "output": u.output_tokens,
        }
        if u
        else {},
    )
