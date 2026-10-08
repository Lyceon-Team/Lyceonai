/**
 * The student Focus shell: a top bar with the back arrow and the section name, then the page.
 *
 * @spec [student-UI register UI-41; DESIGN.md §2 "Focus shell" (no rail, no right panel; back to
 *        the previous in-app page, or else the section's home, with no full reloads; the timed
 *        exam module has no back arrow and is light only); register §2 ("Back arrow target is
 *        defined, never guessed"); DESIGN.md §1 focus ring, 14px minimum]
 *        | @implemented [2026-10-03]
 *
 * plain English: used by the practice and review runners and the exam session and report pages
 * (route-shells.ts). The back arrow is a real link to the section home, so middle-click and
 * open-in-new-tab work. A plain click goes back one entry when the entry behind is an in-app page
 * (`hasInAppHistory`), and otherwise lets the link navigate to the section home client-side. The
 * timed module passes `back={false}` and shows the section name alone.
 *
 * `FocusBarContext` lets a page put its context (session name, "Question N of M", tools) in the
 * bar: the router applies the shell, so the page renders it in its body and it is portalled in.
 *
 * No notification bell: a focused surface carries no chrome beyond the way back (the same
 * reasoning as the runner header's exemption); listed in shells.notification-bell.test.tsx.
 *
 * F-69 (owner ruling 2026-10-05: fix in the shared shell): `<main>` is `relative`, so it is the
 * containing block of every absolutely positioned descendant. Without it, an `absolute` element
 * with no positioned ancestor (the `sr-only` choice letters in question-renderer.tsx) is placed
 * against the initial containing block at its in-flow position, outside `<main>`'s scroll area,
 * and makes the document taller than the `100dvh` shell: the review runner at 390x844 measured
 * 926-942px, so a focus or scroll-into-view in the LISA panel scrolled the window and the top
 * bar left the view. With it, the document is the viewport's height and only `<main>` scrolls.
 * The timed exam module measured the same layout before and after at 1440, 820, 768 and 390
 * (evidence/wave5/F-69.md).
 */
import {
  createContext,
  useContext,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { SkipLink } from "@/components/common/skip-link";
import { LYC_FOCUS } from "@/components/ui/button";
import { hasInAppHistory, previousInAppPath } from "@/lib/in-app-history";
import { pageNameAt, type ThemeLock } from "@/lib/route-shells";
import { usePublishThemeLock } from "./theme-lock";

const ContextSlot = createContext<HTMLElement | null>(null);

/** A page's top-bar context, portalled into the Focus shell's bar. */
export function FocusBarContext({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const slot = useContext(ContextSlot);
  return slot === null ? null : createPortal(children, slot);
}

type FocusShellProps = {
  children: ReactNode;
  /** The section name in the bar ("Practice", "Review", "Full-Length"). */
  section: string;
  /** Where back goes when the student did not come from another in-app page. */
  sectionHome: string;
  /** False hides the back arrow (the timed exam module). */
  back?: boolean;
  themeLock?: ThemeLock;
};

export function FocusShell({
  children,
  section,
  sectionHome,
  back = true,
  themeLock = null,
}: FocusShellProps): JSX.Element {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  // F-65: portalled overlays take this shell's lock.
  usePublishThemeLock(themeLock);

  // QA 2026-10-07 item 7: the arrow's label names where it goes. Back to the previous in-app
  // page (register §2) is labelled with THAT page's name ("< Home" after a launch from Home);
  // with nothing in-app behind, it goes to the section home and says the section.
  const previous = hasInAppHistory() ? previousInAppPath() : null;
  const backLabel =
    previous === null ? section : (pageNameAt(previous) ?? "Back");

  const onBack = (event: MouseEvent<HTMLAnchorElement>): void => {
    // wouter calls this only for a plain left click; modified clicks open the href as usual.
    if (hasInAppHistory()) {
      event.preventDefault();
      window.history.back();
    }
  };

  return (
    <div
      className="lyc flex h-[100dvh] flex-col"
      data-shell="focus"
      data-theme-lock={themeLock ?? undefined}
    >
      <SkipLink />
      <header
        data-testid="focus-shell-header"
        className="flex shrink-0 items-center gap-5 border-b border-lyc-rule px-4 py-3.5 lg:px-8"
      >
        {back ? (
          <Link
            href={sectionHome}
            onClick={onBack}
            aria-label={backLabel === "Back" ? "Back" : `Back to ${backLabel}`}
            data-testid="focus-back"
            className={`${LYC_FOCUS} flex h-11 items-center gap-2 rounded-md pl-2 pr-3.5 text-[17px] font-semibold text-lyc-ink-strong no-underline hover:bg-lyc-hover`}
          >
            <ChevronLeft
              aria-hidden="true"
              className="h-[22px] w-[22px]"
              strokeWidth={2}
            />
            {backLabel}
          </Link>
        ) : (
          <span
            data-testid="focus-section"
            className="text-[17px] font-semibold text-lyc-ink-strong"
          >
            {section}
          </span>
        )}
        <div
          ref={setSlotEl}
          data-testid="focus-context"
          className="flex min-w-0 flex-1 items-center gap-5"
        />
      </header>
      <main
        id="main"
        data-testid="focus-shell-main"
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <ContextSlot.Provider value={slotEl}>{children}</ContextSlot.Provider>
      </main>
    </div>
  );
}
