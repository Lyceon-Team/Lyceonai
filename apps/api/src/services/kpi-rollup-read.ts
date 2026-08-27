/**
 * @spec [Doc 05B §6.5/§6.7 KPI rollup grain and granted columns; §10.3 single-route
 *   contract; §10.5 column projection; owner ruling 2026-08-27 PR 2]
 * | @implemented [2026-08-27]
 *
 * plain English: reads `student_section_kpi` and `student_domain_kpi` for one student.
 * `studentId` is WHOSE data is read; who is asking is not this function's business, which is
 * exactly why one function serves both the student and the guardian route.
 *
 * NEITHER TABLE HAD A READER BEFORE THIS. The mastery pipeline has been populating
 * `student_section_kpi` and `student_domain_kpi`, and no application code anywhere read
 * either one — §10.3 names both resources and neither was ever served.
 *
 * COLUMNS ARE NAMED, NEVER `*`. §10.5 is explicit: "Never SELECT * and serialize raw; never
 * expose refreshed_at_*, mastery_score, mastery_pct, kpi_refresh_version". A `select("*")`
 * here would put `kpi_refresh_version` and both `refreshed_at` columns on a parent's screen,
 * and the anti-leak gate would catch it only if someone remembered to walk this surface.
 *
 * A FAILED READ THROWS. It never returns `[]`. Empty and failed are different answers, and
 * this vertical has produced eleven instances of that collapse.
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { toAccuracyPercent } from "../../../../server/services/canonical-runtime-views";
import {
  masterySectionSchema,
  type DomainKpiDto,
  type SectionKpiDto,
} from "../../../../packages/shared/src/index";

type SectionKpiRow = {
  section: string;
  events_total: number | null;
  accuracy_overall: number | null;
  current_streak_days: number | null;
  last_active_at: string | null;
};

type DomainKpiRow = {
  section: string;
  domain: string;
  events_total: number | null;
  accuracy_overall: number | null;
  last_active_at: string | null;
};

/** A count the database could not establish is not a zero; it is a contract violation. */
function toCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

/**
 * Rows whose `section` is not canonical are DROPPED, not coerced. Four section vocabularies
 * exist in this codebase (`M`/`RW`, `MATH`/`RW`, `Math`/`Reading & Writing`, `rw`/`math`);
 * silently mapping one onto another is how a value ends up attributed to the wrong section.
 */
function canonicalSection(value: string): "M" | "RW" | null {
  const parsed = masterySectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function readSectionKpi(args: {
  studentId: string;
}): Promise<SectionKpiDto[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("student_section_kpi")
    .select("section, events_total, accuracy_overall, current_streak_days, last_active_at")
    .eq("student_id", args.studentId)
    .order("section", { ascending: true });

  if (error) {
    throw new Error(`section_kpi_query_failed: ${error.message}`);
  }

  const rows = (data ?? []) as SectionKpiRow[];
  return rows.flatMap((row) => {
    const section = canonicalSection(row.section);
    if (!section) return [];
    const eventsTotal = toCount(row.events_total);
    return [
      {
        section,
        eventsTotal,
        accuracyPct: toAccuracyPercent(row.accuracy_overall, eventsTotal),
        currentStreakDays: toCount(row.current_streak_days),
        lastActiveAt: row.last_active_at,
      },
    ];
  });
}

export async function readDomainKpi(args: {
  studentId: string;
}): Promise<DomainKpiDto[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("student_domain_kpi")
    .select("section, domain, events_total, accuracy_overall, last_active_at")
    .eq("student_id", args.studentId)
    .order("section", { ascending: true })
    .order("domain", { ascending: true });

  if (error) {
    throw new Error(`domain_kpi_query_failed: ${error.message}`);
  }

  const rows = (data ?? []) as DomainKpiRow[];
  return rows.flatMap((row) => {
    const section = canonicalSection(row.section);
    if (!section) return [];
    const eventsTotal = toCount(row.events_total);
    return [
      {
        section,
        domain: row.domain,
        eventsTotal,
        accuracyPct: toAccuracyPercent(row.accuracy_overall, eventsTotal),
        lastActiveAt: row.last_active_at,
      },
    ];
  });
}
