// @vitest-environment jsdom
/**
 * The legal hub and a legal document in the student tokens: dark mode applies, nothing below 14px.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part G and its test: "dark mode
 *        applied; nothing below 14px"; DESIGN.md §1 (the light and dark token sets live under the
 *        `.lyc` root, keyed by <html data-theme>), §5 ("Nothing below 14px")] | @implemented [2026-10-21]
 *
 * plain English: the REAL pages over the REAL `legal/` tree (served through a stubbed fetch, the
 * way tests/ci/legal-hub.contract.test.ts serves it), with <html data-theme="dark"> as the boot
 * script sets it. Dark mode applies when the page's root is a `.lyc` root not pinned light
 * (student-tokens.css: `:root[data-theme="dark"] .lyc:not([data-theme-lock="light"])`; the
 * painted-theme reader `readPaintedThemeAt` answers "dark"). Nothing below 14px: no element
 * carries a Tailwind size under 14px (`text-xs`, `text-[10-13px]`, `prose-sm`), and the shared
 * card/badge sizes are the 14px meta token at the least. Presence first: the documents rendered.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { readPaintedThemeAt } from "@/lib/theme";
import LegalHub from "./legal";
import LegalDocPage from "./legal-doc";

const REAL_LEGAL = path.resolve(__dirname, "../../../legal");

function slugsOnDisk(): string[] {
  return fs
    .readdirSync(REAL_LEGAL, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(REAL_LEGAL, n, "manifest.json")))
    .sort();
}

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const rel = url.replace(/^\/legal\//, "");
    if (rel === "index.json")
      return new Response(JSON.stringify({ slugs: slugsOnDisk() }), {
        status: 200,
      });
    const abs = path.join(REAL_LEGAL, rel);
    if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
    return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
  });
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

function mount(node: React.ReactNode, at: string): void {
  const { hook } = memoryLocation({ path: at });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Router hook={hook}>{node}</Router>
    </QueryClientProvider>,
  );
}

const BELOW_14 = /(^|\s)(text-xs|text-\[(?:[0-9]|1[0-3])px\]|prose-sm)(\s|$)/;

function smallText(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[class]"))
    .map((el) => el.getAttribute("class") ?? "")
    .filter((c) => BELOW_14.test(c));
}

describe("Part G: the legal pages in the student tokens", () => {
  it("/legal: a .lyc root painted dark, nothing below 14px", async () => {
    mount(<LegalHub />, "/legal");
    // Presence: the hub listed the real documents.
    expect(
      await screen.findByTestId("badge-version-privacy-policy"),
    ).toBeInTheDocument();
    const root = screen.getByTestId("legal-hub");
    expect(root.classList.contains("lyc")).toBe(true);
    expect(readPaintedThemeAt(root)).toBe("dark");
    expect(smallText(root)).toEqual([]);
  });

  it("/legal/privacy-policy: a .lyc root painted dark, body at 16px prose, nothing below 14px", async () => {
    mount(
      <Route path="/legal/:slug" component={LegalDocPage} />,
      "/legal/privacy-policy",
    );
    expect(
      await screen.findByTestId("badge-legal-version"),
    ).toBeInTheDocument();
    const root = screen.getByTestId("legal-document");
    expect(root.classList.contains("lyc")).toBe(true);
    expect(readPaintedThemeAt(root)).toBe("dark");
    // Presence: section bodies rendered, in the 16px prose with the token colours.
    const bodies = root.querySelectorAll(".legal-prose");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0]?.classList.contains("prose")).toBe(true);
    expect(smallText(root)).toEqual([]);
  });
});
