/**
 * UI-46 guard: the duplicates this row replaced stay gone.
 *
 * @spec [student-UI register UI-46 ("Grep shows zero remaining duplicate implementations listed
 *        in audit §6.2"); audit §6.2 "Full-page spinner", "Brand colors as raw hex"] |
 *        @implemented [2026-10-03]
 *
 * plain English: reads the client source and fails if a hand-rolled full-page spinner, a second
 * PageLoader, or retyped brand hex in the shared notice comes back. It pins only what UI-46
 * actually replaced; the duplicates left for the Wave 5 page migrations are listed in the UI-46
 * report, and each of those rows adds its own entry here when it removes one.
 *
 * Presence before absence: the scan must have read a realistic number of source files, and
 * every replaced site must be shown to render the shared FullPageLoader, so an empty scan or a
 * deleted page cannot pass for a clean one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name): string[] => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(name)) return [];
    if (/\.test\.(ts|tsx)$/.test(name)) return [];
    return [full];
  });
}

const FILES = sourceFiles(CLIENT_SRC).map((full) => ({
  path: relative(CLIENT_SRC, full),
  text: readFileSync(full, "utf8"),
}));

function read(path: string): string {
  const file = FILES.find((f) => f.path === path);
  if (file === undefined) throw new Error(`not scanned: ${path}`);
  return file.text;
}

/** Every `className="…"` / `className={"…"}` / template string literal in a file. */
function classStrings(text: string): string[] {
  return [...text.matchAll(/className=(?:\{\s*)?["'`]([^"'`]*)["'`]/g)].map(
    (m) => m[1] ?? "",
  );
}

/** The six sites audit §6.2 lists as plain full-page spinner duplicates, now FullPageLoader. */
const REPLACED_SITES = [
  "App.tsx",
  "components/auth/RequireRole.tsx",
  "pages/UserProfile.tsx",
  "pages/profile-complete.tsx",
  "pages/resume-practice.tsx",
  "pages/resume-review.tsx",
] as const;

describe("UI-46 guard: replaced duplicates stay gone", () => {
  it("scanned the real client source (presence before absence)", () => {
    expect(FILES.length).toBeGreaterThan(200);
    for (const site of REPLACED_SITES) {
      expect(
        FILES.some((f) => f.path === site),
        site,
      ).toBe(true);
    }
  });

  it.each(REPLACED_SITES)("%s renders the shared FullPageLoader", (site) => {
    const text = read(site);
    expect(text).toMatch(
      /import \{[^}]*\bFullPageLoader\b[^}]*\} from "@\/components\/student-ui(?:\/FullPageLoader)?"/,
    );
    expect(text).toMatch(/<FullPageLoader\b/);
  });

  it("no hand-drawn CSS spinner (animate-spin on a rounded bordered div) anywhere", () => {
    const hits = FILES.flatMap((f) =>
      classStrings(f.text)
        .filter(
          (c) =>
            /\banimate-spin\b/.test(c) &&
            /\brounded-full\b/.test(c) &&
            /\bborder-(?:\d|[trbl]-transparent)/.test(c),
        )
        .map((c) => `${f.path}: ${c}`),
    );
    expect(hits).toEqual([]);
  });

  it("no full-page Loader2 spinner on the replaced sites", () => {
    const hits = REPLACED_SITES.flatMap((site) =>
      classStrings(read(site))
        .filter((c) => /\bh-8\b/.test(c) && /\banimate-spin\b/.test(c))
        .map((c) => `${site}: ${c}`),
    );
    expect(hits).toEqual([]);
  });

  it("there is one page loader: no local PageLoader component", () => {
    const hits = FILES.filter((f) =>
      /\bfunction PageLoader\b|\bconst PageLoader\s*=/.test(f.text),
    ).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("the shared notice names brand tokens, never their raw hex", () => {
    const text = read("components/feedback/AppNotice.tsx");
    // Presence: the tones that used to retype the hex still exist.
    expect(text).toMatch(/\bsession:/);
    expect(text).toMatch(/\bpremium:/);
    expect(text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
  });
});
