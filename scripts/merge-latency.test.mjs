import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLatency, isValidPayload, MAX_DAYS } from "./merge-latency.mjs";

const payload = (date, p95, count = 100) => ({
  generatedAt: "2026-06-18T14:00:00.000Z",
  last24h: { p50: 38, p95: 142, p99: 411, count: 51234 },
  today: { date, p95, count },
});

test("adds today's entry to empty history and copies last24h", () => {
  const out = mergeLatency(undefined, payload("2026-06-18", 150));
  assert.deepEqual(out.history, [{ date: "2026-06-18", p95: 150, count: 100 }]);
  assert.equal(out.last24h.p95, 142);
  assert.equal(out.generatedAt, "2026-06-18T14:00:00.000Z");
});

test("upserts (not duplicates) the same day on repeated runs", () => {
  let state = mergeLatency(undefined, payload("2026-06-18", 150, 100));
  state = mergeLatency(state, payload("2026-06-18", 180, 250)); // later same-day run
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.history[0], { date: "2026-06-18", p95: 180, count: 250 });
});

test("appends new days in sorted order", () => {
  let state = mergeLatency(undefined, payload("2026-06-17", 120));
  state = mergeLatency(state, payload("2026-06-18", 150));
  assert.deepEqual(state.history.map((h) => h.date), ["2026-06-17", "2026-06-18"]);
});

test(`trims history to the last ${MAX_DAYS} days`, () => {
  let state;
  for (let i = 0; i < MAX_DAYS + 15; i++) {
    const d = `2026-01-${String((i % 28) + 1).padStart(2, "0")}`;
    // unique dates across months so we actually exceed the cap
    const date = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    state = mergeLatency(state, payload(date, 100 + i));
  }
  assert.equal(state.history.length, MAX_DAYS);
});

test("invalid payloads leave existing history untouched (no clobber)", () => {
  const good = mergeLatency(undefined, payload("2026-06-18", 150));
  assert.equal(mergeLatency(good, { error: "clickhouse unavailable" }), good);
  assert.equal(mergeLatency(good, null), good);
  assert.equal(mergeLatency(good, {}), good);
  assert.equal(isValidPayload({ error: "x" }), false);
  assert.equal(isValidPayload(payload("2026-06-18", 1)), true);
});

test("preserves null p95 (e.g. early-day with no queries yet)", () => {
  const out = mergeLatency(undefined, payload("2026-06-18", null, 0));
  assert.equal(out.history[0].p95, null);
  assert.equal(out.history[0].count, 0);
});
