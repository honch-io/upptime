import { test } from "node:test";
import assert from "node:assert/strict";
import { publicSnapshot, alertMessage } from "./pipeline-snapshot.mjs";

const payload = (state, extra = {}) => ({
  generatedAt: "2026-06-19T00:00:00.000Z",
  worker: { instances: 1 },
  backlog: { oldestUnackedSeconds: 14, undelivered: 320 },
  state,
  ...extra,
});

test("public snapshot keeps only state + timestamp (no raw numbers)", () => {
  const out = publicSnapshot(payload("operational"));
  assert.deepEqual(out, { generatedAt: "2026-06-19T00:00:00.000Z", state: "operational" });
  assert.equal("worker" in out, false);
  assert.equal("backlog" in out, false);
});

test("unrecognized/missing state falls back to unknown", () => {
  assert.equal(publicSnapshot({ state: "weird" }).state, "unknown");
  assert.equal(publicSnapshot({}).state, "unknown");
  assert.equal(publicSnapshot(null).state, "unknown");
});

test("no alert for healthy states", () => {
  assert.equal(alertMessage(payload("operational")), null);
  assert.equal(alertMessage(payload("degraded")), null);
});

test("alerts (with raw numbers) when behind", () => {
  const msg = alertMessage(payload("behind", { backlog: { oldestUnackedSeconds: 900, undelivered: 120000 } }));
  assert.match(msg, /BEHIND/);
  assert.match(msg, /15m/);
  assert.match(msg, /120,000/);
});

test("alerts when down", () => {
  const msg = alertMessage(payload("down", { worker: { instances: 0 } }));
  assert.match(msg, /DOWN/);
  assert.match(msg, /0 instances/);
});
