import { describe, expect, it } from "vitest";
import { cookieDomainForHost } from "../../server/lib/supabase-ssr";

/**
 * @spec [AUTH-001 native @supabase/ssr session | Doc-01_V8 §6 Authentication stack]
 * Regression guard for the preview-breaking cookie domain. A hardcoded `Domain=.lyceon.ai` is
 * rejected by the browser on any non-lyceon.ai host (every Vercel preview *.vercel.app, localhost),
 * silently dropping the session cookie → getUser() finds nothing → /api/profile 401. The session
 * cookie must be host-scoped (no Domain) off lyceon.ai, and only share apex/www WHEN on lyceon.ai.
 */
describe("cookieDomainForHost (session cookie domain)", () => {
  it("shares apex+www only when served under lyceon.ai", () => {
    expect(cookieDomainForHost("lyceon.ai")).toBe(".lyceon.ai");
    expect(cookieDomainForHost("www.lyceon.ai")).toBe(".lyceon.ai");
    expect(cookieDomainForHost("lyceon.ai:443")).toBe(".lyceon.ai");
    expect(cookieDomainForHost("LYCEON.AI")).toBe(".lyceon.ai");
  });

  it("is host-scoped (no Domain) on Vercel previews and localhost", () => {
    expect(
      cookieDomainForHost(
        "lyceonai-git-claude-determined-2563ac-aivalorinc-4377s-projects.vercel.app",
      ),
    ).toBeUndefined();
    expect(cookieDomainForHost("localhost:5173")).toBeUndefined();
    expect(cookieDomainForHost(undefined)).toBeUndefined();
  });

  it("does not match look-alike hosts that merely contain lyceon.ai", () => {
    // Suffix match must be on a dot boundary — never on an attacker-style sibling domain.
    expect(cookieDomainForHost("notlyceon.ai")).toBeUndefined();
    expect(cookieDomainForHost("lyceon.ai.evil.com")).toBeUndefined();
  });
});
