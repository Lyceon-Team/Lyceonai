/**
 * @spec [Doc 04C invariant #7 — guardian payloads are a strict SUBSET of the student
 *   payload, derived via a projection function rather than independently constructed;
 *   SCL-044 (PROPOSED) — the guardian exam session list has no owning document]
 * | @implemented [2026-08-24]
 *
 * plain English: the full-length session list has ONE projection. The guardian's is that
 * projection with `reviewAvailable` removed, and both compute `reportAvailable` from the
 * STUDENT's paid access.
 *
 * WHAT EXTRACTION SURFACED.
 *   The two routes each mapped `listExamSessions` inline, and the maps had drifted three
 *   ways: the student spread `...session` while the guardian named six fields; the student
 *   gated `reportAvailable` on paid access while the guardian did not gate it at all; and
 *   the guardian invented `reviewAvailable: false` for an endpoint that does not exist.
 *   The middle one is a PRIVILEGE divergence — a guardian could be told a report was
 *   available when the student's own entitlement said otherwise — the same defect closed in
 *   #644 for historical trends, in a second place.
 */
import { describe, expect, it } from "vitest";
import {
  projectStudentExamSessionList,
  projectGuardianExamSessionList,
} from "../../server/services/canonical-runtime-views";

const SESSIONS = [
  {
    sessionId: "s-completed",
    status: "completed",
    currentSection: null,
    currentModule: null,
    testFormId: "form-1",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T03:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T03:00:00.000Z",
  },
  {
    sessionId: "s-active",
    status: "active",
    currentSection: "rw",
    currentModule: 1,
    testFormId: "form-1",
    startedAt: "2026-08-02T00:00:00.000Z",
    completedAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:30:00.000Z",
  },
];

describe("Full-length session list — one projection, guardian narrows it", () => {
  it("PROVENANCE — the guardian result is the student result minus `reviewAvailable`", () => {
    const student = projectStudentExamSessionList(SESSIONS, {
      hasPaidAccess: true,
    });
    const guardian = projectGuardianExamSessionList(SESSIONS, {
      hasPaidAccess: true,
    });

    expect(guardian).toEqual(
      student.map(({ reviewAvailable: _drop, ...rest }) => rest),
    );
  });

  it("the guardian carries NO key the student lacks", () => {
    const studentKeys = new Set(
      Object.keys(
        projectStudentExamSessionList(SESSIONS, { hasPaidAccess: true })[0]!,
      ),
    );
    const guardianKeys = Object.keys(
      projectGuardianExamSessionList(SESSIONS, { hasPaidAccess: true })[0]!,
    );
    expect(guardianKeys.filter((k) => !studentKeys.has(k))).toEqual([]);
  });

  it("`reviewAvailable` never reaches the guardian — there is no guardian review endpoint", () => {
    const guardian = projectGuardianExamSessionList(SESSIONS, {
      hasPaidAccess: true,
    });
    for (const item of guardian) {
      expect(item).not.toHaveProperty("reviewAvailable");
    }
  });

  it("PRIVILEGE — `reportAvailable` is gated on the STUDENT's paid access, on both paths", () => {
    // The inline guardian map this replaced computed `status === "completed"` with no
    // entitlement term at all, so this case would have been true where the student's was
    // false — the guardian seeing more than the student.
    const unpaidStudent = projectStudentExamSessionList(SESSIONS, {
      hasPaidAccess: false,
    });
    const unpaidGuardian = projectGuardianExamSessionList(SESSIONS, {
      hasPaidAccess: false,
    });

    expect(unpaidStudent[0]!.reportAvailable).toBe(false);
    expect(unpaidGuardian[0]!.reportAvailable).toBe(false);

    const paidGuardian = projectGuardianExamSessionList(SESSIONS, {
      hasPaidAccess: true,
    });
    expect(paidGuardian[0]!.reportAvailable).toBe(true);
    // An incomplete session is never report-available, paid or not.
    expect(paidGuardian[1]!.reportAvailable).toBe(false);
  });

  it("a field the projection does not name reaches NEITHER path", () => {
    // The inverse of what this case originally asserted, and the inversion is the point.
    // Both projections used to spread `...session`, so any new service field flowed
    // straight to the client — and the guardian anti-leak gate went red the moment the two
    // routes were unified on that spread, because a spread carries RULE-4 columns too
    // (CLAUDE.md's chokepoint rule, MA-07 #419). Fields are now NAMED, so a tenth field
    // must be added deliberately rather than arriving unreviewed on a parent's screen.
    const withExtra = [
      { ...SESSIONS[0]!, freshlyAddedField: "x" },
    ] as unknown as typeof SESSIONS;

    expect(
      projectStudentExamSessionList(withExtra, { hasPaidAccess: true })[0],
    ).not.toHaveProperty("freshlyAddedField");
    expect(
      projectGuardianExamSessionList(withExtra, { hasPaidAccess: true })[0],
    ).not.toHaveProperty("freshlyAddedField");
  });
});
