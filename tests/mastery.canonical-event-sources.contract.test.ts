import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * canonical_mastery_events source-branch shape assertion.
 *
 * @spec [Doc-05A_V1.0 §4.4 seam guard, §6.2; Doc-04B §16.1] | @implemented [2026-08-16]
 * @updated [2026-09-25] E9 — the ruling this file was written to force has happened:
 *   SCL-154 (04B §16.1 wins: no mastery emission from the scoring transaction; the
 *   seams run from their own outbox event) and SCL-156 (the full-length arm reads
 *   answered items of SUBMITTED sections through `full_length_answer_events`).
 *   Updated in the SAME change that added the branch, as this header asked.
 *
 * plain English: `canonical_mastery_events` has exactly THREE source branches —
 * practice_session_items, review_error_attempts, and the view
 * full_length_answer_events. The third is the only way a `full_length_answer` event
 * can be derived, and the view admits only answered items of submitted sections, so
 * the §4.4 seam guard still refuses an event from an unsubmitted section or a blank.
 * No application code emits `full_length_answer`: the only caller is the SQL seams
 * function (exam_apply_scored_seams), never a route.
 *
 * What would turn it red: a fourth source; the exam branch reading a table directly
 * (bypassing the view's gates); the view losing its submitted-section or not-blank
 * filter; a TypeScript caller passing the kind.
 */

const repoRoot = path.resolve(__dirname, "..");
const SCHEMA = path.join(repoRoot, "scripts/ci/genesis-schema.expected.sql");

function extractFunctionBody(sql: string, signaturePrefix: string): string {
  const start = sql.indexOf(signaturePrefix);
  if (start === -1) {
    throw new Error(
      `function not found in schema snapshot: ${signaturePrefix}`,
    );
  }
  // Body runs to the terminating `$$;` of this CREATE FUNCTION.
  const end = sql.indexOf("$$;", start);
  if (end === -1) {
    throw new Error(`unterminated function body for: ${signaturePrefix}`);
  }
  return sql.slice(start, end);
}

describe("canonical_mastery_events — source branch contract", () => {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const body = extractFunctionBody(
    schema,
    "CREATE FUNCTION public.canonical_mastery_events(p_student_id uuid",
  );

  it("draws from exactly three sources", () => {
    expect(body.match(/FROM\s+public\.practice_session_items\b/g)).toHaveLength(1);
    expect(body.match(/FROM\s+public\.review_error_attempts\b/g)).toHaveLength(1);
    expect(body.match(/FROM\s+public\.full_length_answer_events\b/g)).toHaveLength(1);
    // Exactly two UNIONs joining exactly those three branches.
    expect(body.match(/\bUNION\s+ALL\b/g) ?? []).toHaveLength(2);
  });

  it("derives full_length_answer only through the gated view", () => {
    // The exam branch never reads the answer tables directly.
    expect(body).not.toMatch(/FROM\s+public\.test_session_answers/);
    const viewStart = schema.indexOf("CREATE VIEW public.full_length_answer_events");
    expect(viewStart).toBeGreaterThan(-1);
    const view = schema.slice(viewStart, schema.indexOf(";", viewStart));
    expect(view).toMatch(/security_invoker/);
    expect(view).toContain("'full_length_answer'::text");
    expect(view).toMatch(/sec\.state\s*=\s*'submitted'/); // submitted sections only
    expect(view).toMatch(/a\.answer\s+IS\s+NOT\s+NULL/); // a blank is not an event
  });

  it("no application code emits full_length_answer (the SQL seams are the only caller)", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules") walk(f);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(f, "utf8");
          if (src.includes('"full_length_answer"') && !f.endsWith(path.join("services", "mastery-write.ts"))) {
            hits.push(path.relative(repoRoot, f));
          }
        }
      }
    };
    for (const d of ["server", "apps/api/src", "client/src"]) walk(path.join(repoRoot, d));
    expect(hits).toEqual([]);
  });

  it("apply_mastery_event still accepts the kind and still guards derivation", () => {
    // The §4.4 guard is what makes the view's gates binding: an event the view
    // cannot produce is refused with MASTERY_EVENT_NOT_DERIVED.
    const applyBody = extractFunctionBody(
      schema,
      "CREATE FUNCTION public.apply_mastery_event(p_student_id uuid",
    );
    expect(applyBody).toContain("full_length_answer");
    expect(applyBody).toContain("MASTERY_EVENT_NOT_DERIVED");
  });
});
