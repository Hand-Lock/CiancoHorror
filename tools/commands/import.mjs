// ch import:prism — one-shot faithful import of the Prism instance into pack/ (exact versions/hashes).
// Re-runnable: overwrites pack/mods, pack/resourcepacks, pack/config, base/.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, die, readTOML, tomlStringify, walk, copyFile, matchAny, refresh, readJSON } from '../lib/util.mjs';
import { PRESERVE, LOCAL_ONLY, DROPPED } from '../lib/rules.mjs';
import { fetchBase, writeBaseSnapshot } from '../lib/base.mjs';
import { setPreserve } from '../lib/index-toml.mjs';

export const help = 'import:prism                             Import mods/configs from the Prism instance (exact versions)';

function convertMeta(t, { forceBoth }) {
  const side = forceBoth && t.side === 'server' ? 'both' : (t.side || 'both');
  const out = { name: t.name, filename: t.filename, side };
  out.download = { url: t.download.url, 'hash-format': t.download['hash-format'], hash: t.download.hash };
  if (t.update?.modrinth) out.update = { modrinth: { 'mod-id': t.update.modrinth['mod-id'], version: t.update.modrinth.version } };
  return tomlStringify(out) + '\n';
}

export async function run() {
  if (!fs.existsSync(P.mc)) die(`instance not found: ${P.mc}`);

  log.step('Mods + resource packs');
  const serverOnly = [];
  for (const [kind, sub] of [['mods', 'mods'], ['resourcepacks', 'resourcepacks']]) {
    const src = path.join(P.mc, sub, '.index');
    const dst = path.join(P.pack, kind);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.pw.toml'))) {
      const t = readTOML(path.join(src, f));
      if (!fs.existsSync(path.join(P.mc, sub, t.filename))) { log.warn(`skip ${f}: ${t.filename} not present`); continue; }
      if (t.side === 'server') serverOnly.push(t.name);
      fs.writeFileSync(path.join(dst, f), convertMeta(t, { forceBoth: true }));
    }
    log.ok(`${kind}: ${fs.readdirSync(dst).length}`);
  }
  log.info(`server-only → side=both: ${serverOnly.join(', ')}`);

  log.step('Configs');
  fs.rmSync(path.join(P.pack, 'config'), { recursive: true, force: true });
  const counts = { shipped: 0, preserved: 0, local: 0, dropped: 0 };
  for (const rel of walk(path.join(P.mc, 'config'), { rel: P.mc })) {
    if (matchAny(rel, DROPPED)) { counts.dropped++; log.info(color('dropped', rel)); continue; }
    if (matchAny(rel, LOCAL_ONLY)) { counts.local++; continue; }
    copyFile(path.join(P.mc, rel), path.join(P.pack, rel));
    matchAny(rel, PRESERVE) ? counts.preserved++ : counts.shipped++;
  }
  log.ok(`config: ${JSON.stringify(counts)}`);

  log.step('Base snapshot (Optimization)');
  const instCfg = fs.readFileSync(path.join(P.instance, 'instance.cfg'), 'utf8');
  const baseVid = /ManagedPackVersionID=(\S+)/.exec(instCfg)?.[1] || readJSON(path.join(P.base, 'base.json'), {}).versionId;
  if (!baseVid) die('cannot determine base version (instance no longer managed and base/base.json missing)');
  const snap = await fetchBase(baseVid);
  writeBaseSnapshot(snap);
  log.ok(`base: Optimization ${snap.versionNumber} (${snap.mods.length} mods, ${snap.overrides.length} overrides)`);

  log.step('options.txt (curated: base defaults + pack resource-pack order)');
  const baseOpts = fs.readFileSync(path.join(P.base, 'overrides', 'options.txt'), 'utf8').trimEnd().split('\n');
  const inst = fs.readFileSync(path.join(P.mc, 'options.txt'), 'utf8').split('\n');
  const keep = ['resourcePacks:', 'renderDistance:', 'musicToast:'];
  const extra = inst.filter((l) => keep.some((k) => l.startsWith(k)));
  const merged = [...baseOpts.filter((l) => !keep.some((k) => l.startsWith(k))), ...extra];
  fs.writeFileSync(path.join(P.pack, 'options.txt'), merged.join('\n') + '\n');
  log.ok(`options.txt: ${merged.length} lines`);

  log.step('Index');
  refresh();
  setPreserve(PRESERVE);
  refresh();
  log.ok('index.toml refreshed, preserve flags set');
}

const color = (tag, s) => `${tag}: ${s}`;
