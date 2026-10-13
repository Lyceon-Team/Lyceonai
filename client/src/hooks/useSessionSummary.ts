/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3; Coding Standards
 *       §11.2 (server state through TanStack Query), §7.1 (parse at the boundary)]
 *       | @implemented [2026-10-13]
 * plain English: the end-of-session summary read, `GET /api/{practice|review}/sessions/:id/summary`,
 * parsed with the strict shared schema, so a contract mismatch is an error state, never a
 * half-drawn summary. Read only once the session is completed (the caller enables it).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  sessionSummarySchema,
  type SessionSummary,
} from "@lyceon/shared/session-summary-schema";
import { apiRequest } from "@/lib/queryClient";

export type SummaryEngine = SessionSummary["engine"];

export function sessionSummaryPath(
  engine: SummaryEngine,
  sessionId: string,
): string {
  return `/api/${engine}/sessions/${encodeURIComponent(sessionId)}/summary`;
}

const envelopeSchema = z.object({ data: sessionSummarySchema });

export function useSessionSummary(
  engine: SummaryEngine,
  sessionId: string,
): UseQueryResult<SessionSummary, Error> {
  return useQuery<SessionSummary, Error>({
    queryKey: [sessionSummaryPath(engine, sessionId)],
    queryFn: async () => {
      const response = await apiRequest(sessionSummaryPath(engine, sessionId));
      return envelopeSchema.parse(await response.json()).data;
    },
    enabled: sessionId.length > 0,
  });
}
