/**
 * @spec [Doc-03B_V2 §4.1] | @implemented 2026-08-05
 * plain English: Re-exports the canonical tutor-orchestrator wire schemas from
 * shared/tutor-orchestrator-wire.ts. All schemas live in shared/ (L1.4); this
 * file is the worker's import surface so existing worker code doesn't change.
 *
 * expected outcome: single source of truth in shared/, zero inline duplicates.
 * trade-offs: prebuild step copies shared file into worker src/ as a generated
 *   file (_tutor-orchestrator-wire.generated.ts) so Cloud Run buildpacks can
 *   compile in isolation without cross-package tsconfig includes.
 */
export {
  resolvedScopeSchema,
  recentMessageSchema,
  memorySummarySchema,
  policyAssignmentSchema,
  orchestrateRequestSchema,
  questionLinkSchema,
  instructionExposureSchema,
  orchestrateResponseSchema,
  compactRequestSchema,
  compactResponseSchema,
  type OrchestrateRequest,
  type OrchestrateResponse,
  type CompactRequest,
  type CompactResponse,
} from "./_tutor-orchestrator-wire.generated.js";
