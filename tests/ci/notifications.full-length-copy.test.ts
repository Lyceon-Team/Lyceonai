/**
 * The two full-length notices' student copy, rendered through the real registry.
 *
 * @spec [contracts/notifications.contract.md §2.3, §8; owner ruling OQ-62 (b), Karl,
 *        2026-10-05: "'full-length test' wording, with grep proof."] | @implemented [2026-10-05]
 *
 * plain English: renders `full_length_week` and `full_length_tomorrow` in-app and by email via
 * `renderInApp` / `renderEmail` (the same entry points dispatch uses, payload parsed against the
 * strict schema) and asserts every rendered line names the sitting "full-length test". Expected
 * outcome: the student reads "You have a full-length test this week" / "Your full-length test
 * is tomorrow", and no rendered field says "practice test", "full test", or a bare "test" that
 * is not "full-length test".
 *
 * trade-offs: the assertion is over every rendered string field (title, body, subject, text,
 * html), so a regression in any one channel reddens it, not just the one a reviewer looks at.
 *
 * edge cases: presence before absence — each render must be ok and carry the full-length
 * wording before the absence checks run, so an empty render cannot pass them.
 */
import { describe, expect, it } from "vitest";
import {
  renderEmail,
  renderInApp,
  type RenderContext,
} from "../../server/lib/notifications/templates";

const PAYLOAD = {
  block_id: "6f1c1f0e-5d2a-4b1e-9a43-2c7d8e9f0a1b",
  local_date: "2026-10-17",
} as const;

const CTX: RenderContext = {
  recipientIsSubject: true,
  siteUrl: "https://lyceon.example",
};

type Kind = "full_length_week" | "full_length_tomorrow";

function renderedStrings(kind: Kind): Record<string, string> {
  const inApp = renderInApp(kind, PAYLOAD, CTX);
  const email = renderEmail(kind, PAYLOAD, CTX);
  if (!inApp.ok) throw new Error(`in-app render failed: ${inApp.error}`);
  if (!email.ok) throw new Error(`email render failed: ${email.error}`);
  return {
    "in-app title": inApp.value.title,
    "in-app body": inApp.value.body,
    "email subject": email.value.subject,
    "email text": email.value.text,
    "email html": email.value.html,
  };
}

describe("OQ-62 (b): the full-length notices say 'full-length test'", () => {
  it("full_length_week: titles and the email's lead line", () => {
    const s = renderedStrings("full_length_week");
    expect(s["in-app title"]).toBe("You have a full-length test this week");
    expect(s["email subject"]).toBe("You have a full-length test this week");
    expect(s["in-app body"]).toBe(
      "It's on Saturday 17 October. A full-length test takes about three hours, so it helps to know now.",
    );
    expect(s["email text"]).toContain(
      "You have a full-length test this week, on Saturday 17 October.",
    );
    expect(s["email text"]).toContain(
      "A full-length test takes about three hours, so it helps to know now.",
    );
    expect(s["email html"]).toContain(
      "<p>You have a full-length test this week, on <strong>Saturday 17 October</strong>.</p>",
    );
    expect(s["email html"]).toContain(
      "<p>A full-length test takes about three hours, so it helps to know now.</p>",
    );
  });

  it("full_length_tomorrow: titles and the email's lead line", () => {
    const s = renderedStrings("full_length_tomorrow");
    expect(s["in-app title"]).toBe("Your full-length test is tomorrow");
    expect(s["email subject"]).toBe("Your full-length test is tomorrow");
    expect(s["email text"]).toContain(
      "Your full-length test is tomorrow, Saturday 17 October.",
    );
    expect(s["email html"]).toContain(
      "<p>Your full-length test is tomorrow, <strong>Saturday 17 October</strong>.</p>",
    );
  });

  it.each(["full_length_week", "full_length_tomorrow"] as const)(
    "%s: no rendered field says 'practice test', 'full test' or a bare 'test'",
    (kind) => {
      const s = renderedStrings(kind);
      for (const [field, value] of Object.entries(s)) {
        // Presence first: the field is non-trivial and names the sitting the ruled way.
        expect(value.length, field).toBeGreaterThan(0);
        if (field !== "in-app body" || kind === "full_length_week") {
          expect(value, field).toMatch(/\bfull-length test\b/i);
        }
        expect(value, field).not.toMatch(/\bpractice tests?\b/i);
        expect(value, field).not.toMatch(/\bfull tests?\b/i);
        // Every whole-token "test(s)" is the tail of "full-length test(s)".
        const tests = value.match(/\btests?\b/gi) ?? [];
        const fullLength = value.match(/\bfull-length tests?\b/gi) ?? [];
        expect(tests.length, field).toBe(fullLength.length);
      }
    },
  );
});
