import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ymd, addDays, daysBetween, resolveWindow, windowEndingAt } from '../scripts/lib/dates.mjs';

test('resolveWindow は終端を 3 日前に置く（GSC の遅延）', () => {
  assert.deepEqual(resolveWindow(7, '2026-09-11'), { days: 7, startDate: '2026-09-02', endDate: '2026-09-08' });
  assert.deepEqual(resolveWindow(28, '2026-09-11'), { days: 28, startDate: '2026-08-12', endDate: '2026-09-08' });
});
test('windowEndingAt は終端固定の窓', () => {
  assert.deepEqual(windowEndingAt(7, '2026-09-25'), { days: 7, startDate: '2026-09-19', endDate: '2026-09-25' });
});
test('addDays / daysBetween は月またぎを正しく扱う', () => {
  assert.equal(addDays('2026-09-28', 5), '2026-10-03');
  assert.equal(addDays('2026-10-03', -5), '2026-09-28');
  assert.equal(daysBetween('2026-09-18', '2026-09-28'), 10);
  assert.equal(ymd(new Date('2026-09-11T23:59:59Z')), '2026-09-11');
});
