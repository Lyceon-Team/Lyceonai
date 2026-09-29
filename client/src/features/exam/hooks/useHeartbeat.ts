/**
 * The section heartbeat — 04A §8.3, with the SCL-146 resume position.
 *
 * @spec [Doc-04A_V2.2 §8.3 ("every 5 seconds while the section UI is in the
 *        foreground"), §8.2 (lenient pause = a heartbeat gap over the threshold);
 *        SCL-146 (ordinal = resume position)]
 *       [E7b decision log D1 — owner note: this is the MECHANISM, not an optimisation]
 * @implemented [2026-09-25]
 *
 * plain English: while the tab is visible, beat every 5 s with the ordinal on
 * screen; beat at once when the ordinal changes or the tab becomes visible again.
 * While the tab is HIDDEN, send NOTHING.
 *
 * DO NOT "fix" this into a background timer. Under practice (lenient) timing the
 * server detects a pause as a gap between heartbeats longer than 15 s and adds that
 * gap back to the module's time (04A §8.2/§8.3). A heartbeat sent from a hidden tab
 * tells the server the student is still working, so their clock would run while
 * they are away. Under test-day (strict) timing the server ignores the gap, so
 * nothing is lost either way — the silence matters only for lenient, and there it
 * is the whole feature.
 */
import { useEffect, useRef } from "react";
import type { ExamSection } from "@lyceon/shared/exam-runtime-schema";
import {
  sendExamHeartbeat,
  type ExamSectionStateResponse,
} from "../api/exam-api";

export const HEARTBEAT_INTERVAL_MS = 5_000;

export function useHeartbeat(options: {
  sessionId: string;
  section: ExamSection;
  ordinal: number | null;
  enabled: boolean;
  onSectionState: (state: ExamSectionStateResponse) => void;
  onError: (error: unknown) => void;
}): void {
  const { sessionId, section, ordinal, enabled } = options;
  const handlers = useRef(options);
  handlers.current = options;
  const ordinalRef = useRef(ordinal);
  ordinalRef.current = ordinal;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;

    const beat = () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== "visible") return; // see the module note
      inFlight = true;
      sendExamHeartbeat(sessionId, section, ordinalRef.current)
        .then((res) => {
          if (!cancelled) handlers.current.onSectionState(res.section_state);
        })
        .catch((error: unknown) => {
          if (!cancelled) handlers.current.onError(error);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    beat();
    const id = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId, section, enabled]);

  // A new position is reported at once, so a reload lands on it (SCL-146).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled || ordinal === null || document.visibilityState !== "visible") return;
    sendExamHeartbeat(sessionId, section, ordinal)
      .then((res) => handlers.current.onSectionState(res.section_state))
      .catch((error: unknown) => handlers.current.onError(error));
  }, [ordinal, sessionId, section, enabled]);
}
