// Live-case orchestrator. Wires Agent Relay (transport), the Rust clerk_daemon
// (all protocol decisions and keys), and the Terse CaseActor (durable per-case
// state) through one serialized queue. The bridge never signs, hashes,
// admits, or tallies; it moves envelopes and persists what the daemon decides.

import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

import { DaemonClient, DaemonError } from "./daemon-client.js";
import { createCaseQueue } from "./queue.js";
import { channelName, connectBridge, publish, onChannelEnvelope, onDirectIntent, jurorClient } from "./relay.js";
import { createTerse } from "./terse.js";
import { generateRecipientKeypair, sealIntent, openIntent, isEncryptedIntent, INTENT_ENC_VERSION } from "./intent-crypto.js";

const ADMITTED_KINDS = new Set(["evidence", "commit", "reveal", "argument"]);
const TICK_MS = 250;

function log(...args) {
  process.stderr.write(`[bridge] ${args.join(" ")}\n`);
}

/**
 * Run one live case to completion. Resolves with { cert, report, path, sidecarPath, stats }.
 * Rejects (after aborting the queue and removing this case's staged or final
 * artifacts) on daemon exit, persistence failure, or an invalid certificate.
 *
 * `terse` may be an options object for createTerse or an already-built adapter
 * (tests inject a failing one). `hooks.onPhase(next, ctx)` lets tests act when
 * a window opens.
 */
export async function runLiveCase(opts) {
  const {
    caseId, condition, choices, context, jurorIds, timeoutMs,
    relay: relayOpts, terse: terseOpts, outDir, daemonBin,
    scripted = null, intruder = false, tokensDir = null, hooks = {},
  } = opts;

  const conn = await connectBridge({ ...relayOpts, caseId, jurorIds });
  log(`relay ready: clerk ${conn.clerkId}, ${conn.jurors.size} jurors, ${conn.channels.length} channels`);
  // Fresh per-case recipient key for sealed intents; the private half never leaves this process.
  const recipient = generateRecipientKeypair();
  if (tokensDir) {
    // Private handoff for teammate juror processes: tokens and the pinned recipient key, never logged.
    mkdirSync(tokensDir, { recursive: true, mode: 0o700 });
    const file = path.join(tokensDir, `${caseId}.json`);
    const handoff = Object.fromEntries([...conn.jurors].map(([id, j]) => [id, { senderId: j.id, agentToken: j.token }]));
    writeFileSync(file, JSON.stringify({
      caseId, condition, baseUrl: relayOpts.baseUrl, clerkName: conn.clerkName,
      encryption: INTENT_ENC_VERSION, recipientPublicKey: recipient.publicKeyHex, jurors: handoff,
    }, null, 2) + "\n", { mode: 0o600 });
    log(`juror handoff written to ${file}`);
  }

  const jurorNameBySender = new Map([...conn.jurors].map(([, j]) => [j.id, j.name]));
  const replyTo = async (fromId, obj) => {
    const name = jurorNameBySender.get(fromId);
    if (!name) return;
    await conn.clerk.sendMessage({ to: `@${name}`, text: JSON.stringify(obj) });
  };
  const terse = typeof terseOpts?.appendEntry === "function" ? terseOpts : await createTerse(terseOpts);
  const queue = createCaseQueue({ onAbort: (e) => log(`ABORT: ${e.message}`) });
  const stats = { accepted: 0, rejected: 0, unattested: 0, intents: 0, intentErrors: 0, plaintextRejected: 0, undecryptable: 0, ignoredDms: 0, closes: 0 };
  const seqToMessage = {};
  const finalPath = path.join(outDir, `${caseId}.json`);
  const finalSidecar = path.join(outDir, `${caseId}.relay.json`);
  const stagingDir = path.join(outDir, ".staging", caseId);
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

  function cleanupArtifacts() {
    // Only this fresh case's files: staged bundle and anything already exposed.
    for (const p of [stagingDir, finalPath, finalSidecar]) {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  }

  function abort(err) {
    if (!queue.aborted) cleanupArtifacts();
    queue.abort(err);
    rejectDone(err);
  }

  const opened = await daemon.open({
    caseId, condition, choices, context, timeoutMs,
    jurors: jurorIds.map((id) => ({ id, sender: conn.jurors.get(id).id })),
  });
  await terse.openCase(caseId, opened.registry, opened.phase, opened.head);
  log(`case ${caseId} open in Terse; attest window until ${opened.phase.deadlineMs}`);

  const hookCtx = { caseId, condition, clerkId: conn.clerkId, clerkName: conn.clerkName, jurors: conn.jurors, baseUrl: relayOpts.baseUrl, recipientPublicKey: recipient.publicKeyHex };
  const scriptedJurors = scripted ? await startScriptedJurors(conn, relayOpts, scripted, { caseId, recipientPublicKeyHex: recipient.publicKeyHex }) : null;
  const intruderAgent = intruder ? await prepareIntruder(conn, relayOpts, caseId, jurorIds[0]) : null;

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

  const unsubDm = onDirectIntent(conn.relay, ({ fromId, toId, messageId, obj, parseError }) => {
    // The clerk hub carries only DMs the engine delivered to the clerk's own stream (toId);
    // a signing intent additionally needs a sender bound to a registered juror shell.
    if (fromId === conn.clerkId || fromId === conn.tapId) return;
    if (toId !== conn.clerkId || !jurorNameBySender.has(fromId)) {
      stats.ignoredDms += 1;
      log(`ignored DM ${messageId}: to=${toId} from=${fromId} is not juror-to-clerk`);
      return;
    }
    const reply = (o) => replyTo(fromId, o);
    queue.run(`intent:${messageId}`, async () => {
      stats.intents += 1;
      if (parseError || !obj || typeof obj !== "object") throw new DaemonError("bad_request", "intent is not a JSON object");
      let intent = obj;
      if (isEncryptedIntent(obj)) {
        try {
          intent = openIntent({ recipientPrivateKey: recipient.privateKey, caseId, senderId: fromId, envelope: obj });
        } catch {
          stats.undecryptable += 1;
          throw new DaemonError("intent_invalid", "sealed intent rejected");
        }
      } else if (condition !== "C2") {
        stats.plaintextRejected += 1;
        throw new DaemonError("intent_not_encrypted", "conditions C3 to C5 require sealed intents");
      }
      if (!intent || typeof intent !== "object") throw new DaemonError("bad_request", "intent is not a JSON object");
      const { kind, round, vote, confidence, text, evidenceIds } = intent;
      const signed = await daemon.sign({ sender: fromId, kind, round, vote, confidence, text, evidenceIds });
      const channel = channelName(caseId, signed.channel.kind, signed.channel.round);
      const { messageId: published } = await publish(conn.clerk, channel, signed.envelope);
      await reply({ ok: true, kind, round, messageId: published });
    }).catch(async (e) => {
      stats.intentErrors += 1;
      if (e instanceof DaemonError && e.code !== "daemon_exit") {
        // Code only: acknowledgements and logs never carry votes, nonces, or decrypted content.
        log(`intent from ${fromId} rejected: ${e.code}`);
        await reply({ ok: false, error: { code: e.code } }).catch(() => {});
      } else abort(e);
    });
  });

  async function finalize() {
    // Stage everything; expose nothing until the report is valid and Terse holds the certificate.
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });
    const fin = await daemon.finish(stagingDir);
    if (!fin.report.valid) {
      throw new Error(`certificate failed native verification: ${fin.report.failures.join("; ")}`);
    }
    const stagedSidecar = path.join(stagingDir, `${caseId}.relay.json`);
    writeFileSync(stagedSidecar, JSON.stringify({ caseId, seqToMessage }, null, 2) + "\n");
    await terse.setCertificate(caseId, fin.cert);
    mkdirSync(outDir, { recursive: true });
    renameSync(fin.path, finalPath);
    renameSync(stagedSidecar, finalSidecar);
    rmSync(stagingDir, { recursive: true, force: true });
    // The Ledger-signed certificate envelope; the transcript stays in the bundle.
    await publish(conn.clerk, channelName(caseId, "cert"), { cert: fin.cert.cert });
    finished = { cert: fin.cert, report: fin.report, path: finalPath, sidecarPath: finalSidecar, stats };
    resolveDone(finished);
  }

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
      if (next !== "verdict") {
        if (intruderAgent && next.phase === "commit" && next.round === 0) {
          intruderAgent.post().catch((e) => log(`intruder: ${e.message}`));
        }
        scriptedJurors?.onPhase(next);
        hooks.onPhase?.(next, hookCtx);
      }
      if (r.phase.closed) await finalize();
    }).catch((e) => abort(e));
  }, TICK_MS);

  // Evidence travels through Relay like everything else; it is admitted on receipt.
  for (const ev of opened.evidence) {
    await publish(conn.clerk, channelName(caseId, "evidence"), ev);
  }

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

/** Demo jurors living in this process but acting only through their own Relay tokens and sealed intents. */
async function startScriptedJurors(conn, relayOpts, scripted, { caseId, recipientPublicKeyHex }) {
  const clients = new Map();
  for (const [jurorId, j] of conn.jurors) {
    clients.set(jurorId, jurorClient({ agentToken: j.token, baseUrl: relayOpts.baseUrl }));
  }
  const dm = async (jurorId, intent) => {
    const senderId = conn.jurors.get(jurorId).id;
    const sealed = sealIntent({ recipientPublicKeyHex, caseId, senderId, intent });
    await clients.get(jurorId).dm(conn.clerkName, JSON.stringify(sealed));
  };
  return {
    onPhase(next) {
      const { phase, round } = next;
      for (const [jurorId, plan] of Object.entries(scripted.jurors)) {
        const task = (async () => {
          if (phase === "commit" && plan.votes[round] != null) {
            await dm(jurorId, { kind: "commit", round, vote: plan.votes[round], confidence: plan.confidence ?? 70, ...(plan.note ? { note: plan.note } : {}) });
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

/** A fifth agent that posts a forged, unsigned commit claiming to be a juror once commit/0 opens. */
async function prepareIntruder(conn, relayOpts, caseId, victimJurorId) {
  // Observer hub, never the clerk hub: only the clerk's own stream may deliver intents.
  const reg = await conn.registerObserver("intruder");
  const client = jurorClient({ agentToken: reg.token, baseUrl: relayOpts.baseUrl });
  const ch = channelName(caseId, "commit", 0);
  await client.channels.join(ch);
  return {
    async post() {
      const forged = { body: { caseId, round: 0, juror: victimJurorId, commitment: "00".repeat(32) }, sig: null, signer: null };
      await client.send(ch, JSON.stringify(forged));
      log("intruder posted a forged unsigned commit in the commit/0 window");
    },
  };
}
