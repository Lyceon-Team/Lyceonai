/**
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness),
 *        CR-02B-29; closure plan W4-1 (LISA in review — launch scope, owner
 *        ruling 2026-09-25), W4-4 (LISA always open in review)]
 *       [student-UI register UI-53; OQ-54 (a) and OQ-57 (f), owner ruling
 *        2026-10-05: "Move the review runner's LISA panel onto student tokens
 *        in #1073 now"; DESIGN.md §1 (tokens only, 14px floor)]
 * @implemented 2026-09-25 | @updated 2026-09-25 — W4-4 | @updated 2026-10-05 — student tokens
 *
 * STUDENT TOKENS (2026-10-05). The frame, header, question chip, opener,
 * loading and error lines draw with the `lyc-*` tokens only, as the thread
 * parts shared with /chat already did (UI-56), and the denial card is the
 * /chat locked card's twin (`LisaUpgradeCard`). Nothing here reads the
 * app-wide light tokens any more, which is what let the review runner leave
 * the light lock (`route-shells.ts`). The composer and paused bar take the
 * "panel" inset: 16px sides at every width inside the 360px column.
 *
 * plain English: LISA beside the question under review. The panel names the
 * question it is about (a chip), can be hidden for the current question, and
 * holds a composer scoped to that one item.
 *
 * W4-4 — ALWAYS OPEN, SO NOTHING IS CREATED ON LOAD. The panel is on screen
 * for every review question, so it must not open a conversation by being
 * there: on load it only LOOKS (a GET filtered to this item) for the item's
 * existing conversation. With none, it shows the opener — an invitation drawn
 * by the panel, not a message: it is never persisted, never in the thread,
 * and gone the moment the student sends anything. The conversation is created
 * on the student's FIRST real message, and that message is then sent through
 * the unchanged turn machine. The server still reuses the item's open
 * conversation, so there is one conversation per review item.
 *
 * What LISA may see is decided on the server, never here: the client sends
 * only the item id. Before the student submits, the envelope carries stem,
 * passage and options — no answer, no explanation (the gate reads
 * `review_session_items.status`); after, both.
 *
 * The thread is drawn with the same parts and turn machine as the standalone
 * chat (`TutorThreadParts`, `useTutorTurn`): optimistic send, retry on the
 * same client_turn_id, crisis card and pause all behave identically.
 *
 * W4-11 — AN UNPAID STUDENT NEVER HOLDS A COMPOSER. The on-load lookup is a
 * tutor request like any other, so the server refuses it for an unpaid
 * student before anything is typed. That refusal — and only that, never a
 * client-side guess — swaps the opener and the composer for the LISA upgrade
 * card. The same holds inside a thread: a conversation whose load or next
 * send is refused (entitlement lapsed) loses its composer to the card. The
 * question and Desmos are outside this panel and are untouched. Why the
 * composer must go rather than be disabled on send: the server checks
 * entitlement before crisis detection (Doc 03B §6.5, kept by owner ruling
 * 2026-09-27), so a refused student's message is never read at all.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useItemConversation,
  type TutorSourceSurface,
} from "@/hooks/tutor-client";
import { Pill } from "@/components/student-ui";
import { LisaAvatar } from "@/components/tutor/TutorThreadParts";
import {
  TutorConversationBody,
  existingFromQuery,
  type TutorBodyCopy,
} from "@/components/tutor/TutorConversationBody";

/** Owner copy (W4-4 brief). The second line is true: the pre-submit gate enforces it. */
export const OPENER_TITLE = "Need help with this question?";
export const OPENER_BODY =
  "I can walk you through it. I won't give you the answer before you submit.";

/** The question-scoped body's copy: the panel's and the dock's in question scope. */
const QUESTION_SCOPE_COPY: TutorBodyCopy = {
  opener: { title: OPENER_TITLE, body: OPENER_BODY },
  placeholder: "Ask about this question...",
  logLabel: "Conversation with LISA about this question",
};

/**
 * LISA scoped to one session item: the existing conversation for the item (a GET filtered to it,
 * never a POST), else the opener, with the first message creating the item's conversation. The
 * client sends only the item id; what LISA may see is decided on the server.
 */
export function ScopedTutorBody({
  sourceSurface,
  sessionItemId,
  onEnded,
}: {
  sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
  sessionItemId: string;
  onEnded: () => void;
}): JSX.Element {
  // Looking is a GET. Nothing here creates a conversation on load.
  const existing = useItemConversation(sourceSurface, sessionItemId);
  return (
    <TutorConversationBody
      scopeKey={sessionItemId}
      lookup={existingFromQuery(existing)}
      createInput={{
        entry_mode: "scoped_question",
        source_surface: sourceSurface,
        source_session_item_id: sessionItemId,
      }}
      copy={QUESTION_SCOPE_COPY}
      onEnded={onEnded}
    />
  );
}

export function ScopedTutorPanel({
  sourceSurface,
  sessionItemId,
  questionLabel,
  onHide,
  revealOnOpen = false,
  revealKey = 0,
}: {
  sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
  sessionItemId: string;
  /** Names the question under review: the runner's own "Question N of M" (OQ-54). */
  questionLabel: string;
  /** Hide LISA for the current question; it returns on the next. */
  onHide: () => void;
  /**
   * QA 2026-10-07 item 8: the student opened LISA (Show LISA) where the panel stacks under the
   * question (the phone layout), so it opens scrolled into view, its header at the top of the
   * runner's scroll area. False when LISA is simply there (every question, W4-4), so a question
   * never loads scrolled away from itself.
   */
  revealOnOpen?: boolean;
  /**
   * QA 2026-10-08 item D (Karl: "tapping the icon always brings it into view"): the runner
   * bumps this when the student taps the LISA icon while the panel is already open but scrolled
   * out of view, so the same reveal runs again without remounting (the thread, the draft and
   * the scroll position inside the panel are kept). Read only with `revealOnOpen`.
   */
  revealKey?: number;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  // On mount (the panel mounts when it is opened, and it is the opening that is revealed) and
  // again on each `revealKey` (QA2-D: a tap on the icon while open but out of view).
  // The runner is still laying out the question above it when LISA mounts (measured at 390: its
  // column grows a frame later, so a single scroll stopped short), so the reveal is repeated
  // each frame until the panel holds still (at most 30 frames, ~0.5s), and stops at once if
  // the student scrolls, touches or types. "auto", not "smooth": DESIGN.md §1 allows no motion
  // but the LISA dots.
  useEffect(() => {
    const el = sectionRef.current;
    if (!revealOnOpen || !el) return;
    let frame = 0;
    let frames = 0;
    let stopped = false;
    let lastTop = Number.NaN;
    const reveal = (): void => {
      if (stopped) return;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      const top = el.getBoundingClientRect().top;
      const settled = top === lastTop;
      lastTop = top;
      frames += 1;
      // At least 10 frames (~160ms: the late growth was within two), then until it holds still.
      if (frames < 30 && (frames < 10 || !settled))
        frame = requestAnimationFrame(reveal);
    };
    const stop = (): void => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
    const inputs = ["wheel", "touchstart", "keydown"] as const;
    for (const type of inputs)
      window.addEventListener(type, stop, { passive: true, once: true });
    reveal();
    return () => {
      stop();
      for (const type of inputs) window.removeEventListener(type, stop);
    };
  }, [revealKey]);
  return (
    // SCL-204 / R32: `ph-no-capture` — the LISA conversation is never recorded (Coding Standards §12).
    <section
      ref={sectionRef}
      className="ph-no-capture flex h-full min-h-[480px] flex-col overflow-hidden rounded-lg border border-lyc-rule bg-lyc-sheet"
      aria-label="LISA"
      data-testid="scoped-tutor-panel"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-lyc-rule bg-lyc-paper px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <LisaAvatar />
          <span className="font-lyc-serif text-lyc-body font-semibold text-lyc-ink-strong">
            LISA
          </span>
          {/* The shared student pill (2026-10-13: lifted from this chip, now also the runner's
              question header), truncated to one line here. */}
          <Pill className="truncate" data-testid="tutor-question-chip">
            {questionLabel}
          </Pill>
        </div>
        <Button
          type="button"
          variant="lyc-quiet"
          size="lyc-icon"
          onClick={onHide}
          aria-label="Hide LISA"
          className="shrink-0 text-lyc-body"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>

      <ScopedTutorBody
        sourceSurface={sourceSurface}
        sessionItemId={sessionItemId}
        onEnded={onHide}
      />
    </section>
  );
}
