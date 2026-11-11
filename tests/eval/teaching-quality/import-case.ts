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
 *  - Learning context and KPI are read as they are NOW, not as they were at the turn. Mastery
 *    has moved since; the baseline report says so.
 *  - Friction's message signals are read as of the cut-off (W4-15, `frictionAsOf`); its
 *    practice signals are read now. Memory written after the cut-off, or compacting this
 *    conversation, is dropped (W4-16, `memoryAsOfCutoff`).
 *  - Offered videos are not replayed (the library post-dates some turns, and retrieval is live).
 *  - The policy assignment is production's deterministic default, as `resolveFullEnvelope`
 *    computes it.
 *
 * Usage:
 *   pnpm exec tsx tests/eval/teaching-quality/import-case.ts \
 *     --case G0-2-03 --conversation <uuid> --cutoff <student message uuid> [--owner-case] [--check]
 *
 *   --check reads and parses everything and builds the request, then stops before the write: it
 *   prints the same line with "checked, not written". Run it for every case before importing.
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
import {
  orchestrateRequestSchema,
  recentMessageSchema,
  resolvedScopeSchema,
} from "../../../shared/tutor-orchestrator-wire";

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
  check: z.boolean(),
});

/**
 * @spec [migration 20260805000000 (tutor_conversations, tutor_messages; TA-1), 20260610020000 and
 *       20260921000000 (practice / review session items)] | @implemented [2026-11-11]
 * The rows this script reads, parsed as production stores them. Each field is the wire's own
 * schema where one exists, so the import cannot drift from what the BFF already sends:
 *  - `source_question_row_id` is TEXT, a foreign key to `questions.id`, which holds the
 *    canonical question id (`SATM2CN39N2`), never a UUID (TA-1). It was parsed as a UUID until
 *    2026-11-11, so every real case failed to import; `resolvedScopeSchema` is the wire's
 *    canonical-id rule.
 *  - `entry_mode` and `source_surface` are the wire's enums, which match the table's CHECKs.
 *  - `role` is the table's CHECK (`student`, `tutor`, `system`), as the wire's recent message.
 *  - Timestamps are strings in whatever offset form PostgREST returns; they are only compared.
 */
export const conversationRowSchema = orchestrateRequestSchema
  .pick({ entry_mode: true, source_surface: true })
  .extend({ id: z.string().uuid(), student_id: z.string().uuid() })
  .merge(resolvedScopeSchema);

export const messageRowSchema = recentMessageSchema
  .pick({ id: true, role: true })
  .extend({ message: z.string(), created_at: z.string() });

/** Both item tables: status CHECK ('pending','served','answered','skipped'), answered_at timestamptz. */
export const sessionItemRowSchema = z.object({
  status: z.enum(["pending", "served", "answered", "skipped"]),
  answered_at: z.string().nullable(),
});

type ConversationRow = z.infer<typeof conversationRowSchema>;
type MessageRow = z.infer<typeof messageRowSchema>;
type SessionItemRow = z.infer<typeof sessionItemRowSchema>;

/**
 * Pure. Parses one row read from production. On failure the message names the row and each
 * failing field with Zod's reason, never a value, so no student text reaches the terminal.
 */
export function parseRow<T>(
  label: string,
  schema: z.ZodType<T>,
  row: unknown,
): { ok: true; value: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(row);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fields = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(row)"}: ${i.code}`)
    .join("; ");
  return { ok: false, error: `${label} does not parse: ${fields}` };
}

function parseOrThrow<T>(label: string, schema: z.ZodType<T>, row: unknown): T {
  const parsed = parseRow(label, schema, row);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * Pure. Was the item submitted when the cut-off message was sent? Any doubt is pre-submit.
 */
export function isPostSubmitAtCutoff(
  surface: ConversationRow["source_surface"],
  item: SessionItemRow | null,
  cutoffAt: string,
): boolean {
  if (surface === "test_review") return true;
  if (surface === "dashboard" || item === null) return false;
  if (!SUBMITTED_STATUSES.has(item.status) || item.answered_at === null)
    return false;
  return Date.parse(item.answered_at) <= Date.parse(cutoffAt);
}

/**
 * @spec [closure plan W4-15, W4-16; owner brief 2026-11-08 (both fixes evaluated before
 *       deploy)] | @implemented [2026-11-08]
 * Pure. The memory summaries a replay of this cut-off may carry. Memory is read as it is now,
 * so a summary written after the cut-off (its window ends later) would hand the replay
 * knowledge the production turn did not have, and a compaction of this very conversation is
 * the replay's own future. Both are dropped; a summary with no window end is kept, because it
 * cannot be dated after the cut-off. Returns the kept list and how many were dropped.
 */
export function memoryAsOfCutoff<
  T extends {
    source_window_end: string | null;
    content_json: Record<string, unknown>;
  },
>(
  summaries: readonly T[],
  cutoffAt: string,
  conversationId: string,
): { kept: T[]; dropped: number } {
  const cutoff = Date.parse(cutoffAt);
  const kept = summaries.filter(
    (m) =>
      m.content_json["conversation_id"] !== conversationId &&
      (m.source_window_end === null ||
        Date.parse(m.source_window_end) <= cutoff),
  );
  return { kept, dropped: summaries.length - kept.length };
}

/**
 * The import, from its command-line arguments. Exported so the contract test can run the whole
 * path, `--check` included, against a fake database. Returns the line it prints.
 */
export async function runImport(argv: readonly string[]): Promise<string> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      case: { type: "string" },
      conversation: { type: "string" },
      cutoff: { type: "string" },
      "owner-case": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
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
  const conversation: ConversationRow = parseOrThrow(
    "tutor_conversations row",
    conversationRowSchema,
    conv.data,
  );

  const cut = await supabaseServer
    .from("tutor_messages")
    .select("id, role, message, created_at")
    .eq("id", args.cutoff)
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  if (cut.error || !cut.data)
    throw new Error("cut-off message not in this conversation");
  const cutoff: MessageRow = parseOrThrow(
    "cut-off tutor_messages row",
    messageRowSchema,
    cut.data,
  );
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
  const productionReply: MessageRow = parseOrThrow(
    "reply tutor_messages row",
    messageRowSchema,
    next.data,
  );

  // No item row is pre-submit (fail closed). A row that exists but does not parse is a shape
  // mismatch, refused like any other, rather than silently read as pre-submit.
  let item: SessionItemRow | null = null;
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
    if (read.error) throw new Error(`${table} read failed: ${read.error.code}`);
    item =
      read.data === null
        ? null
        : parseOrThrow(`${table} row`, sessionItemRowSchema, read.data);
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
    // W4-15: message-based friction as of the cut-off, never from later messages.
    frictionAsOf: cutoff.created_at,
  });
  // W4-16: only memory the production turn could have had.
  const memory = memoryAsOfCutoff(
    envelope.memory_summaries,
    cutoff.created_at,
    conversation.id,
  );
  envelope.memory_summaries = memory.kept;
  // The method the cut-off message asks for, by the turn path's own detector (Step 13d), so
  // the stored request carries what production sends the worker.
  envelope.requested_method = requestedVideoMethod(cutoff.message).method;
  if (!envelope.is_post_submit && envelope.correct_answer !== null) {
    throw new Error(
      "pre-submit envelope carries correct_answer; refusing (INV-03-04)",
    );
  }
  // The baseline replays the stored request through this same schema; a request that would
  // fail there is refused here, before anything is written.
  parseOrThrow("built request", orchestrateRequestSchema, envelope);

  const summary =
    `${recentMessages.length} message(s) in the window; ` +
    `${isPostSubmit ? "post" : "pre"}-submit; ` +
    `item ${item === null ? "none" : item.status}; scan key ${scanKey.value === null ? "none" : "set"}; ` +
    `memory ${memory.kept.length} kept, ${memory.dropped} dropped as after the cut-off`;
  if (args.check) {
    // --check: every read and every parse, nothing written.
    return `${args.case}: checked, not written; ${summary}`;
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

  return `${args.case}: imported; ${summary}`;
}

// R-16 (LISA_Video_RAG_Closure_Plan.md): the entry check that also matches a Windows path.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runImport(process.argv.slice(2)).then(
    (line) => process.stdout.write(`${line}\n`),
    (err: unknown) => {
      process.stderr.write(
        `${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
