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
      signatureId: string | null;
      modelConfidence: number | null;
      forceReview: boolean;
    };

type SignatureResult = {
  triggered: boolean;
  signatureId: string | null;
  /** True when the signature set returned zero crisis rows — Layer 1 is inert. */
  layer1Empty: boolean;
};

type ClassifierResult = {
  isCrisis: boolean;
  confidence: number;
};

export type { CrisisResult };

// ── Regional Crisis Resources (Doc 03 §4.6) ───────────────────────────

/**
 * Crisis resource lookup by billing country code.
 * @spec [Doc-03_V3 §4.6, §21.2]
 */
const CRISIS_RESOURCES: Readonly<Record<string, string>> = {
  US: "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.",
  CA: "If you're in crisis, Talk Suicide Canada is there for you. Call 1-833-456-4566 or text 45645. Real people, anytime.",
  UK: "If you're in crisis, the Samaritans are there for you. Call 116 123. Real people, anytime.",
  GB: "If you're in crisis, the Samaritans are there for you. Call 116 123. Real people, anytime.",
  IE: "If you're in crisis, Samaritans Ireland is there for you. Call 116 123. Real people, anytime.",
  AU: "If you're in crisis, Lifeline is there for you. Call 13 11 14. Real people, anytime.",
  NZ: "If you're in crisis, Lifeline Aotearoa is there for you. Call 0800 543 354. Real people, anytime.",
  SG: "If you're in crisis, Samaritans of Singapore is there for you. Call 1-767. Real people, anytime.",
};

const DEFAULT_CRISIS_RESPONSE =
  "If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.";

// ── Layer 1: Deterministic Signature Match ─────────────────────────────

/**
 * Checks crisis signatures against tutor_injection_signatures table
 * (reuses the injection signatures pattern per SCL-023, filtered by
 * signature_type = 'crisis').
 *
 * Fails CLOSED if table is unreadable (SCL-023 explicitly:
 * "Layer 1 signature table unreadable: fail closed on the turn").
 *
 * @spec [Doc-03_V3 §21.1, SCL-023, INV-03-16]
 */
export async function checkCrisisSignatures(
  text: string,
): Promise<SignatureResult> {
  const { data, error } = await supabaseServer
    .from("tutor_injection_signatures")
    .select("id, signature_pattern, signature_type")
    .eq("signature_type", "crisis");

  if (error) {
    logger.error(
      "TUTOR_CRISIS",
      "signature_table_read_failed",
      "tutor_injection_signatures (crisis) table unreadable; failing closed on this turn",
      error,
    );
    // Fail CLOSED — SCL-023: "Layer 1 signature table unreadable: fail closed on the turn"
    // Returning triggered=true so the orchestrator blocks the turn.
    // layer1Empty=false: the table is unreadable, not known-empty.
    return { triggered: true, signatureId: null, layer1Empty: false };
  }

  if (!data || data.length === 0) {
    // Layer 1 has no crisis signatures — it cannot detect anything.
    // The caller uses layer1Empty to decide fail-closed behavior on
    // Layer 2 failure (B1.5: SCL-023 §3.4 "Layer 1 result stands"
    // presumes Layer 1 can produce a meaningful result).
    return { triggered: false, signatureId: null, layer1Empty: true };
  }

  const lowerText = text.toLowerCase();

  for (const row of data) {
    const pattern = row.signature_pattern as string;

    const matched = (() => {
      try {
        const re = new RegExp(pattern, "i");
        return re.test(text);
      } catch {
        // If regex is invalid, fall back to substring match
        return lowerText.includes(pattern.toLowerCase());
      }
    })();

    if (matched) {
      logger.info(
        "TUTOR_CRISIS",
        "crisis_signature_matched",
        "Layer 1 crisis signature match detected",
        { signatureId: row.id },
      );
      return {
        triggered: true,
        signatureId: row.id as string,
        layer1Empty: false,
      };
    }
  }

  return { triggered: false, signatureId: null, layer1Empty: false };
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
        logger.error(
          "TUTOR_CRISIS",
          "classifier_retry_exhausted",
          "Layer 2 crisis classifier failed after retry; Layer 1 result stands, force-enqueuing to review queue",
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

  const location = process.env.VERTEX_LOCATION ?? "us-central1";

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
      // SCL-023 §3.4 permits "turn proceeds" only when "Layer 1 result
      // stands." With zero crisis signatures, Layer 1 has never stood for
      // anything — the premise does not hold. Proceeding to normal
      // generation here means a potentially-in-crisis student receives an
      // SAT tutoring reply with no detection having occurred from either
      // layer. Return crisis=true to route into the §4.6 crisis-safe
      // response (regional resources). The review case is still created.
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
        signatureId: null,
        modelConfidence: null,
        forceReview: true,
      };
    }
    if (layer2MayHaveFailed) {
      // SCL-023 §3.4 condition 3: Layer 2 failed, Layer 1 has signatures
      // and returned a result (no match). Layer 1 result stands — turn
      // proceeds to normal generation, force-enqueued to §21.3 review queue.
      logger.warn(
        "TUTOR_CRISIS",
        "classifier_degraded",
        "Layer 2 crisis classifier failed; Layer 1 stands (has signatures), turn force-enqueued to review queue",
      );
    }
    return { crisis: false, forceReview: layer2MayHaveFailed };
  }

  // At least one layer is positive — crisis path triggered
  const source: "signature" | "model" | "both" =
    layer1Positive && layer2Positive
      ? "both"
      : layer1Positive
        ? "signature"
        : "model";

  logger.warn(
    "TUTOR_CRISIS",
    "crisis_detected",
    "crisis classifier triggered; activating crisis protocol",
    {
      source,
      signatureId: signatureResult.signatureId,
      modelConfidence: classifierResult.confidence,
    },
  );

  return {
    crisis: true,
    source,
    signatureId: signatureResult.signatureId,
    modelConfidence: layer2Positive ? classifierResult.confidence : null,
    forceReview: true,
  };
}

// ── Crisis Response ────────────────────────────────────────────────────

/**
 * Returns crisis protocol response with regional resources.
 * Region derived from billing country (not IP) per Doc 03A context
 * resolution authority.
 *
 * @spec [Doc-03_V3 §4.6, §21.2]
 */
export function getCrisisResponse(country: string): string {
  const upperCountry = country.toUpperCase().trim();
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
): Promise<string> {
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
  try {
    const result = await createCrisisReviewCase({
      conversationId,
      studentId,
      source,
      signatureId,
      modelConfidence,
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
      .select("id, sla_deadline")
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
    { conversationId, caseId, source, slaDeadline },
  );

  // Step 3: Fire-and-forget ops notification via Cloud Tasks (§21.2 step 5).
  // Not blocking — the review case is the durable safety record.
  // Metadata only — no conversation content, no student name per SCL-025(c).
  void notifyCrisisEvent({
    caseId,
    conversationId,
    source,
    slaDeadline,
    timestamp: new Date().toISOString(),
  });

  return caseId;
}
