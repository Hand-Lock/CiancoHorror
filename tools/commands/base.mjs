// ch base:check [client|server] / base:sync <client|server> [version] — inherit upstream base releases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P, log, color, table, readMods, packInfo, modrinth, tomlStringify, refresh, git, die, run as sh, readJSON, writeJSON } from '../lib/util.mjs';
import { BASES, baseKeys, getBase, baseVersions, fetchBase, currentBase, writeBaseSnapshot } from '../lib/base.mjs';
import { parseProps, patchProps } from '../lib/exaroton.mjs';
import { ensureJars, jarMeta } from '../lib/jars.mjs';

export const help = [
  'base:check [client|server]               Compare base/ with the newest Optimization / Server Optimization release',
  'base:sync <client|server> [version] [--dry-run] [--no-commit]  Merge a base release (mods + 3-way configs)',
];

const rel = (f) => path.relative(P.root, f);

async function plan(b, target) {
  const cur = currentBase(b);
  if (!cur) die(`${rel(b.dir)}/base.json missing`);
  const next = await fetchBase(b, target);
  const pack = readMods({ dirs: ['mods'] });
  const byProject = Object.fromEntries(pack.map((m) => [m.projectId, m]));
  const oldBy = Object.fromEntries(cur.mods.map((m) => [m.projectId, m]));
  const newBy = Object.fromEntries(next.mods.map((m) => [m.projectId, m]));
  const otherBases = Object.values(BASES).filter((o) => o.key !== b.key).map((o) => currentBase(o)).filter(Boolean);
  const versionIds = [...new Set([...cur.mods, ...next.mods].map((m) => m.versionId).concat(pack.map((m) => m.versionId)))].filter(Boolean);
  const vs = Object.fromEntries((await modrinth.versions(versionIds)).map((v) => [v.id, v]));

  const actions = [];
  for (const [pid, nm] of Object.entries(newBy)) {
    const ours = byProject[pid];
    const nv = vs[nm.versionId];
    if (!ours) { actions.push({ kind: 'add', pid, to: nv, env: nm.env }); continue; }
    if (ours.versionId === nm.versionId) continue;
    const ov = vs[ours.versionId];
    if (ov && nv && new Date(ov.date_published) > new Date(nv.date_published)) { actions.push({ kind: 'keep-ahead', pid, mod: ours, from: ov, to: nv }); continue; }
    actions.push({ kind: oldBy[pid] ? 'bump' : 'adopt', pid, mod: ours, from: ov, to: nv });
  }
  for (const [pid, om] of Object.entries(oldBy)) {
    if (newBy[pid] || !byProject[pid]) continue;
    const stillIn = otherBases.find((o) => o.mods.some((m) => m.projectId === pid));
    actions.push({ kind: stillIn ? 'unflag' : 'remove', pid, mod: byProject[pid], from: vs[om.versionId], other: stillIn?.title });
  }

  // overrides
  const files = [...new Set([...cur.overrides, ...next.overrides])].sort();
  const overrides = [];
  for (const f of files) {
    const target = b.target(f);
    if (!target) continue;
    const inOld = cur.overrides.includes(f), inNew = next.overrides.includes(f);
    const oldTxt = inOld ? fs.readFileSync(path.join(b.dir, 'overrides', f)) : Buffer.alloc(0);
    const newTxt = inNew ? fs.readFileSync(path.join(next.dir, 'overrides', f)) : null;
    if (inOld && inNew && oldTxt.equals(newTxt)) continue;
    if (!inNew) { overrides.push({ f, target, kind: 'upstream-removed' }); continue; }
    const kind = f === 'server.properties' && b.key === 'server' ? 'props' : fs.existsSync(target) ? 'merge' : 'add';
    overrides.push({ f, target, kind, oldTxt, newTxt });
  }
  const loaderChange = next.dependencies?.['fabric-loader'] !== cur.dependencies?.['fabric-loader'] ? next.dependencies['fabric-loader'] : null;
  return { b, cur, next, actions, overrides, loaderChange };
}

function printPlan({ b, cur, next, actions, overrides, loaderChange }) {
  console.log(`${color.bold(b.title)} ${cur.versionNumber} → ${color.bold(next.versionNumber)} (${next.datePublished.slice(0, 10)})`);
  if (next.dependencies.minecraft !== packInfo().versions.minecraft) log.warn(`upstream targets MC ${next.dependencies.minecraft} — this is a version migration, handle manually`);
  if (loaderChange) log.info(`fabric-loader → ${loaderChange}${b.key === 'server' ? ' (server base; pack.toml follows the client base)' : ''}`);
  if (actions.length) table(actions.map((a) => [a.kind, a.mod?.slug || a.to?.name || a.pid, a.from?.version_number || '', a.to?.version_number || a.other || '']), ['action', 'mod', 'ours', 'upstream']);
  else log.ok('no mod changes');
  for (const o of overrides) log.info(`override ${o.kind}: ${o.f} → ${rel(o.target)}`);
}

async function addMod(b, v, env) {
  const [proj] = await modrinth.projects([v.project_id]);
  const file = v.files.find((f) => f.primary) || v.files[0];
  const meta = { name: proj.title, filename: file.filename, side: b.sideFor(env),
    download: { url: file.url, 'hash-format': 'sha512', hash: file.hashes.sha512 },
    update: { modrinth: { 'mod-id': v.project_id, version: v.id } } };
  fs.writeFileSync(path.join(P.mods, `${proj.slug}.pw.toml`), tomlStringify(meta) + '\n');
  return proj.slug;
}

const flag = (entry, key, on) => {
  const s = new Set(entry.base || []);
  on ? s.add(key) : s.delete(key);
  if (s.size) entry.base = baseKeys.filter((k) => s.has(k)); else delete entry.base;
};

/** server.properties from a base: take upstream's new value unless we changed that key ourselves. */
function mergeProps(target, oldTxt, newTxt) {
  const ours = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const om = parseProps(oldTxt.toString('utf8')), nm = parseProps(newTxt.toString('utf8')), cur = parseProps(ours);
  const updates = {}, kept = [];
  for (const [k, v] of nm) {
    if (om.get(k) === v) continue;
    if (cur.has(k) && om.has(k) && cur.get(k) !== om.get(k)) { kept.push(k); continue; }
    updates[k] = v;
  }
  fs.writeFileSync(target, patchProps(ours, updates));
  return { updates, kept };
}

async function sync(b, args, flags) {
  const mc = packInfo().versions.minecraft;
  const list = await baseVersions(b, mc);
  if (!list.length) die(`no ${b.title} Fabric release for ${mc}`);
  const cur = currentBase(b);
  const target = args[0] ? list.find((v) => v.id === args[0] || v.version_number === args[0]) || args[0] : list[0];
  if ((target.id || target) === cur.versionId) return log.ok(`already on ${b.title} ${cur.versionNumber}`);
  const p = await plan(b, target);
  printPlan(p);
  if (flags['dry-run']) return;
  if (git(['status', '--porcelain', '--', 'pack', 'base', 'server'])) die('pack/, base/ or server/ has uncommitted changes — commit or stash first');

  const pack = readMods({ dirs: ['mods'] });
  const catalog = readJSON(path.join(P.docs, 'catalog.json'));
  for (const a of p.actions) {
    if (a.kind === 'add') {
      const slug = await addMod(b, a.to, a.env);
      catalog.mods[slug] ||= { category: 'base-perf', purpose: a.to.name, why: `Added by ${b.title} ${p.next.versionNumber}` };
      flag(catalog.mods[slug], b.key, true);
      log.ok(`added ${slug} (side ${b.sideFor(a.env)})`);
    } else if (a.kind === 'bump' || a.kind === 'adopt') {
      const { writeVersion } = await import('./updates.mjs');
      writeVersion(a.mod, a.to);
      if (catalog.mods[a.mod.slug]) flag(catalog.mods[a.mod.slug], b.key, true);
      log.ok(`${a.mod.slug} → ${a.to.version_number}`);
    } else if (a.kind === 'unflag') {
      if (catalog.mods[a.mod.slug]) flag(catalog.mods[a.mod.slug], b.key, false);
      log.info(`${a.mod.slug}: dropped by ${b.title}, still in ${a.other} — kept`);
    } else if (a.kind === 'remove') {
      const others = pack.filter((m) => m.slug !== a.mod.slug);
      const jars = await ensureJars(others, { quiet: true });
      const removedId = jarMeta((await ensureJars([a.mod], { quiet: true }))[a.mod.slug]).id;
      const dependents = others.filter((m) => removedId && Object.keys(jarMeta(jars[m.slug]).depends).includes(removedId)).map((m) => m.slug);
      if (dependents.length) {
        log.warn(`upstream dropped ${a.mod.slug}, but ${dependents.join(', ')} depend on it — keeping it as our own mod`);
        if (catalog.mods[a.mod.slug]) { flag(catalog.mods[a.mod.slug], b.key, false); catalog.mods[a.mod.slug].why += ` (dropped by ${b.title} ${p.next.versionNumber}, kept for ${dependents.join(', ')})`; }
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
    if (o.kind === 'upstream-removed') { log.warn(`upstream no longer ships ${o.f}; keeping ${rel(o.target)}`); continue; }
    if (o.kind === 'add') { fs.mkdirSync(path.dirname(o.target), { recursive: true }); fs.writeFileSync(o.target, o.newTxt); log.ok(`override added: ${rel(o.target)}`); continue; }
    if (o.kind === 'props') {
      const { updates, kept } = mergeProps(o.target, o.oldTxt, o.newTxt);
      log.ok(`server.properties keys from base: ${Object.keys(updates).join(', ') || '(none)'}${kept.length ? ` · kept ours: ${kept.join(', ')}` : ''}`);
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-merge-'));
    fs.writeFileSync(path.join(tmp, 'base'), o.oldTxt);
    fs.writeFileSync(path.join(tmp, 'theirs'), o.newTxt);
    let merged, conflict = false;
    try { merged = sh('git', ['merge-file', '-p', '-L', 'ours', '-L', 'old base', '-L', `${b.title} ${p.next.versionNumber}`, o.target, path.join(tmp, 'base'), path.join(tmp, 'theirs')]); }
    catch (e) { if (e.status > 0 && e.stdout) { merged = e.stdout; conflict = true; } else throw e; }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(o.target, merged);
    conflict ? conflicts.push(rel(o.target)) : log.ok(`override merged: ${rel(o.target)}`);
  }

  if (p.loaderChange && b.key === 'client') {
    const t = fs.readFileSync(path.join(P.pack, 'pack.toml'), 'utf8').replace(/^fabric = ".*"$/m, `fabric = "${p.loaderChange}"`);
    fs.writeFileSync(path.join(P.pack, 'pack.toml'), t);
  }
  writeBaseSnapshot(b, p.next);
  refresh();

  if (conflicts.length) {
    log.err(`merge conflicts in: ${conflicts.join(', ')} — resolve the <<<<<<< markers, then: ./ch doctor && git commit`);
    process.exitCode = 1;
    return;
  }
  if (!flags['no-commit']) {
    git(['add', 'pack', 'base', 'server', 'docs/catalog.json']);
    git(['commit', '-q', '-m', `base: ${b.title} ${p.cur.versionNumber} → ${p.next.versionNumber}`]);
    log.ok('committed');
  }
}

async function check(b) {
  const mc = packInfo().versions.minecraft;
  const list = await baseVersions(b, mc);
  const cur = currentBase(b);
  if (!list.length) return log.warn(`${b.title}: no Fabric release for ${mc}`);
  const idx = list.findIndex((v) => v.id === cur?.versionId);
  const newer = idx < 0 ? list : list.slice(0, idx);
  if (!newer.length) return log.ok(`${b.title} is current: ${cur.versionNumber}`);
  log.info(`${b.title}: ${newer.length} newer release(s): ${newer.map((v) => v.version_number).join(', ')}`);
  printPlan(await plan(b, newer[0]));
  console.log(color.dim(`\nApply with ./ch base:sync ${b.key}`));
}

export async function run({ cmd, args, flags }) {
  if (cmd === 'base:check') {
    for (const k of args.length ? args : baseKeys) await check(getBase(k));
    return;
  }
  if (!args[0]) die(`usage: base:sync <${baseKeys.join('|')}> [version]`);
  return sync(getBase(args[0]), args.slice(1), flags);
}
