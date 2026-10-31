//! Durable actors: AlertCase (holds the Clerk, the Ledger and the SAR clock) and Juror (keypair, nonce, sealed vote).
//!
//! ponytail: one JSON file per actor, written atomically after every mutation. Swap `Store` for the Durable Actors
//! SDK when it lands; actor state structs and call sites stay the same.
use crate::trust::{Key, Ledger, sha256hex};
use rand::RngCore;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use std::{collections::BTreeMap, fs, path::PathBuf};

pub const DAY_MS: i64 = 86_400_000;
pub const SAR_DAYS: i64 = 30; // FinCEN: 30 days from initial detection

pub struct Store {
    pub dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        fs::create_dir_all(&dir).expect("state dir");
        Store { dir }
    }
    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(id.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "_") + ".json")
    }
    pub fn save<T: Serialize>(&self, id: &str, v: &T) {
        let p = self.path(id);
        let tmp = p.with_extension("tmp");
        fs::write(&tmp, serde_json::to_vec(v).unwrap()).expect("write actor state");
        fs::rename(tmp, p).expect("commit actor state");
    }
    pub fn load<T: DeserializeOwned>(&self, id: &str) -> Option<T> {
        serde_json::from_slice(&fs::read(self.path(id)).ok()?).ok()
    }
}

pub fn commitment(vote: &str, nonce: &str) -> String {
    sha256hex(&format!("{vote}{nonce}"))
}

fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Juror {
    pub id: String,
    pub name: String,
    pub persona: String,
    pub provider: String,
    pub model: String,
    seed: String,
    pub nonce: Option<String>,
    pub sealed: Option<String>,
    pub commitment: Option<String>,
}

impl Juror {
    pub fn spawn(store: &Store, id: &str, name: &str, persona: &str, provider: &str, model: &str) -> Self {
        let j = Juror { id: id.into(), name: name.into(), persona: persona.into(), provider: provider.into(), model: model.into(),
                        seed: random_hex(32), nonce: None, sealed: None, commitment: None };
        store.save(id, &j);
        j
    }
    pub fn key(&self) -> Key {
        Key::from_seed(&self.name, hex::decode(&self.seed).unwrap().try_into().unwrap())
    }
    /// Seal a vote: fresh 128-bit nonce, commitment = sha256(vote + nonce). Persisted before it is posted.
    pub fn seal(&mut self, store: &Store, vote: &str) -> String {
        let nonce = random_hex(16);
        let c = commitment(vote, &nonce);
        (self.nonce, self.sealed, self.commitment) = (Some(nonce), Some(vote.into()), Some(c.clone()));
        store.save(&self.id, self);
        c
    }
}

/// Clerk: the phase state machine. Lives inside the case actor, so its gate survives restarts.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Clerk {
    pub phase: String,
    pub expected: usize,
    pub commits: BTreeMap<String, String>,
}

impl Clerk {
    pub fn open_commit(&mut self, expected: usize) {
        (self.phase, self.expected) = ("commit".into(), expected);
        self.commits.clear();
    }
    pub fn commit(&mut self, juror: &str, c: &str) -> Result<(), String> {
        if self.phase != "commit" {
            return Err(format!("commit refused: phase is {}", self.phase));
        }
        if self.commits.contains_key(juror) {
            return Err(format!("{juror} already committed"));
        }
        self.commits.insert(juror.into(), c.into());
        Ok(())
    }
    pub fn open_reveal(&mut self) -> Result<(), String> {
        if self.commits.len() < self.expected {
            return Err(format!("reveal stays closed: {}/{} commitments", self.commits.len(), self.expected));
        }
        self.phase = "reveal".into();
        Ok(())
    }
    pub fn reveal(&self, juror: &str, vote: &str, nonce: &str) -> Result<(), String> {
        if self.phase != "reveal" {
            return Err(format!("reveal refused: phase is {}", self.phase));
        }
        match self.commits.get(juror) {
            Some(c) if *c == commitment(vote, nonce) => Ok(()),
            Some(_) => Err(format!("{juror}: reveal does not match commitment")),
            None => Err(format!("{juror}: no commitment")),
        }
    }
    /// #context (identity, rule label) opens to a juror only after its commit lands.
    pub fn read_context(&self, juror: &str) -> Result<(), String> {
        self.commits.get(juror).map(|_| ()).ok_or(format!("{juror}: #context is closed until you commit"))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CaseActor {
    pub id: String,
    pub account: String,
    pub rule_id: String,
    pub tx_ids: Vec<String>,
    pub stage: String,
    pub day: i64,
    pub t0_ms: i64,
    pub sar_deadline_ms: i64,
    pub alarms: Vec<(i64, String)>,
    pub fired: Vec<String>,
    pub decided_day: Option<i64>,
    pub clerk: Clerk,
    pub ledger: Ledger,
}

impl CaseActor {
    pub fn create(store: &Store, id: &str, account: &str, rule_id: &str, tx_ids: Vec<String>, t0_ms: i64) -> Self {
        let mut c = CaseActor { id: id.into(), account: account.into(), rule_id: rule_id.into(), tx_ids, stage: "alert".into(), day: 0,
                                t0_ms, sar_deadline_ms: t0_ms + SAR_DAYS * DAY_MS, alarms: vec![(SAR_DAYS - 5, "escalate_overdue".into())],
                                fired: vec![], decided_day: None, clerk: Clerk::default(), ledger: Ledger::default() };
        let ts = c.ts();
        c.ledger.note("system", ts, json!({"text": format!("Case opened. SAR deadline day {SAR_DAYS}; alarm set for day {}.", SAR_DAYS - 5), "level": "info"}));
        c.save(store);
        c
    }
    /// Monotonic event timestamp on the simulated case clock.
    pub fn ts(&self) -> i64 {
        self.t0_ms + self.day * DAY_MS + self.ledger.events.len() as i64
    }
    /// Move the durable clock forward; fire any due alarm unless the case is already decided.
    pub fn advance(&mut self, store: &Store, day: i64, stage: &str) {
        (self.day, self.stage) = (day, stage.into());
        let due: Vec<String> = self.alarms.iter().filter(|(d, a)| *d <= day && !self.fired.contains(a)).map(|(_, a)| a.clone()).collect();
        for a in due {
            if self.decided_day.is_none() {
                let ts = self.ts();
                self.ledger.note("system", ts, json!({"text": format!("Alarm {a}: SAR deadline in {} days", SAR_DAYS - day), "level": "warn"}));
            }
            self.fired.push(a);
        }
        self.save(store);
    }
    pub fn save(&self, store: &Store) {
        store.save(&self.id, self);
    }
}
