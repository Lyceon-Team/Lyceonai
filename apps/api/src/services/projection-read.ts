/**
 * @spec [Doc 05C §10.1 visibility matrix, §10.2 single-route contract (mirrors 05B §10.3),
 *   §10.5 projection column projection; owner ruling 2026-08-27 PR 2]
 * | @implemented [2026-08-27]
 *
 * plain English: reads `student_section_projections` and
 * `student_section_projection_snapshots` for one student, and (SCL-236) the stored
 * diagnostic projection in `student_diagnostic_projections`. One function per resource, shared
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
  diagnosticProjectionStatusSchema,
  masterySectionSchema,
  type DiagnosticProjectionRead,
  type ProjectionSnapshotDto,
  type SectionProjectionDto,
} from "../../../../packages/shared/src/index";

/**
 * SCL-236 / owner ruling 2026-10-17 D4: the old `diagnostic_baseline` snapshot rows are audit
 * history only. They were copies of the live projection, so no read surface serves them; the
 * diagnostic number is `readDiagnosticProjection`'s, from its own table.
 */
const RETIRED_SNAPSHOT_KIND = "diagnostic_baseline";

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
    .neq("snapshot_kind", RETIRED_SNAPSHOT_KIND)
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

type DiagnosticProjectionRow = ProjectionRow & {
  practice_session_id: string;
  status: string;
};

/**
 * @spec [SCL-236 (Doc 05C §12A: the stored diagnostic projection), SCL-235 (Doc 02B §12: what a
 *        free student sees); owner ruling 2026-10-17 constraint 5 ("One read path for the
 *        diagnostic projection. A single server function serves it, and both
 *        /projections/sections (for free students) and /api/progress/projection use it")]
 *        | @implemented [2026-10-17]
 *
 * plain English: THE read of a student's diagnostic projection — the write-once rows
 * `complete_diagnostic_session` stored from that diagnostic's own answers. Nothing else serves
 * the diagnostic number; nothing here recomputes it.
 *
 * WHAT IS DELIBERATELY NOT SELECTED: `domain_mastery` (per-domain mastery, which a free student
 * does not see — mastery is `mastery_detail`), `mastery_term`, `answered_count` and the
 * constants hashes / model version. Absent from the SELECT, as above, so no later spread can
 * leak them.
 *
 * WHICH SESSION. A student has at most one completed diagnostic (the once-only index), and only
 * completed sessions get rows. If rows from two sessions are ever present, the most recently
 * computed session's rows are served and the other's are ignored, never mixed.
 *
 * status: `computed` only when every stored section is (the aggregate
 * `complete_diagnostic_session` returns); `insufficient_evidence` otherwise; `null` when no row
 * is stored. A failed read THROWS, never an empty result.
 */
export async function readDiagnosticProjection(args: {
  studentId: string;
}): Promise<DiagnosticProjectionRead> {
  const { data, error } = await getSupabaseAdmin()
    .from("student_diagnostic_projections")
    .select(
      "practice_session_id, section, status, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count, computed_at",
    )
    .eq("student_id", args.studentId)
    .order("computed_at", { ascending: false })
    .order("section", { ascending: true });

  if (error) {
    throw new Error(`diagnostic_projection_query_failed: ${error.message}`);
  }

  const rows = (data ?? []) as DiagnosticProjectionRow[];
  const sessionId = rows[0]?.practice_session_id;
  if (sessionId === undefined) return { status: null, sections: [] };

  const statuses: string[] = [];
  const sections = rows
    .filter((row) => row.practice_session_id === sessionId)
    .flatMap((row): SectionProjectionDto[] => {
      const section = canonicalSection(row.section);
      if (!section) return [];
      statuses.push(row.status);
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
    })
    .sort((a, b) => a.section.localeCompare(b.section));

  // A status outside the table's CHECK is a contract break, not a value to guess at.
  const parsed = statuses.map((s) => diagnosticProjectionStatusSchema.parse(s));
  if (parsed.length === 0) return { status: null, sections: [] };
  return {
    status: parsed.every((s) => s === "computed")
      ? "computed"
      : "insufficient_evidence",
    sections,
  };
}
