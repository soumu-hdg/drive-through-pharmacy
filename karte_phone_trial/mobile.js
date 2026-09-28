// ===== mobile.js — スマホ版（診察中の医療補助が PC のカルテへ報告する） =====
//   ログイン（PC と同じ職員 ID・接続クリニック）→ 当日の患者一覧 → 患者を選ぶ → 4項目を任意で送る
//     保険証／医療証（現場で提示があったとき）・処方した薬・検査結果 … それぞれ写真＋メモ（どちらか片方でも可）
//   送った内容は karte_mobile_reports（1報告＝1行）と Storage mobile-reports に入り、PC のカルテで候補として出る。
//   PC 側で確認して追加するまで、患者写真・処方・検査には入らない（自動では確定しない）。
window.Mobile = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const pad = n => String(n).padStart(2, '0');
  const KINDS = [
    { k: 'insurance', label: '保険証の提示', hint: '診察前に無く、現場で提示があったとき。資格確認書・資格情報のお知らせでも可', memo: 'メモ（任意）例）記号・番号が読みにくい' },
    { k: 'iryo', label: '医療証の提示', hint: 'こども・ひとり親・障害者医療などの医療証', memo: 'メモ（任意）例）有効期限 R9.3.31' },
    { k: 'rx', label: '処方した薬', hint: '薬袋や処方内容の写真と、薬名・用量・日数のメモ', memo: 'メモ（任意）例）ロキソプロフェン錠60mg 3錠 分3 5日分' },
    { k: 'exam', label: '検査結果', hint: '検査結果の写真と、行った検査・結果のメモ', memo: 'メモ（任意）例）血液一般・CRP 実施。CRP 2.1' },
  ];
  const ST = { reserved: '予約済', waiting: '受付中', ready: '診察待', active: '診察中', exam: '検査中', proc: '処置中', billing: '会計待', done: '会計済' };
  let supa = null, user = null, clinic = '', today = '', patients = [], current = null, reports = [], pending = {};

  function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function md(iso) { const p = iso.split('-'); return parseInt(p[1], 10) + '/' + parseInt(p[2], 10); }
  function norm(s) { return String(s || '').replace(/[\s　]/g, ''); }
  function show(id) { ['mLogin', 'mList', 'mReport'].forEach(x => { $(x).style.display = x === id ? '' : 'none'; }); window.scrollTo(0, 0); }
  function toast(m) { const t = $('mToast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

  // ---- 起動・ログイン ----
  async function init() {
    if (typeof supabase === 'undefined' || !window.__SUPABASE_URL__) { show('mLogin'); $('mLoginErr').textContent = '接続設定が読めませんでした'; return; }
    supa = supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
    window.supabaseClient = supa;                     // clinic_context.js が参照する
    window.isSupabaseReady = () => !!supa;            // 同上（院の所属を読む条件）
    ClinicCtx.renderPicker($('mClinicPicker'), { selected: ClinicCtx.boot });
    const { data: { session } } = await supa.auth.getSession();
    if (session) { user = session.user; await enter(''); } else show('mLogin');
  }
  async function login() {
    const email = $('mEmail').value.trim(), pw = $('mPassword').value;
    const err = $('mLoginErr'); err.textContent = '';
    if (!email || !pw) { err.textContent = 'メールアドレスとパスワードを入力してください'; return; }
    const btn = $('mLoginBtn'); btn.disabled = true;
    try {
      const { data, error } = await supa.auth.signInWithPassword({ email, password: pw });
      if (error) { err.textContent = 'ログイン失敗: ' + error.message; return; }
      user = data.user;
      await enter(ClinicCtx.pickerValue($('mClinicPicker')));
    } catch (e) { err.textContent = 'エラー: ' + e.message; }
    finally { btn.disabled = false; }
  }
  async function enter(selected) {
    await ClinicCtx.loadClinics();
    await ClinicCtx.loadUser(user);
    const allowed = ClinicCtx.allowed();
    if (!allowed.length) { await supa.auth.signOut(); show('mLogin'); $('mLoginErr').textContent = 'このIDには所属クリニックが設定されていません'; return; }
    const want = selected || ClinicCtx.boot;
    if (!ClinicCtx.canUse(want)) { await supa.auth.signOut(); show('mLogin'); $('mLoginErr').textContent = 'このIDは「' + ClinicCtx.nameOf(want) + '」に所属していません'; return; }
    ClinicCtx.remember(want);
    if (want !== ClinicCtx.boot) { location.reload(); return; }
    clinic = want; today = todayStr();
    $('mClinicName').textContent = ClinicCtx.nameOf(clinic);
    $('mDate').textContent = today.replace(/-/g, '/');
    show('mList');
    await loadList();
  }
  async function logout() { await supa.auth.signOut(); user = null; patients = []; show('mLogin'); }

  // ---- 当日の患者（Supabase の来院予定・受診 ＋ 夜間外来DBの写し） ----
  async function loadList() {
    const ul = $('mPatients'); ul.innerHTML = '<li class="empty" style="display:block;border:none;background:transparent">読み込み中…</li>';
    const map = new Map();
    const put = (e) => { const key = e.patientNo || ('n:' + norm(e.name)); const cur = map.get(key); if (!cur) map.set(key, e); else { if (!cur.time && e.time) cur.time = e.time; if (!cur.patientNo && e.patientNo) cur.patientNo = e.patientNo; } };
    try {
      const v = await supa.from('visits').select('visit_time,arrived_at,status,visit_type,patients(patient_no,name,name_kana,age,dob,sex)').eq('clinic_id', clinic).eq('visit_date', today);
      (v.data || []).forEach(r => { const p = r.patients || {}; if (!p.name) return; put({ patientNo: p.patient_no || '', name: p.name, kana: p.name_kana || '', age: p.age != null ? p.age : ageOf(p.dob), sex: (p.sex || '').replace(/性$/, ''), time: String(r.arrived_at || r.visit_time || '').slice(0, 5), status: r.status || '' }); });
    } catch (e) { console.warn('visits', e); }
    try {
      const m = await supa.from('karte_db_patients').select('name,age,sex,rtime,ptype').eq('clinic_id', clinic).eq('rdate', md(today));
      (m.data || []).forEach(r => { if (!r.name) return; put({ patientNo: '', name: r.name, kana: '', age: r.age || '', sex: (r.sex || '').replace(/性$/, ''), time: String(r.rtime || '').slice(0, 5), status: 'done' }); });
    } catch (e) { console.warn('mirror', e); }
    try {
      const rp = await supa.from('karte_mobile_reports').select('id,patient_no,patient_name,patient_kana,kind,memo,photo_path,status,created_at').eq('clinic_id', clinic).eq('visit_date', today).order('created_at', { ascending: true });
      reports = rp.data || [];
    } catch (e) { console.warn('reports', e); reports = []; }
    patients = Array.from(map.values()).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')) || a.name.localeCompare(b.name, 'ja'));
    renderList();
  }
  function ageOf(dob) { if (!dob) return ''; const t = new Date(), b = new Date(dob); if (isNaN(b)) return ''; let a = t.getFullYear() - b.getFullYear(); const m = t.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--; return a; }
  function reportsOf(p) { return reports.filter(r => (r.patient_no && p.patientNo && r.patient_no === p.patientNo) || norm(r.patient_name) === norm(p.name)); }
  function renderList() {
    const ul = $('mPatients');
    $('mCount').textContent = patients.length + '名';
    if (!patients.length) { ul.innerHTML = '<li class="empty" style="display:block;border:none;background:transparent">この日の患者はまだいません（PC で受付するか、予約が入ると出ます）</li>'; return; }
    ul.innerHTML = patients.map((p, i) => {
      const rs = reportsOf(p); const pend = rs.filter(r => r.status === 'pending').length;
      const cnt = rs.length ? '<span class="cnt' + (pend ? '' : ' done') + '">' + (pend || '✓') + '</span>' : '';
      const st = ST[p.status] ? '<span class="st ' + (ST[p.status] ? p.status : 'other') + '">' + ST[p.status] + '</span>' : '';
      return '<li onclick="Mobile.open(' + i + ')"><span class="t">' + esc(p.time || '--:--') + '</span><span class="nm"><span class="k">' + esc(p.kana) + '</span><span class="n ' + (p.sex === '女' ? 'f' : p.sex === '男' ? 'm' : '') + '">' + esc(p.name) + '</span></span><span class="ag">' + (p.age !== '' ? esc(p.age) + '歳' : '') + '</span>' + st + cnt + '</li>';
    }).join('');
  }

  // ---- 報告 ----
  function open(i) {
    current = patients[i]; if (!current) return;
    pending = {};
    $('mReportTitle').textContent = '報告';
    $('mPName').textContent = current.name;
    $('mPSub').textContent = [current.kana, current.age !== '' ? current.age + '歳' : '', current.sex, current.patientNo ? '患者番号 ' + current.patientNo : '（患者番号は PC 側で対応付け）'].filter(Boolean).join('　');
    $('mSections').innerHTML = KINDS.map(k => `
      <div class="sec" id="sec_${k.k}">
        <h3>${esc(k.label)}<span class="muted" style="font-weight:400;font-size:12px">　任意</span></h3>
        <p class="hint">${esc(k.hint)}</p>
        <div class="cam">
          <label><span>📷</span> 写真を撮る<input type="file" accept="image/*" capture="environment" onchange="Mobile.pick('${k.k}', this)"></label>
          <label class="lib"><span>🖼</span> 保存した写真から選ぶ<input type="file" accept="image/*" onchange="Mobile.pick('${k.k}', this)"></label>
          <img class="thumb" id="thumb_${k.k}" alt="">
        </div>
        <textarea id="memo_${k.k}" placeholder="${esc(k.memo)}"></textarea>
        <button class="btn send" id="send_${k.k}" onclick="Mobile.send('${k.k}')">この項目を送る</button>
        <div class="status" id="st_${k.k}"></div>
      </div>`).join('');
    renderSent();
    show('mReport');
  }
  function backToList() { current = null; loadList(); show('mList'); }
  async function pick(kind, input) {
    const file = input.files && input.files[0]; if (!file) return;
    const st = $('st_' + kind); st.textContent = '写真を読み込み中…'; st.className = 'status';
    try {
      pending[kind] = await shrink(file, 1600, 0.85);
      const img = $('thumb_' + kind); img.src = URL.createObjectURL(pending[kind]); img.style.display = '';
      st.textContent = '写真を選びました（まだ送っていません）';
    } catch (e) { pending[kind] = null; st.textContent = 'この写真は使えませんでした'; st.className = 'status ng'; }
    finally { input.value = ''; }
  }
  async function send(kind) {
    if (!current) return;
    const memo = $('memo_' + kind).value.trim();
    const blob = pending[kind] || null;
    const st = $('st_' + kind);
    if (!blob && !memo) { st.textContent = '写真かメモのどちらかを入れてください'; st.className = 'status ng'; return; }
    const btn = $('send_' + kind); btn.disabled = true; st.textContent = '送信中…'; st.className = 'status';
    try {
      let path = null;
      if (blob) {
        const key = current.patientNo ? current.patientNo.replace(/[^A-Za-z0-9_-]/g, '_') : ('n' + hash(current.name));
        path = 'mobile/' + clinic + '/' + today.replace(/-/g, '') + '/' + key + '/' + kind + '_' + Date.now() + '.jpg';
        const up = await supa.storage.from('mobile-reports').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
      }
      const row = { clinic_id: clinic, visit_date: today, patient_no: current.patientNo || null, patient_name: current.name, patient_kana: current.kana || null, kind, photo_path: path, memo: memo || null, reported_by: (user && user.email) || null };
      const ins = await supa.from('karte_mobile_reports').insert(row).select('id,patient_no,patient_name,patient_kana,kind,memo,photo_path,status,created_at').single();
      if (ins.error) throw ins.error;
      reports.push(ins.data);
      pending[kind] = null; $('memo_' + kind).value = ''; const img = $('thumb_' + kind); img.style.display = 'none'; img.src = '';
      st.textContent = '✓ 送りました。PC のカルテに候補として出ます'; st.className = 'status ok';
      renderSent(); toast('送りました');
    } catch (e) {
      console.warn('[mobile] send failed', e);
      st.textContent = '送れませんでした（' + (e.message || e) + '）。通信を確認してもう一度お試しください'; st.className = 'status ng';
    } finally { btn.disabled = false; }
  }
  function fmtLocal(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso).slice(0, 16); const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); }
  function renderSent() {
    const box = $('mSent'); const rs = current ? reportsOf(current) : [];
    if (!rs.length) { box.innerHTML = '<div class="muted">まだありません</div>'; return; }
    const L = { insurance: '保険証', iryo: '医療証', rx: '処方', exam: '検査' };
    const S = { pending: 'PC 未確認', applied: 'PC で確認済み', dismissed: '却下' };
    box.innerHTML = rs.map(r => '<div class="r"><span class="kind">' + L[r.kind] + '</span><span class="memo">' + (r.photo_path ? '📷 ' : '') + esc(r.memo || '') + '<br><span style="font-size:11px">' + esc(fmtLocal(r.created_at)) + '</span></span><span class="stt ' + r.status + '">' + S[r.status] + '</span></div>').join('');
  }
  function hash(s) { s = norm(s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16).slice(0, 8); }
  function shrink(file, maxSide, q) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error('変換に失敗')), 'image/jpeg', q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読めません')); };
      img.src = url;
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { login, logout, loadList, open, backToList, pick, send, _state: () => ({ clinic, today, patients, reports, current }) };
})();
