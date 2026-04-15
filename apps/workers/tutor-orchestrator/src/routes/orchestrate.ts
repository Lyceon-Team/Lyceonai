import express from "express";
import type { Request, Response } from "express";
import {
    orchestrateRequestSchema,
    orchestrateResponseSchema,
} from "../lib/schema.js";
import { generateTutorResponse } from "../lib/vertex.js";

export const orchestrateRouter = express.Router();

orchestrateRouter.post("/", async (req: Request, res: Response) => {
    const parsed = orchestrateRequestSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: {
                message: "Invalid orchestrate request",
                details: parsed.error.flatten(),
            },
        });
    }

    try {
        const response = await generateTutorResponse(parsed.data);

        const validated = orchestrateResponseSchema.safeParse(response);
        if (!validated.success) {
            return res.status(500).json({
                error: {
                    message: "Invalid orchestrator response shape",
                    details: validated.error.flatten(),
                },
            });
        }

        return res.status(200).json(validated.data);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown orchestrator failure";

        return res.status(502).json({
            error: {
                message: "Vertex orchestration failed",
                details: message,
            },
        });
    }
});