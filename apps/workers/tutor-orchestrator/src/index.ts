import * as express from "express";
import { Request, Response } from "express";
import { compactRouter } from "./routes/compact.js";
import { orchestrateRouter } from "./routes/orchestrate.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

app.use("/orchestrate", orchestrateRouter);
app.use("/compact", compactRouter);

app.listen(port, () => {
  console.log(`Tutor orchestrator listening on port ${port}`);
});