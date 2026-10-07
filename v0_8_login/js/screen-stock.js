/* =========================================================
   v0.8 screen-stock.js ― 在庫一覧
   デスクトップ=ソート可能な表 / モバイル=カード2列＋体重別
   行クリックで詳細ドロワー（ロット・直近入出庫・マスタ項目）
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  var catFilter = '', weightFilter = '', search = '';
  var sortKey = 'code', sortAsc = true;
  var selected = new Set();

  function statusOf(m) {
    // 優先: 在庫切れ > 逆ザヤ > 発注点割れ > 残n日 > OK ／ 外用は在庫非管理
    if (m.stockUntracked) return { label: '在庫非管理', cls: 'muted' };
    var ro = P8.store.reorder.find(function (r) { return r.code === m.code; });
    if (ro && ro.status === 'out_of_stock') return { label: '在庫切れ', cls: 'danger' };
    if (ro && ro.status === 'not_stocked') return { label: '未仕入', cls: 'muted' };
    if ((m.stock || 0) === 0 && !ro) return { label: '在庫切れ', cls: 'danger' };
    if (m.marginPerUnit !== null && m.marginPerUnit < 0) return { label: '逆ザヤ', cls: 'danger' };
    if ((m.stock || 0) < (m.threshold || 0)) return { label: '発注点割れ', cls: 'warn' };
    if (ro && ro.status === 'runs_out_soon' && ro.days_left != null) return { label: '残' + ro.days_left + '日', cls: 'warn' };
    return { label: 'OK', cls: 'ok' };
  }
  function statusHtml(st) {
    var color = st.cls === 'danger' ? 'var(--danger)' : st.cls === 'warn' ? 'var(--warn)' : st.cls === 'ok' ? 'var(--act)' : 'var(--ink-sub)';
    var weight = (st.cls === 'danger' || st.cls === 'warn') ? '700' : '400';
    return '<span style="color:' + color + ';font-weight:' + weight + '">' + st.label + '</span>';
  }

  function filtered() {
    var wMap = weightFilter ? U.weightDoseMap[weightFilter] : null;
    var q = search.toLowerCase();
    return P8.store.stock.filter(function (m) {
      if (q && m.name.toLowerCase().indexOf(q) < 0 && String(m.code).indexOf(search) < 0 &&
        (m.category || '').toLowerCase().indexOf(q) < 0 && (m.maker || '').toLowerCase().indexOf(q) < 0) return false;
      if (catFilter && !(m.category || '').startsWith(catFilter)) return false;
      if (wMap && wMap.codes.indexOf(m.code) < 0) return false;
      return true;
    });
  }

  function sortList(list) {
    var k = sortKey, asc = sortAsc ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var va, vb;
      if (k === 'stock') { va = a.stockUntracked ? -1 : a.stock; vb = b.stockUntracked ? -1 : b.stock; }
      else if (k === 'threshold') { va = a.threshold; vb = b.threshold; }
      else if (k === 'cost') { va = a.costPerUnit === null ? -1 : a.costPerUnit; vb = b.costPerUnit === null ? -1 : b.costPerUnit; }
      else if (k === 'price') { va = Number(a.price) || 0; vb = Number(b.price) || 0; }
      else if (k === 'name') { return a.name.localeCompare(b.name, 'ja') * asc; }
      else if (k === 'category') { return String(a.category).localeCompare(String(b.category), 'ja') * asc; }
      else { return String(a.code).localeCompare(String(b.code)) * asc; }
      return (va - vb) * asc;
    });
  }

  function render() {
    var list = sortList(filtered());
    var wMap = weightFilter ? U.weightDoseMap[weightFilter] : null;
    document.getElementById('stock-total').textContent = list.length + ' / ' + P8.store.stock.length + '品目';

    // KPI（デスクトップのみ表示）
    var st = P8.store;
    var low = st.stock.filter(function (m) { return !m.stockUntracked && (m.stock || 0) < (m.threshold || 0); }).length;
    document.getElementById('stock-kpi').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">在庫評価額（仕入原価）</div><div class="kpi-value">' + U.YEN(st.stockCostValue()) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">同（薬価ベース）</div><div class="kpi-value">' + U.YEN(st.stockListValue()) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">発注点割れ</div><div class="kpi-value' + (low ? ' warn' : '') + '">' + low + '<small>品目</small></div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">逆ザヤ（薬価＜原価）</div><div class="kpi-value' + (st.reverseMargins().length ? ' warn' : '') + '">' + st.reverseMargins().length + '<small>品目</small></div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">原価未設定</div><div class="kpi-value">' + st.stock.filter(function (m) { return m.costPerUnit === null; }).length + '<small>品目</small></div></div>';

    document.getElementById('stock-weight-note').innerHTML = wMap
      ? '<div class="warn-line" style="animation:none">📏 ' + wMap.label + ' の処方用量で表示中</div>' : '';

    // デスクトップ表
    function arrow(k) { return sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''; }
    var thead = '<tr>' +
      '<th class="sortable" data-k="code">コード' + arrow('code') + '</th>' +
      '<th class="sortable" data-k="name">薬品名' + arrow('name') + '</th>' +
      '<th class="sortable" data-k="category">分類' + arrow('category') + '</th>' +
      '<th class="r sortable" data-k="stock">在庫' + arrow('stock') + '</th>' +
      '<th class="r sortable" data-k="threshold">発注点' + arrow('threshold') + '</th>' +
      '<th class="r sortable" data-k="cost">原価/単位' + arrow('cost') + '</th>' +
      '<th class="r sortable" data-k="price">薬価' + arrow('price') + '</th>' +
      '<th>状態</th></tr>';
    var rows = list.map(function (m) {
      var st2 = statusOf(m);
      var stockCell = m.stockUntracked ? '<span class="muted">—</span>'
        : '<b' + ((m.stock || 0) < (m.threshold || 0) ? ' style="color:var(--danger)"' : '') + '>' + m.stock + '</b><small class="muted">' + U.esc(m.unit) + '</small>';
      var doseNote = wMap && wMap.notes && wMap.notes[m.code] ? ' <span class="bdg amber">' + wMap.notes[m.code] + '</span>' : '';
      return '<tr class="clickable" data-code="' + U.esc(m.code) + '">' +
        '<td class="num">' + U.esc(m.code) + '</td>' +
        '<td>' + U.esc(m.name) + doseNote + '</td>' +
        '<td class="muted">' + U.esc(m.category || '') + '</td>' +
        '<td class="r">' + stockCell + '</td>' +
        '<td class="r">' + (m.stockUntracked ? '—' : m.threshold) + '</td>' +
        '<td class="r">' + (m.costPerUnit !== null ? '¥' + m.costPerUnit.toFixed(2) : '<span class="muted">未設定</span>') + '</td>' +
        '<td class="r">' + (m.price ? '¥' + m.price : '<span class="muted">未設定</span>') + '</td>' +
        '<td>' + statusHtml(st2) + '</td></tr>';
    }).join('');
    document.getElementById('stock-table').innerHTML = thead + rows;

    // モバイルカード
    document.getElementById('stock-cards').innerHTML = list.map(function (m) {
      var st2 = statusOf(m);
      var checked = selected.has(m.code);
      var doseNote = wMap && wMap.notes && wMap.notes[m.code] ? '<span class="bdg amber">' + wMap.notes[m.code] + '</span> ' : '';
      var qty = m.stockUntracked
        ? '<span class="muted" style="font-size:13px">在庫非管理</span>'
        : '<span class="sc-qty' + ((m.stock || 0) < (m.threshold || 0) ? ' low' : '') + '">' + m.stock + '<small> ' + U.esc(m.unit) + '</small></span>';
      return '<div class="stock-card' + (checked ? ' checked' : '') + '" data-code="' + U.esc(m.code) + '">' +
        '<div class="sc-name">' + U.esc(m.name) + '</div>' +
        '<div class="sc-sub">' + U.esc(m.code) + ' ｜ ' + U.esc((m.category || '').split('/').slice(1).join('/')) + '</div>' +
        '<div>' + doseNote + qty + ' ' + statusHtml(st2) + '</div>' +
        '</div>';
    }).join('') || '<div class="muted" style="grid-column:1/-1;padding:14px">該当なし</div>';

    updateMultiBar();
  }

  function updateMultiBar() {
    document.getElementById('multi-count').textContent = selected.size + '件選択中';
    document.getElementById('multi-bar').classList.toggle('show', selected.size > 0);
  }

  // ---- 詳細ドロワー ----
  async function openDrawer(code) {
    var m = P8.store.findByCode(code);
    if (!m) return;
    var body = document.getElementById('drawer-body');
    body.innerHTML = '<h3>' + U.esc(m.name) + '</h3><div class="muted">読み込み中...</div>';
    document.getElementById('drawer').classList.add('show');
    var enc = encodeURIComponent(m.code);
    var results = await Promise.all([
      P8.db.get('pharmacy_lots?medicine_code=eq.' + enc + '&qty_remaining=gt.0&select=lot_no,expiry_on,qty_remaining,received_on,unit_cost&order=expiry_on.asc.nullslast&limit=15'),
      P8.db.get('pharmacy_transactions?medicine_code=eq.' + enc + '&select=transaction_type,quantity,patient_name,operator,created_at&order=created_at.desc&limit=10')
    ]);
    var lots = results[0], txs = results[1];
    var lotHtml = (lots && lots.length) ? lots.map(function (l) {
      return '<tr><td>' + U.esc(l.lot_no || '—') + '</td><td>' + (l.expiry_on || '<span class="bdg ghost">期限未登録</span>') +
        '</td><td class="r">' + l.qty_remaining + '</td><td class="muted">' + l.received_on + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="muted">残数のあるロットはありません</td></tr>';
    var txHtml = (txs && txs.length) ? txs.map(function (t) {
      var j = U.sbToJst(t.created_at);
      var sign = t.transaction_type === 'in' ? '+' : t.transaction_type === 'out' ? '−' : '→';
      return '<tr><td class="muted">' + j.date + ' ' + j.time + '</td><td>' + sign + t.quantity +
        '</td><td class="muted">' + U.esc(t.operator || '') + (t.patient_name ? ' ｜ ' + U.esc(t.patient_name) : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="3" class="muted">履歴なし</td></tr>';
    var stt = statusOf(m);
    body.innerHTML =
      '<h3 style="margin-right:24px">' + U.esc(m.name) + '</h3>' +
      '<div class="muted mb8">' + U.esc(m.code) + ' ｜ ' + U.esc(m.category || '') + ' ｜ ' + statusHtml(stt) + '</div>' +
      '<div class="kpi-band"><div class="kpi-cell"><div class="kpi-label">在庫</div><div class="kpi-value">' +
      (m.stockUntracked ? '—' : m.stock + '<small>' + U.esc(m.unit) + '</small>') + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">発注点</div><div class="kpi-value">' + (m.stockUntracked ? '—' : m.threshold) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">原価/単位</div><div class="kpi-value" style="font-size:17px">' + (m.costPerUnit !== null ? '¥' + m.costPerUnit.toFixed(2) : '未設定') + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">薬価</div><div class="kpi-value" style="font-size:17px">' + (m.price ? '¥' + m.price : '未設定') + '</div></div></div>' +
      '<div class="flex mb8">' +
      '<button class="btn ghost sm" id="dr-to-st">📝 棚卸で修正</button>' +
      '<button class="btn ghost sm" id="dr-to-od">🛒 発注に追加</button>' +
      '<button class="btn ghost sm" id="dr-to-dsp">💊 出庫リストへ</button></div>' +
      '<h3>ロット（残数あり）</h3>' +
      '<div class="tbl-wrap"><table class="tbl"><tr><th>ロット</th><th>期限</th><th class="r">残数</th><th>入荷日</th></tr>' + lotHtml + '</table></div>' +
      '<h3 class="mt14">直近の入出庫</h3>' +
      '<div class="tbl-wrap"><table class="tbl"><tr><th>日時</th><th>数量</th><th>担当/患者</th></tr>' + txHtml + '</table></div>' +
      '<h3 class="mt14">マスタ項目</h3>' +
      '<table class="tbl">' +
      '<tr><td class="muted">レセ電コード</td><td>' + (m.rezeptCode || '未設定') + '</td></tr>' +
      '<tr><td class="muted">厚労省正式名</td><td>' + U.esc(m.officialName || '未紐付け') + '</td></tr>' +
      '<tr><td class="muted">入数/ロット</td><td>' + (m.packSize || '未設定') + '</td></tr>' +
      '<tr><td class="muted">仕入単価/ロット</td><td>' + (m.costPerPack !== null ? U.YEN(m.costPerPack) : '未設定') + '</td></tr>' +
      '<tr><td class="muted">仕入先</td><td>' + U.esc(m.supplierName || '未設定') + '</td></tr>' +
      '<tr><td class="muted">出庫で在庫を減らす</td><td>' + (m.stockUntracked ? 'いいえ（記録のみ）' : 'はい') + '</td></tr>' +
      '</table>';
    document.getElementById('dr-to-st').addEventListener('click', function () {
      closeDrawer(); P8.nav('stocktake', { focus: m.code });
    });
    document.getElementById('dr-to-od').addEventListener('click', function () {
      closeDrawer(); P8.nav('order', { add: m.code });
    });
    document.getElementById('dr-to-dsp').addEventListener('click', function () {
      P8.screens.dispense.addByCode(m.code);
      closeDrawer(); P8.nav('dispense');
    });
  }
  function closeDrawer() { document.getElementById('drawer').classList.remove('show'); }

  P8.screens = P8.screens || {};
  P8.screens.stock = {
    show: function (params) {
      U = P8.util;
      if (params && params.filter === 'low') { /* 予備: フィルタ引き継ぎ */ }
      render();
    },
    hide: function () { closeDrawer(); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    document.getElementById('stock-search').addEventListener('input', function () {
      search = this.value.trim(); render();
    });
    document.querySelectorAll('#stock-cat-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        catFilter = c.getAttribute('data-cat');
        if (catFilter !== '小児') {
          weightFilter = '';
          document.querySelectorAll('#stock-weight-chips .chip').forEach(function (x) { x.classList.remove('on'); });
        }
        document.querySelectorAll('#stock-cat-chips .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        render();
      });
    });
    document.querySelectorAll('#stock-weight-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        weightFilter = c.getAttribute('data-w');
        document.querySelectorAll('#stock-weight-chips .chip').forEach(function (x) { x.classList.toggle('on', x === c && !!weightFilter); });
        if (weightFilter) {
          catFilter = '小児';
          document.querySelectorAll('#stock-cat-chips .chip').forEach(function (x) {
            x.classList.toggle('on', x.getAttribute('data-cat') === '小児');
          });
        }
        render();
      });
    });
    // 表の行クリック→ドロワー / ヘッダクリック→ソート
    document.getElementById('stock-table').addEventListener('click', function (e) {
      var th = e.target.closest('th.sortable');
      if (th) {
        var k = th.getAttribute('data-k');
        if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = true; }
        render();
        return;
      }
      var tr = e.target.closest('tr.clickable');
      if (tr) openDrawer(tr.getAttribute('data-code'));
    });
    // モバイルカード: タップで複数選択
    document.getElementById('stock-cards').addEventListener('click', function (e) {
      var card = e.target.closest('.stock-card');
      if (!card) return;
      var code = card.getAttribute('data-code');
      if (selected.has(code)) selected.delete(code); else selected.add(code);
      card.classList.toggle('checked', selected.has(code));
      updateMultiBar();
    });
    document.getElementById('btn-multi-dispense').addEventListener('click', function () {
      if (!selected.size) return;
      selected.forEach(function (code) { P8.screens.dispense.addByCode(code); });
      P8.ui.toast(selected.size + '件を出庫リストに追加しました', 'success');
      selected.clear();
      P8.nav('dispense');
    });
    document.getElementById('btn-multi-clear').addEventListener('click', function () {
      selected.clear(); render();
    });
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  });
})();
