// ===== DB連携モジュール (db_integration.js) =====
// 夜間休日外来DBとの連携処理を分離
// - 薬品マスタ統合 / 在庫取得
// - 患者DB統合 / 検索 / 一覧
// - シフト自動取得 / 担当医表示
// - 処方履歴統合

// 夜間休日外来DB API
const DB_API_URL = 'https://script.google.com/macros/s/AKfycbwWCL1aVy4RcCZsr2Wzrpy5JE8LU8pGWa2u_CY7qo7OGMgXrB0OZGir6rGJZiiV6hRd/exec';

// DB連携データ格納
let dbDrugs = [];      // DB薬品マスタ
let dbStock = {};      // 薬品名 → 在庫数
let dbPatients = [];   // DB患者データ
let dbShift = [];      // シフトデータ
let dbLoaded = false;

// ===== メインDB読み込み =====
async function loadDbData() {
  if (!DB_API_URL) { console.log('DB_API_URL未設定 → ローカルデータで動作'); return; }
  try {
    const indicator = document.createElement('div');
    indicator.id = 'dbLoadIndicator';
    indicator.style.cssText = 'position:fixed;top:8px;right:8px;background:#2563eb;color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;z-index:9999;';
    indicator.textContent = 'DB読込中...';
    document.body.appendChild(indicator);

    const res = await fetch(DB_API_URL + '?action=all');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'DB API error');

    // 薬品マスタ統合
    if (data.drugs && data.drugs.length) {
      dbDrugs = data.drugs;
      // DB薬品をdrugs配列に追加（既存と重複しないもの）
      const existingNames = drugs.map(d => d.name);
      data.drugs.forEach(dd => {
        if (!existingNames.includes(dd.name)) {
          drugs.push({ id: dd.id, name: dd.name, price: 0, unit: guessUnit(dd.name), category: dd.category || '内服' });
        }
      });
    }

    // 在庫データ
    if (data.stock && data.stock.length) {
      data.stock.forEach(s => { dbStock[s.name] = s.qty; });
    }

    // 患者データ
    if (data.patients) {
      dbPatients = data.patients;
      mergeDbPatients(data.patients);
    }

    // 処方履歴データ → 患者に紐付け
    if (data.prescriptions && data.prescriptions.length) {
      mergePrescriptionHistory(data.prescriptions);
    }

    // シフトデータ（API提供 or 患者データから自動構築）
    if (data.shift && data.shift.length) {
      dbShift = data.shift;
    } else if (data.patients && data.patients.length) {
      // 患者データから日付→担当医マッピングを自動構築
      const dateDocMap = {};
      data.patients.forEach(p => {
        if (p.date && p.doctor) {
          if (!dateDocMap[p.date]) dateDocMap[p.date] = {};
          dateDocMap[p.date][p.doctor] = (dateDocMap[p.date][p.doctor] || 0) + 1;
        }
      });
      dbShift = Object.entries(dateDocMap).map(([date, docs]) => {
        // 最多担当の医師をメインに
        const sorted = Object.entries(docs).sort((a, b) => b[1] - a[1]);
        return {
          date: date,
          doctor: sorted[0][0],
          assistants: sorted.slice(1).map(s => s[0])
        };
      });
    }

    dbLoaded = true;
    indicator.textContent = 'DB連携OK (' + (data.drugs?.length || 0) + '薬品 / ' + (dbPatients.length || 0) + '患者 / ' + Object.keys(dbStock).length + '在庫)';
    indicator.style.background = '#16a34a';
    setTimeout(() => indicator.remove(), 3000);

    // 選択日のシフトを表示
    showDateShift(document.getElementById('listDate').value);
    // 患者リストを再描画
    renderPatientList();
  } catch (e) {
    console.error('DB連携エラー:', e);
    const indicator = document.getElementById('dbLoadIndicator');
    if (indicator) { indicator.textContent = 'DB接続失敗'; indicator.style.background = '#dc2626'; setTimeout(() => indicator.remove(), 3000); }
  }
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
