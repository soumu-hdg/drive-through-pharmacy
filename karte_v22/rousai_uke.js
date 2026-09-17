/**
 * rousai_uke.js - 労災レセプト電算（RREC）  カルテ v22
 *
 * 労災の診療費を専用用紙に書き写さず、労災レセプト電算処理システム用の電子ファイルで出す。
 * 書き方は医科のUKEと同じ決まり（uke_format.js）に、労災だけのレコードを足したもの。
 *
 *   IR 医療機関 → [ RE 患者 → RR 労災の内訳 → SY 傷病名 → RI/IY 明細 ] × 件数 → RS 請求書
 *   ・ファイル名は RRECnn00.UKE。初回（新規・転医始診・再発）は監督署ごとに分け、継続分は1ファイル
 *   ・金額は「点数×12円」＋「労災で円建ての項目（初診料3,850円・再診料1,430円など）」
 *   ・労災で読み替えるコード（初診料・再診料・外来管理加算）は master/rousai_codes.json の replace
 *   ・患者の一部負担金は無い
 */

// 当院の労災の請求情報（RS レコード）
var ROUSAI_FACILITY = {
  laborCode: '2392381',                     // 労災指定医療機関番号
  postal: '4810041',
  address: '愛知県　北名古屋市九之坪北浦31',
  founder: '島原立樹',                      // 開設者氏名
  facilityType: '3',                        // 医療機関区分
  pointUnit: 1200,                          // 1点単価（円×100）＝12円
  bureau: '23'                              // 都道府県労働局（愛知）
};

var ROUSAI_UKE_COUNTS = { IR: 10, RE: 38, RR: 22, SY: 8, RI: 44, IY: 44, TO: 48, CO: 5, SJ: 3, RS: 13 };
var ROUSAI_INITIAL_CODES = { '1': true, '3': true, '7': true };    // 新規・転医始診・再発

var ROUSAI_CODE_TABLE = null;
async function rousaiLoadCodeTable() {
  if (ROUSAI_CODE_TABLE) return ROUSAI_CODE_TABLE;
  try {
    var res = await fetch('master/rousai_codes.json?v=20260917');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    ROUSAI_CODE_TABLE = await res.json();
  } catch (e) {
    console.warn('[労災UKE] 労災マスタを読めませんでした:', e);
    ROUSAI_CODE_TABLE = { replace: {}, codes: {} };
  }
  return ROUSAI_CODE_TABLE;
}

// 労働者カナ: 全角カタカナ、姓と名の間は全角スペース1つ
function rousaiWorkerKana(value) {
  var t = String(value || '');
  if (t.normalize) t = t.normalize('NFKC');
  t = t.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  return t.trim().split(/[\s　]+/).filter(Boolean).join('　');
}

// 患者の労災情報 → レセ電の区分
function rousaiClaimInfo(r, serviceYm, dates) {
  r = r || {};
  var accident = (r.formType === '16-3' || r.accidentType === '3') ? '3' : '1';     // 1業務災害 / 3通勤災害
  var start = ukeDate(r.startDate);
  var newCode = r.newContinuing ||
    ((start && start.slice(0, 6) === serviceYm) || (!start && dates.length && ukeDate(r.accidentDate).slice(0, 6) === serviceYm) ? '1' : '5');
  return {
    accident: accident,
    formType: r.pensionNo ? '5' : '3',                                               // 入院外用（年金は傷病年金用）
    pension: ukeDigits(r.pensionNo),
    laborNo: ukeDigits(r.no),
    injuryDate: ukeDate(r.accidentDate),
    newContinuing: newCode,
    outcome: r.outcome || '3',                                                       // 既定は継続
    bureau: ukeDigits(r.bureauCode || ROUSAI_FACILITY.bureau).slice(0, 2),
    office: ukeDigits(r.officeCode).slice(0, 2),
    businessName: r.office || '',
    businessAddr: r.officeAddr || '',
    course: r.course || '',
    initial: !!ROUSAI_INITIAL_CODES[newCode]
  };
}

// 受診（{patient, karte, visitDate}）を 患者×災害 ごとに1枚へまとめる
function rousaiGroupReceipts(records) {
  var map = new Map();
  records.forEach(function (pd) {
    var p = pd.patient || {};
    var r = (Array.isArray(p.rousai) && p.rousai.length) ? p.rousai[0] : {};
    var key = [p.id || p.name, ukeDigits(r.no), ukeDigits(r.pensionNo), ukeDate(r.accidentDate)].join('|');
    if (!map.has(key)) map.set(key, { patient: p, rousai: r, visits: [] });
    map.get(key).visits.push(pd);
  });
  var list = [];
  map.forEach(function (g) {
    g.visits.sort(function (a, b) { return String(a.visitDate).localeCompare(String(b.visitDate)); });
    list.push(g);
  });
  return list;
}

// 1枚ぶんの明細と金額
function rousaiReceiptItems(g) {
  var table = ROUSAI_CODE_TABLE || { replace: {}, codes: {} };
  var details = new Map();
  var days = [];
  var score = 0, subtotal = 0;
  g.visits.forEach(function (pd) {
    var day = parseInt(String(pd.visitDate || '').split('-')[2], 10) || 1;
    if (days.indexOf(day) === -1) days.push(day);
    var items = computeVisitItems(pd);
    items.si.forEach(function (s) {
      var code = table.replace[s.code] || s.code;
      var r = table.codes[code];
      var cat = r && r.s ? r.s : ukeServiceOf(code, s.cat);
      var yen = (r && r.k === '1') ? Math.round(r.a) : 0;
      var pts = (r && r.k === '3') ? Math.round(r.a) : (yen ? 0 : s.points);
      var key = 'RI|' + cat + '|' + code + '|' + pts + '|' + yen;
      if (!details.has(key)) details.set(key, { type: 'RI', cat: cat, code: code, points: pts, yen: yen, days: {} });
      var e = details.get(key);
      e.days[day] = (e.days[day] || 0) + 1;
      score += pts; subtotal += yen;
    });
    items.iy.forEach(function (x) {
      var cat = ukeDrugServiceOf(x.code, x.note);
      var key = 'IY|' + cat + '|' + x.code + '|' + x.qty + '|' + x.dayPoints;
      if (!details.has(key)) details.set(key, { type: 'IY', cat: cat, code: x.code, qty: x.qty, points: x.dayPoints, yen: 0, days: {} });
      var e = details.get(key);
      e.days[day] = (e.days[day] || 0) + x.days;
      score += x.dayPoints * x.days;
    });
  });
  days.sort(function (a, b) { return a - b; });
  var list = [];
  details.forEach(function (d) { list.push(d); });
  list.sort(function (a, b) {
    if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
    if (a.type !== b.type) return a.type === 'RI' ? -1 : 1;
    return 0;
  });
  var converted = Math.floor(score * ROUSAI_FACILITY.pointUnit / 100);
  return { details: list, days: days, score: score, converted: converted, subtotal: subtotal, total: converted + subtotal };
}

// 1枚ぶんの入力の点検（書き出す前）
function rousaiItemWarnings(g, info, dates) {
  var w = [];
  var p = g.patient || {};
  if (!p.name) w.push('患者氏名が未入力です');
  if (!sexToCode(String(p.sex || '').replace(/性$/, ''))) w.push('性別が未入力です');
  if (ukeDate(p.dob).length !== 8) w.push('生年月日を確認してください');
  if (info.pension && info.pension.length > 9) w.push('年金証書番号は9桁以内です');
  if (!info.pension && info.laborNo.length !== 14) w.push('労働保険番号は14桁で入力してください');
  if (!info.pension && info.injuryDate.length !== 8) w.push('災害発生年月日（傷病年月日）を入力してください');
  if (!dates.length) w.push('療養期間と診療実日数を確認できません');
  var kana = rousaiWorkerKana(p.nameKana || p.kana);
  if (!/^[ァ-ヶー]+(　[ァ-ヶー]+)+$/.test(kana)) w.push('労働者氏名カナを「姓 名」の形で登録してください（患者情報のカナ）');
  if (!ukeTextMode(info.course, true)) w.push('傷病の経過を入力してください（労災情報）');
  if (info.initial) {
    if (info.bureau.length !== 2) w.push('初回請求は都道府県労働局コード（2桁）が必要です');
    if (info.office.length !== 2) w.push('初回請求は労働基準監督署コード（2桁）が必要です');
    if (!info.businessName) w.push('初回請求は事業場の名称が必要です');
    if (!info.businessAddr) w.push('初回請求は事業場の所在地が必要です');
  }
  var hasDx = g.visits.some(function (pd) { return (pd.karte.selectedDiseases || []).length; });
  if (!hasDx) w.push('傷病名が未登録です');
  return w;
}

/**
 * 労災レセ電を作る
 * @param records  労災の受診 [{patient, karte, visitDate}]（patient.rousai を持つこと）
 * @param opts     { serviceYm:'YYYYMM', submitDate:'YYYY-MM-DD' }
 * @returns [{ filename, content, count, total, warnings:[…] }]
 */
function buildRousaiUke(records, opts) {
  opts = opts || {};
  var serviceYm = ukeMonth(opts.serviceYm);
  var submit = ukeDate(opts.submitDate) || ukeDate(new Date().toISOString());
  var receipts = rousaiGroupReceipts(records).map(function (g) {
    var dates = g.visits.map(function (pd) { return ukeDate(pd.visitDate); }).filter(Boolean);
    var info = rousaiClaimInfo(g.rousai, serviceYm, dates);
    return { g: g, info: info, dates: dates, calc: rousaiReceiptItems(g), warnings: rousaiItemWarnings(g, info, dates) };
  });

  // 初回は監督署ごと、継続は1つにまとめる
  var initial = {}, continuing = [];
  receipts.forEach(function (r) {
    if (r.info.initial) {
      var key = r.info.bureau + '|' + r.info.office;
      (initial[key] = initial[key] || []).push(r);
    } else continuing.push(r);
  });
  var files = Object.keys(initial).sort().map(function (k) { return initial[k]; });
  if (continuing.length) files.push(continuing);

  return files.map(function (list, fi) {
    var C = ROUSAI_UKE_COUNTS;
    var lines = [ukeMakeRecord('IR', {
      3: UKE_INST.pref, 4: UKE_INST.tensu, 5: UKE_INST.code, 7: UKE_INST.name,
      8: serviceYm, 9: '00', 10: ukePhone(UKE_INST.phone)
    }, C)];
    var total = 0, warnings = [];
    list.forEach(function (r, i) {
      var p = r.g.patient, info = r.info, calc = r.calc;
      r.warnings.forEach(function (m) { warnings.push((p.name || p.id) + '：' + m); });
      lines.push(ukeMakeRecord('RE', {
        2: i + 1, 5: p.name, 6: sexToCode(String(p.sex || '').replace(/性$/, '')), 7: ukeDate(p.dob), 14: p.id || ''
      }, C));
      lines.push(ukeMakeRecord('RR', {
        3: info.accident, 4: info.formType,
        5: info.pension,
        6: info.pension ? '' : (info.laborNo || '99999999999999'),
        7: info.pension ? '' : info.injuryDate,
        8: info.newContinuing, 9: info.outcome,
        10: r.dates[0] || '', 11: r.dates[r.dates.length - 1] || '', 12: calc.days.length,
        13: ukeTextMode(rousaiWorkerKana(p.nameKana || p.kana), true),
        14: ukeTextMode(info.businessName, true),
        15: ukeTextMode(info.businessAddr, true),
        16: ukeTextMode(info.course, true),
        17: calc.score, 18: calc.converted, 19: calc.subtotal, 22: calc.total
      }, C));
      // 傷病名（主病は karte の main、無ければ最初の傷病名）
      var syList = [], seen = {};
      r.g.visits.forEach(function (pd) {
        (pd.karte.selectedDiseases || []).forEach(function (d) {
          var code = resolveDiseaseCode(d);
          var key = code === '0000999' ? code + '|' + d.name : code;
          if (seen[key]) return;
          seen[key] = true;
          syList.push({ code: code, name: d.name || '', start: ukeDate(d.startDate || info.injuryDate || pd.visitDate), main: !!d.main });
        });
      });
      if (syList.length && !syList.some(function (s) { return s.main; })) syList[0].main = true;
      var mainDone = false;
      syList.forEach(function (s) {
        var isMain = s.main && !mainDone;
        if (isMain) mainDone = true;
        lines.push(ukeMakeRecord('SY', {
          2: s.code, 3: s.start, 4: '1', 6: s.code === '0000999' ? s.name : '', 7: isMain ? '01' : ''
        }, C));
      });
      // 明細
      calc.details.forEach(function (d) {
        var count = Object.keys(d.days).reduce(function (a, k) { return a + d.days[k]; }, 0);
        var rec;
        if (d.type === 'RI') rec = { 2: d.cat, 3: d.code, 5: d.points || '', 6: d.yen || '', 7: count };
        else rec = { 2: d.cat, 4: d.code, 5: d.qty, 6: d.points, 7: count };
        Object.keys(d.days).forEach(function (day) { rec[ukeDayPosition('SI', parseInt(day, 10))] = d.days[day]; });
        lines.push(ukeMakeRecord(d.type, rec, C));
      });
      total += calc.total;
    });
    var first = list[0];
    lines.push(ukeMakeRecord('RS', {
      2: ROUSAI_FACILITY.facilityType, 3: submit,
      4: first.info.initial ? first.info.bureau : '',
      5: first.info.initial ? first.info.office : '',
      6: ROUSAI_FACILITY.laborCode, 7: ukeZeroFill(ukeDigits(ROUSAI_FACILITY.postal), 7),
      8: ukeTextMode(ROUSAI_FACILITY.address, true), 9: ukeTextMode(ROUSAI_FACILITY.founder, true),
      10: ROUSAI_FACILITY.pointUnit, 11: total, 12: list.length, 13: '99'
    }, C));
    var content = ukeJoinLines(lines);
    rousaiValidateUke(content).forEach(function (m) { warnings.push(m); });
    return {
      filename: 'RREC' + ukeZeroFill(String(fi + 1), 2) + '00.UKE',
      content: content, count: list.length, total: total,
      initial: first.info.initial, warnings: warnings
    };
  });
}

// 出来上がった労災UKEを読み戻して形式を点検する
function rousaiValidateUke(content) {
  var w = [];
  var add = function (m) { if (w.indexOf(m) === -1) w.push(m); };
  if (!/\r\n\x1A$/.test(content) || (content.match(/\x1A/g) || []).length !== 1) add('労災UKEは最終CRLFの後にEOF（0x1A）を1つ記録してください');
  var rows = content.replace(/\x1A$/, '').replace(/\r\n$/, '').split('\r\n').map(function (l) { return l.split(','); });
  var kinds = rows.map(function (r) { return r[0]; });
  if (kinds[0] !== 'IR' || kinds.filter(function (k) { return k === 'IR'; }).length !== 1) add('労災UKEのIRは先頭に1件必要です');
  if (kinds[kinds.length - 1] !== 'RS' || kinds.filter(function (k) { return k === 'RS'; }).length !== 1) add('労災UKEのRSは末尾に1件必要です');
  var nums = [], totals = [], awaiting = false;
  rows.forEach(function (row, i) {
    var kind = row[0];
    if (awaiting && kind !== 'RR') { add('労災UKEのRE直後にRRがありません'); awaiting = false; }
    var n = ROUSAI_UKE_COUNTS[kind];
    if (!n) { add('労災UKE ' + (i + 1) + '行のレコード種別' + kind + 'は使用できません'); return; }
    if (row.length !== n) { add('労災UKE ' + kind + 'の項目数が不正です'); return; }
    if (kind === 'RE') { awaiting = true; nums.push(parseInt(row[1], 10)); }
    else if (kind === 'RR') { awaiting = false; totals.push(parseInt(row[21] || '0', 10)); }
    else if (['SY', 'RI', 'IY', 'TO', 'CO', 'SJ'].indexOf(kind) >= 0 && !nums.length) add('労災UKEの' + kind + 'に対応するREがありません');
  });
  if (awaiting) add('労災UKEのRE直後にRRがありません');
  if (nums.join() !== nums.map(function (_, i) { return i + 1; }).join()) add('労災UKEのレセプト番号は1からの連番で記録してください');
  var rs = rows[rows.length - 1];
  if (rs && rs[0] === 'RS' && rs.length === 13) {
    if (parseInt(rs[11], 10) !== nums.length) add('労災UKEのRS内訳書添付枚数とRE件数が一致しません');
    if (parseInt(rs[10], 10) !== totals.reduce(function (a, b) { return a + b; }, 0)) add('労災UKEのRS請求金額とRR合計額が一致しません');
    if (rs[12] !== '99') add('単一ボリュームの労災UKEはRS識別情報を99で記録してください');
  }
  return w;
}
