#!/usr/bin/env bash
set -euo pipefail

MANIFEST="docs/ANGELANEXUS_FOUNDATION_DNA.json"
FOUNDATION="docs/ANGELANEXUS_FOUNDATION.md"
EXPECTED_FOUNDATION_BLOB="4f047d7a53ef7db1d18174916ea9ed5cacbd8133"
EXPECTED_DNA_ID="da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e"
test -f "$MANIFEST"
test -f "$FOUNDATION"
actual_foundation="$(git rev-parse "HEAD:$FOUNDATION")"
test "$actual_foundation" = "$EXPECTED_FOUNDATION_BLOB"
test -f "docs/ANGELANEXUS_CONSTITUTION.md"
test -f ".github/CODEOWNERS"
grep -Fq "Foundation DNA" docs/ANGELANEXUS_CONSTITUTION.md
grep -Fq "docs/ANGELANEXUS_FOUNDATION_DNA.json" .github/CODEOWNERS
python3 - "$MANIFEST" "$EXPECTED_FOUNDATION_BLOB" "$EXPECTED_DNA_ID" <<'PY'
import hashlib, json, sys
manifest_path, expected_root, expected_dna = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as f: data=json.load(f)
assert data["schema"] == "AN-DNA/v1"
assert data["project"] == data["identity"] == "AngelaNexus"
assert data["foundation_root"]["path"] == "docs/ANGELANEXUS_FOUNDATION.md"
assert data["foundation_root"]["git_blob_sha"] == expected_root
assert data["inheritance"]["required"] is True and data["inheritance"]["fork_is_not_exemption"] is True and data["inheritance"]["all_stakeholders_subject"] is True
assert data["verification"]["foundation_gate_required"] is True and data["verification"]["fail_closed"] is True
assert data["trust_model"]["manifest_is_not_root_of_trust"] is True and data["trust_model"]["external_anchor_required_for_strong_identity"] is True
payload=f"AngelaNexus|FOUNDATION|{expected_root}|v1".encode()
actual_dna=hashlib.sha256(payload).hexdigest()
assert actual_dna == expected_dna and data["dna_id"] == expected_dna
print("FOUNDATION_DNA=PASS")
print(f"FOUNDATION_ROOT={expected_root}")
print(f"FOUNDATION_DNA_ID={actual_dna}")
PY