import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChange } from '../scripts/lib/checks.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const config = validateConfig({
  site: 's', baseUrl: 'https://mysite.invalid', contentDir: 'content/articles', pathToFile: 'content/articles/{path}.md',
  contentFormat: 'markdown-plain', frontmatter: { editable: ['title', 'description', 'faqs'] }, build: { command: 'true' }, deploy: { type: 'git-push' },
  linkAllowlist: ['mysite.invalid'], bannedWords: ['絶対に儲かる'],
});
const ORIGINAL = `---
title: "元の題名"
description: "元の説明"
keyword: "k"
publishedAt: "2026-09-01"
draft: false
faqs:
  - q: "質問一"
    a: "答え一"
---

本文の一行目です。参考: https://mysite.invalid/other と https://partner.example/aff?id=ABC123

## 見出し

ここに本文があります。
`;
const candidate = { keyword: 'k', targetPath: '/a', file: 'content/articles/a.md', avoidEditType: null };
const pa = (over = {}) => ({ keyword: 'k', targetPath: '/a', editType: 'faq', needs: '知りたいこと', done: 'FAQ を足した', proposals: [], needsAuthor: [], ...over });
const run = (revised, over = {}, fetched = []) => verifyChange({ original: ORIGINAL, revised, pendingAction: pa(over.pa), candidate: { ...candidate, ...(over.candidate ?? {}) }, config, fetchedDomains: fetched });
const checks = (r) => [...new Set(r.failures.map((f) => f.check))].sort();
const GOOD = ORIGINAL.replace('    a: "答え一"\n', '    a: "答え一"\n  - q: "質問二"\n    a: "本文にある事実で答える"\n');

test('合格例: 日本語の FAQ を 1 問足す', () => {
  const r = run(GOOD);
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
});
test('1 同一性: 空出力・無変更は不合格', () => {
  assert.ok(checks(run('')).includes(1));
  assert.ok(checks(run(ORIGINAL)).includes(1));
});
test('2 frontmatter: 許可外の変更・追加・削除・構造崩れは不合格。title の変更は合格', () => {
  assert.ok(checks(run(GOOD.replace('keyword: "k"', 'keyword: "changed"'))).includes(2));
  assert.ok(checks(run(GOOD.replace('draft: false', 'draft: true'))).includes(2));
  assert.ok(checks(run(GOOD.replace('draft: false\n', 'draft: false\nnoindex: true\n'))).includes(2));
  assert.ok(checks(run(GOOD.replace('draft: false\n', 'draft: false\nupdatedAt: "2026-09-18"\n'))).includes(2), 'updatedAt はスクリプトが刻む');
  assert.ok(checks(run(GOOD.replace('publishedAt: "2026-09-01"\n', ''))).includes(2));
  assert.ok(checks(run(GOOD.replace('description: "元の説明"', 'description:\t"x"'))).includes(2));
  assert.equal(run(GOOD.replace('title: "元の題名"', 'title: "新しい題名"')).ok, true);
});
test('3 外部リンク: 許可外ドメイン・AI が読んだドメイン・既存 URL の改変は不合格。自サイトへのリンクは合格', () => {
  assert.ok(checks(run(`${GOOD}\n詳しくは https://spam.example/buy を見る\n`)).includes(3));
  assert.ok(checks(run(`${GOOD}\n参考 https://rival.example/post\n`, {}, ['rival.example'])).includes(3));
  assert.ok(checks(run(GOOD.replace('aff?id=ABC123', 'aff?id=EVIL999'))).includes(3), 'アフィリエイト ID の差し替え');
  assert.equal(run(`${GOOD}\n関連: https://mysite.invalid/another\n`).ok, true);
});
test('4 実行可能・隠しコンテンツ: HTML タグ・テンプレート構文・ゼロ幅文字は不合格。コードフェンス内は許す', () => {
  assert.ok(checks(run(`${GOOD}\n<script>alert(1)</script>\n`)).includes(4));
  assert.ok(checks(run(`${GOOD}\n<a href="/x">link</a>\n`)).includes(4));
  assert.ok(checks(run(`${GOOD}\n{{ site.secret }}\n`)).includes(4));
  assert.ok(checks(run(`${GOOD}\n見えない\u200B文字\n`)).includes(4));
  assert.ok(checks(run(`${GOOD}\n<!-- 隠し -->\n`)).includes(4));
  assert.equal(run(`${GOOD}\n\`\`\`html\n<div>例</div>\n\`\`\`\n`).ok, true);
});
test('5 規模: 追加 61 行・削除 20% 超・元の 70% 未満は不合格', () => {
  assert.ok(checks(run(`${GOOD}\n${Array.from({ length: 61 }, (_, i) => `追加の行 ${i}`).join('\n')}\n`)).includes(5));
  assert.ok(checks(run(GOOD.replace(/\n本文の一行目[\s\S]*$/, '\n'))).includes(5), '本文をほぼ全部消す');
  assert.ok(checks(run(GOOD.slice(0, Math.floor(GOOD.length * 0.5)))).includes(5));
});
test('6 秘密・連絡先: API キー・メール・電話・暗号資産アドレスの新出は不合格', () => {
  assert.ok(checks(run(`${GOOD}\nsk-ant-api03-abcdef\n`)).includes(6));
  assert.ok(checks(run(`${GOOD}\n連絡は me@example.com\n`)).includes(6));
  assert.ok(checks(run(`${GOOD}\n電話 03-1234-5678\n`)).includes(6));
  assert.ok(checks(run(`${GOOD}\n送金先 0x52908400098527886E0F7030069857D2E4169EE7\n`)).includes(6));
});
test('7 言語・文体: 英語だけの加筆・禁止語・URL 急増は不合格', () => {
  assert.ok(checks(run(`${GOOD}\nThis paragraph is entirely in English and adds nothing for Japanese readers at all.\n`)).includes(7));
  assert.ok(checks(run(`${GOOD}\nこの方法は絶対に儲かる。\n`)).includes(7));
  assert.ok(checks(run(`${GOOD}\n${Array.from({ length: 8 }, (_, i) => `https://mysite.invalid/p${i}`).join(' ')}\n`)).includes(7));
});
test('8 申告: キーワード不一致・不正な editType・前回と同じ型・needs 欠落は不合格', () => {
  assert.ok(checks(run(GOOD, { pa: { keyword: 'other' } })).includes(8));
  assert.ok(checks(run(GOOD, { pa: { editType: 'rewrite-all' } })).includes(8));
  assert.ok(checks(run(GOOD, { candidate: { avoidEditType: 'faq' } })).includes(8));
  assert.ok(checks(run(GOOD, { pa: { needs: '' } })).includes(8));
  assert.ok(checks(run(GOOD, { pa: { proposals: 'not array' } })).includes(8));
});

test('4 追加: frontmatter の値（faqs）に <script> を混入させても不合格', () => {
  const bad = GOOD.replace('a: "本文にある事実で答える"', 'a: "<script>alert(1)</script>"');
  assert.ok(checks(run(bad)).includes(4));
});
test('4 追加: 元記事に <br> があっても新規の <script> は不合格（パターン単位の見逃しを避ける）', () => {
  const originalWithBr = ORIGINAL.replace('ここに本文があります。\n', 'ここに本文があります。<br>\n');
  const revisedWithScript = originalWithBr.replace('<br>\n', '<br>\n<script>alert(1)</script>\n');
  const r = verifyChange({ original: originalWithBr, revised: revisedWithScript, pendingAction: pa(), candidate, config, fetchedDomains: [] });
  assert.ok(checks(r).includes(4));
});
test('4 追加: 元記事と同数のタグ（<br> 1 個のまま）は誤検知しない', () => {
  const originalWithBr = ORIGINAL.replace('ここに本文があります。\n', 'ここに本文があります。<br>\n');
  const goodWithBr = originalWithBr.replace('    a: "答え一"\n', '    a: "答え一"\n  - q: "質問二"\n    a: "本文にある事実で答える"\n');
  const r = verifyChange({ original: originalWithBr, revised: goodWithBr, pendingAction: pa(), candidate, config, fetchedDomains: [] });
  assert.equal(r.ok, true);
});
test('4 追加: 双方向制御文字 \u202E の新出は不合格（A の書き戻しが範囲全体を守っている証拠）', () => {
  assert.ok(checks(run(`${GOOD}\n見た目を偽装\u202Eする\n`)).includes(4));
});
