# tdr-wait-tracker

東京ディズニーランド・東京ディズニーシーのアトラクション待ち時間を自動記録するツールです。
データソースは [themeparks.wiki](https://www.themeparks.wiki/) のAPIです。

## 仕組み

- `.github/workflows/record.yml` が15分おきに `scripts/record.py` を実行し、
  その時点の全アトラクションの待ち時間・稼働状態を取得します。
- 取得結果は `data/YYYY-MM-DD.json`(JST基準の日付ごと)に追記され、
  自動でリポジトリにコミットされます。
- `index.html` / `style.css` / `app.js` はGitHub Pagesで公開する静的サイトで、
  「現在の待ち時間一覧」(themeparks.wiki APIを直接呼び出してリアルタイム表示)と
  「推移グラフ」(`data/`配下の記録データを日付指定で表示)の2画面を切り替えられます。

## セットアップ

1. このリポジトリの **Settings → Actions → General** で
   "Workflow permissions" を **Read and write permissions** にしておいてください
   (`record.yml` がデータファイルをコミットするために必要です)。
2. **Settings → Pages** で、Source を「Deploy from a branch」、
   Branch を `main` / `/(root)` に設定して保存してください。
   数分後に `https://<ユーザー名>.github.io/tdr-wait-tracker/` で公開されます。
3. `.github/workflows/record.yml` は保存した時点で有効になり、
   以降15分おきに自動実行されます。今すぐ試したい場合は
   **Actions → Record wait times → Run workflow** から手動実行できます。

## データ形式

`data/YYYY-MM-DD.json`:

```json
{
  "date": "2026-08-06",
  "records": [
    {
      "timestamp": "2026-08-06T01:00:00Z",
      "attractions": [
        {
          "id": "e3577b4a-f1d9-4ec5-aacf-b99977ea88c9",
          "name": "Big Thunder Mountain",
          "park": "TDL",
          "status": "OPERATING",
          "standbyWaitTime": 50,
          "singleRiderWaitTime": null,
          "priorityPass": null
        }
      ]
    }
  ]
}
```
