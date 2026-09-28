// ===== 置き換え層：2026-09-25 受領の新しい版の基準版の画面に、統合版の独自機能を載せ直す（compat_features_0925.js） =====
// 新しい版で画面の構造が変わり、統合版の機能の一部が載らなくなった分だけをここで補う。基準版のファイルは変えない。
//   ① スマホ版のアイコン（カルテ画面の見出し）
//        前の版はカルテ画面の見出しの右に .header-icons（更新・ノート・検索…のアイコン列）があり、compat_rsv_mirror.js はそこへ足していた。
//        新しい版はこの列が無くなり、見出しの右はユーザーのメニューだけになった。同じ見た目の列（.header-icons）を作ってメニューの左に置く
//   ② 基準版の音声カルテ（本文の上の「録音・停止・フォルダ」）→ 統合版の音声カルテ（whisper_client.js と同じ呼び先）
//        新しい版の基準版は /voice-karte/status・/voice-karte/jobs・/voice-karte/jobs/:id を問い合わせ、
//        音声は jobs の応答にある upload_url へ PUT で送る（基準版は自前のサーバー経由で音声処理サービスへ送る作り）。
//        統合版にはそのサーバーが無いので、この 3 つと音声の PUT をここで受け、統合版の音声カルテの API（WHISPER_API の
//        /transcribe → /generate-karte。compat_features_d.js の「音声カルテ」ボタンと同じ呼び先）で文字起こし・カルテ生成して、
//        基準版の画面本体の処理（完了の応答を受けて本文へ追記）にそのまま返す。
//        つなげない部分: 処理の控えは画面の中だけ（ページを読み直すと処理中の分は失われる）。記録 ID への紐付け・サーバー側の保管はしない。
(function () {
  'use strict';
  const C = window.__compat; if (!C) return;
  const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'info'); };

  // =====================================================================
  // ① スマホ版のアイコン（カルテ画面の見出し）
  // =====================================================================
  function addMainMobileIcon() {
    if (document.getElementById('btn-open-mobile-main')) return true;
    const right = document.querySelector('#main-screen .header-right'); if (!right) return false;
    let icons = right.querySelector('.header-icons');
    if (!icons) {
      icons = document.createElement('div'); icons.className = 'header-icons';
      right.insertBefore(icons, document.getElementById('user-dropdown-main') || right.firstChild);
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.id = 'btn-open-mobile-main';
    b.title = 'DigiMaster Mobile（診察中の医療補助が保険証・処方・検査結果を送る）';   // 受付画面のアイコン（compat_rsv_mirror.js）と同じ
    b.innerHTML = '<i class="fas fa-mobile-alt"></i>';
    b.addEventListener('click', () => window.open('../mobile.html' + location.search, '_blank', 'noopener'));
    icons.insertBefore(b, icons.firstChild);
    return true;
  }

  // =====================================================================
  // ② 基準版の音声カルテ → 統合版の音声カルテ
  // =====================================================================
  const UPLOAD_LIMIT = 4 * 1024 * 1024;   // 統合版と同じ: これを超える音声は 2 分ごとに分けて送る（whisper_client.js）
  const jobs = new Map();
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'vk-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  async function loadWhisper() {
    if (!window.CompatFeatD || typeof window.CompatFeatD.need !== 'function') throw new Error('音声カルテの部品（compat_features_d.js）が読み込まれていません');
    await window.CompatFeatD.need('whisper');
    if (typeof WHISPER_API === 'undefined') throw new Error('音声カルテの呼び先を読み込めません');   // eslint-disable-line no-undef
    return WHISPER_API;   // eslint-disable-line no-undef
  }
  async function errText(res) {
    try { const j = await res.json(); return j.error || j.detail || j.message || ('HTTP ' + res.status); } catch (e) { return 'HTTP ' + res.status; }
  }
  async function transcribe(api, file) {
    const prompt = typeof whisperGetInitialPrompt === 'function' ? whisperGetInitialPrompt() : '';
    if (file.size <= UPLOAD_LIMIT) {
      const fd = new FormData(); fd.append('audio', file, file.name || 'recording.webm'); if (prompt) fd.append('initial_prompt', prompt);
      const res = await fetch(api + '/transcribe', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('文字起こしエラー: ' + await errText(res));
      return String((await res.json()).transcript || '');
    }
    // 大きい音声: 統合版と同じくデコード → 2 分ごと（1 秒重ね）に分けて送る
    /* eslint-disable no-undef */
    const buf = await whisperDecodeAudio(file);
    const n = Math.ceil(buf.duration / CHUNK_DURATION_SEC);
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => {
      const start = Math.max(0, i * CHUNK_DURATION_SEC - (i > 0 ? CHUNK_OVERLAP_SEC : 0)), end = Math.min(buf.duration, (i + 1) * CHUNK_DURATION_SEC);
      return whisperTranscribeChunk(audioBufferSliceToWav(buf, start, end), 'chunk_' + i + '.wav', prompt).catch(() => '');
    }));
    /* eslint-enable no-undef */
    return parts.filter(Boolean).join('\n');
  }
  async function generate(api, transcript) {
    const res = await fetch(api + '/generate-karte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, template: 'karte' }) });
    if (!res.ok) throw new Error('カルテ生成エラー: ' + await errText(res));
    return String((await res.json()).karte || '');
  }
  // 電話問診（compat_phone_intake.js）からも同じ文字起こしを使う
  window.__compat.voiceTranscribe = { loadWhisper, transcribe };
  async function runJob(job) {
    job.status = 'processing';
    try {
      const api = await loadWhisper();
      const tr = (await transcribe(api, job.file)).trim();
      if (!tr) throw new Error('文字起こしの結果が空でした');
      job.transcript = tr;
      let karte = '';
      try { karte = (await generate(api, tr)).trim(); } catch (e) { job.warning = e.message; }
      // カルテ生成に失敗したときは文字起こしを本文へ（統合版の「文字起こしを本文へ」と同じ扱い）
      job.karte_text = karte || ('【音声（文字起こし）】\n' + tr);
      // 統合版の音声カルテの欄（開いていれば）にも同じ内容を出し、履歴にも残す
      const t = document.getElementById('whisperTranscript'), k = document.getElementById('whisperKarte');
      if (t) t.value = tr; if (k && karte) k.value = karte;
      if (karte && typeof whisperSaveHistory === 'function') { try { whisperSaveHistory(tr, karte, 'karte'); } catch (e) { /* 履歴だけ */ } }   // eslint-disable-line no-undef
      if (job.warning) toast(job.warning + '（文字起こしをそのまま本文へ入れます）', 'error');
      job.status = 'completed';
    } catch (e) {
      job.status = 'failed'; job.error_message = String(e && e.message || e);
    } finally { job.file = null; }
  }
  const view = (j) => ({ id: j.id, status: j.status, karte_text: j.status === 'completed' ? j.karte_text : null, transcript: j.transcript || null, error_message: j.error_message || null, created_at: j.created_at });
  const STATUS_RE = /\/api\/v1\/voice-karte\/status(?:[?#]|$)/, JOBS_RE = /\/api\/v1\/voice-karte\/jobs(?:[?#]|$)/,
    JOB_RE = /\/api\/v1\/voice-karte\/jobs\/([^/?#]+)(?:[?#]|$)/, UPLOAD_RE = /\/api\/v1\/voice-karte\/jobs\/([^/?#]+)\/upload(?:[?#]|$)/;
  // 置き換え層の横取り（compat_api.js）は本文を JSON として読むので、音声（File）を受けるためにその外側で受ける
  const inner = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/v1/voice-karte/') < 0) return inner.apply(this, arguments);
    const method = String((init && init.method) || 'GET').toUpperCase();
    let m;
    if (method === 'GET' && STATUS_RE.test(url)) {
      const ok = !!(window.CompatFeatD && typeof window.CompatFeatD.need === 'function');
      return reply(200, { ready: ok, message: ok ? '待機中' : '音声カルテの部品が読み込まれていません', max_upload_mb: 100, provider: 'whisper' });
    }
    if (method === 'POST' && JOBS_RE.test(url)) {
      let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) { body = {}; }
      if (!body.patient_id) return reply(400, { detail: '患者を選択してください' });
      const id = newId();
      jobs.set(id, { id, status: 'uploading', patient_id: String(body.patient_id), filename: body.filename || 'recording.webm', created_at: new Date().toISOString() });
      // 画面本体は送信前に「外部へ暗号化送信しています」と出すので、実際の送り先（統合版の音声カルテ）に書き換える
      setTimeout(() => { if (typeof setVoiceKarteStatus === 'function') setVoiceKarteStatus('統合版の音声カルテ（文字起こし・カルテ生成）へ送っています…', 'working'); }, 0);
      return reply(200, { id, status: 'uploading', upload_url: '/api/v1/voice-karte/jobs/' + id + '/upload', upload_token: 'local' });
    }
    if (method === 'PUT' && (m = url.match(UPLOAD_RE))) {
      const job = jobs.get(decodeURIComponent(m[1])); if (!job) return reply(404, { detail: '音声の処理が見つかりません' });
      const file = init && init.body;
      if (!(file instanceof Blob) || !file.size) return reply(400, { detail: '音声が空です' });
      job.file = file instanceof File ? file : new File([file], job.filename, { type: file.type || 'audio/webm' });
      job.status = 'queued';
      runJob(job);   // 終わるまで待たない（画面本体は jobs/:id を 3 秒ごとに問い合わせる）
      return reply(200, { id: job.id, status: 'queued' });
    }
    if (method === 'GET' && (m = url.match(JOB_RE))) {
      const job = jobs.get(decodeURIComponent(m[1]));
      return job ? reply(200, view(job)) : reply(404, { detail: '音声の処理が見つかりません（ページを読み直すと処理中の分は失われます）' });
    }
    return reply(501, { detail: 'この音声カルテの操作は統合版にはつながっていません' });
  };
  C.features0925 = { jobs, addMainMobileIcon };

  function boot() {
    addMainMobileIcon();
    // 画面本体は起動 1.5 秒後に 1 回だけ使えるか問い合わせる。部品の読み込みが遅れたときのため、カルテを開いたときにも問い合わせ直す
    const orig = window.openPatientKarte;
    if (typeof orig === 'function' && !orig.__f0925) {
      const wrapped = async function () {
        const r = await orig.apply(this, arguments);
        try { if (typeof refreshVoiceKarteAvailability === 'function' && typeof voiceKarteState !== 'undefined' && !voiceKarteState.serviceReady) refreshVoiceKarteAvailability(); } catch (e) { /* 表示だけ */ }   // eslint-disable-line no-undef
        return r;
      };
      wrapped.__f0925 = true; wrapped.__mirror = !!orig.__mirror;   // 夜間外来DBの包み（compat_rsv_mirror.js）が二重に包まないように印を引き継ぐ
      window.openPatientKarte = wrapped;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

// ---- 右上のユーザーメニューに「予約サイト（DigiLeave）」（2026-09-28）----
//   患者向け予約サイトを別タブで開く。「予約管理」の下に置く（受付画面・カルテ画面の両方のメニュー）。
//   テスト用クリニックで開いているときは、予約サイトもテスト院の表示（?clinic=test）で開く
(function () {
  const SITE = 'https://soumu-hdg.github.io/drive-through-pharmacy/reservation_v3/index.html';
  function url() {
    const id = (typeof currentClinicId === 'function') ? currentClinicId() : '';
    return SITE + (/^test/.test(id || '') ? '?clinic=' + encodeURIComponent(id) : '');
  }
  function add(anchorId, newId, menuId) {
    const anchor = document.getElementById(anchorId);
    if (!anchor || document.getElementById(newId)) return;
    const a = document.createElement('a');
    a.href = '#'; a.className = 'dropdown-item'; a.id = newId; a.style.whiteSpace = 'nowrap';
    a.title = '患者向けの予約サイトを別のタブで開きます';
    a.innerHTML = '<i class="fas fa-globe"></i> 予約サイト（DigiLeave）';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(menuId)?.classList.remove('open');
      document.getElementById(menuId.replace(/-menu$/, ''))?.classList.remove('open');
      window.open(url(), '_blank', 'noopener');
    });
    anchor.insertAdjacentElement('afterend', a);
  }
  function boot() {
    add('menu-reservation-admin', 'menu-reservation-site', 'user-dropdown');
    add('menu-reservation-admin-main', 'menu-reservation-site-main', 'user-dropdown-main');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
