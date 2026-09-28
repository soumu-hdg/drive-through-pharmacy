// ===== 出来上がったUKEを読み戻して形式を点検する =====
// 提出前に「書いたものをもう一度読んで」確かめる。カルテ側のデータではなく、
// 出力そのものだけを見るので、作り方を変えても点検の基準は変わらない。
//   ・レコードの並び（先頭IR・末尾GO）と項目数
//   ・氏名の文字モード、保険者番号の右詰め8桁、カタカナ氏名
//   ・診療年月 < 請求年月、レセプト番号の連番
//   ・点数の読み戻し（明細の合計＝HO請求点数、GOの件数・点数）
//   ・受診日(JD)と算定日の対応、実日数の一致
// 戻り値: 文字列の配列（空なら形式上の問題なし）
// 修正6（2026-09-24）: 基準版の最新の読み戻し点検（validate_serialized_receipts）に合わせて項目を追加
//   CP932・氏名/カナの長さ・入院外の診療識別24（受付エラー2303）・保険証記号（3148/3177）・後期高齢の記号/番号（3173/3122/4151）
//   KO公費負担金額・所得区分の特記事項（3006/3008）・負担区分の英字コード
//   ※コメント（CO）の書式確認は基準版が公式コメントマスターを使うため、ここでは uke_ext.js の点検に任せる

var UKE_READBACK_BURDEN = { '1': [0], '2': [0, 1], '3': [0, 2], '4': [0, 1, 2], '5': [1], '6': [2], '7': [1, 2], '9': [0, 1, 2, 3, 4],
  'B': [3], 'C': [4], 'E': [0, 3], 'G': [0, 4], 'H': [1, 3], 'I': [1, 4], 'J': [2, 3], 'K': [2, 4], 'L': [3, 4],
  'M': [0, 1, 3], 'N': [0, 1, 4], 'O': [0, 2, 3], 'P': [0, 2, 4], 'Q': [0, 3, 4], 'R': [1, 2, 3], 'S': [1, 2, 4], 'T': [1, 3, 4],
  'U': [2, 3, 4], 'V': [0, 1, 2, 3], 'W': [0, 1, 2, 4], 'X': [0, 1, 3, 4], 'Y': [0, 2, 3, 4], 'Z': [1, 2, 3, 4] };
var UKE_HIGH_INCOME_NOTES = ['26', '27', '28', '31', '32', '33'];
var UKE_GENERAL_INCOME_NOTES = ['29', '30', '34', '35', '41', '42', '43', '44'];
var UKE_ELDERLY_ONLY_INCOME_NOTES = ['41', '42', '43', '44'];

// CP932 のバイト数（半角英数・半角カナは1、それ以外は2）
function ukeCp932Length(text) {
  var n = 0; text = String(text || '');
  for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); n += (c < 0x80 || (c >= 0xFF61 && c <= 0xFF9F)) ? 1 : 2; }
  return n;
}
// 公式の検証番号（7桁＋1桁）
function ukeInsuranceCheckDigit(base) {
  base = String(base || '').trim();
  if (!/^[0-9]{7}$/.test(base)) return '';
  var total = 0;
  base.split('').reverse().forEach(function (ch, offset) { var p = parseInt(ch, 10) * (offset % 2 === 0 ? 2 : 1); total += Math.floor(p / 10) + p % 10; });
  return String((10 - total % 10) % 10);
}
// 保険証記号の受付エラー（基準版 ssk_insurance_symbol_error）
function ukeSymbolError(insurerNumber, symbol) {
  var insurer = ukeDigits(insurerNumber), value = String(symbol || '').trim();
  if (insurer.slice(0, 2) === '01' && value && !/^[0-9]{7,8}$/.test(value)) return '協会管掌（法別01）の保険証記号は数字7桁または8桁で入力してください（受付エラー3148）';
  if ((insurer.slice(0, 2) === '06' || insurer.slice(0, 2) === '63') && value) {
    var ok = insurer === '06110829' ? /^(?:[A-Za-z][0-9]+|[0-9]+)$/.test(value) : /^[0-9]+$/.test(value);
    if (!ok) return '組合管掌等（法別06・63）の保険証記号は数字で入力してください（受付エラー3177）';
  }
  return null;
}
// 後期高齢の記号・番号（基準版 ssk_elderly_qualification_errors）
function ukeElderlyErrors(insurerNumber, symbol, number) {
  if (!ukeIsElderlyInsurer(insurerNumber)) return [];
  var errors = [];
  if (String(symbol || '').trim()) errors.push('後期高齢者レセプトには被保険者資格の記号を記録できません（受付エラー3173）');
  var n = String(number || '').trim();
  if (!/^[0-9]{8}$/.test(n)) {
    errors.push('後期高齢者の被保険者番号は数字8桁で入力してください（受付エラー3122）');
    errors.push('後期高齢者の被保険者番号の検証番号が一致しません（受付エラー4151）');
  } else if (ukeInsuranceCheckDigit(n.slice(0, 7)) !== n.slice(7)) {
    errors.push('後期高齢者の被保険者番号の検証番号が一致しません（受付エラー4151）');
  }
  return errors;
}
// 高齢受給者・後期高齢者の所得区分の特記事項（基準版 income_special_note_warnings）
function ukeIncomeNoteWarnings(receiptType, insurerNumber, notes) {
  var t = ukeDigits(receiptType), person = t.length === 4 ? t.slice(3) : '';
  if (person !== '0' && person !== '8') return [];
  var raw = ukeDigits(notes), codes = [];
  for (var i = 0; i + 1 < raw.length; i += 2) codes.push(raw.slice(i, i + 2));
  var has = function (list) { return codes.some(function (c) { return list.indexOf(c) !== -1; }); };
  var allowed = person === '0' ? UKE_HIGH_INCOME_NOTES : UKE_GENERAL_INCOME_NOTES;
  if (!has(allowed)) return ['高齢受給者・後期高齢者レセプトの特記事項に所得区分を記録してください（受付エラー3006）'];
  if (person === '0' && has(UKE_GENERAL_INCOME_NOTES)) return ['高齢受給者7割レセプトに一般所得区分の特記事項は記録できません（受付エラー3008）'];
  if (person === '8' && has(UKE_HIGH_INCOME_NOTES)) return ['高齢受給者一般レセプトに現役並み所得区分の特記事項は記録できません（受付エラー3008）'];
  if (!ukeIsElderlyInsurer(insurerNumber) && has(UKE_ELDERLY_ONLY_INCOME_NOTES)) return ['後期高齢者専用の所得区分特記事項は国保高齢受給者には記録できません（受付エラー3008）'];
  return [];
}

function ukeValidate(content) {
  var warnings = [];
  var add = function (m) { if (warnings.indexOf(m) === -1) warnings.push(m); };
  if (!content) return ['UKEが空です'];
  if (typeof ukeCanEncodeCp932 === 'function' && !ukeCanEncodeCp932(content.replace(/\x1A$/, ''))) add('UKEにCP932で記録できない文字が含まれています');

  if (!/\r\n\x1A$/.test(content) || (content.match(/\x1A/g) || []).length !== 1) {
    add('UKE末尾はCRLFとEOF（0x1A）を1つ記録してください');
  }
  if (/(^|[^\r])\n|\r(?!\n)/.test(content.replace(/\x1A$/, ''))) {
    add('UKEの改行はCRLFで記録してください');
  }
  var body = content.replace(/\x1A$/, '').replace(/\r\n$/, '');
  var rows = body.split('\r\n').map(function (line) { return line.split(','); });

  var kinds = rows.map(function (r) { return r[0] || ''; });
  if (kinds.filter(function (k) { return k === 'IR'; }).length !== 1 || kinds[0] !== 'IR') add('UKE IRは先頭に1件必要です');
  if (kinds.filter(function (k) { return k === 'GO'; }).length !== 1 || kinds[kinds.length - 1] !== 'GO') add('UKE GOは末尾に1件必要です');

  var integer = function (value, label, optional) {
    if ((value || !optional) && !/^[0-9]+$/.test(value || '')) { add('UKE ' + label + 'は非負の整数で記録してください'); return 0; }
    return parseInt(value || '0', 10);
  };
  var monthDays = function (ym) {
    if (!/^\d{6}$/.test(ym)) return 31;
    return new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(4), 10), 0).getDate();
  };
  var receipts = [], current = null, total = null, claimMonth = '';
  rows.forEach(function (row, idx) {
    var line = idx + 1;
    var kind = row[0];
    if (!kind) { add('UKE ' + line + '行に空行があります'); return; }
    if (!UKE_FIELD_COUNTS[kind]) { add('UKE ' + line + '行のレコード種別' + kind + 'はこの点検の対象外です'); return; }
    if (kind === 'IR' || kind === 'RE' || kind === 'GO') current = null;
    if (row.length !== UKE_FIELD_COUNTS[kind]) { add('UKE ' + kind + ' の項目数が不正です（' + row.length + '／正: ' + UKE_FIELD_COUNTS[kind] + '）'); return; }

    if (kind === 'IR') {
      claimMonth = row[7];
      if (!/^\d{4}(0[1-9]|1[0-2])$/.test(claimMonth)) add('UKE IRの請求年月が不正です');
    } else if (kind === 'RE') {
      if (integer(row[1], 'REレセプト番号') !== receipts.length + 1) add('UKE REレセプト番号は1からの連番で記録してください');
      if (!/^\d{4}(0[1-9]|1[0-2])$/.test(row[3]) || row[3] >= claimMonth) add(row[13] + ': 診療年月は請求年月より前の月にしてください');
      if (row[4] !== ukeTextMode(row[4]) || ukeCp932Length(row[4]) > 40) add(row[13] + ': UKE氏名の文字モード・長さが不正です');
      if (row[36] && (!/^[ァ-ヶー]+$/.test(row[36]) || ukeCp932Length(row[36]) > 80)) add(row[13] + ': UKEカタカナ氏名が不正です');
      if (row[7] && (!/^[0-9]{1,3}$/.test(row[7]) || parseInt(row[7], 10) > 100)) add(row[13] + ': UKE RE給付割合が不正です');
      current = {
        patient: row[13] || row[4], score: 0, insurance: null, pub: [], covered: [0, 0, 0, 0, 0],
        monthDays: monthDays(row[3]), visitDays: {}, jd: {}, detailDays: {}, usedPayers: {},
        benefitRate: row[7], insurerNumber: '', lastService: 0, inServiceUnit: false, receiptType: row[2], specialNotes: row[11]
      };
      receipts.push(current);
    } else if (kind === 'GO') {
      total = [integer(row[1], 'GO総件数'), integer(row[2], 'GO総合計点数')];
      if (row[3] !== '99') add('UKE分割ボリュームはこの点検の対象外です（通常出力は99）');
    } else if (current) {
      if (kind === 'HO') {
        if (current.insurance !== null) add(current.patient + ': UKE HOが同一RE内で重複しています');
        current.insurance = integer(row[5], 'HO請求点数');
        current.insurerNumber = row[1];
        current.visitDays['1'] = integer(row[4], 'HO実日数');
        if (row[1].length !== 8 || !/^ *[0-9]+$/.test(row[1])) add(current.patient + ': UKE保険者番号は右詰め8桁で記録してください');
        else if ([6, 8].indexOf(row[1].trim().length) === -1) add(current.patient + ': 保険者番号の桁数を確認してください（6桁または8桁）');
        var symErr = ukeSymbolError(row[1], row[2]);
        if (symErr) add(current.patient + ': UKE ' + symErr);
        ukeElderlyErrors(row[1], row[2], row[3]).forEach(function (m) { add(current.patient + ': UKE ' + m); });
      } else if (kind === 'KO') {
        current.pub.push(integer(row[5], 'KO請求点数'));
        current.visitDays[String(current.pub.length + 1)] = integer(row[4], 'KO実日数');
        if (row[6] && !/^[0-9]{1,8}$/.test(row[6])) add(current.patient + ': UKE KO公費負担金額は8桁以内の非負整数です');
      } else if (kind === 'MF') {
        if (['00', '01', '02'].indexOf(row[1]) === -1 || row.slice(2).some(function (v) { return !!v; })) {
          add(current.patient + ': UKE MFの区分・予備欄が不正です');
        }
      } else if (kind === 'JD') {
        if (current.jd[row[1]]) add(current.patient + ': UKE JDの負担者種別が重複しています');
        current.jd[row[1]] = row.slice(2);
        if (['1', '2', '3', '4', '5'].indexOf(row[1]) === -1 ||
            row.slice(2).some(function (v) { return v !== '' && v !== '1' && v !== '2'; })) {
          add(current.patient + ': UKE JDの負担者種別・受診日区分が不正です');
        }
        if (row.slice(2 + current.monthDays).some(function (v) { return !!v; })) {
          add(current.patient + ': UKE JDに診療月に存在しない日があります');
        }
      } else if (kind === 'SI' || kind === 'IY' || kind === 'TO') {
        if (!current.inServiceUnit) {
          var service = integer(row[1], kind + '診療識別');
          if (service === 24 && /[02468]$/.test(current.receiptType || '')) add(current.patient + ': 入院外レセプトに診療識別24は記録できません（受付エラー2303）');
          if (service < current.lastService) add(current.patient + ': UKE診療識別が一連の行為単位で昇順になっていません');
          current.lastService = service;
        }
        current.inServiceUnit = !(row[5] || row[6]);
        var count = integer(row[6], kind + '回数', true);
        var score = integer(row[5], kind + '点数', true) * count;
        if (!!row[5] !== !!row[6]) add(current.patient + ': UKE ' + kind + 'の点数と回数の組合せが不正です');
        current.score += score;
        var payers = UKE_READBACK_BURDEN[row[2]];
        if (!payers) add(current.patient + ': UKE ' + kind + 'の負担区分が不正です');
        (payers || []).forEach(function (p) { current.usedPayers[p] = true; current.covered[p] += score; });
        var start = (kind === 'TO') ? 17 : 13;
        var days = row.slice(start, start + 31).map(function (v) { return integer(v, kind + '算定日回数', true); });
        days.forEach(function (v, i) { if (v) current.detailDays[i + 1] = true; });
        if (days.slice(current.monthDays).some(function (v) { return !!v; })) {
          add(current.patient + ': UKE ' + kind + 'に診療月に存在しない算定日があります');
        }
        if (days.reduce(function (a, b) { return a + b; }, 0) !== count) {
          add(current.patient + ': UKEの算定日回数と総回数が一致しません');
        }
      }
    } else {
      add('UKE ' + line + '行の' + kind + 'に対応するREがありません');
    }
  });

  receipts.forEach(function (r) {
    if (r.benefitRate && r.benefitRate !== '30' && !ukeIsKokuhoInsurer(r.insurerNumber)) {
      add(r.patient + ': UKE RE給付割合は国民健康保険以外では原則省略してください');
    }
    if (r.inServiceUnit) add(r.patient + ': UKE一連の行為の終端行がありません');
    ukeIncomeNoteWarnings(r.receiptType, r.insurerNumber, r.specialNotes).forEach(function (m) { add(r.patient + ': UKE ' + m); });
    if (r.insurance === null && !r.pub.length) add(r.patient + ': UKE REにHO・KOのいずれもありません');
    if (r.pub.length > 4) add(r.patient + ': UKE KOが4件を超えています');
    var actual = {};
    if (r.insurance !== null) actual[0] = true;
    for (var i = 1; i <= r.pub.length; i++) actual[i] = true;
    if (Object.keys(r.usedPayers).some(function (p) { return !actual[p]; })) {
      add(r.patient + ': UKE明細の負担区分に対応するHO・KOがありません');
    }
    if (Object.keys(r.jd).sort().join() !== Object.keys(r.visitDays).sort().join()) {
      add(r.patient + ': UKE JDとHO・KOの負担者が一致しません');
    }
    Object.keys(r.visitDays).forEach(function (payer) {
      var marked = (r.jd[payer] || []).filter(function (v) { return v === '1'; }).length;
      if (marked !== r.visitDays[payer]) add(r.patient + ': UKE JDの受診日数とHO・KOの実日数が一致しません（負担者' + payer + '）');
    });
    var recorded = {};
    Object.keys(r.jd).forEach(function (p) {
      (r.jd[p] || []).forEach(function (v, i) { if (v) recorded[i + 1] = true; });
    });
    if (Object.keys(r.detailDays).some(function (d) { return !recorded[d]; })) {
      add(r.patient + ': UKE算定日に対応するJDの受診日等がありません');
    }
    if (r.insurance !== null && r.covered[0] !== r.insurance) {
      add(r.patient + ': UKE読戻し点数がHO請求点数と一致しません（明細 ' + r.covered[0] + '点 ／ HO ' + r.insurance + '点）');
    }
    r.pub.slice(0, 4).forEach(function (score, i) {
      if (score !== r.covered[i + 1]) add(r.patient + ': UKE公費対象明細とKO請求点数が一致しません（第' + (i + 1) + '公費）');
    });
  });

  var expectCount = receipts.reduce(function (a, r) { return a + (r.insurance !== null ? 1 : 0) + r.pub.length; }, 0);
  var expectScore = receipts.reduce(function (a, r) { return a + (r.insurance !== null ? r.insurance : (r.pub[0] || 0)); }, 0);
  if (!total || total[0] !== expectCount || total[1] !== expectScore) {
    add('UKE読戻しの件数・点数とGO合計が一致しません（RE ' + receipts.length + '件、HO+KO ' + expectCount +
        '件、主保険点数 ' + expectScore + '点、GO記録 ' + (total ? total.join('件/') + '点' : 'なし') + '）');
  }
  return warnings;
}
