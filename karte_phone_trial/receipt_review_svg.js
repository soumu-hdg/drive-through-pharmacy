// ===== 要確認レセプト一覧・公費の医療費請求書（SVG 描画） receipt_review_svg.js =====
// 基準版の2つの帳票を、座標・線幅・文字サイズ・文字の振り分け・折り返し・改ページの規則まで同じ値で JavaScript に写したもの。
//   ・要確認レセプト一覧（build_warning_receipt_list_pdf）… 提出用・点検用の ZIP の直下に入る一覧
//   ・医療費請求書（連記式・愛知県の福祉医療。build_aichi_renki_pdf）… 保険請求とは別に請求する公費の請求書（kouhi/医療費請求書.pdf）
// 作り方は点検用レセプトの様式（rezept_form_svg.js）と同じ:
//   ・A4（595×842pt）に上原点の座標で描き、1ページ = SVG 文字列 1つ。文字は1文字ずつ位置を決めて置く（ブラウザの字詰めの影響を受けない）
//   ・書体は IPAゴシック（fonts/ipag.ttf）と DejaVuSans（fonts/DejaVuSans.ttf）。文字幅は書体ファイルの実寸（1000分率）で測る
//   ・PDF にするのは RezeptFormPdf.fromSvgPages（rezept_form_pdf.js）。
//     医療費請求書の丸・楕円・括弧の曲線・枠・横倒しの括弧は RezeptFormPdf が扱わない描き方なので、ページの SVG に
//     「目印の線（ページの外）」と PDF の描画命令を持たせておき、PDF にした後で目印を基準版と同じ描画命令に置き換える（toPdf）。
// 文字の振り分け（基準版と同じ）:
//   ・要確認レセプト一覧: DejaVuSans にある文字は DejaVuSans、それ以外は IPAゴシック。見出しの太字は、太字の欧文書体
//     （DejaVuSans-Bold）が無い環境の基準版と同じく全部 IPAゴシック（基準版の太字の和文も IPAゴシック）。
//     並び（同じ書体の文字の続き）ごとの送り幅は、並びの前後の空白を除いた幅で進める（基準版の warning_run_width と同じ）
//   ・医療費請求書: U+0100 未満は DejaVuSans、それ以外は IPAゴシック（点検用レセプトと同じ）
// 使い方:
//   await ReceiptReviewSvg.ready();                       // 書体を読む（1回）
//   const pages = ReceiptReviewSvg.buildWarningListPages(rows, '202609', '202609241030');
//   const blob = await ReceiptReviewSvg.toPdf(pages, { title: '要確認レセプト一覧' });
// 依存: rezept_form_pdf.js（RezeptFormPdf。PDF にするときだけ）

// var で宣言する（読み込んだ窓の window.ReceiptReviewSvg として別の窓から参照できるように）
var ReceiptReviewSvg = (() => {
  'use strict';

  const PAGE_WIDTH = 595.0;
  const PAGE_HEIGHT = 842.0;
  const FONT_GOTHIC = 'RzFormGothic';   // rezept_form_pdf.js が IPAゴシックとして読む書体名
  const FONT_LATIN = 'RzFormLatin';     // 同じく DejaVuSans
  const TEXT_EM = 100;                  // SVG 上で文字を組む大きさ（変換行列で実寸に縮める）
  const GLYPH_NUDGE = 0.002;            // rezept_form_svg.js と同じ（PDF 化では戻す）
  const SHEET_PX_W = 793;
  const SHEET_PX_H = 1122;
  const MARK_WIDTH = 0.001;             // 目印の線の太さ（PDF にした後で置き換える）

  const SCRIPT_BASE = (() => {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) return new URL('fonts/', document.currentScript.src).href;
    } catch (e) { /* 下へ */ }
    return 'fonts/';
  })();

  // ============================================================
  // 書体の寸法（cmap と hmtx だけを読む）
  // ============================================================
  function u16(d, o) { return (d[o] << 8) | d[o + 1]; }
  function i16(d, o) { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; }
  function u32(d, o) { return ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3]; }
  function parseMetrics(buf) {
    const d = new Uint8Array(buf);
    const tables = {};
    for (let i = 0, n = u16(d, 4); i < n; i++) {
      const o = 12 + i * 16;
      tables[String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3])] = { off: u32(d, o + 8), len: u32(d, o + 12) };
    }
    const T = (t) => d.subarray(tables[t].off, tables[t].off + tables[t].len);
    const head = T('head'), hhea = T('hhea'), hmtx = T('hmtx'), cmap = T('cmap');
    const upem = u16(head, 18), numHM = u16(hhea, 34);
    // 基準版（reportlab）と同じく Windows の Unicode 表（形式 12 があれば形式 12）を使う
    let best = null;
    for (let i = 0, n = u16(cmap, 2); i < n; i++) {
      const pid = u16(cmap, 4 + i * 8), eid = u16(cmap, 6 + i * 8), off = u32(cmap, 8 + i * 8), fmt = u16(cmap, off);
      if (pid === 3 && eid === 10 && fmt === 12) { best = { fmt, off }; break; }
      if (((pid === 3 && eid === 1) || pid === 0) && fmt === 4 && !best) best = { fmt, off };
    }
    const cache = new Map();
    let lookup = () => 0;
    if (best && best.fmt === 12) {
      const o = best.off, groups = u32(cmap, o + 12);
      lookup = (cp) => {
        let lo = 0, hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, g = o + 16 + mid * 12, s = u32(cmap, g), e = u32(cmap, g + 4);
          if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return u32(cmap, g + 8) + (cp - s);
        }
        return 0;
      };
    } else if (best) {
      const o = best.off, segX2 = u16(cmap, o + 6);
      const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      lookup = (cp) => {
        if (cp > 0xffff) return 0;
        for (let i = 0; i < segX2; i += 2) {
          if (cp > u16(cmap, ends + i)) continue;
          const s = u16(cmap, starts + i);
          if (cp < s) return 0;
          const ro = u16(cmap, ranges + i);
          if (!ro) return (cp + i16(cmap, deltas + i)) & 0xffff;
          const gi = u16(cmap, ranges + i + ro + (cp - s) * 2);
          return gi ? (gi + i16(cmap, deltas + i)) & 0xffff : 0;
        }
        return 0;
      };
    }
    const glyph = (cp) => { let g = cache.get(cp); if (g === undefined) { g = lookup(cp); cache.set(cp, g); } return g; };
    const advance = (g) => u16(hmtx, (g < numHM ? g : numHM - 1) * 4) * 1000 / upem;
    return {
      has: (cp) => glyph(cp) !== 0,
      // 書体に無い文字は字形 0 の幅（基準版の defaultWidth と同じ）。U+00A0 は空白と同じ幅
      width: (cp) => { const g = glyph(cp === 0xa0 && !glyph(0xa0) ? 0x20 : cp); return advance(g); },
    };
  }

  let M = null;           // { gothic, latin }
  let _loading = null;
  /** 書体を読む。opts.fonts = { gothic: ArrayBuffer, latin: ArrayBuffer }（検証用に直接渡す）／opts.fontBase = 書体のある場所 */
  function ready(opts) {
    opts = opts || {};
    if (opts.fonts) { M = { gothic: parseMetrics(opts.fonts.gothic), latin: parseMetrics(opts.fonts.latin) }; return Promise.resolve(true); }
    if (M) return Promise.resolve(true);
    if (!_loading) {
      const base = opts.fontBase || SCRIPT_BASE;
      const get = (n) => fetch(base + n).then((r) => { if (!r.ok) throw new Error('書体を読めません: ' + n + '（' + r.status + '）'); return r.arrayBuffer(); });
      _loading = Promise.all([get('ipag.ttf'), get('DejaVuSans.ttf')]).then(([g, l]) => { M = { gothic: parseMetrics(g), latin: parseMetrics(l) }; return true; });
      _loading.catch(() => { _loading = null; });
    }
    return _loading;
  }
  function need() { if (!M) throw new Error('書体がまだ読み込まれていません（ReceiptReviewSvg.ready() を先に呼んでください）'); return M; }
  const cpOf = (ch) => ch.codePointAt(0);
  function runWidth(font, text, size) {
    const m = need()[font === FONT_LATIN ? 'latin' : 'gothic'];
    let w = 0;
    for (const ch of Array.from(text)) w += m.width(cpOf(ch));
    return w * size / 1000;
  }

  // ============================================================
  // 描画（1ページ）
  // ============================================================
  function num(v) { return String(Math.round(v * 10000) / 10000); }
  function grayHex(g) { const v = Math.round(g * 255).toString(16).padStart(2, '0'); return '#' + v + v + v; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // PDF の数値の書き方（有効数字およそ7桁・末尾の 0 は落とす。rezept_form_pdf.js と同じ）
  function n4(v) {
    if (!isFinite(v) || Math.abs(v) < 1e-9) return '0';
    const places = Math.min(10, Math.max(0, 6 - Math.floor(Math.log10(Math.abs(v)))));
    let s = v.toFixed(places);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  class Page {
    constructor() { this.parts = []; this.ops = []; }
    fillRect(x, y, w, h, gray) {
      this.parts.push('<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + grayHex(gray) + '"/>');
    }
    /** 軸に平行な線・斜めの線（太さ・濃さ指定。PDF では m l S の線） */
    line(x1, y1, x2, y2, width, gray) {
      this.parts.push('<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" stroke="' + grayHex(gray) + '" stroke-width="' + num(width) + '"/>');
    }
    /**
     * 文字の並び [[書体, 文字列, 送り幅], ...] を基線 baseline から置く（送り幅＝次の並びまでの距離）。
     * separate=true: 並びごとに PDF の文字の組（BT … ET）を分ける（基準版の要確認一覧は並びごとに drawString するため）。
     *   RezeptFormPdf は同じ基線で隣り合う文字を1つの組にまとめるので、1つおきに基線を 0.000001pt だけずらして組を分けさせる
     *   （PDF の数値は有効数字7桁で書かれるので、書き出される座標は基準版と同じになる）
     */
    runs(x, baseline, runs, size, gray, separate) {
      // PDF 化（RezeptFormPdf）が文字の大きさを元に戻せるよう、丸めずに縮小率を指定する
      const k = (size * 4 / 3 + 0.0002) * 3 / 4 / TEXT_EM;
      let cursor = x;
      runs.forEach(([font, text, advance], ri) => {
        let cx = cursor;
        const by = separate && ri % 2 ? baseline + 0.000001 : baseline;
        for (const ch of Array.from(text)) {
          if (separate || !/\s/.test(ch)) {   // 要確認一覧は空白も字形として置く（基準版と同じく文字の取り出しに空白が残る。見た目は変わらない）
            this.parts.push('<text font-family="' + font + '" font-size="' + TEXT_EM + '" transform="matrix(' + k + ' 0 0 ' + k + ' ' + (cx + GLYPH_NUDGE) + ' ' + (by + GLYPH_NUDGE) +
              ')" fill="' + grayHex(gray) + '">' + xmlEsc(ch) + '</text>');
          }
          cx += runWidth(font, ch, size);
        }
        cursor += advance;
      });
    }
    /** RezeptFormPdf が扱わない描き方: 画面用の SVG と、PDF の描画命令（PDF にした後で目印の線と置き換える） */
    special(svg, pdfOps) {
      const k = this.ops.length;
      this.ops.push(pdfOps);
      if (svg) this.parts.push(svg);
      this.parts.push('<line x1="' + (-9000 - k) + '" y1="0" x2="' + (-9000 - k) + '" y2="0" stroke="#000000" stroke-width="' + MARK_WIDTH + '"/>');
    }
    toSVG() {
      const ops = this.ops.length ? '<desc class="rz-pdfops">' + xmlEsc(JSON.stringify(this.ops)) + '</desc>' : '';
      return '<svg xmlns="http://www.w3.org/2000/svg" class="rzsvg" width="' + SHEET_PX_W + 'px" height="' + SHEET_PX_H + 'px">' + ops +
        '<g transform="scale(' + (4 / 3) + ')"><svg viewBox="0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT + '" width="' + PAGE_WIDTH + '" height="' + PAGE_HEIGHT + '" overflow="visible">' +
        this.parts.join('') + '</svg></g></svg>';
    }
  }

  // ============================================================
  // 文字の整形（基準版と同じ）
  // ============================================================
  function safeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    let t = safeText(value).replace(/\//g, '-');
    if (/^\d{6}$/.test(t)) t = t.slice(0, 4) + '-' + t.slice(4, 6) + '-01';
    if (/^\d{8}$/.test(t)) t = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
    if (/^\d{4}-\d{1,2}$/.test(t)) t += '-01';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.slice(0, 10));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  const comma = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // ============================================================
  // 要確認レセプト一覧（receipt_inspection_pdf.py の build_warning_receipt_list_pdf）
  // ============================================================
  const W_TABLE_X = 22.05;
  const W_TABLE_Y = 97.0;
  const W_TABLE_BOTTOM = 813.5;
  const W_COLS = [38.99, 71.98, 32.99, 109.77, 32.99, 263.93];
  const W_BODY = 9.5;
  const W_LEADING = 13.8;
  const W_PAD = 0.6;
  const W_MIN_ROW = 14.4;
  const W_GRID_GRAY = 0.34;
  const W_TEXT_GRAY = 0.08;

  /** 文字列 → 並び（DejaVuSans にある文字は欧文、それ以外は IPAゴシック。bold は全部 IPAゴシック） */
  function warningRuns(text, bold) {
    const m = need(); const runs = [];
    for (const ch of Array.from(text)) {
      const font = !bold && m.latin.has(cpOf(ch)) ? FONT_LATIN : FONT_GOTHIC;
      if (runs.length && runs[runs.length - 1][0] === font) runs[runs.length - 1][1] += ch;
      else runs.push([font, ch]);
    }
    // 送り幅は並びの前後の空白を除いた幅（基準版 warning_run_width は safe_text を通した幅を返す）
    return runs.map(([font, run]) => [font, run, runWidth(font, safeText(run), 1)]);
  }
  function warningTextWidth(value, size, bold) {
    return warningRuns(safeText(value), bold).reduce((s, r) => s + r[2] * size, 0);
  }
  function warningDrawText(pg, x, y, value, size, opts) {
    opts = opts || {};
    const text = safeText(value);
    if (!text) return;
    const runs = warningRuns(text, opts.bold).map(([f, t, w]) => [f, t, w * size]);
    const total = runs.reduce((s, r) => s + r[2], 0);
    const cursor = opts.align === 'right' ? x - total : opts.align === 'center' ? x - total / 2 : x;
    pg.runs(cursor, y + size, runs, size, W_TEXT_GRAY, true);
  }
  function warningLine(pg, x1, y1, x2, y2, width) { pg.line(x1, y1, x2, y2, width, W_GRID_GRAY); }
  function warningUnderlinedRight(pg, right, y, value, underline) {
    const text = safeText(value);
    if (!text) return;
    const width = warningTextWidth(text, W_BODY);
    warningDrawText(pg, right, y, text, W_BODY, { align: 'right' });
    if (underline !== false) warningLine(pg, right - width, y + W_BODY + 1.0, right, y + W_BODY + 1.0, 0.45);
  }
  function warningWrap(value, width) {
    const lines = [];
    for (const paragraph of safeText(value).replace(/\r/g, '').split('\n')) {
      let current = '';
      for (const ch of Array.from(paragraph)) {
        if (current && warningTextWidth(current + ch, W_BODY) > width) { lines.push(current); current = ''; }
        current += ch;
      }
      lines.push(current);
    }
    return lines.length ? lines : [''];
  }
  const warningMessageText = (value) => String(value || '').split(/\r\n|\r|\n/).map(safeText).join('\n');
  function warningInsuranceLabel(value) {
    const label = safeText(value).trim();
    return { '社保': '協会', '社会保険': '協会', shaho: '協会', kokuho: '国保' }[label] || label;
  }
  function warningRequiresMark(message) {
    const v = safeText(message);
    return ['会計登録がされていません', '未会計', '保険者番号', '被保険者', '負担割合', '公費', '医療証', '受給者番号'].some((t) => v.includes(t));
  }
  function formatVisitDate(value) {
    const p = parseDate(value);
    if (p) return p.m + '/' + p.d;
    const text = safeText(value).trim();
    const m = /(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/.exec(text);
    return m ? (+m[1]) + '/' + (+m[2]) : text;
  }
  function formatClaimMonth(value) {
    const p = parseDate(value) || (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();
    return p.y + '年' + p.m + '月分';
  }
  /** 作成日時の表示（基準版と同じ: YYYYMMDDHHMM 等を読み、日付だけなら今の時刻を足す） */
  function formatCreatedAt(value) {
    const text = safeText(value).trim();
    let y, mo, d, h = null, mi = null;
    let m;
    if ((m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(text))) { [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]]; }
    else if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text))) { [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]]; }
    else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(text)) || (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) { [y, mo, d] = [m[1], m[2], m[3]]; }
    const now = new Date(Date.now() + (9 * 60 + new Date().getTimezoneOffset()) * 60000);   // 日本時間
    if (!y) { y = now.getFullYear(); mo = pad2(now.getMonth() + 1); d = pad2(now.getDate()); }
    if (h === null) { h = pad2(now.getHours()); mi = pad2(now.getMinutes()); }
    return y + '/' + mo + '/' + d + ' ' + h + ':' + mi;
  }
  function normalizeWarningRows(warningRows, formatRows) {
    const rows = [];
    for (const src of warningRows || []) {
      const payer = safeText(src[0]), patientNo = safeText(src[1]), patientName = safeText(src[2]);
      const billingDate = String(src.length > 3 && src[3] != null ? src[3] : '').replace(/\r/g, '');
      let message = warningMessageText(src.length > 4 ? src[4] : '');
      if (!patientNo && patientName) message = message ? patientName + '：' + message : patientName;
      rows.push({ payer: warningInsuranceLabel(payer), patient_no: patientNo, billing_date: billingDate, message });
    }
    for (const src of formatRows || []) {
      const label = safeText(src.length > 0 ? src[0] : 'レセ電確認');
      const message = warningMessageText(src.length > 2 ? src[2] : (src.length ? src[src.length - 1] : ''));
      rows.push({ payer: '', patient_no: '', billing_date: '', message: label && message ? label + '：' + message : (message || label) });
    }
    if (!rows.length) rows.push({ payer: '', patient_no: '', billing_date: '', message: '要確認レセプトはありません。' });
    return rows;
  }
  function prepareWarningGroups(rows) {
    const grouped = new Map();
    let patientNumber = 0, systemIndex = 0;
    for (const src of rows) {
      const patientNo = safeText(src.patient_no).trim();
      let key;
      if (patientNo) key = 'patient:' + patientNo; else { systemIndex++; key = 'system:' + systemIndex; }
      let group = grouped.get(key);
      if (!group) {
        if (patientNo) patientNumber++;
        group = { key, no: patientNo ? String(patientNumber) : '', patient_no: patientNo, dates: new Map() };
        grouped.set(key, group);
      }
      let raw = String(src.billing_date || '').split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);
      if (!raw.length) raw = [''];
      const dateLabel = raw.map(formatVisitDate).join('・');
      const dateKey = dateLabel || 'blank:' + (group.dates.size + 1);
      if (!group.dates.has(dateKey)) group.dates.set(dateKey, { key: dateKey, label: dateLabel, warnings: [] });
      const dg = group.dates.get(dateKey);
      let messages = String(src.message || '').split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);
      if (!messages.length) messages = [''];
      for (const message of messages) dg.warnings.push({ insurance: safeText(src.payer), mark: warningRequiresMark(message) ? '○' : '', message });
    }
    const result = [];
    for (const group of grouped.values()) {
      group.rows = [];
      for (const dg of group.dates.values()) {
        for (const w of dg.warnings) {
          const insuranceLines = warningWrap(w.insurance, W_COLS[3] - 10);
          const messageLines = warningWrap(w.message, W_COLS[5] - 10);
          const height = Math.max(W_MIN_ROW, Math.max(insuranceLines.length, messageLines.length) * W_LEADING + W_PAD);
          group.rows.push({ patient_key: group.key, date_key: dg.key, no: group.no, patient_no: group.patient_no, date: dg.label,
            insurance_lines: insuranceLines, mark: w.mark, message_lines: messageLines, height });
        }
      }
      result.push(group);
    }
    return result;
  }
  function paginateWarningGroups(groups) {
    const available = W_TABLE_BOTTOM - W_TABLE_Y;
    const pages = []; let page = [], used = 0;
    for (const group of groups) {
      const groupHeight = group.rows.reduce((s, r) => s + r.height, 0);
      if (page.length && groupHeight <= available && used + groupHeight > available) { pages.push(page); page = []; used = 0; }
      for (const src of group.rows) {
        const pending = Object.assign({}, src);
        while (pending.message_lines.length || pending.insurance_lines.length) {
          let remaining = available - used;
          if (page.length && remaining < W_MIN_ROW) { pages.push(page); page = []; used = 0; remaining = available; }
          const maxLines = Math.max(1, Math.floor((remaining - W_PAD) / W_LEADING));
          const mChunk = pending.message_lines.slice(0, maxLines), iChunk = pending.insurance_lines.slice(0, maxLines);
          const chunkHeight = Math.max(W_MIN_ROW, Math.max(mChunk.length, iChunk.length, 1) * W_LEADING + W_PAD);
          if (page.length && chunkHeight > remaining) { pages.push(page); page = []; used = 0; continue; }
          page.push(Object.assign({}, pending, { message_lines: mChunk, insurance_lines: iChunk, height: chunkHeight }));
          used += chunkHeight;
          pending.message_lines = pending.message_lines.slice(maxLines);
          pending.insurance_lines = pending.insurance_lines.slice(maxLines);
          if (pending.message_lines.length || pending.insurance_lines.length) { pages.push(page); page = []; used = 0; }
        }
      }
    }
    if (page.length) pages.push(page);
    return pages.length ? pages : [[]];
  }
  function drawWarningHeader(pg, monthLabel, createdLabel) {
    warningDrawText(pg, PAGE_WIDTH / 2, 37.0, '要確認レセプト一覧', 19.0, { align: 'center' });
    warningDrawText(pg, 21.75, 47.0, '診療月 ' + monthLabel, 11.0);
    warningDrawText(pg, 573.0, 9.0, '作成日：' + createdLabel, 11.0, { align: 'right' });
    const pos = []; let off = W_TABLE_X;
    for (const w of W_COLS) { pos.push([off, w]); off += w; }
    const c = (i) => pos[i][0] + pos[i][1] / 2;
    const B = { bold: true, align: 'center' };
    warningDrawText(pg, c(0), 80.0, 'NO', 9.0, B);
    warningDrawText(pg, c(1), 80.0, '患者番号', 9.0, B);
    warningDrawText(pg, c(2), 74.0, 'カルテ', 7.3, B);
    warningDrawText(pg, c(2), 85.0, '日付', 7.3, B);
    warningDrawText(pg, c(3), 80.0, '保険', 9.0, B);
    warningDrawText(pg, c(4), 77.0, '保険・公費', 5.6, B);
    warningDrawText(pg, c(4), 86.0, '・未会計', 5.6, B);
    warningDrawText(pg, c(5), 80.0, 'チェック内容', 9.0, B);
  }
  function drawWarningTable(pg, rows) {
    const xs = [W_TABLE_X];
    for (const w of W_COLS) xs.push(xs[xs.length - 1] + w);
    const totalWidth = W_COLS.reduce((s, w) => s + w, 0);
    const totalHeight = rows.reduce((s, r) => s + r.height, 0);
    warningLine(pg, W_TABLE_X, W_TABLE_Y, W_TABLE_X + totalWidth, W_TABLE_Y, 0.6);
    for (const x of xs) warningLine(pg, x, W_TABLE_Y, x, W_TABLE_Y + totalHeight, 0.6);
    let y = W_TABLE_Y;
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      if (i === 0 || prev.patient_key !== row.patient_key) {
        warningUnderlinedRight(pg, xs[0] + W_COLS[0] - 5, y + 1.2, row.no, false);
        warningUnderlinedRight(pg, xs[1] + W_COLS[1] - 5, y + 1.2, row.patient_no);
      }
      if (i === 0 || prev.date_key !== row.date_key || prev.patient_key !== row.patient_key) {
        warningUnderlinedRight(pg, xs[2] + W_COLS[2] - 5, y + 1.2, row.date);
      }
      row.insurance_lines.forEach((v, li) => warningDrawText(pg, xs[3] + 5, y + 1.2 + li * W_LEADING, v, W_BODY));
      warningDrawText(pg, xs[4] + W_COLS[4] / 2, y + 1.2, row.mark, W_BODY, { align: 'center' });
      row.message_lines.forEach((v, li) => warningDrawText(pg, xs[5] + 5, y + 1.2 + li * W_LEADING, v, W_BODY));
      y += row.height;
      const next = rows[i + 1];
      let startX, width;
      if (!next || next.patient_key !== row.patient_key) { startX = W_TABLE_X; width = 1.05; }
      else if (next.date_key !== row.date_key) { startX = xs[2]; width = 1.05; }
      else { startX = xs[3]; width = 0.6; }
      warningLine(pg, startX, y, W_TABLE_X + totalWidth, y, width);
    });
  }
  /**
   * 要確認レセプト一覧のページ（SVG 文字列の配列）
   * @param {Array[]} warningRows  [請求先, 患者番号, 氏名, 診療日（複数は改行区切り）, 確認内容（複数は改行区切り）] の配列（基準版の pdf_rows と同じ形）
   * @param {string}  claimMonth   診療月（'202609' / '2026-09-01' など）
   * @param {string}  createdDate  作成日時（'202609241030' / '20260924' など。日付だけなら今の時刻）
   * @param {Array[]} [formatRows] レセ電の形式点検の行 [請求先, フォルダ, 内容]（基準版では通常空）
   */
  function buildWarningListPages(warningRows, claimMonth, createdDate, formatRows) {
    need();
    const groups = prepareWarningGroups(normalizeWarningRows(warningRows, formatRows));
    const pages = paginateWarningGroups(groups);
    const monthLabel = formatClaimMonth(claimMonth), createdLabel = formatCreatedAt(createdDate);
    return pages.map((rows, i) => {
      const pg = new Page();
      drawWarningHeader(pg, monthLabel, createdLabel);
      drawWarningTable(pg, rows);
      warningDrawText(pg, PAGE_WIDTH / 2, 814.4, (i + 1) + ' / ' + pages.length, 12.0, { align: 'center' });
      return pg.toSVG();
    });
  }

  // ============================================================
  // 医療費請求書（連記式・愛知県。aichi_renki.py の group_renki_pages / _draw_page）
  // ============================================================
  const R_TABLE_X = [21.75, 40.52, 114.40, 212.34, 265.12, 303.82, 340.77, 414.37, 512.31];
  const R_TABLE_TOP = 184.49, R_HEADER_HEIGHT = 22.28, R_ROW_HEIGHT = 22.28;
  const RECEIPT_TEXT_GRAY = 0.2;
  const KAPPA = 0.5522847498;

  // 点検用レセプトと同じ振り分け（U+0100 未満は DejaVuSans）
  function receiptRuns(value) {
    const runs = [];
    for (const ch of Array.from(value)) {
      const font = cpOf(ch) < 256 ? FONT_LATIN : FONT_GOTHIC;
      if (runs.length && runs[runs.length - 1][0] === font) runs[runs.length - 1][1] += ch;
      else runs.push([font, ch]);
    }
    return runs;
  }
  const receiptTextWidth = (value, size) => receiptRuns(String(value)).reduce((s, [f, t]) => s + runWidth(f, t, size), 0);
  function drawText(pg, x, y, value, size, align) {
    const v = value !== null && value !== undefined ? String(value).replace(/[\r\n]/g, ' ') : '';
    if (!v) return;
    const width = receiptTextWidth(v, size);
    if (align === 'right') x -= width; else if (align === 'center') x -= width / 2;
    pg.runs(x, y + size, receiptRuns(v).map(([f, t]) => [f, t, runWidth(f, t, size)]), size, RECEIPT_TEXT_GRAY);
  }
  function rText(pg, x, y, value, size, width, align) {
    size = size === undefined || size === null ? 9.38 : size;
    const v = String(value === null || value === undefined || value === 0 || value === false ? '' : value);
    if (width) {
      const measured = receiptTextWidth(v, size);
      if (measured > width) size = size * width / measured;
      if (size < 5.5) throw new Error('連記式の文字が欄に収まりません。氏名・施設情報・備考を確認してください');
    }
    drawText(pg, x, y, v, size, align);
  }
  function rLine(pg, x0, y0, x1, y1, width) { pg.line(x0, y0, x1, y1, width === undefined ? 0.59 : width, 0); }
  function rRect(pg, x, y, w, h, lw) {
    lw = lw === undefined ? 0.59 : lw;
    pg.special('<path d="M' + num(x) + ' ' + num(y) + 'h' + num(w) + 'v' + num(h) + 'h' + num(-w) + 'Z" fill="none" stroke="#000000" stroke-width="' + num(lw) + '"/>',
      '0 0 0 RG\n' + n4(lw) + ' w\nn ' + n4(x) + ' ' + n4(PAGE_HEIGHT - y - h) + ' ' + n4(w) + ' ' + n4(h) + ' re S');
  }
  /** 楕円（基準版の circle / ellipse と同じ4本の曲線。cx, cy は上原点） */
  function rEllipse(pg, cx, cy, rx, ry, lw) {
    const Y = PAGE_HEIGHT - cy, kx = rx * KAPPA, ky = ry * KAPPA;
    const p = (a) => a.map(n4).join(' ');
    const ops = '0 0 0 RG\n' + n4(lw) + ' w\nn\n' + p([cx + rx, Y]) + ' m\n' +
      p([cx + rx, Y + ky, cx + kx, Y + ry, cx, Y + ry]) + ' c\n' +
      p([cx - kx, Y + ry, cx - rx, Y + ky, cx - rx, Y]) + ' c\n' +
      p([cx - rx, Y - ky, cx - kx, Y - ry, cx, Y - ry]) + ' c\n' +
      p([cx + kx, Y - ry, cx + rx, Y - ky, cx + rx, Y]) + ' c\nS';
    pg.special('<ellipse cx="' + num(cx) + '" cy="' + num(cy) + '" rx="' + num(rx) + '" ry="' + num(ry) + '" fill="none" stroke="#000000" stroke-width="' + num(lw) + '"/>', ops);
  }
  const rCircle = (pg, x, y, r) => rEllipse(pg, x, y, r, r, 0.59);
  function eraMonth(value) {
    const d = parseDate(value);
    return d ? '令和' + pad2(d.y - 2018) + '年' + d.m + '月分' : '';
  }
  function wrapped(value, width, size) {
    size = size || 5.86;
    const normalized = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) return [];
    const lines = [];
    for (const src of normalized.split('\n')) {
      let current = '';
      for (const ch of Array.from(src)) {
        if (current && receiptTextWidth(current + ch, size) > width) { lines.push(current); current = ch; }
        else current += ch;
      }
      if (current) lines.push(current); else if (src === '') lines.push('');
    }
    return lines;
  }
  const renkiIncluded = (item) => ('is_claim_included' in item ? item.is_claim_included : ['include', 'warning', 'resubmit'].includes(item.claim_status || 'include'));
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** 連記式のページ（市町村 × 入院・入院外ごと。25行で改ページ）。items は renki_entry / renki_header を持つ請求（基準版の prepare_renki_item の結果と同じ形） */
  function groupRenkiPages(items) {
    const documents = new Map(), seen = new Set(), errors = [];
    for (const item of items || []) {
      if (!renkiIncluded(item) || !item.renki_entry) continue;
      const row = Object.assign({}, item.renki_entry);
      const bid = row.billing_id;
      if (bid && seen.has(bid)) { errors.push('同じ会計が連記式に重複しています'); continue; }
      if (bid) seen.add(bid);
      const key = JSON.stringify([row.municipality_code, row.visit_type]);
      if (!documents.has(key)) documents.set(key, { header: item.renki_header, city: row.municipality_name, visit_type: row.visit_type, rows: new Map() });
      const doc = documents.get(key);
      if (!sameJson(doc.header, item.renki_header)) errors.push('連記式の請求年月日または施設情報が同じ請求内で一致しません');
      const rowKey = JSON.stringify(['patient_id', 'recipient_number', 'expense_type', 'service_month', 'insurer_number', 'insurance_symbol', 'insurance_number', 'branch_number', 'burden_ratio'].map((k) => row[k] === undefined ? null : row[k]));
      if (doc.rows.has(rowKey)) {
        const ex = doc.rows.get(rowKey);
        if (ex.patient_name !== row.patient_name || !sameJson(ex.remarks, row.remarks)) errors.push('同じ受給者の氏名または備考が月内で一致しません');
        ex.total_score += row.total_score;
        ex.municipal_amount = ex.municipal_amount !== null && ex.municipal_amount !== undefined && row.municipal_amount !== null && row.municipal_amount !== undefined ? ex.municipal_amount + row.municipal_amount : null;
      } else doc.rows.set(rowKey, row);
    }
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const pages = [];
    for (const doc of documents.values()) {
      const rows = Array.from(doc.rows.values()).sort((a, b) => cmp(a.recipient_number, b.recipient_number) || cmp(a.service_month, b.service_month) || cmp(a.patient_id, b.patient_id));
      const has = (r) => r.municipal_amount !== null && r.municipal_amount !== undefined;
      const totalAmount = rows.every(has) ? rows.reduce((s, r) => s + r.municipal_amount, 0) : null;
      const pageCount = Math.floor((rows.length + 24) / 25);
      for (let off = 0; off < rows.length; off += 25) {
        pages.push({ header: doc.header, city: doc.city, visit_type: doc.visit_type, rows: rows.slice(off, off + 25), total_count: rows.length, total_amount: totalAmount,
          page_number: off / 25 + 1, page_count: pageCount });
      }
    }
    return { pages, errors: Array.from(new Set(errors)) };
  }
  function drawRenkiPage(pg, page, inspection, sample) {
    const header = page.header, facility = header.facility || {};
    const claimDate = parseDate(header.claim_date), month = parseDate(header.claim_month);
    if (inspection || sample) rText(pg, 22, 8, sample ? '架空データ・提出不可' : '点検用・提出不可', 7.62);
    rText(pg, 277, 23.5, '医 療 費 請 求 書', 14.07, null, 'center');
    if (claimDate) rText(pg, 364, 34.5, '令和 ' + pad2(claimDate.y - 2018) + ' 年 ' + claimDate.m + ' 月 ' + claimDate.d + ' 日', 9.38, 187);
    for (const [x, label] of [[22, '国保特例'], [38.5, '社保・国保組合用']]) {
      rRect(pg, x, 55.5, 12.3, 105);
      const chars = Array.from(label);
      const spacing = chars.length === 4 ? 25.8 : 12.9;
      chars.forEach((ch, i) => rText(pg, x + 1.6, 56.5 + spacing * i, ch, 9.38));
    }
    [['子', '子 ど も'], ['障', '障 害 者'], ['母', '母子・父子家庭'], ['精', '精 神 障 害']].forEach(([symbol, label], i) => {
      const y = 51 + i * 17.59;
      rCircle(pg, 75.6, y + 6, 7.05);
      rText(pg, 75.6, y, symbol, 9.38, null, 'center');
      rText(pg, 89.2, y, label);
    });
    const xs = [306.5, 351, 381.8, 472.7, 504.1, 535.2];
    rRect(pg, xs[0], 50.2, xs[xs.length - 1] - xs[0], 39);
    rLine(pg, xs[0], 69.5, xs[xs.length - 1], 69.5);
    xs.slice(1, -1).forEach((x) => rLine(pg, x, 50.2, x, 89.2));
    rLine(pg, 328.2, 69.5, 328.2, 89.2);
    ['県番号', '表別', '医療機関番号', '併設', '割引'].forEach((label, i) => rText(pg, (xs[i] + xs[i + 1]) / 2, 54.3, label, 9.38, null, 'center'));
    rText(pg, 317.3, 74.2, '2', null, null, 'center');
    rText(pg, 339.5, 74.2, '3', null, null, 'center');
    rText(pg, 366.4, 74.2, '1', null, null, 'center');
    rText(pg, 427.2, 74.2, header.institution_number, 9.38, 87, 'center');
    [['医療機関所在地', 'address'], ['名　　　　　称', 'name'], ['開 設 者 氏 名', 'founder_name'], ['電　　　　　話', 'phone']].forEach(([label, key], i) => {
      rText(pg, 306.2, 94 + i * 12.9, label, 7.62);
      rText(pg, 370.7, 93.3 + i * 12.9, facility[key], 8.21, 185);
    });
    rText(pg, 294, 121.3, page.city + '　長様', 14.07, 174, 'right');
    rRect(pg, 123, 144.3, 17.6, 19.4);
    rRect(pg, 155.7, 144.3, 17.6, 19.4, 1.76);
    rText(pg, 101.5, 148, '令和', 9.38);
    rText(pg, 132, 148, month ? pad2(month.y - 2018) : '', 9.38, null, 'center');
    rText(pg, 143.7, 148, '年');
    rText(pg, 164.5, 148, month ? String(month.m) : '', null, null, 'center');
    rText(pg, 176.6, 148, '月分を下記の通り請求します。');
    rText(pg, 75.4, 153.2, page.visit_type === 'inpatient' ? '入院' : '入院外', null, null, 'center');
    // pdf.ellipse(55, H-174, 95.5, H-143.5)（線の色は直前の枠と同じ黒・太さ 0.59）
    rEllipse(pg, (55 + 95.5) / 2, (174 + 143.5) / 2, (95.5 - 55) / 2, (174 - 143.5) / 2, 0.59);
    rText(pg, 101.5, 168, '金額');
    rText(pg, 239, 168, page.total_amount !== null && page.total_amount !== undefined ? comma(page.total_amount) : '要確認', null, 112, 'right');
    rText(pg, 249.3, 168, '円');
    rText(pg, 276.3, 168, '請求総件数');
    rText(pg, 446, 168, String(page.total_count), null, null, 'right');
    rText(pg, 452.2, 168, '件分');
    // 1つの市町村に複数枚になるときだけ枚数を書く（公式様式の決まり）
    if (page.page_count > 1) {
      rText(pg, 512.3, 153.2, String(page.page_count), null, null, 'right');
      rText(pg, 512.3, 167, String(page.page_number), null, null, 'right');
    }
    rText(pg, 517.9, 153.2, '枚の内');
    rText(pg, 517.9, 167, '枚');
    rLine(pg, 101.5, 180.5, 260, 180.5);
    rLine(pg, 276.3, 180.5, 472, 180.5);
    const y0 = R_TABLE_TOP, bodyTop = R_TABLE_TOP + R_HEADER_HEIGHT, bottom = bodyTop + R_ROW_HEIGHT * 25;
    for (const x of R_TABLE_X) rLine(pg, x, y0, x, x === R_TABLE_X[1] ? bottom : bottom + R_ROW_HEIGHT);
    for (let i = 0; i < 27; i++) { const y = y0 + R_ROW_HEIGHT * i; rLine(pg, R_TABLE_X[0], y, R_TABLE_X[R_TABLE_X.length - 1], y); }
    rLine(pg, R_TABLE_X[0], bottom + R_ROW_HEIGHT, R_TABLE_X[R_TABLE_X.length - 1], bottom + R_ROW_HEIGHT);
    for (const [l, r] of [[R_TABLE_X[1], R_TABLE_X[2]], [R_TABLE_X[3], R_TABLE_X[4]], [R_TABLE_X[5], R_TABLE_X[6]]]) rRect(pg, l, y0, r - l, bottom - y0, 1.76);
    ['番\n号', '受給者証番号', '氏名', '総点数', '結 精\n点 数', '請求\n割合', '市町村負担額', '備　考'].forEach((title, col) => {
      const multi = title.includes('\n');
      title.split('\n').forEach((ln, i) => rText(pg, (R_TABLE_X[col] + R_TABLE_X[col + 1]) / 2, y0 + (multi ? 3 : 6) + i * 8, ln, multi ? 7.62 : 9.38, null, 'center'));
    });
    for (let index = 0; index < 25; index++) {
      const y = bodyTop + index * R_ROW_HEIGHT + 6;
      rText(pg, 31.2, y, String(index + 1), null, null, 'center');
      if (index >= page.rows.length) continue;
      const row = page.rows[index];
      rText(pg, 42.3, y, row.recipient_number, null, 69);
      rText(pg, 116, y + 0.6, row.patient_name, 8.21, 93);
      rText(pg, 263, y, comma(row.total_score), null, 47, 'right');
      rText(pg, 341 + 71, y, row.municipal_amount !== null && row.municipal_amount !== undefined ? comma(row.municipal_amount) : '要確認', null, 69, 'right');
      rText(pg, 311, y, '2・1');
      if (row.burden_ratio === 10 || row.burden_ratio === 20) {
        const x = 311 + (row.burden_ratio === 10 ? receiptTextWidth('2・', 9.38) : 0);
        rCircle(pg, x + receiptTextWidth('2', 9.38) / 2, y + 5.5, 4.1);
      }
      const remarks = wrapped((row.remarks || []).join(' / '), 94);
      if (remarks.length > 3) throw new Error('連記式の備考が3行を超えています。点検してから再作成してください');
      remarks.forEach((v, i) => rText(pg, 416, y - 2 + i * 6.4, v, 5.86));
    }
    rText(pg, 110, bottom + 7, '計', null, null, 'right');
    rText(pg, 210, bottom + 8, String(page.rows.length), null, null, 'right');
    rText(pg, 209, bottom + 1, '件', 4.69, null, 'right');
    rText(pg, 263, bottom + 8, comma(page.rows.reduce((s, r) => s + r.total_score, 0)), null, 47, 'right');
    rText(pg, 263, bottom + 1, '点', 4.69, null, 'right');
    const has = (r) => r.municipal_amount !== null && r.municipal_amount !== undefined;
    const pageAmount = page.rows.every(has) ? page.rows.reduce((s, r) => s + r.municipal_amount, 0) : null;
    rText(pg, 412, bottom + 8, pageAmount !== null ? comma(pageAmount) : '要確認', null, 69, 'right');
    rText(pg, 412, bottom + 1, '円', 4.69, null, 'right');
    const notes = ['※ 特例退職被保険者はその旨（特退等）', '国保特例の場合は特例と表示し保険者名', '加入保険が国保組合の場合は組合名', '月遅れ・返戻分の再請求は診療月'];
    notes.forEach((note, col) => {
      Array.from(note).forEach((ch, i) => {
        const x = 555 - col * 11, y = 191 + i * 6.2, size = 4.69;
        if (ch === '（' || ch === '）') {
          // 縦書き用の字形が無い書体でも描けるよう、同じ字形を 90° 回して置く（基準版と同じ）
          const cx = x + size / 2, cyTop = y + size / 2, cy = PAGE_HEIGHT - cyTop;
          pg.special('', 'q\n0 -1 1 0 ' + n4(cx - cy) + ' ' + n4(cy + cx) + ' cm');
          pg.parts.push('<g transform="rotate(90 ' + num(cx) + ' ' + num(cyTop) + ')">');
          rText(pg, x, y, ch, size);
          pg.parts.push('</g>');
          pg.special('', 'Q');
        } else rText(pg, x, y, ch, size);
      });
    });
    const H = PAGE_HEIGHT;
    pg.special('<path d="M531 334C531 340 532 340 539 340C542 340 544 340 544 345C544 340 546 340 549 340C556 340 557 340 557 334" fill="none" stroke="#000000" stroke-width="1.76"/>',
      '0 0 0 RG\n1.76 w\nn ' + [531, H - 334].map(n4).join(' ') + ' m ' + [531, H - 340, 532, H - 340, 539, H - 340].map(n4).join(' ') + ' c ' +
      [542, H - 340, 544, H - 340, 544, H - 345].map(n4).join(' ') + ' c ' + [544, H - 340, 546, H - 340, 549, H - 340].map(n4).join(' ') + ' c ' +
      [556, H - 340, 557, H - 340, 557, H - 334].map(n4).join(' ') + ' c\nS');
    Array.from('を必ず備考欄に記入してください。').forEach((ch, i) => rText(pg, 542, 363 + i * 10.4, ch, 9.38));
    Array.from('但し、社会保険及び国保組合のレセプトが返戻されても点数、割合が変わらない場合は医療費請求書で再請求の必要はありません。').forEach((ch, i) => rText(pg, 515, 191 + i * 5.55, ch, 4.69));
    rText(pg, 570, bottom + R_ROW_HEIGHT + 5, page.visit_type === 'inpatient' ? '医療費（入院）' : '医療費（入院外）', 7.62, null, 'right');
  }
  /**
   * 医療費請求書（連記式）のページ。対象が無ければ pages は空。
   * @param {object[]} items  renki_entry / renki_header を持つ請求（prepareRenkiItem の結果）
   * @param {object}   [opts] { inspection: 点検用（既定 true。「点検用・提出不可」を入れる）, sample }
   * @returns {{pages: string[], errors: string[]}}
   */
  function buildRenkiPages(items, opts) {
    opts = opts || {};
    need();
    const inspection = opts.inspection !== false;
    const g = groupRenkiPages(items);
    const errors = [];
    (items || []).forEach((it) => { if (renkiIncluded(it) && it.separate_public_expenses && it.separate_public_expenses.length) (it.renki_errors || []).forEach((e) => { if (!errors.includes(e)) errors.push(e); }); });
    g.errors.forEach((e) => { if (!errors.includes(e)) errors.push(e); });
    if (errors.length && !inspection && !opts.sample) throw new Error(errors.join(' / '));
    const pages = g.pages.map((page) => { const pg = new Page(); drawRenkiPage(pg, page, inspection, opts.sample); return pg.toSVG(); });
    return { pages, errors };
  }

  // ---- 連記式の1行（aichi_renki.py の prepare_renki_item を写したもの。公費の判定そのものは呼ぶ側で済ませておく） ----
  const SUPPORTED = new Set(['aichi_child', 'aichi_disabled', 'aichi_single_parent', 'aichi_mental_all', 'aichi_mental_outpatient']);
  const LIMIT_REMARKS = { 'ア': '26区ア', 'イ': '27区イ', 'ウ': '28区ウ', 'エ': '29区エ', 'オ': '30区オ' };
  function baseLimitCategory(value) {
    let t = String(value || '').trim().replace(/ /g, '');
    if (t.startsWith('区分')) t = t.slice(2); else if (t.startsWith('区')) t = t.slice(1);
    return t.replace(/[（(](?:多数該当|公費併用)[）)]$/, '');
  }
  function recipientNumber(value, city) {
    let v = String(value || '').trim();
    if (city === '名古屋市') { if (v.startsWith('名')) v = v.slice(1); v = v.replace(/-/g, '').replace(/－/g, ''); }
    return v;
  }
  const isoOf = (p) => p ? p.y + '-' + pad2(p.m) + '-' + pad2(p.d) : '';
  /**
   * item（基準版の請求の形: patient_id, patient_no, patient_name, billing_id, billing_date, visit_type, payer_group, insurer_number, insurer_name,
   *   symbol, insurance_number, branch_number, burden_ratio, total_score, total_amount, public_expense_amount, patient_burden, insurance_amount,
   *   insurance_limit_category, welfare_invoice_comments, separate_public_expenses[], selected_public_expenses[], receipt_claim_type, claim_status）
   * に renki_entry / renki_header / renki_errors を書き足す。
   */
  function prepareRenkiItem(item, facility, claimMonth, claimDate) {
    const expenses = item.separate_public_expenses || [];
    if (!expenses.length) return item;
    const errors = (item.public_expense_claim_warnings || []).slice();
    const expense = expenses[0];
    const city = String(expense.municipality_name || '').trim();
    const serviceDate = parseDate(item.billing_date), submissionDate = parseDate(claimDate), month = parseDate(claimMonth);
    let visit = String(item.visit_type || '').toLowerCase();
    if (['inpatient', 'admission', 'hospitalization', '入院'].includes(visit)) visit = 'inpatient';
    else if (['outpatient', 'initial', 'revisit', '初診', '再診', 'home', 'home_visit', 'visit', '外来', '訪問', '訪問診療', '在宅', 'emergency'].includes(visit)) visit = 'outpatient';
    else { errors.push('連記式: 入院・入院外の区分を確認してください'); visit = 'outpatient'; }
    if (expenses.length !== 1 || (item.selected_public_expenses || []).length !== 1) errors.push('連記式: 複数公費の対象点数・負担額配分を確認してください');
    if (!SUPPORTED.has(expense.expense_type)) errors.push('連記式: この公費は通常の医療費請求書の対象として確認できません');
    if (!city || !expense.municipality_code) errors.push('連記式: 請求先市町村が未設定です');
    const number = recipientNumber(expense.recipient_number, city);
    if (!/^[0-9]{1,12}$/.test(number)) errors.push('連記式: 医療証の受給者番号を確認してください（自治体により桁数が異なります）');
    for (const [field, label] of [['name', '医療機関名'], ['address', '医療機関所在地'], ['phone', '電話番号'], ['founder_name', '開設者氏名']]) {
      if (!String(facility[field] || '').trim()) errors.push('連記式: 施設基本情報の' + label + 'を登録してください');
    }
    let institution = String(facility.medical_institution_code || '');
    if (institution.length === 10) institution = institution.slice(-7);
    if (!/^[0-9]{7}$/.test(institution)) errors.push('連記式: 7桁の医療機関番号を確認してください');
    if (!serviceDate || !month || !submissionDate) errors.push('連記式: 診療日・診療月・請求年月日を確認してください');
    const ym = (p) => p.y * 12 + p.m;
    if (serviceDate && month && ym(serviceDate) > ym(month)) errors.push('連記式: 対象月より後の診療が含まれています');
    if (['resubmit', 'resubmit_paper'].includes(item.receipt_claim_type) || item.claim_status === 'resubmit') errors.push('連記式: 保険の返戻だけでは公費再請求は不要な場合があります。公費の返戻・訂正の要否を確認してください');
    const remarks = [];
    if (serviceDate && month && ym(serviceDate) !== ym(month)) remarks.push(eraMonth(isoOf(serviceDate)));
    const insurerName = String(item.insurer_name || '').trim();
    const association = insurerName.includes('国保組合') || insurerName.includes('国民健康保険組合');
    if (association) remarks.push(insurerName);
    else if (item.payer_group === 'kokuho') {
      if (insurerName) remarks.push('特例 ' + insurerName); else errors.push('連記式: 国保特例の備考に記載する保険者名を確認してください');
    }
    if (['63', '72', '73', '74', '75'].includes(String(item.insurer_number || '').slice(0, 2))) remarks.push('特退');
    const limit = baseLimitCategory(item.insurance_limit_category);
    if (LIMIT_REMARKS[limit]) remarks.push(LIMIT_REMARKS[limit]); else if (limit) errors.push('連記式: 限度額認定区分の備考表記を確認してください');
    for (const c of item.welfare_invoice_comments || []) {
      const content = c && typeof c === 'object' ? String(c.content || '').trim() : '';
      if (content && !remarks.includes(content)) remarks.push(content);
    }
    if (wrapped(remarks.join(' / '), 94).length > 3) errors.push('連記式: 備考欄が3行を超えます。福祉請求書備考欄コメントを短くしてください');
    let score = 0, ratio = 0, amount = null;
    const ints = ['total_score', 'burden_ratio', 'total_amount', 'public_expense_amount', 'patient_burden', 'insurance_amount'].map((k) => item[k]);
    if (ints.every((v) => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v)))) {
      const [s, r, total, pub, patient, ins] = ints.map(Number);
      score = s; ratio = r;
      if (s < 0 || ![10, 20, 30].includes(r) || total !== s * 10 || Math.min(pub, patient, ins) < 0 || pub + patient + ins !== total) {
        score = s; ratio = r;
        errors.push('連記式: 総点数・負担割合・会計の負担額に不足または不整合があります');
      } else {
        const exact = Math.floor(s * r / 10);
        if (patient === 0 && pub === exact) amount = exact;
        else errors.push('連記式: 市町村負担額が総点数×請求割合と一致しません。上限額・他公費・端数処理の根拠を確認してください');
      }
    } else errors.push('連記式: 総点数・負担割合・会計の負担額に不足または不整合があります');
    if (expense.expense_type === 'aichi_mental_outpatient') errors.push('連記式: 精神科対象の点数範囲を確認してください（総点数から推測しません）');
    const entry = {
      patient_id: String(item.patient_id || item.patient_no || ''), patient_name: String(item.patient_name || ''), recipient_number: number,
      municipality_code: expense.municipality_code, municipality_name: city, expense_type: expense.expense_type, visit_type: visit,
      service_month: serviceDate ? serviceDate.y + '-' + pad2(serviceDate.m) + '-01' : '', insurer_number: item.insurer_number, insurance_symbol: item.symbol,
      insurance_number: item.insurance_number, branch_number: item.branch_number, burden_ratio: ratio, total_score: score, municipal_amount: amount,
      tuberculosis_score: null, remarks, billing_id: item.billing_id,
    };
    if (!entry.patient_id || !entry.patient_name) errors.push('連記式: 患者識別情報または氏名がありません');
    item.renki_entry = entry;
    item.renki_header = { claim_month: isoOf(month), claim_date: isoOf(submissionDate),
      facility: { name: facility.name, address: facility.address, phone: facility.phone, founder_name: facility.founder_name }, institution_number: institution };
    item.renki_errors = Array.from(new Set(errors));
    return item;
  }

  /** 空のページ（基準版の blank_submission_pdf と同じく何も描かない A4 1枚） */
  function buildBlankPage() { return new Page().toSVG(); }

  // ============================================================
  // PDF にする（RezeptFormPdf で PDF にし、目印の線を基準版と同じ描画命令に置き換える）
  // ============================================================
  function pdfLib(opts) {
    const P = (opts && opts.pdf) || (typeof RezeptFormPdf !== 'undefined' ? RezeptFormPdf : null);   // eslint-disable-line no-undef
    if (!P) throw new Error('PDF にする部品（rezept_form_pdf.js）がありません');
    return P;
  }
  function pageOps(svg) {
    const m = /<desc class="rz-pdfops">([\s\S]*?)<\/desc>/.exec(svg);
    if (!m) return [];
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); } catch (e) { return null; }
  }
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
  const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };
  /** 無圧縮で作った PDF の目印を置き換え、ストリームを圧縮し直して書き出す */
  async function injectOps(raw, opsByPage) {
    const s = latin1(raw);
    const head = s.slice(0, s.indexOf('1 0 obj\n'));
    const objs = [];
    const re = /(\d+) 0 obj\n/g;
    let m, pos = head.length;
    re.lastIndex = pos;
    while ((m = re.exec(s)) && m.index === pos) {
      const id = +m[1], start = re.lastIndex;
      let body, next;
      const si = s.indexOf('>>\nstream\n', start), ei = s.indexOf('\nendobj\n', start);
      if (si !== -1 && si < ei) {
        const dict = s.slice(start, si + 2);
        const len = +/\/Length (\d+)/.exec(dict)[1];
        const ds = si + 10;
        body = { dict, data: s.slice(ds, ds + len) };
        next = s.indexOf('\nendobj\n', ds + len) + 8;
      } else { body = { text: s.slice(start, ei) }; next = ei + 8; }
      objs.push({ id, body });
      pos = next; re.lastIndex = pos;
    }
    const tail = s.slice(s.indexOf('trailer\n', pos));
    // ページ → 内容ストリームの番号
    const contentOf = new Map();
    let pageNo = 0;
    for (const o of objs) {
      if (o.body.text && /\/Type \/Page /.test(o.body.text)) { const c = /\/Contents (\d+) 0 R/.exec(o.body.text); if (c) contentOf.set(+c[1], pageNo); pageNo++; }
    }
    const markRe = new RegExp('^0 G ' + String(MARK_WIDTH).replace('.', '\\.') + ' w -(9\\d{3,}) 842 m -9\\d{3,} 842 l S$', 'gm');
    for (const o of objs) {
      if (!o.body.dict || !contentOf.has(o.id)) continue;
      const ops = opsByPage[contentOf.get(o.id)] || [];
      o.body.data = o.body.data.replace(markRe, (all, n) => { const k = +n - 9000; return ops[k] !== undefined ? ops[k] : ''; });
    }
    // 書き出し（rezept_form_pdf.js と同じ形。ストリームは deflate）
    const chunks = []; let length = 0;
    const push = (u) => { chunks.push(u); length += u.length; };
    push(bytesOf(head));
    const offsets = [];
    for (const o of objs) {
      offsets.push(length);
      push(bytesOf(o.id + ' 0 obj\n'));
      if (o.body.dict) {
        const data = bytesOf(o.body.data);
        const z = await deflate(data);
        const extra = (/\/Length1 \d+/.exec(o.body.dict) || [''])[0];
        const bodyBytes = z || data;
        push(bytesOf('<< ' + (z ? '/Filter /FlateDecode ' : '') + '/Length ' + bodyBytes.length + (extra ? ' ' + extra : '') + ' >>\nstream\n'));
        push(bodyBytes);
        push(bytesOf('\nendstream'));
      } else push(bytesOf(o.body.text));
      push(bytesOf('\nendobj\n'));
    }
    const xrefAt = length;
    let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach((off) => { xref += String(off).padStart(10, '0') + ' 00000 n \n'; });
    push(bytesOf(xref + tail.replace(/startxref\n\d+/, 'startxref\n' + xrefAt)));
    const all = new Uint8Array(length); let p = 0;
    chunks.forEach((c) => { all.set(c, p); p += c.length; });
    return all;
  }
  /** SVG のページ → PDF（Uint8Array） */
  async function toPdfBytes(pages, opts) {
    opts = Object.assign({}, opts || {});
    const P = pdfLib(opts);
    const ops = pages.map(pageOps);
    if (!ops.some((l) => l.length)) return P.bytesFromSvgPages(pages, opts);
    const raw = await P.bytesFromSvgPages(pages, Object.assign({}, opts, { compress: false }));
    return injectOps(raw, ops);
  }
  /** SVG のページ → PDF（Blob） */
  async function toPdf(pages, opts) { return new Blob([await toPdfBytes(pages, opts)], { type: 'application/pdf' }); }

  return {
    PAGE_WIDTH, PAGE_HEIGHT,
    ready,
    buildWarningListPages,
    buildRenkiPages,
    prepareRenkiItem,
    buildBlankPage,
    toPdf,
    toPdfBytes,
    // 検証用
    _internal: { warningTextWidth, receiptTextWidth, groupRenkiPages, formatCreatedAt },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReceiptReviewSvg;
