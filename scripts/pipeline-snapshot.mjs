// Snapshot the backend's /health/pipeline reading for the status page.
//
// Audience split: the committed api/pipeline.json is PUBLIC, so it carries only
// the coarse state word (operational/degraded/behind/down) — never the raw
// backlog seconds / message counts. Those raw numbers go to the internal Slack
// alert (returned by alertMessage), not to the public file.
//
// Usage: node scripts/pipeline-snapshot.mjs <payload.json> <public-out.json> <alert-out.txt>
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const ALERT_STATES = new Set(["behind", "down"]);

/** Coarse, public-safe snapshot: state word + timestamp only. */
export function publicSnapshot(payload) {
  const valid = ["operational", "degraded", "behind", "down", "unknown"];
  const state = valid.includes(payload?.state) ? payload.state : "unknown";
  return { generatedAt: payload?.generatedAt ?? null, state };
}

/** Internal Slack alert text when the pipeline is behind/down, else null. */
export function alertMessage(payload) {
  const s = payload?.state;
  if (!ALERT_STATES.has(s)) return null;
  const w = payload.worker ?? {};
  const b = payload.backlog ?? {};
  if (s === "down") {
    return `🔴 Ingestion pipeline DOWN — honch-worker is at ${w.instances ?? 0} instances; events are not being processed.`;
  }
  const mins =
    b.oldestUnackedSeconds != null
      ? `${Math.round(b.oldestUnackedSeconds / 60)}m`
      : "?";
  const undelivered =
    b.undelivered != null ? b.undelivered.toLocaleString() : "?";
  return `🟠 Ingestion pipeline BEHIND — oldest unacked ${mins}, ${undelivered} undelivered messages. Consider scaling honch-worker.`;
}

// --- CLI ---
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [payloadPath, publicOut, alertOut] = process.argv.slice(2);
  if (!payloadPath || !publicOut || !alertOut) {
    console.error("usage: pipeline-snapshot.mjs <payload.json> <public-out.json> <alert-out.txt>");
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  } catch (e) {
    console.error("invalid/missing payload, leaving snapshot unchanged:", e.message);
    process.exit(0);
  }
  if (payload?.error) {
    console.error("endpoint returned an error, leaving snapshot unchanged:", payload.error);
    process.exit(0);
  }
  writeFileSync(publicOut, JSON.stringify(publicSnapshot(payload), null, 2) + "\n");
  const alert = alertMessage(payload);
  if (alert) writeFileSync(alertOut, alert + "\n");
  else rmSync(alertOut, { force: true });
  console.log(`pipeline state: ${publicSnapshot(payload).state}${alert ? " (alerting)" : ""}`);
}
