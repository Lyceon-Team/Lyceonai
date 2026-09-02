/**
 * The ONE way a test builds a `LinkedStudent`.
 *
 * @spec [Doc-01_V8 §35; Coding Standards §7.2 one definition] | @implemented [2026-09-02]
 *
 * plain English: hands a test a linked-student row without the test restating
 * the row's shape. Callers say what they MEAN — "an entitled student", "an
 * unnamed one" — and never name a column.
 *
 * WHY IT EXISTS, AND WHY HERE. `scripts/ci/guardian-schema-truth-gate.mjs`
 * RULE B refuses a guardian test that hand-writes an object literal keyed on
 * column names, because that is a private copy of the schema — and a private
 * copy is how `student_user_id` survived a rename across this whole surface.
 * The rule names two sanctioned routes: rows "must come from the schema, or be
 * inserted into real Postgres and read back". A jsdom component test cannot
 * take the second (the `ci` job has no Postgres service), so this takes the
 * first.
 *
 * IT IS NOT A RELOCATED LITERAL, AND THE DIFFERENCE IS THE `parse`. Every row
 * goes through `linkedStudentSchema`, so a field added, renamed or retyped in
 * the contract fails HERE, in one place, rather than drifting quietly in each
 * test that copied the old shape. And the contract itself is proved against
 * real Postgres by `packages/shared/src/__tests__/guardian-student-schema.test.ts`,
 * which SELECTs the projected columns out of a live `profiles` row. So the
 * chain is: real columns -> schema -> this factory -> the tests.
 */
import {
  linkedStudentSchema,
  type LinkedStudent,
} from "../guardian-student-schema";

export type LinkedStudentOverrides = {
  readonly id?: string;
  readonly email?: string;
  /** `null` is a real state — an unnamed student falls back to email. */
  readonly displayName?: string | null;
  readonly entitled?: boolean;
};

export function makeLinkedStudent(
  overrides: LinkedStudentOverrides = {},
): LinkedStudent {
  const id = overrides.id ?? "11111111-1111-4111-8111-111111111111";
  return linkedStudentSchema.parse({
    id,
    email: overrides.email ?? `${id.slice(0, 8)}@test.invalid`,
    display_name:
      overrides.displayName === undefined
        ? "Test Student"
        : overrides.displayName,
    created_at: "2026-01-01T00:00:00.000Z",
    has_active_entitlement: overrides.entitled ?? false,
  });
}
