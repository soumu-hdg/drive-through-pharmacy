// 置き換え層（工程4）: 作業中

// ---- 担当C ここから ----
// 統合版の独自機能を基準版の画面に足す部品（処理は compat_features_c.js）。renderer.js は変えず、既存の部品のクラスで DOM を足す
//   ① 在庫連動の知らせ … 保存確定・記録の削除で在庫を動かした結果を、カルテ右側（フッターの上）とトーストに出す
//   ② 院ごとの算定ルール … 施設管理画面「自動算定」に、統合版の画面と共通の選択（算定する／算定しない／未設定）を出す
//   ③ 様式14 … 施設管理画面に「オンライン診療の報告（様式14）」を足し、統合版の報告書（telemed_report.js）をそのまま開く
(function () {
  const C = window.__compat; if (!C) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'info'); };
  const F = () => C.featuresC || null;
  // 統合版の部品の読み込み（compat_features_c.js が無いときも様式14だけは開けるように、同じ作りの控えを持つ）
  const loading = new Map();
  function appScript(file, globalName) {
    if (F()) return F().loadAppScript(file, globalName);
    if (typeof window[globalName] !== 'undefined') return Promise.resolve(true);
    if (!loading.has(file)) loading.set(file, new Promise((resolve) => { const s = document.createElement('script'); s.src = '../' + file; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.appendChild(s); }));
    return loading.get(file);
  }
  function appStyle(file) {
    if (F()) return F().loadAppStyle(file);
    if (document.querySelector('link[data-app-style="' + file + '"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../' + file; l.setAttribute('data-app-style', file); document.head.appendChild(l);
  }

  // ======================================================================
  // ① 在庫連動の知らせ（統合版の invShowDispenseResult と同じ文言）
  // ======================================================================
  function inventoryBox() {
    let box = document.getElementById('base-inv-note'); if (box) return box;
    const footer = document.querySelector('.m3-panel-right .m3-order-footer'); if (!footer) return null;
    box = document.createElement('div'); box.id = 'base-inv-note'; box.className = 'auto-calc-notices'; box.style.display = 'none';
    footer.parentNode.insertBefore(box, footer);
    box.addEventListener('click', (e) => { if (e.target.closest('[data-inv-close]')) { box.style.display = 'none'; box.innerHTML = ''; } });
    return box;
  }
  function showInventory(r) {
    if (!r) return;
    const warn = [], info = [];
    const where = String(r.visit || '').split('|').slice(1).join('・');   // 患者番号・診療日（どの受診の知らせか）
    if (r.kind === 'cancel') {
      if (r.error) toast('在庫: ' + r.error, 'error');
      else if (r.dryRun) info.push('テスト用クリニックには在庫の枠が無いため、在庫は動かしていません（戻す分なし）');
      else if ((r.restored || []).length) { toast('在庫を' + r.restored.length + '件戻しました', 'success'); info.push('在庫を戻しました: ' + r.restored.map((x) => x.code + ' ＋' + x.qty).join('、')); }
    } else {
      const applied = r.applied || [];
      if (r.error) toast('在庫: ' + r.error, 'error');
      else if (r.dryRun) info.push('テスト用クリニックには在庫の枠が無いため、在庫は動かしていません（動かす予定: ' + (r.planned || []).map((a) => a.name + ' −' + a.qty).join('、') + '）');
      else if (applied.length) {
        toast('在庫を減らしました: ' + applied.map((a) => a.name + ' −' + a.qty + (a.unit || '')).join('、'), 'success');
        info.push('在庫を減らしました: ' + applied.map((a) => a.name + ' −' + a.qty + (a.unit || '') + '（残り ' + a.stock_after + '）').join('、'));
      }
      (r.untracked || []).forEach((u) => warn.push(u.name + '（在庫を追わない薬のため減らしていません）'));
      (r.unknown || []).forEach((u) => warn.push((u.name || u.code) + '（在庫マスタに無いため減らしていません）'));
      (r.unresolved || []).forEach((n) => warn.push(n + '（在庫の薬品と結び付かないため減らしていません）'));
      (r.already || []).forEach((a) => warn.push(a.name + '（この受診では反映済み）'));
    }
    const box = inventoryBox(); if (!box) return;
    if (!warn.length && !info.length && !r.error) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const note = (cls, icon, html) => '<div class="auto-calc-notice ' + cls + '"><i class="fas ' + icon + '"></i><div style="flex:1;">' + html + '</div></div>';
    let html = '';
    if (r.error) html += note('warning', 'fa-exclamation-triangle', '<b>在庫を更新できませんでした</b><br>' + esc(r.error));
    info.forEach((t) => { html += note('info', 'fa-boxes', esc(t)); });
    if (warn.length) html += note('warning', 'fa-exclamation-triangle', '<b>在庫を動かさなかった薬</b><ul style="margin:2px 0 0 16px;padding:0;">' + warn.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>');
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#555;"><span>在庫（' + esc(where) + '）</span>'
      + '<button type="button" data-inv-close title="閉じる" style="border:none;background:none;cursor:pointer;color:#777;"><i class="fas fa-times"></i></button></div>' + html;
    box.style.display = '';
  }
  window.addEventListener('compat:inventory', (e) => showInventory(e.detail));

  // ======================================================================
  // ② 院ごとの算定ルール（施設管理画面「自動算定」）
  // ======================================================================
  const MODE_LABEL = { on: '算定する', off: '算定しない', unset: '未設定' };
  function santeiSection() {
    let sec = document.getElementById('base-santei-rules'); if (sec) return sec;
    const content = document.querySelector('[data-facility-panel="auto-calc"] .facility-auto-content'); if (!content) return null;
    sec = document.createElement('section'); sec.className = 'facility-auto-selection'; sec.id = 'base-santei-rules';
    sec.innerHTML = '<div class="facility-auto-section-title"><h3>院ごとの算定ルール（統合版の画面と共通）</h3></div>'
      + '<div class="facility-auto-sub-option" style="margin:0 0 8px;white-space:normal;">ここで選んだ内容は統合版の画面の「算定ルール設定」と同じ設定です。どちらの画面で選んでも同じになります。'
      + '「連動」の加算は、下の「自動算定する診療行為」の行の有効・無効にも写します（行を削除すると「算定しない」になります）。選んでいない加算は従来どおりの動きのままです。</div>'
      + '<table class="facility-auto-setting-table"><tbody id="base-santei-rules-body"><tr><td>読み込み中...</td></tr></tbody></table>';
    const first = content.querySelector('.facility-auto-selection');
    if (first) first.after(sec); else content.prepend(sec);
    sec.addEventListener('change', async (e) => {
      const t = e.target; if (!t || t.type !== 'radio' || !t.dataset.santeiKey) return;
      const f = F(); if (!f) return;
      try { await f.santei.writeRule(t.dataset.santeiKey, t.value); await f.santei.syncBase(); toast('算定ルールを保存しました（' + MODE_LABEL[t.value] + '）', 'success'); }
      catch (err) { toast(String(err.message || err), 'error'); }
      await renderSanteiPanel(); await reloadBaseList();
    });
    return sec;
  }
  async function renderSanteiPanel() {
    const sec = santeiSection(); if (!sec) return;
    const body = sec.querySelector('#base-santei-rules-body'); const f = F();
    if (!f) { body.innerHTML = '<tr><td>算定ルールの処理（compat_features_c.js）が読み込まれていません</td></tr>'; return; }
    await f.santei.ready;
    if (typeof SanteiRules === 'undefined') { body.innerHTML = '<tr><td>算定ルールの一覧を読み込めません</td></tr>'; return; }
    await SanteiRules.load(true);
    body.innerHTML = SanteiRules.CATALOG.map((r) => {
      const cur = SanteiRules.modeOf(r.key), pts = [];
      if (r.first != null) pts.push('初診' + r.first + '点'); if (r.re != null) pts.push('再診' + r.re + '点');
      const linked = f.santei.RULE_MAP[r.key] ? '連動（自動算定する診療行為の行）' : '統合版の画面だけで効く（基準版に同じ行が無い）';
      return '<tr data-santei-row="' + esc(r.key) + '"><th style="white-space:normal;">' + esc(r.name) + '　<span style="color:#666;">' + esc(pts.join('／')) + '</span>'
        + '<div class="facility-auto-sub-option" style="white-space:normal;">' + esc(r.note || '') + '　［' + esc(linked) + '］</div></th><td>'
        + ['on', 'off', 'unset'].map((m) => '<label><input type="radio" name="base-santei-' + esc(r.key) + '" value="' + m + '" data-santei-key="' + esc(r.key) + '"' + (cur === m ? ' checked' : '') + '> ' + MODE_LABEL[m] + '</label>').join('')
        + '</td></tr>';
    }).join('');
  }
  // 基準版の「自動算定する診療行為」の一覧を読み直させる（画面は施設 ID ごとに一覧を持ち回るため、控えの ID を外して読ませる）
  async function reloadBaseList() {
    try { facilityAutoCalcActionsFacilityId = null; } catch (e) { return; }   // eslint-disable-line no-undef
    const panel = document.querySelector('[data-facility-panel="auto-calc"]');
    if (panel && !panel.classList.contains('hidden') && typeof renderFacilityAutoCalc === 'function') await renderFacilityAutoCalc();
  }
  window.addEventListener('compat:santei', () => { setTimeout(() => { renderSanteiPanel(); reloadBaseList(); }, 300); });

  // ======================================================================
  // ③ 様式14（オンライン診療の年次報告）
  // ======================================================================
  async function openTelemed() {
    appStyle('telemed_report.css');
    const ok = await appScript('telemed_report.js', 'openTelemedReport');
    if (!ok || typeof openTelemedReport !== 'function') { toast('様式14の部品を読み込めませんでした', 'error'); return; }
    if (!document.getElementById('telemedReportModal')) {   // 統合版の index.html と同じ枠
      const d = document.createElement('div'); d.className = 'tm-overlay'; d.id = 'telemedReportModal';
      d.innerHTML = '<div class="tm" role="dialog" aria-modal="true" aria-label="情報通信機器を用いた診療に係る報告書"><div class="tm-head">'
        + '<h2>情報通信機器を用いた診療に係る報告書</h2><span class="tm-head-sub">別紙様式14（8月報告）</span><span class="tm-spacer-head"></span>'
        + '<button class="tm-x" onclick="closeTelemedReport()" title="閉じる">&times;</button></div><div class="tm-body" id="tmBody"></div></div>';
      document.body.appendChild(d);
    }
    await openTelemedReport();   // eslint-disable-line no-undef
  }
  function mountFacility() {
    const nav = document.querySelector('.facility-side-nav'); const main = document.querySelector('.facility-main');
    if (!nav || !main || nav.querySelector('[data-facility-section="telemed-report"]')) return false;
    const item = document.createElement('button'); item.type = 'button'; item.className = 'facility-side-item'; item.dataset.facilitySection = 'telemed-report'; item.textContent = '様式14（オンライン診療）';
    const after = nav.querySelector('[data-facility-section="monthly-count"]'); if (after) after.after(item); else nav.appendChild(item);
    const sec = document.createElement('section'); sec.className = 'facility-page-section hidden'; sec.dataset.facilityPanel = 'telemed-report';
    sec.innerHTML = '<h2>オンライン診療の報告（様式14）</h2>'
      + '<button type="button" class="facility-new-btn" id="btn-base-telemed-open"><i class="fas fa-file-alt"></i> 報告書を開く</button>'
      + '<div class="facility-auto-sub-option" style="margin-top:12px;white-space:normal;line-height:1.7;">情報通信機器を用いた診療に係る報告書（別紙様式14・毎年8月報告）を、統合版の画面と同じ部品で開きます。'
      + '集計期間は前年8月1日〜当年7月31日です。［カルテから集計］で件数を埋め、手入力の欄と合わせて保存・印刷できます（保存先は統合版と同じ）。</div>';
    const panels = main.querySelectorAll('[data-facility-panel]'); const last = panels[panels.length - 1];
    if (last) last.after(sec); else main.appendChild(sec);
    sec.querySelector('#btn-base-telemed-open').addEventListener('click', openTelemed);
    // 「自動算定」を開くたびに一覧を読み直し（統合版の画面で選んだ内容を写す）、院ごとの算定ルールを出す
    const auto = nav.querySelector('[data-facility-section="auto-calc"]');
    if (auto) auto.addEventListener('click', () => { try { facilityAutoCalcActionsFacilityId = null; } catch (e) { /* 画面本体の読み込み前 */ } setTimeout(renderSanteiPanel, 50); });   // eslint-disable-line no-undef
    return true;
  }
  // このファイルは本文の後ろで読まれるので、画面本体（renderer.js）が施設管理画面の左の一覧をつなぐ前に足せる
  if (!mountFacility()) document.addEventListener('DOMContentLoaded', () => {
    if (mountFacility()) {   // 画面本体がつないだ後に足したときは自分でつなぐ
      const item = document.querySelector('[data-facility-section="telemed-report"]');
      item.addEventListener('click', () => { if (typeof switchFacilitySection === 'function') switchFacilitySection('telemed-report'); });
    }
  });
  C.featuresCUi = { showInventory, renderSanteiPanel, reloadBaseList, openTelemed };
})();
// ---- 担当C ここまで ----

// ---- 担当D ここから ----
// 統合版の独自機能（音声カルテ・証の読み取り・予約で届いた証・スマホからの報告）の部品を、基準版の画面に置く。
// 処理は compat_features_d.js（window.CompatFeatD）。見た目は基準版の画面の既存の部品のクラスに合わせる。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const call = (fn, ...a) => {
    if (window.CompatFeatD && typeof window.CompatFeatD[fn] === 'function') return window.CompatFeatD[fn](...a);
    if (typeof showToast === 'function') showToast('この機能の部品（compat_features_d.js）が読み込まれていません', 'error');
  };
  const CSS = [
    '.featd-voice{border-top:1px solid var(--gray-200);background:var(--gray-50);padding:6px 8px;font-size:12px;max-height:46%;overflow:auto}',
    '.featd-voice-head{display:flex;flex-wrap:wrap;gap:4px;align-items:center}',
    '.featd-voice-head select{height:26px;font-size:12px;max-width:170px}',
    '.featd-voice-title{font-weight:700;margin-right:4px;color:var(--gray-800)}',
    '.featd-voice .whisper-time{font-variant-numeric:tabular-nums;color:var(--gray-600)}',
    '.featd-voice .whisper-rec-btn.recording{background:var(--danger);border-color:var(--danger);color:#fff}',
    '.featd-voice .rec-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--danger);margin-right:3px;vertical-align:middle}',
    '.featd-voice .whisper-rec-btn.recording .rec-dot{background:#fff}',
    '.featd-voice textarea{width:100%;box-sizing:border-box;font-size:12px;border:1px solid var(--gray-300);padding:4px;resize:vertical}',
    '.featd-voice-label{margin:4px 0 2px;color:var(--gray-600);font-size:11px}',
    '.featd-voice .whisper-status{margin-top:4px;font-size:11px;color:var(--gray-600)}',
    '.featd-voice .whisper-status.success{color:var(--success)}.featd-voice .whisper-status.error{color:var(--danger)}',
    '.featd-voice .whisper-file-name{font-size:11px;color:var(--gray-500)}',
    '.featd-ocr{margin:0 0 6px;padding:8px;background:#fff;border:1px solid #d6dedb;border-left:3px solid var(--primary)}',
    '.featd-ocr-row{display:flex;gap:10px;align-items:flex-start}',
    '.featd-ocr-img{max-width:150px;max-height:110px;border:1px solid var(--gray-300);object-fit:contain;background:var(--gray-100)}',
    '.featd-ocr-main{flex:1;min-width:0;font-size:12px}',
    '.featd-ocr-title{font-weight:700;margin-bottom:4px}',
    '.featd-progress{height:6px;background:var(--gray-200);margin:4px 0}.featd-progress div{height:100%;background:var(--primary)}',
    '.featd-cand-table{border-collapse:collapse;margin:4px 0;font-size:12px}.featd-cand-table th{text-align:left;font-weight:400;color:var(--gray-600);padding:1px 10px 1px 0;white-space:nowrap}.featd-cand-table td{padding:1px 8px 1px 0}',
    '.featd-tag{display:inline-block;font-size:10px;padding:0 4px;border:1px solid var(--gray-300);color:var(--gray-600);border-radius:2px;line-height:16px}',
    '.featd-tag.ok{border-color:var(--success);color:var(--success)}.featd-tag.warn{border-color:var(--warning);color:var(--warning)}',
    '.featd-warn{font-size:11px;color:#8a5a00;background:#fff8e6;border-left:3px solid var(--warning);padding:3px 6px;margin:3px 0}',
    '.featd-acts{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
    'input.featd-cand,textarea.featd-cand{background:#fffbe8;outline:1px solid var(--warning)}',
    '.featd-doc{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray-200)}.featd-doc.done{opacity:.7}',
    '.featd-doc-thumb img{width:120px;height:80px;object-fit:cover;border:1px solid var(--gray-300);background:var(--gray-100)}',
    '.featd-doc-meta{flex:1;min-width:0;font-size:12px}',
    '.featd-memo{font-size:12px;white-space:pre-wrap;margin:2px 0}',
    '.featd-line{display:flex;gap:6px;align-items:center;font-size:12px;margin:2px 0}.featd-line span{flex:1}',
    '.featd-docs .featd-docs-count{font-weight:400;color:var(--gray-500);margin-left:6px;font-size:11px}',
    '.featd-count{display:inline-block;min-width:16px;margin-left:3px;padding:0 4px;background:var(--danger);color:#fff;font-size:11px;line-height:16px;border-radius:2px;text-align:center}',
    '#featd-mobile-modal .modal-content{width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column}',
    '#featd-mobile-body{overflow:auto;padding:8px 14px}',
  ].join('\n');
  function docsSection(id) {
    const s = document.createElement('div');
    s.className = 'm3-patient-section insurance-section featd-docs'; s.id = id;
    s.innerHTML = '<div class="m3-section-header insurance-section-header"><span class="m3-section-title">予約・スマホで届いた保険証・医療証<span class="featd-docs-count"></span></span>'
      + '<div class="m3-section-actions insurance-actions"><button type="button" class="m3-icon-btn-sm" data-featd-ui="docs-refresh" title="再読み込み"><i class="fas fa-sync-alt"></i></button></div></div>'
      + '<div class="m3-insurance-list featd-docs-list"><div class="insurance-empty">患者を選択してください。</div></div>';
    return s;
  }
  function ocrParts(modalId, which) {
    const modal = $(modalId); if (!modal || $('featd-ocr-' + which)) return;
    const actions = modal.querySelector('.insurance-modal-actions');
    if (actions) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'insurance-top-action'; b.id = 'featd-ocr-btn-' + which;
      b.textContent = '証の読み取り'; b.title = '保険証・医療証の写真（資格確認書の QR を含む）を読み取って候補を入れる';
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.id = 'featd-ocr-file-' + which; f.hidden = true;
      b.addEventListener('click', () => f.click());
      f.addEventListener('change', () => call('ocrPickFile', which, f));
      actions.appendChild(b); actions.appendChild(f);
    }
    const box = document.createElement('div'); box.id = 'featd-ocr-' + which; box.className = 'featd-ocr hidden';
    const form = modal.querySelector('form'); if (form) form.parentNode.insertBefore(box, form);
  }
  function mount() {
    if ($('featd-style')) return;
    const st = document.createElement('style'); st.id = 'featd-style'; st.textContent = CSS; document.head.appendChild(st);
    // 1. 音声カルテ: 本文の下のボタン列に「音声カルテ」、本文の下に統合版と同じ部品（同じ ID）の枠
    const footer = document.querySelector('.m3-soap-footer'), editor = $('karte-editor');
    if (footer && editor) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'm3-karte-btn'; b.id = 'featd-voice-btn'; b.textContent = '音声カルテ';
      b.title = '録音または音声ファイルから文字起こしし、カルテの文章にして本文に入れる';
      b.addEventListener('click', () => call('voiceToggle'));
      footer.insertBefore(b, footer.firstChild);
      const v = document.createElement('div'); v.id = 'featd-voice'; v.className = 'featd-voice hidden';
      v.innerHTML = '<div class="featd-voice-head"><span class="featd-voice-title">音声カルテ</span>'
        + '<select id="whisperMicSelect"><option value="">マイク選択...</option></select>'
        + '<button type="button" class="m3-karte-btn whisper-rec-btn" id="whisperRecBtn" onclick="whisperToggleRecord()" disabled><span class="rec-dot"></span> 録音</button>'
        + '<span class="whisper-time" id="whisperTime">00:00</span>'
        + '<label class="m3-karte-btn" id="whisperUploadLabel">ファイル読込<input type="file" id="whisperFileInput" accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.ogg,.mp4" style="display:none" onchange="whisperUploadFile(this)"></label>'
        + '<span id="whisperFileName" class="whisper-file-name"></span>'
        + '<select id="whisperPromptSelect"><option value="karte">カルテ</option></select>'
        + '<button type="button" class="m3-karte-btn" id="whisperGenBtn" onclick="whisperGenerate()" disabled>カルテ生成</button>'
        + '<button type="button" class="m3-karte-btn primary" id="whisperApplyBtn" disabled>本文に反映</button>'
        + '<button type="button" class="m3-karte-btn" id="featd-voice-apply-tr">文字起こしを本文へ</button>'
        + '<button type="button" class="m3-tag-close" id="featd-voice-close" title="閉じる"><i class="fas fa-times"></i></button></div>'
        + '<div class="whisper-body" id="whisperBody" style="display:none;">'
        + '<div class="featd-voice-label">文字起こし</div><textarea id="whisperTranscript" rows="3" placeholder="録音すると文字起こし結果が表示されます..."></textarea>'
        + '<div class="featd-voice-label">AI生成カルテ</div><textarea id="whisperKarte" rows="4" placeholder="「カルテ生成」を押すとカルテの文章に整えます..." readonly></textarea>'
        + '</div><div class="whisper-status" id="whisperStatus"></div>';
      editor.parentNode.insertBefore(v, editor.nextSibling);
      $('whisperApplyBtn').addEventListener('click', () => call('voiceApply', 'karte'));
      $('featd-voice-apply-tr').addEventListener('click', () => call('voiceApply', 'transcript'));
      $('featd-voice-close').addEventListener('click', () => call('voiceToggle', false));
    }
    // 2. 証の読み取り: 「医療保険追加」「公費追加」の小窓の上のボタン列に「証の読み取り」、入力欄の上に結果の枠
    ocrParts('insurance-modal', 'ins'); ocrParts('public-expense-modal', 'pub');
    // 3. 予約・スマホで届いた証: 保険等タブの末尾と、ファイルタブの末尾
    const ins = $('insurance-content'); if (ins) ins.appendChild(docsSection('featd-docs-ins'));
    const fil = $('file-content'); if (fil) fil.appendChild(docsSection('featd-docs-file'));
    document.addEventListener('click', (ev) => { if (ev.target.closest('[data-featd-ui="docs-refresh"]')) call('renderDocs'); });
    document.querySelectorAll('.m3-header-zone-patient .m3-panel-tab').forEach((t) => {
      const name = t.textContent.trim();
      if (name === '保険等' || name === 'ファイル') t.addEventListener('click', () => setTimeout(() => call('renderDocs'), 0));
    });
    // 4. スマホからの報告: カルテの見出しのボタン列に「スマホ報告」（未確認の件数つき）、一覧は小窓
    const hdr = document.querySelector('.m3-karte-header-actions');
    if (hdr) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'm3-karte-header-btn'; b.id = 'featd-mobile-btn';
      b.innerHTML = 'スマホ報告<span class="featd-count hidden" id="featd-mobile-count"></span>'; b.title = 'スマホから届いた保険証・医療証・処方・検査結果の報告';
      b.addEventListener('click', () => call('mobileOpen'));
      hdr.insertBefore(b, $('btn-regular-register') || null);
    }
    const m = document.createElement('div'); m.id = 'featd-mobile-modal'; m.className = 'modal hidden';
    m.innerHTML = '<div class="modal-content"><div class="modal-header"><h3>スマホからの報告</h3><div class="modal-header-actions">'
      + '<button type="button" class="m3-icon-btn-sm" id="featd-mobile-refresh" title="再読み込み"><i class="fas fa-sync-alt"></i></button>'
      + '<button class="modal-close" id="featd-mobile-close">&times;</button></div></div>'
      + '<div class="insurance-modal-patient"><div id="featd-mobile-patient">患者を選択してください</div></div><div id="featd-mobile-body"></div></div>';
    document.body.appendChild(m);
    $('featd-mobile-close').addEventListener('click', () => call('mobileClose'));
    $('featd-mobile-refresh').addEventListener('click', () => call('renderMobile'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
// ---- 担当D ここまで ----

// ---- 画面の切り替え ここから（2026-09-24）----
//   普段の入口（app/index.html）は基準版の画面へ移る。従来の画面（app/classic.html）へは受付一覧の上のボタンから（院の指定を引き継ぐ）
(function () {
  function addClassicButton() {
    const anchor = document.getElementById('btn-receipt-claim');
    if (!anchor || document.getElementById('btn-open-classic')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toolbar-btn'; b.id = 'btn-open-classic'; b.title = '従来の画面を別のタブで開く';
    b.innerHTML = '<i class="fas fa-window-restore"></i> 従来の画面';
    b.addEventListener('click', () => window.open('../classic.html' + location.search, '_blank', 'noopener'));
    anchor.insertAdjacentElement('afterend', b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addClassicButton); else addClassicButton();
})();
// ---- 画面の切り替え ここまで ----

// ---- 接続クリニックの選択 ここから（2026-09-25）----
//   ログイン欄の上に「接続クリニック」を置く（統合版の画面と同じ部品 ClinicCtx.renderPicker）。初期値は起動時の院。
//   選び直したら、その院でページを読み直す（ClinicCtx.select）。選んだ院に所属していない ID はログインで断る（compat_api.js）
(function () {
  async function addClinicPicker() {
    const form = document.getElementById('login-form');
    if (!form || !window.ClinicCtx || document.getElementById('login-clinic-picker')) return;
    if (!document.getElementById('login-clinic-picker-style')) {   // 統合版の画面と同じ見た目
      const st = document.createElement('style'); st.id = 'login-clinic-picker-style';
      st.textContent = '.clinic-picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:6px}.clinic-picker .clinic-pick{padding:9px 4px;border:1px solid #d2dbd8;background:#fff;color:#242927;font-size:13px;border-radius:2px;cursor:pointer}.clinic-picker .clinic-pick:hover{background:#f4f6f5}.clinic-picker .clinic-pick.on{background:#0a4d12;color:#fff;border-color:#0a4d12;font-weight:700}';
      document.head.appendChild(st);
    }
    const wrap = document.createElement('div'); wrap.className = 'form-group login-clinic-group';
    wrap.innerHTML = '<label for="login-clinic-picker" style="display:block;font-size:12px;color:#555;margin-bottom:4px;">接続クリニック</label><div id="login-clinic-picker" class="clinic-picker"></div>';
    form.insertBefore(wrap, form.firstChild);
    const box = document.getElementById('login-clinic-picker');
    try { if (typeof initSupabase === 'function' && !(typeof isSupabaseReady === 'function' && isSupabaseReady())) await initSupabase(); } catch (e) { /* 読めなければ控えの一覧 */ }
    try { await ClinicCtx.loadClinics(); } catch (e) { /* 控えの一覧 */ }
    // テスト用クリニックは URL の ?clinic=test で開く決まり（clinic_context.js）なので、選んだら URL ごと切り替える
    const go = (id) => {
      if (id === ClinicCtx.id()) return;
      const q = new URLSearchParams(location.search);
      if (/^test/.test(id)) q.set('clinic', id); else q.delete('clinic');
      try { localStorage.setItem('karte_clinic', id); } catch (e) { /* noop */ }
      const qs = q.toString(); location.href = location.pathname + (qs ? '?' + qs : '') + location.hash;
    };
    ClinicCtx.renderPicker(box, { selected: ClinicCtx.id(), includeTest: true, onChange: go });
    const name = document.getElementById('login-facility-name'); if (name) name.textContent = ClinicCtx.info().name;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addClinicPicker); else addClinicPicker();
})();
// ---- 接続クリニックの選択 ここまで ----
