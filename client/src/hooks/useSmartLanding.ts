/**
 * Smart landing on Home: ask the server where this app open lands, report a quick return Home,
 * and start "5 more".
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26); Karl's rulings on Step 0 (A: the default
 *        entry; D: device_class from the client breakpoints, validated on the server)]
 *        | @implemented [2026-10-26]
 *
 * plain English: `useSmartLanding` runs once when Home mounts for a STUDENT.
 *   - If a landing was shown earlier in this page load, this mount is a return to Home: the
 *     server is told (`/escape`) and decides by its own clock whether it was within 30 s.
 *   - Else, if this mount is a default entry, it asks `/open` with the coarse device class and
 *     this browser's instance id, and replaces Home with the landing's route when there is one.
 *     Until the answer comes, Home shows its loading state, so there is no flash of Home first.
 * Every failure leaves the student on Home; the landing is never in the way.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  deviceClassForWidth,
  landingMoreResponseSchema,
  landingOpenResponseSchema,
  type LandingMoreResponse,
  type LandingOpenResponse,
} from "@lyceon/shared/smart-landing-schema";
import { apiRequest } from "@/lib/queryClient";
import { getClientInstanceId } from "@/lib/client-instance";
import {
  consumeDefaultEntry,
  rememberLandingShow,
  takeLandingShow,
} from "@/lib/landing-entry";

function dataOf(body: unknown): unknown {
  return body !== null && typeof body === "object" && "data" in body
    ? body.data
    : undefined;
}

async function postOpen(): Promise<LandingOpenResponse> {
  const response = await apiRequest("/api/landing/open", {
    method: "POST",
    body: JSON.stringify({
      device_class: deviceClassForWidth(window.innerWidth),
      client_instance_id: getClientInstanceId(),
    }),
  });
  return landingOpenResponseSchema.parse(dataOf(await response.json()));
}

async function postEscape(showId: string): Promise<void> {
  await apiRequest("/api/landing/escape", {
    method: "POST",
    body: JSON.stringify({ show_id: showId }),
  });
}

/**
 * `pending` is true while Home waits for the landing decision (render the loading state).
 * `isStudent` must come from the server-read profile; a non-student never asks.
 */
export function useSmartLanding(isStudent: boolean): { pending: boolean } {
  const [, navigate] = useLocation();
  const asked = useRef(false);
  const [pending, setPending] = useState(false);
  const open = useMutation<LandingOpenResponse, Error, void>({
    mutationFn: postOpen,
  });
  const escape = useMutation<void, Error, string>({ mutationFn: postEscape });

  useEffect(() => {
    if (!isStudent || asked.current) return;
    asked.current = true;
    const returning = takeLandingShow();
    if (returning !== null) {
      escape.mutate(returning);
      return;
    }
    if (!consumeDefaultEntry()) return;
    setPending(true);
    open.mutate(undefined, {
      onSuccess: (landing) => {
        if (landing.path !== null) {
          if (landing.show_id !== null) rememberLandingShow(landing.show_id);
          navigate(landing.path, { replace: true });
          return;
        }
        setPending(false);
      },
      onError: () => setPending(false),
    });
    // Runs once per Home mount (`asked` guards it); `open`, `escape` and `navigate` are read at
    // that moment only, so they are deliberately not dependencies.
  }, [isStudent]);

  return { pending };
}

/** "5 more?" after today's question: the server checks today's landing and starts the set. */
export function useLandingMore() {
  return useMutation<LandingMoreResponse, Error, void>({
    mutationFn: async () => {
      const response = await apiRequest("/api/landing/more", {
        method: "POST",
        body: JSON.stringify({ client_instance_id: getClientInstanceId() }),
      });
      return landingMoreResponseSchema.parse(dataOf(await response.json()));
    },
  });
}
