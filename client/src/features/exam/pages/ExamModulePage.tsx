/**
 * The in-module screen: /tests/:sessionId/:section/:module
 *
 * @spec [Doc-04A_V2.2 §8.2-§8.4 (timing, heartbeat, timeouts), §10 (items), §11.2
 *        (answers, idempotency_key), §12 (module submit, Module 2 start), §15.1
 *        (state read); SCL-132, SCL-133, SCL-145, SCL-146; Doc-04C §2.3]
 *       [E7b decision log D1-D8] | @implemented [2026-09-25]
 *
 * plain English: the page first asks the server where the session is. A URL naming
 * any other module (a submitted one, a future one) is replaced by the server's
 * position — the URL is a view, never an instruction. Then it loads the module's
 * items and workspace, restores the question on screen from the heartbeat ordinal,
 * and runs the module: selections and workspace edits go out in order through one
 * queue, the clock resyncs on every server response, and the server — not the
 * client — ends the module (submit, or a timeout applied on the next touch).
 *
 * Resume (the case most likely to be wrong): a reload lands on the same question
 * (sections[].current_ordinal), with every answer (items[].current_answer), flag,
 * crossed-out option and highlight (workspace) and the server's remaining time.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Redirect, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ExamHighlight,
  ExamModule,
  ExamQuestionPayload,
  ExamSection,
  ExamSessionResponse,
  ExamWorkspaceItem,
} from "@lyceon/shared/exam-runtime-schema";
import { isValidGridInFormat } from "@/components/practice/NumericEntryInput";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  examErrorCode,
  fetchExamSession,
  fetchModuleItems,
  fetchModuleWorkspace,
  saveItemWorkspace,
  sendExamHeartbeat,
  startExamModule,
  submitExamAnswer,
  submitExamModule,
  type ExamSectionStateResponse,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import {
  examPosition,
  modulePath,
  parseModuleRoute,
  pathForPosition,
  reportPath,
  routeMatchesPosition,
  sessionPath,
} from "../lib/exam-position";
import { summarizeModule } from "../lib/module-summary";
import { useExamClock } from "../hooks/useExamClock";
import { useHeartbeat } from "../hooks/useHeartbeat";
import { useWriteQueue } from "../hooks/useWriteQueue";
import { ExamHeader } from "../components/ExamHeader";
import { ExamTimer } from "../components/ExamTimer";
import { ExamQuestionView } from "../components/ExamQuestionView";
import { NavigatorDialog } from "../components/NavigatorDialog";
import { ModuleReview } from "../components/ModuleReview";
import { SubmitModuleDialog } from "../components/SubmitModuleDialog";
import { ExamLoadError, ExamLoading } from "../components/ExamStatus";
import "../exam.css";

/** A module has ended for the client when the server no longer says it is active. */
function moduleStillActive(state: ExamSectionStateResponse, module: ExamModule): boolean {
  return state.state === (module === "1" ? "module1_active" : "module2_active");
}

/** Errors meaning "this module is over or unreachable": go where the server says. */
const RESOLVE_CODES = new Set([
  "module_submitted",
  "module_not_started",
  "session_terminal",
  "session_grace_expired",
]);

const GRID_SAVE_DELAY_MS = 800;

function newKey(): string {
  return crypto.randomUUID();
}

function emptyWorkspace(ordinal: number): ExamWorkspaceItem {
  return { ordinal, marked_for_review: false, eliminated_option_ids: [], highlights: [] };
}

export default function ExamModulePage() {
  const params = useParams<{ sessionId: string; section: string; module: string }>();
  const sessionId = params.sessionId;
  const route = parseModuleRoute(params.section, params.module);
  const session = useQuery({
    queryKey: examKeys.session(sessionId),
    queryFn: () => fetchExamSession(sessionId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (session.isPending) return <ExamLoading />;
  if (session.isError) return <ExamLoadError error={session.error} onRetry={() => void session.refetch()} />;

  const position = examPosition(session.data);
  // PLANT "a submitted module can't be re-entered by URL": the URL only ever SHOWS
  // the server's position; it never selects a module.
  if (route === null || !routeMatchesPosition(route, position)) {
    return <Redirect to={pathForPosition(sessionId, position)} replace />;
  }
  return <ModuleLoader session={session.data} section={route.section} module={route.module} />;
}

function ModuleLoader({
  session,
  section,
  module,
}: {
  session: ExamSessionResponse;
  section: ExamSection;
  module: ExamModule;
}) {
  const sessionId = session.session_id;
  const common = { staleTime: 0, refetchOnMount: "always" as const, refetchOnWindowFocus: false, retry: false };
  const items = useQuery({
    queryKey: examKeys.items(sessionId, section, module),
    queryFn: () => fetchModuleItems(sessionId, section, module),
    ...common,
  });
  const workspace = useQuery({
    queryKey: examKeys.workspace(sessionId, section, module),
    queryFn: () => fetchModuleWorkspace(sessionId, section, module),
    ...common,
  });
  if (items.isPending || workspace.isPending) return <ExamLoading />;
  if (items.isError) return <ExamLoadError error={items.error} onRetry={() => void items.refetch()} />;
  if (workspace.isError) return <ExamLoadError error={workspace.error} onRetry={() => void workspace.refetch()} />;

  const row = session.sections.find((s) => s.section === section);
  const sorted = [...items.data.items].sort((a, b) => a.ordinal - b.ordinal);
  const resume = row?.current_ordinal ?? null;
  const startOrdinal =
    resume !== null && sorted.some((i) => i.ordinal === resume) ? resume : (sorted[0]?.ordinal ?? 0);

  return (
    <ModuleRunner
      key={`${sessionId}:${section}:${module}`}
      sessionId={sessionId}
      section={section}
      module={module}
      items={sorted}
      initialWorkspace={workspace.data.items}
      initialRemainingMs={items.data.section_state.remaining_ms ?? 0}
      startOrdinal={startOrdinal}
    />
  );
}

type View = { kind: "question"; ordinal: number } | { kind: "review" };

function ModuleRunner(props: {
  sessionId: string;
  section: ExamSection;
  module: ExamModule;
  items: ExamQuestionPayload[];
  initialWorkspace: ExamWorkspaceItem[];
  initialRemainingMs: number;
  startOrdinal: number;
}) {
  const { sessionId, section, module, items } = props;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useSupabaseAuth();
  const queue = useWriteQueue();

  const [answers, setAnswers] = useState<Map<number, string | null>>(
    () => new Map(items.map((i) => [i.ordinal, i.current_answer])),
  );
  const [drafts, setDrafts] = useState<Map<number, string>>(
    () =>
      new Map(
        items
          .filter((i) => i.question_type === "student_produced_response")
          .map((i) => [i.ordinal, i.current_answer ?? ""]),
      ),
  );
  const [workspace, setWorkspace] = useState<Map<number, ExamWorkspaceItem>>(
    () => new Map(props.initialWorkspace.map((w) => [w.ordinal, w])),
  );
  const [view, setView] = useState<View>({ kind: "question", ordinal: props.startOrdinal });
  const [lastOrdinal, setLastOrdinal] = useState(props.startOrdinal);
  const [navOpen, setNavOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorState, setCalculatorState] = useState<unknown>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const leaving = useRef(false);
  const gridTimer = useRef<number | null>(null);
  /** The last value handed to the queue per question: blur and navigation both commit. */
  const lastSent = useRef<Map<number, string | null>>(new Map());

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const summary = useMemo(() => summarizeModule(items, answers, workspace), [items, answers, workspace]);
  const byOrdinal = useMemo(() => new Map(items.map((i) => [i.ordinal, i])), [items]);
  const ordinals = summary.cells.map((c) => c.ordinal);

  // ── Leaving the module: always where the SERVER says ───────────────────────

  const goToServerPosition = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    await queryClient.invalidateQueries({ queryKey: examKeys.session(sessionId) });
    navigate(sessionPath(sessionId), { replace: true });
  }, [navigate, queryClient, sessionId]);

  /** After this module ends (submit or timeout): Module 2 starts at once. */
  const continueAfterModule = useCallback(
    async (state: ExamSectionStateResponse, sessionState?: string) => {
      if (leaving.current) return;
      if (state.state === "module1_submitted") {
        leaving.current = true;
        try {
          await startExamModule(sessionId, section, "2");
          await queryClient.invalidateQueries({ queryKey: examKeys.session(sessionId) });
          navigate(modulePath(sessionId, section, "2"), { replace: true });
        } catch {
          leaving.current = false;
          await goToServerPosition();
        }
        return;
      }
      if (sessionState === "completed") {
        leaving.current = true;
        navigate(reportPath(sessionId), { replace: true });
        return;
      }
      await goToServerPosition();
    },
    [goToServerPosition, navigate, queryClient, section, sessionId],
  );

  // ── Clock ──────────────────────────────────────────────────────────────────

  const onExpire = useCallback(() => {
    // The client never ends a module; it asks the server, whose touch applies the
    // §8.4 timeout and answers with the section's new state.
    sendExamHeartbeat(sessionId, section, view.kind === "question" ? view.ordinal : lastOrdinal)
      .then((res) => onSectionStateRef.current(res.section_state))
      .catch(() => void goToServerPosition());
  }, [goToServerPosition, lastOrdinal, section, sessionId, view]);

  const clock = useExamClock(props.initialRemainingMs, onExpire);

  const onSectionState = useCallback(
    (state: ExamSectionStateResponse) => {
      if (state.remaining_ms !== null) clock.resync(state.remaining_ms);
      if (!moduleStillActive(state, module)) void continueAfterModule(state);
    },
    [clock, continueAfterModule, module],
  );
  const onSectionStateRef = useRef(onSectionState);
  onSectionStateRef.current = onSectionState;

  const onWriteError = useCallback(
    (error: unknown) => {
      const code = examErrorCode(error);
      if (code !== null && RESOLVE_CODES.has(code)) {
        void goToServerPosition();
        return;
      }
      setSaveError("Your last change didn't save. Check your connection — it will be sent again when you make your next change.");
    },
    [goToServerPosition],
  );

  useHeartbeat({
    sessionId,
    section,
    ordinal: view.kind === "question" ? view.ordinal : lastOrdinal,
    enabled: !submitting,
    onSectionState,
    onError: onWriteError,
  });

  // ── Writes ─────────────────────────────────────────────────────────────────

  const sendAnswer = useCallback(
    (ordinal: number, answer: string | null) => {
      const item = byOrdinal.get(ordinal);
      if (item === undefined) return;
      const previous = answersRef.current.get(ordinal) ?? null;
      lastSent.current.set(ordinal, answer);
      setAnswers((m) => new Map(m).set(ordinal, answer));
      queue
        .enqueue(() =>
          submitExamAnswer({
            test_session_id: sessionId,
            section,
            module,
            question_id: item.question_id,
            ordinal,
            answer,
            idempotency_key: newKey(),
          }),
        )
        .then((res) => {
          setSaveError(null);
          onSectionState(res.section_state);
        })
        .catch((error: unknown) => {
          // Revert only if nothing newer replaced it meanwhile.
          if (lastSent.current.get(ordinal) === answer) lastSent.current.delete(ordinal);
          setAnswers((m) => (m.get(ordinal) === answer ? new Map(m).set(ordinal, previous) : m));
          onWriteError(error);
        });
    },
    [byOrdinal, module, onSectionState, onWriteError, queue, section, sessionId],
  );

  const saveWorkspace = useCallback(
    (next: ExamWorkspaceItem) => {
      const previous = workspaceRef.current.get(next.ordinal) ?? emptyWorkspace(next.ordinal);
      setWorkspace((m) => new Map(m).set(next.ordinal, next));
      queue
        .enqueue(() => saveItemWorkspace(sessionId, section, module, next))
        .then((res) => {
          setSaveError(null);
          onSectionState(res.section_state);
        })
        .catch((error: unknown) => {
          setWorkspace((m) => (m.get(next.ordinal) === next ? new Map(m).set(next.ordinal, previous) : m));
          onWriteError(error);
        });
    },
    [module, onSectionState, onWriteError, queue, section, sessionId],
  );

  const workspaceFor = (ordinal: number): ExamWorkspaceItem =>
    workspaceRef.current.get(ordinal) ?? emptyWorkspace(ordinal);

  const commitGrid = useCallback(
    (ordinal: number) => {
      if (gridTimer.current !== null) {
        window.clearTimeout(gridTimer.current);
        gridTimer.current = null;
      }
      const draft = (draftsRef.current.get(ordinal) ?? "").trim();
      const saved = lastSent.current.has(ordinal)
        ? (lastSent.current.get(ordinal) ?? null)
        : (answersRef.current.get(ordinal) ?? null);
      const next = draft === "" ? null : draft;
      if (next !== null && !isValidGridInFormat(next)) return; // not an answer yet
      if (next === saved) return;
      sendAnswer(ordinal, next);
    },
    [sendAnswer],
  );

  // ── Navigation ────────────────────────────────────────────────────────────

  const leaveCurrent = () => {
    if (view.kind === "question" && drafts.has(view.ordinal)) commitGrid(view.ordinal);
  };

  const goTo = (ordinal: number) => {
    leaveCurrent();
    setNavOpen(false);
    setView({ kind: "question", ordinal });
    setLastOrdinal(ordinal);
  };

  const goToReview = () => {
    leaveCurrent();
    setNavOpen(false);
    setView({ kind: "review" });
  };

  const indexOfCurrent = view.kind === "question" ? ordinals.indexOf(view.ordinal) : ordinals.length;
  const onNext = () => {
    const next = ordinals[indexOfCurrent + 1];
    if (next === undefined) goToReview();
    else goTo(next);
  };
  const onBack = () => {
    const prev = ordinals[indexOfCurrent - 1];
    if (prev !== undefined) goTo(prev);
  };

  const onConfirmSubmit = async () => {
    setSubmitting(true);
    leaveCurrent();
    try {
      await queue.drain();
      const res = await submitExamModule(sessionId, section, module);
      await continueAfterModule(res.section_state, res.session_state);
    } catch (error: unknown) {
      setSubmitting(false);
      setSubmitOpen(false);
      onWriteError(error);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const current = view.kind === "question" ? byOrdinal.get(view.ordinal) : undefined;
  const currentCell = view.kind === "question" ? summary.cells.find((c) => c.ordinal === view.ordinal) : undefined;
  const isMath = section === "M";

  const tools = isMath ? (
    <>
      <button
        type="button"
        aria-pressed={calculatorOpen}
        aria-controls="exam-calculator-panel"
        onClick={() => setCalculatorOpen((o) => !o)}
        className={[
          "min-h-[44px] rounded-lg border px-3.5 text-[13px] font-medium",
          calculatorOpen
            ? "border-[var(--exam-accent)] bg-[var(--exam-accent-soft)] text-[var(--exam-accent)]"
            : "border-[var(--exam-line)] bg-[var(--exam-surface)] text-[var(--exam-muted)]",
        ].join(" ")}
      >
        Calculator
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setReferenceOpen(true)}
        className="min-h-[44px] rounded-lg border border-[var(--exam-line)] bg-[var(--exam-surface)] px-3.5 text-[13px] font-medium text-[var(--exam-muted)]"
      >
        Reference
      </button>
    </>
  ) : null;

  return (
    <div className="exam-root flex h-screen flex-col" data-testid="exam-module">
      <ExamHeader section={section} module={module} timer={<ExamTimer remainingMs={clock.remainingMs} />} tools={tools} />
      {saveError !== null && (
        <div role="alert" className="border-b border-[var(--exam-line)] bg-[#FBF1E6] px-6 py-2 text-sm">
          {saveError}
        </div>
      )}
      <main className="flex min-h-0 flex-1">
        {isMath && calculatorOpen && (
          <aside
            id="exam-calculator-panel"
            aria-label="Graphing calculator"
            className="flex w-full max-w-[520px] shrink-0 flex-col border-r border-[var(--exam-line)] bg-[var(--exam-surface)]"
          >
            <div className="flex h-12 items-center justify-between border-b border-[var(--exam-line)] px-4">
              <span className="text-[13px] font-semibold">Graphing calculator</span>
              <button
                type="button"
                aria-label="Close calculator"
                onClick={() => setCalculatorOpen(false)}
                className="min-h-[44px] min-w-[44px] text-lg text-[var(--exam-muted)]"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <DesmosCalculator expanded fillHeight initialState={calculatorState} onStateChange={setCalculatorState} />
            </div>
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {view.kind === "review" ? (
            <ModuleReview section={section} module={module} summary={summary} onGoTo={goTo} onSubmit={() => setSubmitOpen(true)} />
          ) : current !== undefined && currentCell !== undefined ? (
            <ExamQuestionView
              key={current.ordinal}
              item={current}
              number={currentCell.number}
              answer={answers.get(current.ordinal) ?? null}
              gridDraft={drafts.get(current.ordinal) ?? ""}
              workspace={workspace.get(current.ordinal) ?? emptyWorkspace(current.ordinal)}
              onSelect={(token) => {
                const ws = workspaceFor(current.ordinal);
                if (ws.eliminated_option_ids.includes(token)) {
                  saveWorkspace({ ...ws, eliminated_option_ids: ws.eliminated_option_ids.filter((t) => t !== token) });
                }
                if (answersRef.current.get(current.ordinal) !== token) sendAnswer(current.ordinal, token);
              }}
              onGridChange={(text) => {
                setDrafts((m) => new Map(m).set(current.ordinal, text));
                if (gridTimer.current !== null) window.clearTimeout(gridTimer.current);
                gridTimer.current = window.setTimeout(() => commitGrid(current.ordinal), GRID_SAVE_DELAY_MS);
              }}
              onGridCommit={() => commitGrid(current.ordinal)}
              onToggleMark={() => {
                const ws = workspaceFor(current.ordinal);
                saveWorkspace({ ...ws, marked_for_review: !ws.marked_for_review });
              }}
              onToggleEliminate={(token) => {
                const ws = workspaceFor(current.ordinal);
                const out = ws.eliminated_option_ids.includes(token);
                saveWorkspace({
                  ...ws,
                  eliminated_option_ids: out
                    ? ws.eliminated_option_ids.filter((t) => t !== token)
                    : [...ws.eliminated_option_ids, token],
                });
                // Crossing out the selected option leaves the selection alone (Bluebook).
              }}
              onHighlightsChange={(next: ExamHighlight[]) => {
                const ws = workspaceFor(current.ordinal);
                saveWorkspace({ ...ws, highlights: next });
              }}
            />
          ) : null}
        </div>
      </main>
      <footer className="flex min-h-[76px] shrink-0 items-center justify-between gap-3 border-t border-[var(--exam-line)] bg-[var(--exam-surface)] px-4 md:px-7">
        <div className="hidden w-60 truncate text-sm font-medium md:block">{user?.display_name ?? ""}</div>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setNavOpen(true)}
          data-testid="exam-navigator-open"
          className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--exam-ink)] px-4 text-sm font-medium text-white"
        >
          {view.kind === "review" ? "Review" : `Question ${currentCell?.number ?? 1} of ${summary.total}`}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
        <div className="flex w-60 justify-end gap-2.5">
          <button
            type="button"
            onClick={view.kind === "review" ? () => goTo(ordinals[ordinals.length - 1] ?? 0) : onBack}
            disabled={view.kind === "question" && indexOfCurrent <= 0}
            className="min-h-[44px] rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-5 text-sm font-medium disabled:opacity-40"
          >
            Back
          </button>
          {view.kind === "question" && (
            <button
              type="button"
              onClick={onNext}
              data-testid="exam-next"
              className="min-h-[44px] rounded-full bg-[var(--exam-accent)] px-6 text-sm font-medium text-white hover:bg-[var(--exam-accent-hover)]"
            >
              Next
            </button>
          )}
        </div>
      </footer>
      <NavigatorDialog
        open={navOpen}
        onOpenChange={setNavOpen}
        section={section}
        module={module}
        summary={summary}
        currentOrdinal={view.kind === "question" ? view.ordinal : null}
        onGoTo={goTo}
        onGoToReview={goToReview}
      />
      <SubmitModuleDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        module={module}
        summary={summary}
        remainingMs={clock.remainingMs}
        submitting={submitting}
        onConfirm={() => void onConfirmSubmit()}
      />
      {isMath && <MathReferenceSheet open={referenceOpen} onOpenChange={setReferenceOpen} />}
    </div>
  );
}
