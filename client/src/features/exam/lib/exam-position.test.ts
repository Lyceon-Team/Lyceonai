/**
 * @spec [Doc-04A_V2.2 §5, §12, §15.1; E7b plant "a submitted module can't be
 *        re-entered by URL"] | @implemented [2026-09-25]
 */
import { describe, expect, it } from "vitest";
import type { ExamSessionResponse } from "@lyceon/shared/exam-runtime-schema";
import {
  examPosition,
  parseModuleRoute,
  pathForPosition,
  routeMatchesPosition,
} from "./exam-position";

const SID = "11111111-1111-4111-8111-111111111111";

function session(
  state: ExamSessionResponse["state"],
  active: "RW" | "M" | null,
  rw: ExamSessionResponse["sections"][number]["state"],
  m: ExamSessionResponse["sections"][number]["state"] = "not_started",
): ExamSessionResponse {
  const sec = (section: "RW" | "M", s: typeof rw) => ({
    section,
    state: s,
    remaining_ms: null,
    module2_path_locked: false,
    current_ordinal: null,
  });
  return {
    session_id: SID,
    test_form_id: "22222222-2222-4222-8222-222222222222",
    state,
    mode: "strict",
    active_section: active,
    grace_expires_at: "2026-09-26T00:00:00Z",
    attempt_number_for_form: 1,
    is_first_seen_form_attempt: true,
    break_remaining_ms: null,
    sections: [sec("RW", rw), sec("M", m)],
  };
}

describe("examPosition", () => {
  it("maps every session shape to one position", () => {
    expect(examPosition(session("created", null, "not_started"))).toEqual({ kind: "not_started" });
    expect(examPosition(session("active", "RW", "module1_active"))).toEqual({ kind: "module", section: "RW", module: "1" });
    expect(examPosition(session("active", "RW", "module1_submitted"))).toEqual({ kind: "module2_ready", section: "RW" });
    expect(examPosition(session("active", "RW", "module2_active"))).toEqual({ kind: "module", section: "RW", module: "2" });
    expect(examPosition(session("section_break", null, "submitted"))).toEqual({ kind: "break" });
    expect(examPosition(session("active", "M", "submitted", "module2_active"))).toEqual({ kind: "module", section: "M", module: "2" });
    for (const s of ["completed", "abandoned_final", "partial_scored_abandoned"] as const) {
      expect(examPosition(session(s, null, "submitted", "submitted"))).toEqual({ kind: "finished" });
    }
  });

  it("PLANT: a submitted module's URL never matches; the shell goes where the server says", () => {
    const now = examPosition(session("active", "RW", "module2_active"));
    const typed = parseModuleRoute("RW", "1")!;
    expect(routeMatchesPosition(typed, now)).toBe(false);
    expect(pathForPosition(SID, now)).toBe(`/tests/${SID}/RW/2`);
    const done = examPosition(session("completed", null, "submitted", "submitted"));
    expect(routeMatchesPosition(parseModuleRoute("M", "2")!, done)).toBe(false);
    expect(pathForPosition(SID, done)).toBe(`/tests/${SID}/report`);
  });

  it("no URL names a routed path: 2A/2B do not parse", () => {
    expect(parseModuleRoute("RW", "2A")).toBeNull();
    expect(parseModuleRoute("M", "2B")).toBeNull();
    expect(parseModuleRoute("X", "1")).toBeNull();
  });
});
