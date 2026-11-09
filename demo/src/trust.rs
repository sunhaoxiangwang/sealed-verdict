//! Trust layer: canonical JSON, Ed25519 signing, oracle evidence, hash-chained ledger, certificate audit.
//!
//! Byte-compatible with apps/web/src/protocol/crypto.ts (PR #2): sig = "ed25519:" + hex(ed25519(sha256(canonical(body)))),
//! chain = sha256hex(prev + canonical(body)) from GENESIS. So the browser audit re-verifies what this writes.
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub fn sha256hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// JSON.stringify with object keys sorted recursively (crypto.ts `canonical`).
pub fn canonical(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut ks: Vec<&String> = m.keys().collect();
            ks.sort();
            let body: Vec<String> = ks.iter().map(|k| format!("{}:{}", Value::from(k.as_str()), canonical(&m[*k]))).collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(canonical).collect::<Vec<_>>().join(",")),
        // JS prints 1.0 as "1"; serde prints "1.0".
        Value::Number(n) if n.is_f64() => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{}", f as i64),
            _ => n.to_string(),
        },
        _ => v.to_string(),
    }
}

pub fn genesis() -> String {
    sha256hex("sealed-verdict:genesis")
}

pub fn chain_hash(prev: &str, body: &Value) -> String {
    sha256hex(&format!("{prev}{}", canonical(body)))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Signed {
    pub body: Value,
    pub sig: String,
    pub signer: String,
}

pub struct Key {
    pub name: String,
    sk: SigningKey,
}

impl Key {
    pub fn from_seed(name: &str, seed: [u8; 32]) -> Self {
        Key { name: name.into(), sk: SigningKey::from_bytes(&seed) }
    }
    /// Demo keys derived from a public constant, like eval/oracle.py. ponytail: swap for the key registry / KMS.
    pub fn demo(name: &str, label: &str) -> Self {
        Key::from_seed(name, Sha256::digest(label.as_bytes()).into())
    }
    pub fn pub_hex(&self) -> String {
        hex::encode(self.sk.verifying_key().to_bytes())
    }
    pub fn sign(&self, body: Value) -> Signed {
        let digest = Sha256::digest(canonical(&body).as_bytes());
        Signed { sig: format!("ed25519:{}", hex::encode(self.sk.sign(&digest).to_bytes())), body, signer: self.name.clone() }
    }
}

pub fn verify(s: &Signed, pub_hex: &str) -> bool {
    let check = || -> Option<bool> {
        let sig = Signature::from_slice(&hex::decode(s.sig.strip_prefix("ed25519:")?).ok()?).ok()?;
        let pk: [u8; 32] = hex::decode(pub_hex).ok()?.try_into().ok()?;
        let digest = Sha256::digest(canonical(&s.body).as_bytes());
        Some(VerifyingKey::from_bytes(&pk).ok()?.verify(&digest, &sig).is_ok())
    };
    check().unwrap_or(false)
}

/// Same seed as eval/oracle.py, so both runners share one oracle public key.
pub fn oracle_key() -> Key {
    Key::demo("oracle", "sealed-verdict-oracle-20261031")
}
pub fn ledger_key() -> Key {
    Key::demo("ledger", "sealed-verdict-ledger-20261031")
}
/// Simulated human compliance officer. ponytail: real officer signs from the UI; this countersigns the panel.
pub fn officer_key() -> Key {
    Key::demo("officer", "sealed-verdict-officer-20261031")
}

/// Oracle: hashes the content and signs it. Evidence body matches the frontend `Evidence` type.
pub fn attest(oracle: &Key, case_id: &str, id: &str, kind: &str, source: &str, excerpt: &str, ts: i64) -> Signed {
    oracle.sign(json!({"id": id, "caseId": case_id, "kind": kind, "source": source,
                       "contentHash": sha256hex(excerpt), "excerpt": excerpt, "ts": ts}))
}

/// Attested = content hash matches and the oracle signature verifies. Anything else is UNATTESTED.
pub fn evidence_ok(s: &Signed, oracle_pub: &str) -> bool {
    s.body["excerpt"].as_str().is_some_and(|e| s.body["contentHash"] == sha256hex(e)) && verify(s, oracle_pub)
}

/// One row of the frontend `events` table (apps/web/src/contracts.md).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: String,
    pub ts: i64,
    pub payload: Value,
    pub verified: bool,
}

/// Ledger: appends every message in order, keeps the transcript root and the argument chain head.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Ledger {
    pub events: Vec<Event>,
    pub root: String,
    pub arg_head: String,
}

impl Default for Ledger {
    fn default() -> Self {
        Ledger { events: vec![], root: genesis(), arg_head: genesis() }
    }
}

impl Ledger {
    pub fn post(&mut self, kind: &str, ts: i64, s: &Signed, verified: bool, extra: Value) {
        if verified && SIGNED_KINDS.contains(&kind) {
            self.root = chain_hash(&self.root, &s.body);
        }
        if kind == "argument" {
            self.arg_head = chain_hash(&self.arg_head, &s.body);
        }
        let mut payload = serde_json::to_value(s).unwrap();
        if let (Value::Object(p), Value::Object(e)) = (&mut payload, extra) {
            p.extend(e);
        }
        self.events.push(Event { kind: kind.into(), ts, payload, verified });
    }
    pub fn note(&mut self, kind: &str, ts: i64, payload: Value) {
        self.events.push(Event { kind: kind.into(), ts, payload, verified: false });
    }
}

const SIGNED_KINDS: [&str; 4] = ["evidence", "commit", "reveal", "argument"];

/// Lookback audit (the verify endpoint). Mirrors apps/web/src/protocol/audit.ts plus the AML checks:
/// human sign-off, quorum signatures and the SAR deadline. Oracle, ledger and officer keys are pinned;
/// juror keys are trusted only through the ledger-signed certificate.
pub fn audit(events: &[Event]) -> Vec<(String, bool, String)> {
    let (oracle, ledger, officer) = (oracle_key().pub_hex(), ledger_key().pub_hex(), officer_key().pub_hex());
    let mut rows = vec![];
    let mut row = |label: &str, ok: bool, detail: String| rows.push((label.to_string(), ok, detail));

    let cert = events.iter().rev().find(|e| e.kind == "verdict").and_then(|e| serde_json::from_value::<Signed>(e.payload.clone()).ok());
    let Some(cert) = cert else {
        row("Certificate", false, "no verdict certificate in the transcript".into());
        return rows;
    };
    let cert_ok = cert.signer == "ledger" && verify(&cert, &ledger);
    let c = &cert.body;
    let juror_keys = c["keys"].as_object().cloned().unwrap_or_default();
    let key_of = |signer: &str| -> Option<String> {
        match signer {
            "oracle" => Some(oracle.clone()),
            _ => juror_keys.get(signer).and_then(|v| v.as_str()).map(String::from),
        }
    };
    let msgs: Vec<(Signed, bool, &str)> = events
        .iter()
        .filter(|e| SIGNED_KINDS.contains(&e.kind.as_str()))
        .filter_map(|e| Some((serde_json::from_value::<Signed>(e.payload.clone()).ok()?, e.verified, e.kind.as_str())))
        .collect();
    let accepted: Vec<&(Signed, bool, &str)> = msgs.iter().filter(|m| m.1).collect();

    let bad: Vec<&str> = accepted.iter().filter(|m| !key_of(&m.0.signer).is_some_and(|k| verify(&m.0, &k))).map(|m| m.0.signer.as_str()).collect();
    row("Message signatures", bad.is_empty(), if bad.is_empty() { format!("{0}/{0} verify", accepted.len()) } else { format!("{} fail: {}", bad.len(), bad.join(", ")) });

    let bad_hash = accepted.iter().filter(|m| m.2 == "evidence" && !evidence_ok(&m.0, &oracle)).count();
    row("Evidence content hashes", bad_hash == 0, format!("{bad_hash} attested item(s) fail the oracle check"));

    let cited: Vec<&Value> = c["evidenceIds"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let forged_cited = msgs.iter().filter(|m| m.2 == "evidence" && !m.1 && cited.contains(&&m.0.body["id"])).count();
    row("Forged items excluded", forged_cited == 0, format!("{} unattested item(s) on file, {forged_cited} cited", msgs.iter().filter(|m| m.2 == "evidence" && !m.1).count()));

    let mut head = genesis();
    let mut brk = None;
    for (k, m) in msgs.iter().filter(|m| m.2 == "argument").enumerate() {
        if m.0.body["prevHash"] != head.as_str() && brk.is_none() {
            brk = Some(k + 1);
        }
        head = chain_hash(&head, &m.0.body);
    }
    row("Deliberation hash chain", brk.is_none(), brk.map_or("arguments link by prevHash".into(), |k| format!("prevHash mismatch at argument {k}")));

    let mut root = genesis();
    for m in &accepted {
        root = chain_hash(&root, &m.0.body);
    }
    row("Transcript root", root == c["transcriptRoot"].as_str().unwrap_or(""), "recomputed root vs certificate transcriptRoot".into());
    row("Ledger signature", cert_ok, "certificate signed by the pinned ledger key".into());

    let human = serde_json::from_value::<Signed>(c["humanSig"].clone()).ok();
    let human_ok = human.as_ref().is_some_and(|h| h.signer == "officer" && verify(h, &officer) && h.body["decision"] == c["verdict"] && h.body["caseId"] == c["caseId"]);
    row("Human sign-off", human_ok, "compliance officer countersigned this decision".into());

    let final_sigs: Vec<&str> = accepted.iter().filter(|m| m.2 == "argument" && m.0.body["vote"] == c["verdict"] && m.0.body["round"] == c["finalRound"]).map(|m| m.0.sig.as_str()).collect();
    let voters: Vec<&str> = c["voterSigs"].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).collect()).unwrap_or_default();
    let quorum_ok = voters.iter().all(|s| final_sigs.contains(s)) && (c["verdict"] == "need_more_info" || voters.len() >= c["quorumNeeded"].as_u64().unwrap_or(0) as usize);
    row("Quorum signatures", quorum_ok, format!("{} voter signature(s) match final-round votes", voters.len()));

    let (d, dl) = (c["decidedAt"].as_i64().unwrap_or(i64::MAX), c["sarDeadline"].as_i64().unwrap_or(0));
    row("SAR deadline", d <= dl, format!("decided {:.1} day(s) before the deadline", (dl - d) as f64 / 86_400_000.0));
    rows
}
