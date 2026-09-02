/* =========================================================
   v0.8 screen-dispense.js ― 出庫（夜間モードの主役）
   QR自動起動 / 同一薬は数量集約 / 長押し0.6秒確定 /
   オフラインキュー / 発注点割れ警告
   ========================================================= */
(function () {
  'use strict';
  var U = null, S = null; // P8.util / P8.store（boot後に代入）

  var batch = [];           // [{code, qty}]
  var lastScan = null, cooldown = false;
  var warnShown = {};       // code → 警告行を出したか（1回フェードインの管理）
  var sending = false;

  function med(code) { return P8.store.findByCode(code); }

  // ---- バッチ描画 ----
  function renderBatch(newCode) {
    var list = document.getElementById('batch-list');
    var html = batch.map(function (it, i) {
      var m = med(it.code);
      if (!m) return '';
      var after = m.stockUntracked ? null : (m.stock - it.qty);
      var short = after !== null && after < 0;
      var stockLine = m.stockUntracked
        ? U.esc(m.code) + ' ｜ 在庫非管理（記録のみ）'
        : U.esc(m.code) + ' ｜ 在庫 ' + m.stock + m.unit + ' → <b class="num" data-roll="' + i + '">' + after + '</b>' + U.esc(m.unit);
      return '<div class="batch-row' + (short ? ' short' : '') + (it.code === newCode ? ' enter' : '') + '" data-code="' + U.esc(it.code) + '">' +
        '<div class="bi-name"><b>' + U.esc(m.name) + '</b><span>' + stockLine + '</span></div>' +
        '<div class="bi-ctl">' +
        '<button data-act="dec" data-i="' + i + '" aria-label="減らす">−</button>' +
        '<input class="bi-qty" data-act="qty" data-i="' + i + '" inputmode="numeric" value="' + it.qty + '">' +
        '<button data-act="inc" data-i="' + i + '" aria-label="増やす">＋</button>' +
        '</div>' +
        '<button class="bi-del" data-act="del" data-i="' + i + '" aria-label="削除">✕</button>' +
        '</div>';
    }).join('');
    list.innerHTML = html;
    renderWarns();
    updateCommit();
  }

  // ---- 発注点割れ・切迫の警告行（1回だけフェードイン・点滅しない） ----
  function renderWarns() {
    var box = document.getElementById('low-warns');
    var active = {};
    batch.forEach(function (it) {
      var m = med(it.code);
      if (!m || m.stockUntracked) return;
      var after = m.stock - it.qty;
      var msgs = [];
      if (after < (m.threshold || 0)) {
        msgs.push('⚠ ' + m.name + ' は残り' + Math.max(after, 0) + m.unit + '（発注点' + m.threshold + '）');
      }
      var ro = P8.store.reorder.find(function (r) { return r.code === m.code; });
      if (ro && ro.daily_usage > 0) {
        var days = Math.floor(after / ro.daily_usage);
        if (days >= 0 && days <= 30) msgs.push('今の消費ペースだと約' + days + '日で切れます');
      }
      if (msgs.length) active[it.code] = msgs.join('。');
    });
    // 消えた警告を除去
    Array.prototype.slice.call(box.children).forEach(function (el) {
      var c = el.getAttribute('data-code');
      if (!active[c]) { el.remove(); delete warnShown[c]; }
    });
    // 新規のみ追加（既存はテキスト更新に留め、再アニメーションさせない）
    Object.keys(active).forEach(function (c) {
      var el = box.querySelector('[data-code="' + CSS.escape(c) + '"]');
      if (el) { el.textContent = active[c]; return; }
      el = document.createElement('div');
      el.className = 'warn-line';
      el.setAttribute('data-code', c);
      el.textContent = active[c];
      box.appendChild(el);
      warnShown[c] = true;
    });
  }

  function updateCommit() {
    var btn = document.getElementById('dsp-commit');
    var total = batch.reduce(function (s, it) { return s + it.qty; }, 0);
    btn.disabled = batch.length === 0 || sending;
    document.getElementById('dsp-commit-label').textContent =
      batch.length ? '長押しで出庫を確定（' + batch.length + '品目・' + total + '点）' : '長押しで出庫を確定';
  }

  // ---- 追加（同一薬は集約） ----
  function addByCode(code, silent) {
    var m = med(code);
    if (!m) { P8.ui.toast('未登録の薬品です: ' + code, 'error'); return false; }
    var hit = batch.find(function (it) { return it.code === m.code; });
    if (hit) { hit.qty += 1; renderBatch(); }
    else { batch.push({ code: m.code, qty: 1 }); renderBatch(m.code); }
    if (!silent && navigator.vibrate) navigator.vibrate(50);
    return true;
  }

  // ---- QRスキャン ----
  function onScan(text) {
    var nc = U.normalizeCode(text);
    if (cooldown && lastScan === nc) return;
    var m = med(nc);
    if (!m) { P8.ui.toast('未登録の薬品です（' + text + '）', 'error'); return; }
    lastScan = nc; cooldown = true;
    setTimeout(function () { cooldown = false; }, 1500);
    // 読み取り枠が一瞬ティール発光
    var zone = document.getElementById('qr-zone');
    zone.classList.add('flash');
    setTimeout(function () { zone.classList.remove('flash'); }, 350);
    addByCode(m.code);
  }

  function startCamera() {
    var hint = document.getElementById('qr-hint');
    var fb = document.getElementById('qr-fallback');
    fb.hidden = true;
    hint.style.display = '';
    hint.textContent = 'カメラを起動しています...';
    P8.scan.start('qr-reader', onScan, function () {
      hint.style.display = 'none';
      fb.hidden = false;
    }).then(function () {
      if (P8.scan.running()) hint.style.display = 'none';
    });
  }

  // ---- 患者・担当者 ----
  function loadRecents() {
    try { var a = JSON.parse(localStorage.getItem('p8_recent_patients') || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveRecent(name) {
    if (!name) return;
    var a = loadRecents().filter(function (x) { return x !== name; });
    a.unshift(name);
    try { localStorage.setItem('p8_recent_patients', JSON.stringify(a.slice(0, 20))); } catch (e) {}
  }
  function renderDatalist() {
    var dl = document.getElementById('dl-patients');
    dl.innerHTML = loadRecents().slice(0, 10).map(function (n) {
      return '<option value="' + U.esc(n) + '">';
    }).join('');
  }

  // ---- 送信 ----
  async function commit() {
    if (sending || !batch.length) return;
    var operator = document.getElementById('dsp-operator').value;
    var patient = document.getElementById('dsp-patient').value.trim();
    if (!operator) { P8.ui.toast('担当者を選択してください', 'error'); return; }
    if (!patient) { P8.ui.toast('患者名を入力してください', 'error'); return; }

    // 在庫を超える出庫の確認（在庫管理対象のみ）
    var shorts = batch.filter(function (it) {
      var m = med(it.code);
      return m && !m.stockUntracked && it.qty > (m.stock || 0);
    });
    if (shorts.length) {
      var body = '<p>在庫数を超える出庫があります。記録が実際とずれている可能性があります。</p>' +
        shorts.map(function (it) {
          var m = med(it.code);
          return '<div class="warn-line" style="animation:none">・' + U.esc(m.name) + '　在庫' + m.stock + m.unit + ' に対して ' + it.qty + m.unit + '</div>';
        }).join('') +
        '<p class="muted">棚卸で実数を入れてから出庫するのが確実です。</p>';
      var ok = await P8.ui.modal({ title: '在庫不足の確認', bodyHTML: body, okText: 'このまま送信する', danger: true });
      if (!ok) return;
    }
    await send(operator, patient);
  }

  async function send(operator, patient) {
    sending = true;
    var btn = document.getElementById('dsp-commit');
    P8.ui.busy(btn, 'busy');

    var today = U.todayJst();
    var txRows = batch.map(function (it) {
      var m = med(it.code);
      return {
        medicine_code: m.code, transaction_type: 'out', quantity: it.qty,
        patient_name: patient, operator: operator, occurred_on: today, source: 'app'
      };
    });
    var decs = batch.filter(function (it) { var m = med(it.code); return m && !m.stockUntracked; })
      .map(function (it) { return { code: med(it.code).code, qty: it.qty }; });
    var presc = {
      patientName: patient, operator: operator, entryDate: today,
      drugs: JSON.stringify(batch.map(function (it) {
        var m = med(it.code); return { name: m.name, quantity: it.qty };
      }))
    };

    var queued = false;
    try {
      // ① 出庫トランザクション一括INSERT（結果を確認）
      var ins = await P8.db.write('pharmacy_transactions', 'POST', txRows);
      if (!ins || ins.length !== txRows.length) throw new Error('出庫記録の結果を確認できません');
      // ② 在庫管理対象のみ在庫を減算
      var patchFailed = [];
      for (var i = 0; i < decs.length; i++) {
        var d = decs[i];
        var m = med(d.code);
        try {
          var p = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(d.code), 'PATCH',
            { current_stock: (m.stock || 0) - d.qty, last_updated: new Date().toISOString() });
          if (!p || !p.length) throw new Error('no rows');
          m.stock = (m.stock || 0) - d.qty; // ローカルも更新
        } catch (e2) { patchFailed.push(m.name); }
      }
      if (patchFailed.length) {
        P8.ui.toast('在庫数の更新に失敗: ' + patchFailed.join('、') + '。再読込します', 'error');
      }
      // ③ 処方履歴（夜間外来DB）fire-and-forget
      P8.db.gasGet('recordPrescription', presc);
    } catch (e) {
      if (e && e.status) {
        // HTTPエラー = データの問題。キューに入れず表示
        P8.ui.toast('送信に失敗しました (' + e.status + ')。内容を確認してください', 'error');
        console.error('dispense error:', e.body || e.message);
        P8.ui.busy(btn, null);
        sending = false;
        updateCommit();
        return;
      }
      // ネットワーク断 → オフラインキューへ退避
      P8.db.enqueueDispense({ txRows: txRows, decs: decs, presc: presc });
      queued = true;
    }

    saveRecent(patient);
    P8.ui.busy(btn, 'done');
    if (queued) {
      P8.ui.toast('送信できませんでした。電波の届く場所で自動再送します', 'warn');
      P8.ui.queueBar();
    } else {
      P8.ui.toast(batch.length + '品目の出庫を記録しました', 'success');
    }
    batch = [];
    warnShown = {};
    document.getElementById('dsp-patient').value = '';
    renderDatalist();
    setTimeout(function () {
      sending = false;
      P8.ui.busy(btn, null);
      renderBatch();
      if (!queued) P8.store.refresh();
    }, 800);
  }

  // ---- ピッカーモーダル ----
  var pickerCat = '';
  function renderPicker() {
    var q = (document.getElementById('picker-search').value || '').trim().toLowerCase();
    var list = P8.store.stock.filter(function (m) {
      if (pickerCat && !(m.category || '').startsWith(pickerCat)) return false;
      if (q && m.name.toLowerCase().indexOf(q) < 0 && String(m.code).toLowerCase().indexOf(q) < 0 &&
        (m.category || '').toLowerCase().indexOf(q) < 0 && (m.furigana || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    document.getElementById('picker-list').innerHTML = list.length ? list.map(function (m) {
      var inB = batch.find(function (it) { return it.code === m.code; });
      return '<div class="dm-hit" data-code="' + U.esc(m.code) + '">' +
        '<b>' + U.esc(m.name) + '</b>' + (inB ? ' <span class="bdg teal">追加済 ×' + inB.qty + '</span>' : '') +
        '<div class="sub">' + U.esc(m.code) + ' ｜ ' + U.esc(m.category || '') + ' ｜ ' +
        (m.stockUntracked ? '在庫非管理' : '在庫 ' + m.stock + m.unit) + '</div></div>';
    }).join('') : '<div class="muted" style="padding:12px">該当なし</div>';
  }
  function openPicker() {
    document.getElementById('picker-search').value = '';
    pickerCat = '';
    document.querySelectorAll('#picker-chips .chip').forEach(function (c, i) { c.classList.toggle('on', i === 0); });
    renderPicker();
    document.getElementById('picker').classList.add('show');
  }

  // ---- 画面ライフサイクル ----
  P8.screens = P8.screens || {};
  P8.screens.dispense = {
    show: function () {
      U = P8.util; S = P8.store;
      var op = document.getElementById('dsp-operator');
      try { var saved = localStorage.getItem('p8_operator'); if (saved && !op.value) op.value = saved; } catch (e) {}
      renderDatalist();
      renderBatch();
      startCamera();
    },
    hide: function () { P8.scan.stop(); },
    addByCode: function (code) { U = P8.util; return addByCode(code, true); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    // バッチ操作（イベント委任）
    document.getElementById('batch-list').addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var i = parseInt(t.getAttribute('data-i'), 10);
      var act = t.getAttribute('data-act');
      if (!batch[i]) return;
      if (act === 'inc') { batch[i].qty += 1; renderBatch(); if (navigator.vibrate) navigator.vibrate(30); }
      if (act === 'dec') { batch[i].qty = Math.max(1, batch[i].qty - 1); renderBatch(); if (navigator.vibrate) navigator.vibrate(30); }
      if (act === 'del') { batch.splice(i, 1); renderBatch(); }
    });
    document.getElementById('batch-list').addEventListener('change', function (e) {
      var t = e.target.closest('input[data-act="qty"]');
      if (!t) return;
      var i = parseInt(t.getAttribute('data-i'), 10);
      var v = parseInt(t.value, 10);
      if (batch[i] && !isNaN(v) && v >= 1) { batch[i].qty = v; }
      renderBatch();
    });
    // 担当者の保存
    document.getElementById('dsp-operator').addEventListener('change', function () {
      try { localStorage.setItem('p8_operator', this.value); } catch (e) {}
    });
    // 長押し確定
    P8.ui.holdButton(document.getElementById('dsp-commit'), document.getElementById('dsp-fill'), commit);
    // ピッカー
    document.getElementById('btn-pick-list').addEventListener('click', openPicker);
    document.getElementById('btn-pick-fallback').addEventListener('click', openPicker);
    document.getElementById('picker-close').addEventListener('click', function () {
      document.getElementById('picker').classList.remove('show');
    });
    document.getElementById('picker').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('show');
    });
    document.getElementById('picker-search').addEventListener('input', renderPicker);
    document.querySelectorAll('#picker-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        pickerCat = c.getAttribute('data-cat');
        document.querySelectorAll('#picker-chips .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        renderPicker();
      });
    });
    document.getElementById('picker-list').addEventListener('click', function (e) {
      var hit = e.target.closest('.dm-hit');
      if (!hit) return;
      addByCode(hit.getAttribute('data-code'), true);
      renderPicker();
    });
    // 簡易入庫 → 入荷画面へ
    document.getElementById('btn-simple-in').addEventListener('click', function () {
      P8.nav('receive', { simple: true });
    });
  });
})();
