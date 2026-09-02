/* =========================================================
   v0.8 screen-stocktake.js ― 棚卸ワークシート（新設）
   Enterで次行へ / 差分即時計算 / 下書きlocalStorage /
   確認モーダル → rpc/pharmacy_apply_stocktake（単一トランザクション）
   モバイルはQRスキャン1品モードも併用可
   ========================================================= */
(function () {
  'use strict';
  var U = null;
  var DRAFT_KEY = 'p8_stocktake_draft';

  var rows = {};        // code → {counted:number|null, note:string}
  var applying = false;
  var draftOffered = false;

  function targets() {
    // 在庫管理対象のみ（stock_untracked除外）・分類→コード順
    return P8.store.stock.filter(function (m) { return !m.stockUntracked; })
      .slice().sort(function (a, b) {
        var c = String(a.category).localeCompare(String(b.category), 'ja');
        return c !== 0 ? c : String(a.code).localeCompare(String(b.code));
      });
  }

  function saveDraft(silent) {
    var data = {
      taken_on: document.getElementById('st-date').value,
      operator: document.getElementById('st-operator').value,
      rows: rows
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
    if (!silent) P8.ui.toast('下書きを保存しました（この端末に残ります）');
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  function enteredCount() {
    return Object.keys(rows).filter(function (c) { return rows[c].counted !== null && rows[c].counted !== undefined; }).length;
  }
  function diffs() {
    var out = [];
    targets().forEach(function (m) {
      var r = rows[m.code];
      if (!r || r.counted === null || r.counted === undefined) return;
      out.push({ code: m.code, name: m.name, unit: m.unit, system: m.stock || 0, counted: r.counted, diff: r.counted - (m.stock || 0), note: r.note || '' });
    });
    return out;
  }

  function renderHead() {
    var list = targets();
    var n = enteredCount();
    document.getElementById('st-progress-label').textContent =
      '進捗 ' + n + ' / ' + list.length + '品目（在庫非管理の' + (P8.store.stock.length - list.length) + '品目は対象外）';
    document.getElementById('st-progress-bar').style.width = (list.length ? Math.round(n / list.length * 100) : 0) + '%';
    var ds = diffs().filter(function (d) { return d.diff !== 0; });
    var plus = ds.filter(function (d) { return d.diff > 0; }).reduce(function (s, d) { return s + d.diff; }, 0);
    var minus = ds.filter(function (d) { return d.diff < 0; }).reduce(function (s, d) { return s + d.diff; }, 0);
    document.getElementById('st-summary').textContent =
      '差分あり ' + ds.length + '品目（＋' + plus + ' / ' + minus + '）｜ 未入力の品目は変更されません';
  }

  function render() {
    var list = targets();
    var thead = '<tr><th>薬品名</th><th>分類</th><th class="r">システム在庫</th><th class="r" style="width:90px">実地数</th><th class="r" style="width:70px">差分</th><th>メモ</th></tr>';
    var body = list.map(function (m, i) {
      var r = rows[m.code] || {};
      var has = r.counted !== null && r.counted !== undefined;
      var diff = has ? r.counted - (m.stock || 0) : null;
      var diffCell = !has ? '<td class="diff-cell muted r">—</td>'
        : diff === 0 ? '<td class="diff-cell zero r">±0</td>'
          : '<td class="diff-cell ne r">' + (diff > 0 ? '＋' + diff : '−' + Math.abs(diff)) + '</td>';
      return '<tr data-code="' + U.esc(m.code) + '"' + (has && diff !== 0 ? ' class="st-diff"' : '') + '>' +
        '<td>' + U.esc(m.name) + '</td>' +
        '<td class="muted">' + U.esc(m.category || '') + '</td>' +
        '<td class="r num">' + (m.stock || 0) + U.esc(m.unit) + '</td>' +
        '<td class="r"><input class="st-input" data-i="' + i + '" data-code="' + U.esc(m.code) + '" inputmode="numeric" value="' + (has ? r.counted : '') + '" placeholder="未入力"></td>' +
        diffCell +
        '<td><input class="st-note" data-code="' + U.esc(m.code) + '" value="' + U.esc(r.note || '') + '" placeholder=""></td>' +
        '</tr>';
    }).join('');
    document.getElementById('st-table').innerHTML = thead + body;
    renderHead();
  }

  function setCounted(code, val, pulse) {
    var v = String(val).trim();
    if (v === '') {
      if (rows[code]) { rows[code].counted = null; if (!rows[code].note) delete rows[code]; }
    } else {
      var n = parseInt(v, 10);
      if (isNaN(n) || n < 0) return;
      rows[code] = rows[code] || {};
      rows[code].counted = n;
    }
    saveDraft(true);
    // 行の差分セルだけ更新（フォーカスを壊さない）
    var tr = document.querySelector('#st-table tr[data-code="' + CSS.escape(code) + '"]');
    if (tr) {
      var m = P8.store.findByCode(code);
      var r = rows[code];
      var has = r && r.counted !== null && r.counted !== undefined;
      var diff = has ? r.counted - (m.stock || 0) : null;
      var cell = tr.querySelector('.diff-cell');
      if (!has) { cell.className = 'diff-cell muted r'; cell.textContent = '—'; tr.classList.remove('st-diff'); }
      else if (diff === 0) { cell.className = 'diff-cell zero r'; cell.textContent = '±0'; tr.classList.remove('st-diff'); }
      else {
        cell.className = 'diff-cell ne r';
        cell.textContent = diff > 0 ? '＋' + diff : '−' + Math.abs(diff);
        tr.classList.add('st-diff');
        if (pulse) {
          cell.classList.remove('diff-pulse');
          void cell.offsetWidth; // reflowでアニメーション再始動（1回だけ）
          cell.classList.add('diff-pulse');
        }
      }
    }
    renderHead();
  }

  async function apply() {
    if (applying) return;
    var ds = diffs();
    if (!ds.length) { P8.ui.toast('実地数が1件も入力されていません', 'error'); return; }
    var operator = document.getElementById('st-operator').value;
    if (!operator) { P8.ui.toast('担当者を選択してください', 'error'); return; }
    var takenOn = document.getElementById('st-date').value || U.todayJst();

    var changed = ds.filter(function (d) { return d.diff !== 0; });
    var body = '<p>' + ds.length + '品目を棚卸として記録します。差分のある品目：</p>';
    if (changed.length) {
      body += '<div class="tbl-wrap"><table class="tbl"><tr><th>薬品名</th><th class="r">システム</th><th class="r">実地</th><th class="r">差分</th></tr>' +
        changed.map(function (d) {
          return '<tr><td>' + U.esc(d.name) + '</td><td class="r">' + d.system + '</td><td class="r">' + d.counted +
            '</td><td class="r" style="color:var(--warn);font-weight:900">' + (d.diff > 0 ? '＋' + d.diff : '−' + Math.abs(d.diff)) + '</td></tr>';
        }).join('') + '</table></div>';
      body += '<p class="muted">差分のある品目は在庫数が実地数に書き換わります（調整記録が残ります）。</p>';
    } else {
      body += '<p class="muted">差分はありません（±0）。棚卸実施の記録だけが残ります。</p>';
    }
    var ok = await P8.ui.modal({ title: '棚卸の反映（' + takenOn + '・担当 ' + operator + '）', bodyHTML: body, okText: '反映する' });
    if (!ok) return;

    applying = true;
    var btn = document.getElementById('st-apply');
    P8.ui.busy(btn, 'busy');
    try {
      var payload = ds.map(function (d) { return { code: d.code, counted: d.counted, note: d.note || null }; });
      var res = await P8.db.rpc('pharmacy_apply_stocktake', { _taken_on: takenOn, _operator: operator, _rows: payload });
      if (!res || typeof res.applied !== 'number') throw new Error('反映結果を確認できません');
      P8.ui.busy(btn, 'done');
      P8.ui.toast(res.applied + '品目を棚卸し、差分' + changed.length + '件を反映しました', 'success');
      rows = {};
      clearDraft();
      await P8.store.refresh();
      render();
    } catch (e) {
      console.error('stocktake error:', e.body || e.message);
      P8.ui.toast('棚卸の反映に失敗しました: ' + e.message, 'error');
    } finally {
      applying = false;
      setTimeout(function () { P8.ui.busy(btn, null); }, 900);
    }
  }

  // ---- モバイル: QRスキャン1品モード ----
  var scanTarget = null;
  function stScanStart() {
    document.getElementById('st-scan-panel').hidden = false;
    document.getElementById('st-scan-target').hidden = true;
    P8.scan.start('st-qr-reader', function (text) {
      var m = P8.store.findByCode(U.normalizeCode(text));
      if (!m) { P8.ui.toast('未登録の薬品です（' + text + '）', 'error'); return; }
      if (m.stockUntracked) { P8.ui.toast(m.name + ' は在庫非管理のため棚卸対象外です', 'warn'); return; }
      if (scanTarget && scanTarget.code === m.code) return;
      scanTarget = m;
      if (navigator.vibrate) navigator.vibrate(50);
      document.getElementById('st-scan-name').textContent = m.name;
      document.getElementById('st-scan-sys').textContent = 'システム在庫 ' + (m.stock || 0) + m.unit;
      var inp = document.getElementById('st-scan-input');
      var r = rows[m.code];
      inp.value = (r && r.counted !== null && r.counted !== undefined) ? r.counted : '';
      document.getElementById('st-scan-target').hidden = false;
      inp.focus();
    }, function () {
      P8.ui.toast('カメラを起動できませんでした', 'error');
      stScanStop();
    });
  }
  function stScanStop() {
    P8.scan.stop();
    scanTarget = null;
    document.getElementById('st-scan-panel').hidden = true;
    render();
  }

  P8.screens = P8.screens || {};
  P8.screens.stocktake = {
    show: function (params) {
      U = P8.util;
      var dateEl = document.getElementById('st-date');
      if (!dateEl.value) dateEl.value = U.todayJst();
      var opEl = document.getElementById('st-operator');
      try { var saved = localStorage.getItem('p8_operator'); if (saved && !opEl.value) opEl.value = saved; } catch (e) {}
      // 下書きの復元提案（同日付のみ・1回だけ）
      var d = loadDraft();
      if (d && d.rows && Object.keys(d.rows).length && !Object.keys(rows).length && !draftOffered) {
        draftOffered = true;
        P8.ui.modal({
          title: '下書きがあります',
          bodyHTML: '<p>' + U.esc(d.taken_on || '') + ' の棚卸下書き（' + Object.keys(d.rows).length + '品目入力済み）が残っています。復元しますか？</p>',
          okText: '復元する', cancelText: '破棄する'
        }).then(function (ok) {
          if (ok) {
            rows = d.rows;
            if (d.taken_on) dateEl.value = d.taken_on;
            if (d.operator) opEl.value = d.operator;
          } else { clearDraft(); }
          render();
        });
      }
      render();
      if (params && params.focus) {
        setTimeout(function () {
          var inp = document.querySelector('#st-table input.st-input[data-code="' + CSS.escape(params.focus) + '"]');
          if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
        }, 100);
      }
    },
    hide: function () { P8.scan.stop(); document.getElementById('st-scan-panel').hidden = true; }
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    var tbl = document.getElementById('st-table');
    tbl.addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('st-input')) setCounted(t.getAttribute('data-code'), t.value, false);
      if (t.classList.contains('st-note')) {
        var code = t.getAttribute('data-code');
        rows[code] = rows[code] || { counted: null };
        rows[code].note = t.value;
        saveDraft(true);
      }
    });
    tbl.addEventListener('change', function (e) {
      if (e.target.classList.contains('st-input')) setCounted(e.target.getAttribute('data-code'), e.target.value, true);
    });
    // Enter / Tab で次行の実地数へ
    tbl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var t = e.target;
      if (!t.classList.contains('st-input')) return;
      e.preventDefault();
      setCounted(t.getAttribute('data-code'), t.value, true);
      var i = parseInt(t.getAttribute('data-i'), 10);
      var next = document.querySelector('#st-table input.st-input[data-i="' + (i + 1) + '"]');
      if (next) { next.focus(); next.select(); }
    });
    document.getElementById('st-draft').addEventListener('click', function () { saveDraft(false); });
    document.getElementById('st-apply').addEventListener('click', apply);
    document.getElementById('st-scan-btn').addEventListener('click', stScanStart);
    document.getElementById('st-scan-stop').addEventListener('click', stScanStop);
    document.getElementById('st-scan-next').addEventListener('click', function () {
      if (!scanTarget) return;
      var v = document.getElementById('st-scan-input').value;
      if (String(v).trim() === '') { P8.ui.toast('実地数を入力してください', 'error'); return; }
      setCounted(scanTarget.code, v, false);
      P8.ui.toast(scanTarget.name + ' を記録しました。次の薬をスキャンしてください', 'success');
      scanTarget = null;
      document.getElementById('st-scan-target').hidden = true;
    });
  });
})();
