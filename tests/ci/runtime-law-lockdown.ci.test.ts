import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

describe("Runtime law lockdown API enforcement", () => {
  let app: any;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  it.each([
    {
      method: "post",
      path: "/api/full-length/sessions",
      code: "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
      body: {},
    },
    {
      method: "get",
      path: "/api/full-length/sessions/current?sessionId=11111111-1111-4111-8111-111111111111",
      code: "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
    },
    {
      method: "post",
      path: "/api/full-length/sessions/11111111-1111-4111-8111-111111111111/start",
      code: "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
      body: {},
    },
    {
      method: "post",
      path: "/api/me/mastery/diagnostic/start",
      code: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
      body: {},
    },
    {
      method: "get",
      path: "/api/me/mastery/diagnostic/next?sessionId=11111111-1111-4111-8111-111111111111",
      code: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
    },
    {
      method: "post",
      path: "/api/me/mastery/diagnostic/answer",
      code: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
      body: {},
    },
  ])("$method $path returns terminal 503 contract-disable", async ({ method, path, code, body }) => {
    const req = method === "get" ? request(app).get(path) : request(app).post(path).send(body ?? {});
    const res = await req;

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code,
      message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
    });
    expect(typeof res.body.requestId).toBe("string");
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });
});

describe("Runtime law lockdown route coverage proof", () => {
  const indexPath = path.join(repoRoot, "server", "index.ts");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  const practiceSource = fs.readFileSync(path.join(repoRoot, "server", "routes", "practice-canonical.ts"), "utf8");

  it("keeps full-length/diagnostic guarded mounts in server/index.ts and leaves practice unlocked", () => {
    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/practice",\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*practiceCanonicalRouter/s
    );
    expect(indexSource).not.toMatch(/runtimeContractDisableMiddleware\("practice"\)/s);

    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/full-length",\s*runtimeContractDisableMiddleware\("full-length"\),\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*fullLengthExamRouter/s
    );
    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/me\/mastery\/diagnostic",\s*runtimeContractDisableMiddleware\("diagnostic"\),/s
    );
  });


  it("keeps direct /api/practice routes limited to non-runtime bootstrap surfaces", () => {
    const directPracticePaths = Array.from(indexSource.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*"([^"]*\/api\/practice[^"]*)"/g))
      .map((match) => match[1]);

    const allowedDirectPaths = new Set<string>([
      "/api/practice/topics",
      "/api/practice/reference/questions",
    ]);

    for (const pathName of directPracticePaths) {
      expect(allowedDirectPaths.has(pathName)).toBe(true);
    }
  });

  it("removes overlapping legacy practice runtime compatibility paths after unlock", () => {
    expect(practiceSource).not.toMatch(/router\.get\(\s*"\/next"/s);
  });

  it("keeps full-length runtime under a single guarded mount with no direct app.* route leaks", () => {
    const directFullLengthPaths = Array.from(
      indexSource.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*"([^"]*\/api\/full-length[^"]*)"/g)
    ).map((match) => match[1]);

    expect(directFullLengthPaths).toEqual([]);
  });


  it("ships all required contract docs", () => {
    const requiredDocs = [
      path.join(repoRoot, "docs", "contracts", "runtime-law.md"),
      path.join(repoRoot, "docs", "contracts", "practice-contract.md"),
      path.join(repoRoot, "docs", "contracts", "full-length-contract.md"),
      path.join(repoRoot, "docs", "contracts", "review-contract.md"),
    ];

    for (const docPath of requiredDocs) {
      expect(fs.existsSync(docPath)).toBe(true);
    }
  });
});
