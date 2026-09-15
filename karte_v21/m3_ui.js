// ===== m3_ui.js — v20: 旧カルテ（M3 DigiKar）と同じ画面構成にするための UI 層 =====
// app.js（機能本体）は極力触らず、描画だけをこのファイルで差し替える。
//   ・受付一覧: 23列（旧カルテと同じ列）・ステータス11種のプルダウン・絞り込み／表示項目
//   ・カルテ: 左=患者パネル14タブ（閉じると縦レール）／中央=主訴・所見＋処置・行為／右=行為マスタ13区分
//   ・新カルテ独自機能（予約連携・音声カルテ・OCR/QR・レセプト・様式14・在庫・写真）は同じ画面の中に配置
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LS = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const svg = (id, cls) => '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#' + id + '"/></svg>';

  // ---------- ステータス（旧カルテと同じ11種。内部キーは新カルテ互換） ----------
  const STATUSES = [
    { k: 'reserved', l: '予約済', c: '#488e50' }, { k: 'waiting', l: '受付中', c: '#d7708b' }, { k: 'ready', l: '診察待', c: '#e39a2c' },
    { k: 'active', l: '診察中', c: '#1bacac' }, { k: 'exam', l: '検査中', c: '#3d8bd4' }, { k: 'proc', l: '処置中', c: '#7d63bf' },
    { k: 'billing', l: '会計待', c: '#d01111' }, { k: 'done', l: '会計済', c: '#839590' }, { k: 'rebill', l: '再計待', c: '#c96a1d' },
    { k: 'absent', l: '不在', c: '#6b7683' }, { k: 'cancel', l: '取消', c: '#3b3f3e' },
  ];
  const ST = Object.fromEntries(STATUSES.map(s => [s.k, s]));

  // ---------- 受付一覧の列（旧カルテと同じ並び・幅） ----------
  const COLS = [
    { k: 'num', l: '番号', w: 40, sort: true }, { k: 'rsv', l: '予約', w: 60, sort: true }, { k: 'time', l: '時間', w: 60, sort: true },
    { k: 'status', l: 'ステータス', w: 84, sort: true }, { k: 'pno', l: '患者番号', w: 64, sort: true }, { k: 'name', l: '患者氏名', w: 148, sort: true },
    { k: 'dob', l: '生年月日', w: 90, off: true }, { k: 'age', l: '年齢', w: 40, sort: true }, { k: 'ins', l: '保険', w: 71 }, { k: 'dept', l: '診療科', w: 60 },
    { k: 'rsvdept', l: '予約診療科', w: 96 }, { k: 'doctor', l: '医師', w: 62 }, { k: 'prev', l: '前回受付日', w: 82 }, { k: 'memo', l: '患者メモ', w: 135 },
    { k: 'rmemo', l: '受付メモ', w: 145 }, { k: 'first', l: '初', w: 24 }, { k: 'line', l: '端', w: 24 }, { k: 'pay', l: '支払', w: 24 },
    { k: 'kaikei', l: '会計', w: 55 }, { k: 'fax', l: '処方箋', w: 71 }, { k: 'out', l: '出', w: 24 }, { k: 'erx', l: '電', w: 24 }, { k: 'warn', l: '警', w: 24 },
    { k: 'ops', l: '', w: 135 },
  ];
  const COL_TOGGLE_LABELS = { num: '番号', rsv: '予約時間', time: '受付時間', status: 'ステータス', pno: '患者番号', name: '患者氏名', dob: '生年月日', age: '年齢', ins: '保険', dept: '診療科', rsvdept: '予約診療科', doctor: '医師', prev: '前回受付日', memo: '患者メモ', rmemo: '受付メモ', first: '初診', line: 'LINE連携', pay: '支払', kaikei: '会計', fax: '処方箋FAX', out: '処方箋出力済み', erx: '電子処方箋希望', warn: 'カルテ警告' };
  const DEPTS = ['内科', '在宅', '夜間休日外来', '発熱外来'];

  const state = {
    cols: LS.get('m3_cols', null),                 // 表示列 {k:true/false}
    filter: LS.get('m3_filter', { st: null, doc: null, dept: null }),   // null=すべて
    sort: LS.get('m3_sort', { k: 'num', asc: false }),
    rmemo: LS.get('m3_recmemo', {}),
    leftOpen: false, leftTab: 'history', rightRail: false, rightTab: 'exam',
    fontSize: LS.get('m3_fontsize', 14), docs: false, waiting: false,
  };
  if (!state.cols) { state.cols = {}; COLS.forEach(c => { state.cols[c.k] = !c.off; }); }

  // ---------- 小物 ----------
  function ymdLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso;
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' (' + '日月火水木金土'[d.getDay()] + ')';
  }
  function ageLabel(p) {
    if (!p.dob) return (p.age != null && p.age !== '') ? p.age + '歳' : '-';
    const t = new Date(), b = new Date(p.dob); if (isNaN(b)) return p.age + '歳';
    let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth();
    if (t.getDate() < b.getDate()) m--; if (m < 0) { y--; m += 12; }
    return y + '歳' + m + 'ヶ月';
  }
  function rsvOf(p) { return (window.RsvSync && RsvSync.visitFor) ? RsvSync.visitFor(p, selectedDate) : null; }
  function dbVisitOf(p) { if (!p.dbSource || !p.dbVisits) return null; const md = isoToMD(selectedDate); return p.dbVisits.find(v => v.date === md) || null; }
  function statusOf(p) {
    const rv = rsvOf(p);
    if (p.status && ST[p.status]) {
      if (p.status === 'reserved' && rv && rv.status !== 'reserved') return 'waiting';
      return p.status;
    }
    if (rv) return rv.status === 'reserved' ? 'reserved' : 'waiting';
    if (p.dbSource) return 'done';
    return 'waiting';
  }
  function karteOf(p) { return (typeof karteData !== 'undefined' && karteData[p.id]) || {}; }
  function doctorOf(p) {
    const dv = dbVisitOf(p); if (dv && dv.doctor) return dv.doctor;
    if (p.doctor) return p.doctor;
    return (typeof getShiftDoctor === 'function' ? (getShiftDoctor(selectedDate) || '') : '');
  }
  function insShort(s) { s = String(s || ''); return s.replace(/(\d)割$/, ' $1割'); }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }

  // ---------- 受付一覧 ----------
  function renderHead() {
    const tr = $('m3Head'); if (!tr) return;
    tr.innerHTML = COLS.filter(c => state.cols[c.k] !== false).map(c => {
      const sortable = c.sort ? ' sortable' : '';
      const on = state.sort.k === c.k;
      const arrows = c.sort ? '<span class="sort" style="' + (on ? 'color:#5e6b67' : '') + '">' + svg('i-sortup') + svg('i-sortdown') + '</span>' : '';
      return '<th class="' + sortable + '" style="width:' + c.w + 'px"' + (c.sort ? ' onclick="M3.sort(\'' + c.k + '\')"' : '') + '>' + c.l + arrows + '</th>';
    }).join('');
  }
  function sortKey(p, k) {
    const rv = rsvOf(p);
    switch (k) {
      case 'num': return p._origNum || 0;
      case 'rsv': return rv ? rv.time : '99:99';
      case 'time': return p.arrivedAt || '99:99';
      case 'status': return STATUSES.findIndex(s => s.k === statusOf(p));
      case 'pno': return String(p.id || '');
      case 'name': return p.nameKana || p.name || '';
      case 'age': return Number(p.age) || 0;
    }
    return 0;
  }
  function applyFilter(list) {
    const f = state.filter;
    return list.filter(p => {
      if (f.st && !f.st.includes(statusOf(p))) return false;
      if (f.doc && !f.doc.includes(doctorOf(p) || '(未設定)')) return false;
      if (f.dept && !f.dept.includes(p.department || dbVisitOf(p)?.dept || '内科')) return false;
      return true;
    });
  }
  function cell(k, p, i) {
    const rv = rsvOf(p), k2 = karteOf(p), st = statusOf(p), dv = dbVisitOf(p);
    const received = !!p.arrivedAt && st !== 'reserved';
    switch (k) {
      case 'num': return '<td class="num">' + (received ? String(p._origNum || i + 1).padStart(3, '0') : '-') + '</td>';
      case 'rsv': return '<td class="num">' + (rv ? esc(rv.time) : '-') + '</td>';
      case 'time': return '<td class="num">' + (received ? esc(p.arrivedAt) : (dv && dv.time ? esc(dv.time) : '-')) + '</td>';
      case 'status': return '<td><button class="m3-status" data-st="' + st + '" onclick="event.stopPropagation();M3.statusMenu(this,\'' + esc(p.id) + '\')"><span>' + ST[st].l + '</span>' + svg('i-caret') + '</button></td>';
      case 'pno': return '<td class="num" style="color:#0964a5">' + esc(p.id) + '</td>';
      case 'name': return '<td><span class="pt-kana">' + esc(p.nameKana || '') + '</span><span class="pt-name">' + esc(p.name) + '</span></td>';
      case 'dob': return '<td class="num">' + (p.dob ? esc(p.dob.replace(/-/g, '/')) : '-') + '</td>';
      case 'age': return '<td class="num">' + esc(p.age != null && p.age !== '' ? p.age : '-') + '</td>';
      case 'ins': return '<td class="wrap"><span class="cell-edit">' + esc(insShort(p.insurance) || '保険無し') + '<button class="edit-icon" title="保険証情報" onclick="event.stopPropagation();M3.editFrom(\'' + esc(p.id) + '\',\'ins\')">' + svg('i-pencil') + '</button></span></td>';
      case 'dept': return '<td><span class="cell-edit">' + esc(p.department || '内科') + '<button class="edit-icon" title="診療科を変更" onclick="event.stopPropagation();M3.editDept(\'' + esc(p.id) + '\')">' + svg('i-pencil') + '</button></span></td>';
      case 'rsvdept': return '<td class="wrap">' + (rv ? esc(rv.department === '美容' ? '美容' : (p.rsvService || rv.department || '-')) : '-') + '</td>';
      case 'doctor': return '<td class="wrap"><span class="cell-edit">' + esc(doctorOf(p) || '-') + '<button class="edit-icon" title="担当医を変更" onclick="event.stopPropagation();M3.editDoctor(\'' + esc(p.id) + '\')">' + svg('i-pencil') + '</button></span></td>';
      case 'prev': { const l = (typeof prevVisitLabel === 'function') ? prevVisitLabel(p) : '-'; return '<td class="num">' + (l === '-' || !l ? (k2.isFirstVisit === false ? '' : '初') : esc(l)) + '</td>'; }
      case 'memo': return '<td class="wrap" title="' + esc(p.memo || '') + '"><span class="cell-edit"><span style="max-height:38px;overflow:hidden;display:inline-block;">' + esc(p.memo || '') + '</span><button class="edit-icon" title="患者メモを編集" onclick="event.stopPropagation();M3.editMemo(\'' + esc(p.id) + '\')">' + svg('i-pencil') + '</button></span></td>';
      case 'rmemo': { const m = state.rmemo[p.id + '|' + selectedDate] || ''; return '<td class="wrap" title="' + esc(m) + '"><span class="cell-edit"><span style="max-height:38px;overflow:hidden;display:inline-block;">' + esc(m) + '</span><button class="edit-icon" title="受付メモを編集" onclick="event.stopPropagation();M3.editRecMemo(\'' + esc(p.id) + '\')">' + svg('i-pencil') + '</button></span></td>'; }
      case 'first': return '<td class="num">' + (k2.isFirstVisit ? '<span class="first-mark" title="初診">初</span>' : '') + '</td>';
      case 'line': return '<td class="num">' + (rv && rv.code ? '<span title="予約システム経由（予約番号 ' + esc(rv.code) + '）" style="color:#0a4d12">' + svg('i-phone') + '</span>' : '') + '</td>';
      case 'pay': return '<td class="num" title="' + esc(p.payMethod || '') + '">' + (p.payMethod ? '<span style="font-size:11px;color:#0964a5">' + esc(p.payMethod.slice(0, 2)) + '</span>' : '') + '</td>';
      case 'kaikei': return '<td>' + (st === 'billing' ? '<span class="kaikei-tag">会計</span>' : (st === 'done' && !p.dbSource ? '<span class="kaikei-tag done">済</span>' : '')) + '</td>';
      case 'fax': return '<td>' + (k2.rxModeExternal ? '<button class="fax-btn" onclick="event.stopPropagation();M3.faxFrom(\'' + esc(p.id) + '\')" title="院外処方箋（FAX）を出す">FAX希望</button>' : '') + '</td>';
      case 'out': return '<td class="num">' + (k2.rxPrinted ? '<span title="処方箋出力済み">' + svg('i-docout') + '</span>' : '') + '</td>';
      case 'erx': return '<td class="num">' + (k2.erxWanted ? '<span title="電子処方箋希望" style="color:#0079d1">電</span>' : '') + '</td>';
      case 'warn': { const w = []; if ((p.allergies || []).length) w.push('アレルギー: ' + p.allergies.join(','));
        if (p.insWarn) w.push(p.insWarn); if (rv && (typeof RsvSync !== 'undefined') && rv.matchStatus === 'CANDIDATE') w.push('同名候補が複数');
        return '<td class="num">' + (w.length ? '<span class="warn-ico" title="' + esc(w.join(' / ')) + '">' + svg('i-warn') + '</span>' : '') + '</td>'; }
      case 'ops': return '<td><div class="row-acts">' +
        (st === 'reserved' ? '<button title="受付する（来院）" onclick="event.stopPropagation();rsvArrive(\'' + esc(p.id) + '\')">' + svg('i-clipboard') + '</button>' : '<button title="受付票・問診票" onclick="event.stopPropagation();M3.showQuestionnaire(\'' + esc(p.id) + '\')">' + svg('i-clipboard') + '</button>') +
        '<button title="患者メモ" onclick="event.stopPropagation();M3.editMemo(\'' + esc(p.id) + '\')">' + svg('i-memo') + '</button>' +
        '<button title="処方（カルテを開く）" onclick="event.stopPropagation();openKarte(\'' + esc(p.id) + '\')">' + svg('i-rx') + '</button>' +
        '<button title="患者情報" onclick="event.stopPropagation();M3.editFrom(\'' + esc(p.id) + '\',\'patient\')"' + '>' + svg('i-info') + '</button>' +
        '</div></td>';
    }
    return '<td></td>';
  }
  function renderList() {
    const tbody = $('patientListBody'); if (!tbody) return;
    if (typeof showDateShift === 'function') showDateShift(selectedDate);
    const lbl = $('m3DateLabel'); if (lbl) lbl.textContent = ymdLabel(selectedDate);
    const ld = $('listDate'); if (ld && ld.value !== selectedDate) ld.value = selectedDate;
    renderHead();
    let list = getPatientsForDate(selectedDate);
    list.forEach((p, i) => { p._origNum = i + 1; });
    const all = list.length;
    list = applyFilter(list);
    const dir = state.sort.asc ? 1 : -1;
    list.sort((a, b) => { const x = sortKey(a, state.sort.k), y = sortKey(b, state.sort.k); return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ja')); });
    const cnt = $('m3Count'); if (cnt) cnt.textContent = all;
    const fc = $('m3FilterClear'); if (fc) fc.disabled = !(state.filter.st || state.filter.doc || state.filter.dept);
    const fb = $('m3FilterBtn'); if (fb) fb.classList.toggle('on', !!(state.filter.st || state.filter.doc || state.filter.dept));
    let wait = 0, active = 0, done = 0, reserved = 0;
    list.forEach(p => { const s = statusOf(p); if (s === 'reserved') reserved++; else if (s === 'active') active++; else if (s === 'done') done++; else wait++; });
    ['listWait', 'listActive', 'listDone', 'listReserved'].forEach((id, i) => { const e = $(id); if (e) e.textContent = [wait, active, done, reserved][i]; });
    const nb = $('m3NoticeBadge'); if (nb) { nb.textContent = reserved; nb.style.display = reserved ? '' : 'none'; }
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="' + COLS.length + '" class="m3-empty">この日の受付患者はいません' + (all ? '（絞り込みで ' + all + ' 件が非表示）' : '') + '</td></tr>'; return; }
    const vis = COLS.filter(c => state.cols[c.k] !== false);
    tbody.innerHTML = list.map((p, i) => '<tr class="m3-row" onclick="openKarte(\'' + esc(p.id) + '\')">' + vis.map(c => cell(c.k, p, i)).join('') + '</tr>').join('');
  }

  // ---------- メニュー／ポップオーバー ----------
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } document.removeEventListener('mousedown', onDocDown, true); }
  function onDocDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function openMenu(anchor, items) {
    closeMenu();
    menuEl = document.createElement('div'); menuEl.className = 'm3-menu';
    menuEl.innerHTML = items.map(it => it.sep ? '<div class="mi sep' + (it.muted ? ' muted' : '') + '">' + it.html + '</div>' : '<div class="mi' + (it.muted ? ' muted' : '') + '">' + it.html + '</div>').join('');
    document.body.appendChild(menuEl);
    Array.from(menuEl.children).forEach((el, i) => { const it = items[i]; if (it.fn) el.addEventListener('click', () => { closeMenu(); it.fn(); }); });
    const r = anchor.getBoundingClientRect(); const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    let x = r.left, y = r.bottom + 2;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 2);
    menuEl.style.left = x + 'px'; menuEl.style.top = y + 'px';
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  }

  // ---------- 受付: 操作 ----------
  const M3 = window.M3 = {};
  M3.statusMenu = function (btn, id) {
    const p = patients.find(x => x.id === id); if (!p) return;
    const cur = statusOf(p);
    openMenu(btn, STATUSES.map(s => ({ html: '<span class="dot" style="background:' + s.c + '"></span>' + s.l + (s.k === cur ? '　✓' : ''), fn: () => M3.setStatus(id, s.k) })));
  };
  M3.setStatus = async function (id, key) {
    const p = patients.find(x => x.id === id); if (!p) return;
    const rv = rsvOf(p);
    if (key === 'waiting' && rv && rv.status === 'reserved' && typeof rsvArrive === 'function') { await rsvArrive(id); p.status = 'waiting'; renderList(); return; }
    if (key !== 'reserved' && key !== 'cancel' && !p.arrivedAt) { const n = new Date(); p.arrivedAt = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); }
    p.status = key;
    if (key === 'active' && typeof callPatientFromList === 'function') { /* 呼出と同じ扱い（他の診察中を終える） */ patients.forEach(x => { if (x !== p && x.status === 'active') x.status = 'done'; }); }
    // カルテDB（visits）にも状態を反映（予約由来・受付済みの来院のみ）
    if (rv && rv.visitId && typeof supabaseClient !== 'undefined' && typeof isSupabaseReady === 'function' && isSupabaseReady()) {
      const map = { waiting: 'waiting', ready: 'waiting', active: 'in_progress', exam: 'in_progress', proc: 'in_progress', billing: 'in_progress', done: 'done', rebill: 'done', absent: 'none', cancel: 'none' };
      if (map[key]) supabaseClient.from('visits').update({ status: map[key] }).eq('id', rv.visitId).then(() => {}, () => {});
    }
    toast(p.name + 'さん: ' + ST[key].l);
    renderList();
  };
  M3.sort = function (k) { if (state.sort.k === k) state.sort.asc = !state.sort.asc; else state.sort = { k, asc: true }; LS.set('m3_sort', state.sort); renderList(); };
  M3.toggleFilter = function () {
    const f = $('m3Filter'); if (!f) return;
    if (f.style.display !== 'none') { f.style.display = 'none'; return; }
    const docs = new Set(); patients.forEach(p => { const d = doctorOf(p); docs.add(d || '(未設定)'); });
    if (typeof dbShift !== 'undefined') dbShift.forEach(s => { if (s.doctor) docs.add(s.doctor); });
    const grp = (title, key, opts, cur) => '<h4>' + title + ' <button onclick="M3.filterAll(\'' + key + '\',true)">すべて選択</button><button onclick="M3.filterAll(\'' + key + '\',false)">クリア</button></h4><div class="opts">' +
      opts.map(o => '<label><input type="checkbox" data-f="' + key + '" value="' + esc(o.v) + '"' + (cur == null || cur.includes(o.v) ? ' checked' : '') + ' onchange="M3.filterChange()"> ' + esc(o.l) + '</label>').join('') + '</div>';
    f.innerHTML = grp('ステータス', 'st', STATUSES.map(s => ({ v: s.k, l: s.l })), state.filter.st)
      + grp('医師', 'doc', Array.from(docs).map(d => ({ v: d, l: d })), state.filter.doc)
      + grp('診療科', 'dept', DEPTS.map(d => ({ v: d, l: d })), state.filter.dept)
      + '<h4>表示する項目 <button onclick="M3.colsAll(true)">すべて選択</button><button onclick="M3.colsAll(false)">クリア</button></h4><div class="opts">'
      + COLS.filter(c => c.k !== 'ops').map(c => '<label><input type="checkbox" data-col="' + c.k + '"' + (state.cols[c.k] !== false ? ' checked' : '') + ' onchange="M3.colChange()"> ' + (COL_TOGGLE_LABELS[c.k] || c.l) + '</label>').join('') + '</div>';
    f.style.display = '';
  };
  M3.filterChange = function () {
    ['st', 'doc', 'dept'].forEach(key => {
      const boxes = Array.from(document.querySelectorAll('#m3Filter input[data-f=' + key + ']'));
      const on = boxes.filter(b => b.checked).map(b => b.value);
      state.filter[key] = (on.length === boxes.length) ? null : on;
    });
    LS.set('m3_filter', state.filter); renderList();
  };
  M3.filterAll = function (key, v) { document.querySelectorAll('#m3Filter input[data-f=' + key + ']').forEach(b => { b.checked = v; }); M3.filterChange(); };
  M3.colChange = function () { document.querySelectorAll('#m3Filter input[data-col]').forEach(b => { state.cols[b.dataset.col] = b.checked; }); LS.set('m3_cols', state.cols); renderList(); };
  M3.colsAll = function (v) { document.querySelectorAll('#m3Filter input[data-col]').forEach(b => { b.checked = v; }); M3.colChange(); };
  M3.clearFilter = function () { state.filter = { st: null, doc: null, dept: null }; LS.set('m3_filter', state.filter); const f = $('m3Filter'); if (f) f.style.display = 'none'; renderList(); };
  M3.editMemo = function (id) { const p = patients.find(x => x.id === id); if (!p) return; const v = prompt(p.name + 'さんの患者メモ', p.memo || ''); if (v == null) return; p.memo = v; if (typeof savePatientToApi === 'function') savePatientToApi(p); renderList(); };
  M3.editRecMemo = function (id) { const p = patients.find(x => x.id === id); if (!p) return; const key = id + '|' + selectedDate; const v = prompt(p.name + 'さんの受付メモ（この日だけ）', state.rmemo[key] || ''); if (v == null) return; state.rmemo[key] = v; LS.set('m3_recmemo', state.rmemo); renderList(); };
  M3.editDept = function (id) { const p = patients.find(x => x.id === id); if (!p) return; const v = prompt('診療科（' + DEPTS.join('／') + '）', p.department || '内科'); if (!v) return; p.department = v; renderList(); };
  M3.editDoctor = function (id) { const p = patients.find(x => x.id === id); if (!p) return; const v = prompt('担当医', doctorOf(p) || ''); if (v == null) return; p.doctor = v; renderList(); };
  M3.editFrom = function (id, what) { currentPatientId = id; if (what === 'ins' && typeof openInsuranceModal === 'function') openInsuranceModal(); else if (typeof openEditPatientModal === 'function') openEditPatientModal(); };
  M3.faxFrom = function (id) { openKarte(id); setTimeout(() => { if (typeof openDocModal === 'function') openDocModal('prescription'); }, 100); };
  M3.showQuestionnaire = function (id) { const p = patients.find(x => x.id === id); if (!p) return; if (p.questionnaire) { currentPatientId = id; openKarte(id); M3.openPatientTab('questionnaire'); } else toast(p.name + 'さんの問診票は受信していません'); };
  M3.toggleDbList = function () { if (typeof toggleDbPatientList === 'function') toggleDbPatientList(); };
  M3.reload = function () { if (typeof dbLoaded !== 'undefined') dbLoaded = false; if (typeof loadDbData === 'function') loadDbData(); if (window.RsvSync) RsvSync.load(false); toast('患者データを読み直しています'); };
  M3.toggleSearch = function (fromKarte) {
    if (fromKarte) { goToList(); }
    const box = $('dbPatientResults'); const inp = $('dbPatientSearch');
    const v = prompt('患者検索（氏名・患者番号）', inp ? inp.value : '');
    if (v == null) return;
    if (inp) { inp.value = v; if (typeof onDbPatientSearch === 'function') onDbPatientSearch(v); }
    if (box && !v) box.style.display = 'none';
  };
  M3.openReservation = function (kind) { const base = location.pathname.replace(/karte_v\d+.*$/, ''); window.open(base + 'reservation_v3/' + (kind === 'demo' ? 'demo.html' : 'board.html'), '_blank'); };
  M3.openInventory = function () { const base = location.pathname.replace(/karte_v\d+.*$/, ''); window.open(base + 'v0_8/index.html', '_blank'); };
  M3.showNotices = function () {
    const list = getPatientsForDate(selectedDate); const r = list.filter(p => statusOf(p) === 'reserved').length, w = list.filter(p => ['waiting', 'ready'].includes(statusOf(p))).length;
    const err = (window.RsvSync && RsvSync.lastError && RsvSync.lastError()) || '';
    openMenu(event && event.currentTarget ? event.currentTarget : document.body, [
      { html: ymdLabel(selectedDate) + '　予約 ' + r + ' 件／受付中 ' + w + ' 件', muted: true },
      { html: err ? '予約連携エラー: ' + esc(err) : '予約連携: 正常（60秒ごとに自動更新）', muted: true },
      { html: '予約を読み直す', fn: () => RsvSync.load(true), sep: true },
    ]);
  };
  M3.help = function () { openMenu(event && event.currentTarget ? event.currentTarget : document.body, [
    { html: '行をクリック→カルテを開く', muted: true }, { html: 'ステータスのボタン→状態を変更', muted: true }, { html: '漏斗（じょうご）→絞り込み・表示列', muted: true },
    { html: 'カルテ画面: 左レール→患者情報／右レール→行為マスタ', muted: true }, { html: 'レセプト作成・点検・様式14は上部アイコン', muted: true } ]); };
  M3.downloads = function () { openMenu(event && event.currentTarget ? event.currentTarget : document.body, [{ html: '作成中のファイルはありません', muted: true }, { html: 'レセプト作成（UKE・CSV）を開く', fn: () => openRezeptCreate(), sep: true }]); };
  M3.userMenu = function (btn) {
    const mail = (typeof authUser !== 'undefined' && authUser && authUser.email) ? authUser.email : '';
    const cx = window.ClinicCtx;
    const items = [{ html: esc(mail || 'ログイン中'), muted: true }];
    if (cx) items.push({ html: '接続: ' + esc(cx.info().name), muted: true });
    if (cx && (cx.isMaster() || cx.allowedList().length > 1)) items.push({ html: '接続クリニックの切替', fn: () => cx.openSwitcher(), sep: true });
    items.push({ html: 'ID管理（ユーザー管理）', fn: () => openUserManager(), sep: !(cx && (cx.isMaster() || cx.allowedList().length > 1)) });
    items.push({ html: '負担割合ルール一覧', fn: () => openInsuranceRuleRef() });
    items.push({ html: 'ログアウト', fn: () => handleLogout(), sep: true });
    openMenu(btn, items);
  };

  // ---------- カルテ画面: 左パネル ----------
  const LEFT_TABS = [
    { k: 'patient', l: '患者情報', t: 'basic' }, { k: 'insurance', l: '保険等', t: 'insurance' }, { k: 'questionnaire', l: '問診' }, { k: 'allergy', l: '副作用薬等', t: 'allergy' },
    { k: 'vitals', l: 'バイタル', t: 'vitals' }, { k: 'examresult', l: '検査結果', t: 'exam' }, { k: 'phr', l: 'PHR' },
    { k: 'history', l: '診療履歴', t: 'history' }, { k: 'rxhistory', l: '投薬履歴', t: 'rxhistory' }, { k: 'files', l: 'ファイル' }, { k: 'summary', l: 'サマリー' },
    { k: 'diseases', l: '傷病名', t: 'diseases' }, { k: 'regular', l: '定期' }, { k: 'onshi', l: 'オン資等' },
  ];
  const RIGHT_TABS = [
    { k: 'set', l: 'セット', cat: 'mylist' }, { k: 'exam', l: '診察', cat: 'initial' }, { k: 'home', l: '在宅', cat: 'management' }, { k: 'drug', l: '投薬', cat: 'drug' },
    { k: 'inj', l: '注射', cat: 'injection' }, { k: 'proc', l: '処置', cat: 'procedure' }, { k: 'surg', l: '手術' }, { k: 'anes', l: '麻酔' },
    { k: 'lab', l: '検査', cat: 'labtest' }, { k: 'img', l: '画像', cat: 'imaging' }, { k: 'reha', l: 'リハ他', cat: 'management' }, { k: 'self', l: '自費' }, { k: 'all', l: '全て', cat: 'initial' },
  ];
  function buildRails() {
    const lr = $('m3LeftRail'), lt = $('m3LeftTabs'), rr = $('m3RightRail'), rt = $('m3RightTabs');
    if (lr) lr.innerHTML = LEFT_TABS.map(t => '<li data-k="' + t.k + '" onclick="M3.leftClick(\'' + t.k + '\')">' + t.l + '</li>').join('');
    if (lt) lt.innerHTML = LEFT_TABS.map(t => '<li class="patient-tab" data-tab="' + (t.t || 'm3_' + t.k) + '" data-k="' + t.k + '" onclick="M3.leftClick(\'' + t.k + '\')">' + t.l + '</li>').join('');
    if (rr) rr.innerHTML = RIGHT_TABS.map(t => '<li data-k="' + t.k + '" onclick="M3.rightClick(\'' + t.k + '\')">' + t.l + '</li>').join('');
    if (rt) rt.innerHTML = RIGHT_TABS.map(t => '<li data-k="' + t.k + '" onclick="M3.rightClick(\'' + t.k + '\')">' + t.l + '</li>').join('');
  }
  // 旧カルテの実測: 1684px以上では左パネルと右ペインが同時に開く（縦レール無し）。それ未満はどちらか一方
  const wideMQ = window.matchMedia('(min-width: 1600px)');
  function isWide() { return wideMQ.matches; }
  function syncLayout() {
    const L = $('m3Left'), R = $('m3Right'); if (!L || !R) return;
    if (isWide()) { state.leftOpen = true; state.rightRail = false; }
    L.classList.toggle('open', state.leftOpen);
    R.classList.toggle('rail', state.rightRail);
    document.querySelectorAll('#m3LeftRail li, #m3LeftTabs li').forEach(li => li.classList.toggle('on', li.dataset.k === state.leftTab));
    document.querySelectorAll('#m3RightRail li, #m3RightTabs li').forEach(li => li.classList.toggle('on', li.dataset.k === state.rightTab));
  }
  M3.leftClick = function (k) {
    if (isWide()) { state.leftTab = k; syncLayout(); renderLeft(); return; }
    if (state.leftOpen && state.leftTab === k) { state.leftOpen = false; state.rightRail = false; syncLayout(); return; }
    state.leftTab = k; state.leftOpen = true; state.rightRail = true; syncLayout(); renderLeft();
  };
  M3.openPatientTab = function (k) { state.leftTab = k; state.leftOpen = true; state.rightRail = true; syncLayout(); renderLeft(); };
  M3.rightClick = function (k) {
    if (!isWide() && state.rightRail) { state.rightRail = false; state.leftOpen = false; }
    state.rightTab = k; syncLayout(); renderRight();
  };
  function renderLeft() {
    const t = LEFT_TABS.find(x => x.k === state.leftTab); if (!t) return;
    const extra = $('m3PanelExtra'); if (extra) extra.innerHTML = '';
    if (t.t) { if (typeof switchPatientTab === 'function') switchPatientTab(t.t); return; }
    // 新カルテ独自タブ（app.js にない）: patientInfoBody は空にして自前で描く
    if (typeof currentPatientTab !== 'undefined') currentPatientTab = 'm3_' + t.k;
    if (typeof syncVitalsInputVisibility === 'function') syncVitalsInputVisibility();
    document.querySelectorAll('.patient-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === 'm3_' + t.k));
    const body = $('patientInfoBody'); if (body) body.innerHTML = '';
    const p = patients.find(x => x.id === currentPatientId); if (!p || !extra) return;
    const k = karteOf(p);
    const sec = (title, inner, headExtra) => '<div class="m3-sec"><div class="m3-sec-head">' + title + '<div class="m3-spacer"></div>' + (headExtra || '') + '</div>' + inner + '</div>';
    let h = '';
    if (t.k === 'questionnaire') {
      const q = p.questionnaire;
      h += sec('問診', q ? '<table class="m3-kv"><tr><th>受信日時</th><td>' + esc(q.receivedAt || '') + '</td></tr><tr><th>症状</th><td>' + esc(q.symptoms || '') + '</td></tr><tr><th>期間</th><td>' + esc(q.duration || '') + '</td></tr><tr><th>体温</th><td>' + esc(q.temperature || '') + '</td></tr><tr><th>その他</th><td>' + esc(q.otherComplaints || '') + '</td></tr></table>'
        : '<div class="m3-note muted">問診票は受信していません。予約サイトのWeb問診（準備中）または紙の問診票を「ファイル」に保存してください。</div>',
        q ? '<button class="m3-wbtn" onclick="openQuestionnaireModal()">カルテに反映</button>' : '');
    } else if (t.k === 'phr') {
      h += sec('PHR', '<div style="display:flex;gap:6px;padding:8px 12px;"><button class="m3-wbtn on">全て</button><button class="m3-wbtn">歩数・睡眠</button><button class="m3-wbtn">心臓</button><button class="m3-wbtn">バイタル</button></div><div class="m3-note muted" style="text-align:center;padding:60px 12px;">データがありません<br><span style="font-size:11px">（患者アプリ／ウェアラブルとの連携は未接続）</span></div>');
    } else if (t.k === 'files') {
      h += sec('ファイル', '<table class="m3-grid"><thead><tr><th style="width:90px">日付</th><th>備考</th><th style="width:120px"></th></tr></thead><tbody id="m3FileRows"><tr><td colspan="3" class="m3-note muted">読み込み中...</td></tr></tbody></table>',
        '<button class="m3-wbtn" onclick="M3.docMenu(this)">文書作成</button><button class="m3-wbtn" onclick="openInsuranceModal()">保険証・医療証</button>');
      setTimeout(() => M3.loadFiles(p), 0);
    } else if (t.k === 'summary') {
      const dz = (k.selectedDiseases || []).map(d => d.name + (d.status === 'suspected' ? '（疑い）' : '')).join('、') || '登録なし';
      const rx = (p.prevRx || []).map(r => { const d = (typeof drugs !== 'undefined') ? drugs.find(x => x.id === r.drugId) : null; return d ? d.name + ' ' + r.qty + r.unit : ''; }).filter(Boolean).join('、') || '登録なし';
      h += sec('サマリー', '<table class="m3-kv"><tr><th>傷病名</th><td>' + esc(dz) + '</td></tr><tr><th>アレルギー</th><td>' + esc((p.allergies || []).join('、') || 'なし') + '</td></tr><tr><th>既往歴</th><td>' + esc((p.history || []).join('、') || 'なし') + '</td></tr><tr><th>前回処方</th><td>' + esc(rx) + '</td></tr><tr><th>来院回数</th><td>' + ((p.dbVisits ? p.dbVisits.length : 0) + (p.rsvVisits ? p.rsvVisits.length : 0)) + ' 回</td></tr><tr><th>支払方法</th><td>' + esc(p.payMethod || '未設定') + '</td></tr><tr><th>患者メモ</th><td style="white-space:pre-wrap">' + esc(p.memo || '') + '</td></tr></table>');
    } else if (t.k === 'regular') {
      const sets = (typeof setOrders !== 'undefined') ? setOrders : [];
      h += sec('定期（処方セット）', sets.length ? '<table class="m3-grid"><thead><tr><th>登録日</th><th>診療名</th><th>繰り返し</th><th></th></tr></thead><tbody>' + sets.map((s, i) => '<tr><td>-</td><td>' + esc(s.name) + '<div style="font-size:11px;color:var(--text-muted)">' + esc((s.items || []).map(it => it.name || it.drugName || '').filter(Boolean).slice(0, 4).join('、')) + '</div></td><td>' + esc(s.days ? s.days + '日分' : '') + '</td><td><button class="m3-wbtn" onclick="applySetOrder(' + i + ');M3.afterRender()">今回に適用</button></td></tr>').join('') + '</tbody></table>'
        : '<div class="m3-note muted">定期処方（セット）が登録されていません。</div>',
        '<button class="m3-wbtn" onclick="saveCurrentAsSet()">今回の処方を登録</button><button class="m3-wbtn" onclick="openSetOrderManager()">管理</button>');
    } else if (t.k === 'onshi') {
      h += sec('オンライン資格確認', '<table class="m3-kv"><tr><th>保険者番号</th><td>' + esc(p.insurerNumber || '-') + '</td></tr><tr><th>記号・番号</th><td>' + esc([p.insSymbol, p.insNumber, p.insEdaban ? '(' + p.insEdaban + ')' : ''].filter(Boolean).join(' ') || '-') + '</td></tr><tr><th>保険種別</th><td>' + esc(p.insurance || '-') + '</td></tr><tr><th>公費</th><td>' + esc(p.kouhiNumber || '-') + '</td></tr><tr><th>確認方法</th><td>保険証OCR／マイナ保険証QR（カメラ）</td></tr></table><div class="m3-note muted">オンライン資格確認端末とは未接続です。保険証・マイナ保険証の読み取りは「保険証・医療証」から行えます。</div>',
        '<button class="m3-wbtn" onclick="openInsuranceModal()">保険証・医療証</button>');
    }
    extra.innerHTML = h;
  }
  M3.loadFiles = async function (p) {
    const tb = $('m3FileRows'); if (!tb) return;
    const rows = [];
    if (p.insurancePhoto) rows.push({ d: '', n: '保険証（画像）', act: '<button class="m3-wbtn" onclick="openInsuranceModal()">表示</button>' });
    if (p.iryoPhoto) rows.push({ d: '', n: '医療証（画像）', act: '<button class="m3-wbtn" onclick="openInsuranceModal()">表示</button>' });
    try {
      if (typeof listPatientPhotos === 'function') {
        const list = await listPatientPhotos(p.id);
        (list || []).forEach(f => { const m = (typeof parsePhotoName === 'function') ? parsePhotoName(f.name) : null; rows.push({ d: (f.created_at || '').slice(0, 10).replace(/-/g, '/'), n: (m && m.type) ? m.type : f.name, act: '<button class="m3-wbtn" onclick="openInsuranceModal()">写真一覧</button>' }); });
      }
    } catch (e) { /* 未接続 */ }
    tb.innerHTML = rows.length ? rows.map(r => '<tr><td>' + esc(r.d) + '</td><td>' + esc(r.n) + '</td><td>' + r.act + '</td></tr>').join('') : '<tr><td colspan="3" class="m3-note muted">ファイルはありません。「保険証・医療証」から保険証／医療証／患者写真を保存できます。</td></tr>';
  };
  M3.docMenu = function (btn) { openMenu(btn, [{ html: '診療情報提供書（紹介状）', fn: () => openDocModal('referral') }, { html: '診断書', fn: () => openDocModal('diagnosis') }, { html: '院外処方箋', fn: () => openDocModal('prescription') }, { html: '様式14（オンライン診療の報告）', fn: () => openTelemedReport(), sep: true }]); };

  // ---------- カルテ画面: 右ペイン ----------
  function renderRight() {
    const t = RIGHT_TABS.find(x => x.k === state.rightTab); if (!t) return;
    const extra = $('m3ItemsExtra'); const items = $('billingMenuItems'); const added = $('addedBillingList');
    if (t.cat) {
      if (extra) extra.innerHTML = (t.k === 'set') ? '<div class="m3-group"><div class="subhead">処方セット（薬）は左の「処置・行為」内の「薬」欄、または左パネル「定期」から適用できます。ここは算定のマイリストです。</div></div>' : (t.k === 'all' ? '<div class="m3-group"><div class="subhead">区分ごとに表示します。上のキーワードで全区分から検索できます。</div></div>' : '');
      if (items) items.style.display = '';
      if (typeof switchBillingTab === 'function') switchBillingTab(t.cat);
    } else {
      if (items) items.style.display = 'none';
      if (added) added.style.display = 'none';
      if (extra) extra.innerHTML = '<div class="empty">「' + t.l + '」の項目は当院では登録がありません。<br><span style="font-size:11px">必要な場合は算定メニュー（マイリスト）に追加してください。</span></div>';
    }
  }
  M3.toggleDocs = function () { state.docs = !state.docs; const s = $('m3DocsSection'); if (s) s.style.display = state.docs ? '' : 'none'; if (state.rightRail) { state.rightRail = false; state.leftOpen = false; syncLayout(); } };
  M3.toggleWaiting = function () { state.waiting = !state.waiting; const s = $('m3WaitingSection'); if (s) s.style.display = state.waiting ? '' : 'none'; if (state.rightRail) { state.rightRail = false; state.leftOpen = false; syncLayout(); } if (typeof renderWaitingList === 'function') renderWaitingList(); };

  // ---------- カルテ画面: 中央 ----------
  M3.fontSize = function (d) { state.fontSize = Math.min(24, Math.max(10, state.fontSize + d)); LS.set('m3_fontsize', state.fontSize); applyFont(); };
  function applyFont() { const ed = $('findingsEditor'); if (ed) ed.style.fontSize = state.fontSize + 'px'; const i = $('m3FontSize'); if (i) i.value = state.fontSize; }
  M3.clearFindings = function () { const ed = $('findingsEditor'); if (!ed) return; if (!ed.textContent.trim() || confirm('主訴・所見の記載を消しますか？')) { ed.innerHTML = ''; toast('所見を消しました'); } };
  M3.clearActions = function () {
    if (!confirm('処方・検査・算定をすべて消しますか？')) return;
    const k = karteOf({ id: currentPatientId }); if (k.prescriptions) k.prescriptions = []; if (k.selectedExams) k.selectedExams = [];
    if (typeof renderRxList === 'function') renderRxList(); if (typeof renderExamCheckList === 'function') renderExamCheckList();
    if (typeof clearAllBilling === 'function') { try { clearAllBilling(); } catch (e) {} }
    if (typeof recalcBilling === 'function') recalcBilling();
  };
  M3.ippouChange = function (cb) { const k = karteOf({ id: currentPatientId }); k.ippou = cb.checked; toast(cb.checked ? '処方箋備考に「一包化」を記載します' : '一包化の記載を外しました'); };
  M3.claimChange = function (sel) { if (sel.value === 'late') { if (typeof openLateClaimModal === 'function') openLateClaimModal(); } else toast('通常請求'); };
  M3.toggleFold = function (id) { const el = $(id); if (!el) return; const show = el.style.display === 'none'; el.style.display = show ? '' : 'none'; const ico = $(id + 'FoldIco'); if (ico) ico.textContent = show ? '▾' : '▸'; };
  M3.newKarteForDate = function () { const v = prompt('カルテを開く日付（YYYY-MM-DD）', selectedDate); if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return; selectedDate = v; const ld = $('listDate'); if (ld) ld.value = v; if (typeof renderAllKarte === 'function') renderAllKarte(); toast(ymdLabel(v) + ' のカルテを開きました'); };
  M3.reloadKarte = function () { if (typeof renderAllKarte === 'function') renderAllKarte(); toast('カルテを読み直しました'); };
  M3.openSetManager = function () { if (typeof openSetOrderManager === 'function') openSetOrderManager(); };
  M3.finishAndNext = function () {
    const p = patients.find(x => x.id === currentPatientId);
    if (typeof saveKarteDraft === 'function') saveKarteDraft();
    if (p) { p.status = 'billing'; }
    if (typeof callNextPatient === 'function') { const nw = patients.find(x => x.status === 'waiting' || x.status === 'ready'); if (nw) { if (p) p.status = 'billing'; switchPatient(nw.id); nw.status = 'active'; renderAllKarte(); toast(nw.name + 'さんを呼び出しました'); return; } }
    toast('診察を終了し会計待ちにしました'); goToList();
  };

  // ---------- ヘッダー・タブなど app.js の描画後に整える ----------
  M3.afterRender = function () {
    const p = patients.find(x => x.id === currentPatientId); if (!p) return;
    const k = karteOf(p);
    const id = $('hdrId'); if (id) id.textContent = String(p.id || '').replace(/^ID:\s*/, '');
    const age = $('hdrAge'); if (age) age.textContent = ageLabel(p);
    const sx = $('hdrSex'); if (sx) { const s = String(p.sex || '').replace(/性$/, ''); sx.textContent = s || '-'; sx.classList.toggle('f', s === '女'); }
    const ins = $('hdrInsurance'); if (ins) ins.textContent = insShort(p.insurance) || '保険無し';
    const tab = $('m3KarteTabLabel'); if (tab) tab.textContent = (String(p.insurance || '保険無').replace(/\d割$/, '').slice(0, 3)) || 'カルテ';
    const vd = $('visitDate'); if (vd) vd.textContent = ymdLabel(selectedDate);
    const dr = $('m3Draft'); if (dr) { const saved = !!(k._snapshot || k.savedAt); dr.textContent = saved ? '保存済' : '下書き'; dr.classList.toggle('saved', saved); }
    const ap = $('m3Approve'); if (ap) ap.textContent = (statusOf(p) === 'done') ? '承認' : '未承認';
    const qb = $('m3QBadge'); if (qb) qb.style.display = p.questionnaire ? '' : 'none';
    const rx = $('rxModeExternal'); if (rx) rx.checked = !!k.rxModeExternal;
    const ip = $('m3IppouCheck'); if (ip) ip.checked = !!k.ippou;
    const rc = $('m3RxCount'); if (rc) rc.textContent = (k.prescriptions && k.prescriptions.length) ? k.prescriptions.length + ' 剤' : '';
    const wb = $('m3WaitBadge'); if (wb) { const n = patients.filter(x => ['waiting', 'ready'].includes(statusOf(x)) && getPatientsForDate(selectedDate).includes(x)).length; wb.textContent = n; wb.style.display = n ? '' : 'none'; }
    const ub = $('authUserBadge2'), ua = $('authUserBadge'); if (ub && ua && ua.textContent) ub.textContent = ua.textContent;
    const ki = $('m3HdrKanaInline'); if (ki) ki.textContent = p.nameKana || '';
    applyFont(); syncLayout();
    if (state.leftOpen) renderLeft();
  };

  // ---------- app.js の関数をラップして差し替える ----------
  function install() {
    buildRails();
    if (typeof renderPatientList === 'function') { window.__m3_renderPatientList = renderPatientList; renderPatientList = renderList; }
    if (typeof renderAllKarte === 'function') { const orig = renderAllKarte; renderAllKarte = function () { orig(); M3.afterRender(); }; }
    if (typeof showScreen === 'function') { const orig = showScreen; showScreen = function (name) { orig(name); if (name === 'karte') { syncLayout(); renderRight(); } else { closeMenu(); } }; }
    if (typeof switchPatientTab === 'function') { const orig = switchPatientTab; switchPatientTab = function (tab) { orig(tab); const t = LEFT_TABS.find(x => x.t === tab); if (t) { state.leftTab = t.k; } syncLayout(); }; }
    const ua = $('authUserBadge'); if (ua) { new MutationObserver(() => { const ub = $('authUserBadge2'); if (ub) ub.textContent = ua.textContent || 'ユーザー'; }).observe(ua, { childList: true, characterData: true, subtree: true }); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); const f = $('m3Filter'); if (f) f.style.display = 'none'; } });
    // ウィンドウの最大化／縮小で 3列同時表示 ⇄ 片側表示 を切り替える（旧カルテと同じ）
    const onWide = () => { if (isWide()) { syncLayout(); if (typeof currentScreen !== 'undefined' && currentScreen === 'karte') renderLeft(); } else { state.leftOpen = false; state.rightRail = false; syncLayout(); } };
    if (wideMQ.addEventListener) wideMQ.addEventListener('change', onWide); else wideMQ.addListener(onWide);
    syncLayout(); renderRight();
    renderList();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();

// ===== v20: URL ルーティング（旧カルテと同じく「受付＝/reception/日付」「患者詳細＝/karte/患者ID/日付」） =====
// GitHub Pages では経路のサーバー書換えができないため、# 以降で表現する。
//   受付      : #/reception/2026-09-14
//   患者詳細  : #/karte/P-00481/2026-09-14       （スプシ由来の DB-xxxx は並び順で番号が変わるため ?n=氏名ハッシュ を添える）
// ブラウザの戻る／進む（マウスのサブボタン含む）は popstate で受けて、履歴を積まずに画面だけ切り替える。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let applying = false;          // popstate 由来の画面切替中（履歴を積まない）
  let pending = null;            // 患者データ読込前に来た /karte 経路
  function nameHash(s) { s = String(s || '').replace(/[\s　]/g, ''); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16).slice(0, 6); }
  function routeOf(p) { return '#/karte/' + encodeURIComponent(p.id) + '/' + selectedDate + (p.dbSource ? '?n=' + nameHash(p.name) : ''); }
  function listRoute() { return '#/reception/' + selectedDate; }
  function parse(h) {
    h = h || location.hash || '';
    let m = h.match(/^#\/karte\/([^/?]+)\/(\d{4}-\d{2}-\d{2})(?:\?n=([0-9a-f]+))?/);
    if (m) return { screen: 'karte', id: decodeURIComponent(m[1]), date: m[2], n: m[3] || null };
    m = h.match(/^#\/reception\/(\d{4}-\d{2}-\d{2})/);
    if (m) return { screen: 'list', date: m[1] };
    return null;
  }
  function push(h) { if (location.hash !== h) history.pushState({ m3: 1 }, '', h); }
  function replace(h) { if (location.hash !== h) history.replaceState({ m3: 1 }, '', h); }
  function setDate(d) {
    if (!d || d === selectedDate) return;
    selectedDate = d;
    const ld = $('listDate'); if (ld) ld.value = d;
    if (typeof updateRevisionBadge === 'function') updateRevisionBadge();
  }
  function findPatient(r) {
    let p = patients.find(x => x.id === r.id);
    if (p && (!r.n || nameHash(p.name) === r.n)) return p;
    if (r.n) { const q = patients.find(x => nameHash(x.name) === r.n); if (q) return q; }
    return p || null;
  }
  // 経路 → 画面（履歴は積まない）
  function apply(r) {
    if (!r) return;
    applying = true;
    try {
      if (r.screen === 'list') {
        setDate(r.date);
        if (typeof showScreen === 'function') showScreen('list');
        if (typeof renderPatientList === 'function') renderPatientList();
      } else {
        setDate(r.date);
        const p = findPatient(r);
        if (!p) { pending = r; return; }
        pending = null;
        if (p.id !== r.id) replace(routeOf(p));   // DB-xxxx の番号が変わっていた場合は正しい経路に直す
        window.__m3_openKarte(p.id);
      }
    } finally { applying = false; }
  }
  // 患者データが後から読み込まれたら、保留中の経路を開く
  function retryPending() { if (pending && typeof patients !== 'undefined' && patients.length) { const r = pending; apply(r); } }
  setInterval(retryPending, 700);

  function install() {
    if (typeof openKarte !== 'function' || typeof goToList !== 'function') return;
    window.__m3_openKarte = openKarte;
    window.__m3_goToList = goToList;
    // 患者を開く → 経路を積む（旧カルテで患者行のリンクを踏むのと同じ）
    openKarte = function (id) {
      window.__m3_openKarte(id);
      if (applying) return;
      const p = patients.find(x => x.id === id);
      if (p) push(routeOf(p));
    };
    // 受付へ戻る（×・ロゴ・次の患者なし）→ 受付の経路を積む。ブラウザの戻るでも同じ画面に着く
    goToList = function () {
      window.__m3_goToList();
      if (applying) return;
      push(listRoute());
    };
    // 日付移動は受付画面の経路を置き換える（履歴を増やさない）
    const wrapDate = name => { if (typeof window[name] !== 'function') return; const o = window[name]; window[name] = function () { const r = o.apply(this, arguments); if (!applying && (typeof currentScreen === 'undefined' || currentScreen !== 'karte')) replace(listRoute()); return r; }; };
    ['changeDate', 'setToday', 'onDateChange'].forEach(wrapDate);
    window.addEventListener('popstate', () => { const r = parse(); if (r) apply(r); else apply({ screen: 'list', date: selectedDate }); });
    // 初期表示: 経路があればそれを、無ければ受付の経路を置く
    const r0 = parse();
    if (r0) { if (r0.screen === 'karte') { setDate(r0.date); pending = r0; retryPending(); } else apply(r0); }
    else replace(listRoute());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
