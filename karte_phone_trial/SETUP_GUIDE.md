# 電子カルテ v0.5 Supabase+Vercel セットアップガイド

## 前提
- Supabaseアカウント: 作成済み（プロジェクト名: hundred-dr）
- Vercelアカウント: 未作成

---

## Step 1: Vercelアカウント作成・プロジェクト作成

### 1-1. アカウント作成
1. https://vercel.com にアクセス
2. 「Sign Up」→ GitHubアカウントで連携（soumu-lgtm）
3. Hobbyプラン（無料）で開始 → 後でProに変更可能

### 1-2. プロジェクト作成（GitHubリポジトリ連携）
1. Vercelダッシュボード → 「Add New Project」
2. 「Import Git Repository」→ `soumu-lgtm/drive-through-pharmacy` を選択
3. 設定:
   - **Framework Preset**: Other（静的HTML）
   - **Root Directory**: `karte_v05_supabase`（重要！リポ全体ではなくサブフォルダ指定）
   - **Build Command**: （空欄 or `echo "no build"`）
   - **Output Directory**: `.`（ルート）
4. 「Deploy」

### 1-3. 環境変数の設定
Vercelダッシュボード → Settings → Environment Variables に以下を追加:

| Key | Value | 備考 |
|-----|-------|------|
| `SUPABASE_URL` | `https://xxxxxxx.supabase.co` | Supabase Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJI...` | Supabase Settings → API → anon public key |

**注意**: これらは `index.html` 内の環境変数注入スクリプト経由でブラウザに渡す必要がある（Step 3で対応）

---

## Step 2: Supabaseスキーマ実行

1. Supabaseダッシュボード → SQL Editor
2. `supabase_schema.sql` の内容を全文ペースト
3. 「Run」で実行
4. Table Editor で12テーブルが作成されたことを確認:
   - マスタ: drugs, diseases_master, exam_items, billing_menu, set_orders
   - 業務: patients, visits, kartes, prescriptions, diseases_assigned, exams_ordered, billing_items_used

---

## Step 3: 環境変数をフロントエンドに注入

Vercelは静的HTMLに対して直接環境変数を注入できない。
以下のいずれかの方法で対応:

### 方法A: Vercel Edge Middleware（推奨）
`karte_v05_supabase/middleware.js` を作成し、HTMLレスポンスに変数を埋め込む。
→ 次回セッションで実装予定

### 方法B: 直接埋め込み（開発用・暫定）
`index.html` の `<head>` 内に以下を追加:
```html
<script>
  window.__SUPABASE_URL__ = 'https://xxxxxxx.supabase.co';
  window.__SUPABASE_ANON_KEY__ = 'eyJhbGciOiJI...';
</script>
```
※ anon keyはブラウザ公開前提のキー（RLSで保護）なので、直接埋め込みでもセキュリティ上問題なし

---

## Step 4: マスタデータ投入

app.js内のハードコードデータをSupabaseに投入するSQLを実行:
→ `seed_master_data.sql` として次回セッションで生成予定
- drugs（20件）
- diseases_master（20件）
- exam_items（10件）
- billing_menu（30件+）
- set_orders（4件）

---

## Step 5: 動作確認

1. Vercelのプレビューデプロイで開く
2. ブラウザコンソールで以下を確認:
   - `[Supabase] 接続OK` → 正常
   - `[Supabase] URL/KEY未設定 → スプシのみモードで動作` → 環境変数未設定
3. テスト患者でカルテを保存
4. コンソールに `[Supabase] カルテ保存完了` が出れば成功
5. Supabase Table Editor で patients, visits, kartes テーブルにデータが入っていることを確認

---

## ファイル構成

```
karte_v05_supabase/
  index.html              ← supabase-js CDN + supabase_client.js 追加済み
  app.js                  ← initSupabase() + 二重書き込み追加済み
  supabase_client.js      ← NEW: Supabase接続・型変換・二重書き込み
  supabase_schema.sql     ← NEW: 12テーブルスキーマ
  db_integration.js       ← 既存（スプシDB連携、変更なし）
  style.css               ← 既存（変更なし）
  insurance_calc.js       ← 既存（クライアントのみ、変更なし）
  ocr_engine.js           ← 既存（クライアントのみ、変更なし）
  qr_decoder.js           ← 既存（クライアントのみ、変更なし）
  name_dict.js            ← 既存（クライアントのみ、変更なし）
  resizer.js              ← 既存（変更なし）
```

## 未実装（次回以降）
- [ ] Vercel環境変数→フロントエンド注入の仕組み（middleware or 直接埋め込み）
- [ ] マスタデータSeed SQL生成
- [ ] Vercelデプロイ＆動作テスト
- [ ] GitHub Pagesポータルにv0.5リンク追加
- [ ] Phase C: スプシ読み取りもSupabase経由に切り替え
- [ ] Phase D: Supabase Auth + RLS
