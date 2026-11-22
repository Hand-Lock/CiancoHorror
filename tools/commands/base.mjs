// ch base:check / base:sync [versionId] — inherit upstream Optimization releases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P, log, color, table, readMods, packInfo, modrinth, tomlStringify, refresh, git, die, run as sh, readJSON, writeJSON } from '../lib/util.mjs';
import { baseVersions, fetchBase, currentBase, writeBaseSnapshot } from '../lib/base.mjs';
import { ensureJars, jarMeta } from '../lib/jars.mjs';

export const help = [
  'base:check                               Compare base/ with the newest Optimization release',
  'base:sync [versionId] [--dry-run] [--yes] Merge an Optimization release into the pack (3-way configs)',
];

const sideFromEnv = (env) => (env?.server === 'unsupported' ? 'client' : 'both');

async function plan(target) {
  const cur = currentBase();
  if (!cur) die('base/base.json missing — run ./ch import:prism first');
  const next = await fetchBase(target);
  const pack = readMods({ dirs: ['mods'] });
  const byProject = Object.fromEntries(pack.map((m) => [m.projectId, m]));
  const oldBy = Object.fromEntries(cur.mods.map((m) => [m.projectId, m]));
  const newBy = Object.fromEntries(next.mods.map((m) => [m.projectId, m]));
  const versionIds = [...new Set([...cur.mods, ...next.mods].map((m) => m.versionId).concat(pack.map((m) => m.versionId)))].filter(Boolean);
  const vs = Object.fromEntries((await modrinth.versions(versionIds)).map((v) => [v.id, v]));

  const actions = [];
  for (const [pid, nm] of Object.entries(newBy)) {
    const om = oldBy[pid];
    const ours = byProject[pid];
    const nv = vs[nm.versionId];
    if (!ours) { actions.push({ kind: 'add', pid, to: nv, env: nm.env }); continue; }
    if (ours.versionId === nm.versionId) continue;
    const ov = vs[ours.versionId];
    if (ov && nv && new Date(ov.date_published) > new Date(nv.date_published)) { actions.push({ kind: 'keep-ahead', pid, mod: ours, from: ov, to: nv }); continue; }
    actions.push({ kind: om ? 'bump' : 'adopt', pid, mod: ours, from: ov, to: nv });
  }
  for (const [pid, om] of Object.entries(oldBy)) {
    if (newBy[pid]) continue;
    const ours = byProject[pid];
    if (!ours) continue;
    actions.push({ kind: 'remove', pid, mod: ours, from: vs[om.versionId] });
  }

  // overrides
  const files = [...new Set([...cur.overrides, ...next.overrides])].sort();
  const overrides = [];
  for (const f of files) {
    const inOld = cur.overrides.includes(f), inNew = next.overrides.includes(f);
    const oldTxt = inOld ? fs.readFileSync(path.join(P.base, 'overrides', f)) : null;
    const newTxt = inNew ? fs.readFileSync(path.join(next.dir, 'overrides', f)) : null;
    const oursPath = path.join(P.pack, f);
    const hasOurs = fs.existsSync(oursPath);
    if (inOld && inNew && oldTxt.equals(newTxt)) continue;
    if (!inNew) { overrides.push({ f, kind: 'upstream-removed' }); continue; }
    if (!hasOurs) { overrides.push({ f, kind: 'add', newTxt }); continue; }
    overrides.push({ f, kind: 'merge', oldTxt: oldTxt ?? Buffer.alloc(0), newTxt, oursPath });
  }
  return { cur, next, actions, overrides, loaderChange: next.dependencies?.['fabric-loader'] !== cur.dependencies?.['fabric-loader'] ? next.dependencies['fabric-loader'] : null };
}

function printPlan({ cur, next, actions, overrides, loaderChange }) {
  console.log(`${color.bold('Optimization')} ${cur.versionNumber} → ${color.bold(next.versionNumber)} (${next.datePublished.slice(0, 10)})`);
  if (next.dependencies.minecraft !== packInfo().versions.minecraft) log.warn(`upstream targets MC ${next.dependencies.minecraft} — this is a version migration, handle manually`);
  if (loaderChange) log.info(`fabric-loader → ${loaderChange}`);
  if (actions.length) table(actions.map((a) => [a.kind, a.mod?.slug || a.to?.name || a.pid, a.from?.version_number || '', a.to?.version_number || '']), ['action', 'mod', 'ours', 'upstream']);
  else log.ok('no mod changes');
  for (const o of overrides) log.info(`override ${o.kind}: ${o.f}`);
}

async function addMod(v, env) {
  const [proj] = await modrinth.projects([v.project_id]);
  const file = v.files.find((f) => f.primary) || v.files[0];
  const meta = { name: proj.title, filename: file.filename, side: sideFromEnv(env),
    download: { url: file.url, 'hash-format': 'sha512', hash: file.hashes.sha512 },
    update: { modrinth: { 'mod-id': v.project_id, version: v.id } } };
  fs.writeFileSync(path.join(P.mods, `${proj.slug}.pw.toml`), tomlStringify(meta) + '\n');
  return proj.slug;
}

export async function run({ cmd, args, flags }) {
  const mc = packInfo().versions.minecraft;
  const list = await baseVersions(mc);
  if (!list.length) die(`no Optimization Fabric release for ${mc}`);
  const cur = currentBase();

  if (cmd === 'base:check') {
    const idx = list.findIndex((v) => v.id === cur?.versionId);
    const newer = idx < 0 ? list : list.slice(0, idx);
    if (!newer.length) return log.ok(`base is current: Optimization ${cur.versionNumber}`);
    log.info(`${newer.length} newer release(s): ${newer.map((v) => v.version_number).join(', ')}`);
    printPlan(await plan(newer[0]));
    console.log(color.dim('\nApply with ./ch base:sync'));
    return;
  }

  const target = args[0] ? list.find((v) => v.id === args[0] || v.version_number === args[0]) || args[0] : list[0];
  if ((target.id || target) === cur.versionId) return log.ok('already on that base version');
  const p = await plan(target);
  printPlan(p);
  if (flags['dry-run']) return;
  if (git(['status', '--porcelain', '--', 'pack', 'base'])) die('pack/ or base/ has uncommitted changes — commit or stash first');

  // mods
  const pack = readMods({ dirs: ['mods'] });
  const catalog = readJSON(path.join(P.docs, 'catalog.json'));
  for (const a of p.actions) {
    if (a.kind === 'add') {
      const slug = await addMod(a.to, a.env);
      catalog.mods[slug] ||= { category: 'base-perf', base: true, purpose: a.to.name, why: `Added by Optimization ${p.next.versionNumber}` };
      log.ok(`added ${slug}`);
    } else if (a.kind === 'bump' || a.kind === 'adopt') {
      const { writeVersion } = await import('./updates.mjs');
      writeVersion(a.mod, a.to);
      if (catalog.mods[a.mod.slug]) catalog.mods[a.mod.slug].base = true;
      log.ok(`${a.mod.slug} → ${a.to.version_number}`);
    } else if (a.kind === 'remove') {
      const others = pack.filter((m) => m.slug !== a.mod.slug);
      const jars = await ensureJars(others, { quiet: true });
      const removedId = jarMeta((await ensureJars([a.mod], { quiet: true }))[a.mod.slug]).id;
      const dependents = others.filter((m) => removedId && Object.keys(jarMeta(jars[m.slug]).depends).includes(removedId)).map((m) => m.slug);
      if (dependents.length) {
        log.warn(`upstream dropped ${a.mod.slug}, but ${dependents.join(', ')} depend on it — keeping it as our own mod`);
        if (catalog.mods[a.mod.slug]) { delete catalog.mods[a.mod.slug].base; catalog.mods[a.mod.slug].why += ` (dropped by base ${p.next.versionNumber}, kept for ${dependents.join(', ')})`; }
      } else {
        fs.rmSync(a.mod.file);
        delete catalog.mods[a.mod.slug];
        log.ok(`removed ${a.mod.slug} (dropped upstream)`);
      }
    } else if (a.kind === 'keep-ahead') {
      log.info(`kept ${a.mod.slug} ${a.from.version_number} (newer than upstream ${a.to.version_number})`);
    }
  }
  writeJSON(path.join(P.docs, 'catalog.json'), catalog);

  // overrides: 3-way merge (ours ← old base → new base)
  const conflicts = [];
  for (const o of p.overrides) {
    if (o.kind === 'add') { fs.mkdirSync(path.dirname(path.join(P.pack, o.f)), { recursive: true }); fs.writeFileSync(path.join(P.pack, o.f), o.newTxt); log.ok(`override added: ${o.f}`); continue; }
    if (o.kind === 'upstream-removed') { log.warn(`upstream no longer ships ${o.f}; keeping ours`); continue; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-merge-'));
    fs.writeFileSync(path.join(tmp, 'base'), o.oldTxt);
    fs.writeFileSync(path.join(tmp, 'theirs'), o.newTxt);
    let merged, conflict = false;
    try { merged = sh('git', ['merge-file', '-p', '-L', 'ours (pack)', '-L', 'old base', '-L', `Optimization ${p.next.versionNumber}`, o.oursPath, path.join(tmp, 'base'), path.join(tmp, 'theirs')]); }
    catch (e) { if (e.status > 0 && e.stdout) { merged = e.stdout; conflict = true; } else throw e; }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(o.oursPath, merged);
    conflict ? conflicts.push(o.f) : log.ok(`override merged: ${o.f}`);
  }

  if (p.loaderChange) {
    const t = fs.readFileSync(path.join(P.pack, 'pack.toml'), 'utf8').replace(/^fabric = ".*"$/m, `fabric = "${p.loaderChange}"`);
    fs.writeFileSync(path.join(P.pack, 'pack.toml'), t);
  }
  writeBaseSnapshot(p.next);
  refresh();

  if (conflicts.length) {
    log.err(`merge conflicts in: ${conflicts.join(', ')} — resolve the <<<<<<< markers, then: ./ch doctor && git commit`);
    process.exitCode = 1;
    return;
  }
  if (!flags['no-commit']) {
    git(['add', 'pack', 'base', 'docs/catalog.json']);
    git(['commit', '-q', '-m', `base: Optimization ${p.cur.versionNumber} → ${p.next.versionNumber}`]);
    log.ok('committed');
  }
}
