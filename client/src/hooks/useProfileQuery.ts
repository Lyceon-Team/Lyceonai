/**
 * @spec [Coding Standards §11.2 (server state via the query layer), §6.1 (server-authoritative
 *        auth); Doc-01_V8 §40.3 (pendingDeletion is read from /api/profile); student-ui register
 *        UI-14] | @implemented [2026-09-29]
 *
 * plain English: the ONE read of `GET /api/profile`. Expected outcome: the auth provider, the
 * route guard (`RequireRole`), onboarding (`profile-complete`) and the profile page all share a
 * single key and a single fetch function, so a signed-in page load issues one request for the
 * profile instead of one per consumer.
 *
 * WHY ONE FUNCTION AND NOT JUST ONE KEY. React Query deduplicates by key, but the function that
 * runs is whichever observer happened to fetch first. Before this module the same key carried
 * three functions with three answers to a 401: two returned `{ authenticated: false }`, the
 * page's default function threw. Which one a student got depended on mount order. There is now
 * one answer: a 401 or 403 means "not signed in" and is DATA, not an error, because that is what
 * the guard needs to redirect on; any other non-2xx is an error the caller renders.
 *
 * Trade-offs: the body is not Zod-parsed here. No shared schema for this response exists yet, and
 * adding one that fails closed is a behaviour change outside UI-14's scope. The type below is the
 * route's own response (`server/routes/profile-routes.ts`, GET handler), field for field; it
 * declares nothing the route does not send.
 *
 * Edge cases: sign-out must not leave this cached — a second account signing in within the same
 * tab would otherwise be routed on the first account's onboarding flags. `clearProfileQuery` is
 * what the auth provider calls; see `SupabaseAuthContext`.
 */
import {
  queryOptions,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";

export const PROFILE_PATH = "/api/profile" as const;

/**
 * The key is the path, unchanged from what every consumer already used, so the existing
 * invalidations (`profile-complete` after its PATCH, `ReconsentModal` after acceptance) keep
 * hitting it without being edited.
 */
export const PROFILE_QUERY_KEY = [PROFILE_PATH] as const;

export type ProfileRole = "student" | "guardian" | "admin";

/** `user` as the GET handler writes it. */
export type ProfileHydrationUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  name: string;
  username: string | null;
  role: ProfileRole;
  isAdmin: boolean;
  isGuardian: boolean;
  is_under_13: boolean;
  guardianEmail: string | null;
  dateOfBirth: string | null;
  marketingOptIn: boolean | null;
  studentLinkCode: string | null;
  student_link_code: string | null;
  profileCompletedAt: string | null;
  requiredProfileComplete: boolean;
  guardianConsentRequired: boolean;
  /** Parsed by its consumer against `outstandingLegalSchema`; never trusted as typed here. */
  outstandingLegal: unknown;
};

export type ProfileHydration =
  | {
      authenticated: true;
      featureFlags?: { accountDeletionLifecycleV2?: boolean };
      pendingDeletion?: { scheduledHardDeleteAt: string } | null;
      user: ProfileHydrationUser | null;
    }
  | {
      authenticated: false;
      user: null;
      /** Which refusal it was; the auth provider treats a 403 differently (G2-02). */
      status: 401 | 403;
      /** A 403's refusal code (e.g. `ROLE_UNRECOGNIZED`), if its body declared one. */
      code: string | null;
    };

/** The one field read from a 403 body: its refusal code, if any (G2-02). */
const refusalCodeSchema = z.object({ code: z.string() });

export async function fetchProfile(): Promise<ProfileHydration> {
  const response = await csrfFetch(PROFILE_PATH, { credentials: "include" });

  // AUTH-001: the server refreshes the session on every request, so a 401/403 here means the
  // session is genuinely absent. That is an answer, not a failure.
  if (response.status === 401) {
    return { authenticated: false, user: null, status: 401, code: null };
  }
  if (response.status === 403) {
    // G2-02 (merged from `main`): a 403 may be ROLE_UNRECOGNIZED, which the auth provider shows
    // as a neutral screen rather than a sign-out. Read only a declared-JSON body; a malformed
    // one throws, as the provider's own read did before this module owned it.
    const body: unknown = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : null;
    const code = refusalCodeSchema.safeParse(body).data?.code ?? null;
    return { authenticated: false, user: null, status: 403, code };
  }

  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, "Failed to load profile");
  }

  return response.json() as Promise<ProfileHydration>;
}

/** The options every read of the profile uses, including `queryClient.fetchQuery`. */
export const profileQuery = queryOptions<ProfileHydration, Error>({
  queryKey: PROFILE_QUERY_KEY,
  queryFn: fetchProfile,
  retry: false,
  staleTime: QUERY_FRESHNESS.profile.staleTime,
});

export function useProfileQuery(options?: {
  enabled?: boolean;
}): UseQueryResult<ProfileHydration, Error> {
  return useQuery({
    ...profileQuery,
    enabled: options?.enabled ?? true,
  });
}

/** Sign-out: drop the cached profile so nothing reads the previous account's flags. */
export function clearProfileQuery(client: QueryClient): void {
  client.removeQueries({ queryKey: PROFILE_QUERY_KEY });
}
