import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = new URL('../fixtures/site/', import.meta.url).pathname;
const CLI = new URL('../scripts/verify_publish.mjs', import.meta.url).pathname;

test('static-dir: ビルド出力に目印があれば 0、無ければ 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-pub-'));
  cpSync(SITE, dir, { recursive: true });
  const file = 'content/articles/first-run.md';
  const original = readFileSync(join(dir, file), 'utf8');
  writeFileSync(join(dir, 'original.md'), original);
  const revised = original.replace('想定どおりに動いた。', '想定どおりに動いた。公開確認のための追記文で、二十文字より長い一文である。');
  writeFileSync(join(dir, file), revised);
  writeFileSync(join(dir, 'revised.md'), revised);
  const args = [CLI, '--repo', dir, '--today', '2026-09-18', '--file', file, '--original', join(dir, 'original.md'), '--revised', join(dir, 'revised.md')];
  let r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 1, 'まだビルドしていないので確認できない');
  execFileSync(process.execPath, ['build.mjs'], { cwd: dir });
  r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /公開を確認/);
  rmSync(dir, { recursive: true, force: true });
});
