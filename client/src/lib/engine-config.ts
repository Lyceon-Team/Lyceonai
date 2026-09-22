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
 *     fed by `usePractice.ts:292-294`), which review does not share. The loop's only
 *     403 branch is `SESSION_LIMIT_EXCEEDED`, the concurrent-session cap, which R3 has
 *     too (`review-canonical.ts`) and which must therefore stay on for both. A switch
 *     guarding nothing would be a lie the next reader has to disprove.
 *   - `domain` feeds `parseRuntimeContractDisabledFromPayload`, which refuses a code
 *     belonging to another domain (`runtime-contract-disable.ts:47`). Getting this
 *     wrong would silently swallow a disable notice, so it is part of the config
 *     rather than a literal in the hook.
 */

import type { RuntimeContractDomain } from "@/lib/runtime-contract-disable";
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

export type EngineConfig = {
  /** Stable identifier; also the runtime-contract domain token. */
  domain: RuntimeContractDomain;
  endpoints: {
    create: () => string;
    resume: (sessionId: string) => string;
    next: (sessionId: string, clientInstanceId: string) => string;
    answer: (sessionId: string) => string;
    skip: (sessionId: string) => string;
    terminate: (sessionId: string) => string;
    calculatorState: (sessionId: string) => string;
  };
  buildCreateBody: (input: EngineCreateBodyInput) => Record<string, unknown>;
  /**
   * User-visible strings the loop itself emits. Titles and badges stay page props,
   * because they vary per session; these do not.
   *
   * These exist because the loop's chrome said "practice" in three places that
   * `CanonicalPracticePage.tsx` and `useCanonicalPractice.ts` do not contain — the
   * shell's eyebrow (`PracticeShell.tsx:49`) and the session-guidance card. A review
   * session headed "ACADEMIC PRACTICE RUNNER" is exactly the copy leak brief R4 §1
   * item 7 asks about; it was missed by scoping the check to the two named files.
   */
  labels: {
    startFailure: string;
    /** The small uppercase line above the session title. */
    shellEyebrow: string;
    /** The aside card that explains what happens when you leave and come back. */
    sessionGuidance: string;
  };
  /** Where the loop navigates when the session completes or the student ends it. */
  completionHref: string;
  /** Back-link target for the in-session shell. */
  backHref: string;
  backLabel: string;
  features: {
    /**
     * The 40-item baseline flow, which hides Skip and End Session so all 40 items land.
     * Review's modes are `queue | session | filter` (20260921000000_review_queue_runtime
     * .sql:199-201) — there is no diagnostic mode, so the loop refuses the prop rather
     * than trusting a caller that passes it by mistake.
     */
    diagnostic: boolean;
    /** Desmos panel + persisted calculator state. On for both. */
    calculator: boolean;
    /**
     * The "Review tagging is available in full-length exam mode" hint above the
     * question. Practice-only: on a review session it is both irrelevant and
     * actively confusing, sitting a few pixels from the word "Review".
     */
    examTagHint: boolean;
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
    terminate: (sessionId) =>
      `/api/practice/sessions/${enc(sessionId)}/terminate`,
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
    shellEyebrow: "Academic Practice Runner",
    sessionGuidance:
      "Responses submit directly to canonical practice endpoints. If you leave and return, Lyceon restores your unresolved state from runtime session truth.",
  },
  completionHref: "/practice",
  backHref: "/practice",
  backLabel: "Back to Practice",
  features: { diagnostic: true, calculator: true, examTagHint: true },
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
    terminate: (sessionId) =>
      `/api/review/sessions/${enc(sessionId)}/terminate`,
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
    shellEyebrow: "Review Runner",
    sessionGuidance:
      "These are questions you missed or skipped. Answer one correctly twice and it leaves your queue. If you leave and return, Lyceon restores your unresolved state from runtime session truth.",
  },
  completionHref: "/review",
  backHref: "/review",
  backLabel: "Back to Review",
  features: { diagnostic: false, calculator: true, examTagHint: false },
};
