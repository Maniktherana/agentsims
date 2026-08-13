#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/../.." && pwd)"
OUT_DIR="${1:-$PKG/dist/native}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required; install Rust from https://rustup.rs" >&2
  exit 1
fi

if [ -z "${FFMPEG_DIR:-}" ]; then
  if command -v brew >/dev/null 2>&1 && brew --prefix ffmpeg >/dev/null 2>&1; then
    FFMPEG_DIR="$(brew --prefix ffmpeg)"
  else
    FFMPEG_DIR="/usr"
  fi
fi
export FFMPEG_DIR
if [ ! -d "$FFMPEG_DIR/include/libavcodec" ] || [ ! -d "$FFMPEG_DIR/lib" ]; then
  echo "FFmpeg development headers and libraries were not found under $FFMPEG_DIR" >&2
  echo "Install FFmpeg or set FFMPEG_DIR to its prefix" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  SDKROOT="${SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}"
  export SDKROOT
  export BINDGEN_EXTRA_CLANG_ARGS="${BINDGEN_EXTRA_CLANG_ARGS:--isysroot $SDKROOT}"
  LIBRARY="$HERE/target/release/libagentsims_android_video.dylib"
else
  LIBRARY="$HERE/target/release/libagentsims_android_video.so"
fi

cargo build --release --manifest-path "$HERE/Cargo.toml"
mkdir -p "$OUT_DIR"
cp "$LIBRARY" "$OUT_DIR/agentsims-android-video.node"

if [ "$(uname -s)" = "Darwin" ]; then
  install_name_tool -id "@rpath/agentsims-android-video.node" \
    "$OUT_DIR/agentsims-android-video.node"
  strip -x "$OUT_DIR/agentsims-android-video.node"
fi

echo "Built: $OUT_DIR/agentsims-android-video.node"
