// ===== ORCA連携モジュール (orca_connector.js) =====
// 日医標準レセプトソフト API連携 + 自前レセプトデータ管理
// ORCA未導入時は自前計算、導入後はAPI連携に切り替え可能

const OrcaConnector = (() => {

  // ===== 接続設定 =====
  let config = {
    enabled: false,        // ORCA連携ON/OFF
    host: 'localhost',
    port: 8000,
    user: 'ormaster',
    password: '',
    facilityCode: '',      // 医療機関コード（7桁）
    facilityName: '西春内科・在宅クリニック',
    prefCode: '23',        // 都道府県コード（愛知）
    tenTable: '1',         // 点数表（1=医科）
  };

  function getConfig() { return { ...config }; }
  function setConfig(newConfig) { Object.assign(config, newConfig); saveConfigToStorage(); }

  function saveConfigToStorage() {
    try { localStorage.setItem('orca_config', JSON.stringify(config)); } catch(e) {}
  }
  function loadConfigFromStorage() {
    try {
      const s = localStorage.getItem('orca_config');
      if (s) Object.assign(config, JSON.parse(s));
    } catch(e) {}
  }

  // ===== API通信基盤 =====
  function apiUrl(path) {
    return 'http://' + config.host + ':' + config.port + path;
  }

  function authHeader() {
    return 'Basic ' + btoa(config.user + ':' + config.password);
  }

  async function apiRequest(method, path, body) {
    if (!config.enabled) throw new Error('ORCA連携が無効です');
    const opts = {
      method: method,
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/xml; charset=UTF-8',
      },
    };
    if (body) opts.body = body;
    const res = await fetch(apiUrl(path), opts);
    if (!res.ok) throw new Error('ORCA API Error: ' + res.status);
    const text = await res.text();
    return parseXmlResponse(text);
  }

  function parseXmlResponse(xmlStr) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    return xmlToObj(doc.documentElement);
  }

  function xmlToObj(node) {
    const obj = {};
    if (node.children.length === 0) return node.textContent || '';
    for (const child of node.children) {
      const name = child.tagName;
      const val = xmlToObj(child);
      if (obj[name]) {
        if (!Array.isArray(obj[name])) obj[name] = [obj[name]];
        obj[name].push(val);
      } else {
        obj[name] = val;
      }
    }
    return obj;
  }

  // ===== ORCA API: 患者 =====
  async function getPatient(patientId) {
    return apiRequest('GET', '/api01rv2/patientgetv2?id=' + patientId + '&format=json');
  }

  async function registerPatient(patientData) {
    const xml = buildPatientXml(patientData, '01'); // class=01: 新規
    return apiRequest('POST', '/orca12/patientmodv2?class=01', xml);
  }

  async function updatePatient(patientData) {
    const xml = buildPatientXml(patientData, '02'); // class=02: 更新
    return apiRequest('POST', '/orca12/patientmodv2?class=02', xml);
  }

  function buildPatientXml(p, cls) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <patientmodreq type="record">
    <Patient_ID type="string">${p.id || ''}</Patient_ID>
    <WholeName type="string">${p.name || ''}</WholeName>
    <WholeName_inKana type="string">${p.nameKana || ''}</WholeName_inKana>
    <BirthDate type="string">${(p.dob || '').replace(/-/g, '')}</BirthDate>
    <Sex type="string">${p.sex === '男' ? '1' : '2'}</Sex>
    <Home_Address_Information type="record">
      <Address_ZipCode type="string">${p.zip || ''}</Address_ZipCode>
      <WholeAddress1 type="string">${p.address || ''}</WholeAddress1>
      <PhoneNumber1 type="string">${p.phone || ''}</PhoneNumber1>
    </Home_Address_Information>
  </patientmodreq>
</data>`;
  }

  // ===== ORCA API: 受付 =====
  async function registerAcceptance(patientId, deptCode, doctorCode, insuranceCombi) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <acceptmodreq type="record">
    <Patient_ID type="string">${patientId}</Patient_ID>
    <Department_Code type="string">${deptCode || '01'}</Department_Code>
    <Physician_Code type="string">${doctorCode || '001'}</Physician_Code>
    <Insurance_Combination_Number type="string">${insuranceCombi || '0001'}</Insurance_Combination_Number>
    <Acceptance_Date type="string">${todayStr()}</Acceptance_Date>
    <Acceptance_Time type="string">${nowTimeStr()}</Acceptance_Time>
  </acceptmodreq>
</data>`;
    return apiRequest('POST', '/orca11/acceptmodv2?class=01', xml);
  }

  async function cancelAcceptance(patientId, acceptId) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <acceptmodreq type="record">
    <Patient_ID type="string">${patientId}</Patient_ID>
    <Acceptance_Id type="string">${acceptId}</Acceptance_Id>
    <Acceptance_Date type="string">${todayStr()}</Acceptance_Date>
  </acceptmodreq>
</data>`;
    return apiRequest('POST', '/orca11/acceptmodv2?class=02', xml);
  }

  // ===== ORCA API: 診療行為（中途データ） =====
  async function sendMedicalData(patientId, medicalItems, insuranceInfo) {
    const xml = buildMedicalXml(patientId, medicalItems, insuranceInfo);
    return apiRequest('POST', '/api21/medicalmodv2?class=01', xml);
  }

  function buildMedicalXml(patientId, items, insurance) {
    let medInfoXml = '';
    items.forEach((item, idx) => {
      medInfoXml += `
    <Medical_Information type="record">
      <Medical_Class type="string">${item.classCode}</Medical_Class>
      <Medical_Class_Number type="string">${item.classNumber || '1'}</Medical_Class_Number>`;
      (item.medications || []).forEach(med => {
        medInfoXml += `
      <Medication_info type="record">
        <Medication_Code type="string">${med.code}</Medication_Code>
        <Medication_Number type="string">${med.number || '1'}</Medication_Number>
      </Medication_info>`;
      });
      medInfoXml += `
    </Medical_Information>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <medicalmodreq type="record">
    <Patient_ID type="string">${patientId}</Patient_ID>
    <Perform_Date type="string">${todayStr()}</Perform_Date>
    <Diagnosis_Information type="record">
      <Department_Code type="string">01</Department_Code>
      <Insurance_Combination_Number type="string">${insurance?.combiNumber || '0001'}</Insurance_Combination_Number>
      ${medInfoXml}
    </Diagnosis_Information>
  </medicalmodreq>
</data>`;
  }

  // ===== ORCA API: 病名登録 =====
  async function registerDiseases(patientId, diseases) {
    const diseaseXml = diseases.map(d => `
    <Disease_Information type="record">
      <Disease_Code type="string">${d.code || ''}</Disease_Code>
      <Disease_Name type="string">${d.name}</Disease_Name>
      <Disease_StartDate type="string">${(d.startDate || '').replace(/-/g, '')}</Disease_StartDate>
      <Disease_EndDate type="string">${(d.endDate || '').replace(/-/g, '')}</Disease_EndDate>
      <Disease_OutCome type="string">${d.outcome || ''}</Disease_OutCome>
      <Disease_SuspectedFlag type="string">${d.suspected ? '1' : ''}</Disease_SuspectedFlag>
      <Disease_MainFlag type="string">${d.isMain ? '1' : ''}</Disease_MainFlag>
    </Disease_Information>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <diseasereq type="record">
    <Patient_ID type="string">${patientId}</Patient_ID>
    <Department_Code type="string">01</Department_Code>
    <Base_Month type="string">${todayStr().substring(0, 6)}</Base_Month>
    ${diseaseXml}
  </diseasereq>
</data>`;
    return apiRequest('POST', '/orca22/diseasev2', xml);
  }

  // ===== ORCA API: 請求金額シミュレーション =====
  async function simulateBilling(patientId, medicalItems) {
    const xml = buildMedicalXml(patientId, medicalItems, {});
    // acsimulatev2は medicalmodと同じデータ構造
    return apiRequest('POST', '/api01rv2/acsimulatev2?class=01', xml.replace('medicalmodreq', 'acsimulatereq'));
  }

  // ===== ORCA API: 薬剤併用禁忌チェック =====
  async function checkContraindication(medications) {
    const medXml = medications.map(m =>
      `<Medication_info type="record"><Medication_Code type="string">${m.code}</Medication_Code></Medication_info>`
    ).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <contraindicationcheckreq type="record">
    ${medXml}
  </contraindicationcheckreq>
</data>`;
    return apiRequest('POST', '/api01rv2/contraindicationcheckv2', xml);
  }

  // ===== 接続テスト =====
  async function testConnection() {
    try {
      const res = await apiRequest('POST', '/api01rv2/systeminfv2', `<?xml version="1.0" encoding="UTF-8"?><data><systeminfv2req type="record"></systeminfv2req></data>`);
      return { success: true, data: res };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  // ===== ユーティリティ =====
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  }
  function nowTimeStr() {
    const d = new Date();
    return String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0') + String(d.getSeconds()).padStart(2,'0');
  }

  // ===== 初期化 =====
  loadConfigFromStorage();

  return {
    getConfig, setConfig, testConnection,
    getPatient, registerPatient, updatePatient,
    registerAcceptance, cancelAcceptance,
    sendMedicalData, simulateBilling,
    registerDiseases, checkContraindication,
  };
})();


// ===================================================================
// レセプトデータ管理（ORCA非依存・自前計算）
// ===================================================================
const ReceiptManager = (() => {

  // ===== 診療区分マスタ（レセプト区分コード） =====
  const MEDICAL_CLASSES = {
    // 初再診
    '11': { name: '初診', category: '初再診' },
    '12': { name: '再診', category: '初再診' },
    '13': { name: '再診（同日）', category: '初再診' },
    // 医学管理
    '13': { name: '医学管理等', category: '医学管理' },
    '14': { name: '在宅医療', category: '在宅' },
    // 投薬
    '21': { name: '内服薬剤', category: '投薬' },
    '22': { name: '頓服薬剤', category: '投薬' },
    '23': { name: '外用薬剤', category: '投薬' },
    '25': { name: '処方料', category: '投薬' },
    '26': { name: '麻毒', category: '投薬' },
    '27': { name: '調剤料（内服）', category: '投薬' },
    '28': { name: '調剤料（外用）', category: '投薬' },
    '29': { name: '調基', category: '投薬' },
    // 注射
    '31': { name: '皮下筋注', category: '注射' },
    '32': { name: '静注', category: '注射' },
    '33': { name: '点滴', category: '注射' },
    // 処置
    '40': { name: '処置', category: '処置' },
    // 手術
    '50': { name: '手術', category: '手術' },
    // 検査
    '60': { name: '検査', category: '検査' },
    '64': { name: '病理', category: '検査' },
    // 画像
    '70': { name: '画像診断', category: '画像' },
    // その他
    '80': { name: 'その他', category: 'その他' },
    '90': { name: '入院', category: '入院' },
  };

  // ===== 主要点数マスタ（よく使う項目） =====
  const POINT_MASTER = {
    // 初再診
    '111000110': { name: '初診料', points: 291, class: '11' },
    '112015770': { name: '妊婦初診料', points: 291, class: '11' },
    '112011010': { name: '再診料', points: 75, class: '12' },
    '112015870': { name: '妊婦再診料', points: 75, class: '12' },
    '112007410': { name: '外来管理加算', points: 52, class: '12' },
    '112011810': { name: '明細書発行体制等加算', points: 1, class: '12' },
    '112003910': { name: '時間外加算（初診）', points: 85, class: '11' },
    '112004010': { name: '休日加算（初診）', points: 250, class: '11' },
    '112004110': { name: '深夜加算（初診）', points: 480, class: '11' },
    '112004210': { name: '時間外加算（再診）', points: 65, class: '12' },
    '112004310': { name: '休日加算（再診）', points: 190, class: '12' },
    '112004410': { name: '深夜加算（再診）', points: 480, class: '12' },
    '112015010': { name: '夜間・早朝等加算', points: 50, class: '12' },

    // 医学管理
    '113001610': { name: '特定疾患療養管理料（診療所）', points: 225, class: '13' },
    '113006010': { name: '薬剤情報提供料', points: 10, class: '13' },

    // 投薬
    '120002270': { name: '処方料（その他 7種類以上）', points: 29, class: '25' },
    '120002370': { name: '処方料（その他 6種類以下）', points: 42, class: '25' },
    '120003070': { name: '処方箋料', points: 68, class: '25' },
    '120003170': { name: '処方箋料（7種類以上）', points: 40, class: '25' },
    '120001010': { name: '調剤料（内服1剤 14日以下）', points: 9, class: '27' },
    '120001110': { name: '調剤料（内服1剤 15-21日）', points: 6, class: '27' },
    '120001210': { name: '調剤料（内服1剤 22-30日）', points: 4, class: '27' },
    '120001310': { name: '調剤料（内服1剤 31日以上）', points: 1, class: '27' },
    '120001510': { name: '調剤料（外用）', points: 8, class: '28' },
    '120001410': { name: '調剤料（頓服）', points: 21, class: '27' },
    '120004010': { name: '調剤技術基本料', points: 14, class: '29' },

    // 検査
    '160000310': { name: '血液一般', points: 21, class: '60' },
    '160001010': { name: '末梢血液像', points: 25, class: '60' },
    '160002210': { name: 'CRP', points: 16, class: '60' },
    '160003110': { name: 'HbA1c', points: 49, class: '60' },
    '160007210': { name: 'GOT(AST)', points: 17, class: '60' },
    '160007310': { name: 'GPT(ALT)', points: 17, class: '60' },
    '160007410': { name: 'γ-GTP', points: 11, class: '60' },
    '160003910': { name: 'BUN(尿素窒素)', points: 11, class: '60' },
    '160004010': { name: 'クレアチニン', points: 11, class: '60' },
    '160004310': { name: '尿酸', points: 11, class: '60' },
    '160019810': { name: '血糖', points: 11, class: '60' },
    '160004610': { name: '総コレステロール', points: 17, class: '60' },
    '160004810': { name: '中性脂肪', points: 11, class: '60' },
    '160005010': { name: 'HDLコレステロール', points: 17, class: '60' },
    '160005110': { name: 'LDLコレステロール', points: 18, class: '60' },
    '160005410': { name: 'Na/K/Cl', points: 11, class: '60' },
    '160017010': { name: '尿一般（定性半定量）', points: 26, class: '60' },
    '160143810': { name: '採血料（静脈）', points: 40, class: '60' },
    '160143910': { name: '採血料（その他）', points: 6, class: '60' },
    '160144410': { name: '血液学的検査判断料', points: 125, class: '60' },
    '160144510': { name: '生化学的検査(I)判断料', points: 144, class: '60' },
    '160144610': { name: '生化学的検査(II)判断料', points: 144, class: '60' },
    '160144810': { name: '免疫学的検査判断料', points: 144, class: '60' },

    // 画像
    '170000410': { name: '胸部X線（単純1方向）', points: 210, class: '70' },
    '170001110': { name: '腹部X線（単純）', points: 210, class: '70' },
    '170025010': { name: 'X線診断料', points: 85, class: '70' },
    '170023810': { name: '超音波検査（腹部）', points: 530, class: '70' },
    '170025110': { name: '超音波検査判断料', points: 350, class: '70' },
    '170029210': { name: 'CT撮影（16列以上64列未満）', points: 900, class: '70' },
    '170029310': { name: 'CT診断料', points: 450, class: '70' },

    // 処置
    '140000310': { name: '創傷処置（100cm2未満）', points: 55, class: '40' },
    '140000410': { name: '創傷処置（100-500cm2）', points: 60, class: '40' },
    '140002010': { name: '消炎鎮痛等処置', points: 35, class: '40' },
    '140009010': { name: 'ネブライザー', points: 12, class: '40' },
    '140000810': { name: '熱傷処置（100cm2未満）', points: 147, class: '40' },
    '140001010': { name: '耳処置', points: 27, class: '40' },
    '140001210': { name: '鼻処置', points: 14, class: '40' },

    // 在宅医療
    '114000110': { name: '往診料', points: 720, class: '14' },
    '114000210': { name: '在宅患者訪問診療料(I)', points: 888, class: '14' },
    '114000310': { name: '在宅患者訪問診療料(II)', points: 884, class: '14' },
    '114001010': { name: '在宅時医学総合管理料（月2回以上・単一）', points: 4600, class: '14' },
    '114001110': { name: '在宅時医学総合管理料（月2回以上・複数）', points: 3780, class: '14' },
    '114001210': { name: '施設入居時等医学総合管理料（月2回以上）', points: 3448, class: '14' },
    '114002410': { name: '在宅自己注射指導管理料', points: 750, class: '14' },
    '114003010': { name: '在宅酸素療法指導管理料', points: 2400, class: '14' },
    '114004010': { name: '居宅療養管理指導費(I)', points: 298, class: '14' },

    // 注射
    '130000110': { name: '皮内・皮下及び筋肉内注射', points: 22, class: '31' },
    '130000210': { name: '静脈内注射', points: 34, class: '32' },
    '130000310': { name: '点滴注射（500mL以上）', points: 99, class: '33' },
    '130000410': { name: '点滴注射（500mL未満）', points: 49, class: '33' },
  };

  // ===== レセプトデータ構造 =====
  // 1件のレセプト = 1患者×1月分
  function createReceipt(patient, yearMonth) {
    return {
      id: 'RCP-' + patient.id + '-' + yearMonth,
      yearMonth: yearMonth,       // YYYYMM
      patientId: patient.id,
      patientName: patient.name,
      patientDob: patient.dob,
      patientSex: patient.sex,
      insurance: {
        type: '',                 // 社保/国保/後期高齢者/公費
        insurerNumber: '',        // 保険者番号（8桁）
        symbolNumber: '',         // 記号・番号
        ratio: patient.ratio,     // 負担割合
        kouhiNumber: '',          // 公費受給者番号
      },
      facility: {
        code: OrcaConnector.getConfig().facilityCode || '',
        name: OrcaConnector.getConfig().facilityName || '',
        prefCode: OrcaConnector.getConfig().prefCode || '23',
        tenTable: OrcaConnector.getConfig().tenTable || '1',
      },
      diseases: [],               // 傷病名一覧
      visits: [],                 // 来院日ごとの診療行為
      totalPoints: 0,
      patientBurden: 0,
      status: 'draft',            // draft/confirmed/submitted
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // 来院1日分のデータ
  function createVisitRecord(date) {
    return {
      date: date,
      items: [],                  // { code, name, points, class, qty, days }
      totalPoints: 0,
    };
  }

  // ===== 点数自動計算 =====
  function calcVisitPoints(visit) {
    let total = 0;
    visit.items.forEach(item => {
      const pts = item.points || 0;
      const qty = item.qty || 1;
      total += pts * qty;
    });
    visit.totalPoints = total;
    return total;
  }

  function calcReceiptTotal(receipt) {
    let total = 0;
    receipt.visits.forEach(v => { total += calcVisitPoints(v); });
    receipt.totalPoints = total;
    receipt.patientBurden = Math.floor(total * 10 * receipt.insurance.ratio);
    // 10円未満四捨五入
    receipt.patientBurden = Math.round(receipt.patientBurden / 10) * 10;
    return total;
  }

  // ===== 院内処方の自動算定 =====
  function autoCalcPrescription(karteData, isFirstVisit) {
    const items = [];
    const rxCount = karteData.prescriptions?.length || 0;
    if (rxCount === 0) return items;

    // 処方料
    if (rxCount >= 7) {
      items.push({ code: '120002270', name: '処方料（7種類以上）', points: 29, class: '25', qty: 1 });
    } else {
      items.push({ code: '120002370', name: '処方料（6種類以下）', points: 42, class: '25', qty: 1 });
    }

    // 調剤料（内服・外用・頓服）
    const days = karteData.rxDays || 7;
    let chouzaiPoints = 9; // default: 14日以下
    if (days > 30) chouzaiPoints = 1;
    else if (days > 21) chouzaiPoints = 4;
    else if (days > 14) chouzaiPoints = 6;
    items.push({ code: '120001010', name: '調剤料（内服）', points: chouzaiPoints, class: '27', qty: 1 });

    // 調剤技術基本料
    items.push({ code: '120004010', name: '調剤技術基本料', points: 14, class: '29', qty: 1 });

    // 薬剤料（薬価→点数変換: 15円以下=1点、以降10円=1点）
    let totalDrugPrice = 0;
    karteData.prescriptions.forEach(rx => {
      const price = (rx.drug.price || 0) * (rx.qty || 1) * days;
      totalDrugPrice += price;
    });
    const drugPoints = Math.ceil(totalDrugPrice / 10); // 五捨五超入
    if (drugPoints > 0) {
      items.push({ code: 'DRUG', name: '薬剤料', points: drugPoints, class: '21', qty: 1 });
    }

    return items;
  }

  // ===== 初再診料の自動算定 =====
  function autoCalcVisitFee(isFirstVisit, surchargeInfo) {
    const items = [];
    if (isFirstVisit) {
      items.push({ code: '111000110', name: '初診料', points: 291, class: '11', qty: 1 });
    } else {
      items.push({ code: '112011010', name: '再診料', points: 75, class: '12', qty: 1 });
      items.push({ code: '112007410', name: '外来管理加算', points: 52, class: '12', qty: 1 });
    }

    // 時間外加算
    if (surchargeInfo) {
      const codeMap = {
        '時間外': isFirstVisit ? '112003910' : '112004210',
        '休日': isFirstVisit ? '112004010' : '112004310',
        '深夜': isFirstVisit ? '112004110' : '112004410',
        '夜間・早朝等': '112015010',
      };
      const code = codeMap[surchargeInfo.type];
      if (code) {
        const master = POINT_MASTER[code];
        items.push({ code: code, name: master?.name || surchargeInfo.type + '加算', points: surchargeInfo.points, class: isFirstVisit ? '11' : '12', qty: 1 });
      }
    }

    return items;
  }

  // ===== UKE(レセプト電算)形式出力 =====
  // 医科入院外レセプトの電子レセプト（UKE形式）
  function exportUKE(receipt) {
    const lines = [];
    const ym = receipt.yearMonth;
    const ins = receipt.insurance;

    // IR: 医療機関情報レコード
    lines.push('IR,' + receipt.facility.tenTable + ',' + receipt.facility.prefCode + ',' +
      receipt.facility.code + ',,,' + receipt.facility.name + ',,,,,' + ym + ',');

    // RE: レセプト共通レコード
    const reType = ins.type === '社保' ? '1112' : ins.type === '国保' ? '1122' : '1132';
    lines.push('RE,' + reType + ',' + receipt.patientId + ',,,' +
      receipt.patientName + ',' + receipt.patientSex + ',' +
      (receipt.patientDob || '').replace(/-/g, '') + ',,,,,,');

    // HO: 保険者レコード
    lines.push('HO,' + ins.insurerNumber + ',' + ins.symbolNumber + ',,,,');

    // SY: 傷病名レコード
    receipt.diseases.forEach((d, i) => {
      const mainFlag = d.isMain ? '01' : '';
      const startDate = (d.startDate || '').replace(/-/g, '');
      const outcome = d.outcome || '';
      lines.push('SY,' + (d.code || '') + ',' + d.name + ',' + mainFlag + ',' + startDate + ',' + outcome + ',');
    });

    // SI: 診療行為レコード（来院日ごと）
    receipt.visits.forEach(visit => {
      const vd = visit.date.replace(/-/g, '').substring(4); // MMDD
      visit.items.forEach(item => {
        if (item.code === 'DRUG') return; // 薬剤は別レコード
        lines.push('SI,' + (item.class || '80') + ',' + item.code + ',' + (item.qty || 1) + ',' + vd + ',');
      });
    });

    // IY: 医薬品レコード（薬剤料）
    receipt.visits.forEach(visit => {
      const vd = visit.date.replace(/-/g, '').substring(4);
      visit.items.filter(i => i.class === '21' || i.class === '22' || i.class === '23').forEach(item => {
        lines.push('IY,' + item.class + ',' + item.code + ',' + (item.qty || 1) + ',' + vd + ',');
      });
    });

    // GO: 合計レコード
    lines.push('GO,' + receipt.totalPoints + ',' + receipt.patientBurden + ',');

    return lines.join('\n');
  }

  // ===== IndexedDB保存 =====
  const DB_NAME = 'ReceiptDB';
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('receipts')) {
          const store = db.createObjectStore('receipts', { keyPath: 'id' });
          store.createIndex('yearMonth', 'yearMonth', { unique: false });
          store.createIndex('patientId', 'patientId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveReceipt(receipt) {
    receipt.updatedAt = new Date().toISOString();
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put(receipt);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getReceipt(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readonly');
      const req = tx.objectStore('receipts').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getReceiptsByMonth(yearMonth) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readonly');
      const idx = tx.objectStore('receipts').index('yearMonth');
      const req = idx.getAll(yearMonth);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getReceiptsByPatient(patientId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readonly');
      const idx = tx.objectStore('receipts').index('patientId');
      const req = idx.getAll(patientId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteReceipt(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    MEDICAL_CLASSES, POINT_MASTER,
    createReceipt, createVisitRecord,
    calcVisitPoints, calcReceiptTotal,
    autoCalcPrescription, autoCalcVisitFee,
    exportUKE,
    saveReceipt, getReceipt, getReceiptsByMonth, getReceiptsByPatient,
    deleteReceipt,
  };
})();
