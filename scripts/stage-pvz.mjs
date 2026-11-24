// An explicit, local build input. This script never fetches assets or rewrites the upstream access configuration.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const [packageDirectory, targetDirectory] = process.argv.slice(2);
if (!packageDirectory || !targetDirectory) throw new Error('Usage: stage-pvz.mjs OFFLINE_PACKAGE WEB_ROOT');

const source = realpathSync(packageDirectory);
const destination = resolve(targetDirectory, 'games/pvz');
if (source === destination || source.startsWith(destination + sep) || destination.startsWith(source + sep)) {
  throw new Error('Use a PvZ package directory outside the staged web files');
}
const manifestFile = 'web-build-manifest.json';
const manifest = JSON.parse(readFileSync(join(source, manifestFile), 'utf8'));
if (manifest.bypass_bilibili_checks !== true) throw new Error('需要上游离线构建；Bilibili 发行版不能导入');
if (typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){2}$/.test(manifest.version)) {
  throw new Error('无法识别 PvZ 发布版本');
}
const records = manifest.files;
const required = ['index.html', 'launcher.js', 'launcher.css', 'web-config.js',
  'graphics-config.js', 'pvz-perf-webgl.js', 'pvz-perf-webgl.wasm.gz', 'pvz-perf.data'];
for (const name of required) {
  if (!records || !Object.hasOwn(records, name)) throw new Error(`PvZ 发布包缺少资源：${name}`);
}

function filePath(name) {
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`无效的 PvZ 文件路径：${name}`);
  }
  const path = join(source, name);
  if (realpathSync(path) !== path || !statSync(path).isFile()) {
    throw new Error(`需要常规本地文件：${name}`);
  }
  return path;
}

const configFile = readFileSync(filePath('web-config.js'), 'utf8');
const configJson = /^\s*window\.PVZWebConfig\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(configFile)?.[1];
if (!configJson || JSON.parse(configJson).bypassBilibiliChecks !== true) {
  throw new Error('PvZ Web 配置与离线清单不一致');
}

for (const [name, record] of Object.entries(records)) {
  const path = filePath(name);
  const { size } = statSync(path);
  if (size !== record.bytes || size === 0 || size > 512 * 1024 * 1024 ||
      createHash('sha256').update(readFileSync(path)).digest('hex') !== record.sha256) {
    throw new Error(`PvZ 发布清单校验失败：${name}`);
  }
}

const html = readFileSync(filePath('index.html'), 'utf8');
if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) throw new Error('无法适配 PvZ 启动页');
const standaloneLaunchers = new Set(['serve.py', 'start-local.cmd', 'start-local.sh']);
for (const name of Object.keys(records)) {
  if (standaloneLaunchers.has(name)) continue;
  const target = join(destination, name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(filePath(name), target);
}
copyFileSync(filePath(manifestFile), join(destination, manifestFile));
writeFileSync(join(destination, 'index.html'), html
  .replace(/<\/head>/i, '<link rel="stylesheet" href="./hub-return.css"></head>')
  .replace(/<\/body>/i, '<a id="hub-return" href="/">返回大厅</a><script defer src="./hub-return.js"></script></body>'));
writeFileSync(join(destination, 'hub-return.css'), `
#hub-return {
  position: fixed;
  z-index: 100;
  top: max(8px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  min-height: 36px;
  padding: 7px 12px;
  border-radius: 12px;
  background: #1c2e50;
  color: #e9f1ff;
  border: 1px solid #5b77a2;
  font: 600 13px/20px system-ui, sans-serif;
  text-decoration: none;
}
body:not(.playing) #hub-return { position: absolute; }
`);
writeFileSync(join(destination, 'hub-return.js'), `
document.getElementById('hub-return').addEventListener('click', (event) => {
  if (document.body.classList.contains('playing') &&
      !window.confirm('建议先在游戏内退出以保存进度。现在返回大厅？')) event.preventDefault();
});
`);
writeFileSync(join(destination, 'hub-module.json'), JSON.stringify({ version: manifest.version }) + '\n');
console.log(`已引入 pvz_perf ${manifest.version} 离线单机模块`);
