import * as express from "express";
import { Request, Response } from "express";
import { compactRequestSchema, compactResponseSchema } from "../lib/schema.js";

export const compactRouter = express.Router();

compactRouter.post("/", (req: Request, res: Response) => {
    const parsed = compactRequestSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: {
                message: "Invalid compact request",
                details: parsed.error.flatten(),
            },
        });
    }

    const response = {
        ok: true,
    };

    const validated = compactResponseSchema.safeParse(response);

    if (!validated.success) {
        return res.status(500).json({
            error: {
                message: "Invalid compact response shape",
                details: validated.error.flatten(),
            },
        });
    }

    return res.status(200).json(validated.data);
});