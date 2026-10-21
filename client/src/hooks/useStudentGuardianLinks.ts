/**
 * The student's ACTIVE guardian links, through the query layer.
 *
 * @spec [Doc-01_V8 §36.3 (the student's "Remove guardian" list), §35; owner brief "student
 *        cleanups" (Karl, 2026-10-21) Part A ("'Active guardian link AND active entitlement'
 *        must come from the server"); SCL-238; Coding Standards §11.2 (server state via the
 *        query layer)] | @implemented [2026-09-15; moved here 2026-10-13; 2026-10-21]
 *
 * plain English: one query, one cache entry per student, over `GET /api/students/:id/links`
 * (the server returns active links only, and `guardian_notified`). Settings → Guardian lists the
 * links; the calendar asks only `guardian_notified`, the server's own answer to "would a
 * recorded plan change reach a guardian right now" (active link AND student entitlement), to
 * decide whether a change asks "Your guardian will be notified" first. Both read this one cache
 * entry, so removing a guardian on Settings updates the calendar through the same invalidation.
 *
 * 2026-10-21: the cached value is the whole view (`{ links, guardian_notified }`), not the bare
 * link list, so the two readers cannot cache two shapes under one key. Until then the calendar
 * read "has at least one active link", which ignored the entitlement half of the recipient rule.
 */
import { useQuery } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
// Module-specific import, NOT the `@lyceon/shared` barrel (it re-exports the server env
// schema, whose `*_SECRET` names would land in the client bundle — see StudentLinkCodePanel).
import {
  studentLinksUrl,
  studentGuardianLinksViewSchema,
  type StudentGuardianLinkView,
} from "../../../packages/shared/src/student-resources";

const STUDENT_GUARDIAN_LINKS_QUERY_KEY = ["student-guardian-links"] as const;

/** G-NEW-11: one cache entry per student, as `studentLinkCodeQueryKey`. */
export function studentGuardianLinksQueryKey(studentId: string) {
  return [...STUDENT_GUARDIAN_LINKS_QUERY_KEY, studentId] as const;
}

export type StudentGuardianLinks = {
  links: StudentGuardianLinkView[];
  guardian_notified: boolean;
};

export async function readStudentGuardianLinks(
  studentId: string,
): Promise<StudentGuardianLinks> {
  const res = await csrfFetch(studentLinksUrl(studentId), {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not load your guardians");
  const payload = (await res.json()) as { data?: unknown };
  return studentGuardianLinksViewSchema.parse(payload?.data);
}

/**
 * True only when the server has answered `guardian_notified: true`. Loading, an error or no
 * student all answer false: the dialog states a fact, so it is not shown until it is known.
 */
export function useGuardianNotified(studentId: string | null): boolean {
  const links = useQuery({
    queryKey: studentGuardianLinksQueryKey(studentId ?? ""),
    queryFn: () => readStudentGuardianLinks(studentId ?? ""),
    enabled: studentId !== null && studentId !== "",
  });
  return links.data?.guardian_notified === true;
}
