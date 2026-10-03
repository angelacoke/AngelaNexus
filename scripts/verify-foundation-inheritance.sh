#!/usr/bin/env bash
set -euo pipefail

MANIFEST="docs/ANGELANEXUS_FOUNDATION_DNA.json"
FOUNDATION="docs/ANGELANEXUS_FOUNDATION.md"
ROOT_REPOSITORY="angelacoke/AngelaNexus"
EXPECTED_FOUNDATION_BLOB="4f047d7a53ef7db1d18174916ea9ed5cacbd8133"
EXPECTED_DNA_ID="da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e"

test -f "$MANIFEST"
test -f "$FOUNDATION"
test -f "docs/ANGELANEXUS_CONSTITUTION.md"

actual_foundation="$(git rev-parse "HEAD:$FOUNDATION")"
if [[ "$actual_foundation" != "$EXPECTED_FOUNDATION_BLOB" ]]; then
  echo "FOUNDATION_INHERITANCE=FAIL"
  echo "expected foundation blob: $EXPECTED_FOUNDATION_BLOB"
  echo "actual foundation blob:   $actual_foundation"
  exit 1
fi

python3 - "$MANIFEST" "$EXPECTED_FOUNDATION_BLOB" "$EXPECTED_DNA_ID" "$ROOT_REPOSITORY" <<'PY'
import hashlib, json, sys

manifest_path, expected_root, expected_dna, root_repo = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as f:
    data = json.load(f)

def require(label, actual, expected):
    if actual != expected:
        print(f"FOUNDATION_INHERITANCE=FAIL")
        print(f"{label}: expected={expected!r} actual={actual!r}")
        raise SystemExit(1)

require("schema", data.get("schema"), "AN-DNA/v1")
require("project", data.get("project"), "AngelaNexus")
require("identity", data.get("identity"), "AngelaNexus")

foundation = data.get("foundation_root")
require("foundation_root.path", foundation.get("path") if isinstance(foundation, dict) else None, "docs/ANGELANEXUS_FOUNDATION.md")
require("foundation_root.git_blob_sha", foundation.get("git_blob_sha") if isinstance(foundation, dict) else None, expected_root)

lineage = data.get("lineage")
if not isinstance(lineage, dict):
    print("FOUNDATION_INHERITANCE=FAIL")
    print("lineage: missing or not an object")
    raise SystemExit(1)

require("lineage.root_repository", lineage.get("root_repository"), root_repo)
role = lineage.get("role")
if role not in {"root", "fork", "derived", "migrated"}:
    print("FOUNDATION_INHERITANCE=FAIL")
    print(f"lineage.role: unsupported value {role!r}")
    raise SystemExit(1)

for section, fields in {
    "inheritance": {
        "required": True,
        "fork_is_not_exemption": True,
        "all_stakeholders_subject": True,
    },
    "verification": {
        "foundation_gate_required": True,
        "inheritance_gate_required": True,
        "fail_closed": True,
    },
    "trust_model": {
        "manifest_is_not_root_of_trust": True,
        "external_anchor_required_for_strong_identity": True,
    },
}.items():
    obj = data.get(section)
    if not isinstance(obj, dict):
        print("FOUNDATION_INHERITANCE=FAIL")
        print(f"{section}: missing or not an object")
        raise SystemExit(1)
    for key, expected in fields.items():
        require(f"{section}.{key}", obj.get(key), expected)

if role == "root":
    require("lineage.parent_repository", lineage.get("parent_repository"), None)
    require("lineage.parent_foundation_blob_sha", lineage.get("parent_foundation_blob_sha"), None)
    require("lineage.parent_dna_id", lineage.get("parent_dna_id"), None)
    require("parent", data.get("parent"), None)
else:
    parent_repo = lineage.get("parent_repository")
    if not isinstance(parent_repo, str) or not parent_repo:
        print("FOUNDATION_INHERITANCE=FAIL")
        print("lineage.parent_repository: required for descendant")
        raise SystemExit(1)
    require("lineage.parent_foundation_blob_sha", lineage.get("parent_foundation_blob_sha"), expected_root)
    require("lineage.parent_dna_id", lineage.get("parent_dna_id"), expected_dna)
    require("parent", data.get("parent"), parent_repo)

payload = f"AngelaNexus|FOUNDATION|{expected_root}|v1".encode()
actual_dna = hashlib.sha256(payload).hexdigest()
require("dna_id", data.get("dna_id"), expected_dna)
require("computed_dna_id", actual_dna, expected_dna)

print("FOUNDATION_INHERITANCE=PASS")
print(f"LINEAGE_ROLE={role}")
print(f"ROOT_REPOSITORY={root_repo}")
print("EXTERNAL_ANCHOR=REQUIRED_NOT_LOCAL_TRUST")
PY
