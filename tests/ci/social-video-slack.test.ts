/**
 * The October SAT scores TikTok: its caption and on-screen copy follow the brief, and its Slack
 * post sends the MP4 then the caption, verbatim, through the shared client.
 *
 * @spec [owner brief 2026-10-16 (TikTok, October SAT score release); scripts/social/post-video-to-slack.ts;
 *       scripts/slack/client.ts] | @implemented [2026-10-16]
 *
 * plain English: the caption and composition are the committed files the workflow renders and
 * posts. The MP4 bytes are a minimal ftyp header: the post never reads past it.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../scripts/social/post-video-to-slack";
import type { FetchLike } from "../../scripts/slack/client";

const DIR = "brag-output-2026-10-16-oct-scores";
const CAPTION = readFileSync(join(DIR, "share-copy.txt"), "utf-8").trim();
const HTML = readFileSync(join(DIR, "composition/index.html"), "utf-8");
const VTT = readFileSync(join(DIR, "oct-scores.en.vtt"), "utf-8");
const ENV = { SLACK_BOT_TOKEN: "xoxb-test-token-not-real", SLACK_CHANNEL_ID: "C0TESTCHAN1" };

/** Visible text in the composition: tag content and alt text, scripts and styles removed. */
function onScreen(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/alt="([^"]*)"/g, " $1 ")
    .replace(/<[^>]+>/g, " ");
}

describe("the October scores TikTok copy", () => {
  it("the caption is the brief's, verbatim", () => {
    expect(CAPTION).toBe(
      "October SAT scores are out! How'd you do? Drop your score 👇 Retaking? Nov 7 registration closes Oct 23 (late reg Oct 27). #SAT #SATscores #satprep #collegeadmissions #studytok",
    );
  });

  it("shows every scripted line and the dates (presence)", () => {
    const text = onScreen(HTML);
    for (const line of [
      "October SAT scores just dropped",
      "Whatever you got, congrats on sitting that test.",
      "Drop your score",
      "Nov 7 registration: Oct 23",
      "(late: Oct 27)",
      "Dec 5: Nov 20",
      "Don't just study more. Study what you missed.",
      "lyceon.ai",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("no AI or process mention on screen, in the captions or in the caption text", () => {
    const process = /\b(AI|A\.I\.|artificial|generated|robot|machine|algorithm)\b/i;
    // The URL is the one allowed ".ai": strip it before looking.
    for (const text of [onScreen(HTML), VTT, CAPTION]) {
      expect(text.replace(/lyceon\.ai/g, "")).not.toMatch(process);
    }
  });

  it("makes no score promise", () => {
    const promise = /\b(guarantee|boost|raise|improve|points?|\+\d+)\b/i;
    for (const text of [onScreen(HTML), VTT, CAPTION]) expect(text).not.toMatch(promise);
  });

  it("is 1080×1920 and 22.5 s, as the workflow checks", () => {
    expect(HTML).toContain('data-width="1080" data-height="1920" data-duration="22.5"');
  });
});

type Call = { url: string; body: unknown };

function fakeSlack(failMethod?: string): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    const method = url.replace("https://slack.com/api/", "");
    const reply = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (method === failMethod) return reply({ ok: false, error: "not_in_channel" });
    if (method === "files.getUploadURLExternal") {
      return reply({ ok: true, upload_url: "https://files.slack.com/upload/v1/t", file_id: "F0001" });
    }
    if (url.startsWith("https://files.slack.com/")) return reply({});
    if (method === "files.completeUploadExternal") return reply({ ok: true, files: [{ id: "F0001" }] });
    if (method === "chat.postMessage") return reply({ ok: true, ts: "1760000000.000100" });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, calls };
}

function fixture(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "social-video-"));
  const video = join(dir, "v.mp4");
  writeFileSync(video, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom")]));
  return ["--video", video, "--caption", join(DIR, "share-copy.txt"), "--title", "Oct scores"];
}

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe("post-video-to-slack", () => {
  it("uploads the MP4 for review, then posts the caption verbatim", async () => {
    const slack = fakeSlack();
    const l = logs();
    expect(await run(fixture(), ENV, slack.fetch, l.log)).toBe(0);
    expect(slack.calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/t",
      "https://slack.com/api/files.completeUploadExternal",
      "https://slack.com/api/chat.postMessage",
    ]);
    const complete = JSON.parse(String(slack.calls[2]!.body)) as { initial_comment: string; channel_id: string };
    expect(complete.channel_id).toBe("C0TESTCHAN1");
    expect(complete.initial_comment).toContain("Not posted anywhere yet");
    const message = JSON.parse(String(slack.calls[3]!.body)) as { text: string };
    expect(message.text).toBe(`*Caption*\n\`\`\`${CAPTION}\`\`\``);
    expect(l.out.join("\n")).not.toContain(ENV.SLACK_BOT_TOKEN);
  });

  it("a dry run sends nothing and needs no token", async () => {
    const slack = fakeSlack();
    expect(await run([...fixture(), "--dry-run"], {}, slack.fetch, logs().log)).toBe(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("fails loudly with no token, a non-MP4 or a Slack error", async () => {
    const noToken = logs();
    expect(await run(fixture(), {}, fakeSlack().fetch, noToken.log)).toBe(1);
    expect(noToken.err[0]).toMatch(/SLACK_BOT_TOKEN is not set/);

    const args = fixture();
    writeFileSync(args[1]!, "not a video");
    const notMp4 = logs();
    expect(await run(args, ENV, fakeSlack().fetch, notMp4.log)).toBe(1);
    expect(notMp4.err[0]).toMatch(/is not an MP4/);

    const slackErr = logs();
    expect(await run(fixture(), ENV, fakeSlack("chat.postMessage").fetch, slackErr.log)).toBe(1);
    expect(slackErr.err[0]).toMatch(/NOT POSTED: .*not_in_channel/);
  });
});
