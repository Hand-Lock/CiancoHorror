# Decisions (ADR log)

Newest last. One line of context, the decision, and why. Mod-level "why" lives in `catalog.json`.

## 2026-11-22 — Workspace bootstrap
- **packwiz + public GitHub repo as source of truth.** Friends' Prism instances run packwiz-installer on every launch against the `release` branch; a `.mrpack` is also exported per release. *Why:* zero-effort updates for friends, git history for every change, Claude can operate on plain TOML/JSON.
- **Imported directly from the Prism instance's `.index` metadata** (exact versions + sha512) instead of re-resolving with `packwiz modrinth add`. *Why:* a faithful 1:1 import (verified: installer output = instance, 62/62 hashes).
- **Base = Optimization (Sodium line, `ddF4bxsz`) kept as a pristine snapshot in `base/`**, merged with `ch base:sync` (3-way for overrides, newest-wins for mods). *Why:* inherit upstream perf tuning without losing our edits.
- **Server-only mods use `side = "both"`.** *Why:* singleplayer/LAN tests behave like the server; these mods cost nothing client-side.
- **Dropped mcopt-metal** (and its config). Also dropped leftover configs of TreeChop (needed Polymer, crashed) and Sound Physics Remastered.
- **`pack.toml` author = Hand-Lock** (GitHub handle), not the local username. *Why:* public repo.
- **`voicechat-client.properties` is not shipped** (contains personal audio device names and volumes); same for voicechat caches and `resourceful-config-web.json` (generated password). See `tools/lib/rules.mjs` `LOCAL_ONLY`.
- **`options.txt` is curated and `preserve = true`**: base defaults + our render distance, resource-pack order and `musicToast:"never"`. *Why:* sets sane defaults once without fighting players' own settings later.
- **Deploys are manifest-based** (`/.ciancohorror-manifest.json` on the server): only files we uploaded are ever overwritten/deleted; unmanaged files are reported, removed only with `--prune`. Every deploy is gated by `ch server:local` and backs up what it touches.

## 2026-11-22 — Server drift reconciliation
- **Server base = Server Optimization by wicivo (`2wkV8mHp`)**, the pack the Exaroton server was really built from; tracked as a second base (`base/server/`, `ch base:sync server`). *Why:* the server had 8 jars and 6 tuned configs the pack didn't know about; now they're versioned and inherited like the client base.
- **Server Optimization's perf mods are `side = "server"`** (alternate-current, chunky, scalablelux, servercore, spark, tt20, vmp), an exception to "server-only → both". *Why:* they're the server's platform, not gameplay; clients and singleplayer keep the client base. Shared ones (FerriteCore, C2ME, Fabric API, Lithium) stay `both`.
- **Server perf configs live in `server/overrides/config/`** and win over `pack/config` in the server stage. *Why:* the client base ships different values for the same files (e.g. `ferritecore.mixin.properties`).
- **Server gameplay values are canonical** (Face of Horror, Hollow Steve, Hardcore Revival, Server-Side Horror, Giant Spawn, Distant Friends, voice chat distances) and were copied into the pack. *Why:* that's what friends actually played; singleplayer now matches.
- **Hollow Steve `movementSpeed` 0.6 → 0.5.** The mod rejects the whole config above 0.5, so the server had silently run defaults. 0.5 is the closest valid value.
- **7 mods the server never had → `side = "client"`** (Cool Rain, CreativeCore, EnhancedVisuals, ModernFix-mVUS, Placeholder API, quick pack, YACL). *Why:* match the server that works; doctor's per-side dependency check guards it.
- **SkinRestorer tracked, `side = "both"`.** It was added by hand on the server. *Why:* the server is offline-mode, so players need it to keep their skins.
- **`white-list=true` + `enforce-whitelist=true` are managed keys.** *Why:* offline-mode + public address means anyone could join under any name.
- **Server secrets are redacted** (`/secret|password|token|keystore/` keys) in all `ch` output.
- **`enforce-whitelist` dropped from managed keys**: Exaroton resets it on start. `white-list` was turned on via console `whitelist on` (persists). Two whitelist entries were rewritten with offline UUIDs (they had premium UUIDs and would have been locked out).

## 2026-11-22 — Client migration
- **The dev Prism instance is synced by `ch client:sync`, without the packwiz-installer PreLaunchCommand** (the original plan had one). *Why:* a pre-launch update from the `release` branch would undo the working-tree changes being tested. Friends' instances (the onboarding zip) do self-update from `release`.
