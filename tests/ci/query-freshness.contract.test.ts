/**
 * @spec [student-ui register UI-14; Doc_05F §17.7 (calendar refetches on window focus, no
 *        polling); Coding Standards §11.2] | @implemented [2026-09-29]
 *
 * plain English: pins the query-freshness contract in three parts.
 *
 *   1. The values. Account facts (profile, billing status) are short and finite; reference data
 *      (taxonomy, pricing) is long and finite; the KPIs do not poll and refetch on focus (owner
 *      ruling 2026-10-01; they had a 60 s timer until then); the calendar keeps refetch-on-focus.
 *   2. The consumers. Every query for one of those data types takes its freshness from
 *      `QUERY_FRESHNESS` rather than a local number — a sweep, so a new call site that forgets
 *      is caught without anyone naming it here.
 *   3. One source per resource. `/api/profile` and `/api/billing/status` are read by exactly one
 *      module each, under exactly one key. The old second and third keys may not come back.
 *
 * The request-count proof (one request per endpoint on a real page load) is the behavioural
 * half and lives in `client/src/lib/query-hygiene.requests.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { profileQuery, PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import {
  billingStatusQuery,
  BILLING_STATUS_QUERY_KEY,
} from "@/hooks/useBillingStatusQuery";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CLIENT_SRC = path.join(REPO_ROOT, "client/src");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** Every non-test client source file, relative to the repo root, comments stripped. */
function clientSources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push({
        file: path.relative(REPO_ROOT, full),
        code: stripComments(fs.readFileSync(full, "utf-8")),
      });
    }
  };
  walk(CLIENT_SRC);
  return out;
}

/**
 * The options object a match sits in: from the match to the first `})` that closes it. Crude,
 * and enough — every call site this sweeps is a flat `useQuery({ ... })`.
 */
function optionsBlocks(code: string, anchor: RegExp): string[] {
  const blocks: string[] = [];
  const global = new RegExp(anchor.source, "g");
  let match: RegExpExecArray | null;
  while ((match = global.exec(code)) !== null) {
    const end = code.indexOf("})", match.index);
    blocks.push(code.slice(match.index, end === -1 ? undefined : end));
  }
  return blocks;
}

function sitesOf(anchor: RegExp): { file: string; block: string }[] {
  return clientSources().flatMap(({ file, code }) =>
    optionsBlocks(code, anchor).map((block) => ({ file, block })),
  );
}

describe("UI-14 — freshness values per data type", () => {
  it("account facts are short and finite", () => {
    for (const kind of ["profile", "billingStatus"] as const) {
      const { staleTime } = QUERY_FRESHNESS[kind];
      expect(staleTime, kind).toBeGreaterThan(0);
      expect(staleTime, kind).toBeLessThanOrEqual(MINUTE_MS);
    }
  });

  it("reference data is long and still finite", () => {
    for (const kind of ["taxonomy", "pricing"] as const) {
      const { staleTime } = QUERY_FRESHNESS[kind];
      expect(Number.isFinite(staleTime), kind).toBe(true);
      expect(staleTime, kind).toBeGreaterThanOrEqual(HOUR_MS);
    }
  });

  it("the KPIs do not poll: no interval, refetch on focus, a finite window (owner ruling 2026-10-01)", () => {
    expect("refetchInterval" in QUERY_FRESHNESS.kpis).toBe(false);
    expect(QUERY_FRESHNESS.kpis.refetchOnWindowFocus).toBe(true);
    expect(Number.isFinite(QUERY_FRESHNESS.kpis.staleTime)).toBe(true);
    expect(QUERY_FRESHNESS.kpis.staleTime).toBeLessThanOrEqual(MINUTE_MS);
  });

  it("the calendar refetches on window focus (Doc 05F §17.7)", () => {
    expect(QUERY_FRESHNESS.calendarRange.refetchOnWindowFocus).toBe(true);
    expect(QUERY_FRESHNESS.calendarStreak.refetchOnWindowFocus).toBe(true);
  });
});

describe("UI-14 — consumers take freshness from the config", () => {
  it("the canonical profile and billing-status queries use their config entries", () => {
    expect(profileQuery.staleTime).toBe(QUERY_FRESHNESS.profile.staleTime);
    expect(billingStatusQuery.staleTime).toBe(
      QUERY_FRESHNESS.billingStatus.staleTime,
    );
  });

  it("every /api/practice/topics query uses QUERY_FRESHNESS.taxonomy", () => {
    const sites = sitesOf(
      /queryKey:\s*\[\s*["']\/api\/practice\/topics["']\s*\]/,
    );
    // Presence before absence: the sweep must find the two known call sites, or it is proving
    // nothing. UI-51 (2026-10-03) moved Practice's and Review's inline reads into the one hook
    // (`hooks/usePracticeTopics.ts`); browse-topics keeps its own until OQ-3 is decided.
    expect(sites.map((s) => s.file).sort()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("client/src/hooks/usePracticeTopics.ts"),
        expect.stringContaining("client/src/pages/browse-topics.tsx"),
      ]),
    );
    expect(
      sites.some(
        (s) =>
          s.file.endsWith("pages/practice.tsx") ||
          s.file.endsWith("pages/review.tsx"),
      ),
    ).toBe(false);
    for (const { file, block } of sites) {
      expect(block, file).toContain("QUERY_FRESHNESS.taxonomy");
    }
  });

  it("every getBillingPlans query uses QUERY_FRESHNESS.pricing", () => {
    const sites = sitesOf(/queryFn:\s*getBillingPlans/);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const { file, block } of sites) {
      expect(block, file).toContain("QUERY_FRESHNESS.pricing");
    }
  });

  it("the KPI read lives in one hook that takes its freshness from the config", () => {
    const sources = clientSources();
    const hook = sources.find((s) =>
      s.file.endsWith("client/src/hooks/useProgressKpis.ts"),
    );
    expect(hook).toBeDefined();
    expect(hook!.code).toContain("QUERY_FRESHNESS.kpis");
    expect(hook!.code).not.toMatch(/refetchInterval/);
    // Presence before absence: the endpoint is named, and only in the hook.
    const naming = sources
      .filter((s) => s.code.includes("/api/progress/kpis"))
      .map((s) => s.file);
    expect(naming).toEqual([hook!.file]);
    // UI-50 (2026-10-03) took the KPI tiles off Home and UI-51 (2026-10-03) took "Weekly
    // Activity" off Practice; DESIGN.md §4 gives neither page a KPI tile. The hook still has
    // its callers (they invalidate or read it), so "only the hook names the endpoint" above is
    // the rule that remains; here, the two rebuilt pages are pinned to reading no KPI at all.
    for (const page of ["pages/practice.tsx", "pages/lyceon-dashboard.tsx"]) {
      const src = sources.find((s) => s.file.endsWith(`client/src/${page}`));
      expect(src, page).toBeDefined();
      expect(src?.code, page).not.toContain("useProgressKpis");
    }
  });

  it("the calendar reads take freshness from the config, with no local numbers", () => {
    const code = stripComments(
      fs.readFileSync(
        path.join(CLIENT_SRC, "features/calendar/api/queries.ts"),
        "utf-8",
      ),
    );
    expect(code).toContain("QUERY_FRESHNESS.calendarRange");
    expect(code).toContain("QUERY_FRESHNESS.calendarStreak");
    expect(code).not.toMatch(/staleTime:\s*\d/);
  });
});

describe("UI-14 — one module, one key per resource", () => {
  const PROFILE_HOOK = "client/src/hooks/useProfileQuery.ts";
  const BILLING_HOOK = "client/src/hooks/useBillingStatusQuery.ts";

  it("the keys are the paths", () => {
    expect(PROFILE_QUERY_KEY).toEqual(["/api/profile"]);
    expect(BILLING_STATUS_QUERY_KEY).toEqual(["/api/billing/status"]);
  });

  it("only the profile hook GETs /api/profile or spells its key", () => {
    const offenders = clientSources()
      .filter(({ file }) => file !== PROFILE_HOOK)
      .filter(
        ({ code }) =>
          /(?:csrfFetch|fetch)\(\s*["']\/api\/profile["']/.test(code) ||
          /\[\s*["']\/api\/profile["']\s*\]/.test(code),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("only the billing-status hook GETs /api/billing/status or spells a key for it", () => {
    const offenders = clientSources()
      .filter(({ file }) => file !== BILLING_HOOK)
      .filter(
        ({ code }) =>
          /(?:csrfFetch|fetch)\(\s*["']\/api\/billing\/status["']/.test(code) ||
          /\[\s*["']\/api\/billing\/status["']\s*\]/.test(code) ||
          /["'](?:guardian-)?billing-status["']/.test(code),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
