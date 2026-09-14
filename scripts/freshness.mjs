#!/usr/bin/env node
// 古いデータで直さない。最新 7 日窓の終端が期待（today−3）より max-lag-days 以上古ければ赤。
import { join } from 'node:path';
import { readHistory, latestSnapshot } from './lib/history.mjs';
import { addDays, daysBetween } from './lib/dates.mjs';

const args = { 'max-lag-days': '3' }; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
if (!args.repo || !args.today) { console.error('使い方: freshness.mjs --repo <dir> --today YYYY-MM-DD [--max-lag-days 3]'); process.exit(2); }

const latest = latestSnapshot(readHistory(join(args.repo, 'data/seo/rank-history.jsonl')), 7);
if (!latest) { console.error('7 日窓の記録が無い。日次「測る」が一度も成功していない'); process.exit(1); }
const expected = addDays(args.today, -3);
const lag = daysBetween(latest.window.endDate, expected);
if (lag >= Number(args['max-lag-days'])) { console.error(`最新の記録（終端 ${latest.window.endDate}）が ${lag} 日古い。日次が止まっている。古いデータでは直さない`); process.exit(1); }
console.log(`鮮度 OK（終端 ${latest.window.endDate}・遅れ ${lag} 日）`);
