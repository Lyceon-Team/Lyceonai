/**
 * @spec [student-UI register OQ-36 (owner ruling 2026-10-02), §8 F-51, F-55; §2 Free versus paid
 *        as amended by SCL-235 (owner ruling 2026-10-16: the ongoing projection is Premium-only;
 *        a free student sees their diagnostic projection); evidence/wiring-table.md §3 Home
 *        ("Right panel: projected range (both plans)"; "Start diagnostic; when to show the
 *        card")] | @implemented [2026-10-03; kind 2026-10-17]
 *
 * plain English: Home's two projection reads, for both plans. The band comes from
 * `GET /api/students/:id/projections/sections` — the live projection for a paid student, the
 * stored diagnostic projection for a free one (SCL-235; the server chooses, `kind` says which)
 * — and is summed by the calendar's
 * `projectedRange` (the ONE place a composite is formed: both sections or none). The status
 * (`no_baseline`, `baseline_pending`, ...) comes from `/api/progress/projection`, read through a
 * schema that keeps that one field. Nothing else of that route reaches the page.
 */
import { useQuery } from "@tanstack/react-query";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import type { EstimateStatus } from "@lyceon/shared/diagnostic-state";
import {
  projectedRange,
  type ProjectedRange,
} from "@/features/calendar/lib/projection";
import {
  ESTIMATE_STATUS_PATH,
  fetchEstimateStatus,
  fetchSectionProjections,
} from "@/lib/projectionApi";

type HomeProjection = {
  /** The composite band, or null below Doc 05C's gate (or before the read lands). */
  readonly range: ProjectedRange | null;
  /** Which projection `range` is: undefined while loading or after a failed read. */
  readonly kind: "live" | "diagnostic" | undefined;
  /**
   * The stored diagnostic projection is below the evidence gate (owner ruling D1 (a)): the
   * diagnostic is done and there is honestly no number. Only ever true for `kind: "diagnostic"`.
   */
  readonly diagnosticInsufficient: boolean;
  /** `/api/progress/projection`'s status; undefined while loading or after a failed read. */
  readonly estimateStatus: EstimateStatus | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
};

export function useHomeProjection(studentId: string): HomeProjection {
  const enabled = studentId.length > 0;
  const sections = useQuery({
    queryKey: [studentResourceUrl(studentId, "projectionsSections")],
    queryFn: () => fetchSectionProjections(studentId),
    enabled,
  });
  const status = useQuery({
    // Its own key: the practice page caches the route's whole body under the bare path, and
    // this read keeps one field of it.
    queryKey: [ESTIMATE_STATUS_PATH, "estimateStatus"],
    queryFn: fetchEstimateStatus,
    enabled,
  });
  return {
    range: projectedRange(sections.data?.sections),
    kind: sections.data?.kind,
    diagnosticInsufficient:
      sections.data?.kind === "diagnostic" &&
      sections.data.status === "insufficient_evidence",
    estimateStatus: status.data,
    isLoading: sections.isLoading || status.isLoading,
    isError: sections.isError || status.isError,
    refetch: () => {
      void sections.refetch();
      void status.refetch();
    },
  };
}
