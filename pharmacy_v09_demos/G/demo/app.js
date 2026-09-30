/* 突き合わせ台帳（案G）─ デモ。
   テスト用の院だけ本番DBにつながり（sb.js）、操作すると実際に在庫の値が動く。
   西春・中川は demo_data.js の見本データで表示し、書き込みはしない。 */
(function () {
  'use strict';
  var D = window.DEMO_DATA, K = window.KanaSearch;
  var TODAY = '2026-09-30', MONTH = '2026-09', KEY = 'p9G_';
  var HIST_FROM = '2026-08-27';
  // 銘柄名（先発・略称）→ 在庫の品目名（成分名）の読み替え表（候補の並べ替えに使う）
  var ALIAS = { 'カロナール': 'アセトアミノフェン', 'トランサミン': 'トラネキサム酸', 'ノルバスク': 'アムロジピン', 'アムロジン': 'アムロジピン', 'ホクナリン': 'ツロブテロール', 'ムコダイン': 'カルボシステイン', 'アレグラ': 'フェキソフェナジン', 'タミフル': 'オセルタミビル' };
  var S = { clinic: null, op: '事務G', tab: 'cand', code: 'M005', linkSel: null, linkPick: null, linkQ: '', itemQ: '', busy: false };
  var SESSION_LINKS = {};   // テスト用：この画面で確定した結び付け（カルテの薬名 → {code, op, date, auto, k, res}）

  // ---------- データ（テスト用＝DB／西春・中川＝見本） ----------
  // 以前の版が localStorage に残した在庫・記録は使わない（消す）。残すのは画面の設定だけ
  function cleanupOld() {
    try { Object.keys(localStorage).filter(function (k) { return k.indexOf(KEY) === 0 && k !== KEY + 'pref'; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }
  function loadPref() { try { var p = JSON.parse(localStorage.getItem(KEY + 'pref') || 'null'); if (p && p.op) S.op = p.op; } catch (e) {} }
  function savePref() { try { localStorage.setItem(KEY + 'pref', JSON.stringify({ op: S.op })); } catch (e) {} }
  function live(cid) { return window.SB && SB.isLive(cid); }
  function karteFromNote(s) { var m = String(s || '').match(/「(.+?)」/); return m ? m[1] : ''; }
  function load(cid) {
    var st = {}; D.medicines[cid].forEach(function (m) { st[m.code] = Number(m.current_stock); });
    var d = { stock: st, events: [], links: {}, closes: [], karte: [] };
    if (live(cid)) {
      // 画面で行った操作（前後の在庫がある記録）を台帳の出来事に。取り消し済みは除く
      SB.moves(cid).slice().reverse().forEach(function (mv) {
        if (mv.voided_at || mv.kind === 'void' || mv.stock_before == null) return;
        var m = med(cid, mv.medicine_code); if (!m) return;
        var q = Number(mv.qty) || 0, type = mv.kind === 'in' ? 'inbound' : mv.kind === 'karte_out' ? 'link' : 'adjust';
        d.events.push({ type: type, id: mv.id, code: m.code, date: mv.occurred_on, delta: q, before: Number(mv.stock_before), after: Number(mv.stock_after),
          reason: mv.reason || (type === 'link' ? 'カルテ連動の取りこぼし' : type === 'inbound' ? '入荷' : ''), memo: mv.note || '', op: mv.operator || '',
          karte: karteFromNote(mv.note), amount: q * uc(m).v });
      });
      d.karte = SB.unmatched(cid).map(function (u) { return { id: u.id, karte_name: u.karte_name, qty: Number(u.qty), unit: u.unit, date: u.occurred_on, reason: u.reason }; });
      Object.keys(SESSION_LINKS).forEach(function (n) {
        var l = SESSION_LINKS[n]; d.links[n] = l;
        if (!d.karte.some(function (k) { return k.karte_name === n; })) d.karte.push(l.k);
      });
      d.closes = SB.docs(cid, 'close').filter(function (x) { return x.status === 'closed'; }).map(function (x) {
        var b = x.body || {}; return { month: x.doc_no, date: b.date || String(x.created_at || '').slice(0, 10), op: x.operator || b.op || '', id: x.id };
      }).reverse();
    } else if (cid !== 'nakagawa') {
      d.karte = D.karte_unmatched_examples.map(function (k) { return { id: null, karte_name: k.karte_name, qty: k.qty, unit: k.unit, date: k.date, reason: k.reason }; });
    }
    return d;
  }
  // 書き込めない院で、操作ボタンの所に出す文言（テスト用の院へ切り替えるボタン付き）
  function roHTML() { return esc(SB.readOnlyMessage(S.clinic) || 'この院では書き込みできません。') + (S.clinic !== 'test' ? ' <button class="btn small" data-to-test>テスト用の院へ切り替える</button>' : ''); }
  function showMsg(sel, html, ok) { var el = $(sel); if (!el) return; el.hidden = false; el.innerHTML = html; el.classList.toggle('ok-msg', !!ok); bindToTest(el); }
  function bindToTest(root) { [].forEach.call(root.querySelectorAll('[data-to-test]'), function (b) { b.onclick = function () { enterClinic('test'); }; }); }
  async function afterWrite() { try { await SB.refresh('test'); } catch (e) {} }

  // ---------- 小道具 ----------
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n0(v) { return Math.round(v).toLocaleString('ja-JP'); }
  function sn(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v)).toLocaleString('ja-JP'); }
  function yen(v) { return (v < 0 ? '−' : '') + '¥' + Math.abs(Math.round(v)).toLocaleString('ja-JP'); }
  function syen(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + '¥' + Math.abs(Math.round(v)).toLocaleString('ja-JP'); }
  function nc(v) { return v < 0 ? 'neg' : ''; }
  function md(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function nowHM() { var t = new Date(); return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); }
  function clinic(cid) { return D.clinics.filter(function (c) { return c.id === cid; })[0]; }
  function meds(cid) { return D.medicines[cid]; }
  function med(cid, code) { return meds(cid).filter(function (m) { return m.code === code; })[0]; }
  var MP = {};
  function masterPrice(m) {   // 薬価も未登録の品目は、厚労省マスタの同名品（銘柄違い）の最安の薬価で仮計算
    if (MP[m.name] !== undefined) return MP[m.name];
    var key = K.norm(m.name), ps = D.drug_master_sample.filter(function (x) { return K.norm(x.name).indexOf(key) === 0 && x.price; }).map(function (x) { return x.price; });
    return (MP[m.name] = ps.length ? Math.min.apply(null, ps) : 0);
  }
  function uc(m) { return m.cost_per_unit != null ? { v: m.cost_per_unit, est: false } : { v: m.price || masterPrice(m), est: true }; }
  function hasHist(cid) { return cid !== 'nakagawa'; }
  function disp(m) { return m.name.replace(/　/g, ' '); }
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3200); }
  function addDays(d, n) { var t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }

  // ---------- 帳簿の組み立て ----------
  // 日別×品目の出庫（カルテから）。テスト用＝DBの過去の出庫実績（西春の写し。画面の操作で起きた出庫は台帳の出来事側に出す）
  var HR = { src: null, rows: null };
  function histRows(cid) {
    if (!hasHist(cid)) return [];
    if (!live(cid)) return D.daily_out_nishiharu;
    var mv = SB.moves(cid); if (HR.src === mv) return HR.rows;
    var agg = {};
    mv.forEach(function (m) {
      if ((m.kind !== 'out' && m.kind !== 'karte_out') || m.voided_at || m.stock_before != null) return;
      var k = m.occurred_on + '|' + m.medicine_code, a = agg[k] || (agg[k] = { d: m.occurred_on, c: m.medicine_code, n: 0, q: 0 });
      a.n += 1; a.q += Math.abs(Number(m.qty) || 0);
    });
    HR.src = mv; HR.rows = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    return HR.rows;
  }
  function histOuts(cid, code) { return histRows(cid).filter(function (x) { return x.c === code; }); }
  function lastLot(cid, code) {
    if (!hasHist(cid)) return null;
    var l = D.lots_nishiharu.filter(function (x) { return x.c === code; }).sort(function (a, b) { return a.received_on < b.received_on ? 1 : -1; });
    return l[0] || null;
  }
  function ledger(cid, db, code) {
    var m = med(cid, code), base = db.stock[code], rows = [], hs = histOuts(cid, code), histSum = 0;
    hs.forEach(function (x) { histSum += x.q; rows.push({ date: x.d, ord: 0, kind: 'hist', inq: 0, outq: x.q, n: x.n }); });
    db.events.filter(function (e) { return e.code === code; }).forEach(function (e, i) {
      base -= e.delta;   // 今の在庫から、画面の操作の分を戻して繰越を逆算
      rows.push({ date: e.date, ord: 1 + i, kind: e.type, inq: e.delta > 0 ? e.delta : 0, outq: e.delta < 0 ? -e.delta : 0, ev: e });
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord; });
    var opening = base + histSum, bal = opening, cross = null;
    rows.forEach(function (r) { var prev = bal; bal += r.inq - r.outq; r.bal = bal; if (prev >= 0 && bal < 0) { cross = r; } r.crossed = false; });
    if (cross) cross.crossed = true;
    var from = hasHist(cid) ? HIST_FROM : '2026-09-01';
    return { m: m, rows: rows, opening: opening, from: from, cross: cross, end: bal, histSum: histSum };
  }

  // ---------- ズレの候補 ----------
  function candidates(cid, db) {
    var out = [], ms = meds(cid);
    var counted = {}; db.events.forEach(function (e) { if (e.type === 'adjust') counted[e.code] = 1; });
    // 1) マイナス
    ms.forEach(function (m) {
      if (m.stock_untracked) return; var s = db.stock[m.code]; if (s >= 0) return;
      var L = ledger(cid, db, m.code), lot = lastLot(cid, m.code), why;
      var linkEv = db.events.filter(function (e) { return e.code === m.code && e.type === 'link'; })[0];
      if (linkEv) why = 'カルテの結び付けで ' + md(linkEv.date) + ' の ' + (-linkEv.delta) + m.unit + ' を反映した結果。入荷の記録が無い → 入荷の登録漏れを疑う';
      else if (lot) why = '最後の入荷は ' + md(lot.received_on) + '（' + n0(lot.qty_received) + m.unit + '）。その後の出庫 ' + n0(L.histSum) + m.unit + ' に対し入荷の記録なし' + (L.cross ? '。' + md(L.cross.date) + ' にマイナスへ' : '');
      else if (L.histSum) why = '入荷の記録が一度も無いまま出庫 ' + n0(L.histSum) + m.unit + '。初期の在庫数か入荷の登録漏れ' + (L.cross ? '。' + md(L.cross.date) + ' にマイナスへ' : '');
      else why = '記録上の出入りが無いのにマイナス（コピー元の数字のまま）';
      out.push({ type: 'neg', code: m.code, m: m, stock: s, amount: s * uc(m).v, est: uc(m).est, why: why, sort: s * uc(m).v });
    });
    // 2) カルテ未結び付け
    db.karte.forEach(function (k, i) {
      if (db.links[k.karte_name]) return;
      out.push({ type: 'karte', karteIdx: i, k: k, stock: null, amount: null, why: md(k.date) + ' カルテで ' + k.qty + k.unit + ' 処方 → 在庫が減っていない。' + k.reason, sort: -1e6 + i });
    });
    // 3) 出庫の急増・停止（直近7日 と その前2週の週平均）
    if (hasHist(cid)) {
      var agg = {};
      histRows(cid).forEach(function (x) {
        var a = agg[x.c] || (agg[x.c] = { r: 0, p: 0 });
        if (x.d >= '2026-09-20') a.r += x.q; else if (x.d >= '2026-09-06') a.p += x.q;
      });
      Object.keys(agg).forEach(function (c) {
        var a = agg[c], pw = a.p / 2, m = med(cid, c); if (!m) return;
        if (pw > 0 && a.r >= pw * 3 && a.r - pw >= 150) out.push({ type: 'spike', code: c, m: m, stock: db.stock[c], amount: null, why: '直近7日の出庫 ' + n0(a.r) + m.unit + '＝その前2週の週平均 ' + n0(pw) + m.unit + ' の ' + (a.r / pw).toFixed(1) + '倍。処方の増加か、量・規格の取り違えかを台帳で確認', sort: 1e6 - a.r });
        if (a.r === 0 && pw >= 3) out.push({ type: 'stop', code: c, m: m, stock: db.stock[c], amount: null, why: '9/20以降の出庫が0（それまで週 ' + pw.toFixed(1) + m.unit + '）。カルテの薬名が変わり結び付かなくなった可能性', sort: 2e6 });
      });
    }
    // 4) 長く数えていない（棚卸の記録なし）→ 在庫金額の大きい順に5品目
    var never = ms.filter(function (m) { return !m.stock_untracked && !counted[m.code] && db.stock[m.code] > 0; });
    never.sort(function (a, b) { return db.stock[b.code] * uc(b).v - db.stock[a.code] * uc(a).v; });
    never.slice(0, 5).forEach(function (m) {
      out.push({ type: 'count', code: m.code, m: m, stock: db.stock[m.code], amount: db.stock[m.code] * uc(m).v, est: uc(m).est, why: '数えた記録がありません（棚卸の記録0件）。在庫金額が大きい順', sort: 3e6 - db.stock[m.code] * uc(m).v });
    });
    // 5) 入荷の二重（同じ日・同じ品目・同じ数量）
    var seen = {}, dups = [];
    (hasHist(cid) ? D.lots_nishiharu : []).map(function (l) { return { c: l.c, d: l.received_on, q: l.qty_received }; })
      .concat(db.events.filter(function (e) { return e.type === 'inbound'; }).map(function (e) { return { c: e.code, d: e.date, q: e.delta }; }))
      .forEach(function (x) { var k = x.c + '|' + x.d + '|' + x.q; if (seen[k]) dups.push(x); seen[k] = 1; });
    dups.forEach(function (x) { var m = med(cid, x.c); out.push({ type: 'dup', code: x.c, m: m, stock: db.stock[x.c], amount: x.q * uc(m).v, why: md(x.d) + ' に同じ数量（' + x.q + '）の入荷が2件', sort: 4e6 }); });
    out.sort(function (a, b) { return a.sort - b.sort; });
    return { list: out, neverCount: never.length, dupCount: dups.length };
  }
  var TYPE = {
    neg: ['マイナス', 'st-neg'], karte: ['カルテ未結び付け', 'st-karte'], spike: ['出庫の急増', 'st-spike'],
    stop: ['出庫の停止', 'st-stop'], count: ['数えていない', 'st-count'], dup: ['入荷の二重', 'st-dup']
  };

  // ---------- 描画：共通 ----------
  function db() { return load(S.clinic); }
  function renderHeader() {
    var c = clinic(S.clinic);
    document.documentElement.style.setProperty('--cl', c.color);
    $('#hdName').textContent = c.name;
    $('#hdOp').textContent = S.op;
    $('#hdSwatch').style.background = S.clinic === 'test' ? 'repeating-linear-gradient(135deg,#b8860b 0 5px,#f3dfa8 5px 10px)' : c.color;
    $('#hd').classList.toggle('test', S.clinic === 'test');
    var hp = $('#hdPractice'); hp.hidden = false;
    hp.textContent = live(S.clinic) ? '本番DBに接続中（テスト用の院）・操作すると実際に値が動きます（西春・中川には影響しません）'
      : S.clinic === 'test' ? 'DBに接続できないため見本データで表示中（書き込みしません）' : '見本データ（書き込みしません）';
    hp.classList.toggle('live', live(S.clinic));
    var d = db(), cs = candidates(S.clinic, d);
    $('#tcCand').textContent = cs.list.filter(function (x) { return x.type === 'neg' || x.type === 'karte' || x.type === 'dup'; }).length || '';
    $('#tcLink').textContent = cs.list.filter(function (x) { return x.type === 'karte'; }).length || '';
    [].forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
  }
  function render() {
    renderHeader();
    var p = $('#pane');
    if (S.tab === 'cand') p.innerHTML = viewCand();
    else if (S.tab === 'ledger') p.innerHTML = viewLedger();
    else if (S.tab === 'link') p.innerHTML = viewLink();
    else p.innerHTML = viewClose();
    bindPane();
  }

  // ---------- 一：ズレの候補 ----------
  function viewCand() {
    var d = db(), cs = candidates(S.clinic, d), L = cs.list;
    function cnt(t) { return L.filter(function (x) { return x.type === t; }).length; }
    var negAmt = L.filter(function (x) { return x.type === 'neg'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    var h = '<div class="sec-title"><h2>ズレの候補</h2><span class="muted">帳簿（アプリの在庫）と実際の棚が食い違っていそうな品目を、記録から自動で拾い出しています。行を押すと台帳が開きます。</span></div>';
    h += '<div class="tally">' +
      '<div><div class="k">マイナス在庫</div><div class="v neg">' + cnt('neg') + '<small>品目 ' + yen(negAmt) + '</small></div></div>' +
      '<div><div class="k">カルテで減らなかった薬</div><div class="v" style="color:#8a4b00">' + cnt('karte') + '<small>件</small></div></div>' +
      '<div><div class="k">出庫の急増</div><div class="v">' + cnt('spike') + '<small>品目</small></div></div>' +
      '<div><div class="k">出庫の停止</div><div class="v">' + cnt('stop') + '<small>品目</small></div></div>' +
      '<div><div class="k">数えた記録なし</div><div class="v">' + cs.neverCount + '<small>品目' + (cs.neverCount > 5 ? '（上位5を表示）' : '') + '</small></div></div>' +
      '<div><div class="k">入荷の二重（同日・同数量）</div><div class="v">' + cs.dupCount + '<small>' + (cs.dupCount ? '件' : '件 該当なし') + '</small></div></div></div>';
    if (!L.length) return h + '<div class="empty">候補はありません。' + (S.clinic === 'nakagawa' ? '開院前で在庫・出庫の記録がまだありません（品目は西春からコピー、在庫0）。' : '') + '</div>';
    h += '<div style="max-height:calc(100vh - 300px);overflow:auto;border:1px solid var(--rule2)"><table class="lg"><thead><tr><th>種別</th><th>品目</th><th class="num">帳簿の在庫</th><th class="num">金額（仕入値）</th><th>なぜ怪しいか</th><th></th></tr></thead><tbody>';
    L.forEach(function (x, i) {
      var t = TYPE[x.type];
      var name = x.type === 'karte' ? '<b>' + esc(x.k.karte_name) + '</b><div class="sub">カルテの薬名（' + x.k.qty + x.k.unit + '・' + md(x.k.date) + '）</div>' : '<b>' + esc(disp(x.m)) + '</b><div class="sub">' + x.code + '・' + esc(x.m.category) + '</div>';
      var btn = x.type === 'karte' ? '<button class="btn small" data-go-link="' + x.karteIdx + '" id="golink-' + x.karteIdx + '">結び付ける</button>' : '<button class="btn small" data-go-ledger="' + x.code + '" id="open-' + x.type + '-' + x.code + '">台帳を開く</button>';
      h += '<tr class="click' + (x.type === 'neg' ? ' ' : '') + '" data-row="' + i + '"><td><span class="stamp ' + t[1] + '">' + t[0] + '</span></td><td>' + name + '</td>' +
        '<td class="num ' + nc(x.stock) + '">' + (x.stock == null ? '—' : n0(x.stock) + ' <span class="sub">' + esc(x.m.unit) + '</span>') + '</td>' +
        '<td class="num ' + nc(x.amount || 0) + '">' + (x.amount == null ? '—' : yen(x.amount) + (x.est ? '<div class="sub">薬価で仮計算</div>' : '')) + '</td>' +
        '<td style="font-size:14px">' + esc(x.why) + '</td><td>' + btn + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ---------- 二：品目の台帳 ----------
  function chartSVG(L, cid) {
    var W = 900, H = 250, ml = 62, mr = 200, mt = 22, mb = 34, pw = W - ml - mr, ph = H - mt - mb;
    var days = [], d = L.from; while (d <= TODAY) { days.push(d); d = addDays(d, 1); }
    var byDay = {}, outDay = {}, evs = [];
    var bal = L.opening; L.rows.forEach(function (r) { byDay[r.date] = r.bal; if (r.kind === 'hist') outDay[r.date] = (outDay[r.date] || 0) + r.outq; else evs.push(r); });
    var series = [], b = L.opening; days.forEach(function (dd) { if (byDay[dd] != null) b = byDay[dd]; series.push(b); });
    var mn = Math.min(0, L.opening, Math.min.apply(null, series)), mx = Math.max(0, L.opening, Math.max.apply(null, series));
    if (mx === mn) mx = mn + 10; var pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    function X(i) { return ml + pw * i / (days.length - 1); }
    function Y(v) { return mt + ph * (mx - v) / (mx - mn); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="残高の推移">';
    // 罫線（横）
    for (var g = 0; g <= 4; g++) { var gy = mt + ph * g / 4; s += '<line x1="' + ml + '" x2="' + (ml + pw) + '" y1="' + gy + '" y2="' + gy + '" stroke="#dbe9dd" stroke-width="1"/>'; var gv = mx - (mx - mn) * g / 4; s += '<text x="' + (ml - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="13" fill="#5b6b60" font-family="IBM Plex Mono,monospace">' + n0(gv) + '</text>'; }
    // マイナス領域
    var y0 = Y(0); s += '<rect x="' + ml + '" y="' + y0 + '" width="' + pw + '" height="' + Math.max(0, mt + ph - y0) + '" fill="#fbe9e6"/>';
    s += '<line x1="' + ml + '" x2="' + (ml + pw) + '" y1="' + y0 + '" y2="' + y0 + '" stroke="#b3261e" stroke-width="1.5" stroke-dasharray="5 4"/>';
    s += '<text x="' + (ml + pw + 6) + '" y="' + (y0 + 4) + '" font-size="15" fill="#b3261e">0（ここより下はマイナス）</text>';
    // 日別の払出（下に細い棒）
    var mo = 0; Object.keys(outDay).forEach(function (k) { mo = Math.max(mo, outDay[k]); });
    if (mo) {
      days.forEach(function (dd, i) { if (!outDay[dd]) return; var bh = 26 * outDay[dd] / mo; s += '<rect x="' + (X(i) - 4) + '" y="' + (mt + ph - bh) + '" width="8" height="' + bh + '" fill="#9aaea0" opacity=".55"/>'; });
    }
    // 日付の目盛り
    days.forEach(function (dd, i) { if (i % 7 === 0 || i === days.length - 1) s += '<text x="' + X(i) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="13" fill="#5b6b60" font-family="IBM Plex Mono,monospace">' + md(dd) + '</text>'; });
    // 残高の線（階段）
    var path = 'M' + X(0) + ' ' + Y(series[0]);
    series.forEach(function (v, i) { if (i === 0) return; path += ' H' + X(i) + ' V' + Y(v); });
    s += '<path d="' + path + '" fill="none" stroke="#2b6a44" stroke-width="2.5"/>';
    // 直接ラベル：始点・終点
    s += '<text x="' + (X(0) + 4) + '" y="' + (Y(series[0]) - 8) + '" font-size="15" fill="#2b6a44">' + md(days[0]) + ' 繰越 ' + n0(L.opening) + '</text>';
    var ev = series[series.length - 1];
    s += '<circle cx="' + X(days.length - 1) + '" cy="' + Y(ev) + '" r="4" fill="' + (ev < 0 ? '#b3261e' : '#2b6a44') + '"/>';
    s += '<text x="' + (X(days.length - 1) + 8) + '" y="' + (Y(ev) + 4) + '" font-size="16" font-weight="700" fill="' + (ev < 0 ? '#b3261e' : '#2b6a44') + '" font-family="IBM Plex Mono,monospace">本日 ' + n0(ev) + '</text>';
    // マイナスに落ちた日
    if (L.cross) {
      var ci = days.indexOf(L.cross.date);
      if (ci >= 0) { s += '<circle cx="' + X(ci) + '" cy="' + Y(L.cross.bal) + '" r="6" fill="none" stroke="#b3261e" stroke-width="2.5"/>';
        s += '<text x="' + (X(ci) - 10) + '" y="' + (Y(L.cross.bal) + 22) + '" text-anchor="end" font-size="15" font-weight="700" fill="#b3261e">' + md(L.cross.date) + ' ここでマイナスに（' + n0(L.cross.bal) + '）</text>'; }
    }
    // 調整・結び付けの印
    evs.forEach(function (r, k) {
      var i = days.indexOf(r.date); if (i < 0) return;
      var lab = (r.kind === 'link' ? 'カルテ結び付け ' : r.kind === 'inbound' ? '入荷 ' : '調整 ') + sn(r.inq - r.outq);
      s += '<rect x="' + (X(i) - 5) + '" y="' + (Y(r.bal) - 5) + '" width="10" height="10" fill="' + (r.kind === 'link' ? '#8a4b00' : '#1f4e8c') + '"/>';
      s += '<text x="' + (X(i) - 10) + '" y="' + (Y(r.bal) - 10 - k * 14) + '" text-anchor="end" font-size="15" font-weight="700" fill="' + (r.kind === 'link' ? '#8a4b00' : '#1f4e8c') + '">' + lab + '</text>';
    });
    return s + '</svg>';
  }
  function viewLedger() {
    var d = db(), ms = meds(S.clinic);
    if (!med(S.clinic, S.code)) S.code = ms[0].code;
    var list = K.filter(ms, S.itemQ, function (x) { return [x.name, x.furigana, x.code, x.category]; });
    var h = '<div class="ledger-wrap"><div class="itemlist"><input id="itemQ" class="inp" placeholder="品目を探す（ローマ字・かな・コード）" value="' + esc(S.itemQ) + '" autocomplete="off">';
    list.forEach(function (m) {
      var s = d.stock[m.code];
      h += '<div class="it' + (m.code === S.code ? ' on' : '') + '" data-item="' + m.code + '" id="it-' + m.code + '"><div><div class="nm">' + esc(disp(m)) + '</div><div class="cd">' + m.code + '</div></div><div class="num ' + nc(s) + '">' + (m.stock_untracked ? '<span class="stamp st-count">外用</span>' : n0(s)) + '</div></div>';
    });
    if (!list.length) h += '<div class="it muted">見つかりません</div>';
    h += '</div><div>';
    var L = ledger(S.clinic, d, S.code), m = L.m, u = uc(m), lot = lastLot(S.clinic, m.code), cur = d.stock[m.code];
    h += '<div class="item-head"><div><div class="meta">' + m.code + '・' + esc(m.category) + '・' + esc(m.maker || '') + '・入数 ' + (m.pack_size || '—') + '・仕入値 ' + (m.cost_per_unit != null ? '¥' + m.cost_per_unit + '/' + m.unit : '未設定（薬価 ¥' + m.price + ' で仮計算）') + '</div><h2>' + esc(disp(m)) + '</h2></div>' +
      '<div class="bal"><div><div class="k">繰越（' + md(L.from) + '）</div><div class="v">' + n0(L.opening) + '</div></div><div><div class="k">受入</div><div class="v pos">' + n0(L.rows.reduce(function (a, r) { return a + r.inq; }, 0)) + '</div></div><div><div class="k">払出</div><div class="v">' + n0(L.rows.reduce(function (a, r) { return a + r.outq; }, 0)) + '</div></div><div><div class="k">帳簿の在庫</div><div class="v ' + nc(cur) + '">' + (m.stock_untracked ? '外用' : n0(cur)) + '</div></div></div></div>';
    if (m.stock_untracked) h += '<div class="why info">外用の品目です。処方されても在庫は減らしません（数えない品目）。</div>';
    else if (L.cross && cur < 0) h += '<div class="why"><b>' + md(L.cross.date) + ' にマイナスへ。</b>' + (lot ? '最後の入荷は ' + md(lot.received_on) + '（' + n0(lot.qty_received) + m.unit + '・' + esc(lot.supplier) + '）で、それ以降の入荷の記録がありません。棚を数え、納品書と照らしてください。' : '入荷の記録が見当たりません。棚を数え、納品書と照らしてください。') + '</div>';
    else if (lot) h += '<div class="why info">最後の入荷 ' + md(lot.received_on) + '（' + n0(lot.qty_received) + m.unit + '・' + esc(lot.supplier) + '）</div>';
    h += '<div class="ledger-body"><div class="lmain"><div class="chart"><div class="chart-cap">緑の線＝その日の終わりの帳簿の残高　灰色の棒＝日別の払出　赤い地＝マイナス</div>' + chartSVG(L, S.clinic) + '</div>';
    // 明細
    h += '<div class="ltable"><table class="lg"><thead><tr><th>日付</th><th>摘要</th><th class="num">受入</th><th class="num">払出</th><th class="num">残高</th><th>記録した人・理由</th></tr></thead><tbody>';
    h += '<tr><td class="num">' + md(L.from) + '</td><td>繰越（' + (S.clinic === 'test' ? '西春の在庫をコピーし、今の在庫から逆算' : S.clinic === 'nakagawa' ? '西春の品目をコピー・在庫0から開始' : '今の在庫から逆算') + '）</td><td></td><td></td><td class="num ' + nc(L.opening) + '">' + n0(L.opening) + '</td><td></td></tr>';
    L.rows.forEach(function (r) {
      var desc, who = '';
      if (r.kind === 'hist') { desc = '<span class="stamp st-hist">カルテから</span> ' + (S.clinic === 'test' ? 'コピー元（西春）の' : '') + '過去の出庫実績 ' + r.n + '件<span class="sub">（カルテ連動と同じ形で表示）</span>'; who = '自動'; }
      else if (r.kind === 'link') { desc = '<span class="stamp st-link">カルテから</span> ' + (r.ev.karte ? '「' + esc(r.ev.karte) + '」を' : '') + '結び付けてさかのぼって反映'; who = esc(r.ev.op) + '・' + esc(r.ev.reason); }
      else if (r.kind === 'inbound') { desc = '<span class="stamp st-adj">入荷</span> ' + n0(r.ev.before) + ' → ' + n0(r.ev.after) + (r.ev.memo ? '<div class="sub">' + esc(r.ev.memo) + '</div>' : ''); who = esc(r.ev.op); }
      else { desc = '<span class="stamp st-adj">調整</span> 実数 ' + n0(r.ev.after) + '（帳簿 ' + n0(r.ev.before) + '）' + (r.ev.memo ? '<div class="sub">' + esc(r.ev.memo) + '</div>' : ''); who = esc(r.ev.op) + '・' + esc(r.ev.reason); }
      h += '<tr' + (r.crossed ? ' class="hl"' : '') + '><td class="num">' + md(r.date) + '</td><td>' + desc + (r.crossed ? ' <b class="neg">← ここでマイナスに</b>' : '') + '</td><td class="num pos">' + (r.inq ? n0(r.inq) : '') + '</td><td class="num">' + (r.outq ? n0(r.outq) : '') + '</td><td class="num ' + nc(r.bal) + '">' + n0(r.bal) + '</td><td style="font-size:13px">' + who + '</td></tr>';
    });
    if (!L.rows.length) h += '<tr><td colspan="6" class="muted">この院ではまだ出入りの記録がありません（デモ内で操作した分だけ記録されます）。</td></tr>';
    h += '<tr class="sum"><td></td><td>本日の帳簿の在庫</td><td></td><td></td><td class="num ' + nc(L.end) + '">' + n0(L.end) + '</td><td></td></tr>';
    h += '</tbody></table></div></div>';
    // 直す
    if (m.stock_untracked) h += '<div class="adj"><h3>理由を付けて直す</h3><div class="row muted">外用の品目は数えないため、調整はありません。</div></div>';
    else {
      h += '<div class="adj"><h3>理由を付けて直す</h3>' +
        '<div class="row"><label>帳簿の在庫</label><div class="diffline"><span>アプリ上の数</span><b class="' + nc(cur) + '">' + n0(cur) + ' ' + esc(m.unit) + '</b></div></div>' +
        '<div class="row"><label for="adjActual">棚で数えた実数（' + esc(m.unit) + '）</label><input id="adjActual" class="inp big" inputmode="numeric" autocomplete="off"></div>' +
        '<div class="row"><div class="diffline"><span>差（実数−帳簿）</span><b id="adjDiff">—</b></div><div class="diffline"><span>金額の差（' + (u.est ? '薬価で仮計算' : '仕入値 ¥' + u.v + '/' + esc(m.unit)) + '）</span><b id="adjAmt">—</b></div></div>' +
        '<div class="row"><label for="adjReason">理由（必須）</label><select id="adjReason" class="sel"><option value="">理由を選んでください</option>' + D.adjust_reasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
        '<div class="row"><label for="adjMemo">メモ（何を見て確かめたか）</label><textarea id="adjMemo" class="inp" rows="2"></textarea></div>' +
        '<div class="act"><button class="btn solid" id="adjSave" disabled>理由を付けて直す</button></div>' +
        (live(S.clinic) ? '<div class="row sub">本番DB（テスト用の院）に記録され、在庫の数が実際に変わります。</div>' : '') +
        '<div class="row note-red" id="adjMsg" hidden></div></div>';
    }
    return h + '</div></div></div>';
  }

  // ---------- 三：カルテとの結び付け ----------
  function formOf(s) { return /テープ/.test(s) ? 'テープ' : /(細粒|ds|散|ドライシロップ)/i.test(s) ? '粉' : /(錠|カプセル)/.test(s) ? '錠' : /(軟膏|クリーム|ローション)/.test(s) ? '塗り薬' : ''; }
  function scoreCands(k, cid, dbx) {
    var kn = K.norm(k.karte_name), head = (kn.match(/^[ァ-ヴー]+/) || [''])[0];
    var ali = null; Object.keys(ALIAS).forEach(function (a) { if (head.indexOf(a) === 0) ali = [a, ALIAS[a]]; });
    var nums = (kn.match(/\d+(\.\d+)?/g) || []).map(parseFloat), kf = formOf(kn);
    var res = [];
    meds(cid).forEach(function (m) {
      var mn = K.norm(m.name), s = 0, rs = [];
      var h2 = head.replace(/od$/i, '');
      if (h2 && mn.indexOf(h2) === 0) { s += 50; rs.push('成分名「' + h2 + '」が一致'); }
      else if (ali && mn.indexOf(ali[1]) === 0) { s += 45; rs.push('読み替え表：' + ali[0] + '＝' + ali[1]); }
      else if (ali && mn.indexOf(ali[0]) === 0) { s += 30; rs.push('銘柄名「' + ali[0] + '」が一致'); }
      else return;
      var mnums = (mn.match(/\d+(\.\d+)?/g) || []).map(parseFloat);
      if (nums.some(function (n) { return mnums.indexOf(n) >= 0; })) { s += 30; rs.push('規格の数字が一致'); } else rs.push('規格が違う');
      if (kf && formOf(mn) === kf) { s += 15; rs.push('剤形が一致'); } else if (kf) rs.push('剤形が違う（' + (formOf(mn) || '—') + '）');
      if (m.stock_untracked) rs.push('外用・数えない');
      res.push({ m: m, s: Math.min(99, s + (m.stock_untracked ? 4 : 0)), rs: rs });
    });
    // 同名重複（院内で品目が二重登録）の片方は下げる
    res.sort(function (a, b) { return b.s - a.s || (a.m.code < b.m.code ? -1 : 1); });
    return res.slice(0, 6);
  }
  function viewLink() {
    var d = db(), ex = d.karte;
    var h = '<div class="sec-title"><h2>カルテとの結び付け</h2><span class="muted">カルテで処方されたのに、薬名が在庫の品目と一致せず在庫が減らなかった記録です。候補から選んで確定すると、その分がさかのぼって在庫から減り、以後は同じ薬名を自動で結び付けます。' +
      (live(S.clinic) ? '（テスト用の院：本番DBの未処理の記録を表示しています）' : S.clinic === 'nishiharu' ? '（西春：見本の例を表示しています）' : '') + '</span></div>';
    if (S.clinic === 'nakagawa') return h + '<div class="empty">この院ではまだカルテからの記録がありません（開院前）。</div>';
    if (!ex.length) return h + '<div class="empty">カルテで結び付かなかった記録は、いまはありません。</div>';
    if (S.linkSel != null && !ex[S.linkSel]) S.linkSel = null;
    if (S.linkSel == null) { for (var i = 0; i < ex.length; i++) if (!d.links[ex[i].karte_name]) { S.linkSel = i; break; } if (S.linkSel == null) S.linkSel = 0; }
    var k = ex[S.linkSel], linked = d.links[k.karte_name];
    h += '<div class="link-wrap"><div class="col"><h3>カルテの薬名（結び付かなかった記録）</h3>';
    ex.forEach(function (x, i) {
      var l = d.links[x.karte_name];
      h += '<div class="kn' + (i === S.linkSel ? ' on' : '') + '" data-kn="' + i + '" id="kn-' + i + '"><div class="t">' + esc(x.karte_name) + '</div><div class="s">' + md(x.date) + '・' + x.qty + x.unit + '・' + esc(x.reason) + '</div><div style="margin-top:4px">' + (l ? '<span class="stamp st-ok">結び付け済 → ' + l.code + '</span>' : '<span class="stamp st-karte">未結び付け</span>') + '</div></div>';
    });
    h += '<h3 style="border-top:1px solid var(--rule2)">自動で結び付ける読み替え表（この院）</h3>';
    var keys = Object.keys(d.links);
    if (!keys.length) h += '<div class="kn muted" style="cursor:default">まだありません</div>';
    keys.forEach(function (n) { var l = d.links[n], mm = med(S.clinic, l.code); h += '<div class="kn" style="cursor:default"><div class="t">' + esc(n) + '</div><div class="s">→ ' + l.code + ' ' + esc(disp(mm)) + '（' + esc(l.op) + '・' + md(l.date) + ' 登録）</div></div>'; });
    h += '</div>';
    // 候補
    var cands = scoreCands(k, S.clinic, d);
    if (S.linkQ) {
      K.filter(meds(S.clinic), S.linkQ, function (x) { return [x.name, x.furigana, x.code, x.category]; }).slice(0, 8).forEach(function (m) {
        if (!cands.some(function (c) { return c.m.code === m.code; })) cands.push({ m: m, s: null, rs: ['検索で追加'] });
      });
    }
    h += '<div class="col"><h3>在庫の品目の候補（一致度の高い順）</h3>';
    h += '<div style="padding:8px 12px;border-bottom:1px solid var(--rule)"><input id="linkQ" class="inp" style="width:100%;box-sizing:border-box" placeholder="候補に無ければ探す（ローマ字・かな可）" value="' + esc(S.linkQ) + '" autocomplete="off"></div>';
    if (linked) h += '<div class="why info" style="margin:10px">この薬名は ' + linked.code + ' に結び付け済みです。</div>';
    cands.forEach(function (c, i) {
      var on = S.linkPick === c.m.code;
      h += '<div class="cand' + (on ? ' on' : '') + '" data-pick="' + c.m.code + '" id="cd-' + c.m.code + '"><div class="mk">' + (on ? '✓' : '') + '</div><div><div><b>' + esc(disp(c.m)) + '</b> <span class="sub">' + c.m.code + '</span>' + (i === 0 && c.s != null ? ' <span class="stamp st-ok">いちばん近い</span>' : '') + '</div><div class="rs">' + c.rs.map(esc).join('／') + '</div></div><div class="sc">' + (c.s != null ? '一致度 ' + c.s : '') + '</div></div>';
    });
    h += '</div>';
    // 確定前の見込み
    h += '<div class="col"><h3>確定したら在庫はこうなります</h3><div class="preview">';
    var pm = S.linkPick && med(S.clinic, S.linkPick);
    var lev = linked && d.events.filter(function (e) { return e.type === 'link' && e.karte === k.karte_name; })[0];
    if (linked && !lev && linked.res) { var lr = linked.res; lev = { before: Number(lr.before), after: Number(lr.after), delta: Number(lr.after) - Number(lr.before), date: k.date, amount: (Number(lr.after) - Number(lr.before)) * uc(med(S.clinic, linked.code)).v }; }
    if (linked && !pm) {
      var lm = med(S.clinic, linked.code);
      h += '<p style="margin:0 0 6px"><span class="stamp st-ok">確定済み</span> ' + esc(linked.op) + '・' + md(linked.date) + '</p><p style="margin:0 0 6px"><b>' + esc(k.karte_name) + '</b><br>→ <b>' + esc(disp(lm)) + '</b>（' + lm.code + '）</p>';
      if (lev) h += '<div><span class="big ' + nc(lev.before) + '">' + n0(lev.before) + '</span><span class="arrow">→</span><span class="big ' + nc(lev.after) + '">' + n0(lev.after) + '</span> <span class="muted">' + esc(lm.unit) + '</span></div><p style="font-size:14px">' + md(lev.date) + ' のカルテ分 ' + (-lev.delta) + lm.unit + ' をさかのぼって減らしました（金額 <b class="num neg">' + yen(lev.amount) + '</b>）。</p>';
      else h += '<p>外用（数えない品目）のため、在庫は減らしていません。</p>';
      h += '<p style="font-size:14px">' + (linked.auto ? '以後、この薬名は自動でこの品目に結び付きます。' : '今回だけの結び付けです。') + '</p>';
      if (lev && lev.after < 0) h += '<div class="why">この品目はマイナスになりました。「ズレの候補」に入荷漏れの疑いとして載っています。</div>';
      h += '<button class="btn" id="linkToLedger" data-go-ledger="' + lm.code + '" style="width:100%">この品目の台帳を見る</button>';
    }
    else if (!pm) h += '<p class="muted">左で選んだカルテの薬名に対して、真ん中の候補から在庫の品目を1つ選んでください。</p><p style="font-size:14px"><b>' + esc(k.karte_name) + '</b><br>' + md(k.date) + ' に ' + k.qty + k.unit + ' 処方</p>';
    else if (pm.stock_untracked) {
      h += '<p><b>' + esc(disp(pm)) + '</b> は外用（数えない品目）です。</p><p>結び付けは記録しますが、在庫は減らしません。</p>' +
        '<label class="chk"><input type="checkbox" id="linkAuto" checked> 以後「' + esc(k.karte_name) + '」は自動でこの品目に結び付ける</label>' +
        '<button class="btn solid" id="linkSave" style="width:100%;margin-top:8px"' + (linked ? ' disabled' : '') + '>結び付けを確定する</button>';
    } else {
      var before = d.stock[pm.code], after = before - k.qty, u = uc(pm);
      h += '<p style="margin:0 0 6px"><b>' + esc(disp(pm)) + '</b>（' + pm.code + '）</p>' +
        '<p style="margin:0 0 10px;font-size:14px">' + md(k.date) + ' のカルテ分 ' + k.qty + pm.unit + ' を、さかのぼって在庫から減らします。</p>' +
        '<div><span class="big ' + nc(before) + '">' + n0(before) + '</span><span class="arrow">→</span><span class="big ' + nc(after) + '" id="linkAfter">' + n0(after) + '</span> <span class="muted">' + esc(pm.unit) + '</span></div>' +
        '<p style="font-size:14px">金額 <b class="num neg">' + yen(-k.qty * u.v) + '</b>' + (u.est ? '（仕入値未設定のため薬価で仮計算）' : '（仕入値）') + '</p>' +
        (after < 0 ? '<div class="why">結び付けるとマイナスになります。この品目の入荷が登録されていない可能性があります（台帳で確認できます）。</div>' : '') +
        '<label class="chk"><input type="checkbox" id="linkAuto" checked> 以後「' + esc(k.karte_name) + '」は自動でこの品目に結び付ける</label>' +
        '<button class="btn solid" id="linkSave" style="width:100%;margin-top:8px"' + (linked ? ' disabled' : '') + '>結び付けを確定する</button>';
    }
    if (pm && live(S.clinic)) h += '<p class="sub" style="margin-top:8px">確定すると本番DB（テスト用の院）に記録され、在庫の数が実際に変わります。</p>';
    h += '<div class="note-red" id="linkMsg" hidden style="margin-top:8px"></div>';
    h += '</div></div></div>';
    return h;
  }

  // ---------- 四：月末の締め ----------
  function summary(cid) {
    var d = load(cid), ms = meds(cid), inv = 0, est = 0, estN = 0, negN = 0, negAmt = 0, tracked = 0;
    ms.forEach(function (m) {
      if (m.stock_untracked) return; tracked++;
      var s = d.stock[m.code], u = uc(m);
      if (s > 0) { inv += s * u.v; if (u.est) { est += s * u.v; estN++; } }
      if (s < 0) { negN++; negAmt += s * u.v; }
    });
    var ev = d.events.filter(function (e) { return e.date.slice(0, 7) === MONTH; });
    var adj = ev.filter(function (e) { return e.type === 'adjust'; }), lk = ev.filter(function (e) { return e.type === 'link'; });
    var up = adj.filter(function (e) { return e.amount > 0; }).reduce(function (a, e) { return a + e.amount; }, 0);
    var dn = adj.filter(function (e) { return e.amount < 0; }).reduce(function (a, e) { return a + e.amount; }, 0);
    var lkAmt = lk.reduce(function (a, e) { return a + e.amount; }, 0);
    var unl = d.karte.filter(function (k) { return !d.links[k.karte_name]; }).length;
    var closed = d.closes.filter(function (c) { return c.month === MONTH; }).slice(-1)[0];
    return { d: d, tracked: tracked, inv: inv, est: est, estN: estN, negN: negN, negAmt: negAmt, adjN: adj.length, up: up, dn: dn, lkN: lk.length, lkAmt: lkAmt, unl: unl, closed: closed, ev: ev };
  }
  function viewClose() {
    var cur = summary(S.clinic), c = clinic(S.clinic);
    var h = '<div class="item-head"><div><div class="meta">2026年9月（9/1〜9/30）・' + esc(c.name) + '</div><h2>9月の締め ─ 調整の理由と金額を院ごとに確かめる</h2></div><div>' +
      (cur.closed ? '<span class="closed-stamp">締め済 ' + md(cur.closed.date) + ' ' + esc(cur.closed.op) + '</span>' : '<button class="btn solid" id="closeBtn">9月を締める（' + esc(S.op) + '）</button>') + '</div></div>' +
      '<div class="note-red" id="closeMsg" hidden style="margin:0 0 10px"></div>' +
      (live(S.clinic) && !cur.closed ? '<p class="sub" style="margin:0 0 10px">締めると本番DB（テスト用の院）に9月の締めの記録が残ります。</p>' : '');
    if (!cur.closed && (cur.negN || cur.unl)) h += '<div class="why">未解決：マイナス在庫 ' + cur.negN + '品目・カルテ未結び付け ' + cur.unl + '件。締めても消えず、10月の候補に残ります。</div>';
    h += '<div class="close-grid"><div><div class="sec-title"><h2>院を並べて比べる</h2></div><table class="lg cmp"><thead><tr><th></th>';
    var all = D.clinics.map(function (cl) { return { c: cl, s: cl.id === S.clinic ? cur : summary(cl.id) }; });
    all.forEach(function (x) { h += '<th class="num' + (x.c.id === S.clinic ? ' cur' : '') + '"><span class="clh" style="--c:' + x.c.color + ';justify-content:flex-end"><i></i>' + esc(x.c.short) + '</span><div class="sub">' + (live(x.c.id) ? '本番DB' : '見本') + '</div></th>'; });
    h += '</tr></thead><tbody>';
    function row(label, f, cls) { h += '<tr><td>' + label + '</td>'; all.forEach(function (x) { var v = f(x.s); h += '<td class="num' + (x.c.id === S.clinic ? ' cur' : '') + ' ' + (cls ? cls(x.s) : '') + '">' + v + '</td>'; }); h += '</tr>'; }
    row('数える品目', function (s) { return s.tracked; });
    row('在庫金額（仕入値）', function (s) { return yen(s.inv); });
    row('<span class="sub">うち仕入値未設定で薬価の仮計算</span>', function (s) { return yen(s.est) + ' <span class="sub">' + s.estN + '品目</span>'; });
    row('マイナス在庫', function (s) { return s.negN + '品目'; }, function (s) { return s.negN ? 'neg' : ''; });
    row('マイナス分の金額', function (s) { return yen(s.negAmt); }, function (s) { return s.negAmt < 0 ? 'neg' : ''; });
    row('今月の調整', function (s) { return s.adjN + '件'; });
    row('調整で増えた金額', function (s) { return syen(s.up); }, function () { return 'pos'; });
    row('調整で減った金額', function (s) { return syen(s.dn); }, function (s) { return s.dn < 0 ? 'neg' : ''; });
    row('カルテ結び付けで減った金額', function (s) { return syen(s.lkAmt) + ' <span class="sub">' + s.lkN + '件</span>'; }, function (s) { return s.lkAmt < 0 ? 'neg' : ''; });
    row('カルテ未結び付け', function (s) { return s.unl + '件'; }, function (s) { return s.unl ? 'neg' : ''; });
    h += '<tr class="sum"><td>締めの状態</td>'; all.forEach(function (x) { h += '<td class="num' + (x.c.id === S.clinic ? ' cur' : '') + '">' + (x.s.closed ? '締め済' : '未') + '</td>'; }); h += '</tr>';
    h += '</tbody></table><p class="muted" style="font-size:12px">西春・中川の列は見本データです（西春の写し・中川は開院前のため在庫0・記録なし）。テスト用は本番DBの「テスト用の院」の値で、西春の在庫を写した練習用です（西春・中川の在庫には影響しません）。</p></div>';
    // 理由別
    h += '<div><div class="sec-title"><h2>理由別の調整（' + esc(c.short) + '）</h2><span class="muted">件数と金額（仕入値）</span></div><div class="bars">';
    var by = {}; cur.ev.forEach(function (e) { var r = e.reason; (by[r] = by[r] || { n: 0, a: 0 }); by[r].n++; by[r].a += e.amount; });
    var mx = 1; Object.keys(by).forEach(function (r) { mx = Math.max(mx, Math.abs(by[r].a)); });
    D.adjust_reasons.forEach(function (r) {
      var v = by[r] || { n: 0, a: 0 };
      h += '<div class="bar-row"><div class="lbl">' + esc(r) + ' <span class="sub">' + v.n + '件</span></div><div class="track"><div class="fill' + (v.a < 0 ? ' minus' : '') + '" style="--w:' + (100 * Math.abs(v.a) / mx).toFixed(1) + '%"></div></div><div class="num ' + (v.a < 0 ? 'neg' : v.a > 0 ? 'pos' : 'muted') + '">' + (v.n ? syen(v.a) : '—') + '</div></div>';
    });
    h += '</div>';
    h += '<div class="sec-title" style="margin-top:16px"><h2>差が大きい品目</h2></div><table class="lg"><thead><tr><th>品目</th><th>理由</th><th class="num">差</th><th class="num">金額</th><th>担当</th></tr></thead><tbody>';
    var big = cur.ev.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); }).slice(0, 6);
    if (!big.length) h += '<tr><td colspan="5" class="muted">今月の調整はまだありません。</td></tr>';
    big.forEach(function (e) { var m = med(S.clinic, e.code); h += '<tr><td>' + esc(disp(m)) + '<div class="sub">' + e.code + (e.memo ? '・' + esc(e.memo) : '') + '</div></td><td style="font-size:13px">' + esc(e.reason) + '</td><td class="num ' + nc(e.delta) + '">' + sn(e.delta) + '</td><td class="num ' + nc(e.amount) + '">' + syen(e.amount) + '</td><td style="font-size:13px">' + esc(e.op) + '</td></tr>'; });
    h += '</tbody></table></div></div>';
    return h;
  }

  // ---------- 操作 ----------
  function bindPane() {
    var p = $('#pane');
    [].forEach.call(p.querySelectorAll('[data-go-ledger]'), function (b) { b.onclick = function (e) { e.stopPropagation(); S.code = b.dataset.goLedger; S.itemQ = ''; S.tab = 'ledger'; render(); }; });
    [].forEach.call(p.querySelectorAll('[data-go-link]'), function (b) { b.onclick = function (e) { e.stopPropagation(); S.linkSel = +b.dataset.goLink; S.linkPick = null; S.linkQ = ''; S.tab = 'link'; render(); }; });
    [].forEach.call(p.querySelectorAll('tr[data-row]'), function (tr) { tr.onclick = function () { var b = tr.querySelector('button'); if (b) b.click(); }; });
    [].forEach.call(p.querySelectorAll('[data-item]'), function (it) { it.onclick = function () { S.code = it.dataset.item; render(); }; });
    var q = $('#itemQ'); if (q) q.oninput = function () { S.itemQ = q.value; var pos = q.selectionStart; render(); var q2 = $('#itemQ'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} };
    // 調整
    var a = $('#adjActual');
    if (a) {
      var upd = function () {
        var d = db(), m = med(S.clinic, S.code), cur = d.stock[m.code], v = a.value.trim(), ok = /^-?\d+$/.test(v), u = uc(m);
        if (ok) { var diff = +v - cur; $('#adjDiff').textContent = sn(diff) + ' ' + m.unit; $('#adjDiff').className = diff < 0 ? 'neg' : 'pos'; $('#adjAmt').textContent = syen(diff * u.v); $('#adjAmt').className = diff < 0 ? 'neg' : 'pos'; }
        else { $('#adjDiff').textContent = '—'; $('#adjAmt').textContent = '—'; }
        $('#adjSave').disabled = !(ok && $('#adjReason').value);
      };
      a.oninput = upd; $('#adjReason').onchange = upd; $('#adjReason').oninput = upd;
      $('#adjSave').onclick = async function () {
        var btn = this, d = db(), m = med(S.clinic, S.code), cur = d.stock[m.code], v = +a.value.trim(), r = $('#adjReason').value;
        if (!r || isNaN(v) || S.busy) return;
        if (!SB.canWrite(S.clinic)) { showMsg('#adjMsg', roHTML()); return; }
        S.busy = true; btn.disabled = true; btn.textContent = '送信中…';
        try {
          var res = await SB.apply('test', [{ code: m.code, kind: 'count', count: v, reason: r, note: $('#adjMemo').value.trim() || null }], S.op, 'demo:G');
          var x = res && res[0];
          await afterWrite(); S.busy = false; render();
          var msg = disp(m) + '：' + n0(x ? x.before : cur) + ' → ' + n0(x ? x.after : v) + '（' + r + '）で直しました';
          toast(Number(x && x.delta) === 0 ? '帳簿と実数が同じです。数えた記録として残しました' : msg);
        } catch (e) {
          S.busy = false; btn.disabled = false; btn.textContent = '理由を付けて直す';
          showMsg('#adjMsg', '直せませんでした（在庫の数は変わっていません）：' + esc(e.message));
        }
      };
    }
    // 結び付け
    [].forEach.call(p.querySelectorAll('[data-kn]'), function (el) { el.onclick = function () { S.linkSel = +el.dataset.kn; S.linkPick = null; S.linkQ = ''; render(); }; });
    [].forEach.call(p.querySelectorAll('[data-pick]'), function (el) { el.onclick = function () { S.linkPick = el.dataset.pick; render(); }; });
    var lq = $('#linkQ'); if (lq) lq.oninput = function () { S.linkQ = lq.value; var pos = lq.selectionStart; render(); var l2 = $('#linkQ'); l2.focus(); try { l2.setSelectionRange(pos, pos); } catch (e) {} };
    var ls = $('#linkSave');
    if (ls) ls.onclick = async function () {
      var btn = this, d = db(), k = d.karte[S.linkSel], m = med(S.clinic, S.linkPick);
      if (!k || !m || d.links[k.karte_name] || S.busy) return;
      if (!SB.canWrite(S.clinic) || k.id == null) { showMsg('#linkMsg', roHTML()); return; }
      var auto = $('#linkAuto').checked;
      var note = 'カルテ名「' + k.karte_name + '」→ ' + m.code + (auto ? '・以後この薬名は自動でこの品目に結び付ける' : '・今回だけの結び付け');
      S.busy = true; btn.disabled = true; btn.textContent = '送信中…';
      try {
        var res = m.stock_untracked
          ? await SB.resolveUnmatched('test', k.id, 'dismissed', m.code, S.op, note + '・外用（数えない品目）のため在庫は減らさない')
          : await SB.resolveUnmatched('test', k.id, 'linked', m.code, S.op, note);
        SESSION_LINKS[k.karte_name] = { code: m.code, op: S.op, date: TODAY, auto: auto, k: k, res: m.stock_untracked ? null : (res && res[0]) || null };
        await afterWrite(); S.busy = false; S.linkPick = null; render();
        var x = res && res[0];
        toast(m.stock_untracked ? '「' + k.karte_name + '」を ' + m.code + ' に結び付けました（外用のため在庫は減らしません）'
          : '「' + k.karte_name + '」を ' + m.code + ' に結び付け、' + k.qty + m.unit + ' をさかのぼって減らしました' + (x ? '（' + n0(x.before) + ' → ' + n0(x.after) + '）' : ''));
      } catch (e) {
        S.busy = false; btn.disabled = false; btn.textContent = '結び付けを確定する';
        showMsg('#linkMsg', '結び付けできませんでした（在庫の数は変わっていません）：' + esc(e.message));
      }
    };
    // 締め
    var cb = $('#closeBtn');
    if (cb) cb.onclick = async function () {
      if (S.busy) return;
      if (!SB.canWrite(S.clinic)) { showMsg('#closeMsg', roHTML()); return; }
      var s = summary(S.clinic);
      S.busy = true; cb.disabled = true; cb.textContent = '送信中…';
      try {
        await SB.saveDoc('test', null, 'close', MONTH, 'closed', { month: MONTH, date: TODAY, time: nowHM(), op: S.op, inv: Math.round(s.inv), negN: s.negN, negAmt: Math.round(s.negAmt), adjN: s.adjN, up: Math.round(s.up), dn: Math.round(s.dn), lkN: s.lkN, unl: s.unl }, S.op);
        await afterWrite(); S.busy = false; render(); toast('9月を締めました（在庫金額 ' + yen(s.inv) + '）');
      } catch (e) {
        S.busy = false; cb.disabled = false; cb.textContent = '9月を締める（' + S.op + '）';
        showMsg('#closeMsg', '締めを記録できませんでした：' + esc(e.message));
      }
    };
  }

  // ---------- 起動 ----------
  function enterClinic(cid) {
    S.clinic = cid; S.linkSel = null; S.linkPick = null; S.itemQ = ''; S.linkQ = '';
    if (!med(S.clinic, S.code)) S.code = meds(S.clinic)[0].code;
    $('#boot').hidden = true; $('#app').hidden = false; render(); window.scrollTo(0, 0);
  }
  function bootStatus() {
    var el = $('#bootLive'); if (!el) return;
    el.className = 'boot-live ' + (SB.live ? 'on' : 'off');
    el.textContent = SB.live ? 'テスト用の院は本番DBに接続中です。操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データで表示し、書き込みはしません。'
      : 'DBに接続できないため、テスト用の院も見本データで表示しています（書き込みはできません）' + (SB.error ? '：' + SB.error : '');
  }
  function boot() {
    cleanupOld(); loadPref();
    var bc = $('#bootClinics');
    bc.innerHTML = D.clinics.map(function (c) {
      var tag = c.id === 'test' ? '本番DBに接続・値が動く' : '見本データ・書き込みしない';
      return '<button class="clinic-btn' + (c.id === 'test' ? ' test' : '') + '" id="clinic-' + c.id + '" data-clinic="' + c.id + '" style="--c:' + c.color + '" disabled><b>' + esc(c.short) + '</b><span>' + esc(c.name) + '</span><span>' + esc(c.note || '日中外来・在宅＋夜間休日ドライブスルー外来。在庫アプリ稼働中') + '</span><span class="clinic-tag">' + tag + '</span></button>';
    }).join('');
    $('#bootOp').innerHTML = D.operators.map(function (o) { return '<option' + (o === S.op ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    $('#bootOp').onchange = function () { S.op = $('#bootOp').value; savePref(); };
    [].forEach.call(bc.querySelectorAll('[data-clinic]'), function (b) {
      b.onclick = function () { S.op = $('#bootOp').value; savePref(); enterClinic(b.dataset.clinic); };
    });
    [].forEach.call(document.querySelectorAll('.tab'), function (t) { t.onclick = function () { S.tab = t.dataset.tab; render(); }; });
    $('#btnSwitch').onclick = function () { $('#app').hidden = true; $('#boot').hidden = false; };
    function resetBtn(btn) {
      var armed = false, t;
      btn.onclick = async function () {
        if (btn.disabled) return;
        if (!armed) { armed = true; btn.dataset.label = btn.textContent; btn.textContent = 'もう一度押すと初期化します'; btn.classList.add('danger'); t = setTimeout(function () { armed = false; btn.textContent = btn.dataset.label; btn.classList.remove('danger'); }, 4000); return; }
        clearTimeout(t); armed = false; btn.classList.remove('danger');
        if (!SB.live) { btn.textContent = btn.dataset.label; toast('DBに接続できないため初期化できません'); return; }
        btn.disabled = true; btn.textContent = '初期化中…';
        try {
          await SB.resetTest(); SESSION_LINKS = {};
          S.tab = 'cand'; S.code = 'M005'; S.linkSel = null; S.linkPick = null;
          $('#app').hidden = true; $('#boot').hidden = false; toast('テスト用の院を初期状態に戻しました（西春・中川は見本のまま）');
        } catch (e) { toast('初期化できませんでした：' + e.message); }
        btn.disabled = false; btn.textContent = btn.dataset.label;
      };
    }
    resetBtn($('#btnReset')); resetBtn($('#btnResetBoot'));
    SB.ready.then(function () {
      bootStatus();
      [].forEach.call(bc.querySelectorAll('[data-clinic]'), function (b) { b.disabled = false; });
    });
  }
  window.G_DEMO = { state: S, render: render, db: db };
  boot();
})();
