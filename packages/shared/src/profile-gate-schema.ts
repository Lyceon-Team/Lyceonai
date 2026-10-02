/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3 (onboarding gate); Coding Standards §3.2
 *        (no `any`), §7.1 (parse at every boundary), §7.2 (schema in packages/shared);
 *        student-ui register UI-10] | @implemented [2026-09-29]
 *
 * plain English: the slice of `GET /api/profile` (server/routes/profile-routes.ts) that the
 * client's route gate, RequireRole, reads to decide whether an account still needs onboarding.
 * It replaces a hand-written `interface` whose index signature was `any`. Deliberately a SUBSET:
 * the gate reads only these fields, and it parses at the read site, so the cached payload other
 * `/api/profile` readers depend on is never narrowed. Every field is optional because the
 * 401/403 branch yields `{ authenticated: false, user: null }`. `outstandingLegal` stays
 * `unknown` here; RequireRole narrows it with the canonical `outstandingLegalSchema`, so a
 * malformed legal list empties the prompt without failing the onboarding decision.
 */
import { z } from "zod";

export const profileGateSchema = z.object({
  authenticated: z.boolean().optional(),
  user: z
    .object({
      profileCompletedAt: z.string().nullable().optional(),
      requiredProfileComplete: z.boolean().optional(),
      guardianConsentRequired: z.boolean().optional(),
      outstandingLegal: z.unknown().optional(),
    })
    .nullable()
    .optional(),
});
