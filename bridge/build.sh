#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_DIR="$ROOT_DIR/bridge"
RELEASE_DIR="$ROOT_DIR/release"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghcn-bridge-build.XXXXXX")"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$RELEASE_DIR"

echo "[bridge] Syncing embedded tray icons..."
cp "$ROOT_DIR/chrome/assets/icons/icon32.png" "$BRIDGE_DIR/icon_tray.png"
cp "$ROOT_DIR/chrome/assets/icons/icon48.png" "$BRIDGE_DIR/icon_macos.png"

echo "[bridge] Running Go vet & unit tests..."
(
  cd "$BRIDGE_DIR"
  go vet ./...
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...
  go test -v ./...
)

echo "[bridge] Building Windows amd64 tray executable..."
WIN_OUT="$RELEASE_DIR/index-translate-bridge-windows-amd64.exe"
(
  cd "$BRIDGE_DIR"
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-H=windowsgui -s -w" -o "$WIN_OUT" .
)

echo "[bridge] Building macOS arm64 & x86_64 binaries..."
MACOS_MIN_VERSION="13.0"
MAC_ARM="$WORK_DIR/bridge-darwin-arm64"
MAC_AMD="$WORK_DIR/bridge-darwin-amd64"
MAC_UNI="$WORK_DIR/bridge-darwin-universal"
(
  cd "$BRIDGE_DIR"
  MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION" \
    CGO_CFLAGS="-mmacosx-version-min=$MACOS_MIN_VERSION" \
    CGO_LDFLAGS="-mmacosx-version-min=$MACOS_MIN_VERSION" \
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o "$MAC_ARM" .
  MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION" \
    CGO_CFLAGS="-mmacosx-version-min=$MACOS_MIN_VERSION" \
    CGO_LDFLAGS="-mmacosx-version-min=$MACOS_MIN_VERSION" \
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o "$MAC_AMD" .
)
lipo -create -output "$MAC_UNI" "$MAC_ARM" "$MAC_AMD"

echo "[bridge] Building macOS AppIcon.icns..."
ICONSET="$WORK_DIR/AppIcon.iconset"
SRC_ICON="$ROOT_DIR/chrome/assets/icons/icon512.png"
mkdir -p "$ICONSET"
sips -z 16 16     "$SRC_ICON" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32     "$SRC_ICON" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$SRC_ICON" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64     "$SRC_ICON" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$SRC_ICON" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256   "$SRC_ICON" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SRC_ICON" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512   "$SRC_ICON" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SRC_ICON" --out "$ICONSET/icon_512x512.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$WORK_DIR/AppIcon.icns"

echo "[bridge] Assembling IndexTranslateBridge.app..."
APP_DIR="$WORK_DIR/IndexTranslateBridge.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$MAC_UNI" "$APP_DIR/Contents/MacOS/IndexTranslateBridge"
chmod +x "$APP_DIR/Contents/MacOS/IndexTranslateBridge"
cp "$WORK_DIR/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>Index-Translate 本地代理</string>
  <key>CFBundleExecutable</key>
  <string>IndexTranslateBridge</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.maydayv.index-translate-bridge</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>IndexTranslateBridge</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP_DIR"

MAC_ZIP="$RELEASE_DIR/index-translate-bridge-macos-universal.zip"
rm -f "$MAC_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$MAC_ZIP"

(
  cd "$RELEASE_DIR"
  shasum -a 256 \
    "index-translate-bridge-windows-amd64.exe" \
    "index-translate-bridge-macos-universal.zip" \
    > "index-translate-bridge-SHA256SUMS.txt"
)

echo "[bridge] Build complete:"
ls -lh "$WIN_OUT" "$MAC_ZIP" "$RELEASE_DIR/index-translate-bridge-SHA256SUMS.txt"
