import { lineDiff } from './diff.mjs';

export function stripMarkdown(line) {
  return line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').replace(/^\d+\.\s+/, '')
    .replace(/^\s+-\s+q:\s*/, '').replace(/^\s+a:\s*/, '').replace(/^[A-Za-z_][\w-]*:\s*/, '').replace(/^"|"$/g, '')
    .replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

/** 差分の追加行から、公開確認に使う目印の一文（20 字以上・最長）を選ぶ。無ければ null。 */
export function fingerprintFromDiff(original, revised) {
  const { added } = lineDiff(original, revised);
  const cands = added.map(stripMarkdown).filter((s) => s.length >= 20 && !/^[-|:\s]+$/.test(s) && !/^[a-z_]+:\s*$/i.test(s));
  return cands.sort((a, b) => b.length - a.length)[0] ?? null;
}
