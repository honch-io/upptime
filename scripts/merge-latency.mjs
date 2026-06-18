// Merge a point-in-time ClickHouse latency payload from the backend into the
// committed history file (api/clickhouse-latency.json). The endpoint is
// stateless; this script accumulates the daily P95 series so the status page
// can show a ~90-day trend regardless of ClickHouse's query_log retention.
//
// Usage: node scripts/merge-latency.mjs <payload.json> <target.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const MAX_DAYS = 90;

const EMPTY = () => ({
  generatedAt: null,
  last24h: { p50: null, p95: null, p99: null, count: 0 },
  history: [],
});

/** True when the payload is a usable backend response (not an error / not a failed fetch). */
export function isValidPayload(p) {
  return !!p && !p.error && !!p.last24h && typeof p.last24h === "object";
}

/**
 * Pure merge: returns a new history object. `today` lets tests pin the date;
 * in production it comes from the payload.
 */
export function mergeLatency(existing, payload) {
  if (!isValidPayload(payload)) return existing; // no-op: keep last good data
  const base = existing && Array.isArray(existing.history) ? existing : EMPTY();

  const history = base.history.slice();
  const day = payload.today;
  if (day && day.date) {
    const entry = { date: day.date, p95: day.p95 ?? null, count: Number(day.count) || 0 };
    const i = history.findIndex((h) => h.date === day.date);
    if (i >= 0) history[i] = entry;
    else history.push(entry);
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    generatedAt: payload.generatedAt ?? base.generatedAt,
    last24h: payload.last24h,
    history: history.slice(-MAX_DAYS),
  };
}

// --- CLI ---
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [payloadPath, targetPath] = process.argv.slice(2);
  if (!payloadPath || !targetPath) {
    console.error("usage: merge-latency.mjs <payload.json> <target.json>");
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  } catch (e) {
    console.error("invalid/missing payload, leaving history unchanged:", e.message);
    process.exit(0); // don't clobber on a bad fetch
  }
  if (!isValidPayload(payload)) {
    console.error("payload not usable (error or empty), leaving history unchanged");
    process.exit(0);
  }
  const existing = existsSync(targetPath)
    ? JSON.parse(readFileSync(targetPath, "utf8"))
    : EMPTY();
  const merged = mergeLatency(existing, payload);
  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`updated ${targetPath}: ${merged.history.length} day(s) of history`);
}
