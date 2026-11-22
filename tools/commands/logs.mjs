// ch logs [client|server|local] — deduped WARN/ERROR summary, mod-list diff, crash digest, optional mclo.gs share.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { P, log, color, table, readMods, http, die } from '../lib/util.mjs';
import { ensureJars, jarMeta } from '../lib/jars.mjs';

export const help = [
  'logs [client|local|server] [--file=path] [--top=40] [--grep=re] [--share]',
  '                                         Summarise a log: deduped WARN/ERROR, mod-list diff, crash digest',
];

const LINE = /^\[(\d\d:\d\d:\d\d)\] \[([^\]]+)\/(INFO|WARN|ERROR|FATAL|DEBUG)\](?: \(([^)]+)\))?: (.*)$/;
const BUILTIN = new Set(['java', 'minecraft', 'fabricloader', 'mixinextras']);

export function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let cur = null;
  for (const l of lines) {
    const m = LINE.exec(l);
    if (m) { cur = { time: m[1], thread: m[2], level: m[3], logger: m[4] || '', msg: m[5], extra: [] }; entries.push(cur); }
    else if (cur && l.trim()) cur.extra.push(l);
  }
  return entries;
}

export function loadedMods(entries) {
  const e = entries.find((x) => /^Loading \d+ mods:/.test(x.msg));
  if (!e) return null;
  const top = new Map();
  for (const l of e.extra) {
    const m = /^\t- (\S+) (\S+)/.exec(l);
    if (m) top.set(m[1], m[2]);
  }
  return top;
}

const normalize = (s) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  .replace(/@[0-9a-f]{4,}\b/gi, '@<id>')
  .replace(/-?\d+(\.\d+)?/g, '#')
  .slice(0, 220);

export function summarize(entries, { grep } = {}) {
  const re = grep ? new RegExp(grep, 'i') : null;
  const groups = new Map();
  for (const e of entries) {
    if (!['WARN', 'ERROR', 'FATAL'].includes(e.level)) continue;
    if (re && !re.test(e.msg + e.logger)) continue;
    const key = `${e.level}|${e.logger}|${normalize(e.msg)}`;
    const g = groups.get(key) || { level: e.level, logger: e.logger, sample: e.msg, count: 0, first: e.time, last: e.time, trace: e.extra.slice(0, 6) };
    g.count++; g.last = e.time;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'WARN' ? 1 : -1));
}

function crashDigest(file) {
  const t = fs.readFileSync(file, 'utf8');
  const pick = (re) => re.exec(t)?.[1]?.trim();
  const exc = t.split('\n').find((l) => /^[\w.$]+(Exception|Error)\b/.test(l.trim()));
  const frames = t.split('\n').filter((l) => /^\s+at /.test(l)).filter((l) => !/at (?:[\w-]+\/\/)?(java\.|jdk\.|sun\.|net\.minecraft\.|com\.mojang\.|net\.fabricmc\.loader\.|org\.prismlauncher\.)/.test(l)).slice(0, 5);
  return {
    file: path.basename(file),
    time: pick(/^Time: (.+)$/m),
    description: pick(/^Description: (.+)$/m),
    exception: exc?.trim(),
    suspects: pick(/Suspected Mods?: (.+)$/m) || pick(/^\s*Suspected Mod\(s\):\s*\n\s*(.+)$/m),
    frames: frames.map((f) => f.trim()),
  };
}

async function readSource(which, flags) {
  if (flags.file) {
    const f = String(flags.file);
    const buf = fs.readFileSync(f);
    return { text: f.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'), label: f, crashDir: null };
  }
  if (which === 'client') {
    const f = path.join(P.mc, 'logs', 'latest.log');
    if (!fs.existsSync(f)) die(`no client log at ${f}`);
    return { text: fs.readFileSync(f, 'utf8'), label: 'client latest.log', crashDir: path.join(P.mc, 'crash-reports'), mtime: fs.statSync(f).mtimeMs };
  }
  if (which === 'local') {
    const f = path.join(P.build, 'server', 'logs', 'latest.log');
    if (!fs.existsSync(f)) die('no local server log — run ./ch server:local first');
    return { text: fs.readFileSync(f, 'utf8'), label: 'local server latest.log', crashDir: path.join(P.build, 'server', 'crash-reports'), side: 'server' };
  }
  if (which === 'server') {
    const { getServer } = await import('../lib/exaroton.mjs');
    const server = await getServer();
    return { text: await server.getLogs(), label: `exaroton ${server.address}`, crashDir: null, side: 'server' };
  }
  die(`unknown log source "${which}" (client|local|server)`);
}

export async function run({ args, flags }) {
  const which = args[0] || 'client';
  const src = await readSource(which, flags);
  const entries = parseLog(src.text);
  const top = Number(flags.top || 40);
  console.log(color.bold(`${src.label}: ${entries.length} lines`));

  // 1. mod list diff
  const loaded = loadedMods(entries);
  if (loaded) {
    const side = src.side || (which === 'client' ? 'client' : null);
    const mods = readMods({ dirs: ['mods'] }).filter((m) => (side === 'server' ? m.side !== 'client' : side === 'client' ? m.side !== 'server' : true));
    const jars = await ensureJars(mods, { quiet: true });
    const expected = new Map(mods.map((m) => [jarMeta(jars[m.slug]).id, m]));
    const missing = [...expected.keys()].filter((id) => id && !loaded.has(id));
    const extra = [...loaded.keys()].filter((id) => !expected.has(id) && !BUILTIN.has(id));
    const wrongVer = [...expected].filter(([id, m]) => loaded.has(id) && jarMeta(jars[m.slug]).version !== loaded.get(id)).map(([id]) => `${id} ${loaded.get(id)}`);
    if (!missing.length && !extra.length && !wrongVer.length) log.ok(`mod list matches pack (${expected.size} mods, ${side || 'all'} side)`);
    if (missing.length) log.err(`in pack but not loaded: ${missing.join(', ')}`);
    if (extra.length) log.warn(`loaded but not in pack: ${extra.join(', ')}`);
    if (wrongVer.length) log.warn(`version differs from pack: ${wrongVer.join(', ')}`);
  } else log.info('no "Loading N mods" block in this log');

  // 2. warnings / errors
  const groups = summarize(entries, { grep: flags.grep });
  const errs = groups.filter((g) => g.level !== 'WARN');
  const warns = groups.filter((g) => g.level === 'WARN');
  console.log(`\n${color.bold('Errors')} ${errs.length} unique (${errs.reduce((a, g) => a + g.count, 0)} total) · ${color.bold('Warnings')} ${warns.length} unique (${warns.reduce((a, g) => a + g.count, 0)} total)`);
  const show = groups.slice(0, top);
  table(show.map((g) => [
    g.level === 'WARN' ? color.yellow('WARN') : color.red(g.level), String(g.count), g.first, (g.logger || '').slice(0, 24),
    g.sample.slice(0, 150),
  ]), ['lvl', 'n', 'first', 'logger', 'message']);
  if (groups.length > top) console.log(color.dim(`… ${groups.length - top} more (--top=N, --grep=re)`));
  if (flags.traces) for (const g of errs.slice(0, 10)) { console.log('\n' + color.red(g.sample)); for (const t of g.trace) console.log(color.dim(t)); }

  // 3. crash reports newer than this log's session
  if (src.crashDir && fs.existsSync(src.crashDir)) {
    const crashes = fs.readdirSync(src.crashDir).filter((f) => f.endsWith('.txt')).map((f) => path.join(src.crashDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const recent = flags.crashes ? crashes.slice(0, 3) : crashes.filter((f) => !src.mtime || fs.statSync(f).mtimeMs > src.mtime - 6 * 3600e3).slice(0, 3);
    for (const c of recent) {
      const d = crashDigest(c);
      console.log(`\n${color.red(color.bold('CRASH'))} ${d.file} — ${d.description || ''}`);
      if (d.exception) console.log('  ' + d.exception);
      if (d.suspects) console.log('  suspects: ' + d.suspects);
      for (const f of d.frames) console.log(color.dim('  ' + f));
    }
  }

  // 4. share
  if (flags.share) {
    const res = await http('https://api.mclo.gs/1/log', { method: 'POST', json: false, body: new URLSearchParams({ content: src.text }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = JSON.parse(res.toString());
    j.success ? log.ok(`shared: ${j.url}`) : log.err(`mclo.gs: ${j.error}`);
  }
}
