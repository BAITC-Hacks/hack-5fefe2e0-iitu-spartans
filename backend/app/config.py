from datetime import date
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    openai_api_key: str = ""
    router_model: str = ""  # пусто -> DEFAULT_ROUTER_MODEL в app/router/router.py
    router_reasoning_effort: str = ""  # только для reasoning-моделей (gpt-5*, o*); пусто -> "none"
    router_max_output_tokens: int = 400
    router_service_tier: str = ""  # пусто -> по умолчанию; "priority" быстрее, но дороже
    # Предел ожидания ответа модели: p90 роутера ~2,3 с (docs/ROUTER_LOG.md), web ждёт сервис до 8 с
    router_timeout_s: float = 6.0
    # Политика: >= HIGH — запуск, MID..HIGH — уточнение, < MID дважды — оператор.
    # Калибровка по runs/ (docs/ROUTER_LOG.md): верный основной сценарий приходит с confidence >= 0.69.
    policy_high_confidence: float = 0.65
    policy_mid_confidence: float = 0.40
    response_model: str = ""
    # Стартовый набор организаторов; в контейнере монтируется только для чтения (DATASET_DIR=/data/kit)
    dataset_dir: Path = REPO_ROOT / "data" / "kit"
    # «Сегодня» по данным кейса: все относительные даты считаются от него, не от системных часов
    today: date = date(2026, 10, 1)


settings = Settings()
