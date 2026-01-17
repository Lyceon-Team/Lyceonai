export type StudentQuestionType = "mc" | "fr";

export function inferQuestionType(options: any): StudentQuestionType {
  const arr = Array.isArray(options) ? options : [];
  return arr.length > 0 ? "mc" : "fr";
}

export function mapDbQuestionToStudentQuestion(q: any) {
  const options = Array.isArray(q.options)
    ? q.options
    : typeof q.options === "string"
      ? (() => { try { return JSON.parse(q.options); } catch { return []; } })()
      : [];

  const type = (q.type === "mc" || q.type === "fr") ? q.type : inferQuestionType(options);

  return {
    id: q.id,
    section: q.section,
    stem: q.stem,
    options,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    difficulty: q.difficulty ?? null,
    unit_tag: q.unit_tag ?? null,
    test_code: q.test_code ?? null,
    source_pdf_url: q.source_pdf_url ?? null,
    source_test_name: q.source_test_name ?? null,
    classification: q.classification ?? null,
    type,
  };
}
