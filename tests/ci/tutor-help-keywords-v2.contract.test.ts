/**
 * The help keyword map, version 2: what production runs (Karl, reported 2026-11-22: version 2,
 * stuck 33, solve_it 20).
 *
 * @spec [SCL-275 (the help-level engine; the keyword map is versioned config);
 *       supabase/migrations/20261206000000_lisa_help_keywords_v2.sql] | @implemented [2026-11-22]
 *
 * plain English: the map is not hand-copied here. It is built from the two committed migrations
 * the way Postgres builds it: the version-1 seed (20261201000000's $json$ literal), then the v2
 * UPDATE's `stuck || [...]` and `solve_it || [...]` appends. So a phrase removed from either
 * migration file changes what this test sees.
 *   K1 the built map is version 2 with 33 stuck and 20 solve_it phrases, as production reported,
 *      and it parses with the server's own schema.
 *   K2 v2's new phrases: "dont know", "dont remember", "help me" are stuck; "whats the value",
 *      "u solve it" are solve_it.
 *   K3 still no signal: "I just didnt know how to do it", "how do I solve it".
 *   K4 longest match wins: "i dont know u solve it" is stuck ("i dont know", 11 characters,
 *      beats "u solve it", 10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectHelpSignal,
  helpKeywordMapSchema,
} from "../../packages/shared/src/tutor-help-level";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");
const V1 = readFileSync(
  join(MIGRATIONS, "20261201000000_lisa_help_level.sql"),
  "utf8",
);
const V2 = readFileSync(
  join(MIGRATIONS, "20261206000000_lisa_help_keywords_v2.sql"),
  "utf8",
);

/** The JSON array the v2 UPDATE appends to one signal (`'<signal>', (...) || '[...]'::jsonb`). */
function appended(signal: "stuck" | "solve_it"): string[] {
  const m = new RegExp(
    `'${signal}', \\(value->'signals'->'${signal}'\\) \\|\\| '(\\[[^']*\\])'::jsonb`,
  ).exec(V2);
  if (m === null) throw new Error(`v2 migration has no ${signal} append`);
  return JSON.parse(m[1]!) as string[];
}

const SEED: unknown = JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(V1)![1]!);
const V1_MAP = helpKeywordMapSchema.parse(SEED);

// What `jsonb_build_object('version', 2, 'signals', {stuck: old || new, solve_it: old || new})` gives.
const V2_MAP = helpKeywordMapSchema.parse({
  version: Number(/'version', (\d+),/.exec(V2)![1]!),
  signals: {
    stuck: [...V1_MAP.signals.stuck, ...appended("stuck")],
    solve_it: [...V1_MAP.signals.solve_it, ...appended("solve_it")],
  },
});

describe("help keyword map v2 (production, 2026-11-22)", () => {
  it("K1 is version 2 with 33 stuck and 20 solve_it phrases, as production reported", () => {
    expect(V1_MAP.version).toBe(1);
    expect(V2_MAP.version).toBe(2);
    expect(V2_MAP.signals.stuck).toHaveLength(33);
    expect(V2_MAP.signals.solve_it).toHaveLength(20);
    // The guard: the migration applies only on top of version 1.
    expect(V2).toContain("IS DISTINCT FROM 1 THEN");
  });

  it("K2 v2's new phrases: stuck and solve_it", () => {
    expect(detectHelpSignal("dont know", V2_MAP)).toBe("stuck");
    expect(detectHelpSignal("dont remember", V2_MAP)).toBe("stuck");
    expect(detectHelpSignal("help me", V2_MAP)).toBe("stuck");
    expect(detectHelpSignal("whats the value", V2_MAP)).toBe("solve_it");
    expect(detectHelpSignal("u solve it", V2_MAP)).toBe("solve_it");
  });

  it("K3 a question about the method is still no signal", () => {
    expect(
      detectHelpSignal("I just didnt know how to do it", V2_MAP),
    ).toBeNull();
    expect(detectHelpSignal("how do I solve it", V2_MAP)).toBeNull();
  });

  it("K4 the longest match wins: 'i dont know u solve it' is stuck", () => {
    expect(detectHelpSignal("i dont know u solve it", V2_MAP)).toBe("stuck");
  });
});
