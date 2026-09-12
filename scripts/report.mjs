#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { readHistory } from './lib/history.mjs';
import { readLog } from './lib/log.mjs';
import { buildReport } from './lib/report.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
if (!args.repo || !args.today || !args['slack-out']) { console.error('使い方: report.mjs --repo <dir> --today YYYY-MM-DD --slack-out <path> [--verdicts p] [--outcome p] [--report-only p] [--warnings p] [--repo-url u]'); process.exit(2); }
const readJson = (p, fallback) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

const dir = join(args.repo, 'data/seo/reports');
mkdirSync(dir, { recursive: true });
const reportCount = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) !== args.today).length + 1;
const r = buildReport({
  today: args.today, config: loadConfig(args.repo),
  snapshots: readHistory(join(args.repo, 'data/seo/rank-history.jsonl')),
  log: readLog(join(args.repo, 'data/seo/improvement-log.json')),
  verdicts: readJson(args.verdicts, []), outcome: readJson(args.outcome, { status: 'no-candidate' }), reportOnly: readJson(args['report-only'], []),
  warnings: args.warnings && existsSync(args.warnings) ? readFileSync(args.warnings, 'utf8').split('\n').filter(Boolean) : [],
  repoUrl: args['repo-url'] ?? '', reportCount,
});
writeFileSync(join(dir, `${args.today}.md`), r.markdown);
writeFileSync(args['slack-out'], `${r.slackText}\n`);
console.log(r.headerLines.join('\n'));
