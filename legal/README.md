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

`legal-gates.selftest.sh` plants each defect and observes the gate turn red.
