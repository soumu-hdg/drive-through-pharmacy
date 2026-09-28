// ===== 置き換え層：従来の画面にあって基準版の画面に無かった機能の補い（2026-09-28） compat_features_0928.js =====
// 従来の画面（classic.html）と基準版の画面を突き合わせ、基準版の画面で使えなくなっていたもののうち、
// 直し方が単純なものだけをここで足す。基準版のファイル（renderer.js・api.js・index.html）は変えない。
//   ① 右上のメニューに「薬品在庫管理」「レセプト点検（UKE を読み込む）」
//        従来の画面の見出しのアイコン（在庫アプリ v0_8・receipt.html）と同じ開き先。受付画面・カルテ画面の両方のメニュー
//   ② 受付一覧の日付の横に「当番: 医師 ／ 他の医師」
//        従来の画面の showDateShift と同じく、その日の夜間外来DBの行（karte_db_patients）の担当医を数え、
//        いちばん多い医師を当番、残りを並べる。行が無い日は出さない
//   ③ 受付一覧の患者名の横に「📱件数」（スマホからの報告・未確認の件数。確認済みだけなら 📱）
//        従来の画面の受付一覧の 📱 列と同じ。元データは karte_mobile_reports（患者番号か氏名で対応付け）
//   ④ カルテ画面の見出しに「夜間外来DB」（その患者の夜間外来の来院歴があるときだけ出る）
//        従来の画面の患者情報「DB情報」（流入経路・患者種別・エリア・来院回数・自己負担累計・診療報酬累計）と
//        診療履歴「来院詳細（DB）」（日付・時間帯・担当医・検査の陽性・自己負担）を小窓で見る。読むだけ
//   ⑤ カルテ画面の見出しに「オンライン診療」
//        従来の画面の「オンライン診療（情報通信機器を用いた診療）」の印・患者の所在・他院へ紹介・診療前相談を、
//        この受診（visits）の is_telemedicine・telemed_patient_pref・telemed_referred・telemed_pre_consult に保存する。
//        様式14（施設管理の「オンライン診療の報告」）はこの 4 列から集計するので、基準版の画面で診た受診も数えられるようになる
//   ⑥ 本文の下のボタン列に「定型文」
//        従来の画面の「診察テンプレ」（［現病歴］［身体所見］［アセスメント＆プラン］の見出し）・見出し 1 つずつ・登録した定型文を
//        本文（#karte-editor）のカーソル位置に入れる。登録した定型文は院ごとの台帳（karte_clinic_store の
//        karte_base_findings_snippets_<院ID>）に置く（従来の画面は端末ごとだった）
//   ⑦ ファイルタブの末尾に「従来の画面で保存した写真」
//        従来の画面の患者写真（Storage patient-photos の patients/<患者番号>/）を一覧で見る。読むだけ
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); else console.log('[0928]', m); };
  const sb = () => (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : null;
  const ready = () => { const s = sb(); return !!s && (typeof isSupabaseReady !== 'function' || isSupabaseReady()); };
  const cid = () => (typeof currentClinicId === 'function' ? currentClinicId() : '');
  const norm = (s) => String(s || '').replace(/[\s　]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const todayIso = () => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); };
  const mdOf = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : ''; };
  /* global currentPatient, currentReception, receptionsCache */
  const patient = () => { try { return (typeof currentPatient !== 'undefined' && currentPatient) || null; } catch (e) { return null; } };
  const reception = () => { try { return (typeof currentReception !== 'undefined' && currentReception) || null; } catch (e) { return null; } };
  const receptions = () => { try { return (typeof receptionsCache !== 'undefined' && receptionsCache) || []; } catch (e) { return []; } };
  const listDate = () => { const i = $('reception-date'); return (i && i.value) || todayIso(); };
  const mainVisible = () => { const m = $('main-screen'); return !!m && !m.classList.contains('hidden'); };
  const nameVariants = (name) => {
    const n = String(name || '').trim(); const out = new Set([n, norm(n), n.replace(/ /g, '　'), n.replace(/　/g, ' ')]);
    return [...out].filter(Boolean);
  };

  const CSS = ''
    + '.f0928-shift{display:inline-block;margin-left:8px;padding:2px 8px;border:1px solid #b9d3bf;background:#eef6f0;color:#0a4d12;font-size:12px;border-radius:2px;white-space:nowrap;vertical-align:middle}'
    + '.f0928-mi{display:inline-block;margin-left:6px;padding:0 4px;font-size:11px;line-height:16px;border:1px solid #e0a3b3;background:#fdf0f3;color:#b0304f;border-radius:2px;white-space:nowrap}'
    + '.f0928-mi.done{border-color:#cfd6d4;background:#f4f6f5;color:#6b7683}'
    + '.f0928-hdr{display:flex;gap:6px;align-items:center;margin-left:16px;flex:none}.f0928-hdr .f0928-ctx-btn{height:26px;padding:0 10px;border:1px solid #cfd6d4;background:#fff;color:#242927;font-size:12px;border-radius:2px;cursor:pointer;white-space:nowrap;flex:none}'
    + '.f0928-hdr .f0928-ctx-btn:hover{background:#f4f6f5}.f0928-hdr .f0928-ctx-btn.f0928-on{background:#e6f4f1;border-color:#1bacac;color:#0b6b6b;font-weight:700}'
    + '#f0928-modal .modal-content{max-width:760px;width:94vw}'
    + '#f0928-modal .f0928-body{padding:12px 16px;max-height:70vh;overflow:auto;font-size:13px;line-height:1.6}'
    + '#f0928-modal table{border-collapse:collapse;width:100%;font-size:12px}#f0928-modal th,#f0928-modal td{border:1px solid #d9e0de;padding:3px 6px;text-align:left}'
    + '#f0928-modal th{background:#f4f6f5;font-weight:600}#f0928-modal .f0928-sum{display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:8px}'
    + '#f0928-modal .f0928-sum b{font-weight:600;color:#5e6b67;margin-right:4px}#f0928-modal label{display:block;margin:6px 0}'
    + '#f0928-modal .f0928-note{color:#6b7683;font-size:12px;margin-top:6px}#f0928-modal .f0928-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #e3e8e6}'
    + '.f0928-menu{position:fixed;z-index:10050;background:#fff;border:1px solid #cfd6d4;box-shadow:0 4px 12px rgba(0,0,0,.12);min-width:220px;padding:4px 0;font-size:13px}'
    + '.f0928-menu button{display:block;width:100%;text-align:left;background:none;border:0;padding:6px 12px;cursor:pointer;color:#242927}.f0928-menu button:hover{background:#f4f6f5}'
    + '.f0928-menu .sep{border-top:1px solid #e3e8e6;margin:4px 0}.f0928-menu .muted{color:#8a9491;padding:4px 12px;font-size:12px}'
    + '.f0928-photos{display:flex;flex-wrap:wrap;gap:8px;padding:6px 0}.f0928-photos a{display:block;width:120px;font-size:11px;color:#242927;text-decoration:none}'
    + '.f0928-photos img{width:120px;height:84px;object-fit:cover;border:1px solid #d9e0de;display:block}';

  // ---------- 共通: 小窓 ----------
  function modal(title, bodyHtml, footHtml) {
    let m = $('f0928-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'f0928-modal'; m.className = 'modal hidden';
      m.innerHTML = '<div class="modal-content"><div class="modal-header"><h3 id="f0928-title"></h3><button class="modal-close" id="f0928-close" type="button">&times;</button></div>'
        + '<div class="f0928-body" id="f0928-body"></div><div class="f0928-foot" id="f0928-foot"></div></div>';
      document.body.appendChild(m);
      $('f0928-close').addEventListener('click', closeModal);
      m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    }
    $('f0928-title').textContent = title; $('f0928-body').innerHTML = bodyHtml;
    $('f0928-foot').innerHTML = footHtml || '<button type="button" class="btn btn-secondary" data-f0928="close">閉じる</button>';
    m.classList.remove('hidden');
    m.querySelectorAll('[data-f0928="close"]').forEach((b) => b.addEventListener('click', closeModal));
    return m;
  }
  function closeModal() { const m = $('f0928-modal'); if (m) m.classList.add('hidden'); }

  // =====================================================================
  // ① 右上のメニュー
  // =====================================================================
  const INVENTORY_URL = 'https://soumu-hdg.github.io/drive-through-pharmacy/v0_8/index.html';
  function menuItem(anchorId, newId, menuId, icon, label, title, open) {
    const anchor = $(anchorId);
    if (!anchor || $(newId)) return;
    const a = document.createElement('a');
    a.href = '#'; a.className = 'dropdown-item'; a.id = newId; a.style.whiteSpace = 'nowrap'; a.title = title;
    a.innerHTML = '<i class="fas ' + icon + '"></i> ' + esc(label);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const menu = $(menuId); if (menu) menu.classList.remove('open');
      window.open(open(), '_blank', 'noopener');
    });
    anchor.insertAdjacentElement('afterend', a);
  }
  function wireMenus() {
    [['', 'user-dropdown'], ['-main', 'user-dropdown-main']].forEach(([sfx, menuId]) => {
      const after = $('menu-reservation-site' + sfx) ? 'menu-reservation-site' + sfx : 'menu-reservation-admin' + sfx;
      menuItem(after, 'menu-inventory' + sfx, menuId, 'fa-pills', '薬品在庫管理', '薬品在庫管理のアプリを別のタブで開きます（在庫は全院共通）', () => INVENTORY_URL);
      menuItem('menu-inventory' + sfx, 'menu-receipt-viewer' + sfx, menuId, 'fa-search', 'レセプト点検（UKEを読み込む）',
        'UKE ファイルを読み込んで中身と点検結果を見る画面を別のタブで開きます', () => new URL('../receipt.html', location.href).href);
    });
  }

  // =====================================================================
  // ② 当番（夜間外来DB）  ③ 受付一覧の 📱
  // =====================================================================
  const shiftCache = new Map(), mobileCache = new Map();
  async function shiftFor(iso) {
    const hit = shiftCache.get(iso); if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
    const c = sb(); if (!c || !ready()) return null;
    const since = new Date(iso); since.setDate(since.getDate() - 200);   // rdate に年が無い（compat_rsv_mirror.js と同じ絞り込み）
    const { data, error } = await c.from('karte_db_patients').select('doctor').eq('clinic_id', cid()).eq('rdate', mdOf(iso)).gte('updated_at', since.toISOString());
    if (error) return null;
    const cnt = {}; (data || []).forEach((r) => { const d = String(r.doctor || '').trim(); if (d) cnt[d] = (cnt[d] || 0) + 1; });
    const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const v = sorted.length ? { doctor: sorted[0][0], assistants: sorted.slice(1).map((x) => x[0]) } : null;
    shiftCache.set(iso, { t: Date.now(), v }); return v;
  }
  async function mobileFor(iso) {
    const hit = mobileCache.get(iso); if (hit && Date.now() - hit.t < 30 * 1000) return hit.v;
    const c = sb(); if (!c || !ready()) return [];
    const { data, error } = await c.from('karte_mobile_reports').select('patient_no,patient_name,status').eq('clinic_id', cid()).eq('visit_date', iso);
    const v = error ? [] : (data || []); mobileCache.set(iso, { t: Date.now(), v }); return v;
  }
  let listTimer = null, listSeq = 0;
  function scheduleList() { clearTimeout(listTimer); listTimer = setTimeout(decorateList, 150); }
  async function decorateList() {
    const seq = ++listSeq; const iso = listDate();
    const left = document.querySelector('#reception-screen .toolbar-left');
    if (left) {
      let el = $('f0928-shift');
      if (!el) { el = document.createElement('span'); el.id = 'f0928-shift'; el.className = 'f0928-shift'; el.style.display = 'none'; el.title = '夜間外来DBのその日の担当医（いちばん多い医師を当番として表示）'; const pc = $('patient-count'); if (pc) pc.insertAdjacentElement('afterend', el); else left.appendChild(el); }
      const s = await shiftFor(iso).catch(() => null);
      if (seq !== listSeq) return;
      if (s) { el.textContent = '当番: ' + s.doctor + (s.assistants.length ? ' ／ ' + s.assistants.join('・') : ''); el.style.display = ''; } else { el.textContent = ''; el.style.display = 'none'; }
    }
    const rows = await mobileFor(iso).catch(() => []);
    if (seq !== listSeq) return;
    const byId = new Map(receptions().map((r) => [String(r.id), r]));
    document.querySelectorAll('#patient-table-body tr[data-reception-id]').forEach((tr) => {
      const cell = tr.querySelector('td.col-patient-name'); if (!cell) return;
      const old = cell.querySelector('.f0928-mi'); if (old) old.remove();
      const r = byId.get(String(tr.dataset.receptionId)); if (!r || !rows.length) return;
      const mine = rows.filter((x) => (x.patient_no && r.patient_no && x.patient_no === r.patient_no) || norm(x.patient_name) === norm(r.patient_name));
      if (!mine.length) return;
      const n = mine.filter((x) => x.status === 'pending').length;
      const b = document.createElement('span'); b.className = 'f0928-mi' + (n ? '' : ' done');
      b.textContent = '📱' + (n || ''); b.title = n ? 'スマホからの報告 未確認 ' + n + '件（カルテの「スマホ報告」で確認）' : 'スマホからの報告は確認済み';
      cell.appendChild(b);
    });
  }
  function watchList() {
    const tb = $('patient-table-body'); if (!tb || tb.__f0928) return;
    tb.__f0928 = true; new MutationObserver(scheduleList).observe(tb, { childList: true }); scheduleList();
  }

  // =====================================================================
  // ④ 夜間外来DBの来院歴  ⑤ オンライン診療
  // =====================================================================
  let shownFor = '', dbRows = [], tm = null;
  async function dbRowsFor(p) {
    const c = sb(); if (!c || !ready() || !p || !p.name) return [];
    const { data, error } = await c.from('karte_db_patients').select('rdate,rtime,doctor,covid,flu,strep,ptype,route,area,insurance,payment,self_pay,revenue_points,sex,age,updated_at')
      .eq('clinic_id', cid()).in('name', nameVariants(p.name)).order('updated_at', { ascending: false }).limit(200);
    return error ? [] : (data || []);
  }
  const mdSortKey = (md) => { const m = String(md || '').match(/^(\d{1,2})\/(\d{1,2})$/); return m ? Number(m[1]) * 100 + Number(m[2]) : 0; };
  function openDbHistory() {
    const p = patient(); if (!p) return;
    const rows = dbRows.slice().sort((a, b) => mdSortKey(b.rdate) - mdSortKey(a.rdate));
    const last = rows[0] || {};
    const selfPay = rows.reduce((s, r) => s + (Number(r.self_pay) || 0), 0), pts = rows.reduce((s, r) => s + (Number(r.revenue_points) || 0), 0);
    const sum = '<div class="f0928-sum">'
      + (last.route ? '<span><b>流入経路</b>' + esc(last.route) + '</span>' : '') + (last.ptype ? '<span><b>患者種別</b>' + esc(last.ptype) + '</span>' : '')
      + (last.area ? '<span><b>エリア</b>' + esc(last.area) + '</span>' : '') + '<span><b>来院回数</b>' + rows.length + '回</span>'
      + (selfPay ? '<span><b>自己負担累計</b>&yen;' + selfPay.toLocaleString() + '</span>' : '') + (pts ? '<span><b>診療報酬累計</b>' + pts.toLocaleString() + '点</span>' : '') + '</div>';
    const tr = rows.map((r) => {
      const tests = [r.covid ? 'C+' : '', r.flu ? 'Flu+' : '', r.strep ? '溶+' : ''].filter(Boolean).join(' ') || '-';
      return '<tr><td>' + esc(r.rdate || '') + '</td><td>' + esc(r.rtime || '') + '</td><td>' + esc(r.doctor || '') + '</td><td>' + esc(tests) + '</td><td>' + esc(r.ptype || '') + '</td><td>'
        + (Number(r.self_pay) ? '&yen;' + Number(r.self_pay).toLocaleString() : '-') + '</td></tr>';
    }).join('');
    modal('夜間外来DBの来院歴（' + p.name + '）', sum + '<table><thead><tr><th>日付</th><th>時間帯</th><th>担当医</th><th>検査</th><th>種別</th><th>自己負担</th></tr></thead><tbody>' + tr + '</tbody></table>'
      + '<div class="f0928-note">夜間外来DB（スプレッドシートの写し）で氏名が同じ行です。日付に年はありません。読むだけで、ここからは書き換えません。</div>');
  }

  const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
    '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  const visitIdOf = (r) => { const id = String((r && r.id) || ''); return /^[0-9a-f-]{36}$/.test(id) ? id : null; };
  async function loadTelemed(vid) {
    const c = sb(); if (!c || !ready() || !vid) return null;
    const { data, error } = await c.from('visits').select('id,is_telemedicine,telemed_patient_pref,telemed_referred,telemed_pre_consult').eq('id', vid).eq('clinic_id', cid()).maybeSingle();
    return error ? null : data;
  }
  function paintTelemed() {
    const b = $('f0928-telemed-btn'); if (!b) return;
    const on = !!(tm && tm.is_telemedicine);
    b.classList.toggle('f0928-on', on);
    b.textContent = on ? 'オンライン診療' + (tm.telemed_patient_pref ? '（' + tm.telemed_patient_pref + '）' : '') : 'オンライン診療';
    b.title = on ? 'この受診はオンライン診療として記録されています（様式14の集計に入ります）' : 'この受診をオンライン診療（情報通信機器を用いた診療）として記録する（様式14の集計元）';
  }
  function openTelemed() {
    const r = reception(), vid = visitIdOf(r);
    if (!vid) { toast('受付（来院）を開いてから記録してください', 'error'); return; }
    const t = tm || {};
    const opts = '<option value="">選択...（未選択は当院の所在都道府県として数えます）</option>' + PREFS.map((p) => '<option' + (t.telemed_patient_pref === p ? ' selected' : '') + '>' + p + '</option>').join('');
    modal('オンライン診療（情報通信機器を用いた診療）',
      '<label><input type="checkbox" id="f0928-tm-on"' + (t.is_telemedicine ? ' checked' : '') + '> この受診はオンライン診療</label>'
      + '<div id="f0928-tm-detail"><label>患者の所在 <select id="f0928-tm-pref">' + opts + '</select></label>'
      + '<label><input type="checkbox" id="f0928-tm-ref"' + (t.telemed_referred ? ' checked' : '') + '> 対応困難・緊急性のため他院へ紹介</label>'
      + '<label><input type="checkbox" id="f0928-tm-pre"' + (t.telemed_pre_consult ? ' checked' : '') + '> 診療前相談を実施（初診）</label>'
      + '<div class="f0928-note">※所在は住所ではなく「診療時に患者がいた場所」。この記録は施設管理の「様式14（オンライン診療の報告）」の集計に使います。</div></div>',
      '<button type="button" class="btn btn-secondary" data-f0928="close">キャンセル</button><button type="button" class="btn btn-primary" id="f0928-tm-save">保存</button>');
    const sync = () => { $('f0928-tm-detail').style.opacity = $('f0928-tm-on').checked ? '1' : '.45'; };
    $('f0928-tm-on').addEventListener('change', sync); sync();
    $('f0928-tm-save').addEventListener('click', () => saveTelemed(vid));
  }
  async function saveTelemed(vid) {
    const c = sb(); if (!c) return;
    const on = $('f0928-tm-on').checked;
    const row = { is_telemedicine: on, telemed_patient_pref: on ? ($('f0928-tm-pref').value || null) : null,
      telemed_referred: on && $('f0928-tm-ref').checked, telemed_pre_consult: on && $('f0928-tm-pre').checked };
    const { data, error } = await c.from('visits').update(row).eq('id', vid).eq('clinic_id', cid()).select('id,is_telemedicine,telemed_patient_pref,telemed_referred,telemed_pre_consult');
    if (error || !data || !data.length) { toast('オンライン診療の記録を保存できませんでした' + (error ? '：' + error.message : ''), 'error'); return; }
    tm = data[0]; paintTelemed(); closeModal();
    toast(on ? 'オンライン診療として記録しました' : 'オンライン診療の記録を外しました', 'success');
  }

  //   置き場所はカルテ画面の見出し（患者の番号・氏名の右の空き）。見出しのボタン列・診療情報の行は幅いっぱいで、
  //   足すと「カルテ一覧」や請求区分の編集ボタンが押し出されるため、そこには置かない
  function headerButtons() {
    const info = $('header-patient-info'); if (!info) return;
    let hdr = $('f0928-hdr');
    if (!hdr) { hdr = document.createElement('div'); hdr.id = 'f0928-hdr'; hdr.className = 'f0928-hdr'; info.insertAdjacentElement('afterend', hdr); }
    const before = null;
    if (!$('f0928-db-btn')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'f0928-ctx-btn'; b.id = 'f0928-db-btn'; b.style.display = 'none';
      b.textContent = '夜間外来DB'; b.title = '夜間外来DBの来院歴（担当医・検査の陽性・自己負担・流入経路）'; b.addEventListener('click', openDbHistory);
      hdr.insertBefore(b, before);
    }
    if (!$('f0928-telemed-btn')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'f0928-ctx-btn'; b.id = 'f0928-telemed-btn';
      b.addEventListener('click', openTelemed); hdr.insertBefore(b, before); paintTelemed();
    }
  }
  async function onKarteChange() {
    const p = patient(), r = reception();
    const key = (p ? p.id : '') + '|' + (r ? r.id : '');
    if (key === shownFor) return;
    shownFor = key; dbRows = []; tm = null; paintTelemed();
    const db = $('f0928-db-btn'); if (db) db.style.display = 'none';
    renderOldPhotos(true);
    if (!p) return;
    const [rows, t] = await Promise.all([dbRowsFor(p).catch(() => []), loadTelemed(visitIdOf(r)).catch(() => null)]);
    if (shownFor !== key) return;
    dbRows = rows; tm = t; paintTelemed();
    if (db) { db.style.display = rows.length ? '' : 'none'; db.textContent = '夜間外来DB（' + rows.length + '）'; }
    renderOldPhotos();
  }

  // =====================================================================
  // ⑥ 定型文
  // =====================================================================
  const SECTIONS = ['現病歴', '身体所見', 'アセスメント＆プラン'];
  const snipKey = () => 'karte_base_findings_snippets_' + cid();
  //   院ごとの台帳（compat_api.js の store。_enabled の院は karte_clinic_store に書く。無い院はこの画面の間だけ）
  const S = () => (window.__compat && window.__compat.store) || null;
  const loadSnips = () => { try { const s = S(); const v = JSON.parse((s && s.getItem(snipKey())) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  async function saveSnips(list) {
    const s = S(); if (!s) { toast('定型文を保存できませんでした', 'error'); return false; }
    try { await s.ensure(); s.setItem(snipKey(), JSON.stringify(list)); await s.flush(); return true; }
    catch (e) { toast('定型文を保存できませんでした：' + (e.message || e), 'error'); return false; }
  }
  function insertToEditor(html) {
    const ed = $('karte-editor'); if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    }
    document.execCommand('insertHTML', false, html);
    ed.dispatchEvent(new Event('input', { bubbles: true }));   // 画面本体の「未保存」の印と自動の下書きに知らせる
  }
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onDown, true); } }
  function onDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function openSnipMenu(btn) {
    closeMenu();
    const list = loadSnips();
    const m = document.createElement('div'); m.className = 'f0928-menu'; m.id = 'f0928-snip-menu';
    m.innerHTML = '<button type="button" data-k="tpl">診察テンプレ（3項目まとめて）</button>'
      + SECTIONS.map((s, i) => '<button type="button" data-k="sec" data-i="' + i + '">［' + esc(s) + '］</button>').join('')
      + '<div class="sep"></div>' + (list.length ? list.map((s, i) => '<button type="button" data-k="snip" data-i="' + i + '" title="' + esc(s.text) + '">' + esc(s.label) + '</button>').join('') : '<div class="muted">登録した定型文はありません</div>')
      + '<div class="sep"></div><button type="button" data-k="add">＋定型文を登録</button>' + (list.length ? '<button type="button" data-k="del">定型文を削除…</button>' : '');
    document.body.appendChild(m); menuEl = m;
    const r = btn.getBoundingClientRect(); const h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = (r.top - h - 4 > 8 ? r.top - h - 4 : r.bottom + 4) + 'px';
    m.addEventListener('mousedown', (e) => e.preventDefault());   // 本文のカーソル位置を保つ
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = b.dataset.k, i = Number(b.dataset.i); closeMenu();
      if (k === 'tpl') insertToEditor(SECTIONS.map((s) => esc('［' + s + '］') + '<br><br>').join(''));
      else if (k === 'sec') insertToEditor(esc('［' + SECTIONS[i] + '］') + '<br><br>');
      else if (k === 'snip') { const s = loadSnips()[i]; if (s) insertToEditor(esc(s.text).replace(/\n/g, '<br>') + '<br>'); }
      else if (k === 'add') {
        const label = prompt('定型文の名前（メニューに表示されます）'); if (!label || !label.trim()) return;
        const text = prompt('本文（改行は \\n ではなくそのまま入力できます）'); if (!text) return;
        const l2 = loadSnips(); l2.push({ label: label.trim(), text });
        saveSnips(l2).then((ok) => { if (ok) toast('定型文「' + label.trim() + '」を登録しました（この院の全員で使えます）', 'success'); });
      } else if (k === 'del') {
        const l2 = loadSnips(); const names = l2.map((s, j) => (j + 1) + '. ' + s.label).join('\n');
        const v = prompt('削除する定型文の番号\n' + names); const j = Number(v) - 1; if (!(j >= 0 && j < l2.length)) return;
        if (!confirm('定型文「' + l2[j].label + '」を削除しますか？')) return;
        l2.splice(j, 1); saveSnips(l2).then((ok) => { if (ok) toast('定型文を削除しました', 'success'); });
      }
    });
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  }
  function snipButton() {
    const footer = document.querySelector('.m3-soap-footer'); if (!footer || $('f0928-snip-btn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'm3-karte-btn'; b.id = 'f0928-snip-btn'; b.textContent = '定型文';
    b.title = '診察テンプレ（［現病歴］［身体所見］［アセスメント＆プラン］）・登録した定型文を本文に入れる';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => openSnipMenu(b));
    const voice = $('featd-voice-btn'); footer.insertBefore(b, voice ? voice.nextSibling : footer.firstChild);
  }

  // =====================================================================
  // ⑦ 従来の画面で保存した写真（Storage patient-photos）
  // =====================================================================
  const PHOTO_TYPE = { hokensho: '保険証', iryosho: '医療証', kensa: '検査結果', shohou: '処方', other: 'その他' };   // patient_photos.js と同じ
  const asciiSafe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '_');
  let photoSeq = 0;
  async function renderOldPhotos(clear) {
    const host = $('file-content'); if (!host) return;
    let sec = $('f0928-photos');
    const p = patient();
    if (clear || !p || !p.patient_no) { if (sec) sec.style.display = 'none'; return; }
    const seq = ++photoSeq; const c = sb(); if (!c || !ready()) return;
    const prefix = 'patients/' + asciiSafe(p.patient_no);
    const { data, error } = await c.storage.from('patient-photos').list(prefix, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (seq !== photoSeq) return;
    const files = error ? [] : (data || []).filter((f) => f.id);
    if (!files.length) { if (sec) sec.style.display = 'none'; return; }
    const items = [];
    for (const f of files) {
      const m = String(f.name).match(/^(.+?)__(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}\.jpg$/);
      const s = await c.storage.from('patient-photos').createSignedUrl(prefix + '/' + f.name, 600).catch(() => null);
      const url = (s && s.data && s.data.signedUrl) || '';
      items.push('<a href="' + esc(url) + '" target="_blank" rel="noopener">' + (url ? '<img src="' + esc(url) + '" alt="">' : '') + esc(m ? (PHOTO_TYPE[m[1]] || m[1]) : 'その他')
        + (m ? '<br>' + m[2] + '/' + m[3] + '/' + m[4] + ' ' + m[5] + ':' + m[6] : '') + '</a>');
    }
    if (seq !== photoSeq) return;
    if (!sec) {
      sec = document.createElement('div'); sec.id = 'f0928-photos'; sec.className = 'm3-patient-section';
      host.appendChild(sec);
    }
    sec.innerHTML = '<div class="m3-section-header"><span class="m3-section-title">従来の画面で保存した写真（' + files.length + '）</span></div>'
      + '<div class="f0928-photos">' + items.join('') + '</div>';
    sec.style.display = '';
  }

  // =====================================================================
  function boot() {
    if (!$('f0928-style')) { const st = document.createElement('style'); st.id = 'f0928-style'; st.textContent = CSS; document.head.appendChild(st); }
    wireMenus(); watchList(); headerButtons(); snipButton();
    const d = $('reception-date'); if (d && !d.__f0928) { d.__f0928 = true; d.addEventListener('change', scheduleList); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', boot);
  // カルテを開いた・患者や受付が変わったことは画面本体の変数でしか分からないので、軽く見張る（DB は変わったときだけ読む）
  setInterval(() => { if (mainVisible()) { headerButtons(); snipButton(); onKarteChange(); } else if (shownFor) { shownFor = ''; } watchList(); }, 800);
  window.__compat0928 = { decorateList, onKarteChange: () => { shownFor = ''; return onKarteChange(); }, shiftFor, clearCache: () => { shiftCache.clear(); mobileCache.clear(); } };
})();
