# CiancoHorror — modpack workspace

Horror co-op modpack for **Minecraft 26.3 · Fabric Loader 0.20.1 · Java 25**, built on two
Modrinth base packs: **Optimization** (Sodium line) for clients, **Server Optimization** (wicivo) for the server. This repo is the source of truth (packwiz format);
the Prism instance, the Exaroton server and friends' installs are all derived from it.

## Layout
| Path | What |
|---|---|
| `pack/` | packwiz root, served raw from GitHub (`release` branch). `mods/*.pw.toml`, `resourcepacks/`, `config/**`, `options.txt` |
| `base/client/`, `base/server/` | Pristine snapshots of the upstream bases we're on (`base.json`, `overrides/`). Only `ch base:sync` writes here |
| `server/` | `deploy.json` (deploy rules), `server.properties` (managed keys only), `overrides/**` (server-only files that win over pack files: Server Optimization perf configs) |
| `src/datapack/` | Server datapack source → `<level>/datapacks/ciancohorror` on deploy |
| `src/resourcepack/` | Our RP source → `ch rp:build` → `pack/resourcepacks/ciancohorror-rp.zip` |
| `docs/catalog.json` | **Every** mod: category, purpose, why (doctor enforces). `docs/decisions.md` = ADR log, `docs/server.md` = server notes |
| `tools/` | The `ch` CLI (Node, ESM). Commands in `tools/commands/`, shared code in `tools/lib/` |
| `build/ cache/ dist/` | gitignored: staging, jar cache, local server, backups, exports |

## Commands (`./ch help`)
- `./ch doctor` — run after **every** pack change. Must be 0 errors / 0 warnings.
- `./ch updates` / `./ch updates --apply <slug…|all>` — Modrinth updates, auto-commits one batch.
- `./ch base:check` / `./ch base:sync <client|server>` — inherit Optimization / Server Optimization releases (3-way config merge).
- `./ch server:local` — boots the server-side set locally to "Done". Run after any server-side mod/config change.
- `./ch client:sync` — install working tree into the Prism instance (game closed). `./ch client:pull` — pull in-game config edits back.
- `./ch logs client|local|server` — deduped WARN/ERROR + mod-list diff + crash digest.
- `./ch server status|drift|logs|ls|get|props|backup|deploy …` — Exaroton.
- `./ch release [patch|minor]` — mrpack + Prism onboarding zip + tag + gh release + moves `release` branch.
- packwiz itself: `~/go/bin/packwiz` (not on PATH), always run from `pack/`.

## Rules (safety)
1. **Never deploy to Exaroton without**: `./ch server:local` passing, `./ch server deploy --dry-run` shown to the user, and the user's explicit OK for that deploy. Approval doesn't carry over to the next deploy.
2. Deploy only touches files in the remote manifest (`/.ciancohorror-manifest.json`) plus our datapack folder. Never touch world data, `whitelist.json`, `ops.json`, `banned-*`. Exaroton owns the voicechat `port`/`bind_address`/`voice_host`.
3. The Exaroton token lives only in the Keychain (`ciancohorror-exaroton`); the CLI reads it itself. Never print it, never write it to disk or the repo.
4. The repo is **public**: no secrets, no `servers.dat`, `usercache.json`, personal configs (device names, volumes), or generated passwords. `tools/lib/rules.mjs` `LOCAL_ONLY` lists those.
5. `git push` / `ch release` / server writes are outward-facing → confirm with the user first.
6. Friends track the `release` branch, not `main`. Only `ch release` moves it.

## Conventions
- One logical change per commit. Prefixes: `update:`, `add:`, `remove:`, `config:`, `base:`, `server:`, `datapack:`, `rp:`, `tools:`, `docs:`, `release:`.
- New mod → also add a `docs/catalog.json` entry (category from the list there) and, if it's a real decision, a line in `docs/decisions.md`.
- Server-only mods get `side = "both"` (singleplayer must match the server). Client-only stays `client`.
  Exception: Server Optimization's own perf mods are `side = "server"` (they're the server's base, not gameplay).
- Gameplay configs live in `pack/config` (server values are canonical). Server-only tuning goes in `server/overrides/config`.
- Configs that are user preferences go in `PRESERVE` (shipped once, never overwritten: `options.txt`, sodium options…). Machine-local/cache files go in `LOCAL_ONLY`. Leftovers of removed mods go in `DROPPED`.
- Base mods (`"base": ["client"|"server"…]` in catalog) can be updated ahead of the base; `base:sync` keeps whichever is newer.

## Gotchas
- `options.txt` is `preserve = true` → changes (e.g. enabling a new resource pack) do **not** reach existing players. Use a datapack/mod default or tell friends.
- Mods rewrite their configs on first launch (comments, new keys); `client:pull` will show such diffs — that's normal, review before committing.
- Some configs are owned by jar-in-jar libs: `midnightlib.json` (Cool Rain), `transition.json`/`trender.json` (Entity Culling), `resourceful-config-web.json` (Lootr; contains a password → LOCAL_ONLY), `cardinal-components-api.properties` (SIHYWTCAMD). `animatium3.json` = Vidalia (jar is `animatium-*.jar`).
- Version breaks to remember: Simple Voice Chat breaks Sound Physics Remastered `<1.5.2`; More Culling breaks Sodium `<=0.9.3-beta.1`; Polytone breaks Sodium `<0.9`. `doctor` checks `breaks` ranges.
- Hollow Steve rejects its **whole** config if any value is out of range (e.g. `movementSpeed` max 0.5, `attackReach` max 4.0) and logs `Config invalid; keeping last valid settings`.
- From The Fog logs `Invalid path … THIS IS NOT A BUG IT IS INTENTIONAL` as an ERROR — ignore.
- 26.3 pack formats: **data 121**, **resource 97** (`min_format`/`max_format` in pack.mcmeta). Folder names are singular (`function/`, `loot_table/`).
- ESF's build is tagged for 26.1 but works on 26.3. FastQuit's is tagged `mc26.2` (base ships it).
- Prism instance: `~/Library/Application Support/PrismLauncher/instances/CiancoHorror` (override with `CH_INSTANCE`).
- The server is offline-mode with `white-list=true`: whitelist entries need **offline** UUIDs (md5 `OfflinePlayer:<name>`, name is case-sensitive).
- Exaroton: 6 GB RAM / 3 vCPU — anything chunk-gen heavy hurts; prefer pregen (Chunky) and lower simulation distance.

## Skills
`.claude/skills/`: `update-mods`, `add-mod`, `diagnose`, `sync-base`, `deploy-server`, `release`, `make-datapack`.
