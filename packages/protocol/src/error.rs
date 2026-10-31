use thiserror::Error;

/// Errors raised by protocol primitives. The verifier never surfaces these
/// directly; it maps them onto stable failure codes.
#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("canonical encoding forbids non-integer numbers")]
    FloatNotAllowed,
    #[error("bad hex: {0}")]
    Hex(String),
    #[error("bad public key: {0}")]
    Key(String),
    #[error("signature or signer missing")]
    MissingSignature,
    #[error("signature verification failed")]
    BadSignature,
    #[error("invalid: {0}")]
    Invalid(String),
}
