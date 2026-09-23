const base = new URL(process.argv[2] || "http://localhost:3000");

async function read(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

try {
  const health = await read("/api/health");
  if (health.ok !== true || health.db !== true) throw new Error("PostgreSQL is not ready");
  console.log(`OK PostgreSQL: ${health.migrations} migration(s)`);
  const stats = await read("/api/stats");
  if (!Number.isFinite(stats.turns) || !Number.isFinite(stats.dialogs)) throw new Error("Invalid journal statistics");
  console.log(`OK journal: ${stats.turns} turns, ${stats.dialogs} dialogs`);
  const voice = await read("/api/stt");
  console.log(voice.available ? "OK server speech recognition configured" : "INFO server voice is not configured; check OPENAI_API_KEY for live voice");
  console.log(`Ready: ${base.origin}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
