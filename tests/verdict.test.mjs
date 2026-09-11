import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewDates, judge, judgeAchieved, computeVerdicts } from '../scripts/lib/verdict.mjs';
import { DEFAULT_LIMITS as L } from '../scripts/lib/config.mjs';

const entry = (over = {}) => ({ file: 'content/articles/a.md', status: 'observing', attempts: 0, extensions: 0, publishedVerifiedAt: '2026-09-18', nextReviewDate: '2026-09-28', actions: [{ keyword: 'k', commitSha: 'abc1234', verdict: null }], ...over });

test('reviewDates: 観察開始日 S から前窓終端 S−1・後窓終端 S+7・判定日 S+10', () => {
  assert.deepEqual(reviewDates('2026-09-18'), { beforeEnd: '2026-09-17', afterEnd: '2026-09-25', reviewDate: '2026-09-28' });
});
test('判定表: 標本不足は unmeasurable で延長、上限で parked', () => {
  const r1 = judge({ entry: entry(), before: { rank: 4, impressions: 10 }, after: { rank: 2, impressions: 100 }, limits: L });
  assert.deepEqual([r1.verdict, r1.status, r1.extensions, r1.revert], ['unmeasurable', 'observing', 1, false]);
  const r2 = judge({ entry: entry({ extensions: 2 }), before: null, after: null, limits: L });
  assert.deepEqual([r2.verdict, r2.status], ['unmeasurable', 'parked']);
});
test('判定表: rank1 / worsened / improved / no-effect', () => {
  const b = { rank: 4.0, impressions: 100 };
  assert.deepEqual(pick(judge({ entry: entry(), before: b, after: { rank: 1.2, impressions: 100 }, limits: L })), ['rank1', 'achieved', 0, false]);
  assert.deepEqual(pick(judge({ entry: entry(), before: b, after: { rank: 7.0, impressions: 100 }, limits: L })), ['worsened', 'reverted', 1, true]);
  assert.deepEqual(pick(judge({ entry: entry(), before: b, after: { rank: 2.9, impressions: 100 }, limits: L })), ['improved', 'active', 1, false]);
  assert.deepEqual(pick(judge({ entry: entry(), before: b, after: { rank: 3.5, impressions: 100 }, limits: L })), ['no-effect', 'active', 1, false]);
  assert.deepEqual(pick(judge({ entry: entry({ attempts: 2 }), before: b, after: { rank: 3.5, impressions: 100 }, limits: L })), ['no-effect', 'parked', 3, false], '3 回目の効果なしで parked');
});
function pick(r) { return [r.verdict, r.status, r.attempts, r.revert]; }
test('achieved は 2.0 超が 2 週続いたら active に戻る', () => {
  assert.deepEqual(judgeAchieved({ entry: { regressions: 0 }, latestRank: 2.5, limits: L }), { status: 'achieved', regressions: 1 });
  assert.deepEqual(judgeAchieved({ entry: { regressions: 1 }, latestRank: 2.5, limits: L }), { status: 'active', regressions: 2 });
  assert.deepEqual(judgeAchieved({ entry: { regressions: 1 }, latestRank: 1.1, limits: L }), { status: 'achieved', regressions: 0 }, '戻れば数え直し');
});
test('computeVerdicts: 判定日前は何も出さず、後窓が無ければ pending、揃えば判定し revertSha を付ける', () => {
  const snap = (endDate, rank, impressions = 100) => ({ window: { days: 7, endDate }, ranks: [{ keyword: 'k', rank, impressions }] });
  const log = { entries: [entry()] };
  assert.deepEqual(computeVerdicts({ log, snapshots: [], limits: L, today: '2026-09-27' }), [], '判定日前');
  const p = computeVerdicts({ log, snapshots: [snap('2026-09-17', 4)], limits: L, today: '2026-09-28' });
  assert.equal(p[0].verdict, 'pending');
  const v = computeVerdicts({ log, snapshots: [snap('2026-09-17', 4), snap('2026-09-25', 8)], limits: L, today: '2026-09-28' });
  assert.equal(v[0].verdict, 'worsened');
  assert.equal(v[0].revertSha, 'abc1234');
  assert.equal(v[0].cooldownUntil, '2026-10-05');
  const u = computeVerdicts({ log, snapshots: [snap('2026-09-17', 4, 5), snap('2026-09-25', 8, 5)], limits: L, today: '2026-09-28' });
  assert.equal(u[0].verdict, 'unmeasurable');
  assert.equal(u[0].nextReviewDate, '2026-10-05', '延長は today+7');
});
test('computeVerdicts: reverted の冷却期間が明けたら active', () => {
  const log = { entries: [entry({ status: 'reverted', cooldownUntil: '2026-09-20' })] };
  assert.deepEqual(computeVerdicts({ log, snapshots: [], limits: L, today: '2026-09-20' }).map((v) => v.status), ['active']);
  assert.deepEqual(computeVerdicts({ log, snapshots: [], limits: L, today: '2026-09-19' }), []);
});
