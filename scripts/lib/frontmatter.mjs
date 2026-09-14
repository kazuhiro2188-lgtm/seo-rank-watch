// YAML パーサは持たない（依存ゼロ）。トップレベルのキー単位で「塊」として比較する。
// YAML として正しいかの最終判定はビルド段（サイト側のパーサ）が行う。
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: text };
}

export function topLevelBlocks(fm) {
  const blocks = new Map();
  let key = null;
  for (const line of (fm ?? '').split('\n')) {
    const m = /^([A-Za-z_][\w-]*):/.exec(line);
    if (m) { key = m[1]; blocks.set(key, line); }
    else if (key !== null) blocks.set(key, `${blocks.get(key)}\n${line}`);
  }
  return blocks;
}

export function diffFrontmatter(a, b) {
  const A = topLevelBlocks(a), B = topLevelBlocks(b);
  return {
    changed: [...A].filter(([k, v]) => B.has(k) && B.get(k) !== v).map(([k]) => k),
    added: [...B.keys()].filter((k) => !A.has(k)),
    removed: [...A.keys()].filter((k) => !B.has(k)),
  };
}

export function structurallyValid(fm) {
  if (fm === null) return true;
  if (fm.includes('\t')) return false;
  return fm.split('\n').every((l) => l === '' || /^[A-Za-z_][\w-]*:( .*)?$/.test(l) || /^ +\S/.test(l));
}

export function readTitle(text) {
  const { fm } = splitFrontmatter(text);
  const m = /^title:\s*"?(.*?)"?\s*$/m.exec(fm ?? '');
  return m ? m[1] : null;
}
