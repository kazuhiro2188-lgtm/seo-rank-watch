import { lineDiff } from './diff.mjs';

export function stripMarkdown(line) {
  return line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').replace(/^\d+\.\s+/, '')
    .replace(/^\s+-\s+q:\s*/, '').replace(/^\s+a:\s*/, '').replace(/^[A-Za-z_][\w-]*:\s*/, '').replace(/^"|"$/g, '')
    .replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

/** 差分の追加行から、公開確認に使う目印の一文（minLen 字以上・最長）を選ぶ。無ければ null。 */
export function fingerprintFromDiff(original, revised, minLen = 20) {
  const { added } = lineDiff(original, revised);
  const cands = added.map(stripMarkdown).filter((s) => s.length >= minLen && !/^[-|:\s]+$/.test(s) && !/^[a-z_]+:\s*$/i.test(s));
  return cands.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** タグを除いた本文と、生 HTML（meta の属性など）の両方で探す。空白と全角半角の差は無視。 */
export function htmlContains(html, sentence) {
  const n = (s) => s.normalize('NFKC').replace(/\s+/g, '');
  const needle = n(sentence);
  return n(stripHtml(html)).includes(needle) || n(html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')).includes(needle);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
