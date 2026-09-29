/**
 * What a 400 is allowed to say about itself in a log line.
 *
 * @spec [lyceon-coding-standards §12.1 (never log request bodies or student content),
 *        §8.2 error shape] | @implemented [2026-09-29]
 *
 * plain English: turns a Zod `flatten()` into the list of FIELD NAMES that failed, and
 * nothing else. Expected outcome: an operator reading a 400 knows which field was rejected
 * without ever seeing what the student typed into it.
 *
 * WHY THIS EXISTS, measured rather than asserted. Production, 2026-09-28: every new premium
 * student was stopped at their first screen by `400 INVALID_BODY`. The response body the
 * browser received carried `fieldErrors: { idempotency_key: ["Required"] }` — but nothing
 * was written down server-side, so the only way to learn which field was rejected was to
 * reproduce the request. A sweep of the whole codebase afterwards found 88 sites returning a
 * 400 and exactly one that logged the reason.
 *
 * WHY IT IS PATHS AND NOT `flatten()`. `fieldErrors` holds Zod's MESSAGE strings, and a
 * `z.enum` failure renders as `"Invalid enum value. Expected 'close' | 'threshold' |
 * 'stale', received 'xyz'"` — the rejected value, in the line. Two internal routers were
 * logging exactly that. `Object.keys` cannot carry a value out; a message can, so this never
 * reads one.
 *
 * WHY ONE MODULE AND NOT A COPY PER ROUTER. CLAUDE.md: a second version of a primitive is a
 * defect even when no two edits touch the same line. Five routers have a single place where
 * they write an error response, and all five consume this.
 */
import { logger } from "../logger";

/**
 * The field names inside a Zod `flatten()` (or a `{ missing }` refusal), and nothing else.
 *
 * `details` is `unknown` because a caller may hand this anything; it is NARROWED here rather
 * than cast. A form-level issue — the cross-field refusals a schema states in
 * `superRefine`, which carry no path — is reported as the sentinel `"<root>"` rather than
 * silently contributing nothing, because a 400 that names no field at all is the case this
 * module exists to end.
 */
export function validationFieldPaths(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const flat = details as {
    fieldErrors?: unknown;
    formErrors?: unknown;
    missing?: unknown;
  };
  const paths: string[] = [];
  if (typeof flat.fieldErrors === "object" && flat.fieldErrors !== null) {
    paths.push(...Object.keys(flat.fieldErrors));
  }
  if (Array.isArray(flat.formErrors) && flat.formErrors.length > 0) {
    paths.push("<root>");
  }
  // A refusal that names its fields directly rather than through Zod — the calendar's
  // `CALENDAR_SETUP_INCOMPLETE` carries `{ missing: [...] }`. Those are field NAMES already,
  // and they ARE the reason.
  if (Array.isArray(flat.missing)) {
    paths.push(
      ...flat.missing.filter(
        (name): name is string => typeof name === "string",
      ),
    );
  }
  return paths;
}

/** The little that a route knows about the request when it refuses one. */
export type RejectedRequestContext = {
  /** The error CODE the response carries — a server constant, never client text. */
  code: string;
  /** The HTTP verb. */
  method?: string | undefined;
  /**
   * The route PATTERN Express matched (`baseUrl` + `route.path`), never the filled URL: a
   * `:date` or a block id in a log line is an identifier these surfaces have no reason to
   * keep.
   */
  path?: string | undefined;
  requestId?: string | undefined;
};

/**
 * Write the one WARN line a 400 owes its operator.
 *
 * WARN, not ERROR: a rejected body is the validator doing its job, not a fault. Not INFO
 * either — a 400 on a surface whose forms are meant to make invalid input unreachable means
 * a form and a schema have drifted, and that is worth noticing.
 */
export function logRejectedRequest(
  component: string,
  details: unknown,
  context: RejectedRequestContext,
): void {
  logger.warn(
    component,
    "request_rejected",
    "a request failed validation",
    {
      code: context.code,
      fields: validationFieldPaths(details),
      method: context.method,
      path: context.path,
    },
    { requestId: context.requestId },
  );
}

/**
 * The route pattern and verb, off an Express response.
 *
 * Takes the RESPONSE because that is what every one of these chokepoints already has —
 * `sendError(res, …)`, `sendFailure(res, …)`, `sendInvalid(res, …)`. Threading a `req`
 * through five signatures to reach the same two strings would be five chances for one of
 * them to be given the wrong request.
 */
export function routeOf(res: {
  req?: { method?: string; baseUrl?: string; route?: { path?: string } };
}): { method?: string | undefined; path?: string | undefined } {
  const req = res.req;
  if (req === undefined) return { method: undefined, path: undefined };
  return {
    method: req.method,
    path: `${req.baseUrl ?? ""}${req.route?.path ?? ""}`,
  };
}
