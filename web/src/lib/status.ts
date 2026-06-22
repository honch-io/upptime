/* ============================================================
   Honch status page — data layer over Upptime.

   The Upptime "backend" (GitHub Actions) keeps committing data to
   this repo. This module is a pure read-only client that fetches:
     1. history/summary.json   → service list, status, uptime, response
     2. history/<slug>.yml      → per-service startTime + daily down data
     3. api/incidents.json      → incidents cache (open = active, closed = resolved)
     4. api/{clickhouse-latency,ingestion,pipeline}.json → perf snapshots
   No server, no external CDN — data is read from raw.githubusercontent.
   ============================================================ */

export const REPO = "honch-io/upptime";
export const BRANCH = "master";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

export const HISTORY_DAYS = 90;
// A day counts as a "major" bar once cumulative downtime crosses this many
// minutes; anything down but below it shows as a partial degradation.
const MAJOR_MINUTES = 240;

const LATENCY_URL = `${RAW}/api/clickhouse-latency.json`;
const INGESTION_URL = `${RAW}/api/ingestion.json`;
const PIPELINE_URL = `${RAW}/api/pipeline.json`;

/* ---------- types ---------- */
export type ServiceStatus = "up" | "down" | "degraded";

export interface ServiceSummary {
  name: string;
  url: string;
  slug: string;
  status: ServiceStatus;
  uptime?: string;
  uptimeMonth?: string;
  time?: number;
  dailyMinutesDown?: Record<string, number>;
}

export type DayState = "ok" | "partial" | "major" | "nodata";
export interface DayCell {
  state: DayState;
  date: Date;
  minutes: number;
}

export interface IncidentUpdate {
  stage: string;
  at: Date;
  body: string; // pre-sanitized HTML
}
export interface Incident {
  ongoing: boolean;
  isMaint: boolean;
  title: string;
  affects: string[];
  updates: IncidentUpdate[];
}

export interface LatencyData {
  last24h?: { count?: number; p50?: number | null; p95?: number | null; p99?: number | null };
  history?: Array<{ p95?: number | null }>;
}
export interface IngestionData {
  freshnessSeconds?: number | null;
  successRate24h?: number | null;
  requestCount24h?: number | null;
  history?: Array<{ successRate?: number | null }>;
}
export type PipelineState = "operational" | "degraded" | "behind" | "down";
export interface PipelineData {
  state?: PipelineState;
}

/* ---------- thresholds + color helpers (return CSS var strings) ---------- */
const LATENCY_GOOD = 500;
const LATENCY_WARN = 2000;
export const latencyColor = (ms: number | null | undefined): string =>
  ms == null
    ? "var(--muted-foreground)"
    : ms < LATENCY_GOOD
      ? "var(--success)"
      : ms < LATENCY_WARN
        ? "var(--warning)"
        : "var(--destructive)";

export const successColor = (pct: number | null | undefined): string =>
  pct == null
    ? "var(--muted-foreground)"
    : pct >= 99.5
      ? "var(--success)"
      : pct >= 98
        ? "var(--warning)"
        : "var(--destructive)";

export const freshnessColor = (s: number | null | undefined): string =>
  s == null
    ? "var(--muted-foreground)"
    : s < 60
      ? "var(--success)"
      : s < 600
        ? "var(--warning)"
        : "var(--destructive)";

export const fmtAgo = (s: number | null | undefined): string =>
  s == null
    ? "—"
    : s < 90
      ? `${Math.round(s)}s`
      : s < 5400
        ? `${Math.round(s / 60)}m`
        : `${Math.round(s / 3600)}h`;

export const PIPELINE_META: Record<PipelineState, { label: string; color: string }> = {
  operational: { label: "Operational", color: "var(--success)" },
  degraded: { label: "Degraded", color: "var(--warning)" },
  behind: { label: "Falling behind", color: "var(--destructive)" },
  down: { label: "Down", color: "var(--destructive)" },
};

/* ---------- date formatting (UTC) ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
export const fmtShort = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
export const fmtTime = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
const dayKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/* ---------- status taxonomy ---------- */
export const STATUS_META: Record<ServiceStatus, { label: string; color: string; rank: number }> = {
  up: { label: "Operational", color: "var(--success)", rank: 0 },
  degraded: { label: "Degraded Performance", color: "var(--warning)", rank: 1 },
  down: { label: "Major Outage", color: "var(--destructive)", rank: 2 },
};
export const metaFor = (s: ServiceStatus) => STATUS_META[s] || STATUS_META.up;

/* ---------- tiny YAML reader for flat history files ---------- */
function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/* Embedded fallback so the page still renders if raw.githubusercontent is
   briefly unreachable. Replaced by live data on every successful fetch. */
const FALLBACK_SUMMARY: ServiceSummary[] = [
  { name: "Honch Website", url: "https://honch.io", slug: "honch-website", status: "up", uptime: "100.00%", uptimeMonth: "100.00%", time: 289, dailyMinutesDown: {} },
  { name: "Honch Dashboard", url: "https://app.honch.io", slug: "honch-dashboard", status: "up", uptime: "100.00%", uptimeMonth: "100.00%", time: 216, dailyMinutesDown: {} },
  { name: "Honch Ingest", url: "https://i.honch.io/health", slug: "honch-ingest", status: "up", uptime: "96.04%", uptimeMonth: "96.04%", time: 655, dailyMinutesDown: { "2026-06-16": 69 } },
  { name: "Honch Docs", url: "https://docs.honch.io", slug: "honch-docs", status: "up", uptime: "100.00%", uptimeMonth: "100.00%", time: 325, dailyMinutesDown: {} },
];

/* ---------- data fetching ---------- */
export async function fetchSummary(): Promise<ServiceSummary[]> {
  try {
    const r = await fetch(`${RAW}/history/summary.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as ServiceSummary[];
  } catch (e) {
    console.warn("summary.json unreachable, using embedded snapshot", e);
    return FALLBACK_SUMMARY;
  }
}

export async function fetchStartTime(slug: string): Promise<Date | null> {
  try {
    const r = await fetch(`${RAW}/history/${slug}.yml`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const y = parseFlatYaml(await r.text());
    return y.startTime ? new Date(y.startTime) : null;
  } catch {
    return null;
  }
}

interface RawIssue {
  title: string;
  state: string;
  labels?: Array<string | { name?: string }>;
  body?: string;
  created_at: string;
  closed_at?: string | null;
  commentsList?: Array<{ body?: string; created_at: string }>;
}

// Incidents are read from a committed cache (api/incidents.json), refreshed by
// the Cache Incidents workflow — avoids the unauthenticated GitHub API rate
// limit (60/hr/IP). null = unknown (don't claim "no incidents").
export async function fetchIncidents(): Promise<RawIssue[] | null> {
  try {
    const r = await fetch(`${RAW}/api/incidents.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    return Array.isArray(data.incidents) ? (data.incidents as RawIssue[]) : [];
  } catch (e) {
    console.warn("incidents.json unavailable", e);
    return null;
  }
}

export async function fetchLatency(): Promise<LatencyData | null> {
  try {
    const r = await fetch(LATENCY_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as LatencyData;
  } catch (e) {
    console.warn("clickhouse-latency.json unavailable", e);
    return null;
  }
}

export async function fetchIngestion(): Promise<IngestionData | null> {
  try {
    const r = await fetch(INGESTION_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as IngestionData;
  } catch (e) {
    console.warn("ingestion.json unavailable", e);
    return null;
  }
}

export async function fetchPipeline(): Promise<PipelineData | null> {
  try {
    const r = await fetch(PIPELINE_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as PipelineData;
  } catch (e) {
    console.warn("pipeline.json unavailable", e);
    return null;
  }
}

/* ---------- 90-day history bars from dailyMinutesDown ---------- */
export function buildDays(svc: ServiceSummary, startTime: Date | null, now: Date): DayCell[] {
  const down = svc.dailyMinutesDown || {};
  const days: DayCell[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    let state: DayState;
    if (
      startTime &&
      d < new Date(Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()))
    ) {
      state = "nodata";
    } else {
      const m = down[dayKey(d)];
      state = !m ? "ok" : m >= MAJOR_MINUTES ? "major" : "partial";
    }
    days.push({ state, date: new Date(d), minutes: down[dayKey(d)] || 0 });
  }
  return days;
}

/* ---------- incident text → safe HTML ---------- */
// Accept only http(s) URLs; defends against javascript:/data: payloads in
// incident text (which originates from publicly-openable GitHub issues).
function safeHttpUrl(u: string): string | null {
  try {
    const url = new URL(String(u).trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
function inlineFmt(s: string): string {
  return s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
// Render the small Markdown subset Upptime writes (commit links, bold, code,
// bullet lists) into safe HTML. Each part is escaped/validated as it is emitted.
export function mdToHtml(raw: string): string {
  const src = (raw || "").trim();
  const re = /\[([^\]]+)\]\(\s*([^\s)]+)\s*\)/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += inlineFmt(esc(src.slice(last, m.index)));
    const safe = safeHttpUrl(m[2]);
    const label = inlineFmt(esc(m[1]));
    out += safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${label}</a>` : label;
    last = re.lastIndex;
  }
  out += inlineFmt(esc(src.slice(last)));
  return out
    .replace(/^\s*-\s+/gm, "• ")
    .replace(/\n{2,}/g, "\n")
    .replace(/\n/g, "<br>");
}

// Classify an Upptime update by its text.
function stageOf(text: string): string {
  const s = text || "";
  if (/\*\*resolved:?\*\*|is back up|back online|recovered/i.test(s)) return "resolved";
  if (/\*\*down\*\*|is down|was down|degraded/i.test(s)) return "detected";
  return "update";
}

const EMOJI_PREFIX = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}🟥🟧🟨🟩⬛️]+/u;

export function buildIncident(issue: RawIssue, services: ServiceSummary[]): Incident {
  const comments = issue.commentsList || [];
  const ongoing = issue.state === "open";
  const title = issue.title.replace(EMOJI_PREFIX, "").trim() || issue.title;

  const labelNames = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name || ""));
  const isMaint = labelNames.some((l) => /maintenance/i.test(l)) || /maintenance/i.test(title);
  const affects = services
    .filter(
      (s) =>
        labelNames.some((l) => l.toLowerCase() === (s.slug || "").toLowerCase()) ||
        issue.title.toLowerCase().includes(s.name.toLowerCase()),
    )
    .map((s) => s.name);

  const updates: IncidentUpdate[] = [];
  const bodyText = (issue.body || "").trim();
  updates.push({
    stage: stageOf(bodyText),
    at: new Date(issue.created_at),
    body: mdToHtml(bodyText || "Investigating reported issue."),
  });
  for (const c of comments) {
    const ct = (c.body || "").trim();
    updates.push({ stage: stageOf(ct), at: new Date(c.created_at), body: mdToHtml(ct) });
  }
  if (!ongoing && issue.closed_at && !updates.some((u) => u.stage === "resolved")) {
    updates.push({ stage: "resolved", at: new Date(issue.closed_at), body: "This incident has been resolved." });
  }
  updates.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { ongoing, isMaint, title, affects, updates };
}

/* ---------- sparkline geometry (returns SVG path strings) ---------- */
export interface Spark {
  line: string;
  area: string;
  viewBox: string;
}
export function sparklinePaths(values: Array<number | null | undefined>): Spark | null {
  const vals = (values || []).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const W = 600;
  const H = 50;
  const pad = 4;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area =
    `M${x(0).toFixed(1)},${(H - pad).toFixed(1)} ` +
    vals.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") +
    ` L${x(vals.length - 1).toFixed(1)},${(H - pad).toFixed(1)} Z`;
  return { line, area, viewBox: `0 0 ${W} ${H}` };
}

/* ---------- orchestration ---------- */
export interface StatusData {
  now: Date;
  services: ServiceSummary[];
  daysBySlug: Record<string, DayCell[]>;
  incidents: Incident[] | null;
  openCount: number;
  latency: LatencyData | null;
  ingestion: IngestionData | null;
  pipeline: PipelineData | null;
}

export async function loadAll(): Promise<StatusData> {
  const now = new Date();
  const services = await fetchSummary();

  const starts = await Promise.all(services.map((s) => fetchStartTime(s.slug)));
  const daysBySlug: Record<string, DayCell[]> = {};
  services.forEach((s, i) => {
    daysBySlug[s.slug] = buildDays(s, starts[i], now);
  });

  const cached = await fetchIncidents();
  let incidents: Incident[] | null = null;
  let openCount = 0;
  if (cached) {
    incidents = cached.map((i) => buildIncident(i, services));
    openCount = incidents.filter((i) => i.ongoing).length;
  }

  const [ingestion, pipeline, latency] = await Promise.all([
    fetchIngestion(),
    fetchPipeline(),
    fetchLatency(),
  ]);

  return { now, services, daysBySlug, incidents, openCount, latency, ingestion, pipeline };
}
