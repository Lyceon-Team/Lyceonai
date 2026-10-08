/**
 * Home for a free student (DESIGN.md §4 Home, "Free").
 *
 * @spec [DESIGN.md §3 (Locked mastery card, Ruler progress), §4 Home; prototype Main.dc.html
 *        (plan = free); evidence/wiring-table.md §3 Home (diagnostic card: practice
 *        `/sessions/open` diagnostic row; start: POST /api/practice/diagnostic/sessions; when to
 *        show the card: `estimateStatus`; quota: GET /api/practice/quota); register §2 (free:
 *        the diagnostic, the projection, 40 practice questions a day, unlimited review; the
 *        locked mastery card shows empty outlines only), OQ-21, OQ-36, OQ-39(c) (after the
 *        diagnostic: the free layout, the projection in the panel, "Go to practice" primary);
 *        owner ruling Q2 2026-08-17 (a finished diagnostic is never offered again)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the main column is the welcome, the diagnostic card (only while the student
 * has no baseline: a ruler of their own diagnostic's progress and "Start diagnostic", the ONE
 * primary action) and "How Lyceon works" (three steps tagged Free or Paid plans). Once the
 * diagnostic is done the card goes and "Go to practice" becomes the primary (OQ-39(c)). Last in
 * the column is the "Start a full-length test" card (owner ruling, Karl, 2026-10-05), locked
 * here: it opens the upgrade modal in place and reads nothing. The
 * right panel is the projected score (or why there is none yet), the locked mastery card
 * ("See what's included" opens the upgrade modal for `mastery_detail`) and today's quota.
 *
 * NO GATED READS. Nothing here calls a paid route: no calendar, no mastery, no exam forms. The
 * mastery card draws shapes only, and the modal opens in place with no request.
 *
 * edge cases: "N of 40 answered" is drawn only from an open diagnostic session (the count is
 * the student's own); before one exists the ruler is empty and no count is printed, because no
 * read states the diagnostic's length. While `estimateStatus` is unknown neither the card nor a
 * primary is shown, so nothing is offered on a guess.
 */
import { useLocation, Link } from "wouter";
import type { FeatureLockReason } from "@lyceon/shared/feature-access";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import {
  Notice,
  PageHeader,
  RulerProgress,
  rulerFill,
} from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";
import { useHomeProjection } from "@/hooks/useHomeProjection";
import { usePracticeQuota } from "@/hooks/usePracticeQuota";
import { FullLengthCard } from "./FullLengthCard";
import { HomeLoading } from "./HomeLoading";
import { ProjectionSection, QuotaSection } from "./HomePanel";
import { answeredLine, freeHomeStage } from "./home-model";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

const FREE_TAG = "border border-lyc-lv2-bd bg-lyc-lv2-bg text-lyc-lv2-ink";
const PAID_TAG = "bg-lyc-primary-bg text-lyc-primary-ink";

/** The prototype's three steps, verbatim (approved copy). */
const STEPS = [
  {
    n: "1",
    title: "Take the diagnostic",
    body: "Forty questions across every domain give you a projected score and a starting point.",
    tag: "Free",
    tone: FREE_TAG,
  },
  {
    n: "2",
    title: "Practice and review every day",
    body: "Forty practice questions a day, and every question you miss comes back until you get it right.",
    tag: "Free",
    tone: FREE_TAG,
  },
  {
    n: "3",
    title: "Follow a plan and track mastery",
    body: "A study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.",
    tag: "Paid plans",
    tone: PAID_TAG,
  },
] as const;

type FreeHomeProps = {
  studentId: string;
  name: string | null;
  /** Why mastery is locked (plan or age); the modal says the matching thing. */
  masteryLock: FeatureLockReason;
};

export function FreeHome({
  studentId,
  name,
  masteryLock,
}: FreeHomeProps): JSX.Element {
  const [, navigate] = useLocation();
  const upgrade = useUpgradeModal();
  const projection = useHomeProjection(studentId);
  const practice = useActiveSessions();
  const quota = usePracticeQuota();
  const diagnostic = useDiagnosticStart();
  const stage = freeHomeStage(projection.estimateStatus);

  const openDiagnostic =
    practice.sessions.find((s) => s.mode === "diagnostic") ?? null;
  const trimmed = name?.trim() ?? "";

  const startDiagnostic = async (): Promise<void> => {
    const sessionId = await diagnostic.startDiagnostic();
    if (sessionId) navigate(`/practice/session/${sessionId}`);
  };

  const failed = projection.isError || practice.isError || quota.isError;
  // QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): the stage (the
  // diagnostic card above "How Lyceon works") and the panel come from these reads, so the page
  // is drawn once they have answered or failed (HomeLoading.tsx).
  const settled =
    !projection.isLoading && !practice.isLoading && !quota.isLoading;
  if (!settled) return <HomeLoading />;

  return (
    <div className="flex flex-col gap-12" data-testid="home" data-plan="free">
      <PageHeader
        title={
          trimmed.length > 0
            ? `Welcome to Lyceon, ${trimmed}`
            : "Welcome to Lyceon"
        }
        description={
          stage === "diagnostic"
            ? "Study smarter, score higher. Start with the free diagnostic so your practice begins in the right place."
            : "Study smarter, score higher."
        }
      />

      {failed ? (
        <Notice
          title="We couldn’t load part of your dashboard."
          message="Try again. If this keeps happening, refresh the page."
          actionLabel="Try again"
          onAction={() => {
            projection.refetch();
            void practice.refetch();
            void quota.refetch();
          }}
          data-testid="home-load-error"
        />
      ) : null}

      {stage === "diagnostic" ? (
        <section
          aria-labelledby="home-diag-h"
          className="flex flex-col gap-[22px] rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:px-10 sm:py-9"
          data-testid="home-diagnostic"
        >
          <h2
            id="home-diag-h"
            className="m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong"
          >
            Your free diagnostic
          </h2>
          <p className="m-0 max-w-[600px] text-[18px] leading-relaxed text-lyc-ink">
            40 questions, five from each of the eight SAT domains. When you
            finish, you&apos;ll see your projected SAT score.
          </p>
          <div className="flex flex-col gap-2.5">
            <RulerProgress
              size="card"
              filled={
                openDiagnostic === null
                  ? 0
                  : rulerFill(
                      openDiagnostic.answered_items,
                      openDiagnostic.total_items,
                    )
              }
              data-testid="home-diagnostic-ruler"
            />
            {openDiagnostic !== null ? (
              <span className="text-base text-lyc-muted">
                {answeredLine(
                  openDiagnostic.answered_items,
                  openDiagnostic.total_items,
                )}
              </span>
            ) : null}
          </div>
          {diagnostic.error ? (
            <p role="alert" className="m-0 text-base text-lyc-danger">
              {diagnostic.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              pending={diagnostic.isStarting}
              onClick={() => void startDiagnostic()}
              data-testid="home-start-diagnostic"
            >
              {diagnostic.isStarting ? STARTING_LABEL : "Start diagnostic"}
            </Button>
            <span className="text-base text-lyc-muted">
              You can stop and pick up where you left off.
            </span>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="home-how-h"
        className="flex flex-col gap-[18px]"
        data-testid="home-how"
      >
        <h2 id="home-how-h" className={SECTION_H2}>
          How Lyceon works
        </h2>
        <ol className="m-0 list-none border-t border-lyc-rule p-0">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-lyc-rule py-[22px] sm:grid-cols-[56px_minmax(0,1fr)_160px] sm:gap-5"
            >
              <span
                aria-hidden="true"
                className="font-lyc-serif text-[34px] font-semibold leading-none text-lyc-step"
              >
                {step.n}
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
                  {step.title}
                </span>
                <span className="text-[17px] leading-normal text-lyc-muted">
                  {step.body}
                </span>
              </div>
              <span
                className={`col-start-2 justify-self-start whitespace-nowrap rounded-full px-3 py-1 text-lyc-meta-lg font-semibold sm:col-start-auto sm:justify-self-end ${step.tone}`}
              >
                {step.tag}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-6">
          {stage === "after" || stage === "pending" ? (
            <Button asChild variant="lyc-primary" size="lyc-lg">
              <Link href="/practice" data-testid="home-go-practice">
                Go to practice
              </Link>
            </Button>
          ) : (
            <Link
              href="/practice"
              className={TEXT_LINK}
              data-testid="home-go-practice"
            >
              Go to practice
            </Link>
          )}
          <Link href="/review" className={TEXT_LINK}>
            Go to review
          </Link>
        </div>
      </section>

      {/* Owner ruling (Karl, 2026-10-05) item 4: the full-length card, locked on the free plan
          (it opens the upgrade modal in place). Last in the column, after the free flow. */}
      <FullLengthCard />

      <AppShellPanel>
        <div className="flex flex-col gap-10" data-testid="home-panel">
          <ProjectionSection
            range={projection.range}
            stage={stage}
            targetScore={null}
          />
          <LockedMasteryCard
            onSeeWhatsIncluded={() =>
              upgrade.open("mastery_detail", masteryLock)
            }
          />
          {quota.data !== undefined ? (
            <QuotaSection quota={quota.data} />
          ) : null}
        </div>
      </AppShellPanel>
    </div>
  );
}
