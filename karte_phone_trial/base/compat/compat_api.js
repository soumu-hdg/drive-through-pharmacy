// ===== 置き換え層（工程4・2026-09-24） compat_api.js =====
// 基準版の画面処理（renderer.js・api.js・受領版のレセプト画面）を無改変で動かすため、
// 基準版がサーバーに出す /api/v1/... の問い合わせを横取りし、統合版の Supabase（院ごとの権限つき）への読み書きに置き換える。
//   ・院は統合版と同じ（clinic_context.js。テスト用クリニックは ?clinic=test）
//   ・ログインは統合版の職員 ID（メールアドレス）とパスワード。基準版のログイン欄に入れる
//   ・まだ置き換えていない問い合わせは空の応答を返し、window.__compat.missing に記録する（画面は壊さない）
// 統合版の画面側の認証処理（auth.js）は基準版の画面では使わない（ログインは置き換え層が受け持つ）
if (typeof window.setupAuthListener !== 'function') window.setupAuthListener = function () {};
if (typeof window.initAuth !== 'function') window.initAuth = async function () {};
(function () {
  const realFetch = window.fetch.bind(window);
  const missing = new Map();
  const state = { user: null, facility: null, masters: {} };
  window.__compat = { missing, state };

  const json = (obj, status) => new Response(JSON.stringify(obj === undefined ? {} : obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const err = (status, detail) => json({ detail }, status);
  const sb = () => (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : null;
  const clinicId = () => (typeof currentClinicId === 'function' ? currentClinicId() : 'nishiharu');
  async function ready() { if (!sb() && typeof initSupabase === 'function') { try { await initSupabase(); } catch (e) { /* noop */ } } return sb(); }

  // ---- 対応表（統合版 → 基準版） ----
  const SEX = { '男': 'male', '女': 'female' };
  const STATUS = { reserved: 'reserved', waiting: 'waiting', in_progress: 'in_exam', done: 'payment_done', none: 'absent', absent: 'absent', cancel: 'cancelled', cancelled: 'cancelled' };
  function facilityOf() {
    const c = (window.ClinicCtx && ClinicCtx.info()) || { id: clinicId(), name: '' };
    return { facility_id: c.id, facility_code: c.id, facility_name: c.name, certificate_id: null, development_mode: false, password_only_mode: true };
  }
  const bp = (p) => (p && p.receipt_extra && p.receipt_extra.baseProfile) || {};   // 基準版の画面だけが使う患者の項目
  function patientRow(p) {
    return {
      id: p.id, facility_id: p.clinic_id, patient_no: p.patient_no, name: p.name, name_kana: p.name_kana || '',
      gender: SEX[String(p.sex || '').replace(/性$/, '')] || 'other', birth_date: p.dob, postal_code: bp(p).postal_code || null, address: p.address, phone1: p.phone, phone2: bp(p).phone2 || null,
      email: bp(p).email || null, emergency_contact: bp(p).emergency_contact || null, insurance_type: p.insurance_type, insurance_number: null, memo: p.memo, is_active: bp(p).is_active !== false,
      created_at: p.created_at, updated_at: p.updated_at, last_reception_date: null,
    };
  }
  function receptionRow(v, i) {
    const p = v.patients || {};
    return {
      id: v.id, patient_id: v.patient_id, reception_date: v.visit_date, reception_time: v.arrived_at || null, appointment_time: v.visit_time || null,
      status: STATUS[v.status] || 'waiting', department: v.department || '内科', doctor_id: null, doctor_name: v.doctor || null,
      reception_memo: null, reservation_memo: v.rsv_code ? '予約番号 ' + v.rsv_code : null, first_visit: v.visit_type === '新規' ? true : v.visit_type === '再診' ? false : null, previous_visit_date: null,
      insurance_id: null, public_expense_1_id: null, public_expense_2_id: null, public_expense_3_id: null,
      insurance_type_name: p.insurance_type || null, insurer_name: null, insurer_number: p.insurer_number || null, relationship: p.relationship || null,
      burden_ratio: p.copay_rate ? Math.round(Number(p.copay_rate) * 100) : null, created_at: v.created_at,
      patient_no: p.patient_no, patient_name: p.name, name_kana: p.name_kana, gender: SEX[String(p.sex || '').replace(/性$/, '')] || 'other', birth_date: p.dob,
      patient_memo: p.memo || null, source: 'reception', reception_number: i + 1,
    };
  }
  // ---- マスターの読み込み口（1か所）。名前は master/ の JSON 名、または compat/ の insurance_masters・drug_official ----
  //   既定は静的な JSON。compat_masters.js が Supabase の表から読む形に差し替える（形は同じ）
  const masterCache = new Map();
  async function masterJson(name) {
    if (!masterCache.has(name)) masterCache.set(name, (async () => {
      if (window.__compat.masterSource) { const v = await window.__compat.masterSource(name); if (v) return v; }
      const path = /^(insurance_masters|drug_official)$/.test(name) ? 'compat/' + name + '.json' : '../master/' + name + '.json';
      const r = await realFetch(path); return r.ok ? await r.json() : null;
    })());
    return masterCache.get(name);
  }
  // 公式マスターの名前の記号を、基準版と同じ CP932 の読み方にそろえる（統合版のマスター JSON は Shift_JIS の読み方で −〜‖ など）
  const CP932_CHARS = { '−': '－', '〜': '～', '‖': '∥', '¢': '￠', '£': '￡', '¬': '￢', '—': '―' };
  const cp932Name = (s) => String(s == null ? '' : s).replace(/[−〜‖¢£¬—]/g, (c) => CP932_CHARS[c]);
  async function procedures() {
    if (!state.masters.proc) {
      const all = JSON.parse(JSON.stringify((await masterJson('s_procedures')) || {}));
      Object.keys(all).forEach((k) => { all[k].name = cp932Name(all[k].name); });
      state.masters.proc = all;
    }
    return state.masters.proc;
  }

  // ---- 問い合わせごとの処理 ----
  const routes = [];
  // 同じ問い合わせ（方法と正規表現が同じ）をあとから登録したら差し替える（後から読む compat_*.js が処理を置き換えられるように）
  // 登録済みの処理を取り出す（後から読む compat_*.js が、元の処理を包んで一部の場合だけ差し替えるときに使う）
  const routeOf = (method, re) => { const r = routes.find((x) => x.method === method && String(x.re) === String(re)); return r ? r.fn : null; };
  const on = (method, re, fn) => { const i = routes.findIndex((r) => r.method === method && String(r.re) === String(re)); if (i >= 0) routes[i] = { method, re, fn }; else routes.push({ method, re, fn }); };

  on('GET', /^\/auth\/facility-context$/, async () => facilityOf());
  on('POST', /^\/auth\/login$/, async (m, q, body) => {
    const c = await ready(); if (!c) return err(503, 'データベースに接続できません');
    const { data, error } = await c.auth.signInWithPassword({ email: String(body.login_id || '').trim(), password: String(body.password || '') });
    if (error) return err(401, 'ログインIDまたはパスワードが正しくありません');
    if (window.ClinicCtx) { await ClinicCtx.loadClinics(); await ClinicCtx.loadUser(data.user); if (!ClinicCtx.canUse(clinicId())) { await c.auth.signOut(); return err(403, 'このIDは「' + ClinicCtx.nameOf(clinicId()) + '」に所属していません'); } }
    await store.ensure();   // 院の設定・台帳を DB から読み、画面本体の値も読み直させる
    state.user = { id: data.user.id, login_id: data.user.email, name: (ClinicCtx.userRow && ClinicCtx.userRow() && ClinicCtx.userRow().name) || '職員', role: 'admin', ...facilityOf(), department: '内科', is_active: true };
    return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, token_type: 'bearer', user: state.user };
  });
  on('POST', /^\/auth\/refresh$/, async () => { const c = await ready(); const { data } = await c.auth.getSession(); return data.session ? { access_token: data.session.access_token } : err(401, 'セッションが切れました'); });
  on('GET', /^\/auth\/me$/, async () => state.user || err(401, '未ログイン'));
  on('POST', /^\/auth\/logout$/, async () => { const c = await ready(); if (c) await c.auth.signOut(); state.user = null; store.reset(); return { ok: true }; });
  on('GET', /^\/facilities\/current$/, async () => ({ id: clinicId(), name: facilityOf().facility_name, ...facilityOf() }));

  on('GET', /^\/patients$/, async (m, q) => {
    const c = await ready(); const lim = Number(q.get('limit') || 50), off = Number(q.get('offset') || 0), kw = (q.get('q') || '').trim();
    let r = c.from('patients').select('*', { count: 'exact' }).eq('clinic_id', clinicId()).order('patient_no').range(off, off + lim - 1);
    if (kw) r = r.or(`patient_no.ilike.%${kw}%,name.ilike.%${kw}%,name_kana.ilike.%${kw}%,phone.ilike.%${kw}%`);
    const { data, count, error } = await r; if (error) return err(500, error.message);
    const live = (data || []).filter((r) => bp(r).is_active !== false);   // 削除（無効）にした患者は出さない
    return { total: Math.max(0, (count || 0) - ((data || []).length - live.length)), limit: lim, offset: off, data: live.map(patientRow) };
  });
  on('GET', /^\/patients\/([0-9a-f-]{36})$/, async (m) => {
    const c = await ready(); const { data, error } = await c.from('patients').select('*').eq('id', m[1]).maybeSingle();
    if (error) return err(500, error.message); if (!data) return err(404, '患者が見つかりません');
    return patientRow(data);
  });
  // 患者の登録・更新・削除（2026-09-25）: 統合版の patients 表へ。基準版と同じく、患者番号の重複・同じ氏名＋生年月日の重複は断る
  const SEX_BACK = { male: '男', female: '女', other: '不明' };
  function patientFields(b, row) {
    const o = {}, extra = Object.assign({}, (row && row.receipt_extra) || {}), prof = Object.assign({}, extra.baseProfile || {});
    if (b.name !== undefined) o.name = String(b.name || '').trim();
    if (b.name_kana !== undefined) o.name_kana = String(b.name_kana || '').trim() || null;
    if (b.gender !== undefined) o.sex = SEX_BACK[b.gender] || '不明';
    if (b.birth_date !== undefined) o.dob = b.birth_date || null;
    if (b.address !== undefined) o.address = b.address || null;
    if (b.phone1 !== undefined) o.phone = b.phone1 || null;
    if (b.memo !== undefined) o.memo = b.memo || null;
    if (b.insurance_type !== undefined && b.insurance_type) o.insurance_type = b.insurance_type;
    let touched = false;
    ['postal_code', 'phone2', 'email', 'emergency_contact'].forEach((k) => { if (b[k] !== undefined) { prof[k] = b[k] || null; touched = true; } });
    if (touched) { extra.baseProfile = prof; o.receipt_extra = extra; }
    return o;
  }
  async function duplicateOf(c, name, kana, dob, exceptId) {
    if (!name || !dob) return null;
    let r = c.from('patients').select('id,patient_no,name').eq('clinic_id', clinicId()).eq('name', name).eq('dob', dob).limit(1);
    if (exceptId) r = r.neq('id', exceptId);
    const { data } = await r; return data && data[0] ? data[0] : null;
  }
  on('POST', /^\/patients$/, async (m, q, b) => {
    const c = await ready(); const no = String(b.patient_no || '').trim();
    if (!no) return err(422, '患者番号を入力してください');
    if (!String(b.name || '').trim()) return err(422, '氏名を入力してください');
    const { data: ex } = await c.from('patients').select('id').eq('clinic_id', clinicId()).eq('patient_no', no).maybeSingle();
    if (ex) return err(400, 'この患者番号は既に登録されています');
    const dup = await duplicateOf(c, String(b.name).trim(), b.name_kana, b.birth_date, null);
    if (dup) return err(409, '同じ氏名・生年月日の患者が既に登録されています（患者番号: ' + (dup.patient_no || '-') + '、氏名: ' + dup.name + '）');
    const row = Object.assign({ clinic_id: clinicId(), patient_no: no, sex: '不明' }, patientFields(b, null));
    const { data, error } = await c.from('patients').insert(row).select('*').single();
    if (error) return err(400, '患者を登録できませんでした: ' + error.message);
    return new Response(JSON.stringify(Object.assign(patientRow(data), { message: '患者を登録しました' })), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  on('PUT', /^\/patients\/([0-9a-f-]{36})$/, async (m, q, b) => {
    const c = await ready();
    const { data: cur, error: e0 } = await c.from('patients').select('*').eq('id', m[1]).eq('clinic_id', clinicId()).maybeSingle();
    if (e0) return err(500, e0.message); if (!cur) return err(404, '患者が見つかりません');
    const o = patientFields(b, cur);
    if (o.name !== undefined || o.dob !== undefined) {
      const dup = await duplicateOf(c, o.name !== undefined ? o.name : cur.name, null, o.dob !== undefined ? o.dob : cur.dob, cur.id);
      if (dup) return err(409, '同じ氏名・生年月日の患者が既に登録されています（患者番号: ' + (dup.patient_no || '-') + '、氏名: ' + dup.name + '）');
    }
    if (!Object.keys(o).length) return patientRow(cur);
    o.updated_at = new Date().toISOString();
    const { data, error } = await c.from('patients').update(o).eq('id', cur.id).eq('clinic_id', clinicId()).select('*').single();
    if (error) return err(400, '患者を更新できませんでした: ' + error.message);
    return patientRow(data);
  });
  // 削除は基準版と同じく「無効」にするだけ（受診・カルテは残す）。一覧から外れる
  on('DELETE', /^\/patients\/([0-9a-f-]{36})$/, async (m) => {
    const c = await ready();
    const { data: cur } = await c.from('patients').select('id,receipt_extra').eq('id', m[1]).eq('clinic_id', clinicId()).maybeSingle();
    if (!cur) return err(404, '患者が見つかりません');
    const extra = Object.assign({}, cur.receipt_extra || {}); extra.baseProfile = Object.assign({}, extra.baseProfile || {}, { is_active: false, deleted_at: new Date().toISOString() });
    const { error } = await c.from('patients').update({ receipt_extra: extra }).eq('id', cur.id).eq('clinic_id', clinicId());
    if (error) return err(400, '患者を削除できませんでした: ' + error.message);
    return { message: '患者を削除しました' };
  });

  on('GET', /^\/receptions$/, async (m, q) => {
    const c = await ready(); const d = q.get('reception_date') || new Date().toISOString().slice(0, 10);
    const { data, error } = await c.from('visits').select('*,patients(*)').eq('clinic_id', clinicId()).eq('visit_date', d).order('visit_time', { ascending: true, nullsFirst: false });
    if (error) return err(500, error.message);
    return { data: (data || []).map(receptionRow) };
  });
  // 受付の作成・変更・取り消し（受付 ＝ 統合版の来院 1 件）
  const STATUS_BACK = { reserved: 'reserved', waiting: 'waiting', in_exam: 'in_progress', examined: 'in_progress', payment_waiting: 'done', payment_done: 'done', done: 'done', absent: 'absent', cancelled: 'cancelled' };
  const oneVisit = async (id) => { const c = await ready(); const { data } = await c.from('visits').select('*,patients(*)').eq('id', id).eq('clinic_id', clinicId()).maybeSingle(); return data; };
  on('POST', /^\/receptions$/, async (m, q, body) => {
    const c = await ready(); const d = body.reception_date;
    const { data: ex } = await c.from('visits').select('id').eq('clinic_id', clinicId()).eq('patient_id', body.patient_id).eq('visit_date', d).maybeSingle();
    if (ex) return receptionRow(await oneVisit(ex.id), 0);
    const { data, error } = await c.from('visits').insert({ clinic_id: clinicId(), patient_id: body.patient_id, visit_date: d, visit_time: body.appointment_time || null,
      arrived_at: body.reception_time || null, department: body.department || '内科', visit_type: body.first_visit === true ? '新規' : body.first_visit === false ? '再診' : null, status: STATUS_BACK[body.status] || 'waiting', self_pay: 0, revenue_points: 0 }).select('id').single();
    if (error) return err(400, error.message);
    return receptionRow(await oneVisit(data.id), 0);
  });
  on('GET', /^\/receptions\/([0-9a-f-]{36})$/, async (m) => { const v = await oneVisit(m[1]); return v ? receptionRow(v, 0) : err(404, '受付が見つかりません'); });
  on('PUT', /^\/receptions\/([0-9a-f-]{36})$/, async (m, q, body) => {
    const c = await ready(); const patch = {};
    if (body.status) patch.status = STATUS_BACK[body.status] || body.status;
    if (body.department) patch.department = body.department;
    if (body.appointment_time !== undefined) patch.visit_time = body.appointment_time || null;
    if (body.reception_time !== undefined) patch.arrived_at = body.reception_time || null;
    if (Object.keys(patch).length) { const { error } = await c.from('visits').update(patch).eq('id', m[1]).eq('clinic_id', clinicId()); if (error) return err(400, error.message); }
    const v = await oneVisit(m[1]); return v ? receptionRow(v, 0) : err(404, '受付が見つかりません');
  });
  on('DELETE', /^\/receptions\/([0-9a-f-]{36})$/, async (m) => {
    const c = await ready(); const { data: k } = await c.from('kartes').select('id').eq('visit_id', m[1]).limit(1);
    if (k && k.length) return err(400, 'カルテがある受付は取り消せません（先にカルテを削除してください）');
    const { error } = await c.from('visits').delete().eq('id', m[1]).eq('clinic_id', clinicId()); if (error) return err(400, error.message);
    return new Response(null, { status: 204 });
  });
  on('GET', /^\/receptions\/monthly-counts$/, async (m, q) => {
    const c = await ready(); const ym = (q.get('year') && q.get('month')) ? q.get('year') + '-' + String(q.get('month')).padStart(2, '0') : (q.get('month') || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return { counts: {} };
    const [y, mo] = ym.split('-').map(Number); const end = new Date(y, mo, 0).getDate();
    const { data } = await c.from('visits').select('visit_date').eq('clinic_id', clinicId()).gte('visit_date', ym + '-01').lte('visit_date', ym + '-' + String(end).padStart(2, '0'));
    const counts = {}; (data || []).forEach((r) => { counts[r.visit_date] = (counts[r.visit_date] || 0) + 1; });
    return { counts };
  });

  on('GET', /^\/masters\/actions\/search$/, async (m, q) => {
    const kw = cp932Name(q.get('q') || ''), lim = Number(q.get('limit') || 30); const all = await procedures();
    const hits = Object.keys(all).filter((code) => code.includes(kw) || String(all[code].name).includes(kw));
    hits.sort((a, b) => (all[a].name.startsWith(kw) ? 0 : 1) - (all[b].name.startsWith(kw) ? 0 : 1) || (all[a].name < all[b].name ? -1 : all[a].name > all[b].name ? 1 : 0));
    return hits.slice(0, lim).map((code) => ({ id: code, action_code: code, name: all[code].name, score: Math.round(parseFloat(all[code].pts) || 0), is_active: true }));
  });

  // ---- 院ごとの設定・台帳の保存先（Supabase の karte_clinic_store）----
  //   端末（localStorage）には業務のデータを置かない。次の2種類を、院ごと・キーごとの JSON として DB に置く。
  //    ① 置き換え層の設定・台帳（施設設定・自動算定の設定・自費マスター・月まとめ請求・レセプト作成履歴など。キー karte_base_…_<院ID>）
  //    ② 基準版の画面本体（renderer.js・無改変）が localStorage に置いていたもの。localStorage の読み書きのうち下の表のキーだけを
  //       DB へ振り向ける（臨床プロフィール・患者の補助情報・会計の下書き・会計済みの表示・施設のマスター・機能設定・RME の日報・
  //       行為のまとめ候補は院ごと、グラフの選択・セットの表示は職員ごと）。ログインの受け渡し（dm_access_token_bridge）は端末のまま
  //   読むときはその院の行をまとめて読み込んだものから返し、書いたものは問い合わせの応答を返す前に DB へ書く（失敗したら 500）。
  //   ログイン前は DB を読めないので空として扱い、ログイン後に画面本体の持っている値を DB から読み直させる。
  //   端末に残っていた値は、最初の 1 回だけ DB へ移してから端末から消す。
  //   DB を使うのは「_enabled」の行がある院（全院に設定済み）。無い院ではこの画面の間だけ持ち、端末にも DB にも置かない
  const ROUTE_CLINIC = [/^dm_patient_clinical_profile_v1$/, /^dm_m3_patient_auxiliary_v1$/, /^karteApp\.patientBillingData\.v1$/, /^karteApp\.completedBillingDisplayData\.v1$/,
    /^karteApp\.facility\.localMasters\.v1$/, /^dm_facility_other_settings_v1(:.*)?$/, /^dm_m3_feature_settings_v1$/, /^karteApp\.rmeDailyReport\.dismissed\./, /^karteApp\.procedureGroupSuggestions\.v1$/,
    /^karte_santei_rules_cache:/];   // 統合版の算定ルールの部品を読み込んだときの控え（院ごと）
  const ROUTE_USER = [/^dm_vital_graph_selection_v1$/, /^karteApp\.orderSetView\.v1$/];
  const LS = window.localStorage, SP = Storage.prototype, orig = { get: SP.getItem, set: SP.setItem, remove: SP.removeItem };
  const store = (() => {
    let loadedFor = null, enabled = false, cache = new Map(), pending = new Set(), removed = new Set(), userId = null;
    const own = (k) => /^karte_base_/.test(k);
    const routedKey = (k) => {
      if (ROUTE_CLINIC.some((re) => re.test(k))) return 'ls:' + k;
      if (ROUTE_USER.some((re) => re.test(k))) return userId ? 'ls:user:' + userId + ':' + k : null;
      return null;
    };
    async function ensure() {
      const cid = clinicId(); if (loadedFor === cid) return;
      const c = await ready(); if (!c) return;
      const { data: s } = await c.auth.getSession(); if (!s || !s.session) return;   // ログイン前は読まない
      userId = s.session.user.id;
      // 電話問診の記録（karte_phone_intake_…）は件数が増えるので、ログイン時の一括読み込みから外す（電話問診の画面が都度読む）
      const { data, error } = await c.from('karte_clinic_store').select('store_key,data').eq('clinic_id', cid).not('store_key', 'like', 'karte_phone_intake_%');
      if (error) throw new Error('設定・台帳を読めませんでした: ' + error.message);
      cache = new Map(); enabled = false; pending = new Set(); removed = new Set();
      (data || []).forEach((r) => { if (r.store_key === '_enabled') enabled = true; else cache.set(r.store_key, r.data); });
      loadedFor = cid;
      // 端末に残っていた値を DB へ移して端末から消す（DB にすでにある値を優先）
      const moved = [];
      for (let i = LS.length - 1; i >= 0; i--) {
        const k = LS.key(i); if (!k) continue;
        const isOwn = own(k), sk = isOwn ? (k.endsWith('_' + cid) ? k : null) : routedKey(k);
        if (!sk) continue;
        if (!cache.has(sk)) {
          const raw = orig.get.call(LS, k); let v = raw; try { v = JSON.parse(raw); } catch (e) { /* 文字列のまま */ }
          cache.set(sk, isOwn ? v : { v }); pending.add(sk);
        }
        moved.push(k);
      }
      await flush();
      if (enabled) moved.forEach((k) => orig.remove.call(LS, k));
      afterLoad.forEach((fn) => { try { fn(); } catch (e) { console.warn('[置き換え層] 読み直し', e); } });
    }
    // DB の値は ①は JSON そのもの、②は { v: 元の値（JSON として読めたものはその値・読めなければ文字列） } で持つ
    function getRaw(sk, wrapped) {
      if (!cache.has(sk)) return null;
      const d = cache.get(sk);
      if (!wrapped) return JSON.stringify(d);
      return d && typeof d.v === 'string' ? d.v : JSON.stringify(d ? d.v : null);
    }
    function setRaw(sk, v, wrapped) {
      let val = v; try { val = JSON.parse(v); } catch (e) { val = v; }
      cache.set(sk, wrapped ? { v: val } : val); removed.delete(sk); pending.add(sk);
    }
    function getItem(k) { return getRaw(k, false); }
    function setItem(k, v) { setRaw(k, v, false); }
    async function flush() {
      if (!loadedFor || !enabled || (!pending.size && !removed.size)) return;
      const c = await ready(); const now = new Date().toISOString();
      if (pending.size) {
        const rows = [...pending].map((k) => ({ clinic_id: loadedFor, store_key: k, data: cache.get(k), updated_at: now })); pending.clear();
        const { error } = await c.from('karte_clinic_store').upsert(rows, { onConflict: 'clinic_id,store_key' });
        if (error) throw new Error('設定・台帳を保存できませんでした: ' + error.message);
      }
      if (removed.size) {
        const keys = [...removed]; removed.clear();
        const { error } = await c.from('karte_clinic_store').delete().eq('clinic_id', loadedFor).in('store_key', keys);
        if (error) throw new Error('設定・台帳を消せませんでした: ' + error.message);
      }
    }
    let timer = null;
    const flushSoon = () => { clearTimeout(timer); timer = setTimeout(() => flush().catch((e) => console.error('[置き換え層]', e)), 300); };
    // 画面本体の localStorage の読み書きのうち、表のキーだけを振り向ける
    SP.getItem = function (k) { const sk = this === LS ? routedKey(String(k)) : null; return sk ? getRaw(sk, true) : orig.get.call(this, k); };
    SP.setItem = function (k, v) {
      const sk = this === LS ? routedKey(String(k)) : null;
      if (!sk) return orig.set.call(this, k, v);
      if (!loadedFor) return;   // ログイン前（DB を読む前）の書き込みは DB の値を消さないように捨てる
      setRaw(sk, String(v), true); flushSoon();   // 問い合わせを経ない書き込みなので、少し待ってまとめて DB へ
    };
    SP.removeItem = function (k) {
      const sk = this === LS ? routedKey(String(k)) : null;
      if (!sk) return orig.remove.call(this, k);
      if (!loadedFor) return;
      cache.delete(sk); pending.delete(sk); removed.add(sk); flushSoon();
    };
    const afterLoad = [];
    return { ensure, flush, getItem, setItem, onLoad(fn) { afterLoad.push(fn); },
      reset() { loadedFor = null; enabled = false; cache = new Map(); pending = new Set(); removed = new Set(); userId = null; },
      get enabled() { return enabled; }, get loadedFor() { return loadedFor; } };
  })();
  // ログイン後、画面本体がページの読み込み時（ログイン前）に端末から読んでいた値を、DB から読み直させる
  store.onLoad(() => {
    /* global facilityLocalMasters, orderSetViewState, procedureGroupSuggestions, patientBillingData, completedBillingDisplayData */
    if (typeof loadFacilityLocalMasters === 'function') facilityLocalMasters = loadFacilityLocalMasters();
    if (typeof loadOrderSetViewState === 'function') orderSetViewState = loadOrderSetViewState();
    if (typeof loadProcedureGroupSuggestions === 'function') procedureGroupSuggestions = loadProcedureGroupSuggestions();
    if (typeof loadPatientBillingDraftData === 'function') patientBillingData = loadPatientBillingDraftData();
    if (typeof loadCompletedBillingDisplayData === 'function') completedBillingDisplayData = loadCompletedBillingDisplayData();
    if (typeof loadM3FeatureSettingsFromApi === 'function') loadM3FeatureSettingsFromApi({ force: true, silent: true });
  });

  // 項目ごとの置き換え（compat_*.js）が問い合わせを足せるように出しておく
  Object.assign(window.__compat, { routes, on, json, err, ready, clinicId, realFetch, patientRow, facilityOf, cp932Name, store, masterJson, routeOf });

  // ---- 横取り ----
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const mm = url.match(/\/api\/v1(\/[^?#]*)(\?[^#]*)?/);
    if (!mm) return realFetch(input, init);
    const path = mm[1], q = new URLSearchParams(mm[2] || ''), method = (init.method || 'GET').toUpperCase();
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    for (const r of routes) {
      const m = r.method === method && path.match(r.re);
      if (m) {
        try {
          if (!path.startsWith('/auth/')) await store.ensure();
          const res = await r.fn(m, q, body);
          await store.flush();   // 設定・台帳に書いた分を応答の前に DB へ
          return res instanceof Response ? res : json(res);
        } catch (e) { console.error('[置き換え層]', method, path, e); return err(500, String(e && e.message || e)); }
      }
    }
    const key = method + ' ' + path.replace(/[0-9a-f-]{36}/g, ':id');
    missing.set(key, (missing.get(key) || 0) + 1);
    if (method === 'GET') return json({ data: [], items: [], results: [], total: 0 });
    console.error('[置き換え層] 未対応の書き込み（保存されていません）: ' + key);
    return err(501, 'この操作はまだ統合版のデータベースにつながっていないため、保存されていません（' + key + '）。管理者に連絡してください。');
  };
})();
