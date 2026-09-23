/**
 * F2 — the declared retention periods match the enforced ones, on real Postgres.
 *
 * @spec [Doc-01A App A.5; Doc-01_V8 §5.1 ("Retention values live in
 *        `observability_runtime_config` per Doc 01A §74"); Privacy Policy v4
 *        §6.5 and §6.7; SCL-101 (ii) and (iii); owner rulings 2026-09-22 F2 and
 *        "published policy is the canonical owner of retention periods"]
 * @implemented 2026-09-22
 *
 * plain English: `observability_runtime_config` has existed since genesis
 * holding nothing, and NOTHING READS IT — the owner ruling seeds it anyway, so
 * the declared period and the enforced period can be compared. Nothing else
 * compares them. If these assertions do not, the rows are decoration that will
 * drift from behaviour the first time a period changes, which is the exact
 * failure mode SCL-101 was opened about.
 *
 * So F2.2 and F2.3 do not assert a literal. They read the config row AND call
 * the function that enforces the period, and require them equal. Editing
 * either one alone reddens this; editing the published policy alone reddens
 * `tests/ci/retention-policy-publication.contract.test.ts`. The three together
 * are the chain policy → mechanism → declaration.
 *
 * trade-offs:
 *  - Needs a real Postgres (the migration runs functions at INSERT time).
 *    Skipped when PGHOST is unset, like every other *.pg.ci.test.ts here.
 *  - Asserts the seeded SHAPE of `audit_retention_by_category` (one category)
 *    rather than only its value, because the shape is the claim: four tiers
 *    would publish three periods nothing enforces.
 *
 * edge cases:
 *  - F2.4 is a negative: `cold_log_retention_days` must be ABSENT. A seeded 365
 *    there would declare a cold archive that does not exist. Asserting the
 *    absence is what stops the A.5 launch value being pasted in later "for
 *    completeness".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";
import { stripComments } from "./lib/strip-comments";

const DB_NAME = "observability_retention_config_ci";

/** The migration under test, re-executed by F2.7 to prove its conflict clause. */
const MIGRATION =
  "supabase/migrations/20260922020000_observability_retention_config.sql";

let pg: Client;

async function configValue(key: string): Promise<unknown | undefined> {
  const r = await pg.query(
    `SELECT value FROM public.observability_runtime_config WHERE key = $1`,
    [key],
  );
  return r.rows.length === 0 ? undefined : (r.rows[0].value as unknown);
}

describe.skipIf(!PG_AVAILABLE)(
  "Observability retention config (Doc 01A A.5 / F2)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("F2.1 — the migration seeded exactly the two Legal-owned retention keys", async () => {
      const r = await pg.query(
        `SELECT key, owner FROM public.observability_runtime_config ORDER BY key`,
      );
      expect(r.rows.map((x: { key: string }) => x.key)).toEqual([
        "audit_retention_by_category",
        "hot_log_retention_days",
      ]);
      for (const row of r.rows as { owner: string }[]) {
        // A.5 assigns both to Legal. An Engineering-owned row appearing here
        // would mean a non-retention key was seeded under this ruling.
        expect(row.owner).toBe("Legal");
      }
    });

    it("F2.2 — the declared audit period equals the one audit_logs_retention_days() enforces", async () => {
      const declared = (await configValue("audit_retention_by_category")) as
        | Record<string, number>
        | undefined;
      const enforced = (
        await pg.query(`SELECT public.audit_logs_retention_days() AS d`)
      ).rows[0].d as number;

      expect(declared).toBeDefined();
      // ONE category. Doc 01 V8 §5.1's four tiers are neither published nor
      // built (SCL-101 (ii)); seeding them would declare three periods that
      // nothing enforces.
      expect(Object.keys(declared ?? {})).toEqual([
        "security_and_administrative",
      ]);
      expect(declared?.security_and_administrative).toBe(enforced);
    });

    it("F2.3 — the declared operational ceiling equals the one the sweep enforces", async () => {
      const declared = await configValue("hot_log_retention_days");
      const enforced = (
        await pg.query(`SELECT public.operational_log_retention_days() AS d`)
      ).rows[0].d as number;

      expect(declared).toBe(enforced);
    });

    it("F2.4 — cold_log_retention_days is NOT seeded: no cold archive exists", async () => {
      // A.5 gives it a launch value of 365. SCL-101 (iii): `audit_logs_archive`
      // is referenced across the corpus and the table does not exist, and v4
      // makes no claim that expired security records move anywhere.
      expect(await configValue("cold_log_retention_days")).toBeUndefined();

      // The stronger half: the table it would describe must also be absent, so
      // this assertion stops being a pin the day someone builds the archive.
      const t = await pg.query(
        `SELECT to_regclass('public.audit_logs_archive') AS rel`,
      );
      expect(t.rows[0].rel).toBeNull();
    });

    it("F2.5 — alert_thresholds is NOT seeded while the alert registry is absent", async () => {
      // Doc 07 Parent INV-07-09 is a negative invariant: no Doc 07 V1
      // mechanism produces an alert. `infra/alert-registry.yaml` does not
      // exist; the retention registry's `prerequisites:` block names it.
      expect(await configValue("alert_thresholds")).toBeUndefined();
    });

    it("F2.6 — every seeded value_type matches the jsonb it holds", async () => {
      // A row whose value_type says `integer` over a jsonb object would pass
      // every assertion above and break the first reader the table ever gets.
      const r = await pg.query(
        `SELECT key, value_type, jsonb_typeof(value) AS actual
           FROM public.observability_runtime_config`,
      );
      const EXPECTED: Record<string, string> = {
        integer: "number",
        float: "number",
        string: "string",
        boolean: "boolean",
        array: "array",
        object: "object",
      };
      for (const row of r.rows as {
        key: string;
        value_type: string;
        actual: string;
      }[]) {
        expect(`${row.key}:${row.actual}`).toBe(
          `${row.key}:${EXPECTED[row.value_type]}`,
        );
      }
    });

    it("F2.8 — each seeded value is DERIVED from its enforcing function, not typed", async () => {
      // F2.2 and F2.3 compare declared against enforced, and today both agree —
      // so a hardcoded 365 would pass them, right up until someone changes the
      // config the function reads. The derivation is the property that makes
      // the two impossible to separate, so it is asserted directly, on the
      // migration source, with comments stripped (the file explains at length
      // why the values are computed, and that prose contains the call).
      const sql = stripComments(
        readFileSync(resolve(__dirname, "../..", MIGRATION), "utf-8"),
      );
      expect(sql).toContain("to_jsonb(public.audit_logs_retention_days())");
      expect(sql).toContain(
        "to_jsonb(public.operational_log_retention_days())",
      );

      // And no bare numeric literal inside the VALUES list, which is where a
      // typed period would go. min_value/max_value are bounds, not periods, and
      // are quoted jsonb ('30'::jsonb), so they do not match this.
      const values = sql.slice(
        sql.indexOf("VALUES"),
        sql.indexOf("ON CONFLICT"),
      );
      expect(values).not.toMatch(/to_jsonb\(\s*\d/);
    });

    it("F2.7 — replaying the migration never overwrites an operator's value", async () => {
      // An operator tuning the ceiling must not have it reverted by a migration
      // replay. This re-executes THE MIGRATION FILE rather than an inline
      // INSERT that restates its conflict clause: a test asserting its own SQL
      // would pass whatever the migration says, which is no assertion at all.
      await pg.query(
        `UPDATE public.observability_runtime_config
            SET value = '45'::jsonb
          WHERE key = 'hot_log_retention_days'`,
      );

      await pg.query(
        readFileSync(resolve(__dirname, "../..", MIGRATION), "utf-8"),
      );

      expect(await configValue("hot_log_retention_days")).toBe(45);

      // Put it back so ordering between tests cannot matter.
      await pg.query(
        `UPDATE public.observability_runtime_config
            SET value = to_jsonb(public.operational_log_retention_days())
          WHERE key = 'hot_log_retention_days'`,
      );
    });
  },
);
