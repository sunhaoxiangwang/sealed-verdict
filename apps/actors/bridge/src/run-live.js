// CLI: run one live case over Agent Relay with Terse durable state.
//
//   node src/run-live.js --script 3-1 [--condition C3] [--case-id ID] [--timeout-ms 4000] [--intruder]
//   node src/run-live.js --live --case-id ID            # wait for teammate jurors (tokens handed off privately)
//
// Env (names only, see .env.example): RELAY_WORKSPACE_KEY, RELAY_BASE_URL, TERSE_ACTOR_URL, TERSE_API_KEY.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { runLiveCase } from "./bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const script = flag("--script", has("--live") ? null : "3-1");
const condition = flag("--condition", "C3");
const caseId = flag("--case-id", `live-${script ?? "case"}-${randomBytes(4).toString("hex")}`);
const timeoutMs = Number(flag("--timeout-ms", script ? 4000 : 30000));
const outDir = flag("--out", path.resolve(here, "../../out"));
const jurorIds = ["juror-1", "juror-2", "juror-3", "juror-4"];

const SAMPLE = {
  choices: ["ans0", "ans1", "ans2"],
  context: [
    { source: "case:context", content: "Two neighbors, a retired teacher and a software engineer, both reported hearing the alarm at 2 a.m. Only one of them called the building manager. The incident report does not say which one." },
    { source: "case:question", content: "Who called the building manager?" },
  ],
};

const SCRIPTS = {
  "3-1": ["ans2", "ans2", "ans2", "ans0"],
  "2-2": ["ans2", "ans2", "ans0", "ans0"],
  forged: ["ans2", "ans2", "ans2", "ans0"],
};

function scriptedPlan(name) {
  const r1 = SCRIPTS[name];
  if (!r1) throw new Error(`unknown script ${name}`);
  const r0 = ["ans2", "ans0", "ans2", "ans0"];
  const texts = [
    "The report leaves the caller unstated because neither neighbor is identified, so ans2 is the only supported choice.",
    "Nothing in the context singles out either neighbor because both heard the alarm; I lean ans2 after rereading ev-0.",
    "The question cannot be resolved from ev-0 and ev-1 because the identity of the caller is withheld.",
    "I read the ordering of the sentence as a hint, so I keep ans0 even though ev-0 does not state it.",
  ];
  const jurors = {};
  jurorIds.forEach((id, i) => {
    jurors[id] = { votes: [r0[i], r1[i]], confidence: 60 + i * 10, argument: { text: texts[i], evidenceIds: i % 2 === 0 ? ["ev-0", "ev-1"] : ["ev-0"] } };
  });
  return { jurors };
}

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return v;
};

const result = await runLiveCase({
  caseId, condition, timeoutMs, outDir, jurorIds,
  choices: SAMPLE.choices, context: SAMPLE.context,
  relay: { workspaceKey: need("RELAY_WORKSPACE_KEY"), baseUrl: process.env.RELAY_BASE_URL || "http://127.0.0.1:8787" },
  terse: { actorUrl: process.env.TERSE_ACTOR_URL || "http://127.0.0.1:7100/v1/projects/local/actors", apiKey: process.env.TERSE_API_KEY },
  scripted: script ? scriptedPlan(script) : null,
  intruder: script === "forged" || has("--intruder"),
  tokensDir: script ? null : path.resolve(here, "../.tokens"),
}).catch((e) => {
  console.error(`live case aborted: ${e.message}`);
  process.exit(1);
});

console.log(JSON.stringify({
  caseId,
  verdict: result.cert.cert.body.verdict,
  counted: result.cert.cert.body.quorum.counted,
  valid: result.report.valid,
  failures: result.report.failures,
  transcriptLen: result.cert.cert.body.transcriptLen,
  output: result.path,
  relaySidecar: result.sidecarPath,
  stats: result.stats,
}, null, 2));
process.exit(result.report.valid ? 0 : 1);
