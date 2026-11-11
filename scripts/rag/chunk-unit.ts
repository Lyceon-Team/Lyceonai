/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2.3–§2.4, §7, §8;
 *       Karl's audit rulings of 2026-10-23 and 2026-10-26 (one repair; the example check is
 *       drop-only, never repaired); owner brief "One watch, two outputs" (Karl, 2026-11-04),
 *       Step 0 design §2 (no second chunking pipeline: books and video segments call this one
 *       function)] | @implemented [2026-11-05]
 *
 * plain English: LISA 1's per-unit chunk steps, lifted out of scripts/rag/ingest-book.ts unchanged
 * so the video segments run the same code:
 *  1. REWRITE the unit into one self-contained entry, or drop it with the model's reason.
 *  2. AUDIT the entry against its source (a book passage, or for a video segment the segment
 *     itself, watched). A failure drops it, except that a repairable failure (unfaithful,
 *     incorrect, dependent, ACT advice generalised) is rewritten ONCE with the audit's finding and
 *     audited again. A boundary failure (incomplete, started mid-idea) is never repaired.
 *  3. EXAMPLE CHECK the audited entry against itself; any mismatch drops it, never repaired.
 * Every model call goes through the caller's `call`, which owns caching and spend. The cache
 * keys (`rewrite\0model\0user`, `audit\0model\0user`, `example-check\0model\0content`) and stage
 * names are exactly ingest-book.ts's, so the Meltzer cache stays valid.
 * The prompts are parameters: the book passes REWRITE_SYSTEM / AUDIT_SYSTEM, the video path the
 * video-sourced wording (book-prompts.ts VIDEO_*), and `exampleCheck: false` skips step 3 for
 * an entry with no examples to describe (the delivery notes).
 */
import type { z } from "zod";
import {
  type Audit,
  EXAMPLE_CHECK_SYSTEM,
  auditFailure,
  auditResponseSchema,
  auditSchema,
  auditUserMessage,
  exampleCheckFailure,
  exampleCheckResponseSchema,
  exampleCheckSchema,
  exampleCheckUserMessage,
} from "./book-prompts";
import type { VideoClip } from "./vertex";

/** Audit failures repaired once (Karl, 2026-10-23): the entry is wrong, not the unit. */
export const REPAIRABLE: ReadonlySet<string> = new Set([
  "audit_act_generalised",
  "audit_unfaithful",
  "audit_incorrect",
  "audit_not_self_contained",
]);

/** One model call, cached and costed by the caller. */
export type UnitCall = <T>(args: {
  /** Cache key, without the prompt version (the caller adds it). */
  key: string;
  /** Usage stage, e.g. "rewrite (repair)". */
  stage: string;
  /** The step label generateJson logs. */
  step: string;
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
  schema: z.ZodType<T>;
  video?: VideoClip;
}) => Promise<T>;

/** What any rewrite answers: keep or drop, with a reason. */
export type RewriteAnswer = {
  keep: boolean;
  drop_reason: string | null;
};

export type UnitOutcome<R extends RewriteAnswer> =
  | {
      kept: true;
      content: string;
      skill_codes: string[];
      rewrite: R;
      audit: Audit;
      repaired: boolean;
    }
  | { kept: false; reason: string; detail: string };

export async function rewriteAuditCheck<R extends RewriteAnswer>(opts: {
  model: string;
  call: UnitCall;
  rewrite: {
    system: string;
    user: string;
    responseSchema: Record<string, unknown>;
    schema: z.ZodType<R>;
    /** The entry text the audit reads, from the answer. */
    contentOf: (rw: R) => string | null;
    /** The entry's skill codes; null when the entry carries none (the delivery notes). */
    skillsOf: (rw: R) => string[] | null;
    /** Shown with a drop, e.g. the rewrite's taxonomy gap. */
    detailOf: (rw: R) => string;
  };
  audit: {
    system: string;
    source: string;
    before: string;
    after: string;
    ruleOpening: string | null;
    /** The video segment the audit watches as its source; absent for a book. */
    video?: VideoClip;
  };
  exampleCheck: boolean;
}): Promise<UnitOutcome<R>> {
  const { model, call } = opts;
  let feedback = "";
  for (let attempt = 0; ; attempt += 1) {
    const user = opts.rewrite.user + feedback;
    const rw = await call({
      key: `rewrite\u0000${model}\u0000${user}`,
      stage: attempt === 0 ? "rewrite" : "rewrite (repair)",
      step: "rewrite",
      system: opts.rewrite.system,
      user,
      responseSchema: opts.rewrite.responseSchema,
      schema: opts.rewrite.schema,
    });
    if (!rw.keep) {
      return {
        kept: false,
        reason: rw.drop_reason ?? "dropped_without_reason",
        detail: opts.rewrite.detailOf(rw),
      };
    }
    const content = (opts.rewrite.contentOf(rw) ?? "").trim();
    if (content === "")
      return { kept: false, reason: "empty_rewrite", detail: "" };
    const skills = opts.rewrite.skillsOf(rw);
    const codes = skills === null ? [] : [...new Set(skills)];
    if (skills !== null && codes.length === 0) {
      return {
        kept: false,
        reason: "no_taxonomy_skill",
        detail: opts.rewrite.detailOf(rw),
      };
    }
    const auditUser = auditUserMessage({
      source: opts.audit.source,
      before: opts.audit.before,
      after: opts.audit.after,
      entry: content,
      ruleOpening: opts.audit.ruleOpening,
    });
    const audit = await call({
      key: `audit\u0000${model}\u0000${auditUser}`,
      stage: attempt === 0 ? "audit" : "audit (repair)",
      step: "audit",
      system: opts.audit.system,
      user: auditUser,
      responseSchema: auditResponseSchema,
      schema: auditSchema,
      ...(opts.audit.video === undefined ? {} : { video: opts.audit.video }),
    });
    const failed = auditFailure(audit);
    if (failed !== null) {
      if (attempt === 0 && REPAIRABLE.has(failed)) {
        feedback = `\n\nA REVIEWER REJECTED YOUR PREVIOUS ENTRY FOR THIS UNIT: ${audit.issues}\nPREVIOUS ENTRY:\n${content}\n\nWrite the entry again, fixing exactly that, and include nothing the unit does not say.`;
        continue;
      }
      return { kept: false, reason: failed, detail: audit.issues };
    }
    if (opts.exampleCheck) {
      // Against itself only. Any mismatch drops it; never repaired, so it cannot become a
      // correction (Karl, 2026-10-26).
      const check = await call({
        key: `example-check\u0000${model}\u0000${content}`,
        stage: "example check",
        step: "example-check",
        system: EXAMPLE_CHECK_SYSTEM,
        user: exampleCheckUserMessage(content),
        responseSchema: exampleCheckResponseSchema,
        schema: exampleCheckSchema,
      });
      const contradiction = exampleCheckFailure(check);
      if (contradiction !== null) {
        return {
          kept: false,
          reason: "audit_self_contradictory",
          detail: contradiction,
        };
      }
    }
    return {
      kept: true,
      content,
      skill_codes: codes,
      rewrite: rw,
      audit,
      repaired: attempt > 0,
    };
  }
}
