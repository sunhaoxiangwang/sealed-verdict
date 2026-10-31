//! Live-case daemon binary. Reads one JSON request per stdin line, writes one
//! JSON reply per stdout line, logs only to stderr, exits 0 at EOF. One
//! process serves one fresh case; see `daemon.rs` for the command contract.
//!
//! Usage: clerk_daemon [--out DIR]

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use sealed_verdict_actors::daemon::Daemon;

fn main() -> ExitCode {
    let mut out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("out");
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--out" => out = PathBuf::from(args.next().expect("--out needs a directory")),
            _ => {
                eprintln!("usage: clerk_daemon [--out DIR]");
                return ExitCode::from(2);
            }
        }
    }
    let mut daemon = Daemon::new(out);
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut w = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("clerk_daemon: stdin error: {e}");
                return ExitCode::FAILURE;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = daemon.handle(&line);
        if writeln!(w, "{reply}").and_then(|_| w.flush()).is_err() {
            eprintln!("clerk_daemon: stdout closed");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
