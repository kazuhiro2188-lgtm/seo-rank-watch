import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, resolveFile, DEFAULT_LIMITS, loadConfig } from '../scripts/lib/config.mjs';

const base = {
  site: 'sc-domain:x.invalid', baseUrl: 'https://x.invalid', contentDir: 'content/articles',
  pathToFile: 'content/articles/{path}.md', contentFormat: 'markdown-plain',
  frontmatter: { editable: ['title'] }, build: { command: 'true' }, deploy: { type: 'git-push' },
};

test('validateConfig は既定値を埋める', () => {
  const c = validateConfig(base);
  assert.equal(c.limits.minImpressions, DEFAULT_LIMITS.minImpressions);
  assert.equal(c.language, 'ja');
  assert.deepEqual(c.linkAllowlist, []);
  assert.equal(c.keys.warnAfterDays, 75);
});
test('validateConfig は上書きを尊重する', () => {
  assert.equal(validateConfig({ ...base, limits: { minImpressions: 5 } }).limits.minImpressions, 5);
});
test('validateConfig は必須欠落・未対応形式・{path} 無しを例外で落とす', () => {
  assert.throws(() => validateConfig({ ...base, site: undefined }), /必須項目/);
  assert.throws(() => validateConfig({ ...base, contentFormat: 'mdx' }), /markdown-plain/);
  assert.throws(() => validateConfig({ ...base, pathToFile: 'content/x.md' }), /\{path\}/);
  assert.throws(() => validateConfig({ ...base, deploy: { type: 'ftp' } }), /deploy\.type/);
});
test('validateConfig は build.outputDir が空文字・.・.. を含む場合を例外で落とす（後始末の範囲になるため）', () => {
  for (const outputDir of ['', '   ', '.', './', '..', 'out/..', '../out']) {
    assert.throws(() => validateConfig({ ...base, build: { command: 'true', outputDir } }), /ビルド専用のディレクトリ/, `outputDir: ${JSON.stringify(outputDir)} が通ってしまう`);
  }
  // 普通のビルド出力と、未指定（既定 out）は通る
  assert.equal(validateConfig({ ...base, build: { command: 'true', outputDir: 'out' } }).build.outputDir, 'out');
  assert.equal(validateConfig({ ...base, build: { command: 'true', outputDir: './dist' } }).build.outputDir, './dist');
  assert.equal(validateConfig({ ...base, build: { command: 'true' } }).build.outputDir, undefined);
});
test('resolveFile はパスをファイルに写す。トップと .. は null', () => {
  const c = validateConfig(base);
  assert.equal(resolveFile(c, '/claude-code-subagent'), 'content/articles/claude-code-subagent.md');
  assert.equal(resolveFile(c, 'https://x.invalid/a/b/'), 'content/articles/a/b.md');
  assert.equal(resolveFile(c, '/'), null);
  assert.equal(resolveFile(c, '/../etc/passwd'), null);
});
test('loadConfig は試験用サイトの設定を読める', () => {
  const c = loadConfig(new URL('../fixtures/site', import.meta.url).pathname);
  assert.equal(c.deploy.type, 'static-dir');
});
