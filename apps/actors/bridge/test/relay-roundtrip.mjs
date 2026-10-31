// Live transport test against a Relay server (local engine by default).
//
//   RELAY_WORKSPACE_KEY=... [RELAY_BASE_URL=http://127.0.0.1:8787] node --test test/relay-roundtrip.mjs
//
// Proves: a public channel envelope round-trips byte for byte with its message
// id; DM sender identity is the server-assigned registration id; the DM
// recipient surfaced as `toId` is the clerk and only clerk-addressed DMs reach
// the intent handler; a fifth agent is distinguishable from every juror; a
// string sent only by DM never appears on any public channel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  caseChannels,
  channelName,
  clerkAgentName,
  connectBridge,
  DEFAULT_BASE_URL,
  jurorClient,
  listChannelMessages,
  onChannelEnvelope,
  onDirectIntent,
  publish,
} from "../src/relay.js";

const workspaceKey = process.env.RELAY_WORKSPACE_KEY;
const baseUrl = process.env.RELAY_BASE_URL || DEFAULT_BASE_URL;

function waitFor(predicate, { timeoutMs = 10_000, label = "event" } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = predicate();
      if (hit) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

test("relay transport: channel roundtrip, DM identity, intruder, privacy", { skip: workspaceKey ? false : "RELAY_WORKSPACE_KEY not set; start a local engine and export the key" }, async (t) => {
  const caseId = `t${randomBytes(4).toString("hex")}`;
  const jurorIds = ["juror-1", "juror-2"];
  const bridge = await connectBridge({ workspaceKey, baseUrl, caseId, jurorIds });
  t.after(async () => {
    for (const hub of [bridge.relay, bridge.observers]) {
      try {
        await hub.messaging?.events?.disconnect?.();
      } catch {}
    }
  });

  assert.equal(bridge.channels.length, 8);
  assert.deepEqual(bridge.channels, caseChannels(caseId));
  for (const [id, j] of bridge.jurors) {
    assert.equal(typeof j.id, "string", `${id} has a server-assigned id`);
    assert.equal(typeof j.token, "string", `${id} has a token`);
  }
  assert.equal(typeof bridge.clerkId, "string");
  assert.equal(typeof bridge.tapId, "string");
  assert.notEqual(bridge.tapId, bridge.clerkId);

  const received = [];
  const dms = [];
  const unsubChannel = onChannelEnvelope(bridge.relay, caseId, (m) => received.push(m));
  const unsubDm = onDirectIntent(bridge.relay, (m) => dms.push(m));
  t.after(() => {
    unsubChannel();
    unsubDm();
  });

  await t.test("public channel envelope round-trips with its message id", async () => {
    const envelope = { body: { caseId, round: 0, juror: "juror-1", commitment: "ab".repeat(32) }, sig: null, signer: null };
    const { messageId, text } = await publish(bridge.clerk, channelName(caseId, "commit", 0), envelope);
    const got = await waitFor(() => received.find((m) => m.messageId === messageId), { label: "channel message" });
    assert.equal(got.kind, "commit");
    assert.equal(got.round, 0);
    assert.equal(got.text, text);
    assert.deepEqual(got.obj, envelope);
    assert.equal(got.fromId, bridge.clerkId);
    await new Promise((r) => setTimeout(r, 750));
    assert.equal(received.filter((m) => m.messageId === messageId).length, 1, "delivered exactly once");
  });

  const probe = `dm-only-probe-${randomBytes(6).toString("hex")}`;
  const j1 = bridge.jurors.get("juror-1");
  const j2 = bridge.jurors.get("juror-2");

  await t.test("DM to the clerk: sender is the registered juror id, recipient is the clerk", async () => {
    const client = jurorClient({ agentToken: j1.token, baseUrl });
    const intent = { kind: "commit", round: 0, vote: "ans2", confidence: 80, probe };
    await client.dm(clerkAgentName(caseId), JSON.stringify(intent));
    const got = await waitFor(() => dms.find((m) => m.obj && m.obj.probe === probe), { label: "dm" });
    assert.equal(got.fromId, j1.id);
    assert.notEqual(got.fromId, j2.id);
    assert.equal(got.toId, bridge.clerkId);
    assert.deepEqual(got.obj, intent);
  });

  await t.test("DM between jurors never reaches the clerk intent handler", async () => {
    const sideProbe = `juror-dm-${randomBytes(6).toString("hex")}`;
    const observerIntents = [];
    const rawObserverDms = [];
    const offIntent = onDirectIntent(bridge.observers, (m) => observerIntents.push(m));
    const offRaw = bridge.observers.addListener("dm.received", (e) => rawObserverDms.push(e));
    try {
      const client = jurorClient({ agentToken: j1.token, baseUrl });
      await client.dm(j2.name, JSON.stringify({ kind: "commit", round: 0, vote: "ans0", probe: sideProbe }));
      // Delivery happened: the recipient juror's stream (on the observer hub) saw it from juror-1.
      const raw = await waitFor(() => rawObserverDms.find((e) => (e.message?.text ?? "").includes(sideProbe)), { label: "raw juror dm" });
      assert.equal(raw.message.from.id, j1.id);
      await new Promise((r) => setTimeout(r, 1000));
      // The clerk hub carries only clerk-addressed DMs, so the intent handler never saw it.
      assert.equal(dms.filter((m) => m.obj && m.obj.probe === sideProbe).length, 0, "juror-to-juror DM leaked into the clerk intent handler");
      // A hub without a single authenticated recipient drops DMs instead of guessing.
      assert.equal(observerIntents.length, 0, "observer hub must not surface intents");
    } finally {
      offIntent();
      offRaw();
    }
  });

  await t.test("a fifth agent can post publicly but is not any juror", async () => {
    const intruder = await bridge.registerObserver("intruder");
    const chan = channelName(caseId, "evidence");
    await intruder.channels.join(chan);
    const forged = { body: { id: "ev-forged", caseId }, sig: null, signer: null };
    const { messageId } = await publish(intruder, chan, forged);
    const got = await waitFor(() => received.find((m) => m.messageId === messageId), { label: "intruder message" });
    assert.equal(got.kind, "evidence");
    assert.equal(got.fromId, intruder.id);
    for (const j of bridge.jurors.values()) assert.notEqual(got.fromId, j.id);
    assert.notEqual(got.fromId, bridge.clerkId);
  });

  await t.test("DM-only content never appears on a public channel", async () => {
    for (const chan of bridge.channels) {
      const rows = await listChannelMessages(bridge.clerk, chan, 200);
      for (const row of rows) assert.ok(!row.text.includes(probe), `${chan} leaked DM content`);
    }
  });

  await t.test("invalid JSON on a channel is reported, not thrown", async () => {
    const chan = channelName(caseId, "argument");
    const sent = await bridge.clerk.sendMessage({ to: `#${chan}`, text: "not json {" });
    const id = sent.messageId ?? sent.id;
    const got = await waitFor(() => received.find((m) => m.messageId === id), { label: "bad json" });
    assert.ok(got.parseError);
    assert.equal(got.obj, undefined);
  });
});
