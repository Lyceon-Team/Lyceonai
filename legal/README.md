# LYCEON legal documents

The published consumer documents, versioned so that the text a person agreed
to can be produced years later.

## Why this exists

Before this directory, three layers each claimed a different version of the
same document — the canonical copy in `docs/Spec`, the body text served from
`client/src/lib/legal.ts`, and the `docVersion` stamped into every consent row
by `shared/legal-consent.ts`. The version lived in a different file from the
text, so nothing tied what a person read to what was recorded against them.

California's Automatic Renewal Law (Business and Professions Code
§ 17602(a)(4)) requires retaining the version a customer agreed to for three
years. That is only answerable if the text is immutable and addressable.

## Layout

```
legal/<slug>/
  manifest.json          names the current version and the locales
  v2/
    meta.yml             version, effective date, supersedes, published, hash
    en.md                the body — no version, no date, anywhere in it
```

The structure follows the one in `github.com/srcfl/legal`, including its rule:
*"Once a version folder is published, its files never change — new versions go
in new folders."*

## The rule

**A published version directory is read-only, forever.** Publishing a new
version means adding a directory and moving one line in the manifest. It never
means editing one that exists. `scripts/ci/legal-immutability-gate.mjs`
enforces this by comparing against the base branch — not against the
`content_hash` beside the file, because an author who edits `en.md` and
updates the hash in the same commit would defeat that. Git history is the one
record a single commit cannot rewrite.

## Version and date live in `meta.yml`, never in the body

`en.md` contains no version number and no date. Both are injected at render
time from `meta.yml`. That is what makes date drift structurally impossible
rather than something a person has to remember.

## `content_hash`

`sha256` over the **raw committed bytes of `en.md`** — no normalisation,
trailing newline included, written as lowercase hex with a `sha256:` prefix.
It covers `en.md` only. Reproduce it with:

```bash
sha256sum legal/<slug>/<version>/en.md
```

`.gitattributes` pins `eol=lf` repo-wide so those bytes are identical on every
checkout on every platform. Without that pin the same commit would hash
differently on Windows, and a hash nobody else can reproduce is worse than no
hash at all.

## `current: null`

A slug may exist with no published version. That is not a defect state — it
lets a document be cited before it is written, with the manifest gate
reporting honestly that nothing is published yet rather than the citation
silently dangling. `billing-terms` is in that state today: cited by four
documents, not yet committed.

## Adding a version

1. `cp -R legal/<slug>/v2 legal/<slug>/v3`
2. Edit `v3/en.md`. Set `effective_date` and `supersedes` in `v3/meta.yml`.
3. Recompute `content_hash` from the new `en.md`.
4. Change `"current"` to `"v3"` in `manifest.json`.

No code change and no route change. `v2/` stays where it is, forever.

## Gates

| Gate | Refuses |
|---|---|
| `legal-immutability-gate.mjs` | any change to a published version directory |
| `legal-manifest-gate.mjs` | a manifest naming a version that does not exist; a malformed or incomplete `meta.yml` |
| `legal-xref-gate.mjs` | a document cited by name that has no slug |
| `legal-body-purity-gate.mjs` | a version or date header inside a body; a build copy under `dist/public/legal` that has forked from its source |

`legal-gates.selftest.sh` plants each defect and observes the gate turn red —
21 cases, including the ones that must stay **green**: a date *cited in prose*
(these are contracts and they name statute dates), and publishing a new version
directory.

## Docs-as-code is complete for legal text

This is the end state the three phases set out to reach, and the reason the
structure looks the way it does:

| Property | How it holds |
|---|---|
| **One source per document** | `legal/<slug>/<version>/en.md`, and nowhere else |
| **Published versions are immutable** | the immutability gate, measured against git history rather than a self-referential hash |
| **Stable paths** | `manifest.json` names the current version; publishing moves one line and adds a directory, with no code or route change |
| **Consent is provable** | every acceptance row carries slug, version and the `content_hash` of the exact bytes served |
| **Four gates enforce it** | and each one has been watched turning red for the defect it claims to catch |

What was removed to get here, in order. `docs/Spec` held eight canonical copies
(Phase 2). `client/src/lib/legal.ts` held 1,037 lines of body text, two versions
behind them, which is what users actually read (Phase 2). `client/public/legal/`
held six PDFs — v1, December 2024, `Lyceon` branding — linked as "View PDF" and
"Download" from the hub and every document page (Phase 3). The PDFs were the
last of them and the worst: binary, so nothing could regenerate them from
`en.md` and no gate could see that they had drifted. They are deleted rather
than resynchronised. The markdown page is the document, and a `@media print`
rule in `client/src/index.css` makes it print without the site chrome.

### What deliberately remains outside this structure

Two things, both decided rather than overlooked:

- **`docs/Spec/Lyceon Privacy Policy.md`** — an orphan that never corresponded
  to a served document. Kept by owner ruling during Phase 1 rather than
  migrated, because migrating it would assert it was a version of something.
- **24 legacy consent rows** — 12 users × two documents each, `privacy_policy`
  stamped `doc_version` `2024-12-22` and `student_terms` `2024-12-20`, both
  referencing December 2024 text that no longer exists anywhere in the
  repository. They are **not** backfilled. Stamping them with a v2.0 hash would
  assert those users accepted text they never saw; `NULL` in `doc_slug` and
  `content_hash` says "we did not retain this", which is true. Those users are
  re-prompted at next sign-in, which is the correct outcome, not a regression.

The honest reading of the second point: consent records from before this
structure existed cannot be made provable after the fact. Everything recorded
from here on can.
