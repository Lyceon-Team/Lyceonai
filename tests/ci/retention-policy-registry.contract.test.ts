import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseFlatMappingList,
  parseYamlScalar,
  type FlatMapping,
} from "../../scripts/ci/lib/minimal-yaml";

/**
 * @spec [Doc-06D_V1.0 §9.1 (schema) + §9.2 (hard rules) + §9.3 (parity
 *        failure conditions); Doc-07E_V1.0 §6 (the two analytics entries);
 *        Privacy Policy v4 §6; owner ruling 2026-09-22 F1; Coding Standards §14]
 * @implemented 2026-09-22
 *
 * plain English: a retention registry is only worth the agreement between
 * three things — the period the policy publishes, the number in the registry,
 * and the constant the mechanism actually uses. Two of those agreeing is the
 * dangerous case: it reads as finished and deletes on the wrong schedule.
 *
 * expected outcome: four suites green with no database and no network. Suite A
 * is the schema, B is the agreement with the published policy and with the SQL,
 * C is the honesty of the gaps, D is that the parser is shared rather than
 * forked.
 *
 * trade-offs:
 *  - Suite B reads the periods out of the CURRENT published policy, resolved
 *    through manifest.json. Publishing a v5 moves every expectation and this
 *    suite fails until the registry is re-pointed at it — which is the point:
 *    a registry citing a superseded policy version is citing a promise nobody
 *    was shown.
 *  - Suite C asserts a BICONDITIONAL on the alert registry rather than the
 *    fact that it is missing today. "Every purge_alert_id is null exactly
 *    while infra/alert-registry.yaml does not exist" stays true whichever way
 *    that is settled, and turns red the moment the two disagree.
 *  - The §9.3 conditions this registry knowingly fails are pinned as an exact
 *    set, not tolerated as a class. A NEW row that fails the same condition
 *    fails this suite.
 *
 * edge cases:
 *  - F1.7 pins the null-horizon exception to one named policy. If someone
 *    "fixes" it by inventing a forward-ref token, the pinned set changes and
 *    this fails — the schema gap is the finding, and silencing it is not.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8");
const readOrEmpty = (rel: string): string =>
  existsSync(path.join(repoRoot, rel)) ? read(rel) : "";

const REGISTRY_REL = "infra/retention-policy-registry.yaml";
const ALERT_REGISTRY_REL = "infra/alert-registry.yaml";
const REGISTRY = readOrEmpty(REGISTRY_REL);

const rows: FlatMapping[] =
  REGISTRY === "" ? [] : parseFlatMappingList(REGISTRY, "retention_policies");
const prerequisites: FlatMapping[] =
  REGISTRY === "" ? [] : parseFlatMappingList(REGISTRY, "prerequisites");

/** The twelve fields Doc 06D §9.1 declares in its own text. */
const SCHEMA_FIELDS_06D = [
  "policy_id",
  "pii_surface_name",
  "canonical_owner_doc_and_section",
  "classification",
  "retention_horizon_seconds",
  "partial_provable_until",
  "purge_substrate",
  "purge_lag_allowance_seconds",
  "purge_alert_id",
  "out_of_scope",
  "out_of_scope_reason",
  "last_reviewed_at",
] as const;

/**
 * The two fields ONLY Doc 07E declares.
 *
 * Doc 07E §6.1 states: "The Doc 06D §9.1 schema now includes
 * `retention_horizon_months` + `calendar_month_semantics` fields (applied via
 * Doc 06D in-lock-cycle additive RB-06D-V1-19)." Doc 06D contains neither
 * field name, neither `RB-06D-V1-19` nor `CR-06D-06`, and its own cleanup
 * register stops at RB-06D-V1-18 / CR-06D-05. The extension was declared
 * applied by the consuming document and never landed in the owning one — so
 * Doc 07E's two canonical rows are built on fields the schema they register
 * against does not have. SCL-107 finding (d). F1.1 pins the asymmetry in both
 * directions, so the day Doc 06D gains them this fails and the pin comes out.
 */
const SCHEMA_FIELDS_07E_ONLY = [
  "retention_horizon_months",
  "calendar_month_semantics",
] as const;

const SCHEMA_FIELDS = [
  ...SCHEMA_FIELDS_06D,
  ...SCHEMA_FIELDS_07E_ONLY,
] as const;

const SUBSTRATES = [
  "pg_cron",
  "scheduled_job",
  "doc05d_cascade",
  "doc01v6_t_plus_7",
  "doc03_lisa_cron",
  "manual",
] as const;

const CLASSIFICATIONS = [
  "pii",
  "identifier",
  "content",
  "operational",
  "analytics",
  // Doc 07E §6.2 / RB-07E-V1-02 — pseudonymized data is still personal data.
  "pseudonymized_personal_data",
] as const;

const SPEC_06D =
  "docs/Spec/Lyceon — Document 06D_ Data Protection, Backup_DR & Compliance Operations.md";
const SPEC_07E =
  "docs/Spec/Lyceon — Document 07E_ Analytics Retention, Privacy & Cascade.md";

/** Read a `SELECT <n>;` retention constant out of the migration that defines it. */
function sqlConstant(fnName: string): number | null {
  const dir = path.join(repoRoot, "supabase/migrations");
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(path.join(dir, file), "utf-8");
    const m = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fnName}[\\s\\S]{0,600}?SELECT (\\d+);`,
    ).exec(sql);
    if (m?.[1]) return Number(m[1]);
  }
  return null;
}

const byId = (id: string): FlatMapping => {
  const row = rows.find((r) => r.policy_id === id);
  if (!row) throw new Error(`no registry row ${id}`);
  return row;
};

// ══════════════════════════════════════════════════════════════════════
// Suite A — the schema Doc 06D §9.1 specifies
// ══════════════════════════════════════════════════════════════════════

describe("F1 suite A — §9.1 schema conformance", () => {
  it("F1.1 — every row carries exactly the §9.1 field set, and §9.1 still names them", () => {
    expect(REGISTRY).not.toBe("");
    expect(rows.length).toBeGreaterThan(0);
    // The spec corpus escapes underscores as `\_` in prose, so compare against
    // an unescaped copy. `toContain` on the whole document would print it on
    // failure; the boolean keeps the failure readable.
    const spec06d = read(SPEC_06D).replace(/\\_/g, "_");
    const spec07eRaw = read(SPEC_07E).replace(/\\_/g, "_");
    for (const field of SCHEMA_FIELDS_06D) {
      // Citation parity: a field renamed in the spec must not keep passing here.
      expect(
        spec06d.includes(field),
        `Doc 06D §9.1 no longer names the field "${field}"`,
      ).toBe(true);
    }
    for (const field of SCHEMA_FIELDS_07E_ONLY) {
      expect(
        spec07eRaw.includes(field),
        `Doc 07E §6 no longer names the field "${field}"`,
      ).toBe(true);
      expect(
        spec06d.includes(field),
        `Doc 06D now names "${field}" — RB-06D-V1-19 has landed, so remove it ` +
          `from SCHEMA_FIELDS_07E_ONLY and close SCL-107 finding (d)`,
      ).toBe(false);
    }
    // The change record 07E cites for the extension is absent from the doc it
    // was supposedly applied to. Same pin, same release condition.
    expect(spec06d.includes("RB-06D-V1-19")).toBe(false);
    expect(spec06d.includes("CR-06D-06")).toBe(false);
    expect(spec07eRaw.includes("RB-06D-V1-19")).toBe(true);
    for (const row of rows) {
      expect(
        Object.keys(row).sort(),
        `${String(row.policy_id)} field set`,
      ).toEqual([...SCHEMA_FIELDS].sort());
    }
  });

  it("F1.2 — policy_id matches RPOL-<area>-<NN> and is unique", () => {
    const ids = rows.map((r) => String(r.policy_id));
    for (const id of ids) expect(id).toMatch(/^RPOL-[A-Z0-9]+-\d{2}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("F1.3 — classification is in the enum §9.1 declares", () => {
    for (const row of rows) {
      expect(CLASSIFICATIONS, String(row.policy_id)).toContain(
        row.classification,
      );
    }
  });

  it("F1.4 — purge_substrate is in the enum §9.1 declares", () => {
    for (const row of rows) {
      expect(SUBSTRATES, String(row.policy_id)).toContain(row.purge_substrate);
    }
  });

  it("F1.5 — §9.2 rule 4: out_of_scope requires a reason", () => {
    for (const row of rows) {
      if (row.out_of_scope === true) {
        expect(row.out_of_scope_reason, String(row.policy_id)).not.toBeNull();
      } else {
        expect(row.out_of_scope, String(row.policy_id)).toBe(false);
      }
    }
  });

  it("F1.6 — §9.3 (h): a numeric horizon requires a lag allowance", () => {
    for (const row of rows) {
      const hasHorizon =
        row.retention_horizon_seconds !== null ||
        row.retention_horizon_months !== null;
      if (hasHorizon) {
        expect(
          row.purge_lag_allowance_seconds,
          String(row.policy_id),
        ).not.toBeNull();
      }
    }
  });

  it("F1.7 — §9.3 (i): horizon XOR forward-ref, with the one gap pinned by name", () => {
    // §9.3 (i) permits a null horizon ONLY under a partial_provable_until
    // token, and forbids both being set. One row breaks the first half on
    // purpose: a do-not-contact list is indefinite by design, not pending a
    // forward-ref, and the schema cannot say so (SCL-107 finding (a)).
    // Two, as of the §6.5 ruling of 2026-09-22. RPOL-SUPPRESS-01 is a
    // do-not-contact list; RPOL-CONFIG-01 is configuration history the policy
    // now keeps permanently. Neither is pending a forward-ref — both are
    // indefinite by design, and the schema has no way to say so. A second
    // instance arriving within hours of the first is why SCL-107 finding (a)
    // asks for a schema value rather than a carve-out.
    const EXPECTED_NULL_HORIZON_NO_TOKEN = [
      "RPOL-CONFIG-01",
      "RPOL-SUPPRESS-01",
    ];
    const offenders: string[] = [];
    for (const row of rows) {
      const hasHorizon =
        row.retention_horizon_seconds !== null ||
        row.retention_horizon_months !== null;
      const hasToken = row.partial_provable_until !== null;
      // Both set is never permitted, for any row.
      expect(hasHorizon && hasToken, String(row.policy_id)).toBe(false);
      if (!hasHorizon && !hasToken) offenders.push(String(row.policy_id));
    }
    expect(offenders.sort()).toEqual(EXPECTED_NULL_HORIZON_NO_TOKEN);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite B — the registry agrees with the policy and with the mechanisms
// ══════════════════════════════════════════════════════════════════════

describe("F1 suite B — agreement with the published policy and the SQL", () => {
  const manifest = JSON.parse(read("legal/privacy-policy/manifest.json")) as {
    current: string | null;
  };
  const version = String(manifest.current);
  const policyRel = `legal/privacy-policy/${version}/en.md`;
  const policy = read(policyRel);

  it("F1.8 — every policy citation points at the CURRENT published version", () => {
    const cited = rows
      .map((r) => String(r.canonical_owner_doc_and_section))
      .filter((c) => c.startsWith("legal/privacy-policy/"));
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) {
      expect(c, "citation points at a superseded policy version").toMatch(
        new RegExp(`^legal/privacy-policy/${version}/en\\.md §6\\.\\d+$`),
      );
    }
  });

  it("F1.9 — exactly the §6 subsections that state a period are cited", () => {
    // Split §6 into its subsections and ask which ones state a period. A new
    // subsection that publishes one, with no registry row, fails here.
    const sectionRe = /^### \*\*(6\.\d+)[^\n]*\*\*$/gm;
    const marks: { id: string; at: number }[] = [];
    for (let m = sectionRe.exec(policy); m; m = sectionRe.exec(policy)) {
      marks.push({ id: String(m[1]), at: m.index });
    }
    expect(marks.length).toBeGreaterThan(4);

    const periodRe =
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|months?|years?)\b/i;
    const statesAPeriod = marks
      .filter((mark, i) => {
        const end = marks[i + 1]?.at ?? policy.length;
        return periodRe.test(policy.slice(mark.at, end));
      })
      .map((m) => m.id);

    const citedSections = [
      ...new Set(
        rows
          .map((r) => String(r.canonical_owner_doc_and_section))
          .filter((c) => c.startsWith("legal/privacy-policy/"))
          .map((c) => c.replace(/^.*§/, "")),
      ),
    ];

    expect(citedSections.sort()).toEqual(statesAPeriod.sort());
  });

  it("F1.10 — the registry's horizons are the constants the mechanisms use", () => {
    // The chokepoint. A registry number that disagrees with the SQL constant
    // is worse than no registry: it documents a schedule nothing runs.
    const notif = sqlConstant("notification_retention_days");
    const ops = sqlConstant("operational_log_retention_days");
    const fin = sqlConstant("financial_record_retention_days");
    const evid = sqlConstant("deletion_evidence_retention_months");
    expect(notif).toBe(90);
    expect(ops).toBe(90);
    expect(fin).toBe(2557);
    expect(evid).toBe(24);

    expect(byId("RPOL-NOTIF-01").retention_horizon_seconds).toBe(
      Number(notif) * 86400,
    );
    expect(byId("RPOL-OPS-01").retention_horizon_seconds).toBe(
      Number(ops) * 86400,
    );
    expect(byId("RPOL-BILLING-01").retention_horizon_seconds).toBe(
      Number(fin) * 86400,
    );
    expect(byId("RPOL-DELETE-02").retention_horizon_months).toBe(Number(evid));

    // There is no BigQuery archive row to check. The owner ruling of
    // 2026-09-22 removed the archive rather than expiring it, so the surface
    // and its 730-day constant are both gone — see SCL-106 and the note where
    // the row used to be.
    expect(rows.some((r) => r.policy_id === "RPOL-ANALYTICS-04")).toBe(false);
  });

  it("F1.11 — Doc 07E §6's two rows are consumed verbatim, not restated", () => {
    const spec07e = read(SPEC_07E).replace(/\\_/g, "_");
    const checks: [string, string, string | number][] = [
      ["RPOL-ANALYTICS-01", "canonical_owner_doc_and_section", "Doc 07E V1.0 §5.1"],
      ["RPOL-ANALYTICS-01", "classification", "pii"],
      ["RPOL-ANALYTICS-01", "retention_horizon_months", 12],
      ["RPOL-ANALYTICS-01", "purge_substrate", "doc05d_cascade"],
      ["RPOL-ANALYTICS-01", "purge_lag_allowance_seconds", 604800],
      ["RPOL-ANALYTICS-02", "canonical_owner_doc_and_section", "Doc 07E V1.0 §5.2"],
      ["RPOL-ANALYTICS-02", "classification", "pseudonymized_personal_data"],
      ["RPOL-ANALYTICS-02", "purge_substrate", "manual"],
      [
        "RPOL-ANALYTICS-02",
        "partial_provable_until",
        "FWD-07E-V1.1-CARDINALITY-BUCKETING",
      ],
    ];
    for (const [id, field, value] of checks) {
      expect(byId(id)[field], `${id}.${field}`).toBe(value);
    }
    // ...and the values are 07E's, not ours: each appears in 07E's own text.
    expect(spec07e.includes("RPOL-ANALYTICS-01")).toBe(true);
    expect(spec07e.includes("RPOL-ANALYTICS-02")).toBe(true);
    expect(spec07e.includes("pseudonymized_personal_data")).toBe(true);
    expect(spec07e.includes("FWD-07E-V1.1-CARDINALITY-BUCKETING")).toBe(true);
    // 07E's rows keep 07E's review date; ours keep ours.
    expect(byId("RPOL-ANALYTICS-01").last_reviewed_at).toBe("2026-05-26");
    expect(byId("RPOL-ANALYTICS-02").last_reviewed_at).toBe("2026-05-26");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite C — the gaps are recorded, not pretended away
// ══════════════════════════════════════════════════════════════════════

describe("F1 suite C — the alert-registry prerequisite", () => {
  it("F1.12 — alert ids are null exactly while the alert registry is absent", () => {
    const alertRegistryExists = existsSync(
      path.join(repoRoot, ALERT_REGISTRY_REL),
    );
    const allNull = rows.every((r) => r.purge_alert_id === null);
    expect(
      allNull,
      alertRegistryExists
        ? `${ALERT_REGISTRY_REL} exists now — §9.3 (d)/(g) require every purge_alert_id to resolve there`
        : `${ALERT_REGISTRY_REL} does not exist, so no purge_alert_id can resolve`,
    ).toBe(!alertRegistryExists);
  });

  it("F1.13 — the missing registry is named as a prerequisite with its owner", () => {
    expect(prerequisites.length).toBeGreaterThan(0);
    const alert = prerequisites.find((p) => p.path === ALERT_REGISTRY_REL);
    expect(alert, `${ALERT_REGISTRY_REL} not named in prerequisites`).toBeDefined();
    expect(String(alert?.owning_doc_and_section)).toContain("06C");
    expect(String(alert?.required_by)).toContain("9.3");
    expect(alert?.status).toBe("absent");
    expect(String(alert?.consequence)).toContain("SCL-107");
  });

  it("F1.14 — the §9.3 conditions this file knowingly fails are named in it", () => {
    // Not a class of tolerated failures: each one is written down, so a reader
    // does not have to rediscover why the parity gate cannot run yet.
    for (const marker of ["§9.3 (d)", "§9.3 (g)", "§9.3 (i)"]) {
      expect(REGISTRY, `${marker} not explained in the registry header`).toContain(
        marker,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Suite D — one parser, not three
// ══════════════════════════════════════════════════════════════════════

describe("F1 suite D — the YAML parser is shared", () => {
  it("F1.15 — no second copy of parseYamlScalar exists", () => {
    const defining = ["scripts/ci/secret-class-inventory-check.ts"].filter(
      (rel) => /function parseYamlScalar/.test(readOrEmpty(rel)),
    );
    expect(
      defining,
      "a second parseYamlScalar definition has appeared; consume scripts/ci/lib/minimal-yaml.ts instead",
    ).toEqual([]);
    expect(readOrEmpty("scripts/ci/secret-class-inventory-check.ts")).toContain(
      'from "./lib/minimal-yaml"',
    );
  });

  it("F1.16 — an inline comment does not change a scalar's type", () => {
    // The defect the extraction fixed: null/true/false were classified before
    // the inline comment was stripped, so `null # note` parsed as the string
    // "null" while a bare `null` parsed as null.
    expect(parseYamlScalar("null   # see prerequisites")).toBeNull();
    expect(parseYamlScalar("true # note")).toBe(true);
    expect(parseYamlScalar("false # note")).toBe(false);
    expect(parseYamlScalar("90 # days")).toBe(90);
    // ...and a hash inside quotes is still part of the value.
    expect(parseYamlScalar("'a # b'")).toBe("a # b");
  });

  it("F1.17 — a block scalar throws rather than parsing as its indicator", () => {
    expect(() =>
      parseFlatMappingList("k:\n  - a: >-\n      text\n", "k"),
    ).toThrow(/block scalars are not supported/);
  });
});
