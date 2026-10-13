/**
 * The guardian's daily summary email switch, through the query layer.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Delivery": "The guardian
 *        can turn the digest email off in their notification settings (default on)";
 *        Coding Standards §11.2] | @implemented [2026-10-13]
 *
 * plain English: GET/PUT `/api/guardian/notification-preferences/daily-digest`. The checkbox
 * shows the server's answer, never an optimistic guess: a save writes the cache from the
 * response. The server enforces the guardian role; this hook only asks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
// Module-specific import, NOT the `@lyceon/shared` barrel (server env names stay out of the bundle).
import {
  GUARDIAN_DIGEST_PREFERENCE_PATH,
  guardianDigestPreferenceSchema,
  type GuardianDigestPreference,
} from "../../../packages/shared/src/notifications-schema";

const URL = `/api/guardian${GUARDIAN_DIGEST_PREFERENCE_PATH}`;
export const GUARDIAN_DIGEST_PREFERENCE_QUERY_KEY = [URL] as const;

function parseData(body: unknown): GuardianDigestPreference {
  const data =
    typeof body === "object" && body !== null
      ? (body as { data?: unknown }).data
      : undefined;
  return guardianDigestPreferenceSchema.parse(data);
}

export function useGuardianDigestPreference() {
  return useQuery({
    queryKey: GUARDIAN_DIGEST_PREFERENCE_QUERY_KEY,
    queryFn: async (): Promise<GuardianDigestPreference> => {
      const res = await apiRequest(URL);
      return parseData(await res.json());
    },
  });
}

export function useSetGuardianDigestPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<GuardianDigestPreference> => {
      const res = await apiRequest(URL, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      return parseData(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData(GUARDIAN_DIGEST_PREFERENCE_QUERY_KEY, data);
    },
  });
}
