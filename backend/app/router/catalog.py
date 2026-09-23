"""Статичный текст каталога сценариев для промпта роутера. Строится только из данных датасета."""
from functools import lru_cache

from app.dataset import Dataset, load

EXAMPLES_PER_LANG = 2


def _scenario_block(s) -> str:
    lines = [f"{s.scenario_id} | {s.name} | domain={s.domain} | priority={s.priority}", f"  what: {s.description}"]
    for rule in s.not_this_if:
        lines.append(f"  NOT if: {rule.condition} -> {rule.use_instead}")
    for lang in ("ru", "kk"):
        examples = "; ".join(f'"{e}"' for e in s.examples[lang][:EXAMPLES_PER_LANG])
        lines.append(f"  e.g. {lang}: {examples}")
    return "\n".join(lines)


def build_catalog(ds: Dataset) -> str:
    parts = ["## Business scenarios"]
    parts += [_scenario_block(s) for s in ds.scenarios.values()]
    parts.append("## System intents")
    parts += [f"{i.id}\n  what: {i.description}\n  bot does: {i.behavior}" for i in ds.system_intents.values()]
    return "\n\n".join(parts)


def build_slot_catalog(ds: Dataset) -> str:
    lines = []
    for s in ds.slots.values():
        fmt = f" values={s.values}" if s.values else (f" pattern={s.pattern}" if s.pattern else "")
        lines.append(f"- {s.name} ({s.type}{fmt}): {s.description}")
    return "\n".join(lines)


@lru_cache
def catalog_text() -> str:
    return build_catalog(load())


@lru_cache
def slot_catalog_text() -> str:
    return build_slot_catalog(load())


def estimate_tokens(text: str) -> int:
    """Точно через tiktoken (o200k_base), если установлен; иначе грубо по символам."""
    try:
        import tiktoken

        return len(tiktoken.get_encoding("o200k_base").encode(text))
    except ImportError:
        cyr = sum(1 for ch in text if "Ѐ" <= ch <= "ӿ")
        return round(cyr / 2.7 + (len(text) - cyr) / 4)


if __name__ == "__main__":
    for name, text in (("scenario catalog", catalog_text()), ("slot catalog", slot_catalog_text())):
        print(f"{name}: {len(text)} chars, ~{estimate_tokens(text)} tokens")
