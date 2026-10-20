/**
 * The one Slack client now lives in shared/slack/client.ts (moved 2026-10-20 so the server can use
 * it too). Re-exported here so every repo job keeps its import unchanged.
 */
export * from "../../shared/slack/client";
