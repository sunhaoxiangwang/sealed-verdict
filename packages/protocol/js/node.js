// Node entry for @sealed-verdict/protocol. Kept separate from index.js so the
// browser entry never imports Node built-ins.
//
//   import { initNode, verifyCert } from "@sealed-verdict/protocol/node";
//   await initNode();
//   verifyCert(bundle); // -> { valid, failures }

import { readFile } from "node:fs/promises";
import { init, isReady, protocolVersion, verifyCert } from "./index.js";

const WASM_URL = new URL("../wasm/pkg/sealed_verdict_protocol_bg.wasm", import.meta.url);

/** Load the committed .wasm from disk and initialize the verifier. Idempotent. */
export async function initNode() {
  if (isReady()) return;
  const bytes = await readFile(WASM_URL);
  await init(bytes);
}

export { init, isReady, protocolVersion, verifyCert };
