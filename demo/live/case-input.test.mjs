import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCase } from "./case-input.mjs";
const example = JSON.parse(readFileSync(new URL("../data/td-bank-public-case.json", import.meta.url)));
test("downloadable example preserves all admitted evidence", () => {
  assert.deepEqual(validateCase(example).context, example.context);
});
test("rejects evidence that the protocol would truncate", () => {
  assert.throws(() => validateCase({ ...example, context: [{ source: "record", content: "x".repeat(241) }] }), /240/);
});
test("rejects ambiguous sources and unsafe source links", () => {
  assert.throws(() => validateCase({ ...example, context: [example.context[0], example.context[0]] }), /distinct/);
  assert.throws(() => validateCase({ ...example, source: "javascript:alert(1)" }), /HTTP/);
  assert.throws(() => validateCase(null), /object/);
});
