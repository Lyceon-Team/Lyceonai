/**
 * @spec [Doc-01_V8, §35; §31.4; Coding Standards §7.1, §7.2]
 * @implemented [2026-08-31]
 *
 * plain English: pins the linked-students response contract. Expected outcome:
 * a well-formed list parses, and a renamed or dropped column fails HERE with a
 * named field rather than surfacing as `undefined` in a dropdown option.
 */
import { describe, expect, it } from "vitest";
import {
  guardianStudentsResponseSchema,
  linkedStudentSchema,
} from "../guardian-student-schema";

const STUDENT = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@test.com",
  display_name: "Ada",
  created_at: "2026-03-20T12:00:00.000Z",
};

describe("linkedStudentSchema", () => {
  it("accepts a linked student row", () => {
    expect(linkedStudentSchema.safeParse(STUDENT).success).toBe(true);
  });

  it("accepts an unnamed student — display_name is genuinely nullable", () => {
    const parsed = linkedStudentSchema.safeParse({
      ...STUDENT,
      display_name: null,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.display_name).toBeNull();
  });

  /**
   * The drift this schema exists to catch: `student_user_id` survived a rename
   * across this whole surface because nothing parsed the boundary.
   */
  it("REFUSES a row whose id column has been renamed", () => {
    const { id: _dropped, ...withoutId } = STUDENT;
    const parsed = linkedStudentSchema.safeParse({
      ...withoutId,
      student_user_id: STUDENT.id,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    // Named field, not a vague failure.
    expect(parsed.error.issues.some((i) => i.path.includes("id"))).toBe(true);
  });

  it("refuses a missing email and a non-null non-string display_name", () => {
    const { email: _e, ...noEmail } = STUDENT;
    expect(linkedStudentSchema.safeParse(noEmail).success).toBe(false);
    expect(
      linkedStudentSchema.safeParse({ ...STUDENT, display_name: 12 }).success,
    ).toBe(false);
  });

  it("normalises a Date created_at to an ISO string, as the link schema does", () => {
    const parsed = linkedStudentSchema.safeParse({
      ...STUDENT,
      created_at: new Date("2026-03-20T12:00:00.000Z"),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.created_at).toBe("2026-03-20T12:00:00.000Z");
  });
});

describe("guardianStudentsResponseSchema", () => {
  it("accepts an empty list — zero links is a fact, not an error", () => {
    const parsed = guardianStudentsResponseSchema.safeParse({ students: [] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.students).toEqual([]);
  });

  it("REFUSES the whole response when ONE student is malformed", () => {
    const parsed = guardianStudentsResponseSchema.safeParse({
      students: [STUDENT, { ...STUDENT, id: undefined }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a response with no students key at all", () => {
    expect(guardianStudentsResponseSchema.safeParse({}).success).toBe(false);
  });
});
