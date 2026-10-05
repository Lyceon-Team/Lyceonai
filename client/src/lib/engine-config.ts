/**
 * Question-loop engine configuration.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §4 R4 row ("share practice's loop, own the landing
 *        page"); brief R4 §2.1] | @implemented [2026-09-22]
 *
 * plain English: the question loop — `CanonicalPracticePage` plus `useCanonicalPractice`
 * — is one component serving two engines. Everything that differs between practice and
 * review lives in this file as data: which URLs to call, what to put in the create body,
 * what to call the thing on screen, and which features are on. Expected outcome: R4 adds
 * a review UI without forking the loop, and a field renamed on either side breaks a test
 * rather than a student's session.
 *
 * WHY A CONFIG AND NOT AN `engine === "review"` CHECK. Brief R4 §1 makes the criterion
 * explicit: sharing must not mean threading engine checks through the answer flow. It
 * doesn't have to. Practice's answer, skip, resume, next and calculator-state request
 * bodies are already field-for-field valid against R3's schemas
 * (`review-schema.ts:105-148`) — only the URL differs, and a URL is a function. The one
 * genuine divergence is the create body: practice sends
 * `{section, mode, sections, domains, difficulties, target_minutes, target_question_count}`
 * and review sends `{mode, filters, target_count}` (`review-schema.ts:93-99`). That is
 * `buildCreateBody`, a function-valued field of the same species as the endpoint
 * builders, evaluated once per session at creation — not a branch inside the loop.
 *
 * trade-offs: the loop can no longer hard-code a URL, so a new endpoint means a new
 * field here and in both configs. That is the point — the type makes forgetting one a
 * compile error rather than a 404 at runtime.
 *
 * edge cases:
 *   - `section` is meaningless to review (its pool is the mistake queue, not a section
 *     filter), so the review config ignores the argument. The loop still passes it,
 *     because practice needs it and a second code path to avoid one unused argument
 *     would cost more than it saves.
 *   - `features.calculator` is TRUE for review: R3 ships
 *     `/api/review/sessions/:id/calculator-state` and review serves math items, so
 *     turning it off would regress the student (brief R4 §2.1).
 *   - THERE IS NO `quota` SWITCH, though brief R4 §2.1 names one. The loop contains no
 *     quota or paywall branch to switch off: `CanonicalPracticePage.tsx` and
 *     `useCanonicalPractice.ts` have zero occurrences of quota, paywall, upgrade or a
 *     402 branch. Practice's quota card lives on its LANDING (`practice.tsx:678-680`,
 *     fed by `usePractice.ts:103-105`), which review does not share. The loop's only
 *     403 branch is `SESSION_LIMIT_EXCEEDED`, the concurrent-session cap, which R3 has
 *     too (`review-canonical.ts`) and which must therefore stay on for both. A switch
 *     guarding nothing would be a lie the next reader has to disprove.
 *   - `domain` names the engine: it keys the hook's in-flight session lock and picks
 *     the tutor's source surface. It used to also feed the client's runtime-contract
 *     disable parser; UI-06 (2026-09-29) deleted that parser, because no server route
 *     emits a runtime-contract disable code, so `EngineDomain` is now this
 *     file's own two-member type rather than the parser's three-member one.
 */

import type {
  ReviewFilterSpec,
  ReviewSessionMode,
  ReviewSessionSource,
} from "@lyceon/shared/review-schema";

/**
 * The review-only half of a session spec. Practice never sets these; review never sets
 * `sections`/`domains`/`difficulties`/`targetMinutes`, because R3's create body has no
 * place for them — the pool is chosen by `mode` + `filters`.
 */
export type ReviewSessionSpec = {
  reviewMode: ReviewSessionMode;
  reviewFilters?: ReviewFilterSpec | ReviewSessionSource;
  targetQuestionCount?: number;
};

/** What `buildCreateBody` is given. Deliberately small: everything else is config. */
export type EngineCreateBodyInput = {
  section: string;
  clientInstanceId: string;
  spec: {
    sections?: string[];
    domains?: string[];
    difficulties?: string[];
    targetMinutes?: number;
    targetQuestionCount?: number;
    mode?: string;
    review?: ReviewSessionSpec;
  };
};

/** The engines the question loop serves. */
export type EngineDomain = "practice" | "review";

export type EngineConfig = {
  /** Stable identifier: keys the in-flight session lock and the tutor surface. */
  domain: EngineDomain;
  endpoints: {
    create: () => string;
    resume: (sessionId: string) => string;
    next: (sessionId: string, clientInstanceId: string) => string;
    answer: (sessionId: string) => string;
    skip: (sessionId: string) => string;
    calculatorState: (sessionId: string) => string;
  };
  buildCreateBody: (input: EngineCreateBodyInput) => Record<string, unknown>;
  /**
   * User-visible strings the loop itself emits. Titles stay page props, because they vary per
   * session; this does not.
   *
   * UI-53 (2026-10-03, DESIGN.md §4 Question runner): the shell eyebrow ("Academic Practice
   * Runner" / "Review Runner") and the session-guidance card are gone with the old runner
   * chrome. The Focus shell's back link names the section ("Practice", "Review") from
   * route-shells.ts, and the session is named by its criteria (OQ-22), so no engine wording
   * reaches the bar.
   */
  labels: {
    startFailure: string;
    /** The runner's loading line (shipped copy: practice's runner, review's route loader). */
    loading: string;
  };
  /** Where the loop navigates when the session completes or the student ends it. */
  completionHref: string;
  /** Where the conflict and session-limit states return to (the Focus shell's back arrow has its own). */
  backHref: string;
  features: {
    /**
     * The 40-item baseline flow, which hides Skip so all 40 items land (UI-53 removed End
     * Session from every runner).
     * Review's modes are `queue | session | filter` (20260921000000_review_queue_runtime
     * .sql:199-201) — there is no diagnostic mode, so the loop refuses the prop rather
     * than trusting a caller that passes it by mistake.
     */
    diagnostic: boolean;
    /** Desmos panel + persisted calculator state. On for both. */
    calculator: boolean;
    /**
     * LISA beside the question, scoped to the served item (closure plan W4-1,
     * launch scope 2026-09-25). Review first, practice after: on for review.
     * The server decides what LISA may see — this only shows the panel.
     */
    tutor: boolean;
    /**
     * The feedback panel's "This question has gone to your review queue." on a miss
     * (DESIGN.md §4, Runner.dc.html). True for practice: a missed practice item is queued by
     * `trg_practice_item_enqueue_review` (20260921000000_review_queue_runtime.sql). False for
     * review: a missed review item is already in the queue (it moves to the back), so the
     * sentence would describe something that did not happen.
     */
    missNote: boolean;
  };
};

const enc = encodeURIComponent;

/**
 * Practice's configuration. Every URL here is the literal the hook used before this
 * file existed, so pointing the loop at this config is a no-op for practice (U1).
 */
export const PRACTICE_ENGINE_CONFIG: EngineConfig = {
  domain: "practice",
  endpoints: {
    create: () => "/api/practice/sessions",
    resume: (sessionId) => `/api/practice/sessions/${enc(sessionId)}/resume`,
    next: (sessionId, clientInstanceId) =>
      `/api/practice/sessions/${enc(sessionId)}/next?client_instance_id=${enc(clientInstanceId)}`,
    answer: () => "/api/practice/answer",
    skip: (sessionId) => `/api/practice/sessions/${enc(sessionId)}/skip`,
    calculatorState: (sessionId) =>
      `/api/practice/sessions/${enc(sessionId)}/calculator-state`,
  },
  buildCreateBody: ({ section, clientInstanceId, spec }) => {
    const body: Record<string, unknown> = {
      section,
      mode: spec.mode ?? "balanced",
      client_instance_id: clientInstanceId,
    };
    if (Array.isArray(spec.sections)) body.sections = spec.sections;
    if (Array.isArray(spec.domains)) body.domains = spec.domains;
    if (Array.isArray(spec.difficulties)) body.difficulties = spec.difficulties;
    if (typeof spec.targetMinutes === "number")
      body.target_minutes = spec.targetMinutes;
    if (typeof spec.targetQuestionCount === "number")
      body.target_question_count = spec.targetQuestionCount;
    return body;
  },
  labels: {
    startFailure: "Failed to start practice session",
    loading: "Loading your practice session...",
  },
  completionHref: "/practice",
  backHref: "/practice",
  features: {
    diagnostic: true,
    calculator: true,
    tutor: false,
    missNote: true,
  },
};

/**
 * Review's configuration.
 *
 * `buildCreateBody` ignores `section` and emits R3's shape. `idempotency_key` is minted
 * per call rather than per session because the hook already de-duplicates concurrent
 * creates through its in-flight map; a key reused across two deliberate creates would
 * make the second one silently return the first session.
 */
export const REVIEW_ENGINE_CONFIG: EngineConfig = {
  domain: "review",
  endpoints: {
    create: () => "/api/review/sessions",
    resume: (sessionId) => `/api/review/sessions/${enc(sessionId)}/resume`,
    next: (sessionId, clientInstanceId) =>
      `/api/review/sessions/${enc(sessionId)}/next?client_instance_id=${enc(clientInstanceId)}`,
    answer: () => "/api/review/answer",
    skip: (sessionId) => `/api/review/sessions/${enc(sessionId)}/skip`,
    calculatorState: (sessionId) =>
      `/api/review/sessions/${enc(sessionId)}/calculator-state`,
  },
  buildCreateBody: ({ clientInstanceId, spec }) => {
    const review = spec.review;
    const body: Record<string, unknown> = {
      mode: review?.reviewMode ?? "queue",
      client_instance_id: clientInstanceId,
      idempotency_key: crypto.randomUUID(),
    };
    if (review?.reviewFilters) body.filters = review.reviewFilters;
    const targetCount = review?.targetQuestionCount ?? spec.targetQuestionCount;
    if (typeof targetCount === "number") body.target_count = targetCount;
    return body;
  },
  labels: {
    startFailure: "Failed to start review session",
    loading: "Loading your review session...",
  },
  completionHref: "/review",
  backHref: "/review",
  features: {
    diagnostic: false,
    calculator: true,
    tutor: true,
    missNote: false,
  },
};
