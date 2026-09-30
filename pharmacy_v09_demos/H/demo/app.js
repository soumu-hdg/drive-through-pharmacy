/* 案H「3つのボタンだけ」デモ。本番DBには接続しない（DEMO_DATA をメモリに読み、操作は localStorage に院ごとに保存） */
(function () {
  'use strict';
  var D = window.DEMO_DATA, K = window.KanaSearch;
  var PFX = 'p9H_v1_';
  var CL = {}; D.clinics.forEach(function (c) { CL[c.id] = c; });
  var KDAY = D.daily_out_nishiharu.reduce(function (m, r) { return r.d > m ? r.d : m; }, '');   // 直近の日
  var BIG_DIFF = 50;
  var S = { clinic: null, op: 'スタッフA', v: { name: 'start' } };
  var DB = null;   // 選択中の院のデータ

  // ── 保存 ───────────────────
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(PFX + k)); localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { return null; } }
  function load(cid) {
    var x = ls('c_' + cid);
    if (!x) x = { meds: JSON.parse(JSON.stringify(D.medicines[cid])), log: [], um: {} };
    return x;
  }
  function save() { ls('c_' + S.clinic, DB); ls('sess', { op: S.op }); }
  function resetAll() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(PFX) === 0) localStorage.removeItem(k); }); } catch (e) {}
  }

  // ── 小物 ───────────────────
  function dn(s) { return String(s == null ? '' : s).replace(/[０-９Ａ-Ｚａ-ｚ．％]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/　/g, ' '); }
  function esc(s) { return dn(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(x) { x = Math.round(x * 10) / 10; return (x < 0 ? '−' : '') + Math.abs(x).toLocaleString('ja-JP'); }
  function sn(x) { return (x > 0 ? '+' : '') + n(x); }
  function nf(s) { return String(s || '').normalize('NFKC'); }
  function med(code) { return DB.meds.filter(function (m) { return m.code === code; })[0]; }
  function tracked(m) { return !m.stock_untracked; }
  function status(m) { if (!tracked(m)) return 'ext'; if (m.current_stock < 0) return 'neg'; if (m.current_stock < m.threshold) return 'low'; return 'ok'; }
  function md(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function now() { var d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function search(q) { return K.filter(DB.meds, q, function (x) { return [x.name, x.furigana, x.code, x.category, x.gs1 || '']; }); }
  function msearch(q) { return K.filter(D.drug_master_sample, q, function (x) { return [x.name, x.kana, x.rezept_code, x.gs1 || '']; }); }
  function karte(code) { return S.clinic === 'nakagawa' ? [] : D.daily_out_nishiharu.filter(function (r) { return r.c === code; }); }
  function karteToday(code) { var r = karte(code).filter(function (x) { return x.d === KDAY; })[0]; return r ? r.q : 0; }
  function toast(t) { var e = document.getElementById('toast'); e.textContent = dn(t); e.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(function () { e.classList.remove('show'); }, 2600); }
  function lastOp() { for (var i = DB.log.length - 1; i >= 0; i--) if (!DB.log[i].undone) return DB.log[i]; return null; }
  function go(v) { S.v = v; render(); window.scrollTo(0, 0); }

  var ICON = {
    in: '<svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true"><rect x="4" y="4" width="64" height="64" fill="#fff" stroke="#111" stroke-width="4"/><rect x="30" y="16" width="12" height="40" fill="#e2391b"/><rect x="16" y="30" width="40" height="12" fill="#e2391b"/></svg>',
    fix: '<svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true"><polygon points="36,2 70,36 36,70 2,36" fill="#fff" stroke="#111" stroke-width="4"/><rect x="21" y="26" width="30" height="7" fill="#111"/><rect x="21" y="40" width="30" height="7" fill="#111"/><rect x="38" y="16" width="6" height="40" fill="#111" transform="rotate(28 41 36)"/></svg>',
    see: '<svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true"><circle cx="36" cy="36" r="33" fill="#fff" stroke="#111" stroke-width="4"/><rect x="18" y="40" width="9" height="16" fill="#1554c9"/><rect x="31" y="28" width="9" height="28" fill="#1554c9"/><rect x="44" y="20" width="9" height="36" fill="#1554c9"/></svg>'
  };

  // ── 今日やること（最大3件） ───────
  function tasks() {
    var t = [], meds = DB.meds;
    var trk = meds.filter(tracked);
    if (S.clinic === 'nakagawa') {
      var have = trk.filter(function (m) { return m.current_stock > 0; }).length;
      if (have < trk.length) t.push({ k: 'in', t: '初めての入荷を登録する', s: '届いた箱から1つずつ。在庫は0から始まります', a: { name: 'in' } });
    }
    var neg = trk.filter(function (m) { return m.current_stock < 0; }).sort(function (a, b) { return a.current_stock - b.current_stock; });
    if (neg.length) t.push({ k: 'fix', t: 'マイナスの薬 ' + neg.length + '品目 → まず1つ数える', s: neg[0].name + '（画面では ' + n(neg[0].current_stock) + neg[0].unit + '）', a: { name: 'fix', code: neg[0].code } });
    if (S.clinic !== 'nakagawa') {
      var um = D.karte_unmatched_examples.filter(function (x, i) { return !DB.um[i]; }).length;
      if (um) t.push({ k: 'fix', t: 'カルテで結び付かなかった薬 ' + um + '件', s: '略称・銘柄違いで在庫から減っていません', a: { name: 'um' } });
      var low = trk.filter(function (m) { return status(m) === 'low'; }).length;
      if (low) t.push({ k: 'see', t: '少なくなった薬 ' + low + '品目を見る', s: '発注の目安を下回っています', a: { name: 'stock', f: 'low' } });
    }
    return t.slice(0, 3);
  }

  // ── 画面 ───────────────────
  function cbar() {
    var c = CL[S.clinic];
    return '<header class="cbar' + (S.clinic === 'test' ? ' test' : '') + '" style="background-color:' + c.color + '"><div class="cname"><b>' + esc(c.short) +
      (S.clinic === 'test' ? '<span class="tag">練習用・本番に影響なし</span>' : '') + '</b><small>' + esc(c.name) + '・' + esc(S.op) + '</small></div>' +
      '<button id="sw" data-a="switch">院を<br>切り替え</button></header>';
  }

  function vStart() {
    var ops = D.operators.map(function (o) { return '<button data-a="op" data-v="' + esc(o) + '" class="' + (o === S.op ? 'on' : '') + '">' + esc(o) + '</button>'; }).join('');
    var cs = D.clinics.map(function (c) {
      var ms = load(c.id).meds, have = ms.filter(function (m) { return tracked(m) && m.current_stock > 0; }).length;
      var sub = c.id === 'nakagawa' ? '11月開院予定・在庫0から（在庫あり ' + have + '品目）' : c.id === 'test' ? '練習・撮影用。在庫を動かしても本番に影響しません' : '稼働中・カルテ連動';
      return '<button id="cl-' + c.id + '" data-a="clinic" data-v="' + c.id + '"><span class="sw' + (c.id === 'test' ? ' test' : '') + '" style="background:' + c.color + '"></span><span class="tx"><b>' + esc(c.short) + '</b><small>' + esc(sub) + '</small></span></button>';
    }).join('');
    return '<div class="start"><div class="shapes"><i class="s1"></i><i class="s2"></i><i class="s3"></i></div>' +
      '<h1>薬の在庫<br>ボタンは3つだけ</h1><p class="lead">届いた・数が合わない・いまの在庫。処方の分はカルテから自動で減ります。</p>' +
      '<div class="lab">どの院で使いますか</div><div class="cl">' + cs + '</div>' +
      '<div class="lab">使う人</div><div class="ops">' + ops + '</div>' +
      '<button class="reset" id="reset" data-a="reset">デモの初期化（全院の操作を消す）</button>' +
      '<p class="foot">デモ：本番のデータベースには接続していません。操作はこの端末のブラウザにだけ保存されます。患者はすべて架空です。</p></div>';
  }

  function vHome() {
    var t = tasks(), trk = DB.meds.filter(tracked);
    var negN = trk.filter(function (m) { return m.current_stock < 0; }).length;
    var pre = '';
    if (S.clinic === 'nakagawa') {
      var have = trk.filter(function (m) { return m.current_stock > 0; }).length;
      pre = '<div class="pre"><div style="flex:1"><b>開院前の準備中</b><br>在庫がある薬 <span class="num">' + have + ' / ' + trk.length + '</span> 品目</div><div class="meter"><i style="width:' + Math.round(have / trk.length * 100) + '%"></i></div></div>';
    }
    var todo = '<section class="todo"><h2>今日やること <span class="num">' + t.length + '</span></h2><ol>' +
      (t.length ? t.map(function (x, i) { return '<li><button id="task' + i + '" data-a="task" data-i="' + i + '"><i class="mk ' + x.k + '"></i><span class="t">' + esc(x.t) + '<small>' + esc(x.s) + '</small></span><span class="chev">›</span></button></li>'; }).join('')
        : '<li class="none">いまは、やることはありません。</li>') + '</ol></section>';
    var lo = lastOp();
    var undo = '<button class="undo" id="undo" data-a="undo"' + (lo ? '' : ' disabled') + '><span class="ar">↶</span><span><b>さっきの操作を取り消す</b><small>' + (lo ? esc(opText(lo)) : 'まだ操作はありません') + '</small></span></button>';
    return cbar() + '<main class="home">' + pre + todo +
      '<div class="big3">' +
      '<button class="bigbtn in" id="b-in" data-a="nav" data-v="in"><span class="ico">' + ICON.in + '</span><span class="lbl">届いた<small>箱が来たら 在庫に足す・新しい薬を登録</small></span></button>' +
      '<button class="bigbtn fix" id="b-fix" data-a="nav" data-v="fix"><span class="ico">' + ICON.fix + '</span><span class="lbl">数が合わない<small>棚を数えて 実際の数に直す</small></span>' + (negN ? '<span class="count">マイナス ' + negN + '</span>' : '') + '</button>' +
      '<button class="bigbtn see" id="b-see" data-a="nav" data-v="stock"><span class="ico">' + ICON.see + '</span><span class="lbl">いまの在庫<small>見るだけ。カルテから減った数も</small></span></button>' +
      '</div>' + undo + '</main>';
  }

  function opText(o) {
    var m = o.name;
    if (o.type === 'in') return '届いた：' + m + ' ' + sn(o.delta) + o.unit;
    if (o.type === 'new') return '新しい薬：' + m + ' ' + sn(o.delta) + o.unit;
    if (o.type === 'fix') return '数を直した：' + m + ' ' + n(o.before) + '→' + n(o.after) + o.unit;
    if (o.type === 'link') return 'カルテの取りこぼし：' + m + ' ' + sn(o.delta) + o.unit;
    if (o.type === 'hand') return '担当に回した：' + m;
    if (o.type === 'ok') return '確認済み：' + m;
    return m;
  }

  function fhead(k, title, hint) { return '<div class="fhead ' + k + '"><button class="back" id="back" data-a="home">← ホーム</button><h1>' + title + '</h1>' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>'; }

  function drugCard(m, extra) {
    return '<div class="drug"><div class="n">' + esc(m.name) + '</div><div class="m">' + esc(m.code) + '・' + esc(m.category || '') + (m.supplier_name ? '・' + esc(m.supplier_name) : '') + '</div>' +
      '<div class="cur"><span>いまの在庫（画面の数）</span>' + (tracked(m) ? '<span class="num">' + n(m.current_stock) + '<small> ' + esc(m.unit) + '</small></span>' : '<span class="ext">外用・数えない</span>') + '</div>' + (extra || '') + '</div>';
  }

  function resultRows(list, act) {
    return '<div class="list" id="res">' + list.slice(0, 7).map(function (m, i) {
      var st = status(m);
      return '<button class="row" id="r' + i + '" data-a="' + act + '" data-v="' + m.code + '"><span class="band ' + ({ neg: 'b-neg', low: 'b-low', ext: 'b-ext', ok: 'b-ok' })[st] + '"></span><span class="nm">' + esc(m.name) + '<small>' + esc(m.code) + '・' + esc(m.category || '') + '</small></span>' +
        '<span class="st num' + (st === 'neg' ? ' neg' : '') + '">' + (tracked(m) ? n(m.current_stock) : '外用') + '<small>' + (tracked(m) ? esc(m.unit) : '') + '</small></span></button>';
    }).join('') + '</div>';
  }

  // 届いた
  function vIn() {
    var v = S.v, m = v.code && med(v.code), body;
    if (!m) {
      var hits = v.q ? search(v.q) : [];
      body = '<div class="lab">届いた薬を探す</div><div class="srch"><input id="q" data-in="q" placeholder="名前（ローマ字・かなOK）／箱の番号" value="' + esc(v.q || '') + '" autocomplete="off"><button data-a="clearq">消す</button></div>' +
        '<button class="scan" id="scan" data-a="scan"><span><b>箱のバーコードを読む</b><small>デモでは見本の箱の番号を入れます（本番はカメラで読み取り）</small></span></button>' +
        '<div id="hits">' + inHits(v.q, hits) + '</div>';
    } else {
      var pk = v.pack || m.pack_size || 1, add = v.boxes * pk;
      body = drugCard(m) +
        '<div class="lab">届いた箱の数</div><div class="stepper"><button id="minus" data-a="box" data-v="-1">−</button><div class="v"><span class="num" id="boxes">' + v.boxes + '</span><small>箱</small></div><button id="plus" data-a="box" data-v="1">＋</button></div>' +
        '<div class="lab">1箱に入っている数</div><div class="quick">' + [10, 20, 50, 100, 500].map(function (x) { return '<button data-a="pack" data-v="' + x + '" class="' + (x === pk ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' +
        '<div class="calc"><span class="num">' + v.boxes + '</span>箱 × <span class="num">' + pk + '</span>' + esc(m.unit) + ' ＝ <span class="num">' + n(add) + '</span>' + esc(m.unit) + '　在庫 <span class="num">' + n(m.current_stock) + ' → ' + n(m.current_stock + add) + '</span></div>' +
        '<div class="lab">どこから届いた</div><div class="opts three">' + D.suppliers.map(function (s) { return '<button data-a="sup" data-v="' + esc(s) + '" class="' + (s === v.sup ? 'on' : '') + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        (tracked(m) ? '' : '<p class="note">外用は数えないので、届いた記録だけ残します。</p>');
    }
    var dock = m ? '<div class="dock"><button class="go in" id="doIn" data-a="doIn"' + (v.boxes > 0 ? '' : ' disabled') + '>在庫に足す（' + sn(v.boxes * (v.pack || m.pack_size || 1)) + esc(m.unit) + '）</button></div>' : '';
    return '<div class="flow">' + fhead('in', '届いた', '足す') + '<div class="fbody">' + body + '</div>' + dock + '</div>';
  }
  function inHits(q, hits) {
    if (!q) return '<p class="note">箱の名前を打つか、バーコードを読んでください。</p>';
    if (!hits.length) return '<div class="empty" id="nf"><p>この院の薬に「' + esc(q) + '」は見つかりません。<br>初めて扱う薬なら、このまま登録できます。</p><button class="go in" id="toNew" data-a="toNew">新しい薬として登録する</button></div>';
    return resultRows(hits, 'pickIn') + '<button class="more" id="toNew2" data-a="toNew">見つからない時は → 新しい薬として登録</button>';
  }

  // 新しい薬
  function vNew() {
    var v = S.v, p = v.pick, body;
    if (!p) {
      var hits = v.q ? msearch(v.q) : [];
      var have = {}; DB.meds.forEach(function (m) { have[m.rezept_code] = m.code; });
      body = '<p class="note">厚労省の医薬品マスタから探します。名前・単位・薬価はマスタから入ります。</p>' +
        '<div class="srch"><input id="mq" data-in="mq" placeholder="薬の名前（ローマ字・かなOK）／箱の番号" value="' + esc(v.q || '') + '" autocomplete="off"><button data-a="clearmq">消す</button></div>' +
        '<div id="mhits">' + mHits(hits, have) + '</div>';
    } else {
      var pk = v.pack, add = v.boxes * pk;
      body = '<div class="drug"><div class="n">' + esc(p.name) + '</div><div class="m">' + esc(p.makers || '') + '</div></div>' +
        '<div class="kv"><div>単位</div><div>' + esc(nf(p.unit)) + '<span class="from">マスタから</span></div><div>薬価</div><div class="num">' + p.price + ' 円 / ' + esc(nf(p.unit)) + '<span class="from">マスタから</span></div><div>レセ電コード</div><div class="num">' + esc(p.rezept_code) + '</div><div>箱の番号</div><div class="num">' + esc(p.gs1 || '（初回の読み取りで覚えます）') + '</div></div>' +
        '<div class="lab">だれ向けの薬</div><div class="opts">' + ['成人', '小児', '外用', '検査'].map(function (x) { return '<button id="cat-' + x + '" data-a="cat" data-v="' + x + '" class="' + (x === v.cat ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' +
        (v.cat === '外用' ? '<p class="note">外用は在庫を数えません（「外用」と表示）。</p>' : '') +
        '<div class="lab">1箱に入っている数</div><div class="quick">' + [10, 20, 50, 100, 500].map(function (x) { return '<button data-a="npack" data-v="' + x + '" class="' + (x === pk ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' +
        '<div class="lab">どこから届いた</div><div class="opts three">' + D.suppliers.map(function (s) { return '<button data-a="sup" data-v="' + esc(s) + '" class="' + (s === v.sup ? 'on' : '') + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<div class="lab">届いた箱の数</div><div class="stepper"><button data-a="box" data-v="-1">−</button><div class="v"><span class="num">' + v.boxes + '</span><small>箱</small></div><button id="plus" data-a="box" data-v="1">＋</button></div>' +
        '<div class="calc">登録と同時に在庫 <span class="num">0 → ' + n(v.cat === '外用' ? 0 : add) + '</span> ' + esc(nf(p.unit)) + '</div>';
    }
    var dock = p ? '<div class="dock"><button class="go in" id="doNew" data-a="doNew"' + (v.cat ? '' : ' disabled') + '>登録して在庫に足す</button><div class="why">' + (v.cat ? '発注の目安は1箱分で始めます（あとで変更可）' : '「だれ向けの薬」を選んでください') + '</div></div>' : '';
    return '<div class="flow">' + fhead('in', '新しい薬', '登録') + '<div class="fbody">' + body + '</div>' + dock + '</div>';
  }
  function mHits(hits, have) {
    if (!hits.length) return '<p class="note">見つかりません。名前を短くしてみてください。</p>';
    return '<div class="list">' + hits.slice(0, 8).map(function (x, i) {
      var h = have[x.rezept_code];
      return '<button class="row mrow" id="m' + i + '" data-a="pickM" data-v="' + i + '"><span class="nm">' + esc(x.name) + (h ? '<span class="src">登録済み ' + h + '</span>' : '') + '<small>' + esc(x.makers || '') + '</small></span><span class="st num">' + x.price + '<small>円/' + esc(nf(x.unit)) + '</small></span></button>';
    }).join('') + '</div>' + (hits.length > 8 ? '<p class="note">ほか ' + (hits.length - 8) + '件。名前を足すと絞れます（例: 5mg）。</p>' : '');
  }

  // 数が合わない
  function vFix() {
    var v = S.v, m = v.code && med(v.code), body, dock = '';
    if (!m) {
      var hits = v.q ? search(v.q) : DB.meds.filter(function (x) { return status(x) === 'neg'; });
      body = '<div class="lab">数が合わない薬を探す</div><div class="srch"><input id="fq" data-in="fq" placeholder="名前（ローマ字・かなOK）" value="' + esc(v.q || '') + '" autocomplete="off"><button data-a="clearfq">消す</button></div>' +
        (v.q ? '' : '<p class="note">マイナスになっている薬を先に並べています。</p>') + '<div id="fhits">' + resultRows(hits, 'pickFix') + '</div>';
    } else if (!tracked(m)) {
      body = drugCard(m) + '<p class="note">外用は在庫を数えないので、直す必要はありません。</p>';
    } else {
      var has = v.cnt !== '', c = has ? +v.cnt : 0, diff = c - m.current_stock, big = has && Math.abs(diff) >= BIG_DIFF;
      body = drugCard(m) +
        '<div class="lab">棚で数えた数</div><div class="cnt"><span class="num" id="cnt">' + (has ? n(c) : '―') + '</span><span class="u">' + esc(m.unit) + '</span></div>' +
        '<div class="pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(function (k) { return '<button id="k' + ({ 'C': 'c', '⌫': 'bs' }[k] || k) + '" data-a="key" data-v="' + k + '" class="' + (/\d/.test(k) ? '' : 'fn') + '">' + (k === 'C' ? '全部消す' : k) + '</button>'; }).join('') + '</div>' +
        (has ? '<div class="diff">画面の数との差 <span class="num">' + sn(diff) + '</span> ' + esc(m.unit) + '</div>' : '') +
        '<div class="lab">なぜ合わなかった</div><div class="reasons">' + D.adjust_reasons.map(function (r, i) { return '<button id="rs' + i + '" data-a="reason" data-v="' + esc(r) + '" class="' + (r === v.reason ? 'on' : '') + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
        (big ? '<div class="notify' + (v.notify ? ' on' : '') + '"><button id="notify" data-a="notify"><span class="box">' + (v.notify ? '✓' : '') + '</span><span><b>在庫担当に知らせる</b><small>差が' + BIG_DIFF + '以上あります。直した数と理由をメモで残します。</small></span></button></div>' : '');
      var why = !has ? '数えた数を打ってください' : !v.reason ? '理由を選んでください' : diff === 0 ? '画面の数と同じです' : '';
      dock = '<div class="dock"><button class="go fix" id="doFix" data-a="doFix"' + (why ? ' disabled' : '') + '>' + (has ? n(c) + ' ' + esc(m.unit) + ' に直す' : 'この数に直す') + '</button>' + (why ? '<div class="why">' + why + '</div>' : '') + '</div>';
    }
    return '<div class="flow">' + fhead('fix', '数が合わない', '直す') + '<div class="fbody">' + body + '</div>' + dock + '</div>';
  }

  // いまの在庫
  function vStock() {
    var v = S.v, f = v.f || 'all', trk = DB.meds;
    var cnt = { all: trk.length, neg: 0, low: 0, ext: 0 };
    trk.forEach(function (m) { var s = status(m); if (cnt[s] != null) cnt[s]++; });
    var list = v.q ? search(v.q) : trk.slice();
    if (f !== 'all') list = list.filter(function (m) { return status(m) === f; });
    var ord = { neg: 0, low: 1, ok: 2, ext: 3 };
    list.sort(function (a, b) { return ord[status(a)] - ord[status(b)] || (status(a) === 'neg' ? a.current_stock - b.current_stock : 0); });
    var rows = list.map(function (m) {
      var st = status(m), kq = tracked(m) ? karteToday(m.code) : 0;
      return '<button class="row" data-a="item" data-v="' + m.code + '"><span class="band ' + ({ neg: 'b-neg', low: 'b-low', ext: 'b-ext', ok: 'b-ok' })[st] + '"></span><span class="nm">' + esc(m.name) +
        '<small>' + ({ neg: 'マイナス・数えてください', low: '少ない（目安 ' + n(m.threshold) + '）', ext: '', ok: '' })[st] + (kq ? ' <span class="kt">カルテから ' + md(KDAY) + ' −' + n(kq) + '</span>' : '') + '</small></span>' +
        '<span class="st num' + (st === 'neg' ? ' neg' : '') + '">' + (tracked(m) ? n(m.current_stock) : '<span class="ext">外用</span>') + '<small>' + (tracked(m) ? esc(m.unit) : '') + '</small></span></button>';
    }).join('');
    var fb = function (k, l) { return '<button id="f-' + k + '" data-a="filter" data-v="' + k + '" class="' + (f === k ? 'on' : '') + '">' + l + '<span class="num">' + cnt[k] + '</span></button>'; };
    return '<div class="flow">' + fhead('see', 'いまの在庫', '見るだけ') + '<div class="fbody">' +
      '<div class="filters">' + fb('all', 'すべて') + fb('neg', 'マイナス') + fb('low', '少ない') + fb('ext', '外用') + '</div>' +
      '<div class="legend"><span><i class="b-neg"></i>マイナス</span><span><i class="b-low"></i>少ない</span><span><i class="b-ext"></i>外用（数えない）</span><span><i class="b-ok"></i>足りている</span></div>' +
      '<div class="srch"><input id="sq" data-in="sq" placeholder="名前で絞る（ローマ字・かなOK）" value="' + esc(v.q || '') + '" autocomplete="off"><button data-a="clearsq">消す</button></div>' +
      (S.clinic === 'nakagawa' ? '' : '<p class="note">「カルテから」＝カルテの会計で自動で減った数（読み取り専用）。デモでは西春の過去の出庫実績（' + md(KDAY) + '）をカルテ連動と同じ形で表示しています。</p>') +
      '<div class="list" id="slist">' + (rows || '<p class="note">該当する薬はありません。</p>') + '</div></div></div>';
  }

  function vItem() {
    var m = med(S.v.code); if (!m) return vStock();
    var mine = DB.log.filter(function (o) { return o.code === m.code && !o.undone && o.delta; }).map(function (o) { return { d: o.at, q: o.delta, who: ({ in: '届いた', new: '新規登録', fix: '数を直した', link: 'カルテ補正' })[o.type] + '・' + o.op, k: false, r: o.reason }; }).reverse();
    var kr = karte(m.code).slice(-8).reverse().map(function (r) { return { d: md(r.d), q: -r.q, who: 'カルテから', k: true, r: r.n + '件の会計' }; });
    var h = mine.concat(kr);
    return '<div class="flow">' + fhead('see', 'いまの在庫', '見るだけ') + '<div class="fbody">' + drugCard(m) +
      '<div class="kv"><div>1箱の入数</div><div class="num">' + n(m.pack_size || 0) + ' ' + esc(m.unit) + '</div><div>発注の目安</div><div class="num">' + n(m.threshold || 0) + ' ' + esc(m.unit) + '</div><div>仕入先</div><div>' + esc(m.supplier_name || '―') + '</div></div>' +
      '<div class="two"><button class="go in" id="itemIn" data-a="itemIn">届いた</button><button class="go fix" id="itemFix" data-a="itemFix">数が合わない</button></div>' +
      '<div class="lab">増えた・減った記録</div><div class="hist">' + (h.length ? h.map(function (x) {
        return '<div class="h"><span class="d num">' + esc(x.d) + '</span><span><span class="who' + (x.k ? ' k' : '') + '">' + esc(x.who) + '</span> <small>' + esc(x.r || '') + '</small></span><span class="q num">' + sn(x.q) + '</span></div>';
      }).join('') : '<p class="note">まだ記録はありません。</p>') + '</div>' +
      '<p class="note">「カルテから」の行はカルテ側で確定した記録のため、ここでは直せません。合わない時は「数が合わない」で実数に直します。</p>' +
      '<button class="more" data-a="nav" data-v="stock">← 一覧にもどる</button></div></div>';
  }

  // カルテで結び付かなかった
  function vUm() {
    var cards = D.karte_unmatched_examples.map(function (x, i) {
      var cm = (x.reason.match(/M\d{3}/) || [])[0], cand = cm && med(cm), ext = /外用/.test(x.reason), st = DB.um[i];
      var acts = '';
      if (cand && !ext) acts += '<button class="main" id="um' + i + 'a" data-a="umLink" data-v="' + i + '">候補「' + esc(cand.name) + '」から ' + x.qty + esc(cand.unit) + ' 減らす</button>';
      if (ext) acts += '<button class="main" id="um' + i + 'a" data-a="umOk" data-v="' + i + '">外用なので数えない（確認済みにする）</button>';
      acts += '<button id="um' + i + 'b" data-a="umHand" data-v="' + i + '">在庫担当に回す（今は直さない）</button>';
      return '<div class="um' + (st ? ' fin' : '') + '"><div class="top"><b>' + esc(x.karte_name) + '</b><div class="q">カルテで処方 <span class="num">' + x.qty + '</span> ' + esc(x.unit) + '・' + md(x.date) + '</div><small>' + esc(x.reason) + '</small></div>' +
        (st ? '<div class="res">' + esc(st) + '</div>' : '<div class="acts">' + acts + '</div>') + '</div>';
    }).join('');
    return '<div class="flow">' + fhead('fix', 'カルテと結び付かない', '直す') + '<div class="fbody"><p class="note">カルテで会計したのに、在庫の薬と名前が結び付かず減らなかった分です（デモ用の架空例）。</p>' + cards + '</div></div>';
  }

  function vDone() {
    var o = DB.log.filter(function (x) { return x.id === S.v.id; })[0]; if (!o) return vHome();
    var k = ({ in: '届いた', new: '新しい薬を登録', fix: '数を直した', link: 'カルテの取りこぼしを補正' })[o.type];
    var cls = o.type === 'fix' || o.type === 'link' ? 'fix' : 'in';
    return cbar() + '<div class="done"><div class="stamp" style="border-left:14px solid var(--fill-' + cls + ')"><div class="k">済み：' + k + '</div><div class="n">' + esc(o.name) + '</div>' +
      '<div class="ba"><div><span class="num">' + n(o.before) + '</span><small>前</small></div><div class="arr">→</div><div><span class="num">' + n(o.after) + '</span><small>いま（' + esc(o.unit) + '）</small></div></div></div>' +
      (o.reason ? '<div class="memo">理由：' + esc(o.reason) + '</div>' : '') + (o.notify ? '<div class="memo">在庫担当へのメモを残しました：「' + esc(o.notify) + '」</div>' : '') +
      '<div class="row2"><button class="plain" id="doneUndo" data-a="undo">↶ 取り消す</button><button class="go ' + cls + '" id="doneHome" data-a="home">ホームへ</button></div></div>';
  }

  function render() {
    var v = S.v.name, h;
    if (v === 'start') h = vStart();
    else if (v === 'home') h = vHome();
    else if (v === 'in') h = vIn();
    else if (v === 'new') h = vNew();
    else if (v === 'fix') h = vFix();
    else if (v === 'stock') h = vStock();
    else if (v === 'item') h = vItem();
    else if (v === 'um') h = vUm();
    else if (v === 'done') h = vDone();
    document.getElementById('app').innerHTML = h;
  }

  // ── 記録 ───────────────────
  function record(o) {
    o.id = 'op' + Date.now() + Math.floor(Math.random() * 1000); o.at = now(); o.op = S.op; DB.log.push(o); save(); return o;
  }
  function undo() {
    var o = lastOp(); if (!o) return;
    var m = med(o.code);
    if (o.type === 'new') DB.meds = DB.meds.filter(function (x) { return x.code !== o.code; });
    else if (m && o.delta) m.current_stock = o.before;
    if (o.um != null) delete DB.um[o.um];
    o.undone = true; save();
    toast('取り消しました：' + opText(o));
    go({ name: 'home' });
  }

  // ── 操作 ───────────────────
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-a'), val = b.getAttribute('data-v'), v = S.v;
    switch (a) {
      case 'op': S.op = val; render(); break;
      case 'reset':
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'もう一度押すと初期化します'; return; }
        resetAll(); toast('デモを初期化しました'); render(); break;
      case 'clinic': S.clinic = val; DB = load(val); save(); go({ name: 'home' }); break;
      case 'switch': S.clinic = null; go({ name: 'start' }); break;
      case 'home': go({ name: 'home' }); break;
      case 'nav': go(val === 'stock' ? { name: 'stock', f: 'all' } : { name: val, q: '', boxes: 1, cnt: '' }); break;
      case 'task': var t = tasks()[+b.getAttribute('data-i')]; go(Object.assign({ q: '', boxes: 1, cnt: '' }, t.a)); break;
      case 'clearq': v.q = ''; render(); break;
      case 'clearmq': v.q = ''; render(); break;
      case 'clearfq': v.q = ''; render(); break;
      case 'clearsq': v.q = ''; render(); break;
      case 'scan':
        var sm = DB.meds.filter(function (m) { return m.gs1; })[0];
        v.q = sm.gs1; render(); toast('読み取りました：' + sm.gs1); break;
      case 'pickIn': var pm = med(val); go({ name: 'in', code: val, boxes: 1, pack: pm.pack_size || 1, sup: pm.supplier_name || D.suppliers[0] }); break;
      case 'box': v.boxes = Math.max(0, (v.boxes || 0) + (+val)); render(); break;
      case 'pack': v.pack = +val; render(); break;
      case 'npack': v.pack = +val; render(); break;
      case 'sup': v.sup = val; render(); break;
      case 'cat': v.cat = val; render(); break;
      case 'doIn':
        var m = med(v.code), add = tracked(m) ? v.boxes * v.pack : 0, bf = m.current_stock;
        if (v.pack !== m.pack_size) m.pack_size = v.pack;
        m.current_stock = bf + add; m.supplier_name = v.sup;
        var o = record({ type: 'in', code: m.code, name: m.name, unit: m.unit, before: bf, after: m.current_stock, delta: add, reason: v.boxes + '箱・' + v.sup });
        go({ name: 'done', id: o.id }); break;
      case 'toNew': go({ name: 'new', q: v.q || '', boxes: 1, pack: 100, sup: D.suppliers[0] }); break;
      case 'pickM':
        var hits = msearch(v.q), p = hits[+val], ex = DB.meds.filter(function (x) { return x.rezept_code === p.rezept_code; })[0];
        if (ex) { go({ name: 'in', code: ex.code, boxes: 1, pack: ex.pack_size || 1, sup: ex.supplier_name || D.suppliers[0] }); toast('登録済みの薬です。入荷に進みます'); break; }
        v.pick = p; v.cat = ''; render(); window.scrollTo(0, 0); break;
      case 'doNew':
        var p2 = v.pick, mx = DB.meds.reduce(function (a, x) { var k = +String(x.code).replace(/\D/g, ''); return k > a ? k : a; }, 0);
        var code = 'M' + (mx + 1), ext2 = v.cat === '外用', unit = nf(p2.unit), add2 = ext2 ? 0 : v.boxes * v.pack;
        var nm = { code: code, name: p2.name, furigana: '', unit: unit, category: v.cat + '/新規登録', cat1: v.cat, current_stock: add2, threshold: v.pack, price: p2.price, pack_size: v.pack, supplier_name: v.sup, stock_untracked: ext2, maker: p2.makers, rezept_code: p2.rezept_code, official_price: p2.price, gs1: p2.gs1 };
        nm.furigana = K.norm ? p2.kana : '';
        DB.meds.push(nm);
        var o2 = record({ type: 'new', code: code, name: nm.name, unit: unit, before: 0, after: add2, delta: add2, reason: '厚労省マスタから登録・' + v.boxes + '箱・' + v.sup });
        go({ name: 'done', id: o2.id }); break;
      case 'pickFix': go({ name: 'fix', code: val, cnt: '', reason: '' }); break;
      case 'key':
        if (val === 'C') v.cnt = ''; else if (val === '⌫') v.cnt = String(v.cnt).slice(0, -1); else if (String(v.cnt).length < 6) v.cnt = (v.cnt === '0' ? '' : v.cnt) + val;
        var mm = med(v.code); if (v.cnt !== '' && Math.abs(+v.cnt - mm.current_stock) >= BIG_DIFF && v.notify == null) v.notify = true;
        render(); break;
      case 'reason': v.reason = val; render(); break;
      case 'notify': v.notify = !v.notify; render(); break;
      case 'doFix':
        var fm = med(v.code), fb = fm.current_stock, fa = +v.cnt, big = Math.abs(fa - fb) >= BIG_DIFF;
        fm.current_stock = fa;
        var o3 = record({ type: 'fix', code: fm.code, name: fm.name, unit: fm.unit, before: fb, after: fa, delta: fa - fb, reason: v.reason,
          notify: big && v.notify ? '画面 ' + n(fb) + fm.unit + ' → 実数 ' + n(fa) + fm.unit + '（差 ' + sn(fa - fb) + '）。理由：' + v.reason + '。' + S.op : '' });
        go({ name: 'done', id: o3.id }); break;
      case 'filter': v.f = val; render(); break;
      case 'item': go({ name: 'item', code: val }); break;
      case 'itemIn': var im = med(v.code); go({ name: 'in', code: im.code, boxes: 1, pack: im.pack_size || 1, sup: im.supplier_name || D.suppliers[0] }); break;
      case 'itemFix': go({ name: 'fix', code: v.code, cnt: '', reason: '' }); break;
      case 'umLink':
        var x = D.karte_unmatched_examples[+val], cm = med(x.reason.match(/M\d{3}/)[0]), ub = cm.current_stock;
        cm.current_stock = ub - x.qty;
        DB.um[+val] = '候補「' + cm.name + '」から ' + x.qty + cm.unit + ' 減らしました（' + n(ub) + '→' + n(cm.current_stock) + '）';
        var o4 = record({ type: 'link', code: cm.code, name: cm.name, unit: cm.unit, before: ub, after: cm.current_stock, delta: -x.qty, reason: 'カルテ連動の取りこぼし（カルテ名：' + x.karte_name + '）', um: +val });
        save(); render(); toast(opText(o4)); break;
      case 'umOk':
        DB.um[+val] = '外用のため数えない（確認済み）';
        record({ type: 'ok', code: '', name: D.karte_unmatched_examples[+val].karte_name, delta: 0, um: +val }); save(); render(); toast('確認済みにしました'); break;
      case 'umHand':
        DB.um[+val] = '在庫担当に回しました';
        record({ type: 'hand', code: '', name: D.karte_unmatched_examples[+val].karte_name, delta: 0, um: +val }); save(); render(); toast('在庫担当に回しました'); break;
      case 'undo': undo(); break;
    }
  });

  // 検索欄：打つたびに結果だけ描き直す（入力中のカーソルを保つ）
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-in'); if (!k) return;
    var v = S.v; v.q = e.target.value;
    if (k === 'q') document.getElementById('hits').innerHTML = inHits(v.q, v.q ? search(v.q) : []);
    else if (k === 'mq') { var have = {}; DB.meds.forEach(function (m) { have[m.rezept_code] = m.code; }); document.getElementById('mhits').innerHTML = mHits(v.q ? msearch(v.q) : [], have); }
    else if (k === 'fq') document.getElementById('fhits').innerHTML = resultRows(v.q ? search(v.q) : DB.meds.filter(function (x) { return status(x) === 'neg'; }), 'pickFix');
    else if (k === 'sq') { var y = window.scrollY; render(); var el = document.getElementById('sq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); window.scrollTo(0, y); }
  });

  var ss = ls('sess'); if (ss && ss.op) S.op = ss.op;
  render();
  window.__demoH = { S: S, db: function () { return DB; } };
})();
