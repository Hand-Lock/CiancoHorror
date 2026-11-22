# Server — Exaroton `lauseta.exaroton.me`

- Plan: **6 GB RAM / 3 vCPU**. Chunk generation is the main risk → pregenerate (Chunky, candidate) and keep simulation distance low.
- Software: Fabric 0.20.1 on MC 26.3 (verify with `./ch server status`).
- Token: macOS Keychain item `ciancohorror-exaroton` (create at exaroton.com → Account → API). The CLI reads it; never stored in files.
  `security add-generic-password -s ciancohorror-exaroton -a api -w` (prompts for it).

## What the repo manages
| Remote path | Source | Notes |
|---|---|---|
| `mods/*.jar` | `pack/mods` (side both/server) | 42 jars today |
| `config/**` | `pack/config` minus client-only files (`server/deploy.json` exclude) | |
| `<level>/datapacks/ciancohorror/` | `src/datapack` | data format 121 |
| `server.properties` (selected keys) | `server/server.properties` | only keys listed there are patched |
| `/.ciancohorror-manifest.json` | written by deploy | sha256 + size of every managed file |

Exaroton-owned, never changed: voicechat `port`, `bind_address`, `voice_host` (`keepRemoteKeys`), world data, whitelist/ops/bans, Exaroton's own software files.

## Workflow
`./ch server drift` (read-only) → `./ch server:local` → `./ch server deploy --dry-run` → user OK → `./ch server deploy --yes` → `./ch server logs` → test join + voice chat.
Backups of everything a deploy overwrites: `build/backups/deploy-<timestamp>/` (+ `./ch server backup [--world]` on demand).

## Tuning targets (Phase 7, pending review against the real server.properties)
view-distance 10 · simulation-distance 6–8 · sync-chunk-writes=false · network-compression-threshold 256 · C2ME worker threads for 3 vCPU · Chunky pregen radius 3–5k.
