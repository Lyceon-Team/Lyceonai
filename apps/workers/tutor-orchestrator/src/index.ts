import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { createWorkerBoundaryAuthMiddleware } from "./lib/boundary-auth.js";
import { compactRouter } from "./routes/compact.js";
import { orchestrateRouter } from "./routes/orchestrate.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

const boundaryAuth = createWorkerBoundaryAuthMiddleware();
app.use("/orchestrate", boundaryAuth, orchestrateRouter);
app.use("/compact", boundaryAuth, compactRouter);

app.listen(port, () => {
  console.log(`Tutor orchestrator listening on port ${port}`);
});
