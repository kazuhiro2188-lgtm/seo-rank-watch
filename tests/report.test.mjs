import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakDays, keyAgeDays, buildReport } from '../scripts/lib/report.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const config = validateConfig({ site: 's', baseUrl: 'https://x.invalid', contentDir: 'c', pathToFile: 'c/{path}.md', contentFormat: 'markdown-plain', frontmatter: { editable: [] }, build: {}, deploy: { type: 'git-push' }, keys: { oauthIssuedOn: '2026-07-01', gscKeyIssuedOn: '2026-09-01' } });
const snap = (endDate) => ({ window: { days: 7, endDate }, ranks: [{ keyword: 'k', rank: 4, impressions: 100 }] });

test('streakDays は today−3 から連続する 7 日窓の数', () => {
  assert.equal(streakDays([snap('2026-09-08'), snap('2026-09-07'), snap('2026-09-05')], '2026-09-11'), 2);
  assert.equal(streakDays([snap('2026-09-07')], '2026-09-11'), 0);
  assert.equal(streakDays([], '2026-09-11'), 0);
});
test('keyAgeDays', () => {
  assert.equal(keyAgeDays('2026-07-01', '2026-09-11'), 72);
  assert.equal(keyAgeDays(undefined, '2026-09-11'), null);
});
test('buildReport の先頭 3 行は固定の形で、鍵は 75 日で警告', () => {
  const r = buildReport({
    today: '2026-09-18', config, snapshots: [snap('2026-09-15'), snap('2026-09-14')],
    log: { entries: [{ file: 'c/a.md', status: 'observing', publishedVerifiedAt: '2026-09-11', nextReviewDate: '2026-09-21', actions: [{ keyword: 'k', needsAuthor: ['体験談は？'], proposals: [] }] }] },
    verdicts: [{ file: 'c/b.md', keyword: 'j', verdict: 'unmeasurable', status: 'observing' }],
    reportOnly: [{ keyword: 'top', reason: 'unsupported' }],
    outcome: { status: 'pass', candidate: { keyword: 'k', file: 'c/a.md', rank: 4, tier: 1 }, pendingAction: { editType: 'faq', needs: 'n', done: 'd', proposals: ['noindex を検討'], needsAuthor: ['体験談は？'] }, diff: { added: ['+ 追加行'], removed: [] } },
    warnings: ['最新の週次報告が 12 日前'], repoUrl: 'https://github.com/o/r', reportCount: 3,
  });
  assert.equal(r.headerLines.length, 3);
  assert.match(r.headerLines[0], /^連続実行: 日次 2 日 \/ 週次 3 回 \| 最終公開確認: 2026-09-11 \| 鍵: OAuth 79 日 ⚠️・GSC 17 日$/);
  assert.match(r.headerLines[1], /^今週: pass（c\/a\.md・faq）\| 判定 1 件（unmeasurable 1）\| 報告のみ 1 件$/);
  assert.match(r.headerLines[2], /^質問: 1 件/);
  assert.match(r.markdown, /## 行った改善/);
  assert.match(r.markdown, /\+ 追加行/);
  assert.match(r.markdown, /noindex を検討/);
  assert.match(r.markdown, /体験談は？/);
  assert.match(r.markdown, /最新の週次報告が 12 日前/);
  assert.match(r.slackText, /reports\/2026-09-18\.md/);
  assert.ok(r.slackText.startsWith('連続実行:'));
});
test('候補なし・不合格の週も先頭 2 行目に出る', () => {
  const base = { today: '2026-09-18', config, snapshots: [], log: { entries: [] }, verdicts: [], reportOnly: [], warnings: [], repoUrl: 'u', reportCount: 0 };
  assert.match(buildReport({ ...base, outcome: { status: 'no-candidate' } }).headerLines[1], /^今週: 候補なし/);
  assert.match(buildReport({ ...base, outcome: { status: 'blocked', candidate: { keyword: 'k', file: 'c/a.md' }, failures: [{ check: 3, detail: 'x' }] } }).headerLines[1], /^今週: blocked（c\/a\.md・1 件）/);
});
