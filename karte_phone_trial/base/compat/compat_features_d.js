// ===== 置き換え層（担当D・2026-09-24） compat_features_d.js =====
// 統合版の独自機能を、基準版の画面（renderer.js・api.js は無改変）でも使えるようにする。
// 統合版の部品（app/*.js）は作り直さずにそのまま読み込み、結果の入れ先だけを基準版の画面の部品にする。
//   1. 音声カルテ      … whisper_client.js（録音・ファイル読込 → 文字起こし → カルテ生成）。反映先は基準版の本文（#karte-editor）
//   2. 証の読み取り    … name_dict.js・ocr_engine.js・qr_decoder.js・ocr_ui.js（写真の OCR と資格確認書の QR。端末内で処理し外部へ送らない）。
//                        結果は「医療保険追加」「公費追加」の小窓に候補として入れる（登録を押すまで保存しない）
//   3. 予約で届いた証  … rsv_docs.js（Storage rsv-documents）。患者へ引き継がれた patients.rsv_docs を保険等・ファイルのタブで見る
//   4. スマホからの報告 … mobile_inbox.js（karte_mobile_reports・Storage mobile-reports）。カルテの見出しの「スマホ報告」から見て、
//                        担当者が確認して追加する（自動では確定しない）
// 画面の部品（ボタン・枠）は compat_ui_features.js の担当D の部分が置く。ここは処理だけ。
// 統合版の部品は、使うときに初めて読み込む（読み込み順は SETS のとおり。すでに script タグで読み込まれていれば読み込まない）。
window.CompatFeatD = window.CompatFeatD || (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); else console.log('[担当D]', m); };
  const sb = () => (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : null;
  const cid = () => (typeof currentClinicId === 'function' ? currentClinicId() : '');
  /* global currentPatient, currentReception, currentKarteDate */
  const patient = () => (typeof currentPatient !== 'undefined' ? currentPatient : null);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const karteDate = () => (typeof currentKarteDate !== 'undefined' && currentKarteDate) || (typeof currentReception !== 'undefined' && currentReception && currentReception.reception_date) || today();
  const slash = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? String(iso).replace(/-/g, '/') : (iso || ''));

  // =====================================================================
  // 統合版の部品の読み込み
  // =====================================================================
  const CDN = {
    tesseract: ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'],
    jsqr: ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx'],
  };
  const SETS = {
    whisper: [['../whisper_client.js']],
    ocr: [CDN.tesseract, CDN.jsqr, ['../name_dict.js'], ['../ocr_engine.js'], ['../qr_decoder.js'], ['../ocr_ui.js']],
    rsv: [['../rsv_docs.js']],
    mobile: [['../mobile_inbox.js']],
  };
  const loading = new Map();
  const pathOf = (u) => { try { return new URL(u, location.href).origin + new URL(u, location.href).pathname; } catch (e) { return String(u); } };
  function loadOne(src, integrity) {
    const key = pathOf(src);
    if (loading.has(key)) return loading.get(key);
    // すでに script タグで読み込まれている（index.html に読み込み行を足した後）なら読み込まない
    if ([...document.scripts].some((s) => s.src && pathOf(s.src) === key)) { loading.set(key, Promise.resolve()); return loading.get(key); }
    const p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL(src, location.href).href;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
      s.onload = () => res();
      s.onerror = () => { loading.delete(key); rej(new Error('部品を読み込めません: ' + src.split('/').pop())); };
      document.head.appendChild(s);
    });
    loading.set(key, p); return p;
  }
  async function need(name) {
    // whisper_client.js は escapeHtml を関数宣言で持つ。基準版の画面本体の escapeHtml（数値も扱える）を上書きしないよう、読み込み後に戻す
    const keep = window.escapeHtml;
    try { for (const [src, sri] of SETS[name]) await loadOne(src, sri); }
    finally { if (typeof keep === 'function' && window.escapeHtml !== keep) window.escapeHtml = keep; }
  }

  // =====================================================================
  // 共通: Storage の画像・患者ファイルへの保存
  // =====================================================================
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const fileToDataUrl = blobToDataUrl;
  async function download(bucket, path) {
    const c = sb(); const { data, error } = await c.storage.from(bucket).download(path);
    if (error) throw new Error(error.message || '画像を取り出せません'); return data;
  }
  async function signed(bucket, path) {
    const c = sb(); const { data, error } = await c.storage.from(bucket).createSignedUrl(path, 600);
    return error ? '' : data.signedUrl;
  }
  // 基準版の患者ファイル（/patients/:id/files ＝ 置き換え層が Storage karte-patient-files に置く）へ保存する
  async function saveToPatientFiles(blob, baseName, remarks) {
    const p = patient(); if (!p) throw new Error('患者を選択してください');
    const type = blob.type && /^image\//.test(blob.type) ? blob.type : 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : 'jpg';
    const name = baseName + '.' + ext;
    const res = await fetch('/api/v1/patients/' + p.id + '/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, original_name: name, content_type: type, size: blob.size, data_url: await blobToDataUrl(blob), date: karteDate(), remarks: remarks || null }) });
    let j = null; try { j = await res.json(); } catch (e) { /* 本文なし */ }
    if (!res.ok) throw new Error((j && j.detail) || ('保存できませんでした（' + res.status + '）'));
    if (typeof loadPatientFiles === 'function' && $('file-content') && $('file-content').style.display !== 'none') { try { await loadPatientFiles(p.id); } catch (e) { /* 表示だけ */ } }
    return j;
  }

  // =====================================================================
  // 1. 音声カルテ
  // =====================================================================
  let voiceReady = false;
  async function voiceToggle(force) {
    const panel = $('featd-voice'); if (!panel) return;
    const open = force === undefined ? panel.classList.contains('hidden') : !!force;
    panel.classList.toggle('hidden', !open);
    const btn = $('featd-voice-btn'); if (btn) btn.classList.toggle('primary', open);
    if (!open || voiceReady) return;
    try {
      await need('whisper'); voiceReady = true;
      if (typeof whisperInit === 'function') await whisperInit();   // マイク一覧・カルテ生成の型の一覧（統合版と同じ呼び先）
    } catch (e) { const st = $('whisperStatus'); if (st) st.textContent = '音声カルテを準備できませんでした: ' + e.message; }
  }
  // 基準版の本文は 1 つの欄なので、生成されたカルテの文章（【主訴】〜【プラン】の見出しつき）を行ごとにそのまま段落として足す。
  // 見出しの無い文章（文字起こしのみ等）は【音声カルテ】の見出しを付ける。保存・確定は基準版の保存ボタンで
  function voiceApply(source) {
    const karte = ($('whisperKarte') || {}).value || '', tr = ($('whisperTranscript') || {}).value || '';
    const useTr = source === 'transcript' || !karte.trim();
    const text = useTr ? tr : karte;
    if (!text.trim()) { toast('本文に入れる文章がありません', 'error'); return false; }
    if (!patient()) { toast('患者を選択してください', 'error'); return false; }
    if (typeof appendTextToKarteEditor !== 'function') { toast('本文に書き込めません', 'error'); return false; }
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!/^[【＜<［\[]/.test(lines[0] || '')) lines.unshift(useTr ? '【音声（文字起こし）】' : '【音声カルテ】');
    lines.forEach((l) => appendTextToKarteEditor(l));
    const ed = $('karte-editor'); if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof whisperSetStatus === 'function') whisperSetStatus('本文に反映しました（保存するまで確定しません）', 'success');
    toast('音声カルテを本文に反映しました');
    return true;
  }

  // =====================================================================
  // 2. 保険証・医療証の読み取り（写真 OCR ＋ 資格確認書の QR）
  // =====================================================================
  //   which: 'ins'（医療保険追加の小窓） / 'pub'（公費追加の小窓）
  const ocrState = { ins: null, pub: null };
  const MODAL = { ins: 'insurance-modal', pub: 'public-expense-modal' };
  let keepBoxOnOpen = null;
  // 統合版の読み取りの流れ（QR 優先 → OCR 補完 → 入力値の点検 → 証の種類の自動判定）をそのまま使う
  async function readCard(dataUrl, progress) {
    await need('ocr');
    /* global QR_DECODER, OCR_ENGINE, validateOcrFields, mergeQrAndOcr */
    progress && progress('QRコード検出中...', 5);
    const qr = await QR_DECODER.decodeFromDataUrl(dataUrl);
    progress && progress('OCR実行中...', 10);
    const data = await OCR_ENGINE.recognize(dataUrl, (st, pct) => progress && progress(st, 10 + Math.max(0, Math.min(100, Number(pct) || 0)) * 0.9));
    const text = data.text || '';
    let ins = data._mergedFields || OCR_ENGINE.extractInsuranceFields(text);
    validateOcrFields(ins); ins = mergeQrAndOcr(qr, ins);
    const iryo = OCR_ENGINE.extractIryoFields(text);
    let kind = OCR_ENGINE.detectCardKind(text).kind;
    if (qr && qr.format === 'kyoukai_kenpo') kind = 'hoken';
    return { kind, ins, iryo, qr };
  }
  function resetBox(which) {
    ocrState[which] = null; const box = $('featd-ocr-' + which); if (!box) return;
    box.classList.add('hidden'); box.innerHTML = '';
  }
  function boxProgress(which, img, text, pct) {
    const box = $('featd-ocr-' + which); if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = '<div class="featd-ocr-row"><img class="featd-ocr-img" src="' + esc(img) + '" alt=""><div class="featd-ocr-main">'
      + '<div class="featd-ocr-title">証の読み取り</div><div class="featd-progress"><div style="width:' + Math.round(pct || 0) + '%"></div></div>'
      + '<div class="insurance-help-text">' + esc(text || '準備中...') + '</div></div></div>';
  }
  function candRow(label, value, fromQr, filled) {
    if (!value) return '';
    return '<tr><th>' + esc(label) + '</th><td><b>' + esc(value) + '</b></td><td>' + (fromQr ? '<span class="featd-tag ok">QR</span>' : '<span class="featd-tag warn">要確認</span>')
      + (filled === false ? ' <span class="featd-tag">参考</span>' : '') + '</td></tr>';
  }
  function renderBox(which) {
    const st = ocrState[which]; const box = $('featd-ocr-' + which); if (!box || !st) return;
    box.classList.remove('hidden');
    if (st.error) {
      box.innerHTML = '<div class="featd-ocr-row"><img class="featd-ocr-img" src="' + esc(st.img) + '" alt=""><div class="featd-ocr-main"><div class="featd-ocr-title">証の読み取り</div>'
        + '<div class="featd-warn">読み取れませんでした: ' + esc(st.error) + '</div><div class="featd-acts"><button type="button" class="btn btn-outline btn-sm" data-featd="ocr-close" data-which="' + which + '">閉じる</button></div></div></div>';
      return;
    }
    const r = st.result; let rows = '', note = '', acts = '';
    if (which === 'ins') {
      const f = r.ins, hasQr = !!(f._qrResult && f._qrResult.format !== 'unknown');
      if (r.kind === 'iryo') note += '<div class="featd-warn">医療証のようです。公費として入れる場合は「公費追加で開く」を押してください。</div>';
      if (f._validationWarnings && f._validationWarnings.length) note += '<div class="featd-warn">' + f._validationWarnings.map(esc).join('<br>') + '</div>';
      rows += candRow('保険者番号', f.insurerNumber, f._insurerFromQR) + candRow('記号', f.symbol, f._symbolFromQR) + candRow('番号', f.memberNumber, f._memberFromQR) + candRow('枝番', f.edaban, f._edabanFromQR);
      if (hasQr && f._qrResult.dependentType) rows += candRow('本人／家族', f._qrResult.dependentType === '本人' ? '本人' : '家族', true);
      rows += candRow('有効期限', f.expiry ? slash(f.expiry) : '', false);
      rows += candRow('氏名（照合用）', f.name, false, false) + candRow('フリガナ（照合用）', f.nameKana, false, false) + candRow('生年月日（照合用）', f.dob ? slash(f.dob) : '', false, false);
      note += '<div class="insurance-help-text">' + (hasQr ? 'QRコードを読み取りました。QR の項目は確実な値です。' : 'QRコードは見つかりませんでした。OCR の参考値のため、必ず証と見比べてください。')
        + '「候補を入れる」を押しても、下の「登録」を押すまで保存されません。</div>';
      acts += '<button type="button" class="btn btn-register btn-sm" data-featd="ocr-fill" data-which="ins">候補を入れる</button>'
        + (hasQr ? '<button type="button" class="btn btn-outline btn-sm" data-featd="ocr-fill-qr" data-which="ins">QRの項目だけ入れる</button>' : '')
        + (r.kind === 'iryo' ? '<button type="button" class="btn btn-outline btn-sm" data-featd="ocr-switch" data-which="ins">公費追加で開く</button>' : '');
    } else {
      const f = r.iryo;
      if (r.kind === 'hoken') note += '<div class="featd-warn">保険証のようです。医療保険として入れる場合は「医療保険追加で開く」を押してください。</div>';
      rows += candRow('医療証の種類', f.iryoType) + candRow('法別番号', f.hobetsu) + candRow('負担者番号', f.kouhiNumber) + candRow('受給者番号', f.recipientNumber)
        + candRow('有効期間（開始）', slash(f.validFrom)) + candRow('有効期間（終了）', slash(f.validTo)) + candRow('自己負担上限', f.copayLimit) + candRow('交付', f.issuer);
      if (f.typeMismatch) note += '<div class="featd-warn">表題は「' + esc(f.iryoType) + '」ですが、法別番号は「' + esc(f.typeMismatch) + '」に当たります。証を見て選んでください。</div>';
      note += '<div class="insurance-help-text">医療証に QR コードは無いため、すべて OCR の参考値です。「候補を入れる」を押しても、下の「登録」を押すまで保存されません。</div>';
      acts += '<button type="button" class="btn btn-register btn-sm" data-featd="ocr-fill" data-which="pub">候補を入れる</button>'
        + (r.kind === 'hoken' ? '<button type="button" class="btn btn-outline btn-sm" data-featd="ocr-switch" data-which="pub">医療保険追加で開く</button>' : '');
    }
    if (!rows) rows = '<tr><td colspan="3" class="featd-warn">読み取れた項目がありません。明るい場所で、証全体がまっすぐ写るように撮り直してください。</td></tr>';
    box.innerHTML = '<div class="featd-ocr-row"><img class="featd-ocr-img" src="' + esc(st.img) + '" alt=""><div class="featd-ocr-main">'
      + '<div class="featd-ocr-title">証の読み取り結果（候補）' + (st.source ? '<span class="insurance-help-text">　' + esc(st.source) + '</span>' : '') + '</div>'
      + note + '<table class="featd-cand-table">' + rows + '</table>'
      + '<div class="featd-acts">' + acts + '<button type="button" class="btn btn-outline btn-sm" data-featd="ocr-close" data-which="' + which + '">閉じる</button></div></div></div>';
  }
  async function ocrRun(which, dataUrl, source) {
    ocrState[which] = { img: dataUrl, source: source || '' };
    boxProgress(which, dataUrl, '準備中...', 2);
    try {
      const result = await readCard(dataUrl, (t, p) => { if (ocrState[which] && ocrState[which].img === dataUrl && !ocrState[which].result) boxProgress(which, dataUrl, t, p); });
      if (!ocrState[which] || ocrState[which].img !== dataUrl) return null;   // 途中で閉じた・別の画像にした
      ocrState[which].result = result;
    } catch (e) { if (ocrState[which]) ocrState[which].error = e.message || String(e); }
    renderBox(which);
    return ocrState[which] && ocrState[which].result;
  }
  async function ocrPickFile(which, input) {
    const f = input && input.files && input.files[0]; if (!f) return;
    const du = await fileToDataUrl(f); input.value = '';
    return ocrRun(which, du, f.name);
  }
  // 基準版の入力欄に値を入れ、基準版の画面本体の処理（保険者番号 → 種別・負担割合、負担者番号 → 公費の種類）を動かす
  function setField(id, value) {
    const el = $(id); if (!el || value == null || value === '') return false;
    el.value = String(value); el.classList.add('featd-cand');
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    const clear = () => { el.classList.remove('featd-cand'); el.removeEventListener('keydown', clear); }; el.addEventListener('keydown', clear);
    return true;
  }
  function ocrFill(which, qrOnly) {
    const st = ocrState[which]; if (!st || !st.result) return [];
    const done = [];
    if (which === 'ins') {
      const f = st.result.ins;
      const pick = (k, qk) => (qrOnly ? (f[qk] ? f[k] : null) : f[k]);
      if (setField('insurance-insurer-number', pick('insurerNumber', '_insurerFromQR'))) done.push('保険者番号');
      if (setField('insurance-symbol', pick('symbol', '_symbolFromQR'))) done.push('記号');
      if (setField('insurance-number', pick('memberNumber', '_memberFromQR'))) done.push('番号');
      if (setField('insurance-branch-number', pick('edaban', '_edabanFromQR'))) done.push('枝番');
      const qr = f._qrResult;
      if (qr && qr.format === 'kyoukai_kenpo' && qr.dependentType) {
        const rel = document.querySelector('input[name="insurance-relationship"][value="' + (qr.dependentType === '本人' ? 'main' : 'family') + '"]');
        if (rel) { rel.checked = true; rel.dispatchEvent(new Event('change', { bubbles: true })); done.push('本人／家族'); }
      }
      if (!qrOnly && f.expiry && setField('insurance-valid-until', slash(f.expiry))) done.push('有効期限');
    } else {
      const f = st.result.iryo;
      if (setField('public-expense-payer-number', f.kouhiNumber)) done.push('負担者番号');
      if (setField('public-expense-recipient-number', f.recipientNumber)) done.push('受給者番号');
      if (setField('public-expense-valid-from', slash(f.validFrom))) done.push('有効期間（開始）');
      if (setField('public-expense-valid-until', slash(f.validTo))) done.push('有効期間（終了）');
      const add = [];
      if (f.iryoType) add.push('医療証 ' + f.iryoType);
      if (f.copayLimit) add.push('自己負担上限 ' + f.copayLimit);
      if (f.issuer) add.push('交付 ' + f.issuer);
      const memo = $('public-expense-manual-note');
      if (memo && add.length) { const line = '読み取り: ' + add.join(' / '); if (memo.value.indexOf(line) < 0) { memo.value = (memo.value ? memo.value + '\n' : '') + line; memo.classList.add('featd-cand'); } done.push('運用メモ'); }
    }
    toast(done.length ? '読み取り結果を候補として入れました（' + done.join('・') + '）。証と見比べてから「登録」を押してください' : '入れられる項目がありませんでした', done.length ? 'info' : 'error');
    return done;
  }
  // 読み取った画像を、もう一方の小窓で読み直さずに開き直す
  function ocrSwitch(which) {
    const st = ocrState[which]; if (!st || !st.result) return;
    const other = which === 'ins' ? 'pub' : 'ins';
    closeModal(which);
    openModalFor(other, () => { ocrState[other] = Object.assign({}, st); renderBox(other); });
  }
  function closeModal(which) { const m = $(MODAL[which]); if (m) m.classList.add('hidden'); }
  function openModalFor(which, after) {
    if (!patient()) { toast('患者を選択してください', 'error'); return false; }
    keepBoxOnOpen = which;
    const r = which === 'ins' ? (typeof openInsuranceModal === 'function' && openInsuranceModal()) : (typeof openPublicExpenseModal === 'function' && openPublicExpenseModal());
    Promise.resolve(r).then(() => { keepBoxOnOpen = null; after && after(); });
    return true;
  }
  // 予約・スマホで届いた画像を読み取り、証の種類に合う小窓（医療保険追加／公費追加）に候補を出す
  async function ocrFromDataUrl(dataUrl, kindHint, source) {
    const which = kindHint === 'iryo' ? 'pub' : 'ins';
    if (!openModalFor(which)) return null;
    return ocrRun(which, dataUrl, source);
  }
  // 小窓を普通に開き直したときは前の読み取り結果を消す
  function watchModals() {
    Object.keys(MODAL).forEach((which) => {
      const m = $(MODAL[which]); if (!m || m.__featdWatch) return; m.__featdWatch = true;
      let wasHidden = m.classList.contains('hidden');
      new MutationObserver(() => {
        const hidden = m.classList.contains('hidden');
        if (wasHidden && !hidden && keepBoxOnOpen !== which) resetBox(which);
        wasHidden = hidden;
      }).observe(m, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // =====================================================================
  // 3. 予約で届いた保険証・医療証（患者へ引き継がれたもの）と、スマホで届いた証
  // =====================================================================
  const RSV_BUCKET = 'rsv-documents', MOBILE_BUCKET = 'mobile-reports';
  const LABEL = { insurance: '保険証', iryo: '医療証', rx: '処方した薬', exam: '検査結果' };
  let docItems = [];
  const fmtAt = (iso) => { if (!iso) return ''; if (typeof rsvDocsFmtAt === 'function') return rsvDocsFmtAt(iso); const d = new Date(iso); return d.toLocaleString('ja-JP'); };
  async function loadDocItems() {
    const p = patient(); const c = sb(); if (!p || !c) return [];
    await need('rsv');
    const items = [];
    // 予約サイト → Storage → 患者へ引き継ぎ（トリガーが patients.rsv_docs に入れる。院ごとの患者の行なので他院のものは出ない）
    const { data, error } = await c.from('patients').select('rsv_docs').eq('id', p.id).eq('clinic_id', cid()).maybeSingle();
    if (error) console.warn('[担当D] 予約の証を読めません', error.message);
    const d = (data && data.rsv_docs) || {};
    ['insurance', 'iryo'].forEach((k) => { const x = d[k]; if (x && x.path) items.push({ src: 'rsv', kind: k, label: LABEL[k], path: x.path, code: x.rsv_code || '', at: x.at, review: x.review || null }); });
    // スマホで届いた証（その日の分）
    try {
      await need('mobile');
      const date = karteDate(); await MobileInbox.fetchRows(date);
      MobileInbox.forPatient({ id: p.patient_no, name: p.name }, date).filter((r) => (r.kind === 'insurance' || r.kind === 'iryo') && r.photo_path)
        .forEach((r) => items.push({ src: 'mobile', kind: r.kind, label: LABEL[r.kind], path: r.photo_path, id: r.id, at: r.created_at, review: r.status === 'pending' ? null : r.status, memo: r.memo }));
    } catch (e) { console.warn('[担当D] スマホの報告を読めません', e.message); }
    return items;
  }
  async function docUrl(it) { return it.src === 'rsv' ? (typeof rsvDocSignedUrl === 'function' ? await rsvDocSignedUrl(it.path).catch(() => '') : await signed(RSV_BUCKET, it.path)) : signed(MOBILE_BUCKET, it.path); }
  async function docBlob(it) { return download(it.src === 'rsv' ? RSV_BUCKET : MOBILE_BUCKET, it.path); }
  async function docDataUrl(it) { if (it.src === 'rsv' && typeof rsvDocToDataUrl === 'function') return rsvDocToDataUrl(it.path); return blobToDataUrl(await docBlob(it)); }
  async function renderDocs() {
    const boxes = ['featd-docs-ins', 'featd-docs-file'].map($).filter(Boolean); if (!boxes.length) return;
    const p = patient();
    if (!p) { boxes.forEach((b) => { b.querySelector('.featd-docs-list').innerHTML = '<div class="insurance-empty">患者を選択してください。</div>'; }); return; }
    boxes.forEach((b) => { b.querySelector('.featd-docs-list').innerHTML = '<div class="insurance-empty">読み込み中…</div>'; });
    let items = []; try { items = await loadDocItems(); } catch (e) { console.warn('[担当D]', e); }
    if (patient() !== p) return;   // 読み込み中に患者が替わった
    docItems = items;
    const html = items.length ? (await Promise.all(items.map(async (it, i) => {
      const url = await docUrl(it); const reviewed = !!it.review;
      return '<div class="featd-doc' + (reviewed ? ' done' : '') + '">'
        + '<div class="featd-doc-thumb">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="拡大"><img src="' + esc(url) + '" alt="' + esc(it.label) + '"></a>' : '<span class="insurance-help-text">画像を開けません</span>') + '</div>'
        + '<div class="featd-doc-meta"><div><b>' + esc(it.label) + '</b> <span class="featd-tag">' + (it.src === 'rsv' ? '予約' : 'スマホ') + '</span>'
        + (reviewed ? ' <span class="featd-tag ok">' + (it.review === 'dismissed' ? '却下' : '確認済み') + '</span>' : ' <span class="featd-tag warn">未確認</span>') + '</div>'
        + '<div class="insurance-help-text">' + (it.src === 'rsv' ? '予約 ' + esc(it.code) + '　' : '') + '受信 ' + esc(fmtAt(it.at)) + '</div>'
        + (it.memo ? '<div class="insurance-help-text">' + esc(it.memo) + '</div>' : '')
        + '<div class="featd-acts">'
        + '<button type="button" class="btn btn-outline btn-sm" data-featd="doc-ocr" data-i="' + i + '">読み取って' + (it.kind === 'iryo' ? '公費' : '保険') + '追加へ</button>'
        + '<button type="button" class="btn btn-outline btn-sm" data-featd="doc-save" data-i="' + i + '">ファイルに保存</button>'
        + (reviewed ? '' : '<button type="button" class="btn btn-outline btn-sm" data-featd="doc-approve" data-i="' + i + '">確認済みにする</button>')
        + '</div></div></div>';
    }))).join('') + '<div class="insurance-help-text">画像は参考です。読み取り結果は候補として小窓に入るだけで、確認して「登録」を押すまで保存されません。</div>'
      : '<div class="insurance-empty">予約・スマホから届いた保険証・医療証はありません。</div>';
    boxes.forEach((b) => { b.querySelector('.featd-docs-list').innerHTML = html; const n = b.querySelector('.featd-docs-count'); if (n) n.textContent = items.length ? items.length + '件' : ''; });
  }
  async function docOcr(i) {
    const it = docItems[i]; if (!it) return;
    try { await ocrFromDataUrl(await docDataUrl(it), it.kind, (it.src === 'rsv' ? '予約で届いた' : 'スマホで届いた') + it.label); }
    catch (e) { toast('画像を取り出せませんでした: ' + e.message, 'error'); }
  }
  async function docSave(i) {
    const it = docItems[i]; if (!it) return;
    try { await saveToPatientFiles(await docBlob(it), it.label + '_' + (it.src === 'rsv' ? '予約' : 'スマホ') + '_' + karteDate(), (it.src === 'rsv' ? '予約サイトから届いた' : 'スマホから届いた') + it.label); toast(it.label + 'を患者のファイルに保存しました'); return true; }
    catch (e) { toast('保存できませんでした: ' + e.message, 'error'); return false; }
  }
  async function docApprove(i) {
    const it = docItems[i]; const c = sb(); const p = patient(); if (!it || !c || !p) return;
    if (it.src === 'mobile') { await mobileSetStatus(it.id, 'applied'); await renderDocs(); return; }
    // 統合版と同じく予約の行に印を付ける（トリガーで患者の引き継ぎにも入る）。予約の行が無い引き継ぎにも印が残るよう、患者の引き継ぎにも直接付ける
    if (it.code) { const { error } = await c.from('rsv2_reservations').update({ docs_review: 'approved' }).eq('code', it.code); if (error) console.warn('[担当D] 予約の行に印を付けられません', error.message); }
    const { data } = await c.from('patients').select('rsv_docs').eq('id', p.id).eq('clinic_id', cid()).maybeSingle();
    const d = (data && data.rsv_docs) || {};
    if (d[it.kind] && d[it.kind].path === it.path) {
      d[it.kind] = Object.assign({}, d[it.kind], { review: 'approved' });
      const { error } = await c.from('patients').update({ rsv_docs: d }).eq('id', p.id).eq('clinic_id', cid());
      if (error) { toast('確認済みにできませんでした: ' + error.message, 'error'); return; }
    }
    toast('確認済みにしました'); await renderDocs();
  }

  // =====================================================================
  // 4. スマホからの報告（保険証・医療証／処方した薬／検査結果の写真とメモ）
  // =====================================================================
  let mobileList = [];
  async function mobileRows() {
    const p = patient(); if (!p) return [];
    await need('mobile');
    const date = karteDate(); await MobileInbox.fetchRows(date);
    return MobileInbox.forPatient({ id: p.patient_no, name: p.name }, date);
  }
  async function mobileSetStatus(id, status) {
    const c = sb(); if (!c) return false;
    let who = null; try { const { data } = await c.auth.getSession(); who = data.session && data.session.user.email || null; } catch (e) { who = null; }
    const { error } = await c.from('karte_mobile_reports').update({ status, applied_by: who, applied_at: new Date().toISOString() }).eq('id', id).eq('clinic_id', cid());
    if (error) { toast('更新できませんでした: ' + error.message, 'error'); return false; }
    try { const r = MobileInbox.rows().find((x) => String(x.id) === String(id)); if (r) r.status = status; } catch (e) { /* 一覧は次の読み込みで直る */ }
    updateBadge(); return true;
  }
  let badgeKey = '';
  async function updateBadge(force) {
    const btn = $('featd-mobile-btn'); if (!btn) return;
    const p = patient(); const key = (p ? p.id : '') + '|' + karteDate();
    if (!force && key === badgeKey && btn.dataset.loaded) { const n = mobileList.filter((r) => r.status === 'pending').length; setBadge(n); return; }
    badgeKey = key;
    if (!p) { setBadge(0); return; }
    try { mobileList = await mobileRows(); btn.dataset.loaded = '1'; } catch (e) { mobileList = []; }
    setBadge(mobileList.filter((r) => r.status === 'pending').length);
  }
  function setBadge(n) { const b = $('featd-mobile-count'); if (b) { b.textContent = n ? String(n) : ''; b.classList.toggle('hidden', !n); } }
  const memoLines = (memo) => String(memo || '').split(/[\r\n、，,／/・;]+/).map((s) => s.trim()).filter(Boolean);
  async function renderMobile() {
    const body = $('featd-mobile-body'); if (!body) return;
    const p = patient();
    const head = $('featd-mobile-patient'); if (head) head.textContent = p ? (p.patient_no + '　' + p.name + '　' + slash(karteDate())) : '患者を選択してください';
    if (!p) { body.innerHTML = '<div class="insurance-empty">患者を選択してください。</div>'; return; }
    body.innerHTML = '<div class="insurance-empty">読み込み中…</div>';
    try { mobileList = await mobileRows(); } catch (e) { body.innerHTML = '<div class="featd-warn">読み込めませんでした: ' + esc(e.message) + '</div>'; return; }
    setBadge(mobileList.filter((r) => r.status === 'pending').length);
    if (!mobileList.length) { body.innerHTML = '<div class="insurance-empty">この日のスマホからの報告はありません。</div>'; return; }
    const cards = await Promise.all(mobileList.map(async (r) => {
      const url = r.photo_path ? await signed(MOBILE_BUCKET, r.photo_path) : '';
      const pending = r.status === 'pending';
      let cand = '';
      if (pending && r.kind === 'rx' && r.memo) cand = memoLines(r.memo).map((l) => '<div class="featd-line"><span>' + esc(l) + '</span><button type="button" class="btn btn-outline btn-sm" data-featd="m-rx" data-id="' + esc(r.id) + '" data-q="' + esc(l) + '">処方で探す</button></div>').join('');
      let acts = '';
      if (pending) {
        if ((r.kind === 'insurance' || r.kind === 'iryo') && r.photo_path) acts += '<button type="button" class="btn btn-outline btn-sm" data-featd="m-ocr" data-id="' + esc(r.id) + '">読み取って' + (r.kind === 'iryo' ? '公費' : '保険') + '追加へ</button>';
        if ((r.kind === 'rx' || r.kind === 'exam') && r.memo) acts += '<button type="button" class="btn btn-outline btn-sm" data-featd="m-note" data-id="' + esc(r.id) + '">本文に追記</button>';
        if (r.photo_path) acts += '<button type="button" class="btn btn-outline btn-sm" data-featd="m-save" data-id="' + esc(r.id) + '">写真をファイルに保存</button>';
        acts += '<button type="button" class="btn btn-register btn-sm" data-featd="m-apply" data-id="' + esc(r.id) + '">済（確認した）</button>'
          + '<button type="button" class="btn btn-danger-soft btn-sm" data-featd="m-dismiss" data-id="' + esc(r.id) + '">却下</button>';
      }
      const who = r.reported_by ? String(r.reported_by).split('@')[0] : '';
      return '<div class="featd-doc' + (pending ? '' : ' done') + '">'
        + '<div class="featd-doc-thumb">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="拡大"><img src="' + esc(url) + '" alt=""></a>' : '<span class="insurance-help-text">写真なし</span>') + '</div>'
        + '<div class="featd-doc-meta"><div><b>' + esc(LABEL[r.kind] || r.kind) + '</b> ' + (pending ? '<span class="featd-tag warn">未確認</span>' : '<span class="featd-tag ok">' + (r.status === 'dismissed' ? '却下' : '確認済み') + '</span>') + '</div>'
        + '<div class="insurance-help-text">' + esc(fmtAt(r.created_at)) + (who ? '　' + esc(who) : '') + '</div>'
        + (r.memo ? '<div class="featd-memo">' + esc(r.memo) + '</div>' : '<div class="insurance-help-text">（メモなし・写真のみ）</div>')
        + cand + (acts ? '<div class="featd-acts">' + acts + '</div>' : '') + '</div></div>';
    }));
    body.innerHTML = cards.join('') + '<div class="insurance-help-text">候補は、担当者が確認して追加したときだけカルテに入ります。確認したら「済」を押してください。</div>';
  }
  function mobileOpen() {
    const m = $('featd-mobile-modal'); if (!m) return;
    m.classList.remove('hidden'); renderMobile();
  }
  function mobileClose() { const m = $('featd-mobile-modal'); if (m) m.classList.add('hidden'); }
  const mobileById = (id) => mobileList.find((r) => String(r.id) === String(id));
  async function mobileAction(act, id, q) {
    const r = mobileById(id); if (!r) return;
    try {
      if (act === 'm-rx') {   // 基準版の処方入力を開き、薬剤検索欄に報告の行を入れる（選ぶのは担当者）
        mobileClose();
        if (typeof showPrescriptionDialog === 'function') showPrescriptionDialog();
        // 検索は薬の名前の部分（最初の語）で行う。行全体は用量・日数の確認用に一覧に残る
        const s = $('drug-search-input'); if (s) { s.value = String(q || '').trim().split(/[\s　]+/)[0]; s.dispatchEvent(new Event('input', { bubbles: true })); s.focus(); }
        return;
      }
      if (act === 'm-note') {
        if (typeof appendTextToKarteEditor !== 'function') { toast('本文に書き込めません', 'error'); return; }
        appendTextToKarteEditor('【' + (r.kind === 'rx' ? '処方（スマホ報告）' : '検査結果（スマホ報告）') + '】');
        memoLines(r.memo).forEach((l) => appendTextToKarteEditor(l));
        const ed = $('karte-editor'); if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
        toast('本文に追記しました（保存するまで確定しません）'); return;
      }
      if (act === 'm-ocr') { mobileClose(); await ocrFromDataUrl(await blobToDataUrl(await download(MOBILE_BUCKET, r.photo_path)), r.kind, 'スマホで届いた' + LABEL[r.kind]); return; }
      if (act === 'm-save') { await saveToPatientFiles(await download(MOBILE_BUCKET, r.photo_path), LABEL[r.kind] + '_スマホ_' + karteDate(), 'スマホから届いた' + LABEL[r.kind] + (r.memo ? '：' + r.memo : '')); toast('写真を患者のファイルに保存しました'); return; }
      if (act === 'm-apply') { if (await mobileSetStatus(id, 'applied')) { toast('確認済みにしました'); await renderMobile(); } return; }
      if (act === 'm-dismiss') { if (!confirm('この報告を却下しますか？（カルテには何も入りません）')) return; if (await mobileSetStatus(id, 'dismissed')) await renderMobile(); return; }
    } catch (e) { toast('処理できませんでした: ' + e.message, 'error'); }
  }

  // =====================================================================
  // 画面の部品からの呼び出し口・患者／日付の切り替えの追従
  // =====================================================================
  function onClick(ev) {
    const b = ev.target.closest('[data-featd]'); if (!b) return;
    const act = b.dataset.featd, which = b.dataset.which, i = Number(b.dataset.i);
    if (act === 'ocr-fill') ocrFill(which, false);
    else if (act === 'ocr-fill-qr') ocrFill(which, true);
    else if (act === 'ocr-switch') ocrSwitch(which);
    else if (act === 'ocr-close') resetBox(which);
    else if (act === 'doc-ocr') docOcr(i);
    else if (act === 'doc-save') docSave(i);
    else if (act === 'doc-approve') docApprove(i);
    else if (/^m-/.test(act)) mobileAction(act, b.dataset.id, b.dataset.q);
    else return;
    ev.preventDefault();
  }
  let lastKey = '';
  function follow() {
    const p = patient(); const key = (p ? p.id : '') + '|' + karteDate();
    if (key === lastKey) return; lastKey = key;
    resetBox('ins'); resetBox('pub');
    updateBadge(true);
    const vis = (id) => { const el = $(id); return el && el.style.display !== 'none'; };
    if (vis('insurance-content') || vis('file-content')) renderDocs();
  }
  function start() {
    document.addEventListener('click', onClick);
    watchModals();
    setInterval(follow, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  return { need, voiceToggle, voiceApply, readCard, ocrRun, ocrPickFile, ocrFill, ocrFromDataUrl, renderDocs, docOcr, docSave, docApprove,
    mobileOpen, mobileClose, renderMobile, updateBadge, mobileSetStatus, state: () => ({ ocr: ocrState, docItems, mobileList }) };
})();
