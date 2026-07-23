// ===== Panel Resizer (resizer.js) =====
// 3カラムレイアウト + カルテ分割のドラッグリサイズ
// localStorage に幅を保存して次回復元

(function() {
  'use strict';

  const STORAGE_KEY = 'karte_v03_layout';

  // デフォルト値
  const DEFAULTS = {
    leftWidth: 220,
    rightWidth: 260,
    splitRatio: 0.5  // 所見 : 処置 の比率（0~1）
  };

  // 制約
  const MIN_LEFT = 150;
  const MAX_LEFT = 400;
  const MIN_RIGHT = 180;
  const MAX_RIGHT = 420;
  const MIN_SPLIT = 0.25;
  const MAX_SPLIT = 0.75;

  // 保存された値を読み込み
  function loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Object.assign({}, DEFAULTS, saved);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveLayout(layout) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (e) { /* ignore */ }
  }

  let layout = loadLayout();

  // グリッドに幅を適用
  function applyGridLayout() {
    const grid = document.getElementById('mainGrid');
    if (!grid) return;
    grid.style.gridTemplateColumns =
      layout.leftWidth + 'px 6px 1fr 6px ' + layout.rightWidth + 'px';
  }

  // カルテ分割に比率を適用
  function applySplitLayout() {
    const split = document.querySelector('.karte-split');
    if (!split) return;
    const r = layout.splitRatio;
    split.style.gridTemplateColumns = r + 'fr 6px ' + (1 - r) + 'fr';
  }

  // --- 左ハンドル（左パネル幅） ---
  function initResizeLeft() {
    const handle = document.getElementById('resizeLeft');
    if (!handle) return;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      const grid = document.getElementById('mainGrid');
      if (!grid) return;

      const startX = e.clientX;
      const startW = layout.leftWidth;

      handle.classList.add('active');
      document.body.classList.add('resizing');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        layout.leftWidth = Math.max(MIN_LEFT, Math.min(MAX_LEFT, startW + dx));
        applyGridLayout();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
        saveLayout(layout);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- 右ハンドル（右パネル幅） ---
  function initResizeRight() {
    const handle = document.getElementById('resizeRight');
    if (!handle) return;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      const startX = e.clientX;
      const startW = layout.rightWidth;

      handle.classList.add('active');
      document.body.classList.add('resizing');

      function onMove(ev) {
        // 右パネルは右端から計算するので、マウス移動方向が逆
        const dx = startX - ev.clientX;
        layout.rightWidth = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, startW + dx));
        applyGridLayout();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
        saveLayout(layout);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- 中央カルテ分割ハンドル（所見 : 処置） ---
  function initResizeSplit() {
    const handle = document.getElementById('resizeSplit');
    if (!handle) return;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      const split = document.querySelector('.karte-split');
      if (!split) return;

      const splitRect = split.getBoundingClientRect();
      const handleW = 6;

      handle.classList.add('active');
      document.body.classList.add('resizing');

      function onMove(ev) {
        const relX = ev.clientX - splitRect.left;
        const totalW = splitRect.width - handleW;
        let ratio = relX / totalW;
        ratio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, ratio));
        layout.splitRatio = Math.round(ratio * 100) / 100;
        applySplitLayout();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
        saveLayout(layout);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- ダブルクリックでリセット ---
  function initDoubleClickReset() {
    var handles = ['resizeLeft', 'resizeRight', 'resizeSplit'];
    handles.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('dblclick', function() {
        if (id === 'resizeLeft') layout.leftWidth = DEFAULTS.leftWidth;
        else if (id === 'resizeRight') layout.rightWidth = DEFAULTS.rightWidth;
        else if (id === 'resizeSplit') layout.splitRatio = DEFAULTS.splitRatio;
        applyGridLayout();
        applySplitLayout();
        saveLayout(layout);
      });
    });
  }

  // 初期化
  function init() {
    applyGridLayout();
    applySplitLayout();
    initResizeLeft();
    initResizeRight();
    initResizeSplit();
    initDoubleClickReset();
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
