// ch rp:build — zip src/resourcepack → pack/resourcepacks/ciancohorror-rp.zip (deterministic), refresh index.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, die, run as sh, refresh, walk } from '../lib/util.mjs';

export const help = 'rp:build                                 Build src/resourcepack into pack/resourcepacks/ciancohorror-rp.zip';

export async function run() {
  const src = path.join(P.src, 'resourcepack');
  if (!fs.existsSync(path.join(src, 'assets'))) die('src/resourcepack/assets does not exist yet — nothing to build');
  const files = walk(src, { skip: (r) => r.endsWith('.md') || r.endsWith('.DS_Store') });
  const out = path.join(P.pack, 'resourcepacks', 'ciancohorror-rp.zip');
  fs.rmSync(out, { force: true });
  // -X: no extra attrs; fixed mtime for reproducible hashes
  for (const f of files) fs.utimesSync(path.join(src, f), 315532800, 315532800);
  sh('zip', ['-qX', out, ...files], { cwd: src });
  refresh();
  log.ok(`built ${path.relative(P.root, out)} (${files.length} files)`);
}
