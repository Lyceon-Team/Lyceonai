/**
 * The page's error boundary, inside its shell.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 1: a lazy-route load
 *        failure reloads once automatically, with a loop guard, and "the error screen renders
 *        inside the app shell with rail/tabs"; DESIGN.md §2 (App shell, Focus shell, Bare card),
 *        §5 (one filled primary, tokens only, 14px floor, an error state for every data area);
 *        student-UI register UI-10 (the error screen never shows `error.message`)]
 *        | @implemented [2026-10-13]
 *
 * plain English: StudentRouteFrame puts this around the page, INSIDE the shell and inside the
 * shell's Suspense boundary, so a page whose chunk fails to load (or that throws while rendering)
 * no longer falls through to the app-wide boundary, which drew a bare card with no rail, tabs or
 * top bar. Here:
 *   - a chunk-load failure asks `claimChunkReload` once. Allowed: the page skeleton stays on
 *     screen and the page reloads (the new build's chunks load). Refused (already reloaded for this
 *     chunk recently, or storage cannot guard against a loop): the error screen.
 *   - any other render error: the error screen at once (reloading cannot be assumed to help, so
 *     it is offered, not done).
 * The error screen is drawn in the shell's content area: the rail and the phone tab bar (App
 * shell), the top bar (Focus shell) or the card (Bare card) stay, so the student can leave by
 * any of them, and "Reload page" is its one filled action.
 *
 * trade-offs: the boundary is per page, so a failure is reset by navigating: every route renders
 * its own frame. Fixed copy only; the error's message never reaches the screen.
 */
import { Component, type ReactNode } from "react";
import { PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import {
  chunkKeyOf,
  claimChunkReload,
  isChunkLoadError,
} from "@/lib/chunk-reload";
import { reloadPage } from "@/lib/reload-page";
import { BareCardHeader } from "./BareCardShell";
import { PageSkeleton } from "./RouteSkeleton";

export const ROUTE_ERROR_TITLE = "This page didn't load";
export const ROUTE_ERROR_MESSAGE =
  "Something went wrong while opening this page. Reloading usually fixes it.";

type Phase =
  /** Rendering the page. */
  | "ok"
  /** A chunk failed; deciding whether to reload (the skeleton shows meanwhile). */
  | "reloading"
  /** The error screen. */
  | "failed";

type Props = {
  children: ReactNode;
  /** Where the screen sits: the reading column, padded (edge-to-edge and Focus pages), or a card. */
  layout?: "column" | "padded" | "card";
};

export class RouteErrorBoundary extends Component<Props, { phase: Phase }> {
  constructor(props: Props) {
    super(props);
    this.state = { phase: "ok" };
  }

  static getDerivedStateFromError(error: unknown): { phase: Phase } {
    return { phase: isChunkLoadError(error) ? "reloading" : "failed" };
  }

  componentDidCatch(error: unknown): void {
    if (!isChunkLoadError(error)) return;
    const decision = claimChunkReload(chunkKeyOf(error), Date.now());
    if (decision.kind === "reload") reloadPage();
    else this.setState({ phase: "failed" });
  }

  render(): ReactNode {
    const layout = this.props.layout ?? "column";
    if (this.state.phase === "reloading")
      return (
        <PageSkeleton padded={layout === "padded"} card={layout === "card"} />
      );
    if (this.state.phase === "failed") {
      return (
        <div
          className={
            layout === "padded"
              ? "flex flex-col gap-6 px-4 pb-10 pt-6 lg:px-[72px] lg:pb-[72px] lg:pt-14"
              : "flex flex-col gap-6"
          }
          data-testid="route-error"
        >
          {layout === "card" ? (
            <BareCardHeader
              title={ROUTE_ERROR_TITLE}
              description={ROUTE_ERROR_MESSAGE}
            />
          ) : (
            <PageHeader
              title={ROUTE_ERROR_TITLE}
              description={ROUTE_ERROR_MESSAGE}
            />
          )}
          <div>
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              onClick={() => reloadPage()}
              data-testid="route-error-reload"
            >
              Reload page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
