"""Инварианты маршрутизатора из docs/ROUTER_LOG.md на поддельном клиенте модели (без сети)."""
import asyncio

import pytest
from pydantic import ValidationError

from app.config import settings
from app.dataset import SYSTEM_INTENTS, load
from app.router.router import (
    DialogState,
    RouteId,
    RouterFailure,
    RouterTimeout,
    RouterUnavailable,
    _LLMRoute,
    route,
)
from tests.fakes import FakeModelClient, llm_route


def run(utterance, parsed, **kwargs):
    return asyncio.run(route(utterance, client=FakeModelClient(parsed), **kwargs))


def ids(result):
    return [p.scenario_id for p in result.scenarios]


# --- SYS_* не смешивается с бизнес-сценарием ---

def test_system_intent_dropped_when_business_scenario_present():
    r = run("Хочу продлить ОГПО, а вообще не знаю", llm_route([
        ("SC27", 0.9, "extend policy", "продлить ОГПО"),
        ("SYS_UNCLEAR", 0.3, "vague tail", "а вообще не знаю"),
    ]))
    assert ids(r) == ["SC27"]


def test_system_intent_alone_is_kept():
    r = run("Какая погода завтра в Алматы?", llm_route([("SYS_OUT_OF_SCOPE", 0.95, "weather", "погода")]))
    assert ids(r) == ["SYS_OUT_OF_SCOPE"]


# --- порядок scenarios = порядок упоминания ---

def test_order_follows_mention_in_utterance_not_model_order():
    utterance = "Посчитайте каско и обязательную страховку на одну машину"
    r = run(utterance, llm_route([
        ("SC01", 0.9, "OGPO quote", "обязательную страховку"),
        ("SC03", 0.9, "CASCO quote", "каско"),
    ]))
    assert ids(r) == ["SC03", "SC01"]


def test_model_order_kept_when_quote_not_found_in_utterance():
    r = run("каско и обязательную", llm_route([
        ("SC01", 0.9, "OGPO quote", "ОСАГО"),
        ("SC03", 0.9, "CASCO quote", "каско"),
    ]))
    assert ids(r) == ["SC01", "SC03"]


def test_duplicates_removed_first_mention_kept():
    r = run("Статус выплаты, статус выплаты", llm_route([
        ("SC17", 0.9, "claim status", "Статус выплаты"),
        ("SC17", 0.8, "claim status", "статус выплаты"),
    ]))
    assert ids(r) == ["SC17"]


# --- пустой scenarios → SYS_UNCLEAR ---

def test_empty_scenarios_becomes_sys_unclear():
    r = run("ммм", llm_route([]))
    assert ids(r) == ["SYS_UNCLEAR"]
    assert r.scenarios[0].confidence == 0.0
    assert r.scenarios[0].reason


# --- ID сценариев только из датасета ---

def test_route_ids_are_exactly_dataset_scenarios_and_system_intents():
    ds = load()
    assert {m.value for m in RouteId} == set(ds.scenarios) | SYSTEM_INTENTS


def test_schema_sent_to_model_enumerates_only_dataset_ids():
    schema = _LLMRoute.model_json_schema()
    assert set(schema["$defs"]["RouteId"]["enum"]) == set(load().scenarios) | SYSTEM_INTENTS


@pytest.mark.parametrize("bad_id", ["SC41", "SC00", "BOOKING", "sc01"])
def test_unknown_scenario_id_rejected(bad_id):
    with pytest.raises(ValidationError):
        llm_route([(bad_id, 0.9, "x", "x")])


# --- контракт RouteDecision из packages/core ---

def test_confidence_clamped_and_reason_never_empty():
    r = run("Когда будет выплата?", llm_route(
        [("SC17", 1.2, "", "Когда будет выплата")], alternatives=[("SC19", -0.1)],
    ))
    assert r.scenarios[0].confidence == 1.0 and r.scenarios[0].reason
    assert r.alternatives[0].confidence == 0.0


def test_alternatives_have_no_reason_and_exclude_chosen():
    r = run("Когда будет выплата?", llm_route(
        [("SC17", 0.7, "claim status", "Когда будет выплата")], alternatives=[("SC17", 0.6), ("SC19", 0.3)],
    ))
    assert [a.model_dump() for a in r.alternatives] == [{"scenario_id": "SC19", "confidence": 0.3}]


def test_quote_and_situation_returned_for_trace_panel():
    r = run("Когда будет выплата?", llm_route(
        [("SC17", 0.9, "claim status", "Когда будет выплата")], situation="claim filed earlier, asks payout date",
    ))
    assert r.scenarios[0].quote == "Когда будет выплата"
    assert r.situation == "claim filed earlier, asks payout date"
    assert isinstance(r.latency_ms, int)


# --- состояние: формат веб-интерфейса (ClientDialogState) и формат сервиса ---

def test_state_accepts_web_client_dialog_state():
    st = DialogState.model_validate({
        "language": "kk",
        "activeScenario": "SC17",
        "lowConfidenceStreak": 1,
        "history": [
            {"role": "client", "text": "a"},
            {"role": "bot", "text": "b"},
            {"role": "client", "text": "c"},
        ],
    })
    assert st.active_scenario == "SC17"
    assert st.response_language == "kk"
    assert st.last_turns == [{"role": "bot", "text": "b"}, {"role": "client", "text": "c"}]


def test_state_mixed_language_does_not_fix_response_language():
    assert DialogState.model_validate({"language": "mixed"}).response_language is None


def test_state_passed_to_model_input():
    client = FakeModelClient(llm_route([("SC17", 0.9, "continues", "да")], is_continuation=True))
    asyncio.run(route("да", DialogState(active_scenario="SC17"), client=client))
    assert "SC17" in client.calls[0]["input"]


# --- сбои модели ---

def test_no_key_raises_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(RouterUnavailable, match="OPENAI_API_KEY"):
        asyncio.run(route("Когда будет выплата?"))


def test_timeout_raises_router_timeout(monkeypatch):
    monkeypatch.setattr(settings, "router_timeout_s", 0.05)
    client = FakeModelClient(llm_route([("SC17", 0.9, "x", "x")]), delay_s=1)
    with pytest.raises(RouterTimeout):
        asyncio.run(route("Когда будет выплата?", client=client))


def test_model_error_raises_router_failure():
    client = FakeModelClient(error=RuntimeError("boom"))
    with pytest.raises(RouterFailure, match="boom"):
        asyncio.run(route("Когда будет выплата?", client=client))


def test_unparsed_output_raises_router_failure():
    with pytest.raises(RouterFailure):
        asyncio.run(route("Когда будет выплата?", client=FakeModelClient(None)))
