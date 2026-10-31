//! Ed25519 signing with domain separation.
//!
//! Signature input: `UTF8("sv1/" + KIND + "\n") || canonical(body)`.
//! Verification uses `verify_strict`, which rejects weak keys and
//! non-canonical signature encodings.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::Serialize;
use serde_json::Value;

use crate::canonical::{canonical_bytes, canonical_value_bytes};
use crate::error::ProtocolError;
use crate::hash::decode_hex_array;
use crate::types::{Argument, CertBody, Commit, Evidence, PhaseMarker, Reveal, Signed};
use crate::PROTOCOL_VERSION;

/// A signable wire body with its domain-separation kind.
pub trait Message: Serialize {
    const KIND: &'static str;
}

impl Message for Evidence {
    const KIND: &'static str = "evidence";
}
impl Message for Commit {
    const KIND: &'static str = "commit";
}
impl Message for Reveal {
    const KIND: &'static str = "reveal";
}
impl Message for Argument {
    const KIND: &'static str = "argument";
}
impl Message for PhaseMarker {
    const KIND: &'static str = "phase";
}
impl Message for CertBody {
    const KIND: &'static str = "cert";
}

/// Ed25519 keypair. Construct from 32 seed bytes the caller obtained from an
/// OS source; this crate never generates randomness.
pub struct Keypair {
    key: SigningKey,
}

impl Keypair {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            key: SigningKey::from_bytes(&seed),
        }
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.key.verifying_key().to_bytes())
    }

    pub fn sign_bytes(&self, message: &[u8]) -> [u8; 64] {
        self.key.sign(message).to_bytes()
    }
}

impl std::fmt::Debug for Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Keypair({})", self.public_key_hex())
    }
}

/// Bytes that are actually signed for a body of the given kind.
pub fn signing_bytes(kind: &str, canonical_body: &[u8]) -> Vec<u8> {
    let mut out = format!("{PROTOCOL_VERSION}/{kind}\n").into_bytes();
    out.extend_from_slice(canonical_body);
    out
}

/// Sign a body, producing a hex-encoded envelope.
pub fn sign<T: Message>(kp: &Keypair, body: T) -> Result<Signed<T>, ProtocolError> {
    let canon = canonical_bytes(&body)?;
    let sig = kp.sign_bytes(&signing_bytes(T::KIND, &canon));
    Ok(Signed {
        body,
        sig: Some(hex::encode(sig)),
        signer: Some(kp.public_key_hex()),
    })
}

/// Verify a typed envelope against its embedded signer key. Does not check
/// that the signer is authorized; callers compare `signer` with the registry.
pub fn verify<T: Message>(signed: &Signed<T>) -> Result<(), ProtocolError> {
    let body = serde_json::to_value(&signed.body)?;
    verify_value(
        T::KIND,
        &body,
        signed.sig.as_deref(),
        signed.signer.as_deref(),
    )
}

/// Verify over an untyped body value, hashing it exactly as received.
pub fn verify_value(
    kind: &str,
    body: &Value,
    sig: Option<&str>,
    signer: Option<&str>,
) -> Result<(), ProtocolError> {
    let (Some(sig), Some(signer)) = (sig, signer) else {
        return Err(ProtocolError::MissingSignature);
    };
    let sig_bytes: [u8; 64] = decode_hex_array(sig)?;
    let pk: [u8; 32] = decode_hex_array(signer)?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|e| ProtocolError::Key(e.to_string()))?;
    let canon = canonical_value_bytes(body)?;
    vk.verify_strict(
        &signing_bytes(kind, &canon),
        &Signature::from_bytes(&sig_bytes),
    )
    .map_err(|_| ProtocolError::BadSignature)
}

/// True when `hex` decodes to a valid Ed25519 public key.
pub fn public_key_valid(hex: &str) -> bool {
    decode_hex_array::<32>(hex)
        .ok()
        .map(|pk| VerifyingKey::from_bytes(&pk).is_ok())
        .unwrap_or(false)
}
