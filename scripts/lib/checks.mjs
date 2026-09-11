import { splitFrontmatter, diffFrontmatter, structurallyValid } from './frontmatter.mjs';
import { lineDiff } from './diff.mjs';

const ALWAYS_FORBIDDEN_KEYS = ['keyword', 'publishedAt', 'updatedAt', 'draft', 'robots', 'noindex', 'canonical', 'redirect', 'redirect_from', 'redirect_to', 'permalink', 'slug', 'layout', 'sitemap'];
const FORBIDDEN_CONTENT = [
  [/<\s*\/?\s*[a-z!?][^>]*>/i, 'HTML タグ'],
  [/\bon[a-z]+\s*=/i, 'on*= 属性'],
  [/javascript:|data:/i, 'javascript:/data: URI'],
  [/^\s*(import|export)\s/m, 'MDX の import/export'],
  [/\{\{|\{%|<%/, 'テンプレート構文'],
  [/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/, 'ゼロ幅・双方向制御文字'],
  [/display\s*:\s*none|font-size\s*:\s*0/i, '隠しスタイル'],
  [/[A-Za-z0-9+/]{120,}={0,2}/, 'base64 の塊'],
];
const SECRET_PATTERNS = [/sk-ant-/, /\bgh[po]_[A-Za-z0-9]{20,}/, /github_pat_/, /xox[baprs]-/, /hooks\.slack\.com\/services\//, /-----BEGIN/, /AIza[0-9A-Za-z_-]{20,}/];
const CONTACT_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'メールアドレス'],
  [/0\d{1,4}-\d{1,4}-\d{3,4}/, '電話番号'],
  [/\b(0x[0-9a-fA-F]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,})\b/, '暗号資産アドレス'],
];
const EDIT_TYPES = ['title', 'description', 'intro', 'faq', 'structure', 'update', 'internal-link'];
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function stripCodeFences(text) { return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ''); }
export function extractUrls(text) { return text.match(URL_RE) ?? []; }
export function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } }
export function japaneseRatio(text) {
  const chars = [...text.replace(/\s/g, '')];
  if (!chars.length) return 1;
  return chars.filter((c) => /[\u3040-\u30FF\u4E00-\u9FFF]/.test(c)).length / chars.length;
}

/** 正規表現のすべての一致を文字列の配列で返す（g フラグを補う）。 */
export function matchList(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...text.matchAll(g)].map((m) => m[0]);
}

/**
 * revised にあって original では説明できない一致だけを返す。
 * 「元記事に 1 つあれば以後すべて見逃す」を避けるため、出現の多重集合で差を取る。
 */
export function newOccurrences(re, revised, original) {
  const pool = matchList(re, original);
  return matchList(re, revised).filter((m) => {
    const i = pool.indexOf(m);
    if (i === -1) return true;
    pool.splice(i, 1);
    return false;
  });
}

/** 設計書 §5 の 8 項目。AI を介さない。1 つでも不合格なら書き戻さない。 */
export function verifyChange({ original, revised, pendingAction, candidate, config, fetchedDomains }) {
  const L = config.limits;
  const failures = [];
  const fail = (check, detail) => failures.push({ check, detail });

  // 1 同一性（ファイル単位はワークフローが git status で確認。ここでは中身）
  if (typeof revised !== 'string' || revised.trim() === '') { fail(1, '出力が空'); return { ok: false, failures }; }
  if (revised === original) fail(1, '変更が無い');

  const O = splitFrontmatter(original), R = splitFrontmatter(revised);

  // 2 frontmatter は許可リスト方式
  if (!structurallyValid(R.fm)) fail(2, 'frontmatter の形式が崩れている（タブ・キーでない行）');
  const d = diffFrontmatter(O.fm, R.fm);
  const editable = new Set(config.frontmatter.editable.filter((k) => !ALWAYS_FORBIDDEN_KEYS.includes(k)));
  for (const k of [...d.changed, ...d.added]) if (!editable.has(k)) fail(2, `frontmatter の ${k} は変更・追加不可`);
  for (const k of d.removed) fail(2, `frontmatter の ${k} が消えている`);

  // 3 外部リンク
  const origUrls = extractUrls(original), revUrls = extractUrls(revised);
  for (const u of origUrls) if (!revised.includes(u)) fail(3, `元の URL が変わっている: ${u}`);
  const allowed = new Set([...config.linkAllowlist, domainOf(config.baseUrl), ...origUrls.map(domainOf)].filter(Boolean));
  const fetched = new Set(fetchedDomains ?? []);
  for (const u of revUrls) {
    if (origUrls.includes(u)) continue;
    const dm = domainOf(u);
    if (!dm) continue;
    if (fetched.has(dm)) fail(3, `AI が読んだページのドメインが新出: ${dm}`);
    else if (!allowed.has(dm)) fail(3, `許可されていないドメイン: ${dm}`);
  }
  if (/\brel=|\btarget=/.test(revised) && !/\brel=|\btarget=/.test(original)) fail(3, 'rel/target の新出');

  // 4 実行可能・隠しコンテンツ（コードフェンス外。frontmatter の値も対象にする）
  const revNoCode = stripCodeFences(revised), origNoCode = stripCodeFences(original);
  for (const [re, label] of FORBIDDEN_CONTENT) {
    const news = newOccurrences(re, revNoCode, origNoCode);
    if (news.length > 0) fail(4, `${label} の新出: ${news[0].slice(0, 40)}`);
  }
  const newComments = newOccurrences(/<!--/, revNoCode, origNoCode);
  if (newComments.length > 0) fail(4, 'HTML コメントの新出');

  // 5 規模
  const { added, removed } = lineDiff(original, revised);
  const origLines = original.split('\n').length;
  if (added.length > L.maxAddedLines) fail(5, `追加 ${added.length} 行 > 上限 ${L.maxAddedLines}`);
  if (removed.length > origLines * L.maxDeletedRatio) fail(5, `削除 ${removed.length} 行 > 元の ${Math.round(L.maxDeletedRatio * 100)}%`);
  if (revised.length < original.length * L.minOutputRatio) fail(5, `出力が元の ${Math.round(L.minOutputRatio * 100)}% 未満`);

  // 6 秘密文字列・連絡先（追加行だけを見る）
  const addedText = added.join('\n');
  for (const re of SECRET_PATTERNS) if (re.test(addedText)) fail(6, `秘密文字列らしきものの新出（${re.source}）`);
  for (const [re, label] of CONTACT_PATTERNS) if (re.test(addedText)) fail(6, `${label} の新出`);

  // 7 言語・文体
  const addedProse = stripCodeFences(addedText).replace(URL_RE, '');
  if (config.language === 'ja' && addedProse.trim() && japaneseRatio(addedProse) < L.japaneseRatioMin) fail(7, `追加部分の日本語比率が ${Math.round(japaneseRatio(addedProse) * 100)}% と低い`);
  for (const w of config.bannedWords) if (addedText.includes(w) && !original.includes(w)) fail(7, `禁止語の新出: ${w}`);
  if (revUrls.length > Math.max(origUrls.length * 2, origUrls.length + 3)) fail(7, `URL 数の急増 ${origUrls.length} → ${revUrls.length}`);

  // 8 申告の整合
  const pa = pendingAction ?? {};
  if (pa.keyword !== candidate.keyword) fail(8, 'pending-action の keyword が選定結果と違う');
  if (pa.targetPath !== candidate.targetPath) fail(8, 'pending-action の targetPath が選定結果と違う');
  if (!EDIT_TYPES.includes(pa.editType)) fail(8, `editType が不正: ${pa.editType}`);
  if (candidate.avoidEditType && pa.editType === candidate.avoidEditType) fail(8, `前回と同じ editType（${pa.editType}）`);
  for (const f of ['needs', 'done']) if (typeof pa[f] !== 'string' || !pa[f].trim() || pa[f].length > 400) fail(8, `${f} が無い／長すぎる`);
  for (const f of ['proposals', 'needsAuthor']) if (!Array.isArray(pa[f])) fail(8, `${f} は配列`);

  return { ok: failures.length === 0, failures };
}
