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
 * would have forked both the request and the shape for one endpoint. The query
 * lives here and both pages consume it; the SHAPE lives in
 * `packages/shared/src/guardian-student-schema.ts`, which this hook parses the
 * response against — so the contract is shared with the server side rather than
 * being a client-only opinion.
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
import {
  guardianStudentsResponseSchema,
  type GuardianStudentsResponse,
  type LinkedStudent,
} from '../../../packages/shared/src/guardian-student-schema';

export type { LinkedStudent };

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
    queryFn: async (): Promise<GuardianStudentsResponse> => {
      const res = await csrfFetch('/api/guardian/students', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch students');

      // Parsed, not asserted. `as Promise<...>` told the compiler what to
      // believe and checked nothing at runtime; a renamed column would have
      // reached the dropdown as `undefined`.
      const parsed = guardianStudentsResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new Error('Linked students response did not match the contract');
      }
      return parsed.data;
    },
    enabled: options?.enabled ?? true,
  });
}
