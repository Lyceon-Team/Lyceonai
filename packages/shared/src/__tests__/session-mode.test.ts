/**
 * @spec [Doc-02B_V4 §14; Doc-05A §11] | @implemented [2026-08-17]
 *
 * plain English: proves the practice-mode enum refuses the two values that
 * matter. `diagnostic` is the integrity case — it decides event_source_kind, so
 * accepting it from a request body lets a client classify its own activity in
 * the mastery record and bypass the diagnostic route's once-only guard. `flow`
 * is the Q7 case — blocked at the boundary while staying valid in the DB CHECK.
 *
 * expected outcome: three accepted modes, everything else rejected.
 *
 * edge cases: casing and whitespace are NOT normalized. The old code did
 * String(...).trim(), which would have turned " balanced " into a valid mode;
 * z.enum does not, and that is deliberate — a client sending untrimmed input is
 * a client bug worth surfacing, not one worth silently absorbing.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_SESSION_MODE,
  DIAGNOSTIC_SESSION_MODE,
  practiceSessionModeSchema,
  SESSION_MODES_DB,
  sessionModeSchema,
} from "../session-mode.js";

describe("practiceSessionModeSchema", () => {
  it("accepts exactly the three client-selectable practice modes", () => {
    for (const mode of ["structured", "balanced", "timed"]) {
      expect(practiceSessionModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it("REJECTS diagnostic — a client must not classify its own mastery events", () => {
    expect(practiceSessionModeSchema.safeParse("diagnostic").success).toBe(
      false,
    );
  });

  it("REJECTS flow — blocked at the boundary, kept in the DB CHECK (Q7)", () => {
    expect(practiceSessionModeSchema.safeParse("flow").success).toBe(false);
  });

  it("rejects arbitrary strings the old z.string().max(64) would have accepted", () => {
    for (const bad of ["", "bogus", "Balanced", " balanced ", "diagnostic "]) {
      expect(practiceSessionModeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("its default is one of the accepted values", () => {
    expect(
      practiceSessionModeSchema.safeParse(DEFAULT_PRACTICE_SESSION_MODE)
        .success,
    ).toBe(true);
  });
});

describe("SESSION_MODES_DB", () => {
  it("still lists flow — eight production rows depend on the CHECK accepting it", () => {
    expect(SESSION_MODES_DB).toContain("flow");
  });

  it("is a strict superset of the client-selectable modes", () => {
    for (const mode of ["structured", "balanced", "timed"]) {
      expect(SESSION_MODES_DB).toContain(mode);
    }
    // strict: the DB accepts values the client cannot request
    expect(SESSION_MODES_DB.length).toBeGreaterThan(3);
  });

  it("accepts diagnostic at the DB layer even though the client cannot request it", () => {
    expect(sessionModeSchema.safeParse(DIAGNOSTIC_SESSION_MODE).success).toBe(
      true,
    );
    expect(
      practiceSessionModeSchema.safeParse(DIAGNOSTIC_SESSION_MODE).success,
    ).toBe(false);
  });
});
