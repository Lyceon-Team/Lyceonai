/**
 * @spec [Doc-03_V3 §21, INV-03-16, SCL-023]
 * @implemented 2026-08-09
 *
 * plain English: Two-layer crisis classifier for the LISA tutor runtime. Runs
 * BEFORE main generation (pre-generation gate). Every student turn, no exceptions
 * (INV-03-16). Detects crisis signals (self-harm, suicide ideation, severe distress)
 * and triggers the crisis protocol per Doc 03 §4.6 / §21.2.
 *
 * expected outcome: every student message is classified by two parallel layers:
 *   Layer 1: deterministic signature match against tutor_injection_signatures
 *            (reuses the injection signatures pattern per SCL-023).
 *   Layer 2: model inference using the classifier_class alias.
 * Either layer positive triggers the crisis path. On crisis, the conversation is
 * flagged crisis_flagged = true and regional resources are returned.
 *
 * trade-offs:
 *  - Layer 1 (signatures) is fast and deterministic but limited to known patterns.
 *  - Layer 2 (model) provides depth but may fail. On Layer 2 failure: retry ONCE,
 *    then Layer 1 result stands, turn proceeds, turn force-enqueued to review queue.
 *    This is a DELIBERATE narrow exception to fail-closed — blocking returns an error
 *    to a student who may be the person the gate exists for (SCL-023).
 *  - Layer 1 table unreadable: FAIL CLOSED on the turn (SCL-023 explicitly).
 *
 * edge cases:
 *  - Both layers run in parallel per SCL-023. Either positive = crisis path.
 *  - Layer 2 model failure after retry: Layer 1 result stands, turn is force-enqueued
 *    to the §21.3 review queue regardless of Layer 1 result.
 *  - Regional resources derived from billing country, not IP (per Doc 03A context
 *    resolution authority). Default fallback is US (988).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { getGcpCredentials } from "../lib/gcp-credentials";
import { timedStep } from "../lib/step-timer";
import { logger } from "../logger";
import {
  CRISIS_CLASSIFIER_GENERATION,
  CRISIS_CLASSIFIER_SYSTEM_PROMPT,
  type ClassifierResult,
  parseClassifierResponse,
} from "./crisis-classifier-prompt";
import { notifyCrisisEvent } from "./crisis-notification";
import {
  CRISIS_CLASSIFIER_MAX_ATTEMPTS,
  crisisFlagResultSchema,
  type CrisisCategory,
  type CrisisDegradedReason,
  type CrisisSource,
} from "../../packages/shared/src/crisis-flag-schema";

// ── Types ──────────────────────────────────────────────────────────────
// `CrisisCategory` and `CrisisSource` are inferred from the Zod schemas in
// packages/shared. They were declared here AND in crisis-review-queue.ts as
// hand-written unions; three copies of one enum drift the moment the database
// CHECK gains a value. Coding Standards §7.2 / §17.

/**
 * @spec [owner brief "Crisis classifier: record the failure reason, and look at the timeout",
 *       Karl 2026-11-08; SCL-276] | @implemented [2026-11-08]
 * What Layer 2 did on this turn, for the review case and the turn's metrics row: its wall time
 * across attempts (setup included), how many model attempts it made, and, when it could not
 * answer, why. Codes and counts only.
 */
export type Layer2Outcome = {
  ms: number;
  attempts: number;
  degradedReason: CrisisDegradedReason | null;
};

/**
 * `layer2` is absent when Layer 2 did not run (an exact-label tap) or the pipeline itself threw
 * (the route builds `infrastructure_failure`); readers treat absent as "not measured".
 */
type CrisisResult =
  | { crisis: false; forceReview: boolean; layer2?: Layer2Outcome }
  | {
      crisis: true;
      source:
        | "signature"
        | "model"
        | "both"
        | "classifier_degraded_no_floor"
        | "infrastructure_failure";
      category: CrisisCategory;
      signatureId: string | null;
      modelConfidence: number | null;
      forceReview: boolean;
      layer2?: Layer2Outcome;
    };

type SignatureResult = {
  triggered: boolean;
  signatureId: string | null;
  category: CrisisCategory | null;
  /** True when the signature set returned zero crisis rows — Layer 1 is inert. */
  layer1Empty: boolean;
};

export type NotificationPolicyInput = {
  isNewCase: boolean;
  caseStatus: "open" | "in_review" | "resolved";
  currentCategory: CrisisCategory;
  priorEvents: Array<{ category: string; created_at: string }>;
  nowMs: number;
  throttleWindowMs: number;
};

export type NotificationPolicyResult = {
  shouldNotify: boolean;
  suppressionReason: string | null;
};

const SEVERITY_RANK: Record<string, number> = {
  safeguarding: 1,
  crisis: 2,
};

export function evaluateNotificationPolicy(
  input: NotificationPolicyInput,
): NotificationPolicyResult {
  const currentSeverity = SEVERITY_RANK[input.currentCategory] ?? 0;

  if (input.isNewCase) {
    return { shouldNotify: true, suppressionReason: null };
  }

  const maxPriorSeverity = input.priorEvents.reduce(
    (max, e) => Math.max(max, SEVERITY_RANK[e.category] ?? 0),
    0,
  );

  if (input.caseStatus === "in_review") {
    if (currentSeverity > maxPriorSeverity) {
      return { shouldNotify: true, suppressionReason: null };
    }
    return { shouldNotify: false, suppressionReason: "case_claimed" };
  }

  // Open (unclaimed) case
  if (currentSeverity > maxPriorSeverity) {
    return { shouldNotify: true, suppressionReason: null };
  }

  const mostRecentMs = input.priorEvents.reduce((latest, e) => {
    const t = new Date(e.created_at).getTime();
    return t > latest ? t : latest;
  }, 0);

  const msSinceLast = mostRecentMs > 0 ? input.nowMs - mostRecentMs : Infinity;

  if (msSinceLast >= input.throttleWindowMs) {
    return { shouldNotify: true, suppressionReason: null };
  }

  return { shouldNotify: false, suppressionReason: "throttled_same_severity" };
}

// Re-exported so existing consumers keep their import site; the definition
// lives in packages/shared.
export type { CrisisResult, CrisisCategory };
export { notifyCrisisEvent };

// ── Regional Crisis Resources (Doc 03 §4.6) ───────────────────────────
// The tables, the named no-number fallback and the resolver live in `crisis-resources.ts`
// — pure data with no imports, so any caller can use them. Re-exported here so
// existing consumers keep their import site.
export {
  UNKNOWN_COUNTRY_CRISIS_RESPONSE,
  UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE,
  getCrisisResponse,
  resolveCrisisCountry,
} from "./crisis-resources";
export type { CrisisCountryResolution } from "./crisis-resources";

// ── Layer 1: Text Normalization ───────────────────────────────────────

/**
 * @spec [LISA_Layer1_Pattern_Set_v1 §7.4]
 * @implemented 2026-09-17
 *
 * plain English: deterministic text normalization for Layer 1 crisis
 * signature matching. Applied to the student message before substring
 * containment checks. Does NOT affect the injection-defense path (that
 * subsystem has its own matching logic in tutor-injection-defense.ts).
 *
 * Contract (§7.4, in order):
 *   1. Unicode NFC normalize
 *   2. Lowercase
 *   3. Normalize curly/smart apostrophes and quotation marks to ASCII
 *   4. Expand first-person contractions (i'm→i am, i've→i have,
 *      don't→do not, can't→cannot, won't→will not)
 *   5. Normalize self-harm variants (self-harm/self harm/selfharm → self harm)
 *   6. Collapse repeated whitespace to single space + trim
 *   7. Strip repeated terminal punctuation (???→?, !!!→!, ...→.)
 */
export function normalizeCrisisText(raw: string): string {
  // §7.4 step 1: Unicode NFC
  let t = raw.normalize("NFC");

  // §7.4 step 2: lowercase
  t = t.toLowerCase();

  // §7.4 step 3: normalize curly/smart quotes and apostrophes to ASCII
  t = t.replace(/[‘’‚‛]/g, "'"); // single curly → '
  t = t.replace(/[“”„‟]/g, '"'); // double curly → "

  // §7.4 step 4: expand first-person contractions
  // Order matters: won't before don't (won't contains "on't")
  t = t.replace(/\bwon't\b/g, "will not");
  t = t.replace(/\bcan't\b/g, "cannot");
  t = t.replace(/\bdon't\b/g, "do not");
  t = t.replace(/\bi'm\b/g, "i am");
  t = t.replace(/\bi've\b/g, "i have");

  // §7.4 step 5: normalize self-harm variants to canonical "self harm"
  t = t.replace(/\bself[-\s]?harm/g, "self harm");

  // §7.4 step 5b: normalize "my self" → "myself" (compound split variant)
  t = t.replace(/\bmy\s+self\b/g, "myself");

  // §7.4 step 6: collapse whitespace + trim
  t = t.replace(/\s+/g, " ").trim();

  // §7.4 step 7: strip repeated terminal punctuation
  t = t.replace(/([?!.])\1+$/g, "$1");

  return t;
}

// ── Layer 1: Signature Category → Lane Mapping ──────────────────────────

const SAFEGUARDING_CATEGORIES = new Set(["abuse"]);

function mapSignatureCategoryToLane(dbCategory: string): CrisisCategory {
  return SAFEGUARDING_CATEGORIES.has(dbCategory) ? "safeguarding" : "crisis";
}

// ── Layer 1: Deterministic Signature Match ─────────────────────────────

/**
 * Checks crisis signatures against tutor_injection_signatures table,
 * filtered by category IN ('crisis','safeguarding') with enabled=true.
 * The lane comes from category, NEVER from signature_type (which carries
 * two incompatible meanings across injection-defense and crisis subsystems).
 *
 * Text is normalized via normalizeCrisisText (§7.4) before matching.
 *
 * Fails CLOSED if table is unreadable (SCL-023 explicitly:
 * "Layer 1 signature table unreadable: fail closed on the turn").
 *
 * @spec [Doc-03_V3 §21.1, SCL-023, INV-03-16, Layer1 PR 2 brief §1]
 */
export async function checkCrisisSignatures(
  text: string,
): Promise<SignatureResult> {
  const { data, error } = await supabaseServer
    .from("tutor_injection_signatures")
    .select("id, signature_pattern, signature_type, category")
    .eq("signature_type", "crisis")
    .eq("enabled", true);

  if (error) {
    logger.error(
      "TUTOR_CRISIS",
      "signature_table_read_failed",
      "tutor_injection_signatures (crisis/safeguarding) table unreadable; failing closed on this turn",
      error,
    );
    return {
      triggered: true,
      signatureId: null,
      category: null,
      layer1Empty: false,
    };
  }

  if (!data || data.length === 0) {
    return {
      triggered: false,
      signatureId: null,
      category: null,
      layer1Empty: true,
    };
  }

  const normalized = normalizeCrisisText(text);

  for (const row of data) {
    const pattern = row.signature_pattern as string;

    const matched = (() => {
      try {
        const re = new RegExp(pattern, "i");
        return re.test(normalized);
      } catch {
        return normalized.includes(pattern.toLowerCase());
      }
    })();

    if (matched) {
      const matchedCategory = mapSignatureCategoryToLane(
        row.category as string,
      );
      logger.info(
        "TUTOR_CRISIS",
        "crisis_signature_matched",
        "Layer 1 crisis signature match detected",
        { signatureId: row.id, category: matchedCategory },
      );
      return {
        triggered: true,
        signatureId: row.id as string,
        category: matchedCategory,
        layer1Empty: false,
      };
    }
  }

  return {
    triggered: false,
    signatureId: null,
    category: null,
    layer1Empty: false,
  };
}

// ── Layer 2: Model Inference ───────────────────────────────────────────

/**
 * @spec [owner brief H4 "database cheap wins" (Karl, 2026-11-02), ruling of 2026-11-02:
 *        "3000 ms (Recommended)"; CR-03C-V3-01 §3.4 (the "timeout" failure class) and §3.6]
 *       | @implemented [2026-11-02]
 * plain English: the most one classifier attempt may take. Before H4 there was no limit at all:
 * a hung Vertex call held the whole turn and never reached the retry or the Layer 1-stands branch
 * §3.4 describes. 3000 ms is the owner's ruled value for a Flash call that outputs at most 64
 * tokens; it includes the token mint on a process's first call. With the one retry the worst case
 * is about 6 s, after which the turn takes the existing failure path. The `crisis_model` step in
 * route_timing records every attempt's own time, so the value can be tightened on real numbers.
 */
export const CRISIS_CLASSIFIER_TIMEOUT_MS = 3000;

/** Thrown when an attempt runs past CRISIS_CLASSIFIER_TIMEOUT_MS; classified as `timeout`. */
export class CrisisClassifierTimeoutError extends Error {
  constructor() {
    super(
      `crisis classifier timed out after ${CRISIS_CLASSIFIER_TIMEOUT_MS} ms`,
    );
    this.name = "CrisisClassifierTimeoutError";
  }
}

/**
 * @spec [owner brief "Crisis classifier: record the failure reason", Karl 2026-11-08; SCL-276]
 *       | @implemented [2026-11-08]
 * Pure. Why a failed attempt failed, from the error alone:
 *  - `timeout`: OUR per-attempt bound fired (or the request was aborted by it). Only this, so the
 *    count measures the one value the timeout recommendation tunes;
 *  - `rate_limited`: HTTP 429 or RESOURCE_EXHAUSTED;
 *  - `config_error`: a 400/401/403/404, or NOT_FOUND / PERMISSION_DENIED / UNAUTHENTICATED /
 *    INVALID_ARGUMENT: it would fail the same way again;
 *  - `upstream_error`: everything else: a 5xx, a timeout the upstream reported (408, 504,
 *    DEADLINE_EXCEEDED, ETIMEDOUT), a network failure, unreadable output.
 * The SDK's ApiError carries a numeric `status`; the message is the fallback, matched only on
 * status-shaped text so a stray number cannot misreport.
 */
export function classifyClassifierFailure(err: unknown): CrisisDegradedReason {
  if (err instanceof CrisisClassifierTimeoutError) return "timeout";
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : null;
  const message = err instanceof Error ? err.message : String(err);
  if (
    status === 429 ||
    /RESOURCE_EXHAUSTED|\[429\]|(?:status|code)\W{0,3}429\b|\b429 Too Many Requests/i.test(
      message,
    )
  ) {
    return "rate_limited";
  }
  const configStatuses: ReadonlySet<number> = new Set([400, 401, 403, 404]);
  if (
    (status !== null && configStatuses.has(status)) ||
    (status === null &&
      /NOT_FOUND|PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT/.test(
        message,
      ))
  ) {
    return "config_error";
  }
  return "upstream_error";
}

type ClassifierModels = {
  generateContent: (params: {
    model: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    config: Record<string, unknown>;
  }) => Promise<{ text?: string | undefined }>;
};

type PreparedClassifier = { modelId: string; models: ClassifierModels };

// One client per process (per project and location), built on first use. Each GoogleGenAI owns
// its GoogleAuth, so a client built per call minted a fresh OAuth token on every attempt.
// A key rotated within the same project is picked up on the next process start; until then a
// failing attempt takes the normal path (one retry, then Layer 1 stands and review).
let cachedClient: { key: string; models: ClassifierModels } | null = null;

/**
 * Everything an attempt needs that does not depend on the network: the model id, the credential
 * and the client. A failure here (a missing env var, an absent credential) repeats identically on
 * a second try, so it is not retried (H4 ruling of 2026-11-02, "BFF only").
 *
 * The client is built only after the credential resolves, so an absent credential never
 * constructs one (tests/ci/gcp-fail-at-use.contract.test.ts).
 */
async function prepareClassifier(): Promise<PreparedClassifier> {
  const modelId = process.env.VERTEX_CLASSIFIER_CLASS_MODEL;
  if (!modelId) {
    throw new Error(
      "VERTEX_CLASSIFIER_CLASS_MODEL env var not set; crisis classifier cannot run",
    );
  }

  const location =
    (process.env.VERTEX_CLASSIFIER_LOCATION ?? "").trim() || "global";

  // Explicit credential injection — ADC is removed from the BFF path.
  // The credential and the project it authenticates against cannot disagree,
  // so project_id comes from the credential, not from a separate env var.
  const creds = getGcpCredentials();

  const key = `${creds.project_id}|${location}`;
  if (cachedClient !== null && cachedClient.key === key) {
    return { modelId, models: cachedClient.models };
  }

  // Dynamic import — @google/genai is a root dependency. If unavailable at
  // runtime the throw reaches classifyCrisis and Layer 1 stands (SCL-023).
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({
    vertexai: true,
    project: creds.project_id,
    location,
    googleAuthOptions: { credentials: creds },
  });
  cachedClient = { key, models: client.models };
  return { modelId, models: client.models };
}

/**
 * Classifies crisis using the classifier_class model (VERTEX_CLASSIFIER_CLASS_MODEL).
 *
 * On failure: retry ONCE, then the Layer 1 result stands, turn proceeds,
 * turn is force-enqueued to review queue. This is NOT fail-closed — it is
 * a deliberate exception because "blocking returns an error to the student
 * who may be the person the gate exists for" (SCL-023).
 *
 * @spec [Doc-03_V3 §21.1, SCL-023, INV-03-16]
 *
 * @spec [owner brief H4 (Karl, 2026-11-02), rulings of 2026-11-02] | @implemented [2026-11-02]
 * plain English (H4): three changes, the failure semantics otherwise unchanged.
 *  - No config read. The turn used to read `tutor_context_runtime_config`
 *    (`crisis_classifier_model_alias`) and pass the value to a parameter nothing read; the model
 *    has only ever come from VERTEX_CLASSIFIER_CLASS_MODEL. One DB round trip gone per turn. The
 *    read's only effect was as a gate (a missing row failed Layer 2); that gate guarded nothing.
 *  - A setup failure (prepareClassifier) is not retried: it would fail the same way again. It
 *    still ends in the same "could not classify" sentinel and the same error event.
 *  - Each attempt is bounded by CRISIS_CLASSIFIER_TIMEOUT_MS; a timeout is a failed attempt, so
 *    it gets the one retry like any other Vertex failure.
 */
export async function classifyCrisis(text: string): Promise<ClassifierResult> {
  return (await classifyCrisisDetailed(text)).result;
}

/**
 * @spec [owner brief "Crisis classifier: record the failure reason", Karl 2026-11-08; SCL-276]
 *       | @implemented [2026-11-08]
 * `classifyCrisis`, plus what Layer 2 did: its wall time, its model attempts, and on failure the
 * reason of the last failed attempt. The classification and every failure branch are exactly
 * `classifyCrisis`'s (the "could not classify" sentinel is unchanged), so the fail-closed
 * decision downstream is untouched.
 */
export async function classifyCrisisDetailed(
  text: string,
): Promise<{ result: ClassifierResult; layer2: Layer2Outcome }> {
  const startedAt = Date.now();
  const sentinel: ClassifierResult = { isCrisis: false, confidence: 0 };
  let prepared: PreparedClassifier;
  try {
    prepared = await prepareClassifier();
  } catch (err: unknown) {
    logger.error(
      "TUTOR_CRISIS",
      "classifier_retry_exhausted",
      "Layer 2 crisis classifier cannot run (setup failed; not retried, it would fail the same way); Layer 1 result stands, force-enqueuing to review queue",
      err instanceof Error ? err : { message: String(err) },
      { retried: false, degradedReason: "config_error", attempts: 0 },
    );
    // Return non-crisis — Layer 1 result stands per SCL-023
    // The caller sets forceReview = true
    return {
      result: sentinel,
      layer2: {
        ms: Date.now() - startedAt,
        attempts: 0,
        degradedReason: "config_error",
      },
    };
  }

  // Attempt classification with retry-once on failure
  for (let attempt = 0; attempt < CRISIS_CLASSIFIER_MAX_ATTEMPTS; attempt++) {
    try {
      // H1 (P2 Revised §2): one `crisis_model` step per attempt (route_timing; no content).
      const result = await timedStep("crisis_model", () =>
        invokeClassifier(text, prepared),
      );
      return {
        result,
        layer2: {
          ms: Date.now() - startedAt,
          attempts: attempt + 1,
          degradedReason: null,
        },
      };
    } catch (err: unknown) {
      const reason = classifyClassifierFailure(err);
      if (attempt < CRISIS_CLASSIFIER_MAX_ATTEMPTS - 1) {
        logger.warn(
          "TUTOR_CRISIS",
          "classifier_attempt_failed",
          "Layer 2 crisis classifier failed; retrying once",
          {
            attempt,
            degradedReason: reason,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isModelNotFound = /NOT_FOUND|404|models\/.*not found/i.test(
          errMsg,
        );
        logger.error(
          "TUTOR_CRISIS",
          isModelNotFound
            ? "classifier_model_not_found"
            : "classifier_retry_exhausted",
          isModelNotFound
            ? "Layer 2 crisis classifier model not found at configured endpoint — check VERTEX_CLASSIFIER_CLASS_MODEL and VERTEX_CLASSIFIER_LOCATION"
            : "Layer 2 crisis classifier failed after retry; Layer 1 result stands, force-enqueuing to review queue",
          err instanceof Error ? err : undefined,
          { degradedReason: reason, attempts: attempt + 1 },
        );
        // Return non-crisis — Layer 1 result stands per SCL-023
        // The caller sets forceReview = true
        return {
          result: sentinel,
          layer2: {
            ms: Date.now() - startedAt,
            attempts: attempt + 1,
            degradedReason: reason,
          },
        };
      }
    }
  }

  // Unreachable, but TypeScript needs the return
  return {
    result: sentinel,
    layer2: {
      ms: Date.now() - startedAt,
      attempts: CRISIS_CLASSIFIER_MAX_ATTEMPTS,
      degradedReason: "upstream_error",
    },
  };
}

/**
 * Invokes the crisis classifier model via Vertex AI, bounded by CRISIS_CLASSIFIER_TIMEOUT_MS.
 * Returns structured crisis classification result.
 *
 * The timeout both aborts the SDK request (`abortSignal`) and rejects the attempt itself, so an
 * attempt ends on time even if a request ignores the signal.
 *
 * @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21]
 */
async function invokeClassifier(
  text: string,
  prepared: PreparedClassifier,
): Promise<ClassifierResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CrisisClassifierTimeoutError());
    }, CRISIS_CLASSIFIER_TIMEOUT_MS);
  });

  const request = {
    model: prepared.modelId,
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    // The prompt, settings and parser are shared with the CI golden-set gate
    // (crisis-classifier-prompt.ts), so the gate tests exactly what runs here.
    config: {
      systemInstruction: { parts: [{ text: CRISIS_CLASSIFIER_SYSTEM_PROMPT }] },
      ...CRISIS_CLASSIFIER_GENERATION,
      abortSignal: controller.signal,
    },
  };

  try {
    const response = await Promise.race([
      prepared.models.generateContent(request),
      timedOut,
    ]);
    // Unparseable output throws; classifyCrisis retries once, then Layer 1 stands.
    return parseClassifierResponse(response.text ?? "");
  } finally {
    clearTimeout(timer);
  }
}

// ── Combined Classifier ────────────────────────────────────────────────

/**
 * `classifyCrisisDetailed`, made total: if it ever throws (it should not), that is a Layer 2
 * failure exactly as before (the "could not classify" sentinel), classified by its error.
 */
async function classifyWithOutcome(
  text: string,
): Promise<{ result: ClassifierResult; layer2: Layer2Outcome }> {
  const startedAt = Date.now();
  try {
    return await classifyCrisisDetailed(text);
  } catch (err: unknown) {
    logger.error(
      "TUTOR_CRISIS",
      "classifier_unexpected_error",
      "unexpected error from classifyCrisis; treating as Layer 2 failure",
      err instanceof Error ? err : undefined,
    );
    return {
      result: { isCrisis: false, confidence: 0 },
      layer2: {
        ms: Date.now() - startedAt,
        attempts: 0,
        degradedReason: classifyClassifierFailure(err),
      },
    };
  }
}

/**
 * Which layers a turn's crisis screening runs.
 *  - "both": Layer 1 (signatures) and Layer 2 (the model), every free-text turn.
 *  - "signatures_only_exact_label": Layer 1 alone. ONLY for a guided-choice tap whose message
 *    the route has checked is exactly that choice's fixed label (owner ruling 4, 2026-10-27).
 */
export type CrisisScreening = "both" | "signatures_only_exact_label";

/**
 * Runs both crisis classifier layers in parallel (per SCL-023).
 * Either layer positive triggers the crisis path.
 *
 * @spec [Doc-03_V3 §21, SCL-023, INV-03-16]
 *
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27), ruling 4 of
 *        2026-10-27 (option a); SCL-254] | @implemented [2026-10-27]
 * plain English: `screening: "signatures_only_exact_label"` skips the model classifier (Layer 2)
 * for a tap on a guided choice: the message is then one of five fixed labels the server wrote,
 * checked server-side to be exactly the label, so there is nothing a student wrote for the model
 * to read. Layer 1 still runs on it, and the route's injection scan still runs. A skipped Layer 2
 * is not a failed Layer 2: it neither forces review nor trips the B1.5 fail-closed path. Any
 * free-text message, including one typed after a tap, gets "both".
 */
export async function runCrisisClassifier(
  text: string,
  screening: CrisisScreening = "both",
): Promise<CrisisResult> {
  const runModel = screening === "both";
  // Run both layers in parallel per SCL-023
  const [signatureResult, classified] = await Promise.all([
    checkCrisisSignatures(text),
    runModel ? classifyWithOutcome(text) : null,
  ]);
  const classifierResult = classified?.result ?? null;
  const layer2 = classified?.layer2;

  const layer1Positive = signatureResult.triggered;
  const layer2Positive = classifierResult?.isCrisis ?? false;
  const layer1Empty = signatureResult.layer1Empty;

  // Layer 2 failure detection: confidence 0 with isCrisis false suggests
  // the classifier could not run (returned default). Force review in this case.
  // A Layer 2 that was not run (an exact-label tap) did not fail.
  const layer2MayHaveFailed =
    classifierResult !== null &&
    !classifierResult.isCrisis &&
    classifierResult.confidence === 0;

  if (!layer1Positive && !layer2Positive) {
    if (layer2MayHaveFailed && layer1Empty) {
      // B1.5 — FAIL CLOSED: Layer 2 failed AND Layer 1 has no signatures.
      // Default to "crisis" lane — safest assumption when we cannot classify.
      // @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21.2, B1.5]
      logger.error(
        "TUTOR_CRISIS",
        "classifier_degraded_no_floor",
        "Layer 2 crisis classifier failed AND Layer 1 has zero crisis signatures; " +
          "failing closed with crisis-safe response because Layer 1 cannot provide a floor",
      );
      return {
        crisis: true,
        source: "classifier_degraded_no_floor",
        category: "crisis",
        signatureId: null,
        modelConfidence: null,
        forceReview: true,
        ...(layer2 !== undefined ? { layer2 } : {}),
      };
    }
    if (layer2MayHaveFailed) {
      logger.warn(
        "TUTOR_CRISIS",
        "classifier_degraded",
        "Layer 2 crisis classifier failed; Layer 1 stands (has signatures), turn force-enqueued to review queue",
      );
    }
    return {
      crisis: false,
      forceReview: layer2MayHaveFailed,
      ...(layer2 !== undefined ? { layer2 } : {}),
    };
  }

  // At least one layer is positive — crisis path triggered.
  // Category comes from Layer 1 signature match when available.
  // Layer 2 (model) does not distinguish lanes — default to "crisis" when
  // only Layer 2 fires (model-only detection). Layer 1 match always has
  // a category from the DB row.
  const source: "signature" | "model" | "both" =
    layer1Positive && layer2Positive
      ? "both"
      : layer1Positive
        ? "signature"
        : "model";

  const category: CrisisCategory = signatureResult.category ?? "crisis";

  logger.warn(
    "TUTOR_CRISIS",
    "crisis_detected",
    "crisis classifier triggered; activating crisis protocol",
    {
      source,
      category,
      signatureId: signatureResult.signatureId,
      modelConfidence: classifierResult?.confidence ?? null,
    },
  );

  return {
    crisis: true,
    source,
    category,
    signatureId: signatureResult.signatureId,
    modelConfidence:
      layer2Positive && classifierResult !== null
        ? classifierResult.confidence
        : null,
    forceReview: true,
    ...(layer2 !== undefined ? { layer2 } : {}),
  };
}

// ── Crisis Response ────────────────────────────────────────────────────

/**
 * Returns the lane-appropriate crisis/safeguarding response with regional
 * resources. Region derived from billing country (not IP) per Doc 03A
 * context resolution authority. Lane determines which resource set is used.
 *
 * @spec [Doc-03_V3 §4.6, §21.2, Layer1 PR 2 brief §1–§3]
 */
// ── Conversation Flagging ──────────────────────────────────────────────

/**
 * Flags a conversation for crisis review: sets `crisis_flagged` on the
 * conversation AND creates the durable review case with its SLA deadline, in
 * ONE database transaction.
 *
 * BLOCKING: throws on failure. A failed flag write means the crisis turn will
 * not be reviewed — that is worse than a failed turn. The caller MUST let the
 * throw propagate; the student receives an error rather than an untracked
 * crisis turn.
 *
 * @spec [Doc-03_V3 §21.2 step 5, §21.3; SCL-025; WS-L8 Item 4b;
 *        owner ruling 2026-09-22 D1]
 * @implemented 2026-08-13; made atomic 2026-09-22
 *
 * plain English: this used to do two writes in sequence, and between them sat
 * a state the system must never be in — a conversation MARKED as a crisis with
 * NOTHING in the review queue. The turn failed and the student saw an error,
 * correctly, but the flag stayed set. Nothing sweeps for a flagged
 * conversation without a case, and the 48h SLA never starts because the SLA
 * lives on the case that was never created. Both writes are now inside
 * `public.flag_conversation_for_crisis_review`, so either both land or
 * neither does.
 *
 * expected outcome: returns the case id, whether it is new, its status and its
 * SLA deadline — the four things `evaluateNotificationPolicy` needs from the
 * write. Two outcomes are success-equivalent and are resolved inside the SQL
 * function: an active case already existing for this conversation (a second
 * signal during one sustained event), and a `source` value newer than
 * production's CHECK constraint, which retries once at coarser precision
 * (WS-L8 Item 4b).
 *
 * trade-offs:
 *  - This function does NOT notify. The ops notification is the caller's
 *    (`tutor-runtime.ts`), which first runs `evaluateNotificationPolicy` over
 *    the result below. That split predates D1 and is kept: Cloud Tasks cannot
 *    join a database transaction anyway, and a notification sent for a case
 *    that then rolls back is worse than one sent a moment late.
 *  - The RPC's payload is parsed with Zod rather than cast. It crosses a
 *    process boundary like any other external input.
 *
 * edge cases:
 *  - A conversation id that does not exist now throws. PostgREST reports no
 *    error when a filtered UPDATE matches zero rows, so the old code reported
 *    success and then failed on the case INSERT's foreign key — a confusing FK
 *    error for what is really a bad conversation id.
 */

export type FlagForReviewResult = {
  caseId: string;
  isNewCase: boolean;
  caseStatus: "open" | "in_review" | "resolved";
  slaDeadline: string;
};

export async function flagConversationForReview(
  conversationId: string,
  studentId: string,
  source: CrisisSource,
  signatureId: string | null,
  modelConfidence: number | null,
  category: CrisisCategory = "crisis",
): Promise<FlagForReviewResult> {
  const { data, error } = await supabaseServer.rpc(
    "flag_conversation_for_crisis_review",
    {
      p_conversation_id: conversationId,
      p_student_id: studentId,
      p_source: source,
      p_signature_id: signatureId,
      p_model_confidence: modelConfidence,
      p_category: category,
    },
  );

  if (error) {
    logger.error(
      "TUTOR_CRISIS",
      "crisis_flag_write_failed",
      "failed to flag conversation and create its review case; BLOCKING the turn. " +
        "Both writes are one transaction, so nothing was left half-done.",
      error,
      { conversationId },
    );
    throw new Error(`crisis flag write failed: ${error.message}`);
  }

  const parsed = crisisFlagResultSchema.safeParse(data);
  if (!parsed.success) {
    // The write succeeded, so the case exists — but we cannot say which one.
    // Blocking is still right: an unreadable result is not a reviewed turn,
    // and a cast would hand `undefined` to the notification policy.
    logger.error(
      "TUTOR_CRISIS",
      "crisis_flag_result_unparseable",
      "flag_conversation_for_crisis_review returned a payload that does not " +
        "match its contract; BLOCKING the turn",
      undefined,
      { conversationId, issues: parsed.error.flatten() },
    );
    throw new Error("crisis flag write returned an unreadable result");
  }

  const {
    case_id: caseId,
    sla_deadline: slaDeadline,
    already_existed: alreadyExisted,
    case_status: caseStatus,
    persisted_source: persistedSource,
  } = parsed.data;
  const isNewCase = !alreadyExisted;

  if (alreadyExisted) {
    logger.warn(
      "TUTOR_CRISIS",
      "crisis_case_already_exists",
      "active crisis review case already exists for this conversation — " +
        "treating duplicate signal as success-equivalent per Doc 03 §21.3",
      { conversationId, existingCaseId: caseId, source, caseStatus },
    );
  } else if (persistedSource !== source) {
    logger.warn(
      "TUTOR_CRISIS",
      "crisis_case_created_degraded",
      "crisis review case created with degraded source precision — " +
        "production's CHECK constraint predates this source value. " +
        "Apply the pending migration to restore full precision (WS-L8 Item 4b).",
      { conversationId, caseId, requestedSource: source, persistedSource },
    );
  }

  logger.warn(
    "TUTOR_CRISIS",
    "conversation_crisis_flagged",
    "conversation flagged for safety review queue (48h SLA at launch)",
    { conversationId, caseId, source, slaDeadline, isNewCase, caseStatus },
  );

  return { caseId, isNewCase, caseStatus, slaDeadline };
}
