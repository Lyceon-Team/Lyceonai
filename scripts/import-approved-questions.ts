import { getSupabaseAdmin } from "../apps/api/src/lib/supabase-admin";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

interface ParsedQuestion {
  id: string;
  section: string;
  sectionCode: "MATH" | "RW";
  difficulty: string;
  stem: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  document: string;
}

function parseMarkdownQuestions(content: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const questionBlocks = content.split(/\d+\.\s+QUESTION ID:/);

  for (let i = 1; i < questionBlocks.length; i++) {
    const block = questionBlocks[i];

    try {
      const idMatch = block.match(/^\s*([a-f0-9-]+)/);
      const sectionMatch = block.match(/Section:\s*(Math|Reading|Writing|Reading and Writing)/i);
      const difficultyMatch = block.match(/Difficulty:\s*(Easy|Medium|Hard)/i);
      const documentMatch = block.match(/Document:\s*(.+?)(?:\n|$)/);
      const stemMatch = block.match(/QUESTION STEM:\s*\n\s*(.+?)(?=\n\s*ANSWER OPTIONS:)/s);
      const optionsMatch = block.match(/ANSWER OPTIONS:\s*\n([\s\S]+?)(?=\n\s*CORRECT ANSWER:)/);
      const answerMatch = block.match(/CORRECT ANSWER:\s*([A-D])/);
      const explanationMatch = block.match(/EXPLANATION:\s*\n([\s\S]+?)(?=\n\s*={10,}|$)/);

      if (!idMatch || !sectionMatch || !difficultyMatch || !stemMatch || !answerMatch) {
        console.log(`Skipping question block ${i}: missing required fields`);
        continue;
      }

      const sectionLabel = sectionMatch[1].toLowerCase();
      const sectionCode: "MATH" | "RW" = sectionLabel.includes("math") ? "MATH" : "RW";
      const section = sectionCode === "MATH" ? "Math" : "Reading and Writing";
      const optionsText = optionsMatch ? optionsMatch[1].trim() : "";
      const options = parseOptions(optionsText);

      const parsedQuestion: ParsedQuestion = {
        id: idMatch[1].trim(),
        section,
        sectionCode,
        difficulty: difficultyMatch[1].toLowerCase(),
        stem: stemMatch[1].trim(),
        options,
        correctAnswer: answerMatch[1] as "A" | "B" | "C" | "D",
        explanation: explanationMatch ? explanationMatch[1].trim() : "",
        document: documentMatch ? documentMatch[1].trim() : "unknown",
      };

      questions.push(parsedQuestion);
      console.log(`Parsed question ${i}: ${parsedQuestion.id} (${parsedQuestion.sectionCode})`);
    } catch (error) {
      console.error(`Error parsing question block ${i}:`, error);
    }
  }

  return questions;
}

function parseOptions(optionsText: string): Array<{ key: "A" | "B" | "C" | "D"; text: string }> {
  const options: Array<{ key: "A" | "B" | "C" | "D"; text: string }> = [];

  const optionPattern = /([A-D])\)\s*(.+?)(?=\n\s*[A-D]\)|$)/gs;
  let match: RegExpExecArray | null;

  while ((match = optionPattern.exec(optionsText)) !== null) {
    const key = match[1] as "A" | "B" | "C" | "D";
    let text = match[2].trim();

    if (text.startsWith("See original document")) {
      text = `Option ${key}`;
    }

    options.push({ key, text });
  }

  if (options.length < 4) {
    const keys: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
    const existingKeys = new Set(options.map((o) => o.key));
    for (const key of keys) {
      if (!existingKeys.has(key)) {
        options.push({ key, text: `Option ${key}` });
      }
    }
    options.sort((a, b) => a.key.localeCompare(b.key));
  }

  return options;
}

async function importQuestions() {
  console.log("Starting canonical question import from approved_questions_log...\n");

  const filePath = path.join(process.cwd(), "attached_assets/approved_questions_log_1764141098485.md");

  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const parsedQuestions = parseMarkdownQuestions(content);

  if (parsedQuestions.length === 0) {
    console.error("No questions parsed from file");
    process.exit(1);
  }

  const supabase = getSupabaseAdmin();

  let inserted = 0;
  let skipped = 0;

  for (const q of parsedQuestions) {
    try {
      const canonicalId = `SAT${q.sectionCode === "MATH" ? "M" : "RW"}2${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      const optionMetadata = q.options.map((opt) => ({
        key: opt.key,
        text: opt.text,
        is_correct: opt.key === q.correctAnswer,
      }));

      const { error } = await supabase
        .from("questions")
        .insert({
          id: randomUUID(),
          canonical_id: canonicalId,
          status: "reviewed",
          section: q.section,
          section_code: q.sectionCode,
          question_type: "multiple_choice",
          stem: q.stem,
          options: q.options,
          correct_answer: q.correctAnswer,
          answer_text: q.options.find((o) => o.key === q.correctAnswer)?.text ?? null,
          explanation: q.explanation,
          option_metadata: optionMetadata,
          domain: "Imported",
          skill: "Imported Skill",
          subskill: q.document,
          skill_code: "IMPORTED.GENERAL",
          difficulty: q.difficulty,
          source_type: "unknown",
          test_code: "SAT",
          exam: "SAT",
          ai_generated: false,
          tags: [],
          competencies: [],
          provenance_chunk_ids: [],
          diagram_present: null,
        });

      if (error) {
        if (error.code === "23505") {
          console.log(`Skipped duplicate for parsed id ${q.id}`);
          skipped++;
        } else {
          console.error(`Insert error for parsed id ${q.id}:`, error.message);
          skipped++;
        }
        continue;
      }

      inserted++;
      console.log(`Inserted: ${q.sectionCode} - ${q.stem.substring(0, 50)}...`);
    } catch (error: any) {
      console.error(`Unexpected insert error for parsed id ${q.id}:`, error?.message || error);
      skipped++;
    }
  }

  console.log("\nImport summary:");
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${parsedQuestions.length}`);

  process.exit(0);
}

importQuestions().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
