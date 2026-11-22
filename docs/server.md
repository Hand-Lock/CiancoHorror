# Server — Exaroton `lauseta.exaroton.me`

- Plan: **6 GB RAM / 3 vCPU**. Chunk generation is the main risk → pregenerate (`/chunky`) and keep simulation distance low.
- Base: **Server Optimization** by wicivo (Modrinth `2wkV8mHp`), snapshot in `base/server/`. Its perf mods are `side = "server"` in the pack; its configs live in `server/overrides/config/`.
- `online-mode=false` + `white-list=true` + `enforce-whitelist=true`. Whitelist entries must use offline UUIDs; SkinRestorer gives players their skins back.
- Exaroton runs the 26.x management server (`management-server-enabled=true`, `0.0.0.0:9900`, no TLS). Its secret is redacted in every `ch` output; never print `server.properties` raw.
- Software: Fabric 0.20.1 on MC 26.3 (verify with `./ch server status`).
- Token: macOS Keychain item `ciancohorror-exaroton` (create at exaroton.com → Account → API). The CLI reads it; never stored in files.
  `security add-generic-password -s ciancohorror-exaroton -a api -w` (prompts for it).

## What the repo manages
| Remote path | Source | Notes |
|---|---|---|
| `mods/*.jar` | `pack/mods` (side both/server) | 43 jars today |
| `config/**` | `pack/config` minus configs of client-side mods and `server/deploy.json` excludes | |
| `config/**` (perf) | `server/overrides/config` | wins over pack files: C2ME, Lithium, FerriteCore, ServerCore, TT20 |
| `<level>/datapacks/ciancohorror/` | `src/datapack` | data format 121 |
| `server.properties` (selected keys) | `server/server.properties` | only keys listed there are patched |
| `/.ciancohorror-manifest.json` | written by deploy | sha256 + size of every managed file |

Exaroton-owned, never changed: voicechat `port`, `bind_address`, `voice_host` (`keepRemoteKeys`), world data, whitelist/ops/bans, Exaroton's own software files.

## Workflow
`./ch server drift` (read-only) → `./ch server:local` → `./ch server deploy --dry-run` → user OK → `./ch server deploy --yes` → `./ch server logs` → test join + voice chat.
Backups of everything a deploy overwrites: `build/backups/deploy-<timestamp>/` (+ `./ch server backup [--world]` on demand).

## Tuning (Phase 7 review items)
Live: view-distance 8 · simulation-distance 8 · sync-chunk-writes=false · network-compression-threshold 128 (Server Optimization).
To review: TT20 (changes timers under lag), C2ME `gcFreeChunkSerializer` + Lithium `mixin.experimental` (experimental), ScalableLux (alpha), Chunky pregen radius 3–5k.
