#!/bin/sh
# Publishes what build.sh gathered as Pena's newest GitHub release. Installed apps read
# releases/latest/download/latest.json, so the release is marked latest, never a pre-release,
# which GitHub's latest link skips.
# Usage: desktop/pena/release.sh [--draft]
set -eu
cd "$(dirname "$0")/../.."

target=aarch64-apple-darwin
release="desktop/target/$target/release/pena-release"
version=$(bun -e 'console.log(require("./package.json").version)')
repository=$(bun -e '
  const config = require("./desktop/pena/tauri.conf.json")
  console.log(new URL(config.plugins.updater.endpoints[0]).pathname.split("/").slice(1, 3).join("/"))
')

if [ ! -f "$release/latest.json" ]; then
  echo "Run desktop/pena/build.sh first." >&2
  exit 1
fi
built=$(bun -e "console.log(require('./$release/latest.json').version)")
if [ "$built" != "$version" ]; then
  echo "$release holds $built, but package.json is at $version; build again." >&2
  exit 1
fi

# The tag is made on GitHub at this commit, so it has to be pushed.
commit=$(git rev-parse HEAD)
git fetch --quiet origin
if [ -z "$(git branch -r --contains "$commit")" ]; then
  echo "Push $commit to origin before releasing it." >&2
  exit 1
fi

gh release create "v$version" \
  --repo "$repository" \
  --target "$commit" \
  --title "Pena $version" \
  --notes-file "$release/notes.md" \
  --latest \
  "$@" \
  "$release/latest.json" \
  "$release"/*.app.tar.gz \
  "$release"/*.app.tar.gz.sig \
  "$release"/*.dmg
