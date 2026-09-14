import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from '../scripts/lib/diff.mjs';

test('lineDiff は追加行と削除行を返す', () => {
  const a = 'a\nb\nc\nd';
  const b = 'a\nB\nc\nd\ne';
  assert.deepEqual(lineDiff(a, b), { added: ['B', 'e'], removed: ['b'] });
  assert.deepEqual(lineDiff(a, a), { added: [], removed: [] });
  assert.deepEqual(lineDiff('', 'x'), { added: ['x'], removed: [''] });
});
