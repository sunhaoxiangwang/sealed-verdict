Sealed Verdict · anti-money laundering

# From alert to SAR decision, sealed at every step

A transaction-monitoring alert becomes a case that runs for weeks: triage, investigation, a customer request for information, a four-eyes decision, and a regulator lookback months later. Each step has a known failure: analysts anchor on the alert reason, customer nationality skews judgment, documents get forged, and the 30-day SAR clock keeps running through outages.

## Datasets

Real AML data is confidential, so the public benchmarks are synthetic or anonymized. IBM's set is the best fit: it labels every laundering transaction and the typology pattern it belongs to.

| Dataset | What it is | Use here | Role |
| --- | --- | --- | --- |
| [IBM AML-Data](https://github.com/IBM/AML-Data) ([paper](https://arxiv.org/pdf/2306.16424)) | Synthetic bank transactions from a multi-agent world simulator, every laundering transaction labeled with its typology (fan-in, fan-out, cycle, scatter-gather and others). Small to large variants, high and low illicit ratios. | Generate alerts with ground truth. Build case files from the account's transaction subgraph. | primary |
| Counterfactual name / nationality swap (built on IBM cases) | The same case file with only the customer's name and country changed. | The bias arm: does the verdict change when nothing but identity changes? | bias arm |
| BBQ, Nationality category | Existing social-bias benchmark already in the pipeline. | Keeps the headline bias score comparable to published work. | headline |
| SAML-D | Synthetic AML transactions with typology labels, including geographic and payment-type features. | Second source to check results are not specific to one generator. | optional |
| Elliptic Bitcoin dataset | Real, anonymized Bitcoin transaction graph with licit / illicit labels. | Crypto variant of the demo. | optional |
| [TransXion](https://arxiv.org/pdf/2604.17420) | A newer graph benchmark for AML. | Not reviewed in detail; worth a look after the hackathon. | later |

SAML-D and Elliptic are listed from prior knowledge; check their current download pages before relying on them.

## The workflow at a glance

Each column is a stage of one AML case. Each row is one part of the architecture and what it does at that stage.

ComponentStage →

Day 01 · Alert

Day 12 · L1 triage

Days 2–123 · Investigation + RFI

Day 144 · Panel review

Day 205 · Four-eyes + SAR

Month 66 · Lookback / exam

Durable Actorsstate that survives

AlertCase actor created. Starts the durable 30-day SAR clock from initial detection.

Triage juror actor holds its sealed commit and nonce.

Case sleeps while waiting on the customer's RFI reply. Investigator juror crashes on day 9 and resumes with memory intact.

Panel juror actors keep track records across many cases.

Case actor gates the decision on quorum plus human sign-off before the deadline.

Same actor reopens months later with the full history. No rebuild from logs.

Agent Relaywho talks to whom

Case channels opened: #attest #commit #deliberate

Triage juror commits on #t/commit before it can read the alert's rule label.

Optional cross-bank channel #314b: a second bank's juror joins with its own keys.

Panel deliberates peer to peer under pseudonyms.

Human compliance officer posts on #verdict in the same signed format.

Examiner's queries on #review; answers cite the original messages.

Signaturesprovenance + integrity

Oracle signs the alert: rule ID, transaction IDs, subgraph hash.

Compute oracle signs derived features (velocity, fan-in count, cycle found).

KYC and sanctions oracles sign profile and screening results. A forged invoice injected outside the RFI channel is UNATTESTED.

Every argument cites signed evidence IDs or carries zero weight.

Ledger signs a certificate: decision, evidence, voters, timestamps.

Examiner verifies in the browser. Any edit breaks the chain.

LLM juryjudgment layer

No judgment yet. Alert data only.

Triage juror sees transactions with name and country masked, then commits: close or escalate.

Investigator juror tests typology hypotheses against signed features.

Diverse panel: typology analyst, skeptic (legitimate business?), sanctions specialist, devil's advocate.

3 of 4 signed votes, plus the human officer, who holds the final call.

Juror reputation reviewed; a juror that pushed biased calls is down-weighted.

## What happens at each stage

The technical steps, the messages on the wire, and which component carries each step.

Stage 1 · Alert · Day 0

### Open the case and start the clock

- **Actor:** a monitoring rule fires on an IBM AML account. `AlertCase.create(alert)` stores the account, rule and transaction IDs.
- **Actor:** a durable timer is set for the SAR deadline. FinCEN counts 30 days from initial detection (up to 60 if no suspect is identified). The timer survives restarts.
- **Signature:** the oracle hashes the account's transaction subgraph and signs `Evidence{alert}`.

```
// AlertCase actor (durable)
state = {
  caseId, accountId, ruleId,
  txIds: [...], stage: "triage",
  sarDeadline: detectedAt + 30d,
  evidence: [ev_alert], chainHead
}
setAlarm(sarDeadline - 5d, "escalate_overdue")
```

Stage 2 · L1 triage · Day 1

### Blind first read, identity masked

- **Jury:** the triage juror sees the transaction pattern with customer name and country masked, and without the rule's label. It commits close or escalate.
- **Relay:** only after its commit lands can it read #context (identity, rule reason). Seeing the label first is how analysts anchor.
- **Actor:** the Clerk logic inside the case actor rejects any read before commit.

```
view_for_triage(case) = {
  txs: case.txs.map(maskParty),
  features: signed(ev_features),
  // hidden until commit:
  // customerName, country, ruleLabel
}
onRead(juror, "#context"):
  require committed[stage][juror]
```

Stage 3 · Investigation + RFI · Days 2–12

### Gather signed evidence, wait for the customer, survive a crash

- **Signature:** the compute oracle runs graph queries (fan-in count, cycle search, velocity) and signs each result. The KYC and sanctions oracles sign profile and screening hits.
- **Actor:** a request for information goes to the customer. The case actor sleeps for days and wakes when the reply arrives.
- **Actor:** the investigator juror crashes on day 9 and resumes with its hypotheses and commits intact. The SAR clock never paused.
- **Signature:** a fake invoice claiming the funds are legitimate is posted outside the RFI channel. It has no oracle receipt, so it is UNATTESTED.
- **Relay:** optionally, a second bank's juror joins #314b (US rules allow voluntary information sharing between institutions). Each bank keeps its own keys.

```
// compute oracle
ev = {
  kind: "compute", query: "fan_in(acct, 7d)",
  result: "23 senders, 19 new",
  contentHash, ts
}
sig = oracle.sign(canonical(ev))

// RFI reply is attested at intake
onRfiReply(doc):
  ev_rfi = oracle.receipt(doc, channel="rfi")
```

Stage 4 · Panel review · Day 14

### Diverse panel argues from signed facts only

- **Jury:** four jurors on different providers and personas commit blind, reveal, then deliberate under pseudonyms.
- **Jury:** the skeptic must argue the strongest legitimate-business explanation. This counters confirmation bias.
- **Signature:** arguments must cite evidence IDs. Uncited or UNATTESTED claims get zero weight.
- **Actor:** the Ledger appends every message in order and tallies votes.

```
panel = [
  {provider: "anthropic", persona: "typology_analyst"},
  {provider: "openai",    persona: "skeptic"},
  {provider: "gemini",    persona: "sanctions"},
  {provider: "anthropic", persona: "devils_advocate"}
]
labels = ["file_sar", "close", "need_more_info"]
```

Stage 5 · Four-eyes + SAR · Day 20

### Quorum plus a human, before the deadline

- **Actor:** the case actor requires 3 of 4 matching signed votes and the human compliance officer's signature.
- **Relay:** the human joins #verdict as a juror with their own key.
- **Signature:** the Ledger signs the certificate. A SAR narrative draft cites only signed evidence IDs.

```
DecisionCert {
  caseId, decision: "file_sar",
  typology: "fan-in, structuring",
  evidenceIds: [ev_alert, ev_fanin, ev_kyc, ev_rfi],
  voterSigs: [s1, s2, s4], humanSig: hOfficer,
  decidedAt, sarDeadline,
  transcriptRoot,
  sig: ledger.sign(canonical(body))
}
```

Stage 6 · Lookback / exam · Month 6

### Prove what was known, and when

- **Actor:** an examiner or model-validation team reopens the same case actor. State and transcript are intact.
- **Signature:** Verify rechecks every signature, the hash chain, and that the decision came before the deadline.
- **Jury:** juror reputation across cases is reviewed; a juror that leaned on nationality is flagged and down-weighted.

```
verify(cert):
  assert chain(case.messages) == cert.transcriptRoot
  for msg in case.messages: assert sigOK(msg)
  assert cert.decidedAt <= cert.sarDeadline
  assert humanSig present
// any edit → red
```

## Which component solves which problem

| Problem | What goes wrong today | How Sealed Verdict handles it | Component |
| --- | --- | --- | --- |
| Anchoring on the alert | The analyst reads the rule label first and confirms it. | Blind triage commit before the label is visible. | LLM juryDurable Actors |
| Nationality or name bias | Identical activity is escalated more for some customers. | Identity masked at triage; diverse panel; counterfactual swap measured in the eval. | LLM juryAgent Relay |
| Weeks-long cases with waits | Context lost between RFI replies and hand-offs. | One case actor holds state; it sleeps and wakes on events. | Durable Actors |
| Missed SAR deadline | Timers live in ad hoc jobs that fail silently. | Durable alarm on the case actor; the deadline is checked in the certificate. | Durable ActorsSignatures |
| Crash breaks independence | A stateless retry re-votes after seeing the others. | Juror actor restores nonce and original commit. | Durable Actors |
| Forged documents | A fake invoice in the file is trusted. | Only oracle-attested evidence carries weight. | Signatures |
| Sharing across banks | Email and phone calls with no shared record. | Cross-bank Relay channel; each bank signs with its own keys. | Agent RelaySignatures |
| Exam and lookback | Hard to prove what was known and when. | Hash-chained transcript and signed, timestamped certificate. | SignaturesDurable Actors |

## How to measure it

```
Arms (same C0 → C5 ladder)
  aml_cases      IBM alerts, n=200
                 gold = laundering or not
  aml_swap       same cases, name/country swapped
  aml_forged     + fake legitimacy invoice
  bbq_nat        BBQ Nationality (headline)

Metrics
  recall @ fixed false-positive rate
  swap disagreement   (verdict changes on identity)
  forged acceptance
  herding flip rate
Tests: McNemar, paired bootstrap CIs, Holm
```

## Demo build, about 2 hours

```
1  pick 1 laundering + 1 clean account from IBM
   (fan-in typology is easiest to explain)
2  case file: subgraph, signed features, KYC stub
3  "Advance stage" button → next stage
4  "Kill investigator" → resume, clock intact
5  "Inject fake invoice" → UNATTESTED
6  "Swap nationality" → C2 flips, C5 holds
7  Verify / Tamper on the certificate
```

Synthetic data only. The human compliance officer holds the final decision. Signatures prove provenance and integrity, not that a decision is correct. Regulatory details are summarized for the demo; confirm with compliance counsel.

Sources: [IBM AML-Data](https://github.com/IBM/AML-Data) · [Realistic Synthetic Financial Transactions for AML Models](https://arxiv.org/pdf/2306.16424) · [TransXion](https://arxiv.org/pdf/2604.17420) · [Initial detection and the 30-day SAR clock](https://bankersonline.com/articles/107354)