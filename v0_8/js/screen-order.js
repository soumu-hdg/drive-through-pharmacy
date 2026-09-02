/* =========================================================
   v0.8 screen-order.js ― 発注（scr-order）＋入荷・受入（scr-receive）
   発注リスト(v_reorder) / 発注書 draft→sent→partial→received /
   受入表 → rpc/pharmacy_receive_order / 個別入荷（簡易入庫モードあり）/
   期限の年月4桁入力 / 期限未登録ロットの後追い
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  // ============================ 発注 ============================
  var odFilter = 'alert';
  var odCart = {};   // code → packs

  var ST_LABEL = { draft: '下書き', sent: '発注済', partial: '一部受入', received: '受入済', cancelled: '取消' };
  var ST_CLS = { draft: 'ghost', sent: 'amber', partial: 'amber', received: 'teal', cancelled: 'ghost' };

  function odBadge(r) {
    if (r.status === 'out_of_stock') return '<span class="bdg red">在庫切れ</span> ';
    if (r.status === 'runs_out_soon') return '<span class="bdg amber">まもなく切れる</span> ';
    if (r.status === 'below_threshold') return '<span class="bdg amber">発注点割れ</span> ';
    if (r.status === 'not_stocked') return '<span class="bdg ghost">未仕入</span> ';
    if (r.status === 'untracked') return '<span class="bdg ghost">在庫非管理</span> ';
    return '';
  }

  function odRender() {
    var rows = P8.store.reorder;
    var list = rows.filter(function (r) {
      if (odFilter === 'all') return true;
      if (odFilter === 'notstocked') return r.status === 'not_stocked';
      return ['out_of_stock', 'below_threshold', 'runs_out_soon'].indexOf(r.status) >= 0;
    });
    var n = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
    document.getElementById('od-summary').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">在庫切れ</div><div class="kpi-value' + (n('out_of_stock') ? ' warn' : '') + '">' + n('out_of_stock') + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">発注点割れ</div><div class="kpi-value">' + n('below_threshold') + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">30日以内に切れる</div><div class="kpi-value">' + n('runs_out_soon') + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">未仕入（登録のみ）</div><div class="kpi-value">' + n('not_stocked') + '</div></div>';
    document.getElementById('od-list').innerHTML = list.length ? list.map(function (r) {
      var cls = r.status === 'out_of_stock' ? 'alert' : (r.status === 'below_threshold' || r.status === 'runs_out_soon' ? 'soon' : '');
      var packs = odCart[r.code] !== undefined ? odCart[r.code] : (r.suggest_packs || (r.status === 'out_of_stock' ? 1 : 0));
      return '<div class="od-row ' + cls + '">' +
        '<input type="checkbox" ' + (odCart[r.code] !== undefined ? 'checked' : '') + ' data-act="toggle" data-code="' + U.esc(r.code) + '" style="width:20px;height:20px;accent-color:var(--act);margin-top:3px">' +
        '<div class="grow"><div class="od-name">' + odBadge(r) + U.esc(r.name) + '</div>' +
        '<div class="od-sub">在庫 <b>' + r.current_stock + '</b>' + U.esc(r.unit || '') + '（発注点 ' + r.threshold + '）' +
        (r.daily_usage > 0 ? '／1日 ' + r.daily_usage + U.esc(r.unit || '') + '消費' : '／消費実績なし') +
        (r.days_left != null ? '／残り <b>' + r.days_left + '日</b>' : '') + '<br>' +
        U.esc(r.supplier_name || '仕入先未設定') +
        (r.pack_size ? '／1ロット ' + r.pack_size + U.esc(r.unit || '') : '') +
        (r.cost_per_pack ? '／' + U.YEN(r.cost_per_pack) + '/ロット' : '') + '</div></div>' +
        '<div style="text-align:center"><input type="number" class="od-packs" min="0" step="1" value="' + packs + '" data-act="packs" data-code="' + U.esc(r.code) + '">' +
        '<div style="font-size:10px;color:var(--ink-sub)">ロット</div></div>' +
        '</div>';
    }).join('') : '<div class="muted" style="padding:14px">該当なし</div>';
    odRenderCart();
  }

  function odCartItems() {
    return Object.keys(odCart).map(function (code) {
      var r = P8.store.reorder.find(function (x) { return x.code === code; }) || {};
      var packs = odCart[code];
      return {
        code: code, name: r.name, supplier: r.supplier_name || '未設定', supplier_id: r.supplier_id,
        packs: packs, qty: (r.pack_size || 0) * packs, unit: r.unit, cost_per_pack: r.cost_per_pack,
        amount: (r.cost_per_pack || 0) * packs
      };
    });
  }

  function odRenderCart() {
    var items = odCartItems();
    var el = document.getElementById('od-cart');
    if (!items.length) { el.innerHTML = '発注リストからチェックすると、ここに集計されます。'; return; }
    var bySup = {};
    items.forEach(function (i) { (bySup[i.supplier] = bySup[i.supplier] || []).push(i); });
    var total = items.reduce(function (s, i) { return s + i.amount; }, 0);
    el.innerHTML = Object.keys(bySup).map(function (sup) {
      return '<div class="mb8"><div style="font-weight:700;border-bottom:2px solid var(--ink);padding-bottom:3px;margin-bottom:5px">' + U.esc(sup) + '</div>' +
        bySup[sup].map(function (i) {
          return '<div style="display:flex;justify-content:space-between;padding:3px 0"><span>' + U.esc(i.name) + ' × ' + i.packs +
            'ロット<span class="muted">（' + i.qty + U.esc(i.unit || '') + '）</span></span><span class="num">' +
            (i.cost_per_pack ? U.YEN(i.amount) : '—') + '</span></div>';
        }).join('') + '</div>';
    }).join('') +
      '<div style="display:flex;justify-content:space-between;border-top:2px solid var(--ink);padding-top:6px;font-weight:700"><span>合計 ' +
      items.length + '品目</span><span>' + U.YEN(total) + '</span></div>';
  }

  async function odMakeOrder() {
    var items = odCartItems();
    if (!items.length) { P8.ui.toast('発注する品目を選んでください', 'error'); return; }
    var btn = document.getElementById('od-make');
    P8.ui.busy(btn, 'busy');
    try {
      var bySup = {};
      items.forEach(function (i) { (bySup[i.supplier_id || 'none'] = bySup[i.supplier_id || 'none'] || []).push(i); });
      var d = U.todayJst().replace(/-/g, '');
      var made = 0;
      for (var sid in bySup) {
        var order = await P8.db.write('pharmacy_orders', 'POST', {
          order_no: 'PO-' + d + '-' + (++made) + '-' + Math.random().toString(36).slice(2, 5),
          supplier_id: sid === 'none' ? null : Number(sid),
          ordered_on: U.todayJst(), status: 'draft'
        });
        if (!order || !order.length) throw new Error('発注書の保存結果を確認できません');
        var oid = order[0].id;
        var oi = await P8.db.write('pharmacy_order_items', 'POST', bySup[sid].map(function (i) {
          return { order_id: oid, medicine_code: i.code, pack_count: i.packs, qty: i.qty, unit_cost: i.cost_per_pack, amount: i.amount };
        }));
        if (!oi || oi.length !== bySup[sid].length) throw new Error('発注明細の保存結果を確認できません');
      }
      P8.ui.busy(btn, 'done');
      P8.ui.toast('発注書を ' + made + ' 件保存しました（下書き）', 'success');
      odCart = {};
      odRender();
      loadPoList();
    } catch (e) {
      console.error('order error:', e.body || e.message);
      P8.ui.toast('発注書の保存に失敗しました', 'error');
    } finally {
      setTimeout(function () { P8.ui.busy(btn, null); }, 900);
    }
  }

  function odExportCsv() {
    var items = odCartItems();
    if (!items.length) { P8.ui.toast('発注する品目を選んでください', 'error'); return; }
    var head = ['仕入先', '薬品コード', '薬品名', 'ロット数', '数量', '単位', 'ロット単価', '金額'];
    var body = items.map(function (i) { return [i.supplier, i.code, i.name, i.packs, i.qty, i.unit || '', i.cost_per_pack == null ? '' : i.cost_per_pack, i.amount || '']; });
    var csv = '﻿' + [head].concat(body).map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = '発注書_' + U.todayJst() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- 発注書一覧 ----
  async function loadPoList() {
    var el = document.getElementById('od-po-list');
    var orders = await P8.db.get('pharmacy_orders?select=id,order_no,ordered_on,status,note,pharmacy_suppliers(name),pharmacy_order_items(id,medicine_code,pack_count,qty,unit_cost,amount,received_qty)&order=ordered_on.desc,id.desc&limit=30');
    if (!orders) { el.innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    if (!orders.length) { el.innerHTML = '<span class="muted">発注書はまだありません</span>'; return; }
    el.innerHTML = orders.map(function (o) {
      var items = o.pharmacy_order_items || [];
      var amount = items.reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0);
      var btns = '';
      if (o.status === 'draft') {
        btns = '<button class="btn act sm" data-act="sent" data-id="' + o.id + '">発注した</button> ' +
          '<button class="btn ghost sm" data-act="cancel" data-id="' + o.id + '">取消</button>';
      } else if (o.status === 'sent' || o.status === 'partial') {
        btns = '<button class="btn act sm" data-act="receive" data-id="' + o.id + '">受け入れる</button>';
      }
      return '<div class="od-row"><div class="grow">' +
        '<div class="od-name"><span class="bdg ' + (ST_CLS[o.status] || 'ghost') + '">' + (ST_LABEL[o.status] || o.status) + '</span> ' +
        U.esc(o.order_no) + '</div>' +
        '<div class="od-sub">' + U.esc((o.pharmacy_suppliers && o.pharmacy_suppliers.name) || '仕入先未設定') + ' ｜ ' +
        items.length + '品目 ' + U.YEN(amount) + ' ｜ ' + o.ordered_on + '</div></div>' +
        '<div style="white-space:nowrap">' + btns + '</div></div>';
    }).join('');
  }

  async function poSetStatus(id, status, confirmMsg) {
    if (confirmMsg) {
      var ok = await P8.ui.modal({ title: '確認', bodyHTML: '<p>' + confirmMsg + '</p>', okText: 'はい', danger: status === 'cancelled' });
      if (!ok) return;
    }
    try {
      var res = await P8.db.write('pharmacy_orders?id=eq.' + id, 'PATCH', { status: status });
      if (!res || !res.length) throw new Error('no rows');
      P8.ui.toast('発注書を「' + ST_LABEL[status] + '」にしました', 'success');
      loadPoList();
    } catch (e) { P8.ui.toast('更新に失敗しました', 'error'); }
  }

  // ============================ 入荷・受入 ============================
  var rcvOrder = null;   // 受入中の発注書 {order, items}

  async function openReceive(orderId) {
    var orders = await P8.db.get('pharmacy_orders?id=eq.' + orderId + '&select=id,order_no,ordered_on,status,pharmacy_suppliers(name),pharmacy_order_items(id,medicine_code,pack_count,qty,unit_cost,received_qty)');
    if (!orders || !orders.length) { P8.ui.toast('発注書を読み込めませんでした', 'error'); return; }
    rcvOrder = orders[0];
    var panel = document.getElementById('rcv-order-panel');
    panel.hidden = false;
    document.getElementById('rcv-order-title').innerHTML =
      '発注書 <b>' + U.esc(rcvOrder.order_no) + '</b>（' + U.esc((rcvOrder.pharmacy_suppliers && rcvOrder.pharmacy_suppliers.name) || '仕入先未設定') +
      ' ｜ ' + rcvOrder.ordered_on + ' ' + (ST_LABEL[rcvOrder.status] || '') + '）を受け入れます';
    var thead = '<tr><th>薬品名</th><th class="r">発注</th><th class="r">受入済</th><th class="r">今回受入</th><th class="r">期限(年月4桁)</th><th>ロット番号</th><th></th></tr>';
    var body = (rcvOrder.pharmacy_order_items || []).map(function (it, i) {
      var m = P8.store.findByCode(it.medicine_code);
      var remaining = Math.max(0, (it.qty || 0) - (it.received_qty || 0));
      return '<tr>' +
        '<td>' + U.esc(m ? m.name : it.medicine_code) + '</td>' +
        '<td class="r">' + it.pack_count + 'ロット(' + it.qty + (m ? U.esc(m.unit) : '') + ')</td>' +
        '<td class="r">' + (it.received_qty || 0) + '</td>' +
        '<td class="r"><input class="rcv-qty" data-item="' + it.id + '" inputmode="numeric" value="' + remaining + '"></td>' +
        '<td class="r"><input class="rcv-exp" data-item="' + it.id + '" inputmode="numeric" maxlength="4" placeholder="2807"></td>' +
        '<td><input class="rcv-lot" data-item="' + it.id + '" placeholder="任意"></td>' +
        '<td><button class="btn ghost sm" data-act="copy-exp" data-i="' + i + '" title="下の行に同じ期限を適用">↓期限</button></td>' +
        '</tr>';
    }).join('');
    document.getElementById('rcv-order-table').innerHTML = thead + body;
    var dt = document.getElementById('rcv-date');
    if (!dt.value) dt.value = U.todayJst();
    panel.scrollIntoView({ block: 'start' });
  }

  async function confirmReceive() {
    if (!rcvOrder) return;
    var rows = [];
    var expiryErrs = [];
    (rcvOrder.pharmacy_order_items || []).forEach(function (it) {
      var qty = parseInt((document.querySelector('.rcv-qty[data-item="' + it.id + '"]') || {}).value, 10) || 0;
      if (qty <= 0) return;
      var exp4 = (document.querySelector('.rcv-exp[data-item="' + it.id + '"]') || {}).value || '';
      var expiry = U.parseYm4(exp4);
      if (exp4.trim() && !expiry) {
        var m = P8.store.findByCode(it.medicine_code);
        expiryErrs.push(m ? m.name : it.medicine_code);
      }
      var lot = ((document.querySelector('.rcv-lot[data-item="' + it.id + '"]') || {}).value || '').trim() || null;
      rows.push({ item_id: it.id, qty: qty, expiry_on: expiry, lot_no: lot });
    });
    if (expiryErrs.length) {
      P8.ui.toast('期限の4桁が不正です（' + expiryErrs.join('、') + '）。例: 2807 = 2028年7月', 'error');
      return;
    }
    if (!rows.length) { P8.ui.toast('受入数が入力されていません', 'error'); return; }
    var operator = document.getElementById('rcv-operator').value || null;
    var receivedOn = document.getElementById('rcv-date').value || U.todayJst();
    var body = '<p>' + rows.length + '品目を受け入れ、在庫に反映します。</p>' +
      '<div class="tbl-wrap"><table class="tbl"><tr><th>薬品名</th><th class="r">受入数</th><th>期限</th></tr>' +
      rows.map(function (r) {
        var it = rcvOrder.pharmacy_order_items.find(function (x) { return x.id === r.item_id; });
        var m = P8.store.findByCode(it.medicine_code);
        return '<tr><td>' + U.esc(m ? m.name : it.medicine_code) + '</td><td class="r">' + r.qty + '</td><td>' + (r.expiry_on || '<span class="muted">未登録</span>') + '</td></tr>';
      }).join('') + '</table></div>';
    var ok = await P8.ui.modal({ title: '受入の確定', bodyHTML: body, okText: '受け入れて在庫に反映' });
    if (!ok) return;
    var btn = document.getElementById('rcv-confirm');
    P8.ui.busy(btn, 'busy');
    try {
      var res = await P8.db.rpc('pharmacy_receive_order', {
        _order_id: rcvOrder.id, _received_on: receivedOn, _operator: operator, _rows: rows
      });
      if (!res || typeof res.received_items !== 'number') throw new Error('受入結果を確認できません');
      P8.ui.busy(btn, 'done');
      P8.ui.toast(res.order_status === 'received'
        ? res.received_items + '品目を受け入れました。発注書は「受入済」になりました'
        : res.received_items + '品目を受け入れ、「一部受入」として保存しました', 'success');
      rcvOrder = null;
      document.getElementById('rcv-order-panel').hidden = true;
      await P8.store.refresh();
      renderReceive();
    } catch (e) {
      console.error('receive error:', e.body || e.message);
      P8.ui.toast('受入に失敗しました: ' + e.message, 'error');
    } finally {
      setTimeout(function () { P8.ui.busy(btn, null); }, 900);
    }
  }

  // ---- 受入待ち一覧（入荷画面） ----
  async function loadWaitList() {
    var el = document.getElementById('rcv-wait-list');
    var orders = await P8.db.get('pharmacy_orders?status=in.(sent,partial)&select=id,order_no,ordered_on,status,pharmacy_suppliers(name),pharmacy_order_items(id,qty,received_qty,amount)&order=ordered_on.desc&limit=20');
    if (!orders) { el.innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    if (!orders.length) { el.innerHTML = '<span class="muted">受入待ちの発注書はありません（発注画面で「発注した」にすると、ここに出ます）</span>'; return; }
    el.innerHTML = orders.map(function (o) {
      var items = o.pharmacy_order_items || [];
      var amount = items.reduce(function (s, i) { return s + (Number(i.amount) || 0); }, 0);
      return '<div class="od-row"><div class="grow">' +
        '<div class="od-name"><span class="bdg ' + ST_CLS[o.status] + '">' + ST_LABEL[o.status] + '</span> ' + U.esc(o.order_no) + '</div>' +
        '<div class="od-sub">' + U.esc((o.pharmacy_suppliers && o.pharmacy_suppliers.name) || '仕入先未設定') + ' ｜ ' + items.length + '品目 ' + U.YEN(amount) + ' ｜ ' + o.ordered_on + '</div></div>' +
        '<button class="btn act sm" data-act="receive" data-id="' + o.id + '">受け入れる</button></div>';
    }).join('');
  }

  // ---- 個別入荷（v0.7 rc系の移植・期限4桁化・簡易入庫モード） ----
  var rcTarget = null;

  function rcSimple() { return document.getElementById('rc-simple-mode').checked; }

  function rcRenderCandidates() {
    var q = (document.getElementById('rc-search').value || '').trim().toLowerCase();
    var box = document.getElementById('rc-candidates');
    if (!q) { box.innerHTML = ''; return; }
    var hits = P8.store.stock.filter(function (m) {
      return m.name.toLowerCase().indexOf(q) >= 0 || String(m.code).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 20);
    box.innerHTML = hits.length ? hits.map(function (m) {
      return '<div class="dm-hit" data-code="' + U.esc(m.code) + '"><b>' + U.esc(m.name) + '</b>' +
        '<div class="sub">' + U.esc(m.code) + ' ｜ 在庫 ' + m.stock + U.esc(m.unit) + ' ｜ 入数 ' + (m.packSize || '—') +
        ' ｜ 仕入 ' + (m.costPerPack != null ? U.YEN(m.costPerPack) : '未設定') + '</div></div>';
    }).join('') : '<div class="muted" style="padding:6px">該当なし</div>';
  }

  function rcSelect(code) {
    rcTarget = P8.store.findByCode(code);
    if (!rcTarget) return;
    document.getElementById('rc-candidates').innerHTML = '';
    document.getElementById('rc-search').value = '';
    var sel = document.getElementById('rc-selected');
    sel.hidden = false;
    sel.innerHTML = '<div class="panel plain" style="margin-bottom:0"><b>' + U.esc(rcTarget.name) + '</b>' +
      '<div class="muted">' + U.esc(rcTarget.code) + ' ｜ 現在庫 ' + rcTarget.stock + U.esc(rcTarget.unit) +
      ' ｜ 入数 ' + (rcTarget.packSize || '未設定') + '</div>' +
      '<button class="btn ghost sm mt8" id="rc-clear">選び直す</button></div>';
    document.getElementById('rc-clear').addEventListener('click', rcClear);
    document.getElementById('rc-form').hidden = false;
    document.getElementById('rc-unit').textContent = rcTarget.unit || '単位';
    if (rcTarget.supplierId) document.getElementById('rc-supplier').value = String(rcTarget.supplierId);
    if (rcTarget.costPerPack != null) document.getElementById('rc-cost').value = rcTarget.costPerPack;
    var dt = document.getElementById('rc-date');
    if (!dt.value) dt.value = U.todayJst();
    document.getElementById('rc-packs').value = 1;
    rcApplyMode();
    rcSync('packs');
  }
  function rcClear() {
    rcTarget = null;
    document.getElementById('rc-selected').hidden = true;
    document.getElementById('rc-form').hidden = true;
  }
  function rcApplyMode() {
    var simple = rcSimple();
    document.querySelectorAll('#rc-form .rc-lotinfo').forEach(function (el) { el.style.display = simple ? 'none' : ''; });
    document.getElementById('rc-submit').textContent = simple ? '📥 数だけ足す（簡易入庫）' : '📥 入荷を登録して在庫に反映';
  }
  function rcSync(from) {
    if (!rcTarget) return;
    var ps = Number(rcTarget.packSize) || 0;
    var packsEl = document.getElementById('rc-packs');
    var qtyEl = document.getElementById('rc-qty');
    if (from === 'packs' && ps > 0) qtyEl.value = Math.round((Number(packsEl.value) || 0) * ps);
    if (from === 'qty' && ps > 0) packsEl.value = +((Number(qtyEl.value) || 0) / ps).toFixed(2);
    var qty = Number(qtyEl.value) || 0;
    var cost = Number(document.getElementById('rc-cost').value);
    var unitCost = ps > 0 && cost ? cost / ps : (rcTarget.costPerUnit != null ? rcTarget.costPerUnit : null);
    document.getElementById('rc-preview').innerHTML =
      '在庫 <b>' + rcTarget.stock + '</b> → <b>' + (rcTarget.stock + qty) + '</b> ' + U.esc(rcTarget.unit) +
      (unitCost != null ? '　／　1' + U.esc(rcTarget.unit) + 'あたり原価 <b>¥' + unitCost.toFixed(2) + '</b>' : '') +
      (unitCost != null ? '　／　入荷金額 <b>' + U.YEN(unitCost * qty) + '</b>' : '');
  }
  async function rcSubmit() {
    if (!rcTarget) return;
    var qty = parseInt(document.getElementById('rc-qty').value, 10) || 0;
    if (qty <= 0) { P8.ui.toast('数量を入力してください', 'error'); return; }
    var simple = rcSimple();
    var supplierId = document.getElementById('rc-supplier').value || null;
    var costPack = parseFloat(document.getElementById('rc-cost').value);
    var ps = Number(rcTarget.packSize) || 0;
    var unitCost = (ps > 0 && costPack) ? +(costPack / ps).toFixed(4) : (rcTarget.costPerUnit != null ? rcTarget.costPerUnit : null);
    var receivedOn = document.getElementById('rc-date').value || U.todayJst();
    var operator = document.getElementById('rc-op').value || null;
    var expiry = null;
    if (!simple) {
      var e4 = document.getElementById('rc-expiry4').value.trim();
      var eDate = document.getElementById('rc-expiry-date').value;
      if (eDate) expiry = eDate;
      else if (e4) {
        expiry = U.parseYm4(e4);
        if (!expiry) { P8.ui.toast('期限の4桁が不正です。例: 2807 = 2028年7月', 'error'); return; }
      }
    }
    var lotNo = simple ? null : (document.getElementById('rc-lot').value.trim() || null);

    var ok = await P8.ui.modal({
      title: simple ? '簡易入庫の確認' : '入荷登録の確認',
      bodyHTML: '<p><b>' + U.esc(rcTarget.name) + '</b> を ' + qty + U.esc(rcTarget.unit) + ' ' + (simple ? '入庫' : '入荷登録') + 'します。<br>在庫 ' +
        rcTarget.stock + ' → <b>' + (rcTarget.stock + qty) + '</b> になります。' +
        (simple ? '<br><span class="muted">簡易入庫はロット・期限を記録しません。</span>' : (expiry ? '<br>使用期限: ' + expiry : '')) + '</p>',
      okText: simple ? '入庫する' : '入荷を登録'
    });
    if (!ok) return;

    var btn = document.getElementById('rc-submit');
    P8.ui.busy(btn, 'busy');
    try {
      var lotId = null;
      if (!simple) {
        var lot = await P8.db.write('pharmacy_lots', 'POST', {
          medicine_code: rcTarget.code, lot_no: lotNo, expiry_on: expiry,
          received_on: receivedOn, qty_received: qty, qty_remaining: qty,
          pack_count: ps > 0 ? +(qty / ps).toFixed(2) : null,
          unit_cost: unitCost, supplier_id: supplierId ? Number(supplierId) : null,
          note: operator ? '担当:' + operator : null, source: 'app'
        });
        if (!lot || !lot.length) throw new Error('ロット登録の結果を確認できません');
        lotId = lot[0].id;
      }
      var tx = await P8.db.write('pharmacy_transactions', 'POST', {
        medicine_code: rcTarget.code, transaction_type: 'in', quantity: qty,
        note: simple ? '簡易入庫' : '入荷', occurred_on: receivedOn,
        unit_cost: unitCost, supplier_id: supplierId ? Number(supplierId) : null,
        lot_id: lotId, operator: operator, source: 'app'
      });
      if (!tx || !tx.length) throw new Error('入庫記録の結果を確認できません');
      var patch = { current_stock: rcTarget.stock + qty, last_updated: new Date().toISOString() };
      if (!simple && costPack && rcTarget.costPerPack == null) patch.cost_per_pack = costPack;
      if (!simple && supplierId && !rcTarget.supplierId) patch.supplier_id = Number(supplierId);
      var pm = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(rcTarget.code), 'PATCH', patch);
      if (!pm || !pm.length) throw new Error('在庫更新の結果を確認できません');
      P8.ui.busy(btn, 'done');
      P8.ui.toast(rcTarget.name + ' を ' + qty + rcTarget.unit + ' ' + (simple ? '入庫' : '入荷') + 'しました', 'success');
      rcClear();
      await P8.store.refresh();
      renderReceive();
    } catch (e) {
      console.error('rc error:', e.body || e.message);
      P8.ui.toast('登録に失敗しました: ' + e.message, 'error');
    } finally {
      setTimeout(function () { P8.ui.busy(btn, null); }, 900);
    }
  }

  // ---- 期限アラート＆期限未登録ロット ----
  async function loadExpiryLists() {
    var alertRows = await P8.db.get('pharmacy_v_expiry?status=in.(expired,soon)&select=medicine_code,name,lot_no,expiry_on,qty_remaining,days_to_expiry,status&order=expiry_on.asc&limit=20');
    var el = document.getElementById('rc-expiry-list');
    if (!alertRows) el.innerHTML = '<span class="muted">読み込みに失敗しました</span>';
    else if (!alertRows.length) el.innerHTML = '<span class="muted">期限が近いロットはありません</span>';
    else el.innerHTML = alertRows.map(function (r) {
      return '<div style="padding:5px 0;border-bottom:1px solid var(--line)">' +
        '<span class="bdg ' + (r.status === 'expired' ? 'red' : 'amber') + '">' + (r.status === 'expired' ? '期限切れ' : 'あと' + r.days_to_expiry + '日') + '</span> ' +
        '<b>' + U.esc(r.name) + '</b> 残' + r.qty_remaining + '　<span class="muted">' + r.expiry_on + (r.lot_no ? '　Lot:' + U.esc(r.lot_no) : '') + '</span></div>';
    }).join('');

    var noExp = await P8.db.get('pharmacy_lots?expiry_on=is.null&qty_remaining=gt.0&select=id,medicine_code,lot_no,qty_remaining,received_on&order=received_on.desc&limit=40');
    var el2 = document.getElementById('rc-nolots');
    if (!noExp) { el2.innerHTML = '<span class="muted">読み込みに失敗しました</span>'; return; }
    if (!noExp.length) { el2.innerHTML = '<span class="muted">期限未登録のロットはありません 🎉</span>'; return; }
    var total = P8.store.noExpiryCount;
    el2.innerHTML = (total > noExp.length ? '<div class="muted mb8">全' + total + '件のうち新しい' + noExp.length + '件を表示</div>' : '') +
      noExp.map(function (l) {
        var m = P8.store.findByCode(l.medicine_code);
        return '<div class="flex" style="padding:4px 0;border-bottom:1px solid var(--line)">' +
          '<span class="grow"><b>' + U.esc(m ? m.name : l.medicine_code) + '</b> <span class="muted">残' + l.qty_remaining + ' ｜ 入荷 ' + l.received_on + (l.lot_no ? ' ｜ Lot:' + U.esc(l.lot_no) : '') + '</span></span>' +
          '<input class="rcv-exp" data-lot="' + l.id + '" inputmode="numeric" maxlength="4" placeholder="2807">' +
          '<button class="btn ghost sm" data-act="save-exp" data-lot="' + l.id + '">保存</button></div>';
      }).join('');
  }

  async function saveLotExpiry(lotId) {
    var inp = document.querySelector('.rcv-exp[data-lot="' + lotId + '"]');
    var expiry = U.parseYm4(inp.value);
    if (!expiry) { P8.ui.toast('期限の4桁が不正です。例: 2807 = 2028年7月', 'error'); return; }
    try {
      var res = await P8.db.write('pharmacy_lots?id=eq.' + lotId, 'PATCH', { expiry_on: expiry });
      if (!res || !res.length) throw new Error('no rows');
      P8.ui.toast('使用期限 ' + expiry + ' を登録しました', 'success');
      await P8.store.loadNoExpiryCount();
      loadExpiryLists();
    } catch (e) { P8.ui.toast('保存に失敗しました', 'error'); }
  }

  function renderReceive() {
    loadWaitList();
    loadExpiryLists();
  }

  // ============================ 画面登録 ============================
  P8.screens = P8.screens || {};
  P8.screens.order = {
    show: function (params) {
      U = P8.util;
      if (params && params.add) {
        var r = P8.store.reorder.find(function (x) { return x.code === params.add; });
        odCart[params.add] = (r && r.suggest_packs) || 1;
        P8.ui.toast('発注リストに追加しました', 'success');
      }
      if (params && params.filter === 'alert') odFilter = 'alert';
      P8.store.loadReorder().then(odRender);
      odRender();
      loadPoList();
    },
    hide: function () {}
  };
  P8.screens.receive = {
    show: function (params) {
      U = P8.util;
      var dt = document.getElementById('rc-date');
      if (!dt.value) dt.value = U.todayJst();
      if (params && params.simple) {
        document.getElementById('rc-simple-mode').checked = true;
        rcApplyMode();
        document.getElementById('rc-search').focus();
      }
      if (params && params.orderId) openReceive(params.orderId);
      renderReceive();
    },
    hide: function () {}
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    // 発注
    document.querySelectorAll('#od-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        odFilter = c.getAttribute('data-f');
        document.querySelectorAll('#od-chips .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        odRender();
      });
    });
    document.getElementById('od-list').addEventListener('change', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var code = t.getAttribute('data-code');
      if (t.getAttribute('data-act') === 'toggle') {
        if (t.checked) {
          var r = P8.store.reorder.find(function (x) { return x.code === code; });
          odCart[code] = odCart[code] || (r && r.suggest_packs) || 1;
        } else delete odCart[code];
        odRender();
      }
      if (t.getAttribute('data-act') === 'packs') {
        var n = parseInt(t.value, 10) || 0;
        if (n > 0) odCart[code] = n; else delete odCart[code];
        odRenderCart();
      }
    });
    document.getElementById('od-make').addEventListener('click', odMakeOrder);
    document.getElementById('od-csv').addEventListener('click', odExportCsv);
    document.getElementById('od-po-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var act = b.getAttribute('data-act');
      if (act === 'sent') poSetStatus(id, 'sent', 'この発注書を「発注済」にしますか？（発注自体は電話・FAX等で行ってください）');
      if (act === 'cancel') poSetStatus(id, 'cancelled', 'この発注書を取り消しますか？');
      if (act === 'receive') P8.nav('receive', { orderId: Number(id) });
    });
    // 入荷: 受入待ち
    document.getElementById('rcv-wait-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="receive"]');
      if (b) openReceive(Number(b.getAttribute('data-id')));
    });
    // 受入表: 「↓期限」= その行の期限を以降の行にコピー
    document.getElementById('rcv-order-table').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="copy-exp"]');
      if (!b || !rcvOrder) return;
      var i = parseInt(b.getAttribute('data-i'), 10);
      var items = rcvOrder.pharmacy_order_items || [];
      var src = document.querySelector('.rcv-exp[data-item="' + items[i].id + '"]');
      if (!src || !src.value) { P8.ui.toast('先にこの行の期限を入力してください', 'error'); return; }
      for (var j = i + 1; j < items.length; j++) {
        var dst = document.querySelector('.rcv-exp[data-item="' + items[j].id + '"]');
        if (dst && !dst.value) dst.value = src.value;
      }
    });
    document.getElementById('rcv-confirm').addEventListener('click', confirmReceive);
    document.getElementById('rcv-cancel').addEventListener('click', function () {
      rcvOrder = null;
      document.getElementById('rcv-order-panel').hidden = true;
    });
    // 個別入荷
    document.getElementById('rc-search').addEventListener('input', rcRenderCandidates);
    document.getElementById('rc-candidates').addEventListener('click', function (e) {
      var hit = e.target.closest('.dm-hit');
      if (hit) rcSelect(hit.getAttribute('data-code'));
    });
    document.getElementById('rc-simple-mode').addEventListener('change', rcApplyMode);
    document.getElementById('rc-packs').addEventListener('input', function () { rcSync('packs'); });
    document.getElementById('rc-qty').addEventListener('input', function () { rcSync('qty'); });
    document.getElementById('rc-cost').addEventListener('input', function () { rcSync(); });
    document.getElementById('rc-expiry-detail-link').addEventListener('click', function () {
      var d = document.getElementById('rc-expiry-date');
      d.hidden = !d.hidden;
    });
    document.getElementById('rc-submit').addEventListener('click', rcSubmit);
    // 期限未登録ロット
    document.getElementById('rc-nolots').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="save-exp"]');
      if (b) saveLotExpiry(b.getAttribute('data-lot'));
    });
  });
})();
