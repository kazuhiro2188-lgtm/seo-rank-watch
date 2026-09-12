import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakDays, streakLagDays, keyAgeDays, buildReport } from '../scripts/lib/report.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const config = validateConfig({ site: 's', baseUrl: 'https://x.invalid', contentDir: 'c', pathToFile: 'c/{path}.md', contentFormat: 'markdown-plain', frontmatter: { editable: [] }, build: {}, deploy: { type: 'git-push' }, keys: { oauthIssuedOn: '2026-07-01', gscKeyIssuedOn: '2026-09-01' } });
const snap = (endDate) => ({ window: { days: 7, endDate }, ranks: [{ keyword: 'k', rank: 4, impressions: 100 }] });

test('streakDays は最新の 7 日窓の終端から連続する数（today−3 から数え始めない）', () => {
  assert.equal(streakDays([snap('2026-09-08'), snap('2026-09-07'), snap('2026-09-05')]), 2);
  // 週次が日次より先に走った週。当日ぶん（today−3 = 09-08）はまだ無いが、連続は途切れていない。
  assert.equal(streakDays([snap('2026-09-07'), snap('2026-09-06')]), 2);
  assert.equal(streakDays([snap('2026-09-07')]), 1);
  assert.equal(streakDays([]), 0);
});
test('streakLagDays は最新の 7 日窓が today−3 より何日古いか（追いついていれば 0）', () => {
  assert.equal(streakLagDays([snap('2026-09-08'), snap('2026-09-07')], '2026-09-11'), 0);
  assert.equal(streakLagDays([snap('2026-09-07'), snap('2026-09-06')], '2026-09-11'), 1);
  assert.equal(streakLagDays([snap('2026-09-05')], '2026-09-11'), 3);
  assert.equal(streakLagDays([], '2026-09-11'), 0);
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
  // 最新窓 2026-09-15 = today−3 なので遅れ 0。遅れ 0 の週は括弧を出さない（この $ 付き正規表現が固定する）。
  assert.match(r.headerLines[0], /^連続実行: 日次 2 日 \/ 週次 3 回 \| 最終公開確認: 2026-09-11 \| 鍵: OAuth 79 日 ⚠️・GSC 17 日$/);
  assert.equal(/遅れ/.test(r.headerLines[0]), false, '遅れ 0 日なのに括弧が出ている');
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

test('blocked の週の報告は差分と AI の自由記述の秘密文字列を伏せる（報告は公開リポジトリに入る）', () => {
  const secret = 'sk-ant-api03-REALSECRETVALUE123';
  const r = buildReport({
    today: '2026-09-18', config, snapshots: [], log: { entries: [] }, verdicts: [], reportOnly: [], warnings: [],
    repoUrl: 'u', reportCount: 1,
    outcome: {
      status: 'blocked', candidate: { keyword: 'k', file: 'c/a.md' },
      failures: [{ check: 6, detail: '秘密文字列らしきものの新出（sk-ant-）' }],
      diff: { added: [`api key: ${secret}`], removed: [`古い鍵 ${secret}`] },
      pendingAction: { needs: `ニーズ ${secret}`, done: 'd', proposals: [`提案 ${secret}`], needsAuthor: [`質問 ${secret}`] },
    },
  });
  assert.equal(r.markdown.includes(secret), false, '報告の本文に生の秘密文字列が残っている');
  assert.equal(r.markdown.includes('REALSECRETVALUE'), false, '前方一致だけ伏せて本体が残っている');
  assert.equal(r.slackText.includes(secret), false, 'Slack 文面に生の秘密文字列が残っている');
  assert.match(r.markdown, /\+ api key: \*\*\*/);
  assert.match(r.markdown, /- 古い鍵 \*\*\*/);
  assert.match(r.markdown, /## 検索ニーズ（AI の定義）\n\nニーズ \*\*\*/);
  assert.match(r.markdown, /- 提案 \*\*\*/);
  assert.match(r.markdown, /- 質問 \*\*\*/);
});

test('週次が日次より先に走った週も、連続実行は 0 にならず「遅れ N 日」を併記する', () => {
  const base = { today: '2026-09-18', config, log: { entries: [] }, verdicts: [], reportOnly: [], warnings: [], repoUrl: 'u', reportCount: 3, outcome: { status: 'no-candidate' } };
  // today−3 = 2026-09-15 の記録がまだ無い（日次がこの後に走る）。連続は 09-14 まで途切れていない。
  const late = buildReport({ ...base, snapshots: [snap('2026-09-14'), snap('2026-09-13'), snap('2026-09-12')] });
  assert.match(late.headerLines[0], /^連続実行: 日次 3 日（遅れ 1 日）\/ 週次 3 回 \|/);
  // 本当に止まっている週は遅れが大きく出る
  const stalled = buildReport({ ...base, snapshots: [snap('2026-09-08')] });
  assert.match(stalled.headerLines[0], /^連続実行: 日次 1 日（遅れ 7 日）\/ 週次 3 回 \|/);
  // 記録が 1 件も無ければ 0 日・括弧なし
  const none = buildReport({ ...base, snapshots: [] });
  assert.match(none.headerLines[0], /^連続実行: 日次 0 日 \/ 週次 3 回 \|/);
});
