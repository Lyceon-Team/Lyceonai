/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §3 (client_turn_id
 *        idempotency, 35s client timeout); closure plan W2-10, W4-1]
 * @implemented 2026-09-25
 *
 * plain English: one LISA turn, start to finish — the student's message on
 * screen the moment it is sent (W2-10), the thinking state, the 35s client
 * timeout, FailedTurn with a retry that reuses the same client_turn_id (so
 * the server resumes the failed row instead of adding one), and the crisis
 * pause and resume. Moved out of `pages/chat.tsx` unchanged so the standalone
 * chat and the in-review panel run the same machine.
 *
 * Edge cases: a retry keeps the optimistic bubble in place (same key); the
 * bubble yields to the persisted row the moment the refetched thread carries
 * its client_turn_id; on reload the crisis card's content is recovered from
 * the last tutor message (the server's crisis response).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useResumeConversation,
  useSendMessage,
  type CrisisCategory,
  type SendMessageResponse,
  type TutorConversationDetail,
  type TutorMessage,
} from "@/hooks/tutor-client";
import { HttpApiError, mapTutorErrorToPremiumReason } from "@/lib/api-error";
import type { PremiumPromptReason } from "@/components/billing/PremiumUpgradePrompt";

export type TurnState =
  | { kind: "idle" }
  | { kind: "thinking"; clientTurnId: string }
  | { kind: "failed"; clientTurnId: string; messageText: string }
  | { kind: "paused"; lane: CrisisCategory };

/** Client times out at 35s (server's is 30s per §3). */
export const CLIENT_TIMEOUT_MS = 35_000;

export type TutorTurn = {
  turnState: TurnState;
  /** The just-sent student message, until the thread carries its row. */
  optimisticMessage: TutorMessage | null;
  crisisLane: CrisisCategory | null;
  effectiveCrisisContent: string;
  showCrisisCard: boolean;
  premiumReason: PremiumPromptReason | null;
  send: (messageText: string) => Promise<void>;
  retry: () => void;
  resume: () => void;
  resumePending: boolean;
  /** Drop all per-conversation turn state (navigating to another thread). */
  reset: () => void;
};

export function useTutorTurn(
  conversationId: string | null,
  messages: TutorMessage[],
  conversation: TutorConversationDetail["conversation"] | undefined,
): TutorTurn {
  const sendMessageMutation = useSendMessage();
  const resumeConversation = useResumeConversation();

  const [turnState, setTurnState] = useState<TurnState>({ kind: "idle" });
  // W2-10: the student's message as sent, shown at once — the thread itself
  // renders from the conversation query, which refetches only after the turn
  // resolves. Keyed by client_turn_id, the key the server persists: a retry
  // reuses the id (same bubble, never a second one), and the bubble yields to
  // the persisted row the moment the refetched thread carries that id. It is
  // never cleared on failure — the text stays on screen above FailedTurn.
  const [optimisticTurn, setOptimisticTurn] = useState<{
    clientTurnId: string;
    text: string;
    sentAt: string;
  } | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shown until the persisted student row with the same client_turn_id is in
  // the thread — derived, not synced, so there is no frame where neither is.
  const optimisticMessage: TutorMessage | null =
    optimisticTurn !== null &&
    !messages.some(
      (m) =>
        m.role === "student" &&
        m.client_turn_id === optimisticTurn.clientTurnId,
    )
      ? {
          message_id: `optimistic-${optimisticTurn.clientTurnId}`,
          role: "student",
          content_kind: "message",
          message: optimisticTurn.text,
          created_at: optimisticTurn.sentAt,
          client_turn_id: optimisticTurn.clientTurnId,
        }
      : null;

  const isPaused = !!conversation?.crisis_paused_at;

  // Crisis state detection — from the conversation detail or from the last
  // send response. The server sets crisis_paused_at; the client reads it.
  const [crisisLane, setCrisisLane] = useState<CrisisCategory | null>(null);
  const [crisisContent, setCrisisContent] = useState<string>("");

  // Derive crisis content from the last tutor message when paused but
  // crisisContent state is empty (e.g. page reload — React state is lost,
  // but the server's crisis response is the last tutor message).
  const lastTutorMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tutor") return messages[i].message;
    }
    return "";
  }, [messages]);

  const effectiveCrisisContent = crisisContent || lastTutorMessage;

  // Derive crisis state from conversation detail or turn state
  const showCrisisCard = turnState.kind === "paused" || isPaused;

  // Premium entitlement check
  const premiumReason: PremiumPromptReason | null = useMemo(() => {
    const sendErr = sendMessageMutation.error;
    return (
      sendErr ? mapTutorErrorToPremiumReason(sendErr) : null
    ) as PremiumPromptReason | null;
  }, [sendMessageMutation.error]);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Sync crisis state when conversation detail loads with crisis_paused_at set
  useEffect(() => {
    if (conversation?.crisis_paused_at && turnState.kind !== "paused") {
      const lane: CrisisCategory = crisisLane ?? "crisis";
      if (!crisisLane) setCrisisLane(lane);
      setTurnState({ kind: "paused", lane });
    }
  }, [conversation?.crisis_paused_at, turnState.kind, crisisLane]);

  const reset = useCallback(() => {
    setTurnState({ kind: "idle" });
    setOptimisticTurn(null);
    setCrisisLane(null);
    setCrisisContent("");
  }, []);

  // ── Send message ──────────────────────────────────────────────────────

  const send = useCallback(
    async (messageText: string) => {
      if (!conversationId) return;
      const trimmed = messageText.trim();
      if (!trimmed) return;

      const clientTurnId =
        turnState.kind === "failed"
          ? turnState.clientTurnId
          : crypto.randomUUID();

      setTurnState({ kind: "thinking", clientTurnId });
      // Same id on retry → the same bubble, updated in place.
      setOptimisticTurn({
        clientTurnId,
        text: trimmed,
        sentAt: new Date().toISOString(),
      });
      sendMessageMutation.reset();

      timeoutRef.current = setTimeout(() => {
        setTurnState({
          kind: "failed",
          clientTurnId,
          messageText: trimmed,
        });
      }, CLIENT_TIMEOUT_MS);

      try {
        const response: SendMessageResponse =
          await sendMessageMutation.mutateAsync({
            conversation_id: conversationId,
            message: trimmed,
            client_turn_id: clientTurnId,
          });

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (response.crisis_paused && response.response.crisis_category) {
          setCrisisLane(response.response.crisis_category);
          setCrisisContent(response.response.content);
          setTurnState({
            kind: "paused",
            lane: response.response.crisis_category,
          });
        } else {
          setTurnState({ kind: "idle" });
        }
      } catch (err: unknown) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (
          err instanceof HttpApiError &&
          err.code === "conversation_crisis_paused"
        ) {
          const lane: CrisisCategory = crisisLane ?? "crisis";
          setTurnState({ kind: "paused", lane });
        } else {
          setTurnState({
            kind: "failed",
            clientTurnId,
            messageText: trimmed,
          });
        }
      }
    },
    [conversationId, turnState, sendMessageMutation, crisisLane],
  );

  // ── Retry ─────────────────────────────────────────────────────────────

  const retry = useCallback(() => {
    if (turnState.kind !== "failed") return;
    void send(turnState.messageText);
  }, [turnState, send]);

  // ── Resume from crisis ────────────────────────────────────────────────

  const resume = useCallback(() => {
    if (!conversationId) return;
    const leavePausedState = (): void => {
      setTurnState({ kind: "idle" });
      setCrisisLane(null);
      setCrisisContent("");
    };
    resumeConversation.mutate(conversationId, {
      onSuccess: leavePausedState,
      // 409 conversation_not_paused is the server saying the conversation is
      // already live (e.g. resumed in another tab). Believe it and leave the
      // paused state — useResumeConversation has already cleared the cached
      // pause, so the sync effect above will not put it back.
      onError: (err) => {
        if (err.code === "conversation_not_paused") leavePausedState();
      },
    });
  }, [conversationId, resumeConversation]);

  return {
    turnState,
    optimisticMessage,
    crisisLane,
    effectiveCrisisContent,
    showCrisisCard,
    premiumReason,
    send,
    retry,
    resume,
    resumePending: resumeConversation.isPending,
    reset,
  };
}
