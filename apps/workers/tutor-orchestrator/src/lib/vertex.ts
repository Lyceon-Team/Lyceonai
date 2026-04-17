import {
    VertexAI,
    FunctionDeclarationSchemaType,
} from "@google-cloud/vertexai";
import type { OrchestrateRequest, OrchestrateResponse } from "./schema.js";
import { orchestrateResponseSchema } from "./schema.js";

const project =
    process.env.GOOGLE_CLOUD_PROJECT ?? "replit-cop";
const location =
    process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
const modelName =
    process.env.VERTEX_MODEL ?? "gemini-2.5-flash";

const vertexAI = new VertexAI({ project, location });

const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
});

const MODEL_OUTPUT_PREVIEW_LIMIT = 240;
type GenerateContentFn = (request: Record<string, unknown>) => Promise<unknown>;
let generateContentImpl: GenerateContentFn = (request) =>
    generativeModel.generateContent(request as never) as Promise<unknown>;

export function setGenerateContentForTests(impl: GenerateContentFn | null): void {
    generateContentImpl = impl ?? ((request) =>
        generativeModel.generateContent(request as never) as Promise<unknown>);
}

export class OrchestratorTimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number) {
        super(`Vertex orchestration timed out after ${timeoutMs}ms`);
        this.name = "OrchestratorTimeoutError";
        this.timeoutMs = timeoutMs;
    }
}

export type ModelOutputErrorCode =
    | "MODEL_OUTPUT_INVALID"
    | "MODEL_OUTPUT_TRUNCATED"
    | "MODEL_OUTPUT_SCHEMA_MISMATCH";

export class ModelOutputError extends Error {
    readonly code: ModelOutputErrorCode;
    readonly preview: string;

    constructor(code: ModelOutputErrorCode, message: string, preview: string) {
        super(message);
        this.name = "ModelOutputError";
        this.code = code;
        this.preview = preview;
    }
}

function cleanJsonText(text: string): string {
    const trimmed = text.trim();

    if (trimmed.startsWith("```")) {
        return trimmed
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }

    return trimmed;
}

function buildPreview(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, MODEL_OUTPUT_PREVIEW_LIMIT);
}

function hasClearlyIncompleteJson(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return false;
    }

    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (const char of trimmed) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString) {
            if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "{" || char === "[") {
            stack.push(char);
            continue;
        }

        if (char === "}" || char === "]") {
            const open = stack.pop();
            if ((char === "}" && open !== "{") || (char === "]" && open !== "[")) {
                return false;
            }
        }
    }

    if (inString) {
        return true;
    }

    if (stack.length > 0) {
        return true;
    }

    return /[,:]$/.test(trimmed);
}

function extractCandidateText(result: unknown): { text: string; finishReason?: string } {
    const candidate =
        typeof result === "object" &&
            result !== null &&
            "response" in result &&
            typeof result.response === "object" &&
            result.response !== null &&
            "candidates" in result.response &&
            Array.isArray(result.response.candidates)
            ? result.response.candidates[0]
            : undefined;

    const finishReason =
        candidate &&
            typeof candidate === "object" &&
            "finishReason" in candidate &&
            typeof candidate.finishReason === "string"
            ? candidate.finishReason
            : undefined;

    const parts =
        candidate &&
            typeof candidate === "object" &&
            "content" in candidate &&
            typeof candidate.content === "object" &&
            candidate.content !== null &&
            "parts" in candidate.content &&
            Array.isArray(candidate.content.parts)
            ? candidate.content.parts
            : [];

    const text = parts
        .map((part: unknown) => {
            if (
                typeof part === "object" &&
                part !== null &&
                "text" in part &&
                typeof part.text === "string"
            ) {
                return part.text;
            }
            return "";
        })
        .join("")
        .trim();

    return { text, finishReason };
}

function logModelOutputFailure(
    error: ModelOutputError,
    extra: Record<string, unknown> = {},
): void {
    console.error("VERTEX_MODEL_OUTPUT_FAILURE", {
        code: error.code,
        message: error.message,
        preview: error.preview,
        ...extra,
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            reject(new OrchestratorTimeoutError(timeoutMs));
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timeoutHandle);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timeoutHandle);
                reject(error);
            });
    });
}

function getResponseSchema(): Record<string, unknown> {
    return {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
            response: {
                type: FunctionDeclarationSchemaType.OBJECT,
                properties: {
                    content: { type: FunctionDeclarationSchemaType.STRING },
                    content_kind: {
                        type: FunctionDeclarationSchemaType.STRING,
                        enum: ["message"],
                    },
                    suggested_action: {
                        type: FunctionDeclarationSchemaType.OBJECT,
                        properties: {
                            type: {
                                type: FunctionDeclarationSchemaType.STRING,
                                enum: [
                                    "none",
                                    "offer_similar_question",
                                    "offer_broader_coaching",
                                    "offer_stay_focused",
                                ],
                            },
                            label: {
                                type: FunctionDeclarationSchemaType.STRING,
                                nullable: true,
                            },
                        },
                        required: ["type", "label"],
                    },
                    ui_hints: {
                        type: FunctionDeclarationSchemaType.OBJECT,
                        properties: {
                            show_accept_decline: {
                                type: FunctionDeclarationSchemaType.BOOLEAN,
                            },
                            allow_freeform_reply: {
                                type: FunctionDeclarationSchemaType.BOOLEAN,
                            },
                            suggested_chip: {
                                type: FunctionDeclarationSchemaType.STRING,
                                nullable: true,
                            },
                        },
                        required: [
                            "show_accept_decline",
                            "allow_freeform_reply",
                            "suggested_chip",
                        ],
                    },
                },
                required: ["content", "content_kind", "suggested_action", "ui_hints"],
            },
            question_links: {
                type: FunctionDeclarationSchemaType.ARRAY,
                items: {
                    type: FunctionDeclarationSchemaType.OBJECT,
                    properties: {
                        source_question_row_id: {
                            type: FunctionDeclarationSchemaType.STRING,
                            nullable: true,
                        },
                        source_question_canonical_id: {
                            type: FunctionDeclarationSchemaType.STRING,
                        },
                        related_question_row_id: {
                            type: FunctionDeclarationSchemaType.STRING,
                            nullable: true,
                        },
                        related_question_canonical_id: {
                            type: FunctionDeclarationSchemaType.STRING,
                        },
                        relationship_type: {
                            type: FunctionDeclarationSchemaType.STRING,
                            enum: [
                                "current",
                                "similar_retry",
                                "simpler_variant",
                                "harder_variant",
                                "concept_extension",
                            ],
                        },
                        difficulty_delta: {
                            type: FunctionDeclarationSchemaType.INTEGER,
                            nullable: true,
                        },
                        reason_code: { type: FunctionDeclarationSchemaType.STRING },
                        link_snapshot: { type: FunctionDeclarationSchemaType.OBJECT },
                    },
                    required: [
                        "source_question_row_id",
                        "source_question_canonical_id",
                        "related_question_row_id",
                        "related_question_canonical_id",
                        "relationship_type",
                        "difficulty_delta",
                        "reason_code",
                        "link_snapshot",
                    ],
                },
            },
            instruction_exposures: {
                type: FunctionDeclarationSchemaType.ARRAY,
                items: {
                    type: FunctionDeclarationSchemaType.OBJECT,
                    properties: {
                        exposure_type: {
                            type: FunctionDeclarationSchemaType.STRING,
                            enum: [
                                "hint",
                                "explanation",
                                "strategy",
                                "similar_question_offer",
                                "broader_coaching_offer",
                                "consent_prompt",
                            ],
                        },
                        content_variant_key: {
                            type: FunctionDeclarationSchemaType.STRING,
                            nullable: true,
                        },
                        content_version: {
                            type: FunctionDeclarationSchemaType.STRING,
                            nullable: true,
                        },
                        rendered_difficulty: {
                            type: FunctionDeclarationSchemaType.INTEGER,
                            nullable: true,
                        },
                        hint_depth: {
                            type: FunctionDeclarationSchemaType.INTEGER,
                            nullable: true,
                        },
                        tone_style: {
                            type: FunctionDeclarationSchemaType.STRING,
                            nullable: true,
                        },
                        sequence_ordinal: {
                            type: FunctionDeclarationSchemaType.INTEGER,
                        },
                    },
                    required: [
                        "exposure_type",
                        "content_variant_key",
                        "content_version",
                        "rendered_difficulty",
                        "hint_depth",
                        "tone_style",
                        "sequence_ordinal",
                    ],
                },
            },
            orchestration_meta: {
                type: FunctionDeclarationSchemaType.OBJECT,
                properties: {
                    model_name: { type: FunctionDeclarationSchemaType.STRING },
                    cache_used: { type: FunctionDeclarationSchemaType.BOOLEAN },
                    compaction_recommended: {
                        type: FunctionDeclarationSchemaType.BOOLEAN,
                    },
                },
                required: ["model_name", "cache_used", "compaction_recommended"],
            },
        },
        required: [
            "response",
            "question_links",
            "instruction_exposures",
            "orchestration_meta",
        ],
    };
}

function buildPrompt(input: OrchestrateRequest): string {
    const recentMessages = input.recent_messages
        .map((m) => `${m.role.toUpperCase()} [${m.content_kind}]: ${m.message}`)
        .join("\n");

    const prompt = {
        task: "Generate a bounded tutor response for Lyceon.",
        rules: [
            "You are an SAT tutor.",
            "Do not reveal answers unless the provided context already allows it.",
            "Do not output hidden reasoning, internal metadata, or markdown code fences.",
            "Return only JSON that matches the response schema.",
            "Keep content concise, helpful, and student-safe.",
        ],
        input: {
            entry_mode: input.entry_mode,
            source_surface: input.source_surface,
            resolved_scope: input.resolved_scope,
            recent_messages: recentMessages,
            memory_summaries: input.memory_summaries,
            student_context: input.student_context,
            policy_assignment: input.policy_assignment,
            runtime_limits: input.runtime_limits,
        },
    };

    return JSON.stringify(prompt, null, 2);
}
export async function generateTutorResponse(
    input: OrchestrateRequest,
): Promise<OrchestrateResponse> {
    const maxOutputTokens = input.runtime_limits.max_output_tokens;
    const prompt = buildPrompt(input);

    const result = await withTimeout(
        generateContentImpl({
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }],
                },
            ],
            generationConfig: {
                maxOutputTokens: maxOutputTokens,
                temperature: 0,
                topP: 1,
                candidateCount: 1,
                responseMimeType: "application/json",
                responseSchema: getResponseSchema(),
            },
        }),
        input.runtime_limits.timeout_ms,
    );

    const { text, finishReason } = extractCandidateText(result);
    const cleanedText = cleanJsonText(text);
    const preview = buildPreview(cleanedText);

    if (!text) {
        const error = new ModelOutputError(
            "MODEL_OUTPUT_INVALID",
            "Vertex returned an empty response",
            preview,
        );
        logModelOutputFailure(error, { finish_reason: finishReason });
        throw error;
    }

    if (hasClearlyIncompleteJson(cleanedText)) {
        const error = new ModelOutputError(
            "MODEL_OUTPUT_TRUNCATED",
            "Vertex returned truncated JSON output",
            preview,
        );
        logModelOutputFailure(error, { finish_reason: finishReason });
        throw error;
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(cleanedText);
    } catch {
        const parseFailedAsTruncated =
            finishReason === "MAX_TOKENS" || hasClearlyIncompleteJson(cleanedText);
        const error = new ModelOutputError(
            parseFailedAsTruncated ? "MODEL_OUTPUT_TRUNCATED" : "MODEL_OUTPUT_INVALID",
            parseFailedAsTruncated
                ? "Vertex returned truncated JSON output"
                : "Vertex returned non-JSON output",
            preview,
        );
        logModelOutputFailure(error, { finish_reason: finishReason });
        throw error;
    }

    const validated = orchestrateResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
        const error = new ModelOutputError(
            "MODEL_OUTPUT_SCHEMA_MISMATCH",
            "Vertex returned invalid orchestrator response shape",
            preview,
        );
        logModelOutputFailure(error, {
            finish_reason: finishReason,
            issues: validated.error.issues.slice(0, 3).map((issue) => ({
                path: issue.path,
                message: issue.message,
            })),
        });
        throw error;
    }

    return validated.data;
}
