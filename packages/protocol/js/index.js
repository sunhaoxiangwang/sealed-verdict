// Browser-safe entry for @sealed-verdict/protocol.
//
// Usage:
//   import { init, verifyCert } from "@sealed-verdict/protocol";
//   await init();                 // browser: fetches the sibling .wasm next to this module
//   const { valid, failures } = verifyCert(certBundle);   // synchronous after init
//
// Node callers use "@sealed-verdict/protocol/node" (initNode reads the .wasm bytes),
// or pass bytes here: await init(await readFile(wasmPath)).
//
// This module imports nothing from Node so bundlers can ship it to browsers as-is.

import initWasm, {
  verifyCertJson,
  protocolVersion as wasmProtocolVersion,
} from "../wasm/pkg/sealed_verdict_protocol.js";

let ready = false;
let pending = null;

/**
 * Initialize the verifier. Idempotent: concurrent and repeated calls share one load.
 *
 * @param {RequestInfo | URL | Response | BufferSource | WebAssembly.Module | undefined} input
 *   undefined  -> fetch "sealed_verdict_protocol_bg.wasm" relative to the generated glue (browsers, Vite, etc.)
 *   URL/string -> fetched
 *   Response   -> instantiated (streaming when the server sends application/wasm)
 *   bytes      -> WebAssembly.instantiate(bytes) directly (Node: readFile(...) output works)
 */
export async function init(input) {
  if (ready) return;
  if (!pending) {
    // The generated glue accepts a bare argument but logs a deprecation warning; the
    // object form is the supported one. `undefined` must stay undefined so the glue
    // falls back to its import.meta.url-relative default.
    const arg = input === undefined ? undefined : { module_or_path: input };
    pending = initWasm(arg)
      .then(() => {
        ready = true;
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  await pending;
}

/** True once init() has resolved. */
export function isReady() {
  return ready;
}

/**
 * Verify a `{ cert, transcript }` bundle exactly as written by run_case or shipped in fixtures.
 * Synchronous after init(). Never throws on malformed certificate content; malformed input
 * yields `{ valid: false, failures: ["SCHEMA_INVALID: ..."] }`.
 *
 * @param {object} cert
 * @returns {{ valid: boolean, failures: string[] }}
 */
export function verifyCert(cert) {
  if (!ready) {
    throw new Error(
      "@sealed-verdict/protocol: call `await init()` (or initNode()) before verifyCert()",
    );
  }
  const { valid, failures } = JSON.parse(verifyCertJson(JSON.stringify(cert)));
  return { valid, failures };
}

/** Protocol domain-separation version string, e.g. "sv1". Requires init(). */
export function protocolVersion() {
  if (!ready) {
    throw new Error("@sealed-verdict/protocol: call `await init()` before protocolVersion()");
  }
  return wasmProtocolVersion();
}
