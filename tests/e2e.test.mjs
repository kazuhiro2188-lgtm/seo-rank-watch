import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addDays } from '../scripts/lib/dates.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const S = (name) => join(ROOT, 'scripts', name);
const node = (script, args, opts = {}) => {
  const r = spawnSync(process.execPath, [S(script), ...args], { encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${script} 失敗:\n${r.stdout}\n${r.stderr}`);
  return r;
};

test('通し: 測る → 直す → 公開確認 → 判定（悪化）→ 自動 revert → 冷却明け', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-e2e-'));
  const site = join(dir, 'site'); const tmp = join(dir, 'tmp'); const out = join(tmp, 'work/out');
  cpSync(join(ROOT, 'fixtures/site'), site, { recursive: true });
  mkdirSync(out, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: site, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 't'); git('config', 'user.email', 't@example.invalid');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  const D0 = '2026-09-11';
  const FILE = 'content/articles/first-run.md';
  const original = readFileSync(join(site, FILE), 'utf8');

  // 日次（初回）
  node('fetch_ranks.mjs', ['--repo', site, '--today', D0, '--source', 'fixture']);
  git('add', 'data/seo/rank-history.jsonl'); git('commit', '-q', '-m', 'measure');

  // 週次①: 鮮度 → 判定なし → 候補
  node('freshness.mjs', ['--repo', site, '--today', D0]);
  node('review.mjs', ['--repo', site, '--today', D0, '--out', join(tmp, 'verdicts.json')]);
  assert.deepEqual(JSON.parse(readFileSync(join(tmp, 'verdicts.json'), 'utf8')), []);
  node('select.mjs', ['--repo', site, '--today', D0, '--out', join(tmp, 'candidate.json'), '--report-only-out', join(tmp, 'report-only.json')]);
  const cand = JSON.parse(readFileSync(join(tmp, 'candidate.json'), 'utf8'));
  assert.equal(cand.file, FILE);
  assert.equal(cand.rank, 4.5);
  node('build_prompt.mjs', ['--repo', site, '--candidate', join(tmp, 'candidate.json'), '--out', join(tmp, 'prompt.md'), '--out-dir', out]);
  assert.match(readFileSync(join(tmp, 'prompt.md'), 'utf8'), /試験 キーワード 一番/);

  // AI の出力を手で置く（FAQ を 1 問追加）
  writeFileSync(join(out, 'article.md'), original.replace('    a: "いいえ。seo-rank-watch の試験用に生成した合成データです。"\n', '    a: "いいえ。seo-rank-watch の試験用に生成した合成データです。"\n  - q: "手順 A と B の順番は？"\n    a: "本文のとおり手順 A のあとに手順 B を実行します。"\n'));
  writeFileSync(join(out, 'pending-action.json'), JSON.stringify({ keyword: cand.keyword, targetPath: cand.targetPath, editType: 'faq', needs: '順番を知りたい', done: 'FAQ を 1 問追加', proposals: [], needsAuthor: ['実際に詰まった箇所は？'] }));
  writeFileSync(join(tmp, 'run.log'), '');
  node('verify_change.mjs', ['--repo', site, '--candidate', join(tmp, 'candidate.json'), '--out-dir', out, '--run-log', join(tmp, 'run.log'), '--outcome', join(tmp, 'outcome.json')]);
  assert.equal(JSON.parse(readFileSync(join(tmp, 'outcome.json'), 'utf8')).status, 'pass');

  // 書く段: 記事 → コミット → sha 記録 → ログをコミット → ビルド → 公開確認 → published
  writeFileSync(join(tmp, 'original.md'), original);
  node('apply.mjs', ['verdicts', '--repo', site, '--today', D0, '--verdicts', join(tmp, 'verdicts.json')]);
  node('apply.mjs', ['change', '--repo', site, '--today', D0, '--outcome', join(tmp, 'outcome.json'), '--out-dir', out, '--build-result', 'success']);
  assert.match(readFileSync(join(site, FILE), 'utf8'), /updatedAt: "2026-09-11"/);
  git('add', FILE); git('commit', '-q', '-m', 'seo: improve');
  const sha = git('rev-parse', '--short', 'HEAD');
  node('apply.mjs', ['record-sha', '--repo', site, '--today', D0, '--file', FILE, '--sha', sha]);
  git('add', 'data/seo/improvement-log.json'); git('commit', '-q', '-m', 'seo: record');
  execFileSync(process.execPath, ['build.mjs'], { cwd: site });
  node('verify_publish.mjs', ['--repo', site, '--today', D0, '--file', FILE, '--original', join(tmp, 'original.md'), '--revised', join(site, FILE)]);
  node('apply.mjs', ['published', '--repo', site, '--today', D0, '--file', FILE]);
  node('report.mjs', ['--repo', site, '--today', D0, '--verdicts', join(tmp, 'verdicts.json'), '--outcome', join(tmp, 'outcome.json'), '--report-only', join(tmp, 'report-only.json'), '--slack-out', join(tmp, 'slack.txt'), '--repo-url', 'https://example.invalid/r']);
  git('add', 'data/seo'); git('commit', '-q', '-m', 'seo: report');
  let log = JSON.parse(readFileSync(join(site, 'data/seo/improvement-log.json'), 'utf8'));
  assert.deepEqual([log.entries[0].status, log.entries[0].publishedVerifiedAt, log.entries[0].nextReviewDate, log.entries[0].actions[0].commitSha], ['observing', D0, addDays(D0, 10), sha]);
  assert.match(readFileSync(join(tmp, 'slack.txt'), 'utf8'), /^連続実行: 日次 1 日 \/ 週次 1 回/);
  assert.ok(existsSync(join(site, `data/seo/reports/${D0}.md`)));

  // 改善後の窓（終端 S+7 以降）で順位が 9 位に悪化する fixture にする
  const fx = JSON.parse(readFileSync(join(site, 'data/seo/fixture-gsc.json'), 'utf8'));
  fx.fromEndDate[addDays(D0, 1)] = fx.default.map((r) => (r.page.endsWith('/first-run') ? { ...r, position: 9.0 } : r));
  writeFileSync(join(site, 'data/seo/fixture-gsc.json'), JSON.stringify(fx));

  // 日次を 10 日分（5 日目は 2 回走らせてべき等を確認）
  for (let i = 1; i <= 10; i++) {
    node('fetch_ranks.mjs', ['--repo', site, '--today', addDays(D0, i), '--source', 'fixture']);
    if (i === 5) node('fetch_ranks.mjs', ['--repo', site, '--today', addDays(D0, i), '--source', 'fixture']);
  }
  assert.equal(readFileSync(join(site, 'data/seo/rank-history.jsonl'), 'utf8').trim().split('\n').length, 22, '11 日 × 2 窓');

  // 週次②（判定日）: worsened → apply verdicts が git revert を実行し、記事が元に戻る
  const D10 = addDays(D0, 10);
  node('review.mjs', ['--repo', site, '--today', D10, '--out', join(tmp, 'verdicts.json')]);
  const v = JSON.parse(readFileSync(join(tmp, 'verdicts.json'), 'utf8'));
  assert.equal(v[0].verdict, 'worsened');
  assert.equal(v[0].revertSha, sha);
  node('apply.mjs', ['verdicts', '--repo', site, '--today', D10, '--verdicts', join(tmp, 'verdicts.json')]);
  assert.equal(readFileSync(join(site, FILE), 'utf8'), original, 'revert で記事が元に戻る（updatedAt も消える）');
  log = JSON.parse(readFileSync(join(site, 'data/seo/improvement-log.json'), 'utf8'));
  assert.deepEqual([log.entries[0].status, log.entries[0].cooldownUntil, log.entries[0].actions[0].verdict], ['reverted', addDays(D10, 7), 'worsened']);
  node('select.mjs', ['--repo', site, '--today', D10, '--out', join(tmp, 'candidate.json'), '--report-only-out', join(tmp, 'report-only.json')]);
  assert.ok(JSON.parse(readFileSync(join(tmp, 'report-only.json'), 'utf8')).some((x) => x.reason === 'locked'), '冷却中は選ばれない');

  // 冷却明け
  const D17 = addDays(D10, 7);
  node('review.mjs', ['--repo', site, '--today', D17, '--out', join(tmp, 'verdicts.json')]);
  assert.equal(JSON.parse(readFileSync(join(tmp, 'verdicts.json'), 'utf8'))[0].verdict, 'cooldown-end');
  node('apply.mjs', ['verdicts', '--repo', site, '--today', D17, '--verdicts', join(tmp, 'verdicts.json')]);
  log = JSON.parse(readFileSync(join(site, 'data/seo/improvement-log.json'), 'utf8'));
  assert.equal(log.entries[0].status, 'active');

  // 鮮度: 記録が古ければ赤
  const r = node('freshness.mjs', ['--repo', site, '--today', addDays(D0, 30)], { allowFail: true });
  assert.equal(r.status, 1);
  rmSync(dir, { recursive: true, force: true });
});
