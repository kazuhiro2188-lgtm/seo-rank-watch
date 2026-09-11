import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyVerdicts, recordChange, recordBlocked, recordSha, markPublished, markUnpublished, markRevertFailed, setUpdatedAt } from '../scripts/lib/apply.mjs';

const candidate = { keyword: 'k', targetPath: '/a', file: 'content/articles/a.md', rank: 4.2, impressions: 310 };
const pa = { keyword: 'k', targetPath: '/a', editType: 'faq', needs: 'n', done: 'd', proposals: ['p'], needsAuthor: ['q'] };

test('recordChange → recordSha → markPublished の順で observing が完成する', () => {
  const log = { entries: [] };
  const e = recordChange(log, { candidate, pendingAction: pa, today: '2026-09-18' });
  assert.equal(e.status, 'observing');
  assert.equal(e.publishedVerifiedAt, null);
  assert.deepEqual(e.keywords, ['k']);
  assert.equal(e.actions[0].commitSha, null);
  assert.equal(e.actions[0].rankAtAction, 4.2);
  recordSha(log, 'content/articles/a.md', 'abc1234');
  assert.equal(e.actions[0].commitSha, 'abc1234');
  markPublished(log, 'content/articles/a.md', '2026-09-19');
  assert.equal(e.publishedVerifiedAt, '2026-09-19');
  assert.equal(e.nextReviewDate, '2026-09-29');
  markUnpublished(log, 'content/articles/a.md', '2026-09-19');
  assert.equal(e.status, 'unpublished');
});
test('recordBlocked は status を変えず blocked に積む', () => {
  const log = { entries: [{ file: 'content/articles/a.md', status: 'active', attempts: 1, actions: [], blocked: [] }] };
  const e = recordBlocked(log, { candidate, failures: [{ check: 3, detail: 'x' }], today: '2026-09-18' });
  assert.equal(e.status, 'active');
  assert.equal(e.blocked.length, 1);
  assert.equal(e.blocked[0].failures[0].check, 3);
});
test('applyVerdicts は status・attempts・action.verdict を反映し、worsened は revert 対象を返す', () => {
  const log = { entries: [{ file: 'content/articles/a.md', status: 'observing', attempts: 0, extensions: 0, actions: [{ keyword: 'k', commitSha: 'abc1234', verdict: null }] }] };
  const { reverts } = applyVerdicts(log, [{ file: 'content/articles/a.md', keyword: 'k', verdict: 'worsened', status: 'reverted', attempts: 1, extensions: 0, revert: true, revertSha: 'abc1234', cooldownUntil: '2026-10-05' }], '2026-09-28');
  assert.deepEqual(reverts, [{ file: 'content/articles/a.md', sha: 'abc1234' }]);
  const e = log.entries[0];
  assert.deepEqual([e.status, e.attempts, e.cooldownUntil, e.actions[0].verdict, e.actions[0].verdictAt], ['reverted', 1, '2026-10-05', 'worsened', '2026-09-28']);
  applyVerdicts(log, [{ file: 'content/articles/a.md', verdict: 'cooldown-end', status: 'active' }], '2026-10-05');
  assert.equal(e.status, 'active');
  assert.equal(e.cooldownUntil, null);
  applyVerdicts(log, [{ file: 'content/articles/a.md', verdict: 'pending', status: 'observing' }], '2026-10-05');
  assert.equal(e.status, 'active', 'pending は何も変えない');
  markRevertFailed(log, 'content/articles/a.md', 'conflict');
  assert.equal(e.status, 'parked');
  assert.match(e.note, /revert/);
});
test('setUpdatedAt は欄があれば置換、無ければ frontmatter 末尾に足す', () => {
  assert.equal(setUpdatedAt('---\ntitle: "a"\nupdatedAt: "2026-01-01"\n---\n本文', 'updatedAt', '2026-09-18'), '---\ntitle: "a"\nupdatedAt: "2026-09-18"\n---\n本文');
  assert.equal(setUpdatedAt('---\ntitle: "a"\n---\n本文', 'updatedAt', '2026-09-18'), '---\ntitle: "a"\nupdatedAt: "2026-09-18"\n---\n本文');
  assert.equal(setUpdatedAt('本文だけ', 'updatedAt', '2026-09-18'), '本文だけ', 'frontmatter が無ければ触らない');
});

// コントローラからの追加指示: outcome.candidate が null（検査の前提を読めなかった）場合は
// improvement-log.json に書かず、終了コード 0 で「記録をスキップした」旨を出す。
const SITE = new URL('../fixtures/site/', import.meta.url).pathname;
const APPLY_CLI = new URL('../scripts/apply.mjs', import.meta.url).pathname;

test('change: outcome.candidate が null（検査の前提を読めなかった）なら記録をスキップし終了コード 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-apply-'));
  cpSync(SITE, dir, { recursive: true });
  const outcome = {
    status: 'blocked',
    failures: [{ check: 0, detail: '検査の前提を読めなかった: candidate.json が壊れている' }],
    candidate: null, pendingAction: null, diff: null, fingerprint: null,
  };
  writeFileSync(join(dir, 'outcome.json'), JSON.stringify(outcome));
  const r = spawnSync(process.execPath, [APPLY_CLI, 'change', '--repo', dir, '--today', '2026-09-18', '--outcome', join(dir, 'outcome.json'), '--out-dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /検査の前提を読めなかったため記録をスキップした/);
  assert.equal(existsSync(join(dir, 'data/seo/improvement-log.json')), false, 'improvement-log.json が新規に作られていないこと');
  rmSync(dir, { recursive: true, force: true });
});
