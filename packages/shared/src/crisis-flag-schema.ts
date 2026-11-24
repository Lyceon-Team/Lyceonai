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
 * database computed, whether an active case already existed, the case's
 * lifecycle status, and which source value actually persisted. The status is
 * what `evaluateNotificationPolicy` throttles on, so it is read back from the
 * row rather than assumed to be 'open'.
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
  // W3-5 (owner ruling 2026-09-24): a Model Armor INPUT block whose matched
  // filters include `dangerous`. Not a classifier signal — the case exists so
  // a human reviews what the classifier may have missed.
  "model_armor_dangerous",
]);
export type CrisisSource = z.infer<typeof crisisSourceSchema>;

/** Lifecycle states `crisis_review_cases.status` accepts. */
export const crisisCaseStatusSchema = z.enum(["open", "in_review", "resolved"]);
export type CrisisCaseStatus = z.infer<typeof crisisCaseStatusSchema>;

/** Categories `crisis_review_cases.category` accepts. */
export const crisisCategorySchema = z.enum(["crisis", "safeguarding"]);
export type CrisisCategory = z.infer<typeof crisisCategorySchema>;

export const crisisFlagResultSchema = z
  .object({
    case_id: z.string().uuid(),
    sla_deadline: z.string().min(1),
    already_existed: z.boolean(),
    case_status: crisisCaseStatusSchema,
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

/**
 * @spec [owner brief "Crisis classifier: record the failure reason, and look at the timeout",
 *       Karl 2026-11-08; CR-03C-V3-01 §3.4 (the Layer 2 failure classes) and §3.6; SCL-276]
 *       | @implemented [2026-11-08]
 * plain English: why Layer 2 (the model classifier) could not answer, recorded on the review case
 * and the turn's metrics row so an incident can be explained after Vercel's logs expire. Codes
 * only, never message text.
 *  - `timeout`: an attempt ran past CRISIS_CLASSIFIER_TIMEOUT_MS;
 *  - `rate_limited`: Vertex answered 429 / RESOURCE_EXHAUSTED;
 *  - `upstream_error`: a 5xx, a network failure, or output the parser cannot read;
 *  - `config_error`: the classifier cannot run as configured (a missing env var or credential, a
 *    model not found, a 4xx other than 429). A setup failure makes no model attempt.
 * Whatever the reason, the turn fails closed into human review: never "assume safe".
 */
export const crisisDegradedReasonSchema = z.enum([
  "timeout",
  "rate_limited",
  "upstream_error",
  "config_error",
]);
export type CrisisDegradedReason = z.infer<typeof crisisDegradedReasonSchema>;

/** Layer 2 model attempts per turn: the first, and the one retry (SCL-023, SCL-269). */
export const CRISIS_CLASSIFIER_MAX_ATTEMPTS = 2;
