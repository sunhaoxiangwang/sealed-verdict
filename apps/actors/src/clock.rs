//! Simulated clock. Every actor reads time from here, so tests and the
//! scripted runner never sleep and phase timeouts are deterministic.

use std::cell::Cell;
use std::rc::Rc;

#[derive(Debug, Default)]
pub struct SimClock {
    t: Cell<u64>,
}

impl SimClock {
    pub fn new(start_ms: u64) -> Rc<Self> {
        Rc::new(Self {
            t: Cell::new(start_ms),
        })
    }

    pub fn now_ms(&self) -> u64 {
        self.t.get()
    }

    pub fn advance(&self, ms: u64) {
        self.t.set(self.t.get().saturating_add(ms));
    }

    pub fn set(&self, ms: u64) {
        self.t.set(ms);
    }
}
