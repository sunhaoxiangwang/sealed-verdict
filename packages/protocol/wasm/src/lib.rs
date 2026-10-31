//! WebAssembly surface for the shared verifier.
//!
//! One string-in, string-out export keeps the JS interop to a single function:
//! `verifyCertJson(certJson) -> '{"valid":bool,"failures":[...]}'`. The JS
//! wrapper in `../js/index.js` handles `JSON.stringify`/`JSON.parse` so callers
//! see `verifyCert(cert) -> { valid, failures }`. This crate pulls in no
//! randomness, so it links on `wasm32-unknown-unknown` without a getrandom
//! backend.

use wasm_bindgen::prelude::*;

/// Verify a `{ cert, transcript }` bundle given as JSON text. Never throws:
/// malformed input yields a report with `SCHEMA_INVALID` failures.
#[wasm_bindgen(js_name = verifyCertJson)]
pub fn verify_cert_json(cert_json: &str) -> String {
    let report = sealed_verdict_protocol::verify_cert_json(cert_json);
    serde_json::to_string(&report).unwrap_or_else(|e| {
        format!(
            "{{\"valid\":false,\"failures\":[\"SCHEMA_INVALID: report serialization failed: {}\"]}}",
            e.to_string().replace('\\', "\\\\").replace('"', "\\\"")
        )
    })
}

/// Protocol domain-separation version, e.g. `sv1`.
#[wasm_bindgen(js_name = protocolVersion)]
pub fn protocol_version() -> String {
    sealed_verdict_protocol::PROTOCOL_VERSION.to_string()
}
