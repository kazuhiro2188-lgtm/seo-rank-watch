#!/usr/bin/env node
// 日次「測る」。書くのは data/seo/rank-history.jsonl だけ（単一ライター）。
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { resolveWindow, daysBetween } from './lib/dates.mjs';
import { readHistory, findSnapshot, latestSnapshot, appendSnapshot } from './lib/history.mjs';
import { aggregate, allNull } from './lib/aggregate.mjs';
import { loadRows, ConfigError } from './lib/gsc.mjs';

export function parseArgs(argv) {
  const out = { source: 'gsc', windows: [7, 28], warningsOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--today') out.today = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--windows') out.windows = argv[++i].split(',').map(Number);
    else if (a === '--warnings-out') out.warningsOut = argv[++i];
  }
  return out;
}

function latestReportAge(repoDir, today) {
  const dir = join(repoDir, 'data/seo/reports');
  if (!existsSync(dir)) return null;
  const days = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => f.slice(0, 10)).sort();
  return days.length ? daysBetween(days.at(-1), today) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo || !/^\d{4}-\d{2}-\d{2}$/.test(args.today ?? '')) {
    console.error('使い方: fetch_ranks.mjs --repo <dir> --today YYYY-MM-DD [--source gsc|fixture] [--windows 7,28] [--warnings-out <path>]');
    process.exit(2);
  }
  const config = loadConfig(args.repo);
  const watch = JSON.parse(readFileSync(join(args.repo, 'data/seo/watchwords.json'), 'utf8'));
  const historyPath = join(args.repo, 'data/seo/rank-history.jsonl');
  const warnings = [];

  for (const days of args.windows) {
    const window = resolveWindow(days, args.today);
    const history = readHistory(historyPath);
    if (findSnapshot(history, days, window.endDate)) { console.log(`${days} 日窓（終端 ${window.endDate}）は記録済み。何もしない`); continue; }
    const { rows, truncated } = await loadRows({ source: args.source, repoDir: args.repo, config, window, env: process.env });
    if (truncated) warnings.push(`取得が上限 ${rows.length} 件に達した（一部欠けている可能性）`);
    const { ranks, pageQueries } = aggregate({ rows, watchwords: watch.keywords ?? [] });
    if (allNull(ranks)) {
      const prev = latestSnapshot(history, days);
      const prevValid = prev && !allNull(prev.ranks);
      if (prevValid) {
        console.error(`測定失敗: ${days} 日窓で全語 null（前回 ${prev.window.endDate} は有効だった）。プロパティ名・権限・所有権確認を疑う。追記しない`);
        process.exit(1);
      }
      console.log(`⚠ ${days} 日窓は全語 null（前回の有効な記録も無い。新規サイトなら正常）`);
    }
    const { appended, total } = appendSnapshot(historyPath, { fetchedAt: new Date().toISOString(), window, ranks, pageQueries });
    console.log(`${days} 日窓 ${window.startDate}〜${window.endDate}: ${appended ? `追記（通算 ${total} 件）` : '記録済み'}`);
    for (const r of [...ranks].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))) {
      console.log(`  ${String(r.rank ?? '—').padStart(6)} 位  表示 ${String(r.impressions).padStart(6)}  ${r.pageMatches ? '' : '[別ページ] '}${r.otherPages.length ? '[カニバリ] ' : ''}${r.keyword}`);
    }
  }

  const age = latestReportAge(args.repo, args.today);
  if (age !== null && age > 10) warnings.push(`最新の週次報告が ${age} 日前（週次が止まっている可能性）`);
  // 報告が 1 本も無いと age は null になり、上の見張りは永久に鳴らない。
  // ワークフローのコピー漏れ・週次の初回失敗が続いても日次だけ緑で回り続けるので、ここで拾う。
  if (age === null) {
    const daily = readHistory(historyPath).filter((s) => s.window.days === 7).length;
    if (daily >= 10) warnings.push(`週次が一度も実行されていない（日次は ${daily} 回記録済み）`);
  }
  if (args.warningsOut) writeFileSync(args.warningsOut, warnings.map((w) => `⚠️ ${w}`).join('\n') + (warnings.length ? '\n' : ''));
  for (const w of warnings) console.log(`⚠ ${w}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof ConfigError ? 2 : 1);
});
