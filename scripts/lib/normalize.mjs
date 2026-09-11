// 監視語と GSC クエリの表記ゆれ（全角・大文字・空白）を吸収する。
export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, ' ').trim();
}

export function tokens(s) { return normalizeText(s).split(' ').filter(Boolean); }

/** 監視語の全トークンをクエリが含めば一致。部分一致ではなく「含む」で束ねる。 */
export function queryMatchesKeyword(query, keyword) {
  const q = normalizeText(query);
  const ts = tokens(keyword);
  return ts.length > 0 && ts.every((t) => q.includes(t));
}

/** URL でもパスでも '/foo' の形に。ホスト・クエリ・ハッシュ・末尾スラッシュを落とす。 */
export function normalizePath(input) {
  let p = String(input ?? '');
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { return null; }
  }
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}
