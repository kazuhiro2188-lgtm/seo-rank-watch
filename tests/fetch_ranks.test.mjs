import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = new URL('../fixtures/site/', import.meta.url).pathname;
const CLI = new URL('../scripts/fetch_ranks.mjs', import.meta.url).pathname;
const run = (dir, ...extra) => spawnSync(process.execPath, [CLI, '--repo', dir, '--source', 'fixture', ...extra], { encoding: 'utf8' });
const site = () => { const d = mkdtempSync(join(tmpdir(), 'srw-fetch-')); cpSync(SITE, d, { recursive: true }); return d; };

test('日次: 7 日窓と 28 日窓を 1 行ずつ追記し、同じ日にもう一度走っても増えない', () => {
  const dir = site();
  let r = run(dir, '--today', '2026-09-11');
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(join(dir, 'data/seo/rank-history.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const s7 = JSON.parse(lines[0]);
  assert.deepEqual(s7.window, { days: 7, startDate: '2026-09-02', endDate: '2026-09-08' });
  assert.equal(s7.ranks.find((x) => x.keyword === '試験 キーワード 一番').rank, 4.5, '4.0×120 と 6.0×40 の加重平均');
  r = run(dir, '--today', '2026-09-11');
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(dir, 'data/seo/rank-history.jsonl'), 'utf8').trim().split('\n').length, 2, 'べき等');
  rmSync(dir, { recursive: true, force: true });
});
test('日次: 全語 null で前回は有効なら測定失敗として赤（追記しない）', () => {
  const dir = site();
  assert.equal(run(dir, '--today', '2026-09-11').status, 0);
  writeFileSync(join(dir, 'data/seo/fixture-gsc.json'), JSON.stringify({ default: [] }));
  const r = run(dir, '--today', '2026-09-12');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /測定失敗/);
  assert.equal(readFileSync(join(dir, 'data/seo/rank-history.jsonl'), 'utf8').trim().split('\n').length, 2, '追記していない');
  rmSync(dir, { recursive: true, force: true });
});
test('日次: 初回から全語 null なら（前回が無いので）警告して追記する', () => {
  const dir = site();
  writeFileSync(join(dir, 'data/seo/fixture-gsc.json'), JSON.stringify({ default: [] }));
  const r = run(dir, '--today', '2026-09-11');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /全語 null/);
  rmSync(dir, { recursive: true, force: true });
});
test('日次: gsc 取得元で資格情報が無ければ終了コード 2（データが無いのではなく取れていない）', () => {
  const dir = site();
  const r = spawnSync(process.execPath, [CLI, '--repo', dir, '--today', '2026-09-11'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /資格情報/);
  rmSync(dir, { recursive: true, force: true });
});
test('日次: 最新の週次報告が 10 日より古ければ warnings に 1 行書く', () => {
  const dir = site();
  mkdirSync(join(dir, 'data/seo/reports'), { recursive: true });
  writeFileSync(join(dir, 'data/seo/reports/2026-08-20.md'), '# old\n');
  const w = join(dir, 'warnings.txt');
  const r = run(dir, '--today', '2026-09-11', '--warnings-out', w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(w, 'utf8'), /週次報告が 22 日前/);
  rmSync(dir, { recursive: true, force: true });
});
