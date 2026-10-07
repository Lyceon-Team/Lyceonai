/**
 * Full-Length home (`/tests`): the student's tests, "Before you start", and the right panel's
 * score history and mastery.
 *
 * @spec [student-UI register UI-54; DESIGN.md §1 (tokens only, 14px floor, one primary action),
 *        §2 (App shell: right panel, slim legal footer), §3 (Mastery row compact; Locked mastery
 *        card), §4 "Full-Length home"; prototype FullLength.dc.html (paid and free);
 *        evidence/wiring-table.md §7 (the endpoint behind each element); register §2 (paid =
 *        Full-Length; the entitlement denial contract, SCL-185), OQ-30 (score history,
 *        `GET /api/tests/sessions?state=scored`, SCL-207), OQ-31 (owner ruling 2026-10-02: the
 *        card shows the completed test's score; this SUPERSEDES E7b ruling 2, "state words on
 *        the card, never a score"), OQ-32 (owner ruling 2026-10-02: "section, module" from the
 *        in-progress session's `/state`), OQ-44 (approved prototype copy), OQ-49 (this route
 *        comes off the light lock: route-shells.ts), OQ-51 ("Reading & Writing"); owner ruling
 *        (Karl, 2026-10-05): on phone widths "Full-length tests are built for a laptop or
 *        tablet, like test day." with "Continue anyway", never blocked; owner ruling (Karl,
 *        2026-10-05, OQ-63): "show it for every full-length start on a phone, including
 *        calendar-launched starts. One shared pre-start check, same \"Continue anyway\"."]
 *       [Doc-04A_V2.2 §7.3 (create: test_form_id + mode, lenient default §8.6), §16 as amended
 *        by SCL-147 (GET /api/tests/forms); Doc-04C §15.1 (a scaled score is never drawn
 *        without its disclosure beside it); E7b owner ruling 3 (no break checkbox: the create
 *        payload has no such field)]
 *       | @implemented [2026-10-03]
 *
 * TITLE: the page title is the section's name, "Full-Length" (owner naming ruling, Karl,
 * 2026-10-05: every student-facing "Tests" label becomes "Full-Length"), like Practice and Review.
 *
 * plain English: one row per published form with its status ("Not started", "In progress:
 * Reading & Writing, Module 2", "Completed 26 September. Score 1120." with the score's
 * disclosure beside it) and its actions. Exactly one action is filled: Resume, otherwise Start
 * on the first form never taken (tests-home-model.ts). Start creates the session with the
 * timing chosen under "Before you start" and lands on the session page, where the student
 * begins Reading and Writing Module 1 (the timer starts there, not here); if a session is
 * already in progress the server says so (409 existing_active_session) and the student is taken
 * to it instead. The right panel lists every scored test, newest first, each a link to its
 * report, and the mastery rows (or the locked card).
 *
 * PHONE NOTICE (owner rulings, Karl, 2026-10-05; OQ-63). The home itself is never held: on a
 * phone the list, timing and right panel draw as on a laptop. Start, Take again and Resume each
 * go through the ONE shared pre-start check (`useFullLengthPhonePrecheck`), the same check a
 * calendar block and Home use: below the App shell's `lg` breakpoint, unless the student already
 * continued in this tab, it opens the ruling's notice as a student Modal with the outline
 * "Continue anyway", and only Continue anyway performs the start (so a cancelled start creates
 * no session). The page used to draw the notice in place of its body until dismissed; that was a
 * second presentation of the same notice, and it asked a student who only came to read a score.
 * The exam routes themselves (`/tests/:sessionId` and below) never show it.
 *
 * FREE PLAN: the feature-access map (OQ-29) says Full-Length is locked, so the page draws the
 * in-page upgrade card and asks for none of the gated reads (`/forms`, `/sessions`, `/state`):
 * every exam query is disabled. The server refuses them regardless.
 *
 * Replaces the pre-redesign page: its own "exam-root" frame and exam colour tokens, the
 * three-column form cards with the state chip, "View scores", the "Start test" button and the
 * start panel that opened under the cards ("Before you start {form}", "Begin Reading and
 * Writing").
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import type { ExamMode } from "@lyceon/shared/exam-runtime-schema";
import { displayFormName } from "@lyceon/shared/exam-form-display";
import type { ExamScoredSessionRow } from "@lyceon/shared/exam-scored-sessions-schema";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import {
  UPGRADE_MODAL_COPY,
  UPGRADE_MODAL_SHARED_COPY,
  UPGRADE_PLANS_DESTINATION,
} from "@/components/billing/upgrade-modal";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { MasteryRow } from "@/components/mastery/MasteryRow";
import {
  canonicalDomainNodes,
  masteryDomainHref,
} from "@/components/mastery/domain-nodes";
import { Notice, PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { fetchMasteryDomains, type MasterySection } from "@/lib/masteryApi";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { cn } from "@/lib/utils";
import { sectionDisplayLabel } from "@shared/section-display";
import {
  createExamSession,
  existingSessionId,
  fetchExamForms,
  fetchExamSession,
  fetchScoredSessions,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import { reportPath, sessionPath } from "../lib/exam-position";
import {
  formRow,
  historyLine,
  isExamInProgress,
  primaryFormId,
  primaryKindOf,
  type FormRow,
  type RowAction,
} from "../lib/tests-home-model";
import { useFullLengthPhonePrecheck } from "../lib/useFullLengthPhonePrecheck";
import { DisclosureNote } from "../components/DisclosedScore";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const PANEL_H2 =
  "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";
const NOTE = "m-0 text-lyc-meta-lg leading-normal text-lyc-muted";

const MASTERY_SECTIONS: readonly MasterySection[] = ["M", "RW"];

/**
 * Prototype "Before you start" (FullLength.dc.html). Its second line is true of test-day timing
 * only, so under practice timing the shipped practice-timing line stands in for it (owner
 * question in the UI-54 report). The first line's "2 hours and 15 minutes" is the prototype's
 * static figure, not read from the form.
 */
const BEFORE_YOU_START_FIRST =
  "Set aside about 2 hours and 15 minutes somewhere quiet.";
const BEFORE_YOU_START_TIMING: Readonly<Record<ExamMode, string>> = {
  // Prototype line; true of test-day timing only.
  strict:
    "Each module is timed, and the timer keeps running if you leave the page.",
  // Shipped practice-timing line (the pre-redesign start panel).
  lenient: "The clock pauses when you step away. Your report says so.",
};
const BEFORE_YOU_START_REST = [
  "The calculator and reference sheet are built in, as on test day.",
  "You can flag questions and move back and forth within a module before you submit it.",
] as const;

export default function TestsHomePage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const studentId = user?.id ?? "";
  const profile = useProfileQuery();
  const access = useFeatureAccess();
  const upgrade = useUpgradeModal();

  // OQ-29: the map decides; a loaded profile with no map (a non-student) leaves it to the server.
  const examAccess = access?.exam_full_length ?? null;
  const decided = profile.data !== undefined;
  const examGranted =
    decided && (examAccess === null || examAccess.access === "granted");
  const examLocked = examAccess?.access === "locked" ? examAccess : null;
  const masteryAccess = access?.mastery_detail ?? null;
  const masteryGranted = masteryAccess?.access === "granted";

  const forms = useQuery({
    queryKey: examKeys.forms(),
    queryFn: fetchExamForms,
    staleTime: 0,
    enabled: examGranted,
  });
  const scored = useQuery({
    queryKey: examKeys.scoredSessions(),
    queryFn: fetchScoredSessions,
    staleTime: 0,
    enabled: examGranted,
  });
  const inProgressId =
    forms.data?.forms.find(
      (f) =>
        f.latest_session !== null && isExamInProgress(f.latest_session.state),
    )?.latest_session?.session_id ?? null;
  const inProgress = useQuery({
    queryKey: examKeys.session(inProgressId ?? "none"),
    queryFn: () => fetchExamSession(inProgressId ?? ""),
    staleTime: 0,
    enabled: examGranted && inProgressId !== null,
  });
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
    enabled: masteryGranted && studentId.length > 0,
  });

  const scoredById = useMemo(
    () =>
      new Map<string, ExamScoredSessionRow>(
        (scored.data ?? []).map((row) => [row.session_id, row]),
      ),
    [scored.data],
  );
  const rows = useMemo(
    () =>
      (forms.data?.forms ?? []).map((form) =>
        formRow(form, scoredById, inProgress.data),
      ),
    [forms.data, scoredById, inProgress.data],
  );
  const primaryId = primaryFormId(rows);
  const [mode, setMode] = useState<ExamMode>("strict");

  return (
    <div className="flex flex-col gap-10" data-testid="tests-home">
      <PageHeader
        title="Full-Length"
        description="Timed like test day: two modules per section, a break between sections, and a scored report at the end."
      />

      {/* OQ-63: never held on a phone; the notice is asked at Start/Resume. */}
      <div className="flex flex-col gap-10" data-testid="tests-home-body">
        {examLocked !== null ? (
          <FreeUpgradeCard reason={examLocked.reason} />
        ) : examGranted ? (
          <>
            <section
              aria-labelledby="tests-h"
              className="flex flex-col gap-3.5"
              data-testid="tests-list"
            >
              <h2 id="tests-h" className={SECTION_H2}>
                Your full-length tests
              </h2>
              {forms.isPending ? (
                <Skeleton variant="lyc" className="h-[180px] w-full" />
              ) : forms.isError ? (
                <Notice
                  tone="danger"
                  title="We couldn't load the full-length tests."
                  actionLabel="Try again"
                  onAction={() => void forms.refetch()}
                  data-testid="tests-error"
                />
              ) : rows.length === 0 ? (
                <p className="m-0 text-lyc-body-lg text-lyc-muted">
                  No full-length tests are available yet.
                </p>
              ) : (
                <ul className="m-0 list-none border-t border-lyc-rule p-0">
                  {rows.map((row) => (
                    <li key={row.form.test_form_id}>
                      <TestRow
                        row={row}
                        primary={row.form.test_form_id === primaryId}
                        mode={mode}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <BeforeYouStart mode={mode} onModeChange={setMode} />
          </>
        ) : null}

        <AppShellPanel>
          <div className="flex flex-col gap-9" data-testid="tests-panel">
            {examGranted && (scored.data?.length ?? 0) > 0 ? (
              <ScoreHistory rows={scored.data ?? []} />
            ) : null}
            <section
              aria-labelledby="tests-mastery-h"
              className="flex flex-col gap-4"
              data-testid="tests-mastery"
            >
              <h2 id="tests-mastery-h" className={PANEL_H2}>
                Mastery
              </h2>
              {masteryGranted && mastery.data !== undefined ? (
                <>
                  {MASTERY_SECTIONS.map((s) => (
                    <div key={s} className="flex flex-col">
                      <h3 className="m-0 mb-1 text-[15px] font-semibold text-lyc-muted">
                        {sectionDisplayLabel(s)}
                      </h3>
                      {canonicalDomainNodes(mastery.data.domains, [s]).map(
                        (node) => (
                          <MasteryRow
                            key={`${node.section}:${node.domain}`}
                            label={node.domain}
                            levelKey={node.levelKey}
                            displayName={node.displayName}
                            variant="compact"
                            href={masteryDomainHref(node)}
                          />
                        ),
                      )}
                    </div>
                  ))}
                  <Link href="/mastery" className={TEXT_LINK}>
                    See every skill
                  </Link>
                </>
              ) : masteryAccess?.access === "locked" ? (
                <LockedMasteryCard
                  headingLevel={3}
                  onSeeWhatsIncluded={() =>
                    upgrade.open("mastery_detail", masteryAccess.reason)
                  }
                />
              ) : null}
            </section>
          </div>
        </AppShellPanel>
      </div>
    </div>
  );
}

/**
 * The free plan's in-page card (DESIGN.md §4; prototype FullLength.dc.html, plan = free). The
 * body is the approved Full-Length copy (OQ-44, the same words as the upgrade modal); "See plans"
 * goes where the modal's does (OQ-39(e)). An under-13 student (reason `age`) gets the age
 * message and no plans button, as the modal does (OQ-29).
 */
function FreeUpgradeCard({ reason }: { reason: "plan" | "age" }): JSX.Element {
  const [, navigate] = useLocation();
  const copy = UPGRADE_MODAL_COPY.exam_full_length[reason];
  return (
    <section
      aria-labelledby="tests-upgrade-h"
      className="flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-8 sm:px-10 sm:py-9"
      data-testid="tests-upgrade-card"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
        className="text-lyc-ink-strong"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z" />
      </svg>
      <h2
        id="tests-upgrade-h"
        className="m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong"
      >
        {/* Prototype free card heading (no full stop, unlike the modal's sentence). */}
        {reason === "plan" ? "Included with every paid plan" : copy.title}
      </h2>
      <p className="m-0 text-[18px] leading-relaxed text-lyc-ink">
        {copy.body}
      </p>
      {reason === "plan" ? (
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          className="self-start"
          data-testid="tests-see-plans"
          onClick={() => navigate(UPGRADE_PLANS_DESTINATION)}
        >
          {UPGRADE_MODAL_SHARED_COPY.primaryLabel}
        </Button>
      ) : null}
    </section>
  );
}

function TestRow({
  row,
  primary,
  mode,
}: {
  row: FormRow;
  primary: boolean;
  mode: ExamMode;
}): JSX.Element {
  const primaryKind = primary ? primaryKindOf(row) : null;
  // Owner ruling 2026-10-05: the stored form name is shown as "Full-Length Test N".
  const name = displayFormName(row.form.name);
  return (
    <article
      aria-label={name}
      className="grid grid-cols-1 gap-4 border-b border-lyc-rule py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
      data-testid="tests-row"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
          {name}
        </h3>
        <p
          className="m-0 text-[17px] text-lyc-muted"
          data-testid="exam-form-state"
        >
          {row.status}
        </p>
        {/* §15.1: a score on the card always has its disclosure beside it. */}
        {row.scored !== null ? (
          <DisclosureNote disclosure={row.scored.disclosure} className={NOTE} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        {row.actions.map((action) => (
          <RowActionControl
            key={action.kind}
            action={action}
            filled={action.kind === primaryKind}
            formId={row.form.test_form_id}
            formName={name}
            mode={mode}
          />
        ))}
      </div>
    </article>
  );
}

function RowActionControl({
  action,
  filled,
  formId,
  formName,
  mode,
}: {
  action: RowAction;
  filled: boolean;
  formId: string;
  formName: string;
  mode: ExamMode;
}): JSX.Element {
  const variant = filled ? "lyc-primary" : "lyc-outline";
  const size = filled ? "lyc-lg" : "lyc";
  switch (action.kind) {
    case "resume":
      return (
        <ResumeLink
          sessionId={action.sessionId}
          variant={variant}
          size={size}
        />
      );
    case "report":
      return (
        <Button asChild variant="lyc-outline" size="lyc">
          <Link
            href={reportPath(action.sessionId)}
            className="no-underline"
            data-testid="tests-view-report"
            aria-label={`View report, ${formName}`}
          >
            View report
          </Link>
        </Button>
      );
    case "start":
    case "take-again":
      return (
        <StartButton
          formId={formId}
          mode={mode}
          variant={variant}
          size={size}
          label={action.kind === "start" ? "Start" : "Take again"}
        />
      );
    case "unavailable":
      return (
        <Button type="button" variant="lyc-outline" size="lyc" disabled>
          Not available
        </Button>
      );
  }
}

/** Resume an in-progress sitting, through the shared phone pre-start check (OQ-63). */
function ResumeLink({
  sessionId,
  variant,
  size,
}: {
  sessionId: string;
  variant: "lyc-primary" | "lyc-outline";
  size: "lyc" | "lyc-lg";
}): JSX.Element {
  const precheck = useFullLengthPhonePrecheck();
  const href = sessionPath(sessionId);
  return (
    <>
      <Button asChild variant={variant} size={size}>
        <Link
          href={href}
          className="no-underline"
          data-testid="tests-resume"
          onClick={precheck.onLinkClick(href)}
        >
          Resume
        </Link>
      </Button>
      {precheck.dialog}
    </>
  );
}

function StartButton({
  formId,
  mode,
  variant,
  size,
  label,
}: {
  formId: string;
  mode: ExamMode;
  variant: "lyc-primary" | "lyc-outline";
  size: "lyc" | "lyc-lg";
  label: string;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const precheck = useFullLengthPhonePrecheck();

  const start = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const session = await createExamSession(formId, mode);
      await queryClient.invalidateQueries({ queryKey: examKeys.forms() });
      navigate(sessionPath(session.session_id));
    } catch (e: unknown) {
      const existing = existingSessionId(e);
      if (existing !== null) {
        navigate(sessionPath(existing));
        return;
      }
      setPending(false);
      setError(
        "We couldn't start the full-length test. Check your connection and try again.",
      );
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        variant={variant}
        size={size}
        pending={pending}
        // OQ-63: the shared phone pre-start check runs before the create request.
        onClick={() => precheck.run(() => void start())}
        data-testid="tests-start"
      >
        {/* QA item 5 (2026-10-07): the pressed Start says so until the sitting opens. */}
        {pending ? STARTING_LABEL : label}
      </Button>
      {precheck.dialog}
      {error !== null ? (
        <p role="alert" className="m-0 text-lyc-meta-lg text-lyc-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Before you start" (prototype list) and the timing choice the create request carries (Doc 04A
 * §7.3; the pre-redesign start panel's two options, its copy unchanged).
 */
function BeforeYouStart({
  mode,
  onModeChange,
}: {
  mode: ExamMode;
  onModeChange: (mode: ExamMode) => void;
}): JSX.Element {
  const option = (value: ExamMode, title: string, body: string) => (
    <label
      htmlFor={`timing-${value}`}
      className={cn(
        "flex flex-1 cursor-pointer items-start gap-3 rounded-md border p-4",
        mode === value
          ? "border-lyc-ink-strong bg-lyc-sheet"
          : "border-lyc-rule bg-transparent",
      )}
    >
      <input
        type="radio"
        id={`timing-${value}`}
        name="exam-timing"
        value={value}
        checked={mode === value}
        onChange={() => onModeChange(value)}
        className="mt-1 h-[18px] w-[18px] accent-lyc-ink-strong focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus"
      />
      <span className="flex flex-col gap-1">
        <span className="text-[17px] font-semibold text-lyc-ink">{title}</span>
        <span className="text-lyc-meta-lg leading-normal text-lyc-muted">
          {body}
        </span>
      </span>
    </label>
  );
  return (
    <section
      aria-labelledby="before-h"
      className="flex flex-col gap-3.5"
      data-testid="tests-before"
    >
      <h2 id="before-h" className={SECTION_H2}>
        Before you start
      </h2>
      <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-[22px] text-[18px] leading-relaxed text-lyc-ink">
        <li>{BEFORE_YOU_START_FIRST}</li>
        <li data-testid="tests-before-timing">
          {BEFORE_YOU_START_TIMING[mode]}
        </li>
        {BEFORE_YOU_START_REST.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <fieldset className="m-0 mt-2 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 text-lyc-meta-lg font-semibold text-lyc-muted">
          Timing
        </legend>
        <div className="flex flex-col gap-3 md:flex-row">
          {option(
            "strict",
            "Test-day timing",
            "The clock keeps running if you close the tab. Nothing pauses.",
          )}
          {option(
            "lenient",
            "Practice timing",
            "The clock pauses when you step away. Your report says so.",
          )}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * Right panel: every scored test, newest first, each a link to its report (OQ-30). The
 * disclosure (§15.1) closes the list: each row's score is one of the scores it describes. When
 * the rows carry different disclosure texts (two scoring versions), each row draws its own.
 */
function ScoreHistory({
  rows,
}: {
  rows: readonly ExamScoredSessionRow[];
}): JSX.Element {
  const summaries = new Set(rows.map((r) => r.disclosure.summary));
  const shared = summaries.size === 1 ? (rows[0]?.disclosure ?? null) : null;
  return (
    <section
      aria-labelledby="tests-hist-h"
      className="flex flex-col gap-2.5"
      data-testid="tests-history"
    >
      <h2 id="tests-hist-h" className={PANEL_H2}>
        Score history
      </h2>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li key={row.session_id}>
            <Link
              href={reportPath(row.session_id)}
              className="flex flex-col gap-1 border-b border-lyc-rule-soft py-3 text-lyc-ink no-underline hover:bg-lyc-hover"
              data-testid="tests-history-row"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-lyc-body font-semibold">
                  {displayFormName(row.test_form_name)}
                </span>
                <span
                  className="font-lyc-serif text-[24px] font-semibold text-lyc-ink-strong"
                  data-testid="tests-history-total"
                >
                  {row.total_scaled}
                </span>
              </span>
              <span className="text-lyc-meta-lg text-lyc-muted">
                {historyLine(row)}
              </span>
            </Link>
            {shared === null ? (
              <DisclosureNote disclosure={row.disclosure} className={NOTE} />
            ) : null}
          </li>
        ))}
      </ul>
      {shared !== null ? (
        <DisclosureNote disclosure={shared} className={NOTE} />
      ) : null}
    </section>
  );
}
