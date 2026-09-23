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
    response_model: str = ""
    dataset_dir: Path = REPO_ROOT / "case_2" / "voice_router_dataset"
    # «Сегодня» по данным кейса: все относительные даты считаются от него, не от системных часов
    today: date = date(2026, 10, 1)


settings = Settings()
