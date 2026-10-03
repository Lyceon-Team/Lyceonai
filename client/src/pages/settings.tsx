/**
 * Settings (`/profile`): the student's profile, account and preferences.
 *
 * @spec [DESIGN.md §2 (App shell; Settings has no right panel; slim footer), §4 Settings (a
 *        section list on the left); prototype Settings.dc.html; student-UI register UI-58, OQ-27
 *        (no Notifications section), OQ-20, OQ-28, OQ-26/OQ-41, OQ-38, UI-S7/F-40, UI-S8 (About
 *        you hidden), UI-44 (`?tab=billing` lands on Billing, also from /profile itself), OQ-49
 *        (off the light lock once on tokens); evidence/wiring-table.md §11]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page header, then the section list and the one section the URL names
 * (`?tab=`). The section is read from the URL on every render, never copied into state, so the
 * upgrade modal's "See plans" (which navigates to `/profile?tab=billing`) switches sections even
 * when the student is already here. Choosing a section is a navigation to its URL, so back and
 * refresh keep it.
 *
 * Each section owns its reads and writes (see the files in components/settings). This page
 * reads only the shared profile query, for the name, email and `hasPassword`. Who sees which
 * section is presentation: every request is authorised by the server.
 *
 * Replaces the student half of the old `/profile` (UserProfile.tsx): the "Account Center"
 * header card with avatar, the Progress tab of placeholders, the disabled name/username inputs,
 * the account-security prose, the support-mediated role-change email form, and the billing card
 * that chose its button from `hasManageableSubscription` instead of `managedBy` (F-40). A
 * guardian's /profile is still UserProfile.tsx in the guardian shell (G4-08).
 */
import { useLocation, useSearch } from "wouter";
import { FullPageLoader, Notice, PageHeader } from "@/components/student-ui";
import { AccountSection } from "@/components/settings/AccountSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { BillingSection } from "@/components/settings/BillingSection";
import { LinkSection } from "@/components/settings/LinkSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import {
  sectionFromSearch,
  sectionHref,
  visibleSections,
  type SettingsSectionId,
  type SettingsViewer,
} from "@/components/settings/settings-sections";
import { LYC_FOCUS } from "@/components/ui/button";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { toUserFacingMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";

export default function SettingsPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const profile = useProfileQuery({ enabled: !!user });
  const search = useSearch();
  const [, navigate] = useLocation();

  const viewer: SettingsViewer = user?.role === "student" ? "student" : "admin";
  const active = sectionFromSearch(search, viewer);

  if (profile.isLoading) {
    return <FullPageLoader fill="region" label="Loading your profile..." />;
  }
  const profileUser =
    profile.data?.authenticated === true ? profile.data.user : null;
  if (profile.isError || !profileUser || !user) {
    const notice = toUserFacingMessage(profile.error);
    return (
      <Notice
        tone="warning"
        title="We couldn’t load your profile."
        message={notice.message}
        actionLabel="Try again"
        onAction={() => void profile.refetch()}
        data-testid="settings-load-error"
      />
    );
  }

  const email = profileUser.email ?? user.email ?? "";

  return (
    <div className="flex flex-col gap-9" data-testid="settings-page">
      <PageHeader
        title="Settings"
        description="Your profile, account and preferences."
      />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-14">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 flex-wrap gap-1 border-b border-lyc-rule pb-3 lg:w-[220px] lg:flex-col lg:flex-nowrap lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6"
          data-testid="settings-sections"
        >
          {visibleSections(viewer).map((section) => {
            const on = section.id === active;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => navigate(sectionHref(section.id))}
                className={cn(
                  LYC_FOCUS,
                  "h-[46px] rounded-md px-4 text-left text-[17px] hover:bg-lyc-hover",
                  on
                    ? "bg-lyc-chip font-semibold text-lyc-ink-strong"
                    : "bg-transparent font-normal text-lyc-ink",
                )}
                data-testid={`settings-section-${section.id}`}
              >
                {section.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 max-w-[680px] flex-1">
          <ActiveSection
            id={active}
            name={profileUser.name}
            email={email}
            hasPassword={profileUser.hasPassword}
            studentId={user.id}
          />
        </div>
      </div>
    </div>
  );
}

function ActiveSection({
  id,
  name,
  email,
  hasPassword,
  studentId,
}: {
  id: SettingsSectionId;
  name: string;
  email: string;
  hasPassword: boolean | null;
  studentId: string;
}): JSX.Element {
  switch (id) {
    case "profile":
      return <ProfileSection name={name} />;
    case "account":
      return <AccountSection email={email} hasPassword={hasPassword} />;
    case "guardian":
      return <LinkSection studentId={studentId} />;
    case "billing":
      return <BillingSection />;
    case "appearance":
      return <AppearanceSection />;
  }
}
