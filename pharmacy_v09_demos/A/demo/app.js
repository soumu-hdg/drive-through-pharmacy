/* 案A 夜間ドライブスルー窓口の出荷（処方）。本番DBには接続しない。状態は localStorage に院ごと */
(function () {
  'use strict';
  var D = window.DEMO_DATA, KS = window.KanaSearch;
  var LS = 'p9A.';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nf = function (s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim(); };
  var fmt = function (n) { return (Math.round(n * 100) / 100).toLocaleString('ja-JP'); };

  function lsGet(k, d) { try { var v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { } }

  /* ---- 体重からの量の目安（デモ用。本番は系統ごとに院で設定） ---- */
  var DOSE_RULE = {
    'カロナール細粒': 0.02, 'アスベリン散': 0.02, 'カルボシステインDS': 0.06, 'ミヤBM細粒': 0.075,
    'ビオフェルミン配合散': 0.1, 'セファクロル細粒': 0.15, 'ワイドシリン細粒': 0.15, 'オセルタミビルDS': 0.133
  };
  function doseOf(m) { var x = nf(m.name).match(/([0-9.]+)\s*g$/); return x ? parseFloat(x[1]) : null; }
  function suggestCode(group, members, pt) {
    if (!pt || !pt.weight) return null;
    var f = DOSE_RULE[group], target;
    if (group === 'フェキソフェナジンDS') target = pt.age < 2 ? 0.3 : 0.6;
    else if (f) target = pt.weight * f;
    else return members.length === 1 ? members[0].code : null;
    var best = null, bd = 1e9;
    members.forEach(function (m) { var d = doseOf(m); if (d != null && Math.abs(d - target) < bd) { bd = Math.abs(d - target); best = m.code; } });
    return best;
  }

  /* ---- 状態 ---- */
  var S = { clinic: lsGet('clinic', null), theme: lsGet('theme', 'night'), op: lsGet('op', '看護師E'),
    view: 'out', patient: null, weight: null, cart: [], stockFilter: '全て', inPick: null, inQty: 10 };
  var C = null; // 院のデータ { meds:[], stock:{}, log:[] }

  function loadClinic(id) {
    var meds = D.medicines[id].map(function (m) { return m; });
    var st = lsGet('st.' + id, null);
    if (!st) { st = { stock: {}, log: [] }; meds.forEach(function (m) { st.stock[m.code] = m.current_stock; }); }
    C = { id: id, meds: meds, byCode: {}, stock: st.stock, log: st.log };
    meds.forEach(function (m) { C.byCode[m.code] = m; });
    buildFreq();
  }
  function saveClinic() { lsSet('st.' + C.id, { stock: C.stock, log: C.log }); }

  /* 過去の出荷回数（西春の実績を全院の初期値に使う）＋この端末で出した回数 */
  var BASE_N = {}, BASE_Q = {};
  D.daily_out_nishiharu.forEach(function (r) { BASE_N[r.c] = (BASE_N[r.c] || 0) + (+r.n); BASE_Q[r.c] = (BASE_Q[r.c] || 0) + (+r.q); });
  function counts() {
    var n = {}; Object.keys(BASE_N).forEach(function (k) { n[k] = BASE_N[k]; });
    C.log.forEach(function (h) { if (h.kind === 'out' && !h.cx) h.lines.forEach(function (l) { n[l.code] = (n[l.code] || 0) + 1; }); });
    return n;
  }
  function defQty(code) { var n = BASE_N[code]; return n ? Math.max(1, Math.round(BASE_Q[code] / n)) : 1; }

  var FREQ = [];
  function buildFreq() {
    var n = counts(), agg = {};
    C.meds.forEach(function (m) {
      var key = m.group_name ? 'g:' + m.group_name : m.code;
      agg[key] = agg[key] || { key: key, n: 0, group: m.group_name, members: [] };
      agg[key].n += (n[m.code] || 0); agg[key].members.push(m);
    });
    FREQ = Object.keys(agg).map(function (k) { return agg[k]; }).filter(function (a) { return a.n > 0; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
  }

  /* ---- 表示の切替 ---- */
  function applyTheme() { document.documentElement.setAttribute('data-theme', S.theme); }
  function clinicInfo(id) { return D.clinics.filter(function (c) { return c.id === id; })[0]; }

  function showClinicScreen() {
    $('#app').hidden = true; $('#scrClinic').hidden = false;
    closeSheets();
    document.documentElement.removeAttribute('data-clinic');
    var notes = { nishiharu: '日中外来・在宅・夜間休日ドライブスルー', nakagawa: '11月開院予定。品目は西春から写し、在庫は0から', test: '練習・撮影用。本番の在庫に影響しません' };
    var inks = { nishiharu: '#fff', nakagawa: '#fff', test: '#1a1400' };
    $('#clinicList').innerHTML = D.clinics.map(function (c) {
      return '<button type="button" class="cs-item' + (S.clinic === c.id ? ' cur' : '') + '" id="pick-' + c.id + '" data-id="' + c.id + '">' +
        '<span class="cs-sw' + (c.id === 'test' ? ' stripe' : '') + '" style="background-color:' + c.color + ';color:' + inks[c.id] + '">' + esc(c.short) + '</span>' +
        '<span class="cs-txt"><b>' + esc(c.name) + '</b><span>' + esc(notes[c.id]) + '</span></span></button>';
    }).join('');
  }
  function enterClinic(id) {
    S.clinic = id; lsSet('clinic', id);
    S.patient = null; S.cart = []; S.weight = null; S.lastRec = null;
    loadClinic(id);
    document.documentElement.setAttribute('data-clinic', id);
    var c = clinicInfo(id);
    $('#clinicShort').textContent = c.short;
    $('#practiceBand').hidden = id !== 'test';
    $('#scrClinic').hidden = true; $('#app').hidden = false;
    $('#lastBar').hidden = true;
    setView('out');
  }

  function setView(v) {
    S.view = v;
    ['out', 'stock', 'in', 'order', 'hist', 'use'].forEach(function (k) {
      $('#v-' + k).hidden = k !== v;
      $('#tab-' + k).classList.toggle('on', k === v);
    });
    $('#sendBar').hidden = v !== 'out';
    $('#lastBar').hidden = true;
    render();
    if (v === 'out' && S.lastRec && !S.patient) showLast(S.lastRec);
    window.scrollTo(0, 0);
  }

  function render() {
    if (!C) return;
    if (S.view === 'out') renderOut();
    if (S.view === 'stock') renderStock();
    if (S.view === 'in') renderIn();
    if (S.view === 'order') renderOrder();
    if (S.view === 'hist') renderHist();
    if (S.view === 'use') renderUse();
  }

  /* ---- 出荷（処方） ---- */
  function stockCell(m) {
    if (m.stock_untracked) return '<span class="ext">外用</span>';
    var s = C.stock[m.code];
    return '<span class="num' + (s < 0 ? ' neg' : '') + '">' + fmt(s) + '</span>';
  }
  function short(m) { return nf(m.name).replace(/COVID19\+Flu/, 'コロナ+インフル'); }

  function renderOut() {
    var neg = C.meds.filter(function (m) { return !m.stock_untracked && C.stock[m.code] < 0; });
    var chip = $('#minusChip');
    chip.hidden = !neg.length;
    chip.textContent = '在庫がマイナスの薬 ' + neg.length + '品目（在庫タブで確認）';

    var p = S.patient, pb = $('#patientBtn');
    if (!p) pb.innerHTML = '<span class="pb-empty">患者を選ぶ</span>';
    else pb.innerHTML = '<span class="pb-name">' + esc(p.name) + (p.weight ? '<span class="kid">小児</span>' : '') + '<small>' + esc(p.no) + '</small></span>' +
      '<span class="pb-body"><span><b class="num">' + p.age + '</b> 歳</span>' + (S.weight ? '<span><b class="num">' + S.weight + '</b> kg</span>' : '') + '</span>';

    var inCart = {}; S.cart.forEach(function (l) { var m = C.byCode[l.code]; var k = m.group_name ? 'g:' + m.group_name : m.code; inCart[k] = (inCart[k] || 0) + 1; });
    $('#freqGrid').innerHTML = FREQ.map(function (f) {
      var m = f.members[0], sub;
      if (f.group) sub = '<span>' + f.members.length + '種類</span>';
      else sub = '<span>' + esc(m.unit) + '</span>' + stockCell(m);
      var nm = f.group ? nf(f.group) : short(m);
      return '<button type="button" class="fq' + (f.group ? ' group' : '') + (inCart[f.key] ? ' in' : '') + '" data-key="' + esc(f.key) + '">' +
        '<span class="nm">' + esc(nm) + '</span><span class="sub">' + sub + '</span>' + (inCart[f.key] ? '<span class="cnt">' + inCart[f.key] + '</span>' : '') + '</button>';
    }).join('');

    renderSearch();
    renderCart();
  }

  function renderSearch() {
    var q = $('#medSearch').value.trim(), box = $('#medResults'), ra = $('#readAs');
    if (!q) { box.innerHTML = ''; ra.textContent = ''; return; }
    var first = q.split(/\s+/)[0];
    ra.textContent = /[a-z]/i.test(first) && !/^m\d/i.test(first) ? '読み替え: ' + KS.romaji(first) : '';
    var hits = KS.filter(C.meds, q, function (m) { return [m.name, m.furigana, m.code, m.category, m.group_name]; });
    box.innerHTML = hits.slice(0, 8).map(function (m) {
      return '<button type="button" class="res" data-code="' + m.code + '"><span class="rn">' + esc(short(m)) + '<small>' + m.code + '・' + esc(m.category) + '</small></span>' +
        '<span class="rs">' + stockCell(m) + (m.stock_untracked ? '' : ' <small>' + esc(m.unit) + '</small>') + '</span></button>';
    }).join('') + (hits.length > 8 ? '<div class="res-more">ほか ' + (hits.length - 8) + '件。続けて量などを打つと絞れます（例: karonaru 0.3）</div>' : '') +
      (hits.length ? '' : '<div class="res-more">見つかりません</div>');
  }

  function lineState(l) {
    var m = C.byCode[l.code];
    if (m.stock_untracked) return { cls: 'ext', html: '<span>在庫は数えません</span><span class="flag ext">外用</span>' };
    var s = C.stock[m.code], after = s - l.qty;
    if (after < 0) return { cls: 'over', html: '<span>在庫 <b class="num">' + fmt(s) + '</b> → <b class="num">' + fmt(after) + '</b></span><span class="flag bad">' + (s < 0 ? 'すでにマイナス' : '在庫を超えます') + '</span>' };
    return { cls: '', html: '<span>在庫 <b class="num">' + fmt(s) + '</b> → <b class="num">' + fmt(after) + '</b></span><span class="flag ok">足ります</span>' };
  }

  function renderCart() {
    var box = $('#cart');
    $('#cartCount').textContent = S.cart.length ? S.cart.length + '品目' : '';
    if (!S.cart.length) box.innerHTML = '<div class="cart-empty">上のボタンか検索で薬を入れてください</div>';
    else box.innerHTML = S.cart.map(function (l, i) {
      var m = C.byCode[l.code], st = lineState(l);
      return '<div class="line ' + st.cls + '" data-code="' + m.code + '"><div class="line-top"><div class="line-nm">' + esc(short(m)) + '<small>' + m.code + '</small></div>' +
        '<div class="stepper"><button type="button" class="minus" data-i="' + i + '" aria-label="減らす">−</button><span class="q num">' + l.qty + '<small>' + esc(m.unit) + '</small></span>' +
        '<button type="button" class="plus" data-i="' + i + '" aria-label="増やす">＋</button></div></div>' +
        '<div class="line-st">' + st.html + '<button type="button" class="line-x" data-i="' + i + '">外す</button></div></div>';
    }).join('');
    // 送信バー
    var over = 0, ext = 0;
    S.cart.forEach(function (l) { var st = lineState(l); if (st.cls === 'over') over++; if (st.cls === 'ext') ext++; });
    var note = '';
    if (!S.patient) note = '患者を選ぶと送信できます';
    else if (!S.cart.length) note = '<b>' + esc(S.patient.name) + '</b>';
    else note = '<b>' + esc(S.patient.name) + '</b><br>' + S.cart.length + '品目' + (over ? '・<span class="w">在庫超過 ' + over + '</span>' : '') + (ext ? '・<span class="e">外用 ' + ext + '</span>' : '');
    $('#sendNote').innerHTML = note;
    var btn = $('#sendBtn');
    btn.disabled = !(S.patient && S.cart.length);
    btn.textContent = S.cart.length ? '送信（' + S.cart.length + '品目）' : '送信';
  }

  function addToCart(code) {
    var ex = S.cart.filter(function (l) { return l.code === code; })[0];
    if (ex) ex.qty += defQty(code);
    else S.cart.push({ code: code, qty: defQty(code) });
    renderOut();
  }

  function openDose(group) {
    var members = C.meds.filter(function (m) { return m.group_name === group; }).sort(function (a, b) { return doseOf(a) - doseOf(b); });
    var pt = S.patient ? { age: S.patient.age, weight: S.weight } : null;
    var sg = suggestCode(group, members, pt);
    $('#doseTitle').textContent = nf(group) + '　量を選ぶ';
    var w = $('#doseWeight');
    if (S.patient && S.weight) {
      var f = DOSE_RULE[group];
      w.innerHTML = '体重 <div class="stepper"><button type="button" id="wMinus" aria-label="体重を減らす">−</button><span class="q num">' + S.weight + '<small>kg</small></span><button type="button" id="wPlus" aria-label="体重を増やす">＋</button></div>' +
        '<span>' + S.patient.age + '歳</span>' +
        '<span class="sugg-txt">' + (sg ? '提案: <b>' + fmt(doseOf(C.byCode[sg])) + 'g</b>' + (f ? '（' + S.weight + 'kg × ' + f + 'g ≒ ' + fmt(S.weight * f) + 'g）' : '（年齢から）') : '') + '</span>';
    } else w.innerHTML = '<span>' + (S.patient ? '体重の記録がないため提案はありません' : '患者を選ぶと体重から量を提案します') + '</span>';
    $('#doseList').innerHTML = members.map(function (m) {
      var s = C.stock[m.code];
      return '<button type="button" class="dose' + (m.code === sg ? ' sugg' : '') + '" data-code="' + m.code + '"><b class="num">' + fmt(doseOf(m)) + 'g</b>' +
        '<span class="num' + (s < 0 ? ' neg' : '') + '">在庫 ' + fmt(s) + '</span></button>';
    }).join('');
    $('#doseSheet').dataset.group = group;
    $('#doseSheet').hidden = false;
  }

  function openPatients() {
    $('#patientSearch').value = '';
    renderPatients();
    $('#patientSheet').hidden = false;
  }
  function renderPatients() {
    var q = $('#patientSearch').value.trim();
    var list = KS.filter(D.patients, q, function (p) { return [p.no, p.name]; });
    $('#patientList').innerHTML = list.map(function (p) {
      return '<button type="button" class="pt" data-no="' + p.no + '"><span class="pn">' + esc(p.name) + (p.weight ? '<span class="kid">小児</span>' : '') + '<small>' + p.no + '</small></span>' +
        '<span class="pa num">' + p.age + '歳' + (p.weight ? '<br>' + p.weight + 'kg' : '') + '</span></button>';
    }).join('');
  }
  function closeSheets() { $('#patientSheet').hidden = true; $('#doseSheet').hidden = true; }

  function send() {
    if (!S.patient || !S.cart.length) return;
    var date = $('#visitDate').value;
    var rec = { id: Date.now(), kind: 'out', t: new Date().toISOString(), date: date, op: S.op, pno: S.patient.no, pname: S.patient.name,
      visit: C.id + '|' + S.patient.no + '|' + date, lines: [] };
    S.cart.forEach(function (l) {
      var m = C.byCode[l.code], before = C.stock[m.code];
      if (!m.stock_untracked) C.stock[m.code] = before - l.qty;
      rec.lines.push({ code: m.code, name: short(m), qty: l.qty, unit: m.unit, ext: !!m.stock_untracked, before: before });
    });
    C.log.unshift(rec); saveClinic(); // ボタンの並びは院に入った時だけ決める（送信のたびに並び替えると押す位置がずれる）
    S.cart = []; S.patient = null; S.weight = null; $('#medSearch').value = '';
    renderOut(); showLast(rec);
    window.scrollTo(0, 0);
  }
  function showLast(rec) {
    S.lastRec = rec;
    var bar = $('#lastBar');
    bar.classList.toggle('undone', !!rec.cx);
    $('#lastText').innerHTML = rec.cx ? '<b>取り消しました</b><br>' + esc(rec.pname) + ' ' + rec.lines.length + '品目を在庫に戻しました'
      : '<b>送信しました</b>　' + esc(rec.pname) + '<br>' + rec.lines.length + '品目。押し間違いならすぐ取り消せます';
    $('#undoBtn').hidden = !!rec.cx;
    bar.dataset.id = rec.id; bar.hidden = false;
  }
  function undo(id) {
    var rec = C.log.filter(function (h) { return String(h.id) === String(id); })[0];
    if (!rec || rec.cx) return;
    if (rec.kind === 'out') rec.lines.forEach(function (l) { if (!l.ext) C.stock[l.code] += l.qty; });
    if (rec.kind === 'in') rec.lines.forEach(function (l) { C.stock[l.code] -= l.qty; });
    rec.cx = new Date().toISOString(); saveClinic();
    return rec;
  }

  /* ---- 在庫 ---- */
  function lastMoved() {
    var r = C.log.filter(function (h) { return !h.cx; })[0], mv = {};
    if (r) r.lines.forEach(function (l) { if (!l.ext) mv[l.code] = (r.kind === 'out' ? -l.qty : l.qty); });
    return mv;
  }
  function renderStock() {
    var chips = ['全て', 'マイナス', '直前に動いた', '成人', '小児', '外用', '検査'];
    $('#stockChips').innerHTML = chips.map(function (c) { return '<button type="button" class="chip' + (S.stockFilter === c ? ' on' : '') + '" data-f="' + c + '">' + c + '</button>'; }).join('');
    var mv = lastMoved(), q = $('#stockSearch').value.trim();
    var list = KS.filter(C.meds, q, function (m) { return [m.name, m.furigana, m.code, m.category]; }).filter(function (m) {
      var f = S.stockFilter;
      if (f === '全て') return true;
      if (f === 'マイナス') return !m.stock_untracked && C.stock[m.code] < 0;
      if (f === '直前に動いた') return mv[m.code] != null;
      return (m.category || '').indexOf(f) === 0 || (f === '成人' && m.cat1 === '兼用');
    });
    $('#stockList').innerHTML = '<div class="stock-sum">' + list.length + '品目</div>' + list.map(function (m) {
      var s = C.stock[m.code], moved = mv[m.code] != null;
      var q = m.stock_untracked ? '<span class="sq ext">外用</span>' : '<span class="sq num' + (s < 0 ? ' neg' : '') + '">' + fmt(s) + '<small>' + esc(m.unit) + '</small></span>';
      return '<div class="srow' + (moved ? ' moved' : '') + '" data-code="' + m.code + '"><span class="sn">' + esc(short(m)) +
        (moved ? '<span class="mv num">' + (mv[m.code] > 0 ? '+' : '−') + Math.abs(mv[m.code]) + ' 直前</span>' : '') + '<small>' + m.code + '・' + esc(m.category) + '</small></span>' + q + '</div>';
    }).join('');
  }

  /* ---- 入荷 ---- */
  function renderIn() {
    var q = $('#inSearch').value.trim();
    var hits = q ? KS.filter(C.meds, q, function (m) { return [m.name, m.furigana, m.code, m.category]; }).filter(function (m) { return !m.stock_untracked; }) : [];
    $('#inResults').innerHTML = hits.slice(0, 6).map(function (m) {
      return '<button type="button" class="res" data-code="' + m.code + '"><span class="rn">' + esc(short(m)) + '<small>' + m.code + '</small></span><span class="rs">' + stockCell(m) + '</span></button>';
    }).join('');
    var f = $('#inForm');
    if (!S.inPick) { f.hidden = true; return; }
    var m = C.byCode[S.inPick];
    f.hidden = false;
    f.innerHTML = '<div class="in-nm">' + esc(short(m)) + '</div><div style="color:var(--dim);font-size:13px">いまの在庫 <b class="num">' + fmt(C.stock[m.code]) + '</b> ' + esc(m.unit) + '</div>' +
      '<div class="in-row"><div class="stepper"><button type="button" id="inMinus">−</button><span class="q num">' + S.inQty + '<small>' + esc(m.unit) + '</small></span><button type="button" id="inPlus">＋</button></div>' +
      '<button type="button" class="in-go" id="inGo">入荷を登録</button></div>';
  }

  /* ---- 発注・履歴・消費量 ---- */
  function renderOrder() {
    var list = C.meds.filter(function (m) { return !m.stock_untracked && C.stock[m.code] <= (m.threshold || 0); })
      .sort(function (a, b) { return (C.stock[a.code] - a.threshold) - (C.stock[b.code] - b.threshold); });
    $('#orderList').innerHTML = '<div class="stock-sum">' + list.length + '品目（発注書の作成はこの案の範囲外）</div>' + list.map(function (m) {
      var s = C.stock[m.code];
      return '<div class="srow"><span class="sn">' + esc(short(m)) + '<small>発注点 ' + fmt(m.threshold) + '・' + esc(m.supplier_name || '') + '</small></span><span class="sq num' + (s < 0 ? ' neg' : '') + '">' + fmt(s) + '<small>' + esc(m.unit) + '</small></span></div>';
    }).join('');
  }
  function renderHist() {
    if (!C.log.length) { $('#histList').innerHTML = '<div class="cart-empty">まだ記録はありません</div>'; return; }
    var firstLive = C.log.filter(function (h) { return !h.cx; })[0];
    $('#histList').innerHTML = C.log.slice(0, 30).map(function (h) {
      var t = new Date(h.t), hm = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
      var kind = h.cx ? '<span class="h-kind cx">取消済</span>' : (h.kind === 'out' ? '<span class="h-kind out">出荷</span>' : '<span class="h-kind in">入荷</span>');
      return '<div class="h-item' + (h.cx ? ' cx' : '') + '"><div class="h-top"><span>' + kind + '　' + (h.date || '') + ' ' + hm + '</span><span>担当 ' + esc(h.op) + '</span></div>' +
        (h.pname ? '<div class="h-who">' + esc(h.pname) + '</div>' : '') +
        '<ul>' + h.lines.map(function (l) { return '<li>' + esc(l.name) + '　<b class="num">' + l.qty + '</b>' + esc(l.unit) + (l.ext ? '（外用）' : '') + '</li>'; }).join('') + '</ul>' +
        (firstLive && h.id === firstLive.id ? '<button type="button" class="btn-plain h-undo" data-undo="' + h.id + '">この記録を取り消す</button>' : '') + '</div>';
    }).join('');
  }
  function renderUse() {
    var n = counts();
    var list = C.meds.map(function (m) { return { m: m, n: n[m.code] || 0 }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 15);
    var mx = list.length ? list[0].n : 1;
    $('#useList').innerHTML = list.map(function (x) {
      return '<div class="u-row"><div class="u-lb"><span>' + esc(short(x.m)) + '</span><span class="num">' + x.n + '回</span></div><div class="u-bar"><i style="--w:' + (x.n / mx * 100).toFixed(1) + '%"></i></div></div>';
    }).join('');
  }

  function resetDemo() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(LS) === 0) localStorage.removeItem(k); }); } catch (e) { }
    S.clinic = null; S.cart = []; S.patient = null; C = null;
    showClinicScreen();
  }

  /* ---- イベント（click で動く） ---- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) { $('#' + t.dataset.close).hidden = true; return; }
    if (t.classList.contains('cs-item')) { enterClinic(t.dataset.id); return; }
    if (t.id === 'resetBtn' || t.id === 'resetBtn2') { resetDemo(); return; }
    if (t.id === 'clinicBtn') { showClinicScreen(); return; }
    if (t.id === 'themeBtn') { S.theme = S.theme === 'night' ? 'day' : 'night'; lsSet('theme', S.theme); applyTheme(); return; }
    if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('tabs')) { setView(t.dataset.v); return; }
    if (t.id === 'minusChip') { S.stockFilter = 'マイナス'; setView('stock'); return; }
    if (t.id === 'patientBtn') { openPatients(); return; }
    if (t.classList.contains('pt')) {
      S.patient = D.patients.filter(function (p) { return p.no === t.dataset.no; })[0]; S.weight = S.patient.weight || null;
      $('#patientSheet').hidden = true; $('#lastBar').hidden = true; renderOut(); return;
    }
    if (t.classList.contains('fq')) {
      var k = t.dataset.key;
      if (k.indexOf('g:') === 0) openDose(k.slice(2)); else addToCart(k);
      return;
    }
    if (t.classList.contains('dose')) { $('#doseSheet').hidden = true; addToCart(t.dataset.code); return; }
    if (t.id === 'wMinus' || t.id === 'wPlus') { S.weight = Math.max(3, S.weight + (t.id === 'wPlus' ? 1 : -1)); openDose($('#doseSheet').dataset.group); renderOut(); return; }
    if (t.classList.contains('res') && t.closest('#medResults')) {
      var m = C.byCode[t.dataset.code];
      addToCart(m.code); return;
    }
    if (t.classList.contains('plus') || t.classList.contains('minus')) {
      var l = S.cart[+t.dataset.i]; l.qty = Math.max(1, l.qty + (t.classList.contains('plus') ? 1 : -1)); renderCart(); return;
    }
    if (t.classList.contains('line-x')) { S.cart.splice(+t.dataset.i, 1); renderOut(); return; }
    if (t.id === 'sendBtn') { send(); return; }
    if (t.id === 'undoBtn') { var r = undo($('#lastBar').dataset.id); if (r) { showLast(r); renderOut(); } return; }
    if (t.dataset.undo) { undo(t.dataset.undo); renderHist(); return; }
    if (t.classList.contains('chip')) { S.stockFilter = t.dataset.f; renderStock(); return; }
    if (t.classList.contains('res') && t.closest('#inResults')) { S.inPick = t.dataset.code; S.inQty = C.byCode[S.inPick].pack_size || 10; $('#inDone').hidden = true; renderIn(); return; }
    if (t.id === 'inMinus' || t.id === 'inPlus') { S.inQty = Math.max(1, S.inQty + (t.id === 'inPlus' ? 1 : -1)); renderIn(); return; }
    if (t.id === 'inGo') {
      var mm = C.byCode[S.inPick];
      C.stock[mm.code] += S.inQty;
      C.log.unshift({ id: Date.now(), kind: 'in', t: new Date().toISOString(), date: $('#visitDate').value, op: S.op, lines: [{ code: mm.code, name: short(mm), qty: S.inQty, unit: mm.unit }] });
      saveClinic();
      $('#inDone').textContent = short(mm) + ' を ' + S.inQty + mm.unit + ' 入荷しました（在庫 ' + fmt(C.stock[mm.code]) + '）';
      $('#inDone').hidden = false; S.inPick = null; $('#inSearch').value = ''; renderIn(); return;
    }
  });
  $('#medSearch').addEventListener('input', function () {
    renderSearch();
    var w = document.querySelector('.search-wrap'), top = w.getBoundingClientRect().top;
    if (this.value && top > 200) window.scrollBy(0, top - 140);
  });
  $('#patientSearch').addEventListener('input', renderPatients);
  $('#stockSearch').addEventListener('input', renderStock);
  $('#inSearch').addEventListener('input', function () { S.inPick = null; renderIn(); });
  $('#patientSheet').addEventListener('click', function (e) { if (e.target.id === 'patientSheet') e.currentTarget.hidden = true; });
  $('#doseSheet').addEventListener('click', function (e) { if (e.target.id === 'doseSheet') e.currentTarget.hidden = true; });
  $('#opSel').addEventListener('change', function () { S.op = this.value; lsSet('op', S.op); });

  /* ---- 起動 ---- */
  applyTheme();
  $('#opSel').innerHTML = D.operators.map(function (o) { return '<option' + (o === S.op ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  var d = new Date(); $('#visitDate').value = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  if (S.clinic && D.medicines[S.clinic]) enterClinic(S.clinic); else showClinicScreen();
  window.__demoA = { S: S, get C() { return C; } };
})();
