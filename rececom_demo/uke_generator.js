// ===== UKEフォーマット生成器 (rececom_demo用) =====
// カルテ確定データからRECEIPTC.UKE形式テキストを生成する
//
// ■ 現在: rececom_demoのダミー患者データ（5名）から生成
// ■ 将来: ORCAレセコン連携API or 日医標準レセプトソフトからCSV/UKE取得
//   - ORCA API: /api01rv2/receiptdatamod（レセプトデータ取得）
//   - 日レセオンライン請求: RECEIPTC.UKE を /ORCA/receipt/ に出力
//   - 電子カルテ→ORCA→審査支払機関 のフローでUKEが自動生成される
//   - 本デモでは、電子カルテ側でダミーUKEを生成してフローを再現

// 傷病名コード辞書（ICD10→レセプト電算コード近似マッピング）
const DISEASE_CODE_MAP = {
  'I10':   { code: '8830100', name: '高血圧症' },
  'E119':  { code: '2500021', name: '2型糖尿病' },
  'E785':  { code: '2720010', name: '脂質異常症' },
  'J069':  { code: '4610024', name: '急性上気道感染症' },
  'J00':   { code: '4600006', name: '急性鼻咽頭炎' },
  'J039':  { code: '4630001', name: '急性扁桃炎' },
  'J209':  { code: '4660014', name: '急性気管支炎' },
  'J304':  { code: '4770011', name: 'アレルギー性鼻炎' },
  'J459':  { code: '4939006', name: '喘息' },
  'K529':  { code: '5580002', name: '急性胃腸炎' },
  'K21':   { code: '5301007', name: '胃食道逆流症' },
  'K2900': { code: '5350019', name: '急性胃炎' },
  'G439':  { code: '3460012', name: '片頭痛' },
  'M545':  { code: '7245009', name: '腰痛症' },
  'R509':  { code: '7800001', name: '発熱' },
  'N390':  { code: '5950001', name: '膀胱炎' },
  'L300':  { code: '6929001', name: '湿疹' },
  'B349':  { code: '0790009', name: 'ウイルス感染症' },
  'R05':   { code: '7860006', name: '咳嗽' },
  'U071':  { code: '8849999', name: 'COVID-19' },
};

// 診療行為コード辞書（簡易）
const PROCEDURE_CODE_MAP = {
  'shoshin':     { code: '111000110', name: '初診料', category: '11' },
  'saishin':     { code: '112007410', name: '再診料', category: '12' },
  'gairai':      { code: '112011010', name: '外来管理加算', category: '12' },
  'shohou':      { code: '120002510', name: '処方料（その他）', category: '80' },
  'shohou_gai':  { code: '120001110', name: '処方箋料', category: '80' },
  'chouzai':     { code: '800000001', name: '調剤料（内服）', category: '80' },
};

// 薬品→薬価基準コード近似
const DRUG_CODE_MAP = {
  'amlodipine5':       { code: '6171070F1020', name: 'アムロジピン錠5mg' },
  'amlodipine2.5':     { code: '6171070F1010', name: 'アムロジピン錠2.5mg' },
  'metformin500':      { code: '3962001F2040', name: 'メトホルミン錠500mg' },
  'metformin250':      { code: '3962001F2020', name: 'メトホルミン錠250mg' },
  'atorvastatin10':    { code: '2189015F1020', name: 'アトルバスタチン錠10mg' },
  'atorvastatin5':     { code: '2189015F1010', name: 'アトルバスタチン錠5mg' },
  'montelukast10':     { code: '4490027F1020', name: 'モンテルカスト錠10mg' },
  'fexofenadine60':    { code: '4490025F1020', name: 'フェキソフェナジン錠60mg' },
  'loxoprofen60':      { code: '1149019C1149', name: 'ロキソプロフェン錠60mg' },
  'acetaminophen200':  { code: '1141007F1030', name: 'アセトアミノフェン錠200mg' },
  'acetaminophen500':  { code: '1141007F1050', name: 'アセトアミノフェン錠500mg' },
  'rebamipide100':     { code: '2329024F1020', name: 'レバミピド錠100mg' },
  'lansoprazole15':    { code: '2329027F2010', name: 'ランソプラゾールOD錠15mg' },
  'domperidone10':     { code: '2399009F1030', name: 'ドンペリドン錠10mg' },
  'loperamide1':       { code: '2319001F1010', name: 'ロペラミド錠1mg' },
  'carbocisteine500':  { code: '2233005F1260', name: 'カルボシステイン錠500mg' },
  'dextromethorphan15':{ code: '2229009F1010', name: 'デキストロメトルファン錠15mg' },
  'tranexamic250':     { code: '3327002F1100', name: 'トラネキサム酸錠250mg' },
  'prednisolone5':     { code: '2456001F1135', name: 'プレドニゾロン錠5mg' },
  'losartan50':        { code: '2149040F1020', name: 'ロサルタンカリウム錠50mg' },
};

// 保険種別コード
function getInsuranceTypeCode(insurance) {
  if (insurance.includes('後期高齢者')) return '39'; // 後期高齢者
  if (insurance.includes('社保'))       return '06'; // 社保本人
  if (insurance.includes('国保'))       return '05'; // 国保
  if (insurance.includes('乳幼児'))     return '06'; // 社保扱い（公費併用）
  return '06';
}

// 審査機関コード（1=社保, 2=国保）
function getReviewOrg(insurance) {
  if (insurance.includes('国保')) return '2';
  return '1'; // 社保・後期高齢者・その他
}

// 生年月日→UKE形式（YYYYMMDD）
function dobToUke(dob) {
  return dob.replace(/-/g, '');
}

// 性別コード
function sexToCode(sex) {
  return sex === '男' ? '1' : '2';
}

// 確定済みカルテデータからUKEテキストを生成
function generateUKE(confirmedPatients, billingMonth) {
  // billingMonth: 'YYYYMM' 形式
  const lines = [];
  const instCode = '1312345678'; // ダミー医療機関コード
  const instName = 'デモクリニック';
  const prefCode = '13'; // 東京

  // 社保と国保で分ける
  const shahoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance) === '1');
  const kokuhoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance) === '2');

  const results = {};

  if (shahoPatients.length > 0) {
    results.shaho = buildUkeText(shahoPatients, '1', instCode, instName, prefCode, billingMonth);
  }
  if (kokuhoPatients.length > 0) {
    results.kokuho = buildUkeText(kokuhoPatients, '2', instCode, instName, prefCode, billingMonth);
  }

  return results;
}

function buildUkeText(patientList, reviewOrg, instCode, instName, prefCode, billingMonth) {
  const lines = [];

  // IR: 医療機関情報レコード
  // IR,審査機関,都道府県,点数表,医療機関コード,,医療機関名,請求年月,,電話番号
  lines.push('IR,' + reviewOrg + ',' + prefCode + ',1,' + instCode + ',,' + instName + ',' + billingMonth + ',,03-0000-9999');

  let seq = 1;
  for (const pd of patientList) {
    const p = pd.patient;
    const k = pd.karte;
    const insurerNum = p.insurerNumber || '39130000';
    const insTypeCode = getInsuranceTypeCode(p.insurance);
    const visitDay = parseInt((pd.visitDate || '').split('-')[2]) || 1;

    // 点数計算
    const isExternal = k.rxModeExternal || false;
    const isFirst = k.isFirstVisit || false;
    const visitPoints = isFirst ? 291 : 75;
    const gairaiPoints = isFirst ? 0 : 52;
    let shohouPoints = 0, chouzaiPoints = 0, yakuzaiPoints = 0;
    if (k.prescriptions.length > 0) {
      if (isExternal) {
        shohouPoints = k.prescriptions.length >= 7 ? 40 : 68;
      } else {
        shohouPoints = k.prescriptions.length >= 7 ? 29 : 42;
        const maxDays = Math.max(...k.prescriptions.map(rx => rx.days || k.rxDays || 7));
        chouzaiPoints = maxDays<=7?11:maxDays<=14?19:maxDays<=21?25:maxDays<=28?30:33;
        let yakuzaiRaw = 0;
        k.prescriptions.forEach(rx => { yakuzaiRaw += rx.drug.price * rx.qty * (rx.days || k.rxDays || 7); });
        yakuzaiPoints = Math.round(yakuzaiRaw / 10);
      }
    }
    let examPoints = 0;
    if (k.selectedExams) k.selectedExams.forEach(id => {
      const ex = (typeof examItems !== 'undefined' ? examItems : []).find(e => e.id === id);
      if (ex) examPoints += ex.points;
    });
    let extraPoints = 0;
    if (k.addedBillingItems) k.addedBillingItems.forEach(it => extraPoints += it.points);
    const totalPoints = visitPoints + gairaiPoints + shohouPoints + chouzaiPoints + yakuzaiPoints + examPoints + extraPoints;
    const copay = Math.round(totalPoints * 10 * p.ratio);

    // RE: レセプト共通レコード
    // RE,seq,保険種別,請求年月,氏名,性別,生年月日,給付割合,,,,,カルテ番号,総点数
    const reFields = ['RE', seq, insTypeCode, billingMonth, p.name, sexToCode(p.sex), dobToUke(p.dob), Math.round((1-p.ratio)*100), '','','','', p.id.replace('D',''), totalPoints];
    lines.push(reFields.join(','));

    // HO: 保険者レコード
    const symbol = (p.insuranceNumber || '').split('-')[0] || '';
    const number = (p.insuranceNumber || '').split('-')[1] || '';
    lines.push('HO,' + insurerNum + ',' + symbol + ',' + number + ',,' + copay);

    // SY: 傷病名レコード
    if (k.selectedDiseases && k.selectedDiseases.length > 0) {
      k.selectedDiseases.forEach((d, di) => {
        const mapped = DISEASE_CODE_MAP[d.code] || {};
        const dCode = mapped.code || '9999999';
        const startDate = (pd.visitDate || billingMonth + '01').replace(/-/g, '');
        const isPrimary = di === 0 ? '01' : '';
        lines.push('SY,' + dCode + ',' + startDate + ',,' + ',,,' + isPrimary);
      });
    }

    // SI: 診療行為レコード
    // 初診/再診
    if (isFirst) {
      lines.push('SI,11,,,' + PROCEDURE_CODE_MAP.shoshin.code + ',,' + visitPoints + ',1');
    } else {
      lines.push('SI,12,,,' + PROCEDURE_CODE_MAP.saishin.code + ',,' + gairaiPoints + visitPoints + ',1');
      if (gairaiPoints > 0) {
        lines.push('SI,12,,,' + PROCEDURE_CODE_MAP.gairai.code + ',,' + gairaiPoints + ',1');
      }
    }

    // 処方・調剤
    if (k.prescriptions.length > 0) {
      if (isExternal) {
        lines.push('SI,80,,,' + PROCEDURE_CODE_MAP.shohou_gai.code + ',,' + shohouPoints + ',1');
      } else {
        lines.push('SI,80,,,' + PROCEDURE_CODE_MAP.shohou.code + ',,' + shohouPoints + ',1');
        if (chouzaiPoints > 0) {
          lines.push('SI,80,,,' + PROCEDURE_CODE_MAP.chouzai.code + ',,' + chouzaiPoints + ',1');
        }
      }
    }

    // IY: 薬品レコード
    if (!isExternal && k.prescriptions.length > 0) {
      k.prescriptions.forEach(rx => {
        const drugInfo = DRUG_CODE_MAP[rx.drug.id] || {};
        const dCode = drugInfo.code || rx.drug.id;
        const days = rx.days || k.rxDays || 7;
        const pointsPerDay = Math.round(rx.drug.price * rx.qty * 10) / 100;
        lines.push('IY,' + dCode + ',' + rx.qty + ',' + Math.round(rx.drug.price * rx.qty / 10 * days));
      });
    }

    // JD: 受診日レコード（1-31日のフィールド）
    const jdFields = new Array(32).fill('');
    jdFields[0] = 'JD';
    jdFields[visitDay] = '1';
    lines.push(jdFields.join(','));

    seq++;
  }

  // GO: 終了レコード
  lines.push('GO');

  return lines.join('\r\n');
}

// === UKEデータをsessionStorageに保存してreceipt.htmlを開く共通処理 ===
function openReceiptWithUKE(ukeData, count) {
  // sessionStorageにUKEデータを保存（receipt.html側で読み取り）
  const payload = {};
  if (ukeData.shaho)  payload.shaho  = ukeData.shaho;
  if (ukeData.kokuho) payload.kokuho = ukeData.kokuho;
  localStorage.setItem('pendingUKE', JSON.stringify(payload));

  // receipt.htmlを開く
  const w = window.open('receipt.html', '_blank');
  if (!w) {
    // ポップアップブロック時はリンクを表示
    showToast('ポップアップがブロックされました。右クリック→新しいタブで receipt.html を開いてください');
  } else {
    showToast('UKEデータ生成完了（' + count + '名）→ レセプト点検を開きました');
  }
}

// === UI統合: 確定済み患者からUKEを生成してreceipt.htmlに渡す ===
function generateAndOpenReceipt() {
  // 確定済み患者を収集
  const confirmed = [];
  const today = selectedDate || new Date().toISOString().split('T')[0];
  const billingMonth = today.replace(/-/g, '').substring(0, 6);

  const todayPatients = getPatientsForDate ? getPatientsForDate(today) : patients;
  for (const p of todayPatients) {
    const k = karteData[p.id];
    if (!k) continue;
    // 確定済み（done）または処方データがある患者を含める
    if (p.status === 'done' || k.prescriptions.length > 0 || (k.selectedDiseases && k.selectedDiseases.length > 0)) {
      confirmed.push({ patient: p, karte: k, visitDate: today });
    }
  }

  if (confirmed.length === 0) {
    showToast('UKE生成対象の患者がいません（カルテを確定してください）');
    return;
  }

  const ukeData = generateUKE(confirmed, billingMonth);
  openReceiptWithUKE(ukeData, confirmed.length);
}

// === デモ用: 全患者のダミーカルテを自動確定してUKE生成 ===
function generateDemoUKE() {
  // 各患者に前回処方データをセットして疑似確定
  const confirmed = [];
  const today = selectedDate || new Date().toISOString().split('T')[0];
  const billingMonth = today.replace(/-/g, '').substring(0, 6);

  for (const p of patients) {
    let k = karteData[p.id];
    if (!k) continue;

    // 前回処方を適用（未入力の場合）
    if (k.prescriptions.length === 0 && p.prevRx && p.prevRx.length > 0) {
      p.prevRx.forEach(rx => {
        const d = drugs.find(x => x.id === rx.drugId);
        if (d) k.prescriptions.push({ drug: d, qty: rx.qty, days: p.prevDays || 7, note: '' });
      });
      k.rxDays = p.prevDays || 7;
    }

    // 前回の傷病名を適用（未入力の場合）
    if ((!k.selectedDiseases || k.selectedDiseases.length === 0) && p.history && p.history.length > 0) {
      k.selectedDiseases = p.history.map(h => {
        const info = diseases.find(d => d.name === h);
        return { name: h, code: info ? info.code : '', status: 'confirmed' };
      });
    }

    confirmed.push({ patient: p, karte: k, visitDate: today });
  }

  if (confirmed.length === 0) {
    showToast('患者データがありません');
    return;
  }

  const ukeData = generateUKE(confirmed, billingMonth);
  openReceiptWithUKE(ukeData, confirmed.length);
}
