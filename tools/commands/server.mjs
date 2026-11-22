// ch server <sub> — Exaroton management + manifest-based deploy.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, table, die, confirm, git, packInfo, hashBuf, writeJSON } from '../lib/util.mjs';
import { getServer, statusName, waitFor, listRemote, readRemoteText, downloadRemote, parseProps, patchProps, deployCfg } from '../lib/exaroton.mjs';
import { buildServerStage } from '../lib/stage.mjs';
import { parseLog, summarize, loadedMods } from './logs.mjs';

export const help = [
  'server status|start|stop|restart        Exaroton server control',
  'server logs [--raw] | cmd "<command>"    Log summary (or raw) / run a console command',
  'server ls [path] | get <remote> [local] | put <local> <remote>',
  'server ram [GB] | props [key[=value]]   RAM / server.properties (writes need --yes)',
  'server backup [--world]                  Download mods/, config/, server.properties (+world) to build/backups',
  'server drift                             READ-ONLY report: server vs pack',
  'server deploy [--dry-run] [--prune] [--skip-smoke] [--yes]  Manifest-based deploy (backup → upload → restart)',
];

const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function status(server) {
  await server.get();
  const sw = server.software ? `${server.software.name} ${server.software.version}` : '?';
  table([
    ['address', server.address], ['status', statusName(server)], ['software', sw],
    ['players', server.players ? `${server.players.count}/${server.players.max} ${(server.players.list || []).join(', ')}` : '?'],
    ['ram', `${await server.getRAM()} GB`], ['motd', server.motd],
  ]);
}

async function remoteProps(server) {
  const text = await readRemoteText(server, 'server.properties');
  return { text, map: parseProps(text) };
}

function managedProps() {
  const f = path.join(P.root, deployCfg().serverProperties);
  return fs.existsSync(f) ? Object.fromEntries(parseProps(fs.readFileSync(f, 'utf8'))) : {};
}

/** Compare staged set with remote state. */
async function computePlan(server, { prune = false } = {}) {
  const cfg = deployCfg();
  const props = await remoteProps(server);
  const levelName = props.map.get('level-name') || 'world';
  const stage = await buildServerStage({ levelName, quiet: true });
  const manifestText = await readRemoteText(server, cfg.manifest);
  const manifest = manifestText ? JSON.parse(manifestText) : null;
  const dpRemote = `${levelName}/datapacks/${cfg.datapack.name}`;
  const remote = new Map();
  for (const d of ['mods', 'config', dpRemote]) for (const e of await listRemote(server, d)) if (!e.isDirectory) remote.set(e.path, e);

  const upload = [], unchanged = [], adopt = [];
  for (const f of stage.files) {
    let content = fs.readFileSync(f.abs);
    let patched = false;
    const keep = cfg.keepRemoteKeys?.[f.remote];
    if (keep && remote.has(f.remote)) {
      const rp = parseProps(await readRemoteText(server, f.remote));
      const upd = Object.fromEntries(keep.filter((k) => rp.has(k)).map((k) => [k, rp.get(k)]));
      content = Buffer.from(patchProps(content.toString('utf8'), upd));
      patched = true;
    }
    const sha = hashBuf(content, 'sha256');
    const r = remote.get(f.remote);
    const m = manifest?.files?.[f.remote];
    const item = { ...f, content, patched, sha256: sha, size: content.length };
    if (r && m && m.sha256 === sha && r.size === content.length) { unchanged.push(item); continue; }
    if (r && !m && r.size === content.length) {
      // unknown provenance but same size: jars by name+size, text by content
      if (f.remote.endsWith('.jar')) { adopt.push(item); continue; }
      const txt = await readRemoteText(server, f.remote);
      if (txt !== null && hashBuf(Buffer.from(txt), 'sha256') === sha) { adopt.push(item); continue; }
    }
    upload.push({ ...item, reason: r ? (m ? 'changed' : 'differs') : 'new' });
  }
  const staged = new Set(stage.files.map((f) => f.remote));
  const del = Object.keys(manifest?.files || {}).filter((p) => !staged.has(p) && remote.has(p));
  const unmanaged = [...remote.keys()].filter((p) => !staged.has(p) && !manifest?.files?.[p]);
  const pruneList = prune ? unmanaged.filter((p) => p.startsWith('mods/')) : [];

  const want = managedProps();
  const propChanges = Object.entries(want).filter(([k, v]) => props.map.get(k) !== v).map(([k, v]) => ({ key: k, from: props.map.get(k), to: v }));
  return { stage, manifest, upload, unchanged, adopt, del, unmanaged, pruneList, props, propChanges, levelName };
}

function printPlan(p) {
  const n = (a) => color.bold(String(a.length));
  console.log(`\n${color.bold('Deploy plan')} · upload ${n(p.upload)} · delete ${n(p.del)}${p.pruneList.length ? ` · prune ${n(p.pruneList)}` : ''} · adopt ${n(p.adopt)} · unchanged ${n(p.unchanged)} · props ${n(p.propChanges)}`);
  if (!p.manifest) log.warn('no remote manifest yet (first deploy): files with the same name+size are adopted without re-upload');
  for (const u of p.upload) console.log(`  ${color.green('+')} ${u.remote} ${color.dim(`(${u.reason})`)}`);
  for (const d of p.del) console.log(`  ${color.red('-')} ${d}`);
  for (const d of p.pruneList) console.log(`  ${color.red('-')} ${d} ${color.dim('(unmanaged, --prune)')}`);
  for (const c of p.propChanges) console.log(`  ${color.yellow('~')} server.properties ${c.key}: ${c.from ?? '(unset)'} → ${c.to}`);
  const um = p.unmanaged.filter((x) => !p.pruneList.includes(x));
  if (um.length) {
    const jars = um.filter((x) => x.startsWith('mods/'));
    if (jars.length) log.warn(`${jars.length} unmanaged jar(s) on the server (left alone; --prune removes them):\n    ${jars.join('\n    ')}`);
    const other = um.length - jars.length;
    if (other) log.info(`${other} other unmanaged file(s) under config/ — left alone`);
  }
}

async function ensureRemoteDir(server, dir, made) {
  if (!dir || dir === '.' || made.has(dir)) return;
  await ensureRemoteDir(server, path.posix.dirname(dir), made);
  try { await server.getFile(dir).createAsDirectory(); } catch {}
  made.add(dir);
}

async function deploy(server, flags) {
  const cfg = deployCfg();
  if (cfg.smokeTestBeforeDeploy && !flags['skip-smoke'] && !flags['dry-run']) {
    log.step('Smoke test (server:local)');
    const { smokeTest } = await import('./server-local.mjs');
    const r = await smokeTest({});
    if (!r.ok) die('smoke test failed — not deploying (fix, or --skip-smoke if you know why)');
  }
  log.step('Planning');
  const p = await computePlan(server, { prune: !!flags.prune });
  printPlan(p);
  const nothing = !p.upload.length && !p.del.length && !p.pruneList.length && !p.propChanges.length;
  if (flags['dry-run']) { console.log(color.dim('\n(dry run — nothing changed)')); return; }
  if (nothing && p.manifest && !p.adopt.length) return log.ok('server already matches the pack');
  if (git(['status', '--porcelain', '--', 'pack', 'src/datapack', 'server'])) log.warn('deploying uncommitted changes');
  if (!(await confirm(`\nApply this plan to ${server.address}?`, { yes: flags.yes }))) die('aborted (re-run with --yes to confirm non-interactively)');

  // backup everything we overwrite or delete
  const bdir = path.join(P.build, 'backups', `deploy-${ts()}`);
  log.step(`Backup → ${path.relative(P.root, bdir)}`);
  const touched = [...p.upload.filter((u) => u.reason !== 'new').map((u) => u.remote), ...p.del, ...p.pruneList, 'server.properties', cfg.manifest];
  for (const r of touched) { try { await downloadRemote(server, r, path.join(bdir, r)); } catch { /* may not exist */ } }
  log.ok(`${touched.length} files backed up`);

  await server.get();
  const wasOnline = statusName(server) !== 'offline';
  if (wasOnline) {
    log.step('Stopping server');
    await server.executeCommand('say [CiancoHorror] Server restarting for a modpack update…').catch(() => {});
    await server.stop();
    await waitFor(server, 'offline', { onTick: (s) => process.stdout.write(color.dim(`${s} `)) });
    console.log();
  }

  log.step('Applying');
  const made = new Set();
  for (const d of [...p.del, ...p.pruneList]) { await server.getFile(d).delete(); log.info(`deleted ${d}`); }
  for (const u of p.upload) {
    await ensureRemoteDir(server, path.posix.dirname(u.remote), made);
    if (u.patched) await server.getFile(u.remote).putContent(u.content.toString('utf8'));
    else await server.getFile(u.remote).upload(u.abs);
    log.info(`uploaded ${u.remote}`);
  }
  if (p.propChanges.length) {
    await server.getFile('server.properties').putContent(patchProps(p.props.text, Object.fromEntries(p.propChanges.map((c) => [c.key, c.to]))));
    log.info('patched server.properties');
  }
  const files = {};
  for (const f of [...p.unchanged, ...p.adopt, ...p.upload]) files[f.remote] = { sha256: f.sha256, size: f.size };
  const manifest = { version: 1, deployedAt: new Date().toISOString(), pack: packInfo().version, commit: git(['rev-parse', '--short', 'HEAD']), files };
  await server.getFile(cfg.manifest).putContent(JSON.stringify(manifest, null, 2));
  writeJSON(path.join(bdir, 'new-manifest.json'), manifest);
  log.ok(`manifest written (${Object.keys(files).length} managed files)`);

  log.step('Starting server');
  await server.start();
  const st = await waitFor(server, ['online', 'crashed', 'offline'], { timeoutMs: 900_000, onTick: (s) => process.stdout.write(color.dim(`${s} `)) });
  console.log();
  const text = await server.getLogs();
  const entries = parseLog(text);
  const doneLine = entries.find((e) => /^Done \([\d.,]+s\)!/.test(e.msg));
  const errs = summarize(entries).filter((g) => g.level !== 'WARN');
  if (st === 'online' && doneLine) log.ok(color.green(`server is up: ${doneLine.msg}`));
  else log.err(`server status: ${st}${doneLine ? '' : ' (no "Done" line yet)'} — check ./ch server logs; backup at ${path.relative(P.root, bdir)}`);
  for (const e of errs.slice(0, 10)) console.log('  ' + color.red(e.sample.slice(0, 160)));
}

async function drift(server) {
  log.step('Server');
  await status(server);
  const p = await computePlan(server, {});
  log.step('Files (mods/ + config/ + datapack) vs pack');
  printPlan(p);

  log.step('server.properties (selected keys)');
  const keys = ['level-name', 'view-distance', 'simulation-distance', 'sync-chunk-writes', 'network-compression-threshold', 'max-players', 'difficulty', 'hardcore', 'online-mode', 'max-tick-time', 'entity-broadcast-range-percentage', 'spawn-protection', 'pvp', 'white-list', 'enforce-secure-profile', 'allow-flight'];
  table(keys.map((k) => [k, p.props.map.get(k) ?? color.dim('(unset)')]));

  log.step('Latest server log');
  const entries = parseLog(await server.getLogs());
  const loaded = loadedMods(entries);
  if (loaded) {
    const jars = p.stage.files.filter((f) => f.remote.startsWith('mods/')).map((f) => path.basename(f.remote));
    log.info(`server log shows ${loaded.size} top-level mods loaded; pack server set has ${jars.length} jars`);
  } else log.info('no mod list in current log (server offline or log rotated)');
  const groups = summarize(entries);
  table(groups.slice(0, 20).map((g) => [g.level, g.count, g.sample.slice(0, 140)]), ['lvl', 'n', 'message']);
  const report = { at: new Date().toISOString(), address: server.address, software: server.software, upload: p.upload.map((u) => [u.remote, u.reason]), adopt: p.adopt.map((a) => a.remote), unmanaged: p.unmanaged, propChanges: p.propChanges, props: Object.fromEntries(p.props.map) };
  const f = path.join(P.build, `drift-${ts()}.json`);
  writeJSON(f, report);
  log.ok(`report saved: ${path.relative(P.root, f)}`);
}

export async function run({ args, flags }) {
  const [sub = 'status', ...rest] = args;
  const server = await getServer();
  switch (sub) {
    case 'status': return status(server);
    case 'start': await server.start(); log.ok('start requested'); return waitFor(server, ['online', 'crashed'], { onTick: (s) => process.stdout.write(color.dim(`${s} `)) }).then((s) => console.log('\n' + s));
    case 'stop': await server.stop(); log.ok('stop requested'); return;
    case 'restart': await server.restart(); log.ok('restart requested'); return;
    case 'logs': {
      const text = await server.getLogs();
      if (flags.raw) return console.log(text);
      const { run: logs } = await import('./logs.mjs');
      return logs({ args: ['server'], flags });
    }
    case 'cmd': if (!rest.length) die('usage: server cmd "<command>"'); await server.executeCommand(rest.join(' ')); return log.ok('sent');
    case 'ls': {
      const items = await listRemote(server, rest[0] || '', { recursive: !!flags.r });
      return table(items.map((i) => [i.isDirectory ? color.blue(i.path + '/') : i.path, i.isDirectory ? '' : `${(i.size / 1024).toFixed(1)} KB`]));
    }
    case 'get': { if (!rest[0]) die('usage: server get <remote> [local]'); const out = rest[1] || path.join(P.build, 'remote', rest[0]); await downloadRemote(server, rest[0], out); return log.ok(`→ ${out}`); }
    case 'put': {
      if (rest.length < 2) die('usage: server put <local> <remote>');
      if (!(await confirm(`upload ${rest[0]} → ${rest[1]}?`, { yes: flags.yes }))) die('aborted');
      await server.getFile(rest[1]).upload(rest[0]); return log.ok('uploaded');
    }
    case 'ram': {
      if (!rest[0]) return console.log(`${await server.getRAM()} GB`);
      if (!(await confirm(`set RAM to ${rest[0]} GB?`, { yes: flags.yes }))) die('aborted');
      await server.setRAM(Number(rest[0])); return log.ok(`RAM set to ${rest[0]} GB`);
    }
    case 'props': {
      const p = await remoteProps(server);
      if (!rest[0]) return table([...p.map].sort().map(([k, v]) => [k, v]));
      const [k, v] = rest[0].split('=');
      if (v === undefined) return console.log(p.map.get(k) ?? '(unset)');
      if (!(await confirm(`set ${k}: ${p.map.get(k)} → ${v}? (consider adding it to server/server.properties instead)`, { yes: flags.yes }))) die('aborted');
      await server.getFile('server.properties').putContent(patchProps(p.text, { [k]: v })); return log.ok('saved (restart to apply)');
    }
    case 'backup': {
      const dir = path.join(P.build, 'backups', `manual-${ts()}`);
      const lvl = (await remoteProps(server)).map.get('level-name') || 'world';
      const roots = ['mods', 'config', 'server.properties', deployCfg().manifest, ...(flags.world ? [lvl] : [])];
      let n = 0;
      for (const r of roots) for (const e of await listRemote(server, r)) if (!e.isDirectory) { await downloadRemote(server, e.path, path.join(dir, e.path)); n++; if (n % 25 === 0) log.info(`${n} files…`); }
      return log.ok(`${n} files → ${path.relative(P.root, dir)}`);
    }
    case 'drift': return drift(server);
    case 'deploy': return deploy(server, flags);
    default: die(`unknown server subcommand: ${sub}`);
  }
}
