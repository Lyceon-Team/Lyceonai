"""
Pass 2 SCL tagger — independent derivation using pattern analysis.
Reads: questions-ee.json, taxonomy-ref.json
Writes: pass-2-results.ndjson
"""
import json
import re
import sys

questions = json.load(open("questions-ee.json"))
taxonomy = json.load(open("taxonomy-ref.json"))

valid_sub_ids = {s["id"] for s in taxonomy["sub_skills"]}
valid_cluster_ids = {c["id"] for c in taxonomy["clusters"]}
cluster_by_id = {c["id"]: c for c in taxonomy["clusters"]}

def normalize(text):
    return re.sub(r'\s+', ' ', text.lower().strip())

def analyze_question(q):
    stem = q.get("stem", "")
    explanation = q.get("explanation", "")
    correct = q.get("correct_answer", "")
    options = q.get("options") or []
    item_type = q.get("item_type", "mcq")
    
    full_text = normalize(stem + " " + explanation)
    stem_n = normalize(stem)
    expl_n = normalize(explanation)
    
    correct_text = ""
    wrong_options = []
    for o in options:
        if o["key"] == correct:
            correct_text = normalize(o.get("text", ""))
        else:
            wrong_options.append(o)
    
    sub_skills = set()
    clusters = set()
    distractor_clusters = []
    
    # EE.1: Combine like terms
    if re.search(r'combin(e|ing)\s+like\s+terms|group(ing)?\s+(the\s+)?like\s+terms|collect(ing)?\s+like\s+terms', full_text):
        sub_skills.add("EE.1")
    if re.search(r'subtract(ing)?\s+.*polynomial|add(ing)?\s+.*polynomial', expl_n) and not re.search(r'factor|distribut', expl_n):
        sub_skills.add("EE.1")
    
    # EE.2: Expand / distribute / multiply polynomials
    if re.search(r'expand(ing|s)?|distribut(e|ing|es|ive)|foil|multiply(ing)?\s+(out|the|.*polynomial)', full_text):
        sub_skills.add("EE.2")
    if re.search(r'equivalent\s+(to|expression)', stem_n) and re.search(r'distribut|expand|multipl.*\(', expl_n):
        sub_skills.add("EE.2")
    
    # EE.3: Factor polynomials
    if re.search(r'factor(s|ed|ing|ize)?|difference\s+of\s+(two\s+)?squares|perfect[\s-]square\s+trinomial|sum\s+of\s+cubes|difference\s+of\s+cubes|grouping|gcf|greatest\s+common\s+factor|zero[\s-]product|complete(s|d|ing)?\s+the\s+square|vertex\s+form|which.*(is\s+a\s+)?factor', full_text):
        sub_skills.add("EE.3")
    
    # EE.4: Exponents and radicals
    if re.search(r'exponent\s+(rule|law)|power\s+rule|negative\s+exponent|fractional\s+exponent|rational\s+exponent|radical|\\sqrt|quotient\s+of\s+powers|simplif.*exponent', full_text):
        sub_skills.add("EE.4")
    if re.search(r'\^\{?-\d+\}?|\^\{?\d+/\d+\}?|\^\{?\\frac', stem):
        sub_skills.add("EE.4")
    
    # EE.5: Rational expressions
    if re.search(r'rational\s+expression|complex\s+fraction|for\s+all\s+values.*where.*defined|undefined\s+when|excluded\s+value', full_text):
        sub_skills.add("EE.5")
    if re.search(r'\\frac\{[^}]*[a-z][^}]*\}\{[^}]*[a-z][^}]*\}', stem):
        denom_match = re.search(r'\\frac\{[^}]+\}\{([^}]+)\}', stem)
        if denom_match and re.search(r'[\+\-]', denom_match.group(1)):
            sub_skills.add("EE.5")
    # Cancel common factor in explanation with variable fraction in stem
    if re.search(r'cancel', expl_n) and re.search(r'\\frac', stem):
        sub_skills.add("EE.5")
    
    # Cross-skill
    if re.search(r'in\s+terms\s+of|rewritten\s+in\s+the\s+form', full_text) and re.search(r'formula|equation.*two.*variable', full_text):
        sub_skills.add("NLE.1")
    if re.search(r'solve.*quadratic|zero-product.*solv|set.*equal.*zero.*solv', full_text):
        sub_skills.add("NLE.2")
    
    # === CLUSTERS ===
    if "EE.4" in sub_skills:
        clusters.add("CL.0006")
    if re.search(r'cancel', expl_n):
        clusters.add("CL.0008")
    if re.search(r'clear(ing)?\s+fractions|multiply.*common\s+denominator', expl_n):
        clusters.add("CL.0016")
    if re.search(r'combin(e|ing)\s+like\s+terms|collect\s+like|group\s+like', expl_n) or "EE.1" in sub_skills:
        clusters.add("CL.0017")
    if re.search(r'complet(e|ing|ed)\s+the\s+square', expl_n):
        clusters.add("CL.0020")
    if re.search(r'radical.*exponent|exponent.*radical|rational\s+exponent.*convert|convert.*radical', expl_n):
        clusters.add("CL.0030")
    if re.search(r'distribut(e|ing)\s+(the\s+)?negative|negative\s+sign.*distribut', expl_n):
        clusters.add("CL.0033")
    if re.search(r'distribut|foil', expl_n) or ("EE.2" in sub_skills and re.search(r'expand|multipl', expl_n)):
        clusters.add("CL.0034")
    if re.search(r'divid.*polynomial|polynomial.*division|synthetic\s+division', expl_n):
        clusters.add("CL.0035")
    if re.search(r'factor.*trinomial|trinomial.*factor', expl_n):
        clusters.add("CL.0037")
    if "EE.3" in sub_skills and re.search(r'x\^2.*[\+\-].*x.*[\+\-]|factor.*quadratic', expl_n):
        if not re.search(r'perfect.square|difference.of.squares|grouping|gcf|greatest.common', expl_n):
            clusters.add("CL.0037")
    if re.search(r'factor.*group|group.*factor', expl_n):
        clusters.add("CL.0038")
    if re.search(r'factor\s+out|gcf|greatest\s+common\s+factor', expl_n):
        clusters.add("CL.0039")
    if re.search(r'common\s+denominator|lcd', expl_n) or ("EE.5" in sub_skills and re.search(r'add.*fraction|subtract.*fraction', expl_n)):
        clusters.add("CL.0040")
    if re.search(r'isolat.*variable|solv.*for\s+[a-z]', expl_n):
        clusters.add("CL.0047")
    if re.search(r'match.*coefficient|compar.*coefficient|equat.*coefficient', expl_n):
        clusters.add("CL.0053")
    if re.search(r'rationaliz.*denominator', expl_n):
        clusters.add("CL.0069")
    if "EE.4" in sub_skills and re.search(r'negative\s+exponent|reciprocal', expl_n):
        clusters.add("CL.0079")
    if re.search(r'simplif.*radical|simplif.*square\s+root', expl_n):
        clusters.add("CL.0088")
    if re.search(r'difference\s+of\s+(two\s+)?squares|a\^2\s*-\s*b\^2', expl_n):
        clusters.add("CL.0164")
    if re.search(r'\(.*\+.*\)\s*\(.*-.*\)', expl_n) and re.search(r'factor', expl_n):
        clusters.add("CL.0164")
    if re.search(r'perfect[\s-]square\s+trinomial', expl_n):
        clusters.add("CL.0165")
    if re.search(r'zero(s|es)?\s+(from|of)\s+.*factor|set.*factor.*equal.*zero', expl_n):
        clusters.add("CL.0163")
    # Expanding then combining
    if "CL.0034" in clusters and re.search(r'combin|collect|simplif', expl_n):
        clusters.add("CL.0017")
    # Subtraction often needs sign distribution
    if re.search(r'subtract(ing)?\s+\(|subtract(ing)?\s+.*gives.*-', expl_n):
        clusters.add("CL.0033")
    
    # === DISTRACTOR CLUSTERS ===
    if item_type == "mcq" and options:
        for wo in wrong_options:
            wo_key = wo["key"]
            dc = None
            distractor_pat = rf'(?:distractor|choice)\s+(?:\$?\\text\{{{wo_key}\}}\$?|{wo_key})\s[^.]*'
            dm = re.search(distractor_pat, expl_n)
            if not dm:
                wo_t = normalize(wo.get("text","")[:30]).replace("\\","\\\\").replace("$","\\$")
                if wo_t:
                    dm2 = re.search(rf'\$?{re.escape(wo_t)}\$?[^.]*(?:result|come|aris|occur|incorrectly|error|mistake|fail)[^.]*', expl_n)
                    if dm2:
                        dm = dm2
            if dm:
                d_expl = dm.group(0)
                if re.search(r'sign\s+error|negative\s+sign|distribut.*negative|forgot.*negative|incorrect.*sign|wrong.*sign', d_expl):
                    dc = "CL.0033"
                elif re.search(r'fail.*factor|incorrect.*factor|wrong.*factor', d_expl):
                    dc = "CL.0037" if re.search(r'trinomial', d_expl) else ("CL.0164" if re.search(r'square', d_expl) else "CL.0039")
                elif re.search(r'fail.*cancel|didn.*cancel|incorrect.*cancel', d_expl):
                    dc = "CL.0008"
                elif re.search(r'like\s+terms|combin.*incorrect', d_expl):
                    dc = "CL.0017"
                elif re.search(r'distribut.*incorrect|distribut.*error|fail.*distribut|partial.*distribut', d_expl):
                    dc = "CL.0034"
                elif re.search(r'exponent.*error|exponent.*incorrect|wrong.*exponent|square\s+root', d_expl):
                    dc = "CL.0006"
                elif re.search(r'common\s+denominator|denominator.*error', d_expl):
                    dc = "CL.0040"
                elif re.search(r'coefficient', d_expl):
                    dc = "CL.0053"
            if dc and dc in valid_cluster_ids:
                distractor_clusters.append({"option_key": wo_key, "cluster_id": dc})
    
    # Fallback EE sub-skill
    if not any(s.startswith("EE.") for s in sub_skills):
        if re.search(r'factor', expl_n): sub_skills.add("EE.3")
        elif re.search(r'distribut|expand|multiply', expl_n): sub_skills.add("EE.2")
        elif re.search(r'exponent|radical|power', expl_n): sub_skills.add("EE.4")
        elif re.search(r'fraction.*variable|rational|denominator.*variable', expl_n): sub_skills.add("EE.5")
        elif re.search(r'like\s+terms|combin|simplif', expl_n): sub_skills.add("EE.1")
        else: sub_skills.add("EE.2")
    
    sub_skills = sorted(s for s in sub_skills if s in valid_sub_ids)
    clusters = sorted(c for c in clusters if c in valid_cluster_ids)
    if item_type != "mcq":
        distractor_clusters = []
    
    deriv = []
    if "EE.1" in sub_skills: deriv.append("combine like terms")
    if "EE.2" in sub_skills: deriv.append("expand/distribute")
    if "EE.3" in sub_skills: deriv.append("factor")
    if "EE.4" in sub_skills: deriv.append("exponent/radical rules")
    if "EE.5" in sub_skills: deriv.append("rational expression simplification")
    derivation = f"Solution uses: {', '.join(deriv)}. " + explanation[:120]
    
    return {
        "question_id": q["id"],
        "pass_id": "2",
        "sub_skill_ids": sub_skills,
        "cluster_ids": clusters,
        "distractor_clusters": distractor_clusters,
        "derivation_summary": derivation,
        "model_input_tokens": 0,
        "model_output_tokens": 0,
    }

results = []
for i, q in enumerate(questions):
    results.append(analyze_question(q))
    if (i + 1) % 50 == 0:
        print(f"Processed {i + 1}/{len(questions)}", file=sys.stderr)

with open("pass-2-results.ndjson", "w") as f:
    for r in results:
        f.write(json.dumps(r) + "\n")

print(f"\nPass 2 complete: {len(results)} questions", file=sys.stderr)

ee_dist = {}
for r in results:
    for s in r["sub_skill_ids"]:
        if s.startswith("EE."): ee_dist[s] = ee_dist.get(s, 0) + 1
cluster_dist = {}
for r in results:
    for c in r["cluster_ids"]: cluster_dist[c] = cluster_dist.get(c, 0) + 1
print(f"\nSub-skill distribution:", file=sys.stderr)
for k in sorted(ee_dist.keys()):
    print(f"  {k}: {ee_dist[k]}", file=sys.stderr)
print(f"\nTop clusters:", file=sys.stderr)
for k, v in sorted(cluster_dist.items(), key=lambda x: -x[1])[:15]:
    name = cluster_by_id.get(k, {}).get("display_name", "?")
    print(f"  {k} ({name}): {v}", file=sys.stderr)
dc_count = sum(1 for r in results if r["distractor_clusters"])
print(f"\nQuestions with distractor clusters: {dc_count}", file=sys.stderr)
