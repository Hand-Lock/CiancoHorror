# CiancoHorror resource pack (client)

Source for `pack/resourcepacks/ciancohorror-rp.zip` (built by `./ch rp:build`; only built once
`assets/` exists). MC 26.3 resource pack format: **97** (97.1).

Load order matters: it must sit **above** Golden Days in `options.txt` `resourcePacks` to override it.
Because `options.txt` is `preserve = true`, existing players must enable it once by hand
(or we ship a one-time migration) — note this in the release notes.
