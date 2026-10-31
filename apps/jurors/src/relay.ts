import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { AgentRelay, type RelayAgentClient, type RelayMessage } from "@agent-relay/sdk";

const ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));

// Loads apps/jurors/.env.local into process.env without overriding values already set.
export function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

// Connects to the team workspace (RELAY_WORKSPACE_KEY), or creates a dev workspace and saves its key to .env.local.
export async function connect(): Promise<AgentRelay> {
  const key = process.env.RELAY_WORKSPACE_KEY;
  if (key) return new AgentRelay({ workspaceKey: key });
  const relay = await retry(() => AgentRelay.createWorkspace({ name: "sealed-verdict-dev" }));
  appendFileSync(ENV_FILE, `RELAY_WORKSPACE_KEY=${relay.workspaceKey}\n`);
  process.env.RELAY_WORKSPACE_KEY = relay.workspaceKey;
  console.log("created a dev workspace; key saved to apps/jurors/.env.local (gitignored)");
  return relay;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The hosted relay returns retryable 503 database_overloaded and 429 workspace_busy under load. Wait at least its
// retryAfterMs, growing the backoff with jitter so parallel workers don't retry in lockstep (~3 minutes in total).
export async function retry<T>(fn: () => Promise<T>, tries = 14): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await fn();
    } catch (e: any) {
      if (!e?.retryable || k >= tries) throw e;
      await sleep(Math.max(e.retryAfterMs ?? 0, Math.min(500 * 2 ** k, 20000)) + Math.random() * 1000);
    }
  }
}

// Registers one agent. Each attempt uses a fresh suffix: a 503 can arrive after the server already created the
// agent, and registration is create-only, so retrying the same name would fail with name_conflict.
export function register(relay: AgentRelay, name: string): Promise<RelayAgentClient> {
  return retry(() => relay.workspace.register({ name: `${name}-${randomUUID().slice(0, 6)}`, type: "agent" }));
}

// Posts to a channel. The idempotency key makes retries safe: a 503 after the server stored the message
// must not produce a second copy.
export function post(agent: RelayAgentClient, channel: string, text: string, metadata: Record<string, unknown> = {}) {
  const idempotencyKey = randomUUID();
  return retry(() => agent.sendMessage({ to: `#${channel}`, text, metadata, idempotencyKey }));
}

// Channel history, oldest first.
export async function history(agent: RelayAgentClient, channel: string): Promise<RelayMessage[]> {
  const msgs = await retry(() => agent.messages.list(channel, { limit: 100 }));
  return [...msgs].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}
