// Merge a point-in-time ingestion-metrics payload from the backend into the
// committed history file (api/ingestion.json). Mirrors merge-latency.mjs:
// the endpoint is stateless; this accumulates the daily success-rate series.
//
// Usage: node scripts/merge-ingestion.mjs <payload.json> <target.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const MAX_DAYS = 90;

const EMPTY = () => ({
  generatedAt: null,
  freshnessSeconds: null,
  successRate24h: null,
  requestCount24h: null,
  history: [],
});

/** True when the payload is a usable backend response (not an error / failed fetch). */
export function isValidPayload(p) {
  return !!p && !p.error && "freshnessSeconds" in p;
}

export function mergeIngestion(existing, payload) {
  if (!isValidPayload(payload)) return existing; // no-op: keep last good data
  const base = existing && Array.isArray(existing.history) ? existing : EMPTY();

  const history = base.history.slice();
  const day = payload.today;
  if (day && day.date) {
    const entry = { date: day.date, successRate: day.successRate ?? null };
    const i = history.findIndex((h) => h.date === day.date);
    if (i >= 0) history[i] = entry;
    else history.push(entry);
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    generatedAt: payload.generatedAt ?? base.generatedAt,
    freshnessSeconds: payload.freshnessSeconds ?? null,
    successRate24h: payload.successRate24h ?? null,
    requestCount24h: payload.requestCount24h ?? null,
    history: history.slice(-MAX_DAYS),
  };
}

// --- CLI ---
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [payloadPath, targetPath] = process.argv.slice(2);
  if (!payloadPath || !targetPath) {
    console.error("usage: merge-ingestion.mjs <payload.json> <target.json>");
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  } catch (e) {
    console.error("invalid/missing payload, leaving history unchanged:", e.message);
    process.exit(0);
  }
  if (!isValidPayload(payload)) {
    console.error("payload not usable, leaving history unchanged");
    process.exit(0);
  }
  const existing = existsSync(targetPath)
    ? JSON.parse(readFileSync(targetPath, "utf8"))
    : EMPTY();
  const merged = mergeIngestion(existing, payload);
  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`updated ${targetPath}: freshness=${merged.freshnessSeconds}s success=${merged.successRate24h}% (${merged.history.length} days)`);
}
