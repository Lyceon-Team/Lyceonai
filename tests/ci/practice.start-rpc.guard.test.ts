import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Practice start RPC guard", () => {
  it("does not depend on start_practice_session_with_items runtime RPC", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const routePath = path.join(repoRoot, "server", "routes", "practice-canonical.ts");
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).not.toContain("start_practice_session_with_items");
  });
});

