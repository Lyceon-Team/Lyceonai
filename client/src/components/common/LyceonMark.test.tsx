// @vitest-environment jsdom
/**
 * The Lyceon brand mark: one component, used everywhere the brand mark appears.
 *
 * @spec [owner request 2026-10-09 (Karl): replace the graduation-cap mark with the Lyceon logo
 *       on the rail, the mobile top bar and every other brand-mark site] | @implemented [2026-10-09]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LyceonMark } from "./LyceonMark";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..");

describe("LyceonMark", () => {
  it("draws the logo asset through the colour filter, painted in currentColor", () => {
    const { container } = render(<LyceonMark className="h-7 w-7" />);
    const svg = screen.getByTestId("lyceon-logo");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Lyceon");
    expect(svg.getAttribute("class")).toContain("h-7 w-7");
    expect(container.querySelector("image")?.getAttribute("href")).toBe(
      "/lyceon-logo.png",
    );
    expect(
      container.querySelector("feFlood")?.getAttribute("flood-color"),
    ).toBe("currentColor");
  });

  it("is hidden from assistive technology when the word Lyceon sits beside it", () => {
    render(<LyceonMark decorative className="h-6 w-6" testId="mark" />);
    const svg = screen.getByTestId("mark");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });

  it("two marks on one page get distinct filter ids", () => {
    const { container } = render(
      <>
        <LyceonMark className="h-6 w-6" testId="a" />
        <LyceonMark className="h-5 w-5" testId="b" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("filter")).map(
      (f) => f.id,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("every brand-mark site uses the Lyceon mark, never the graduation cap", () => {
  const sites = [
    "components/layout/app-shell.tsx", // the desktop rail and the mobile top bar
    "components/layout/GuardianShell.tsx",
    "components/layout/PublicNavBar.tsx",
    "components/layout/Footer.tsx",
    "components/marketing/HomeNav.tsx",
  ];
  it.each(sites)("%s", (rel) => {
    const source = fs.readFileSync(path.join(src, rel), "utf8");
    expect(source).toMatch(/<LyceonMark\b/);
    expect(source).not.toMatch(/\bGraduationCap\b/);
  });
});
