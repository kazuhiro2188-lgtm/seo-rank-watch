import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLog, writeLog, findEntry, upsertEntry } from '../scripts/lib/log.mjs';

test('readLog はファイルが無ければ { entries: [] } を返す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-log-'));
  const p = join(dir, 'data/seo/improvement-log.json');
  assert.deepEqual(readLog(p), { entries: [] });
  rmSync(dir, { recursive: true, force: true });
});

test('writeLog は無いディレクトリも作って書き、readLog で往復できる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srw-log-'));
  const p = join(dir, 'data/seo/improvement-log.json');
  assert.equal(existsSync(p), false);
  const log = { entries: [{ file: 'content/articles/a.md', status: 'observing' }] };
  writeLog(p, log);
  assert.equal(existsSync(p), true);
  assert.deepEqual(readLog(p), log);
  rmSync(dir, { recursive: true, force: true });
});

test('findEntry は file が一致するエントリを返し、無ければ null', () => {
  const log = { entries: [{ file: 'a.md', status: 'observing' }, { file: 'b.md', status: 'active' }] };
  assert.equal(findEntry(log, 'b.md').status, 'active');
  assert.equal(findEntry(log, 'zzz.md'), null);
});

test('upsertEntry: 同じ file は置換（長さ不変・中身は新しい方）、別 file は末尾に追加（長さ+1）', () => {
  const log = { entries: [{ file: 'a.md', status: 'observing' }, { file: 'b.md', status: 'active' }] };
  upsertEntry(log, { file: 'b.md', status: 'reverted' });
  assert.equal(log.entries.length, 2, '置換なので長さは変わらない');
  assert.equal(log.entries[1].status, 'reverted', '中身は新しい方に置き換わる');
  assert.equal(log.entries[0].status, 'observing', '無関係なエントリは変わらない');

  upsertEntry(log, { file: 'c.md', status: 'observing' });
  assert.equal(log.entries.length, 3, '別 file なら追加され長さが増える');
  assert.equal(log.entries.at(-1).file, 'c.md', '末尾に追加される');
});

test('upsertEntry の返り値は渡したエントリそのもの（参照が同じ）', () => {
  const log = { entries: [] };
  const entry = { file: 'a.md', status: 'observing' };
  const r = upsertEntry(log, entry);
  assert.equal(r, entry, '返り値は引数と同一参照');
  r.status = 'active';
  assert.equal(log.entries[0].status, 'active', '返り値を書き換えると log にも反映される（同一参照のため）');
});
