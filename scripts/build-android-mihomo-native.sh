#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <abi> <output-directory>" >&2
  exit 2
fi

ABI="$1"
OUT_DIR="$2"
case "$ABI" in
  arm64-v8a)
    GOARCH="arm64"
    CC_NAME="aarch64-linux-android24-clang"
    GOARM=""
    ;;
  armeabi-v7a)
    GOARCH="arm"
    CC_NAME="armv7a-linux-androideabi24-clang"
    GOARM="7"
    ;;
  x86_64)
    GOARCH="amd64"
    CC_NAME="x86_64-linux-android24-clang"
    GOARM=""
    ;;
  *)
    echo "Unsupported Android ABI: $ABI" >&2
    exit 2
    ;;
esac

WORKSPACE_ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
NDK_VERSION="28.0.13004108"
ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT:-${ANDROID_NDK_HOME:-${ANDROID_HOME}/ndk/${NDK_VERSION}}}"
MIHOMO_COMMIT="88dcbf7f1614a67c3b36b848ee3592dfa92ada36"
MIHOMO_VERSION="1.19.32"
NDK_BIN="${ANDROID_NDK_ROOT}/toolchains/llvm/prebuilt/linux-x86_64/bin"
CC_PATH="${NDK_BIN}/${CC_NAME}"
BRIDGE_PATH="${WORKSPACE_ROOT}/native/android/mihomo-bridge/bridge.go"

command -v git >/dev/null
git --version
command -v go >/dev/null
go version
test -x "$CC_PATH"
test -s "$BRIDGE_PATH"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/angelanexus-mihomo-src.XXXXXX")"
trap 'rm -rf "$SOURCE_DIR"' EXIT

printf 'Fetching Mihomo source commit %s for %s\n' "$MIHOMO_COMMIT" "$ABI"
git clone --no-checkout https://github.com/MetaCubeX/mihomo.git "$SOURCE_DIR"
git -C "$SOURCE_DIR" fetch --depth 1 origin "$MIHOMO_COMMIT"
git -C "$SOURCE_DIR" checkout --detach "$MIHOMO_COMMIT"
SOURCE_HEAD="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
test "$SOURCE_HEAD" = "$MIHOMO_COMMIT"
cp "$BRIDGE_PATH" "$SOURCE_DIR/angelanexus_android_bridge.go"
(
  cd "$SOURCE_DIR"
  gofmt -w ./angelanexus_android_bridge.go
  test -z "$(gofmt -d ./angelanexus_android_bridge.go)"
  export GOOS=android GOARCH="$GOARCH" CGO_ENABLED=1 CC="$CC_PATH"
  if [[ -n "$GOARM" ]]; then export GOARM; fi
  go build \
    -trimpath \
    -ldflags="-w -s -X github.com/metacubex/mihomo/constant.Version=v${MIHOMO_VERSION}" \
    -tags="with_gvisor,cmfa" \
    -buildmode=c-shared \
    -o "$OUT_DIR/libclash.so" \
    .
)
test -s "$OUT_DIR/libclash.so"
file "$OUT_DIR/libclash.so"
nm -D --defined-only "$OUT_DIR/libclash.so" | grep -E 'angelaInit|angelaApplyConfig|startTUN|stopTun|suspend|forceGC|getTraffic|getTotalTraffic|freeCString'

ARTIFACT_SHA256="$(sha256sum "$OUT_DIR/libclash.so" | awk '{print $1}')"
BRIDGE_SHA256="$(sha256sum "$BRIDGE_PATH" | awk '{print $1}')"
GO_VERSION="$(go version | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
COMPILER_VERSION="$("$CC_PATH" --version | head -n 1 | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
export ABI GOARCH GOARM MIHOMO_COMMIT MIHOMO_VERSION NDK_VERSION SOURCE_HEAD ARTIFACT_SHA256 BRIDGE_SHA256 GO_VERSION COMPILER_VERSION
python3 - "$OUT_DIR/mihomo-provenance.json" <<'PY'
import json
import os
import sys
from pathlib import Path

abi = os.environ["ABI"]
record = {
    "version": 1,
    "kernel": "mihomo",
    "kernelVersion": os.environ["MIHOMO_VERSION"],
    "source": {
        "repository": "https://github.com/MetaCubeX/mihomo",
        "commit": os.environ["SOURCE_HEAD"],
    },
    "platform": "android",
    "abi": abi,
    "toolchain": {
        "go": os.environ["GO_VERSION"],
        "androidNdk": os.environ["NDK_VERSION"],
        "compiler": os.environ["COMPILER_VERSION"],
        "goos": "android",
        "goarch": os.environ["GOARCH"],
        "goarm": os.environ["GOARM"] or None,
        "cgoEnabled": True,
    },
    "build": {
        "trimpath": True,
        "buildmode": "c-shared",
        "tags": ["with_gvisor", "cmfa"],
        "versionLdflag": "github.com/metacubex/mihomo/constant.Version=v"
        + os.environ["MIHOMO_VERSION"],
    },
    "bridge": {
        "path": "native/android/mihomo-bridge/bridge.go",
        "sha256": os.environ["BRIDGE_SHA256"],
    },
    "artifact": {
        "name": "libclash.so",
        "sha256": os.environ["ARTIFACT_SHA256"],
    },
}
Path(sys.argv[1]).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
cat "$OUT_DIR/mihomo-provenance.json"
