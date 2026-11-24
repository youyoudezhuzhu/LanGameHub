#!/usr/bin/env bash
set -euo pipefail

project=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out=${1:?Usage: prepare.sh OUTPUT_DIRECTORY}
sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
: "${sdk:?Set ANDROID_HOME to the Android SDK}"
ndk=${HUB_NDK_PATH:-"$sdk/ndk/28.2.13676358"}
case "$(uname -s)" in
  Linux) toolchain="$ndk/toolchains/llvm/prebuilt/linux-x86_64" ;;
  Darwin) toolchain="$ndk/toolchains/llvm/prebuilt/darwin-x86_64" ;;
  *) echo 'Use a Linux or macOS build host.' >&2; exit 1 ;;
esac
mobile_version=18.20.4
archive_hash=bd7321eaa1a7602fbe0bb87302df2d79d87835cf4363fbdd17c350dbb485c2af
cache=${HUB_BUILD_CACHE:-"$project/.tools"}
mkdir -p "$cache"
archive="$cache/nodejs-mobile-v$mobile_version-android.zip"
if [[ ! -s "$archive" ]]; then
  temporary=$(mktemp "$cache/node-mobile.XXXXXX")
  trap 'rm -f "$temporary"' EXIT
  curl -fLSs --retry 3 "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v$mobile_version/nodejs-mobile-v$mobile_version-android.zip" -o "$temporary"
  mv "$temporary" "$archive"
  trap - EXIT
fi
actual=$(openssl dgst -sha256 "$archive" | awk '{print $NF}')
if [[ "$actual" != "$archive_hash" ]]; then
  echo 'Node.js Mobile archive checksum mismatch.' >&2
  exit 1
fi
pvz_source=""
if [[ -n "${HUB_PVZ_WEB_DIR:-}" ]]; then
  pvz_source=$(cd "$HUB_PVZ_WEB_DIR" && pwd -P)
fi
saltline_source=""
if [[ -n "${HUB_SALTLINE_SOURCE:-}" ]]; then
  saltline_source=$(cd "$HUB_SALTLINE_SOURCE" && pwd -P)
fi
cd "$project/games/deskpark"
if [[ "${HUB_SKIP_NPM_CI:-0}" != 1 ]]; then
  npm ci --no-audit --no-fund
fi
npm run build

mkdir -p "$out/generated/hub-assets"
assets="$out/generated/hub-assets/hub"
case "$pvz_source" in
  "$assets"|"$assets"/*) echo 'Keep your PvZ input outside generated APK assets.' >&2; exit 1 ;;
esac
case "$saltline_source" in
  "$assets"|"$assets"/*) echo 'Keep your Saltline source outside generated APK assets.' >&2; exit 1 ;;
esac
rm -rf "$assets"
mkdir -p "$assets/web/licenses"
cp -R apps/web/dist/. "$assets/web/"
cp apps/server/dist/main.js "$assets/server.mjs"
cp "$project"/licenses/*.txt "$assets/web/licenses/"
cp LICENSE "$assets/web/licenses/DeskPark.txt"
node "$project/scripts/licenses.mjs" "$assets/web/licenses/npm.txt"
if [[ -n "$pvz_source" ]]; then
  node "$project/scripts/stage-pvz.mjs" "$pvz_source" "$assets/web"
fi

if [[ -n "$saltline_source" ]]; then
  node "$project/scripts/stage-saltline.mjs" "$saltline_source" "$assets"
fi

for abi in arm64-v8a x86_64; do
  case "$abi" in
    arm64-v8a) target=aarch64-linux-android ;;
    x86_64) target=x86_64-linux-android ;;
  esac
  destination="$out/generated/hub-jni/$abi"
  mkdir -p "$destination"
  unzip -p "$archive" "bin/$abi/libnode.so" > "$destination/libnode.so"
  cp "$toolchain/sysroot/usr/lib/$target/libc++_shared.so" "$destination/"
  "$toolchain/bin/${target}26-clang" -fPIC -shared -Wl,-z,defs \
    "$project/android/app/src/main/cpp/node_bridge.c" \
    -L"$destination" -lnode -o "$destination/libhub_node_bridge.so"
  "$toolchain/bin/llvm-strip" --strip-unneeded "$destination/"*.so
done
