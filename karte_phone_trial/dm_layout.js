// ===== dm_layout.js — 第1段階: 湯浅版レイアウトに合わせた「差し込み口」の配線 =====
// app.js / m3_ui.js の機能はそのまま。新しい画面部品（ヘッダー検索・件数・詳細行の開閉・
// カルテ内検索・右下の自動算定ボタン）を既存の関数につなぐだけ。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  // 1) 受付ヘッダーの検索欄 → 読み込み済みの全患者（DB・予約由来・当日受付）を氏名・カナ・患者番号・電話で探す
  //    結果は既存の #dbPatientResults に出す（行を押すとカルテを開く）
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.dmPatientSearch = function (q) {
    const box = $('dbPatientResults'); if (!box) return;
    q = String(q || '').trim();
    if (!q) { box.style.display = 'none'; return; }
    const norm = s => String(s || '').replace(/[\s　]/g, '').toLowerCase();
    const nq = norm(q);
    const list = (typeof patients !== 'undefined' ? patients : []).filter(p =>
      norm(p.name).includes(nq) || norm(p.nameKana).includes(nq) || norm(p.id).includes(nq) || norm(p.phone).includes(nq));
    if (!list.length) { box.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;">該当なし</div>'; box.style.display = 'block'; return; }
    box.innerHTML = list.slice(0, 20).map(p => {
      const last = (p.pastKartes && p.pastKartes.length) ? p.pastKartes[0].date : '-';
      return '<div style="padding:6px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="openKarte(\'' + esc(p.id) + '\')" onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'#fff\'">' +
        '<div><strong>' + esc(p.name) + '</strong> <span style="color:var(--text-muted);font-size:11px;">' + esc(p.nameKana || '') + '　' + esc(p.age != null && p.age !== '' ? p.age + '歳' : '') + ' ' + esc(p.sex || '') + ' / ' + esc(p.insurance || '保険無し') + '</span></div>' +
        '<div style="font-size:11px;color:var(--text-muted);">' + esc(p.id) + ' / 最終:' + esc(last) + '</div></div>';
    }).join('') + (list.length > 20 ? '<div style="padding:6px;text-align:center;color:var(--text-muted);font-size:10px;">他' + (list.length - 20) + '件</div>' : '');
    box.style.display = 'block';
  };
  function wireHeaderSearch() {
    const hs = $('dmHeaderSearch'); if (!hs) return;
    hs.addEventListener('input', () => dmPatientSearch(hs.value));
    hs.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hs.value = ''; const r = $('dbPatientResults'); if (r) r.style.display = 'none'; hs.blur(); }
    });
  }

  // 2) 受付一覧の件数「表示中 / この日の受付」
  function syncCount() {
    const tb = $('patientListBody'); const s = $('m3CountShown');
    if (!tb || !s) return;
    s.textContent = tb.querySelectorAll('tr.m3-row').length;
  }
  function wireCount() {
    const tb = $('patientListBody'); if (!tb) return;
    new MutationObserver(syncCount).observe(tb, { childList: true });
    syncCount();
  }

  // 3) 労災・オンライン診療の詳細行は、チェックしたときだけ出す（既存の toggle が詳細の display を切り替える）
  function syncBars() {
    const pairs = [['rsvDetail', 'rousaiVisitBar'], ['tmvDetail', 'telemedVisitBar']];
    pairs.forEach(([d, b]) => {
      const det = $(d), bar = $(b); if (!det || !bar) return;
      bar.classList.toggle('show', det.style.display !== 'none');
    });
  }
  function wireBars() {
    ['rsvDetail', 'tmvDetail'].forEach(id => {
      const el = $(id); if (!el) return;
      new MutationObserver(syncBars).observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    syncBars();
  }

  // 4) 左パネルのキーワード検索: 表示中のカルテ（診療履歴など）を文字で絞る
  function wireHistSearch() {
    const inp = $('dmHistSearch'); if (!inp) return;
    const apply = () => {
      const q = inp.value.trim(); const root = $('m3Left'); if (!root) return;
      let els = root.querySelectorAll('.history-item, .m3-hist');
      if (!els.length) els = root.querySelectorAll('#patientInfoBody > *, #m3PanelExtra > *');
      els.forEach(el => { el.style.display = (!q || el.textContent.includes(q)) ? '' : 'none'; });
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { inp.value = ''; apply(); } });
    // タブを切り替えたら絞り込みは解除（別の内容が出るため）
    const body = $('patientInfoBody'); if (body) new MutationObserver(() => { if (inp.value) { inp.value = ''; } }).observe(body, { childList: true });
  }

  // 5) 右下「自動算定」: いまの設定（まとめて入れる／候補を出す／入れない）で診察料・加算を入れ直す
  window.dmAutoSantei = function () {
    if (typeof currentPatientId === 'undefined' || !currentPatientId) { if (typeof showToast === 'function') showToast('患者を開いてください'); return; }
    const k = (typeof karteData !== 'undefined') ? karteData[currentPatientId] : null;
    if (k) k.santeiCandidates = [];
    if (typeof recalcBilling === 'function') recalcBilling();
    if (typeof renderSanteiCandidates === 'function') renderSanteiCandidates();
    const mode = (typeof santeiAutoMode === 'function') ? santeiAutoMode() : 'auto';
    if (typeof showToast === 'function') showToast('自動算定を実行しました（' + (mode === 'auto' ? 'まとめて入れる' : mode === 'suggest' ? '候補を出す' : '入れない') + '）');
  };

  function install() { wireHeaderSearch(); wireCount(); wireBars(); wireHistSearch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
