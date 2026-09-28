// ====================================================================
// 予約サイトから届いた保険証・医療証の画像（Wave 10・2026-09-18）
//   ・予約行 rsv2_reservations の insurance_card_path / iryo_card_path（Storage: rsv-documents）
//   ・名寄せ済みの患者には patients.rsv_docs にも同じ参照が入る（トリガー）
//   ・カルテ側でできること: 画像を見る／OCR で読み取る（既存の保険証・医療証 OCR に渡す）／
//     患者写真に保存する／確認済みの印を付ける。保険情報を自動で確定はしない
// ====================================================================
const RSV_DOC_BUCKET = 'rsv-documents';

function rsvDocsClient() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return null;
  return supabaseClient;
}

/** 現在の患者に届いている画像を予約行から集める（新しい順・最大5予約） */
async function loadRsvDocsForPatient(patientNo) {
  const c = rsvDocsClient();
  if (!c || !patientNo) return [];
  const { data, error } = await c.from('rsv2_reservations')
    .select('code, rdate, rtime, insurance_card_path, iryo_card_path, docs_uploaded_at, docs_review')
    .eq('karte_patient_no', patientNo)
    .not('docs_uploaded_at', 'is', null)
    .order('docs_uploaded_at', { ascending: false })
    .limit(5);
  if (error) { console.warn('[rsv_docs] 読み込み失敗:', error.message); return []; }
  const items = [];
  (data || []).forEach(function (r) {
    if (r.insurance_card_path) items.push({ kind: 'insurance', label: '保険証', path: r.insurance_card_path, code: r.code, rdate: r.rdate, at: r.docs_uploaded_at, review: r.docs_review });
    if (r.iryo_card_path) items.push({ kind: 'iryo', label: '医療証', path: r.iryo_card_path, code: r.code, rdate: r.rdate, at: r.docs_uploaded_at, review: r.docs_review });
  });
  return items;
}

async function rsvDocSignedUrl(path) {
  const c = rsvDocsClient();
  const { data, error } = await c.storage.from(RSV_DOC_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

async function rsvDocToDataUrl(path) {
  const c = rsvDocsClient();
  const { data, error } = await c.storage.from(RSV_DOC_BUCKET).download(path);
  if (error) throw error;
  return new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function (e) { resolve(e.target.result); };
    fr.onerror = reject;
    fr.readAsDataURL(data);
  });
}

function rsvDocsFmtAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 保険証モーダル内の「予約から届いた画像」欄を描く（openInsuranceModal から呼ぶ） */
async function renderRsvDocs() {
  const box = document.getElementById('rsvDocsPanel');
  if (!box) return;
  const p = (typeof patients !== 'undefined') ? patients.find(function (x) { return x.id === currentPatientId; }) : null;
  if (!p) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = '<div class="rsvdocs-head">予約サイトから届いた保険証・医療証 <span class="rsvdocs-muted">読み込み中…</span></div>';
  let items = [];
  try { items = await loadRsvDocsForPatient(p.id); } catch (e) { console.warn(e); }
  if (!items.length) {
    box.innerHTML = '<div class="rsvdocs-head">予約サイトから届いた保険証・医療証 <span class="rsvdocs-muted">なし</span></div>';
    return;
  }
  const cards = await Promise.all(items.map(async function (it, i) {
    let url = '';
    try { url = await rsvDocSignedUrl(it.path); } catch (e) { console.warn('[rsv_docs] 署名URL失敗', e.message); }
    const reviewed = it.review === 'approved';
    return '<div class="rsvdoc-card' + (reviewed ? ' reviewed' : '') + '" data-i="' + i + '">'
      + '<div class="rsvdoc-thumb">' + (url ? '<img src="' + url + '" alt="' + it.label + '">' : '<span class="rsvdocs-muted">画像を開けません</span>') + '</div>'
      + '<div class="rsvdoc-meta">'
      + '<div><b>' + it.label + '</b> <span class="rsvdocs-muted">予約 ' + (it.code || '') + '（' + (it.rdate || '') + '）</span></div>'
      + '<div class="rsvdocs-muted">受信 ' + rsvDocsFmtAt(it.at) + (reviewed ? '　<span class="rsvdoc-ok">確認済み</span>' : '　<span class="rsvdoc-new">未確認</span>') + '</div>'
      + '<div class="rsvdoc-btns">'
      + '<button class="btn btn-sm btn-primary" onclick="rsvDocOcr(' + i + ')">OCRで読み取る</button>'
      + '<button class="btn btn-sm btn-outline" onclick="rsvDocSaveToPhotos(' + i + ')">患者写真に保存</button>'
      + (reviewed ? '' : '<button class="btn btn-sm btn-outline" onclick="rsvDocApprove(' + i + ')">確認済みにする</button>')
      + (url ? '<a class="btn btn-sm btn-outline" href="' + url + '" target="_blank" rel="noopener">拡大</a>' : '')
      + '</div></div></div>';
  }));
  box.innerHTML = '<div class="rsvdocs-head">予約サイトから届いた保険証・医療証 <span class="rsvdocs-muted">' + items.length + '件</span></div>'
    + '<div class="rsvdoc-list">' + cards.join('') + '</div>'
    + '<div class="rsvdocs-muted" style="margin-top:4px;">※画像は参考です。読み取り結果は内容を確認してから反映してください（自動では確定しません）。</div>';
  box._items = items;
}

/** 既存の保険証/医療証 OCR に画像を渡す */
async function rsvDocOcr(i) {
  const box = document.getElementById('rsvDocsPanel');
  const it = box && box._items && box._items[i];
  if (!it) return;
  try {
    const dataUrl = await rsvDocToDataUrl(it.path);
    if (it.kind === 'iryo' && typeof processIryoOcrImage === 'function') {
      processIryoOcrImage(dataUrl);
      const wrap = document.getElementById('iryoOcrPreviewWrap'); if (wrap) wrap.scrollIntoView({ block: 'nearest' });
    } else if (typeof processInsuranceOcrImage === 'function') {
      processInsuranceOcrImage(dataUrl);
      const wrap = document.getElementById('insuranceOcrPreviewWrap'); if (wrap) wrap.scrollIntoView({ block: 'nearest' });
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('画像を取得できませんでした: ' + e.message, 'error'); else alert('画像を取得できませんでした: ' + e.message);
  }
}

/** 患者写真（patient-photos）へコピーして保存 */
async function rsvDocSaveToPhotos(i) {
  const box = document.getElementById('rsvDocsPanel');
  const it = box && box._items && box._items[i];
  const p = (typeof patients !== 'undefined') ? patients.find(function (x) { return x.id === currentPatientId; }) : null;
  if (!it || !p) return;
  if (typeof uploadPatientPhoto !== 'function') { alert('患者写真の機能が読み込まれていません'); return; }
  try {
    const c = rsvDocsClient();
    const { data, error } = await c.storage.from(RSV_DOC_BUCKET).download(it.path);
    if (error) throw error;
    const file = new File([data], (it.kind === 'iryo' ? 'iryo' : 'insurance') + '.jpg', { type: 'image/jpeg' });
    const type = (it.kind === 'iryo') ? '医療証' : '保険証';
    await uploadPatientPhoto(p.id, type, file);
    if (typeof renderPatientPhotos === 'function') renderPatientPhotos();
    if (typeof showToast === 'function') showToast(type + 'を患者写真に保存しました', 'success');
  } catch (e) {
    if (typeof showToast === 'function') showToast('保存できませんでした: ' + e.message, 'error'); else alert('保存できませんでした: ' + e.message);
  }
}

/** 確認済みの印（予約行 docs_review='approved'。トリガーで patients.rsv_docs にも反映） */
async function rsvDocApprove(i) {
  const box = document.getElementById('rsvDocsPanel');
  const it = box && box._items && box._items[i];
  if (!it) return;
  const c = rsvDocsClient();
  const { error } = await c.from('rsv2_reservations').update({ docs_review: 'approved' }).eq('code', it.code);
  if (error) { if (typeof showToast === 'function') showToast('更新できませんでした: ' + error.message, 'error'); return; }
  renderRsvDocs();
}

/** 受付一覧などで「証あり」を出すための軽い問い合わせ（患者番号の配列 → {patientNo: 件数}） */
async function rsvDocsCountByPatient(patientNos) {
  const c = rsvDocsClient();
  if (!c || !patientNos || !patientNos.length) return {};
  const { data, error } = await c.from('rsv2_reservations')
    .select('karte_patient_no, insurance_card_path, iryo_card_path, docs_review')
    .in('karte_patient_no', patientNos)
    .not('docs_uploaded_at', 'is', null);
  if (error) return {};
  const m = {};
  (data || []).forEach(function (r) {
    if (r.docs_review === 'approved') return;
    m[r.karte_patient_no] = (m[r.karte_patient_no] || 0) + (r.insurance_card_path ? 1 : 0) + (r.iryo_card_path ? 1 : 0);
  });
  return m;
}
