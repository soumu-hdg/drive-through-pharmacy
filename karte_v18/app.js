// ===== XSS Protection =====
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ===== Config =====
const API_URL = 'https://script.google.com/macros/s/AKfycbwFzGLG20GaSLxfdRDAg1ATqQu_s5MWYF045Rlc3OH01duvrL2rqlP9VSQxCEodiePX/exec';
// DB連携は db_integration.js に分離済み

// ===== Data =====
const patients = [
  { id:'P001', name:'田中太郎', age:75, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1951-03-15', address:'愛知県北名古屋市西之保犬井190', phone:'0568-22-XXXX', nameKana:'タナカタロウ', allergies:['ペニシリン系'], history:['高血圧症','2型糖尿病'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 あ 12-34',lane:1}, status:'active', memo:'定期処方。血圧コントロール良好。', insurancePhoto:null, insSymbol:'12345', insNumber:'678', insEdaban:'01', insuranceNumber:'12345-678(01)', insurerNumber:'39230010', kouhiNumber:'', kouhiEdaban:'', recipientEdaban:'', incomeLevel:'ippan', iryoHobetsu:'', iryoRecipientEdaban:'', questionnaire:null, arrivedAt:'09:00', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'},{date:'2026-01-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'}], pastVitals:[{date:'2026-02-18',t:'36.2',bp:'132/78',spo2:'97',p:'68'},{date:'2026-01-18',t:'36.4',bp:'128/76',spo2:'98',p:'72'}] },
  { id:'P002', name:'鈴木花子', age:45, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1981-07-22', address:'愛知県名古屋市中区栄3-1-1', phone:'052-XXX-XXXX', nameKana:'スズキハナコ', allergies:[], history:['花粉症'], prevRx:[{drugId:'montelukast10',qty:1,unit:'T'}], prevDays:14, prevVisitDate:'2026-03-04', vehicle:{plate:'名古屋 300 い 56-78',lane:2}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:30',symptoms:'鼻水、くしゃみ',duration:'3日前から',temperature:'36.4',otherComplaints:'目のかゆみ'}, arrivedAt:'09:15', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-04',cc:'花粉症',diag:'アレルギー性鼻炎',rx:'モンテルカスト10mg 1T 14日',doc:'院長'}], pastVitals:[{date:'2026-03-04',t:'36.4',bp:'118/72',spo2:'99',p:'76'}] },
  { id:'P003', name:'佐藤一郎', age:62, sex:'男', insurance:'国保3割', ratio:0.3, dob:'1964-11-05', address:'愛知県北名古屋市久地野牧野55', phone:'0568-XX-XXXX', nameKana:'サトウイチロウ', allergies:['セフェム系'], history:['脂質異常症'], prevRx:[{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 う 90-12',lane:3}, status:'waiting', memo:'LDLコレステロール要フォロー', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:22', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'脂質異常症',rx:'アトルバスタチン10mg 1T 28日',doc:'副院長'}], pastVitals:[{date:'2026-02-18',t:'36.3',bp:'140/88',spo2:'96',p:'74'}] },
  { id:'P004', name:'山田美咲', age:38, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1988-04-10', address:'愛知県清須市清洲2272', phone:'052-XXX-XXXX', nameKana:'ヤマダミサキ', allergies:[], history:['片頭痛'], prevRx:[{drugId:'loxoprofen60',qty:3,unit:'T'},{drugId:'rebamipide100',qty:3,unit:'T'}], prevDays:7, prevVisitDate:'2026-03-11', vehicle:{plate:'名古屋 300 え 34-56',lane:4}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:45',symptoms:'頭痛',duration:'昨日から',temperature:'36.8',otherComplaints:'吐き気あり'}, arrivedAt:'09:35', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-11',cc:'頭痛',diag:'片頭痛',rx:'ロキソプロフェン60mg 3T, レバミピド100mg 3T 7日',doc:'院長'}], pastVitals:[] },
  { id:'P005', name:'高橋健二', age:82, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1944-01-20', address:'愛知県北名古屋市西春駅前1-1', phone:'0568-XX-XXXX', nameKana:'タカハシケンジ', allergies:['ロキソプロフェン'], history:['2型糖尿病','高血圧症'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'},{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 お 78-90',lane:5}, status:'waiting', memo:'HbA1c 7.2%。次回採血予定。', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:50', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'2型糖尿病, 高血圧症',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T, アトルバスタチン10mg 1T 28日',doc:'院外'}], pastVitals:[{date:'2026-02-18',t:'36.5',bp:'138/82',spo2:'95',p:'70'}] }
];

// v0.11: 旧データ（insuranceNumber一体型）からの自動マイグレーション
patients.forEach(function(p) {
  if (!p.insSymbol && !p.insNumber && p.insuranceNumber) {
    var m = p.insuranceNumber.match(/^(.+?)[-ー](.+?)(?:\s*[\(（](?:枝)?(\d{1,2})[\)）])?$/);
    if (m) { p.insSymbol = m[1].replace(/^記号/, ''); p.insNumber = m[2].replace(/^番号/, ''); p.insEdaban = m[3] || ''; }
    else { p.insSymbol = ''; p.insNumber = p.insuranceNumber; p.insEdaban = ''; }
  }
  if (p.insSymbol === undefined) p.insSymbol = '';
  if (p.insNumber === undefined) p.insNumber = '';
  if (p.insEdaban === undefined) p.insEdaban = '';
  if (p.kouhiEdaban === undefined) p.kouhiEdaban = '';
  if (p.recipientEdaban === undefined) p.recipientEdaban = '';
  if (p.iryoHobetsu === undefined) p.iryoHobetsu = '';
  if (p.iryoRecipientEdaban === undefined) p.iryoRecipientEdaban = '';
});

const drugs = [
  { id:'amlodipine5', name:'アムロジピン錠5mg', price:10.1, unit:'T', category:'降圧' },
  { id:'amlodipine2.5', name:'アムロジピン錠2.5mg', price:10.1, unit:'T', category:'降圧' },
  { id:'metformin500', name:'メトホルミン錠500mg', price:10.1, unit:'T', category:'糖尿病' },
  { id:'metformin250', name:'メトホルミン錠250mg', price:10.1, unit:'T', category:'糖尿病' },
  { id:'atorvastatin10', name:'アトルバスタチン錠10mg', price:14.5, unit:'T', category:'脂質' },
  { id:'atorvastatin5', name:'アトルバスタチン錠5mg', price:11.8, unit:'T', category:'脂質' },
  { id:'montelukast10', name:'モンテルカスト錠10mg', price:14.5, unit:'T', category:'アレルギー' },
  { id:'fexofenadine60', name:'フェキソフェナジン錠60mg', price:10.1, unit:'T', category:'アレルギー' },
  { id:'loxoprofen60', name:'ロキソプロフェン錠60mg', price:5.7, unit:'T', category:'鎮痛' },
  { id:'acetaminophen200', name:'アセトアミノフェン錠200mg', price:5.7, unit:'T', category:'鎮痛' },
  { id:'acetaminophen500', name:'アセトアミノフェン錠500mg', price:7.0, unit:'T', category:'鎮痛' },
  { id:'rebamipide100', name:'レバミピド錠100mg', price:10.1, unit:'T', category:'胃腸' },
  { id:'lansoprazole15', name:'ランソプラゾールOD錠15mg', price:10.4, unit:'T', category:'胃腸' },
  { id:'domperidone10', name:'ドンペリドン錠10mg', price:5.7, unit:'T', category:'胃腸' },
  { id:'loperamide1', name:'ロペラミド錠1mg', price:5.7, unit:'T', category:'胃腸' },
  { id:'carbocisteine500', name:'カルボシステイン錠500mg', price:7.0, unit:'T', category:'咳・痰' },
  { id:'dextromethorphan15', name:'デキストロメトルファン錠15mg', price:5.7, unit:'T', category:'咳・痰' },
  { id:'tranexamic250', name:'トラネキサム酸錠250mg', price:10.1, unit:'T', category:'咳・痰' },
  { id:'prednisolone5', name:'プレドニゾロン錠5mg', price:5.7, unit:'T', category:'ステロイド' },
  { id:'losartan50', name:'ロサルタンカリウム錠50mg', price:10.1, unit:'T', category:'降圧' }
];

const defaultSetOrders = [
  { name:'風邪セット', items:[{drugId:'acetaminophen200',qty:3},{drugId:'carbocisteine500',qty:3},{drugId:'tranexamic250',qty:3},{drugId:'rebamipide100',qty:3}], days:5, builtin:true },
  { name:'胃腸炎セット', items:[{drugId:'domperidone10',qty:3},{drugId:'rebamipide100',qty:3},{drugId:'loperamide1',qty:1}], days:5, builtin:true },
  { name:'高血圧セット', items:[{drugId:'amlodipine5',qty:1}], days:28, builtin:true },
  { name:'花粉症セット', items:[{drugId:'fexofenadine60',qty:2},{drugId:'montelukast10',qty:1}], days:14, builtin:true }
];
let setOrders = loadSetOrders();
function loadSetOrders() { try { const s = localStorage.getItem('karte_setOrders'); if (s) return JSON.parse(s); } catch(e) {} return JSON.parse(JSON.stringify(defaultSetOrders)); }
// ★2026-08-20: セット処方はブラウザのlocalStorageにしか無く、PCを変えると消え、他端末と共有されなかった。
//   Supabaseの set_orders を正とし、localStorage はオフライン用の控えとして残す。
function saveSetOrders() {
  localStorage.setItem('karte_setOrders', JSON.stringify(setOrders));   // 控え
  if (typeof saveSetOrdersToSupabase !== 'function') return;
  saveSetOrdersToSupabase(setOrders, 'nishiharu').then(function (r) {
    if (r && r.success) { console.log('[Supabase] セット処方を保存 ' + r.count + '件'); return; }
    showSaveError('セット処方の保存', (r && r.error) ? r.error : '原因不明',
      function () { saveSetOrders(); });
  }).catch(function (e) {
    showSaveError('セット処方の保存', (e && e.message) ? e.message : String(e), function () { saveSetOrders(); });
  });
}

// 起動時にSupabaseの内容で置き換える（0件のときは既存を消さない）
function syncSetOrdersFromSupabase() {
  if (typeof fetchSetOrdersFromSupabase !== 'function') return Promise.resolve();
  return fetchSetOrdersFromSupabase('nishiharu').then(function (r) {
    if (!r || !r.success) { console.warn('[Supabase] セット処方の取得に失敗:', r && r.error); return; }
    if (!r.rows.length) { console.log('[Supabase] セット処方は0件のためローカルを維持'); return; }
    setOrders = r.rows.map(function (x) {
      return { name: x.name, days: x.days || 7, items: x.items || [], builtin: false };
    });
    localStorage.setItem('karte_setOrders', JSON.stringify(setOrders));
    if (typeof renderSetOrders === 'function') renderSetOrders();
    console.log('[Supabase] セット処方を取得 ' + setOrders.length + '件');
  }).catch(function (e) { console.warn('[Supabase] セット処方の取得で例外:', e); });
}

const diseases = [
  {code:'J069',name:'急性上気道感染症'},{code:'J00',name:'急性鼻咽頭炎（かぜ）'},{code:'J039',name:'急性扁桃炎'},
  {code:'J209',name:'急性気管支炎'},{code:'J304',name:'アレルギー性鼻炎'},{code:'J459',name:'喘息'},
  {code:'K529',name:'急性胃腸炎'},{code:'K21',name:'胃食道逆流症'},{code:'K2900',name:'急性胃炎'},
  {code:'I10',name:'高血圧症'},{code:'E119',name:'2型糖尿病'},{code:'E785',name:'脂質異常症'},
  {code:'G439',name:'片頭痛'},{code:'M545',name:'腰痛症'},{code:'R509',name:'発熱'},
  {code:'N390',name:'膀胱炎'},{code:'L300',name:'湿疹'},{code:'B349',name:'ウイルス感染症'},
  {code:'R05',name:'咳嗽'},{code:'U071',name:'COVID-19'}
];
const quickDiseases = ['急性上気道感染症','アレルギー性鼻炎','高血圧症','2型糖尿病','急性胃腸炎','片頭痛'];

const examItems = [
  {id:'blood_general',name:'血液一般',points:21},{id:'blood_biochem',name:'生化学検査',points:11},
  {id:'crp',name:'CRP',points:16},{id:'hba1c',name:'HbA1c',points:49},
  {id:'urinalysis',name:'尿一般',points:26},{id:'ecg',name:'心電図',points:130},
  {id:'xray_chest',name:'胸部X線',points:210},{id:'covid_antigen',name:'コロナ抗原',points:150},
  {id:'flu_antigen',name:'インフル抗原',points:150},{id:'spo2_monitor',name:'SpO2モニタ',points:30}
];

// ===== Billing Menu Master (Phase 4 -> v0.7: 令和8年改定対応) =====
// 点数マスタは billing_revision_2026.js の BILLING_MASTER に移管
// selectedDate に基づき getBillingMenuItems() で新旧を自動切替
function getActiveBillingMenu() {
  return getBillingMenuItems(selectedDate);
}
let currentBillingTab = 'initial';

// ===== State =====
let currentScreen = 'list';
let currentPatientId = null;
let patientHistory = [];
let karteData = {};
let examStartTime = null;
let selectedDate = new Date().toISOString().split('T')[0];
let currentPatientTab = 'basic';

function initKarteData() {
  patients.forEach(p => {
    karteData[p.id] = {
      chiefComplaint:'', chiefComplaintSelect:'',
      findingsHtml:'',
      vitals:{t:'',bps:'',bpd:'',spo2:'',pulse:''},
      selectedDiseases:[], prescriptions:[], rxDays:7, rxModeExternal:false,
      isFirstVisit: !p.prevVisitDate,
      selectedExams:[], addedBillingItems:[], excludedBillingRows:{}
    };
  });
}
initKarteData();

// ===== Clock =====
function updateClock() {
  const d = new Date();
  const t = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0')+':'+d.getSeconds().toString().padStart(2,'0');
  const c1 = document.getElementById('clockList');
  const c2 = document.getElementById('clockKarte');
  if (c1) c1.textContent = t;
  if (c2) c2.textContent = t;
}
setInterval(updateClock, 1000);
updateClock();

// ===== Screen Switching =====
function showScreen(name) {
  currentScreen = name;
  document.getElementById('screenList').classList.toggle('active', name === 'list');
  document.getElementById('screenKarte').classList.toggle('active', name === 'karte');
}

function goToList() {
  if (currentPatientId) {
    saveCurrentKarte();
    const k = karteData[currentPatientId];
    const editor = document.getElementById('findingsEditor');
    const hasData = k.chiefComplaint || (editor && editor.innerHTML.trim()) || k.prescriptions.length > 0 || k.selectedDiseases.length > 0;
    if (hasData && !confirm('一覧に戻ります。\n入力中のデータは一時保存しますか？\n\nOK = 一時保存して戻る\nキャンセル = 保存せず戻る')) {
      // skip
    } else if (hasData) {
      saveKarteDraft();
    }
  }
  showScreen('list');
  renderPatientList();
}

function openKarte(patientId) {
  currentPatientId = patientId;
  patientHistory = [];
  examStartTime = null;
  document.getElementById('examStartBtn').textContent = '診察開始';
  document.getElementById('examStartBtn').classList.remove('active');
  showScreen('karte');
  populatePatientSelect();
  renderAllKarte();
}

// ===== SCREEN 1: Patient List =====
function getPatientsForDate(date) {
  // ISO日付 "2026-04-13" → "4/13" に変換
  const md = isoToMD(date);
  return patients.filter(p => {
    // 通常患者: visitDate一致
    if (p.visitDate === date) return true;
    // DB患者: dbVisitsに該当日の来院がある
    if (p.dbSource && p.dbVisits) {
      return p.dbVisits.some(v => v.date === md);
    }
    return false;
  });
}
function isoToMD(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  return parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

// ===== 支払方法（要望#6後半） =====
// 方針（ユーザー確定 2026-08-05）: 一旦スタッフの手入力（選択式）。デジスマ側との連携は行わない。
// ※ 現状は患者単位で保持する簡易版。受診ごとに分けたい場合はカルテ側へ移す。
const PAY_METHODS = ['デジスマ', '現金', 'その他'];
function payMethodCellHtml(p) {
  const cur = p.payMethod || '';
  let h = '<select class="pay-select' + (cur ? ' set' : '') + '" onclick="event.stopPropagation()"' +
          ' onchange="event.stopPropagation();setPayMethod(\'' + p.id + '\',this.value)">';
  h += '<option value=""' + (cur ? '' : ' selected') + '>-</option>';
  PAY_METHODS.forEach(m => { h += '<option' + (cur === m ? ' selected' : '') + '>' + esc(m) + '</option>'; });
  return h + '</select>';
}
function setPayMethod(id, v) {
  const p = patients.find(x => x.id === id);
  if (!p) return;
  p.payMethod = v;
  savePatientToApi(p);
  renderPatientList();
  showToast(v ? '支払方法: ' + v : '支払方法をクリア');
}
// 患者マスタ送信（項目を落とさないよう常に同じ形で送る）
function savePatientToApi(p) {
  postToApi('savePatient', {
    '患者ID': p.id, '氏名': p.name, 'フリガナ': p.nameKana || '', '生年月日': p.dob || '',
    '年齢': p.age, '性別': p.sex, '住所': p.address || '', '電話番号': p.phone || '',
    'アレルギー': (p.allergies || []).join(','), 'メモ': p.memo || '', '支払方法': p.payMethod || ''
  });
}

// 患者一覧「前回受付」列（要望#6）
// 通常患者は prevVisitDate、DB患者は dbVisits から「今回より前の最新来院日」を出す。
// ※ dbVisits の date は年を持たない "M/D" 形式のため、年跨ぎは判定できない（同年内の比較に留める）。
function prevVisitLabel(p) {
  if (p.dbSource && p.dbVisits && p.dbVisits.length) {
    const toNum = md => { const a = String(md).split('/'); return (parseInt(a[0])||0) * 100 + (parseInt(a[1])||0); };
    const curN = toNum(isoToMD(selectedDate));
    const past = p.dbVisits.map(v => v.date).filter(d => toNum(d) < curN).sort((a,b) => toNum(b) - toNum(a));
    return past.length ? past[0] : '-';
  }
  return p.prevVisitDate ? p.prevVisitDate.replace(/-/g, '/') : '-';
}

function renderPatientList() {
  showDateShift(selectedDate);
  const tbody = document.getElementById('patientListBody');
  let filtered = getPatientsForDate(selectedDate);
  // 元の登録番号を保持（ソート前の順番）
  filtered.forEach((p, i) => { p._origNum = i + 1; });
  // 機能7: ソート（昇順/降順対応）
  const dir = currentSortAsc ? 1 : -1;
  if (currentSortMode === 'name') {
    filtered.sort((a,b) => dir * (a.nameKana||a.name).localeCompare(b.nameKana||b.name, 'ja'));
  } else if (currentSortMode === 'status') {
    const ord = {active:0, waiting:1, done:2};
    filtered.sort((a,b) => dir * ((ord[a.status]||1) - (ord[b.status]||1)));
  } else if (currentSortMode === 'arrival') {
    filtered.sort((a,b) => dir * ((a.arrivedAt||'99:99').localeCompare(b.arrivedAt||'99:99')));
  } else if (currentSortMode === 'number') {
    filtered.sort((a,b) => dir * (a._origNum - b._origNum));
  }
  let waitC = 0, activeC = 0, doneC = 0;
  if (filtered.length === 0) {
    const dbCount = patients.filter(p => p.dbSource).length;
    const dbMsg = dbCount > 0 ? '<br><span style="font-size:12px;">DB患者 ' + dbCount + '名あり → 上部の「DB患者一覧」から参照できます</span>' : '';
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">この日の受付患者はいません' + dbMsg + '</td></tr>';
    document.getElementById('listWait').textContent = 0;
    document.getElementById('listActive').textContent = 0;
    document.getElementById('listDone').textContent = 0;
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    if (p.dbSource) {
      // DB患者行
      const md = isoToMD(selectedDate);
      const visit = p.dbVisits ? p.dbVisits.find(v => v.date === md) : null;
      const time = visit ? (visit.time || '') : '';
      const doctor = visit ? (visit.doctor || '') : '';
      const tests = visit ? [visit.covid ? 'C+' : '', visit.flu ? 'Flu+' : '', visit.strep ? '溶+' : ''].filter(Boolean).join(' ') : '';
      const typeBadge = p.type === '新規' ? '<span class="status-badge" style="background:#dcfce7;color:#16a34a;">新規</span>' : '<span class="status-badge" style="background:#dbeafe;color:#2563eb;">再診</span>';
      return '<tr onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;background:#f8faff;"><td>' + (p._origNum||i+1) + '</td><td class="td-status">' + typeBadge + '</td><td class="td-name">' + esc(p.name) + '<div class="sub">DB / ' + esc(p.address || '') + ' / ' + esc(time) + '</div></td><td>' + esc(p.age) + '歳 ' + esc(p.sex) + '</td><td>' + esc(p.insurance) + '</td><td class="td-memo" title="' + esc(p.memo || tests || '') + '">' + esc(p.memo || tests || '-') + '</td><td class="td-lastvisit">' + esc(prevVisitLabel(p)) + '</td><td class="td-pay">-</td><td class="td-lane">' + esc(doctor) + '</td><td class="td-questionnaire">' + esc(p.route || '-') + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button></td></tr>';
    }
    if (p.status === 'waiting') waitC++; else if (p.status === 'active') activeC++; else if (p.status === 'done') doneC++;
    const statusBadge = p.status === 'active' ? '<span class="status-badge active">診察中</span>' : p.status === 'done' ? '<span class="status-badge done">完了</span>' : '<span class="status-badge waiting">待機</span>';
    const memoStr = (p.memo || '').replace(/\s+/g, ' ').trim();
    const qBadge = p.questionnaire ? '<span class="q-badge received">受信済</span>' : '<span class="q-badge none">-</span>';
    const rowClass = p.status === 'done' ? ' class="status-done-row"' : '';
    return '<tr' + rowClass + ' onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;"><td>' + (p._origNum||i+1) + '</td><td class="td-status">' + statusBadge + '</td><td class="td-name">' + esc(p.name) + '<div class="sub">' + esc(p.nameKana||'') + ' / ' + esc(p.id) + ' / ' + esc(p.arrivedAt||'') + '</div></td><td>' + esc(p.age) + '歳 ' + esc(p.sex) + '</td><td>' + esc(p.insurance) + '</td><td class="td-memo" title="' + esc(memoStr) + '">' + esc(memoStr || '-') + '</td><td class="td-lastvisit">' + esc(prevVisitLabel(p)) + '</td><td class="td-pay">' + payMethodCellHtml(p) + '</td><td class="td-lane">L' + esc(p.vehicle.lane) + '</td><td class="td-questionnaire">' + qBadge + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button>' + (p.status === 'waiting' ? '<button class="action-btn call-btn" onclick="event.stopPropagation();callPatientFromList(\'' + p.id + '\')">呼出</button>' : '') + '</td></tr>';
  }).join('');
  document.getElementById('listWait').textContent = waitC;
  document.getElementById('listActive').textContent = activeC;
  document.getElementById('listDone').textContent = doneC;
}

function callPatientFromList(id) {
  const current = patients.find(p => p.status === 'active');
  if (current) current.status = 'done';
  const p = patients.find(x => x.id === id);
  p.status = 'active';
  renderPatientList();
  showToast(p.name + 'さんを呼び出しました（レーン' + p.vehicle.lane + '）');
}

function changeDate(delta) { const d = new Date(selectedDate); d.setDate(d.getDate()+delta); selectedDate = d.toISOString().split('T')[0]; document.getElementById('listDate').value = selectedDate; renderPatientList(); if (typeof updateRevisionBadge === 'function') updateRevisionBadge(); if (typeof loadDbDataForDate === 'function') loadDbDataForDate(selectedDate); }
function setToday() { selectedDate = new Date().toISOString().split('T')[0]; document.getElementById('listDate').value = selectedDate; renderPatientList(); if (typeof updateRevisionBadge === 'function') updateRevisionBadge(); if (typeof loadDbDataForDate === 'function') loadDbDataForDate(selectedDate); }
function onDateChange() { selectedDate = document.getElementById('listDate').value; renderPatientList(); if (typeof updateRevisionBadge === 'function') updateRevisionBadge(); if (typeof loadDbDataForDate === 'function') loadDbDataForDate(selectedDate); }

// ===== New Patient (Phase 5 - enhanced) =====
function openNewPatientModal() {
  ['newName','newNameKana','newPhone','newPhone2','newPlate','newFacility','newZip','newPref','newCity','newStreet','newBuilding','newInsurerNumber'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('newDob').value = '';
  syncWarekiFromDob('new');                        // 要望#3: 和暦欄もクリア
  document.getElementById('newLane').value = patients.length + 1;
  document.getElementById('newPatientNo').value = 'P-' + String(patients.length + 1).padStart(5, '0');
  document.querySelector('input[name="newSex"][value="男"]').checked = true;
  document.getElementById('newInsurance').value = '社保3割';
  document.getElementById('newPayMethod').value = '';   // 要望#6
  // OCR状態をクリア
  clearOcrPreview();
  stopOcrCamera();
  const statusEl = document.getElementById('newInsurerStatus');
  if (statusEl) statusEl.textContent = '';
  const hint = document.getElementById('newNameGuess');
  if (hint) hint.style.display = 'none';
  document.getElementById('newPatientModal').classList.add('show');
}

// ===== OCR: 保険証読取機能 =====





// === OCRフィールド厳格バリデーション ===
// 間違った値を入れるより空白の方が遥かに安全。不正な値は容赦なく却下する。


/**
 * QRコード結果とOCR結果をマージ
 * QRコードのデータは100%信頼。OCRは個人情報のフォールバック。
 */



function buildInsuranceNumberStr(fields) {
  if (!fields) return '';
  const parts = [];
  if (fields.symbol) parts.push(fields.symbol);
  if (fields.memberNumber) parts.push(fields.memberNumber);
  if (parts.length === 0) return '';
  let str = parts.join('-');
  if (fields.edaban && fields.edaban !== '00') str += '(' + fields.edaban + ')';
  return str;
}


// 郵便番号 → 都道府県/市区町村 自動入力（要望#2でカルテ内の患者情報編集からも使えるようID指定を可能にした）
function autoFillAddress(zip, prefId, cityId) {
  prefId = prefId || 'newPref'; cityId = cityId || 'newCity';
  const cleaned = zip.replace(/[^0-9]/g, '');
  if (cleaned.length === 7) {
    fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + cleaned)
      .then(r => r.json())
      .then(data => {
        if (data.results && data.results[0]) {
          const r = data.results[0];
          const pe = document.getElementById(prefId), ce = document.getElementById(cityId);
          if (pe) pe.value = r.address1;
          if (ce) ce.value = r.address2 + r.address3;
        }
      }).catch(() => {});
  }
}

// ===== 住所の分割⇔連結（要望#2） =====
// 患者データは分割項目(zip/pref/city/street/building)を持ちつつ、従来の1本の address も維持する。
// これにより既存データ・GAS連携（'住所'1列）・一覧表示は一切変更せずに済む。
function composeAddress(a) {
  return [a.pref || '', a.city || '', a.street || '', a.building || ''].filter(Boolean).join(' ').trim();
}
function splitAddress(p) {
  if (p.pref || p.city || p.street || p.building) {
    return { zip: p.zip || '', pref: p.pref || '', city: p.city || '', street: p.street || '', building: p.building || '' };
  }
  // 旧データ（1本の住所）は「〜都道府県」「〜市区町村」で推定分解する。分解できない場合は番地欄へそのまま入れる。
  const addr = (p.address || '').trim();
  const m = addr.match(/^\s*(.+?[都道府県])\s*(.+?[市区町村])\s*(.*)$/);
  if (m) return { zip: p.zip || '', pref: m[1], city: m[2], street: m[3].trim(), building: '' };
  return { zip: p.zip || '', pref: '', city: '', street: addr, building: '' };
}

// ===== 和暦入力（要望#3） =====
// 元号の切替日は正確な日付で判定する（例: 1989-01-07 は昭和64年、01-08 から平成元年）。
const WAREKI_ERAS = [
  { name: '令和', start: '2019-05-01', base: 2018 },
  { name: '平成', start: '1989-01-08', base: 1988 },
  { name: '昭和', start: '1926-12-25', base: 1925 },
  { name: '大正', start: '1912-07-30', base: 1911 },
  { name: '明治', start: '1868-01-25', base: 1867 }
];
function isoToWarekiParts(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const e = WAREKI_ERAS.find(x => iso >= x.start);
  if (!e) return null;
  const parts = iso.split('-').map(Number);
  return { era: e.name, year: parts[0] - e.base, month: parts[1], day: parts[2] };
}
function warekiPartsToIso(eraName, wy, m, d) {
  const e = WAREKI_ERAS.find(x => x.name === eraName);
  if (!e || !wy || !m || !d) return '';
  const y = e.base + Number(wy);
  const pad = n => String(n).padStart(2, '0');
  const iso = y + '-' + pad(m) + '-' + pad(d);
  const dt = new Date(iso + 'T00:00:00');
  if (isNaN(dt.getTime()) || dt.getDate() !== Number(d) || dt.getMonth() + 1 !== Number(m)) return '';
  return iso;
}
// 和暦欄 → 西暦欄
function onWarekiInput(prefix) {
  const era = document.getElementById(prefix + 'WEra');
  const wy = document.getElementById(prefix + 'WY');
  const wm = document.getElementById(prefix + 'WM');
  const wd = document.getElementById(prefix + 'WD');
  const dob = document.getElementById(prefix + 'Dob');
  if (!era || !wy || !wm || !wd || !dob) return;
  const iso = warekiPartsToIso(era.value, wy.value, wm.value, wd.value);
  if (iso) dob.value = iso;
}
// 西暦欄 → 和暦欄
function onDobInput(prefix) { syncWarekiFromDob(prefix); }
function syncWarekiFromDob(prefix) {
  const dob = document.getElementById(prefix + 'Dob');
  const era = document.getElementById(prefix + 'WEra');
  const wy = document.getElementById(prefix + 'WY');
  const wm = document.getElementById(prefix + 'WM');
  const wd = document.getElementById(prefix + 'WD');
  if (!dob || !era || !wy || !wm || !wd) return;
  const parts = isoToWarekiParts(dob.value);
  if (!parts) { era.value = ''; wy.value = ''; wm.value = ''; wd.value = ''; return; }
  era.value = parts.era; wy.value = parts.year; wm.value = parts.month; wd.value = parts.day;
}

// v0.4: 新規受付の保険者番号リアルタイム判定
function onNewInsurerNumberInput(val) {
  const num = val.replace(/[^0-9]/g, '');
  const statusEl = document.getElementById('newInsurerStatus');
  if (num.length < 6) { statusEl.textContent = ''; return; }
  if (num.length !== 6 && num.length !== 8) { statusEl.innerHTML = '<span style="color:var(--danger);">桁数不正</span>'; return; }
  const parsed = parseInsurerNumber(num);
  if (parsed.valid) {
    statusEl.innerHTML = '<span style="color:var(--success);">&#10003; ' + esc(parsed.houbetsuName) + '（' + esc(parsed.prefName || '') + '）</span>';
    // 保険種別セレクトを自動設定
    const sel = document.getElementById('newInsurance');
    const dob = document.getElementById('newDob').value;
    if (dob) {
      const result = calcCopayRate(num, dob, {});
      // 保険種別とセレクト値のマッピング
      const rateLabel = Math.round(result.finalRate * 10) + '割';
      if (result.insuranceCategory === '後期高齢者') {
        sel.value = '後期高齢者' + rateLabel;
      } else if (result.insuranceCategory === '国保') {
        sel.value = '国保' + rateLabel;
      } else {
        sel.value = '社保' + rateLabel;
      }
    } else {
      if (parsed.insuranceCategory === '国保') sel.value = '国保3割';
      else if (parsed.insuranceCategory === '後期高齢者') sel.value = '後期高齢者1割';
      else sel.value = '社保3割';
    }
  } else {
    statusEl.innerHTML = '<span style="color:var(--danger);">' + esc(parsed.errors.join(', ')) + '</span>';
  }
}

function addNewPatient(andOpen) {
  const name = document.getElementById('newName').value.trim();
  const kana = document.getElementById('newNameKana').value.trim();
  if (!name) { showToast('氏名を入力してください'); return; }
  if (!kana || !/^[ァ-ヶー\s　]+$/.test(kana)) { showToast('カナ氏名を全角カタカナで入力してください'); return; }
  const dob = document.getElementById('newDob').value;
  if (!dob) { showToast('生年月日を入力してください'); return; }
  let age = 0;
  if (dob) { const today = new Date(); const b = new Date(dob); age = today.getFullYear() - b.getFullYear(); const m = today.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--; }
  const sex = document.querySelector('input[name="newSex"]:checked').value;
  const ins = document.getElementById('newInsurance').value;
  let ratio = 0.3;
  if (ins.includes('1割')) ratio = 0.1; else if (ins.includes('2割')) ratio = 0.2; else if (ins === '公費') ratio = 0;
  // v0.4: 保険者番号フィールドがあれば自動判定で上書き
  const newInsurerNum = document.getElementById('newInsurerNumber');
  if (newInsurerNum && newInsurerNum.value.replace(/[^0-9]/g, '').length >= 6) {
    const calcResult = calcCopayRate(newInsurerNum.value, dob, {});
    ratio = calcResult.finalRate;
  }
  const pref = document.getElementById('newPref').value;
  const city = document.getElementById('newCity').value;
  const street = document.getElementById('newStreet').value;
  const building = document.getElementById('newBuilding').value;
  const zip = (document.getElementById('newZip') || {}).value || '';
  const address = [pref, city, street, building].filter(Boolean).join(' ');
  const now = new Date();
  const newP = {
    id: document.getElementById('newPatientNo').value || ('P' + (Date.now() % 100000)),
    name, nameKana: kana, age, sex, insurance: ins, ratio, dob, address,
    zip: zip.trim(), pref, city, street, building,   // 要望#2: 分割項目も保持
    payMethod: (document.getElementById('newPayMethod') || {}).value || '',   // 要望#6
    phone: document.getElementById('newPhone').value,
    allergies: [], history: [], prevRx: [], prevDays: 0, prevVisitDate: '',
    vehicle: { plate: document.getElementById('newPlate').value || '---', lane: parseInt(document.getElementById('newLane').value) || 1 },
    status: andOpen ? 'waiting' : 'waiting', memo: '',
    insurancePhoto: (ocrExtracted && ocrExtracted._imageData) ? ocrExtracted._imageData : null, insSymbol: (ocrExtracted && ocrExtracted.symbol) || '', insNumber: (ocrExtracted && ocrExtracted.memberNumber) || '', insEdaban: (ocrExtracted && ocrExtracted.edaban) || '', insuranceNumber: buildInsuranceNumberStr(ocrExtracted), insurerNumber: (newInsurerNum ? newInsurerNum.value : ''), kouhiNumber: '', kouhiEdaban: '', recipientEdaban: '', incomeLevel: 'ippan', iryoHobetsu: '', iryoRecipientEdaban: '', questionnaire: null,
    arrivedAt: now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'),
    visitDate: selectedDate, pastKartes: [], pastVitals: []
  };
  patients.push(newP);
  karteData[newP.id] = { chiefComplaint:'', chiefComplaintSelect:'', findingsHtml:'', vitals:{t:'',bps:'',bpd:'',spo2:'',pulse:''}, selectedDiseases:[], prescriptions:[], rxDays:7, isFirstVisit:true, selectedExams:[], addedBillingItems:[], excludedBillingRows:{} };
  postToApi('savePatient', { '患者ID': newP.id, '氏名': newP.name, 'フリガナ': newP.nameKana, '生年月日': newP.dob, '年齢': newP.age, '性別': newP.sex, '住所': newP.address, '電話番号': newP.phone, 'アレルギー': '', '既往歴': '', 'メモ': '' });
  closeModal('newPatientModal');
  renderPatientList();
  showToast(name + 'さんを' + (andOpen ? '受付登録' : '登録') + 'しました');
  if (andOpen) openKarte(newP.id);
}

// ===== SCREEN 2: Karte Dashboard =====
function populatePatientSelect() {
  const sel = document.getElementById('patientSelect'); sel.innerHTML = '';
  patients.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name + ' (' + p.id + ')'; sel.appendChild(opt); });
  if (currentPatientId) sel.value = currentPatientId;
}

function switchPatient(id, addToHistory) {
  saveCurrentKarte();
  if (addToHistory !== false && currentPatientId && currentPatientId !== id) patientHistory.push(currentPatientId);
  currentPatientId = id;
  document.getElementById('patientSelect').value = id;
  examStartTime = null;
  document.getElementById('examStartBtn').textContent = '診察開始';
  document.getElementById('examStartBtn').classList.remove('active');
  renderAllKarte();
}

function saveCurrentKarte() {
  if (!currentPatientId) return;
  const k = karteData[currentPatientId]; if (!k) return;
  k.chiefComplaint = document.getElementById('chiefComplaint').value;
  k.chiefComplaintSelect = document.getElementById('chiefComplaintSelect').value;
  const editor = document.getElementById('findingsEditor');
  if (editor) k.findingsHtml = editor.innerHTML;
  k.vitals.t = document.getElementById('vitalT').value;
  k.vitals.bps = document.getElementById('vitalBPS').value;
  k.vitals.bpd = document.getElementById('vitalBPD').value;
  k.vitals.spo2 = document.getElementById('vitalSpO2').value;
  k.vitals.pulse = document.getElementById('vitalP').value;
  k.rxDays = parseInt(document.getElementById('rxDays').value) || 7;
  const extChk = document.getElementById('rxModeExternal');
  if (extChk) k.rxModeExternal = extChk.checked;
  const memoEl = document.getElementById('patientMemo');
  if (memoEl) { const p = patients.find(x => x.id === currentPatientId); if (p) p.memo = memoEl.value; }
}

function loadCurrentKarte() {
  const k = karteData[currentPatientId];
  document.getElementById('chiefComplaint').value = k.chiefComplaint;
  document.getElementById('chiefComplaintSelect').value = k.chiefComplaintSelect || '';
  const editor = document.getElementById('findingsEditor');
  if (editor) editor.innerHTML = k.findingsHtml || '';
  document.getElementById('vitalT').value = k.vitals.t;
  document.getElementById('vitalBPS').value = k.vitals.bps;
  document.getElementById('vitalBPD').value = k.vitals.bpd;
  document.getElementById('vitalSpO2').value = k.vitals.spo2;
  document.getElementById('vitalP').value = k.vitals.pulse;
  document.getElementById('rxDays').value = k.rxDays;
  const extChk = document.getElementById('rxModeExternal');
  if (extChk) extChk.checked = k.rxModeExternal || false;
}

function renderAllKarte() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  renderHeader(p);
  renderPatientInfoTab(p);
  loadCurrentKarte();
  renderDiseaseQuickBtns();
  renderSelectedDiseases();
  renderRxList();
  renderExamCheckList();
  renderFindingsSnippets();
  recalcBilling();
  renderWaitingList();
  updateSurchargeBadge();
  updatePrevButton();
  renderBillingMenu();
  updateLateClaimBadge();
}

function renderHeader(p) {
  document.getElementById('hdrName').textContent = p.name;
  document.getElementById('hdrKana').textContent = p.nameKana || '';
  document.getElementById('hdrId').textContent = 'ID: ' + p.id;
  document.getElementById('hdrAge').textContent = p.age + '歳';
  document.getElementById('hdrSex').textContent = p.sex;
  document.getElementById('hdrInsurance').textContent = p.insurance;
  document.getElementById('visitDate').textContent = p.visitDate || new Date().toISOString().slice(0, 10);
  document.getElementById('visitInsuranceType').textContent = p.insurance || '---';
  populateDoctorSelect(p);
}

function populateDoctorSelect(p) {
  const sel = document.getElementById('visitDoctor');
  if (!sel) return;
  // シフトデータ＋参照マスタから医師一覧を構築
  const doctors = new Set();
  dbShift.forEach(s => { if (s.doctor) doctors.add(s.doctor); });
  // 固定の選択肢も追加
  ['院長', '副院長'].forEach(d => doctors.add(d));
  sel.innerHTML = '<option value="">---</option>';
  doctors.forEach(d => {
    sel.innerHTML += '<option value="' + esc(d) + '">' + esc(d) + '</option>';
  });
  // DB患者の場合、来院データの担当医を自動選択
  if (p.dbSource && p.dbVisits && p.dbVisits.length > 0) {
    const latestVisit = p.dbVisits[0];
    if (latestVisit.doctor) sel.value = latestVisit.doctor;
  }
  // シフトの当番医をデフォルトとして設定（来院データに担当医がない場合）
  if (!sel.value) {
    const shiftDoc = getShiftDoctor(selectedDate);
    if (shiftDoc) sel.value = shiftDoc;
  }
}

function onVisitInfoChange() {}

// ===== Patient Info Tabs (Phase 3) =====
// バイタルサイン入力欄は常設DOM。表示のみ「バイタル」タブに追従させる
function syncVitalsInputVisibility() {
  const w = document.getElementById('vitalsInputWrap');
  if (w) w.style.display = (currentPatientTab === 'vitals') ? '' : 'none';
}

function switchPatientTab(tab) {
  currentPatientTab = tab;
  document.querySelectorAll('.patient-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  syncVitalsInputVisibility();
  const p = patients.find(x => x.id === currentPatientId);
  if (p) {
    renderPatientInfoTab(p);
    if (tab === 'diseases') {
      renderDiseaseQuickBtns();
      renderSelectedDiseases();
    }
  }
}

function renderPatientInfoTab(p) {
  syncVitalsInputVisibility();
  const body = document.getElementById('patientInfoBody');
  let h = '';
  switch (currentPatientTab) {
    case 'basic':
      h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;"><div class="patient-thumb">' + esc(p.name.charAt(0)) + '</div><div><div style="font-weight:700;font-size:12px;">' + esc(p.name) + '</div><div style="font-size:10px;color:var(--text-muted);">' + esc(p.nameKana||'') + '</div></div></div>';
      h += '<div class="info-row"><span class="label">年齢</span><span class="value">' + esc(p.age) + '歳 (' + esc(p.sex) + ')</span></div>';
      if (p.dob) h += '<div class="info-row"><span class="label">生年月日</span><span class="value">' + esc(toWareki(p.dob)) + ' <span style="font-size:10px;color:var(--text-muted);">(' + esc(p.dob) + ')</span></span></div>';
      if (p.address) h += '<div class="info-row"><span class="label">住所</span><span class="value" style="font-size:10px;">' + esc(p.address) + '</span></div>';
      if (p.phone) h += '<div class="info-row"><span class="label">電話</span><span class="value">' + esc(p.phone) + '</span></div>';
      h += '<div class="info-row"><span class="label">保険</span><span class="value">' + esc(p.insurance) + '</span></div>';
      h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title">問診票' + (p.questionnaire ? ' <span class="questionnaire-badge received">受信済</span>' : ' <span class="questionnaire-badge pending">未受信</span>') + '</div>';
      if (p.questionnaire) {
        h += '<div class="questionnaire-data"><div class="q-row"><span class="q-label">症状</span><span>' + esc(p.questionnaire.symptoms) + '</span></div><div class="q-row"><span class="q-label">期間</span><span>' + esc(p.questionnaire.duration) + '</span></div></div>';
        h += '<button class="edit-btn" style="margin-top:3px;width:100%;text-align:center;" onclick="openQuestionnaireModal()">カルテに反映</button>';
      }
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">前回処方（' + p.prevDays + '日分）</div>';
      p.prevRx.forEach(rx => { const d = drugs.find(x => x.id === rx.drugId); if (d) h += '<div class="prev-rx-item"><span>' + esc(d.name) + '</span><span>' + rx.qty + esc(rx.unit) + '</span></div>'; });
      if (p.prevRx.length > 0) h += '<button class="do-rx-btn" onclick="doRx()">Do処方（前回と同じ）</button>';
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">患者メモ</div><textarea class="patient-memo" id="patientMemo" placeholder="メモを入力...">' + esc(p.memo||'') + '</textarea></div>';
      h += '<div class="info-section"><div class="info-section-title">車両情報</div><div class="vehicle-info"><div class="plate">' + esc(p.vehicle.plate) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px;">レーン ' + esc(p.vehicle.lane) + '</div></div></div>';
      if (p.dbSource) {
        h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title" style="color:#2563eb;">DB情報</div>';
        if (p.route) h += '<div class="info-row"><span class="label">流入経路</span><span class="value">' + esc(p.route) + '</span></div>';
        if (p.type) h += '<div class="info-row"><span class="label">患者種別</span><span class="value">' + esc(p.type) + '</span></div>';
        if (p.address) h += '<div class="info-row"><span class="label">エリア</span><span class="value">' + esc(p.address) + '</span></div>';
        h += '<div class="info-row"><span class="label">来院回数</span><span class="value">' + (p.dbVisits ? p.dbVisits.length : 0) + '回</span></div>';
        if (p.selfPayTotal) h += '<div class="info-row"><span class="label">自己負担累計</span><span class="value">&yen;' + p.selfPayTotal.toLocaleString() + '</span></div>';
        if (p.revenueTotal) h += '<div class="info-row"><span class="label">診療報酬累計</span><span class="value">' + p.revenueTotal.toLocaleString() + '点</span></div>';
        h += '</div>';
      }
      break;

    case 'insurance':
      h += '<div class="info-section"><div class="info-section-title">保険証 <button class="edit-btn" onclick="openInsuranceModal()">詳細</button></div>';
      h += '<div class="insurance-photo-area" onclick="document.getElementById(\'insuranceFileInput\').click()">';
      h += p.insurancePhoto ? '<img src="' + p.insurancePhoto + '">' : '<span style="font-size:18px;">&#128247;</span><span style="font-size:10px;color:var(--text-muted);">タップして撮影</span>';
      h += '</div><input type="file" id="insuranceFileInput" accept="image/*" capture="environment" style="display:none" onchange="handleInsurancePhoto(this,false)">';
      if (p.insSymbol || p.insNumber) {
        h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">記号: ' + esc(p.insSymbol||'') + ' / 番号: ' + esc(p.insNumber||'');
        if (p.insEdaban) h += ' (枝' + esc(p.insEdaban) + ')';
        h += '</div>';
      } else if (p.insuranceNumber) {
        h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">No: ' + esc(p.insuranceNumber) + '</div>';
      }
      if (p.insurerNumber) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:1px;">保険者番号: <span style="font-family:monospace;letter-spacing:0.1em;">' + esc(p.insurerNumber) + '</span></div>';
      h += '</div>';
      h += '<div class="info-row"><span class="label">保険種別</span><span class="value">' + esc(p.insurance) + '</span></div>';
      h += '<div class="info-row"><span class="label">負担割合</span><span class="value" style="font-weight:700;color:var(--primary);">' + (p.ratio * 100) + '%</span></div>';
      if (p.kouhiNumber) {
        var kouhiDisp = esc(p.kouhiNumber);
        if (p.kouhiEdaban) kouhiDisp += ' (枝' + esc(p.kouhiEdaban) + ')';
        h += '<div class="info-row"><span class="label">公費</span><span class="value">' + kouhiDisp + '</span></div>';
      }
      if (p.recipientNumber) {
        var recipDisp = esc(p.recipientNumber);
        if (p.recipientEdaban) recipDisp += ' (枝' + esc(p.recipientEdaban) + ')';
        h += '<div class="info-row"><span class="label">受給者番号</span><span class="value">' + recipDisp + '</span></div>';
      }
      if (p.iryoType) {
        h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title" style="color:#7c3aed;">医療証</div>';
        h += '<div class="info-row"><span class="label">種別</span><span class="value">' + esc(p.iryoType);
        if (p.iryoHobetsu) h += ' <span style="font-family:monospace;color:#7c3aed;">(法別' + esc(p.iryoHobetsu) + ')</span>';
        h += '</span></div>';
        if (p.iryoRecipientNumber) {
          var iryoDisp = esc(p.iryoRecipientNumber);
          if (p.iryoRecipientEdaban) iryoDisp += ' (枝' + esc(p.iryoRecipientEdaban) + ')';
          h += '<div class="info-row"><span class="label">受給者番号</span><span class="value">' + iryoDisp + '</span></div>';
        }
        if (p.iryoValidFrom || p.iryoValidTo) h += '<div class="info-row"><span class="label">有効期間</span><span class="value">' + esc(p.iryoValidFrom||'') + ' 〜 ' + esc(p.iryoValidTo||'') + '</span></div>';
        if (p.iryoMemo) h += '<div class="info-row"><span class="label">備考</span><span class="value" style="font-size:10px;">' + esc(p.iryoMemo) + '</span></div>';
        if (p.iryoPhoto) h += '<div style="margin-top:4px;"><img src="' + esc(p.iryoPhoto) + '" style="max-height:80px;border-radius:4px;border:1px solid var(--border);"></div>';
        h += '</div>';
      }
      break;

    case 'allergy':
      h += '<div class="info-section"><div class="info-section-title">アレルギー・副作用</div>';
      h += p.allergies.length > 0 ? p.allergies.map(a => '<span class="allergy-tag">' + esc(a) + '</span>').join('') : '<span style="font-size:11px;color:var(--text-muted);">登録なし</span>';
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">既往歴</div>';
      if (p.history.length > 0) p.history.forEach(x => { h += '<div class="history-item">' + esc(x) + '</div>'; });
      else h += '<span style="font-size:11px;color:var(--text-muted);">なし</span>';
      h += '</div>';
      break;

    case 'vitals':
      h += '<div class="info-section"><div class="info-section-title">バイタル履歴</div>';
      if (p.pastVitals && p.pastVitals.length > 0) {
        h += '<table style="width:100%;font-size:10px;border-collapse:collapse;"><tr style="background:var(--bg);"><th style="padding:3px;">日付</th><th>T</th><th>BP</th><th>SpO2</th><th>P</th></tr>';
        p.pastVitals.forEach(v => { h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:3px;color:var(--primary);font-weight:600;">' + esc(v.date) + '</td><td>' + esc(v.t) + '</td><td>' + esc(v.bp) + '</td><td>' + esc(v.spo2) + '</td><td>' + esc(v.p) + '</td></tr>'; });
        h += '</table>';
      } else h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
      h += '</div>';
      break;

    case 'history':
      h += '<div class="info-section"><div class="info-section-title">診療履歴</div>';
      if (p.pastKartes && p.pastKartes.length > 0) {
        p.pastKartes.forEach(k => {
          h += '<div class="history-entry"><span class="history-date">' + esc(k.date) + '</span><span class="history-diag">' + esc(k.diag || '---') + '</span><span class="history-doc">' + esc(k.doc || '') + '</span></div>';
        });
      } else h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
      h += '</div>';
      if (p.dbSource && p.dbVisits && p.dbVisits.length > 0) {
        h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title" style="color:#2563eb;">来院詳細（DB）</div>';
        h += '<table style="width:100%;font-size:10px;border-collapse:collapse;"><tr style="background:var(--bg);"><th style="padding:3px;">日付</th><th>時間帯</th><th>担当医</th><th>検査</th><th>自己負担</th></tr>';
        p.dbVisits.sort((a, b) => compareDateStr(b.date, a.date)).forEach(v => {
          const tests = [v.covid ? 'C+' : '', v.flu ? 'Flu+' : '', v.strep ? '溶+' : ''].filter(Boolean).join(' ') || '-';
          h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:3px;color:var(--primary);font-weight:600;">' + esc(v.date || '') + '</td><td>' + esc(v.time || '') + '</td><td>' + esc(v.doctor || '') + '</td><td>' + esc(tests) + '</td><td>' + (v.selfPay ? '&yen;' + v.selfPay.toLocaleString() : '-') + '</td></tr>';
        });
        h += '</table></div>';
      }
      break;

    case 'rxhistory':
      h += '<div class="info-section"><div class="info-section-title">投薬履歴</div>';
      if (p.pastKartes && p.pastKartes.length > 0) {
        const hasRx = p.pastKartes.some(k => k.rx);
        if (hasRx) {
          p.pastKartes.forEach(k => {
            if (!k.rx) return;
            h += '<div style="padding:8px 0;border-bottom:1px solid var(--border);">';
            h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
            h += '<span style="color:var(--primary);font-weight:700;font-size:12px;">' + esc(k.date || '') + '</span>';
            if (k.doc) h += '<span style="font-size:10px;color:var(--text-muted);">' + esc(k.doc) + '</span>';
            h += '</div>';
            // rxが配列（{drug,qty}オブジェクト）か文字列かで分岐
            if (Array.isArray(k.rxItems) && k.rxItems.length > 0) {
              h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
              k.rxItems.forEach(item => {
                h += '<tr><td style="padding:2px 0;padding-right:12px;">' + esc(item.drug) + '</td>';
                h += '<td style="padding:2px 0;white-space:nowrap;color:var(--primary);font-weight:600;text-align:right;width:60px;">' + esc(item.qty || '') + '</td></tr>';
              });
              h += '</table>';
            } else if (typeof k.rx === 'string' && k.rx) {
              // 旧形式（カンマ区切り文字列）
              const rxList = k.rx.split(',').map(s => s.trim()).filter(s => s);
              h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
              rxList.forEach(item => {
                h += '<tr><td style="padding:2px 0;">' + esc(item) + '</td></tr>';
              });
              h += '</table>';
            }
            h += '</div>';
          });
        } else if (p.dbSource) {
          h += '<span style="font-size:11px;color:var(--text-muted);">DB側に処方データがありません</span>';
        } else {
          h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
        }
      } else h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
      h += '</div>';
      if (p.dbSource && p.dbVisits && p.dbVisits.length > 0) {
        h += '<div class="info-section" style="margin-top:8px;"><div class="info-section-title" style="color:#2563eb;">来院別 診療報酬</div>';
        h += '<table style="width:100%;font-size:11px;border-collapse:collapse;"><tr style="background:var(--bg);"><th style="padding:4px 6px;text-align:left;">日付</th><th style="text-align:left;">担当医</th><th style="text-align:right;">診療報酬</th><th style="text-align:right;">自己負担</th></tr>';
        p.dbVisits.sort((a, b) => compareDateStr(b.date, a.date)).forEach(v => {
          h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:4px 6px;color:var(--primary);font-weight:600;">' + esc(v.date || '') + '</td><td>' + esc(v.doctor || '') + '</td><td style="text-align:right;">' + (v.revenuePoints ? v.revenuePoints.toLocaleString() + '点' : '-') + '</td><td style="text-align:right;">' + (v.selfPay ? '&yen;' + v.selfPay.toLocaleString() : '-') + '</td></tr>';
        });
        h += '</table></div>';
      }
      break;

    case 'diseases':
      // 傷病名検索・追加UI
      h += '<div class="info-section">';
      h += '<div class="info-section-title">傷病名入力</div>';
      h += '<div class="disease-search-wrap" style="margin-bottom:6px;">';
      h += '<input type="text" class="form-input" id="diseaseSearch" placeholder="病名を検索..." oninput="searchDisease(this.value)" onfocus="searchDisease(this.value)" style="font-size:12px;padding:6px 8px;">';
      h += '<div class="disease-results" id="diseaseResults"></div>';
      h += '</div>';
      h += '<div class="disease-quick-btns" id="diseaseQuickBtns"></div>';
      h += '<div class="selected-diseases" id="selectedDiseases"></div>';
      h += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">［主］［確］［疑］をタップで切替（主病は1つ）</div>';
      h += '<div id="drugSuggestArea"></div>';
      h += '</div>';
      // 既往傷病名一覧
      h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title">傷病名履歴</div>';
      if (p.history && p.history.length > 0) {
        p.history.forEach(d => {
          const info = diseases.find(x => x.name === d);
          h += '<div style="padding:3px 0;font-size:11px;border-bottom:1px solid var(--bg);">' + esc(d) + (info ? ' <span style="font-size:9px;color:var(--text-muted);">' + esc(info.code) + '</span>' : '') + '</div>';
        });
      } else h += '<span style="font-size:11px;color:var(--text-muted);">なし</span>';
      h += '</div>';
      break;

    case 'exam':
      h += '<div class="info-section"><div class="info-section-title">検査結果</div>';
      h += '<span style="font-size:11px;color:var(--text-muted);">検査結果はGAS/Supabase連携後に表示されます</span>';
      h += '</div>';
      break;
  }
  body.innerHTML = h;
}

// ===== Rich Text Editor (Phase 2) =====
function rtExec(cmd, val) {
  document.execCommand(cmd, false, val || null);
  document.getElementById('findingsEditor').focus();
}

// ===== 所見テンプレ（要望#11） =====
// 医師記入欄の見出し［現病歴］［身体所見］［アセスメント＆プラン］をワンクリックで挿入する。
const FINDINGS_SECTIONS = ['現病歴', '身体所見', 'アセスメント＆プラン'];

function insertFindings(html) {
  const ed = document.getElementById('findingsEditor');
  if (!ed) return;
  ed.focus();
  // カーソル位置がエディタ内に無ければ末尾へ挿入する
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  document.execCommand('insertHTML', false, html);
  ed.focus();
  saveCurrentKarte();
}
function insertFindingsSection(name) { insertFindings(esc('[' + name + ']') + '<br><br>'); }
function insertFindingsTemplate() {
  insertFindings(FINDINGS_SECTIONS.map(n => esc('[' + n + ']') + '<br><br>').join(''));
}

// ユーザー定型文（localStorage）
function loadFindingsSnippets() {
  try { return JSON.parse(localStorage.getItem('karte_findingsSnippets') || '[]'); } catch (e) { return []; }
}
function saveFindingsSnippets(list) { localStorage.setItem('karte_findingsSnippets', JSON.stringify(list)); }
function renderFindingsSnippets() {
  const el = document.getElementById('findingsSnippetBtns');
  if (!el) return;
  el.innerHTML = loadFindingsSnippets().map((s, i) =>
    '<button class="rt-btn rt-tpl-btn" onclick="insertFindingsSnippet(' + i + ')" ' +
    'oncontextmenu="deleteFindingsSnippet(' + i + ');return false;" title="右クリックで削除">' + esc(s.label) + '</button>'
  ).join('');
}
function insertFindingsSnippet(i) {
  const s = loadFindingsSnippets()[i];
  if (!s) return;
  insertFindings(esc(s.text).replace(/\n/g, '<br>') + '<br>');
}
function addFindingsSnippet() {
  const label = prompt('定型文の名前（ボタンに表示されます）');
  if (!label) return;
  const text = prompt('本文（改行可）');
  if (!text) return;
  const list = loadFindingsSnippets();
  list.push({ label: label.trim(), text: text });
  saveFindingsSnippets(list);
  renderFindingsSnippets();
  showToast('定型文「' + label.trim() + '」を登録');
}
function deleteFindingsSnippet(i) {
  const list = loadFindingsSnippets();
  if (!list[i]) return;
  if (!confirm('定型文「' + list[i].label + '」を削除しますか？')) return;
  list.splice(i, 1);
  saveFindingsSnippets(list);
  renderFindingsSnippets();
  showToast('定型文を削除');
}

// ===== Chief Complaint =====
function onChiefComplaintSelect(val) {
  if (val) { const inp = document.getElementById('chiefComplaint'); inp.value = inp.value ? inp.value + '、' + val : val; }
}

// ===== Disease =====
function renderDiseaseQuickBtns() {
  const el = document.getElementById('diseaseQuickBtns');
  if (!el) return;
  const p = patients.find(x => x.id === currentPatientId);
  let btns = '';
  if (p && p.history && p.history.length > 0) btns += '<button class="disease-quick-btn" style="background:var(--success-light);border-color:var(--success);color:var(--success);" onclick="copyPrevDiseases()">&#8635; 前回傷病引継</button>';
  btns += quickDiseases.map(d => '<button class="disease-quick-btn" onclick="addDisease(\'' + esc(d) + '\')">' + esc(d) + '</button>').join('');
  el.innerHTML = btns;
}
function copyPrevDiseases() { const p = patients.find(x => x.id === currentPatientId); if (!p || !p.history) return; p.history.forEach(h => addDisease(h)); showToast('前回傷病名を引き継ぎました'); }
function searchDisease(q) {
  const r = document.getElementById('diseaseResults');
  if (!r) return;
  if (!q || q.length < 2) { r.classList.remove('show'); return; }
  // 1. ローカル辞書から検索
  let f = diseases.filter(d => d.name.includes(q) || d.code.includes(q));
  // 2. SSKマスター(27,684件)から検索（MasterLoaderが読込済みの場合）
  if (typeof MasterLoader !== 'undefined' && MasterLoader.isLoaded()) {
    const stats = MasterLoader.getStats();
    if (stats.b > 0) {
      const localCodes = new Set(f.map(d => d.code));
      const masterResults = MasterLoader.searchDiseases(q, 50);
      masterResults.forEach(d => {
        if (!localCodes.has(d.code)) f.push(d);
      });
    }
  }
  if (!f.length) { r.classList.remove('show'); return; }
  // 最大50件表示
  const display = f.slice(0, 50);
  r.innerHTML = display.map(d => '<div class="disease-result-item" onclick="addDisease(\'' + esc(d.name) + '\',\'' + esc(d.code) + '\')">' + esc(d.name) + ' <span style="color:var(--text-muted);font-size:10px;">' + esc(d.code) + '</span></div>').join('');
  r.classList.add('show');
}
function addDisease(name, code) {
  const k = karteData[currentPatientId];
  if (!k.selectedDiseases.find(d => d.name === name)) {
    // コードが渡されなかった場合はローカル辞書 → SSKマスターの順で検索
    if (!code) {
      const info = diseases.find(d => d.name === name);
      code = info ? info.code : '';
      if (!code && typeof MasterLoader !== 'undefined' && MasterLoader.isLoaded()) {
        const results = MasterLoader.searchDiseases(name, 1);
        if (results.length > 0 && results[0].name === name) code = results[0].code;
      }
    }
    // 要望#10: 主病フラグ。まだ主病が無ければ最初の1件を主病にする（レセプトのSY主病フラグと整合）
    const noMain = !k.selectedDiseases.some(d => d.main);
    k.selectedDiseases.push({name, code: code || '', status:'confirmed', main: noMain});
  }
  document.getElementById('diseaseSearch').value = '';
  document.getElementById('diseaseResults').classList.remove('show');
  renderSelectedDiseases();
}
function removeDisease(i) { karteData[currentPatientId].selectedDiseases.splice(i,1); renderSelectedDiseases(); }
// 要望#10: タップで ［主］→［確］→［疑］ を巡回。主病は常に1件だけ。
function toggleDiseaseStatus(i) {
  const list = karteData[currentPatientId].selectedDiseases;
  const d = list[i];
  if (!d) return;
  if (d.main) {                       // 主 → 確
    d.main = false; d.status = 'confirmed';
  } else if (d.status === 'confirmed') { // 確 → 疑
    d.status = 'suspected';
  } else {                            // 疑 → 主
    list.forEach(x => { x.main = false; });
    d.main = true; d.status = 'confirmed';
  }
  renderSelectedDiseases();
}
function renderSelectedDiseases() {
  const el = document.getElementById('selectedDiseases');
  if (!el) return;
  const k = karteData[currentPatientId];
  el.innerHTML = k.selectedDiseases.map((d,i) => {
    const cls = d.main ? 'disease-tag main' : (d.status === 'suspected' ? 'disease-tag suspected' : 'disease-tag');
    const lbl = d.main ? '主' : (d.status === 'suspected' ? '疑' : '確');
    return '<span class="' + cls + '"><span class="status-toggle" title="タップで 主→確→疑 を切替" onclick="toggleDiseaseStatus(' + i + ')">[' + lbl + ']</span> ' + esc(d.name) + (d.code ? ' <span style="font-size:9px;opacity:0.7;">' + esc(d.code) + '</span>' : '') + ' <span class="remove" onclick="removeDisease(' + i + ')">&times;</span></span>';
  }).join('');
  // 案2: 病名から候補薬を提示（医師チェック前提）
  if (typeof renderDrugSuggestions === 'function') renderDrugSuggestions();
}

// ===== Prescription =====
function renderSetOrders() {
  const el = document.getElementById('setOrderBtns');
  el.innerHTML = setOrders.map((s,i) =>
    '<button class="set-order-btn" onclick="applySetOrder(' + i + ')">' + esc(s.name) + '</button>'
  ).join('') +
  '<button class="set-order-btn set-order-save" onclick="saveCurrentAsSet()" title="現在の処方をセットとして保存">&#128190; 保存</button>' +
  '<button class="set-order-btn set-order-manage" onclick="openSetOrderManager()" title="セット整理・削除">&#9881; 管理</button>';
}
function applySetOrder(i) {
  const s = setOrders[i]; const k = karteData[currentPatientId]; k.prescriptions = [];
  // ★2026-08-20: 薬品マスタの行挿入でIDがずれると、以前は黙って薬が消える／別の薬に化ける恐れがあった。
  //   解決できなかった項目は必ず知らせる（無言で減らさない）。
  const unresolved = [];
  s.items.forEach(item => {
    let d = drugs.find(x => x.id === item.drugId);
    if (!d && item.drugName) d = drugs.find(x => x.name === item.drugName);   // 名前での救済
    if (d) { const savedNote = getDrugSavedNote(d.id) || getDrugSavedNote(item.drugId); k.prescriptions.push({drug:d,qty:item.qty,days:s.days,note:savedNote||''}); }
    else { unresolved.push(item.drugName || item.drugId); }
  });
  k.rxDays = s.days; document.getElementById('rxDays').value = s.days; renderRxList(); recalcBilling();
  if (unresolved.length) {
    showSaveError('セット「' + s.name + '」の薬品照合', unresolved.length + '件が薬品マスタに見つかりません（' + unresolved.join(', ') + '）。手動で追加してください', null);
  } else {
    showToast(s.name + 'を適用');
  }
}
function doRx() { const p = patients.find(x => x.id === currentPatientId); const k = karteData[currentPatientId]; k.prescriptions = []; p.prevRx.forEach(rx => { const d = drugs.find(x => x.id === rx.drugId); if (d) { const savedNote = getDrugSavedNote(rx.drugId); k.prescriptions.push({drug:d,qty:rx.qty,days:p.prevDays,note:savedNote||''}); } }); k.rxDays = p.prevDays; document.getElementById('rxDays').value = p.prevDays; renderRxList(); recalcBilling(); showToast('Do処方を適用'); }
function deleteSetOrder(i) { if (!confirm(setOrders[i].name + ' を削除しますか？')) return; setOrders.splice(i,1); saveSetOrders(); renderSetOrders(); showToast('セットを削除'); }
function saveCurrentAsSet() {
  const k = karteData[currentPatientId]; if (!k || !k.prescriptions.length) { showToast('処方がありません'); return; }
  const name = prompt('セット名を入力:', '新規セット');
  if (!name) return;
  // ★2026-08-20: 薬品IDだけだとマスタ変更で参照が壊れるため、薬品名も一緒に残して復元できるようにする
  const items = k.prescriptions.map(rx => ({drugId:rx.drug.id, drugName:rx.drug.name, qty:rx.qty}));
  const days = parseInt(document.getElementById('rxDays').value) || 7;
  setOrders.push({name:name,items:items,days:days,builtin:false});
  saveSetOrders(); renderSetOrders(); showToast(name + ' を保存');
}
function openSetOrderManager() {
  var overlay = document.getElementById('setManagerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'setManagerOverlay';
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.remove('show'); };
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'setManagerBody';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }
  _renderSetManager();
  overlay.classList.add('show');
}
function _renderSetManager() {
  var m = document.getElementById('setManagerBody');
  m.innerHTML = '<h3>処方セット管理<button class="modal-close" onclick="document.getElementById(\'setManagerOverlay\').classList.remove(\'show\')">&times;</button></h3>' +
    '<div class="set-manager-list">' +
    setOrders.map(function(s,i) {
      var drugNames = s.items.map(function(it) { var d = drugs.find(function(x) { return x.id === it.drugId; }); return d ? esc(d.name) + ' x' + it.qty : esc(it.drugId); }).join(', ');
      return '<div class="set-manager-item">' +
        '<div class="set-manager-info"><span class="set-manager-name">' + esc(s.name) + (s.builtin ? ' <span style="font-size:9px;color:var(--text-muted);">(組込)</span>' : '') + '</span>' +
        '<span class="set-manager-detail">' + drugNames + ' / ' + s.days + '日分</span></div>' +
        '<div class="set-manager-actions">' +
        // 要望#12: 名前変更を追加。組込セットは直接書き換えず「複製して編集」で自分用を作る（元に戻せるように）
        (s.builtin
          ? '<button class="set-manager-edit" onclick="duplicateSetOrderFromManager(' + i + ')">複製して編集</button>'
          : '<button class="set-manager-edit" onclick="renameSetOrderFromManager(' + i + ')">名前変更</button>' +
            '<button class="set-manager-del" onclick="deleteSetOrderFromManager(' + i + ')">削除</button>') +
        '</div></div>';
    }).join('') +
    '</div>' +
    '<div class="modal-actions"><button class="set-manager-close" onclick="document.getElementById(\'setManagerOverlay\').classList.remove(\'show\')">閉じる</button></div>';
}
function renameSetOrderFromManager(i) {
  const s = setOrders[i]; if (!s) return;
  const input = prompt('セット名を変更', s.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) return;
  if (setOrders.some((x, j) => j !== i && x.name === name)) { alert('同じ名前のセットが既にあります。'); return; }
  s.name = name;
  saveSetOrders(); renderSetOrders(); _renderSetManager(); showToast('セット名を「' + name + '」に変更');
}
function duplicateSetOrderFromManager(i) {
  const s = setOrders[i]; if (!s) return;
  const input = prompt('複製したセットの名前', s.name + 'のコピー');
  if (input === null) return;
  const name = input.trim();
  if (!name) return;
  if (setOrders.some(x => x.name === name)) { alert('同じ名前のセットが既にあります。'); return; }
  setOrders.push({ name: name, items: s.items.map(it => Object.assign({}, it)), days: s.days, builtin: false });
  saveSetOrders(); renderSetOrders(); _renderSetManager(); showToast('「' + name + '」を作成しました');
}
function deleteSetOrderFromManager(i) {
  if (!confirm(setOrders[i].name + ' を削除しますか？')) return;
  setOrders.splice(i,1); saveSetOrders(); renderSetOrders(); _renderSetManager(); showToast('セットを削除');
}
function searchDrug(q) { const r = document.getElementById('drugResults'); if (!q) { r.classList.remove('show'); return; } const f = drugs.filter(d => d.name.includes(q) || d.category.includes(q)); if (!f.length) { r.classList.remove('show'); return; } r.innerHTML = f.map(d => '<div class="drug-result-item" onclick="addDrug(\'' + esc(d.id) + '\')"><span>' + esc(d.name) + stockBadge(d.name) + '</span><span class="price">' + (d.price ? d.price.toFixed(1) + '円' : '') + '</span></div>').join(''); r.classList.add('show'); }
function addDrug(id) { let d = drugs.find(x => x.id === id); if (!d && typeof id === 'string' && id.indexOf('inv_') === 0 && typeof invDrugMenu === 'function') { d = invDrugMenu().find(x => x.id === id); if (d) drugs.push(d); } if (!d) return; const k = karteData[currentPatientId]; const ex = k.prescriptions.find(rx => rx.drug.id === id); if (ex) ex.qty += 1; else { const savedNote = getDrugSavedNote(id); k.prescriptions.push({drug:d,qty:1,days:k.rxDays||7,note:savedNote||''}); } document.getElementById('drugSearch').value = ''; document.getElementById('drugResults').classList.remove('show'); renderRxList(); recalcBilling(); }
function removeDrug(i) { karteData[currentPatientId].prescriptions.splice(i,1); renderRxList(); recalcBilling(); }
function updateDrugQty(i,v) { karteData[currentPatientId].prescriptions[i].qty = Math.max(0.5, parseFloat(v)||1); recalcBilling(); }
function updateDrugDays(i,v) { karteData[currentPatientId].prescriptions[i].days = Math.max(1, parseInt(v)||1); recalcBilling(); }
function updateDrugNote(i,v,silent) { karteData[currentPatientId].prescriptions[i].note = v; }
// 薬品ごとの備考記憶 (localStorage)
function getDrugSavedNotes() { try { return JSON.parse(localStorage.getItem('karte_drugNotes') || '{}'); } catch(e) { return {}; } }
function getDrugSavedNote(drugId) { return getDrugSavedNotes()[drugId] || ''; }
function isDrugNoteSaved(drugId, currentNote) { const saved = getDrugSavedNote(drugId); return saved && saved === currentNote && currentNote !== ''; }
function toggleSaveDrugNote(i) {
  const rx = karteData[currentPatientId].prescriptions[i];
  const notes = getDrugSavedNotes();
  if (notes[rx.drug.id] && notes[rx.drug.id] === rx.note) {
    delete notes[rx.drug.id];
    showToast(rx.drug.name + ' の備考記憶を解除');
  } else {
    if (!rx.note) { showToast('備考が空です'); return; }
    notes[rx.drug.id] = rx.note;
    showToast(rx.drug.name + ' の備考を記憶しました');
  }
  localStorage.setItem('karte_drugNotes', JSON.stringify(notes));
  renderRxList();
}
function applyBulkDays(v) { const days = Math.max(1, parseInt(v)||7); const k = karteData[currentPatientId]; k.rxDays = days; k.prescriptions.forEach(rx => { rx.days = days; }); renderRxList(); recalcBilling(); }
function renderRxList() {
  const k = karteData[currentPatientId]; const list = document.getElementById('rxList');
  if (!k.prescriptions.length) { list.innerHTML = '<li style="color:var(--text-muted);font-size:12px;padding:8px 0;text-align:center;">処方なし</li>'; return; }
  list.innerHTML = k.prescriptions.map((rx,i) => {
    const noteVal = esc(rx.note || '');
    const isSaved = isDrugNoteSaved(rx.drug.id, rx.note);
    return '<li class="rx-item">' +
      '<div class="rx-main"><span class="name">' + esc(rx.drug.name) + stockBadge(rx.drug.name) + '</span>' +
      '<input type="number" value="' + rx.qty + '" min="0.5" step="0.5" style="width:50px;" onchange="updateDrugQty(' + i + ',this.value)">' +
      '<span class="unit">' + esc(rx.drug.unit) + '</span>' +
      '<input type="number" value="' + (rx.days||k.rxDays||7) + '" min="1" max="90" style="width:46px;margin-left:4px;" onchange="updateDrugDays(' + i + ',this.value)">' +
      '<span class="unit" style="font-size:10px;">日</span>' +
      '<span class="remove-drug" onclick="removeDrug(' + i + ')">&times;</span></div>' +
      '<div class="rx-note-row">' +
      '<input type="text" class="rx-note-input" placeholder="備考（ジェネリック変更可、粉砕指示等）" value="' + noteVal + '" onchange="updateDrugNote(' + i + ',this.value)" oninput="updateDrugNote(' + i + ',this.value,true)">' +
      '<span class="rx-note-save' + (isSaved ? ' saved' : '') + '" onclick="toggleSaveDrugNote(' + i + ')" title="この備考を薬品に記憶する">' + (isSaved ? '&#9733; 記憶済' : '&#9734; 記憶') + '</span>' +
      '</div></li>';
  }).join('');
}

// ===== Exam =====
function renderExamCheckList() {
  const k = karteData[currentPatientId];
  // 要望#7: 検査登録UIは廃止（算定メニューの「検査」タブへ一本化）。
  // 既存カルテの selectedExams（検査料の算定）はそのまま残すため、DOMが無い場合だけ描画をスキップする。
  const listEl = document.getElementById('examCheckList');
  if (!listEl) return;
  listEl.innerHTML = examItems.map(ex => {
    const chk = k.selectedExams.includes(ex.id) ? 'checked' : '';
    return '<li class="exam-check-item"><input type="checkbox" id="exam_' + esc(ex.id) + '" ' + chk + ' onchange="toggleExam(\'' + esc(ex.id) + '\')"><label for="exam_' + esc(ex.id) + '">' + esc(ex.name) + '</label><span class="exam-points">' + ex.points + '点</span></li>';
  }).join('');
}
function toggleExam(id) { const k = karteData[currentPatientId]; const i = k.selectedExams.indexOf(id); if (i >= 0) k.selectedExams.splice(i,1); else k.selectedExams.push(id); recalcBilling(); }

// ===== Billing Menu (Phase 4) =====
var billingMyLists = loadBillingMyLists();
var currentMyListIdx = 0;
function loadBillingMyLists() {
  try {
    var s = localStorage.getItem('karte_billingMyLists');
    if (s) { var d = JSON.parse(s); if (Array.isArray(d) && d.length) return d; }
    // migrate from old single list
    var old = localStorage.getItem('karte_billingMyList');
    if (old) { var items = JSON.parse(old); if (items.length) return [{name:'マイリスト1', items:items}]; }
  } catch(e) {}
  return [{name:'マイリスト1', items:[]}];
}
function saveBillingMyLists() { localStorage.setItem('karte_billingMyLists', JSON.stringify(billingMyLists)); }
function currentMyList() { return billingMyLists[currentMyListIdx] || billingMyLists[0]; }

function switchBillingTab(cat) {
  // 要望#8: 以前は「マイリスト」再クリックで次のリストへ送っていたが、
  // リストは常に並べて表示するようにしたため送り動作は廃止。
  currentBillingTab = cat;
  if (cat !== 'drug') drugTabMode = '';
  document.querySelectorAll('.bm-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.cat === cat); });
  renderBillingMenu();
}
function renderMyListTab() {
  var tab = document.querySelector('.bm-tab-mylist');
  if (tab) tab.innerHTML = '&#9733; ' + esc(currentMyList().name);
}
function renderBillingMenu() {
  var el = document.getElementById('billingMenuItems');
  if (currentBillingTab === 'mylist') {
    var ml = currentMyList();
    // 要望#8: ◀▶送りを廃止し、登録済みリストを全て並べて1クリックで切替。作成/名前変更/削除は「＋管理」で別画面へ。
    var chips = billingMyLists.map(function(l, i) {
      return '<span class="bm-mylist-chip' + (i === currentMyListIdx ? ' active' : '') +
        '" onclick="switchMyList(' + i + ')" title="' + esc(l.name) + '（' + l.items.length + '件）">' + esc(l.name) + '</span>';
    }).join('');
    var header = '<div class="bm-mylist-bar">' + chips +
      '<span class="bm-mylist-chip bm-mylist-chip-manage" onclick="openMyListManager()" title="リストの新規作成・名前変更・削除">＋ 管理</span>' +
      '</div>' +
      '<div class="bm-mylist-header">' +
      '<span class="bm-mylist-name">' + esc(ml.name) + '</span>' +
      '<span class="bm-mylist-actions">' +
      '<span class="bm-mylist-action-btn bm-mylist-action-add-all" onclick="addAllMyListItems()" title="全て追加">&#9660; 全追加</span>' +
      '</span></div>';
    if (!ml.items.length) {
      el.innerHTML = header + '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:11px;">リストが空です<br>各タブの★ボタンで登録できます</div>';
      return;
    }
    el.innerHTML = header + ml.items.map(function(it,i) {
      var eName = it.name.replace(/'/g,"\\'");
      return '<div class="bm-item bm-mylist-item">' +
        '<span class="bm-mylist-del" onclick="removeBillingMyListItem(' + i + ')" title="削除">&times;</span>' +
        '<span class="bm-item-label" onclick="addBillingItem(\'' + eName + '\',' + it.points + ')">' + esc(it.name) + '</span>' +
        '<span class="bm-pts">' + it.points + '点</span></div>';
    }).join('');
    return;
  }
  // 薬タブ: 院内/院外選択 → 薬品リスト
  if (currentBillingTab === 'drug') {
    renderDrugTab(el);
    return;
  }
  var items = getActiveBillingMenu()[currentBillingTab] || [];
  var search = (document.getElementById('billingMenuSearch')?.value || '').toLowerCase();
  var filtered = search ? items.filter(function(it) { return it.name.toLowerCase().includes(search); }) : items;
  var ml = currentMyList();
  el.innerHTML = filtered.map(function(it) {
    var eName = it.name.replace(/'/g,"\\'");
    var inMyList = ml.items.some(function(m) { return m.name === it.name; });
    return '<div class="bm-item">' +
      '<span class="bm-fav-btn' + (inMyList ? ' bm-fav-active' : '') + '" onclick="event.stopPropagation();toggleBillingMyListItem(\'' + eName + '\',' + it.points + ')" title="' + esc(ml.name) + 'に登録/解除">&#9733;</span>' +
      '<span class="bm-item-label" onclick="addBillingItem(\'' + eName + '\',' + it.points + ')">' + esc(it.name) + '</span>' +
      '<span class="bm-pts">' + it.points + '点</span></div>';
  }).join('');
}
// ===== 薬タブ（算定メニュー内） =====
var drugTabMode = ''; // '' | 'internal' | 'external'

function renderDrugTab(el) {
  if (!drugTabMode) {
    // 院内/院外選択画面
    el.innerHTML = '<div style="padding:12px 8px;text-align:center;">' +
      '<div style="font-size:12px;font-weight:600;margin-bottom:10px;color:var(--text);">処方区分を選択</div>' +
      '<button class="drug-mode-btn" onclick="selectDrugMode(\'internal\')" style="display:block;width:100%;padding:10px;margin-bottom:8px;border:2px solid var(--primary);background:var(--primary-light);color:var(--primary);border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">院内薬</button>' +
      '<button class="drug-mode-btn" onclick="selectDrugMode(\'external\')" style="display:block;width:100%;padding:10px;border:2px solid var(--border);background:#fff;color:var(--text);border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">院外薬</button>' +
      '</div>';
    return;
  }
  var search = (document.getElementById('billingMenuSearch')?.value || '').toLowerCase();
  var modeLabel = drugTabMode === 'internal' ? '院内薬' : '院外薬';
  var header = '<div style="display:flex;align-items:center;gap:6px;padding:4px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px;">' +
    '<span style="font-size:11px;font-weight:600;color:var(--primary);">' + modeLabel + '</span>' +
    '<button onclick="selectDrugMode(\'\')" style="margin-left:auto;font-size:10px;padding:2px 8px;border:1px solid var(--border);background:var(--bg);border-radius:4px;cursor:pointer;">戻る</button>' +
    '</div>';

  if (drugTabMode === 'internal') {
    // 在庫管理アプリの薬を在庫数＋横バー付きで表示（読み取り専用連携）
    var invReady = (typeof invStockLoaded !== 'undefined') && invStockLoaded;
    if (typeof invStockLoaded !== 'undefined' && !invStockLoaded) {
      if (typeof loadInventoryStock === 'function') loadInventoryStock();
      var loadingMsg = (typeof invStockLoading !== 'undefined' && invStockLoading)
        ? '在庫管理アプリから読込中...'
        : (typeof invStockError !== 'undefined' && invStockError ? '在庫連携失敗: ' + esc(invStockError) + '（従来リスト表示）' : '在庫読込待機中...');
      if (!(typeof invStockError !== 'undefined' && invStockError)) {
        el.innerHTML = header + '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">' + loadingMsg + '</div>';
        return;
      }
    }
    // 在庫リストがあれば在庫121件、無ければ従来drugsにフォールバック
    var invList = (invReady && typeof invDrugMenu === 'function') ? invDrugMenu() : [];
    var source = invList.length ? invList : drugs;
    var filtered = source;
    if (search) filtered = source.filter(function(d) { return d.name.toLowerCase().includes(search); });
    el.innerHTML = header + filtered.map(function(d) {
      var entry = d._inv || (typeof getInvEntry === 'function' ? getInvEntry(d.name) : null);
      var right = (entry && typeof invStockBar === 'function')
        ? invStockBar(entry)
        : '<span class="bm-pts" style="font-size:10px;color:var(--text-muted);">' + esc(d.category || '') + '</span>';
      return '<div class="bm-item" style="cursor:pointer;" onclick="addDrugFromMenu(\'' + d.id + '\')">' +
        '<span class="bm-item-label">' + esc(d.name) + '</span>' + right + '</div>';
    }).join('');
    if (filtered.length === 0) el.innerHTML = header + '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">該当する薬品がありません</div>';
  } else {
    // 院外薬: SSKマスター検索
    el.innerHTML = header + '<div style="padding:8px;font-size:11px;color:var(--text-muted);text-align:center;">検索欄にキーワードを入力して薬品を検索してください</div>';
    if (search && search.length >= 2) {
      var results = [];
      if (typeof MasterLoader !== 'undefined' && MasterLoader.isLoaded()) {
        results = MasterLoader.searchDrugs ? MasterLoader.searchDrugs(search, 30) : [];
      }
      if (results.length > 0) {
        el.innerHTML = header + results.map(function(d) {
          var eName = (d.name || '').replace(/'/g, "\\'");
          return '<div class="bm-item" style="cursor:pointer;" onclick="addExternalDrug(\'' + eName + '\')">' +
            '<span class="bm-item-label">' + esc(d.name) + '</span>' +
            '<span class="bm-pts" style="font-size:9px;color:var(--text-muted);">' + esc(d.code || '') + '</span></div>';
        }).join('');
      } else {
        el.innerHTML = header + '<div style="padding:8px;font-size:11px;color:var(--text-muted);text-align:center;">該当なし（キーワード: ' + esc(search) + '）</div>';
      }
    }
  }
}

function selectDrugMode(mode) {
  drugTabMode = mode;
  renderBillingMenu();
}

function addDrugFromMenu(drugId) {
  addDrug(drugId);
  showToast(drugs.find(function(d) { return d.id === drugId; })?.name + ' を処方に追加');
}

function addExternalDrug(name) {
  // 院外薬：drugsリストにない場合は仮のエントリとして処方に追加
  var k = karteData[currentPatientId];
  var existing = k.prescriptions.find(function(rx) { return rx.drug.name === name; });
  if (existing) { showToast(name + ' は既に追加済みです'); return; }
  var tempDrug = { id: 'ext_' + Date.now(), name: name, price: 0, unit: 'T', category: '院外' };
  var savedNote = getDrugSavedNote(tempDrug.id);
  k.prescriptions.push({ drug: tempDrug, qty: 1, days: k.rxDays || 7, note: savedNote || '' });
  renderRxList();
  recalcBilling();
  showToast(name + ' を院外処方に追加');
}

function filterBillingMenu(q) { renderBillingMenu(); }
function addBillingItem(name, points) {
  var k = karteData[currentPatientId];
  if (!k.addedBillingItems.find(function(x) { return x.name === name; })) {
    k.addedBillingItems.push({name:name, points:points});
    recalcBilling();
    showToast(name + ' を追加');
    var el = document.getElementById('addedBillingList');
    if (el) el.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}
function toggleBillingMyListItem(name, points) {
  var ml = currentMyList();
  var idx = ml.items.findIndex(function(m) { return m.name === name; });
  if (idx >= 0) { ml.items.splice(idx, 1); showToast(name + ' を' + ml.name + 'から削除'); }
  else { ml.items.push({name:name, points:points}); showToast(name + ' を' + ml.name + 'に登録'); }
  saveBillingMyLists(); renderBillingMenu();
}
function removeBillingMyListItem(i) {
  var ml = currentMyList();
  var name = ml.items[i].name;
  ml.items.splice(i, 1); saveBillingMyLists(); renderBillingMenu(); showToast(name + ' を削除');
}
function cycleMyList(dir) {
  currentMyListIdx = (currentMyListIdx + dir + billingMyLists.length) % billingMyLists.length;
  renderMyListTab(); renderBillingMenu();
}
// 要望#8: チップを直接クリックして切替
function switchMyList(i) {
  if (i < 0 || i >= billingMyLists.length) return;
  currentMyListIdx = i;
  renderMyListTab(); renderBillingMenu();
}
// 要望#8: リストの管理（新規作成・名前変更・削除）は別画面へ分離
function openMyListManager() {
  var overlay = document.getElementById('myListManagerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'myListManagerOverlay';
    overlay.className = 'modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'myListManagerBody';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }
  _renderMyListManager();
  overlay.classList.add('show');
}
function closeMyListManager() {
  var o = document.getElementById('myListManagerOverlay');
  if (o) o.classList.remove('show');
}
function _renderMyListManager() {
  var m = document.getElementById('myListManagerBody');
  if (!m) return;
  m.innerHTML = '<h3>算定マイリストの管理<button class="modal-close" onclick="closeMyListManager()">&times;</button></h3>' +
    '<div class="set-manager-list">' +
    billingMyLists.map(function(l, i) {
      return '<div class="set-manager-item">' +
        '<div class="set-manager-info">' +
        '<span class="set-manager-name">' + esc(l.name) + (i === currentMyListIdx ? ' <span style="font-size:9px;color:var(--primary);">(表示中)</span>' : '') + '</span>' +
        '<span class="set-manager-detail">' + (l.items.length ? esc(l.items.map(function(it) { return it.name; }).join(', ')) : '（空）') + '</span></div>' +
        '<div class="set-manager-actions">' +
        '<button class="set-manager-edit" onclick="renameMyListAt(' + i + ')">名前変更</button>' +
        (billingMyLists.length > 1 ? '<button class="set-manager-del" onclick="deleteMyListAt(' + i + ')">削除</button>' : '') +
        '</div></div>';
    }).join('') +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-primary" onclick="addNewBillingMyList()">＋ 新しいリスト</button>' +
    '<button class="set-manager-close" onclick="closeMyListManager()">閉じる</button></div>';
}
function renameMyListAt(i) {
  var l = billingMyLists[i]; if (!l) return;
  var input = prompt('リスト名を変更:', l.name);
  if (input === null) return;
  var name = input.trim(); if (!name) return;
  l.name = name;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu(); _renderMyListManager();
  showToast('名前を変更: ' + name);
}
function deleteMyListAt(i) {
  if (billingMyLists.length <= 1) return;
  var l = billingMyLists[i]; if (!l) return;
  if (!confirm(l.name + ' を削除しますか？')) return;
  billingMyLists.splice(i, 1);
  if (currentMyListIdx >= billingMyLists.length) currentMyListIdx = billingMyLists.length - 1;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu(); _renderMyListManager();
  showToast('リストを削除');
}
function addNewBillingMyList() {
  var name = prompt('新しいリスト名:', 'マイリスト' + (billingMyLists.length + 1));
  if (!name) return;
  billingMyLists.push({name:name, items:[]});
  currentMyListIdx = billingMyLists.length - 1;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu();
  if (typeof _renderMyListManager === 'function') _renderMyListManager();
  showToast(name + ' を作成');
}
function deleteBillingMyList() {
  if (billingMyLists.length <= 1) return;
  var ml = currentMyList();
  if (!confirm(ml.name + ' を削除しますか？')) return;
  billingMyLists.splice(currentMyListIdx, 1);
  if (currentMyListIdx >= billingMyLists.length) currentMyListIdx = billingMyLists.length - 1;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu();
  showToast('リストを削除');
}
function addAllMyListItems() {
  var ml = currentMyList();
  if (!ml.items.length) { showToast('リストが空です'); return; }
  var k = karteData[currentPatientId];
  var added = 0;
  ml.items.forEach(function(it) {
    if (!k.addedBillingItems.find(function(x) { return x.name === it.name; })) {
      k.addedBillingItems.push({name:it.name, points:it.points});
      added++;
    }
  });
  if (added > 0) { recalcBilling(); showToast(ml.name + ' から ' + added + '件追加'); }
  else { showToast('全て追加済みです'); }
}
function renameBillingMyList() {
  var ml = currentMyList();
  var name = prompt('リスト名を変更:', ml.name);
  if (!name || name === ml.name) return;
  ml.name = name;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu();
  showToast('名前を変更: ' + name);
}

// ===== Billing =====
// 当院標準の毎回加算（clinic_standard／官報令和8点数）。初診/再診で付く加算を自動付与。
var STD_ADDON_DEFS = {
  first: [ {name:'機能強化加算', points:80}, {name:'外来・在宅物価対応料', points:4}, {name:'外来・在宅ベースアップ評価料', points:17} ],
  re:    [ {name:'外来・在宅物価対応料', points:4}, {name:'外来・在宅ベースアップ評価料', points:4} ]
};
// カルテ・UKE生成の双方から呼ぶ。医師が外した加算(stdRemoved)は再付与しない。手動項目は温存。
function ensureStandardAddons(k, isFirst) {
  if (!k) return;
  if (!k.addedBillingItems) k.addedBillingItems = [];
  if (k.stdAddonsOff) return; // この患者は標準加算を付けない（明示オプトアウト）
  var removed = k.stdRemoved || {};
  var desired = isFirst ? STD_ADDON_DEFS.first : STD_ADDON_DEFS.re;
  var desiredNames = desired.map(function(d){ return d.name; });
  // 受診種別に不要な自動加算を除去（例: 再診で機能強化加算）。手動追加(std無し)は触らない
  k.addedBillingItems = k.addedBillingItems.filter(function(it){
    return !(it.std && desiredNames.indexOf(it.name) === -1);
  });
  // 不足分を追加（医師が明示的に外したものは除外）
  desired.forEach(function(d){
    if (removed[d.name]) return;
    if (!k.addedBillingItems.find(function(x){ return x.name === d.name; })) {
      k.addedBillingItems.push({ name:d.name, points:d.points, std:true });
    }
  });
}
function recalcBilling() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  ensureStandardAddons(k, k.isFirstVisit); // 当院標準加算を自動付与
  const isExternal = k.rxModeExternal || false;
  const visitFee = getVisitFee(k.isFirstVisit, selectedDate);
  const shoshinTen = visitFee.points;
  const gairaiTen = k.isFirstVisit ? 0 : 52;
  const surcharge = getTimeSurcharge(examStartTime);
  const surchargeTen = surcharge ? surcharge.points : 0;
  const sr = document.getElementById('billSurchargeRow');
  if (surchargeTen > 0) { sr.style.display = ''; document.getElementById('billSurcharge').textContent = surcharge.type + ' ' + surchargeTen + '点'; } else { sr.style.display = 'none'; }
  const numDrugs = k.prescriptions.length;
  let shohouTen = 0, chouzaiTen = 0, yakuzaiTen = 0;
  if (numDrugs > 0) {
    if (isExternal) {
      // 院外処方: 処方箋料のみ（薬剤料・調剤料は算定しない）
      // 点数は master/s_procedures.json 準拠（120002710=32点 / 120002910=60点）
      shohouTen = numDrugs >= 7 ? 32 : 60;
    } else {
      // 院内処方: 従来通り
      shohouTen = numDrugs >= 7 ? 29 : 42;
      const maxDays = Math.max(...k.prescriptions.map(rx => rx.days || k.rxDays || 7));
      chouzaiTen = maxDays<=7?11:maxDays<=14?19:maxDays<=21?25:maxDays<=28?30:33;
      let yakuzaiRaw = 0;
      k.prescriptions.forEach(rx => { yakuzaiRaw += rx.drug.price * rx.qty * (rx.days || k.rxDays || 7); });
      yakuzaiTen = goshagochoNyuu(yakuzaiRaw / 10);
    }
  }
  let examTen = 0;
  k.selectedExams.forEach(id => { const ex = examItems.find(e => e.id === id); if (ex) examTen += ex.points; });
  const er = document.getElementById('billExamRow');
  if (examTen > 0) { er.style.display = ''; document.getElementById('billExam').textContent = examTen + '点'; } else { er.style.display = 'none'; }
  let extraTen = 0;
  if (k.addedBillingItems) k.addedBillingItems.forEach(it => extraTen += it.points);
  // 個別除外の適用
  const ex = k.excludedBillingRows || {};
  if (ex.gairai) gairaiTen = 0;
  if (ex.shohou) shohouTen = 0;
  if (ex.chouzai) chouzaiTen = 0;
  if (ex.yakuzai) yakuzaiTen = 0;
  if (ex.exam) examTen = 0;
  ['gairai','shohou','chouzai','yakuzai'].forEach(function(key) {
    var row = document.getElementById('row' + key.charAt(0).toUpperCase() + key.slice(1));
    if (row) row.classList.toggle('excluded', !!ex[key]);
  });
  if (er) er.classList.toggle('excluded', !!ex.exam);
  const totalTen = shoshinTen + gairaiTen + surchargeTen + shohouTen + chouzaiTen + yakuzaiTen + examTen + extraTen;
  const burden = Math.round(totalTen * 10 * p.ratio);
  // ★2026-08-20: 算定結果をカルテに保持し、Supabaseの visits.revenue_points と
  //   billing_items_used に書けるようにする（従来は0固定で、売上と診療内容が突合できなかった）
  k.totalPoints = totalTen;
  k.patientBurden = burden;
  k.billingBreakdown = [
    { name: (k.isFirstVisit ? '初診料' : '再診料'), points: shoshinTen },
    { name: '外来管理加算', points: gairaiTen },
    { name: surcharge ? surcharge.type + '加算' : '時間加算', points: surchargeTen },
    { name: (isExternal ? '処方箋料' : '処方料'), points: shohouTen },
    { name: '調剤料', points: chouzaiTen },
    { name: '薬剤料', points: yakuzaiTen },
    { name: '検査', points: examTen }
  ].filter(function (x) { return x.points > 0; })
   .concat((k.addedBillingItems || []).map(function (it) { return { name: it.name, points: it.points }; }));
  document.getElementById('billShoshin').textContent = (k.isFirstVisit ? '初診料 ' : '再診料 ') + shoshinTen + '点';
  document.getElementById('billGairai').textContent = gairaiTen > 0 ? gairaiTen + '点' : '---';
  const shohouLabel = isExternal ? '処方箋料' : '処方料';
  document.getElementById('billShohou').textContent = shohouTen > 0 ? shohouLabel + ' ' + shohouTen + '点' + (numDrugs >= 7 ? ' (逓減)' : '') : '---';
  document.getElementById('billChouzai').textContent = chouzaiTen > 0 ? chouzaiTen + '点' : (isExternal && numDrugs > 0 ? '(院外)' : '---');
  document.getElementById('billYakuzai').textContent = yakuzaiTen > 0 ? yakuzaiTen + '点' : (isExternal && numDrugs > 0 ? '(院外)' : '---');
  document.getElementById('billTotal').textContent = totalTen + '点';
  document.getElementById('billBurden').textContent = burden.toLocaleString() + '円';
  renderAddedBillingList();
  var clearBtn2 = document.getElementById('btnClearBilling');
  if (clearBtn2) clearBtn2.disabled = !(k.addedBillingItems.length || k.selectedExams.length);
}
function goshagochoNyuu(val) { const f = Math.floor(val); return (val - f) > 0.5 ? f + 1 : f; }

// ===== Time surcharge =====
function getTimeSurcharge(dt) {
  if (!dt) dt = new Date();
  const h = dt.getHours(), day = dt.getDay();
  if (day === 0) return {type:'休日',points:250};
  if (h >= 22 || h < 6) return {type:'深夜',points:480};
  if (day === 6) { if ((h >= 6 && h < 8) || h >= 12) return {type:'時間外',points:85}; }
  else { if ((h >= 6 && h < 8) || h >= 18) return {type:'時間外',points:85}; }
  return null;
}
function updateSurchargeBadge() {
  const badge = document.getElementById('hdrSurcharge');
  const s = getTimeSurcharge(examStartTime || new Date());
  if (s) { badge.textContent = s.type + '加算 +' + s.points + '点'; badge.classList.add('show'); } else { badge.classList.remove('show'); }
}
function toggleExamStart() {
  const btn = document.getElementById('examStartBtn');
  if (!examStartTime) { examStartTime = new Date(); btn.textContent = '診察中 ' + examStartTime.getHours().toString().padStart(2,'0') + ':' + examStartTime.getMinutes().toString().padStart(2,'0'); btn.classList.add('active'); showToast('診察開始: ' + examStartTime.toLocaleTimeString('ja-JP')); }
  else { examStartTime = null; btn.textContent = '診察開始'; btn.classList.remove('active'); }
  updateSurchargeBadge(); recalcBilling();
}

// ===== Waiting List =====
function renderWaitingList() {
  const list = document.getElementById('waitingList'); let wc = 0, dc = 0;
  // 当日の患者のみ表示（全患者表示を防止）
  const todayPatients = getPatientsForDate(selectedDate);
  list.innerHTML = todayPatients.map(p => {
    let sc = 'status-waiting';
    if (p.status === 'active') sc = 'status-active';
    if (p.status === 'done') { sc = 'status-done'; dc++; }
    if (p.status === 'waiting') wc++;
    return '<div class="waiting-item' + (p.id === currentPatientId ? ' active' : '') + '" onclick="switchPatient(\'' + p.id + '\')"><div class="status-dot ' + sc + '"></div><div class="w-info"><div class="w-name">' + esc(p.name) + '</div><div class="w-detail">' + esc(p.age) + '歳 ' + esc(p.sex) + '</div></div><div class="w-lane">L' + esc(p.vehicle.lane) + '</div></div>';
  }).join('');
  document.getElementById('waitCount').textContent = wc;
  document.getElementById('doneCount').textContent = dc;
}
function callNextPatient() { const nw = patients.find(p => p.status === 'waiting'); if (!nw) { showToast('待機患者がいません'); return; } const cur = patients.find(p => p.status === 'active'); if (cur) cur.status = 'done'; nw.status = 'active'; switchPatient(nw.id); showToast(nw.name + 'さんを呼び出し（L' + nw.vehicle.lane + '）'); }
function callPrevPatient() { if (!patientHistory.length) return; switchPatient(patientHistory.pop(), false); showToast('前の患者に戻りました'); }
function updatePrevButton() { document.getElementById('prevPatientBtn').disabled = !patientHistory.length; }

// ===== Save / Confirm =====
function getEditorPlainText() {
  const editor = document.getElementById('findingsEditor');
  return editor ? editor.innerText : '';
}


// ===== GAS送信のまとめ（2026-08-05）=====
// 従来は カルテ1本＋処方N本＋傷病名M本＋検査E本＋算定1本を
// 別々のPOSTで投げており、1回の確定で7〜17往復していた（1往復あたり約1.2秒）。
// 内容は変えずに1本のPOSTへまとめ、GAS側は saveKarteBundle が同じ保存関数を順に呼ぶ。
function buildKarteRows(karteId, k) {
  return {
    '処方': (k.prescriptions || []).map(rx => ({
      'カルテID': karteId, '患者ID': currentPatientId,
      '薬品名': rx.drug.name, '薬品コード': rx.drug.id,
      '用量': rx.qty, '単位': rx.drug.unit || '錠',
      '日数': rx.days || k.rxDays, '薬価': rx.drug.price || 0, '備考': rx.note || ''
    })),
    '傷病名': (k.selectedDiseases || []).map(d => ({
      'カルテID': karteId, '患者ID': currentPatientId,
      '傷病名': d.name, 'ICD10コード': d.code || '',
      '確定区分': d.status === 'suspected' ? '疑い' : '確定', '主病': d.main ? '主' : ''
    })),
    '検査': (k.selectedExams || []).map(exId => {
      const ex = examItems.find(e => e.id === exId);
      return ex ? { 'カルテID': karteId, '患者ID': currentPatientId, '検査名': ex.name, '検査コード': exId } : null;
    }).filter(Boolean)
  };
}

function saveKarteDraft() {
  saveCurrentKarte();
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const surchargeInfo = getTimeSurcharge(examStartTime);
  const timeSlotLabel = surchargeInfo ? surchargeInfo.type : '通常';
  const plainText = getEditorPlainText();
  const draftRows = buildKarteRows(karteId, k);
  postToApi('saveKarteBundle', Object.assign({
    'カルテ': { 'カルテID': karteId, '患者ID': currentPatientId, '受診日': selectedDate, '診察開始時刻': examStartTime ? examStartTime.toLocaleTimeString('ja-JP') : '', '主訴': k.chiefComplaint, '所見': plainText, '体温': k.vitals.t, '収縮期血圧': k.vitals.bps, '拡張期血圧': k.vitals.bpd, 'SpO2': k.vitals.spo2, '脈拍': k.vitals.pulse, '初診フラグ': k.isFirstVisit ? 'TRUE' : 'FALSE', '時間区分': timeSlotLabel, 'ステータス': '一時保存' }
  }, draftRows));
  // Supabase保存（失敗は赤バナー＋再試行導線で必ず可視化する）
  saveToSupabaseChecked('一時保存', p, k, drugs, function () { saveKarteDraft(); });
  saveKarteSnapshot();          // 要望#9: 「直前保存に戻す」用のスナップショット
  showToast('カルテを一時保存しました');
}

function confirmBilling() {
  saveCurrentKarte();
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  const totalEl = document.getElementById('billTotal');
  const burdenEl = document.getElementById('billBurden');
  const rxSummary = k.prescriptions.map(rx => rx.drug.name + ' ' + rx.qty + rx.drug.unit + (rx.note ? ' [' + rx.note + ']' : '')).join('\n  ');
  const diseaseSummary = k.selectedDiseases.map(d => d.name + (d.status === 'suspected' ? '(疑い)' : '')).join(', ');
  const confirmMsg = '【確定確認】\n患者: ' + p.name + '（' + p.insurance + '）\n主訴: ' + (k.chiefComplaint || '未入力') + '\n傷病名: ' + (diseaseSummary || 'なし') + '\n処方:\n  ' + (rxSummary || 'なし') + '\n合計: ' + totalEl.textContent + '\n患者負担: ' + burdenEl.textContent + '\n\nこの内容で確定しますか？';
  if (!confirm(confirmMsg)) return;
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const surchargeInfo = getTimeSurcharge(examStartTime);
  const timeSlotLabel = surchargeInfo ? surchargeInfo.type : '通常';
  const plainText = getEditorPlainText();
  // 送信は saveBilling の値が揃ってから1本にまとめて行う（下部）
  const totalPoints = parseInt(totalEl.textContent) || 0;
  const burdenAmount = parseInt(burdenEl.textContent.replace(/[^0-9]/g, '')) || 0;
  const billingItemsList = [];
  const cfVisitFee = getVisitFee(k.isFirstVisit, selectedDate); billingItemsList.push(cfVisitFee.name + ' ' + cfVisitFee.points + '点');
  if (!k.isFirstVisit) billingItemsList.push('外来管理加算 52点');
  if (surchargeInfo) billingItemsList.push(surchargeInfo.type + '加算 ' + surchargeInfo.points + '点');
  if (k.prescriptions.length > 0) billingItemsList.push('処方料・調剤料・薬剤料');
  const confRows = buildKarteRows(karteId, k);
  postToApi('saveKarteBundle', Object.assign({
    'カルテ': { 'カルテID': karteId, '患者ID': currentPatientId, '受診日': selectedDate, '診察開始時刻': examStartTime ? examStartTime.toLocaleTimeString('ja-JP') : '', '診察終了時刻': new Date().toLocaleTimeString('ja-JP'), '主訴': k.chiefComplaint, '所見': plainText, '体温': k.vitals.t, '収縮期血圧': k.vitals.bps, '拡張期血圧': k.vitals.bpd, 'SpO2': k.vitals.spo2, '脈拍': k.vitals.pulse, '初診フラグ': k.isFirstVisit ? 'TRUE' : 'FALSE', '時間区分': timeSlotLabel, 'ステータス': '確定' },
    '算定': { 'カルテID': karteId, '患者ID': currentPatientId, '項目名': billingItemsList.join(', '), '合計点数': totalPoints, '負担額': burdenAmount, '負担割合': p.ratio }
  }, confRows));
  // Supabase保存（確定版）。失敗は赤バナー＋再試行導線で必ず可視化する。
  // 再試行は confirmBilling 全体ではなく保存だけを再実行する（確認ダイアログや状態変更を二重に走らせないため）
  (function retryableConfirmSave() {
    saveToSupabaseChecked('確定保存', p, k, drugs, retryableConfirmSave);
  })();
  p.status = 'done';
  examStartTime = null;
  document.getElementById('examStartBtn').textContent = '診察開始';
  document.getElementById('examStartBtn').classList.remove('active');
  renderWaitingList();
  saveKarteSnapshot();          // 要望#9: 「直前保存に戻す」用のスナップショット
  showToast(p.name + 'さんの診察を確定しました');
}

// ===== カルテの取り消し（要望#9） =====
// 方針（ユーザー確定 2026-08-05）: ①直前保存の状態まで戻す ②完全削除 の2つを用意する。
// ①のために、保存（一時保存・確定）のたびにカルテ内容のスナップショットを端末に残す。
function karteKey(pid, date) { return (pid || currentPatientId) + '|' + (date || selectedDate); }
function loadKarteSnapshots() { try { return JSON.parse(localStorage.getItem('karte_lastSaved') || '{}'); } catch (e) { return {}; } }
function saveKarteSnapshot() {
  try {
    const snaps = loadKarteSnapshots();
    snaps[karteKey()] = { savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(karteData[currentPatientId])) };
    // 端末の容量を圧迫しないよう、古いものから200件までに保つ
    const keys = Object.keys(snaps);
    if (keys.length > 200) {
      keys.sort((a, b) => (snaps[a].savedAt || '').localeCompare(snaps[b].savedAt || ''));
      keys.slice(0, keys.length - 200).forEach(k => delete snaps[k]);
    }
    localStorage.setItem('karte_lastSaved', JSON.stringify(snaps));
  } catch (e) { console.warn('カルテスナップショット保存に失敗:', e); }
}
function getKarteSnapshot() { return loadKarteSnapshots()[karteKey()] || null; }
function clearKarteSnapshot() {
  const snaps = loadKarteSnapshots();
  delete snaps[karteKey()];
  try { localStorage.setItem('karte_lastSaved', JSON.stringify(snaps)); } catch (e) {}
}
function blankKarte(p) {
  return {
    chiefComplaint: '', chiefComplaintSelect: '', findingsHtml: '',
    vitals: { t: '', bps: '', bpd: '', spo2: '', pulse: '' },
    selectedDiseases: [], prescriptions: [], rxDays: 7, rxModeExternal: false,
    isFirstVisit: !(p && p.prevVisitDate),
    selectedExams: [], addedBillingItems: [], excludedBillingRows: {}
  };
}
function currentOperator() {
  try { if (typeof authUser !== 'undefined' && authUser && authUser.email) return authUser.email; } catch (e) {}
  return '不明';
}
function openKarteCancelModal() {
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) { showToast('患者が選択されていません'); return; }
  saveCurrentKarte();
  document.getElementById('karteCancelTarget').innerHTML =
    '<b>' + esc(selectedDate) + '</b>　' + esc(p.name) + '（' + esc(p.id) + '）のカルテ';
  const snap = getKarteSnapshot();
  document.getElementById('karteCancelSnapInfo').textContent = snap
    ? '直前の保存: ' + new Date(snap.savedAt).toLocaleString('ja-JP')
    : 'このカルテはまだ保存されていません（戻す先がありません）';
  document.getElementById('karteDeleteReason').value = '';
  document.getElementById('karteDeleteNote').value = '';
  document.getElementById('karteCancelModal').classList.add('show');
}
function resetKarteToLastSave() {
  const snap = getKarteSnapshot();
  if (!snap) { alert('直前に保存した状態がありません。\n（このカルテはまだ一時保存も確定もされていません）'); return; }
  if (!confirm('保存後の変更をすべて破棄して、\n' + new Date(snap.savedAt).toLocaleString('ja-JP') + ' の状態に戻します。\nよろしいですか？')) return;
  karteData[currentPatientId] = JSON.parse(JSON.stringify(snap.data));
  closeModal('karteCancelModal');
  renderAllKarte();
  showToast('直前保存の状態に戻しました');
}
function loadKarteDeletionLog() { try { return JSON.parse(localStorage.getItem('karte_deletionLog') || '[]'); } catch (e) { return []; } }
function deleteKarteCompletely() {
  const reason = document.getElementById('karteDeleteReason').value;
  if (!reason) { alert('削除理由を選択してください。'); return; }
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  const note = document.getElementById('karteDeleteNote').value.trim();
  if (!confirm(selectedDate + '　' + p.name + 'さんのカルテを完全に削除します。\n記載・処方・傷病名・算定がすべて消えます。\n\n理由: ' + reason)) return;
  if (!confirm('本当に削除しますか？\nこの操作は元に戻せません。')) return;

  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  // 端末内に削除の記録を残す（誰が・いつ・なぜ）
  try {
    const log = loadKarteDeletionLog();
    log.push({ at: new Date().toISOString(), by: currentOperator(), karteId: karteId, patientId: p.id, patientName: p.name, visitDate: selectedDate, reason: reason, note: note });
    localStorage.setItem('karte_deletionLog', JSON.stringify(log.slice(-500)));
  } catch (e) { console.warn('削除記録の保存に失敗:', e); }

  // バックエンドへ削除を通知
  // ※ スプレッドシート(GAS)側は deleteKarte アクションの実装が必要（未実装だと無視される）
  postToApi('deleteKarte', { 'カルテID': karteId, '患者ID': p.id, '受診日': selectedDate, '削除理由': reason, '詳細': note, '実施者': currentOperator() });
  if (typeof deleteKarteFromSupabase === 'function') {
    deleteKarteFromSupabase(p.id, selectedDate, 'nishiharu').then(r => {
      if (r && r.success) console.log('[削除] Supabase OK', r.deleted);
      else showToast('Supabaseの削除に失敗しました: ' + ((r && r.error) || '不明'));
    });
  }

  karteData[currentPatientId] = blankKarte(p);
  clearKarteSnapshot();
  if (p.status === 'done') p.status = 'waiting';
  closeModal('karteCancelModal');
  renderAllKarte();
  showToast('カルテを削除しました');
}

// ===== 月遅れ請求（2026-08-06 要望） =====
// 現場の運用では、提出漏れなどで「診療した月」と「請求として出す月」がずれる。
// 診療月は変えずに、受診（診察）ごとに「月遅れ」の印と請求月を持たせる。
// 保存先は端末（localStorage）。レセプト点検画面(receipt.html)は同一オリジンなので同じ値を読める。
const LATE_CLAIM_KEY = 'karte_lateClaims';
function loadLateClaims() { try { return JSON.parse(localStorage.getItem(LATE_CLAIM_KEY) || '{}'); } catch (e) { return {}; } }
function saveLateClaims(map) { try { localStorage.setItem(LATE_CLAIM_KEY, JSON.stringify(map)); } catch (e) { console.warn('月遅れ設定の保存に失敗:', e); } }
function lateClaimKey(pid, date) { return (pid || currentPatientId) + '|' + (date || selectedDate); }
function getLateClaim(pid, date) { return loadLateClaims()[lateClaimKey(pid, date)] || null; }

function ymOfDate(iso) { return (iso || '').substring(0, 7); }              // 'YYYY-MM'
function ymLabel(ym) { const a = (ym || '').split('-'); return a.length === 2 ? a[0] + '年' + parseInt(a[1], 10) + '月' : (ym || ''); }
function ymShift(ym, n) {
  const a = (ym || '').split('-'); if (a.length !== 2) return ym;
  const d = new Date(parseInt(a[0], 10), parseInt(a[1], 10) - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// その患者の「同じ月」の受診日をすべて集める。
// 通常患者は visitDate と pastKartes、DB患者は dbVisits（"M/D"形式なので年はその月の年で補う）。
function patientVisitDatesInMonth(p, ym) {
  const out = [];
  const push = d => { if (d && ymOfDate(d) === ym && out.indexOf(d) === -1) out.push(d); };
  push(p.visitDate);
  push(selectedDate);                       // 表示中の診察は必ず対象に含める
  (p.pastKartes || []).forEach(k => push(k.date));
  if (p.dbSource && p.dbVisits) {
    const year = ym.substring(0, 4);
    p.dbVisits.forEach(v => {
      const a = String(v.date || '').split('/');
      if (a.length === 2) push(year + '-' + String(a[0]).padStart(2, '0') + '-' + String(a[1]).padStart(2, '0'));
    });
  }
  return out.sort();
}

function applyLateClaim(p, dates, on) {
  const map = loadLateClaims();
  const bmEl = document.getElementById('lateBillingMonth');
  const rsEl = document.getElementById('lateReason');
  const billingMonth = bmEl ? bmEl.value : ymShift(ymOfDate(selectedDate), 1);
  const reason = rsEl ? rsEl.value.trim() : '';
  dates.forEach(d => {
    const key = lateClaimKey(p.id, d);
    if (on) {
      map[key] = {
        patientId: p.id, patientName: p.name, visitDate: d,
        treatMonth: ymOfDate(d), billingMonth: billingMonth, reason: reason,
        setAt: new Date().toISOString(), setBy: currentOperator()
      };
    } else {
      delete map[key];
    }
  });
  saveLateClaims(map);
  renderLateClaimModal();
  updateLateClaimBadge();
}

function openLateClaimModal() {
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) { showToast('患者が選択されていません'); return; }
  const treatYm = ymOfDate(selectedDate);
  const todayYm = ymOfDate(new Date().toISOString().split('T')[0]);
  // 請求月の候補: 診療月の翌月から先を並べ、今月より前は選べないようにする
  let start = ymShift(treatYm, 1);
  if (start < todayYm) start = todayYm;
  const sel = document.getElementById('lateBillingMonth');
  let opts = '';
  for (let i = 0; i < 8; i++) { const ym = ymShift(start, i); opts += '<option value="' + ym + '">' + ymLabel(ym) + '</option>'; }
  sel.innerHTML = opts;
  const cur = getLateClaim(p.id, selectedDate);
  if (cur && cur.billingMonth) {
    if (!Array.prototype.some.call(sel.options, o => o.value === cur.billingMonth)) {
      sel.insertAdjacentHTML('afterbegin', '<option value="' + cur.billingMonth + '">' + ymLabel(cur.billingMonth) + '</option>');
    }
    sel.value = cur.billingMonth;
  }
  document.getElementById('lateReason').value = cur ? (cur.reason || '') : '';
  renderLateClaimModal();
  document.getElementById('lateClaimModal').classList.add('show');
}

function renderLateClaimModal() {
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  const ym = ymOfDate(selectedDate);
  const dates = patientVisitDatesInMonth(p, ym);
  const marked = dates.filter(d => getLateClaim(p.id, d));

  document.getElementById('lateClaimTarget').innerHTML =
    '<b>' + esc(p.name) + '</b>（' + esc(p.id) + '）　診療月 <b>' + esc(ymLabel(ym)) + '</b>　／　表示中の診察 <b>' + esc(selectedDate) + '</b>';
  document.getElementById('lateMonthLabel').textContent = ymLabel(ym) + '　' + dates.length + '件';

  document.getElementById('lateVisitList').innerHTML = dates.map(d => {
    const lc = getLateClaim(p.id, d);
    const isCur = (d === selectedDate);
    const badge = lc
      ? '<span style="background:#fdf1dd;color:#b45309;border:1px solid #b45309;border-radius:2px;font-size:10px;font-weight:700;padding:1px 6px;">月遅れ → ' + esc(ymLabel(lc.billingMonth)) + '請求</span>'
      : '<span style="color:var(--text-muted);font-size:11px;">通常請求</span>';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--border);' +
      (isCur ? 'background:#eef4ff;' : '') + '">' +
      '<span style="font-size:12px;min-width:92px;">' + esc(d) + (isCur ? ' <b>（表示中）</b>' : '') + '</span>' +
      badge + '</div>';
  }).join('') || '<div style="padding:8px;color:var(--text-muted);font-size:12px;">この月の受診がありません</div>';

  document.getElementById('lateWholeBtn').textContent = 'この月すべてを月遅れにする（' + dates.length + '件）';
  document.getElementById('lateClearWholeBtn').disabled = (marked.length === 0);
  document.getElementById('lateClearCurBtn').disabled = !getLateClaim(p.id, selectedDate);
}

function markLateCurrentVisit() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  applyLateClaim(p, [selectedDate], true);
  showToast(selectedDate + ' の診察を月遅れにしました');
}
function markLateWholeMonth() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  const ym = ymOfDate(selectedDate);
  const dates = patientVisitDatesInMonth(p, ym);
  if (!dates.length) { showToast('対象の受診がありません'); return; }
  if (!confirm(p.name + 'さんの ' + ymLabel(ym) + ' の受診 ' + dates.length + '件（' + dates.join('、') + '）を\nすべて月遅れにします。よろしいですか？')) return;
  applyLateClaim(p, dates, true);
  showToast(ymLabel(ym) + ' の ' + dates.length + '件を月遅れにしました');
}
function clearLateCurrentVisit() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  applyLateClaim(p, [selectedDate], false);
  showToast(selectedDate + ' の月遅れを解除しました');
}
function clearLateWholeMonth() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  const ym = ymOfDate(selectedDate);
  const dates = patientVisitDatesInMonth(p, ym);
  if (!confirm(p.name + 'さんの ' + ymLabel(ym) + ' の月遅れ設定をすべて解除します。よろしいですか？')) return;
  applyLateClaim(p, dates, false);
  showToast(ymLabel(ym) + ' の月遅れを解除しました');
}

// 受診情報バーと患者情報パネルのボタンに、月遅れかどうかを出す
function updateLateClaimBadge() {
  const item = document.getElementById('lateClaimInfoItem');
  const val = document.getElementById('lateClaimInfoValue');
  const btn = document.getElementById('lateClaimMenuBtn');
  if (!item || !val) return;
  const lc = currentPatientId ? getLateClaim(currentPatientId, selectedDate) : null;
  if (lc) {
    item.style.display = '';
    val.textContent = '月遅れ（' + ymLabel(lc.billingMonth) + '請求）';
    if (btn) btn.classList.add('on');
  } else {
    item.style.display = 'none';
    if (btn) btn.classList.remove('on');
  }
}

// ===== 「新カルテ用DB」スプレッドシートへのミラー送信 =====
// 2026-08-20: 正はSupabase側で、当シートは参照されていないため送信を停止した。
// 現場から参照要望が出た場合は、この定数を true に戻すだけで復旧する（コード削除はしていない）。
const ENABLE_SHEET_MIRROR = false;

function postToApi(action, data) {
  if (!ENABLE_SHEET_MIRROR) { console.info('[sheet-mirror] 停止中のため送信せず:', action); return; }
  try {
    // no-cors のため応答は読めない。最低限ネットワーク層の失敗だけは拾う。
    fetch(API_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:JSON.stringify({action, data}) })
      .catch(function(e){ console.warn('API error:', action, e); });
  } catch(e) { console.warn('API error:', action, e); }
}

// ===== 保存失敗の可視化 (2026-08-20) =====
// 旧実装は console.log / console.warn のみで、保存が全滅しても画面には何も出なかった。
// （過去に数週間ほど保存失敗に誰も気づけなかった事象の再発防止）
function showSaveError(context, detail, retryFn) {
  console.error('[保存失敗] ' + context, detail);
  var bar = document.getElementById('saveErrorBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'saveErrorBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#b3261e;color:#fff;'
      + 'padding:10px 16px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:12px;'
      + 'box-shadow:0 2px 6px rgba(0,0,0,.3)';
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  var msg = document.createElement('span');
  msg.style.flex = '1';
  msg.textContent = '⚠ ' + context + 'に失敗しました。データは保存されていません。'
    + (detail ? '（' + detail + '）' : '');
  bar.appendChild(msg);
  if (retryFn) {
    var btn = document.createElement('button');
    btn.textContent = '再試行';
    btn.style.cssText = 'background:#fff;color:#b3261e;border:0;border-radius:2px;padding:6px 14px;font-weight:700;cursor:pointer';
    btn.onclick = function () { bar.remove(); retryFn(); };
    bar.appendChild(btn);
  }
  var close = document.createElement('button');
  close.textContent = '閉じる';
  close.style.cssText = 'background:transparent;color:#fff;border:1px solid #fff;border-radius:2px;padding:6px 12px;cursor:pointer';
  close.onclick = function () { bar.remove(); };
  bar.appendChild(close);
  showToast('⚠ ' + context + 'に失敗しました');
}

// ===== 保存失敗時のローカル退避キュー (2026-08-20) =====
// 背景: Supabaseへの保存が失敗すると、新規登録患者の氏名を復元する手段が一切なかった。
//   （患者マスタへのミラーも届いておらず、2026-03〜08で氏名不明のカルテが6件発生した）
//   保存できなかった内容をブラウザに退避し、再送できるようにして同じ欠落を防ぐ。
var PENDING_SAVE_KEY = 'karte_pendingSaves';

function readPendingSaves() {
  try { return JSON.parse(localStorage.getItem(PENDING_SAVE_KEY) || '[]'); } catch (e) { return []; }
}
function writePendingSaves(list) {
  try { localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(list)); }
  catch (e) { console.error('[退避] 保存できません（容量超過の可能性）', e); }
}

// 退避用に、容量を食う項目（保険証写真など）を落とした複製を作る
function slimForBackup(obj) {
  var c;
  try { c = JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
  if (c && typeof c === 'object') {
    delete c.insurancePhoto;
    if (c.questionnaire && typeof c.questionnaire === 'object') delete c.questionnaire._raw;
  }
  return c;
}

function queuePendingSave(context, p, k) {
  var list = readPendingSaves();
  var key = (p && p.id) + '|' + selectedDate;
  list = list.filter(function (x) { return x.key !== key; });   // 同一カルテは最新だけ残す
  list.push({
    key: key, context: context, savedAt: new Date().toISOString(),
    patientId: p && p.id, patientName: p && p.name, visitDate: selectedDate,
    patient: slimForBackup(p), karte: slimForBackup(k)
  });
  writePendingSaves(list);
  console.warn('[退避] 未送信データを保存しました:', key, '（未送信 ' + list.length + '件）');
  return list.length;
}

// 退避分をまとめて再送する
function retryPendingSaves() {
  var list = readPendingSaves();
  if (!list.length) { showToast('未送信データはありません'); return Promise.resolve(0); }
  var remain = [], done = 0;
  return list.reduce(function (chain, item) {
    return chain.then(function () {
      return saveToSupabase(item.patient, item.karte, drugs).then(function (r) {
        if (r && r.success) { done++; } else { remain.push(item); }
      }).catch(function () { remain.push(item); });
    });
  }, Promise.resolve()).then(function () {
    writePendingSaves(remain);
    showToast('未送信データ: ' + done + '件を送信、' + remain.length + '件が残っています');
    renderPendingSaveBanner();
    return done;
  });
}

// 未送信が残っていることを常時知らせる帯
function renderPendingSaveBanner() {
  var list = readPendingSaves();
  var bar = document.getElementById('pendingSaveBar');
  if (!list.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pendingSaveBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#8a5a00;color:#fff;'
      + 'padding:8px 16px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:12px';
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  var msg = document.createElement('span');
  msg.style.flex = '1';
  msg.textContent = '未送信のカルテが ' + list.length + ' 件あります（サーバに保存できていません）';
  bar.appendChild(msg);
  var btn = document.createElement('button');
  btn.textContent = '再送信';
  btn.style.cssText = 'background:#fff;color:#8a5a00;border:0;border-radius:2px;padding:5px 12px;font-weight:700;cursor:pointer';
  btn.onclick = function () { retryPendingSaves(); };
  bar.appendChild(btn);
}

// saveToSupabase の結果を必ず検査する共通ラッパ。
// 成功時のみ静かに通し、失敗・例外はどちらも画面に出したうえでローカルへ退避する。
function saveToSupabaseChecked(context, p, k, drugsArg, retryFn) {
  return saveToSupabase(p, k, drugsArg).then(function (r) {
    if (r && r.success) {
      console.log('[Supabase] ' + context + 'OK' + (r.visitId ? ' visitId=' + r.visitId : ''));
      var list = readPendingSaves().filter(function (x) { return x.key !== (p && p.id) + '|' + selectedDate; });
      writePendingSaves(list); renderPendingSaveBanner();
      return r;
    }
    queuePendingSave(context, p, k); renderPendingSaveBanner();
    showSaveError(context, (r && r.error) ? String(r.error) : '原因不明', retryFn);
    return r;
  }).catch(function (e) {
    queuePendingSave(context, p, k); renderPendingSaveBanner();
    showSaveError(context, (e && e.message) ? e.message : String(e), retryFn);
    return { success: false, error: e };
  });
}
function printBilling() { showToast('印刷プレビュー（モック）'); }

// ===== Modals =====
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function openEditPatientModal() {
  const p = patients.find(x => x.id === currentPatientId);
  document.getElementById('editName').value = p.name;
  document.getElementById('editNameKana').value = p.nameKana || '';
  document.getElementById('editDob').value = p.dob || '';
  syncWarekiFromDob('edit');                       // 要望#3
  document.getElementById('editSex').value = p.sex;
  const a = splitAddress(p);                       // 要望#2
  document.getElementById('editZip').value = a.zip;
  document.getElementById('editPref').value = a.pref;
  document.getElementById('editCity').value = a.city;
  document.getElementById('editStreet').value = a.street;
  document.getElementById('editBuilding').value = a.building;
  document.getElementById('editPhone').value = p.phone || '';
  document.getElementById('editAllergies').value = p.allergies.join(', ');
  document.getElementById('editInsurance').value = p.insurance;
  document.getElementById('editPayMethod').value = p.payMethod || '';   // 要望#6
  document.getElementById('editPatientModal').classList.add('show');
}
function savePatientEdit() {
  const p = patients.find(x => x.id === currentPatientId);
  p.name = document.getElementById('editName').value;
  p.nameKana = document.getElementById('editNameKana').value;
  p.dob = document.getElementById('editDob').value;
  p.sex = document.getElementById('editSex').value;
  // 要望#2: 分割項目を保存しつつ、従来の1本の住所も生成して維持する
  p.zip = document.getElementById('editZip').value.trim();
  p.pref = document.getElementById('editPref').value.trim();
  p.city = document.getElementById('editCity').value.trim();
  p.street = document.getElementById('editStreet').value.trim();
  p.building = document.getElementById('editBuilding').value.trim();
  p.address = composeAddress(p);
  p.phone = document.getElementById('editPhone').value;
  const ins = document.getElementById('editInsurance').value;
  p.insurance = ins;
  p.ratio = ins.includes('1割') ? 0.1 : ins.includes('2割') ? 0.2 : ins === '公費' ? 0 : 0.3;
  const a = document.getElementById('editAllergies').value;
  p.allergies = a ? a.split(/[,、]/).map(s => s.trim()).filter(Boolean) : [];
  p.payMethod = document.getElementById('editPayMethod').value;   // 要望#6
  if (p.dob) { const t = new Date(), b = new Date(p.dob); let age = t.getFullYear()-b.getFullYear(); if (t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) age--; p.age = age; }
  savePatientToApi(p);
  closeModal('editPatientModal'); renderAllKarte(); showToast('患者情報を更新');
}

function handleInsurancePhoto(input, isModal) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) { const p = patients.find(x => x.id === currentPatientId); p.insurancePhoto = e.target.result; if (isModal) { document.getElementById('insurancePhotoPreview').src = e.target.result; document.getElementById('insurancePhotoPreview').style.display = 'block'; document.getElementById('insuranceUploadText2').style.display = 'none'; } renderPatientInfoTab(p); showToast('保険証写真を保存'); };
  reader.readAsDataURL(file);
}
function openInsuranceModal() {
  const p = patients.find(x => x.id === currentPatientId);
  if (p.insurancePhoto) { document.getElementById('insurancePhotoPreview').src = p.insurancePhoto; document.getElementById('insurancePhotoPreview').style.display = 'block'; document.getElementById('insuranceUploadText2').style.display = 'none'; document.getElementById('insurancePhotoDeleteBtn').style.display = ''; }
  else { document.getElementById('insurancePhotoPreview').style.display = 'none'; document.getElementById('insuranceUploadText2').style.display = ''; document.getElementById('insurancePhotoDeleteBtn').style.display = 'none'; }
  document.getElementById('insSymbol').value = p.insSymbol || '';
  document.getElementById('insNumber').value = p.insNumber || '';
  document.getElementById('insEdaban').value = p.insEdaban || '';
  document.getElementById('insurerNumberInput').value = p.insurerNumber || '';
  document.getElementById('incomeLevelSelect').value = p.incomeLevel || 'ippan';
  document.getElementById('insuranceRatio').value = String(p.ratio);
  if (p.insurance.includes('社保')) document.getElementById('insuranceType').value = '社保';
  else if (p.insurance.includes('国保')) document.getElementById('insuranceType').value = '国保';
  else if (p.insurance.includes('後期')) document.getElementById('insuranceType').value = '後期高齢者';
  else if (p.insurance === '公費') document.getElementById('insuranceType').value = '公費';
  document.getElementById('insuranceCalcResult').style.display = 'none';
  // OCRプレビューをリセット
  document.getElementById('insuranceOcrPreviewWrap').style.display = 'none';
  document.getElementById('insuranceOcrCameraWrap').style.display = 'none';
  // 医療証データ復元
  if (p.iryoPhoto) { document.getElementById('iryoPhotoPreview').src = p.iryoPhoto; document.getElementById('iryoPhotoPreview').style.display = 'block'; document.getElementById('iryoUploadText').style.display = 'none'; document.getElementById('iryoPhotoDeleteBtn').style.display = ''; }
  else { document.getElementById('iryoPhotoPreview').style.display = 'none'; document.getElementById('iryoUploadText').style.display = ''; document.getElementById('iryoPhotoDeleteBtn').style.display = 'none'; }
  document.getElementById('iryoType').value = p.iryoType || '';
  document.getElementById('iryoHobetsu').value = p.iryoHobetsu || '';
  insuranceWarnDismissed = false;   // 要望#4: 開くたびに警告を判定し直す
  document.getElementById('iryoRecipientNumber').value = p.iryoRecipientNumber || '';
  document.getElementById('iryoValidFrom').value = p.iryoValidFrom || '';
  document.getElementById('iryoValidTo').value = p.iryoValidTo || '';
  document.getElementById('iryoMemo').value = p.iryoMemo || '';
  document.getElementById('insurancePhotoModal').classList.add('show');
  updateInsuranceWarn();            // 要望#4
  if (typeof renderPatientPhotos === 'function') renderPatientPhotos();   // 要望#5
  if (p.insurerNumber) { setTimeout(function() { runInsuranceCalc(); }, 100); }
}

// v0.4: 保険者番号入力時のリアルタイムバリデーション
function onInsurerNumberInput(val) {
  const num = val.replace(/[^0-9]/g, '');
  if (num.length === 6 || num.length === 8) {
    const parsed = parseInsurerNumber(num);
    if (parsed.valid) {
      // 区分セレクトを自動設定
      if (parsed.insuranceCategory === '社保') document.getElementById('insuranceType').value = '社保';
      else if (parsed.insuranceCategory === '国保') document.getElementById('insuranceType').value = '国保';
      else if (parsed.insuranceCategory === '後期高齢者') document.getElementById('insuranceType').value = '後期高齢者';
    }
  }
}

// v0.4: 自動判定実行
function runInsuranceCalc() {
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  const insurerNum = document.getElementById('insurerNumberInput').value;
  const kouhiEl = document.getElementById('kouhiNumberInput');
  const kouhiNum = (kouhiEl && kouhiEl.value) ? kouhiEl.value : undefined;
  const incomeLevel = document.getElementById('incomeLevelSelect').value;

  if (!insurerNum.replace(/[^0-9]/g, '')) {
    showToast('保険者番号を入力してください');
    return;
  }

  const result = calcCopayRate(insurerNum, p.dob, {
    incomeLevel: incomeLevel,
    kouhiNumber: kouhiNum,
  });

  // 結果表示
  const el = document.getElementById('insuranceCalcResult');
  el.innerHTML = formatCalcResultHTML(result);
  el.style.display = 'block';

  // 手動設定側にも反映
  if (result.insurerParsed.valid || result.insurerParsed.cleaned.length >= 6) {
    document.getElementById('insuranceRatio').value = String(result.finalRate);
    if (result.insuranceCategory === '社保') document.getElementById('insuranceType').value = '社保';
    else if (result.insuranceCategory === '国保') document.getElementById('insuranceType').value = '国保';
    else if (result.insuranceCategory === '後期高齢者') document.getElementById('insuranceType').value = '後期高齢者';
    if (result.finalRate === 0 && result.kouhiApplied) document.getElementById('insuranceType').value = '公費';
  }
  updateInsuranceWarn();   // 要望#4: 自動判定で割合が変わったら警告を判定し直す
}

function saveInsuranceInfo() {
  const p = patients.find(x => x.id === currentPatientId);
  // 要望#4: 医療証ありなのに負担割合が残っている場合、保存前にもう一度だけ確認する（自動変更はしない）
  const warn = insuranceWarnState();
  if (warn && !insuranceWarnDismissed) {
    updateInsuranceWarn();
    if (!confirm('医療証（' + warn.iryo + '）が登録されていますが、負担割合が「' + warn.label + '」のままです。\nこのまま ' + warn.label + ' で保存しますか？\n\n［キャンセル］を押すと画面に戻ります。')) return;
    insuranceWarnDismissed = true;
  }
  p.insSymbol = document.getElementById('insSymbol').value;
  p.insNumber = document.getElementById('insNumber').value;
  p.insEdaban = document.getElementById('insEdaban').value;
  // 後方互換: insuranceNumberも生成
  p.insuranceNumber = buildInsuranceNumberStr({ symbol: p.insSymbol, memberNumber: p.insNumber, edaban: p.insEdaban });
  p.insurerNumber = document.getElementById('insurerNumberInput').value;
  p.incomeLevel = document.getElementById('incomeLevelSelect').value;
  const type = document.getElementById('insuranceType').value;
  const ratio = parseFloat(document.getElementById('insuranceRatio').value);
  p.ratio = ratio;
  const rl = ratio===0.1?'1割':ratio===0.2?'2割':ratio===0.05?'5%':ratio===0.3?'3割':'0割';
  p.insurance = type === '後期高齢者' ? '後期高齢者' + rl : type === '公費' ? '公費' : type + rl;
  // 医療証データ保存
  p.iryoType = document.getElementById('iryoType').value;
  p.iryoHobetsu = document.getElementById('iryoHobetsu').value;
  p.iryoRecipientNumber = document.getElementById('iryoRecipientNumber').value;
  p.iryoValidFrom = document.getElementById('iryoValidFrom').value;
  p.iryoValidTo = document.getElementById('iryoValidTo').value;
  p.iryoMemo = document.getElementById('iryoMemo').value;
  postToApi('saveInsurance', { '患者ID': p.id, '保険区分': type, '記号': p.insSymbol, '番号': p.insNumber, '枝番': p.insEdaban, '保険者番号': p.insurerNumber, '公費番号': p.kouhiNumber, '公費枝番': p.kouhiEdaban, '受給者番号': p.recipientNumber, '受給者枝番': p.recipientEdaban, '所得区分': p.incomeLevel, '負担割合': ratio, '医療証種別': p.iryoType, '法別番号': p.iryoHobetsu, '医療証受給者番号': p.iryoRecipientNumber, '医療証受給者枝番': p.iryoRecipientEdaban });
  closeModal('insurancePhotoModal'); renderAllKarte(); showToast('保険証・医療証情報を更新');
}

// v0.4: ルール参照モーダル
function openInsuranceRuleRef() {
  document.getElementById('insuranceRuleModal').classList.add('show');
  showRuleTab('age');
}
function showRuleTab(tab) {
  const el = document.getElementById('ruleTabContent');
  let html = '';
  if (tab === 'age') {
    html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:var(--bg);"><th style="padding:6px;text-align:left;border-bottom:2px solid var(--border);">年齢区分</th><th style="padding:6px;text-align:left;border-bottom:2px solid var(--border);">条件</th><th style="padding:6px;text-align:center;border-bottom:2px solid var(--border);">負担割合</th></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">0〜6歳未満（就学前）</td><td style="padding:5px;border-bottom:1px solid var(--border);">全員</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;color:#059669;">2割</td></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">6〜69歳</td><td style="padding:5px;border-bottom:1px solid var(--border);">全員</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;">3割</td></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">70〜74歳</td><td style="padding:5px;border-bottom:1px solid var(--border);">一般・低所得</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;color:#059669;">2割</td></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">70〜74歳</td><td style="padding:5px;border-bottom:1px solid var(--border);">現役並み所得</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;">3割</td></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">75歳以上（後期高齢者）</td><td style="padding:5px;border-bottom:1px solid var(--border);">一般</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;color:#2563eb;">1割</td></tr>' +
      '<tr><td style="padding:5px;border-bottom:1px solid var(--border);">75歳以上（後期高齢者）</td><td style="padding:5px;border-bottom:1px solid var(--border);">一定以上所得（課税28万円〜）</td><td style="padding:5px;text-align:center;border-bottom:1px solid var(--border);font-weight:700;color:#059669;">2割</td></tr>' +
      '<tr><td style="padding:5px;">75歳以上（後期高齢者）</td><td style="padding:5px;">現役並み所得（課税145万円〜）</td><td style="padding:5px;text-align:center;font-weight:700;">3割</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:11px;color:var(--text-muted);">※「6歳未満」は6歳到達後の最初の3月31日まで（小学校入学前年度末）</div>';
  } else if (tab === 'houbetsu') {
    html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:var(--bg);"><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">法別</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">種別</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">区分</th></tr>';
    html += '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">(6桁)</td><td style="padding:4px;border-bottom:1px solid var(--border);">国民健康保険</td><td style="padding:4px;border-bottom:1px solid var(--border);">国保</td></tr>';
    Object.keys(HOUBETSU_MAP).sort().forEach(function(key) {
      var v = HOUBETSU_MAP[key];
      html += '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">' + key + '</td><td style="padding:4px;border-bottom:1px solid var(--border);">' + v.name + '</td><td style="padding:4px;border-bottom:1px solid var(--border);">' + v.category + '</td></tr>';
    });
    html += '</table>';
  } else if (tab === 'kouhi') {
    html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
      '<tr style="background:var(--bg);"><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">法別</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">制度名</th><th style="padding:5px;text-align:center;border-bottom:2px solid var(--border);">負担</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">優先</th></tr>';
    Object.keys(KOUHI_MAP).sort().forEach(function(key) {
      var v = KOUHI_MAP[key];
      html += '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">' + key + '</td><td style="padding:4px;border-bottom:1px solid var(--border);">' + v.name + '</td><td style="padding:4px;text-align:center;border-bottom:1px solid var(--border);font-weight:600;">' + v.burden + '</td><td style="padding:4px;border-bottom:1px solid var(--border);">' + v.priority + '</td></tr>';
    });
    html += '</table>';
  } else if (tab === 'local') {
    html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:var(--bg);"><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">法別</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">制度名</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">通称</th><th style="padding:5px;text-align:left;border-bottom:2px solid var(--border);">対象</th></tr>' +
      '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">80</td><td style="padding:4px;border-bottom:1px solid var(--border);">心身障害者医療費助成</td><td style="padding:4px;border-bottom:1px solid var(--border);">マル障</td><td style="padding:4px;border-bottom:1px solid var(--border);">重度障害者</td></tr>' +
      '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">81</td><td style="padding:4px;border-bottom:1px solid var(--border);">ひとり親家庭等医療費助成</td><td style="padding:4px;border-bottom:1px solid var(--border);">マル親</td><td style="padding:4px;border-bottom:1px solid var(--border);">ひとり親家庭</td></tr>' +
      '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">87</td><td style="padding:4px;border-bottom:1px solid var(--border);">妊産婦医療費助成</td><td style="padding:4px;border-bottom:1px solid var(--border);">マル妊</td><td style="padding:4px;border-bottom:1px solid var(--border);">妊産婦</td></tr>' +
      '<tr><td style="padding:4px;border-bottom:1px solid var(--border);">88</td><td style="padding:4px;border-bottom:1px solid var(--border);">乳幼児・子ども医療費助成</td><td style="padding:4px;border-bottom:1px solid var(--border);">マル乳・マル子</td><td style="padding:4px;border-bottom:1px solid var(--border);">乳幼児〜義務教育修了</td></tr>' +
      '<tr><td style="padding:4px;">89</td><td style="padding:4px;">高校生等医療費助成</td><td style="padding:4px;">マル青</td><td style="padding:4px;">高校生世代</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:11px;color:var(--text-muted);">※ 法別80〜89は都道府県・市区町村ごとに制度内容が異なります。受給者証を確認してください。</div>';
  }
  el.innerHTML = html;
}

function openQuestionnaireModal() {
  const p = patients.find(x => x.id === currentPatientId); if (!p.questionnaire) return;
  const q = p.questionnaire;
  document.getElementById('questionnaireBody').innerHTML = '<div class="questionnaire-data" style="font-size:13px;"><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">受信時刻</span><span>' + esc(q.receivedAt) + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">主な症状</span><span>' + esc(q.symptoms) + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">発症期間</span><span>' + esc(q.duration) + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">体温</span><span>' + esc(q.temperature) + '℃</span></div>' + (q.otherComplaints ? '<div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">その他</span><span>' + esc(q.otherComplaints) + '</span></div>' : '') + '</div>';
  document.getElementById('questionnaireModal').classList.add('show');
}
function applyQuestionnaire() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId]; const q = p.questionnaire; if (!q) return;
  if (q.symptoms && !k.chiefComplaint) { k.chiefComplaint = q.symptoms; document.getElementById('chiefComplaint').value = q.symptoms; }
  const editor = document.getElementById('findingsEditor');
  if (editor && !editor.innerText.trim()) {
    let html = '<b>[現病歴]</b><br>';
    if (q.duration) html += esc(q.duration) + '発症。<br>';
    if (q.otherComplaints) html += esc(q.otherComplaints) + '<br>';
    html += '<br><b>[身体所見]</b><br><br><b>[A&P]</b>';
    editor.innerHTML = html;
  }
  if (q.temperature && !k.vitals.t) { k.vitals.t = q.temperature; document.getElementById('vitalT').value = q.temperature; }
  closeModal('questionnaireModal'); showToast('問診票をカルテに反映');
}

function openDocModal(type) {
  currentDocType = type;
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  let title = '', html = '';
  if (type === 'referral') {
    title = '診療情報提供書（紹介状）';
    html = '<div class="form-group"><label class="form-label">紹介先医療機関</label><input type="text" class="form-input" placeholder="○○病院"></div><div class="form-group"><label class="form-label">紹介先診療科</label><input type="text" class="form-input" placeholder="内科"></div><div class="form-group"><label class="form-label">傷病名</label><input type="text" class="form-input" value="' + esc(k.selectedDiseases.map(d=>d.name).join(', ')) + '"></div><div class="form-group"><label class="form-label">紹介目的・経過</label><textarea class="form-textarea" rows="5">上記患者様を紹介申し上げます。\nご高診のほどよろしくお願い申し上げます。</textarea></div>';
  } else if (type === 'diagnosis') {
    title = '診断書';
    html = '<div class="form-group"><label class="form-label">患者氏名</label><input type="text" class="form-input" value="' + esc(p.name) + '" readonly></div><div class="form-group"><label class="form-label">傷病名</label><input type="text" class="form-input" value="' + esc(k.selectedDiseases.map(d=>d.name).join(', ')) + '"></div><div class="form-group"><label class="form-label">所見</label><textarea class="form-textarea" rows="4" placeholder="所見・経過を記載"></textarea></div>';
  } else if (type === 'prescription') {
    title = '院外処方箋';
    html = '<div class="form-group"><label class="form-label">患者 / 保険</label><input type="text" class="form-input" value="' + esc(p.name) + ' / ' + esc(p.insurance) + '" readonly></div><div class="form-group"><label class="form-label">処方内容</label><div style="background:var(--bg);padding:8px;border-radius:var(--radius-sm);font-size:12px;">';
    if (!k.prescriptions.length) html += '<div style="color:var(--text-muted);">処方なし</div>';
    else k.prescriptions.forEach(rx => { html += '<div style="padding:2px 0;">' + esc(rx.drug.name) + ' ' + rx.qty + esc(rx.drug.unit) + ' x ' + (rx.days||k.rxDays) + '日分' + (rx.note ? '<div style="font-size:11px;color:#666;padding-left:12px;">※ ' + esc(rx.note) + '</div>' : '') + '</div>'; });
    html += '</div></div>';
  }
  document.getElementById('docModalTitle').innerHTML = title + ' <button class="modal-close" onclick="closeModal(\'docModal\')">&times;</button>';
  document.getElementById('docModalBody').innerHTML = html;
  document.getElementById('docModal').classList.add('show');
}

let currentDocType = '';
function saveDocument() {
  const p = patients.find(x => x.id === currentPatientId);
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const typeMap = { referral: '診療情報提供書', diagnosis: '診断書', prescription: '院外処方箋' };
  const docType = typeMap[currentDocType] || '文書';
  postToApi('saveDocument', { 'カルテID': karteId, '患者ID': currentPatientId, '文書種別': docType, 'タイトル': docType + ' - ' + p.name, '内容JSON': JSON.stringify({ date: selectedDate, patient: p.name }) });
  closeModal('docModal'); showToast(docType + 'を保存しました');
}

// ===== Toast =====
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

// ===== Close dropdowns =====
document.addEventListener('click', function(e) {
  if (!e.target.closest('.disease-search-wrap')) document.getElementById('diseaseResults')?.classList.remove('show');
  if (!e.target.closest('.drug-search-wrap')) document.getElementById('drugResults')?.classList.remove('show');
});

// ===== v0.8: 機能3 院外処方トグル =====
function toggleRxMode(checked) {
  const k = karteData[currentPatientId];
  k.rxModeExternal = checked;
  recalcBilling();
  showToast(checked ? '院外処方モード' : '院内処方モード');
}

// ===== v0.8: 機能4 保険証写真削除 =====
function deleteInsurancePhoto() {
  if (!confirm('保険証写真を削除しますか？')) return;
  const p = patients.find(x => x.id === currentPatientId);
  p.insurancePhoto = null;
  document.getElementById('insurancePhotoPreview').style.display = 'none';
  document.getElementById('insuranceUploadText2').style.display = '';
  document.getElementById('insurancePhotoDeleteBtn').style.display = 'none';
  renderPatientInfoTab(p);
  showToast('保険証写真を削除');
}

// ===== v0.8: 機能6 和暦変換 =====
function toWareki(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  // 要望#3の実装に合わせ、元号の切替は正確な日付で判定する（1989-01-07=昭和64年 / 01-08=平成元年）
  const parts = isoToWarekiParts(dateStr.slice(0, 10));
  if (parts) return parts.era + (parts.year === 1 ? '元' : parts.year) + '年' + parts.month + '月' + parts.day + '日';
  return dateStr;
}

// ===== v0.8: 機能7 患者一覧ソート（昇順/降順トグル） =====
let currentSortMode = 'arrival';
let currentSortAsc = true;
function sortPatientList(mode) {
  if (currentSortMode === mode) { currentSortAsc = !currentSortAsc; }
  else { currentSortMode = mode; currentSortAsc = (mode === 'number') ? false : true; }
  updateSortBtnUI();
  renderPatientList();
  const dir = currentSortAsc ? '昇順' : '降順';
  showToast('並替: ' + (mode==='name'?'名前':mode==='status'?'状態':'来院') + ' ' + dir);
}
function updateSortBtnUI() {
  ['name','arrival','status'].forEach(m => {
    const btn = document.getElementById('sortBtn' + m.charAt(0).toUpperCase() + m.slice(1));
    if (!btn) return;
    const arrow = currentSortMode === m ? (currentSortAsc ? ' ▲' : ' ▼') : '';
    const label = m==='name'?'名前':m==='arrival'?'来院':'状態';
    btn.textContent = label + arrow;
    btn.classList.toggle('sort-active', currentSortMode === m);
  });
  // #列ヘッダー矢印
  const numH = document.getElementById('sortHeaderNum');
  if (numH) numH.textContent = currentSortMode === 'number' ? (currentSortAsc ? '▲' : '▼') : '';
}

// ===== v0.8: 機能8 検査セクション折りたたみ =====
let examSectionCollapsed = localStorage.getItem('karte_examCollapsed') === 'true';
function toggleExamSection() {
  examSectionCollapsed = !examSectionCollapsed;
  localStorage.setItem('karte_examCollapsed', examSectionCollapsed);
  applyExamCollapse();
}
function applyExamCollapse() {
  const body = document.getElementById('examSectionBody');
  const icon = document.getElementById('examCollapseIcon');
  if (body) body.style.display = examSectionCollapsed ? 'none' : '';
  if (icon) icon.innerHTML = examSectionCollapsed ? '&#9654;' : '&#9660;';
}

// ===== v0.8: 機能9 算定追加確認リスト =====
function renderAddedBillingList() {
  const k = karteData[currentPatientId];
  const container = document.getElementById('addedBillingList');
  const itemsEl = document.getElementById('addedBillingItems');
  var clearBtn = document.getElementById('btnClearBilling');
  if (!k || !k.addedBillingItems || !k.addedBillingItems.length) { if (container) container.style.display = 'none'; if (clearBtn) clearBtn.disabled = true; return; }
  container.style.display = '';
  itemsEl.innerHTML = k.addedBillingItems.map((it,i) =>
    '<div class="added-billing-item"><span>' + esc(it.name) + '</span><span class="added-billing-pts">' + it.points + '点</span><span class="added-billing-del" onclick="removeAddedBilling(' + i + ')" title="削除">&times;</span></div>'
  ).join('');
  if (clearBtn) clearBtn.disabled = !k.addedBillingItems.length;
}
function removeAddedBilling(i) {
  const k = karteData[currentPatientId];
  const it = k.addedBillingItems[i];
  const name = it.name;
  if (it.std) { k.stdRemoved = k.stdRemoved || {}; k.stdRemoved[name] = true; } // 標準加算を外したら再付与しない
  k.addedBillingItems.splice(i,1);
  recalcBilling();
  showToast(name + ' を削除');
}
function removeBillingRow(key) {
  var k = karteData[currentPatientId];
  if (!k) return;
  if (!k.excludedBillingRows) k.excludedBillingRows = {};
  if (k.excludedBillingRows[key]) {
    delete k.excludedBillingRows[key];
  } else {
    k.excludedBillingRows[key] = true;
  }
  recalcBilling();
}
function clearAllBilling() {
  var k = karteData[currentPatientId];
  if (!k) return;
  var hasItems = (k.addedBillingItems && k.addedBillingItems.length > 0);
  var hasExams = (k.selectedExams && k.selectedExams.length > 0);
  var hasExcluded = k.excludedBillingRows && Object.keys(k.excludedBillingRows).length > 0;
  if (!hasItems && !hasExams && !hasExcluded) { showToast('クリアする算定項目がありません'); return; }
  if (!confirm('追加済み算定・検査・個別除外をすべてリセットしますか？')) return;
  k.addedBillingItems = [];
  k.selectedExams = [];
  k.excludedBillingRows = {};
  document.querySelectorAll('#examCheckList input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
  recalcBilling();
  showToast('算定項目をリセットしました');
}

// ===== v0.8: 機能10 既存患者保険証モーダルOCR/QR =====



// ===== v0.11: 医療証種別→法別番号自動入力 =====
// ===== 要望#4: 医療証と負担割合の食い違い警告 =====
// 方針（ユーザー確定 2026-08-05）: 自動では負担割合を変えない。食い違いを警告するだけにする。
// 医療証の種別によって実際の負担割合は異なる（子ども医療は自治体により一部自己負担、精神通院は1割）ため、
// 「医療証あり＝一律0割」の自動化は行わない。
var insuranceWarnDismissed = false;
function insuranceWarnState() {
  var typeEl = document.getElementById('iryoType');
  var ratioEl = document.getElementById('insuranceRatio');
  if (!typeEl || !ratioEl) return null;
  var iryo = (typeEl.value || '').trim();
  var ratio = parseFloat(ratioEl.value);
  if (!iryo || iryo === 'なし') return null;
  if (!(ratio > 0)) return null;
  return { iryo: iryo, ratio: ratio, label: (ratio * 10) + '割' };
}
function updateInsuranceWarn() {
  var banner = document.getElementById('insWarnBanner');
  if (!banner) return;
  var st = insuranceWarnState();
  if (!st || insuranceWarnDismissed) { banner.style.display = 'none'; return; }
  document.getElementById('insWarnText').innerHTML =
    '&#9888; 医療証（' + esc(st.iryo) + '）が登録されていますが、負担割合が「' + esc(st.label) + '」のままです';
  banner.style.display = '';
}
function applyKouhiZero() {
  var ratioEl = document.getElementById('insuranceRatio');
  if (ratioEl) ratioEl.value = '0';
  insuranceWarnDismissed = false;
  updateInsuranceWarn();
  showToast('負担割合を0割にしました');
}
function dismissInsuranceWarn() {
  insuranceWarnDismissed = true;
  updateInsuranceWarn();
}

function onIryoTypeChange(val) {
  var hobetsuMap = {
    '乳幼児医療': '82',
    '子ども医療': '81',
    '障害者医療': '83',
    'ひとり親医療': '84',
    '精神通院': '21',
    '特定医療費': '54',
    '被爆者': '19',
    'その他': ''
  };
  var code = hobetsuMap[val] || '';
  document.getElementById('iryoHobetsu').value = code;
  insuranceWarnDismissed = false;   // 要望#4: 医療証を変えたら警告を出し直す
  updateInsuranceWarn();
}

// ===== v0.8: 医療証写真・データ管理 =====
function handleIryoPhoto(input) {
  var file = input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var p = patients.find(function(x) { return x.id === currentPatientId; });
    if (!p) return;
    p.iryoPhoto = e.target.result;
    document.getElementById('iryoPhotoPreview').src = e.target.result;
    document.getElementById('iryoPhotoPreview').style.display = 'block';
    document.getElementById('iryoUploadText').style.display = 'none';
    document.getElementById('iryoPhotoDeleteBtn').style.display = '';
    showToast('医療証写真を保存');
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function deleteIryoPhoto() {
  if (!confirm('医療証写真を削除しますか？')) return;
  var p = patients.find(function(x) { return x.id === currentPatientId; });
  if (p) p.iryoPhoto = null;
  document.getElementById('iryoPhotoPreview').style.display = 'none';
  document.getElementById('iryoUploadText').style.display = '';
  document.getElementById('iryoPhotoDeleteBtn').style.display = 'none';
  showToast('医療証写真を削除');
}

// ===== Init =====
document.getElementById('listDate').value = selectedDate;
renderSetOrders();
renderDiseaseQuickBtns();
renderPatientList();
// loadDbData() is called after auth completes (inside initSupabase → showApp)
initSupabase().then(ok => {
  if (ok) console.log('[v0.8] Supabase二重書き込みモード有効');
  // セット処方はSupabaseを正とする（端末をまたいで共有される）
  if (ok) syncSetOrdersFromSupabase();
});
// 前回サーバに保存できなかったカルテが残っていれば起動時に知らせる（氏名の消失防止）
try { renderPendingSaveBanner(); } catch (e) { console.error(e); }
updateRevisionBadge();
applyExamCollapse();

// ===== 改定バージョン表示 =====
function updateRevisionBadge() {
  const badge = document.getElementById('revisionBadge');
  if (!badge) return;
  const info = getRevisionInfo(selectedDate);
  badge.textContent = info.label;
  badge.style.display = 'inline-block';
  if (info.isNewRevision) {
    badge.style.background = '#e8f5e9';
    badge.style.color = '#2e7d32';
  } else {
    badge.style.background = '#eceff1';
    badge.style.color = '#607d8b';
  }
}
