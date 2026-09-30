/* 案B：はじめての人の出荷（処方）ガイド
   だれに → なにを → いくつ → たしかめて送る。送った後しばらくは「取り消す」。
   テスト用の院だけ本番DB（sb.js）につながり、送る・取り消すで実際に在庫が動く。
   西春・中川は demo_data.js の見本を表示するだけで書き込まない。localStorage は画面の設定（院・担当）だけ */
(function () {
  'use strict';
  var D = window.DEMO_DATA, KS = window.KanaSearch, SB = window.SB;
  var LS = 'p9B_';
  var SRC = 'demo:B';
  var busy = false, resetArm = null, resetTimer = null, resetMsg = null;
  // 以前の版が localStorage に残した在庫・記録は使わない（消す）
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(LS + 'db_') === 0) localStorage.removeItem(k); }); } catch (e) {}
  var UNDO_SEC = 90;
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nf(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function lsGet(k, d) { try { var v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} }
  function fmt(n) { n = Math.round(n * 100) / 100; return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP'); }

  // よく出る薬（出庫件数の多い順 12品目）。テスト用＝DBの直近の出庫、西春・中川＝西春の実績の見本
  function topCodes() {
    var freq = {}, src = S.clinic === 'test' && SB.live ? D.daily_out_test : D.daily_out_nishiharu;
    (src || []).forEach(function (r) { freq[r.c] = (freq[r.c] || 0) + (+r.n); });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 12);
  }

  // ---------- 院ごとのデータ ----------
  // 在庫：テスト用＝DBの値（DEMO_DATA.medicines.test は sb.js が送信・読み直しのたびに更新）、西春・中川＝見本のまま
  // 送った記録（取り消し用）はこの画面の中だけに持つ。今日の記録（テスト用）はDBの在庫の動きから作る
  var LOG = {};
  function clinicInfo(id) { return D.clinics.filter(function (c) { return c.id === id; })[0]; }
  function meds() { return D.medicines[S.clinic] || []; }
  function med(code) { return meds().filter(function (m) { return m.code === code; })[0]; }
  function db() { return { log: LOG[S.clinic] || (LOG[S.clinic] = []) }; }
  function stock(code) { var m = med(code); return m ? Number(m.current_stock) || 0 : 0; }
  function canWrite() { return !!(S.clinic && SB.canWrite(S.clinic)); }

  // ---------- 状態 ----------
  var S = {
    clinic: lsGet('clinic', null), operator: lsGet('operator', null),
    screen: 'clinic', step: 1, sub: 'search',
    patient: null, date: today(), items: [], edit: null,
    query: '', filter: 'top', pq: '', lastSend: null, notice: null, stockQ: ''
  };
  if (S.clinic) S.screen = S.operator ? 'flow' : 'operator';
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function patient() { return D.patients.filter(function (p) { return p.no === S.patient; })[0]; }
  function isChild(p) { return p && p.age != null && p.age < 15; }

  // ---------- 薬の見た目 ----------
  function target(m) {
    var c = (m.category || '').split('/')[0];
    return { '成人': ['adult', '成人', '大人'], '小児': ['child', '小児', '子ども'], '外用': ['ext', '外用', '塗る・貼る'], '検査': ['test', '検査', 'キット'] }[c] || ['adult', c || '―', ''];
  }
  function tag(m, sm) { var t = target(m); return '<span class="tg ' + t[0] + (sm ? ' sm' : '') + '">' + t[1] + (sm ? '' : '<small>' + t[2] + '</small>') + '</span>'; }
  function split(m) {
    var n = nf(m.name), i = n.lastIndexOf(' ');
    if (m.group_name && i > 0) return { base: n.slice(0, i), str: n.slice(i + 1) };
    return { base: n, str: '' };
  }
  function nameHtml(m) { var s = split(m); return esc(s.base) + (s.str ? '<span class="str">' + esc(s.str) + '</span>' : ''); }
  function furi(m) { return m.furigana ? esc(m.furigana) : '&nbsp;'; }
  function stockHtml(m, label) {
    if (m.stock_untracked) return '<div class="stk ext"><div class="l">' + (label || '在庫') + '</div><div class="v">外用</div></div>';
    var v = stock(m.code), cls = v < 0 ? ' neg' : v === 0 ? ' zero' : '';
    return '<div class="stk' + cls + '"><div class="l">' + (label || '在庫') + '</div><div class="v num">' + fmt(v) + '<small>' + esc(m.unit) + '</small></div></div>';
  }
  function siblings(m) { return m.group_name ? meds().filter(function (x) { return x.group_name === m.group_name; }) : []; }
  // 飲み方の目安：1日◯回（頓服は「◯回分」）
  function dosing(m) {
    var t = target(m)[0];
    if (t === 'test' || t === 'ext' || m.stock_untracked) return { kind: 'one' };
    var u = nf(m.cat4 || '') + ' ' + nf(m.usage_text || '');
    if (m.cat2 === '頓服' || /頓服|症状がある時/.test(u)) return { kind: 'prn' };
    var k = u.match(/1日(\d)回/) || u.match(/分(\d)/);
    return { kind: 'day', per: k ? +k[1] : 3 };
  }

  // ---------- 用語の「？」 ----------
  var TIPS = {
    ship: ['出荷（処方）', '患者さんに院の薬を渡したことを記録することです。記録すると、その薬の在庫の数が減ります。'],
    stock: ['在庫', '院の棚にある薬の数です。出荷を記録すると自動で減ります。'],
    ext: ['外用', '貼る・塗る・吸う・目にさす薬です。決まりで在庫の数を数えないので、出しても数は変わりません。'],
    child: ['小児', '子ども用の薬です。粉薬は体重や年齢で1包の量が変わるので、量ちがいに気をつけます。'],
    prn: ['頓服（とんぷく）', '熱や痛みなど、症状があるときだけ飲む薬です。「◯回分」で数えます。'],
    grp: ['量ちがい', '同じ薬で1包の量（0.3g など）が違うものです。医師の指示の量と同じか、必ず見比べてください。'],
    test: ['練習モード', 'テスト用の院です。本番DBの「テスト用の院」につながっていて、送ると実際に在庫の値が動きます。西春・中川の在庫は変わりません。'],
    undo: ['取り消す', '送った直後なら、記録を消して在庫を元の数に戻せます。時間が過ぎたら先輩か在庫の担当に声をかけてください。'],
    over: ['在庫が足りない', '記録上の在庫より多く出そうとしています。送ることはできますが、棚の数を見て先輩か在庫の担当に知らせてください。'],
    search: ['薬の探し方', 'ローマ字（karonaru）・ひらがな・カタカナ、どれで打っても探せます。数字（0.3）を足すと量で絞れます。']
  };
  function hq(k) { return '<button class="hq" data-tip="' + k + '" aria-label="' + esc(TIPS[k][0]) + 'の説明">？</button>'; }
  function showTip(btn) {
    var t = TIPS[btn.getAttribute('data-tip')], el = $('#tip');
    if (!el.hidden && el._for === btn) { el.hidden = true; return; }
    el.innerHTML = '<b>' + esc(t[0]) + '</b>' + esc(t[1]); el.hidden = false; el._for = btn;
    var r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    var x = Math.min(window.innerWidth - w - 10, Math.max(10, r.left - 20)), y = r.bottom + 8;
    if (y + h > window.innerHeight - 10) y = r.top - h - 8;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  // ---------- 描画 ----------
  var lastKey = '';
  function go(fn, back) {
    fn && fn();
    var key = S.screen + '/' + S.step + '/' + S.sub;
    var moved = key !== lastKey; lastKey = key;
    var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#tip').hidden = true;
    if (moved && document.startViewTransition && !rm) {
      document.documentElement.classList.toggle('back', !!back);
      document.startViewTransition(render);
    } else render();
  }

  function render() {
    document.body.setAttribute('data-clinic', S.screen === 'clinic' && !S.clinic ? '' : (S.clinic || ''));
    document.body.setAttribute('data-screen', S.screen);
    renderTop(); renderSteps();
    var st = $('#stage');
    if (S.screen === 'clinic') st.innerHTML = vClinic();
    else if (S.screen === 'operator') st.innerHTML = vOperator();
    else if (S.screen === 'stock') st.innerHTML = vStock();
    else if (S.screen === 'log') st.innerHTML = vLog();
    else if (S.screen === 'done') st.innerHTML = vDone();
    else st.innerHTML = vFlow();
    renderBar();
    if (S.screen === 'flow' && S.step === 2 && S.sub === 'search') renderMedList();
    if (S.screen === 'flow' && S.step === 1) renderPatients();
    if (S.screen === 'flow' && S.step === 3) renderQtyLive();
    if (S.screen === 'stock') renderStockRows();
    if (S.screen === 'done') tickUndo();
  }

  function renderTop() {
    var t = $('#top');
    if (S.screen === 'clinic' || !S.clinic) {
      t.innerHTML = '<span class="cname">薬品在庫 ─ 出荷（処方）<small>v0.9 ・ はじめに働く院を選びます</small></span>';
      return;
    }
    var c = clinicInfo(S.clinic), test = S.clinic === 'test';
    t.innerHTML =
      '<span class="mode">' + (test ? '練習モード' : '本番') + '</span>' + (test ? hq('test') : '') +
      '<span class="cname">' + esc(c.name) + '<small>' + (test ? (SB.live ? '本番DBに接続中 ・ 操作すると実際に値が動きます（西春・中川には影響しません）' : 'DBに接続できないため見本データで表示中（送れません）') : (S.clinic === 'nakagawa' ? '11月開院予定 ・ 見本データを表示中（このデモでは送れません）' : '見本データを表示中（このデモでは送れません）')) + '</small></span>' +
      '<span class="top-sp"></span>' +
      (S.operator ? '<button class="tbtn" id="nav-op">担当 <b>' + esc(S.operator) + '</b></button>' : '') +
      '<button class="tbtn' + (S.screen === 'flow' || S.screen === 'done' ? ' on' : '') + '" id="nav-flow">出荷</button>' +
      '<button class="tbtn' + (S.screen === 'stock' ? ' on' : '') + '" id="nav-stock">在庫を見る</button>' +
      '<button class="tbtn' + (S.screen === 'log' ? ' on' : '') + '" id="nav-log">今日の記録</button>' +
      '<button class="tbtn" id="nav-clinic">院を切り替える</button>';
  }

  var STEPS = [['だれに', '患者さん'], ['なにを', '薬'], ['いくつ', '数'], ['たしかめて送る', '最後の確認']];
  function renderSteps() {
    var el = $('#steps');
    if (S.screen !== 'flow' && S.screen !== 'done') { el.innerHTML = ''; return; }
    var cur = S.screen === 'done' ? 5 : S.step;
    el.innerHTML = STEPS.map(function (s, i) {
      var n = i + 1, cls = n < cur ? 'done' : n === cur ? 'now' : '';
      return '<div class="st ' + cls + '"><i>' + (n < cur ? '✓' : n) + '</i><span>' + s[0] + '<small>' + s[1] + '</small></span></div>';
    }).join('');
  }

  // ----- 院を選ぶ -----
  function vClinic() {
    var desc = {
      nishiharu: ['本番', '日中の外来・在宅と、夜間休日のドライブスルー外来。', '見本データを表示（このデモでは送れません）'],
      nakagawa: ['本番', '11月開院予定。在庫は0から始まります。', '見本データを表示（このデモでは送れません）'],
      test: ['練習用', 'はじめての方はここで練習してください。西春と同じ薬が入っています。', SB.live ? '本番DBに接続中。送ると実際に在庫が動きます' : 'DBに接続できないため見本データ（送れません）']
    };
    return '<div class="cl-wrap"><p class="q">どこの院で働きますか？</p><p class="lead">選んだ院はこのタブレットが覚えます。あとから上の「院を切り替える」で変えられます。</p>' +
      '<div class="cl-grid">' + ['test', 'nishiharu', 'nakagawa'].map(function (id) {
        var c = clinicInfo(id), d = desc[id];
        return '<button class="cl ' + id + (S.clinic === id ? ' cur' : '') + (id === 'test' && !S.clinic ? ' rec' : '') + '" id="clinic-' + id + '">' +
          '<div class="band" style="' + (id === 'test' ? '' : 'background:' + c.color) + '"><span>' + d[0] + '</span>' + (id === 'test' ? 'はじめての方はこちら' : '') + '</div>' +
          '<div class="body"><h3>' + esc(c.short) + '</h3><p>' + esc(c.name) + '</p><p>' + esc(d[1]) + '</p><p class="go">' + esc(d[2]) + ' →</p></div></button>';
      }).join('') + '</div>' +
      '<div class="cl-foot"><span>' + (SB.live ? '<b>テスト用の院は本番DBに接続中。</b>操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データを表示し、書き込みはしません。'
        : '<b>DBに接続できないため、テスト用の院も見本データで表示しています（送れません）。</b>' + (SB.error ? '理由: ' + esc(SB.error) : '')) + '</span>' + resetBtnHtml() + '</div>' + resetMsgHtml() + '</div>';
  }

  function vOperator() {
    return '<div class="cl-wrap"><p class="q">あなたはどなたですか？</p><p class="lead">記録に「担当者」として残ります。次からは選ばなくても大丈夫です。</p>' +
      '<div class="pgrid" style="grid-template-columns:repeat(3,1fr)">' + D.operators.map(function (o, i) {
        return '<button class="pick" id="op-' + i + '" data-op="' + esc(o) + '"><span class="pn">' + esc(o) + '</span><span class="chk"></span></button>';
      }).join('') + '</div></div>';
  }

  // ----- 出荷の段階 -----
  function sideHtml() {
    var p = patient();
    return '<aside class="panel side"><h4>いまの内容</h4>' +
      '<div class="row"><h4>担当</h4><div class="v">' + esc(S.operator) + '</div></div>' +
      '<div class="row"><h4>診察日</h4><div class="v num">' + esc(S.date.replace(/-/g, '/')) + '</div></div>' +
      '<div class="row"><h4>患者さん</h4><div class="v">' + (p ? esc(p.name.replace('（架空）', '')) + '<div class="pm">' + esc(p.no) + ' ・ ' + p.age + '歳' + (p.weight ? ' ・ ' + p.weight + 'kg' : '') + '</div>' : '<span class="empty">まだ選んでいません</span>') + '</div></div>' +
      '<div><h4>薬（' + S.items.length + '）</h4>' + (S.items.length ? '<ul>' + S.items.map(function (it, i) {
        var m = med(it.code);
        return '<li>' + tag(m, true) + '<span>' + esc(nf(m.name)) + '<br><b class="num">' + fmt(it.qty) + m.unit + '</b></span><button class="x" data-rm="' + i + '">外す</button></li>';
      }).join('') + '</ul>' : '<div class="empty" style="font-size:15px">まだ入っていません</div>') + '</div></aside>';
  }

  function childNote() {
    var p = patient(); if (!isChild(p)) return '';
    return '<div class="note child"><span class="ico">子</span><div><b>' + esc(p.name.replace('（架空）', '')) + 'さんは ' + p.age + '歳' + (p.weight ? '・' + p.weight + 'kg' : '') + '（小児）</b>です。' + hq('child') + ' 粉薬は医師の指示の量（0.3g など）と同じものを選んでください。</div></div>';
  }

  function vFlow() {
    var left = '';
    if (S.step === 1) {
      left = '<p class="q">だれに薬を渡しますか？</p><p class="lead">名前か番号で探して、患者さんを1人タップします。</p>' +
        '<div class="search"><span class="ic">検索</span><input id="pt-search" placeholder="名前 または 番号（例 006）" value="' + esc(S.pq) + '" autocomplete="off"></div>' +
        '<div class="scroll" id="pt-list"></div>';
    } else if (S.step === 2 && S.sub === 'more') {
      var last = med(S.items[S.items.length - 1].code);
      left = '<div class="note good"><span class="ico">✓</span><div><b>' + esc(nf(last.name)) + '</b> を入れました（右の「いまの内容」に出ています）。</div></div>' +
        '<p class="q">ほかにも渡す薬はありますか？</p><p class="lead">処方せん（指示の紙）を上から見て、まだの薬がないか確かめてください。1人あたり平均3品目です。</p>' +
        '<div class="ask"><button id="more-yes">ある<small>もう1つ薬を探す</small></button><button id="more-no">ない<small>これで全部。たしかめへ進む</small></button></div>';
    } else if (S.step === 2) {
      left = '<p class="q">どの薬ですか？ ' + hq('search') + '</p>' + childNote() +
        '<div class="search' + (S.query ? '' : ' nx') + '" id="med-search-box"><span class="ic">検索</span><input id="med-search" placeholder="薬の名前（ローマ字・かな どれでも）" value="' + esc(S.query) + '" autocomplete="off"><button class="clr" id="med-clear">消す</button></div>' +
        '<div class="readback" id="readback"></div>' +
        '<div class="chips">' + [['top', 'よく出る'], ['all', 'すべて'], ['成人', '成人'], ['小児', '小児'], ['外用', '外用'], ['検査', '検査']].map(function (c) {
          return '<button class="chip' + (S.filter === c[0] ? ' on' : '') + '" data-filter="' + c[0] + '">' + c[1] + '</button>';
        }).join('') + '</div><div class="scroll" id="med-list"></div>';
    } else if (S.step === 3) {
      var m = med(S.edit.code), dz = dosing(m), sib = siblings(m);
      left = '<div class="panel mhead">' + tag(m) + '<div style="flex:1"><div class="fu">' + furi(m) + '</div><div class="na">' + nameHtml(m) + '</div>' +
        '<div class="use">飲み方の目安：' + esc(nf(m.cat4 || '（記載なし）')) + (m.cat2 === '頓服' ? ' ' + hq('prn') : '') + '</div></div>' + stockHtml(m, 'いまの在庫') + '</div>' +
        (sib.length > 1 ? '<div class="note child"><span class="ico">量</span><div><b>この薬には量ちがいが ' + sib.length + '種類 あります。</b>' + hq('grp') + ' 指示の量と同じか見比べてください。' +
          '<div class="sibs">' + sib.map(function (x) { return '<button data-sib="' + x.code + '" class="' + (x.code === m.code ? 'on' : '') + '">' + esc(split(x).str) + '</button>'; }).join('') + '</div></div></div>' : '') +
        targetMismatch(m) +
        '<div class="panel qtybox"><div><div class="qq">いくつ渡しますか？</div><div class="stepper"><button id="qty-minus" aria-label="1つ減らす">−</button><input id="qty" inputmode="numeric" value="' + (S.edit.qty || '') + '"><span class="u">' + esc(m.unit) + '</span><button id="qty-plus" aria-label="1つ増やす">＋</button></div></div>' +
        '<div class="calc">' + calcHtml(m, dz) + '</div></div>' +
        '<div id="qty-live"></div>';
    } else if (S.step === 4) {
      var p = patient(), over = 0;
      var rows = S.items.map(function (it, i) {
        var m = med(it.code), b = stock(it.code), a = m.stock_untracked ? null : b - it.qty; if (a != null && a < 0) over++;
        return '<tr class="' + (a != null && a < 0 ? 'over' : '') + '"><td>' + tag(m, true) + '</td><td><div class="fu">' + furi(m) + '</div><div class="na">' + nameHtml(m) + '</div></td>' +
          '<td class="r"><span class="qv num">' + fmt(it.qty) + '</span> ' + esc(m.unit) + '</td>' +
          '<td class="r num">' + (m.stock_untracked ? '<span style="color:var(--t-ext);font-weight:700">外用</span><div class="fu">減りません</div>' : fmt(b) + ' → <span class="aft' + (a < 0 ? ' neg' : '') + '">' + fmt(a) + '</span>' + (a < 0 ? '<div class="fu" style="color:var(--bad)">足りません</div>' : '')) + '</td>' +
          '<td class="r"><button class="ed" data-edit="' + i + '">直す</button></td></tr>';
      }).join('');
      left = '<p class="q">この内容で送りますか？</p><p class="lead">処方せんと1行ずつ見比べてから、下の「送る」を押します。送ったあとも少しの間は取り消せます。</p>' +
        '<div class="panel who"><div>患者さん<b>' + esc(p.name.replace('（架空）', '')) + ' <span class="num" style="font-size:15px;color:var(--sub)">' + esc(p.no) + '</span></b></div><div>診察日<b class="num">' + S.date.replace(/-/g, '/') + '</b></div><div>担当<b>' + esc(S.operator) + '</b></div></div>' +
        (over ? '<div class="note bad" id="over-note"><span class="ico">!</span><div><b>在庫が足りない薬が ' + over + 'つ あります。</b>' + hq('over') + ' 送ることはできますが、棚の数を見て、先輩か在庫の担当に知らせてください。</div></div>' : '') +
        '<div class="scroll" style="flex:none;max-height:none"><table class="ck panel"><tr><th>対象</th><th>薬</th><th style="text-align:right">渡す数</th><th style="text-align:right">在庫 いま → 送ったあと</th><th></th></tr>' + rows + '</table></div>';
    }
    return '<div class="two"><section class="col">' + left + '</section>' + sideHtml() + '</div>';
  }

  function targetMismatch(m) {
    var p = patient(), t = target(m)[0]; if (!p) return '';
    if (isChild(p) && t === 'adult') return '<div class="note warn"><span class="ico">!</span><div>この薬は<b>成人用</b>です。患者さんは' + p.age + '歳です。医師の指示どおりか確かめてください。</div></div>';
    if (!isChild(p) && t === 'child') return '<div class="note warn"><span class="ico">!</span><div>この薬は<b>小児用</b>です。患者さんは' + p.age + '歳です。医師の指示どおりか確かめてください。</div></div>';
    return '';
  }

  function calcHtml(m, dz) {
    if (dz.kind === 'one') return '<div>' + (m.stock_untracked ? '外用薬です。' + hq('ext') + ' 出しても在庫の数は変わりません。' : '検査キットは、ふつう1人に1つです。') + '</div>' +
      '<div class="btns">' + [1, 2].map(function (n) { return '<button data-set="' + n + '" id="set-' + n + '" class="' + (S.edit.qty === n ? 'on' : '') + '">' + n + m.unit + '</button>'; }).join('') + '</div>';
    if (dz.kind === 'prn') return '<div>頓服は「回数分」で数えます。1回1' + esc(m.unit) + 'として：</div>' +
      '<div class="btns">' + [3, 5, 10].map(function (n) { return '<button data-days="' + n + '" id="days-' + n + '" class="' + (S.edit.days === n ? 'on' : '') + '">' + n + '回分</button>'; }).join('') + '</div>' +
      '<div class="f" id="calc-f">' + (S.edit.days ? '1回1' + m.unit + ' × ' + S.edit.days + '回分 ＝ <b class="num">' + S.edit.days + m.unit + '</b>' : '回数のボタンを押すと数が入ります') + '</div>';
    return '<div>目安：1日' + dz.per + '回、1回1' + esc(m.unit) + 'として</div>' +
      '<div class="btns">' + [3, 5, 7].map(function (n) { return '<button data-days="' + n + '" id="days-' + n + '" class="' + (S.edit.days === n ? 'on' : '') + '">' + n + '日分</button>'; }).join('') + '</div>' +
      '<div class="f" id="calc-f">' + (S.edit.days ? '1日' + dz.per + '回 × ' + S.edit.days + '日分 ＝ <b class="num">' + dz.per * S.edit.days + m.unit + '</b>' : '日数のボタンを押すと数が入ります') + '</div>';
  }

  function renderQtyLive() {
    var el = $('#qty-live'); if (!el) return;
    var m = med(S.edit.code), q = S.edit.qty || 0, b = stock(m.code);
    if (m.stock_untracked) { el.innerHTML = '<div class="panel flow"><div class="b"><div class="l">いまの在庫</div><div class="v" style="color:var(--t-ext)">外用</div></div><div style="font-size:16px;color:var(--sub)">外用薬は在庫を数えない決まりです。出しても数は減りません。</div></div>'; updateBar(); return; }
    var a = b - q;
    var html = '<div class="panel flow"><div class="b"><div class="l">いまの在庫</div><div class="v num">' + fmt(b) + '<small style="font-size:16px">' + m.unit + '</small></div></div><div class="to">→</div>' +
      '<div class="b after' + (a < 0 ? ' neg' : '') + '"><div class="l">渡したあと</div><div class="v num">' + fmt(a) + '<small style="font-size:16px">' + m.unit + '</small></div></div>';
    if (q > 0 && a < 0) html += '<div class="msg bad" id="over-warn"><b>在庫が足りません。</b>' + hq('over') + '<br>' + fmt(q) + m.unit + ' 渡すと ' + fmt(a) + m.unit + ' になります。数をもう一度確かめ、棚の数が違うときは先輩に知らせてください。（このまま進むこともできます）</div></div>';
    else if (b < 0) html += '<div class="msg warn">この薬は記録上の在庫がすでにマイナスです。棚の数と合っていない可能性があります。</div></div>';
    else html += '<div class="msg">送るまでは在庫は減りません。</div></div>';
    if (q > 0 && a < 0) html = html.replace('class="panel flow"', 'class="panel flow over"');
    el.innerHTML = html; updateBar();
  }

  function renderPatients() {
    var el = $('#pt-list'); if (!el) return;
    var list = KS.filter(D.patients, S.pq, function (p) { return [p.name, p.no]; });
    el.innerHTML = list.length ? '<div class="pgrid">' + list.map(function (p) {
      var sel = S.patient === p.no;
      return '<button class="pick' + (sel ? ' sel' : '') + '" id="pt-' + p.no + '" data-pt="' + p.no + '"><div><div class="pn">' + esc(p.name.replace('（架空）', '')) + ' <span class="pm">（架空）</span></div>' +
        '<div class="pm"><span class="num">' + esc(p.no) + '</span> ・ ' + p.age + '歳' + (p.weight ? ' ・ ' + p.weight + 'kg' : '') + '</div></div>' + (isChild(p) ? '<span class="tg child sm">小児</span>' : '') + '<span class="chk">' + (sel ? '✓' : '') + '</span></button>';
    }).join('') + '</div>' : '<div class="note warn"><span class="ico">?</span><div>見つかりません。番号の数字だけ（例 006）でも探せます。</div></div>';
  }

  function renderMedList() {
    var el = $('#med-list'); if (!el) return;
    var q = S.query.trim(), list;
    var rb = $('#readback');
    if (rb) {
      if (/[a-zA-Z]/.test(q) && !/^m\d/i.test(q)) {
        var kk = q.split(/\s+/).map(function (w) { return /[a-z]/i.test(w) ? KS.romaji(w) : w; }).join(' ');
        rb.innerHTML = '「' + esc(q) + '」を <b>' + esc(kk) + '</b> と読み替えて探しています<span id="hits"></span>';
      } else rb.innerHTML = q ? '「' + esc(q) + '」で探しています' : 'よく出る薬から選ぶか、名前を打って探します';
    }
    if (!q && S.filter === 'top') list = topCodes().map(med).filter(Boolean);
    else {
      list = q ? KS.filter(meds(), q, function (m) { return [m.name, m.furigana, m.code, m.category, m.group_name]; }) : meds().slice();
      if (S.filter !== 'top' && S.filter !== 'all') list = list.filter(function (m) { return (m.category || '').indexOf(S.filter) === 0; });
    }
    var eff = (q && S.filter === 'top') ? 'all' : S.filter;
    document.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.filter === eff); });
    var hs = $('#hits'); if (hs) hs.textContent = ' → ' + list.length + '件 見つかりました';
    var first = true;
    el.innerHTML = list.length ? list.map(function (m) {
      var sib = siblings(m).length, nx = q && first; first = false;
      return '<button class="med' + (nx && list.length <= 6 ? '' : '') + '" id="med-' + m.code + '" data-med="' + m.code + '">' + tag(m) +
        '<div class="nm"><div class="fu">' + furi(m) + '</div><div class="na">' + nameHtml(m) + '</div>' +
        (sib > 1 ? '<div class="grp">量ちがい ' + sib + '種類 ─ 指示の量か確かめる</div>' : '') + '</div>' + stockHtml(m) + '<span class="arrow">›</span></button>';
    }).join('') : '<div class="note warn"><span class="ico">?</span><div>見つかりません。最初の2〜3文字だけ（例 karo）でも探せます。</div></div>';
  }

  // ----- 送った -----
  function vDone() {
    var L = db().log.filter(function (x) { return x.id === S.lastSend; })[0];
    if (!L) return '';
    var p = D.patients.filter(function (x) { return x.no === L.patient; })[0];
    var items = L.items.map(function (it) {
      var m = med(it.code);
      return '<div class="panel it">' + tag(m, true) + '<span class="nm">' + esc(nf(m.name)) + ' <span class="num" style="font-weight:400;color:var(--sub)">× ' + fmt(it.qty) + m.unit + '</span></span>' +
        (it.untracked ? '<span class="fl" style="color:var(--t-ext);font-size:18px">外用（在庫は変わりません）</span>' :
          '<span class="fl num"><span style="color:var(--faint);font-size:17px">' + (L.undone ? '在庫を戻した' : '在庫') + '</span> ' + fmt(L.undone ? it.after : it.before) + ' → <span class="a' + (L.undone ? '' : (it.after < 0 ? ' neg' : '')) + '">' + fmt(L.undone ? it.before : it.after) + '</span><small style="font-size:15px">' + m.unit + '</small></span>') + '</div>';
    }).join('');
    if (L.undone) {
      return '<div class="done undone"><h2><span class="mk">↺</span>取り消しました</h2><p class="lead">' + esc(p.name.replace('（架空）', '')) + 'さんの出荷の記録を消し、在庫を元の数に戻しました。</p><div class="dl">' + items + '</div>' +
        '<div class="note good"><span class="ico">✓</span><div>在庫は送る前と同じ数です。やり直すときは「次の患者さんへ」から、もう一度同じ手順で入れてください。</div></div></div>';
    }
    return '<div class="done"><h2><span class="mk">✓</span>送りました</h2><p class="lead">' + esc(p.name.replace('（架空）', '')) + 'さんの出荷（処方）を記録しました。在庫がこのように減りました。</p><div class="dl">' + items + '</div>' +
      (S.err ? '<div class="note bad" id="sb-err"><span class="ico">!</span><div>' + esc(S.err) + '</div></div>' : '') +
      '<div class="undo" id="undo-box"><div class="t"><b>まちがえたときは「取り消す」</b> ' + hq('undo') + '<br><span id="undo-left">あと ' + UNDO_SEC + '秒</span> のあいだ押せます。在庫は元に戻ります。<div class="bar-time"><i id="undo-bar"></i></div></div><button id="undo">取り消す</button></div></div>';
  }
  var undoTimer = null;
  function tickUndo() {
    clearInterval(undoTimer);
    var L = db().log.filter(function (x) { return x.id === S.lastSend; })[0];
    if (!L || L.undone) return;
    function t() {
      var left = Math.max(0, Math.ceil((L.ts + UNDO_SEC * 1000 - Date.now()) / 1000));
      var a = $('#undo-left'), b = $('#undo-bar'), btn = $('#undo');
      if (!a) { clearInterval(undoTimer); return; }
      a.textContent = left > 0 ? 'あと ' + left + '秒' : '時間を過ぎました（先輩か在庫の担当へ）';
      b.style.transform = 'scaleX(' + (left / UNDO_SEC) + ')';
      if (left <= 0) { btn.disabled = true; btn.style.opacity = .4; clearInterval(undoTimer); }
    }
    t(); undoTimer = setInterval(t, 1000);
  }

  // ----- 在庫・記録 -----
  function vStock() {
    return '<div class="col" style="height:100%"><p class="q">在庫を見る ' + hq('stock') + '</p>' +
      '<div class="search"><span class="ic">検索</span><input id="stock-search" placeholder="薬の名前（ローマ字・かな どれでも）" value="' + esc(S.stockQ) + '" autocomplete="off">' + (S.clinic === 'test' ? resetBtnHtml('min-height:40px') : '') + '</div>' + resetMsgHtml() +
      '<p class="lead" style="margin:4px 0 8px">' + (S.clinic === 'test' && SB.live ? '本番DBのテスト用の院の在庫です（開くたびに読み直します）。' : '見本データの在庫です（このデモでは変わりません）。') + '</p>' +
      '<div class="scroll panel" style="padding:0"><table class="tbl"><thead><tr><th>対象</th><th>薬</th><th style="text-align:right">在庫</th><th style="text-align:right">少ない目安</th></tr></thead><tbody id="stock-rows"></tbody></table></div></div>';
  }
  function renderStockRows() {
    var el = $('#stock-rows'); if (!el) return;
    var changed = {};
    db().log.forEach(function (L) { if (!L.undone) L.items.forEach(function (it) { changed[it.code] = 1; }); });
    var list = KS.filter(meds(), S.stockQ, function (m) { return [m.name, m.furigana, m.code, m.category]; });
    el.innerHTML = list.map(function (m) {
      var v = stock(m.code);
      return '<tr class="' + (changed[m.code] ? 'chg' : '') + '" id="row-' + m.code + '"><td>' + tag(m, true) + '</td><td><div style="font-size:12px;color:var(--sub)">' + furi(m) + '</div><b>' + esc(nf(m.name)) + '</b></td>' +
        '<td class="r num ' + (m.stock_untracked ? '' : v < 0 ? 'neg' : '') + '">' + (m.stock_untracked ? '<span style="color:var(--t-ext);font-weight:700">外用</span>' : fmt(v) + ' ' + esc(m.unit)) + '</td>' +
        '<td class="r num" style="color:var(--faint)">' + (m.stock_untracked ? '―' : fmt(m.threshold || 0)) + '</td></tr>';
    }).join('');
  }
  // テスト用の院の今日の出荷＝DBの在庫の動き（SB.moves）から。1回の送信でまとめて入った行を1件にまとめる
  function dbLog() {
    var g = [], idx = {}, td = today();
    SB.moves('test').forEach(function (m) {
      if ((m.kind !== 'out' && m.kind !== 'karte_out') || m.occurred_on !== td) return;
      var k = [m.created_at, m.kind, m.source, m.operator, m.ref, m.note].join('|');
      var x = idx[k];
      if (!x) { x = idx[k] = { ts: Date.parse(m.created_at), who: m.note || (m.kind === 'karte_out' ? 'カルテから' : ''), op: m.operator || m.source || '', undone: false, items: [] }; g.push(x); }
      if (m.voided_at) x.undone = true;
      x.items.push({ code: m.medicine_code, qty: Math.abs(Number(m.qty) || 0), before: m.stock_before, after: m.stock_after });
    });
    return g;
  }
  function vLog() {
    if (S.clinic === 'test' && SB.live) {
      var G = dbLog();
      return '<div class="col" style="height:100%"><p class="q">今日の記録</p><p class="lead">テスト用の院で今日送った出荷（処方）です（本番DBの記録・新しい順。ほかの端末の分も含みます）。取り消した記録も残ります。</p>' +
        '<div class="scroll panel" style="padding:0"><table class="tbl"><thead><tr><th>時刻</th><th>患者さん</th><th>薬</th><th>担当</th><th>状態</th></tr></thead><tbody>' +
        (G.length ? G.map(function (x) {
          return '<tr><td class="num">' + new Date(x.ts).toTimeString().slice(0, 5) + '</td><td>' + esc(x.who) + '</td><td>' + x.items.map(function (it) { var m = med(it.code);
            return esc(m ? nf(m.name) : it.code) + ' ×' + fmt(it.qty) + (m ? m.unit : '') + (it.before != null ? ' <span style="color:var(--faint)">（在庫 ' + fmt(it.before) + '→' + fmt(it.after) + '）</span>' : ''); }).join('<br>') + '</td><td>' + esc(x.op) + '</td>' +
            '<td>' + (x.undone ? '<span class="stt" style="color:var(--sub)">取り消し済</span>' : '<span class="stt" style="color:var(--good)">記録済</span>') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" style="color:var(--faint);padding:20px">今日はまだ記録はありません</td></tr>') + '</tbody></table></div></div>';
    }
    var L = db().log.slice().reverse();
    return '<div class="col" style="height:100%"><p class="q">今日の記録</p><p class="lead">見本データを表示中のため、この院の記録はありません（このデモでは送れません）。</p>' +
      '<div class="scroll panel" style="padding:0"><table class="tbl"><thead><tr><th>時刻</th><th>患者さん</th><th>薬</th><th>担当</th><th>状態</th></tr></thead><tbody>' +
      (L.length ? L.map(function (x) {
        var p = D.patients.filter(function (q) { return q.no === x.patient; })[0];
        return '<tr><td class="num">' + new Date(x.ts).toTimeString().slice(0, 5) + '</td><td>' + esc(p ? p.name : x.patient) + '</td><td>' + x.items.map(function (it) { var m = med(it.code); return esc(nf(m.name)) + ' ×' + fmt(it.qty) + m.unit; }).join('<br>') + '</td><td>' + esc(x.op) + '</td>' +
          '<td>' + (x.undone ? '<span class="stt" style="color:var(--sub)">取り消し済</span>' : '<span class="stt" style="color:var(--good)">記録済</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" style="color:var(--faint);padding:20px">まだ記録はありません</td></tr>') + '</tbody></table></div></div>';
  }

  // ----- 下の操作帯 -----
  function barState() {
    if (S.screen === 'done') return { now: 'この患者さんは終わりです', label: '次の患者さんへ', ok: true };
    if (S.screen !== 'flow') return null;
    if (S.step === 1) return { now: S.patient ? '<b>患者さんを選びました。</b>次へ進みます' : '<b>患者さんをタップ</b>してください', label: '次へ：薬を選ぶ', ok: !!S.patient, back: false };
    if (S.step === 2 && S.sub === 'more') return { now: '<b>「ある」か「ない」</b>を押してください', label: null, back: true };
    if (S.step === 2) return S.items.length ? { now: '薬を探すか、全部入れたら右へ', label: '全部入れた：たしかめへ', ok: true, back: true } : { now: '<b>薬をタップ</b>してください（1つずつ入れます）', label: '薬を選ぶと次へ進めます', ok: false, back: true };
    if (S.step === 3) return { now: S.edit.qty > 0 ? '<b>数を確かめたら</b>右のボタン' : '<b>数を入れて</b>ください（ボタンで目安が入ります）', label: S.edit.idx != null ? 'この数に直す' : 'この数で入れる', ok: S.edit.qty > 0, back: true };
    if (S.step === 4) return { now: busy ? '<b>送っています…</b>' : '<b>処方せんと見比べたら</b>送ります', label: busy ? '送信中…' : (canWrite() ? '送る（出荷をDBに記録）' : '送る（出荷を記録）'), ok: S.items.length > 0 && !busy, back: !busy, send: true };
  }
  function renderBar() {
    var b = barState(), el = $('#bar');
    if (!b) { el.innerHTML = ''; return; }
    el.innerHTML = (b.back ? '<button class="back" id="back">‹ もどる</button>' : '') + '<div class="nowtxt" id="now">' + b.now + '</div>' +
      (b.label ? '<button class="primary' + (b.send ? ' send' : '') + (b.ok ? ' nx' : '') + '" id="next"' + (b.ok ? '' : ' disabled') + '>' + b.label + '</button>' : '');
  }
  function updateBar() {
    var b = barState(), n = $('#next'), w = $('#now'); if (!b || !n) return;
    n.disabled = !b.ok; n.classList.toggle('nx', !!b.ok); n.textContent = b.label; w.innerHTML = b.now;
  }

  // ---------- 操作 ----------
  function resetFlow() { S.err = null; S.roMsg = false; S.step = 1; S.sub = 'search'; S.patient = null; S.items = []; S.edit = null; S.query = ''; S.filter = 'top'; S.pq = ''; }
  function openQty(code, idx) {
    var it = idx != null ? S.items[idx] : null;
    S.edit = { code: code, qty: it ? it.qty : 0, days: null, idx: idx };
    var m = med(code);
    if (!it && dosing(m).kind === 'one') S.edit.qty = 1;
    S.step = 3;
  }
  // 送る＝テスト用の院のDBへ出荷（kind:'out'）を記録。外用（在庫を数えない薬）はDBへ送らない
  async function send() {
    if (busy) return;
    if (!canWrite()) { S.roMsg = true; S.err = null; go(); return; }
    var p = patient(), pname = /（架空）/.test(p.name) ? p.name : '（架空）' + p.name;
    var L = { id: 'S' + Date.now(), ts: Date.now(), patient: S.patient, date: S.date, op: S.operator, visit: S.clinic + '|' + S.patient + '|' + S.date, undone: false, items: [], tx: [] };
    var reqs = [];
    S.items.forEach(function (it) {
      var m = med(it.code), b = stock(it.code);
      L.items.push({ code: it.code, qty: it.qty, before: b, after: b, untracked: !!m.stock_untracked });
      if (!m.stock_untracked) reqs.push({ code: it.code, kind: 'out', delta: -it.qty, note: pname, ref: L.visit });
    });
    busy = true; S.err = null; renderBar();
    try {
      var res = reqs.length ? await SB.apply('test', reqs, S.operator, SRC) : [];
      res.forEach(function (r) {
        L.tx.push(r.tx_id);
        L.items.forEach(function (x) { if (x.code === r.code && !x.untracked) { x.before = Number(r.before); x.after = Number(r.after); } });
      });
    } catch (e) {
      busy = false; S.err = '送れませんでした（在庫は変わっていません）: ' + e.message; lastKey = 'x'; go(); return;
    }
    busy = false;
    L.ts = Date.now(); db().log.push(L); S.lastSend = L.id; resetFlow(); S.screen = 'done'; go();
  }
  // 取り消す＝SB.voidTx で DB の記録を取り消し、在庫を戻す
  async function undo() {
    var L = db().log.filter(function (x) { return x.id === S.lastSend; })[0];
    if (!L || L.undone || busy) return;
    if (!canWrite()) return;
    busy = true; S.err = null; var ub = $('#undo'); if (ub) { ub.disabled = true; ub.textContent = '取り消し中…'; }
    try {
      var res = L.tx.length ? await SB.voidTx('test', L.tx, S.operator) : [];
      res.forEach(function (r) { L.items.forEach(function (x) { if (x.code === r.code && !x.untracked) { x.after = Number(r.before); x.before = Number(r.after); } }); });
    } catch (e) {
      busy = false; S.err = '取り消せませんでした（在庫は変わっていません）: ' + e.message; lastKey = 'x'; go(); return;
    }
    busy = false; L.undone = true; lastKey = 'x'; go();
  }
  function setClinic(id) {
    var from = S.clinic; S.clinic = id; lsSet('clinic', id); resetFlow(); S.roMsg = false; S.err = null;
    S.notice = from && from !== id && id !== 'test' ? id : null;
    S.screen = S.operator ? 'flow' : 'operator';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) { if (!e.target.closest('#tip')) $('#tip').hidden = true; return; }
    if (t.dataset.tip) { e.stopPropagation(); showTip(t); return; }
    var id = t.id;
    if (id.indexOf('clinic-') === 0) return go(function () { setClinic(id.slice(7)); });
    if (t.dataset.op) return go(function () { S.operator = t.dataset.op; lsSet('operator', S.operator); S.screen = 'flow'; });
    if (id === 'reset') { resetTest(); return; }
    if (id === 'nav-clinic') return go(function () { S.screen = 'clinic'; });
    if (id === 'nav-op') return go(function () { S.screen = 'operator'; });
    if (id === 'nav-stock') { go(function () { S.screen = 'stock'; }); return reload('stock'); }
    if (id === 'nav-log') { go(function () { S.screen = 'log'; }); return reload('log'); }
    if (id === 'nav-flow') return go(function () { if (S.screen === 'done') resetFlow(); S.screen = 'flow'; });
    if (t.dataset.pt) { S.patient = t.dataset.pt; renderPatients(); $('.side').outerHTML = sideHtml(); updateBar(); return; }
    if (t.dataset.filter) { S.filter = t.dataset.filter; document.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === t); }); renderMedList(); return; }
    if (t.dataset.med) return go(function () { openQty(t.dataset.med); });
    if (t.dataset.sib) return go(function () { S.edit.code = t.dataset.sib; lastKey = 'x'; });
    if (t.dataset.days || t.dataset.set) {
      var m = med(S.edit.code), dz = dosing(m);
      if (t.dataset.set) S.edit.qty = +t.dataset.set;
      else { S.edit.days = +t.dataset.days; S.edit.qty = dz.kind === 'prn' ? S.edit.days : dz.per * S.edit.days; }
      $('.calc').innerHTML = calcHtml(m, dz); $('#qty').value = S.edit.qty; renderQtyLive(); return;
    }
    if (id === 'qty-minus' || id === 'qty-plus') { S.edit.qty = Math.max(0, (S.edit.qty || 0) + (id === 'qty-plus' ? 1 : -1)); S.edit.days = null; $('#qty').value = S.edit.qty; $('.calc').innerHTML = calcHtml(med(S.edit.code), dosing(med(S.edit.code))); renderQtyLive(); return; }
    if (t.dataset.rm != null) return go(function () { S.items.splice(+t.dataset.rm, 1); if (!S.items.length && S.step === 4) { S.step = 2; S.sub = 'search'; } else if (!S.items.length) S.sub = 'search'; lastKey = 'x'; });
    if (t.dataset.edit != null) return go(function () { openQty(S.items[+t.dataset.edit].code, +t.dataset.edit); });
    if (id === 'med-clear') { S.query = ''; $('#med-search').value = ''; $('#med-search-box').classList.add('nx'); renderMedList(); $('#med-search').focus(); return; }
    if (id === 'more-yes') return go(function () { S.sub = 'search'; S.query = ''; S.filter = 'top'; });
    if (id === 'more-no') return go(function () { S.step = 4; });
    if (id === 'undo') { undo(); return; }
    if (id === 'go-test') return go(function () { setClinic('test'); });
    if (id === 'back') return go(function () {
      if (S.step === 2 && S.sub === 'search' && S.items.length) S.sub = 'more';
      else if (S.step === 2) S.step = 1;
      else if (S.step === 3) { S.step = 2; S.sub = S.items.length ? 'more' : 'search'; }
      else if (S.step === 4) { S.step = 2; S.sub = 'more'; }
    }, true);
    if (id === 'next') return go(function () {
      if (S.screen === 'done') { resetFlow(); S.screen = 'flow'; return; }
      if (S.step === 1) { S.step = 2; S.sub = 'search'; }
      else if (S.step === 2) S.step = 4;
      else if (S.step === 3) {
        if (S.edit.idx != null) { S.items[S.edit.idx] = { code: S.edit.code, qty: S.edit.qty }; S.step = 4; }
        else {
          var ex = S.items.filter(function (x) { return x.code === S.edit.code; })[0];
          if (ex) ex.qty += S.edit.qty; else S.items.push({ code: S.edit.code, qty: S.edit.qty });
          S.step = 2; S.sub = 'more';
        }
        S.edit = null;
      } else if (S.step === 4) { t.disabled = true; send(); }
    });
    if (id === 'notice-close') { S.notice = null; var n = $('#prod-note'); n && n.remove(); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'med-search') { S.query = t.value; $('#med-search-box').classList.toggle('nx', !S.query); renderMedList(); }
    if (t.id === 'pt-search') { S.pq = t.value; renderPatients(); }
    if (t.id === 'stock-search') { S.stockQ = t.value; renderStockRows(); }
    if (t.id === 'qty') { var v = parseFloat(nf(t.value)); S.edit.qty = isNaN(v) ? 0 : v; S.edit.days = null; $('.calc').innerHTML = calcHtml(med(S.edit.code), dosing(med(S.edit.code))); renderQtyLive(); }
  });
  window.addEventListener('resize', function () { $('#tip').hidden = true; });

  // 本番の院に切り替えた直後の案内・書き込めない院で送ろうとしたとき・送信の失敗（画面内に出す）
  var _vFlow = vFlow;
  vFlow = function () {
    var h = _vFlow();
    if (S.notice && S.step === 1) {
      var c = clinicInfo(S.notice);
      h = h.replace('<section class="col">', '<section class="col"><div class="note prod" id="prod-note"><span class="ico">本</span><div style="flex:1"><b>' + esc(c.short) + 'は見本データです。</b>' + esc(SB.readOnlyMessage(S.notice)) + '上の帯が斜線ではなく、' + esc(c.short) + 'の色になっています。</div><button class="linkbtn" id="notice-close">わかりました</button></div>');
    }
    if (S.step === 4 && S.roMsg) {
      h = h.replace('<section class="col">', '<section class="col"><div class="note warn" id="ro-note"><span class="ico">!</span><div style="flex:1"><b>送れません（何も記録していません）。</b>' + esc(SB.readOnlyMessage(S.clinic) || '書き込みはできません。') +
        (S.clinic !== 'test' && SB.live ? '<div style="margin-top:8px"><button class="linkbtn" id="go-test">テスト用の院へ切り替える</button></div>' : '') + '</div></div>');
    }
    if (S.step === 4 && S.err) {
      h = h.replace('<section class="col">', '<section class="col"><div class="note bad" id="sb-err"><span class="ico">!</span><div>' + esc(S.err) + '</div></div>');
    }
    return h;
  };

  // テスト用の院：在庫・今日の記録を開くたびにDBを読み直す（ほかの端末の操作も反映）
  function reload(scr) {
    if (S.clinic !== 'test' || !SB.live || busy) return;
    SB.refresh('test').then(function () { if (S.screen === scr && !busy) render(); }).catch(function () {});
  }
  // 初期化ボタン（2段階。テスト用の院を DB ごと最初の状態へ）
  function resetBtnHtml(st) {
    var armed = resetArm != null;
    return '<button class="linkbtn' + (armed ? ' armed' : '') + '" id="reset"' + (st ? ' style="' + st + '"' : '') + (!SB.live || busy ? ' disabled' : '') + '>' +
      (!SB.live ? '初期化はDBに接続中のときだけ' : busy && armed ? '初期化中…' : armed ? 'もう一度押すと初期化します' : 'テスト用の院を初期化') + '</button>';
  }
  function resetMsgHtml() { return resetMsg ? '<p class="reset-msg' + (resetMsg.err ? ' err' : '') + '" id="reset-msg">' + esc(resetMsg.t) + '</p>' : ''; }
  async function resetTest() {
    if (!SB.live || busy) return;
    if (resetArm == null) {
      resetArm = 1; resetMsg = null; render();
      clearTimeout(resetTimer); resetTimer = setTimeout(function () { resetArm = null; render(); }, 6000);
      return;
    }
    clearTimeout(resetTimer); busy = true; render();
    try {
      await SB.resetTest();
      LOG.test = []; resetMsg = { t: 'テスト用の院の在庫と記録を最初の状態に戻しました' };
    } catch (e) { resetMsg = { t: '初期化できませんでした: ' + e.message, err: true }; }
    busy = false; resetArm = null; render();
  }

  // DBの読み込みを待ってから最初の描画（待つ間は「接続中…」）
  $('#stage').innerHTML = '<div class="cl-wrap"><p class="lead">接続中…（テスト用の院のデータを本番DBから読み込んでいます）</p></div>';
  SB.ready.then(function () {
    lastKey = S.screen + '/' + S.step + '/' + S.sub;
    render();
  });
  window.__demoB = { S: S, db: db };
})();
