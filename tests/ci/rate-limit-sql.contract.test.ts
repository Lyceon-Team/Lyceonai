import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Rate-Limit SQL contract — RE-POINTED to the genesis baseline (WS-1 genesis re-cut).
 *
 * The previous target `20260408_rate_limit_ledger_truth.sql` (table
 * `usage_rate_limit_ledger`, `check_and_reserve_*` functions, 24h/7d/5min windows,
 * app denial codes) was the Doc-02C-generation rate-limit implementation the
 * registry flagged as wrong-generation (GAP-ID-06 practice quota 20/rolling-24h vs
 * spec 40/calendar-day; GAP-TU-05 tutor density windows vs spec per-min/…/month).
 * The teardown + genesis-from-spec rebuild archives it
 * (docs/SpecAudit/_legacy-migrations/) and builds the canonical Doc 01A §41
 * primitive in the genesis foundation. Per-surface quota sizes and denial codes are
 * owned by later waves (runtime/entitlement) + config — NOT the foundation schema.
 *
 * This contract now locks the genesis rate-limit primitive (Doc 01A §41). Structural
 * application correctness is additionally proven by scripts/ci/genesis-fresh-apply.sh.
 */
const genesisPath = path.resolve(
  process.cwd(),
  "supabase/migrations/00000000000000_genesis.sql",
);

describe("Rate-Limit SQL Contract (genesis, Doc 01A §41)", () => {
  it("defines the canonical rate_limit_ledger with the spec primary key", () => {
    const sql = fs.readFileSync(genesisPath, "utf8");
    expect(sql).toMatch(/CREATE TABLE public\.rate_limit_ledger/i);
    expect(sql).toMatch(
      /PRIMARY KEY \(profile_id, bucket_key, window_start\)/i,
    );
    // ledger FK is scoped to a profile (cascades with the profile, not auth.users)
    expect(sql).toMatch(
      /profile_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\)/i,
    );
  });

  it("defines the atomic reserve-under-limit RPC (Doc 01A §41 intent)", () => {
    const sql = fs.readFileSync(genesisPath, "utf8");
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.rate_limit_check_and_increment/i,
    );
    // atomic: insert-or-conflict, then increment only while under the limit
    expect(sql).toMatch(
      /ON CONFLICT \(profile_id, bucket_key, window_start\)/i,
    );
    expect(sql).toMatch(/used_count \+ p_cost <= p_limit/i);
    // returns the allowed/remaining/used triple
    expect(sql).toMatch(
      /RETURNS TABLE \(allowed BOOLEAN, remaining INTEGER, used INTEGER\)/i,
    );
  });
});
