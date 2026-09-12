import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// ワークフローは 2 本が複製関係にある（env の 3 行だけが違う）。柵は両方に同じものが入っていること。
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const IMPROVE = ['workflows/seo-improve.yml', '.github/workflows/seo-improve.yml'];
// 製品リポジトリ自身で動く 2 本（雛形の workflows/ ではなく、実際に cron が回る方）。
const SELF_RUN = ['.github/workflows/seo-measure.yml', '.github/workflows/seo-improve.yml'];

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

/** `jobs:` 直下の 1 ジョブの範囲だけを切り出す（ステップの並びをジョブ単位で見るため）。 */
function jobSection(yaml, job) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^  ${job}:\\s*$`).test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^  \S/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

/**
 * トップレベルの `env:` ブロックを { キー: 値 } に正規化する。
 * 行末コメントと引用符は落とす。字下げが切れた行でブロックは終わり。
 */
function topEnv(yaml) {
  const env = {};
  let inside = false;
  for (const line of yaml.split('\n')) {
    if (/^env:\s*$/.test(line)) { inside = true; continue; }
    if (!inside || line.trim() === '') continue;
    if (!/^\s/.test(line)) break;
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
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

test('env 抽出のヘルパー: トップレベルの env を対に直す（行末コメント・引用符は落とす）', () => {
  const sample = [
    'on:',
    '  schedule: []',
    'env:',
    '  A: sample/site   # 説明',
    "  B: '2.1.268'",
    '  C: .',
    '',
    'jobs:',
    '  x:',
    '    env:',
    '      D: 掘らない',
  ].join('\n');
  assert.deepEqual(topEnv(sample), { A: 'sample/site', B: '2.1.268', C: '.' });
});

test('定期実行が書き換えるのは selftest/site（fixtures/site はテストが読むので触らせない）', () => {
  for (const p of SELF_RUN) {
    const env = topEnv(read(p));
    assert.equal(env.SEO_REPO, 'selftest/site', `${p}: SEO_REPO`);
    assert.notEqual(env.SEO_REPO, 'fixtures/site', `${p}: 日次 cron が fixtures/site/data/seo/rank-history.jsonl を書き換え、翌日にはテストが赤くなる`);
  }
  assert.ok(existsSync(new URL('../selftest/site/seo.config.json', import.meta.url)), '自己試験用のサイトが存在しない');
});

test('ジョブ切り出しのヘルパー: 指定したジョブの範囲だけを返す（隣のジョブを巻き込まない）', () => {
  const y = read(IMPROVE[0]);
  const b = jobSection(y, 'build');
  assert.match(b, /^  build:/);
  assert.equal(/^  (think|write):/m.test(b), false, 'ジョブの境界を越えている');
  assert.equal(jobSection(y, 'nope'), '');
});

test('build ジョブは記事を当てた後・ビルドの前に updatedAt を刻む（試したバイトと push するバイトを揃える）', () => {
  for (const p of IMPROVE) {
    const steps = parseSteps(jobSection(read(p), 'build'));
    assert.ok(steps.length >= 2, `${p}: build ジョブのステップを取り出せない`);
    const stamp = steps.findIndex((s) => s.run.includes('setUpdatedAt'));
    const build = steps.findIndex((s) => s.run.includes('build.command'));
    assert.ok(stamp >= 0, `${p}: build ジョブに setUpdatedAt を呼ぶステップが無い（ビルドしたバイトと push するバイトが 1 行ずれる）`);
    assert.ok(build >= 0, `${p}: build ジョブに build.command を実行するステップが無い`);
    assert.ok(stamp < build, `${p}: updatedAt を刻むステップ（${stamp + 1} 番目）がビルド（${build + 1} 番目）より後`);
    // 刻む先は seo.config.json の frontmatter.updatedAtField（apply.mjs change と同じ既定）
    assert.match(steps[stamp].run, /updatedAtField/, `${p}: 刻むキーを seo.config.json から取っていない`);
  }
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
