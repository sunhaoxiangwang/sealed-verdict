//! Sealed Verdict protocol core.
//!
//! This crate holds everything that must agree byte-for-byte between the
//! actors (Clerk, Ledger, Oracle, jurors), the certificate verifier, and the
//! WASM build consumed by Node and browsers:
//!
//! * wire types ([`types`]) with the frozen field names,
//! * deterministic canonical JSON ([`canonical`]),
//! * SHA-256 hashing ([`hash`]) and Ed25519 signing ([`sign`]),
//! * commitment encoding ([`commitment`]) and the transcript chain ([`chain`]),
//! * the admission engine ([`replay`]) that decides which messages count, used
//!   live by the Clerk and again by the verifier when it replays a transcript,
//! * the certificate verifier ([`verify`]).
//!
//! The crate has no runtime randomness dependency. Callers supply key seeds and
//! nonces; see `apps/actors` for the OS-backed implementation.

pub mod canonical;
pub mod chain;
pub mod commitment;
pub mod error;
pub mod hash;
pub mod replay;
pub mod sign;
pub mod types;
pub mod validate;
pub mod verify;

pub use canonical::{canonical_bytes, canonical_value_bytes};
pub use chain::{chain_genesis, chain_root, chain_step};
pub use commitment::{commitment_for_reveal, commitment_hex};
pub use error::ProtocolError;
pub use hash::{sha256, sha256_hex};
pub use replay::{Admission, Engine, Tally};
pub use sign::{sign, signing_bytes, verify, verify_value, Keypair, Message};
pub use types::*;
pub use verify::{verify_cert, verify_cert_json, verify_cert_typed, VerifyReport};

/// Domain-separation prefix shared by every signature and hash in this protocol version.
pub const PROTOCOL_VERSION: &str = "sv1";
