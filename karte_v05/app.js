// ===== Config =====
const API_URL = 'https://script.google.com/macros/s/AKfycbwFzGLG20GaSLxfdRDAg1ATqQu_s5MWYF045Rlc3OH01duvrL2rqlP9VSQxCEodiePX/exec';
// DB連携は db_integration.js に分離済み
// マスタDB は master_db.js に分離済み

// ===== Master Modal =====
let masterSearchTimer = null;

async function openMasterModal() {
  document.getElementById('masterModal').style.display = 'flex';
  await refreshMasterStatus();
}
function closeMasterModal() {
  document.getElementById('masterModal').style.display = 'none';
}

async function refreshMasterStatus() {
  try {
    const status = await MasterDB.getStatus();
    const labels = { drugs: 'Drugs', diseases: 'Diseases', medical: 'Medical' };
    const names = { drugs: '医薬品', diseases: '傷病名', medical: '診療行為' };
    for (const [key, info] of Object.entries(status)) {
      const countEl = document.getElementById('masterCount' + labels[key]);
      const dateEl = document.getElementById('masterDate' + labels[key]);
      const cardEl = document.getElementById('masterCard' + labels[key]);
      if (!countEl) continue;
      if (info.count > 0) {
        countEl.textContent = info.count.toLocaleString() + ' 件';
        dateEl.textContent = info.meta ? '取込: ' + new Date(info.meta.date).toLocaleString('ja-JP') : '';
        cardEl.classList.add('imported');
      } else {
        countEl.textContent = '0 件';
        dateEl.textContent = '未取込';
        cardEl.classList.remove('imported');
      }
    }
    // ヘッダーのマスタボタンにもステータス反映
    const btn = document.getElementById('masterStatusBtn');
    const total = (status.drugs?.count || 0) + (status.diseases?.count || 0) + (status.medical?.count || 0);
    if (total > 0) {
      btn.style.borderColor = 'rgba(46,125,50,0.6)';
      btn.textContent = '\u2699 マスタ ' + total.toLocaleString();
    }
  } catch (e) { console.error('Master status error:', e); }
}

async function autoImportMasters() {
  const prog = document.getElementById('masterProgress');
  const btn = document.getElementById('autoImportBtn');
  prog.style.display = 'block';
  btn.disabled = true;
  btn.textContent = '取込中...';
  try {
    const results = await MasterDB.autoImportFromFolder((msg) => {
      prog.textContent = msg;
    });
    let summary = [];
    if (results.drugs?.count) summary.push('医薬品 ' + results.drugs.count + '件');
    if (results.drugs?.error) summary.push('医薬品: ' + results.drugs.error);
    if (results.diseases?.count) summary.push('傷病名 ' + results.diseases.count + '件');
    if (results.diseases?.error) summary.push('傷病名: ' + results.diseases.error);
    if (results.medical?.count) summary.push('診療行為 ' + results.medical.count + '件');
    if (results.medical?.error) summary.push('診療行為: ' + results.medical.error);
    prog.textContent = '取込完了: ' + summary.join(' / ');
    prog.style.borderLeftColor = '#2e7d32';
    prog.style.background = '#e8f5e9';
    await refreshMasterStatus();
  } catch (e) {
    prog.textContent = 'エラー: ' + e.message;
    prog.style.borderLeftColor = '#c62828';
    prog.style.background = '#ffebee';
  }
  btn.disabled = false;
  btn.textContent = 'master/フォルダから自動取込';
}

async function importMasterFile(input, type) {
  const file = input.files[0];
  if (!file) return;
  const prog = document.getElementById('masterProgress');
  prog.style.display = 'block';
  prog.textContent = file.name + ' を取込中...';
  try {
    // Shift-JIS→UTF-8変換が必要な場合の対応
    const buf = await file.arrayBuffer();
    let text;
    try {
      const td = new TextDecoder('shift_jis');
      text = td.decode(buf);
      // UTF-8かどうか判定: 最初の行にマスタ種別があるか
      if (!text.includes('"Y"') && !text.includes('"B"') && !text.includes('"S"')) {
        text = new TextDecoder('utf-8').decode(buf);
      }
    } catch (e) {
      text = new TextDecoder('utf-8').decode(buf);
    }
    // Blobに変換してimportFile互換に
    const blob = new Blob([text], { type: 'text/csv' });
    const f2 = new File([blob], file.name);
    const count = await MasterDB.importFile(f2, type, (w, t) => {
      prog.textContent = file.name + ': ' + w + '/' + t;
    });
    prog.textContent = '取込完了: ' + count + '件';
    prog.style.borderLeftColor = '#2e7d32';
    prog.style.background = '#e8f5e9';
    await refreshMasterStatus();
  } catch (e) {
    prog.textContent = 'エラー: ' + e.message;
    prog.style.borderLeftColor = '#c62828';
    prog.style.background = '#ffebee';
  }
  input.value = '';
}

function doMasterSearch() {
  clearTimeout(masterSearchTimer);
  masterSearchTimer = setTimeout(async () => {
    const type = document.getElementById('masterSearchType').value;
    const query = document.getElementById('masterSearchQuery').value.trim();
    const results = document.getElementById('masterSearchResults');
    const countEl = document.getElementById('masterSearchCount');
    if (!query) { results.innerHTML = ''; countEl.textContent = ''; return; }
    try {
      const items = await MasterDB.search(type, query, 50);
      countEl.textContent = items.length + '件';
      if (type === 'drugs') {
        results.innerHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">薬品名</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">レセ電算</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">YJコード</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">薬価</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">区分</th></tr></thead><tbody>' +
          items.map(d => '<tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">' + d.name + (d.isGeneric ? ' <span style="color:#1565c0;font-size:9px;">後発</span>' : '') + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + d.code + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + d.yjCode + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;text-align:right;">' + d.price.toFixed(2) + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:10px;">' + d.dosageForm + '</td></tr>').join('') +
          '</tbody></table>';
      } else if (type === 'diseases') {
        results.innerHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">傷病名</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">コード</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">ICD-10</th></tr></thead><tbody>' +
          items.map(d => '<tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">' + d.name + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + d.code + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + (d.icd || '-') + '</td></tr>').join('') +
          '</tbody></table>';
      } else {
        results.innerHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">診療行為名</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">コード</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">点数</th><th style="padding:4px 6px;border-bottom:2px solid #1b2a4a;font-size:11px;">区分</th></tr></thead><tbody>' +
          items.map(d => '<tr><td style="padding:3px 6px;border-bottom:1px solid #eee;">' + d.name + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + d.code + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;text-align:right;">' + d.points + '</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:10px;">' + d.category + '</td></tr>').join('') +
          '</tbody></table>';
      }
    } catch (e) {
      results.innerHTML = '<div style="color:#c62828;">検索エラー: ' + e.message + '</div>';
    }
  }, 300);
}

// 起動時にマスタステータス確認 + 未取込なら自動取込
setTimeout(async () => {
  try {
    await MasterDB.open();
    const status = await MasterDB.getStatus();
    const total = (status.drugs?.count || 0) + (status.diseases?.count || 0) + (status.medical?.count || 0);
    if (total === 0) {
      console.log('マスタ未取込 → 自動取込開始');
      const btn = document.getElementById('masterStatusBtn');
      if (btn) btn.textContent = '\u2699 マスタ取込中...';
      await MasterDB.autoImportFromFolder();
      console.log('マスタ自動取込完了');
    }
    await refreshMasterStatus();
  } catch(e) { console.log('MasterDB init:', e); }
}, 500);

// ===== Data =====
const patients = [
  { id:'P001', name:'田中太郎', age:75, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1951-03-15', address:'愛知県北名古屋市西之保犬井190', phone:'0568-22-XXXX', nameKana:'タナカタロウ', allergies:['ペニシリン系'], history:['高血圧症','2型糖尿病'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 あ 12-34',lane:1}, status:'active', memo:'定期処方。血圧コントロール良好。', insurancePhoto:null, insuranceNumber:'記号12345-番号678', insurerNumber:'39230010', kouhiNumber:'', incomeLevel:'ippan', questionnaire:null, arrivedAt:'09:00', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'},{date:'2026-01-18',cc:'定期処方',diag:'高血圧症, 2型糖尿病',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T 28日',doc:'院長'}], pastVitals:[{date:'2026-02-18',t:'36.2',bp:'132/78',spo2:'97',p:'68'},{date:'2026-01-18',t:'36.4',bp:'128/76',spo2:'98',p:'72'}] },
  { id:'P002', name:'鈴木花子', age:45, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1981-07-22', address:'愛知県名古���市中区栄3-1-1', phone:'052-XXX-XXXX', nameKana:'スズキハナコ', allergies:[], history:['花粉症'], prevRx:[{drugId:'montelukast10',qty:1,unit:'T'}], prevDays:14, prevVisitDate:'2026-03-04', vehicle:{plate:'名��屋 300 い 56-78',lane:2}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:30',symptoms:'鼻水、くしゃみ',duration:'3日前から',temperature:'36.4',otherComplaints:'目のかゆみ'}, arrivedAt:'09:15', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-04',cc:'花粉���',diag:'アレルギー性鼻炎',rx:'モンテルカスト10mg 1T 14日',doc:'院長'}], pastVitals:[{date:'2026-03-04',t:'36.4',bp:'118/72',spo2:'99',p:'76'}] },
  { id:'P003', name:'佐藤一郎', age:62, sex:'男', insurance:'国保3割', ratio:0.3, dob:'1964-11-05', address:'愛知県北名古屋市久地野牧野55', phone:'0568-XX-XXXX', nameKana:'サトウイチロウ', allergies:['セフェム系'], history:['脂質異常症'], prevRx:[{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 う 90-12',lane:3}, status:'waiting', memo:'LDLコレステロール要フォロー', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:22', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'脂質異常症',rx:'アトルバスタチン10mg 1T 28日',doc:'副院長'}], pastVitals:[{date:'2026-02-18',t:'36.3',bp:'140/88',spo2:'96',p:'74'}] },
  { id:'P004', name:'山田美咲', age:38, sex:'女', insurance:'社保3割', ratio:0.3, dob:'1988-04-10', address:'愛知県清須市清洲2272', phone:'052-XXX-XXXX', nameKana:'ヤマダミサキ', allergies:[], history:['片頭痛'], prevRx:[{drugId:'loxoprofen60',qty:3,unit:'T'},{drugId:'rebamipide100',qty:3,unit:'T'}], prevDays:7, prevVisitDate:'2026-03-11', vehicle:{plate:'名古屋 300 え 34-56',lane:4}, status:'waiting', memo:'', insurancePhoto:null, insuranceNumber:'', questionnaire:{receivedAt:'2026-03-18 09:45',symptoms:'頭痛',duration:'昨日から',temperature:'36.8',otherComplaints:'吐き気あり'}, arrivedAt:'09:35', visitDate:'2026-03-18', pastKartes:[{date:'2026-03-11',cc:'頭痛',diag:'片頭痛',rx:'ロキソプロフェン60mg 3T, レバミピド100mg 3T 7日',doc:'院長'}], pastVitals:[] },
  { id:'P005', name:'高橋健二', age:82, sex:'男', insurance:'後期高齢者1割', ratio:0.1, dob:'1944-01-20', address:'愛知県北名古屋市西春駅前1-1', phone:'0568-XX-XXXX', nameKana:'タカハシケンジ', allergies:['ロキソプロフェン'], history:['2型糖尿病','高血圧症'], prevRx:[{drugId:'amlodipine5',qty:1,unit:'T'},{drugId:'metformin500',qty:2,unit:'T'},{drugId:'atorvastatin10',qty:1,unit:'T'}], prevDays:28, prevVisitDate:'2026-02-18', vehicle:{plate:'名古屋 500 お 78-90',lane:5}, status:'waiting', memo:'HbA1c 7.2%。次回採血予定。', insurancePhoto:null, insuranceNumber:'', questionnaire:null, arrivedAt:'09:50', visitDate:'2026-03-18', pastKartes:[{date:'2026-02-18',cc:'定期処方',diag:'2型糖尿病, 高血圧症',rx:'アムロジピン5mg 1T, メトホルミン500mg 2T, アトルバスタチン10mg 1T 28日',doc:'院��'}], pastVitals:[{date:'2026-02-18',t:'36.5',bp:'138/82',spo2:'95',p:'70'}] }
];

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

const setOrders = [
  { name:'風邪セット', items:[{drugId:'acetaminophen200',qty:3},{drugId:'carbocisteine500',qty:3},{drugId:'tranexamic250',qty:3},{drugId:'rebamipide100',qty:3}], days:5 },
  { name:'胃腸炎セット', items:[{drugId:'domperidone10',qty:3},{drugId:'rebamipide100',qty:3},{drugId:'loperamide1',qty:1}], days:5 },
  { name:'高血圧セット', items:[{drugId:'amlodipine5',qty:1}], days:28 },
  { name:'花粉���セット', items:[{drugId:'fexofenadine60',qty:2},{drugId:'montelukast10',qty:1}], days:14 }
];

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

// ===== Billing Menu Master (Phase 4) =====
const billingMenuItems = {
  initial: [
    {name:'初診料',points:291},{name:'再診料',points:75},{name:'外来管理加算',points:52},
    {name:'時間外加算（初診）',points:85},{name:'休日加算（初診）',points:250},{name:'深夜加算（初診）',points:480},
    {name:'時間外加算（再診）',points:65},{name:'休日加算（再診）',points:190},{name:'深夜加算��再診）',points:420}
  ],
  management: [
    {name:'特定疾患療養管理料',points:225},{name:'薬剤情報提供料',points:10},
    {name:'診療情報提供料(I)',points:250},{name:'療養費同意書交付料',points:100}
  ],
  procedure: [
    {name:'創傷処置（100cm2未満）',points:52},{name:'創傷処置（100〜500cm2）',points:60},
    {name:'消炎鎮痛等処置',points:35},{name:'鼻腔・咽頭処置',points:12},
    {name:'ネブライザー',points:12},{name:'皮膚科軟膏処置',points:55}
  ],
  labtest: [
    {name:'血液一般（末梢血）',points:21},{name:'生化学（10項目まで）',points:106},
    {name:'CRP定量',points:16},{name:'HbA1c',points:49},
    {name:'尿一般',points:26},{name:'便潜血（2回法）',points:41},
    {name:'コロナ抗原定性',points:150},{name:'インフル抗原定性',points:150}
  ],
  injection: [
    {name:'皮下・筋肉内注射',points:20},{name:'静脈内注射',points:32},
    {name:'点滴注射（500mL以上）',points:98},{name:'点滴注射（500mL未満）',points:49}
  ],
  imaging: [
    {name:'胸部X線（単純）',points:210},{name:'腹部X線（単純）',points:210},
    {name:'心電図（12誘導）',points:130},{name:'超音波検査（腹部）',points:530}
  ]
};
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
      // Phase 2A: SOAP
      soap: { s:'', o:'', a:'', p:'' },
      vitals:{t:'',bps:'',bpd:'',spo2:'',pulse:''},
      // Phase 2A: Enhanced diseases with code, main flag, date, outcome
      selectedDiseases:[], prescriptions:[], rxDays:7,
      isFirstVisit: !p.prevVisitDate,
      selectedExams:[], addedBillingItems:[],
      // Phase 2A: Problem list
      problems: (p.history || []).map((h, i) => ({
        id: 'PL' + (i+1),
        name: h,
        code: '',
        status: 'active', // active, inactive, resolved
        startDate: p.prevVisitDate || '',
        resolvedDate: ''
      })),
      // Phase 2C: Exam results & Consent
      examResults: [],
      examInterpretation: '',
      consentRecords: []
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
  const filtered = getPatientsForDate(selectedDate);
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
      return '<tr onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;background:#f8faff;"><td>' + (i+1) + '</td><td class="td-status">' + typeBadge + '</td><td class="td-name">' + p.name + '<div class="sub">DB / ' + (p.address || '') + ' / ' + time + '</div></td><td>' + p.age + '歳 ' + p.sex + '</td><td>' + p.insurance + '</td><td class="td-allergy">' + (tests || '-') + '</td><td class="td-lane">' + doctor + '</td><td class="td-questionnaire">' + (p.route || '-') + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button></td></tr>';
    }
    if (p.status === 'waiting') waitC++; else if (p.status === 'active') activeC++; else if (p.status === 'done') doneC++;
    const statusBadge = p.status === 'active' ? '<span class="status-badge active">診察中</span>' : p.status === 'done' ? '<span class="status-badge done">完了</span>' : '<span class="status-badge waiting">待機</span>';
    const allergyStr = p.allergies.length > 0 ? p.allergies.join(', ') : '-';
    const qBadge = p.questionnaire ? '<span class="q-badge received">受信済</span>' : '<span class="q-badge none">-</span>';
    const rowClass = p.status === 'done' ? ' class="status-done-row"' : '';
    return '<tr' + rowClass + ' onclick="openKarte(\'' + p.id + '\')" style="cursor:pointer;"><td>' + (i+1) + '</td><td class="td-status">' + statusBadge + '</td><td class="td-name">' + p.name + '<div class="sub">' + (p.nameKana||'') + ' / ' + p.id + ' / ' + (p.arrivedAt||'') + '</div></td><td>' + p.age + '歳 ' + p.sex + '</td><td>' + p.insurance + '</td><td class="td-allergy">' + allergyStr + '</td><td class="td-lane">L' + p.vehicle.lane + '</td><td class="td-questionnaire">' + qBadge + '</td><td class="td-actions"><button class="action-btn karte-btn" onclick="event.stopPropagation();openKarte(\'' + p.id + '\')">カルテ</button>' + (p.status === 'waiting' ? '<button class="action-btn call-btn" onclick="event.stopPropagation();callPatientFromList(\'' + p.id + '\')">呼出</button>' : '') + '</td></tr>';
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

function changeDate(delta) { const d = new Date(selectedDate); d.setDate(d.getDate()+delta); selectedDate = d.toISOString().split('T')[0]; document.getElementById('listDate').value = selectedDate; renderPatientList(); }
function setToday() { selectedDate = new Date().toISOString().split('T')[0]; document.getElementById('listDate').value = selectedDate; renderPatientList(); }
function onDateChange() { selectedDate = document.getElementById('listDate').value; renderPatientList(); }

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
    resultArea.innerHTML = '<div style="color:var(--danger);font-size:12px;">読取エラー: ' + err.message + '</div>';
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
    html += '<div class="ocr-field-row"><span class="ocr-field-label">' + r.label + '</span><span class="' + valueClass + '">' + r.val + '</span>' + iconHtml + '</div>';
  }

  // 漢字候補がある場合
  if (f.nameGuessCandidates) {
    const gc = f.nameGuessCandidates;
    if (gc.surnameCandidates.length > 1 || gc.givenCandidates.length > 1) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">漢字候補: ';
      if (gc.surnameCandidates.length > 1) html += '姓=' + gc.surnameCandidates.join('/') + ' ';
      if (gc.givenCandidates.length > 1) html += '名=' + gc.givenCandidates.join('/');
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
    statusEl.innerHTML = '<span style="color:var(--success);">&#10003; ' + parsed.houbetsuName + '（' + (parsed.prefName || '') + '）</span>';
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
    statusEl.innerHTML = '<span style="color:var(--danger);">' + parsed.errors.join(', ') + '</span>';
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
    insurancePhoto: (ocrExtracted && ocrExtracted._imageData) ? ocrExtracted._imageData : null, insuranceNumber: buildInsuranceNumberStr(ocrExtracted), insurerNumber: (newInsurerNum ? newInsurerNum.value : ''), kouhiNumber: '', incomeLevel: 'ippan', questionnaire: null,
    arrivedAt: now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'),
    visitDate: selectedDate, pastKartes: [], pastVitals: []
  };
  patients.push(newP);
  karteData[newP.id] = { chiefComplaint:'', chiefComplaintSelect:'', findingsHtml:'', soap:{s:'',o:'',a:'',p:''}, vitals:{t:'',bps:'',bpd:'',spo2:'',pulse:''}, selectedDiseases:[], prescriptions:[], rxDays:7, isFirstVisit:true, selectedExams:[], addedBillingItems:[], problems:[] };
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
  // Phase 2A: SOAP
  const soapS = document.getElementById('soapS');
  if (soapS) {
    k.soap = { s: soapS.value, o: document.getElementById('soapO').value, a: document.getElementById('soapA').value, p: document.getElementById('soapP').value };
  }
  k.vitals.t = document.getElementById('vitalT').value;
  k.vitals.bps = document.getElementById('vitalBPS').value;
  k.vitals.bpd = document.getElementById('vitalBPD').value;
  k.vitals.spo2 = document.getElementById('vitalSpO2').value;
  k.vitals.pulse = document.getElementById('vitalP').value;
  k.rxDays = parseInt(document.getElementById('rxDays').value) || 7;
  // Phase 2C: exam interpretation
  const interpEl = document.getElementById('examInterpretation');
  if (interpEl) k.examInterpretation = interpEl.value;
  const memoEl = document.getElementById('patientMemo');
  if (memoEl) { const p = patients.find(x => x.id === currentPatientId); if (p) p.memo = memoEl.value; }
}

function loadCurrentKarte() {
  const k = karteData[currentPatientId];
  document.getElementById('chiefComplaint').value = k.chiefComplaint;
  document.getElementById('chiefComplaintSelect').value = k.chiefComplaintSelect || '';
  const editor = document.getElementById('findingsEditor');
  if (editor) editor.innerHTML = k.findingsHtml || '';
  // Phase 2A: SOAP
  const soapS = document.getElementById('soapS');
  if (soapS && k.soap) {
    soapS.value = k.soap.s || '';
    document.getElementById('soapO').value = k.soap.o || '';
    document.getElementById('soapA').value = k.soap.a || '';
    document.getElementById('soapP').value = k.soap.p || '';
  }
  document.getElementById('vitalT').value = k.vitals.t;
  document.getElementById('vitalBPS').value = k.vitals.bps;
  document.getElementById('vitalBPD').value = k.vitals.bpd;
  document.getElementById('vitalSpO2').value = k.vitals.spo2;
  document.getElementById('vitalP').value = k.vitals.pulse;
  document.getElementById('rxDays').value = k.rxDays;
  // Phase 2C
  const interpEl = document.getElementById('examInterpretation');
  if (interpEl) interpEl.value = k.examInterpretation || '';
  renderExamResults();
  renderConsentRecords();
}

function renderAllKarte() {
  const p = patients.find(x => x.id === currentPatientId); if (!p) return;
  renderHeader(p);
  renderPatientInfoTab(p);
  loadCurrentKarte();
  renderDiseaseQuickBtns();
  renderSelectedDiseases();
  renderProblemList();
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
    sel.innerHTML += '<option value="' + d + '">' + d + '</option>';
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
      h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;"><div class="patient-thumb">' + p.name.charAt(0) + '</div><div><div style="font-weight:700;font-size:12px;">' + p.name + '</div><div style="font-size:10px;color:var(--text-muted);">' + (p.nameKana||'') + '</div></div></div>';
      h += '<div class="info-row"><span class="label">年齢</span><span class="value">' + p.age + '歳 (' + p.sex + ')</span></div>';
      if (p.dob) h += '<div class="info-row"><span class="label">生年月日</span><span class="value">' + p.dob + '</span></div>';
      if (p.address) h += '<div class="info-row"><span class="label">住所</span><span class="value" style="font-size:10px;">' + p.address + '</span></div>';
      if (p.phone) h += '<div class="info-row"><span class="label">電話</span><span class="value">' + p.phone + '</span></div>';
      h += '<div class="info-row"><span class="label">保険</span><span class="value">' + p.insurance + '</span></div>';
      h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title">問診票' + (p.questionnaire ? ' <span class="questionnaire-badge received">受信済</span>' : ' <span class="questionnaire-badge pending">未受信</span>') + '</div>';
      if (p.questionnaire) {
        h += '<div class="questionnaire-data"><div class="q-row"><span class="q-label">症状</span><span>' + p.questionnaire.symptoms + '</span></div><div class="q-row"><span class="q-label">期間</span><span>' + p.questionnaire.duration + '</span></div></div>';
        h += '<button class="edit-btn" style="margin-top:3px;width:100%;text-align:center;" onclick="openQuestionnaireModal()">カルテに反映</button>';
      }
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">前回処方（' + p.prevDays + '日分）</div>';
      p.prevRx.forEach(rx => { const d = drugs.find(x => x.id === rx.drugId); if (d) h += '<div class="prev-rx-item"><span>' + d.name + '</span><span>' + rx.qty + rx.unit + '</span></div>'; });
      if (p.prevRx.length > 0) h += '<button class="do-rx-btn" onclick="doRx()">Do処方（前回と同じ）</button>';
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">患者メモ</div><textarea class="patient-memo" id="patientMemo" placeholder="メモを入力...">' + (p.memo||'') + '</textarea></div>';
      h += '<div class="info-section"><div class="info-section-title">車両情報</div><div class="vehicle-info"><div class="plate">' + p.vehicle.plate + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px;">レーン ' + p.vehicle.lane + '</div></div></div>';
      if (p.dbSource) {
        h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title" style="color:#2563eb;">DB情報</div>';
        if (p.route) h += '<div class="info-row"><span class="label">流入経路</span><span class="value">' + p.route + '</span></div>';
        if (p.type) h += '<div class="info-row"><span class="label">患者種別</span><span class="value">' + p.type + '</span></div>';
        if (p.address) h += '<div class="info-row"><span class="label">エリア</span><span class="value">' + p.address + '</span></div>';
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
      if (p.insuranceNumber) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">No: ' + p.insuranceNumber + '</div>';
      if (p.insurerNumber) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:1px;">保険者番号: <span style="font-family:monospace;letter-spacing:0.1em;">' + p.insurerNumber + '</span></div>';
      h += '</div>';
      h += '<div class="info-row"><span class="label">保険種別</span><span class="value">' + p.insurance + '</span></div>';
      h += '<div class="info-row"><span class="label">負担割合</span><span class="value" style="font-weight:700;color:var(--primary);">' + (p.ratio * 100) + '%</span></div>';
      if (p.kouhiNumber) h += '<div class="info-row"><span class="label">公費</span><span class="value">' + p.kouhiNumber + '</span></div>';
      break;

    case 'allergy':
      h += '<div class="info-section"><div class="info-section-title">アレルギー・副作用</div>';
      h += p.allergies.length > 0 ? p.allergies.map(a => '<span class="allergy-tag">' + a + '</span>').join('') : '<span style="font-size:11px;color:var(--text-muted);">登録なし</span>';
      h += '</div>';
      h += '<div class="info-section"><div class="info-section-title">既往歴</div>';
      if (p.history.length > 0) p.history.forEach(x => { h += '<div class="history-item">' + x + '</div>'; });
      else h += '<span style="font-size:11px;color:var(--text-muted);">なし</span>';
      h += '</div>';
      break;

    case 'vitals':
      h += '<div class="info-section"><div class="info-section-title">バイタル履歴</div>';
      if (p.pastVitals && p.pastVitals.length > 0) {
        h += '<table style="width:100%;font-size:10px;border-collapse:collapse;"><tr style="background:var(--bg);"><th style="padding:3px;">日付</th><th>T</th><th>BP</th><th>SpO2</th><th>P</th></tr>';
        p.pastVitals.forEach(v => { h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:3px;color:var(--primary);font-weight:600;">' + v.date + '</td><td>' + v.t + '</td><td>' + v.bp + '</td><td>' + v.spo2 + '</td><td>' + v.p + '</td></tr>'; });
        h += '</table>';
      } else h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
      h += '</div>';
      break;

    case 'history':
      h += '<div class="info-section"><div class="info-section-title">診療履歴</div>';
      if (p.pastKartes && p.pastKartes.length > 0) {
        p.pastKartes.forEach(k => {
          h += '<div class="history-entry"><span class="history-date">' + k.date + '</span><span class="history-diag">' + (k.diag || '---') + '</span><span class="history-doc">' + (k.doc || '') + '</span></div>';
        });
      } else h += '<span style="font-size:11px;color:var(--text-muted);">履歴なし</span>';
      h += '</div>';
      if (p.dbSource && p.dbVisits && p.dbVisits.length > 0) {
        h += '<div class="info-section" style="margin-top:6px;"><div class="info-section-title" style="color:#2563eb;">来院詳細（DB）</div>';
        h += '<table style="width:100%;font-size:10px;border-collapse:collapse;"><tr style="background:var(--bg);"><th style="padding:3px;">日付</th><th>時間帯</th><th>担当医</th><th>検査</th><th>自己負担</th></tr>';
        p.dbVisits.sort((a, b) => compareDateStr(b.date, a.date)).forEach(v => {
          const tests = [v.covid ? 'C+' : '', v.flu ? 'Flu+' : '', v.strep ? '溶+' : ''].filter(Boolean).join(' ') || '-';
          h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:3px;color:var(--primary);font-weight:600;">' + (v.date || '') + '</td><td>' + (v.time || '') + '</td><td>' + (v.doctor || '') + '</td><td>' + tests + '</td><td>' + (v.selfPay ? '&yen;' + v.selfPay.toLocaleString() : '-') + '</td></tr>';
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
            h += '<span style="color:var(--primary);font-weight:700;font-size:12px;">' + (k.date || '') + '</span>';
            if (k.doc) h += '<span style="font-size:10px;color:var(--text-muted);">' + k.doc + '</span>';
            h += '</div>';
            // rxが配列（{drug,qty}オブジェクト）か文字列かで分岐
            if (Array.isArray(k.rxItems) && k.rxItems.length > 0) {
              h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
              k.rxItems.forEach(item => {
                h += '<tr><td style="padding:2px 0;padding-right:12px;">' + item.drug + '</td>';
                h += '<td style="padding:2px 0;white-space:nowrap;color:var(--primary);font-weight:600;text-align:right;width:60px;">' + (item.qty || '') + '</td></tr>';
              });
              h += '</table>';
            } else if (typeof k.rx === 'string' && k.rx) {
              // 旧形式（カンマ区切り文字列）
              const rxList = k.rx.split(',').map(s => s.trim()).filter(s => s);
              h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
              rxList.forEach(item => {
                h += '<tr><td style="padding:2px 0;">' + item + '</td></tr>';
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
          h += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:4px 6px;color:var(--primary);font-weight:600;">' + (v.date || '') + '</td><td>' + (v.doctor || '') + '</td><td style="text-align:right;">' + (v.revenuePoints ? v.revenuePoints.toLocaleString() + '点' : '-') + '</td><td style="text-align:right;">' + (v.selfPay ? '&yen;' + v.selfPay.toLocaleString() : '-') + '</td></tr>';
        });
        h += '</table></div>';
      }
      break;

    case 'diseases':
      h += '<div class="info-section"><div class="info-section-title">傷病名一覧</div>';
      if (p.history && p.history.length > 0) {
        p.history.forEach(d => {
          const info = diseases.find(x => x.name === d);
          h += '<div style="padding:3px 0;font-size:11px;border-bottom:1px solid var(--bg);">' + d + (info ? ' <span style="font-size:9px;color:var(--text-muted);">' + info.code + '</span>' : '') + '</div>';
        });
      } else h += '<span style="font-size:11px;color:var(--text-muted);">なし</span>';
      const k = karteData[currentPatientId];
      if (k && k.selectedDiseases.length > 0) {
        h += '<div class="info-section-title" style="margin-top:6px;">今回の傷病名</div>';
        k.selectedDiseases.forEach(d => { h += '<div style="padding:3px 0;font-size:11px;">' + d.name + ' [' + (d.status==='suspected'?'疑い':'確定') + ']</div>'; });
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
  btns += quickDiseases.map(d => '<button class="disease-quick-btn" onclick="addDisease(\'' + d + '\')">' + d + '</button>').join('');
  document.getElementById('diseaseQuickBtns').innerHTML = btns;
}
function copyPrevDiseases() { const p = patients.find(x => x.id === currentPatientId); if (!p || !p.history) return; p.history.forEach(h => addDisease(h)); showToast('前回傷病名を引き継ぎました'); }

// Phase 2A: マスタDB連動の傷病名検索
let diseaseSearchTimer = null;
function searchDisease(q) {
  const r = document.getElementById('diseaseResults');
  if (!q) { r.classList.remove('show'); return; }
  clearTimeout(diseaseSearchTimer);
  diseaseSearchTimer = setTimeout(async () => {
    // まずハードコードの簡易リストから検索
    let results = diseases.filter(d => d.name.includes(q) || d.code.includes(q)).map(d => ({ name: d.name, code: d.code, icd: d.code }));
    // マスタDBがあればそちらも検索
    try {
      const dbCount = await MasterDB.getCount('diseases');
      if (dbCount > 0) {
        const masterResults = await MasterDB.search('diseases', q, 15);
        // マスタの結果をマージ（重複排除）
        masterResults.forEach(mr => {
          if (!results.find(r => r.name === mr.name)) {
            results.push({ name: mr.name, code: mr.code, icd: mr.icd || '' });
          }
        });
      }
    } catch(e) {}
    if (!results.length) { r.classList.remove('show'); return; }
    r.innerHTML = results.slice(0, 20).map(d => {
      const escapedName = d.name.replace(/'/g, "\\'");
      const escapedCode = (d.code || '').replace(/'/g, "\\'");
      const escapedIcd = (d.icd || '').replace(/'/g, "\\'");
      return '<div class="disease-result-item" onclick="addDiseaseEnhanced(\'' + escapedName + '\',\'' + escapedCode + '\',\'' + escapedIcd + '\')">'
        + d.name + ' <span style="color:var(--text-muted);font-size:10px;">' + (d.code || '') + '</span>'
        + (d.icd ? ' <span style="color:var(--primary);font-size:9px;">' + d.icd + '</span>' : '')
        + '</div>';
    }).join('');
    r.classList.add('show');
  }, 200);
}

// Phase 2A: 強化版 addDisease（コード・ICD・日付・主病フラグ付き）
function addDiseaseEnhanced(name, code, icd) {
  const k = karteData[currentPatientId];
  if (k.selectedDiseases.find(d => d.name === name)) { showToast('既に追加済みです'); return; }
  const today = new Date().toISOString().split('T')[0];
  k.selectedDiseases.push({
    name: name,
    code: code || '',
    icd: icd || '',
    status: 'confirmed',  // confirmed, suspected
    isMain: k.selectedDiseases.length === 0, // 最初の1つを主病にデフォルト
    startDate: today,
    outcome: ''  // '', 治癒, 中止, 継続, 転医, 死亡
  });
  document.getElementById('diseaseSearch').value = '';
  document.getElementById('diseaseResults').classList.remove('show');
  renderSelectedDiseases();
  // プロブレムリストにも自動追加
  addToProblemList(name, code);
}
function addDisease(name) {
  // 後方互換: 旧形式のaddDiseaseもサポート
  const info = diseases.find(d => d.name === name);
  addDiseaseEnhanced(name, info ? info.code : '', info ? info.code : '');
}
function removeDisease(i) { karteData[currentPatientId].selectedDiseases.splice(i,1); renderSelectedDiseases(); }
function toggleDiseaseStatus(i) { const d = karteData[currentPatientId].selectedDiseases[i]; d.status = d.status === 'confirmed' ? 'suspected' : 'confirmed'; renderSelectedDiseases(); }
function toggleMainDisease(i) {
  const k = karteData[currentPatientId];
  k.selectedDiseases.forEach((d, j) => d.isMain = (j === i));
  renderSelectedDiseases();
}
function cycleDiseaseOutcome(i) {
  const outcomes = ['', '継続', '治癒', '中止', '転医', '死亡'];
  const d = karteData[currentPatientId].selectedDiseases[i];
  const idx = outcomes.indexOf(d.outcome || '');
  d.outcome = outcomes[(idx + 1) % outcomes.length];
  renderSelectedDiseases();
}
function onDiseaseStartDate(i, val) {
  karteData[currentPatientId].selectedDiseases[i].startDate = val;
}

// Phase 2A: 強化版 renderSelectedDiseases
function renderSelectedDiseases() {
  const k = karteData[currentPatientId];
  const el = document.getElementById('selectedDiseases');
  if (!k.selectedDiseases.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text-light);padding:8px;">傷病名が選択されていません</div>'; return; }
  el.innerHTML = k.selectedDiseases.map((d, i) => {
    const mainCls = d.isMain ? 'disease-main-flag is-main' : 'disease-main-flag';
    const statusCls = d.status === 'suspected' ? 'disease-status-badge suspected' : 'disease-status-badge confirmed';
    const statusLbl = d.status === 'suspected' ? '疑い' : '確定';
    const outcomeLbl = d.outcome || '-';
    return '<div class="disease-item-enhanced">'
      + '<div class="' + mainCls + '" onclick="toggleMainDisease(' + i + ')" title="主病フラグ">主</div>'
      + '<span class="disease-name">' + d.name + '</span>'
      + (d.code ? '<span class="disease-code">' + d.code + '</span>' : '')
      + '<span class="' + statusCls + '" onclick="toggleDiseaseStatus(' + i + ')">' + statusLbl + '</span>'
      + '<span class="disease-outcome" onclick="cycleDiseaseOutcome(' + i + ')" title="転帰">' + outcomeLbl + '</span>'
      + '<span class="disease-date"><input type="date" value="' + (d.startDate || '') + '" onchange="onDiseaseStartDate(' + i + ',this.value)"></span>'
      + '<span class="disease-remove" onclick="removeDisease(' + i + ')">&times;</span>'
      + '</div>';
  }).join('');
}

// ===== Phase 2A: Problem List =====
let problemFilter = 'all';
function addToProblemList(name, code) {
  const k = karteData[currentPatientId];
  if (k.problems.find(p => p.name === name)) return;
  const nextNum = k.problems.length + 1;
  k.problems.push({
    id: 'PL' + nextNum,
    name: name,
    code: code || '',
    status: 'active',
    startDate: new Date().toISOString().split('T')[0],
    resolvedDate: ''
  });
  renderProblemList();
}
function toggleProblemStatus(i) {
  const k = karteData[currentPatientId];
  const p = k.problems[i];
  const cycle = ['active', 'inactive', 'resolved'];
  const idx = cycle.indexOf(p.status);
  p.status = cycle[(idx + 1) % cycle.length];
  if (p.status === 'resolved') p.resolvedDate = new Date().toISOString().split('T')[0];
  else p.resolvedDate = '';
  renderProblemList();
}
function filterProblems(filter) {
  problemFilter = filter;
  document.querySelectorAll('.pf-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderProblemList();
}
function renderProblemList() {
  const k = karteData[currentPatientId];
  const el = document.getElementById('problemList');
  if (!el) return;
  let list = k.problems || [];
  if (problemFilter !== 'all') list = list.filter(p => p.status === problemFilter);
  if (!list.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text-light);padding:8px;">プロブレムなし</div>'; return; }
  el.innerHTML = list.map((p, i) => {
    const origIdx = k.problems.indexOf(p);
    const statusLabels = { active: 'Active', inactive: 'Inactive', resolved: 'Resolved' };
    return '<div class="problem-item ' + p.status + '">'
      + '<span class="problem-num">' + (origIdx + 1) + '</span>'
      + '<span class="problem-name">' + p.name + '</span>'
      + '<span class="problem-status-tag ' + p.status + '">' + statusLabels[p.status] + '</span>'
      + '<span class="problem-date">' + (p.startDate || '') + '</span>'
      + '<span class="problem-toggle" onclick="toggleProblemStatus(' + origIdx + ')">切替</span>'
      + '</div>';
  }).join('');
}

// ===== Phase 2A: SOAP =====
function onSoapChange() {
  // リアルタイム保存（軽量）
  const k = karteData[currentPatientId];
  if (!k) return;
  k.soap = {
    s: document.getElementById('soapS').value,
    o: document.getElementById('soapO').value,
    a: document.getElementById('soapA').value,
    p: document.getElementById('soapP').value
  };
}
function applySoapTemplate() {
  const p = patients.find(x => x.id === currentPatientId);
  const cc = document.getElementById('chiefComplaint').value || document.getElementById('chiefComplaintSelect').value || '';
  const k = karteData[currentPatientId];
  const v = k.vitals;
  // S: 主訴から自動挿入
  const soapS = document.getElementById('soapS');
  if (!soapS.value) soapS.value = (cc ? cc + '。\n' : '') + '発症時期: \n経過: \n増悪/緩解因子: ';
  // O: バイタルを自動挿入
  const soapO = document.getElementById('soapO');
  let oText = '';
  if (v.t || v.bps || v.spo2 || v.pulse) {
    oText += 'VS) ';
    if (v.t) oText += 'BT ' + v.t + '℃, ';
    if (v.bps) oText += 'BP ' + v.bps + '/' + (v.bpd||'') + 'mmHg, ';
    if (v.spo2) oText += 'SpO2 ' + v.spo2 + '%, ';
    if (v.pulse) oText += 'P ' + v.pulse + '/min';
    oText += '\n';
  }
  oText += '身体所見) \n咽頭: \n胸部: \n腹部: ';
  if (!soapO.value) soapO.value = oText;
  // A
  if (!document.getElementById('soapA').value) document.getElementById('soapA').value = '鑑別: \n診断根拠: \nリスク: ';
  // P
  if (!document.getElementById('soapP').value) document.getElementById('soapP').value = '治療方針: \n処方: \n次回予定: \nフォロー: ';
  onSoapChange();
  showToast('SOAPテンプレートを挿入しました');
}

// ===== Phase 2B: Clinical Safety Alerts =====
const CONTRAINDICATION_MAP = {
  'ペニシリン系': ['アモキシシリン','アンピシリン','ペニシリンG','ビクシリン','サワシリン','オーグメンチン','ユナシン'],
  'セフェム系': ['セフカペン','フロモックス','セフジニル','セフゾン','メイアクト','ケフレックス','セファクロル','セフトリアキソン'],
  'ロキソプロフェン': ['ロキソニン','ロキソプロフェン'],
  'アスピリン': ['アスピリン','バイアスピリン','バファリン配合錠A'],
  'NSAIDs': ['ロキソニン','ロキソプロフェン','ジクロフェナク','ボルタレン','イブプロフェン','セレコキシブ','セレコックス','インドメタシン']
};

function checkContraindications(drugName) {
  const p = patients.find(x => x.id === currentPatientId);
  if (!p || !p.allergies || !p.allergies.length) return [];
  const warnings = [];
  for (const allergy of p.allergies) {
    const contraList = CONTRAINDICATION_MAP[allergy] || [allergy];
    for (const contra of contraList) {
      if (drugName.includes(contra) || contra.includes(drugName.replace(/[0-9０-９.]+.*$/, ''))) {
        warnings.push({ type: 'allergy', severity: 'critical', message: 'アレルギー禁忌: ' + allergy + ' → ' + drugName });
      }
    }
  }
  // 重複投薬チェック
  const k = karteData[currentPatientId];
  const existing = k.prescriptions.find(rx => rx.drug.name === drugName);
  if (existing) warnings.push({ type: 'duplicate', severity: 'warning', message: '重複投薬: ' + drugName + ' は既に処方済み' });
  return warnings;
}

function showSafetyAlert(warnings) {
  if (!warnings.length) return true;
  const critical = warnings.filter(w => w.severity === 'critical');
  if (critical.length > 0) {
    const msg = '⚠ 重大な警告 ⚠\n\n' + critical.map(w => w.message).join('\n') + '\n\nこの処方を続行しますか？';
    return confirm(msg);
  }
  const msg = '注意:\n' + warnings.map(w => w.message).join('\n');
  showToast(msg, 'warning');
  return true;
}

// ===== Phase 2B: Audit Trail =====
let auditLog = [];
function addAuditEntry(action, detail) {
  auditLog.push({
    timestamp: new Date().toISOString(),
    patientId: currentPatientId,
    user: document.getElementById('doctorSelect') ? document.getElementById('doctorSelect').value : '不明',
    action: action,
    detail: detail
  });
  renderAuditBadge();
}
function renderAuditBadge() {
  const btn = document.getElementById('auditLogBtn');
  if (btn) btn.textContent = '監査ログ (' + auditLog.length + ')';
}
function showAuditLog() {
  const patientLog = auditLog.filter(e => e.patientId === currentPatientId);
  if (!patientLog.length) { showToast('この患者の監査ログはありません'); return; }
  let html = '<div style="max-height:400px;overflow-y:auto;font-size:11px;">';
  html += '<table style="width:100%;border-collapse:collapse;"><tr style="background:#f1f5f9;"><th style="padding:4px 6px;text-align:left;">日時</th><th style="padding:4px 6px;text-align:left;">操作者</th><th style="padding:4px 6px;text-align:left;">操作</th><th style="padding:4px 6px;text-align:left;">詳細</th></tr>';
  patientLog.reverse().forEach(e => {
    const t = new Date(e.timestamp);
    html += '<tr style="border-top:1px solid #e2e8f0;"><td style="padding:3px 6px;">' + t.toLocaleTimeString('ja-JP') + '</td><td style="padding:3px 6px;">' + e.user + '</td><td style="padding:3px 6px;">' + e.action + '</td><td style="padding:3px 6px;">' + e.detail + '</td></tr>';
  });
  html += '</table></div>';
  // Show in a simple modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = '<div style="background:#fff;border-radius:8px;padding:20px;max-width:700px;width:90%;"><h3 style="margin:0 0 12px;">監査証跡 - ' + (patients.find(x=>x.id===currentPatientId)?.name||'') + '</h3>' + html + '<button onclick="this.closest(\'div[style]\').parentElement.remove()" style="margin-top:12px;padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;">閉じる</button></div>';
  document.body.appendChild(overlay);
}

// Override addDrug with safety check
const _origAddDrug = function(id) { const d = drugs.find(x => x.id === id); if (!d) return; const k = karteData[currentPatientId]; const ex = k.prescriptions.find(rx => rx.drug.id === id); if (ex) ex.qty += 1; else k.prescriptions.push({drug:d,qty:1}); document.getElementById('drugSearch').value = ''; document.getElementById('drugResults').classList.remove('show'); renderRxList(); recalcBilling(); };

// ===== Prescription (with safety) =====
function renderSetOrders() { document.getElementById('setOrderBtns').innerHTML = setOrders.map((s,i) => '<button class="set-order-btn" onclick="applySetOrder(' + i + ')">' + s.name + '</button>').join(''); }
function applySetOrder(i) { const s = setOrders[i]; const k = karteData[currentPatientId]; k.prescriptions = []; s.items.forEach(item => { const d = drugs.find(x => x.id === item.drugId); if (d) k.prescriptions.push({drug:d,qty:item.qty}); }); k.rxDays = s.days; document.getElementById('rxDays').value = s.days; renderRxList(); recalcBilling(); addAuditEntry('セット適用', s.name); showToast(s.name + 'を適用'); }
function doRx() { const p = patients.find(x => x.id === currentPatientId); const k = karteData[currentPatientId]; k.prescriptions = []; p.prevRx.forEach(rx => { const d = drugs.find(x => x.id === rx.drugId); if (d) k.prescriptions.push({drug:d,qty:rx.qty}); }); k.rxDays = p.prevDays; document.getElementById('rxDays').value = p.prevDays; renderRxList(); recalcBilling(); addAuditEntry('Do処方', '前回処方を適用'); showToast('Do処方を適用'); }
function searchDrug(q) { const r = document.getElementById('drugResults'); if (!q) { r.classList.remove('show'); return; } const f = drugs.filter(d => d.name.includes(q) || d.category.includes(q)); if (!f.length) { r.classList.remove('show'); return; } r.innerHTML = f.map(d => '<div class="drug-result-item" onclick="addDrug(\'' + d.id + '\')"><span>' + d.name + stockBadge(d.name) + '</span><span class="price">' + (d.price ? d.price.toFixed(1) + '円' : '') + '</span></div>').join(''); r.classList.add('show'); }
function addDrug(id) {
  const d = drugs.find(x => x.id === id);
  if (!d) return;
  // Phase 2B: Safety check
  const warnings = checkContraindications(d.name);
  if (!showSafetyAlert(warnings)) { showToast('処方を中止しました', 'error'); addAuditEntry('処方中止(禁忌)', d.name); return; }
  const k = karteData[currentPatientId];
  const ex = k.prescriptions.find(rx => rx.drug.id === id);
  if (ex) ex.qty += 1; else k.prescriptions.push({drug:d,qty:1});
  document.getElementById('drugSearch').value = '';
  document.getElementById('drugResults').classList.remove('show');
  renderRxList(); recalcBilling();
  addAuditEntry('処方追加', d.name);
  if (warnings.length) addAuditEntry('警告確認', warnings.map(w=>w.message).join('; '));
}
function removeDrug(i) { karteData[currentPatientId].prescriptions.splice(i,1); renderRxList(); recalcBilling(); }
function updateDrugQty(i,v) { karteData[currentPatientId].prescriptions[i].qty = Math.max(0.5, parseFloat(v)||1); recalcBilling(); }
function renderRxList() {
  const k = karteData[currentPatientId]; const list = document.getElementById('rxList');
  if (!k.prescriptions.length) { list.innerHTML = '<li style="color:var(--text-muted);font-size:12px;padding:8px 0;text-align:center;">処方なし</li>'; return; }
  list.innerHTML = k.prescriptions.map((rx,i) => '<li class="rx-item"><span class="name">' + rx.drug.name + stockBadge(rx.drug.name) + '</span><input type="number" value="' + rx.qty + '" min="0.5" step="0.5" onchange="updateDrugQty(' + i + ',this.value)"><span class="unit">' + rx.drug.unit + '</span><span class="remove-drug" onclick="removeDrug(' + i + ')">&times;</span></li>').join('');
}

// ===== Exam =====
function renderExamCheckList() {
  const k = karteData[currentPatientId];
  document.getElementById('examCheckList').innerHTML = examItems.map(ex => {
    const chk = k.selectedExams.includes(ex.id) ? 'checked' : '';
    return '<li class="exam-check-item"><input type="checkbox" id="exam_' + ex.id + '" ' + chk + ' onchange="toggleExam(\'' + ex.id + '\')"><label for="exam_' + ex.id + '">' + ex.name + '</label><span class="exam-points">' + ex.points + '点</span></li>';
  }).join('');
}
function toggleExam(id) { const k = karteData[currentPatientId]; const i = k.selectedExams.indexOf(id); if (i >= 0) k.selectedExams.splice(i,1); else k.selectedExams.push(id); recalcBilling(); }

// ===== Billing Menu (Phase 4) =====
function switchBillingTab(cat) {
  currentBillingTab = cat;
  document.querySelectorAll('.bm-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
  renderBillingMenu();
}
function renderBillingMenu() {
  const items = billingMenuItems[currentBillingTab] || [];
  const search = (document.getElementById('billingMenuSearch')?.value || '').toLowerCase();
  const filtered = search ? items.filter(it => it.name.toLowerCase().includes(search)) : items;
  document.getElementById('billingMenuItems').innerHTML = filtered.map(it => '<div class="bm-item" onclick="addBillingItem(\'' + it.name.replace(/'/g,"\\'") + '\',' + it.points + ')"><span>' + it.name + '</span><span class="bm-pts">' + it.points + '点</span></div>').join('');
}
function filterBillingMenu(q) { renderBillingMenu(); }
function addBillingItem(name, points) {
  const k = karteData[currentPatientId];
  if (!k.addedBillingItems.find(x => x.name === name)) {
    k.addedBillingItems.push({name, points});
    recalcBilling();
    showToast(name + ' を追加');
  }
}

// ===== Billing =====
function recalcBilling() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  const days = parseInt(document.getElementById('rxDays').value) || 7;
  const shoshinTen = k.isFirstVisit ? 291 : 75;
  const gairaiTen = k.isFirstVisit ? 0 : 52;
  const surcharge = getTimeSurcharge(examStartTime);
  const surchargeTen = surcharge ? surcharge.points : 0;
  const sr = document.getElementById('billSurchargeRow');
  if (surchargeTen > 0) { sr.style.display = ''; document.getElementById('billSurcharge').textContent = surcharge.type + ' ' + surchargeTen + '点'; } else { sr.style.display = 'none'; }
  const numDrugs = k.prescriptions.length;
  const shohouTen = numDrugs > 0 ? (numDrugs >= 7 ? 29 : 42) : 0;
  const chouzaiTen = numDrugs > 0 ? (days<=7?11:days<=14?19:days<=21?25:days<=28?30:33) : 0;
  let yakuzaiTotal = 0;
  k.prescriptions.forEach(rx => { yakuzaiTotal += rx.drug.price * rx.qty * days; });
  const yakuzaiTen = goshagochoNyuu(yakuzaiTotal / 10);
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
  document.getElementById('billShohou').textContent = shohouTen > 0 ? shohouTen + '点' + (numDrugs >= 7 ? ' (逓減)' : '') : '---';
  document.getElementById('billChouzai').textContent = chouzaiTen > 0 ? chouzaiTen + '点' : '---';
  document.getElementById('billYakuzai').textContent = yakuzaiTen > 0 ? yakuzaiTen + '点' : '---';
  document.getElementById('billTotal').textContent = totalTen + '点';
  document.getElementById('billBurden').textContent = burden.toLocaleString() + '円';
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
  list.innerHTML = patients.map(p => {
    let sc = 'status-waiting';
    if (p.status === 'active') sc = 'status-active';
    if (p.status === 'done') { sc = 'status-done'; dc++; }
    if (p.status === 'waiting') wc++;
    return '<div class="waiting-item' + (p.id === currentPatientId ? ' active' : '') + '" onclick="switchPatient(\'' + p.id + '\')"><div class="status-dot ' + sc + '"></div><div class="w-info"><div class="w-name">' + p.name + '</div><div class="w-detail">' + p.age + '歳 ' + p.sex + '</div></div><div class="w-lane">L' + p.vehicle.lane + '</div></div>';
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
  if (k.prescriptions.length > 0) k.prescriptions.forEach(rx => { postToApi('savePrescription', { 'カル���ID': karteId, '患者ID': currentPatientId, '薬品名': rx.drug.name, '薬品コード': rx.drug.id, '用量': rx.qty, '単位': rx.drug.unit||'錠', '日数': k.rxDays, '薬価': rx.drug.price||0 }); });
  if (k.selectedDiseases.length > 0) k.selectedDiseases.forEach(d => { postToApi('saveDiagnosis', { 'カルテID': karteId, '患者ID': currentPatientId, '傷病名': d.name, 'ICD10コード': d.code||'', '確定区分': d.status === 'suspected' ? '疑い' : '確定' }); });
  if (k.selectedExams.length > 0) k.selectedExams.forEach(exId => { const exInfo = examItems.find(e => e.id === exId); if (exInfo) postToApi('saveExam', { 'カルテID': karteId, '患者ID': currentPatientId, '検査名': exInfo.name, '検査コード': exId }); });
  addAuditEntry('一時保存', 'カルテ下書きを保存');
  syncToSupabase(karteId, currentPatientId, k, '一時保存');
  showToast('カルテを一時保存しました');
}

function confirmBilling() {
  saveCurrentKarte();
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  const totalEl = document.getElementById('billTotal');
  const burdenEl = document.getElementById('billBurden');
  const rxSummary = k.prescriptions.map(rx => rx.drug.name + ' ' + rx.qty + rx.drug.unit).join('\n  ');
  const diseaseSummary = k.selectedDiseases.map(d => d.name + (d.status === 'suspected' ? '(疑い)' : '')).join(', ');
  const confirmMsg = '【確定確認】\n患者: ' + p.name + '（' + p.insurance + '）\n主訴: ' + (k.chiefComplaint || '未入力') + '\n傷病名: ' + (diseaseSummary || 'なし') + '\n処方:\n  ' + (rxSummary || '��し') + '\n合計: ' + totalEl.textContent + '\n患者��担: ' + burdenEl.textContent + '\n\nこの内容で確定しますか？';
  if (!confirm(confirmMsg)) return;
  const karteId = 'K-' + currentPatientId + '-' + selectedDate;
  const surchargeInfo = getTimeSurcharge(examStartTime);
  const timeSlotLabel = surchargeInfo ? surchargeInfo.type : '通常';
  const plainText = getEditorPlainText();
  postToApi('saveKarte', { 'カルテID': karteId, '患者ID': currentPatientId, '受診日': selectedDate, '診察開始時刻': examStartTime ? examStartTime.toLocaleTimeString('ja-JP') : '', '���察終了時刻': new Date().toLocaleTimeString('ja-JP'), '主訴': k.chiefComplaint, '所見': plainText, '体温': k.vitals.t, '収���期血圧': k.vitals.bps, '拡張期血圧': k.vitals.bpd, 'SpO2': k.vitals.spo2, '脈拍': k.vitals.pulse, '初診フラグ': k.isFirstVisit ? 'TRUE' : 'FALSE', '時間区分': timeSlotLabel, 'ステータス': '確定' });
  if (k.prescriptions.length > 0) k.prescriptions.forEach(rx => { postToApi('savePrescription', { 'カルテID': karteId, '患者ID': currentPatientId, '薬品名': rx.drug.name, '��品コード': rx.drug.id, '用量': rx.qty, '単位': rx.drug.unit||'錠', '日数': k.rxDays, '薬価': rx.drug.price||0 }); });
  if (k.selectedDiseases.length > 0) k.selectedDiseases.forEach(d => { postToApi('saveDiagnosis', { 'カルテID': karteId, '患���ID': currentPatientId, '傷病名': d.name, 'ICD10コード': d.code||'', '確定��分': d.status === 'suspected' ? '疑い' : '確定' }); });
  if (k.selectedExams.length > 0) k.selectedExams.forEach(exId => { const exInfo = examItems.find(e => e.id === exId); if (exInfo) postToApi('saveExam', { 'カルテID': karteId, '患者ID': currentPatientId, '検査名': exInfo.name, '検査コード': exId }); });
  const totalPoints = parseInt(totalEl.textContent) || 0;
  const burdenAmount = parseInt(burdenEl.textContent.replace(/[^0-9]/g, '')) || 0;
  const billingItemsList = [];
  if (k.isFirstVisit) billingItemsList.push('初診料 291点'); else billingItemsList.push('再診料 75点');
  if (!k.isFirstVisit) billingItemsList.push('外来管理加算 52点');
  if (surchargeInfo) billingItemsList.push(surchargeInfo.type + '加算 ' + surchargeInfo.points + '点');
  if (k.prescriptions.length > 0) billingItemsList.push('処方料・調剤料・薬剤料');
  postToApi('saveBilling', { 'カルテID': karteId, '患者ID': currentPatientId, '項目名': billingItemsList.join(', '), '合計点数': totalPoints, '負担額': burdenAmount, '負担割合': p.ratio });
  addAuditEntry('確定', '診察確定 合計' + totalPoints + '点 負担' + burdenAmount + '円');
  syncToSupabase(karteId, currentPatientId, k, '確定');

  // レセプト自動生成・更新
  autoGenerateReceipt(p, k, totalPoints, burdenAmount, surchargeInfo);

  p.status = 'done';
  examStartTime = null;
  document.getElementById('examStartBtn').textContent = '診察開���';
  document.getElementById('examStartBtn').classList.remove('active');
  renderWaitingList();
  showToast(p.name + 'さんの診察を確定しました');
}

function postToApi(action, data) { try { fetch(API_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:JSON.stringify({action, data}) }); } catch(e) { console.warn('API error:', e); } }
function printBilling() { showToast('印刷プレビュー（モック）'); }

// ===== 処方箋発行（様式第二号準拠） =====
const CLINIC_INFO = {
  name: '西春内科・在宅クリニック',
  zip: '481-0041',
  address: '愛知県北名古屋市九之坪南町1番',
  tel: '0568-65-5560',
  fax: '',
  code: '2311234567', // 医療機関コード（仮）
  prefCode: '23'
};

function openPrescriptionPreview() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId];
  if (!p) { showToast('患者を選択してください'); return; }
  if (!k.prescriptions || !k.prescriptions.length) { showToast('処方が入力されていません'); return; }

  const doctor = document.getElementById('visitDoctor')?.value || '院長';
  const facilityName = document.getElementById('orcaFacilityName')?.value || CLINIC_INFO.name;
  const today = new Date();
  const issueDate = today.getFullYear() + '年' + (today.getMonth()+1) + '月' + today.getDate() + '日';
  const expiryDate = new Date(today.getTime() + 4*24*60*60*1000);
  const expiryStr = expiryDate.getFullYear() + '年' + (expiryDate.getMonth()+1) + '月' + expiryDate.getDate() + '日';

  // 年齢計算
  const age = p.age || calcAge(p.dob);

  // 保険情報
  const insurerNo = p.insurerNumber || '';
  const insuranceNo = p.insuranceNumber || '';
  const insuranceType = p.insurance || '';

  // 処方内容を構築
  let rxRows = '';
  k.prescriptions.forEach((rx, i) => {
    const usage = rx.drug.usage || '1日3回 毎食後';
    rxRows += '<tr style="' + (i > 0 ? 'border-top:0.5pt dotted #ccc;' : '') + '">' +
      '<td style="text-align:right;padding:8pt 10pt 8pt 0;vertical-align:top;width:28pt;font-size:10pt;color:#555;">' + (i+1) + '</td>' +
      '<td style="padding:8pt 4pt;">' +
        '<div style="font-size:12pt;font-weight:600;">' + escHtml(rx.drug.name) + '</div>' +
        '<div style="font-size:9pt;color:#444;margin-top:2pt;">　' +
          rx.qty + (rx.drug.unit||'錠') + '　' + escHtml(usage) +
        '</div>' +
      '</td>' +
      '<td style="text-align:right;padding:8pt 0;vertical-align:top;width:55pt;font-size:11pt;">' + k.rxDays + '日分</td>' +
    '</tr>';
  });

  const html = buildPrescriptionHtml({
    facilityName, doctor, issueDate, expiryStr,
    patientName: p.name, patientKana: p.nameKana || '',
    patientDob: p.dob || '', patientAge: age, patientSex: p.sex || '',
    insurerNo, insuranceNo, insuranceType,
    rxRows, rxCount: k.prescriptions.length
  });

  document.getElementById('prescriptionPreviewBody').innerHTML = html;
  document.getElementById('prescriptionModal').classList.add('show');
}

function buildPrescriptionHtml(d) {
  // A4印刷を想定した処方箋（様式第二号ベース）
  var F = 'font-family:"Yu Mincho","YuMincho","Hiragino Mincho ProN","MS PMincho",serif;';
  var B = 'border:1.5pt solid #000;';
  var BB = 'border-bottom:1pt solid #000;';

  // 生年月日を和暦変換
  var dobDisplay = '';
  if (d.patientDob) {
    var dp = new Date(d.patientDob);
    if (!isNaN(dp)) {
      var y = dp.getFullYear(), m = dp.getMonth()+1, dd2 = dp.getDate();
      var era = '';
      if (y >= 2019) era = '令和' + (y-2018);
      else if (y >= 1989) era = '平成' + (y-1988);
      else if (y >= 1926) era = '昭和' + (y-1925);
      dobDisplay = era + '年' + m + '月' + dd2 + '日';
    }
  }

  return '<div id="rxFormContent" style="' + F + 'width:170mm;margin:0 auto;padding:0;color:#000;line-height:1.6;background:#fff;">' +

  // タイトル
  '<div style="text-align:center;padding:14pt 0 10pt;font-size:22pt;font-weight:700;letter-spacing:12pt;">処 方 箋</div>' +

  // 外枠テーブル開始
  '<table style="width:100%;' + B + 'border-collapse:collapse;' + F + '">' +

  // Row 1: 交付年月日 / 使用期間
  '<tr>' +
    '<td style="' + BB + 'border-right:1pt solid #000;padding:8pt 12pt;width:50%;vertical-align:top;">' +
      '<div style="font-size:8pt;color:#555;margin-bottom:2pt;">交付年月日</div>' +
      '<div style="font-size:13pt;font-weight:600;">' + d.issueDate + '</div>' +
    '</td>' +
    '<td style="' + BB + 'padding:8pt 12pt;vertical-align:top;">' +
      '<div style="font-size:8pt;color:#555;margin-bottom:2pt;">処方箋の使用期間</div>' +
      '<div style="font-size:12pt;">' + d.expiryStr + ' まで</div>' +
      '<div style="font-size:7.5pt;color:#888;margin-top:1pt;">特に記載のある場合を除き、交付の日を含めて4日以内に保険薬局に提出すること。</div>' +
    '</td>' +
  '</tr>' +

  // Row 2: 患者情報
  '<tr><td colspan="2" style="' + BB + 'padding:10pt 12pt;">' +
    '<table style="width:100%;border-collapse:collapse;">' +
      '<tr>' +
        '<td style="font-size:9pt;color:#555;width:70pt;padding:3pt 0;vertical-align:top;">患 者</td>' +
        '<td style="padding:3pt 0;">' +
          '<div style="font-size:8pt;color:#888;margin-bottom:1pt;">' + escHtml(d.patientKana) + '</div>' +
          '<div style="font-size:15pt;font-weight:700;">' + escHtml(d.patientName) + '</div>' +
        '</td>' +
        '<td style="text-align:right;vertical-align:top;padding:3pt 0;font-size:11pt;white-space:nowrap;">' +
          (d.patientAge ? d.patientAge + '歳' : '') +
          (d.patientSex ? '　' + d.patientSex : '') +
        '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="font-size:9pt;color:#555;padding:3pt 0;">生年月日</td>' +
        '<td colspan="2" style="font-size:11pt;padding:3pt 0;">' + dobDisplay + '</td>' +
      '</tr>' +
    '</table>' +
  '</td></tr>' +

  // Row 3: 保険情報
  '<tr><td colspan="2" style="' + BB + 'padding:6pt 12pt;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:10pt;">' +
      '<tr>' +
        '<td style="width:33%;padding:2pt 0;"><span style="font-size:8pt;color:#555;">保険者番号</span>　<strong>' + escHtml(d.insurerNo) + '</strong></td>' +
        '<td style="width:34%;padding:2pt 0;"><span style="font-size:8pt;color:#555;">記号・番号</span>　<strong>' + escHtml(d.insuranceNo) + '</strong></td>' +
        '<td style="width:33%;padding:2pt 0;"><span style="font-size:8pt;color:#555;">保険種別</span>　' + escHtml(d.insuranceType) + '</td>' +
      '</tr>' +
    '</table>' +
  '</td></tr>' +

  // Row 4: 注意書き
  '<tr><td colspan="2" style="' + BB + 'text-align:center;padding:5pt;font-size:9pt;background:#fafafa;">' +
    'この処方箋は、どの保険薬局でも有効です。' +
  '</td></tr>' +

  // Row 5: 処方内容
  '<tr><td colspan="2" style="' + BB + 'padding:10pt 12pt;min-height:240pt;">' +
    '<div style="font-size:10pt;font-weight:700;margin-bottom:6pt;padding-bottom:4pt;border-bottom:0.5pt solid #ccc;">処 方</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:11pt;">' +
      d.rxRows +
    '</table>' +
  '</td></tr>' +

  // Row 6: 後発医薬品 / リフィル
  '<tr><td colspan="2" style="' + BB + 'padding:6pt 12pt;font-size:9pt;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div>' +
        '<span style="font-weight:600;">後発医薬品（ジェネリック医薬品）への変更</span>　' +
        '<label style="margin-left:6pt;"><input type="checkbox" id="rxGenericOk" checked style="margin-right:2pt;">変更可</label>　' +
        '<label><input type="checkbox" id="rxGenericNg" style="margin-right:2pt;">変更不可</label>' +
      '</div>' +
      '<div>' +
        '<span style="font-weight:600;">リフィル</span>　' +
        '<label><input type="checkbox" id="rxRefill" style="margin-right:2pt;">可（　回）</label>' +
      '</div>' +
    '</div>' +
  '</td></tr>' +

  // Row 7: 医療機関 / 医師署名
  '<tr>' +
    '<td style="padding:10pt 12pt;border-right:1pt solid #000;vertical-align:top;">' +
      '<div style="font-size:8pt;color:#555;margin-bottom:4pt;">保険医療機関の名称・所在地</div>' +
      '<div style="font-size:13pt;font-weight:700;margin-bottom:3pt;">' + escHtml(d.facilityName) + '</div>' +
      '<div style="font-size:9pt;color:#333;">' + escHtml(CLINIC_INFO.zip) + '</div>' +
      '<div style="font-size:9pt;color:#333;">' + escHtml(CLINIC_INFO.address) + '</div>' +
      '<div style="font-size:9pt;color:#333;margin-top:2pt;">TEL: ' + escHtml(CLINIC_INFO.tel) + '</div>' +
    '</td>' +
    '<td style="padding:10pt 12pt;vertical-align:top;">' +
      '<div style="font-size:8pt;color:#555;margin-bottom:4pt;">保険医署名</div>' +
      '<div style="font-size:16pt;font-weight:700;padding:8pt 0 6pt;text-align:center;">' + escHtml(d.doctor) + '</div>' +
      '<div style="border-top:1pt solid #000;text-align:right;padding-top:2pt;font-size:8pt;color:#888;">&#12958;</div>' +
    '</td>' +
  '</tr>' +

  '</table>' +
  '</div>';
}

function escHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function calcAge(dob) {
  if (!dob) return '';
  const b = new Date(dob);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}

function printPrescription() {
  const content = document.getElementById('rxFormContent');
  if (!content) { showToast('処方箋データがありません'); return; }

  // モーダルを閉じてから印刷（モーダルが印刷範囲に入らないように）
  closeModal('prescriptionModal');

  const printArea = document.getElementById('prescriptionPrintArea');
  printArea.innerHTML = content.outerHTML;
  printArea.style.display = 'block';
  document.body.classList.add('printing-prescription');

  // 少し待ってから印刷（DOM反映待ち）
  setTimeout(() => {
    window.print();
    // 印刷ダイアログ閉じた後にクリーンアップ
    setTimeout(() => {
      document.body.classList.remove('printing-prescription');
      printArea.style.display = 'none';
    }, 300);
  }, 100);
}

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
  if (p.insurancePhoto) { document.getElementById('insurancePhotoPreview').src = p.insurancePhoto; document.getElementById('insurancePhotoPreview').style.display = 'block'; document.getElementById('insuranceUploadText2').style.display = 'none'; }
  else { document.getElementById('insurancePhotoPreview').style.display = 'none'; document.getElementById('insuranceUploadText2').style.display = ''; }
  document.getElementById('insuranceNumber').value = p.insuranceNumber || '';
  document.getElementById('insurerNumberInput').value = p.insurerNumber || '';
  document.getElementById('kouhiNumberInput').value = p.kouhiNumber || '';
  document.getElementById('incomeLevelSelect').value = p.incomeLevel || 'ippan';
  document.getElementById('insuranceRatio').value = String(p.ratio);
  if (p.insurance.includes('社保')) document.getElementById('insuranceType').value = '社保';
  else if (p.insurance.includes('国保')) document.getElementById('insuranceType').value = '国保';
  else if (p.insurance.includes('後期')) document.getElementById('insuranceType').value = '後期高齢者';
  else if (p.insurance === '公費') document.getElementById('insuranceType').value = '公費';
  document.getElementById('insuranceCalcResult').style.display = 'none';
  document.getElementById('insurancePhotoModal').classList.add('show');
  // 保険者番号が既にあれば即時判定表示
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
  p.insuranceNumber = document.getElementById('insuranceNumber').value;
  p.insurerNumber = document.getElementById('insurerNumberInput').value;
  p.kouhiNumber = document.getElementById('kouhiNumberInput').value;
  p.incomeLevel = document.getElementById('incomeLevelSelect').value;
  const type = document.getElementById('insuranceType').value;
  const ratio = parseFloat(document.getElementById('insuranceRatio').value);
  p.ratio = ratio;
  const rl = ratio===0.1?'1割':ratio===0.2?'2割':ratio===0.05?'5%':ratio===0.3?'3割':'0割';
  p.insurance = type === '後期高齢者' ? '後期高齢者' + rl : type === '公費' ? '公費' : type + rl;
  postToApi('saveInsurance', { '患者ID': p.id, '保険区分': type, '番号': p.insuranceNumber, '保険者番号': p.insurerNumber, '公費番号': p.kouhiNumber, '所得区分': p.incomeLevel, '負担割合': ratio });
  closeModal('insurancePhotoModal'); renderAllKarte(); showToast('保険証情報を更新');
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
  document.getElementById('questionnaireBody').innerHTML = '<div class="questionnaire-data" style="font-size:13px;"><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">受信時刻</span><span>' + q.receivedAt + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">主な症状</span><span>' + q.symptoms + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">発症期間</span><span>' + q.duration + '</span></div><div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">体温</span><span>' + q.temperature + '℃</span></div>' + (q.otherComplaints ? '<div class="q-row" style="padding:4px 0;"><span class="q-label" style="min-width:80px;">その他</span><span>' + q.otherComplaints + '</span></div>' : '') + '</div>';
  document.getElementById('questionnaireModal').classList.add('show');
}
function applyQuestionnaire() {
  const p = patients.find(x => x.id === currentPatientId);
  const k = karteData[currentPatientId]; const q = p.questionnaire; if (!q) return;
  if (q.symptoms && !k.chiefComplaint) { k.chiefComplaint = q.symptoms; document.getElementById('chiefComplaint').value = q.symptoms; }
  const editor = document.getElementById('findingsEditor');
  if (editor && !editor.innerText.trim()) {
    let html = '<b>[現病歴]</b><br>';
    if (q.duration) html += q.duration + '発症。<br>';
    if (q.otherComplaints) html += q.otherComplaints + '<br>';
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
    html = '<div class="form-group"><label class="form-label">紹介先医療機関</label><input type="text" class="form-input" placeholder="○○病院"></div><div class="form-group"><label class="form-label">紹介先診療科</label><input type="text" class="form-input" placeholder="内科"></div><div class="form-group"><label class="form-label">傷���名</label><input type="text" class="form-input" value="' + k.selectedDiseases.map(d=>d.name).join(', ') + '"></div><div class="form-group"><label class="form-label">紹介目的・経過</label><textarea class="form-textarea" rows="5">上記患者様を紹介申し上げます。\nご高診のほどよろしくお願い申し上げます。</textarea></div>';
  } else if (type === 'diagnosis') {
    title = '診断書';
    html = '<div class="form-group"><label class="form-label">患者氏名</label><input type="text" class="form-input" value="' + p.name + '" readonly></div><div class="form-group"><label class="form-label">傷病名</label><input type="text" class="form-input" value="' + k.selectedDiseases.map(d=>d.name).join(', ') + '"></div><div class="form-group"><label class="form-label">所��</label><textarea class="form-textarea" rows="4" placeholder="所見・経過を記載"></textarea></div>';
  } else if (type === 'prescription') {
    title = '院外処方箋';
    html = '<div class="form-group"><label class="form-label">��者 / 保険</label><input type="text" class="form-input" value="' + p.name + ' / ' + p.insurance + '" readonly></div><div class="form-group"><label class="form-label">処方内容</label><div style="background:var(--bg);padding:8px;border-radius:var(--radius-sm);font-size:12px;">';
    if (!k.prescriptions.length) html += '<div style="color:var(--text-muted);">処方なし</div>';
    else k.prescriptions.forEach(rx => { html += '<div style="padding:2px 0;">' + rx.drug.name + ' ' + rx.qty + rx.drug.unit + ' x ' + k.rxDays + '日分</div>'; });
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

// ===== Phase 2C: Exam Results & Consent =====
const EXAM_RANGES = {
  'WBC': { unit: '/μL', low: 3500, high: 9000 },
  'RBC': { unit: '万/μL', low: 380, high: 530 },
  'Hb': { unit: 'g/dL', low: 12.0, high: 17.0 },
  'Plt': { unit: '万/μL', low: 15, high: 35 },
  'CRP': { unit: 'mg/dL', low: 0, high: 0.3 },
  'HbA1c': { unit: '%', low: 4.6, high: 6.2 },
  'BS': { unit: 'mg/dL', low: 70, high: 109 },
  'BUN': { unit: 'mg/dL', low: 8, high: 20 },
  'Cr': { unit: 'mg/dL', low: 0.6, high: 1.1 },
  'AST': { unit: 'U/L', low: 10, high: 40 },
  'ALT': { unit: 'U/L', low: 5, high: 45 },
  'γ-GTP': { unit: 'U/L', low: 0, high: 75 },
  'TC': { unit: 'mg/dL', low: 120, high: 219 },
  'TG': { unit: 'mg/dL', low: 30, high: 149 },
  'UA': { unit: 'mg/dL', low: 2.5, high: 7.0 },
  'Na': { unit: 'mEq/L', low: 135, high: 145 },
  'K': { unit: 'mEq/L', low: 3.5, high: 5.0 },
  'SpO2': { unit: '%', low: 95, high: 100 },
  '尿蛋白': { unit: '', low: null, high: null },
  '尿糖': { unit: '', low: null, high: null }
};

function addExamResult() {
  const sel = document.getElementById('examResultSelect');
  const val = document.getElementById('examResultValue');
  const name = sel.value;
  const value = val.value.trim();
  if (!name || !value) { showToast('検査項目と値を入力してください'); return; }
  const k = karteData[currentPatientId];
  if (!k.examResults) k.examResults = [];
  const range = EXAM_RANGES[name] || {};
  const numVal = parseFloat(value);
  let flag = '';
  if (range.low !== null && range.high !== null && !isNaN(numVal)) {
    if (numVal < range.low) flag = 'L';
    else if (numVal > range.high) flag = 'H';
  }
  k.examResults.push({ name, value, unit: range.unit || '', flag, timestamp: new Date().toISOString() });
  sel.value = ''; val.value = '';
  renderExamResults();
  addAuditEntry('検査結果追加', name + ': ' + value + (range.unit||'') + (flag ? ' [' + flag + ']' : ''));
}

function removeExamResult(idx) {
  const k = karteData[currentPatientId];
  const removed = k.examResults.splice(idx, 1)[0];
  renderExamResults();
  addAuditEntry('検査結果削除', removed.name);
}

function renderExamResults() {
  const el = document.getElementById('examResultsList');
  if (!el) return;
  const k = karteData[currentPatientId];
  if (!k || !k.examResults || !k.examResults.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:10px;padding:2px 0;">検査結果なし</div>'; return; }
  el.innerHTML = k.examResults.map((r, i) => {
    const flagColor = r.flag === 'H' ? '#dc2626' : r.flag === 'L' ? '#2563eb' : '#059669';
    const flagBg = r.flag === 'H' ? '#fef2f2' : r.flag === 'L' ? '#eff6ff' : '#f0fdf4';
    return '<div style="display:flex;align-items:center;gap:4px;padding:2px 0;border-bottom:1px solid #f1f5f9;">' +
      '<span style="font-weight:600;min-width:50px;">' + r.name + '</span>' +
      '<span style="font-weight:700;color:' + flagColor + ';">' + r.value + '</span>' +
      '<span style="color:var(--text-muted);">' + (r.unit||'') + '</span>' +
      (r.flag ? '<span style="background:' + flagBg + ';color:' + flagColor + ';font-size:9px;padding:1px 4px;border-radius:2px;font-weight:700;">' + r.flag + '</span>' : '') +
      '<span style="flex:1"></span>' +
      '<button onclick="removeExamResult(' + i + ')" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:12px;" title="削除">&times;</button>' +
      '</div>';
  }).join('');
}

function onExamInterpretationChange() {
  const k = karteData[currentPatientId];
  if (k) k.examInterpretation = document.getElementById('examInterpretation').value;
}

function addConsentRecord(type) {
  const k = karteData[currentPatientId];
  if (!k.consentRecords) k.consentRecords = [];
  const p = patients.find(x => x.id === currentPatientId);
  k.consentRecords.push({
    type: type,
    timestamp: new Date().toISOString(),
    doctor: document.getElementById('doctorSelect') ? document.getElementById('doctorSelect').value : '不明',
    detail: '',
    agreed: true
  });
  renderConsentRecords();
  addAuditEntry('説明・同意', type + ' 記録');
}

function updateConsentDetail(idx) {
  const k = karteData[currentPatientId];
  const textarea = document.getElementById('consentDetail_' + idx);
  if (textarea && k.consentRecords[idx]) k.consentRecords[idx].detail = textarea.value;
}

function removeConsentRecord(idx) {
  const k = karteData[currentPatientId];
  const removed = k.consentRecords.splice(idx, 1)[0];
  renderConsentRecords();
  addAuditEntry('説明・同意削除', removed.type);
}

function renderConsentRecords() {
  const el = document.getElementById('consentRecordsList');
  if (!el) return;
  const k = karteData[currentPatientId];
  if (!k || !k.consentRecords || !k.consentRecords.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:10px;padding:2px 0;">記録なし</div>'; return; }
  el.innerHTML = k.consentRecords.map((c, i) => {
    const t = new Date(c.timestamp);
    return '<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;">' +
      '<div style="display:flex;align-items:center;gap:4px;">' +
      '<span style="background:#dbeafe;color:#1d4ed8;font-size:9px;padding:1px 5px;border-radius:2px;font-weight:600;">' + c.type + '</span>' +
      '<span style="color:var(--text-muted);font-size:10px;">' + t.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'}) + '</span>' +
      '<span style="color:var(--text-muted);font-size:10px;">(' + c.doctor + ')</span>' +
      '<span style="flex:1"></span>' +
      '<button onclick="removeConsentRecord(' + i + ')" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:12px;">&times;</button>' +
      '</div>' +
      '<textarea id="consentDetail_' + i + '" placeholder="説明内容の詳細..." style="width:100%;height:28px;font-size:10px;border:1px solid #e2e8f0;border-radius:3px;padding:2px 4px;margin-top:2px;resize:vertical;" oninput="updateConsentDetail(' + i + ')">' + (c.detail||'') + '</textarea>' +
      '</div>';
  }).join('');
}

// ===== Toast =====
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

// ===== ORCA設定・レセプト管理UI =====
function openOrcaSettingsModal() {
  const cfg = OrcaConnector.getConfig();
  document.getElementById('orcaEnabled').checked = cfg.enabled;
  document.getElementById('orcaHost').value = cfg.host;
  document.getElementById('orcaPort').value = cfg.port;
  document.getElementById('orcaUser').value = cfg.user;
  document.getElementById('orcaPass').value = cfg.password;
  document.getElementById('orcaFacilityCode').value = cfg.facilityCode;
  document.getElementById('orcaFacilityName').value = cfg.facilityName;
  document.getElementById('orcaPrefCode').value = cfg.prefCode;
  document.getElementById('orcaTenTable').value = cfg.tenTable;
  const now = new Date();
  document.getElementById('receiptMonth').value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  updateOrcaStatusBadge(cfg.enabled);
  document.getElementById('orcaSettingsModal').style.display = 'flex';
}

function toggleOrcaEnabled() {
  updateOrcaStatusBadge(document.getElementById('orcaEnabled').checked);
}

function updateOrcaStatusBadge(enabled) {
  const badge = document.getElementById('orcaStatusBadge');
  if (enabled) {
    badge.textContent = '有効（未検証）';
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';
  } else {
    badge.textContent = '無効（自前計算モード）';
    badge.style.background = '#f1f5f9';
    badge.style.color = '#64748b';
  }
}

function saveOrcaSettings() {
  OrcaConnector.setConfig({
    enabled: document.getElementById('orcaEnabled').checked,
    host: document.getElementById('orcaHost').value,
    port: parseInt(document.getElementById('orcaPort').value) || 8000,
    user: document.getElementById('orcaUser').value,
    password: document.getElementById('orcaPass').value,
    facilityCode: document.getElementById('orcaFacilityCode').value,
    facilityName: document.getElementById('orcaFacilityName').value,
    prefCode: document.getElementById('orcaPrefCode').value,
    tenTable: document.getElementById('orcaTenTable').value,
  });
  showToast('ORCA/レセプト設定を保存しました');
}

async function testOrcaConnection() {
  const el = document.getElementById('orcaTestResult');
  el.style.display = 'block';
  el.style.background = '#f1f5f9';
  el.style.color = '#475569';
  el.textContent = '接続テスト中...';
  // まず設定を一時適用
  saveOrcaSettings();
  try {
    const result = await OrcaConnector.testConnection();
    if (result.success) {
      el.style.background = '#dcfce7';
      el.style.color = '#16a34a';
      el.textContent = '接続成功！ ORCA応答確認済み';
      const badge = document.getElementById('orcaStatusBadge');
      badge.textContent = '接続済';
      badge.style.background = '#dcfce7';
      badge.style.color = '#16a34a';
    } else {
      el.style.background = '#fef2f2';
      el.style.color = '#dc2626';
      el.textContent = '接続失敗: ' + result.error;
    }
  } catch(e) {
    el.style.background = '#fef2f2';
    el.style.color = '#dc2626';
    el.textContent = '接続失敗: ' + e.message;
  }
}

// レセプト一覧表示
async function loadReceiptList() {
  const month = document.getElementById('receiptMonth').value;
  if (!month) return;
  const ym = month.replace('-', '');
  const el = document.getElementById('receiptList');
  try {
    const receipts = await ReceiptManager.getReceiptsByMonth(ym);
    if (!receipts.length) {
      el.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:16px;">この月のレセプトデータはありません<br><span style="font-size:10px;">「当月レセプト生成」ボタンで確定済みカルテからレセプトを自動生成</span></div>';
      return;
    }
    const totalPts = receipts.reduce((s,r) => s + r.totalPoints, 0);
    const totalBurden = receipts.reduce((s,r) => s + r.patientBurden, 0);
    const confirmedCount = receipts.filter(r => r.status === 'confirmed' || r.status === 'submitted').length;
    el.innerHTML = '<div style="display:flex;gap:12px;padding:4px 8px;margin-bottom:4px;font-size:11px;color:#475569;"><span>' + receipts.length + '件</span><span>確定: ' + confirmedCount + '件</span><span>合計: ' + totalPts.toLocaleString() + '点</span><span>負担合計: ' + totalBurden.toLocaleString() + '円</span></div>' +
      '<table style="width:100%;border-collapse:collapse;"><tr style="background:#f1f5f9;"><th style="padding:4px 8px;text-align:left;">患者</th><th style="padding:4px 8px;text-align:right;">来院回数</th><th style="padding:4px 8px;text-align:right;">合計点数</th><th style="padding:4px 8px;text-align:right;">患者負担</th><th style="padding:4px 8px;">状態</th></tr>' +
      receipts.map(r => {
        const statusColor = r.status === 'submitted' ? '#16a34a' : r.status === 'confirmed' ? '#2563eb' : '#94a3b8';
        const statusText = r.status === 'submitted' ? '提出済' : r.status === 'confirmed' ? '確定' : '下書';
        return '<tr style="border-top:1px solid #f1f5f9;cursor:pointer;" onclick="showReceiptDetail(\'' + r.id + '\')" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'"><td style="padding:4px 8px;">' + r.patientName + '</td><td style="padding:4px 8px;text-align:right;">' + r.visits.length + '回</td><td style="padding:4px 8px;text-align:right;font-weight:600;">' + r.totalPoints + '点</td><td style="padding:4px 8px;text-align:right;">' + r.patientBurden.toLocaleString() + '円</td><td style="padding:4px 8px;text-align:center;"><span style="font-size:10px;padding:1px 6px;border-radius:2px;background:' + statusColor + '22;color:' + statusColor + ';font-weight:600;">' + statusText + '</span></td></tr>';
      }).join('') + '</table>';
  } catch(e) {
    el.innerHTML = '<div style="color:#dc2626;padding:8px;">エラー: ' + e.message + '</div>';
  }
}

// 当月レセプト自動生成（デモ: 現在のkarteDataから）
async function generateMonthlyReceipts() {
  const month = document.getElementById('receiptMonth').value;
  if (!month) { showToast('レセプト月を選択してください'); return; }
  const ym = month.replace('-', '');
  let count = 0;

  for (const p of patients) {
    const k = karteData[p.id];
    if (!k || p.status !== 'done') continue;

    const receipt = ReceiptManager.createReceipt(p, ym);
    receipt.insurance.type = p.insurance.includes('社保') ? '社保' : p.insurance.includes('国保') ? '国保' : p.insurance.includes('後期') ? '後期高齢者' : '公費';
    receipt.insurance.insurerNumber = p.insurerNumber || '';
    receipt.insurance.symbolNumber = p.insuranceNumber || '';
    receipt.insurance.ratio = p.ratio;

    // 傷病名
    receipt.diseases = (k.selectedDiseases || []).map(d => ({
      code: d.code || '', name: d.name, startDate: d.startDate || '',
      endDate: d.endDate || '', outcome: d.outcome || '',
      isMain: d.isMain || false, suspected: d.status === 'suspected',
    }));

    // 来院記録
    const visit = ReceiptManager.createVisitRecord(p.visitDate || selectedDate);
    const surchargeInfo = typeof getTimeSurcharge === 'function' ? getTimeSurcharge(examStartTime) : null;
    visit.items.push(...ReceiptManager.autoCalcVisitFee(k.isFirstVisit, surchargeInfo));
    visit.items.push(...ReceiptManager.autoCalcPrescription(k, k.isFirstVisit));

    // 検査項目
    (k.selectedExams || []).forEach(exId => {
      const exInfo = typeof examItems !== 'undefined' ? examItems.find(e => e.id === exId) : null;
      if (exInfo && exInfo.points) {
        visit.items.push({ code: exId, name: exInfo.name, points: exInfo.points, class: '60', qty: 1 });
      }
    });

    receipt.visits.push(visit);
    ReceiptManager.calcReceiptTotal(receipt);
    receipt.status = 'draft';
    await ReceiptManager.saveReceipt(receipt);
    count++;
  }

  showToast(count + '件のレセプトを生成しました');
  loadReceiptList();
}

// ===== 診察確定時のレセプト自動生成 =====
async function autoGenerateReceipt(patient, karte, totalPoints, burdenAmount, surchargeInfo) {
  try {
    const visitDate = selectedDate; // 確定時点のUI上の日付を使用
    const ym = visitDate.replace(/-/g, '').substring(0, 6);
    const receiptId = 'RCP-' + patient.id + '-' + ym;

    // 既存レセプトがあれば取得（同月複数来院対応）
    let receipt = await ReceiptManager.getReceipt(receiptId);
    if (!receipt) {
      receipt = ReceiptManager.createReceipt(patient, ym);
      receipt.insurance.type = patient.insurance.includes('社保') ? '社保' : patient.insurance.includes('国保') ? '国保' : patient.insurance.includes('後期') ? '後期高齢者' : '公費';
      receipt.insurance.insurerNumber = patient.insurerNumber || '';
      receipt.insurance.symbolNumber = patient.insuranceNumber || '';
      receipt.insurance.ratio = patient.ratio;
      receipt.insurance.kouhiNumber = patient.kouhiNumber || '';
    }

    // 傷病名を更新（最新のカルテから）
    receipt.diseases = (karte.selectedDiseases || []).map(d => ({
      code: d.code || '', name: d.name, startDate: d.startDate || visitDate,
      endDate: d.endDate || '', outcome: d.outcome || '',
      isMain: d.isMain || false, suspected: d.status === 'suspected',
    }));

    // 来院記録を追加（同日重複チェック）
    const existIdx = receipt.visits.findIndex(v => v.date === visitDate);
    const visit = ReceiptManager.createVisitRecord(visitDate);
    visit.items.push(...ReceiptManager.autoCalcVisitFee(karte.isFirstVisit, surchargeInfo));
    visit.items.push(...ReceiptManager.autoCalcPrescription(karte, karte.isFirstVisit));

    // 検査項目
    (karte.selectedExams || []).forEach(exId => {
      const exInfo = typeof examItems !== 'undefined' ? examItems.find(e => e.id === exId) : null;
      if (exInfo && exInfo.points) {
        visit.items.push({ code: exId, name: exInfo.name, points: exInfo.points, class: '60', qty: 1 });
      }
    });

    // 検査判断料（血液検査があれば自動追加）
    const hasBloodTest = visit.items.some(i => i.class === '60' && i.code !== '160143810' && i.code !== '160143910');
    if (hasBloodTest) {
      const hasCBC = visit.items.some(i => i.name && (i.name.includes('血液一般') || i.name.includes('末梢血液像')));
      const hasBiochem = visit.items.some(i => i.name && (i.name.includes('AST') || i.name.includes('ALT') || i.name.includes('BUN') || i.name.includes('Cr') || i.name.includes('コレステロール') || i.name.includes('中性脂肪') || i.name.includes('尿酸') || i.name.includes('血糖') || i.name.includes('HbA1c')));
      const hasCRP = visit.items.some(i => i.name && i.name.includes('CRP'));
      if (hasCBC) visit.items.push({ code: '160144410', name: '血液学的検査判断料', points: 125, class: '60', qty: 1 });
      if (hasBiochem) visit.items.push({ code: '160144510', name: '生化学的検査(I)判断料', points: 144, class: '60', qty: 1 });
      if (hasCRP) visit.items.push({ code: '160144810', name: '免疫学的検査判断料', points: 144, class: '60', qty: 1 });
      // 採血料（静脈）
      visit.items.push({ code: '160143810', name: '採血料（静脈）', points: 40, class: '60', qty: 1 });
    }

    if (existIdx >= 0) {
      receipt.visits[existIdx] = visit; // 同日上書き
    } else {
      receipt.visits.push(visit);
    }

    ReceiptManager.calcReceiptTotal(receipt);
    receipt.status = 'draft';
    await ReceiptManager.saveReceipt(receipt);
    console.log('[Receipt] 自動生成完了: ' + receiptId + ' (' + receipt.totalPoints + '点)');
  } catch(e) {
    console.warn('[Receipt] 自動生成エラー:', e);
  }
}

// ===== レセプト詳細表示 =====
async function showReceiptDetail(receiptId) {
  const receipt = await ReceiptManager.getReceipt(receiptId);
  if (!receipt) { showToast('レセプトが見つかりません'); return; }

  const statusMap = { draft: '下書', confirmed: '確定', submitted: '提出済' };
  const statusColors = { draft: '#94a3b8', confirmed: '#2563eb', submitted: '#16a34a' };

  let html = '<div style="padding:12px;">';
  // ヘッダー
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
  html += '<div><span style="font-size:14px;font-weight:700;">' + receipt.patientName + '</span>';
  html += '<span style="color:var(--text-muted);margin-left:8px;">' + receipt.yearMonth.substring(0,4) + '年' + receipt.yearMonth.substring(4) + '月</span></div>';
  html += '<span style="padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;background:' + (statusColors[receipt.status]||'#94a3b8') + '22;color:' + (statusColors[receipt.status]||'#94a3b8') + ';">' + (statusMap[receipt.status]||receipt.status) + '</span>';
  html += '</div>';

  // 傷病名
  if (receipt.diseases.length) {
    html += '<div style="margin-bottom:8px;"><div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:2px;">傷病名</div>';
    receipt.diseases.forEach(d => {
      html += '<div style="font-size:11px;padding:1px 0;">' + d.name + (d.suspected ? '<span style="color:#dc2626;margin-left:4px;">(疑い)</span>' : '') + (d.isMain ? '<span style="color:#2563eb;margin-left:4px;">[主]</span>' : '') + '</div>';
    });
    html += '</div>';
  }

  // 来院記録
  receipt.visits.forEach((v, vi) => {
    html += '<div style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden;">';
    html += '<div style="background:#f8fafc;padding:4px 8px;font-size:11px;font-weight:600;">来院 ' + (vi+1) + ': ' + v.date + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<tr style="background:#f1f5f9;"><th style="padding:2px 6px;text-align:left;">区分</th><th style="padding:2px 6px;text-align:left;">項目</th><th style="padding:2px 6px;text-align:right;">点数</th><th style="padding:2px 6px;text-align:right;">数量</th></tr>';
    let visitTotal = 0;
    v.items.forEach(item => {
      const cls = ReceiptManager.MEDICAL_CLASSES[item.class] || { name: item.class };
      const pts = (item.points||0) * (item.qty||1);
      visitTotal += pts;
      html += '<tr style="border-top:1px solid #f1f5f9;"><td style="padding:2px 6px;color:var(--text-muted);">' + cls.name + '</td><td style="padding:2px 6px;">' + item.name + '</td><td style="padding:2px 6px;text-align:right;font-weight:600;">' + (item.points||0) + '</td><td style="padding:2px 6px;text-align:right;">' + (item.qty||1) + '</td></tr>';
    });
    html += '<tr style="border-top:2px solid #cbd5e1;"><td colspan="2" style="padding:2px 6px;font-weight:700;">小計</td><td style="padding:2px 6px;text-align:right;font-weight:700;">' + visitTotal + '点</td><td></td></tr>';
    html += '</table></div>';
  });

  // 合計
  html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #1e293b;margin-top:4px;">';
  html += '<span style="font-weight:700;">合計</span>';
  html += '<span><span style="font-weight:700;font-size:14px;">' + receipt.totalPoints + '</span>点 / 患者負担 <span style="font-weight:700;">' + receipt.patientBurden.toLocaleString() + '</span>円</span>';
  html += '</div>';

  // ボタン
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  if (receipt.status === 'draft') {
    html += '<button onclick="confirmReceipt(\'' + receiptId + '\')" style="flex:1;padding:6px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">レセプト確定</button>';
  }
  if (receipt.status === 'confirmed') {
    html += '<button onclick="revertReceiptToDraft(\'' + receiptId + '\')" style="flex:1;padding:6px;background:#f59e0b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">下書に戻す</button>';
  }
  html += '<button onclick="deleteReceipt(\'' + receiptId + '\')" style="padding:6px 12px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">削除</button>';
  html += '<button onclick="loadReceiptList()" style="padding:6px 12px;background:#64748b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">一覧に戻る</button>';
  html += '</div></div>';

  document.getElementById('receiptList').innerHTML = html;
}

// レセプト確定
async function confirmReceipt(receiptId) {
  const receipt = await ReceiptManager.getReceipt(receiptId);
  if (!receipt) return;
  if (!receipt.diseases.length) { showToast('傷病名がないためレセプトを確定できません'); return; }
  receipt.status = 'confirmed';
  await ReceiptManager.saveReceipt(receipt);
  showToast('レセプトを確定しました');
  showReceiptDetail(receiptId);
}

// レセプト下書に戻す
async function revertReceiptToDraft(receiptId) {
  const receipt = await ReceiptManager.getReceipt(receiptId);
  if (!receipt) return;
  receipt.status = 'draft';
  await ReceiptManager.saveReceipt(receipt);
  showToast('レセプトを下書に戻しました');
  showReceiptDetail(receiptId);
}

// レセプト削除
async function deleteReceipt(receiptId) {
  if (!confirm('このレセプトを削除しますか？')) return;
  try {
    await ReceiptManager.deleteReceipt(receiptId);
    showToast('レセプトを削除しました');
    loadReceiptList();
  } catch(e) {
    showToast('削除エラー: ' + e.message);
  }
}

// UKE形式エクスポート
async function exportReceiptsUKE() {
  const month = document.getElementById('receiptMonth').value;
  if (!month) { showToast('レセプト月を選択してください'); return; }
  const ym = month.replace('-', '');
  const allReceipts = await ReceiptManager.getReceiptsByMonth(ym);
  const receipts = allReceipts.filter(r => r.status === 'confirmed' || r.status === 'submitted');
  if (!receipts.length) { showToast('確定済みのレセプトがありません（下書は対象外）'); return; }

  let ukeContent = '';
  receipts.forEach(r => {
    ukeContent += ReceiptManager.exportUKE(r) + '\n';
    r.status = 'submitted';
    ReceiptManager.saveReceipt(r); // 提出済みに更新
  });

  // ダウンロード
  const blob = new Blob([ukeContent], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'receipt_' + ym + '.UKE';
  a.click();
  URL.revokeObjectURL(url);
  showToast('UKEファイルをダウンロードしました');
}

// ===== Close dropdowns =====
document.addEventListener('click', function(e) {
  if (!e.target.closest('.disease-search-wrap')) document.getElementById('diseaseResults')?.classList.remove('show');
  if (!e.target.closest('.drug-search-wrap')) document.getElementById('drugResults')?.classList.remove('show');
});

// ===== Supabase 同期 =====
let _sbClient = null;
function getSbClient() {
  if (_sbClient) return _sbClient;
  if (window.__SUPABASE_URL__ && window.__SUPABASE_ANON_KEY__ && window.supabase) {
    _sbClient = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
  }
  return _sbClient;
}

async function syncToSupabase(karteId, patientId, karteObj, status) {
  const sb = getSbClient();
  if (!sb) return;
  const p = patients.find(x => x.id === patientId);
  if (!p) return;
  const surchargeInfo = getTimeSurcharge(examStartTime);

  try {
    // 1. Upsert patient → UUIDを取得
    // 値がない項目はupsertに含めない（既存値をnullで上書きしない）
    const patRow = { clinic_id: 'nishiharu', patient_no: patientId, name: p.name };
    if (p.nameKana) patRow.name_kana = p.nameKana;
    if (p.age) patRow.age = p.age;
    const sexNorm = p.sex === '男' || p.sex === '男性' ? '男' : p.sex === '女' || p.sex === '女性' ? '女' : null;
    if (sexNorm) patRow.sex = sexNorm;
    if (p.phone) patRow.phone = p.phone;
    if (p.address) patRow.address = p.address;
    if (p.allergies && p.allergies.length) patRow.allergies = p.allergies;
    if (p.history && p.history.length) patRow.medical_history = p.history;
    if (p.insurance) patRow.insurance_type = p.insurance;
    if (p.ratio) patRow.copay_rate = p.ratio;
    if (p.insurerNumber) patRow.insurer_number = p.insurerNumber;
    if (p.kouhiNumber) patRow.kouhi_number = p.kouhiNumber;
    if (p.incomeLevel) patRow.income_level = p.incomeLevel;
    if (p.memo) patRow.memo = p.memo;
    const { data: patData, error: patErr } = await sb.from('patients').upsert(
      patRow, { onConflict: 'patient_no,clinic_id' }
    ).select('id').single();
    if (patErr || !patData) { console.warn('[SB] patient upsert failed:', patErr?.message); return; }
    const sbPatientId = patData.id;

    // 2. Upsert visit → UUIDを取得
    const { data: visitData, error: visitErr } = await sb.from('visits').upsert({
      clinic_id: 'nishiharu',
      patient_id: sbPatientId,
      visit_date: selectedDate,
      visit_time: examStartTime ? examStartTime.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'}) : null,
      doctor: document.getElementById('visitDoctor')?.value || null,
      visit_type: karteObj.isFirstVisit ? '新規' : '再診',
      status: status === '確定' ? 'completed' : 'in_progress',
      self_pay: parseInt(document.getElementById('billBurden')?.textContent?.replace(/[^0-9]/g,'')) || 0,
      revenue_points: parseInt(document.getElementById('billTotal')?.textContent) || 0,
      exam_start: examStartTime ? examStartTime.toISOString() : null
    }, { onConflict: 'patient_id,visit_date,clinic_id' }).select('id').single();
    if (visitErr || !visitData) { console.warn('[SB] visit upsert failed:', visitErr?.message); return; }
    const sbVisitId = visitData.id;

    // 3. Upsert karte
    const { error: karteErr } = await sb.from('kartes').upsert({
      visit_id: sbVisitId,
      chief_complaint: karteObj.chiefComplaint || null,
      findings_html: getEditorPlainText() || null,
      vitals_temp: parseFloat(karteObj.vitals.t) || null,
      vitals_bp_sys: parseInt(karteObj.vitals.bps) || null,
      vitals_bp_dia: parseInt(karteObj.vitals.bpd) || null,
      vitals_pulse: parseInt(karteObj.vitals.pulse) || null,
      vitals_spo2: parseInt(karteObj.vitals.spo2) || null,
      rx_days: karteObj.rxDays || 7,
      is_first_visit: karteObj.isFirstVisit || false,
      time_surcharge: surchargeInfo ? surchargeInfo.type : null
    }, { onConflict: 'visit_id' });
    if (karteErr) console.warn('[SB] karte upsert failed:', karteErr.message);

    // 4. Prescriptions (delete + re-insert)
    if (karteObj.prescriptions && karteObj.prescriptions.length > 0) {
      await sb.from('prescriptions').delete().eq('visit_id', sbVisitId);
      const rxRows = karteObj.prescriptions.map(function(rx, i) {
        return { visit_id: sbVisitId, drug_name: rx.drug.name, quantity: rx.qty, unit: rx.drug.unit || 'T', days: karteObj.rxDays, sort_order: i };
      });
      const { error: rxErr } = await sb.from('prescriptions').insert(rxRows);
      if (rxErr) console.warn('[SB] rx insert failed:', rxErr.message);
    }

    // 5. Diseases (delete + re-insert)
    if (karteObj.selectedDiseases && karteObj.selectedDiseases.length > 0) {
      await sb.from('diseases_assigned').delete().eq('visit_id', sbVisitId);
      const dRows = karteObj.selectedDiseases.map(function(d) {
        return { visit_id: sbVisitId, disease_code: d.code || null, disease_name: d.name };
      });
      const { error: dErr } = await sb.from('diseases_assigned').insert(dRows);
      if (dErr) console.warn('[SB] disease insert failed:', dErr.message);
    }

    // 6. Exams (delete + re-insert)
    if (karteObj.selectedExams && karteObj.selectedExams.length > 0) {
      await sb.from('exams_ordered').delete().eq('visit_id', sbVisitId);
      const eRows = karteObj.selectedExams.map(function(exId) {
        const exInfo = examItems.find(function(e) { return e.id === exId; });
        return { visit_id: sbVisitId, exam_code: exId, exam_name: exInfo ? exInfo.name : exId };
      });
      const { error: eErr } = await sb.from('exams_ordered').insert(eRows);
      if (eErr) console.warn('[SB] exam insert failed:', eErr.message);
    }

    console.log('[SB] sync OK: patient=' + sbPatientId + ' visit=' + sbVisitId);
  } catch (e) {
    console.error('[SB] sync error:', e);
  }
}

// ===== Init =====
document.getElementById('listDate').value = selectedDate;
renderSetOrders();
renderDiseaseQuickBtns();
renderPatientList();
loadDbData();
