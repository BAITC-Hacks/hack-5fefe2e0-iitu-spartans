"""Один ход диалога: route -> policy -> fsm -> ResponsePlan + trace. Текст ответа здесь не генерируется."""
import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.dataset import load
from app.dialog.policy import decide
from app.dialog.state import ScenarioRun, SessionState
from app.executor.fsm import Executor, Step
from app.executor.mocks import MockBackend
from app.executor.slots import normalize
from app.router.router import route

ds = load()
MAX_STEPS_PER_TURN = 3


class ResponsePlan(BaseModel):
    """Что должен сказать бот: структура для генератора ответа (следующий этап)."""
    kind: Literal["scenario", "clarify", "goodbye", "out_of_scope", "handoff", "ack"]
    language: Literal["ru", "kk"]
    steps: list[Step] = Field(default_factory=list)
    queued: list[dict[str, str]] = Field(default_factory=list)  # «остальные вопросы тоже решим»
    offer_return: dict[str, str] | None = None  # предложить вернуться к отложенной теме
    options: list[dict[str, str]] = Field(default_factory=list)  # варианты для уточнения
    template: str | None = None  # шаблон системного интента (responses из scenarios.json)


class Session:
    def __init__(self, client_phone: str | None = None):
        self.state = SessionState(session_id=uuid.uuid4().hex[:12])
        if client_phone:
            phone, err = normalize(ds.slots["phone"], client_phone)
            self.state.caller_phone = None if err else phone
        self.mb = MockBackend()


def _named(sid: str) -> dict[str, str]:
    return {"scenario_id": sid, "name": ds.scenarios[sid].name}


def _bot_summary(plan: ResponsePlan) -> str:
    """Короткая запись реплики бота для истории роутера (не текст ответа клиенту)."""
    parts = []
    for s in plan.steps:
        if s.kind in ("ask", "error") and s.question:
            parts.append(s.question["text"])
        elif s.kind == "confirm":
            parts.append(f"[{s.scenario_id}] confirm {s.confirm['action']}? {s.confirm['summary']}")
        elif s.kind == "done":
            parts.append(f"[{s.scenario_id}] done" + (f": {s.template}" if s.template else ""))
        elif s.kind == "handoff":
            parts.append(f"transfer to {s.handoff['queue']}")
    if plan.offer_return:
        parts.append(f"offer to return to {plan.offer_return['scenario_id']} {plan.offer_return['name']}")
    if plan.template:
        parts.append(plan.template)
    return " ".join(parts)[:400] or plan.kind


async def turn(session: Session, text: str) -> tuple[ResponsePlan, dict[str, Any]]:
    st, t0 = session.state, time.perf_counter()
    st.turn += 1
    router_state = st.router_view()
    st.remember("client", text)

    r = await route(text, router_state)
    t_router = time.perf_counter()
    st.response_language = r.response_language
    lang = r.response_language

    d = decide(r, st, text)
    t_policy = time.perf_counter()

    ex = Executor(st, session.mb)
    plan = ResponsePlan(kind="scenario", language=lang)
    steps: list[Step] = []
    notes: list[str] = []
    offered, st.offer_return = st.offer_return, None
    if d.kind not in ("clarify", "handoff"):
        st.low_confidence_streak = 0

    if d.drop_return:
        st.stack = [x for x in st.stack if x.scenario_id != offered]
        plan.kind = "ack"
    elif d.kind == "handoff":
        run = st.active if st.active and not st.active.completed else None
        if d.continue_active_first and run:
            steps.append(ex.step(run, r.slots))
        if not st.closed:
            steps.append(ex._handoff(run or ScenarioRun(scenario_id="SC37"), d.handoff_queue, d.handoff_reason, []))
        plan.kind = "handoff"
    elif d.kind in ("goodbye", "out_of_scope"):
        sys_id = "SYS_GOODBYE" if d.kind == "goodbye" else "SYS_OUT_OF_SCOPE"
        plan.kind, plan.template = d.kind, ds.system_intents[sys_id].response[lang]
        if d.kind == "goodbye":
            st.closed = True
    elif d.kind == "clarify":
        plan.kind = "clarify"
        plan.options = [_named(o) for o in d.options]
        plan.template = ds.system_intents["SYS_UNCLEAR"].response[lang]
    elif d.kind == "continue":
        if d.resume_from_stack:
            idx = max(i for i, x in enumerate(st.stack) if x.scenario_id == d.scenario_id)
            st.active = st.stack.pop(idx)
            st.pending = None
            notes.append(f"resumed {d.scenario_id} from stack")
        steps.append(ex.step(st.active, r.slots, confirm=d.confirm))
    elif d.kind == "start":
        if d.push_active and st.active:
            st.pending = None
            st.active.asked_slot = None
            st.stack.append(st.active)
        st.active = ScenarioRun(scenario_id=d.scenario_id)
        steps.append(ex.step(st.active, r.slots, utterance=text))
    elif d.kind == "followup":
        steps.append(ex.followup(st.last_run, r.slots))

    current = st.active.scenario_id if st.active else None
    st.queue += [x for x in d.enqueue if x not in st.queue and x != current]

    # Завершённый сценарий -> следующий из очереди в этом же ходе, иначе предложить вернуться к теме со стека
    while st.active and st.active.completed and not st.closed and len(steps) < MAX_STEPS_PER_TURN:
        st.active = None
        if st.queue:
            nxt = st.queue.pop(0)
            st.active = ScenarioRun(scenario_id=nxt)
            notes.append(f"started queued {nxt}")
            # тема из этой же реплики (мультиинтент) — её текст годится для свободнотекстовых слотов
            steps.append(ex.step(st.active, r.slots, utterance=text if nxt in d.enqueue else None))
        elif st.stack:
            st.offer_return = st.stack[-1].scenario_id
            plan.offer_return = _named(st.offer_return)
    if st.active and st.active.completed:
        st.active = None
    t_exec = time.perf_counter()

    plan.steps = steps
    plan.queued = [_named(q) for q in st.queue]
    st.remember("bot", _bot_summary(plan))

    ms = lambda a, b: round((b - a) * 1000)  # noqa: E731
    trace = {
        "turn": st.turn,
        "transcript": text,
        "language": r.language,
        "response_language": r.response_language,
        "scenarios": [{"scenario_id": p.scenario_id, "confidence": p.confidence} for p in r.scenarios],
        "alternatives": [{"scenario_id": p.scenario_id, "confidence": p.confidence} for p in r.alternatives],
        "reason": "; ".join([r.situation] + [p.reason for p in r.scenarios if p.reason]),
        "is_continuation": r.is_continuation,
        "slots": r.slots,
        "actions": ex.log,
        "policy": d.trace + notes + [n for s in steps for n in s.notes],
        "decision": d.kind,
        "state": {
            "client_id": (st.client or {}).get("client_id"),
            "active": st.active.scenario_id if st.active else None,
            "pending": st.pending.action if st.pending else None,
            "stack": [x.scenario_id for x in st.stack],
            "queue": list(st.queue),
        },
        "latency_ms": {
            "stt": 0, "triage": 0, "router": r.latency_ms, "policy": ms(t_router, t_policy), "executor": ms(t_policy, t_exec),
            "response": 0, "tts_first_audio": 0, "total": ms(t0, t_exec),
        },
    }
    return plan, trace
