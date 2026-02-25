import { Request, Response, RequestHandler } from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY - required for vision analysis");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an image (JPG, PNG, WebP, GIF) or PDF.'));
    }
  }
});

const SAT_TUTOR_PROMPT = `You are an expert SAT tutor. A student has uploaded an image of a question they need help with.

Your task:
1. First, identify and extract the question from the image
2. Determine if it's a Math or Reading/Writing question
3. Provide a clear, step-by-step explanation of how to approach and solve the question
4. If it's multiple choice, explain why the correct answer is right and briefly why other options might be wrong
5. Share any relevant SAT test-taking strategies

Guidelines:
- Be encouraging and supportive
- Use simple, clear language
- If the image is unclear or you can't identify a question, politely ask for a clearer image
- Focus on teaching the concept, not just giving the answer
- Include the key formula or rule being tested, if applicable

Format your response in a structured way with clear sections.`;

export const analyzeQuestion: RequestHandler[] = [
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({
          error: 'No file uploaded',
          message: 'Please upload an image or PDF of your SAT question.'
        });
        return;
      }

      const additionalContext = req.body.context || '';

      const client = getGeminiClient();

      const base64Data = file.buffer.toString('base64');
      const mimeType = file.mimetype;

      const response = await client.models.generateContent({
        model: "gemini-2.0-flash",
        config: {
          systemInstruction: SAT_TUTOR_PROMPT,
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              },
              ...(additionalContext ? [{ text: `Student's additional context/question: "${additionalContext}"` }] : [])
            ]
          }
        ],
      });

      const responseText = response.text || "I couldn't analyze the image. Please try uploading a clearer photo of your question.";

      const extractedQuestion = extractQuestionFromResponse(responseText);

      res.json({
        success: true,
        response: responseText,
        extractedQuestion: extractedQuestion,
        fileType: mimeType.startsWith('image/') ? 'image' : 'pdf',
        provider: 'gemini'
      });
    } catch (error) {
      console.error('[Student Route] Question analysis error:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('Invalid file type')) {
        res.status(400).json({
          error: 'Invalid file type',
          message: errorMessage
        });
        return;
      }

      res.status(500).json({
        error: 'Analysis failed',
        message: 'Failed to analyze your question. Please try again with a clearer image.'
      });
    }
  }
];

function extractQuestionFromResponse(text: string): string {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().includes('question:') ||
      line.toLowerCase().includes('the question asks') ||
      line.toLowerCase().includes('the question is')) {
      return line.replace(/^.*?(question:?\s*)/i, '').trim().substring(0, 200);
    }
  }
  return 'Uploaded question';
}
