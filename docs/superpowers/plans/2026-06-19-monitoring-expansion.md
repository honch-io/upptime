# Stack Monitoring Expansion — Implementation Plan

> **For agentic workers:** Each work item below becomes its own bite-sized TDD plan (REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`) when it's picked up. This document is the roadmap: it locks the shared architecture and sorts the items by difficulty + time so we build in the right order.

**Goal:** Add monitoring for the platform's currently-unwatched failure points — the worker/ingestion pipeline, ClickHouse disk, Cloud SQL, Redis, cohort recalculation, and the `honch.dev` installer — building on the status-page machinery already in place.

**Architecture:** Reuse the proven pattern from the query-latency and ingestion panels: a read-only backend endpoint computes a metric (from GCP Cloud Monitoring or a direct DB query), a scheduled GitHub Action snapshots it to a committed JSON, and a surface renders it. Crucially, split by **audience**: customer-facing health goes on the public status page; internal capacity numbers drive **Slack alerts** (and an internal-only view), not the public page.

**Tech Stack:** Upptime (status page + workflows), Hono/TypeScript backend (`honch-api` on Cloud Run), GCP Cloud Monitoring (read via `google-auth-library` ADC — same as the ingestion success metric), ClickHouse + Postgres clients already in the backend, Slack incoming webhook (already wired for up/down alerts).

---

## Global Constraints

- **No new public exposure of sensitive internals.** Raw infra numbers (DB connection counts, disk %, queue depth) are **internal** — surfaced via Slack alerts / an authenticated internal view, never the public status page. The public page only ever shows customer-facing state (operational / degraded / outage) and already-public metrics.
- **Reuse the existing pattern**, do not invent new ones: backend read-only endpoint → snapshot workflow → committed `api/*.json` → panel/alert. Guard every new endpoint with the existing `CLICKHOUSE_LATENCY_TOKEN` bearer.
- **Cloud Monitoring reads are already unblocked** — the `honch-runtime` service account has `roles/monitoring.viewer` (granted for the ingestion success metric). Pub/Sub, Cloud SQL, Cloud Run, and Memorystore metrics are all readable with it.
- **Fail safe.** Every endpoint returns `503`/null on dependency error; every snapshot workflow leaves the last good JSON untouched on failure; every panel hides itself when data is absent. (Same discipline as the shipped panels.)
- **Tests:** pure transform/threshold logic gets `vitest` (backend) or `node:test` (scripts) coverage, colocated `*.test.ts`/`*.test.mjs`, matching the existing files.

---

## Prerequisites — RESOLVED (one lookup remains)

1. ✅ **ClickHouse hosting** — self-hosted ClickHouse (`@clickhouse/client` against `CLICKHOUSE_URL`). `system.disks` / `system.asynchronous_metrics` are queryable → Item 2 works as written. (Docs mentioning "Tinybird" are stale; ignore.)
2. ✅ **Redis hosting** — **GCP Memorystore for Redis** (`honch-redis`, primary `10.59.173.59`, VPC `honch-vpc`, direct peering). Item 6 uses Cloud Monitoring `redis.googleapis.com/*`.
3. ✅ **Pub/Sub names** (from `worker/src/config.rs` + `.env.example`): events topic `events-raw`, events subscription **`events-raw-subscription`** (env `EVENTS_PUBSUB_SUBSCRIPTION` — confirm the exact prod value when wiring Item 4); cohort topic `cohort-recalc`, cohort subscription `cohort-recalc-worker`.
4. ✅ **Cohort schema** — `cohorts` has `last_calculated_at`, `is_calculating`, `version`, `pending_version`, `member_count` (per the worker recalc code). Item 3 works as written.
5. ⏳ **Cloud SQL instance id** — not in the repo (prod `DATABASE_URL` is a Secret Manager secret). Resolve with `gcloud sql instances list --project euphoric-fusion-498103-g7` when building Item 5. Non-blocking for everything else.

---

## Shared foundation (build once, before Items 2–6)

A single internal metrics endpoint + one snapshot, rather than six of each.

- **Backend:** `GET /health/platform` (token-guarded) returning a JSON object with sub-keys per source: `{ pubsub, worker, clickhouseDisk, cloudSql, redis, cohorts }`. Each sub-key degrades to `null` independently (missing perm / dependency down) so one failure never blanks the rest. Add metrics incrementally — the endpoint ships with whatever items are done.
- **Cloud Monitoring helper:** extract the ADC + `timeSeries` fetch already written for `ingestion-metrics.service.ts` into a small reusable `core/monitoring/cloud-monitoring.ts` (`fetchTimeSeries(filter, aligner, reducer, windowSec)`), so Items 4/5/6 are a filter + a parse each.
- **Snapshot:** one workflow `platform-metrics.yml` (every 5–10 min) → `api/platform-metrics.json`. Drives Slack alerts via a threshold-check step; an internal/expandable status-page section can read it later.
- **Alerts (decided):** reuse the existing Slack webhook (`NOTIFICATION_SLACK_WEBHOOK_URL`). A threshold-check step in `platform-metrics.yml` posts breaches to Slack, alongside the up/down alerts already there. Thresholds live in one place in the workflow/script.

> Folding this foundation in first makes Items 2–6 small. Item 1 (honch.dev) is independent of it.

---

## Work items — sorted easiest/fastest → hardest/longest

| # | Item | Surface | Data source | Difficulty | Est. time |
|---|------|---------|-------------|------------|-----------|
| 1 | **honch.dev uptime** | Public status page | Upptime HTTP check | Trivial | ~15 min |
| 2 | **ClickHouse disk** | Internal alert (+ optional tile) | Backend → CH `system.disks` | Low–Med | ~0.5 day |
| 3 | **Cohort recalc freshness** | Internal alert | Backend → Postgres `cohorts` | Low–Med | ~0.5 day |
| 4 | **Worker + Pub/Sub backlog** | Public "Ingestion" tile + internal alert | Cloud Monitoring (Pub/Sub + Cloud Run) | Medium | ~1 day |
| 5 | **Cloud SQL capacity** | Internal alert | Cloud Monitoring (Cloud SQL) | Medium | ~0.5–1 day |
| 6 | **Redis (Memorystore)** | Internal alert | Cloud Monitoring `redis.googleapis.com/*` | Medium | ~0.5–1 day |

Times assume the shared foundation exists (add ~0.5 day for that, one-time). All prerequisites are resolved except the Cloud SQL instance id (a one-line `gcloud` lookup at Item 5).

---

### Item 1 — `honch.dev` uptime (Trivial, ~15 min)

- **What/why:** `honch.dev` is the Cloudflare Worker serving the `curl honch.dev | sh` CLI installer + Go vanity import. If down, installs silently fail. Customer-facing → belongs on the public page.
- **Surface:** Public status page (new monitored site).
- **How:** add to `.upptimerc.yml` `sites`. It redirects (`/` → docs), so set `expectedStatusCodes` to include the redirect code (confirm: likely `200` after follow, or `301/302`). Renders automatically from `summary.json`, like every other site.
- **Files:** `.upptimerc.yml` (upptime).
- **Difficulty:** Trivial. **No backend, no foundation needed.** Ship first.

### Item 2 — ClickHouse disk (Low–Med, ~0.5 day)

- **What/why:** we watch query *latency*, not capacity. A full disk or "too many parts" stalls inserts → ingestion halts. Internal ops signal.
- **Surface:** Internal alert (optionally a private tile). Not public.
- **How:** extend the existing ClickHouse path with a query against `system.disks` (`free_space`, `total_space`) and a parts/merge health check (`system.asynchronous_metrics` / `system.parts` count per table). Add under `/health/platform.clickhouseDisk`.
- **Files:** backend `modules/health/clickhouse-disk.service.ts` (+ test); register in the platform endpoint; threshold in the alert step.
- **Thresholds:** disk used >80% warn / >90% page; parts-per-partition above CH's `parts_to_throw_insert` headroom.
- **Reuses:** the CH client + endpoint pattern already built → low effort.

### Item 3 — Cohort recalculation freshness (Low–Med, ~0.5 day) *(confirm schema first)*

- **What/why:** cohort recalc runs every 15 min (Scheduler → Pub/Sub → worker). If it stalls, cohorts silently go stale and customers see wrong audiences. Dead-man's-switch.
- **Surface:** Internal alert.
- **How:** backend query against Postgres `cohorts`: `max(last_calculated_at)` (staleness) and `count(*) where is_calculating AND updated < now()-30min` (stuck claims). Under `/health/platform.cohorts`.
- **Files:** backend `modules/health/cohort-health.service.ts` (+ test); register; threshold in alert step.
- **Thresholds:** oldest `last_calculated_at` > ~25 min (cron is 15 min) warn; any stuck-claim > 30 min page.
- **Reuses:** existing Postgres client → low effort.

### Item 4 — Worker + Pub/Sub backlog (Medium, ~1 day)

- **What/why:** **the "should we scale" signal.** The worker (`honch-worker`) drains `events-raw` → ClickHouse. If it dies or falls behind, events pile up in Pub/Sub while capture + API stay green. Highest-leverage item.
- **Surface:** Public **"Ingestion" tile** (operational / degraded / behind — *no raw numbers*) **+** internal alert with the actual backlog age.
- **How (Cloud Monitoring, perm already granted):**
  - `pubsub.googleapis.com/subscription/oldest_unacked_message_age` (the key signal)
  - `pubsub.googleapis.com/subscription/num_undelivered_messages` (backlog depth)
  - `run.googleapis.com/container/instance_count` for `honch-worker` (is it even running?)
  - Filter on subscription `events-raw-subscription` (confirm prod `EVENTS_PUBSUB_SUBSCRIPTION`); under `/health/platform.pubsub` + `.worker`, via the shared `cloud-monitoring.ts` helper.
- **Files:** backend `modules/health/pipeline-health.service.ts` (+ test for the parse/threshold logic); register; public tile in `status-page/index.html`; Slack alert step.
- **Thresholds:** oldest-unacked > 5 min warn / > 10 min page; worker instance_count = 0 page.

### Item 5 — Cloud SQL (Postgres) capacity (Medium, ~0.5–1 day)

- **What/why:** connection exhaustion or disk-full takes down *every* service. Internal ops signal.
- **Surface:** Internal alert.
- **How (Cloud Monitoring):** `cloudsql.googleapis.com/database/postgresql/num_backends` (vs `database/max_connections`), `.../cpu/utilization`, `.../disk/utilization`, `.../replication/replica_lag` (if a replica exists). Under `/health/platform.cloudSql` via the shared helper.
- **Files:** backend `modules/health/cloudsql-health.service.ts` (+ test); register; alert step.
- **Thresholds:** connections >80% warn / >90% page; disk >80% warn / >90% page; CPU >70% sustained warn.
- **Prereq:** Cloud SQL instance id (Prereq #3).

### Item 6 — Redis / Memorystore (Medium, ~0.5–1 day)

- **What/why:** evictions = query-cache + wire-v2 chunk-reassembly loss (perf cliff, fragment loss). Internal ops signal.
- **Surface:** Internal alert.
- **How:** GCP Memorystore (`honch-redis`) → Cloud Monitoring `redis.googleapis.com/stats/memory/usage_ratio` + `.../stats/evicted_keys` via the shared helper. Under `/health/platform.redis`.
- **Files:** backend `modules/health/redis-health.service.ts` (+ test); register; Slack alert step.
- **Thresholds:** memory >80% warn / >90% page; eviction rate >1% of ops warn.

---

## Suggested sequencing

1. **Item 1** now — independent quick win, public value.
2. **Shared foundation** (`/health/platform` + `cloud-monitoring.ts` helper + `platform-metrics.yml` + Slack alert step).
3. **Item 4** (worker + Pub/Sub backlog) — highest leverage, the scaling signal; also delivers the public Ingestion tile.
4. **Items 2 & 3** (ClickHouse disk, cohort freshness) — cheap, reuse existing DB clients; do after confirming their prereqs.
5. **Items 5 & 6** (Cloud SQL, Redis) — round out infra capacity.

## Decisions (locked)

- **Alert channel:** reuse the existing **Slack webhook** (threshold step in `platform-metrics.yml`).
- **Public Ingestion tile (Item 4):** **yes** — a coarse customer-facing "Ingestion: operational / degraded / behind" tile on the public page, with the detailed backlog numbers in the internal Slack alert.
- **Prerequisites:** all resolved except the Cloud SQL instance id (one `gcloud` lookup at Item 5).
