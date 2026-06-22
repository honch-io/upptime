import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon, TriangleAlertIcon, WrenchIcon, XIcon } from "lucide-react";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SubscribeDialog } from "@/components/SubscribeDialog";
import { Sparkline } from "@/components/Sparkline";
import {
  fmt,
  fmtAgo,
  fmtShort,
  fmtTime,
  freshnessColor,
  HISTORY_DAYS,
  type DayCell,
  type Incident,
  type IngestionData,
  type LatencyData,
  type PipelineData,
  type ServiceSummary,
  latencyColor,
  loadAll,
  metaFor,
  PIPELINE_META,
  REPO,
  type StatusData,
  successColor,
} from "@/lib/status";

/* ---------- shared presentational bits ---------- */
function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  color?: string;
}) {
  return (
    <div>
      <div className="font-medium text-muted-foreground text-xs">{label}</div>
      <div
        className="mt-1.5 font-bold text-2xl leading-none tracking-tight tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="mt-1 text-muted-foreground text-xs">{sub}</div>
    </div>
  );
}

const BAR_COLOR: Record<DayCell["state"], string> = {
  ok: "var(--success)",
  partial: "var(--warning)",
  major: "var(--destructive)",
  nodata: "color-mix(in srgb, var(--muted-foreground) 22%, transparent)",
};
const BAR_LABEL: Record<DayCell["state"], string> = {
  ok: "Operational",
  partial: "Partial degradation",
  major: "Major outage",
  nodata: "No data",
};
const BADGE_VARIANT = { up: "success", degraded: "warning", down: "error" } as const;

/* ---------- top bar ---------- */
function TopBar() {
  return (
    <div className="flex items-center justify-between pb-7">
      <a className="flex items-center gap-3 no-underline" href="/">
        <span className="block size-8 overflow-hidden rounded-lg shadow-sm">
          <img src="/logo.svg" alt="Honch" width={32} height={32} className="size-full object-cover" />
        </span>
        <span className="leading-tight">
          <span className="block font-semibold text-foreground text-sm tracking-tight">Honch</span>
          <span className="block font-medium text-muted-foreground text-xs">System Status</span>
        </span>
      </a>
      <SubscribeDialog />
    </div>
  );
}

/* ---------- hero ---------- */
const HERO_ICON = [CheckIcon, TriangleAlertIcon, XIcon];
function Hero({ services, now }: { services: ServiceSummary[]; now: Date }) {
  const worst = services.reduce((a, s) => Math.max(a, metaFor(s.status).rank), 0);
  const [title, color] =
    worst === 0
      ? ["All systems operational", "var(--success)"]
      : worst === 1
        ? ["Partial system degradation", "var(--warning)"]
        : ["Major service outage", "var(--destructive)"];
  const bad = services.filter((s) => metaFor(s.status).rank > 0);
  const sub =
    worst === 0
      ? `All ${services.length} services are operating normally`
      : `${bad.length} service${bad.length === 1 ? "" : "s"} affected · ${bad.map((s) => s.name).join(", ")}`;
  const Icon = HERO_ICON[worst];

  return (
    <Frame>
      <FramePanel className="flex items-center gap-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          <Icon className="size-6" strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <h1 className="font-semibold text-foreground text-xl tracking-tight">{title}</h1>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {sub} · Updated {fmt(now)} · {fmtTime(now)}
          </p>
        </div>
      </FramePanel>
    </Frame>
  );
}

/* ---------- KPI stats ---------- */
function StatsGrid({ services, openCount }: { services: ServiceSummary[]; openCount: number }) {
  const upCount = services.filter((s) => s.status === "up").length;
  const avgUptime = services.length
    ? services.reduce((a, s) => a + parseFloat(s.uptime || s.uptimeMonth || "0"), 0) / services.length
    : 0;
  const avgResp = services.length
    ? Math.round(services.reduce((a, s) => a + (Number(s.time) || 0), 0) / services.length)
    : 0;

  const cards = [
    { label: "Overall uptime", value: `${avgUptime.toFixed(2)}%`, sub: `across ${services.length} services` },
    { label: "Avg response time", value: <>{avgResp} <span className="font-semibold text-base">ms</span></>, sub: "last check" },
    { label: "Active incidents", value: `${openCount}`, sub: openCount ? "in progress" : "all clear" },
    { label: "Services up", value: `${upCount}/${services.length}`, sub: "operational now" },
  ];

  return (
    <Frame className="mt-4 grid grid-cols-2 gap-1 lg:grid-cols-4 [&>[data-slot=frame-panel]+[data-slot=frame-panel]]:mt-0">
      {cards.map((c) => (
        <FramePanel key={c.label}>
          <Stat label={c.label} value={c.value} sub={c.sub} />
        </FramePanel>
      ))}
    </Frame>
  );
}

/* ---------- services ---------- */
function HistoryBars({ days, uptime }: { days: DayCell[]; uptime: string }) {
  const realDays = days.filter((d) => d.state !== "nodata");
  const leftLabel = realDays[0] ? fmtShort(realDays[0].date) : `${HISTORY_DAYS} days ago`;
  return (
    <>
      <div className="mt-3.5 flex h-8 items-stretch gap-0.5">
        {days.map((d, i) => (
          <div
            key={i}
            className="min-w-0 flex-1 rounded-[2px] transition-transform hover:scale-y-110"
            style={{ background: BAR_COLOR[d.state] }}
            title={`${fmtShort(d.date)} · ${BAR_LABEL[d.state]}${d.minutes ? ` · ${d.minutes} min down` : ""}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground/80">
        <span>{leftLabel}</span>
        <span className="font-semibold text-foreground">{uptime} uptime</span>
        <span>Today</span>
      </div>
    </>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function ServicesFrame({
  services,
  daysBySlug,
}: {
  services: ServiceSummary[];
  daysBySlug: Record<string, DayCell[]>;
}) {
  return (
    <Frame className="mt-8">
      <FrameHeader className="flex-row items-center justify-between">
        <FrameTitle className="text-[15px]">Current status by service</FrameTitle>
        <FrameDescription className="text-xs">Auto-refreshes every 60s</FrameDescription>
      </FrameHeader>
      {services.map((s) => {
        const meta = metaFor(s.status);
        const uptime = s.uptime || s.uptimeMonth || "—";
        return (
          <FramePanel key={s.slug}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="truncate font-medium text-[15px] tracking-tight">{s.name}</span>
                <span className="hidden truncate text-muted-foreground text-xs sm:inline">
                  {(s.url || "").replace(/^https?:\/\//, "")}
                </span>
              </div>
              <Badge variant={BADGE_VARIANT[s.status]} size="lg" className="shrink-0 gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                {meta.label}
              </Badge>
            </div>
            <HistoryBars days={daysBySlug[s.slug] || []} uptime={uptime} />
          </FramePanel>
        );
      })}
      <FrameFooter>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs">
          <LegendKey color="var(--success)" label="Operational" />
          <LegendKey color="var(--warning)" label="Degraded" />
          <LegendKey color="var(--destructive)" label="Outage" />
          <LegendKey color="color-mix(in srgb, var(--muted-foreground) 22%, transparent)" label="No data" />
        </div>
      </FrameFooter>
    </Frame>
  );
}

/* ---------- performance frames ---------- */
function QueryPerfFrame({ data }: { data: LatencyData | null }) {
  const l = data?.last24h;
  if (!l || !l.count) return null;
  const histVals = (data?.history || []).filter((d) => d.p95 != null).map((d) => d.p95 as number);
  const cells = [
    { label: "Median (P50)", v: l.p50, sub: "typical query" },
    { label: "P95", v: l.p95, sub: "95% faster" },
    { label: "P99", v: l.p99, sub: "99% faster" },
  ];
  return (
    <Frame className="mt-8">
      <FrameHeader className="flex-row items-center justify-between">
        <FrameTitle className="text-[15px]">Query performance</FrameTitle>
        <FrameDescription className="text-xs">
          ClickHouse · last 24h · {l.count.toLocaleString()} queries
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="grid grid-cols-3 gap-4">
        {cells.map((c) => (
          <Stat
            key={c.label}
            label={c.label}
            color={latencyColor(c.v)}
            value={c.v == null ? "—" : <>{c.v} <span className="font-semibold text-sm">ms</span></>}
            sub={c.sub}
          />
        ))}
      </FramePanel>
      <FramePanel>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-medium text-sm">P95 trend</span>
          <span className="text-muted-foreground text-xs">last {histVals.length} day{histVals.length === 1 ? "" : "s"}</span>
        </div>
        <Sparkline
          values={histVals}
          color={latencyColor(histVals[histVals.length - 1])}
          label="P95 query latency trend"
        />
      </FramePanel>
    </Frame>
  );
}

function IngestionFrame({ data, pipeline }: { data: IngestionData | null; pipeline: PipelineData | null }) {
  const pState = pipeline?.state && PIPELINE_META[pipeline.state] ? pipeline.state : null;
  const hasIngest = !!data && (data.freshnessSeconds != null || data.successRate24h != null);
  if (!hasIngest && !pState) return null;

  const histVals = ((data && data.history) || [])
    .filter((d) => d.successRate != null)
    .map((d) => d.successRate as number);

  return (
    <Frame className="mt-8">
      <FrameHeader className="flex-row items-center justify-between">
        <FrameTitle className="text-[15px]">Event ingestion</FrameTitle>
        <FrameDescription className="text-xs">capture · last 24h</FrameDescription>
      </FrameHeader>
      <FramePanel className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {pState && (
          <Stat
            label="Ingestion pipeline"
            color={PIPELINE_META[pState].color}
            value={<span className="text-lg">{PIPELINE_META[pState].label}</span>}
            sub="worker & queue"
          />
        )}
        {hasIngest && (
          <>
            <Stat
              label="Ingestion success"
              color={successColor(data!.successRate24h)}
              value={data!.successRate24h == null ? "—" : <>{data!.successRate24h} <span className="font-semibold text-sm">%</span></>}
              sub={
                data!.successRate24h == null
                  ? "metrics unavailable"
                  : data!.requestCount24h != null
                    ? `of ${data!.requestCount24h.toLocaleString()} events`
                    : "last 24h"
              }
            />
            <Stat
              label="Pipeline freshness"
              color={freshnessColor(data!.freshnessSeconds)}
              value={fmtAgo(data!.freshnessSeconds)}
              sub={data!.freshnessSeconds == null ? "no recent events" : "since last event"}
            />
          </>
        )}
      </FramePanel>
      {hasIngest && (
        <FramePanel>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="font-medium text-sm">Success rate trend</span>
            <span className="text-muted-foreground text-xs">last {histVals.length} day{histVals.length === 1 ? "" : "s"}</span>
          </div>
          <Sparkline
            values={histVals}
            color={successColor(histVals[histVals.length - 1])}
            label="Ingestion success rate trend"
          />
        </FramePanel>
      )}
    </Frame>
  );
}

/* ---------- incidents ---------- */
const STAGE_COLOR: Record<string, string> = {
  resolved: "text-success-foreground",
  monitoring: "text-info-foreground",
  identified: "text-warning-foreground",
  investigating: "text-warning-foreground",
  update: "text-warning-foreground",
  detected: "text-warning-foreground",
  down: "text-warning-foreground",
};
// Tailwind classes used inside dangerouslySetInnerHTML incident bodies.
const INCIDENT_BODY_CLASS =
  "text-sm [&_a]:text-info-foreground [&_a:hover]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_strong]:font-semibold";

function ActiveIncident({ incidents }: { incidents: Incident[] | null }) {
  const open = incidents?.filter((i) => i.ongoing) ?? [];
  if (!open.length) return null;
  const inc = open[0];
  const latest = inc.updates[0];
  const Icon = inc.isMaint ? WrenchIcon : TriangleAlertIcon;
  return (
    <div className="mt-8">
      <h2 className="mb-3 font-semibold text-foreground text-[15px] tracking-tight">Active incident</h2>
      <Alert variant={inc.isMaint ? "info" : "warning"}>
        <Icon />
        <AlertTitle>
          {inc.title}
          {inc.affects.length ? ` — ${inc.affects.join(", ")}` : ""}
        </AlertTitle>
        {latest && (
          <AlertDescription>
            <div className={INCIDENT_BODY_CLASS} dangerouslySetInnerHTML={{ __html: latest.body }} />
          </AlertDescription>
        )}
      </Alert>
    </div>
  );
}

function IncidentHistory({ incidents }: { incidents: Incident[] | null }) {
  const body = () => {
    if (incidents === null) {
      return (
        <FramePanel>
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlertIcon />
              </EmptyMedia>
              <EmptyTitle>History temporarily unavailable</EmptyTitle>
              <EmptyDescription>
                View incidents on{" "}
                <a href={`https://github.com/${REPO}/issues`} target="_blank" rel="noopener">
                  GitHub
                </a>
                .
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </FramePanel>
      );
    }
    if (!incidents.length) {
      return (
        <FramePanel>
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckIcon />
              </EmptyMedia>
              <EmptyTitle>No incidents reported</EmptyTitle>
              <EmptyDescription>All services have been operating normally.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </FramePanel>
      );
    }
    return incidents.map((inc, idx) => (
      <FramePanel key={idx}>
        <div className="font-semibold text-[15px] tracking-tight">{inc.title}</div>
        {inc.affects.length > 0 && (
          <p className="mt-1 text-muted-foreground text-xs">Affected · {inc.affects.join(" · ")}</p>
        )}
        <div className="mt-3.5 flex flex-col gap-3.5">
          {inc.updates.map((u, i) => (
            <div key={i} className="grid grid-cols-[88px_1fr] gap-3.5 sm:grid-cols-[108px_1fr]">
              <div className={`font-semibold text-xs capitalize ${STAGE_COLOR[u.stage] ?? "text-muted-foreground"}`}>
                {u.stage}
              </div>
              <div>
                <div className={INCIDENT_BODY_CLASS} dangerouslySetInnerHTML={{ __html: u.body }} />
                <div className="mt-0.5 text-muted-foreground/70 text-xs">
                  {fmt(u.at)} · {fmtTime(u.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </FramePanel>
    ));
  };

  return (
    <Frame className="mt-8">
      <FrameHeader>
        <FrameTitle className="text-[15px]">Incident history</FrameTitle>
      </FrameHeader>
      {body()}
      <FrameFooter className="pt-0">
        <a
          className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
          href={`https://github.com/${REPO}/issues?q=is%3Aissue`}
          target="_blank"
          rel="noopener"
        >
          View full incident history on GitHub →
        </a>
      </FrameFooter>
    </Frame>
  );
}

/* ---------- footer ---------- */
function PageFooter() {
  return (
    <footer className="mt-10 pt-6">
      <Separator className="mb-5" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground/80 text-xs">
        <span>
          All times UTC · Powered by{" "}
          <a className="hover:text-foreground" href="https://upptime.js.org" target="_blank" rel="noopener">
            Upptime
          </a>
        </span>
        <span>
          Honch ·{" "}
          <a className="hover:text-foreground" href="https://honch.io" target="_blank" rel="noopener">
            honch.io
          </a>
        </span>
      </div>
    </footer>
  );
}

/* ---------- loading skeleton ---------- */
function LoadingState() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Frame>
        <FramePanel className="flex items-center gap-4">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-72" />
          </div>
        </FramePanel>
      </Frame>
      <Frame className="grid grid-cols-2 gap-1 lg:grid-cols-4 [&>[data-slot=frame-panel]+[data-slot=frame-panel]]:mt-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <FramePanel key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </FramePanel>
        ))}
      </Frame>
      <Frame>
        <FrameHeader>
          <Skeleton className="h-4 w-48" />
        </FrameHeader>
        {Array.from({ length: 4 }).map((_, i) => (
          <FramePanel key={i} className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
          </FramePanel>
        ))}
      </Frame>
    </div>
  );
}

/* ---------- app ---------- */
function useStatusData() {
  const [data, setData] = useState<StatusData | null>(null);
  useEffect(() => {
    let active = true;
    const run = () => {
      loadAll()
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => console.warn("status load failed", e));
    };
    run();
    const id = window.setInterval(run, 60000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
  return data;
}

export default function App() {
  const data = useStatusData();
  return (
    <div className="mx-auto max-w-[880px] px-6 pt-7 pb-20">
      <TopBar />
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <Hero services={data.services} now={data.now} />
          <StatsGrid services={data.services} openCount={data.openCount} />
          <ServicesFrame services={data.services} daysBySlug={data.daysBySlug} />
          <QueryPerfFrame data={data.latency} />
          <IngestionFrame data={data.ingestion} pipeline={data.pipeline} />
          <ActiveIncident incidents={data.incidents} />
          <IncidentHistory incidents={data.incidents} />
        </>
      )}
      <PageFooter />
    </div>
  );
}
