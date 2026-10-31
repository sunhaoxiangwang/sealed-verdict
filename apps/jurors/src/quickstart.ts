// Agent Relay quickstart: four jurors talk on one case channel, then we probe whether channels restrict reads.
//   npm run quickstart
import { connect, history, post, register, retry, sleep } from "./relay.js";

const run = Date.now().toString(36);
const channel = `case-qs-${run}`;
const relay = await connect();

const clerk = await register(relay, `clerk-${run}`);
const jurors = await Promise.all(["a", "b", "c", "d"].map((j) => register(relay, `juror-${j}-${run}`)));

const pushed = new Set<string>();
relay.addListener("message.created", ({ message, envelope }) => {
  if (envelope.channel?.name === channel) pushed.add(message.messageId);
});

await retry(() => clerk.channels.create({ name: channel, topic: "Quickstart case: who struggled with the phone?" }));
await Promise.all(jurors.map((j) => retry(() => j.channels.join(channel))));
await post(clerk, channel, "Case open. Each juror: state your initial view.");

// Round 1: opening statements.
await Promise.all(jurors.map((j) => post(j, channel, `[r1] ${j.name}: my initial vote is "cannot be determined".`, { round: 1 })));
await sleep(1500);

// Round 2: each juror reads the channel itself and responds to what the others said.
const heard: Record<string, string[]> = {};
for (const j of jurors) {
  const msgs = await history(j, channel);
  heard[j.name] = [...new Set(msgs.filter((m) => m.metadata?.round === 1 && m.from?.name !== j.name).map((m) => m.from?.name ?? "?"))];
  await post(j, channel, `[r2] ${j.name}: I read openings from ${heard[j.name].join(", ")}. Holding my vote.`, { round: 2 });
}
await sleep(1500);

// Permission probe: an agent that never joined the channel.
const outsider = await register(relay, `outsider-${run}`);
const probe = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const r = await retry(fn, 4);
    return `${label}: ALLOWED${Array.isArray(r) ? ` (${r.length} items)` : ""}`;
  } catch (e: any) {
    return `${label}: DENIED (${e?.rawCode ?? e?.code ?? e?.status ?? ""}: ${String(e?.message ?? e).slice(0, 120)})`;
  }
};
const checks = [
  await probe("non-member reads channel history", () => outsider.messages.list(channel, { limit: 50 })),
  await probe("non-member lists channel members", () => outsider.channels.members(channel)),
  await probe("non-member posts to channel", () => post(outsider, channel, "[probe] outsider posting without joining")),
  await probe("member leaves, then reads history", async () => {
    await jurors[3].channels.leave(channel);
    return jurors[3].messages.list(channel, { limit: 50 });
  }),
];
await sleep(1000);

const members = await retry(() => clerk.channels.members(channel));
const all = await history(clerk, channel);
console.log(`\nworkspace channel: #${channel}`);
console.log(`members: ${members.map((m) => `${m.agentName}(${m.role})`).join(", ")}`);
console.log(`messages on channel: ${all.length}; pushed to listener: ${pushed.size}`);
for (const j of jurors) console.log(`  ${j.name} read openings from ${heard[j.name].length}/3 other jurors`);
const talked = jurors.every((j) => heard[j.name].length === 3);
console.log(`\nFOUR AGENTS TALKING: ${talked ? "PASS" : "FAIL"}`);
console.log("PERMISSION PROBE:");
for (const c of checks) console.log(`  ${c}`);
process.exit(talked ? 0 : 1);
