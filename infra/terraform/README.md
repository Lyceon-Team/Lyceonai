# WS-G1 Phase 1 — Terraform for GCP declared state

Unblocks LISA by provisioning the two blockers (Model Armor templates +
Cloud Tasks OIDC SA) and importing three existing resources into
Terraform state.

**Karl runs everything. No CI involvement. No automation.**

---

## What Phase 1 creates and imports

| # | Resource | Type | What it does |
|---|----------|------|-------------|
| 1 | `google_project_service.modelarmor` | **create** | Enables the Model Armor API |
| 2 | `google_model_armor_template.input` | **create** | Input scanning template (prompt injection, RAI, malicious URI) |
| 3 | `google_model_armor_template.output` | **create** | Output scanning template (same + Sensitive Data Protection) |
| 4 | `google_service_account.cloud_tasks` | **create** | `lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com` |
| 5 | `google_cloud_run_v2_service_iam_member.cloud_tasks_invoker` | **create** | `roles/run.invoker` for the SA on `lyceon-tutor-orchestrator` |
| 6 | `google_bigquery_dataset.archive` | **import** | `lyceon_analytics_archive_prod` — existing dataset |
| 7 | `google_cloud_tasks_queue.crisis_notification` | **import** | `lisa-crisis-notification` — existing queue |
| 8 | `google_cloud_run_v2_service.tutor_orchestrator` | **import** | `lyceon-tutor-orchestrator` — CI-deployed service (Terraform manages IAM only) |

**Not in Phase 1:** Cloud Scheduler jobs, BigQuery tables, RAG corpus,
Phase 2 Cloud Tasks queues, floor settings.

---

## Model Armor template settings

### Input template (`lyceon-lisa-input-v1`)

| Filter | Setting | Source |
|--------|---------|--------|
| SEXUALLY_EXPLICIT | `LOW_AND_ABOVE` | Doc 03C V3 §5.7: "tighter given minor audience" |
| HARASSMENT | `MEDIUM_AND_ABOVE` | Doc 03C V3 §5.7: "avoid over-triggering on legitimate academic content" |
| HATE_SPEECH | `MEDIUM_AND_ABOVE` | Doc 03C V3 §5.7 |
| DANGEROUS | `MEDIUM_AND_ABOVE` | Doc 03C V3 §5.7 |
| Prompt injection + jailbreak | `ENABLED`, `LOW_AND_ABOVE` | Doc 03 §18.2 Layer 3 (Model Armor scanning) |
| Malicious URI | `ENABLED` | Defense-in-depth against prompt-injected URLs |

### Output template (`lyceon-lisa-output-v1`)

Same RAI and PI/jailbreak filters as input, plus:

| Filter | Setting | Source |
|--------|---------|--------|
| SDP (basic) | `ENABLED` | Doc 03 §18.2 Layer 4 — defense-in-depth for data leaking out. Basic config catches PII patterns. Deterministic PII guard (Doc 03C V3 §30.7) runs before Vertex; SDP is the safety net. |

### What's NOT included

- **Floor settings** — not in Phase 1. The `google_model_armor_floorsetting` resource has an
  [open destroy bug (#26214)](https://github.com/hashicorp/terraform-provider-google/issues/26214):
  settings remain active after `terraform destroy`. The fail-closed template approach is
  sufficient — if a template ID is missing, the code refuses to call Vertex unarmored
  (`vertex_model_armor_unconfigured`).

---

## Exact sequence — what Karl runs

### Prerequisites

- Terraform CLI installed (`>= 1.5.0`)
- `gcloud` CLI installed and authenticated
- Run `gcloud auth application-default login` (one-time — sets up ADC credentials)

### Step 0: Verify existing resources (before any Terraform)

Run these commands to get the ACTUAL config of the live resources.
Update the `.tf` files if any values differ from the defaults.

```bash
# BigQuery dataset — check the location (expected: "US")
bq show --format=prettyjson replit-cop:lyceon_analytics_archive_prod | jq .location

# Cloud Tasks queue — check rate limits and retry config
gcloud tasks queues describe lisa-crisis-notification \
  --location=us-central1 --format=json

# Cloud Run service — verify it exists and check the service account
gcloud run services describe lyceon-tutor-orchestrator \
  --region=us-central1 --format=json | jq '{name: .metadata.name, sa: .spec.template.spec.serviceAccountName}'
```

If any value differs from what's in the `.tf` files, update the HCL
to match reality BEFORE running `terraform plan`.

### Step 1: Create the GCS state bucket (one-time)

```bash
gcloud storage buckets create gs://lyceon-terraform-state \
  --project=replit-cop \
  --location=us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention=enforced

gcloud storage buckets update gs://lyceon-terraform-state \
  --versioning
```

### Step 2: Initialize Terraform

```bash
cd infra/terraform
terraform init
```

Expected output: "Terraform has been successfully initialized!"

If it fails with a backend error, the state bucket from Step 1 doesn't exist
or ADC doesn't have access.

### Step 3: Validate syntax

```bash
terraform validate
```

Expected: "Success! The configuration is valid."

If it fails, the error message names the exact file and line.

### Step 4: Plan (READ-ONLY — safe against production)

```bash
terraform plan -out=phase1.tfplan
```

`terraform plan` is **strictly read-only** with respect to infrastructure.
It reads state from GCS, refreshes resource state via Google API GET calls,
computes the diff, and outputs it. It never creates, modifies, or destroys
any cloud resource.

#### What a CORRECT plan looks like

```
Plan: 5 to add, 0 to change, 0 to destroy.
      3 to import.
```

The 5 "add" resources:
- `google_project_service.modelarmor`
- `google_model_armor_template.input`
- `google_model_armor_template.output`
- `google_service_account.cloud_tasks`
- `google_cloud_run_v2_service_iam_member.cloud_tasks_invoker`

The 3 "import" resources:
- `google_bigquery_dataset.archive`
- `google_cloud_tasks_queue.crisis_notification`
- `google_cloud_run_v2_service.tutor_orchestrator`

Each resource in the plan is prefixed with a symbol:
- `+` means **create** — new resource, expected for the 5 above
- `~` means **update in-place** — only expected if an imported resource's
  config was modified intentionally
- `-/+` means **destroy and recreate** — **STOP, something is wrong**
- `-` means **destroy** — **STOP, something is wrong**
- No prefix (just the resource block) means **import** — expected for the 3 above

#### What indicates something is WRONG

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plan shows **any** destroy (`-` or `-/+`) | HCL config differs from reality on a ForceNew attribute (e.g. `name`, `location`) | Update HCL to match the live resource exactly |
| Changes on `google_cloud_tasks_queue` | Rate limits or retry config don't match reality | Run the `gcloud tasks queues describe` command from Step 0 and copy the values |
| Changes on `google_bigquery_dataset` | Location mismatch | Run the `bq show` command from Step 0 |
| "Error: resource already exists" | A resource Terraform is trying to create already exists in GCP | Add an `import` block for it (e.g. if the SA already exists) |
| More than 5 creates or 3 imports | Unexpected — re-read the plan carefully |

### Step 5: Apply (PROVISIONS RESOURCES)

Only after the plan from Step 4 is correct:

```bash
terraform apply phase1.tfplan
```

This creates the 5 new resources and writes the 3 imported resources
into Terraform state. After apply, Terraform prints the outputs.

### Step 6: Get the output values

```bash
terraform output -json
```

### Step 7: Set the environment variables

After apply, set these env vars on the Cloud Run service and/or Vercel:

| Env var | Value (from Terraform output) | Where |
|---------|------|-------|
| `MODEL_ARMOR_INPUT_TEMPLATE_ID` | `model_armor_input_template_id` = `lyceon-lisa-input-v1` | Cloud Run + Vercel |
| `MODEL_ARMOR_OUTPUT_TEMPLATE_ID` | `model_armor_output_template_id` = `lyceon-lisa-output-v1` | Cloud Run + Vercel |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | `cloud_tasks_sa_email` = `lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com` | Cloud Run + Vercel |

Also set in `tutor_context_runtime_config` (Supabase):

| Key | Value |
|-----|-------|
| `model_armor_input_template_id` | `lyceon-lisa-input-v1` |
| `model_armor_output_template_id` | `lyceon-lisa-output-v1` |

The code accepts either the short template ID (`lyceon-lisa-input-v1`) or
the full resource name (`projects/replit-cop/locations/us-central1/templates/lyceon-lisa-input-v1`).
The short ID is preferred — `resolveModelArmorTemplateName()` expands it
at runtime using the project and location env vars.

### Step 8: Remove import blocks

After apply succeeds, the import blocks in `imports.tf` are no longer
needed. Remove them (or delete the file) and commit — leaving them is
harmless but noisy.

---

## Cloud Run — why Terraform doesn't manage the deployment

The `lyceon-tutor-orchestrator` service is deployed by Cloud Build (CI)
via `gcloud run deploy --source`. If Terraform managed the container image
and env vars, every CI deploy would create drift, and every `terraform apply`
would revert the deployment.

Instead:
- Terraform **imports** the service (knows it exists, has it in state)
- `lifecycle.ignore_changes` on `template`, `traffic`, etc. ensures
  Terraform never touches the deployment
- Terraform **does** manage IAM bindings on the service (iam.tf)
- `lifecycle.prevent_destroy` prevents accidental deletion

---

## What's NOT in Terraform (documented hybrid)

**Vertex AI RAG Corpus** — no Terraform resource exists for
`ragCorpora`. The provisioning script at
`scripts/provisioning/rag-corpus-create.ts` is the correct mechanism.
Terraform owns everything around it (service account, IAM, engine config
in Phase 3) but not the corpus itself.

---

## Phase 2 (future — after Phase 1 proves the workflow)

- BigQuery archive tables (×4) — `google_bigquery_table`
- Cloud Tasks queues (×3 new + import crisis queue already done)
- Cloud Scheduler jobs (×3) — retention sweep cron
- BigQuery IAM bindings
- Cloud Monitoring — log-based metric + alert policy (SCL-023 §3.4)

## Phase 3 (post-launch)

- `google_vertex_ai_rag_engine_config` (DB tier)
- Secret Manager entries if migrated from env vars
