# CiancoHorror

A co-op horror modpack for **Minecraft 26.3 (Fabric)**, built on the
[Optimization](https://modrinth.com/modpack/optimization) pack. It adds horror mobs and events, atmospheric
sound, proximity voice chat and the Golden Days look.

## For players

**You need [Prism Launcher](https://prismlauncher.org/)** (recommended) and Java 25 (Prism can download it for you).

1. Download `CiancoHorror-Prism.zip` from the latest **[Release](../../releases/latest)**.
2. In Prism, go to **Add Instance → Import**, select the zip, then OK.
3. Launch it. The first start downloads every mod (about a minute). After that the instance **updates itself on every launch**, so there's nothing to reinstall.
4. Give it at least 4 GB of RAM (instance → Settings → Java).

Using another launcher (Modrinth App, ATLauncher…)? Import the `.mrpack` from the same release instead. It won't auto-update; re-import each new release.

**Voice chat:** press `V` for the voice chat menu and set your microphone there. Your audio settings stay on your machine.

**"Pre-Launch command failed" / the log shows `java-jar`?** That's a bug in the v0.1.1 zip. Either re-import the zip from the latest release, or fix the existing instance (this keeps your worlds): instance → **Edit → Settings → Custom commands**, tick the box, and set **Pre-launch command** to
`"$INST_JAVA" -jar packwiz-installer-bootstrap.jar https://raw.githubusercontent.com/Hand-Lock/CiancoHorror/release/pack/pack.toml`

**Something broke?** Send `logs/latest.log` (or the newest file in `crash-reports/`) from the instance folder.

## For maintainers

The repo is the source of truth (packwiz format). Everything else is derived from it: the dev Prism instance, the Exaroton server, and players' installs.

```sh
./ch help            # all commands
./ch doctor          # consistency check: run after every change
./ch updates         # Modrinth updates
./ch server:local    # boot the server-side set locally (smoke test)
./ch client:sync     # install the working tree into the local Prism instance
./ch release patch   # publish to players
```

Requirements: Node ≥ 20, Java 25, git, [packwiz](https://github.com/packwiz/packwiz) (`go install github.com/packwiz/packwiz@latest`), and `gh` for releases.
See `CLAUDE.md` for the layout, rules and gotchas, `docs/catalog.json` for why each mod is here, and `docs/decisions.md` for the decision log.

### The dev instance
The maintainer's Prism instance (`CiancoHorror`) is **not** self-updating. `./ch client:sync` installs the working tree into it, so changes can be tested before release.
It was migrated from the Modrinth "Optimization" pack on 2026-11-22: `ManagedPack=false` (Prism's "Update" button would otherwise replace the whole pack). The original instance is kept as `CiancoHorror (backup 2026-11-22)`.
To play exactly what friends get, import `CiancoHorror-Prism.zip` from a release as a separate instance.
