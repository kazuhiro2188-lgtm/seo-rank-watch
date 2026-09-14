import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFile } from './config.mjs';
import { findEntry } from './log.mjs';

const LOCKED = new Set(['observing', 'parked', 'achieved', 'unpublished']);

function isLocked(entry, today) {
  if (!entry) return false;
  if (LOCKED.has(entry.status)) return true;
  return entry.status === 'reverted' && Boolean(entry.cooldownUntil) && entry.cooldownUntil > today;
}

/**
 * 今週直す 1 語を決める。AI は関与しない。
 * 優先順位: ①2〜10 位＋impressions 十分（1 位に近い順） ②11〜20 位（impressions 多い順） ③試行済みで 1 位未達
 * 旧優先度 4（rank null）・5（未登録クエリ）は候補にしない（報告のみ）。
 */
export function selectCandidate({ ranks, log, config, repoDir, today }) {
  const L = config.limits;
  const reportOnly = [];
  const pool = [];
  for (const r of ranks) {
    const file = resolveFile(config, r.targetPath);
    if (!file) { reportOnly.push({ keyword: r.keyword, reason: 'unsupported', targetPath: r.targetPath }); continue; }
    if (!existsSync(join(repoDir, file))) { reportOnly.push({ keyword: r.keyword, reason: 'missing-file', file }); continue; }
    const entry = findEntry(log, file);
    if (isLocked(entry, today)) { reportOnly.push({ keyword: r.keyword, reason: 'locked', status: entry.status }); continue; }
    if (!r.pageMatches && r.page) { reportOnly.push({ keyword: r.keyword, reason: 'mismatch', page: r.page }); continue; }
    if (r.rank === null) { reportOnly.push({ keyword: r.keyword, reason: 'rank-null' }); continue; }
    if (r.otherPages.length > 0) { reportOnly.push({ keyword: r.keyword, reason: 'cannibalized', pages: r.otherPages.map((o) => o.path) }); continue; }
    if (r.rank <= L.rank1Threshold) { reportOnly.push({ keyword: r.keyword, reason: 'rank1' }); continue; }
    const attempts = entry?.attempts ?? 0;
    if (attempts >= L.maxAttemptsPerFile) { reportOnly.push({ keyword: r.keyword, reason: 'attempts-exhausted', attempts }); continue; }
    let tier = null;
    if (r.rank <= 10 && r.impressions >= L.minImpressions) tier = 1;
    else if (r.rank > 10 && r.rank <= 20 && r.impressions > 0) tier = 2;
    else if (attempts > 0) tier = 3;
    if (tier === null) { reportOnly.push({ keyword: r.keyword, reason: 'no-tier', rank: r.rank, impressions: r.impressions }); continue; }
    pool.push({ r, file, entry, attempts, tier });
  }
  pool.sort((a, b) => a.tier - b.tier || (a.tier === 2 ? b.r.impressions - a.r.impressions : a.r.rank - b.r.rank));
  const top = pool[0];
  if (!top) return { candidate: null, reportOnly };
  const actions = top.entry?.actions ?? [];
  const last = actions.at(-1) ?? null;
  return {
    candidate: {
      keyword: top.r.keyword, targetPath: top.r.targetPath, file: top.file,
      rank: top.r.rank, impressions: top.r.impressions, clicks: top.r.clicks,
      tier: top.tier, attempts: top.attempts,
      previousDone: actions.map((a) => a.done).filter(Boolean),
      lastVerdict: last?.verdict ?? null, lastEditType: last?.editType ?? null,
      avoidEditType: last?.verdict === 'no-effect' ? last.editType : null,
    },
    reportOnly,
  };
}
