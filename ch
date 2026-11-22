#!/bin/sh
# Wrapper: ./ch <command> — see tools/ch.mjs
here="$(cd "$(dirname "$0")" && pwd)"
[ -d "$here/tools/node_modules" ] || (cd "$here/tools" && npm i --silent >/dev/null)
exec node "$here/tools/ch.mjs" "$@"
