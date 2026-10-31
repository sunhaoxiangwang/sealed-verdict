import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Signed } from "./types";

// Synchronous ed25519 (noble v3): enable sync sha512.
ed.hashes.sha512 = sha512;

export function genKeypair(): { pub: string; priv: Uint8Array } {
  const priv = ed.utils.randomSecretKey();
  return { pub: bytesToHex(ed.getPublicKey(priv)), priv };
}

// Stable JSON: object keys sorted recursively.
export function canonical(body: unknown): string {
  if (body === null || typeof body !== "object") return JSON.stringify(body) ?? "null";
  if (Array.isArray(body)) return `[${body.map(canonical).join(",")}]`;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const sha256hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));

export function sign<T>(body: T, priv: Uint8Array, signer: string): Signed<T> {
  const sig = ed.sign(sha256(utf8ToBytes(canonical(body))), priv);
  return { body, sig: "ed25519:" + bytesToHex(sig), signer };
}

export function verify(signed: Signed<unknown>, pub: string): boolean {
  try {
    if (!signed.sig.startsWith("ed25519:")) return false;
    const sig = hexToBytes(signed.sig.slice(8));
    return ed.verify(sig, sha256(utf8ToBytes(canonical(signed.body))), hexToBytes(pub));
  } catch {
    return false;
  }
}

export const chainHash = (prevHash: string, body: unknown): string => sha256hex(prevHash + canonical(body));

export const GENESIS = sha256hex("sealed-verdict:genesis");
