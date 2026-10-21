/**
 * Duplicate migration versions: the ratchet in scripts/ci/lib/migration-versions.sh and its I0 case
 * in the migration inventory gate.
 *
 * @spec [owner brief "migration inventory gate fails on duplicate versions" (Karl, 2026-10-21)]
 *       | @implemented [2026-10-21]
 *
 * plain English: seo carried 20261109000000 twice (lifecycle reminder + funnel milestones) through
 * CI with no gate failing. These tests drive the real shell function against the real migration
 * directory and against fixture directories built from it, so a new duplicate, a grown frozen
 * duplicate and a resolved-but-still-listed duplicate each fail, and the gate stops on I0 before it
 * touches Postgres. Runs in the default suite, so a duplicate fails on every PR, not only in ci-full.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const LIB = join(ROOT, "scripts/ci/lib/migration-versions.sh");
const GATE = join(ROOT, "scripts/ci/migration-inventory-gate.sh");
const MIGRATIONS = join(ROOT, "supabase/migrations");
/**
 * The version every fixture duplicate uses: one no real migration can have. Fixtures that reused
 * real-looking versions (20261109000000) collided with the real tree once `main` brought in
 * 20261109000000_lifecycle_reminder_due.sql, and D3 went red on cleanup (2026-10-21). D0 proves
 * this stays unused.
 */
const FIXTURE_VERSION = "29991231000000";

type Run = { status: number | null; stdout: string };

/** Calls migration_version_findings; `known` undefined = the frozen list, "" = no list. */
function findings(dir: string, known?: string): Run {
  const args = known === undefined ? `"$1"` : `"$1" "$2"`;
  const r = spawnSync(
    "bash",
    [
      "-c",
      `source "${LIB}" && migration_version_findings ${args}`,
      "_",
      dir,
      known ?? "",
    ],
    { encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout };
}

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the real migration directory (names only matter, so empty files). */
function copyOfReal(): string {
  const dir = mkdtempSync(join(tmpdir(), "mig-versions-"));
  made.push(dir);
  for (const f of readdirSync(MIGRATIONS)) {
    if (f.endsWith(".sql")) copyFileSync(join(MIGRATIONS, f), join(dir, f));
  }
  return dir;
}

describe("duplicate migration versions", () => {
  it("D0: no real migration uses the fixture version", () => {
    const real = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    // Presence first: the directory was read.
    expect(real.length).toBeGreaterThan(100);
    expect(real.filter((f) => f.startsWith(FIXTURE_VERSION))).toEqual([]);
  });

  it("D1: the real migration directory is clean against the frozen list", () => {
    // Presence first: the frozen list is non-empty and every entry is a real duplicate today, so
    // "clean" is not the vacuous result of an empty list or an unreadable directory.
    const frozen = spawnSync(
      "bash",
      [
        "-c",
        `source "${LIB}" && printf '%s\\n' "$KNOWN_DUPLICATE_MIGRATION_VERSIONS"`,
      ],
      { encoding: "utf8" },
    )
      .stdout.trim()
      .split("\n");
    expect(frozen.length).toBe(15);
    expect(findings(MIGRATIONS, "").stdout.match(/^NEW /gm)).toHaveLength(15);

    expect(findings(MIGRATIONS)).toEqual({ status: 0, stdout: "" });
  });

  it("D2: a new duplicate version fails and names both files", () => {
    const dir = copyOfReal();
    // The shape of the 2026-10-21 incident (two workstreams, one version), at the fixture version.
    writeFileSync(
      join(dir, `${FIXTURE_VERSION}_lifecycle_reminder_due.sql`),
      "",
    );
    writeFileSync(
      join(dir, `${FIXTURE_VERSION}_analytics_funnel_milestones.sql`),
      "",
    );
    const r = findings(dir);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe(
      `NEW ${FIXTURE_VERSION} is shared by: ${FIXTURE_VERSION}_analytics_funnel_milestones.sql ${FIXTURE_VERSION}_lifecycle_reminder_due.sql`,
    );
  });

  it("D3: a version that only shares a prefix with another is not a duplicate", () => {
    const dir = copyOfReal();
    writeFileSync(join(dir, `${FIXTURE_VERSION}_a.sql`), "");
    writeFileSync(join(dir, `${FIXTURE_VERSION}1_b.sql`), "");
    expect(findings(dir)).toEqual({ status: 0, stdout: "" });
  });

  it("D4: a third file joining a frozen duplicate fails as CHANGED", () => {
    const dir = copyOfReal();
    writeFileSync(join(dir, "20261105000000_zz_new.sql"), "");
    const r = findings(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(
      /^CHANGED 20261105000000 was frozen as \[.+\] but is now \[.+20261105000000_zz_new\.sql\]$/m,
    );
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("D5: a resolved frozen duplicate still on the list fails as STALE (the list only shrinks)", () => {
    const dir = copyOfReal();
    rmSync(
      join(dir, "20261105000000_getting_started_blind_spots_not_qotd.sql"),
    );
    const r = findings(dir);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe(
      "STALE 20261105000000 is no longer duplicated; delete its line from KNOWN_DUPLICATE_MIGRATION_VERSIONS",
    );
  });

  it("D6: the inventory gate stops on I0, before Postgres, when a duplicate is added", () => {
    const dir = copyOfReal();
    writeFileSync(join(dir, `${FIXTURE_VERSION}_a.sql`), "");
    writeFileSync(join(dir, `${FIXTURE_VERSION}_b.sql`), "");
    const r = spawnSync("bash", [GATE], {
      encoding: "utf8",
      // An unreachable Postgres: if I0 did not stop the gate, I1 would fail on provisioning
      // instead, and the I1 line below would appear.
      env: {
        ...process.env,
        MIGRATION_VERSIONS_DIR: dir,
        PGHOST: "127.0.0.1",
        PGPORT: "1",
      },
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL [I0]: duplicate migration versions");
    expect(r.stdout).toContain(
      `NEW ${FIXTURE_VERSION} is shared by: ${FIXTURE_VERSION}_a.sql ${FIXTURE_VERSION}_b.sql\n`,
    );
    expect(r.stdout).not.toContain("==> (I1)");
  });
});
