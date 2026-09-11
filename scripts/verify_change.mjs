#!/usr/bin/env node
// 変更検査。終了コードは常に 0。結果は outcome.json の status（pass / blocked）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { verifyChange } from './lib/checks.mjs';
import { extractFetchedDomains } from './lib/runlog.mjs';
import { lineDiff } from './lib/diff.mjs';
import { fingerprintFromDiff } from './lib/publish.mjs';

const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
for (const k of ['repo', 'candidate', 'out-dir', 'run-log', 'outcome']) if (!args[k]) { console.error(`--${k} が必要`); process.exit(2); }

let config, candidate, original;
try {
  config = loadConfig(args.repo);
  candidate = JSON.parse(readFileSync(args.candidate, 'utf8'));
  original = readFileSync(join(args.repo, candidate.file), 'utf8');
} catch (err) {
  const outcome = {
    status: 'blocked',
    failures: [{ check: 0, detail: `検査の前提を読めなかった: ${err.message}` }],
    candidate: null, pendingAction: null, diff: null, fingerprint: null,
  };
  writeFileSync(args.outcome, `${JSON.stringify(outcome, null, 2)}\n`);
  console.log(`不合格 1 件:\n  [0] ${outcome.failures[0].detail}`);
  process.exit(0);
}
const failures = [];
const articlePath = join(args['out-dir'], 'article.md');
const paPath = join(args['out-dir'], 'pending-action.json');
const revised = existsSync(articlePath) ? readFileSync(articlePath, 'utf8') : null;
if (revised === null) failures.push({ check: 1, detail: 'AI が article.md を出力しなかった' });
let pendingAction = null;
try { pendingAction = existsSync(paPath) ? JSON.parse(readFileSync(paPath, 'utf8')) : null; } catch (e) { failures.push({ check: 8, detail: `pending-action.json が読めない: ${e.message}` }); }
if (pendingAction === null && !failures.some((f) => f.check === 8)) failures.push({ check: 8, detail: 'AI が pending-action.json を出力しなかった' });

let result = { ok: false, failures };
if (revised !== null && failures.length === 0) {
  const fetchedDomains = existsSync(args['run-log']) ? extractFetchedDomains(readFileSync(args['run-log'], 'utf8')) : [];
  result = verifyChange({ original, revised, pendingAction, candidate, config, fetchedDomains });
}
const outcome = {
  status: result.ok ? 'pass' : 'blocked',
  failures: result.failures,
  candidate, pendingAction,
  diff: revised === null ? null : lineDiff(original, revised),
  fingerprint: result.ok ? fingerprintFromDiff(original, revised) : null,
};
writeFileSync(args.outcome, `${JSON.stringify(outcome, null, 2)}\n`);
console.log(outcome.status === 'pass' ? `合格（目印: ${outcome.fingerprint ?? '無し'}）` : `不合格 ${outcome.failures.length} 件:\n${outcome.failures.map((f) => `  [${f.check}] ${f.detail}`).join('\n')}`);
