/**
 * The client bundle never value-imports a `shared/` module that pulls in a Node builtin.
 *
 * @spec [lyceon-coding-standards §2 (the client is a Vite bundle; server-only code stays
 *       server-side); learned 2026-10-01 on PR 1003] | @implemented [2026-10-01]
 *
 * plain English: `shared/question-bank-contract.ts` imports Node's `crypto`. A client file
 * that imports a VALUE from it compiles, passes every jsdom test (Node has `crypto`), and then
 * crashes the page in a browser — Vite externalises the module and `randomBytes` throws on
 * first touch. That is exactly what `DomainGrid` did to the guardian Dashboard, caught only by
 * the browser run. So: for every non-test client file, each `@shared/<module>` import that is
 * not `import type` must name a module with no Node builtin import. Browser-safe pieces are
 * split out and re-exported (`canonical-id.ts`, `canonical-domains.ts`).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const NODE_BUILTIN =
  /^(node:|crypto$|fs$|path$|os$|child_process$|stream$|zlib$|http$|https$|net$|tls$|url$|util$|buffer$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    )
      out.push(rel);
  }
  return out;
}

/** The Node builtins a `shared/` module imports at runtime (type-only imports excluded). */
function nodeImportsOf(sharedModule: string): string[] {
  const file = path.join(ROOT, "shared", `${sharedModule}.ts`);
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, "utf8");
  return [
    ...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
  ]
    .map((m) => m[1]!)
    .filter((spec) => NODE_BUILTIN.test(spec));
}

describe("client imports of shared/ modules are browser-safe", () => {
  it("no non-type import of a shared/ module that imports a Node builtin", () => {
    const offenders: string[] = [];
    let valueImports = 0;
    for (const file of walk("client/src")) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const m of src.matchAll(
        /^import\s+(type\s+)?[^;]*?from\s+["']@shared\/([^"']+)["']/gm,
      )) {
        if (m[1] !== undefined) continue;
        valueImports += 1;
        const builtins = nodeImportsOf(m[2]!);
        if (builtins.length > 0)
          offenders.push(
            `${file}: @shared/${m[2]} imports ${builtins.join(", ")}`,
          );
      }
    }
    // Presence first: the scan really sees the client's value imports from shared/.
    expect(valueImports).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("the scan detects the defect it exists for (gate self-check)", () => {
    expect(nodeImportsOf("question-bank-contract")).toContain("crypto");
    expect(nodeImportsOf("canonical-domains")).toEqual([]);
  });
});
