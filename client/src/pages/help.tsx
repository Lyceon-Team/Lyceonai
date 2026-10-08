/**
 * Help (`/help`): seven questions, how to reach us, and the policies.
 *
 * @spec [DESIGN.md §4 Help ("Seven FAQs, which are approved copy; 'Contact support'; the Policies
 *        list; the footer. The Help rail item opens it"), §2 (App shell, slim footer on Help);
 *        prototype Help.dc.html; student-UI register OQ-46 (owner ruling 2026-10-03: `/legal`
 *        until the Help page lands in Wave 5; it lands here, and HELP_PATH now points at it),
 *        OQ-39 (a) Trust and Safety → `/legal/trust-and-safety`, (d) Contact support is
 *        `mailto:` the address `SUPPORT_EMAIL` holds; OQ-38 (the ruled "what a guardian can see"
 *        sentence); evidence/wiring-table.md §12] | @implemented [2026-10-03]
 *
 * plain English: a static page. The questions open one at a time (the first starts open, as in
 * the prototype); each is a button with `aria-expanded`. "Contact support" is a mailto link to
 * the one support address. The policies link to the existing public legal routes. The one
 * request is `GET /api/practice/quota` (`useFreeDailyLimit`), for the free plan's daily number
 * in the first answer (OQ-68 (d), Karl, 2026-10-08, UI-64); until it answers, that answer says
 * "daily practice questions" with no number.
 *
 * COPY. Every question and answer is the prototype's approved text, with one exception: the
 * guardian answer uses the sentence the owner ruled for "what a guardian can see" (OQ-38,
 * 2026-10-02), because the prototype's "your mastery and your test scores" is the wording that
 * ruling corrected (a guardian also sees the plan and the projection). Reported as an owner
 * question in the UI-58 report.
 */
import { useId, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/student-ui";
import { buttonVariants, LYC_FOCUS } from "@/components/ui/button";
import { GUARDIAN_VISIBILITY_SENTENCE } from "@/components/settings/LinkSection";
import { useFreeDailyLimit } from "@/hooks/usePracticeQuota";
import { PLAN_PAID_ADDS, planFreeIncludes } from "@/lib/plan-copy";
import { SUPPORT_EMAIL } from "@/lib/support-contact";
import { cn } from "@/lib/utils";
import { FeedbackButton } from "@/components/product-feedback/FeedbackDialog";
import { useFeedbackAudience } from "@/lib/product-feedback-api";

/**
 * The seven questions. The first answer carries the free plan's daily limit from the server
 * (`freeDailyLimit`, OQ-68 (d)); null prints the sentence without a number.
 */
export function helpFaqs(
  freeDailyLimit: number | null,
): readonly { q: string; a: string }[] {
  return [
    {
      q: "What is free, and what needs a paid plan?",
      // One source with the plans page (OQ-59 (h)): `client/src/lib/plan-copy.ts`.
      a: `${planFreeIncludes(freeDailyLimit)} ${PLAN_PAID_ADDS}`,
    },
    ...HELP_FAQS_REST,
  ];
}

const HELP_FAQS_REST: readonly { q: string; a: string }[] = [
  {
    q: "How is my projected score worked out?",
    a: "It comes from your mastery across the eight SAT domains. The range is wide at first and narrows as you answer more questions.",
  },
  {
    q: "How does review work?",
    a: "Every question you miss or skip goes into your review queue. Get it right once and it leaves the queue. Miss it again and it goes to the back of the line.",
  },
  {
    q: "Is my Lyceon score an official SAT score?",
    a: "No. It is a Lyceon-modeled SAT score based on your work here. Your official College Board score may differ.",
  },
  {
    q: "What can my guardian see?",
    a: GUARDIAN_VISIBILITY_SENTENCE,
  },
  {
    q: "How do I manage or cancel my plan?",
    a: "Go to Settings, then Billing, and choose Manage billing. If your guardian pays for your plan, they manage it from their own account.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Settings, then Account, and choose Delete account. We'll email you a link to cancel during the waiting period. After that, your account and progress are permanently deleted.",
  },
];

export const HELP_POLICIES: readonly { label: string; href: string }[] = [
  { label: "Privacy Policy", href: "/legal/privacy-policy" },
  { label: "Terms of Use", href: "/legal/student-terms" },
  { label: "Trust and Safety", href: "/legal/trust-and-safety" },
];

const H2 =
  "m-0 font-lyc-serif text-[24px] font-semibold tracking-normal text-lyc-ink-strong";

function FeedbackHelpBox(): JSX.Element | null {
  const headingId = useId();
  if (useFeedbackAudience() === null) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8"
      data-testid="help-feedback"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className={H2}>
          Have an idea or a problem?
        </h2>
        <p className="m-0 text-[17px] text-lyc-muted">
          Send the Lyceon team private feedback. Only the team sees it.
        </p>
      </div>
      <FeedbackButton source="help" variant="lyc" />
    </section>
  );
}

export default function HelpPage(): JSX.Element {
  const [open, setOpen] = useState<number>(0);
  const faqs = helpFaqs(useFreeDailyLimit());
  const faqId = useId();
  const contactId = useId();
  const policiesId = useId();

  return (
    <div className="flex flex-col gap-10" data-testid="help-page">
      <PageHeader
        title="Help"
        description="Answers to common questions, and how to reach us."
      />

      <section aria-labelledby={faqId} className="flex flex-col gap-3.5">
        <h2
          id={faqId}
          className="m-0 font-lyc-serif text-lyc-section font-semibold tracking-normal text-lyc-ink-strong"
        >
          Frequently asked questions
        </h2>
        <div className="border-t border-lyc-rule" data-testid="help-faqs">
          {faqs.map((faq, index) => {
            const expanded = open === index;
            const answerId = `${faqId}-a${index}`;
            return (
              <div
                key={faq.q}
                className="border-b border-lyc-rule"
                data-testid="help-faq"
              >
                <h3 className="m-0 tracking-normal">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={answerId}
                    onClick={() => setOpen(expanded ? -1 : index)}
                    className={cn(
                      LYC_FOCUS,
                      "flex w-full items-center justify-between gap-4 bg-transparent px-1 py-[18px] text-left text-[19px] font-semibold text-lyc-ink-strong",
                    )}
                  >
                    <span>{faq.q}</span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden="true"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={cn("shrink-0", expanded ? "rotate-180" : "")}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </h3>
                {expanded ? (
                  <p
                    id={answerId}
                    className="m-0 max-w-[700px] px-1 pb-5 text-[18px] leading-relaxed text-lyc-ink"
                  >
                    {faq.a}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby={contactId}
        className="flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8"
        data-testid="help-contact"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={contactId} className={H2}>
            Still need help?
          </h2>
          <p className="m-0 text-[17px] text-lyc-muted">
            Send us a message and we&apos;ll get back to you by email.
          </p>
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className={cn(
            buttonVariants({ variant: "lyc-primary", size: "lyc-lg" }),
            "shrink-0 self-start no-underline sm:self-auto",
          )}
          data-testid="help-contact-support"
        >
          Contact support
        </a>
      </section>

      {/* @spec [plan R28, Q6 ("private feedback ... always available from Help and Settings");
          owner answers 2026-10-05] | @implemented [2026-10-05] | plain English: the private
          feedback entry, for every student at any age. */}
      <FeedbackHelpBox />

      <section aria-labelledby={policiesId} className="flex flex-col gap-3">
        <h2 id={policiesId} className={H2}>
          Policies
        </h2>
        <ul
          className="m-0 flex list-none flex-col gap-2.5 p-0 text-[18px]"
          data-testid="help-policies"
        >
          {HELP_POLICIES.map((policy) => (
            <li key={policy.href}>
              <Link
                href={policy.href}
                className={cn(
                  LYC_FOCUS,
                  "text-lyc-ink-strong underline underline-offset-4 hover:no-underline",
                )}
              >
                {policy.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
