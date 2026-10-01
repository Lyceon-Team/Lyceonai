/**
 * Tests home: /tests — the forms, their state, and the start panel.
 *
 * @spec [Doc-04A_V2.2 §7.3 (create: test_form_id + mode, lenient default §8.6),
 *        §16 as amended by SCL-147 (GET /api/tests/forms)]
 *       [E7b owner rulings 2 (state words on the card, never a score — 04C §15.1)
 *        and 3 (no break checkbox: the create payload has no such field)]
 * @implemented [2026-09-25]
 *
 * plain English: one card per published form with the student's words for its
 * latest attempt. "Start test" opens the start panel for that form: timing is the
 * only choice (test-day or practice) because it is the only one the create request
 * carries. "Begin Reading and Writing" creates the session and starts Module 1; if a
 * session is already in progress the server says so (409 existing_active_session)
 * and the student is taken to it instead.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import type { ExamMode } from "@lyceon/shared/exam-runtime-schema";
import type { ExamFormsResponse } from "@lyceon/shared/exam-report-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import { AppShell } from "@/components/layout/app-shell";
import {
  createExamSession,
  existingSessionId,
  fetchExamForms,
  startExamModule,
} from "../api/exam-api";
import { examKeys } from "../api/keys";
import { modulePath, reportPath, sessionPath } from "../lib/exam-position";
import { formCardStateLabel, minutesLabel } from "../lib/labels";
import "../exam.css";

type Form = ExamFormsResponse["forms"][number];

const IN_PROGRESS = new Set(["created", "active", "section_break"]);

function formFacts(form: Form): string {
  const total = form.sections.reduce((ms, s) => ms + s.module1_ms + s.module2_ms, 0);
  return `${form.question_count} questions · ${minutesLabel(total)}`;
}

function formPlan(form: Form): string {
  const parts = form.sections.map(
    (s) =>
      `${EXAM_SECTION_LABEL[s.section]} ${s.questions_per_module} × 2 at ${minutesLabel(s.module1_ms)}`,
  );
  return `${parts.join(" · ")} · ${minutesLabel(form.break_duration_ms)} break`;
}

const primaryButton =
  "flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--exam-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--exam-accent-hover)] disabled:opacity-50";
const secondaryButton =
  "flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[var(--exam-line)] bg-[var(--exam-surface)] px-4 text-sm font-semibold";

export default function TestsHomePage() {
  const forms = useQuery({ queryKey: examKeys.forms(), queryFn: fetchExamForms, staleTime: 0 });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="exam-root -mx-4 min-h-full px-4 py-8 md:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-serif text-[32px] font-semibold">Full-length tests</h1>
            <p className="m-0 text-sm text-[var(--exam-muted)]">
              Same structure, timing and tools as test day. Take it in one sitting.
            </p>
          </div>
          {forms.isPending && <p role="status">Loading tests…</p>}
          {forms.isError && (
            <p role="alert">
              We couldn't load the tests.{" "}
              <button type="button" className="underline" onClick={() => void forms.refetch()}>
                Try again
              </button>
            </p>
          )}
          {forms.data !== undefined && forms.data.forms.length === 0 && <p>No full-length tests are available yet.</p>}
          {forms.data !== undefined && forms.data.forms.length > 0 && (
            <>
              <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3" data-testid="exam-forms">
                {forms.data.forms.map((form) => (
                  <li key={form.test_form_id}>
                    <FormCard form={form} selected={selected === form.test_form_id} onStart={() => setSelected(form.test_form_id)} />
                  </li>
                ))}
              </ul>
              {selected !== null &&
                (() => {
                  const form = forms.data.forms.find((f) => f.test_form_id === selected);
                  return form === undefined ? null : <StartPanel key={form.test_form_id} form={form} />;
                })()}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function FormCard({ form, selected, onStart }: { form: Form; selected: boolean; onStart: () => void }) {
  const latest = form.latest_session;
  const label = formCardStateLabel(latest);
  const inProgress = latest !== null && IN_PROGRESS.has(latest.state);
  const hasReport = latest !== null && !inProgress && latest.state !== "abandoned_final";
  return (
    <article
      aria-label={form.name}
      className={[
        "flex h-full flex-col gap-3.5 rounded-[14px] border-[1.5px] p-5",
        selected ? "border-[var(--exam-accent)] bg-[var(--exam-accent-soft)]" : "border-[var(--exam-line)] bg-[var(--exam-surface)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--exam-muted)]">Full-length practice test</span>
        <h2 className="m-0 font-serif text-[22px] font-semibold">{form.name}</h2>
        <span className="text-[13px] text-[var(--exam-muted)]">{formFacts(form)}</span>
      </div>
      <span className="self-start rounded-full bg-[#EAE7E0] px-3 py-1 text-xs font-semibold" data-testid="exam-form-state">
        {label}
      </span>
      <div className="mt-auto flex flex-col gap-2">
        {inProgress && latest !== null ? (
          <Link href={sessionPath(latest.session_id)} className={primaryButton}>
            Resume test
          </Link>
        ) : (
          <>
            {hasReport && latest !== null && (
              <Link href={reportPath(latest.session_id)} className={secondaryButton}>
                View scores
              </Link>
            )}
            <button type="button" className={hasReport ? secondaryButton : primaryButton} disabled={!form.is_selectable} onClick={onStart}>
              {!form.is_selectable ? "Not available" : hasReport ? "Take again" : "Start test"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function StartPanel({ form }: { form: Form }) {
  const [mode, setMode] = useState<ExamMode>("strict");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const begin = async () => {
    setPending(true);
    setError(null);
    try {
      const session = await createExamSession(form.test_form_id, mode);
      await startExamModule(session.session_id, "RW", "1");
      await queryClient.invalidateQueries({ queryKey: examKeys.forms() });
      navigate(modulePath(session.session_id, "RW", "1"));
    } catch (e: unknown) {
      const existing = existingSessionId(e);
      if (existing !== null) {
        navigate(sessionPath(existing));
        return;
      }
      setPending(false);
      setError("We couldn't start the test. Check your connection and try again.");
    }
  };

  const option = (value: ExamMode, title: string, body: string) => (
    <label
      htmlFor={`timing-${value}`}
      className={[
        "flex flex-1 cursor-pointer items-start gap-3 rounded-[10px] border-[1.5px] p-3.5",
        mode === value ? "border-[var(--exam-accent)] bg-[var(--exam-accent-soft)]" : "border-[var(--exam-line)] bg-[var(--exam-surface)]",
      ].join(" ")}
    >
      <input
        type="radio"
        id={`timing-${value}`}
        name="exam-timing"
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
        className="mt-0.5 h-[18px] w-[18px] accent-[var(--exam-accent)]"
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[12.5px] leading-normal text-[var(--exam-muted)]">{body}</span>
      </span>
    </label>
  );

  return (
    <section aria-labelledby="exam-start-title" className="flex flex-col gap-5 rounded-[14px] border border-[var(--exam-line)] bg-[var(--exam-surface)] p-6" data-testid="exam-start-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--exam-line)] pb-3.5">
        <h2 id="exam-start-title" className="m-0 text-[15px] font-semibold">
          Before you start {form.name}
        </h2>
        <span className="text-[13px] text-[var(--exam-muted)]">{formPlan(form)}</span>
      </div>
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 text-xs font-semibold uppercase tracking-[0.09em] text-[var(--exam-muted)]">Timing</legend>
        <div className="flex flex-col gap-3 md:flex-row">
          {option("strict", "Test-day timing", "The clock keeps running if you close the tab. Nothing pauses.")}
          {option("lenient", "Practice timing", "The clock pauses when you step away. Your report says so.")}
        </div>
      </fieldset>
      {error !== null && (
        <p role="alert" className="m-0 text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-5">
        <button
          type="button"
          onClick={() => void begin()}
          disabled={pending}
          data-testid="exam-begin"
          className="min-h-[52px] rounded-[10px] bg-[var(--exam-accent)] px-8 text-base font-semibold text-white hover:bg-[var(--exam-accent-hover)] disabled:opacity-60"
        >
          Begin Reading and Writing
        </button>
        <span className="text-[13px] leading-relaxed text-[var(--exam-muted)]">
          The graphing calculator and reference sheet are built into Math.
          <br />
          Once a module is submitted you cannot return to it. There is a break between the two sections.
        </span>
      </div>
    </section>
  );
}
