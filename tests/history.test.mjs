import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotKey, readHistory, appendSnapshot, findSnapshot, latestSnapshot, rankFor } from '../scripts/lib/history.mjs';

const snap = (days, endDate, ranks = []) => ({ fetchedAt: '2026-09-11T20:00:00Z', window: { days, startDate: 'x', endDate }, ranks, pageQueries: {} });

test('appendSnapshot は 1 行 1 件で追記し、同じ窓は二重に積まない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-hist-'));
  const p = join(dir, 'data/seo/rank-history.jsonl');
  assert.deepEqual(readHistory(p), [], '無ければ空');
  assert.deepEqual(appendSnapshot(p, snap(7, '2026-09-08')), { appended: true, total: 1 });
  assert.deepEqual(appendSnapshot(p, snap(28, '2026-09-08')), { appended: true, total: 2 });
  assert.deepEqual(appendSnapshot(p, snap(7, '2026-09-08')), { appended: false, total: 2 }, '同じキーは追記しない');
  assert.equal(readFileSync(p, 'utf8').trim().split('\n').length, 2);
  assert.equal(readHistory(p).length, 2);
  rmSync(dir, { recursive: true, force: true });
});
test('findSnapshot / latestSnapshot / rankFor', () => {
  const xs = [snap(7, '2026-09-08', [{ keyword: 'k', rank: 4 }]), snap(7, '2026-09-09', [{ keyword: 'k', rank: 3 }]), snap(28, '2026-09-09')];
  assert.equal(snapshotKey(xs[0]), '7:2026-09-08');
  assert.equal(findSnapshot(xs, 7, '2026-09-08').ranks[0].rank, 4);
  assert.equal(findSnapshot(xs, 7, '2026-09-10'), null);
  assert.equal(latestSnapshot(xs, 7).window.endDate, '2026-09-09');
  assert.equal(latestSnapshot(xs, 14), null);
  assert.equal(rankFor(xs[1], 'k').rank, 3);
  assert.equal(rankFor(null, 'k'), null);
  assert.equal(rankFor(xs[1], 'zzz'), null);
});
