/**
 * @spec [Doc-03_V3 §4.6 (crisis is "genuine distress (not academic frustration but real
 *       emotional crisis…)"), §21 (two-layer crisis classification), SCL-023; CR-03C-V3-01 §3.4;
 *       CC Brief "P1: Stop False Crisis Positives" (Karl, 2026-10-21) §4.2] | @implemented [2026-10-21]
 *
 * plain English: the Layer 2 crisis classifier's request and response, with no IO, so the
 * production call (tutor-crisis.ts `invokeClassifier`) and the CI golden-set gate
 * (scripts/ci/crisis-classifier-golden-set.ts) send the SAME system prompt with the SAME
 * generation settings and read the answer with the SAME parser. A gate that copied the prompt
 * would pass while production drifted; this module is the one copy.
 *
 * Layer 1 (the signature table) is not here and is not changed by anything in this file.
 */

/**
 * The system instruction sent with every Layer 2 classification.
 *
 * Rewritten 2026-10-21 (CC Brief "P1: Stop False Crisis Positives" §4.2). The previous version
 * ended "Be sensitive. When in doubt, classify as crisis (fail toward safety)." beside "Do NOT
 * classify normal academic frustration or test anxiety as crisis." — and the first won: a bare
 * "help" on a review question was classified crisis on every run (golden set, 2026-10-21). This
 * version states the distinction instead of a blanket tiebreak: academic distress is not crisis;
 * personal crisis is; fail toward safety only for a message that could plausibly be read either
 * way. The golden set (scripts/ci/crisis-classifier-golden-set.ts) pins both directions.
 */
export const CRISIS_CLASSIFIER_SYSTEM_PROMPT = [
  "You are a crisis detection classifier for a student tutoring platform. Students are 13 to 18 and are working on SAT practice and review questions. Every message is something a student typed to their tutor while studying.",
  "",
  "Decide whether the student's message indicates a PERSONAL CRISIS: suicidal thoughts or intent, self-harm, abuse or neglect, the student or someone else being in danger, or severe emotional distress about their life (not their schoolwork).",
  "",
  "ACADEMIC DISTRESS IS NOT A CRISIS. Classify as not a crisis:",
  '- Requests for help with the work. In a tutoring session, "help" or "help me" means help with the question.',
  "- Frustration or difficulty with the work, including giving up on a question.",
  '- Time pressure or test stress, including figures of speech about schoolwork such as "this is killing me".',
  "- Self-criticism about performance: being bad at a subject, failing a test, not passing.",
  "",
  "A PERSONAL CRISIS is about the student's life or safety, not the work: wanting to die or not to be alive, wanting to hurt themselves or having hurt themselves, being hurt or abused by someone, being unsafe at home, or a plan to harm someone; or severe distress about their life, such as hopelessness or feeling they cannot go on.",
  "",
  "Fail toward safety for genuine ambiguity: if a message could plausibly be read as a personal crisis as well as academic distress, classify it as a crisis. A message that is plainly about the schoolwork is not ambiguous.",
  "",
  "Respond with ONLY a JSON object, no other text:",
  '{"isCrisis": false, "confidence": 0.95}',
  "",
  "isCrisis: true if the message indicates a personal crisis, false otherwise.",
  "confidence: a number between 0 and 1 indicating your confidence in the classification.",
].join("\n");

/** Generation settings for every Layer 2 classification. */
export const CRISIS_CLASSIFIER_GENERATION = {
  temperature: 0,
  maxOutputTokens: 64,
} as const;

export type ClassifierResult = {
  isCrisis: boolean;
  confidence: number;
};

/**
 * Pure. The model's raw text → the classification. Strips markdown fencing the model may add.
 * Throws on anything that is not a JSON object (the caller retries once, then Layer 1 stands —
 * SCL-023). `isCrisis` is true only for a literal `true`.
 */
export function parseClassifierResponse(raw: string): ClassifierResult {
  const jsonStr = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // The parse error is discarded on purpose: its message quotes the model's output, and the
    // thrown message below carries the same truncated output for the caller's retry log.
    throw new Error(
      `Crisis classifier returned unparseable response: ${raw.slice(0, 200)}`,
    );
  }
  // `null` failed here before this module existed (reading a property of null threw inside the
  // parse's try), so it still does; any other non-object reads as "not crisis".
  if (parsed === null)
    throw new Error(
      `Crisis classifier returned unparseable response: ${raw.slice(0, 200)}`,
    );
  const obj =
    typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    isCrisis: obj.isCrisis === true,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
  };
}
