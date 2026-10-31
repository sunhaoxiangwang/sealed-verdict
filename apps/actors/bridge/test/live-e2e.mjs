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
import { sealIntent, openIntent, generateRecipientKeypair, INTENT_ENC_VERSION } from "../src/intent-crypto.js";
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

test("live forged 3-1 case: transport, state, routing, sealed ballots, first-commit-wins, verified certificate", { skip: !KEY && "RELAY_WORKSPACE_KEY not set" }, async () => {
  const caseId = `e2e-${randomBytes(3).toString("hex")}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-live-"));
  const tag = randomBytes(4).toString("hex");
  const controlProbe = `controlplain-${tag}`;
  const sealedProbe = `sealedprobe-${tag}`;
  const scripted = plan(["ans2", "ans2", "ans2", "ans0"]);
  scripted.jurors["juror-1"].note = sealedProbe; // travels only inside juror-1's sealed commit intent
  let misrouted = 0;
  const privacy = { done: false };
  const reader = await connectBridge({ workspaceKey: KEY, baseUrl: BASE, caseId: `${caseId}-outsider`, jurorIds: [] });
  const outsider = jurorClient({ agentToken: (await reader.registerObserver("unrelated")).token, baseUrl: BASE });
  const hooks = {
    onPhase(next, ctx) {
      if (next.phase !== "commit" || next.round !== 0) return;
      const j1 = ctx.jurors.get("juror-1");
      const j2 = ctx.jurors.get("juror-2");
      const c1 = jurorClient({ agentToken: j1.token, baseUrl: ctx.baseUrl });
      const c2 = jurorClient({ agentToken: j2.token, baseUrl: ctx.baseUrl });
      // Wrong recipient: juror-1 DMs juror-2 a plaintext control probe. Signs nothing, but proves the search leak below.
      c1.dm(j2.name, JSON.stringify({ kind: "commit", round: 0, vote: "ans0", confidence: 99, control: controlProbe })).then(() => { misrouted += 1; }).catch(() => {});
      // Plaintext intent to the clerk under C3: must be refused as intent_not_encrypted.
      c2.dm(ctx.clerkName, JSON.stringify({ kind: "commit", round: 0, vote: "ans1", confidence: 50 })).catch(() => {});
      // Duplicate sealed commit intent from juror-1 after its scripted one; the first must stay revealable.
      setTimeout(() => c1.dm(ctx.clerkName, JSON.stringify(sealIntent({ recipientPublicKeyHex: ctx.recipientPublicKey, caseId, senderId: j1.id, intent: { kind: "commit", round: 0, vote: "ans0", confidence: 1 } }))).catch(() => {}), 600);
      // Confidentiality check while commit/0 is still open and before any reveal is published.
      setTimeout(async () => {
        try {
          await reader.clerk.channels.join(channelName(caseId, "reveal", 0));
          privacy.revealsPublishedAtCheck = (await listChannelMessages(reader.clerk, channelName(caseId, "reveal", 0), 50)).length;
          privacy.controlHits = (await outsider.search(controlProbe)).length;
          privacy.sealedProbeHits = (await outsider.search(sealedProbe)).length;
          const envelopes = await outsider.search(INTENT_ENC_VERSION);
          privacy.sealedEnvelopes = envelopes.length;
          privacy.envelopeLeaks = envelopes.filter((m) => /"vote"|"nonce"|"confidence"/.test(m.text ?? "") || (m.text ?? "").includes(sealedProbe)).length;
          const sample = envelopes.find((m) => (m.text ?? "").includes(INTENT_ENC_VERSION));
          if (sample) {
            const wrongKey = generateRecipientKeypair();
            try {
              openIntent({ recipientPrivateKey: wrongKey.privateKey, caseId, senderId: j1.id, envelope: JSON.parse(sample.text) });
              privacy.wrongKeyOpened = true;
            } catch (e) {
              privacy.wrongKeyOpened = false;
              privacy.wrongKeyCode = e.code;
            }
          }
          privacy.done = true;
        } catch (e) {
          privacy.error = e.message;
        }
      }, 1200);
    },
  };
  const result = await runLiveCase({ ...baseOpts(caseId, outDir, { intruder: true, hooks }), scripted });
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
    // Routing, plaintext refusal, duplicates: the misrouted DM never reached the clerk hub; the clerk
    // saw 20 scripted sealed intents + 1 plaintext (refused) + 1 sealed duplicate (refused).
    assert.equal(misrouted, 1);
    assert.equal(result.stats.ignoredDms, 0, JSON.stringify(result.stats));
    assert.equal(result.stats.intents, 22, JSON.stringify(result.stats));
    assert.equal(result.stats.plaintextRejected, 1, JSON.stringify(result.stats));
    assert.equal(result.stats.undecryptable, 0, JSON.stringify(result.stats));
    assert.equal(result.stats.intentErrors, 2, JSON.stringify(result.stats));
    // Confidentiality, measured during commit/0 before any reveal was published:
    // the plaintext control DM IS searchable by an unrelated agent (the confirmed engine leak),
    // the sealed ballots are not, and a wrong key cannot open a captured envelope.
    assert.equal(privacy.done, true, JSON.stringify(privacy));
    assert.equal(privacy.revealsPublishedAtCheck, 0, JSON.stringify(privacy));
    assert.ok(privacy.controlHits >= 1, `control plaintext should be searchable: ${JSON.stringify(privacy)}`);
    assert.equal(privacy.sealedProbeHits, 0, JSON.stringify(privacy));
    assert.ok(privacy.sealedEnvelopes >= 4, JSON.stringify(privacy));
    assert.equal(privacy.envelopeLeaks, 0, JSON.stringify(privacy));
    assert.equal(privacy.wrongKeyOpened, false, JSON.stringify(privacy));
    assert.equal(privacy.wrongKeyCode, "intent_invalid");
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
