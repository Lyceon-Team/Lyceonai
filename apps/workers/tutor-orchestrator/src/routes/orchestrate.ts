import * as express from "express";
import { Request, Response } from "express";

import {
    orchestrateRequestSchema,
    orchestrateResponseSchema,
} from "../lib/schema.js";

export const orchestrateRouter = express.Router();

orchestrateRouter.post("/", (req: Request, res: Response) => {
    const parsed = orchestrateRequestSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: {
                message: "Invalid orchestrate request",
                details: parsed.error.flatten(),
            },
        });
    }

    const response = {
        response: {
            content: "This is a stub tutor response from the orchestrator.",
            content_kind: "message" as const,
            suggested_action: {
                type: "none" as const,
                label: null,
            },
            ui_hints: {
                show_accept_decline: false,
                allow_freeform_reply: true,
                suggested_chip: null,
            },
        },
        question_links: [],
        instruction_exposures: [],
        orchestration_meta: {
            model_name: "stub",
            cache_used: false,
            compaction_recommended: false,
        },
    };

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
});