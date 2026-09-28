// ===== mobile_inbox.js — スマホ版（医療補助）からの報告を PC のカルテで受け取る =====
//   受付一覧: 📱 未確認の件数／カルテ: 保険証タブ・処方・検査の各欄に「スマホからの報告」を候補として表示。
//   候補は担当者が確認して追加したときだけ本体（患者写真・処方・検査）に入る。確認したら「済」で status=applied。
//   元データ: karte_mobile_reports（1報告＝1行）＋ Storage mobile-reports。患者の対応付けは patient_no か氏名。
window.MobileInbox = (function () {
  'use strict';
  const BUCKET = 'mobile-reports';
  const LABEL = { insurance: '保険証', iryo: '医療証', rx: '処方した薬', exam: '検査結果' };
  const PHOTO_TYPE = { insurance: '保険証', iryo: '医療証', rx: '処方', exam: '検査結果' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  let rows = [], loadedFor = '', timer = null, urlCache = {};

  function client() { return (typeof supabaseClient !== 'undefined' && supabaseClient) || null; }
  function norm(s) { return String(s || '').replace(/[\s　]/g, ''); }
  function dateNow() { return (typeof selectedDate !== 'undefined' && selectedDate) || new Date().toISOString().slice(0, 10); }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }
  function curPatient() { return (typeof patients !== 'undefined' && typeof currentPatientId !== 'undefined') ? patients.find(x => x.id === currentPatientId) : null; }

  async function fetchRows(date) {
    const c = client(); if (!c || typeof isSupabaseReady === 'function' && !isSupabaseReady()) return rows;
    const { data, error } = await c.from('karte_mobile_reports').select('*').eq('clinic_id', currentClinicId()).eq('visit_date', date).order('created_at', { ascending: true });
    if (error) { console.warn('[mobile_inbox] 読み込み失敗:', error.message); return rows; }
    rows = data || []; loadedFor = date; return rows;
  }
  function matches(r, p) {
    if (!p) return false;
    if (r.patient_no && p.id && r.patient_no === p.id) return true;
    return norm(r.patient_name) === norm(p.name);
  }
  function forPatient(p, date) { return rows.filter(r => r.visit_date === (date || loadedFor) && matches(r, p)); }
  function pendingCount(p, date) { return forPatient(p, date).filter(r => r.status === 'pending').length; }
  function badgeHtml(p, date) {
    const all = forPatient(p, date); if (!all.length) return '';
    const n = all.filter(r => r.status === 'pending').length;
    return n ? '<span class="mi-badge" title="スマホからの報告 未確認 ' + n + '件">📱' + n + '</span>' : '<span class="mi-badge done" title="スマホからの報告は確認済み">📱</span>';
  }
  async function signedUrl(path) {
    if (!path) return '';
    if (urlCache[path] && urlCache[path].exp > Date.now()) return urlCache[path].url;
    const c = client(); const { data, error } = await c.storage.from(BUCKET).createSignedUrl(path, 600);
    if (error) return '';
    urlCache[path] = { url: data.signedUrl, exp: Date.now() + 500000 };
    return data.signedUrl;
  }
  async function toDataUrl(path) {
    const c = client(); const { data, error } = await c.storage.from(BUCKET).download(path);
    if (error) throw error;
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = e => res(e.target.result); fr.onerror = rej; fr.readAsDataURL(data); });
  }
  async function toFile(path, name) {
    const c = client(); const { data, error } = await c.storage.from(BUCKET).download(path);
    if (error) throw error;
    return new File([data], name || 'mobile.jpg', { type: 'image/jpeg' });
  }
  function fmt(iso) { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  // ---- 候補づくり ----
  function memoLines(memo) { return String(memo || '').split(/[\r\n、，,／/・;]+/).map(s => s.trim()).filter(Boolean); }
  function drugCandidates(memo) {
    const lines = memoLines(memo); const out = [];
    const pool = [];
    if (typeof drugs !== 'undefined') drugs.forEach(d => pool.push(d));
    try { if (typeof invDrugMenu === 'function') invDrugMenu().forEach(d => { if (!pool.find(x => x.id === d.id)) pool.push(d); }); } catch (e) { /* 在庫未読込 */ }
    lines.forEach(line => {
      const key = line.replace(/\s+/g, '');
      const hits = pool.filter(d => { const n = String(d.name || '').replace(/\s+/g, ''); return n && (key.indexOf(n) >= 0 || n.indexOf(key.slice(0, Math.max(4, Math.min(8, key.length)))) >= 0); }).slice(0, 3);
      out.push({ line, hits });
    });
    return out;
  }
  function examCandidates(memo) {
    const text = norm(memo); const out = [];
    if (typeof examItems === 'undefined') return out;
    examItems.forEach(e => { if (text.indexOf(norm(e.name)) >= 0) out.push(e); });
    return out;
  }

  // ---- 描画 ----
  function ensurePanel(id, parentSel, afterSel) {
    let el = $(id); if (el) return el;
    const parent = document.querySelector(parentSel); if (!parent) return null;
    el = document.createElement('div'); el.id = id; el.className = 'mi-panel';
    const after = afterSel ? parent.querySelector(afterSel) : null;
    if (after && after.nextSibling) parent.insertBefore(el, after.nextSibling); else if (after) parent.appendChild(el); else parent.insertBefore(el, parent.firstChild);
    return el;
  }
  function cardHead(r) {
    return '<div class="mi-head"><b>📱 ' + LABEL[r.kind] + '</b><span class="mi-meta">' + esc(fmt(r.created_at)) + (r.reported_by ? '　' + esc(String(r.reported_by).split('@')[0]) : '') + '</span>' +
      (r.status === 'pending' ? '<span class="mi-new">未確認</span>' : '<span class="mi-ok">確認済み</span>') + '</div>';
  }
  async function thumbHtml(r) {
    if (!r.photo_path) return '';
    const u = await signedUrl(r.photo_path);
    return u ? '<a class="mi-thumb" href="' + esc(u) + '" target="_blank" rel="noopener" title="拡大"><img src="' + esc(u) + '" alt=""></a>' : '';
  }
  async function renderRx() {
    const p = curPatient(); const box = ensurePanel('mobileRxPanel', '#m3BlockRx', '.row'); if (!box) return;
    const list = p ? forPatient(p, dateNow()).filter(r => r.kind === 'rx') : [];
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    const parts = [];
    for (const r of list) {
      if (r.status !== 'pending') continue;
      const cands = drugCandidates(r.memo);
      const candHtml = cands.map(c => '<div class="mi-line"><span class="mi-q">' + esc(c.line) + '</span>' +
        (c.hits.length ? c.hits.map(d => '<button class="mi-btn add" onclick="MobileInbox.addDrug(\'' + esc(d.id) + '\')">＋ ' + esc(d.name) + '</button>').join('')
                       : '<button class="mi-btn" onclick="MobileInbox.toSearch(\'' + esc(c.line) + '\')">検索欄へ</button>') + '</div>').join('');
      parts.push('<div class="mi-card">' + cardHead(r) + '<div class="mi-body">' + (await thumbHtml(r)) + '<div class="mi-text">' + (r.memo ? '<div class="mi-memo">' + esc(r.memo) + '</div>' : '<div class="mi-memo muted">（メモなし・写真のみ）</div>') + candHtml + '</div></div>' +
        '<div class="mi-acts">' + (r.photo_path ? '<button class="mi-btn" onclick="MobileInbox.savePhoto(\'' + r.id + '\')">写真を患者写真に保存</button>' : '') + '<button class="mi-btn ok" onclick="MobileInbox.apply(\'' + r.id + '\')">済（確認した）</button><button class="mi-btn" onclick="MobileInbox.dismiss(\'' + r.id + '\')">却下</button></div></div>');
    }
    const done = list.filter(r => r.status !== 'pending').length;
    box.innerHTML = '<div class="mi-title">スマホからの処方報告' + (done ? '<span class="mi-meta">　確認済み ' + done + '件</span>' : '') + '</div>' + (parts.join('') || '<div class="mi-memo muted">未確認の報告はありません</div>');
  }
  async function renderExam() {
    const p = curPatient(); const box = ensurePanel('mobileExamPanel', '#m3BlockExam', '.row'); if (!box) return;
    const list = p ? forPatient(p, dateNow()).filter(r => r.kind === 'exam') : [];
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    const k = (typeof karteData !== 'undefined' && p) ? karteData[p.id] : null;
    const parts = [];
    for (const r of list) {
      if (r.status !== 'pending') continue;
      const cands = examCandidates(r.memo);
      const candHtml = cands.length ? '<div class="mi-line"><span class="mi-q">検査項目の候補</span>' + cands.map(e => { const on = k && (k.selectedExams || []).indexOf(e.id) >= 0; return '<button class="mi-btn add' + (on ? ' on' : '') + '" onclick="MobileInbox.addExam(\'' + esc(e.id) + '\')">' + (on ? '✓ ' : '＋ ') + esc(e.name) + '</button>'; }).join('') + '</div>' : '';
      parts.push('<div class="mi-card">' + cardHead(r) + '<div class="mi-body">' + (await thumbHtml(r)) + '<div class="mi-text">' + (r.memo ? '<div class="mi-memo">' + esc(r.memo) + '</div>' : '<div class="mi-memo muted">（メモなし・写真のみ）</div>') + candHtml + '</div></div>' +
        '<div class="mi-acts">' + (r.photo_path ? '<button class="mi-btn" onclick="MobileInbox.savePhoto(\'' + r.id + '\')">写真を患者写真（検査結果）に保存</button>' : '') + '<button class="mi-btn ok" onclick="MobileInbox.apply(\'' + r.id + '\')">済（確認した）</button><button class="mi-btn" onclick="MobileInbox.dismiss(\'' + r.id + '\')">却下</button></div></div>');
    }
    const done = list.filter(r => r.status !== 'pending').length;
    box.innerHTML = '<div class="mi-title">スマホからの検査報告' + (done ? '<span class="mi-meta">　確認済み ' + done + '件</span>' : '') + '</div>' + (parts.join('') || '<div class="mi-memo muted">未確認の報告はありません</div>');
  }
  async function renderDocs() {
    const p = curPatient(); const anchor = $('rsvDocsPanel'); if (!anchor) return;
    let box = $('mobileDocsPanel'); if (!box) { box = document.createElement('div'); box.id = 'mobileDocsPanel'; box.className = 'mi-panel'; anchor.parentNode.insertBefore(box, anchor.nextSibling); }
    const list = p ? forPatient(p, dateNow()).filter(r => r.kind === 'insurance' || r.kind === 'iryo') : [];
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    const parts = [];
    for (const r of list) {
      parts.push('<div class="mi-card' + (r.status !== 'pending' ? ' done' : '') + '">' + cardHead(r) + '<div class="mi-body">' + (await thumbHtml(r)) + '<div class="mi-text">' + (r.memo ? '<div class="mi-memo">' + esc(r.memo) + '</div>' : '') + '</div></div>' +
        (r.status === 'pending' ? '<div class="mi-acts">' + (r.photo_path ? '<button class="mi-btn add" onclick="MobileInbox.ocr(\'' + r.id + '\')">OCRで読み取る</button><button class="mi-btn" onclick="MobileInbox.savePhoto(\'' + r.id + '\')">患者写真に保存</button>' : '') + '<button class="mi-btn ok" onclick="MobileInbox.apply(\'' + r.id + '\')">確認済みにする</button><button class="mi-btn" onclick="MobileInbox.dismiss(\'' + r.id + '\')">却下</button></div>' : '') + '</div>');
    }
    box.innerHTML = '<div class="mi-title">スマホから届いた保険証・医療証（現場で提示）</div>' + parts.join('');
  }
  function renderPanels() { renderRx(); renderExam(); renderDocs(); }

  // ---- 操作 ----
  function byId(id) { return rows.find(r => String(r.id) === String(id)); }
  async function setStatus(id, status, note) {
    const c = client(); const r = byId(id); if (!c || !r) return;
    let who = ''; try { who = (typeof currentUserEmail === 'function' && currentUserEmail()) || (typeof authUser !== 'undefined' && authUser && authUser.email) || ''; } catch (e) { who = ''; }
    const { error } = await c.from('karte_mobile_reports').update({ status, applied_by: who || null, applied_at: new Date().toISOString(), applied_note: note || null }).eq('id', id);
    if (error) { toast('更新できませんでした: ' + error.message); return; }
    r.status = status; r.applied_note = note || null;
    renderPanels(); if (typeof renderPatientList === 'function') renderPatientList();
  }
  function apply(id) { setStatus(id, 'applied', ''); toast('確認済みにしました'); }
  function dismiss(id) { if (!confirm('この報告を却下しますか？（カルテには何も入りません）')) return; setStatus(id, 'dismissed', ''); }
  function addDrug(drugId) { if (typeof window.addDrug === 'function') { window.addDrug(drugId); toast('処方に追加しました（用量・日数を確認してください）'); renderRx(); } }
  function toSearch(text) { const s = $('drugSearch'); if (!s) return; s.value = text; s.focus(); if (typeof searchDrug === 'function') searchDrug(text); s.scrollIntoView({ block: 'center' }); }
  function addExam(id) { const p = curPatient(); const k = p && karteData[p.id]; if (!k) return; if ((k.selectedExams || []).indexOf(id) >= 0) { toast('すでに選択済みです'); return; } if (typeof toggleExam === 'function') toggleExam(id); if (typeof renderAllKarte === 'function') renderAllKarte(); toast('検査に追加しました'); }
  async function savePhoto(id) {
    const r = byId(id); const p = curPatient(); if (!r || !p || !r.photo_path) return;
    if (typeof uploadPatientPhoto !== 'function') { toast('患者写真の機能がありません'); return; }
    try {
      const f = await toFile(r.photo_path, r.kind + '.jpg');
      const res = await uploadPatientPhoto(p.id, PHOTO_TYPE[r.kind] || 'その他', f);
      if (!res.success) { toast('保存できませんでした: ' + res.error); return; }
      toast('患者写真に保存しました（' + (PHOTO_TYPE[r.kind] || 'その他') + '）');
      if (typeof M3 !== 'undefined' && M3.loadFiles) M3.loadFiles(p);
    } catch (e) { toast('保存できませんでした: ' + e.message); }
  }
  async function ocr(id) {
    const r = byId(id); if (!r || !r.photo_path) return;
    try {
      const du = await toDataUrl(r.photo_path);
      if (r.kind === 'iryo' && typeof processIryoOcrImage === 'function') processIryoOcrImage(du);
      else if (typeof processInsuranceOcrImage === 'function') processInsuranceOcrImage(du);
      const w = $('insuranceOcrPreviewWrap') || $('iryoOcrPreviewWrap'); if (w) w.scrollIntoView({ block: 'center' });
    } catch (e) { toast('画像を読めませんでした: ' + e.message); }
  }

  // ---- 更新（60秒ごと・日付変更・画面切替） ----
  async function refresh() {
    if (typeof isSupabaseReady === 'function' && !isSupabaseReady()) return;
    const before = rows.filter(r => r.status === 'pending').length;
    await fetchRows(dateNow());
    const after = rows.filter(r => r.status === 'pending').length;
    if (typeof renderPatientList === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'list') renderPatientList();
    renderPanels();
    if (after > before && typeof showToast === 'function') showToast('スマホから報告が ' + (after - before) + ' 件届きました');
  }
  function install() {
    if (typeof renderAllKarte === 'function') { const o = renderAllKarte; renderAllKarte = function () { const r = o.apply(this, arguments); try { renderRx(); renderExam(); } catch (e) { console.warn('[mobile_inbox]', e); } return r; }; }
    if (typeof openInsuranceModal === 'function') { const o = openInsuranceModal; openInsuranceModal = function () { const r = o.apply(this, arguments); try { renderDocs(); } catch (e) { console.warn('[mobile_inbox]', e); } return r; }; }
    if (typeof onDateChange === 'function') { const o = onDateChange; onDateChange = function () { const r = o.apply(this, arguments); refresh(); return r; }; }
    if (!timer) timer = setInterval(refresh, 60000);
    // ログイン後（患者が読めるようになったら）最初の読み込み
    let tries = 0; const kick = setInterval(() => { tries++; if ((typeof isSupabaseReady === 'function' && isSupabaseReady() && typeof authUser !== 'undefined' && authUser) || tries > 120) { clearInterval(kick); refresh(); } }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();

  return { refresh, fetchRows, forPatient, pendingCount, badgeHtml, renderPanels, apply, dismiss, addDrug, toSearch, addExam, savePhoto, ocr, rows: () => rows, drugCandidates, examCandidates };
})();
