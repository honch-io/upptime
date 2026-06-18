// Cache incidents (GitHub issues + comments) to api/incidents.json so the status
// page renders from a committed snapshot instead of calling the GitHub API on
// every visit (which is rate-limited to 60 req/hr/IP unauthenticated). This runs
// in CI with a token (5000 req/hr) on a schedule + when issues change.
//
// Usage: GH_TOKEN=... REPO=owner/repo node scripts/build-incidents.mjs <out.json>
import { writeFileSync } from "node:fs";

const REPO = process.env.REPO || "honch-io/upptime";
const TOKEN = process.env.GH_TOKEN || "";
const API = `https://api.github.com/repos/${REPO}`;

/** Reduce a raw GitHub issue + its comments to the fields the status page needs. */
export function toIncident(issue, comments) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? "",
    created_at: issue.created_at,
    closed_at: issue.closed_at ?? null,
    html_url: issue.html_url,
    labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    commentsList: (comments || []).map((c) => ({
      body: c.body ?? "",
      created_at: c.created_at,
    })),
  };
}

async function gh(path) {
  const r = await fetch(`${API}${path}`, {
    headers: {
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) throw new Error(`GitHub API ${path} -> ${r.status}`);
  return r.json();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const out = process.argv[2] || "api/incidents.json";
  const issues = (
    await gh("/issues?state=all&per_page=100&sort=created&direction=desc")
  ).filter((i) => !i.pull_request);
  const incidents = [];
  for (const i of issues) {
    const comments =
      i.comments > 0 ? await gh(`/issues/${i.number}/comments?per_page=100`) : [];
    incidents.push(toIncident(i, comments));
  }
  writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), incidents }, null, 2) + "\n",
  );
  console.log(`wrote ${out}: ${incidents.length} incident(s)`);
}
