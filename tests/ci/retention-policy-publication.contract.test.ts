import { describe, it, expect } from "vitest";
import { stripComments, stripHclComments } from "./lib/strip-comments";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * @spec [Doc-05E §3, §5 (retention + severance); Doc-03_V1.1 §14.2 (retention
 *        matrix); Doc-03C_V3 §9.3 (OIDC-gated internal routes); LYCEON legal
 *        versioning Phase 2 §4-§5 (bodies carry no version); Coding Standards §14]
 * @implemented 2026-09-21
 *
 * plain English: Phase 7 published the retention policy. Three things have to
 * stay true afterwards, and each rots silently if nothing checks it:
 *
 *   A  The published Privacy Policy is structurally sound and its internal
 *      section references resolve. §6 was rewritten wholesale; a renumbering
 *      that orphans "Section 6.3" is invisible until a reader follows it.
 *   B  Microsoft Clarity is gone and stays gone — no import, no boot call, no
 *      leftover consent shim, and nothing gating on its project id.
 *   C  The retention sweep has a caller. The route existed from 2026-08-20
 *      behind an OIDC guard whose comment named Cloud Scheduler; no Cloud
 *      Scheduler job existed. A schedule that drifts off the route path, or
 *      signs with the wrong audience or the wrong service account, is a
 *      silent 401 every night forever.
 *
 * expected outcome: all four suites green against the working tree, with no
 * network, no GCP, and no Terraform binary required.
 *
 * trade-offs:
 *  - Suite C reads the HCL as text rather than running `terraform validate`.
 *    Terraform is not installed in CI and adding it for one file is not worth
 *    the minutes. The checks that matter here are cross-file agreement (does
 *    the scheduler URI still match the route the server actually mounts?),
 *    which a syntax validator would not catch anyway.
 *  - Suite D scans source for code that READS the variable, and additionally
 *    pins `client/.env.example` by name. That file has no code extension, so
 *    the source walker cannot see it — which is exactly how its declaration
 *    outlived the rest of Part B. A declaration in an example env file gates
 *    nothing by itself, but it is the documented way back in: it tells the
 *    next contributor the variable is expected, and setting it was the single
 *    step between a dark Clarity and one recording minors.
 *
 * edge cases:
 *  - Suite A resolves references against headings in the CURRENT published
 *    version, read through manifest.json. Publishing v4 moves the target
 *    automatically rather than pinning this test to v3.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8");

/**
 * A file this suite expects to exist but whose absence must surface as a
 * NAMED failing test, not as an import-time crash. A crash blocks CI too, but
 * it reports "no tests" — which tells whoever reads the log nothing about
 * which contract broke. Deleting the scheduler file or dangling the manifest
 * both take this path.
 */
const readOrEmpty = (rel: string): string =>
  existsSync(path.join(repoRoot, rel)) ? read(rel) : "";

// ── Resolve the CURRENT privacy policy through the manifest ──────────
// Pinning to "v3" would make this suite stale the day v4 publishes. The
// manifest is how the app resolves it, so it is how the test resolves it.

type Manifest = { current: string | null };

const privacyManifest = JSON.parse(
  read("legal/privacy-policy/manifest.json"),
) as Manifest;

const currentVersion = privacyManifest.current;
const policyRel = `legal/privacy-policy/${String(currentVersion)}/en.md`;

// ══════════════════════════════════════════════════════════════════════
// A. The published policy renders
// ══════════════════════════════════════════════════════════════════════

describe("Phase 7 A — published Privacy Policy is structurally sound", () => {
  it("manifest resolves to a version directory that has a body", () => {
    expect(currentVersion).toBeTypeOf("string");
    expect(existsSync(path.join(repoRoot, policyRel))).toBe(true);
  });

  const body = readOrEmpty(policyRel);

  it("the body is a whole policy, not a stub (guards a vacuous pass)", () => {
    // Every structural check below is satisfied by an empty string. This is
    // the assertion that makes the rest mean something.
    expect(body.length).toBeGreaterThan(5_000);
  });

  /** Headings are `## **N. Title**` / `### **N.M Title**`. */
  const headingNumbers = (): string[] =>
    [...body.matchAll(/^#{2,3}\s+\*\*([0-9]+(?:\.[0-9]+)?)[.\s]/gm)].map(
      (m) => m[1] as string,
    );

  it("every heading is a numbered, bold, non-empty heading", () => {
    const headings = [...body.matchAll(/^(#{2,6})\s+(.*)$/gm)];
    expect(headings.length).toBeGreaterThan(0);
    const malformed = headings
      .filter(([, hashes, text]) => {
        if (hashes === "#") return false; // document title, if any
        return !/^\*\*[0-9]+(\.[0-9]+)?[.\s][^*]*\*\*\s*$/.test(text ?? "");
      })
      .map(([full]) => full);
    expect(malformed).toEqual([]);
  });

  it("every internal section reference resolves to a heading", () => {
    const known = new Set(headingNumbers());
    const referenced = [
      ...body.matchAll(/\bSection\s+([0-9]+(?:\.[0-9]+)?)/g),
    ].map((m) => m[1] as string);

    // The rewrite of §6 kept "Section 6.3" pointed at the billing-consent
    // record. If a later edit renumbers §6, this is what catches it.
    expect(referenced.length).toBeGreaterThan(0);
    const orphaned = referenced.filter((ref) => !known.has(ref));
    expect(orphaned).toEqual([]);
  });

  it("top-level sections are numbered consecutively from 1", () => {
    const top = [...body.matchAll(/^##\s+\*\*([0-9]+)\./gm)].map((m) =>
      Number(m[1]),
    );
    expect(top).toEqual(top.map((_, i) => i + 1));
  });

  it("subsections of each section are numbered consecutively from .1", () => {
    /** @type {Record<number, number[]>} */
    const bySection = new Map<number, number[]>();
    for (const m of body.matchAll(/^###\s+\*\*([0-9]+)\.([0-9]+)\s/gm)) {
      const parent = Number(m[1]);
      const child = Number(m[2]);
      bySection.set(parent, [...(bySection.get(parent) ?? []), child]);
    }
    expect(bySection.size).toBeGreaterThan(0);
    for (const [parent, children] of bySection) {
      expect({
        parent,
        children,
      }).toEqual({ parent, children: children.map((_, i) => i + 1) });
    }
  });

  it("every markdown table row has the column count its header declares", () => {
    const lines = body.split("\n");
    const offenders: string[] = [];
    let headerCols: number | null = null;

    const cols = (line: string): number =>
      line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const isRow = line.trim().startsWith("|");
      if (!isRow) {
        headerCols = null;
        continue;
      }
      if (headerCols === null) {
        // First row of a table. The next line must be the separator.
        const next = lines[i + 1] ?? "";
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(next)) {
          offenders.push(`line ${i + 1}: table header has no separator row`);
          continue;
        }
        headerCols = cols(line);
        continue;
      }
      if (cols(line) !== headerCols) {
        offenders.push(
          `line ${i + 1}: ${cols(line)} columns, header declared ${headerCols}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bold markers are balanced on every line", () => {
    const offenders = body
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => (line.match(/\*\*/g)?.length ?? 0) % 2 !== 0)
      .map(({ n, line }) => `line ${n}: ${line.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });

  it("the tutor retention line matches the mechanism that enforces it", () => {
    // v3 could only publish "deleted when your account is deleted", because
    // nothing set tutor_conversations.deleted_at and the seven-day sweep had a
    // permanently empty input (SCL-101 addendum finding 1). v4 restores the
    // seven-day promise because the entitlements trigger now writes that
    // column — proved in tests/ci/tutor-lapse-severance.pg.ci.test.ts.
    //
    // All three populations must be covered, because a student who never
    // subscribed has no "subscription ends" event and the sentence would
    // otherwise say nothing true about them.
    expect(body).toMatch(/seven days later/);
    expect(body).toMatch(/resubscribe within those seven days/);
    expect(body).toMatch(/never subscribed/);
  });

  it("the analytics disclosure names the provider actually running", () => {
    // §6.6 and the §5.2 sub-processor table have to agree with the code.
    // Trust & Safety promises every provider that processes your data is
    // named in the Privacy Policy, so a provider in App.tsx and not here is
    // a broken promise, not a documentation nit.
    expect(body).toMatch(/Vercel Analytics/);
    expect(body).not.toMatch(/Microsoft|Clarity(?!\b.*improve)/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// B. Microsoft Clarity is gone
// ══════════════════════════════════════════════════════════════════════

/** Recursively collect source files, skipping build output and deps. */
function collectSources(relDir: string): string[] {
  const abs = path.join(repoRoot, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "coverage"].includes(entry.name)) {
      continue;
    }
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCE_DIRS = [
  "client/src",
  "server",
  "packages",
  "apps",
  "shared",
  "scripts",
] as const;

const allSources = SOURCE_DIRS.flatMap((d) => collectSources(d)).filter(
  (f) => f !== path.join("tests", "ci", path.basename(__filename)),
);

describe("Phase 7 B — Microsoft Clarity is removed", () => {
  it("collected a non-empty source set (guard against a vacuous pass)", () => {
    expect(allSources.length).toBeGreaterThan(100);
  });

  it("no source file imports or requires @microsoft/clarity", () => {
    const offenders = allSources.filter((rel) =>
      /@microsoft\/clarity/.test(read(rel)),
    );
    expect(offenders).toEqual([]);
  });

  it("the dependency itself is gone from package.json", () => {
    // Until the owner approved the dependency change this suite could only
    // assert that nothing IMPORTED it, which closed the re-enablement path
    // without closing the door. Both are now assertable, and both are
    // asserted: an unimported dependency is still a dependency someone can
    // reach for, and it still ships in the install tree.
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const everySection = {
      ...pkg.optionalDependencies,
      ...pkg.devDependencies,
      ...pkg.dependencies,
    };
    expect(Object.keys(everySection)).not.toContain("@microsoft/clarity");
  });

  it("the lockfile no longer resolves @microsoft/clarity", () => {
    // package.json and the lockfile can disagree — a stale lockfile still
    // installs the package. Both have to be clean for the removal to be real.
    expect(read("pnpm-lock.yaml")).not.toMatch(/@microsoft\/clarity/);
  });

  it("no source file calls clarity.init or clarity.consent", () => {
    const offenders = allSources.filter((rel) =>
      /\bclarity\s*\.\s*(init|consent|identify|setTag|upgrade)\s*\(/.test(
        read(rel),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("the dead consent shim and its window globals are gone", () => {
    // These three globals were the whole consent mechanism. The setter had
    // zero call sites and stored its flag in localStorage, so it could not
    // have evidenced consent even if a UI had called it. Leaving any of them
    // behind leaves a re-enablement path.
    const DEAD_GLOBALS = [
      "__lyceonSetAnalyticsConsent",
      "__lyceonAnalyticsConsent",
      "__lyceonClarityInited",
    ] as const;
    const offenders: string[] = [];
    for (const rel of allSources) {
      const text = read(rel);
      for (const g of DEAD_GLOBALS) {
        if (text.includes(g)) offenders.push(`${rel}: ${g}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("client entry boots the app and nothing else", () => {
    const main = read("client/src/main.tsx");
    expect(main).toMatch(/createRoot\(/);
    expect(main.toLowerCase()).not.toMatch(/clarity\.init|from "@microsoft/);
  });

  it("Vercel Analytics — the provider that stayed — is still mounted", () => {
    // The brief kept Vercel Analytics. If it is ever removed, §6.6 and the
    // §5.2 table become false in the other direction, so pin it here too.
    const app = read("client/src/App.tsx");
    expect(app).toMatch(/@vercel\/analytics/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// C. The retention sweep has a scheduled caller
// ══════════════════════════════════════════════════════════════════════

describe("Phase 7 C — Cloud Scheduler invokes the retention sweep", () => {
  const TF_REL = "infra/terraform/cloud-scheduler.tf";

  it("the terraform file exists", () => {
    expect(existsSync(path.join(repoRoot, TF_REL))).toBe(true);
  });

  const tf = readOrEmpty(TF_REL);
  const routeFile = read("server/routes/internal-retention-routes.ts");
  const serverIndex = read("server/index.ts");

  /**
   * The full path the server actually serves, derived from the mount prefix
   * and the router path rather than hardcoded. If either moves, this throws
   * here instead of producing a schedule that 404s in production.
   */
  const servedPath = ((): string => {
    const mount = /app\.use\(\s*"([^"]+)"\s*,\s*internalRetentionRoutes/.exec(
      serverIndex,
    );
    const routerPath = /router\.post\(\s*"([^"]+)"/.exec(routeFile);
    if (!mount?.[1] || !routerPath?.[1]) {
      throw new Error(
        "could not derive the retention sweep path from server/index.ts + internal-retention-routes.ts",
      );
    }
    return `${mount[1]}${routerPath[1]}`;
  })();

  it("derives the served path from the server, not from a literal", () => {
    expect(servedPath).toBe("/api/internal/retention/sweep");
  });

  it("declares a google_cloud_scheduler_job", () => {
    expect(tf).toMatch(/resource\s+"google_cloud_scheduler_job"\s+"\w+"/);
  });

  it("enables the Cloud Scheduler API (the job cannot be created without it)", () => {
    expect(tf).toMatch(
      /resource\s+"google_project_service"[\s\S]*?service\s*=\s*"cloudscheduler\.googleapis\.com"/,
    );
  });

  const uriMatch = /uri\s*=\s*"\$\{var\.app_base_url\}([^"]*)"/.exec(tf);

  it("targets the path the server actually mounts", () => {
    expect(uriMatch?.[1]).toBe(servedPath);
  });

  it("POSTs — the route is a POST and Vercel Cron's GET could not reach it", () => {
    expect(tf).toMatch(/http_method\s*=\s*"POST"/);
  });

  it("sends a body the route's Zod schema accepts", () => {
    const tierMatch = /retention_tier\s*=\s*"([^"]+)"/.exec(tf);
    const requestIdMatch = /request_id\s*=\s*"([^"]+)"/.exec(tf);

    // The enum is read out of the route so a tier rename reddens this test
    // rather than producing a nightly 400.
    const enumMatch = /retention_tier:\s*z\.enum\(\[([^\]]+)\]\)/.exec(
      routeFile,
    );
    const tiers = [...(enumMatch?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );

    expect(tiers.length).toBeGreaterThan(0);
    expect(tiers).toContain(tierMatch?.[1]);
    expect(tierMatch?.[1]).toBe("7d"); // the tutor tier — Doc 03 §14.2
    expect(requestIdMatch?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(tf).toMatch(/dry_run\s*=\s*false/);
    expect(tf).toMatch(/"Content-Type"\s*=\s*"application\/json"/);
  });

  it("signs an OIDC token whose audience equals the target URI", () => {
    // The route compares the token's `aud` to RETENTION_SWEEP_OIDC_AUDIENCE
    // byte for byte. Audience and URI diverging is a permanent 401 that looks
    // like nothing at all from the GCP console.
    const audMatch =
      /oidc_token\s*\{[\s\S]*?audience\s*=\s*"\$\{var\.app_base_url\}([^"]*)"/.exec(
        tf,
      );
    expect(audMatch?.[1]).toBe(servedPath);
  });

  it("signs as the service account CLOUD_TASKS_SERVICE_ACCOUNT names", () => {
    // `expectedServiceAccount` is read from a single env var, so the job must
    // reuse the cloud_tasks SA. A dedicated per-schedule SA would fail the
    // email claim check — isolation that buys a 401.
    expect(routeFile).toMatch(
      /expectedServiceAccount:\s*process\.env\.CLOUD_TASKS_SERVICE_ACCOUNT/,
    );
    expect(tf).toMatch(
      /service_account_email\s*=\s*google_service_account\.cloud_tasks\.email/,
    );
  });

  it("the audience env var the route reads is documented for deployment", () => {
    expect(routeFile).toMatch(/RETENTION_SWEEP_OIDC_AUDIENCE/);
    expect(read("infra/terraform/outputs.tf")).toMatch(
      /output\s+"retention_sweep_oidc_audience"/,
    );
    expect(read("infra/terraform/README.md")).toMatch(
      /RETENTION_SWEEP_OIDC_AUDIENCE/,
    );
  });

  it("runs on a daily schedule pinned to UTC", () => {
    // Vercel crons are UTC. Two clocks across seven sweeps is a bug waiting
    // for a daylight-saving boundary.
    expect(tf).toMatch(/schedule\s*=\s*"[-\d*/, ]+"/);
    expect(tf).toMatch(/time_zone\s*=\s*"Etc\/UTC"/);
  });

  it("app_base_url rejects a trailing slash", () => {
    // A trailing slash silently desynchronises the URI from the audience.
    const vars = read("infra/terraform/variables.tf");
    expect(vars).toMatch(/variable\s+"app_base_url"/);
    expect(vars).toMatch(/validation\s*\{/);
    expect(vars).toMatch(/\^https:\/\/\[\^\/\]\+\$/);
  });

  it("the sweep is not ALSO scheduled by Vercel Cron (one caller, not two)", () => {
    const vercelJson = read("vercel.json");
    expect(vercelJson).not.toMatch(/retention\/sweep/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// C2. Every tier that can run, runs (Doc 07B §5.4 ruling, 2026-09-22)
// ══════════════════════════════════════════════════════════════════════

/**
 * @spec [Doc-07B_V1.0 §5.4; Doc-03_V1.1 §14.2; owner ruling 2026-09-22]
 *
 * plain English: the 90d and 180d tutor tiers used to archive every expired
 * row to BigQuery before deleting it, and returned ok: false when they could
 * not. The archive client's dependency was never installed, so both tiers
 * answered "not configured" on every call and neither was ever scheduled —
 * two published retention periods with nothing enforcing them. The ruling
 * removed the archive; the tiers delete outright; they are now schedulable
 * and are scheduled.
 *
 * The assertion is coverage, not existence: the set of scheduled tiers is
 * compared against the set of tiers the route accepts, minus the ones that
 * are a documented no-op. Adding a tier to the route's enum without a
 * schedule reddens this, which is the failure that hid for a month.
 */
describe("Phase 7 C2 — every runnable retention tier has a schedule", () => {
  const tf = stripHclComments(
    readOrEmpty("infra/terraform/cloud-scheduler.tf"),
  );
  const routeFile = read("server/routes/internal-retention-routes.ts");
  const sweepFile = read("server/services/retention-sweep.ts");

  /** Tiers the route's Zod enum accepts — the full set, read from the route. */
  const acceptedTiers = ((): string[] => {
    const enumMatch = /retention_tier:\s*z\.enum\(\[([^\]]+)\]\)/.exec(
      routeFile,
    );
    if (!enumMatch?.[1]) throw new Error("could not read retention_tier enum");
    return [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  })();

  /**
   * Tiers that are a structured no-op: the sweep returns a
   * `*_tables_not_provisioned` reason unconditionally. Read out of the sweep
   * module so a tier that GAINS its tables stops being exempt automatically.
   */
  const noOpTiers = [
    ...sweepFile.matchAll(/reason:\s*"(\d+d)_tables_not_provisioned"/g),
  ].map((m) => m[1] as string);

  /** Tiers with a Cloud Scheduler job, read from comment-stripped HCL. */
  const scheduledTiers = [
    ...tf.matchAll(/retention_tier\s*=\s*"([^"]+)"/g),
  ].map((m) => m[1] as string);

  it("collected a non-empty tier set from each source (guards a vacuous pass)", () => {
    expect(acceptedTiers.length).toBeGreaterThan(0);
    expect(scheduledTiers.length).toBeGreaterThan(0);
    expect(noOpTiers.length).toBeGreaterThan(0);
  });

  it("every accepted tier is either scheduled or a documented no-op", () => {
    const unaccounted = acceptedTiers.filter(
      (t) => !scheduledTiers.includes(t) && !noOpTiers.includes(t),
    );
    expect(unaccounted).toEqual([]);
  });

  it("the three runnable tiers are 7d, 90d and 180d", () => {
    expect([...scheduledTiers].sort()).toEqual(["180d", "7d", "90d"]);
  });

  it("365d is NOT scheduled — its tables do not exist", () => {
    // A nightly job that returns ok: false is worse than no job: it produces
    // a run record that looks like enforcement.
    expect(noOpTiers).toContain("365d");
    expect(scheduledTiers).not.toContain("365d");
  });

  it("no scheduled tier can decline for want of an archive", () => {
    // The chokepoint. The tiers are scheduled because they cannot answer
    // "not configured" any more; if an archive path returned, the schedules
    // above would be firing into a permanent no-op again.
    const code = stripComments(sweepFile).toLowerCase();
    expect(code).not.toContain("archive");
    expect(code).not.toContain("not_configured");
  });

  it("each job carries its own request_id UUID (no cross-tier dedup)", () => {
    // request_id is the idempotency key the route logs. Two tiers sharing one
    // would make the second look like a replay of the first.
    const ids = [...tf.matchAll(/request_id\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );
    expect(ids).toHaveLength(scheduledTiers.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the jobs run at distinct times (three deletes, not one thundering herd)", () => {
    const schedules = [...tf.matchAll(/schedule\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );
    expect(schedules).toHaveLength(scheduledTiers.length);
    expect(new Set(schedules).size).toBe(schedules.length);
  });

  it("every job POSTs, runs dry_run = false, and pins Etc/UTC", () => {
    const n = scheduledTiers.length;
    expect(tf.match(/http_method\s*=\s*"POST"/g)).toHaveLength(n);
    expect(tf.match(/dry_run\s*=\s*false/g)).toHaveLength(n);
    expect(tf.match(/time_zone\s*=\s*"Etc\/UTC"/g)).toHaveLength(n);
  });

  it("every job signs an OIDC token whose audience equals its target URI", () => {
    const uris = [
      ...tf.matchAll(/uri\s*=\s*"\$\{var\.app_base_url\}([^"]*)"/g),
    ].map((m) => m[1] as string);
    const auds = [
      ...tf.matchAll(/audience\s*=\s*"\$\{var\.app_base_url\}([^"]*)"/g),
    ].map((m) => m[1] as string);
    expect(uris).toHaveLength(scheduledTiers.length);
    expect(auds).toEqual(uris);
  });
});

// ══════════════════════════════════════════════════════════════════════
// D. Nothing gates on the Clarity project id
// ══════════════════════════════════════════════════════════════════════

describe("Phase 7 D — no code gates on VITE_CLARITY_PROJECT_ID", () => {
  it("no source file reads the variable", () => {
    const offenders = allSources.filter((rel) =>
      /VITE_CLARITY_PROJECT_ID/.test(read(rel)),
    );
    expect(offenders).toEqual([]);
  });

  it("the client env example no longer declares it", () => {
    // Removed in 1cee769b, after the rest of Part B. Until then this was the
    // one surviving reference, and it is the file a future contributor copies
    // to .env — so it is pinned by name rather than left to the source
    // walker, which skips extensionless files.
    const rel = "client/.env.example";
    expect(existsSync(path.join(repoRoot, rel))).toBe(true);
    expect({ rel, hit: /VITE_CLARITY_PROJECT_ID/.test(read(rel)) }).toEqual({
      rel,
      hit: false,
    });
  });

  it("no build or deploy config references it", () => {
    for (const rel of [
      "vercel.json",
      "vite.config.ts",
      "package.json",
    ] as const) {
      if (!existsSync(path.join(repoRoot, rel))) continue;
      expect({ rel, hit: /VITE_CLARITY_PROJECT_ID/.test(read(rel)) }).toEqual({
        rel,
        hit: false,
      });
    }
  });
});
