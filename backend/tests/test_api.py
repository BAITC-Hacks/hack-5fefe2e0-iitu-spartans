"""HTTP-слой сервиса выбора сценария: /health и POST /route (поддельный клиент модели, без сети)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, settings
from app.main import app, model_client
from tests.fakes import FakeModelClient, llm_route

# Общая фикстура с TS-тестом packages/core: тот же ответ проверяется схемой RouteDecisionSchema из ядра.
CONTRACT_FIXTURE = REPO_ROOT / "packages/core/src/contracts/fixtures/router-service-route.json"

PAYOUT = llm_route(
    [("SC17", 0.92, "asks payout date of existing claim", "Когда будет выплата")],
    alternatives=[("SC19", 0.2)],
    situation="claim filed earlier, asks payout timing",
)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "router_model", "")
    yield TestClient(app)
    app.dependency_overrides.clear()


def use_model(parsed=PAYOUT, **kwargs) -> FakeModelClient:
    fake = FakeModelClient(parsed, **kwargs)
    app.dependency_overrides[model_client] = lambda: fake
    return fake


# --- /health ---

def test_health_reports_missing_key(client, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["model_key"] is False
    assert body["scenarios"] == 40


def test_health_reports_present_key(client, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    assert client.get("/health").json()["model_key"] is True


# --- POST /route: корректный ответ ---

def test_route_matches_core_contract_fixture(client):
    use_model()
    r = client.post("/route", json={"utterance": "Когда будет выплата?", "state": {}})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["latency_ms"], int)
    expected = json.loads(CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    assert {**body, "latency_ms": 0} == expected


def test_route_accepts_json_body_without_json_content_type(client):
    # Проверка лида: curl -X POST localhost:8000/route -d '{...}' шлёт application/x-www-form-urlencoded
    use_model()
    r = client.post(
        "/route",
        content='{"utterance":"Когда будет выплата?","state":{}}'.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200
    assert r.json()["scenarios"][0]["scenario_id"] == "SC17"


def test_route_accepts_web_client_state(client):
    fake = use_model()
    state = {"activeScenario": "SC17", "lowConfidenceStreak": 0, "history": [{"role": "client", "text": "Здравствуйте"}]}
    r = client.post("/route", json={"utterance": "Когда будет выплата?", "state": state})
    assert r.status_code == 200
    assert "SC17" in fake.calls[0]["input"]


def test_route_state_optional(client):
    use_model()
    assert client.post("/route", json={"utterance": "Когда будет выплата?"}).status_code == 200


# --- POST /route: 422 на невалидный вход ---

@pytest.mark.parametrize("body", [
    b"not json",
    b"",
    b"[]",
    b'{"state": {}}',
    b'{"utterance": "   ", "state": {}}',
    b'{"utterance": 42, "state": {}}',
    b'{"utterance": "ok", "state": "SC17"}',
    json.dumps({"utterance": "x" * 2001}).encode(),
])
def test_route_invalid_input_422(client, body):
    fake = use_model()
    r = client.post("/route", content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "detail" in r.json()
    assert fake.calls == []


def test_invalid_input_is_422_even_without_key(client, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert client.post("/route", content=b"not json").status_code == 422


# --- POST /route: сбои модели ---

def test_route_without_key_503(client, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    r = client.post("/route", json={"utterance": "Когда будет выплата?", "state": {}})
    assert r.status_code == 503
    assert "OPENAI_API_KEY" in r.json()["detail"]


def test_route_model_timeout_504(client, monkeypatch):
    monkeypatch.setattr(settings, "router_timeout_s", 0.05)
    use_model(delay_s=1)
    r = client.post("/route", json={"utterance": "Когда будет выплата?", "state": {}})
    assert r.status_code == 504
    assert "таймаут" in r.json()["detail"]


def test_route_model_error_502(client):
    use_model(error=RuntimeError("upstream exploded"))
    r = client.post("/route", json={"utterance": "Когда будет выплата?", "state": {}})
    assert r.status_code == 502
    assert "upstream exploded" in r.json()["detail"]
