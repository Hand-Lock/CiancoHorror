// Local jar cache (cache/jars) + fabric.mod.json extraction incl. jar-in-jar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P, run, hashFile, download, readJSON, writeJSON, log } from './util.mjs';

const JARS = () => path.join(P.cache, 'jars');
const META_CACHE = () => path.join(P.cache, 'modmeta.json');

/** Ensure every metafile's file is in cache/jars (copied from the instance when hashes match, else downloaded). */
export async function ensureJars(mods, { quiet = false } = {}) {
  fs.mkdirSync(JARS(), { recursive: true });
  const out = {};
  const todo = [];
  for (const m of mods) {
    const dst = path.join(JARS(), m.filename);
    out[m.slug] = dst;
    if (fs.existsSync(dst) && hashFile(dst, m.hashFormat) === m.hash) continue;
    const inst = path.join(P.mc, m.dir, m.filename);
    if (fs.existsSync(inst) && hashFile(inst, m.hashFormat) === m.hash) { fs.copyFileSync(inst, dst); continue; }
    todo.push(m);
  }
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (todo.length) {
      const m = todo.shift();
      const dst = out[m.slug];
      await download(m.url, dst);
      if (hashFile(dst, m.hashFormat) !== m.hash) { fs.rmSync(dst); throw new Error(`hash mismatch: ${m.filename}`); }
      if (!quiet) log.info(`downloaded ${m.filename} (${++i})`);
    }
  }));
  return out;
}

function parseLooseJSON(s) {
  try { return JSON.parse(s); } catch {}
  // some mods ship fabric.mod.json with raw newlines/tabs in strings or trailing commas
  return JSON.parse(s.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
}

function readFmj(jar) {
  try { return parseLooseJSON(run('unzip', ['-p', jar, 'fabric.mod.json'])); } catch { return null; }
}

function listEntries(jar) {
  try { return run('unzip', ['-Z1', jar]).split('\n').filter(Boolean); } catch { return []; }
}

/** Mod metadata for one jar: { id, version, name, environment, depends, provides, nested:[{id,version,provides}] }. Cached by hash. */
export function jarMeta(jar) {
  const cache = readJSON(META_CACHE(), {});
  const key = hashFile(jar, 'sha256');
  if (cache[key]) return cache[key];
  const meta = describeJar(jar, 0);
  cache[key] = meta;
  writeJSON(META_CACHE(), cache);
  return meta;
}

function describeJar(jar, depth) {
  const fmj = readFmj(jar) || {};
  const entries = listEntries(jar);
  const meta = {
    id: fmj.id || null, version: fmj.version || null, name: fmj.name || null,
    environment: fmj.environment || '*', depends: fmj.depends || {}, breaks: fmj.breaks || {},
    provides: fmj.provides || [], mixins: (fmj.mixins || []).map((m) => (typeof m === 'string' ? m : m.config)),
    nested: [],
  };
  if (depth < 2) {
    const nested = entries.filter((e) => /^META-INF\/jars\/.+\.jar$/.test(e));
    if (nested.length) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-jij-'));
      try {
        run('unzip', ['-q', '-o', jar, ...nested, '-d', tmp]);
        for (const n of nested) {
          const sub = describeJar(path.join(tmp, n), depth + 1);
          meta.nested.push({ id: sub.id, version: sub.version, provides: sub.provides, file: path.basename(n) }, ...sub.nested);
        }
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
  }
  return meta;
}

/** All mod ids (top-level, provides, nested) in a set of jar metas. */
export function allIds(metas) {
  const ids = new Set();
  for (const m of metas) {
    if (m.id) ids.add(m.id);
    for (const p of m.provides) ids.add(p);
    for (const n of m.nested) { if (n.id) ids.add(n.id); for (const p of n.provides || []) ids.add(p); }
  }
  return ids;
}

/** Does any class/resource inside the jar (or its nested jars) mention `needle`? Slow path for orphan checks. */
export function jarMentions(jar, needle) {
  try {
    const out = run('sh', ['-c', `unzip -p "$1" 2>/dev/null | LC_ALL=C grep -a -c -F -- "$2" || true`, 'sh', jar, needle]);
    if (Number(out.trim()) > 0) return true;
  } catch {}
  const nested = listEntries(jar).filter((e) => /^META-INF\/jars\/.+\.jar$/.test(e));
  if (!nested.length) return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-jij-'));
  try {
    run('unzip', ['-q', '-o', jar, ...nested, '-d', tmp]);
    return nested.some((n) => jarMentions(path.join(tmp, n), needle));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
