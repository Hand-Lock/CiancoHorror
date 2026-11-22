// ch release [patch|minor|major|x.y.z] — version bump, .mrpack + Prism onboarding zip, tag, push, GitHub release.
import fs from 'node:fs';
import path from 'node:path';
import { P, log, color, die, git, packwiz, refresh, packInfo, run as sh, copyFile, INSTALLER_BOOTSTRAP, confirm } from '../lib/util.mjs';

export const help = [
  'release [patch|minor|major|x.y.z] [--no-push] [--yes]',
  '                                         Bump version, export .mrpack + Prism onboarding zip, tag, push, gh release',
];

// Friends' instances track this branch (not main), so WIP on main never reaches them.
export const RELEASE_BRANCH = 'release';

export function repoSlug() {
  try {
    const url = git(['remote', 'get-url', 'origin']);
    const m = /github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/.exec(url);
    return m?.[1] || null;
  } catch { return null; }
}
export const packUrl = (slug) => `https://raw.githubusercontent.com/${slug}/${RELEASE_BRANCH}/pack/pack.toml`;

function bump(v, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [a, b, c] = v.split('.').map(Number);
  return kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

/** Build dist/CiancoHorror-Prism.zip: a Prism instance that self-updates from the release branch on every launch. */
export function buildOnboardingZip(slug, version) {
  const pack = packInfo();
  const stage = path.join(P.build, 'onboarding', 'CiancoHorror');
  fs.rmSync(path.dirname(stage), { recursive: true, force: true });
  const mc = path.join(stage, '.minecraft');
  fs.mkdirSync(mc, { recursive: true });
  copyFile(INSTALLER_BOOTSTRAP, path.join(mc, 'packwiz-installer-bootstrap.jar'));
  const icon = path.join(P.root, 'docs', 'icon.png');
  if (fs.existsSync(icon)) copyFile(icon, path.join(stage, 'ciancohorror.png'));
  fs.writeFileSync(path.join(stage, 'instance.cfg'), [
    '[General]',
    'ConfigVersion=1.3',
    'InstanceType=OneSix',
    `name=CiancoHorror`,
    fs.existsSync(icon) ? 'iconKey=ciancohorror' : 'iconKey=default',
    'OverrideCommands=true',
    `PreLaunchCommand="$INST_JAVA" -jar packwiz-installer-bootstrap.jar ${packUrl(slug)}`,
    'OverrideMemory=true',
    'MinMemAlloc=2048',
    'MaxMemAlloc=4096',
    `notes=CiancoHorror ${version} — auto-updates from github.com/${slug} on every launch.`,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(stage, 'mmc-pack.json'), JSON.stringify({
    formatVersion: 1,
    components: [
      { uid: 'net.minecraft', version: pack.versions.minecraft, important: true },
      { uid: 'net.fabricmc.intermediary', version: pack.versions.minecraft, dependencyOnly: true },
      { uid: 'net.fabricmc.fabric-loader', version: pack.versions.fabric },
    ],
  }, null, 2));
  const out = path.join(P.dist, 'CiancoHorror-Prism.zip');
  fs.mkdirSync(P.dist, { recursive: true });
  fs.rmSync(out, { force: true });
  sh('zip', ['-qr', out, 'CiancoHorror'], { cwd: path.dirname(stage) });
  return out;
}

export async function run({ args, flags }) {
  if (git(['status', '--porcelain'])) die('working tree not clean — commit first');
  const slug = repoSlug();
  if (!slug) die('no GitHub origin remote — create the repo first (see README "Publishing")');

  log.step('Doctor');
  const { run: doctor } = await import('./doctor.mjs');
  await doctor({ flags: {} });
  if (process.exitCode) die('doctor reported errors — fix before releasing');

  const cur = packInfo().version;
  const next = bump(cur, args[0] || 'patch');
  const prevTag = (() => { try { return git(['describe', '--tags', '--abbrev=0']); } catch { return null; } })();
  const changes = git(['log', '--pretty=- %s', ...(prevTag ? [`${prevTag}..HEAD`] : [])]).split('\n').filter((l) => l && !/^- release:/.test(l));
  console.log(`\n${color.bold(`CiancoHorror ${cur} → ${next}`)}\n${changes.join('\n') || '(no changes)'}`);
  if (!(await confirm('\nRelease?', { yes: flags.yes }))) die('aborted');

  const tomlPath = path.join(P.pack, 'pack.toml');
  fs.writeFileSync(tomlPath, fs.readFileSync(tomlPath, 'utf8').replace(/^version = ".*"$/m, `version = "${next}"`));
  refresh();
  git(['add', 'pack']);
  git(['commit', '-q', '-m', `release: v${next}\n\n${changes.join('\n')}`]);
  git(['tag', '-a', `v${next}`, '-m', `CiancoHorror v${next}`]);

  log.step('Artifacts');
  fs.mkdirSync(P.dist, { recursive: true });
  const mrpack = path.join(P.dist, `CiancoHorror-${next}.mrpack`);
  packwiz(['modrinth', 'export', '-o', mrpack]);
  log.ok(path.relative(P.root, mrpack));
  const zip = buildOnboardingZip(slug, next);
  log.ok(path.relative(P.root, zip));

  if (flags['no-push']) return log.info('skipped push/gh release (--no-push)');
  log.step('Publish');
  git(['push', '-q', 'origin', 'main', `v${next}`]);
  git(['push', '-q', '-f', 'origin', `v${next}^{commit}:refs/heads/${RELEASE_BRANCH}`]);
  sh('gh', ['release', 'create', `v${next}`, mrpack, zip, '-R', slug, '-t', `CiancoHorror v${next}`, '-n',
    `${changes.join('\n')}\n\n**New players:** download \`CiancoHorror-Prism.zip\`, then Prism Launcher → Add Instance → Import → select the zip. It updates itself on every launch.\n**Other launchers:** import the \`.mrpack\`.`]);
  log.ok(`released v${next} → https://github.com/${slug}/releases/tag/v${next}`);
}
