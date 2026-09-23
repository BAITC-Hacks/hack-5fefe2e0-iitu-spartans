"""Универсальный исполнитель сценария: один автомат для всех 40 сценариев, управляемый scenarios/slots/actions.json.

Шаг: принять слоты -> идентифицировать клиента (если requires_identification) -> дозаполнить слоты из профиля
и контекста -> спросить недостающий (один вопрос) -> выполнить доступные действия -> preview необратимого ->
execute после явного «да» -> handoff -> завершить. Текст ответа не генерируется: результат — Step (часть ResponsePlan).
"""
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.dataset import load
from app.dialog.state import CARRY_SLOTS, PendingConfirmation, ScenarioRun, SessionState
from app.executor.mocks import MockBackend
from app.executor.slots import normalize

ds = load()
IRREVERSIBLE = {a.name for a in ds.actions.values() if a.irreversible}
SIDE_ACTIONS = {"find_client", "send_sms", "transfer_to_operator"}  # выполняются по отдельным правилам
# Свободнотекстовые слоты: если роутер их не извлёк, берутся из реплики, которой сценарий запущен
FREE_TEXT_SLOTS = {s.name for s in ds.slots.values() if s.type == "text"} | {"service_name", "topic"}

# Продукт сценария: вход product_type для create_policy/create_claim и фильтр полисов клиента.
PRODUCT_BY_SCENARIO = {"SC01": "ogpo", "SC02": "ogpo", "SC03": "casco", "SC06": "travel", "SC07": "property", "SC08": "accident",
                       "SC09": "dms", "SC12": "ogpo", "SC13": "casco", "SC14": "property", "SC15": "travel", "SC16": "accident",
                       "SC21": "dms", "SC22": "dms", "SC24": "dms"}
POLICY_PRODUCTS = {"SC04": {"ogpo", "casco"}, "SC05": {"ogpo", "casco"}}
# Слоты с НОВЫМ значением: не берутся из профиля и не переносятся из других сценариев
FRESH_SLOTS = {("SC05", "vehicle_plate")}
# Какая ветка knowledge_base.json отвечает за kb_lookup сценария
KB_TOPIC = {"SC03": "products.casco", "SC07": "products.property", "SC08": "products.accident", "SC09": "products.dms",
            "SC11": "claims.road_accident_now", "SC24": "products.dms.e_card", "SC31": "payments", "SC32": "bonus_malus",
            "SC34": "app_help", "SC38": "fraud_policy"}
CLAIM_DOCS = {"ogpo": "ogpo_victim", "casco": "casco", "property": "property", "accident": "accident", "travel": "travel"}
CLAIM_FILTER = {  # какие убытки клиента подходят для автозаполнения claim_number
    "SC17": lambda c: c["status"] != "paid", "SC18": lambda c: c["status"] != "paid",
    "SC19": lambda c: c["status"] in ("approved", "rejected", "paid"), "SC20": lambda c: c["claim_type"] in ("casco", "ogpo_victim"),
}
THEFT = re.compile(r"угн|украл|кража|тотал|сгорел|ұрла|stol|theft|total", re.I)
FIRE = re.compile(r"пожар|сгорел|өрт|fire", re.I)
INJURED = re.compile(r"пострада|ранен|травм|жарақат|зардап|injur", re.I)
SHARED_CODE = re.compile(r"(сообщил|назвал|продиктовал|сказал|отправил|айттым|жібердім|shared).{0,20}(код|карт|cvv|pin|code|card)", re.I)
NEGATION = re.compile(r"\bне\s+(сообщил|назвал|продиктовал|сказал)|айтпадым|жоқ", re.I)


def _handoff_due(sc_id: str, run: ScenarioRun, state: SessionState) -> bool:
    """Условия handoff.when из scenarios.json в машинно-проверяемом виде (ASSUMPTIONS.md)."""
    s, r = run.slots, run.results
    desc = str(s.get("incident_description", ""))
    rules = {
        "SC10": lambda: True,  # always after collecting contacts
        "SC37": lambda: True,  # always
        "SC15": lambda: "get_policy" in r and "error" not in r["get_policy"],  # always after identifying the policy
        "SC11": lambda: s.get("injured") is True,  # anyone injured or client is confused
        "SC13": lambda: bool(THEFT.search(desc)),  # theft or total loss
        "SC14": lambda: bool(FIRE.search(desc) and INJURED.search(desc)),  # fire with injured people
        "SC30": lambda: r.get("check_payment", {}).get("payment_status") == "charged_policy_not_issued",
        "SC38": lambda: bool(SHARED_CODE.search(str(s.get("fraud_details", ""))) and not NEGATION.search(str(s.get("fraud_details", "")))),
    }
    return rules.get(sc_id, lambda: False)()


class Step(BaseModel):
    kind: Literal["ask", "confirm", "done", "cancelled", "error", "handoff"]
    scenario_id: str
    question: dict[str, str] | None = None  # {"slot", "text"}
    confirm: dict[str, Any] | None = None  # {"action", "summary"}
    facts: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] | None = None
    handoff: dict[str, str] | None = None  # {"queue", "reason"}
    template: str | None = None
    template_kind: Literal["opening", "closing"] | None = None
    notes: list[str] = Field(default_factory=list)


class Executor:
    """Исполнитель, привязанный к сессии: состояние + моки + журнал действий хода."""

    def __init__(self, state: SessionState, mb: MockBackend):
        self.st, self.mb = state, mb
        self.log: list[str] = []  # действия текущего хода: "name", "name:preview", "name:execute", "name!code"

    # --- вызов моков с журналом ---

    def _call(self, run: ScenarioRun, name: str, mode: str | None = None, **inputs) -> dict:
        res = self.mb.call(name, mode=mode or "execute", **inputs)
        tag = f"{name}:{mode}" if mode else name
        self.log.append(f"{tag}!{res['error']['code']}" if "error" in res else tag)
        run.results[name] = res
        if "error" not in res and (mode is None or mode == "execute"):
            run.done_actions.append(name)
        return res

    # --- слоты ---

    def _lang(self) -> str:
        return self.st.response_language or "ru"

    def _scenario_slots(self, sc) -> list[str]:
        return sc.slots.required + sc.slots.optional

    def accept_slots(self, run: ScenarioRun, new: dict[str, Any]) -> list[str]:
        """Принимает слоты из реплики. Возвращает ошибки валидации (по одной на слот)."""
        sc = ds.scenarios[run.scenario_id]
        wanted = set(self._scenario_slots(sc)) | CARRY_SLOTS | {i for a in sc.actions for i in ds.actions[a].inputs if i in ds.slots}
        errors = []
        for name, value in new.items():
            if name not in ds.slots or name not in wanted:
                continue
            v, err = normalize(ds.slots[name], value)
            if err:
                errors.append(err)
                run.invalid_attempts[name] = run.invalid_attempts.get(name, 0) + 1
                continue
            run.slots[name] = v
            self.st.carry({name: v})
        return errors

    def _client_policies(self, sc_id: str) -> list[dict]:
        if not self.st.client:
            return []
        cid = self.st.client["client_id"]
        products = POLICY_PRODUCTS.get(sc_id) or ({PRODUCT_BY_SCENARIO[sc_id]} if sc_id in PRODUCT_BY_SCENARIO else None)
        pt = self.st.slots.get("product_type")
        pols = [p for p in self.mb.policies.values() if p["client_id"] == cid and (products is None or p["product"] in products)]
        if pt and products is None:
            pols = [p for p in pols if p["product"] == pt] or pols
        if sc_id != "SC27":  # продление — и истёкшие недавно; остальное — только не отменённые
            pols = [p for p in pols if p.get("status") != "cancelled"]
        return pols

    def _autofill(self, run: ScenarioRun, name: str) -> Any:
        sid = run.scenario_id
        if (sid, name) in FRESH_SLOTS:
            return None
        if name in self.st.slots:
            return self.st.slots[name]
        c = self.st.client or {}
        if name == "phone":
            return c.get("phone") or self.st.caller_phone
        if name in ("iin", "email"):
            return c.get(name)
        if name == "city" and c.get("city") in (ds.slots["city"].values or []):
            return c["city"]
        if name == "region":
            plate = run.slots.get("vehicle_plate") or self.st.slots.get("vehicle_plate")
            if plate:
                return self.mb._region_by_plate(plate)
            if c.get("city"):
                return {"Almaty": "almaty", "Astana": "astana"}.get(c["city"], "other")
        if name == "product_type":
            if sid in PRODUCT_BY_SCENARIO:
                return PRODUCT_BY_SCENARIO[sid]
            claim_no = run.slots.get("claim_number") or self.st.slots.get("claim_number")
            cl = claim_no and self.mb.claims.get(claim_no)
            if cl:
                return "ogpo" if cl["claim_type"] == "ogpo_victim" else cl["claim_type"]
        if name == "policy_number":
            pols = self._client_policies(sid)
            if len(pols) == 1:
                return pols[0]["policy_number"]
        if name == "claim_number" and self.st.client and sid in CLAIM_FILTER:
            cls = [cl for cl in self.mb.claims.values() if cl["client_id"] == self.st.client["client_id"] and CLAIM_FILTER[sid](cl)]
            if len(cls) == 1:
                return cls[0]["claim_number"]
        return None

    def _value(self, run: ScenarioRun, name: str) -> Any:
        if name in run.slots:
            return run.slots[name]
        if name == "client_id":
            return (self.st.client or {}).get("client_id")
        v = self._autofill(run, name)
        if v is not None and name in ds.slots:
            run.slots[name] = v
        return v

    def _ask(self, run: ScenarioRun, slot: str, step_notes: list[str], error: str | None = None) -> Step:
        run.asked_slot = slot
        sc = ds.scenarios[run.scenario_id]
        first = not run.started
        run.started = True
        return Step(kind="ask", scenario_id=run.scenario_id,
                    question={"slot": slot, "text": ds.slots[slot].prompt[self._lang()]},
                    template=sc.responses[self._lang()].opening if first else None, template_kind="opening" if first else None,
                    error={"message": error} if error else None, facts=self._facts(run), notes=step_notes)

    # --- основной шаг ---

    def step(self, run: ScenarioRun, new_slots: dict[str, Any] | None = None, confirm: bool | None = None,
             utterance: str | None = None) -> Step:
        """utterance передаётся, только если сценарий запущен этой репликой: из неё берутся свободнотекстовые слоты."""
        sc = ds.scenarios[run.scenario_id]
        notes: list[str] = []
        errors = self.accept_slots(run, new_slots or {})
        if errors:
            notes.append("invalid slot values: " + "; ".join(errors))
        if utterance:
            for name in sc.slots.required:
                if name in FREE_TEXT_SLOTS and name not in run.slots:
                    run.slots[name] = utterance
                    notes.append(f"{name} ← текст реплики (роутер не извлёк)")

        # 1. Идентификация по телефону/ИИН
        if sc.requires_identification and not self.st.client:
            phone = run.slots.get("phone") or self.st.slots.get("phone") or self.st.caller_phone
            iin = run.slots.get("iin") or self.st.slots.get("iin")
            if not phone and not iin:
                return self._ask(run, "phone", notes)
            res = self._call(run, "find_client", phone=phone, iin=None if phone else iin)
            if "error" in res:
                self.st.identify_failures += 1
                self.st.slots.pop("phone", None)
                run.slots.pop("phone", None)
                if phone == self.st.caller_phone:
                    self.st.caller_phone = None
                if self.st.identify_failures >= 2:  # error_handling: переспросить один раз, затем оператор
                    return self._handoff(run, "operator_general", f"client not identified: {res['error']['message']}", notes)
                return self._ask(run, "phone", notes, error=res["error"]["message"])
            self.st.client = dict(self.mb.clients[res["client_id"]])
            self.st.identify_failures = 0
            notes.append(f"identified {res['client_id']} {res['full_name']}")

        # 2. Обязательные слоты: из реплики, профиля, контекста; иначе спросить (один вопрос)
        for name in sc.slots.required:
            if self._value(run, name) is None:
                if run.invalid_attempts.get(name, 0) >= 2:
                    return self._handoff(run, "operator_general", f"could not get a valid {name}", notes)
                return self._ask(run, name, notes, error=errors[0] if errors else None)
        for name in sc.slots.optional:
            self._value(run, name)
        run.asked_slot = None

        # 3. Обратимые действия — по мере доступности входов, в порядке списка
        for name in sc.actions:
            if name in SIDE_ACTIONS or name in IRREVERSIBLE or name in run.done_actions:
                continue
            res = self._run_plain(run, name)
            if res is not None and "error" in res:
                return self._on_error(run, name, res, notes)

        # 4. Необратимое действие: preview -> явное «да» -> execute
        for name in [a for a in sc.actions if a in IRREVERSIBLE and a not in run.done_actions]:
            inputs, missing = self._inputs(run, name)
            if missing:
                return self._ask(run, missing, notes)
            pend = self.st.pending
            if pend and pend.action == name and pend.scenario_id == run.scenario_id and confirm is True:
                res = self._call(run, name, mode="execute", **pend.inputs)
                self.st.pending = None
                if "error" in res:
                    return self._on_error(run, name, res, notes)
                notes.append(f"{name} executed after explicit yes")
                continue
            if pend and pend.action == name and confirm is False:
                self.st.pending = None
                self._complete(run)
                return Step(kind="cancelled", scenario_id=run.scenario_id, facts={"cancelled": name}, notes=notes + [f"{name} cancelled by client"])
            res = self._call(run, name, mode="preview", **inputs)
            if "error" in res:
                return self._on_error(run, name, res, notes)
            self.st.pending = PendingConfirmation(scenario_id=run.scenario_id, action=name, inputs=inputs, preview=res)
            run.started = True
            return Step(kind="confirm", scenario_id=run.scenario_id, confirm={"action": name, "summary": res},
                        facts=self._facts(run), notes=notes)

        # 5. Handoff по условию сценария
        if sc.handoff and _handoff_due(run.scenario_id, run, self.st):
            return self._handoff(run, sc.handoff.queue, sc.handoff.when, notes)

        # 6. Завершение: SMS (если сценарий его предусматривает и есть телефон)
        if "send_sms" in sc.actions and "send_sms" not in run.done_actions:
            phone = self._value(run, "phone")
            if phone:
                self._call(run, "send_sms", phone=phone, text=f"{run.scenario_id} summary")
        self._complete(run)
        return Step(kind="done", scenario_id=run.scenario_id, facts=self._facts(run),
                    template=sc.responses[self._lang()].closing, template_kind="closing", notes=notes)

    def _complete(self, run: ScenarioRun) -> None:
        run.completed = True
        run.asked_slot = None
        self.st.last_scenario, self.st.last_run = run.scenario_id, run

    def followup(self, run: ScenarioRun, new_slots: dict[str, Any]) -> Step:
        """Реплика по уже завершённому сценарию: принять слоты, перепроверить handoff, действия не повторять."""
        self.accept_slots(run, new_slots)
        sc = ds.scenarios[run.scenario_id]
        if sc.handoff and _handoff_due(run.scenario_id, run, self.st):
            return self._handoff(run, sc.handoff.queue, sc.handoff.when, [])
        return Step(kind="done", scenario_id=run.scenario_id, facts=self._facts(run),
                    notes=["follow-up on a completed scenario: no actions repeated"])

    # --- действия ---

    def _inputs(self, run: ScenarioRun, action: str) -> tuple[dict[str, Any], str | None]:
        """Входы действия из слотов/профиля/результатов. -> (inputs, первый недостающий слот)."""
        inputs: dict[str, Any] = {}
        for spec in ds.actions[action].inputs:
            options = spec.split("|")
            for opt in options:
                v = self._resolve(run, action, opt)
                if v is not None:
                    inputs[opt] = v
                    break
            else:
                slot = next((o for o in options if o in ds.slots), None)
                if slot:
                    return inputs, slot
        # дополнительные данные, которые моки используют сверх входов actions.json
        for extra in ("new_driver_iin", "vehicle_plate", "culprit_vehicle_plate", "policy_number", "doctor_specialty"):
            if extra in run.slots and extra not in inputs:
                inputs[extra] = run.slots[extra]
        if action == "create_policy":
            inputs["client_id"] = (self.st.client or {}).get("client_id")
            inputs["price"] = next((r.get("price") for k, r in run.results.items() if k.startswith("calc_") and "price" in r), None)
            inputs["details"] = {k: v for k, v in run.slots.items() if k not in ("phone",)}
        if action == "create_claim":
            inputs["client_id"] = (self.st.client or {}).get("client_id")
        return inputs, None

    def _resolve(self, run: ScenarioRun, action: str, name: str) -> Any:
        if name == "policy_number" and run.scenario_id in ("SC26",) and "get_policies" in run.results:
            pols = [p for p in run.results["get_policies"].get("policies", []) if p["status"] == "active"]
            if not run.slots.get("policy_number") and pols:
                return pols[-1]["policy_number"]
        if name == "vehicle_plate" and run.scenario_id == "SC12":
            return run.slots.get("culprit_vehicle_plate")
        if name == "topic" and action == "kb_lookup":
            return self._kb_topic(run)
        if name == "iin" and action == "get_bm_class":
            return None  # вызывается поштучно в _run_plain
        return self._value(run, name)

    def _kb_topic(self, run: ScenarioRun) -> str | None:
        sid = run.scenario_id
        if sid == "SC18":
            pt = self._value(run, "product_type")
            return f"claims.documents.{CLAIM_DOCS[pt]}" if pt in CLAIM_DOCS else "claims.submission"
        if sid == "SC40":
            topic = str(run.slots.get("topic", "")).lower()
            product = run.slots.get("product_type") or "casco"
            if re.search(r"франшиз|deductible", topic):
                return "products.casco.pricing.franchise_coef"
            if re.search(r"лимит|limit|сумм", topic):
                return "products.travel.zones"
            return f"products.{product}.exclusions" if product in ("casco", "property", "accident") else "products.casco.exclusions"
        return KB_TOPIC.get(sid)

    def _run_plain(self, run: ScenarioRun, name: str) -> dict | None:
        if name == "get_bm_class":
            iins = run.slots.get("drivers_iin") or ([run.slots["new_driver_iin"]] if run.slots.get("new_driver_iin") else [])
            iins = iins or ([self._value(run, "iin")] if self._value(run, "iin") else [])
            if not iins:
                return None
            classes = {}
            for i in iins:
                r = self.mb.call("get_bm_class", iin=i)
                if "error" in r:
                    self.log.append(f"get_bm_class!{r['error']['code']}")
                    run.results[name] = r
                    return r
                classes[i] = r["bm_class"]
            self.log.append("get_bm_class")
            run.results[name] = {"bm_class": classes}
            run.done_actions.append(name)
            return run.results[name]
        inputs, missing = self._inputs(run, name)
        if missing:
            return None  # вход недоступен — действие необязательно в этом прогоне
        res = self._call(run, name, **inputs)
        if name == "get_policy" and "error" not in res and self.st.client and run.scenario_id != "SC12" \
                and res.get("client_id") != self.st.client["client_id"]:
            res = run.results[name] = {"error": {"code": "not_found", "message": f"Policy {res['policy_number']} does not belong to the client"}}
        return res

    def _on_error(self, run: ScenarioRun, action: str, res: dict, notes: list[str]) -> Step:
        code = res["error"]["code"]
        handling = next((h for h in ds.error_handling if code in h.split(":")[0]), "")
        sc = ds.scenarios[run.scenario_id]
        if code in ("not_found", "invalid_input"):
            slot = next((o for spec in ds.actions[action].inputs for o in spec.split("|") if o in run.slots and o in self._scenario_slots(sc)), None)
            if action == "get_policy" and run.scenario_id == "SC12":
                slot = "culprit_vehicle_plate"
            if slot:
                run.slots.pop(slot, None)
                self.st.slots.pop(slot, None)
                run.done_actions = [a for a in run.done_actions if a != action]
                run.invalid_attempts[slot] = run.invalid_attempts.get(slot, 0) + 1
                if run.invalid_attempts[slot] >= 2:
                    return self._handoff(run, "operator_general", f"{action}: {res['error']['message']}", notes)
                step = self._ask(run, slot, notes, error=res["error"]["message"])
                step.kind = "error"
                step.error = {**res["error"], "handling": handling}
                return step
        if code == "no_availability":
            run.slots.pop("preferred_date", None)
            step = self._ask(run, "preferred_date", notes)
            step.kind = "error"
            step.error = {**res["error"], "alternatives": res.get("alternatives", []), "handling": handling}
            return step
        if code == "service_unavailable":
            return self._handoff(run, "operator_general", res["error"]["message"], notes)
        # policy_inactive / not_eligible / not_covered / already_done: объяснить и закончить сценарий
        self._complete(run)
        return Step(kind="error", scenario_id=run.scenario_id, error={**res["error"], "handling": handling}, facts=self._facts(run), notes=notes)

    def _facts(self, run: ScenarioRun) -> dict[str, Any]:
        facts: dict[str, Any] = {"slots": dict(run.slots)}
        for name, res in run.results.items():
            if "error" not in res:
                facts[name] = res
        if self.st.client:
            c = self.st.client
            facts["client"] = {"client_id": c["client_id"], "full_name": c["full_name"], "preferred_language": c["preferred_language"]}
        return facts

    def _handoff(self, run: ScenarioRun, queue: str, reason: str, notes: list[str]) -> Step:
        summary = self.operator_summary(run, reason)
        self._call(run, "transfer_to_operator", queue=queue, summary=summary)
        self._complete(run)
        self.st.closed = True
        return Step(kind="handoff", scenario_id=run.scenario_id, handoff={"queue": queue, "reason": reason, "summary": summary},
                    facts=self._facts(run), notes=notes)

    def operator_summary(self, run: ScenarioRun | None, reason: str) -> str:
        c = self.st.client
        parts = [f"client: {c['full_name']} ({c['client_id']}, {c['phone']})" if c else "client: not identified"]
        if run:
            parts.append(f"scenario: {run.scenario_id} {ds.scenarios[run.scenario_id].name}")
            if run.slots:
                parts.append("data: " + ", ".join(f"{k}={v}" for k, v in run.slots.items()))
            done = {k: v for k, v in run.results.items() if "error" not in v and k != "transfer_to_operator"}
            for k, v in done.items():
                if any(x in v for x in ("ticket_id", "claim_number", "policy_number", "status")):
                    parts.append(f"{k}: " + ", ".join(f"{x}={v[x]}" for x in ("ticket_id", "claim_number", "policy_number", "status") if x in v))
        if self.st.stack:
            parts.append("postponed: " + ", ".join(r.scenario_id for r in self.st.stack))
        parts.append(f"reason: {reason}")
        last = [h["text"] for h in self.st.history if h["role"] == "client"][-2:]
        if last:
            parts.append("client said: " + " / ".join(last))
        return "; ".join(parts)
