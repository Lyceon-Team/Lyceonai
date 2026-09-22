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
import { logger } from "../logger";
import { createCrisisReviewCase } from "./crisis-review-queue";
import { notifyCrisisEvent } from "./crisis-notification";

// ── Types ──────────────────────────────────────────────────────────────

type CrisisCategory = "crisis" | "safeguarding";

type CrisisResult =
  | { crisis: false; forceReview: boolean }
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
    };

type SignatureResult = {
  triggered: boolean;
  signatureId: string | null;
  category: CrisisCategory | null;
  /** True when the signature set returned zero crisis rows — Layer 1 is inert. */
  layer1Empty: boolean;
};

type ClassifierResult = {
  isCrisis: boolean;
  confidence: number;
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

export type { CrisisResult, CrisisCategory };
export { notifyCrisisEvent };

// ── Regional Crisis Resources (Doc 03 §4.6) ───────────────────────────

const DEFAULT_CRISIS_COUNTRY = "US";

/**
 * Crisis-lane resources by billing country code. Youth-preferred lines
 * per V1 spec; adult general lines only where no youth-specific service
 * exists for the country.
 * @spec [Doc-03_V3 §4.6, §21.2, Layer1 PR 2 brief §3]
 */
const CRISIS_RESOURCES: Readonly<Record<string, string>> = {
  US: "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.",
  CA: "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.",
  UK: "If you're in crisis, Childline is there for you. Call 0800 1111. You can also call the Samaritans at 116 123. Real people, anytime.",
  GB: "If you're in crisis, Childline is there for you. Call 0800 1111. You can also call the Samaritans at 116 123. Real people, anytime.",
  IE: "If you're in crisis, Childline Ireland is there for you. Call 1800 66 66 66. You can also call Pieta at 1800 247 247. Real people, anytime.",
  AU: "If you're in crisis, Kids Helpline is there for you. Call 1800 55 1800. Real people, anytime.",
  NZ: "If you're in crisis, Youthline is there for you. Call 0800 376 633 or text 234. You can also call 1737 for free. Real people, anytime.",
  SG: "If you're in crisis, the Samaritans of Singapore (SOS) are there for you. Call 1767. Real people, anytime.",
};

/**
 * Safeguarding-lane resources by billing country code. Abuse/neglect
 * helplines — youth-preferred, distinct from the crisis (suicide/self-harm)
 * set. Template: "What you've shared matters. [Resource] is there for you —
 * call [number]. They listen, and you decide what happens next."
 * @spec [Layer1 PR 2 brief §2, §3]
 */
const SAFEGUARDING_RESOURCES: Readonly<Record<string, string>> = {
  US: "What you've shared matters. Childhelp is there for you — call 1-800-422-4453. You can also call RAINN at 1-800-656-4673. They listen, and you decide what happens next.",
  CA: "What you've shared matters. Kids Help Phone is there for you — call 1-800-668-6868 or text CONNECT to 686868. They listen, and you decide what happens next.",
  UK: "What you've shared matters. Childline is there for you — call 0800 1111. They listen, and you decide what happens next.",
  GB: "What you've shared matters. Childline is there for you — call 0800 1111. They listen, and you decide what happens next.",
  IE: "What you've shared matters. Childline Ireland is there for you — call 1800 66 66 66. They listen, and you decide what happens next.",
  AU: "What you've shared matters. Kids Helpline is there for you — call 1800 55 1800. They listen, and you decide what happens next.",
  NZ: "What you've shared matters. Youthline is there for you — call 0800 376 633 or text 234. They listen, and you decide what happens next.",
  SG: "What you've shared matters. The National Anti-Violence Helpline is there for you — call 1800-777-0000. They listen, and you decide what happens next.",
};

const DEFAULT_CRISIS_RESPONSE = CRISIS_RESOURCES[DEFAULT_CRISIS_COUNTRY];
const DEFAULT_SAFEGUARDING_RESPONSE =
  SAFEGUARDING_RESOURCES[DEFAULT_CRISIS_COUNTRY];

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
    .select("id, signature_pattern, category")
    .or("category.eq.crisis,category.eq.safeguarding")
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
      const matchedCategory =
        (row.category as string) === "safeguarding"
          ? ("safeguarding" as const)
          : ("crisis" as const);
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
 * Classifies crisis using the classifier_class model alias.
 *
 * On failure: retry ONCE, then the Layer 1 result stands, turn proceeds,
 * turn is force-enqueued to review queue. This is NOT fail-closed — it is
 * a deliberate exception because "blocking returns an error to the student
 * who may be the person the gate exists for" (SCL-023).
 *
 * @spec [Doc-03_V3 §21.1, SCL-023, INV-03-16]
 */
export async function classifyCrisis(text: string): Promise<ClassifierResult> {
  // Load classifier model alias from runtime config.
  // The config KEY is "crisis_classifier_model_alias"; its VALUE is the
  // alias name (e.g. "classifier_class") that resolves to a provider model.
  const { data: configData, error: configError } = await supabaseServer
    .from("tutor_context_runtime_config")
    .select("value")
    .eq("key", "crisis_classifier_model_alias")
    .single();

  if (configError || !configData) {
    logger.error(
      "TUTOR_CRISIS",
      "classifier_config_missing",
      "crisis_classifier_model_alias config not found in tutor_context_runtime_config",
      configError,
    );
    // Cannot classify — return non-crisis so Layer 1 result stands
    // The caller (runCrisisClassifier) handles the force-review logic
    return { isCrisis: false, confidence: 0 };
  }

  const modelAlias =
    typeof configData.value === "string"
      ? configData.value
      : String(configData.value);

  // Attempt classification with retry-once on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await invokeClassifier(text, modelAlias);
      return result;
    } catch (err: unknown) {
      if (attempt === 0) {
        logger.warn(
          "TUTOR_CRISIS",
          "classifier_attempt_failed",
          "Layer 2 crisis classifier failed; retrying once",
          { attempt, error: err instanceof Error ? err.message : String(err) },
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
        );
        // Return non-crisis — Layer 1 result stands per SCL-023
        // The caller sets forceReview = true
        return { isCrisis: false, confidence: 0 };
      }
    }
  }

  // Unreachable, but TypeScript needs the return
  return { isCrisis: false, confidence: 0 };
}

/**
 * Invokes the crisis classifier model via Vertex AI.
 * Uses the classifier_class model alias (VERTEX_CLASSIFIER_CLASS_MODEL env var).
 * Returns structured crisis classification result.
 *
 * @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21]
 */
async function invokeClassifier(
  text: string,
  _modelAlias: string,
): Promise<ClassifierResult> {
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

  // Dynamic import — @google/genai is a root dependency. If unavailable at
  // runtime the throw is caught by classifyCrisis's retry logic and Layer 1
  // stands (SCL-023).
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({
    vertexai: true,
    project: creds.project_id,
    location,
    googleAuthOptions: { credentials: creds },
  });

  const response = await client.models.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    config: {
      systemInstruction: {
        parts: [
          {
            text: [
              "You are a crisis detection classifier for a student tutoring platform.",
              "Your ONLY job is to determine if the student's message indicates a crisis:",
              "self-harm ideation, suicide ideation, severe emotional distress, or danger to self or others.",
              "",
              "Respond with ONLY a JSON object, no other text:",
              '{"isCrisis": true, "confidence": 0.95}',
              "",
              "isCrisis: true if the message indicates a crisis situation, false otherwise.",
              "confidence: a number between 0 and 1 indicating your confidence in the classification.",
              "",
              "Be sensitive. When in doubt, classify as crisis (fail toward safety).",
              "Do NOT classify normal academic frustration or test anxiety as crisis.",
            ].join("\n"),
          },
        ],
      },
      temperature: 0,
      maxOutputTokens: 64,
    },
  });

  const raw = response.text?.trim() ?? "";
  // Parse the JSON response, stripping any markdown fencing the model may add
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(jsonStr) as {
      isCrisis?: boolean;
      confidence?: number;
    };
    return {
      isCrisis: parsed.isCrisis === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    // Model returned unparseable output — treat as failure (caller handles retry)
    throw new Error(
      `Crisis classifier returned unparseable response: ${raw.slice(0, 200)}`,
    );
  }
}

// ── Combined Classifier ────────────────────────────────────────────────

/**
 * Runs both crisis classifier layers in parallel (per SCL-023).
 * Either layer positive triggers the crisis path.
 *
 * @spec [Doc-03_V3 §21, SCL-023, INV-03-16]
 */
export async function runCrisisClassifier(text: string): Promise<CrisisResult> {
  // TEMPORARY DIAGNOSTIC — remove once GCP_PROJECT_ID issue is resolved
  logger.warn("TUTOR_CRISIS", "env_diagnostic", "ENV DIAGNOSTIC", {
    matchingKeys: Object.keys(process.env)
      .filter((k) => /PROJECT|VERTEX|GCP|MODEL_ARMOR/i.test(k))
      .sort(),
    gcpProjectIdType: typeof process.env.GCP_PROJECT_ID,
    gcpProjectIdLength: process.env.GCP_PROJECT_ID?.length ?? -1,
    vertexProjectIdLength: process.env.VERTEX_PROJECT_ID?.length ?? -1,
    classifierModelLength:
      process.env.VERTEX_CLASSIFIER_CLASS_MODEL?.length ?? -1,
  });

  // Run both layers in parallel per SCL-023
  const [signatureResult, classifierResult] = await Promise.all([
    checkCrisisSignatures(text),
    classifyCrisis(text).catch((err: unknown): ClassifierResult => {
      // If classifyCrisis itself throws (shouldn't, but defensive),
      // treat as Layer 2 failure
      logger.error(
        "TUTOR_CRISIS",
        "classifier_unexpected_error",
        "unexpected error from classifyCrisis; treating as Layer 2 failure",
        err instanceof Error ? err : undefined,
      );
      return { isCrisis: false, confidence: 0 };
    }),
  ]);

  const layer1Positive = signatureResult.triggered;
  const layer2Positive = classifierResult.isCrisis;
  const layer1Empty = signatureResult.layer1Empty;

  // Layer 2 failure detection: confidence 0 with isCrisis false suggests
  // the classifier could not run (returned default). Force review in this case.
  const layer2MayHaveFailed =
    !classifierResult.isCrisis && classifierResult.confidence === 0;

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
      };
    }
    if (layer2MayHaveFailed) {
      logger.warn(
        "TUTOR_CRISIS",
        "classifier_degraded",
        "Layer 2 crisis classifier failed; Layer 1 stands (has signatures), turn force-enqueued to review queue",
      );
    }
    return { crisis: false, forceReview: layer2MayHaveFailed };
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
      modelConfidence: classifierResult.confidence,
    },
  );

  return {
    crisis: true,
    source,
    category,
    signatureId: signatureResult.signatureId,
    modelConfidence: layer2Positive ? classifierResult.confidence : null,
    forceReview: true,
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
export function getCrisisResponse(
  country: string,
  category: CrisisCategory = "crisis",
): string {
  const upperCountry = country.toUpperCase().trim();
  if (category === "safeguarding") {
    return (
      SAFEGUARDING_RESOURCES[upperCountry] ?? DEFAULT_SAFEGUARDING_RESPONSE
    );
  }
  return CRISIS_RESOURCES[upperCountry] ?? DEFAULT_CRISIS_RESPONSE;
}

// ── Conversation Flagging ──────────────────────────────────────────────

/**
 * Sets crisis_flagged = true on the conversation AND creates a durable
 * crisis_review_cases row with a 48h SLA deadline.
 *
 * BLOCKING: throws on failure. A failed flag write means the crisis turn
 * will not be reviewed — that is worse than a failed turn. The caller
 * MUST let the throw propagate; the student receives an error rather than
 * an untracked crisis turn.
 *
 * @spec [Doc-03_V3 §21.2, §21.3, SCL-025]
 * @implemented 2026-08-13 (changed from fire-and-forget to BLOCKING)
 *
 * trade-offs:
 *   - Previously this function swallowed errors so the crisis response
 *     could still be delivered. The new behavior fails the turn on a flag
 *     write failure. Rationale: an unreviewed crisis turn is a safety gap
 *     that monitoring alone cannot close within the 48h SLA.
 *   - The crisis_review_cases INSERT uses a UNIQUE partial index on
 *     (conversation_id) WHERE status IN ('open', 'in_review'), so calling
 *     this twice for the same conversation is safe — the second call will
 *     throw a unique violation, which the route handler treats as a turn
 *     failure (idempotency is NOT required here; duplicate calls indicate
 *     a retry scenario that should be investigated).
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
  source:
    | "signature"
    | "model"
    | "both"
    | "classifier_degraded"
    | "classifier_degraded_no_floor"
    | "infrastructure_failure",
  signatureId: string | null,
  modelConfidence: number | null,
  category: CrisisCategory = "crisis",
): Promise<FlagForReviewResult> {
  // Step 1: Set crisis_flagged on tutor_conversations (BLOCKING)
  const { error } = await supabaseServer
    .from("tutor_conversations")
    .update({ crisis_flagged: true })
    .eq("id", conversationId);

  if (error) {
    logger.error(
      "TUTOR_CRISIS",
      "crisis_flag_write_failed",
      "failed to set crisis_flagged on tutor_conversations; BLOCKING the turn",
      error,
      { conversationId },
    );
    throw new Error(`crisis flag write failed: ${error.message}`);
  }

  // Step 2: Create a durable review case with 48h SLA (BLOCKING)
  //
  // Unique-violation (23505) from idx_crisis_review_cases_conversation_active
  // means an active case already exists for this conversation. That is not a
  // failed write — the case IS persisted; this is a redundant signal (e.g., a
  // second degraded turn during a sustained Vertex outage). Treat it as
  // success-equivalent: query the existing case and proceed.
  //
  // This does NOT reverse B1.1d: genuine failures (FK violation, connection
  // error, etc.) still throw and block the turn.
  let caseId: string;
  let slaDeadline: string;
  let isNewCase = true;
  let caseStatus: "open" | "in_review" | "resolved" = "open";
  try {
    const result = await createCrisisReviewCase({
      conversationId,
      studentId,
      source,
      signatureId,
      modelConfidence,
      category,
    });
    caseId = result.id;
    slaDeadline = result.slaDeadline;
  } catch (createErr: unknown) {
    // Check for unique violation on the active-case partial index
    const pgCode =
      createErr instanceof Error &&
      "code" in createErr &&
      typeof (createErr as Record<string, unknown>).code === "string"
        ? ((createErr as Record<string, unknown>).code as string)
        : null;

    // createCrisisReviewCase wraps the PG error in a new Error, so the
    // code is not on the thrown error itself. Match the message instead.
    const isUniqueViolation =
      pgCode === "23505" ||
      (createErr instanceof Error &&
        createErr.message.includes("unique") &&
        createErr.message.includes(
          "idx_crisis_review_cases_conversation_active",
        ));

    if (!isUniqueViolation) {
      // Genuine failure — re-throw per B1.1d
      throw createErr;
    }

    // Active case already exists — query it
    const { data: existingCase, error: lookupError } = await supabaseServer
      .from("crisis_review_cases")
      .select("id, sla_deadline, status")
      .eq("conversation_id", conversationId)
      .in("status", ["open", "in_review"])
      .limit(1)
      .maybeSingle();

    if (lookupError || !existingCase) {
      // Cannot find the case that caused the violation — this is unexpected.
      // Re-throw the original error so B1.1d holds.
      logger.error(
        "TUTOR_CRISIS",
        "crisis_case_lookup_after_duplicate_failed",
        "unique violation on crisis_review_cases but could not find the existing case",
        lookupError,
        { conversationId },
      );
      throw createErr;
    }

    caseId = existingCase.id as string;
    slaDeadline = existingCase.sla_deadline as string;
    caseStatus = existingCase.status as "open" | "in_review";
    isNewCase = false;

    logger.warn(
      "TUTOR_CRISIS",
      "crisis_case_already_exists",
      "active crisis review case already exists for this conversation — " +
        "treating duplicate signal as success-equivalent per Doc 03 §21.3",
      { conversationId, existingCaseId: caseId, source },
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
