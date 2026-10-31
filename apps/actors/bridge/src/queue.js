// One serialized work queue per case. DMs, received channel envelopes, and
// wall-clock ticks all pass through it in arrival order, so admission and
// Terse persistence never interleave. Ordinary task errors (for example a
// daemon rejecting a juror's out-of-phase intent) propagate only to that
// task's caller. Infrastructure failures are signalled with `abort(err)`,
// after which every later task rejects with the same error.

export function createCaseQueue({ onAbort } = {}) {
  let tail = Promise.resolve();
  let aborted = null;
  let depth = 0;
  return {
    /** Enqueue `fn`; resolves or rejects with its own outcome, in order. */
    run(label, fn) {
      if (aborted) return Promise.reject(aborted);
      depth += 1;
      const p = tail.then(async () => {
        depth -= 1;
        if (aborted) throw aborted;
        return fn();
      });
      tail = p.catch(() => {});
      p.label = label;
      return p;
    },
    /** Mark the case aborted: pending and future tasks reject with `err`. */
    abort(err) {
      if (!aborted) {
        aborted = err;
        onAbort?.(err);
      }
    },
    get aborted() {
      return aborted;
    },
    get pending() {
      return depth;
    },
    /** Resolves once every task enqueued so far has settled. */
    idle() {
      return tail;
    },
  };
}
