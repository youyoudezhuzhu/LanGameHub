import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchSaltline } from '../games/saltline/adapt.mjs';

const revision = '4917695dde734010969cc5f7e665acb4d61e06e7';
const root = fileURLToPath(new URL('..', import.meta.url));
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('用法：node scripts/stage-saltline.mjs 中文联机源码目录 Hub运行目录');

const source = resolve(input);
const runtime = resolve(output);
const temporary = await mkdtemp(join(tmpdir(), 'hub-saltline-'));
const project = join(temporary, 'source');
const games = join(runtime, 'web/games');
let staging;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw result.error ?? new Error(`${command} 构建失败`);
}

try {
  await mkdir(project);
  const archive = join(temporary, 'upstream.tar');
  run('git', ['archive', '--format=tar', '-o', archive, revision, '--',
    'src', 'server/rooms.js', 'public', 'index.html', 'vite.config.js',
    'package.json', 'package-lock.json', '.npmrc', 'LICENSE', 'licenses'], source);
  run('tar', ['-xf', archive, '-C', project], temporary);
  const dependencies = join(source, 'node_modules');
  if (await stat(join(dependencies, 'vite/bin/vite.js')).catch(() => null)) {
    await symlink(dependencies, join(project, 'node_modules'), 'dir');
  } else {
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], project);
  }
  await patchSaltline(project);
  await cp(join(root, 'games/saltline/overlay'), join(project, 'src/hub'), { recursive: true });
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], project);
  await mkdir(games, { recursive: true });
  staging = await mkdtemp(join(dirname(runtime), '.hub-saltline-'));
  const web = join(staging, 'web');
  const relay = join(staging, 'saltline-relay.cjs');
  const esbuild = join(root, 'games/deskpark/node_modules/.bin/esbuild');
  run(esbuild, ['server/rooms.js', '--bundle', '--platform=node', '--target=node18', '--format=cjs',
    '--legal-comments=inline', `--outfile=${relay}`], project);
  await cp(join(project, 'dist'), web, { recursive: true });
  await cp(join(project, 'LICENSE'), join(web, 'LICENSE.txt'));
  await cp(join(project, 'licenses'), join(web, 'licenses'), { recursive: true });
  await writeFile(join(web, 'hub-module.json'), JSON.stringify({ revision }) + '\n');
  await rm(join(games, 'saltline'), { recursive: true, force: true });
  await rename(relay, join(runtime, 'saltline-relay.cjs'));
  await rename(web, join(games, 'saltline'));
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}
