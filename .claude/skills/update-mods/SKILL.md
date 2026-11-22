---
name: update-mods
description: Check for and apply Modrinth mod updates to the CiancoHorror pack safely (doctor, smoke test, client test, commit). Use when asked to update mods or check for updates.
---
# Update mods

1. `./ch updates` — table of available updates (type: release/beta/alpha; `base:client` / `base:server` / `base:client+server` = mod shipped by that base pack).
   `--release-only` to ignore betas/alphas. Show the table to the user.
2. For anything non-trivial, skim the changelog: `curl -s https://api.modrinth.com/v2/version/<id> | jq -r .changelog`
   (version ids via `./ch updates` source or the metafile). Flag breaking changes, new required deps, MC-version tags.
3. Group sensibly (libraries with their dependents; risky ones like Sodium/C2ME/Lithium alone) and apply:
   `./ch updates --apply <slug…>` (auto-commits "update: …"; `--no-commit` to batch manually).
4. `./ch doctor` → must be clean (new required deps show up here — add them with the add-mod skill).
5. If any updated mod has side `both`/`server`: `./ch server:local` must pass.
6. Client test: `./ch client:sync`, launch (`open -a "Prism Launcher" --args --launch CiancoHorror` or ask the user), then `./ch logs client` → no new ERRORs, mod list matches.
7. If something breaks: `git revert <commit>` (or reset the batch), note it in `docs/decisions.md`, and `pin = true` in the metafile if we must stay on a version.
8. Don't deploy or release unless asked (see deploy-server / release skills).
