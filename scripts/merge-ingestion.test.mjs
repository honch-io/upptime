import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIngestion,
  isValidPayload,
  MAX_DAYS,
  summarizeIngestionHistory,
} from "./merge-ingestion.mjs";

const payload = (date, successRate, freshness = 8) => ({
  generatedAt: "2026-06-18T14:00:00.000Z",
  freshnessSeconds: freshness,
  successRate24h: successRate,
  requestCount24h: 1000,
  today: { date, successRate },
});

test("copies current metrics and seeds today's history", () => {
  const out = mergeIngestion(undefined, payload("2026-06-18", 99.7));
  assert.equal(out.freshnessSeconds, 8);
  assert.equal(out.successRate24h, 99.7);
  assert.equal(out.requestCount24h, 1000);
  assert.equal(out.successRateWindow, 99.7);
  assert.equal(out.requestCountWindow, 1000);
  assert.equal(out.summaryWindowDays, MAX_DAYS);
  assert.deepEqual(out.history, [{ date: "2026-06-18", successRate: 99.7, requestCount: 1000 }]);
});

test("upserts the same day on repeated runs", () => {
  let s = mergeIngestion(undefined, payload("2026-06-18", 99.7));
  s = mergeIngestion(s, payload("2026-06-18", 99.9));
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].successRate, 99.9);
  assert.equal(s.history[0].requestCount, 1000);
});

test("appends new days sorted and trims to the cap", () => {
  let s;
  for (let i = 0; i < MAX_DAYS + 10; i++) {
    const date = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    s = mergeIngestion(s, payload(date, 99));
  }
  assert.equal(s.history.length, MAX_DAYS);
});

test("invalid payload leaves history untouched", () => {
  const good = mergeIngestion(undefined, payload("2026-06-18", 99.7));
  assert.equal(mergeIngestion(good, { error: "clickhouse unavailable" }), good);
  assert.equal(mergeIngestion(good, null), good);
  assert.equal(isValidPayload({ error: "x" }), false);
  assert.equal(isValidPayload(payload("2026-06-18", 99)), true);
});

test("preserves null success (monitoring unavailable) without breaking", () => {
  const out = mergeIngestion(undefined, { ...payload("2026-06-18", null), successRate24h: null });
  assert.equal(out.successRate24h, null);
  assert.equal(out.freshnessSeconds, 8);
  assert.equal(out.history[0].successRate, null);
});

test("summarizes success over the retained history window", () => {
  const history = [
    { date: "2026-06-01", successRate: 0, requestCount: 1000 },
    ...Array.from({ length: MAX_DAYS }, (_, i) => ({
      date: `2026-06-${String(i + 2).padStart(2, "0")}`,
      successRate: i === 0 ? 50 : 100,
      requestCount: i === 0 ? 20 : 10,
    })),
  ];

  const summary = summarizeIngestionHistory(history);

  assert.equal(summary.days, MAX_DAYS);
  assert.equal(summary.requestCount, 910);
  assert.equal(summary.successRate, 98.9);
});

test("does not drop the 14th day from the success summary", () => {
  const history = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    successRate: i === 0 ? 0 : 100,
    requestCount: 10,
  }));

  const summary = summarizeIngestionHistory(history);

  assert.equal(summary.days, 14);
  assert.equal(summary.requestCount, 140);
  assert.equal(summary.successRate, 92.86);
});

test("falls back to a daily-rate average for legacy history without counts", () => {
  const summary = summarizeIngestionHistory([
    { date: "2026-06-18", successRate: 80 },
    { date: "2026-06-19", successRate: 100 },
  ]);

  assert.equal(summary.days, 2);
  assert.equal(summary.requestCount, null);
  assert.equal(summary.successRate, 90);
});
