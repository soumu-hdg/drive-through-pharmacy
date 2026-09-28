// ===== 置き換え層: 夜間外来の患者一覧・予約・スマホ版（2026-09-25）=====
//   従来の画面が持っていた3つのつなぎを、基準版の画面に戻す。
//   ① 夜間外来の患者一覧（Supabase の karte_db_patients）を受付一覧に並べる
//      ・表の補充: 従来の画面と同じく、開いたときに夜間外来DB（GAS action=patients）を読み、karte_db_patients へ書き戻す（has_sheet の院だけ）
//      ・一覧: その日の行のうち、統合版の来院（visits）に同じ氏名が無いものを「仮の受付」（id = mirror:<行id>）として足す
//      ・カルテを開く／状態を変える／受付を編集するときに、患者（patients）と来院（visits）を作ってから本来の処理へ渡す（見るだけでは書かない）
//   ② 予約: 予約サイトの来院予定（visits.status='reserved'・rsv_code）は元から一覧に出る。
//      「予約済」→「待機」に変えたとき受付時刻を入れる／60秒ごとに一覧を読み直す（従来の画面と同じ間隔）
//   ③ スマホ版（mobile.html）へのアイコンを受付画面・カルテ画面の見出しに置く
//   ④ ユーザーメニュー「予約管理」で、同じ場所の予約管理画面（reservation-admin/）をいまの院で開く
(function () {
  const C = window.__compat; if (!C || !C.on) return;
  const DB_API_URL = '';
  const DB_API_TOKEN = '';
  const MIRROR = 'mirror:';
  const norm = (s) => String(s || '').replace(/[\s　]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const md = (iso) => { const [, m, d] = String(iso).split('-'); return Number(m) + '/' + Number(d); };
  const nowHm = () => { const t = new Date(); return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':00'; };
  const todayIso = () => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); };
  const startOf = (rtime) => { const m = String(rtime || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(m[1]) + ':' + m[2] : null; };
  const hasSheet = () => !window.ClinicCtx || (typeof ClinicCtx.hasSheet === 'function' && ClinicCtx.hasSheet());
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

  // ---- ① 表の補充（従来の画面の loadDbData と同じ: GAS → karte_db_patients へ upsert）----
  let refreshing = null, lastRefresh = 0;
  async function refreshMirror() {
    if (!hasSheet() || !DB_API_URL) return 0;
    const c = await C.ready(); if (!c) return 0;
    const res = await C.realFetch(DB_API_URL + '?action=patients&token=' + encodeURIComponent(DB_API_TOKEN));
    const data = await res.json();
    if (!data || !data.success || !Array.isArray(data.patients)) throw new Error((data && data.error) || '夜間外来DBの読み込みに失敗');
    const rows = data.patients.map((p) => ({
      clinic_id: C.clinicId(), name: p.name, age: String(p.age == null ? '' : p.age), sex: p.sex || '',
      area: p.area || '', insurance: p.insurance || '', rdate: p.date || '', rtime: p.time || '',
      doctor: p.doctor || '', covid: !!p.covid, flu: !!p.flu, strep: !!p.strep, ptype: p.type || '',
      route: p.route || '', payment: String(p.payment == null ? '' : p.payment),
      self_pay: p.selfPay == null ? null : p.selfPay, revenue_points: p.revenuePoints == null ? null : p.revenuePoints,
    })).filter((r) => r.name);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await c.from('karte_db_patients').upsert(rows.slice(i, i + 200), { onConflict: 'clinic_id,name,rdate,rtime' });
      if (error) throw new Error(error.message);
    }
    return rows.length;
  }
  function kickRefresh() {
    if (refreshing || Date.now() - lastRefresh < 10 * 60 * 1000) return;
    lastRefresh = Date.now();
    refreshing = refreshMirror()
      .then((n) => { if (n) { mirrorCache.clear(); reloadList(); } })
      .catch((e) => console.warn('[夜間外来DB] 補充できませんでした:', e.message || e))
      .finally(() => { refreshing = null; });
  }
  window.__compat.refreshMirror = refreshMirror;

  // ---- ① 一覧へ足す ----
  const mirrorCache = new Map();   // 行id → karte_db_patients の行（開くときに使う）
  async function mirrorRowsFor(iso) {
    const c = await C.ready(); if (!c) return [];
    const since = new Date(iso); since.setDate(since.getDate() - 200);   // rdate に年が無いので、去年の同じ日付を拾わない
    const { data, error } = await c.from('karte_db_patients').select('*').eq('clinic_id', C.clinicId()).eq('rdate', md(iso))
      .gte('updated_at', since.toISOString()).order('rtime').order('id');
    if (error) { console.warn('[夜間外来DB] 一覧を読めません:', error.message); return []; }
    return data || [];
  }
  function mirrorReception(r, iso, i) {
    const past = iso < todayIso();
    return {
      id: MIRROR + r.id, patient_id: MIRROR + r.id, reception_date: iso, reception_time: startOf(r.rtime), appointment_time: startOf(r.rtime),
      status: past ? 'payment_done' : 'waiting', department: '内科', doctor_id: null, doctor_name: r.doctor || null,
      reception_memo: '夜間外来DB' + (r.rtime ? '（' + r.rtime + '）' : ''), reservation_memo: null,
      first_visit: r.ptype === '新規' ? true : r.ptype ? false : null, previous_visit_date: null,
      insurance_id: null, public_expense_1_id: null, public_expense_2_id: null, public_expense_3_id: null,
      insurance_type_name: r.insurance || null, insurer_name: null, insurer_number: null, relationship: null, burden_ratio: null, created_at: r.updated_at,
      patient_no: null, patient_name: r.name, name_kana: null, gender: /^女/.test(r.sex || '') ? 'female' : /^男/.test(r.sex || '') ? 'male' : 'other', birth_date: null,
      patient_memo: r.age ? '年代 ' + r.age : null, source: 'mirror', reception_number: i + 1,
    };
  }
  const listFn = C.routeOf('GET', /^\/receptions$/);
  C.on('GET', /^\/receptions$/, async (m, q, b) => {
    const base = await listFn(m, q, b);
    kickRefresh();
    if (base instanceof Response || !base || !Array.isArray(base.data)) return base;
    const iso = q.get('reception_date') || todayIso();
    const have = new Set(base.data.map((x) => norm(x.patient_name)));
    const extra = (await mirrorRowsFor(iso)).filter((r) => r.name && !have.has(norm(r.name)));
    extra.forEach((r) => mirrorCache.set(String(r.id), r));
    const rows = base.data.concat(extra.map((r, i) => mirrorReception(r, iso, base.data.length + i)));
    rows.sort((a, b2) => String(a.appointment_time || a.reception_time || '99').localeCompare(String(b2.appointment_time || b2.reception_time || '99')));
    rows.forEach((x, i) => { x.reception_number = i + 1; });
    return { data: rows };
  });

  // ---- ① 仮の受付を、患者＋来院にする（カルテを開く・状態を変える・編集するとき）----
  const making = new Map();
  async function materialize(mirrorId, iso) {
    const key = String(mirrorId);
    if (!making.has(key)) making.set(key, (async () => {
      const c = await C.ready(); const clinic = C.clinicId();
      let r = mirrorCache.get(key);
      if (!r) { const { data } = await c.from('karte_db_patients').select('*').eq('id', key).eq('clinic_id', clinic).maybeSingle(); r = data; }
      if (!r) throw new Error('夜間外来DBの行が見つかりません');
      const date = iso || (typeof document !== 'undefined' && document.getElementById('reception-date') && document.getElementById('reception-date').value) || todayIso();
      // 患者: 同じ氏名（空白を除いて一致）がいれば使う。性別が合う人を優先
      const { data: pts, error: e1 } = await c.from('patients').select('id,name,sex,patient_no').eq('clinic_id', clinic);
      if (e1) throw new Error(e1.message);
      const same = (pts || []).filter((p) => norm(p.name) === norm(r.name));
      const sexKey = (s) => String(s || '').replace(/性$/, '');
      let p = same.find((x) => sexKey(x.sex) === sexKey(r.sex)) || same[0];
      if (!p) {
        let n = Math.max(0, ...(pts || []).map((x) => { const mm = String(x.patient_no || '').match(/^NHC-(\d+)$/); return mm ? Number(mm[1]) : 0; }));
        for (let tries = 0; tries < 5 && !p; tries++) {
          n += 1;
          const row = { clinic_id: clinic, patient_no: 'NHC-' + String(n).padStart(4, '0'), name: r.name, sex: r.sex || '不明', insurance_type: r.insurance || null, is_db_source: true };
          const { data, error } = await c.from('patients').insert(row).select('id,name,sex,patient_no').single();
          if (!error) p = data; else if (!/duplicate|unique/i.test(error.message)) throw new Error('患者を登録できませんでした: ' + error.message);
        }
        if (!p) throw new Error('患者番号を採番できませんでした');
      }
      // 来院: その日の来院があれば使う。無ければ作る
      const { data: vs } = await c.from('visits').select('id').eq('clinic_id', clinic).eq('patient_id', p.id).eq('visit_date', date).limit(1);
      let vid = vs && vs[0] && vs[0].id;
      if (!vid) {
        const past = date < todayIso();
        const { data, error } = await c.from('visits').insert({ clinic_id: clinic, patient_id: p.id, visit_date: date, visit_time: startOf(r.rtime), doctor: r.doctor || null,
          department: '内科', visit_type: r.ptype === '新規' ? '新規' : '再診', status: past ? 'done' : 'waiting', route: r.route || null,
          covid_positive: !!r.covid, flu_positive: !!r.flu, strep_positive: !!r.strep }).select('id').single();
        if (error) throw new Error('来院を登録できませんでした: ' + error.message);
        vid = data.id;
      }
      return { patientId: p.id, visitId: vid };
    })().finally(() => setTimeout(() => making.delete(key), 30000)));
    return making.get(key);
  }
  const idOf = (x) => String(x || '').startsWith(MIRROR) ? String(x).slice(MIRROR.length) : null;

  function wrapOpenKarte() {
    const orig = window.openPatientKarte;
    if (typeof orig !== 'function' || orig.__mirror) return;
    const w = async function (patientId, receptionId) {
      const mid = idOf(patientId) || idOf(receptionId);
      if (!mid) return orig.apply(this, arguments);
      try {
        const rec = ((typeof receptionsCache !== 'undefined' && receptionsCache) || []).find((x) => x.id === MIRROR + mid);
        const t = await materialize(mid, rec && rec.reception_date);
        if (typeof loadReceptions === 'function') await loadReceptions();
        return orig.call(this, t.patientId, t.visitId);
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message || String(e), 'error'); else alert(e.message || e);
      }
    };
    w.__mirror = true; window.openPatientKarte = w;
  }

  // 受付の変更・取得を仮の受付に向けられたとき（状態メニュー・受付の編集）
  const putFn = C.routeOf('PUT', /^\/receptions\/([0-9a-f-]{36})$/);
  const getFn = C.routeOf('GET', /^\/receptions\/([0-9a-f-]{36})$/);
  C.on('PUT', /^\/receptions\/mirror:(\d+)$/, async (m, q, b) => { const t = await materialize(m[1]); return putFn([m[0], t.visitId], q, b); });
  C.on('GET', /^\/receptions\/mirror:(\d+)$/, async (m, q, b) => { const t = await materialize(m[1]); return getFn([m[0], t.visitId], q, b); });
  C.on('GET', /^\/patients\/mirror:(\d+)$/, async (m) => {
    const t = await materialize(m[1]);
    return C.routeOf('GET', /^\/patients\/([0-9a-f-]{36})$/)([m[0], t.patientId]);
  });

  // ---- ② 予約: 「予約済」→「待機」で受付時刻を入れる ----
  C.on('PUT', /^\/receptions\/([0-9a-f-]{36})$/, async (m, q, b) => {
    b = b || {};
    if (b.status === 'waiting' && b.reception_time === undefined) {
      const c = await C.ready();
      const { data: v } = await c.from('visits').select('status,arrived_at').eq('id', m[1]).eq('clinic_id', C.clinicId()).maybeSingle();
      if (v && v.status === 'reserved' && !v.arrived_at) b = Object.assign({}, b, { reception_time: nowHm() });
    }
    return putFn(m, q, b);
  });

  // ---- ② 60秒ごとに一覧を読み直す（受付画面が見えていて、入力中・ダイアログ表示中でないとき）----
  function receptionVisible() {
    const s = document.getElementById('reception-screen');
    return s && !s.classList.contains('hidden') && document.visibilityState === 'visible';
  }
  function busy() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'reception-date') return true;
    return [...document.querySelectorAll('.modal, .modal-overlay, [role="dialog"], .status-menu, .status-dropdown')]
      .some((el) => el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
  }
  function reloadList() { if (receptionVisible() && !busy() && typeof loadReceptions === 'function') loadReceptions(); }
  setInterval(reloadList, 60 * 1000);

  // ---- ③ スマホ版へのアイコン ----
  function addMobileLinks() {
    const open = () => window.open('../mobile.html' + location.search, '_blank', 'noopener');
    const title = 'DigiMaster Mobile（診察中の医療補助が保険証・処方・検査結果を送る）';
    const rec = document.querySelector('#reception-screen .reception-header-right .header-icons');
    if (rec && !document.getElementById('btn-open-mobile')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.id = 'btn-open-mobile'; b.title = title;
      b.innerHTML = '<i class="fas fa-mobile-alt"></i>'; b.addEventListener('click', open); rec.insertBefore(b, rec.firstChild);
    }
    const main = document.querySelector('#main-screen .header-right .header-icons');
    if (main && !document.getElementById('btn-open-mobile-main')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.id = 'btn-open-mobile-main'; b.title = title;
      b.innerHTML = '<i class="fas fa-mobile-alt"></i>'; b.addEventListener('click', open); main.insertBefore(b, main.firstChild);
    }
  }
  // ---- ④ ユーザーメニュー「予約管理」の開き先（2026-09-25）----
  //   基準版は http(s) で開くと基準版のサーバーの /admin/reserve/ を開く。統合版にそのサーバーは無いので、
  //   同じ場所に置いた基準版の予約管理画面（reservation-admin/index.html・置き換え層つき）を、いま選んでいる院で開く。
  //   開き方（別ウィンドウ・カルテに戻る先・ログイン情報の引き渡し）は基準版の openReservationManagement のまま
  function wireReservationAdmin() {
    window.getReservationAdminOpenUrl = async function () {
      const u = new URL('reservation-admin/index.html', location.href);
      u.search = ''; u.searchParams.set('clinic', C.clinicId());
      return u.href;
    };
  }
  function boot() { addMobileLinks(); wrapOpenKarte(); wireReservationAdmin(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', wrapOpenKarte);
})();
