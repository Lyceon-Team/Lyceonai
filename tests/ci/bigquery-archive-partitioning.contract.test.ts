import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * @spec [Doc-07B_V1.0 §5.3 (partitioning discipline) + §13 (archive timestamp
 *        semantics) + §14.2 (partition-required); Doc-03_V1.1 §14.2 (retention
 *        matrix); Privacy Policy v4 §6.6; owner ruling 2026-09-22 B3;
 *        Coding Standards §14]
 * @implemented 2026-09-22
 *
 * plain English: the published policy promises de-identified analytics data is
 * kept "up to 24 months, then only in aggregate." The mechanism for that is
 * BigQuery partition expiration, and a partition expiration has three moving
 * parts that live in three different files:
 *
 *   the writer      `archiveRows()` must stamp the partition column on every row
 *   the table       Terraform must partition on that column and expire it at 730d
 *   the schema      the checked-in BigQuery JSON must declare the column
 *
 * Any one of the three missing produces a system that looks finished. A writer
 * with no column writes rows BigQuery rejects. A table with no expiration keeps
 * minors' data forever while the policy says 24 months. A schema without the
 * column makes the insert fail on an unknown field — and archive failure blocks
 * the Supabase delete, so the 90d/180d tiers quietly stop deleting anything.
 *
 * expected outcome: all four suites green with no BigQuery, no GCP credentials,
 * no Terraform binary and no database.
 *
 * trade-offs:
 *  - Suite B reads the HCL as text. Terraform is not installed in CI and a
 *    syntax validator would not catch what matters here anyway — whether the
 *    number in the HCL is the same number as the constant in the TypeScript.
 *  - Suite D asserts an IFF, not a fact about today's dependency list. "The
 *    90d/180d jobs are scheduled exactly when they are capable of running" stays
 *    true whichever way the dependency question is settled, and turns red the
 *    moment the two sides disagree — including on the happy day the dependency
 *    lands and the jobs still are not scheduled.
 *
 * edge cases:
 *  - B3.2 uses an instant at 23:59 UTC. A partition key derived with local-time
 *    methods (getDate()) instead of the UTC ISO string would pass every test run
 *    on a UTC runner and file rows into tomorrow's partition anywhere east of
 *    Greenwich. The assertion is against the UTC date specifically.
 *  - B3.8 derives the window from the number of months the PUBLISHED policy
 *    says, resolved through manifest.json. Publishing a v5 with a different
 *    period moves this test's expectation automatically; it cannot be satisfied
 *    by editing a literal in the test.
 */

// archiveRows short-circuits when the dataset env var is unset. Set it before
// the module is imported so the writer under test actually runs.
process.env.BIGQUERY_ARCHIVE_DATASET = "lyceon_analytics_archive_test";

import {
  ARCHIVE_DATASET_ENV_KEY,
  ARCHIVE_PARTITION_EXPIRATION_DAYS,
  ARCHIVE_PARTITION_EXPIRATION_MS,
  ARCHIVE_PARTITION_FIELD,
  ARCHIVE_TABLE_MAP,
  archiveRows,
  type ArchiveClient,
} from "../../server/services/retention-archive";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8");

/**
 * A missing file must surface as a NAMED failing assertion, not as an
 * import-time crash that reports "no tests" and names no contract.
 */
const readOrEmpty = (rel: string): string =>
  existsSync(path.join(repoRoot, rel)) ? read(rel) : "";

/**
 * HCL with comment text removed.
 *
 * WHY THIS EXISTS, AND IT IS NOT FUSSINESS. The first version of this suite
 * asserted `require_partition_filter = true` against the whole file. The
 * mutation that DELETED that line still passed, because the trade-offs comment
 * a few lines above it quotes the setting verbatim. A structural check
 * satisfied by prose about the structure is worse than no check: it reports
 * green over a table that scans every partition. Every assertion about what
 * the HCL *does* reads the stripped text; only the assertions about what the
 * HCL *says* read the raw file.
 *
 * Limitation, stated: this strips from the first `#` to end of line, so a `#`
 * inside a string literal would truncate that line. Neither Terraform file
 * here contains one, and a contract test that mis-parses is a failing test,
 * not a silent pass.
 */
const stripHclComments = (hcl: string): string =>
  hcl
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join("\n");

const BQ_TF_RAW = readOrEmpty("infra/terraform/bigquery.tf");
const BQ_TF = stripHclComments(BQ_TF_RAW);
const SCHEDULER_TF = stripHclComments(
  readOrEmpty("infra/terraform/cloud-scheduler.tf"),
);
const OUTPUTS_TF = readOrEmpty("infra/terraform/outputs.tf");
const TF_README = readOrEmpty("infra/terraform/README.md");
const DRIFT_CHECK = readOrEmpty("scripts/ci/retention-archive-drift-check.mjs");
const GENERATOR = readOrEmpty(
  "scripts/retention/generate-bq-archive-schemas.mjs",
);

const BQ_TABLES = Object.values(ARCHIVE_TABLE_MAP);

type BqField = { name: string; type: string; mode: string };

const schemaFor = (bqTable: string): BqField[] => {
  const raw = readOrEmpty(`scripts/retention/schemas/${bqTable}.json`);
  return raw === "" ? [] : (JSON.parse(raw) as BqField[]);
};

/** Recording archive client — captures what the writer actually sends. */
function recordingClient(): {
  client: ArchiveClient;
  calls: { tableId: string; rows: Record<string, unknown>[] }[];
} {
  const calls: { tableId: string; rows: Record<string, unknown>[] }[] = [];
  return {
    calls,
    client: {
      async insertRows(
        _datasetId: string,
        tableId: string,
        rows: Record<string, unknown>[],
      ): Promise<{ insertedCount: number }> {
        calls.push({ tableId, rows });
        return { insertedCount: rows.length };
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// Suite A — the writer stamps the partition key
// ══════════════════════════════════════════════════════════════════════

describe("B3 suite A — archiveRows stamps the partition column", () => {
  it("B3.1 — every archived row carries the partition column", async () => {
    const { client, calls } = recordingClient();
    const result = await archiveRows(
      client,
      "tutor_injection_log",
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      new Date("2026-09-22T12:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rows).toHaveLength(3);
    for (const row of calls[0]?.rows ?? []) {
      expect(row[ARCHIVE_PARTITION_FIELD]).toBe("2026-09-22");
    }
  });

  it("B3.2 — the partition key is the UTC date, not the runner's local date", async () => {
    // 23:59 UTC. A local-time derivation is one day out for every timezone
    // east of Greenwich, and only east of Greenwich — so a UTC CI runner
    // would never see it.
    const { client, calls } = recordingClient();
    await archiveRows(
      client,
      "tutor_injection_log",
      [{ id: "a" }],
      new Date("2026-09-22T23:59:59.000Z"),
    );

    expect(calls[0]?.rows[0]?.[ARCHIVE_PARTITION_FIELD]).toBe("2026-09-22");
  });

  it("B3.3 — the partition key and _archived_at describe the same instant", async () => {
    const { client, calls } = recordingClient();
    await archiveRows(
      client,
      "crisis_review_cases",
      [{ id: "a" }, { id: "b" }],
      new Date("2026-12-31T22:15:00.000Z"),
    );

    for (const row of calls[0]?.rows ?? []) {
      const archivedAt = String(row._archived_at);
      expect(row[ARCHIVE_PARTITION_FIELD]).toBe(archivedAt.slice(0, 10));
    }
  });

  it("B3.4 — the archive date wins over a same-named source column", async () => {
    // None of the four source tables has an `event_date` column today. If one
    // ever gains one, the partition key must still be the archive date —
    // otherwise a source value would decide which partition (and therefore
    // which expiry date) the row lands in.
    const { client, calls } = recordingClient();
    await archiveRows(
      client,
      "tutor_injection_log",
      [{ id: "a", [ARCHIVE_PARTITION_FIELD]: "1999-01-01" }],
      new Date("2026-09-22T00:00:00.000Z"),
    );

    expect(calls[0]?.rows[0]?.[ARCHIVE_PARTITION_FIELD]).toBe("2026-09-22");
  });

  it("B3.5 — the expiration constants agree with each other", () => {
    expect(ARCHIVE_PARTITION_EXPIRATION_MS).toBe(
      ARCHIVE_PARTITION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite B — the table Terraform declares
// ══════════════════════════════════════════════════════════════════════

describe("B3 suite B — Terraform partitions and expires the archive tables", () => {
  it("B3.6 — every mapped archive table is declared in Terraform", () => {
    expect(BQ_TF_RAW).not.toBe("");
    for (const bqTable of BQ_TABLES) {
      expect(BQ_TF).toContain(`"${bqTable}"`);
    }
  });

  it("B3.7 — the table resource partitions by day on the writer's column", () => {
    const block = BQ_TF.match(/time_partitioning\s*\{[\s\S]*?\}/);
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/type\s*=\s*"DAY"/);
    expect(block?.[0]).toMatch(
      new RegExp(`field\\s*=\\s*"${ARCHIVE_PARTITION_FIELD}"`),
    );
  });

  it("B3.8 — the declared expiration is the constant the writer documents", () => {
    // The HCL must carry the exact millisecond value the TypeScript derives.
    // A number typed twice is a number that will disagree once.
    expect(BQ_TF).toContain(String(ARCHIVE_PARTITION_EXPIRATION_MS));
    expect(BQ_TF).toMatch(/expiration_ms\s*=\s*local\./);
  });

  it("B3.9 — the window is inside the period the published policy promises", () => {
    const manifest = JSON.parse(
      read("legal/privacy-policy/manifest.json"),
    ) as { current: string | null };
    const policy = read(
      `legal/privacy-policy/${String(manifest.current)}/en.md`,
    );

    // The §6.6 analytics sentence — the one that governs the de-identified
    // archive. Read the number of months out of the published text rather
    // than restating it here.
    const sentence = policy
      .split("\n")
      .find(
        (line) =>
          line.includes("separated from anything identifying") &&
          line.includes("months"),
      );
    expect(sentence).toBeDefined();

    // The same paragraph states TWO periods — 12 months for analytics data and
    // "up to 24 months" once it is separated from anything identifying. The
    // archive holds the separated kind, so anchor the match to that clause
    // rather than taking the first number in the line.
    const months = Number(
      /separated from anything identifying[\s\S]*?up to (\d+)\s+months/.exec(
        sentence ?? "",
      )?.[1],
    );
    expect(months).toBeGreaterThan(0);

    // "up to N months" is an upper bound, so the implemented window must not
    // exceed it. Floor of the average-year conversion keeps 24 → 730.
    expect(ARCHIVE_PARTITION_EXPIRATION_DAYS).toBeLessThanOrEqual(
      Math.floor((months * 365) / 12),
    );
    // ...and must not be so much shorter that the published promise is a lie
    // in the other direction: within one month of the stated period.
    expect(ARCHIVE_PARTITION_EXPIRATION_DAYS).toBeGreaterThan(
      Math.floor((months * 365) / 12) - 31,
    );
  });

  it("B3.10 — no dataset-level default expiration silently expires §13 aggregates", () => {
    // Doc 07B §5.1 names this dataset the home of the §13 system-state-archive
    // aggregates, and §5.3 says those carry no partition expiration. A dataset
    // default would apply to them too, invisibly.
    const datasetBlock =
      /resource\s+"google_bigquery_dataset"\s+"archive"\s*\{[\s\S]*?\n\}/.exec(
        BQ_TF,
      )?.[0] ?? "";
    expect(datasetBlock).not.toBe("");
    expect(datasetBlock).not.toMatch(/^\s*default_partition_expiration_ms/m);
    expect(datasetBlock).not.toMatch(/^\s*default_table_expiration_ms/m);
  });

  it("B3.11 — the partition-required discipline is on (§14.2)", () => {
    expect(BQ_TF).toMatch(/require_partition_filter\s*=\s*true/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite C — one schema, shared by Terraform and the drift gate
// ══════════════════════════════════════════════════════════════════════

describe("B3 suite C — the checked-in schema declares the partition column", () => {
  it("B3.12 — every mapped archive table has a checked-in schema", () => {
    for (const bqTable of BQ_TABLES) {
      expect(
        existsSync(
          path.join(repoRoot, `scripts/retention/schemas/${bqTable}.json`),
        ),
        `missing schema for ${bqTable}`,
      ).toBe(true);
    }
  });

  it("B3.13 — each schema declares the partition column as DATE REQUIRED", () => {
    for (const bqTable of BQ_TABLES) {
      const field = schemaFor(bqTable).find(
        (f) => f.name === ARCHIVE_PARTITION_FIELD,
      );
      expect(field, `${bqTable} has no ${ARCHIVE_PARTITION_FIELD}`).toBeDefined();
      // BigQuery will not partition on a NULLABLE column with time-unit
      // partitioning on an ingestion-independent field, and a nullable
      // partition key would put rows in the NULL partition — which never
      // expires.
      expect(field?.type).toBe("DATE");
      expect(field?.mode).toBe("REQUIRED");
    }
  });

  it("B3.14 — Terraform reads that file rather than inlining a second schema", () => {
    expect(BQ_TF).toMatch(
      /schema\s*=\s*file\([^)]*scripts\/retention\/schemas\//,
    );
    // An inlined schema is a second column set that will disagree with the
    // generated one the first time Postgres changes.
    expect(BQ_TF).not.toMatch(/schema\s*=\s*jsonencode/);
    expect(BQ_TF).not.toMatch(/schema\s*=\s*<<-?/);
  });

  it("B3.15 — the drift gate treats the partition column as required metadata", () => {
    // Without this, regenerating the schemas after dropping the column from
    // the generator would pass CI and produce four unpartitionable tables.
    expect(DRIFT_CHECK).not.toBe("");
    const set = /METADATA_COLUMNS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(
      DRIFT_CHECK,
    )?.[1];
    expect(set).toBeDefined();
    expect(set).toContain(`"${ARCHIVE_PARTITION_FIELD}"`);
  });

  it("B3.16 — the generator emits the column the writer writes", () => {
    expect(GENERATOR).not.toBe("");
    const block = /const METADATA_COLUMNS = \[([\s\S]*?)\n\];/.exec(
      GENERATOR,
    )?.[1];
    expect(block).toBeDefined();
    expect(block).toContain(`name: "${ARCHIVE_PARTITION_FIELD}"`);
    expect(block).toMatch(/type:\s*"DATE"/);
  });

  it("B3.17 — the drift gate runs in CI", () => {
    // It has existed since 2026-08-27 and was invoked by nothing, which is why
    // three real drifts accumulated in it unnoticed.
    const ci = readOrEmpty(".github/workflows/ci.yml");
    expect(ci).toContain("scripts/ci/retention-archive-drift-check.mjs");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite D — a tier is scheduled exactly when it can run
// ══════════════════════════════════════════════════════════════════════

describe("B3 suite D — the archive-dependent tiers are wired honestly", () => {
  const archiveDependentTiers = ["90d", "180d"] as const;

  const bigQueryDependencyInstalled = (): boolean => {
    const manifests = [
      "package.json",
      "apps/api/package.json",
      "apps/workers/tutor-orchestrator/package.json",
      "packages/shared/package.json",
    ];
    return manifests.some((rel) => {
      const raw = readOrEmpty(rel);
      if (raw === "") return false;
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      return (
        "@google-cloud/bigquery" in (pkg.dependencies ?? {}) ||
        "@google-cloud/bigquery" in (pkg.devDependencies ?? {}) ||
        "@google-cloud/bigquery" in (pkg.optionalDependencies ?? {})
      );
    });
  };

  const tierIsScheduled = (tier: string): boolean =>
    new RegExp(`retention_tier\\s*=\\s*"${tier}"`).test(SCHEDULER_TF);

  it("B3.18 — the dataset env var comes from a Terraform output, not a retype", () => {
    expect(OUTPUTS_TF).toContain("bigquery_archive_dataset");
    expect(OUTPUTS_TF).toContain(ARCHIVE_DATASET_ENV_KEY);
    expect(TF_README).toContain(ARCHIVE_DATASET_ENV_KEY);
  });

  it("B3.19 — 90d and 180d are scheduled if and only if the archive client can load", () => {
    // The archive client `require`s @google-cloud/bigquery. Without it the
    // require throws, getArchiveClient() returns undefined and both tiers
    // decline — so a schedule would be a nightly no-op. With it, leaving them
    // unscheduled is the retention gap. Either mismatch fails here.
    const installed = bigQueryDependencyInstalled();
    for (const tier of archiveDependentTiers) {
      expect(
        tierIsScheduled(tier),
        installed
          ? `@google-cloud/bigquery is installed, so the ${tier} tier can run — schedule it in cloud-scheduler.tf`
          : `@google-cloud/bigquery is not installed, so the ${tier} tier cannot archive — remove its schedule or add the dependency`,
      ).toBe(installed);
    }
  });

  it("B3.20 — the 7d tier stays scheduled; it needs no archive client", () => {
    expect(tierIsScheduled("7d")).toBe(true);
  });
});
