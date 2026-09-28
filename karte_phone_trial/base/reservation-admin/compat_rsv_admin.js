// ===== 予約管理の置き換え層（2026-09-25） compat_rsv_admin.js =====
// 基準版の予約管理画面（admin.js・index.html・styles.css は受領物のまま）を動かすため、
// admin.js がサーバーに出す /api/v1/... の問い合わせを横取りし、統合版の予約システム（Supabase の rsv2_* 表）と
// 電子カルテの来院（visits）への読み書きに置き換える。admin.js より前に読む。
//   ・ログイン: 電子カルテと同じ Supabase のセッション（同じ場所に置いているので、カルテでログインしていればそのまま使える）。
//     セッションが無いときは、カルテが「予約管理」を開くときに渡すログイン情報（dm_access_token_bridge）で入る
//   ・院: 電子カルテで選んでいる院（clinic_context.js。テスト用クリニックは ?clinic=test）。予約は診療区分（cs_id）の十の位で院が決まる
//     （rsv2_karte_clinic_id と同じ対応。1=西春・2=横浜・3=千葉・4=中川・9=テスト用）。読み書きは院ごとの権限（RLS）の内側だけ
//   ・予約 → カルテの来院予定は DB のトリガー（rsv2_sync_karte）が作る。この画面は予約の状態を変えるだけで、来院の作成はしない
//   ・応答の形・検査は基準版のサーバー（server/app/routers/reservations.py）に合わせる。つないでいない問い合わせは、
//     読み取りは空、書き込みは「つながっていない」と返す（画面は壊さない。window.__rsvAdmin.missing に記録）
// 統合版で足したもの（基準版の予約管理に無い機能）: 予約の詳細（カルテ連携・保険証/医療証の画像と確認・会計・状態の変更）、
//   一覧の「カルテ」「書類」の印、60秒ごとの読み直し、予約の控え（氏名・電話）を端末の localStorage に残さない
if (typeof window.setupAuthListener !== 'function') window.setupAuthListener = function () {};
if (typeof window.initAuth !== 'function') window.initAuth = async function () {};
(function () {
  const realFetch = window.fetch.bind(window);
  const missing = new Map();
  const json = (obj, status) => new Response(JSON.stringify(obj === undefined ? {} : obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const err = (status, detail) => json({ detail }, status);
  const sb = () => (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : null;
  async function ready() { if (!sb() && typeof initSupabase === 'function') { try { await initSupabase(); } catch (e) { /* noop */ } } return sb(); }
  const clinicId = () => (typeof currentClinicId === 'function' ? currentClinicId() : 'nishiharu');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const pad = (n) => String(n).padStart(2, '0');
  const todayIso = () => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); };

  // ---- 院 ↔ 診療区分（cs_id）。DB の rsv2_karte_clinic_id と同じ対応 ----
  const CS_BASE = { nishiharu: 1, yokohama: 2, chiba: 3, nakagawa: 4, test: 9 };
  // 区分名（予約サイトの区分表と同じ。廃止した区分は過去の予約の表示用）
  const SERVICES = {
    11: '外来', 12: '在宅', 13: '美容', 14: '夜間休日', 21: '美容', 22: '外来', 23: '在宅',
    31: '外来', 32: '夜間休日', 33: '在宅', 34: '美容', 41: '外来', 42: '在宅', 43: '夜間休日',
    91: '外来', 92: '在宅', 93: '美容', 94: '夜間休日',
  };
  const RETIRED = new Set([13, 21, 32, 41]);
  const csBase = () => CS_BASE[clinicId()] || null;
  const csRange = (q) => { const b = csBase(); return q.gte('cs_id', b * 10).lt('cs_id', b * 10 + 10); };
  const serviceName = (cs) => SERVICES[cs] || '予約';
  const defaultMinutes = (cs) => (serviceName(cs) === '在宅' ? 60 : 30);
  const clinicName = () => (window.ClinicCtx ? ClinicCtx.nameOf(clinicId()) : clinicId());

  // ---- 状態の対応（予約 rsv2 × カルテの来院 visits → 基準版の予約の状態）----
  function baseStatus(r, v) {
    if (r.status === 'CANCELLED') return 'cancelled';
    if (r.status === 'NO_SHOW') return 'no_show';
    const vs = v && v.status;
    if (vs === 'done') return 'completed';
    if (r.status === 'VISITED' || vs === 'waiting' || vs === 'in_progress') return 'checked_in';
    return 'confirmed';
  }
  const VISIT_LABEL = { reserved: '予約済', waiting: '待機', in_progress: '診察中', done: '完了', none: '不在', absent: '不在', cancelled: '取消' };
  const MATCH_LABEL = { AUTO: '既存の患者に自動で名寄せ', CANDIDATE: '同じ条件の患者が複数（要確認）', NONE: '新しい患者として登録', MANUAL: '受付が手で紐付け' };
  const PAY_STATUS = { UNPAID: '未収', PAID: '支払済', PARTIAL: '一部', REFUNDED: '返金済', PENDING: '処理中', AUTHORIZED: '与信済' };
  const PAY_METHOD = { CASH: '現金', CARD: 'カード', TRANSFER: '振込', DIGISMA: '外部決済', OTHER: 'その他' };

  const addMin = (hhmm, min) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return null; const t = Number(m[1]) * 60 + Number(m[2]) + min; return pad(Math.floor(t / 60) % 24) + ':' + pad(t % 60) + ':00'; };
  const hms = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] + ':00' : '00:00:00'; };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  // 予約（rsv2）＋来院（visits）＋メニュー（rsv2_menus）を読んで、基準版の予約の形にする
  async function readReservations(opt) {
    const c = await ready(); if (!c || !csBase()) return [];
    let r = csRange(c.from('rsv2_reservations').select('*')).eq('kind', 'PATIENT');
    if (opt.code) r = r.eq('code', opt.code);
    if (opt.from) r = r.gte('rdate', opt.from);
    if (opt.to) r = r.lte('rdate', opt.to);
    if (opt.cs) r = r.eq('cs_id', opt.cs);
    r = r.order('rdate', { ascending: true }).order('rtime', { ascending: true }).limit(opt.limit || 500);
    const { data, error } = await r;
    if (error) throw new Error('予約を読めませんでした: ' + error.message);
    const rows = data || [];
    const vids = [...new Set(rows.map((x) => x.karte_visit_id).filter(Boolean))];
    const mids = [...new Set(rows.map((x) => x.menu_id).filter((x) => x != null))];
    const visits = new Map(), menus = new Map();
    if (vids.length) {
      const { data: vs, error: e2 } = await c.from('visits').select('id,status,arrived_at,visit_date,visit_time,patient_id').eq('clinic_id', clinicId()).in('id', vids);
      if (e2) throw new Error('来院を読めませんでした: ' + e2.message);
      (vs || []).forEach((v) => visits.set(v.id, v));
    }
    if (mids.length) {
      const { data: ms } = await c.from('rsv2_menus').select('id,name,duration_min,price').in('id', mids);
      (ms || []).forEach((m) => menus.set(m.id, m));
    }
    let out = rows.map((x) => toBase(x, visits.get(x.karte_visit_id) || null, menus.get(x.menu_id) || null));
    if (opt.q) { const q = String(opt.q).replace(/[\s　-]/g, ''); out = out.filter((x) => String(x.patient_name || '').replace(/[\s　]/g, '').includes(q) || String(x.patient_phone || '').replace(/-/g, '').includes(q)); }
    return out;
  }
  function toBase(x, v, menu) {
    const minutes = (menu && menu.duration_min) || defaultMinutes(x.cs_id);
    return {
      id: x.code, reservation_number: x.code, facility_id: clinicId(), patient_no: x.karte_patient_no || null,
      clinic_id: clinicId(), clinic_name: clinicName(),
      department_id: 'cs-' + x.cs_id, department_name: serviceName(x.cs_id),
      treatment_menu: menu ? String(menu.id) : null, treatment_menu_label: menu ? menu.name : null, treatment_resource_type: null,
      treatment_detail_menu: null, treatment_detail_menu_label: null, treatment_detail_price: menu && menu.price ? menu.price.toLocaleString('ja-JP') + '円' : null,
      treatment_display_label: menu ? menu.name : null,
      reservation_date: x.rdate, start_time: hms(x.rtime), end_time: addMin(x.rtime, minutes) || hms(x.rtime),
      patient_id: x.patient_id || null, patient_name: x.name || '', patient_name_kana: x.kana || null,
      patient_phone: x.phone || '', patient_email: x.email || null, patient_birthdate: isDate(x.birth) ? x.birth : null,
      status: baseStatus(x, v), symptoms: x.note || null, notes: x.payment_note || null,
      questionnaire_id: null, questionnaire_response_id: null, questionnaire_status: null, questionnaire_completed_at: null,
      insurance_card_id: x.insurance_card_path ? x.code + ':insurance_card' : null, insurance_card_status: x.insurance_card_path ? 'uploaded' : null,
      medical_certificate_id: x.iryo_card_path ? x.code + ':medical_certificate' : null, medical_certificate_status: x.iryo_card_path ? 'uploaded' : null,
      billing_id: null, billing_no: null, billing_amount: x.amount == null ? null : x.amount, billing_paid_amount: x.payment_status === 'PAID' ? x.amount : null,
      billing_payment_status: x.payment_status || null, receipt_no: null, receipt_available: false,
      created_at: x.created_at, checked_in_at: v && v.arrived_at ? x.rdate + 'T' + v.arrived_at : null, cancelled_at: null,
      // 統合版だけの項目（基準版の画面は使わない。統合版で足した詳細・印が使う）
      _rsv: {
        cs_id: x.cs_id, service: serviceName(x.cs_id), retired: RETIRED.has(x.cs_id), rstatus: x.status, channel: x.channel, visit_type: x.visit_type,
        karte_patient_no: x.karte_patient_no, karte_visit_id: x.karte_visit_id, karte_synced_at: x.karte_synced_at, karte_note: x.karte_note, match_status: x.match_status,
        visit_status: v ? v.status : null, visit_arrived_at: v ? v.arrived_at : null,
        insurance_card_path: x.insurance_card_path, iryo_card_path: x.iryo_card_path, docs_uploaded_at: x.docs_uploaded_at, docs_review: x.docs_review,
        payment_status: x.payment_status, payment_method: x.payment_method, amount: x.amount, payment_note: x.payment_note,
        consent_at: x.consent_at, consent_version: x.consent_version, menu_id: x.menu_id,
      },
    };
  }
  async function oneReservation(code) { const rows = await readReservations({ code: String(code), limit: 1 }); return rows[0] || null; }

  // 予約の状態を変える（基準版の状態 → rsv2 の状態。来院の状態はトリガーが追従。完了だけは来院を「完了」にする）
  async function setStatus(code, status) {
    const c = await ready();
    const cur = await oneReservation(code); if (!cur) return err(404, '予約が見つかりません');
    const x = cur._rsv;
    if (status === 'cancelled' || status === 'no_show') {
      // 基準版と同じく、診療記録がある受付の予約は取り消さない
      if (x.karte_visit_id) {
        const [k, p] = await Promise.all([
          c.from('kartes').select('id').eq('visit_id', x.karte_visit_id).limit(1),
          c.from('prescriptions').select('id').eq('visit_id', x.karte_visit_id).limit(1),
        ]);
        if ((k.data || []).length || (p.data || []).length) return err(409, 'カルテに記載がある予約は取り消せません。電子カルテの受付一覧で確認してください');
      }
    }
    const RS = { pending: 'CONFIRMED', confirmed: 'CONFIRMED', checked_in: 'VISITED', completed: 'VISITED', cancelled: 'CANCELLED', no_show: 'NO_SHOW' };
    const { data, error } = await csRange(c.from('rsv2_reservations').update({ status: RS[status] }).eq('code', cur.id)).select('code,status,karte_visit_id');
    if (error) return err(400, '予約を更新できませんでした: ' + error.message);
    if (!data || !data.length) return err(404, '予約が見つかりません');
    const vid = data[0].karte_visit_id;
    if (vid && status === 'completed') {
      const { error: e2 } = await c.from('visits').update({ status: 'done' }).eq('id', vid).eq('clinic_id', clinicId());
      if (e2) return err(400, 'カルテの来院を「完了」にできませんでした: ' + e2.message);
    }
    if (vid && (status === 'confirmed' || status === 'pending')) {
      // 「確定に戻す」: カルテの来院も、まだ記載が無ければ「予約済」に戻す
      const { data: v } = await c.from('visits').select('status').eq('id', vid).eq('clinic_id', clinicId()).maybeSingle();
      if (v && v.status === 'waiting') await c.from('visits').update({ status: 'reserved', arrived_at: null }).eq('id', vid).eq('clinic_id', clinicId());
    }
    return { message: 'ステータスを' + status + 'に更新しました' };
  }

  // 画像（Storage の rsv-documents）を data URL にして返す
  async function attachment(code, type) {
    const col = { insurance_card: 'insurance_card_path', medical_certificate: 'iryo_card_path' }[type];
    if (!col) return err(400, '取得できない書類種別です');
    const r = await oneReservation(code); if (!r) return err(404, '予約が見つかりません');
    const path = r._rsv[col]; if (!path) return err(404, '添付画像が見つかりません');
    const c = await ready();
    const { data: blob, error } = await c.storage.from('rsv-documents').download(path);
    if (error || !blob) return err(404, '添付画像を読めませんでした' + (error ? '（' + error.message + '）' : ''));
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    return {
      id: r.id + ':' + type, reservation_id: r.id, patient_id: r.patient_id, attachment_type: type,
      file_name: path.split('/').pop(), content_type: blob.type || 'image/jpeg', data_url: dataUrl, created_at: r._rsv.docs_uploaded_at || r.created_at,
      ocr_status: 'not_started', ocr_result: {}, ocr_confidence: null, ocr_analyzed_at: null,
      ocr_error: '画像の読み取りは電子カルテの保険証画面（OCRで読み取る）で行います。内容を確かめたら、予約の詳細の「書類を確認済みにする」を押してください。',
    };
  }

  // ---- 問い合わせごとの処理 ----
  const routes = [];
  const on = (method, re, fn) => routes.push({ method, re, fn });
  let bridge = null;   // カルテから渡されたログイン情報（読み込み時に控える。admin.js が先に消すため）
  try { const raw = localStorage.getItem('dm_access_token_bridge'); if (raw) { const d = JSON.parse(raw); if (d && d.accessToken && Number(d.expiresAt || 0) > Date.now()) bridge = d; } } catch (e) { /* noop */ }
  let meCache = null;
  async function me() {
    const c = await ready(); if (!c) return err(503, 'データベースに接続できません');
    let { data } = await c.auth.getSession();
    if (!data.session) {
      const at = bridge ? bridge.accessToken : sessionStorage.getItem('dm_access_token');
      const rt = bridge ? bridge.refreshToken : sessionStorage.getItem('dm_refresh_token');
      if (at && rt) { const r = await c.auth.setSession({ access_token: at, refresh_token: rt }); if (!r.error) data = { session: r.data.session }; }
    }
    if (!data.session) return err(401, '電子カルテにログインしてから、ユーザーメニューの「予約管理」で開いてください');
    const user = data.session.user;
    if (window.ClinicCtx) {
      await ClinicCtx.loadClinics(); await ClinicCtx.loadUser(user);
      if (!ClinicCtx.canUse(clinicId())) return err(403, 'このIDは「' + ClinicCtx.nameOf(clinicId()) + '」に所属していません');
    }
    if (!csBase()) return err(400, '「' + clinicName() + '」は予約システムにつながっていません');
    const row = window.ClinicCtx && ClinicCtx.userRow && ClinicCtx.userRow();
    meCache = { id: user.id, login_id: user.email, name: (row && row.name) || '職員', role: 'admin', is_active: true,
      facility_id: clinicId(), facility_name: clinicName(), clinic_id: clinicId(), clinic_name: clinicName(), department: '内科' };
    return meCache;
  }
  on('GET', /^\/auth\/me$/, me);
  on('POST', /^\/auth\/refresh$/, async () => { const c = await ready(); const { data } = c ? await c.auth.getSession() : { data: {} }; return data && data.session ? { access_token: data.session.access_token } : err(401, 'セッションが切れました。電子カルテでログインし直してください'); });
  on('GET', /^\/facilities\/current$/, async () => ({ id: clinicId(), facility_id: clinicId(), name: clinicName(), facility_name: clinicName(), facility_code: clinicId() }));

  // 診療科 ＝ 予約システムの診療区分（この院の区分。廃止した区分は出さない）
  on('GET', /^\/departments$/, async () => {
    const b = csBase(); if (!b) return [];
    return Object.keys(SERVICES).map(Number).filter((cs) => Math.floor(cs / 10) === b && !RETIRED.has(cs))
      .map((cs, i) => ({ id: 'cs-' + cs, name: SERVICES[cs], description: '予約サイトの診療区分', default_duration: defaultMinutes(cs), is_visible: true, is_active: true, sort_order: i + 1 }));
  });
  on('GET', /^\/reservation-calendars$/, async () => []);
  on('GET', /^\/schedules\/templates$/, async () => []);
  on('GET', /^\/reservations\/treatment-settings$/, async () => ({ menus: [], categories: [], steps: [], staff: [], rooms: [], equipment: [], resource_capacities: { doctor: 1, nurse: 2, clerk: 1 } }));
  on('GET', /^\/reservations\/review-settings$/, async () => ({ google_review_url: '' }));

  // 予約一覧（基準版: 院で絞る・date_from/date_to/status/department_id/q・limit は 200 まで）
  const VALID = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'];
  on('GET', /^\/reservations$/, async (m, q) => {
    const limit = Math.min(200, Number(q.get('limit') || 50)), offset = Math.max(0, Number(q.get('offset') || 0));
    const dept = q.get('department_id'); const cs = dept && /^cs-(\d+)$/.test(dept) ? Number(dept.slice(3)) : null;
    let rows = await readReservations({ from: q.get('date_from'), to: q.get('date_to'), q: q.get('q'), cs });
    if (q.get('status')) rows = rows.filter((r) => r.status === q.get('status'));
    return rows.slice(offset, offset + limit);
  });
  on('GET', /^\/reservations\/today$/, async () => (await readReservations({ from: todayIso(), to: todayIso() })).filter((r) => r.status !== 'cancelled'));
  on('GET', /^\/reservations\/stats\/daily$/, async (m, q) => {
    const d = q.get('target_date') || todayIso(); const rows = await readReservations({ from: d, to: d }); const by = new Map();
    rows.forEach((r) => { const k = r.department_name; const o = by.get(k) || { department_name: k, total: 0, confirmed: 0, checked_in: 0, completed: 0, cancelled: 0, no_show: 0 }; o.total++; o[r.status] = (o[r.status] || 0) + 1; by.set(k, o); });
    return { date: d, by_department: [...by.values()] };
  });
  on('GET', /^\/reservations\/([A-Za-z0-9_-]+)$/, async (m) => (await oneReservation(m[1])) || err(404, '予約が見つかりません'));
  on('PUT', /^\/reservations\/([A-Za-z0-9_-]+)\/status$/, async (m, q, b) => {
    if (!VALID.includes(b.status)) return err(400, '無効なステータスです');
    return setStatus(m[1], b.status);
  });
  on('POST', /^\/reservations\/([A-Za-z0-9_-]+)\/checkin$/, async (m) => {
    const r = await oneReservation(m[1]);
    if (!r || r.status !== 'confirmed') return err(400, 'チェックインできません');
    const res = await setStatus(m[1], 'checked_in');
    return res instanceof Response ? res : { message: 'チェックインしました' };
  });
  // 予約をカルテの患者に紐付ける（基準版の「患者確認」）。予約の患者を変えると、トリガーが来院予定をその患者へ付け替える
  on('POST', /^\/reservations\/([A-Za-z0-9_-]+)\/link-patient$/, async (m, q) => {
    const c = await ready(); const pid = q.get('patient_id');
    const { data: p } = await c.from('patients').select('id').eq('id', pid).eq('clinic_id', clinicId()).maybeSingle();
    if (!p) return err(404, '患者が見つかりません');
    const { data, error } = await csRange(c.from('rsv2_reservations').update({ patient_id: pid, match_status: 'MANUAL' }).eq('code', m[1])).select('code,karte_note');
    if (error) return err(400, '紐付けできませんでした: ' + error.message);
    if (!data || !data.length) return err(404, '予約が見つかりません');
    return { message: '患者と紐付けました' };
  });
  on('GET', /^\/reservations\/([A-Za-z0-9_-]+)\/attachments\/([a-z_]+)$/, async (m) => attachment(m[1], m[2]));
  on('GET', /^\/reservations\/([A-Za-z0-9_-]+)\/insurance-card$/, async (m) => attachment(m[1], 'insurance_card'));
  on('POST', /^\/reservations\/([A-Za-z0-9_-]+)\/attachments\/([a-z_]+)\/analyze$/, async () =>
    err(501, 'この画面では画像の読み取りはできません。電子カルテの保険証画面の「OCRで読み取る」を使ってください'));
  // 患者の検索（基準版の「患者確認」の検索欄）＝電子カルテの患者（この院）
  on('GET', /^\/patients$/, async (m, q) => {
    const c = await ready(); const kw = String(q.get('q') || '').trim().replace(/[,()]/g, ''); const lim = Math.min(100, Number(q.get('limit') || 30));
    let r = c.from('patients').select('id,patient_no,name,name_kana,dob,phone', { count: 'exact' }).eq('clinic_id', clinicId()).order('patient_no').limit(lim);
    if (kw) r = r.or(`patient_no.ilike.%${kw}%,name.ilike.%${kw}%,name_kana.ilike.%${kw}%,phone.ilike.%${kw}%`);
    const { data, count, error } = await r; if (error) return err(500, error.message);
    return { total: count || 0, limit: lim, offset: 0, data: (data || []).map((p) => ({ id: p.id, patient_no: p.patient_no, name: p.name, name_kana: p.name_kana, birth_date: p.dob, phone1: p.phone })) };
  });

  // ---- 横取り ----
  window.__rsvAdmin = { missing, routes, readReservations, oneReservation, setStatus };
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const mm = url.match(/\/api\/v1(\/[^?#]*)(\?[^#]*)?/);
    if (!mm || url.indexOf(location.origin) !== 0 && !/^\//.test(url)) return realFetch(input, init);
    const path = mm[1], q = new URLSearchParams(mm[2] || ''), method = (init.method || 'GET').toUpperCase();
    let body = {}; try { body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    for (const r of routes) {
      const m = r.method === method && path.match(r.re);
      if (m) {
        try {
          if (!/^\/auth\//.test(path) && !meCache) { const who = await me(); if (who instanceof Response) return who; }
          const res = await r.fn(m, q, body);
          return res instanceof Response ? res : json(res);
        } catch (e) { console.error('[予約管理]', method, path, e); return err(500, String(e && e.message || e)); }
      }
    }
    const key = method + ' ' + path.replace(/\/[0-9a-f-]{36}|\/[A-Z]{2,}[0-9]+/g, '/:id');
    missing.set(key, (missing.get(key) || 0) + 1);
    if (method === 'GET') return json([]);
    return err(501, 'この操作は統合版の予約システムにまだつながっていないため、保存されていません（' + key + '）。予約の状態・書類の確認・会計は、予約の詳細から操作できます');
  };

  // ---- 予約の控え（氏名・電話を含む）を端末の localStorage に残さない ----
  //   基準版は一覧を読むたびに予約を localStorage（karteApp_reservations_v1）へ控える。統合版の予約の正本は DB なので控えない
  const NO_KEEP = 'karteApp_reservations_v1';
  try {
    const SP = Storage.prototype, set0 = SP.setItem;
    SP.setItem = function (k, v) { if (this === localStorage && k === NO_KEEP) return; return set0.call(this, k, v); };
    localStorage.removeItem(NO_KEEP);
  } catch (e) { /* noop */ }

  // =====================================================================
  // 統合版で足した画面: 予約の詳細（カルテ連携・保険証/医療証・会計・状態の変更）と一覧の印
  // =====================================================================
  const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alertMsg(e.message || String(e), 'error'); } };
  function alertMsg(msg, type) { if (typeof showAlert === 'function') showAlert(msg, type || 'info'); else alert(msg); }
  function apiCall(path, opt) { return api.request(path, opt); }   /* global api, ui, handlers, showAlert */

  function ensureModal() {
    let m = document.getElementById('rsvDetailModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'rsvDetailModal'; m.className = 'modal rsvx-modal hidden'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="modal-content rsvx-content"><div class="modal-header"><h3 id="rsvDetailTitle">予約の詳細</h3>' +
      '<button type="button" class="modal-close" data-rsvx-close aria-label="閉じる">&times;</button></div><div class="rsvx-body" id="rsvDetailBody"></div></div>';
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-rsvx-close]')) closeDetail(); });
    document.body.appendChild(m);
    return m;
  }
  function closeDetail() { const m = document.getElementById('rsvDetailModal'); if (m) { m.classList.add('hidden'); m.dataset.code = ''; } }
  const dl = (rows) => '<dl class="rsvx-dl">' + rows.filter((r) => r).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>';
  const txt = (v) => (v == null || v === '' ? '<span class="rsvx-muted">―</span>' : esc(v));
  const fmtDate = (d) => { if (!isDate(d)) return d || ''; const t = new Date(d + 'T00:00:00'); return d.replace(/-/g, '/') + '（' + '日月火水木金土'[t.getDay()] + '）'; };
  const fmtAt = (s) => { if (!s) return ''; const t = new Date(s); return isNaN(t) ? String(s) : t.getFullYear() + '/' + pad(t.getMonth() + 1) + '/' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); };

  async function openDetail(code, flash) {
    const m = ensureModal(); m.dataset.code = code; m.classList.remove('hidden');
    const body = document.getElementById('rsvDetailBody'); body.innerHTML = '<p class="rsvx-muted">読み込み中…</p>';
    const r = await oneReservation(code);
    if (!r) { body.innerHTML = '<p class="rsvx-error">予約が見つかりません（この院の予約ではないか、削除されました）</p>'; return; }
    const x = r._rsv;
    document.getElementById('rsvDetailTitle').textContent = '予約の詳細　' + r.reservation_number;
    const st = '<span class="status status-' + esc(r.status) + '">' + esc(typeof utils !== 'undefined' ? utils.statusText(r.status) : r.status) + '</span>';
    const karte = x.karte_visit_id
      ? dl([['患者番号', txt(x.karte_patient_no)], ['カルテの来院予定', esc(fmtDate(r.reservation_date)) + ' ' + esc(r.start_time.slice(0, 5)) + '　<b>' + esc(VISIT_LABEL[x.visit_status] || x.visit_status || '―') + '</b>' + (x.visit_arrived_at ? '（受付 ' + esc(String(x.visit_arrived_at).slice(0, 5)) + '）' : '')],
        ['名寄せ', txt(MATCH_LABEL[x.match_status] || x.match_status)], x.karte_note ? ['連携メモ', txt(x.karte_note)] : null, ['連携した時刻', txt(fmtAt(x.karte_synced_at))]])
      : '<p class="rsvx-warn">' + esc(x.karte_note || 'カルテの来院予定はまだありません') + '</p>';
    const docs = [['insurance_card', '保険証', x.insurance_card_path], ['medical_certificate', '医療証', x.iryo_card_path]];
    const hasDocs = docs.some((d) => d[2]);
    const review = x.docs_review === 'approved' ? '<span class="rsvx-tag ok">確認済み</span>' : x.docs_review === 'rejected' ? '<span class="rsvx-tag ng">差し戻し</span>' : '<span class="rsvx-tag">未確認</span>';
    const docsHtml = hasDocs
      ? '<div class="rsvx-docs">' + docs.map(([t, label, p]) => p
          ? '<figure class="rsvx-doc"><img alt="' + label + 'の画像" data-rsvx-doc="' + esc(p) + '"><figcaption>' + label + '　<button type="button" class="btn btn-sm" data-rsvx-view="' + t + '" data-label="' + label + '">大きく見る</button></figcaption></figure>'
          : '<figure class="rsvx-doc empty"><div class="rsvx-doc-none">' + label + 'の画像なし</div></figure>').join('') + '</div>' +
        '<div class="rsvx-row">' + review + '<span class="rsvx-muted">送信 ' + esc(fmtAt(x.docs_uploaded_at)) + '</span>' +
        '<button type="button" class="btn btn-sm btn-primary" data-rsvx-review="approved">書類を確認済みにする</button>' +
        '<button type="button" class="btn btn-sm" data-rsvx-review="rejected">差し戻す</button></div>' +
        '<p class="rsvx-note">確認済みにすると、カルテの保険証画面の「予約で届いた書類」にも確認済みと出ます。保険情報は自動では書き換えません（カルテの保険証画面で OCR → 確認して保存）。</p>'
      : '<p class="rsvx-muted">予約サイトから保険証・医療証の画像は届いていません</p>';
    const payOpts = (map, cur) => '<option value="">―</option>' + Object.keys(map).filter((k) => k !== 'DIGISMA' || cur === 'DIGISMA').map((k) => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + map[k] + '</option>').join('');
    const pay = '<div class="rsvx-pay"><label>状態 <select class="input" id="rsvxPayStatus">' + payOpts(PAY_STATUS, x.payment_status) + '</select></label>' +
      '<label>方法 <select class="input" id="rsvxPayMethod">' + payOpts(PAY_METHOD, x.payment_method) + '</select></label>' +
      '<label>金額 <input class="input" id="rsvxPayAmount" type="number" min="0" step="1" value="' + (x.amount == null ? '' : esc(x.amount)) + '"> 円</label>' +
      '<button type="button" class="btn btn-sm" data-rsvx-pay>会計を保存</button></div>';
    const B = (s, label, cls) => '<button type="button" class="btn ' + (cls || '') + '" data-rsvx-status="' + s + '">' + label + '</button>';
    const actions = r.status === 'confirmed' ? B('checkin', '来院（受付へ）', 'btn-primary') + B('no_show', '無断キャンセル') + B('cancelled', '予約を取り消す', 'btn-danger')
      : r.status === 'checked_in' ? B('completed', '完了', 'btn-primary') + B('confirmed', '確定に戻す')
      : r.status === 'cancelled' || r.status === 'no_show' ? B('confirmed', '確定に戻す') : '';
    body.innerHTML = (flash ? '<p class="rsvx-flash" role="status">' + esc(flash) + '</p>' : '') +
      '<section class="rsvx-sec"><h4>予約</h4>' + dl([['予約番号', txt(r.reservation_number)], ['日時', esc(fmtDate(r.reservation_date)) + ' ' + esc(r.start_time.slice(0, 5)) + '〜' + esc(r.end_time.slice(0, 5))],
        ['診療区分', txt(x.service) + (x.retired ? '（取り扱い終了）' : '')], r.treatment_menu_label ? ['メニュー', txt(r.treatment_menu_label) + (r.treatment_detail_price ? '　' + esc(r.treatment_detail_price) : '')] : null,
        ['初診/再診', txt(x.visit_type === 'FIRST' ? '初診' : x.visit_type === 'REVISIT' ? '再診' : '')], ['受付経路', txt({ WEB: '予約サイト', STAFF: '受付', PHONE: '電話', LINE: 'LINE' }[x.channel] || x.channel)],
        ['状態', st], ['同意', txt(x.consent_at ? fmtAt(x.consent_at) + (x.consent_version ? '（' + x.consent_version + '）' : '') : '')], r.symptoms ? ['メモ', txt(r.symptoms)] : null]) + '</section>' +
      '<section class="rsvx-sec"><h4>患者</h4>' + dl([['氏名', txt(r.patient_name)], ['フリガナ', txt(r.patient_name_kana)], ['電話', txt(r.patient_phone)], ['生年月日', txt(r.patient_birthdate)], ['メール', txt(r.patient_email)]]) + '</section>' +
      '<section class="rsvx-sec"><h4>カルテ連携</h4>' + karte + '<div class="rsvx-row"><a class="btn btn-sm" id="rsvxOpenKarte" href="#">電子カルテの受付一覧で開く</a></div></section>' +
      '<section class="rsvx-sec"><h4>保険証・医療証</h4>' + docsHtml + '</section>' +
      '<section class="rsvx-sec"><h4>会計</h4>' + pay + '</section>' +
      (actions ? '<div class="rsvx-actions">' + actions + '</div>' : '');
    // 画像の表示（署名つき URL・10分）
    const c = await ready();
    body.querySelectorAll('img[data-rsvx-doc]').forEach(async (img) => {
      const { data } = await c.storage.from('rsv-documents').createSignedUrl(img.dataset.rsvxDoc, 600);
      if (data && data.signedUrl) img.src = data.signedUrl; else img.replaceWith(Object.assign(document.createElement('div'), { className: 'rsvx-doc-none', textContent: '画像を読めませんでした' }));
    });
    body.querySelectorAll('[data-rsvx-view]').forEach((b) => b.addEventListener('click', () => handlers.showReservationAttachment(code, b.dataset.rsvxView, b.dataset.label)));
    body.querySelectorAll('[data-rsvx-review]').forEach((b) => b.addEventListener('click', act(async () => {
      const v = b.dataset.rsvxReview;
      const { data, error } = await csRange(c.from('rsv2_reservations').update({ docs_review: v }).eq('code', code)).select('code');
      if (error || !data || !data.length) throw new Error('書類の確認を保存できませんでした' + (error ? ': ' + error.message : ''));
      await openDetail(code, v === 'approved' ? '書類を確認済みにしました' : '書類を差し戻しにしました'); refreshList();
    })));
    const pb = body.querySelector('[data-rsvx-pay]');
    if (pb) pb.addEventListener('click', act(async () => {
      const s = document.getElementById('rsvxPayStatus').value || null, mth = document.getElementById('rsvxPayMethod').value || null;
      const raw = document.getElementById('rsvxPayAmount').value.trim(); const amt = raw === '' ? null : Number(raw);
      if (amt != null && (!Number.isInteger(amt) || amt < 0 || amt > 10000000)) throw new Error('金額は 0〜10,000,000 の整数で入れてください');
      const row = { payment_status: s, payment_method: mth, amount: amt, paid_at: s === 'PAID' ? new Date().toISOString() : null };
      const { data, error } = await csRange(c.from('rsv2_reservations').update(row).eq('code', code)).select('code');
      if (error || !data || !data.length) throw new Error('会計を保存できませんでした' + (error ? ': ' + error.message : ''));
      await openDetail(code, '会計を保存しました');
    }));
    body.querySelectorAll('[data-rsvx-status]').forEach((b) => b.addEventListener('click', act(async () => {
      const s = b.dataset.rsvxStatus;
      const ask = { checkin: '来院として受付しますか？（カルテの受付一覧で「待機」になります）', cancelled: 'この予約を取り消しますか？（カルテの来院予定も消えます）', no_show: '無断キャンセルにしますか？（カルテの来院予定も消えます）', confirmed: '確定に戻しますか？', completed: '完了にしますか？（カルテの来院も「完了」になります）' }[s];
      if (ask && !confirm(ask)) return;
      if (s === 'checkin') await api.checkinReservation(code); else await api.updateReservationStatus(code, s);
      await openDetail(code, '予約の状態を変えました'); refreshList();
    })));
    const ok = document.getElementById('rsvxOpenKarte');
    if (ok) ok.addEventListener('click', (e) => {
      e.preventDefault();
      const u = new URL('../index.html', location.href); u.search = ''; if (/^test/.test(clinicId())) u.searchParams.set('clinic', clinicId());
      window.open(u.href, '_blank');
    });
  }
  function refreshList() { try { if (typeof ui !== 'undefined' && document.getElementById('page-reservations')?.classList.contains('active')) ui.loadReservations(); } catch (e) { /* noop */ } }

  // 一覧・タイムライン・カレンダーの予約をクリックしたら詳細を開く（ボタン・印の上は基準版の動きのまま）
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-reservation-id]');
    if (!el || e.target.closest('button, a, input, select, label')) return;
    if (!el.closest('#page-reservations')) return;
    const code = el.dataset.reservationId; if (!code) return;
    openDetail(code).catch((er) => alertMsg(er.message || String(er), 'error'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  // 一覧の「連携」欄に、カルテ連携と書類確認の印を足す（基準版の描画を包む）
  function patchUi() {
    if (typeof ui === 'undefined' || !ui || ui.__rsvx) return;
    const orig = ui.renderReservationSyncCell.bind(ui);
    ui.renderReservationSyncCell = function (r) {
      const h = orig(r); const x = r && r._rsv; if (!x) return h;
      const k = x.karte_visit_id
        ? '<span class="sync-pill done rsvx-pill" title="カルテの来院予定あり（患者番号 ' + esc(x.karte_patient_no || '') + '・' + esc(VISIT_LABEL[x.visit_status] || '') + '）">カルテ</span>'
        : '<span class="sync-pill rsvx-pill" title="' + esc(x.karte_note || 'カルテの来院予定なし') + '">カルテ未</span>';
      const d = (x.insurance_card_path || x.iryo_card_path)
        ? (x.docs_review === 'approved' ? '<span class="sync-pill done rsvx-pill">書類確認済</span>' : x.docs_review === 'rejected' ? '<span class="sync-pill rsvx-pill rsvx-ng">書類差戻</span>' : '<span class="sync-pill rsvx-pill rsvx-todo">書類未確認</span>')
        : '';
      return h.replace(/<\/div>\s*$/, k + d + '</div>');
    };
    ui.__rsvx = true;
  }
  document.addEventListener('DOMContentLoaded', patchUi);   // admin.js の init（同じく DOMContentLoaded）より先に登録されるので、最初の描画から印が付く

  // 60秒ごとに一覧を読み直す（予約一覧が見えていて、入力中・小窓表示中でないとき）
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if ([...document.querySelectorAll('.modal, .modal-overlay, [role="dialog"]')].some((el) => el.offsetParent !== null && !el.classList.contains('hidden') && !el.hidden)) return;
    refreshList();
  }, 60 * 1000);
})();
