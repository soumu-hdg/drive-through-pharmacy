# 薬品在庫管理システム v0.1

ドライブスルー診療プロジェクト - QRコードベースの在庫管理

## 概要

```
[M3 DigiKar] ──CSV──> [Google スプレッドシート] <──QR読取── [スマートフォン]
                           │
                           ├── 薬品マスタ（10種類）
                           ├── 入庫履歴
                           ├── 出庫履歴
                           ├── 在庫サマリー
                           └── 患者マスタ（M3 CSV対応）
```

## ファイル構成

```
├── index.html           # 本番WebApp（QRカメラ読み取り）
├── demo.html            # デモ版（QRクリック選択、ローカル動作可）
├── qr_generator.html    # QRコードラベル生成・印刷ツール
├── gas/
│   └── Code.gs          # Google Apps Script（v0.1 + バグ修正済み）
├── manual_flow.html     # 操作マニュアル
└── .gitignore
```

## クイックスタート

### デモ版を試す（GAS不要）

`demo.html` をブラウザで開くだけで動作します（ローカルデータ使用）。

### 本番環境セットアップ

#### 1. スプレッドシート

既存: https://docs.google.com/spreadsheets/d/13AId0dOUOrrZLnFnZi_V4NcOo5OT9pkaFr1UJPIK02c/

#### 2. GASプロジェクト

既存: https://script.google.com/home/projects/1vVktinccj0Hm43dt_bEjCPIhXbIwVyhppdCQr87a1cweCGyayYJh55Nv/edit

`gas/Code.gs` の内容をGASエディタに貼り付けてデプロイ。

#### 3. デプロイ情報（最新）

| 項目 | 値 |
|------|-----|
| バージョン | 3 |
| デプロイID | `AKfycbzK2lx3UDMxKoOdVJy53HpVSyHhMmJaVaf4Cjh90JUALwLj5aQk8_fN2ncYzVlqPZ-mCg` |
| URL | `https://script.google.com/macros/s/AKfycbzK2lx3UDMxKoOdVJy53HpVSyHhMmJaVaf4Cjh90JUALwLj5aQk8_fN2ncYzVlqPZ-mCg/exec` |

**注意**: GASは独立プロジェクトのため `openById()` を使用（`getActiveSpreadsheet()` は不可）。

## スプレッドシート構造（5シート）

| シート | 色 | 用途 |
|--------|-----|------|
| 薬品マスタ | 青 | コード、名前、フリガナ、単位、レセ電算コード、単価、発注点 |
| 入庫履歴 | 緑 | 日時、コード、薬品名、数量、単位、担当者、備考 |
| 出庫履歴 | 赤 | 日時、コード、薬品名、数量、単位、患者ID、患者名、担当者、備考 |
| 在庫サマリー | 黄 | コード、薬品名、現在庫、単位、発注点、最終更新 |
| 患者マスタ | 紫 | 患者ID、患者氏名、フリガナ、性別、生年月日、正規化氏名 |

## 使い方

### QR読み取りアプリ（index.html / demo.html）

1. **モード選択**: 入庫（仕入れ）or 出庫（処方）
2. **薬品選択**: QRスキャン or クリック選択（デモ版）
3. **数量入力**: +/-ボタンで調整
4. **患者選択**（出庫時のみ）: ID or 氏名で検索
5. **記録**: ボタンを押して在庫更新

### 患者マスタのインポート

**方法1: Google Drive経由**
- メニュー「在庫管理」→「患者マスタ」→「DriveのCSVからインポート」

**方法2: テキスト貼り付け**
- メニュー「在庫管理」→「患者マスタ」→「テキスト貼り付けでインポート」

### 患者ID自動補完
- 手動: メニュー「在庫管理」→「患者マスタ」→「患者ID自動補完」
- 自動: 毎日朝9時にトリガー実行

## バグ修正履歴（v0.0→v0.1）

- `getActiveSpreadsheet()` → `openById()` に変更（独立プロジェクト対応）
- `normalizeCode()` 追加（QR 8桁 / スプレッドシート 9桁のコード不一致対応）
- CORS対応（POST時の `Content-Type: text/plain` + リダイレクトフォロー）

## 今後の拡張予定

- 発注アラート（在庫が発注点以下でメール通知）
- 月次レポート自動生成
- 複数端末同時アクセス対応
- バーコード（JAN）読み取り対応

---

作成日: 2026-03-03 | v0.1ベースライン: 2026-03-10
