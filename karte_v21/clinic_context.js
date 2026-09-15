// ===== 接続クリニック (clinic_context.js) — v21 =====
// 電子カルテのDB参照先（clinic_id）を「ログインしたIDの所属院」から決める唯一の場所。
//
//  ・起動時: localStorage の前回選択（karte_clinic）を「起動時の院」として同期的に確定する。
//    app.js などがロード時に読む localStorage のキーを院ごとに分けるため、認証より前に決める。
//    （西春は従来のキー名のまま＝既存端末のデータをそのまま使う。他院は「キー@院ID」）
//  ・ログイン画面で院を選ぶ → 認証後に app_users.clinics（所属院。'*' は全院＝マスターID）と突合
//    → 合致すれば接続。起動時の院と違えば localStorage を書き換えて再読込する。
//  ・院の切替（複数院に所属するID）はユーザーメニューから。切替＝再読込なので画面の状態は持ち越さない。
//  ・DBの権限は RLS（multiclinic_rls.sql）が担う。ここでの選択は「どの院として画面を動かすか」の指定。
(function () {
  const LS_CLINIC = 'karte_clinic';
  const DEFAULT_ID = 'nishiharu';
  // clinics 表が読めないときの控え（表示名は表の内容で上書きされる）
  const FALLBACK = [
    { id: 'nishiharu', name: '西春内科・在宅クリニック', short_name: '西春', has_sheet: true, sort_order: 1, is_active: true },
    { id: 'yokohama', name: '横浜クリニック', short_name: '横浜', has_sheet: false, sort_order: 2, is_active: true },
    { id: 'chiba', name: '千葉クリニック', short_name: '千葉', has_sheet: false, sort_order: 3, is_active: true },
    { id: 'nakagawa', name: '中川クリニック', short_name: '中川', has_sheet: false, sort_order: 4, is_active: true },
  ];
  // 院ごとに分ける localStorage のキー（患者・来院・保存待ちなど院に属するもの）
  const NS_KEYS = new Set([
    'karte_db_patients_cache_v1', 'karte_setOrders', 'karte_lastSaved', 'karte_pendingSaves',
    'karte_lateClaims', 'karte_deletionLog', 'karte_rzLastJob', 'karte_rzHenrei', 'rz_resubmitPlan',
    'pendingUKE', 'm3_recmemo',
  ]);

  let boot = DEFAULT_ID;
  try { boot = localStorage.getItem(LS_CLINIC) || DEFAULT_ID; } catch (e) { /* localStorage 不可 */ }
  if (!/^[a-z_]+$/.test(boot)) boot = DEFAULT_ID;

  // 起動時の院が西春以外なら、院に属するキーを「キー@院ID」に付け替える（他のキーは共通）
  if (boot !== DEFAULT_ID && typeof Storage !== 'undefined') {
    const sfx = '@' + boot;
    const P = Storage.prototype, g = P.getItem, s = P.setItem, r = P.removeItem;
    const ns = k => (NS_KEYS.has(k) ? k + sfx : k);
    P.getItem = function (k) { return g.call(this, ns(k)); };
    P.setItem = function (k, v) { return s.call(this, ns(k), v); };
    P.removeItem = function (k) { return r.call(this, ns(k)); };
  }

  let _clinics = FALLBACK.slice();
  let _allowed = null;        // ログインIDの所属院（null = 未取得）
  let _userRow = null;

  function byId(id) { return _clinics.find(c => c.id === id) || null; }
  function activeList() { return _clinics.filter(c => c.is_active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  async function loadClinics() {
    if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return _clinics;
    try {
      const { data, error } = await supabaseClient.from('clinics').select('*').order('sort_order');
      if (!error && data && data.length) _clinics = data;
    } catch (e) { console.warn('[院] clinics 読込失敗（控えを使用）:', e); }
    return _clinics;
  }

  // ログインIDの所属院を app_users から読む。行が無ければ「所属なし」
  async function loadUser(user) {
    _allowed = []; _userRow = null;
    if (!user || typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return _allowed;
    try {
      const { data, error } = await supabaseClient.from('app_users').select('*').eq('id', user.id).maybeSingle();   // ('*' にしておくと clinics 列追加前のDBでも動く)
      if (error) throw new Error(error.message);
      if (data) {
        _userRow = data;
        if (data.is_active === false) return _allowed;
        if (Array.isArray(data.clinics)) _allowed = data.clinics.slice();
        else if (data.clinic_id) _allowed = [data.clinic_id];   // 旧形式（列追加前）
      }
    } catch (e) { console.warn('[院] app_users 読込失敗:', e); }
    return _allowed;
  }

  function isMaster() { return Array.isArray(_allowed) && _allowed.indexOf('*') >= 0; }
  function canUse(id) { return !!byId(id) && Array.isArray(_allowed) && (isMaster() || _allowed.indexOf(id) >= 0); }
  function allowedList() { return isMaster() ? activeList() : activeList().filter(c => canUse(c.id)); }

  // 院を確定する。起動時の院と違えば localStorage を書き換えて再読込（true=再読込した）
  function select(id) {
    if (!byId(id)) return false;
    try { localStorage.setItem(LS_CLINIC, id); } catch (e) { /* noop */ }
    if (id !== boot) { location.reload(); return true; }
    return false;
  }
  function remember(id) { try { localStorage.setItem(LS_CLINIC, id); } catch (e) { /* noop */ } }

  function applyHeader() {
    const c = byId(boot) || FALLBACK[0];
    document.querySelectorAll('#clinicName').forEach(el => { el.textContent = c.name; });
    document.title = '電子カルテ - ' + (c.short_name || c.name);
    document.querySelectorAll('.js-clinic-short').forEach(el => { el.textContent = c.short_name || c.name; });
  }

  // 院を選ぶボタン群を描く（ログイン画面・切替画面で共用）
  //   opts.selected: 初期選択 / opts.onlyAllowed: 所属院だけ描く / opts.onChange(id)
  function renderPicker(container, opts) {
    opts = opts || {};
    const list = opts.onlyAllowed ? allowedList() : activeList();
    let sel = opts.selected && list.some(c => c.id === opts.selected) ? opts.selected : (list[0] ? list[0].id : '');
    container.innerHTML = list.map(c =>
      '<button type="button" class="clinic-pick" data-id="' + esc(c.id) + '" title="' + esc(c.name) + '">' + esc(c.short_name || c.name) + '</button>'
    ).join('');
    container.dataset.selected = sel;
    const paint = () => container.querySelectorAll('.clinic-pick').forEach(b => b.classList.toggle('on', b.dataset.id === container.dataset.selected));
    container.querySelectorAll('.clinic-pick').forEach(b => b.addEventListener('click', () => {
      container.dataset.selected = b.dataset.id; paint();
      if (typeof opts.onChange === 'function') opts.onChange(b.dataset.id);
    }));
    paint();
    return sel;
  }
  function pickerValue(container) { return container ? (container.dataset.selected || '') : ''; }

  // ---- 院切替画面（ログイン済み・複数院に所属するID用） ----
  function openSwitcher() {
    const ov = document.getElementById('clinicSwitchOverlay');
    const box = document.getElementById('clinicSwitchPicker');
    if (!ov || !box) return;
    renderPicker(box, { selected: boot, onlyAllowed: true });
    const msg = document.getElementById('clinicSwitchMsg');
    if (msg) msg.textContent = '';
    ov.style.display = 'flex';
  }
  function closeSwitcher() { const ov = document.getElementById('clinicSwitchOverlay'); if (ov) ov.style.display = 'none'; }
  function confirmSwitch() {
    const id = pickerValue(document.getElementById('clinicSwitchPicker'));
    const msg = document.getElementById('clinicSwitchMsg');
    if (!canUse(id)) { if (msg) msg.textContent = 'このIDでは選べない院です'; return; }
    if (id === boot) { closeSwitcher(); return; }
    if (msg) msg.textContent = (byId(id) || {}).name + ' に切り替えます…';
    select(id);
  }

  // ---- スプレッドシートを持たない院: 患者マスタを Supabase から読んで画面の patients に入れる ----
  function calcAge(dob) {
    if (!dob) return null;
    const t = new Date(), b = new Date(dob);
    if (isNaN(b)) return null;
    let a = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a;
  }
  function patientFromRow(r) {
    const p = {
      id: r.patient_no || ('SB-' + String(r.id || '').slice(0, 8)),
      name: r.name || '(氏名未設定)', nameKana: r.name_kana || '', dob: r.dob || '',
      age: (typeof r.age === 'number') ? r.age : (calcAge(r.dob) ?? ''),
      sex: (r.sex || '').replace(/性$/, '') || '不明',
      insurance: r.insurance_type || '', ratio: (typeof r.copay_rate === 'number') ? r.copay_rate : 0.3,
      address: r.address || '', phone: r.phone || '',
      allergies: Array.isArray(r.allergies) ? r.allergies.slice() : [], history: Array.isArray(r.medical_history) ? r.medical_history.slice() : [],
      prevRx: [], prevDays: 0, prevVisitDate: '',
      vehicle: { plate: '---', lane: 0 }, status: 'done', memo: r.memo || '',
      insurancePhoto: null, insuranceNumber: '', questionnaire: null,
      arrivedAt: '', visitDate: '', pastKartes: [], pastVitals: [],
      sbSource: true, rsvVisits: [],
    };
    if (typeof applySupabasePatientRow === 'function') applySupabasePatientRow(p, r);
    return p;
  }
  let _patientsLoaded = false;
  async function loadPatients() {
    if (typeof patients === 'undefined' || typeof fetchPatientsFromSupabase !== 'function') return 0;
    const rows = await fetchPatientsFromSupabase(boot);
    let n = 0;
    rows.forEach(r => {
      const pno = r.patient_no || ('SB-' + String(r.id || '').slice(0, 8));
      let p = patients.find(x => x.id === pno);
      if (p) { if (typeof applySupabasePatientRow === 'function') applySupabasePatientRow(p, r); return; }
      p = patientFromRow(r);
      patients.push(p); n++;
      if (typeof karteData !== 'undefined' && !karteData[p.id]) {
        karteData[p.id] = { chiefComplaint: '', chiefComplaintSelect: '', findingsHtml: '', vitals: { t: '', bps: '', bpd: '', spo2: '', pulse: '' },
          selectedDiseases: [], prescriptions: [], rxDays: 7, isFirstVisit: false, selectedExams: [], addedBillingItems: [], excludedBillingRows: {} };
      }
    });
    _patientsLoaded = true;
    if (typeof renderPatientList === 'function') renderPatientList();
    console.log('[院] ' + boot + ': Supabase 患者 ' + rows.length + '件（新規 ' + n + '件）');
    return rows.length;
  }

  window.ClinicCtx = {
    boot, id: () => boot, info: () => byId(boot) || FALLBACK[0], hasSheet: () => !!((byId(boot) || FALLBACK[0]).has_sheet),
    list: activeList, allowedList, allowed: () => (_allowed || []).slice(), isMaster, canUse, userRow: () => _userRow,
    loadClinics, loadUser, select, remember, applyHeader, renderPicker, pickerValue,
    openSwitcher, closeSwitcher, confirmSwitch, loadPatients, patientsLoaded: () => _patientsLoaded,
    nameOf: id => ((byId(id) || {}).name || id), shortOf: id => ((byId(id) || {}).short_name || id),
  };
})();

// 全モジュール共通: 現在の接続クリニック（clinic_id）
function currentClinicId() { return (window.ClinicCtx && ClinicCtx.id()) || 'nishiharu'; }
