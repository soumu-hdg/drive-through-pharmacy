# ドライブスルー診療 データベース連携 v0.1

## 口調
丁寧語で話すこと。

## 権限ルール
- Edit, Write, Bash等の基本操作は確認不要で実行してよい
- git push等の破壊的操作のみ確認すること
- 「Do you want to proceed?」は最小限にすること

## プロジェクト概要
- QRコード読み取りによる薬品在庫管理システム
- Google Apps Script (GAS) + Google Spreadsheet バックエンド
- GitHub Pages でデプロイ

## 主要ファイル
| ファイル | 用途 |
|---------|------|
| `index.html` | 本番用（QRカメラ版） |
| `demo.html` | デモ用（クリック選択版） |
| `gas/Code.gs` | GASバックエンド |
| `README.md` | プロジェクトドキュメント |

## デプロイ
- **GitHub Pages**: https://soumu-lgtm.github.io/drive-through-pharmacy/
- **スプレッドシート**: https://docs.google.com/spreadsheets/d/13AId0dOUOrrZLnFnZi_V4NcOo5OT9pkaFr1UJPIK02c/

## Git
- リモート: `origin` → `https://github.com/soumu-lgtm/drive-through-pharmacy.git`
- ブランチ: `main`
