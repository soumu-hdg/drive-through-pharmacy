/* 案C 補充台帳（事務・総務向け）
   テスト用の院だけ本番DBにつなぐ（sb.js）。発注書・入荷・棚卸・品目の追加・院間コピー（西春→テスト用）を DB へ書く。
   西春・中川は demo_data.js の見本データで表示し、書き込みはしない（localStorage にも保存しない）。
   localStorage に残すのは、担当者名・前回の接続先だけ。 */
(function () {
  'use strict';
  var D = window.DEMO_DATA, KS = window.KanaSearch, SB = window.SB;
  var KEY = 'pv09C_';
  var TODAY = '2026-09-30';
  var SRC = 'demo:C';
  var CL = {}; D.clinics.forEach(function (c) { CL[c.id] = c; });

  /* ---------- 出庫ペース（西春＝見本の実績／テスト用＝DBの出庫記録） ---------- */
  function buildPace(rows) {
    var s = {}; (rows || []).forEach(function (r) { s[r.d] = 1; });
    var days = Object.keys(s).sort().slice(-14), P = {};
    (rows || []).forEach(function (r) {
      var i = days.indexOf(r.d); if (i < 0) return;
      var p = P[r.c] || (P[r.c] = { sum: 0, series: days.map(function () { return 0; }) });
      p.sum += r.q; p.series[i] += r.q;
    });
    Object.keys(P).forEach(function (c) { P[c].avg = P[c].sum / days.length; });
    var last = days[days.length - 1];
    return { days: days, P: P, LAST: last, lastOut: (rows || []).filter(function (r) { return r.d === last; }) };
  }
  var PN = buildPace(D.daily_out_nishiharu), PT = null;
  function PC() { if (isDB(cid)) return PT || (PT = buildPace(D.daily_out_test)); return PN; }

  /* ---------- 状態 ---------- */
  var cid = null, S = null, view = 'due', ui = {}, MEM = {}, BUSY = false;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function isDB(id) { return !!(SB && SB.isLive(id)); }
  function fresh(id) {
    var s = { orders: [], cart: [], lots: [], log: [], flow: { due: 0, order: 0, recv: 0, count: 0, add: 0, copy: 0 }, seq: 0 };
    // テスト用（DB接続中）は品目＝DBの値そのもの（SB が書き換える DEMO_DATA.medicines.test を常に参照）
    if (isDB(id)) Object.defineProperty(s, 'meds', { get: function () { return D.medicines.test || []; }, enumerable: false });
    else s.meds = JSON.parse(JSON.stringify(D.medicines[id]));
    return s;
  }
  function load(id) { return MEM[id] || (MEM[id] = fresh(id)); }
  function save() { /* 在庫・記録は端末に保存しない（テスト用は DB が正、西春・中川は見本のまま） */ }
  function op() { return ls(KEY + 'op') || D.operators[D.operators.length - 1]; }
  // 以前の版が端末に残した院ごとの在庫・記録は使わない（消す）
  D.clinics.forEach(function (c) { ls(KEY + 'st_' + c.id, null); });

  /* ---------- 書き込み（テスト用だけ）・画面内のお知らせ ---------- */
  function place(el, anchor) {
    $$('#main .msgbox, #sheet .msgbox').forEach(function (x) { x.remove(); });
    var host = anchor && anchor.closest && (anchor.closest('.acts') || anchor.closest('table') || anchor.closest('.bar, .foot') || anchor.closest('.form'));
    if (host && host.classList && host.classList.contains('form')) { host.appendChild(el); return; }
    if (host && host.parentNode) { host.parentNode.insertBefore(el, host.nextSibling); return; }
    var mn = $('#main'); mn.insertBefore(el, mn.children[1] || null);
  }
  function msg(html, cls, anchor) {
    var e = document.createElement('div'); e.className = 'msgbox ' + (cls || 'okbox'); e.style.margin = '10px 18px'; e.innerHTML = html;
    place(e, anchor); return e;
  }
  function guard(anchor) {
    if (SB && SB.canWrite(cid)) return true;
    var t = SB ? SB.readOnlyMessage(cid) : 'DBに接続する部品が読み込めていません。';
    if (cid === 'test' && SB && SB.error) t += '（理由：' + SB.error + '）';
    var e = msg('<b>書き込みはしません</b>　' + esc(t) + (cid !== 'test' ? '　<button class="btn sm totest">テスト用の院へ切り替える</button>' : ''), 'warn', anchor);
    var b = e.querySelector('.totest'); if (b) b.onclick = function () { $('#sheet').hidden = true; enter('test'); };
    return false;
  }
  async function run(btn, fn) {
    if (BUSY) return; BUSY = true;
    var t = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
    try { await fn(); }
    catch (e) { msg('<b>保存できませんでした</b>　' + esc(e && e.message || e) + '　在庫の数字は変えていません。', 'warn', btn && document.body.contains(btn) ? btn : null); }
    finally { BUSY = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = t; } }
  }
  function orders() {
    if (!isDB(cid)) return S.orders;
    return SB.docs('test', 'order').filter(function (d) { return d.body && Array.isArray(d.body.lines) && d.body.supplier; })
      .map(function (d) { return { id: d.id, no: d.doc_no, supplier: d.body.supplier, date: d.body.date || String(d.created_at).slice(0, 10), lines: d.body.lines, status: d.status, body: d.body }; })
      .sort(function (a, b) { return a.id - b.id; });
  }
  function expOn(s) {
    s = String(s || '').trim(); var m = s.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?$/); if (!m) return null;
    var y = +m[1], mo = +m[2], d = m[3] ? +m[3] : new Date(y, mo, 0).getDate();
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  /* ---------- 小物 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f(n) { if (n == null || isNaN(n)) return '—'; n = Math.round(n * 10) / 10; return (n % 1 ? n.toFixed(1) : String(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function yen(n) { return n == null || isNaN(n) ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function nm(m) { return m.name.replace(/　/g, ' '); }
  function tgt(m) { return (m.category || '').split('/')[0]; }
  function eff(m) { return (m.category || '').split('/').slice(1).join('/'); }
  function byCode(c) { for (var i = 0; i < S.meds.length; i++) if (S.meds[i].code === c) return S.meds[i]; return null; }
  function pace(m) { return cid === 'nakagawa' ? null : PC().P[m.code] || null; }
  function hhmm() { var h = 9 + Math.floor(S.seq / 6), mi = (S.seq * 7) % 60; S.seq++; return ('0' + Math.min(h, 17)).slice(-2) + ':' + ('0' + mi).slice(-2); }
  function log(msg) { S.log.unshift({ t: hhmm(), msg: msg + '（' + op() + '）' }); if (S.log.length > 40) S.log.length = 40; }
  var tt; function toast(m) { var t = $('#toast'); t.textContent = m; t.className = 'toast show'; clearTimeout(tt); tt = setTimeout(function () { t.className = 'toast'; }, 2600); }
  function mk(s) { var a = String(s || '').split(/\s*\/\s*/).filter(Boolean); return a.length > 2 ? a.slice(0, 2).join(' / ') + ' ほか' + (a.length - 2) + '社' : a.join(' / '); }
  function looseName(s) { return KS.norm(s).replace(/ー/g, ''); }

  function onOrder(code) {
    var q = 0; orders().forEach(function (o) { o.lines.forEach(function (l) { if (l.code === code) q += Math.max(0, l.qty - (l.got || 0)); }); }); return q;
  }
  function inCart(code) { return S.cart.some(function (l) { return l.code === code; }); }
  function status(m) {
    if (m.stock_untracked) return null;
    var p = pace(m), st = m.current_stock, r = { neg: st < 0, low: st < (m.threshold || 0), soon: false, days: null };
    if (p && p.avg > 0) { r.days = Math.max(0, st) / p.avg; r.soon = r.days <= 7; }
    r.due = r.neg || r.low || r.soon; return r;
  }
  function propose(m) {
    var p = pace(m), avg = p ? p.avg : 0, pack = m.pack_size || 1;
    var target = Math.max(m.threshold || 0, Math.ceil(avg * 14));
    var need = target - Math.max(m.current_stock, 0) - onOrder(m.code);
    var packs = Math.max(1, Math.ceil(need / pack)); return { packs: packs, qty: packs * pack };
  }
  function dueList() {
    return S.meds.map(function (m) { return { m: m, s: status(m) }; }).filter(function (x) { return x.s && x.s.due; })
      .sort(function (a, b) { return (b.s.neg - a.s.neg) || ((a.s.days == null ? 999 : a.s.days) - (b.s.days == null ? 999 : b.s.days)) || (a.m.current_stock / (a.m.threshold || 1) - b.m.current_stock / (b.m.threshold || 1)); });
  }
  function bars(p) {
    if (!p) return '<span class="rd">実績なし</span>';
    var mx = Math.max.apply(null, p.series.concat([1]));
    return '<span class="bars" title="直近14日の出庫">' + p.series.map(function (v) { return v ? '<i style="height:' + Math.max(2, Math.round(v / mx * 18)) + 'px"></i>' : '<i class="z"></i>'; }).join('') + '</span>';
  }
  function stockCell(m) { return m.stock_untracked ? '<span class="tag ext">外用</span>' : '<span class="' + (m.current_stock < 0 ? 'neg' : '') + '">' + f(m.current_stock) + '</span>'; }

  /* ---------- 院の選択 ---------- */
  function showPick() {
    $('#app').hidden = true; $('#pick').hidden = false; document.body.className = '';
    var last = ls(KEY + 'clinic');
    $('#pickGrid').innerHTML = D.clinics.map(function (c) {
      var st = load(c.id), n = st.meds.length, neg = st.meds.filter(function (m) { return !m.stock_untracked && m.current_stock < 0; }).length;
      var zero = st.meds.filter(function (m) { return !m.stock_untracked && m.current_stock === 0; }).length;
      var src = isDB(c.id) ? '<span class="dbtag live">本番DBに接続中・書き込みできます</span>' : '<span class="dbtag">見本データ・書き込みしません</span>';
      return '<button class="pick-c ' + c.id + '" id="clinic-' + c.id + '" data-id="' + c.id + '" style="--c:' + c.color + '">' +
        '<div class="sw"></div><b>' + esc(c.short) + '</b><span>' + esc(c.name) + '</span><span>' + esc(c.note || '日中外来・在宅・夜間休日ドライブスルー') + '</span>' + src +
        (last === c.id ? '<em class="last">前回の接続先</em>' : '') +
        '<div class="meta"><div><small>品目</small><b>' + n + '</b></div><div><small>在庫マイナス</small><b class="' + (neg ? 'neg' : '') + '">' + neg + '</b></div><div><small>在庫0</small><b>' + zero + '</b></div></div><div class="go">' + esc(c.short) + ' に接続する</div></button>';
    }).join('');
    $('#pickFoot').textContent = connLine();
  }
  function connLine() {
    if (!SB) return 'DBに接続する部品が読み込めていません。3院とも見本データで表示しています（書き込みはできません）。';
    return SB.live ? 'テスト用の院は本番DBに接続中。操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データで表示し、書き込みはしません。'
      : 'DBに接続できないため、テスト用も見本データで表示しています（書き込みはできません）。理由：' + (SB.error || '不明');
  }
  function enter(id) {
    cid = id; ls(KEY + 'clinic', id); S = load(id); ui = {}; PT = null;
    var c = CL[id];
    document.body.className = id; document.documentElement.style.setProperty('--cl', c.color);
    $('#clName').textContent = c.short + '　' + c.name;
    var pr = $('#practice'); pr.hidden = false;
    pr.className = 'practice' + (isDB(id) ? ' live' : ' ro');
    pr.innerHTML = isDB(id) ? '<b>テスト用の院は本番DBに接続中。</b>操作すると実際に値が動きます（西春・中川には影響しません）。'
      : esc(SB ? SB.readOnlyMessage(id) : '') + (id === 'test' && SB && SB.error ? '（理由：' + esc(SB.error) + '）' : '') + (id !== 'test' ? '　<button class="link" id="prToTest">テスト用の院へ切り替える</button>' : '');
    var pt = $('#prToTest'); if (pt) pt.onclick = function () { enter('test'); };
    $('#pick').hidden = true; $('#app').hidden = false;
    go('due');
  }

  /* ---------- 画面切替 ---------- */
  function go(v) { view = v; if (v === 'due') { S.flow.due = 1; save(); } render(); $('#main').scrollTop = 0; }
  function render() {
    PT = null;
    $$('#steps button').forEach(function (b) { b.classList.toggle('on', b.dataset.step === view); });
    counts();
    ({ due: vDue, order: vOrder, recv: vRecv, count: vCount, add: vAdd, copy: vCopy })[view]();
    side();
  }
  function counts() {
    var dl = dueList(), neg = S.meds.filter(function (m) { return !m.stock_untracked && m.current_stock < 0; }).length;
    var cDue = $('#cDue'); cDue.textContent = dl.length; cDue.className = neg ? 'alert' : '';
    $('#cCart').textContent = S.cart.length;
    var open = 0; orders().forEach(function (o) { o.lines.forEach(function (l) { if ((l.got || 0) < l.qty) open++; }); });
    $('#cRecv').textContent = open;
    var cn = $('#cNeg'); cn.textContent = neg; cn.className = neg ? 'alert' : '';
    $('#cItems').textContent = S.meds.length;
  }
  function side() {
    var dl = dueList(), neg = dl.filter(function (x) { return x.s.neg; }).length, low = dl.filter(function (x) { return x.s.low; }).length;
    var fl = [
      ['要対応を確認', S.flow.due, 'マイナス' + neg + '・割れ' + low],
      ['発注書を作る', S.flow.order, S.flow.order + '通'],
      ['届いた分を入荷', S.flow.recv, S.flow.recv + '品目'],
      ['棚卸で実数に直す', S.flow.count, S.flow.count + '品目'],
      ['新しい薬を追加', S.flow.add, S.flow.add + '件']
    ];
    $('#flow').innerHTML = fl.map(function (x, i) { return '<li class="' + (x[1] ? 'done' : '') + '"><span class="ck">' + (x[1] ? '✓' : i + 1) + '</span><span>' + x[0] + '</span><span class="v">' + x[2] + '</span></li>'; }).join('');
    if (isDB(cid)) { dbLog(); return; }
    $('#log').innerHTML = (S.log.length ? S.log.slice(0, 14).map(function (l) { return '<li><time>' + l.t + '</time>' + esc(l.msg) + '</li>'; }).join('') : '<li class="none">まだ記録はありません</li>') +
      '<li class="none">見本データのため、在庫の記録は残りません。</li>';
  }
  /* テスト用：DB の記録（在庫の動き＋発注書）。この画面で入れた動きは「取り消す」で戻せる */
  var KIND = { 'in': '入荷', out: '出庫', karte_out: 'カルテ出庫', adjust: '調整', count: '棚卸', 'void': '取り消し', register: '品目登録' };
  function hm(ts) { var d = new Date(ts); return isNaN(d) ? '' : ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function dbLog() {
    var names = {}; (D.medicines.test || []).forEach(function (m) { names[m.code] = nm(m).split(' ')[0]; });
    var ev = SB.moves('test').filter(function (m) { return m.source !== 'seed'; }).slice(0, 40).map(function (m) {
      var q = Number(m.qty) || 0, ba = m.stock_before != null ? '（' + f(m.stock_before) + '→' + f(m.stock_after) + '）' : '';
      var mine = String(m.source || '') === SRC && m.kind !== 'void' && m.kind !== 'register';
      return { t: m.created_at, h: esc((KIND[m.kind] || m.kind) + ' ' + (names[m.medicine_code] || m.medicine_code) + ' ' + (q > 0 ? '+' : '') + f(q) + ba + (m.ref ? ' ' + m.ref : '') + '（' + (m.operator || '—') + '）') +
        (m.voided_at ? ' <span class="tag">取り消し済</span>' : mine ? ' <button class="link undo" data-id="' + m.id + '">取り消す</button>' : '') };
    });
    SB.docs('test', 'order').forEach(function (d) {
      if (!d.body || !Array.isArray(d.body.lines)) return;
      ev.push({ t: d.updated_at || d.created_at, h: esc('発注書 ' + d.doc_no + '（' + (d.body.supplier || '') + '・' + d.body.lines.length + '品目）' + (d.status === 'received' ? '入荷済' : '発注済') + '（' + (d.operator || '—') + '）') });
    });
    ev.sort(function (a, b) { return a.t < b.t ? 1 : -1; });
    $('#log').innerHTML = '<li class="none">テスト用の院のDBの記録（全員分・新しい順）</li>' +
      (ev.length ? ev.slice(0, 16).map(function (e) { return '<li><time>' + hm(e.t) + '</time>' + e.h + '</li>'; }).join('') : '<li class="none">まだ記録はありません</li>');
    $$('#log .undo').forEach(function (b) {
      b.onclick = function () {
        var id = +b.dataset.id;
        run(b, async function () {
          var r = await SB.voidTx('test', [id], op());
          await SB.refresh('test'); render();
          toast('取り消しました：' + r.map(function (x) { return x.code + ' ' + f(x.before) + '→' + f(x.after); }).join('、'));
        });
      };
    });
  }

  /* ========== 1. 要対応 ========== */
  function vDue() {
    var all = dueList(), fl = ui.dueF || 'all', q = ui.dueQ || '';
    var nNeg = all.filter(function (x) { return x.s.neg; }).length, nLow = all.filter(function (x) { return x.s.low; }).length, nSoon = all.filter(function (x) { return x.s.soon; }).length;
    var list = all.filter(function (x) { return fl === 'all' || x.s[fl]; });
    if (q) { var ms = KS.filter(list.map(function (x) { return x.m; }), q, function (m) { return [m.name, m.furigana, m.code, m.category]; }); list = list.filter(function (x) { return ms.indexOf(x.m) >= 0; }); }
    if (!ui.dueSel) { ui.dueSel = {}; all.forEach(function (x) { if (!x.s.neg && !onOrder(x.m.code) && !inCart(x.m.code)) ui.dueSel[x.m.code] = 1; }); }
    var pc = PC(), lastN = pc.lastOut.reduce(function (a, r) { return a + r.n; }, 0);
    var note = cid === 'nakagawa' ? '開院前のため出庫の実績はありません。発注点を下回る品目を表示しています。'
      : !pc.LAST ? '出庫の記録がありません。発注点を下回る品目を表示しています。'
      : (isDB(cid) ? 'テスト用の院のDBの出庫記録で計算。' : '西春の見本データ。') + '最終集計 ' + pc.LAST.slice(5).replace('-', '/') + '：出庫 ' + lastN + '件・' + pc.lastOut.length + '品目。もつ日数＝在庫 ÷ 直近14日の1日平均。マイナスの品目は入荷か棚卸の記録漏れのため、発注の前に棚卸で実数を確かめます（チェックは外してあります）。';
    var sel = Object.keys(ui.dueSel).filter(function (k) { return ui.dueSel[k]; }).length;
    var h = '<div class="bar"><h2>朝の要対応</h2>' +
      '<div class="seg" id="dueF">' + [['all', 'すべて', all.length], ['neg', 'マイナス', nNeg], ['low', '発注点割れ', nLow], ['soon', '7日以内に切れる', nSoon]].map(function (s) { return '<button data-f="' + s[0] + '" class="' + (fl === s[0] ? 'on' : '') + '">' + s[1] + '<b>' + s[2] + '</b></button>'; }).join('') + '</div>' +
      '<input class="q" id="dueQ" placeholder="薬品名・コード（ローマ字可）" value="' + esc(q) + '">' +
      '<span class="grow"></span><button class="btn pri" id="toCart">チェックした ' + sel + ' 品目を発注リストへ</button>' +
      '<div class="note" style="flex-basis:100%">' + note + '</div></div>';
    h += '<table><thead><tr><th class="cb"><input type="checkbox" id="dueAll"></th><th>コード</th><th>薬品名</th><th>状態</th><th class="n">在庫</th><th class="n">発注点</th><th>直近14日</th><th class="n">1日平均</th><th class="n">もつ日数</th><th>仕入先</th><th class="n">入数</th><th class="n">提案</th><th></th></tr></thead><tbody>';
    list.forEach(function (x) {
      var m = x.m, s = x.s, p = pace(m), pr = propose(m), oo = onOrder(m.code), ic = inCart(m.code);
      var tags = (s.neg ? '<span class="tag neg">マイナス</span>' : '') + (s.low && !s.neg ? '<span class="tag low">発注点割れ</span>' : '') + (s.soon && !s.neg ? '<span class="tag soon">7日以内</span>' : '') + (oo ? '<span class="tag ord">発注済 ' + f(oo) + '</span>' : '') + (ic ? '<span class="tag ord">リスト済</span>' : '');
      h += '<tr data-code="' + m.code + '"><td class="cb"><input type="checkbox" class="dsel" data-code="' + m.code + '"' + (ui.dueSel[m.code] ? ' checked' : '') + '></td>' +
        '<td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '<small>' + esc(m.category) + '</small></td><td>' + tags + '</td>' +
        '<td class="n">' + stockCell(m) + '</td><td class="n">' + f(m.threshold) + '</td><td>' + bars(p) + '</td><td class="n">' + (p ? f(p.avg) : '—') + '</td>' +
        '<td class="n"><span class="days' + (s.days != null && s.days <= 3 ? ' neg' : '') + '">' + (s.neg ? '<span class="neg">不明</span>' : s.days == null ? '—' : f(s.days) + '日') + '</span></td>' +
        '<td>' + esc(m.supplier_name || '未設定') + '</td><td class="n">' + f(m.pack_size) + '</td><td class="n">' + pr.packs + '箱</td>' +
        '<td>' + (s.neg ? '<button class="link gocount" data-code="' + m.code + '">棚卸で直す</button>' : '') + '</td></tr>';
    });
    if (!list.length) h += '<tr><td colspan="13" class="empty">該当する品目はありません</td></tr>';
    h += '</tbody></table>';
    $('#main').innerHTML = h;
    $$('#dueF button').forEach(function (b) { b.onclick = function () { ui.dueF = b.dataset.f; vDue(); }; });
    var qi = $('#dueQ'); qi.oninput = function () { ui.dueQ = qi.value; vDue(); var n = $('#dueQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $$('.dsel').forEach(function (c) { c.onchange = function () { ui.dueSel[c.dataset.code] = c.checked ? 1 : 0; vDueBtn(); }; });
    $('#dueAll').onchange = function (e) { list.forEach(function (x) { ui.dueSel[x.m.code] = e.target.checked ? 1 : 0; }); vDue(); };
    $('#toCart').onclick = toCart;
    $$('.gocount').forEach(function (b) { b.onclick = function () { ui.cntF = 'neg'; ui.cntRows = null; go('count'); }; });
  }
  function vDueBtn() { var n = Object.keys(ui.dueSel).filter(function (k) { return ui.dueSel[k]; }).length; $('#toCart').textContent = 'チェックした ' + n + ' 品目を発注リストへ'; }
  function toCart() {
    var n = 0;
    Object.keys(ui.dueSel).forEach(function (c) {
      if (!ui.dueSel[c] || inCart(c)) return; var m = byCode(c); if (!m) return;
      S.cart.push({ code: c, packs: propose(m).packs, supplier: m.supplier_name || '' }); n++;
    });
    ui.dueSel = null;
    if (!n) { toast('追加する品目がありません'); return; }
    log('発注リストに ' + n + ' 品目を追加'); save(); toast(n + ' 品目を発注リストへ入れました'); go('order');
  }

  /* ========== 2. 発注リスト ========== */
  function vOrder() {
    var groups = {}; S.cart.forEach(function (l) { var k = l.supplier || ''; (groups[k] = groups[k] || []).push(l); });
    var keys = Object.keys(groups).sort(function (a, b) { return (a === '') - (b === '') || a.localeCompare(b, 'ja'); });
    var h = '<div class="bar"><h2>発注リスト</h2><span class="note">仕入先ごとにまとめています。数量は箱（入数）単位。箱数の欄は Enter で次の行へ進みます。</span><span class="grow"></span><button class="btn sm" id="backDue">要対応に戻る</button></div>';
    if (!S.cart.length) h += '<div class="empty">発注リストは空です。「1 要対応」でチェックして入れてください。</div>';
    keys.forEach(function (k) {
      var ls_ = groups[k], tot = 0;
      h += '<section class="grp"><div class="grp-h"><b>' + (k ? esc(k) : '仕入先が未設定') + '</b><span class="rd">' + ls_.length + '品目</span><span class="sum" data-sum="' + esc(k) + '"></span></div>';
      h += '<table><thead><tr><th>コード</th><th>薬品名</th><th class="n">在庫</th><th class="n">発注点</th><th class="n">入数</th><th class="n">箱数</th><th class="n">数量</th><th class="n">単価/箱</th><th class="n">金額</th><th>仕入先</th><th></th></tr></thead><tbody>';
      ls_.forEach(function (l) {
        var m = byCode(l.code), qty = l.packs * (m.pack_size || 1), amt = m.cost_per_pack ? l.packs * m.cost_per_pack : null; tot += amt || 0;
        h += '<tr><td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '</td><td class="n">' + stockCell(m) + '</td><td class="n">' + f(m.threshold) + '</td><td class="n">' + f(m.pack_size) + ' ' + esc(m.unit) + '</td>' +
          '<td class="n"><input class="in pk" data-col="pk" data-code="' + m.code + '" type="number" min="0" value="' + l.packs + '" id="pk-' + m.code + '"></td>' +
          '<td class="n" id="qt-' + m.code + '">' + f(qty) + ' ' + esc(m.unit) + '</td><td class="n">' + yen(m.cost_per_pack) + '</td><td class="n" id="am-' + m.code + '">' + yen(amt) + '</td>' +
          '<td><select class="sup" data-code="' + m.code + '"><option value="">未設定</option>' + D.suppliers.map(function (s) { return '<option' + (s === l.supplier ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></td>' +
          '<td><button class="link rm" data-code="' + m.code + '">外す</button></td></tr>';
      });
      h += '</tbody></table><div class="foot"><span class="rd">' + (k ? '単価はマスタの仕入値（箱あたり）。未登録は金額に含めません。' : '各行で仕入先を選ぶと、その仕入先の発注書に入ります。') + '</span><span class="grow"></span>' +
        '<button class="btn pri mkpo" data-sup="' + esc(k) + '" id="po-' + (D.suppliers.indexOf(k)) + '"' + (k ? '' : ' disabled') + '>' + (k ? esc(k) + ' の発注書を作る' : '発注書は作れません') + '</button></div></section>';
      groups[k].tot = tot;
    });
    $('#main').innerHTML = h;
    keys.forEach(function (k) { var e = $('[data-sum="' + (window.CSS && CSS.escape ? CSS.escape(k) : k) + '"]'); if (e) e.textContent = '合計 ' + yen(groups[k].tot); });
    $('#backDue').onclick = function () { go('due'); };
    $$('.pk').forEach(function (i) {
      i.oninput = function () {
        var l = S.cart.filter(function (x) { return x.code === i.dataset.code; })[0], m = byCode(l.code);
        l.packs = Math.max(0, parseInt(i.value, 10) || 0); save();
        $('#qt-' + m.code).textContent = f(l.packs * (m.pack_size || 1)) + ' ' + m.unit;
        $('#am-' + m.code).textContent = yen(m.cost_per_pack ? l.packs * m.cost_per_pack : null);
        var tot = 0, sup = l.supplier; S.cart.forEach(function (x) { if (x.supplier === sup) { var mm = byCode(x.code); tot += mm.cost_per_pack ? x.packs * mm.cost_per_pack : 0; } });
        var e = $('[data-sum="' + sup + '"]'); if (e) e.textContent = '合計 ' + yen(tot);
      };
    });
    $$('.sup').forEach(function (s) { s.onchange = function () { var l = S.cart.filter(function (x) { return x.code === s.dataset.code; })[0]; l.supplier = s.value; vOrder(); }; });
    $$('.rm').forEach(function (b) { b.onclick = function () { S.cart = S.cart.filter(function (x) { return x.code !== b.dataset.code; }); save(); render(); }; });
    $$('.mkpo').forEach(function (b) { b.onclick = function () { poSheet(b.dataset.sup); }; });
  }
  function poSheet(sup) {
    var lines = S.cart.filter(function (l) { return l.supplier === sup && l.packs > 0; });
    if (!lines.length) { toast('箱数が0の品目だけです'); return; }
    var pre = 'PO-' + TODAY.slice(5).replace('-', '') + '-', seq = 0;
    (isDB(cid) ? SB.docs('test', 'order').map(function (d) { return d.doc_no; }) : S.orders.map(function (o) { return o.no; })).forEach(function (n) {
      if (n && String(n).indexOf(pre) === 0) { var k = parseInt(String(n).slice(pre.length), 10); if (k > seq) seq = k; }
    });
    var no = pre + ('0' + (seq + 1)).slice(-2), tot = 0;
    var rows = lines.map(function (l, i) { var m = byCode(l.code), amt = m.cost_per_pack ? l.packs * m.cost_per_pack : null; tot += amt || 0; return '<tr><td class="n">' + (i + 1) + '</td><td>' + esc(nm(m)) + '</td><td class="n">' + l.packs + ' 箱</td><td class="n">' + f(l.packs * (m.pack_size || 1)) + ' ' + esc(m.unit) + '</td><td class="n">' + yen(amt) + '</td></tr>'; }).join('');
    var sh = $('#sheet');
    sh.innerHTML = '<div class="doc"><h1>発注書</h1><div class="rd">下記のとおり発注いたします。</div><div class="meta"><div>' + esc(sup) + '　御中</div><div>発注番号 ' + no + '</div><div>' + esc(CL[cid].name) + '</div><div>発注日 ' + TODAY + '</div><div>担当 ' + esc(op()) + '</div><div>納品希望 2026-10-02</div></div>' +
      '<table><thead><tr><th class="n">No</th><th>品名</th><th class="n">箱数</th><th class="n">数量</th><th class="n">金額（税抜）</th></tr></thead><tbody>' + rows + '</tbody></table><div class="tot">合計 ' + yen(tot) + '</div>' +
      '<div class="acts"><button class="btn" id="poCancel">閉じる</button><button class="btn pri" id="poSave">発注済にする（' + lines.length + '品目）</button></div></div>';
    sh.hidden = false;
    $('#poCancel').onclick = function () { sh.hidden = true; };
    $('#poSave').onclick = function () {
      var btn = this; if (!guard(btn)) return;
      var body = { supplier: sup, date: TODAY, deliver_by: '2026-10-02', total: tot, src: SRC,
        lines: lines.map(function (l) { var m = byCode(l.code); return { code: l.code, name: m.name, unit: m.unit, packs: l.packs, qty: l.packs * (m.pack_size || 1), cost_per_pack: m.cost_per_pack || null, got: 0 }; }) };
      run(btn, async function () {
        await SB.saveDoc('test', null, 'order', no, 'sent', body, op());
        await SB.refresh('test');
        S.cart = S.cart.filter(function (l) { return l.supplier !== sup; });
        S.flow.order++;
        sh.hidden = true; toast('発注書 ' + no + ' を作りました（DBに保存）。入荷待ちに入っています'); render();
      });
    };
  }

  /* ========== 3. 入荷 ========== */
  function vRecv() {
    var open = orders().filter(function (o) { return o.lines.some(function (l) { return (l.got || 0) < l.qty; }); });
    if (!ui.rcv) ui.rcv = {};
    var h = '<div class="bar"><h2>入荷</h2><span class="note">発注書から届いた分にチェックを入れ、数量と期限を確かめて登録します。数量欄は Enter で次の行へ。</span><span class="grow"></span><button class="btn pri" id="doRecv">チェックした分を入荷登録</button></div>';
    if (!open.length) h += '<div class="empty">入荷待ちの発注はありません。下の「簡易入荷」から発注書なしで登録できます。</div>';
    open.forEach(function (o) {
      h += '<section class="grp"><div class="grp-h"><b>' + esc(o.supplier) + '</b><span class="code">' + o.no + '</span><span class="rd">発注日 ' + o.date + '</span><label class="rd" style="margin-left:auto"><input type="checkbox" class="rall" data-no="' + o.no + '"' + (o.lines.every(function (l) { var r = ui.rcv[o.no + '|' + l.code]; return (l.got || 0) >= l.qty || (r && r.on); }) ? ' checked' : '') + '> 全部届いた</label></div>';
      h += '<table><thead><tr><th class="cb">届</th><th>コード</th><th>薬品名</th><th class="n">発注</th><th class="n">入荷済</th><th class="n">今回の数量</th><th>使用期限</th><th class="n">在庫</th></tr></thead><tbody>';
      o.lines.forEach(function (l) {
        if ((l.got || 0) >= l.qty) return; var m = byCode(l.code), k = o.no + '|' + l.code, r = ui.rcv[k] || (ui.rcv[k] = { on: 0, q: l.qty - (l.got || 0), exp: '' });
        h += '<tr data-k="' + k + '" id="r-' + l.code + '"><td class="cb"><input type="checkbox" class="rc" data-k="' + k + '"' + (r.on ? ' checked' : '') + '></td><td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '</td>' +
          '<td class="n">' + l.packs + '箱 / ' + f(l.qty) + '</td><td class="n">' + f(l.got || 0) + '</td>' +
          '<td class="n"><input class="in rq" data-col="rq" data-k="' + k + '" type="number" value="' + r.q + '"> ' + esc(m.unit) + '</td>' +
          '<td><input class="in wide rx" data-col="rx" data-k="' + k + '" placeholder="2028-03" value="' + esc(r.exp) + '"></td>' +
          '<td class="n chg">' + stockCell(m) + (r.on ? ' → <b>' + f(m.current_stock + (+r.q || 0)) + '</b>' : '') + '</td></tr>';
      });
      h += '</tbody></table></section>';
    });
    // 簡易入荷
    var q = ui.qq || '', hits = q ? KS.filter(S.meds, q, function (m) { return [m.name, m.furigana, m.code, m.category]; }).slice(0, 8) : [];
    h += '<section class="grp"><div class="grp-h"><b>簡易入荷（発注書なし）</b><span class="rd">卸の営業さんが直接持ってきた分など</span></div><div class="foot" style="border-top:0">' +
      '<input class="q" id="qq" placeholder="薬品名・コード（ローマ字可）" value="' + esc(q) + '">' + (q && /[a-z]/i.test(q) ? '<span class="rd">読み替え: ' + esc(KS.romaji(q)) + '</span>' : '') + '</div>';
    if (hits.length) {
      h += '<table><tbody>' + hits.map(function (m) { return '<tr><td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '</td><td class="n">在庫 ' + stockCell(m) + '</td><td class="n"><input class="in qqn" data-col="qq" data-code="' + m.code + '" type="number" placeholder="数量"> ' + esc(m.unit) + '</td><td><button class="btn sm qqgo" data-code="' + m.code + '">入荷</button></td></tr>'; }).join('') + '</tbody></table>';
    }
    h += '</section>';
    $('#main').innerHTML = h;
    $$('.rc').forEach(function (c) { c.onchange = function () { ui.rcv[c.dataset.k].on = c.checked ? 1 : 0; vRecv(); }; });
    $$('.rall').forEach(function (c) { c.onchange = function () { Object.keys(ui.rcv).forEach(function (k) { if (k.indexOf(c.dataset.no + '|') === 0) ui.rcv[k].on = c.checked ? 1 : 0; }); vRecv(); }; });
    $$('.rq').forEach(function (i) { i.onchange = function () { ui.rcv[i.dataset.k].q = +i.value || 0; ui.rcv[i.dataset.k].on = 1; var k = i.dataset.k; vRecv(); var n = $('.rq[data-k="' + k + '"]'); if (n) n.focus(); }; });
    $$('.rx').forEach(function (i) { i.oninput = function () { ui.rcv[i.dataset.k].exp = i.value; }; });
    $('#doRecv').onclick = function () { doRecv(this); };
    var qi = $('#qq'); qi.oninput = function () { ui.qq = qi.value; vRecv(); var n = $('#qq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $$('.qqgo').forEach(function (b) {
      b.onclick = function () {
        var i = $('.qqn[data-code="' + b.dataset.code + '"]'), n = +i.value; if (!n) { toast('数量を入れてください'); i.focus(); return; }
        if (!guard(b)) return;
        var m = byCode(b.dataset.code);
        run(b, async function () {
          var res = await SB.apply('test', [{ code: m.code, kind: 'in', delta: n, reason: '簡易入荷（発注書なし）' }], op(), SRC);
          var r = res[0]; S.flow.recv++; ui.qq = '';
          await SB.refresh('test'); render();
          toast(nm(m) + '：在庫 ' + f(r.before) + ' → ' + f(r.after));
          msg('<b>簡易入荷しました（DBに記録）</b>　' + esc(nm(m)) + '　' + f(r.before) + ' → ' + f(r.after));
        });
      };
    });
  }
  function doRecv(btn) {
    var items = [], touched = {}, os = orders();
    os.forEach(function (o) {
      o.lines.forEach(function (l, idx) {
        var r = ui.rcv[o.no + '|' + l.code]; if (!r || !r.on || !(+r.q)) return;
        var it = { code: l.code, kind: 'in', delta: +r.q, ref: o.no, reason: '発注書から入荷' }, ex = expOn(r.exp);
        if (ex) it.expiry_on = ex;
        if (l.cost_per_pack && l.qty && l.packs) it.unit_cost = Math.round(l.cost_per_pack / (l.qty / l.packs) * 100) / 100;
        items.push(it);
        var t = touched[o.no] || (touched[o.no] = { o: o, got: {} }); t.got[idx] = (t.got[idx] || 0) + (+r.q);
      });
    });
    if (!items.length) { toast('チェックされた行がありません'); return; }
    if (!guard(btn)) return;
    run(btn, async function () {
      var res = await SB.apply('test', items, op(), SRC);   // 在庫を DB へ（まとめて1回）
      var changed = res.map(function (r) { var m = byCode(r.code); return (m ? nm(m).split(' ')[0] : r.code) + ' ' + f(r.before) + '→' + f(r.after); });
      var docErr = null;
      for (var k in touched) {   // 発注書の「入荷済」を更新
        var t = touched[k], o = t.o, lines = o.lines.map(function (l, i) { return Object.assign({}, l, { got: (l.got || 0) + (t.got[i] || 0) }); });
        var done = lines.every(function (l) { return (l.got || 0) >= l.qty; });
        try { await SB.saveDoc('test', o.id, 'order', o.no, done ? 'received' : 'sent', Object.assign({}, o.body, { lines: lines }), op()); }
        catch (e) { docErr = e.message; }
      }
      S.flow.recv += items.length; ui.rcv = {};
      await SB.refresh('test'); render();
      toast(items.length + ' 品目を入荷登録しました（' + changed.slice(0, 2).join('、') + (items.length > 2 ? ' ほか' : '') + '）');
      msg('<b>入荷登録しました（DBに記録）</b>　' + changed.map(esc).join('　／　') +
        (docErr ? '<br><b style="color:var(--sig)">在庫は入りましたが、発注書の「入荷済」の更新に失敗しました：</b>' + esc(docErr) : ''), docErr ? 'warn' : 'okbox');
    });
  }

  /* ========== 4. 棚卸 ========== */
  function vCount() {
    var fl = ui.cntF || 'neg', q = ui.cntQ || '';
    if (!ui.cntRows) {
      var src = S.meds.filter(function (m) { return !m.stock_untracked; });
      if (fl === 'neg') src = src.filter(function (m) { return m.current_stock < 0; });
      if (fl === 'low') src = src.filter(function (m) { return m.current_stock < (m.threshold || 0); });
      if (q) src = KS.filter(src, q, function (m) { return [m.name, m.furigana, m.code, m.category]; });
      ui.cntRows = src.map(function (m) { return m.code; }); ui.cnt = ui.cnt || {}; ui.cntDone = {};
    }
    var neg = S.meds.filter(function (m) { return !m.stock_untracked && m.current_stock < 0; }).length;
    var h = '<div class="bar"><h2>棚卸</h2><div class="seg" id="cntF">' + [['neg', 'マイナスの品目だけ', neg], ['low', '発注点割れ', null], ['all', '全品目', null]].map(function (s) { return '<button data-f="' + s[0] + '" class="' + (fl === s[0] ? 'on' : '') + '">' + s[1] + (s[2] != null ? '<b>' + s[2] + '</b>' : '') + '</button>'; }).join('') + '</div>' +
      '<input class="q" id="cntQ" placeholder="絞り込み（ローマ字可）" value="' + esc(q) + '"><span class="note">棚の実数を打つと差が出ます。Enter で次の行。確定すると帳簿が実数に直ります。</span></div>';
    h += '<table><thead><tr><th>コード</th><th>薬品名</th><th>単位</th><th class="n">帳簿の在庫</th><th class="n">実数</th><th class="n">差</th><th>最後の入荷</th><th>結果</th></tr></thead><tbody>';
    var nd = 0;
    ui.cntRows.forEach(function (c) {
      var m = byCode(c); if (!m) return; var v = ui.cnt[c], dn = ui.cntDone[c];
      var diff = v === '' || v == null ? null : (+v - m.current_stock); if (diff !== null && diff !== 0 && !dn) nd++;
      var lot = isDB(cid) ? lastIn(c) : D.lots_nishiharu.filter(function (l) { return l.c === c && cid !== 'nakagawa'; })[0];
      h += '<tr id="c-' + c + '"><td class="code">' + c + '</td><td class="nm">' + esc(nm(m)) + '</td><td>' + esc(m.unit) + '</td><td class="n">' + stockCell(m) + '</td>' +
        '<td class="n">' + (dn ? '' : '<input class="in cn" data-col="cn" data-code="' + c + '" type="number" min="0" value="' + (v == null ? '' : esc(v)) + '" id="cn-' + c + '">') + '</td>' +
        '<td class="n" id="df-' + c + '">' + (diff == null || dn ? '' : (diff > 0 ? '+' : '') + f(diff)) + '</td><td class="rd">' + (lot ? esc(lot.received_on) + '　' + f(lot.qty_received || lot.qty) : '記録なし') + '</td>' +
        '<td>' + (dn ? '<span class="chg"><b>確定</b> ' + esc(dn) + '</span>' : '') + '</td></tr>';
    });
    if (!ui.cntRows.length) h += '<tr><td colspan="8" class="empty">対象の品目はありません</td></tr>';
    h += '</tbody></table><div class="foot"><span class="rd" id="cntSum">差のある品目：' + nd + '</span><span class="grow"></span><button class="btn pri" id="cntGo"' + (nd ? '' : ' disabled') + '>差のある ' + nd + ' 品目を確定する</button></div>';
    $('#main').innerHTML = h;
    $$('#cntF button').forEach(function (b) { b.onclick = function () { ui.cntF = b.dataset.f; ui.cntRows = null; vCount(); }; });
    var qi = $('#cntQ'); qi.oninput = function () { ui.cntQ = qi.value; ui.cntRows = null; vCount(); var n = $('#cntQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $$('.cn').forEach(function (i) {
      i.oninput = function () {
        ui.cnt[i.dataset.code] = i.value; var m = byCode(i.dataset.code), d = i.value === '' ? null : +i.value - m.current_stock;
        $('#df-' + m.code).innerHTML = d == null ? '' : '<span class="' + (d ? 'neg' : '') + '">' + (d > 0 ? '+' : '') + f(d) + '</span>';
        var n = 0; ui.cntRows.forEach(function (c) { var v = ui.cnt[c], mm = byCode(c); if (v !== '' && v != null && !ui.cntDone[c] && +v !== mm.current_stock) n++; });
        $('#cntSum').textContent = '差のある品目：' + n; var g = $('#cntGo'); g.disabled = !n; g.textContent = '差のある ' + n + ' 品目を確定する';
      };
    });
    $('#cntGo').onclick = function () {
      var btn = this, items = [];
      ui.cntRows.forEach(function (c) {
        var v = ui.cnt[c], m = byCode(c); if (v === '' || v == null || ui.cntDone[c] || +v === m.current_stock) return;
        items.push({ code: c, kind: 'count', count: +v, reason: '棚卸', note: '棚の実数に合わせる（補充台帳）' });
      });
      if (!items.length) return;
      if (!guard(btn)) return;
      run(btn, async function () {
        var res = await SB.apply('test', items, op(), SRC);
        res.forEach(function (r) { var d = r.after - r.before; ui.cntDone[r.code] = f(r.before) + ' → ' + f(r.after) + '（差 ' + (d > 0 ? '+' : '') + f(d) + '）'; });
        S.flow.count += res.length;
        await SB.refresh('test');
        toast(res.length + ' 品目の在庫を実数に直しました（DBに記録）'); counts(); vCount(); side();
      });
    };
  }
  function lastIn(code) {
    var m = SB.moves('test').filter(function (x) { return x.medicine_code === code && x.kind === 'in' && !x.voided_at; })[0];
    return m ? { received_on: m.occurred_on, qty: Number(m.qty) } : null;
  }

  /* ========== 5. 品目の追加 ========== */
  function vAdd() {
    var q = ui.aq || '', sel = ui.aSel;
    var hits = q ? KS.filter(D.drug_master_sample, q, function (x) { return [x.name, x.kana, x.rezept_code]; }).slice(0, 40) : [];
    var h = '<div class="bar"><h2>新しい薬の追加</h2><input class="q" id="aq" placeholder="厚労省マスタを検索（ローマ字・かな・コード）" value="' + esc(q) + '">' +
      (q && /[a-z]/i.test(q) ? '<span class="rd">読み替え: ' + esc(KS.romaji(q)) + '</span>' : '') + '<span class="note">医薬品マスタ ' + D.drug_master_sample.length.toLocaleString() + '件（抜粋）から選ぶと、名前・単位・薬価が入ります。</span></div>';
    h += '<div class="split"><div><table><thead><tr><th>レセ電コード</th><th>品名</th><th>単位</th><th class="n">薬価</th><th>剤形</th><th>メーカー</th><th>この院</th></tr></thead><tbody>';
    hits.forEach(function (x, i) {
      var ex = dup(x.name, x.rezept_code);
      h += '<tr class="pickable' + (sel && sel.rezept_code === x.rezept_code && sel.name === x.name ? ' sel' : '') + (ex.length ? ' has' : '') + '" data-i="' + i + '" id="mh-' + i + '"><td class="code">' + x.rezept_code + '</td><td class="nm">' + esc(x.name) + (x.generic_flag === '1' ? ' <span class="tag ext">後発</span>' : '') + '</td><td>' + esc(x.unit) + '</td><td class="n">' + f(x.price) + '</td><td style="white-space:nowrap">' + esc(x.form) + '</td><td class="rd">' + esc(mk(x.makers)) + '</td><td>' + (ex.length ? '<span class="tag">登録済 ' + ex[0].code + '</span>' : '') + '</td></tr>';
    });
    if (!q) h += '<tr><td colspan="7" class="empty">上の欄に薬の名前を入れてください（例：anburokiso、びおふぇるみん）</td></tr>';
    else if (!hits.length) h += '<tr><td colspan="7" class="empty">見つかりません</td></tr>';
    h += '</tbody></table></div><div class="form" id="aform">' + addForm() + '</div></div>';
    $('#main').innerHTML = h;
    var qi = $('#aq'); qi.oninput = function () { ui.aq = qi.value; vAdd(); var n = $('#aq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $$('tr.pickable').forEach(function (tr) { tr.onclick = function () { var x = hits[+tr.dataset.i]; pickMaster(x); }; });
    bindForm();
  }
  function dup(name, rz) {
    var ln = looseName(name);
    return S.meds.filter(function (m) { return looseName(m.name) === ln || looseName(m.name).indexOf(ln) === 0 && ln.length > 6; });
  }
  function pickMaster(x) {
    var form = x.form || '', t = /外用|貼付|吸入|点眼|軟膏|クリーム|坐/.test(form + x.name) ? '外用' : '成人';
    ui.aSel = x; ui.aForm = { name: x.name, unit: x.unit, price: x.price, rz: x.rezept_code, maker: mk(x.makers), t: t, eff: '', pack: 100, sup: D.suppliers[0], init: 0, th: 50, force: 0 };
    vAdd();
  }
  function effs(t) { var s = {}; S.meds.forEach(function (m) { if (tgt(m) === t && eff(m)) s[eff(m)] = 1; }); return Object.keys(s).sort(); }
  function addForm() {
    var a = ui.aForm; if (!a) return '<h3>この院の品目として登録</h3><div class="rd">左の一覧から薬を選んでください。<br>同じ名前の品目がこの院にあるときは、登録の前にお知らせします。</div>';
    var ex = dup(a.name, a.rz);
    var h = '<h3>この院（' + esc(CL[cid].short) + '）の品目として登録</h3>';
    if (ex.length && !a.force) h += '<div class="warn" id="dupWarn"><b>同じ名前の品目がすでにあります</b><br>' + ex.map(function (m) { return m.code + '　' + esc(nm(m)) + '　在庫 ' + (m.stock_untracked ? '外用' : f(m.current_stock) + ' ' + esc(m.unit)); }).join('<br>') + '<div style="margin-top:8px;display:flex;gap:8px"><button class="btn sm" id="dupCnt">既存の品目を棚卸で見る</button><button class="btn sm" id="dupForce">量違いなので別に登録する</button></div></div>';
    var ef = effs(a.t);
    h += '<div class="fr"><label>品名</label><input type="text" id="fName" value="' + esc(a.name) + '"></div>' +
      '<div class="fr"><label>単位 ／ 薬価</label><div class="v num" style="text-align:left">' + esc(a.unit) + '　／　' + f(a.price) + ' 円</div></div>' +
      '<div class="fr"><label>レセ電コード</label><div class="v num" style="text-align:left">' + esc(a.rz) + '</div></div>' +
      '<div class="fr"><label>メーカー</label><div class="v">' + esc(a.maker || '—') + '</div></div>' +
      '<div class="fr"><label>対象</label><div class="chips" id="fT">' + ['成人', '小児', '外用', '検査'].map(function (t) { return '<button data-t="' + t + '" class="' + (a.t === t ? 'on' : '') + '">' + t + '</button>'; }).join('') + '</div></div>' +
      '<div class="fr"><label>薬効</label><select id="fEff"><option value="">選んでください</option>' + ef.map(function (e) { return '<option' + (e === a.eff ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fr"><label>仕入先 ／ 入数</label><div style="display:flex;gap:6px"><select id="fSup">' + D.suppliers.map(function (s) { return '<option' + (s === a.sup ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select><input type="number" id="fPack" value="' + a.pack + '" style="width:90px"></div></div>' +
      '<div class="fr"><label>初期在庫</label><input type="number" id="fInit" value="' + a.init + '"' + (a.t === '外用' ? ' disabled' : '') + '></div>' +
      '<div class="fr"><label>発注点</label><input type="number" id="fTh" value="' + a.th + '"' + (a.t === '外用' ? ' disabled' : '') + '></div>' +
      (a.t === '外用' ? '<div class="rd" style="padding:6px 0">外用薬は在庫を数えません（在庫欄は「外用」と表示）。</div>' : '') +
      '<div style="margin-top:14px;display:flex;gap:10px"><button class="btn pri" id="fAdd"' + (ex.length && !a.force ? ' disabled' : '') + '>この院に追加する</button><button class="btn" id="fClr">やめる</button></div>';
    return h;
  }
  function bindForm() {
    var a = ui.aForm; if (!a) return;
    function rd() { var g = function (id) { return $(id); }; if (g('#fName')) a.name = g('#fName').value; a.eff = g('#fEff').value; a.sup = g('#fSup').value; a.pack = +g('#fPack').value || 1; if (g('#fInit')) a.init = +g('#fInit').value || 0; if (g('#fTh')) a.th = +g('#fTh').value || 0; }
    ['#fName', '#fEff', '#fSup', '#fPack', '#fInit', '#fTh'].forEach(function (s) { var e = $(s); if (e) e.onchange = rd; });
    $$('#fT button').forEach(function (b) { b.onclick = function () { rd(); a.t = b.dataset.t; a.eff = ''; $('#aform').innerHTML = addForm(); bindForm(); }; });
    var dc = $('#dupCnt'); if (dc) dc.onclick = function () { var ex = dup(a.name, a.rz); ui.cntF = 'all'; ui.cntQ = ex[0].code; ui.cntRows = null; go('count'); };
    var df = $('#dupForce'); if (df) df.onclick = function () { rd(); a.force = 1; $('#aform').innerHTML = addForm(); bindForm(); };
    $('#fClr').onclick = function () { ui.aForm = null; ui.aSel = null; vAdd(); };
    $('#fAdd').onclick = function () {
      rd(); if (!a.eff) { toast('薬効を選んでください'); $('#fEff').focus(); return; }
      var btn = this; if (!guard(btn)) return;
      var ext = a.t === '外用', init = ext ? 0 : a.init, th = ext ? 0 : a.th;
      var row = { name: a.name, furigana: KS.norm(a.name), unit: a.unit, category: a.t + '/' + a.eff, price: a.price, pack_size: a.pack,
        threshold: th, current_stock: 0, rezept_code: a.rz, maker: a.maker, form: ui.aSel && ui.aSel.form, supplier_name: a.sup, stock_untracked: ext };
      run(btn, async function () {
        var r = await SB.upsertMedicine('test', row, op(), SRC), code = r.code, ba = '';
        if (init > 0) {   // 初期在庫は入荷として記録（取り消せるように）
          try { var res = await SB.apply('test', [{ code: code, kind: 'in', delta: init, reason: '初期在庫（品目の追加時）' }], op(), SRC); ba = f(res[0].before) + '→' + f(res[0].after); }
          catch (e) { ba = '初期在庫は入りませんでした：' + e.message; }
          await SB.refresh('test');
        }
        S.flow.add++;
        toast(code + ' ' + a.name + ' を' + CL[cid].short + 'に追加しました（DBに登録）'); ui.added = code; ui.aForm = null; ui.aSel = null;
        render();
        var e = msg('<b>' + code + '　' + esc(a.name) + '</b> をDBに登録しました（在庫 ' + (ext ? '外用' : ba ? esc(ba) : '0') + '・発注点 ' + f(th) + '）。　<button class="link" id="goCount">棚卸の一覧で見る</button>');
        e.querySelector('#goCount').onclick = function () { ui.cntF = 'all'; ui.cntQ = code; ui.cntRows = null; go('count'); };
      });
    };
  }

  /* ========== 6. 院間コピー ========== */
  function vCopy() {
    // DB に書けるのは「西春（見本）→ テスト用」だけ。テスト用ではコピー元を西春に限り、在庫は0で登録する
    var db = isDB(cid);
    var others = D.clinics.filter(function (c) { return c.id !== cid && (!db || c.id === 'nishiharu'); });
    var src = ui.cpSrc && ui.cpSrc !== cid && others.some(function (c) { return c.id === ui.cpSrc; }) ? ui.cpSrc : (cid === 'nishiharu' ? 'test' : 'nishiharu');
    var so = load(src), mine = {}; S.meds.forEach(function (m) { mine[looseName(m.name)] = 1; });
    var miss = so.meds.filter(function (m) { return !mine[looseName(m.name)]; });
    var keep = db ? false : (ui.cpKeep != null ? ui.cpKeep : false);
    if (!ui.cpSel || ui.cpSelSrc !== src) { ui.cpSel = {}; miss.forEach(function (m) { ui.cpSel[m.code] = 1; }); ui.cpSelSrc = src; }
    var zero = S.meds.filter(function (m) { return !m.stock_untracked && m.current_stock === 0; }).length;
    var h = '<div class="bar"><h2>院間コピー</h2><span class="note">薬品マスタは院ごとに別です。ほかの院の品目を、この院（' + esc(CL[cid].short) + '）へ写します。</span></div>';
    h += '<table style="width:auto;margin:14px 18px;border:1px solid var(--ink)"><tbody><tr><td>この院の品目</td><td class="n"><b>' + S.meds.length + '</b></td><td>うち在庫0</td><td class="n"><b>' + zero + '</b></td></tr></tbody></table>';
    h += '<div class="foot" style="border-top:1px solid var(--ink)"><span>コピー元</span><div class="seg" id="cpSrc">' + others.map(function (c) { return '<button data-id="' + c.id + '" class="' + (c.id === src ? 'on' : '') + '">' + esc(c.short) + '<b>' + load(c.id).meds.length + '</b></button>'; }).join('') + '</div>' +
      (db ? '<span class="rd">在庫は0で登録します（コピー元は西春の見本データ）</span>'
        : '<span>在庫</span><div class="seg" id="cpKeep"><button data-k="0" class="' + (!keep ? 'on' : '') + '">0で始める</button><button data-k="1" class="' + (keep ? 'on' : '') + '">在庫数もコピー</button></div>') +
      '<span class="grow"></span><button class="btn pri" id="cpGo"' + (miss.length ? '' : ' disabled') + '>選んだ品目をコピー</button></div>';
    h += '<table><thead><tr><th class="cb"></th><th>コード</th><th>薬品名</th><th>対象/薬効</th><th class="n">' + esc(CL[src].short) + 'の在庫</th><th class="n">コピー後の在庫</th><th class="n">発注点</th></tr></thead><tbody>';
    miss.forEach(function (m) { h += '<tr><td class="cb"><input type="checkbox" class="cps" data-code="' + m.code + '"' + (ui.cpSel[m.code] ? ' checked' : '') + '></td><td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '</td><td>' + esc(m.category) + '</td><td class="n">' + stockCell(m) + '</td><td class="n">' + (m.stock_untracked ? '外用' : keep ? f(m.current_stock) : '0') + '</td><td class="n">' + f(m.threshold) + '</td></tr>'; });
    if (!miss.length) h += '<tr><td colspan="7" class="empty">' + esc(CL[src].short) + 'の品目はすべてこの院にあります。</td></tr>';
    if (ui.cpLast && ui.cpLast.length) { h += '<tr><td colspan="7" style="background:var(--tint);font-weight:700;border-bottom:1px solid var(--ink)">コピーした品目（この院の在庫）</td></tr>'; ui.cpLast.forEach(function (c) { var m = byCode(c); if (m) h += '<tr><td class="cb">✓</td><td class="code">' + m.code + '</td><td class="nm">' + esc(nm(m)) + '</td><td>' + esc(m.category) + '</td><td class="n">—</td><td class="n">' + stockCell(m) + '</td><td class="n">' + f(m.threshold) + '</td></tr>'; }); }
    h += '</tbody></table>';
    if (ui.cpDone) h += '<div class="okbox" style="margin:12px 18px">' + ui.cpDone + '</div>';
    $('#main').innerHTML = h;
    $$('#cpSrc button').forEach(function (b) { b.onclick = function () { ui.cpSrc = b.dataset.id; ui.cpDone = null; ui.cpLast = null; vCopy(); }; });
    $$('#cpKeep button').forEach(function (b) { b.onclick = function () { ui.cpKeep = b.dataset.k === '1'; vCopy(); }; });
    $$('.cps').forEach(function (c) { c.onchange = function () { ui.cpSel[c.dataset.code] = c.checked ? 1 : 0; }; });
    $('#cpGo').onclick = function () {
      var btn = this, pick = miss.filter(function (m) { return ui.cpSel[m.code]; });
      if (!pick.length) { toast('コピーする品目を選んでください'); return; }
      if (!guard(btn)) return;
      if (src !== 'nishiharu') { msg('<b>書き込みはしません</b>　院間コピーでDBに書けるのは「西春（見本）の品目をテスト用へ」だけです。', 'warn', btn); return; }
      run(btn, async function () {
        var done = [], err = null;
        for (var i = 0; i < pick.length; i++) {   // 1品目ずつ・在庫0
          var m = pick[i]; btn.textContent = '送信中… ' + (i + 1) + '/' + pick.length;
          var row = { name: m.name, furigana: m.furigana, unit: m.unit, category: m.category, price: m.price, pack_size: m.pack_size, cost_per_pack: m.cost_per_pack,
            threshold: m.threshold, current_stock: 0, rezept_code: m.rezept_code, maker: m.maker, form: m.form };
          try { var r = await SB.upsertMedicine('test', row, op(), SRC); done.push(r.code); } catch (e) { err = m.code + ' ' + nm(m) + '：' + e.message; break; }
        }
        S.flow.copy += done.length; ui.cpLast = done; ui.cpSel = null;
        ui.cpDone = done.length + ' 品目を西春（見本）からテスト用へコピーしました（DBに登録・在庫0）。発注は「2 発注リスト」から。' + (err ? '<br><b style="color:var(--sig)">途中で止まりました：</b>' + esc(err) : '');
        render();
      });
    };
  }

  /* ---------- キーボード ---------- */
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === 'Enter' && t.classList && t.classList.contains('in')) {
      e.preventDefault(); if (t.onchange) t.dispatchEvent(new Event('change'));
      var col = t.dataset.col, k = t.dataset.k || t.dataset.code;
      setTimeout(function () {
        var all = $$('#main input.in[data-col="' + col + '"]'), idx = -1;
        all.forEach(function (x, i) { if ((x.dataset.k || x.dataset.code) === k) idx = i; });
        var nx = all[idx + 1]; if (nx) { nx.focus(); nx.select && nx.select(); }
      }, 0);
      return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(t.tagName) || $('#app').hidden) return;
    if (e.key === 'Escape') { $('#sheet').hidden = true; return; }
    var m = { '1': 'due', '2': 'order', '3': 'recv', '4': 'count', '5': 'add', '6': 'copy' }[e.key];
    if (m) { if (m === 'count') ui.cntRows = null; go(m); }
  });

  /* ---------- 起動 ---------- */
  $('#pickGrid').addEventListener('click', function (e) { var b = e.target.closest('.pick-c'); if (b) enter(b.dataset.id); });
  $('#clinicBtn').onclick = showPick;
  $$('#steps button').forEach(function (b) { b.onclick = function () { if (b.dataset.step === 'count') ui.cntRows = null; if (b.dataset.step === 'due') ui.dueSel = null; go(b.dataset.step); }; });
  var os = $('#opSel'); os.innerHTML = D.operators.map(function (o) { return '<option' + (o === op() ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  os.onchange = function () { ls(KEY + 'op', os.value); };
  // デモの初期化：2段階（1回目で確認の表示、5秒以内にもう一度押すと実行）。テスト用の院は SB.resetTest()
  var rsArm = false, rsT = null;
  function rsIdle() { var b = $('#resetBtn'); rsArm = false; b.textContent = 'デモの初期化'; b.classList.remove('arm'); }
  $('#resetBtn').onclick = function () {
    var b = this;
    if (!rsArm) {
      rsArm = true; b.classList.add('arm');
      b.textContent = SB && SB.live ? 'もう一度押すと初期化します（テスト用の院のDBを初期状態へ）' : 'もう一度押すと初期化します（この画面の作業中の内容）';
      clearTimeout(rsT); rsT = setTimeout(rsIdle, 5000); return;
    }
    clearTimeout(rsT); rsIdle();
    if (!(SB && SB.live)) { MEM = {}; S = load(cid); ui = {}; go('due'); toast('作業中の内容を初期化しました（見本データはそのままです）'); return; }
    run(b, async function () {
      await SB.resetTest();
      MEM = {}; S = load(cid); ui = {}; go('due');
      toast('テスト用の院を初期状態に戻しました（西春・中川は見本のまま）');
    });
  };
  window.__demoC = { enter: enter, go: go };
  (async function () {
    $('#pick').hidden = false;
    $('#pickGrid').innerHTML = '<div class="pick-wait">接続中…（テスト用の院の在庫を本番DBから読み込んでいます）</div>';
    if (SB) { try { await SB.ready; } catch (e) {} }
    MEM = {};
    showPick();
  })();
})();
