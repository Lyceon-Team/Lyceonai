/**
 * @spec [Doc-05A §11; owner ruling Q1 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: proves the once-only diagnostic rule over every input shape that
 * matters, including the two-row shape production holds today.
 *
 * expected outcome: completed is terminal and wins over in-flight; abandoned does
 * NOT spend the diagnostic.
 *
 * The fixtures are chosen so each assertion can fail independently — a single
 * "completed session" fixture would satisfy the ordering test and the terminal
 * test at once, and could not tell them apart.
 */
import { describe, expect, it } from "vitest";
import {
  resolveDiagnosticStartDecision,
  type PriorDiagnosticSession,
} from "../diagnostic-eligibility.js";

const S = (id: string, status: string): PriorDiagnosticSession => ({
  id,
  status,
});

describe("resolveDiagnosticStartDecision", () => {
  it("allows a student with no diagnostic history", () => {
    expect(resolveDiagnosticStartDecision([])).toEqual({ kind: "allow" });
  });

  it("resumes an ACTIVE diagnostic rather than starting a second", () => {
    expect(resolveDiagnosticStartDecision([S("a", "active")])).toEqual({
      kind: "resume",
      sessionId: "a",
    });
  });

  it("resumes a CREATED diagnostic that never progressed", () => {
    expect(resolveDiagnosticStartDecision([S("c", "created")])).toEqual({
      kind: "resume",
      sessionId: "c",
    });
  });

  it("REFUSES when one is already completed — there is no retake", () => {
    expect(resolveDiagnosticStartDecision([S("done", "completed")])).toEqual({
      kind: "already_completed",
    });
  });

  it("does NOT spend the diagnostic on abandonment (ruling Q1)", () => {
    // A student who closed their laptop at question 3 must not be permanently
    // baseline-less. Abandoned falls through to allow.
    expect(resolveDiagnosticStartDecision([S("gone", "abandoned")])).toEqual({
      kind: "allow",
    });
  });

  it("still allows after SEVERAL abandoned attempts", () => {
    expect(
      resolveDiagnosticStartDecision([
        S("g1", "abandoned"),
        S("g2", "abandoned"),
        S("g3", "abandoned"),
      ]),
    ).toEqual({ kind: "allow" });
  });

  it("completed WINS over in-flight — production's exact current shape", () => {
    // 86b0dc8f completed 40/40 on 2026-08-15; 18187611 active 7/40 on 2026-08-17.
    // Answering `resume` here would invite the student to finish a second
    // diagnostic, which the once-only rule forbids and the partial unique index
    // would reject at completion time.
    expect(
      resolveDiagnosticStartDecision([
        S("18187611", "active"),
        S("86b0dc8f", "completed"),
      ]),
    ).toEqual({ kind: "already_completed" });
  });

  it("completed wins regardless of argument order", () => {
    expect(
      resolveDiagnosticStartDecision([
        S("86b0dc8f", "completed"),
        S("18187611", "active"),
      ]),
    ).toEqual({ kind: "already_completed" });
  });

  it("ignores an unrecognized status rather than treating it as spent", () => {
    expect(resolveDiagnosticStartDecision([S("weird", "paused")])).toEqual({
      kind: "allow",
    });
  });
});
