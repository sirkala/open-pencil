#!/bin/sh
# Builds Pena for Apple Silicon: the app and a drag-to-Applications DMG. Pena answers pena://
# links and runs its MCP server on its own port and folder, so it can sit beside OpenPencil.
set -eu
cd "$(dirname "$0")/../.."

export VITE_OPENPENCIL_LINK_SCHEME=pena
export VITE_OPENPENCIL_MCP_PORT=7610
export VITE_OPENPENCIL_MCP_FOLDER=Pena
export VITE_OPENPENCIL_MCP_SIDECAR=pena/bin/pena-mcp-http
export APPLE_SIGNING_IDENTITY=-

target=aarch64-apple-darwin
# Tauri bundles the sidecar named for the target it builds.
bun desktop/pena/mcp.ts "$target" "desktop/pena/bin/pena-mcp-http-$target"
bun run tauri build -c desktop/pena/tauri.conf.json --target "$target" "$@"

bundle="desktop/target/$target/release/bundle"
version=$(bun -e 'console.log(require("./package.json").version)')
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$bundle/macos/Pena.app" "$stage/"
ln -s /Applications "$stage/Applications"
mkdir -p "$bundle/dmg"
dmg="$bundle/dmg/Pena_${version}_aarch64.dmg"
rm -f "$dmg"
hdiutil create -volname Pena -srcfolder "$stage" -format UDZO "$dmg"
echo "$dmg"
