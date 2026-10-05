/**
 * Settings → Guardian: link status, the link code with copy, email and new-code actions, and
 * the "what a guardian can see" sentence.
 *
 * @spec [DESIGN.md §4 Settings "Guardian"; prototype Settings.dc.html; student-UI register OQ-38
 *        (owner ruling 2026-10-02, the sentence's wording); evidence/wiring-table.md §11 (status
 *        `GET /api/students/:id/links`; code `GET …/link-code`; email `POST …/link-code/invite`;
 *        new code `POST …/link-code/regenerate`); SCL-080 (sharing the code IS the consent, so the
 *        consequence line stays beside it); Doc-01_V8 §36.3 (remove a guardian, with
 *        confirmation)] | @implemented [2026-10-03]
 *
 * plain English: composes the two existing student panels, which own every request; this file
 * adds no fetch. The status box comes first (as in the prototype) and carries the OQ-38
 * sentence, then the code. Student accounts only (the page hides this section for an admin);
 * the server resolves every one of these routes to the session's own student and answers 404
 * to anyone else.
 */
import { useId } from "react";
import { StudentGuardiansPanel } from "@/components/student/StudentGuardiansPanel";
import { StudentLinkCodePanel } from "@/components/student/StudentLinkCodePanel";
import { SectionHeading } from "./settings-ui";

/** OQ-38, owner ruling (Karl) 2026-10-02, verbatim. */
export const GUARDIAN_VISIBILITY_SENTENCE =
  "A guardian can see your progress: mastery, test scores, your study plan and your projected score. They never see your answers or your conversations with LISA.";

export function LinkSection({ studentId }: { studentId: string }): JSX.Element {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      data-testid="settings-guardian"
    >
      <SectionHeading id={headingId}>Guardian</SectionHeading>
      <StudentGuardiansPanel
        studentId={studentId}
        summary={GUARDIAN_VISIBILITY_SENTENCE}
        emptyHint={null}
      />
      <StudentLinkCodePanel studentId={studentId} />
    </section>
  );
}
