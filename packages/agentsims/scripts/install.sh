#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Agentsims install failed: %s\n' "$1" >&2
  exit 1
}

add_to_path=0
profile=${AGENTSIMS_SHELL_PROFILE:-}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-to-path) add_to_path=1 ;;
    --help)
      printf 'Usage: bash install.sh [--add-to-path]\n'
      printf 'Install the runtime. Use --add-to-path to update the shell profile.\n'
      exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=darwin-arm64 ;;
  Darwin-x86_64) target=darwin-x64 ;;
  Linux-x86_64) target=linux-x64 ;;
  *) fail "This platform has no Agentsims release." ;;
esac

version=__AGENTSIMS_RELEASE_VERSION__
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
  fail "The release version is invalid."

install_root=${AGENTSIMS_INSTALL_DIR:-$HOME/.agentsims}
mkdir -p "$install_root/versions" "$install_root/bin"
install_root=$(cd "$install_root" && pwd -P)
release_dir="$install_root/versions/$version"
download_dir=
stage_dir=
activation_dir=
new_release=
launcher_created=0
activated=0
lock_owned=0
cleanup() {
  status=$?
  trap - EXIT
  set +e
  if [[ "$status" != 0 && "$activated" == 0 ]]; then
    [[ -z "$new_release" ]] || rm -rf -- "$new_release"
    [[ "$launcher_created" == 0 ]] || rm -f -- "$install_root/bin/agentsims"
  fi
  [[ -z "$download_dir" ]] || rm -rf -- "$download_dir"
  [[ -z "$stage_dir" ]] || rm -rf -- "$stage_dir"
  [[ -z "$activation_dir" ]] || rm -rf -- "$activation_dir"
  [[ "$lock_owned" == 0 ]] || rmdir "$install_root/.install-lock"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$install_root/.install-lock" 2>/dev/null ||
  fail "The install lock exists. Finish the other installation, then try again: $install_root/.install-lock"
lock_owned=1

valid_release() {
  [[ -x "$1/dist/agentsims" && -s "$1/LICENSE" &&
     -s "$1/dist/preview/index.html" &&
     -s "$1/dist/android/agentsims-ax-server.jar" ]] || return 1
  if [[ "$target" == darwin-* ]]; then
    [[ -s "$1/dist/native/agentsims-native.node" &&
       -s "$1/dist/simcam/libSimCameraInjector.dylib" &&
       -s "$1/dist/simcam/agentsims-camera-helper" &&
       -x "$1/dist/simcam/agentsims-camera-helper" &&
       -s "$1/dist/simax/agentsims-ax-settings" &&
       -x "$1/dist/simax/agentsims-ax-settings" ]] || return 1
  fi
  [[ "$("$1/dist/agentsims" --version 2>/dev/null)" == "$version" ]]
}

[[ ! -L "$release_dir" ]] || fail "The version directory is a symlink: $release_dir"
if ! valid_release "$release_dir"; then
  [[ ! -e "$release_dir" ]] ||
    fail "The existing version is incomplete. It was not changed: $release_dir"
  stage_dir=$(mktemp -d "$install_root/versions/.install.XXXXXXXX")
  command -v curl >/dev/null || fail "Install curl and try again."
  download_dir=$(mktemp -d "${TMPDIR:-/tmp}/agentsims-download.XXXXXXXX")
  archive="agentsims-$target.tar.gz"
  base="https://github.com/Maniktherana/agentsims/releases/download/v$version"
  curl -fsSL --retry 3 "$base/$archive" -o "$download_dir/$archive"
  curl -fsSL --retry 3 "$base/SHA256SUMS" -o "$download_dir/SHA256SUMS"
  expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$download_dir/SHA256SUMS")
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "The archive checksum is missing."
  if command -v shasum >/dev/null; then
    actual=$(shasum -a 256 "$download_dir/$archive" | awk '{ print $1 }')
  elif command -v sha256sum >/dev/null; then
    actual=$(sha256sum "$download_dir/$archive" | awk '{ print $1 }')
  else
    fail "Install shasum or sha256sum and try again."
  fi
  [[ "$actual" == "$expected" ]] || fail "The archive checksum does not match."
  tar -xzf "$download_dir/$archive" -C "$stage_dir"
  valid_release "$stage_dir" || fail "The runtime files are incomplete or have the wrong version."
  mv "$stage_dir" "$release_dir"
  stage_dir=
  new_release=$release_dir
fi

if [[ -e "$install_root/current" && ! -L "$install_root/current" ]]; then
  fail "The current release path is not a symlink: $install_root/current"
fi
[[ ! -L "$install_root/bin/agentsims" && ! -d "$install_root/bin/agentsims" ]] ||
  fail "The command path is a symlink or directory: $install_root/bin/agentsims"
activation_dir=$(mktemp -d "$install_root/.activate.XXXXXXXX")
next_link="$activation_dir/current"
ln -s "versions/$version" "$next_link"

next_launcher="$activation_dir/agentsims"
cat > "$next_launcher" <<'LAUNCHER'
#!/bin/sh
bin_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
exec "$bin_dir/../current/dist/agentsims" "$@"
LAUNCHER
chmod 755 "$next_launcher"
[[ -e "$install_root/bin/agentsims" ]] || launcher_created=1
mv -f "$next_launcher" "$install_root/bin/agentsims"
if [[ "$target" == darwin-* ]]; then
  mv -fh "$next_link" "$install_root/current"
else
  mv -fT "$next_link" "$install_root/current"
fi
activated=1

profile_updated=0
if [[ "$add_to_path" == 1 ]]; then
  if [[ -z "$profile" ]]; then
    case "${SHELL:-}" in
      */zsh) profile="$HOME/.zshrc" ;;
      */bash) profile="$HOME/.bashrc" ;;
      *) printf 'PATH was not updated. Add this directory to PATH: %s/bin\n' "$install_root" >&2 ;;
    esac
  fi
  if [[ -n "$profile" ]]; then
    printf -v path_entry 'export PATH=%q:"$PATH"' "$install_root/bin"
    if [[ -f "$profile" ]] && grep -Fxq "$path_entry" "$profile"; then
      profile_updated=1
    elif printf '\n# Agentsims PATH\n%s\n' "$path_entry" >> "$profile"; then
      profile_updated=1
    else
      printf 'PATH was not updated. Add this directory to PATH: %s/bin\n' "$install_root" >&2
    fi
  fi
fi

if [[ "${AGENTSIMS_INSTALL_QUIET:-}" != 1 ]]; then
  printf 'Installed Agentsims %s in %s\n' "$version" "$install_root" >&2
  printf 'Command: %s/bin/agentsims\n' "$install_root" >&2
  if [[ ":$PATH:" != *":$install_root/bin:"* ]]; then
    if [[ "$profile_updated" == 1 ]]; then
      printf 'Open a new terminal to use the updated PATH.\n' >&2
    else
      printf 'Add this directory to PATH: %s/bin\n' "$install_root" >&2
    fi
  fi
  printf 'Next: agentsims doctor\n' >&2
fi
