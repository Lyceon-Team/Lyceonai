import {
  TutorAppendMessageRequestSchema,
  TutorAppendMessageResponseSchema,
  TutorErrorResponseSchema,
  TutorFetchConversationResponseSchema,
  TutorRateLimitResponseSchema,
  TutorRecoverableRetryErrorSchema,
  TutorStartConversationRequestSchema,
  TutorStartConversationResponseSchema,
} from "@shared/tutor-contract";
import { z } from "zod";
import { apiRequestRaw } from "@/lib/queryClient";

export type TutorStartConversationRequest = z.input<typeof TutorStartConversationRequestSchema>;
export type TutorAppendMessageRequest = z.input<typeof TutorAppendMessageRequestSchema>;
export type TutorStartConversationResponse = z.output<typeof TutorStartConversationResponseSchema>;
export type TutorFetchConversationResponse = z.output<typeof TutorFetchConversationResponseSchema>;
export type TutorAppendMessageResponse = z.output<typeof TutorAppendMessageResponseSchema>;

export class TutorClientRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    requestId?: string | null;
  }) {
    super(args.message);
    this.name = "TutorClientRequestError";
    this.status = args.status;
    this.code = args.code;
    this.retryable = Boolean(args.retryable);
    this.requestId = args.requestId ?? null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseTutorError(status: number, payload: unknown): TutorClientRequestError {
  const recoverableRetry = TutorRecoverableRetryErrorSchema.safeParse(payload);
  if (recoverableRetry.success) {
    const requestId =
      payload &&
      typeof payload === "object" &&
      "requestId" in payload &&
      typeof (payload as Record<string, unknown>).requestId === "string"
        ? ((payload as Record<string, unknown>).requestId as string)
        : null;
    return new TutorClientRequestError({
      status,
      code: recoverableRetry.data.error.code,
      message: recoverableRetry.data.error.message,
      retryable: recoverableRetry.data.error.retryable,
      requestId,
    });
  }

  const rateLimited = TutorRateLimitResponseSchema.safeParse(payload);
  if (rateLimited.success) {
    return new TutorClientRequestError({
      status,
      code: rateLimited.data.error.code,
      message: rateLimited.data.error.message,
      retryable: rateLimited.data.error.retryable,
      requestId: rateLimited.data.requestId ?? null,
    });
  }

  const standardError = TutorErrorResponseSchema.safeParse(payload);
  if (standardError.success) {
    return new TutorClientRequestError({
      status,
      code: standardError.data.error.code,
      message: standardError.data.error.message,
      retryable: standardError.data.error.retryable,
      requestId: standardError.data.requestId ?? null,
    });
  }

  return new TutorClientRequestError({
    status,
    code: "TUTOR_REQUEST_FAILED",
    message: `Tutor request failed with status ${status}.`,
    retryable: status >= 500,
    requestId: null,
  });
}

function assertSchema<T extends z.ZodTypeAny>(schema: T, payload: unknown): z.output<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new TutorClientRequestError({
      status: 502,
      code: "TUTOR_CLIENT_INVALID_RESPONSE",
      message: "Tutor API response shape was invalid.",
      retryable: true,
      requestId: null,
    });
  }
  return parsed.data;
}

async function performTutorRequest<T extends z.ZodTypeAny>(
  path: string,
  options: { method: "GET" | "POST"; body?: string },
  responseSchema: T,
): Promise<z.output<T>> {
  const response = await apiRequestRaw(path, {
    method: options.method,
    ...(options.body ? { body: options.body } : {}),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw parseTutorError(response.status, payload);
  }

  return assertSchema(responseSchema, payload);
}

export async function startTutorConversation(
  request: TutorStartConversationRequest,
): Promise<TutorStartConversationResponse> {
  const validatedRequest = TutorStartConversationRequestSchema.parse(request);
  return performTutorRequest(
    "/api/tutor/conversations",
    {
      method: "POST",
      body: JSON.stringify(validatedRequest),
    },
    TutorStartConversationResponseSchema,
  );
}

export async function fetchTutorConversation(
  conversationId: string,
): Promise<TutorFetchConversationResponse> {
  return performTutorRequest(
    `/api/tutor/conversations/${encodeURIComponent(conversationId)}`,
    { method: "GET" },
    TutorFetchConversationResponseSchema,
  );
}

export async function appendTutorMessage(
  request: TutorAppendMessageRequest,
): Promise<TutorAppendMessageResponse> {
  const validatedRequest = TutorAppendMessageRequestSchema.parse(request);
  return performTutorRequest(
    "/api/tutor/messages",
    {
      method: "POST",
      body: JSON.stringify(validatedRequest),
    },
    TutorAppendMessageResponseSchema,
  );
}
