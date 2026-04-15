import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260408_rate_limit_ledger_truth.sql",
);

describe("Rate-Limit SQL Contract", () => {
  it("defines canonical ledger and all required atomic functions", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.usage_rate_limit_ledger");
    expect(sql).toContain("scope IN ('practice', 'full_length', 'tutor', 'calendar')");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_and_reserve_practice_quota");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_and_reserve_full_length_quota");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_and_reserve_calendar_quota");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_and_reserve_tutor_budget");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.finalize_tutor_usage");
  });

  it("encodes rolling-window limits for practice, full-length, and tutor budget windows", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/interval '24 hours'/i);
    expect(sql).toMatch(/interval '7 days'/i);
    expect(sql).toMatch(/interval '5 minutes'/i);
  });

  it("contains concurrency guards and dedupe keys for atomic protection", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_rate_limit_ledger_dedupe");
    expect(sql).toMatch(/dedupe_key/i);
  });

  it("locks stable denial codes for canonical quota surfaces", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("PRACTICE_FREE_DAILY_QUOTA_EXCEEDED");
    expect(sql).toContain("FULL_LENGTH_QUOTA_EXCEEDED");
    expect(sql).toContain("TUTOR_BUDGET_EXCEEDED");
    expect(sql).toContain("TUTOR_COOLDOWN_ACTIVE");
    expect(sql).toContain("TUTOR_DENSITY_LIMIT_EXCEEDED");
    expect(sql).toContain("CALENDAR_REFRESH_QUOTA_EXCEEDED");
  });

  it("locks counted calendar events for rolling seven-day quota", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("calendar_refresh_auto");
    expect(sql).toContain("calendar_regenerate_full");
    expect(sql).toContain("calendar_regenerate_day");
    expect(sql).toMatch(/calendar_quota:/i);
  });
});
