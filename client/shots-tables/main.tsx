/**
 * How a question with a markdown table renders TODAY — NOT shipped.
 *
 * plain English: mounts the real renderers with SATM2K9CGMN's real stem, taken verbatim from
 * `infra/supabase/seed/proving_batch_004.sql`, so the screenshots are of the shipped components
 * rather than of a mock.
 *
 * THREE RENDERERS COVER THE SIX SURFACES. `QuestionRenderer` is the body of practice, diagnostic,
 * Review (`/review/session/:id` runs the SAME component, route registry line 17) and both signed-in
 * QOTD surfaces; the exam draws its stem with `MathRenderer` directly; the public QOTD pages are
 * prerendered and use `StaticMath`, which cannot run MathRenderer's effect. `?eol=crlf` swaps every
 * newline for CRLF, to show whether the line ending changes anything.
 */
import { createRoot } from "react-dom/client";
import QuestionRenderer from "@/components/question-renderer";
import MathRenderer from "@/components/MathRenderer";
import { StaticMath } from "@/components/qotd/StaticMath";
import "@/index.css";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

/** SATM2K9CGMN, verbatim from the seed. */
const STEM_LF = [
  "The linear function $g$ is defined for all real numbers. The table below shows selected values of $g$.",
  "",
  "| $x$ | $g(x)$ |",
  "|---|---|",
  "| $-2$ | $11$ |",
  "| $1$ | $5$ |",
  "| $4$ | $-1$ |",
  "",
  "For what value of $x$ does $g(x) = 0$?",
].join("\n");

const OPTIONS = [
  { id: "opt_a", text: "$\\frac{5}{2}$" },
  { id: "opt_b", text: "$3$" },
  { id: "opt_c", text: "$\\frac{7}{2}$" },
  { id: "opt_d", text: "$\\frac{11}{2}$" },
];

const params = new URLSearchParams(window.location.search);
const stem =
  params.get("eol") === "crlf" ? STEM_LF.replace(/\n/g, "\r\n") : STEM_LF;
const eolLabel = params.get("eol") === "crlf" ? "CRLF (\\r\\n)" : "LF (\\n)";

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
        padding: 24,
        marginBottom: 24,
      }}
    >
      <h2 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, opacity: 0.7 }}>{where}</p>
      {children}
    </section>
  );
}

const mount = document.getElementById("root");
if (mount === null) throw new Error("no #root");

createRoot(mount).render(
  <div className="lyc" style={{ minHeight: "100vh", padding: 32 }}>
    <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>
      SATM2K9CGMN — as it renders today
    </h1>
    <p style={{ margin: "0 0 20px", fontSize: 13, opacity: 0.7 }}>
      Line endings in this render: {eolLabel}
    </p>

    <Panel
      title="QuestionRenderer (the shared runner)"
      where="practice · diagnostic · Review (/review/session/:id) · QOTD on the dashboard · /qotd"
    >
      <QuestionRenderer
        question={{
          questionType: "multiple_choice",
          stem,
          options: OPTIONS,
        }}
        selectedAnswer={null}
        onSelectAnswer={() => undefined}
        showResult={false}
      />
    </Panel>

    <Panel
      title="MathRenderer (the exam stem)"
      where="full-length: ExamQuestionView renders the stem with exactly this call"
    >
      <div className="text-base font-semibold leading-relaxed" data-testid="exam-stem">
        <MathRenderer content={stem} />
      </div>
    </Panel>

    <Panel
      title="StaticMath (prerendered)"
      where="public QOTD: /sat-question-of-the-day/:date and the /sat-practice-questions pages"
    >
      <StaticMath content={stem} />
    </Panel>
  </div>,
);
