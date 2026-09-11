import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, tokens, queryMatchesKeyword, normalizePath } from '../scripts/lib/normalize.mjs';

test('normalizeText は全角・大文字・空白のゆれを吸収する', () => {
  assert.equal(normalizeText('Ｃｌａｕｄｅ　Code   サブエージェント'), 'claude code サブエージェント');
});
test('queryMatchesKeyword は監視語の全トークンを含むクエリだけ真', () => {
  const kw = 'Claude Code サブエージェント 使い方';
  assert.equal(queryMatchesKeyword('claude code サブエージェント　使い方', kw), true);
  assert.equal(queryMatchesKeyword('claude code サブエージェント 使い方 初心者', kw), true);
  assert.equal(queryMatchesKeyword('claude code サブエージェント', kw), false, '使い方 が無い');
  assert.equal(queryMatchesKeyword('claude code サブエージェント 使い方', ''), false, '空の監視語は何にも一致しない');
});
test('normalizePath は URL でもパスでも同じ形にする', () => {
  assert.equal(normalizePath('https://www.example.com/foo/?x=1#y'), '/foo');
  assert.equal(normalizePath('/foo/'), '/foo');
  assert.equal(normalizePath('foo'), '/foo');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('https://example.com'), '/');
  assert.equal(normalizePath('not a url but ok'), '/not a url but ok');
});
test('tokens は空白区切り', () => {
  assert.deepEqual(tokens('  A  b　c '), ['a', 'b', 'c']);
});
