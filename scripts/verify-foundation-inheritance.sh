#!/usr/bin/env bash
set -euo pipefail

MANIFEST="docs/ANGELANEXUS_FOUNDATION_DNA.json"
FOUNDATION="docs/ANGELANEXUS_FOUNDATION.md"
ROOT_REPOSITORY="angelacoke/AngelaNexus"
EXPECTED_FOUNDATION_BLOB="4f047d7a53ef7db1d18174916ea9ed5cacbd8133"
EXPECTED_DNA_ID="da14d8750b5f8af9a41902b752dca6dcc893bb866fdbc44b493c2a646e22c8e"

test -f "$MANIFEST"
test -f "$FOUNDATION"
test -f "docs/ANGELANEXUS_CONSTITUTION.md"

actual_foundation="$(git rev-parse "HEAD:$FOUNDATION")"
test "$actual_foundation" = "$EXPECTED_FOUNDATION_BLOB"

python3 - "$MANIFEST" "$EXPECTED_FOUNDATION_BLOB" "$EXPECTED_DNA_ID" "$ROOT_REPOSITORY" <<'PY'
import hashlib, json, sys

manifest_path, expected_root, expected_dna, root_repo = sys.argv[1:]

with open(manifest_path, encoding="utf-8") as f:
    data = json.load(f)

assert data["schema"] == "AN-DNA/v1"
assert data["project"] == data["identity"] == "AngelaNexus"
assert data["foundation_root"]["path"] == "docs/ANGELANEXUS_FOUNDATION.md"
assert data["foundation_root"]["git_blob_sha"] == expected_root

lineage = data["lineage"]
assert lineage["root_repository"] == root_repo
assert lineage["role"] in {"root", "fork", "derived", "migrated"}
assert data["inheritance"]["required"] is True
assert data["inheritance"]["fork_is_not_exemption"] is True
assert data["inheritance"]["all_stakeholders_subject"] is True
assert data["verification"]["foundation_gate_required"] is True
assert data["verification"]["inheritance_gate_required"] is True
assert data["verification"]["fail_closed"] is True
assert data["trust_model"]["manifest_is_not_root_of_trust"] is True
assert data["trust_model"]["external_anchor_required_for_strong_identity"] is True

role = lineage["role"]
if role == "root":
    assert lineage["parent_repository"] is None
    assert lineage["parent_foundation_blob_sha"] is None
    assert lineage["parent_dna_id"] is None
    assert data["parent"] is None
else:
    assert lineage["parent_repository"]
    assert lineage["parent_foundation_blob_sha"] == expected_root
    assert lineage["parent_dna_id"] == expected_dna
    assert data["parent"] == lineage["parent_repository"]

payload = f"AngelaNexus|FOUNDATION|{expected_root}|v1".encode()
actual_dna = hashlib.sha256(payload).hexdigest()
assert actual_dna == expected_dna == data["dna_id"]

print("FOUNDATION_INHERITANCE=PASS")
print(f"LINEAGE_ROLE={role}")
print(f"ROOT_REPOSITORY={root_repo}")
print("EXTERNAL_ANCHOR=REQUIRED_NOT_LOCAL_TRUST")
PY
