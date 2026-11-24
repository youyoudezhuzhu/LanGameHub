#!/usr/bin/env bash
set -euo pipefail

project=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
: "${sdk:?Set ANDROID_HOME to the Android SDK}"
output=${1:-"$project/android/app/build/sdk/LAN-Game-Hub-debug.apk"}
mkdir -p "$(dirname "$output")"
output=$(cd "$(dirname "$output")" && pwd)/$(basename "$output")
tools="$sdk/build-tools/35.0.0"
android="$sdk/platforms/android-35/android.jar"
main="$project/android/app/src/main"
build="$project/android/app/build"
cache=${HUB_BUILD_CACHE:-"$project/.tools"}
mkdir -p "$cache"
zxing="$cache/zxing-core-3.5.3.jar"
if [[ ! -f "$zxing" ]]; then
  temporary=$(mktemp "$cache/zxing.XXXXXX")
  trap 'rm -f "$temporary"' EXIT
  curl -fLsS --retry 3 'https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar' -o "$temporary"
  mv "$temporary" "$zxing"
fi
if [[ "$(openssl dgst -sha256 "$zxing" | awk '{print $NF}')" != 8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82 ]]; then
  echo 'ZXing archive checksum mismatch.' >&2
  exit 1
fi
"$project/scripts/prepare.sh" "$build"

work=$(mktemp -d "$build/sdk.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{classes,dex,java/net/langamehub,lib}
sed 's/<manifest xmlns:/<manifest package="net.langamehub" xmlns:/' "$main/AndroidManifest.xml" > "$work/AndroidManifest.xml"
"$tools/aapt2" compile --dir "$main/res" -o "$work/resources.zip"
"$tools/aapt2" link -I "$android" --manifest "$work/AndroidManifest.xml" \
  --debug-mode --min-sdk-version 26 --target-sdk-version 35 --version-code 4 --version-name 0.3.1 \
  -A "$build/generated/hub-assets" --java "$work/java" -o "$work/unsigned.apk" "$work/resources.zip"
cat > "$work/java/net/langamehub/BuildConfig.java" <<'JAVA'
package net.langamehub;
public final class BuildConfig { public static final int VERSION_CODE = 4; }
JAVA
find "$main/java" "$work/java" -name '*.java' -type f -print > "$work/sources"
if [[ -n "${HUB_ECJ_JAR:-}" ]]; then
  java -jar "$HUB_ECJ_JAR" -8 -nowarn -encoding UTF-8 -bootclasspath "$android:$tools/core-lambda-stubs.jar" \
    -classpath "$zxing" -d "$work/classes" "@$work/sources"
else
  javac --release 8 -encoding UTF-8 -classpath "$android:$zxing" -d "$work/classes" "@$work/sources"
fi
find "$work/classes" -name '*.class' -type f -print0 | \
  xargs -0 "$tools/d8" --debug --min-api 26 --lib "$android" --output "$work/dex" "$zxing"
cp -R "$build/generated/hub-jni/." "$work/lib/"
cp "$work/dex/"*.dex "$work/"
(cd "$work" && zip -q -r unsigned.apk lib ./*.dex)
"$tools/zipalign" -P 16 -f 4 "$work/unsigned.apk" "$work/aligned.apk"
# 固定签名：默认用仓库里的 android/keystore/langamehub.jks，保证每次编译签名一致，
# 新版本可以直接覆盖安装旧版本，不用卸载。详见 android/keystore/README.md。
key=${HUB_KEYSTORE:-${HUB_DEBUG_KEYSTORE:-"$project/android/keystore/langamehub.jks"}}
key_alias=${HUB_KEY_ALIAS:-androiddebugkey}
key_storepass=${HUB_KEYSTORE_PASSWORD:-android}
key_pass=${HUB_KEY_PASSWORD:-android}
if [[ ! -f "$key" ]]; then
  echo "缺少签名密钥：$key" >&2
  echo "仓库里应当带有 android/keystore/langamehub.jks；若要自己生成，请参考 android/keystore/README.md" >&2
  exit 1
fi
"$tools/apksigner" sign --ks "$key" --ks-key-alias "$key_alias" \
  --ks-pass "pass:$key_storepass" --key-pass "pass:$key_pass" \
  --v4-signing-enabled false --out "$work/signed.apk" "$work/aligned.apk"
"$tools/apksigner" verify "$work/signed.apk" >/dev/null
"$tools/apksigner" verify --print-certs "$work/signed.apk" \
  | grep -m1 'SHA-256 digest' | sed 's/^/    签名 /'
mv -f "$work/signed.apk" "$output"
printf '%s\n' "$output"
