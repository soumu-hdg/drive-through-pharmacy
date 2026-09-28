// ===== 点検用レセプト様式（PDF 化） rezept_form_pdf.js =====
// RezeptFormSvg（rezept_form_svg.js）が作る SVG のページ（文字列の配列）を、そのまま A4 縦（595×842pt）の PDF にする。
//   ・SVG に出ているのは「塗りつぶし矩形（罫線）」「1文字ずつ位置を決めた文字」「軸に平行でない線（様式には無い）」の3種類だけなので、
//     それを読み取って PDF の描画命令に写す（ブラウザの印刷を通さないので、座標・文字の大きさが丸められない）。
//     SVG の座標は上原点（y は下向き）、PDF は下原点なので y だけ 842 から引く。数値の桁の書き方も基準版と同じにする。
//   ・文字は SVG では1文字ずつ置いてあるが、PDF では基準版と同じく「1回の draw_text = 1つの並び（Tm＋字形の連続）」に戻す。
//     閲覧ソフト（pdfium 等）は並びの中の文字位置を送り幅（W）から決めるので、こうすると基準版の PDF と同じ画素に描かれる。
//   ・文字は基準版と同じ IPAゴシック（fonts/ipag.ttf）と DejaVuSans（fonts/DejaVuSans.ttf）を PDF に埋め込む。
//     使った文字の字形だけを残した書体（サブセット）にするので、閲覧側に書体が無くても同じに見え、ファイルも小さい。
//     埋め込む表は基準版（reportlab）のサブセットと同じ（head / hhea / maxp / hmtx / loca / glyf / name / OS/2 / cvt / fpgm / prep / post）。
//   ・文字は Type0（CIDFontType2・Identity-H・字形番号をそのまま文字コードにする）で置き、ToUnicode を付けて検索・コピーもできるようにする。
//   ・圧縮はブラウザ標準の CompressionStream('deflate')（無い環境では無圧縮で出す）。外部ライブラリは使わない。
// 依存: なし（入力は RezeptFormSvg.buildReceiptPages(...).pages / buildEmptyPage(...) の SVG 文字列）
// 使い方: const blob = await RezeptFormPdf.fromSvgPages(pagesSvg, { title: '点検用レセプト' });

// var で宣言する（読み込んだ窓の window.RezeptFormPdf として別の窓から参照できるように）
var RezeptFormPdf = (() => {
  'use strict';

  // ============================================================
  // 定数（rezept_form_svg.js と同じ値）
  // ============================================================
  const PAGE_WIDTH = 595.0;
  const PAGE_HEIGHT = 842.0;
  const UNIT = 0.59083601775;       // 元様式の CSS 1px（pt）。文字の大きさはこの整数倍
  const TEXT_EM = 100;              // SVG 上で文字を組む大きさ（変換行列で実寸に縮めている）
  const GLYPH_NUDGE = 0.002;        // SVG 側で文字の原点を右下へ寄せている量（PDF では寄せない）
  const FONT_GOTHIC = 'RzFormGothic';
  const FONT_LATIN = 'RzFormLatin';

  // 書体ファイルの場所: このファイルと同じ階層の fonts/（読み込まれた時点の script の URL から決める）
  const SCRIPT_BASE = (() => {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        return new URL('fonts/', document.currentScript.src).href;
      }
    } catch (e) { /* 下へ */ }
    return 'fonts/';
  })();

  // ============================================================
  // SVG の読み取り（rezept_form_svg.js の FormCanvas が書く形だけを読む）
  // ============================================================
  function xmlUnesc(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  }
  function attrs(src) {
    const a = {};
    src.replace(/([\w-]+)="([^"]*)"/g, (m, k, v) => { a[k] = v; return m; });
    return a;
  }
  function grayOf(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 0;
    return parseInt(m[1], 16) / 255;   // 様式は灰色だけ（R=G=B）
  }

  // SVG の文字は「100 の大きさ × 縮小率 k」で組んである。k は PDF 化の丸め対策でわずかに大きめなので、
  // 元の大きさ（UNIT の整数倍が基本）へ戻す。整数倍に当たらないときは丸め対策の分だけを戻す。
  function textSizeFromScale(k) {
    const px = k * TEXT_EM * 4 / 3 - 0.0002;
    const size = px * 3 / 4;
    const n = Math.round(size / UNIT);
    if (n > 0 && Math.abs(n * UNIT - size) < 0.006) return n * UNIT;
    return size;
  }

  /** SVG 1ページ → 描画命令の配列 {t:'rect'|'text'|'line', ...}（座標は上原点の pt） */
  function parseSvgPage(svg) {
    const ops = [];
    const re = /<(rect|text|line)\b([^>]*?)\/?>(?:([^<]*)<\/text>)?/g;
    let m;
    while ((m = re.exec(svg))) {
      const a = attrs(m[2]);
      if (m[1] === 'rect') {
        ops.push({ t: 'rect', x: +a.x, y: +a.y, w: +a.width, h: +a.height, gray: grayOf(a.fill) });
      } else if (m[1] === 'line') {
        ops.push({ t: 'line', x1: +a.x1, y1: +a.y1, x2: +a.x2, y2: +a.y2, width: +a['stroke-width'] || UNIT, gray: grayOf(a.stroke) });
      } else {
        const tm = /matrix\(([^)]*)\)/.exec(a.transform || '');
        if (!tm) continue;
        const v = tm[1].trim().split(/[\s,]+/).map(Number);
        const ch = xmlUnesc(m[3] || '');
        if (!ch) continue;
        ops.push({
          t: 'text', font: a['font-family'] === FONT_LATIN ? 'latin' : 'gothic', ch,
          x: v[4] - GLYPH_NUDGE, baseline: v[5] - GLYPH_NUDGE, size: textSizeFromScale(v[0]), gray: grayOf(a.fill),
        });
      }
    }
    return ops;
  }

  // ============================================================
  // TrueType の読み取りとサブセット化（字形番号は元のまま・使わない字形を空にする）
  // ============================================================
  function u16(d, o) { return (d[o] << 8) | d[o + 1]; }
  function i16(d, o) { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; }
  function u32(d, o) { return ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3]; }

  function parseFont(buf, psName) {
    const d = new Uint8Array(buf);
    const tables = {};
    const n = u16(d, 4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
      tables[tag] = { off: u32(d, o + 8), len: u32(d, o + 12) };
    }
    const T = (tag) => (tables[tag] ? d.subarray(tables[tag].off, tables[tag].off + tables[tag].len) : null);
    const head = T('head'), hhea = T('hhea'), maxp = T('maxp');
    const unitsPerEm = u16(head, 18);
    const numGlyphs = u16(maxp, 4);
    const longLoca = i16(head, 50) === 1;
    const locaT = T('loca');
    const loca = new Uint32Array(numGlyphs + 1);
    for (let g = 0; g <= numGlyphs; g++) loca[g] = longLoca ? u32(locaT, g * 4) : u16(locaT, g * 2) * 2;
    const numHM = u16(hhea, 34);
    const hmtx = T('hmtx');
    const advance = (g) => u16(hmtx, (g < numHM ? g : numHM - 1) * 4);
    return {
      d, tables, T, psName, unitsPerEm, numGlyphs, loca, advance,
      cmap: readCmap(T('cmap')),
      bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
      ascent: i16(hhea, 4), descent: i16(hhea, 6),
      capHeight: (() => { const os2 = T('OS/2'); return os2 && os2.length >= 90 && u16(os2, 0) >= 2 ? i16(os2, 88) : i16(hhea, 4); })(),
    };
  }

  /** cmap（Windows の Unicode 表: 形式 12 を優先、無ければ形式 4）→ 文字コード → 字形番号 */
  function readCmap(c) {
    const n = u16(c, 2);
    let best = null;
    for (let i = 0; i < n; i++) {
      const pid = u16(c, 4 + i * 8), eid = u16(c, 6 + i * 8), off = u32(c, 8 + i * 8);
      const fmt = u16(c, off);
      if (pid === 3 && eid === 10 && fmt === 12) { best = { fmt, off }; break; }
      if (((pid === 3 && eid === 1) || pid === 0) && fmt === 4 && !best) best = { fmt, off };
    }
    if (!best) return () => 0;
    const o = best.off;
    if (best.fmt === 12) {
      const groups = u32(c, o + 12);
      return (cp) => {
        let lo = 0, hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, g = o + 16 + mid * 12;
          const s = u32(c, g), e = u32(c, g + 4);
          if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return u32(c, g + 8) + (cp - s);
        }
        return 0;
      };
    }
    const segX2 = u16(c, o + 6);
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > u16(c, ends + i)) continue;
        const s = u16(c, starts + i);
        if (cp < s) return 0;
        const ro = u16(c, ranges + i);
        if (!ro) return (cp + i16(c, deltas + i)) & 0xffff;
        const gi = u16(c, ranges + i + ro + (cp - s) * 2);
        return gi ? (gi + i16(c, deltas + i)) & 0xffff : 0;
      }
      return 0;
    };
  }

  /** 複合字形が参照する部品の字形番号も集める */
  function addComponents(font, used) {
    const glyf = font.T('glyf');
    const stack = Array.from(used);
    while (stack.length) {
      const g = stack.pop();
      const s = font.loca[g], e = font.loca[g + 1];
      if (e <= s || i16(glyf, s) >= 0) continue;
      let p = s + 10;
      for (;;) {
        const flags = u16(glyf, p), comp = u16(glyf, p + 2);
        if (!used.has(comp)) { used.add(comp); stack.push(comp); }
        p += 4 + (flags & 0x0001 ? 4 : 2);
        if (flags & 0x0008) p += 2; else if (flags & 0x0040) p += 4; else if (flags & 0x0080) p += 8;
        if (!(flags & 0x0020)) break;
      }
    }
  }

  function checksum(b) {
    let sum = 0;
    for (let i = 0; i < b.length; i += 4) sum = (sum + (((b[i] << 24) >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0))) >>> 0;
    return sum;
  }

  /** 使った字形だけを残した TrueType（字形番号は元のまま。使わない字形は長さ 0） */
  function subsetFont(font, usedGids) {
    const used = new Set(usedGids); used.add(0);
    addComponents(font, used);
    const glyf = font.T('glyf');
    // glyf と loca（長形式）を作り直す
    let size = 0;
    const order = [];
    for (let g = 0; g < font.numGlyphs; g++) {
      if (used.has(g)) { const len = font.loca[g + 1] - font.loca[g]; order.push([g, len]); size += (len + 3) & ~3; }
    }
    const newGlyf = new Uint8Array(size);
    const newLoca = new Uint8Array((font.numGlyphs + 1) * 4);
    const lv = new DataView(newLoca.buffer);
    let pos = 0, k = 0;
    for (let g = 0; g < font.numGlyphs; g++) {
      lv.setUint32(g * 4, pos);
      if (k < order.length && order[k][0] === g) {
        const len = order[k][1];
        newGlyf.set(glyf.subarray(font.loca[g], font.loca[g] + len), pos);
        pos += (len + 3) & ~3; k++;
      }
    }
    lv.setUint32(font.numGlyphs * 4, pos);
    const head = font.T('head').slice();
    head[50] = 0; head[51] = 1;                         // indexToLocFormat = 1（長形式）
    head[8] = head[9] = head[10] = head[11] = 0;        // checkSumAdjustment は最後に入れる
    const out = { head, hhea: font.T('hhea'), maxp: font.T('maxp'), hmtx: font.T('hmtx'), loca: newLoca, glyf: newGlyf };
    ['name', 'OS/2', 'cvt ', 'fpgm', 'prep'].forEach((t) => { if (font.tables[t]) out[t] = font.T(t); });
    // post は形式 3（字形名なし）にする（基準版のサブセットと同じ）
    const post = new Uint8Array(32);
    post.set([0, 3, 0, 0]); post.set(font.T('post').subarray(4, 16), 4);
    out.post = post;
    // 表の並び（タグ順）と目次
    const tags = Object.keys(out).sort();
    const nT = tags.length;
    let es = 1, sel = 0; while (es * 2 <= nT) { es *= 2; sel++; }
    let total = 12 + nT * 16;
    tags.forEach((t) => { total += (out[t].length + 3) & ~3; });
    const f = new Uint8Array(total);
    const dv = new DataView(f.buffer);
    dv.setUint32(0, 0x00010000); dv.setUint16(4, nT); dv.setUint16(6, es * 16); dv.setUint16(8, sel); dv.setUint16(10, nT * 16 - es * 16);
    let off = 12 + nT * 16, headOff = 0;
    tags.forEach((t, i) => {
      const b = out[t];
      for (let j = 0; j < 4; j++) f[12 + i * 16 + j] = t.charCodeAt(j);
      dv.setUint32(12 + i * 16 + 4, checksum(b));
      dv.setUint32(12 + i * 16 + 8, off);
      dv.setUint32(12 + i * 16 + 12, b.length);
      f.set(b, off);
      if (t === 'head') headOff = off;
      off += (b.length + 3) & ~3;
    });
    dv.setUint32(headOff + 8, (0xB1B0AFBA - checksum(f)) >>> 0);
    return f;
  }

  // ============================================================
  // 書体の読み込み（初回だけ。2回目以降は同じものを使う）
  // ============================================================
  let _fontsPromise = null;
  function loadFonts(opts) {
    opts = opts || {};
    if (opts.fonts) {   // 検証用: 書体の中身（ArrayBuffer）を直接渡す
      return Promise.resolve({ gothic: parseFont(opts.fonts.gothic, 'IPAGothic'), latin: parseFont(opts.fonts.latin, 'DejaVuSans') });
    }
    if (!_fontsPromise) {
      const base = opts.fontBase || SCRIPT_BASE;
      const get = (name) => fetch(base + name).then((r) => { if (!r.ok) throw new Error('書体を読めません: ' + name + '（' + r.status + '）'); return r.arrayBuffer(); });
      _fontsPromise = Promise.all([get('ipag.ttf'), get('DejaVuSans.ttf')])
        .then(([g, l]) => ({ gothic: parseFont(g, 'IPAGothic'), latin: parseFont(l, 'DejaVuSans') }));
      _fontsPromise.catch(() => { _fontsPromise = null; });   // 失敗したら次回やり直す
    }
    return _fontsPromise;
  }

  // ============================================================
  // PDF の組み立て
  // ============================================================
  const enc = new TextEncoder();
  // 数値の書き方は基準版（reportlab の fp_str）と同じ: 有効数字およそ7桁（小数の桁数 = 6 − 整数部の桁数＋1）、末尾の 0 は落とす
  function n4(v) {
    if (!isFinite(v) || Math.abs(v) < 1e-9) return '0';
    const places = Math.min(10, Math.max(0, 6 - Math.floor(Math.log10(Math.abs(v)))));
    let s = v.toFixed(places);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function hex4(v) { return v.toString(16).toUpperCase().padStart(4, '0'); }
  function utf16Hex(s) {
    let h = 'FEFF';
    for (let i = 0; i < s.length; i++) h += hex4(s.charCodeAt(i));
    return '<' + h + '>';
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  /** ToUnicode（字形番号 → 文字） */
  function toUnicodeCMap(map) {
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    let body = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      body += chunk.length + ' beginbfchar\n';
      chunk.forEach(([gid, ch]) => {
        let u = '';
        for (let j = 0; j < ch.length; j++) u += hex4(ch.charCodeAt(j));
        body += '<' + hex4(gid) + '> <' + u + '>\n';
      });
      body += 'endbfchar\n';
    }
    return body + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  }

  /**
   * SVG のページ（文字列の配列）→ PDF の Blob（application/pdf）。1ページ = A4 縦 1枚。
   * @param {string[]} pagesSvg  RezeptFormSvg.buildReceiptPages(...).pages / buildEmptyPage(...) の戻り値
   * @param {object}   [options] {title?: 文書の題名, fontBase?: 書体のある場所（既定: このファイルの隣の fonts/）}
   * @returns {Promise<Blob>}
   */
  async function fromSvgPages(pagesSvg, options) {
    const bytes = await bytesFromSvgPages(pagesSvg, options);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /** fromSvgPages と同じ PDF を Uint8Array で返す */
  async function bytesFromSvgPages(pagesSvg, options) {
    options = options || {};
    const pages = (Array.isArray(pagesSvg) ? pagesSvg : [pagesSvg]).filter(Boolean);
    if (!pages.length) throw new Error('PDF にするページがありません');
    const fonts = await loadFonts(options);
    const pageOps = pages.map(parseSvgPage);

    // 使った字形を集める（書体ごと）
    const use = { gothic: new Map(), latin: new Map() };   // 字形番号 → 文字
    const gidCache = { gothic: new Map(), latin: new Map() };
    const gidOf = (font, ch) => {
      let g = gidCache[font].get(ch);
      if (g === undefined) { g = fonts[font].cmap(ch.codePointAt(0)); gidCache[font].set(ch, g); }
      return g;
    };
    const useGlyph = (font, ch) => { const g = gidOf(font, ch); if (!use[font].has(g)) use[font].set(g, ch); return g; };
    const adv = (font, g, size) => fonts[font].advance(g) * 1000 / fonts[font].unitsPerEm * size / 1000;

    // 1文字ずつの文字を、基準版の「1回の draw_text（textOut の連続）」と同じ並びにまとめ直す。
    //   SVG は空白を描かずに送りだけ進めているので、前の文字の送り幅の先に次の文字が無ければ、その隙間を空白（半角・全角）で埋める。
    //   同じ並びは1つの Tm から字形を続けて置く（閲覧ソフトが送り幅から位置を決めるので、基準版の PDF と同じ描かれ方になる）。
    //   run = {x, baseline, size, gray, segs: [{font, gids: []}]}
    const SPACE_FILL = [['latin', ' '], ['gothic', '\u3000']];   // 半角空白・全角空白（全角は \u 表記にして、読み込む側の文字コードに左右されないようにする）
    function toRuns(ops) {
      const outOps = [];
      let run = null, pen = 0;
      const pushGlyph = (font, g) => {
        const last = run.segs[run.segs.length - 1];
        if (last && last.font === font) last.gids.push(g); else run.segs.push({ font, gids: [g] });
        pen += adv(font, g, run.size);
      };
      for (const o of ops) {
        if (o.t !== 'text') { run = null; outOps.push(o); continue; }
        const g = useGlyph(o.font, o.ch);
        let joined = false;
        if (run && run.baseline === o.baseline && run.size === o.size && run.gray === o.gray) {
          const gap = o.x - pen;
          if (Math.abs(gap) < 1e-4) joined = true;
          else if (gap > 0) {
            for (const [sf, sc] of SPACE_FILL) {
              const sg = gidOf(sf, sc), sw = adv(sf, sg, o.size);
              const k = Math.round(gap / sw);
              if (k >= 1 && k <= 40 && Math.abs(gap - k * sw) < 1e-4) {
                useGlyph(sf, sc);
                for (let i = 0; i < k; i++) pushGlyph(sf, sg);
                joined = true;
                break;
              }
            }
          }
        }
        if (!joined) {
          run = { t: 'run', x: o.x, baseline: o.baseline, size: o.size, gray: o.gray, segs: [] };
          pen = o.x;
          outOps.push(run);
        }
        pushGlyph(o.font, g);
      }
      return outOps;
    }
    const pageRuns = pageOps.map(toRuns);

    // ---- オブジェクトを番号順に積む ----
    const objs = [];   // [番号-1] = Uint8Array の配列
    const reserve = () => { objs.push(null); return objs.length; };
    const setObj = (id, parts) => { objs[id - 1] = parts; };
    const dictObj = (id, s) => setObj(id, [enc.encode(s)]);
    async function streamObj(id, dict, data, extra) {
      const z = options.compress === false ? null : await deflate(data);
      const body = z || data;
      setObj(id, [enc.encode('<< ' + dict + (z ? ' /Filter /FlateDecode' : '') + ' /Length ' + body.length + (extra || '') + ' >>\nstream\n'), body, enc.encode('\nendstream')]);
    }

    const catalogId = reserve(), pagesId = reserve(), infoId = reserve();
    const fontRes = {};
    const fontIds = {};
    const fontKeys = [['gothic', 'F1', 'AAAAAA'], ['latin', 'F2', 'AAAAAB']];
    for (const [key, name, tag] of fontKeys) {
      if (!use[key].size) continue;
      const f = fonts[key];
      const baseName = tag + '+' + f.psName;
      const type0 = reserve(), cid = reserve(), desc = reserve(), file = reserve(), tou = reserve();
      fontIds[key] = name; fontRes[name] = type0;
      const scale = 1000 / f.unitsPerEm;
      const sub = subsetFont(f, use[key].keys());
      await streamObj(file, '', sub, ' /Length1 ' + sub.length);
      const gids = Array.from(use[key].keys()).sort((a, b) => a - b);
      let w = '';
      gids.forEach((g) => { w += g + ' [' + n4(f.advance(g) * scale) + '] '; });
      dictObj(desc, '<< /Type /FontDescriptor /FontName /' + baseName + ' /Flags 4 /FontBBox [' + f.bbox.map((v) => n4(v * scale)).join(' ') + ']' +
        ' /ItalicAngle 0 /Ascent ' + n4(f.ascent * scale) + ' /Descent ' + n4(f.descent * scale) + ' /CapHeight ' + n4(f.capHeight * scale) +
        ' /StemV 87 /FontFile2 ' + file + ' 0 R >>');
      dictObj(cid, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + baseName +
        ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + desc + ' 0 R' +
        ' /DW ' + n4(f.advance(0) * scale) + ' /W [' + w + '] /CIDToGIDMap /Identity >>');
      await streamObj(tou, '', enc.encode(toUnicodeCMap(use[key])));
      dictObj(type0, '<< /Type /Font /Subtype /Type0 /BaseFont /' + baseName + ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + tou + ' 0 R >>');
    }
    const resources = '<< /Font << ' + Object.keys(fontRes).map((k) => '/' + k + ' ' + fontRes[k] + ' 0 R').join(' ') + ' >> /ProcSet [/PDF /Text] >>';

    // ---- ページ ----
    const pageIds = [];
    for (const ops of pageRuns) {
      const pageId = reserve(), contentId = reserve();
      pageIds.push(pageId);
      const out = [];
      let fill = null;
      const setFill = (g) => { if (fill !== g) { out.push(n4(g) + ' g'); fill = g; } };
      for (const o of ops) {
        if (o.t === 'rect') {
          setFill(o.gray);
          out.push(n4(o.x) + ' ' + n4(PAGE_HEIGHT - o.y - o.h) + ' ' + n4(o.w) + ' ' + n4(o.h) + ' re f');
        } else if (o.t === 'line') {
          out.push(n4(o.gray) + ' G ' + n4(o.width) + ' w ' + n4(o.x1) + ' ' + n4(PAGE_HEIGHT - o.y1) + ' m ' + n4(o.x2) + ' ' + n4(PAGE_HEIGHT - o.y2) + ' l S');
        } else {
          // 1つの並び = BT … ET（基準版の draw_text 1回分）。書体が替わるところは Tf だけを入れて続ける
          setFill(o.gray);
          let s = 'BT 1 0 0 1 ' + n4(o.x) + ' ' + n4(PAGE_HEIGHT - o.baseline) + ' Tm';
          o.segs.forEach((sg) => { s += ' /' + fontIds[sg.font] + ' ' + n4(o.size) + ' Tf <' + sg.gids.map(hex4).join('') + '> Tj'; });
          out.push(s + ' ET');
        }
      }
      await streamObj(contentId, '', enc.encode(out.join('\n') + '\n'));
      dictObj(pageId, '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + n4(PAGE_WIDTH) + ' ' + n4(PAGE_HEIGHT) + '] /Resources ' + resources + ' /Contents ' + contentId + ' 0 R >>');
    }
    dictObj(pagesId, '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>');
    dictObj(catalogId, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    dictObj(infoId, '<< /Title ' + utf16Hex(String(options.title || '点検用レセプト')) + ' /Producer ' + utf16Hex('rezept_form_pdf.js') + ' >>');

    // ---- 書き出し（本体・相互参照表・トレーラー） ----
    const chunks = [];
    let length = 0;
    const push = (b) => { chunks.push(b); length += b.length; };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));   // %PDF-1.7 と 2進を示す行
    const offsets = [];
    objs.forEach((parts, i) => {
      offsets.push(length);
      push(enc.encode((i + 1) + ' 0 obj\n'));
      parts.forEach(push);
      push(enc.encode('\nendobj\n'));
    });
    const xrefAt = length;
    let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
    xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
    push(enc.encode(xref));
    const all = new Uint8Array(length);
    let p = 0;
    chunks.forEach((c) => { all.set(c, p); p += c.length; });
    return all;
  }

  return {
    PAGE_WIDTH, PAGE_HEIGHT,
    fromSvgPages,
    bytesFromSvgPages,
    /** 書体を先に読んでおく（最初の PDF 化を速くしたいとき） */
    preloadFonts: () => loadFonts().then(() => true),
    // 検証用
    _internal: { parseSvgPage, textSizeFromScale, subsetFont, parseFont },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RezeptFormPdf;
