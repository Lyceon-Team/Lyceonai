/**
 * The student's ACTIVE guardian links, through the query layer.
 *
 * @spec [Doc-01_V8 §36.3 (the student's "Remove guardian" list), §35; owner brief "Guardian
 *        accountability loop" (Karl, 2026-10-13) "Transparency": "Only shown when an active
 *        guardian link exists"; Coding Standards §11.2 (server state via the query layer)]
 *        | @implemented [2026-09-15; moved here 2026-10-13]
 *
 * plain English: one query, one cache entry per student, over `GET /api/students/:id/links`
 * (the server returns active links only). Settings → Guardian lists them; the calendar asks only
 * whether there is at least one, to decide whether to say "Your guardian is notified when you
 * change your study plan." Both read this hook, so removing a guardian on Settings updates the
 * calendar's line through the same invalidation. The server decides who gets notified; this
 * only decides whether to say so.
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

export async function readStudentGuardianLinks(
  studentId: string,
): Promise<StudentGuardianLinkView[]> {
  const res = await csrfFetch(studentLinksUrl(studentId), {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not load your guardians");
  const payload = (await res.json()) as { data?: unknown };
  return studentGuardianLinksViewSchema.parse(payload?.data).links;
}

export function useStudentGuardianLinks(studentId: string | null) {
  return useQuery({
    queryKey: studentGuardianLinksQueryKey(studentId ?? ""),
    queryFn: () => readStudentGuardianLinks(studentId ?? ""),
    enabled: studentId !== null && studentId !== "",
  });
}

/**
 * True only when the server has answered with at least one active link. Loading, an error or no
 * student all answer false: the line is a statement of fact, so it is not said until it is known.
 */
export function useHasActiveGuardianLink(studentId: string | null): boolean {
  const links = useStudentGuardianLinks(studentId);
  return (links.data?.length ?? 0) > 0;
}
