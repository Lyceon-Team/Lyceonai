# Architecture Documentation (Launch Truth)

These documents are the authoritative, launch-critical references for Lyceon’s runtime architecture and API surface.

## Source-of-truth documents

* [System Invariants](./system-invariants.md)
* [Runtime Route Map](./route-map.md)

## Rules of use

* Any PR touching core flows (auth, practice, billing, guardian, ingestion, or admin operations) **must** update these docs.
* API contracts, golden tests, and launch-hardening checklists **must** reference these docs.
* These docs represent **launch truth**; do not rely on tribal knowledge or stale diagrams.
