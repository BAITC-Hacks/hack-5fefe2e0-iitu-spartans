"""Сервис выбора сценария: POST /route — реплика + состояние диалога -> RouteDecision (контракт packages/core)."""
import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.config import settings
from app.dataset import load
from app.router.router import (
    DEFAULT_ROUTER_MODEL,
    DialogState,
    RouterFailure,
    RouterResult,
    RouterTimeout,
    RouterUnavailable,
    _client,
    route,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load()  # падаем на старте, если датасет битый; без ключа модели сервис стартует
    yield


app = FastAPI(title="Voice Router — сервис выбора сценария", lifespan=lifespan)


class RouteRequest(BaseModel):
    utterance: str = Field(min_length=1, max_length=2000)
    state: DialogState = Field(default_factory=DialogState)

    @field_validator("utterance")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("utterance не должен быть пустым")
        return v


def model_client():
    """Клиент модели или None без ключа. В тестах подменяется поддельным (app.dependency_overrides)."""
    return _client() if settings.openai_api_key else None


@app.get("/health")
def health():
    ds = load()
    return {
        "status": "ok",
        "model_key": bool(settings.openai_api_key),
        "model": settings.router_model or DEFAULT_ROUTER_MODEL,
        "scenarios": len(ds.scenarios),
        "slots": len(ds.slots),
        "actions": len(ds.actions),
        "clients": len(ds.backend.clients),
    }


@app.post(
    "/route",
    response_model=RouterResult,
    responses={422: {"description": "невалидный вход"}, 502: {"description": "ошибка модели"},
               503: {"description": "нет ключа модели"}, 504: {"description": "таймаут модели"}},
    openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": RouteRequest.model_json_schema()}}}},
)
async def route_endpoint(request: Request, client: Any = Depends(model_client)) -> RouterResult:
    # Тело читается как JSON при любом Content-Type: `curl -d '{...}'` без заголовка шлёт
    # application/x-www-form-urlencoded, и стандартный разбор FastAPI вернул бы 422 на валидный JSON.
    raw = await request.body()
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise RequestValidationError([{"type": "json_invalid", "loc": ("body",), "msg": f"тело не JSON: {e}", "input": None}])
    try:
        req = RouteRequest.model_validate(payload)
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False))

    if client is None:
        raise HTTPException(503, "OPENAI_API_KEY не задан: выбор сценария моделью недоступен (web использует резервный путь)")
    try:
        return await route(req.utterance, req.state, client=client)
    except RouterUnavailable as e:
        raise HTTPException(503, str(e))
    except RouterTimeout as e:
        raise HTTPException(504, f"таймаут модели: {e}")
    except RouterFailure as e:
        raise HTTPException(502, str(e))
