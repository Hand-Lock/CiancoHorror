---
name: make-datapack
description: Create or edit the CiancoHorror server datapack (functions, loot tables, advancements, mob/horror tuning, overriding mod data) and test it locally. Use when asked for datapack work, custom recipes/loot/advancements, or tweaking mod data.
---
# Datapack work (`src/datapack/`)

- Format for MC 26.3: data **121** → `pack.mcmeta` `"min_format": 121, "max_format": 121` (verified). Folder names are singular: `function/`, `advancement/`, `loot_table/`, `recipe/`, `tags/function/`.
- Our namespace: `ciancohorror`. Load/tick hooks via `data/minecraft/tags/function/{load,tick}.json`. Prefer schedules over `tick` (3-vCPU server).
- Override mod data by mirroring its path in its namespace: find it with `unzip -l cache/jars/<mod>.jar | grep data/` (run `./ch doctor` first to populate the cache).
- Horror pacing / mod tuning that a mod exposes in config belongs in `pack/config`, not the datapack.

Test loop:
1. `./ch server:local` (stage includes the datapack under `world/datapacks/ciancohorror`), then `./ch logs local --grep=ciancohorror\|datapack\|function` — parse errors appear as ERROR/WARN.
2. Interactive: `./ch server:local --keep-running` and connect to `localhost:25599` from the client, or `/reload` there.
3. Commit `datapack: …`; reaches the server via deploy-server, singleplayer via copying into the world's `datapacks/`.
