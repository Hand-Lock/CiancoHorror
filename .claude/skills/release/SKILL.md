---
name: release
description: Publish a CiancoHorror release to friends (version bump, .mrpack, Prism onboarding zip, git tag, GitHub release, release branch). Use when asked to release, publish, or ship the pack to friends.
---
# Release

Friends' instances run packwiz-installer on every launch against
`https://raw.githubusercontent.com/<owner>/CiancoHorror/release/pack/pack.toml` — so moving the `release`
branch **is** the update. Treat it as outward-facing: confirm with the user.

1. Clean tree; `./ch doctor` clean; `./ch server:local` passed; client tested (`./ch client:sync` + launch + `./ch logs client`).
2. If server-side files changed, the server should be deployed **at the same time** (version mismatch → join errors). Coordinate with deploy-server.
3. `./ch release patch|minor|major` — shows changelog since last tag, asks, then: bumps `pack.toml`, commits `release: vX`, tags, exports `dist/CiancoHorror-X.mrpack` + `dist/CiancoHorror-Prism.zip`, pushes `main` + tag, force-moves `release` to the tag, creates the GitHub release with both files.
   `--no-push` builds artifacts locally only.
4. Remind the user about anything players must do by hand (e.g. new resource pack to enable, since `options.txt` is preserved).
