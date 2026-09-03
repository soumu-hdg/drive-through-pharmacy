/* =========================================================
   v0.8 theme.js ― テーマ（day/night/auto）とレイアウト判定
   自動: 20:00–5:59 = night（JST）。60秒ごとに再判定。
   手動: ヘッダーのボタンで day → night → auto を巡回。
   テーマとレイアウト（768px）は独立。
   ========================================================= */
(function () {
  'use strict';
  window.P8 = window.P8 || {};

  var KEY = 'p8_theme';
  var NIGHT_START = 20; // 拡張余地: 現場要望が出たらこの定数を設定可能にする
  var NIGHT_END = 6;    // 6:00 になったら day

  function pref() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'day' || v === 'night') ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function jstHour() {
    return parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }), 10);
  }
  function autoTheme() {
    var h = jstHour();
    return (h >= NIGHT_START || h < NIGHT_END) ? 'night' : 'day';
  }
  function effective() {
    var p = pref();
    return p === 'auto' ? autoTheme() : p;
  }

  function apply() {
    var t = effective();
    if (document.documentElement.getAttribute('data-theme') !== t) {
      document.documentElement.setAttribute('data-theme', t);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'night' ? '#22262a' : '#e3e7e0');
    }
    renderChip();
    // テーマが変わったことを画面側へ知らせる。
    // 「今日の状態」の日付行がモード名を出しており、
    // 再描画しないと手動切替のあと表示が食い違ったままになる。
    document.dispatchEvent(new CustomEvent('p8:theme', { detail: t }));
  }

  function renderChip() {
    var chip = document.getElementById('mode-chip');
    var btn = document.getElementById('theme-btn');
    var p = pref();
    var t = effective();
    var now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
    var label = (t === 'night' ? '🌙 夜間' : '☀️ 日中') + ' ' + now + (p === 'auto' ? '（自動）' : '');
    if (chip) chip.textContent = label;
    if (btn) {
      btn.textContent = p === 'auto' ? (t === 'night' ? '🌙' : '☀️') : (p === 'night' ? '🌙' : '☀️');
      btn.title = p === 'auto' ? '自動（タップで手動切替）' : (p === 'night' ? '夜間に固定中（タップで切替）' : '日中に固定中（タップで切替）');
    }
    var ms = document.getElementById('menu-theme-state');
    if (ms) ms.textContent = p === 'auto' ? '自動' : (p === 'night' ? '夜間に固定' : '日中に固定');
  }

  // day → night → auto の3状態巡回
  function cycle() {
    var p = pref();
    var next = p === 'day' ? 'night' : (p === 'night' ? 'auto' : 'day');
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply();
    if (P8.ui) {
      var msg = next === 'auto' ? '自動切替に戻しました（20時〜6時は夜間配色）'
        : (next === 'night' ? '夜間配色に固定しました' : '日中配色に固定しました');
      P8.ui.toast(msg);
    }
  }

  function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }

  function init() {
    apply();
    setInterval(apply, 60000); // 60秒ごとに再判定（時刻表示の更新も兼ねる）
    var btn = document.getElementById('theme-btn');
    if (btn) btn.addEventListener('click', cycle);
    var mt = document.getElementById('menu-theme');
    if (mt) mt.addEventListener('click', function () { cycle(); });
  }

  P8.theme = { init: init, apply: apply, cycle: cycle, effective: effective, pref: pref, isMobile: isMobile };
})();
