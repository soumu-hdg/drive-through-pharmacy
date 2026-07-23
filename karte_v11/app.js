// ===== XSS Protection =====
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ===== Config =====
const API_URL = 'https://script.google.com/macros/s/AKfycbwFzGLG20GaSLxfdRDAg1ATqQu_s5MWYF045Rlc3OH01duvrL2rqlP9VSQxCEodiePX/exec';
// DB連携は db_integration.js に分離済み

// ===== Data =====
const patients = [
  { id:'P001', name:'田中太郎', age:75, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1951-03-15', address:'愛知県北名古屋市西之保犬井190', phone:'0568-22-XXXX', nameKana:'タナカタロウ', allergies:['ペニシリン系'], history:['高血圧症','2型糖尿病'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 あ 12-34',lane:1}, status:'active', memo:'定期処方。血圧コントロール良好。', insurancePhoto:null, insSymbol:'12345', insNumber:'678', insEdaban:'01', insuranceNumber:'12345-678(01)', insurerNumber:'39230010', kouhiNumber:'', kouhiEdaban:'', recipientEdaban:'', incomeLevel:'ippan', iryoHobetsu:'', iryoRecipientEdaban:'', questionnaire:null, arrivedAt:'09:00', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'},{date:'2026-01-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'}], pastVitals:[{date:'2026-02-18',t:'36.2',bp:'132/78',spo2:'97',p:'68'},{date:'2026-01-18',t:'36.4',bp:'128/76',spo2:'98',p:'72'}] },
  { id:'P002', name:'鈴木花子', age:45, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1981-07-22', address:'愛知県名古���市中区栄3-1-1', phone:'052-XXX-XXXX', nameKana:'スズキハナコ', allergies:[], history:['花粉症'], prevRx:[{drugId:'montelukast10',qty:1,unit:'T'}], prevDays:14, prevVisitDate:'2026-03-04', vehicle:{plate:'名��屋 300 い 56-78',lane:2}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:30',symptoms:'鼻水、くしゃみ',duration:'3日前から',temperature:'36.4',otherComplaints:'目のかゆみ'}, arrivedAt:'09:15', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-04',cc:'花粉���',diag:'アレルギー性鼻炎',rx:'モンテルカスト10mg 1T 14日',doc:'院長'}], pastVitals:[{date:'2026-03-04',t:'36.4',bp:'118/72',spo2:'99',p:'76'}] },
  { id:'P003', name:'佐藤一郎', age:62, sex:'男', insurance:'国保3割', ratio:0.3, dob:'1964-11-05', address:'愛知県北名古屋市久地野牧野55', phone:'0568-XX-XXXX', nameKana:'サトウイチロウ', allergies:['セフェム系'], history:['脂質異常症'], prevRx:[{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 う 90-12',lane:3}, status:'waiting', memo:'LDLコレステロール要フォロー', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:22', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'脂質異常症',rx:'アトルバスタチン10mg 1T 28日',doc:'副院長'}], pastVitals:[{date:'2026-02-18',t:'36.3',bp:'140/88',spo2:'96',p:'74'}] },
  { id:'P004', name:'山田美咲', age:38, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1988-04-10', address:'愛知県清須市清洲2272', phone:'052-XXX-XXXX', nameKana:'ヤマダミサキ', allergies:[], history:['片頭痛'], prevRx:[{drugId:'loxoprofen60',qty:3,unit:'T'},{drugId:'rebamipide100',qty:3,unit:'T'}], prevDays:7, prevVisitDate:'2026-03-11', vehicle:{plate:'名古屋 300 え 34-56',lane:4}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:45',symptoms:'頭痛',duration:'昨日から',temperature:'36.8',otherComplaints:'吐き気あり'}, arrivedAt:'09:35', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-11',cc:'頭痛',diag:'片頭痛',rx:'ロキソプロフェン60mg 3T, レバミピド100mg 3T 7日',doc:'院長'}], pastVitals:[] },
  { id:'P005', name:'高橋健二', age:82, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1944-01-20', address:'愛知県北名古屋市西春駅前1-1', phone:'0568-XX-XXXX', nameKana:'タカハシケンジ', allergies:['ロキソプロフェン'], history:['2型糖尿病','高血圧症'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'},{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 お 78-90',lane:5}, status:'waiting', memo:'HbA1c 7.2%。次回採血予定。', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:50', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'2型糖尿病, 高血圧症',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T, アトルバスタチン10mg 1T 28日',doc:'院��'}], pastVitals:[{date:'2026-02-18',t:'36.5',bp:'138/82',spo2:'95',p:'70'}] }
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
  { id:'loperamide1', name:'ロペラミ���錠1mg', price:5.7, unit:'T', category:'胃腸' },
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
function saveSetOrders() { localStorage.setItem('karte_setOrders', JSON.stringify(setOrders)); }

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
  {id:'xray_chest',name:'胸部X線',points:210},{id:'covid_antigen',name:'���ロナ抗原',points:150},
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
      selectedExams:[], addedBillingItems:[]
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
    if (hasData && !confirm('一覧に戻ります。\n入力中のデータは一時保存しますか？\n\nOK = 一時保存して戻る\nキャンセル = 保存せず戻��')) {
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
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">この日の受付患者はいません' + dbMsg + '</td></tr>';
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
      return '<tr onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;background:#f8faff;"><td>' + (p._origNum||i+1) + '</td><td class="td-status">' + typeBadge + '</td><td class="td-name">' + esc(p.name) + '<div class="sub">DB / ' + esc(p.address || '') + ' / ' + esc(time) + '</div></td><td>' + esc(p.age) + '歳 ' + esc(p.sex) + '</td><td>' + esc(p.insurance) + '</td><td class="td-allergy">' + esc(tests || '-') + '</td><td class="td-lane">' + esc(doctor) + '</td><td class="td-questionnaire">' + esc(p.route || '-') + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button></td></tr>';
    }
    if (p.status === 'waiting') waitC++; else if (p.status === 'active') activeC++; else if (p.status === 'done') doneC++;
    const statusBadge = p.status === 'active' ? '<span class="status-badge active">診察中</span>' : p.status === 'done' ? '<span class="status-badge done">完了</span>' : '<span class="status-badge waiting">待機</span>';
    const allergyStr = p.allergies.length > 0 ? p.allergies.join(', ') : '-';
    const qBadge = p.questionnaire ? '<span class="q-badge received">受信済</span>' : '<span class="q-badge none">-</span>';
    const rowClass = p.status === 'done' ? ' class="status-done-row"' : '';
    return '<tr' + rowClass + ' onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;"><td>' + (p._origNum||i+1) + '</td><td class="td-status">' + statusBadge + '</td><td class="td-name">' + esc(p.name) + '<div class="sub">' + esc(p.nameKana||'') + ' / ' + esc(p.id) + ' / ' + esc(p.arrivedAt||'') + '</div></td><td>' + esc(p.age) + '歳 ' + esc(p.sex) + '</td><td>' + esc(p.insurance) + '</td><td class="td-allergy">' + esc(allergyStr) + '</td><td class="td-lane">L' + esc(p.vehicle.lane) + '</td><td class="td-questionnaire">' + qBadge + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button>' + (p.status === 'waiting' ? '<button class="action-btn call-btn" onclick="event.stopPropagation();callPatientFromList(\'' + p.id + '\')">呼出</button>' : '') + '</td></tr>';
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
  document.getElementById('newLane').value = patients.length + 1;
  document.getElementById('newPatientNo').value = 'P-' + String(patients.length + 1).padStart(5, '0');
  document.querySelector('input[name="newSex"][value="男"]').checked = true;
  document.getElementById('newInsurance').value = '社保3割';
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
let ocrStream = null;       // カメラストリーム
let ocrExtracted = null;    // 最新の抽出結果

function startOcrCamera() {
  const wrap = document.getElementById('ocrCameraWrap');
  const video = document.getElementById('ocrVideo');
  wrap.style.display = 'block';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then(stream => { ocrStream = stream; video.srcObject = stream; })
    .catch(e => { showToast('カメラを起動できません: ' + e.message); wrap.style.display = 'none'; });
}

function stopOcrCamera() {
  if (ocrStream) { ocrStream.getTracks().forEach(t => t.stop()); ocrStream = null; }
  const video = document.getElementById('ocrVideo');
  video.srcObject = null;
  document.getElementById('ocrCameraWrap').style.display = 'none';
}

function captureOcrPhoto() {
  const video = document.getElementById('ocrVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopOcrCamera();
  processOcrImage(canvas.toDataURL('image/jpeg', 0.9));
}

function onOcrFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => processOcrImage(e.target.result);
  reader.readAsDataURL(input.files[0]);
  input.value = '';
}

// === OCRフィールド厳格バリデーション ===
// 間違った値を入れるより空白の方が遥かに安全。不正な値は容赦なく却下する。
function validateOcrFields(f) {
  const today = new Date();
  const warnings = [];

  // --- 生年月日: 未来日・1歳未満・120歳超は却下 ---
  if (f.dob) {
    const dobDate = new Date(f.dob);
    const ageMsec = today - dobDate;
    const ageYears = ageMsec / (365.25 * 24 * 60 * 60 * 1000);
    if (isNaN(dobDate.getTime()) || dobDate > today || ageYears < 1 || ageYears > 120) {
      warnings.push('生年月日 "' + f.dob + '" は不正（交付日の誤認識の可能性）。却下しました。');
      f.dob = null;
    }
  }

  // --- フリガナ: カタカナ文字が50%未満なら却下 ---
  if (f.nameKana) {
    const cleaned = f.nameKana.replace(/[\s　]/g, '');
    const kataCount = (cleaned.match(/[ァ-ヶ]/g) || []).length;
    if (cleaned.length === 0 || kataCount / cleaned.length < 0.5) {
      warnings.push('フリガナ "' + f.nameKana + '" はカタカナとして不正。却下しました。');
      f.nameKana = null;
    }
  }

  // --- 保険者番号: 6-8桁の数字以外は却下 ---
  if (f.insurerNumber) {
    const cleaned = f.insurerNumber.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(cleaned)) {
      warnings.push('保険者番号 "' + f.insurerNumber + '" は数字6-8桁でない。却下しました。');
      f.insurerNumber = null;
    }
  }

  // --- 記号: 空白やゴミ文字のみなら却下 ---
  if (f.symbol) {
    const cleaned = f.symbol.replace(/[ーー\-\s]/g, '');
    if (cleaned.length < 1) {
      f.symbol = null;
    }
  }

  // --- 氏名: 漢字を1文字も含まない場合は却下 ---
  if (f.name) {
    if (!/[\u4e00-\u9fff]/.test(f.name)) {
      warnings.push('氏名 "' + f.name + '" に漢字が含まれない。却下しました。');
      f.name = null;
    }
  }

  // --- 住所: 都道府県名を含まない場合はwarnフラグ ---
  if (f.address) {
    f._addressUncertain = !/[都道府県]/.test(f.address) && !/市|区|町|村/.test(f.address);
  }

  f._validationWarnings = warnings;
  return f;
}

function processOcrImage(dataUrl) {
  // プレビュー表示
  const wrap = document.getElementById('ocrPreviewWrap');
  const img = document.getElementById('ocrPreviewImg');
  const progressArea = document.getElementById('ocrProgressArea');
  const resultArea = document.getElementById('ocrResultArea');
  const applyBtn = document.getElementById('ocrApplyBtn');

  wrap.style.display = 'block';
  img.src = dataUrl;
  img.style.display = 'block';
  progressArea.style.display = 'block';
  resultArea.style.display = 'none';
  applyBtn.style.display = 'none';

  // ===== ハイブリッド方式: QRコード優先 → OCR補完 =====
  // Step 1: QRコード検出（高速・確実）
  document.getElementById('ocrProgressText').textContent = 'QRコード検出中...';
  document.getElementById('ocrProgressFill').style.width = '10%';

  const qrPromise = (typeof QR_DECODER !== 'undefined')
    ? QR_DECODER.decodeFromDataUrl(dataUrl)
    : Promise.resolve(null);

  qrPromise.then(qrResult => {
    // Step 2: OCR実行（QR有無に関わらず個人情報取得のため実行）
    document.getElementById('ocrProgressText').textContent = 'OCR実行中...';
    document.getElementById('ocrProgressFill').style.width = '20%';

    return OCR_ENGINE.recognize(dataUrl, (status, pct) => {
      document.getElementById('ocrProgressText').textContent = status;
      document.getElementById('ocrProgressFill').style.width = (20 + pct * 0.8) + '%';
    }).then(data => ({ qrResult, ocrData: data }));
  }).then(({ qrResult, ocrData }) => {
    progressArea.style.display = 'none';

    // OCRフィールド抽出
    const ocrFields = ocrData._mergedFields || OCR_ENGINE.extractInsuranceFields(ocrData.text);
    validateOcrFields(ocrFields);

    // QRデータをOCR結果にマージ（QR優先）
    const fields = mergeQrAndOcr(qrResult, ocrFields);

    ocrExtracted = fields;

    // フリガナから漢字推測
    if (fields.nameKana && typeof NAME_DICT !== 'undefined') {
      const guess = NAME_DICT.guessKanji(fields.nameKana);
      if (guess && guess.full) {
        fields.nameGuess = guess.full;
        fields.nameGuessCandidates = guess;
      }
      if (!fields.sex) {
        const parts = fields.nameKana.split(/[\s　]+/);
        if (parts.length >= 2) {
          const sexGuess = NAME_DICT.guessSex(parts[1]);
          if (sexGuess) fields.sexGuess = sexGuess;
        }
      }
    }

    renderOcrResult(fields);
  }).catch(err => {
    progressArea.style.display = 'none';
    resultArea.style.display = 'block';
    resultArea.innerHTML = '<div style="color:var(--danger);font-size:12px;">読取エラー: ' + esc(err.message) + '</div>';
  });
}

/**
 * QRコード結果とOCR結果をマージ
 * QRコードのデータは100%信頼。OCRは個人情報のフォールバック。
 */
function mergeQrAndOcr(qrResult, ocrFields) {
  const fields = Object.assign({}, ocrFields);
  fields._qrResult = qrResult;

  if (!qrResult || qrResult.format === 'unknown') return fields;

  // QRから取得できるフィールドを上書き（QR=確実）
  if (qrResult.insurerNumber) {
    fields.insurerNumber = qrResult.insurerNumber;
    fields._insurerFromQR = true;
  }
  if (qrResult.symbol) {
    fields.symbol = qrResult.symbol;
    fields._symbolFromQR = true;
  }
  if (qrResult.memberNumber) {
    fields.memberNumber = qrResult.memberNumber;
    fields._memberFromQR = true;
  }
  if (qrResult.edaban) {
    fields.edaban = qrResult.edaban;
    fields._edabanFromQR = true;
  }

  // 信頼度を再計算: QRから保険番号系が取れれば大幅アップ
  if (qrResult.insurerNumber && qrResult.symbol && qrResult.memberNumber) {
    fields.confidence = Math.max(fields.confidence || 0, 80);
  }

  return fields;
}

function renderOcrResult(f) {
  const area = document.getElementById('ocrResultArea');
  area.style.display = 'block';
  document.getElementById('ocrApplyBtn').style.display = 'inline-block';

  const hasQR = f._qrResult && f._qrResult.format !== 'unknown';

  let html = '';

  // QRコード読取成功バナー
  if (hasQR) {
    html += '<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#155724;font-weight:700;">';
    html += '&#10004; QRコード読取成功（保険番号系は確実）';
    html += '</div>';
  }

  html += '<div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px;">読取結果</div>';

  // バリデーション警告を表示
  if (f._validationWarnings && f._validationWarnings.length > 0) {
    html += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:10px;color:#856404;">';
    html += '&#9888; ' + f._validationWarnings.join('<br>&#9888; ');
    html += '</div>';
  }

  // QR由来 = ✓確認済み（緑）, OCR由来 = ⚠要確認（黄）
  const rows = [
    { label: '保険者番号', val: f.insurerNumber, qr: f._insurerFromQR },
    { label: '記号', val: f.symbol, qr: f._symbolFromQR },
    { label: '番号', val: f.memberNumber, qr: f._memberFromQR },
    { label: '枝番', val: f.edaban, qr: f._edabanFromQR },
    { label: 'フリガナ', val: f.nameKana, qr: false },
    { label: '氏名', val: f.nameGuess || f.name, qr: false },
    { label: '生年月日', val: f.dob, qr: false },
    { label: '性別', val: f.sex || f.sexGuess || null, qr: false, guess: f.sexGuess && !f.sex },
    { label: '郵便番号', val: f.postalCode, qr: false },
    { label: '住所', val: f.address, qr: false },
  ];

  for (const r of rows) {
    if (!r.val) continue;
    let iconHtml;
    let valueClass;
    if (r.qr) {
      iconHtml = ' <span style="color:#28a745;font-size:10px;font-weight:700;">&#10004; QR確認済</span>';
      valueClass = 'ocr-field-value';
    } else if (r.guess) {
      iconHtml = ' <span class="ocr-field-warn">&#9733; 推測</span>';
      valueClass = 'ocr-field-value low-conf';
    } else {
      iconHtml = r.val ? ' <span class="ocr-field-warn">&#9888; 要確認</span>' : '';
      valueClass = 'ocr-field-value low-conf';
    }
    html += '<div class="ocr-field-row"><span class="ocr-field-label">' + esc(r.label) + '</span><span class="' + valueClass + '">' + esc(r.val) + '</span>' + iconHtml + '</div>';
  }

  // 漢字候補がある場合
  if (f.nameGuessCandidates) {
    const gc = f.nameGuessCandidates;
    if (gc.surnameCandidates.length > 1 || gc.givenCandidates.length > 1) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">漢字候補: ';
      if (gc.surnameCandidates.length > 1) html += '姓=' + gc.surnameCandidates.map(esc).join('/') + ' ';
      if (gc.givenCandidates.length > 1) html += '名=' + gc.givenCandidates.map(esc).join('/');
      html += '</div>';
    }
  }

  // 情報バナー
  if (hasQR) {
    html += '<div style="background:#e8f4fd;border-radius:4px;padding:4px 8px;margin-top:6px;font-size:10px;color:#0c5460;">';
    html += '&#9432; 保険番号系はQRコードから取得（確実）。氏名・生年月日はOCR参考値のため目視確認してください。';
    html += '</div>';
  } else {
    html += '<div style="background:#fff3cd;border-radius:4px;padding:4px 8px;margin-top:6px;font-size:10px;color:#856404;">';
    html += '&#9888; QRコードを検出できませんでした。全項目がOCR参考値です。反映後に必ず目視確認してください。';
    html += '</div>';
  }

  if (!f.insurerNumber && !f.nameKana && !f.dob && !f.symbol) {
    html += '<div style="color:var(--danger);font-size:11px;margin-top:6px;">&#9888; 保険証のテキストを十分に認識できませんでした。<br>画像が鮮明でない場合は、再度撮影してください。</div>';
  }

  area.innerHTML = html;
}

function applyOcrResults() {
  if (!ocrExtracted) return;
  const f = ocrExtracted;

  // フリガナ反映
  if (f.nameKana) {
    document.getElementById('newNameKana').value = f.nameKana;
  }

  // 漢字氏名（推測 or OCR直接）
  if (f.nameGuess) {
    document.getElementById('newName').value = f.nameGuess;
    // 候補がある場合にヒント表示
    if (f.nameGuessCandidates && (f.nameGuessCandidates.surnameCandidates.length > 1 || f.nameGuessCandidates.givenCandidates.length > 1)) {
      const hint = document.getElementById('newNameGuess');
      if (hint) {
        hint.style.display = 'inline';
        const allCombos = [];
        const sc = f.nameGuessCandidates.surnameCandidates;
        const gc = f.nameGuessCandidates.givenCandidates;
        for (const s of (sc.length ? sc : [f.nameKana.split(/[\s　]+/)[0]])) {
          for (const g of (gc.length ? gc : [f.nameKana.split(/[\s　]+/)[1] || ''])) {
            allCombos.push(s + ' ' + g);
          }
        }
        hint.textContent = '他候補: ' + allCombos.slice(1, 5).join(', ');
        hint.title = '全候補: ' + allCombos.join(', ');
      }
    }
  } else if (f.name) {
    document.getElementById('newName').value = f.name;
  }

  // 生年月日
  if (f.dob) {
    document.getElementById('newDob').value = f.dob;
  }

  // 性別
  const sex = f.sex || f.sexGuess;
  if (sex) {
    const radio = document.querySelector('input[name="newSex"][value="' + sex + '"]');
    if (radio) radio.checked = true;
  }

  // 保険者番号
  if (f.insurerNumber) {
    document.getElementById('newInsurerNumber').value = f.insurerNumber;
    onNewInsurerNumberInput(f.insurerNumber);
  }

  // QR由来のソース情報をトースト表示
  if (f._qrResult && f._qrResult.format !== 'unknown') {
    showToast('QRコードから保険番号を取得しました');
  }

  // 郵便番号→住所自動入力
  if (f.postalCode) {
    const cleaned = f.postalCode.replace(/[^0-9]/g, '');
    document.getElementById('newZip').value = f.postalCode;
    // zipcloudで住所を引く
    if (cleaned.length === 7) {
      fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + cleaned)
        .then(r => r.json())
        .then(data => {
          if (data.results && data.results[0]) {
            const r = data.results[0];
            document.getElementById('newPref').value = r.address1;
            document.getElementById('newCity').value = r.address2 + r.address3;
            // OCRの住所から番地部分を抽出
            if (f.address) {
              const addrParts = OCR_ENGINE.splitAddress(f.address);
              if (addrParts.street) document.getElementById('newStreet').value = addrParts.street;
              if (addrParts.building) document.getElementById('newBuilding').value = addrParts.building;
            }
          }
        }).catch(() => {
          // zipcloud失敗時はOCRの住所をそのまま分割
          if (f.address) {
            const addrParts = OCR_ENGINE.splitAddress(f.address);
            document.getElementById('newPref').value = addrParts.pref;
            document.getElementById('newCity').value = addrParts.city;
            document.getElementById('newStreet').value = addrParts.street;
            document.getElementById('newBuilding').value = addrParts.building;
          }
        });
    }
  } else if (f.address) {
    // 郵便番号なし→OCR住所をそのまま分割
    const addrParts = OCR_ENGINE.splitAddress(f.address);
    document.getElementById('newPref').value = addrParts.pref;
    document.getElementById('newCity').value = addrParts.city;
    document.getElementById('newStreet').value = addrParts.street;
    document.getElementById('newBuilding').value = addrParts.building;
  }

  // 保険証画像をpatient dataに保存するためbase64をキャッシュ
  ocrExtracted._imageData = document.getElementById('ocrPreviewImg').src;

  showToast('読取結果を反映しました（漢字氏名・住所は要確認）');
}

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

function clearOcrPreview() {
  document.getElementById('ocrPreviewWrap').style.display = 'none';
  document.getElementById('ocrPreviewImg').src = '';
  document.getElementById('ocrResultArea').innerHTML = '';
  document.getElementById('ocrApplyBtn').style.display = 'none';
  ocrExtracted = null;
  const hint = document.getElementById('newNameGuess');
  if (hint) hint.style.display = 'none';
}

function autoFillAddress(zip) {
  const cleaned = zip.replace(/[^0-9]/g, '');
  if (cleaned.length === 7) {
    fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + cleaned)
      .then(r => r.json())
      .then(data => {
        if (data.results && data.results[0]) {
          const r = data.results[0];
          document.getElementById('newPref').value = r.address1;
          document.getElementById('newCity').value = r.address2 + r.address3;
        }
      }).catch(() => {});
  }
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
  const address = [pref, city, street, building].filter(Boolean).join(' ');
  const now = new Date();
  const newP = {
    id: document.getElementById('newPatientNo').value || ('P' + (Date.now() % 100000)),
    name, nameKana: kana, age, sex, insurance: ins, ratio, dob, address,
    phone: document.getElementById('newPhone').value,
    allergies: [], history: [], prevRx: [], prevDays: 0, prevVisitDate: '',
    vehicle: { plate: document.getElementById('newPlate').value || '---', lane: parseInt(document.getElementById('newLane').value) || 1 },
    status: andOpen ? 'waiting' : 'waiting', memo: '',
    insurancePhoto: (ocrExtracted && ocrExtracted._imageData) ? ocrExtracted._imageData : null, insSymbol: (ocrExtracted && ocrExtracted.symbol) || '', insNumber: (ocrExtracted && ocrExtracted.memberNumber) || '', insEdaban: (ocrExtracted && ocrExtracted.edaban) || '', insuranceNumber: buildInsuranceNumberStr(ocrExtracted), insurerNumber: (newInsurerNum ? newInsurerNum.value : ''), kouhiNumber: '', kouhiEdaban: '', recipientEdaban: '', incomeLevel: 'ippan', iryoHobetsu: '', iryoRecipientEdaban: '', questionnaire: null,
    arrivedAt: now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'),
    visitDate: selectedDate, pastKartes: [], pastVitals: []
  };
  patients.push(newP);
  karteData[newP.id] = { chiefComplaint:'', chiefComplaintSelect:'', findingsHtml:'', vitals:{t:'',bps:'',bpd:'',spo2:'',pulse:''}, selectedDiseases:[], prescriptions:[], rxDays:7, isFirstVisit:true, selectedExams:[], addedBillingItems:[] };
  postToApi('savePatient', { '患者ID': newP.id, '���名': newP.name, 'フリガナ': newP.nameKana, '生年月日': newP.dob, '年��': newP.age, '性別': newP.sex, '住所': newP.address, '電話番号': newP.phone, 'アレルギー': '', '既往歴': '', 'メモ': '' });
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
  document.getElementById('examStartBtn').textContent = '診���開始';
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
  recalcBilling();
  renderWaitingList();
  updateSurchargeBadge();
  updatePrevButton();
  renderBillingMenu();
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
function switchPatientTab(tab) {
  currentPatientTab = tab;
  document.querySelectorAll('.patient-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const p = patients.find(x => x.id === currentPatientId);
  if (p) renderPatientInfoTab(p);
}

function renderPatientInfoTab(p) {
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
        if (p.iryoPhoto) h += '<div style="margin-top:4px;"><img src="' + p.iryoPhoto + '" style="max-height:80px;border-radius:4px;border:1px solid var(--border);"></div>';
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
      h += '<div class="info-section"><div class="info-section-title">傷病名一覧</div>';
      if (p.history && p.history.length > 0) {
        p.history.forEach(d => {
          const info = diseases.find(x => x.name === d);
          h += '<div style="padding:3px 0;font-size:11px;border-bottom:1px solid var(--bg);">' + esc(d) + (info ? ' <span style="font-size:9px;color:var(--text-muted);">' + esc(info.code) + '</span>' : '') + '</div>';
        });
      } else h += '<span style="font-size:11px;color:var(--text-muted);">なし</span>';
      const k = karteData[currentPatientId];
      if (k && k.selectedDiseases.length > 0) {
        h += '<div class="info-section-title" style="margin-top:6px;">今回の傷病名</div>';
        k.selectedDiseases.forEach(d => { h += '<div style="padding:3px 0;font-size:11px;">' + esc(d.name) + ' [' + (d.status==='suspected'?'疑い':'確定') + ']</div>'; });
      }
      h += '</div>';
      break;

    case 'exam':
      h += '<div class="info-section"><div class="info-section-title">検査結果</div>';
      h += '<span style="font-size:11px;color:var(--text-muted);">検査結果はGAS/Supabase連携後に表示されま���</span>';
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

// ===== Chief Complaint =====
function onChiefComplaintSelect(val) {
  if (val) { const inp = document.getElementById('chiefComplaint'); inp.value = inp.value ? inp.value + '、' + val : val; }
}

// ===== Disease =====
function renderDiseaseQuickBtns() {
  const p = patients.find(x => x.id === currentPatientId);
  let btns = '';
  if (p && p.history && p.history.length > 0) btns += '<button class="disease-quick-btn" style="background:var(--success-light);border-color:var(--success);color:var(--success);" onclick="copyPrevDiseases()">&#8635; 前回傷病引継</button>';
  btns += quickDiseases.map(d => '<button class="disease-quick-btn" onclick="addDisease(\'' + esc(d) + '\')">' + esc(d) + '</button>').join('');
  document.getElementById('diseaseQuickBtns').innerHTML = btns;
}
function copyPrevDiseases() { const p = patients.find(x => x.id === currentPatientId); if (!p || !p.history) return; p.history.forEach(h => addDisease(h)); showToast('前回傷病名を引き継ぎました'); }
function searchDisease(q) {
  const r = document.getElementById('diseaseResults');
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
    k.selectedDiseases.push({name, code: code || '', status:'confirmed'});
  }
  document.getElementById('diseaseSearch').value = '';
  document.getElementById('diseaseResults').classList.remove('show');
  renderSelectedDiseases();
}
function removeDisease(i) { karteData[currentPatientId].selectedDiseases.splice(i,1); renderSelectedDiseases(); }
function toggleDiseaseStatus(i) { const d = karteData[currentPatientId].selectedDiseases[i]; d.status = d.status === 'confirmed' ? 'suspected' : 'confirmed'; renderSelectedDiseases(); }
function renderSelectedDiseases() {
  const k = karteData[currentPatientId];
  document.getElementById('selectedDiseases').innerHTML = k.selectedDiseases.map((d,i) => {
    const cls = d.status === 'suspected' ? 'disease-tag suspected' : 'disease-tag';
    const lbl = d.status === 'suspected' ? '疑' : '確';
    return '<span class="' + cls + '"><span class="status-toggle" onclick="toggleDiseaseStatus(' + i + ')">[' + lbl + ']</span> ' + esc(d.name) + (d.code ? ' <span style="font-size:9px;opacity:0.7;">' + esc(d.code) + '</span>' : '') + ' <span class="remove" onclick="removeDisease(' + i + ')">&times;</span></span>';
  }).join('');
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
function applySetOrder(i) { const s = setOrders[i]; const k = karteData[currentPatientId]; k.prescriptions = []; s.items.forEach(item => { const d = drugs.find(x => x.id === item.drugId); if (d) { const savedNote = getDrugSavedNote(item.drugId); k.prescriptions.push({drug:d,qty:item.qty,days:s.days,note:savedNote||''}); } }); k.rxDays = s.days; document.getElementById('rxDays').value = s.days; renderRxList(); recalcBilling(); showToast(s.name + 'を適用'); }
function doRx() { const p = patients.find(x => x.id === currentPatientId); const k = karteData[currentPatientId]; k.prescriptions = []; p.prevRx.forEach(rx => { const d = drugs.find(x => x.id === rx.drugId); if (d) { const savedNote = getDrugSavedNote(rx.drugId); k.prescriptions.push({drug:d,qty:rx.qty,days:p.prevDays,note:savedNote||''}); } }); k.rxDays = p.prevDays; document.getElementById('rxDays').value = p.prevDays; renderRxList(); recalcBilling(); showToast('Do処方を適用'); }
function deleteSetOrder(i) { if (!confirm(setOrders[i].name + ' を削除しますか？')) return; setOrders.splice(i,1); saveSetOrders(); renderSetOrders(); showToast('セットを削除'); }
function saveCurrentAsSet() {
  const k = karteData[currentPatientId]; if (!k || !k.prescriptions.length) { showToast('処方がありません'); return; }
  const name = prompt('セット名を入力:', '新規セット');
  if (!name) return;
  const items = k.prescriptions.map(rx => ({drugId:rx.drug.id,qty:rx.qty}));
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
        (!s.builtin ? '<button class="set-manager-del" onclick="deleteSetOrderFromManager(' + i + ')">削除</button>' : '') +
        '</div></div>';
    }).join('') +
    '</div>' +
    '<div class="modal-actions"><button class="set-manager-close" onclick="document.getElementById(\'setManagerOverlay\').classList.remove(\'show\')">閉じる</button></div>';
}
function deleteSetOrderFromManager(i) {
  if (!confirm(setOrders[i].name + ' を削除しますか？')) return;
  setOrders.splice(i,1); saveSetOrders(); renderSetOrders(); _renderSetManager(); showToast('セットを削除');
}
function searchDrug(q) { const r = document.getElementById('drugResults'); if (!q) { r.classList.remove('show'); return; } const f = drugs.filter(d => d.name.includes(q) || d.category.includes(q)); if (!f.length) { r.classList.remove('show'); return; } r.innerHTML = f.map(d => '<div class="drug-result-item" onclick="addDrug(\'' + esc(d.id) + '\')"><span>' + esc(d.name) + stockBadge(d.name) + '</span><span class="price">' + (d.price ? d.price.toFixed(1) + '円' : '') + '</span></div>').join(''); r.classList.add('show'); }
function addDrug(id) { const d = drugs.find(x => x.id === id); if (!d) return; const k = karteData[currentPatientId]; const ex = k.prescriptions.find(rx => rx.drug.id === id); if (ex) ex.qty += 1; else { const savedNote = getDrugSavedNote(id); k.prescriptions.push({drug:d,qty:1,days:k.rxDays||7,note:savedNote||''}); } document.getElementById('drugSearch').value = ''; document.getElementById('drugResults').classList.remove('show'); renderRxList(); recalcBilling(); }
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
  document.getElementById('examCheckList').innerHTML = examItems.map(ex => {
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
  if (cat === 'mylist' && currentBillingTab === 'mylist') {
    // already on mylist — cycle to next list
    currentMyListIdx = (currentMyListIdx + 1) % billingMyLists.length;
    renderMyListTab();
    renderBillingMenu();
    return;
  }
  currentBillingTab = cat;
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
    var header = '<div class="bm-mylist-header">' +
      '<span class="bm-mylist-name" onclick="renameBillingMyList()" title="クリックで名前変更">' + esc(ml.name) + '</span>' +
      '<span class="bm-mylist-nav">' +
      (billingMyLists.length > 1 ? '<span class="bm-mylist-nav-btn" onclick="cycleMyList(-1)" title="前のリスト">&#9664;</span>' : '') +
      '<span style="font-size:10px;color:var(--text-muted);">' + (currentMyListIdx+1) + '/' + billingMyLists.length + '</span>' +
      (billingMyLists.length > 1 ? '<span class="bm-mylist-nav-btn" onclick="cycleMyList(1)" title="次のリスト">&#9654;</span>' : '') +
      '</span>' +
      '<span class="bm-mylist-actions">' +
      '<span class="bm-mylist-action-btn bm-mylist-action-add-all" onclick="addAllMyListItems()" title="全て追加">&#9660; 全追加</span>' +
      '<span class="bm-mylist-action-btn" onclick="addNewBillingMyList()" title="新規リスト">+</span>' +
      (billingMyLists.length > 1 ? '<span class="bm-mylist-action-btn bm-mylist-action-del" onclick="deleteBillingMyList()" title="このリストを削除">&#128465;</span>' : '') +
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
function filterBillingMenu(q) { renderBillingMenu(); }
function addBillingItem(name, points) {
  var k = karteData[currentPatientId];
  if (!k.addedBillingItems.find(function(x) { return x.name === name; })) {
    k.addedBillingItems.push({name:name, points:points});
    recalcBilling();
    showToast(name + ' を追加');
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
function addNewBillingMyList() {
  var name = prompt('新しいリスト名:', 'マイリスト' + (billingMyLists.length + 1));
  if (!name) return;
  billingMyLists.push({name:name, items:[]});
  currentMyListIdx = billingMyLists.length - 1;
  saveBillingMyLists(); renderMyListTab(); renderBillingMenu();
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
function recalcBilling() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
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
      shohouTen = numDrugs >= 7 ? 40 : 68;
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
  const totalTen = shoshinTen + gairaiTen + surchargeTen + shohouTen + chouzaiTen + yakuzaiTen + examTen + extraTen;
  const burden = Math.round(totalTen * 10 * p.ratio);
  document.getElementById('billShoshin').textContent = (k.isFirstVisit ? '初診料 ' : '再診料 ') + shoshinTen + '点';
  document.getElementById('billGairai').textContent = gairaiTen > 0 ? gairaiTen + '点' : '---';
  const shohouLabel = isExternal ? '処方箋料' : '処方料';
  document.getElementById('billShohou').textContent = shohouTen > 0 ? shohouLabel + ' ' + shohouTen + '点' + (numDrugs >= 7 ? ' (逓減)' : '') : '---';
  document.getElementById('billChouzai').textContent = chouzaiTen > 0 ? chouzaiTen + '点' : (isExternal && numDrugs > 0 ? '(院外)' : '---');
  document.getElementById('billYakuzai').textContent = yakuzaiTen > 0 ? yakuzaiTen + '点' : (isExternal && numDrugs > 0 ? '(院外)' : '---');
  document.getElementById('billTotal').textContent = totalTen + '点';
  document.getElementById('billBurden').textContent = burden.toLocaleString() + '円';
  renderAddedBillingList();
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
  if (s) { badge.textContent = s.type + '加算 +' + s.points + '���'; badge.classList.add('show'); } else { badge.classList.remove('show'); }
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

function saveKarteDraft() {
  saveCurrentKarte();
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const surchargeInfo = getTimeSurcharge(examStartTime);
  const timeSlotLabel = surchargeInfo ? surchargeInfo.type : '通常';
  const plainText = getEditorPlainText();
  postToApi('saveKarte', { 'カルテID': karteId, '患者ID': currentPatientId, '受診日': selectedDate, '診察開始時刻': examStartTime ? examStartTime.toLocaleTimeString('ja-JP') : '', '主訴': k.chiefComplaint, '所見': plainText, '体温': k.vitals.t, '収縮期血圧': k.vitals.bps, '拡張期血圧': k.vitals.bpd, 'SpO2': k.vitals.spo2, '脈拍': k.vitals.pulse, '初診フラグ': k.isFirstVisit ? 'TRUE' : 'FALSE', '時間区分': timeSlotLabel, 'ステータス': '一時保存' });
  if (k.prescriptions.length > 0) k.prescriptions.forEach(rx => { postToApi('savePrescription', { 'カルテID': karteId, '患者ID': currentPatientId, '薬品名': rx.drug.name, '薬品コード': rx.drug.id, '用量': rx.qty, '単位': rx.drug.unit||'錠', '日数': rx.days||k.rxDays, '薬価': rx.drug.price||0, '備考': rx.note||'' }); });
  if (k.selectedDiseases.length > 0) k.selectedDiseases.forEach(d => { postToApi('saveDiagnosis', { 'カルテID': karteId, '患者ID': currentPatientId, '傷病名': d.name, 'ICD10コード': d.code||'', '確定区分': d.status === 'suspected' ? '疑い' : '確定' }); });
  if (k.selectedExams.length > 0) k.selectedExams.forEach(exId => { const exInfo = examItems.find(e => e.id === exId); if (exInfo) postToApi('saveExam', { 'カルテID': karteId, '患者ID': currentPatientId, '検査名': exInfo.name, '検査コード': exId }); });
  // Supabase二重書き込み（スプシと並行）
  saveToSupabase(p, k, drugs).then(r => { if (r.success) console.log('[Supabase] 一時保存OK'); });
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
  const confirmMsg = '【確定確認】\n患者: ' + p.name + '（' + p.insurance + '）\n主訴: ' + (k.chiefComplaint || '未入力') + '\n傷病名: ' + (diseaseSummary || 'なし') + '\n処方:\n  ' + (rxSummary || '��し') + '\n合計: ' + totalEl.textContent + '\n患者��担: ' + burdenEl.textContent + '\n\nこの内容で確定しますか？';
  if (!confirm(confirmMsg)) return;
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const surchargeInfo = getTimeSurcharge(examStartTime);
  const timeSlotLabel = surchargeInfo ? surchargeInfo.type : '通常';
  const plainText = getEditorPlainText();
  postToApi('saveKarte', { 'カルテID': karteId, '患者ID': currentPatientId, '受診日': selectedDate, '診察開始時刻': examStartTime ? examStartTime.toLocaleTimeString('ja-JP') : '', '���察終了時刻': new Date().toLocaleTimeString('ja-JP'), '主訴': k.chiefComplaint, '所見': plainText, '体温': k.vitals.t, '収���期血圧': k.vitals.bps, '拡張期血圧': k.vitals.bpd, 'SpO2': k.vitals.spo2, '脈拍': k.vitals.pulse, '初診フラグ': k.isFirstVisit ? 'TRUE' : 'FALSE', '時間区分': timeSlotLabel, 'ステータス': '確定' });
  if (k.prescriptions.length > 0) k.prescriptions.forEach(rx => { postToApi('savePrescription', { 'カルテID': karteId, '患者ID': currentPatientId, '薬品名': rx.drug.name, '薬品コード': rx.drug.id, '用量': rx.qty, '単位': rx.drug.unit||'錠', '日数': rx.days||k.rxDays, '薬価': rx.drug.price||0, '備考': rx.note||'' }); });
  if (k.selectedDiseases.length > 0) k.selectedDiseases.forEach(d => { postToApi('saveDiagnosis', { 'カルテID': karteId, '患���ID': currentPatientId, '傷病名': d.name, 'ICD10コード': d.code||'', '確定��分': d.status === 'suspected' ? '疑い' : '確定' }); });
  if (k.selectedExams.length > 0) k.selectedExams.forEach(exId => { const exInfo = examItems.find(e => e.id === exId); if (exInfo) postToApi('saveExam', { 'カルテID': karteId, '患者ID': currentPatientId, '検査名': exInfo.name, '検査コード': exId }); });
  const totalPoints = parseInt(totalEl.textContent) || 0;
  const burdenAmount = parseInt(burdenEl.textContent.replace(/[^0-9]/g, '')) || 0;
  const billingItemsList = [];
  const cfVisitFee = getVisitFee(k.isFirstVisit, selectedDate); billingItemsList.push(cfVisitFee.name + ' ' + cfVisitFee.points + '点');
  if (!k.isFirstVisit) billingItemsList.push('外来管理加算 52点');
  if (surchargeInfo) billingItemsList.push(surchargeInfo.type + '加算 ' + surchargeInfo.points + '点');
  if (k.prescriptions.length > 0) billingItemsList.push('処方料・調剤料・薬剤料');
  postToApi('saveBilling', { 'カルテID': karteId, '患者ID': currentPatientId, '項目名': billingItemsList.join(', '), '合計点数': totalPoints, '負担額': burdenAmount, '負担割合': p.ratio });
  // Supabase二重書き込み（確定版）
  saveToSupabase(p, k, drugs).then(r => {
    if (r.success) console.log('[Supabase] 確定保存OK visitId=' + r.visitId);
    else console.warn('[Supabase] 確定保存失敗:', r.error);
  });
  p.status = 'done';
  examStartTime = null;
  document.getElementById('examStartBtn').textContent = '診察開���';
  document.getElementById('examStartBtn').classList.remove('active');
  renderWaitingList();
  showToast(p.name + 'さんの診察を確定しました');
}

function postToApi(action, data) { try { fetch(API_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:JSON.stringify({action, data}) }); } catch(e) { console.warn('API error:', e); } }
function printBilling() { showToast('印刷プレビュー（モック）'); }

// ===== Modals =====
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function openEditPatientModal() {
  const p = patients.find(x => x.id === currentPatientId);
  document.getElementById('editName').value = p.name;
  document.getElementById('editNameKana').value = p.nameKana || '';
  document.getElementById('editDob').value = p.dob || '';
  document.getElementById('editSex').value = p.sex;
  document.getElementById('editAddress').value = p.address || '';
  document.getElementById('editPhone').value = p.phone || '';
  document.getElementById('editAllergies').value = p.allergies.join(', ');
  document.getElementById('editInsurance').value = p.insurance;
  document.getElementById('editPatientModal').classList.add('show');
}
function savePatientEdit() {
  const p = patients.find(x => x.id === currentPatientId);
  p.name = document.getElementById('editName').value;
  p.nameKana = document.getElementById('editNameKana').value;
  p.dob = document.getElementById('editDob').value;
  p.sex = document.getElementById('editSex').value;
  p.address = document.getElementById('editAddress').value;
  p.phone = document.getElementById('editPhone').value;
  const ins = document.getElementById('editInsurance').value;
  p.insurance = ins;
  p.ratio = ins.includes('1割') ? 0.1 : ins.includes('2割') ? 0.2 : ins === '公費' ? 0 : 0.3;
  const a = document.getElementById('editAllergies').value;
  p.allergies = a ? a.split(/[,、]/).map(s => s.trim()).filter(Boolean) : [];
  if (p.dob) { const t = new Date(), b = new Date(p.dob); let age = t.getFullYear()-b.getFullYear(); if (t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) age--; p.age = age; }
  postToApi('savePatient', { '患者ID': p.id, '氏名': p.name, 'フリガナ': p.nameKana, '生年月日': p.dob, '年齢': p.age, '性別': p.sex, '住所': p.address, '電話番号': p.phone, 'アレルギー': p.allergies.join(','), 'メモ': p.memo || '' });
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
  document.getElementById('recipientNumber').value = p.recipientNumber || '';
  document.getElementById('recipientEdaban').value = p.recipientEdaban || '';
  document.getElementById('insurerNumberInput').value = p.insurerNumber || '';
  document.getElementById('kouhiNumberInput').value = p.kouhiNumber || '';
  document.getElementById('kouhiEdaban').value = p.kouhiEdaban || '';
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
  document.getElementById('iryoRecipientNumber').value = p.iryoRecipientNumber || '';
  document.getElementById('iryoRecipientEdaban').value = p.iryoRecipientEdaban || '';
  document.getElementById('iryoValidFrom').value = p.iryoValidFrom || '';
  document.getElementById('iryoValidTo').value = p.iryoValidTo || '';
  document.getElementById('iryoMemo').value = p.iryoMemo || '';
  document.getElementById('insurancePhotoModal').classList.add('show');
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
  const kouhiNum = document.getElementById('kouhiNumberInput').value || undefined;
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
}

function saveInsuranceInfo() {
  const p = patients.find(x => x.id === currentPatientId);
  p.insSymbol = document.getElementById('insSymbol').value;
  p.insNumber = document.getElementById('insNumber').value;
  p.insEdaban = document.getElementById('insEdaban').value;
  // 後方互換: insuranceNumberも生成
  p.insuranceNumber = buildInsuranceNumberStr({ symbol: p.insSymbol, memberNumber: p.insNumber, edaban: p.insEdaban });
  p.recipientNumber = document.getElementById('recipientNumber').value;
  p.recipientEdaban = document.getElementById('recipientEdaban').value;
  p.insurerNumber = document.getElementById('insurerNumberInput').value;
  p.kouhiNumber = document.getElementById('kouhiNumberInput').value;
  p.kouhiEdaban = document.getElementById('kouhiEdaban').value;
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
  p.iryoRecipientEdaban = document.getElementById('iryoRecipientEdaban').value;
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
    html = '<div class="form-group"><label class="form-label">紹介先医療機関</label><input type="text" class="form-input" placeholder="○○病院"></div><div class="form-group"><label class="form-label">紹介先診療科</label><input type="text" class="form-input" placeholder="内科"></div><div class="form-group"><label class="form-label">傷���名</label><input type="text" class="form-input" value="' + esc(k.selectedDiseases.map(d=>d.name).join(', ')) + '"></div><div class="form-group"><label class="form-label">紹介目的・経過</label><textarea class="form-textarea" rows="5">上記患者様を紹介申し上げます。\nご高診のほどよろしくお願い申し上げます。</textarea></div>';
  } else if (type === 'diagnosis') {
    title = '診断書';
    html = '<div class="form-group"><label class="form-label">患者氏名</label><input type="text" class="form-input" value="' + esc(p.name) + '" readonly></div><div class="form-group"><label class="form-label">傷病名</label><input type="text" class="form-input" value="' + esc(k.selectedDiseases.map(d=>d.name).join(', ')) + '"></div><div class="form-group"><label class="form-label">所��</label><textarea class="form-textarea" rows="4" placeholder="所見・経過を記載"></textarea></div>';
  } else if (type === 'prescription') {
    title = '院外処方箋';
    html = '<div class="form-group"><label class="form-label">��者 / 保険</label><input type="text" class="form-input" value="' + esc(p.name) + ' / ' + esc(p.insurance) + '" readonly></div><div class="form-group"><label class="form-label">処方内容</label><div style="background:var(--bg);padding:8px;border-radius:var(--radius-sm);font-size:12px;">';
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
  closeModal('docModal'); showToast(docType + 'を保存しま���た');
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
  const y = d.getFullYear(), m = d.getMonth()+1, day = d.getDate();
  if (y >= 2019) return '令和' + (y===2019?'元':(y-2018)) + '年' + m + '月' + day + '日';
  if (y >= 1989) return '平成' + (y===1989?'元':(y-1988)) + '年' + m + '月' + day + '日';
  if (y >= 1926) return '昭和' + (y===1926?'元':(y-1925)) + '年' + m + '月' + day + '日';
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
  if (!k || !k.addedBillingItems || !k.addedBillingItems.length) { if (container) container.style.display = 'none'; return; }
  container.style.display = '';
  itemsEl.innerHTML = k.addedBillingItems.map((it,i) =>
    '<div class="added-billing-item"><span>' + esc(it.name) + '</span><span class="added-billing-pts">' + it.points + '点</span><span class="added-billing-del" onclick="removeAddedBilling(' + i + ')">&times;</span></div>'
  ).join('');
}
function removeAddedBilling(i) {
  const k = karteData[currentPatientId];
  const name = k.addedBillingItems[i].name;
  k.addedBillingItems.splice(i,1);
  recalcBilling();
  showToast(name + ' を削除');
}

// ===== v0.8: 機能10 既存患者保険証モーダルOCR/QR =====
let insuranceOcrStream = null;
function startInsuranceOcrCamera() {
  const wrap = document.getElementById('insuranceOcrCameraWrap');
  const video = document.getElementById('insuranceOcrVideo');
  wrap.style.display = '';
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(stream) {
    insuranceOcrStream = stream;
    video.srcObject = stream;
  }).catch(function(e) { showToast('カメラ起動失敗: ' + e.message); wrap.style.display = 'none'; });
}
function stopInsuranceOcrCamera() {
  if (insuranceOcrStream) { insuranceOcrStream.getTracks().forEach(t => t.stop()); insuranceOcrStream = null; }
  document.getElementById('insuranceOcrCameraWrap').style.display = 'none';
}
function captureInsuranceOcrPhoto() {
  const video = document.getElementById('insuranceOcrVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopInsuranceOcrCamera();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  processInsuranceOcrImage(dataUrl);
}
function onInsuranceOcrFileSelected(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) { processInsuranceOcrImage(e.target.result); };
  reader.readAsDataURL(file);
  input.value = '';
}
function processInsuranceOcrImage(dataUrl) {
  document.getElementById('insuranceOcrPreviewWrap').style.display = '';
  document.getElementById('insuranceOcrPreviewImg').src = dataUrl;
  document.getElementById('insuranceOcrProgressArea').style.display = '';
  document.getElementById('insuranceOcrResultArea').style.display = 'none';
  document.getElementById('insuranceOcrApplyBtn').style.display = 'none';
  document.getElementById('insuranceOcrApplyQrOnlyBtn').style.display = 'none';

  // ===== ハイブリッド方式: QRコード優先 → OCR補完（新規登録と同じ方式） =====
  document.getElementById('insuranceOcrProgressText').textContent = 'QRコード検出中...';
  document.getElementById('insuranceOcrProgressFill').style.width = '10%';

  const qrPromise = (typeof QR_DECODER !== 'undefined')
    ? QR_DECODER.decodeFromDataUrl(dataUrl)
    : Promise.resolve(null);

  qrPromise.then(function(qrResult) {
    document.getElementById('insuranceOcrProgressText').textContent = 'OCR実行中...';
    document.getElementById('insuranceOcrProgressFill').style.width = '20%';

    // OCR_ENGINE（ocr_engine.js）がある場合はそちらを使用
    if (typeof OCR_ENGINE !== 'undefined' && OCR_ENGINE.recognize) {
      return OCR_ENGINE.recognize(dataUrl, function(status, pct) {
        document.getElementById('insuranceOcrProgressText').textContent = status;
        document.getElementById('insuranceOcrProgressFill').style.width = (20 + pct * 80) + '%';
      }).then(function(data) { return { qrResult: qrResult, ocrData: data }; });
    } else {
      // fallback: Tesseract直接
      return Tesseract.recognize(dataUrl, 'jpn', {
        logger: function(m) { if (m.progress) { document.getElementById('insuranceOcrProgressFill').style.width = (20 + m.progress * 80) + '%'; document.getElementById('insuranceOcrProgressText').textContent = Math.round(m.progress*100) + '%'; } }
      }).then(function(r) { return { qrResult: qrResult, ocrData: { text: r.data.text } }; });
    }
  }).then(function(result) {
    var qrResult = result.qrResult;
    var ocrData = result.ocrData;
    document.getElementById('insuranceOcrProgressArea').style.display = 'none';

    // OCRフィールド抽出
    var ocrFields = {};
    if (typeof OCR_ENGINE !== 'undefined' && OCR_ENGINE.extractInsuranceFields) {
      ocrFields = ocrData._mergedFields || OCR_ENGINE.extractInsuranceFields(ocrData.text);
      if (typeof validateOcrFields === 'function') validateOcrFields(ocrFields);
    } else {
      ocrFields = { rawText: ocrData.text };
    }

    // QRデータをOCR結果にマージ（QR優先）
    if (typeof mergeQrAndOcr === 'function') {
      ocrFields = mergeQrAndOcr(qrResult, ocrFields);
    } else if (qrResult && qrResult.insurerNumber) {
      ocrFields.insurerNumber = qrResult.insurerNumber;
      if (qrResult.symbol) ocrFields.symbol = qrResult.symbol;
      if (qrResult.memberNumber) ocrFields.memberNumber = qrResult.memberNumber;
      ocrFields._qrResult = qrResult;
    }

    window._insuranceOcrResult = ocrFields;

    // 結果表示
    var area = document.getElementById('insuranceOcrResultArea');
    area.style.display = '';
    area.innerHTML = renderInsuranceOcrResultHTML(ocrFields);
    document.getElementById('insuranceOcrApplyBtn').style.display = '';
    // QRのみ反映ボタンはQR検出成功時のみ表示
    var hasQR = ocrFields._qrResult && ocrFields._qrResult.format !== 'unknown';
    document.getElementById('insuranceOcrApplyQrOnlyBtn').style.display = hasQR ? '' : 'none';
  }).catch(function(e) {
    document.getElementById('insuranceOcrProgressArea').style.display = 'none';
    document.getElementById('insuranceOcrResultArea').style.display = '';
    document.getElementById('insuranceOcrResultArea').textContent = '読取エラー: ' + (e.message || '');
  });

  // 写真としても保存
  var p = patients.find(function(x) { return x.id === currentPatientId; });
  if (p) { p.insurancePhoto = dataUrl; document.getElementById('insurancePhotoPreview').src = dataUrl; document.getElementById('insurancePhotoPreview').style.display = 'block'; document.getElementById('insuranceUploadText2').style.display = 'none'; document.getElementById('insurancePhotoDeleteBtn').style.display = ''; }
}

function renderInsuranceOcrResultHTML(f) {
  var hasQR = f._qrResult && f._qrResult.format !== 'unknown';
  var h = '';
  if (hasQR) {
    h += '<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#155724;font-weight:700;">&#10004; QRコード読取成功</div>';
  }
  if (f._validationWarnings && f._validationWarnings.length > 0) {
    h += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:10px;color:#856404;">&#9888; ' + f._validationWarnings.join('<br>&#9888; ') + '</div>';
  }
  var rows = [
    { l:'保険者番号', v:f.insurerNumber, qr:f._insurerFromQR },
    { l:'記号', v:f.symbol, qr:f._symbolFromQR },
    { l:'番号', v:f.memberNumber, qr:f._memberFromQR },
    { l:'枝番', v:f.edaban, qr:f._edabanFromQR },
    { l:'フリガナ', v:f.nameKana },
    { l:'氏名', v:f.name },
    { l:'生年月日', v:f.dob },
    { l:'住所', v:f.address }
  ];
  rows.forEach(function(r) {
    if (!r.v) return;
    var icon = r.qr ? ' <span style="color:#28a745;font-size:10px;">&#10004;QR</span>' : ' <span style="color:#f59e0b;font-size:10px;">&#9888;要確認</span>';
    h += '<div style="font-size:11px;display:flex;gap:4px;margin-bottom:2px;"><span style="color:var(--text-muted);min-width:70px;">' + r.l + '</span><b>' + r.v + '</b>' + icon + '</div>';
  });
  if (f.rawText && !f.insurerNumber && !f.nameKana) {
    h += '<div style="font-size:10px;white-space:pre-wrap;max-height:80px;overflow-y:auto;color:var(--text-muted);margin-top:4px;border-top:1px solid var(--border);padding-top:4px;">' + f.rawText + '</div>';
  }
  if (!hasQR) {
    h += '<div style="font-size:10px;color:#856404;margin-top:4px;">&#9888; QRコード未検出。OCR参考値のため必ず目視確認してください。</div>';
  }
  return h;
}

function applyInsuranceOcrResults(qrOnly) {
  var f = window._insuranceOcrResult;
  if (!f) return;
  if (qrOnly) {
    // QR由来フィールドのみ反映（確実なデータだけ）
    if (f._insurerFromQR && f.insurerNumber) { document.getElementById('insurerNumberInput').value = f.insurerNumber; onInsurerNumberInput(f.insurerNumber); }
    if (f._symbolFromQR && f.symbol) document.getElementById('insSymbol').value = f.symbol;
    if (f._memberFromQR && f.memberNumber) document.getElementById('insNumber').value = f.memberNumber;
    if (f._edabanFromQR && f.edaban) document.getElementById('insEdaban').value = f.edaban;
    showToast('QR読取データのみ反映しました');
  } else {
    // 全項目反映（QR+OCR）
    if (f.insurerNumber) { document.getElementById('insurerNumberInput').value = f.insurerNumber; onInsurerNumberInput(f.insurerNumber); }
    if (f.symbol) document.getElementById('insSymbol').value = f.symbol;
    if (f.memberNumber) document.getElementById('insNumber').value = f.memberNumber;
    if (f.edaban) document.getElementById('insEdaban').value = f.edaban;
    showToast('読取結果を反映しました（内容をご確認ください）');
  }
}
function clearInsuranceOcrPreview() {
  document.getElementById('insuranceOcrPreviewWrap').style.display = 'none';
  window._insuranceOcrResult = null;
}

// ===== v0.11: 医療証種別→法別番号自動入力 =====
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
initSupabase().then(ok => { if (ok) console.log('[v0.8] Supabase二重書き込みモード有効'); });
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
