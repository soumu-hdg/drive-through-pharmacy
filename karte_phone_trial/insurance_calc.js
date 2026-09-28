// ===== 保険者番号パーサー＋負担割合自動判定エンジン v1.0 =====
// CSV: csv/insurance_type_master.csv, copay_rate_rules.csv, kouhi_master.csv

// --- 法別番号 → 保険種別マッピング ---
const HOUBETSU_MAP = {
  '01': { code: 'KYOKAI_KENPO',   name: '協会けんぽ',       category: '社保' },
  '02': { code: 'SENIN',          name: '船員保険',         category: '社保' },
  '03': { code: 'HIYATOI_IPPAN',  name: '日雇特例（一般）', category: '社保' },
  '04': { code: 'HIYATOI_TOKUBETSU', name: '日雇特例（特別）', category: '社保' },
  '06': { code: 'KUMIAI_KENPO',   name: '組合管掌健保',     category: '社保' },
  '07': { code: 'BOUEI',          name: '防衛省職員',       category: '社保' },
  '31': { code: 'KOKKA_KYOSAI',   name: '国家公務員共済',   category: '社保' },
  '32': { code: 'CHIHO_KYOSAI',   name: '地方公務員等共済', category: '社保' },
  '33': { code: 'KEISATSU_KYOSAI', name: '警察共済',        category: '社保' },
  '34': { code: 'GAKKO_KYOSAI',   name: '公立学校・私学共済', category: '社保' },
  '39': { code: 'KOUKI_KOREI',    name: '後期高齢者医療',   category: '後期高齢者' },
  '63': { code: 'TOKUTAI_KENPO',  name: '特定健保組合',     category: '社保' },
  '67': { code: 'KOKUHO_TAISHOKU', name: '国保退職者医療',  category: '国保' },
  '72': { code: 'KOKKA_TOKUTEI',  name: '国家公務員特定共済', category: '社保' },
  '73': { code: 'CHIHO_TOKUTEI',  name: '地方公務員等特定共済', category: '社保' },
  '74': { code: 'KEISATSU_TOKUTEI', name: '警察特定共済',   category: '社保' },
  '75': { code: 'GAKKO_TOKUTEI',  name: '公立学校特定共済', category: '社保' },
};

// --- 公費負担マスタ ---
const KOUHI_MAP = {
  '10': { name: '結核適正医療',         rate: 0.05, priority: '保険優先', burden: '5%' },
  '11': { name: '結核入院',             rate: 0,    priority: '公費優先', burden: '0%' },
  '12': { name: '生活保護 医療扶助',    rate: 0,    priority: '公費優先', burden: '0%' },
  '13': { name: '戦傷病者（療養）',      rate: 0,    priority: '公費優先', burden: '0%' },
  '14': { name: '戦傷病者（更生）',      rate: 0,    priority: '公費優先', burden: '0%' },
  '15': { name: '自立支援 更生医療',    rate: 0.1,  priority: '保険優先', burden: '1割+月額上限' },
  '16': { name: '自立支援 育成医療',    rate: 0.1,  priority: '保険優先', burden: '1割+月額上限' },
  '17': { name: '療育の給付',           rate: 0,    priority: '保険優先', burden: '0%' },
  '18': { name: '原爆 認定疾病',        rate: 0,    priority: '公費優先', burden: '0%' },
  '19': { name: '原爆 一般疾病',        rate: 0,    priority: '保険優先', burden: '0%' },
  '20': { name: '措置入院',             rate: 0,    priority: '保険優先', burden: '0%' },
  '21': { name: '自立支援 精神通院',    rate: 0.1,  priority: '保険優先', burden: '1割+月額上限' },
  '23': { name: '未熟児養育医療',       rate: null, priority: '保険優先', burden: '所得による' },
  '24': { name: '療養介護医療',         rate: 0.1,  priority: '保険優先', burden: '1割' },
  '25': { name: '中国残留邦人等支援',   rate: 0,    priority: '保険優先', burden: '0%' },
  '28': { name: '感染症入院（37条）',    rate: 0,    priority: '公費優先', burden: '0%' },
  '29': { name: '感染症入院（37条の2）', rate: 0,    priority: '公費優先', burden: '0%' },
  '30': { name: '医療観察法',           rate: 0,    priority: '公費優先', burden: '0%' },
  '38': { name: '肝炎治療',             rate: null, priority: '保険優先', burden: '月額上限' },
  '51': { name: '特定疾患（旧難病）',   rate: 0,    priority: '保険優先', burden: '0%' },
  '52': { name: '小児慢性特定疾病',     rate: 0.2,  priority: '保険優先', burden: '2割+月額上限' },
  '53': { name: '措置医療（児童）',      rate: 0,    priority: '保険優先', burden: '0%' },
  '54': { name: '指定難病',             rate: 0.2,  priority: '保険優先', burden: '2割+月額上限' },
  '66': { name: '石綿被害救済',         rate: 0,    priority: '保険優先', burden: '0%' },
};

// --- 都道府県番号 ---
const PREF_MAP = {
  '01':'北海道','02':'青森','03':'岩手','04':'宮城','05':'秋田','06':'山形','07':'福島',
  '08':'茨城','09':'栃木','10':'群馬','11':'埼玉','12':'千葉','13':'東京','14':'神奈川',
  '15':'新潟','16':'富山','17':'石川','18':'福井','19':'山梨','20':'長野',
  '21':'岐阜','22':'静岡','23':'愛知','24':'三重','25':'滋賀','26':'京都',
  '27':'大阪','28':'兵庫','29':'奈良','30':'和歌山','31':'鳥取','32':'島根',
  '33':'岡山','34':'広島','35':'山口','36':'徳島','37':'香川','38':'愛媛','39':'高知',
  '40':'福岡','41':'佐賀','42':'長崎','43':'熊本','44':'大分','45':'宮崎','46':'鹿児島','47':'沖縄',
};

// ===================================================================
// 保険者番号パーサー
// ===================================================================

/**
 * 保険者番号を解析する
 * @param {string} insurerNumber - 保険者番号（6桁 or 8桁、数字のみ）
 * @returns {object} 解析結果
 */
function parseInsurerNumber(insurerNumber) {
  const num = (insurerNumber || '').replace(/[^0-9]/g, '');
  const result = {
    raw: insurerNumber,
    cleaned: num,
    valid: false,
    digits: num.length,
    houbetsu: '',
    houbetsuName: '',
    insuranceCategory: '',  // 社保 / 国保 / 後期高齢者
    prefCode: '',
    prefName: '',
    insurerCode: '',
    checkDigit: '',
    checkValid: false,
    errors: [],
  };

  if (num.length === 6) {
    // 国民健康保険
    result.houbetsu = '(6桁)';
    result.houbetsuName = '国民健康保険';
    result.insuranceCategory = '国保';
    result.prefCode = num.substring(0, 2);
    result.prefName = PREF_MAP[result.prefCode] || '不明';
    result.insurerCode = num.substring(2, 5);
    result.checkDigit = num.substring(5, 6);
    result.checkValid = verifyCheckDigit(num);
    result.valid = result.checkValid;
    if (!result.checkValid) result.errors.push('検証番号不一致');
  } else if (num.length === 8) {
    // 社保・後期高齢者等
    result.houbetsu = num.substring(0, 2);
    const info = HOUBETSU_MAP[result.houbetsu];
    if (info) {
      result.houbetsuName = info.name;
      result.insuranceCategory = info.category;
    } else {
      result.houbetsuName = '不明（法別' + result.houbetsu + '）';
      result.insuranceCategory = '不明';
      result.errors.push('未知の法別番号: ' + result.houbetsu);
    }
    result.prefCode = num.substring(2, 4);
    result.prefName = PREF_MAP[result.prefCode] || '不明';
    result.insurerCode = num.substring(4, 7);
    result.checkDigit = num.substring(7, 8);
    result.checkValid = verifyCheckDigit(num);
    result.valid = result.checkValid && !!info;
    if (!result.checkValid) result.errors.push('検証番号不一致');
  } else {
    result.errors.push('桁数不正（6桁または8桁が必要、入力: ' + num.length + '桁）');
  }

  return result;
}

/**
 * 保険者番号のチェックデジット検証
 * 社保診療報酬支払基金の検証番号計算方法に準拠
 */
function verifyCheckDigit(num) {
  if (num.length !== 6 && num.length !== 8) return false;
  const digits = num.split('').map(Number);
  let sum = 0;
  // 右端から偶数位置（2,4,6,8桁目）を×2、奇数位置（1,3,5,7桁目）を×1
  for (let i = digits.length - 1; i >= 0; i--) {
    const pos = digits.length - i; // 右端から数えた位置（1始まり）
    if (pos % 2 === 0) {
      const doubled = digits[i] * 2;
      sum += doubled >= 10 ? Math.floor(doubled / 10) + (doubled % 10) : doubled;
    } else {
      sum += digits[i];
    }
  }
  return sum % 10 === 0;
}

// ===================================================================
// 年齢計算
// ===================================================================

/**
 * 生年月日から年齢を計算
 * @param {string} dob - "YYYY-MM-DD"
 * @param {Date} [refDate] - 基準日（省略時は今日）
 * @returns {number}
 */
function calcAge(dob, refDate) {
  if (!dob) return -1;
  const ref = refDate || new Date();
  const birth = new Date(dob);
  let age = ref.getFullYear() - birth.getFullYear();
  const mDiff = ref.getMonth() - birth.getMonth();
  if (mDiff < 0 || (mDiff === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * 義務教育就学前かどうか判定
 * 6歳に到達した年度の3月31日までが就学前
 * @param {string} dob - "YYYY-MM-DD"
 * @param {Date} [refDate] - 基準日
 * @returns {boolean}
 */
function isPreSchool(dob, refDate) {
  if (!dob) return false;
  const ref = refDate || new Date();
  const birth = new Date(dob);
  // 6歳到達年度の3月31日 = 誕生日が4/2以降なら翌年度
  const birthYear = birth.getFullYear();
  const birthMonth = birth.getMonth() + 1;
  const birthDay = birth.getDate();
  // 4月2日生まれ以降は翌年の3月31日まで就学前
  let endFY;
  if (birthMonth >= 4 && birthDay >= 2) {
    endFY = birthYear + 6 + 1; // 翌年度末
  } else if (birthMonth > 4) {
    endFY = birthYear + 6 + 1;
  } else {
    endFY = birthYear + 6; // 同年度末
  }
  const preSchoolEnd = new Date(endFY, 2, 31); // 3月31日
  return ref <= preSchoolEnd;
}

// ===================================================================
// 負担割合自動判定
// ===================================================================

/**
 * 保険者番号と生年月日から負担割合を自動判定
 * @param {string} insurerNumber - 保険者番号
 * @param {string} dob - 生年月日 "YYYY-MM-DD"
 * @param {object} [options] - 追加オプション
 * @param {string} [options.incomeLevel] - 所得区分 ('ippan','itteijoh','genzai1','genzai2','genzai3','tei1','tei2')
 * @param {string} [options.kouhiNumber] - 公費負担者番号（8桁）
 * @param {number} [options.elderCertRate] - 高齢受給者証記載の負担割合（0.2 or 0.3）
 * @returns {object} 判定結果
 */
function calcCopayRate(insurerNumber, dob, options) {
  const opt = options || {};
  const parsed = parseInsurerNumber(insurerNumber);
  const age = calcAge(dob);

  const result = {
    insurerParsed: parsed,
    age: age,
    dob: dob,
    baseRate: 0.3,
    finalRate: 0.3,
    rateLabel: '3割',
    insuranceCategory: parsed.insuranceCategory,
    insuranceLabel: '',
    appliedRule: '',
    kouhiApplied: false,
    kouhiName: '',
    kouhiDetail: '',
    warnings: [],
    details: [],
  };

  // Step 1: 保険種別の判定
  if (!parsed.valid && parsed.cleaned.length > 0) {
    result.warnings.push('保険者番号の検証に問題があります（' + parsed.errors.join(', ') + '）');
  }

  // Step 2: 年齢別の基本負担割合
  if (age < 0) {
    result.warnings.push('生年月日が未入力のため年齢判定不可。3割と仮定します。');
    result.baseRate = 0.3;
    result.appliedRule = '年齢不明→3割仮定';
  } else if (parsed.insuranceCategory === '後期高齢者' || parsed.houbetsu === '39') {
    // 後期高齢者
    result.insuranceCategory = '後期高齢者';
    const income = opt.incomeLevel || 'ippan';
    if (income === 'genzai3' || income === 'genzai2' || income === 'genzai1') {
      result.baseRate = 0.3;
      result.appliedRule = '後期高齢者・現役並み所得→3割';
      result.details.push('所得区分: 現役並み');
    } else if (income === 'itteijoh') {
      result.baseRate = 0.2;
      result.appliedRule = '後期高齢者・一定以上所得→2割（2022年10月〜）';
      result.details.push('所得区分: 一定以上（課税所得28万円以上）');
    } else {
      result.baseRate = 0.1;
      result.appliedRule = '後期高齢者・一般→1割';
      result.details.push('所得区分: 一般');
    }
  } else if (isPreSchool(dob)) {
    // 義務教育就学前
    result.baseRate = 0.2;
    result.appliedRule = '義務教育就学前（6歳年度末まで）→2割';
    result.details.push('年齢: ' + age + '歳（就学前）');
  } else if (age >= 70 && age < 75) {
    // 高齢受給者
    if (opt.elderCertRate !== undefined && opt.elderCertRate !== null) {
      result.baseRate = opt.elderCertRate;
      result.appliedRule = '高齢受給者証記載値→' + (opt.elderCertRate * 10) + '割';
      result.details.push('高齢受給者証の記載値を適用');
    } else {
      const income = opt.incomeLevel || 'ippan';
      if (income === 'genzai' || income === 'genzai1' || income === 'genzai2' || income === 'genzai3') {
        result.baseRate = 0.3;
        result.appliedRule = '70〜74歳・現役並み所得→3割';
      } else {
        result.baseRate = 0.2;
        result.appliedRule = '70〜74歳・一般→2割';
      }
      result.warnings.push('高齢受給者証の確認を推奨します');
    }
  } else if (age >= 75) {
    // 75歳以上だが法別39でない場合（障害認定等で後期高齢者の可能性）
    result.warnings.push('75歳以上ですが後期高齢者（法別39）ではありません。保険者番号を確認してください。');
    result.baseRate = 0.3;
    result.appliedRule = '69歳以下と同等（保険者番号要確認）';
  } else {
    // 6歳〜69歳
    result.baseRate = 0.3;
    result.appliedRule = '現役世代（6〜69歳）→3割';
    result.details.push('年齢: ' + age + '歳');
  }

  result.finalRate = result.baseRate;

  // Step 3: 公費負担の適用
  if (opt.kouhiNumber) {
    const kouhiPrefix = opt.kouhiNumber.replace(/[^0-9]/g, '').substring(0, 2);
    const kouhi = KOUHI_MAP[kouhiPrefix];
    if (kouhi) {
      result.kouhiApplied = true;
      result.kouhiName = kouhi.name;
      result.kouhiDetail = kouhi.burden;
      if (kouhi.rate !== null) {
        result.finalRate = Math.min(result.baseRate, kouhi.rate);
      }
      result.details.push('公費: ' + kouhi.name + '（' + kouhi.burden + '）');
    } else {
      // 法別80-89: 地方単独事業
      const num = parseInt(kouhiPrefix, 10);
      if (num >= 80 && num <= 89) {
        result.kouhiApplied = true;
        result.kouhiName = '地方単独事業（法別' + kouhiPrefix + '）';
        result.kouhiDetail = '自治体により異なります';
        result.warnings.push('地方単独事業（法別' + kouhiPrefix + '）の負担割合は自治体ごとに異なります。手動で確認してください。');
      } else {
        result.warnings.push('不明な公費番号: ' + opt.kouhiNumber);
      }
    }
  }

  // ラベル生成
  const pct = Math.round(result.finalRate * 10);
  result.rateLabel = pct + '割';
  if (result.finalRate === 0.05) result.rateLabel = '5%';
  if (result.finalRate === 0) result.rateLabel = '0割（公費）';

  // 保険種別ラベル
  if (result.insuranceCategory === '後期高齢者') {
    result.insuranceLabel = '後期高齢者' + result.rateLabel;
  } else if (result.finalRate === 0 && result.kouhiApplied) {
    result.insuranceLabel = '公費';
  } else {
    result.insuranceLabel = result.insuranceCategory + result.rateLabel;
  }

  return result;
}

// ===================================================================
// UIヘルパー
// ===================================================================

/**
 * 判定結果をHTMLとして整形
 */
function formatCalcResultHTML(result) {
  let html = '<div class="calc-result">';

  // 保険者番号解析
  const p = result.insurerParsed;
  if (p.cleaned) {
    html += '<div class="calc-section">';
    html += '<div class="calc-label">保険者番号解析</div>';
    html += '<div class="calc-row"><span>番号:</span><span class="calc-mono">' + p.cleaned + '</span>';
    html += p.valid ? '<span class="calc-ok">✓ 有効</span>' : '<span class="calc-ng">✗ ' + p.errors.join(', ') + '</span>';
    html += '</div>';
    if (p.houbetsuName) html += '<div class="calc-row"><span>種別:</span><span>' + p.houbetsuName + '</span></div>';
    if (p.prefName && p.prefName !== '不明') html += '<div class="calc-row"><span>都道府県:</span><span>' + p.prefName + '</span></div>';
    html += '</div>';
  }

  // 判定結果
  html += '<div class="calc-section">';
  html += '<div class="calc-label">負担割合判定</div>';
  html += '<div class="calc-rate">' + result.rateLabel + '</div>';
  html += '<div class="calc-rule">' + result.appliedRule + '</div>';
  result.details.forEach(function(d) {
    html += '<div class="calc-detail">' + d + '</div>';
  });
  html += '</div>';

  // 警告
  if (result.warnings.length > 0) {
    html += '<div class="calc-section calc-warnings">';
    html += '<div class="calc-label">注意事項</div>';
    result.warnings.forEach(function(w) {
      html += '<div class="calc-warning">⚠ ' + w + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}
