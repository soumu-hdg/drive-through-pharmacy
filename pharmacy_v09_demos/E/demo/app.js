/* 案E 棚の前で数える（循環棚卸）デモ
   - テスト用の院: 本番DBの「テスト用の院」につながる（sb.js）。数えた実数で直すと DB の在庫が実際に動く
   - 西春・中川: DB には接続しない。demo_data.js の見本で表示し、書き込みはしない
   - 帳簿の数は数え終わるまで隠す → 差を見せる → 理由を選んで実数に直す
   - localStorage に残すのは 選んだ院・数える人・1日に数える品目数 だけ */
(function () {
  'use strict';
  var D = window.DEMO_DATA;
  var KEY = 'p9E.';
  var DEMO_TODAY = '2026-09-30';     // 見本データの「今日」
  var DEMO_OUT_END = '2026-09-26';   // 見本の出庫実績の最終日
  var TODAY = DEMO_TODAY, OUT_END = DEMO_OUT_END;
  var app = document.getElementById('app');

  function ls(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem(KEY + k); return s ? JSON.parse(s) : null; }
      localStorage.setItem(KEY + k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  // 以前の版が端末に残した在庫・記録（p9E.s.<院>）は使わない
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY + 's.') === 0) localStorage.removeItem(k); }); } catch (e) {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { n = Math.round(n * 100) / 100; return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP'); }
  function sgn(n) { return n > 0 ? '+' + fmt(n) : n < 0 ? fmt(n) : '±0'; }
  function yen(n) { return '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP'); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
  function md(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function z2h(s) { return String(s || '').replace(/[０-９．]/g, function (c) { return c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function localDate(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hm(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // 成分の目安＝名前の先頭のカタカナの並び（例 アムロジピン）
  function ing(s) { var t = String(s || '').normalize('NFKC').replace(/^〔[^〕]*〕/, ''); var m = t.match(/^[ァ-ヶー]{3,}/); return m ? m[0] : ''; }

  var clinicId = ls('clinic');
  var op = ls('op') || D.operators[4];
  var perDayPref = ls('perDay') || 8;
  var S = null, MED = {}, LIST = [];
  var view = clinicId ? 'list' : 'start';
  var cur = null;       // 数えている品目の入力
  var q = '';           // 検索
  var busy = false;     // DB へ送信中
  var errMsg = '';      // 画面内に出す失敗の理由
  var flash = '';       // 画面内に出す完了の知らせ
  var resetArm = false, resetMsg = '';

  function live() { return !!(window.SB && SB.isLive(clinicId)); }
  function canW() { return !!(window.SB && SB.canWrite(clinicId)); }
  function roMsg() { return (window.SB && SB.readOnlyMessage(clinicId)) || 'この院では書き込みをしません。'; }

  /* 出庫実績（過去14日）→ 優先度用。テスト用は DB の出庫（DEMO_DATA.daily_out_test） */
  var out14 = {}, outRecent = {};
  function buildOut() {
    out14 = {}; outRecent = {};
    var src = live() ? (D.daily_out_test || []) : (D.daily_out_nishiharu || []);
    src.forEach(function (r) {
      var age = daysBetween(r.d, OUT_END);
      if (age >= 0 && age < 14) out14[r.c] = (out14[r.c] || 0) + r.q;
      (outRecent[r.c] = outRecent[r.c] || []).push(r);
    });
  }

  function clinic() { return D.clinics.filter(function (c) { return c.id === clinicId; })[0]; }

  /* テスト用: 在庫・数えた日・前回のズレ・調整の記録を DB の値から作る */
  function fromDb() {
    LIST = D.medicines[clinicId]; MED = {};
    LIST.forEach(function (m) { MED[m.code] = m; S.stock[m.code] = Number(m.current_stock) || 0; });
    S.counted = {}; S.lastDiff = {}; S.log = []; S.countToday = {};
    var mv = SB.moves(clinicId);   // 新しい順
    mv.forEach(function (m) {
      if (m.voided_at) return;
      var diff = r2(Number(m.stock_after) - Number(m.stock_before));
      if (m.kind === 'count' && !S.counted[m.medicine_code]) {
        S.counted[m.medicine_code] = m.occurred_on;
        if (diff) S.lastDiff[m.medicine_code] = diff;
        if (m.occurred_on === TODAY) S.countToday[m.medicine_code] = { book: Number(m.stock_before), actual: Number(m.stock_after), diff: diff, fixed: true, reason: m.reason || '一致', txId: m.id, by: m.operator };
      }
      if ((m.kind === 'count' || m.kind === 'adjust') && diff) {
        var x = MED[m.medicine_code];
        S.log.unshift({ time: md(m.occurred_on) + ' ' + hm(m.created_at), code: m.medicine_code, name: x ? x.name : m.medicine_code, before: Number(m.stock_before), actual: Number(m.stock_after), diff: diff, reason: m.reason || (m.kind === 'adjust' ? '調整' : ''), op: m.operator || '' });
      }
    });
  }
  /* テスト用: DB を読み直したあと、今日のリストはそのままに結果だけ合わせる */
  function resync() {
    if (!live() || !S) return;
    fromDb();
    var t = S.today;
    Object.keys(S.countToday).forEach(function (c) { if (t.codes.indexOf(c) < 0) t.codes.push(c); });
    t.codes.sort();
    t.codes.forEach(function (c) {
      if (S.countToday[c]) t.res[c] = S.countToday[c];
      else if (t.res[c] && t.res[c].fixed) delete t.res[c];   // 取り消された
    });
  }

  function load() {
    TODAY = live() ? localDate() : DEMO_TODAY;
    OUT_END = live() ? TODAY : DEMO_OUT_END;
    buildOut(); HIGH = null;
    LIST = D.medicines[clinicId]; MED = {};
    LIST.forEach(function (m) { MED[m.code] = m; });
    S = { stock: {}, counted: {}, lastDiff: {}, log: [], countToday: {}, today: null, perDay: perDayPref };
    if (live()) fromDb();
    else LIST.forEach(function (m) { S.stock[m.code] = Number(m.current_stock) || 0; });
    var done = Object.keys(S.countToday).sort();
    var codes = done.concat(pick().slice(0, Math.max(0, S.perDay - done.length))).sort();
    S.today = { date: TODAY, codes: codes, res: {} };
    done.forEach(function (c) { S.today.res[c] = S.countToday[c]; });
  }
  function tracked() { return LIST.filter(function (m) { return !m.stock_untracked; }); }

  /* 今日数える品目を選ぶ */
  var HIGH = null;
  function reasonsOf(m) {
    var t = [];
    if (!HIGH) {
      HIGH = {};
      tracked().slice().sort(function (a, b) { return (b.cost_per_unit || b.price || 0) - (a.cost_per_unit || a.price || 0); }).slice(0, 12).forEach(function (x) { HIGH[x.code] = 1; });
    }
    if (S.stock[m.code] < 0) t.push(['マイナス', 1]);
    if (S.lastDiff[m.code]) t.push(['前回ズレ', 1]);
    if ((out14[m.code] || 0) >= 40) t.push(['よく減る', 0]);
    if (HIGH[m.code]) t.push(['高い薬', 0]);
    if (!S.counted[m.code]) t.push(['数えた記録なし', 0]);
    else { var dd = daysBetween(S.counted[m.code], TODAY); t.push([dd === 0 ? '今日数えた' : dd + '日前に数えた', 0]); }
    return t;
  }
  function score(m) {
    var s = 0;
    if (S.stock[m.code] < 0) s += 1000;
    if (S.lastDiff[m.code]) s += 300;
    s += Math.min(250, (out14[m.code] || 0) * 1.5);
    if (HIGH && HIGH[m.code]) s += 60;
    s += S.counted[m.code] ? daysBetween(S.counted[m.code], TODAY) * 5 : 60;
    return s;
  }
  function pick() {
    if (!LIST.length) return [];
    reasonsOf(LIST[0]);
    var c = tracked().filter(function (m) { return !S.counted[m.code] || daysBetween(S.counted[m.code], TODAY) >= 7; });
    c.sort(function (a, b) { return score(b) - score(a) || (a.code < b.code ? -1 : 1); });
    return c.map(function (m) { return m.code; });
  }
  function cycleDone() { return tracked().filter(function (m) { return S.counted[m.code] && daysBetween(S.counted[m.code], TODAY) < 7; }).length; }
  function negCount() { return tracked().filter(function (m) { return S.stock[m.code] < 0; }).length; }

  /* カルテで結び付かなかった処方 */
  function unmatchedAll() { return live() ? SB.unmatched(clinicId) : (D.karte_unmatched_examples || []); }
  function candText(x) { var m = String(x.reason || '').match(/近い候補[:：]\s*([^）)]+)/); return m ? m[1] : ''; }
  function unmatchedFor(m) {
    if (!live()) return (D.karte_unmatched_examples || []).filter(function (x) { return x.reason.indexOf(m.code) >= 0; });
    var i = ing(m.name); if (!i) return [];
    return SB.unmatched(clinicId).filter(function (x) { return ing(x.karte_name) === i || ing(candText(x)) === i; });
  }
  function candidatesFor(x) {
    var a = ing(x.karte_name), b = ing(candText(x));
    return LIST.filter(function (m) { var i = ing(m.name); return i && (i === a || i === b); }).slice(0, 4);
  }

  /* ─── 共通の上部 ─── */
  function bar(title) {
    var c = clinic();
    var line = c.id === 'test'
      ? (live() ? '<div class="practice">テスト用の院 ─ 本番DBに接続中。操作すると実際に値が動きます（西春・中川には影響しません）</div>'
                : '<div class="practice off">テスト用の院 ─ ' + esc(roMsg()) + '（書き込みはしません）</div>')
      : '<div class="ro-line">見本データで表示中 ─ この院では書き込みをしません</div>';
    return '<div class="cbar ' + (c.id === 'test' ? 'test' : '') + '" style="--clinic:' + c.color + '">' +
      '<button class="cname" id="cname" data-go="start">' + esc(c.short) + ' <small>院を切替</small></button>' +
      '<div class="title">' + esc(title) + '</div>' +
      '<button class="op" data-go="start">' + esc(op) + '</button></div>' + line;
  }
  function msgs() {
    return (flash ? '<div class="flash" id="flash">' + esc(flash) + '</div>' : '') + (errMsg ? '<div class="errline" id="err">' + esc(errMsg) + '</div>' : '');
  }
  function roBox() {
    return '<div class="ro-box" id="ro-box"><div>' + esc(roMsg()) + '</div>' +
      (window.SB && SB.live && clinicId !== 'test' ? '<button class="big" id="to-test" data-clinic="test">テスト用の院へ切り替える</button>' : '') + '</div>';
  }

  /* ─── 院の選択 ─── */
  function vStart() {
    var h = '<div class="start"><h1>棚の前で数える</h1><p class="lead">毎日5分、アプリが選んだ数品目だけを数えて、帳簿とのズレをその日のうちに直します。<br>最初に数える院を選んでください。</p>';
    h += window.SB && SB.live
      ? '<div class="liveline" id="liveline">テスト用の院は本番DBに接続中。操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データで表示し、書き込みはしません。</div>'
      : '<div class="liveline off" id="liveline">DBに接続できないため、テスト用の院も見本データで表示しています（書き込みはしません）。' + (window.SB && SB.error ? '理由: ' + esc(SB.error) : '') + '</div>';
    D.clinics.forEach(function (c) {
      var st = c.id === 'test' ? 'background:repeating-linear-gradient(135deg,#b8860b 0 6px,#8f6a08 6px 12px)' : 'background:' + c.color;
      var tag = c.id === 'test' && window.SB && SB.live ? '<span class="dbtag">DB接続中・値が動く</span>' : '<span class="dbtag ro">見本データ・書き込みなし</span>';
      h += '<button class="clinic-btn" id="clinic-' + c.id + '" data-clinic="' + c.id + '"><span class="sw" style="' + st + '"></span><span class="in"><b>' + esc(c.short) + ' ' + tag + '</b><span>' + esc(c.name) + (c.note ? '　' + esc(c.note) : '') + '</span></span></button>';
    });
    h += '<div class="lbl">数える人</div><div class="chips">';
    D.operators.forEach(function (o, i) { h += '<button class="chip' + (o === op ? ' on' : '') + '" id="op-' + i + '" data-op="' + esc(o) + '">' + esc(o) + '</button>'; });
    h += '</div><button class="reset' + (resetArm ? ' arm' : '') + '" id="reset"' + (busy ? ' disabled' : '') + '>' +
      (busy ? '初期化しています…' : resetArm ? 'もう一度押すと初期化します（テスト用の院の在庫と記録を最初の状態に戻す）' : 'デモの初期化（テスト用の院を最初の状態に戻す）') + '</button>';
    if (resetMsg) h += '<div class="reset-msg" id="reset-msg">' + esc(resetMsg) + '</div>';
    return h + '</div>';
  }

  /* ─── 今日のリスト ─── */
  function vList() {
    var codes = S.today.codes, res = S.today.res;
    var done = codes.filter(function (c) { return res[c] && res[c].fixed; }).length;
    var fixedDiff = codes.filter(function (c) { return res[c] && res[c].fixed && res[c].diff !== 0; }).length;
    var tr = tracked(), cd = cycleDone();
    var h = bar('今日の棚卸') + msgs();
    h += '<div class="today-head"><div class="eyebrow">' + md(TODAY) + '　棚の並び順で ' + codes.length + ' 品目</div><h2>今日はこの' + codes.length + '品目だけ数えます</h2></div>';
    h += '<div class="meter"><div><div class="k">数えた</div><div class="v num">' + done + '<small>/' + codes.length + '</small></div></div>' +
      '<div><div class="k">直した差</div><div class="v num' + (fixedDiff ? ' hot' : '') + '">' + fixedDiff + '<small>品目</small></div></div>' +
      '<div><div class="k">マイナス在庫</div><div class="v num' + (negCount() ? ' hot' : '') + '">' + negCount() + '<small>品目</small></div></div></div>';
    h += '<div class="cycle"><div class="k"><span>1週間で全品目を一巡（外用を除く ' + tr.length + ' 品目）</span><span class="num">' + cd + '/' + tr.length + '</span></div><div class="cells">';
    tr.forEach(function (m) {
      var cls = S.counted[m.code] && daysBetween(S.counted[m.code], TODAY) < 7 ? 'done' : (codes.indexOf(m.code) >= 0 ? 'now' : '');
      h += '<i class="' + cls + '"></i>';
    });
    h += '</div></div>';
    if (clinicId === 'nakagawa') h += '<div class="empty" style="padding:8px 16px;font-size:12px">開院前のため在庫は0です。入荷を登録したあとに、同じ手順で数えます。</div>';
    h += '<div class="shelf" style="margin-top:8px">棚の順 ▼ 成人 → 小児 → 検査（歩く順）</div><ul class="rows" style="border-top:0">';
    codes.forEach(function (c, i) {
      var m = MED[c], r = res[c]; if (!m) return;
      var tags = reasonsOf(m).map(function (t) { return '<span class="tag' + (t[1] ? ' hot' : '') + '">' + esc(t[0]) + '</span>'; }).join('');
      var st = r && r.fixed ? '<div class="st num' + (r.diff ? ' hit' : '') + '">' + (r.diff ? sgn(r.diff) : '一致') + '</div>' : '<div class="st todo">数える ›</div>';
      if (r && r.fixed) tags = '<span class="tag">済 ' + esc(r.reason || '一致') + '</span>';
      h += '<li><button class="row' + (r && r.fixed ? ' done' : '') + '" id="row-' + c + '" data-count="' + c + '"><span class="ord">' + (i + 1) + '</span><span><span class="nm"><span class="cd">' + c + '</span>' + esc(m.name) + '</span><span class="why">' + tags + '</span></span>' + st + '</button></li>';
    });
    h += '</ul>';
    if (live()) h += umListHtml();
    h += '<div class="search"><input id="q" placeholder="ほかの薬も数える（ローマ字・かな・コード）" value="' + esc(q) + '" autocomplete="off"></div><ul class="hits" id="hits">' + hitsHtml() + '</ul>';
    h += '<div class="bottom"><button class="big" id="to-summary" data-go="summary">今日の成果を見る</button></div>';
    return h;
  }
  function umBtns(x, cands) {
    var dis = busy ? ' disabled' : '';
    return '<div class="um-act">' + cands.map(function (m) {
      return '<button id="um-link-' + x.id + '-' + m.code + '" data-umlink="' + x.id + '" data-code="' + m.code + '"' + dis + '>' + m.code + ' ' + esc(m.name) + ' に結び付けて減らす</button>';
    }).join('') + '<button class="ghost" id="um-dis-' + x.id + '" data-umdis="' + x.id + '"' + dis + '>結び付けない（在庫は減らさない）</button></div>';
  }
  function umListHtml() {
    var list = SB.unmatched(clinicId);
    if (!list.length) return '';
    var h = '<div class="sec"><h3>カルテで結び付かなかった処方 <small>' + list.length + '件・在庫から減っていない分</small></h3><div class="sib">';
    list.forEach(function (x) {
      h += '<div class="msg">' + md(x.occurred_on) + '　<b>' + esc(x.karte_name) + ' ' + fmt(x.qty) + esc(x.unit) + '</b><br>' + esc(x.reason) + umBtns(x, candidatesFor(x)) + '</div>';
    });
    return h + '</div></div>';
  }
  function hitsHtml() {
    if (!q) return '';
    var list = KanaSearch.filter(LIST, q, function (x) { return [x.name, x.furigana, x.code, x.category]; }).slice(0, 6);
    if (!list.length) return '<li class="note">見つかりません</li>';
    return list.map(function (m) {
      return '<li><button data-add="' + m.code + '" id="hit-' + m.code + '"><span class="num" style="color:#5d5d5d;font-size:11px">' + m.code + '</span> ' + esc(m.name) + (m.stock_untracked ? '　<span class="tag">外用・数えない</span>' : '') + '</button></li>';
    }).join('');
  }

  /* ─── 数える ─── */
  function total() {
    var m = MED[cur.code], pk = m.pack_size > 1 ? m.pack_size : 0;
    var loose = cur.loose.reduce(function (a, b) { return a + (+b || 0); }, 0);
    return (pk ? (+cur.box || 0) * pk : 0) + loose;
  }
  function vCount() {
    var m = MED[cur.code], pk = m.pack_size > 1 ? m.pack_size : 0;
    var h = bar('数える ' + (S.today.codes.indexOf(cur.code) + 1) + '/' + S.today.codes.length);
    h += '<div class="item-head"><div class="cd">' + m.code + '　' + esc(m.category) + '</div><h2>' + esc(m.name) + '</h2><div class="pk">' + (pk ? '1箱 = <span class="num">' + fmt(pk) + '</span> ' + esc(m.unit) + '（' + esc(m.supplier_name || '') + '）' : '単位: ' + esc(m.unit)) + '</div></div>';
    h += '<div class="hidden-book"><span>帳簿の数は、数え終わるまで隠しています</span><b>＊＊＊</b></div>';
    var caret = '<span class="caret"></span>';
    h += '<div class="display"><div class="terms">';
    if (pk) h += '<button class="term' + (cur.field === 'box' ? ' on' : '') + '" id="t-box" data-field="box"><span class="k">箱（未開封）</span><span class="v">' + (cur.box || '0') + (cur.field === 'box' ? caret : '') + '</span> <span class="x">× ' + fmt(pk) + '</span></button>';
    h += '<button class="term' + (cur.field === 'loose' ? ' on' : '') + '" id="t-loose" data-field="loose"' + (pk ? '' : ' style="grid-column:1/3"') + '><span class="k">ばら（開封済み・' + esc(m.unit) + '）</span><span class="v">' + cur.loose.map(function (x) { return x || '0'; }).join('<span class="x">+</span>') + (cur.field === 'loose' ? caret : '') + '</span></button>';
    h += '</div><div class="total"><span class="k">実数</span><span class="v num" id="actual">' + fmt(total()) + '<small>' + esc(m.unit) + '</small></span></div></div>';
    var K = [['7'], ['8'], ['9'], ['箱', 'box', 'fn'], ['4'], ['5'], ['6'], ['ばら', 'loose', 'fn'], ['1'], ['2'], ['3'], ['＋足す', 'plus', 'fn plus'], ['C', 'c', 'fn'], ['0'], ['00'], ['⌫', 'bs', 'fn']];
    h += '<div class="keys">';
    K.forEach(function (k) {
      var id = k[1] || k[0];
      if (id === 'box' && !pk) return h += '<button class="key fn" disabled></button>';
      h += '<button class="key ' + (k[2] || '') + '" id="k-' + id + '" data-key="' + id + '">' + k[0] + '</button>';
    });
    h += '</div><div class="note">「＋足す」は棚と引き出しなど、別の場所にあるばらを足すときに使います。</div>';
    h += '<div class="bottom"><button class="big ghost" data-go="list" style="flex:0 0 30%">戻る</button><button class="big" id="done-count" data-key="done">数え終わった</button></div>';
    return h;
  }

  /* ─── 差を見る・直す ─── */
  function vResult() {
    var m = MED[cur.code], r = S.today.res[cur.code];
    var diff = r.diff, lvl = diff === 0 ? 0 : (Math.abs(diff) <= Math.max(5, Math.abs(r.book) * 0.05) ? 1 : 2);
    var h = bar(r.fixed ? '直しました' : '帳簿と比べる') + msgs();
    h += '<div class="item-head"><div class="cd">' + m.code + '</div><h2>' + esc(m.name) + '</h2></div>';
    h += '<div class="reveal lv' + lvl + '" id="reveal"><div class="line"><span class="k">帳簿（アプリの在庫）</span><span class="v num">' + fmt(r.book) + '<small>' + esc(m.unit) + '</small></span></div>' +
      '<div class="line"><span class="k">数えた実数</span><span class="v num">' + fmt(r.actual) + '<small>' + esc(m.unit) + '</small></span></div>' +
      '<div class="diff"><span class="k">' + (lvl === 0 ? '帳簿と一致しました' : lvl === 1 ? '小さな差' : '大きな差') + (diff ? '<br>金額 ' + yen(diff * (m.cost_per_unit || m.price || 0)) + '（仕入単価）' : '') + '</span><span class="v num">' + (diff ? sgn(diff) : '±0') + '</span></div></div>';

    if (r.fixed) {
      h += '<div class="fixed" id="fixed"><div class="k">在庫を実数に直しました（' + esc(r.reason || '一致') + '・' + esc(r.by || op) + (live() ? '・DBに記録済み' : '') + '）</div><div class="v num">' + fmt(r.book) + ' → ' + fmt(r.actual) + ' ' + esc(m.unit) + '</div></div>';
    } else if (diff !== 0) {
      h += '<div class="sec"><h3>差の理由を選ぶ <small>必ず残します</small></h3><div class="reasons">';
      D.adjust_reasons.forEach(function (rs, i) { h += '<button class="chip' + (cur.reason === rs ? ' on' : '') + '" id="rs-' + i + '" data-reason="' + esc(rs) + '">' + esc(rs) + '</button>'; });
      h += '</div></div>';
    }
    h += sibHtml(m, r);
    var um = unmatchedFor(m);
    if (um.length) {
      h += '<div class="sec"><h3>在庫の品目と結び付かなかったカルテの処方 <small>' + (live() ? 'DBの未処理の記録' : 'デモ用の例') + '</small></h3><div class="sib">';
      um.forEach(function (x) {
        h += '<div class="msg">' + md(x.occurred_on || x.date) + '　<b>' + esc(x.karte_name) + ' ' + fmt(x.qty) + esc(x.unit) + '</b><br>' + esc(x.reason) + '<br>→ この分は在庫から減っていません。差の理由は「カルテ連動の取りこぼし」です。' +
          (live() ? umBtns(x, [m]) : '') + '</div>';
      });
      h += '</div></div>';
    }
    var rec = (outRecent[m.code] || []).slice(-4).reverse();
    if (rec.length) {
      h += '<div class="sec"><h3>カルテからの減り <small>' + (live() ? 'DBの出庫の記録・読み取り専用' : '過去の出庫実績をカルテ連動と同じ形で表示・読み取り専用') + '</small></h3><ul class="karte">';
      rec.forEach(function (x) { h += '<li><span>' + md(x.d) + '　カルテから<span class="ro">読取専用</span>　' + x.n + '件</span><span class="num">−' + fmt(x.q) + ' ' + esc(m.unit) + '</span></li>'; });
      h += '</ul></div>';
    }
    if (!r.fixed && !canW()) h += roBox();
    h += '<div style="height:8px"></div><div class="bottom">';
    var dis = busy ? ' disabled' : '';
    if (r.fixed) {
      if (live() && r.txId) h += '<button class="big ghost" id="undo-fix" data-go="undo"' + dis + ' style="flex:0 0 42%;font-size:14px">' + (busy ? '取り消し中…' : 'この直しを取り消す') + '</button>';
      h += '<button class="big" id="next" data-go="next"' + dis + '>次の品目へ</button>';
    } else {
      h += '<button class="big ghost" id="recount" data-go="recount"' + dis + ' style="flex:0 0 34%">数え直す</button>';
      if (!canW()) h += '<button class="big" id="fix" disabled>書き込みできません</button>';
      else h += diff === 0 ? '<button class="big" id="fix" data-go="fix"' + dis + '>' + (busy ? '記録しています…' : '一致として記録') + '</button>'
        : '<button class="big hitbtn" id="fix" data-go="fix"' + (cur.reason && !busy ? '' : ' disabled') + '>' + (busy ? '記録しています…' : '在庫を ' + fmt(r.actual) + ' に直す') + '</button>';
    }
    h += '</div>';
    return h;
  }
  function sibHtml(m, r) {
    if (!m.group_name) return '';
    var sibs = LIST.filter(function (x) { return x.group_name === m.group_name; });
    var idx = sibs.indexOf(m);
    var h = '<div class="sec"><h3>量違いの取り違えの疑い <small>' + esc(m.group_name) + '・' + sibs.length + '規格</small></h3><div class="sib">';
    if (r.diff > 0) h += '<div class="msg">帳簿より<b>多い</b>＝この量で記録して、<b>隣の量を渡した</b>可能性があります。隣の量も帳簿を見ずに数えてください。</div>';
    else if (r.diff < 0) h += '<div class="msg">帳簿より<b>少ない</b>＝この量を渡して、<b>隣の量で記録した</b>可能性があります。隣の量も帳簿を見ずに数えてください。</div>';
    else h += '<div class="msg">一致しました。同じ系統の量違いは次の通りです。</div>';
    sibs.forEach(function (x, i) {
      var me = x === m, near = Math.abs(i - idx) === 1 && r.diff !== 0;
      var inList = S.today.codes.indexOf(x.code) >= 0;
      h += '<div class="r' + (me ? ' me' : '') + '"><span>' + esc(z2h(x.spec || x.name.split('　').pop())) + (me ? '（いま数えた）' : '') + (near ? ' <span class="susp">隣の量・疑い</span>' : '') + '<br><span style="font-size:10.5px;color:#5d5d5d">2週間の減り <span class="num">' + fmt(out14[x.code] || 0) + '</span> ' + esc(x.unit) + '</span></span>' +
        '<span></span>' + (me ? '<span></span>' : '<button id="sib-' + x.code + '" data-add="' + x.code + '"' + (inList ? ' class="added"' : '') + '>' + (inList ? '今日のリストに入れた' : '今日数える') + '</button>') + '</div>';
    });
    return h + '</div></div>';
  }

  /* ─── 今日の成果 ─── */
  function vSummary() {
    var codes = S.today.codes, res = S.today.res, tr = tracked(), cd = cycleDone();
    var done = codes.filter(function (c) { return res[c] && res[c].fixed; });
    var diffs = done.filter(function (c) { return res[c].diff !== 0; });
    var money = diffs.reduce(function (a, c) { var m = MED[c]; return a + Math.abs(res[c].diff * (m.cost_per_unit || m.price || 0)); }, 0);
    var rest = tr.length - cd, per = S.perDay || 8;
    var h = bar('今日の成果') + msgs();
    h += '<div class="today-head"><div class="eyebrow">' + md(TODAY) + '　' + esc(op) + (live() ? '　DBの記録から集計' : '') + '</div><h2>' + done.length + '品目を数え、' + diffs.length + '品目のズレを直しました</h2></div>';
    h += '<div class="result-grid">' +
      '<div><div class="k">数えた</div><div class="v num">' + done.length + '<small>/' + codes.length + ' 品目</small></div></div>' +
      '<div><div class="k">直した差</div><div class="v num hot">' + diffs.length + '<small> 品目</small></div></div>' +
      '<div><div class="k">差の金額（絶対値の合計）</div><div class="v num">' + yen(money) + '</div></div>' +
      '<div><div class="k">マイナス在庫</div><div class="v num' + (negCount() ? ' hot' : '') + '">' + negCount() + '<small> 品目</small></div></div>' +
      '<div><div class="k">一巡まで残り</div><div class="v num">' + rest + '<small> 品目</small></div></div>' +
      '<div><div class="k">このペースで一巡</div><div class="v num">' + Math.ceil(rest / per) + '<small> 日後</small></div></div></div>';
    h += '<div class="sec"><h3>1日に数える品目数 <small>次の日から反映</small></h3><div class="chips">';
    [5, 8, 13].forEach(function (n) { h += '<button class="chip' + (per === n ? ' on' : '') + '" data-per="' + n + '" id="per-' + n + '">' + n + '品目' + (n === 13 ? '（7日で一巡）' : '') + '</button>'; });
    h += '</div></div>';
    h += '<div class="sec"><h3>調整の記録 <small>理由・担当者つき・新しい順' + (live() ? '・DBの記録' : '') + '</small></h3></div><ul class="log">';
    if (!S.log.length) h += '<li>まだありません</li>';
    S.log.slice().reverse().slice(0, 12).forEach(function (l) {
      h += '<li>' + esc(l.time) + '　<b>' + esc(l.name) + '</b><br><span class="num">' + fmt(l.before) + ' → ' + fmt(l.actual) + '（' + sgn(l.diff) + '）</span><span class="rsn">' + esc(l.reason) + '</span>　' + esc(l.op) + '</li>';
    });
    h += '</ul><div class="note">数値を直せるのは担当者の操作だけです。カルテからの自動の減りはこの記録とは別に残ります。</div>';
    h += '<div class="bottom"><button class="big ghost" data-go="list" id="back-list">今日のリストに戻る</button></div>';
    return h;
  }

  /* ─── 描画・操作 ─── */
  function render() {
    if (view !== 'start' && !S) load();
    app.innerHTML = view === 'start' ? vStart() : view === 'list' ? vList() : view === 'count' ? vCount() : view === 'result' ? vResult() : vSummary();
  }
  function go(v) { view = v; errMsg = ''; if (v !== 'list') flash = ''; if (v !== 'start') { resetArm = false; resetMsg = ''; } render(); window.scrollTo(0, 0); }

  function startCount(code) {
    var m = MED[code];
    flash = '';
    cur = { code: code, box: '', loose: [''], field: m.pack_size > 1 ? 'box' : 'loose', reason: null };
    if (S.today.res[code] && S.today.res[code].fixed) { cur.reason = S.today.res[code].reason; return go('result'); }
    go('count');
  }
  function key(k) {
    if (k === 'done') {
      var book = S.stock[cur.code], a = total();
      S.today.res[cur.code] = { book: book, actual: a, diff: r2(a - book), fixed: false };
      return go('result');
    }
    if (k === 'box' || k === 'loose') cur.field = k;
    else if (k === 'plus') { cur.field = 'loose'; if (cur.loose[cur.loose.length - 1] !== '') cur.loose.push(''); }
    else if (k === 'c') { if (cur.field === 'box') cur.box = ''; else cur.loose = ['']; }
    else if (k === 'bs') {
      if (cur.field === 'box') cur.box = cur.box.slice(0, -1);
      else { var l = cur.loose; if (l[l.length - 1] === '' && l.length > 1) l.pop(); else l[l.length - 1] = l[l.length - 1].slice(0, -1); }
    } else {
      if (cur.field === 'box') { if (cur.box.length < 4) cur.box = (cur.box === '0' ? '' : cur.box) + k; }
      else { var i = cur.loose.length - 1; if (cur.loose[i].length < 5) cur.loose[i] = (cur.loose[i] === '0' ? '' : cur.loose[i]) + k; }
    }
    render();
  }
  /* 実数で直す（テスト用だけ DB へ。失敗したら数字は動かさない） */
  async function fix() {
    var r = S.today.res[cur.code], code = cur.code;
    var reason = r.diff === 0 ? '一致' : cur.reason;
    if (r.diff !== 0 && !reason) return;
    if (!canW()) { errMsg = roMsg(); return render(); }
    busy = true; errMsg = ''; flash = ''; render();
    try {
      var res = await SB.apply(clinicId, [{ code: code, kind: 'count', count: r.actual, reason: reason, note: '棚の前で数えた実数（案E）' }], op, 'demo:E');
      var x = (res || []).filter(function (y) { return y.code === code; })[0] || res[0];
      try { await SB.refresh(clinicId); } catch (e2) {}
      resync();
      S.today.res[code] = { book: Number(x.before), actual: Number(x.after), diff: r2(Number(x.delta != null ? x.delta : x.after - x.before)), fixed: true, reason: reason, txId: x.tx_id, by: op };
      S.stock[code] = Number(x.after); S.counted[code] = TODAY;
      if (S.today.res[code].diff) S.lastDiff[code] = S.today.res[code].diff;
    } catch (e) {
      errMsg = '在庫を直せませんでした（数字は変えていません）: ' + e.message;
    }
    busy = false; render();
  }
  /* 直しの取り消し（テスト用） */
  async function undoFix() {
    var code = cur.code, r = S.today.res[code];
    if (!r || !r.txId || !canW()) return;
    busy = true; errMsg = ''; flash = ''; render();
    try {
      var res = await SB.voidTx(clinicId, [r.txId], op);
      var x = (res || []).filter(function (y) { return y.code === code; })[0];
      try { await SB.refresh(clinicId); } catch (e2) {}
      resync();
      delete S.today.res[code];
      busy = false;
      flash = MED[code].name + ' の直しを取り消しました（在庫 ' + (x ? fmt(Number(x.before)) + ' → ' + fmt(Number(x.after)) : '元に戻しました') + '）';
      view = 'list'; render(); window.scrollTo(0, 0); return;
    } catch (e) {
      errMsg = '取り消せませんでした（数字は変えていません）: ' + e.message;
    }
    busy = false; render();
  }
  /* カルテで結び付かなかった処方を片付ける（テスト用） */
  async function resolveUm(id, status, code) {
    if (!canW()) { errMsg = roMsg(); return render(); }
    var x = SB.unmatched(clinicId).filter(function (u) { return String(u.id) === String(id); })[0];
    busy = true; errMsg = ''; flash = ''; render();
    try {
      var res = await SB.resolveUnmatched(clinicId, Number(id), status, status === 'linked' ? code : null, op, status === 'linked' ? '棚卸（案E）で結び付け' : '棚卸（案E）で結び付けないと判断');
      resync();
      var y = (res || [])[0];
      flash = (x ? x.karte_name + ' ' + fmt(x.qty) + x.unit + ' を' : '') + (status === 'linked' ? ' ' + code + ' に結び付けました' + (y ? '（在庫 ' + fmt(Number(y.before)) + ' → ' + fmt(Number(y.after)) + '）' : '') : ' 結び付けない記録にしました（在庫は変えていません）');
    } catch (e) {
      errMsg = '処理できませんでした（数字は変えていません）: ' + e.message;
    }
    busy = false; render();
  }
  async function doReset() {
    if (!resetArm) { resetArm = true; resetMsg = ''; return render(); }
    resetArm = false;
    if (!(window.SB && SB.live)) { resetMsg = 'DBに接続できないため初期化できません。'; return render(); }
    busy = true; render();
    try {
      await SB.resetTest();
      S = null; q = '';
      resetMsg = 'テスト用の院を最初の状態に戻しました（西春・中川は見本のままです）。';
    } catch (e) {
      resetMsg = '初期化できませんでした: ' + e.message;
    }
    busy = false; render();
  }
  function nextItem() {
    var codes = S.today.codes;
    var i = codes.indexOf(cur.code);
    for (var k = 1; k <= codes.length; k++) {
      var c = codes[(i + k) % codes.length];
      if (!(S.today.res[c] && S.today.res[c].fixed)) return go('list');
    }
    go('summary');
  }
  function addToday(code) {
    var m = MED[code];
    if (m.stock_untracked) return;
    if (S.today.codes.indexOf(code) < 0) { S.today.codes.push(code); S.today.codes.sort(); }
    q = ''; render();
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (busy) return;
    if (d.clinic) { clinicId = d.clinic; ls('clinic', clinicId); S = null; HIGH = null; flash = ''; load(); return go('list'); }
    if (d.op) { op = d.op; ls('op', op); return render(); }
    if (b.id === 'reset') return doReset();
    if (resetArm) { resetArm = false; }
    if (d.umlink) return resolveUm(d.umlink, 'linked', d.code);
    if (d.umdis) return resolveUm(d.umdis, 'dismissed', null);
    if (d.count) return startCount(d.count);
    if (d.add) return addToday(d.add);
    if (d.field) { cur.field = d.field; return render(); }
    if (d.key) return key(d.key);
    if (d.reason) { cur.reason = d.reason; return render(); }
    if (d.per) { S.perDay = perDayPref = +d.per; ls('perDay', perDayPref); return render(); }
    if (d.go === 'fix') return fix();
    if (d.go === 'undo') return undoFix();
    if (d.go === 'next') return nextItem();
    if (d.go === 'recount') { cur.reason = null; return go('count'); }
    if (d.go) return go(d.go);
  });
  app.addEventListener('input', function (e) {
    if (e.target.id === 'q') { q = e.target.value; document.getElementById('hits').innerHTML = hitsHtml(); }
  });

  /* 起動: DB の読み込みを待ってから最初の描画 */
  app.innerHTML = '<div class="connecting" id="connecting">接続中…<br><small>テスト用の院の在庫をDBから読み込んでいます</small></div>';
  window.__E = { state: function () { return S; } };
  (window.SB ? SB.ready : Promise.resolve(false)).then(function () {
    if (clinicId && !D.medicines[clinicId]) { clinicId = null; view = 'start'; }
    render();
  });
})();
