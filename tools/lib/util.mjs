// Shared helpers for the `ch` CLI. No dependencies beyond node: + smol-toml.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as tomlParse, stringify as tomlStringify } from 'smol-toml';

export { tomlParse, tomlStringify };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const P = {
  root: ROOT,
  pack: path.join(ROOT, 'pack'),
  mods: path.join(ROOT, 'pack', 'mods'),
  base: path.join(ROOT, 'base'),
  server: path.join(ROOT, 'server'),
  docs: path.join(ROOT, 'docs'),
  src: path.join(ROOT, 'src'),
  build: path.join(ROOT, 'build'),
  cache: path.join(ROOT, 'cache'),
  dist: path.join(ROOT, 'dist'),
  instance: process.env.CH_INSTANCE ||
    path.join(os.homedir(), 'Library/Application Support/PrismLauncher/instances/CiancoHorror'),
  prismApp: process.env.CH_PRISM_APP || '/Applications/Prism Launcher.app',
};
P.mc = path.join(P.instance, 'minecraft');

export const PACKWIZ = process.env.PACKWIZ || [path.join(os.homedir(), 'go/bin/packwiz'), '/opt/homebrew/bin/packwiz']
  .find((p) => fs.existsSync(p)) || 'packwiz';
export const INSTALLER_BOOTSTRAP = path.join(P.cache, 'packwiz-installer-bootstrap.jar');
export const INSTALLER = path.join(P.cache, 'packwiz-installer.jar');
export const UA = 'ciancohorror-tools/0.1 (github.com/Hand-Lock/CiancoHorror)';

// ---------- output ----------
const tty = process.stdout.isTTY;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
export const color = { red: c(31), green: c(32), yellow: c(33), blue: c(34), dim: c(2), bold: c(1), cyan: c(36) };
export const log = {
  info: (...a) => console.log(color.blue('•'), ...a),
  ok: (...a) => console.log(color.green('✓'), ...a),
  warn: (...a) => console.log(color.yellow('!'), ...a),
  err: (...a) => console.error(color.red('✗'), ...a),
  step: (...a) => console.log('\n' + color.bold(a.join(' '))),
};
export function die(msg, code = 1) { log.err(msg); process.exit(code); }

export function table(rows, headers) {
  const all = headers ? [headers, ...rows] : rows;
  const strip = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const w = all[0].map((_, i) => Math.max(...all.map((r) => strip(r[i]).length)));
  const fmt = (r) => r.map((v, i) => String(v ?? '') + ' '.repeat(w[i] - strip(v).length)).join('  ').trimEnd();
  if (headers) { console.log(color.bold(fmt(headers))); console.log(color.dim(w.map((n) => '─'.repeat(n)).join('  '))); }
  for (const r of rows) console.log(fmt(r));
}

// ---------- processes ----------
export function run(cmd, args = [], opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts });
}
export function runLive(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}
export function packwiz(args, opts = {}) {
  return run(PACKWIZ, args, { cwd: P.pack, ...opts });
}
export function git(args, opts = {}) { return run('git', args, { cwd: ROOT, ...opts }).trim(); }

export async function confirm(question, { yes = false } = {}) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

// ---------- files ----------
export const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };
export const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
export const readTOML = (f) => tomlParse(fs.readFileSync(f, 'utf8'));
export function hashFile(f, algo = 'sha512') { return createHash(algo).update(fs.readFileSync(f)).digest('hex'); }
export function hashBuf(b, algo = 'sha512') { return createHash(algo).update(b).digest('hex'); }
export function walk(dir, { rel = dir, skip = () => false } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = path.relative(rel, full).split(path.sep).join('/');
    if (skip(r, e)) continue;
    if (e.isDirectory()) out.push(...walk(full, { rel, skip }));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}
export function copyFile(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }

/** Minimal glob → RegExp: supports **, *, ?. Patterns are matched against forward-slash relative paths. */
export function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const matchAny = (p, globs) => globs.some((g) => globRe(g).test(p));

// ---------- HTTP ----------
export async function http(url, { method = 'GET', body, headers = {}, json = true, retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, ...(body && json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body && json && typeof body !== 'string' ? JSON.stringify(body) : body,
    });
    if (res.status === 429 && attempt <= retries) {
      const wait = Number(res.headers.get('x-ratelimit-reset') || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 500));
    return json ? res.json() : Buffer.from(await res.arrayBuffer());
  }
}
export async function download(url, dst) {
  const buf = await http(url, { json: false });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  return buf;
}

// ---------- Modrinth ----------
export const MR = 'https://api.modrinth.com/v2';
export const modrinth = {
  get: (p) => http(`${MR}${p}`),
  post: (p, body) => http(`${MR}${p}`, { method: 'POST', body }),
  projects: async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...await http(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`));
    return out;
  },
  versions: async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...await http(`${MR}/versions?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`));
    return out;
  },
};

// ---------- pack ----------
export function packInfo() { return readTOML(path.join(P.pack, 'pack.toml')); }

/** All metafiles under pack/ (mods + resourcepacks + shaderpacks). */
export function readMods({ dirs = ['mods', 'resourcepacks', 'shaderpacks'] } = {}) {
  const out = [];
  for (const d of dirs) {
    const dir = path.join(P.pack, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.pw.toml')).sort()) {
      const t = readTOML(path.join(dir, f));
      out.push({
        slug: f.replace(/\.pw\.toml$/, ''), dir: d, file: path.join(dir, f), name: t.name, filename: t.filename,
        side: t.side || 'both', url: t.download?.url, hash: t.download?.hash, hashFormat: t.download?.['hash-format'],
        projectId: t.update?.modrinth?.['mod-id'], versionId: t.update?.modrinth?.version, pin: !!t.pin, raw: t,
      });
    }
  }
  return out;
}

export function sha1OfMeta(m) { return m.hashFormat === 'sha1' ? m.hash : null; }

/** packwiz refresh, quiet. */
export function refresh() { packwiz(['refresh']); }

export function java() {
  for (const p of [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin/java'), '/usr/bin/java']) if (p && fs.existsSync(p)) return p;
  return 'java';
}

/** Run packwiz-installer headless against a pack URL into dir. side: 'client' | 'server' | 'both'. */
export function installPack(packUrl, dir, side = 'client') {
  fs.mkdirSync(dir, { recursive: true });
  copyFile(INSTALLER, path.join(dir, 'packwiz-installer.jar'));
  return runLive(java(), ['-jar', INSTALLER_BOOTSTRAP, '-g', '--no-gui', '-s', side, '--bootstrap-no-update', '--bootstrap-main-jar', path.join(dir, 'packwiz-installer.jar'), packUrl], { cwd: dir });
}

/** Start `packwiz serve` in the background on a free port; returns { url, stop }. */
export async function servePack(port = 8077) {
  const p = spawn(PACKWIZ, ['serve', '--port', String(port)], { cwd: P.pack, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://localhost:${port}/pack.toml`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return { url, stop: () => p.kill() };
}

export function secret(service) {
  try { return run('security', ['find-generic-password', '-s', service, '-w']).trim(); } catch { return null; }
}

/** Compare dotted/semver-ish version strings; for display only. */
export const today = () => new Date().toISOString().slice(0, 10);
