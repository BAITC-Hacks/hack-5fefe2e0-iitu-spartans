import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "apps/web");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

// A host process cannot resolve Docker's `db` service name. Dedicated dev
// overrides also repair shells that previously exported DATABASE_URL="".
const env = {
  ...process.env,
  DATABASE_URL: process.env.DEV_DATABASE_URL || "postgres://voice_router:voice_router@127.0.0.1:15432/voice_router",
  ROUTER_URL: process.env.DEV_ROUTER_URL || "http://127.0.0.1:8000",
};
const port = process.env.DEV_WEB_PORT || "3001";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("DEV_WEB_PORT must be an integer from 1 to 65535");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", ["compose", "up", "-d", "--wait", "db", "router"]);

function readDocker(args) {
  const result = spawnSync("docker", args, { cwd: root, env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Could not discover the running PostgreSQL network");
  return result.stdout.trim();
}
const dbId = readDocker(["compose", "ps", "-q", "db"]);
const networks = JSON.parse(readDocker(["inspect", dbId, "--format", "{{json .NetworkSettings.Networks}}"]));
const network = Object.keys(networks).find((name) => name.endsWith("_default")) ?? Object.keys(networks)[0];
if (!network) throw new Error("PostgreSQL has no Docker network");
env.DEV_DOCKER_NETWORK = network;
run("docker", ["compose", "-p", "voice-router-dev-access", "-f", "docker-compose.dev.yml", "up", "-d"]);

// Container start does not imply a listening proxy. A bounded readiness retry
// avoids racing the first migration on a cold laptop.
const { default: pg } = await import("pg");
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try { await client.connect(); await client.query("SELECT 1"); ready = true; }
  catch { /* Retry only during local service startup. */ }
  finally { await client.end().catch(() => {}); }
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Local PostgreSQL access is not ready; check Docker and port 15432");
run(process.execPath, ["db/migrate.ts"]);

const require = createRequire(resolve(web, "package.json"));
const next = require.resolve("next/dist/bin/next");
console.log(`Voice Router development server: http://localhost:${port} (PostgreSQL and router connected)`);
const child = spawn(process.execPath, [next, "dev", "--port", port], { cwd: web, env, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
