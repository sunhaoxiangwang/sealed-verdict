// Client for the Rust clerk_daemon: one child process, JSON lines on
// stdin/stdout, request ids matched to replies, stderr passed through.
// A daemon exit with requests in flight rejects them all and signals abort.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export class DaemonError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
    this.detail = message;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Default location of the debug binary built by `cargo build --manifest-path apps/actors/Cargo.toml`. */
export function defaultDaemonBinary() {
  return path.resolve(here, "../../target/debug/clerk_daemon");
}

export class DaemonClient {
  /**
   * @param {{ bin?: string, outDir?: string, onExit?: (code: number|null, signal: string|null) => void }} opts
   */
  constructor({ bin = defaultDaemonBinary(), outDir, onExit } = {}) {
    if (!existsSync(bin)) {
      throw new Error(`clerk_daemon binary not found at ${bin}; run cargo build --manifest-path apps/actors/Cargo.toml`);
    }
    const args = outDir ? ["--out", outDir] : [];
    this.child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.pending = new Map();
    this.nextId = 1;
    this.exited = null;
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[clerk_daemon] ${chunk}`));
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.#onLine(line));
    this.child.on("exit", (code, signal) => {
      this.exited = { code, signal };
      const err = new DaemonError("daemon_exit", `clerk_daemon exited (code ${code}, signal ${signal})`);
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      onExit?.(code, signal);
    });
  }

  #onLine(line) {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      process.stderr.write(`[bridge] unparseable daemon reply: ${line}\n`);
      return;
    }
    const p = this.pending.get(reply.id);
    if (!p) {
      process.stderr.write(`[bridge] reply for unknown id ${reply.id}\n`);
      return;
    }
    this.pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(new DaemonError(reply.error?.code ?? "unknown", reply.error?.message ?? ""));
  }

  /** Send one request and resolve with its `result`, or reject with DaemonError. */
  request(cmd, params = {}) {
    if (this.exited) {
      return Promise.reject(new DaemonError("daemon_exit", "clerk_daemon is no longer running"));
    }
    const id = `q${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, cmd, ...params }) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(new DaemonError("daemon_io", err.message));
        }
      });
    });
  }

  open(params) { return this.request("open", params); }
  sign(params) { return this.request("sign", params); }
  admit(kind, msg) { return this.request("admit", { kind, msg }); }
  tick(nowMs) { return this.request("tick", { nowMs }); }
  phase() { return this.request("phase"); }
  finish(outDir) { return this.request("finish", outDir ? { outDir } : {}); }

  close() {
    this.child.stdin.end();
  }
}
