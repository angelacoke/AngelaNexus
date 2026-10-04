#!/usr/bin/env bash
set -euo pipefail

MANIFEST="docs/ANGELANEXUS_FOUNDATION_DNA.json"
FOUNDATION="docs/ANGELANEXUS_FOUNDATION.md"
CONSTITUTION="docs/ANGELANEXUS_CONSTITUTION.md"
EXPECTED_FOUNDATION_BLOB="4f047d7a53ef7db1d18174916ea9ed5cacbd8133"
EXPECTED_DNA_ID="da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e"

test -f "$MANIFEST"
test -f "$FOUNDATION"
test -f "$CONSTITUTION"
actual_foundation="$(git rev-parse "HEAD:$FOUNDATION")"
test "$actual_foundation" = "$EXPECTED_FOUNDATION_BLOB"

python3 - "$MANIFEST" "$EXPECTED_FOUNDATION_BLOB" "$EXPECTED_DNA_ID" <<'PY'
import hashlib, json, sys

manifest_path, expected_root, expected_dna = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as f:
    data = json.load(f)

def req(path, actual, expected):
    if actual != expected:
        raise SystemExit(f"FOUNDATION_DNA=FAIL: {path}: expected={expected!r} actual={actual!r}")

req("schema", data.get("schema"), "AN-DNA/v2")
req("gene_schema", data.get("gene_schema"), "AN-GENE/v1")
req("project", data.get("project"), "AngelaNexus")
req("identity", data.get("identity"), "AngelaNexus")

root = data.get("foundation_root")
req("foundation_root.path", root.get("path") if isinstance(root, dict) else None, "docs/ANGELANEXUS_FOUNDATION.md")
req("foundation_root.git_blob_sha", root.get("git_blob_sha") if isinstance(root, dict) else None, expected_root)

gene = data.get("gene")
if not isinstance(gene, dict):
    raise SystemExit("FOUNDATION_DNA=FAIL: gene is missing")
for key in ("purpose","immutable_root_goals","evolution_principle","compatibility_dimensions","root_conflict_definition","forbidden_root_conflicts"):
    if key not in gene:
        raise SystemExit(f"FOUNDATION_DNA=FAIL: gene.{key} is missing")
if not gene["immutable_root_goals"] or not gene["compatibility_dimensions"]:
    raise SystemExit("FOUNDATION_DNA=FAIL: gene contract lists must not be empty")

contract = data.get("inheritance_contract")
if not isinstance(contract, dict):
    raise SystemExit("FOUNDATION_DNA=FAIL: inheritance_contract is missing")
for key in ("default","fork","migration","split","implementation"):
    if not contract.get(key):
        raise SystemExit(f"FOUNDATION_DNA=FAIL: inheritance_contract.{key} is missing")

classification = data.get("change_classification")
if not isinstance(classification, dict) or not all(classification.get(k) for k in ("implementation","structural","root_goal_change")):
    raise SystemExit("FOUNDATION_DNA=FAIL: change_classification is incomplete")

verification = data.get("verification")
req("verification.foundation_gate_required", verification.get("foundation_gate_required"), True)
req("verification.inheritance_gate_required", verification.get("inheritance_gate_required"), True)
req("verification.gene_compatibility_required", verification.get("gene_compatibility_required"), True)
req("verification.fail_closed", verification.get("fail_closed"), True)

trust = data.get("trust_model")
req("trust_model.manifest_is_not_root_of_trust", trust.get("manifest_is_not_root_of_trust"), True)
req("trust_model.external_anchor_is_optional_evidence", trust.get("external_anchor_is_optional_evidence"), True)
req("trust_model.external_anchor_required_for_strong_identity", trust.get("external_anchor_required_for_strong_identity"), False)

payload=f"AngelaNexus|FOUNDATION|{expected_root}|v1".encode()
actual_dna=hashlib.sha256(payload).hexdigest()
req("dna_id", data.get("dna_id"), expected_dna)
req("computed_dna_id", actual_dna, expected_dna)

print("FOUNDATION_DNA=PASS")
print("FOUNDATION_GENE=PASS")
print(f"FOUNDATION_ROOT={expected_root}")
print(f"FOUNDATION_DNA_ID={actual_dna}")
PY
