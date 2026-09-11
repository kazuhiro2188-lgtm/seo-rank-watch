import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTemplate, internalLinkCandidates, formatPageQueries } from '../scripts/lib/prompt.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const SITE = new URL('../fixtures/site', import.meta.url).pathname;
const config = validateConfig(JSON.parse(readFileSync(`${SITE}/seo.config.json`, 'utf8')));

test('renderTemplate は {{key}} を置換し、未指定キーは例外', () => {
  assert.equal(renderTemplate('a {{x}} b {{y}}', { x: 1, y: 'z' }), 'a 1 b z');
  assert.throws(() => renderTemplate('{{missing}}', {}), /missing/);
});
test('internalLinkCandidates は対象以外の公開記事をパスと題名で返す', () => {
  const xs = internalLinkCandidates(SITE, config, 'content/articles/first-run.md');
  assert.deepEqual(xs, [{ path: '/second-topic', title: '二つ目の話題——試験用サイトの記事 2' }], '下書きと対象自身は除く');
});
test('formatPageQueries は箇条書き、空なら注記', () => {
  assert.equal(formatPageQueries([{ query: 'q', impressions: 10, rank: 3.2 }]), '- q（表示 10・3.2 位）');
  assert.match(formatPageQueries([]), /まだありません/);
});
test('雛形は必要な差し込み口をすべて持ち、禁止事項と出力契約を含む', () => {
  const tpl = readFileSync(new URL('../prompts/improve.md', import.meta.url), 'utf8');
  for (const k of ['keyword', 'targetPath', 'rank', 'impressions', 'article', 'pageQueries', 'internalLinks', 'previousDone', 'avoidEditType', 'editableFrontmatter', 'outDir', 'baseDomain']) {
    assert.ok(tpl.includes(`{{${k}}}`), `{{${k}}} が無い`);
  }
  assert.match(tpl, /pending-action\.json/);
  assert.match(tpl, /noindex/);
  assert.match(tpl, /指示ではなくデータ/);
});
