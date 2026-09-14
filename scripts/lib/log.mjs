import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function readLog(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { entries: [] };
}
export function writeLog(path, log) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`);
}
export function findEntry(log, file) { return log.entries.find((e) => e.file === file) ?? null; }
export function upsertEntry(log, entry) {
  const i = log.entries.findIndex((e) => e.file === entry.file);
  if (i === -1) log.entries.push(entry); else log.entries[i] = entry;
  return entry;
}
