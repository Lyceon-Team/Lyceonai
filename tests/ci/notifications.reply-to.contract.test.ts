/**
 * @spec [owner brief 2026-09-16 Part A (Reply-To on transactional mail, derived from the shared
 *        constant) and Part B (no support/privacy literal outside the constant);
 *        contracts/notifications.contract.md §0.2 (one module talks to Resend), §12]
 *        | @implemented [2026-09-16]
 *
 * plain English: two gates. (1) Every send through the one Resend transport carries
 * `reply_to`, and its value is DERIVED from packages/shared/src/support-contact.ts — proven by
 * swapping the constant (module mock) and watching the header follow it, not by comparing two
 * copies of the same string. (2) No `support@`, `privacy@`, `legal@`, `hello@` or `contact@`
 * lyceon.ai literal survives anywhere in client/, server/, packages/ or apps/ outside the
 * constant file, so the mailbox can move with one edit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

type Captured = {
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function fakeFetch(captured: Captured[]): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "re_reply_to_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const ENV = {
  RESEND_API_KEY: "re_test",
  NOTIFICATION_FROM_EMAIL: "notifications@send.example.test",
} as NodeJS.ProcessEnv;

const SEND = {
  idempotencyKey: "reply-to-test",
  to: "parent@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
};

describe("Reply-To on transactional mail (Part A)", () => {
  afterEach(() => {
    vi.doUnmock("../../packages/shared/src/support-contact");
    vi.resetModules();
  });

  it("every send carries reply_to = SUPPORT_EMAIL, alongside the unchanged body fields", async () => {
    vi.resetModules();
    const { createResendTransport } =
      await import("../../server/lib/notifications/transport");
    const { SUPPORT_EMAIL } =
      await import("../../packages/shared/src/support-contact");
    const captured: Captured[] = [];
    const transport = createResendTransport({
      fetchImpl: fakeFetch(captured),
      env: ENV,
    });
    const result = await transport(SEND);
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.reply_to).toBe(SUPPORT_EMAIL);
    expect(captured[0]!.body.reply_to).toBe("support@lyceon.ai");
    expect(Object.keys(captured[0]!.body).sort()).toEqual([
      "from",
      "html",
      "reply_to",
      "subject",
      "text",
      "to",
    ]);
    // Still no tracking option and no tags (contract §12.3).
    expect(captured[0]!.body).not.toHaveProperty("tags");
    expect(captured[0]!.body).not.toHaveProperty("headers");
  });

  it("the header is DERIVED from the shared constant: change the constant, the header changes", async () => {
    vi.resetModules();
    vi.doMock("../../packages/shared/src/support-contact", () => ({
      SUPPORT_EMAIL: "moved-support@example.test",
      PRIVACY_EMAIL: "moved-privacy@example.test",
    }));
    const { createResendTransport } =
      await import("../../server/lib/notifications/transport");
    const captured: Captured[] = [];
    const transport = createResendTransport({
      fetchImpl: fakeFetch(captured),
      env: ENV,
    });
    await transport(SEND);
    expect(captured[0]!.body.reply_to).toBe("moved-support@example.test");
    expect(captured[0]!.body.reply_to).not.toBe("support@lyceon.ai");
  });
});

describe("no support/privacy literal outside the shared constant (Part B)", () => {
  it("client/, server/, packages/ and apps/ carry no *@lyceon.ai contact literal except in support-contact.ts", () => {
    const root = path.resolve(__dirname, "../..");
    // git grep over tracked source, so a literal cannot hide in a generated bundle. Exit 1
    // means "no matches" — the pass; exit 0 means matches — the failure, with the lines.
    const matches = ((): string => {
      try {
        return execFileSync(
          "git",
          [
            "grep",
            "-nE",
            "(support|privacy|legal|hello|contact)@lyceon\\.ai",
            "--",
            "client",
            "server",
            "packages",
            "apps",
            ":!packages/shared/src/support-contact.ts",
          ],
          { cwd: root, encoding: "utf8" },
        );
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 1) throw e;
        return "";
      }
    })();
    expect(
      matches,
      `contact literals outside the shared constant:\n${matches}`,
    ).toBe("");
  });
});

describe("per-surface mapping (Part B): privacy copy → PRIVACY_EMAIL, everything else → SUPPORT_EMAIL", () => {
  it("the rendered SEO pages carry the address their surface owns, and never the other one", async () => {
    vi.resetModules();
    const { getPublicPageSeo } = await import("../../server/seo-content");
    const { SUPPORT_EMAIL, PRIVACY_EMAIL } =
      await import("../../packages/shared/src/support-contact");
    const html = (route: string): string => {
      const page = getPublicPageSeo(route);
      expect(page, `no SEO page for ${route}`).not.toBeNull();
      return JSON.stringify(page);
    };
    // Privacy Policy: data-rights and contact both go to privacy@, never support@.
    const privacy = html("/legal/privacy-policy");
    expect(privacy).toContain(PRIVACY_EMAIL);
    expect(privacy).not.toContain(SUPPORT_EMAIL);
    // Terms of Use and the Legal & Trust hub: support@, never privacy@.
    for (const route of ["/legal/student-terms", "/legal"]) {
      const page = html(route);
      expect(page, route).toContain(SUPPORT_EMAIL);
      expect(page, route).not.toContain(PRIVACY_EMAIL);
    }
    // No page anywhere still points at the mailboxes that do not exist.
    for (const route of [
      "/legal/privacy-policy",
      "/legal/student-terms",
      "/legal",
    ]) {
      expect(html(route)).not.toMatch(/(legal|hello|contact)@lyceon\\.ai/);
    }
  });
});
