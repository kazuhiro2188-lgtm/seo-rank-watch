import { addDays } from './dates.mjs';
import { findSnapshot, latestSnapshot, rankFor } from './history.mjs';

/** 観察開始日 S（公開確認日）から、比較する 2 つの 7 日窓の終端と判定日を出す。 */
export function reviewDates(publishedVerifiedAt, lagDays = 3) {
  return {
    beforeEnd: addDays(publishedVerifiedAt, -1),
    afterEnd: addDays(publishedVerifiedAt, 7),
    reviewDate: addDays(publishedVerifiedAt, 7 + lagDays),
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
      const d = reviewDates(e.publishedVerifiedAt);
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
