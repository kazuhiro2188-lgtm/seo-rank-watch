#!/usr/bin/env node
// 7 日レビューの判定を計算するだけ。ログには書かない（書くのは apply.mjs）。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { readHistory } from './lib/history.mjs';
import { readLog } from './lib/log.mjs';
import { computeVerdicts } from './lib/verdict.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
if (!args.repo || !args.today || !args.out) { console.error('使い方: review.mjs --repo <dir> --today YYYY-MM-DD --out <verdicts.json>'); process.exit(2); }

const config = loadConfig(args.repo);
const verdicts = computeVerdicts({
  log: readLog(join(args.repo, 'data/seo/improvement-log.json')),
  snapshots: readHistory(join(args.repo, 'data/seo/rank-history.jsonl')),
  limits: config.limits, today: args.today,
});
writeFileSync(args.out, `${JSON.stringify(verdicts, null, 2)}\n`);
for (const v of verdicts) console.log(`${v.verdict.padEnd(14)} ${v.status.padEnd(10)} ${v.keyword ?? ''}  ${v.note ?? ''}`);
if (!verdicts.length) console.log('判定対象なし');
