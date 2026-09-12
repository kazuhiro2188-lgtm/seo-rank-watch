#!/usr/bin/env node
// 導入検査。設定・監視語・.gitignore・（--with-build で）生 HTML の無効化とビルド出力を確かめる。
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, resolveFile } from './lib/config.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--with-build') args.withBuild = true; else if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i]; }
if (!args.repo) { console.error('使い方: check_setup.mjs --repo <dir> [--with-build]'); process.exit(2); }

let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`⚠ ${m}`);
const ng = (m) => { console.log(`✗ ${m}`); failed++; };

// ディレクトリを再帰的に列挙する。node_modules と .git は掘らない（outputDir が広く設定された事故対策）。
function walkFiles(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = join(dir, f);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walkFiles(p)); else out.push(p);
  }
  return out;
}

let config;
try { config = loadConfig(args.repo); ok('seo.config.json を読めた'); } catch (e) { ng(`seo.config.json: ${e.message}`); process.exit(1); }

const wwPath = join(args.repo, 'data/seo/watchwords.json');
if (!existsSync(wwPath)) ng('data/seo/watchwords.json が無い');
else {
  const ww = JSON.parse(readFileSync(wwPath, 'utf8')).keywords ?? [];
  if (!ww.length) ng('監視語が 0 件');
  for (const w of ww) {
    const f = resolveFile(config, w.targetPath);
    if (!f) warn(`${w.keyword}: 対象パス ${w.targetPath} はファイルに対応しない（報告のみになる）`);
    else if (!existsSync(join(args.repo, f))) ng(`${w.keyword}: ${f} が無い`);
    else ok(`${w.keyword} → ${f}`);
  }
}

const gi = existsSync(join(args.repo, '.gitignore')) ? readFileSync(join(args.repo, '.gitignore'), 'utf8') : '';
if (/^\.env(\b|\*|\.)/m.test(gi)) ok('.gitignore に .env がある'); else ng('.gitignore に .env が無い（鍵のコミット事故の経路）');

for (const k of ['oauthIssuedOn', 'gscKeyIssuedOn']) if (config.keys[k]) ok(`keys.${k} = ${config.keys[k]}`); else warn(`keys.${k} が未記入（報告で鍵の経過日数が出ない）`);

if (args.withBuild) {
  const probe = join(args.repo, config.contentDir, 'zz-srw-probe.md');
  // 絶対パスの outputDir も素直に扱えるよう resolve で解く（join だとリポジトリ直下に継ぎ足されてしまう）。
  const outDir = resolve(args.repo, config.build.outputDir ?? 'out');
  writeFileSync(probe, `---\ntitle: "probe"\ndescription: "probe"\nkeyword: "probe"\npublishedAt: "2026-01-01"\ndraft: false\nfaqs: []\n---\n\n<script>alert("srw-probe")</script>\n`);
  try {
    execSync(config.build.command, { cwd: args.repo, env: { ...process.env, ...(config.build.env ?? {}) }, stdio: 'pipe' });
    const files = walkFiles(outDir);
    const raw = files.some((p) => /\.html?$/.test(p) && readFileSync(p, 'utf8').includes('<script>alert("srw-probe")</script>'));
    if (raw) ng('生 HTML がそのまま出力される（サイト側で無効化が必要）'); else ok('生 HTML はエスケープされる');
    if (existsSync(join(outDir, 'data/seo')) || files.some((p) => p.includes('rank-history'))) ng('ビルド出力に data/seo が含まれる'); else ok('ビルド出力に data/seo は含まれない');
  } catch (e) { ng(`ビルド失敗: ${String(e.message).split('\n')[0]}`); }
  finally {
    // 探り針そのものの削除。ここで例外が出ると以降の後始末も総括も飛ぶので、単独で保護する。
    try { rmSync(probe, { force: true }); } catch (e) { warn(`探り針 ${probe} を削除できなかった。手で消すこと: ${e.message}`); }
    // 探り針（zz-srw-probe）由来のビルド出力も後始末する。ファイル名の対応規則はサイトごとに違うため、
    // 中身に「srw-probe」を含むかどうかで判定する。ここで例外を投げると検査全体が落ちるため、丸ごと保護する。
    // ただし outputDir がリポジトリ直下を指していると、この走査は「ビルド出力」ではなくリポジトリ全体を
    // 掘り、srw-probe の語を含むファイル（このスクリプト自身を含む）を消してしまう。その場合は何もしない。
    if (outDir === resolve(args.repo)) warn('build.outputDir がリポジトリ直下を指しているため、ビルド出力の後始末を行わない');
    else try {
      if (existsSync(outDir)) {
        const leftover = walkFiles(outDir).filter((p) => {
          try { return readFileSync(p, 'utf8').includes('srw-probe'); } catch { return false; }
        });
        for (const p of leftover) { try { rmSync(p, { force: true }); } catch { /* 個別の削除失敗は無視して続行 */ } }
        if (leftover.length) ok(`探り針の後始末: ビルド出力 ${leftover.length} 件を削除`);
      }
    } catch { /* 後始末の失敗で検査全体を落とさない */ }
  }
}

console.log(failed ? `\n不合格 ${failed} 件` : '\n導入検査: 合格');
process.exit(failed ? 1 : 0);
