# Missing `infra/*` config registries — inventory

**Reported 2026-09-22.** Commissioned by the owner ruling on brief item F1
breadth: *"inventory the other 31 as a report, don't create them. They belong
to other workstreams, and one is explicitly forbidden."*

This is a report. Nothing here is created by the PR that carries it. The one
file that PR does create — `infra/retention-policy-registry.yaml` (Doc 06D
§9.1) — is excluded from the table below, which is why the count is 31 and not
32.

---

## How the list was derived

Measured, not assembled by hand:

```bash
grep -rhoE "infra/[A-Za-z0-9._/-]+\.(ya?ml|json|sql|md|ts|tf)" docs/Spec/ \
  | sed 's/[.,;:)]*$//' | sort -u
```

33 distinct `infra/*` paths are referenced by the locked spec corpus. **One
exists**: `infra/secret-class-inventory.yaml`. 32 do not. Subtract the one this
PR creates and 31 remain. The owning document and sections for each were
derived by locating every reference and taking the nearest preceding
`§`-heading, so the citations below are the documents' own, not a summary of
them.

## Why this matters more than a missing-file list usually does

Doc 01A §3's config doctrine makes these files the declared home of values the
spec then cites by filename. Several are inputs to proving mechanisms that are
described as launch-required. A gate whose input file does not exist cannot
run, and — as this vertical has now found twice — a gate that cannot run is
indistinguishable from a gate that passes:

* `scripts/ci/retention-archive-drift-check.mjs` existed from 2026-08-27,
  was invoked by no workflow, and was **red** on three real drifts when finally
  run (2026-09-22, SCL-106).
* `scripts/ci/secret-class-inventory-check.ts` is not wired into any workflow
  either, and exits 1 today on 12 stale consumer references.

Neither of those is about a missing file — both are about an unrun gate. The
31 files below are the same failure mode one step earlier: the gate cannot even
be written.

---

## The 31

| File | Owning document and sections |
|---|---|
| `infra/alert-registry.yaml` | Doc 06C §10.5.1, §11.4, §13.3, §18, §20, §21, §5.5, §7, §7.3, §8.6; Doc 06D §17, §18, §7.4, §9.3; Doc 06E §15, §17, §18, §2.2; Doc 07C §14.3, §17, §2.2; Doc 07D §13.2, §13.3, §16, §2.2, §4.2 |
| `infra/anonymization-standard.yaml` | Doc 06D §12.1, §12.2, §12.5, §12.6, §18, §2.1, §3 |
| `infra/cloudflare-access-policies.yaml` | Doc 06B §12.2 |
| `infra/compliance-gate-registry.yaml` | Doc 06D §10.2, §10.3, §10.4, §10.5, §10.6, §10.7, §17, §2.1, §20 |
| `infra/composite-slo-registry.yaml` | Doc 06C §5.4, §5.5 |
| `infra/dashboard-registry.yaml` | Doc 07C §1.3, §11.1, §11.2, §12.2, §12.3, §14.1, §15.2, §16, §19, §2.1, §2.2, §20, §4.1, §5.2, §5.3, §7.2, §8, §8.4, §8.5; Doc 07D §1.3, §11.1, §13.2, §13.5, §14.2, §15, §16, §18, §2.2, §2.3, §3, §4.2, §9, §9.3 |
| `infra/data-protection-config.yaml` | Doc 06D §20, §21, §7.4, §8.5 |
| `infra/environment-matrix.yaml` | Doc 06A §7.1 |
| `infra/environments.yaml` | Doc 06D §12.5 |
| `infra/event-schema-registry.yaml` | Doc 07 §1, §14, §2.1, §2.5, §3, §5.1, §7, §9; Doc 07A §1, §11.1, §12.1, §14, §2.1, §2.3, §3, §4, §5.1, §5.2, §9.2; Doc 07B §11.2, §11.3, §17, §18, §20, §3, §5.2, §6.4, §8.1, §9.5.3, §9.5.5; Doc 07C §9.4; Doc 07D §16, §5.1, §5.2, §9.2, §9.5; Doc 07E §12.3, §15.1 |
| `infra/experiment-registry.yaml` | Doc 07D §1.3, §10.1, §10.2, §13.1, §14.2, §14.3, §15, §18, §19, §2.1, §2.2, §3, §4.1, §5.1, §6.1, §6.3, §7.2, §8.2, §8.4, §9, §9.3, §9.5 |
| `infra/github-meta-snapshot.json` | Doc 06C §21, §9.4 |
| `infra/kpi-registry.yaml` | Doc 07 §1, §10, §14, §2.1, §2.2, §2.5, §3, §5.1, §7, §8, §9; Doc 07A §2.2; Doc 07B §1.1, §1.3, §15.1, §16.2, §17, §2.1, §2.2, §20, §21, §4.1, §9.5, §9.5.1, §9.5.3, §9.5.5, §9.6.1, §9.6.3, §9.6.4, §9.6.5; Doc 07C §11.1, §11.4, §14.1, §15.3, §16, §17, §2.2, §3, §4.1, §6.2, §8, §8.2, §8.4; Doc 07D §10.1, §10.2, §10.4, §13.1, §16, §2.2, §3, §4.1, §9, §9.2, §9.3, §9.5; Doc 09 §10.1, §11, §2.2, §4.3, §7.2 |
| `infra/observability-dashboards.yaml` | Doc 06C §13.3, §17 |
| `infra/oncall-rotation-registry.yaml` | Doc 06C §11.1, §11.2, §11.4 |
| `infra/privileged-op-source-registry.yaml` | Doc 06B §21, §22, §8.4, §8.6; Doc 06C §13.3 |
| `infra/prod-access-inventory.yaml` | Doc 06B §18, §7.5, §7.6 |
| `infra/queue-outbox-inventory.yaml` | Doc 06A §12.2, §12.3 |
| `infra/release-gates.yaml` | Doc 06A §10.1, §10.4, §19; Doc 06B §18; Doc 06D §10.1, §10.2, §10.6, §10.7, §15, §16, §18, §2.1, §2.2, §20, §3 |
| `infra/route-surface-classification.yaml` | Doc 06A §19, §22, §23, §5.3, §5.3.1; Doc 06B §11.4, §12.2, §18, §21, §22; Doc 06C §15, §20, §9.3, §9.4 |
| `infra/sat-test-calendar.yaml` | Doc 07A §10.2, §10.3, §10.4, §10.5, §14, §15, §2.1, §3, §4, §7.3; Doc 07B §9.3; Doc 07E §2.2 |
| `infra/scanner-allowlist.yaml` | Doc 06B §5.4.1 |
| `infra/scheduled-job-registry.yaml` | Doc 06C §10.5.1, §17, §18, §20, §21, §8.2, §8.4, §8.5, §8.6, §8.7; Doc 06D §15; Doc 06E §15; Doc 07 §8; Doc 07E §9.3 |
| `infra/severity-crosswalk-registry.yaml` | Doc 06C §10.5.1, §18, §20, §21, §6.0, §6.1, §7.3, §7.4, §7.5; Doc 06D §17, §18 |
| `infra/stack-inventory.yaml` | Doc 06A §19, §3.2 |
| `infra/status-page-state-mapping.yaml` | Doc 06C §12.3, §12.3.1, §12.4, §17, §18, §21 |
| `infra/substrate-cap-config.yaml` | Doc 06E §10.2, §10.4, §18 |
| `infra/synthetic-probes.yaml` | Doc 06C §9.3, §9.4 |
| `infra/system-state-archive-registry.yaml` | Doc 07E §11.2 |
| `infra/vendor-inventory.yaml` | Doc 06E §10.2, §10.4, §12.2, §13.2, §13.3, §16, §5.2, §5.6, §6.4, §9.3; Doc 07 §6.1, §6.2 |
| `infra/vendor-pricing-snapshot.yaml` | Doc 06E §13.1, §13.2, §13.3, §13.4, §16, §2.1, §2.2, §20, §5.2, §5.3, §5.6, §7, §7.9, §9.3 |

---

## "Explicitly forbidden" — corrected: none of them is

**Owner ruling, 2026-09-22:** *"'Explicitly forbidden' file — none. That claim
came from CC's own earlier report and CC now can't confirm it. Record it as a
correction. The alert registry gets built by its own workstream, without
analytics-layer alert rows."*

The F1 breadth ruling that commissioned this report said one of the 31 was
explicitly forbidden. That phrase entered the record from an earlier report of
mine, and when this inventory went looking for its basis there was none: a scan
for `MUST NOT` / `not created` / `forbidden` / `never` within 140 characters of
each filename returns only false positives (`never restated`,
`forbidden-identifier field`). **No file in this list is forbidden as a file.**
The claim is withdrawn, and it was mine to withdraw.

What *is* forbidden is narrower, real, and worth stating precisely, because it
governs how one of these files must be built when its workstream gets to it:

**`infra/alert-registry.yaml` (Doc 06C §7) must be built without
analytics-layer alert rows.** Doc 07 Parent **INV-07-09** is a negative
invariant — "No Doc 07 V1 mechanism produces an alert" — with its own proving
mechanism, `ci/doc07-v1-no-alerts`, which "fails if any V1 Doc 07 mechanism
declares an `alert_id`". Doc 07E §2 lists among its explicit exclusions: "the
alert-registry registration for analytics surfaces (Doc 06C §7 — none at V1 per
INV-07-09 negative invariant)". Doc 07 Parent §4 gives the reason: an alert with
"no rotation owner and no runbook" leaves 06C §11/§10 obligations unsatisfiable.

That constraint is why every `purge_alert_id` in
`infra/retention-policy-registry.yaml` is null, and why Doc 07E §6 sets both of
its own rows' alert ids to null citing INV-07-09. It also means Doc 06D §9.3
(d) and (g) — every `purge_alert_id` must resolve in the alert registry, and
every `manual` substrate must carry one — cannot be satisfied for the analytics
layer at V1 by anyone, which is a fact for the 06C workstream to inherit rather
than a gap in the retention registry.

## Grouping by workstream, for whoever picks these up

| Workstream | Files |
|---|---|
| **Observability / on-call (Doc 06C)** | `alert-registry`, `severity-crosswalk-registry`, `oncall-rotation-registry`, `scheduled-job-registry`, `synthetic-probes`, `observability-dashboards`, `status-page-state-mapping`, `composite-slo-registry`, `github-meta-snapshot` |
| **Infrastructure / deploy (Doc 06A)** | `environment-matrix`, `stack-inventory`, `release-gates`, `queue-outbox-inventory`, `route-surface-classification` |
| **Security (Doc 06B)** | `prod-access-inventory`, `privileged-op-source-registry`, `cloudflare-access-policies`, `scanner-allowlist` |
| **Data protection (Doc 06D)** | `anonymization-standard`, `compliance-gate-registry`, `data-protection-config`, `environments` |
| **Cost / vendor (Doc 06E)** | `vendor-inventory`, `vendor-pricing-snapshot`, `substrate-cap-config` |
| **Analytics (Doc 07 family)** | `event-schema-registry`, `kpi-registry`, `dashboard-registry`, `experiment-registry`, `sat-test-calendar`, `system-state-archive-registry` |

`route-surface-classification.yaml` is worth flagging to whoever takes E1: Doc
06A §5.3 makes it the declared home of the per-route surface classification
that gating analytics off student-facing routes would otherwise have to
re-derive in application code.
