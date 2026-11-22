---
name: add-mod
description: Add (or remove/swap) a mod in the CiancoHorror pack — compatibility checks, side, deps, catalog entry, tests. Use when asked to add, try, replace or remove a mod.
---
# Add / remove a mod

**Check first** (Modrinth API, no auth): `curl -s "https://api.modrinth.com/v2/project/<slug>/version?game_versions=%5B%2226.3%22%5D&loaders=%5B%22fabric%22%5D" | jq '.[0] | {id, version_number, version_type, dependencies}'`
- Must have a 26.3 Fabric build. Check `dependencies` (required ones must be added too) and `incompatible`.
- Check overlap with existing mods (`docs/catalog.json` categories) — e.g. darkness mods vs The Murk, sound physics vs Sound Physics Perfected.
- Server-only mod? Note that (zero client cost) — still `side = "both"`.

**Add**: from `pack/`: `~/go/bin/packwiz modrinth add --project-id <id> --version-id <vid> -y`
(or `packwiz modrinth add <slug> -y`). Then:
- Set `side` in the new `pack/mods/<slug>.pw.toml`: `client` for client-only, otherwise `both`. (`server` is reserved for Server Optimization base mods.)
- `./ch doctor` checks deps per side: a `client` mod can't be required by a server-side mod.
- Add `docs/catalog.json` entry `{category, purpose, why}` (+ `requiredBy` for libs). Real decision → line in `docs/decisions.md`.
- `./ch doctor` clean → `./ch server:local` (if not client-only) → `./ch client:sync` + launch + `./ch logs client`.
- Configs: after first launch, `./ch client:pull` to capture the mod's generated config if we want to ship tuned values.
- Commit: `add: <Mod name> — <why>`.

**Remove**: delete the metafile (`~/go/bin/packwiz remove <slug>`), remove its catalog entry, delete its configs from `pack/config`, add those config globs to `DROPPED` in `tools/lib/rules.mjs`, check no other mod depends on it (`./ch doctor`), then the same tests. Commit `remove: …`.
