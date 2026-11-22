// Upstream base modpacks — fetch, unpack, describe.
//   client: "Optimization" (Modrinth ddF4bxsz, Sodium line) → base of the client pack (overrides land in pack/)
//   server: "Server Optimization" by wicivo (Modrinth 2wkV8mHp) → base of the server set (overrides land in server/overrides/)
import fs from 'node:fs';
import path from 'node:path';
import { P, modrinth, download, run, readJSON, writeJSON, walk, copyFile, hashFile, die } from './util.mjs';

export const BASES = {
  client: {
    key: 'client',
    title: 'Optimization',
    projectId: 'ddF4bxsz',
    versionFilter: (v) => /^Sodium-/i.test(v.version_number),
    dir: path.join(P.base, 'client'),
    // side for mods newly added by this base
    sideFor: (env) => (env?.server === 'unsupported' ? 'client' : 'both'),
    // where an upstream override file lives in our tree (null = ignored)
    target: (f) => path.join(P.pack, f),
  },
  server: {
    key: 'server',
    title: 'Server Optimization',
    projectId: '2wkV8mHp',
    versionFilter: () => true,
    dir: path.join(P.base, 'server'),
    sideFor: () => 'server',
    // config/** → server/overrides/config/**; server.properties → key-merged into server/server.properties;
    // eula.txt and the bundled launcher jar are Exaroton's business.
    target: (f) => (f.startsWith('config/') ? path.join(P.server, 'overrides', f) : f === 'server.properties' ? path.join(P.server, 'server.properties') : null),
  },
};
export const baseKeys = Object.keys(BASES);
export function getBase(key) {
  const b = BASES[key];
  if (!b) die(`unknown base "${key}" (expected: ${baseKeys.join(', ')})`);
  return b;
}

/** Parse a CDN url → { projectId, versionId }. */
export function cdnIds(url) {
  const m = /cdn\.modrinth\.com\/data\/([^/]+)\/versions\/([^/]+)\//.exec(url || '');
  return m ? { projectId: m[1], versionId: m[2] } : {};
}

/** Versions of a base for our MC version (fabric), newest first. */
export async function baseVersions(b, mc) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([mc]), loaders: JSON.stringify(['fabric']) });
  const vs = await modrinth.get(`/project/${b.projectId}/version?${q}`);
  return vs.filter(b.versionFilter).sort((a, c) => new Date(c.date_published) - new Date(a.date_published));
}

/** Download + extract a base version into cache/base/<versionId>/. Returns snapshot descriptor. */
export async function fetchBase(b, versionIdOrObj) {
  const v = typeof versionIdOrObj === 'string' ? await modrinth.get(`/version/${versionIdOrObj}`) : versionIdOrObj;
  if (v.project_id !== b.projectId) die(`version ${v.id} belongs to project ${v.project_id}, not ${b.title}`);
  const file = v.files.find((f) => f.primary) || v.files[0];
  const dir = path.join(P.cache, 'base', v.id);
  const x = path.join(dir, 'x');
  if (!fs.existsSync(path.join(x, 'modrinth.index.json'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    const mrpack = path.join(dir, 'pack.mrpack');
    await download(file.url, mrpack);
    if (hashFile(mrpack) !== file.hashes.sha512) die(`hash mismatch for ${file.url}`);
    fs.mkdirSync(x, { recursive: true });
    run('unzip', ['-q', '-o', mrpack, '-d', x]);
  }
  const index = readJSON(path.join(x, 'modrinth.index.json'));
  return {
    base: b.key,
    title: b.title,
    projectId: b.projectId,
    versionId: v.id,
    versionNumber: v.version_number,
    datePublished: v.date_published,
    dependencies: index.dependencies,
    mods: index.files.map((f) => ({ path: f.path, filename: path.basename(f.path), ...cdnIds(f.downloads[0]), sha512: f.hashes.sha512, env: f.env })),
    // binary blobs (e.g. a bundled server launcher) are not tracked
    overrides: walk(path.join(x, 'overrides')).filter((f) => !f.endsWith('.jar')),
    dir: x,
  };
}

/** Snapshot recorded in base/<key>/. */
export function currentBase(b) {
  return readJSON(path.join(b.dir, 'base.json'), null);
}

/** Project ids of every base mod (any base), for "base" markers. */
export function baseProjectIds() {
  const out = new Map();
  for (const b of Object.values(BASES)) for (const m of currentBase(b)?.mods || []) out.set(m.projectId, [...(out.get(m.projectId) || []), b.key]);
  return out;
}

/** Write snapshot into base/<key>/ (replacing previous). */
export function writeBaseSnapshot(b, snap) {
  fs.rmSync(path.join(b.dir, 'overrides'), { recursive: true, force: true });
  for (const f of snap.overrides) copyFile(path.join(snap.dir, 'overrides', f), path.join(b.dir, 'overrides', f));
  copyFile(path.join(snap.dir, 'modrinth.index.json'), path.join(b.dir, 'modrinth.index.json'));
  const { dir, ...rest } = snap;
  writeJSON(path.join(b.dir, 'base.json'), rest);
}
