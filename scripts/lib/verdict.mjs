import { addDays, daysBetween } from './dates.mjs';
import { findSnapshot, latestSnapshot, rankFor } from './history.mjs';

/**
 * 観察開始日 S（公開確認日）から、比較する 2 つの 7 日窓の終端と判定日を出す。
 * 延長（extensions）したときは後窓だけ 7 日ずつ後ろへ動かす。前窓は改善前の基準線なので据え置く。
 * 後窓を動かさないと、延長しても毎回まったく同じ窓を読み直すだけで比較材料が増えない。
 */
export function reviewDates(publishedVerifiedAt, extensions = 0, lagDays = 3) {
  const shift = 7 * extensions;
  return {
    beforeEnd: addDays(publishedVerifiedAt, -1),
    afterEnd: addDays(publishedVerifiedAt, 7 + shift),
    reviewDate: addDays(publishedVerifiedAt, 7 + shift + lagDays),
  };
}

/** 判定表（設計書 §4）。上から順に評価する。 */
export function judge({ entry, before, after, limits: L }) {
  const b = before ?? { rank: null, impressions: 0 };
  const a = after ?? { rank: null, impressions: 0 };
  const attempts = entry.attempts ?? 0;
  const extensions = entry.extensions ?? 0;
  if (b.rank === null || a.rank === null || b.impressions < L.minImpressions || a.impressions < L.minImpressions) {
    if (extensions >= L.maxExtensions) return { verdict: 'unmeasurable', status: 'parked', attempts, extensions, revert: false };
    return { verdict: 'unmeasurable', status: 'observing', attempts, extensions: extensions + 1, revert: false };
  }
  if (a.rank <= L.rank1Threshold) return { verdict: 'rank1', status: 'achieved', attempts, extensions, revert: false };
  if (a.rank - b.rank >= L.worsenThreshold) return { verdict: 'worsened', status: 'reverted', attempts: attempts + 1, extensions, revert: true };
  if (b.rank - a.rank >= L.improveDelta) return { verdict: 'improved', status: 'active', attempts: attempts + 1, extensions, revert: false };
  const next = attempts + 1;
  return { verdict: 'no-effect', status: next >= L.maxAttemptsPerFile ? 'parked' : 'active', attempts: next, extensions, revert: false };
}

/** achieved は終端ではない。2.0 超が 2 回続いたら active に戻す。 */
export function judgeAchieved({ entry, latestRank }) {
  const n = latestRank !== null && latestRank > 2.0 ? (entry.regressions ?? 0) + 1 : 0;
  return { status: n >= 2 ? 'active' : 'achieved', regressions: n };
}

export function computeVerdicts({ log, snapshots, limits, today }) {
  const out = [];
  for (const e of log.entries) {
    const kw = e.actions?.at(-1)?.keyword ?? e.keywords?.[0] ?? null;
    if (e.status === 'observing' && e.publishedVerifiedAt && e.nextReviewDate && e.nextReviewDate <= today) {
      const d = reviewDates(e.publishedVerifiedAt, e.extensions ?? 0);
      const afterSnap = findSnapshot(snapshots, 7, d.afterEnd);
      if (!afterSnap) { out.push({ file: e.file, keyword: kw, verdict: 'pending', status: 'observing', note: `終端 ${d.afterEnd} の 7 日窓がまだ無い（日次が止まっていないか確認）` }); continue; }
      const before = rankFor(findSnapshot(snapshots, 7, d.beforeEnd), kw);
      const after = rankFor(afterSnap, kw);
      const j = judge({ entry: e, before, after, limits });
      out.push({
        file: e.file, keyword: kw, ...j,
        before: before && { rank: before.rank, impressions: before.impressions },
        after: after && { rank: after.rank, impressions: after.impressions },
        revertSha: j.revert ? (e.actions?.at(-1)?.commitSha ?? null) : null,
        nextReviewDate: j.status === 'observing' ? addDays(today, 7) : null,
        cooldownUntil: j.status === 'reverted' ? addDays(today, 7) : null,
      });
    } else if (e.status === 'observing' && !e.publishedVerifiedAt) {
      // 記事の push は済んだのに公開確認ステップに到達しない（ジョブのタイムアウト・runner 死亡）と、
      // 他のどの枝にも当たらず select からは locked で外れる。本番に載ったまま永久ロックになるので、
      // 7 日超えたら unpublished（週次報告の「保留・要対応」に出る）に落として人に見せる。
      const lastActionDate = e.actions?.at(-1)?.date ?? null;
      const elapsed = lastActionDate ? daysBetween(lastActionDate, today) : 0;
      if (lastActionDate && elapsed > 7) {
        out.push({
          file: e.file, keyword: kw, verdict: 'publish-unconfirmed', status: 'unpublished',
          note: `公開確認に到達しないまま ${elapsed} 日経過。記事は push 済みの可能性がある`,
        });
      }
    } else if (e.status === 'achieved') {
      const latest = rankFor(latestSnapshot(snapshots, 7), kw);
      const r = judgeAchieved({ entry: e, latestRank: latest?.rank ?? null });
      if (r.status !== e.status || r.regressions !== (e.regressions ?? 0)) out.push({ file: e.file, keyword: kw, verdict: 'achieved-check', status: r.status, regressions: r.regressions });
    } else if (e.status === 'reverted' && e.cooldownUntil && e.cooldownUntil <= today) {
      out.push({ file: e.file, keyword: kw, verdict: 'cooldown-end', status: 'active' });
    }
  }
  return out;
}
