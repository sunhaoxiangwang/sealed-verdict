//! OS randomness for key seeds and nonces. The protocol crate itself has no
//! randomness dependency; actors are the only place that draws entropy, and
//! generated keys live only in memory.

use sealed_verdict_protocol::Keypair;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("OS randomness unavailable");
    out
}

pub fn random_seed() -> [u8; 32] {
    random_bytes::<32>()
}

/// Fresh 32-byte nonce as lowercase hex.
pub fn random_nonce_hex() -> String {
    hex::encode(random_seed())
}

pub fn random_hex(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    getrandom::fill(&mut buf).expect("OS randomness unavailable");
    hex::encode(buf)
}

pub fn new_keypair() -> Keypair {
    Keypair::from_seed(random_seed())
}
