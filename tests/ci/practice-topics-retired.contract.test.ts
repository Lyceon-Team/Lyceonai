/**
 * @spec [OQ-68 (a) (Karl, 2026-10-08): "/practice/topics is retired, with a redirect to
 *        /practice"] | @implemented [2026-10-08]
 *
 * plain English: the topic browser (`pages/browse-topics.tsx`) is deleted and its address only
 * redirects. This sweep pins that nothing in the client still sends a student there: the only
 * non-test source files that may name the client path `/practice/topics` are the router, which
 * mounts the redirect, and the shell table, which lists it as a redirect. The API path
 * `/api/practice/topics` (the taxonomy the Practice and Review filters read) is a different
 * thing and is not matched.
 *
 * Presence before absence: the sweep must find the router's and the shell table's mentions, or
 * it is reading nothing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CLIENT_SRC = path.join(REPO_ROOT, "client/src");

/**
 * A quoted client path `/practice/topics` (any quote, with or without a query or hash). The
 * quote must sit right before the path, so `/api/practice/topics` never matches.
 */
const CLIENT_PATH = /["'`]\/practice\/topics(?:[/?#][^"'`]*)?["'`]/g;

/** Comments may mention the retired address (history); only code can link to it. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("OQ-68 (a): no in-app link to the retired /practice/topics", () => {
  const hits = sourceFiles(CLIENT_SRC).flatMap((file) => {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    return Array.from(source.matchAll(CLIENT_PATH), (m) => ({
      file: path.relative(REPO_ROOT, file),
      text: m[0],
    }));
  });

  it("only the router's redirect and the shell table name the client path", () => {
    expect(hits).toEqual([
      { file: "client/src/App.tsx", text: '"/practice/topics"' },
      { file: "client/src/lib/route-shells.ts", text: '"/practice/topics"' },
    ]);
  });

  it("the router's mention is the redirect to /practice", () => {
    const app = fs.readFileSync(path.join(CLIENT_SRC, "App.tsx"), "utf8");
    expect(app).toMatch(
      /<Route path="\/practice\/topics">\s*\{\(\) => <Redirect to="\/practice" replace \/>\}\s*<\/Route>/,
    );
  });

  it("the page module is gone", () => {
    expect(
      fs.existsSync(path.join(CLIENT_SRC, "pages/browse-topics.tsx")),
    ).toBe(false);
  });
});
