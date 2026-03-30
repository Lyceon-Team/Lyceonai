import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

describe("Runtime cutover API enforcement", () => {
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
      body: {},
    },
    {
      method: "get",
      path: "/api/full-length/sessions/current?sessionId=11111111-1111-4111-8111-111111111111",
    },
    {
      method: "post",
      path: "/api/full-length/sessions/11111111-1111-4111-8111-111111111111/start",
      body: {},
    },
  ])("$method $path requires auth once full-length is unlocked", async ({ method, path, body }) => {
    const req = method === "get" ? request(app).get(path) : request(app).post(path).send(body ?? {});
    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
    });
  });

  it.each([
    {
      method: "post",
      path: "/api/me/mastery/diagnostic/start",
      body: {},
    },
    {
      method: "get",
      path: "/api/me/mastery/diagnostic/next?sessionId=11111111-1111-4111-8111-111111111111",
    },
    {
      method: "post",
      path: "/api/me/mastery/diagnostic/answer",
      body: {},
    },
  ])("$method $path is unmounted after diagnostic removal", async ({ method, path, body }) => {
    const req = method === "get" ? request(app).get(path) : request(app).post(path).send(body ?? {});
    const res = await req;

    expect(res.status).toBe(404);
  });
});

describe("Runtime cutover route coverage proof", () => {
  const indexPath = path.join(repoRoot, "server", "index.ts");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  const practiceSource = fs.readFileSync(path.join(repoRoot, "server", "routes", "practice-canonical.ts"), "utf8");

  it("keeps practice/full-length unlocked and keeps diagnostic terminal-404", () => {
    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/practice",\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*practiceCanonicalRouter/s
    );
    expect(indexSource).not.toMatch(/runtimeContractDisableMiddleware\("practice"\)/s);

    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/full-length",\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*fullLengthExamRouter/s
    );
    expect(indexSource).not.toMatch(/runtimeContractDisableMiddleware\("full-length"\)/s);
    expect(indexSource).toMatch(/app\.use\(\s*"\/api\/me\/mastery\/diagnostic",/s);
    expect(indexSource).toMatch(/status\(404\)/s);
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

  it("keeps full-length runtime under a single mount with no direct app.* route leaks", () => {
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
