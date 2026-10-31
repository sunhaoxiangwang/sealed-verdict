//! In-memory Sealed Verdict actors.
//!
//! * [`ledger::Ledger`]: append-only arrival-ordered transcript, chain head, certificate signer.
//! * [`clerk::Clerk`]: phase state machine with timeouts; admits messages through the shared
//!   protocol [`sealed_verdict_protocol::Engine`] and signs phase-close markers.
//! * [`oracle::Oracle`]: attests only the case context it was handed.
//! * [`juror::JurorShell`]: signing shell for commits, reveals and arguments. Juror
//!   orchestration (model calls, personas) lives in `apps/jurors`, owned by a teammate.
//! * [`runner`]: deterministic scripted full-case flow driven by a simulated clock.
//!
//! Nothing here touches the network, a database, or wall-clock time.

pub mod clerk;
pub mod clock;
pub mod error;
pub mod juror;
pub mod ledger;
pub mod oracle;
pub mod rng;
pub mod runner;

pub use clerk::{Clerk, PhaseInfo};
pub use clock::SimClock;
pub use error::ActorError;
pub use juror::JurorShell;
pub use ledger::Ledger;
pub use oracle::Oracle;
pub use runner::{run_case, write_case, CaseRun, CaseScript, Harness, JurorScript};
