/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic prompting]
 * @implemented 2026-08-14
 *
 * plain English: typed gate component that renders DiagnosticCTACard ONLY
 * when estimateStatus === "no_baseline". Encapsulates the show/hide decision
 * so both dashboard and practice surfaces share one tested gate rather than
 * duplicating the inline conditional.
 *
 * expected outcome: card renders for undiagnosed students (no_baseline),
 * returns null for baseline_only, computed, and undefined (loading).
 *
 * trade-offs: thin wrapper — the gate is a single equality check, but
 * extracting it enables behavioral testing of the show/hide contract
 * without rendering the full parent pages.
 */
import type { EstimateStatus } from "@/lib/projectionApi";
import { DiagnosticCTACard } from "./DiagnosticCTACard";

type DiagnosticCTAGateProps = {
  estimateStatus: EstimateStatus | undefined;
  className?: string;
};

export function DiagnosticCTAGate({
  estimateStatus,
  className,
}: DiagnosticCTAGateProps): React.ReactElement | null {
  if (estimateStatus !== "no_baseline") return null;
  return <DiagnosticCTACard className={className} />;
}
