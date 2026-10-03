/**
 * The student screenshot harness's personas.
 *
 * @spec [student-UI register §6 Wave 5 (side-by-side screenshots per page PR); §2 Free versus
 *        paid; OQ-29 (feature-access map)] | @implemented [2026-10-03]
 *
 * plain English: who the browser is signed in as. `paid` is the exam harness's student (Sam
 * Rivera, premium/active entitlement, finished calendar setup, linked guardian), so the two
 * harnesses describe one student. `free` is a second student with no entitlement row at all,
 * which is what a free account is in production. Both are 13 or over with a completed profile.
 * `signed-out` sends no persona: every guarded route answers 401, as it does in production
 * for a browser with no session.
 *
 * The browser picks a persona with the `x-harness-as` request header (the exam harness's
 * convention, used there for its guardian page).
 */
import { STUDENT_ID } from "../exam-harness/db";

export const PERSONA_HEADER = "x-harness-as";

export const PERSONAS = {
  free: {
    id: "00000000-0000-4000-8000-0000000051f1",
    email: "free.student@example.test",
    displayName: "Alex Moreno",
    dateOfBirth: "2010-04-12",
  },
  paid: {
    id: STUDENT_ID,
    email: "student@example.test",
    displayName: "Sam Rivera",
    dateOfBirth: "2009-09-03",
  },
  /**
   * UI-58: a student whose plan a guardian pays (F-40). An active premium entitlement that
   * carries a Stripe subscription id, on a profile with no Stripe customer, which is exactly
   * what `deriveBillingManagedBy` reads as `guardian`. No practice is seeded for this persona;
   * Settings is the only page shot as it.
   */
  managed: {
    id: "00000000-0000-4000-8000-0000000058a1",
    email: "managed.student@example.test",
    displayName: "Jordan Lee",
    dateOfBirth: "2010-02-20",
  },
} as const;

export type StudentPersona = keyof typeof PERSONAS;
export type Persona = StudentPersona | "signed-out";

export function isStudentPersona(
  value: string | undefined,
): value is StudentPersona {
  return value === "free" || value === "paid" || value === "managed";
}
