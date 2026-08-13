#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$PKG/dist/android/agentsims-ax-server.jar}"

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
for tool in javac jar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required; install a JDK and ensure its bin directory is on PATH" >&2
    exit 1
  fi
done
if [ ! -d "$SDK_ROOT/platforms" ] || [ ! -d "$SDK_ROOT/build-tools" ]; then
  echo "Android SDK platform and build-tools are required under $SDK_ROOT" >&2
  exit 1
fi
PLATFORM_JAR="$(find "$SDK_ROOT/platforms" -name android.jar -type f | sort -V | tail -1)"
D8="$(find "$SDK_ROOT/build-tools" -name d8 -type f | sort -V | tail -1)"
if [ -z "$PLATFORM_JAR" ] || [ -z "$D8" ]; then
  echo "Android SDK platform and build-tools are required" >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$(dirname "$OUT")"

javac \
  -source 8 \
  -target 8 \
  -cp "$PLATFORM_JAR" \
  -d "$BUILD_DIR/classes" \
  "$HERE/src/dev/agentsims/ax/Main.java"

jar cf "$BUILD_DIR/classes.jar" -C "$BUILD_DIR/classes" .

"$D8" \
  --lib "$PLATFORM_JAR" \
  --output "$BUILD_DIR/dex" \
  "$BUILD_DIR/classes.jar"

jar cf "$OUT" -C "$BUILD_DIR/dex" classes.dex
echo "Built: $OUT"
