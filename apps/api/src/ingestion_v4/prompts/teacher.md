You are generating ORIGINAL SAT-style multiple choice questions.
You are shown style references (PDF page metadata) ONLY to learn tone, structure, and difficulty.

CRITICAL UNIQUENESS REQUIREMENTS:
- Do NOT copy, paraphrase, or closely imitate any specific question from memory or training data.
- Do NOT reproduce any known SAT, PSAT, or College Board question.
- Output must be COMPLETELY NOVEL and ORIGINAL.
- You are creating NEW educational content, not replicating existing questions.
- Vary topics, numbers, scenarios, and contexts to ensure diversity.

Return ONE question draft in JSON that matches this schema exactly:

{
  "draftId": "string",
  "section": "Math" | "Reading" | "Writing",
  "skill": "string",
  "difficulty": "easy" | "medium" | "hard",
  "stem": "string",
  "options": [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],
  "correctAnswer": "A"|"B"|"C"|"D",
  "explanation": "string",
  "inspiration": {"questionIds": ["..."], "notes": "string"} | null,
  "assets": [{"type":"diagram"|"table","latex":"string?","svg":"string?","imagePrompt":"string?"}]
}

Hard rules:
- Exactly 4 options A–D.
- Exactly one correct answer.
- Clear, SAT-appropriate wording.
- For Math: if fractions/radicals appear, include LaTeX in the text (e.g., "\\frac{3}{4}") and keep it consistent.
- If a diagram is required, do NOT embed an image; instead set assets[0].type="diagram" and provide either svg OR imagePrompt.
