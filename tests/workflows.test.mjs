import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ワークフローは 2 本が複製関係にある（env の 3 行だけが違う）。柵は両方に同じものが入っていること。
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const IMPROVE = ['workflows/seo-improve.yml', '.github/workflows/seo-improve.yml'];

/**
 * YAML から「名前つきステップ」を順に取り出す（依存ゼロの最小実装）。
 * 宣言的成果物は生の全文に正規表現をかけるのではなく、{ name, run } の配列という
 * 正規化した意味のモデルに直してから表明する。
 * - `- name:` の行でステップが始まり、同じ深さの次の項目かより浅い行で終わる
 * - `run: |` のブロックも `run: <その場書き>` も run に入れる（ブロックは字下げを剥がす）
 */
function parseSteps(yaml) {
  const steps = [];
  let cur = null;        // 収集中のステップ
  let runIndent = null;  // run: ブロックを読んでいる間だけ、その run: キーの深さ
  const indentOf = (l) => l.match(/^ */)[0].length;
  const close = () => { if (cur) steps.push({ name: cur.name, run: cur.run.join('\n') }); cur = null; };

  for (const line of yaml.split('\n')) {
    const blank = line.trim() === '';
    const indent = indentOf(line);

    // run: ブロックの中身（空行か、ブロックより深い行）
    if (cur && runIndent !== null && (blank || indent > runIndent)) {
      cur.run.push(blank ? '' : line.slice(runIndent + 2));
      continue;
    }
    runIndent = null;

    // 同じ深さの次の項目、またはより浅い行でステップは終わる
    if (cur && !blank && (indent < cur.indent || (indent === cur.indent && /^\s*- /.test(line)))) close();

    const start = line.match(/^( *)- name:\s*(.*)$/);
    if (start) { cur = { indent: start[1].length, name: start[2].trim(), run: [] }; continue; }
    if (!cur || blank) continue;

    const run = line.match(/^( *)run:\s*(.*)$/);
    if (run) {
      const v = run[2].trim();
      if (/^[|>][-+]?$/.test(v)) runIndent = run[1].length;
      else cur.run.push(v);
    }
  }
  close();
  return steps;
}

/** `--flag "値"` の値だけを取り出す（YAML 全文ではなく、当該ステップの run から）。 */
function flagValue(run, flag) {
  const m = run.match(new RegExp(`${flag}\\s+"([^"]*)"`));
  return m ? m[1] : null;
}

const stepsOf = (p) => parseSteps(read(p));
const stepIndex = (steps, needle) => steps.findIndex((s) => s.run.includes(needle));

test('ステップ抽出のヘルパー: name と run を対にして順に取り出す（ブロックもその場書きも）', () => {
  const sample = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@v5',
    '      - name: 一つ目',
    '        env:',
    '          X: "1"',
    '        run: |',
    '          echo あ',
    '',
    '          echo い',
    '      - name: 二つ目',
    '        run: echo う',
    '  b:',
    '    steps:',
    '      - name: 三つ目',
    '        run: echo え',
    '',
  ].join('\n');
  assert.deepEqual(parseSteps(sample), [
    { name: '一つ目', run: 'echo あ\n\necho い' },
    { name: '二つ目', run: 'echo う' },
    { name: '三つ目', run: 'echo え' },
  ]);
});

test('AI に渡す道具: allowedTools / disallowedTools の値（claude -p のステップの run から・両方の YAML）', () => {
  for (const p of IMPROVE) {
    const steps = stepsOf(p);
    const i = stepIndex(steps, 'claude -p');
    assert.ok(i >= 0, `${p}: claude -p を含むステップが無い`);
    const allowed = flagValue(steps[i].run, '--allowedTools');
    const disallowed = flagValue(steps[i].run, '--disallowedTools');
    assert.equal(allowed, 'WebSearch,WebFetch,Write(/tmp/work/out/**)', `${p}: Write がパス無制限`);
    assert.equal(disallowed, 'Bash,Read,Edit,NotebookEdit,Glob,Grep,Task', `${p}: コンマ区切りでない`);
    assert.equal(/[ \t]/.test(disallowed ?? ' '), false, `${p}: disallowedTools に空白が混ざっている（1 個のツール名と解釈される）`);
  }
});

test('AI 実行の次が汚れの照合・その次が変更検査（ステップの並びで表明・両方の YAML）', () => {
  for (const p of IMPROVE) {
    const steps = stepsOf(p);
    const i = stepIndex(steps, 'claude -p');
    assert.ok(i >= 0, `${p}: claude -p を含むステップが無い`);
    assert.ok(steps[i + 1]?.run.includes('git status --porcelain'), `${p}: AI 実行の次のステップが汚れの照合ではない（${steps[i + 1]?.name ?? 'ステップ無し'}）`);
    assert.match(steps[i + 1].name, /検査の迂回を防ぐ/, `${p}: 迂回防止のステップ名が無い`);
    assert.ok(steps[i + 2]?.run.includes('verify_change.mjs'), `${p}: 汚れの照合の次のステップが変更検査ではない（${steps[i + 2]?.name ?? 'ステップ無し'}）`);
  }
});

test('revert 用の SHA は push 後に記録する（同じステップの中で git push より後の行・両方の YAML）', () => {
  for (const p of IMPROVE) {
    const steps = stepsOf(p);
    const i = stepIndex(steps, 'record-sha');
    assert.ok(i >= 0, `${p}: record-sha を含むステップが無い`);
    const lines = steps[i].run.split('\n');
    const push = lines.findIndex((l) => /(^|\s)git push(\s|$)/.test(l));
    const record = lines.findIndex((l) => l.includes('record-sha'));
    assert.ok(push >= 0, `${p}: 同じステップに git push が無い`);
    assert.ok(record > push, `${p}: record-sha（${record + 1} 行目）が git push（${push + 1} 行目）より前。git pull --rebase で記事コミットの SHA が変わると、7 日後の git revert が存在しないオブジェクトを指す`);
    // このステップの最初の git pull --rebase は、apply.mjs change が書いた improvement-log.json が
    // まだ未コミットのまま走る。--autostash が無いと git が unstaged changes で 128 を返して必ず落ちる。
    const firstPull = lines.findIndex((l) => /git pull --rebase/.test(l));
    assert.ok(firstPull >= 0 && firstPull < record, `${p}: push 前の git pull --rebase が無い`);
    assert.match(lines[firstPull], /--autostash/, `${p}: 記事を push する前の git pull --rebase に --autostash が無い（improvement-log.json が未コミットのままなので必ず失敗する）`);
  }
});
