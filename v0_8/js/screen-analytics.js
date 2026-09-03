/* =========================================================
   v0.8 screen-analytics.js ― 分析（履歴＋月別消費量の統合）
   履歴: Supabase直読み・編集モード削除（モーダル確認）・患者別グループ
   消費量: 6ヶ月集計＋原価/薬価ベース金額＋月次入荷金額の小計行
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  var sub = 'history';
  var all = [];            // 全履歴
  var filteredRows = [];
  var displayCount = 50;
  var PAGE = 50;
  var viewMode = 'timeline';
  var deleteMode = false;
  var selDel = new Set();
  var loaded = false;

  // ---------- 履歴 ----------
  async function loadHistory() {
    var rows = await P8.db.get('pharmacy_transactions?select=id,medicine_code,transaction_type,quantity,patient_name,operator,note,source,created_at&order=created_at.desc&limit=5000');
    if (!rows) { document.getElementById('hist-list').innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    all = rows.map(function (r) {
      var t = U.sbToJst(r.created_at);
      var m = P8.store.findByCode(r.medicine_code);
      var op = r.operator || ((r.note && /^担当[:：]/.test(r.note)) ? r.note.replace(/^担当[:：]/, '').trim() : '');
      return {
        id: r.id, date: t.date, time: t.time, type: r.transaction_type,
        code: r.medicine_code, medicine: m ? m.name : (r.medicine_code || ''),
        quantity: r.quantity, unit: m ? (m.unit || '') : '',
        patient: r.patient_name || null, operator: op, source: r.source
      };
    });
    loaded = true;
    applyFilter();
  }

  function applyFilter() {
    var q = (document.getElementById('hist-search').value || '').toLowerCase();
    var from = document.getElementById('hist-from').value;
    var to = document.getElementById('hist-to').value;
    filteredRows = all.filter(function (h) {
      if (q && h.medicine.toLowerCase().indexOf(q) < 0 &&
        !(h.patient && h.patient.toLowerCase().indexOf(q) >= 0) &&
        !(h.operator && h.operator.toLowerCase().indexOf(q) >= 0)) return false;
      if (from && h.date < from) return false;
      if (to && h.date > to) return false;
      return true;
    });
    renderHistory();
  }

  function itemHtml(h, idx) {
    var icon = h.type === 'adjust' ? '📝' : h.type === 'in' ? '📥' : '📤';
    var qty = h.type === 'adjust' ? '→' + h.quantity : h.type === 'in' ? '+' + h.quantity : '−' + h.quantity;
    var sel = selDel.has(idx);
    return '<div class="hist-item' + (sel ? ' sel' : '') + '"' + (deleteMode ? ' data-idx="' + idx + '" style="cursor:pointer"' : '') + '>' +
      (deleteMode ? '<input type="checkbox" ' + (sel ? 'checked' : '') + ' data-idx="' + idx + '" style="width:19px;height:19px;accent-color:var(--danger)">' : '') +
      '<div class="hi-icon ' + h.type + '">' + icon + '</div>' +
      '<div class="hi-main"><div class="hi-name">' + U.esc(h.medicine) + '</div>' +
      '<div class="hi-sub">' + h.date + ' ' + h.time + (h.operator ? ' ・ ' + U.esc(h.operator) : '') +
      (h.patient ? ' ・ ' + U.esc(h.patient) : '') + (h.type === 'adjust' ? ' ・ 棚卸修正' : '') +
      (h.source && h.source !== 'app' ? ' ・ <span class="bdg ghost">' + U.esc(h.source) + '</span>' : '') + '</div></div>' +
      '<div class="hi-qty ' + h.type + '">' + qty + U.esc(h.unit) + '</div></div>';
  }

  function renderHistory() {
    var el = document.getElementById('hist-list');
    var bar = document.getElementById('hist-delete-bar');
    bar.innerHTML = (deleteMode && selDel.size)
      ? '<div class="flex mb8" style="justify-content:flex-end"><span class="muted">' + selDel.size + '件選択中</span>' +
      '<button class="btn ghost sm" id="hist-desel">選択解除</button>' +
      '<button class="btn danger sm" id="hist-del">🗑 削除</button></div>' : '';
    if (bar.querySelector('#hist-del')) {
      bar.querySelector('#hist-del').addEventListener('click', deleteSelected);
      bar.querySelector('#hist-desel').addEventListener('click', function () { selDel.clear(); renderHistory(); });
    }
    if (!filteredRows.length) { el.innerHTML = '<div class="muted" style="padding:14px">該当する履歴がありません</div>'; return; }

    if (viewMode === 'patient') {
      var groups = {}, noP = [];
      filteredRows.forEach(function (h, i) {
        h._i = i;
        if (!h.patient) { noP.push(h); return; }
        (groups[h.patient] = groups[h.patient] || []).push(h);
      });
      var keys = Object.keys(groups).sort(function (a, b) {
        return (groups[b][0].date + groups[b][0].time).localeCompare(groups[a][0].date + groups[a][0].time);
      });
      var html = '';
      keys.forEach(function (k) {
        html += '<div class="hist-group"><span>' + U.esc(k) + '</span><span>' + groups[k].length + '件</span></div>';
        html += groups[k].map(function (h) { return itemHtml(h, h._i); }).join('');
      });
      if (noP.length) {
        html += '<div class="hist-group"><span>入庫・棚卸（患者なし）</span><span>' + noP.length + '件</span></div>';
        html += noP.map(function (h) { return itemHtml(h, h._i); }).join('');
      }
      html += '<div class="muted" style="text-align:center;padding:10px">全 ' + filteredRows.length + ' 件</div>';
      el.innerHTML = html;
    } else {
      var showing = Math.min(displayCount, filteredRows.length);
      var html2 = filteredRows.slice(0, showing).map(function (h, i) { return itemHtml(h, i); }).join('');
      html2 += '<div class="muted" style="text-align:center;padding:10px">' + showing + ' / ' + filteredRows.length + ' 件表示';
      if (showing < filteredRows.length) html2 += ' <button class="btn ghost sm" id="hist-more">さらに読み込む</button>';
      html2 += '</div>';
      el.innerHTML = html2;
      var more = document.getElementById('hist-more');
      if (more) more.addEventListener('click', function () { displayCount += PAGE; renderHistory(); });
    }
  }

  async function deleteSelected() {
    var toDelete = [];
    selDel.forEach(function (i) { if (filteredRows[i]) toDelete.push(filteredRows[i]); });
    if (!toDelete.length) return;
    var body = '<p>選択した ' + toDelete.length + ' 件の履歴を削除します。在庫数も自動調整されます（入庫→在庫減算、出庫→在庫加算。棚卸修正は在庫を戻しません）。</p>' +
      '<div class="tbl-wrap"><table class="tbl">' + toDelete.slice(0, 10).map(function (h) {
        return '<tr><td>' + U.esc(h.medicine) + '</td><td class="muted">' + h.date + '</td><td class="r">' +
          (h.type === 'in' ? '+' : h.type === 'out' ? '−' : '→') + h.quantity + '</td></tr>';
      }).join('') + '</table></div>' + (toDelete.length > 10 ? '<p class="muted">ほか' + (toDelete.length - 10) + '件</p>' : '');
    var ok = await P8.ui.modal({ title: '履歴の削除', bodyHTML: body, okText: '削除する', danger: true });
    if (!ok) return;
    var ids = toDelete.map(function (h) { return h.id; }).filter(function (v) { return v != null; });
    try {
      var del = await P8.db.write('pharmacy_transactions?id=in.(' + ids.join(',') + ')', 'DELETE');
      if (!del || del.length !== ids.length) throw new Error('削除結果が一致しません（' + (del ? del.length : 0) + '/' + ids.length + '）');
      // 在庫の巻き戻し（外用＝在庫非管理の出庫は在庫を動かしていないので戻さない）
      for (var i = 0; i < toDelete.length; i++) {
        var h = toDelete[i];
        var m = P8.store.findByCode(h.code);
        if (!m) continue;
        var newStock = null;
        if (h.type === 'in') newStock = (m.stock || 0) - h.quantity;
        else if (h.type === 'out' && !m.stockUntracked) newStock = (m.stock || 0) + h.quantity;
        if (newStock !== null) {
          var res = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(m.code), 'PATCH',
            { current_stock: newStock, last_updated: new Date().toISOString() });
          if (res && res.length) m.stock = newStock;
        }
      }
      P8.ui.toast(ids.length + '件の履歴を削除し、在庫を調整しました', 'success');
    } catch (e) {
      console.error('history delete error:', e.body || e.message);
      P8.ui.toast('削除に失敗しました: ' + e.message, 'error');
    }
    selDel.clear();
    deleteMode = false;
    document.getElementById('hist-edit-btn').textContent = '編集';
    await P8.store.refresh();
    loadHistory();
  }

  // ---------- 月別消費量 ----------
  var csData = null;
  async function loadConsumption() {
    var results = await Promise.all([
      P8.db.get('pharmacy_transactions?select=medicine_code,quantity,created_at&transaction_type=eq.out&order=created_at.asc&limit=20000'),
      P8.db.get('pharmacy_v_monthly_purchase?select=ym,supplier_name,cost_amount&order=ym.asc')
    ]);
    var rows = results[0], purchase = results[1];
    if (!rows) { document.getElementById('cs-table').innerHTML = '<tr><td class="muted">読み込みに失敗しました</td></tr>'; return; }
    var monthSet = new Set();
    rows.forEach(function (r) { monthSet.add(U.sbToJst(r.created_at).date.slice(0, 7)); });
    var months = Array.from(monthSet).sort();
    if (months.length > 6) months = months.slice(-6);
    var shown = new Set(months);
    var byCode = {};
    rows.forEach(function (r) {
      var mo = U.sbToJst(r.created_at).date.slice(0, 7);
      if (!shown.has(mo)) return;
      var c = r.medicine_code;
      if (!byCode[c]) byCode[c] = { monthly: {}, total: 0 };
      byCode[c].monthly[mo] = (byCode[c].monthly[mo] || 0) + (r.quantity || 0);
      byCode[c].total += (r.quantity || 0);
    });
    var purchaseByYm = {};
    (purchase || []).forEach(function (p) {
      var ym = String(p.ym || '').slice(0, 7);
      purchaseByYm[ym] = (purchaseByYm[ym] || 0) + (Number(p.cost_amount) || 0);
    });
    csData = {
      months: months,
      purchaseByYm: purchaseByYm,
      drugs: Object.keys(byCode).map(function (code) {
        var m = P8.store.findByCode(code);
        return {
          code: code, name: m ? m.name : code, stock: m ? (m.stock || 0) : 0,
          costPerUnit: m ? m.costPerUnit : null, price: m ? Number(m.price) || 0 : 0,
          monthly: byCode[code].monthly, total: byCode[code].total
        };
      })
    };
    renderConsumption();
  }

  function renderConsumption() {
    if (!csData) return;
    var months = csData.months;
    var q = (document.getElementById('cs-search').value || '').trim().toLowerCase();
    var sort = document.getElementById('cs-sort').value;
    var list = csData.drugs.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0; });
    if (sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
    else if (sort === 'total-asc') list.sort(function (a, b) { return a.total - b.total; });
    else if (sort === 'stock-asc') list.sort(function (a, b) { return a.stock - b.stock; });
    else list.sort(function (a, b) { return b.total - a.total; });

    var totalQty = list.reduce(function (s, d) { return s + d.total; }, 0);
    var costAmt = list.reduce(function (s, d) { return s + (d.costPerUnit != null ? d.costPerUnit * d.total : 0); }, 0);
    var listAmt = list.reduce(function (s, d) { return s + d.price * d.total; }, 0);
    document.getElementById('cs-summary').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">薬品数</div><div class="kpi-value">' + list.length + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">総消費量</div><div class="kpi-value">' + totalQty + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">消費額（仕入原価）</div><div class="kpi-value">' + U.YEN(costAmt) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">同（薬価ベース）</div><div class="kpi-value">' + U.YEN(listAmt) + '</div></div>';

    var thead = '<tr><th>薬品名</th><th class="r">在庫</th>' +
      months.map(function (m) { return '<th class="r">' + m + '</th>'; }).join('') +
      '<th>推移</th><th class="r">合計</th></tr>';
    var body = list.map(function (d) {
      return '<tr><td style="white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="' + U.esc(d.name) + '">' + U.esc(d.name) + '</td>' +
        '<td class="r' + (d.stock <= 5 ? '" style="color:var(--danger);font-weight:700' : '') + '">' + d.stock + '</td>' +
        months.map(function (m) { return '<td class="r">' + (d.monthly[m] || '-') + '</td>'; }).join('') +
        '<td class="spk-cell">' + P8.ui.spark(months.map(function (m) { return d.monthly[m] || 0; }), 56, 14) + '</td>' +
        '<td class="r" style="font-weight:700">' + d.total + '</td></tr>';
    }).join('');
    // 月次入荷金額の小計行（仕入と消費を同じ画面で見比べる）
    var totalPurchase = months.reduce(function (s, m) { return s + (csData.purchaseByYm[m] || 0); }, 0);
    var purchaseRow = '<tr style="border-top:2px solid var(--line2)"><td style="font-weight:700">📥 月次入荷金額（仕入）</td><td class="r">—</td>' +
      months.map(function (m) {
        return '<td class="r" style="font-weight:700;color:var(--warn)">' + (csData.purchaseByYm[m] ? U.YEN(csData.purchaseByYm[m]) : '-') + '</td>';
      }).join('') +
      '<td class="spk-cell" style="color:var(--warn)">' + P8.ui.spark(months.map(function (m) { return csData.purchaseByYm[m] || 0; }), 56, 14) + '</td>' +
      '<td class="r" style="font-weight:700;color:var(--warn)">' + U.YEN(totalPurchase) + '</td></tr>';
    document.getElementById('cs-table').innerHTML = thead + body + purchaseRow;
  }

  // ---------- サブタブ ----------
  function setSub(name) {
    sub = name;
    document.querySelectorAll('.subtabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-sub') === name);
    });
    document.getElementById('an-history').hidden = name !== 'history';
    document.getElementById('an-consumption').hidden = name !== 'consumption';
    if (name === 'consumption' && !csData) loadConsumption();
    if (name === 'history' && !loaded) loadHistory();
  }

  P8.screens = P8.screens || {};
  P8.screens.analytics = {
    show: function () {
      U = P8.util;
      setSub(sub);
      if (sub === 'history') loadHistory();
    },
    hide: function () {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    document.querySelectorAll('.subtabs button').forEach(function (b) {
      b.addEventListener('click', function () { setSub(b.getAttribute('data-sub')); });
    });
    document.getElementById('hist-search').addEventListener('input', function () { displayCount = PAGE; applyFilter(); });
    document.getElementById('hist-from').addEventListener('change', function () { displayCount = PAGE; applyFilter(); });
    document.getElementById('hist-to').addEventListener('change', function () { displayCount = PAGE; applyFilter(); });
    document.querySelectorAll('#an-history .chip[data-preset]').forEach(function (c) {
      c.addEventListener('click', function () {
        var p = c.getAttribute('data-preset');
        var today = U.todayJst();
        var from = '';
        if (p === 'today') from = today;
        else if (p === 'week') { var d = new Date(); d.setDate(d.getDate() - 7); from = d.toISOString().slice(0, 10); }
        else if (p === 'month') { var d2 = new Date(); d2.setDate(d2.getDate() - 30); from = d2.toISOString().slice(0, 10); }
        document.getElementById('hist-from').value = from;
        document.getElementById('hist-to').value = p === 'all' ? '' : today;
        displayCount = PAGE;
        applyFilter();
      });
    });
    document.querySelectorAll('#an-history .chip[data-view]').forEach(function (c) {
      c.addEventListener('click', function () {
        viewMode = c.getAttribute('data-view');
        document.querySelectorAll('#an-history .chip[data-view]').forEach(function (x) { x.classList.toggle('on', x === c); });
        displayCount = PAGE;
        renderHistory();
      });
    });
    document.getElementById('hist-edit-btn').addEventListener('click', function () {
      deleteMode = !deleteMode;
      selDel.clear();
      this.textContent = deleteMode ? '完了' : '編集';
      renderHistory();
    });
    document.getElementById('hist-list').addEventListener('click', function (e) {
      if (!deleteMode) return;
      var item = e.target.closest('[data-idx]');
      if (!item) return;
      var i = parseInt(item.getAttribute('data-idx'), 10);
      if (selDel.has(i)) selDel.delete(i); else selDel.add(i);
      renderHistory();
    });
    document.getElementById('cs-search').addEventListener('input', renderConsumption);
    document.getElementById('cs-sort').addEventListener('change', renderConsumption);
  });
})();
