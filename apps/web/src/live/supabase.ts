import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Conclusion, Condition, Phase, TribunalEvent, Verdict } from "../protocol/types";
import { useTribunal, type Juror, type TribunalStore } from "../store/tribunal";

// Live data source. Contract: see src/contracts.md.
// Everything here is inert unless VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both set.

export type EventRow = {
  id?: string | number;
  case_id?: string;
  ts?: number | string;
  type: string;
  payload: any;
  verified: boolean;
};

export type CaseSummary = { id: string; claim: string; condition: string; created_at: string };

const STANCES = ["true", "false", "uncertain"] as const;
const PHASES: Phase[] = ["idle", "attest", "commit", "reveal", "deliberate", "verdict"];

export function hasLiveConfig(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

let client: SupabaseClient | null | undefined;

// Lazily created; null when the env vars are missing.
export function getClient(): SupabaseClient | null {
  if (client === undefined) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    client = url && key ? createClient(url, key) : null;
  }
  return client;
}

const unknownSeen = new Set<string>();

const DEFAULT_QUORUM_RULE = "3 of 4 sealed votes are needed. The rule tolerates one faulty or dishonest juror.";

// Fills defaults on a live conclusion body so the UI can always render it (see contracts.md, "conclusion").
export function normalizeConclusion(raw: any, fallbackCaseId?: unknown): Conclusion {
  const body = raw && typeof raw === "object" ? raw : {};
  const verdict: Verdict = STANCES.includes(body.verdict) ? body.verdict : "uncertain";
  const votes: Conclusion["votes"] = Array.isArray(body.votes)
    ? body.votes.map((v: any) => ({
        juror: String(v?.juror ?? ""),
        persona: String(v?.persona ?? "juror"),
        vote: STANCES.includes(v?.vote) ? v.vote : "uncertain",
        confidence: Number.isFinite(Number(v?.confidence)) ? Number(v.confidence) : 0,
      }))
    : [];
  const q = /^(\d+)\s*\/\s*(\d+)$/.exec(String(body.quorum ?? ""));
  const total = Number.isFinite(Number(body.total)) && Number(body.total) > 0 ? Number(body.total) : votes.length || (q ? Number(q[2]) : 4);
  const agree = Number.isFinite(Number(body.agree)) ? Number(body.agree) : votes.length ? votes.filter((v) => v.vote === verdict).length : q ? Number(q[1]) : 0;
  const f = Math.floor((total - 1) / 3); // Byzantine faults tolerated
  const needed = Number.isFinite(Number(body.needed)) && Number(body.needed) > 0 ? Number(body.needed) : 2 * f + 1;
  return {
    ...body,
    caseId: String(body.caseId ?? fallbackCaseId ?? ""),
    claim: String(body.claim ?? ""),
    verdict,
    headline: String(body.headline ?? ""),
    summary: String(body.summary ?? ""),
    confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0,
    quorum: String(body.quorum ?? `${agree}/${total}`),
    why: String(body.why ?? body.summary ?? ""),
    ...(typeof body.wouldChange === "string" && body.wouldChange ? { wouldChange: body.wouldChange } : {}),
    votes,
    agree,
    total,
    needed,
    quorumRule: typeof body.quorumRule === "string" && body.quorumRule ? body.quorumRule : total === 4 ? DEFAULT_QUORUM_RULE : `${needed} of ${total} sealed votes are needed. The rule tolerates ${f} faulty or dishonest ${f === 1 ? "juror" : "jurors"}.`,
    reasons: Array.isArray(body.reasons) ? body.reasons : [],
    dissent: Array.isArray(body.dissent) ? body.dissent : [],
    excluded: Array.isArray(body.excluded) ? body.excluded : [],
    simulated: Boolean(body.simulated),
  };
}

// Maps one events row to a TribunalEvent. Unknown types return null (logged once).
export function rowToEvent(row: EventRow): TribunalEvent | null {
  const p = row.payload ?? {};
  const verified = Boolean(row.verified);
  switch (row.type) {
    case "evidence":
      return { type: "evidence", msg: p, verified };
    case "commit":
      return { type: "commit", msg: p, verified };
    case "reveal":
      return { type: "reveal", msg: p, verified };
    case "verdict":
      return { type: "verdict", msg: p, verified };
    case "conclusion": {
      // Accepts Signed<Conclusion> or a bare Conclusion body (then marked unsigned).
      const signedMsg = p && typeof p === "object" && "body" in p ? p : { body: p, sig: "", signer: "unsigned" };
      return { type: "conclusion", msg: { ...signedMsg, body: normalizeConclusion(signedMsg.body, row.case_id) }, verified };
    }
    case "argument":
      return {
        type: "argument",
        msg: p,
        verified,
        unattested: p.unattested ?? (p.body?.evidenceIds?.length ?? 0) === 0,
        ...(STANCES.includes(p.stance) ? { stance: p.stance } : {}),
      };
    case "phase":
      return {
        type: "phase",
        msg: { caseId: String(row.case_id ?? ""), phase: (PHASES.includes(p.phase) ? p.phase : "idle") as Phase },
      };
    case "system":
      return {
        type: "system",
        text: String(p.text ?? ""),
        level: p.level === "warn" || p.level === "error" ? p.level : "info",
      };
    default:
      if (!unknownSeen.has(row.type)) {
        unknownSeen.add(row.type);
        console.warn(`[live] unknown event type "${row.type}" skipped`);
      }
      return null;
  }
}

const rowId = (r: EventRow): string | undefined => (r.id === undefined || r.id === null ? undefined : String(r.id));

const asCondition = (c: unknown): Condition => (typeof c === "string" && /^C[0-5]$/.test(c) ? (c as Condition) : "C5");

const mkJuror = (name: string, extra: Partial<Juror> = {}): Juror => ({
  id: name,
  pseudonym: name,
  persona: "juror",
  model: "unknown",
  byzantine: false,
  committed: false,
  revealed: false,
  speaking: false,
  ...extra,
});

// Jurors come from cases.jurors when present; otherwise four placeholders from distinct juror names in events.
function jurorsFrom(caseRow: any, events: TribunalEvent[]): Juror[] {
  if (Array.isArray(caseRow?.jurors)) {
    return caseRow.jurors.map((j: any) =>
      mkJuror(String(j.id ?? j.pseudonym), {
        pseudonym: String(j.pseudonym ?? j.id),
        persona: j.persona ?? "juror",
        model: j.model ?? "unknown",
        byzantine: Boolean(j.byzantine),
      }),
    );
  }
  const names: string[] = [];
  for (const e of events) {
    if (e.type === "commit" || e.type === "reveal" || e.type === "argument") {
      const name = e.msg.body.juror;
      if (name && !names.includes(name)) names.push(name);
    }
  }
  for (let i = names.length; i < 4; i++) names.push(`juror-${i + 1}`);
  return names.slice(0, 4).map((n) => mkJuror(n));
}

// Loads the case and its events into the store, then streams new events.
// Realtime and broadcast events that arrive during the initial load are queued and applied after it.
export function subscribeCase(caseId: string, store: TribunalStore = useTribunal): () => void {
  const c = getClient();
  if (!c) {
    console.warn("[live] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set; not subscribing");
    return () => {};
  }

  let closed = false;
  let ready = false;
  const delivered = new Set<string>();
  let pending: { id?: string; event: TribunalEvent }[] = [];

  const deliver = (id: string | undefined, event: TribunalEvent) => {
    if (closed) return;
    if (id !== undefined) {
      if (delivered.has(id)) return;
      delivered.add(id);
    }
    if (ready) store.getState().applyEvent(event);
    else pending.push({ id, event });
  };

  const channel = c
    .channel(`case:${caseId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "events", filter: `case_id=eq.${caseId}` },
      (change) => {
        const row = change.new as EventRow;
        const event = rowToEvent(row);
        if (event) deliver(rowId(row), event);
      },
    )
    .on("broadcast", { event: "tribunal" }, ({ payload }) => {
      const ev = payload as TribunalEvent | undefined;
      if (ev && ev.type === "conclusion" && ev.msg) deliver(undefined, { ...ev, msg: { ...ev.msg, body: normalizeConclusion(ev.msg.body, ev.msg.body?.caseId ?? caseId) } });
      else if (ev && typeof ev.type === "string") deliver(undefined, ev);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        store.getState().applyEvent({ type: "system", text: `live channel ${status.toLowerCase()}`, level: "warn" });
      }
    });

  const load = async () => {
    const [caseRes, eventsRes] = await Promise.all([
      c.from("cases").select("*").eq("id", caseId).maybeSingle(),
      c.from("events").select("*").eq("case_id", caseId).order("ts", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (caseRes.error) throw new Error(caseRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (closed) return;
    const caseRow = caseRes.data;
    if (!caseRow) throw new Error(`no case with id ${caseId}`);

    const rows = (eventsRes.data ?? []) as EventRow[];
    const fetchedIds = new Set(rows.map(rowId).filter((x): x is string => x !== undefined));
    const fromFetch = rows.flatMap((r) => {
      const e = rowToEvent(r);
      return e ? [e] : [];
    });
    const fromLive = pending.filter((p) => !(p.id !== undefined && fetchedIds.has(p.id))).map((p) => p.event);
    const all = [...fromFetch, ...fromLive];

    store.getState().setCase({
      caseId,
      claim: String(caseRow.claim ?? ""),
      condition: asCondition(caseRow.condition),
      jurors: jurorsFrom(caseRow, all),
    });
    fetchedIds.forEach((id) => delivered.add(id));
    for (const e of all) store.getState().applyEvent(e);
    pending = [];
    ready = true;
  };

  load().catch((err: unknown) => {
    if (closed) return;
    const msg = err instanceof Error ? err.message : String(err);
    store.getState().applyEvent({ type: "system", text: `live load failed: ${msg}`, level: "error" });
  });

  return () => {
    closed = true;
    pending = [];
    void c.removeChannel(channel);
  };
}

// Most recent cases first. Returns [] when live config is missing; throws on query errors.
export async function listRecentCases(limit = 10): Promise<CaseSummary[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("cases")
    .select("id, claim, condition, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CaseSummary[];
}
