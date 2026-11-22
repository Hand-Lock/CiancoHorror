// Exaroton access via the official `exaroton` lib. Token lives only in the macOS Keychain.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'exaroton';
import { P, die, readJSON, secret } from './util.mjs';

export const KEYCHAIN_SERVICE = 'ciancohorror-exaroton';
export const deployCfg = () => readJSON(path.join(P.server, 'deploy.json'));
export const STATUS_NAME = { 0: 'offline', 1: 'online', 2: 'starting', 3: 'stopping', 4: 'restarting', 5: 'saving', 6: 'loading', 7: 'crashed', 8: 'pending', 9: 'transferring', 10: 'preparing' };

// exaroton@2 streams file uploads (File.upload) as a web ReadableStream without `duplex: 'half'`,
// which Node's fetch rejects ("duplex option is required when sending a body"). Patch only its requests.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  if (opts?.body && typeof opts.body.getReader === 'function' && !opts.duplex && String(url).startsWith('https://api.exaroton.com/')) opts = { ...opts, duplex: 'half' };
  return nativeFetch(url, opts);
};

let cached;
export async function getServer() {
  if (cached) return cached;
  const token = process.env.EXAROTON_TOKEN || secret(KEYCHAIN_SERVICE);
  if (!token) die(`no Exaroton token. Create one at https://exaroton.com/account/ then run:\n  ! security add-generic-password -s ${KEYCHAIN_SERVICE} -a api -w`);
  const client = new Client(token);
  const { address, serverId } = deployCfg();
  const servers = await client.getServers();
  const s = servers.find((x) => (serverId ? x.id === serverId : x.address === address));
  if (!s) die(`server ${serverId || address} not found on this account (have: ${servers.map((x) => x.address).join(', ')})`);
  cached = s;
  return s;
}

export const statusName = (s) => STATUS_NAME[s.status] ?? String(s.status);

export async function waitFor(server, wanted, { timeoutMs = 600_000, onTick } = {}) {
  const want = [].concat(wanted);
  const t0 = Date.now();
  for (;;) {
    await server.get();
    const n = statusName(server);
    onTick?.(n);
    if (want.includes(n)) return n;
    if (n === 'crashed' && !want.includes('crashed')) return n;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${want.join('/')} (status: ${n})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Recursively list a remote directory → [{ path, size, isDirectory }]. Missing dir → []. */
export async function listRemote(server, dir, { recursive = true } = {}) {
  const out = [];
  let info;
  try { info = await server.getFile(dir).getInfo(); } catch (e) { if (/404|not found/i.test(e.message)) return out; throw e; }
  if (!info.isDirectory) return [{ path: info.path, size: info.size, isDirectory: false }];
  const kids = info.children ?? (await server.getFile(dir).getChildren());
  for (const k of kids) {
    if (k.isDirectory) { out.push({ path: k.path, size: 0, isDirectory: true }); if (recursive) out.push(...await listRemote(server, k.path)); }
    else out.push({ path: k.path, size: k.size, isDirectory: false });
  }
  return out;
}

export async function readRemoteText(server, p) {
  try { return await server.getFile(p).getContent(); } catch (e) { if (/404|not found/i.test(e.message)) return null; throw e; }
}

export async function downloadRemote(server, remote, local) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  await server.getFile(remote).download(local);
}

/** Parse / patch Java .properties text (keeps comments and order). */
export function parseProps(text) {
  const map = new Map();
  for (const l of (text || '').split(/\r?\n/)) {
    const m = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(l);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}
export function patchProps(text, updates) {
  const left = new Map(Object.entries(updates));
  const lines = (text || '').split(/\r?\n/).map((l) => {
    const m = /^\s*([^#!=:\s][^=:]*?)\s*[=:]/.exec(l);
    if (m && left.has(m[1])) { const v = left.get(m[1]); left.delete(m[1]); return `${m[1]}=${v}`; }
    return l;
  });
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of left) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

/** Never print or persist secrets read from the server (rcon.password, management-server-secret, …). */
export const SECRET_KEY = /secret|password|token|keystore/i;
export const redact = (k, v) => (SECRET_KEY.test(k) && v ? '<redacted>' : v);
