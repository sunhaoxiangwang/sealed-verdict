// Encrypted signing intents for the live bridge. Node built-in crypto only.
//
// Why: on the pinned local Relay engine any workspace agent can read DM bodies
// through search, so a plaintext ballot intent is not blind. Jurors seal each
// intent to the case's recipient key, which they obtain and pin from the
// private token handoff; nothing on a public channel is a trusted key source.
//
// Wire format (all hex lowercase):
//   {
//     enc: "sv-intent-v1",
//     epk: <64 hex>   ephemeral X25519 public key, raw 32 bytes, fresh per intent
//     iv:  <24 hex>   AES-256-GCM IV, fresh random 12 bytes
//     ct:  <hex>      AES-256-GCM ciphertext followed by the full 16-byte tag
//   }
//
// Key schedule:
//   shared  = X25519(ephemeral private, recipient public)
//   context = UTF8(`${enc}\n${caseId}\n${senderId}\n${epk}`)
//   key     = HKDF-SHA256(ikm = shared, salt = UTF8("sealed-verdict/intent/v1"), info = context, 32 bytes)
//   plaintext = UTF8(JSON.stringify(intent)); AAD = context
//
// The context binds the protocol version, the case, the authenticated Relay
// sender id, and the ephemeral key into both the derived key and the GCM
// AAD, so an envelope cannot be replayed for another case or sender. Failures
// surface as Error with code "intent_invalid" and never carry plaintext or
// envelope contents.

import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const INTENT_ENC_VERSION = "sv-intent-v1";
export const INTENT_HKDF_SALT = "sealed-verdict/intent/v1";

const TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

class IntentInvalid extends Error {
  constructor() {
    super("intent_invalid");
    this.code = "intent_invalid";
  }
}

function invalid() {
  return new IntentInvalid();
}

function isHex(s, len) {
  return typeof s === "string" && s.length === len && /^[0-9a-f]+$/.test(s);
}

function requireText(v) {
  if (typeof v !== "string" || v.length === 0) throw invalid();
  return v;
}

/** Fresh X25519 recipient keypair; the private KeyObject must stay in memory. */
export function generateRecipientKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return { publicKeyHex: exportPublicKeyHex(publicKey), privateKey };
}

/** Raw 32-byte lowercase hex -> X25519 public KeyObject. */
export function importPublicKeyHex(hex) {
  if (!isHex(hex, 64)) throw invalid();
  const x = Buffer.from(hex, "hex").toString("base64url");
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "X25519", x }, format: "jwk" });
  } catch {
    throw invalid();
  }
}

/** X25519 public KeyObject -> raw 32-byte lowercase hex. */
export function exportPublicKeyHex(keyObject) {
  const jwk = keyObject.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

/** Deterministic HKDF info and GCM AAD shared by sealer and opener. */
export function intentContext({ caseId, senderId, epkHex }) {
  return Buffer.from(`${INTENT_ENC_VERSION}\n${caseId}\n${senderId}\n${epkHex}`, "utf8");
}

function deriveKey(privateKey, publicKey, context) {
  const shared = diffieHellman({ privateKey, publicKey });
  return Buffer.from(hkdfSync("sha256", shared, Buffer.from(INTENT_HKDF_SALT, "utf8"), context, KEY_BYTES));
}

/** Seal a JSON-serializable intent for the recipient with a fresh ephemeral key. */
export function sealIntent({ recipientPublicKeyHex, caseId, senderId, intent }) {
  requireText(caseId);
  requireText(senderId);
  const recipient = importPublicKeyHex(recipientPublicKeyHex);
  const eph = generateKeyPairSync("x25519");
  const epkHex = exportPublicKeyHex(eph.publicKey);
  const context = intentContext({ caseId, senderId, epkHex });
  const key = deriveKey(eph.privateKey, recipient, context);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(context);
  const body = Buffer.from(JSON.stringify(intent), "utf8");
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: INTENT_ENC_VERSION,
    epk: epkHex,
    iv: iv.toString("hex"),
    ct: Buffer.concat([ciphertext, tag]).toString("hex"),
  };
}

/** True iff `obj` has the encrypted-intent shape (version and string fields). */
export function isEncryptedIntent(obj) {
  return (
    obj !== null &&
    typeof obj === "object" &&
    obj.enc === INTENT_ENC_VERSION &&
    typeof obj.epk === "string" &&
    typeof obj.iv === "string" &&
    typeof obj.ct === "string"
  );
}

/** Open an envelope for the authenticated sender; any failure is `intent_invalid`. */
export function openIntent({ recipientPrivateKey, caseId, senderId, envelope }) {
  if (!isEncryptedIntent(envelope)) throw invalid();
  if (!isHex(envelope.epk, 64) || !isHex(envelope.iv, IV_BYTES * 2)) throw invalid();
  if (!isHex(envelope.ct, envelope.ct.length) || envelope.ct.length < TAG_BYTES * 2 || envelope.ct.length % 2 !== 0) {
    throw invalid();
  }
  requireText(caseId);
  requireText(senderId);
  const context = intentContext({ caseId, senderId, epkHex: envelope.epk });
  let plaintext;
  try {
    const epk = importPublicKeyHex(envelope.epk);
    const key = deriveKey(recipientPrivateKey, epk, context);
    const ct = Buffer.from(envelope.ct, "hex");
    const ciphertext = ct.subarray(0, ct.length - TAG_BYTES);
    const tag = ct.subarray(ct.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "hex"), { authTagLength: TAG_BYTES });
    decipher.setAAD(context);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw invalid();
  }
  try {
    const intent = JSON.parse(plaintext.toString("utf8"));
    if (intent === null || typeof intent !== "object") throw invalid();
    return intent;
  } catch {
    throw invalid();
  }
}
