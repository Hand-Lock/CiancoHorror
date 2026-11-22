// ch updates — find (and optionally apply) Modrinth updates for every metafile.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, table, readMods, packInfo, modrinth, tomlStringify, refresh, git, die } from '../lib/util.mjs';
import { currentBase } from '../lib/base.mjs';

export const help = [
  'updates [--release-only]                 List available updates (Modrinth hash check)',
  'updates --apply <slug…|all> [--no-commit] Apply updates (exact versions), one commit per batch',
];

/** Returns [{ mod, current, latest }] for mods with a newer compatible version. */
export async function findUpdates({ releaseOnly = false } = {}) {
  const pack = packInfo();
  const mc = pack.versions.minecraft;
  const mods = readMods().filter((m) => m.projectId && !m.pin && m.hashFormat === 'sha512');
  const groups = { mods: ['fabric'], resourcepacks: ['minecraft'], shaderpacks: ['iris', 'optifine', 'minecraft'] };
  const out = [];
  for (const [dir, loaders] of Object.entries(groups)) {
    const set = mods.filter((m) => m.dir === dir);
    if (!set.length) continue;
    const body = { hashes: set.map((m) => m.hash), algorithm: 'sha512', loaders, game_versions: [mc] };
    if (releaseOnly) body.version_types = ['release'];
    const res = await modrinth.post('/version_files/update', body);
    const cur = await modrinth.versions(set.map((m) => m.versionId));
    const curById = Object.fromEntries(cur.map((v) => [v.id, v]));
    for (const m of set) {
      const latest = res[m.hash];
      if (!latest || latest.id === m.versionId) continue;
      const current = curById[m.versionId];
      // never "update" to something older (can happen when the current version was yanked from the channel)
      if (current && new Date(latest.date_published) <= new Date(current.date_published)) continue;
      out.push({ mod: m, current, latest });
    }
  }
  return out;
}

export function writeVersion(m, v) {
  const file = v.files.find((f) => f.primary) || v.files[0];
  const t = structuredClone(m.raw);
  t.filename = file.filename;
  t.download = { url: file.url, 'hash-format': 'sha512', hash: file.hashes.sha512 };
  t.update = { ...(t.update || {}), modrinth: { 'mod-id': v.project_id, version: v.id } };
  const { name, filename, side, ...rest } = t;
  fs.writeFileSync(m.file, tomlStringify({ name, filename, side: side || 'both', ...rest }) + '\n');
}

export async function run({ args, flags }) {
  const ups = await findUpdates({ releaseOnly: !!flags['release-only'] });
  const base = currentBase();
  const baseProjects = new Set((base?.mods || []).map((b) => b.projectId));
  if (!ups.length) return log.ok('everything up to date');

  const typeColor = (t) => (t === 'release' ? color.green(t) : t === 'beta' ? color.yellow(t) : color.red(t));
  table(ups.map(({ mod, current, latest }) => [
    mod.slug, current?.version_number ?? '?', latest.version_number, typeColor(latest.version_type),
    latest.date_published.slice(0, 10), baseProjects.has(mod.projectId) ? color.dim('base') : '',
  ]), ['mod', 'current', 'latest', 'type', 'published', '']);

  if (!flags.apply) {
    console.log(color.dim(`\n${ups.length} updates. Apply with: ./ch updates --apply <slug…|all>`));
    return;
  }
  const want = flags.apply === true ? args : [flags.apply, ...args];
  const chosen = want.includes('all') ? ups : ups.filter((u) => want.includes(u.mod.slug));
  const unknown = want.filter((w) => w !== 'all' && !ups.find((u) => u.mod.slug === w));
  if (unknown.length) die(`no update available for: ${unknown.join(', ')}`);
  if (!chosen.length) die('nothing selected');

  for (const { mod, latest } of chosen) writeVersion(mod, latest);
  refresh();
  log.ok(`applied ${chosen.length} updates`);
  const ahead = chosen.filter((u) => baseProjects.has(u.mod.projectId));
  if (ahead.length) log.info(`now ahead of base: ${ahead.map((u) => u.mod.slug).join(', ')} (base:sync keeps the newer one)`);

  if (!flags['no-commit']) {
    const lines = chosen.map(({ mod, current, latest }) => `- ${mod.name}: ${current?.version_number ?? '?'} → ${latest.version_number}${latest.version_type !== 'release' ? ` (${latest.version_type})` : ''}`);
    git(['add', 'pack']);
    git(['commit', '-q', '-m', `update: ${chosen.length === 1 ? chosen[0].mod.name : `${chosen.length} mods`}\n\n${lines.join('\n')}`]);
    log.ok('committed');
  }
}
