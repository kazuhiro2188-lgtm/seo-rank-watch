import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 窓の長さ＋終端で 1 件を一意にする。同じ窓を同じ日に 2 回取っても 1 行。 */
export function snapshotKey(s) { return `${s.window.days}:${s.window.endDate}`; }

export function readHistory(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** 追記専用。過去の行には一切触れない。 */
export function appendSnapshot(path, snap) {
  const existing = readHistory(path);
  if (existing.some((s) => snapshotKey(s) === snapshotKey(snap))) return { appended: false, total: existing.length };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(snap)}\n`);
  return { appended: true, total: existing.length + 1 };
}

export function findSnapshot(snapshots, days, endDate) {
  return snapshots.find((s) => s.window.days === days && s.window.endDate === endDate) ?? null;
}

export function latestSnapshot(snapshots, days) {
  const xs = snapshots.filter((s) => s.window.days === days);
  return xs.length ? xs.reduce((a, b) => (a.window.endDate >= b.window.endDate ? a : b)) : null;
}

export function rankFor(snapshot, keyword) {
  return snapshot?.ranks?.find((r) => r.keyword === keyword) ?? null;
}
