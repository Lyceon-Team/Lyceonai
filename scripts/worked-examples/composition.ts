/**
 * Builds one worked example's Hyperframes composition from the kit templates, the approved content
 * file, its question from the seed SQL and its committed voice.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27), Video: 1080×1920,
 *       30-60 s, TikTok safe area (x 71..912, y 154..1555); fully blank paper, Caveat, ink-wipe
 *       reveal; the question and a bold hook line visible within 0.5 s and the voice from 0:00;
 *       order hook → question → steps → answer near the end → "The trap:" → end card "Follow for
 *       daily SAT questions" + lyceon.ai; word-by-word highlighted captions; the /brag voice and
 *       the quiet music track ducked well under it. "Every video is rendered from the templates +
 *       the approved content file. Nothing is hand-edited."] | @implemented [2026-10-27]
 *
 * plain English: pure. The voice lines play back to back from 0:00 with the kit's gap between
 * them; everything on screen is timed from where each line starts:
 *   * open (0 → first step): the hook card and the question card, both on screen from frame 0;
 *   * work (first step → trap): a small recap of the question, then each step's notepad line
 *     written on with a left-to-right ink wipe as its voice line starts, then the answer written
 *     and circled;
 *   * trap (trap → end card): "The trap:" and its notepad lines, written through the trap line;
 *   * end card (outro → end): logo, "Follow for daily SAT questions", lyceon.ai.
 * Captions show the spoken script, never the transcription (Whisper mishears "Lyceon"), in chunks
 * of at most five words, each word highlighted while it is spoken: word times come from the
 * committed transcription, matched one to one when the counts agree, otherwise spread over the
 * spoken span by character position. A fit script shrinks any line that would leave the safe
 * column before the timeline is registered, and scripts/worked-examples/layout-check.ts proves
 * the result in a browser.
 */
import type { SeedQuestion } from "../../shared/worked-examples/seed-question";
import { plainMathText } from "../../shared/qotd/plain-math";
import { tiktokSafePx, QOTD_TIKTOK_SIZE } from "../../shared/qotd/tiktok";
import type {
  VoiceLine,
  WorkedExampleContent,
} from "../../packages/shared/src/worked-example-schema";
import { TRAP_HEADING } from "../../shared/worked-examples/rules";
import { escapeHtml, fill, type Kit } from "./kit";

/** The safe area in pixels: x 71..912, y 154..1555 on 1080×1920. */
export function safeArea(): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const px = tiktokSafePx();
  return {
    left: px.left,
    right: QOTD_TIKTOK_SIZE.width - px.right,
    top: px.top,
    bottom: QOTD_TIKTOK_SIZE.height - px.bottom,
  };
}

export const CAPTION_MAX_WORDS = 5;
/** Where the notepad may write: below the recap, above the captions. */
const NOTEPAD_TOP = 400;
const NOTEPAD_BOTTOM = 1330;

export type ScriptLine = { key: string; text: string };

/** Every spoken line, in screen order, with the end card's line from the kit last. */
export function scriptLines(
  example: WorkedExampleContent,
  outroText: string,
): ScriptLine[] {
  return [
    { key: "hook", text: example.hook.voice },
    { key: "question", text: example.question_voice },
    ...example.steps.map((s, k) => ({ key: `step-${k + 1}`, text: s.voice })),
    { key: "answer", text: example.answer.voice },
    { key: "trap", text: example.trap.voice },
    { key: "outro", text: outroText },
  ];
}

export type PlacedLine = VoiceLine & { start: number };

/** Lines back to back from 0:00 with `gap` seconds between them. */
export function placeLines(
  lines: readonly VoiceLine[],
  gap: number,
): PlacedLine[] {
  let t = 0;
  return lines.map((line, k) => {
    const placed = { ...line, start: round(t) };
    t += line.duration + (k < lines.length - 1 ? gap : 0);
    return placed;
  });
}

export function videoDuration(
  placed: readonly PlacedLine[],
  endHold: number,
): number {
  const last = placed[placed.length - 1];
  return last ? round(last.start + last.duration + endHold) : 0;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type TimedWord = { text: string; start: number; end: number };

/**
 * The script's words with times (relative to the line): the transcription's own times when it
 * heard the same number of words, otherwise spread over its spoken span by character position.
 */
export function scriptWordTimes(text: string, line: VoiceLine): TimedWord[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === line.words.length)
    return words.map((w, k) => ({
      text: w,
      start: line.words[k]?.start ?? 0,
      end: line.words[k]?.end ?? 0,
    }));
  const first = line.words[0]?.start ?? 0;
  const last = line.words[line.words.length - 1]?.end ?? line.duration;
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  let offset = 0;
  return words.map((w) => {
    const start = first + ((last - first) * offset) / total;
    offset += w.length + 1;
    const end = first + ((last - first) * offset) / total;
    return { text: w, start: round(start), end: round(end) };
  });
}

/** Consecutive chunks of at most CAPTION_MAX_WORDS words, sized evenly. */
export function captionChunks<T>(words: readonly T[]): T[][] {
  const n = Math.ceil(words.length / CAPTION_MAX_WORDS);
  const size = Math.ceil(words.length / Math.max(n, 1));
  const out: T[][] = [];
  for (let k = 0; k < words.length; k += size)
    out.push(words.slice(k, k + size));
  return out;
}

export type Beat = { key: string; start: number; end: number };

export type Composition = {
  html: string;
  duration: number;
  /** open, work, trap, endcard: the scene windows, for the checks. */
  scenes: Beat[];
  /** Voice clips as placed: key, file, start, duration. */
  voice: PlacedLine[];
  /** When each notepad write begins (step-1.., answer, trap lines). */
  writes: Beat[];
  /** Files the composition references, relative to its folder. */
  assets: {
    fonts: Record<string, string>;
    logo: string;
    music: string;
    gsap: string;
  };
};

export type CompositionInput = {
  example: WorkedExampleContent;
  question: SeedQuestion;
  /** The example's voice lines, in scriptLines order without the outro. */
  voice: readonly VoiceLine[];
  outro: VoiceLine;
  kit: Kit;
};

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function buildComposition(input: CompositionInput): Composition {
  const { example, question, kit } = input;
  const script = scriptLines(example, kit.voice.outro_caption);
  const lines = [...input.voice, input.outro];
  if (lines.map((l) => l.key).join() !== script.map((s) => s.key).join())
    throw new Error(
      `voice lines ${lines.map((l) => l.key).join(",")} do not match the script ${script.map((s) => s.key).join(",")}`,
    );
  const placed = placeLines(lines, kit.voice.gap_seconds);
  const duration = videoDuration(placed, kit.voice.end_hold_seconds);
  const at = (key: string): PlacedLine => {
    const p = placed.find((l) => l.key === key);
    if (!p) throw new Error(`no voice line ${key}`);
    return p;
  };
  const tWork = at("step-1").start;
  const tTrap = at("trap").start;
  const tEnd = at("outro").start;
  const scenes: Beat[] = [
    { key: "open", start: 0, end: tWork },
    { key: "work", start: tWork, end: tTrap },
    { key: "trap", start: tTrap, end: tEnd },
    { key: "endcard", start: tEnd, end: duration },
  ];
  const safe = safeArea();
  const t = kit.templates;
  const c = kit.brand.colours;

  // Open: hook card + question card, on screen from frame 0.
  const options = question.options
    .map(
      (o) => `<li><b>${o.key})</b> ${escapeHtml(plainMathText(o.text))}</li>`,
    )
    .join("");
  const passage =
    question.passage && question.passage.trim() !== ""
      ? `<div class="passage">${escapeHtml(plainMathText(question.passage))}</div>`
      : "";
  const open =
    fill(t["hook-card"], { hookLine: escapeHtml(example.hook.line) }) +
    fill(t["question-card"], {
      passage,
      stem: escapeHtml(plainMathText(question.stem)),
      options,
    });

  // Work: recap, steps, answer.
  const rows = example.steps.length + 1;
  const pitch = Math.min(
    160,
    Math.floor((NOTEPAD_BOTTOM - NOTEPAD_TOP - 100) / rows),
  );
  const writes: Beat[] = [];
  const writeLen = (d: number): number =>
    round(Math.min(1.6, Math.max(0.8, d * 0.5)));
  const steps = example.steps
    .map((s, k) => {
      const line = at(`step-${k + 1}`);
      writes.push({
        key: `step-${k + 1}`,
        start: round(line.start + 0.2),
        end: round(line.start + 0.2 + writeLen(line.duration)),
      });
      return fill(t["step-reveal"], {
        top: String(NOTEPAD_TOP + k * pitch),
        size: "80",
        id: `step-${k + 1}`,
        text: escapeHtml(s.notepad),
      });
    })
    .join("\n");
  const answerLine = at("answer");
  writes.push({
    key: "answer",
    start: round(answerLine.start + 0.2),
    end: round(answerLine.start + 0.2 + writeLen(answerLine.duration)),
  });
  const answer = fill(t["answer-reveal"], {
    top: String(NOTEPAD_TOP + example.steps.length * pitch + 20),
    size: "96",
    text: escapeHtml(example.answer.notepad),
  });
  const recap = `<div class="recap"><div class="stem">${escapeHtml(plainMathText(question.stem))}</div><div>${question.options
    .map((o) => `${o.key}) ${escapeHtml(plainMathText(o.text))}`)
    .join(" · ")}</div></div>`;

  // Trap: heading at the line's start, then each notepad line through the spoken trap.
  const trapLine = at("trap");
  writes.push({
    key: "trap-head",
    start: round(trapLine.start + 0.1),
    end: round(trapLine.start + 0.9),
  });
  const trapLines = example.trap.notepad
    .map((text, k) => {
      const start = round(
        trapLine.start +
          ((k + 1) * trapLine.duration) / (example.trap.notepad.length + 1),
      );
      writes.push({ key: `trap-${k + 1}`, start, end: round(start + 1.2) });
      return fill(t["step-reveal"], {
        top: String(520 + k * 170),
        size: "80",
        id: `trap-${k + 1}`,
        text: escapeHtml(text),
      });
    })
    .join("\n");
  const trap = fill(t["trap-callout"], { lines: trapLines });

  const scene = (
    key: string,
    beat: Beat,
    track: number,
    body: string,
    cls = "",
  ): string =>
    `<section id="${key}" class="clip scene${cls}" data-start="${beat.start}" data-duration="${round(beat.end - beat.start)}" data-track-index="${track}">\n${body}\n</section>`;
  const [sOpen, sWork, sTrap, sEnd] = scenes as [Beat, Beat, Beat, Beat];
  const scenesHtml = [
    scene("open", sOpen, 0, open),
    scene("work", sWork, 1, `${recap}\n${steps}\n${answer}`),
    scene("trap", sTrap, 0, trap),
    scene("endcard", sEnd, 1, t["end-card"].trim(), " end"),
  ].join("\n");

  // Captions: the script's words, chunked, each word lit while spoken.
  const capHtml: string[] = [];
  const karaoke: string[] = [];
  script.forEach((s, li) => {
    const line = at(s.key);
    const next = placed[li + 1];
    const lineEnd = next ? next.start : duration;
    const words = scriptWordTimes(s.text, line).map((w, k) => ({ ...w, k }));
    const chunks = captionChunks(words);
    chunks.forEach((chunk, ci) => {
      const first = chunk[0];
      if (!first) return;
      const start = ci === 0 ? line.start : round(line.start + first.start);
      const nextChunk = chunks[ci + 1]?.[0];
      const end = nextChunk ? round(line.start + nextChunk.start) : lineEnd;
      const spans = chunk
        .map(
          (w) =>
            `<span id="w-${s.key}-${w.k}" class="wd">${escapeHtml(w.text)}</span>`,
        )
        .join(" ");
      capHtml.push(
        `<section id="cap-${s.key}-${ci}" class="clip cap" data-start="${start}" data-duration="${round(end - start)}" data-track-index="5"><div class="cap-in"><div class="cap-box">${spans}</div></div></section>`,
      );
      for (const w of chunk) {
        karaoke.push(
          `tl.set("#w-${s.key}-${w.k}", { backgroundColor: "${c.highlight}", color: "${c.ink}" }, ${round(line.start + w.start)});`,
          `tl.set("#w-${s.key}-${w.k}", { backgroundColor: "rgba(0,0,0,0)", color: "${c.captionText}" }, ${round(line.start + w.end)});`,
        );
      }
    });
  });

  const fonts: Record<string, string> = {};
  const fontFaces = Object.entries(kit.brand.fonts)
    .map(([name, f]) => {
      const family = name.split("-")[0] ?? name;
      fonts[`assets/fonts/${basename(f.file)}`] = f.file;
      return `@font-face { font-family: "${family}"; font-weight: ${f.weight}; src: url("assets/fonts/${basename(f.file)}") format("woff2"); }`;
    })
    .join("\n");
  const music = `assets/music/${basename(kit.track.file)}`;
  const audio = [
    ...placed.map(
      (l) =>
        `<audio id="vo-${l.key}" src="assets/voice/${l.file}" data-start="${l.start}" data-duration="${round(l.duration)}" data-track-index="3" data-volume="1"></audio>`,
    ),
    `<audio id="music-bed" src="${music}" data-start="0" data-duration="${duration}" data-track-index="10" data-volume="1" data-automation='${JSON.stringify(
      {
        version: 1,
        lanes: [
          {
            target: "volume",
            points: [
              { t: 0, v: kit.voice.music_gain },
              {
                t: round(duration - kit.voice.music_fade_seconds),
                v: kit.voice.music_gain,
              },
              { t: duration, v: 0 },
            ],
          },
        ],
      },
    )}'></audio>`,
  ].join("\n");

  const wipes = writes
    .map(
      (w) =>
        `tl.fromTo("#${w.key === "answer" ? "answer-ink" : w.key}", { clipPath: "inset(-20% 100% -20% 0%)" }, { clipPath: "inset(-20% 0% -20% 0%)", duration: ${round(w.end - w.start)}, ease: "none" }, ${w.start});`,
    )
    .join("\n");
  const answerWrite = writes.find((w) => w.key === "answer");
  const js = `// Generated by scripts/worked-examples/generate.ts from the kit and the approved content file. Do not edit.
const SAFE = ${JSON.stringify(safe)};
function fit(el, ok) { if (!el) return; let s = parseFloat(getComputedStyle(el).fontSize); while (s > 24 && !ok(el)) { s -= 2; el.style.fontSize = s + "px"; } }
const right = (el) => el.offsetLeft + el.offsetWidth;
const bottom = (el) => el.offsetTop + el.offsetHeight;
document.fonts.ready.then(() => {
  document.querySelectorAll(".hand").forEach((el) => fit(el, (e) => right(e) <= SAFE.right));
  fit(document.getElementById("hook-line"), (e) => bottom(e) <= 380);
  fit(document.getElementById("question-card"), (e) => bottom(e) <= ${NOTEPAD_BOTTOM});
  fit(document.querySelector(".recap"), (e) => bottom(e) <= ${NOTEPAD_TOP - 15});
  const tl = gsap.timeline({ paused: true });
${wipes}
  tl.fromTo("#answer-circle", { opacity: 0, scale: 1.15 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, ${answerWrite ? answerWrite.end : 0});
${karaoke.join("\n")}
  window.__timelines["main"] = tl;
});`;

  const css = fill(kit.css, {
    paper: c.paper,
    ink: c.ink,
    inkSoft: c.inkSoft,
    border: c.border,
    red: c.red,
    captionText: c.captionText,
    safeLeft: String(safe.left),
    safeWidth: String(safe.right - safe.left),
    safeRightInset: String(QOTD_TIKTOK_SIZE.width - safe.right),
  });
  const html = fill(t.frame, {
    title: escapeHtml(
      `Worked example: ${example.skill_code} (${example.question_id})`,
    ),
    fontFaces,
    css,
    duration: String(duration),
    scenes: scenesHtml,
    captions: capHtml.join("\n"),
    audio,
    script: js,
  });
  if (!html.includes(TRAP_HEADING))
    throw new Error("the trap callout lost its heading");
  return {
    html,
    duration,
    scenes,
    voice: placed,
    writes,
    assets: {
      fonts,
      logo: kit.brand.logo,
      music: kit.track.file,
      gsap: kit.brand.gsap,
    },
  };
}
