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

  // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
  // pending Doc 04 rebuild. These three paths used to assert 401 from the mounted
  // /api/full-length router. With the mount gone they must reach NO handler: a
  // 404, never a 401 (which would mean some auth-guarded mount still claims them)
  // and never a 2xx.
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
  ])(
    "$method $path is unmounted (404) after the E1 exam deletion",
    async ({ method, path, body }) => {
      const req =
        method === "get"
          ? request(app).get(path)
          : request(app)
              .post(path)
              .send(body ?? {});
      const res = await req;

      expect(res.status).toBe(404);
    },
  );

  it("POST /api/practice/diagnostic/sessions requires auth (diagnostic is mounted)", async () => {
    const res = await request(app)
      .post("/api/practice/diagnostic/sessions")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
    });
  });
});

describe("Runtime cutover route coverage proof", () => {
  const indexPath = path.join(repoRoot, "server", "index.ts");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  const practiceSource = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "practice-canonical.ts"),
    "utf8",
  );

  it("keeps practice/diagnostic unlocked with no disable-contract, and full-length unmounted", () => {
    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/practice",\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*doubleCsrfProtection,\s*practiceCanonicalRouter/s,
    );
    expect(indexSource).not.toMatch(
      /runtimeContractDisableMiddleware\("practice"\)/s,
    );

    // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
    // pending Doc 04 rebuild. Previously asserted the bare /api/full-length mount;
    // now asserts no mount, no router import, and no disable middleware remain.
    expect(indexSource).not.toContain("/api/full-length");
    expect(indexSource).not.toContain("full-length-exam-routes");
    expect(indexSource).not.toContain("fullLengthExamRouter");
    expect(indexSource).not.toMatch(
      /runtimeContractDisableMiddleware\("full-length"\)/s,
    );

    // Diagnostic is mounted at /api/practice/diagnostic (Vertical B, Slice 1)
    expect(indexSource).toMatch(
      /app\.use\(\s*"\/api\/practice\/diagnostic",\s*requireSupabaseAuth,\s*requireStudentOrAdmin,\s*doubleCsrfProtection,\s*diagnosticRouter/s,
    );
    // Legacy path removed entirely — no 404 stub, no disable-contract
    expect(indexSource).not.toContain("/api/me/mastery/diagnostic");
    expect(indexSource).not.toMatch(
      /runtimeContractDisableMiddleware\("diagnostic"\)/s,
    );
  });

  it("keeps direct /api/practice routes limited to non-runtime bootstrap surfaces", () => {
    const directPracticePaths = Array.from(
      indexSource.matchAll(
        /app\.(?:get|post|put|patch|delete)\(\s*"([^"]*\/api\/practice[^"]*)"/g,
      ),
    ).map((match) => match[1]);

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

  // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
  // pending Doc 04 rebuild. Unchanged assertion (no direct app.* full-length
  // routes); the title no longer claims a mount exists.
  it("has no direct app.* /api/full-length route leaks", () => {
    const directFullLengthPaths = Array.from(
      indexSource.matchAll(
        /app\.(?:get|post|put|patch|delete)\(\s*"([^"]*\/api\/full-length[^"]*)"/g,
      ),
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
