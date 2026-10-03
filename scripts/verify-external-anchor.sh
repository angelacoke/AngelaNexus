#!/usr/bin/env bash
set -euo pipefail

ANCHOR="docs/ANGELANEXUS_EXTERNAL_ANCHOR.json"
PAYLOAD="docs/ANGELANEXUS_EXTERNAL_ANCHOR_PAYLOAD.json"
EXPECTED_FOUNDATION="4f047d7a53ef7db1d18174916ea9ed5cacbd8133"
EXPECTED_DNA="da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e"
EXPECTED_PAYLOAD_SHA="1f69492e1bd9e5771faf218bc822081e369c5b5b5dcd66a5def4e5570fba690e"

test -f "$ANCHOR"
test -f "$PAYLOAD"

python3 - "$ANCHOR" "$PAYLOAD" "$EXPECTED_FOUNDATION" "$EXPECTED_DNA" "$EXPECTED_PAYLOAD_SHA" <<'PY'
import hashlib, json, sys
anchor_path, payload_path, expected_foundation, expected_dna, expected_payload_sha = sys.argv[1:]

with open(anchor_path, encoding="utf-8") as f:
    anchor = json.load(f)
with open(payload_path, encoding="utf-8") as f:
    payload = json.load(f)

assert anchor["schema"] == "AN-ANCHOR/v1"
assert anchor["project"] == "AngelaNexus"
assert anchor["root_repository"] == "angelacoke/AngelaNexus"
assert anchor["foundation_path"] == "docs/ANGELANEXUS_FOUNDATION.md"
assert anchor["foundation_blob_sha"] == expected_foundation
assert anchor["dna_id"] == expected_dna
assert anchor["canonical_payload_path"] == payload_path

with open(payload_path, "rb") as f:
    actual_payload_sha = hashlib.sha256(f.read()).hexdigest()
assert actual_payload_sha == expected_payload_sha
assert anchor["canonical_payload_sha256"] == actual_payload_sha

assert payload["schema"] == "AN-ANCHOR/v1"
assert payload["project"] == "AngelaNexus"
assert payload["root_repository"] == "angelacoke/AngelaNexus"
assert payload["foundation_path"] == "docs/ANGELANEXUS_FOUNDATION.md"
assert payload["foundation_blob_sha"] == expected_foundation
assert payload["dna_id"] == expected_dna

trust = anchor["trust_boundary"]
assert trust["local_repository_is_not_anchor"] is True
assert trust["external_anchor_required_for_strong_identity"] is True
assert trust["fail_closed_when_anchor_is_declared"] is True

status = anchor["status"]
if status == "pending_external_publication":
    print("EXTERNAL_ANCHOR=PASS_PENDING_EXTERNAL_PUBLICATION")
elif status == "active":
    source = anchor.get("external_source")
    signature = anchor.get("external_signature")
    assert source and signature, "Active external anchor requires source and signature metadata."
    print("EXTERNAL_ANCHOR=ACTIVE_DECLARATION_VALID")
else:
    raise AssertionError(f"Unsupported anchor status: {status!r}")

print(f"FOUNDATION_ROOT={expected_foundation}")
print(f"FOUNDATION_DNA_ID={expected_dna}")
print(f"ANCHOR_PAYLOAD_SHA256={actual_payload_sha}")
PY
