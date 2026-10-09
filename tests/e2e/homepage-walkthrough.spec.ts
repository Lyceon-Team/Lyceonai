/**
 * The homepage walkthrough video in a real browser, on the built bundle with vercel.json's headers.
 *
 * @spec [Lyceon_Doc_10A_V1 §6, §8.4; docs/plans/seo/seo-marketing-vertical.md F13; owner decisions 2026-10-09 on the
 *       walkthrough video, items 5 and 6 ("self-hosted, loaded on scroll, played on click, with
 *       the screenshots as fallback")] | @implemented [2026-10-09]
 *
 * plain English: on a short phone viewport (390x560, so the slot starts more than the 400 px
 * NEAR_VIEWPORT margin below the fold; on taller screens the section sits just under the fold
 * and its poster and captions load with the page, by design) the page loads without requesting
 * the film or its captions (only the poster, a native lazy image, may come early); the <video> mounts once the section is scrolled near; the
 * film itself is fetched only after the play button is pressed, from the site's own origin;
 * nothing autoplays; the English captions track is showing once it plays; and no CSP report is
 * raised. Playwright's bundled Chromium has no H.264 decoder, so it plays the WebM source;
 * that is the branch CI proves (playback and captions). A browser with a decoder for neither
 * source proves the other half instead: the three product screenshots take its place. Which
 * branch ran is printed (`WALKTHROUGH_BRANCH`); the fallback itself is unit-tested.
 *
 * env: E2E_BASE_URL (default http://127.0.0.1:5175), E2E_CHROMIUM.
 * CI: the `analytics-consent-e2e` job, against `page-csp-static-server.mjs`.
 */
import { expect, test, type Page, type Request } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";
const ORIGIN = new URL(BASE).origin;
const VIEWPORT_H = 560;
/** WalkthroughVideo's NEAR_VIEWPORT margin, in px. */
const NEAR_PX = 400;

test.use({
  baseURL: BASE,
  viewport: { width: 390, height: VIEWPORT_H },
  launchOptions: process.env.E2E_CHROMIUM
    ? { executablePath: process.env.E2E_CHROMIUM }
    : {},
});
test.setTimeout(90_000);

const MEDIA = /\/media\/walkthrough(-poster\.jpg|\.mp4|\.webm|\.en\.vtt)$/;
const FILM = /\.(mp4|webm)$/;
const VIDEO_HOSTS =
  /youtube|youtu\.be|ytimg|vimeo|wistia|jwplayer|brightcove|mux\.com|cloudflarestream|vidyard|loom\.com/i;

type CspReport = { directive: string; blocked: string };

async function recordCsp(page: Page): Promise<CspReport[]> {
  const reports: CspReport[] = [];
  await page.exposeBinding("__walkCsp", (_source, r: CspReport) => {
    reports.push(r);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as {
        __walkCsp: (r: { directive: string; blocked: string }) => void;
      };
      w.__walkCsp({ directive: e.effectiveDirective, blocked: e.blockedURI });
    });
  });
  return reports;
}

test("walkthrough: poster on scroll, film on click, self-hosted, never autoplays", async ({
  page,
}) => {
  const csp = await recordCsp(page);
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  const mediaRequests = (): string[] =>
    requests.map((r) => r.url()).filter((u) => MEDIA.test(u));

  await page.goto("/", { waitUntil: "load" });
  const slot = page.getByTestId("walkthrough-slot");
  // Presence first: the slot and its play button are on the page.
  await expect(slot).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /watch the walkthrough/i }),
  ).toHaveCount(1);
  // Precondition: the slot starts beyond the near-viewport margin, so the gate is under test.
  const top = (await slot.boundingBox())?.y ?? 0;
  expect(top).toBeGreaterThan(VIEWPORT_H + NEAR_PX);
  // Far from the viewport: no <video>, and neither the film nor its captions are requested.
  // (The poster is a native loading="lazy" image, whose distance threshold is the browser's own
  // and can be well over a thousand pixels; it is the cheap "poster first" part by design.)
  await page.waitForTimeout(1000);
  await expect(slot.locator("video")).toHaveCount(0);
  expect(mediaRequests().filter((u) => !u.endsWith("-poster.jpg"))).toEqual([]);

  await slot.scrollIntoViewIfNeeded();
  const video = slot.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).not.toHaveAttribute("autoplay", /.*/);
  await expect
    .poll(() => mediaRequests().some((u) => u.endsWith("-poster.jpg")))
    .toBe(true);
  // Scrolled to, not pressed: the film is not fetched and nothing plays.
  await page.waitForTimeout(1500);
  expect(mediaRequests().some((u) => FILM.test(u))).toBe(false);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  const canPlay = await video.evaluate((v: HTMLVideoElement) =>
    [
      v.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'),
      v.canPlayType('video/webm; codecs="vp9, opus"'),
    ].join(""),
  );
  await page.getByRole("button", { name: /watch the walkthrough/i }).click();
  await expect.poll(() => mediaRequests().some((u) => FILM.test(u))).toBe(true);

  if (canPlay === "") {
    console.log("WALKTHROUGH_BRANCH fallback (no decoder for either source)");
    await expect(slot).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Parent view" }),
    ).toBeVisible();
    await expect(
      page.locator('img[src="/images/home/product-practice.jpg"]'),
    ).toBeVisible();
  } else {
    console.log("WALKTHROUGH_BRANCH playback");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0.5);
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) => {
          const t = v.textTracks[0];
          return t ? `${t.kind}:${t.language}:${t.mode}` : "none";
        }),
      )
      .toBe("captions:en:showing");
  }

  // Self-hosted: every media request is same-origin, and no video host is contacted at all.
  for (const u of mediaRequests()) expect(new URL(u).origin).toBe(ORIGIN);
  const offOrigin = requests
    .map((r) => r.url())
    .filter((u) => !u.startsWith("data:") && new URL(u).origin !== ORIGIN);
  console.log(`WALKTHROUGH_OFF_ORIGIN ${JSON.stringify(offOrigin)}`);
  expect(offOrigin.filter((u) => VIDEO_HOSTS.test(u))).toEqual([]);
  expect(csp).toEqual([]);
});
