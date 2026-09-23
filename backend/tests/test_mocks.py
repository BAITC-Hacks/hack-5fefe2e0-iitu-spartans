"""Моки против формул KB и чисел из dialogs_sample.json / mock_backend.json."""
from datetime import date

import pytest

from app.config import settings
from app.dataset import load
from app.executor.mocks import MockBackend


@pytest.fixture
def mb():
    return MockBackend()


def test_today_from_config(mb):
    assert mb.today == settings.today == date(2026, 10, 1)


# --- цены из диалогов ---

def test_d01_ogpo_quote_two_unknown_drivers(mb):
    r = mb.call("calc_ogpo_price", region="almaty", vehicle_type="car", drivers_iin=["910512300456", "930824400789"])
    assert r["price"] == 38000
    assert r["bm_classes"] == {"910512300456": "3", "930824400789": "3"}


def test_d10_travel_turkey_two_travelers(mb):
    r = mb.call("calc_travel_price", trip_country="Turkey", trip_start="2026-10-10", trip_end="2026-10-16",
                travelers_count=2, traveler_max_age=42)
    assert (r["price"], r["zone"], r["coverage"]) == (15400, "C", "50 000 USD")


def test_d07_casco_refund(mb):
    r = mb.call("cancel_policy", mode="preview", policy_number="SQ-CASCO-204350", cancel_reason="Car sold")
    assert r["preview"] and r["refund_amount"] == 163800


# --- все премии mock_backend пересчитываются по формулам KB ---

@pytest.mark.parametrize("policy", [p for p in load().backend.policies if p.premium is not None], ids=lambda p: p.policy_number)
def test_backend_premiums_match_kb_formulas(policy):
    mb = MockBackend(today=date.fromisoformat(policy.start_date))  # цена на дату начала полиса
    d = policy.details
    if policy.product == "ogpo":
        r = mb.calc_ogpo_price(mb._region_by_plate(d["vehicle_plate"]), d["vehicle_type"], d["drivers_iin"], d["term_months"])
    elif policy.product == "casco":
        r = mb.calc_casco_price(d["car_value"], d["car_year"], d["franchise"], d["package"])
    elif policy.product == "travel":
        r = mb.calc_travel_price(d["trip_country"], policy.start_date, policy.end_date, d["travelers_count"], d["traveler_max_age"])
    elif policy.product == "property":
        r = mb.calc_property_price(d["property_type"], d["sum_insured"])
    else:
        pytest.fail(f"unexpected product {policy.product}")
    assert r["price"] == policy.premium


def test_property_accident_dms_tables(mb):
    assert mb.call("calc_property_price", property_type="house", sum_insured=10000000)["price"] == 37500
    assert mb.call("calc_accident_price", sum_insured=3000000)["price"] == 15000
    assert mb.dms_individual_price("Comfort")["price"] == 320000


# --- ошибки в формате actions.json ---

def test_errors(mb):
    assert mb.call("find_client", phone="+77010000099")["error"]["code"] == "not_found"
    assert mb.call("find_client", phone="8701")["error"]["code"] == "invalid_input"
    assert mb.call("calc_casco_price", car_value=5000000, car_year=2010)["error"]["code"] == "not_eligible"
    assert mb.call("calc_travel_price", trip_country="Georgia", trip_start="2026-11-01", trip_end="2026-11-05",
                   travelers_count=1, traveler_max_age=80)["error"]["code"] == "not_eligible"
    # C003: ОГПО истёк 2026-09-29
    assert mb.call("update_policy", mode="preview", policy_number="SQ-OGPO-102850", new_driver_iin="900101300123")["error"]["code"] == "policy_inactive"
    assert mb.call("check_coverage", policy_number="SQ-OGPO-104501", service_name="MRI")["error"]["code"] == "not_found"


def test_cancel_twice_already_done(mb):
    assert "refund_amount" in mb.call("cancel_policy", mode="execute", policy_number="SQ-CASCO-204350", cancel_reason="sold")
    assert mb.call("cancel_policy", mode="execute", policy_number="SQ-CASCO-204350", cancel_reason="sold")["error"]["code"] == "already_done"


def test_no_refund_after_paid_claim(mb):
    # C001 CASCO: убыток CL-500198 оплачен
    assert mb.call("cancel_policy", mode="preview", policy_number="SQ-CASCO-204118")["refund_amount"] == 0


# --- preview не меняет состояние, новые ID не пересекаются ---

def test_preview_does_not_mutate_and_ids_are_new(mb):
    before = (dict(mb.claims), dict(mb.policies))
    args = dict(product_type="ogpo", incident_date="2026-09-28", incident_description="Rear-end collision", culprit_vehicle_plate="777ABC02")
    prev = mb.call("create_claim", mode="preview", **args)
    assert prev["preview"] and prev["claim_type"] == "ogpo_victim" and prev["policy_number"] == "SQ-OGPO-104501"
    assert (dict(mb.claims), dict(mb.policies)) == before
    done = mb.call("create_claim", mode="execute", **args)
    assert done["claim_number"] == "CL-500331" and done["claim_number"] not in before[0]
    new_policy = mb.call("create_policy", mode="execute", product_type="ogpo", phone="+77071234567", price=38000)
    assert new_policy["policy_number"] == "SQ-OGPO-105121"


def test_irreversible_requires_mode(mb):
    assert mb.call("cancel_policy", mode="dry", policy_number="SQ-CASCO-204350")["error"]["code"] == "invalid_input"


# --- сценарии диалогов ---

def test_d04_appointment_and_coverage(mb):
    r = mb.call("book_appointment", mode="preview", policy_number="SQ-DMS-604220", doctor_specialty="therapist",
                city="Astana", preferred_date="2026-10-02")
    assert (r["clinic_name"], r["slot_datetime"]) == ("Saulet Medical", "2026-10-02 09:30")
    cov = mb.call("check_coverage", policy_number="SQ-DMS-604220", service_name="lab tests")
    assert cov["covered"] is True
    assert mb.call("check_coverage", policy_number="SQ-DMS-604220", service_name="лекарства в аптеке")["covered"] is False


def test_d05_resend_documents(mb):
    assert mb.call("resend_documents", policy_number="SQ-OGPO-104777")["sent_to"] == "rustem.i@mail.example"


def test_d03_claim_status_and_renewal(mb):
    assert mb.call("get_claim", client_id="C007")["claim_number"] == "CL-500330"
    r = mb.call("renew_policy", mode="preview", policy_number="SQ-CASCO-204300")
    assert r["preview"] and r["start_date"] == "2026-10-21"


def test_c003_payment_charged_not_issued(mb):
    r = mb.call("check_payment", client_id="C003", payment_date="2026-09-30")
    assert r["payment_status"] == "charged_policy_not_issued" and r["policy_number"] is None


def test_inspection_no_availability_on_sunday(mb):
    r = mb.call("book_inspection", mode="preview", claim_number="CL-500330", city="Pavlodar", preferred_date="2026-10-04")
    assert r["error"]["code"] == "no_availability" and r["alternatives"] == ["2026-10-05 10:00", "2026-10-06 10:00"]
