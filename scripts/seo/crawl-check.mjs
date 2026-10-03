#!/usr/bin/env node
/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §2 (HTTP proof), §5 F1, F2, F3] | @implemented [2026-10-03]
 *
 * plain English: the crawler's-eye check of a deployment. Fetches sitemap.xml from BASE_URL, then
 * fetches every URL in it twice — as Googlebot and as OAI-SearchBot — without running any
 * JavaScript, and reports per URL: status, <title>, whether the canonical is the page's own URL,
 * the JSON-LD types, and the word count of the body text. Then checks the F2 cases: an unknown path
 * and an unknown blog slug return 404, /privacy and /terms 301, and a legal asset still serves.
 *
 * Usage: node scripts/seo/crawl-check.mjs https://<deployment> [--json]
 *   Sitemap <loc>s name https://lyceon.ai; each is fetched at the same path on BASE_URL, and its
 *   canonical must equal the <loc> (the production URL), which is what "self-canonical" means for a
 *   preview. For a protected preview, set VERCEL_AUTOMATION_BYPASS_SECRET to send Vercel's
 *   x-vercel-protection-bypass header, or CRAWL_COOKIE to send a Cookie header (e.g. the `_vercel_jwt`
 *   a Vercel share link sets). Neither is ever printed.
 *
 * Exit 1 if any URL fails a check. Prints no cookies, tokens or headers.
 */

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error(
    "usage: node scripts/seo/crawl-check.mjs https://<deployment> [--json]",
  );
  process.exit(2);
}
const asJson = process.argv.includes("--json");
const PRODUCTION = "https://lyceon.ai";
const MIN_WORDS = 150;
const AGENTS = {
  Googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
};

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const cookie = process.env.CRAWL_COOKIE;
function headers(agent) {
  const h = {
    "User-Agent": agent,
    Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
  };
  if (bypass) h["x-vercel-protection-bypass"] = bypass;
  if (cookie) h.Cookie = cookie;
  return h;
}

async function get(url, agent) {
  const res = await fetch(url, { headers: headers(agent), redirect: "manual" });
  return {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  };
}

function decode(text) {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function inspect(html) {
  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
  const canonical =
    /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
  const robots =
    /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? null;
  const types = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => {
    try {
      return JSON.parse(m[1])["@type"];
    } catch {
      return "INVALID_JSON";
    }
  });
  const start = html.indexOf('<div id="root">');
  const text = decode(
    (start === -1 ? html : html.slice(start))
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return {
    title,
    canonical,
    robots,
    types,
    words: text === "" ? 0 : text.split(" ").length,
  };
}

const sitemapRes = await get(`${base}/sitemap.xml`, AGENTS.Googlebot);
if (sitemapRes.status !== 200) {
  console.error(`sitemap.xml: HTTP ${sitemapRes.status}`);
  process.exit(1);
}
const locs = [...sitemapRes.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => m[1],
);
const rows = [];
let failed = 0;
const titles = new Map();

for (const loc of locs) {
  const path = loc.startsWith(PRODUCTION)
    ? loc.slice(PRODUCTION.length) || "/"
    : new URL(loc).pathname;
  for (const [agentName, agent] of Object.entries(AGENTS)) {
    const res = await get(`${base}${path}`, agent);
    const info = inspect(res.body);
    const problems = [];
    if (res.status !== 200) problems.push(`status ${res.status}`);
    if (!info.title) problems.push("no title");
    if (info.canonical !== loc)
      problems.push(`canonical ${info.canonical ?? "(none)"}`);
    if (info.robots && /noindex/.test(info.robots)) problems.push("noindex");
    if (info.types.includes("INVALID_JSON")) problems.push("invalid JSON-LD");
    if (info.words < MIN_WORDS) problems.push(`only ${info.words} words`);
    if (agentName === "Googlebot") {
      if (titles.has(info.title))
        problems.push(`title duplicates ${titles.get(info.title)}`);
      titles.set(info.title, path);
    }
    if (problems.length > 0) failed += 1;
    rows.push({
      agent: agentName,
      path,
      status: res.status,
      title: info.title,
      selfCanonical: info.canonical === loc,
      jsonLd: info.types.join(",") || "-",
      words: info.words,
      result: problems.length === 0 ? "OK" : `FAIL: ${problems.join("; ")}`,
    });
  }
}

const edge = [
  { path: "/does-not-exist", expect: 404 },
  { path: "/blog/not-a-post", expect: 404 },
  { path: "/legal/not-a-document", expect: 404 },
  { path: "/privacy", expect: 301, location: "/legal/privacy-policy" },
  { path: "/terms", expect: 301, location: "/legal/student-terms" },
  { path: "/legal/index.json", expect: 200 },
  { path: "/legal/privacy-policy/manifest.json", expect: 200 },
  { path: "/dashboard", expect: 200, noindex: true },
];
const edgeRows = [];
for (const check of edge) {
  const res = await get(`${base}${check.path}`, AGENTS.Googlebot);
  const problems = [];
  if (res.status !== check.expect)
    problems.push(`status ${res.status}, expected ${check.expect}`);
  if (check.location && !(res.location ?? "").endsWith(check.location))
    problems.push(`location ${res.location}`);
  if (
    check.expect === 404 &&
    !/<meta name="robots" content="noindex"/.test(res.body)
  )
    problems.push("404 page not noindex");
  if (check.noindex && !/<meta name="robots" content="noindex"/.test(res.body))
    problems.push("SPA shell not noindex");
  if (problems.length > 0) failed += 1;
  edgeRows.push({
    path: check.path,
    status: res.status,
    location: res.location ?? "-",
    result: problems.length === 0 ? "OK" : `FAIL: ${problems.join("; ")}`,
  });
}

if (asJson) {
  console.log(
    JSON.stringify(
      { base, urls: locs.length, rows, edge: edgeRows, failed },
      null,
      2,
    ),
  );
} else {
  console.log(
    `# Crawl check: ${base} — ${locs.length} sitemap URLs × ${Object.keys(AGENTS).length} agents, no JavaScript\n`,
  );
  console.log(
    "| agent | path | status | title | self-canonical | JSON-LD types | body words | result |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.agent} | ${r.path} | ${r.status} | ${r.title.replace(/\|/g, "\\|")} | ${r.selfCanonical ? "yes" : "NO"} | ${r.jsonLd} | ${r.words} | ${r.result} |`,
    );
  }
  console.log("\n| path | status | location | result |");
  console.log("|---|---|---|---|");
  for (const r of edgeRows)
    console.log(`| ${r.path} | ${r.status} | ${r.location} | ${r.result} |`);
  console.log(
    `\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`,
  );
}
process.exit(failed === 0 ? 0 : 1);
