/**
 * @spec [Doc-03D_V1.2 §6.7; LISA_Video_RAG_Plan.md Step C (pgvector); SCL-231 (PROPOSED)]
 *       | @implemented [2026-10-15]
 *
 * plain English: the `surface_gate` and `content_type` lists exist twice — as the Zod enums in
 * packages/shared/tutor-rag-types.ts and as CHECK constraints on `curriculum_chunks`. This reads
 * both from source and requires them equal, so a value added on one side and not the other
 * fails here rather than as a rejected insert (or an unparseable row) in production. The
 * embedding dimension is pinned the same way: 768, read from text-embedding-005 on 2026-10-15.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ragCorpusMetadataSchema } from "../../packages/shared/tutor-rag-types";

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    "../../supabase/migrations/20261101010000_lisa_curriculum_chunks.sql",
  ),
  "utf8",
);

function checkList(constraint: string, column: string): string[] {
  const match = new RegExp(
    `CONSTRAINT ${constraint}\\s+CHECK \\(${column} IN \\(([^)]*)\\)\\)`,
  ).exec(MIGRATION);
  if (match === null)
    throw new Error(`${constraint} not found in the migration`);
  const body = match[1] ?? "";
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "").sort();
}

describe("curriculum_chunks CHECKs match the shared Zod enums", () => {
  it("surface_gate", () => {
    const sql = checkList(
      "curriculum_chunks_surface_gate_check",
      "surface_gate",
    );
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toEqual(
      [...ragCorpusMetadataSchema.shape.surface_gate.options].sort(),
    );
  });

  it("content_type", () => {
    const sql = checkList(
      "curriculum_chunks_content_type_check",
      "content_type",
    );
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toEqual(
      [...ragCorpusMetadataSchema.shape.content_type.options].sort(),
    );
  });

  it("embedding is vector(768), the text-embedding-005 dimension", () => {
    expect(MIGRATION).toMatch(
      /^\s+embedding\s+extensions\.vector\(768\) NOT NULL/m,
    );
  });
});
