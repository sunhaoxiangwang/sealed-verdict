// Live regression: an encrypted reveal intent sent during the commit/0 window
// is rejected (wrong_phase) and nothing reaches the reveal-0 channel before the
// Clerk publishes the phase notification that opens reveal/0. Requires the
// local Relay engine and Terse runtime; skips when RELAY_WORKSPACE_KEY is unset.
//
//   RELAY_WORKSPACE_KEY=... node --test --test-force-exit --test-timeout=240000 test/live-early-reveal.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { runLiveCase } from "../src/bridge.js";
import { connectBridge, channelName, jurorClient, listChannelMessages, onChannelEnvelope, DEFAULT_BASE_URL } from "../src/relay.js";

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
    intruder: false,
    ...extra,
  };
}

test("encrypted early reveal intent gets wrong_phase and publishes nothing before reveal/0 opens", { skip: !KEY && "RELAY_WORKSPACE_KEY not set" }, async () => {
  const { sealIntent } = await import("../src/intent-crypto.js");
  const caseId = `early-${randomBytes(3).toString("hex")}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-early-"));
  const revealChannel = channelName(caseId, "reveal", 0);
  const phaseChannel = channelName(caseId, "phase");

  // Independent observer on its own case id; it only joins and listens to the target case's channels.
  const observer = await connectBridge({ workspaceKey: KEY, baseUrl: BASE, caseId: `${caseId}-reader`, jurorIds: [] });
  const arrivals = []; // { channel, kind, round, messageId, obj, at } in arrival order
  const unsubscribe = onChannelEnvelope(observer.relay, caseId, (m) => {
    if (m.channel === revealChannel || m.channel === phaseChannel) {
      arrivals.push({ channel: m.channel, kind: m.kind, round: m.round, messageId: m.messageId, obj: m.obj, at: Date.now() });
    }
  });

  let earlyRevealSentAt = null;
  let joined = false;
  const hooks = {
    onPhase(next, ctx) {
      if (!joined) {
        // Channels exist once the case is open; join them on the first notification we see.
        joined = true;
        Promise.all([observer.clerk.channels.join(revealChannel), observer.clerk.channels.join(phaseChannel)]).catch(() => {});
      }
      if (next.phase !== "commit" || next.round !== 0) return;
      const j1 = ctx.jurors.get("juror-1");
      const client = jurorClient({ agentToken: j1.token, baseUrl: ctx.baseUrl });
      setTimeout(() => {
        const sealed = sealIntent({
          recipientPublicKeyHex: ctx.recipientPublicKey,
          caseId,
          senderId: j1.id,
          intent: { kind: "reveal", round: 0 },
        });
        client.dm(ctx.clerkName, JSON.stringify(sealed))
          .then(() => { earlyRevealSentAt = Date.now(); })
          .catch(() => {});
      }, 300);
    },
  };

  try {
    const result = await runLiveCase(baseOpts(caseId, outDir, { hooks }));

    // The case still certifies; the early reveal was the only rejected intent.
    assert.equal(result.report.valid, true, JSON.stringify(result.report));
    assert.equal(result.cert.cert.body.verdict, "ans2");
    assert.equal(result.cert.cert.body.quorum.counted, 4);
    assert.ok(earlyRevealSentAt, "early reveal intent was sent during commit/0");
    assert.equal(result.stats.intentErrors, 1, JSON.stringify(result.stats));

    // Ordering: nothing on reveal-0 before the notification that opens reveal/0.
    const opensReveal0 = (a) => a.channel === phaseChannel && a.obj?.next?.phase === "reveal" && a.obj?.next?.round === 0;
    const openIdx = arrivals.findIndex(opensReveal0);
    assert.ok(openIdx >= 0, `phase notification opening reveal/0 not observed; saw ${JSON.stringify(arrivals.map((a) => [a.channel, a.obj?.next]))}`);
    const revealsBefore = arrivals.slice(0, openIdx).filter((a) => a.channel === revealChannel);
    assert.deepEqual(revealsBefore, [], "a reveal reached the reveal-0 channel before its window opened");
    const revealsAfter = arrivals.slice(openIdx + 1).filter((a) => a.channel === revealChannel);
    assert.equal(revealsAfter.length, 4, `expected exactly four reveals after the window opened, saw ${revealsAfter.length}`);
    for (const r of revealsAfter) {
      assert.equal(r.obj?.body?.round, 0);
      assert.equal(typeof r.obj?.body?.vote, "string");
    }
    // Secondary check from channel history: message ids are time-ordered, so every reveal id follows the opening id.
    const openId = BigInt(arrivals[openIdx].messageId);
    const history = await listChannelMessages(observer.clerk, revealChannel, 200);
    assert.equal(history.length, 4);
    for (const m of history) assert.ok(BigInt(m.messageId) > openId, `reveal ${m.messageId} predates the reveal/0 opening ${openId}`);
    // The early intent itself never appeared publicly in any form.
    for (const m of history) assert.ok(!/"kind":"reveal"/.test(m.text) && !/"enc":/.test(m.text), `intent material leaked: ${m.text}`);
  } finally {
    unsubscribe();
    rmSync(outDir, { recursive: true, force: true });
  }
});
