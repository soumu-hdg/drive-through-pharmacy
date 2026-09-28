// ===== 提出用の帳票（SVG 描画＋PDF 化） receipt_ledger_svg.js =====
// 基準版の提出用帳票 5 種を、基準版と同じ座標・同じ文字・同じ文字の大きさで SVG ページ（文字列の配列）に組む。
//   ・光ディスク等送付書（discSubmission）
//   ・社保総括表／返戻用社保総括表（socialSummary）
//   ・国保総括表（一覧）（nationalList）
//   ・返戻用国保総括表（nationalReturnSummary）
//   ・返戻用国保請求書／返戻用後期高齢者請求書（nationalReturnInvoice）
// 作り方は点検用様式（rezept_form_svg.js / rezept_form_pdf.js）と同じ:
//   ・座標は A4 縦（595×842pt）・上原点。文字は1文字ずつ位置を決めて置き（<text> 1つ＝1文字）、PDF 化は RezeptFormPdf が行う。
//   ・文字の幅は IPAゴシック（全角 1000／半角 500）と DejaVuSans（U+0100 未満）の実寸で測る（基準版の振り分けと同じ）。
//   ・様式の下地（罫線・印字済みの文字）は基準版の様式データ（templates/*.json）をこのファイルの末尾に埋め込んで使う。
//     矩形・多角形・曲線・切り抜き・社保総括表の元様式（PDF 描画命令と書体）は、SVG の <path>/<g> に
//     「PDF にそのまま書く命令」（data-pdf）を持たせ、toPdf() が RezeptFormPdf の PDF に足す（RezeptFormPdf は <rect>/<text>/<line> だけを読む）。
//   ・社保総括表の元様式は PDF の描画命令のまま持つので、SVG を画面に出したときは下地が描かれない（PDF には入る）。
// 入力の形: 基準版の請求データ（1件＝月単位に束ねたレセプト1枚。receipt_claims.py の preview items と同じ項目名）。
//   使う項目: insurer_number, insurer_name, birth_date, billing_date, burden_ratio, relationship, visit_type,
//             visit_days（または actual_visit_days）, total_score, receipt_copayment{amount}, public_expenses[{payer_number, expense_type,
//             expense_type_name, scope, covered_score, burden_amount}], separate_public_expenses, meal_total_amount,
//             is_claim_included, claim_status, source_billings（あれば一部負担金・実日数の元）
//   施設: {medical_institution_code, prefecture_code, address, name, founder_name, phone}
// 依存: PDF 化のときだけ rezept_form_pdf.js（RezeptFormPdf）。SVG を組むだけなら依存なし。
// 使い方:
//   const pages = ReceiptLedgerSvg.socialSummary(items, facility, '202609', '20261005');
//   const blob = await ReceiptLedgerSvg.toPdf(pages, { title: '社保総括表' });

// var で宣言する（読み込んだ窓の window.ReceiptLedgerSvg として別の窓から参照できるように）
var ReceiptLedgerSvg = (() => {
  'use strict';

  // ============================================================
  // 定数（基準版と同じ値）
  // ============================================================
  const PAGE_WIDTH = 595.0;
  const PAGE_HEIGHT = 842.0;
  const TEXT_GRAY = 0.2;
  const LINE_WIDTH = 0.4;               // 1ページ目だけ設定される（2ページ目以降は PDF の既定 1.0。基準版と同じ）
  // 国保総括表（一覧）と返戻用請求書は、基準版では用紙の大きさを指定し直さないので reportlab の A4（21×29.7cm）のまま。
  // 描画の座標は他と同じ（下原点で 842 − y）なので、PDF の用紙枠（MediaBox）だけをこの大きさにする
  const A4_MEDIABOX = '0 0 595.2756 841.8898';
  const DEFAULT_FORM_UNIT = 0.58643616675;
  const SHEET_PX_W = 793;
  const SHEET_PX_H = 1122;
  const TEXT_EM = 100;                  // SVG 上で文字を組む大きさ（変換行列で実寸に縮める。rezept_form_svg.js と同じ）
  const GLYPH_NUDGE = 0.002;            // 文字の原点の寄せ（RezeptFormPdf が PDF 化で戻す）
  const FONT_GOTHIC = 'RzFormGothic';
  const FONT_LATIN = 'RzFormLatin';

  const PREFECTURE_CODES_BY_NAME = [
    ['北海道', '01'], ['青森', '02'], ['岩手', '03'], ['宮城', '04'], ['秋田', '05'], ['山形', '06'], ['福島', '07'],
    ['茨城', '08'], ['栃木', '09'], ['群馬', '10'], ['埼玉', '11'], ['千葉', '12'], ['東京', '13'], ['神奈川', '14'],
    ['新潟', '15'], ['富山', '16'], ['石川', '17'], ['福井', '18'], ['山梨', '19'], ['長野', '20'], ['岐阜', '21'],
    ['静岡', '22'], ['愛知', '23'], ['三重', '24'], ['滋賀', '25'], ['京都', '26'], ['大阪', '27'], ['兵庫', '28'],
    ['奈良', '29'], ['和歌山', '30'], ['鳥取', '31'], ['島根', '32'], ['岡山', '33'], ['広島', '34'], ['山口', '35'],
    ['徳島', '36'], ['香川', '37'], ['愛媛', '38'], ['高知', '39'], ['福岡', '40'], ['佐賀', '41'], ['長崎', '42'],
    ['熊本', '43'], ['大分', '44'], ['宮崎', '45'], ['鹿児島', '46'], ['沖縄', '47'],
  ];
  const RELATIONSHIP_CODES = { main: '1', self: '1', '本人': '1', '被保険者': '1', family: '2', dependent: '2', '家族': '2', '被扶養者': '2' };
  const LOCAL_PROGRAM_ALIASES = { child: 'aichi_child', disabled: 'aichi_disabled', single_parent: 'aichi_single_parent' };

  // ============================================================
  // 文字幅（reportlab の stringWidth と同じ計算: 0.001 × 大きさ × 送り幅の和）
  // ============================================================
  // DejaVuSans の送り幅（フォント単位 2048/em）。U+0020〜U+007E と U+00A0〜U+00FF。それ以外の U+0100 未満は既定幅 1229。
  const LATIN_ASCII = [651,821,942,1716,1303,1946,1597,563,799,799,1024,1716,651,739,651,690,1303,1303,1303,1303,1303,1303,1303,1303,1303,1303,690,690,1716,1716,1716,1087,2048,1401,1405,1430,1577,1294,1178,1587,1540,604,604,1343,1141,1767,1532,1612,1235,1612,1423,1300,1251,1499,1401,2025,1403,1251,1403,799,690,799,1716,1024,1024,1255,1300,1126,1300,1260,721,1300,1298,569,569,1186,569,1995,1298,1253,1300,1300,842,1067,803,1298,1212,1675,1212,1212,1075,1303,690,1303,1716];
  const LATIN_HIGH = [651,821,1303,1303,1303,1303,690,1024,1024,2048,965,1253,1716,739,2048,1024,1024,1716,821,821,1024,1303,1303,651,1024,821,965,1253,1985,1985,1985,1087,1401,1401,1401,1401,1401,1401,1995,1430,1294,1294,1294,1294,604,604,604,604,1587,1532,1612,1612,1612,1612,1612,1716,1612,1499,1499,1499,1499,1251,1239,1290,1255,1255,1255,1255,1255,1255,2011,1126,1260,1260,1260,1260,569,569,569,569,1253,1298,1253,1253,1253,1253,1253,1716,1253,1298,1298,1298,1298,1212,1300,1212];
  const LATIN_DEFAULT = 1229;
  // IPAゴシックは等幅: 全角 1000、半角 500。U+0100 以上で半角幅の文字の範囲（ipag.ttf の hmtx から抽出）
  const GOTHIC_HALF_RANGES = [[256,265],[268,271],[273,275],[280,285],[292,293],[295,295],[298,299],[308,309],[313,314],[317,318],[321,324],[327,328],[331,333],[336,341],[344,357],[362,369],[377,382],[403,403],[450,450],[504,505],[509,509],[592,602],[604,604],[606,609],[612,616],[620,627],[629,629],[633,635],[637,638],[641,644],[648,654],[656,658],[660,661],[664,664],[669,669],[673,674],[711,712],[716,716],[720,721],[728,729],[731,734],[741,745],[768,772],[774,774],[776,776],[779,780],[783,783],[792,794],[796,800],[804,805],[809,810],[812,812],[815,816],[820,820],[825,829],[865,865],[962,962],[7742,7743],[8048,8051],[8211,8211],[8226,8226],[8252,8252],[8255,8255],[8258,8258],[8263,8265],[8364,8364],[8463,8463],[8467,8467],[8487,8487],[8501,8501],[8531,8533],[8596,8596],[8598,8601],[8644,8644],[8678,8681],[8709,8709],[8713,8713],[8722,8723],[8742,8742],[8771,8771],[8773,8773],[8776,8776],[8802,8802],[8822,8823],[8836,8837],[8842,8843],[8853,8855],[8922,8923],[8965,8966],[9649,9649],[9654,9655],[9664,9665],[9673,9673],[9680,9683],[9702,9702],[9824,9831],[9833,9833],[9835,9836],[9838,9838],[10548,10549],[10746,10747],[65377,65439]];
  const EM_SCALE = 1000 / 2048;         // reportlab の _1000mult（両書体とも 2048/em）

  function isLatin(ch) { return ch.codePointAt(0) < 256; }
  /** 1文字の送り幅（1000分率・reportlab と同じ値） */
  function charWidth1000(ch) {
    const cp = ch.codePointAt(0);
    if (cp < 256) {
      let u;
      if (cp >= 32 && cp <= 126) u = LATIN_ASCII[cp - 32];
      else if (cp >= 160) u = LATIN_HIGH[cp - 160];
      else u = LATIN_DEFAULT;
      return u * EM_SCALE;
    }
    for (const [a, b] of GOTHIC_HALF_RANGES) {
      if (cp < a) break;
      if (cp <= b) return 1024 * EM_SCALE;
    }
    return 2048 * EM_SCALE;
  }
  /** reportlab の stringWidth（1つの書体の並び） */
  function runWidth(run, size) {
    let sum = 0;
    for (const ch of Array.from(run)) sum += charWidth1000(ch);
    return 0.001 * size * sum;
  }
  /** 文字列を「書体が同じ文字の並び」に分ける（基準版 receipt_font_runs と同じ） */
  function fontRuns(value) {
    const runs = [];
    for (const ch of Array.from(value)) {
      const latin = isLatin(ch);
      if (runs.length && runs[runs.length - 1][0] === latin) runs[runs.length - 1][1] += ch;
      else runs.push([latin, ch]);
    }
    return runs;
  }
  /** 基準版 receipt_text_width */
  function textWidth(value, size) {
    let total = 0;
    for (const [, run] of fontRuns(String(value))) total += runWidth(run, size);
    return total;
  }

  // ============================================================
  // 数値・文字の整形（基準版と同じ規則）
  // ============================================================
  /** Python の `value or ""` */
  function orEmpty(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === '' || (typeof v === 'number' && isNaN(v))) return '';
    if (Array.isArray(v) && !v.length) return '';
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return '';
    return v;
  }
  function str(v) { return String(orEmpty(v)); }
  function digitsOnly(v) { return str(v).replace(/\D+/g, ''); }
  function intValue(v, def) {
    if (def === undefined) def = 0;
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'object') return def;
    const n = Number(typeof v === 'string' ? v.trim() : v);
    if (typeof v === 'string' && !v.trim()) return def;
    if (!isFinite(n)) return def;
    return Math.trunc(n);
  }
  function firstPresent(src, ...keys) {
    for (const k of keys) { const v = src ? src[k] : undefined; if (v !== null && v !== undefined && v !== '') return v; }
    return null;
  }
  /** Python の f"{n:,}" */
  function comma(n) {
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '-' + s : s;
  }
  /** 基準版 _numbers: 0 は空欄 */
  function numbers(totals) { return totals.map((n) => (n ? comma(n) : '')); }
  function pad2(n) { return (n < 10 && n >= 0 ? '0' : '') + n; }

  /** 基準版 _era: 「令和 08 年 9 月分」「令和 08 年 10 月 5 日」 */
  function era(value, monthOnly) {
    const raw = digitsOnly(value);
    if (raw.length < 6) return str(value);
    const year = parseInt(raw.slice(0, 4), 10), month = parseInt(raw.slice(4, 6), 10);
    const label = year >= 2019 ? '令和 ' + pad2(year - 2018) + ' 年 ' + month + ' 月' : year + ' 年 ' + month + ' 月';
    return label + (!monthOnly && raw.length >= 8 ? ' ' + parseInt(raw.slice(6, 8), 10) + ' 日' : '分');
  }
  /** 基準版 _disc_submission_date（数字は全角） */
  function discDate(value, monthOnly) {
    const raw = digitsOnly(value);
    if (raw.length < 6) return str(value);
    const year = parseInt(raw.slice(0, 4), 10), month = parseInt(raw.slice(4, 6), 10);
    const e = year >= 2019 ? '令和' + pad2(year - 2018) + '年' : year + '年';
    let label = e + '　' + month + '月';
    label += monthOnly ? '診療（調剤）分' : raw.length >= 8 ? '　' + parseInt(raw.slice(6, 8), 10) + '日' : '';
    return label.replace(/[0-9]/g, (d) => String.fromCharCode(0xFF10 + (+d)));
  }

  // ---- 日付 ----
  /** Python 3.10 の date.fromisoformat(str(v)[:10])（YYYY-MM-DD だけを受ける）→ [y, m, d] / null */
  function isoDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v === null || v === undefined ? 'None' : v).slice(0, 10));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (!validDate(y, mo, d)) return null;
    return [y, mo, d];
  }
  function validDate(y, m, d) {
    if (y < 1 || m < 1 || m > 12 || d < 1) return false;
    const dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return d <= dim;
  }
  function cmpDate(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
  /** 基準版 is_senior_insurance_eligible（70歳到達の翌月1日〔1日生まれは当月1日〕から） */
  function isSeniorInsuranceEligible(birth, visit) {
    if (!birth) return false;
    const b = isoDate(birth);
    if (!b) return false;
    let year = b[0] + 70, month = b[1];
    if (b[2] !== 1) { if (month === 12) { year += 1; month = 1; } else month += 1; }
    if (!visit) return false;
    const v = isoDate(visit);
    if (!v) return false;
    return cmpDate(v, [year, month, 1]) >= 0;
  }
  /** 基準版 format_date_yyyymmdd → parse_yyyymmdd */
  function ymd(value) {
    const d = digitsOnly(value);
    if (d.length < 8) return null;
    const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6, 8);
    return validDate(y, m, dd) ? [y, m, dd] : null;
  }
  /** 基準版 is_preschool_child（6歳到達後の最初の3月31日まで） */
  function isPreschoolChild(item) {
    const birth = ymd(item.birth_date), visit = ymd(item.billing_date);
    if (!birth || !visit) return false;
    const sixth = validDate(birth[0] + 6, birth[1], birth[2]) ? [birth[0] + 6, birth[1], birth[2]] : [birth[0] + 6, 3, 1];
    const schoolYear = (birth[1] < 4 || (birth[1] === 4 && birth[2] <= 1)) ? sixth[0] : sixth[0] + 1;
    return cmpDate(visit, [schoolYear, 4, 1]) < 0;
  }
  function relationshipCode(v) { return RELATIONSHIP_CODES[str(v).trim().toLowerCase()] || ''; }
  function isElderlyInsurerNumber(v) { return digitsOnly(v).startsWith('39'); }
  function medicalInstitutionCode7(facility) {
    const code = digitsOnly(facility.medical_institution_code || facility.facility_code);
    return code.length >= 10 ? code.slice(-7) : code;
  }
  function facilityPrefectureCode(facility) {
    const explicit = digitsOnly(firstPresent(facility, 'prefecture_code', 'medical_prefecture_code'));
    if (explicit.length >= 2) return explicit.slice(0, 2);
    const code = digitsOnly(facility.medical_institution_code);
    if (code.length >= 10) return code.slice(0, 2);
    const hay = ['prefecture', 'address', 'name'].map((k) => str(facility[k])).join(' ');
    for (const [name, c] of PREFECTURE_CODES_BY_NAME) if (hay.includes(name)) return c;
    return '';
  }
  function prefectureLabel(facility) {
    const code = facilityPrefectureCode(facility);
    const hit = PREFECTURE_CODES_BY_NAME.find(([, c]) => c === code);
    const name = hit ? hit[0] : '';
    const suffix = (name === '' || name === '北海道') ? '' : name === '東京' ? '都' : (name === '大阪' || name === '京都') ? '府' : '県';
    return name + suffix;
  }
  function recipient(facility, payer) {
    return payer === 'kokuho' ? prefectureLabel(facility) + '国民健康保険団体連合会' : '社会保険診療報酬支払基金';
  }

  // ---- 請求データ ----
  function claimPayload(item) { const p = item && item.claim_payload; return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; }
  function publicExpenses(item) {
    const list = ('public_expenses' in item ? item.public_expenses : claimPayload(item).public_expenses) || [];
    return (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object' && !Array.isArray(e));
  }
  /**
   * 基準版 aggregate_receipts のうち「月単位に束ねたレセプト」を受けたときの処理
   * （請求から外したものを除き、claim_payload を下敷きにして、請求区分・入外を正規化する）
   */
  function aggregate(items) {
    const out = [];
    for (const raw of items || []) {
      if (raw.is_claim_included === false || ['exclude', 'month_delay', 'return_hold'].includes(raw.claim_status)) continue;
      let payload = raw.claim_payload || {};
      if (typeof payload === 'string') payload = JSON.parse(payload);
      const item = Object.assign({}, payload, raw);
      item.receipt_claim_type = item.receipt_claim_type || (item.claim_status === 'resubmit' ? 'resubmit' : 'normal');
      item.visit_type = ['inpatient', 'hospitalization', 'admission', '入院'].includes(str(item.visit_type).toLowerCase()) ? 'inpatient' : 'outpatient';
      out.push(item);
    }
    return out;
  }
  /** 基準版 counted_dates */
  function countedDates(item, payer) {
    const result = new Set();
    const sources = (item.source_billings && item.source_billings.length) ? item.source_billings : [item];
    for (const s of sources) {
      const codes = s.visit_day_codes;
      if (codes === null || codes === undefined || codes[payer] === '1') result.add(String(s.billing_date === undefined || s.billing_date === null ? 'None' : s.billing_date).slice(0, 10));
    }
    return Array.from(result);
  }
  /** 基準版 receipt_visit_days */
  function visitDays(item) {
    if (item.visit_day_codes !== null && item.visit_day_codes !== undefined) return countedDates(item, item.public_only ? '2' : '1').length;
    return Math.max(1, intValue(firstPresent(item, 'visit_days', 'actual_visit_days')));
  }
  /** 基準版 receipt_copayment の金額（月額の一部負担金。値が1つに決まらなければ空） */
  function copaymentAmount(item) {
    const sources = [item].concat(item.source_billings || []);
    const amounts = new Set();
    for (const s of sources) {
      for (const m of [s, claimPayload(s)]) {
        const e = m.receipt_copayment;
        if (e === null || e === undefined || typeof e !== 'object' || Array.isArray(e)) continue;
        const a = e.amount;
        if (a !== null && a !== undefined && a !== '' && typeof a !== 'boolean' && /^[0-9]{1,9}$/.test(String(a))) amounts.add(parseInt(String(a), 10));
      }
    }
    return amounts.size === 1 ? Array.from(amounts)[0] : '';
  }
  /** 基準版 claim_totals: [件数, 実日数, 点数, 一部負担金] */
  function claimTotals(items) {
    items = aggregate(items);
    let days = 0, score = 0, burden = 0;
    for (const it of items) { days += visitDays(it); score += intValue(it.total_score); burden += intValue(copaymentAmount(it)); }
    return [items.length, days, score, burden];
  }
  function groupBy(list, keyFn) {
    const m = new Map();
    for (const x of list) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ============================================================
  // 描画（SVG の組み立て）
  // ============================================================
  function num(v) { return String(v); }
  // PDF の数値の書き方（reportlab の fp_str と同じ: 有効数字およそ7桁・末尾の 0 を落とす）
  function fp(v) {
    if (!isFinite(v) || Math.abs(v) < 1e-9) return '0';
    const places = Math.min(10, Math.max(0, 6 - Math.floor(Math.log10(Math.abs(v)))));
    let s = v.toFixed(places);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function hex2(g) { return Math.round(g * 255).toString(16).padStart(2, '0'); }
  function grayHex(g) { const v = hex2(g); return '#' + v + v + v; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  class Sheet {
    constructor(firstPage, mediaBox) {
      this.parts = [];
      this.mediaBox = mediaBox || '';
      this.dy = 0;                      // 写しの縦ずれ（返戻用国保総括表の2枚目。上原点で下へ）
      this.pdfPrefix = '';              // 写しの座標変換（PDF 命令）
      if (firstPage) this.op(fp(LINE_WIDTH) + ' w');
    }
    /** 画面には何も描かず、PDF にだけ命令を足す */
    op(pdf) { this.parts.push('<g data-pdf="' + xmlEsc(pdf) + '"/>'); }
    /** PDF の命令と、同じ形を画面に描く <path> */
    path(d, attrs, pdf) { this.parts.push('<path d="' + d + '" ' + attrs + ' data-pdf="' + xmlEsc(pdf) + '"/>'); }
    /** 塗りつぶし矩形（PDF 座標＝下原点の x, y, w, h。基準版 pdf.rect(fill=1)） */
    fillRectPdf(x, y, w, h, gray) {
      const top = PAGE_HEIGHT - y - h + this.dy;
      const d = 'M' + num(x) + ' ' + num(top) + 'H' + num(x + w) + 'V' + num(top + h) + 'H' + num(x) + 'Z';
      this.path(d, 'fill="' + grayHex(gray) + '"', this.rg(gray) + ' n ' + fp(x) + ' ' + fp(y) + ' ' + fp(w) + ' ' + fp(h) + ' re f*');
    }
    rg(gray) { const g = fp(gray); return g + ' ' + g + ' ' + g + ' rg'; }
    /** 多角形・曲線（点は上原点。基準版は PAGE_HEIGHT − y で PDF に置く）。contours = [[op, [x, y]...]...] */
    fillContours(contours, gray) {
      let d = '', pdf = this.rg(gray);
      for (const contour of contours) {
        for (const [op, ...pts] of contour) {
          const svgPts = pts.map(([x, y]) => num(x) + ' ' + num(y + this.dy)).join(' ');
          const pdfPts = pts.map(([x, y]) => fp(x) + ' ' + fp(PAGE_HEIGHT - y)).join(' ');
          if (op === 'm') { d += 'M' + svgPts; pdf += ' ' + pdfPts + ' m'; }
          else if (op === 'l') { d += 'L' + svgPts; pdf += ' ' + pdfPts + ' l'; }
          else if (op === 'c') { d += 'C' + svgPts; pdf += ' ' + pdfPts + ' c'; }
          else if (op === 'h') { d += 'Z'; pdf += ' h'; }
        }
      }
      this.path(d, 'fill="' + grayHex(gray) + '" fill-rule="evenodd"', pdf + ' f*');
    }
    /** 枠線（上原点。基準版 _box = pdf.rect(stroke=1)。線の太さは PDF の現在値） */
    strokeBox(x, y, w, h, lineWidth) {
      const d = 'M' + num(x) + ' ' + num(y) + 'H' + num(x + w) + 'V' + num(y + h) + 'H' + num(x) + 'Z';
      this.path(d, 'fill="none" stroke="#000000" stroke-width="' + lineWidth + '"', 'n ' + fp(x) + ' ' + fp(PAGE_HEIGHT - y - h) + ' ' + fp(w) + ' ' + fp(h) + ' re S');
    }
    /**
     * 1文字（基線は上原点）。latin: DejaVuSans / それ以外: IPAゴシック
     * separate: 基準版が1文字ずつ別々に置く文字（様式の印字・記入欄）。RezeptFormPdf は同じ基線で送り幅どおりに続く文字を
     *   1つの並びにまとめるが、並びの中の文字は閲覧ソフトの位置の決め方がわずかに変わるので、基線を 1e-9pt だけ交互にずらして
     *   まとめさせない（PDF に書く座標は7桁に丸められるので値は変わらない）
     */
    glyph(latin, ch, x, baseline, size, separate) {
      if (separate) { this.sep = this.sep === 1 ? 2 : 1; baseline += this.sep * 1e-9; }
      // RezeptFormPdf は「100 × k」を大きさとして読み戻す（k から 0.00015 を引く）。元の大きさがそのまま戻るように k を決める
      const k = (size + 0.00015) / TEXT_EM;
      this.parts.push('<text font-family="' + (latin ? FONT_LATIN : FONT_GOTHIC) + '" font-size="' + TEXT_EM + '" transform="matrix(' + k + ' 0 0 ' + k + ' ' +
        (x + GLYPH_NUDGE) + ' ' + (baseline + this.dy + GLYPH_NUDGE) + ')" fill="' + grayHex(TEXT_GRAY) + '">' + xmlEsc(ch) + '</text>');
    }
    toSVG() {
      return '<svg xmlns="http://www.w3.org/2000/svg" class="rzsvg lgsvg" width="' + SHEET_PX_W + 'px" height="' + SHEET_PX_H + 'px"' +
        (this.mediaBox ? ' data-pdf-mediabox="' + this.mediaBox + '"' : '') + '>' +
        '<g transform="scale(' + (4 / 3) + ')"><svg viewBox="0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT + '" width="' + PAGE_WIDTH + '" height="' + PAGE_HEIGHT + '" overflow="visible">' +
        this.parts.join('') + '</svg></g></svg>';
    }
  }

  /** 基準版 draw_text（上原点 y、基線 = y + 大きさ。並びは textOut の連続と同じ送り） */
  function drawText(sheet, x, y, value, size, align) {
    value = value === null || value === undefined ? '' : String(value).replace(/\r/g, ' ').replace(/\n/g, ' ');
    if (!value) return;
    const baseline = y + size;
    const width = textWidth(value, size);
    if (align === 'right') x -= width;
    else if (align === 'center') x -= width / 2;
    let cx = x;
    for (const [latin, run] of fontRuns(value)) {
      for (const ch of Array.from(run)) {
        sheet.glyph(latin, ch, cx, baseline, size);
        cx += 0.001 * size * charWidth1000(ch);
      }
    }
  }
  /** 基準版 _wrap */
  function wrap(value, width, size) {
    const lines = [];
    let current = '';
    for (const ch of Array.from(str(value))) {
      if (ch === '\n' || (current && textWidth(current + ch, size) > width)) { lines.push(current); current = ''; }
      if (ch !== '\n') current += ch;
    }
    lines.push(current);
    return lines;
  }
  /** 基準版 _cell（枠＋上下中央の文字。入りきらないときは 0.25pt ずつ小さくする） */
  function cell(sheet, x, y, width, height, value, size, align, lineWidth) {
    sheet.strokeBox(x, y, width, height, lineWidth);
    let lines = wrap(value, width - 6, size);
    while (lines.length * (size + 1) > height - 3 && size > 4) {
      size -= 0.25;
      lines = wrap(value, width - 6, size);
    }
    const top = y + Math.max(1, (height - lines.length * (size + 1)) / 2);
    const anchor = align === 'right' ? x + width - 3 : align === 'center' ? x + width / 2 : x + 3;
    lines.forEach((line, i) => drawText(sheet, anchor, top + i * (size + 1), line, size, align));
  }
  /** Python の splitlines を空白でつなぐ */
  function joinLines(value) {
    const s = str(value);
    const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts.join(' ');
  }
  /**
   * 基準版 _submission_form_text（様式の記入欄: 1文字ずつ・送り幅は元様式の 1/64px 単位に切り捨て・入りきらなければ縮小）
   * baselinePdf は PDF 座標（下原点）
   */
  function formText(sheet, value, x, baselinePdf, size, maxWidth, align, unit) {
    if (unit === undefined) unit = DEFAULT_FORM_UNIT;
    value = joinLines(value);
    if (!value) return;
    const chars = Array.from(value);
    const glyphs = (fs) => chars.map((ch) => [isLatin(ch), ch, Math.floor(0.001 * (fs / unit) * charWidth1000(ch) * 64 + 1e-7) / 64 * unit]);
    let runs = glyphs(size);
    let width = runs.reduce((s, r) => s + r[2], 0);
    if (width > maxWidth) {
      size *= maxWidth / width;
      runs = glyphs(size);
      width = runs.reduce((s, r) => s + r[2], 0);
    }
    if (align === 'right') x -= width;
    else if (align === 'center') x -= width / 2;
    const baseline = PAGE_HEIGHT - baselinePdf;
    for (const [latin, ch, adv] of runs) {
      sheet.glyph(latin, ch, x, baseline, size, true);
      x += adv;
    }
  }

  // ---- 様式の下地（光ディスク等送付書・返戻用国保総括表） ----
  function drawVectorArt(sheet, art) {
    for (const [x, y, w, h, g] of art.rects) sheet.fillRectPdf(x, y, w, h, g);
    for (const [pts, g] of art.polys) {
      const contour = pts.map((p, i) => [i ? 'l' : 'm', p]);
      contour.push(['h']);
      sheet.fillContours([contour], g);
    }
    for (const [contours, g] of art.paths) sheet.fillContours(contours, g);
    for (const [ch, x, baseline, size, latin] of art.glyphs) sheet.glyph(!!latin, ch, x, PAGE_HEIGHT - baseline, size, true);
  }
  function clipPdf(sheet, box) {
    sheet.op('n ' + box.map(fp).join(' ') + ' re W* n');
  }

  // ============================================================
  // 帳票
  // ============================================================

  /** 光ディスク等送付書（payer: 'kokuho' | 'shaho'）→ SVG ページ 1 枚 */
  function discSubmission(facility, claimMonth, createdDate, payer) {
    facility = facility || {};
    const art = ART.disc;
    const sheet = new Sheet(true);
    clipPdf(sheet, art.clip);
    drawVectorArt(sheet, art);
    const fields = {
      recipient: recipient(facility, payer) + '   御中',
      medical_institution_code: medicalInstitutionCode7(facility),
      claim_month: discDate(claimMonth, true),
      created_date: discDate(createdDate),
      address: facility.address || '', name: facility.name || '', founder_name: facility.founder_name || '',
    };
    const widths = { recipient: 546, address: 274, founder_name: 254, medical_institution_code: 362, name: 362, claim_month: 362, created_date: 362 };
    for (const key of Object.keys(fields)) {
      const spec = art.fields[key];
      const center = 'center' in spec;
      formText(sheet, fields[key], center ? spec.center : spec.x, spec.baseline, spec.size, widths[key], center ? 'center' : 'left', art.unit);
    }
    return [sheet.toSVG()];
  }

  // ---- 社保総括表 ----
  const SOCIAL_SUMMARY_BANDS = [
    [712.1618, 698.9510, ['01', '02-work', '02', '03', '04', '31-ship', '31', '06', 'ret']],
    [571.6471, 558.4363, ['01', '02-work', '02', '31-ship', '31', '06', 'ret']],
    [456.9534, 443.7427, ['01', '02-work', '02', '03', '04', '31-ship', '31', '06', '07', 'ret']],
    [304.4289, 291.2181, ['01', '02', '03', '04', '31', '06', 'ret']],
    [189.7353, 176.5245, ['01', '02', '03', '04', '31', '06', 'ret']],
  ];
  const SOCIAL_SUMMARY_ROW_HEIGHT = 12.610293822;
  const SOCIAL_SUMMARY_RIGHT_EDGES = [293.931558, 374.397242, 454.862926, 535.328611];

  function socialBand(item) {
    if (isSeniorInsuranceEligible(item.birth_date, item.billing_date)) return intValue(item.burden_ratio) < 30 ? 0 : 1;
    if (isPreschoolChild(item)) return 4;
    return relationshipCode(item.relationship) === '2' ? 3 : 2;
  }
  function socialPrefix(item) {
    const p = digitsOnly(item.insurer_number).slice(0, 2);
    if (['31', '32', '33', '34'].includes(p)) return '31';
    if (['63', '72', '73', '74', '75'].includes(p)) return 'ret';
    return p;
  }
  function socialText(sheet, value, x, baseline, width, align, size) {
    formText(sheet, value, x, baseline, size === undefined ? 7.806372366 : size, width, align || 'left', ART.social.unit);
  }
  function socialNumbers(sheet, totals, baseline) {
    numbers(totals).forEach((value, i) => { if (i < SOCIAL_SUMMARY_RIGHT_EDGES.length) socialText(sheet, value, SOCIAL_SUMMARY_RIGHT_EDGES[i], baseline, 77, 'right'); });
  }

  /** 社保総括表（returned=true で返戻用。様式は同じ）→ SVG ページ（2枚目以降は公費の内訳） */
  function socialSummary(items, facility, claimMonth, createdDate, returned) {
    facility = facility || {};
    items = aggregate(items);
    const pages = [];
    let sheet = new Sheet(true);
    sheet.op('q /LgSocial0 Do Q');
    socialText(sheet, era(claimMonth, true) + '　診療報酬請求書（医科・入院外）', 31.357842912, 805.23774557, 495, 'left', 9.607842912);
    socialText(sheet, era(createdDate), 137.64463622, 755.99755064, 105);
    const code = medicalInstitutionCode7(facility);
    [[code, 781.218138, 139], [facility.address, 768.6078445, 139], [facility.name, 757.799021, 139], [facility.founder_name, 745.789217, 117]]
      .forEach(([value, baseline, width]) => socialText(sheet, value, 394.0549, baseline, width));
    SOCIAL_SUMMARY_BANDS.forEach(([combinedY, firstY, rowKeys], band) => {
      const group = items.filter((it) => socialBand(it) === band && orEmpty(it.insurer_number) !== '');
      const combined = group.filter((it) => publicExpenses(it).length);
      const single = group.filter((it) => !publicExpenses(it).length);
      socialNumbers(sheet, claimTotals(combined), combinedY);
      const rows = {};
      rowKeys.forEach((k) => { rows[k] = []; });
      const unmatched = [];
      for (const it of single) {
        let key = socialPrefix(it);
        if (!(key in rows)) { unmatched.push(it); key = 'ret'; }
        rows[key].push(it);
      }
      if (unmatched.length) {
        const baseline = firstY - rowKeys.indexOf('ret') * SOCIAL_SUMMARY_ROW_HEIGHT;
        sheet.fillRectPdf(74, baseline - 2, 139, 10.5, 1);
        socialText(sheet, 'その他・退職', 74, baseline, 138);
      }
      rowKeys.forEach((k, i) => socialNumbers(sheet, claimTotals(rows[k]), firstY - i * SOCIAL_SUMMARY_ROW_HEIGHT));
      socialNumbers(sheet, claimTotals(single), firstY - rowKeys.length * SOCIAL_SUMMARY_ROW_HEIGHT);
    });
    const insured = items.filter((it) => orEmpty(it.insurer_number) !== '');
    socialNumbers(sheet, [insured.length], 75.0417);
    // 公費の内訳（2枚目）: [区分, 法別番号, 公費の名前] ごと
    const groups = new Map();
    for (const it of items) {
      const expenses = publicExpenses(it);
      for (const e of expenses) {
        const category = orEmpty(it.insurer_number) !== '' ? 0 : expenses.length > 1 ? 1 : 2;
        const law = digitsOnly(e.payer_number).slice(0, 2);
        const name = str(e.expense_type_name);
        const key = JSON.stringify([category, law, name]);
        if (!groups.has(key)) groups.set(key, { category, law, name, values: [] });
        groups.get(key).values.push([it, e]);
      }
    }
    const sortedGroups = Array.from(groups.values()).sort((a, b) => (a.category - b.category) || cmpStr(a.law, b.law) || cmpStr(a.name, b.name));
    const categories = [0, 1, 2].map((c) => sortedGroups.filter((g) => g.category === c));
    const publicCount = sortedGroups.reduce((s, g) => s + g.values.length, 0);
    const pageCount = Math.max(1, Math.max(...categories.map((rows) => Math.floor((rows.length + 5) / 6))));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      pages.push(sheet.toSVG());
      sheet = new Sheet(false);
      sheet.op('q /LgSocial1 Do Q');
      socialText(sheet, code, 415.07105637, 802.835991, 120);
      categories.forEach((groupRows, category) => {
        groupRows.slice(pageIndex * 6, (pageIndex + 1) * 6).forEach((g, index) => {
          const baseline = 757.799021 - (category * 6 + index) * SOCIAL_SUMMARY_ROW_HEIGHT;
          socialText(sheet, g.name ? g.law + ' （' + g.name + '）' : g.law, 74.0, baseline, 139);
          const points = g.values.reduce((s, [it, e]) => s + intValue(e.covered_score, intValue(it.total_score)), 0);
          const burden = g.values.reduce((s, [, e]) => s + intValue(firstPresent(e, 'burden_amount', 'patient_burden_amount')), 0);
          socialNumbers(sheet, [g.values.length, 0, points, burden], baseline);
        });
      });
      if (pageIndex === pageCount - 1) {
        socialNumbers(sheet, [publicCount], 530.2132);
        socialText(sheet, comma(insured.length + publicCount) + '件', 374.397242, 517.0024, 158, 'right');
      }
    }
    pages.push(sheet.toSVG());
    return pages;
  }

  // ---- 国保 ----
  function nationalCategory(item, elderly) {
    const ratio = intValue(item.burden_ratio);
    if (elderly) return ratio === 30 ? '7割' : ratio === 20 ? '一般Ⅱ（8割）' : '一般Ⅰ・低所得（9割）';
    if (isSeniorInsuranceEligible(item.birth_date, item.billing_date)) return ratio === 30 ? '70歳以上（7割）' : '70歳以上（一般・低所得）';
    return isPreschoolChild(item) ? '6歳' : '一般';
  }

  /** 国保総括表（一覧）: 国保→後期高齢者、それぞれ当月分・月遅れ分→返戻分の順にページを作る */
  function nationalList(regularItems, returnedItems, facility, claimMonth, createdDate) {
    facility = facility || {};
    regularItems = aggregate(regularItems);
    returnedItems = aggregate(returnedItems);
    const xs = [23, 182, 358, 406, 454, 512], widths = [159, 176, 48, 48, 58, 60];
    const pages = [];
    let sheet = null, pageNumber = 0;
    const lw = () => (pageNumber === 1 ? LINE_WIDTH : 1);
    const page = (elderly, returned) => {
      if (sheet) pages.push(sheet.toSVG());
      pageNumber += 1;
      sheet = new Sheet(pageNumber === 1, A4_MEDIABOX);
      const heading = elderly ? '後期高齢者総括表（一覧）' : '国保総括表（一覧）';
      const month = digitsOnly(claimMonth);
      const cd = String(createdDate || '');
      drawText(sheet, 570, 22, '発行日: ' + cd.slice(0, 4) + '/' + cd.slice(4, 6) + '/' + cd.slice(6, 8), 8, 'right');
      drawText(sheet, 298, 38, '【' + heading + '】 診療月 ' + month.slice(0, 4) + '/' + month.slice(4, 6), 12, 'center');
      drawText(sheet, 24, 64, returned ? '【返戻分】' : '【当月分・月遅れ分】', 9);
      ['保険者番号', '区分', '件数', '実日数', '点数', '一部負担金'].forEach((label, i) => cell(sheet, xs[i], 78, widths[i], 16, label, 8, 'center', lw()));
      drawText(sheet, 572, 818, String(pageNumber), 7, 'right');
      return 94;
    };
    for (const elderly of [false, true]) {
      for (const [returned, source] of [[false, regularItems], [true, returnedItems]]) {
        let y = page(elderly, returned);
        const items = source.filter((it) => isElderlyInsurerNumber(it.insurer_number) === elderly);
        const insurers = groupBy(items, (it) => str(it.insurer_number));
        const rows = [];
        for (const number of Array.from(insurers.keys()).sort(cmpStr)) {
          const insurerItems = insurers.get(number);
          const hit = insurerItems.find((it) => orEmpty(it.insurer_name) !== '');
          const name = hit ? hit.insurer_name : '';
          const label = number + ' ' + name;
          const groups = groupBy(insurerItems, (it) => nationalCategory(it, elderly));
          const order = elderly ? { '7割': 0, '一般Ⅱ（8割）': 1, '一般Ⅰ・低所得（9割）': 2 } : {};
          const cats = Array.from(groups.keys()).sort((a, b) => ((order[a] || 0) - (order[b] || 0)) || cmpStr(a, b));
          for (const c of cats) rows.push([label, c, claimTotals(groups.get(c))]);
          rows.push([label, '合計', claimTotals(insurerItems)]);
          const pub = new Map();
          for (const it of insurerItems) {
            const seen = new Set();
            for (const e of publicExpenses(it).concat(it.separate_public_expenses || [])) {
              const law = digitsOnly(e.payer_number).slice(0, 2);
              if (law && !seen.has(law)) {
                if (!pub.has(law)) pub.set(law, []);
                pub.get(law).push(it);
                seen.add(law);
              }
            }
          }
          for (const law of Array.from(pub.keys()).sort(cmpStr)) rows.push([label, '（公費分再掲） (' + law + ')', claimTotals(pub.get(law))]);
        }
        if (items.length) rows.push(['総合計', '合計', claimTotals(items)]);
        for (const [insurer, category, totals] of (rows.length ? rows : [['', '', [0, 0, 0, 0]]])) {
          const height = Math.max(16, 3 + wrap(insurer, widths[0] - 6, 8).length * 9);
          if (y + height > 804) y = page(elderly, returned);
          const values = [insurer, category].concat(numbers(totals));
          values.forEach((value, col) => cell(sheet, xs[col], y, widths[col], height, value, 8, col < 2 ? 'left' : 'right', lw()));
          y += height;
        }
      }
    }
    pages.push(sheet.toSVG());
    return pages;
  }

  /** 返戻用国保総括表（同じものを上下に2枚）→ SVG ページ 1 枚 */
  function nationalReturnSummary(items, facility, claimMonth, createdDate) {
    facility = facility || {};
    items = aggregate(items);
    const art = ART.nret;
    const sheet = new Sheet(true);
    clipPdf(sheet, art.clip);
    const fields = {
      medical_institution_code: medicalInstitutionCode7(facility),
      claim_month: era(claimMonth, true),
      created_date: era(createdDate),
      recipient: prefectureLabel(facility) + '国民健康保険団体連合会',
      address: facility.address || '', name: facility.name || '', phone: facility.phone || '', founder_name: facility.founder_name || '',
    };
    const fieldWidths = { medical_institution_code: 136, claim_month: 132, created_date: 220, recipient: 226, address: 216, name: 216, phone: 216, founder_name: 216 };
    const groups = [
      items.filter((it) => !isElderlyInsurerNumber(it.insurer_number) && !digitsOnly(it.insurer_number).startsWith('67')),
      items.filter((it) => digitsOnly(it.insurer_number).startsWith('67')),
      items.filter((it) => isElderlyInsurerNumber(it.insurer_number)),
      items,
    ];
    const rowTops = [190.643628689, 213.514639064, 236.385649439, 259.256659814, 282.127670189, 304.998680564, 327.869690939, 351.327137609];
    const counts = returnPublicCounts(items);
    for (const offset of art.copies) {
      // 基準版は translate(0, −offset) の中で描く。PDF の命令は同じ変換で、文字は上原点で offset だけ下へずらして置く
      sheet.op('q 1 0 0 1 0 ' + fp(-offset) + ' cm');
      sheet.dy = offset;
      drawVectorArt(sheet, art);   // PDF の命令は変換（cm）の中で元の座標のまま、画面の形は dy だけ下へ
      for (const key of Object.keys(fields)) {
        const spec = art.fields[key];
        formText(sheet, fields[key], spec.x, spec.baseline, spec.size, fieldWidths[key]);
      }
      groups.forEach((values, gi) => {
        [true, false].forEach((inpatient, vi) => {
          const selected = values.filter((it) => (it.visit_type === 'inpatient') === inpatient);
          const top = rowTops[gi * 2 + vi];
          const baseline = PAGE_HEIGHT - top - 14.66;
          const nums = numbers(claimTotals(selected)).slice(0, 3);
          [[166.013, 58.64], [224.657, 58.64], [300.894, 76.24]].forEach(([right, width], i) => formText(sheet, nums[i], right - 4, baseline, 9.382978668, width - 8, 'right'));
          if (inpatient) {
            const meals = selected.reduce((s, it) => s + intValue(firstPresent(it, 'meal_total_amount', 'diet_total_amount')), 0);
            formText(sheet, numbers([meals])[0], 365, baseline, 9.382978668, 59, 'right');
          }
        });
      });
      numbers(counts).forEach((value, i) => formText(sheet, value, [412.61, 507.32][i], 476.01, 9.382978668, [62, 111][i], 'center'));
      sheet.op('Q');
      sheet.dy = 0;
    }
    return [sheet.toSVG()];
  }
  function returnPublicCounts(items) {
    const welfare = (e) => {
      const program = str(e.expense_type);
      return ['prefecture', 'local'].includes(e.scope) || Object.prototype.hasOwnProperty.call(LOCAL_PROGRAM_ALIASES, program) || program.startsWith('aichi_');
    };
    let a = 0, b = 0;
    for (const it of items) {
      const ex = publicExpenses(it);
      if (ex.some((e) => !welfare(e))) a += 1;
      if (ex.some(welfare) || !!orEmpty(it.separate_public_expenses)) b += 1;
    }
    return [a, b];
  }

  /** 返戻用国保請求書（elderly=true で返戻用後期高齢者請求書）: 保険者ごとに1枚。対象が無ければ白紙1枚 */
  function nationalReturnInvoice(items, facility, claimMonth, createdDate, elderly) {
    facility = facility || {};
    items = aggregate(items);
    if (!items.length) return [new Sheet(true, A4_MEDIABOX).toSVG()];
    const groups = groupBy(items, (it) => str(it.insurer_number));
    const pages = [];
    Array.from(groups.keys()).sort(cmpStr).forEach((insurer, index) => {
      const values = groups.get(insurer);
      const sheet = new Sheet(index === 0, A4_MEDIABOX);
      const lw = index === 0 ? LINE_WIDTH : 1;
      drawText(sheet, 298, 36, era(claimMonth, true), 12, 'center');
      drawText(sheet, 298, 58, elderly ? '後期高齢者医療診療報酬請求書' : '国民健康保険診療報酬請求書', 15, 'center');
      drawText(sheet, 32, 99, era(createdDate), 9);
      drawText(sheet, 32, 126, '保険者番号 ' + insurer, 10);
      const hit = values.find((it) => orEmpty(it.insurer_name) !== '');
      drawText(sheet, 32, 146, hit ? hit.insurer_name : '', 10);
      drawText(sheet, 310, 99, '医療機関コード ' + medicalInstitutionCode7(facility), 9);
      wrap(['address', 'name', 'founder_name'].map((k) => str(facility[k])).join('\n'), 248, 9)
        .forEach((line, i) => drawText(sheet, 310, 117 + i * 12, line, 9));
      const categories = groupBy(values, (it) => nationalCategory(it, elderly));
      const rows = [['区分', '件数', '診療実日数', '点数', '一部負担金']];
      for (const c of Array.from(categories.keys()).sort(cmpStr)) rows.push([c].concat(numbers(claimTotals(categories.get(c)))));
      rows.push(['合計'].concat(numbers(claimTotals(values))));
      rows.forEach((row, ri) => {
        row.forEach((value, col) => cell(sheet, [32, 218, 287, 374, 465][col], 190 + ri * 32, [186, 69, 87, 91, 98][col], 32, value, 9, col === 0 ? 'left' : 'right', lw));
      });
      pages.push(sheet.toSVG());
    });
    return pages;
  }

  // ============================================================
  // PDF 化: RezeptFormPdf が作る PDF（文字・<rect>）に、<path>/<g> の data-pdf 命令と社保総括表の元様式を足す
  // ============================================================
  const enc = new TextEncoder();
  function b64bytes(s) {
    if (typeof atob === 'function') { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, 'base64'));   // Node（検証用）
  }
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  function latin1(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; }
  function xmlUnesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }

  /** SVG 1ページ → PDF にそのまま足す命令（書いてある順） */
  function pdfOpsOf(svg) {
    const ops = [];
    const re = /<(?:path|g)\b[^>]*?\bdata-pdf="([^"]*)"/g;
    let m;
    while ((m = re.exec(svg))) ops.push(xmlUnesc(m[1]));
    return ops;
  }

  /**
   * SVG ページ（文字列の配列）→ PDF の中身（Uint8Array）。1ページ = A4 縦 1枚
   * @param {string[]} pages
   * @param {object} [options] RezeptFormPdf.bytesFromSvgPages と同じ（title / fontBase / fonts / compress）
   */
  async function toPdfBytes(pages, options) {
    options = options || {};
    const P = (typeof RezeptFormPdf !== 'undefined') ? RezeptFormPdf : (typeof window !== 'undefined' ? window.RezeptFormPdf : null);
    if (!P) throw new Error('rezept_form_pdf.js が読み込まれていません');
    pages = (Array.isArray(pages) ? pages : [pages]).filter(Boolean);
    const base = await P.bytesFromSvgPages(pages, options);
    const extra = pages.map(pdfOpsOf);
    const boxes = pages.map((svg) => { const m = /^<svg\b[^>]*\bdata-pdf-mediabox="([^"]*)"/.exec(svg); return m ? m[1] : ''; });
    if (!extra.some((ops) => ops.length) && !boxes.some(Boolean)) return base;
    extra.mediaBoxes = boxes;
    return mergeExtraOps(base, extra, options);
  }
  async function toPdf(pages, options) {
    return new Blob([await toPdfBytes(pages, options)], { type: 'application/pdf' });
  }

  /** RezeptFormPdf の出力（相互参照表つき・オブジェクトは番号順）を読み、各ページの描画の先頭に命令を足して書き直す */
  async function mergeExtraOps(base, extra, options) {
    const text = latin1(base);
    const sx = text.lastIndexOf('startxref');
    const xrefAt = parseInt(text.slice(sx + 9).trim(), 10);
    const head = /xref\n0 (\d+)\n/.exec(text.slice(xrefAt, xrefAt + 40));
    const count = parseInt(head[1], 10);
    const tableAt = xrefAt + head[0].length;
    const offsets = [];
    for (let i = 1; i < count; i++) offsets.push(parseInt(text.substr(tableAt + i * 20, 10), 10));
    const bodies = offsets.map((o, i) => {
      const end = i + 1 < offsets.length ? offsets[i + 1] : xrefAt;
      const s = base.subarray(o, end);
      const prefix = (i + 1) + ' 0 obj\n';
      return s.subarray(prefix.length, s.length - '\nendobj\n'.length);
    });
    const trailer = text.slice(text.indexOf('trailer', xrefAt));
    const rootId = +/\/Root (\d+) 0 R/.exec(trailer)[1];
    const infoM = /\/Info (\d+) 0 R/.exec(trailer);
    const catalog = latin1(bodies[rootId - 1]);
    const pagesId = +/\/Pages (\d+) 0 R/.exec(catalog)[1];
    const kids = Array.from(latin1(bodies[pagesId - 1]).matchAll(/(\d+) 0 R/g)).map((m) => +m[1]);

    const objs = bodies.slice();
    const add = (bytes) => { objs.push(bytes); return objs.length; };
    const concat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const u = new Uint8Array(n); let o = 0; parts.forEach((p) => { u.set(p, o); o += p.length; }); return u; };
    const streamObj = (dict, data, filtered) => concat([enc.encode('<< ' + dict + (filtered ? ' /Filter /FlateDecode' : '') + ' /Length ' + data.length + ' >>\nstream\n'), data, enc.encode('\nendstream')]);

    // 社保総括表の元様式（参照されたときだけ入れる）
    const social = ART.social;
    const refIds = {};
    const formIds = {};
    const valueStr = (v) => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : fp(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'string') return '(' + v.replace(/([\\()])/g, '\\$1') + ')';
      if ('ref' in v) return refId(v.ref) + ' 0 R';
      if ('dict' in v) return '<< ' + Object.keys(v.dict).map((k) => '/' + k + ' ' + valueStr(v.dict[k])).join(' ') + ' >>';
      if ('array' in v) return '[' + v.array.map(valueStr).join(' ') + ']';
      if ('name' in v) return '/' + v.name;
      if ('bytes' in v) { const b = b64bytes(v.bytes); let h = ''; b.forEach((x) => { h += x.toString(16).padStart(2, '0'); }); return '<' + h.toUpperCase() + '>'; }
      if ('bool' in v) return v.bool ? 'true' : 'false';
      if ('null' in v) return 'null';
      throw new Error('様式データの形が不正です');
    };
    function refId(key) {
      if (refIds[key]) return refIds[key];
      const id = add(null);
      refIds[key] = id;
      const o = social.objects[key];
      if (o && 'z' in o) {
        const dict = Object.keys(o.dict).map((k) => '/' + k + ' ' + valueStr(o.dict[k])).join(' ');
        objs[id - 1] = streamObj(dict, b64bytes(o.z), true);
      } else {
        objs[id - 1] = enc.encode(valueStr(o));
      }
      return id;
    }
    function formId(index) {
      if (formIds[index]) return formIds[index];
      const p = social.pages[index];
      const id = add(null);
      formIds[index] = id;
      const res = valueStr(p.res);
      objs[id - 1] = streamObj('/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 ' + fp(PAGE_WIDTH) + ' ' + fp(PAGE_HEIGHT) + '] /Matrix [1 0 0 1 0 0] /Resources ' + res, b64bytes(p.z), true);
      return id;
    }

    for (let i = 0; i < kids.length && i < extra.length; i++) {
      const ops = extra[i];
      const box = extra.mediaBoxes ? extra.mediaBoxes[i] : '';
      if (!ops.length && !box) continue;
      const pageId = kids[i];
      let dict = latin1(objs[pageId - 1]);
      if (box) dict = dict.replace(/\/MediaBox \[[^\]]*\]/, '/MediaBox [' + box + ']');
      if (!ops.length) { objs[pageId - 1] = enc.encode(dict); continue; }
      const xobjects = {};
      ops.forEach((op) => { const m = /\/LgSocial(\d) Do/.exec(op); if (m) xobjects['LgSocial' + m[1]] = formId(+m[1]); });
      const data = enc.encode(ops.join('\n') + '\n');
      const z = options.compress === false ? null : await deflate(data);
      const contentId = add(streamObj('', z || data, !!z));
      dict = dict.replace(/\/Contents (\d+) 0 R/, '/Contents [' + contentId + ' 0 R $1 0 R]');
      const names = Object.keys(xobjects);
      if (names.length) dict = dict.replace('/ProcSet', '/XObject << ' + names.map((n) => '/' + n + ' ' + xobjects[n] + ' 0 R').join(' ') + ' >> /ProcSet');
      objs[pageId - 1] = enc.encode(dict);
    }

    // 書き出し
    const chunks = [];
    let length = 0;
    const push = (b) => { chunks.push(b); length += b.length; };
    push(base.subarray(0, offsets[0]));   // ヘッダー（%PDF-1.7 と 2進を示す行）
    const outOffsets = [];
    objs.forEach((body, i) => {
      outOffsets.push(length);
      push(enc.encode((i + 1) + ' 0 obj\n')); push(body); push(enc.encode('\nendobj\n'));
    });
    const newXref = length;
    let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    outOffsets.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
    xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + rootId + ' 0 R' + (infoM ? ' /Info ' + infoM[1] + ' 0 R' : '') + ' >>\nstartxref\n' + newXref + '\n%%EOF\n';
    push(enc.encode(xref));
    return concat(chunks);
  }

  // ============================================================
  // 様式の下地（基準版 templates/*.json から gen_ledger_art.py で作ったもの。手で書き換えない）
  //   disc: 光ディスク等送付書 / nret: 返戻用国保総括表 / social: 社保総括表（PDF の描画命令と書体・deflate 済み）
  // ============================================================
  const ART = /*LEDGER-ART-BEGIN*/{"disc":{"unit":0.59083601775,"clip":[21.75,28.5297425,551.2500045,791.7202575],"rects":[[21.75,533.69453139125,165.43408497,0.5908360177498935,0.333333333],[21.75,481.70096182925005,165.43408497,0.5908360177500072,0.333333333],[21.75,481.70096182925005,0.59083601775,52.5844055797499,0.333333333],[186.59324895224998,481.70096182925005,0.5908360177500072,52.5844055797499,0.333333333],[186.59324895224998,533.69453139125,386.4067556085,0.5908360177498935,0.333333333],[186.59324895224998,481.70096182925005,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,481.70096182925005,0.5908360177500072,52.5844055797499,0.333333333],[572.409168543,481.70096182925005,0.5908360177500072,52.5844055797499,0.333333333],[21.75,481.70096182925005,165.43408497,0.5908360177500072,0.333333333],[21.75,429.70739226725004,165.43408497,0.5908360177500072,0.333333333],[21.75,429.70739226725004,0.59083601775,52.58440557975001,0.333333333],[186.59324895224998,429.70739226725004,0.5908360177500072,52.58440557975001,0.333333333],[186.59324895224998,481.70096182925005,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,429.70739226725004,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,429.70739226725004,0.5908360177500072,52.58440557975001,0.333333333],[572.409168543,429.70739226725004,0.5908360177500072,52.58440557975001,0.333333333],[21.75,429.70739226725004,165.43408497,0.5908360177500072,0.333333333],[21.75,377.71382270525004,165.43408497,0.5908360177500072,0.333333333],[21.75,377.71382270525004,0.59083601775,52.58440557975001,0.333333333],[186.59324895224998,377.71382270525004,0.5908360177500072,52.58440557975001,0.333333333],[186.59324895224998,429.70739226725004,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,377.71382270525004,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,377.71382270525004,0.5908360177500072,52.58440557975001,0.333333333],[572.409168543,377.71382270525004,0.5908360177500072,52.58440557975001,0.333333333],[21.75,377.71382270525004,165.43408497,0.5908360177500072,0.333333333],[21.75,325.72025314325003,165.43408497,0.5908360177500072,0.333333333],[21.75,325.72025314325003,0.59083601775,52.58440557975001,0.333333333],[186.59324895224998,325.72025314325003,0.5908360177500072,52.58440557975001,0.333333333],[186.59324895224998,377.71382270525004,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,325.72025314325003,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,325.72025314325003,0.5908360177500072,52.58440557975001,0.333333333],[572.409168543,325.72025314325003,0.5908360177500072,52.58440557975001,0.333333333],[21.75,325.72025314325003,165.43408497,0.5908360177500072,0.333333333],[21.75,273.7266835812501,165.43408497,0.5908360177500072,0.333333333],[21.75,273.7266835812501,0.59083601775,52.584405579749955,0.333333333],[186.59324895224998,273.7266835812501,0.5908360177500072,52.584405579749955,0.333333333],[186.59324895224998,325.72025314325003,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,273.7266835812501,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,273.7266835812501,0.5908360177500072,52.584405579749955,0.333333333],[572.409168543,273.7266835812501,0.5908360177500072,52.584405579749955,0.333333333],[21.75,273.7266835812501,165.43408497,0.5908360177500072,0.333333333],[21.75,221.73311401925002,165.43408497,0.5908360177500072,0.333333333],[21.75,221.73311401925002,0.59083601775,52.58440557975007,0.333333333],[186.59324895224998,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[186.59324895224998,273.7266835812501,128.8022518695,0.5908360177500072,0.333333333],[186.59324895224998,221.73311401925002,128.8022518695,0.5908360177500072,0.333333333],[186.59324895224998,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[314.80466480399997,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[314.80466480399997,273.7266835812501,129.39308788724998,0.5908360177500072,0.333333333],[314.80466480399997,221.73311401925002,129.39308788724998,0.5908360177500072,0.333333333],[314.80466480399997,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[443.60691667349994,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[443.60691667349994,273.7266835812501,129.39308788725003,0.5908360177500072,0.333333333],[443.60691667349994,221.73311401925002,129.39308788725003,0.5908360177500072,0.333333333],[443.60691667349994,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[572.409168543,221.73311401925002,0.5908360177500072,52.58440557975007,0.333333333],[21.75,221.73311401925002,165.43408497,0.5908360177500072,0.333333333],[21.75,169.73954445725008,165.43408497,0.5908360177500072,0.333333333],[21.75,169.73954445725008,0.59083601775,52.584405579749955,0.333333333],[186.59324895224998,169.73954445725008,0.5908360177500072,52.584405579749955,0.333333333],[186.59324895224998,221.73311401925002,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,169.73954445725008,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,169.73954445725008,0.5908360177500072,52.584405579749955,0.333333333],[572.409168543,169.73954445725008,0.5908360177500072,52.584405579749955,0.333333333],[21.75,169.73954445725008,165.43408497,0.5908360177500072,0.333333333],[21.75,117.74597489525001,165.43408497,0.5908360177500072,0.333333333],[21.75,117.74597489525001,0.59083601775,52.58440557975007,0.333333333],[186.59324895224998,117.74597489525001,0.5908360177500072,52.58440557975007,0.333333333],[186.59324895224998,169.73954445725008,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,117.74597489525001,386.4067556085,0.5908360177500072,0.333333333],[186.59324895224998,117.74597489525001,0.5908360177500072,52.58440557975007,0.333333333],[572.409168543,117.74597489525001,0.5908360177500072,52.58440557975007,0.333333333],[235.04180240774997,568.5538564385,124.66639974524998,0.5908360177500072,0.333333333],[235.04180240774997,565.59967634975,124.66639974524998,0.5908360177500072,0.333333333]],"polys":[],"paths":[[[[["m",[307.12379625,432.38103225000003]],["c",[309.7329195,432.38103225000003],[311.8504845,434.49857925000003],[311.8504845,437.1077205]],["c",[311.8504845,439.71686174999996],[309.7329195,441.83440874999997],[307.12379625,441.83440874999997]],["c",[304.51467375,441.83440874999997],[302.397108,439.71686174999996],[302.397108,437.1077205]],["c",[302.397108,434.49857925000003],[304.51467375,432.38103225000003],[307.12379625,432.38103225000003]],["h"]],[["m",[307.12379625,432.97186875]],["c",[309.40679475,432.97186875],[311.25964875,434.824722],[311.25964875,437.1077205]],["c",[311.25964875,439.390719],[309.40679475,441.24357299999997],[307.12379625,441.24357299999997]],["c",[304.84079775,441.24357299999997],[302.9879445,439.390719],[302.9879445,437.1077205]],["c",[302.9879445,434.824722],[304.84079775,432.97186875],[307.12379625,432.97186875]],["h"]]],0.333333333],[[[["m",[491.46463424999996,588.3617415]],["c",[494.0737755,588.3617415],[496.1913225,590.4792884999999],[496.1913225,593.088429]],["c",[496.1913225,595.69757025],[494.0737755,597.81511725],[491.46463424999996,597.81511725]],["c",[488.855493,597.81511725],[486.73794599999997,595.69757025],[486.73794599999997,593.088429]],["c",[486.73794599999997,590.4792884999999],[488.855493,588.3617415],[491.46463424999996,588.3617415]],["h"]],[["m",[491.46463424999996,588.95257725]],["c",[493.74763275000004,588.95257725],[495.60048600000005,590.8054312500001],[495.60048600000005,593.088429]],["c",[495.60048600000005,595.3714275],[493.74763275000004,597.2242815],[491.46463424999996,597.2242815]],["c",[489.18163574999994,597.2242815],[487.32878174999996,595.3714275],[487.32878174999996,593.088429]],["c",[487.32878174999996,590.8054312500001],[489.18163574999994,588.95257725],[491.46463424999996,588.95257725]],["h"]]],0.333333333],[[[["m",[558.229104,166.50482399999999]],["l",[558.8199405,166.50482399999999]],["c",[562.0813665000001,166.50482399999999],[564.72830025,169.15176674999998],[564.72830025,172.41318449999994]],["l",[564.72830025,173.00402024999994]],["c",[564.72830025,176.26542900000004],[562.0813665000001,178.91238075],[558.8199405,178.91238075]],["l",[558.229104,178.91238075]],["c",[554.967678,178.91238075],[552.32074425,176.26542900000004],[552.32074425,173.00402024999994]],["l",[552.32074425,172.41318449999994]],["c",[552.32074425,169.15176674999998],[554.967678,166.50482399999999],[558.229104,166.50482399999999]],["h"]],[["m",[558.229104,167.0956605]],["l",[558.8199405,167.0956605]],["c",[561.75522375,167.0956605],[564.1374645,169.4779095],[564.1374645,172.41318449999994]],["l",[564.1374645,173.00402024999994]],["c",[564.1374645,175.93928625],[561.75522375,178.32154425],[558.8199405,178.32154425]],["l",[558.229104,178.32154425]],["c",[555.29382075,178.32154425],[552.91158,175.93928625],[552.91158,173.00402024999994]],["l",[552.91158,172.41318449999994]],["c",[552.91158,169.4779095],[555.29382075,167.0956605],[558.229104,167.0956605]],["h"]]],0.333333333]],"glyphs":[["\u533b",34.15755637275,504.15273050375004,11.225884337250022,0],["\u7642",45.38344071,504.15273050375004,11.225884337250022,0],["\u6a5f",56.609325047249996,504.15273050375004,11.225884337250022,0],["\u95a2",67.83520938449999,504.15273050375004,11.225884337250022,0],["\uff08",79.06109372174998,504.15273050375004,11.225884337250022,0],["\u85ac",90.28697805899999,504.15273050375004,11.225884337250022,0],["\u5c40",101.51286239624999,504.15273050375004,11.225884337250022,0],["\uff09",112.7387467335,504.15273050375004,11.225884337250022,0],["\u30b3",123.96463107074999,504.15273050375004,11.225884337250022,0],["\u30fc",135.19051540799998,504.15273050375004,11.225884337250022,0],["\u30c9",146.41639974524998,504.15273050375004,11.225884337250022,0],["\u533b",34.15755637275,452.15916094175003,11.225884337249965,0],["\u7642",45.38344071,452.15916094175003,11.225884337249965,0],["\u6a5f",56.609325047249996,452.15916094175003,11.225884337249965,0],["\u95a2",67.83520938449999,452.15916094175003,11.225884337249965,0],["\uff08",79.06109372174998,452.15916094175003,11.225884337249965,0],["\u85ac",90.28697805899999,452.15916094175003,11.225884337249965,0],["\u5c40",101.51286239624999,452.15916094175003,11.225884337249965,0],["\uff09",112.7387467335,452.15916094175003,11.225884337249965,0],["\u540d",123.96463107074999,452.15916094175003,11.225884337249965,0],["\u79f0",135.19051540799998,452.15916094175003,11.225884337249965,0],["\u70b9",34.15755637275,400.16559137975,11.225884337249965,0],["\u6570",45.38344071,400.16559137975,11.225884337249965,0],["\u8868",56.609325047249996,400.16559137975,11.225884337249965,0],["\u533a",67.83520938449999,400.16559137975,11.225884337249965,0],["\u5206",79.06109372174998,400.16559137975,11.225884337249965,0],["\u533b",317.46342688387494,400.16559137975,11.225884337249965,0],["\u79d1",328.68931122112497,400.16559137975,11.225884337249965,0],["\u30fb",352.61816994,400.16559137975,11.225884337249965,0],["D",375.95619264112497,400.16559137975,11.225884337250022,1],["P",384.5971694007187,400.16559137975,11.225884337250022,1],["C",391.3640881665117,400.16559137975,11.225884337250022,1],["\u30fb",411.70177171499995,400.16559137975,11.225884337249965,0],["\u8abf",435.03979441612495,400.16559137975,11.225884337249965,0],["\u5264",446.26567875337497,400.16559137975,11.225884337249965,0],["\u8a3a",34.15755637275,348.17202181775,11.225884337249965,0],["\u7642",45.38344071,348.17202181775,11.225884337249965,0],["\uff08",56.609325047249996,348.17202181775,11.225884337249965,0],["\u8abf",67.83520938449999,348.17202181775,11.225884337249965,0],["\u5264",79.06109372174998,348.17202181775,11.225884337249965,0],["\uff09",90.28697805899999,348.17202181775,11.225884337249965,0],["\u6708",101.51286239624999,348.17202181775,11.225884337249965,0],["\u5206",112.7387467335,348.17202181775,11.225884337249965,0],["\u63d0",34.15755637275,296.17845225575,11.225884337249965,0],["\u51fa",45.38344071,296.17845225575,11.225884337249965,0],["\u5e74",56.609325047249996,296.17845225575,11.225884337249965,0],["\u6708",67.83520938449999,296.17845225575,11.225884337249965,0],["\u65e5",79.06109372174998,296.17845225575,11.225884337249965,0],["\u5a92",34.15755637275,244.18488269375007,11.225884337249994,0],["\u4f53",45.38344071,244.18488269375007,11.225884337249994,0],["\u7a2e",56.609325047249996,244.18488269375007,11.225884337249994,0],["\u985e",67.83520938449999,244.18488269375007,11.225884337249994,0],["F",243.31350665624998,244.18488269375007,11.225884337250022,1],["D",249.76654378761327,244.18488269375007,11.225884337250022,1],["M",370.34325047249996,244.18488269375007,11.225884337250022,1],["O",380.02742207593354,244.18488269375007,11.225884337250022,1],["C",501.80426442187496,244.18488269375007,11.225884337250022,1],["D",509.6420734698398,244.18488269375007,11.225884337250022,1],["-",518.2830502294336,244.18488269375007,11.225884337250022,1],["R",522.3265842259101,244.18488269375007,11.225884337250022,1],["\u5a92",34.15755637275,192.19131313175,11.225884337249994,0],["\u4f53",45.38344071,192.19131313175,11.225884337249994,0],["\u679a",56.609325047249996,192.19131313175,11.225884337249994,0],["\u6570",67.83520938449999,192.19131313175,11.225884337249994,0],["1",370.63866848137496,192.19131313175,11.225884337250022,1],["\u679a",377.7748597582617,192.19131313175,11.225884337249994,0],["\u5099",34.15755637275,140.19774356975006,11.225884337249994,0],["\u8003",45.38344071,140.19774356975006,11.225884337249994,0],["\u203b",21.75,78.75079772375011,9.453376284,1],["1",29.670895362960938,78.75079772375011,9.453376284,1],["\u672c",38.68114463364844,78.75079772375011,9.453376284,0],["\u9001",48.13452091764843,78.75079772375011,9.453376284,0],["\u4ed8",57.58789720164843,78.75079772375011,9.453376284,0],["\u66f8",67.04127348564843,78.75079772375011,9.453376284,0],["\u306f",76.49464976964843,78.75079772375011,9.453376284,0],["\u3001",85.94802605364843,78.75079772375011,9.453376284,0],["\u70b9",95.40140233764843,78.75079772375011,9.453376284,0],["\u6570",104.85477862164844,78.75079772375011,9.453376284,0],["\u8868",114.30815490564842,78.75079772375011,9.453376284,0],["\u533a",123.76153118964842,78.75079772375011,9.453376284,0],["\u5206",133.21490747364842,78.75079772375011,9.453376284,0],["\u5225",142.66828375764842,78.75079772375011,9.453376284,0],["\u306b",152.12166004164843,78.75079772375011,9.453376284,0],["\u4f5c",161.57503632564843,78.75079772375011,9.453376284,0],["\u6210",171.02841260964843,78.75079772375011,9.453376284,0],["\u3059",180.48178889364843,78.75079772375011,9.453376284,0],["\u308b",189.93516517764843,78.75079772375011,9.453376284,0],["\u3053",199.38854146164843,78.75079772375011,9.453376284,0],["\u3068",208.84191774564843,78.75079772375011,9.453376284,0],["\u3002",218.29529402964843,78.75079772375011,9.453376284,0],["\u203b",21.75,65.75240533325007,9.453376284,1],["2",29.670895362960938,65.75240533325007,9.453376284,1],["\u70b9",38.68114463364844,65.75240533325007,9.453376284,0],["\u6570",48.13452091764843,65.75240533325007,9.453376284,0],["\u8868",57.58789720164843,65.75240533325007,9.453376284,0],["\u533a",67.04127348564843,65.75240533325007,9.453376284,0],["\u5206",76.49464976964843,65.75240533325007,9.453376284,0],["\u53ca",85.94802605364843,65.75240533325007,9.453376284,0],["\u3073",95.40140233764843,65.75240533325007,9.453376284,0],["\u5a92",104.85477862164844,65.75240533325007,9.453376284,0],["\u4f53",114.30815490564842,65.75240533325007,9.453376284,0],["\u7a2e",123.76153118964842,65.75240533325007,9.453376284,0],["\u5225",133.21490747364842,65.75240533325007,9.453376284,0],["\u306b",142.66828375764842,65.75240533325007,9.453376284,0],["\u3064",152.12166004164843,65.75240533325007,9.453376284,0],["\u3044",161.57503632564843,65.75240533325007,9.453376284,0],["\u3066",171.02841260964843,65.75240533325007,9.453376284,0],["\u306f",180.48178889364843,65.75240533325007,9.453376284,0],["\u3001",189.93516517764843,65.75240533325007,9.453376284,0],["\u8a72",199.38854146164843,65.75240533325007,9.453376284,0],["\u5f53",208.84191774564843,65.75240533325007,9.453376284,0],["\u306b",218.29529402964843,65.75240533325007,9.453376284,0],["\u25ef",227.7486703136484,65.75240533325007,9.453376284,1],["\u3092",238.32832775648436,65.75240533325007,9.453376284,0],["\u4ed8",247.78170404048436,65.75240533325007,9.453376284,0],["\u3059",257.23508032448433,65.75240533325007,9.453376284,0],["\u3053",266.68845660848433,65.75240533325007,9.453376284,0],["\u3068",276.14183289248433,65.75240533325007,9.453376284,0],["\u3002",285.59520917648433,65.75240533325007,9.453376284,0],["\u4f4f",251.58521090474997,722.1712210535,11.225884337250022,0],["\u6240",262.81109524199996,722.1712210535,11.225884337250022,0],["\u958b",217.907557893,663.67845529625,11.225884337250022,0],["\u8a2d",229.13344223024998,663.67845529625,11.225884337250022,0],["\u8005",240.35932656749998,663.67845529625,11.225884337250022,0],["\u6c0f",251.58521090474997,663.67845529625,11.225884337250022,0],["\u540d",262.81109524199996,663.67845529625,11.225884337250022,0],["\u5370",554.6840880105,666.04179936725,7.680868230750093,0],["\u5149",246.85852276274997,576.23472466925,11.225884337250022,0],["\u30c7",258.08440709999996,576.23472466925,11.225884337250022,0],["\u30a3",269.31029143725,576.23472466925,11.225884337250022,0],["\u30b9",280.53617577449995,576.23472466925,11.225884337250022,0],["\u30af",291.76206011175,576.23472466925,11.225884337250022,0],["\u7b49",302.987944449,576.23472466925,11.225884337250022,0],["\u9001",314.21382878624996,576.23472466925,11.225884337250022,0],["\u4ed8",325.4397131235,576.23472466925,11.225884337250022,0],["\u66f8",336.66559746074995,576.23472466925,11.225884337250022,0]],"fields":{"recipient":{"x":21.75,"baseline":795.4348872545,"size":14.180064426000058},"medical_institution_code":{"x":199.000805325,"baseline":504.15273050375004,"size":11.225884337250022},"name":{"x":199.000805325,"baseline":452.15916094175003,"size":11.225884337249965},"claim_month":{"x":295.60249422712496,"baseline":348.17202181775,"size":11.225884337249965,"center":379.7966267564999},"created_date":{"x":318.05426290162495,"baseline":296.17845225575,"size":11.225884337249965,"center":379.7966267564999},"address":{"x":285.85369993424996,"baseline":713.3086807872501,"size":11.225884337250022},"founder_name":{"x":285.85369993424996,"baseline":663.67845529625,"size":11.225884337250022}}},"nret":{"unit":null,"clip":[21.75,7.4494775,551.249997,812.8005225],"rects":[[21.75,804.41622349775,545.3856350775,0.5864361667499907,0.0],[21.75,467.2154276165,0.5864361667500013,337.787232048,0.0],[566.54919891075,467.2154276165,0.5864361667499907,337.787232048,0.0],[22.33643616675,674.22739447925,41.63696783924999,0.5864361667499907,0.0],[22.33643616675,650.76994780925,41.63696783924999,0.5864361667499907,0.0],[63.38696783925,650.76994780925,0.5864361667499978,24.043882836750072,0.0],[63.38696783925,674.22739447925,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,650.76994780925,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,650.76994780925,0.5864361667499978,24.043882836750072,0.0],[107.3696803455,650.76994780925,0.5864361667499907,24.043882836750072,0.0],[107.3696803455,674.22739447925,270.34707287175,0.5864361667499907,0.0],[107.3696803455,662.49867114425,270.34707287175,0.5864361667499907,0.0],[107.3696803455,662.49867114425,0.5864361667499907,12.315159501750031,0.0],[377.13031705049997,662.49867114425,0.5864361667500475,12.315159501750031,0.0],[377.13031705049997,513.54388478975,189.41888186025,0.5864361667499907,0.0],[377.13031705049997,513.54388478975,0.5864361667500475,161.26994585625005,0.0],[107.3696803455,662.49867114425,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,650.76994780925,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[166.0132970205,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[166.0132970205,662.49867114425,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,650.76994780925,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[224.6569136955,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[224.6569136955,662.49867114425,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,650.76994780925,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[300.893615373,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[300.893615373,662.49867114425,76.82313784425003,0.5864361667499907,0.0],[300.893615373,650.76994780925,76.82313784425003,0.5864361667499907,0.0],[300.893615373,650.76994780925,0.5864361667499907,12.315159501750031,0.0],[377.13031705049997,650.76994780925,0.5864361667500475,12.315159501750031,0.0],[22.33643616675,650.76994780925,18.17952116925,0.5864361667499907,0.0],[22.33643616675,559.2859057962501,18.17952116925,0.5864361667499907,0.0],[39.929521169249995,559.2859057962501,0.5864361667500049,92.0704781797499,0.0],[39.929521169249995,650.76994780925,24.04388283675,0.5864361667499907,0.0],[39.929521169249995,605.02792680275,24.04388283675,0.5864361667499907,0.0],[39.929521169249995,605.02792680275,0.5864361667500049,46.328457173249944,0.0],[63.38696783925,605.02792680275,0.5864361667499978,46.328457173249944,0.0],[63.38696783925,650.76994780925,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,627.898937306,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,627.898937306,0.5864361667499978,23.457446669999968,0.0],[107.3696803455,627.898937306,0.5864361667499907,23.457446669999968,0.0],[107.3696803455,650.76994780925,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,627.898937306,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,627.898937306,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,627.898937306,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,650.76994780925,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,627.898937306,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,627.898937306,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,627.898937306,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,650.76994780925,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,627.898937306,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,627.898937306,0.5864361667499907,23.457446669999968,0.0],[300.893615373,627.898937306,0.5864361667499907,23.457446669999968,0.0],[300.893615373,650.76994780925,76.82313784425003,0.5864361667499907,0.0],[300.893615373,627.898937306,76.82313784425003,0.5864361667499907,0.0],[300.893615373,627.898937306,0.5864361667499907,23.457446669999968,0.0],[377.13031705049997,627.898937306,0.5864361667500475,23.457446669999968,0.0],[63.38696783925,627.898937306,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,605.02792680275,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,605.02792680275,0.5864361667499978,23.457446669999968,0.0],[107.3696803455,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[107.3696803455,627.898937306,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,605.02792680275,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,627.898937306,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,605.02792680275,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,627.898937306,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,605.02792680275,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[300.893615373,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[300.893615373,627.898937306,76.82313784425003,0.5864361667499907,0.0],[300.893615373,605.02792680275,0.5864361667499907,23.457446669999968,0.0],[39.929521169249995,605.02792680275,24.04388283675,0.5864361667499907,0.0],[39.929521169249995,559.2859057962501,24.04388283675,0.5864361667499907,0.0],[39.929521169249995,559.2859057962501,0.5864361667500049,46.328457173249944,0.0],[63.38696783925,559.2859057962501,0.5864361667499978,46.328457173249944,0.0],[63.38696783925,605.02792680275,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,582.1569162995,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,582.1569162995,0.5864361667499978,23.457446669999968,0.0],[107.3696803455,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[107.3696803455,605.02792680275,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,582.1569162995,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,605.02792680275,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,582.1569162995,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,605.02792680275,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,582.1569162995,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[300.893615373,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[300.893615373,582.1569162995,76.82313784425003,0.5864361667499907,0.0],[300.893615373,582.1569162995,0.5864361667499907,23.457446669999968,0.0],[377.13031705049997,582.1569162995,0.5864361667500475,23.457446669999968,0.0],[63.38696783925,582.1569162995,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,559.2859057962501,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,559.2859057962501,0.5864361667499978,23.457446669999968,0.0],[107.3696803455,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[107.3696803455,582.1569162995,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,559.2859057962501,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,582.1569162995,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,559.2859057962501,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,582.1569162995,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,559.2859057962501,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[300.893615373,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[300.893615373,582.1569162995,76.82313784425003,0.5864361667499907,0.0],[300.893615373,559.2859057962501,0.5864361667499907,23.457446669999968,0.0],[22.33643616675,559.2859057962501,41.63696783924999,0.5864361667499907,0.0],[22.33643616675,513.54388478975,41.63696783924999,0.5864361667499907,0.0],[63.38696783925,513.54388478975,0.5864361667499978,46.32845717325006,0.0],[63.38696783925,559.2859057962501,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,536.414895293,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,536.414895293,0.5864361667499978,23.45744667000008,0.0],[107.3696803455,536.414895293,0.5864361667499907,23.45744667000008,0.0],[107.3696803455,559.2859057962501,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,536.414895293,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,536.414895293,0.5864361667499907,23.45744667000008,0.0],[166.0132970205,536.414895293,0.5864361667499907,23.45744667000008,0.0],[166.0132970205,559.2859057962501,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,536.414895293,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,536.414895293,0.5864361667499907,23.45744667000008,0.0],[224.6569136955,536.414895293,0.5864361667499907,23.45744667000008,0.0],[224.6569136955,559.2859057962501,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,536.414895293,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,536.414895293,0.5864361667499907,23.45744667000008,0.0],[300.893615373,536.414895293,0.5864361667499907,23.45744667000008,0.0],[300.893615373,536.414895293,76.82313784425003,0.5864361667499907,0.0],[300.893615373,536.414895293,0.5864361667499907,23.45744667000008,0.0],[377.13031705049997,536.414895293,0.5864361667500475,23.45744667000008,0.0],[63.38696783925,536.414895293,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,513.54388478975,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,513.54388478975,0.5864361667499978,23.457446669999968,0.0],[107.3696803455,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[107.3696803455,536.414895293,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,513.54388478975,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[166.0132970205,536.414895293,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,513.54388478975,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[224.6569136955,536.414895293,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,513.54388478975,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[300.893615373,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[300.893615373,536.414895293,76.82313784425003,0.5864361667499907,0.0],[300.893615373,513.54388478975,0.5864361667499907,23.457446669999968,0.0],[22.33643616675,513.54388478975,41.63696783924999,0.5864361667499907,0.0],[22.33643616675,467.2154276165,41.63696783924999,0.5864361667499907,0.0],[63.38696783925,467.2154276165,0.5864361667499978,46.91489333999999,0.0],[63.38696783925,513.54388478975,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,490.08643811975,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,490.08643811975,0.5864361667499978,24.043882836749958,0.0],[107.3696803455,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[107.3696803455,513.54388478975,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,490.08643811975,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[166.0132970205,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[166.0132970205,513.54388478975,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,490.08643811975,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[224.6569136955,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[224.6569136955,513.54388478975,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,490.08643811975,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[300.893615373,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[300.893615373,490.08643811975,76.82313784425003,0.5864361667499907,0.0],[300.893615373,490.08643811975,0.5864361667499907,24.043882836749958,0.0],[377.13031705049997,490.08643811975,0.5864361667500475,24.043882836749958,0.0],[377.13031705049997,513.54388478975,70.95877617675,0.5864361667499907,0.0],[377.13031705049997,501.81516145475,70.95877617675,0.5864361667499907,0.0],[377.13031705049997,501.81516145475,0.5864361667500475,12.315159501749974,0.0],[447.5026570605,501.81516145475,0.5864361667499907,12.315159501749974,0.0],[447.5026570605,513.54388478975,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,501.81516145475,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,501.81516145475,0.5864361667499907,12.315159501749974,0.0],[377.13031705049997,501.81516145475,70.95877617675,0.5864361667499907,0.0],[377.13031705049997,490.08643811975,70.95877617675,0.5864361667499907,0.0],[377.13031705049997,490.08643811975,0.5864361667500475,12.315159501749974,0.0],[447.5026570605,490.08643811975,0.5864361667499907,12.315159501749974,0.0],[447.5026570605,501.81516145475,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,490.08643811975,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,490.08643811975,0.5864361667499907,12.315159501749974,0.0],[63.38696783925,490.08643811975,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,467.2154276165,44.569148672999994,0.5864361667499907,0.0],[63.38696783925,467.2154276165,0.5864361667499978,23.457446670000024,0.0],[107.3696803455,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[107.3696803455,490.08643811975,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,467.2154276165,59.230052841749995,0.5864361667499907,0.0],[107.3696803455,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[166.0132970205,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[166.0132970205,490.08643811975,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,467.2154276165,59.230052841749995,0.5864361667499907,0.0],[166.0132970205,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[224.6569136955,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[224.6569136955,490.08643811975,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,467.2154276165,76.82313784424997,0.5864361667499907,0.0],[224.6569136955,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[300.893615373,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[300.893615373,490.08643811975,76.82313784425003,0.5864361667499907,0.0],[300.893615373,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[377.13031705049997,490.08643811975,70.95877617675,0.5864361667499907,0.0],[377.13031705049997,467.2154276165,70.95877617675,0.5864361667499907,0.0],[447.5026570605,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[447.5026570605,490.08643811975,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,467.2154276165,119.04654185024998,0.5864361667499907,0.0],[447.5026570605,467.2154276165,0.5864361667499907,23.457446670000024,0.0],[300.893615373,605.02792680275,76.82313784425003,0.5864361667499907,0.333333333],[377.13031705049997,605.02792680275,0.5864361667500475,23.457446669999968,0.333333333],[300.893615373,605.02792680275,76.82313784425003,0.5864361667499907,0.333333333],[300.893615373,559.2859057962501,76.82313784425003,0.5864361667499907,0.333333333],[377.13031705049997,559.2859057962501,0.5864361667500475,23.457446669999968,0.333333333],[300.893615373,559.2859057962501,76.82313784425003,0.5864361667499907,0.333333333],[300.893615373,513.54388478975,76.82313784425003,0.5864361667499907,0.333333333],[377.13031705049997,513.54388478975,0.5864361667500475,23.457446669999968,0.333333333],[300.893615373,513.54388478975,76.82313784425003,0.5864361667499907,0.333333333],[300.893615373,467.2154276165,76.82313784425003,0.5864361667499907,0.333333333],[377.13031705049997,467.2154276165,0.5864361667500475,23.457446670000024,0.333333333],[377.13031705049997,467.2154276165,0.5864361667500475,23.457446670000024,0.333333333],[490.8989334,819.66356383325,76.23670167749998,0.5864361667499907,0.0],[490.8989334,805.0026596645,0.5864361667499907,15.247340335499985,0.0],[566.54919891075,805.0026596645,0.5864361667499907,15.247340335499985,0.0],[419.94015722324997,790.9281916625,146.6090416875,0.5864361667499907,0.0],[419.94015722324997,790.9281916625,0.5864361667500475,13.488031835250013,0.0],[419.94015722324997,790.9281916625,146.6090416875,0.5864361667499907,0.0],[419.94015722324997,777.44015982725,146.6090416875,0.5864361667499907,0.0],[419.94015722324997,777.44015982725,0.5864361667500475,14.074468002000003,0.0]],"polys":[[[[302.69302125,235.04320574999997],[375.7655665455,215.46347626124998],[375.91734739425,216.02993010075],[302.84480209875,235.60965958949998],[302.69302125,235.04320574999997]],0.333333333],[[[302.69302125,280.7852264999999],[375.7655665455,261.2054970112499],[375.91734739425,261.77195085074993],[302.84480209875,281.3516803394999],[302.69302125,280.7852264999999]],0.333333333],[[[302.69302125,326.527248],[375.7655665455,306.94751851125],[375.91734739425,307.51397235075],[302.84480209875,327.0937018395],[302.69302125,326.527248]],0.333333333],[[[302.69302125,372.855705],[375.7655665455,353.27597551125],[375.91734739425,353.84242935075],[302.84480209875,373.4221588395],[302.69302125,372.855705]],0.333333333]],"paths":[],"glyphs":[["\u533b",504.973401402,809.10771283175,10.555851001499946,0],["(",515.5292524035,809.10771283175,10.55585100150006,1],["\u6b6f",519.6434686358555,809.10771283175,10.555851001499946,0],[")",530.1993196373555,809.10771283175,10.55585100150006,1],["(",534.3135358697109,809.10771283175,10.55585100150006,1],["\u85ac",538.4277521020664,809.10771283175,10.555851001499946,0],[")",548.9836031035663,809.10771283175,10.55585100150006,1],["\u533b",441.931513476375,795.03324482975,9.382978667999964,0],["\u7642",451.314492144375,795.03324482975,9.382978667999964,0],["\u6a5f",460.697470812375,795.03324482975,9.382978667999964,0],["\u95a2",470.08044948037497,795.03324482975,9.382978667999964,0],["\uff08",479.463428148375,795.03324482975,9.382978667999964,0],["\u85ac",488.846406816375,795.03324482975,9.382978667999964,0],["\u5c40",498.229385484375,795.03324482975,9.382978667999964,0],["\uff09",507.612364152375,795.03324482975,9.382978667999964,0],["\u30b3",516.9953428203751,795.03324482975,9.382978667999964,0],["\u30fc",526.3783214883749,795.03324482975,9.382978667999964,0],["\u30c9",535.761300156375,795.03324482975,9.382978667999964,0],["\u8a3a",39.929521169249995,694.16622414875,10.555851001499946,0],["\u7642",53.83905399935156,694.16622414875,10.555851001499946,0],["\u5831",67.74858682945313,694.16622414875,10.555851001499946,0],["\u916c",81.65811965955469,694.16622414875,10.555851001499946,0],["\u5be9",95.56765248965625,694.16622414875,10.555851001499946,0],["\u67fb",109.47718531975781,694.16622414875,10.555851001499946,0],["\u59d4",123.38671814985938,694.16622414875,10.555851001499946,0],["\u54e1",137.29625097996092,694.16622414875,10.555851001499946,0],["\u4f1a",151.20578381006248,694.16622414875,10.555851001499946,0],["\u6bbf",165.11531664016405,694.16622414875,10.555851001499946,0],["\u4fdd",275.67686020275,736.38962815475,9.382978667999964,0],["\u967a",285.05983887075,736.38962815475,9.382978667999964,0],["\u533b",294.44281753875,736.38962815475,9.382978667999964,0],["\u7642",303.82579620675,736.38962815475,9.382978667999964,0],["\u6a5f",313.20877487475,736.38962815475,9.382978667999964,0],["\u95a2",322.59175354275,736.38962815475,9.382978667999964,0],["\uff08",331.97473221075,736.38962815475,9.382978667999964,0],["\u4fdd",341.35771087874997,736.38962815475,9.382978667999964,0],["\u967a",350.74068954675,736.38962815475,9.382978667999964,0],["\u85ac",360.12366821475,736.38962815475,9.382978667999964,0],["\u5c40",369.50664688275,736.38962815475,9.382978667999964,0],["\uff09",378.88962555075,736.38962815475,9.382978667999964,0],["\u306e",388.27260421875,736.38962815475,9.382978667999964,0],["\u6240",397.65558288675,736.38962815475,9.382978667999964,0],["\u5728",407.03856155475,736.38962815475,9.382978667999964,0],["\u5730",416.42154022274997,736.38962815475,9.382978667999964,0],["\u53ca",425.80451889075,736.38962815475,9.382978667999964,0],["\u3073",435.18749755875,736.38962815475,9.382978667999964,0],["\u540d",444.57047622675,736.38962815475,9.382978667999964,0],["\u79f0",453.95345489475,736.38962815475,9.382978667999964,0],["\u958b",277.436168703,721.728723986,9.382978667999964,0],["\u8a2d",289.7971435302773,721.728723986,9.382978667999964,0],["\u8005",302.15811835755466,721.728723986,9.382978667999964,0],["\u6c0f",314.519093184832,721.728723986,9.382978667999964,0],["\u540d",326.88006801210935,721.728723986,9.382978667999964,0],["\u8a3a",218.45351861909765,762.7792556585,14.074468002000003,0],["\u7642",232.52798662109765,762.7792556585,14.074468002000003,0],["\u5831",246.60245462309766,762.7792556585,14.074468002000003,0],["\u916c",260.67692262509763,762.7792556585,14.074468002000003,0],["\u7dcf",274.75139062709763,762.7792556585,14.074468002000003,0],["\u62ec",288.82585862909764,762.7792556585,14.074468002000003,0],["\u8868",302.90032663109764,762.7792556585,14.074468002000003,0],["\u8a3a",221.72473286175,666.6037243115,6.450797834250011,0],["\u7642",234.3056212515586,666.6037243115,6.450797834250011,0],["\u5831",246.88650964136718,666.6037243115,6.450797834250011,0],["\u916c",259.4673980311758,666.6037243115,6.450797834250011,0],["\u4ef6",127.89494618175,654.8750009765,6.450797834250011,0],["\u6570",140.4758345715586,654.8750009765,6.450797834250011,0],["\u5b9f",184.19281818975,654.8750009765,6.450797834250011,0],["\u65e5",192.68697954251954,654.8750009765,6.450797834250011,0],["\u6570",201.18114089528905,654.8750009765,6.450797834250011,0],["\u70b9",253.978722033,654.8750009765,6.450797834250011,0],["\u6570",266.5596104228086,654.8750009765,6.450797834250011,0],["\u98df",326.403588626625,654.8750009765,6.450797834250011,0],["\u4e8b",332.854386460875,654.8750009765,6.450797834250011,0],["\u7642",339.305184295125,654.8750009765,6.450797834250011,0],["\u990a",345.755982129375,654.8750009765,6.450797834250011,0],["\u56fd",26.441489334,634.936171307,9.382978667999964,0],["\u6c11",26.441489334,622.0345756385,9.382978667999964,0],["\u5065",26.441489334,609.13297997,9.382978667999964,0],["\u5eb7",26.441489334,596.2313843015,9.382978667999964,0],["\u4fdd",26.441489334,583.329788633,9.382978667999964,0],["\u967a",26.441489334,570.4281929645,9.382978667999964,0],["\u4e00",44.0345743365,641.973405308,7.623670167749992,0],["\u822c",44.0345743365,610.3058523035,7.623670167749992,0],["\u88ab",51.65824450425,641.973405308,7.623670167749992,0],["\u4fdd",51.65824450425,631.4175543065,7.623670167749992,0],["\u967a",51.65824450425,620.861703305,7.623670167749992,0],["\u8005",51.65824450425,610.3058523035,7.623670167749992,0],["\u5165",76.28856350775,636.69547980725,9.382978667999964,0],["\u9662",85.67154217575,636.69547980725,9.382978667999964,0],["\u5186",366.57446604899997,637.281915974,7.623670167749992,0],["\u5165",71.59707417375,613.824469304,9.382978667999964,0],["\u9662",80.98005284175,613.824469304,9.382978667999964,0],["\u5916",90.36303150975,613.824469304,9.382978667999964,0],["\u9000",48.13962750375,590.95345880075,7.623670167749992,0],["\u8077",48.13962750375,580.39760779925,7.623670167749992,0],["\u8005",48.13962750375,569.84175679775,7.623670167749992,0],["\u5165",76.28856350775,590.95345880075,9.382978667999964,0],["\u9662",85.67154217575,590.95345880075,9.382978667999964,0],["\u5165",71.59707417375,568.0824482975,9.382978667999964,0],["\u9662",80.98005284175,568.0824482975,9.382978667999964,0],["\u5916",90.36303150975,568.0824482975,9.382978667999964,0],["\u5f8c",35.23803183525,545.2114377942501,7.623670167749992,0],["\u671f",35.23803183525,524.0997357912499,7.623670167749992,0],["\u9ad8",42.861702003,545.2114377942501,7.623670167749992,0],["\u9f62",42.861702003,534.65558679275,7.623670167749992,0],["\u8005",42.861702003,524.0997357912499,7.623670167749992,0],["\u5165",76.28856350775,545.2114377942501,9.382978667999964,0],["\u9662",85.67154217575,545.2114377942501,9.382978667999964,0],["\u5165",71.59707417375,522.340427291,9.382978667999964,0],["\u9662",80.98005284175,522.340427291,9.382978667999964,0],["\u5916",90.36303150975,522.340427291,9.382978667999964,0],["\u5408",39.049866919124995,498.882980621,7.623670167749992,0],["\u8a08",39.049866919124995,477.771278618,7.623670167749992,0],["\u5165",76.28856350775,499.46941678775,9.382978667999964,0],["\u9662",85.67154217575,499.46941678775,9.382978667999964,0],["\uff08",397.65558288675,505.920214622,6.450797834250011,0],["1",404.106380721,505.920214622,6.450797834249954,1],["\uff09",408.20227082314454,505.920214622,6.450797834250011,0],["\u516c",414.6530686573945,505.920214622,6.450797834250011,0],["\u8cbb",421.1038664916445,505.920214622,6.450797834250011,0],["\uff08",469.78723139699997,505.920214622,6.450797834250011,0],["2",476.23802923125,505.920214622,6.450797834249954,1],["\uff09",480.33391933339453,505.920214622,6.450797834250011,0],["\u798f",486.78471716764454,505.920214622,6.450797834250011,0],["\u7949",493.2355150018945,505.920214622,6.450797834250011,0],["\uff08",499.6863128361445,505.920214622,6.450797834250011,0],["\u5b50",506.1371106703945,505.920214622,6.450797834250011,0],["\u969c",512.5879085046445,505.920214622,6.450797834250011,0],["\u6bcd",519.0387063388946,505.920214622,6.450797834250011,0],["\u7cbe",525.4895041731445,505.920214622,6.450797834250011,0],["\u5f8c",531.9403020073945,505.920214622,6.450797834250011,0],["\uff09",538.3910998416445,505.920214622,6.450797834250011,0],["\u4ef6",401.760636054,494.191491287,6.450797834250011,0],["\u6570",418.4282514808476,494.191491287,6.450797834250011,0],["\u4ef6",496.470076984125,494.191491287,6.450797834250011,0],["\u6570",513.1376924109727,494.191491287,6.450797834250011,0],["\u5165",71.59707417375,476.01197011775,9.382978667999964,0],["\u9662",80.98005284175,476.01197011775,9.382978667999964,0],["\u5916",90.36303150975,476.01197011775,9.382978667999964,0],["\u203b",21.75,451.968087281,9.382978668000021,1],["\u8a3a",32.58990601976953,451.968087281,9.382978667999964,0],["\u7642",41.972884687769536,451.968087281,9.382978667999964,0],["\u5831",51.35586335576953,451.968087281,9.382978667999964,0],["\u916c",60.73884202376953,451.968087281,9.382978667999964,0],["\u8acb",70.12182069176953,451.968087281,9.382978667999964,0],["\u6c42",79.50479935976952,451.968087281,9.382978667999964,0],["\u66f8",88.88777802776953,451.968087281,9.382978667999964,0],["\u3092",98.27075669576953,451.968087281,9.382978667999964,0],["\u307e",107.65373536376953,451.968087281,9.382978667999964,0],["\u3068",117.03671403176953,451.968087281,9.382978667999964,0],["\u3081",126.41969269976953,451.968087281,9.382978667999964,0],["\u3066",135.80267136776953,451.968087281,9.382978667999964,0],["\u96c6",145.18565003576953,451.968087281,9.382978667999964,0],["\u8a08",154.56862870376952,451.968087281,9.382978667999964,0],["\u3057",163.95160737176954,451.968087281,9.382978667999964,0],["\u8a18",173.33458603976953,451.968087281,9.382978667999964,0],["\u5165",182.71756470776953,451.968087281,9.382978667999964,0],["\u306e",192.10054337576952,451.968087281,9.382978667999964,0],["\u3053",201.48352204376954,451.968087281,9.382978667999964,0],["\u3068",210.86650071176953,451.968087281,9.382978667999964,0],["\u3002",220.24947937976953,451.968087281,9.382978667999964,0]],"fields":{"medical_institution_code":{"x":472.71941223075,"baseline":781.5452129945,"size":9.382978668000078,"center":493.57520815148445},"created_date":{"x":39.929521169249995,"baseline":735.21675582125,"size":10.555851001499946},"recipient":{"x":39.929521169249995,"baseline":708.8271283175,"size":10.555851001499946},"address":{"x":346.04920021275,"baseline":722.31516015275,"size":8.210106334499983},"name":{"x":346.04920021275,"baseline":707.06781981725,"size":9.382978667999964},"phone":{"x":346.04920021275,"baseline":694.16622414875,"size":9.382978668000078},"founder_name":{"x":346.04920021275,"baseline":681.2646284802499,"size":9.382978667999964},"claim_month":{"x":80.98005284175,"baseline":762.7792556585,"size":14.074468002000003}},"copies":[0,406.9866997245]},"social":{"unit":0.6004901819999999,"pages":[{"z":"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","res":{"dict":{"ColorSpace":{"dict":{"PCSp":{"ref":"4"},"CSp":{"name":"DeviceRGB"},"CSpg":{"name":"DeviceGray"}}},"ExtGState":{"dict":{"GSa":{"ref":"3"}}},"Pattern":{"dict":{}},"Font":{"dict":{"F6":{"ref":"6"},"F7":{"ref":"7"},"F8":{"ref":"8"}}},"XObject":{"dict":{}}}}},{"z":"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","res":{"dict":{"ColorSpace":{"dict":{"PCSp":{"ref":"4"},"CSp":{"name":"DeviceRGB"},"CSpg":{"name":"DeviceGray"}}},"ExtGState":{"dict":{"GSa":{"ref":"3"}}},"Pattern":{"dict":{}},"Font":{"dict":{"F7":{"ref":"7"},"F6":{"ref":"6"}}},"XObject":{"dict":{}}}}}],"objects":{"4":{"array":[{"name":"Pattern"},{"name":"DeviceRGB"}]},"3":{"dict":{"Type":{"name":"ExtGState"},"SA":{"bool":true},"SM":0.02,"ca":1.0,"CA":1.0,"AIS":{"bool":false},"SMask":{"name":"None"}}},"6":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"Type0"},"BaseFont":{"name":"IPAGothic"},"Encoding":{"name":"Identity-H"},"DescendantFonts":{"array":[{"ref":"35"}]},"ToUnicode":{"ref":"36"}}},"35":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"CIDFontType2"},"BaseFont":{"name":"IPAGothic"},"CIDSystemInfo":{"dict":{"Registry":{"bytes":"QWRvYmU="},"Ordering":{"bytes":"SWRlbnRpdHk="},"Supplement":0}},"FontDescriptor":{"ref":"33"},"CIDToGIDMap":{"name":"Identity"},"DW":992}},"33":{"dict":{"Type":{"name":"FontDescriptor"},"FontName":{"name":"QHBAAA+IPAGothic"},"Flags":4,"FontBBox":{"array":[-455.078125,-278.808593,1000,930.175781]},"ItalicAngle":0,"Ascent":879.882812,"Descent":-120.117187,"CapHeight":879.882812,"StemV":50.78125,"FontFile2":{"ref":"34"}}},"34":{"dict":{"Length1":31172},"z":"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"},"36":{"dict":{},"z":"eNpdVMmO2zAMvecrdJweBrEkawOCAJZkAzl0QdOeih4ytjIw0DiG4znk7ys9pquBhKAoPpKPFLfhEA/TuLLtp+XaH9PKzuM0LOl2fVv6xF7S6zhtuGDD2K8PDf/95TRvttn5eL+t6XKYzle227Ht52y8rcudPTXD9SW9Y9uPy5CWcXplT1/DMevHt3n+kS5pWlnF9ns2pHMGen+aP5wuiW3h9nwYsn1c78/Z58+NL/c5MQGdUzL9dUi3+dSn5TS9ps2uyt+e7br87TdpGv6zC/J6Of97/W+BQw7N1Xv2baddtFlVXdVlYbwIWdQtPFTlXBa2qmQWkmBkpUjTbXFQoribyB0ddnSzhNCqVUUYYKpImtOxYDpbbmorYRPcAEw3hGIpEGFaT5gCmbV1cagt/FpTI0KFGkSlC3QjC4rRdXFQVpZcHNcBtlDAdIBN686CTnKXstiMixzxuqIprkvWTmuAZRhycMSSByYv7q7ilLwloQyEaZGZQO3eo+hGFeFUI3DFE59dgAiA7mJEWFPAtKjRDgOulZHQZKBARoKQKiL5rtg05yjFgHJjKpAlQbKSxGCoUV/7oFVFCDo06IOOGnw6g6w1alDcQngIWTXU8JZyCdSqIFGfJXpEpCECBQFzpkKnkYvD1D260kiHQ0P1oY11i5ta0aEnh8o7UN4WQmxoULQIaBVH//KgKOpRQbGC5rqr0Y7OGeotZiJ4D5tBYVJhoEX7eAiP0SfqVI2bnDAlvQ4Dm4gOfoaGloNybjheR10jXXpVRIFtHkNrqAEemBxEKu+p6ADmPbWY4+XkTls44AVo2RiaT0SwNY1NK/GcQIhRHCgR42090jUR0HmSacptjve9rJRfy6Nsl7IEf6+u/m1Z8tbCpsS6KotqnNLvZTpf5+KF30+3d1Ds"},"7":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"Type0"},"BaseFont":{"name":"DejaVuSans"},"Encoding":{"name":"Identity-H"},"DescendantFonts":{"array":[{"ref":"30"}]},"ToUnicode":{"ref":"31"}}},"30":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"CIDFontType2"},"BaseFont":{"name":"DejaVuSans"},"CIDSystemInfo":{"dict":{"Registry":{"bytes":"QWRvYmU="},"Ordering":{"bytes":"SWRlbnRpdHk="},"Supplement":0}},"FontDescriptor":{"ref":"28"},"CIDToGIDMap":{"name":"Identity"},"W":{"array":[0,{"array":[595,679,631,315,631,631,631,631,631,631,631,315,631,631,387,889,889]}]}}},"28":{"dict":{"Type":{"name":"FontDescriptor"},"FontName":{"name":"QCBAAA+DejaVuSans"},"Flags":4,"FontBBox":{"array":[-1020.50781,-462.890625,1793.45703,1232.42187]},"ItalicAngle":0,"Ascent":928.222656,"Descent":-235.839843,"CapHeight":928.222656,"StemV":43.9453125,"FontFile2":{"ref":"29"}}},"29":{"dict":{"Length1":17872},"z":"eNrtO2twW9WZ50i2nB4eifNwgJbm2MZxMgg5G5N4mxQa2ZZtObJkJNl5QJpcS1fWxZKu9t4rG7PdhZCQB2GAdmiAJdtNS2gZlmFnmE4Ls7uz7bIl6esPbWZnO1NKyFKYli3dzuwOm02U/c53z9XDj+A8SNKZtSLr3HO/9+t894tMKCFkHnmQuAmJxNpWb7lt/DbYeRTew6OZydTvfGd0WP87IZ5iWlWS6reCzxFSB9dkbRo2rvvTa78KBD4D17eks9Z9sdfmHYXrDXDdndETyrW1130E17vF/axyX54sIRG4fgGueU7Jqsv0AaA37xghd8wjtOZ6+gSpJaS2vfYZQuhn7U/3v5KUayEhrms8bve8Gper5j2SO/smOXOW3bJjZQ3h1w6mAkmygfCzZz2Li4vpX9Vl6ckdhJ791VkiflwkVTxYk6o9AlrWEbKovrG+pbG+MVVDTpvuT59+t3iw7vqP/mB4VgLkAuCerj0OKwYS0EbaTpvdje5m1z8Uf+dqKf75u67PvbnvzPZ9x2uvP3Oj++VTt9IHijsBOklIzRHEuw7x3O317Uua65vrG9e4PUUXLa4pHj/+wzNfrG05fdL909PtLxQP0x2vC9n2nH2n5vHa35P5ZBlgNtV5FrmWNnQ0dKytX9C6vHX10ob6BXWeVk/r8kWujrWuA4fCg5QOhg8dGgyHBw+d2rN7955T/7t7D6V7dtcOPvNs8afFnzz9LKXPPk1vp+3PPnP4jWPFvcW9bxyj9NgbdJJOHnsDrPDI2ZM1B5DnKrAboZ46z5LFSxvaV3es7bi9dXnL8tblHbfDumFpw5LFdZ46+dncBPvLYd/tsYHXAHArILsOPBGNxaJPPBGL0mis+Pyu3n764ANvvfXgA339D345dtfuPf/90S6QMRb9Sj/t79v1UH8w2P/Qrr5+1w9oaGDvvtBAOLR370Bo07Ktm3e+oo1SOqq9snPz1mXNI8nHfmFalvmLx5IjzfQLhQ1+/4aC2bmB0g2dwnoPgvX2giYcNCEda0DQDpBrkcc22RoQtp2DCV11nhYQnkqZm5tshU+EwuGNR8e0+es3b8m8/dAuun/vSerev49+84XiuwMDYXrnvsFIZHDf/vDgYHjZq7csWkz3PkwXDfvaKN2/54N3Hz2A5v2bN39O5893PbVt2zcOb9+2bfvhb2zbRig5ATGxFWICIqmjsb52TUt7feOSxiLtLz5D1R/R/tNHXqwx+17tO3X8RYCGnKgRkeeBCG1cQptp4wvu751552e0eKa99vjwqZ21twLUIdDXBH1vB68Jr4CiLaBoq6P5GnBda/Oa9gpF69asBSvA/aUA7P7CE7G76FNPF9/fPqJqMTWR+0c1Qe/e9vzL33lyMHJX7Kn4F7cbpprc8i4oSnv63C1cGXnil5P3U7q4fvnrq2+4iW7c+PjujUH6zc+v+zPzzjsWLmr59rL6BcJhfxEfBgkPgh79IOEthLSAuoI5vpZPkQYDC150v+v7p0PGsTfaldYWSqNDD2/XxiYmx7Qt7z/ySFPz3Tc9vOfFF18c/9HR9ZmB/v7x0MbGxq6frLrpRmoWvn9PNJa/+ZFHgevXzi6kr5OiqB4d7UvczYt+/7MjO6PFl4rfoxtEnDwOdjsoIx6zTLhfZJmwEl0ihXML2VbbsrXWtC6vX9CxthGuXUcwAvZjNNBPDYTCoWPa2PXrtm7OnNj10L79J4qn9+1/4Vv0M3DDvR7C4OvbtlO6fdvXIRBck682L160d2/xw01tvn37f/vrA4/KXFR+/ub8+Sj7OzVJ8HwLer6x3nEXCNHo+La9ocKEv3TfeObwrbfdetupr3yZHjxY/HD7jsTo1h07xl5KJSlNpl6KRu6K1x5/sfiV+fPq6L79v/kDFIj6BfzHq5feQO+5+9Cz99wNbgPOR4p/cOmehaQeODsRUtcsvXXk8EFwMw1uPHj4YTvhPAs/eOfkWyfeOfnbd0++8957JyDA3eSpsx94nqx9nywiK0g72BZSrZGD6USdQGMubahdsLShkUNFE+XCVsGzlLbX14mUaF/S6HmS/upE8Z+Lr//qBE2Pvvbdf/r+a99Np05tOnaUfoZ++odH777nuedfevm5I3ffQ+mX/u0DSr/+izNPuX5T/N5bb7/9Ft3wxmuvJhOJxKuvHS2ePHoMkG5+5fnntmzevOW5518pvuL6y1ufbjv968emyjpwPrLOGsirbT+J13lo4YrQb5+5J7rroaY7bmyg1LcqvL6z09zR33vncwmF3nDjHQs3b52rfo/tDN0/0Xynd+XKL7S2Llr8ub9trp+/ceBL69vX9CyKDonzj9pvz/0vdW2f//n/Egf+9J/iQc+TEAlU1B/5Azh12eLNhMxvPwsvz1eRUuVPfc1PSap2kiyoXUqSrgNwdi4le+F9AN474X0C3i/A+xC8D8L9r8Hn4/D+mnsZOVLnJU+LN9BZQv6EhOG1j/wHXU+jVKXfof/pAjO5HnW97K5xP4Cc6wHC7Ug27ecmemdp/2m6Wq4puYaelGsXqaH/I9duco2rQa5rYL1OrmvJta4dcu0hzLVLrueRetcrcn0NudntyHDdwr9esVWurye3rx+R6wXkmvV/J9f1pGb9D4AjrfkUoK1C7mJNSQP9sVy7yDz6oVy7Yb8o1zWkwdUk17XkBlePXHvIYldWrueRJtdjcn0NWef6F7m+rmWd+7NyfT1Jr/tIrheQhvVPyXU9mbf+70kX0UmeTBKDaGSUpIkF5+kKkiAr4XM1VMxVkNmcjAAEJ50AYxET3gZRiUKyxAu7QZIDeB+s/CQDL06iJVomXqnwqQLOOPxOAiSbA9e1Ja5x4DQOvO4FnBxACzkUwDk/jt2wuhfwhkkBIBIAqyA1FTEU1IgDlRz8zgPMCNDVAI4Dvg7cFbwH53mXnp80tNG0xVckVvLVq1a185FJ3qlZpmWoStbLg7mEj/szGR4VUCaPqqZqjKtJH5uGulagxpXx7L16bpR3KulZELvVe5XhAk+kldyoanLFULmW4/nCSEZL8KSeVbQcSFatYgwVNGHbRo4pObjoBGV0MgYLXR+bG8pcYIbR2ibYSEcLrgabt5MOuKEapqbn+Gpfe0c1qSmEZuKVQmq2Ty0ZcQ7flJ4DE1lgcYJ+t8Br60gbvJKSxjjQ8AGuDp8GeFJFegb63Ad0VcAhacvKr2trSwLR8YLP1AtGQk3pxqjqy6lwu6dCAidGnDidng3inog7FWNXhQjSyQTAiki9NPEnKPXCnUmASSOmBvfyqJeFsS6sZiCGyA5BdXyKJafqUc6vQlV+zaYNg9dMutsxoMCq0mrTM52R2y7ixeZUPS59zeIfo7MGdxiuLNwRUZhFW4/Bng4e+DhZhGaDSC+L1MrZpKFMabynSr1GkUtOet0r/W57y+Zmx5gd716US0fv5xA/LzPW5qADVUvGmCajQEEatqWZpGmhFFPjKYFwIg5t6g4FAW3Lbseyiglvx15TRZQ0oecEbhI/TZQrATiK1I9hFiQgQrNIxcI7jn1SsMrITFpRkrHMQVQtIb8F8WtHv+BYtonYyWPWJIFDArEdaZKogYWxNgJ3Lbxr82Dn4OCV2ZwAyQpIxbbJBMZAGquSJS2Txb1KjRwdjKqotKUtoA29Fd4R6yz60/Y1q6ggJmB7Z9HDW9KzDSsIR8p2Pti0NWnVau+fW2vHcra0+VJEWyhXOerKGk2gPbJz4uBkQwqrek5qqFZwTOJvwcOLn8IS9wJEAunZMI7/RBxnZGVzPJRA3kmUWJOSrsPsjEvpFKCoY2Uo+6CyFpUtML0S5ADektlgVsE6uZKfsQZU4nHUWUHJGdbm6lizrWGfJco5/KnjKcil77P4qZ6HtwXMJMqbwiogaPuqLHUuXGGTSXm22NyFzVMoY1JGUgbj1Cjt2JIKmyYrfF4Zdc4JquCJqGHNyOAVK2mUREmFv3IV1hitOldtTk4NVTB67Nh1eEy1j/mxOjlSMqlBOcIU9NHcJajmM9UeM8nmlf7OIJ42SzVnJe8YWGcVrCtlus6OWYpIJ1+mnh6qrHMqauFwmkCtkojfNMN52FTSeyoGg3vOadtUEWV2zoSmnC8jmO96hawFmQdOnIzDXW0Gi6nkPrRzTmZyHl726aVgRVVLGJV+t2V2dtiMmZLGCs/x05QyqhhJs8WJU+tmqt1JPAly6PdKe81kVVZhuUofXmiumlg1nbO6nG1OJil4rjm9hyExqinmMaLH4Peo9Jh9HoqoYqWq+klWqtm1GpE5YsnzMFWyVB8JIJ8ICcOV4BOBqzjZBH1kFO8FYY9DHxeFO8Nw1Q273egXP94R95swGzfBWlCMkCGkZdOIwm9BewvsCNocr8XVRoAPAy2BGyCbkUcAqMVAsgisBe0B2A3BZ0DCCYwu2BmCa7HuxS7U5hcGrDjmjsATstiSxmG/zLVaqiBydCQbgKso0O+Td/1AO4j0hPxe7I/EOizltC0XRerCRoKyoNkFEoXwSuwOwecgwMXQnn7U2ZY2jDr0wH1blwBKYHvClqgLPgeBt4DoBbniaAXBKS4hvehHoU834guuGxHKliwivRzFpwCHik/a0pZD2H+4xDmG+ofgxVH/OOzE0Td+oO/QdWKnFykIuRlaYwj186MdIsihE+GEFYU9Q6WIi1Z4pQvtJfzmxWdLP2rSW/LOVE0capXemSk6WIlDL+oXQEuFEDoGdgwAfLC0Y8djEHXtkra2adpxb8dEqMK6Xaij8OxdwDUgY8qPtqvWQvhpE8pf1sL2gF/+7qqwWdn7YeldR544co7PYJVNmIsBhPKjr2OlHOnB/B2Qkg+VIqxcA4ZkfEZKklXb18kjB24utcOm5fCu9mA3xlNIShgrWcOGYOega9euAJxrCXzOsUp1u/rkruway91oZd/prai1lZ2AXYV7ETY7Ba68az8t2WdW+Vmnsneb6QnbeTr2VnW95e7Drt32M1Fl15vE/tzuAc1SV6JjH6iXOpMJvKtWPK3YsxO96jlPcFbw7PeWeDlnkV7R5SRR6ozkZs5gzdlPKDbtyTCP573NZQLXluxMhH4FCSv275/yNGxMeZoq+4DP6ANHl5k6h0r7G+jvvHyW0tDCop/0SbpG6bmsbBNhAXvulp3i9XL0CWrrpk0VLOyIy5In0dZMzvAET4b1yplxXfmp06WeWV9N8yBWNQ/il20exGacB/HLPA9ic5oHVXfyiQqZzGnPGXOboM40YWFXbK7Ep82V2P/PlSrmSqwqH/745kqs6oS9cnMldpXOldiMcyV+medK7BzzgsszV2LnPVfin8hcic0yV5rt9J19umQ/n9udxNU2XWJTpkv8Ck6X2DmsyysseHVPmRjGGL8KpkzsKp4ysSlTJn5FpkzsY6dM/LJNmdh5TJn4JzZlYmiDYaDaj9La1vbD/cs3O2Iz+vxKzY7YtNkRv2KzIzbr7IhfxtkRO4/ZEb9isyOnss5+okyf+LALmPjwT2jiwy5q4sMv0cSHVUx8zjV3uBQTGmsa/Q0VkwaGfMSVj5Ae/IKW+Kqa+LJb6ftxfIWpqnxEzegTK318Dl9s8/HezGQ+bXItm9cNS03ylKFnud9Qx+WXwBwe+EW6gv1Fuko2jJW5D6uGwm3RSt/GY7ed84exC//KH5/CWTOZwi1DSapZxRjjemoqFcYGVSOrmfilOc3kadVQgdeooeRAdS/oDmoBGljMGFW93NK5kpvkedUwAUEfscBiGphA4QkQmgGklVYdOyUSejYP4ALASgN1sLKaM8F6TWiSppVALMkV09QTmgL8WFJPFLJqzlIsIU9Ky4CTVgiKiMBjesqaAPM3rURJDDVv6MlCQkUySQ0U00YKlipkYFUIXnBzIlNICkkmNCutFywQJqtJRoKDYZsSyBZMgBfqeHlWFVozDBAz7a3g4RU823SDmyr4AaA1EFWqP4W1EA7I5oWhLWabDhlNpCGwpiEIN6QKRg4YqoiY1Lmpe7lZGLlXTVhiR+iX0jMQbEKhhJ5LakIPcx1jcSCnjOjjKmpgRxEKUAqCnG6BG0x7V3glX44A+x4300omw0ZUaTUQA7JEqdJTz0FcGDyrG+qManNrMq+mFGDks4WqvptVJiFbAD2ppTQRaErGgtCDBRBVkknU3DadSFDFALkKGcVgglFSNbXRHIoxaucqIIkIVRJAxBQYjjzmVE6CJAMGaDAlMzMBiePIUaYG4uUyk1yrCHMm1DFU8SdmCCsWpjCk8IuTHirEnGog0oRuJE3eVMrDJsHbucGaRNo2ocnAMyGZLyMqZJKgWgAfCJuM61pJMPU+CzKGK/k8pJcyklHFDVt3oCwWrOyUtGLxtGICRTVXZRMRdeXoTvJCLikFLovKUDhbw3N51dQzIqvRbcJJCs+I6gG54gDmlcSYMgqKQR7mdCZC9fyCqooVFCwQUc2khFB9Ad4TCcd5LNIT3+SPBngwxgejkeFgd6CbN/ljcN3k5ZuC8b7IUJwDRNQfjm/hkR7uD2/hG4Phbi8PbB6MBmIxFony4MBgKBiAvWC4KzTUHQz38k7AC0fiPBQcCMaBaDyCqJJUMBATxAYC0a4+uPR3BkPB+BYv6wnGw0AThItyPx/0R+PBrqGQP8oHh6KDkVgAaHQD2XAw3BMFLoGBACgBhLoig1uiwd6+uBeQ4rDpZfGovzsw4I9u9HIgFgGVoxxBfCAl0OCBYYEc6/OHQrwzGI/FowH/gIAV1ukNRwYCrCcyFO72x4ORMO8MgCr+zlDAlg1U6Qr5gwNe3u0f8PcKdRwmAsxWp2wOJhB6A+FA1B/y8thgoCsoFmDHYDTQFUdIsD1YIoTidkXCscBdQ7ABcA4LL9vUF0AWoIAf/nWhZKh+GNQVdOKRaLwkyqZgLODl/mgwJjzSE42AuMKfkR6MgCGwp3BeWMorfCT2pkcHQAlsqWB3wB8CgjEhBmywKliIrsB9CTVvidiWyW2XRiyjdu30YtTaRQBCuDcHiWvv4RKOJcgsPHXs6lY+sMVx7LVLL5YPiG44iezSmxxXoQKaopToBtNFMZnQTMx0OAKzun3mcVPJADPAElmEUFArlQygmSUxqxKKOYdh3tAAZcLQLCgmXCnArqHdL49hQx5TqAEvayC4lIuDLb+hmnk4pbRxNTPpA1hDnGUoiZZL6UZWqo7mS1jrnFbB4qNIPKlbTDdGfZwx7LguunWa6588XJo+iNl9EL+QPoiV+yB+gX0Qm94HySKfQEqmc2bM0KCWGxZ2Mb0Sd3oldnX0Ssz2wyfWKzE7YS+qV2KXsFdi5V6JX2CvxKr6ggvoldhsvRKfe6/EKnqlyvStapfgPIcicanaJSbbJX5R7RKrEhefGy91y8RyOr/olold0paJyZaJX3jLxKa2TPxCWiY2Y8vEz6dlYnH/8EB/RIjt77ug7oiVNb+Y7og53RG/mO6IVXZH/IK6IzZjd8QvpjsSwVqVKKXGh83a+PDzaHzYuRsfPofGh2HjU907fHxDYznwG7BpYD748F3M3wy24dxuDN5tODtL4v/q+fD/V/OwV/2/hef+C8O2CW1Ma9OgWN3ny6fzbbJiXsjfcv4fyd/LFA=="},"31":{"dict":{},"z":"eNpdkUtrhTAQhff+ilneLi7x1dsWRCiWgos+qO2qdKHJKIGahBgX/vsmGXv7COjHmZkj4wlr2rtWSQfs2WreoYNRKmFx0avlCANOUiVZDkJyt6v45nNvEubN3bY4nFs1aqgqYC++uTi7weFW6AEvgD1ZgVaqCQ5vTed1txrziTMqBynUNQgc/YceevPYzwgs2o6t8H3ptqP3/Ey8bgYhjzqjZbgWuJieo+3VhEmV+lNDde9PnaAS//o5uYbx7/hvxGIWVeaL754lyaKMyGm02HFNuCHsk1eEgpCTryF1IlxSMfjy8pQSvP0jrP29YPiDEPQ5Hr5a65OJtxEjCWFIhecLM9oEV3y+AF6/i1I="},"8":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"Type0"},"BaseFont":{"name":"NotoSansCJKjp-Medium"},"Encoding":{"name":"Identity-H"},"DescendantFonts":{"array":[{"ref":"25"}]},"ToUnicode":{"ref":"26"}}},"25":{"dict":{"Type":{"name":"Font"},"Subtype":{"name":"CIDFontType2"},"BaseFont":{"name":"NotoSansCJKjp-Medium"},"CIDSystemInfo":{"dict":{"Registry":{"bytes":"QWRvYmU="},"Ordering":{"bytes":"SWRlbnRpdHk="},"Supplement":0}},"FontDescriptor":{"ref":"23"},"CIDToGIDMap":{"name":"Identity"},"DW":992}},"23":{"dict":{"Type":{"name":"FontDescriptor"},"FontName":{"name":"QXAAAA+NotoSansCJKjp-Medium"},"Flags":4,"FontBBox":{"array":[-1007,-1047,2927,1807]},"ItalicAngle":0,"Ascent":1160,"Descent":-288,"CapHeight":1160,"StemV":50,"FontFile2":{"ref":"24"}}},"24":{"dict":{"Length1":2896},"z":"eNqVVW9sU1UUP7ev64ONf9WwzU++IQ4WWecGFiKDZLCtrBuUtIX90Shd+9rO9XVN+ybjA9FoTNANIYEYQmbiB/2gMWiUxAT8gEaBD6IJ/WZikMQP/ovhgxAxHfV3z33rOggRXnPf+917zv2dc88595QEES2hV0kjCkXaOt4LNJ7BygzGgVTmUHJ/i/Yk8J9EojZtxhKpR/tXAv+DNX8aC3UX6nuJXE9jvjZt2VONJNZhHsV8WWYiHqPn6QvMD0grVmwqR0upAfM05kY2Zpn012M3MD8C8WXStKL4m2owf8s1BI1+9RUvUIfowWqdh9QDc68/da1zFWC9nAdCoYBkLJe1XBlc7iPCOOATupS5Hnf9JGXkAfOVcq2+Ua/FaXWqo5X0CFFDk7dJiCbRILwCT5MmxBVP8vZpbePcZE393OQO1/Tc5NxG17Rr+t/feXJrCZWiWm/pHF63J7WeUgrjvOda6VzpPAlqLSf1ojhFq+G5x+3x6A1+PJvr8TRsbm5uXuumd+/8dvPqUHDw4vXSsaOl6xeHg8PFW3f+EKfENuvk4Gx4Or5FiC3x6fDs4Elrm+R0H9aLnk+Ys2Mt2NZ58DyxBnTrdBC73TQrVt8qggicR4+BczA4dPWmaHAf7rROjMzum4n7/fGZfbMjJ6xOGRahhh30e19c2XlTFsE9TyuiVUS0BHkqa0JG987PRI1UHi2P6kVmqn40MF3BaJUD8w7UwBuspSFbNfMs9zz1YgU0hHspcJS1JRbkw0xhF62g1xysUZCOO9hdpVNDCfrRwR5aL7Y7WKdukXTwEqoVHzl4qTgpzjq4VtRquxxcR9vdYQcvo03ueVvLXe+4v3HwCtqkjzh4FRn62w720jL9DGNvlf/eKv+9VT57q/Z6nb0fol47UObttAkxlEgOg7pwugkaJRN4PaXJxi9Hz1Ibfgf556NYRcdHcSALshbgPcA2hkER6GSpALQTUezHN0h78d6NPQkao0nsCQOngDLQzcO6D/alF1spQCH8AkDzjPN8iu0leNS6iGsr/O7Gnh3UQ/uxnofuGPZl+ZQLzGnmi7PkZcjaWebDt538kFuwM479UiuJ7xTHQTI8g+HH288xe1C/FiIyxtGIYdjwTkbQZGt52DOgkcQ7gO8EYpJhq31gjsPqQkbCdAhonPn2QB6hXXiP0D7Y7iLjzVeGRqwvn9vLmRtnz2K0AbNR7MhxnqQdubuZPUrwSVPsTw6xKSCLWyHZi7nMi4GY+vDehVkWfkveAchs7M0ycwB7TfzGHc6d8DAPaQa/MXiv+FSU5CkyzLqTfbGYVWopxglVMRc+/fy77385//5nl3+gS/ZXQ2wnwpFp5fPLXSmuqC5EIUDGpQ++brwoHA+CFU3TyX//vN7Hqy+Xvr3h1HWMWdQpTY64hSFPWWCLckXWvqolxV0Aa4brdZTlMl7dkPvYisnWBti/hHN/cpBOoC5MnNLm/OeB0jit7axJWzLjhzgD0obJmpIhyXEeq0RHeTGByjU5ZyqaykYCduMVTRX33dApcHRjXA8yk13oCVHclDAqx0gtP/7reHzmbJWvi3nuVyn3xqzlPr0iVVXTC90ixadsw151P9oeotPYHCsTKMqRlNnpZW9tp1KSQAc51mbl5ql6NLnG5P00KnnK851Ms24EURnAN8QWsouYBxYxyLzd3WnauZPIangYzxL8tfnejMIr2/FPccb4vQZ5i3BPiAAb6HNd7GuE/RgEiiK3IXSCKM+7kN8w130Ush7eK3Mu714Iq928o4+xkvVy799Dw1zLfayzgfM85kQnz7MprhNZ+wX2Mc/nsLAqIyw99/FZTT7hw8fV4A5VnZMC74lDK8maBt9AdXtjXEkb+BZIDy2OZWGhmzidR+Xf4rMs6jZcn+o+Zfm2yc6iukyea0T5pPqz/QBZ9d1VyQV4LDOb41viY98y+MozpiCXkR/433/Oqv+U/wBYPQEP"},"26":{"dict":{},"z":"eNpdUMtqwzAQvPsr9pgcgmKH5iQEJU3Ah7SlTk+lB1laG0EtibV88N9XkpP0sSCJ0ewMw7BD/VRbE4C9klMNBuiM1YSjm0ghtNgbW5QVaKPCFeVbDdIXLIqbeQw41LZzwDmwt0iOgWZYPWrX4hrYC2kkY3tYvR+aiJvJ+y8c0AbYghCgsYtGZ+mf5YDAsmxT68ibMG+i5mfjMnuEKuNyCaOcxtFLhSRtjwXfxhHAT3FEgVb/46tF1XZ/138/+bNcUCXgg5+Ou4dkedztBXwm05s8+aca7uHVRBRz565y4BTVWLzX6Z1Pqny+AVa6eEM="}}}}/*LEDGER-ART-END*/;

  return {
    PAGE_WIDTH, PAGE_HEIGHT,
    discSubmission,
    socialSummary,
    nationalList,
    nationalReturnSummary,
    nationalReturnInvoice,
    toPdf,
    toPdfBytes,
    // 検証用
    _internal: { textWidth, wrap, era, discDate, claimTotals, aggregate, isPreschoolChild, isSeniorInsuranceEligible, pdfOpsOf },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReceiptLedgerSvg;
