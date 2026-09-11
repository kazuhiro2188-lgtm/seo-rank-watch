import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = new URL('../fixtures/site/', import.meta.url).pathname;
const CLI = new URL('../scripts/verify_change.mjs', import.meta.url).pathname;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'srw-verify-'));
  cpSync(SITE, join(dir, 'site'), { recursive: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  const candidate = { keyword: '試験 キーワード 一番', targetPath: '/first-run', file: 'content/articles/first-run.md', rank: 4.5, impressions: 160, previousDone: [], avoidEditType: null };
  writeFileSync(join(dir, 'candidate.json'), JSON.stringify(candidate));
  writeFileSync(join(dir, 'run.log'), '');
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [CLI, '--repo', join(dir, 'site'), '--candidate', join(dir, 'candidate.json'), '--out-dir', join(dir, 'out'), '--run-log', join(dir, 'run.log'), '--outcome', join(dir, 'outcome.json')], { encoding: 'utf8' });

test('合格すると outcome は pass で差分と目印を持つ', () => {
  const dir = setup();
  const src = readFileSync(join(dir, 'site/content/articles/first-run.md'), 'utf8');
  writeFileSync(join(dir, 'out/article.md'), src.replace('    a: "いいえ。seo-rank-watch の試験用に生成した合成データです。"\n', '    a: "いいえ。seo-rank-watch の試験用に生成した合成データです。"\n  - q: "手順 A と B の順番は？"\n    a: "本文のとおり A のあとに B を実行します。"\n'));
  writeFileSync(join(dir, 'out/pending-action.json'), JSON.stringify({ keyword: '試験 キーワード 一番', targetPath: '/first-run', editType: 'faq', needs: '順番を知りたい', done: 'FAQ を 1 問追加', proposals: [], needsAuthor: [] }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8'));
  assert.equal(o.status, 'pass');
  assert.equal(o.fingerprint, '本文のとおり A のあとに B を実行します。');
  rmSync(dir, { recursive: true, force: true });
});
test('AI が出力しなかった・JSON が壊れていると blocked', () => {
  const dir = setup();
  assert.equal(run(dir).status, 0);
  let o = JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8'));
  assert.equal(o.status, 'blocked');
  assert.match(o.failures[0].detail, /article\.md/);
  writeFileSync(join(dir, 'out/article.md'), readFileSync(join(dir, 'site/content/articles/first-run.md'), 'utf8') + '\n追記\n');
  writeFileSync(join(dir, 'out/pending-action.json'), '{broken');
  run(dir);
  o = JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8'));
  assert.equal(o.status, 'blocked');
  assert.ok(o.failures.some((f) => /pending-action/.test(f.detail)));
  rmSync(dir, { recursive: true, force: true });
});
