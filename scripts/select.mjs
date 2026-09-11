#!/usr/bin/env node
// 今週の候補を 1 つ決める。最新の 7 日窓（鮮度は呼び出し側＝ワークフローが確認済み）を使う。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { readHistory, latestSnapshot } from './lib/history.mjs';
import { readLog } from './lib/log.mjs';
import { selectCandidate } from './lib/select.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
if (!args.repo || !args.today || !args.out) { console.error('使い方: select.mjs --repo <dir> --today YYYY-MM-DD --out <candidate.json> [--report-only-out <path>]'); process.exit(2); }

const config = loadConfig(args.repo);
const latest = latestSnapshot(readHistory(join(args.repo, 'data/seo/rank-history.jsonl')), 7);
if (!latest) { console.error('7 日窓の記録が 1 件も無い。日次「測る」を先に回す'); process.exit(1); }
const { candidate, reportOnly } = selectCandidate({ ranks: latest.ranks, log: readLog(join(args.repo, 'data/seo/improvement-log.json')), config, repoDir: args.repo, today: args.today });
writeFileSync(args.out, `${JSON.stringify(candidate, null, 2)}\n`);
if (args['report-only-out']) writeFileSync(args['report-only-out'], `${JSON.stringify(reportOnly, null, 2)}\n`);
console.log(candidate ? `候補: ${candidate.keyword}（${candidate.rank} 位・表示 ${candidate.impressions}・tier ${candidate.tier}）→ ${candidate.file}` : '候補なし（AI は起動しない）');
for (const x of reportOnly) console.log(`  報告のみ: ${x.reason.padEnd(18)} ${x.keyword}`);
