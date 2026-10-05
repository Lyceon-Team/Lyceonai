/**
 * Mastery (`/mastery`): the student's level in every SAT domain, and each domain's skills.
 *
 * @spec [student-UI register UI-57, UI-37, UI-42; register §2 (mastery and KPIs are paid:
 *        `mastery_detail`; the free mastery slot is the locked card, empty outlines only; student
 *        surfaces show `mastery_level` only, no raw accuracy anywhere — Step 2 ruling 6, SCL-186;
 *        no confidence or vanity metrics — coding standards §10, §17); DESIGN.md §1 (tokens only,
 *        14px floor, one primary action), §2 (App shell), §3 (Mastery row: five segments filled to
 *        the level plus a level pill, unmeasured shows empty segments and a dashed "Not enough
 *        answers yet" pill; Locked mastery card), §4 "Not prototyped" ("the Mastery page (domain
 *        grid with mastery rows, then the skills list per domain)"); evidence/wiring-table.md §13
 *        (the backing: `/mastery/domains`, `/mastery/skills`, both `mastery_detail`); OQ-29 (the
 *        feature-access map decides what is locked); OQ-49 (this route comes off the light lock);
 *        OQ-51 ("Reading & Writing"); UI-41 (no right panel, no footer; the in-body back link
 *        was interim duplication and is removed); owner ruling 2026-08-20 RULE 1 (level names
 *        from `mastery_levels`), RULE 5 (domain first, then its skills), RULE 6 (unmeasured is
 *        its own state, one call to action, never one per row); owner ruling 2026-08-27 (one flat
 *        skills fetch, filtered per domain); OQ-58 (owner ruling 2026-10-05: "Practise" →
 *        "Practice", the app's US spelling)] | @implemented [2026-10-03; copy 2026-10-05]
 *
 * plain English: the page header, then the eight domains as wide mastery rows grouped by section
 * (Math, then Reading & Writing, the server's canonical order). Each domain row is a button that
 * opens that domain's skills beneath it, each skill again a mastery row. Every row shows the
 * level only: five segments filled to `mastery_level` and the level's server-sent name. There is
 * no percentage, accuracy, count of answers or score anywhere, because the payload carries none
 * (Doc 05B §10.5 projects `mastery_level` only) and nothing here derives one.
 *
 * FREE = THE LOCKED CARD, NO REQUEST. Both reads are gated by `mastery_detail`. When the
 * feature-access map says locked, the page draws `LockedMasteryCard` ("See what's included" opens
 * the upgrade modal for `mastery_detail` with the map's reason) and asks the server for nothing.
 * A server refusal (402 `entitlement_required`) draws the same card; the mastery queries carry no
 * inline meta, so the app's upgrade modal also opens on that refusal (UI-44), as before.
 *
 * Replaces the pre-redesign page: the in-body Back button and "Mastery" eyebrow, the domain cards
 * (`DomainGrid`, still the guardian Dashboard's), the separate skill screen with its "All domains"
 * button, `PremiumUpgradePrompt` and `RecoveryNotice`.
 *
 * edge cases: a domain the server did not send reads "Not enough answers yet" (canonical list,
 * `canonicalDomainNodes`); a domain whose catalogue is empty says so, distinct from a failed
 * read; the grid's one "Start practicing" shows only when nothing is measured (RULE 6) and each
 * opened domain with an unmeasured skill offers one outline "Practice <domain>".
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { MasteryRow } from "@/components/mastery/MasteryRow";
import { canonicalDomainNodes } from "@/components/mastery/domain-nodes";
import { Notice, PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { getEntitlementDenial } from "@/lib/api-error";
import {
  fetchMasteryDomains,
  fetchMasterySkills,
  skillsForDomain,
  type MasteryDomainNode,
  type MasterySection,
  type MasterySkillNode,
} from "@/lib/masteryApi";
import { sectionDisplayLabel } from "@shared/section-display";

const SECTION_H2 =
  "m-0 mb-1.5 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";

/** Math, then Reading & Writing: the server's order (`canonicalDomainPairs`). */
const SECTIONS: readonly MasterySection[] = ["M", "RW"];

/** Shipped copy (the pre-redesign page), unchanged. */
const RETRY_MESSAGE = "Try again. If this keeps happening, refresh the page.";

/** A refusal of THIS feature: only a `mastery_detail` denial draws the locked card. */
function isMasteryDenial(error: unknown): boolean {
  return getEntitlementDenial(error)?.feature === "mastery_detail";
}

type Access = "loading" | "granted" | "locked";

export default function MasteryPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const studentId = user?.id ?? "";
  const profile = useProfileQuery();
  const map = useFeatureAccess();
  const upgrade = useUpgradeModal();
  const entry = map?.mastery_detail ?? null;

  // The map decides first (OQ-29). A loaded profile with no map (a non-student viewer, or a body
  // the schema rejects) does not hide the page: the request is made and the SERVER decides.
  const access: Access =
    entry?.access === "locked"
      ? "locked"
      : entry?.access === "granted" || profile.data !== undefined
        ? "granted"
        : "loading";
  const enabled = access === "granted" && studentId.length > 0;

  const domains = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
    enabled,
    retry: 1,
  });
  // One flat fetch for every skill; each opened domain filters its own (owner ruling 2026-08-27).
  const skills = useQuery({
    queryKey: [studentResourceUrl(studentId, "masterySkills")],
    queryFn: () => fetchMasterySkills(studentId),
    enabled,
    retry: 1,
  });

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  function toggle(key: string): void {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const denied =
    isMasteryDenial(domains.error) || isMasteryDenial(skills.error);
  const lockReason = entry?.access === "locked" ? entry.reason : "plan";

  let body: JSX.Element;
  if (access === "locked" || denied) {
    body = (
      <div className="max-w-[440px]">
        <LockedMasteryCard
          onSeeWhatsIncluded={() => upgrade.open("mastery_detail", lockReason)}
        />
      </div>
    );
  } else if (domains.isError) {
    body = (
      <Notice
        tone="danger"
        title="We couldn't load mastery data."
        message={RETRY_MESSAGE}
        actionLabel="Try again"
        onAction={() => void domains.refetch()}
        data-testid="mastery-error"
      />
    );
  } else if (domains.data === undefined) {
    body = (
      <div className="flex flex-col gap-3" data-testid="mastery-loading">
        <Skeleton variant="lyc" className="h-12 w-full" />
        <Skeleton variant="lyc" className="h-12 w-full" />
        <Skeleton variant="lyc" className="h-12 w-full" />
        <Skeleton variant="lyc" className="h-12 w-full" />
      </div>
    );
  } else {
    const served = domains.data.domains;
    // Derived in render (coding standards §11.4). The grid draws all eight canonical domains, a
    // missing one as unmeasured, so "nothing measured" is "no served domain is measured".
    const allUnmeasured = served.every((d) => d.levelKey === "unmeasured");
    body = (
      <>
        {SECTIONS.map((section) => (
          <section
            key={section}
            aria-labelledby={`mastery-${section}-h`}
            className="flex flex-col"
            data-testid="mastery-section"
            data-section-code={section}
          >
            <h2 id={`mastery-${section}-h`} className={SECTION_H2}>
              {sectionDisplayLabel(section)}
            </h2>
            <div className="border-t border-lyc-rule">
              {canonicalDomainNodes(served, [section]).map((node) => {
                const key = `${node.section}:${node.domain}`;
                return (
                  <DomainBlock
                    key={key}
                    node={node}
                    expanded={open.has(key)}
                    onToggle={() => toggle(key)}
                    skills={skills.data?.skills}
                    skillsFailed={skills.isError}
                    onRetrySkills={() => void skills.refetch()}
                  />
                );
              })}
            </div>
          </section>
        ))}
        {allUnmeasured ? (
          // RULE 6 at grid level: one call to action when nothing is measured yet.
          <div data-testid="grid-cta">
            <Button asChild variant="lyc-primary" size="lyc-lg">
              <Link href="/practice">Start practicing</Link>
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-10" data-testid="mastery">
      <PageHeader
        title="Your mastery"
        description="Each domain shows where your answers place you. Levels move as you answer more questions."
      />
      {body}
    </div>
  );
}

/** One domain: its mastery row (a show/hide button) and, when open, its skills beneath it. */
function DomainBlock({
  node,
  expanded,
  onToggle,
  skills,
  skillsFailed,
  onRetrySkills,
}: {
  node: MasteryDomainNode;
  expanded: boolean;
  onToggle: () => void;
  skills: readonly MasterySkillNode[] | undefined;
  skillsFailed: boolean;
  onRetrySkills: () => void;
}): JSX.Element {
  const listId = useId();
  return (
    <div data-testid="mastery-domain" data-domain={node.domain}>
      <MasteryRow
        label={node.domain}
        levelKey={node.levelKey}
        displayName={node.displayName}
        variant="wide"
        disclosure={{ expanded, controls: listId, onToggle }}
      />
      <div id={listId} hidden={!expanded}>
        {expanded ? (
          <SkillList
            section={node.section}
            domain={node.domain}
            skills={skills}
            failed={skillsFailed}
            onRetry={onRetrySkills}
          />
        ) : null}
      </div>
    </div>
  );
}

function SkillList({
  section,
  domain,
  skills,
  failed,
  onRetry,
}: {
  section: MasterySection;
  domain: string;
  skills: readonly MasterySkillNode[] | undefined;
  failed: boolean;
  onRetry: () => void;
}): JSX.Element {
  const frame = "border-b border-lyc-rule-soft py-4 pl-4 sm:pl-6";
  if (failed) {
    return (
      <div className={frame}>
        <Notice
          tone="danger"
          title="We couldn't load this domain's skills."
          message={RETRY_MESSAGE}
          actionLabel="Try again"
          onAction={onRetry}
          data-testid="skills-error"
        />
      </div>
    );
  }
  if (skills === undefined) {
    return (
      <div
        className={`${frame} flex flex-col gap-3`}
        data-testid="skills-loading"
      >
        <Skeleton variant="lyc" className="h-10 w-full" />
        <Skeleton variant="lyc" className="h-10 w-full" />
      </div>
    );
  }
  const rows = skillsForDomain(skills, section, domain);
  if (rows.length === 0) {
    // The catalogue for this domain is empty: distinct from "nothing measured" and from a failed
    // read (above). `skills` is the bank's catalogue unioned with the student's own rows.
    return (
      <p
        className={`${frame} m-0 text-lyc-body text-lyc-muted`}
        data-testid="catalog-empty"
      >
        There are no published questions in this domain yet, so there is nothing
        to measure here.
      </p>
    );
  }
  // RULE 6: one call to action per opened domain, only when something in it is unmeasured.
  const hasUnmeasured = rows.some((s) => s.levelKey === "unmeasured");
  // Indented under the domain; on wide screens the right padding is the domain row's chevron
  // track and gap (20px + 24px), so the skills' meters and pills line up with the domain's.
  return (
    <div className="pl-4 sm:pl-6 sm:pr-11" data-testid="skill-list">
      {rows.map((skill) => (
        <MasteryRow
          key={skill.skill}
          label={skill.skill}
          levelKey={skill.levelKey}
          displayName={skill.displayName}
          variant="wide"
        />
      ))}
      {hasUnmeasured ? (
        <div className="py-4" data-testid="panel-cta">
          <Button asChild variant="lyc-outline" size="lyc">
            <Link href="/practice">Practice {domain}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
