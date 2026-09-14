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
 * 宣言的成果物は生の全文に正規表現をかけるのではなく、{ name, run, env } の配列という
 * 正規化した意味のモデルに直してから表明する。
 * - `- name:` の行でステップが始まり、同じ深さの次の項目かより浅い行で終わる
 * - `run: |` のブロックも `run: <その場書き>` も run に入れる（ブロックは字下げを剥がす）
 * - ステップ自身の `env:` ブロックは { キー: 値 } に正規化する（無ければ {}）
 */
function parseSteps(yaml) {
  const steps = [];
  let cur = null;        // 収集中のステップ
  let runIndent = null;  // run: ブロックを読んでいる間だけ、その run: キーの深さ
  let envIndent = null;  // env: ブロックを読んでいる間だけ、その env: キーの深さ
  const indentOf = (l) => l.match(/^ */)[0].length;
  const close = () => { if (cur) steps.push({ name: cur.name, run: cur.run.join('\n'), env: cur.env }); cur = null; };

  for (const line of yaml.split('\n')) {
    const blank = line.trim() === '';
    const indent = indentOf(line);

    // run: ブロックの中身（空行か、ブロックより深い行）
    if (cur && runIndent !== null && (blank || indent > runIndent)) {
      cur.run.push(blank ? '' : line.slice(runIndent + 2));
      continue;
    }
    runIndent = null;

    // env: ブロックの中身（ブロックより深い行）
    if (cur && envIndent !== null && !blank && indent > envIndent) {
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (m) cur.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    envIndent = null;

    // 同じ深さの次の項目、またはより浅い行でステップは終わる
    if (cur && !blank && (indent < cur.indent || (indent === cur.indent && /^\s*- /.test(line)))) close();

    const start = line.match(/^( *)- name:\s*(.*)$/);
    if (start) { cur = { indent: start[1].length, name: start[2].trim(), run: [], env: {} }; continue; }
    if (!cur || blank) continue;

    const env = line.match(/^( *)env:\s*$/);
    if (env) { envIndent = env[1].length; continue; }

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
    { name: '一つ目', run: 'echo あ\n\necho い', env: { X: '1' } },
    { name: '二つ目', run: 'echo う', env: {} },
    { name: '三つ目', run: 'echo え', env: {} },
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
    // Write はパスで絞れない: `Write(/path/**)` は file permission checks に使われず（CLI が明示）、
    // `Write` と `Edit(/path/**)` の併記でも範囲外に書けてしまう（2026-09-12 実測）。柵は素の Write を許可し、
    // 実効的な検査は直後の「AI がリポジトリに触れていないことを確かめる」ステップに委ねる。
    assert.equal(allowed, 'WebSearch,WebFetch,Write', `${p}: Write をパスで絞ろうとしている（実測では書き込みそのものが失敗する）`);
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

test('ファイルパスは env 経由で渡す。run: のシェル本文に needs.think.outputs.file を直接展開しない（スクリプトインジェクション対策・両方の YAML）', () => {
  for (const p of IMPROVE) {
    const buildSteps = parseSteps(jobSection(read(p), 'build'));
    const writeSteps = parseSteps(jobSection(read(p), 'write'));
    const targets = [
      { label: 'build: updatedAt を刻む', i: buildSteps.findIndex((s) => s.run.includes('setUpdatedAt')), steps: buildSteps },
      { label: 'write: 変更を書き戻す', i: writeSteps.findIndex((s) => s.run.includes('record-sha')), steps: writeSteps },
      { label: 'write: 公開を確認する', i: writeSteps.findIndex((s) => s.run.includes('verify_publish.mjs')), steps: writeSteps },
    ];
    for (const { label, i, steps } of targets) {
      assert.ok(i >= 0, `${p} (${label}): ステップが見つからない`);
      const step = steps[i];
      assert.equal(step.env.FILE, '${{ needs.think.outputs.file }}', `${p} (${label}): env.FILE が needs.think.outputs.file に束ねられていない`);
      assert.equal(step.run.includes('needs.think.outputs.file'), false, `${p} (${label}): run: のシェル本文に needs.think.outputs.file が直接展開されている`);
      assert.ok(step.run.includes('$FILE'), `${p} (${label}): run: が $FILE を参照していない`);
    }
  }
});

test('記事のコミットとログのコミットは、どちらも最初の push より前にある（記事だけ公開されログが残らない窓を塞ぐ・両方の YAML）', () => {
  for (const p of IMPROVE) {
    const steps = stepsOf(p);
    // 「変更を書き戻す」ステップは record-sha も含むので、既存の表明と同じ探し方で拾える
    const i = stepIndex(steps, 'record-sha');
    assert.ok(i >= 0, `${p}: 変更を書き戻すステップが無い`);
    const lines = steps[i].run.split('\n');
    const push = lines.findIndex((l) => /(^|\s)git push(\s|$)/.test(l));
    const articleCommit = lines.findIndex((l) => l.includes('seo: improve'));
    const logCommit = lines.findIndex((l) => l.includes('seo: record') && !l.includes('record sha'));
    assert.ok(push >= 0, `${p}: git push が見つからない`);
    assert.ok(articleCommit >= 0, `${p}: 記事のコミット（seo: improve）が見つからない`);
    assert.ok(logCommit >= 0, `${p}: ログのコミット（seo: record）が見つからない`);
    assert.ok(articleCommit < push, `${p}: 記事のコミット（${articleCommit + 1} 行目）が最初の push（${push + 1} 行目）より後`);
    assert.ok(logCommit < push, `${p}: ログのコミット（${logCommit + 1} 行目）が最初の push（${push + 1} 行目）より後。ここが push より後だと、2 回目の push 失敗やジョブ停止で記事だけ本番に残り improvement-log.json には何も記録が残らない`);
  }
});
