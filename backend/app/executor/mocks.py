"""Мок-бэкенд: все действия actions.json поверх mock_backend.json и knowledge_base.json.

Состояние живёт в памяти одного экземпляра (один экземпляр на сессию). «Сегодня» = settings.today.
Результат действия — dict; ошибка — {"error": {"code", "message"}} (формат actions.json).
Необратимые действия принимают mode="preview" (ничего не меняет) или mode="execute".
Допущения, которых нет в данных кейса, описаны в docs/ASSUMPTIONS.md.
"""
import copy
import re
from datetime import date, datetime, timedelta

from app.config import settings
from app.dataset import Dataset, load

PRODUCT_PREFIX = {"ogpo": "OGPO", "casco": "CASCO", "travel": "TRVL", "property": "PROP", "accident": "NS", "dms": "DMS"}
PHONE_RE = re.compile(r"^\+7\d{10}$")
IIN_RE = re.compile(r"^\d{12}$")
PLATE_RE = re.compile(r"^\d{3}[A-Z]{2,3}\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Зоны travel: в KB только текстовые описания зон, списки стран — допущение (ASSUMPTIONS.md)
ZONE_A = {"russia", "belarus", "armenia", "azerbaijan", "kyrgyzstan", "uzbekistan", "tajikistan", "turkmenistan", "moldova", "georgia"}
ZONE_B = {
    "austria", "belgium", "czechia", "czech republic", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary",
    "iceland", "italy", "latvia", "liechtenstein", "lithuania", "luxembourg", "malta", "netherlands", "norway", "poland",
    "portugal", "slovakia", "slovenia", "spain", "sweden", "switzerland", "croatia", "uk", "united kingdom", "schengen",
}
ZONE_D = {"usa", "united states", "canada"}
COUNTRY_ALIASES = {
    "турция": "turkey", "түркия": "turkey", "грузия": "georgia", "россия": "russia", "ресей": "russia",
    "оаэ": "uae", "эмираты": "uae", "таиланд": "thailand", "египет": "egypt", "мысыр": "egypt",
    "германия": "germany", "франция": "france", "италия": "italy", "испания": "spain", "чехия": "czechia",
    "великобритания": "uk", "англия": "uk", "сша": "usa", "америка": "usa", "канада": "canada", "шенген": "schengen",
    "узбекистан": "uzbekistan", "өзбекстан": "uzbekistan", "кыргызстан": "kyrgyzstan", "қырғызстан": "kyrgyzstan",
}

# Специальности врачей: слот doctor_specialty — свободная строка, клиники в KB перечисляют английские названия
SPECIALTY_ALIASES = {
    "терапевт": "therapist", "лор": "ENT", "ent": "ENT", "оториноларинголог": "ENT", "стоматолог": "dentist", "тіс дәрігері": "dentist",
    "гинеколог": "gynecologist", "кардиолог": "cardiologist", "педиатр": "pediatrician", "балалар дәрігері": "pediatrician",
    "узи": "ultrasound", "анализы": "lab", "талдау": "lab", "лаборатория": "lab",
}

# check_coverage: сопоставление свободного service_name со строками пакетов ДМС в KB (ASSUMPTIONS.md)
SERVICE_KEYWORDS = [
    ("Outpatient medications", ["лекарств", "препарат", "дәрі", "medication", "medicine"]),
    ("Medications during hospitalization", ["лекарства в стационар", "стационардағы дәрі", "medications during hospital"]),
    ("MRI and CT", ["мрт", "кт", "mri", "ct", "томограф"]),
    ("Ultrasound", ["узи", "ultrasound", "ультрадыбыс"]),
    ("Dental prosthetics and implants", ["протез", "имплант", "implant", "prosthet"]),
    ("Dentistry", ["стоматолог", "зуб", "тіс", "dental", "dentist"]),
    ("Cosmetology", ["космет", "cosmet"]),
    ("Planned hospitalization", ["плановая госпитализац", "жоспарлы", "planned hospital"]),
    ("Emergency hospitalization", ["госпитализац", "стационар", "hospital"]),
    ("Emergency care", ["скорая", "неотложн", "жедел", "emergency"]),
    ("Lab tests", ["анализ", "талдау", "lab test", "blood test", "lab"]),
    ("Specialists", ["лор", "кардиолог", "гинеколог", "специалист", "маман", "ent", "cardiolog", "gynecolog", "specialist"]),
    ("Therapist visits", ["терапевт", "therapist"]),
]

APPOINTMENT_TIME = "09:30"
INSPECTION_TIME = "10:00"


def _err(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def _d(s: str | date) -> date:
    return s if isinstance(s, date) else datetime.strptime(s, "%Y-%m-%d").date()


def full_months_between(start: date, end_exclusive: date) -> int:
    months = (end_exclusive.year - start.year) * 12 + (end_exclusive.month - start.month)
    if end_exclusive.day < start.day:
        months -= 1
    return max(months, 0)


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return date(d.year + y, m + 1, 1) if d.day == 1 else date(d.year + y, m + 1, min(d.day, 28))


class MockBackend:
    def __init__(self, ds: Dataset | None = None, today: date | None = None):
        ds = ds or load()
        self.kb = ds.knowledge_base
        self.irreversible = {a.name for a in ds.actions.values() if a.irreversible}
        self.today = today or settings.today
        data = ds.backend.model_dump()
        self.defaults = data["defaults"]
        self.clients = {c["client_id"]: c for c in copy.deepcopy(data["clients"])}
        self.policies = {p["policy_number"]: p for p in copy.deepcopy(data["policies"])}
        self.claims = {c["claim_number"]: c for c in copy.deepcopy(data["claims"])}
        self.payments = {p["payment_id"]: p for p in copy.deepcopy(data["payments"])}
        self.tickets: dict[str, dict] = {}
        self.sms: list[dict] = []
        self.callbacks: list[dict] = []
        self.transfers: list[dict] = []
        self.bookings: list[dict] = []

    # --- общий вход ---

    def call(self, name: str, mode: str = "execute", **inputs) -> dict:
        fn = getattr(self, name, None)
        if fn is None or name.startswith("_") or name == "call":
            return _err("invalid_input", f"Unknown action {name}")
        if name in self.irreversible:
            if mode not in ("preview", "execute"):
                return _err("invalid_input", f"mode must be preview or execute, got {mode}")
            return fn(mode=mode, **inputs)
        return fn(**inputs)

    # --- утилиты ---

    def _new_id(self, prefix: str, existing: list[str], start: int) -> str:
        nums = [int(m.group(1)) for x in existing if (m := re.match(rf"^{re.escape(prefix)}(\d+)$", x))]
        return f"{prefix}{max(nums + [start - 1]) + 1}"

    def _policy_status(self, p: dict, on: date | None = None) -> str:
        on = on or self.today
        if p.get("status") in ("cancelled", "pending_payment"):
            return p["status"]
        if on < _d(p["start_date"]):
            return "not_yet_active"
        if on > _d(p["end_date"]):
            return "expired"
        return "active"

    def _bm(self, iin: str) -> str:
        for c in self.clients.values():
            if c["iin"] == iin:
                return c["bm_class"]
        return self.defaults["unknown_iin_bm_class"]

    def _region_by_plate(self, plate: str) -> str:
        codes = self.kb["products"]["ogpo"]["pricing"]["region_by_plate_code"]
        return codes.get(plate[-2:], codes["default"])

    # --- клиенты и полисы ---

    def find_client(self, phone: str | None = None, iin: str | None = None, **_) -> dict:
        if phone:
            if not PHONE_RE.match(phone):
                return _err("invalid_input", f"Phone {phone} does not match +7XXXXXXXXXX")
            found = [c for c in self.clients.values() if c["phone"] == phone]
            key = f"phone {phone}"
        elif iin:
            if not IIN_RE.match(iin):
                return _err("invalid_input", f"IIN {iin} must have 12 digits")
            found = [c for c in self.clients.values() if c["iin"] == iin]
            key = f"IIN {iin}"
        else:
            return _err("invalid_input", "phone or iin is required")
        if not found:
            return _err("not_found", f"Client with {key} not found")
        c = found[0]
        return {"client_id": c["client_id"], "full_name": c["full_name"]}

    def get_policies(self, client_id: str, **_) -> dict:
        if client_id not in self.clients:
            return _err("not_found", f"Client {client_id} not found")
        return {"policies": [self._policy_view(p) for p in self.policies.values() if p["client_id"] == client_id]}

    def _policy_view(self, p: dict) -> dict:
        return {"policy_number": p["policy_number"], "product": p["product"], "status": self._policy_status(p),
                "start_date": p["start_date"], "end_date": p["end_date"], "premium": p["premium"], "details": p["details"]}

    def get_policy(self, policy_number: str | None = None, vehicle_plate: str | None = None, **_) -> dict:
        if policy_number:
            p = self.policies.get(policy_number)
            key = policy_number
        elif vehicle_plate:
            if not PLATE_RE.match(vehicle_plate):
                return _err("invalid_input", f"Plate {vehicle_plate} has a wrong format")
            # по госномеру ищем прежде всего ОГПО (ответственность виновника), затем любой полис
            matches = sorted((p for p in self.policies.values() if p["details"].get("vehicle_plate") == vehicle_plate),
                             key=lambda p: p["product"] != "ogpo")
            p = matches[0] if matches else None
            key = vehicle_plate
        else:
            return _err("invalid_input", "policy_number or vehicle_plate is required")
        if not p:
            return _err("not_found", f"Policy for {key} not found")
        v = self._policy_view(p)
        v["client_id"] = p["client_id"]
        return v

    def get_bm_class(self, iin: str, **_) -> dict:
        if not IIN_RE.match(str(iin)):
            return _err("invalid_input", f"IIN {iin} must have 12 digits")
        return {"bm_class": self._bm(iin)}

    # --- расчёт цен (формулы knowledge_base.json) ---

    def calc_ogpo_price(self, region: str, vehicle_type: str, drivers_iin: list[str] | str, term_months: int = 12, **_) -> dict:
        pr = self.kb["products"]["ogpo"]["pricing"]
        drivers = [drivers_iin] if isinstance(drivers_iin, str) else list(drivers_iin)
        if region not in pr["base_by_region_kzt"] or vehicle_type not in pr["vehicle_type_coef"] or str(term_months) not in pr["term_coef"]:
            return _err("invalid_input", "region, vehicle_type or term is not allowed")
        if not drivers or any(not IIN_RE.match(i) for i in drivers):
            return _err("invalid_input", "Every driver IIN must have 12 digits")
        bm_coef = max(pr["bm_coef"][self._bm(i)] for i in drivers)  # худший класс среди водителей
        price = pr["base_by_region_kzt"][region] * pr["vehicle_type_coef"][vehicle_type] * bm_coef * pr["term_coef"][str(term_months)]
        return {"price": round(price), "bm_classes": {i: self._bm(i) for i in drivers}}

    def calc_casco_price(self, car_value: int, car_year: int, franchise: int = 0, package: str = "Standard", start_year: int | None = None, **_) -> dict:
        pr = self.kb["products"]["casco"]["pricing"]
        car_value, car_year, franchise = int(car_value), int(car_year), int(franchise or 0)
        if str(franchise) not in pr["franchise_coef"] or package not in pr["package_coef"] or car_value <= 0:
            return _err("invalid_input", "franchise, package or car_value is not allowed")
        age = (start_year or self.today.year) - car_year
        if age < 0:
            return _err("invalid_input", f"car_year {car_year} is in the future")
        if age > pr["max_car_age"][package]:
            return _err("not_eligible", f"Car is {age} years old; {package} allows up to {pr['max_car_age'][package]}")
        rate = next(r for band, r in pr["rate_by_car_age"].items() if int(band.split("-")[0]) <= age <= int(band.split("-")[1])) \
            if age <= 10 else pr["rate_by_car_age"]["8-10"]  # Lite 11–15 лет: ставка старшей группы (ASSUMPTIONS.md)
        price = car_value * rate * pr["franchise_coef"][str(franchise)] * pr["package_coef"][package]
        return {"price": round(price), "car_age": age, "package": package}

    def _zone(self, country: str) -> str:
        c = country.strip().lower()
        c = COUNTRY_ALIASES.get(c, c)
        if c in ZONE_D:
            return "D"
        if c in ZONE_B:
            return "B"
        if c in ZONE_A:
            return "A"
        return "C"

    def calc_travel_price(self, trip_country: str, trip_start: str, trip_end: str, travelers_count: int, traveler_max_age: int, **_) -> dict:
        tr = self.kb["products"]["travel"]
        try:
            start, end = _d(trip_start), _d(trip_end)
        except (ValueError, TypeError):
            return _err("invalid_input", "trip dates must be YYYY-MM-DD")
        travelers, age = int(travelers_count), int(traveler_max_age)
        if end < start or start < self.today or travelers < 1:
            return _err("invalid_input", "Trip dates or travelers count are not valid")
        if age > 75:
            return _err("not_eligible", "Travelers over 75 are insured only via an operator")
        zone = self._zone(trip_country)
        age_coef = tr["pricing"]["age_coef"]["0-64" if age <= 64 else "65-75"]
        days = (end - start).days + 1
        price = tr["zones"][zone]["rate_per_day_kzt"] * days * travelers * age_coef
        return {"price": round(price), "zone": zone, "coverage": tr["zones"][zone]["coverage"], "days": days}

    def calc_property_price(self, property_type: str, sum_insured: int, **_) -> dict:
        pr = self.kb["products"]["property"]
        table = pr["price_per_year_kzt"]
        if str(int(sum_insured)) not in table or property_type not in ("apartment", "house"):
            return _err("invalid_input", f"sum_insured must be one of {list(table)}, property_type apartment|house")
        price = table[str(int(sum_insured))] * (pr["house_coef"] if property_type == "house" else 1)
        return {"price": round(price)}

    def calc_accident_price(self, sum_insured: int, **_) -> dict:
        table = self.kb["products"]["accident"]["price_per_year_kzt"]
        if str(int(sum_insured)) not in table:
            return _err("invalid_input", f"sum_insured must be one of {list(table)}")
        return {"price": table[str(int(sum_insured))]}

    def dms_individual_price(self, package: str) -> dict:
        """Не действие actions.json: цена индивидуального ДМС для kb-ответов SC09."""
        table = self.kb["products"]["dms"]["individual_price_per_year_kzt"]
        return {"price": table[package]} if package in table else _err("invalid_input", f"package must be one of {list(table)}")

    def refund_amount(self, policy_number: str) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        if any(c["policy_number"] == policy_number and c["status"] == "paid" for c in self.claims.values()):
            return {"refund_amount": 0, "note": "No refund: a claim was paid under this policy."}
        start = max(self.today, _d(p["start_date"]))
        months = full_months_between(start, _d(p["end_date"]) + timedelta(days=1))
        return {"refund_amount": round(p["premium"] * months / 12 * 0.9), "unused_months": months}

    # --- необратимые действия с полисами ---

    def create_policy(self, product_type: str, phone: str, mode: str = "execute", price: int | None = None, client_id: str | None = None, details: dict | None = None, **_) -> dict:
        if product_type not in PRODUCT_PREFIX or not PHONE_RE.match(str(phone)):
            return _err("invalid_input", "product_type or phone is not valid")
        summary = {"product_type": product_type, "phone": phone, "price": price, "details": details or {}}
        if mode == "preview":
            return {"preview": True, **summary}
        prefix = f"SQ-{PRODUCT_PREFIX[product_type]}-"
        number = self._new_id(prefix, list(self.policies), 100001)
        start = self.today
        self.policies[number] = {
            "policy_number": number, "client_id": client_id, "product": product_type, "status": "pending_payment",
            "start_date": start.isoformat(), "end_date": (add_months(start, 12) - timedelta(days=1)).isoformat(),
            "premium": price, "details": details or {}, "phone": phone,
        }
        return {"policy_number": number, "status": "pending_payment", "note": "Payment link sent by SMS; policy starts after payment."}

    def renew_policy(self, policy_number: str, mode: str = "execute", **_) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        end = _d(p["end_date"])
        if p["product"] not in ("ogpo", "casco", "property", "accident") or p.get("status") == "cancelled":
            return _err("not_eligible", f"{p['product']} policy cannot be renewed by phone")
        if not (self.today - timedelta(days=30) <= end <= self.today + timedelta(days=60)):
            return _err("not_eligible", f"Policy ends on {end}; renewal is possible from 60 days before to 30 days after the end date")
        new_start = max(end + timedelta(days=1), self.today)
        d = p["details"]
        if p["product"] == "ogpo":
            res = self.calc_ogpo_price(self._region_by_plate(d["vehicle_plate"]), d["vehicle_type"], d["drivers_iin"], d.get("term_months", 12))
        elif p["product"] == "casco":
            res = self.calc_casco_price(d["car_value"], d["car_year"], d["franchise"], d["package"], start_year=new_start.year)
        elif p["product"] == "property":
            res = self.calc_property_price(d["property_type"], d["sum_insured"])
        else:
            res = {"price": p["premium"]}
        if "error" in res:
            return res
        summary = {"old_policy_number": policy_number, "price": res["price"], "start_date": new_start.isoformat(),
                   "end_date": (add_months(new_start, 12) - timedelta(days=1)).isoformat()}
        if mode == "preview":
            return {"preview": True, **summary}
        number = self._new_id(f"SQ-{PRODUCT_PREFIX[p['product']]}-", list(self.policies), 100001)
        self.policies[number] = {**copy.deepcopy(p), "policy_number": number, "status": "pending_payment",
                                 "start_date": summary["start_date"], "end_date": summary["end_date"], "premium": res["price"]}
        return {"policy_number": number, "price": res["price"], "start_date": summary["start_date"]}

    def update_policy(self, policy_number: str, mode: str = "execute", new_driver_iin: str | None = None, vehicle_plate: str | None = None, **_) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        if self._policy_status(p) != "active":
            return _err("policy_inactive", f"Policy {policy_number} is {self._policy_status(p)}")
        if p["product"] not in ("ogpo", "casco"):
            return _err("invalid_input", "Only motor policies can be changed")
        d = copy.deepcopy(p["details"])
        if new_driver_iin:
            if not IIN_RE.match(new_driver_iin):
                return _err("invalid_input", "Driver IIN must have 12 digits")
            if p["product"] == "ogpo":
                d["drivers_iin"] = list(dict.fromkeys(d["drivers_iin"] + [new_driver_iin]))
            change = {"new_driver_iin": new_driver_iin}
        elif vehicle_plate:
            if not PLATE_RE.match(vehicle_plate):
                return _err("invalid_input", f"Plate {vehicle_plate} has a wrong format")
            d["vehicle_plate"] = vehicle_plate
            change = {"vehicle_plate": vehicle_plate}
        else:
            return _err("invalid_input", "new_driver_iin or vehicle_plate is required")
        extra = 0
        if p["product"] == "ogpo":  # CASCO не зависит от водителей и госномера (ASSUMPTIONS.md)
            new_price = self.calc_ogpo_price(self._region_by_plate(d["vehicle_plate"]), d["vehicle_type"], d["drivers_iin"], d.get("term_months", 12))["price"]
            months = full_months_between(self.today, _d(p["end_date"]) + timedelta(days=1))
            extra = max(0, round((new_price - p["premium"]) * months / 12))
        summary = {"policy_number": policy_number, **change, "extra_premium": extra}
        if mode == "preview":
            return {"preview": True, **summary}
        p["details"] = d
        if extra:
            p["premium"] += extra
        return {"extra_premium": extra, **change}

    def cancel_policy(self, policy_number: str, cancel_reason: str = "", mode: str = "execute", **_) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        if p.get("status") == "cancelled":
            return _err("already_done", f"Policy {policy_number} is already cancelled")
        if self._policy_status(p) != "active":
            return _err("policy_inactive", f"Policy {policy_number} is {self._policy_status(p)}")
        if p["premium"] is None:
            return _err("not_eligible", "Corporate policy: termination only through the employer")
        refund = self.refund_amount(policy_number)
        summary = {"policy_number": policy_number, "cancel_reason": cancel_reason, **refund,
                   "refund_time": self.kb["cancellation"]["refund_time"]}
        if mode == "preview":
            return {"preview": True, **summary}
        p["status"] = "cancelled"
        p["cancelled_on"] = self.today.isoformat()
        return {"refund_amount": refund["refund_amount"], "refund_time": summary["refund_time"]}

    # --- страховые случаи ---

    def create_claim(self, product_type: str, incident_date: str, incident_description: str, mode: str = "execute",
                     policy_number: str | None = None, culprit_vehicle_plate: str | None = None, client_id: str | None = None, **_) -> dict:
        try:
            when = _d(incident_date)
        except (ValueError, TypeError):
            return _err("invalid_input", "incident_date must be YYYY-MM-DD")
        if when > self.today:
            return _err("invalid_input", f"incident_date {when} is in the future")
        if not incident_description:
            return _err("invalid_input", "incident_description is required")
        if culprit_vehicle_plate:  # пострадавший по ОГПО виновника
            pol = self.get_policy(vehicle_plate=culprit_vehicle_plate)
            claim_type = "ogpo_victim"
        else:
            pol = self.get_policy(policy_number=policy_number) if policy_number else _err("invalid_input", "policy_number is required")
            claim_type = product_type
        if "error" in pol:
            return pol
        p = self.policies[pol["policy_number"]]
        if claim_type == "ogpo_victim" and p["product"] != "ogpo":
            return _err("not_found", f"No OGPO policy for plate {culprit_vehicle_plate}")
        if claim_type != "ogpo_victim" and p["product"] != product_type:
            return _err("invalid_input", f"Policy {p['policy_number']} is {p['product']}, not {product_type}")
        if self._policy_status(p, when) != "active":
            return _err("policy_inactive", f"Policy {p['policy_number']} was not active on {when}")
        docs = self.kb["claims"]["documents"].get(claim_type, [])
        summary = {"claim_type": claim_type, "policy_number": p["policy_number"], "incident_date": when.isoformat(),
                   "incident_description": incident_description, "documents": docs}
        if mode == "preview":
            return {"preview": True, **summary}
        number = self._new_id("CL-", list(self.claims), 500001)
        self.claims[number] = {"claim_number": number, "client_id": client_id or p["client_id"], "policy_number": p["policy_number"],
                               "claim_type": claim_type, "incident_date": when.isoformat(), "status": "registered",
                               "next_step": "Submit the documents from the SMS list; review takes 15 working days after all documents."}
        return {"claim_number": number, "documents": docs}

    def get_claim(self, claim_number: str | None = None, client_id: str | None = None, **_) -> dict:
        if claim_number:
            c = self.claims.get(claim_number)
        elif client_id:
            own = [c for c in self.claims.values() if c["client_id"] == client_id]
            open_ = [c for c in own if c["status"] != "paid"]
            c = (open_ or own or [None])[-1]
        else:
            return _err("invalid_input", "claim_number or client_id is required")
        if not c:
            return _err("not_found", f"Claim {claim_number or 'for client ' + str(client_id)} not found")
        return copy.deepcopy(c)

    def create_dispute(self, claim_number: str, complaint_text: str, mode: str = "execute", **_) -> dict:
        c = self.claims.get(claim_number)
        if not c:
            return _err("not_found", f"Claim {claim_number} not found")
        summary = {"claim_number": claim_number, "complaint_text": complaint_text, "review": self.kb["claims"]["dispute"]}
        if mode == "preview":
            return {"preview": True, **summary}
        ticket = self._new_id("T-", list(self.tickets), 700001)
        self.tickets[ticket] = {"type": "dispute", **summary}
        return {"ticket_id": ticket}

    # --- записи (осмотр, врач) ---

    def _working_days(self, city: str, kind: str) -> set[int]:
        if kind == "inspection":
            return {0, 1, 2, 3, 4, 5} if city in ("Almaty", "Astana") else {0, 1, 2, 3, 4}
        return {0, 1, 2, 3, 4, 5}  # клиники: пн–сб (ASSUMPTIONS.md)

    def _slot(self, preferred: date, city: str, kind: str, time_: str) -> tuple[str | None, list[str]]:
        days = self._working_days(city, kind)
        if preferred.weekday() in days:
            return f"{preferred.isoformat()} {time_}", []
        alt, d = [], preferred
        while len(alt) < 2:
            d += timedelta(days=1)
            if d.weekday() in days:
                alt.append(f"{d.isoformat()} {time_}")
        return None, alt

    def book_inspection(self, claim_number: str, city: str, preferred_date: str, mode: str = "execute", **_) -> dict:
        c = self.claims.get(claim_number)
        if not c or c["claim_type"] not in ("casco", "ogpo_victim"):
            return _err("not_found", f"Vehicle claim {claim_number} not found")
        try:
            day = _d(preferred_date)
        except (ValueError, TypeError):
            return _err("invalid_input", "preferred_date must be YYYY-MM-DD")
        if day < self.today:
            return _err("invalid_input", "preferred_date is in the past")
        points = {p["city"]: p for p in self.kb["inspection_points"]}
        point = points.get(city, points["other"])
        slot, alt = self._slot(day, city, "inspection", INSPECTION_TIME)
        if not slot:
            return {**_err("no_availability", f"No inspection slots on {day}"), "alternatives": alt}
        address = point["address"] if point["city"] != "other" else next(
            (f"{o['address']}, {o['city']} (office parking)" for o in self.kb["offices"] if o["city"] == city), point["address"])
        summary = {"claim_number": claim_number, "slot_datetime": slot, "address": address}
        if mode == "preview":
            return {"preview": True, **summary}
        self.bookings.append({"type": "inspection", **summary})
        return {"slot_datetime": slot, "address": address}

    def _specialty(self, s: str) -> str:
        s0 = s.strip().lower()
        return SPECIALTY_ALIASES.get(s0, next((v for k, v in SPECIALTY_ALIASES.items() if k in s0), s.strip()))

    def book_appointment(self, policy_number: str, doctor_specialty: str, city: str, preferred_date: str, mode: str = "execute", **_) -> dict:
        p = self.policies.get(policy_number)
        if not p or p["product"] != "dms":
            return _err("not_found", f"DMS policy {policy_number} not found")
        if self._policy_status(p) != "active":
            return _err("policy_inactive", f"Policy {policy_number} is {self._policy_status(p)}")
        spec = self._specialty(doctor_specialty)
        package = p["details"].get("package", "Basic")
        if package == "Basic" and spec not in ("therapist", "lab"):
            return _err("not_covered", "Basic package: specialists only by therapist referral; book a therapist first")
        try:
            day = _d(preferred_date)
        except (ValueError, TypeError):
            return _err("invalid_input", "preferred_date must be YYYY-MM-DD")
        if day < self.today:
            return _err("invalid_input", "preferred_date is in the past")
        clinics = [c for c in self.kb["clinics"] if c["city"] == city and spec in c["specialties"]]
        if not clinics:
            return _err("no_availability", f"No partner clinic with {spec} in {city}")
        slot, alt = self._slot(day, city, "clinic", APPOINTMENT_TIME)
        if not slot:
            return {**_err("no_availability", f"No slots on {day}"), "alternatives": alt}
        summary = {"clinic_name": clinics[0]["name"], "address": clinics[0]["address"], "slot_datetime": slot, "doctor_specialty": spec}
        if mode == "preview":
            return {"preview": True, **summary}
        self.bookings.append({"type": "appointment", "policy_number": policy_number, **summary})
        return {"clinic_name": summary["clinic_name"], "slot_datetime": slot}

    def check_coverage(self, policy_number: str, service_name: str, **_) -> dict:
        p = self.policies.get(policy_number)
        if not p or p["product"] != "dms":
            return _err("not_found", f"DMS policy {policy_number} not found")
        if self._policy_status(p) != "active":
            return _err("policy_inactive", f"Policy {policy_number} is {self._policy_status(p)}")
        package = p["details"].get("package", "Basic")
        pk = self.kb["products"]["dms"]["packages"][package]
        s = service_name.lower()
        for label, words in SERVICE_KEYWORDS:
            if any(w in s for w in words):
                for line in pk["not_covered"]:
                    if line.lower().startswith(label.lower()):
                        return {"covered": False, "note": line, "package": package}
                for line in pk["covered"]:
                    if line.lower().startswith(label.lower()):
                        return {"covered": True, "note": line, "package": package}
        return {"covered": None, "note": f"'{service_name}' is not listed in the {package} package; an operator can clarify.", "package": package}

    def list_clinics(self, city: str, doctor_specialty: str | None = None, **_) -> dict:
        clinics = [c for c in self.kb["clinics"] if c["city"] == city]
        if doctor_specialty:
            spec = self._specialty(doctor_specialty)
            clinics = [c for c in clinics if spec in c["specialties"]]
        if not clinics:
            return _err("not_found", f"No partner clinics in {city}")
        return {"clinics": clinics}

    # --- документы, оплата, контакты ---

    def resend_documents(self, policy_number: str, **_) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        status = self._policy_status(p)
        if status in ("cancelled", "pending_payment"):
            return _err("policy_inactive", f"Policy {policy_number} is {status}")
        client = self.clients.get(p["client_id"], {})
        return {"sent_to": client.get("email", ""), "policy_number": policy_number}

    def check_payment(self, client_id: str, payment_date: str | None = None, **_) -> dict:
        found = [p for p in self.payments.values() if p["client_id"] == client_id and (not payment_date or p["date"] == payment_date)]
        if not found:
            return _err("not_found", f"No payment for client {client_id}" + (f" on {payment_date}" if payment_date else ""))
        p = found[-1]
        return {"payment_status": p["status"], "amount": p["amount"], "payment_id": p["payment_id"], "date": p["date"],
                "product": p["product"], "policy_number": p["policy_number"], "note": p.get("note")}

    def update_contact(self, client_id: str, contact_field: str, new_value: str, mode: str = "execute", **_) -> dict:
        c = self.clients.get(client_id)
        if not c:
            return _err("not_found", f"Client {client_id} not found")
        checks = {"phone": PHONE_RE, "email": EMAIL_RE}
        if contact_field not in ("phone", "email", "address"):
            return _err("invalid_input", "contact_field must be phone, email or address")
        if contact_field in checks and not checks[contact_field].match(new_value):
            return _err("invalid_input", f"{contact_field} {new_value} has a wrong format")
        summary = {"contact_field": contact_field, "old_value": c[contact_field], "new_value": new_value}
        if mode == "preview":
            return {"preview": True, **summary}
        c[contact_field] = new_value
        return {}

    def request_document(self, policy_number: str, document_type: str, email: str, **_) -> dict:
        p = self.policies.get(policy_number)
        if not p:
            return _err("not_found", f"Policy {policy_number} not found")
        available = self.kb["documents_available"]
        if document_type not in available or not EMAIL_RE.match(str(email)):
            return _err("invalid_input", "document_type or email is not valid")
        if document_type == "embassy_certificate" and p["product"] != "travel":
            return _err("invalid_input", "An embassy certificate is issued only for travel policies")
        return {"sent_to": email, "delivery": available[document_type]}

    def get_offices(self, city: str, **_) -> dict:
        o = next((o for o in self.kb["offices"] if o["city"].lower() == str(city).lower()), None)
        if not o:
            return _err("not_found", f"No office in {city}")
        return {"address": o["address"], "hours": o["hours"], "city": o["city"]}

    def kb_lookup(self, topic: str, **_) -> dict:
        node = self.kb
        for part in topic.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return _err("not_found", f"No knowledge base entry for {topic}")
        return {"answer": copy.deepcopy(node), "topic": topic}

    # --- коммуникации ---

    def send_sms(self, phone: str, text: str = "", **_) -> dict:
        if not PHONE_RE.match(str(phone)):
            return _err("invalid_input", f"Phone {phone} does not match +7XXXXXXXXXX")
        self.sms.append({"phone": phone, "text": text})
        return {}

    def create_callback(self, phone: str, callback_time: str, **_) -> dict:
        if not PHONE_RE.match(str(phone)) or not callback_time:
            return _err("invalid_input", "phone or callback_time is not valid")
        self.callbacks.append({"phone": phone, "callback_time": callback_time})
        return {}

    def create_complaint(self, complaint_text: str, client_id: str | None = None, **_) -> dict:
        ticket = self._new_id("T-", list(self.tickets), 700001)
        self.tickets[ticket] = {"type": "complaint", "complaint_text": complaint_text, "client_id": client_id}
        return {"ticket_id": ticket, "review": self.kb["complaints"]["review_time"]}

    def report_fraud(self, fraud_details: str, client_id: str | None = None, **_) -> dict:
        ticket = self._new_id("F-", list(self.tickets), 900001)
        self.tickets[ticket] = {"type": "fraud", "fraud_details": fraud_details, "client_id": client_id}
        return {"ticket_id": ticket}

    def transfer_to_operator(self, queue: str, summary: str = "", **_) -> dict:
        self.transfers.append({"queue": queue, "summary": summary})
        return {"queue": queue}
