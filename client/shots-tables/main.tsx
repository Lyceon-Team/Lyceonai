/**
 * Every question with a markdown table, in every renderer — NOT shipped.
 *
 * @spec [owner brief 2026-11-04: "Before-and-after screenshots of all 23 table questions on
 *        practice, diagnostic, Review, QOTD (dashboard and /qotd), full-length, and the
 *        prerendered public pages", and "before-and-after screenshots of at least 10 non-table
 *        stems as well"] | @implemented [2026-11-04]
 *
 * plain English: mounts a real stem or passage, taken verbatim from the seed corpus, in the
 * three renderers that serve the seven surfaces. `?set=tables|plain` picks the corpus, `?i=`
 * the question, `?eol=crlf|lf` the line endings. Expected outcome: a before/after pair per
 * question, of the shipped components rather than of a mock.
 *
 * THREE RENDERERS COVER THE SEVEN SURFACES, and the labels say which. `QuestionRenderer` is the
 * body of practice, diagnostic, Review (`/review/session/:id` runs the SAME component, route
 * registry line 17) and both signed-in QOTD surfaces; the exam draws its stem with
 * `MathRenderer`, the exact call `ExamQuestionView` makes; the public pages are prerendered and
 * use `StaticMath`. Driving the six live pages would need Supabase auth and a live API, and a
 * screenshot of a login wall would prove nothing — so the renderers are mounted directly and
 * each panel names the surfaces it stands for.
 *
 * CRLF IS THE DEFAULT, because every published table row carries it (owner's read-only
 * production query, 2026-11-04) while the seed corpus is LF.
 */
import { createRoot } from "react-dom/client";
import QuestionRenderer from "@/components/question-renderer";
import MathRenderer from "@/components/MathRenderer";
import { StaticMath } from "@/components/qotd/StaticMath";
import CORPUS from "./questions.json";
import "@/index.css";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

type Question = {
  id: string;
  section: string;
  field: string;
  text: string;
};
const SETS: Record<string, Question[]> = {
  tables: CORPUS.tables as Question[],
  plain: CORPUS.plain as Question[],
};

const OPTIONS = [
  { id: "opt_a", text: "$\\frac{5}{2}$" },
  { id: "opt_b", text: "$3$" },
  { id: "opt_c", text: "$\\frac{7}{2}$" },
  { id: "opt_d", text: "$\\frac{11}{2}$" },
];

const params = new URLSearchParams(window.location.search);
const set = params.get("set") === "plain" ? "plain" : "tables";
const index = Number(params.get("i") ?? "0");
const question = SETS[set]![index]!;
const crlf = params.get("eol") !== "lf";
const text = crlf
  ? question.text.replace(/\r?\n/g, "\r\n")
  : question.text.replace(/\r\n/g, "\n");

function Panel({
  title,
  where,
  children,
}: {
  title: string;
  where: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 12,
        background: "var(--sheet)",
        padding: 20,
        marginBottom: 18,
      }}
    >
      <h2 style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: "0 0 14px", fontSize: 12, opacity: 0.65 }}>{where}</p>
      {children}
    </section>
  );
}

const mount = document.getElementById("root");
if (mount === null) throw new Error("no #root");

/** A passage goes in the passage slot; a stem in the stem slot. */
const asPassage = question.field === "passage";

createRoot(mount).render(
  <div className="lyc" style={{ minHeight: "100vh", padding: 28 }}>
    <h1 style={{ fontSize: 19, margin: "0 0 2px" }}>
      {question.id} · {question.section} · {question.field} ·{" "}
      {crlf ? "CRLF" : "LF"}
    </h1>
    <p style={{ margin: "0 0 18px", fontSize: 12, opacity: 0.65 }}>
      {set === "tables"
        ? "table question"
        : "control: a stem with no table — must not change"}
    </p>

    <Panel
      title="QuestionRenderer (the shared runner)"
      where="practice · diagnostic · Review (/review/session/:id) · QOTD on the dashboard · /qotd"
    >
      <QuestionRenderer
        question={{
          questionType: "multiple_choice",
          stem: asPassage ? "Which choice best describes the table?" : text,
          passage: asPassage ? text : null,
          options: OPTIONS,
        }}
        selectedAnswer={null}
        onSelectAnswer={() => undefined}
        showResult={false}
      />
    </Panel>

    <Panel
      title="MathRenderer (the exam)"
      where="full-length: ExamQuestionView renders the stem with exactly this call"
    >
      <div className="text-base font-semibold leading-relaxed">
        <MathRenderer content={text} />
      </div>
    </Panel>

    <Panel
      title="StaticMath (prerendered)"
      where="public: /sat-question-of-the-day/:date and the /sat-practice-questions pages"
    >
      <StaticMath content={text} />
    </Panel>
  </div>,
);
