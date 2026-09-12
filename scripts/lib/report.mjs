import { addDays, daysBetween } from './dates.mjs';
import { findSnapshot, latestSnapshot, rankFor } from './history.mjs';

export function streakDays(snapshots, today) {
  let n = 0;
  for (let d = addDays(today, -3); findSnapshot(snapshots, 7, d); d = addDays(d, -1)) n++;
  return n;
}

export function keyAgeDays(issuedOn, today) { return issuedOn ? daysBetween(issuedOn, today) : null; }

function keyLabel(name, issuedOn, today, config) {
  const age = keyAgeDays(issuedOn, today);
  if (age === null) return `${name} 発行日未記入`;
  const warn = age >= (config.keys.reissueAfterDays ?? 90) ? ' ❌要再発行' : age >= (config.keys.warnAfterDays ?? 75) ? ' ⚠️' : '';
  return `${name} ${age} 日${warn}`;
}

function bigMoves(snapshots, today) {
  const cur = latestSnapshot(snapshots, 7);
  if (!cur) return [];
  const prev = findSnapshot(snapshots, 7, addDays(cur.window.endDate, -7));
  if (!prev) return [];
  return cur.ranks.flatMap((r) => {
    const p = rankFor(prev, r.keyword);
    if (r.rank === null || p?.rank == null) return [];
    const delta = Number((p.rank - r.rank).toFixed(1));
    return Math.abs(delta) >= 3 ? [`- ${r.keyword}: ${p.rank} → ${r.rank} 位（${delta > 0 ? '+' : ''}${delta}）`] : [];
  });
}

export function buildReport({ today, config, snapshots, log, verdicts, reportOnly, outcome, warnings, repoUrl, reportCount }) {
  const lastPublished = log.entries.map((e) => e.publishedVerifiedAt).filter(Boolean).sort().at(-1) ?? '未確認';
  const l1 = `連続実行: 日次 ${streakDays(snapshots, today)} 日 / 週次 ${reportCount} 回 | 最終公開確認: ${lastPublished} | 鍵: ${keyLabel('OAuth', config.keys.oauthIssuedOn, today, config)}・${keyLabel('GSC', config.keys.gscKeyIssuedOn, today, config)}`;

  const o = outcome ?? { status: 'no-candidate' };
  const week = o.status === 'pass' ? `pass（${o.candidate.file}・${o.pendingAction.editType}）`
    : o.status === 'blocked' ? `blocked（${o.candidate?.file ?? '?'}・${o.failures?.length ?? 0} 件）`
    : '候補なし（AI は起動していない）';
  const counts = {}; for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  const vs = verdicts.length ? `判定 ${verdicts.length} 件（${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join('・')}）` : '判定 0 件';
  const l2 = `今週: ${week}| ${vs}| 報告のみ ${reportOnly.length} 件`;

  const questions = [...(o.pendingAction?.needsAuthor ?? [])];
  const l3 = questions.length ? `質問: ${questions.length} 件（末尾）` : '質問なし';
  const headerLines = [l1, l2, l3];

  const sec = (title, lines) => `## ${title}\n\n${lines.length ? lines.join('\n') : '（なし）'}\n`;
  const moves = bigMoves(snapshots, today);
  const body = [
    `# 週次報告 ${today}`, '', ...headerLines, '', '---', '',
    ...(warnings.length ? [sec('警告', warnings.map((w) => `- ${w}`))] : []),
    sec('大きく動いた語（7 日前比 3 位以上）', moves),
    sec('今回の判定', verdicts.map((v) => `- ${v.keyword ?? v.file}: **${v.verdict}** → ${v.status}${v.before && v.after ? `（${v.before.rank} → ${v.after.rank} 位・表示 ${v.before.impressions} → ${v.after.impressions}）` : ''}${v.revertSha ? ` revert ${v.revertSha}` : ''}${v.note ? ` ${v.note}` : ''}`)),
    sec('選んだ語と理由', o.candidate ? [`- ${o.candidate.keyword}（${o.candidate.rank} 位・tier ${o.candidate.tier ?? '-'}）→ ${o.candidate.file}`] : []),
    sec('検索ニーズ（AI の定義）', o.pendingAction?.needs ? [o.pendingAction.needs] : []),
    sec('行った改善', o.status === 'pass' ? [o.pendingAction.done, '', '```diff', ...(o.diff?.removed ?? []).map((l) => `- ${l}`), ...(o.diff?.added ?? []).map((l) => `+ ${l}`), '```'] : o.status === 'blocked' ? ['不合格のため書き戻していない:', ...(o.failures ?? []).map((f) => `- [${f.check}] ${f.detail}`), '', '```diff', ...(o.diff?.removed ?? []).map((l) => `- ${l}`), ...(o.diff?.added ?? []).map((l) => `+ ${l}`), '```'] : []),
    sec('提案（機械は適用しない）', (o.pendingAction?.proposals ?? []).map((p) => `- ${p}`)),
    sec('観察中', log.entries.filter((e) => e.status === 'observing').map((e) => `- ${e.file}: 公開確認 ${e.publishedVerifiedAt ?? '未'} → 判定 ${e.nextReviewDate ?? '未定'}`)),
    sec('保留・要対応', log.entries.filter((e) => ['parked', 'unpublished'].includes(e.status)).map((e) => `- ${e.file}: ${e.status}${e.note ? `（${e.note}）` : ''}`)),
    sec('報告のみ（編集しない語）', reportOnly.map((x) => `- ${x.keyword}: ${x.reason}${x.page ? ` → ${x.page}` : ''}${x.pages ? ` → ${x.pages.join(', ')}` : ''}`)),
    sec('オーナーへの質問（答えた分だけ次回の材料になる）', questions.map((q) => `- ${q}`)),
  ].join('\n');

  const slackText = `${headerLines.join('\n')}\n${repoUrl}/blob/main/data/seo/reports/${today}.md`;
  return { headerLines, markdown: body, slackText };
}
