import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter, readTitle } from './frontmatter.mjs';

export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`雛形の差し込み口 {{${k}}} に値がありません`);
    return String(vars[k]);
  });
}

/** 対象以外の公開記事。AI が内部リンクを張れる先の一覧(自ドメインのみ)。 */
export function internalLinkCandidates(repoDir, config, excludeFile) {
  const dir = join(repoDir, config.contentDir);
  return readdirSync(dir).filter((f) => f.endsWith('.md')).flatMap((f) => {
    const rel = `${config.contentDir}/${f}`;
    if (rel === excludeFile) return [];
    const text = readFileSync(join(dir, f), 'utf8');
    const { fm } = splitFrontmatter(text);
    if (/^draft:\s*true\s*$/m.test(fm ?? '')) return [];
    const path = `/${f.replace(/\.md$/, '')}`;
    return [{ path, title: readTitle(text) ?? path }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function formatPageQueries(list) {
  if (!list?.length) return '（このページに表示された他のクエリはまだありません）';
  return list.map((q) => `- ${q.query}（表示 ${q.impressions}・${q.rank ?? '—'} 位）`).join('\n');
}
