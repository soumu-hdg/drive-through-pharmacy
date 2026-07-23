// ===== DB連携モジュール (db_integration.js) =====
// 夜間休日外来DBとの連携処理を分離
// - 薬品マスタ統合 / 在庫取得
// - 患者DB統合 / 検索 / 一覧
// - シフト自動取得 / 担当医表示
// - 処方履歴統合
// - 遅延ロード: デフォルト直近数日分→日付移動で追加ロード

// 夜間休日外来DB API
const DB_API_URL = 'https://script.google.com/macros/s/AKfycbwWCL1aVy4RcCZsr2Wzrpy5JE8LU8pGWa2u_CY7qo7OGMgXrB0OZGir6rGJZiiV6hRd/exec';
// GAS側 API_TOKEN と同じ値（無差別CSRF/drive-by遮断用・トークン必須化済み）
const DB_API_TOKEN = 'dtp_f929bbd860e2e96224ded613cd06177e';

// DB連携データ格納
let dbDrugs = [];      // DB薬品マスタ
let dbStock = {};      // 薬品名 → 在庫数
let dbPatients = [];   // DB患者データ
let dbShift = [];      // シフトデータ
let dbLoaded = false;

// 遅延ロード管理
const DB_DEFAULT_DAYS = 7;  // 初回ロード日数
let dbLoadedDateRange = { from: null, to: null };  // ロード済み日付範囲（M/D形式）
let dbIsLoading = false;  // ロード中フラグ

// ===== ローディングオーバーレイ =====
function showDbLoadingOverlay(message) {
  let overlay = document.getElementById('dbLoadOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dbLoadOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:99999;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:32px 48px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);">' +
      '<div style="font-size:24px;margin-bottom:12px;">&#128268;</div>' +
      '<div id="dbLoadMsg" style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:8px;">DB読込中...</div>' +
      '<div id="dbLoadSub" style="font-size:12px;color:#64748b;">患者データを取得しています</div>' +
      '<div style="margin-top:16px;width:200px;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;">' +
      '<div id="dbLoadBar" style="width:30%;height:100%;background:#2563eb;border-radius:2px;animation:dbPulse 1.2s ease-in-out infinite;"></div></div></div>';
    document.body.appendChild(overlay);
    // アニメーション追加
    if (!document.getElementById('dbLoadStyle')) {
      const style = document.createElement('style');
      style.id = 'dbLoadStyle';
      style.textContent = '@keyframes dbPulse{0%{width:20%}50%{width:70%}100%{width:20%}}';
      document.head.appendChild(style);
    }
  } else {
    overlay.style.display = 'flex';
  }
  document.getElementById('dbLoadMsg').textContent = message || 'DB読込中...';
}

function updateDbLoadingMessage(msg, sub) {
  const el = document.getElementById('dbLoadMsg');
  if (el) el.textContent = msg;
  const subEl = document.getElementById('dbLoadSub');
  if (subEl && sub) subEl.textContent = sub;
}

function hideDbLoadingOverlay() {
  const overlay = document.getElementById('dbLoadOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ===== 小さいインジケーター（追加ロード時） =====
function showDbMiniIndicator(message) {
  let ind = document.getElementById('dbMiniIndicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'dbMiniIndicator';
    ind.style.cssText = 'position:fixed;top:8px;right:8px;background:#2563eb;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;z-index:99998;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;gap:8px;';
    document.body.appendChild(ind);
  }
  ind.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;"></span>' + message;
  ind.style.display = 'flex';
  if (!document.getElementById('dbSpinStyle')) {
    const style = document.createElement('style');
    style.id = 'dbSpinStyle';
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
}

function hideDbMiniIndicator() {
  const ind = document.getElementById('dbMiniIndicator');
  if (ind) ind.style.display = 'none';
}

function showDbSuccessBadge(msg) {
  let ind = document.getElementById('dbMiniIndicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'dbMiniIndicator';
    ind.style.cssText = 'position:fixed;top:8px;right:8px;padding:8px 16px;border-radius:8px;font-size:13px;z-index:99998;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    document.body.appendChild(ind);
  }
  ind.innerHTML = msg;
  ind.style.background = '#16a34a';
  ind.style.color = '#fff';
  ind.style.display = 'block';
  setTimeout(() => { ind.style.display = 'none'; }, 3000);
}

// ===== M/D日付ユーティリティ =====
function mdToSortable(md) {
  // "6/3" → "06/03" ソート用
  if (!md) return '99/99';
  const parts = md.split('/');
  return String(parts[0]).padStart(2,'0') + '/' + String(parts[1]).padStart(2,'0');
}

function isoToMDLocal(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  return parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

function getDateRangeForDays(centerIso, days) {
  // centerIso "2026-06-05" を基準にdays日前までのM/D範囲を返す
  const center = new Date(centerIso);
  const from = new Date(center);
  from.setDate(from.getDate() - days);
  return {
    fromMD: (from.getMonth()+1) + '/' + from.getDate(),
    toMD: (center.getMonth()+1) + '/' + center.getDate()
  };
}

function isDateInRange(dateMD, range) {
  if (!range.from || !range.to) return false;
  const s = mdToSortable(dateMD);
  return s >= mdToSortable(range.from) && s <= mdToSortable(range.to);
}

// ===== メインDB読み込み（v18: 非ブロック・段階ロード） =====
// 優先順位: ①localStorageキャッシュ ②Supabaseミラー ③GAS action=patients(約3.5秒) ④重い部分は背景
// 旧: 全画面オーバーレイ + action=all（薬品/在庫/処方まで一括・約45秒）で操作不能だった。
const DB_PATIENTS_CACHE_KEY = 'karte_db_patients_cache_v1';

// 患者リストからシフト（当番医）を自動構築
function buildShiftFromPatients(list) {
  const dateDocMap = {};
  list.forEach(p => {
    if (p.date && p.doctor) {
      if (!dateDocMap[p.date]) dateDocMap[p.date] = {};
      dateDocMap[p.date][p.doctor] = (dateDocMap[p.date][p.doctor] || 0) + 1;
    }
  });
  dbShift = Object.entries(dateDocMap).map(([date, docs]) => {
    const sorted = Object.entries(docs).sort((a, b) => b[1] - a[1]);
    return { date: date, doctor: sorted[0][0], assistants: sorted.slice(1).map(s => s[0]) };
  });
}

// 患者リストを画面へ反映（キャッシュ/ミラー/GAS 共通）
function applyDbPatients(list) {
  if (!list || !list.length) return;
  dbPatients = list;
  mergeDbPatients(list);
  buildShiftFromPatients(list);
  const ld = document.getElementById('listDate');
  showDateShift(ld ? ld.value : '');
  renderPatientList();
}

// ① localStorageキャッシュ（同一端末・次回起動を即時化）
function saveDbPatientsCache(list) {
  try { localStorage.setItem(DB_PATIENTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), patients: list })); } catch (e) {}
}
function loadDbPatientsCache() {
  try { const c = JSON.parse(localStorage.getItem(DB_PATIENTS_CACHE_KEY)); return (c && Array.isArray(c.patients)) ? c.patients : null; } catch (e) { return null; }
}

// ② Supabaseミラー（authenticated限定RLS＝患者PII保護／GASより高速）
async function fetchDbMirror() {
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return [];
  try {
    const { data, error } = await supabaseClient.from('karte_db_patients').select('*').eq('clinic_id', 'nishiharu');
    if (error) { console.warn('[mirror] 取得失敗', error.message); return []; }
    return (data || []).map(r => ({
      name: r.name, age: r.age, sex: r.sex, area: r.area, insurance: r.insurance,
      date: r.rdate, time: r.rtime, doctor: r.doctor, covid: r.covid, flu: r.flu, strep: r.strep,
      type: r.ptype, route: r.route, payment: r.payment, selfPay: r.self_pay, revenuePoints: r.revenue_points
    }));
  } catch (e) { console.warn('[mirror] 取得例外', e); return []; }
}
async function upsertDbMirror(list) {
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady() || !list || !list.length) return;
  try {
    const rows = list.map(p => ({
      clinic_id: 'nishiharu', name: p.name, age: String(p.age == null ? '' : p.age), sex: p.sex || '',
      area: p.area || '', insurance: p.insurance || '', rdate: p.date || '', rtime: p.time || '',
      doctor: p.doctor || '', covid: !!p.covid, flu: !!p.flu, strep: !!p.strep, ptype: p.type || '',
      route: p.route || '', payment: String(p.payment == null ? '' : p.payment),
      self_pay: p.selfPay == null ? null : p.selfPay, revenue_points: p.revenuePoints == null ? null : p.revenuePoints
    })).filter(r => r.name);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseClient.from('karte_db_patients').upsert(rows.slice(i, i + 200), { onConflict: 'clinic_id,name,rdate,rtime' });
      if (error) { console.warn('[mirror] upsert失敗', error.message); break; }
    }
  } catch (e) { console.warn('[mirror] upsert例外', e); }
}

async function loadDbData() {
  if (!DB_API_URL) { console.log('DB_API_URL未設定 → ローカルデータで動作'); return; }
  if (dbIsLoading) return;
  dbIsLoading = true;
  let shown = false;

  // ① localStorageキャッシュ → 即描画（起動直後から操作可能）
  const cached = loadDbPatientsCache();
  if (cached && cached.length) { applyDbPatients(cached); shown = true; showDbMiniIndicator('最新データ確認中...'); }

  // ② Supabaseミラー（キャッシュ無し時）→ 高速描画
  try {
    if (!shown) {
      showDbMiniIndicator('患者データ読込中...');
      const mirror = await fetchDbMirror();
      if (mirror.length) { applyDbPatients(mirror); shown = true; }
    }
  } catch (e) { /* GASへフォールバック */ }

  // ③ GAS action=patients（約3.5秒・権威データ）→ 更新＋両キャッシュへ書き戻し
  try {
    if (!shown) showDbMiniIndicator('患者データ読込中...');
    const url = DB_API_URL + '?action=patients&token=' + encodeURIComponent(DB_API_TOKEN);
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.success && Array.isArray(data.patients)) {
      applyDbPatients(data.patients);
      dbLoaded = true;
      saveDbPatientsCache(data.patients);        // ①次回起動を即時化
      upsertDbMirror(data.patients);             // ③背景でSupabaseミラー更新（次回0.2秒）
      hideDbMiniIndicator();
      showDbSuccessBadge('患者 ' + data.patients.length + '名 読込');
    } else {
      throw new Error((data && data.error) || 'patients取得失敗');
    }
  } catch (e) {
    console.error('DB連携(患者)エラー:', e);
    hideDbMiniIndicator();
    if (!shown) { showDbSuccessBadge('DB接続失敗: ' + e.message); const ind = document.getElementById('dbMiniIndicator'); if (ind) ind.style.background = '#dc2626'; }
  } finally {
    dbIsLoading = false;
  }

  // ④ 薬品・在庫・処方（重い action=all）は背景で（一覧表示をブロックしない）
  loadDbHeavyBackground();
}

// 薬品・在庫・処方・シフトを背景ロード（初回一覧表示をブロックしない）
let dbHeavyLoaded = false;
async function loadDbHeavyBackground() {
  if (dbHeavyLoaded || !DB_API_URL) return;
  try {
    const range = getDateRangeForDays(selectedDate, DB_DEFAULT_DAYS);
    const url = DB_API_URL + '?action=all&token=' + encodeURIComponent(DB_API_TOKEN) + '&date_from=' + encodeURIComponent(range.fromMD) + '&date_to=' + encodeURIComponent(range.toMD);
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !data.success) return;
    if (data.drugs && data.drugs.length) {
      dbDrugs = data.drugs;
      const existingNames = drugs.map(d => d.name);
      data.drugs.forEach(dd => { if (!existingNames.includes(dd.name)) drugs.push({ id: dd.id, name: dd.name, price: 0, unit: guessUnit(dd.name), category: dd.category || '内服' }); });
    }
    if (data.stock && data.stock.length) data.stock.forEach(s => { dbStock[s.name] = s.qty; });
    if (data.prescriptions && data.prescriptions.length) mergePrescriptionHistory(data.prescriptions);
    if (data.shift && data.shift.length) dbShift = data.shift;
    dbHeavyLoaded = true;
    if (typeof renderPatientList === 'function') renderPatientList();
  } catch (e) { console.warn('背景DB(薬品/処方)読込失敗:', e); }
}

// ===== 日付変更時: 全患者を一度に取得済みのため追加GASフェッチ不要（旧45秒再取得を廃止） =====
async function loadDbDataForDate(targetIso) {
  // action=patients で全患者を取得済み。日付移動での再フェッチは不要。
  if (dbLoaded) return;
  if (!dbIsLoading) loadDbData();
}

// ===== 薬品ユーティリティ =====
function guessUnit(name) {
  if (/錠|カプセル/.test(name)) return 'T';
  if (/散|顆粒|細粒|DS/.test(name)) return '包';
  if (/坐剤/.test(name)) return '個';
  if (/軟膏|クリーム/.test(name)) return '本';
  if (/テープ/.test(name)) return '枚';
  if (/点眼/.test(name)) return '本';
  if (/吸入/.test(name)) return 'キット';
  if (/注|シリンジ/.test(name)) return 'A';
  if (/エアー/.test(name)) return '本';
  if (/アドテスト|クイックナビ/.test(name)) return '個';
  return 'T';
}

function getStockQty(drugName) {
  if (!dbLoaded) return null;
  // 完全一致
  if (dbStock[drugName] !== undefined) return dbStock[drugName];
  // 部分一致（全角半角・スペース差異を吸収）
  const normalized = drugName.replace(/\s+/g, '');
  for (const [key, val] of Object.entries(dbStock)) {
    if (key.replace(/\s+/g, '') === normalized) return val;
  }
  return null;
}

function stockBadge(drugName) {
  const qty = getStockQty(drugName);
  if (qty === null) return '';
  if (qty <= 0) return '<span style="background:#fee2e2;color:#dc2626;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">在庫切れ</span>';
  if (qty <= 10) return '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">残' + qty + '</span>';
  return '<span style="background:#dcfce7;color:#16a34a;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">在庫' + qty + '</span>';
}

// ===== シフト表示 =====
function showDateShift(dateStr) {
  const badge = document.getElementById('shiftBadge');
  if (!badge || !dbShift.length) { if (badge) badge.style.display = 'none'; return; }
  // dateStrはISO形式 "2026-04-25" → M/D形式に変換
  const md = dateStr ? isoToMD(dateStr) : '';
  const shift = dbShift.find(s => s.date === md);
  if (!shift) { badge.style.display = 'none'; return; }
  let text = '当番: ' + shift.doctor;
  if (shift.assistants && shift.assistants.length) text += ' ／ ' + shift.assistants.join('・');
  badge.textContent = text;
  badge.style.display = 'inline-block';
}

function getShiftDoctor(dateStr) {
  if (!dbShift.length) return '';
  const md = dateStr ? isoToMD(dateStr) : '';
  const shift = dbShift.find(s => s.date === md);
  return shift ? shift.doctor : '';
}

// ===== 処方履歴統合 =====
function mergePrescriptionHistory(rxRecords) {
  rxRecords.forEach(rec => {
    const normName = rec.name.replace(/\s+/g, '');
    const patient = patients.find(p => p.name.replace(/\s+/g, '') === normName);
    if (!patient) return;

    // rx配列の形式を判定（オブジェクト{drug,qty}配列 or 文字列配列）
    let rxItems = [];
    let rxStr = '';
    if (rec.rx && rec.rx.length > 0) {
      if (typeof rec.rx[0] === 'object') {
        rxItems = rec.rx.filter(r => r.drug);
        rxStr = rxItems.map(r => r.drug + (r.qty ? ' ' + r.qty : '')).join(', ');
      } else {
        rxStr = rec.rx.join(', ');
        rxItems = rec.rx.map(r => ({ drug: r, qty: '' }));
      }
    }

    // pastKartesに同日エントリがあれば処方を追記
    const existing = patient.pastKartes.find(k => k.date === rec.date);
    if (existing) {
      if (!existing.rx || existing.rx === '') {
        existing.rx = rxStr;
        existing.rxItems = rxItems;
      } else if (!existing.rx.includes(rxStr)) {
        existing.rx += ', ' + rxStr;
        existing.rxItems = (existing.rxItems || []).concat(rxItems);
      }
    } else {
      patient.pastKartes.push({
        date: rec.date || '',
        cc: '',
        diag: '',
        rx: rxStr,
        rxItems: rxItems,
        doc: rec.doctor || ''
      });
      patient.pastKartes.sort((a, b) => compareDateStr(b.date, a.date));
    }
  });
}

// ===== DB患者検索・一覧 =====
function onDbPatientSearch(q) {
  const results = document.getElementById('dbPatientResults');
  if (!q || q.length < 1) { results.style.display = 'none'; return; }
  const dbPats = patients.filter(p => p.dbSource && (p.name.includes(q) || (p.nameKana || '').includes(q) || (p.address || '').includes(q)));
  if (dbPats.length === 0) { results.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;">該当なし</div>'; results.style.display = 'block'; return; }
  results.innerHTML = dbPats.slice(0, 20).map(p => {
    const visits = p.dbVisits ? p.dbVisits.length : 0;
    const lastDate = p.pastKartes && p.pastKartes.length > 0 ? p.pastKartes[0].date : '-';
    return '<div style="padding:6px 10px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="openKarte(\'' + p.id + '\')" onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'#fff\'">' +
      '<div><strong>' + p.name + '</strong> <span style="color:var(--text-muted);font-size:10px;">' + p.age + '歳 ' + p.sex + ' / ' + p.insurance + '</span></div>' +
      '<div style="font-size:10px;color:var(--text-muted);">' + visits + '回来院 / 最終:' + lastDate + '</div></div>';
  }).join('');
  if (dbPats.length > 20) results.innerHTML += '<div style="padding:6px;text-align:center;color:var(--text-muted);font-size:10px;">他' + (dbPats.length - 20) + '件</div>';
  results.style.display = 'block';
}

let dbListVisible = false;
function toggleDbPatientList() {
  const results = document.getElementById('dbPatientResults');
  if (dbListVisible) { results.style.display = 'none'; dbListVisible = false; return; }
  const dbPats = patients.filter(p => p.dbSource);
  if (dbPats.length === 0) { results.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;">DB患者なし（DB未接続）</div>'; results.style.display = 'block'; dbListVisible = true; return; }
  results.innerHTML = '<div style="padding:6px 10px;background:var(--bg);font-weight:600;font-size:11px;border-bottom:1px solid var(--border);">DB患者一覧（' + dbPats.length + '名）</div>' +
    dbPats.map(p => {
      const visits = p.dbVisits ? p.dbVisits.length : 0;
      const lastDate = p.pastKartes && p.pastKartes.length > 0 ? p.pastKartes[0].date : '-';
      const typeBadge = p.type === '新規' ? '<span style="background:#dcfce7;color:#16a34a;padding:0 4px;border-radius:3px;font-size:9px;margin-left:4px;">新規</span>' : p.type === '再診' ? '<span style="background:#dbeafe;color:#2563eb;padding:0 4px;border-radius:3px;font-size:9px;margin-left:4px;">再診</span>' : '';
      return '<div style="padding:5px 10px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="openKarte(\'' + p.id + '\')" onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'#fff\'">' +
        '<div><strong>' + p.name + '</strong>' + typeBadge + ' <span style="color:var(--text-muted);font-size:10px;">' + p.age + '歳 ' + p.sex + ' / ' + p.insurance + '</span></div>' +
        '<div style="font-size:10px;color:var(--text-muted);">' + (p.address || '') + ' / ' + visits + '回 / ' + lastDate + '</div></div>';
    }).join('');
  results.style.display = 'block';
  dbListVisible = true;
}

// ===== DB患者統合 =====
function mergeDbPatients(dbPats) {
  // DB患者を名前でグループ化（同一患者の複数来院をまとめる）
  const grouped = {};
  dbPats.forEach(dp => {
    const name = dp.name.replace(/\s+/g, '');
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(dp);
  });

  // 既存hardcoded患者の名前セット（重複防止）
  const existingNames = new Set(patients.map(p => p.name.replace(/\s+/g, '')));

  let dbIdx = 0;
  for (const [normName, visits] of Object.entries(grouped)) {
    // 既存患者に来院履歴を追加
    const existingPatient = patients.find(p => p.name.replace(/\s+/g, '') === normName);
    if (existingPatient) {
      appendDbVisitHistory(existingPatient, visits);
      continue;
    }

    // 新規DB患者をカルテ形式に変換して追加
    dbIdx++;
    const latest = visits.sort((a, b) => compareDateStr(b.date, a.date))[0];
    const newPatient = convertDbPatient(latest, visits, dbIdx);
    patients.push(newPatient);
    // カルテデータも初期化
    karteData[newPatient.id] = { chiefComplaint:'', chiefComplaintSelect:'', findingsHtml:'', vitals:{t:'',bps:'',bpd:'',pulse:'',spo2:''}, selectedDiseases:[], prescriptions:[], rxDays:7, isFirstVisit: latest.type === '新規', selectedExams:[], addedBillingItems:[] };
  }
}

function convertDbPatient(latest, visits, idx) {
  const id = 'DB-' + String(idx).padStart(4, '0');
  const name = latest.name.replace(/\s+/g, '');
  // 年齢をパース（"3~5" → 4, "30代" → 35, 数字のみ → そのまま）
  let age = 0;
  const ageStr = String(latest.age || '');
  if (/^\d+$/.test(ageStr)) { age = parseInt(ageStr); }
  else if (/(\d+)~(\d+)/.test(ageStr)) { const m = ageStr.match(/(\d+)~(\d+)/); age = Math.round((parseInt(m[1]) + parseInt(m[2])) / 2); }
  else if (/(\d+)代/.test(ageStr)) { const m = ageStr.match(/(\d+)代/); age = parseInt(m[1]) + 5; }

  // 来院履歴をpastKartesに変換
  const pastKartes = visits.map(v => ({
    date: v.date || '',
    cc: '',
    diag: [v.covid ? 'COVID-19' : '', v.flu ? 'インフルエンザ' : '', v.strep ? '溶連菌' : ''].filter(Boolean).join(', ') || '',
    rx: '',
    doc: v.doctor || ''
  })).sort((a, b) => compareDateStr(b.date, a.date));

  // 保険種別のマッピング
  let insurance = latest.insurance || '社保3割';
  let ratio = 0.3;
  if (insurance.includes('1割')) ratio = 0.1;
  else if (insurance.includes('2割')) ratio = 0.2;
  else if (insurance === '公費') ratio = 0;
  // DB値が短い場合は3割を追加
  if (/^(社保|国保|後期)$/.test(insurance)) insurance += '3割';

  return {
    id: id,
    name: name,
    age: age,
    sex: (latest.sex || '').replace(/性$/, '') || '不明',
    insurance: insurance,
    ratio: ratio,
    dob: '',
    address: latest.area || '',
    phone: '',
    nameKana: '',
    allergies: [],
    history: pastKartes.map(k => k.diag).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
    prevRx: [],
    prevDays: 0,
    prevVisitDate: visits[0]?.date || '',
    vehicle: { plate: '---', lane: 0 },
    status: 'none',
    memo: '',
    insurancePhoto: null,
    insuranceNumber: '',
    questionnaire: null,
    arrivedAt: '',
    visitDate: '',
    pastKartes: pastKartes,
    pastVitals: [],
    dbSource: true,
    dbVisits: visits,
    selfPayTotal: visits.reduce((s, v) => s + (v.selfPay || 0), 0),
    revenueTotal: visits.reduce((s, v) => s + (v.revenuePoints || 0), 0),
    route: latest.route || '',
    type: latest.type || ''
  };
}

function appendDbVisitHistory(patient, visits) {
  visits.forEach(v => {
    const diag = [v.covid ? 'COVID-19' : '', v.flu ? 'インフルエンザ' : '', v.strep ? '溶連菌' : ''].filter(Boolean).join(', ') || '';
    const entry = { date: v.date || '', cc: '', diag: diag, rx: '', doc: v.doctor || '' };
    // 重複チェック（同日同医師のエントリは追加しない）
    if (!patient.pastKartes.find(k => k.date === entry.date && k.doc === entry.doc)) {
      patient.pastKartes.push(entry);
    }
  });
  // 日付降順ソート
  patient.pastKartes.sort((a, b) => compareDateStr(b.date, a.date));
}

function compareDateStr(a, b) {
  // "M/D" 形式の比較（同年内前提）
  const pa = (a || '').split('/').map(Number);
  const pb = (b || '').split('/').map(Number);
  if (pa[0] !== pb[0]) return (pa[0] || 0) - (pb[0] || 0);
  return (pa[1] || 0) - (pb[1] || 0);
}
