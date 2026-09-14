import { addDays, daysBetween } from './dates.mjs';
import { findSnapshot, latestSnapshot, rankFor } from './history.mjs';
import { SECRET_PATTERNS } from './checks.mjs';

/**
 * 秘密文字列らしき箇所を伏せる。週次報告は公開リポジトリにコミット・push されるため、
 * 差分全文と AI の自由記述をそのまま載せない（「検出したので書き戻さなかった」秘密が
 * 報告経由で公開される経路を塞ぐ）。定義は検査（checks.mjs）と共有する。
 * 一致を含む「空白で区切られた塊」ごと伏せる。先頭の一致だけ伏せても本体が残るため。
 */
export function maskSecrets(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\S+/g, (tok) => (SECRET_PATTERNS.some((re) => re.test(tok)) ? '***' : tok));
}

/**
 * 連続実行の日数。**最新の 7 日窓の終端から**遡って数える。
 * today−3 から数え始めると、日次（毎日 21:00 UTC）と週次（日曜 21:00 UTC）が同じ分に発火し
 * 週次が先に走った週に、正常でも 0 と出てしまう（人が見る唯一の 3 行の 1 行目が狼少年になる）。
 * 「どこまで進んでいるか」は下の streakLagDays で別に出す。
 */
export function streakDays(snapshots) {
  const end = latestSnapshot(snapshots, 7)?.window.endDate ?? null;
  if (!end) return 0;
  let n = 0;
  for (let d = end; findSnapshot(snapshots, 7, d); d = addDays(d, -1)) n++;
  return n;
}

/** 最新の 7 日窓が today−3（GSC の遅れを引いた当日ぶん）より何日古いか。追いついていれば 0。 */
export function streakLagDays(snapshots, today) {
  const end = latestSnapshot(snapshots, 7)?.window.endDate ?? null;
  if (!end) return 0;
  return Math.max(0, daysBetween(end, addDays(today, -3)));
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
  const lag = streakLagDays(snapshots, today);
  const l1 = `連続実行: 日次 ${streakDays(snapshots)} 日${lag ? `（遅れ ${lag} 日）` : ' '}/ 週次 ${reportCount} 回 | 最終公開確認: ${lastPublished} | 鍵: ${keyLabel('OAuth', config.keys.oauthIssuedOn, today, config)}・${keyLabel('GSC', config.keys.gscKeyIssuedOn, today, config)}`;

  const o = outcome ?? { status: 'no-candidate' };
  const week = o.status === 'pass' ? `pass（${o.candidate.file}・${o.pendingAction.editType}）`
    : o.status === 'blocked' ? `blocked（${o.candidate?.file ?? '?'}・${o.failures?.length ?? 0} 件）`
    : '候補なし（AI は起動していない）';
  const counts = {}; for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  const vs = verdicts.length ? `判定 ${verdicts.length} 件（${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join('・')}）` : '判定 0 件';
  const l2 = `今週: ${week}| ${vs}| 報告のみ ${reportOnly.length} 件`;

  const questions = [...(o.pendingAction?.needsAuthor ?? [])].map((q) => maskSecrets(q));
  const l3 = questions.length ? `質問: ${questions.length} 件（末尾）` : '質問なし';
  const headerLines = [l1, l2, l3];

  const sec = (title, lines) => `## ${title}\n\n${lines.length ? lines.join('\n') : '（なし）'}\n`;
  // 差分は blocked の週も全文を載せる（人が判断する材料）。載せる前に秘密文字列を伏せる。
  const diffBlock = (d) => ['```diff', ...(d?.removed ?? []).map((l) => `- ${maskSecrets(l)}`), ...(d?.added ?? []).map((l) => `+ ${maskSecrets(l)}`), '```'];
  const moves = bigMoves(snapshots, today);
  const body = [
    `# 週次報告 ${today}`, '', ...headerLines, '', '---', '',
    ...(warnings.length ? [sec('警告', warnings.map((w) => `- ${w}`))] : []),
    sec('大きく動いた語（7 日前比 3 位以上）', moves),
    sec('今回の判定', verdicts.map((v) => `- ${v.keyword ?? v.file}: **${v.verdict}** → ${v.status}${v.before && v.after ? `（${v.before.rank} → ${v.after.rank} 位・表示 ${v.before.impressions} → ${v.after.impressions}）` : ''}${v.revertSha ? ` revert ${v.revertSha}` : ''}${v.note ? ` ${v.note}` : ''}`)),
    sec('選んだ語と理由', o.candidate ? [`- ${o.candidate.keyword}（${o.candidate.rank} 位・tier ${o.candidate.tier ?? '-'}）→ ${o.candidate.file}`] : []),
    sec('検索ニーズ（AI の定義）', o.pendingAction?.needs ? [maskSecrets(o.pendingAction.needs)] : []),
    sec('行った改善', o.status === 'pass' ? [maskSecrets(o.pendingAction.done), '', ...diffBlock(o.diff)] : o.status === 'blocked' ? ['不合格のため書き戻していない:', ...(o.failures ?? []).map((f) => `- [${f.check}] ${maskSecrets(f.detail)}`), '', ...diffBlock(o.diff)] : []),
    sec('提案（機械は適用しない）', (o.pendingAction?.proposals ?? []).map((p) => `- ${maskSecrets(p)}`)),
    sec('観察中', log.entries.filter((e) => e.status === 'observing').map((e) => `- ${e.file}: 公開確認 ${e.publishedVerifiedAt ?? '未'} → 判定 ${e.nextReviewDate ?? '未定'}`)),
    sec('保留・要対応', log.entries.filter((e) => ['parked', 'unpublished'].includes(e.status)).map((e) => `- ${e.file}: ${e.status}${e.note ? `（${e.note}）` : ''}`)),
    sec('報告のみ（編集しない語）', reportOnly.map((x) => `- ${x.keyword}: ${x.reason}${x.page ? ` → ${x.page}` : ''}${x.pages ? ` → ${x.pages.join(', ')}` : ''}`)),
    sec('オーナーへの質問（答えた分だけ次回の材料になる）', questions.map((q) => `- ${q}`)),
  ].join('\n');

  const slackText = `${headerLines.join('\n')}\n${repoUrl}/blob/main/data/seo/reports/${today}.md`;
  return { headerLines, markdown: body, slackText };
}
