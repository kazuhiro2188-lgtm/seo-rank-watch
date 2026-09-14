import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = new URL('../fixtures/site/', import.meta.url).pathname;
const CLI = new URL('../scripts/check_setup.mjs', import.meta.url).pathname;
const site = () => { const d = mkdtempSync(join(tmpdir(), 'srw-setup-')); cpSync(SITE, d, { recursive: true }); return d; };
const run = (dir, ...a) => spawnSync(process.execPath, [CLI, '--repo', dir, ...a], { encoding: 'utf8' });

test('試験用サイトは導入検査に合格する（トップページの監視語は警告）', () => {
  const dir = site();
  const r = run(dir, '--with-build');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ 生 HTML はエスケープされる/);
  assert.match(r.stdout, /⚠ 試験 トップ: 対象パス \/ はファイルに対応しない/);
  rmSync(dir, { recursive: true, force: true });
});
test('.gitignore に .env が無ければ不合格、監視語のファイルが無ければ不合格', () => {
  const dir = site();
  writeFileSync(join(dir, '.gitignore'), 'out/\n');
  writeFileSync(join(dir, 'data/seo/watchwords.json'), JSON.stringify({ keywords: [{ keyword: 'x', targetPath: '/nope', priority: 'high' }] }));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ \.gitignore/);
  assert.match(r.stdout, /✗ x: content\/articles\/nope\.md が無い/);
  rmSync(dir, { recursive: true, force: true });
});
test('--with-build 後、ビルド出力に探り針（srw-probe）が残らない', () => {
  const dir = site();
  const r = run(dir, '--with-build');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const leftover = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      statSync(p).isDirectory() ? walk(p) : leftover.push(p);
    }
  })(join(dir, 'out'));
  const tainted = leftover.filter((p) => readFileSync(p, 'utf8').includes('srw-probe'));
  assert.deepEqual(tainted, [], `ビルド出力に探り針の痕跡が残っている: ${tainted.join(', ')}`);
  rmSync(dir, { recursive: true, force: true });
});
test('build.outputDir がリポジトリ直下を指すときは後始末を行わず警告する（リポジトリ側のファイルを消さない）', () => {
  const dir = site();
  // outputDir にリポジトリ直下を指させる。'.' は validateConfig が落とすので、同じ場所を指す絶対パスで作る。
  const cfg = JSON.parse(readFileSync(join(dir, 'seo.config.json'), 'utf8'));
  cfg.build.outputDir = dir;
  writeFileSync(join(dir, 'seo.config.json'), JSON.stringify(cfg, null, 2));
  // 「srw-probe」の語を含むリポジトリ側のファイル（本番では check_setup.mjs 自身がこれにあたる）。
  const victim = join(dir, 'zz-victim.txt');
  writeFileSync(victim, 'この行には srw-probe の語が入っている。消されてはいけない。\n');

  const r = run(dir, '--with-build');
  assert.match(r.stdout, /⚠ build\.outputDir がリポジトリ直下を指しているため、ビルド出力の後始末を行わない/, r.stdout + r.stderr);
  assert.equal(existsSync(victim), true, 'リポジトリ側のファイルが後始末で消された');
  assert.equal(/探り針の後始末/.test(r.stdout), false, 'リポジトリ全体を走査して削除している');
  rmSync(dir, { recursive: true, force: true });
});
