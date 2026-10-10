#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
ANDROID_NDK_VERSION="28.0.13004108"
ANDROID_NDK_HOME="${ANDROID_HOME}/ndk/${ANDROID_NDK_VERSION}"
LIBXRAY_COMMIT="3c694b23290f9849fe52284a345ebd4343bc90cd"
LIBXRAY_GOMOBILE_VERSION="v0.0.0-20260908204917-8b95e45f8d3e"
SINGBOX_REF="v1.14.2"
SINGBOX_COMMIT="af6e64c3b69e6132ebaee0e1a3d24e93903f6709"
SINGBOX_GOMOBILE_VERSION="v0.1.12"
APP_LIBS="${WORKSPACE_ROOT}/native/android/app/libs"

export ANDROID_HOME ANDROID_NDK_HOME
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
export LIBXRAY_GOMOBILE_VERSION

SDKMANAGER="$(find "$ANDROID_HOME/cmdline-tools" -type f -name sdkmanager | sort | tail -n 1)"
test -x "$SDKMANAGER"
"$SDKMANAGER" "ndk;${ANDROID_NDK_VERSION}"
test -d "$ANDROID_NDK_HOME"

command -v go >/dev/null
go version

go install "github.com/sagernet/gomobile/cmd/gomobile@${SINGBOX_GOMOBILE_VERSION}"
go install "github.com/sagernet/gomobile/cmd/gobind@${SINGBOX_GOMOBILE_VERSION}"
export PATH="$(go env GOPATH)/bin:$PATH"
gomobile init

mkdir -p "$APP_LIBS"
rm -f "$APP_LIBS/libXray.aar" "$APP_LIBS/libbox.aar" "$APP_LIBS/libbox-legacy.aar"

LIBXRAY_DIR="${RUNNER_TEMP:-/tmp}/libXray"
git clone --no-checkout https://github.com/XTLS/libXray.git "$LIBXRAY_DIR"
git -C "$LIBXRAY_DIR" fetch origin "$LIBXRAY_COMMIT"
git -C "$LIBXRAY_DIR" checkout --detach "$LIBXRAY_COMMIT"
test "$(git -C "$LIBXRAY_DIR" rev-parse HEAD)" = "$LIBXRAY_COMMIT"
(
  cd "$LIBXRAY_DIR"
  python3 build/main.py android
  test -s libXray.aar
  cp libXray.aar "$APP_LIBS/libXray.aar"
)

SINGBOX_DIR="${RUNNER_TEMP:-/tmp}/sing-box"
git clone --depth 1 --branch "$SINGBOX_REF" https://github.com/SagerNet/sing-box.git "$SINGBOX_DIR"
test "$(git -C "$SINGBOX_DIR" rev-parse HEAD)" = "$SINGBOX_COMMIT"
test "$(git -C "$SINGBOX_DIR" describe --tags --exact-match)" = "$SINGBOX_REF"
(
  cd "$SINGBOX_DIR"
  go run ./cmd/internal/build_libbox -target android
  test -s libbox.aar
  test -s libbox-legacy.aar
  cp libbox.aar "$APP_LIBS/libbox.aar"
  cp libbox-legacy.aar "$APP_LIBS/libbox-legacy.aar"
)

python3 "$WORKSPACE_ROOT/scripts/deduplicate-libxray-aar.py" "$APP_LIBS/libXray.aar"
unzip -t "$APP_LIBS/libXray.aar" >/dev/null
unzip -t "$APP_LIBS/libbox.aar" >/dev/null
unzip -t "$APP_LIBS/libbox-legacy.aar" >/dev/null

LIBXRAY_CLASSES="${RUNNER_TEMP:-/tmp}/libXray-classes.jar"
LIBBOX_CLASSES="${RUNNER_TEMP:-/tmp}/libbox-classes.jar"
unzip -p "$APP_LIBS/libXray.aar" classes.jar > "$LIBXRAY_CLASSES"
unzip -p "$APP_LIBS/libbox.aar" classes.jar > "$LIBBOX_CLASSES"
! jar tf "$LIBXRAY_CLASSES" | grep -q '^go/'
jar tf "$LIBBOX_CLASSES" | grep -q '^go/Seq.class$'

printf 'libXray source commit: %s\n' "$LIBXRAY_COMMIT"
printf 'sing-box source ref: %s (%s)\n' "$SINGBOX_REF" "$SINGBOX_COMMIT"
printf 'Android NDK: %s\n' "$ANDROID_NDK_VERSION"
sha256sum "$APP_LIBS/libXray.aar" "$APP_LIBS/libbox.aar" "$APP_LIBS/libbox-legacy.aar"
echo 'Pinned Android kernel AARs built and validated in this job workspace.'
