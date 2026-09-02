/* =========================================================
   v0.8 ui.js ― 共通部品（トースト/モーダル/長押し/数値ロール/
   スピナー/オフラインバー/バッジ）・画面ナビ・QRスキャナ・起動
   ========================================================= */
(function () {
  'use strict';
  window.P8 = window.P8 || {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- トースト ----
  var toastTimer = null;
  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = (type || '') + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // ---- 汎用確認モーダル（confirm()の代替。Promise<boolean>） ----
  var modalResolve = null;
  function modal(opts) {
    return new Promise(function (resolve) {
      modalResolve = resolve;
      document.getElementById('modal-title').textContent = opts.title || '確認';
      document.getElementById('modal-body').innerHTML = opts.bodyHTML || '';
      var ok = document.getElementById('modal-ok');
      var cancel = document.getElementById('modal-cancel');
      ok.textContent = opts.okText || 'OK';
      ok.className = 'btn ' + (opts.danger ? 'danger' : 'act');
      cancel.style.display = opts.hideCancel ? 'none' : '';
      cancel.textContent = opts.cancelText || 'キャンセル';
      document.getElementById('modal-box').className = 'modal-box' + (opts.danger ? ' danger' : '');
      document.getElementById('modal').classList.add('show');
    });
  }
  function closeModal(result) {
    document.getElementById('modal').classList.remove('show');
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  }

  // ---- 長押しボタン（0.6秒・途中で離すと150msで巻き戻る） ----
  function holdButton(el, fillEl, onCommit) {
    var HOLD_MS = 600;
    var raf = null, start = 0, held = false;
    function setFill(pct) { if (fillEl) fillEl.style.width = pct + '%'; }
    function tick(ts) {
      if (!held) return;
      var p = Math.min(1, (ts - start) / HOLD_MS);
      if (!reduced) setFill(p * 100);
      if (p >= 1) {
        held = false;
        setFill(0);
        el.classList.remove('reverting');
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        onCommit();
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function down(ev) {
      if (el.disabled || el.classList.contains('is-busy') || el.classList.contains('is-done')) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      held = true;
      el.classList.remove('reverting');
      start = performance.now();
      if (reduced) {
        // reduced-motion: リング無しの0.6秒保持のみ
        raf = setTimeout(function () {
          if (!held) return;
          held = false;
          if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
          onCommit();
        }, HOLD_MS);
      } else {
        raf = requestAnimationFrame(tick);
      }
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }
    function up() {
      if (!held) return;
      held = false;
      if (reduced) { clearTimeout(raf); }
      else {
        cancelAnimationFrame(raf);
        el.classList.add('reverting');
        setFill(0);
      }
    }
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // ---- 数値ロール（300ms・差が20超なら即時） ----
  function rollNumber(el, from, to) {
    if (reduced || Math.abs(to - from) > 20 || from === to) { el.textContent = to; return; }
    var start = performance.now();
    function step(ts) {
      var p = Math.min(1, (ts - start) / 300);
      el.textContent = Math.round(from + (to - from) * p);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- 送信ボタンのスピナー→チェック ----
  function busy(btn, state) {
    btn.classList.remove('is-busy', 'is-done');
    if (state === 'busy') { btn.classList.add('is-busy'); btn.disabled = true; }
    else if (state === 'done') { btn.classList.add('is-done'); btn.disabled = true; }
    else { btn.disabled = false; }
  }

  // ---- オフラインキューのバー ----
  var barOkTimer = null;
  function queueBar(state) {
    var bar = document.getElementById('queue-bar');
    if (!bar) return;
    var n = P8.db ? P8.db.queueCount() : 0;
    clearTimeout(barOkTimer);
    if (state === 'ok') {
      bar.className = 'show ok';
      bar.textContent = '✓ 未送信分をすべて送信しました';
      document.body.classList.add('has-queuebar');
      barOkTimer = setTimeout(function () { queueBar(); }, 2500);
      return;
    }
    if (n > 0) {
      bar.className = 'show';
      bar.textContent = '⚠ 未送信の出庫が ' + n + ' 件あります。電波の届く場所で自動再送します';
      document.body.classList.add('has-queuebar');
    } else {
      bar.className = '';
      document.body.classList.remove('has-queuebar');
    }
  }

  // ---- サイドバー件数バッジ（読込後に1回スケールイン） ----
  function setBadge(id, n, popped) {
    var el = document.getElementById(id);
    if (!el) return;
    if (n > 0) {
      var was = el.textContent;
      el.textContent = n;
      el.hidden = false;
      if (!popped[id]) { el.classList.add('pop'); popped[id] = true; }
      else if (was !== String(n)) { el.classList.remove('pop'); }
    } else { el.hidden = true; }
  }
  var badgePopped = {};
  function updateBadges() {
    var st = P8.store;
    var order = st.reorderCount(['out_of_stock', 'below_threshold', 'runs_out_soon']);
    var master = st.gapStats ? (st.gapStats.total - st.gapStats.ok_cost) : 0;
    var home = order + st.reverseMargins().length + (st.missingDrugs || []).length
      + st.stock.filter(function (m) { return (m.stock || 0) < 0; }).length;
    setBadge('badge-order', order, badgePopped);
    setBadge('badge-order-m', order, badgePopped);
    setBadge('badge-master', master, badgePopped);
    setBadge('badge-master-m', master, badgePopped);
    setBadge('badge-home', home, badgePopped);
    setBadge('badge-home-m', home, badgePopped);
  }

  // ---- 画面ナビゲーション ----
  var current = null;
  function nav(name, params) {
    if (current && P8.screens[current] && P8.screens[current].hide) {
      try { P8.screens[current].hide(); } catch (e) { console.warn(e); }
    }
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var scr = document.getElementById('scr-' + name);
    if (scr) scr.classList.add('active');
    document.querySelectorAll('.sidebar a[data-nav]').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-nav') === name);
    });
    document.querySelectorAll('.tabbar button[data-nav]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-nav') === name);
    });
    document.getElementById('menu-sheet').classList.remove('show');
    current = name;
    window.scrollTo(0, 0);
    if (P8.screens[name] && P8.screens[name].show) {
      try { P8.screens[name].show(params || {}); } catch (e) { console.error(e); }
    }
    if (P8.db) P8.db.flushQueue();
  }

  // ---- QRスキャナ（画面間で1インスタンスを共有） ----
  var scanInst = null, scanMount = null, scanRunning = false, scanStarting = false;
  async function scanStart(mountId, cb, onFail) {
    try {
      if (scanStarting) return;
      scanStarting = true;
      await scanStop();
      if (typeof Html5Qrcode === 'undefined') throw new Error('html5-qrcode 未読込');
      scanInst = new Html5Qrcode(mountId);
      scanMount = mountId;
      await scanInst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        cb,
        function () { /* per-frame failure は無視 */ }
      );
      scanRunning = true;
    } catch (e) {
      console.warn('カメラ起動失敗:', e && e.message);
      scanInst = null; scanRunning = false;
      if (onFail) onFail(e);
    } finally { scanStarting = false; }
  }
  async function scanStop() {
    if (scanInst && scanRunning) {
      try { await scanInst.stop(); } catch (e) {}
      try { scanInst.clear(); } catch (e) {}
    }
    scanInst = null; scanRunning = false; scanMount = null;
  }

  P8.ui = {
    toast: toast, modal: modal, holdButton: holdButton, rollNumber: rollNumber,
    busy: busy, queueBar: queueBar, updateBadges: updateBadges, reduced: reduced
  };
  P8.nav = nav;
  P8.scan = { start: scanStart, stop: scanStop, running: function () { return scanRunning; } };
  P8.screens = P8.screens || {};

  // ---- 起動 ----
  document.addEventListener('DOMContentLoaded', function () {
    P8.theme.init();

    // モーダルボタン
    document.getElementById('modal-ok').addEventListener('click', function () { closeModal(true); });
    document.getElementById('modal-cancel').addEventListener('click', function () { closeModal(false); });
    document.getElementById('modal').addEventListener('click', function (e) {
      if (e.target === this) closeModal(false);
    });

    // ナビ配線
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () { nav(el.getAttribute('data-nav')); });
    });
    document.getElementById('tab-menu').addEventListener('click', function () {
      document.getElementById('menu-sheet').classList.add('show');
    });
    document.getElementById('menu-close').addEventListener('click', function () {
      document.getElementById('menu-sheet').classList.remove('show');
    });
    document.getElementById('menu-sheet').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('show');
    });

    // 担当者selectを一括生成
    ['dsp-operator', 'st-operator', 'rc-op', 'rcv-operator'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      P8.util.OPERATORS.forEach(function (op) {
        var o = document.createElement('option');
        o.value = op; o.textContent = op;
        sel.appendChild(o);
      });
    });

    queueBar();

    // 初期画面: モバイル=出庫 / デスクトップ=今日の状態
    nav(P8.theme.isMobile() ? 'dispense' : 'home');

    // データ読込（キャッシュ→ネットワーク）
    P8.store.init().then(function (ok) {
      if (!ok && !P8.store.stock.length) {
        toast('DBに接続できません。前回キャッシュも無いため表示できるデータがありません', 'error');
      }
      // 現在画面を再描画
      if (current && P8.screens[current] && P8.screens[current].show) {
        P8.screens[current].show({});
      }
    });
    P8.db.flushQueue();
  });
})();
