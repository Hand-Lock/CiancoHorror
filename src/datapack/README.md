# CiancoHorror datapack (server)

Folder-form datapack. `ch server deploy` uploads it to `<level-name>/datapacks/ciancohorror/`
on the Exaroton server (tracked in the deploy manifest; nothing else in the world is touched).
`ch server:local` loads it too, so test there first.

- MC 26.3 data pack format: **121** (`min_format`/`max_format` in pack.mcmeta; verified on 26.3)
- Namespace: `ciancohorror` → `data/ciancohorror/...` (note: singular `function/`, `advancement/`, `loot_table/`…)
- Load hook: `data/minecraft/tags/function/load.json` → `{ "values": ["ciancohorror:load"] }`
- Overriding another mod's data: put files under that mod's namespace (e.g. `data/fromthefog/...`).

See `.claude/skills/make-datapack/SKILL.md`.
