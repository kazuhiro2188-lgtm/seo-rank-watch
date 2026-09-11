import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = new URL('../fixtures/site/', import.meta.url).pathname;

function copySite() {
  const dir = mkdtempSync(join(tmpdir(), 'srw-fixture-'));
  cpSync(SITE, dir, { recursive: true });
  return dir;
}
function buildIn(dir) {
  execFileSync(process.execPath, ['build.mjs'], { cwd: dir, stdio: 'pipe' });
}

test('build.mjs は公開記事を out/<slug>.html に出し、下書きは出さない', () => {
  const dir = copySite();
  buildIn(dir);
  assert.ok(existsSync(join(dir, 'out/first-run.html')));
  assert.ok(existsSync(join(dir, 'out/second-topic.html')));
  assert.ok(!existsSync(join(dir, 'out/third-note.html')), '下書きは出力しない');
  const html = readFileSync(join(dir, 'out/first-run.html'), 'utf8');
  assert.match(html, /<title>最初の実行記録/);
  assert.match(html, /<meta name="description" content="/);
  assert.match(html, /この記事は試験用の合成データです/);
  rmSync(dir, { recursive: true, force: true });
});

test('build.mjs は本文の生 HTML をエスケープする（生 HTML 無効の実証）', () => {
  const dir = copySite();
  const p = join(dir, 'content/articles/first-run.md');
  writeFileSync(p, `${readFileSync(p, 'utf8')}\n<script>alert(1)</script>\n`);
  buildIn(dir);
  const html = readFileSync(join(dir, 'out/first-run.html'), 'utf8');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  rmSync(dir, { recursive: true, force: true });
});
