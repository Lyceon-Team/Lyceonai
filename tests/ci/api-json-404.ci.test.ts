/**
 * Unknown `/api` routes answer the API's JSON 404 for every method (F-42).
 *
 * @spec [Coding Standards §8.2, §8.3; student-ui register F-42, owner ruling 2026-10-01] |
 *   @implemented [2026-10-01] |
 * plain English: production answered `POST /api/<deleted route>` with Express's default HTML
 * page (`<pre>Cannot POST …</pre>`), while a GET to the same kind of path got the API's JSON
 * 404. A client that parses JSON got HTML. This drives the real app: every method on an
 * unmatched `/api` path gets 404 with `{ error: "API endpoint not found" }` and a JSON content
 * type, and a non-`/api` GET still reaches the SPA fallback (`app.html` — the shell since SEO F1,
 * 2026-10-03, when `index.html` became the prerendered homepage), while an `/api` GET
 * never does.
 *
 * Presence first: a live `/api` route still answers 200, so the catch-all cannot pass by
 * swallowing the API. `res.sendFile` is stubbed so the SPA case needs no built client.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupSecurityMocks } from "../utils/securityTestUtils";

setupSecurityMocks();

process.env.NODE_ENV = "test";

const { default: app } = await import("../../server/index");

const API_FALLBACK_BODY = { error: "API endpoint not found" };
const UNKNOWN = "/api/__no_such_route__/x";

describe("unknown /api routes answer JSON 404 whatever the method (F-42)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("presence: a live /api route still answers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it.each(["get", "post", "put", "patch", "delete"] as const)(
    "%s on an unknown /api path -> 404 JSON",
    async (method) => {
      const agent = request(app);
      const res = await agent[method](UNKNOWN)
        .set("Content-Type", "application/json")
        .send(method === "get" || method === "delete" ? undefined : {});
      expect(res.status).toBe(404);
      expect(res.headers["content-type"] ?? "").toContain("application/json");
      expect(res.body).toEqual(API_FALLBACK_BODY);
    },
  );

  it("the bare /api path is covered too", async () => {
    const res = await request(app).post("/api");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(API_FALLBACK_BODY);
  });

  it("a non-/api GET still reaches the SPA fallback; an /api GET never does", async () => {
    const sent: string[] = [];
    vi.spyOn(express.response, "sendFile").mockImplementation(function (
      this: express.Response,
      filePath: string,
    ) {
      sent.push(filePath);
      this.status(200).type("html").send("<!doctype html><div id=root></div>");
    } as unknown as typeof express.response.sendFile);

    const spa = await request(app).get("/dashboard/some/client/route");
    expect(spa.status).toBe(200);
    expect(spa.text).toContain("<div id=root>");
    expect(sent.some((f) => f.endsWith("app.html"))).toBe(true);

    sent.length = 0;
    const api = await request(app).get(UNKNOWN);
    expect(api.status).toBe(404);
    expect(api.body).toEqual(API_FALLBACK_BODY);
    expect(sent).toEqual([]);
  });
});
