import json
import os

with open("audit_output.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Classification logic
for d in data:
    if d["is_archive"] or d["is_superseded"]:
        d["primary"] = "ARCHIVE_SUPERSEDED"
    elif d["plan_count"] > 0 and d["can_count"] == 0:
        d["primary"] = "MOVE_OUT_OF_CANONICAL_DOCS"
    elif d["plan_count"] > 0 and d["can_count"] > 0:
        if d["can_count"] > d["plan_count"] * 2:
            d["primary"] = "KEEP_IN_CANONICAL_DOCS"
        else:
            d["primary"] = "REVIEW_MANUALLY"
    elif d["can_count"] > 0:
        d["primary"] = "KEEP_IN_CANONICAL_DOCS"
    else:
        # No markers, infer from path/title
        if "QA" in d["title"] or "Checklist" in d["title"] or "pen-test" in d["path"] or "OPERATIONS" in d["path"]:
            d["primary"] = "MOVE_OUT_OF_CANONICAL_DOCS"
        else:
            d["primary"] = "REVIEW_MANUALLY"

    # Type mapping
    if "KEEP_IN_CANONICAL_DOCS" == d["primary"]:
        if "contract" in d["path"].lower():
            d["doc_type"] = "RUNTIME_CONTRACT"
        elif "truth" in d["path"].lower():
            d["doc_type"] = "SCHEMA_OR_DATA_CONTRACT"
        elif "runbook" in d["path"].lower() or "operations" in d["path"].lower():
            d["doc_type"] = "ORCHESTRATION_SPEC"
        elif "seo" in d["path"].lower() or "privacy" in d["path"].lower():
            d["doc_type"] = "COMPLIANCE_OR_POLICY_DOC"
        else:
            d["doc_type"] = "PRODUCT_SPEC"
    elif d["primary"] == "ARCHIVE_SUPERSEDED":
        d["doc_type"] = "LEGACY_OR_SUPERSEDED_SPEC"
    elif "pen-test" in d["path"] or "audit" in d["path"].lower():
        d["doc_type"] = "AUDIT_ARTIFACT"
    elif "qa" in d["path"].lower() or "checklist" in d["title"].lower():
        d["doc_type"] = "WORKFLOW_OR_SPRINT_ARTIFACT"
    elif d["primary"] == "REVIEW_MANUALLY":
        d["doc_type"] = "MIXED"
    else:
        d["doc_type"] = "WORKFLOW_OR_SPRINT_ARTIFACT"

md = []

md.append("# docs/* Classification Audit Report\n")
md.append("## 1. Summary\n")
md.append("- **Verdict on whether `docs/*` is currently only spec documents with runtime directions**: `FAIL`\n")
md.append("There are active sprint checklists, QA documents, implementation status trackers, security audits, and superseded documents mixed into the canonical docs structure.\n")

md.append("## 2. Inventory table\n")
md.append("| Path | Doc Type | Status | Primary Classification | Purpose |\n")
md.append("|---|---|---|---|---|\n")

for d in data:
    status = "Active"
    if d["is_archive"]: status = "Archived"
    if d["is_superseded"]: status = "Superseded"
    if d["is_draft"]: status = "Draft"
    purpose = d["title"] if d["title"] else os.path.basename(d["path"])
    md.append(f"| `{d['path']}` | `{d['doc_type']}` | {status} | `{d['primary']}` | {purpose} |")

md.append("\n## 3. Canonical keep set\n")
for d in data:
    if d["primary"] == "KEEP_IN_CANONICAL_DOCS":
        md.append(f"### `{d['path']}`\n")
        md.append(f"- **Why it qualifies**: High occurrence of canonical markers ({d['can_count']}).\n")
        if d["can_samples"]:
            md.append(f"- **Evidence**: Has explicit indicators like `{d['can_samples'][0]}`\n")

md.append("\n## 4. Move / archive / delete candidates\n")
for d in data:
    if d["primary"] != "KEEP_IN_CANONICAL_DOCS":
        md.append(f"### `{d['path']}`\n")
        md.append(f"- **Classification**: `{d['primary']}`\n")
        if d["primary"] == "ARCHIVE_SUPERSEDED":
            md.append("- **Why it does not qualify**: Explicitly marked as superseded or archived.\n")
        elif d["primary"] == "MOVE_OUT_OF_CANONICAL_DOCS":
            md.append("- **Why it does not qualify**: Predominantly sprint planning, operations, checklists, or audit artifacts.\n")
        else:
            md.append("- **Why it does not qualify**: Mixed content, manual review needed.\n")
        
        evidence_str = "Path context or no canonical markers."
        if d["plan_samples"]:
            evidence_str = f"Contains `{d['plan_samples'][0]}`"
        md.append(f"- **Evidence**: {evidence_str}\n")

md.append("\n## 5. Supersession and duplication map\n")
for d in data:
    if d["is_superseded"]:
        md.append(f"- **Older file**: `{d['path']}` -> **Newer replacement**: likely integrated into corresponding Source of Truth or Contract files. (See Evidence: marked superseded/deprecated)\n")

md.append("\n## 6. Future target docs structure\n")
md.append("""
* `docs/contracts/` - Only locked RUNTIME_CONTRACT and RUNTIME_LAW documents.
* `docs/sources-of-truth/` - Only schema, entitlement, and system SOURCE_OF_TRUTH documents.
* `docs/architecture/` - Specs and cross-cutting capabilities.
* `archive/` or `docs/archive/` - Move all superseded, legacy, and older audit files here.
* `ops/` or `docs/ops/` - Implementation checklists, sprint deliverables, operations runbooks.
* `compliance/` - Trust pages and retention policies.
""")

md.append("\n## 7. Findings\n")
md.append("### Finding 1: Mixed Artifacts in Practice\n")
md.append("- **Severity**: MEDIUM\n- **File**: `analytics-event-taxonomy.md` and others\n- **Issue**: Sprint deliverables mixed with canonical rules.\n- **Impact**: Makes it difficult to know if the document is an active contract or an old ticket description.\n- **Recommended Handling**: Move sprint notes to ops, keep canonical taxonomy.\n")

md.append("\n## 8. Final recommendation\n")
md.append("`ARCHIVE_NON_SPEC_DOCS_FIRST_THEN_DELETE`\n")

with open("report.md", "w", encoding="utf-8") as f:
    f.write("\n".join(md))
