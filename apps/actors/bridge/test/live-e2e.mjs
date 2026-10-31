// Live acceptance: a forged-evidence 3-1 case over the local Agent Relay engine
// and local Terse runtime. Skips when RELAY_WORKSPACE_KEY is not set.
//
//   RELAY_WORKSPACE_KEY=... node --test --test-force-exit --test-timeout=120000 test/live-e2e.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { runLiveCase } from "../src/bridge.js";
import { connectBridge, caseChannels, listChannelMessages, DEFAULT_BASE_URL } from "../src/relay.js";
import { createTerse } from "../src/terse.js";
import { initNode, verifyCert } from "../../../../packages/protocol/js/node.js";

const KEY = process.env.RELAY_WORKSPACE_KEY;
const BASE = process.env.RELAY_BASE_URL || DEFAULT_BASE_URL;

test("live forged 3-1 case: Relay transport, Terse state, verified certificate", { skip: !KEY && "RELAY_WORKSPACE_KEY not set" }, async () => {
  const caseId = `e2e-${randomBytes(3).toString("hex")}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-live-"));
  const jurorIds = ["juror-1", "juror-2", "juror-3", "juror-4"];
  const r1 = ["ans2", "ans2", "ans2", "ans0"];
  const jurors = {};
  jurorIds.forEach((id, i) => {
    jurors[id] = { votes: ["ans2", r1[i]], confidence: 60, argument: { text: `argument ${i} because of ev-0`, evidenceIds: ["ev-0"] } };
  });
  const result = await runLiveCase({
    caseId, condition: "C3", timeoutMs: 2500, outDir, jurorIds,
    choices: ["ans0", "ans1", "ans2"],
    context: [{ source: "case:context", content: "Two neighbors heard the alarm." }, { source: "case:question", content: "Who called?" }],
    relay: { workspaceKey: KEY, baseUrl: BASE },
    terse: { actorUrl: process.env.TERSE_ACTOR_URL, apiKey: process.env.TERSE_API_KEY },
    scripted: { jurors }, intruder: true,
  });
  try {
    // Certificate: native report from the daemon and the Node/WASM verifier agree.
    assert.equal(result.report.valid, true, JSON.stringify(result.report));
    assert.equal(result.cert.cert.body.verdict, "ans2");
    assert.equal(result.cert.cert.body.quorum.counted, 4);
    const onDisk = JSON.parse(readFileSync(result.path, "utf8"));
    await initNode();
    assert.deepEqual(verifyCert(onDisk), { valid: true, failures: [] });

    // Forged input from the fifth agent is in the transcript as a rejection and did not poison the case.
    const covered = onDisk.transcript.slice(0, onDisk.cert.body.transcriptLen);
    const forged = covered.filter((e) => e.kind === "commit" && e.status === "rejected");
    assert.ok(forged.length >= 1, "intruder commit should be recorded as rejected");
    assert.equal(forged[0].msg.sig, null);

    // Every externally admitted evidence/ballot/argument maps to a Relay message id.
    const sidecar = JSON.parse(readFileSync(result.sidecarPath, "utf8"));
    for (const e of covered) {
      if (e.kind === "phase") continue;
      assert.ok(sidecar.seqToMessage[e.seq]?.messageId, `entry ${e.seq} (${e.kind}) has no Relay message id`);
    }

    // Terse holds the certified transcript and the final phase.
    const terse = await createTerse({ actorUrl: process.env.TERSE_ACTOR_URL, apiKey: process.env.TERSE_API_KEY });
    const stored = await terse.getTranscript(caseId, 0);
    assert.deepEqual(stored.slice(0, covered.length), covered);
    const phase = await terse.getPhase(caseId);
    assert.equal(phase.closed, true);
    assert.equal(phase.phase, "reveal");
    assert.equal(phase.round, 1);
    assert.deepEqual((await terse.getCertificate(caseId)).cert.body.transcriptRoot, onDisk.cert.body.transcriptRoot);
    assert.deepEqual(await terse.getRegistry(caseId), onDisk.cert.body.registry);

    // Blind ballots: nothing on a commit channel carries a vote or nonce; reveals do, only on reveal channels.
    const conn = await connectBridge({ workspaceKey: KEY, baseUrl: BASE, caseId: `${caseId}-reader`, jurorIds: [] });
    for (const ch of caseChannels(caseId)) {
      await conn.clerk.channels.join(ch);
      const msgs = await listChannelMessages(conn.clerk, ch, 200);
      for (const m of msgs) {
        const text = m.text ?? "";
        if (ch.includes("-commit-")) {
          assert.ok(!/"vote"|"nonce"|"kind":"commit"/.test(text), `commit channel leaked: ${text}`);
        }
        assert.ok(!/"kind":"(commit|reveal|argument)"/.test(text), `intent leaked to ${ch}: ${text}`);
      }
      if (ch.includes("-reveal-")) assert.ok(msgs.some((m) => /"vote"/.test(m.text ?? "")), "reveal channel should carry reveals");
    }
    assert.equal(result.stats.intentErrors, 0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
