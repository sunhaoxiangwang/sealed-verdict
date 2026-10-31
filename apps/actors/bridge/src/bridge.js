// Live-case orchestrator. Wires Agent Relay (transport), the Rust clerk_daemon
// (all protocol decisions and keys), and the Terse CaseActor (durable per-case
// state) through one serialized queue. The bridge never signs, hashes,
// admits, or tallies; it moves envelopes and persists what the daemon decides.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DaemonClient, DaemonError } from "./daemon-client.js";
import { createCaseQueue } from "./queue.js";
import { channelName, connectBridge, publish, onChannelEnvelope, onDirectIntent, jurorClient } from "./relay.js";
import { createTerse } from "./terse.js";

const ADMITTED_KINDS = new Set(["evidence", "commit", "reveal", "argument"]);
const TICK_MS = 250;

function log(...args) {
  process.stderr.write(`[bridge] ${args.join(" ")}\n`);
}

/**
 * Run one live case to completion. Resolves with { cert, report, path, sidecarPath, stats }.
 * Rejects (after aborting the queue) on daemon exit or persistence failure.
 */
export async function runLiveCase(opts) {
  const {
    caseId, condition, choices, context, jurorIds, timeoutMs,
    relay: relayOpts, terse: terseOpts, outDir, daemonBin,
    scripted = null, intruder = false, tokensDir = null,
  } = opts;

  const conn = await connectBridge({ ...relayOpts, caseId, jurorIds });
  log(`relay ready: clerk ${conn.clerkId}, ${conn.jurors.size} jurors, ${conn.channels.length} channels`);
  if (tokensDir) {
    // Private handoff for teammate juror processes: one file, never logged.
    mkdirSync(tokensDir, { recursive: true, mode: 0o700 });
    const file = path.join(tokensDir, `${caseId}.json`);
    const handoff = Object.fromEntries([...conn.jurors].map(([id, j]) => [id, { senderId: j.id, agentToken: j.token }]));
    writeFileSync(file, JSON.stringify({ caseId, baseUrl: relayOpts.baseUrl, clerkName: conn.clerkName, jurors: handoff }, null, 2) + "\n", { mode: 0o600 });
    log(`juror tokens written to ${file}`);
  }

  const jurorNameBySender = new Map([...conn.jurors].map(([, j]) => [j.id, j.name]));
  const replyTo = async (fromId, obj) => {
    const name = jurorNameBySender.get(fromId);
    if (!name) return;
    await conn.clerk.sendMessage({ to: `@${name}`, text: JSON.stringify(obj) });
  };
  const terse = await createTerse(terseOpts);
  const queue = createCaseQueue({ onAbort: (e) => log(`ABORT: ${e.message}`) });
  const stats = { accepted: 0, rejected: 0, unattested: 0, intents: 0, intentErrors: 0, closes: 0 };
  const seqToMessage = {};
  let finished = null;
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

  const daemon = new DaemonClient({
    bin: daemonBin,
    outDir,
    onExit: (code) => {
      if (!finished) abort(new DaemonError("daemon_exit", `clerk_daemon exited with ${code}`));
    },
  });

  function abort(err) {
    queue.abort(err);
    rejectDone(err);
  }

  const opened = await daemon.open({
    caseId, condition, choices, context, timeoutMs,
    jurors: jurorIds.map((id) => ({ id, sender: conn.jurors.get(id).id })),
  });
  await terse.openCase(caseId, opened.registry, opened.phase, opened.head);
  log(`case ${caseId} open in Terse; attest window until ${opened.phase.deadlineMs}`);

  const scriptedJurors = scripted ? await startScriptedJurors(conn, relayOpts, scripted) : null;

  const unsubChannel = onChannelEnvelope(conn.relay, caseId, ({ kind, round, messageId, fromId, obj, parseError }) => {
    if (!ADMITTED_KINDS.has(kind)) return; // phase and cert channels are mirrors, never re-admitted
    queue.run(`admit:${kind}:${messageId}`, async () => {
      const msg = parseError ? { parseError: String(parseError) } : obj;
      const r = await daemon.admit(kind, msg);
      await terse.appendEntry(caseId, r.entry, r.head);
      seqToMessage[r.entry.seq] = { messageId, fromId, kind, round };
      stats[r.entry.status] = (stats[r.entry.status] ?? 0) + 1;
    }).catch((e) => { if (!(e instanceof DaemonError) || e.code === "daemon_exit") abort(e); else log(`admit ${kind}: ${e.message}`); });
  });

  const unsubDm = onDirectIntent(conn.relay, ({ fromId, messageId, obj, parseError }) => {
    // Juror agents share this connection, so the clerk's own DM replies echo back here.
    if (fromId === conn.clerkId || fromId === conn.tapId) return;
    const reply = (o) => replyTo(fromId, o);
    queue.run(`intent:${messageId}`, async () => {
      stats.intents += 1;
      if (parseError || !obj || typeof obj !== "object") throw new DaemonError("bad_request", "intent is not a JSON object");
      const { kind, round, vote, confidence, text, evidenceIds } = obj;
      const signed = await daemon.sign({ sender: fromId, kind, round, vote, confidence, text, evidenceIds });
      const channel = channelName(caseId, signed.channel.kind, signed.channel.round);
      const { messageId: published } = await publish(conn.clerk, channel, signed.envelope);
      await reply({ ok: true, kind, round, messageId: published });
    }).catch(async (e) => {
      stats.intentErrors += 1;
      if (e instanceof DaemonError && e.code !== "daemon_exit") {
        log(`intent from ${fromId} rejected: ${e.code}`);
        await reply({ ok: false, error: { code: e.code, message: e.detail } }).catch(() => {});
      } else abort(e);
    });
  });

  const timer = setInterval(() => {
    queue.run("tick", async () => {
      if (finished) return;
      const r = await daemon.tick(Date.now());
      if (!r.closed) return;
      stats.closes += 1;
      // Persist the close entry together with the derived next phase before announcing it.
      await terse.closePhase(caseId, r.closed, r.head, r.phase);
      const next = r.phase.closed ? "verdict" : { phase: r.phase.phase, round: r.phase.round, deadlineMs: r.phase.deadlineMs };
      await publish(conn.clerk, channelName(caseId, "phase"), { marker: r.closed.msg, next });
      log(`closed ${r.closed.msg.body.phase}/${r.closed.msg.body.round}; next ${JSON.stringify(next)}`);
      if (scriptedJurors) scriptedJurors.onPhase(next, opened);
      if (r.phase.closed) {
        const fin = await daemon.finish(outDir);
        await terse.setCertificate(caseId, fin.cert);
        await publish(conn.clerk, channelName(caseId, "cert"), { caseId, verdict: fin.cert.cert.body.verdict, valid: fin.report.valid, failures: fin.report.failures });
        const sidecarPath = fin.path.replace(/\.json$/, ".relay.json");
        writeFileSync(sidecarPath, JSON.stringify({ caseId, seqToMessage }, null, 2) + "\n");
        finished = { ...fin, sidecarPath, stats };
        resolveDone(finished);
      }
    }).catch((e) => abort(e));
  }, TICK_MS);

  // Evidence travels through Relay like everything else; it is admitted on receipt.
  for (const ev of opened.evidence) {
    await publish(conn.clerk, channelName(caseId, "evidence"), ev);
  }
  if (intruder) await startIntruder(conn, relayOpts, caseId, jurorIds[0]);

  try {
    return await done;
  } finally {
    clearInterval(timer);
    unsubChannel?.();
    unsubDm?.();
    await queue.idle().catch(() => {});
    daemon.close();
    await terse.close?.();
    await conn.close?.();
  }
}

/** Demo jurors living in this process but acting only through their own Relay tokens. */
async function startScriptedJurors(conn, relayOpts, scripted) {
  const clients = new Map();
  for (const [jurorId, j] of conn.jurors) {
    clients.set(jurorId, await jurorClient({ agentToken: j.token, baseUrl: relayOpts.baseUrl }));
  }
  const dm = async (jurorId, intent) => {
    await clients.get(jurorId).dm(conn.clerkName, JSON.stringify(intent));
  };
  return {
    onPhase(next) {
      if (next === "verdict") return;
      const { phase, round } = next;
      for (const [jurorId, plan] of Object.entries(scripted.jurors)) {
        const task = (async () => {
          if (phase === "commit" && plan.votes[round] != null) {
            await dm(jurorId, { kind: "commit", round, vote: plan.votes[round], confidence: plan.confidence ?? 70 });
          } else if (phase === "reveal" && plan.votes[round] != null) {
            await dm(jurorId, { kind: "reveal", round });
          } else if (phase === "deliberate" && plan.argument) {
            await dm(jurorId, { kind: "argument", round: 0, text: plan.argument.text, evidenceIds: plan.argument.evidenceIds ?? [] });
          }
        })();
        task.catch((e) => log(`scripted juror ${jurorId}: ${e.message}`));
      }
    },
  };
}

/** A fifth agent that posts a forged, unsigned commit claiming to be juror-1. */
async function startIntruder(conn, relayOpts, caseId, victimJurorId) {
  const reg = await conn.relay.workspace.register({ name: `sv-${caseId}-intruder`, type: "agent" });
  const client = jurorClient({ agentToken: reg.token, baseUrl: relayOpts.baseUrl });
  const forged = {
    body: { caseId, round: 0, juror: victimJurorId, commitment: "00".repeat(32) },
    sig: null,
    signer: null,
  };
  const ch = channelName(caseId, "commit", 0);
  await client.channels.join(ch);
  await client.send(ch, JSON.stringify(forged));
  log("intruder posted a forged unsigned commit");
}
