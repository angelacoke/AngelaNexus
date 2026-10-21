#!/usr/bin/env bash
set -euo pipefail
# Host Go tests of the native API, not Android JNI/device coverage.
WRAPPER=$(realpath "${WRAPPER:?set WRAPPER to the prepared libXray checkout}")
CORE=$(realpath "${CORE:?set CORE to the prepared sibling Xray-core checkout}")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export GOTOOLCHAIN=go1.27.1
[[ "$(go env GOVERSION)" == go1.27.1 ]]
[[ "$CORE" == "$(realpath "$WRAPPER/../Xray-core")" ]]
(cd "$WRAPPER" && go mod edit -replace=github.com/xtls/xray-core=../Xray-core)
python3 "$HERE/prepare-upstream.py" --wrapper "$WRAPPER" --core "$CORE" --verify-prepared

# Run the complete relevant upstream packages, including the previously racy
# TestTagsCache. Never select only our new tests or suppress a race report.
(cd "$CORE" && go test -race -count=3 -timeout=180s ./common/mux ./app/proxyman/outbound ./app/reverse ./proxy/vless/outbound)
(cd "$WRAPPER" && go test -race -count=3 -timeout=180s ./xray)
(cd "$WRAPPER" && go test -list '^TestAngelaNexusStopClosesMuxTransport$' ./xray) | grep -Fx 'TestAngelaNexusStopClosesMuxTransport'
(cd "$WRAPPER" && go test -race -count=3 -timeout=90s -run '^TestAngelaNexusStopClosesMuxTransport$' ./xray)

# Disposable copies retain the Manager/test race fixes and VLESS task join.
# Only the two mux implementation files are restored to the pinned old version.
NEGATIVE=$(mktemp -d)
trap 'rm -rf "$NEGATIVE"' EXIT
mkdir "$NEGATIVE/Xray-core" "$NEGATIVE/libXray"
tar -C "$CORE" --exclude=.git -cf - . | tar -C "$NEGATIVE/Xray-core" -xf -
tar -C "$WRAPPER" --exclude=.git -cf - . | tar -C "$NEGATIVE/libXray" -xf -
for rel in common/mux/client.go common/mux/session.go; do
  git -C "$CORE" show "b26a91de4f3294e26a0ad0a970b81a386a41f789:$rel" > "$NEGATIVE/Xray-core/$rel"
done
# Its sibling replacement resolves to the negative core, never the positive one.
(cd "$NEGATIVE/libXray" && go mod edit -replace=github.com/xtls/xray-core=../Xray-core)
LOG_DIR=${NEGATIVE_LOG_DIR:-"$WRAPPER/../negative-logs"}
mkdir -p "$LOG_DIR"
for attempt in 1 2 3; do
  log="$LOG_DIR/mux-old-$attempt.log"
  set +e
  (cd "$NEGATIVE/libXray" && go test -race -count=1 -timeout=45s -run '^TestAngelaNexusStopClosesMuxTransport$' ./xray) > "$log" 2>&1
  rc=$?
  set -e
  [[ $rc -ne 0 ]] || { echo "negative $attempt unexpectedly passed" >&2; exit 1; }
  if grep -Eiq 'DATA RACE|panic:|test timed out|build failed|cannot find package|no test files' "$log"; then
    cat "$log"; echo "negative $attempt failed for an unrelated reason" >&2; exit 1
  fi
  grep -Fq -- '--- FAIL: TestAngelaNexusStopClosesMuxTransport' "$log"
  grep -Eq 'VLESS mux peer timed out instead of observing real EOF|VLESS mux peer did not observe EOF' "$log" || {
    cat "$log"; echo "negative $attempt lacked the real peer EOF failure" >&2; exit 1;
  }
  echo "negative $attempt/3 intercepted pinned old mux close behavior"
done
python3 "$HERE/prepare-upstream.py" --wrapper "$WRAPPER" --core "$CORE" --verify-prepared
echo 'All pinned Xray host race and three mux-only negative gates passed'
