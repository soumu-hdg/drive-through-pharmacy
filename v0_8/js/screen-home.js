/* =========================================================
   v0.8 screen-home.js ― 今日の状態（デスクトップ初期画面）
   KPIバンド / 要対応リスト（品名＋行き先） / 受入待ち発注書 /
   直近の操作10件 / カルテ突合の表示先
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  function kpi() {
    var st = P8.store;
    var out = st.reorderCount(['out_of_stock']);
    var soon = st.reorderCount(['runs_out_soon']);
    var low = st.reorderCount(['below_threshold']);
    var rev = st.reverseMargins().length;
    document.getElementById('home-kpi').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">在庫評価額（原価）</div><div class="kpi-value">' + U.YEN(st.stockCostValue()) + '</div></div>' +
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

  function todo() {
    var st = P8.store;
    var rows = [];
    function row(badgeCls, badge, text, navName, navParams, linkLabel) {
      rows.push('<tr class="clickable" data-go="' + navName + '" data-params="' + U.esc(JSON.stringify(navParams || {})) + '">' +
        '<td style="width:110px"><span class="bdg ' + badgeCls + '">' + badge + '</span></td>' +
        '<td>' + text + '</td>' +
        '<td class="r" style="white-space:nowrap;color:var(--act)">→ ' + linkLabel + '</td></tr>');
    }
    var out = st.reorder.filter(function (r) { return r.status === 'out_of_stock'; });
    if (out.length) row('red', '在庫切れ', names(out, 5), 'order', { filter: 'alert' }, '発注へ');
    var neg = st.stock.filter(function (m) { return (m.stock || 0) < 0; });
    if (neg.length) row('red', 'マイナス在庫', names(neg, 5) + '（出庫が入庫を上回っています。実数を入れてください）', 'stocktake', {}, '棚卸へ');
    var rev = st.reverseMargins();
    rev.forEach(function (m) {
      row('red', '逆ザヤ', U.esc(m.name) + '（原価 ¥' + m.costPerUnit.toFixed(2) + ' ＞ 薬価 ¥' + m.price + '）', 'master', { filter: 'all' }, 'マスタ整備へ');
    });
    if (homeExpiry && homeExpiry.length) {
      var expired = homeExpiry.filter(function (r) { return r.status === 'expired'; });
      var soon2 = homeExpiry.filter(function (r) { return r.status === 'soon'; });
      if (expired.length) row('amber', '期限切れ', names(expired, 4), 'receive', {}, '入荷へ');
      if (soon2.length) row('amber', '期限切迫', names(soon2, 4), 'receive', {}, '入荷へ');
    }
    var soon = st.reorder.filter(function (r) { return r.status === 'runs_out_soon'; });
    if (soon.length) {
      row('amber', 'まもなく切れる', U.esc(soon.slice(0, 4).map(function (r) {
        return r.name + (r.days_left != null ? '（残り' + r.days_left + '日）' : '');
      }).join('、')) + (soon.length > 4 ? ' ほか' + (soon.length - 4) + '品目' : ''), 'order', { filter: 'alert' }, '発注へ');
    }
    var low = st.reorder.filter(function (r) { return r.status === 'below_threshold'; });
    if (low.length) row('amber', '発注点割れ', names(low, 5), 'order', { filter: 'alert' }, '発注へ');
    if (st.noExpiryCount > 0) {
      row('amber', '期限未登録', '残数のあるロット' + st.noExpiryCount + '件に使用期限が入っていません', 'receive', {}, '入荷へ');
    }
    if (st.missingDrugs.length) {
      row('amber', 'カルテ突合', 'カルテにあって在庫マスタに無い薬が' + st.missingDrugs.length + '件（' +
        names(st.missingDrugs, 3) + '）', 'master', { wizard: true, missing: true }, '追加ウィザードへ');
    }
    document.getElementById('home-todo').innerHTML = rows.length ? rows.join('')
      : '<tr><td style="color:var(--act);font-weight:700;padding:12px 8px">✅ 要対応はありません</td></tr>';
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

  function render() {
    var now = new Date();
    var wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
    document.getElementById('home-date').textContent =
      U.todayJst() + '（' + wd + '）' + (P8.theme.effective() === 'night' ? '🌙 夜間モード' : '☀️ 日中モード');
    kpi();
    todo();
    loadPo();
    loadRecent();
    loadExpiry();
  }

  P8.screens = P8.screens || {};
  P8.screens.home = {
    show: function () { U = P8.util; render(); },
    hide: function () {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    document.getElementById('home-todo').addEventListener('click', function (e) {
      var tr = e.target.closest('tr.clickable');
      if (!tr) return;
      var params = {};
      try { params = JSON.parse(tr.getAttribute('data-params') || '{}'); } catch (err) {}
      P8.nav(tr.getAttribute('data-go'), params);
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
