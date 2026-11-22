---
name: diagnose
description: Diagnose CiancoHorror crashes, lag, warnings or mod conflicts from client or server logs. Use when the user reports a crash, error, lag, or "something is weird".
---
# Diagnose

1. Pick the source: `./ch logs client` (Prism instance), `./ch logs local` (smoke-test server), `./ch logs server` (Exaroton; needs token).
   Older logs: `--file=<path to .log or .log.gz>`. Crash reports are digested automatically (`--crashes` forces the latest 3). `--traces` prints stack heads, `--grep=re` filters.
2. Read the **mod-list diff** first: missing/extra/different versions vs the pack explain a lot (stale instance → `./ch client:sync`).
3. Rank by impact, not count: FATAL/ERROR > repeating WARN spam (perf) > one-off WARN. Known noise is listed in CLAUDE.md Gotchas.
4. Map a stack trace/mixin to a mod: package name → jar via `cache/modmeta.json` (ids, nested jars) or `unzip -l cache/jars/<jar>`.
5. Reproduce minimal: server-side issues with `./ch server:local` (`CH_VERBOSE=1` streams the console); client issues by toggling the mod in a scratch commit + `./ch client:sync`.
6. Performance: recommend/installed **spark** (`/spark profiler start --timeout 120` on the server, `/sparkc` client) and read the report URL.
7. Sharing: `--share` uploads the log to mclo.gs (public!) — only when the user asks.
8. Record the root cause + fix in `docs/decisions.md` if it changes the pack.
