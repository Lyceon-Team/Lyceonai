/**
 * Practice (`/practice`): choose what to practice, then start a session.
 *
 * @spec [student-UI register UI-51; DESIGN.md §1 (tokens only, 14px floor, one primary action),
 *        §2 (App shell: right panel, slim legal footer), §3 (Filter bar; Mastery row compact;
 *        Locked mastery card), §4 Practice; prototype Practice.dc.html (paid and free);
 *        evidence/wiring-table.md §4 Practice (the endpoint behind each element); register §2
 *        (free = 40 practice questions a day + unlimited review; mastery_level only; no raw
 *        accuracy; no bank counts; "Suggested for you" is paid-only), §6 UI-43 (the bar's value
 *        is `SessionCriteria`), OQ-21 (quota read), OQ-22 (criteria), OQ-23 (recent practice
 *        reuses /api/review/pool), OQ-29 (the feature-access map decides what is locked), OQ-49
 *        (this route comes off the light lock: route-shells.ts)] | @implemented [2026-10-03]
 *
 * plain English: the main column is the shared filter bar (Section switch, criteria chips with
 * "Clear all", cascading Domain / Skill / Difficulty), then "Your session" (a plain-language
 * summary of the choice, "Questions per session" 5 to 30, and Start, the ONE primary action; a
 * free plan adds its quota line), "Suggested for you" (paid: the section's two lowest-level
 * domains; the button sets the filter), "Pick up where you left off" when a practice session is
 * open (wiring table §4 "Open sessions"; not in the prototype, so placed after its sections), and
 * "Recent practice". The right panel is Mastery (compact rows, or the locked card)
 * and "How practice counts".
 *
 * WHAT START SENDS. Exactly the bar's value (`SessionCriteria`, OQ-22) and the chosen size to
 * `POST /api/practice/sessions`; the server owns the pool, the quota clamp and every refusal
 * (402 quota, 422 PRACTICE_POOL_EMPTY, 403 SESSION_LIMIT_EXCEEDED), each shown here in shipped
 * words with no count.
 *
 * NO GATED READS ON THE FREE PLAN. Mastery is read only when the feature-access map grants
 * `mastery_detail`; otherwise the panel shows the locked card, which opens the upgrade modal in
 * place with no request.
 *
 * Replaces the pre-redesign page: "Session Setup" (difficulty pills, domain and skill chips, the
 * Reading/Math start buttons), the Domain Library card and its "Open Topic Explorer" link, the
 * "Weekly Activity" card (day streak, questions in 7 days), "Quick Actions", and the diagnostic
 * CTA (DESIGN.md §4 Practice has none; Home's diagnostic card is the one diagnostic entry).
 * `/practice/topics` itself stays routed (OQ-3 is open).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import type { PracticeOpenSession } from "@lyceon/shared/practice-response-schema";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import {
  answeredLine,
  sessionTitle,
  toReviewLine,
} from "@/components/home/home-model";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { MasteryMeter } from "@/components/mastery/MasteryMeter";
import { MasteryRow } from "@/components/mastery/MasteryRow";
import { canonicalDomainNodes } from "@/components/mastery/domain-nodes";
import {
  DEFAULT_QUESTIONS_PER_SESSION,
  QUESTIONS_PER_SESSION_OPTIONS,
  endSessionBody,
  freeQuotaLine,
  parseQuestionsPerSession,
  recentPracticeRows,
  recentPracticeScope,
  sessionLimitLine,
  sessionSummary,
  startLabel,
  suggestedDomains,
  suggestionNote,
  type QuestionsPerSession,
} from "@/components/practice/practice-landing-model";
import {
  EMPTY_FILTER,
  FilterBar,
  Modal,
  Notice,
  PageHeader,
  type FilterBarValue,
} from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { browserLocalToday } from "@/features/calendar/lib/dates";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { usePractice } from "@/hooks/usePractice";
import { usePracticeQuota } from "@/hooks/usePracticeQuota";
import { usePracticeTopics } from "@/hooks/usePracticeTopics";
import { useReviewPool } from "@/hooks/useReview";
import { fetchMasteryDomains, type MasterySection } from "@/lib/masteryApi";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { dayHeaderLabel } from "@/lib/review-session-picker";
import { sectionDisplayLabel } from "@shared/section-display";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const PANEL_H2 =
  "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

/** The prototype opens on Math (`section: 'M'`). */
const INITIAL_CRITERIA: FilterBarValue = { ...EMPTY_FILTER, sections: ["M"] };

const MASTERY_SECTIONS: readonly MasterySection[] = ["M", "RW"];

function masterySectionOf(criteria: FilterBarValue): MasterySection {
  return criteria.sections[0] === "RW" ? "RW" : "M";
}

export default function Practice(): JSX.Element {
  const { user } = useSupabaseAuth();
  const studentId = user?.id ?? "";
  const [, navigate] = useLocation();
  const access = useFeatureAccess();
  const upgrade = useUpgradeModal();
  const masteryAccess = access?.mastery_detail ?? null;
  const masteryGranted = masteryAccess?.access === "granted";

  const topics = usePracticeTopics();
  const quota = usePracticeQuota();
  const open = useActiveSessions();
  const pool = useReviewPool();
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
    enabled: masteryGranted && studentId.length > 0,
  });
  const practice = usePractice();

  const [criteria, setCriteria] = useState<FilterBarValue>(INITIAL_CRITERIA);
  const [size, setSize] = useState<QuestionsPerSession>(
    DEFAULT_QUESTIONS_PER_SESSION,
  );
  const [isStarting, setIsStarting] = useState(false);

  const section = masterySectionOf(criteria);
  const openRows = open.sessions.filter((s) => s.mode !== "diagnostic");
  const atLimit =
    open.maxConcurrentSessions !== null &&
    open.sessions.length >= open.maxConcurrentSessions;
  const quotaOut =
    quota.data !== undefined &&
    !quota.data.unlimited &&
    quota.data.remaining === 0;
  const sectionNodes =
    mastery.data !== undefined
      ? canonicalDomainNodes(mastery.data.domains, [section])
      : [];

  const start = async (): Promise<void> => {
    setIsStarting(true);
    const sessionId = await practice.startSession({
      criteria,
      targetQuestionCount: size,
    });
    setIsStarting(false);
    if (sessionId) navigate(`/practice/session/${sessionId}`);
  };

  const failed =
    quota.isError || open.isError || pool.isError || mastery.isError;

  return (
    <div className="flex flex-col gap-9" data-testid="practice">
      <PageHeader
        title="Practice"
        description="Choose a section, then narrow it down by domain, skill and difficulty."
      />

      {failed ? (
        <Notice
          title="We couldn’t load this right now."
          message="Try again. If this keeps happening, refresh the page."
          actionLabel="Try again"
          onAction={() => {
            void quota.refetch();
            void open.refetch();
            pool.refetch();
            void mastery.refetch();
          }}
          data-testid="practice-load-error"
        />
      ) : null}

      {topics.data !== undefined ? (
        <FilterBar
          taxonomy={topics.data}
          value={criteria}
          onChange={setCriteria}
        />
      ) : topics.isError ? (
        <Notice
          title="We couldn’t load this right now."
          message="Try again. If this keeps happening, refresh the page."
          actionLabel="Try again"
          onAction={() => void topics.refetch()}
          data-testid="practice-topics-error"
        />
      ) : (
        <Skeleton
          variant="lyc"
          className="h-[236px] w-full"
          data-testid="practice-topics-loading"
        />
      )}

      <YourSession
        taxonomy={topics.data ?? null}
        criteria={criteria}
        size={size}
        onSize={setSize}
        canStart={
          topics.data !== undefined && !isStarting && !atLimit && !quotaOut
        }
        starting={isStarting}
        onStart={() => void start()}
        quota={
          quota.data !== undefined && !quota.data.unlimited
            ? { remaining: quota.data.remaining, limit: quota.data.limit }
            : null
        }
        limitLine={
          atLimit && open.maxConcurrentSessions !== null
            ? sessionLimitLine(open.maxConcurrentSessions)
            : null
        }
        quotaOut={quotaOut || practice.quotaExhausted}
        poolEmpty={practice.poolEmpty}
        error={
          practice.error !== null &&
          !practice.quotaExhausted &&
          !practice.poolEmpty
            ? practice.error
            : null
        }
      />

      {masteryGranted && sectionNodes.length > 0 ? (
        <Suggested
          sectionName={sectionDisplayLabel(section) ?? section}
          nodes={suggestedDomains(sectionNodes)}
          onPick={(domain) =>
            setCriteria((prev) => ({
              ...prev,
              sections: [section],
              domains: [domain],
              skills: [],
            }))
          }
        />
      ) : null}

      {openRows.length > 0 ? (
        <OpenSessions
          rows={openRows}
          ending={open.isTerminating}
          onEnd={(id) => open.terminateSession(id)}
        />
      ) : null}

      <RecentPractice
        sessions={recentPracticeRows(pool.pool?.sessions ?? [])}
        todayKey={browserLocalToday()}
      />

      <AppShellPanel>
        <div className="flex flex-col gap-9" data-testid="practice-panel">
          <section
            aria-labelledby="practice-mastery-h"
            className="flex flex-col gap-4"
            data-testid="practice-mastery"
          >
            <h2 id="practice-mastery-h" className={PANEL_H2}>
              Mastery
            </h2>
            {masteryGranted && mastery.data !== undefined ? (
              <>
                {/* The chosen section first (prototype: `mastery.reverse()` for RW). */}
                {[
                  section,
                  ...MASTERY_SECTIONS.filter((s) => s !== section),
                ].map((s) => (
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
                          href="/mastery"
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
          <section
            aria-labelledby="practice-how-h"
            className="flex flex-col gap-2.5"
            data-testid="practice-how"
          >
            <h2 id="practice-how-h" className={PANEL_H2}>
              How practice counts
            </h2>
            <p className="m-0 text-base leading-relaxed text-lyc-ink">
              Every answer updates your mastery. Anything you miss or skip goes
              to your review queue.
            </p>
          </section>
        </div>
      </AppShellPanel>
    </div>
  );
}

function YourSession({
  taxonomy,
  criteria,
  size,
  onSize,
  canStart,
  starting,
  onStart,
  quota,
  limitLine,
  quotaOut,
  poolEmpty,
  error,
}: {
  taxonomy: PracticeTopicsResponse | null;
  criteria: FilterBarValue;
  size: QuestionsPerSession;
  onSize: (size: QuestionsPerSession) => void;
  canStart: boolean;
  /** QA item 5 (2026-10-07): Start was pressed and the create request is in flight. */
  starting: boolean;
  onStart: () => void;
  /** Today's free quota; null for an unlimited plan (or before it is read). */
  quota: { remaining: number; limit: number } | null;
  limitLine: string | null;
  quotaOut: boolean;
  poolEmpty: boolean;
  error: string | null;
}): JSX.Element {
  return (
    <section
      aria-labelledby="practice-start-h"
      className="flex flex-col gap-4 border-t border-lyc-rule pt-7"
      data-testid="practice-session"
    >
      <h2 id="practice-start-h" className={SECTION_H2}>
        Your session
      </h2>
      {taxonomy !== null ? (
        <p
          className="m-0 text-[18px] leading-relaxed text-lyc-ink"
          data-testid="practice-summary"
        >
          {sessionSummary(taxonomy, criteria)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-3 text-[17px] text-lyc-ink">
          <span>Questions per session</span>
          <select
            value={String(size)}
            onChange={(event) => {
              const next = parseQuestionsPerSession(event.target.value);
              if (next !== null) onSize(next);
            }}
            className="h-11 rounded-md border border-lyc-input-bd bg-lyc-sheet px-3 text-[17px] text-lyc-ink focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus"
            data-testid="practice-size"
          >
            {QUESTIONS_PER_SESSION_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          disabled={!canStart}
          pending={starting}
          onClick={onStart}
          data-testid="practice-start"
        >
          {starting ? STARTING_LABEL : startLabel(size)}
        </Button>
      </div>
      {quota !== null ? (
        <p
          className="m-0 text-[17px] leading-normal text-lyc-muted"
          data-testid="practice-quota"
        >
          {freeQuotaLine(quota.remaining, quota.limit)}
        </p>
      ) : null}
      {limitLine !== null ? (
        <Notice tone="warning" title={limitLine} data-testid="practice-limit" />
      ) : null}
      {/*
        ONE CTA CARD for the daily limit (the shipped `PremiumUpgradePrompt`, which resolves the
        destination from the role and reaches the reactivate state for a lapsed subscriber).
        Shown when the quota read says none are left, or when Start answered 402.
      */}
      {quotaOut ? (
        <PremiumUpgradePrompt featureBenefit="unlimited daily practice" />
      ) : null}
      {/*
        @spec [Doc-02B_V4 §14; owner ruling UI-07 2026-09-29] | @implemented [2026-09-29]
        plain English: session start answers 422 PRACTICE_POOL_EMPTY when the chosen filters
        select no questions. That says "change the filters", and it names no count.
      */}
      {poolEmpty ? (
        <Notice
          title="No questions match these filters"
          message="Try a different combination of domains, skills or difficulty."
          data-testid="practice-pool-empty"
        />
      ) : null}
      {error !== null ? (
        <Notice
          tone="danger"
          title="Something went wrong."
          message={error}
          data-testid="practice-start-error"
        />
      ) : null}
    </section>
  );
}

function OpenSessions({
  rows,
  ending,
  onEnd,
}: {
  rows: readonly PracticeOpenSession[];
  ending: boolean;
  onEnd: (sessionId: string) => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState<PracticeOpenSession | null>(
    null,
  );
  return (
    <section
      aria-labelledby="practice-open-h"
      className="flex flex-col gap-3.5"
      data-testid="practice-open"
    >
      <h2 id="practice-open-h" className={SECTION_H2}>
        Pick up where you left off
      </h2>
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        {rows.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-lyc-rule py-4"
            data-testid="practice-open-row"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-lg font-semibold text-lyc-ink">
                {sessionTitle("practice", s.criteria, s.section)}
              </span>
              <span className="text-base text-lyc-muted">
                {answeredLine(s.answered_items, s.total_items)}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="lyc-quiet"
                disabled={ending}
                onClick={() => setConfirming(s)}
              >
                End
              </Button>
              <Link href={`/practice/session/${s.id}`} className={TEXT_LINK}>
                Continue
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title="End this session?"
        description={
          confirming !== null
            ? endSessionBody(confirming.answered_items, confirming.total_items)
            : undefined
        }
        data-testid="practice-end-modal"
        footer={
          <>
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              onClick={() => {
                if (confirming !== null) onEnd(confirming.id);
                setConfirming(null);
              }}
            >
              End session
            </Button>
            <Button
              type="button"
              variant="lyc-quiet"
              size="lyc-lg"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </>
        }
      />
    </section>
  );
}

function Suggested({
  sectionName,
  nodes,
  onPick,
}: {
  sectionName: string;
  nodes: ReturnType<typeof suggestedDomains>;
  onPick: (domain: string) => void;
}): JSX.Element {
  return (
    <section
      aria-labelledby="practice-sug-h"
      className="flex flex-col gap-3.5"
      data-testid="practice-suggested"
    >
      <div className="flex flex-col gap-1">
        <h2 id="practice-sug-h" className={SECTION_H2}>
          Suggested for you
        </h2>
        <p className="m-0 text-[17px] text-lyc-muted">
          {suggestionNote(sectionName)}
        </p>
      </div>
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        {nodes.map((node) => (
          <li
            key={node.domain}
            className="flex flex-col gap-3 border-b border-lyc-rule py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_176px_190px] sm:items-center sm:gap-6"
            data-testid="practice-suggestion"
            data-level-key={node.levelKey}
          >
            <span className="flex flex-col gap-1">
              <span className="font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
                {node.domain}
              </span>
              <span className="text-base text-lyc-muted">
                {node.displayName}
              </span>
            </span>
            <MasteryMeter
              levelKey={node.levelKey}
              displayName={node.displayName}
              size="wide"
            />
            <Button
              type="button"
              variant="lyc-outline"
              className="sm:justify-self-end"
              aria-label={`Practice this domain: ${node.domain}`}
              onClick={() => onPick(node.domain)}
            >
              Practice this domain
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentPractice({
  sessions,
  todayKey,
}: {
  sessions: ReturnType<typeof recentPracticeRows>;
  todayKey: string;
}): JSX.Element {
  return (
    <section
      aria-labelledby="practice-past-h"
      className="flex flex-col gap-3.5"
      data-testid="practice-recent"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="practice-past-h" className={SECTION_H2}>
          Recent practice
        </h2>
        <Link href="/review" className={TEXT_LINK}>
          Review what you missed
        </Link>
      </div>
      {sessions.length > 0 ? (
        <ul className="m-0 list-none border-t border-lyc-rule p-0">
          {sessions.map((s) => (
            <li
              key={s.source_session_id}
              className="flex items-center justify-between gap-6 border-b border-lyc-rule py-3.5"
              data-testid="practice-recent-row"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-lg font-semibold text-lyc-ink">
                  {s.local_time === null
                    ? dayHeaderLabel(s.local_date, todayKey)
                    : `${dayHeaderLabel(s.local_date, todayKey)}, ${s.local_time}`}
                </span>
                <span className="text-base text-lyc-muted">
                  {recentPracticeScope(s.mode)}
                </span>
              </span>
              <span className="whitespace-nowrap text-base text-lyc-ink">
                {toReviewLine(s.open_count)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
