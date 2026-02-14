import type { V4JobRequest, GeneratedQuestionDraft, QaResult, PdfStyleRef } from "../types";
import { GeneratedQuestionDraftSchema, QaResultSchema } from "../types/schemas";
import { generateJsonWithAttachments, isV4GeminiEnabled, PdfAttachment } from "./gemini";
import { downloadPdfFromStorage, downloadImageFromStorage } from "./styleBankService";
import { getRenderedPagesForPdf } from "./v4PageRenderer";
import { getV4Config } from "./v4Config";
import type { StylePageRecord } from "./stylePageSampler";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, "../prompts");

function loadPromptTemplate(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), "utf-8");
}

function formatStyleRefsForPrompt(styleRefs: PdfStyleRef[], attachedCount: number): string {
  const lines = styleRefs.map((ref, i) => {
    const pageInfo = ref.pageHint ? ` (page ${ref.pageHint})` : "";
    const attached = i < attachedCount ? " [PDF ATTACHED]" : "";
    return `[Style Reference ${i + 1}]: bucket="${ref.bucket}", path="${ref.path}"${pageInfo}${attached}`;
  });
  return lines.join("\n");
}

async function fetchStyleAttachments(
  styleRefs: PdfStyleRef[]
): Promise<{ attachments: PdfAttachment[]; attachedCount: number; usedPages: boolean }> {
  const config = getV4Config();
  const maxBytes = config.styleMaxBytesTotal;
  const attachments: PdfAttachment[] = [];
  let totalBytes = 0;
  let attachedCount = 0;
  let usedPages = false;

  for (const ref of styleRefs) {
    try {
      const renderedPages = await getRenderedPagesForPdf(ref.bucket, ref.path);
      
      if (renderedPages.length > 0) {
        usedPages = true;
        const pagesToUse = ref.pageHint 
          ? renderedPages.filter(p => p.pageNumber === ref.pageHint)
          : renderedPages.slice(0, 3);

        for (const page of pagesToUse) {
          const imageResult = await downloadImageFromStorage(ref.bucket, page.imagePath);
          if (!imageResult) continue;

          if (totalBytes + imageResult.sizeBytes > maxBytes) {
            console.log(`[V4] Skipping page image ${page.imagePath} (would exceed ${maxBytes} bytes limit)`);
            continue;
          }

          attachments.push({
            mimeType: "image/png",
            data: imageResult.data,
            name: page.imagePath.split("/").pop() || "page.png"
          });
          totalBytes += imageResult.sizeBytes;
          attachedCount++;
        }
      } else {
        const result = await downloadPdfFromStorage(ref.bucket, ref.path);
        if (!result) continue;

        if (totalBytes + result.sizeBytes > maxBytes) {
          console.log(`[V4] Skipping PDF ${ref.path} (would exceed ${maxBytes} bytes limit)`);
          continue;
        }

        attachments.push({
          mimeType: "application/pdf",
          data: result.data,
          name: ref.path.split("/").pop() || "style.pdf"
        });
        totalBytes += result.sizeBytes;
        attachedCount++;
      }
    } catch (err: any) {
      console.warn(`[V4] Failed to fetch style attachment ${ref.path}:`, err.message);
    }
  }

  console.log(`[V4] Attached ${attachedCount} files (${totalBytes} bytes, usedPages=${usedPages})`);
  return { attachments, attachedCount, usedPages };
}

async function fetchStylePageAttachments(
  stylePages: StylePageRecord[]
): Promise<{ attachments: PdfAttachment[]; attachedCount: number }> {
  const config = getV4Config();
  const maxBytes = config.styleMaxBytesTotal;
  const attachments: PdfAttachment[] = [];
  let totalBytes = 0;
  let attachedCount = 0;

  for (const page of stylePages) {
    try {
      const imageResult = await downloadImageFromStorage(page.bucket, page.image_path);
      if (!imageResult) continue;

      if (totalBytes + imageResult.sizeBytes > maxBytes) {
        console.log(`[V4] Skipping page image ${page.image_path} (would exceed ${maxBytes} bytes limit)`);
        continue;
      }

      attachments.push({
        mimeType: "image/png",
        data: imageResult.data,
        name: page.image_path.split("/").pop() || `page_${page.page_number}.png`
      });
      totalBytes += imageResult.sizeBytes;
      attachedCount++;
    } catch (err: any) {
      console.warn(`[V4] Failed to fetch style page ${page.image_path}:`, err.message);
    }
  }

  console.log(`[V4] Attached ${attachedCount} PNG style pages (${totalBytes} bytes)`);
  return { attachments, attachedCount };
}

function formatStylePagesForPrompt(stylePages: StylePageRecord[]): string {
  return stylePages.map((page, i) => {
    const domain = page.domain || "unknown";
    const difficulty = page.difficulty || "unknown";
    return `[Style Page ${i + 1}]: ${page.pdf_path} page ${page.page_number} (domain=${domain}, difficulty=${difficulty}) [PNG ATTACHED]`;
  }).join("\n");
}

export function parseTeacherDraft(raw: unknown): GeneratedQuestionDraft {
  return GeneratedQuestionDraftSchema.parse(raw) as GeneratedQuestionDraft;
}

export function parseQaResult(raw: unknown): QaResult {
  return QaResultSchema.parse(raw) as QaResult;
}

export async function generateDraftWithTeacher(
  req: V4JobRequest,
  styleRefsOverride?: PdfStyleRef[]
): Promise<GeneratedQuestionDraft> {
  if (!isV4GeminiEnabled()) {
    throw new Error("V4 Gemini disabled");
  }

  const styleRefs = styleRefsOverride || req.styleRefs || [];
  const { attachments, attachedCount, usedPages } = await fetchStyleAttachments(styleRefs);
  
  const teacherTemplate = loadPromptTemplate("teacher.md");
  const styleContext = formatStyleRefsForPrompt(styleRefs, attachedCount);
  const uniqueId = `draft-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const attachmentNote = attachedCount > 0 
    ? usedPages
      ? `\n\nNote: ${attachedCount} style page image(s) are attached as style anchors. Study their format, tone, and structure, but do NOT copy any content from them.`
      : `\n\nNote: ${attachedCount} style PDF(s) are attached. Study their format, tone, and structure, but do NOT copy any content from them.`
    : "";

  const prompt = `${teacherTemplate}

## Style References (for tone/structure reference ONLY - do NOT copy content)
${styleContext}${attachmentNote}

## Instructions
- Test type: ${req.testCode}
- Generate exactly ONE original question draft
- Use draftId: "${uniqueId}"
- The question must be COMPLETELY ORIGINAL - not copied, paraphrased, or closely based on any existing question
- Vary the skill/topic to ensure diversity across generation runs
- You may receive page images as style anchors.

Return ONLY the JSON object, no markdown.`;

  const draft = await generateJsonWithAttachments(
    prompt,
    GeneratedQuestionDraftSchema,
    attachments
  ) as GeneratedQuestionDraft;

  if (draft.draftId !== uniqueId) {
    return { ...draft, draftId: uniqueId } as GeneratedQuestionDraft;
  }

  return draft;
}

export async function qaDraftWithTa(draft: GeneratedQuestionDraft, stylePages?: StylePageRecord[]): Promise<QaResult> {
  if (!isV4GeminiEnabled()) {
    throw new Error("V4 Gemini disabled");
  }

  const qaTemplate = loadPromptTemplate("qa.md");
  
  let attachments: PdfAttachment[] = [];
  let styleContext = "";
  
  if (stylePages && stylePages.length > 0) {
    const { attachments: pageAttachments } = await fetchStylePageAttachments(stylePages);
    attachments = pageAttachments;
    styleContext = `
## Style Reference Pages (same pages shown to Teacher)
${formatStylePagesForPrompt(stylePages)}
Note: ${attachments.length} style page image(s) are attached. Use them to verify style consistency.
`;
  }

  const prompt = `${qaTemplate}
${styleContext}
## Question Draft to Review
${JSON.stringify(draft, null, 2)}

Solve the question step-by-step, verify the correctAnswer, assess copyRisk (low/medium/high), styleMatch (good/ok/poor), and difficultyMatch (match/mismatch/unknown).
Return ONLY the JSON result with fields: ok, foundCorrectAnswer, issues, copyRisk, styleMatch, difficultyMatch.`;

  return generateJsonWithAttachments(prompt, QaResultSchema, attachments) as Promise<QaResult>;
}

export async function generateDraftWithStylePages(
  req: V4JobRequest,
  stylePages: StylePageRecord[]
): Promise<GeneratedQuestionDraft> {
  if (!isV4GeminiEnabled()) {
    throw new Error("V4 Gemini disabled");
  }

  const { attachments, attachedCount } = await fetchStylePageAttachments(stylePages);
  
  const teacherTemplate = loadPromptTemplate("teacher.md");
  const styleContext = formatStylePagesForPrompt(stylePages);
  const uniqueId = `draft-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const attachmentNote = attachedCount > 0 
    ? `\n\nNote: ${attachedCount} style page image(s) are attached as style anchors. Study their format, tone, and structure, but do NOT copy any content from them.`
    : "";

  const prompt = `${teacherTemplate}

## Style Reference Pages (for tone/structure reference ONLY - do NOT copy content)
${styleContext}${attachmentNote}

## Instructions
- Test type: ${req.testCode}
- Generate exactly ONE original question draft
- Use draftId: "${uniqueId}"
- The question must be COMPLETELY ORIGINAL - not copied, paraphrased, or closely based on any existing question
- Vary the skill/topic to ensure diversity across generation runs
- You may receive page images as style anchors.

Return ONLY the JSON object, no markdown.`;

  const draft = await generateJsonWithAttachments(
    prompt,
    GeneratedQuestionDraftSchema,
    attachments
  ) as GeneratedQuestionDraft;

  if (draft.draftId !== uniqueId) {
    return { ...draft, draftId: uniqueId } as GeneratedQuestionDraft;
  }

  return draft;
}

export async function reconcileAndPersist(_draft: GeneratedQuestionDraft, _qa: QaResult): Promise<void> {
  // Milestone 4: Persistence is handled by the run-once endpoint directly to ingestion_v4_drafts
  // This function is a placeholder for future Milestone 5 logic (writing to public.questions)
  throw new Error("Not implemented: reconcileAndPersist is handled by run-once endpoint in Milestone 4");
}
