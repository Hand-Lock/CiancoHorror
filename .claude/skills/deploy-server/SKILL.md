---
name: deploy-server
description: Deploy the CiancoHorror pack (mods, configs, datapack, managed server.properties) to the Exaroton server safely, or inspect the server. Use when asked to deploy, push to the server, check server drift/status/logs.
---
# Deploy to Exaroton (lauseta.exaroton.me)

Read-only first, always:
1. `./ch server status` and `./ch server drift` (saves `build/drift-*.json`): uploads/adopts, **unmanaged jars**, server.properties values.
2. `./ch server:local` must pass on the exact commit being deployed (deploy runs it again automatically).
3. `./ch server deploy --dry-run` → show the user the plan verbatim.
4. Only after the user explicitly OKs **this** plan: `./ch server deploy --yes` (add `--prune` only if the user agreed to delete the listed unmanaged jars — needed on the first deploy if old jars would duplicate mods).

What deploy does: backup of every file it overwrites/deletes → `build/backups/deploy-*` · stops the server (announces in chat) · deletes manifest files no longer in the pack · uploads new/changed · patches managed keys in `server.properties` (from `server/server.properties`) · writes `/.ciancohorror-manifest.json` · starts · waits for `Done` and prints errors.
Never touched: world data (except `<level>/datapacks/ciancohorror`), whitelist/ops/bans, unmanaged files, voicechat port/bind/host.
Server set = pack mods with side `both`/`server` + configs of server-side mods + `server/overrides/**` (wins) + datapack.
Never print the remote `server.properties` raw (management-server secret, rcon password) — `ch server props` redacts.
Whitelist is on: before a deploy that enables it, check `whitelist.json` uses offline UUIDs or players get locked out (fix via console `whitelist remove/add`, with the user's OK).

After deploy: `./ch server logs` (mod list should match the server set), ask the user for a test join + voice chat connect.
Rollback: upload files from the backup dir with `./ch server put`, or `git revert` + redeploy.
Token missing → tell the user to run `! security add-generic-password -s ciancohorror-exaroton -a api -w` (never handle the token yourself).
