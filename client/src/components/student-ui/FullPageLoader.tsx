import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 "Focus and motion"; audit §6.2 "Full-page
 *       spinner"] | @implemented [2026-10-03]
 *
 * plain English: the one full-page loading state. It replaces the copies of "centred spinner
 * plus Loading..." that App.tsx, RequireRole, UserProfile, profile-complete and the two session
 * resume pages each drew for themselves.
 * - It is a polite live region (`role="status"`) named by its label, so a screen reader hears
 *   what is loading; the same words are on screen at body size (16px).
 * - It does not spin. The design limits motion to the LISA typing dots, so the loader is the
 *   label alone, set quietly on the page.
 * - It carries its own `.lyc` root, because it often renders before (or outside) any student
 *   shell: route Suspense fallbacks and auth gates sit above the shells.
 * - `fill="screen"` fills the viewport on --paper; `fill="region"` fills a 60vh area inside a page
 *   that already has its own frame, with no background of its own.
 * - `themeLock="light"` pins the light token set whatever the device theme. Pass it where the
 *   surrounding page is not yet themed (every page before its Wave 5 migration, and the
 *   app-wide route fallback, which also serves guardian, admin and marketing pages), so a
 *   dark-device user does not see a dark loader flash before a light page.
 */
type FullPageLoaderProps = {
  label?: string;
  fill?: "screen" | "region";
  themeLock?: "light";
  className?: string;
  "data-testid"?: string;
};

export function FullPageLoader({
  label = "Loading...",
  fill = "screen",
  themeLock,
  className,
  "data-testid": testId = "full-page-loader",
}: FullPageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      data-theme-lock={themeLock}
      className={cn(
        "lyc flex w-full items-center justify-center px-4",
        fill === "screen" ? "min-h-screen" : "min-h-[60vh] !bg-transparent",
        className,
      )}
    >
      <p className="m-0 text-lyc-body text-lyc-muted">{label}</p>
    </div>
  );
}
