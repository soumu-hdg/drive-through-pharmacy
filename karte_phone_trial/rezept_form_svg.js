// ===== 点検用レセプト様式（SVG 描画） rezept_form_svg.js =====
// 基準版の点検用レセプト（A4＝595×842pt に座標指定で罫線・文字を描く方式）を、
// 座標・線幅・文字サイズ・文字間隔・折り返し・改ページの規則まで同じ値で JavaScript に写したもの。
//   ・描画は「小さな互換層」（FormCanvas）に対して行い、最後に SVG（viewBox 0 0 595 842、y は上原点）へ書き出す。
//     基準版の座標は上原点（文字は y＋文字サイズ が文字の基線）なので、そのまま使える。
//   ・文字幅は IPAゴシック（fonts/ipag.ttf）と DejaVuSans（fonts/DejaVuSans.ttf）の実寸（1000分率）で測る。
//     U+0100 未満の文字は DejaVuSans、それ以外は IPAゴシック（基準版と同じ振り分け）。
//     文字は1文字ずつ x 座標を指定して置く（ブラウザの字詰め・合字の影響を受けない）。
//   ・データは点検ビューアが UKE から読んだ receipt を receiptFromViewer() で基準版の形に写してから描く。
// 依存: master_loader.js（MasterLoader：名称・単位・コメント文言）、receipt_codes.js（DISEASE_CODES 等、無くても動く）

const RezeptFormSvg = (() => {
  'use strict';

  // ============================================================
  // 定数（基準版と同じ値）
  // ============================================================
  const PAGE_WIDTH = 595.0;
  const PAGE_HEIGHT = 842.0;
  const LEFT = 21.8;
  const RIGHT = 573.0;

  // 元様式の CSS 1px = 0.59083601775pt を単位にした寸法
  const UNIT = 0.59083601775;
  const RULE_WIDTH = UNIT;
  const RULE_GRAY = 1 / 3;
  const TEXT_GRAY = 0.2;
  const GUIDE_GRAY = 0.4;
  const SMALL = 13 * UNIT;
  const BODY = 14 * UNIT;
  const DETAIL = 15 * UNIT;
  const NAME = 18 * UNIT;
  const TITLE = 19 * UNIT;

  const DETAIL_LINES_PER_PAGE = 31;
  // 1ページの外枠（px）。ブラウザの A4 印刷ページ（594.96×841.92pt）に収まる整数 px（描画は下端 813.5pt まで）
  const SHEET_PX_W = 793;
  const SHEET_PX_H = 1122;

  const PAYER_CODES = { shaho: '1 社', kokuho: '2 国' };

  const PREFECTURE_CODES_BY_NAME = [
    ['北海道', '01'], ['青森', '02'], ['岩手', '03'], ['宮城', '04'], ['秋田', '05'], ['山形', '06'], ['福島', '07'],
    ['茨城', '08'], ['栃木', '09'], ['群馬', '10'], ['埼玉', '11'], ['千葉', '12'], ['東京', '13'], ['神奈川', '14'],
    ['新潟', '15'], ['富山', '16'], ['石川', '17'], ['福井', '18'], ['山梨', '19'], ['長野', '20'], ['岐阜', '21'],
    ['静岡', '22'], ['愛知', '23'], ['三重', '24'], ['滋賀', '25'], ['京都', '26'], ['大阪', '27'], ['兵庫', '28'],
    ['奈良', '29'], ['和歌山', '30'], ['鳥取', '31'], ['島根', '32'], ['岡山', '33'], ['広島', '34'], ['山口', '35'],
    ['徳島', '36'], ['香川', '37'], ['愛媛', '38'], ['高知', '39'], ['福岡', '40'], ['佐賀', '41'], ['長崎', '42'],
    ['熊本', '43'], ['大分', '44'], ['宮崎', '45'], ['鹿児島', '46'], ['沖縄', '47'],
  ];

  const LEFT_SECTION_LAYOUT = [
    { code: '11', title: '初　診', labels: [], height: 13.6, vertical: '' },
    { code: '12', title: '再　診', labels: ['再診', '外来管理加算', '時間外', '休　日', '深　夜'], height: 60.9, vertical: '再診' },
    { code: '13', title: '医学管理', labels: [], height: 13.6, vertical: '' },
    { code: '14', title: '在　宅', labels: ['往　診', '夜　間', '深夜・緊急', '在宅患者訪問診療', 'その他', '薬　剤'], height: 72.6, vertical: '在宅' },
    { code: '20', title: '投　薬', labels: ['21内服薬剤', '　内服調剤', '22頓服薬剤', '23外用薬剤', '　外用調剤', '25処　方', '26麻　毒', '27調　基'], height: 96.3, vertical: '投薬' },
    { code: '30', title: '注　射', labels: ['31皮下筋肉内', '32静脈内', '33その他'], height: 37.3, vertical: '注射' },
    { code: '40', title: '処　置', labels: ['処　置', '薬　剤'], height: 26.0, vertical: '処置' },
    { code: '50', title: '手術・麻酔', labels: ['手術・麻酔', '薬　剤'], height: 25.9, vertical: '手術麻酔' },
    { code: '60', title: '検査・病理', labels: ['検査・病理', '薬　剤'], height: 26.0, vertical: '検査病理' },
    { code: '70', title: '画像診断', labels: ['画像診断', '薬　剤'], height: 26.0, vertical: '画像診断' },
    { code: '80', title: 'その他', labels: ['処方せん', '', '薬　剤'], height: 37.9, vertical: 'その他' },
  ];
  const SECTION_CODES = new Set(LEFT_SECTION_LAYOUT.map((s) => s.code));

  const SCORE_DETAIL_TOP = 268.7;
  const SCORE_DETAIL_HEIGHT = 436.1;
  const PAYMENT_TOP = 704.8;
  const PAYMENT_HEIGHT = 90.9;

  // ============================================================
  // 公式 医科診療行為マスター（s_ALL20260605）の抜粋
  //   点数欄の集計先識別（入院外）が 110/120/122〜125/210/230/250/260/270 の行だけ。
  //   キー = "集計先|項目27|項目38"（基準版の点数欄集計が参照する3項目）、値 = 診療行為コード
  // ============================================================
  const ACTION_SLOT_TABLE = {
    '110|0|0': '111011810 111012610 111012810 111014510 111014610 111014710 111015370 111015470 111015570 111015670 111015770 111015870',
    '110|0|1': '111000370 111000570 111000670 111000770 111000870 111011570 111011670 111011770 111011970 111012070 111012170 111012270',
    '110|0|2': '111012470',
    '110|0|3': '111013770',
    '110|0|4': '111014870',
    '110|0|5': '111702970',
    '110|0|6': '111014970',
    '110|0|7': '111015070',
    '110|0|8': '111703070',
    '110|0|9': '111703970',
    '110|0|A': '111704070 111704170 111704270',
    '110|1|0': '111000110 111012510 111012710 111014210 111014310 111014410',
    '120|0|0': '112008350 112008850 112011710 112015810 112015950 112016210 112016410 112016550 112016850 112016950 112017010 112017150 112017450 112017610 112021970 112023450 112023550 112023750 112023850 112024950 112025150 112025210 112025310 112025450 112025650 112025850 112025910 112026010 112026110 112026270 112026370 112026470',
    '120|0|1': '112000970 112006270',
    '120|0|2': '112016070 112708370 112708470 112708570 112709670',
    '120|0|3': '112015770 112709370',
    '120|0|4': '112017270 112017570 112021770 112021870',
    '120|0|5': '112709470',
    '120|0|6': '112024370',
    '120|0|7': '112708670',
    '120|0|8': '112024470',
    '120|0|9': '112024570',
    '120|0|A': '112708770',
    '120|0|B': '112709570',
    '120|0|C': '112709070',
    '120|2|0': '112007410 112007950 112011310 112016310 112016610 112016750 112017310 112023350 112023650 112024210 112024710 112025010 112025510 112025710',
    '122|0|0': '112011010',
    '123|0|0': '112001110 112001410 112006470 112006770 112014170 112014470 112014770 112015070 112015170 112015470 112015570',
    '124|0|0': '112001210 112006570 112014270 112014570 112014870 112015270',
    '125|0|0': '112001310 112006670 112014370 112014670 112014970 112015370',
    '210|0|0': '120000710',
    '230|0|0': '120001010',
    '250|0|0': '120001210 120002610 120003370 120003610 120004070 120004170 120004370 120004410 120004470 120005610',
    '250|0|1': '120003870',
    '250|0|2': '120002170',
    '260|0|0': '120000110 120001310 120002030',
    '270|0|0': '120001810',
  };
  let _actionRows = null;
  /** 診療行為コード → {slot, c27, c38}（抜粋に無いコードは null） */
  function officialActionRow(code) {
    if (!_actionRows) {
      _actionRows = {};
      Object.keys(ACTION_SLOT_TABLE).forEach((key) => {
        const [slot, c27, c38] = key.split('|');
        ACTION_SLOT_TABLE[key].split(' ').forEach((c) => { _actionRows[c] = { slot, c27, c38 }; });
      });
    }
    return _actionRows[String(code || '')] || null;
  }

  // ============================================================
  // 文字幅（reportlab の stringWidth と同じ値）
  // ============================================================
  // DejaVuSans の送り幅（フォント単位 2048/em）。U+0020〜U+007E と U+00A0〜U+00FF。それ以外の U+0100 未満は既定幅 1229。
  const LATIN_ASCII = [651,821,942,1716,1303,1946,1597,563,799,799,1024,1716,651,739,651,690,1303,1303,1303,1303,1303,1303,1303,1303,1303,1303,690,690,1716,1716,1716,1087,2048,1401,1405,1430,1577,1294,1178,1587,1540,604,604,1343,1141,1767,1532,1612,1235,1612,1423,1300,1251,1499,1401,2025,1403,1251,1403,799,690,799,1716,1024,1024,1255,1300,1126,1300,1260,721,1300,1298,569,569,1186,569,1995,1298,1253,1300,1300,842,1067,803,1298,1212,1675,1212,1212,1075,1303,690,1303,1716];
  const LATIN_HIGH = [651,821,1303,1303,1303,1303,690,1024,1024,2048,965,1253,1716,739,2048,1024,1024,1716,821,821,1024,1303,1303,651,1024,821,965,1253,1985,1985,1985,1087,1401,1401,1401,1401,1401,1401,1995,1430,1294,1294,1294,1294,604,604,604,604,1587,1532,1612,1612,1612,1612,1612,1716,1612,1499,1499,1499,1499,1251,1239,1290,1255,1255,1255,1255,1255,1255,2011,1126,1260,1260,1260,1260,569,569,569,569,1253,1298,1253,1253,1253,1253,1253,1716,1253,1298,1298,1298,1298,1212,1300,1212];
  const LATIN_DEFAULT = 1229;
  // IPAゴシックは等幅: 全角 1000、半角 500。U+0100 以上で半角幅の文字の範囲（ipag.ttf の hmtx から抽出）
  const GOTHIC_HALF_RANGES = [[256,265],[268,271],[273,275],[280,285],[292,293],[295,295],[298,299],[308,309],[313,314],[317,318],[321,324],[327,328],[331,333],[336,341],[344,357],[362,369],[377,382],[403,403],[450,450],[504,505],[509,509],[592,602],[604,604],[606,609],[612,616],[620,627],[629,629],[633,635],[637,638],[641,644],[648,654],[656,658],[660,661],[664,664],[669,669],[673,674],[711,712],[716,716],[720,721],[728,729],[731,734],[741,745],[768,772],[774,774],[776,776],[779,780],[783,783],[792,794],[796,800],[804,805],[809,810],[812,812],[815,816],[820,820],[825,829],[865,865],[962,962],[7742,7743],[8048,8051],[8211,8211],[8226,8226],[8252,8252],[8255,8255],[8258,8258],[8263,8265],[8364,8364],[8463,8463],[8467,8467],[8487,8487],[8501,8501],[8531,8533],[8596,8596],[8598,8601],[8644,8644],[8678,8681],[8709,8709],[8713,8713],[8722,8723],[8742,8742],[8771,8771],[8773,8773],[8776,8776],[8802,8802],[8822,8823],[8836,8837],[8842,8843],[8853,8855],[8922,8923],[8965,8966],[9649,9649],[9654,9655],[9664,9665],[9673,9673],[9680,9683],[9702,9702],[9824,9831],[9833,9833],[9835,9836],[9838,9838],[10548,10549],[10746,10747],[65377,65439]];

  const FONT_GOTHIC = 'RzFormGothic';
  const TEXT_EM = 100;   // SVG 上で文字を組む大きさ（変換行列で実寸に縮める）
  // 文字の原点をごくわずか（0.002pt）右下へ寄せる。ブラウザの PDF 化で生じる 0.001pt 未満の誤差で、
  // 原点がちょうど画素の境目にある文字（x=327 など）が1画素手前に落ちるのを防ぐ（見た目の差は無い）
  const GLYPH_NUDGE = 0.002;
  const FONT_LATIN = 'RzFormLatin';

  // ブラウザの PDF 化は文字の大きさを 0.01px 単位に切り捨てるので、いちばん近い 0.01px に当たるよう
  // わずかに大きめに指定する（誤差 0.008px → 0.005px 以内）
  function pdfTextScale(size) {
    const px = size * 4 / 3;
    const target = Math.round(px * 100) / 100 + 0.0002;
    return (target * 3 / 4) / TEXT_EM;
  }

  function isLatin(ch) { return ch.codePointAt(0) < 256; }

  /** 1文字の送り幅（1000分率） */
  function charWidth1000(ch) {
    const cp = ch.codePointAt(0);
    if (cp < 256) {
      let u;
      if (cp >= 32 && cp <= 126) u = LATIN_ASCII[cp - 32];
      else if (cp >= 160) u = LATIN_HIGH[cp - 160];
      else u = LATIN_DEFAULT;
      return u * 1000 / 2048;
    }
    for (const [a, b] of GOTHIC_HALF_RANGES) {
      if (cp < a) break;
      if (cp <= b) return 500;
    }
    return 1000;
  }

  /** 文字列を「フォントが同じ文字の並び」に分ける（基準版 receipt_font_runs と同じ） */
  function receiptFontRuns(value) {
    const runs = [];
    for (const ch of Array.from(value)) {
      const font = isLatin(ch) ? FONT_LATIN : FONT_GOTHIC;
      if (runs.length && runs[runs.length - 1][0] === font) runs[runs.length - 1][1] += ch;
      else runs.push([font, ch]);
    }
    return runs;
  }

  function receiptTextWidth(value, size) {
    let total = 0;
    for (const [, run] of receiptFontRuns(String(value))) {
      let w = 0;
      for (const ch of Array.from(run)) w += charWidth1000(ch);
      total += w * size / 1000;
    }
    return total;
  }

  // ============================================================
  // 描画の互換層（reportlab の canvas 呼び出しの置き換え）
  //   すべて上原点の座標で受け取る。塗りつぶし矩形と文字だけを使う（基準版の様式描画と同じ）。
  // ============================================================
  function num(v) { return String(Math.round(v * 10000) / 10000); }
  function grayHex(g) { const v = Math.round(g * 255).toString(16).padStart(2, '0'); return '#' + v + v + v; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  class FormCanvas {
    constructor() {
      this.parts = [];
      this.ruleGray = RULE_GRAY;
      this.warnings = [];
    }
    fillRectTop(x, yTop, w, h, gray) {
      this.parts.push('<rect x="' + num(x) + '" y="' + num(yTop) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + grayHex(gray) + '"/>');
    }
    /** 基線 baseline（上原点）から文字列を左詰めで置く（textOut の連続と同じ送り） */
    textOut(x, baseline, value, size) {
      let cx = x;
      for (const [font, run] of receiptFontRuns(value)) {
        const xs = [], chars = [];
        for (const ch of Array.from(run)) {
          // 空白は描かずに送りだけ進める（SVG の空白詰めの影響を避ける）
          if (!/\s/.test(ch)) { xs.push(cx); chars.push(ch); }
          cx += charWidth1000(ch) * size / 1000;
        }
        // 1文字ずつ別の text にし、100 の大きさで組んで変換行列で実寸へ縮める
        // （1つの text に並べると PDF では文字送りが丸められ、実寸の文字サイズで組むとサイズも丸められて位置がずれる）
        const k = pdfTextScale(size);
        chars.forEach((ch, i) => {
          this.parts.push('<text font-family="' + font + '" font-size="' + TEXT_EM + '" transform="matrix(' + k + ' 0 0 ' + k + ' ' + (xs[i] + GLYPH_NUDGE) + ' ' + (baseline + GLYPH_NUDGE) +
            ')" fill="' + grayHex(TEXT_GRAY) + '">' + xmlEsc(ch) + '</text>');
        });
      }
    }
    toSVG() {
      // 外側は画面・印刷での大きさ（px）だけを決め、1pt = 4/3px の拡大で内側の 595×842 の座標系を置く。
      // 外側に viewBox を付けて pt で大きさを指定すると、ブラウザが外枠の寸法を 1/64px 単位に丸めるため
      // 全体が 0.001% ほど縮み、PDF 化したときに画素の境目の線・文字が1画素ずれる。
      return '<svg xmlns="http://www.w3.org/2000/svg" class="rzsvg" width="' + SHEET_PX_W + 'px" height="' + SHEET_PX_H + 'px">' +
        '<g transform="scale(' + (4 / 3) + ')"><svg viewBox="0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT + '" width="' + PAGE_WIDTH + '" height="' + PAGE_HEIGHT + '" overflow="visible">' +
        this.parts.join('') + '</svg></g></svg>';
    }
  }

  // ---- 基準版の描画補助（draw_text / rect / line / dashed_line / draw_digit_guides / draw_boxed_digits / draw_vertical_label） ----
  function drawText(pdf, x, y, textValue, size, align) {
    size = size === undefined ? 8 : size;
    const value = textValue !== null && textValue !== undefined ? String(textValue).replace(/\r/g, ' ').replace(/\n/g, ' ') : '';
    if (!value) return;
    const baseline = y + size;
    const width = receiptTextWidth(value, size);
    if (align === 'right') x -= width;
    else if (align === 'center') x -= width / 2;
    pdf.textOut(x, baseline, value, size);
  }

  function rect(pdf, x, y, width, height, ruleWidth) {
    const rw = ruleWidth === undefined ? RULE_WIDTH : ruleWidth;
    // 内側に寄せた塗りつぶしの枠（二重線にならない）
    pdf.fillRectTop(x, y, width, rw, RULE_GRAY);
    pdf.fillRectTop(x, y + height - rw, width, rw, RULE_GRAY);
    pdf.fillRectTop(x, y, rw, height, RULE_GRAY);
    pdf.fillRectTop(x + width - rw, y, rw, height, RULE_GRAY);
  }

  function line(pdf, x1, y1, x2, y2) {
    if (x1 === x2 || y1 === y2) {
      pdf.fillRectTop(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) || RULE_WIDTH, Math.abs(y2 - y1) || RULE_WIDTH, pdf.ruleGray);
      return;
    }
    // 斜線は様式に無い（基準版と同じく軸に平行な線だけを使う）
    pdf.parts.push('<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" stroke="' + grayHex(pdf.ruleGray) + '" stroke-width="' + num(RULE_WIDTH) + '"/>');
  }

  function dashedLine(pdf, x1, y, x2, dash, gap) {
    dash = dash === undefined ? 1.4 : dash;
    gap = gap === undefined ? 3.2 : gap;
    while (x1 < x2) {
      line(pdf, x1, y, Math.min(x1 + dash, x2), y);
      x1 += dash + gap;
    }
  }

  function drawVerticalLabel(pdf, x, y, textValue, size, step) {
    Array.from(textValue).forEach((ch, index) => drawText(pdf, x, y + index * step, ch, size));
  }

  function drawBoxedDigits(pdf, value, x, y, width, slots, size) {
    size = size === undefined ? 10 : size;
    const digits = digitsOnly(value);
    if (!digits || slots <= 0) return;
    const slotWidth = width / slots;
    const visible = digits.slice(-slots);
    const startSlot = Math.max(0, slots - visible.length);
    Array.from(visible).forEach((digit, index) => {
      drawText(pdf, x + (startSlot + index + 0.5) * slotWidth, y, digit, size, 'center');
    });
  }

  function drawDigitGuides(pdf, x, y, width, slots, height) {
    height = height === undefined ? 4.0 : height;
    if (slots <= 1) return;
    const slotWidth = width / slots;
    pdf.ruleGray = GUIDE_GRAY;
    for (let index = 1; index < slots; index++) {
      const gx = x + slotWidth * index;
      line(pdf, gx, y, gx, y + height);
    }
    pdf.ruleGray = RULE_GRAY;
  }

  function trimText(value, maxWidth, size) {
    let t = safeText(value);
    if (!t) return '';
    if (receiptTextWidth(t, size) <= maxWidth) return t;
    const ellipsis = '...';
    let chars = Array.from(t);
    while (chars.length && receiptTextWidth(chars.join('') + ellipsis, size) > maxWidth) chars.pop();
    return chars.length ? chars.join('') + ellipsis : '';
  }

  // ============================================================
  // 文字・数値の整形（基準版と同じ規則）
  // ============================================================
  function safeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function normalizeText(value) { return safeText(value).replace(/\s+/g, ''); }
  function digitsOnly(value) { return safeText(value).replace(/\D+/g, ''); }
  function spacedDigits(value) { return Array.from(digitsOnly(value)).join(' '); }
  function asList(v) { if (v === null || v === undefined) return []; return Array.isArray(v) ? v : [v]; }

  function intValue(value, def) {
    if (def === undefined) def = 0;
    if (value === null || value === undefined || value === '') return def;
    const n = Number(value);
    if (!isFinite(n)) return def;
    return Math.trunc(n);
  }
  /** 10進数の文字列（Decimal 相当）。解釈できなければ null */
  function decimalValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    return s;
  }
  function decimalIsZero(d) { return Number(d) === 0; }
  function decimalIsOne(d) { return Number(d) === 1; }
  function formatDecimal(d) {
    const n = Number(d);
    if (Number.isInteger(n)) return String(n);
    let s = String(d).trim();
    if (/e/i.test(s)) s = n.toFixed(10);
    s = s.replace(/^\+/, '');
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    s = s.replace(/^(-?)0+(\d)/, '$1$2');
    return s;
  }
  function formatNumber(value) {
    const n = intValue(value);
    return n ? n.toLocaleString('en-US') : '';
  }
  function formatCopaymentAmount(value) {
    if (value === null || value === undefined || !/^[0-9]+$/.test(String(value))) return '';
    return parseInt(String(value), 10).toLocaleString('en-US');
  }

  // ---- 日付・和暦 ----
  /** → {y, m, d} または null（YYYYMMDD / YYYYMM / YYYY-MM-DD / YYYY-MM） */
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
    if (typeof value === 'object' && value.y) return value;
    let t = safeText(value).replace(/\//g, '-');
    if (/^\d{6}$/.test(t)) t = t.slice(0, 4) + '-' + t.slice(4, 6) + '-01';
    if (/^\d{8}$/.test(t)) t = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
    if (/^\d{4}-\d{1,2}$/.test(t)) t = t + '-01';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.slice(0, 10));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  function dateKey(p) { return p.y * 10000 + p.m * 100 + p.d; }
  const ERAS = [
    ['令和', '令', 20190501, 2019], ['平成', '平', 19890108, 1989], ['昭和', '昭', 19261225, 1926],
    ['大正', '大', 19120730, 1912], ['明治', '明', 18680125, 1868],
  ];
  function warekiParts(p, short) {
    for (const [longName, shortName, start, startYear] of ERAS) {
      if (dateKey(p) >= start) return [short ? shortName : longName, p.y - startYear + 1, p.m, p.d];
    }
    return ['西暦', p.y, p.m, p.d];
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatWarekiDate(value) {
    const p = parseDate(value);
    if (!p) return '';
    const [era, ey, m, d] = warekiParts(p, true);
    return era + ' ' + pad2(ey) + '年' + m + '月' + d + '日';
  }
  function warekiEraCode(shortName) { return { '明': '1', '大': '2', '昭': '3', '平': '4', '令': '5' }[shortName] || ''; }
  function formatReceiptBirthLabel(value) {
    const p = parseDate(value);
    if (!p) return '';
    const [era, ey, m, d] = warekiParts(p, true);
    return warekiEraCode(era) + ' ' + era + ' ' + String(ey).padStart(2, ' ') + '. ' + String(m).padStart(2, ' ') + '. ' + String(d).padStart(2, ' ') + ' 生';
  }
  function genderCodeLabel(value) {
    const raw = safeText(value).toLowerCase();
    if (['1', 'm', 'male', 'man', '男', '男性'].includes(raw)) return '1 男';
    if (['2', 'f', 'female', 'woman', '女', '女性'].includes(raw)) return '2 女';
    return safeText(value);
  }
  function diagnosisOutcomeCode(value) {
    const v = String(value === null || value === undefined ? '' : value).trim();
    const map = { '': '1', continuing: '1', '継続': '1', cured: '2', '治癒': '2', discontinued: '4', '中止': '4', died: '3', '死亡': '3',
      '1': '1', '2': '2', '3': '3', '4': '4' };
    return map[v] || '1';
  }
  const OUTCOME_LABELS = { '2': '治癒', '3': '死亡', '4': '中止' };

  function isElderlyInsurerNumber(value) { return digitsOnly(value).startsWith('39'); }

  function receiptPayerCodeLabel(payerGroup, receipt) {
    if (receipt && receipt.public_only) return '2 公費';
    if (receipt && isElderlyInsurerNumber(receipt.insurer_number)) return '3 後期';
    return PAYER_CODES[safeText(payerGroup)] || '';
  }
  function receiptPersonTypeLabel(receipt) {
    if (!receipt || receipt.public_only) return '2 本外';
    const code = digitsOnly(receipt.insured_person_type_code).slice(0, 1);
    return { '2': '2 本外', '4': '4 六外', '6': '6 家外', '8': '8 高外一', '0': '0 高外7' }[code] || '2 本外';
  }
  function medicalInstitutionCode7(facility) {
    const code = digitsOnly(facility.medical_institution_code);
    return code.length >= 7 ? code.slice(-7) : code;
  }
  function facilityPrefectureCode(facility) {
    const code = digitsOnly(facility.medical_institution_code);
    if (code.length >= 9) return code.slice(0, 2);
    const address = safeText(facility.address);
    for (const [name, pref] of PREFECTURE_CODES_BY_NAME) if (address.includes(name)) return pref;
    return '';
  }
  function diagnosisName(d) { return safeText(d.full_name || d.diagnosis_name || d.name); }

  // ============================================================
  // ページの描画（draw_receipt_page と各欄）
  // ============================================================
  function drawReceiptPage(pdf, receipt, facility, claimMonth, payerGroup, receiptIndex, pageIndex, pageCount, detailLines) {
    const receiptNo = safeText(receipt.patient_no || receiptIndex);
    drawText(pdf, LEFT + 1, 22, '○' + receiptNo, TITLE);
    drawText(pdf, 98.56, 21.75, '点検用レセプトです。', 16 * UNIT);
    drawTitleLine(pdf, facility, claimMonth, payerGroup, receipt);
    drawReceiptTypeBox(pdf, payerGroup, receipt);
    drawPublicExpenseBoxes(pdf, receipt);
    drawInsuranceBox(pdf, receipt);
    drawPatientBox(pdf, receipt);
    drawFacilityBox(pdf, facility, receipt, pageIndex, pageCount);
    drawDiagnosisBox(pdf, receipt);
    drawScoreSummaryBox(pdf, receipt);
    drawDetailBox(pdf, detailLines);
    drawPaymentBox(pdf, receipt);
  }

  function drawEmptyReceiptPage(pdf, facility, claimMonth, payerGroup) {
    drawText(pdf, 98.56, 21.75, '点検用レセプトです。', 16 * UNIT);
    drawTitleLine(pdf, facility, claimMonth, payerGroup);
    drawText(pdf, 56, 120, '対象データはありません。', 10);
  }

  function drawTitleLine(pdf, facility, claimMonth, payerGroup, receipt) {
    let monthDate = parseDate(claimMonth);
    if (!monthDate) { const t = new Date(); monthDate = { y: t.getFullYear(), m: t.getMonth() + 1, d: 1 }; }
    const [eraName, eraYear] = warekiParts(monthDate, false);
    const pref = facilityPrefectureCode(facility);
    const institutionCode = medicalInstitutionCode7(facility);
    const payerLabel = receiptPayerCodeLabel(payerGroup, receipt);
    const shift = Math.max(0.0, receiptTextWidth(payerLabel, TITLE) - receiptTextWidth('1 社', TITLE));
    drawText(pdf, 21.75, 38.885, '診療報酬明細書', TITLE);
    drawText(pdf, 100.33, 43.02, '（医科入院外）', 12 * UNIT);
    drawText(pdf, 153.5, 38.885, payerLabel, TITLE);
    drawText(pdf, 180.68 + shift, 43.02, eraName, 12 * UNIT);
    drawText(pdf, 198.4 + shift, 38.885, pad2(eraYear), TITLE);
    drawText(pdf, 216.14 + shift, 43.02, '年', 12 * UNIT);
    drawText(pdf, 226.77 + shift, 38.885, String(monthDate.m), TITLE);
    drawText(pdf, 237.41 + shift, 43.02, '月分', 12 * UNIT);
    drawText(pdf, 256.9 + shift, 43.02, '県番', 12 * UNIT);
    drawText(pdf, 274.63 + shift, 38.885, pref, TITLE);
    drawText(pdf, 294.13 + shift, 43.02, '医コ', 12 * UNIT);
    drawText(pdf, 308.31 + shift, 38.885, institutionCode, TITLE);
  }

  function drawReceiptTypeBox(pdf, payerGroup, receipt) {
    let x = 400.5;
    const y = 45.4;
    const widths = [42.5, 42.6, 42.5, 43.7];
    const pe = (receipt && receipt.public_expenses) || [];
    const labels = [
      '1 医科',
      receiptPayerCodeLabel(payerGroup, receipt),
      (receipt && receipt.public_only) ? pe.length + ' 公' : (receipt && pe.length) ? (1 + pe.length) + ' 併' : '1 単独',
      receiptPersonTypeLabel(receipt),
    ];
    widths.forEach((width, index) => {
      rect(pdf, x, y, width, 17.1);
      drawText(pdf, x + width / 2, y + 3.5, labels[index], SMALL, 'center');
      x += width;
    });
  }

  function drawPublicExpenseBoxes(pdf, receipt) {
    const x = LEFT, y = 62.5, w = 266.4, h = 76.8;
    rect(pdf, x, y, w, h);
    for (const yy of [y + 25.4, y + 50.8]) line(pdf, x, yy, x + w, yy);
    for (const xx of [51.3, 169.5, 199.0]) line(pdf, xx, y, xx, y + h);
    const expenses = receipt.public_expenses || [];
    const values = expenses.slice(0, 2).map((e) => [digitsOnly(e.payer_number), digitsOnly(e.recipient_number)]);
    while (values.length < 2) values.push(['', '']);
    drawText(pdf, x + 15, y + 7, '-', SMALL, 'center');
    drawText(pdf, 169.5 + 15, y + 7, '-', SMALL, 'center');
    const marks = ['①', '②'];
    values.forEach(([payer, recipient], rowIndex) => {
      const rowY = y + 25.4 + rowIndex * 25.4;
      const mark = marks[rowIndex];
      drawText(pdf, x + 3, rowY + 7, '公負' + mark, 12 * UNIT);
      drawDigitGuides(pdf, 51.3, rowY + 20.7, 118.2, 4);
      drawText(pdf, 58, rowY + 9, spacedDigits(payer), DETAIL);
      drawText(pdf, 171, rowY + 7, '公受' + mark, 12 * UNIT);
      drawDigitGuides(pdf, 199.0, rowY + 20.7, 89.2, 3);
      drawText(pdf, 207, rowY + 9, spacedDigits(recipient), DETAIL);
    });
  }

  function drawInsuranceBox(pdf, receipt) {
    const x = 305.9, y = 62.5, w = 266.5, h = 66.2;
    rect(pdf, x, y, w, h);
    line(pdf, x, 89.0, x + w, 89.0);
    line(pdf, 341.4, y, 341.4, 89.0);
    line(pdf, 483.2, y, 483.2, 89.0);
    rect(pdf, 376.2516, 89.1053, 18.9068, 39.586, 2 * RULE_WIDTH);
    line(pdf, 535.0, 89.0, 535.0, y + h);
    drawText(pdf, x + 17.5, y + 8, '保　険', SMALL, 'center');
    drawDigitGuides(pdf, 341.4, y + 22.6, 141.8, 8);
    drawBoxedDigits(pdf, digitsOnly(receipt.insurer_number), 341.4, y + 3, 141.8, 8, 26 * UNIT);
    drawText(pdf, 341, y + 30, '記号・番号', SMALL, 'center');
    const symbol = safeText(receipt.symbol);
    const number = safeText(receipt.insurance_number);
    const branch = digitsOnly(receipt.branch_number);
    drawText(pdf, 405, y + 35, trimText(symbol, 125, DETAIL), DETAIL);
    drawText(pdf, 405, y + 51, trimText(spacedDigits(number), 125, DETAIL), DETAIL);
    if (!isElderlyInsurerNumber(receipt.insurer_number)) {
      drawText(pdf, x + w - 3, y + 35, '（枝番）', SMALL, 'right');
      drawText(pdf, x + w - 10, y + 51, branch, NAME, 'right');
    }
  }

  function drawPatientBox(pdf, receipt) {
    const x = LEFT, y = 148.2, w = 266.4, h = 57.3;
    rect(pdf, x, y, w, h);
    line(pdf, x, 192.5, 235.0, 192.5);
    line(pdf, 34.7, y, 34.7, 192.5);
    line(pdf, 235.0, y, 235.0, y + h);
    line(pdf, 84.4, 192.5, 84.4, y + h);
    drawText(pdf, x + 3, y + 6.5, '氏', SMALL);
    drawText(pdf, x + 3, y + 27.8, '名', SMALL);
    drawText(pdf, 45, y + 7.1, trimText(safeText(receipt.patient_name), 183, NAME), NAME);
    drawText(pdf, 53, y + 26, genderCodeLabel(receipt.gender), NAME);
    drawText(pdf, 107, y + 26, formatReceiptBirthLabel(receipt.birth_date), NAME);
    line(pdf, 235.0, 160.596, x + w, 160.596);
    drawText(pdf, 261.6, y + 1.2, '特記事項', SMALL, 'center');
    drawText(pdf, x + 7, y + 46.2, '職務上の事由', SMALL);
  }

  function drawFacilityBox(pdf, facility, receipt, pageIndex, pageCount) {
    const x = 305.9, y = 148.2, w = 266.5;
    ['保険医', '療機関', 'の所在', '地及び', '名　称'].forEach((label, index) => drawText(pdf, x + 1, y + 6.5 + index * DETAIL, label, SMALL));
    drawText(pdf, x + 29, y + 2.35, trimText(safeText(facility.address), 222, BODY), BODY);
    drawText(pdf, x + 29, y + 16.53, trimText(safeText(facility.name), 222, BODY), BODY);
    const phone = safeText(facility.phone);
    if (phone) drawText(pdf, x + 29, y + 30.7, phone, BODY);
    // 診療科: 基準版は claim → 施設 → 「診療科」の順。統合版は UKE と施設設定に無ければ空欄
    const department = safeText(receipt.department || receipt.department_name || facility.department || facility.department_name || '');
    drawText(pdf, x + 29, y + 44.9, trimText(department, 155, BODY), BODY);
    drawText(pdf, x + w - 77, y + 31.3, pageIndex + ' / ' + pageCount, SMALL);
    drawText(pdf, x + w - 45, y + 31.3, '[', SMALL);
    drawText(pdf, x + w - 3, y + 31.3, pageIndex + ']', SMALL, 'right');
    drawText(pdf, x + 195, y + 45.5, '（', SMALL);
    drawText(pdf, RIGHT - 3, y + 45.5, '床）', SMALL, 'right');
  }

  function drawDiagnosisBox(pdf, receipt) {
    const x = LEFT, y = 207.3, w = RIGHT - LEFT, h = 61.4;
    rect(pdf, x, y, w, h);
    for (const xx of [37.7, 321.9, 332.5, 414.7, 425.3, 524.0, 534.6, 545.2]) line(pdf, xx, y, xx, y + h);
    for (const yy of [225.6, 239.2]) line(pdf, 534.6, yy, RIGHT, yy);
    dashedLine(pdf, 39.5, y + 19.5, 320.5, 3.8, 2.2);
    drawVerticalLabel(pdf, x + 4, y + 1.3, '傷病名', BODY, 23.6);
    drawVerticalLabel(pdf, 323.7, y + 1.3, '診療開始日', BODY, 11.8);
    drawText(pdf, 416.4, y + 7.5, '転', BODY);
    drawText(pdf, 416.4, y + 43.0, '帰', BODY);
    drawVerticalLabel(pdf, 525.7, y + 1.3, '診療実日数', BODY, 11.8);
    drawText(pdf, 540.5, y + 3, '保', BODY, 'center');
    drawText(pdf, 540.5, y + 21.0, '①', BODY, 'center');
    drawText(pdf, 540.5, y + 43.0, '②', BODY, 'center');
    if (!receipt.public_only) drawText(pdf, RIGHT - 8, y + 3, String(Math.max(1, intValue(receipt.visit_days))), BODY, 'right');
    (receipt.public_expenses || []).slice(0, 2).forEach((e, index) => {
      if (e.visit_days !== null && e.visit_days !== undefined) drawText(pdf, RIGHT - 8, y + (index === 0 ? 21 : 43), String(e.visit_days), BODY, 'right');
    });
    for (const dayY of [y + 8, y + 24, y + 46]) drawText(pdf, RIGHT - 2, dayY, '日', 8 * UNIT, 'right');
    const diagnoses = receipt.diagnoses || [];
    for (let index = 0; index < 3; index++) {
      const rowY = y + 1.3 + index * 23.6;
      const label = '(' + (index + 1) + ')';
      const d = index < diagnoses.length ? diagnoses[index] : {};
      if (d && Object.keys(d).length) {
        drawText(pdf, 39.5, rowY, label, BODY);
        drawText(pdf, 56, rowY, trimText(diagnosisName(d), 262, BODY), BODY);
      }
      const startDate = formatWarekiDate(d.start_date || d.diagnosis_date);
      if (startDate) drawText(pdf, 334.3, y + 1.3 + index * 23.6, label + ' ' + startDate, BODY);
      const outcome = OUTCOME_LABELS[diagnosisOutcomeCode(d.outcome)] || '';
      if (outcome) drawText(pdf, 428, rowY, label + ' ' + outcome, BODY);
    }
  }

  // ---- 点数欄（左） ----
  function drawScoreSummaryBox(pdf, receipt) {
    const x = LEFT, y = SCORE_DETAIL_TOP, w = 275.3, h = SCORE_DETAIL_HEIGHT;
    rect(pdf, x, y, w, h);
    line(pdf, 37.7, y, 37.7, y + h);
    line(pdf, 242.1, y, 242.1, y + h);
    const entriesByService = buildScoreSummaryEntries(receipt);
    let currentY = y;
    for (const section of LEFT_SECTION_LAYOUT) {
      const serviceCode = section.code, title = section.title, labels = section.labels, height = section.height;
      const nextY = currentY + height;
      line(pdf, x, nextY, x + w, nextY);
      drawText(pdf, x + 2.9, currentY + 1.2, serviceCode, BODY);
      if (section.vertical) drawScoreVerticalLabel(pdf, 25.9, currentY, height, section.vertical);
      const entries = entriesByService[serviceCode] || [];
      const used = new Set();
      if (!labels.length) {
        drawText(pdf, 49.96, currentY + 1.2, title, BODY);
        drawScorePlaceholder(pdf, currentY + 1.2, title);
        if (entries.length) drawScoreEntryValues(pdf, currentY + 1.2, sumScoreEntries(entries), title);
        currentY = nextY;
        continue;
      }
      let labelY = currentY + 1.2;
      const step = scoreLabelStep(height, labels.length);
      for (const label of labels) {
        if (labelY > nextY - 3) break;
        drawText(pdf, (serviceCode === '20' || serviceCode === '30') ? 39.5 : 49.96, labelY, label, BODY);
        drawScorePlaceholder(pdf, labelY, label);
        let entryIndex = findScoreEntryForLabel(label, entries, used);
        const matching = [];
        // 1つの欄に基本点と加算が複数入ることがある
        while (entryIndex !== null) {
          used.add(entryIndex);
          matching.push(entries[entryIndex]);
          entryIndex = findScoreEntryForLabel(label, entries, used);
        }
        if (matching.length) drawScoreEntryValues(pdf, labelY, sumScoreEntries(matching), label);
        labelY += step;
      }
      const undisplayed = entries.filter((e, i) => !used.has(i) && e.score);
      if (undisplayed.length) {
        // 基準版は PDF 作成を止める。統合版は様式は出し、印刷後に知らせる
        pdf.warnings.push('点数欄の集計先が未対応です: ' + serviceCode + ' / ' + undisplayed.map((e) => String(e.name)).join(', '));
      }
      currentY = nextY;
    }
  }

  function scoreLabelStep(sectionHeight, labelCount) {
    if (labelCount <= 1) return 8.0;
    return Math.min(20 * UNIT, Math.max(8.0, (sectionHeight - 10) / (labelCount - 1)));
  }

  function drawScoreVerticalLabel(pdf, x, y, height, label) {
    const chars = Array.from(label);
    if (height <= 26.0) {
      // 狭い区分は番号の下に小さく2段で置く
      const columns = chars.length === 2 ? 1 : 2;
      for (let index = 0, offset = 0; offset < chars.length; index++, offset += columns) {
        drawText(pdf, (LEFT + 37.7) / 2, y + 11.3 + index * 6.1, chars.slice(offset, offset + columns).join(''), 10 * UNIT, 'center');
      }
      return;
    }
    const size = chars.length <= 2 ? BODY : 10 * UNIT;
    const step = chars.length <= 3 ? 9 : 6;
    const textHeight = (chars.length - 1) * step;
    const top = y + Math.max(5, (height - textHeight) / 2);
    drawVerticalLabel(pdf, x, top, label, size, step);
  }

  function drawScorePlaceholder(pdf, y, label) {
    const n = normalizeText(label);
    if (n.startsWith('21') || n.startsWith('22') || n.startsWith('23')) { drawText(pdf, 196.9, y, '単', BODY, 'center'); return; }
    if (n === '26麻毒') { drawText(pdf, 196.9, y, '回', BODY, 'center'); return; }
    if (['初診', '再診', '外来管理加算', '時間外', '休日', '深夜', '25処方', '処方せん'].includes(n)) {
      if (n !== '初診' && n !== '処方せん') drawText(pdf, 161.5, y, '×', BODY, 'center');
      drawText(pdf, 196.9, y, '回', BODY, 'center');
      return;
    }
    if (['往診', '夜間', '深夜・緊急', '在宅患者訪問診療', '処置', '手術・麻酔', '検査・病理', '画像診断'].includes(n)) {
      drawText(pdf, 196.9, y, '回', BODY, 'center');
    }
  }

  function drawScoreEntryValues(pdf, y, entry, label) {
    let unitScore = intValue(entry.unit_score);
    const quantity = intValue(entry.quantity, 1);
    const totalScore = intValue(entry.score, unitScore * quantity);
    const service = safeText(entry.service);
    const n = normalizeText(label || '');
    if (['処置', '手術・麻酔', '検査・病理', '画像診断'].includes(n)) unitScore = 0;
    const existingTimes = ['再診', '外来管理加算', '時間外', '休日', '深夜', '25処方'].includes(n);
    const existingCount = ['初診', '再診', '外来管理加算', '時間外', '休日', '深夜', '25処方', '26麻毒',
      '処方せん', '往診', '夜間', '深夜・緊急', '在宅患者訪問診療', '処置', '手術・麻酔', '検査・病理', '画像診断'].includes(n) ||
      n.startsWith('21') || n.startsWith('22') || n.startsWith('23');
    const suppressQuantity = ['21', '22', '23'].includes(service) && !unitScore && !totalScore;
    if (unitScore) {
      drawText(pdf, 147, y, formatNumber(unitScore), BODY, 'right');
      if (!existingTimes) drawText(pdf, 161.5, y, '×', BODY, 'center');
    }
    if (quantity && !suppressQuantity) {
      drawText(pdf, 190, y, formatNumber(quantity), BODY, 'right');
      if (!existingCount) drawText(pdf, 196.9, y, '回', BODY, 'center');
    }
    if (totalScore) drawText(pdf, 240, y, formatNumber(totalScore), BODY, 'right');
  }

  // ---- 摘要欄（右） ----
  function drawDetailBox(pdf, detailLines) {
    const x = 297.1, y = SCORE_DETAIL_TOP, w = RIGHT - 297.1, h = SCORE_DETAIL_HEIGHT;
    rect(pdf, x, y, w, h);
    line(pdf, 324.8, y, 324.8, y + h);
    let rowY = y + 0.6;
    const lineHeight = 13.0;
    for (const ld of detailLines) {
      const service = safeText(ld.service);
      if (service) drawText(pdf, 322, rowY, service, BODY, 'right');
      const rightText = safeText(ld.right);
      const textWidth = RIGHT - 8 - 327 - (rightText ? receiptTextWidth(rightText, DETAIL) + 5 : 0);
      drawText(pdf, 327, rowY, trimText(safeText(ld.text), textWidth, DETAIL), DETAIL);
      if (ld.right) drawText(pdf, RIGHT - 8, rowY, rightText, DETAIL, 'right');
      if (ld.separator) line(pdf, 327, rowY + 11.5, RIGHT - 6, rowY + 11.5);
      rowY += lineHeight;
    }
  }

  // ---- 療養の給付欄（下） ----
  function drawPaymentBox(pdf, receipt) {
    const x = LEFT, y = PAYMENT_TOP, w = RIGHT - LEFT, h = PAYMENT_HEIGHT;
    rect(pdf, x, y, w, h);
    for (const xx of [33.6, 44.2, 160.6, 270.5, 352.6]) line(pdf, xx, y, xx, y + h);
    for (const xx of [462.5, 517.5]) line(pdf, xx, 770.9, xx, y + h);
    for (const yy of [746.7, 770.9]) line(pdf, 33.6, yy, yy === 746.7 ? 352.6 : RIGHT, yy);
    drawVerticalLabel(pdf, 23.5, y + 16, '療養の給付', BODY, 20 * UNIT);
    drawVerticalLabel(pdf, 34.8, y + 9.5, '保険', BODY, 20 * UNIT);
    drawText(pdf, 35, y + 49.5, '①', BODY);
    drawText(pdf, 35, y + 73.5, '②', BODY);
    for (const [xx, label] of [[90.29, '請'], [121.01, '求'], [151.73, '点'], [165, '※'], [200.12, '決'], [230.84, '定'], [261.56, '点']]) {
      drawText(pdf, xx, y, label, SMALL);
    }
    drawText(pdf, 272.3, y + 0.6, '一部負担金額', 12 * UNIT);
    drawText(pdf, 344.35, y + 0.6, '円', 12 * UNIT);
    if (!receipt.public_only) {
      drawText(pdf, 159.5, y + 26.6, formatNumber(receipt.total_score), 20 * UNIT, 'right');
      const covered = [];
      (receipt.public_expenses || []).slice(0, 4).forEach((e, i) => {
        const f = formatCopaymentAmount(e.covered_outpatient_burden_amount);
        if (f) covered.push('①②③④'[i] + '（' + f + '）');
      });
      if (covered.length) drawText(pdf, 350, y + 14, covered.join(' '), SMALL, 'right');
      if (receipt.copayment_amount !== null && receipt.copayment_amount !== undefined) {
        drawText(pdf, 350, y + 28, formatCopaymentAmount(receipt.copayment_amount), BODY, 'right');
      }
    }
    (receipt.public_expenses || []).slice(0, 2).forEach((e, index) => {
      const rowY = y + (index === 0 ? 49.5 : 73.5);
      if (e.covered_score !== null && e.covered_score !== undefined) drawText(pdf, 159.5, rowY, formatNumber(e.covered_score), BODY, 'right');
      const amount = e.burden_amount;
      if (amount !== null && amount !== undefined && amount !== '') drawText(pdf, 350, rowY, formatCopaymentAmount(amount), BODY, 'right');
    });
    for (const [xx, label, right] of [[354.4, '※高額', 461], [464.3, '※公', 516], [519.2, '※公', 571]]) {
      drawText(pdf, xx, 772.1, label, SMALL);
      drawText(pdf, right, 772.1, xx === 354.4 ? '円' : '点', SMALL, 'right');
    }
  }

  // ============================================================
  // 明細行・点数欄の組み立て（build_detail_lines / build_score_summary_entries）
  // ============================================================
  function wrapReceiptDetailText(value, right) {
    right = right || '';
    const text = safeText(value);
    const width = RIGHT - 8 - 327;
    const firstWidth = width - (right ? receiptTextWidth(right, DETAIL) + 5 : 0);
    let tokens = Array.from(text);
    const q = /(?:（[^（）]*）|\([^()]*\))\s*ロ$/.exec(text);
    if (q && receiptTextWidth(q[0], DETAIL) <= width) {
      // 末尾の「（…）ロ」は改行で割らない
      tokens = Array.from(text.slice(0, q.index)).concat([q[0]]);
    }
    const rows = [];
    let current = '';
    for (const token of tokens) {
      const available = rows.length ? width : firstWidth;
      if ((current || (!rows.length && Array.from(token).length > 1)) && receiptTextWidth(current + token, DETAIL) > available) {
        rows.push(current);
        current = '';
      }
      current += token;
    }
    rows.push(current);
    return rows;
  }

  function formatDetailName(item) {
    return safeText(item.name || item.action_name || item.drug_name || item.material_name || item.self_pay_name || item.billing_name);
  }

  function formatDetailRight(item) {
    const itemType = safeText(item.item_type);
    const unitScore = intValue(item.unit_score);
    const lineScore = intValue(item.score);
    const count = Math.max(1, intValue(item.quantity, 1));
    if (['drug', 'medicine', 'prescription'].includes(itemType)) {
      const daily = decimalValue(item.drug_quantity || item.dose_quantity);
      const unit = safeText(item.drug_unit || item.dose_unit || item.unit);
      const days = intValue(item.days || item.quantity, 0);
      const parts = [];
      if (daily !== null && !decimalIsZero(daily)) parts.push(formatDecimal(daily) + unit);
      if (days && !item.receipt_group_continuation) parts.push((unitScore ? formatNumber(unitScore) : '0') + '×' + days);
      if (parts.length) return parts.join(' ');
    }
    const score = unitScore || lineScore;
    const quantity = decimalValue(item.drug_quantity || item.material_quantity || item.quantity);
    const unit = safeText(item.drug_unit || item.unit);
    let leftValue = (quantity !== null && !decimalIsOne(quantity)) ? formatDecimal(quantity) : '';
    if (unit && leftValue) leftValue = leftValue + unit;
    if (score) return formatNumber(score) + '×' + count;
    if (leftValue) return leftValue;
    return count > 1 ? count + '回' : '';
  }

  function commentTexts(item) {
    const values = [];
    const add = (v) => { if (v !== null && v !== undefined && v !== '' && !values.includes(v)) values.push(v); };
    for (const c of asList(item.comment_names)) {
      if (c && typeof c === 'object') { const t = c.text || c.name || c.template; if (t) add(safeText(t)); }
      else if (c) add(safeText(c));
    }
    if (item.free_comment) add(safeText(item.free_comment));
    return values;
  }

  function validCommentEraDate(value) {
    if (!/^[1-5][0-9]{6}$/.test(value)) return false;
    const eras = { '1': [1867, 18680125, 19120729], '2': [1911, 19120730, 19261224], '3': [1925, 19261225, 19890107],
      '4': [1988, 19890108, 20190430], '5': [2018, 20190501, 99991231] };
    const [offset, start, end] = eras[value[0]];
    const western = String(offset + parseInt(value.slice(1, 3), 10)) + value.slice(3);
    const p = parseDate(western);
    return !!p && start <= +western && +western <= end;
  }

  function buildDetailLines(receipt) {
    const rows = [];
    const plain = (text) => ({ service: '', text, right: '', separator: false });
    (receipt.diagnoses || []).slice(3).forEach((d, i) => {
      let label = '傷病名(' + (i + 4) + ') ' + diagnosisName(d) + ' ' + formatWarekiDate(d.start_date);
      const outcome = OUTCOME_LABELS[diagnosisOutcomeCode(d.outcome)] || '';
      if (outcome) label += ' ' + outcome;
      wrapReceiptDetailText(label).forEach((t) => rows.push(plain(t)));
    });
    const positioned = {};
    for (const comment of receipt.receipt_comments || []) {
      let value = String(comment.text || '');
      // パターン50（和暦の年月日）は日付の表記に直す
      if (comment.pattern === '50' && validCommentEraDate(value)) {
        value = normalizeText(value);
        const base = { '1': 1867, '2': 1911, '3': 1925, '4': 1988, '5': 2018 }[value[0]];
        value = formatWarekiDate({ y: base + parseInt(value.slice(1, 3), 10), m: parseInt(value.slice(3, 5), 10), d: parseInt(value.slice(5, 7), 10) });
      }
      const label = (comment.master_text || '') + value;
      const commentRows = wrapReceiptDetailText(label).map(plain);
      if (comment.after_item_id) (positioned[comment.after_item_id] = positioned[comment.after_item_id] || []).push(...commentRows);
      else rows.push(...commentRows);
    }
    const details = orderReceiptDetails(asList(receipt.items).filter((it) => !it.do_not_bill));
    for (const item of details) {
      const service = classifyServiceCode(item);
      if (!service) continue;
      const right = formatDetailRight(item);
      const wrapped = wrapReceiptDetailText(formatDetailName(item), right);
      wrapped.forEach((t, index) => rows.push({
        service: index === 0 ? service : '', text: t, right: index === 0 ? right : '', separator: index === wrapped.length - 1,
      }));
      commentTexts(item).slice(0, 2).forEach((c) => wrapReceiptDetailText(c).forEach((t) => rows.push(plain(t))));
      rows.push(...(positioned[String(item.id)] || []));
    }
    if (!rows.length) rows.push(plain('算定明細がありません。'));
    wrapReceiptDetailText(receipt.symptom_detail || '').forEach((t) => { if (t) rows.push(plain(t)); });
    return rows;
  }

  /** 一連の行為（継続行＋終端行）の塊ごとに、診療識別の昇順に安定並べ替え（基準版 order_receipt_details） */
  function orderReceiptDetails(details) {
    const blocks = [];
    let active = [];
    for (const d of details) {
      active.push(d);
      if (d.receipt_group_continuation !== true) { blocks.push(active); active = []; }
    }
    if (active.length) return details;   // 終端行が無い: 並べ替えない（基準版と同じ）
    const indexed = blocks.map((b, i) => [b, i]);
    indexed.sort((a, b) => (parseInt(classifyServiceCode(a[0][0]) || '0', 10) - parseInt(classifyServiceCode(b[0][0]) || '0', 10)) || (a[1] - b[1]));
    return [].concat(...indexed.map((x) => x[0]));
  }

  /** 診療識別（UKE の SI/IY/TO の診療識別をそのまま使う） */
  function classifyServiceCode(item) {
    if (!item.item_type) return '';
    return String(item.receipt_category_code || '').slice(0, 2);
  }

  function serviceMajorCode(service) {
    if (service === '54') return '50';
    const major = SECTION_CODES.has(service.slice(0, 2)) ? service.slice(0, 2) : service;
    if (['21', '22', '23', '24', '25', '26', '27', '28'].includes(major)) return '20';
    if (['31', '32', '33'].includes(major)) return '30';
    return major;
  }

  function sumScoreEntries(entries) {
    const score = entries.reduce((s, e) => s + e.score, 0);
    const count = entries.reduce((s, e) => s + e.quantity, 0);
    return Object.assign({}, entries[0], { score, quantity: count, unit_score: count && score % count === 0 ? Math.floor(score / count) : 0 });
  }

  function normalizeScoreLabel(value) { return normalizeText(value).replace(/箋/g, 'せん'); }

  function findScoreEntryForLabel(label, entries, used) {
    const nl = normalizeScoreLabel(label);
    const codeMatch = /^(\d{2})/.exec(normalizeText(label));
    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;
      const e = entries[i];
      if (codeMatch && safeText(e.service).startsWith(codeMatch[1])) return i;
      const en = normalizeScoreLabel(e.name);
      if (!nl && !en) return i;
      if (nl && en.includes(nl)) return i;
      if (nl === '処方せん' && en.includes('処方せん')) return i;
    }
    return null;
  }

  function buildScoreSummaryEntries(receipt) {
    const entries = {};
    let pending = [];
    const summarized = [];
    for (const item of asList(receipt.items)) {
      if (item.inspection_only) continue;
      if (Object.prototype.hasOwnProperty.call(item, 'receipt_group_continuation')) {
        pending.push(item);
        if (item.receipt_group_continuation) continue;
        summarized.push(Object.assign({}, pending[0], { unit_score: item.unit_score, score: item.score }));
        pending = [];
      } else {
        summarized.push(item);
      }
    }
    const slotLabels = { '120': '再診', '122': '外来管理加算', '123': '時間外', '124': '休日', '125': '深夜',
      '210': '内服調剤', '230': '外用調剤', '250': '処方', '260': '麻毒', '270': '調基' };
    for (const item of summarized) {
      if (item.do_not_bill) continue;
      const service = classifyServiceCode(item);
      if (!service) continue;
      const major = serviceMajorCode(service);
      let unitScore = intValue(item.unit_score);
      if (!unitScore) unitScore = intValue(item.score);
      let quantity = Math.max(1, intValue(item.quantity, 1));
      let totalScore = intValue(item.score);
      if (!totalScore) totalScore = unitScore * quantity;
      const row = (item.item_type === 'drug' || item.item_type === 'material') ? null : officialActionRow(item.code || item.action_code);
      const slot = row ? row.slot : '';
      let name = slotLabels[slot] || formatDetailName(item);
      if (major === '14') {
        name = ['在宅患者訪問診療', '往診', '深夜・緊急', '夜間'].find((l) => name.startsWith(l)) || (item.item_type === 'drug' ? '薬剤' : 'その他');
      } else if (['21', '22', '23'].includes(service) && ['drug', 'medicine', 'prescription'].includes(item.item_type)) {
        name = { '21': '内服薬剤', '22': '頓服薬剤', '23': '外用薬剤' }[service];
      } else if (major === '30') {
        name = { '31': '皮下筋肉内', '32': '静脈内', '33': 'その他' }[service] || 'その他';
      }
      if ((slot === '110' || slot === '120') && row && !['1', '2'].includes(row.c27)) quantity = 0;
      if (['210', '230', '250', '260', '270'].includes(slot) && row && !['', '0'].includes(row.c38)) quantity = 0;
      if (['40', '50', '60', '70'].includes(major)) {
        name = item.item_type === 'drug' ? '薬剤' : LEFT_SECTION_LAYOUT.find((s) => s.code === major).labels[0];
      } else if (major === '80') {
        name = name.includes('処方') ? '処方せん' : item.item_type === 'drug' ? '薬剤' : '';
      }
      const entry = { service, name, unit_score: unitScore, quantity, score: totalScore };
      const list = entries[major] = entries[major] || [];
      const existing = list.find((e) => e.name === name && e.service === service);
      if (!existing) list.push(entry);
      else Object.assign(existing, sumScoreEntries([existing, entry]));
    }
    return entries;
  }

  function paginate(values, perPage) {
    if (!values.length) return [[]];
    const pages = [];
    for (let i = 0; i < values.length; i += perPage) pages.push(values.slice(i, i + perPage));
    return pages;
  }

  // ============================================================
  // 公開: 1レセプト分のページ（SVG 文字列の配列）
  // ============================================================
  /**
   * @param {object} receipt   基準版の形のレセプト（receiptFromViewer の戻り値）
   * @param {object} facility  {name, address, phone, medical_institution_code, department?}
   * @param {number} index     何件目か（患者番号が無いときの表示用）
   * @returns {{pages: string[], warnings: string[]}}
   */
  function buildReceiptPages(receipt, facility, index) {
    const serviceMonth = parseDate(receipt.receipt_claim_month) || parseDate(receipt.billing_date);
    const lines = buildDetailLines(receipt);
    const chunks = paginate(lines, DETAIL_LINES_PER_PAGE);
    const pages = [], warnings = [];
    chunks.forEach((chunk, i) => {
      const pdf = new FormCanvas();
      drawReceiptPage(pdf, receipt, facility, serviceMonth, receipt.payer_group || '', index || 1, i + 1, chunks.length, chunk);
      pages.push(pdf.toSVG());
      pdf.warnings.forEach((w) => { if (!warnings.includes(w)) warnings.push(w); });
    });
    return { pages, warnings };
  }

  function buildEmptyPage(facility, claimMonth, payerGroup) {
    const pdf = new FormCanvas();
    drawEmptyReceiptPage(pdf, facility, claimMonth, payerGroup);
    return pdf.toSVG();
  }

  // ============================================================
  // データの橋渡し: 点検ビューアの receipt（UKE を読んだもの）→ 基準版の形
  //   UKE の生の行（receipt._lines）から、ビューアが持っていない項目（枝番・一部負担金額・公費の実日数/点数/負担金・
  //   コメント・症状詳記・特定器材）も拾う。
  // ============================================================
  function masterDrug(code) {
    try { return (typeof MasterLoader !== 'undefined' && MasterLoader.getDrug) ? MasterLoader.getDrug(code) : null; } catch (e) { return null; }
  }
  function masterProcedureName(code) {
    try {
      if (typeof MasterLoader !== 'undefined' && MasterLoader.getProcedureName) { const n = MasterLoader.getProcedureName(code); if (n) return n; }
    } catch (e) { /* 名称が引けなければ下へ */ }
    return (typeof PROCEDURE_CODES !== 'undefined' && PROCEDURE_CODES[code]) || '';
  }
  function masterDiseaseName(code) {
    try {
      if (typeof MasterLoader !== 'undefined' && MasterLoader.getDiseaseName) { const n = MasterLoader.getDiseaseName(code); if (n) return n; }
    } catch (e) { /* 下へ */ }
    return (typeof DISEASE_CODES !== 'undefined' && DISEASE_CODES[code]) || '';
  }
  function masterModifierName(code) {
    try {
      if (typeof MasterLoader !== 'undefined' && MasterLoader.getModifierName) { const n = MasterLoader.getModifierName(code); if (n) return n; }
    } catch (e) { /* 下へ */ }
    return (typeof MODIFIER_CODES !== 'undefined' && MODIFIER_CODES[code]) || '';
  }
  function masterCommentText(code) {
    try {
      if (typeof MasterLoader !== 'undefined' && MasterLoader.getBeppyoComment) { const c = MasterLoader.getBeppyoComment(code); if (c && c.d) return c.d; }
    } catch (e) { /* 下へ */ }
    return '';
  }

  /** 傷病名の正式名称（修飾語: 8xxx は後ろ、それ以外は前に付ける） */
  function composeDiagnosisName(code, modifiers, freeName) {
    const base = (code === '0000999' ? '' : masterDiseaseName(code)) || freeName || '';
    let prefix = '', suffix = '';
    for (let i = 0; i + 4 <= modifiers.length; i += 4) {
      const m = modifiers.slice(i, i + 4);
      const n = masterModifierName(m);
      if (!n) continue;
      if (m[0] === '8') suffix += n; else prefix += n;
    }
    return prefix + base + suffix;
  }

  function receiptFromViewer(r) {
    const lines = (r._lines && r._lines.length) ? r._lines : [r._raw || ''];
    const recs = lines.map((l) => String(l).split(','));
    const first = (type) => recs.find((f) => f[0] === type) || null;
    const re = first('RE') || [];
    const ho = first('HO');
    const sn = recs.find((f) => f[0] === 'SN' && (f[1] || '1') === '1') || null;
    const typeCode = String(re[2] || r.insuranceTypeCode || '');
    const payerGroup = /kokuho/i.test(r.fileType || '') ? 'kokuho' : 'shaho';
    const publicOnly = typeCode[1] === '2';

    const publicExpenses = recs.filter((f) => f[0] === 'KO').map((f) => ({
      payer_number: f[1] || '', recipient_number: f[2] || '',
      visit_days: f[4] !== undefined && f[4] !== '' ? intValue(f[4]) : null,
      covered_score: f[5] !== undefined && f[5] !== '' ? intValue(f[5]) : null,
      burden_amount: f[6] !== undefined && f[6] !== '' ? f[6] : null,
      covered_outpatient_burden_amount: f[7] !== undefined && f[7] !== '' ? f[7] : null,
    }));

    const diagnoses = recs.filter((f) => f[0] === 'SY').map((f) => ({
      diagnosis_code: f[1] || '',
      full_name: composeDiagnosisName(f[1] || '', f[4] || '', f[5] || ''),
      start_date: f[2] || '',
      outcome: f[3] || '',
    }));

    // 明細（SI/IY/TO）とコメント（CO）・症状詳記（SJ）
    const items = [], comments = [], symptoms = [];
    let category = '', lastItemId = null, seq = 0;
    for (const f of recs) {
      const t = f[0];
      if (t === 'SI' || t === 'IY' || t === 'TO') {
        if (f[1]) category = f[1];
        const id = 'L' + (++seq);
        const points = f[5] || '', count = f[6] || '';
        const base = { id, code: f[3] || '', receipt_category_code: category, _points: points, _count: count };
        if (t === 'SI') {
          const q = Math.max(1, intValue(count, 1));
          items.push(Object.assign(base, { item_type: 'action', name: masterProcedureName(f[3] || ''),
            unit_score: intValue(points), quantity: count === '' ? 1 : intValue(count), score: intValue(points) * q }));
        } else if (t === 'IY') {
          const drug = masterDrug(f[3] || '');
          const days = intValue(count);
          items.push(Object.assign(base, { item_type: 'drug', name: (drug && drug.name) || '',
            drug_quantity: f[4] || '', drug_unit: (drug && drug.unit) || '', unit_score: intValue(points), days,
            score: intValue(points) * Math.max(1, days) * (points === '' ? 0 : 1) }));
        } else {
          const q = Math.max(1, intValue(count, 1));
          items.push(Object.assign(base, { item_type: 'material', name: f[10] || '',
            material_quantity: f[4] || '', unit_score: intValue(points), quantity: count === '' ? 1 : intValue(count), score: intValue(points) * q }));
        }
        lastItemId = id;
      } else if (t === 'CO') {
        const code = f[3] || '';
        comments.push({ code, text: f.slice(4).join(','), pattern: code.slice(1, 3), master_text: masterCommentText(code), after_item_id: lastItemId });
      } else if (t === 'SJ') {
        if (f[2]) symptoms.push(f.slice(2).join(','));
      }
    }
    // 剤（点数・回数の無い行が続き、最後の行に点数・回数がある）を継続行として印を付ける
    for (let i = 0; i < items.length; i++) {
      if (items[i]._points === '' && items[i]._count === '') {
        let j = i;
        while (j < items.length && items[j]._points === '' && items[j]._count === '' && items[j].receipt_category_code === items[i].receipt_category_code) j++;
        if (j < items.length && items[j].receipt_category_code === items[i].receipt_category_code) {
          for (let k = i; k < j; k++) items[k].receipt_group_continuation = true;
          items[j].receipt_group_continuation = false;
        }
        i = j;
      }
    }
    items.forEach((it) => { delete it._points; delete it._count; });

    const copay = ho && ho[11] !== undefined && /^[0-9]+$/.test(ho[11]) ? ho[11] : null;
    const deptCode = digitsOnly(re[21] || '');
    return {
      payer_group: payerGroup,
      public_only: publicOnly,
      patient_no: re[13] || r.karteNumber || '',
      patient_name: re[4] || r.name || '',
      gender: re[5] || '',
      birth_date: re[6] || r.dob || '',
      receipt_claim_month: re[3] || r.billingMonth || '',
      insured_person_type_code: typeCode[3] || '',
      insurer_number: ho ? (ho[1] || '').trim() : '',
      symbol: ho ? (ho[2] || '') : '',
      insurance_number: ho ? (ho[3] || '') : '',
      branch_number: sn ? (sn[6] || '') : '',
      visit_days: ho ? intValue(ho[4]) : (r.jitsuNissu || 0),
      total_score: ho ? intValue(ho[5]) : (r.totalPoints || 0),
      copayment_amount: copay,
      department: deptCode.length >= 2 ? deptCode.slice(0, 2) : '',
      public_expenses: publicExpenses,
      diagnoses,
      items,
      receipt_comments: comments,
      symptom_detail: symptoms.join(' '),
    };
  }

  // ============================================================
  // 公開: 印刷用の文書 HTML
  // ============================================================
  function fontBase() {
    try { return new URL('fonts/', document.baseURI).href; } catch (e) { return 'fonts/'; }
  }
  function buildDocHTML(title, pagesSvg) {
    const base = fontBase();
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>' + xmlEsc(title) + '</title>\n<style>\n' +
      '@font-face { font-family: "' + FONT_GOTHIC + '"; src: url("' + base + 'ipag.ttf") format("truetype"); }\n' +
      '@font-face { font-family: "' + FONT_LATIN + '"; src: url("' + base + 'DejaVuSans.ttf") format("truetype"); }\n' +
      '@page { size: ' + PAGE_WIDTH + 'pt ' + PAGE_HEIGHT + 'pt; margin: 0; }\n' +
      'html, body { margin: 0; padding: 0; background: #fff; }\n' +
      '.rzsvg { display: block; width: ' + SHEET_PX_W + 'px; height: ' + SHEET_PX_H + 'px; break-after: page; page-break-after: always; overflow: hidden; }\n' +
      '.rzsvg:last-of-type { break-after: auto; page-break-after: auto; }\n' +
      '.rzsvg text { font-kerning: none; font-variant-ligatures: none; font-feature-settings: "kern" 0, "liga" 0, "palt" 0; }\n' +
      '.rz-hint { font: 12px sans-serif; background: #fdf6e3; border: 1px solid #d0c8a8; padding: 6px 10px; margin: 8px; }\n' +
      '@media screen { body { background: #e8e6e1; } .rzsvg { background: #fff; margin: 12px auto; box-shadow: 0 0 0 1px #c8c4bc; } }\n' +
      '@media print { .no-print { display: none !important; } }\n' +
      '</style></head><body>\n' +
      '<div class="rz-hint no-print">印刷ダイアログで送信先を「PDFに保存」にするとPDFファイルとして保存できます。用紙はA4・倍率100%・余白なしで印刷してください。（この帯は印刷されません）</div>\n' +
      pagesSvg.join('\n') + '\n</body></html>';
  }

  /** 印刷窓で文字（2書体）を読み終えてから印刷する */
  function printWhenReady(w) {
    const later = () => setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* 閉じられた */ } }, 200);
    try {
      const fonts = w.document && w.document.fonts;
      if (fonts && fonts.load) {
        Promise.all([fonts.load('12px "' + FONT_GOTHIC + '"', 'あ'), fonts.load('12px "' + FONT_LATIN + '"', 'A')])
          .then(() => fonts.ready).then(later, later);
        return;
      }
    } catch (e) { /* 下へ */ }
    later();
  }

  return {
    PAGE_WIDTH, PAGE_HEIGHT,
    receiptFromViewer,
    buildReceiptPages,
    buildEmptyPage,
    buildDocHTML,
    printWhenReady,
    // 検証用
    _internal: { receiptTextWidth, wrapReceiptDetailText, buildDetailLines, buildScoreSummaryEntries, formatDetailRight },
  };
})();
