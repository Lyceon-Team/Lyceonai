/**
 * Route-level loading: the page's own shell, sketched, in the page's own theme.
 *
 * @spec [production QA 2026-10-07 item 5 (Karl: "route-level lazy loading with page skeletons
 *        instead of the full-page cream 'Loading…' flash", which "also breaks dark mode") and
 *        item 12 (the loading flash in dark mode); student-UI register UI-41, UI-46; DESIGN.md §1
 *        ("Focus and motion": no motion but the LISA typing dots; tokens only), §2 (the three
 *        shells); UI-59 / OQ-60 (e) (owner ruling 2026-10-05: no light frame before a dark Bare
 *        card), generalised here to every student shell] | @implemented [2026-10-07]
 *
 * plain English: two pieces.
 *   - `RouteLoading` is what draws while something ABOVE the shells loads: the router's Suspense
 *     fallback (App.tsx: the route guard's or the shell frame's code chunk, on a first visit) and
 *     the route guard's wait for auth (RequireRole). On a student route it sketches that route's
 *     shell (`ShellSkeleton`: the App shell's rail or phone bars, the Focus shell's top bar, the
 *     Bare card) with `PageSkeleton` where the page will be, under the route's own theme lock from
 *     the route table, so a dark device sees a dark frame, never a cream one. Anywhere else
 *     (public, legal, guardian and admin pages, none of them themed) it is the light full-page
 *     loader, exactly as before. A guardian on a shared route (/profile, /notifications) gets the
 *     light loader too: their page renders in the guardian shell, not the student one.
 *   - `PageSkeleton` is what draws INSIDE the real shell while a page's own chunk loads
 *     (StudentRouteFrame's Suspense), so moving between student pages keeps the rail, the bars and
 *     the theme on screen and only the content area waits.
 *
 * Everything is a polite live region named "Loading..." (as the loader it replaces), drawn with
 * the student tokens only and no animation. This module is in the entry bundle (App.tsx's
 * fallback), so it imports no icons, menus or other page code.
 *
 * trade-offs: the skeleton sketches the shell's frame only (the rail's colour and wordmark, the
 * bars), not its items, which depend on auth and the feature-access map that may still be
 * loading; a rail drawn with guessed items would flicker when the real one replaces it.
 */
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { FullPageLoader } from "@/components/student-ui/FullPageLoader";
import { studentShellAt, type ShellSpec } from "@/lib/route-shells";

const LABEL = "Loading...";
const BAR = "rounded-md bg-lyc-seg-empty";

/**
 * The content placeholder: a title, a line and two cards at the page column's measure, or (in a
 * Bare card) a heading, a line and two fields.
 */
export function PageSkeleton({
  padded = false,
  card = false,
}: {
  /** Pad like the reading column (for a page laid out edge to edge, or a Focus page). */
  padded?: boolean;
  /** Inside the Bare card: the card's own placeholder. */
  card?: boolean;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={LABEL}
      aria-busy="true"
      data-testid="page-skeleton"
      className={
        padded ? "px-4 pb-10 pt-6 lg:px-[72px] lg:pb-[72px] lg:pt-14" : ""
      }
    >
      <div aria-hidden="true">{card ? <CardBlocks /> : <SkeletonBlocks />}</div>
    </div>
  );
}

/** The Bare card's placeholder: a heading, a line and two fields. */
function CardBlocks(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className={`${BAR} h-8 w-2/3`} />
      <div className={`${BAR} h-4 w-full`} />
      <div className={`${BAR} h-11 w-full`} />
      <div className={`${BAR} h-11 w-full`} />
    </div>
  );
}

function Wordmark(): JSX.Element {
  return (
    <span className="font-lyc-serif text-[18px] font-semibold tracking-[0.01em] text-lyc-rail-on-bg">
      Lyceon
    </span>
  );
}

/** A student shell's frame with the page placeholder in it (see the module note). */
function ShellSkeleton({
  spec,
  testId,
}: {
  spec: ShellSpec;
  testId: string;
}): JSX.Element {
  const root = {
    role: "status",
    "aria-live": "polite",
    "aria-label": LABEL,
    "aria-busy": true,
    "data-testid": testId,
    "data-route-skeleton": spec.shell,
    "data-theme-lock": spec.themeLock ?? undefined,
  } as const;
  switch (spec.shell) {
    case "app":
      return (
        <div
          {...root}
          className="lyc flex min-h-[100dvh] flex-col pb-[64px] lg:h-[100dvh] lg:flex-row lg:overflow-hidden lg:pb-0"
        >
          <div
            aria-hidden="true"
            className="flex h-16 shrink-0 items-center bg-lyc-rail px-4 lg:h-full lg:w-[96px] lg:flex-col lg:px-2 lg:pt-[62px]"
          >
            <Wordmark />
          </div>
          <div
            aria-hidden="true"
            className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-[72px] lg:pt-14"
          >
            <SkeletonBlocks />
          </div>
          {spec.panel !== null ? (
            <div
              aria-hidden="true"
              style={{ width: `${spec.panel}px` }}
              className="hidden shrink-0 border-l border-lyc-rule bg-lyc-margin lg:block"
            />
          ) : null}
          <div
            aria-hidden="true"
            className="fixed inset-x-0 bottom-0 h-[64px] border-t border-lyc-rule bg-lyc-rail lg:hidden"
          />
        </div>
      );
    case "focus":
      return (
        <div {...root} className="lyc flex h-[100dvh] flex-col">
          <div
            aria-hidden="true"
            className="flex h-[72px] shrink-0 items-center gap-5 border-b border-lyc-rule px-4 lg:px-8"
          >
            <div className={`${BAR} h-5 w-28`} />
          </div>
          <div
            aria-hidden="true"
            className="min-h-0 flex-1 px-4 pt-6 lg:px-[72px] lg:pt-14"
          >
            <div className="mx-auto max-w-[800px]">
              <SkeletonBlocks />
            </div>
          </div>
        </div>
      );
    case "bare":
      return (
        <div
          {...root}
          className="lyc flex min-h-[100dvh] items-center justify-center bg-lyc-paper px-4 py-10"
        >
          <div
            aria-hidden="true"
            className="w-full max-w-[480px] rounded-lg border border-lyc-rule bg-lyc-sheet p-6 sm:p-8"
          >
            <CardBlocks />
          </div>
        </div>
      );
  }
}

/** PageSkeleton's blocks without its live region (the shell skeleton is already the region). */
function SkeletonBlocks(): JSX.Element {
  return (
    <div className="flex max-w-[800px] flex-col gap-6">
      <div className={`${BAR} h-4 w-32`} />
      <div className={`${BAR} h-10 w-2/3`} />
      <div className={`${BAR} h-4 w-1/2`} />
      <div className="h-32 rounded-lg border border-lyc-rule bg-lyc-sheet" />
      <div className="h-32 rounded-lg border border-lyc-rule bg-lyc-sheet" />
    </div>
  );
}

/** What draws while the route above the shells loads (see the module note). */
export function RouteLoading({
  "data-testid": testId = "full-page-loader",
}: {
  "data-testid"?: string;
}): JSX.Element {
  const [location] = useLocation();
  const { user } = useSupabaseAuth();
  const spec = user?.role === "guardian" ? null : studentShellAt(location);
  if (spec === null)
    return <FullPageLoader themeLock="light" data-testid={testId} />;
  return <ShellSkeleton spec={spec} testId={testId} />;
}
