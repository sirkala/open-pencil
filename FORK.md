# Working on the Pena fork

Pena is [`sirkala/pena`](https://github.com/sirkala/pena), a fork of [`open-pencil/open-pencil`](https://github.com/open-pencil/open-pencil). It goes its own way but keeps merging upstream for as long as the code stays compatible, so the rebrand is kept shallow on purpose.

## Remotes

```sh
git remote -v
# origin    git@github.com:sirkala/pena.git              ← Pena; push here
# upstream  git@github.com:open-pencil/open-pencil.git   ← OpenPencil; fetch only
```

Pushing to `upstream` is disabled locally (`git remote set-url --push upstream DISABLED`). Contributions back to OpenPencil go through a pull request from a fork, as any contributor's would.

## What the rebrand changes

[`desktop/pena/rebrand.ts`](desktop/pena/rebrand.ts) renames the product to Pena in what people read: the app's text and translations, page titles, menus, error messages, AI prompts, issue templates, and the documentation site. It leaves alone:

- licenses, copyright lines, and [`CHANGELOG.md`](CHANGELOG.md) history;
- package names (`@open-pencil/*`), the `open-pencil` CLI, identifiers, and code comments;
- values stored in documents or used by other software (internal font families, `.fig` and draw.io metadata, the MCP runtime folder, the base app's binary name);
- contributor guides (`AGENTS.md`, `CONTRIBUTING.md`), package READMEs, and repository tooling.

The Pena desktop app is built from the overlay in [`desktop/pena/`](desktop/pena): its own name, icon, bundle identifier (`id.sirkala.pena`), `pena://` link scheme, and MCP port, so it runs beside OpenPencil. The base `desktop/tauri.conf.json` stays upstream's.

## Releases and updates

Installed Pena apps update themselves through the Tauri updater: they read `latest.json` from the newest release of `sirkala/pena` (`plugins.updater.endpoints` in [`desktop/pena/tauri.conf.json`](desktop/pena/tauri.conf.json)), download the archive it names, check its signature against the public key beside that endpoint, and replace the app in place. No server is involved; GitHub Releases serves the files.

The signing key is made once and kept out of the repository. Losing it means installed apps can never update again; leaking it lets anyone ship them an update.

```sh
bun tauri signer generate -w ~/.tauri/pena.key
```

Put the contents of `~/.tauri/pena.key.pub` in `plugins.updater.pubkey`, and keep the private key and its password in a password manager. The repository's `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets hold them for CI. Locally, `build.sh` reads both from the environment or from `desktop/pena/.env`, which git ignores; copy [`desktop/pena/.env.example`](desktop/pena/.env.example) to start it.

To release, bump the version in `package.json`, `desktop/tauri.conf.json`, and `desktop/Cargo.toml`, push the commit, then build and publish:

```sh
desktop/pena/build.sh
desktop/pena/release.sh
```

[`build.sh`](desktop/pena/build.sh) gathers the DMG, the signed `Pena_<version>_aarch64.app.tar.gz`, and `latest.json` in `desktop/target/aarch64-apple-darwin/release/pena-release`; [`updater.ts`](desktop/pena/updater.ts) refuses an archive signed by another key or for another version. The notes are the version's `CHANGELOG.md` section, or the Markdown file `PENA_RELEASE_NOTES` names. [`release.sh`](desktop/pena/release.sh) tags `v<version>` and publishes it as the latest release (`--draft` keeps it unpublished, and so out of reach of the apps). The updater only offers a version newer than the installed one, and GitHub's latest link skips pre-releases, so every release needs a higher version and stays a full release.

The app is signed ad hoc, so macOS treats each build as a new app: after an update people may be asked again to allow Pena into the keychain. A Developer ID certificate in `bundle.macOS.signingIdentity` removes that.

## Merging upstream

```sh
git fetch upstream
git switch -c chore/sync-upstream master
git merge upstream/master -m "chore: merge upstream master into master"
```

When a file conflicts only over the product name, take upstream's side and let the script rename it again:

```sh
git checkout --theirs path/to/file
bun desktop/pena/rebrand.ts
```

Run `bun desktop/pena/rebrand.ts` after every merge anyway, since new upstream text arrives spelled OpenPencil; `--check` only reports what it would change. The shorter name lets some strings fit on one line, so run `bun run format` after it. Then run the usual gates (`bun run check`, `bun run test:unit`, `bun run test`).
