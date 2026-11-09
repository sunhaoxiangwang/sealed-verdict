// Starts the real local services, then the same-origin API + built frontend.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
if (existsSync(path.join(root, ".env.live"))) process.loadEnvFile(path.join(root, ".env.live"));
const runtime = path.join(root, ".runtime");
mkdirSync(runtime, { recursive: true });
process.env.PATH = `${runtime}/node_modules/.bin:${runtime}/bin:${process.env.PATH}`;
const children = [];
const launch = (name, command, args, cwd) => {
  const log = openSync(path.join(runtime, `${name}.log`), "a", 0o600);
  const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", log, log] });
  child.on("error", error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on("exit", code => { if (!stopping) { console.error(`${name} exited (${code}); see .runtime/${name}.log`); stop(1); } });
  children.push(child);
};
let stopping = false;
function stop(code = 0) { stopping = true; for (const child of children) child.kill("SIGTERM"); setTimeout(() => process.exit(code), 800); }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop());
async function waitPort(port) {
  for (let i = 0; i < 120; i++) {
    if (stopping) throw new Error("Service startup failed");
    const ready = await new Promise(resolve => {
      const socket = net.connect(port, "127.0.0.1");
      socket.setTimeout(500);
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => { socket.destroy(); resolve(false); });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
    });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Service on port ${port} did not start; see .runtime logs`);
}
try {
  if (!process.env.RELAY_BASE_URL) {
    launch("relay", process.execPath, [path.join(runtime, "node_modules/@relaycast/engine/dist/bin/serve.js"), "--db", path.join(runtime, "relay.db"), "--port", "8787"], root);
    await waitPort(8787);
  }
  if (!process.env.TERSE_ACTOR_URL) {
    launch("terse", "terse", ["actor", "dev", "--port", "7100"], path.join(root, "apps/actors/bridge/terse"));
    await waitPort(7100);
  }
  launch("aml", process.execPath, ["demo/live/server.mjs"], root);
  await waitPort(Number(process.env.PORT || 8090));
  console.log(`Live AML demo: http://localhost:${process.env.PORT || 8090}\nPress Run AML case in the courtroom. Logs: .runtime/{relay,terse,aml}.log`);
} catch (error) { console.error(error.message); stop(1); }
