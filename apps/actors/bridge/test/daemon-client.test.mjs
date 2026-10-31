// Drives the real clerk_daemon binary over stdio through DaemonClient and the
// per-case queue: a full 3-1 case with wall-clock style ticks, plus the
// contract's rejection paths. Requires `cargo build --manifest-path apps/actors/Cargo.toml`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient, DaemonError } from "../src/daemon-client.js";
import { createCaseQueue } from "../src/queue.js";

const JURORS = [
  { id: "juror-1", sender: "S1" },
  { id: "juror-2", sender: "S2" },
  { id: "juror-3", sender: "S3" },
  { id: "juror-4", sender: "S4" },
];
const CONTEXT = [
  { source: "case:context", content: "Two neighbors heard the alarm. Only one called the manager." },
  { source: "case:question", content: "Who called the building manager?" },
];

async function closePhase(d, q) {
  const { phase } = await q.run("phase", () => d.phase());
  const r = await q.run("tick", () => d.tick(phase.deadlineMs));
  assert.equal(r.closed?.kind, "phase", JSON.stringify(r));
  return r;
}

test("daemon over stdio: fresh case, rejections, certified 3-1 flow", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "sv-bridge-"));
  let exit = null;
  const d = new DaemonClient({ outDir, onExit: (code) => (exit = code) });
  const q = createCaseQueue();
  try {
    await assert.rejects(q.run("phase", () => d.phase()), (e) => e instanceof DaemonError && e.code === "no_case");
    const opened = await q.run("open", () =>
      d.open({ caseId: "live-stdio", condition: "C3", choices: ["ans0", "ans1", "ans2"], context: CONTEXT, jurors: JURORS, timeoutMs: 1000 }),
    );
    assert.equal(opened.registry.jurors.length, 4);
    assert.equal(opened.evidence.length, 2);
    await assert.rejects(q.run("open2", () => d.open({ caseId: "x", condition: "C3", choices: ["a"], context: [], jurors: JURORS })), (e) => e.code === "case_open");

    for (const ev of opened.evidence) {
      const r = await q.run("admit", () => d.admit("evidence", ev));
      assert.equal(r.entry.status, "accepted");
    }
    await assert.rejects(q.run("early", () => d.sign({ sender: "S1", kind: "commit", round: 0, vote: "ans2" })), (e) => e.code === "wrong_phase");
    await closePhase(d, q); // attest -> commit/0

    const votes = { S1: "ans2", S2: "ans2", S3: "ans2", S4: "ans0" };
    for (const round of [0, 1]) {
      if (round === 1) {
        for (const s of Object.keys(votes)) {
          const a = await q.run("sign", () => d.sign({ sender: s, kind: "argument", round: 0, text: "I lean this way because of ev-0", evidenceIds: ["ev-0"] }));
          assert.equal((await q.run("admit", () => d.admit("argument", a.envelope))).entry.status, "accepted");
        }
        await closePhase(d, q); // deliberate -> commit/1
      }
      for (const [s, v] of Object.entries(votes)) {
        const c = await q.run("sign", () => d.sign({ sender: s, kind: "commit", round, vote: v, confidence: 80 }));
        assert.equal(c.channel.kind, "commit");
        assert.equal((await q.run("admit", () => d.admit("commit", c.envelope))).entry.status, "accepted");
      }
      await assert.rejects(q.run("earlyReveal", () => d.sign({ sender: "S1", kind: "reveal", round })), (e) => e.code === "wrong_phase");
      await closePhase(d, q); // commit -> reveal
      for (const s of Object.keys(votes)) {
        const r = await q.run("sign", () => d.sign({ sender: s, kind: "reveal", round }));
        assert.equal((await q.run("admit", () => d.admit("reveal", r.envelope))).entry.status, "accepted");
      }
      await closePhase(d, q); // reveal -> next
    }
    const fin = await q.run("finish", () => d.finish());
    assert.equal(fin.report.valid, true, JSON.stringify(fin.report));
    assert.equal(fin.cert.cert.body.verdict, "ans2");
    const onDisk = JSON.parse(readFileSync(fin.path, "utf8"));
    assert.deepEqual(onDisk.cert.body.transcriptRoot, fin.cert.cert.body.transcriptRoot);
    assert.ok(fin.path.endsWith("live-stdio.json"));
  } finally {
    d.close();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(outDir, { recursive: true, force: true });
  }
  assert.equal(exit, 0);
});

test("queue serializes, isolates task errors, and aborts only explicitly", async () => {
  let aborted = null;
  const q = createCaseQueue({ onAbort: (e) => (aborted = e) });
  const order = [];
  const a = q.run("a", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); });
  const b = q.run("b", async () => { order.push("b"); });
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a", "b"]);
  await assert.rejects(q.run("bad", async () => { throw new Error("wrong_phase"); }), /wrong_phase/);
  assert.equal(await q.run("still-alive", async () => 1), 1);
  assert.equal(aborted, null);
  q.abort(new Error("persist failed"));
  await assert.rejects(q.run("next", async () => 1), /persist failed/);
  assert.equal(aborted?.message, "persist failed");
});
