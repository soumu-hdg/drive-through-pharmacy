/* =========================================================
   v0.8 screen-home.js ― 今日の状態（デスクトップ初期画面）
   KPIバンド / 要対応テーブル（1行1品目・残/発注点/7日出庫/週次推移） / 受入待ち発注書 /
   直近の操作10件 / カルテ突合の表示先
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  // 月次消費額（原価）の推移 → 評価額セルのスパークライン（既存ビューの読み取りのみ）
  var trend = null, trendLoading = false;
  async function loadTrend() {
    if (trend || trendLoading) return;
    trendLoading = true;
    var rows = await P8.db.get('pharmacy_v_monthly_consumption?select=ym,cost_amount');
    trendLoading = false;
    if (!rows || !rows.length) return;
    var byYm = {};
    rows.forEach(function (r) {
      var k = String(r.ym || '').slice(0, 7);
      if (!k) return;
      byYm[k] = (byYm[k] || 0) + (Number(r.cost_amount) || 0);
    });
    trend = Object.keys(byYm).sort().slice(-6).map(function (k) { return byYm[k]; });
    if (trend.length < 2) { trend = null; return; }
    if (document.getElementById('scr-home').classList.contains('active')) kpi();
  }

  function kpi() {
    var st = P8.store;
    var out = st.reorderCount(['out_of_stock']);
    var soon = st.reorderCount(['runs_out_soon']);
    var low = st.reorderCount(['below_threshold']);
    var rev = st.reverseMargins().length;
    var sparkHtml = trend
      ? '<div class="kpi-spark">' + P8.ui.spark(trend, 72, 16) + '<span>月次消費' + trend.length + 'ヶ月</span></div>' : '';
    document.getElementById('home-kpi').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">在庫評価額（原価）</div><div class="kpi-value">' + U.YEN(st.stockCostValue()) + '</div>' + sparkHtml + '</div>' +
      '<div class="kpi-cell"><div class="kpi-label">在庫切れ</div><div class="kpi-value' + (out ? ' warn' : ' ok') + '">' + out + '<small>品目</small></div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">30日以内に切れる</div><div class="kpi-value' + (soon ? ' amber' : '') + '">' + soon + '<small>品目</small></div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">発注点割れ</div><div class="kpi-value' + (low ? ' amber' : '') + '">' + low + '<small>品目</small></div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">逆ザヤ</div><div class="kpi-value' + (rev ? ' warn' : ' ok') + '">' + rev + '<small>品目</small></div></div>';
  }

  function names(list, max) {
    var arr = list.slice(0, max).map(function (x) { return x.name; });
    var rest = list.length - arr.length;
    return U.esc(arr.join('、')) + (rest > 0 ? ' ほか' + rest + '品目' : '');
  }

  // ---- 直近8日の出庫（7日出庫と週次推移。1回だけ取得し画面側で日別集計） ----
  var txAgg = null, txLoading = false;
  function jstDate(offsetDays) {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  async function loadTx() {
    if (txAgg || txLoading) return;
    txLoading = true;
    var rows = await P8.db.get('pharmacy_transactions?select=medicine_code,quantity,occurred_on' +
      '&transaction_type=eq.out&occurred_on=gte.' + jstDate(-7) + '&limit=2000');
    txLoading = false;
    txAgg = {};
    (rows || []).forEach(function (r) {
      var code = U.normalizeCode(r.medicine_code);
      var day = String(r.occurred_on || '').slice(0, 10);
      if (!code || !day) return;
      var m = txAgg[code] || (txAgg[code] = {});
      m[day] = (m[day] || 0) + (Number(r.quantity) || 0);
    });
    if (document.getElementById('scr-home').classList.contains('active')) todo();
  }
  // 8点（7日前〜今日）の日別出庫。読込中=undefined／期間内に出庫ゼロ=null（線を描かない）
  function txSeries(code) {
    if (!txAgg) return undefined;
    var codes = [U.normalizeCode(code)];
    var m = P8.store.findByCode(code);
    if (m) (m.legacyCodes || []).forEach(function (c) { codes.push(U.normalizeCode(c)); });
    var found = false;
    var vals = [];
    for (var i = 7; i >= 0; i--) {
      var day = jstDate(-i), s = 0;
      codes.forEach(function (c) {
        var a = txAgg[c];
        if (a && a[day] != null) { s += a[day]; found = true; }
      });
      vals.push(s);
    }
    return found ? vals : null;
  }
  function sum7(vals) { // 直近7日合計（8点の先頭=8日前を除く）
    return vals.slice(1).reduce(function (s, v) { return s + v; }, 0);
  }

  // ---- 要対応（1行1品目・style06のデータ密度） ----
  var REASON = {
    out_of_stock:    { label: '在庫切れ',     cell: 't-dn', spk: 'spk-dn' },
    runs_out_soon:   { label: 'まもなく切れる', cell: 't-wr', spk: 'spk-mut' },
    below_threshold: { label: '発注点割れ',   cell: 't-wr', spk: 'spk-wr' }
  };
  function sparkCell(vals, spkCls) {
    if (vals === undefined) return '<span class="t-mut">…</span>';
    if (vals === null) return '<span class="t-mut">—</span>';
    return '<span class="' + spkCls + '">' + P8.ui.spark(vals, 64, 14) + '</span>';
  }
  function out7Cell(vals) {
    if (vals === undefined) return '…';
    if (vals === null) return '<span class="t-mut">—</span>';
    return String(sum7(vals));
  }
  function trOpen(pri, go, params) {
    return '<tr class="clickable" data-go="' + go + '" data-params="' + U.esc(JSON.stringify(params || {})) + '">' +
      '<td class="hide-mobile"><span class="lvl p' + pri + '">P' + pri + '</span></td>';
  }
  function reorderRow(r) {
    var rs = REASON[r.status];
    var vals = txSeries(r.code);
    var reason = rs.label + (r.status === 'runs_out_soon' && r.days_left != null ? '（残' + r.days_left + '日）' : '');
    var stockCls = r.status === 'out_of_stock' ? ' t-dn' : ' t-wr';
    return trOpen(r.priority, 'order', { filter: 'alert' }) +
      '<td><b>' + U.esc(r.name) + '</b></td>' +
      '<td class="' + rs.cell + '" style="white-space:nowrap">' + reason + '</td>' +
      '<td class="r' + stockCls + '">' + (r.current_stock || 0) + '<small class="t-mut">' + U.esc(r.unit || '') + '</small></td>' +
      '<td class="r hide-mobile">' + (r.threshold != null ? r.threshold : '—') + '</td>' +
      '<td class="r hide-mobile">' + out7Cell(vals) + '</td>' +
      '<td class="hide-mobile">' + sparkCell(vals, rs.spk) + '</td>' +
      '<td class="r"><button class="btn ghost sm go" type="button">発注</button></td></tr>';
  }
  function marginRow(m) {
    var vals = txSeries(m.code);
    var diff = Math.abs(m.marginPerUnit);
    return trOpen(3, 'master', { filter: 'all' }) +
      '<td><b>' + U.esc(m.name) + '</b></td>' +
      '<td class="t-dn" style="white-space:nowrap">逆ザヤ</td>' +
      '<td class="r">' + (m.stock || 0) + '<small class="t-mut">' + U.esc(m.unit || '') + '</small></td>' +
      '<td class="r hide-mobile">' + (m.threshold != null ? m.threshold : '—') + '</td>' +
      '<td class="r hide-mobile">' + out7Cell(vals) + '</td>' +
      // 逆ザヤに在庫推移の線は意味が薄い → 原価と薬価の差額（この行の判断材料）を出す
      '<td class="hide-mobile t-dn" style="white-space:nowrap" title="原価 ¥' + m.costPerUnit.toFixed(2) + ' ＞ 薬価 ¥' + m.price + '">−¥' + diff.toFixed(2) + '/' + U.esc(m.unit || '単位') + '</td>' +
      '<td class="r"><button class="btn ghost sm go" type="button">価格</button></td></tr>';
  }

  function todo() {
    var st = P8.store;

    // 品目ごとの要対応（在庫切れ／まもなく切れる／発注点割れ／逆ザヤ）
    var items = [];
    st.reorder.forEach(function (r) {
      if (r.priority >= 1 && r.priority <= 3 && REASON[r.status]) items.push({ kind: 'reorder', r: r, pri: r.priority });
    });
    st.reverseMargins().forEach(function (m) { items.push({ kind: 'margin', m: m, pri: 3 }); });
    items.sort(function (a, b) { return a.pri - b.pri; }); // 安定ソート＝同優先度はビューの並び（残少ない順）を維持

    var MAX = 10;
    var shown = items.slice(0, MAX);
    var rest = items.length - shown.length;
    var body = shown.map(function (it) { return it.kind === 'margin' ? marginRow(it.m) : reorderRow(it.r); }).join('');
    if (rest > 0) {
      body += '<tr class="clickable todo-rest" data-go="order" data-params="' + U.esc(JSON.stringify({ filter: 'alert' })) + '">' +
        '<td colspan="8">ほか ' + rest + ' 件 — 全件は発注画面で →</td></tr>';
    }
    var head = '<thead><tr>' +
      '<th class="hide-mobile" style="width:36px">優先</th><th>薬品名</th><th>事由</th>' +
      '<th class="r">残</th><th class="r hide-mobile">発注点</th><th class="r hide-mobile">7日出庫</th>' +
      '<th class="hide-mobile" style="width:72px">週次推移</th><th style="width:64px"></th></tr></thead>';

    // 品目単位で出せないもの（ロット・突合・棚卸系）は表の下に1行ずつ
    var extra = [];
    function line(badgeCls, badge, text, go, params, label) {
      extra.push('<div class="todo-line" data-go="' + go + '" data-params="' + U.esc(JSON.stringify(params || {})) + '">' +
        '<span class="bdg ' + badgeCls + '">' + badge + '</span><span class="grow">' + text + '</span>' +
        '<span class="todo-go">→ ' + label + '</span></div>');
    }
    var neg = st.stock.filter(function (m) { return (m.stock || 0) < 0; });
    if (neg.length) line('red', 'マイナス在庫', names(neg, 5) + '（出庫が入庫を上回っています。実数を入れてください）', 'stocktake', {}, '棚卸へ');
    if (homeExpiry && homeExpiry.length) {
      var expired = homeExpiry.filter(function (r) { return r.status === 'expired'; });
      var soon2 = homeExpiry.filter(function (r) { return r.status === 'soon'; });
      if (expired.length) line('amber', '期限切れ', names(expired, 4), 'receive', {}, '入荷へ');
      if (soon2.length) line('amber', '期限切迫', names(soon2, 4), 'receive', {}, '入荷へ');
    }
    if (st.noExpiryCount > 0) line('amber', '期限未登録', '残数のあるロット' + st.noExpiryCount + '件に使用期限が入っていません', 'receive', {}, '入荷へ');
    if (st.missingDrugs.length) {
      line('amber', 'カルテ突合', 'カルテにあって在庫マスタに無い薬が' + st.missingDrugs.length + '件（' +
        names(st.missingDrugs, 3) + '）', 'master', { wizard: true, missing: true }, '追加ウィザードへ');
    }

    var wrap = document.getElementById('home-todo-wrap');
    var tbl = document.getElementById('home-todo');
    if (items.length) {
      wrap.hidden = false;
      tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
    } else if (extra.length) {
      wrap.hidden = true;
      tbl.innerHTML = '';
    } else {
      wrap.hidden = false;
      tbl.innerHTML = '<tbody><tr><td style="color:var(--act);font-weight:700;padding:12px 8px">✅ 要対応はありません</td></tr></tbody>';
    }
    document.getElementById('home-todo-extra').innerHTML = extra.join('');
    document.getElementById('home-todo-count').textContent =
      items.length ? items.length + '件・優先度順／行クリックで該当画面へ' : 'クリックで該当画面へ';
  }

  var homeExpiry = null;

  async function loadPo() {
    var el = document.getElementById('home-po');
    var orders = await P8.db.get('pharmacy_orders?status=in.(sent,partial)&select=id,order_no,ordered_on,status,pharmacy_suppliers(name),pharmacy_order_items(id,amount)&order=ordered_on.desc&limit=10');
    if (!orders) { el.innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    if (!orders.length) { el.innerHTML = '<span class="muted">受入待ちの発注書はありません</span>'; return; }
    el.innerHTML = orders.map(function (o) {
      var items = o.pharmacy_order_items || [];
      var amount = items.reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0);
      return '<div class="od-row"><div class="grow">' +
        '<div class="od-name"><span class="bdg ' + (o.status === 'partial' ? 'amber' : 'amber') + '">' +
        (o.status === 'partial' ? '一部受入' : '発注済') + '</span> ' + U.esc(o.order_no) + '</div>' +
        '<div class="od-sub">' + U.esc((o.pharmacy_suppliers && o.pharmacy_suppliers.name) || '仕入先未設定') + ' ｜ ' +
        items.length + '品目 ' + U.YEN(amount) + ' ｜ ' + o.ordered_on + ' 発注</div></div>' +
        '<button class="btn act sm" data-id="' + o.id + '">受け入れる</button></div>';
    }).join('');
  }

  async function loadRecent() {
    var el = document.getElementById('home-recent');
    var rows = await P8.db.get('pharmacy_transactions?select=medicine_code,transaction_type,quantity,patient_name,operator,note,created_at&order=created_at.desc&limit=10');
    if (!rows) { el.innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    if (!rows.length) { el.innerHTML = '<span class="muted">操作はまだありません</span>'; return; }
    el.innerHTML = rows.map(function (r) {
      var m = P8.store.findByCode(r.medicine_code);
      var j = U.sbToJst(r.created_at);
      var t = r.transaction_type;
      var icon = t === 'in' ? '📥' : t === 'adjust' ? '📝' : '📤';
      var qty = t === 'in' ? '+' + r.quantity : t === 'adjust' ? '→' + r.quantity : '−' + r.quantity;
      var op = r.operator || ((r.note && /^担当[:：]/.test(r.note)) ? r.note.replace(/^担当[:：]/, '') : '');
      return '<div class="hist-item"><div class="hi-icon ' + t + '">' + icon + '</div>' +
        '<div class="hi-main"><div class="hi-name">' + U.esc(m ? m.name : r.medicine_code) + '</div>' +
        '<div class="hi-sub">' + j.date + ' ' + j.time + (op ? ' ・ ' + U.esc(op) : '') + (r.patient_name ? ' ・ ' + U.esc(r.patient_name) : '') + '</div></div>' +
        '<div class="hi-qty ' + t + '">' + qty + (m ? U.esc(m.unit) : '') + '</div></div>';
    }).join('');
  }

  async function loadExpiry() {
    homeExpiry = await P8.db.get('pharmacy_v_expiry?status=in.(expired,soon)&select=name,status&limit=30');
    todo();
  }

  // 日付行のモード名だけを描き直す（テーマ切替のたびに全体を再取得しない）
  function renderDateLine() {
    if (!U) U = P8.util; // 起動直後のp8:themeはDOMContentLoadedより先に届く
    var el = document.getElementById('home-date');
    if (!el) return;
    var wd = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
    el.textContent = U.todayJst() + '（' + wd + '）' +
      (P8.theme.effective() === 'night' ? '🌙 夜間モード' : '☀️ 日中モード');
  }
  document.addEventListener('p8:theme', renderDateLine);

  function render() {
    renderDateLine();
    kpi();
    todo();
    loadPo();
    loadRecent();
    loadExpiry();
    loadTrend();
    loadTx();
  }

  P8.screens = P8.screens || {};
  P8.screens.home = {
    show: function () { U = P8.util; render(); },
    hide: function () {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    document.getElementById('home-todo-panel').addEventListener('click', function (e) {
      var t = e.target.closest('tr.clickable, .todo-line');
      if (!t) return;
      var params = {};
      try { params = JSON.parse(t.getAttribute('data-params') || '{}'); } catch (err) {}
      P8.nav(t.getAttribute('data-go'), params);
    });
    document.getElementById('home-po').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (b) P8.nav('receive', { orderId: Number(b.getAttribute('data-id')) });
    });
    P8.store.onChange(function () {
      if (document.getElementById('scr-home').classList.contains('active')) { kpi(); todo(); }
    });
  });
})();
