/**
 * @spec [owner brief "Video player: near-fullscreen" (Karl, 2026-10-27): the player's browser
 *       tests in the student harness] | @implemented [2026-10-27]
 *
 * plain English: prints the `recommend_video` action the BFF sends a student when LISA offers
 * Desmos Lesson #10, built by the REAL producers: the reviewed library file through the apply
 * script's own parser (`parseReviewedCsv`), the row through the retrieval's `libraryVideoSchema`,
 * and the worker's offer (index 1) through `resolveVideoAction`, which projects the client's five
 * fields. tests/e2e/tutor-video-player.spec.ts serves it as the turn's `suggested_action`; the
 * harness never runs a tutor turn (server.ts), so this is the one hop the spec stands in for.
 *
 * run: pnpm exec tsx --import ./tests/e2e/student-harness/register.mjs \
 *        tests/e2e/student-harness/video-offer.ts
 * (the module hooks stub the Supabase client the retrieval module imports; nothing is queried).
 */
import { readFileSync } from "node:fs";
import { parseReviewedCsv } from "../../../scripts/rag/apply-video-library";
import { REVIEW_CSV, loadTaxonomy } from "../../../scripts/rag/tag-videos";
import {
  libraryVideoSchema,
  resolveVideoAction,
} from "../../../server/services/tutor-video-library";

/** Desmos Lesson #10 (Equivalent Expressions), the proof video of the brief. */
export const DESMOS_LESSON_ID = "a1QNaRnn6cE";

const rows = parseReviewedCsv(
  readFileSync(REVIEW_CSV, "utf8"),
  loadTaxonomy().domainOf,
);
const row = rows.find((r) => r.video_id === DESMOS_LESSON_ID && r.approve);
if (row === undefined) {
  throw new Error(`${DESMOS_LESSON_ID} is not an approved library video`);
}
const offered = [
  libraryVideoSchema.parse({
    video_id: row.video_id,
    title: row.title,
    channel_name: row.channel_name,
    duration_seconds: row.duration_seconds,
    start_seconds: row.start_seconds,
    methods: row.methods,
    format: row.format,
  }),
];
const action = resolveVideoAction(
  { type: "recommend_video", label: "Watch the Desmos lesson", video_index: 1 },
  offered,
  false,
);
if (action.type !== "recommend_video") {
  throw new Error("resolveVideoAction attached no video");
}
process.stdout.write(`${JSON.stringify(action)}\n`);
