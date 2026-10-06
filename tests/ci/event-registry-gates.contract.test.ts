/**
 * @spec [Doc 07A V1.0 §11.1 (parity sub-checks a/b/c, hard-fail), §11.2 (conformance sub-checks
 *       a/b/c, hard-fail), §8.1.2 (hash_server_local is proof-artifact only); SCL-201 IS 2]
 *       | @implemented [2026-10-05]
 *
 * plain English: the two gates' check functions, fed the REAL registry (which must pass) and then
 * one deliberate defect at a time (each of which must fail, naming the defect). The real-registry
 * case is derived from the file the gates read, so a passing case is evidence about the registry
 * that ships, not about a fixture.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  eventRegistrySchema,
  type EventRegistry,
} from "../../packages/shared/src/event-registry-schema";
import {
  checkParity,
  checkPiiConformance,
  findEmitSites,
  type SourceFile,
} from "../../scripts/ci/lib/event-registry-checks";

function realRegistry(): EventRegistry {
  return eventRegistrySchema.parse(
    parse(readFileSync("infra/event-schema-registry.yaml", "utf-8")),
  );
}

const CLEAN_SOURCES: SourceFile[] = [
  {
    path: "server/lib/analytics/emit-event.ts",
    text: 'import { PostHog } from "posthog-node";\nexport function emitEvent() {}',
  },
  {
    path: "client/src/lib/analytics/posthog-client.ts",
    text: 'import type { PostHog } from "posthog-js";\nconst m = import("posthog-js");',
  },
  {
    path: "server/routes/x.ts",
    text: 'await emitEvent(user.id, "user_signed_in", {});\nawait emitEvent(\n  id,\n  "user_signed_out",\n  { signout_trigger: "explicit" },\n);',
  },
];

function withSource(text: string, path = "server/routes/y.ts"): SourceFile[] {
  return [...CLEAN_SOURCES, { path, text }];
}

describe("ci/event-schema-registry-parity", () => {
  it("passes the shipped registry with clean sources (presence first)", () => {
    const report = checkParity(realRegistry(), CLEAN_SOURCES);
    expect(report.codeEmittedEvents).toEqual([
      "user_signed_in",
      "user_signed_out",
    ]);
    expect(report.failures).toEqual([]);
    // SCL-213's seven, plus consent_captured (registered 2026-10-05 for the marketing opt-in, Q5).
    expect(report.tier_distribution).toEqual({ strict: 8, loose: 0 });
  });

  it("(a) fails an unregistered event name", () => {
    const report = checkParity(
      realRegistry(),
      withSource('await emitEvent(id, "practice_question_submitted", {});'),
    );
    expect(report.unregistered_events_detected).toEqual([
      "practice_question_submitted",
    ]);
    expect(report.failures.join("\n")).toMatch(/practice_question_submitted/);
  });

  it("(a) fails a non-literal event name it cannot verify", () => {
    const report = checkParity(
      realRegistry(),
      withSource("await emitEvent(id, name, {});"),
    );
    expect(report.failures.join("\n")).toMatch(/not a string literal/);
  });

  it("(a) reads the name through emitEventWith's extra argument", () => {
    const sites = findEmitSites([
      { path: "a.ts", text: 'emitEventWith(deps, id, "exam_started", {})' },
    ]);
    expect(sites.map((s) => s.eventName)).toEqual(["exam_started"]);
  });

  it.each([
    ['import { PostHog } from "posthog-node";', "posthog-node"],
    ['import posthog from "posthog-js";', "posthog-js"],
    ['const p = await import("posthog-js");', "posthog-js"],
    ['import "posthog-js/dist/recorder";', "posthog-js"],
    ['const p = require("posthog-node");', "posthog-node"],
  ])(
    "(b) fails a PostHog SDK import outside the permitted module: %s",
    (line, sdk) => {
      const report = checkParity(
        realRegistry(),
        withSource(line, "client/src/pages/home.tsx"),
      );
      expect(report.failures.join("\n")).toMatch(
        new RegExp(`home\\.tsx:1 imports ${sdk}`),
      );
    },
  );

  it("(c) fails a property with no redaction key", () => {
    const registry = realRegistry();
    const entry = registry.events.find(
      (e) => e.event_name === "user_signed_out",
    );
    if (!entry)
      throw new Error("fixture: user_signed_out missing from the registry");
    delete entry.pii_redaction["signout_trigger"];
    const report = checkParity(registry, CLEAN_SOURCES);
    expect(report.unredacted_property_count).toBe(1);
    expect(report.failures.join("\n")).toMatch(
      /user_signed_out.*pii_redaction keys/,
    );
  });

  it("(c) fails a redaction key for no property", () => {
    const registry = realRegistry();
    const entry = registry.events.find(
      (e) => e.event_name === "user_signed_in",
    );
    if (!entry)
      throw new Error("fixture: user_signed_in missing from the registry");
    entry.pii_redaction["email"] = "drop";
    expect(checkParity(registry, CLEAN_SOURCES).failures.join("\n")).toMatch(
      /user_signed_in.*pii_redaction keys/,
    );
  });

  it("(c) fails a strict entry that allows extra properties", () => {
    const registry = realRegistry();
    const entry = registry.events.find((e) => e.event_name === "exam_started");
    if (!entry?.json_schema)
      throw new Error("fixture: exam_started schema missing");
    entry.json_schema["additionalProperties"] = true;
    expect(checkParity(registry, CLEAN_SOURCES).failures.join("\n")).toMatch(
      /exam_started.*additionalProperties/,
    );
  });
});

describe("ci/pii-redaction-conformance", () => {
  it("passes the shipped registry at 100% coverage", () => {
    const report = checkPiiConformance(realRegistry());
    expect(report.failures).toEqual([]);
    expect(report.posture_coverage_percent).toBe(100);
  });

  it("fails hash_server_local as a runtime posture, by name", () => {
    const registry = realRegistry();
    const entry = registry.events[0];
    if (!entry) throw new Error("fixture: empty registry");
    entry.pii_redaction["analytics_user_id"] = "hash_server_local";
    expect(checkPiiConformance(registry).failures.join("\n")).toMatch(
      /hash_server_local/,
    );
  });

  it("fails an unknown method", () => {
    const registry = realRegistry();
    const entry = registry.events[0];
    if (!entry) throw new Error("fixture: empty registry");
    entry.pii_redaction["timestamp"] = "obfuscate";
    expect(checkPiiConformance(registry).failures.join("\n")).toMatch(
      /unknown redaction method/,
    );
  });

  it("fails a missing posture (orphan property)", () => {
    const registry = realRegistry();
    const entry = registry.events[0];
    if (!entry) throw new Error("fixture: empty registry");
    delete entry.pii_redaction["timestamp"];
    const report = checkPiiConformance(registry);
    expect(report.posture_coverage_percent).toBeLessThan(100);
    expect(report.orphan_properties.join("\n")).toMatch(
      /timestamp \(no posture\)/,
    );
  });

  it.each([
    "email_hash",
    "guardian_email",
    "phone",
    "display_name",
    "user_id",
    "ip_address",
  ])(
    "fails a forbidden identifier type as a property (%s), whatever its posture",
    (prop) => {
      const registry = realRegistry();
      const entry = registry.events.find(
        (e) => e.event_name === "user_signed_in",
      );
      const props = entry?.json_schema?.["properties"];
      if (!entry || typeof props !== "object" || props === null) {
        throw new Error("fixture: user_signed_in schema missing");
      }
      (props as Record<string, unknown>)[prop] = { type: "string" };
      entry.pii_redaction[prop] = "opaque_id_only";
      expect(
        checkPiiConformance(registry).forbidden_identifier_types_detected,
      ).toEqual([`user_signed_in.${prop}`]);
    },
  );

  it("does not mistake event_name or analytics_user_id for forbidden identifiers", () => {
    expect(
      checkPiiConformance(realRegistry()).forbidden_identifier_types_detected,
    ).toEqual([]);
  });
});
