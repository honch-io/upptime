import { test } from "node:test";
import assert from "node:assert/strict";
import { toIncident } from "./build-incidents.mjs";

test("reduces an issue + comments to the page's incident shape", () => {
  const issue = {
    number: 1,
    title: "🛑 Honch Ingest is down",
    state: "closed",
    body: "502 errors",
    created_at: "2026-06-16T22:37:00Z",
    closed_at: "2026-06-16T23:46:29Z",
    html_url: "https://github.com/honch-io/upptime/issues/1",
    labels: [{ name: "status" }, { name: "honch-ingest" }],
    comments: 1,
  };
  const comments = [{ body: "**Resolved:** back up", created_at: "2026-06-16T23:46:29Z" }];

  const out = toIncident(issue, comments);
  assert.equal(out.number, 1);
  assert.equal(out.state, "closed");
  assert.equal(out.closed_at, "2026-06-16T23:46:29Z");
  assert.deepEqual(out.labels, ["status", "honch-ingest"]);
  assert.deepEqual(out.commentsList, [
    { body: "**Resolved:** back up", created_at: "2026-06-16T23:46:29Z" },
  ]);
});

test("handles string labels, missing body/comments/closed_at", () => {
  const out = toIncident(
    {
      number: 2,
      title: "Open incident",
      state: "open",
      html_url: "https://example.com/2",
      labels: ["honch-ingest"],
      comments: 0,
    },
    [],
  );
  assert.equal(out.body, "");
  assert.equal(out.closed_at, null);
  assert.deepEqual(out.labels, ["honch-ingest"]);
  assert.deepEqual(out.commentsList, []);
});
