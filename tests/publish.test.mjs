import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintFromDiff, htmlContains, stripHtml } from '../scripts/lib/publish.mjs';

test('fingerprintFromDiff は追加行から 20 字以上の最長の一文を選ぶ', () => {
  const a = '---\ntitle: "t"\n---\n\n本文\n';
  const b = '---\ntitle: "t"\nfaqs:\n  - q: "短い"\n    a: "これは公開確認に使う目印になるくらい十分に長い答えの文です。"\n---\n\n本文\n\n## 新しい見出し\n';
  assert.equal(fingerprintFromDiff(a, b), 'これは公開確認に使う目印になるくらい十分に長い答えの文です。');
  assert.equal(fingerprintFromDiff(a, `${a}\n短い\n`), null);
  assert.equal(fingerprintFromDiff(a, `${a}\n短い追加\n`, 4), '短い追加', '下限は引数で下げられる');
});
test('htmlContains はタグを除き、空白と全角半角の差を無視して探す', () => {
  const html = '<p>これは<b>公開確認</b>に使う目印に なるくらい十分に長い答えの文です。</p>';
  assert.equal(htmlContains(html, 'これは公開確認に使う目印になるくらい十分に長い答えの文です。'), true);
  assert.equal(htmlContains(html, '含まれない文'), false);
  assert.equal(htmlContains('<meta name="description" content="説明文の目印">', '説明文の目印'), true, '属性の中も見る');
  assert.equal(stripHtml('<script>x</script><p>a&amp;b</p>'), ' a&b ');
});
