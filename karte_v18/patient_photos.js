/**
 * 患者写真（保険証・医療証・検査結果）の複数枚管理  — 要望#5
 * ---------------------------------------------------------------
 * 方針（ユーザー確定 2026-08-05）:
 *   ・1患者あたり1〜3枚を想定 → 上限3枚（PHOTO_MAX_PER_PATIENT）で頭打ちにする
 *   ・保存先は Supabase Storage（端末のlocalStorageは容量上限で破綻するため）
 *   ・容量を可視化して監視し、規定値を超えないようにする
 *
 * 設計上の要点:
 *   ・専用テーブルを作らない。ファイル名に「種別」と「日時」を埋め込み、
 *     バケットの patients/<患者番号>/ を list するだけで一覧を復元する。
 *     → DBスキーマ変更が不要で、患者マスタも汚さない。
 *   ・アップロード前に長辺1600pxのJPEG(品質0.8)へ縮小する。保険証の文字は十分読め、
 *     1枚あたり概ね200〜400KBに収まるため容量とEgressを抑えられる。
 *   ・バケット未作成／未ログインの場合は例外にせず「利用不可」を返し、
 *     従来の1枚保存（insurancePhoto）はそのまま使えるようにする。
 */

const PHOTO_BUCKET = 'patient-photos';
const PHOTO_TYPES = ['保険証', '医療証', '検査結果', 'その他'];
const PHOTO_MAX_PER_PATIENT = 3;      // ユーザー指定: 1〜3枚
const PHOTO_MAX_EDGE = 1600;          // 長辺(px)
const PHOTO_JPEG_QUALITY = 0.8;

// 容量の規定値（Supabase無料枠のストレージは1GB）。config.js で上書き可能。
function photoStorageLimitMB() {
  return (typeof window !== 'undefined' && window.__STORAGE_LIMIT_MB__) || 1024;
}
const PHOTO_WARN_RATIO = 0.7;   // 黄色
const PHOTO_DANGER_RATIO = 0.9; // 赤

function photoClient() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return null;
  return supabaseClient;
}

/**
 * バケットが使える状態か（未作成・未ログインなら false）
 * ※ list() は「存在しないバケット」でも空配列を返しエラーにならないため判定に使えない。
 *    getBucket() は未作成なら 404 (NoSuchBucket) を返すので、こちらで判定する。
 */
async function photoStorageReady() {
  const c = photoClient();
  if (!c) return { ok: false, reason: 'Supabase未接続' };
  try {
    const { error } = await c.storage.getBucket(PHOTO_BUCKET);
    if (error) {
      const msg = String(error.message || '');
      if (/not found|NoSuchBucket|404/i.test(msg)) {
        return { ok: false, reason: 'バケット「' + PHOTO_BUCKET + '」が未作成です' };
      }
      // 参照権限が無いだけの可能性があるので、実際の list で再確認する
      const probe = await c.storage.from(PHOTO_BUCKET).list('', { limit: 1 });
      if (probe.error) return { ok: false, reason: probe.error.message };
      return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || '不明なエラー' };
  }
}

/** 画像を長辺PHOTO_MAX_EDGEのJPEGに縮小して Blob で返す */
function shrinkImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像を解釈できませんでした'));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const long = Math.max(w, h);
        if (long > PHOTO_MAX_EDGE) {
          const r = PHOTO_MAX_EDGE / long;
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('画像の変換に失敗しました')), 'image/jpeg', PHOTO_JPEG_QUALITY);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ★Supabase Storage は日本語などの非ASCIIキーを InvalidKey で拒否する。
//   そのため種別はASCIIコードでファイル名に埋め込み、表示時に日本語へ戻す。
const PHOTO_TYPE_CODE = { '保険証': 'hokensho', '医療証': 'iryosho', '検査結果': 'kensa', 'その他': 'other' };
const PHOTO_CODE_TYPE = { hokensho: '保険証', iryosho: '医療証', kensa: '検査結果', other: 'その他' };

function asciiSafe(s) { return String(s || '').replace(/[^A-Za-z0-9._-]/g, '_'); }
function photoPrefix(patientNo) { return 'patients/' + asciiSafe(patientNo); }

/** ファイル名: <種別コード>__<YYYYMMDDHHmmss>.jpg */
function buildPhotoName(type) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  return (PHOTO_TYPE_CODE[type] || 'other') + '__' + stamp + '.jpg';
}
function parsePhotoName(name) {
  const m = String(name).match(/^(.+?)__(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.jpg$/);
  if (!m) return { type: 'その他', dateLabel: '' };
  return { type: PHOTO_CODE_TYPE[m[1]] || m[1], dateLabel: m[2] + '/' + m[3] + '/' + m[4] + ' ' + m[5] + ':' + m[6] };
}

/** 患者の写真一覧（署名URL付き） */
async function listPatientPhotos(patientNo) {
  const c = photoClient();
  if (!c) return [];
  const { data, error } = await c.storage.from(PHOTO_BUCKET).list(photoPrefix(patientNo), { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (error || !data) return [];
  const files = data.filter(f => f.id);   // フォルダを除外
  const out = [];
  for (const f of files) {
    const path = photoPrefix(patientNo) + '/' + f.name;
    const meta = parsePhotoName(f.name);
    let url = '';
    try {
      const signed = await c.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
      url = (signed && signed.data && signed.data.signedUrl) || '';
    } catch (e) {}
    out.push({
      path: path, name: f.name, url: url, type: meta.type, dateLabel: meta.dateLabel,
      size: (f.metadata && f.metadata.size) || 0
    });
  }
  return out;
}

/** アップロード（上限チェック込み） */
async function uploadPatientPhoto(patientNo, type, file) {
  const c = photoClient();
  if (!c) return { success: false, error: 'Supabase未接続' };
  const existing = await listPatientPhotos(patientNo);
  if (existing.length >= PHOTO_MAX_PER_PATIENT) {
    return { success: false, error: '写真は1人あたり' + PHOTO_MAX_PER_PATIENT + '枚までです。不要な写真を削除してから追加してください。' };
  }
  let blob;
  try { blob = await shrinkImageFile(file); } catch (e) { return { success: false, error: e.message }; }

  const path = photoPrefix(patientNo) + '/' + buildPhotoName(type);
  const { error } = await c.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) return { success: false, error: error.message };
  return { success: true, path: path, size: blob.size };
}

async function deletePatientPhoto(path) {
  const c = photoClient();
  if (!c) return { success: false, error: 'Supabase未接続' };
  const { error } = await c.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * バケット全体の使用量を集計する（容量の可視化・監視）
 * patients/<患者番号>/ の2階層だけを辿る。件数が増えたときのために患者数の上限も設ける。
 */
async function getPhotoStorageUsage(maxPatients) {
  const c = photoClient();
  if (!c) return { ok: false, reason: 'Supabase未接続' };
  maxPatients = maxPatients || 500;
  try {
    const { data: dirs, error } = await c.storage.from(PHOTO_BUCKET).list('patients', { limit: maxPatients });
    if (error) return { ok: false, reason: error.message };
    let bytes = 0, files = 0, patientsCount = 0, truncated = false;
    for (const d of (dirs || [])) {
      if (d.id) continue;                 // ファイルは想定しない（フォルダのみ）
      patientsCount++;
      const { data: fs } = await c.storage.from(PHOTO_BUCKET).list('patients/' + d.name, { limit: 100 });
      (fs || []).forEach(f => { if (f.id) { files++; bytes += (f.metadata && f.metadata.size) || 0; } });
    }
    if ((dirs || []).length >= maxPatients) truncated = true;
    const limitBytes = photoStorageLimitMB() * 1024 * 1024;
    return {
      ok: true, bytes: bytes, files: files, patients: patientsCount, truncated: truncated,
      limitBytes: limitBytes, ratio: limitBytes ? bytes / limitBytes : 0
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function formatBytes(b) {
  if (!b) return '0 MB';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/* ===================== UI（保険証モーダル内） ===================== */

async function renderPatientPhotos() {
  const grid = document.getElementById('patientPhotoGrid');
  const banner = document.getElementById('photoStorageBanner');
  const info = document.getElementById('photoCountInfo');
  if (!grid) return;

  const ready = await photoStorageReady();
  if (!ready.ok) {
    // 使えない場合も操作不能にはせず、理由と対処を出す（従来の1枚保存は引き続き使える）
    banner.innerHTML = '<div class="photo-warn">サーバー保存が利用できません（' + esc(ready.reason) + '）<br>' +
      '<span style="font-weight:400;">バケット「' + PHOTO_BUCKET + '」の作成とログインが必要です。上の従来の写真欄は引き続き使えます。</span></div>';
    grid.innerHTML = '';
    if (info) info.textContent = '';
    const meter = document.getElementById('photoUsageMeter');
    if (meter) meter.innerHTML = '';
    return;
  }
  banner.innerHTML = '';

  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  const list = await listPatientPhotos(p.id);
  grid.innerHTML = list.map(ph =>
    '<div class="photo-card">' +
      (ph.url ? '<img src="' + esc(ph.url) + '" alt="' + esc(ph.type) + '">' : '<div class="photo-noimg">表示できません</div>') +
      '<div class="photo-cap">' + esc(ph.type) + ' / ' + esc(ph.dateLabel) + '</div>' +
      '<button class="photo-del" title="削除" onclick="onDeletePatientPhoto(\'' + esc(ph.path).replace(/'/g, "\'") + '\')">&times;</button>' +
    '</div>'
  ).join('') || '<div class="photo-empty">まだ写真はありません</div>';

  if (info) info.textContent = list.length + ' / ' + PHOTO_MAX_PER_PATIENT + ' 枚';
  renderPhotoUsage();
}

async function onAddPatientPhoto(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  const type = (document.getElementById('photoTypeSelect') || {}).value || 'その他';
  showToast('写真をアップロード中...');
  const r = await uploadPatientPhoto(p.id, type, file);
  if (!r.success) { alert('アップロードできませんでした:\n' + r.error); return; }
  showToast('写真を追加しました（' + formatBytes(r.size) + '）');
  renderPatientPhotos();
}

async function onDeletePatientPhoto(path) {
  if (!confirm('この写真を削除しますか？')) return;
  const r = await deletePatientPhoto(path);
  if (!r.success) { alert('削除できませんでした:\n' + r.error); return; }
  showToast('写真を削除しました');
  renderPatientPhotos();
}

/** 容量メーター（規定値に対する使用率を可視化） */
async function renderPhotoUsage() {
  const el = document.getElementById('photoUsageMeter');
  if (!el) return;
  el.innerHTML = '<span class="photo-usage-loading">容量を確認中...</span>';
  const u = await getPhotoStorageUsage();
  if (!u.ok) { el.innerHTML = ''; return; }
  const pct = Math.min(100, Math.round(u.ratio * 1000) / 10);
  const level = u.ratio >= PHOTO_DANGER_RATIO ? 'danger' : (u.ratio >= PHOTO_WARN_RATIO ? 'warn' : 'ok');
  el.innerHTML =
    '<div class="photo-usage">' +
      '<div class="photo-usage-head">' +
        '<span>写真の保存容量</span>' +
        '<span class="photo-usage-num ' + level + '">' + formatBytes(u.bytes) + ' / ' + photoStorageLimitMB() + ' MB（' + pct + '%）</span>' +
      '</div>' +
      '<div class="photo-usage-bar"><div class="photo-usage-fill ' + level + '" style="width:' + pct + '%"></div></div>' +
      '<div class="photo-usage-sub">' + u.files + '枚 / ' + u.patients + '名' + (u.truncated ? '（一部のみ集計）' : '') +
        (level === 'danger' ? ' ／ <b style="color:var(--danger)">規定値に近づいています。不要な写真を整理してください。</b>'
         : level === 'warn' ? ' ／ <b style="color:#b45309">使用量が増えています。</b>' : '') +
      '</div>' +
    '</div>';
}
