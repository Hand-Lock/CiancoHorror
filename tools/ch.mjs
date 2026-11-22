#!/usr/bin/env node
// ch — CiancoHorror modpack CLI. Run `./ch help`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// command name → module (commands/<file>.mjs); a module may export run(args, ctx) and help.
const COMMANDS = {
  doctor: 'doctor',
  updates: 'updates',
  'base:check': 'base', 'base:sync': 'base',
  'client:sync': 'client', 'client:pull': 'client',
  logs: 'logs',
  'server:local': 'server-local',
  server: 'server',
  release: 'release',
  'rp:build': 'rp',
  'import:prism': 'import',
};

function parseArgs(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? true; }
    else if (/^-[a-z]$/i.test(a)) flags[a.slice(1)] = true;
    else pos.push(a);
  }
  if (flags.y) flags.yes = true;
  return { flags, pos };
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log('ch — CiancoHorror modpack CLI\n\nUsage: ./ch <command> [args] [--yes] [--dry-run]\n');
  const seen = new Set();
  for (const file of Object.values(COMMANDS)) {
    if (seen.has(file)) continue; seen.add(file);
    const f = path.join(here, 'commands', `${file}.mjs`);
    if (!fs.existsSync(f)) continue;
    const m = await import(f);
    for (const line of [].concat(m.help || [])) console.log('  ' + line);
  }
  process.exit(0);
}
const file = COMMANDS[cmd];
if (!file) { console.error(`unknown command: ${cmd} (try ./ch help)`); process.exit(2); }
const mod = await import(path.join(here, 'commands', `${file}.mjs`));
const { flags, pos } = parseArgs(rest);
try {
  await mod.run({ cmd, args: pos, flags });
} catch (e) {
  console.error('\x1b[31m✗\x1b[0m', flags.debug ? e.stack : e.message);
  process.exit(1);
}
