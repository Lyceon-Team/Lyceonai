# Lyceon — Claude Code Implementation Guide (zero to running)

Written for someone who has never set this up. Work top to bottom. Each stage ends with a check so you know it worked before moving on. Nothing here edits your specs or code until **Stage 6**, and even then only with your approval.

**Time:** ~30–45 min for Stages 1–5. Skill building (Stage 6) is ongoing.

---

## What you're doing, in plain English

1. Install the Claude Code app (a coding assistant that runs in your terminal).
2. Log in.
3. Drop the setup bundle into your repo so Claude Code knows your rules.
4. **Prove the guardrails work** (try to break a rule, watch it get blocked).
5. Run a read-only report of where your code stands vs your specs.
6. Build your domain skills one at a time, grounded in `docs/Spec`.
7. Start the real cleanup, one audited pass at a time.

"Terminal" = the text window where you type commands. On **macOS**: open the **Terminal** app (Cmd+Space, type "Terminal"). On **Windows**: open **PowerShell** (Start menu, type "PowerShell").

> **Cross-platform:** the guardrail hooks are now portable **Node** scripts (`.mjs`), so they behave identically on macOS, Windows, and Linux — no bash, WSL, or Git Bash needed. (Your repo already has Node, since Lyceon is a Node/TS codebase.)

**Prerequisite:** Claude Code needs a paid plan (Pro, Max, Team, or Enterprise). The free Claude.ai plan does not include it.

---

## Stage 1 — Install the Claude desktop app and enable Claude Code

You're using Claude Code inside the **Claude desktop app** (recommended for you — it's the full Claude Code engine with a GUI, a file panel, and a Customize sidebar that shows your hooks and skills).

1. Download the Claude desktop app from the official site and install it (or update to the latest version if you already have it).
2. Open it and sign in with your paid plan (Pro/Max/Team — Claude Code isn't on the free plan).
3. Enable/open **Claude Code** in the app (follow the in-app prompt; on the latest desktop build it's built in, surfaced in the sidebar). If you don't see it, update the app to the latest version.

**Check it worked:** the app opens a Claude Code workspace where you can open a project folder. (Optional: if you also want the terminal `claude` command available — only needed for the optional skill-description optimizer in Stage 6 — install the native CLI separately with `curl -fsSL https://claude.ai/install.sh | bash` on macOS/Linux, or `irm https://claude.ai/install.ps1 | iex` in Windows PowerShell. Not required to proceed.)

---

## Stage 2 — Open your repo as a project

In the desktop app, **open your Lyceon repo folder** as a project (use the app's open-project / add-folder control). The file panel should show your repo's structure, including `docs/Spec/`.

When prompted to **trust the folder**, say yes (it's your repo). The first time it sees hooks committed in the repo, it may ask you to **review and approve** them — you'll do that in Stage 4.

**Check it worked:** you see your repo's files in the app, and a chat/prompt area for Claude Code.

---

## Stage 3 — Put the setup into your repo

You have `lyceon-claude-setup.tar.gz`. Extract it and move its contents to your **repo root** (the top folder of your project, the same place `docs/Spec/` lives).

Easiest path: ask Claude Code to do it for you. In the app's prompt, paste:

> Extract lyceon-claude-setup.tar.gz (it's in my Downloads) and move its contents — CLAUDE.md, README.md, SKILL-BUILD-PLAN.md, IMPLEMENTATION-GUIDE.md, the .claude folder, and the skill-drafts folder — into this repo root, then delete the leftover lyceon-claude-setup folder. Don't touch docs/Spec.

(The Node hooks need **no** `chmod` — they're invoked as `node script.mjs`, so they're executable on any OS as-is.)

Or do it by hand: extract the archive (double-click on macOS, or `tar -xzf` in a terminal) and move those items into the repo root in your file explorer.

After this your repo root should contain: `CLAUDE.md`, `.claude/`, `skill-drafts/`, `SKILL-BUILD-PLAN.md`, alongside your existing `docs/Spec/`.

**Two required edits before it's "clean":**

1. **Set the real coding-standards filename.** Open `CLAUDE.md`, find the line with `REPLACE-WITH-REAL-CODING-STANDARDS-FILENAME.md`, and change it to the actual filename of your coding-standards doc inside `docs/Spec/`. (A wrong path fails silently — the standards just won't load.) To find the filename:
   ```bash
   ls docs/Spec
   ```
2. **Confirm the spec folder is `docs/Spec/`.** If yours is named differently, update three spots: the path checks in `.claude/hooks/block-spec-and-secrets.mjs`, the `deny` lines in `.claude/settings.json`, and the import in `CLAUDE.md`. (If it's exactly `docs/Spec/`, do nothing.)

**Commit it** so your team gets the same guardrails:
```bash
git add CLAUDE.md .claude SKILL-BUILD-PLAN.md skill-drafts
git commit -m "Add Claude Code setup: rules, guardrail hooks, process skills, skill build plan"
```

---

## Stage 4 — Prove the guardrails work (do not skip)

Launch Claude Code in the repo (`claude`). The first time it sees the hooks, it may ask you to **review and approve** them — glance and approve (they're the scripts you just committed).

**Confirm the pieces loaded:**
- Type `/hooks` → you should see entries under `PreToolUse` and `PostToolUse`.
- Type `/help` or start typing `/spec` → you should see `/spec-drift`, `/new-feature`, `/grill-me`.

**Now prove the hard blocks actually fire.** Paste each, one at a time:

> Try to add the line `TEST` to the top of any file inside docs/Spec.

That must be **refused** — the spec corpus is read-only. Then:

> Run `npm install left-pad` in the terminal.

That must be **refused** — npm is blocked, pnpm only.

If both are blocked, your safety net is real and you can trust it. If either goes through, stop and tell me — something didn't wire up (usually a wrong `docs/Spec` path, or Node not found on PATH).

---

## Stage 5 — The drift report (read-only, safe)

This maps where your code stands against your specs and produces the work backlog. It makes **no changes**. In Claude Code, type:
```
/spec-drift
```
If your repo layout is ambiguous, Claude Code will ask you a couple of questions first — answer them. You'll get a report: per-area state, gaps ranked by which invariant is at risk, and an ordered backlog. Read it. This is your map for everything after.

---

## Stage 6 — Build the domain skills with skill-creator

Your `skill-drafts/` are first drafts written from prior context — **not yet verified against your real specs**. `skill-creator` (a tool inside Claude Code) rebuilds each one against `docs/Spec` so it's defensible. Build them one at a time, in the order in `SKILL-BUILD-PLAN.md`, starting with `anti-leak`.

**Paste this to start the first skill** (this is the kickoff prompt — it tells Claude Code to ground in your specs and to interview you before writing):

```
Use the skill-creator skill to build our anti-leak skill.

Treat skill-drafts/anti-leak/SKILL.md as a V0 draft, NOT as truth. The truth is
in docs/Spec — read the relevant sections (anti-leak / question-bank / practice /
exam read-path and Coding Standards §5) IN FULL first. Where the draft and the
spec disagree, the spec wins. Where the spec is silent, drop the claim — do not
invent. Follow SKILL-BUILD-PLAN.md.

Hard rule: reference, never restate. The skill names a rule and cites the exact
docs/Spec doc + section. It must NOT transcribe constant values, formulas, or
windows; put any needed detail in references/ with its citation.

Before writing anything, interview me with the AskUserQuestion tool about edge
cases and anything ambiguous in the spec. Then draft the skill, write 2-3
realistic test prompts including one that plants an anti-leak violation, run the
eval loop, and show me the results before promoting it. Do not move it into
.claude/skills/ until I approve.
```

**What happens next:**
- Claude Code asks you clarifying questions. Answer in your normal style.
- It reads `docs/Spec`, reconciles the draft, writes the skill plus test prompts.
- It runs the tests (a version of Claude *with* the skill vs *without*) and shows you the outputs to review.
- You give feedback; it iterates.
- When it reliably triggers, cites real sections, restates nothing, and catches the planted violation → tell it to **promote** the skill into `.claude/skills/`.

**Then repeat** for the rest, in order: `auth-entitlements → determinism-idempotency → stripe-billing → mastery-kpi → frontend → practice-engine → tutor-runtime → testing-audit`. Reuse the same kickoff prompt, swapping the skill name and the specs to read (the per-skill source map is the table in `SKILL-BUILD-PLAN.md`).

> Tip: do **one skill per session** and run `/clear` between them, so Claude Code starts each with a clean head.

---

## Stage 7 — First alignment pass

Once the skills exist, start the actual cleanup, one scoped pass at a time, taking the first item from your Stage 5 backlog (it'll be an anti-leak item). Paste:

```
/new-feature implement [the first anti-leak backlog item from the /spec-drift report]
```

`/new-feature` walks the locked order: spec → schema → domain → handler → tests → observability, then self-reviews with `/grill-me` and hands to the `spec-auditor` before you send it to Codex. Work the backlog top to bottom, one pass per session, `/clear` between them.

---

## Daily habits that keep it working

- **One task per session.** Run `/clear` between unrelated tasks — a cluttered context makes Claude worse.
- **Plan first for anything non-trivial.** Use plan mode (Claude reads and proposes before editing).
- **Correct early.** If it goes sideways, press `Esc` and redirect rather than letting it pile up.
- **Commit often**, with clear messages.
- **Trust the proof, not the prose.** Make it show you test output, not just claim success.

---

## If something breaks (quick triage)

- `claude --version` fails → open a fresh terminal; then `claude doctor`.
- Hooks don't show in `/hooks` → confirm the `.mjs` files are in `.claude/hooks/` and that `node --version` works in your terminal.
- A block didn't fire → wrong `docs/Spec` path in the hook/settings, or scripts not executable.
- Standards "don't seem loaded" → the `@docs/Spec/...` filename in `CLAUDE.md` is wrong.
- Skill never triggers → its `description` needs to be more specific/pushy (skill-creator's description optimizer fixes this).

---

## Where things live (reference)

- `CLAUDE.md` — rules Claude reads every turn.
- `.claude/settings.json` — permissions + which hooks run.
- `.claude/hooks/` — the guardrail scripts.
- `.claude/agents/spec-auditor.md` — the read-only reviewer.
- `.claude/skills/` — live skills (`/spec-drift`, `/new-feature`, `/grill-me`; domain skills land here after Stage 6).
- `skill-drafts/` — domain skill drafts waiting to be built.
- `SKILL-BUILD-PLAN.md` — the per-skill build procedure + source map.
- `docs/Spec/` — your locked corpus. Canonical. Read-only to Claude Code.
