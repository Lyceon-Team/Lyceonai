import { getDb } from "../apps/api/src/db/client";
import { questions } from "../shared/schema";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

interface ParsedQuestion {
  id: string;
  section: string;
  difficulty: string;
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
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
      const sectionMatch = block.match(/Section:\s*(Math|Reading|Writing)/i);
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
      
      const optionsText = optionsMatch ? optionsMatch[1].trim() : "";
      const options = parseOptions(optionsText);
      
      const parsedQuestion: ParsedQuestion = {
        id: idMatch[1].trim(),
        section: sectionMatch[1],
        difficulty: difficultyMatch[1],
        stem: stemMatch[1].trim(),
        options: options,
        answer: answerMatch[1],
        explanation: explanationMatch ? explanationMatch[1].trim() : "",
        document: documentMatch ? documentMatch[1].trim() : "unknown"
      };
      
      questions.push(parsedQuestion);
      console.log(`Parsed question ${i}: ${parsedQuestion.id} (${parsedQuestion.section})`);
    } catch (error) {
      console.error(`Error parsing question block ${i}:`, error);
    }
  }
  
  return questions;
}

function parseOptions(optionsText: string): { key: string; text: string }[] {
  const options: { key: string; text: string }[] = [];
  
  const optionPattern = /([A-D])\)\s*(.+?)(?=\n\s*[A-D]\)|$)/gs;
  let match;
  
  while ((match = optionPattern.exec(optionsText)) !== null) {
    const key = match[1];
    let text = match[2].trim();
    
    if (text === "See original document for option A" ||
        text === "See original document for option B" ||
        text === "See original document for option C" ||
        text === "See original document for option D" ||
        text.startsWith("See original document")) {
      text = `Option ${key}`;
    }
    
    options.push({ key, text });
  }
  
  if (options.length < 4) {
    const keys = ['A', 'B', 'C', 'D'];
    const existingKeys = options.map(o => o.key);
    for (const key of keys) {
      if (!existingKeys.includes(key)) {
        options.push({ key, text: `Option ${key}` });
      }
    }
    options.sort((a, b) => a.key.localeCompare(b.key));
  }
  
  return options;
}

async function importQuestions() {
  console.log("📚 Starting question import from approved_questions_log...\n");
  
  const filePath = path.join(process.cwd(), "attached_assets/approved_questions_log_1764141098485.md");
  
  if (!fs.existsSync(filePath)) {
    console.error("❌ File not found:", filePath);
    process.exit(1);
  }
  
  const content = fs.readFileSync(filePath, "utf-8");
  console.log(`📖 Read file: ${content.length} characters\n`);
  
  const parsedQuestions = parseMarkdownQuestions(content);
  console.log(`\n✅ Parsed ${parsedQuestions.length} questions\n`);
  
  if (parsedQuestions.length === 0) {
    console.error("❌ No questions parsed from file");
    process.exit(1);
  }
  
  let inserted = 0;
  let skipped = 0;
  
  const db = getDb();
  
  for (const q of parsedQuestions) {
    try {
      await db.insert(questions).values({
        id: randomUUID(),
        section: q.section,
        stem: q.stem,
        questionType: "multiple_choice",
        options: q.options,
        answer: q.answer,
        answerChoice: q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        confidence: 1.0,
        needsReview: false,
        aiGenerated: false,
        sourceMapping: {
          qualityValidated: true,
          importedFrom: "approved_questions_log",
          originalId: q.id,
          document: q.document
        }
      });
      inserted++;
      console.log(`✓ Inserted: ${q.section} - ${q.stem.substring(0, 50)}...`);
    } catch (error: any) {
      if (error.code === '23505') {
        console.log(`⏭ Skipped duplicate: ${q.id}`);
        skipped++;
      } else {
        console.error(`❌ Error inserting question ${q.id}:`, error.message);
        skipped++;
      }
    }
  }
  
  console.log(`\n📊 Import Summary:`);
  console.log(`   ✅ Inserted: ${inserted}`);
  console.log(`   ⏭ Skipped: ${skipped}`);
  console.log(`   📝 Total: ${parsedQuestions.length}`);
  
  process.exit(0);
}

importQuestions().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
