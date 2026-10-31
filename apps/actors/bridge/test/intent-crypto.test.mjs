// Unit tests for the encrypted signing-intent helper (node:crypto only).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTENT_ENC_VERSION,
  generateRecipientKeypair,
  importPublicKeyHex,
  exportPublicKeyHex,
  intentContext,
  sealIntent,
  openIntent,
  isEncryptedIntent,
} from "../src/intent-crypto.js";

const caseId = "case-crypto-1";
const senderId = "242390000000000001";
const VOTE = "ans2-very-secret-ballot";
const intent = { kind: "commit", round: 0, vote: VOTE, confidence: 73 };

function flipHexNibble(hex, index) {
  const chars = hex.split("");
  chars[index] = chars[index] === "0" ? "1" : "0";
  return chars.join("");
}

function expectInvalid(fn) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, "expected an Error");
  assert.equal(err.code, "intent_invalid");
  assert.ok(!err.message.includes(VOTE), "error message must not contain the vote");
  assert.ok(!/epk|ct|iv|ans2/.test(err.message) || err.message === "intent_invalid", "error message must not carry envelope contents");
  return err;
}

test("keys roundtrip through raw hex", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  assert.match(publicKeyHex, /^[0-9a-f]{64}$/);
  assert.equal(privateKey.type, "private");
  assert.equal(exportPublicKeyHex(importPublicKeyHex(publicKeyHex)), publicKeyHex);
  assert.deepEqual(
    intentContext({ caseId, senderId, epkHex: "ab".repeat(32) }),
    Buffer.from(`${INTENT_ENC_VERSION}\n${caseId}\n${senderId}\n${"ab".repeat(32)}`, "utf8"),
  );
});

test("seal and open roundtrip; envelope has the frozen shape", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  assert.deepEqual(Object.keys(env).sort(), ["ct", "enc", "epk", "iv"]);
  assert.equal(env.enc, "sv-intent-v1");
  assert.match(env.epk, /^[0-9a-f]{64}$/);
  assert.match(env.iv, /^[0-9a-f]{24}$/);
  assert.match(env.ct, /^[0-9a-f]+$/);
  assert.ok(env.ct.length >= 32);
  assert.ok(!env.ct.includes(Buffer.from(VOTE, "utf8").toString("hex")), "ciphertext must not contain the plaintext vote");
  assert.ok(isEncryptedIntent(env));
  const opened = openIntent({ recipientPrivateKey: privateKey, caseId, senderId, envelope: env });
  assert.deepEqual(opened, intent);
});

test("two seals of the same intent differ in epk, iv and ct", () => {
  const { publicKeyHex } = generateRecipientKeypair();
  const a = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  const b = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  assert.notEqual(a.epk, b.epk);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test("modified ciphertext byte fails with intent_invalid", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  const tampered = { ...env, ct: flipHexNibble(env.ct, 0) };
  expectInvalid(() => openIntent({ recipientPrivateKey: privateKey, caseId, senderId, envelope: tampered }));
});

test("modified authentication tag byte fails with intent_invalid", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  const tampered = { ...env, ct: flipHexNibble(env.ct, env.ct.length - 1) };
  expectInvalid(() => openIntent({ recipientPrivateKey: privateKey, caseId, senderId, envelope: tampered }));
});

test("wrong caseId fails", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  expectInvalid(() => openIntent({ recipientPrivateKey: privateKey, caseId: "other-case", senderId, envelope: env }));
});

test("wrong senderId fails", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  expectInvalid(() => openIntent({ recipientPrivateKey: privateKey, caseId, senderId: "242390000000000002", envelope: env }));
});

test("wrong recipient key fails", () => {
  const { publicKeyHex } = generateRecipientKeypair();
  const other = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  expectInvalid(() => openIntent({ recipientPrivateKey: other.privateKey, caseId, senderId, envelope: env }));
});

test("wrong version, missing field, and bad hex lengths fail", () => {
  const { publicKeyHex, privateKey } = generateRecipientKeypair();
  const env = sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent });
  const open = (envelope) => openIntent({ recipientPrivateKey: privateKey, caseId, senderId, envelope });
  expectInvalid(() => open({ ...env, enc: "sv-intent-v0" }));
  expectInvalid(() => open({ ...env, enc: undefined }));
  const { ct: _ct, ...noCt } = env;
  expectInvalid(() => open(noCt));
  const { iv: _iv, ...noIv } = env;
  expectInvalid(() => open(noIv));
  expectInvalid(() => open({ ...env, epk: env.epk.slice(0, 62) }));
  expectInvalid(() => open({ ...env, iv: env.iv + "00" }));
  expectInvalid(() => open({ ...env, ct: env.ct.slice(0, 30) }));
  expectInvalid(() => open({ ...env, ct: env.ct.slice(0, -1) }));
  expectInvalid(() => open({ ...env, epk: env.epk.slice(0, 63) + "G" }));
  expectInvalid(() => open(null));
  expectInvalid(() => open("not an envelope"));
  expectInvalid(() => open({ kind: "commit", round: 0, vote: VOTE }));
  expectInvalid(() => sealIntent({ recipientPublicKeyHex: "zz".repeat(32), caseId, senderId, intent }));
  expectInvalid(() => sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId: "", senderId, intent }));
});

test("isEncryptedIntent distinguishes envelopes from plaintext intents", () => {
  const { publicKeyHex } = generateRecipientKeypair();
  assert.equal(isEncryptedIntent(sealIntent({ recipientPublicKeyHex: publicKeyHex, caseId, senderId, intent })), true);
  assert.equal(isEncryptedIntent(intent), false);
  assert.equal(isEncryptedIntent(null), false);
  assert.equal(isEncryptedIntent("sv-intent-v1"), false);
  assert.equal(isEncryptedIntent({ enc: "sv-intent-v1", epk: "aa", iv: 12, ct: "bb" }), false);
  assert.equal(isEncryptedIntent({ enc: "sv-intent-v2", epk: "aa", iv: "bb", ct: "cc" }), false);
});
