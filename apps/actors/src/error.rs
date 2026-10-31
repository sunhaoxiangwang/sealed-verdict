use thiserror::Error;

#[derive(Debug, Error)]
pub enum ActorError {
    #[error("protocol: {0}")]
    Protocol(#[from] sealed_verdict_protocol::ProtocolError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown evidence source: {0}")]
    UnknownSource(String),
    #[error("case {0} has not reached its final phase close")]
    NotClosed(String),
    #[error("case {0} is already closed")]
    AlreadyClosed(String),
    #[error("juror {0} has no pending ballot for round {1}")]
    NoPendingBallot(String, u8),
    #[error("{0}")]
    Other(String),
}
