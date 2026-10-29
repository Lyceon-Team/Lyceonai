/**
 * The Monday growth report's numbers: what `public.growth_report_weekly` returns.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) item 3; supabase/migrations/20261122000000_growth_report.sql (the
 *       definitions)] | @implemented [2026-10-28]
 *
 * plain English: two weeks of counts (the reported week and the one before), nothing about any
 * one person. Parsed at the boundary, so a database change that alters the shape fails the run
 * loudly instead of posting a wrong number.
 */
import { z } from "zod";

const count = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const growthReportWeekSchema = z
  .object({
    week_start: isoDate,
    signups: count,
    signups_by_channel: z.record(z.string().min(1), count),
    active_students: count,
    returning_students: count,
    returning_by_test_date: z.array(
      z.object({ test_date: isoDate.nullable(), students: count }).strict(),
    ),
    questions_answered: count,
    full_length_answers: count,
    reviews_done: count,
    study_minutes_estimate: z.number().min(0),
    signups_answered_24h: count,
    upgrades: count,
  })
  .strict();
export type GrowthReportWeek = z.infer<typeof growthReportWeekSchema>;

export const growthReportSchema = z
  .object({ week: growthReportWeekSchema, previous: growthReportWeekSchema })
  .strict();
export type GrowthReport = z.infer<typeof growthReportSchema>;
