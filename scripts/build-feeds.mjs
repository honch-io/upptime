// Generate RSS 2.0 + Atom feeds of Honch status incidents (GitHub issues).
// Usage: node scripts/build-feeds.mjs <issues.json> <out-dir>
import { readFileSync, writeFileSync } from "node:fs";

const SITE = "https://status.honch.io";

const xmlEsc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

// Strip the leading status emoji Upptime puts on incident titles.
const cleanTitle = (t) =>
  String(t || "").replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, "").trim() ||
  String(t || "");

/** Build { rss, atom } XML strings from a list of GitHub issues. `now` is the build time (ISO). */
export function buildFeeds(issues, now) {
  const incidents = (issues || [])
    .filter((i) => !i.pull_request)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const updated = incidents[0]?.updated_at || now;

  const summary = (i) => {
    const state = i.state === "open" ? "Ongoing" : "Resolved";
    return `[${state}] ${(i.body || "").trim()}`.slice(0, 600);
  };

  const atomEntries = incidents
    .map(
      (i) => `  <entry>
    <title>${xmlEsc(cleanTitle(i.title))}</title>
    <link href="${xmlEsc(i.html_url)}"/>
    <id>${xmlEsc(i.html_url)}</id>
    <published>${xmlEsc(i.created_at)}</published>
    <updated>${xmlEsc(i.updated_at)}</updated>
    <summary>${xmlEsc(summary(i))}</summary>
  </entry>`,
    )
    .join("\n");

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Honch Status</title>
  <subtitle>Incident history and status updates for Honch services</subtitle>
  <link href="${SITE}/feed.atom" rel="self"/>
  <link href="${SITE}"/>
  <id>${SITE}/</id>
  <updated>${xmlEsc(updated)}</updated>
${atomEntries}
</feed>
`;

  const rssItems = incidents
    .map(
      (i) => `    <item>
      <title>${xmlEsc(cleanTitle(i.title))}</title>
      <link>${xmlEsc(i.html_url)}</link>
      <guid isPermaLink="true">${xmlEsc(i.html_url)}</guid>
      <pubDate>${new Date(i.created_at).toUTCString()}</pubDate>
      <description>${xmlEsc(summary(i))}</description>
    </item>`,
    )
    .join("\n");

  const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Honch Status</title>
    <link>${SITE}</link>
    <description>Incident history and status updates for Honch services</description>
    <lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>
${rssItems}
  </channel>
</rss>
`;

  return { rss, atom };
}

// --- CLI ---
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [issuesPath, outDir] = process.argv.slice(2);
  if (!issuesPath || !outDir) {
    console.error("usage: build-feeds.mjs <issues.json> <out-dir>");
    process.exit(1);
  }
  const issues = JSON.parse(readFileSync(issuesPath, "utf8"));
  const { rss, atom } = buildFeeds(issues, new Date().toISOString());
  writeFileSync(`${outDir}/feed.rss`, rss);
  writeFileSync(`${outDir}/feed.atom`, atom);
  console.log(`wrote feed.rss + feed.atom (${issues.filter((i) => !i.pull_request).length} incidents)`);
}
