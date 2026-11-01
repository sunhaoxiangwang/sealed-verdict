import type { Argument, CaseInput, Commit, Conclusion, Evidence, Phase, Reveal, Signed, TribunalEvent, Verdict, VerdictCert } from "../protocol/types";
import type { Juror } from "../store/tribunal";
import { GENESIS, canonical, chainHash, genKeypair, sha256hex, sign } from "../protocol/crypto";
import { JURORS } from "./scenario";

// In-browser mock engine: turns a submitted case into a signed, replayable tribunal script.
// Same four jurors as the scripted scenario, real ed25519 signatures, real hash chain and transcript root,
// so the Certificate page's Verify passes and the forged-evidence / tamper attacks still apply.

export type ScriptStep = { at: number; event: TribunalEvent };
export type CaseScript = {
  caseId: string;
  claim: string;
  condition: "C2" | "C5";
  jurors: Juror[];
  keys: Record<string, string>; // public-key registry for every signer in the script
  events: ScriptStep[];
  conclusion: Conclusion;
};

export const ORACLE_ID = "oracle-01";
export const LEDGER_ID = "ledger-01";
export const CLERK_ID = "clerk-01"; // signs the plain-English conclusion

export const CLAIM_MIN = 10;
export const CLAIM_MAX = 600;
export const MAX_URLS = 5;

const PRIV: Record<string, Uint8Array> = {};
const PUB: Record<string, string> = {};
for (const id of [...JURORS.map((j) => j.pseudonym), ORACLE_ID, LEDGER_ID, CLERK_ID]) {
  const kp = genKeypair();
  PRIV[id] = kp.priv;
  PUB[id] = kp.pub;
}
export const CLERK_PUB = PUB[CLERK_ID];

export const signConclusion = (body: Conclusion): Signed<Conclusion> => sign(body, PRIV[CLERK_ID], CLERK_ID);

export const newCaseId = (claim: string): string => `case-${sha256hex(`${claim}:${Date.now()}:${Math.random()}`).slice(0, 10)}`;

// Trims and validates a submission. Throws an Error with a user-facing message.
export function validateCaseInput(input: CaseInput): CaseInput {
  const claim = (input?.claim ?? "").trim();
  if (claim.length < CLAIM_MIN) throw new Error(`The claim is too short: write at least ${CLAIM_MIN} characters.`);
  if (claim.length > CLAIM_MAX) throw new Error(`The claim is too long: keep it under ${CLAIM_MAX} characters.`);
  const context = (input.context ?? "").trim() || undefined;
  const urls: string[] = [];
  for (const raw of input.evidenceUrls ?? []) {
    const u = (raw ?? "").trim();
    if (!u) continue;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`Not a valid URL: ${u}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Only http(s) links can be attested: ${u}`);
    if (!urls.includes(parsed.href)) urls.push(parsed.href);
  }
  if (urls.length > MAX_URLS) throw new Error(`At most ${MAX_URLS} evidence links per case.`);
  const condition = input.condition === "C2" ? "C2" : "C5";
  return { claim, context, evidenceUrls: urls, condition };
}

// ---------- text helpers ----------

const LOWER_OK = new Set(["the", "a", "an", "this", "that", "these", "those", "there", "it", "its", "our", "my", "we", "they", "he", "she", "his", "her", "their", "some", "all", "most", "no", "every", "who", "which", "whose", "why", "what", "how", "did", "does", "do", "is", "was", "are", "were", "can", "will", "has", "have"]);

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

const lowerFirst = (s: string): string => {
  const w = s.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
  return LOWER_OK.has(w) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
};
// Adds a full stop unless the text already ends a sentence (including a closing quoted question).
const endSentence = (s: string): string => s.replace(/(\?”|[.!?])\.$/, "$1").replace(/([^.!?”])$/, "$1.");
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const stripEnd = (s: string): string => s.replace(/[\s.!?;:,]+$/, "");

const list = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const NUM = ["no", "one", "two", "three", "four", "five"];
const num = (n: number) => NUM[n] ?? String(n);

const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

type Analysis = {
  question: boolean; // the claim contains a question
  open: boolean; // who / which / whose / why question
  blame: boolean; // blame or causation language
  negation: boolean;
  questionText: string; // the question sentence, as written
  subject: string; // "who caused the outage"
  core: string; // statement paraphrase, "the server crashed at noon"
  topic: string; // short form for arguments
  topicThat: string; // "who caused the outage" | "that the server crashed" | "“Coffee causes…”"
  prop: string; // "who caused the outage" | "that the server crashed" | "whether ..." etc.
  quoted: boolean; // open question kept in quotes because it is inverted ("Why did ...?")
  shows: string; // verb for the open subject: "shows" | "answers"
};

function analyse(claim: string): Analysis {
  const text = claim.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const qs = sentences.filter((s) => /\?\s*$/.test(s) || /^(who|which|whose|why)\b/i.test(s));
  const questionText = qs.at(-1) ?? "";
  const question = questionText.length > 0;
  const open = /\b(who|which|whose|why)\b/i.test(questionText);
  const blame = /\b(caus(e|ed|es|ing)|fault|blame[ds]?|responsible|led to|due to|because|triggered|to blame)\b/i.test(text);
  const negation = /\b(did not|didn't|never|isn't|is not|was not|wasn't|does not|doesn't|do not|don't|are not|aren't|has not|hasn't|have not|haven't|cannot|can't|won't|no longer|not)\b/i.test(text);
  // "Who caused the outage?" reads as a clause; "Why did the bridge fall?" does not, so it stays quoted.
  const quoted = open && /^(why|how|what|when|where|which|whose|who)\s+(did|does|do|is|was|are|were|has|have|had|can|could|will|would|should)\b/i.test(questionText) && !/^(who|which)\s+(is|was|are|were|has|have|had)\b/i.test(questionText);
  const subject = quoted ? `“${clip(stripEnd(questionText), 88)}?”` : clip(lowerFirst(stripEnd(questionText)), 90);
  const statement = sentences.find((s) => !qs.includes(s)) ?? sentences[0] ?? text;
  const rawCore = stripEnd(question && !open ? questionText : statement);
  const lowered = lowerFirst(rawCore) !== rawCore || /^[a-z]/.test(rawCore);
  const core = clip(lowerFirst(rawCore), 100);
  const topic = open ? (quoted ? `“${clip(stripEnd(questionText), 58)}?”` : clip(subject, 60)) : clip(core, 60);
  // "that X" reads well when X starts with a common word; otherwise quote it so a name keeps its capital.
  const that = (x: string) => (lowered ? `that ${x}` : `“${x}”`);
  const topicThat = open ? topic : that(topic);
  const prop = open ? subject : question ? `the answer to “${clip(questionText, 90)}”` : that(core);
  return { question, open, blame, negation, questionText, subject, core, topic, topicThat, prop, quoted, shows: quoted ? "answers" : "shows" };
}

function seededRng(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------- verdict logic ----------

// Quorum: n = 4 jurors tolerate f = 1 faulty or dishonest juror, so 2f + 1 = 3 matching sealed votes are needed.
export const TOTAL_JURORS = 4;
export const QUORUM_NEEDED = 3;
export const QUORUM_RULE = "3 of 4 sealed votes are needed. The rule tolerates one faulty or dishonest juror.";

type Stance = "supports" | "contradicts" | "irrelevant";

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "from", "into", "onto", "about", "than", "then", "there", "their", "they",
  "was", "were", "are", "is", "been", "being", "has", "have", "had", "did", "does", "not", "never", "didn", "doesn", "isn", "wasn", "aren",
  "hasn", "haven", "won", "can", "cannot", "longer", "who", "which", "whose", "why", "what", "how", "when", "where", "will", "would",
  "https", "http", "www", "com", "org", "net", "html", "htm", "php", "aspx", "index", "amp",
]);
// Synonym groups, keyed by stem, so "incidents" matches "outage" and "deploys" matches "release".
const SYN: Record<string, string> = Object.fromEntries(
  Object.entries({
    outage: ["outag", "incident", "crash", "downtim", "failur", "down"],
    deploy: ["deploy", "deployment", "releas", "rollout", "push", "ship", "shipp"],
    cause: ["caus", "becaus", "due", "trigger"],
    server: ["server", "host", "machin", "node"],
    engineer: ["engineer", "developer", "dev", "ops", "sre"],
    nurse: ["nurs", "clinician"],
  }).flatMap(([canon, words]) => words.map((w) => [w, canon])),
);
// Lowercase content-word stems mapped to a canonical synonym, so "caused"/"cause" and "incidents"/"outage" compare equal.
const stems = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^[0-9]+$/.test(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|e|s)$/, "") : w))
    .map((w) => SYN[w] ?? w);

// The claim with negation removed, so a claim and its denial give each URL the same underlying stance.
const claimKey = (claim: string): string => [...new Set(stems(claim))].sort().join(" ");

function urlStems(u: string): string[] {
  try {
    const p = new URL(u);
    return stems(`${p.host} ${decodeURIComponent(p.pathname)}`);
  } catch {
    return stems(u);
  }
}

const EXCERPTS: Record<Stance, string[]> = {
  supports: ["this source supports the claim's timeline.", "this source records the events the claim describes.", "this source corroborates the claim's central assertion."],
  contradicts: ["this source contradicts the claim's timeline.", "this source records events that conflict with the claim.", "this source disputes the claim's central assertion."],
  irrelevant: ["this source was fetched but does not address the claim.", "this source is on record but off-topic for the claim.", "this source mentions neither side of the claim."],
};

// Deterministic stance from sha256(url + claim). On-topic sources (shared words) almost always support: one shared word 88%, two or more always; off-topic 45/35/20.
// Word overlap between the URL's host/path and the claim makes "supports" likelier. A negated claim flips the stance.
function stanceFor(url: string, claim: string, negation: boolean): { stance: Stance; overlap: number; excerpt: string } {
  const h = sha256hex(`${url}|${claimKey(claim)}`);
  const x = parseInt(h.slice(0, 8), 16) / 0x100000000;
  const claimSet = new Set(stems(claim));
  const overlap = new Set(urlStems(url).filter((w) => claimSet.has(w))).size;
  // Two or more shared words mark the source as on-topic: it always supports. One shared word nudges toward supports.
  const [pS, pC] = overlap >= 2 ? [1, 0] : overlap === 1 ? [0.88, 0.08] : [0.45, 0.35];
  let stance: Stance = x < pS ? "supports" : x < pS + pC ? "contradicts" : "irrelevant";
  if (negation && stance !== "irrelevant") stance = stance === "supports" ? "contradicts" : "supports";
  const pick = EXCERPTS[stance][parseInt(h.slice(8, 10), 16) % 3];
  return { stance, overlap, excerpt: `Simulated attestation of ${hostOf(url)}: ${pick}` };
}

// BBQ-style question that asks to pin blame on a person by identity ("who ... the engineer or the nurse").
function identityBlame(text: string, a: Analysis): { p1: string; p2: string; act: string } | null {
  if (!a.question || !/\b(who|whose)\b/i.test(a.questionText)) return null;
  if (!a.blame && !/\b(did it|at fault|guilty)\b/i.test(text)) return null;
  const m = /\b(?:a|an|the)\s+((?:[a-z-]+\s+)?[a-z-]+)\s+(?:and|or)\s+(?:a|an|the)\s+([a-z-]+)/i.exec(text);
  if (!m) return null;
  const act = /\bwho\s+(.+?)[\s?.!]*$/i.exec(a.questionText)?.[1] ?? "caused it";
  return { p1: `the ${m[1].toLowerCase()}`, p2: `the ${m[2].toLowerCase()}`, act };
}

const opposite = (v: Verdict): Verdict => (v === "true" ? "false" : v === "false" ? "true" : "uncertain");
const verbs = (xs: string[], one: string, many: string) => `${list(xs)} ${xs.length === 1 ? one : many}`;
const supportVerb = (xs: string[]) => verbs(xs, "supports", "support");
const contradictVerb = (xs: string[]) => verbs(xs, "contradicts", "contradict");

function tallyText(votes: { vote: Verdict }[]): string {
  const counts = new Map<Verdict, number>();
  for (const v of votes) counts.set(v.vote, (counts.get(v.vote) ?? 0) + 1);
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([v, c]) => `${c} ${v}`)
    .join(", ");
}

// ---------- script builder ----------

export async function buildCaseScript(input: CaseInput): Promise<CaseScript> {
  const clean = validateCaseInput(input);
  const { claim, condition, evidenceUrls, context } = clean;
  const caseId = newCaseId(claim);
  const rng = seededRng(sha256hex(claim));
  const a = analyse(claim);
  const T0 = Date.now();
  const jurors = JURORS.map((j) => ({ ...j }));
  const [W, S, D, R] = jurors.map((j) => j.pseudonym); // skeptic, domain expert, devil's advocate, statistician

  // Chain state, mirroring the store and audit: root over accepted message bodies, head over arguments.
  let root = GENESIS;
  let head = GENESIS;
  const revealSigs: Record<string, string> = {};
  const lastArgSig: Record<string, string> = {};
  const steps: ScriptStep[] = [];

  const signed = <T>(signer: string, body: T): Signed<T> => {
    const m = sign(body, PRIV[signer], signer);
    root = chainHash(root, body);
    return m;
  };
  const phase = (at: number, p: Phase) => steps.push({ at, event: { type: "phase", msg: { caseId, phase: p } } });
  const sys = (at: number, text: string, level: "info" | "warn" | "error" = "info") => steps.push({ at, event: { type: "system", text, level } });
  const commit = (at: number, juror: string, vote: Verdict, confidence: number) => {
    const nonce = sha256hex(`nonce:${caseId}:${juror}`).slice(0, 16);
    const commitment = sha256hex(canonical({ caseId, round: 1, juror, vote, confidence, nonce }));
    const body: Commit = { caseId, round: 1, juror, commitment };
    steps.push({ at, event: { type: "commit", msg: signed(juror, body), verified: true } });
    return nonce;
  };
  const reveal = (at: number, juror: string, vote: Verdict, confidence: number, nonce: string) => {
    const body: Reveal = { caseId, round: 1, juror, vote, confidence, nonce };
    const msg = signed(juror, body);
    revealSigs[juror] = msg.sig;
    steps.push({ at, event: { type: "reveal", msg, verified: true } });
  };
  const argue = (at: number, juror: string, round: number, text: string, evidenceIds: string[], stance?: Verdict) => {
    const body: Argument = { caseId, round, juror, text: clip(text, 160), evidenceIds, prevHash: head };
    head = chainHash(head, body);
    const msg = signed(juror, body);
    lastArgSig[juror] = msg.sig;
    steps.push({ at, event: { type: "argument", msg, verified: true, unattested: false, ...(stance ? { stance } : {}) } });
  };
  const verdict = (at: number, cert: Pick<VerdictCert, "verdict" | "quorum" | "evidenceIds">) => {
    const body: VerdictCert = {
      caseId,
      ...cert,
      transcriptRoot: root,
      voterSigs: jurors.map((j) => revealSigs[j.pseudonym] ?? lastArgSig[j.pseudonym] ?? ""),
    };
    steps.push({ at, event: { type: "verdict", msg: sign(body, PRIV[LEDGER_ID], LEDGER_ID), verified: true } });
  };

  const persona = (id: string) => jurors.find((j) => j.pseudonym === id)?.persona ?? "juror";
  const n = evidenceUrls.length;
  let conclusion: Conclusion;

  if (condition === "C5") {
    // ----- attest -----
    phase(0, "attest");
    if (context) sys(400, `Context from the submitter: ${clip(context, 200)}`);
    const ids: string[] = [];
    const sup: string[] = [];
    const con: string[] = [];
    const irr: string[] = [];
    evidenceUrls.forEach((url, i) => {
      const id = `e${i + 1}`;
      ids.push(id);
      const { stance, excerpt } = stanceFor(url, claim, a.negation);
      (stance === "supports" ? sup : stance === "contradicts" ? con : irr).push(id);
      const body: Evidence = { id, caseId, kind: "fetch", source: url, contentHash: sha256hex(url + claim), excerpt, ts: T0 + 800 + i * 1100 };
      steps.push({ at: 800 + i * 1100, event: { type: "evidence", msg: signed(ORACLE_ID, body), verified: true } });
    });
    sys(
      6200,
      n === 0
        ? "No evidence links were submitted. Nothing is attested; the jurors can only weigh the claim's wording."
        : `Oracle attestation: ${list(ids)} signed by ${ORACLE_ID}.${irr.length ? ` ${verbs(irr, "does", "do")} not address the claim.` : ""}`,
      n === 0 ? "warn" : "info",
    );

    // ----- how the evidence leans -----
    const bbq = identityBlame(claim, a);
    const basis: "bbq" | "none" | "tie" | "evidence" = bbq ? "bbq" : sup.length + con.length === 0 ? "none" : sup.length === con.length ? "tie" : "evidence";
    const lean: Verdict = basis === "evidence" ? (sup.length > con.length ? "true" : "false") : "uncertain";
    const win = lean === "false" ? con : sup;
    const lose = lean === "false" ? sup : con;
    const winVerb = (xs: string[]) => (lean === "false" ? contradictVerb(xs) : supportVerb(xs));
    const loseVerb = (xs: string[]) => (lean === "false" ? supportVerb(xs) : contradictVerb(xs));
    const ratio = basis === "evidence" ? (win.length - lose.length) / (win.length + lose.length) : 0;
    const strong = () => r2(Math.min(0.95, 0.62 + 0.28 * ratio + rng() * 0.06));
    const unsure = () => r2(0.55 + rng() * 0.2);

    // ----- sealed votes follow the evidence, each juror by their own standard -----
    const votes: Record<string, { vote: Verdict; conf: number }> = {};
    if (basis === "evidence") {
      votes[S] = { vote: lean, conf: strong() }; // domain expert: goes with the weight of attested evidence
      votes[R] = ratio >= 0.3 ? { vote: lean, conf: strong() } : { vote: "uncertain", conf: unsure() }; // statistician: needs a clear margin
      votes[W] = win.length >= 2 ? { vote: lean, conf: strong() } : { vote: "uncertain", conf: unsure() }; // skeptic: needs two independent sources
      votes[D] = lose.length > 0 ? { vote: opposite(lean), conf: r2(0.55 + rng() * 0.15) } : win.length === 1 && rng() < 0.35 ? { vote: "uncertain", conf: unsure() } : { vote: lean, conf: strong() };
    } else {
      for (const j of [W, S, R]) votes[j] = { vote: "uncertain", conf: unsure() };
      const dVote: Verdict = basis === "none" ? (a.negation ? "true" : "false") : basis === "tie" ? (rng() < 0.5 ? "true" : "false") : "false";
      votes[D] = { vote: dVote, conf: r2(0.6 + rng() * 0.2) };
    }
    const order = [W, S, D, R];
    const voteList = order.map((j) => ({ juror: j, persona: persona(j), vote: votes[j].vote, confidence: votes[j].conf }));
    const counts = (v: Verdict) => voteList.filter((x) => x.vote === v).length;
    const top = (["uncertain", "true", "false"] as Verdict[]).reduce((best, v) => (counts(v) > counts(best) ? v : best), "uncertain" as Verdict);
    const noQuorum = counts(top) < QUORUM_NEEDED;
    const final: Verdict = noQuorum ? "uncertain" : top;
    const agree = counts(final);
    const quorum = `${agree}/${TOTAL_JURORS}`;
    const agreeing = order.filter((j) => votes[j].vote === final);
    const dissenters = order.filter((j) => votes[j].vote !== final);
    const confidence = r2(Math.min(0.95, Math.max(0.5, agreeing.reduce((s, j) => s + votes[j].conf, 0) / Math.max(1, agreeing.length) - (noQuorum ? 0.1 : 0))));
    const tally = tallyText(voteList);
    const leanCount = counts(lean);

    // ----- commit / reveal -----
    phase(7000, "commit");
    const nonces: Record<string, string> = {};
    order.forEach((j, i) => (nonces[j] = commit(8000 + i * 1000, j, votes[j].vote, votes[j].conf)));
    phase(12500, "reveal");
    order.forEach((j, i) => reveal(13500 + i * 1000, j, votes[j].vote, votes[j].conf, nonces[j]));
    sys(17600, `Sealed votes revealed: ${tally}. ${QUORUM_NEEDED} matching votes are needed for a verdict.`);

    // ----- deliberate: each juror explains the vote they already sealed -----
    phase(18000, "deliberate");
    const p1 = bbq?.p1 ?? "";
    const p2 = bbq?.p2 ?? "";
    const lines: Record<string, () => [string, string[]]> = {
      [W]: () => {
        const v = votes[W].vote;
        if (basis === "evidence")
          return v === lean
            ? [`I count only oracle-signed items: ${winVerb(win)} the claim. That is ${num(win.length)} independent sources. I vote ${lean}.`, win]
            : [`Only ${winVerb(win)} the claim. One source is not independent confirmation, so I vote uncertain.`, win];
        if (basis === "tie") return [`${list(sup)} and ${list(con)} point opposite ways. I will not pick a side the record does not pick. Uncertain.`, [...sup, ...con]];
        if (basis === "bbq") return [`Nothing signed places ${p1} or ${p2} at the system. Naming either would be a guess. I vote uncertain.`, []];
        return n === 0
          ? ["Nothing was attested, so the claim rests on its wording, and wording is not evidence. I vote uncertain.", []]
          : [`${verbs(irr, "is", "are")} signed but off-topic. Nothing on the record bears on the claim. I vote uncertain.`, irr];
      },
      [S]: () => {
        if (basis === "evidence")
          return [`${winVerb(win)} the claim directly${lose.length ? `, and outnumber${win.length === 1 ? "s" : ""} ${list(lose)}` : ""}. In my field that is enough: I vote ${lean}.`, win];
        if (basis === "tie") return [`Both sides have attested support: ${list(sup)} against ${list(con)}. The record does not settle it. Uncertain.`, [...sup, ...con]];
        if (basis === "bbq")
          return ids.length
            ? [`${list(ids.slice(0, 2))} describe${ids.length === 1 ? "s" : ""} the system, not ${p1} or ${p2}. Nothing ties either person to the cause. Uncertain.`, ids.slice(0, 2)]
            : ["Blame needs a record tying a person to the cause. None was submitted. I vote uncertain.", []];
        return n === 0
          ? ["A claim like this needs a log, record or primary source. None was submitted, so I vote uncertain.", []]
          : ["None of the attested sources speaks to the claim. Without one I vote uncertain.", []];
      },
      [D]: () => {
        const v = votes[D].vote;
        if (basis === "evidence") {
          if (v === opposite(lean)) return [`Devil's advocate: ${loseVerb(lose)} the claim. That is enough doubt for me to vote ${v}.`, lose];
          if (v === "uncertain") return ["Devil's advocate: one source is a thin record. I hold uncertain until more is attested.", []];
          return [`Devil's advocate: I tried the opposite reading and nothing attested supports it. I vote ${lean}.`, []];
        }
        if (basis === "tie") {
          const side = v === "true" ? sup : con;
          return [`Devil's advocate: someone has to break the tie. I give ${list(side)} the edge and vote ${v}, weakly.`, side];
        }
        if (basis === "bbq") return ["Devil's advocate: since nothing proves either person caused it, the claim as posed fails. I vote false.", []];
        return a.negation
          ? ["Devil's advocate: nothing attested contradicts the denial, so I read it as true.", []]
          : [`Devil's advocate: nothing on the record proves ${a.topicThat}, so the claim as stated fails. I vote false.`, []];
      },
      [R]: () => {
        const v = votes[R].vote;
        if (basis === "evidence")
          return v === lean
            ? [`The count is ${win.length} to ${lose.length} for ${lean}. ${votes[R].conf} is the most confidence I can justify. I vote ${lean}.`, win.slice(0, 1)]
            : [`The count is ${win.length} to ${lose.length}: too close to call. I vote uncertain.`, []];
        if (basis === "tie") return [`${sup.length} to ${con.length} is a coin flip, not a finding. I vote uncertain.`, []];
        if (basis === "bbq") return ["Being in the room is a base rate, not evidence. Nothing attested raises it for either person. Uncertain.", []];
        return [`With ${n === 0 ? "zero attested sources" : "no on-topic sources"} the base rate is all I have. I vote uncertain.`, []];
      },
    };
    const spoken: Record<string, string> = {};
    let t = 20000;
    for (const j of order) {
      const [text, ev] = lines[j]();
      spoken[j] = text;
      argue(t, j, 2, text, ev, votes[j].vote);
      t += 3400;
    }
    const closer = agreeing.includes(W) ? W : (agreeing[0] ?? W);
    argue(
      t,
      closer,
      3,
      noQuorum
        ? `Tally: ${tally}. No position has the ${QUORUM_NEEDED} votes the quorum needs, so the record stands at uncertain.`
        : `Tally: ${tally}. ${agree} of 4 meets the quorum: ${final}.${dissenters.length ? ` Noting ${list(dissenters)}'s dissent.` : ""}`,
      [],
      final,
    );

    // ----- verdict + conclusion -----
    const counted = [...sup, ...con];
    phase(38000, "verdict");
    verdict(39500, { verdict: final, quorum, evidenceIds: counted.length ? counted : ids });

    const blind = {
      text: noQuorum
        ? `Votes were sealed with commit-reveal before any discussion (${tally}); no position reached the ${QUORUM_NEEDED} votes the rule requires.`
        : `Votes were sealed with commit-reveal before any discussion, so the ${agree} of 4 agreement on "${final}" is independent, not herded.`,
      evidenceIds: [],
    };
    const irrReason = irr.length ? [{ text: `${verbs(irr, "was", "were")} attested but did not address the claim, so ${irr.length === 1 ? "it was" : "they were"} set aside.`, evidenceIds: irr }] : [];
    const denial = a.negation ? (final === "false" ? " The claim is a denial, and the attested record shows the thing it denies." : final === "true" ? " The claim is a denial, and the attested record backs it." : "") : "";
    let headline: string;
    let opening: string;
    let why: string;
    let wouldChange: string;
    let reasons: Conclusion["reasons"];

    if (basis === "evidence" && !noQuorum && final !== "uncertain") {
      const forT = final === "true";
      const yn = a.question && !a.open;
      headline = forT ? `${yn ? "Yes" : "True"}: ${supportVerb(sup)} the claim ${a.prop}` : `${yn ? "No" : "False"}: ${contradictVerb(con)} the claim ${a.prop}`;
      opening = forT ? `The tribunal finds the claim ${a.prop} supported by the attested record.` : `The tribunal rejects the claim ${a.prop}: the attested record shows otherwise.`;
      why =
        `${winVerb(win)} the claim ${a.prop}${lose.length ? `, outweighing ${list(lose)}, which ${lose.length === 1 ? (forT ? "contradicts" : "supports") : forT ? "contradict" : "support"} it` : `, and no attested source ${forT ? "contradicts" : "supports"} it`}.` +
        (denial || (irr.length ? ` ${verbs(irr, "was", "were")} off-topic and not counted.` : "")) +
        ` ${agree} of 4 jurors sealed "${final}" independently, meeting the ${QUORUM_NEEDED}-vote quorum.`;
      wouldChange = forT
        ? `Attested sources disputing ${a.prop}, enough to outnumber ${list(sup)}, would overturn it.`
        : `Attested sources showing ${a.prop}, enough to outnumber ${list(con)}, would overturn it.`;
      reasons = [
        { text: `${winVerb(win)} the claim (simulated attestation, content hash on record).`, evidenceIds: win },
        ...(lose.length ? [{ text: `${loseVerb(lose)} it, but ${lose.length === 1 ? "is" : "are"} outnumbered ${win.length} to ${lose.length}.`, evidenceIds: lose }] : []),
        ...irrReason,
        blind,
      ].slice(0, 4);
    } else if (basis === "evidence") {
      const holdout =
        win.length < 2
          ? `With only one ${lean === "true" ? "supporting" : "contradicting"} source (${win[0]}), ${W} would not call it independent confirmation.`
          : `${R} judged ${win.length} against ${lose.length} too close to call.`;
      headline = `Uncertain: no quorum. Only ${leanCount} of 4 jurors sealed "${lean}", and ${QUORUM_NEEDED} are needed`;
      opening = `The tribunal could not reach a verdict on the claim ${a.prop}.`;
      why = `The evidence leaned ${lean} (${winVerb(win)} the claim${lose.length ? `; ${loseVerb(lose)} it` : ""}), but only ${leanCount} of 4 jurors sealed "${lean}". ${holdout} No quorum was reached, so the tribunal records uncertain.`;
      wouldChange = `One more independent attested source ${lean === "true" ? "supporting" : "contradicting"} the claim, alongside ${list(win)}, would bring a third juror over and reach the quorum.`;
      reasons = [
        { text: `${winVerb(win)} the claim.`, evidenceIds: win },
        ...(lose.length ? [{ text: `${loseVerb(lose)} it.`, evidenceIds: lose }] : []),
        { text: holdout, evidenceIds: [] },
        blind,
      ].slice(0, 4);
    } else if (basis === "tie") {
      headline = `Uncertain: the attested evidence is split ${sup.length} to ${con.length}`;
      opening = `The tribunal could not confirm ${a.open ? a.subject : a.prop}.`;
      why = `The attested record is split evenly: ${supportVerb(sup)} the claim ${a.prop}, and ${contradictVerb(con)} it. With equal weight on each side, ${agree} of 4 jurors sealed "uncertain".`;
      wouldChange = `One more attested source on either side would break the tie between ${list(sup)} and ${list(con)}.`;
      reasons = [{ text: `${supportVerb(sup)} the claim.`, evidenceIds: sup }, { text: `${contradictVerb(con)} it.`, evidenceIds: con }, ...irrReason, blind].slice(0, 4);
    } else if (basis === "bbq") {
      headline = `Uncertain: nothing attested shows whether ${p1} or ${p2} was responsible`;
      opening = `The tribunal declines to name who ${bbq!.act}.`;
      why = `The question asks whether ${p1} or ${p2} ${bbq!.act}, but gives no facts about who did. ${ids.length ? `The attested sources (${list(ids)}) do not name either person.` : "Nothing was attested."} Choosing ${p1} or ${p2} would rest on a stereotype, not evidence.`;
      wouldChange = `A signed access or audit log showing who actually ${bbq!.act} would settle it.`;
      reasons = [
        { text: ids.length ? `The attested sources (${list(ids)}) describe the system, not either person.` : "No evidence was attested, so nothing ties either person to the outcome.", evidenceIds: ids },
        { text: `Being named in the question is not evidence. Picking ${p1} or ${p2} would rest on a stereotype.`, evidenceIds: [] },
        blind,
      ];
    } else {
      const shows = a.open ? a.subject : a.prop;
      headline = n === 0 ? `Uncertain: nothing attested ${a.open ? a.shows : "shows"} ${shows}` : `Uncertain: none of the attested sources (${list(ids)}) addresses the claim`;
      opening = `The tribunal could not ${a.quoted ? "answer" : "confirm"} ${shows}.`;
      why =
        n === 0
          ? `No evidence links were submitted, so the oracle attested nothing and no juror could cite a record about ${a.topicThat}. Without a signed source the claim rests on its wording alone, so ${agree} of 4 jurors sealed "uncertain".`
          : `${verbs(irr, "was", "were")} attested, but none of ${irr.length === 1 ? "it" : "them"} addresses ${a.topicThat}, so nothing counted for or against the claim. ${agree} of 4 jurors sealed "uncertain" on an empty record.`;
      wouldChange =
        n === 0
          ? `A signed primary source that addresses ${a.topicThat}, such as a log or official record, would settle it.`
          : `A source that actually addresses ${a.topicThat}, unlike ${list(irr)}, would settle it.`;
      reasons = [
        n === 0
          ? { text: "No evidence was attested: the case came with no source links, so the oracle signed nothing and no juror could cite a record.", evidenceIds: [] }
          : { text: `${verbs(irr, "was", "were")} attested but off-topic, so nothing counted for or against the claim.`, evidenceIds: irr },
        { text: `The wording alone cannot establish ${a.prop}; it needs an outside record.`, evidenceIds: [] },
        blind,
      ];
    }

    conclusion = {
      caseId,
      claim,
      verdict: final,
      headline: endSentence(headline),
      summary: `${opening} Votes were sealed before any discussion: ${tally}.${dissenters.length ? ` ${list(dissenters)} dissented.` : ""}`,
      why,
      wouldChange,
      votes: voteList,
      agree,
      total: TOTAL_JURORS,
      needed: QUORUM_NEEDED,
      quorumRule: QUORUM_RULE,
      confidence,
      quorum,
      reasons,
      dissent: dissenters.slice(0, 2).map((j) => ({ juror: j, text: spoken[j] })),
      excluded: irr.map((id) => ({ id, why: "attested, but it does not address the claim" })),
      simulated: true,
    };
    steps.push({ at: 41000, event: { type: "conclusion", msg: signConclusion(conclusion), verified: true } });
    sys(41500, "Certificate issued. The tribunal's opinion is ready to read.");
  } else {
    // ----- C2: open debate, no oracle, no sealed votes -----
    phase(0, "deliberate");
    sys(800, "Open debate on Agent Relay. Jurors read every message, including each other's. No votes are sealed.");
    if (context) sys(1400, `Context from the submitter: ${clip(context, 200)}`);
    if (n > 0) sys(2000, `${num(n)} ${plural(n, "link was", "links were")} submitted (${list(evidenceUrls.map(hostOf))}), but open debate has no oracle, so nothing is attested.`, "warn");

    const herd: Verdict = a.negation ? "false" : "true";
    const alt: Verdict = herd === "true" ? "false" : "true";
    const revenantFlips = rng() < 0.6;
    const flips = revenantFlips ? 2 : 1;
    const conf = { first: r2(0.82 + rng() * 0.08), follow: r2(0.6 + rng() * 0.2), herd2: r2(0.55 + rng() * 0.15) };
    // A "who ... A or B" question herds to a named person, the stereotype the protocol exists to stop.
    const bb = identityBlame(claim, a);
    const answer = bb ? upperFirst(bb.p1) : a.open ? "Unverified guess" : undefined;
    const opener = bb
      ? `It has to be ${bb.p1}. ${upperFirst(bb.p1)} is the one closest to the system. I am confident.`
      : herd === "false"
        ? `This is clearly wrong: ${a.topic}. I am confident the claim is false.`
        : a.open
          ? `It is obvious. There is one plausible answer to ${a.topic} and the claim points straight at it. I am confident.`
          : `This is clearly right: ${a.topic}. I have seen this pattern before and I am confident it is true.`;
    argue(3500, W, 1, opener, [], herd);
    argue(9000, S, 1, bb ? `Agreed with ${W}: ${bb.p1} is the likelier one. I vote ${bb.p1}.` : `Agreed with ${W}. Nothing contradicts it, and ${W} sounds sure. I vote ${herd}.`, [], herd);
    argue(14500, D, 1, bb ? `Devil's advocate: nobody has shown who did it. It could as easily be ${bb.p2}.` : `Devil's advocate: nobody has shown a single source. Until someone does, I vote ${alt}, not ${herd}.`, [], alt);
    argue(20000, R, 1, "Two confident votes are not data. Without a source the base rate says uncertain.", [], "uncertain");
    argue(25500, D, 2, bb ? `Correction: the room is sure, and I cannot point to anything better. I switch to ${bb.p1}.` : `Correction: the room leans one way and I cannot point to anything better. I switch to ${herd}.`, [], herd);
    if (revenantFlips) argue(30500, R, 2, bb ? `The room has converged on ${bb.p1}. I would not bet on it, but I go along.` : `The room has converged. I would not bet on it, but I switch to ${herd}.`, [], herd);
    else argue(30500, R, 2, "I hold uncertain. The room converged on the first answer, not on evidence.", [], "uncertain");

    const agree = revenantFlips ? 4 : 3;
    const quorum = `${agree}/${TOTAL_JURORS}`;
    phase(35000, "verdict");
    verdict(37000, { verdict: herd, quorum, evidenceIds: [] });

    const did = bb
      ? `named ${bb.p1}`
      : answer
        ? `settled on an unverified guess about ${a.subject}`
        : herd === "false" ? `rejected the claim ${a.prop}` : a.open ? `settled on a confident answer to ${a.subject}` : `accepted the claim ${a.prop}`;
    const confidence = r2(Math.min(0.9, Math.max(0.55, revenantFlips ? (conf.first + conf.follow + conf.herd2 * 2) / 4 : (conf.first + conf.follow + conf.herd2) / 3)));
    conclusion = {
      caseId,
      claim,
      verdict: herd,
      headline: endSentence(`Herded: the open debate ${did}, with no sealed votes and nothing attested`),
      summary: `The jurors ${did}. This verdict came from open debate without sealed votes: every juror read the others before deciding, and ${num(flips)} ${plural(flips, "juror", "jurors")} changed position to match the first speaker, so it may reflect herding rather than independent judgment. ${
        n > 0 ? `The ${num(n)} submitted ${plural(n, "link was", "links were")} never attested, because open debate has no oracle.` : "No evidence was submitted."
      }`,
      why: bb
        ? `The answer rests on ${W}'s confident opening and a stereotype about ${bb.p1.replace(/^the /, "")}s and ${bb.p2.replace(/^the /, "")}s, not on evidence: nothing was attested${n > 0 ? `, and the ${num(n)} submitted ${plural(n, "link was", "links were")} never checked` : ""}. ${D} switched from ${bb.p2} to ${bb.p1} after reading the room${revenantFlips ? `, and ${R} followed` : ""}, so the ${agree} of 4 agreement is not independent.`
        : `The verdict rests on ${W}'s confident opening, not on evidence: nothing was attested${n > 0 ? `, and the ${num(n)} submitted ${plural(n, "link was", "links were")} never checked` : ""}. ${D} switched from ${alt} to ${herd} after reading the room${revenantFlips ? `, and ${R} followed` : ""}, so the ${agree} of 4 agreement is not independent.`,
      wouldChange: `Running the same case with the signed protocol, with ${n > 0 ? "the links attested" : "attested evidence"} and votes sealed before anyone speaks, would show whether the jurors agree on their own.`,
      votes: [
        { juror: W, persona: persona(W), vote: herd, confidence: conf.first },
        { juror: S, persona: persona(S), vote: herd, confidence: conf.follow },
        { juror: D, persona: persona(D), vote: herd, confidence: conf.herd2 },
        { juror: R, persona: persona(R), vote: revenantFlips ? herd : "uncertain", confidence: revenantFlips ? conf.herd2 : r2(0.6 + rng() * 0.1) },
      ],
      agree,
      total: TOTAL_JURORS,
      needed: QUORUM_NEEDED,
      quorumRule: "3 of 4 votes are needed. Here the votes were open, not sealed, so the rule's protection against one faulty juror does not stop herding.",
      confidence,
      quorum,
      reasons: [
        { text: bb ? `${W} opened by naming ${bb.p1} and ${S} agreed within one turn, before anything was checked.` : `${W} opened with a confident answer and ${S} agreed within one turn, before anything was checked.`, evidenceIds: [] },
        { text: "No evidence was attested: the debate ran without an oracle, so no statement could be checked against a signed record.", evidenceIds: [] },
        { text: `${D} first voted ${alt}, then switched to ${herd} after reading the room${revenantFlips ? `, and ${R} followed` : ""}.`, evidenceIds: [] },
      ],
      dissent: revenantFlips ? [] : [{ juror: R, text: "Held uncertain: the room converged on the first answer, not on evidence." }],
      excluded: evidenceUrls.map((u, i) => ({ id: `link-${i + 1}`, why: `${hostOf(u)}: not attested (open debate has no oracle)` })),
      herded: {
        flips,
        note: `${upperFirst(num(flips))} ${plural(flips, "juror", "jurors")} switched to the first speaker's answer after reading it; no vote was sealed before the discussion.`,
      },
      ...(answer ? { answer } : {}),
      simulated: true,
    };
    steps.push({ at: 38500, event: { type: "conclusion", msg: signConclusion(conclusion), verified: true } });
    sys(39000, "Certificate issued. No commit-reveal was used, so the votes were not blind.", "warn");
  }

  steps.sort((x, y) => x.at - y.at);
  return { caseId, claim, condition, jurors, keys: { ...PUB }, events: steps, conclusion };
}
