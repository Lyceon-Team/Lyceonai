/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 B, D] | @implemented [2026-10-15]
 *
 * plain English: the transcript fetch's pure parts — reading the caption tracks out of a watch
 * page, choosing a creator-made English track over the automatic one, turning json3 events into
 * cues — and the tagging schema refusing a skill that isn't one of the 29 taxonomy names.
 */
import { describe, expect, it } from "vitest";
import {
  captionTracksFromWatchPage,
  chooseTrack,
  cuesFromJson3,
} from "../../scripts/rag/fetch-transcripts";
import { loadSkillNames } from "../../scripts/rag/map-skills";
import { tagSchema } from "../../scripts/rag/prompts";

const page = (tracks: unknown[]): string =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
  })};</script><script>var other = 1;</script>`;

describe("caption tracks", () => {
  const asr = {
    baseUrl: "https://www.youtube.com/api/timedtext?v=x&kind=asr",
    languageCode: "en",
    kind: "asr",
  };
  const manual = {
    baseUrl: "https://www.youtube.com/api/timedtext?v=x",
    languageCode: "en",
  };
  const spanish = {
    baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=es",
    languageCode: "es",
  };

  it("reads the tracks from ytInitialPlayerResponse", () => {
    expect(captionTracksFromWatchPage(page([asr, manual]))).toHaveLength(2);
    expect(captionTracksFromWatchPage("<html>no player</html>")).toEqual([]);
  });

  it("prefers a creator-made English track, falls back to automatic, else none", () => {
    expect(chooseTrack([asr, manual])).toEqual(manual);
    expect(chooseTrack([asr, spanish])).toEqual(asr);
    expect(chooseTrack([spanish])).toBeNull();
  });
});

describe("json3 → cues", () => {
  it("converts ms to seconds, joins segments, drops empty events, sorts by start", () => {
    const cues = cuesFromJson3({
      events: [
        {
          tStartMs: 4200,
          dDurationMs: 1800,
          segs: [{ utf8: "into " }, { utf8: "Desmos" }],
        },
        {
          tStartMs: 0,
          dDurationMs: 4000,
          segs: [{ utf8: "type the  equation" }],
        },
        { tStartMs: 5000, segs: [{ utf8: "\n" }] },
        { tStartMs: 6100 },
      ],
    });
    expect(cues).toEqual([
      { start: 0, end: 4, text: "type the equation" },
      { start: 4.2, end: 6, text: "into Desmos" },
    ]);
  });

  it("refuses a body that isn't json3", () => {
    expect(() => cuesFromJson3({ items: [] })).toThrow();
  });
});

describe("skill tagging schema", () => {
  const skills = loadSkillNames();

  it("lists the 29 taxonomy names", () => {
    expect(skills).toHaveLength(29);
    expect(skills).toContain("Linear Equations in One Variable");
  });

  it("accepts taxonomy names and refuses anything else or more than three", () => {
    const s = tagSchema(skills);
    expect(s.safeParse({ skill_codes: ["Linear Functions"] }).success).toBe(
      true,
    );
    expect(s.safeParse({ skill_codes: ["Linear functions"] }).success).toBe(
      false,
    );
    expect(s.safeParse({ skill_codes: ["LIN.1"] }).success).toBe(false);
    expect(s.safeParse({ skill_codes: skills.slice(0, 4) }).success).toBe(
      false,
    );
  });
});
