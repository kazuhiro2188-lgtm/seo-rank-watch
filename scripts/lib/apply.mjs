import { addDays } from './dates.mjs';
import { findEntry, upsertEntry } from './log.mjs';
import { splitFrontmatter } from './frontmatter.mjs';

const REVIEW_LAG = 10; // 7 日観察＋GSC 遅延 3 日

function ensureEntry(log, candidate) {
  return findEntry(log, candidate.file) ?? upsertEntry(log, {
    file: candidate.file, targetPath: candidate.targetPath, keywords: [], status: 'active',
    attempts: 0, extensions: 0, regressions: 0, publishedVerifiedAt: null, nextReviewDate: null, cooldownUntil: null,
    actions: [], blocked: [],
  });
}

export function applyVerdicts(log, verdicts, today) {
  const reverts = [];
  for (const v of verdicts) {
    const e = findEntry(log, v.file);
    if (!e || v.verdict === 'pending') continue;
    if (v.verdict === 'achieved-check') { e.status = v.status; e.regressions = v.regressions; continue; }
    if (v.verdict === 'cooldown-end') { e.status = 'active'; e.cooldownUntil = null; continue; }
    // 公開確認に到達しないまま放置されたもの。試行回数の話ではないので attempts / extensions は触らない
    if (v.verdict === 'publish-unconfirmed') { markUnpublished(log, e.file, today); e.note = v.note ?? null; continue; }
    e.status = v.status; e.attempts = v.attempts; e.extensions = v.extensions;
    e.nextReviewDate = v.nextReviewDate ?? null; e.cooldownUntil = v.cooldownUntil ?? null;
    const last = e.actions?.at(-1);
    if (last) { last.verdict = v.verdict; last.verdictAt = today; last.before = v.before ?? null; last.after = v.after ?? null; }
    if (v.revert) {
      // SHA が無いのに status だけ reverted にすると、戻していない変更が本番に残ったまま
      // 7 日後に active へ戻る。revert できないことを parked ＋ note で表に出す。
      if (v.revertSha) reverts.push({ file: e.file, sha: v.revertSha });
      else markRevertFailed(log, e.file, 'revert 対象のコミットが記録されていない');
    }
  }
  return { reverts };
}

export function recordChange(log, { candidate, pendingAction, today }) {
  const e = ensureEntry(log, candidate);
  if (!e.keywords.includes(candidate.keyword)) e.keywords.push(candidate.keyword);
  e.status = 'observing'; e.publishedVerifiedAt = null; e.nextReviewDate = null;
  e.actions.push({
    date: today, commitSha: null, keyword: candidate.keyword,
    rankAtAction: candidate.rank, impressionsAtAction: candidate.impressions,
    editType: pendingAction.editType, needs: pendingAction.needs, done: pendingAction.done,
    verdict: null, proposals: pendingAction.proposals ?? [], needsAuthor: pendingAction.needsAuthor ?? [],
  });
  return e;
}

export function recordBlocked(log, { candidate, failures, today }) {
  const e = ensureEntry(log, candidate);
  e.blocked = e.blocked ?? [];
  e.blocked.push({ date: today, keyword: candidate.keyword, failures });
  return e;
}

export function recordSha(log, file, sha) { const e = findEntry(log, file); if (e?.actions?.length) e.actions.at(-1).commitSha = sha; return e; }
export function markPublished(log, file, today) { const e = findEntry(log, file); if (e) { e.publishedVerifiedAt = today; e.nextReviewDate = addDays(today, REVIEW_LAG); } return e; }
export function markUnpublished(log, file, today) { const e = findEntry(log, file); if (e) { e.status = 'unpublished'; e.unpublishedAt = today; } return e; }
export function markRevertFailed(log, file, message) { const e = findEntry(log, file); if (e) { e.status = 'parked'; e.note = `revert に失敗: ${message}`; } return e; }

/** frontmatter の日付欄をスクリプトが刻む（AI には触らせない）。 */
export function setUpdatedAt(text, field, today) {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return text;
  const re = new RegExp(`^${field}:.*$`, 'm');
  const next = re.test(fm) ? fm.replace(re, `${field}: "${today}"`) : `${fm}\n${field}: "${today}"`;
  return text.replace(fm, next);
}
