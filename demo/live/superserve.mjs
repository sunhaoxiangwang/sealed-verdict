// Uploads only application sources and an allowlisted private environment file.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
if (existsSync(".env")) process.loadEnvFile(".env");
if (existsSync(".env.live")) process.loadEnvFile(".env.live");
const cli = existsSync(".runtime/bin/superserve") ? path.join(root, ".runtime/bin/superserve") : "superserve";
function run(command, args, capture = false) {
  const r = spawnSync(command, args, { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", env: { ...process.env, DO_NOT_TRACK: "1" } });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || `${path.basename(command)} exited ${r.status}`);
  return r.stdout;
}
const temp = mkdtempSync(path.join(tmpdir(), "sealed-verdict-"));
try {
  run(cli, ["whoami", "--json"], true);
  const required = ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "TERSE_API_KEY", "TERSE_ACTOR_URL"];
  for (const k of required) if (!process.env[k]) throw new Error(`Set ${k} in .env before deployment`);
  if (!process.env.TERSE_ACTOR_URL.startsWith("https://")) throw new Error("SuperServe needs a deployed HTTPS Terse actor URL");
  const name = `sealed-verdict-${Date.now().toString(36)}`;
  const archive = path.join(temp, "source.tar.gz");
  run("tar", ["-czf", archive, "--exclude=node_modules", "--exclude=target", "--exclude=dist", "--exclude=.env", "--exclude=.env.*", "--exclude=.tokens", "--exclude=.cache", "--exclude=.durable-actors", "--exclude=out", "--exclude=runs",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".dockerignore", "apps/actors", "apps/web", "apps/jurors/package.json", "packages/protocol", "eval/providers.py", "demo/live", "demo/python/live_agent.py", "demo/data/td-bank-public-case.json"]);
  const allowed = [...required, "OPENAI_MODEL", "GEMINI_MODEL", "ANTHROPIC_MODEL", "AML_PHASE_TIMEOUT_MS", "SUPABASE_API_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
  const env = allowed.filter(k => process.env[k]).map(k => {
    if (/[\r\n]/.test(process.env[k])) throw new Error(`Invalid multiline ${k}`);
    return `${k}=${process.env[k]}`;
  }).join("\n") + "\n";
  const envFile = path.join(temp, "runtime.env");
  writeFileSync(envFile, env, { mode: 0o600 });
  run(cli, ["sandbox", "create", "--name", name, "--preview-access", "private", "--timeout", "1h"]);
  run(cli, ["cp", archive, `${name}:/home/user/source.tar.gz`]);
  run(cli, ["cp", envFile, `${name}:/home/user/sealed-verdict.env`]);
  run(cli, ["exec", name, "chmod 600 /home/user/sealed-verdict.env && mkdir -p /home/user/sealed-verdict && tar -xzf /home/user/source.tar.gz -C /home/user/sealed-verdict && bash /home/user/sealed-verdict/demo/live/cloud-start.sh"]);
  run(cli, ["exec", name, "for attempt in $(seq 1 60); do if curl -fsS http://localhost:8090/api/aml >/dev/null; then exit 0; fi; sleep 2; done; exit 1"]);
  run(cli, ["preview", "publish", name, "8090", "--private"]);
  console.log(`Sandbox ready: ${name}. Open a private browser link with:\n${cli} preview url ${name} 8090 --signed --expires 1h --open`);
} catch (error) {
  console.error(`${error.message}\nIf not signed in, run ${cli} login. Then rerun pnpm demo:superserve.`);
  process.exitCode = 1;
} finally { rmSync(temp, { recursive: true, force: true }); }
