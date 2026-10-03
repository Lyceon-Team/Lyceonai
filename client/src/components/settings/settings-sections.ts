/**
 * Settings sections: which exist, which a viewer sees, and which one the URL selects.
 *
 * @spec [DESIGN.md §4 Settings (a section list on the left: Profile, Account, Guardian, Billing,
 *        Notifications, Appearance); student-UI register OQ-27 (owner ruling 2026-10-02: remove
 *        the Settings Notifications section for launch, no storage and no route); OQ-39 (e) and
 *        UI-44 (`UPGRADE_PLANS_DESTINATION = "/profile?tab=billing"`: "See plans" lands on
 *        Billing, including when the student is already on /profile); UI-58]
 *        | @implemented [2026-10-03]
 *
 * plain English: pure functions over the `?tab=` query value. The section on screen is DERIVED
 * from the URL on every render (never copied into state), so a navigation that only changes the
 * query string, which is what the upgrade modal's "See plans" does while the student is already
 * on Settings, moves the page to Billing. That closes UI-44's known limitation.
 *
 * Who sees what is presentation only; every read and write is authorised by the server:
 *   - a student sees Profile, Account, Guardian, Billing and Appearance;
 *   - an admin (never onboarded as a student: no name save, no link code, no billing status,
 *     each of which the server refuses for an admin) sees Account and Appearance.
 * There is no Notifications section (OQ-27). An unknown, legacy (`progress`, `settings`) or
 * hidden `tab` falls back to the viewer's first section.
 */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account" },
  { id: "guardian", label: "Guardian" },
  { id: "billing", label: "Billing" },
  { id: "appearance", label: "Appearance" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export type SettingsViewer = "student" | "admin";

const ADMIN_SECTIONS: readonly SettingsSectionId[] = ["account", "appearance"];

export function visibleSections(
  viewer: SettingsViewer,
): readonly (typeof SETTINGS_SECTIONS)[number][] {
  return viewer === "student"
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter((s) => ADMIN_SECTIONS.includes(s.id));
}

/** The section the query string selects, for this viewer. */
export function sectionFromSearch(
  search: string,
  viewer: SettingsViewer,
): SettingsSectionId {
  const visible = visibleSections(viewer);
  const tab = new URLSearchParams(search).get("tab");
  const match = visible.find((s) => s.id === tab);
  const first = visible[0];
  if (match) return match.id;
  // `visible` is never empty: both viewers have at least Account and Appearance.
  return first ? first.id : "account";
}

/** The URL of a section, the one spelling every link and button uses. */
export function sectionHref(id: SettingsSectionId): string {
  return `/profile?tab=${id}`;
}
