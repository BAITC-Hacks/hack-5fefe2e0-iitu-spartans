"""Промпт роутера: правила вывода и статичный префикс для кэша."""
import re

from app.router.prompt import dynamic_input, static_prompt


def reason_rule() -> str:
    return next(line for line in static_prompt().splitlines() if line.startswith("- `reason`"))


def test_reason_in_russian_with_client_quote():
    # Панель супервизора русскоязычная; исходная формулировка — из ядра (packages/core/src/router/prompt.ts, #31).
    rule = reason_rule()
    assert "in Russian" in rule
    assert re.search(r"quote the client's words", rule)


def test_reason_in_russian_even_for_kazakh_speech():
    # Со строкой из ядра модель писала обоснование по-казахски у ~40 % казахских реплик; с явным «цитата на языке
    # клиента, остальное по-русски» — у ~5 % всех обоснований (docs/ROUTER_LOG.md, v6).
    rule = reason_rule()
    assert "whatever language the client speaks" in rule
    assert "the quote stays in the client's language" in rule


def test_reason_names_neighbour_scenario_from_not_if_rule():
    assert "NOT if" in reason_rule()


def test_static_prompt_is_deterministic_and_has_no_utterance():
    # Статичная часть — префикс для кэша модели: не зависит от реплики и состояния.
    marker = "реплика-маркер-не-из-набора"
    assert static_prompt() == static_prompt()
    assert marker not in static_prompt()
    assert marker in dynamic_input(marker, {"active_scenario": "SC17"})
