// ===== 置き換え層：管理まわり（本番修正・2026-09-25） compat_writes_admin.js =====
// 基準版の画面が出す管理まわりの問い合わせを、統合版の Supabase（院ごとの権限つき）に置き換える。応答の形は基準版のサーバーと同じ。
//   ・文書雛形       GET/POST/PUT/DELETE /document-templates…   院ごとの台帳（karte_clinic_store）に 1 雛形 1 行（キー karte_base_doctpl_<ID>_<院ID>）。
//                    標準の雛形（document-templates/ のファイル）は基準版と同じく画面側が持つので、施設の雛形の初期値は空
//   ・パスワード変更 POST /auth/change-password（/auth/password も同じ）  現在のパスワードを signInWithPassword で確かめてから updateUser。
//                    パスワードは保存も出力もしない。基準版の画面の「変更する」ボタンは問い合わせを出さないので、ここでこの問い合わせにつなぐ
//   ・利用者管理     GET /facility-users（一覧）・PUT /facility-users/account/:id（氏名の更新）・GET …/history（履歴）・GET …/certificates/list
//                    一覧は app_users のうちこの院に所属する職員だけ。氏名の更新は本人、またはこの院だけに所属する職員に限る。
//                    新しい職員の登録・他の職員のパスワード再設定・有効/無効の切り替え・権限やログインIDの変更・端末証明書の発行は、
//                    全院の職員台帳と認証の管理者権限が要るのでブラウザからは行わず、「管理者に依頼してください」の 403 を返す
//   ・監査ログ       GET /audit-logs  この置き換え層が残す記録（ログイン・ログアウト・パスワード変更・利用者の更新）と、
//                    受付の変更履歴、統合版のカルテ削除の記録（karte_delete_logs）を基準版の形で返す
//   ・受付の変更履歴 GET /receptions/edit-history・/receptions/edit-history/:id  受付の作成・変更・取り消し（compat_api.js の処理）を包んで、
//                    受付日ごとに台帳へ控えを残す（キー karte_base_log_rcpt_<受付日>_<院ID>・基準版と同じく約45日分）
//   ・マスターの取込情報 GET /masters/official-imports/history・/latest   karte_master_meta の件数・読込日時から
//   ・根拠資料の索引 GET /masters/receipt-rule-source-documents   compat/receipt_rule_source_documents.json（基準版の索引の写し）
//   ・市町村別の公費 GET /insurances/public-expense-municipality-rules   基準版の既定データ（愛知県54市町村 × 子ども・母子父子家庭・障害者医療）
//   記録（監査・受付の変更履歴）は、同時に書く端末どうしで消し合わないよう、書く直前に DB から読み直して足す
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, json, ready, clinicId, routeOf } = C;
  const RETENTION_DAYS = 45;          // 受付の変更履歴（基準版と同じ）
  const AUDIT_RETENTION_DAYS = 90;    // 監査の記録（台帳に置く分。長く残すには専用の表が要る）
  const nowIso = () => new Date().toISOString();
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => { const x = d instanceof Date ? d : new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
  const today = () => localDate(new Date());
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };
  const newId = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(16).slice(2));
  const created = (obj) => new Response(JSON.stringify(obj), { status: 201, headers: { 'Content-Type': 'application/json' } });
  const ASK_ADMIN = '管理者に依頼してください（この画面からは操作できません）';
  async function db() { const c = await ready(); if (!c) throw new Error('データベースに接続できません'); return c; }
  function me() {
    const r = (window.ClinicCtx && ClinicCtx.userRow && ClinicCtx.userRow()) || {}; const u = (C.state && C.state.user) || {};
    return { id: u.id || r.id || null, login_id: u.login_id || r.email || '', name: r.display_name || r.name || u.name || '', role: r.role || null, active: r.is_active !== false };
  }
  const isAdmin = () => { const m = me(); return m.role === 'admin' && m.active; };

  // ---- 院ごとの台帳を直接読み書きする（記録・雛形は画面の読み込み時の控えを使わず、毎回 DB から） ----
  async function readKey(key) {
    const c = await db(); const { data, error } = await c.from('karte_clinic_store').select('data').eq('clinic_id', clinicId()).eq('store_key', key).maybeSingle();
    if (error) throw new Error('台帳を読めませんでした: ' + error.message);
    return data ? data.data : null;
  }
  async function writeKey(key, value) {
    if (!C.store.enabled) throw new Error('この院は保存先（院ごとの台帳）が用意されていないため保存できません。管理者に連絡してください');
    const c = await db(); const u = me();
    const row = { clinic_id: clinicId(), store_key: key, data: value, updated_at: nowIso() }; if (u.id) row.updated_by = u.id;
    const { error } = await c.from('karte_clinic_store').upsert(row, { onConflict: 'clinic_id,store_key' });
    if (error) throw new Error('台帳に保存できませんでした: ' + error.message);
  }
  async function deleteKeys(keys) {
    if (!keys.length) return; const c = await db();
    const { error } = await c.from('karte_clinic_store').delete().eq('clinic_id', clinicId()).in('store_key', keys);
    if (error) throw new Error('台帳から消せませんでした: ' + error.message);
  }
  async function listKeys(prefix) {
    const c = await db(); const cid = clinicId();
    const { data, error } = await c.from('karte_clinic_store').select('store_key,data').eq('clinic_id', cid).like('store_key', prefix + '%');
    if (error) throw new Error('台帳を読めませんでした: ' + error.message);
    return (data || []).filter((r) => r.store_key.startsWith(prefix) && r.store_key.endsWith('_' + cid));
  }
  // 記録を 1 件足す（書く直前に読み直す）
  async function appendTo(key, entry) { const cur = await readKey(key); const list = Array.isArray(cur) ? cur : []; list.push(entry); await writeKey(key, list); }
  // 保存期間を過ぎた記録の行を消す（院ごとに 1 画面 1 回）
  const pruned = new Set();
  async function pruneOld() {
    const cid = clinicId(); if (pruned.has(cid) || !C.store.enabled) return; pruned.add(cid);
    const old = [];
    const re = /^karte_base_log_(rcpt|audit)_(\d{4}-\d{2}-\d{2})_/;
    (await listKeys('karte_base_log_')).forEach((r) => {
      const m = r.store_key.match(re); if (!m) return;
      if (m[2] < daysAgo(m[1] === 'rcpt' ? RETENTION_DAYS + 1 : AUDIT_RETENTION_DAYS)) old.push(r.store_key);
    });
    await deleteKeys(old);
  }

  // ============ 監査の記録 ============
  const auditKey = (date) => 'karte_base_log_audit_' + date + '_' + clinicId();
  async function audit(action, resourceType, resourceId, description, extra) {
    try {
      const u = me();
      await appendTo(auditKey(today()), Object.assign({ id: newId(), timestamp: nowIso(), action, resource_type: resourceType, resource_id: resourceId || null,
        user_id: u.id, login_id: u.login_id, user_name: u.name, user_role: u.role === 'admin' ? 'admin' : 'clerk', description: description || '', success: true }, extra || {}));
      pruneOld().catch((e) => console.warn('[置き換え層] 古い記録の整理', e));
    } catch (e) { console.warn('[置き換え層] 監査の記録を残せませんでした', e); }
  }
  // ログイン・ログアウトの記録（元の処理を包む）
  const LOGIN_RE = /^\/auth\/login$/, LOGOUT_RE = /^\/auth\/logout$/;
  const origLogin = routeOf('POST', LOGIN_RE), origLogout = routeOf('POST', LOGOUT_RE);
  if (origLogin) on('POST', LOGIN_RE, async (m, q, b) => {
    const r = await origLogin(m, q, b);
    if (!(r instanceof Response) && C.store.enabled) await audit('LOGIN', 'user', r && r.user && r.user.id, 'ログイン');
    return r;
  });
  if (origLogout) on('POST', LOGOUT_RE, async (m, q, b) => {
    if (C.state && C.state.user && C.store.enabled) await audit('LOGOUT', 'user', C.state.user.id, 'ログアウト');
    return origLogout(m, q, b);
  });

  // ============ 1. 文書雛形 ============
  const TPL_PREFIX = 'karte_base_doctpl_';
  const tplKey = (id) => TPL_PREFIX + id + '_' + clinicId();
  const TPL_FIELDS = ['display_name', 'original_name', 'file_name', 'content_type', 'size', 'data_url', 'template_type'];
  const tplOut = (t) => ({ id: t.id, display_name: t.display_name, original_name: t.original_name, file_name: t.file_name ?? null, content_type: t.content_type ?? null,
    size: t.size ?? null, data_url: t.data_url, template_type: t.template_type ?? null, created_at: t.created_at || null, updated_at: t.updated_at || null });
  const extOf = (name) => { const s = String(name || '').trim().toLowerCase(); return s.includes('.') ? s.split('.').pop() : ''; };
  const badExt = (name) => !['docx', 'xlsx'].includes(extOf(name));
  const EXT_MSG = '文書ひな形は .docx または .xlsx を選択してください';
  async function templates() {
    return (await listKeys(TPL_PREFIX)).map((r) => r.data).filter((t) => t && t.id && t.is_active !== false)
      .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'ja') || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }
  function tplCheck(b, partial) {
    for (const k of ['display_name', 'original_name']) {
      if (!partial || b[k] !== undefined) { const v = String(b[k] == null ? '' : b[k]); if (!v.trim() || v.length > 255) return k === 'display_name' ? '表示名を入力してください（255文字以内）' : 'ファイル名を指定してください'; }
    }
    if ((!partial || b.data_url !== undefined) && !String(b.data_url || '')) return 'ひな形ファイルを選択してください';
    if (b.size != null && !(Number(b.size) >= 0)) return 'ファイルの大きさが正しくありません';
    return null;
  }
  on('GET', /^\/document-templates$/, async () => (await templates()).map(tplOut));
  on('POST', /^\/document-templates$/, async (m, q, b) => {
    const bad = tplCheck(b, false); if (bad) return err(422, bad);
    if (badExt(b.original_name || b.file_name)) return err(400, EXT_MSG);
    if ((await templates()).some((t) => t.display_name === b.display_name)) return err(409, '同じ表示名の文書ひな形は登録できません');
    const u = me(), now = nowIso();
    const t = { id: newId(), display_name: b.display_name, original_name: b.original_name, file_name: b.file_name || b.original_name, content_type: b.content_type || null,
      size: b.size == null ? null : Number(b.size), data_url: b.data_url, template_type: b.template_type || 'custom', is_active: true, created_at: now, updated_at: now, created_by: u.id, updated_by: u.id };
    await writeKey(tplKey(t.id), t);
    return created(tplOut(t));
  });
  on('PUT', /^\/document-templates\/([^/]+)$/, async (m, q, b) => {
    const cur = await readKey(tplKey(m[1]));
    if (!cur || cur.is_active === false) return err(404, '文書ひな形が見つかりません');
    const bad = tplCheck(b, true); if (bad) return err(422, bad);
    if (b.display_name !== undefined && (await templates()).some((t) => t.id !== cur.id && t.display_name === b.display_name)) return err(409, '同じ表示名の文書ひな形は登録できません');
    if ((b.original_name !== undefined || b.file_name !== undefined) && badExt(b.original_name || b.file_name)) return err(400, EXT_MSG);
    const t = Object.assign({}, cur); TPL_FIELDS.forEach((k) => { if (b[k] !== undefined) t[k] = b[k]; });
    t.updated_at = nowIso(); t.updated_by = me().id;
    await writeKey(tplKey(t.id), t);
    return tplOut(t);
  });
  on('DELETE', /^\/document-templates\/([^/]+)$/, async (m) => {
    const cur = await readKey(tplKey(m[1]));
    if (!cur || cur.is_active === false) return err(404, '文書ひな形が見つかりません');
    await deleteKeys([tplKey(m[1])]);   // 基準版は無効にして残すが、ここでは中身（ファイル）ごと消す（院の台帳を読み込むたびに重くならないように）
    return { message: '文書ひな形を削除しました' };
  });

  // ============ 2. パスワード変更 ============
  async function changePasswordRoute(m, q, b) {
    const current = String((b && (b.current_password ?? b.old_password)) || ''), next = String((b && b.new_password) || '');
    if (!current || !next) return err(422, 'すべての項目を入力してください');
    if (next.length < 8) return err(422, 'パスワードは8文字以上で設定してください');
    const c = await db(); const { data: s } = await c.auth.getSession();
    const email = s && s.session && s.session.user && s.session.user.email;
    if (!email) return err(401, 'ログインし直してください');
    const { error: e1 } = await c.auth.signInWithPassword({ email, password: current });   // 現在のパスワードの確認（間違いなら変えない）
    if (e1) return err(400, '現在のパスワードが正しくありません');
    const { error: e2 } = await c.auth.updateUser({ password: next });
    if (e2) return err(400, 'パスワードを変更できませんでした: ' + e2.message);
    await audit('UPDATE', 'user', s.session.user.id, 'パスワードを変更');
    return { message: 'パスワードを変更しました' };
  }
  on('POST', /^\/auth\/change-password$/, changePasswordRoute);
  on('POST', /^\/auth\/password$/, changePasswordRoute);
  // 基準版の画面の「変更する」は問い合わせを出さずに「変更しました」と表示するだけなので、ボタンの押下をここで受けて問い合わせにつなぐ
  async function changePasswordFromScreen() {
    const val = (id) => (document.getElementById(id) || {}).value || '';
    const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type); };
    const cur = val('current-password'), next = val('new-password'), confirm = val('confirm-password');
    if (!cur || !next || !confirm) return toast('すべての項目を入力してください', 'error');
    if (next.length < 8) return toast('パスワードは8文字以上で設定してください', 'error');
    if (next !== confirm) return toast('新しいパスワードが一致しません', 'error');
    if (typeof showLoading === 'function') showLoading();
    let res = null, body = {};
    try {
      res = await fetch('/api/v1/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: cur, new_password: next }) });
      try { body = await res.json(); } catch (e) { body = {}; }
    } catch (e) { body = { detail: String(e && e.message || e) }; }
    if (typeof hideLoading === 'function') hideLoading();
    if (res && res.ok) {
      if (typeof closePasswordModal === 'function') closePasswordModal();
      toast('パスワードを変更しました', 'success');
    } else toast('パスワード変更に失敗しました: ' + (body.detail || '不明なエラー'), 'error');
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('#btn-password-save'); if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation(); changePasswordFromScreen();
  }, true);
  window.__compat.changePasswordFromScreen = changePasswordFromScreen;

  // ============ 3. 利用者管理 ============
  const baseRole = (r) => (r.role === 'admin' ? 'admin' : (['doctor', 'nurse', 'clerk'].includes(r.role) ? r.role : 'clerk'));
  async function clinicUsers() {
    const c = await db(); const cid = clinicId();
    const { data, error } = await c.from('app_users').select('id,email,display_name,role,clinics,is_active,created_at,updated_at');
    if (error) throw new Error('利用者を読めませんでした: ' + error.message);
    return (data || []).filter((r) => { const cl = Array.isArray(r.clinics) ? r.clinics : []; return cl.includes(cid) || cl.includes('*'); });
  }
  async function auditRows(fromDate, toDate) {
    const re = /^karte_base_log_audit_(\d{4}-\d{2}-\d{2})_/; const out = [];
    (await listKeys('karte_base_log_audit_')).forEach((r) => { const mm = r.store_key.match(re); if (!mm || (fromDate && mm[1] < fromDate) || (toDate && mm[1] > toDate)) return; (Array.isArray(r.data) ? r.data : []).forEach((x) => out.push(x)); });
    return out;
  }
  function userOut(r, lastLogin) {
    return { id: r.id, login_id: r.email, name: r.display_name || r.email || '', name_kana: null, email: r.email || null, role: baseRole(r), is_facility_admin: r.role === 'admin',
      is_active: r.is_active !== false, last_login_at: lastLogin || null, password_changed_at: null, created_at: r.created_at || null, updated_at: r.updated_at || r.created_at || null };
  }
  const needAdmin = () => (isAdmin() ? null : err(403, '施設管理者権限が必要です'));
  on('GET', /^\/facility-users$/, async () => {
    const no = needAdmin(); if (no) return no;
    const users = await clinicUsers(); const last = {};
    (await auditRows(null, null)).forEach((x) => { if (x.action === 'LOGIN' && x.resource_id && (!last[x.resource_id] || x.timestamp > last[x.resource_id])) last[x.resource_id] = x.timestamp; });
    const rows = users.map((r) => userOut(r, last[r.id]));
    rows.sort((a, b) => (b.is_active - a.is_active) || (b.is_facility_admin - a.is_facility_admin) || String(a.name).localeCompare(String(b.name), 'ja') || String(a.login_id).localeCompare(String(b.login_id)));
    return { data: rows };
  });
  on('POST', /^\/facility-users$/, async () => needAdmin() || err(403, '新しい職員の登録は、' + ASK_ADMIN));
  const findUser = async (id) => (await clinicUsers()).find((r) => r.id === id) || null;
  on('PUT', /^\/facility-users\/account\/([^/]+)$/, async (m, q, b) => {
    const no = needAdmin(); if (no) return no;
    const target = await findUser(m[1]); if (!target) return err(404, '利用者が見つかりません');
    const name = String((b && b.name) || '').trim(); if (!name) return err(422, 'ログインIDと利用者名は必須です');
    const email = String((b && b.email) || '').trim();
    if (email && email !== target.email) return err(403, 'ログインID（メールアドレス）の変更は、' + ASK_ADMIN);
    if ((b.role && b.role !== baseRole(target)) || (b.is_facility_admin !== undefined && !!b.is_facility_admin !== (target.role === 'admin'))) return err(403, '権限の変更は、' + ASK_ADMIN);
    const self = target.id === me().id, cl = Array.isArray(target.clinics) ? target.clinics : [];
    if (!self && !(cl.length && cl.every((x) => x === clinicId()))) return err(403, '他の院にも所属する職員の情報の変更は、' + ASK_ADMIN);
    let row = target;
    if (name !== (target.display_name || '')) {
      const c = await db();
      const { data, error } = await c.from('app_users').update({ display_name: name, updated_at: nowIso() }).eq('id', target.id).select('id,email,display_name,role,clinics,is_active,created_at,updated_at');
      if (error || !data || !data.length) return err(403, '利用者情報を更新できませんでした（' + (error ? error.message : '権限がありません') + '）。' + ASK_ADMIN);
      row = data[0];
      if (self && C.state && C.state.user) C.state.user.name = name;
      await audit('UPDATE', 'user', target.id, '施設利用者情報を更新');
    }
    return userOut(row, null);
  });
  on('GET', /^\/facility-users\/account\/([^/]+)\/history$/, async (m) => {
    const no = needAdmin(); if (no) return no;
    const target = await findUser(m[1]); if (!target) return err(404, '利用者が見つかりません');
    const logins = [], pw = [];
    if (target.created_at) { logins.push({ timestamp: target.created_at, action: '登録', login_id: target.email }); pw.push({ timestamp: target.created_at, action: '仮パスワード登録' }); }
    (await auditRows(null, null)).filter((x) => x.resource_type === 'user' && x.resource_id === target.id && x.success !== false).forEach((x) => {
      const d = x.description || '';
      if (d.includes('ログインID') && d.includes('更新')) logins.push({ timestamp: x.timestamp, action: '更新', login_id: target.email });
      if (d.includes('パスワード')) pw.push({ timestamp: x.timestamp, action: 'パスワード登録' });
    });
    const byTime = (a, b) => String(a.timestamp).localeCompare(String(b.timestamp));
    return { login_id: target.email, login_id_history: logins.sort(byTime), password_history: pw.sort(byTime) };
  });
  on('POST', /^\/facility-users\/account\/([^/]+)\/status$/, async (m, q, b) => {
    const no = needAdmin(); if (no) return no;
    const target = await findUser(m[1]); if (!target) return err(404, '利用者が見つかりません');
    if (target.id === me().id && b && b.is_active === false) return err(400, 'ログイン中の自分自身は無効にできません');
    if (!!(b && b.is_active) === (target.is_active !== false)) return { message: '利用者状態を更新しました' };
    return err(403, '職員の有効・無効の切り替えは全院の職員台帳にかかわるため、' + ASK_ADMIN);
  });
  on('POST', /^\/facility-users\/account\/([^/]+)\/reset-password$/, async () => needAdmin()
    || err(403, 'パスワードの再設定は、' + ASK_ADMIN + '。ご自身のパスワードは「パスワード変更」から変更できます'));
  on('GET', /^\/facility-users\/certificates\/list$/, async () => needAdmin() || { data: [], pending_requests: [] });
  on('POST', /^\/facility-users\/certificates\/issue-requests$/, async () => needAdmin() || err(403, '端末証明書の発行は、' + ASK_ADMIN));
  on('POST', /^\/facility-users\/certificates\/issue-requests\/([^/]+)\/cancel$/, async () => needAdmin() || err(404, '有効な証明書発行依頼が見つかりません'));
  on('POST', /^\/facility-users\/certificates\/([^/]+)\/revoke$/, async () => needAdmin() || err(404, '証明書が見つかりません'));

  // ============ 4. 受付の変更履歴 ============
  const RCPT_FIELDS = ['id', 'reservation_id', 'patient_id', 'patient_no', 'patient_name', 'name_kana', 'gender', 'birth_date', 'reception_date', 'reception_time', 'appointment_time',
    'status', 'department', 'doctor_id', 'doctor_name', 'doctor_name_override', 'insurance_id', 'insurance_type_name', 'insurer_name', 'insurer_number', 'relationship', 'burden_ratio',
    'public_expense_1_id', 'public_expense_2_id', 'public_expense_3_id', 'public_expense_1_other_amount', 'public_expense_2_other_amount', 'public_expense_3_other_amount',
    'insurance_card_status', 'medical_certificate_status', 'limit_certificate_status', 'electronic_prescription_status', 'past_prescription_status', 'labor_auto_insurance',
    'save_mode', 'reception_memo', 'first_visit', 'created_at', 'created_by_name'];
  const TRACKED = RCPT_FIELDS.filter((f) => !['id', 'patient_id', 'patient_no', 'patient_name', 'name_kana', 'gender', 'birth_date', 'reception_date', 'created_at', 'created_by_name',
    'insurance_type_name', 'insurer_name', 'insurer_number', 'relationship', 'burden_ratio'].includes(f));
  const LABELS = { status: 'ステータス', department: '診療科', doctor_id: '医師', doctor_name: '医師', doctor_name_override: '医師', insurance_id: '医療保険',
    public_expense_1_id: '公費1', public_expense_2_id: '公費2', public_expense_3_id: '公費3', public_expense_1_other_amount: '公費1自己負担金', public_expense_2_other_amount: '公費2自己負担金',
    public_expense_3_other_amount: '公費3自己負担金', insurance_card_status: '保険証確認', medical_certificate_status: '医療証確認', limit_certificate_status: '限度額認定証',
    electronic_prescription_status: '電子処方箋', past_prescription_status: '過去の処方歴', labor_auto_insurance: '労災・自賠責', save_mode: '保存区分', reception_memo: '受付メモ', first_visit: '初診/再診',
    reception_time: '受付時刻', appointment_time: '予約時刻' };
  const STATUS_LABELS = { reserved: '予約済', waiting: '受付中', exam_waiting: '診察待', in_exam: '診察中', testing: '検査中', treatment: '処置中', payment_waiting: '会計待',
    payment_done: '会計済', recalc_waiting: '再計待', absent: '不在', cancelled: '取消' };
  const CONFIRM_LABELS = { confirmed: '確認済', requested: '希望', pending: '確認待ち', unavailable: '確認不可', unchecked: '未確認', none: 'なし' };
  function fmtValue(f, v) {
    if (v == null) return '';
    if (f === 'status') return STATUS_LABELS[String(v)] || String(v);
    if (f === 'first_visit') return [true, 1, '1', 'true', 'True'].includes(v) ? '初診' : [false, 0, '0', 'false', 'False'].includes(v) ? '再診' : '';
    if (/^(insurance_card|medical_certificate|limit_certificate|electronic_prescription|past_prescription)_status$/.test(f)) return CONFIRM_LABELS[String(v)] || String(v);
    if (f === 'labor_auto_insurance') return ({ none: '保険無し', labor: '労災', auto: '自賠責' })[String(v)] || String(v);
    return String(v);
  }
  function fmtChange(f, vals) {
    if (['doctor_id', 'doctor_name', 'doctor_name_override'].includes(f)) return fmtValue(f, vals.doctor_name || vals[f]);
    if (f === 'insurance_id') return [vals.insurance_type_name, vals.insurer_name, vals.insurer_number, vals.burden_ratio != null ? vals.burden_ratio + '%' : ''].filter(Boolean).join(' ');
    return fmtValue(f, vals[f]);
  }
  function changeSummary(action, fields) {
    if (action === 'CREATE') return '受付を作成';
    if (action === 'DELETE') return '受付を取消';
    if (action === 'UPDATE') { const l = [...new Set((fields || []).filter((f) => f !== 'reception_id').map((f) => LABELS[f] || f))]; return l.length ? l.join('、') + 'を更新' : '受付を更新'; }
    return action;
  }
  const pick = (row) => { const o = {}; if (row) RCPT_FIELDS.forEach((f) => { if (f in row) o[f] = row[f] === undefined ? null : row[f]; }); return o; };
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  const rcptKey = (date) => 'karte_base_log_rcpt_' + String(date).slice(0, 10) + '_' + clinicId();
  async function logReception(action, receptionId, date, oldValues, newValues, fields) {
    try {
      const u = me();
      await appendTo(rcptKey(date), { id: newId(), timestamp: nowIso(), action, reception_id: receptionId, reception_date: String(date).slice(0, 10), user_id: u.id, user_name: u.name, login_id: u.login_id,
        changed_fields: fields || [], old_values: oldValues || {}, new_values: newValues || {}, description: changeSummary(action, fields) });
      pruneOld().catch((e) => console.warn('[置き換え層] 古い記録の整理', e));
    } catch (e) { console.warn('[置き換え層] 受付の変更履歴を残せませんでした', e); }
  }
  const ONE_RE = /^\/receptions\/([0-9a-f-]{36})$/, LIST_RE = /^\/receptions$/;
  const getOne = async (id) => { const g = routeOf('GET', ONE_RE); if (!g) return null; const r = await g(['', id], new URLSearchParams(), {}); return r instanceof Response ? null : r; };
  const origCreate = routeOf('POST', LIST_RE), origUpdate = routeOf('PUT', ONE_RE), origDelete = routeOf('DELETE', ONE_RE);
  if (origCreate) on('POST', LIST_RE, async (m, q, b) => {
    let existed = false;
    try { const c = await db(); const { data } = await c.from('visits').select('id').eq('clinic_id', clinicId()).eq('patient_id', b.patient_id).eq('visit_date', b.reception_date).limit(1); existed = !!(data && data.length); } catch (e) { existed = true; }
    const r = await origCreate(m, q, b);
    if (!existed && !(r instanceof Response) && r && r.id && C.store.enabled) await logReception('CREATE', r.id, r.reception_date || b.reception_date, {}, pick(r), []);
    return r;
  });
  if (origUpdate) on('PUT', ONE_RE, async (m, q, b) => {
    const before = await getOne(m[1]).catch(() => null);
    const r = await origUpdate(m, q, b);
    if (before && !(r instanceof Response) && r && C.store.enabled) {
      const o = pick(before), n = pick(r); const fields = TRACKED.filter((f) => !same(o[f], n[f]));
      if (fields.length) {
        const ov = {}, nv = {}; fields.forEach((f) => { ov[f] = o[f] ?? null; nv[f] = n[f] ?? null; });
        ['doctor_name', 'insurance_type_name', 'insurer_name', 'insurer_number', 'burden_ratio'].forEach((f) => { if (f in o) ov[f] = o[f]; if (f in n) nv[f] = n[f]; });
        await logReception('UPDATE', m[1], n.reception_date || o.reception_date, ov, nv, fields);
      }
    }
    return r;
  });
  if (origDelete) on('DELETE', ONE_RE, async (m, q, b) => {
    const before = await getOne(m[1]).catch(() => null);
    const r = await origDelete(m, q, b);
    const ok = r instanceof Response ? r.ok : true;
    if (ok && before && C.store.enabled) await logReception('DELETE', m[1], before.reception_date, pick(before), {}, []);
    return r;
  });
  function snapshotFromEvents(rows) {
    const s = {};
    rows.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).forEach((x) => {
      if (x.action === 'DELETE' && x.old_values && Object.keys(x.old_values).length) Object.assign(s, x.old_values);
      else if (x.new_values && Object.keys(x.new_values).length) Object.assign(s, x.new_values);
      else if (x.old_values) Object.assign(s, x.old_values);
    });
    return pick(s);
  }
  function summaryOf(id, rows, current) {   // rows は新しい順
    const latest = rows[0]; const snap = current ? pick(current) : snapshotFromEvents(rows);
    if (latest.action === 'DELETE') snap.status = 'cancelled';
    const creates = rows.filter((x) => x.action === 'CREATE');
    const createdAt = snap.created_at || (creates.length ? creates[creates.length - 1].timestamp : rows[rows.length - 1].timestamp);
    const createdBy = snap.created_by_name || (creates.length ? creates[creates.length - 1].user_name : '');
    return Object.assign({}, snap, { id: String(id), reception_id: String(id), status: snap.status || 'waiting', is_cancelled: latest.action === 'DELETE', created_at: createdAt,
      created_by_name: createdBy || '', last_edited_at: latest.timestamp, last_editor_name: latest.user_name || '', latest_action: latest.action || '',
      latest_summary: changeSummary(latest.action || '', latest.changed_fields), detail_count: rows.length });
  }
  function summaryFromSnapshot(id, row) {
    const snap = pick(row);
    return Object.assign({}, snap, { id: String(id), reception_id: String(id), status: snap.status || 'waiting', is_cancelled: false, created_at: snap.created_at || '',
      created_by_name: snap.created_by_name || '', last_edited_at: snap.created_at || '', last_editor_name: snap.created_by_name || '', latest_action: 'CREATE', latest_summary: '受付を作成', detail_count: 0 });
  }
  function detailOf(x) {
    const ov = pick(x.old_values), nv = pick(Object.assign({}, x.new_values)); const fields = x.changed_fields || [];
    const changes = x.action !== 'UPDATE' ? [] : (fields.length ? fields : [...new Set([...Object.keys(ov), ...Object.keys(nv)])].sort()).filter((f) => f !== 'reception_id' && !(fields.length && same(ov[f], nv[f])))
      .map((f) => ({ field: f, label: LABELS[f] || f, before: fmtChange(f, Object.assign({}, x.old_values)), after: fmtChange(f, Object.assign({}, x.new_values)) }));
    return { id: String(x.id), edited_at: x.timestamp, editor_name: x.user_name || '', action: x.action || '', action_label: changeSummary(x.action || '', fields), description: x.description || '',
      changes, old_values: ov, new_values: nv };
  }
  const groupRows = (events) => { const g = new Map(); events.forEach((x) => { if (!x || !x.reception_id) return; if (!g.has(x.reception_id)) g.set(x.reception_id, []); g.get(x.reception_id).push(x); }); g.forEach((l) => l.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))); return g; };
  const withinRetention = (x) => String(x.timestamp || '') >= new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString();
  on('GET', /^\/receptions\/edit-history$/, async (m, q) => {
    const target = (q.get('reception_date') || today()).slice(0, 10), lim = Math.min(Number(q.get('limit') || 100), 300), off = Number(q.get('offset') || 0);
    const events = ((await readKey(rcptKey(target))) || []).filter(withinRetention);
    const grouped = groupRows(events);
    const lr = routeOf('GET', LIST_RE); let current = [];
    if (lr) { const r = await lr(['', ''], new URLSearchParams({ reception_date: target }), {}); current = r instanceof Response ? [] : ((r && r.data) || []); }
    const cur = new Map(current.map((r) => [r.id, r]));
    const out = [];
    grouped.forEach((rows, id) => out.push(summaryOf(id, rows, cur.get(id))));
    current.forEach((r) => { if (!grouped.has(r.id)) out.push(summaryFromSnapshot(r.id, r)); });
    const list = out.filter((x) => String(x.reception_date || '').slice(0, 10) === target);
    list.sort((a, b) => String(a.appointment_time || '99:99:99').localeCompare(String(b.appointment_time || '99:99:99')) || String(a.reception_time || '99:99:99').localeCompare(String(b.reception_time || '99:99:99'))
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return { data: list.slice(off, off + lim), total: list.length, retention_days: RETENTION_DAYS };
  });
  on('GET', /^\/receptions\/edit-history\/([^/]+)$/, async (m) => {
    const id = m[1]; const current = await getOne(id).catch(() => null);
    let events = [];
    if (current && current.reception_date) events = ((await readKey(rcptKey(current.reception_date))) || []).filter((x) => x && x.reception_id === id);
    if (!events.length) (await listKeys('karte_base_log_rcpt_')).forEach((r) => (Array.isArray(r.data) ? r.data : []).forEach((x) => { if (x && x.reception_id === id) events.push(x); }));
    events = events.filter(withinRetention).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    if (!events.length) {
      if (!current) return err(404, '受付編集履歴が見つかりません');
      const snap = pick(current);
      return { reception: summaryFromSnapshot(id, current), history: [{ id: id + '-created', edited_at: snap.created_at || '', editor_name: snap.created_by_name || '', action: 'CREATE',
        action_label: '受付を作成', description: '受付情報から作成日時を表示', changes: [], old_values: {}, new_values: snap }], retention_days: RETENTION_DAYS };
    }
    return { reception: summaryOf(id, events, current), history: events.map(detailOf), retention_days: RETENTION_DAYS };
  });

  // ============ 5. 監査ログ ============
  on('GET', /^\/audit-logs$/, async (m, q) => {
    if (!isAdmin()) return err(403, '管理者権限が必要です');
    const start = q.get('start_date') || null, end = q.get('end_date') || null;
    const lim = Math.min(Number(q.get('limit') || 100), 500), off = Math.max(0, Number(q.get('offset') || 0));
    const inRange = (ts) => { const d = localDate(ts); return (!start || d >= start) && (!end || d <= end); };
    const rows = (await auditRows(start, end)).filter((x) => inRange(x.timestamp));
    (await listKeys('karte_base_log_rcpt_')).forEach((r) => (Array.isArray(r.data) ? r.data : []).forEach((x) => {
      if (!x || !inRange(x.timestamp)) return; const v = Object.assign({}, x.old_values, x.new_values);
      rows.push({ id: x.id, timestamp: x.timestamp, action: x.action, resource_type: 'reception', resource_id: x.reception_id, user_id: x.user_id, login_id: x.login_id || '', user_name: x.user_name || '',
        description: x.description || changeSummary(x.action, x.changed_fields), patient_no: v.patient_no || null, patient_name: v.patient_name || null,
        old_values: x.old_values || {}, new_values: x.new_values || {}, success: true });
    }));
    try {
      const c = await db(); let r = c.from('karte_delete_logs').select('*').eq('clinic_id', clinicId()).order('deleted_at', { ascending: false }).limit(2000);
      if (start) r = r.gte('deleted_at', new Date(start + 'T00:00:00').toISOString());
      if (end) { const e = new Date(end + 'T00:00:00'); e.setDate(e.getDate() + 1); r = r.lt('deleted_at', e.toISOString()); }
      const { data } = await r;
      (data || []).forEach((x) => rows.push({ id: x.id, timestamp: x.deleted_at, action: 'DELETE', resource_type: 'karte', resource_id: x.karte_ref || null, user_id: null, login_id: '', user_name: x.operator || '',
        description: ['カルテを削除', x.reason, x.detail].filter(Boolean).join(' '), patient_no: x.patient_no || null, patient_name: null, old_values: {}, new_values: {}, success: true }));
    } catch (e) { console.warn('[置き換え層] カルテ削除の記録を読めませんでした', e); }
    const f = { user_id: q.get('user_id'), resource_type: q.get('resource_type'), resource_id: q.get('resource_id'), action: q.get('action') };
    const hit = rows.filter((x) => Object.keys(f).every((k) => !f[k] || String(x[k] || '') === f[k]));
    hit.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { data: hit.slice(off, off + lim) };
  });

  // ============ 6. マスターの取込情報・根拠資料 ============
  const MASTER_LABELS = { s_procedures: '診療行為マスター', y_drugs: '医薬品マスター', b_diseases: '傷病名マスター', z_modifiers: '修飾語マスター', drug_official: '医薬品マスター（薬価基準）',
    proc_kubun: '診療行為の区分', beppyo1_codes: '別表Ⅰ（レセプト記載事項）', insurance_masters: '保険・公費の種別', general_prescription_master: '一般名処方マスタ' };
  async function masterRuns() {
    const c = await db(); const { data, error } = await c.from('karte_master_meta').select('name,row_count,meta,loaded_at');
    if (error) throw new Error('マスターの取込情報を読めませんでした: ' + error.message);
    return (data || []).map((r) => {
      const meta = (r.meta && typeof r.meta === 'object') ? r.meta : {}; const head = meta.head || {};
      const file = String(r.name).startsWith('file:') ? String(r.name).slice(5) : null;
      return { id: r.name, master_key: r.name, master_label: MASTER_LABELS[r.name] || (file ? 'マスターファイル ' + file : r.name), table_name: file ? 'karte_master_files' : 'karte_master_' + r.name,
        source_filename: head.source || meta.source_file || file || null, source_version: meta.version || null, source_sha256: meta.sha256 || null, dry_run: false, status: 'success',
        parsed_count: r.row_count, imported_count: r.row_count, before_count: null, after_count: r.row_count, new_count: null, retained_count: null, deactivated_count: null,
        diff_summary: {}, error_message: null, started_at: r.loaded_at, finished_at: r.loaded_at };
    });
  }
  on('GET', /^\/masters\/official-imports\/history$/, async (m, q) => {
    const key = q.get('master_key'), st = q.get('status'), lim = Math.min(Number(q.get('limit') || 50), 200);
    return (await masterRuns()).filter((r) => (!key || r.master_key === key) && (!st || r.status === st))
      .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, lim);
  });
  on('GET', /^\/masters\/official-imports\/latest$/, async () => (await masterRuns()).map((r) => { const o = Object.assign({}, r); delete o.id; delete o.source_sha256; return o; })
    .sort((a, b) => String(a.master_key).localeCompare(String(b.master_key))));
  let sourceDocs = null;
  const nfkc = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().trim();
  on('GET', /^\/masters\/receipt-rule-source-documents$/, async (m, q) => {
    if (!sourceDocs) { try { const r = await C.realFetch('compat/receipt_rule_source_documents.json'); sourceDocs = r.ok ? await r.json() : null; } catch (e) { sourceDocs = null; } }
    const d = sourceDocs || { version: '', source_page: null, description: null, items: [] };
    const kw = nfkc(q.get('q')), cat = nfkc(q.get('category')), lim = Math.min(Number(q.get('limit') || 100), 500);
    const text = (it) => nfkc(['document_id', 'category', 'title', 'notice_number', 'source_url', 'local_reference_path', 'use'].map((k) => it[k] || '').join(' '));
    const hit = (d.items || []).filter((it) => (!cat || nfkc(it.category) === cat) && (!kw || text(it).includes(kw)));
    return { version: String(d.version || ''), source_page: d.source_page || null, description: d.description || null, total: hit.length, items: hit.slice(0, lim) };
  });

  // ============ 7. 市町村別の公費（基準版の既定データ） ============
  const AICHI = [['231002', '名古屋市'], ['232017', '豊橋市'], ['232025', '岡崎市'], ['232033', '一宮市'], ['232041', '瀬戸市'], ['232050', '半田市'], ['232068', '春日井市'], ['232076', '豊川市'],
    ['232084', '津島市'], ['232092', '碧南市'], ['232106', '刈谷市'], ['232114', '豊田市'], ['232122', '安城市'], ['232131', '西尾市'], ['232149', '蒲郡市'], ['232157', '犬山市'], ['232165', '常滑市'],
    ['232173', '江南市'], ['232190', '小牧市'], ['232203', '稲沢市'], ['232211', '新城市'], ['232220', '東海市'], ['232238', '大府市'], ['232246', '知多市'], ['232254', '知立市'], ['232262', '尾張旭市'],
    ['232271', '高浜市'], ['232289', '岩倉市'], ['232297', '豊明市'], ['232301', '日進市'], ['232319', '田原市'], ['232327', '愛西市'], ['232335', '清須市'], ['232343', '北名古屋市'], ['232351', '弥富市'],
    ['232360', 'みよし市'], ['232378', 'あま市'], ['232386', '長久手市'], ['233021', '東郷町'], ['233421', '豊山町'], ['233617', '大口町'], ['233625', '扶桑町'], ['234249', '大治町'], ['234257', '蟹江町'],
    ['234273', '飛島村'], ['234419', '阿久比町'], ['234427', '東浦町'], ['234451', '南知多町'], ['234460', '美浜町'], ['234478', '武豊町'], ['235016', '幸田町'], ['235610', '設楽町'], ['235628', '東栄町'], ['235636', '豊根村']];
  const AICHI_TYPES = [['aichi_child', '81', '子ども医療', 1], ['aichi_single_parent', '82', '母子父子家庭医療', 2], ['aichi_disabled', '83', '障害者医療', 3]];
  const AICHI_REMARKS = '愛知県内の医療機関では原則現物給付として扱う初期値。対象年齢、所得制限、薬局・訪問看護の扱い、負担者番号は市町村資料で確認して必要に応じて上書きする。';
  // ID は市町村コードと種類から決まる固定値（患者の公費に保存した municipality_rule_id が読み込みのたびに変わらないように）
  const MUNI_RULES = [];
  AICHI.forEach(([code, name], i) => AICHI_TYPES.forEach(([type, law, label, ts]) => MUNI_RULES.push({
    id: '23000000-0000-4000-8000-' + code + '00000' + ts, prefecture_code: '23', municipality_code: code, municipality_name: name, expense_type: type, law_number: law, rule_name: name + ' ' + label,
    payer_number: null, payer_number_prefix: null, default_burden_ratio: 0, default_monthly_limit: 0, default_daily_limit: null, default_per_visit_limit: null, default_count_limit_per_day: null,
    default_count_limit_per_month: null, default_day_limit_per_month: null, claim_target: 'medical', prescription_claim_target: 'same_as_medical', patient_scope: 'outpatient_inpatient',
    payer_number_required: true, recipient_number_required: true, requires_local_confirmation: true, remarks: AICHI_REMARKS, valid_from: null, valid_until: null, sort_order: (i + 1) * 10 + ts })));
  on('GET', /^\/insurances\/public-expense-municipality-rules$/, async (m, q) => {
    const pref = q.get('prefecture_code'), type = q.get('expense_type'), code = q.get('municipality_code'), kw = q.get('q');
    return MUNI_RULES.filter((r) => (!pref || r.prefecture_code === pref) && (!type || r.expense_type === type) && (!code || r.municipality_code === code)
      && (!kw || r.municipality_name.includes(kw) || r.rule_name.includes(kw)))
      .sort((a, b) => a.prefecture_code.localeCompare(b.prefecture_code) || a.sort_order - b.sort_order || a.municipality_name.localeCompare(b.municipality_name, 'ja') || a.expense_type.localeCompare(b.expense_type))
      .map((r) => { const o = Object.assign({}, r); delete o.sort_order; return o; });
  });
  window.__compat.municipalityRules = MUNI_RULES;
})();
