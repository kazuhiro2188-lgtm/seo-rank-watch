# seo-rank-watch — 完全放置の SEO 改善ループ

対象サイトのリポジトリに差し込むと、GitHub Actions が **測定 → 1 語選ぶ → 検索意図 → 1 ファイル直す → 公開確認 → 7 日観察 → 判定（悪化は自動 revert）** を無人で回します。AI（Claude）が決めるのは「何を書き足すか」だけ。選定・検査・公開確認・判定・revert はすべてスクリプトが決めます。

設計書: `~/.company/engineering/specs/2026-09-11-seo-rank-watch-design.md`

## 対象にできるサイト

- 記事が **plain Markdown**（frontmatter 付き）で、生 HTML を無効化している
- 既定ブランチへ push すると自動デプロイされる（Vercel / Netlify / Cloudflare Pages 等）
- 金融・医療・法律（YMYL）ではない

## 導入（Google Cloud と Slack の準備が済んでいれば 30 分）

1. このリポジトリの `scripts/` と `prompts/` を、対象サイトの `.seo-rank-watch/` にコピーする
   `cp -r scripts prompts <site>/.seo-rank-watch/`
2. `<site>/seo.config.json` を書く（雛形: `fixtures/site/seo.config.json`。`deploy.type` は `git-push`、`verifyUrlTemplate` は本番 URL）
3. `<site>/data/seo/watchwords.json` に監視語を **`targetPath` 付きで**登録する
4. `node .seo-rank-watch/scripts/check_setup.mjs --repo . --with-build` を通す
5. **先に用意するもの（オーナーの作業）**
   - `claude setup-token` で OAuth トークンを発行する
   - Google Cloud でサービスアカウントを作り、JSON キーを発行する。そのメールアドレスを Search Console のプロパティに**「制限付き」**で追加する（初回は 15〜20 分かかる）
   - Slack の Incoming Webhook URL を用意する
6. **GitHub Secrets に登録する**: `CLAUDE_CODE_OAUTH_TOKEN` / `GSC_SERVICE_ACCOUNT_EMAIL` / `GSC_SERVICE_ACCOUNT_PRIVATE_KEY` / `SLACK_WEBHOOK_URL`
7. `workflows/seo-measure.yml` と `workflows/seo-improve.yml` を `<site>/.github/workflows/` にコピーし、`workflow_dispatch` で `seo-measure` を 1 回手動実行して Slack に届くことを確認する
8. `~/.company/secretary/notes/seo-rank-watch-sites.md` にサイトを 1 行足す（週次自己監査が外側から見張る）

## 人がやること

- 週次報告の先頭 3 行（Slack）を見る: 連続実行日数 / 最終公開確認日 / 鍵の経過日数
- 報告末尾の質問に答える（答えた分だけ次回の材料になる）
- `parked`（保留）と `unpublished`（公開を確認できなかった）の処理
- 75 日で `CLAUDE_CODE_OAUTH_TOKEN` と GSC 鍵を再発行し、`seo.config.json` の `keys` の日付を更新する

## 記録（すべて対象リポジトリ内）

| ファイル | 中身 | 書き手 |
|---|---|---|
| `data/seo/rank-history.jsonl` | 順位の記録（追記専用・1 行 1 窓） | 日次 |
| `data/seo/improvement-log.json` | ファイル単位の改善記録と status | 週次 |
| `data/seo/reports/YYYY-MM-DD.md` | 週次報告 | 週次 |

## 開発

`node --test`（通し試験 `tests/e2e.test.mjs` を含む）。npm 依存ゼロ。

サイトの複製は 2 つある。`fixtures/site/` は**テストが読む固定の入力**で、`selftest/site/` は**このリポジトリ自身の定期実行（`.github/workflows/`）が書き換える自己試験用**。定期実行に書き換えられるのは後者だけで、`fixtures/site/` は誰も書き換えない（書き換わるとテストが翌日に赤くなる）。
