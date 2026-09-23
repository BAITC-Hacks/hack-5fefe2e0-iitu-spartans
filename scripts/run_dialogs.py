"""Прогон клиентских реплик 10 диалогов dialogs_sample.json через engine с общим состоянием на диалог.

    .venv/bin/python scripts/run_dialogs.py [D01 D04 ...] [--verbose]

Для каждой реплики сравнивает: сценарии роутера vs разметка `scenarios`; действия исполнителя vs `actions`
следующей реплики бота (имя + mode). Разметка местами не совпадает с actions сценариев (ANALYSIS §10 п.10),
поэтому разобранные расхождения помечены вердиктом в VERDICTS; неразобранные печатаются как «НЕ РАЗОБРАНО».
"""
import argparse
import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.dataset import load  # noqa: E402
from app.dialog.engine import Session, turn  # noqa: E402

# (dialog, номер клиентской реплики с 1) -> (вердикт, объяснение)
VERDICTS: dict[tuple[str, int], tuple[str, str]] = {}


def expected_actions(bot_turn: dict) -> list[str]:
    tags = []
    for a in bot_turn.get("actions") or []:
        tags.append(f"{a['name']}:{a['mode']}" if a.get("mode") else a["name"])
    return tags


async def run_dialog(dlg, clients: dict, verbose: bool) -> tuple[int, int, int]:
    phone = clients[dlg.client_id]["phone"] if dlg.client_id else None
    s = Session(client_phone=phone)
    turns = dlg.turns
    sc_ok = act_ok = n = 0
    lines: list[str] = [f"\n=== {dlg.dialog_id} {dlg.title} | client={dlg.client_id or '-'} phone={phone or '-'}"]
    k = 0
    for i, t in enumerate(turns):
        if t.role != "client":
            continue
        k += 1
        n += 1
        bot = turns[i + 1] if i + 1 < len(turns) else None
        plan, tr = await turn(s, t.text)
        got_sc = [x["scenario_id"] for x in tr["scenarios"]]
        exp_sc = t.scenarios or []
        exp_act = expected_actions(bot.model_dump()) if bot else []
        got_act = [a for a in tr["actions"] if "!" not in a]
        sc_match = got_sc == exp_sc
        act_match = sorted(got_act) == sorted(exp_act)
        sc_ok += sc_match
        act_ok += act_match
        mark = "OK " if sc_match and act_match else "!! "
        lines.append(f"{mark}#{k} [{t.lang}] {t.text}")
        lines.append(f"     scenarios: expected {exp_sc} | got {got_sc} (cont={tr['is_continuation']}, lang={tr['language']}->{tr['response_language']}, bot={bot.lang if bot else '-'})")
        lines.append(f"     actions:   expected {exp_act} | got {tr['actions']}")
        if verbose or not (sc_match and act_match):
            lines.append(f"     decision: {tr['decision']} | policy: {' | '.join(tr['policy'])}")
            lines.append(f"     plan: {[(st.kind, st.scenario_id, (st.question or {}).get('slot'), (st.confirm or {}).get('action'), (st.handoff or {}).get('queue')) for st in plan.steps]}"
                         + (f" offer_return={plan.offer_return['scenario_id']}" if plan.offer_return else "") + (f" queued={[q['scenario_id'] for q in plan.queued]}" if plan.queued else ""))
        if not (sc_match and act_match):
            verdict = VERDICTS.get((dlg.dialog_id, k))
            lines.append(f"     ВЕРДИКТ: {verdict[0]} — {verdict[1]}" if verdict else "     ВЕРДИКТ: НЕ РАЗОБРАНО")
    print("\n".join(lines))
    return sc_ok, act_ok, n


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dialogs", nargs="*")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    ds = load()
    clients = {c.client_id: c.model_dump() for c in ds.backend.clients}
    dialogs = [d for d in ds.dialogs if not args.dialogs or d.dialog_id in args.dialogs]
    results = []
    for d in dialogs:
        results.append(await run_dialog(d, clients, args.verbose))
    sc = sum(r[0] for r in results)
    act = sum(r[1] for r in results)
    n = sum(r[2] for r in results)
    bugs = [f"{k[0]}#{k[1]}: {v[1]}" for k, v in VERDICTS.items() if v[0] == "БАГ"]
    print(f"\nИТОГ: {len(dialogs)} диалогов, {n} клиентских реплик | сценарии совпали {sc}/{n} | действия совпали {act}/{n}")
    print(f"Разобрано расхождений: {len(VERDICTS)} (из них отмечено как баг: {len(bugs)})")
    for b in bugs:
        print("  БАГ", b)


if __name__ == "__main__":
    asyncio.run(main())
