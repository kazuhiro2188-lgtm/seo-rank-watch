#!/usr/bin/env node
// 書く段。improvement-log と記事ファイルを書き換える唯一の場所。git add / commit はワークフローが行う。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { readLog, writeLog } from './lib/log.mjs';
import { applyVerdicts, recordChange, recordBlocked, recordSha, markPublished, markUnpublished, markRevertFailed, setUpdatedAt } from './lib/apply.mjs';

const [sub, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!sub || !args.repo || !args.today) { console.error('使い方: apply.mjs <verdicts|change|record-sha|published|unpublished> --repo <dir> --today YYYY-MM-DD ...'); process.exit(2); }

const config = loadConfig(args.repo);
const logPath = join(args.repo, 'data/seo/improvement-log.json');
const log = readLog(logPath);
const add = new Set(['data/seo/improvement-log.json']);
const git = (...a) => execFileSync('git', a, { cwd: args.repo, stdio: 'pipe' }).toString();

if (sub === 'verdicts') {
  const verdicts = JSON.parse(readFileSync(args.verdicts, 'utf8'));
  const { reverts } = applyVerdicts(log, verdicts, args.today);
  let aborted = false; // --abort に失敗して作業ツリーが戻せない
  for (const r of reverts) {
    if (aborted) {
      markRevertFailed(log, r.file, '先行する revert の中断に失敗したため、この revert は実行していない');
      console.error(`revert 未実行: ${r.file}（作業ツリーが戻せないため打ち切り）`);
      continue;
    }
    try {
      git('revert', '--no-edit', r.sha);
      console.log(`revert: ${r.file} ← ${r.sha}`);
    } catch (e) {
      const reason = e.message.split('\n')[0];
      try { git('revert', '--abort'); }
      catch { aborted = true; }
      markRevertFailed(log, r.file, reason);
      console.error(`revert 失敗: ${r.file}（parked にした）`);
    }
  }
  console.log(`判定 ${verdicts.length} 件を反映（revert ${reverts.length} 件）`);
} else if (sub === 'change') {
  const outcome = JSON.parse(readFileSync(args.outcome, 'utf8'));
  const buildResult = args['build-result'] ?? 'success';
  // コントローラからの追加指示: 検査の前提（config・candidate.json・対象ファイル）を読めなかった場合、
  // outcome.candidate は null になる。どのファイルの話か分からないので improvement-log.json には書かない。
  if (outcome.status === 'blocked' && !outcome.candidate) {
    console.log('検査の前提を読めなかったため記録をスキップした（improvement-log.json は書かない）');
    process.exit(0);
  }
  if (outcome.status === 'pass' && buildResult === 'success') {
    const revised = readFileSync(join(args['out-dir'], 'article.md'), 'utf8');
    writeFileSync(join(args.repo, outcome.candidate.file), setUpdatedAt(revised, config.frontmatter.updatedAtField ?? 'updatedAt', args.today));
    recordChange(log, { candidate: outcome.candidate, pendingAction: outcome.pendingAction, today: args.today });
    add.add(outcome.candidate.file);
    console.log(`書き戻し: ${outcome.candidate.file}`);
  } else if (outcome.status === 'pass') {
    recordBlocked(log, { candidate: outcome.candidate, failures: [{ check: 'build', detail: `ビルド段が ${buildResult}` }], today: args.today });
    console.log('ビルド失敗のため blocked を記録');
  } else if (outcome.status === 'blocked') {
    recordBlocked(log, { candidate: outcome.candidate, failures: outcome.failures, today: args.today });
    console.log(`blocked を記録（${outcome.failures.length} 件）`);
  } else {
    console.log('候補なし。記録なし');
  }
} else if (sub === 'record-sha') { recordSha(log, args.file, args.sha); }
else if (sub === 'published') { markPublished(log, args.file, args.today); console.log(`公開確認日 ${args.today} → 判定日 ${log.entries.find((e) => e.file === args.file)?.nextReviewDate}`); }
else if (sub === 'unpublished') { markUnpublished(log, args.file, args.today); }
else { console.error(`不明なサブコマンド: ${sub}`); process.exit(2); }

writeLog(logPath, log);
console.log(`ADD: ${[...add].join(' ')}`);
