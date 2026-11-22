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
