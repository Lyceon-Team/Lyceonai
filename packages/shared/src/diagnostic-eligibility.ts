/**
 * @spec [Doc-05A §11 diagnostic; owner ruling Q1 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: decides whether a student may start a diagnostic, given their
 * existing diagnostic sessions. A diagnostic is taken ONCE — it is a baseline,
 * not a repeatable assessment — so the rule has three outcomes rather than two.
 *
 * expected outcome: `allow` for a student with no diagnostic history, `resume`
 * when one is in flight, `already_completed` when one has been completed.
 *
 * trade-offs: extracted as a pure function rather than left inline in the route
 * because the rule is the thing worth testing. Inline, it could only be proven by
 * modelling a Supabase query-builder chain; here it is proven directly against
 * every input shape, including the two-row shape that exists in production today.
 *
 * edge cases: the ordering of the two checks is load-bearing — see below.
 */

/** The statuses that participate in the decision. Abandoned deliberately does not. */
export type DiagnosticSessionStatusLike =
  | "created"
  | "active"
  | "completed"
  | "abandoned";

export type PriorDiagnosticSession = {
  id: string;
  status: DiagnosticSessionStatusLike | string;
};

export type DiagnosticStartDecision =
  | { kind: "allow" }
  | { kind: "resume"; sessionId: string }
  | { kind: "already_completed" };

/**
 * WHY `completed` IS CHECKED BEFORE `in flight`
 *
 * A student can hold both — a completed diagnostic AND an in-flight one — because
 * that state was creatable before this rule existed. Production has exactly that
 * shape right now (one completed 40/40, one active 7/40, same student).
 *
 * For that student, "you already have a baseline" is the truthful answer.
 * Answering `resume` instead would invite them to finish a second diagnostic,
 * which is the state the once-only rule exists to prevent — and, with the
 * partial unique index in place, completing it would fail at the database.
 *
 * WHY `abandoned` IS NOT CONSIDERED SPENT (ruling Q1)
 *
 * A diagnostic is spent only when COMPLETED. If abandonment spent it, a student
 * who closed their laptop at question 3 would be permanently baseline-less with
 * no recovery — a dead end created by a rule meant to protect data quality.
 * Abandoned rows therefore fall through to `allow`.
 */
export function resolveDiagnosticStartDecision(
  priorSessions: readonly PriorDiagnosticSession[],
): DiagnosticStartDecision {
  const completed = priorSessions.find((s) => s.status === "completed");
  if (completed) return { kind: "already_completed" };

  const inFlight = priorSessions.find(
    (s) => s.status === "created" || s.status === "active",
  );
  if (inFlight) return { kind: "resume", sessionId: inFlight.id };

  return { kind: "allow" };
}
