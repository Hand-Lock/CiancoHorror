---
name: sync-base
description: Inherit a new upstream base release into CiancoHorror — Optimization (client base) or Server Optimization by wicivo (server base) — mods + 3-way config merge. Use when asked to update the base / Optimization / Server Optimization, or when base:check reports a new release.
---
# Sync a base pack

Two bases (`tools/lib/base.mjs` `BASES`):
| key | upstream | new mods get | overrides land in |
|---|---|---|---|
| `client` | Optimization (`ddF4bxsz`, Sodium-* versions) | `both` (or `client` if server-unsupported) | `pack/**` |
| `server` | Server Optimization (`2wkV8mHp`) | `server` | `config/**` → `server/overrides/config/**`; `server.properties` → key-merged into `server/server.properties` |

1. `./ch base:check [client|server]` (both by default) — newer releases and the plan: `add` / `remove` / `bump` / `keep-ahead` (we're already newer) / `unflag` (dropped by one base, still in the other) / override merges.
2. Requires a clean `pack/`, `base/`, `server/`. Run `./ch base:sync <client|server> [versionId|version_number]` (`--dry-run` to preview).
   - Removed upstream but needed by our mods → kept as our own (catalog `base` flag dropped).
   - Overrides are merged with `git merge-file` (ours ← old base → new base). On conflict the command stops without committing: resolve `<<<<<<<` markers, `./ch doctor`, then `git add -A && git commit -m "base: <title> X → Y"`.
   - Fabric loader bumps (client base only) are applied to `pack/pack.toml`; an MC version change is flagged for manual handling.
3. New base mods get a placeholder catalog entry — fill `purpose`/`why`.
4. `./ch doctor` → `./ch server:local` → client test (see update-mods). Server base changes reach Exaroton only via the deploy-server skill.
