"""Детерминированная политика решений после роутера (код, не LLM). Каждое правило пишет запись «правило → решение»."""
import re
from typing import Literal

from pydantic import BaseModel, Field

from app.config import settings
from app.dataset import SYSTEM_INTENTS, load
from app.dialog.state import SessionState
from app.router.router import RouterResult, ScenarioPick

ds = load()

# Явное согласие/отказ — только по началу реплики (первая клауза), чтобы «да + новая тема» тоже распознавалось.
YES_WORDS = r"да|ага|угу|давайте|давай|конечно|верно|всё верно|все верно|подтверждаю|оформляйте|оформляем|оформим|записывайте|запишите|согласен|согласна|хорошо|ок|окей|иә|ия|иа|әрине|растаймын|дұрыс|жазыңыз|рәсімдеңіз|тіркеңіз|келісемін|жарайды"
NO_WORDS = r"нет|не надо|не нужно|не хочу|отмена|отменить|потом|позже|не сейчас|жоқ|қажет емес|керек емес|кейін|болмайды"
YES_RE = re.compile(rf"^\s*(?:{YES_WORDS})\b", re.I)
NO_RE = re.compile(rf"(?:^|\s)(?:{NO_WORDS})\b", re.I)


def _first_clause(text: str) -> str:
    return re.split(r"[.,!?;]", text, maxsplit=1)[0]


def is_yes(text: str) -> bool:
    """Явное «да»: реплика начинается со слова согласия и в первой клаузе нет отказа («Давайте потом» — не да)."""
    return bool(YES_RE.match(text)) and not NO_RE.search(_first_clause(text))


def is_no(text: str) -> bool:
    return bool(NO_RE.search(_first_clause(text)))


class Decision(BaseModel):
    kind: Literal["continue", "start", "followup", "clarify", "handoff", "goodbye", "out_of_scope", "none"]
    scenario_id: str | None = None  # что запустить сейчас (start) или продолжить (continue)
    confirm: bool | None = None  # ответ на ожидающий preview
    resume_from_stack: bool = False  # клиент согласился вернуться к отложенной теме
    drop_return: bool = False  # клиент отказался возвращаться — снять тему со стека
    enqueue: list[str] = Field(default_factory=list)
    push_active: bool = False  # текущий сценарий -> в стек
    handoff_queue: str | None = None
    handoff_reason: str | None = None
    continue_active_first: bool = False  # перед handoff дать активному сценарию принять слоты (D06)
    options: list[str] = Field(default_factory=list)  # 2 варианта для уточнения
    trace: list[str] = Field(default_factory=list)


def _priority_order(picks: list[ScenarioPick]) -> list[str]:
    """urgent первыми, остальные — в порядке упоминания (сортировка стабильна)."""
    ids = [p.scenario_id for p in picks]
    return sorted(ids, key=lambda i: 0 if ds.scenarios[i].priority == "urgent" else 1)


def handoff_queue_for(state: SessionState) -> str:
    """Очередь по активному (или только что завершённому) сценарию: оператор уже в контексте темы (D06)."""
    sid = (state.active.scenario_id if state.active else None) or state.last_scenario
    if sid and ds.scenarios[sid].handoff:
        return ds.scenarios[sid].handoff.queue
    return "operator_general"


def decide(r: RouterResult, st: SessionState, text: str) -> Decision:
    high, mid = settings.policy_high_confidence, settings.policy_mid_confidence
    d = Decision(kind="none")
    t = d.trace.append
    active = st.active if st.active and not st.active.completed else None
    business = [p for p in r.scenarios if p.scenario_id not in SYSTEM_INTENTS]
    top = r.scenarios[0]
    new_topics = [p for p in business if not active or p.scenario_id != active.scenario_id]
    accepted_new = [p for p in new_topics if p.confidence >= high]

    # 1. Явная просьба оператора (SC37) — в любой момент
    if any(p.scenario_id == "SC37" for p in business):
        d.kind = "handoff"
        d.handoff_queue = handoff_queue_for(st)
        d.handoff_reason = "client asked for a human"
        d.continue_active_first = bool(active and r.is_continuation)
        t(f"клиент просит оператора (SC37) → перевод в очередь {d.handoff_queue} по активному/последнему сценарию"
          + (", сначала активный сценарий принимает слоты из реплики" if d.continue_active_first else ""))
        return d

    # 2. Системные интенты — важнее is_continuation и ожидающего подтверждения («Рақмет!» при открытом вопросе — прощание;
    #    необратимое действие при этом не выполняется)
    if top.scenario_id == "SYS_GOODBYE" and not business:
        d.kind = "goodbye"
        t("SYS_GOODBYE → попрощаться" + (f" (открытый сценарий {active.scenario_id} не завершён)" if active else "") + (f"; незавершённые темы: {[x.scenario_id for x in st.stack] + st.queue}" if st.stack or st.queue else ""))
        return d
    if top.scenario_id == "SYS_OUT_OF_SCOPE" and not business:
        d.kind = "out_of_scope"
        st.low_confidence_streak = 0
        t("SYS_OUT_OF_SCOPE → вежливо отказать и сказать, с чем бот помогает")
        return d

    # 3. Ожидается подтверждение необратимого действия
    if st.pending and active:
        others = [p.scenario_id for p in accepted_new if p.scenario_id != "SC37"]
        if is_yes(text):
            d.kind, d.scenario_id, d.confirm = "continue", active.scenario_id, True
            d.enqueue = others
            t(f"ожидается подтверждение {st.pending.action} + явное «да» → выполнить (execute)")
            if others:
                t(f"«да» + новая тема {others} → в очередь после подтверждения")
            return d
        if is_no(text):
            d.kind, d.scenario_id, d.confirm = "continue", active.scenario_id, False
            d.enqueue = others
            t(f"ожидается подтверждение {st.pending.action} + отказ/«потом» → действие не выполняется, сценарий закрыт")
            if others:
                t(f"новые темы {others} → сразу после отмены")
            return d
        if r.is_continuation or not accepted_new:
            d.kind, d.scenario_id = "continue", active.scenario_id
            t(f"ожидается подтверждение {st.pending.action}, явного «да» нет → не выполнять; принять уточнения и показать preview заново")
            return d
        t(f"ожидалось подтверждение {st.pending.action}, но клиент сменил тему → действие не выполнено, тема отложена")
        # дальше — обработка как смены темы

    # 4. Предложили вернуться к отложенной теме
    if st.offer_return and not accepted_new:
        if is_yes(text):
            d.kind, d.resume_from_stack = "continue", True
            d.scenario_id = st.offer_return
            t(f"клиент согласился вернуться к {st.offer_return} → снять со стека и продолжить")
            return d
        if is_no(text):
            d.kind, d.drop_return = "none", True
            t(f"клиент отказался возвращаться к {st.offer_return} → снять тему со стека")
            return d

    # 5. Продолжение активного сценария (ответ на вопрос)
    if active and (r.is_continuation or (business and business[0].scenario_id == active.scenario_id)) \
            and not (accepted_new and not r.is_continuation):
        d.kind, d.scenario_id = "continue", active.scenario_id
        d.enqueue = [p.scenario_id for p in accepted_new]
        t(f"is_continuation={r.is_continuation}, активный {active.scenario_id} → только слоты, без переключения сценария")
        if d.enqueue:
            t(f"ответ + новая тема {d.enqueue} → в очередь")
        return d

    # 6. Уточнение по только что завершённому сценарию: действия не повторять
    if not active and st.last_run and r.is_continuation and business and business[0].scenario_id == st.last_run.scenario_id \
            and not [p for p in accepted_new if p.scenario_id != st.last_run.scenario_id]:
        d.kind, d.scenario_id = "followup", st.last_run.scenario_id
        t(f"продолжение уже завершённого {d.scenario_id} → принять слоты, перепроверить handoff, действия не повторять")
        return d

    # 7. Новые темы: пороги уверенности
    if accepted_new:
        order = _priority_order(accepted_new)
        d.kind, d.scenario_id, d.enqueue = "start", order[0], order[1:]
        st.low_confidence_streak = 0
        if [p.scenario_id for p in accepted_new] != order:
            t(f"мультиинтент {[p.scenario_id for p in accepted_new]} → urgent первым: {order}")
        t(f"confidence {max(p.confidence for p in accepted_new if p.scenario_id == order[0]):.2f} ≥ {high} → запуск {order[0]}")
        if d.enqueue:
            t(f"остальные интенты {d.enqueue} → в очередь, подтвердить клиенту, что их тоже обработаем")
        dropped = [p.scenario_id for p in new_topics if p.confidence < high]
        if dropped:
            t(f"{dropped}: confidence < {high} → не запускаются")
        if active:
            d.push_active = True
            t(f"смена темы: {active.scenario_id} → в стек, после {order[0]} предложить вернуться")
        return d

    # 8. Недостаточная уверенность: уточнение или оператор
    candidates = sorted(business + [a for a in r.alternatives if a.scenario_id not in SYSTEM_INTENTS],
                        key=lambda p: -p.confidence)
    best = candidates[0].confidence if candidates else 0.0
    options = list(dict.fromkeys(p.scenario_id for p in candidates))[:2]
    if top.scenario_id == "SYS_UNCLEAR" or best < mid:
        st.low_confidence_streak += 1
        reason = "SYS_UNCLEAR" if top.scenario_id == "SYS_UNCLEAR" else f"confidence {best:.2f} < {mid}"
        if st.low_confidence_streak >= 2:
            d.kind, d.handoff_queue, d.handoff_reason = "handoff", handoff_queue_for(st), "intent unclear twice in a row"
            t(f"{reason} второй раз подряд → перевод на оператора ({d.handoff_queue}) с контекстом")
            return d
        d.kind, d.options = "clarify", options
        t(f"{reason} (1-й раз) → один уточняющий вопрос" + (f" с вариантами {options}" if options else " без вариантов"))
        return d
    d.kind, d.options = "clarify", options
    t(f"confidence {best:.2f} в [{mid}, {high}) → SYS_UNCLEAR: уточнить между {options}")
    return d
