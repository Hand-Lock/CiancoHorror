// ch server:local — boot the server-side set locally until "Done", then stop. Gates every deploy.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { P, log, color, packInfo, http, download, java, copyFile, die } from '../lib/util.mjs';
import { buildServerStage } from '../lib/stage.mjs';
import { parseLog, summarize } from './logs.mjs';

export const help = 'server:local [--fresh] [--keep-running] [--timeout=600]  Smoke-test the server set locally (boots to "Done")';

const FATAL = [/Mixin apply (for mod \S+ )?failed/i, /Could not execute entrypoint/i, /Incompatible mods? (set|found)/i, /Exception in server tick loop/i,
  /Encountered an unexpected exception/i, /Failed to start the minecraft server/i, /This crash report has been saved to/i, /requires (version|any version)/i];

async function fabricServerJar(mc, loader) {
  const installers = await http('https://meta.fabricmc.net/v2/versions/installer');
  const inst = installers.find((i) => i.stable) || installers[0];
  const jar = path.join(P.cache, `fabric-server-${mc}-${loader}-${inst.version}.jar`);
  if (!fs.existsSync(jar)) {
    log.info(`downloading Fabric server launcher ${mc}/${loader} (installer ${inst.version})`);
    await download(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${inst.version}/server/jar`, jar);
  }
  return jar;
}

export async function smokeTest({ fresh = false, keepRunning = false, timeoutSec = 600 } = {}) {
  const pack = packInfo();
  const mc = pack.versions.minecraft, loader = pack.versions.fabric;
  const dir = path.join(P.build, 'server');
  const stage = await buildServerStage();
  const launcher = await fabricServerJar(mc, loader);

  fs.mkdirSync(dir, { recursive: true });
  for (const d of ['mods', 'config']) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  if (fresh) for (const d of ['world', 'logs', 'crash-reports']) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  for (const f of stage.files) copyFile(f.abs, path.join(dir, f.remote));
  fs.writeFileSync(path.join(dir, 'eula.txt'), '# Local smoke-test server for CiancoHorror (Minecraft EULA: https://aka.ms/MinecraftEULA)\neula=true\n');
  const propsFile = path.join(dir, 'server.properties');
  if (!fs.existsSync(propsFile)) fs.writeFileSync(propsFile, 'server-port=25599\nonline-mode=false\nview-distance=6\nsimulation-distance=6\nspawn-protection=0\nmotd=CiancoHorror smoke test\nenable-query=false\n');
  copyFile(launcher, path.join(dir, 'fabric-server-launch.jar'));
  const mods = stage.files.filter((f) => f.remote.startsWith('mods/')).length;
  log.info(`booting ${mods} server mods in build/server (MC ${mc}, Fabric ${loader})…`);

  const t0 = Date.now();
  const proc = spawn(java(), ['-Xms2G', '-Xmx4G', '-jar', 'fabric-server-launch.jar', 'nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const hits = [];
  let done = false, buf = '';
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { hits.push(`timeout after ${timeoutSec}s`); proc.kill('SIGKILL'); }, timeoutSec * 1000);
    const onData = (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (process.env.CH_VERBOSE) console.log(color.dim(line));
        if (FATAL.some((re) => re.test(line))) { hits.push(line); console.log(color.red(line)); }
        if (!done && /\]: Done \([\d.,]+s\)!/.test(line)) {
          done = true;
          log.ok(`server reached "Done" in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          if (!keepRunning) proc.stdin.write('stop\n');
          else log.info('server left running on localhost:25599 — type "stop" here to quit');
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    if (keepRunning) process.stdin.pipe(proc.stdin);
    proc.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });

  const logFile = path.join(dir, 'logs', 'latest.log');
  const entries = fs.existsSync(logFile) ? parseLog(fs.readFileSync(logFile, 'utf8')) : [];
  const errors = summarize(entries).filter((g) => g.level !== 'WARN');
  const ok = done && hits.length === 0;
  console.log();
  if (errors.length) { log.warn(`${errors.length} unique ERROR lines (./ch logs local for details):`); for (const e of errors.slice(0, 8)) console.log('  ' + color.red(e.sample.slice(0, 160))); }
  ok ? log.ok(color.green(`smoke test passed (exit ${result})`)) : log.err(`smoke test FAILED${done ? '' : ' — never reached Done'}${hits.length ? ` — ${hits.length} fatal line(s)` : ''}`);
  return { ok, errors, hits };
}

export async function run({ flags }) {
  const r = await smokeTest({ fresh: !!flags.fresh, keepRunning: !!flags['keep-running'], timeoutSec: Number(flags.timeout || 600) });
  if (!r.ok) process.exitCode = 1;
}
