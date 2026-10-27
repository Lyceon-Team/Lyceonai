#!/usr/bin/env pnpm exec tsx
/**
 * G0-2 server-side case import: one production tutor turn into `tutor_eval_cases`.
 *
 * @spec [Doc-03D_V1.2 §5.1 (real conversations replace the fixed corpus);
 *       docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §3.1, §3.3; Karl's ruling
 *       2026-10-27: student cases live in a server-only table, never in the repo]
 *       | @implemented [2026-10-27]
 *
 * plain English: OWNER-RUN, with the server's service-role environment (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY). Given a case id, a conversation and the id of the student
 * message under test (the "cut-off"), it builds the request production would have sent for
 * that turn and stores it with LISA's actual reply:
 *  - recent_messages: the BFF's own `getRecentMessages`, the window ending at the cut-off.
 *  - The envelope: the BFF's own `resolveFullEnvelope`, at production's runtime limits
 *    (2048 output tokens, 30 s).
 *  - Submission state as of the cut-off, fail closed: post-submit only for test_review, or for
 *    a practice / review item whose status is submitted AND whose `answered_at` is at or before
 *    the cut-off. Anything else, including an unreadable item, is pre-submit, so the stored
 *    request carries `correct_answer: null` (INV-03-04).
 *  - `scan_correct_answer`: the BFF's `getCorrectAnswerForScope`, the BFF-local scan key. A
 *    pre-submit turn whose answer cannot be resolved is refused, as production blocks it
 *    (LISA-FULL-007).
 *  - `production_reply`: the first tutor message after the cut-off.
 *  - `requested_method` and `question_content.section`: what the turn path sends the worker for
 *    the Desmos gating (docs/lisa/desmos-playbook.md §8), from the same functions.
 *
 * Prints ids and counts only, never message text.
 *
 * trade-offs (what a replay cannot reproduce, so read the production reply alongside):
 *  - Learning context, friction, KPI and memory are read as they are NOW, not as they were at
 *    the turn. Mastery has moved since; the baseline report says so.
 *  - Offered videos are not replayed (the library post-dates some turns, and retrieval is live).
 *  - The policy assignment is production's deterministic default, as `resolveFullEnvelope`
 *    computes it.
 *
 * Usage:
 *   pnpm exec tsx tests/eval/teaching-quality/import-case.ts \
 *     --case G0-2-03 --conversation <uuid> --cutoff <student message uuid> [--owner-case]
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { resolveFullEnvelope } from "../../../server/services/tutor-context";
import { getRecentMessages } from "../../../server/services/tutor-memory";
import { getCorrectAnswerForScope } from "../../../server/routes/tutor-runtime";
import { TutorConfig } from "../../../server/services/tutor-config";
import { requestedVideoMethod } from "../../../server/services/tutor-video-library";
import {
  TEACHING_QUALITY_SET_VERSION,
  tutorEvalCaseIdSchema,
} from "../../../packages/shared/src/tutor-eval-schema";

const PRODUCTION_RUNTIME_LIMITS = { maxOutputTokens: 2048, timeoutMs: 30_000 };
const SUBMITTED_STATUSES: ReadonlySet<string> = new Set([
  "answered",
  "skipped",
]);

const argsSchema = z.object({
  case: tutorEvalCaseIdSchema,
  conversation: z.string().uuid(),
  cutoff: z.string().uuid(),
  "owner-case": z.boolean(),
});

const conversationSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
  source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
  source_session_id: z.string().uuid().nullable(),
  source_session_item_id: z.string().uuid().nullable(),
  source_question_row_id: z.string().uuid().nullable(),
  source_question_canonical_id: z.string().nullable(),
});

const messageSchema = z.object({
  id: z.string().uuid(),
  role: z.string(),
  message: z.string(),
  created_at: z.string(),
});

/**
 * Pure. Was the item submitted when the cut-off message was sent? Any doubt is pre-submit.
 */
export function isPostSubmitAtCutoff(
  surface: z.infer<typeof conversationSchema>["source_surface"],
  item: { status: string; answered_at: string | null } | null,
  cutoffAt: string,
): boolean {
  if (surface === "test_review") return true;
  if (surface === "dashboard" || item === null) return false;
  if (!SUBMITTED_STATUSES.has(item.status) || item.answered_at === null)
    return false;
  return Date.parse(item.answered_at) <= Date.parse(cutoffAt);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      case: { type: "string" },
      conversation: { type: "string" },
      cutoff: { type: "string" },
      "owner-case": { type: "boolean", default: false },
    },
  });
  const args = argsSchema.parse(values);
  // The runtime config the turn path reads (recent-message window, video_method_keywords).
  await TutorConfig.loadAll();

  const conv = await supabaseServer
    .from("tutor_conversations")
    .select(
      "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id",
    )
    .eq("id", args.conversation)
    .maybeSingle();
  if (conv.error || !conv.data) throw new Error("conversation not found");
  const conversation = conversationSchema.parse(conv.data);

  const cut = await supabaseServer
    .from("tutor_messages")
    .select("id, role, message, created_at")
    .eq("id", args.cutoff)
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  if (cut.error || !cut.data)
    throw new Error("cut-off message not in this conversation");
  const cutoff = messageSchema.parse(cut.data);
  if (cutoff.role !== "student")
    throw new Error("the cut-off must be a student message");

  const next = await supabaseServer
    .from("tutor_messages")
    .select("id, role, message, created_at")
    .eq("conversation_id", conversation.id)
    .eq("role", "tutor")
    .gt("created_at", cutoff.created_at)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (next.error || !next.data)
    throw new Error("no tutor reply after the cut-off");
  const productionReply = messageSchema.parse(next.data);

  let item: { status: string; answered_at: string | null } | null = null;
  if (
    (conversation.source_surface === "practice" ||
      conversation.source_surface === "review") &&
    conversation.source_session_item_id !== null
  ) {
    const table =
      conversation.source_surface === "practice"
        ? "practice_session_items"
        : "review_session_items";
    const read = await supabaseServer
      .from(table)
      .select("status, answered_at")
      .eq("id", conversation.source_session_item_id)
      .maybeSingle();
    const parsed = z
      .object({ status: z.string(), answered_at: z.string().nullable() })
      .safeParse(read.data);
    item = read.error || !parsed.success ? null : parsed.data;
  }
  const isPostSubmit = isPostSubmitAtCutoff(
    conversation.source_surface,
    item,
    cutoff.created_at,
  );

  const scanKey = await getCorrectAnswerForScope(
    conversation.source_question_row_id,
    conversation.source_surface,
    conversation.source_session_item_id,
  );
  if (!isPostSubmit && scanKey.failed) {
    throw new Error(
      "pre-submit turn whose correct answer cannot be resolved (LISA-FULL-007)",
    );
  }

  const recentMessages = await getRecentMessages(
    conversation.id,
    undefined,
    cutoff.created_at,
  );
  if (recentMessages[recentMessages.length - 1]?.id !== cutoff.id) {
    throw new Error("the window does not end at the cut-off message");
  }

  const envelope = await resolveFullEnvelope({
    conversationId: conversation.id,
    studentId: conversation.student_id,
    entryMode: conversation.entry_mode,
    sourceSurface: conversation.source_surface,
    sourceSessionId: conversation.source_session_id,
    sourceSessionItemId: conversation.source_session_item_id,
    sourceQuestionRowId: conversation.source_question_row_id,
    recentMessages,
    runtimeLimits: PRODUCTION_RUNTIME_LIMITS,
    correctAnswer: scanKey.value,
    isPostSubmit,
  });
  // The method the cut-off message asks for, by the turn path's own detector (Step 13d), so
  // the stored request carries what production sends the worker.
  envelope.requested_method = requestedVideoMethod(cutoff.message).method;
  if (!envelope.is_post_submit && envelope.correct_answer !== null) {
    throw new Error(
      "pre-submit envelope carries correct_answer; refusing (INV-03-04)",
    );
  }

  const write = await supabaseServer.from("tutor_eval_cases").upsert(
    {
      case_id: args.case,
      set_version: TEACHING_QUALITY_SET_VERSION,
      student_id: conversation.student_id,
      is_owner_case: args["owner-case"],
      source_conversation_id: conversation.id,
      source_message_id: cutoff.id,
      item_canonical_id: conversation.source_question_canonical_id,
      request: envelope,
      scan_correct_answer: scanKey.value,
      production_reply: productionReply.message,
      // SCL-251: 90 days fixed from import. A re-import restarts the clock (the upsert would
      // otherwise keep the first import's captured_at).
      captured_at: new Date().toISOString(),
    },
    { onConflict: "case_id" },
  );
  if (write.error)
    throw new Error(`tutor_eval_cases write failed: ${write.error.code}`);

  process.stdout.write(
    `${args.case}: imported; ${recentMessages.length} message(s) in the window; ` +
      `${isPostSubmit ? "post" : "pre"}-submit; scan key ${scanKey.value === null ? "none" : "set"}\n`,
  );
}

// R-16 (LISA_Video_RAG_Closure_Plan.md): the entry check that also matches a Windows path.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
