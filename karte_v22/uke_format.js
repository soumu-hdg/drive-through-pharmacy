// ===== UKE（レセプト電算処理システム）の記録様式 =====
// 提出が通っている出力に合わせた低レベルの整形。値の作り方は uke_generator.js 側、
// 「どの位置に・どんな文字で入れるか」だけをここに集める。
//
// ■ 位置の数え方: 1 = レコード種別（IR/RE/HO…）、2 = その次の項目。仕様書の項目番号と同じ。
// ■ 文字: カンマ・引用符・改行は項目に入れない。全角モード（下記）とカタカナの正規化を掛ける。
// ■ 改行は CRLF、ファイル末尾は CRLF + EOF(0x1A)、文字コードは Shift_JIS(CP932)。

var UKE_FIELD_COUNTS = {
  IR: 10, RE: 38, HO: 15, KO: 12, SN: 9, JD: 33, MF: 33,
  SY: 8, SI: 44, IY: 44, TO: 48, CO: 5, SJ: 3, GO: 4
};

// 負担区分（明細の第3項目）→ 対象の負担者（0=保険, 1=第1公費, 2=第2公費…）
var UKE_BURDEN_PAYERS = {
  '1': [0], '2': [0, 1], '3': [0, 2], '4': [0, 1, 2],
  '5': [1], '6': [2], '7': [1, 2], '9': [0, 1, 2, 3, 4]
};

// 項目の中身を安全にする（カンマ・引用符・改行は項目区切りを壊すので落とす）
function ukeCleanField(value) {
  if (value === null || value === undefined) return '';
  var text = String(value);
  text = text.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  text = text.replace(/,/g, ' ').replace(/"/g, '');
  // 全角スペースは残す（漢字項目の区切りに使う）。半角の空白だけを1つにまとめる
  return text.replace(/[ 	 ]+/g, ' ').replace(/^ +| +$/g, '');
}

// 文字モード。半角カナは全角へ直し、全角文字が混じる項目は英数字も全角にそろえる。
function ukeTextMode(value, forceFullWidth) {
  var text = ukeCleanField(value).replace(/[｡-ﾟ]+/g, function (m) {
    return m.normalize ? m.normalize('NFKC') : m;
  });
  var hasWide = /[^\x00-\x7F]/.test(text);
  if (!forceFullWidth && !hasWide) return text;
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (ch === ' ') out += '　';
    else if (ch >= '!' && ch <= '~') out += String.fromCharCode(ch.charCodeAt(0) + 0xFEE0);
    else out += ch;
  }
  return out;
}

// カタカナ氏名。全角カタカナへそろえ、空白は入れない。
function ukeKana(value) {
  var text = String(value === null || value === undefined ? '' : value);
  if (text.normalize) text = text.normalize('NFKC');
  text = text.replace(/\s+/g, '');
  // ひらがな→カタカナ（現場入力のゆれを吸収）
  text = text.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  return text;
}

function ukeDigits(value) { return String(value === null || value === undefined ? '' : value).replace(/\D+/g, ''); }

function ukeZeroFill(value, length) {
  var text = String(value === null || value === undefined ? '' : value);
  if (!text) return '';
  while (text.length < length) text = '0' + text;
  return text;
}

function ukePhone(value) { return String(value || '').trim().replace(/[^\d+\-()]/g, ''); }

// 日付 → YYYYMMDD
function ukeDate(value) {
  var d = ukeDigits(value);
  return d.length >= 8 ? d.slice(0, 8) : '';
}

// 年月 → YYYYMM
function ukeMonth(value) {
  var d = ukeDigits(value);
  return d.length >= 6 ? d.slice(0, 6) : d;
}

// 国民健康保険の保険者番号か（6桁、または法別番号 00/67 の8桁）。後期高齢者(39)は含めない。
function ukeIsKokuhoInsurer(value) {
  var d = ukeDigits(value);
  return d.length === 6 || (d.length === 8 && (d.slice(0, 2) === '00' || d.slice(0, 2) === '67'));
}
function ukeIsElderlyInsurer(value) { return ukeDigits(value).slice(0, 2) === '39'; }

// 翌月（請求年月は診療年月の翌月が既定）
function ukeNextMonth(value) {
  var m = ukeMonth(value);
  if (!/^\d{6}$/.test(m)) return '';
  var y = parseInt(m.slice(0, 4), 10), n = parseInt(m.slice(4), 10);
  if (n < 1 || n > 12) return '';
  return (n === 12 ? (y + 1) : y) + ukeZeroFill(String(n % 12 + 1), 2);
}

// 位置を指定して1レコードを組み立てる（指定の無い項目は空。項目数は種別ごとに固定）
//   counts を渡すと項目数の表を差し替える（労災レセ電は RE/RR/RI/RS など別の表）
function ukeMakeRecord(type, valuesByPosition, counts) {
  var n = (counts || UKE_FIELD_COUNTS)[type];
  if (!n) throw new Error('未知のレコード種別: ' + type);
  var f = [];
  for (var i = 0; i < n; i++) f.push('');
  f[0] = type;
  Object.keys(valuesByPosition || {}).forEach(function (key) {
    var pos = parseInt(key, 10);
    var v = valuesByPosition[key];
    if (pos > 1 && pos <= n && v !== null && v !== undefined && v !== '') f[pos - 1] = ukeCleanField(v);
  });
  // 種別ごとの文字の決まり（提出が通っている出力と同じにする）
  if (type === 'IR') f[6] = ukeTextMode(valuesByPosition[7], true);            // 医療機関名は全角
  if (type === 'RE') {
    f[4] = ukeTextMode(valuesByPosition[5]);                                   // 氏名
    f[36] = ukeKana(valuesByPosition[37]);                                     // カタカナ氏名
  }
  if (type === 'HO') {
    if (f[1]) { while (f[1].length < 8) f[1] = ' ' + f[1]; }                   // 保険者番号は右詰め8桁
    f[2] = ukeTextMode(valuesByPosition[3]);                                   // 記号
    f[3] = ukeTextMode(valuesByPosition[4]);                                   // 番号
  }
  if (type === 'CO' && f[3] === '810000001') f[4] = ukeTextMode(valuesByPosition[5], true);
  return f.join(',');
}

// 算定日の位置（SI/IY は14番目から、TO は18番目から）
function ukeDayPosition(type, day) {
  if (!(day >= 1 && day <= 31)) return 0;
  return (type === 'TO' ? 18 : 14) + day - 1;
}

// ファイルの綴じ方: CRLF 区切り＋末尾に EOF(0x1A)
function ukeJoinLines(lines) { return lines.join('\r\n') + '\r\n\x1A'; }

// Shift_JIS(CP932) のバイト列にする。変換ライブラリが無い場合は null を返す。
function ukeToSjisBytes(text) {
  try {
    if (typeof Encoding !== 'undefined' && Encoding.convert && Encoding.stringToCode) {
      return new Uint8Array(Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }));
    }
  } catch (e) { console.warn('[UKE] Shift_JIS変換に失敗:', e); }
  return null;
}
