#!/usr/bin/env node
// 公開確認。差分の目印の一文が本番（git-push）またはビルド出力（static-dir）に現れるまで待つ。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveFile } from './lib/config.mjs';
import { fingerprintFromDiff, htmlContains, sleep } from './lib/publish.mjs';
import { normalizePath } from './lib/normalize.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
for (const k of ['repo', 'today', 'file', 'original', 'revised']) if (!args[k]) { console.error(`--${k} が必要`); process.exit(2); }

const config = loadConfig(args.repo);
const original = readFileSync(args.original, 'utf8'), revised = readFileSync(args.revised, 'utf8');
const fingerprint = fingerprintFromDiff(original, revised, 20) ?? fingerprintFromDiff(original, revised, 8);
if (!fingerprint) { console.error('公開確認に使える目印の一文が差分に無い（8 字以上の追加行なし）'); process.exit(1); }

// file → path（pathToFile の逆写像）
const [pre, post] = config.pathToFile.split('{path}');
const path = normalizePath(args.file.slice(pre.length, args.file.length - post.length));
if (resolveFile(config, path) !== args.file) { console.error(`ファイル ${args.file} をパスに戻せない`); process.exit(1); }

const D = config.deploy;
const deadline = Date.now() + (D.timeoutMinutes ?? 15) * 60000;
const interval = (D.intervalSeconds ?? 30) * 1000;
async function fetchOnce() {
  if (D.type === 'static-dir') {
    const p = join(args.repo, D.verifyFileTemplate.replace('{path}', path));
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  const url = D.verifyUrlTemplate.replace('{path}', path);
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } }).catch(() => null);
  return res?.ok ? res.text() : null;
}
for (let attempt = 1; ; attempt++) {
  const html = await fetchOnce();
  if (html && htmlContains(html, fingerprint)) { console.log(`公開を確認（${attempt} 回目・目印: ${fingerprint}）`); process.exit(0); }
  if (Date.now() >= deadline) { console.error(`公開を確認できなかった（目印: ${fingerprint}）`); process.exit(1); }
  await sleep(interval);
}
