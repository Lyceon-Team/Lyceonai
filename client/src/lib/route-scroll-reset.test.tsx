// @vitest-environment jsdom
/**
 * QA2-I: scroll to the top on every route change.
 *
 * @spec [production re-test 2026-10-08 item I (Karl: "Reset scroll to top on every route
 *        change"); DESIGN.md §2] | @implemented [2026-10-08]
 *
 * plain English: the hook is mounted the way the app mounts it (once, inside the route switch,
 * here a wouter Router over a memory location), with the scroll containers the shells mark
 * (`data-route-scroll`). Presence first: the window (the document's scrolling element) and each
 * container are scrolled before the navigation, so a 0 afterwards is the hook's doing. A pathname
 * change resets the window and every marked container; a query-only change (in-page state, such
 * as a filter) resets nothing; the first render resets nothing; a hash scrolls its target into
 * view after the reset.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ROUTE_SCROLL_ATTR, useRouteScrollReset } from "./route-scroll-reset";

let navigate: (to: string) => void = () => undefined;

function Probe(): JSX.Element {
  useRouteScrollReset();
  const [, go] = useLocation();
  navigate = go;
  return (
    <div>
      <main id="main" data-testid="main" {...{ [ROUTE_SCROLL_ATTR]: "" }} />
      <aside data-testid="panel" {...{ [ROUTE_SCROLL_ATTR]: "" }} />
      <section data-testid="unmarked" />
      <h2 id="contact">Contact</h2>
    </div>
  );
}

let scrolledIntoView: string[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolledIntoView = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledIntoView.push(this.id);
  };
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  document.documentElement.scrollTop = 0;
  cleanup();
});

function mount(path: string): void {
  const { hook, searchHook } = memoryLocation({ path });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <Probe />
    </Router>,
  );
}

function el(id: string): HTMLElement {
  if (id === "window") return document.documentElement;
  const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (found === null) throw new Error(`no ${id}`);
  return found;
}

const ALL = ["window", "main", "panel", "unmarked"] as const;

/** Scrolls everything, so a later 0 is the reset's doing (presence before absence). */
function scrollEverything(): void {
  for (const id of ALL) {
    el(id).scrollTop = 400;
    expect([id, el(id).scrollTop]).toEqual([id, 400]);
  }
}

function tops(): Record<string, number> {
  return Object.fromEntries(ALL.map((id) => [id, el(id).scrollTop]));
}

describe("QA2-I: scroll resets to the top on a pathname change", () => {
  it("the first render resets nothing (a reload keeps the browser's own restoration)", () => {
    document.documentElement.scrollTop = 400;
    mount("/practice");
    expect(document.documentElement.scrollTop).toBe(400);
  });

  it("a pathname change scrolls the window and every marked container to the top", () => {
    mount("/practice");
    scrollEverything();
    act(() => navigate("/review"));
    // Only the window and the shells' containers: an unmarked element is the page's own business.
    expect(tops()).toEqual({ window: 0, main: 0, panel: 0, unmarked: 400 });
  });

  it("every pathname change resets, not only the first", () => {
    mount("/practice");
    act(() => navigate("/review"));
    scrollEverything();
    act(() => navigate("/calendar"));
    expect(tops()).toEqual({ window: 0, main: 0, panel: 0, unmarked: 400 });
  });

  it("a query-only change (in-page state, e.g. a filter) does not reset", () => {
    mount("/practice");
    scrollEverything();
    act(() => navigate("/practice?section=math"));
    expect(tops()).toEqual({
      window: 400,
      main: 400,
      panel: 400,
      unmarked: 400,
    });
  });

  it("a hash on the new address scrolls its target into view after the reset", () => {
    mount("/practice");
    scrollEverything();
    window.history.replaceState(null, "", "/help#contact");
    act(() => navigate("/help"));
    expect(tops().window).toBe(0);
    expect(scrolledIntoView).toEqual(["contact"]);
  });

  it("control: with no hash, nothing is scrolled into view", () => {
    mount("/practice");
    act(() => navigate("/help"));
    expect(scrolledIntoView).toEqual([]);
  });
});
