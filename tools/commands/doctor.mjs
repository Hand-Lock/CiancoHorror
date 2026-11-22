// ch doctor — consistency checks for the pack.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, git, refresh, readMods, packInfo, modrinth, readJSON, matchAny } from '../lib/util.mjs';
import { ensureJars, jarMeta, allIds } from '../lib/jars.mjs';
import { DROPPED, LOCAL_ONLY } from '../lib/rules.mjs';
import { satisfies } from '../lib/semver.mjs';
import { ownerResolver } from '../lib/configs.mjs';
import { baseProjectIds } from '../lib/base.mjs';

export const help = 'doctor [--offline]                       Check pack consistency (versions, deps, dup ids, catalog, orphan configs)';

const IGNORE_DEPS = new Set(['minecraft', 'fabricloader', 'java', 'fabric', 'fabric-api']);

export async function run({ flags }) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });
  const pack = packInfo();
  const mc = pack.versions.minecraft;

  // 1. refresh idempotence
  refresh();
  const dirty = git(['status', '--porcelain', '--', 'pack/index.toml', 'pack/pack.toml']);
  if (dirty) add('warn', 'packwiz refresh changed index.toml/pack.toml (uncommitted pack edits?)');

  const all = readMods();
  const mods = all.filter((m) => m.dir === 'mods');
  for (const m of all) if (!m.projectId) add('warn', `${m.slug}: no Modrinth update source (manual updates only)`);

  // 2. Modrinth: version compatibility + required deps
  if (!flags.offline) {
    const versions = await modrinth.versions(all.filter((m) => m.versionId).map((m) => m.versionId));
    const byId = Object.fromEntries(versions.map((v) => [v.id, v]));
    const projects = new Set(all.map((m) => m.projectId).filter(Boolean));
    const names = Object.fromEntries(all.map((m) => [m.projectId, m.name]));
    const missingDeps = new Set();
    for (const m of all) {
      const v = byId[m.versionId];
      if (!v) { if (m.versionId) add('error', `${m.slug}: version ${m.versionId} not found on Modrinth`); continue; }
      const isMod = m.dir === 'mods';
      if (!v.game_versions.includes(mc)) add('warn', `${m.slug}: ${v.version_number} not tagged for ${mc} (tagged ${v.game_versions.slice(-3).join(', ')})`);
      if (isMod && !v.loaders.includes('fabric')) add('error', `${m.slug}: ${v.version_number} is not a Fabric build (${v.loaders})`);
      for (const d of v.dependencies || []) {
        if (!d.project_id) continue;
        if (d.dependency_type === 'required' && !projects.has(d.project_id)) missingDeps.add(`${m.slug} → ${d.project_id}`);
        if (d.dependency_type === 'incompatible' && projects.has(d.project_id)) add('error', `${m.slug} is incompatible with ${names[d.project_id]}`);
      }
    }
    if (missingDeps.size) {
      const ps = await modrinth.projects([...missingDeps].map((s) => s.split(' → ')[1]));
      const pn = Object.fromEntries(ps.map((p) => [p.id, p.slug]));
      for (const s of missingDeps) { const [a, b] = s.split(' → '); add('warn', `${a}: Modrinth lists required dep "${pn[b] || b}" which is not in the pack (may be bundled)`); }
    }
  }

  // 3. jar-level: duplicate ids, unmet fabric.mod.json depends
  const jars = await ensureJars(mods, { quiet: true });
  const metas = Object.fromEntries(mods.map((m) => [m.slug, jarMeta(jars[m.slug])]));
  const ids = allIds(Object.values(metas));
  const versionOf = {};
  for (const meta of Object.values(metas)) {
    if (meta.id) versionOf[meta.id] = meta.version;
    for (const n of meta.nested) if (n.id && !versionOf[n.id]) versionOf[n.id] = n.version;
  }
  const seen = {};
  for (const [slug, meta] of Object.entries(metas)) {
    if (!meta.id) { add('warn', `${slug}: jar has no fabric.mod.json`); continue; }
    (seen[meta.id] ||= []).push(slug);
    for (const dep of Object.keys(meta.depends)) {
      if (IGNORE_DEPS.has(dep) || dep.startsWith('fabric-')) continue;
      if (!ids.has(dep)) add('error', `${slug}: fabric.mod.json depends on "${dep}" which no jar provides`);
    }
    for (const [b, pred] of Object.entries(meta.breaks)) {
      const v = versionOf[b];
      if (v && satisfies(v, pred)) add('error', `${slug}: breaks ${b} ${pred} — installed ${v}`);
    }
  }
  for (const [id, slugs] of Object.entries(seen)) if (slugs.length > 1) add('error', `duplicate mod id "${id}": ${slugs.join(', ')}`);

  // 3b. per-side deps: each side's set must be self-sufficient
  for (const [side, keep] of [['server', (m) => m.side !== 'client'], ['client', (m) => m.side !== 'server']]) {
    const set = mods.filter(keep);
    const sideIds = allIds(set.map((m) => metas[m.slug]));
    for (const m of set) for (const dep of Object.keys(metas[m.slug].depends || {})) {
      if (IGNORE_DEPS.has(dep) || dep.startsWith('fabric-')) continue;
      if (ids.has(dep) && !sideIds.has(dep)) add('error', `${m.slug} (side ${m.side}) depends on "${dep}", which is not in the ${side} set — fix its side`);
    }
  }

  // 4. catalog coverage
  const catalog = readJSON(path.join(P.docs, 'catalog.json'), { mods: {} });
  for (const m of all) if (!catalog.mods?.[m.slug]) add('warn', `${m.slug}: missing from docs/catalog.json`);
  for (const slug of Object.keys(catalog.mods || {})) if (!all.find((m) => m.slug === slug)) add('warn', `catalog entry "${slug}" has no mod in the pack`);
  const inBases = baseProjectIds();
  for (const m of mods) {
    const want = (inBases.get(m.projectId) || []).sort().join(',');
    const have = [...(catalog.mods?.[m.slug]?.base || [])].sort().join(',');
    if (catalog.mods?.[m.slug] && want !== have) add('warn', `${m.slug}: catalog base flag [${have}] ≠ bases that ship it [${want}]`);
  }

  // 5. config hygiene (pack/config for all mods, server/overrides/config for the server set)
  const owner = ownerResolver(jars);
  const serverSlugs = new Set(mods.filter((m) => m.side !== 'client').map((m) => m.slug));
  for (const [root, serverOnly] of [[path.join(P.pack, 'config'), false], [path.join(P.server, 'overrides', 'config'), true]]) {
    if (!fs.existsSync(root)) continue;
    const shown = path.relative(P.root, root);
    for (const e of fs.readdirSync(root)) {
      if (e === '.DS_Store') continue;
      const rel = `config/${e}`;
      if (matchAny(rel, DROPPED) || matchAny(rel + '/x', DROPPED)) { add('error', `${shown}/${e}: leftover from a removed mod (rules.mjs DROPPED)`); continue; }
      if (matchAny(rel, LOCAL_ONLY)) { add('error', `${shown}/${e}: machine-local file is being shipped (rules.mjs LOCAL_ONLY)`); continue; }
      const o = owner(e);
      if (!o) { add('warn', `${shown}/${e}: no mod references it — orphaned config?`); continue; }
      if (!o.slug) { add('warn', `${shown}/${e}: owner "${o.id}" not in pack — orphan?`); continue; }
      if (serverOnly && !serverSlugs.has(o.slug)) add('warn', `${shown}/${e}: owner ${o.slug} is not in the server set`);
      if (flags.verbose) log.info(`${shown}/${e} ← ${o.slug} (${o.how})`);
    }
  }

  // report
  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  for (const i of errs) log.err(i.msg);
  for (const i of warns) log.warn(i.msg);
  console.log();
  const summary = `${all.length} entries (${mods.length} mods) · ${errs.length} errors · ${warns.length} warnings`;
  errs.length ? log.err(summary) : log.ok(color.green(summary));
  if (errs.length) process.exitCode = 1;
}
