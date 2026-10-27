/**
 * Smart landing, client side: was this app open a "default entry", and which landing (if any) is
 * the student on.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26), "Precedence: deep links win → an
 *        in-progress session resumes → then the arm"; Karl's ruling A on Step 0 the same day
 *        ("trigger on app open ... at the default entry (no `next`, no hash)")]
 *        | @implemented [2026-10-26]
 *
 * plain English: a landing is asked for only when the student arrived at Home by default:
 *   - the page was LOADED at `/dashboard` with no query and no hash (a bookmark, a typed address,
 *     the installed app, or the sign-in callback's own redirect to the default), or
 *   - the sign-in or onboarding page sent the student to the role default because there was no
 *     return path.
 * Anything else is a deep link and wins: a `next`, a hash (`/dashboard#qotd` from the daily
 * email), any other page. The flag is consumed once, so moving to Home inside the app later never
 * asks again. Nothing here decides the landing; the server does.
 *
 * The current landing's show id is kept IN MEMORY only (the cookie policy counts browser storage
 * as cookies; analytics state there would need consent). It is what the escape report names, and
 * it lasts this page load, which covers the 30-second escape window.
 */
import { LANDING_RUNNER_QUERY } from "@lyceon/shared/smart-landing-schema";

let defaultEntry = false;
let currentShow: { showId: string; shownAt: number } | null = null;

/** The URL parts of a default entry: Home, nothing else in the address. */
export function isDefaultEntryUrl(
  pathname: string,
  search: string,
  hash: string,
): boolean {
  return pathname === "/dashboard" && search === "" && hash === "";
}

/** Called once at boot with the address the page was loaded at. */
export function captureBootEntry(location: {
  pathname: string;
  search: string;
  hash: string;
}): void {
  defaultEntry = isDefaultEntryUrl(
    location.pathname,
    location.search,
    location.hash,
  );
}

/**
 * Called by the sign-in and onboarding pages with where they are about to send the student and
 * the return path they read: only "no return path, so the default Home" is a default entry.
 */
export function notePostAuthDestination(
  destination: string,
  next: unknown,
): void {
  if (next === null && destination === "/dashboard") defaultEntry = true;
}

/** True once per default entry; Home calls it when it mounts. */
export function consumeDefaultEntry(): boolean {
  const was = defaultEntry;
  defaultEntry = false;
  return was;
}

/** The landing just shown (non-Home), so a return to Home can be reported as an escape. */
export function rememberLandingShow(showId: string): void {
  currentShow = { showId, shownAt: Date.now() };
}

/** The remembered landing, taken once. */
export function takeLandingShow(): string | null {
  const show = currentShow;
  currentShow = null;
  return show?.showId ?? null;
}

/** A runner's address search says the landing opened it (its back link then reads "Home"). */
export function isLandingRunnerSearch(search: string): boolean {
  const [key, value] = LANDING_RUNNER_QUERY.split("=");
  return new URLSearchParams(search).get(key ?? "") === value;
}

/** Tests only. */
export function resetLandingEntryForTests(): void {
  defaultEntry = false;
  currentShow = null;
}
