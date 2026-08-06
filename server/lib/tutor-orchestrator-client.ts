/**
 * @spec [Doc-03B_V2 §4.1] | @implemented 2026-08-05
 * plain English: BFF client for the tutor orchestrator worker. Sends the orchestrate
 * request, validates the response against the canonical wire schema from shared/.
 * expected outcome: type-safe orchestrator calls; invalid response shapes throw.
 * trade-offs: none — schema collapsed into shared/tutor-orchestrator-wire.ts (L1.4).
 */
import { GoogleAuth } from "google-auth-library";
import {
  orchestrateResponseSchema,
  type OrchestrateResponse,
} from "../../shared/tutor-orchestrator-wire";

export type TutorOrchestratorResponse = OrchestrateResponse;

type OrchestratorAuthMode = "none" | "gcp_id_token";

function resolveOrchestratorAuthMode(): OrchestratorAuthMode {
  const raw = (process.env.TUTOR_ORCHESTRATOR_AUTH_MODE ?? "none")
    .trim()
    .toLowerCase();
  if (!raw || raw === "none" || raw === "local") return "none";
  if (raw === "gcp_id_token" || raw === "id_token") return "gcp_id_token";
  throw new Error(`Unsupported tutor orchestrator auth mode: ${raw}`);
}

async function resolveServiceAuthHeader(
  baseUrl: string,
): Promise<string | null> {
  const authMode = resolveOrchestratorAuthMode();
  if (authMode === "none") return null;

  const audience =
    (process.env.TUTOR_ORCHESTRATOR_AUDIENCE ?? "").trim() || baseUrl;
  const auth = new GoogleAuth();
  const idTokenClient = await auth.getIdTokenClient(audience);
  const headerBag = await idTokenClient.getRequestHeaders(baseUrl);
  const authHeader =
    headerBag.get("authorization") ?? headerBag.get("Authorization");
  if (!authHeader || authHeader.trim().length === 0) {
    throw new Error(
      "Failed to acquire service auth header for tutor orchestrator",
    );
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

  const headers = new Headers({
    "Content-Type": "application/json",
  });
  const serviceAuthHeader = await resolveServiceAuthHeader(baseUrl);
  if (serviceAuthHeader) {
    headers.set("Authorization", serviceAuthHeader);
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

  const parsed = orchestrateResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Tutor orchestrator returned invalid response shape: ${JSON.stringify(
        parsed.error.flatten(),
      )}`,
    );
  }

  return parsed.data;
}
