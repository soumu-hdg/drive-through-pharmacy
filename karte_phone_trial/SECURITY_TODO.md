# 電子カルテ v0.9 セキュリティ改善TODO

作成日: 2026-06-09
ステータス: 未着手（後日実装予定）

---

## 1. XSS対策 — innerHTML → textContent/DOM API 置換（優先度: 高）

### 現状
- `app.js`: 38箇所の `.innerHTML =` 使用
- `auth.js`: 4箇所
- `db_integration.js`: 7箇所
- **合計49箇所**がXSS脆弱性の潜在的リスク

### 対応方針
- ユーザー入力を含む箇所（患者名、メモ、問診内容等）を優先的に修正
- 固定HTML（UI部品）はリスク低いが、段階的に置換
- `escapeHtml()` ユーティリティ関数は `auth.js` に既存（再利用可能）

### 高リスク箇所（ユーザー入力を直接HTMLに埋め込み）
| ファイル | 行 | 内容 |
|---------|-----|------|
| app.js | 191 | 患者一覧テーブル（名前、メモ等を直接埋め込み） |
| app.js | 409 | QR読取エラーメッセージ |
| app.js | 1060 | 病名検索結果 |
| app.js | 1138 | 薬剤検索結果 |
| app.js | 1629 | 問診データ表示（q.symptoms, q.otherComplaints等） |
| app.js | 1872 | OCR結果表示 |

### 実装手順
1. `escapeHtml()` を `app.js` 先頭に移動（共通関数化）
2. ユーザー入力値を埋め込む全箇所で `escapeHtml()` を適用
3. 可能な箇所は `textContent` や `createElement` + `appendChild` に置換
4. テスト: 患者名に `<script>alert(1)</script>` を入れて確認

---

## 2. Content Security Policy (CSP) ヘッダー追加（優先度: 高）

### 現状
- CSPヘッダー/メタタグなし
- インラインイベントハンドラ: onclick 95箇所、onchange/oninput等 20箇所
- インラインscriptタグ: 使用中

### 対応方針（段階的）

#### Phase 1: レポートモード
```html
<meta http-equiv="Content-Security-Policy-Report-Only"
  content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src https://dyjhxkqzxibcpgoefbiv.supabase.co https://script.google.com;">
```

#### Phase 2: インラインハンドラ除去
- 115箇所の `onclick=`/`onchange=` 等を `addEventListener` に移行
- これが最大の作業量（app.js全体のリファクタリング）

#### Phase 3: 本番CSP適用
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src https://dyjhxkqzxibcpgoefbiv.supabase.co https://script.google.com; img-src 'self' data: blob:; frame-src 'none';">
```

---

## 3. セッション管理の強化（優先度: 中）

### 現状
- Supabase Auth のデフォルト設定（localStorage にトークン保存）
- セッションタイムアウト: Supabaseデフォルト（1時間アクセストークン + リフレッシュ）
- 無操作タイムアウトなし

### 対応
- **無操作タイムアウト**: 30分無操作でログアウト（医療情報保護）
```javascript
let lastActivity = Date.now();
document.addEventListener('click', () => lastActivity = Date.now());
document.addEventListener('keydown', () => lastActivity = Date.now());
setInterval(() => {
  if (Date.now() - lastActivity > 30 * 60 * 1000) {
    handleLogout();
    alert('セキュリティのため自動ログアウトしました');
  }
}, 60000);
```
- **タブ非表示時のロック**: `visibilitychange` イベントで画面ロック

---

## 4. 入力バリデーション強化（優先度: 中）

### 現状
- クライアントサイドの入力検証が最小限
- 保険番号、電話番号等の形式チェックが一部のみ

### 対応
- 患者名: 文字種制限（日本語/英数のみ、記号制限）
- 電話番号: 正規表現 `/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/`
- 保険者番号: 桁数＋チェックデジット
- メモ/所見: 最大文字数制限（5000文字）
- 処方数量: 上限チェック（例: 1日量99以下）

---

## 5. 監査ログ（Audit Log）（優先度: 中）

### 現状
- 誰がいつ何を変更したかの記録なし

### 対応
- Supabaseに `audit_logs` テーブル作成
```sql
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,        -- 'create_patient', 'update_karte', 'delete_rx' 等
  target_type text,            -- 'patient', 'karte', 'prescription'
  target_id text,
  details jsonb,               -- 変更前後の値
  ip_address text,
  created_at timestamptz DEFAULT now()
);
```
- カルテ保存/患者登録/処方変更時にログ挿入
- RLSで一般ユーザーはINSERTのみ、adminのみSELECT可

---

## 6. HTTPS強制 + Subresource Integrity（優先度: 低）

### 現状
- GitHub PagesはHTTPS強制済み（問題なし）
- CDNスクリプト（Supabase SDK等）にSRIハッシュなし

### 対応
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
  integrity="sha384-XXXX..."
  crossorigin="anonymous"></script>
```

---

## 7. エラーメッセージの情報漏洩防止（優先度: 低）

### 現状
- エラーメッセージにサーバー内部情報（テーブル名、カラム名等）が表示される場合あり

### 対応
- ユーザー向け: 汎用エラーメッセージ（「データの保存に失敗しました」）
- 開発者向け: `console.error()` に詳細を出力
- 本番環境判定: `location.hostname.includes('github.io')` で切替

---

## 8. Supabase RLS 追加強化（優先度: 低）

### 現状（v0.9で実装済み）
- 全23テーブルRLS有効
- anon完全ブロック
- authenticated → CRUD許可

### 追加対応（将来）
- ロール別アクセス制御: `admin` のみ患者削除可
- 行レベル制限: `readonly` ロールは自分が担当した患者のみ閲覧
- カラムレベル: 保険証画像等の機微データへのアクセス制限

---

## 実装優先順位まとめ

| 順位 | 項目 | 工数目安 | リスク |
|------|------|---------|--------|
| 1 | XSS対策（innerHTML修正） | 2-3時間 | 高 |
| 2 | CSP Phase 1（レポートモード） | 30分 | 高 |
| 3 | 無操作タイムアウト | 30分 | 中 |
| 4 | 入力バリデーション | 1-2時間 | 中 |
| 5 | 監査ログ | 1-2時間 | 中 |
| 6 | CSP Phase 2-3（インライン除去） | 4-6時間 | 高 |
| 7 | SRI / エラーメッセージ | 30分 | 低 |
| 8 | RLS追加強化 | 1-2時間 | 低 |

---

## ロールバック情報

### バックアップ場所
```
C:\ClaudeWork\.claude\backups\karte_v09_before_google_oauth\
  ├── auth.js          # Google OAuth追加前
  ├── index.html       # Googleログインボタン追加前
  ├── supabase_client.js
  └── config.js
```

### Supabase Google Provider無効化手順
Management API で `external_google_enabled: false` に戻す:
```javascript
// Supabaseダッシュボードのコンソールで実行
fetch("https://api.supabase.com/v1/projects/dyjhxkqzxibcpgoefbiv/config/auth", {
  method: "PATCH",
  headers: {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ external_google_enabled: false })
});
```

### 登録済みユーザー
| メール | 表示名 | 権限 |
|--------|-------|------|
| karte@hundred-dr.com | テスト管理者 | admin |
| soumu@hundred-dr.com | ハンドレッドドクター | admin |
