---
name: sync-base
description: Inherit a new upstream Optimization modpack release into CiancoHorror (mods + 3-way config merge). Use when asked to update the base / Optimization, or when base:check reports a new release.
---
# Sync the Optimization base

1. `./ch base:check` — shows newer releases and the plan: `add` / `remove` / `bump` / `keep-ahead` (we're already newer) / override merges.
2. Requires a clean `pack/` + `base/`. Run `./ch base:sync` (or `./ch base:sync <versionId|version_number>`; `--dry-run` to preview).
   - Removed upstream but needed by our mods → kept as our own (catalog `base` flag dropped).
   - Overrides are merged with `git merge-file` (ours ← old base → new base). On conflict the command stops without committing: resolve `<<<<<<<` markers in `pack/…`, `./ch doctor`, then `git add -A && git commit -m "base: Optimization X → Y"`.
   - Fabric loader bumps are applied to `pack/pack.toml`; an MC version change is flagged for manual handling.
3. New base mods get a placeholder catalog entry — fill `purpose`/`why`.
4. `./ch doctor` → `./ch server:local` → client test (see update-mods).
