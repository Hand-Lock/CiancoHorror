// Build the server-side file set from the pack (packwiz-installer -s server) + datapack.
import fs from 'node:fs';
import path from 'node:path';
import { P, servePack, installPack, walk, matchAny, hashFile, log } from './util.mjs';
import { deployCfg } from './exaroton.mjs';

/**
 * Returns { dir, files: [{ rel, remote, abs, sha256, size }] } where `rel` is the path inside the
 * staging dir and `remote` is the path on the server (datapack files are mapped under <level>/datapacks).
 */
export async function buildServerStage({ levelName = 'world', quiet = false } = {}) {
  const cfg = deployCfg();
  const dir = path.join(P.build, 'server-stage');
  if (!quiet) log.info('building server staging set (packwiz-installer -s server)…');
  const srv = await servePack();
  try { await installPack(srv.url, dir, 'server'); } finally { srv.stop(); }

  const files = [];
  for (const rel of walk(dir)) {
    if (!matchAny(rel, cfg.include) || matchAny(rel, cfg.exclude)) continue;
    const abs = path.join(dir, rel);
    files.push({ rel, remote: rel, abs, sha256: hashFile(abs, 'sha256'), size: fs.statSync(abs).size });
  }
  // datapack (folder form) → <level>/datapacks/<name>/
  const dpSrc = path.join(P.root, cfg.datapack.src);
  if (fs.existsSync(path.join(dpSrc, 'pack.mcmeta'))) {
    for (const rel of walk(dpSrc, { skip: (r) => r.endsWith('.md') })) {
      const abs = path.join(dpSrc, rel);
      files.push({ rel: `datapack/${rel}`, remote: `${levelName}/datapacks/${cfg.datapack.name}/${rel}`, abs, sha256: hashFile(abs, 'sha256'), size: fs.statSync(abs).size });
    }
  }
  return { dir, files };
}
