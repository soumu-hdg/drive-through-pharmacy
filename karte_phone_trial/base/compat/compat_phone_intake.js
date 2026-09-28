// ===== 電話問診（試作 2026-09-28）=====
//   電話会社の管理画面（電話履歴）から 1 件ずつダウンロードした通話の録音（WAV）を取り込み、
//   音声カルテと同じ仕組みで文字起こし（Whisper）→ AI で患者情報・問診の項目に分ける → 受付が確認して登録する。
//   ・文字起こし: compat_features_0925.js の voiceTranscribe（2 分ごとに分けて送る処理も同じ）
//   ・項目分け: 音声カルテの /generate-karte に項目分けの指示（customPrompt）を渡す。呼び先は電話番号・住所の頭・生年月日・郵便番号を
//     伏せ字にしてから AI に送るので、伏せ字の所は元の文字起こしから画面側で拾って埋め戻す（AI に個人情報を送らない方針は音声カルテと同じ）
//   ・保存: 院ごとの台帳（karte_clinic_store）に 1 通話 1 行（キー karte_phone_intake_<ID>_<院ID>）。音声ファイルは保存しない（録音は電話会社に 6 か月残る）
//   ・自動で確定しない。受付が内容を確認・修正して「既存患者に受付」「新規患者として登録して受付」を押したときだけ患者・受付を作る
(function () {
  const C = window.__compat; if (!C) return;
  const PREFIX = 'karte_phone_intake_';
  const key = (id) => PREFIX + id + '_' + C.clinicId();
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'pi-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const localIso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const localDt = (d) => localIso(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
  const normName = (s) => String(s || '').replace(/[\s　・]/g, '');
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); else console.log(m); };
  const me = () => { const r = (window.ClinicCtx && ClinicCtx.userRow && ClinicCtx.userRow()) || {}; return { id: r.id || null, name: r.display_name || r.name || r.email || '' }; };

  // ---------- 台帳 ----------
  async function db() { const c = await C.ready(); if (!c) throw new Error('データベースに接続できません'); return c; }
  async function listIntakes() {
    const c = await db(); const cid = C.clinicId();
    const { data, error } = await c.from('karte_clinic_store').select('store_key,data').eq('clinic_id', cid).like('store_key', PREFIX + '%');
    if (error) throw new Error('電話問診を読めませんでした: ' + error.message);
    return (data || []).filter((r) => r.store_key.endsWith('_' + cid) && r.data && r.data.status !== 'deleted').map((r) => r.data)
      .sort((a, b) => String(b.call_at || b.created_at).localeCompare(String(a.call_at || a.created_at)));
  }
  async function saveIntake(it) {
    if (!C.store.enabled) throw new Error('この院は保存先（院ごとの台帳）が用意されていないため保存できません');
    const c = await db(); it.updated_at = new Date().toISOString();
    const row = { clinic_id: C.clinicId(), store_key: key(it.id), data: it, updated_at: it.updated_at }; const u = me(); if (u.id) row.updated_by = u.id;
    const { error } = await c.from('karte_clinic_store').upsert(row, { onConflict: 'clinic_id,store_key' });
    if (error) throw new Error('電話問診を保存できませんでした: ' + error.message);
    return it;
  }
  async function deleteIntake(id) {
    const c = await db();
    const { error } = await c.from('karte_clinic_store').delete().eq('clinic_id', C.clinicId()).eq('store_key', key(id));
    if (error) throw new Error('削除できませんでした: ' + error.message);
  }
  window.__compat.phoneIntake = { listIntakes, saveIntake, deleteIntake, PREFIX };

  // ---------- 伏せ字の埋め戻し（呼び先 /generate-karte の maskPersonalInfo と同じ規則で、元の文字起こしから拾う）----------
  const MASKS = [
    ['[電話番号]', [/0\d{1,4}-\d{1,4}-\d{4}/g, /0\d{9,10}/g]],
    ['[メール]', [/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g]],
    ['[住所]', [/(.{2,3}[都道府県])(.{1,6}[市区町村郡])/g]],
    ['[郵便番号]', [/〒?\d{3}-?\d{4}/g]],
    ['[生年月日]', [/(昭和|平成|令和)\d{1,2}年\d{1,2}月\d{1,2}日/g, /(19|20)\d{2}年\d{1,2}月\d{1,2}日/g, /(19|20)\d{2}\/\d{1,2}\/\d{1,2}/g]],
  ];
  // 呼び先と同じ順で置き換えたときに、各伏せ字に入った元の文字を順番どおりに集める
  function maskedValues(text) {
    const out = {}; let t = String(text || '');
    for (const [tok, res] of MASKS) {
      out[tok] = out[tok] || [];
      for (const re of res) t = t.replace(re, (m) => { out[tok].push(m); return tok; });
    }
    return out;
  }
  function fillMasked(v, vals, used) {
    if (typeof v !== 'string') return v;
    return v.replace(/\[(電話番号|メール|住所|郵便番号|生年月日)\]/g, (m) => {
      const list = vals[m] || []; const i = used[m] || 0; const hit = list[Math.min(i, list.length - 1)];
      if (list.length > 1) used[m] = Math.min(i + 1, list.length - 1);
      // 呼び先の規則は都道府県の前の 2〜3 文字ごと伏せるので、句読点・空白が混ざる（例「。愛知県」）→ 先頭の句読点を落とす
      return hit ? hit.replace(/^[。、，,．.\s「『（(]+/, '') : m;
    });
  }
  // 和暦・西暦 → YYYY-MM-DD
  function toIsoDate(s) {
    s = String(s || '').trim(); if (!s) return '';
    let m = s.match(/^(19|20)(\d{2})[-\/年](\d{1,2})[-\/月](\d{1,2})/); if (m) return m[1] + m[2] + '-' + pad(m[3]) + '-' + pad(m[4]);
    m = s.match(/(昭和|平成|令和)(\d{1,2}|元)年(\d{1,2})月(\d{1,2})日/);
    if (m) { const base = { 昭和: 1925, 平成: 1988, 令和: 2018 }[m[1]]; const y = base + (m[2] === '元' ? 1 : Number(m[2])); return y + '-' + pad(m[3]) + '-' + pad(m[4]); }
    return '';
  }

  // ---------- AI への指示（項目分け）----------
  const PROMPT = [
    'あなたはクリニックの電話受付の記録係です。以下は患者（またはその家族）からの電話の文字起こしです。受付職員と電話の相手の発言が区別なく並んでいます。',
    '内容を読み取り、次の JSON だけを出力してください（前後に説明文やコードブロックの印を付けない）。',
    '規則:',
    '- 会話で言っていないことは推測で埋めず、空文字 "" にする。',
    '- 文字起こしで [電話番号] [住所] [生年月日] [郵便番号] [メール] と伏せ字になっている所は、その伏せ字の文字をそのまま値に入れる（例: "address": "[住所]西日置1-2-3"）。',
    '- 氏名は聞こえたとおりに。フリガナは氏名の読みをカタカナで。漢字が確かでなければ uncertain に "name" を入れる。',
    '- 聞き取りがあいまいな項目、会話の中で矛盾する項目は uncertain に項目名を入れる。',
    '- red_flags には、呼吸が苦しい・意識がおかしい・胸の痛み・けいれん・大量の出血・ぐったりしている など、急ぎの対応が要るかもしれない訴えだけを、会話の言葉のまま入れる。無ければ空の配列。判断や助言は書かない。',
    '- summary は受付の申し送り用に、誰が・いつから・どんな症状で・どうしたいかを 2〜4 文で。',
    '{',
    '  "caller": "本人|家族|その他|不明",',
    '  "caller_relation": "家族の場合の続柄（母・夫など）",',
    '  "name": "", "kana": "", "birth_date": "", "age": "", "sex": "男|女|不明",',
    '  "phone": "", "postal": "", "address": "",',
    '  "chief_complaint": "", "onset": "", "temperature": "", "symptoms": "", "history": "", "medications": "", "allergies": "", "pregnancy": "",',
    '  "insurance": "", "visit_request": "", "other": "",',
    '  "red_flags": [], "uncertain": [], "summary": ""',
    '}',
    '',
    '【電話の文字起こし】',
    '',
  ].join('\n');
  const FIELDS = [
    ['name', '氏名'], ['kana', 'フリガナ'], ['birth_date', '生年月日'], ['age', '年齢'], ['sex', '性別'], ['phone', '電話（会話）'], ['postal', '郵便番号'], ['address', '住所'],
    ['caller', '電話の相手'], ['caller_relation', '続柄'],
    ['chief_complaint', '主訴'], ['onset', 'いつから'], ['temperature', '体温'], ['symptoms', '症状'], ['history', '既往'], ['medications', '服薬'], ['allergies', 'アレルギー'], ['pregnancy', '妊娠'],
    ['insurance', '保険'], ['visit_request', '来院の希望'], ['other', 'その他'],
  ];
  function parseJson(text) {
    const s = String(text || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI の応答から項目を読み取れませんでした');
    return JSON.parse(s.slice(a, b + 1));
  }
  async function structure(api, transcript) {
    const res = await fetch(api + '/generate-karte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, customPrompt: PROMPT }) });
    if (!res.ok) { let m = 'HTTP ' + res.status; try { const j = await res.json(); m = j.error || m; } catch (e) { /* noop */ } throw new Error('項目分けエラー: ' + m); }
    const raw = String((await res.json()).karte || '');
    const f = parseJson(raw);
    const vals = maskedValues(transcript), used = {};
    Object.keys(f).forEach((k) => { if (typeof f[k] === 'string') f[k] = fillMasked(f[k], vals, used); });
    const iso = toIsoDate(f.birth_date); if (iso) f.birth_date = iso;
    f.red_flags = Array.isArray(f.red_flags) ? f.red_flags : []; f.uncertain = Array.isArray(f.uncertain) ? f.uncertain : [];
    return f;
  }

  // ---------- 1 件の取り込み ----------
  async function processFile(file, meta, onStep) {
    const vt = window.__compat.voiceTranscribe; if (!vt) throw new Error('音声カルテの部品が読み込まれていません');
    const api = await vt.loadWhisper();
    onStep && onStep('文字起こし中…');
    const transcript = (await vt.transcribe(api, file)).trim();
    if (!transcript) throw new Error('音声から文字を起こせませんでした');
    onStep && onStep('項目に分けています…');
    const fields = await structure(api, transcript);
    const it = {
      id: newId(), status: 'unconfirmed', created_at: new Date().toISOString(), created_by: me().name,
      call_at: meta.call_at || '', caller_phone: meta.caller_phone || '', file_name: file.name, file_size: file.size,
      transcript, fields, original: JSON.parse(JSON.stringify(fields)),
    };
    return saveIntake(it);
  }

  // ---------- 既存患者の候補 ----------
  async function candidates(it) {
    const c = await db();
    const { data } = await c.from('patients').select('id,patient_no,name,name_kana,dob,phone,sex,receipt_extra').eq('clinic_id', C.clinicId()).limit(5000);
    const f = it.fields || {}; const ph = [digits(it.caller_phone), digits(f.phone)].filter((x) => x.length >= 10);
    const nm = normName(f.name), kn = normName(f.kana), dob = f.birth_date;
    return (data || []).filter((p) => !(p.receipt_extra && p.receipt_extra.baseProfile && p.receipt_extra.baseProfile.is_active === false)).map((p) => {
      const why = [];
      if (ph.length && ph.includes(digits(p.phone))) why.push('電話');
      if (nm && normName(p.name) === nm) why.push('氏名');
      if (kn && normName(p.name_kana) === kn) why.push('フリガナ');
      if (dob && String(p.dob || '').slice(0, 10) === dob) why.push('生年月日');
      return { p, why };
    }).filter((x) => x.why.length && (x.why.length >= 2 || x.why.includes('電話'))).sort((a, b) => b.why.length - a.why.length).slice(0, 5);
  }

  // ---------- 登録（受付の作成は置き換え層の /receptions をそのまま使う）----------
  async function api(path, method, body) {
    const r = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* noop */ }
    if (!r.ok) throw new Error((j && (j.detail || j.error || j.message)) || ('HTTP ' + r.status));
    return j;
  }
  async function makeReception(it, patientId, date, time) {
    const rc = await api('/receptions', 'POST', { patient_id: patientId, reception_date: date, department: '内科', status: 'reserved', appointment_time: time || null, first_visit: it.link_new ? true : null });
    return rc.id;
  }
  async function registerNew(it, date, time) {
    const f = it.fields || {};
    const no = (await api('/patients/next-number', 'GET')).patient_no;
    const sex = /女/.test(f.sex) ? 'female' : /男/.test(f.sex) ? 'male' : 'other';
    const p = await api('/patients', 'POST', { patient_no: no, auto_patient_no: true, name: f.name, name_kana: f.kana || null, gender: sex, birth_date: f.birth_date || null,
      phone1: f.phone || it.caller_phone || null, postal_code: f.postal || null, address: f.address || null, memo: '電話問診から登録（' + (it.call_at || '').replace('T', ' ') + '）' });
    return p;
  }

  // ---------- 画面 ----------
  const CSS = `
  #pi-modal .modal-content{width:min(1240px,96vw);max-height:92vh;display:flex;flex-direction:column}
  #pi-modal .modal-body{overflow:auto;padding:12px 16px}
  #pi-modal .pi-top{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;padding:10px 12px;border:1px dashed #9bb7a5;background:#f6faf7;margin-bottom:12px}
  #pi-modal .pi-top label{font-size:12px;color:#555;display:flex;flex-direction:column;gap:3px}
  #pi-modal .pi-top input{padding:5px 7px;border:1px solid #c9d3cd;font-size:13px}
  #pi-modal .pi-grid{display:grid;grid-template-columns:300px 1fr;gap:12px;min-height:420px}
  #pi-modal .pi-list{border:1px solid #d6ddd9;overflow:auto;max-height:64vh}
  #pi-modal .pi-item{padding:8px 10px;border-bottom:1px solid #eef1ef;cursor:pointer;font-size:12.5px}
  #pi-modal .pi-item.on{background:#e6f2ea;border-left:4px solid #1f6b3a;padding-left:6px}
  #pi-modal .pi-item b{display:block;font-size:13px}
  #pi-modal .pi-st{display:inline-block;font-size:11px;padding:0 5px;border:1px solid currentColor;border-radius:2px;margin-left:4px}
  #pi-modal .st-unconfirmed{color:#b45309} #pi-modal .st-registered{color:#1f6b3a} #pi-modal .st-hold{color:#666}
  #pi-modal .pi-detail{border:1px solid #d6ddd9;display:grid;grid-template-columns:1fr 1.15fr}
  #pi-modal .pi-tr{padding:10px 12px;background:#fafaf7;border-right:1px solid #e3e7e4;font-size:13px;white-space:pre-wrap;overflow:auto;max-height:64vh}
  #pi-modal .pi-form{padding:10px 12px;overflow:auto;max-height:64vh}
  #pi-modal .pi-row{display:grid;grid-template-columns:7.5em 1fr;gap:6px;align-items:start;margin:3px 0}
  #pi-modal .pi-row span{font-size:12px;color:#555;padding-top:5px}
  #pi-modal .pi-row input,#pi-modal .pi-row textarea{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid #c9d3cd;font-size:13px;font-family:inherit}
  #pi-modal .pi-row.unc input,#pi-modal .pi-row.unc textarea{border-color:#d97706;background:#fffbeb}
  #pi-modal .pi-flag{border-left:4px solid #b91c1c;background:#fef2f2;color:#991b1b;padding:6px 10px;margin:6px 0;font-weight:700;font-size:13px}
  #pi-modal .pi-sum{border-left:4px solid #1f6b3a;background:#f1f7f3;padding:6px 10px;margin:6px 0;font-size:13px}
  #pi-modal .pi-cand{border:1px solid #d6ddd9;padding:6px 8px;margin:8px 0;font-size:12.5px}
  #pi-modal .pi-cand label{display:block;padding:2px 0;cursor:pointer}
  #pi-modal .pi-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
  #pi-modal .pi-act input{padding:4px 6px;border:1px solid #c9d3cd}
  #pi-modal .pi-note{font-size:11.5px;color:#666;margin:4px 0}
  #pi-modal .pi-busy{color:#1f6b3a;font-size:12.5px}
  .pi-badge{position:absolute;top:-4px;right:-4px;background:#d97706;color:#fff;border-radius:8px;font-size:10px;min-width:15px;height:15px;line-height:15px;text-align:center;padding:0 3px}`;
  let state = { list: [], sel: null, cands: [] };

  function ensureModal() {
    if (document.getElementById('pi-modal')) return document.getElementById('pi-modal');
    const st = document.createElement('style'); st.id = 'pi-style'; st.textContent = CSS; document.head.appendChild(st);
    const m = document.createElement('div'); m.id = 'pi-modal'; m.className = 'modal hidden';
    m.innerHTML = `<div class="modal-content">
      <div class="modal-header"><h3><i class="fas fa-phone-volume"></i> 電話問診</h3><button type="button" class="modal-close" id="pi-close" aria-label="閉じる">&times;</button></div>
      <div class="modal-body">
        <div class="pi-top">
          <label>通話の録音（WAV・複数可）<input type="file" id="pi-files" accept="audio/*,.wav" multiple></label>
          <label>着信日時<input type="datetime-local" id="pi-callat"></label>
          <label>相手の電話番号<input type="tel" id="pi-phone" placeholder="電話履歴の発信元" size="16"></label>
          <button type="button" class="btn btn-primary" id="pi-run"><i class="fas fa-file-import"></i> 取り込む</button>
          <span class="pi-busy" id="pi-busy"></span>
          <p class="pi-note" style="flex-basis:100%">電話会社の管理画面「電話履歴」→「録音」→ ダウンロード（WAV）したファイルを選びます。文字起こしと項目分けは音声カルテと同じ仕組みで、電話番号・住所・生年月日は伏せてから AI に送ります。音声ファイルは保存しません。</p>
        </div>
        <div class="pi-grid"><div class="pi-list" id="pi-list"></div><div id="pi-detail"><p class="pi-note" style="padding:12px">左の一覧から選ぶと内容が出ます。</p></div></div>
      </div></div>`;
    document.body.appendChild(m);
    m.querySelector('#pi-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#pi-run').addEventListener('click', runImport);
    m.querySelector('#pi-files').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0]; if (f && f.lastModified) m.querySelector('#pi-callat').value = localDt(new Date(f.lastModified));
    });
    return m;
  }
  function close() { const m = document.getElementById('pi-modal'); if (m) { m.classList.add('hidden'); m.style.display = ''; } refreshBadge(); }
  async function open() {
    const m = ensureModal(); m.classList.remove('hidden'); m.style.display = 'flex';
    if (!m.querySelector('#pi-callat').value) m.querySelector('#pi-callat').value = localDt(new Date());
    await reload();
  }
  async function reload(selId) {
    try { state.list = await listIntakes(); } catch (e) { toast(e.message, 'error'); state.list = []; }
    renderList();
    const id = selId || (state.sel && state.sel.id);
    const it = state.list.find((x) => x.id === id);
    if (it) select(it.id); else document.getElementById('pi-detail').innerHTML = '<p class="pi-note" style="padding:12px">左の一覧から選ぶと内容が出ます。</p>';
  }
  const ST = { unconfirmed: '未確認', registered: '登録済み', hold: '保留' };
  function renderList() {
    const box = document.getElementById('pi-list');
    if (!state.list.length) { box.innerHTML = '<p class="pi-note" style="padding:12px">まだ取り込んだ電話はありません。</p>'; return; }
    box.innerHTML = state.list.map((it) => { const f = it.fields || {};
      return `<div class="pi-item${state.sel && state.sel.id === it.id ? ' on' : ''}" data-id="${esc(it.id)}">
        <b>${esc(f.name || '（氏名なし）')}${(f.red_flags || []).length ? ' <span style="color:#b91c1c">⚠</span>' : ''}</b>
        ${esc((it.call_at || it.created_at || '').replace('T', ' ').slice(0, 16))}　${esc(it.caller_phone || f.phone || '')}
        <span class="pi-st st-${esc(it.status)}">${esc(ST[it.status] || it.status)}</span><br>
        <span style="color:#666">${esc((f.chief_complaint || f.summary || '').slice(0, 40))}</span></div>`; }).join('');
    box.querySelectorAll('.pi-item').forEach((el) => el.addEventListener('click', () => select(el.dataset.id)));
  }
  async function select(id) {
    const it = state.list.find((x) => x.id === id); if (!it) return; state.sel = it; renderList();
    const f = it.fields || {}; const unc = new Set((f.uncertain || []).map(String));
    const row = (k, label) => { const long = ['symptoms', 'history', 'medications', 'other', 'address', 'visit_request'].includes(k);
      const v = esc(f[k] || '');
      return `<div class="pi-row${unc.has(k) ? ' unc' : ''}"><span>${esc(label)}${unc.has(k) ? '（要確認）' : ''}</span>${long ? `<textarea data-k="${k}" rows="2">${v}</textarea>` : `<input data-k="${k}" value="${v}">`}</div>`; };
    const d = document.getElementById('pi-detail');
    d.innerHTML = `<div class="pi-detail">
      <div class="pi-tr"><div style="font-weight:700;margin-bottom:6px">文字起こし（${esc(it.file_name || '')}）</div>${esc(it.transcript || '')}</div>
      <div class="pi-form">
        ${(f.red_flags || []).length ? `<div class="pi-flag">⚠ 急ぎの確認が要るかもしれない訴え：${esc(f.red_flags.join('／'))}</div>` : ''}
        ${f.summary ? `<div class="pi-sum"><b>申し送り</b>　${esc(f.summary)}</div>` : ''}
        <div class="pi-row"><span>着信日時</span><input data-meta="call_at" type="datetime-local" value="${esc(it.call_at || '')}"></div>
        <div class="pi-row"><span>着信番号</span><input data-meta="caller_phone" value="${esc(it.caller_phone || '')}"></div>
        ${FIELDS.map(([k, l]) => row(k, l)).join('')}
        <div class="pi-cand" id="pi-cand">既存患者の候補を探しています…</div>
        <div class="pi-act">
          <label style="font-size:12px">来院予定日 <input type="date" id="pi-date" value="${esc(it.visit_date || localIso(new Date()))}"></label>
          <label style="font-size:12px">時刻 <input type="time" id="pi-time" value="${esc(it.visit_time || '')}"></label>
        </div>
        <div class="pi-act">
          <button type="button" class="btn btn-secondary" id="pi-save"><i class="fas fa-save"></i> 修正を保存</button>
          <button type="button" class="btn btn-primary" id="pi-link" ${it.status === 'registered' ? 'disabled' : ''}>選んだ既存患者で受付</button>
          <button type="button" class="btn btn-primary" id="pi-new" ${it.status === 'registered' ? 'disabled' : ''}>新規患者として登録して受付</button>
          <button type="button" class="btn btn-secondary" id="pi-copy">申し送りをコピー</button>
          <button type="button" class="btn btn-secondary" id="pi-hold">${it.status === 'hold' ? '未確認に戻す' : '保留'}</button>
          <button type="button" class="btn btn-danger" id="pi-del">削除</button>
        </div>
        ${it.status === 'registered' ? `<p class="pi-note">登録済み：${esc(it.linked_patient_no || '')} ${esc(it.linked_patient_name || '')}（${esc((it.registered_at || '').replace('T', ' ').slice(0, 16))} ${esc(it.registered_by || '')}）</p>` : ''}
        <p class="pi-note">AI の結果は下書きです。通話を聞き直して、要確認（黄色）の項目を直してから登録してください。自動では登録しません。</p>
      </div></div>`;
    d.querySelector('#pi-save').addEventListener('click', () => act(saveEdits));
    d.querySelector('#pi-link').addEventListener('click', () => act(linkExisting));
    d.querySelector('#pi-new').addEventListener('click', () => act(createNew));
    d.querySelector('#pi-copy').addEventListener('click', copySummary);
    d.querySelector('#pi-hold').addEventListener('click', () => act(async () => { collect(); state.sel.status = state.sel.status === 'hold' ? 'unconfirmed' : 'hold'; await saveIntake(state.sel); await reload(state.sel.id); }));
    d.querySelector('#pi-del').addEventListener('click', () => act(async () => { if (!confirm('この電話問診を削除します。よろしいですか？')) return; await deleteIntake(state.sel.id); state.sel = null; await reload(); }));
    try { state.cands = await candidates(it); } catch (e) { state.cands = []; }
    const cb = document.getElementById('pi-cand'); if (!cb || state.sel !== it) return;
    cb.innerHTML = state.cands.length
      ? '<b>既存患者の候補</b>' + state.cands.map((x, i) => `<label><input type="radio" name="pi-cand" value="${esc(x.p.id)}" ${i === 0 ? 'checked' : ''}> ${esc(x.p.patient_no || '')}　${esc(x.p.name || '')}（${esc(x.p.name_kana || '')}）${esc(String(x.p.dob || '').slice(0, 10))}　一致：${esc(x.why.join('・'))}</label>`).join('')
      : '<b>既存患者の候補</b>：見つかりません（新規患者として登録できます）';
  }
  function collect() {
    const d = document.getElementById('pi-detail'); const it = state.sel; if (!d || !it) return it;
    d.querySelectorAll('[data-k]').forEach((el) => { it.fields[el.dataset.k] = el.value.trim(); });
    d.querySelectorAll('[data-meta]').forEach((el) => { it[el.dataset.meta] = el.value.trim(); });
    const dt = d.querySelector('#pi-date'), tm = d.querySelector('#pi-time'); if (dt) it.visit_date = dt.value; if (tm) it.visit_time = tm.value;
    return it;
  }
  async function act(fn) { try { await fn(); } catch (e) { toast(e.message || String(e), 'error'); } }
  async function saveEdits() { collect(); await saveIntake(state.sel); toast('電話問診を保存しました'); await reload(state.sel.id); }
  function markRegistered(it, p, recId) {
    it.status = 'registered'; it.linked_patient_id = p.id; it.linked_patient_no = p.patient_no; it.linked_patient_name = p.name; it.reception_id = recId;
    it.registered_at = new Date().toISOString(); it.registered_by = me().name;
  }
  async function afterRegister(it) {
    await saveIntake(it); await reload(it.id);
    if (typeof loadReceptions === 'function') { try { await loadReceptions(); } catch (e) { /* noop */ } }
  }
  async function linkExisting() {
    const it = collect(); const r = document.querySelector('input[name="pi-cand"]:checked');
    if (!r) throw new Error('既存患者の候補を選んでください（候補が無いときは新規患者として登録します）');
    const x = state.cands.find((c) => c.p.id === r.value); if (!x) throw new Error('候補が見つかりません');
    if (!it.visit_date) throw new Error('来院予定日を入れてください');
    const recId = await makeReception(it, x.p.id, it.visit_date, it.visit_time);
    markRegistered(it, x.p, recId); await afterRegister(it);
    toast(x.p.name + 'さんの受付（予約）を作りました');
  }
  async function createNew() {
    const it = collect(); const f = it.fields;
    if (!f.name) throw new Error('氏名を入れてください');
    if (!it.visit_date) throw new Error('来院予定日を入れてください');
    if (state.cands.length && !confirm('既存患者の候補があります。それでも新しい患者として登録しますか？')) return;
    it.link_new = true;
    const p = await registerNew(it, it.visit_date, it.visit_time);
    const recId = await makeReception(it, p.id, it.visit_date, it.visit_time);
    markRegistered(it, p, recId); await afterRegister(it);
    toast(p.name + 'さんを新規患者（' + p.patient_no + '）として登録し、受付（予約）を作りました');
  }
  async function copySummary() {
    const it = collect(); const f = it.fields || {};
    const lines = ['【電話問診】' + (it.call_at || '').replace('T', ' '), f.summary && ('申し送り：' + f.summary),
      ...FIELDS.filter(([k]) => f[k]).map(([k, l]) => l + '：' + f[k]), (f.red_flags || []).length && ('注意：' + f.red_flags.join('／'))].filter(Boolean);
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('申し送りをコピーしました（カルテの本文に貼れます）'); } catch (e) { toast('コピーできませんでした', 'error'); }
  }
  async function runImport() {
    const m = ensureModal(); const files = [...(m.querySelector('#pi-files').files || [])];
    if (!files.length) { toast('録音ファイルを選んでください', 'error'); return; }
    const busy = m.querySelector('#pi-busy'); const btn = m.querySelector('#pi-run'); btn.disabled = true;
    let last = null, ng = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; const pre = (files.length > 1 ? (i + 1) + '/' + files.length + ' ' : '') + f.name + '：';
      try {
        // 2 件目以降の着信日時はファイルの更新日時（電話会社の管理画面から落とした時刻）を使う
        const callAt = i === 0 ? m.querySelector('#pi-callat').value : (f.lastModified ? localDt(new Date(f.lastModified)) : '');
        last = await processFile(f, { call_at: callAt, caller_phone: i === 0 ? m.querySelector('#pi-phone').value.trim() : '' }, (s) => { busy.textContent = pre + s; });
      } catch (e) { ng++; toast(pre + (e.message || e), 'error'); }
    }
    busy.textContent = ng ? ('取り込み完了（失敗 ' + ng + ' 件）') : '取り込み完了';
    btn.disabled = false; m.querySelector('#pi-files').value = ''; m.querySelector('#pi-phone').value = '';
    await reload(last && last.id); refreshBadge();
  }

  // ---------- 受付画面の見出しのボタンと未確認の件数 ----------
  async function refreshBadge() {
    const b = document.getElementById('btn-phone-intake'); if (!b) return;
    let n = 0; try { n = (await listIntakes()).filter((x) => x.status === 'unconfirmed').length; } catch (e) { /* ログイン前 */ }
    let bd = b.querySelector('.pi-badge'); if (!bd) { bd = document.createElement('span'); bd.className = 'pi-badge'; b.appendChild(bd); }
    bd.textContent = n; bd.style.display = n ? '' : 'none';
  }
  function addButton() {
    const rec = document.querySelector('#reception-screen .reception-header-right .header-icons');
    if (!rec || document.getElementById('btn-phone-intake')) return;
    if (!document.getElementById('pi-style')) { const st = document.createElement('style'); st.id = 'pi-style'; st.textContent = CSS; document.head.appendChild(st); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.id = 'btn-phone-intake'; b.title = '電話問診（通話の録音から問診・患者情報を取り込む）';
    b.style.position = 'relative'; b.innerHTML = '<i class="fas fa-phone-volume"></i>';
    b.addEventListener('click', open);
    rec.insertBefore(b, rec.firstChild);
  }
  window.PhoneIntake = { open, reload, refreshBadge };
  function boot() { addButton(); setTimeout(refreshBadge, 4000); setInterval(refreshBadge, 120000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
