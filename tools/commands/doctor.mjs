// ch doctor — consistency checks for the pack.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, git, refresh, readMods, packInfo, modrinth, readJSON, matchAny } from '../lib/util.mjs';
import { ensureJars, jarMeta, allIds, jarMentions } from '../lib/jars.mjs';
import { DROPPED, LOCAL_ONLY } from '../lib/rules.mjs';
import { satisfies } from '../lib/semver.mjs';

export const help = 'doctor [--offline]                       Check pack consistency (versions, deps, dup ids, catalog, orphan configs)';

// Config names that don't match their owner's mod id (config name → owning mod id).
const CONFIG_OWNERS = {
  'animatium3.json': 'animatium',
  'hollow-reborn.json': 'hollowreborn',
  'yacl.json5': 'yet_another_config_lib_v3',
  'serilum': 'collective',
  'face_of_horror-default-server.toml': 'face_of_horror',
  'SoundPhysicsPerfected.json5': 'sound_physics_perfected',
  'murk.json5': 'murk',
};
const IGNORE_DEPS = new Set(['minecraft', 'fabricloader', 'java', 'fabric', 'fabric-api']);

const norm = (s) => s.toLowerCase().replace(/\.(json5?|jsonc|toml|properties|txt|cfg)$/, '')
  .replace(/[-_.](client|common|server|default-server|mixins?|mixin|options|config|prefs)$/g, '')
  .replace(/[-_.](client|common|server|mixins?)$/g, '').replace(/[^a-z0-9]/g, '');

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

  // 4. catalog coverage
  const catalog = readJSON(path.join(P.docs, 'catalog.json'), { mods: {} });
  for (const m of all) if (!catalog.mods?.[m.slug]) add('warn', `${m.slug}: missing from docs/catalog.json`);
  for (const slug of Object.keys(catalog.mods || {})) if (!all.find((m) => m.slug === slug)) add('warn', `catalog entry "${slug}" has no mod in the pack`);

  // 5. config hygiene
  const cfgRoot = path.join(P.pack, 'config');
  const entries = fs.existsSync(cfgRoot) ? fs.readdirSync(cfgRoot) : [];
  for (const e of entries) {
    const rel = `config/${e}`;
    if (matchAny(rel, DROPPED) || matchAny(rel + '/x', DROPPED)) { add('error', `${rel}: leftover from a removed mod (rules.mjs DROPPED)`); continue; }
    if (matchAny(rel, LOCAL_ONLY)) { add('error', `${rel}: machine-local file is being shipped (rules.mjs LOCAL_ONLY)`); continue; }
    const owner = CONFIG_OWNERS[e];
    if (owner) { if (!ids.has(owner)) add('warn', `${rel}: owner "${owner}" not in pack — orphan?`); continue; }
    const key = norm(e);
    const hit = [...ids].some((id) => { const n = id.toLowerCase().replace(/[^a-z0-9]/g, ''); return n.length >= 3 && (n === key || key.startsWith(n) || n.startsWith(key)); });
    if (hit) continue;
    const stem = e.replace(/\.[^.]+$/, '');
    const mention = Object.entries(jars).find(([, j]) => jarMentions(j, stem));
    if (!mention) add('warn', `${rel}: no mod references it — orphaned config?`);
    else if (flags.verbose) log.info(`${rel} ← ${mention[0]}`);
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
