import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/stage-pvz.mjs', import.meta.url));

function localPackage(t) {
  const path = mkdtempSync(join(tmpdir(), 'hub-pvz-package-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const source = join(path, 'source');
  const web = join(path, 'web');
  mkdirSync(source);
  mkdirSync(web);
  const assetContents = {
    'index.html': '<html><head></head><body>Packaging fixture</body></html>',
    'launcher.js': '// fixture',
    'launcher.css': 'body {}',
    'web-config.js': 'window.PVZWebConfig = {"bypassBilibiliChecks": true};',
    'graphics-config.js': '// fixture',
    'pvz-perf-webgl.js': '// fixture',
    'pvz-perf-webgl.wasm.gz': 'fixture placeholder',
    'pvz-perf.data': 'fixture placeholder',
    'serve.py': '# fixture',
  };
  const files = {};
  for (const [name, contents] of Object.entries(assetContents)) {
    files[name] = {
      bytes: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
    writeFileSync(join(source, name), contents);
  }
  const manifest = { version: '4.0.6', bypass_bilibili_checks: true, files };
  return {
    manifest, source, web,
    save: () => writeFileSync(join(source, 'web-build-manifest.json'), JSON.stringify(manifest)),
    run: () => spawnSync(process.execPath, [script, source, web], { encoding: 'utf8' }),
  };
}

test('stages an offline package with its data, adds a lobby link, and omits local launcher tools', (t) => {
  const fixture = localPackage(t);
  fixture.save();
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  const target = join(fixture.web, 'games/pvz');
  assert.match(readFileSync(join(target, 'index.html'), 'utf8'), /href="\/">返回大厅/);
  assert.equal(readFileSync(join(target, 'pvz-perf.data'), 'utf8'), 'fixture placeholder');
  assert.deepEqual(JSON.parse(readFileSync(join(target, 'hub-module.json'), 'utf8')), { version: '4.0.6' });
  assert.ok(!readdirSync(target).includes('serve.py'));
});

test('rejects online, incomplete, and modified packages before writing web assets', (t) => {
  const fixture = localPackage(t);
  fixture.manifest.bypass_bilibili_checks = false;
  fixture.save();
  assert.match(fixture.run().stderr, /Bilibili 发行版不能导入/);

  fixture.manifest.bypass_bilibili_checks = true;
  const data = fixture.manifest.files['pvz-perf.data'];
  delete fixture.manifest.files['pvz-perf.data'];
  fixture.save();
  assert.match(fixture.run().stderr, /缺少资源：pvz-perf.data/);

  fixture.manifest.files['pvz-perf.data'] = data;
  fixture.save();
  writeFileSync(join(fixture.source, 'pvz-perf.data'), 'replacement payload');
  assert.match(fixture.run().stderr, /发布清单校验失败：pvz-perf.data/);
  assert.deepEqual(readdirSync(fixture.web), []);
});

test('rejects package manifests containing paths outside the package directory', (t) => {
  const fixture = localPackage(t);
  fixture.manifest.files['../escape.js'] = fixture.manifest.files['launcher.js'];
  fixture.save();
  assert.match(fixture.run().stderr, /无效的 PvZ 文件路径/);
  assert.deepEqual(readdirSync(fixture.web), []);
});
