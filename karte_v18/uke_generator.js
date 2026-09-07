// ===== UKEフォーマット生成器（karte_v18統合・試作版）=====
// ★試作: 傷病名は7桁レセ電コード対応。診療行為/薬価コード・算定ロジックは簡易。実提出前に要検証。
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

// ★完成形: 診療行為コード表（令和8点数はgetVisitFee/BILLING_MASTER・加算はs_procedures実コード）
const SURCHARGE_CODE = {
  '時間外': { f: '111000570', r: '112001110' },
  '休日':   { f: '111000670', r: '112001210' },
  '深夜':   { f: '111000770', r: '112001310' }
};
function surchargeCodeOf(type, isFirst) {
  const key = Object.keys(SURCHARGE_CODE).find(function (x) { return type && type.indexOf(x) !== -1; });
  const e = key ? SURCHARGE_CODE[key] : null; return e ? (isFirst ? e.f : e.r) : '9999999';
}
// 当院標準加算の名称→診療行為コード（初診/再診）
const ADDON_CODE = {
  '機能強化加算':               { f: '111013770', r: '111013770', cat: '13' },
  '外来感染対策向上加算':        { f: '111014870', r: '112024370', catF: '11', catR: '12' },
  '連携強化加算':               { f: '111014970', r: '112024470', catF: '11', catR: '12' },
  '発熱患者等対応加算':          { f: '111702970', r: '112708670', catF: '11', catR: '12' },
  '電子的診療情報連携体制整備加算': { f: '111704170', r: '112709570', catF: '11', catR: '12' },
  '外来・在宅ベースアップ評価料':  { f: '180725710', r: '180725810', cat: '80' },
  'ベースアップ評価料':          { f: '180725710', r: '180725810', cat: '80' },
  '物価対応料':                 { f: '180819910', r: '180820010', cat: '80' },
  '外来・在宅物価対応料':        { f: '180819910', r: '180820010', cat: '80' }
};
function addonOf(name, isFirst) {
  const key = Object.keys(ADDON_CODE).find(function (x) { return name && name.indexOf(x) !== -1; });
  if (!key) return { code: '9999999', cat: '13' };
  const e = ADDON_CODE[key];
  return { code: isFirst ? e.f : e.r, cat: e.cat || (isFirst ? (e.catF || '11') : (e.catR || '12')) };
}
// 傷病名→レセ電傷病名コード解決（傷病名マスタb_diseasesを利用・自動付与）
function resolveDiseaseCode(d) {
  if (d && d.code && /^\d{6,7}$/.test(d.code)) return d.code;               // 既にコード保持
  if (typeof MasterLoader !== 'undefined' && MasterLoader.searchDiseases && d && d.name) {
    const res = MasterLoader.searchDiseases(d.name, 50) || [];
    if (res.length) {
      const exact = res.find(function (x) { return x.name === d.name; });   // 完全一致優先
      if (exact) return exact.code;
      res.sort(function (a, b) { return a.name.length - b.name.length; });   // 最短=最も基本的な病名
      return res[0].code;
    }
  }
  if (d && d.code && DISEASE_CODE_MAP[d.code]) return DISEASE_CODE_MAP[d.code].code;
  return '0000999'; // 未コード化傷病名（正式プレースホルダ）
}

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
// opts.aggregate=true で「1患者＝1枚」に集約する（月次レセプトの正しい形。2026-09-07 追加）
function generateUKE(confirmedPatients, billingMonth, opts) {
  // billingMonth: 'YYYYMM' 形式
  const instCode = '1312345678'; // ダミー医療機関コード
  const instName = 'デモクリニック';
  const prefCode = '13'; // 東京

  // 社保と国保で分ける
  const shahoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance) === '1');
  const kokuhoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance) === '2');

  const results = {};

  if (shahoPatients.length > 0) {
    results.shaho = buildUkeText(shahoPatients, '1', instCode, instName, prefCode, billingMonth, opts);
  }
  if (kokuhoPatients.length > 0) {
    results.kokuho = buildUkeText(kokuhoPatients, '2', instCode, instName, prefCode, billingMonth, opts);
  }

  return results;
}

// === 1受診ぶんの算定明細（SI/IY）===
// buildUkeText から切り出した。日次でも月次集約でも同じ計算を通す。
function computeVisitItems(pd) {
  const p = pd.patient;
  const k = pd.karte;
  const isExternal = k.rxModeExternal || false;
  const isFirst = k.isFirstVisit || false;
  const hasRx = k.prescriptions && k.prescriptions.length > 0;
  // 当院標準加算を自動付与（カルテ本体recalcBillingと同じ・DB患者/前月分にも適用）
  if (typeof ensureStandardAddons === 'function') ensureStandardAddons(k, isFirst);

  const si = [];
  const iy = [];
  const exr = k.excludedBillingRows || {};
  // 基本診察料（令和8: getVisitFee）
  const vf = (typeof getVisitFee === 'function') ? getVisitFee(isFirst, pd.visitDate) : { points: isFirst ? 291 : 76 };
  if (isFirst) {
    si.push({ cat: '11', code: '111000110', points: vf.points });
  } else {
    si.push({ cat: '12', code: '112007410', points: vf.points });          // 再診料(76)
    if (!exr.gairai) si.push({ cat: '12', code: '112011010', points: 52 }); // 外来管理加算
  }
  // 時間帯加算（受付時刻から判定・夜間休日診療で重要）
  try {
    const at = p && p.arrivedAt;
    if (typeof getTimeSurcharge === 'function' && at && pd.visitDate) {
      const sc = getTimeSurcharge(new Date(pd.visitDate + 'T' + at));
      if (sc && sc.points > 0) si.push({ cat: isFirst ? '11' : '12', code: surchargeCodeOf(sc.type, isFirst), points: sc.points });
    }
  } catch (e) { /* 時刻不明はスキップ */ }
  // 処方・調剤・薬剤（recalcBilling同ロジック）
  if (hasRx) {
    const num = k.prescriptions.length;
    const maxDays = Math.max.apply(null, k.prescriptions.map(function (rx) { return rx.days || k.rxDays || 7; }));
    if (isExternal) {
      if (!exr.shohou) si.push({ cat: '80', code: num >= 7 ? '120002710' : '120002910', points: num >= 7 ? 32 : 60 }); // 処方箋料（s_procedures.json準拠: 120002710=32 / 120002910=60）
    } else {
      if (!exr.shohou) si.push({ cat: '80', code: num >= 7 ? '120002610' : '120001210', points: num >= 7 ? 29 : 42 }); // 処方料
      if (!exr.chouzai) si.push({ cat: '80', code: '120000710', points: maxDays <= 7 ? 11 : maxDays <= 14 ? 19 : maxDays <= 21 ? 25 : maxDays <= 28 ? 30 : 33 }); // 調剤料(内服)
      if (!exr.yakuzai) {
        k.prescriptions.forEach(function (rx) {
          const dCode = (rx.drug.code && /^[0-9A-Z]{9,12}$/.test(rx.drug.code)) ? rx.drug.code : ((DRUG_CODE_MAP[rx.drug.id] || {}).code || '9999999999');
          const days = rx.days || k.rxDays || 7;
          const raw = (rx.drug.price || 0) * rx.qty * days / 10;
          const yaku = Math.max(1, (typeof goshagochoNyuu === 'function') ? goshagochoNyuu(raw) : Math.round(raw));
          iy.push({ code: dCode, qty: rx.qty, points: yaku });
        });
      }
    }
  }
  // 検査
  if (k.selectedExams && !exr.exam) k.selectedExams.forEach(function (id) {
    const exi = (typeof examItems !== 'undefined' ? examItems : []).find(function (e) { return e.id === id; });
    if (exi) si.push({ cat: '60', code: exi.code || '9999999', points: exi.points });
  });
  // 追加算定（当院標準加算スタック）: 名称→診療行為実コード解決
  if (k.addedBillingItems) k.addedBillingItems.forEach(function (it) {
    const a = addonOf(it.name, isFirst);
    si.push({ cat: a.cat, code: a.code, points: it.points });
  });

  return { si: si, iy: iy, isFirst: isFirst };
}

// 同一患者の受診をまとめる（月次レセプトは 1患者＝1枚）。
// キーは患者ID（無ければ氏名+生年月日）。受診日昇順に並べる。
function groupVisitsByPatient(patientList) {
  const map = new Map();
  patientList.forEach(function (pd) {
    const p = pd.patient || {};
    const key = p.id || ((p.name || '') + '|' + (p.dob || ''));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(pd);
  });
  const groups = [];
  map.forEach(function (list) {
    list.sort(function (a, b) { return String(a.visitDate).localeCompare(String(b.visitDate)); });
    groups.push(list);
  });
  return groups;
}

function buildUkeText(patientList, reviewOrg, instCode, instName, prefCode, billingMonth, opts) {
  // ★karte_v18パーサ整合版: IR/RE/HO/SY/SI/IY/JD を正しいフィールド位置で出力。
  //   総点数(HO[5]) = SI/IY 点数の合計 → 点数検算が必ず一致する。
  // ★2026-09-07: opts.aggregate で「同一患者の同月受診を1枚に集約」する月次モードを追加。
  //   実日数・回数・算定日をまとめるので、同じ患者が月内に複数回来院しても2枚にならない。
  opts = opts || {};
  const lines = [];
  lines.push(['IR', reviewOrg, prefCode, '1', instCode, '', instName, billingMonth, '', '03-0000-9999'].join(','));

  const groups = opts.aggregate ? groupVisitsByPatient(patientList)
                                : patientList.map(function (pd) { return [pd]; });

  let seq = 1;
  for (const group of groups) {
    const head = group[0];
    const p = head.patient;
    const insurerNum = p.insurerNumber || '39130000';
    const insTypeCode = getInsuranceTypeCode(p.insurance);

    // --- 受診日ごとの算定を集計（SIは cat|code|points、IYは code|qty|points で束ねる）---
    const siMap = new Map();
    const iyMap = new Map();
    const dayList = [];
    let totalPoints = 0;

    group.forEach(function (pd) {
      const day = parseInt((pd.visitDate || '').split('-')[2], 10) || 1;
      if (dayList.indexOf(day) === -1) dayList.push(day);
      const items = computeVisitItems(pd);
      items.si.forEach(function (s) {
        const key = s.cat + '|' + s.code + '|' + s.points;
        if (!siMap.has(key)) siMap.set(key, { cat: s.cat, code: s.code, points: s.points, days: [] });
        siMap.get(key).days.push(day);
        totalPoints += s.points;
      });
      items.iy.forEach(function (x) {
        const key = x.code + '|' + x.qty + '|' + x.points;
        if (!iyMap.has(key)) iyMap.set(key, { code: x.code, qty: x.qty, points: x.points, days: [] });
        iyMap.get(key).days.push(day);
        totalPoints += x.points;
      });
    });
    dayList.sort(function (a, b) { return a - b; });

    const copay = Math.round(totalPoints * p.ratio) * 10; // 一部負担金(10円未満四捨五入)
    const jitsuNissu = dayList.length;                    // 診療実日数（集約すると受診回数）
    const maxDay = dayList[dayList.length - 1] || 1;
    const recLen = 12 + maxDay + 1;                       // 算定日フィールド: day → index 12+day

    // RE: [1]seq [2]保険種別 [3]請求年月 [4]氏名 [5]性別 [6]生年月日 [7]給付割合 [13]カルテ番号
    const re = new Array(14).fill('');
    re[0] = 'RE'; re[1] = seq; re[2] = insTypeCode; re[3] = billingMonth; re[4] = p.name;
    re[5] = sexToCode(p.sex); re[6] = dobToUke(p.dob); re[7] = Math.round((1 - p.ratio) * 100);
    re[13] = (p.id || '').replace(/\D/g, '') || String(seq);
    lines.push(re.join(','));

    // HO: [1]保険者番号 [2]記号 [3]番号 [4]実日数 [5]総点数 [6]一部負担金
    const symbol = (p.insuranceNumber || '').split('-')[0] || (p.insSymbol || '');
    const number = ((p.insuranceNumber || '').split('-')[1] || '').replace(/[()]/g, '') || (p.insNumber || '');
    lines.push(['HO', insurerNum, symbol, number, jitsuNissu, totalPoints, copay].join(','));

    // SY: [1]傷病名コード [2]開始日 [6]主病フラグ(01)
    // 要望#10: カルテで［主］を付けた傷病名を主病にする。未指定のカルテは従来どおり先頭を主病とする。
    // 集約時は同一コードの重複を除き、開始日は最も早い受診日を採る。
    const syList = [];
    const syIndex = {};
    group.forEach(function (pd) {
      const ds = pd.karte.selectedDiseases || [];
      const mainIdx = ds.findIndex(function (d) { return d && d.main; });
      const mainPos = mainIdx >= 0 ? mainIdx : 0;
      ds.forEach(function (d, di) {
        const dCode = resolveDiseaseCode(d);
        const startDate = (pd.visitDate || billingMonth + '01').replace(/-/g, '');
        if (syIndex[dCode] !== undefined) {
          const cur = syList[syIndex[dCode]];
          if (startDate < cur.start) cur.start = startDate;
          return;
        }
        syIndex[dCode] = syList.length;
        syList.push({ code: dCode, start: startDate, main: (di === mainPos) });
      });
    });
    // 主病は1つだけにする（先に立った主病を優先）
    let mainSeen = false;
    syList.forEach(function (s) {
      if (s.main && !mainSeen) { mainSeen = true; } else { s.main = false; }
    });
    if (!mainSeen && syList.length > 0) syList[0].main = true;
    syList.forEach(function (s) {
      const sy = new Array(7).fill(''); sy[0] = 'SY'; sy[1] = s.code; sy[2] = s.start; sy[6] = s.main ? '01' : '';
      lines.push(sy.join(','));
    });

    // SI: [1]診療識別 [3]コード [5]点数 [6]回数 [13..43]算定日
    siMap.forEach(function (s) {
      const rec = new Array(Math.max(recLen, 14)).fill('');
      rec[0] = 'SI'; rec[1] = s.cat; rec[3] = s.code; rec[5] = s.points; rec[6] = s.days.length;
      s.days.forEach(function (d) { rec[12 + d] = '1'; });
      lines.push(rec.join(','));
    });
    // IY: [1]診療識別(80) [3]コード [4]数量 [5]点数 [6]回数 [13..43]算定日
    iyMap.forEach(function (x) {
      const rec = new Array(Math.max(recLen, 14)).fill('');
      rec[0] = 'IY'; rec[1] = '80'; rec[3] = x.code; rec[4] = x.qty; rec[5] = x.points; rec[6] = x.days.length;
      x.days.forEach(function (d) { rec[12 + d] = '1'; });
      lines.push(rec.join(','));
    });

    // JD: [1]負担者種別 [2..32]受診日(day = i-1)
    const jd = new Array(33).fill(''); jd[0] = 'JD'; jd[1] = '1';
    dayList.forEach(function (d) { jd[d + 1] = '1'; });
    lines.push(jd.join(','));

    seq++;
  }
  lines.push('GO');
  return lines.join('\r\n');
}

// === UKEデータをsessionStorageに保存してreceipt.htmlを開く共通処理 ===
function openReceiptWithUKE(ukeData, count) {
  // sessionStorageにUKEデータを保存（receipt.html側で読み取り）
  const payload = {};
  if (ukeData.shaho)  payload.shaho  = ukeData.shaho;
  if (ukeData.kokuho) payload.kokuho = ukeData.kokuho;
  // 返戻ぶん（2026-09-07）: レセプト作成モーダルの［返戻レセプトビューアー］から渡す
  if (ukeData.shahoHenrei)  payload.shahoHenrei  = ukeData.shahoHenrei;
  if (ukeData.kokuhoHenrei) payload.kokuhoHenrei = ukeData.kokuhoHenrei;
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
