import os
import glob
import re
import json

base_dir = r"c:\Users\14438\projects\Lyceonai\docs"
md_files = glob.glob(os.path.join(base_dir, "**/*.md"), recursive=True)

canonical_markers = ["canonical", "supersedes", "source of truth", "authoritative", "contract", "invariant", "must", "governs"]
planning_markers = ["sprint", "tasks", "deliverables", "acceptance criteria", "ask prompt", "closure sprint", "objective", "checklist"]

results = []

for file_path in md_files:
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        continue
        
    content_lower = content.lower()
    
    can_matches = []
    plan_matches = []
    
    lines = content.split('\n')
    
    is_superseded = False
    is_archive = False
    is_draft = False
    
    for i, line in enumerate(lines):
        line_lower = line.lower()
        if any(m in line_lower for m in canonical_markers):
            can_matches.append((i+1, line.strip()))
        if any(m in line_lower for m in planning_markers):
            plan_matches.append((i+1, line.strip()))
            
        if "superseded" in line_lower or "deprecated" in line_lower:
            is_superseded = True
        if "archive" in line_lower:
            is_archive = True
        if "draft" in line_lower:
            is_draft = True
            
    # get title
    title = ""
    for line in lines:
        if line.startswith("# "):
            title = line[2:].strip()
            break
            
    # check references to other docs
    refs = re.findall(r'\[.*?\]\((.*?\.md)\)', content)
    
    results.append({
        "path": os.path.relpath(file_path, base_dir).replace('\\', '/'),
        "title": title,
        "can_count": len(can_matches),
        "plan_count": len(plan_matches),
        "is_superseded": is_superseded,
        "is_archive": is_archive,
        "is_draft": is_draft,
        "can_samples": [s[1] for s in can_matches[:2]],
        "plan_samples": [s[1] for s in plan_matches[:2]],
        "refs": refs
    })

with open("audit_output.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)
