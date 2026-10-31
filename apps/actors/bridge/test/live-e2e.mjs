// Live acceptance against the local Agent Relay engine and local Terse runtime.
// Skips when RELAY_WORKSPACE_KEY is not set.
//
//   RELAY_WORKSPACE_KEY=... node --test --test-force-exit --test-timeout=240000 test/live-e2e.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { runLiveCase } from "../src/bridge.js";
import { connectBridge, caseChannels, channelName, listChannelMessages, jurorClient, DEFAULT_BASE_URL } from "../src/relay.js";
import { createTerse } from "../src/terse.js";
import { initNode, verifyCert } from "../../../../packages/protocol/js/node.js";

const KEY = process.env.RELAY_WORKSPACE_KEY;
const BASE = process.env.RELAY_BASE_URL || DEFAULT_BASE_URL;
const TERSE = { actorUrl: process.env.TERSE_ACTOR_URL, apiKey: process.env.TERSE_API_KEY };
const jurorIds = ["juror-1", "juror-2", "juror-3", "juror-4"];

function plan(r1) {
  const jurors = {};
  jurorIds.forEach((id, i) => {
    jurors[id] = { votes: ["ans2", r1[i]], confidence: 60, argument: { text: `argument ${i} because of ev-0`, evidenceIds: ["ev-0"] } };
  });
  return { jurors };
}

function baseOpts(caseId, outDir, extra = {}) {
  return {
    caseId, condition: "C3", timeoutMs: 2500, outDir, jurorIds,
    choices: ["ans0", "ans1", "ans2"],
    context: [{ source: "case:context", content: "Two neighbors heard the alarm." }, { source: "case:question", content: "Who called?" }],
    relay: { workspaceKey: KEY, baseUrl: BASE },
    terse: TERSE,
    scripted: plan(["ans2", "ans2", "ans2", "ans0"]),
    ...extra,
  };
}

async function readChannels(caseId) {
  const conn = await connectBridge({ workspaceKey: KEY, baseUrl: BASE, caseId: `${caseId}-reader-${randomBytes(2).toString("hex")}`, jurorIds: [] });
  const out = {};
  for (const ch of caseChannels(caseId)) {
    await conn.clerk.channels.join(ch);
    out[ch] = await listChannelMessages(conn.clerk, ch, 200);
  }
  return out;
}

test("live forged 3-1 case: transport, state, routing, first-commit-wins, verified certificate", { skip: !KEY && "RELAY_WORKSPACE_KEY not set" }, async () => {
  const caseId = `e2e-${randomBytes(3).toString("hex")}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-live-"));
  let misrouted = 0;
  const hooks = {
    onPhase(next, ctx) {
      if (next.phase !== "commit" || next.round !== 0) return;
      const j1 = ctx.jurors.get("juror-1");
      const j2 = ctx.jurors.get("juror-2");
      const c1 = jurorClient({ agentToken: j1.token, baseUrl: ctx.baseUrl });
      // Wrong recipient: juror-1 DMs juror-2 with a commit intent. Must sign nothing.
      c1.dm(j2.name, JSON.stringify({ kind: "commit", round: 0, vote: "ans0", confidence: 99 })).then(() => { misrouted += 1; }).catch(() => {});
      // Duplicate: a second commit intent from juror-1 after the scripted one; the first must stay revealable.
      setTimeout(() => c1.dm(ctx.clerkName, JSON.stringify({ kind: "commit", round: 0, vote: "ans0", confidence: 1 })).catch(() => {}), 600);
    },
  };
  const result = await runLiveCase(baseOpts(caseId, outDir, { intruder: true, hooks }));
  try {
    assert.equal(result.report.valid, true, JSON.stringify(result.report));
    assert.equal(result.cert.cert.body.verdict, "ans2");
    assert.equal(result.cert.cert.body.quorum.counted, 4);
    assert.ok(result.path.endsWith(`${caseId}.json`) && existsSync(result.path));
    assert.ok(!existsSync(path.join(outDir, ".staging", caseId)), "staging directory must be gone after success");
    const onDisk = JSON.parse(readFileSync(result.path, "utf8"));
    await initNode();
    assert.deepEqual(verifyCert(onDisk), { valid: true, failures: [] });

    const covered = onDisk.transcript.slice(0, onDisk.cert.body.transcriptLen);
    const commits0 = covered.filter((e) => e.kind === "commit" && e.msg?.body?.round === 0);
    assert.equal(commits0.filter((e) => e.status === "accepted").length, 4, "exactly the four scripted commits are accepted in round 0");
    // Intruder: forged, unsigned commit posted inside the commit/0 window fails authentication, not phase.
    const forged = commits0.filter((e) => e.status === "rejected");
    assert.equal(forged.length, 1, JSON.stringify(forged));
    assert.equal(forged[0].msg.sig, null);
    assert.equal(forged[0].reason, "UNSIGNED");
    // Routing and duplicates: the misrouted DM was sent but never reached the clerk hub, so it
    // signed nothing (20 scripted intents + 1 duplicate = 21); the duplicate was answered with an error.
    assert.equal(misrouted, 1);
    assert.equal(result.stats.ignoredDms, 0, JSON.stringify(result.stats));
    assert.equal(result.stats.intents, 21, JSON.stringify(result.stats));
    assert.equal(result.stats.intentErrors, 1, JSON.stringify(result.stats));
    // Every externally admitted evidence/ballot/argument maps to a Relay message id.
    const sidecar = JSON.parse(readFileSync(result.sidecarPath, "utf8"));
    for (const e of covered) {
      if (e.kind === "phase") continue;
      assert.ok(sidecar.seqToMessage[e.seq]?.messageId, `entry ${e.seq} (${e.kind}) has no Relay message id`);
    }
    // Terse holds the certified transcript, the final phase, and the certificate.
    const terse = await createTerse(TERSE);
    assert.deepEqual((await terse.getTranscript(caseId, 0)).slice(0, covered.length), covered);
    const phase = await terse.getPhase(caseId);
    assert.deepEqual([phase.closed, phase.phase, phase.round], [true, "reveal", 1]);
    const storedCert = await terse.getCertificate(caseId);
    assert.deepEqual(storedCert.cert, onDisk.cert);
    assert.deepEqual(await terse.getRegistry(caseId), onDisk.cert.body.registry);
    // Cert channel carries the Ledger-signed envelope that Terse stores.
    const channels = await readChannels(caseId);
    const certMsgs = channels[channelName(caseId, "cert")];
    assert.equal(certMsgs.length, 1);
    assert.deepEqual(JSON.parse(certMsgs[0].text).cert, storedCert.cert);
    // Blind ballots: no vote or nonce on commit channels; no intents anywhere public.
    for (const [ch, msgs] of Object.entries(channels)) {
      for (const m of msgs) {
        const text = m.text ?? "";
        if (ch.includes("-commit-")) assert.ok(!/"vote"|"nonce"/.test(text), `commit channel leaked: ${text}`);
        assert.ok(!/"kind":"(commit|reveal|argument)"/.test(text), `intent leaked to ${ch}: ${text}`);
      }
    }
    assert.ok(channels[channelName(caseId, "reveal", 1)].some((m) => /"vote"/.test(m.text ?? "")));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("final persistence failure leaves no completed output and no cert notification", { skip: !KEY && "RELAY_WORKSPACE_KEY not set" }, async () => {
  const caseId = `e2e-fail-${randomBytes(3).toString("hex")}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-live-"));
  const real = await createTerse(TERSE);
  const failing = { ...real, setCertificate: async () => { throw new Error("injected Terse outage"); } };
  try {
    await assert.rejects(runLiveCase(baseOpts(caseId, outDir, { terse: failing })), /injected Terse outage/);
    assert.ok(!existsSync(path.join(outDir, `${caseId}.json`)), "no completed bundle");
    assert.ok(!existsSync(path.join(outDir, `${caseId}.relay.json`)), "no sidecar");
    assert.ok(!existsSync(path.join(outDir, ".staging", caseId)), "no staged artifacts");
    assert.deepEqual(readdirSync(outDir).filter((f) => f.startsWith(caseId)), []);
    const channels = await readChannels(caseId);
    assert.equal(channels[channelName(caseId, "cert")].length, 0, "no cert notification");
    assert.equal(await real.getCertificate(caseId), null);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
