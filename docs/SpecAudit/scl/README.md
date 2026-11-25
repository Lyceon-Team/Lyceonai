# SCL entries, one file each

Since 2026-11-25 (owner ruling), every new spec-change entry is its own file here,
`SCL-NNN-<slug>.md`. Entries up to SCL-289 stay in `../SPEC_CHANGES_LOG.md`, which is
closed to new entries. Both together are the register; its rules (what an SCL is, the
status values) are at the top of that file.

Write one with:

    pnpm scl:new --slug <short-name> --branch <integration branch> --title "<what changes>"

The tool fetches every remote branch, so it sees every open pull request, takes the highest
number anywhere, and writes the next one. The file starts with the usual heading line
(`SCL-NNN | date | title | PROPOSED`) and a `Branch:` line naming where the change belongs.
Fill in the rest of the fields.

Separate files mean two branches never conflict over the register. If two branches still pick
the same number, CI flags it (`scripts/ci/scl-duplicate-check.mjs`, a warning): the later
entry, by its own date, takes a new number with `pnpm scl:new` and renames its file.
