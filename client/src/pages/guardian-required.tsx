/**
 * @spec [Guardian_Closure_Plan G2-04; owner ruling R6 (2026-09-27); SCL-187 rule 1; owner approval
 *       2026-09-29 ("a dedicated /guardian-required page built from the canonical
 *       StudentLinkCodePanel and StudentGuardiansPanel"); Student Terms §under-13; Coding
 *       Standards §11.1, §11.3] | @implemented [2026-09-29]
 *
 * plain English: where an under-13 student lands while no guardian link is active. It says why in
 * one sentence and links the Terms rather than restating them, then hands over every means of
 * getting connected — the canonical link-code panel (the code, copy, regenerate, the email invite)
 * and the canonical guardian list — and a sign-out. Nothing here is a second copy of either panel.
 *
 * NOT A CLIENT GATE. The server refuses every learning request with 403 GUARDIAN_LINK_REQUIRED
 * (`requireGuardianLinkForUnder13`), read live from the link on each request. This page only
 * spares the student a trip through refused pages. It asks the server whether a guardian is still
 * needed (`guardianConsentRequired` on GET /api/profile) every 15 seconds and moves on to the
 * dashboard as soon as the answer is no — so a guardian redeeming the code while the student
 * waits lets them straight in.
 *
 * edge cases: the profile read failing or still loading keeps the panels on screen (they are
 * reachable either way); an adult or linked student who opens this URL is sent to the dashboard.
 *
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card"] | @implemented [2026-10-03]
 * UI-59: drawn with the student tokens only, inside the Bare card. Copy and behaviour unchanged.
 * The "why" sentence is a margin note (--margin, hairline --rule) where it was a shadcn Alert with
 * role="alert": it is the page's standing explanation, not an error. Sign out stays an outline
 * button; the link-code panel's own actions carry the page's work.
 */
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button, LYC_INLINE_LINK } from "@/components/ui/button";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { profileQuery, type ProfileHydration } from "@/hooks/useProfileQuery";
import { StudentLinkCodePanel } from "@/components/student/StudentLinkCodePanel";
import { StudentGuardiansPanel } from "@/components/student/StudentGuardiansPanel";

const GUARDIAN_CHECK_INTERVAL_MS = 15_000;

/** The one field this page reads from GET /api/profile — parsed, never cast. */
const guardianRequirementSchema = z.object({
  user: z.object({ guardianConsentRequired: z.boolean().optional() }),
});

export default function GuardianRequired() {
  const { user, signOut } = useSupabaseAuth();
  // UI-14 (merged from `cleanup`): the ONE profile query — same key and fetch function as the
  // auth provider and RequireRole — polled here. The result is still parsed below, never cast.
  const { data } = useQuery<ProfileHydration, Error>({
    ...profileQuery,
    refetchInterval: GUARDIAN_CHECK_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const parsed = guardianRequirementSchema.safeParse(data);
  if (parsed.success && parsed.data.user.guardianConsentRequired !== true) {
    return <Redirect to="/dashboard" replace />;
  }

  if (!user) return null;

  return (
    <div className="flex flex-col gap-6" data-testid="guardian-required">
      <div>
        <BareCardHeader title="Connect a guardian to get started" />
        <p
          className="m-0 rounded-lg border border-lyc-rule bg-lyc-margin px-4 py-3 text-lyc-body text-lyc-ink"
          data-testid="guardian-required-why"
        >
          Because you&rsquo;re under 13, a parent or guardian needs to connect
          to your account before you can start studying. This is part of the{" "}
          <a
            href="/legal/student-terms"
            target="_blank"
            rel="noopener noreferrer"
            className={LYC_INLINE_LINK}
          >
            Student Terms
          </a>
          .
        </p>
      </div>

      <StudentLinkCodePanel studentId={user.id} />
      <StudentGuardiansPanel studentId={user.id} />

      <p className="m-0 text-lyc-body text-lyc-muted">
        {/* One string, so a formatter's line wrap never splits the sentence the N4 contract
            test (consent-never-blocks) reads from this source. */}
        {
          "Until a guardian connects, you’ll come back to this page whenever you sign in. As soon as they enter your code, you’ll go straight on to your dashboard."
        }
      </p>

      <Button
        variant="lyc-outline"
        className="self-start"
        onClick={() => void signOut()}
        data-testid="guardian-required-sign-out"
      >
        Sign out
      </Button>
    </div>
  );
}
