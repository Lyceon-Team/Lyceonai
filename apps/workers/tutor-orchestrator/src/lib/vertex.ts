import { VertexAI } from "@google-cloud/vertexai";
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
    generationConfig: {
        maxOutputTokens: 600,
        temperature: 0.2,
        topP: 0.9,
        responseMimeType: "application/json",
    },
});

function buildPrompt(input: OrchestrateRequest): string {
    const recentMessages = input.recent_messages
        .map((m) => `${m.role.toUpperCase()} [${m.content_kind}]: ${m.message}`)
        .join("\n");

    const prompt = {
        task: "Generate a bounded tutor response for Lyceon.",
        rules: [
            "You are an SAT tutor.",
            "Do not reveal answers unless the server/runtime context already allows it.",
            "Do not output hidden reasoning or internal metadata.",
            "Return only JSON matching the requested response shape.",
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
        required_response_shape: {
            response: {
                content: "string",
                content_kind: "message",
                suggested_action: {
                    type: [
                        "none",
                        "offer_similar_question",
                        "offer_broader_coaching",
                        "offer_stay_focused",
                    ],
                    label: "string|null",
                },
                ui_hints: {
                    show_accept_decline: "boolean",
                    allow_freeform_reply: "boolean",
                    suggested_chip: "string|null",
                },
            },
            question_links: [
                {
                    source_question_row_id: "uuid|null",
                    source_question_canonical_id: "string",
                    related_question_row_id: "uuid|null",
                    related_question_canonical_id: "string",
                    relationship_type: [
                        "current",
                        "similar_retry",
                        "simpler_variant",
                        "harder_variant",
                        "concept_extension",
                    ],
                    difficulty_delta: "integer|null",
                    reason_code: "string",
                    link_snapshot: "object",
                },
            ],
            instruction_exposures: [
                {
                    exposure_type: [
                        "hint",
                        "explanation",
                        "strategy",
                        "similar_question_offer",
                        "broader_coaching_offer",
                        "consent_prompt",
                    ],
                    content_variant_key: "string|null",
                    content_version: "string|null",
                    rendered_difficulty: "integer|null",
                    hint_depth: "integer|null",
                    tone_style: "string|null",
                    sequence_ordinal: "integer",
                },
            ],
            orchestration_meta: {
                model_name: "string",
                cache_used: "boolean",
                compaction_recommended: "boolean",
            },
        },
    };

    return JSON.stringify(prompt, null, 2);
}

export async function generateTutorResponse(
    input: OrchestrateRequest,
): Promise<OrchestrateResponse> {
    const maxOutputTokens = input.runtime_limits.max_output_tokens;
    const prompt = buildPrompt(input);

    const result = await generativeModel.generateContent({
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            maxOutputTokens: maxOutputTokens,
            temperature: 0.2,
            topP: 0.9,
            responseMimeType: "application/json",
        },
    });

    const text =
        result.response.candidates?.[0]?.content?.parts?.[0] &&
            "text" in result.response.candidates[0].content.parts[0]
            ? result.response.candidates[0].content.parts[0].text
            : "";

    if (!text) {
        throw new Error("Vertex returned an empty response");
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(text);
    } catch {
        throw new Error("Vertex returned non-JSON output");
    }

    const validated = orchestrateResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
        throw new Error("Vertex returned invalid orchestrator response shape");
    }

    return validated.data;
}