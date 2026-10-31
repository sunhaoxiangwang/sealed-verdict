import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createWorkspace } from "../../apps/actors/bridge/src/relay.js";
import { createTerse } from "../../apps/actors/bridge/src/terse.js";
import { runWorkflow, panel } from "./workflow.mjs";
import { archiveCase, readArchive, hasArchive } from "./supabase.mjs";
import { validateCase } from "./case-input.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
if (existsSync(path.join(root, ".env.live"))) process.loadEnvFile(path.join(root, ".env.live"));
const example = JSON.parse(readFileSync(path.join(root, "demo/data/td-bank-public-case.json"), "utf8"));
let input = example;
const runs = path.join(root, "demo/live/runs");
mkdirSync(runs, { recursive: true, mode: 0o700 });
const latest = path.join(runs, "latest.json");
let state = existsSync(latest) ? JSON.parse(readFileSync(latest, "utf8")) : null;
let archived = !state ? await readArchive() : null;
if (archived?.run) state = archived.run;
input = state?.input || archived?.input || example;
if (state?.status === "running") {
  state.status = "failed";
  state.error = "The process stopped during this run. Start a new case; signing keys are never restored.";
}
const terse = await createTerse({ actorUrl: process.env.TERSE_ACTOR_URL, apiKey: process.env.TERSE_API_KEY });
let controller;
const save = () => {
  writeFileSync(latest + ".tmp", JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(latest + ".tmp", latest);
};
const missingKeys = () => ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"].filter(k => !process.env[k]);
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

async function start() {
  controller = new AbortController();
  state = { caseId: `aml-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, input, status: "running", stage: "alert", events: [], startedAt: new Date().toISOString() };
  save();
  const update = event => {
    state.stage = event.stage;
    state.events.push({ ...event, at: new Date().toISOString() });
    save();
  };
  try {
    const baseUrl = process.env.RELAY_BASE_URL || "http://127.0.0.1:8787";
    let workspaceKey = process.env.RELAY_WORKSPACE_KEY;
    if (!workspaceKey) {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname)) throw new Error("RELAY_WORKSPACE_KEY is required for hosted Relay");
      workspaceKey = (await createWorkspace({ name: state.caseId, baseUrl })).workspaceKey;
    }
    const result = await runWorkflow({ input, caseId: state.caseId, relay: { baseUrl, workspaceKey }, terse,
      outDir: path.join(root, "apps/actors/out"), update, signal: controller.signal });
    state.status = "complete";
    state.report = result.report;
    state.stats = result.stats;
    state.assessments = result.assessments;
    state.finishedAt = new Date().toISOString();
    save();
    await archiveCase(await snapshot());
  } catch (error) {
    controller.abort();
    state.status = "failed";
    state.error = String(error.message);
    state.events.push({ stage: "error", text: state.error, at: new Date().toISOString() });
    save();
    console.error(`[aml] ${state.error}`);
  }
}

async function snapshot() {
  let actor = null, transcript = [], bundle = null, registry = null;
  if (state && ["panel", "human_review"].includes(state.stage)) {
    [actor, transcript, bundle, registry] = await Promise.all([
      terse.getSummary(state.caseId), terse.getTranscript(state.caseId), terse.getCertificate(state.caseId), terse.getRegistry(state.caseId),
    ]);
  }
  return { input, panel, run: state, actor, transcript, bundle, registry, missingKeys: missingKeys(),
    archive: hasArchive() ? "supabase/private/sealed-verdict" : null,
    terseMode: process.env.TERSE_ACTOR_URL && !/127\.0\.0\.1|localhost/.test(process.env.TERSE_ACTOR_URL) ? "hosted" : "local" };
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".jpg": "image/jpeg", ".png": "image/png", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream" };
const dist = path.join(root, "apps/web/dist");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/aml/example" && req.method === "GET") {
      res.setHeader("Content-Disposition", 'attachment; filename="td-bank-aml-case.json"');
      return json(res, 200, example);
    }
    if (url.pathname === "/api/aml" && req.method === "GET") {
      return json(res, 200, archived && state?.status === "complete" ? { ...archived, missingKeys: missingKeys() } : await snapshot());
    }
    if (url.pathname === "/api/aml/run" && req.method === "POST") {
      // Same-origin browser calls only. CLI calls have no Origin header.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: "Cross-origin run refused" });
      if (req.headers["content-type"] !== "application/json") return json(res, 415, { error: "Use application/json" });
      if (missingKeys().length) return json(res, 503, { error: `Missing ${missingKeys().join(", ")}` });
      let requested;
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 65536) return json(res, 413, { error: "Case file must be smaller than 64 KB" });
        }
        const payload = JSON.parse(body || "{}");
        requested = validateCase(payload.case ?? example);
      } catch (error) { return json(res, 400, { error: error.message }); }
      // ponytail: one active case per demo server; add a job queue for multiple operators.
      if (state?.status === "running") return json(res, 409, { error: "A case is already running" });
      input = requested;
      archived = null;
      void start();
      return json(res, 202, { caseId: state.caseId });
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
    let file = path.resolve(dist, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) file = path.join(dist, "index.html");
    if (!path.extname(file)) file = path.join(dist, "index.html");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    json(res, error.code === "ENOENT" ? 404 : 503, { error: error.code === "ENOENT" ? "Build the frontend with pnpm --filter @sealed-verdict/web build" : String(error.message) });
  }
});
const port = Number(process.env.PORT || 8090);
server.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`AML workflow: http://localhost:${port}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { controller?.abort(); server.close(); setTimeout(() => process.exit(0), 500).unref(); });
