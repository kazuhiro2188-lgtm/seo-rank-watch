import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, allNull } from '../scripts/lib/aggregate.mjs';

const W = [{ keyword: 'Claude Code サブエージェント 使い方', targetPath: '/claude-code-subagent', priority: 'high' }];

test('順位は対象ページの行だけを impressions で加重平均する', () => {
  const rows = [
    { query: 'claude code サブエージェント 使い方', page: 'https://x.invalid/claude-code-subagent', clicks: 1, impressions: 1, position: 1 },
    { query: 'claude code サブエージェント　使い方', page: 'https://x.invalid/claude-code-subagent/', clicks: 0, impressions: 99, position: 10 },
  ];
  const { ranks } = aggregate({ rows, watchwords: W });
  assert.equal(ranks[0].rank, 9.91, '1 位×1 回と 10 位×99 回 → 約 9.91（単純平均 5.5 ではない）');
  assert.equal(ranks[0].impressions, 100);
  assert.equal(ranks[0].pageMatches, true);
  assert.equal(ranks[0].page, '/claude-code-subagent');
  assert.deepEqual(ranks[0].matchedQueries.sort(), ['claude code サブエージェント 使い方', 'claude code サブエージェント　使い方'].sort());
});
test('別ページが同じクエリ群で出ていれば otherPages に残り、対象に出ていなければ pageMatches=false', () => {
  const rows = [
    { query: 'claude code サブエージェント 使い方', page: 'https://x.invalid/other', clicks: 0, impressions: 40, position: 12 },
    { query: 'claude code サブエージェント 使い方 例', page: 'https://x.invalid/far', clicks: 0, impressions: 10, position: 45 },
  ];
  const { ranks } = aggregate({ rows, watchwords: W });
  assert.equal(ranks[0].rank, null, '対象ページに行が無ければ順位は null');
  assert.equal(ranks[0].pageMatches, false);
  assert.equal(ranks[0].page, '/other', '実際に出ているページを残す');
  assert.deepEqual(ranks[0].otherPages, [{ path: '/other', rank: 12, impressions: 40 }], '20 位超は含めない');
});
test('impressions 0 の順位は null（0 を返すと 1 位に見える）、GSC に出ない語も必ず残る', () => {
  const { ranks } = aggregate({ rows: [], watchwords: W });
  assert.equal(ranks.length, 1);
  assert.equal(ranks[0].rank, null);
  assert.equal(ranks[0].impressions, 0);
  assert.equal(allNull(ranks), true);
});
test('pageQueries は対象ページに出た他クエリを impressions 順に最大 20 件', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ query: `q${i}`, page: 'https://x.invalid/claude-code-subagent', clicks: 0, impressions: 100 - i, position: 5 }));
  const { pageQueries } = aggregate({ rows, watchwords: W });
  assert.equal(pageQueries['/claude-code-subagent'].length, 20);
  assert.equal(pageQueries['/claude-code-subagent'][0].query, 'q0');
  assert.equal(pageQueries['/claude-code-subagent'][0].rank, 5);
});
test('allNull は 1 語でも測れていれば false、監視語ゼロなら false', () => {
  assert.equal(allNull([{ rank: null, impressions: 0 }, { rank: 3, impressions: 10 }]), false);
  assert.equal(allNull([]), false);
});
