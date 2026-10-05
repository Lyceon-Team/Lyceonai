"""UI-53 plant runner: one product-source mutation per plant, at an anchor that must occur
exactly once (its line number is recorded), the named tests run, the file restored and
compared byte for byte. Plants never touch a test file."""
import os
import subprocess
import sys

ROOT = "/home/user/Lyceonai/.claude/worktrees/agent-a69dc4084561c56b1"
os.chdir(ROOT)

PAGE = "client/src/components/practice/CanonicalPracticePage.tsx"
REND = "client/src/components/question-renderer.tsx"
HOOK = "client/src/hooks/useCanonicalPractice.ts"
KEYS = "client/src/hooks/useKeyboardShortcuts.ts"
ENG = "client/src/lib/engine-config.ts"
SHELLS = "client/src/lib/route-shells.ts"
RP = "client/src/pages/resume-practice.tsx"
RR = "client/src/pages/resume-review.tsx"
SRV = "server/routes/practice-canonical.ts"
REFS = "client/src/components/math/MathReferenceSheet.tsx"

RUNNER_T = "client/src/components/practice/CanonicalPracticePage.runner.test.tsx"
LETTERS_T = "client/src/components/question-renderer.display-letters.test.tsx"
KEYS_T = "client/src/components/practice/CanonicalPracticePage.keyboard.test.tsx"
DIAG_T = "client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx"
SHELLS_T = "client/src/lib/route-shells.test.tsx"
RP_T = "client/src/pages/resume-practice.test.tsx"
RR_T = "client/src/pages/resume-review.test.tsx"
PG_T = "tests/ci/practice-runner.pg.ci.test.ts"

PLANTS = [
    ("L1", REND, "const letter = DISPLAY_LETTERS[index] ?? null;",
     "const letter = DISPLAY_LETTERS[options.length - 1 - index] ?? null;",
     [LETTERS_T, RUNNER_T], "letters by reverse position"),
    ("A1", REND, "      {showResult ? (\n        <section",
     "      {true ? (\n        <section",
     [RUNNER_T], "feedback panel rendered before submit"),
    ("A2", HOOK, "        resetPerQuestionState();\n        return data;",
     "        resetPerQuestionState();\n      setShowResult(true);\n      setExplanation(String((data.question as unknown as Record<string, unknown> | null)?.explanation ?? \"\"));\n        return data;",
     [RUNNER_T], "the hook reveals a leaking /next payload's explanation"),
    ("A3", REND, "              : picked\n                ? \"picked\"\n                : \"idle\";",
     "              : opt.id === (options[1]?.id ?? \"\")\n                ? \"correct\"\n                : picked\n                  ? \"picked\"\n                  : \"idle\";",
     [RUNNER_T], "a pre-submit mapping marks a choice as correct"),
    ("S1", PAGE, "disabled={runnerBusy || !canSubmit}", "disabled={runnerBusy}",
     [RUNNER_T], "Submit enabled with no choice"),
    ("S2", PAGE, "onClick={() => void submitAnswer({ skipped: true })}",
     "onClick={() => void submitAnswer({ skipped: false })}",
     [RUNNER_T], "Skip submits instead of skipping"),
    ("F1", REND, '{isCorrect ? "Correct" : "Not quite"}', '{isCorrect ? "Correct" : "Correct"}',
     [RUNNER_T], "a miss titled Correct"),
    ("F2", REND, '                  ? "Your answer"', '                  ? ""',
     [RUNNER_T], "no 'Your answer' tag on the wrong pick"),
    ("F3", REND, "{!isCorrect && missNote ? (", "{false ? (",
     [RUNNER_T], "no review-queue note on a practice miss"),
    ("F4", ENG, "    tutor: true,\n    missNote: false,", "    tutor: true,\n    missNote: true,",
     [RUNNER_T], "review shows the review-queue note on a miss"),
    ("F5", REND, "            {shownExplanation.length > 0 ? (", "            {false ? (",
     [RUNNER_T], "the explanation is not shown after submit"),
    ("K1", PAGE, "      onNext: goNext,", "      onNext: () => undefined,",
     [RUNNER_T, KEYS_T], "→ / Enter after feedback do nothing"),
    ("K2", KEYS, '    {\n      key: "ArrowDown",\n      allowOnControls: isRunnerSubmitControl,',
     '    {\n      key: "ArrowDown",', [KEYS_T], "↓ ignored on a focused choice"),
    ("P1", PAGE, "  return `Question ${index + 1} of ${total}`;", "  return `Question ${index} of ${total}`;",
     [RUNNER_T], "Question N of M off by one"),
    ("P2", PAGE, '    i < index ? "done" : i === index ? "current" : "todo",',
     '    i < index ? "todo" : i === index ? "current" : "done",',
     [RUNNER_T], "progress strip fills the wrong side"),
    ("B1", SHELLS, 'focus("Practice", "/practice", false, null)', 'focus("Practice", "/dashboard", false, null)',
     [RUNNER_T, SHELLS_T], "back goes to /dashboard"),
    ("TL1", SHELLS, 'focus("Practice", "/practice", false, null)', 'focus("Practice", "/practice")',
     [SHELLS_T], "practice runner put back on the light lock"),
    ("T1", PAGE, "        sessionItemId={sessionItemId}\n", "        sessionItemId={sessionItemId}\n        {...{ choices: question?.options }}\n",
     [RUNNER_T], "LISA handed the choices"),
    ("O1", PAGE, "{props.shortened === true && currentIndex === 0 ? (", "{false ? (",
     [RUNNER_T], "no shorter-session note"),
    ("O2", PAGE, "      shortened={session.shortened}\n", "\n", [], "unused"),  # placeholder, replaced below
    ("N1", HOOK, "    if (pending) return pending;", "    if (pending && false) return pending;",
     [RUNNER_T], "StrictMode double /next"),
    ("C1", HOOK, 'nextPayloadBody.error === "session_closed"', 'nextPayloadBody.error === "session_closed_X"',
     [RUNNER_T], "session_closed treated as an error (F-53)"),
    ("C2", PAGE, "    if (sessionClosed) navigate(completionDest);",
     "    if (sessionClosed) void completionDest;",
     [RUNNER_T, DIAG_T], "a closed session never leaves"),
    ("D1", PAGE, "            {!isDiagnostic ? (", "            {true ? (",
     [DIAG_T], "diagnostic shows Skip"),
    ("CH1", PAGE, "      <div className=\"flex items-center gap-3\">\n        {!showResult ? (",
     "      <div className=\"flex items-center gap-3\">\n        <span>End Session</span>\n        {!showResult ? (",
     [RUNNER_T, DIAG_T], "old End Session chrome back"),
    ("RP1", RP, '      title={sessionTitle("practice", session.criteria, session.section)}',
     '      title="Practice"', [RP_T], "practice runner not named by criteria"),
    ("RP2", RP, "      shortened={session.shortened}\n", "", [RP_T], "shortened not passed to the runner"),
    ("RR1", RR, 'title={sessionTitle("review", session.criteria, null)}',
     'title={sessionTitle("practice", session.criteria, null)}', [RR_T], "review runner named with practice wording (U2b)"),
    ("SRV1", SRV, "  if (!promoted) {\n    // F-64: another /next promoted this item first (see the doc comment above).",
     "  if (!promoted) {\n    return args.res.status(500).json({ error: \"session_item_promote_failed\", requestId });\n    // F-64: another /next promoted this item first (see the doc comment above).",
     ["PG:" + PG_T + "::F-64"], "lost CAS answers 500 again"),
    ("SRV2", SRV, "  if (await hasUnresolvedItemBefore(args.sessionId, nextPrebuilt.ordinal)) {",
     "  if (false) {", ["PG:" + PG_T + "::F-64"], "promote past an already-served item"),
    ("SRV3", SRV, "      shortened: isShortenedSession(metadata),", "      shortened: false,",
     ["PG:" + PG_T + "::OQ-35"], "never shortened"),
    ("SRV4", SRV, "      shortened: isShortenedSession(metadata),",
     "      shortened: isShortenedSession(metadata),\n      source_pool_count: metadata.source_pool_count,",
     ["PG:" + PG_T + "::OQ-35"], "the pool size reaches the client"),
]
PLANTS += [
    ("O3", PAGE, "{props.shortened === true && currentIndex === 0 ? (", "{currentIndex === 0 ? (",
     [RUNNER_T], "the shorter-session note on every session"),
    ("NM1", PAGE, "        {props.title}\n", "        {\"Practice\"}\n", [DIAG_T], "the bar ignores the session name"),
    ("DN1", PAGE, "  const goNext = (): void => {\n    void nextQuestion();\n  };",
     "  const goNext = (): void => {\n    if (!isLastQuestion) void nextQuestion();\n  };",
     [DIAG_T, RUNNER_T], "Done on the last question does nothing"),
    ("C3", PAGE, "    if (sessionClosed) navigate(completionDest);",
     "    if (!sessionClosed) navigate(completionDest);",
     [DIAG_T], "an open session navigates away"),
    ("CH2", PAGE, "      {error ? <Notice tone=\"danger\" title={String(error)} /> : null}",
     "      <p>Session Guidance</p>\n      {error ? <Notice tone=\"danger\" title={String(error)} /> : null}",
     [RR_T, RUNNER_T], "the guidance card is back"),
]
PLANTS += [
    ("C4", HOOK, "        if (data.state) setSessionState(data.state);\n        // Owner ruling",
     "        if (data.state) setSessionState(data.state);\n        if (data.state === \"completed\") setSessionClosed(true);\n        // Owner ruling",
     [RUNNER_T], "the last answer closes the runner before its feedback is read"),
]
PLANTS = [p for p in PLANTS if p[0] != "O2"]


def run_tests(tests):
    red = False
    for t in tests:
        if t.startswith("PG:"):
            path, name = t[3:].split("::")
            env = dict(os.environ, PGHOST="localhost", PGUSER="postgres", PGPASSWORD="postgres", PGPORT="5432")
            r = subprocess.run(["pnpm", "exec", "vitest", "run", path, "-t", name], capture_output=True, text=True, env=env)
        else:
            r = subprocess.run(["pnpm", "exec", "vitest", "run", t], capture_output=True, text=True)
        out = r.stdout + r.stderr
        summary = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
        status = "RED" if r.returncode != 0 else "green"
        if r.returncode != 0:
            red = True
        print(f"      {status:5} {t.split('/')[-1]}  {summary[-1] if summary else ''}")
        for l in out.splitlines():
            if l.strip().startswith("×"):
                print("         " + l.strip()[:150])
    return red


only = set(sys.argv[1:])
results = []
for pid, path, old, new, tests, desc in PLANTS:
    if only and pid not in only:
        continue
    src = open(path).read()
    n = src.count(old)
    if n != 1:
        print(f"{pid}: ANCHOR COUNT {n} in {path} — not applied")
        results.append((pid, "ANCHOR", path, 0))
        continue
    line = src[: src.index(old)].count("\n") + 1
    open(path, "w").write(src.replace(old, new, 1))
    print(f"{pid} {path}:{line}  ({desc})")
    red = run_tests(tests)
    open(path, "w").write(src)
    if open(path).read() != src:
        print("   !! restore not byte-identical")
    results.append((pid, "RED" if red else "GREEN", path, line))

print()
for pid, st, path, line in results:
    print(f"{pid:5} {st:6} {path}:{line}")
