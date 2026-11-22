// Build the server-side file set: pack (packwiz-installer -s server) → only configs owned by server-side mods
// → server/overrides/** on top (Server Optimization base + our server tuning) → datapack.
import fs from 'node:fs';
import path from 'node:path';
import { P, servePack, installPack, walk, matchAny, hashFile, log, readMods } from './util.mjs';
import { deployCfg } from './exaroton.mjs';
import { ensureJars } from './jars.mjs';
import { ownerResolver } from './configs.mjs';

export const SERVER_OVERRIDES = path.join(P.server, 'overrides');

const entry = (rel, remote, abs) => ({ rel, remote, abs, sha256: hashFile(abs, 'sha256'), size: fs.statSync(abs).size });

/**
 * Returns { dir, files: [{ rel, remote, abs, sha256, size }], skipped: [rel] } where `remote` is the path on
 * the server (datapack files are mapped under <level>/datapacks/<name>/).
 */
export async function buildServerStage({ levelName = 'world', quiet = false } = {}) {
  const cfg = deployCfg();
  const dir = path.join(P.build, 'server-stage');
  if (!quiet) log.info('building server staging set (packwiz-installer -s server)…');
  const srv = await servePack();
  try { await installPack(srv.url, dir, 'server'); } finally { srv.stop(); }

  // config ownership → drop configs of client-only mods
  const mods = readMods({ dirs: ['mods'] });
  const jars = await ensureJars(mods, { quiet: true });
  const owner = ownerResolver(jars);
  const sideOf = Object.fromEntries(mods.map((m) => [m.slug, m.side]));

  const byRemote = new Map();
  const skipped = [];
  const installed = new Set(fs.existsSync(path.join(dir, 'mods')) ? fs.readdirSync(path.join(dir, 'mods')) : []);
  const expected = new Set(mods.filter((m) => m.side !== 'client').map((m) => m.filename));
  for (const rel of walk(dir)) {
    if (!matchAny(rel, cfg.include) || matchAny(rel, cfg.exclude)) continue;
    // the stage dir is reused: ignore jars from earlier runs that are no longer in the server set
    if (rel.startsWith('mods/') && !expected.has(path.basename(rel))) continue;
    if (rel.startsWith('config/')) {
      const o = owner(rel.split('/')[1]);
      if (o?.slug && sideOf[o.slug] === 'client') { skipped.push(rel); continue; }
    }
    byRemote.set(rel, entry(rel, rel, path.join(dir, rel)));
  }
  for (const f of expected) if (!installed.has(f)) log.warn(`server stage is missing mods/${f}`);

  // server overrides win over pack files
  if (fs.existsSync(SERVER_OVERRIDES)) {
    for (const rel of walk(SERVER_OVERRIDES, { skip: (r) => r.endsWith('.md') || r.endsWith('.DS_Store') })) {
      byRemote.set(rel, entry(`overrides/${rel}`, rel, path.join(SERVER_OVERRIDES, rel)));
    }
  }

  // datapack (folder form) → <level>/datapacks/<name>/
  const dpSrc = path.join(P.root, cfg.datapack.src);
  if (fs.existsSync(path.join(dpSrc, 'pack.mcmeta'))) {
    for (const rel of walk(dpSrc, { skip: (r) => r.endsWith('.md') })) {
      const remote = `${levelName}/datapacks/${cfg.datapack.name}/${rel}`;
      byRemote.set(remote, entry(`datapack/${rel}`, remote, path.join(dpSrc, rel)));
    }
  }
  return { dir, files: [...byRemote.values()], skipped };
}
