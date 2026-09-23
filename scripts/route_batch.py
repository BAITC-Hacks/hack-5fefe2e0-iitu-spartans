"""Прогон dev_utterances.json через роутер (пустой state) и оценка evaluate.py.

    .venv/bin/python scripts/route_batch.py [--model gpt-4.1-mini] [--concurrency 8] [--tag note]

Пишет runs/<timestamp>/{predictions.json, details.jsonl, eval.txt}.
"""
import argparse
import asyncio
import json
import statistics
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.config import settings  # noqa: E402
from app.dataset import load  # noqa: E402
from app.router.router import route  # noqa: E402


def percentile(values: list[int], q: float) -> int:
    values = sorted(values)
    return values[min(len(values) - 1, round(q * (len(values) - 1)))]


async def run(model: str | None, concurrency: int) -> list[dict]:
    sem = asyncio.Semaphore(concurrency)

    async def one(u):
        async with sem:
            for attempt in range(3):
                try:
                    r = await route(u.text, model=model)
                    return {"id": u.id, "text": u.text, "lang": u.lang, "type": u.type, "expected": u.expected, **r.model_dump()}
                except Exception as e:  # сеть/лимиты: пара повторов, потом фиксируем ошибку
                    err = repr(e)
                    await asyncio.sleep(1 + attempt)
            return {"id": u.id, "text": u.text, "lang": u.lang, "type": u.type, "expected": u.expected, "error": err}

    return await asyncio.gather(*(one(u) for u in load().dev_utterances))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    out_dir = REPO / "runs" / (datetime.now().strftime("%Y%m%d-%H%M%S") + (f"-{args.tag}" if args.tag else ""))
    out_dir.mkdir(parents=True)

    t0 = time.perf_counter()
    rows = asyncio.run(run(args.model, args.concurrency))
    wall = time.perf_counter() - t0

    preds = {r["id"]: [s["scenario_id"] for s in r.get("scenarios", [])] for r in rows}
    (out_dir / "predictions.json").write_text(json.dumps(preds, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(out_dir / "details.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    dataset_dir = settings.dataset_dir
    ev = subprocess.run(
        [sys.executable, str(dataset_dir / "evaluate.py"), str(out_dir / "predictions.json"), str(dataset_dir / "dev_utterances.json")],
        capture_output=True, text=True,
    )
    (out_dir / "eval.txt").write_text(ev.stdout + ev.stderr, encoding="utf-8")

    ok = [r for r in rows if "error" not in r]
    lat = [r["latency_ms"] for r in ok]
    cached = sum(r["usage"].get("cached", 0) for r in ok)
    inp = sum(r["usage"].get("input", 0) for r in ok)
    model = ok[0]["model"] if ok else args.model
    lang_ok = sum(1 for r in ok if r["language"] == r["lang"])

    print(ev.stdout)
    print(f"model: {model}  | run: {out_dir.relative_to(REPO)}  | wall {wall:.1f}s")
    if lat:
        print(f"router latency ms: median {statistics.median(lat):.0f}  p90 {percentile(lat, 0.9)}  max {max(lat)}")
        print(f"cached input tokens: {cached}/{inp} ({cached / max(inp, 1):.0%})")
        print(f"language detection == dev lang: {lang_ok}/{len(ok)}")
    failed = [r for r in rows if "error" in r]
    if failed:
        print(f"\nAPI errors ({len(failed)}):")
        for r in failed:
            print(f"  {r['id']}: {r['error']}")


if __name__ == "__main__":
    main()
