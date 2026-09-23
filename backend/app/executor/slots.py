"""Нормализация и валидация значений слотов по slots.json (type, pattern, values)."""
import re
from datetime import date
from typing import Any

from app.dataset import Slot

CYR_TO_LAT = str.maketrans("АВЕКМНОРСТХУ", "ABEKMHOPCTXY")
CITY_ALIASES = {
    "алматы": "Almaty", "алма-ата": "Almaty", "астана": "Astana", "шымкент": "Shymkent", "караганда": "Karaganda",
    "қарағанды": "Karaganda", "актобе": "Aktobe", "ақтөбе": "Aktobe", "атырау": "Atyrau", "павлодар": "Pavlodar",
    "усть-каменогорск": "Oskemen", "өскемен": "Oskemen", "oskemen": "Oskemen", "ust-kamenogorsk": "Oskemen",
}
YES = {"true", "yes", "да", "иә", "ия", "есть", "бар"}
NO = {"false", "no", "нет", "жоқ", "никто", "ешкім"}


def _digits(v: Any) -> str:
    return re.sub(r"\D", "", str(v))


def normalize(slot: Slot, value: Any) -> tuple[Any, str | None]:
    """-> (нормализованное значение, None) или (None, текст ошибки)."""
    if value is None or str(value).strip() == "":
        return None, "empty"
    raw = str(value).strip()
    name, t = slot.name, slot.type

    if name == "phone":
        d = _digits(raw)
        if len(d) == 11 and d[0] in "78":
            d = d[1:]
        v: Any = f"+7{d}" if len(d) == 10 else raw
    elif name in ("iin", "new_driver_iin"):
        v = _digits(raw)
    elif name in ("vehicle_plate", "culprit_vehicle_plate"):
        v = re.sub(r"[\s-]", "", raw.upper()).translate(CYR_TO_LAT)
    elif t == "list":
        items = re.findall(r"\d{12}", _digits_keep_sep(raw)) if name.endswith("iin") else [x.strip() for x in raw.split(",") if x.strip()]
        if slot.pattern and any(not re.match(slot.pattern, x) for x in items) or not items:
            return None, f"{name}: expected a list matching {slot.pattern}"
        return items, None
    elif t == "integer":
        d = _digits(raw)
        if not d:
            return None, f"{name}: expected an integer"
        v = int(d)
    elif t == "date":
        try:
            v = date.fromisoformat(raw[:10]).isoformat()
        except ValueError:
            return None, f"{name}: expected YYYY-MM-DD"
    elif t == "boolean":
        low = raw.lower()
        if low in YES:
            v = True
        elif low in NO:
            v = False
        else:
            return None, f"{name}: expected yes/no"
    elif name == "city":
        v = CITY_ALIASES.get(raw.lower(), raw)
    else:
        v = raw

    if slot.values is not None:
        match = next((x for x in slot.values if str(x).lower() == str(v).lower()), None)
        if match is None:
            return None, f"{name}: must be one of {slot.values}"
        v = match
    if slot.pattern and isinstance(v, str) and not re.match(slot.pattern, v):
        return None, f"{name}: does not match {slot.pattern}"
    return v, None


def _digits_keep_sep(raw: str) -> str:
    """Оставляет только цифры, разделяя группы пробелом: '910512300456, 930824400789' -> группы по 12."""
    return " ".join(re.findall(r"\d+", raw))
