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

Run `bun desktop/pena/rebrand.ts` after every merge anyway, since new upstream text arrives spelled OpenPencil; `--check` only reports what it would change. Then run the usual gates (`bun run check`, `bun run test:unit`, `bun run test`).
