// Node test for the WASM verifier: shape checks that need no fixtures, plus
// native/WASM parity against fixtures/expected.json when fixtures exist.
//
//   node --test packages/protocol/js/verify.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

import { initNode, verifyCert, protocolVersion, isReady } from "./node.js";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const FIXTURE_NAMES = ["valid_cert.json", "tampered_cert.json", "no_quorum_cert.json"];

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}

function assertReportShape(report) {
  assert.deepEqual(Object.keys(report).sort(), ["failures", "valid"]);
  assert.equal(typeof report.valid, "boolean");
  assert.ok(Array.isArray(report.failures));
  for (const f of report.failures) assert.equal(typeof f, "string");
}

test("init is required and idempotent", async () => {
  assert.equal(isReady(), false);
  assert.throws(() => verifyCert({}), /await init\(\)/);
  await initNode();
  await initNode();
  assert.equal(isReady(), true);
  assert.equal(protocolVersion(), "sv1");
});

test("malformed input yields SCHEMA_INVALID without throwing", async () => {
  await initNode();
  const empty = verifyCert({});
  assertReportShape(empty);
  assert.equal(empty.valid, false);
  assert.ok(empty.failures.length > 0);
  assert.ok(empty.failures[0].startsWith("SCHEMA_INVALID"), empty.failures[0]);

  const hollow = verifyCert({ cert: {}, transcript: [] });
  assertReportShape(hollow);
  assert.equal(hollow.valid, false);
  assert.ok(hollow.failures.some((f) => f.startsWith("SCHEMA_INVALID")), hollow.failures.join("; "));

  for (const junk of [null, 42, "string", [], { cert: null, transcript: null }]) {
    const r = verifyCert(junk);
    assertReportShape(r);
    assert.equal(r.valid, false);
  }
});

test("undefined input yields SCHEMA_INVALID without throwing", async () => {
  await initNode();
  const report = verifyCert(undefined);
  assertReportShape(report);
  assert.equal(report.valid, false);
  assert.equal(report.failures.length, 1);
  assert.ok(report.failures[0].startsWith("SCHEMA_INVALID"), report.failures[0]);
});

test("BigInt-containing input yields SCHEMA_INVALID without throwing", async () => {
  await initNode();
  const report = verifyCert({ cert: { body: { n: 1n } }, transcript: [] });
  assertReportShape(report);
  assert.equal(report.valid, false);
  assert.ok(report.failures.some((f) => f.startsWith("SCHEMA_INVALID")), report.failures.join("; "));
});

test("circular input yields SCHEMA_INVALID without throwing", async () => {
  await initNode();
  const o = { cert: {} };
  o.self = o;
  const report = verifyCert(o);
  assertReportShape(report);
  assert.equal(report.valid, false);
  assert.ok(report.failures.some((f) => f.startsWith("SCHEMA_INVALID")), report.failures.join("; "));
});

test("WASM reports match native reports for every fixture", async (t) => {
  if (!(await exists(new URL("expected.json", FIXTURES)))) {
    t.skip("fixtures not generated yet; run pnpm fixtures");
    return;
  }
  await initNode();
  const expected = await loadJson("expected.json");
  for (const name of FIXTURE_NAMES) {
    assert.ok(name in expected, `expected.json has no entry for ${name}`);
    const bundle = await loadJson(name);
    const got = verifyCert(bundle);
    assertReportShape(got);
    assert.deepStrictEqual(got, expected[name], `parity failure for ${name}`);
  }
});

test("fixture semantics: valid passes, tampered breaks the chain, NO_QUORUM verifies", async (t) => {
  if (!(await exists(new URL("expected.json", FIXTURES)))) {
    t.skip("fixtures not generated yet; run pnpm fixtures");
    return;
  }
  await initNode();

  const valid = verifyCert(await loadJson("valid_cert.json"));
  assert.deepStrictEqual(valid, { valid: true, failures: [] });

  const tampered = verifyCert(await loadJson("tampered_cert.json"));
  assert.equal(tampered.valid, false);
  assert.ok(
    tampered.failures.some((f) => f.startsWith("TRANSCRIPT_ROOT_MISMATCH")),
    tampered.failures.join("; "),
  );

  const noQuorumBundle = await loadJson("no_quorum_cert.json");
  const noQuorum = verifyCert(noQuorumBundle);
  assert.deepStrictEqual(noQuorum, { valid: true, failures: [] });
  assert.equal(noQuorumBundle.cert.body.verdict, "NO_QUORUM");
});
