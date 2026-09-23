"""Загрузка стартового набора (data/kit, переопределяется DATASET_DIR) и проверка связей между файлами."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

from app.config import settings

Lang = Literal["ru", "kk"]
SYSTEM_INTENTS = {"SYS_OUT_OF_SCOPE", "SYS_UNCLEAR", "SYS_GOODBYE"}


# --- scenarios.json ---

class BoundaryRule(BaseModel):
    condition: str
    use_instead: str


class ScenarioSlots(BaseModel):
    required: list[str]
    optional: list[str]


class Handoff(BaseModel):
    when: str
    queue: str


class OpeningClosing(BaseModel):
    opening: str
    closing: str


class Scenario(BaseModel):
    scenario_id: str
    slug: str
    name: str
    domain: Literal["auto", "health", "travel", "property", "accident", "corporate", "general"]
    category: Literal["sales", "claims", "servicing", "info", "feedback", "contact", "security"]
    description: str
    not_this_if: list[BoundaryRule]
    priority: Literal["normal", "high", "urgent"]
    fast_path_eligible: bool
    requires_identification: bool
    slots: ScenarioSlots
    actions: list[str]
    requires_confirmation: bool
    handoff: Handoff | None
    examples: dict[Lang, list[str]]
    responses: dict[Lang, OpeningClosing]


class SystemIntent(BaseModel):
    id: str
    description: str
    behavior: str
    response: dict[Lang, str]


# --- slots.json ---

class Slot(BaseModel):
    name: str
    type: Literal["string", "enum", "integer", "date", "boolean", "list", "text"]
    description: str
    pattern: str | None = None
    values: list[str | int] | None = None
    prompt: dict[Lang, str]


# --- actions.json ---

class Action(BaseModel):
    name: str
    description: str
    inputs: list[str]  # "a|b" — одно из
    outputs: list[str]
    errors: list[str]
    irreversible: bool


# --- mock_backend.json ---

class Client(BaseModel):
    client_id: str
    full_name: str
    phone: str
    iin: str
    city: str
    email: str
    address: str
    bm_class: str
    preferred_language: Lang


class Policy(BaseModel):
    policy_number: str
    client_id: str
    product: str
    start_date: str
    end_date: str
    premium: int | None
    details: dict[str, Any]


class Claim(BaseModel):
    claim_number: str
    client_id: str
    policy_number: str
    claim_type: str
    incident_date: str
    status: str
    next_step: str
    approved_amount: int | None = None
    assessor_estimate: int | None = None
    decision_date: str | None = None
    decision_due: str | None = None
    inspection_date: str | None = None
    missing_documents: list[str] | None = None


class Payment(BaseModel):
    payment_id: str
    client_id: str
    date: str
    amount: int
    product: str
    status: str
    policy_number: str | None
    note: str | None = None


class MockBackend(BaseModel):
    defaults: dict[str, str]
    clients: list[Client]
    policies: list[Policy]
    claims: list[Claim]
    payments: list[Payment]


# --- dev_utterances.json / dialogs_sample.json ---

class Utterance(BaseModel):
    id: str
    text: str
    lang: Literal["ru", "kk", "mixed"]
    expected: list[str]
    type: Literal["single", "multi_intent", "out_of_scope", "unclear"]


class Turn(BaseModel):
    role: Literal["client", "bot"]
    text: str
    lang: Literal["ru", "kk", "mixed"]
    scenarios: list[str] | None = None  # client
    slots: dict[str, Any] | None = None  # client
    actions: list[dict[str, Any]] | None = None  # bot


class Dialog(BaseModel):
    dialog_id: str
    title: str
    tags: list[str]
    client_id: str | None
    turns: list[Turn]


class Dataset(BaseModel):
    scenarios: dict[str, Scenario]
    system_intents: dict[str, SystemIntent]
    slots: dict[str, Slot]
    actions: dict[str, Action]
    queues: list[str]
    error_codes: dict[str, str]
    error_handling: list[str]
    knowledge_base: dict[str, Any]  # свободная структура, читается как есть
    backend: MockBackend
    dev_utterances: list[Utterance]
    dialogs: list[Dialog]


def _read(dir_: Path, name: str) -> dict:
    return json.loads((dir_ / name).read_text(encoding="utf-8"))


def _check_links(ds: Dataset) -> None:
    errors: list[str] = []
    route_ids = set(ds.scenarios) | SYSTEM_INTENTS

    for s in ds.scenarios.values():
        for slot in s.slots.required + s.slots.optional:
            if slot not in ds.slots:
                errors.append(f"{s.scenario_id}: unknown slot {slot}")
        for a in s.actions:
            if a not in ds.actions:
                errors.append(f"{s.scenario_id}: unknown action {a}")
        for rule in s.not_this_if:
            if rule.use_instead not in route_ids:
                errors.append(f"{s.scenario_id}: not_this_if -> unknown {rule.use_instead}")
        if s.handoff and s.handoff.queue not in ds.queues:
            errors.append(f"{s.scenario_id}: unknown queue {s.handoff.queue}")
        if s.requires_confirmation != any(ds.actions[a].irreversible for a in s.actions if a in ds.actions):
            errors.append(f"{s.scenario_id}: requires_confirmation does not match irreversible actions")

    for a in ds.actions.values():
        for code in a.errors:
            if code not in ds.error_codes:
                errors.append(f"action {a.name}: unknown error code {code}")

    b = ds.backend
    clients = {c.client_id for c in b.clients}
    policies = {p.policy_number for p in b.policies}
    errors += [f"policy {p.policy_number}: unknown client" for p in b.policies if p.client_id not in clients]
    errors += [f"claim {c.claim_number}: unknown client" for c in b.claims if c.client_id not in clients]
    errors += [f"claim {c.claim_number}: unknown policy" for c in b.claims if c.policy_number not in policies]
    errors += [f"payment {p.payment_id}: unknown client" for p in b.payments if p.client_id not in clients]
    errors += [
        f"payment {p.payment_id}: unknown policy"
        for p in b.payments
        if p.policy_number is not None and p.policy_number not in policies
    ]

    for u in ds.dev_utterances:
        errors += [f"{u.id}: unknown scenario {x}" for x in u.expected if x not in route_ids]
    for d in ds.dialogs:
        if d.client_id is not None and d.client_id not in clients:
            errors.append(f"{d.dialog_id}: unknown client {d.client_id}")
        for t in d.turns:
            errors += [f"{d.dialog_id}: unknown scenario {x}" for x in t.scenarios or [] if x not in route_ids]

    if errors:
        raise ValueError("Dataset link errors:\n" + "\n".join(errors))


@lru_cache
def load(dataset_dir: Path | None = None) -> Dataset:
    dir_ = dataset_dir or settings.dataset_dir
    sc = _read(dir_, "scenarios.json")
    sl = _read(dir_, "slots.json")
    ac = _read(dir_, "actions.json")
    kb = _read(dir_, "knowledge_base.json")
    kb.pop("meta", None)

    ds = Dataset(
        scenarios={s["scenario_id"]: s for s in sc["scenarios"]},
        system_intents={i["id"]: i for i in sc["system_intents"]},
        slots={s["name"]: s for s in sl["slots"]},
        actions={a["name"]: a for a in ac["actions"]},
        queues=ac["queues"],
        error_codes=ac["error_codes"],
        error_handling=ac["error_handling"],
        knowledge_base=kb,
        backend=_read(dir_, "mock_backend.json"),
        dev_utterances=_read(dir_, "dev_utterances.json")["utterances"],
        dialogs=_read(dir_, "dialogs_sample.json")["dialogs"],
    )
    _check_links(ds)
    return ds
