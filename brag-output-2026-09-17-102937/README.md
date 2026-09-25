# Lyceon launch film

A 24-second, 1920×1080, no-narration `/brag` composition that explains Lyceon's connected learning loop from diagnostic through guardian visibility.

## Preview

Serve this directory from the repository root, then open the composition:

```bash
python3 -m http.server 4173
# http://localhost:4173/brag-output-2026-09-17-102937/composition/?t=0
```

Set `t` to any second from `0` through `24` to inspect a deterministic frame. The composition's own timeline calls `window.renderAt(seconds)` and is suitable for seek-by-frame capture.

## Deliverables

- `brag-plan.md` — planning rubric, angle, audio direction, and complete storyboard
- `composition-brief.md` — implementation handoff
- `composition/` — runnable deterministic HTML composition
- `brag.jpg` — selected final-lockup poster frame
- `share-copy.txt` — short and long launch copy

## Render status

The HTML composition and poster are complete. `brag.mp4` is intentionally not fabricated: the required Hyperframes CLI and browser/FFmpeg runtimes were unavailable, and all approved download endpoints returned HTTP 403 in this environment. Run the standard render gate when those tools are available:

```bash
npx hyperframes check brag-output-2026-09-17-102937/composition
npx hyperframes render brag-output-2026-09-17-102937/composition --output brag-output-2026-09-17-102937/brag.mp4
```
