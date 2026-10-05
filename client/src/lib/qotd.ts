/**
 * Question of the Day: the browser's reads and its one write.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16, R17, Q2, Q3; Coding Standards §7.1 (parse
 *       at every boundary), §11.2 (server state through the query layer, no fetch in
 *       components)] | @implemented [2026-10-05]
 *
 * plain English: every response is parsed against the shared strict schema
 * (packages/shared/src/qotd-schema.ts) before a component sees it, so the page can only render
 * what the contract allows: before submit there is no answer field to show.
 *
 * PLAIN `fetch`, NOT `csrfFetch` — the same choice as public-pricing.ts. These endpoints read no
 * session; the submit is gated by Turnstile instead (owner Step 0 decision, 2026-10-05).
 * `credentials: "omit"` keeps any signed-in visitor's cookies off the request too.
 */
import {
  qotdArchiveIndexResponseSchema,
  qotdArchiveResponseSchema,
  qotdSubmitResponseSchema,
  qotdTodayResponseSchema,
  type QotdArchiveIndexResponse,
  type QotdArchiveResponse,
  type QotdSubmitRequest,
  type QotdSubmitResponse,
  type QotdTodayResponse,
} from "../../../packages/shared/src/qotd-schema";

export const QOTD_API = "/api/public/qotd";

/** A failed QOTD request, with the server's error code when it sent one. */
export class QotdRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`QOTD request failed (${status}${code ? ` ${code}` : ""})`);
    this.name = "QotdRequestError";
  }
}

async function errorFrom(res: Response): Promise<QotdRequestError> {
  const body: unknown = await res.json().catch(() => null);
  const code =
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "code" in body.error &&
    typeof body.error.code === "string"
      ? body.error.code
      : null;
  return new QotdRequestError(res.status, code);
}

async function readData<T>(
  res: Response,
  parse: (data: unknown) => T,
): Promise<T> {
  if (!res.ok) throw await errorFrom(res);
  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new QotdRequestError(res.status, "unexpected_body");
  }
  return parse(body.data);
}

export async function fetchQotdToday(): Promise<QotdTodayResponse> {
  const res = await fetch(`${QOTD_API}/today`, { credentials: "omit" });
  return readData(res, (d) => qotdTodayResponseSchema.parse(d));
}

export async function fetchQotdArchiveDay(
  date: string,
): Promise<QotdArchiveResponse> {
  const res = await fetch(`${QOTD_API}/${encodeURIComponent(date)}`, {
    credentials: "omit",
  });
  return readData(res, (d) => qotdArchiveResponseSchema.parse(d));
}

export async function fetchQotdArchiveIndex(): Promise<QotdArchiveIndexResponse> {
  const res = await fetch(`${QOTD_API}/archive`, { credentials: "omit" });
  return readData(res, (d) => qotdArchiveIndexResponseSchema.parse(d));
}

export async function submitQotdAnswer(
  body: QotdSubmitRequest,
): Promise<QotdSubmitResponse> {
  const res = await fetch(`${QOTD_API}/today/answer`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readData(res, (d) => qotdSubmitResponseSchema.parse(d));
}

/** One retry for a network or server failure; a 4xx (not scheduled, gone, limited) is final. */
function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof QotdRequestError && error.status < 500) return false;
  return failureCount < 1;
}

/** Query keys and options, shared by the pages and the build-time prerender. */
export function qotdTodayQueryOptions() {
  return {
    queryKey: [QOTD_API, "today"] as const,
    queryFn: fetchQotdToday,
    retry: retryOnce,
  };
}

export function qotdArchiveDayQueryOptions(date: string) {
  return {
    queryKey: [QOTD_API, "day", date] as const,
    queryFn: () => fetchQotdArchiveDay(date),
    retry: retryOnce,
  };
}

export function qotdArchiveIndexQueryOptions() {
  return {
    queryKey: [QOTD_API, "archive"] as const,
    queryFn: fetchQotdArchiveIndex,
    retry: retryOnce,
  };
}
