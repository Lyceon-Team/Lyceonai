/**
 * `GET /api/guardian/students` response contract — Zod first, types inferred.
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §31.4 guardian paying for a
 *        linked student; Coding Standards §7.1 parse at every boundary, §7.2]
 * @implemented [2026-08-31]
 *
 * plain English: describes the linked students the guardian surfaces render —
 * the dashboard's student list and the checkout surface's student picker.
 * Expected outcome: a renamed or dropped column fails a parse at the boundary
 * with a named field, instead of surfacing as `undefined` inside a dropdown
 * option three frames later. Trade-off: one parse per fetch, which is nothing
 * against a network round trip. Edge case: `display_name` is genuinely nullable
 * — an unnamed student is a fact, and the caller falls back to email.
 *
 * NOT THE `guardian_links` ROW. This is the joined `profiles` projection the
 * route actually returns (`server/routes/guardian-routes.ts` selects
 * `id, email, display_name, created_at`), plus the per-student entitlement flag
 * the same route derives — which is why it does not live in
 * `guardian-link-schema.ts`. The two id/timestamp primitives ARE reused from
 * there rather than redeclared, so the reasoning recorded on them — ids are
 * `string` because Postgres already guarantees the UUID format, and a
 * timestamptz may arrive as a string or a `Date` depending on transport —
 * applies here without being restated or allowed to drift.
 *
 * THIS IS NOT A GATE. Parsing establishes the SHAPE of what the server sent. It
 * authorises nothing: the server read the guardian's ACTIVE links to build this
 * list, and any student id chosen from it is re-resolved against those links on
 * every checkout request (Charter §6).
 */
import { z } from "zod";
import { idSchema, timestampSchema } from "./guardian-link-schema";

export const linkedStudentSchema = z.object({
  id: idSchema,
  /**
   * Deliberately not `.email()`. Same reasoning as `idSchema`: this value comes
   * back from a column the database already constrains, and this schema's job
   * is to catch a column being renamed or dropped, not to re-police a format.
   */
  email: z.string(),
  display_name: z.string().nullable(),
  created_at: timestampSchema,
  /**
   * Whether THIS student currently holds an active entitlement.
   *
   * @spec [Doc-01_V8 §31.4; SCL-045 one SubscriptionItem per student]
   *
   * plain English: the guardian purchase card needs to know which linked
   * students still need paying for, and that is a per-student question. It is
   * NOT the §31.3 fold, which answers a different one — "does this guardian
   * have access AT ALL" — by returning true as soon as ANY one linked student
   * is premium. Gating a purchase surface on the fold is what hid the picker:
   * the guardian could see everything through student A and so was offered no
   * way to buy for student B.
   *
   * NOT A GATE, AND DELIBERATELY NOT SHAPED LIKE ONE. This field decides what
   * the client OFFERS. Whether a purchase is permitted is re-decided server
   * side on every request, against active `guardian_links`
   * (`server/lib/stripe/guardian-checkout.ts`), and a student already covered
   * by the guardian's subscription is refused there with
   * `STUDENT_ALREADY_FUNDED`. Editing this value in devtools changes what is
   * REQUESTED, never what is GRANTED.
   */
  has_active_entitlement: z.boolean(),
});

export type LinkedStudent = z.infer<typeof linkedStudentSchema>;

export const guardianStudentsResponseSchema = z.object({
  students: z.array(linkedStudentSchema),
});

export type GuardianStudentsResponse = z.infer<
  typeof guardianStudentsResponseSchema
>;
