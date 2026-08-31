/**
 * @spec [Doc 01 V8 §31.4 guardian paying for linked student; §35 guardian links;
 *        Coding Standards §11.1, §11.2] | @implemented [2026-08-31]
 *
 * plain English: the ONE client-side reader of a guardian's actively linked
 * students. Expected outcome: every guardian surface that needs the list gets
 * the same list, from the same request, in the same shape. Trade-off: a hook
 * rather than a per-page query, so the two consumers cannot drift. Edge case:
 * a guardian with no active links gets an empty array, which is a fact the
 * caller must render explicitly rather than an error.
 *
 * WHY THIS EXISTS. `GET /api/guardian/students` was already being read by
 * `client/src/pages/guardian-dashboard.tsx`, which also declared its own local
 * `LinkedStudent` interface. Adding a second reader on the checkout surface
 * would have forked both the request and the shape for one endpoint. The type
 * and the query now live here and both pages consume them.
 *
 * SERVER-AUTHORITATIVE, AND THIS HOOK IS NOT A GATE. The endpoint reads ACTIVE
 * `guardian_links` server-side (`server/routes/guardian-routes.ts:174`). This
 * hook only renders what the server returned. Nothing here authorises anything:
 * a student id chosen from this list is re-resolved against the guardian's
 * active links on every checkout request
 * (`server/lib/stripe/guardian-checkout.ts:101`). Editing the value in devtools
 * changes what is REQUESTED, never what is GRANTED.
 */
import { useQuery } from '@tanstack/react-query';
import { csrfFetch } from '@/lib/csrf';

export type LinkedStudent = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
};

/** Shared cache key, so the two consumers hit one request rather than two. */
export const GUARDIAN_STUDENTS_QUERY_KEY = ['guardian-students'] as const;

/** The name to show for a student, falling back to email when unnamed. */
export function studentLabel(student: LinkedStudent): string {
  const name = student.display_name?.trim();
  return name && name.length > 0 ? name : student.email;
}

export function useGuardianStudents(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: GUARDIAN_STUDENTS_QUERY_KEY,
    queryFn: async (): Promise<{ students: LinkedStudent[] }> => {
      const res = await csrfFetch('/api/guardian/students', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch students');
      return res.json() as Promise<{ students: LinkedStudent[] }>;
    },
    enabled: options?.enabled ?? true,
  });
}
