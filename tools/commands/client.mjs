// ch client:sync — install the working-tree pack into the Prism instance (local packwiz serve).
// ch client:pull — copy configs changed in-game back into pack/config.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, die, servePack, installPack, walk, matchAny, copyFile, git, refresh, run as sh, confirm } from '../lib/util.mjs';
import { PRESERVE, LOCAL_ONLY, DROPPED, PULL_ROOTS } from '../lib/rules.mjs';

export const help = [
  'client:sync                              Install the current pack into the Prism instance (game must be closed)',
  'client:pull [--yes] [--include-preserved] Copy in-game config changes back into pack/config, show diff',
];

function gameRunning() {
  try { return sh('pgrep', ['-f', `instances/${path.basename(P.instance)}/minecraft`]).trim().length > 0; } catch { return false; }
}

async function sync() {
  if (!fs.existsSync(P.mc)) die(`instance not found: ${P.mc}`);
  if (gameRunning()) die('Minecraft is running from this instance — close it first');
  const cfg = fs.readFileSync(path.join(P.instance, 'instance.cfg'), 'utf8');
  if (/^ManagedPack=true/m.test(cfg)) log.warn('instance is still flagged ManagedPack=true (Prism "Update" would replace the pack) — see README migration');
  refresh();
  const srv = await servePack();
  try { await installPack(srv.url, P.mc, 'client'); } finally { srv.stop(); }
  log.ok('instance synced to working tree');
}

function pull(flags) {
  const changed = [], added = [];
  for (const root of PULL_ROOTS) {
    for (const rel of walk(path.join(P.mc, root), { rel: P.mc })) {
      if (matchAny(rel, LOCAL_ONLY) || matchAny(rel, DROPPED)) continue;
      if (matchAny(rel, PRESERVE) && !flags['include-preserved']) continue;
      const src = path.join(P.mc, rel), dst = path.join(P.pack, rel);
      if (!fs.existsSync(dst)) added.push(rel);
      else if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) changed.push(rel);
    }
  }
  if (!changed.length && !added.length) return log.ok('no config changes in the instance');
  for (const c of changed) console.log(`  ${color.yellow('M')} ${c}`);
  for (const a of added) console.log(`  ${color.green('A')} ${a}`);
  return { changed, added };
}

export async function run({ cmd, flags }) {
  if (cmd === 'client:sync') return sync();
  const res = pull(flags);
  if (!res) return;
  if (!(await confirm(`\ncopy ${res.changed.length + res.added.length} file(s) into pack/?`, { yes: flags.yes }))) return log.info('nothing copied (use --yes)');
  for (const rel of [...res.changed, ...res.added]) copyFile(path.join(P.mc, rel), path.join(P.pack, rel));
  refresh();
  console.log(git(['diff', '--stat', '--', 'pack']));
  if (res.added.length) log.info('new files: if any are caches/personal, add them to tools/lib/rules.mjs LOCAL_ONLY and delete from pack/');
  log.ok('review with `git diff pack/config`, then commit');
}
