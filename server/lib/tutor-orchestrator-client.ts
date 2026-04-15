import { z } from "zod";
import { GoogleAuth } from "google-auth-library";

const orchestratorResponseSchema = z.object({
    response: z.object({
        content: z.string(),
        content_kind: z.literal("message"),
        suggested_action: z.object({
            type: z.enum([
                "none",
                "offer_similar_question",
                "offer_broader_coaching",
                "offer_stay_focused",
            ]),
            label: z.string().nullable(),
        }),
        ui_hints: z.object({
            show_accept_decline: z.boolean(),
            allow_freeform_reply: z.boolean(),
            suggested_chip: z.string().nullable(),
        }),
    }),
    question_links: z.array(
        z.object({
            source_question_row_id: z.string().uuid().nullable(),
            source_question_canonical_id: z.string(),
            related_question_row_id: z.string().uuid().nullable(),
            related_question_canonical_id: z.string(),
            relationship_type: z.enum([
                "current",
                "similar_retry",
                "simpler_variant",
                "harder_variant",
                "concept_extension",
            ]),
            difficulty_delta: z.number().int().nullable(),
            reason_code: z.string(),
            link_snapshot: z.record(z.string(), z.unknown()),
        }),
    ),
    instruction_exposures: z.array(
        z.object({
            exposure_type: z.enum([
                "hint",
                "explanation",
                "strategy",
                "similar_question_offer",
                "broader_coaching_offer",
                "consent_prompt",
            ]),
            content_variant_key: z.string().nullable(),
            content_version: z.string().nullable(),
            rendered_difficulty: z.number().int().nullable(),
            hint_depth: z.number().int().nullable(),
            tone_style: z.string().nullable(),
            sequence_ordinal: z.number().int().nonnegative(),
        }),
    ),
    orchestration_meta: z.object({
        model_name: z.string(),
        cache_used: z.boolean(),
        compaction_recommended: z.boolean(),
    }),
});

export type TutorOrchestratorResponse = z.infer<
    typeof orchestratorResponseSchema
>;

type OrchestratorAuthMode = "none" | "gcp_id_token";

function resolveOrchestratorAuthMode(): OrchestratorAuthMode {
    const raw = (process.env.TUTOR_ORCHESTRATOR_AUTH_MODE ?? "none").trim().toLowerCase();
    if (!raw || raw === "none" || raw === "local") return "none";
    if (raw === "gcp_id_token" || raw === "id_token") return "gcp_id_token";
    throw new Error(`Unsupported tutor orchestrator auth mode: ${raw}`);
}

async function resolveServiceAuthHeader(baseUrl: string): Promise<string | null> {
    const authMode = resolveOrchestratorAuthMode();
    if (authMode === "none") return null;

    const audience = (process.env.TUTOR_ORCHESTRATOR_AUDIENCE ?? "").trim() || baseUrl;
    const auth = new GoogleAuth();
    const idTokenClient = await auth.getIdTokenClient(audience);
    const headerBag = await idTokenClient.getRequestHeaders(baseUrl);
    const authHeader = (headerBag as Record<string, string | undefined>).Authorization
        ?? (headerBag as Record<string, string | undefined>).authorization;
    if (!authHeader || authHeader.trim().length === 0) {
        throw new Error("Failed to acquire service auth header for tutor orchestrator");
    }
    return authHeader;
}

export async function callTutorOrchestrator(
    payload: unknown,
): Promise<TutorOrchestratorResponse> {
    const baseUrl = process.env.TUTOR_ORCHESTRATOR_URL;
    if (!baseUrl) {
        throw new Error("TUTOR_ORCHESTRATOR_URL is not configured");
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    const serviceAuthHeader = await resolveServiceAuthHeader(baseUrl);
    if (serviceAuthHeader) {
        headers.Authorization = serviceAuthHeader;
    }

    const response = await fetch(`${baseUrl}/orchestrate`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            `Tutor orchestrator request failed with status ${response.status}: ${JSON.stringify(json)}`,
        );
    }

    const parsed = orchestratorResponseSchema.safeParse(json);
    if (!parsed.success) {
        throw new Error(
            `Tutor orchestrator returned invalid response shape: ${JSON.stringify(
                parsed.error.flatten(),
            )}`,
        );
    }

    return parsed.data;
}
