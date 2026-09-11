import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidate } from '../scripts/lib/select.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const SITE = new URL('../fixtures/site', import.meta.url).pathname;
const config = validateConfig(JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(`${SITE}/seo.config.json`, 'utf8'))));
const rank = (over) => ({ keyword: 'k', targetPath: '/first-run', priority: 'high', rank: 4, impressions: 120, clicks: 5, page: '/first-run', pageMatches: true, otherPages: [], matchedQueries: ['k'], ...over });
const pick = ({ ranks, log = { entries: [] }, today = '2026-09-18' }) => selectCandidate({ ranks, log, config, repoDir: SITE, today });

test('2〜10 位＋impressions 十分な語を、1 位に近い順に 1 つだけ選ぶ', () => {
  const r = pick({ ranks: [rank({ keyword: 'a', rank: 6 }), rank({ keyword: 'b', rank: 3, targetPath: '/second-topic' })] });
  assert.equal(r.candidate.keyword, 'b');
  assert.equal(r.candidate.file, 'content/articles/second-topic.md');
  assert.equal(r.candidate.tier, 1);
  assert.deepEqual(r.candidate.previousDone, []);
});
test('11〜20 位は impressions が多い順、2〜10 位より後', () => {
  const r = pick({ ranks: [rank({ keyword: 'a', rank: 15, impressions: 500, targetPath: '/second-topic' }), rank({ keyword: 'b', rank: 9, impressions: 40 })] });
  assert.equal(r.candidate.keyword, 'b');
  const r2 = pick({ ranks: [rank({ keyword: 'a', rank: 15, impressions: 500, targetPath: '/second-topic' }), rank({ keyword: 'c', rank: 12, impressions: 90 })] });
  assert.equal(r2.candidate.keyword, 'a');
  assert.equal(r2.candidate.tier, 2);
});
test('報告のみ: トップページ・順位 null・別ページに出ている・カニバリ・1 位', () => {
  const r = pick({ ranks: [
    rank({ keyword: 'top', targetPath: '/' }),
    rank({ keyword: 'nul', rank: null, impressions: 0 }),
    rank({ keyword: 'mis', pageMatches: false, page: '/elsewhere', rank: null }),
    rank({ keyword: 'can', otherPages: [{ path: '/second-topic', rank: 9, impressions: 30 }] }),
    rank({ keyword: 'one', rank: 1.1 }),
  ] });
  assert.equal(r.candidate, null);
  assert.deepEqual(r.reportOnly.map((x) => [x.keyword, x.reason]), [['top', 'unsupported'], ['nul', 'rank-null'], ['mis', 'mismatch'], ['can', 'cannibalized'], ['one', 'rank1']]);
});
test('ロックはファイル単位: observing / parked / achieved / unpublished / 冷却中の reverted は選ばない', () => {
  for (const [status, extra] of [['observing', {}], ['parked', {}], ['achieved', {}], ['unpublished', {}], ['reverted', { cooldownUntil: '2026-09-20' }]]) {
    const log = { entries: [{ file: 'content/articles/first-run.md', status, actions: [], ...extra }] };
    const r = pick({ ranks: [rank({ keyword: 'other-kw' })], log });
    assert.equal(r.candidate, null, status);
    assert.equal(r.reportOnly[0].reason, 'locked', status);
  }
  const log = { entries: [{ file: 'content/articles/first-run.md', status: 'reverted', cooldownUntil: '2026-09-18', actions: [] }] };
  assert.equal(pick({ ranks: [rank({})], log }).candidate?.keyword, 'k', '冷却期間が明けていれば選べる');
});
test('効果なしの語は試行上限内なら候補（前回と違う editType を指示）、上限で報告のみ', () => {
  const act = (verdict, editType) => ({ date: '2026-09-04', keyword: 'k', editType, done: `did ${editType}`, verdict });
  const log = { entries: [{ file: 'content/articles/first-run.md', status: 'active', attempts: 1, actions: [act('no-effect', 'faq')] }] };
  const r = pick({ ranks: [rank({ rank: 25, impressions: 5 })], log });
  assert.equal(r.candidate.tier, 3);
  assert.equal(r.candidate.avoidEditType, 'faq');
  assert.deepEqual(r.candidate.previousDone, ['did faq']);
  const log3 = { entries: [{ file: 'content/articles/first-run.md', status: 'active', attempts: 3, actions: [act('no-effect', 'faq')] }] };
  assert.equal(pick({ ranks: [rank({})], log: log3 }).reportOnly[0].reason, 'attempts-exhausted');
});
test('ファイルが無ければ missing-file', () => {
  const r = pick({ ranks: [rank({ targetPath: '/no-such-article' })] });
  assert.equal(r.reportOnly[0].reason, 'missing-file');
});
