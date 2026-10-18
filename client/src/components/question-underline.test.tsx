// @vitest-environment jsdom
/**
 * A paired <u>...</u> in question content draws an underline in every renderer; nothing else
 * in content is ever treated as markup.
 *
 * @spec [shared/question-markup.ts; live bug 2026-10-11 — 21 Text Structure and Purpose
 *       passages printed "<u>" and "</u>" instead of underlining the target sentence]
 *       | @implemented [2026-10-11]
 *
 * plain English: the fixtures are the 31 real seeded items, parsed out of
 * infra/supabase/seed by the same reader the CI gate uses, so these tests see the passages
 * students saw. Each one goes through MathRenderer (practice, diagnostic, review), StaticMath
 * (prerendered QOTD pages) and the exam passage view, and must show exactly one underline
 * holding the target sentence and no literal tag text. The denial cases prove the allowlist
 * is exactly the paired, attribute-free, lower-case tag.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MathRenderer } from "./MathRenderer";
import { StaticMath } from "./qotd/StaticMath";
import { PassageView } from "@/features/exam/components/PassageView";
import { buildPassageSegments } from "@/features/exam/lib/passage";
import { loadSeedQuestions } from "../../../scripts/ci/question-markup-gate";

const UNDERLINED = loadSeedQuestions().filter((q) =>
  (q.passage ?? "").includes("<u>"),
);

function target(passage: string): string {
  const m = /<u>([\s\S]*?)<\/u>/.exec(passage);
  if (m === null) throw new Error("fixture has no <u> span");
  return m[1]!;
}

async function renderMath(content: string): Promise<HTMLElement> {
  const { container } = render(<MathRenderer content={content} />);
  const inner = container.querySelector<HTMLElement>(
    '[data-testid="math-content"] > div',
  );
  if (inner === null) throw new Error("MathRenderer rendered no content node");
  await waitFor(() => expect(inner.style.display).toBe("block"));
  return inner;
}

describe("the 56 published underlined-sentence items", () => {
  it("are all present (presence before absence)", () => {
    expect(UNDERLINED).toHaveLength(58);
    for (const q of UNDERLINED) {
      expect(q.stem).toMatch(
        /the underlined (sentence|portion)|most nearly means?/,
      );
      expect(target(q.passage ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it.each(UNDERLINED.map((q) => [q.id, q.passage ?? ""]))(
    "%s: MathRenderer underlines the target and prints no tag",
    async (_id, passage) => {
      const el = await renderMath(passage);
      const us = el.querySelectorAll("u");
      expect(us).toHaveLength(1);
      expect(us[0]!.textContent).toBe(target(passage));
      expect(el.textContent).not.toContain("<u>");
      expect(el.textContent).not.toContain("</u>");
      expect(el.textContent).toBe(
        passage.replace("<u>", "").replace("</u>", ""),
      );
    },
  );

  it.each(UNDERLINED.map((q) => [q.id, q.passage ?? ""]))(
    "%s: StaticMath underlines the target and prints no tag",
    (_id, passage) => {
      const { container } = render(<StaticMath content={passage} />);
      const us = container.querySelectorAll("u");
      expect(us).toHaveLength(1);
      expect(us[0]!.textContent).toBe(target(passage));
      expect(container.textContent).toBe(
        passage.replace("<u>", "").replace("</u>", ""),
      );
    },
  );

  it.each(UNDERLINED.map((q) => [q.id, q.passage ?? ""]))(
    "%s: the exam passage view underlines the target; offsets still index the stored passage",
    (_id, passage) => {
      const segs = buildPassageSegments(passage, []);
      const cps = Array.from(passage);
      // Every code point of the stored passage is covered exactly once, tags included.
      let cursor = 0;
      for (const s of segs) {
        expect(s.start).toBe(cursor);
        cursor = s.end;
      }
      expect(cursor).toBe(cps.length);
      expect(segs.filter((s) => s.kind === "tag")).toHaveLength(2);
      const under = segs
        .filter((s) => s.kind !== "tag" && s.underlined)
        .map((s) => cps.slice(s.start, s.end).join(""))
        .join("");
      expect(under).toBe(target(passage));

      const { getByTestId } = render(
        <PassageView
          passage={passage}
          highlights={[]}
          onChange={() => undefined}
        />,
      );
      const root = getByTestId("exam-passage");
      expect(root.querySelectorAll("u")).toHaveLength(1);
      expect(root.querySelector("u")!.textContent).toBe(target(passage));
      expect(root.textContent).not.toContain("<u>");
    },
  );
});

describe("a highlight over the underlined sentence keeps both", () => {
  it("draws the underline inside the highlight mark, at the stored offsets", () => {
    const passage = UNDERLINED[0]!.passage ?? "";
    const cps = Array.from(passage);
    const start = Array.from(
      passage.slice(0, passage.indexOf("<u>") + 3),
    ).length;
    const end = start + Array.from(target(passage)).length;
    const { getByTestId } = render(
      <PassageView
        passage={passage}
        highlights={[{ start, end }]}
        onChange={() => undefined}
      />,
    );
    const mark = getByTestId("exam-passage").querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.querySelector("u")?.textContent).toBe(
      cps.slice(start, end).join(""),
    );
  });
});

describe("nothing but a paired, plain <u> is markup", () => {
  const cases: Array<[string, string]> = [
    ["an img with a handler", 'Before <img src=x onerror="alert(1)"> after'],
    ["a script tag", "Before <script>alert(1)</script> after"],
    ["a <u> with an attribute", '<u onclick="alert(1)">tap</u>'],
    ["an upper-case tag", "<U>shout</U>"],
    ["an unpaired open tag", "start <u>never closed"],
    ["an unpaired close tag", "never opened</u> end"],
    ["a bold tag", "<b>bold</b>"],
  ];

  it.each(cases)(
    "%s stays literal text in MathRenderer",
    async (_label, content) => {
      const el = await renderMath(content);
      expect(el.querySelector("img, script, b, [onclick]")).toBeNull();
      expect(el.querySelectorAll("u")).toHaveLength(0);
      expect(el.textContent).toBe(content);
    },
  );

  it.each(cases)("%s stays literal text in StaticMath", (_label, content) => {
    const { container } = render(<StaticMath content={content} />);
    expect(container.querySelector("img, script, b, [onclick]")).toBeNull();
    expect(container.querySelectorAll("u")).toHaveLength(0);
    expect(container.textContent).toBe(content);
  });

  it.each(cases)(
    "%s stays literal text in the exam passage view",
    (_label, content) => {
      const { getByTestId } = render(
        <PassageView
          passage={content}
          highlights={[]}
          onChange={() => undefined}
        />,
      );
      const root = getByTestId("exam-passage");
      expect(root.querySelector("img, script, b, [onclick]")).toBeNull();
      expect(root.querySelectorAll("u")).toHaveLength(0);
      expect(root.textContent).toBe(content);
    },
  );

  it("a tag inside maths is maths source, not markup", async () => {
    const el = await renderMath("Text $a<u>b$ more");
    expect(el.querySelectorAll("u")).toHaveLength(0);
    expect(el.querySelector(".katex")).not.toBeNull();
  });

  it("underlined maths and an escaped dollar render inside the underline", async () => {
    const el = await renderMath("Cost: <u>\\$5 and $x^2$</u> today");
    // The span crosses a text run and a maths token: each is wrapped in its own <u>.
    const us = Array.from(el.querySelectorAll("u"));
    expect(us).toHaveLength(2);
    expect(us[0]!.textContent).toBe("$5 and ");
    expect(us[1]!.querySelector(".katex")).not.toBeNull();
    expect(el.textContent).not.toContain("\\$");
    expect(el.textContent).not.toContain("<u>");
  });
});
