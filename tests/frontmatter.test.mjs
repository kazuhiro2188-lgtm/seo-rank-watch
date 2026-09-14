import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, topLevelBlocks, diffFrontmatter, structurallyValid, readTitle } from '../scripts/lib/frontmatter.mjs';

const FM = `title: "A"\ndescription: "d"\nfaqs:\n  - q: "q1"\n    a: "a1"\ndraft: false`;
const DOC = `---\n${FM}\n---\n\n本文\n`;

test('splitFrontmatter は --- で囲まれた先頭ブロックと本文を分ける', () => {
  const { fm, body } = splitFrontmatter(DOC);
  assert.equal(fm, FM);
  assert.equal(body, '\n本文\n');
  assert.deepEqual(splitFrontmatter('本文だけ'), { fm: null, body: '本文だけ' });
});
test('topLevelBlocks は入れ子を親キーの塊として持つ', () => {
  const b = topLevelBlocks(FM);
  assert.deepEqual([...b.keys()], ['title', 'description', 'faqs', 'draft']);
  assert.equal(b.get('faqs'), 'faqs:\n  - q: "q1"\n    a: "a1"');
});
test('diffFrontmatter は変更・追加・削除のキーを返す', () => {
  const after = `title: "B"\ndescription: "d"\nfaqs:\n  - q: "q1"\n    a: "a1"\n  - q: "q2"\n    a: "a2"\nupdatedAt: "2026-09-18"`;
  assert.deepEqual(diffFrontmatter(FM, after), { changed: ['title', 'faqs'], added: ['updatedAt'], removed: ['draft'] });
});
test('structurallyValid はタブ・キーでない先頭行を拒む', () => {
  assert.equal(structurallyValid(FM), true);
  assert.equal(structurallyValid(null), true);
  assert.equal(structurallyValid('title: "A"\n\tbad: 1'), false);
  assert.equal(structurallyValid('title: "A"\nこれはキーではない'), false);
});
test('readTitle', () => {
  assert.equal(readTitle(DOC), 'A');
  assert.equal(readTitle('本文'), null);
});
