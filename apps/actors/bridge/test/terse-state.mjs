// Terse CaseActor state test against a running local Terse dev server.
//
//   cd apps/actors/bridge/terse && terse actor dev --port 7100   (keep running)
//   node --test apps/actors/bridge/test/terse-state.mjs
//
// TERSE_ACTOR_URL overrides the default local endpoint
// (http://127.0.0.1:7100/v1/projects/local/actors); TERSE_API_KEY is only
// needed against a hosted project. Nothing here hashes, signs, or tallies: the
// actor is a durable record of what the Rust clerk_daemon decided.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { actors } from "../generated/index.js";

const caseId = `terse-state-test-${randomBytes(4).toString("hex")}`;
const actor = actors.CaseActor.get(caseId);

const registry = {
  caseId,
  condition: "C3",
  choices: ["ans0", "ans1", "ans2"],
  ledger: "11".repeat(32),
  clerk: "22".repeat(32),
  oracle: "33".repeat(32),
  jurors: [
    { id: "juror-1", pubkey: "44".repeat(32) },
    { id: "juror-2", pubkey: "55".repeat(32) },
    { id: "juror-3", pubkey: "66".repeat(32) },
    { id: "juror-4", pubkey: "77".repeat(32) },
  ],
};
const attest = { phase: "attest", round: 0, deadlineMs: 1_700_000_030_000, closed: false };
const genesis = "aa".repeat(32);
const head1 = "bb".repeat(32);
const head2 = "cc".repeat(32);
const head3 = "dd".repeat(32);

const entries = [
  {
    seq: 0,
    ts: 1_700_000_000_001,
    kind: "evidence",
    msg: { body: { id: "ev-0", caseId }, sig: "ee".repeat(64), signer: "33".repeat(32) },
    status: "accepted",
  },
  {
    seq: 1,
    ts: 1_700_000_000_002,
    kind: "evidence",
    msg: { body: { id: "ev-forged", caseId }, sig: null, signer: null },
    status: "unattested",
    reason: "UNSIGNED",
  },
  {
    seq: 2,
    ts: 1_700_000_030_000,
    kind: "phase",
    msg: { body: { caseId, phase: "attest", round: 0, ts: 1_700_000_030_000 }, sig: "ff".repeat(64), signer: "22".repeat(32) },
    status: "accepted",
  },
];
const next = { phase: "commit", round: 0, deadlineMs: 1_700_000_060_000, closed: false };

test("fresh case opens once; a second open is rejected", async () => {
  const summary = await actor.openCase(registry, attest, genesis);
  assert.equal(summary.caseId, caseId);
  assert.equal(summary.entryCount, 0);
  assert.equal(summary.head, genesis);
  assert.deepEqual(summary.phase, attest);
  assert.equal(summary.hasCert, false);
  await assert.rejects(actor.openCase(registry, attest, genesis), /case_exists/);
  assert.deepEqual(await actor.getRegistry(), registry);
  assert.deepEqual(await actor.getPhase(), attest);
});

test("entries append in sequence; a repeated seq is rejected", async () => {
  const s0 = await actor.appendEntry(entries[0], head1);
  assert.equal(s0.entryCount, 1);
  assert.equal(s0.head, head1);
  const s1 = await actor.appendEntry(entries[1], head2);
  assert.equal(s1.entryCount, 2);
  await assert.rejects(actor.appendEntry(entries[1], head2), /seq_mismatch/);
  assert.equal((await actor.getSummary()).entryCount, 2);
  assert.equal(await actor.getHead(), head2);
});

test("closePhase stores the close entry and the next window atomically", async () => {
  await assert.rejects(actor.closePhase(entries[0], head3, next), /not_phase|seq_mismatch/);
  const s = await actor.closePhase(entries[2], head3, next);
  assert.equal(s.entryCount, 3);
  assert.equal(s.head, head3);
  assert.deepEqual(s.phase, next);
  assert.deepEqual(await actor.getPhase(), next);
  // The same close cannot be appended twice.
  await assert.rejects(actor.closePhase(entries[2], head3, next), /seq_mismatch/);
  assert.equal((await actor.getSummary()).entryCount, 3);
});

test("transcript reads back exactly what was stored", async () => {
  const transcript = await actor.getTranscript(0);
  assert.deepEqual(transcript, entries);
  assert.deepEqual(await actor.getTranscript(2), [entries[2]]);
  assert.deepEqual(await actor.getTranscript(3), []);
});

test("certificate stored once and read back", async () => {
  assert.equal(await actor.getCertificate(), null);
  const bundle = { cert: { body: { caseId, verdict: "ans2" }, sig: "ab".repeat(64), signer: "11".repeat(32) }, transcript: entries };
  const s = await actor.setCertificate(bundle);
  assert.equal(s.hasCert, true);
  assert.deepEqual(await actor.getCertificate(), bundle);
  await assert.rejects(actor.setCertificate(bundle), /cert_exists/);
  const summary = await actor.getSummary();
  assert.deepEqual(summary, { caseId, entryCount: 3, head: head3, phase: next, hasCert: true });
});
