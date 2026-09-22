/**
 * @spec [Doc-03_V3 §21.2, §21.3; CR-03C-V3-01 §3.4; Coding Standards §7.1,
 *        §7.2; owner ruling 2026-09-22 D1]
 * @implemented 2026-09-22
 *
 * plain English: the shape `public.flag_conversation_for_crisis_review`
 * returns. The RPC is a boundary like any other, so its payload is parsed
 * before it reaches business logic rather than cast.
 *
 * expected outcome: a parsed result carries the case id, the SLA deadline the
 * database computed, whether an active case already existed, and which source
 * value actually persisted.
 *
 * trade-offs:
 *  - `persistedSource` is null exactly when `alreadyExisted` is true: the
 *    existing case's source belongs to the earlier signal, not this one, and
 *    reporting it as this call's outcome would be wrong. The refinement below
 *    makes that a parse failure rather than a convention.
 *  - `slaDeadline` stays a string. It is logged and forwarded to the ops
 *    notification; nothing does date arithmetic on it, and a Date here would
 *    be re-serialised at every hop.
 */
import { z } from "zod";

/** Source values Doc 03 §21.3 and the crisis path recognise. */
export const crisisSourceSchema = z.enum([
  "signature",
  "model",
  "both",
  "classifier_degraded",
  "classifier_degraded_no_floor",
  "infrastructure_failure",
]);
export type CrisisSource = z.infer<typeof crisisSourceSchema>;

/** Categories `crisis_review_cases.category` accepts. */
export const crisisCategorySchema = z.enum(["crisis", "safeguarding"]);
export type CrisisCategory = z.infer<typeof crisisCategorySchema>;

export const crisisFlagResultSchema = z
  .object({
    case_id: z.string().uuid(),
    sla_deadline: z.string().min(1),
    already_existed: z.boolean(),
    persisted_source: crisisSourceSchema.nullable(),
  })
  .refine((r) => (r.already_existed ? r.persisted_source === null : true), {
    message:
      "persisted_source must be null when an active case already existed: that case's source belongs to the earlier signal",
    path: ["persisted_source"],
  })
  .refine((r) => (r.already_existed ? true : r.persisted_source !== null), {
    message: "a newly created case must report the source that persisted",
    path: ["persisted_source"],
  });

export type CrisisFlagResult = z.infer<typeof crisisFlagResultSchema>;
