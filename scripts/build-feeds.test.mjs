import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeeds } from "./build-feeds.mjs";

const issues = [
  {
    number: 1,
    state: "closed",
    title: "🛑 Honch Ingest is down",
    html_url: "https://github.com/honch-io/upptime/issues/1",
    body: "In abc, Honch Ingest was down: 502",
    created_at: "2026-06-16T22:37:00Z",
    updated_at: "2026-06-16T23:46:29Z",
  },
  {
    number: 2,
    state: "open",
    title: "Elevated latency & <errors>",
    html_url: "https://github.com/honch-io/upptime/issues/2",
    body: 'Investigating "spikes"',
    created_at: "2026-06-18T13:30:00Z",
    updated_at: "2026-06-18T14:00:00Z",
  },
  { number: 3, pull_request: {}, title: "a PR", updated_at: "2026-06-18T15:00:00Z" },
];

test("emits both feeds with one entry per incident (PRs excluded)", () => {
  const { rss, atom } = buildFeeds(issues, "2026-06-18T16:00:00Z");
  assert.equal((atom.match(/<entry>/g) || []).length, 2);
  assert.equal((rss.match(/<item>/g) || []).length, 2);
  assert.ok(!atom.includes("a PR") && !rss.includes("a PR"));
});

test("strips status emoji and marks state", () => {
  const { atom } = buildFeeds(issues, "x");
  assert.ok(atom.includes("<title>Honch Ingest is down</title>"));
  assert.ok(atom.includes("[Resolved]") && atom.includes("[Ongoing]"));
});

test("newest incident first and feed-level updated reflects it", () => {
  const { atom } = buildFeeds(issues, "x");
  assert.ok(atom.indexOf("issues/2") < atom.indexOf("issues/1"), "newest entry first");
  assert.ok(atom.includes("<updated>2026-06-18T14:00:00Z</updated>"));
});

test("XML-escapes titles and bodies (no raw < or &)", () => {
  const { rss, atom } = buildFeeds(issues, "x");
  assert.ok(atom.includes("&lt;errors&gt;") && !atom.includes("<errors>"));
  assert.ok(rss.includes("&quot;spikes&quot;"));
});

test("valid feed roots + self link", () => {
  const { rss, atom } = buildFeeds(issues, "x");
  assert.ok(atom.startsWith('<?xml') && atom.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
  assert.ok(atom.includes('<link href="https://status.honch.io/feed.atom" rel="self"/>'));
  assert.ok(rss.includes('<rss version="2.0">') && rss.includes("<channel>"));
});

test("empty incident list still yields valid feeds", () => {
  const { rss, atom } = buildFeeds([], "2026-06-18T16:00:00Z");
  assert.ok(atom.includes("<feed") && atom.includes("</feed>"));
  assert.ok(rss.includes("<channel>") && rss.includes("</channel>"));
});

test("throws a clear error when handed a GitHub API error object, not an array", () => {
  // What the /issues endpoint returns on 401/403/404 — a truthy object with no .filter.
  const apiError = {
    message: "API rate limit exceeded",
    documentation_url: "https://docs.github.com/rest/overview/rate-limits",
  };
  assert.throws(
    () => buildFeeds(apiError, "2026-06-18T16:00:00Z"),
    /API rate limit exceeded/,
  );
});

test("accepts the search API shape ({ items: [...] })", () => {
  const { atom } = buildFeeds({ items: issues }, "2026-06-18T16:00:00Z");
  assert.equal((atom.match(/<entry>/g) || []).length, 2);
});
