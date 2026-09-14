import { normalizePath, queryMatchesKeyword } from './normalize.mjs';

const round2 = (x) => Number(x.toFixed(2));
const rankOf = (g) => (g && g.impressions > 0 ? round2(g.weighted / g.impressions) : null);

/**
 * クエリ × ページで集計する。
 * - 順位は「対象パスに一致するページ」の行だけを impressions で加重平均（GSC の画面と同じ重み付け）
 * - 別ページに出ている分は otherPages（カニバリの材料）。対象に 1 行も無ければ rank は null
 * - pageQueries は対象ページが表示された他クエリ（検索意図の材料）
 */
export function aggregate({ rows, watchwords }) {
  const withPath = rows.map((r) => ({ ...r, path: normalizePath(r.page) })).filter((r) => r.path);

  const ranks = watchwords.map((w) => {
    const target = normalizePath(w.targetPath);
    const groups = new Map();
    for (const r of withPath) {
      if (!queryMatchesKeyword(r.query, w.keyword)) continue;
      const g = groups.get(r.path) ?? { impressions: 0, clicks: 0, weighted: 0, queries: new Set() };
      g.impressions += r.impressions; g.clicks += r.clicks; g.weighted += r.position * r.impressions; g.queries.add(r.query);
      groups.set(r.path, g);
    }
    const t = groups.get(target) ?? null;
    const others = [...groups].filter(([p]) => p !== target);
    const otherPages = others
      .map(([p, g]) => ({ path: p, rank: rankOf(g), impressions: g.impressions }))
      .filter((o) => o.rank !== null && o.rank <= 20)
      .sort((a, b) => a.rank - b.rank);
    const best = others.sort((a, b) => b[1].impressions - a[1].impressions)[0] ?? null;
    return {
      keyword: w.keyword, targetPath: target, priority: w.priority ?? 'normal',
      rank: rankOf(t), impressions: t?.impressions ?? 0, clicks: t?.clicks ?? 0,
      page: t ? target : (best ? best[0] : null),
      pageMatches: Boolean(t),
      otherPages,
      matchedQueries: t ? [...t.queries] : [],
    };
  });

  const pageQueries = {};
  for (const w of watchwords) {
    const p = normalizePath(w.targetPath);
    const acc = new Map();
    for (const r of withPath) {
      if (r.path !== p) continue;
      const c = acc.get(r.query) ?? { query: r.query, impressions: 0, weighted: 0 };
      c.impressions += r.impressions; c.weighted += r.position * r.impressions;
      acc.set(r.query, c);
    }
    pageQueries[p] = [...acc.values()]
      .map((c) => ({ query: c.query, impressions: c.impressions, rank: rankOf(c) }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);
  }
  return { ranks, pageQueries };
}

/** 全語 null かつ impressions 0。監視語ゼロは「測れていない」ではないので false。 */
export function allNull(ranks) {
  return ranks.length > 0 && ranks.every((r) => r.rank === null && r.impressions === 0);
}
