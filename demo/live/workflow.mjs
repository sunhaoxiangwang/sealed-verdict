import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runLiveCase } from "../../apps/actors/bridge/src/bridge.js";
import { jurorClient } from "../../apps/actors/bridge/src/relay.js";
import { sealIntent } from "../../apps/actors/bridge/src/intent-crypto.js";

export const panel = [
  { id: "juror-1", provider: "anthropic", role: "Typology analyst: assess cash placement and nominee accounts." },
  { id: "juror-2", provider: "openai", role: "Skeptic: test the strongest legitimate-business explanation." },
  { id: "juror-3", provider: "gemini", role: "Evidence reviewer: identify missing information and unsupported claims." },
  { id: "juror-4", provider: "anthropic", role: "Independent challenger: weigh escalation against the available evidence." },
];

export function callAgent(request, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || "python3", [fileURLToPath(new URL("../python/live_agent.py", import.meta.url))], {
      stdio: ["pipe", "pipe", "pipe"], signal, timeout: 180_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`${request.provider} agent failed: ${stderr.trim() || `exit ${code}`}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Python agent returned invalid JSON")); }
    });
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(request));
  });
}

export async function runWorkflow({ input, caseId, relay, terse, outDir, update, signal }) {
  const evidence = input.context.map((e, i) => ({ id: `ev-${i}`, ...e }));
  const ask = (provider, role, task, suffix, extra = {}) => callAgent({
    provider, role, task, question: input.question, evidence,
    requestId: `${caseId}/${suffix}`, ...extra,
  }, signal);
  update({ stage: "triage", text: "OpenAI is reviewing the published cash-network evidence." });
  const triage = await ask("openai", "L1 triage analyst", "Identify whether the alert needs investigation, with evidence citations.", "triage");
  update({ stage: "triage", result: triage });
  update({ stage: "investigation", text: "Gemini is testing the case and identifying records needed for an RFI." });
  const investigation = await ask("gemini", "Investigator", "Assess the activity and list missing RFI records. Do not invent an RFI response.", "investigation");
  update({ stage: "investigation", result: investigation });
  update({ stage: "panel", text: "Opening the C5 tribunal. Four independent jurors will commit, reveal, deliberate and vote again." });

  const result = await runLiveCase({
    caseId, condition: "C5", choices: input.choices,
    context: input.context.map(e => ({ source: `${input.source} :: ${e.source}`, content: e.content })),
    jurorIds: panel.map(j => j.id), timeoutMs: Number(process.env.AML_PHASE_TIMEOUT_MS || 90_000),
    closeOnComplete: true,
    relay, terse, outDir, signal,
    hooks: {
      async onPhase(next, ctx) {
        update({ stage: "panel", text: `${next.phase}, round ${next.round + 1}` });
        // Read what the Rust Clerk actually admitted and Terse persisted.
        const transcript = await terse.getTranscript(caseId);
        const attested = transcript.filter(e => e.kind === "evidence" && e.status === "accepted").map(e => ({
          id: e.msg.body.id, source: e.msg.body.source, content: e.msg.body.excerpt,
        }));
        if (attested.length !== evidence.length) throw new Error("Evidence was not fully admitted; refusing to run a partial case");
        await Promise.all(panel.map(async juror => {
          const identity = ctx.jurors.get(juror.id);
          const client = jurorClient({ agentToken: identity.token, baseUrl: relay.baseUrl });
          let intent;
          if (next.phase === "reveal") {
            intent = { kind: "reveal", round: next.round };
          } else {
            const args = next.phase === "commit" && next.round === 1
              ? transcript.filter(e => e.kind === "argument" && e.status === "accepted").map(e => e.msg.body) : undefined;
            const response = await callAgent({
              provider: juror.provider, role: juror.role, question: input.question, evidence: attested,
              task: next.phase === "deliberate" ? "Present your own evidence-based argument for peer review." : "Cast your independent ballot. Only use admitted evidence; peer claims are not new evidence.",
              requestId: `${caseId}/${juror.id}/${next.phase}/${next.round}`, ...(args ? { arguments: args } : {}),
            }, signal);
            // Never expose a blind ballot in HTTP status or logs before its reveal.
            update({ stage: "panel", text: `${juror.id}: ${response.provider}/${response.model} responded`, provider: response.provider, model: response.model });
            intent = next.phase === "commit"
              ? { kind: "commit", round: next.round, vote: response.answer, confidence: response.confidence }
              : { kind: "argument", round: 0, text: response.reason, evidenceIds: response.evidenceIds };
          }
          if (signal.aborted) throw new Error("case cancelled");
          await client.dm(ctx.clerkName, JSON.stringify(sealIntent({
            recipientPublicKeyHex: ctx.recipientPublicKey, caseId, senderId: identity.id, intent,
          })));
        }));
      },
    },
  });
  if (result.cert.cert.body.quorum.counted !== 4) throw new Error("Incomplete live panel: not all four final reveals were admitted");
  update({ stage: "human_review", text: `Panel recommendation: ${result.cert.cert.body.verdict}. Human compliance review is pending; no SAR has been filed.` });
  return result;
}
