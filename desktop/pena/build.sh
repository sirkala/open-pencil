#!/bin/sh
# Builds Pena for Apple Silicon: the app, a drag-to-Applications DMG, and the signed updater
# archive with its latest.json, gathered in desktop/target/<target>/release/pena-release for
# release.sh. Pena answers pena:// links and runs its MCP server on its own port and folder,
# so it can sit beside OpenPencil.
set -eu
cd "$(dirname "$0")/../.."

# The updater archive is signed with Pena's private key; installed apps check it against the
# public key in desktop/pena/tauri.conf.json. The key and its password come from the
# environment or from desktop/pena/.env (see .env.example).
if [ -f desktop/pena/.env ]; then
  set -a
  . desktop/pena/.env
  set +a
fi
# An empty password would be tried as the password instead of asking for it.
if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "Set TAURI_SIGNING_PRIVATE_KEY to the path or contents of Pena's updater key (FORK.md, Releases)." >&2
  exit 1
fi
# Tauri takes only the key's contents, so a path is read here.
if [ -f "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  TAURI_SIGNING_PRIVATE_KEY=$(cat "$TAURI_SIGNING_PRIVATE_KEY")
  export TAURI_SIGNING_PRIVATE_KEY
fi
if grep -q PENA_UPDATER_PUBKEY desktop/pena/tauri.conf.json; then
  echo "Put Pena's updater public key in desktop/pena/tauri.conf.json first (FORK.md, Releases)." >&2
  exit 1
fi

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
release="desktop/target/$target/release/pena-release"
bun desktop/pena/updater.ts "$target" "$bundle" "$version" "$release"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$bundle/macos/Pena.app" "$stage/"
ln -s /Applications "$stage/Applications"
mkdir -p "$bundle/dmg"
dmg="$bundle/dmg/Pena_${version}_aarch64.dmg"
rm -f "$dmg"
hdiutil create -volname Pena -srcfolder "$stage" -format UDZO "$dmg"
cp "$dmg" "$release/"
echo "$release"
