/**
 * Column-disposition contract gate
 *
 * @spec [Doc-02B_V4 §14/§20; Doc 02 Preamble V3 §12 INV-02B-01; Coding Standards §5]
 * @implemented [2026-07-24]
 *
 * Proves that EVERY column in public.questions (as defined in
 * genesis-schema.expected.sql) has a declared disposition in the
 * column-disposition registry. Fails if a column is added to the
 * schema without classifying it — prevents accidental leaks of
 * new answer-bearing or internal columns.
 *
 * Also proves disposition-consistency invariants:
 *   - correct_answer and explanation are post_submit_only
 *   - correct_variants and option_metadata are server_only
 *   - assets and passage are served_pre_submit
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  QUESTIONS_COLUMN_DISPOSITION,
  type ColumnDisposition,
} from "../../packages/shared/src/column-disposition";
import { filterAssetsPreSubmit } from "../../server/routes/practice-canonical";

function extractQuestionsColumns(schemaSql: string): string[] {
  const lines = schemaSql.split("\n");
  let inTable = false;
  const columns: string[] = [];

  for (const line of lines) {
    if (/CREATE TABLE public\.questions\s*\(/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (line.trim().startsWith(")")) break;
      if (line.trim().startsWith("CONSTRAINT")) continue;
      const match = line.trim().match(/^(\w+)\s/);
      if (match) {
        columns.push(match[1]);
      }
    }
  }
  return columns;
}

describe("Column-disposition contract", () => {
  const schemaPath = path.resolve(
    __dirname,
    "../../scripts/ci/genesis-schema.expected.sql",
  );
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");
  const schemaColumns = extractQuestionsColumns(schemaSql);

  it("genesis schema has questions columns (parser sanity check)", () => {
    expect(schemaColumns.length).toBeGreaterThan(20);
    expect(schemaColumns).toContain("id");
    expect(schemaColumns).toContain("correct_answer");
    expect(schemaColumns).toContain("assets");
  });

  it("every questions column has a declared disposition", () => {
    const missing = schemaColumns.filter(
      (col) => !(col in QUESTIONS_COLUMN_DISPOSITION),
    );
    expect(missing).toEqual([]);
  });

  it("no disposition entry references a column not in the schema", () => {
    const extra = Object.keys(QUESTIONS_COLUMN_DISPOSITION).filter(
      (col) => !schemaColumns.includes(col),
    );
    expect(extra).toEqual([]);
  });

  it("correct_answer and explanation are post_submit_only", () => {
    expect(QUESTIONS_COLUMN_DISPOSITION.correct_answer).toBe(
      "post_submit_only",
    );
    expect(QUESTIONS_COLUMN_DISPOSITION.explanation).toBe("post_submit_only");
  });

  it("correct_variants and option_metadata are server_only", () => {
    expect(QUESTIONS_COLUMN_DISPOSITION.correct_variants).toBe("server_only");
    expect(QUESTIONS_COLUMN_DISPOSITION.option_metadata).toBe("server_only");
  });

  it("estimated_time_seconds is server_only", () => {
    expect(QUESTIONS_COLUMN_DISPOSITION.estimated_time_seconds).toBe(
      "server_only",
    );
  });

  it("assets and passage are served_pre_submit", () => {
    expect(QUESTIONS_COLUMN_DISPOSITION.assets).toBe("served_pre_submit");
    expect(QUESTIONS_COLUMN_DISPOSITION.passage).toBe("served_pre_submit");
  });

  it("premium_flag is server_only (permanently unused)", () => {
    expect(QUESTIONS_COLUMN_DISPOSITION.premium_flag).toBe("server_only");
  });

  it("every disposition is a valid value", () => {
    const valid: ColumnDisposition[] = [
      "served_pre_submit",
      "server_only",
      "post_submit_only",
    ];
    for (const [_col, disp] of Object.entries(QUESTIONS_COLUMN_DISPOSITION)) {
      expect(valid).toContain(disp);
    }
  });

  it("assets role filter exists and excludes explanation-role items pre-submit", () => {
    const structured = {
      v: 1,
      items: [
        { id: "a1", kind: "svg", role: "stimulus", alt: "diagram" },
        {
          id: "a2",
          kind: "table",
          role: "option",
          alt: "table",
          option_key: "A",
        },
        { id: "a3", kind: "svg", role: "explanation", alt: "answer diagram" },
      ],
    };
    const filtered = filterAssetsPreSubmit(structured) as {
      v: number;
      items: Array<{ role: string }>;
    };
    expect(filtered).not.toBeNull();
    expect(filtered.v).toBe(1);
    expect(filtered.items).toHaveLength(2);
    expect(filtered.items.every((item) => item.role !== "explanation")).toBe(
      true,
    );
    expect(filtered.items.map((item) => item.role)).toEqual([
      "stimulus",
      "option",
    ]);
  });

  it("assets role filter returns null when only explanation items exist", () => {
    const explanationOnly = {
      v: 1,
      items: [{ id: "a1", kind: "svg", role: "explanation", alt: "answer" }],
    };
    expect(filterAssetsPreSubmit(explanationOnly)).toBeNull();
  });

  it("assets role filter passes through null assets", () => {
    expect(filterAssetsPreSubmit(null)).toBeNull();
  });

  it("assets role filter excludes legacy flat format (fail-closed)", () => {
    const legacy = { illustration: "diagram.svg" };
    expect(filterAssetsPreSubmit(legacy)).toBeNull();
  });

  it("assets role filter excludes unknown version v:2 (fail-closed)", () => {
    const v2 = {
      v: 2,
      items: [{ id: "a1", kind: "svg", role: "stimulus", alt: "diagram" }],
    };
    expect(filterAssetsPreSubmit(v2)).toBeNull();
  });

  it("assets role filter excludes missing v field (fail-closed)", () => {
    const noV = {
      items: [{ id: "a1", kind: "svg", role: "stimulus", alt: "diagram" }],
    };
    expect(filterAssetsPreSubmit(noV)).toBeNull();
  });

  it("assets role filter excludes non-array items (fail-closed)", () => {
    const badItems = { v: 1, items: "not-an-array" };
    expect(filterAssetsPreSubmit(badItems)).toBeNull();
  });

  it("assets role filter drops item with missing role", () => {
    const missingRole = {
      v: 1,
      items: [
        { id: "a1", kind: "svg", alt: "no role here" },
        { id: "a2", kind: "svg", role: "stimulus", alt: "safe" },
      ],
    };
    const filtered = filterAssetsPreSubmit(missingRole) as {
      v: number;
      items: Array<{ id: string }>;
    };
    expect(filtered).not.toBeNull();
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].id).toBe("a2");
  });

  it("assets role filter drops item with unknown role", () => {
    const unknownRole = {
      v: 1,
      items: [
        { id: "a1", kind: "svg", role: "hint", alt: "unknown role" },
        { id: "a2", kind: "svg", role: "option", alt: "safe" },
      ],
    };
    const filtered = filterAssetsPreSubmit(unknownRole) as {
      v: number;
      items: Array<{ id: string }>;
    };
    expect(filtered).not.toBeNull();
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].id).toBe("a2");
  });

  it("assets role filter drops item with unknown kind", () => {
    const unknownKind = {
      v: 1,
      items: [
        { id: "a1", kind: "video", role: "stimulus", alt: "unknown kind" },
        { id: "a2", kind: "table", role: "option", alt: "safe" },
      ],
    };
    const filtered = filterAssetsPreSubmit(unknownKind) as {
      v: number;
      items: Array<{ id: string }>;
    };
    expect(filtered).not.toBeNull();
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].id).toBe("a2");
  });

  it("assets role filter drops item with missing kind", () => {
    const missingKind = {
      v: 1,
      items: [
        { id: "a1", role: "stimulus", alt: "no kind" },
        { id: "a2", kind: "svg", role: "stimulus", alt: "safe" },
      ],
    };
    const filtered = filterAssetsPreSubmit(missingKind) as {
      v: number;
      items: Array<{ id: string }>;
    };
    expect(filtered).not.toBeNull();
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].id).toBe("a2");
  });

  it("assets role filter returns null when all items are invalid", () => {
    const allInvalid = {
      v: 1,
      items: [
        { id: "a1", kind: "video", role: "explanation", alt: "bad" },
        { id: "a2", role: "stimulus", alt: "no kind" },
        { id: "a3", kind: "svg", alt: "no role" },
      ],
    };
    expect(filterAssetsPreSubmit(allInvalid)).toBeNull();
  });
});
