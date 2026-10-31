// Agent Relay transport for the Sealed Verdict bridge.
//
// This module only moves bytes: it registers agents, creates the per-case
// channels, publishes JSON text, and surfaces received messages with the
// server-assigned sender id. It contains no protocol logic, hashing, or
// signing; the Rust clerk daemon owns all of that.
//
// Pinned SDK: @agent-relay/sdk 15.0.1. Verified surface (dist/*.d.ts):
//   new AgentRelay({ workspaceKey, baseUrl })
//   relay.workspace.register({ name, type }) -> RelayAgentClient { id, name, token, channels, sendMessage, messages }
//   agent.channels.create({ name }) / join(name)
//   agent.sendMessage({ to: "#channel" | "@handle", text, idempotencyKey })
//   relay.addListener("message.created" | "dm.received", ({ message, envelope }) => ...)
//   message.from.id / envelope.from.id is the authenticated sender id
//   createAgentClient({ agentToken, baseUrl }) -> thin client: send, dm, channels.join, messages
//
// Recipient identity: a `dm.received` event carries no recipient id (verified
// live against the pinned engine: `envelope.to` is undefined and the message
// has only `conversationId`), and the workspace-level hub fans in every
// registered agent's own node stream while discarding which stream delivered
// the event. The authenticated recipient is therefore stream ownership: the
// `relay` instance returned by `connectBridge` has the clerk as its ONLY
// registered agent, so every DM it receives was delivered by the engine to the
// clerk's token. All other agents (tap, jurors, extras) live on a second
// instance (`observers`), whose DMs have no single authenticated recipient and
// are dropped by `onDirectIntent`.

import { randomUUID } from "node:crypto";
import { AgentRelay } from "@agent-relay/sdk";
import { createAgentClient } from "@agent-relay/sdk/messaging";

export const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

export const PUBLIC_KINDS = ["evidence", "commit", "reveal", "argument", "phase", "cert"];

/** Channel name for one case and kind. Rounds apply to commit and reveal only. */
export function channelName(caseId, kind, round) {
  if (!PUBLIC_KINDS.includes(kind)) throw new Error(`unknown channel kind ${kind}`);
  const base = `sv-${caseId}-${kind}`;
  if (kind === "commit" || kind === "reveal") {
    if (round !== 0 && round !== 1) throw new Error(`round required for ${kind}`);
    return `${base}-${round}`;
  }
  return base;
}

/** Every public channel for a case, in publication order. */
export function caseChannels(caseId) {
  return [
    channelName(caseId, "evidence"),
    channelName(caseId, "commit", 0),
    channelName(caseId, "reveal", 0),
    channelName(caseId, "argument"),
    channelName(caseId, "commit", 1),
    channelName(caseId, "reveal", 1),
    channelName(caseId, "phase"),
    channelName(caseId, "cert"),
  ];
}

/** Parse `sv-<caseId>-<kind>[-<round>]` back into its parts, or null. */
export function parseChannelName(caseId, name) {
  const prefix = `sv-${caseId}-`;
  if (typeof name !== "string" || !name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const m = /^(evidence|argument|phase|cert)$/.exec(rest) || /^(commit|reveal)-([01])$/.exec(rest);
  if (!m) return null;
  return { kind: m[1], round: m[2] === undefined ? null : Number(m[2]) };
}

export function clerkAgentName(caseId) {
  return `sv-${caseId}-clerk`;
}

export function jurorAgentName(caseId, jurorId) {
  return `sv-${caseId}-${jurorId}`;
}

export function tapAgentName(caseId) {
  return `sv-${caseId}-tap`;
}

/** Marks a hub whose only registered agent is the authenticated DM recipient. */
const RECIPIENT = Symbol("sealed-verdict.recipient");
/** Links the clerk hub to the hub that carries the tap and juror streams. */
const OBSERVERS = Symbol("sealed-verdict.observers");

/**
 * Register the bridge (clerk) agent on its own hub, and a tap agent plus one
 * agent per juror on a second hub; create the case channels and join the clerk
 * and the tap to all of them.
 *
 * The server does not echo an agent's own channel posts back on its realtime
 * stream (verified against the pinned engine), so the tap agent is what makes
 * `onChannelEnvelope` observe the clerk's own publications. Keeping the clerk
 * alone on `relay` is what authenticates DM recipients: see the module header.
 *
 * Returns server-assigned ids. Juror tokens are returned so the caller can hand
 * each juror its own credential privately; never log them. `registerObserver`
 * registers an extra agent (for example a test intruder) on the observer hub so
 * it can never pollute the clerk's DM stream.
 */
export async function connectBridge({ workspaceKey, baseUrl = DEFAULT_BASE_URL, caseId, jurorIds }) {
  if (!workspaceKey) throw new Error("workspaceKey is required");
  const relay = new AgentRelay({ workspaceKey, baseUrl });
  const observers = new AgentRelay({ workspaceKey, baseUrl });

  const clerk = await relay.workspace.register({ name: clerkAgentName(caseId), type: "agent" });
  relay[RECIPIENT] = { id: clerk.id, name: clerk.name };
  relay[OBSERVERS] = observers;

  const jurors = new Map();
  for (const jurorId of jurorIds) {
    const reg = await observers.workspace.register({ name: jurorAgentName(caseId, jurorId), type: "agent" });
    jurors.set(jurorId, { id: reg.id, name: reg.name, token: reg.token });
  }

  const tap = await observers.workspace.register({ name: tapAgentName(caseId), type: "agent" });

  const channels = caseChannels(caseId);
  for (const name of channels) {
    await clerk.channels.create({ name, topic: `Sealed Verdict ${caseId}` });
    await clerk.channels.join(name);
    await tap.channels.join(name);
  }

  const registerObserver = (suffix) => observers.workspace.register({ name: `sv-${caseId}-${suffix}`, type: "agent" });

  return { relay, observers, clerk, clerkId: clerk.id, clerkName: clerk.name, tapId: tap.id, jurors, channels, registerObserver };
}

/** Publish an object as JSON text to a channel. Returns `{ messageId }`. */
export async function publish(agent, channel, obj) {
  const text = JSON.stringify(obj);
  const sent = await agent.sendMessage({ to: `#${channel}`, text, idempotencyKey: randomUUID() });
  return { messageId: sent.messageId ?? sent.id, text };
}

function senderId(message, envelope) {
  return message?.from?.id ?? envelope?.from?.id ?? null;
}

function parseJson(text) {
  try {
    return { obj: JSON.parse(text) };
  } catch (err) {
    return { parseError: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Listen for messages on this case's public channels. The handler receives
 * `{ channel, kind, round, messageId, fromId, text, obj | parseError }`.
 * Subscribes on the given hub and on its linked observer hub (where the tap
 * lives), delivering each message id once. Returns an unsubscribe function.
 */
export function onChannelEnvelope(relay, caseId, handler) {
  const seen = new Set();
  const remember = (id) => {
    if (id == null) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 4096) seen.delete(seen.values().next().value);
    return true;
  };
  const listen = (hub) =>
    hub.addListener("message.created", (event) => {
      const { message, envelope } = event;
      const channel = envelope?.channel?.name ?? message?.channel?.name;
      const parsed = parseChannelName(caseId, channel);
      if (!parsed) return;
      const messageId = message?.messageId ?? message?.id;
      if (!remember(messageId)) return;
      const text = message?.text ?? "";
      handler({
        channel,
        kind: parsed.kind,
        round: parsed.round,
        messageId,
        fromId: senderId(message, envelope),
        text,
        ...parseJson(text),
      });
    });
  const offs = [listen(relay)];
  if (relay[OBSERVERS]) offs.push(listen(relay[OBSERVERS]));
  return () => offs.forEach((off) => off());
}

/**
 * Listen for direct messages to the bridge agent. The handler receives
 * `{ fromId, toId, messageId, text, obj | parseError }`. `fromId` is the
 * server-assigned sender id; `toId` is the authenticated recipient, known
 * only because the hub's sole registered agent is the clerk (see header).
 * DMs arriving on a hub without that single authenticated recipient are
 * dropped with one stderr line and never reach the handler.
 */
export function onDirectIntent(relay, handler) {
  const recipient = relay[RECIPIENT] ?? null;
  return relay.addListener("dm.received", (event) => {
    const { message, envelope } = event;
    const messageId = message?.messageId ?? message?.id;
    if (!recipient) {
      process.stderr.write(`[relay] dropped DM ${messageId}: no authenticated recipient\n`);
      return;
    }
    const text = message?.text ?? "";
    handler({
      fromId: senderId(message, envelope),
      toId: recipient.id,
      messageId,
      text,
      ...parseJson(text),
    });
  });
}

/**
 * Client for a process that holds only its own agent token (a juror).
 * `dm(toHandle, text)` sends a private message, `send(channel, text)` posts to
 * a public channel, `channels.join(name)` joins one.
 */
export function jurorClient({ agentToken, baseUrl = DEFAULT_BASE_URL }) {
  if (!agentToken) throw new Error("agentToken is required");
  return createAgentClient({ agentToken, baseUrl, autoHeartbeatMs: false });
}

/** Recent messages on a channel, as `{ messageId, fromId, text }`. */
export async function listChannelMessages(agent, channel, limit = 200) {
  const rows = await agent.messages.list(channel, { limit });
  return rows.map((m) => ({ messageId: m.messageId ?? m.id, fromId: m.from?.id ?? null, text: m.text ?? "" }));
}

/** Create a workspace on a server and return `{ relay, workspaceKey }`. */
export async function createWorkspace({ name, baseUrl = DEFAULT_BASE_URL }) {
  const relay = await AgentRelay.createWorkspace({ name, baseUrl });
  return { relay, workspaceKey: relay.workspaceKey };
}
