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

// 審査機関コード（1=社保＝支払基金, 2=国保連合会）
//   保険者番号で決める: 6桁・法別00/67＝国民健康保険、39＝後期高齢者 → どちらも国保連合会。
//   保険者番号が無いときだけ保険の表示名で判断する。
function getReviewOrg(insurance, insurerNumber) {
  const num = (typeof ukeDigits === 'function') ? ukeDigits(insurerNumber) : String(insurerNumber || '').replace(/\D/g, '');
  if (num) {
    if (num.length === 6) return '2';
    const law = num.slice(0, 2);
    if (num.length === 8 && (law === '00' || law === '67' || law === '39')) return '2';
    return '1';
  }
  const ins = String(insurance || '');
  if (ins.includes('国保') || ins.includes('後期')) return '2';
  return '1';
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
  const shahoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance, p.patient.insurerNumber) === '1');
  const kokuhoPatients = confirmedPatients.filter(p => getReviewOrg(p.patient.insurance, p.patient.insurerNumber) === '2');

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
  // 工程4（2026-09-24）: 基準版の画面で保存した記録は、保存された行為・薬剤料の一覧をそのまま明細にする（基準版の UKE 作成と同じ）
  if (k && k.baseRecord && Array.isArray(k.baseRecord.billings)) return ukeItemsFromBaseRecord(k.baseRecord);
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
          let dCode = (rx.drug.code && /^[0-9A-Z]{9,12}$/.test(rx.drug.code)) ? rx.drug.code : ((DRUG_CODE_MAP[rx.drug.id] || {}).code || '9999999999');
          // 第2段階: レセ電の医薬品コードは9桁。院内プリセット（薬価基準コード12桁）は医薬品マスタの名称で9桁に引き直す
          if (!/^\d{9}$/.test(dCode) && typeof MasterLoader !== 'undefined' && MasterLoader.getDrugCodeByName) {
            try { const c9 = MasterLoader.getDrugCodeByName(rx.drug.name); if (c9 && /^\d{9}$/.test(String(c9))) dCode = String(c9); } catch (e) { /* マスタ未ロード */ }
          }
          const days = rx.days || k.rxDays || 7;
          // 薬剤料は1日分で点数にする（15円以下は1点、以降10円ごとに1点＝五捨五超入）
          const dayRaw = (rx.drug.price || 0) * rx.qty / 10;
          const dayPoints = Math.max(1, (typeof goshagochoNyuu === 'function') ? goshagochoNyuu(dayRaw) : Math.round(dayRaw));
          iy.push({ code: dCode, qty: rx.qty, days: days, dayPoints: dayPoints, points: dayPoints * days, note: rx.note || '', name: rx.drug.name || '' });
        });
      }
    }
  }
  // 検査
  if (k.selectedExams && !exr.exam) k.selectedExams.forEach(function (id) {
    const exi = (typeof examItems !== 'undefined' ? examItems : []).find(function (e) { return e.id === id; });
    // 修正4b: 公式の複数行で記録する検査（parts）は行ごとに出す。診療識別は表（公式マスター）から引く
    if (exi && exi.parts) exi.parts.forEach(function (pt) { si.push({ cat: ukeServiceOf(pt.code, '70'), code: pt.code, points: pt.points }); });
    else if (exi) si.push({ cat: '60', code: exi.code || '9999999', points: exi.points });
  });
  // 追加算定（当院標準加算スタック）: 名称→診療行為実コード解決
  // 段階A: 公式コードで記録（複数行のものは各行・コードが無いものだけ従来の加算の対応表）
  if (k.addedBillingItems) k.addedBillingItems.forEach(function (it) {
    const parts = ukeBillingParts(it);
    if (parts) { parts.forEach(function (pt) { si.push({ cat: ukeServiceOf(pt.code, '80'), code: pt.code, points: pt.points }); }); return; }
    const code = ukeBillingCode(it, isFirst);
    if (code) { si.push({ cat: ukeServiceOf(code, addonOf(it.name, isFirst).cat), code: code, points: it.points }); return; }
    const a = addonOf(it.name, isFirst);
    si.push({ cat: a.cat, code: a.code, points: it.points });
  });

  return { si: si, iy: iy, isFirst: isFirst };
}

// 工程4: 基準版の記録（kartes.base_record）の行為一覧 → 明細
//   行為（SI）: 回数＝数量。院内の薬剤料（IY）: 1回量＝drug_quantity・回数＝数量、同じ剤の先頭の行は点数・回数を空ける（基準版と同じ）
//   診療識別は、行為は公式の表、薬は剤形（頓服22・外用23・注射33・その他21）。算定しない行・自費の行は出さない
function ukeItemsFromBaseRecord(b) {
  const si = [], iy = [];
  (b.billings || []).forEach(function (it) {
    if (!it || it.do_not_bill || it.is_self_pay || it.item_type === 'self_pay') return;
    const code = String(it.billing_code || it.code || '');
    if (!/^\d{9}$/.test(code)) return;
    const count = Math.max(1, parseInt(it.quantity, 10) || 1);
    if (it.item_type === 'drug') {
      const kind = String(it.category || it.drug_type || '');
      const cat = /頓服/.test(kind) ? '22' : /外用/.test(kind) ? '23' : /注射/.test(kind) ? '33' : '21';
      const head = String(it.billing_group_id || '').indexOf('rx:') === 0 && !!it.billing_group_parent_id;
      iy.push({ cat: cat, code: code, qty: it.drug_quantity, days: count, dayPoints: Number(it.points) || 0, points: (Number(it.points) || 0) * count, cont: head, note: '', name: it.billing_name || '' });
      return;
    }
    if (it.item_type === 'material') return;   // 特定器材（TO）は別途
    si.push({ cat: ukeServiceOf(code, '80'), code: code, points: Number(it.points) || 0, count: count });
  });
  return { si: si, iy: iy, isFirst: si.some(function (s) { return /^111/.test(s.code); }) };
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

// ============================================================
// 出力書式（2026-09-17 改訂）
//   提出が通っている出力の書き方に合わせた。記録の位置・文字の決まりは uke_format.js。
//   ・IR の年月は「請求年月」（診療年月の翌月）。RE の年月が「診療年月」
//   ・RE レセプト種別 = 1(医科) + 保険種別(1医保/2公費/3後期) + 併用数 + 本人家族・年齢区分
//   ・RE 給付割合は国民健康保険のときだけ入れる
//   ・氏名・記号・番号は全角モード、保険者番号は右詰め8桁、カタカナ氏名は全角カタカナ
//   ・並びは RE→HO→KO→SN→JD→MF→SY→明細（診療識別の昇順）
//   ・薬剤(IY)は 点数=1日分、回数=日数、算定日には日数を入れる
//   ・GO の件数は「HO と KO の数」、点数は主保険の請求点数の合計
//   ・社保／国保の振り分けは保険者番号で決める（後期高齢者は国保連合会へ）
// ============================================================
const UKE_REC_LEN = UKE_FIELD_COUNTS;

// 医療機関情報（IRレコード）
const UKE_INST = {
  pref: '23',              // 都道府県（愛知）
  tensu: '1',              // 点数表（医科）
  code: '7400840',         // 医療機関コード（7桁）
  name: '西春内科・在宅クリニック',
  reserved: '00',
  phone: '0568-25-5080'
};

// 診療識別・剤形の表（支払基金の公開マスタから作成: master/uke_service_codes.json）
let UKE_SERVICE_TABLE = null;
let UKE_GROUP_TARIFFS = null;   // 段階A: 包括の対象（master/uke_group_tariffs.json）
// 画面の合計（recalcBilling）でも包括を使うため、読み込みは起動時に始めておく
if (typeof window !== 'undefined' && typeof fetch === 'function') setTimeout(function () { try { ukeLoadServiceTable(); } catch (e) { /* noop */ } }, 0);

// 段階A: 算定メニューの項目の公式コード（保存済みのコード → 初診/再診で別コード → メニューの名前 → 加算の対応表 の順）
function ukeBillingCode(it, isFirst) {
  if (it.code) return it.code;
  if (it.codeFirst) return isFirst ? it.codeFirst : it.codeRevisit;
  if (typeof billingMenuItemByName === 'function') {
    const f = billingMenuItemByName(it.name);
    if (f && f.code) return f.code;
    if (f && f.codeFirst) return isFirst ? f.codeFirst : f.codeRevisit;
  }
  return null;
}
function ukeBillingParts(it) {
  if (it.parts) return it.parts;
  if (typeof billingMenuItemByName === 'function') { const f = billingMenuItemByName(it.name); if (f && f.parts) return f.parts; }
  return null;
}
// 段階A: 包括（基準版 receipt_group_pricing.expected_group_points と同じ）。codes=その受診の SI のコード列
function ukeGroupBundles(codes) {
  const t = UKE_GROUP_TARIFFS; if (!t || !t.rules) return [];
  const out = [];
  t.rules.forEach(function (rule) {
    const set = t[rule.id] || [];
    const hit = [];
    codes.forEach(function (c, i) { if (set.indexOf(c) !== -1 && !hit.some(function (h) { return h.code === c; })) hit.push({ code: c, index: i }); });
    if (hit.length < rule.min) return;
    const pts = (rule.points.find(function (p) { return hit.length <= p[0]; }) || rule.points[rule.points.length - 1])[1];
    out.push({ rule: rule.id, indexes: hit.map(function (h) { return h.index; }), points: pts });
  });
  return out;
}
// 画面の合計用：カルテ1件ぶんの包括の差（包括点数 − 個別点数の合計）
function ukeBundleForKarte(k, isFirst) {
  const items = [];
  (k.addedBillingItems || []).forEach(function (it) { const c = ukeBillingCode(it, isFirst); if (c) items.push({ code: c, points: it.points }); });
  const res = { delta: 0, notes: [] };
  ukeGroupBundles(items.map(function (x) { return x.code; })).forEach(function (b) {
    const sum = b.indexes.reduce(function (a, i) { return a + items[i].points; }, 0);
    const d = b.points - sum;
    res.delta += d;
    res.notes.push({ name: (b.rule === 'biochem1' ? '生化学的検査（１）包括（' : '内分泌学的検査 包括（') + b.indexes.length + '項目 ' + b.points + '点）', delta: d });
  });
  return res;
}
async function ukeLoadServiceTable() {
  if (UKE_SERVICE_TABLE) return UKE_SERVICE_TABLE;
  try {
    const res = await fetch('master/uke_service_codes.json?v=20260924');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    UKE_SERVICE_TABLE = await res.json();
    // 段階A: 生化学(I)・内分泌の包括の対象コード表
    try { const g = await fetch('master/uke_group_tariffs.json?v=20260924'); if (g.ok) UKE_GROUP_TARIFFS = await g.json(); } catch (e) { /* 包括なしで続行（点検で気付ける） */ }
  } catch (e) {
    console.warn('[UKE] 診療識別の表を読めませんでした。カルテ側の区分で出力します:', e);
    UKE_SERVICE_TABLE = { service: {}, drugForm: {} };
  }
  return UKE_SERVICE_TABLE;
}
function ukeServiceOf(code, fallback) {
  const t = UKE_SERVICE_TABLE && UKE_SERVICE_TABLE.service ? UKE_SERVICE_TABLE.service[code] : null;
  return t || fallback || '80';
}
// 薬剤の診療識別: 21内服 / 22頓服 / 23外用 / 33注射
function ukeDrugServiceOf(code, note) {
  if (/頓服/.test(note || '')) return '22';
  const f = UKE_SERVICE_TABLE && UKE_SERVICE_TABLE.drugForm ? UKE_SERVICE_TABLE.drugForm[code] : null;
  if (f === '6') return '23';
  if (f === '4') return '33';
  return '21';
}


// ===== 段階B（2026-09-24）: 保険等タブ（基準版と同じ区分・有効期間）=====
function ukeActiveOn(list, date) {
  return (list || []).filter(function (e) {
    if (!e || e.isActive === false) return false;
    if (e.validFrom && date && String(e.validFrom).slice(0, 10) > date) return false;
    if (e.validUntil && date && String(e.validUntil).slice(0, 10) < date) return false;
    return true;
  });
}
// 診療月（yyyymm）に有効期間が重なるもの
function ukeActiveInMonth(list, ym) {
  const first = ym.slice(0, 4) + '-' + ym.slice(4, 6) + '-01';
  const last = ym.slice(0, 4) + '-' + ym.slice(4, 6) + '-' + String(new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(4, 6), 10), 0).getDate()).padStart(2, '0');
  return (list || []).filter(function (e) {
    if (!e || e.isActive === false) return false;
    if (e.validFrom && String(e.validFrom).slice(0, 10) > last) return false;
    if (e.validUntil && String(e.validUntil).slice(0, 10) < first) return false;
    return true;
  });
}
// 主保険（診療日に有効・isPrimary 優先）を従来の項目に反映した患者の値を返す（元の患者は変えない）
function ukeEffectivePatient(p, date, ym) {
  const q = Object.assign({}, p, { _ukeDate: date, _ukeMonth: ym });
  // 医療保険だけを主保険の候補にする（労災・自賠責・自費は別の請求）
  const ins = ukeActiveOn(p.insurances, date).filter(function (e) { return !/^(labor|workers|workers_comp|auto|automobile|self|self_pay)$/i.test(String(e.insuranceType || '')); })
    .sort(function (a, b) { return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0); })[0];
  if (ins) {
    q._ukeInsurance = ins;
    q.insurerNumber = ins.insurerNumber || '';
    q.insSymbol = ins.symbol || ''; q.insNumber = ins.number || ''; q.insEdaban = ins.branchNumber || '';
    q.relationship = ins.relationship === 'family' ? '家族' : (ins.relationship === 'main' ? '本人' : (q.relationship || ''));
    if (ins.burdenRatio) q.ratio = Number(ins.burdenRatio) / 100;
    if (ins.limitCategory) q.limitCategory = ins.limitCategory;
    if (ins.reductionType) q.reductionCategory = ins.reductionType;
    if (ins.reductionRatio !== undefined && ins.reductionRatio !== null && ins.reductionRatio !== '') q.reductionRate = ins.reductionRatio;
  }
  // 特記事項（診療日に有効・コード順）
  const notes = ukeActiveOn(p.receiptSpecialNotes, date).map(function (e) { return ukeZeroFill(e.code, 2); }).filter(Boolean).sort();
  if (notes.length) q.specialNoteCodes = notes.concat(ukeAsList(p.specialNoteCodes));
  // 一部負担金欄（診療月に有効・開始日が最も新しい1件）
  const cps = ukeActiveInMonth(p.receiptCopayments, ym).sort(function (a, b) { return String(b.validFrom || '') < String(a.validFrom || '') ? -1 : 1; });
  if (cps.length) {
    const c = cps[0];
    q._ukeCopayEntry = c;
    if ((c.insuranceAmount !== undefined && c.insuranceAmount !== null && c.insuranceAmount !== '') || (c.category && c.category !== '00')) {
      q.receiptCopayment = { category: c.category || '00', amount: c.insuranceAmount };
    }
  }
  // 摘要欄コメント・症状詳記（診療月に有効・対象保険が未指定か主保険）
  const target = function (e) { return !e.insurance || (ins && (e.insurance === ins.id)); };
  q._ukeSummaryComments = ukeActiveInMonth(p.receiptSummaryComments, ym).filter(target);
  q._ukeSymptomDetails = ukeActiveInMonth(p.receiptSymptomDetails, ym).filter(target);
  return q;
}
// 摘要欄コメント → CO（基準版 make_receipt_summary_comment_records と同じ：段落ごとに38字（76バイト）で分け、810000001・負担区分は空欄）
function ukeSummaryCommentRecords(p, position) {
  const out = [];
  (p._ukeSummaryComments || []).forEach(function (e) {
    const pos = String(e.position || 'upper').toLowerCase();
    if (pos !== position) return;
    String(e.content || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (para) {
      ukeSplitBytes(ukeTextMode(para, true), 76).forEach(function (chunk) { out.push(ukeMakeRecord('CO', { 2: '01', 4: '810000001', 5: chunk })); });
    });
  });
  return out;
}
// 症状詳記 → SJ（区分は最初の行だけ・2400バイトごと）
function ukeSymptomDetailRecords(p) {
  const out = [];
  (p._ukeSymptomDetails || []).forEach(function (e) {
    const text = String(e.content || '').trim(); if (!text) return;
    const cat = ukeZeroFill(e.category || '01', 2) || '01';
    let first = true;
    text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (para) {
      ukeSplitBytes(para, 2400).forEach(function (chunk) { out.push(ukeMakeRecord('SJ', { 2: first ? cat : '', 3: chunk })); first = false; });
    });
  });
  return out;
}
function ukeSplitBytes(text, max) {
  const out = []; let cur = '', n = 0;
  for (const ch of String(text)) {
    const b = (typeof ukeCp932Length === 'function') ? ukeCp932Length(ch) : (ch.charCodeAt(0) < 0x80 ? 1 : 2);
    if (n + b > max && cur) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  if (cur) out.push(cur);
  return out;
}

// ===== 修正5（2026-09-24）: 任意項目の決め方（基準版 receipt_uke_builder.py と同じ規則） =====
var UKE_INCOME_CATEGORY_NOTE = { 'ア': '26', 'イ': '27', 'ウ': '28', 'エ': '29', 'オ': '30', 'カ': '41', 'キ': '42' };
var UKE_ALL_INCOME_NOTES = ['26', '27', '28', '31', '32', '33', '29', '30', '34', '35', '41', '42', '43', '44'];
function ukeAsList(v) { return v === undefined || v === null || v === '' ? [] : (Array.isArray(v) ? v : [v]); }
function ukeDedupe(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }
// 所得区分（ア〜キ・数字）→ 特記事項コード
function ukeIncomeCategoryNote(value) {
  var t = String(value || '').normalize('NFKC').trim().replace(/ /g, '');
  if (!t) return '';
  if (t.indexOf('区分') === 0) t = t.slice(2); else if (t.indexOf('区') === 0) t = t.slice(1);
  t = t.replace(/\((?:多数該当|公費併用)\)$/, '');
  if (UKE_INCOME_CATEGORY_NOTE[t]) return UKE_INCOME_CATEGORY_NOTE[t];
  if (/^[0-9]{1,2}$/.test(t)) { var c = ('0' + t).slice(-2); return UKE_ALL_INCOME_NOTES.indexOf(c) !== -1 ? c : ''; }
  return '';
}
// RE 特記事項（2桁コードを最大5つ連結。高齢受給者・後期高齢者は所得区分から自動で足す）
function ukeSpecialNoteCodes(p, receiptType) {
  var values = [];
  ukeAsList(p.specialNoteCodes).concat(ukeAsList(p.specialNote)).forEach(function (v) {
    var c = ukeZeroFill(ukeDigits(v), 2); if (c) values.push(c.slice(-2));
  });
  if (/[08]$/.test(receiptType || '')) {
    var ic = ukeIncomeCategoryNote(p.limitCategory || p.insuranceLimitCategory) || ukeIncomeLevelNote(p.incomeLevel, ukeIsElderlyInsurer(p.insurerNumber));
    if (ic) values.push(ic);
  }
  return ukeDedupe(values).slice(0, 5).join('');
}
// 修正13b: 画面の所得区分（incomeLevelSelect）→ 特記事項コード（記録条件仕様）
//   現役並みⅢ=26区ア・Ⅱ=27区イ・Ⅰ=28区ウ／一般＝70〜74歳は29区エ、後期高齢は42区キ／一定以上所得（後期2割）=41区カ／低所得Ⅰ・Ⅱ=30区オ
function ukeIncomeLevelNote(level, elderlyInsurer) {
  switch (String(level || '')) {
    case 'genzai3': return '26';
    case 'genzai2': return '27';
    case 'genzai1': return '28';
    case 'ippan': return elderlyInsurer ? '42' : '29';
    case 'itteijoh': return '41';
    case 'tei1': case 'tei2': return '30';
    default: return '';
  }
}
// RE 診療科（数字2桁のコードがあるときだけ。「内科」のような名称だけでは記録しない＝基準版と同じ）
function ukeDepartmentCode(value) { var d = ukeDigits(String(value || '').trim()); return d.length >= 2 ? d.slice(0, 2) : ''; }
// RE 患者の状態（3桁コードを最大20個）
function ukePatientConditionCodes(p) {
  return ukeDedupe(ukeAsList(p.patientConditionCodes).filter(function (v) { return ukeDigits(v); })
    .map(function (v) { return ukeZeroFill(ukeDigits(v), 3).slice(-3); })).slice(0, 20).join('');
}
// HO 一部負担金額・MF 窓口負担額区分（明示された月額だけ。会計から自動補完しない）
function ukeReceiptCopayment(p) {
  var e = p.receiptCopayment || {};
  var category = ['00', '01', '02'].indexOf(String(e.category || '00')) !== -1 ? String(e.category || '00') : '00';
  var amount = (e.amount === undefined || e.amount === null || e.amount === '' || !/^[0-9]{1,9}$/.test(String(e.amount))) ? '' : String(e.amount);
  return { category: category, amount: amount };
}
// SY 転帰（継続1・治ゆ2・死亡3・中止/転医4）
var UKE_OUTCOME = { '': '1', continuing: '1', '継続': '1', cured: '2', '治癒': '2', '治ゆ': '2', died: '3', '死亡': '3',
  discontinued: '4', '中止': '4', transferred: '4', '移行': '4', '転医': '4', '1': '1', '2': '2', '3': '3', '4': '4' };
function ukeOutcomeCode(value) { var v = String(value === undefined || value === null ? '' : value).trim(); return UKE_OUTCOME[v] || UKE_OUTCOME[v.toLowerCase()] || '1'; }
// SY 修飾語コード（英数字だけにして最大20個を連結）
function ukeModifierCodes(value) {
  return ukeDedupe(ukeAsList(value).map(function (it) {
    var c = (it && typeof it === 'object') ? (it.code || it.modifierCode || '') : it;
    return String(c || '').replace(/[^0-9A-Za-z]/g, '');
  }).filter(Boolean)).slice(0, 20).join('');
}

// 満年齢（診療日時点）
function ukeAgeAt(dob, visitDate) {
  const b = ukeDate(dob), v = ukeDate(visitDate);
  if (!b || !v) return null;
  let age = parseInt(v.slice(0, 4), 10) - parseInt(b.slice(0, 4), 10);
  if (v.slice(4) < b.slice(4)) age--;
  return age;
}
// 未就学児か（6歳に達した日以後の最初の3月31日まで）
function ukeIsPreschool(dob, visitDate) {
  const b = ukeDate(dob), v = ukeDate(visitDate);
  if (!b || !v) return false;
  const by = parseInt(b.slice(0, 4), 10), bmd = b.slice(4);
  const schoolYear = (bmd <= '0401') ? by + 6 : by + 7;
  return v < String(schoolYear) + '0401';
}

// 公費（医療証）の情報。負担者番号8桁があるものだけ出す。
function ukePublicExpenses(p) {
  const list = [];
  // 段階B: 保険等タブの公費（診療日に有効なもの・登録順・最大4件）
  if (Array.isArray(p.publicExpenses) && p.publicExpenses.length) {
    // 公費の請求先の判定（uke_public_expense_rules.js）: 保険請求とは別に請求する公費は UKE に入れない
    let active = ukeActiveOn(p.publicExpenses, p._ukeDate);
    if (typeof ukeRoutePublicExpenses === 'function') active = ukeRoutePublicExpenses(p, active);
    active.slice(0, 4).forEach(function (e) {
      const payer = ukeDigits(e.payerNumber);
      if (payer.length !== 8 && !e.noPayerNumber) return;
      list.push({ payer: payer, recipient: ukeDigits(e.recipientNumber || ''), optionalBenefit: e.optionalBenefitCategory || '',
                  burdenAmount: undefined, coveredBurdenAmount: undefined, qualificationCheckCode: e.qualificationCheckCode || '' });
    });
    return list;
  }
  const payer = ukeDigits(p.kouhiNumber);
  if (payer.length === 8) {
    list.push({ payer: payer, recipient: ukeDigits(p.recipientNumber || p.kouhiRecipient || p.iryoRecipientNumber || ''),
                optionalBenefit: p.kouhiOptionalBenefit || '', burdenAmount: p.kouhiBurdenAmount, coveredBurdenAmount: p.kouhiCoveredBurdenAmount,
                qualificationCheckCode: p.kouhiQualificationCheckCode || '' });
  }
  return list;
}

// 本人・家族、年齢の区分（RE レセプト種別の4桁目。外来）
//   2=本人 / 4=未就学者 / 6=家族 / 8=高齢者一般・低所得 / 0=高齢者7割給付
function ukePersonTypeCode(p, visitDate) {
  const elderly = ukeIsElderlyInsurer(p.insurerNumber) ||
    (function () { const a = ukeAgeAt(p.dob, visitDate); return a !== null && a >= 70; })();
  if (elderly) return (Number(p.ratio) === 0.3) ? '0' : '8';
  if (ukeIsPreschool(p.dob, visitDate)) return '4';
  const rel = String(p.relationship || p.honninKazoku || '');
  if (rel === '2' || /家族|被扶養/.test(rel)) return '6';
  return '2';
}

// レセプト種別（4桁）
function receiptTypeCode(p, publicCount, visitDate) {
  const hasInsurance = !!ukeDigits(p.insurerNumber) || String(p.insurance || '') !== '公費';
  let ins;
  if (!hasInsurance) ins = '2';
  else if (ukeIsElderlyInsurer(p.insurerNumber) || String(p.insurance || '').indexOf('後期') !== -1) ins = '3';
  else ins = '1';
  const count = (ins === '2') ? String(publicCount) : String(1 + publicCount);
  const person = (ins === '2') ? '2' : ukePersonTypeCode(p, visitDate);
  return '1' + ins + count + person;
}

// 給付割合（国民健康保険のときだけ）
function ukeBenefitRate(p) {
  if (!ukeIsKokuhoInsurer(p.insurerNumber)) return '';
  const r = Number(p.ratio);
  if (r === 0.1 || r === 0.2 || r === 0.3) return String(Math.round(100 - r * 100));
  return '';
}

function buildUkeText(patientList, reviewOrg, instCode, instName, prefCode, billingMonth, opts) {
  opts = opts || {};
  const serviceMonth = ukeMonth(billingMonth);
  const claimMonth = ukeMonth(opts.claimYm) || ukeNextMonth(serviceMonth);
  const lines = [];
  // 第2段階: 医療機関情報の点検
  if (opts.warnings && typeof ukePreflightFacility === 'function') ukePreflightFacility(UKE_INST).forEach(function (m) { if (opts.warnings.indexOf(m) === -1) opts.warnings.push(m); });
  lines.push(ukeMakeRecord('IR', {
    2: reviewOrg, 3: UKE_INST.pref, 4: UKE_INST.tensu, 5: UKE_INST.code,
    7: UKE_INST.name, 8: claimMonth, 9: UKE_INST.reserved, 10: ukePhone(UKE_INST.phone)
  }));

  const groups = opts.aggregate ? groupVisitsByPatient(patientList)
                                : patientList.map(function (pd) { return [pd]; });

  let seq = 1, goCount = 0, goPoints = 0;
  for (const group of groups) {
    const head = group[0];
    const p = ukeEffectivePatient(head.patient, String(head.visitDate || '').slice(0, 10), serviceMonth);   // 段階B: 保険等タブの有効な値

    // --- 受診日ごとの算定を集める ---
    //   SI: 診療識別|コード|点数 で束ね、算定日ごとの回数を持つ
    //   IY: コード|1日量|1日分点数 で束ね、算定日に日数を持つ
    const siMap = new Map();
    const iyMap = new Map();
    const dayList = [];
    let totalPoints = 0;
    // 修正2（2026-09-24）: 明細は基準版と同じく「受診1回の算定1件＝1行」で出す（月内の同じ行為を1行にまとめない）
    const visitRows = group.map(function () { return []; });

    group.forEach(function (pd, vi) {
      const day = parseInt((pd.visitDate || '').split('-')[2], 10) || 1;
      if (dayList.indexOf(day) === -1) dayList.push(day);
      const items = computeVisitItems(pd);
      items.si.forEach(function (s) {
        const cat = ukeServiceOf(s.code, s.cat);
        const n = s.count || 1;   // 工程4: 基準版の記録は回数を持つ（従来は常に1）
        visitRows[vi].push({ type: 'SI', cat: cat, code: s.code, points: s.points, count: n, day: day });
        const key = cat + '|' + s.code + '|' + s.points;
        if (!siMap.has(key)) siMap.set(key, { cat: cat, code: s.code, points: s.points, days: {} });
        const e = siMap.get(key);
        e.days[day] = (e.days[day] || 0) + n;
        totalPoints += s.points * n;
      });
      // 段階A: 包括（生化学(I) 5項目以上・内分泌 3項目以上）＝最後の行だけ包括点数、それ以外は継続行（点数・回数なし）
      const siRows = visitRows[vi].filter(function (r) { return r.type === 'SI'; });
      ukeGroupBundles(siRows.map(function (r) { return r.code; })).forEach(function (b) {
        const grp = b.indexes.map(function (i) { return siRows[i]; });
        const sum = grp.reduce(function (a, r) { return a + r.points; }, 0);
        const head = visitRows[vi].indexOf(grp[0]);
        grp.forEach(function (r) { visitRows[vi].splice(visitRows[vi].indexOf(r), 1); });
        grp.forEach(function (r, j) { r.cont = j < grp.length - 1; if (!r.cont) r.points = b.points; });
        visitRows[vi].splice.apply(visitRows[vi], [head, 0].concat(grp));   // 一連の行為はまとめて並べる
        totalPoints += b.points - sum;
      });
      items.iy.forEach(function (x) {
        const cat = x.cat || ukeDrugServiceOf(x.code, x.note);
        visitRows[vi].push({ type: 'IY', cat: cat, code: x.code, qty: x.qty, points: x.dayPoints, count: x.days, day: day, cont: !!x.cont });
        const key = cat + '|' + x.code + '|' + x.qty + '|' + x.dayPoints;
        if (!iyMap.has(key)) iyMap.set(key, { cat: cat, code: x.code, qty: x.qty, points: x.dayPoints, days: {}, name: x.name || '' });
        const e = iyMap.get(key);
        e.days[day] = (e.days[day] || 0) + x.days;
        totalPoints += x.dayPoints * x.days;
      });
    });
    dayList.sort(function (a, b) { return a - b; });
    // 第2段階: 特定器材（TO）と摘要・症状詳記（CO/SJ）の元データ（月次は受診ぶんを重複なく合わせる）
    const notes = (typeof ukeMergeNotes === 'function') ? ukeMergeNotes(group.map(function (pd) { return pd.karte; })) : { comments: [], symptoms: [], materials: [] };
    const toMap = new Map();
    if (typeof ukeMaterialItems === 'function') group.forEach(function (pd, vi) {
      const day = parseInt((pd.visitDate || '').split('-')[2], 10) || 1;
      ukeMaterialItems(pd.karte).forEach(function (t) {
        visitRows[vi].push(Object.assign({}, t, { type: 'TO', count: 1, day: day }));
        const key = t.cat + '|' + t.code + '|' + t.qty + '|' + t.points + '|' + t.unitCode;
        if (!toMap.has(key)) toMap.set(key, Object.assign({}, t, { days: {} }));
        const e = toMap.get(key);
        e.days[day] = (e.days[day] || 0) + 1;
        totalPoints += t.points;
      });
    });

    const pubs = ukePublicExpenses(p);
    if (opts.notes && p._ukePublicRouting) p._ukePublicRouting.notes.forEach(function (m) { const s = String(p.id || p.name || ('No.' + seq)) + ': ' + m; if (opts.notes.indexOf(s) === -1) opts.notes.push(s); });
    if (p._ukeCopayEntry) pubs.forEach(function (pub, i) {   // 段階B: 一部負担金欄の公費の金額（KO7=公費負担金額・KO8=外来一部負担金）
      const c = p._ukeCopayEntry, pa = c['public' + (i + 1)], ca = c['covered' + (i + 1)];
      if (pa !== undefined && pa !== null && pa !== '') pub.burdenAmount = pa;
      if (ca !== undefined && ca !== null && ca !== '') pub.coveredBurdenAmount = ca;
    });
    const insurer = ukeDigits(p.insurerNumber);
    const hasInsurance = !!insurer || String(p.insurance || '') !== '公費';
    const jitsuNissu = dayList.length;

    // RE（修正5: 11・12・15・19・21・22・38 番目は基準版と同じ規則で、値があるときだけ記録）
    const reType = receiptTypeCode(p, pubs.length, head.visitDate);
    lines.push(ukeMakeRecord('RE', {
      2: seq,
      3: reType,
      4: serviceMonth,
      5: p.name,
      6: sexToCode(p.sex),
      7: ukeDate(p.dob),
      8: ukeBenefitRate(p),
      11: p.standardBurdenCategory || '',
      12: ukeSpecialNoteCodes(p, reType),
      14: p.id || p.patientNo || String(seq),
      15: p.discountPointUnit || '',
      19: p.receiptSearchNumber || '',
      21: p.claimInfo || '',
      22: ukeDepartmentCode(head.karte.department || p.department),
      37: p.nameKana || p.kana || '',
      38: ukePatientConditionCodes(p)
    }));
    const copay = ukeReceiptCopayment(p);

    // HO（保険）
    if (hasInsurance) {
      let symbol = p.insSymbol || '', number = p.insNumber || '';
      if (!symbol && !number && p.insuranceNumber) {
        symbol = (p.insuranceNumber.split('-')[0] || '');
        number = ((p.insuranceNumber.split('-')[1] || '').replace(/\(.*\)$/, ''));
      }
      // 修正5: 後期高齢は記号を記録しない／10〜15番目（職務上の事由・減額・一部負担金）は値があるときだけ
      lines.push(ukeMakeRecord('HO', { 2: insurer, 3: ukeIsElderlyInsurer(insurer) ? '' : symbol, 4: number, 5: jitsuNissu, 6: totalPoints,
        10: p.workReasonCode || '', 11: p.reductionCertificateNumber || '', 12: copay.amount,
        13: p.reductionCategory || '', 14: p.reductionRate || '', 15: p.reductionAmount || '' }));
      goCount++;
      goPoints += totalPoints;
    }
    // KO（公費）: 医療証の負担者番号があるときだけ。明細はすべて公費の対象として扱う。
    pubs.forEach(function (pub) {
      lines.push(ukeMakeRecord('KO', {
        2: pub.payer, 3: ukeZeroFill(pub.recipient, 7), 4: pub.optionalBenefit || '', 5: jitsuNissu, 6: totalPoints,
        7: pub.burdenAmount === undefined ? '' : pub.burdenAmount, 8: pub.coveredBurdenAmount === undefined ? '' : pub.coveredBurdenAmount
      }));
      goCount++;
    });
    if (!hasInsurance && pubs.length) goPoints += totalPoints;   // 公費単独は第1公費の点数
    // SN（資格確認・枝番）: 後期高齢者は枝番を出さない
    const edaban = ukeDigits(p.insEdaban);
    if (hasInsurance && edaban && !ukeIsElderlyInsurer(insurer)) {
      lines.push(ukeMakeRecord('SN', { 2: '1', 3: p.qualificationCheckCode || '01', 7: ukeZeroFill(edaban, 2) }));
    }
    // 修正5: 公費が生活保護（法別12）のときは公費の資格確認 SN も出す（基準版と同じ）
    pubs.forEach(function (pub, i) {
      if (i < 4 && String(pub.payer).slice(0, 2) === '12') lines.push(ukeMakeRecord('SN', { 2: String(i + 2), 3: pub.qualificationCheckCode || '01' }));
    });
    // JD（受診日）: 負担者ごとに1行
    const payerTypes = [];
    if (hasInsurance) payerTypes.push('1');
    pubs.forEach(function (_, i) { if (i < 4) payerTypes.push(String(i + 2)); });
    payerTypes.forEach(function (t) {
      const jd = { 2: t };
      dayList.forEach(function (d) { jd[d + 2] = '1'; });
      lines.push(ukeMakeRecord('JD', jd));
    });
    // MF（窓口負担額）: 令和3年9月診療分から。外来は区分00のみ。
    if (hasInsurance && serviceMonth >= '202109') lines.push(ukeMakeRecord('MF', { 2: copay.category }));

    // SY（傷病名）
    const syList = [];
    const syIndex = {};
    group.forEach(function (pd) {
      const ds = pd.karte.selectedDiseases || [];
      const mainIdx = ds.findIndex(function (d) { return d && d.main; });
      const mainPos = mainIdx >= 0 ? mainIdx : 0;
      ds.forEach(function (d, di) {
        const dCode = resolveDiseaseCode(d);
        const startDate = ukeDate(d.startDate || pd.visitDate) || (serviceMonth + '01');
        const key = dCode === '0000999' ? dCode + '|' + (d.name || '') : dCode;
        if (syIndex[key] !== undefined) {
          const cur = syList[syIndex[key]];
          if (startDate < cur.start) cur.start = startDate;
          if (d && d.main) cur.explicitMain = true;
          return;
        }
        syIndex[key] = syList.length;
        syList.push({ code: dCode, name: d.name || '', start: startDate, main: (di === mainPos), explicitMain: !!(d && d.main),
                      outcome: ukeOutcomeCode(d.outcome), supplement: d.supplement || '',
                      // 修正13: 疑い病名は修飾語 8002 を付ける
                      modifier: ukeModifierCodes((d.status === 'suspected' ? ['8002'] : []).concat(ukeAsList(d.modifierCodes || d.modifiers))) });
      });
    });
    // 工程4（2026-09-24）: 主病名の印は基準版と同じく「主病名に指定した病名すべて」に付ける（指定が無ければ付けない）。
    //   従来は最初の1つだけ・指定が無いときは先頭に付けていた
    syList.forEach(function (s) { s.main = s.explicitMain; });
    syList.forEach(function (s) {
      lines.push(ukeMakeRecord('SY', {
        2: s.code, 3: s.start, 4: s.outcome, 5: s.modifier,
        6: s.code === '0000999' ? s.name : '',
        7: s.main ? '01' : '', 8: s.supplement
      }));
    });

    // 第2段階: 摘要コメント（上段＝傷病名の後）
    const burden = pubs.length ? (hasInsurance ? '2' : '5') : '1';
    ukeSummaryCommentRecords(p, 'upper').forEach(function (r) { lines.push(r); });   // 段階B: 患者ごとの摘要欄コメント（上段）
    if (typeof ukeCommentRecords === 'function') ukeCommentRecords(notes, 'upper', burden).forEach(function (r) { lines.push(r); });

    // 明細（SI/IY/TO）: 修正3（2026-09-24）基準版と同じ並び＝受診日順・受診内の算定順のまま、診療識別の昇順に安定並べ替え
    const details = [].concat.apply([], visitRows);
    details.sort(function (a, b) { return parseInt(a.cat, 10) - parseInt(b.cat, 10); });
    details.forEach(function (v) {
      const rec = { 2: v.cat, 3: burden, 4: v.code, 6: v.cont ? '' : v.points, 7: v.cont ? '' : v.count };
      if (v.type === 'IY') rec[5] = v.qty;
      if (v.type === 'TO') { rec[5] = v.qty; rec[8] = v.unitCode; rec[9] = v.unitPrice; rec[11] = v.name; }
      const pos = ukeDayPosition(v.type, v.day);
      if (pos && !v.cont) rec[pos] = v.count;
      lines.push(ukeMakeRecord(v.type, rec));
    });
    // 第2段階: 摘要コメント（下段）・症状詳記
    ukeSummaryCommentRecords(p, 'lower').forEach(function (r) { lines.push(r); });   // 段階B: 患者ごとの摘要欄コメント（下段）
    if (typeof ukeCommentRecords === 'function') ukeCommentRecords(notes, 'lower', burden).forEach(function (r) { lines.push(r); });
    ukeSymptomDetailRecords(p).forEach(function (r) { lines.push(r); });                // 段階B: 患者ごとの症状詳記
    if (typeof ukeSymptomRecords === 'function') ukeSymptomRecords(notes).forEach(function (r) { lines.push(r); });
    // 第2段階: 書き出す前の点検（患者・保険・公費・傷病名・明細・コメント）
    if (opts.warnings && typeof ukePreflightReceipt === 'function') {
      const siL = [], iyL = [], toL = [];
      siMap.forEach(function (s) { siL.push(s); }); iyMap.forEach(function (x) { iyL.push(x); }); toMap.forEach(function (t) { toL.push(t); });
      const pf = ukePreflightReceipt({ p: p, serviceMonth: serviceMonth, reviewOrg: reviewOrg, insurer: insurer, hasInsurance: hasInsurance, pubs: pubs, syList: syList, si: siL, iy: iyL, to: toL, notes: notes, totalPoints: totalPoints });
      const label = String(p.id || p.name || ('No.' + seq));
      pf.warnings.forEach(function (m) { const s = label + ': ' + m; if (opts.warnings.indexOf(s) === -1) opts.warnings.push(s); });
      if (opts.notes) pf.notes.forEach(function (m) { const s = label + ': ' + m; if (opts.notes.indexOf(s) === -1) opts.notes.push(s); });
    }

    seq++;
  }
  // GO: 件数は HO と KO の数、点数は主保険の請求点数の合計
  lines.push(ukeMakeRecord('GO', { 2: goCount, 3: goPoints, 4: '99' }));
  return ukeJoinLines(lines);
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
