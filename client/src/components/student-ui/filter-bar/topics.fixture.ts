import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  practiceTopicsResponseSchema,
  type PracticeTopicsResponse,
} from "@lyceon/shared/practice-reference-schema";

/**
 * @spec [CLAUDE.md "derive the fixture from real output"; "one scenario, shared"; register §6
 *       UI-43 proof] | @implemented [2026-10-03]
 *
 * plain English: test-only. The filter bar's taxonomy fixture is the REAL `getPracticeTopics`
 * handler's output, not a hand-written body. The tests fake only the database read under it:
 * `canonical_skill_catalog` rows taken from `content/canonical/taxonomy.json`, the canonical
 * section → domain → skill tree the question bank is authored against (29 skills across eight
 * domains, the same triples the route header records for production on 2026-10-02). The real
 * `fetchSkillCatalog` then parses and sorts them and the real route groups them, and the body is
 * parsed with the strict shared schema.
 * trade-offs: lives beside the tests it serves, so both test files share one scenario. Imported
 * by tests only; nothing in the app bundle reaches it.
 */

const TAXONOMY_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "content",
  "canonical",
  "taxonomy.json",
);

const taxonomyFileSchema = z.object({
  domains: z.object({ M: z.array(z.string()), RW: z.array(z.string()) }),
  skills: z.record(z.string(), z.array(z.string())),
});

export type CatalogRow = { section: string; domain: string; skill: string };

/** `canonical_skill_catalog` as the view would return it for the canonical tree (unordered). */
export function canonicalCatalogRows(): CatalogRow[] {
  const file = taxonomyFileSchema.parse(
    JSON.parse(readFileSync(TAXONOMY_PATH, "utf8")),
  );
  const rows: CatalogRow[] = [];
  for (const section of ["RW", "M"] as const) {
    for (const domain of file.domains[section]) {
      for (const skill of file.skills[domain] ?? []) {
        rows.push({ section, domain, skill });
      }
    }
  }
  // The view's DISTINCT carries no order; reverse so the route's own sort is what orders it.
  return rows.reverse();
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Runs the real topics handler and returns its 200 body, parsed by the strict schema. */
export async function topicsFromRoute(
  handler: Handler,
): Promise<PracticeTopicsResponse> {
  let status = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  };
  // The handler reads nothing from the request.
  await handler({} as Request, res as unknown as Response);
  if (status !== 200) throw new Error(`topics route returned ${status}`);
  return practiceTopicsResponseSchema.parse(body);
}
