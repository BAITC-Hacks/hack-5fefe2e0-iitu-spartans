"""Состояние одной сессии диалога."""
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.router.router import DialogState

# Слоты, которые переносятся между сценариями одной сессии (идентификаторы и общие данные клиента/авто)
CARRY_SLOTS = {"phone", "iin", "policy_number", "claim_number", "vehicle_plate", "vehicle_type", "region", "drivers_iin", "city", "email"}
HISTORY_TURNS = 2


class PendingConfirmation(BaseModel):
    scenario_id: str
    action: str
    inputs: dict[str, Any]
    preview: dict[str, Any]


class ScenarioRun(BaseModel):
    """Прогресс одного сценария: его собственные слоты и выполненные действия."""
    scenario_id: str
    slots: dict[str, Any] = Field(default_factory=dict)
    done_actions: list[str] = Field(default_factory=list)
    results: dict[str, Any] = Field(default_factory=dict)  # action -> последний результат
    asked_slot: str | None = None
    invalid_attempts: dict[str, int] = Field(default_factory=dict)
    started: bool = False
    completed: bool = False


class SessionState(BaseModel):
    session_id: str
    response_language: Literal["ru", "kk"] | None = None  # None до первой реплики: язык определяет роутер
    caller_phone: str | None = None  # номер из телефонии/сессии: идентификация без вопроса
    client: dict[str, Any] | None = None  # профиль после find_client
    identify_failures: int = 0
    active: ScenarioRun | None = None
    stack: list[ScenarioRun] = Field(default_factory=list)  # отложенные темы
    queue: list[str] = Field(default_factory=list)  # ещё не начатые интенты мультиинтента
    slots: dict[str, Any] = Field(default_factory=dict)  # перенос между сценариями (CARRY_SLOTS)
    last_scenario: str | None = None  # последний завершённый — для очереди handoff (D06)
    last_run: ScenarioRun | None = None  # он же целиком: уточнения после завершения не перезапускают действия
    low_confidence_streak: int = 0
    pending: PendingConfirmation | None = None
    offer_return: str | None = None  # предложили вернуться к теме со стека
    history: list[dict[str, str]] = Field(default_factory=list)
    turn: int = 0
    closed: bool = False

    def remember(self, role: str, text: str) -> None:
        self.history = (self.history + [{"role": role, "text": text}])[-2 * HISTORY_TURNS:]

    def carry(self, slots: dict[str, Any]) -> None:
        self.slots.update({k: v for k, v in slots.items() if k in CARRY_SLOTS})

    def router_view(self) -> DialogState:
        a = self.active
        pending_q = None
        if self.pending:
            pending_q = f"confirm {self.pending.action} for {self.pending.scenario_id}"
        elif a and a.asked_slot:
            pending_q = f"asked slot {a.asked_slot}"
        elif self.offer_return:
            pending_q = f"offered to return to {self.offer_return}"
        return DialogState(
            active_scenario=a.scenario_id if a and not a.completed else None,
            pending_question=pending_q,
            stack=[r.scenario_id for r in self.stack],
            slots={k: str(v) for k, v in {**self.slots, **(a.slots if a else {})}.items()},
            response_language=self.response_language,
            last_turns=self.history[-2 * HISTORY_TURNS:],
        )
