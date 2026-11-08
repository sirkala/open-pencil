#!/bin/sh
# Publishes what build.sh gathered as Pena's newest GitHub release. Installed apps read
# releases/latest/download/latest.json, so the release is marked latest, never a pre-release,
# which GitHub's latest link skips. A pushed v<version> tag must point at this commit; without
# one, GitHub makes it here, so the commit must be pushed.
# Usage: desktop/pena/release.sh [--draft]
set -eu
cd "$(dirname "$0")/../.."

target=aarch64-apple-darwin
release="desktop/target/$target/release/pena-release"
version=$(bun -e 'console.log(require("./desktop/pena/tauri.conf.json").version)')
repository=$(bun -e '
  const config = require("./desktop/pena/tauri.conf.json")
  console.log(new URL(config.plugins.updater.endpoints[0]).pathname.split("/").slice(1, 3).join("/"))
')
tag="v$version"

if [ ! -f "$release/latest.json" ]; then
  echo "Run desktop/pena/build.sh first." >&2
  exit 1
fi
built=$(bun -e "console.log(require('./$release/latest.json').version)")
if [ "$built" != "$version" ]; then
  echo "$release holds $built, but desktop/pena/tauri.conf.json is at $version; build again." >&2
  exit 1
fi

commit=$(git rev-parse HEAD)
# An annotated tag lists the commit it points at as <tag>^{}.
tagged=$(git ls-remote origin "refs/tags/$tag" "refs/tags/$tag^{}" | sort -k2 | tail -n 1 | cut -f1)
if [ -n "$tagged" ]; then
  if [ "$tagged" != "$commit" ]; then
    echo "$tag on origin points at $tagged, not at this commit $commit." >&2
    exit 1
  fi
  placement="--verify-tag"
else
  git fetch --quiet origin
  if [ -z "$(git branch -r --contains "$commit")" ]; then
    echo "Push $commit to origin before releasing it." >&2
    exit 1
  fi
  placement="--target=$commit"
fi

gh release create "$tag" \
  --repo "$repository" \
  "$placement" \
  --title "Pena $version" \
  --notes-file "$release/notes.md" \
  --latest \
  "$@" \
  "$release/latest.json" \
  "$release"/*.app.tar.gz \
  "$release"/*.app.tar.gz.sig \
  "$release"/*.dmg
