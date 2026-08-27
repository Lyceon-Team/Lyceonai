/**
 * @spec [Doc 05C §10.1 visibility matrix, §10.2 single-route contract (mirrors 05B §10.3),
 *   §10.5 projection column projection; owner ruling 2026-08-27 PR 2]
 * | @implemented [2026-08-27]
 *
 * plain English: reads `student_section_projections` and
 * `student_section_projection_snapshots` for one student. One function per resource, shared
 * by the student and guardian paths — `studentId` is whose data is read, nothing here knows
 * who is asking.
 *
 * WHAT IS DELIBERATELY NOT SELECTED. `mastery_term`, `blend_denominator`, `fl_count_used`,
 * `projection_constants_hash`, `mastery_model_version` and `refreshed_at_t_now` are the
 * blend anchors and refresh bookkeeping that Doc 05C §10.5 keeps off read surfaces. They are
 * absent from the SELECT rather than stripped afterwards: a column that is never read cannot
 * be spread into a response by a later edit.
 *
 * A FAILED READ THROWS, never `[]`.
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  masterySectionSchema,
  type ProjectionSnapshotDto,
  type SectionProjectionDto,
} from "../../../../packages/shared/src/index";

type ProjectionRow = {
  section: string;
  projected_score_mid: number | null;
  projected_score_low: number | null;
  projected_score_high: number | null;
  relevant_question_count: number | null;
  computed_at: string | null;
};

type SnapshotRow = Omit<ProjectionRow, "computed_at"> & {
  snapshot_at: string;
  snapshot_kind: string;
};

function canonicalSection(value: string): "M" | "RW" | null {
  const parsed = masterySectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function readSectionProjections(args: {
  studentId: string;
}): Promise<SectionProjectionDto[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("student_section_projections")
    .select(
      "section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count, computed_at",
    )
    .eq("student_id", args.studentId)
    .order("section", { ascending: true });

  if (error) {
    throw new Error(`section_projections_query_failed: ${error.message}`);
  }

  return ((data ?? []) as ProjectionRow[]).flatMap((row) => {
    const section = canonicalSection(row.section);
    if (!section) return [];
    return [
      {
        section,
        projectedScoreMid: row.projected_score_mid,
        projectedScoreLow: row.projected_score_low,
        projectedScoreHigh: row.projected_score_high,
        relevantQuestionCount: row.relevant_question_count,
        computedAt: row.computed_at,
      },
    ];
  });
}

export async function readProjectionSnapshots(args: {
  studentId: string;
}): Promise<ProjectionSnapshotDto[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("student_section_projection_snapshots")
    .select(
      "section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count, snapshot_at, snapshot_kind",
    )
    .eq("student_id", args.studentId)
    .order("snapshot_at", { ascending: false })
    .order("section", { ascending: true });

  if (error) {
    throw new Error(`projection_snapshots_query_failed: ${error.message}`);
  }

  return ((data ?? []) as SnapshotRow[]).flatMap((row) => {
    const section = canonicalSection(row.section);
    if (!section) return [];
    return [
      {
        section,
        projectedScoreMid: row.projected_score_mid,
        projectedScoreLow: row.projected_score_low,
        projectedScoreHigh: row.projected_score_high,
        relevantQuestionCount: row.relevant_question_count,
        snapshotAt: row.snapshot_at,
        snapshotKind: row.snapshot_kind,
      },
    ];
  });
}
