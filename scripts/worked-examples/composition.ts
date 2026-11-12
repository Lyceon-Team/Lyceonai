/**
 * Builds one worked example's Hyperframes composition from the kit templates, the approved content
 * file, its question from the seed SQL and its committed voice.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27), Video: 1080×1920,
 *       30-60 s, TikTok safe area (x 71..912, y 154..1555); fully blank paper, Caveat, ink-wipe
 *       reveal; the question and a bold hook line visible within 0.5 s and the voice from 0:00;
 *       the /brag voice and the quiet music track ducked well under it. "Every video is rendered
 *       from the templates + the approved content file. Nothing is hand-edited."; SCL-267 (Karl's
 *       rulings 2026-11-02, later the same day): no burned-in word-by-word captions, the space
 *       given back to the notepad; spoken order hook → setup → steps → trap → answer and check →
 *       call to action (replacing the brief's hook → question → steps → answer → "The trap:" and
 *       its word-by-word highlighted captions); the CTA "Follow, there's one of these every day."
 *       and the end card "Lyceon SAT Prep" (replacing "lyceon.ai")]
 *       | @implemented [2026-10-27, order and captions 2026-11-02]
 *
 * plain English: pure. The voice lines play back to back from 0:00 with the kit's gap between
 * them, in the spoken order; everything on screen is timed from where each line starts:
 *   * open (0 → first step): the hook card and the question card, both on screen from frame 0,
 *     while the hook and the one-sentence setup are spoken;
 *   * work (first step → trap): a small recap of the question, then each step's notepad line
 *     written on with a left-to-right ink wipe as its voice line starts;
 *   * trap (trap → answer): "The trap:" and its notepad lines, written through the trap line;
 *   * answer (answer → end card): the recap and the steps again, already written, then the answer
 *     written and circled while the answer and its quick check are spoken;
 *   * end card (call to action → end): logo, "Follow for daily SAT questions", "Lyceon SAT Prep".
 * There are no captions: the handwriting carries the content, and the notepad runs down to just
 * above the safe area's bottom edge. A fit script shrinks any line that would leave the safe
 * column before the timeline is registered, and scripts/worked-examples/layout-check.ts proves
 * the result in a browser. Voice lines are matched to the script by key, so a manifest voiced
 * before the 2026-11-02 order (answer before trap) still places every line correctly.
 *
 * @spec [SCL-266 as ruled by Karl 2026-11-02 (#1398): the QOTD breakdown is rendered by the
 *       worked-example pipeline from an authored script, under the same script rules and the
 *       same spoken order] | @implemented [2026-11-02]
 * plain English (2026-11-02): one body, buildScriptComposition, renders every video the kit
 * makes from a spoken script (WorkedExampleScript): a worked example (buildComposition, which
 * only maps the example and its title) and a QOTD breakdown (scripts/qotd-social/breakdown.ts),
 * whose question card shows the choices in the day's stored order under its display letters.
 */
import type { HookQuestion } from "../../shared/worked-examples/rules";
import { plainMathText } from "../../shared/qotd/plain-math";
import { tiktokSafePx, QOTD_TIKTOK_SIZE } from "../../shared/qotd/tiktok";
import type {
  VoiceLine,
  WorkedExampleContent,
  WorkedExampleFigure,
  WorkedExampleFigureWhen,
  WorkedExampleScript,
} from "../../packages/shared/src/worked-example-schema";
import { TRAP_HEADING } from "../../shared/worked-examples/rules";
import {
  FIGURE_GAP,
  FIGURE_TOP,
  OPEN_DRAW_START,
  figureBeats,
  figureHtml,
  figureTweens,
  layoutFigure,
  type FigureBeat,
} from "./figure";
import { escapeHtml, fill, type Kit } from "./kit";

/** The end card's outro text sizes: "Follow for daily SAT questions" and "Lyceon SAT Prep". */
export const OUTRO_FOLLOW_PX = 80;
export const OUTRO_BRAND_PX = 76;

/**
 * The music credit on the end card.
 *
 * @spec [Karl's ruling 2026-11-04, "Copy-paste cleanup for all #social outputs", 3: the credit the
 *       track's licence requires moves from every caption to the video's end card, "small,
 *       legible on-screen text ... visible for the whole end card", inside the safe area (the
 *       layout check confirms it); "the credit line should be small at the right at at most 1/4
 *       of the outro font and should not be said in the video"; a track that needs no
 *       attribution shows no credit] | @implemented [2026-11-04]
 *
 * plain English: a quarter of the smaller outro size, rounded down (19 px), right-aligned at the
 * bottom right of the safe area, static for the whole end card. It is text on screen only: no
 * voice line reads it (the outro voice is fixed in voice.json).
 */
export const END_CARD_CREDIT_PX = Math.floor(
  Math.min(OUTRO_FOLLOW_PX, OUTRO_BRAND_PX) / 4,
);
/** The gap between the credit's baseline box and the safe area's bottom edge. */
export const END_CARD_CREDIT_MARGIN_PX = 12;

/** The end card's credit element, or nothing for a track whose licence needs no credit. */
export function endCardCreditHtml(kit: Kit): string {
  const credit = kit.track.on_screen_credit;
  return credit === null
    ? ""
    : `<div class="credit">${escapeHtml(credit)}</div>`;
}

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

/** Where the notepad may write: below the recap, down to just above the safe area's bottom. */
const NOTEPAD_TOP = 400;
const NOTEPAD_BOTTOM = 1530;
/** The tallest row a step may take, and the handwriting sizes (before the fit script). */
const NOTEPAD_PITCH_MAX = 200;
const STEP_SIZE = "88";
const ANSWER_SIZE = "104";

export type ScriptLine = { key: string; text: string };

/**
 * Every spoken line, in spoken order (SCL-267): hook, setup, steps, trap, answer and check, then
 * the kit's call to action.
 */
export function scriptLines(
  example: WorkedExampleScript,
  outroText: string,
): ScriptLine[] {
  return [
    { key: "hook", text: example.hook.voice },
    { key: "question", text: example.question_voice },
    ...example.steps.map((s, k) => ({ key: `step-${k + 1}`, text: s.voice })),
    { key: "trap", text: example.trap.voice },
    { key: "answer", text: example.answer.voice },
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

export type Beat = { key: string; start: number; end: number };

export type Composition = {
  html: string;
  duration: number;
  /** open, work, trap, answer, endcard: the scene windows, for the checks. */
  scenes: Beat[];
  /** Voice clips as placed: key, file, start, duration. */
  voice: PlacedLine[];
  /** When each notepad write begins (step-1.., answer, trap lines). */
  writes: Beat[];
  /** When each figure stroke and label is drawn; empty without a figure. */
  figure: FigureBeat[];
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
  question: CompositionQuestion;
  /** The example's voice lines (any order: matched to scriptLines by key), without the outro. */
  voice: readonly VoiceLine[];
  outro: VoiceLine;
  kit: Kit;
};

/** The question as the card shows it: the choices in the order and under the letters given. */
export type CompositionQuestion = Pick<
  HookQuestion,
  "stem" | "passage" | "options"
>;

export type ScriptCompositionInput = {
  script: WorkedExampleScript;
  question: CompositionQuestion;
  /** The page title (not drawn). */
  title: string;
  /** A worked example's drawn figure (Karl, 2026-11-11); breakdowns have none. */
  figure?: WorkedExampleFigure | undefined;
  /** The script's voice lines (any order: matched to scriptLines by key), without the outro. */
  voice: readonly VoiceLine[];
  outro: VoiceLine;
  kit: Kit;
};

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A worked example's composition: its content as the script, titled by skill and question. */
export function buildComposition(input: CompositionInput): Composition {
  return buildScriptComposition({
    script: input.example,
    question: input.question,
    title: `Worked example: ${input.example.skill_code} (${input.example.question_id})`,
    figure: input.example.figure,
    voice: input.voice,
    outro: input.outro,
    kit: input.kit,
  });
}

/** THE composition body, for every video the kit renders from a spoken script. */
export function buildScriptComposition(
  input: ScriptCompositionInput,
): Composition {
  const { script: example, question, kit } = input;
  const script = scriptLines(example, kit.voice.outro_text);
  const given = [...input.voice, input.outro];
  const byKey = new Map(given.map((l) => [l.key, l]));
  const lines = script.map((s) => byKey.get(s.key));
  if (given.length !== script.length || lines.some((l) => l === undefined))
    throw new Error(
      `voice lines ${given.map((l) => l.key).join(",")} do not match the script ${script.map((s) => s.key).join(",")}`,
    );
  const placed = placeLines(
    lines.filter((l): l is VoiceLine => l !== undefined),
    kit.voice.gap_seconds,
  );
  const duration = videoDuration(placed, kit.voice.end_hold_seconds);
  const at = (key: string): PlacedLine => {
    const p = placed.find((l) => l.key === key);
    if (!p) throw new Error(`no voice line ${key}`);
    return p;
  };
  const tWork = at("step-1").start;
  const tTrap = at("trap").start;
  const tAnswer = at("answer").start;
  const tEnd = at("outro").start;
  const scenes: Beat[] = [
    { key: "open", start: 0, end: tWork },
    { key: "work", start: tWork, end: tTrap },
    { key: "trap", start: tTrap, end: tAnswer },
    { key: "answer", start: tAnswer, end: tEnd },
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

  // Work: recap, then the steps written one by one. With a figure, the notepad stops above it
  // and the handwriting shrinks to the row pitch; without one, nothing changes.
  const figure = input.figure;
  const notepadBottom = figure ? FIGURE_TOP - FIGURE_GAP : NOTEPAD_BOTTOM;
  const rows = example.steps.length + 1;
  const pitch = Math.min(
    NOTEPAD_PITCH_MAX,
    Math.floor((notepadBottom - NOTEPAD_TOP - 120) / rows),
  );
  const stepSize = figure
    ? String(Math.min(Number(STEP_SIZE), pitch - 8))
    : STEP_SIZE;
  const answerSize = figure
    ? String(Math.min(Number(ANSWER_SIZE), pitch + 16))
    : ANSWER_SIZE;
  const writes: Beat[] = [];
  const writeLen = (d: number): number =>
    round(Math.min(1.6, Math.max(0.8, d * 0.5)));
  const stepRow = (text: string, k: number, id: string): string =>
    fill(t["step-reveal"], {
      top: String(NOTEPAD_TOP + k * pitch),
      size: stepSize,
      id,
      text: escapeHtml(text),
    });
  const steps = example.steps
    .map((s, k) => {
      const line = at(`step-${k + 1}`);
      writes.push({
        key: `step-${k + 1}`,
        start: round(line.start + 0.2),
        end: round(line.start + 0.2 + writeLen(line.duration)),
      });
      return stepRow(s.notepad, k, `step-${k + 1}`);
    })
    .join("\n");
  const recap = `<div class="recap"><div class="stem">${escapeHtml(plainMathText(question.stem))}</div><div>${question.options
    .map((o) => `${o.key}) ${escapeHtml(plainMathText(o.text))}`)
    .join(" · ")}</div></div>`;

  // Trap (before the answer): heading at the line's start, then each notepad line through it.
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
        top: String(540 + k * 200),
        size: STEP_SIZE,
        id: `trap-${k + 1}`,
        text: escapeHtml(text),
      });
    })
    .join("\n");
  const trap = fill(t["trap-callout"], { lines: trapLines });

  // Answer (last): the recap and the finished steps, then the answer written and circled.
  const answerLine = at("answer");
  writes.push({
    key: "answer",
    start: round(answerLine.start + 0.2),
    end: round(answerLine.start + 0.2 + writeLen(answerLine.duration)),
  });
  const doneSteps = example.steps
    .map((s, k) => stepRow(s.notepad, k, `done-${k + 1}`))
    .join("\n");
  const answer = fill(t["answer-reveal"], {
    top: String(NOTEPAD_TOP + example.steps.length * pitch + 24),
    size: answerSize,
    text: escapeHtml(example.answer.notepad),
  });

  const scene = (
    key: string,
    beat: Beat,
    track: number,
    body: string,
    cls = "",
  ): string =>
    `<section id="${key}" class="clip scene${cls}" data-start="${beat.start}" data-duration="${round(beat.end - beat.start)}" data-track-index="${track}">\n${body}\n</section>`;
  const [sOpen, sWork, sTrap, sAnswer, sEnd] = scenes as [
    Beat,
    Beat,
    Beat,
    Beat,
    Beat,
  ];
  // The figure: its own clip from 0:00 to the end card, so every scene draws on the same figure.
  let figureBeatList: FigureBeat[] = [];
  let figureSection = "";
  let figureJs = "";
  if (figure) {
    const layout = layoutFigure(figure, safe);
    const windows: Partial<
      Record<WorkedExampleFigureWhen, { start: number; end: number }>
    > = {
      open: {
        start: OPEN_DRAW_START,
        end: round(Math.max(OPEN_DRAW_START, tWork - 0.2)),
      },
      answer: {
        start: round(
          (writes.find((w) => w.key === "answer")?.end ?? tAnswer) + 0.35,
        ),
        end: round(tEnd - 0.2),
      },
    };
    example.steps.forEach((_, k) => {
      const write = writes.find((w) => w.key === `step-${k + 1}`);
      const next =
        k + 1 < example.steps.length ? at(`step-${k + 2}`).start : tTrap;
      if (write)
        windows[`step-${k + 1}` as WorkedExampleFigureWhen] = {
          start: write.end,
          end: round(Math.max(write.end, next - 0.1)),
        };
    });
    figureBeatList = figureBeats(layout, windows);
    figureSection = `\n<section id="figure" class="clip scene" data-start="0" data-duration="${tEnd}" data-track-index="2">\n${figureHtml(layout)}\n</section>`;
    figureJs = `\n${figureTweens(layout, figureBeatList)}`;
  }

  const scenesHtml =
    [
      scene("open", sOpen, 0, open),
      scene("work", sWork, 1, `${recap}\n${steps}`),
      scene("trap", sTrap, 0, trap),
      scene("answer", sAnswer, 1, `${recap}\n${doneSteps}\n${answer}`),
      scene(
        "endcard",
        sEnd,
        0,
        fill(t["end-card"].trim(), { credit: endCardCreditHtml(kit) }),
        " end",
      ),
    ].join("\n") + figureSection;

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
  fit(document.getElementById("question-card"), (e) => bottom(e) <= ${notepadBottom});
  document.querySelectorAll(".recap").forEach((el) => fit(el, (e) => bottom(e) <= ${NOTEPAD_TOP - 15}));
  const tl = gsap.timeline({ paused: true });
${wipes}${figureJs}
  tl.fromTo("#answer-circle", { opacity: 0, scale: 1.15 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, ${answerWrite ? answerWrite.end : 0});
  window.__timelines["main"] = tl;
});`;

  const css = fill(kit.css, {
    paper: c.paper,
    ink: c.ink,
    inkSoft: c.inkSoft,
    border: c.border,
    red: c.red,
    safeLeft: String(safe.left),
    safeWidth: String(safe.right - safe.left),
    safeRightInset: String(QOTD_TIKTOK_SIZE.width - safe.right),
    outroFollowSize: String(OUTRO_FOLLOW_PX),
    outroBrandSize: String(OUTRO_BRAND_PX),
    creditSize: String(END_CARD_CREDIT_PX),
    creditBottom: String(
      QOTD_TIKTOK_SIZE.height - safe.bottom + END_CARD_CREDIT_MARGIN_PX,
    ),
  });
  const html = fill(t.frame, {
    title: escapeHtml(input.title),
    fontFaces,
    css,
    duration: String(duration),
    scenes: scenesHtml,
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
    figure: figureBeatList,
    assets: {
      fonts,
      logo: kit.brand.logo,
      music: kit.track.file,
      gsap: kit.brand.gsap,
    },
  };
}
