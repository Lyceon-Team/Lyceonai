/**
 * @spec [Doc_05F_Study_Calendar, §15.1 launch (INV-08-18), §17.7 interaction rules]
 *       [Doc_05F_formula_sheet.md §8 item 12 — `enabled_block_types` is ["practice"]]
 * @implemented [2026-09-23]
 *
 * plain English: pressing Start hands the block to the launch service, warms the page the
 * student is about to land on, and then navigates. Expected outcome: the practice page's
 * FIRST render already has its session state — no spinner between the calendar and the
 * question.
 *
 * WHY THE PREFETCH KEY IS A LITERAL URL AND NOT A FACTORY. The practice page reads its
 * session state with the app's URL-as-query-key convention
 * (`client/src/pages/resume-practice.tsx`), so the only key that warms ITS cache is that
 * exact string. A structured key here would prefetch into a slot nothing reads, the
 * prefetch would appear to work, and the spinner would come back — silently. That is
 * precisely the rot `usePracticeStatePrefetchKey` and the integration test exist to catch:
 * the key is built by one exported function, and the test asserts the page is not loading
 * after a launch, so a change to either side fails rather than degrades.
 *
 * trade-offs: the chunk prefetch fires on hover AND focus, not on mount. Prefetching every
 * Start control on a 14-day grid would download the practice bundle for a student who is
 * only looking at their week.
 *
 * edge cases: a 409 `already_complete` is not an error the student caused and not one they
 * can act on — the block simply finished elsewhere. The caller refreshes the plan and shows
 * no toast (§17.5 has no "you already did that" state).
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LaunchResponse, PlanBlock } from "@lyceon/shared/calendar";
import { getClientInstanceId } from "@/lib/client-instance";
import { isApiError } from "@/lib/api-error";
import { isLaunchableBlockType } from "../lib/blocks";
import { calendarKeys } from "./keys";
import { useLaunchMutation } from "./mutations";

/**
 * The EXACT key `resume-practice.tsx` uses. Exported so the integration test can assert the
 * two agree rather than trusting that they do.
 */
export function practiceStateKey(
  sessionId: string,
  clientInstanceId: string,
): string {
  return `/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`;
}

/**
 * The EXACT key `resume-review.tsx` uses (its line 65). Same rule, same reason: a
 * structured key would warm a slot nothing reads and the spinner would come back silently.
 */
export function reviewStateKey(
  sessionId: string,
  clientInstanceId: string,
): string {
  return `/api/review/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`;
}

/**
 * The state key for whichever engine this launch belongs to. One function, so a third
 * engine is a row here rather than an `if` at the call site that someone forgets.
 */
export function stateKeyForEngine(
  blockType: PlanBlock["block_type"],
  sessionId: string,
  clientInstanceId: string,
): string | null {
  if (blockType === "practice")
    return practiceStateKey(sessionId, clientInstanceId);
  if (blockType === "review")
    return reviewStateKey(sessionId, clientInstanceId);
  // full_length has no resume shell to warm yet. Null means "navigate without
  // prefetching", never "prefetch the wrong key".
  return null;
}

/**
 * §15.1 + formula sheet item 12. Review joined practice on 2026-09-22; full-length is still
 * a fail-open stub, so its control reads "Coming soon", is disabled, and never calls launch
 * — asking and being refused is a worse experience than a control that tells the truth up
 * front.
 *
 * This is about the ENGINE being real, not about the flag. `enabled_block_types` decides
 * whether a review block is ever PLANNED; this decides whether one a student holds can be
 * started. A student can hold a review block from a hand-edited day with the flag off, and
 * it should work.
 */
export function isLaunchable(block: Pick<PlanBlock, "block_type">): boolean {
  // Delegated, not restated. See `isLaunchableBlockType` for why this rule has exactly
  // one home.
  return isLaunchableBlockType(block.block_type);
}

/**
 * Warms the lazy resume chunk for the engine the student is about to land on. Idempotent —
 * the browser caches the module.
 */
export function prefetchEngineChunk(blockType: PlanBlock["block_type"]): void {
  if (blockType === "practice") void import("@/pages/resume-practice");
  if (blockType === "review") void import("@/pages/resume-review");
}

/** @deprecated Use `prefetchEngineChunk`. Kept so no call site breaks mid-change. */
export function prefetchPracticeChunk(): void {
  prefetchEngineChunk("practice");
}

export type LaunchOutcome =
  | { kind: "navigated"; response: LaunchResponse }
  | { kind: "already_complete" }
  | { kind: "failed"; error: Error };

/**
 * Launches a block and navigates. `navigate` is injected rather than taken from `wouter`
 * here so the hook is testable without a router, and so the page owns routing.
 */
export function useLaunchBlock(navigate: (to: string) => void): {
  launch: (
    blockId: string,
    blockType?: PlanBlock["block_type"],
  ) => Promise<LaunchOutcome>;
  isPending: boolean;
  pendingBlockId: string | null;
} {
  const queryClient = useQueryClient();
  const mutation = useLaunchMutation();
  // STATE, not a ref. This value is READ DURING RENDER and handed back as hook state, and a
  // ref write schedules no render — the consumer would see whichever block id an unrelated
  // re-render happened to leave behind, so the Start spinner could stick on the wrong row.
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);

  const launch = useCallback(
    async (
      blockId: string,
      blockType: PlanBlock["block_type"] = "practice",
    ): Promise<LaunchOutcome> => {
      setPendingBlockId(blockId);
      const clientInstanceId = getClientInstanceId();
      try {
        const response = await mutation.mutateAsync({
          blockId,
          client_instance_id: clientInstanceId,
          platform: "web",
        });

        // THE PREFETCH. Awaited, so the navigation happens with the state already in cache;
        // a fire-and-forget would race the route change and lose roughly as often as it won.
        const stateKey = stateKeyForEngine(
          blockType,
          response.session_id,
          clientInstanceId,
        );
        if (stateKey !== null) {
          await queryClient.prefetchQuery({ queryKey: [stateKey] });
        }

        navigate(response.next);
        return { kind: "navigated", response };
      } catch (error) {
        if (
          isApiError(error) &&
          error.status === 409 &&
          error.code === "CALENDAR_ALREADY_COMPLETE"
        ) {
          // The block finished somewhere else. `onSettled` on the mutation has already
          // invalidated the plan, so the row will repaint as done on its own.
          return { kind: "already_complete" };
        }
        return {
          kind: "failed",
          error: error instanceof Error ? error : new Error("Launch failed"),
        };
      } finally {
        setPendingBlockId(null);
      }
    },
    [mutation, navigate, queryClient],
  );

  return {
    launch,
    isPending: mutation.isPending,
    pendingBlockId,
  };
}

/** Re-exported so a caller invalidating after a launch names the key from one place. */
export { calendarKeys };
