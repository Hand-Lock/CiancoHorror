// Upstream "Optimization" modpack (Modrinth ddF4bxsz) — fetch, unpack, describe.
import fs from 'node:fs';
import path from 'node:path';
import { P, modrinth, download, run, readJSON, writeJSON, walk, copyFile, hashFile, die } from './util.mjs';

export const BASE_PROJECT = 'ddF4bxsz';
export const BASE_LOADER = 'fabric';

/** Parse a CDN url → { projectId, versionId }. */
export function cdnIds(url) {
  const m = /cdn\.modrinth\.com\/data\/([^/]+)\/versions\/([^/]+)\//.exec(url || '');
  return m ? { projectId: m[1], versionId: m[2] } : {};
}

/** List Optimization versions for our MC version, newest first. */
export async function baseVersions(mc) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([mc]), loaders: JSON.stringify([BASE_LOADER]) });
  const vs = await modrinth.get(`/project/${BASE_PROJECT}/version?${q}`);
  // Optimization publishes Sodium-* (fabric) and other flavours; keep the Sodium line.
  return vs.filter((v) => /^Sodium-/i.test(v.version_number))
    .sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
}

/** Download + extract a base version into cache/base/<versionId>/. Returns snapshot descriptor. */
export async function fetchBase(versionIdOrObj) {
  const v = typeof versionIdOrObj === 'string' ? await modrinth.get(`/version/${versionIdOrObj}`) : versionIdOrObj;
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
  return describe(v, x);
}

function describe(v, x) {
  const index = readJSON(path.join(x, 'modrinth.index.json'));
  const mods = index.files.map((f) => ({
    path: f.path,
    filename: path.basename(f.path),
    ...cdnIds(f.downloads[0]),
    sha512: f.hashes.sha512,
    env: f.env,
  }));
  const overrides = walk(path.join(x, 'overrides'));
  return {
    projectId: BASE_PROJECT,
    versionId: v.id,
    versionNumber: v.version_number,
    datePublished: v.date_published,
    dependencies: index.dependencies,
    mods,
    overrides,
    dir: x,
  };
}

/** Current snapshot recorded in base/. */
export function currentBase() {
  return readJSON(path.join(P.base, 'base.json'), null);
}

/** Write snapshot into base/ (replacing previous). */
export function writeBaseSnapshot(snap) {
  fs.rmSync(path.join(P.base, 'overrides'), { recursive: true, force: true });
  for (const f of snap.overrides) copyFile(path.join(snap.dir, 'overrides', f), path.join(P.base, 'overrides', f));
  copyFile(path.join(snap.dir, 'modrinth.index.json'), path.join(P.base, 'modrinth.index.json'));
  const { dir, ...rest } = snap;
  writeJSON(path.join(P.base, 'base.json'), rest);
}
