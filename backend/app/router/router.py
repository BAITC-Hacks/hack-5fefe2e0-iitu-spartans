"""LLM-роутер: реплика + состояние диалога -> сценарии по контракту README (structured output)."""
import asyncio
import time
from enum import Enum
from functools import lru_cache
from typing import Literal

from openai import APITimeoutError, AsyncOpenAI
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

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


# --- публичный контракт: зеркало RouteDecision из packages/core (contracts/route-decision.ts) ---
# Поля контракта: scenarios[{scenario_id, confidence 0..1, reason непустой}], alternatives[{scenario_id,
# confidence}], language, slots, is_continuation. Сверх контракта для панели трассировки: quote, situation,
# response_language, latency_ms, model, usage — ядро их пропускает при разборе.

NO_REASON = "no reason given"


class ScenarioPick(BaseModel):
    scenario_id: str
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1)
    quote: str = ""  # фрагмент реплики с этим запросом (для панели трассировки)


class Alternative(BaseModel):
    scenario_id: str
    confidence: float = Field(ge=0, le=1)


class RouterResult(BaseModel):
    scenarios: list[ScenarioPick] = Field(min_length=1)
    alternatives: list[Alternative]
    language: Literal["ru", "kk", "mixed"]
    response_language: Literal["ru", "kk"]
    situation: str
    slots: dict[str, str]
    is_continuation: bool
    latency_ms: int
    model: str
    usage: dict[str, int] = Field(default_factory=dict)


LAST_TURNS = 2


class DialogState(BaseModel):
    """Состояние диалога для роутера. Принимает и формат сервиса, и ClientDialogState веб-интерфейса
    (activeScenario, history, language, lowConfidenceStreak): web передаёт своё состояние как есть."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    active_scenario: str | None = Field(default=None, validation_alias=AliasChoices("active_scenario", "activeScenario"))
    pending_question: str | None = None
    stack: list[str] = Field(default_factory=list)
    slots: dict[str, str] = Field(default_factory=dict)
    response_language: Literal["ru", "kk"] | None = None
    # [{"role": "client"|"bot", "text": ...}], LAST_TURNS последних
    last_turns: list[dict[str, str]] = Field(default_factory=list, validation_alias=AliasChoices("last_turns", "history"))

    @model_validator(mode="before")
    @classmethod
    def _from_web_state(cls, data):
        # language веб-состояния: ru/kk задают язык ответа, mixed не фиксирует его
        if isinstance(data, dict) and "response_language" not in data and data.get("language") in ("ru", "kk"):
            data = {**data, "response_language": data["language"]}
        return data

    @model_validator(mode="after")
    def _trim_turns(self):
        self.last_turns = self.last_turns[-LAST_TURNS:]
        return self


class RouterUnavailable(RuntimeError):
    """Модель недоступна по конфигурации (нет ключа): HTTP 503."""


class RouterTimeout(RuntimeError):
    """Модель не ответила за settings.router_timeout_s: HTTP 504."""


class RouterFailure(RuntimeError):
    """Модель ответила ошибкой или без разобранного ответа: HTTP 502."""


@lru_cache
def _client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.openai_api_key or None)


def _is_reasoning(model: str) -> bool:
    return model.startswith(("gpt-5", "o"))


def _clamp(x: float) -> float:
    return min(1.0, max(0.0, x))


def _mention_order(utterance: str, picks: list[ScenarioPick]) -> list[ScenarioPick]:
    """Порядок упоминания по позиции quote в реплике. Если хоть одна цитата не найдена дословно —
    оставляем порядок модели (её тоже просят сортировать по quote)."""
    text = utterance.casefold()
    positions = [text.find(p.quote.casefold()) if p.quote else -1 for p in picks]
    if any(pos < 0 for pos in positions):
        return picks
    return [p for _, p in sorted(zip(positions, picks), key=lambda x: x[0])]


async def route(
    utterance: str, state: DialogState | None = None, *, model: str | None = None, client=None,
) -> RouterResult:
    """client — объект с интерфейсом AsyncOpenAI (responses.parse); в тестах — поддельный."""
    if client is None:
        if not settings.openai_api_key:
            raise RouterUnavailable("OPENAI_API_KEY не задан: выбор сценария моделью недоступен")
        client = _client()
    model = model or settings.router_model or DEFAULT_ROUTER_MODEL
    kwargs = {}
    if _is_reasoning(model):
        kwargs["reasoning"] = {"effort": settings.router_reasoning_effort or "none"}
    else:
        kwargs["temperature"] = 0

    if settings.router_service_tier:
        kwargs["service_tier"] = settings.router_service_tier

    started = time.perf_counter()
    try:
        resp = await asyncio.wait_for(
            client.responses.parse(
                model=model,
                instructions=static_prompt(),
                input=dynamic_input(utterance, state.model_dump(exclude_none=True) if state else None),
                text_format=_LLMRoute,
                max_output_tokens=settings.router_max_output_tokens,
                prompt_cache_key="voice-router",
                store=False,
                **kwargs,
            ),
            timeout=settings.router_timeout_s,
        )
    except (TimeoutError, APITimeoutError) as e:
        raise RouterTimeout(f"модель {model} не ответила за {settings.router_timeout_s:g} с") from e
    except Exception as e:  # сеть, лимиты, ошибка API
        raise RouterFailure(f"ошибка модели {model}: {e}") from e
    latency_ms = round((time.perf_counter() - started) * 1000)

    out = resp.output_parsed
    if out is None:
        raise RouterFailure(f"router returned no parsed output (status={resp.status}, incomplete={resp.incomplete_details})")

    # дубликаты убираем, первое упоминание сохраняем
    seen: set[str] = set()
    picks = []
    for p in out.scenarios:
        if p.scenario_id.value not in seen:
            seen.add(p.scenario_id.value)
            picks.append(ScenarioPick(
                scenario_id=p.scenario_id.value, confidence=_clamp(p.confidence), reason=p.reason.strip() or NO_REASON,
                quote=p.quote,
            ))
    # инвариант контракта: системный интент не соседствует с бизнес-сценарием
    if any(p.scenario_id not in SYSTEM_INTENTS for p in picks):
        picks = [p for p in picks if p.scenario_id not in SYSTEM_INTENTS]
    # инвариант контракта: сценарии в порядке упоминания в реплике
    picks = _mention_order(utterance, picks)
    if not picks:
        picks = [ScenarioPick(scenario_id="SYS_UNCLEAR", confidence=0.0, reason="router returned no scenarios")]

    u = resp.usage
    alternatives: list[Alternative] = []
    for a in out.alternatives:
        if a.scenario_id.value not in seen:
            seen.add(a.scenario_id.value)
            alternatives.append(Alternative(scenario_id=a.scenario_id.value, confidence=_clamp(a.confidence)))
    return RouterResult(
        scenarios=picks,
        alternatives=alternatives,
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
