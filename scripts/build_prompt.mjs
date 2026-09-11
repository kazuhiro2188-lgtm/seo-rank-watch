#!/usr/bin/env node
// 雛形＋データ差し込みで実行用プロンプトを作る。AI に SKILL.md 全体は渡さない。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { readHistory, latestSnapshot } from './lib/history.mjs';
import { renderTemplate, internalLinkCandidates, formatPageQueries } from './lib/prompt.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
if (!args.repo || !args.candidate || !args.out || !args['out-dir']) { console.error('使い方: build_prompt.mjs --repo <dir> --candidate <candidate.json> --out <prompt.md> --out-dir <dir>'); process.exit(2); }

const config = loadConfig(args.repo);
const c = JSON.parse(readFileSync(args.candidate, 'utf8'));
if (!c) { console.error('候補が null。build_prompt は呼ばれないはず'); process.exit(1); }
const latest = latestSnapshot(readHistory(join(args.repo, 'data/seo/rank-history.jsonl')), 7);
const tpl = readFileSync(new URL('../prompts/improve.md', import.meta.url), 'utf8');
const links = internalLinkCandidates(args.repo, config, c.file);
const prompt = renderTemplate(tpl, {
  keyword: c.keyword, targetPath: c.targetPath, rank: c.rank, impressions: c.impressions,
  baseDomain: new URL(config.baseUrl).hostname,
  previousDone: c.previousDone.length ? c.previousDone.map((d) => `  - ${d}`).join('\n') : '  （なし）',
  avoidEditType: c.avoidEditType ?? 'なし',
  pageQueries: formatPageQueries(latest?.pageQueries?.[c.targetPath] ?? []),
  internalLinks: links.length ? links.map((l) => `- \`${l.path}\` — ${l.title}`).join('\n') : '（対象以外の公開記事はまだありません。内部リンクは張らない）',
  editableFrontmatter: config.frontmatter.editable.join(' / '),
  outDir: args['out-dir'],
  article: readFileSync(join(args.repo, c.file), 'utf8'),
});
writeFileSync(args.out, prompt);
console.log(`プロンプト ${prompt.length} 文字 → ${args.out}`);
