// ===== 置き換え層：日常業務の書き込み（2026-09-25） compat_writes_daily.js =====
// 基準版の画面（api.js）が出す書き込みのうち、置き換え層でまだ 501（保存されていません）になっていたものを統合版の DB につなぐ。
//   ① 処方: Do 処方（前回の処方を今回へ）・処方の削除・処方の更新
//        記録の処方（kartes.base_record.prescriptions）を書き換え、処方の表への写しと院内の薬剤料（行為一覧の「薬剤料（院内）」）を
//        カルテ保存（/records/save）と同じ処理で作り直す（compat_records.js の writeRecord・internalDrugFees）
//   ② 診療行為: 追加・削除・一覧（/record-actions）。記録の行為一覧（base_record.billings）に足す・消す。
//        削除は基準版と同じく論理削除（一覧から外し、base_record.cancelled_actions に取消の記録を残す）
//   ③ 会計: 記録からの会計の計算・作成（/records/:id/billing[/calculate]）・会計の更新（PUT /billings/:id）
//        計算と保存は compat_billing.js と同じ（C.billing）。入金がある会計は算定を変えさせない
//   ④ 領収書・明細書の発行（/billings/:id/receipt・/statement）: 会計に発行記録（base_record.billing.issued_documents）を残し、
//        基準版の帳票（診療費請求書兼領収書・診療明細書。基準版の画面 renderer.js の印刷用 HTML）と同じ項目・並びの PDF を返す。
//        PDF は点検用様式と同じ部品（../rezept_form_pdf.js・IPAゴシック埋め込み）で作る
//   ⑤ 算定チェック（/calculations/check/actions・/prescription・/dosage）: 基準版と同じ応答の形。判定は「指摘なし」
//        （基準版の判定は施設の算定ルール表を使う。統合版の算定チェックはレセプトの読み戻し点検側で動いている）
//   ⑥ レセプトの請求の扱い（/receipt-claims/billings/:id/claim-status）と返戻明細の対応状態（/receipt-claims/returns/items/:id/status）:
//        院ごとの台帳（karte_clinic_store）に置き、レセプト作成（compat_receipt.js）が請求に含めない会計を UKE から外す
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, ready, clinicId } = C;
  const R = () => C.records, B = () => C.billing, Calc = () => window.__compatBillingCalc;
  const nowIso = () => new Date().toISOString();
  const pad2 = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const uid = () => crypto.randomUUID();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const userId = () => (C.state && C.state.user && C.state.user.id) || (window.__compat.state && window.__compat.state.user && window.__compat.state.user.id) || null;
  const noContent = () => new Response(null, { status: 204 });

  // ---- 記録（来院）の読み込みと、基準版の形の本体 ----
  async function recordVisit(id) {
    if (!C.records) throw new Error('置き換え層の読み込み順が正しくありません（compat_records.js）');
    const v = await R().visitById(id); if (!v) return null;
    const k = one(v.kartes); const base = (k && k.base_record) || R().synth(v, k);
    if (base.is_deleted) return null;
    return { v, k, base };
  }
  // 入金がある会計の記録は算定を変えさせない（カルテ保存と同じ）
  const paidLocked = (base) => { const st = base && base.billing; return !!(st && st.is_active !== false && st.status !== 'cancelled' && Number(st.paid_amount) > 0); };
  // ID の無い行には、画面が持っている ID（来院ID-rx番号・来院ID-bl番号）をそのまま付けて固定する（以後の削除で行がずれないように）
  const frozen = (list, vid, tag) => (list || []).map((x, i) => (x && x.id ? x : Object.assign({ id: vid + '-' + tag + i }, x)));
  const findById = (list, id) => list.map((x, i) => [x, i]).filter(([x]) => String(x.id) === String(id));
  // 処方を書き換え、院内の薬剤料を作り直して保存する（/records/save と同じ）
  async function writePrescriptions(rec, list, extraPatch) {
    let fees;
    try { fees = await R().internalDrugFees(list, rec.v.visit_date); } catch (e) { return err(400, e.message); }
    const billings = frozen(rec.base.billings, rec.v.id, 'bl').filter((b) => !(b.item_type === 'drug' && String(b.billing_name || '').startsWith('薬剤料（院内）'))).concat(fees.fees);
    await R().writeRecord(rec.v, Object.assign({ prescriptions: fees.prescriptions, billings }, extraPatch || {}), { rx: true, billing: true });
    return null;
  }

  // ================================================================
  // ① 処方
  // ================================================================
  // 統合版の処方の表の行 → 基準版の処方の形（compat_records.js の synth と同じ）
  const rxFromTable = (r) => ({ drug_code: r.drug_code, drug_name: r.drug_name, dosage: r.quantity != null ? String(r.quantity) : null, unit: r.unit, days: r.days, total_quantity: r.quantity, instructions: r.note });
  // 処方の ID から元の処方を探す（その院の来院だけ）。ID は 来院ID-rx番号（基準版の画面で保存した記録）／処方の表の ID ／記録に残した ID
  async function findPrescription(src) {
    const c = await ready(); src = String(src || '');
    const mm = src.match(/^([0-9a-f-]{36})-rx(\d+)$/i);
    if (mm) {
      const rec = await recordVisit(mm[1]); if (!rec) return null;
      const list = frozen(rec.base.prescriptions, rec.v.id, 'rx'); const hit = findById(list, src);
      return hit.length ? { rec, rx: hit[0][0] } : null;
    }
    if (!UUID.test(src)) return null;
    const { data: row } = await c.from('prescriptions').select('*,visits!inner(clinic_id)').eq('id', src).eq('visits.clinic_id', clinicId()).maybeSingle();
    if (row) { const rec = await recordVisit(row.visit_id); if (!rec) return null; const hit = findById(frozen(rec.base.prescriptions, rec.v.id, 'rx'), src); return { rec, rx: hit.length ? hit[0][0] : Object.assign({ id: row.id }, rxFromTable(row)) }; }
    const { data: ks } = await c.from('kartes').select('visit_id,visits!inner(clinic_id)').eq('visits.clinic_id', clinicId()).contains('base_record', { prescriptions: [{ id: src }] }).limit(1);
    if (ks && ks[0]) { const rec = await recordVisit(ks[0].visit_id); if (!rec) return null; const hit = findById(frozen(rec.base.prescriptions, rec.v.id, 'rx'), src); return hit.length ? { rec, rx: hit[0][0] } : null; }
    return null;
  }
  // Do 処方: 元の処方を複製して今回の記録へ足す（基準版 do_prescription と同じく元の内容をそのまま写し、処方日は今回の診療日）
  on('POST', /^\/records\/([0-9a-f-]{36})\/prescriptions\/do$/, async (m, q, body) => {
    const src = String((body && body.source_prescription_id) || '').trim();
    if (!src) return err(422, 'コピー元の処方（source_prescription_id）を指定してください');
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため処方を追加できません');
    const found = await findPrescription(src); if (!found) return err(404, '処方箋が見つかりません');
    if (found.rec.v.patient_id !== rec.v.patient_id) return err(400, '別の患者の処方は Do できません');
    const copy = Object.assign({}, found.rx);
    ['id', 'record_id', 'visit_date', 'created_at', 'updated_at', 'prescription_date', 'unit_price', 'drug_price', 'total_price'].forEach((k) => delete copy[k]);
    copy.id = uid(); copy.do_source_id = src;
    const list = frozen(rec.base.prescriptions, rec.v.id, 'rx').concat([copy]);
    const bad = await writePrescriptions(rec, list); if (bad) return bad;
    return { id: copy.id, message: '処方を追加しました' };
  });
  // 処方の削除（基準版の処方の取消と同じく、取消の記録を残す。理由は任意）
  on('DELETE', /^\/records\/([0-9a-f-]{36})\/prescriptions\/([^/]+)$/, async (m, q) => {
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    const id = decodeURIComponent(m[2]); const list = frozen(rec.base.prescriptions, rec.v.id, 'rx'); const hit = findById(list, id);
    if (!hit.length) return err(404, '処方箋が見つかりません');
    if (hit.length > 1) return err(409, '同じ ID の処方が複数あります。カルテを開き直してから操作してください');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため処方を削除できません');
    const [rx, i] = hit[0]; const next = list.filter((x, j) => j !== i);
    const cancelled = (rec.base.cancelled_prescriptions || []).concat([Object.assign({}, rx, { status: 'cancelled', cancelled_at: nowIso(), cancel_reason: q.get('reason') || null, cancelled_by: userId() })]);
    const bad = await writePrescriptions(rec, next, { cancelled_prescriptions: cancelled }); if (bad) return bad;
    return noContent();
  });
  // 処方の更新（用量・日数・用法などを差し替える。ID は変えない）
  on('PUT', /^\/records\/([0-9a-f-]{36})\/prescriptions\/([^/]+)$/, async (m, q, body) => {
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    const id = decodeURIComponent(m[2]); const list = frozen(rec.base.prescriptions, rec.v.id, 'rx'); const hit = findById(list, id);
    if (!hit.length) return err(404, '処方箋が見つかりません');
    if (hit.length > 1) return err(409, '同じ ID の処方が複数あります。カルテを開き直してから操作してください');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため処方を変更できません');
    const patch = Object.assign({}, body || {}); delete patch.id;
    if (patch.drug_name !== undefined && !String(patch.drug_name || '').trim()) return err(422, '薬剤名を入力してください');
    const next = list.slice(); next[hit[0][1]] = Object.assign({}, hit[0][0], patch, { id: hit[0][0].id, updated_at: nowIso() });
    const bad = await writePrescriptions(rec, next); if (bad) return bad;
    return { id: hit[0][0].id, message: '処方を更新しました' };
  });

  // ================================================================
  // ② 診療行為（/record-actions）
  // ================================================================
  const isActionRow = (b) => !(b.item_type === 'drug' || b.item_type === 'self_pay' || b.item_type === 'material' || b.is_self_pay || String(b.billing_code || '').startsWith('SELF_'));
  function actionOut(rec, b, i) {
    const qty = Number(b.quantity || 1) || 1, unit = toInt(b.points);
    return { id: b.id || rec.v.id + '-bl' + i, record_id: rec.v.id, action_date: b.action_date || rec.v.visit_date, action_code: String(b.billing_code || ''), action_name: b.billing_name || '',
      unit_score: unit, quantity: qty, score: Math.trunc(unit * qty), category_code: b.category_code ?? null, category_name: b.category ?? null,
      modifier_codes: b.modifier_codes ?? null, comment_codes: b.comment_codes ?? null, free_comment: b.free_comment ?? null, body_part: b.body_part ?? null,
      left_right: b.left_right ?? null, time_category: b.time_category || 'normal', status: b.status || 'performed', created_at: b.created_at || (rec.k && rec.k.created_at) || rec.v.created_at };
  }
  // 基準版 _resolve_record_action_values と同じく、行為コードが点数マスターにあれば名称・点数はマスターの値
  async function resolveAction(code, name, unitScore, catName) {
    const all = (await C.masterJson('s_procedures')) || {}; const e = all[code];
    if (!e) return { code, name, unit: unitScore, cat: catName };
    const pts = parseFloat(e.pts);
    return { code, name: C.cp932Name(e.name), unit: Number.isFinite(pts) ? Math.trunc(pts) : unitScore, cat: catName };
  }
  on('POST', /^\/record-actions$/, async (m, q, body) => {
    body = body || {};
    const code = String(body.action_code || '').trim(), unitScore = Number(body.unit_score);
    if (!UUID.test(String(body.record_id || '')) || !UUID.test(String(body.patient_id || ''))) return err(422, 'カルテと患者を指定してください');
    if (!body.action_date || !/^\d{4}-\d{2}-\d{2}/.test(String(body.action_date))) return err(422, '実施日を指定してください');
    if (!code || code.length > 9) return err(422, '行為コードは1〜9桁で指定してください');
    if (typeof body.action_name !== 'string') return err(422, '行為名を指定してください');
    if (!Number.isFinite(unitScore) || Math.trunc(unitScore) !== unitScore) return err(422, '点数は整数で指定してください');
    const rec = await recordVisit(body.record_id); if (!rec) return err(404, 'カルテが見つかりません');
    if (rec.v.patient_id !== body.patient_id) return err(400, '患者とカルテが一致しません');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため算定を追加できません');
    const r = await resolveAction(code, body.action_name, unitScore, body.category_name ?? null);
    const qty = Number(body.quantity) || 1; const list = frozen(rec.base.billings, rec.v.id, 'bl');
    const row = { id: uid(), billing_code: r.code, billing_name: r.name, points: r.unit, quantity: qty, category: r.cat, category_code: body.category_code ?? null, item_type: 'action',
      amount: 0, unit_price: 0, is_self_pay: false, comment_codes: body.comment_codes || [], comments: [], free_comment: body.free_comment ?? null, receipt_position: 'summary', do_not_bill: false,
      modifier_codes: body.modifier_codes ?? null, body_part: body.body_part ?? null, left_right: body.left_right ?? null, time_category: body.time_category || 'normal',
      action_date: String(body.action_date).slice(0, 10), status: 'performed', created_at: nowIso(), sort_order: list.length, procedure_order: list.length };
    await R().writeRecord(rec.v, { billings: list.concat([row]) }, { billing: true });
    return actionOut(rec, row, list.length);
  });
  on('GET', /^\/record-actions\/record\/([0-9a-f-]{36})$/, async (m) => {
    const rec = await recordVisit(m[1]); if (!rec) return [];
    return (rec.base.billings || []).map((b, i) => [b, i]).filter(([b]) => isActionRow(b) && b.status !== 'cancelled').map(([b, i]) => actionOut(rec, b, i));
  });
  on('DELETE', /^\/record-actions\/((?!sets$)[^/]+)$/, async (m) => {
    const id = decodeURIComponent(m[1]); let rec = null;
    const mm = id.match(/^([0-9a-f-]{36})-bl(\d+)$/i);
    if (mm) rec = await recordVisit(mm[1]);
    else if (UUID.test(id)) {
      const c = await ready();
      const { data: ks } = await c.from('kartes').select('visit_id,visits!inner(clinic_id)').eq('visits.clinic_id', clinicId()).contains('base_record', { billings: [{ id }] }).limit(1);
      if (ks && ks[0]) rec = await recordVisit(ks[0].visit_id);
    }
    if (!rec) return err(404, '診療行為が見つかりません');
    const list = frozen(rec.base.billings, rec.v.id, 'bl'); const hit = findById(list, id).filter(([b]) => isActionRow(b));
    if (!hit.length) return err(404, '診療行為が見つかりません');
    if (hit.length > 1) return err(409, '同じ ID の行為が複数あります。カルテを開き直してから操作してください');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため算定を変更できません');
    const [row, i] = hit[0];
    const cancelled = (rec.base.cancelled_actions || []).concat([Object.assign({}, row, { status: 'cancelled', is_active: false, cancelled_at: nowIso(), cancelled_by: userId() })]);
    await R().writeRecord(rec.v, { billings: list.filter((x, j) => j !== i), cancelled_actions: cancelled }, { billing: true });
    return { message: '削除しました', id };
  });

  // ================================================================
  // ③ 会計（記録から作る・計算・更新）
  // ================================================================
  const NO_RECORD = '会計を付ける記録が見つかりません（基準版の画面で保存したカルテが必要です）';
  on('POST', /^\/records\/([0-9a-f-]{36})\/billing\/calculate$/, async (m) => {
    const v = await B().visitById(m[1]); if (!v || !B().baseOf(v)) return err(404, NO_RECORD);
    const st = await B().ensureBilling(v, false); if (!st) return err(404, 'カルテが見つかりません');
    return B().calcResponse(Object.assign({}, st, { items: st.items || [] }));
  });
  on('POST', /^\/records\/([0-9a-f-]{36})\/billing$/, async (m, q, body) => {
    if (body && Array.isArray(body.items)) {   // 明細を指定したときは /billings（明細を指定して会計を作る）と同じ
      const h = C.routeOf('POST', /^\/billings$/); if (!h) return err(500, '会計の作成処理が読み込まれていません');
      return h(null, q, Object.assign({}, body, { record_id: m[1] }));
    }
    const v = await B().visitById(m[1]); if (!v || !B().baseOf(v)) return err(404, NO_RECORD);
    const st = await B().ensureBilling(v, true); if (!st) return err(404, 'カルテが見つかりません');
    return B().response(v, st, true);
  });
  on('PUT', /^\/billings\/([0-9a-f-]{36})$/, async (m, q, body) => {
    body = body || {};
    const { v, st } = await B().loadBilling(m[1]);
    if (!v || !st || st.transient || !B().isActive(st)) return err(404, '会計が見つかりません');
    const paid = toInt(st.paid_amount);
    const recalc = Array.isArray(body.items) || body.insurance_id !== undefined || body.public_expense_id !== undefined;
    if (recalc) {
      if (paid > 0) return err(400, '入金済み会計があるため算定を変更できません');
      if (Array.isArray(body.items)) { const bad = B().checkItems(body.items); if (bad) return err(422, bad); }
      const items = Array.isArray(body.items) ? B().bodyItems(body.items) : (st.items_override || Calc().recalcItemsFromDisplay(st.items));
      const ids = { insurance_id: body.insurance_id !== undefined ? body.insurance_id : st.insurance_id, public_expense_id: body.public_expense_id !== undefined ? body.public_expense_id : st.public_expense_id };
      const { ins, pe, calc } = await B().compute(v.patients || {}, v.visit_date, items, v.id, ids);
      const display = calc.items.map((x, i) => ({ id: v.id + '-bi' + i, item_type: x.item_type, code: x.code, name: x.name, quantity: Number(x.quantity), unit_score: x.unit_score, score: x.score, amount: x.amount, category: x.category_name || null }));
      Object.assign(st, B().headerOf(calc, ins, pe), { items: display, items_override: Array.isArray(body.items) ? items : (st.items_override || null),
        unpaid_amount: Math.max(calc.final_amount - paid, 0), payment_status: Calc().paymentStatusFor(calc.final_amount, paid) });
    }
    ['memo', 'note'].forEach((k) => { if (body[k] !== undefined) st[k] = body[k] == null ? null : String(body[k]); });
    st.updated_at = nowIso();
    await B().saveState(v.id, st);
    return B().response(v, st, true);
  });

  // ================================================================
  // ④ 領収書・明細書（発行記録＋PDF）
  // ================================================================
  let pdfLib = null;
  function loadPdfLib() {
    if (window.RezeptFormPdf) return Promise.resolve(window.RezeptFormPdf);
    if (!pdfLib) pdfLib = new Promise((ok, ng) => {
      const s = document.createElement('script'); s.src = '../rezept_form_pdf.js?v=20260925_daily';
      s.onload = () => (window.RezeptFormPdf ? ok(window.RezeptFormPdf) : ng(new Error('PDF の部品を読み込めません')));
      s.onerror = () => { pdfLib = null; ng(new Error('PDF の部品を読み込めません')); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  const MM = 72 / 25.4;
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const halfWidth = (ch) => { const cp = ch.codePointAt(0); return cp < 0x100 || (cp >= 0xFF61 && cp <= 0xFF9F); };
  const textW = (s, size) => Array.from(String(s)).reduce((w, ch) => w + (halfWidth(ch) ? 0.5 : 1) * size, 0);
  // 点検用様式と同じ SVG の形（<rect>・<line>・1文字ずつの <text>）で組み、RezeptFormPdf で PDF にする
  class Page {
    constructor() { this.p = []; }
    line(x1, y1, x2, y2, w) { this.p.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#000000" stroke-width="' + (w || 0.6) + '"/>'); }
    box(x, y, w, h, lw) { this.line(x, y, x + w, y, lw); this.line(x + w, y, x + w, y + h, lw); this.line(x + w, y + h, x, y + h, lw); this.line(x, y + h, x, y, lw); }
    dotted(x1, x2, y) { for (let x = x1; x < x2; x += 1.6) this.p.push('<rect x="' + x + '" y="' + (y - 0.15) + '" width="0.6" height="0.3" fill="#6b7280"/>'); }
    text(x, baseline, value, size, align) {
      value = value == null ? '' : String(value); if (!value) return;
      if (align === 'right') x -= textW(value, size); else if (align === 'center') x -= textW(value, size) / 2;
      const k = (size + 0.00015) / 100;
      for (const ch of Array.from(value)) {
        if (ch !== ' ' && ch !== '　') this.p.push('<text font-family="RzFormGothic" font-size="100" transform="matrix(' + k + ' 0 0 ' + k + ' ' + (x + 0.002) + ' ' + (baseline + 0.002) + ')" fill="#000000">' + xmlEsc(ch) + '</text>');
        x += (halfWidth(ch) ? 0.5 : 1) * size;
      }
    }
    svg() { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842">' + this.p.join('') + '</svg>'; }
  }
  // ---- 基準版の画面の帳票と同じ区分・表示（renderer.js の getReceiptPointCategory ほかを写したもの） ----
  const RECEIPT_POINT_ROWS = ['初・再診料', '医学管理料', '在宅医療', '投薬', '注射', '処置', '手術', '麻酔', '検査', '画像診断', 'リハビリテーション', '精神科専門療法', '放射線治療', '病理診断', '入院料等', 'その他'];
  function pointCategory(item) {
    if (!item || item.item_type === 'self_pay') return null;
    const code = String(item.code || '').toUpperCase(); const text = (item.category || '') + ' ' + (item.name || '');
    if (/入院/.test(text) || /^A[1-9]/.test(code)) return '入院料等';
    if (/医学管理|管理料|指導料/.test(text) || /^B/.test(code)) return '医学管理料';
    if (/在宅|往診|訪問診療/.test(text) || /^C/.test(code)) return '在宅医療';
    if (/投薬|処方|調剤|薬/.test(text) || /^F/.test(code)) return '投薬';
    if (/注射|点滴|静注|筋注|皮下注/.test(text) || /^G/.test(code)) return '注射';
    if (/処置/.test(text) || /^J/.test(code)) return '処置';
    if (/手術/.test(text) || /^K/.test(code)) return '手術';
    if (/麻酔/.test(text) || /^L/.test(code)) return '麻酔';
    if (/検査/.test(text) || /^D/.test(code)) return '検査';
    if (/画像|レントゲン|Ｘ線|X線|CT|MRI/.test(text) || /^E/.test(code)) return '画像診断';
    if (/リハビリ/.test(text) || /^H/.test(code)) return 'リハビリテーション';
    if (/精神科|精神/.test(text) || /^I/.test(code)) return '精神科専門療法';
    if (/放射線/.test(text) || /^M/.test(code)) return '放射線治療';
    if (/病理/.test(text) || /^N/.test(code)) return '病理診断';
    if (/初診|再診|外来診療料|診察|時間外|休日|深夜|乳幼児|医療情報取得|機能強化|感染対策|明細書発行/.test(text) || /^A/.test(code)) return '初・再診料';
    return 'その他';
  }
  const STATEMENT_LABELS = { '初・再診料': '初・再診', '医学管理料': '医学管理等' };
  const statementCategory = (item) => item.item_type === 'self_pay' ? 'その他' : (STATEMENT_LABELS[pointCategory(item) || item.category] || pointCategory(item) || item.category || 'その他');
  function eraDate(ymdStr) {
    const d = String(ymdStr || today()).slice(0, 10); const [y, mo, da] = d.split('-').map(Number);
    const eras = [['令和', '2019-05-01', 2019], ['平成', '1989-01-08', 1989], ['昭和', '1926-12-25', 1926], ['大正', '1912-07-30', 1912], ['明治', '1868-01-25', 1868]];
    const e = eras.find((x) => d >= x[1]); if (!e) return y + '年' + mo + '月' + da + '日';
    const ey = y - e[2] + 1; return e[0] + ' ' + (ey === 1 ? '元' : ey) + '年 ' + mo + '月 ' + da + '日';
  }
  const fmtNum = (v, blankZero) => { const n = Number(v || 0); if (blankZero !== false && n === 0) return ''; return n.toLocaleString('ja-JP'); };
  const INS_LABEL = { social: '社会保険', national: '国民健康保険', elderly: '後期高齢者医療', labor: '労災', auto: '自賠責', self_pay: '自費' };
  async function printContext(v, st) {
    const c = await ready();
    const { data: vv } = await c.from('visits').select('department,patients(patient_no,name,receipt_extra,insurance_type,relationship)').eq('id', v.id).eq('clinic_id', clinicId()).maybeSingle();
    const p = (vv && vv.patients) || {};
    const ins = ((p.receipt_extra && p.receipt_extra.insurances) || []).find((i) => String(i.id) === String(st.insurance_id)) || null;
    const facility = { name: '', address: '', phone: '' };
    const cur = C.routeOf('GET', /^\/facilities\/current$/); if (cur) { try { const f = await cur(); if (f) ['name', 'address', 'phone'].forEach((k) => { if (f[k]) facility[k] = f[k]; }); } catch (e) { /* 既定のまま */ } }
    if (C.facilityForForm) { try { const f = await C.facilityForForm(); if (f) ['name', 'address', 'phone'].forEach((k) => { if (f[k]) facility[k] = f[k]; }); } catch (e) { /* 既定のまま */ } }
    const rel = (ins && ins.relationship) || (/家族|被扶養/.test(String(p.relationship || '')) ? 'family' : p.relationship ? 'main' : '');
    const ratio = st.burden_ratio;
    return { patientNo: p.patient_no || '', patientName: p.name || '', department: (vv && vv.department) || '', visitDate: v.visit_date,
      insuranceLabel: (ins && (ins.insurerName || INS_LABEL[ins.insuranceType])) || INS_LABEL[st.insurance_type] || st.insurance_type || p.insurance_type || '未登録',
      relationLabel: rel === 'family' ? '家族' : rel === 'main' ? '本人' : '', burdenLabel: ratio === null || ratio === undefined || ratio === '' ? '' : Number(ratio) === 0 ? '負担なし' : ratio + '%', facility };
  }
  // 診療費請求書兼領収書（基準版 buildReceiptPrintHtml と同じ項目・並び。A4 縦）
  function receiptPages(ctx, st) {
    const pg = new Page(), x0 = 20 * MM, right = 595 - 20 * MM;
    pg.text(297.5, 20 * MM + 16.5, '診療費請求書兼領収書', 16.5, 'center');
    pg.text(right - 2 * MM, 18 * MM + 9, '発行日 ' + eraDate(today()), 9, 'right');
    pg.text(x0, 42 * MM, '患者番号', 9.75); pg.text(x0 + 28 * MM, 42 * MM, ctx.patientNo, 9.75);
    pg.text(x0, 57 * MM, '氏名', 12); pg.text(x0 + 22 * MM, 57 * MM, ctx.patientName, 17); pg.text(x0 + 76 * MM, 57 * MM, '様', 12); pg.line(x0, 59 * MM, x0 + 86 * MM, 59 * MM, 0.75);
    const x1 = x0 + 96 * MM;
    [['診療日', eraDate(ctx.visitDate)], ['受診科', ctx.department], ['保険種類', ctx.insuranceLabel], ['本人・家族', ctx.relationLabel], ['負担割合', ctx.burdenLabel]]
      .forEach(([k, val], i) => { const y = 38 * MM + i * 5.4 * MM; pg.text(x1, y, k, 9.4); pg.text(x1 + 32 * MM, y, val, 9.4); });
    // 左: 区分別の点数
    const sum = {}; RECEIPT_POINT_ROWS.forEach((r) => { sum[r] = 0; });
    (st.items || []).forEach((it) => { const cat = pointCategory(it); if (cat) sum[cat] += toInt(it.score); });
    const top = 70 * MM, lw = 42 * MM, vw = 34 * MM, uw = 8 * MM, rh = 7 * MM; let y = top;
    const row = (x, yy, h, label, val, unit, wl, wv, wu, size) => {
      pg.box(x, yy, wl, h); pg.box(x + wl, yy, wv, h); pg.box(x + wl + wv, yy, wu, h);
      const b = yy + h / 2 + (size || 9.75) * 0.36;
      if (label) pg.text(x + 2 * MM, b, label, size || 9.75); if (val) pg.text(x + wl + wv - 2 * MM, b, val, size || 9.75, 'right'); if (unit) pg.text(x + wl + wv + wu - 1 * MM, b, unit, size || 9.75, 'right');
    };
    RECEIPT_POINT_ROWS.forEach((r) => { row(x0, y, rh, r, fmtNum(sum[r]), '点', lw, vw, uw); y += rh; });
    row(x0, y, rh, '', '', '', lw, vw, uw); y += rh;
    row(x0, y, 8.5 * MM, '合計点数', fmtNum(st.total_score), '点', lw, vw, uw); y += 8.5 * MM;
    const leftBottom = y;
    // 右: 金額
    const selfPay = toInt(st.self_pay_amount), fin = toInt(st.final_amount);
    const x2 = x0 + 94 * MM, al = 43 * MM, av = 25 * MM, au = 8 * MM; y = top;
    const block = (rows) => { rows.forEach(([k, val]) => { row(x2, y, rh, k, fmtNum(val), '円', al, av, au); y += rh; }); y += 6 * MM; };
    block([['保険分負担額', Math.max(0, fin - selfPay)], ['保険外負担額計', selfPay], ['選定療養', 0], ['その他保険外', 0]]);
    block([['今回請求額', fin], ['前回繰越額', 0], ['合計請求額', fin]]);
    block([['調整金', 0]]);
    y += 1 * MM; pg.box(x2, y, al + av + au, 12 * MM, 1.5); pg.line(x2 + al, y, x2 + al, y + 12 * MM, 1.5);
    pg.text(x2 + al / 2, y + 6 * MM + 6.5, '領収金額', 18, 'center'); pg.text(x2 + al + av + au - 9 * MM, y + 6 * MM + 6.5, fmtNum(fin, false), 18, 'right'); pg.text(x2 + al + av + au - 1 * MM, y + 6 * MM + 6.5, '円', 18, 'right');
    y = Math.max(leftBottom, y + 12 * MM) + 6 * MM;
    pg.text(x0, y + 8, '※領収書は再発行いたしかねますので、大切に保管して下さい。', 7.9); y += 5 * MM;
    pg.text(x0, y + 8, '※厚生労働省が定める診療報酬や薬価等には、医療機関等が仕入れ時に負担する消費税が反映されています。', 7.9); y += 9 * MM;
    pg.text(x0, y + 9, ctx.facility.address, 9); y += 6 * MM; pg.text(x0, y + 12, ctx.facility.name, 12); y += 7 * MM; pg.text(x0, y + 9, '電話 ' + (ctx.facility.phone || ''), 9);
    return [pg.svg()];
  }
  // 診療明細書（基準版 buildStatementPrintHtml と同じ項目・並び。1ページ 28 行・「以下余白」）
  function statementPages(ctx, st) {
    let prev = '';
    const rows = (st.items || []).filter((it) => it && it.name).map((it) => {
      const cat = statementCategory(it), qty = Number(it.quantity || 1) || 1;
      const unit = toInt(it.unit_score), pts = it.item_type === 'self_pay' ? '' : unit > 0 ? fmtNum(unit) : (toInt(it.score) > 0 ? fmtNum(toInt(it.score) / qty) : '');
      const out = { category: cat === prev ? '' : cat, name: it.name, points: pts, count: fmtNum(qty) }; prev = cat; return out;
    });
    const PER = 28, pages = []; for (let i = 0; i < Math.max(rows.length, 1); i += PER) pages.push(rows.slice(i, i + PER));
    return pages.map((list, pi) => {
      const pg = new Page(), x0 = 20 * MM, w = 595 - 40 * MM;
      pg.text(297.5, 18 * MM + 15, '診療明細書', 15, 'center');
      pg.text(x0 + w, 16 * MM + 8, '発行日 ' + eraDate(today()), 8, 'right'); pg.text(x0 + w, 20 * MM + 8, (pi + 1) + '/' + pages.length, 8, 'right');
      pg.text(x0, 32 * MM, '患者番号', 9); pg.text(x0 + 22 * MM, 32 * MM, ctx.patientNo, 9);
      pg.text(x0, 40 * MM, '氏名', 9); pg.text(x0 + 22 * MM, 40 * MM, ctx.patientName, 13); pg.text(x0 + 78 * MM, 40 * MM, '様', 10); pg.line(x0, 41.5 * MM, x0 + 84 * MM, 41.5 * MM, 0.75);
      [['診療日', eraDate(ctx.visitDate)], ['受診科', ctx.department], ['保険種類', ctx.insuranceLabel], ['本人・家族', ctx.relationLabel], ['負担割合', ctx.burdenLabel]]
        .forEach(([k, val], i) => { const y = 48 * MM + i * 4.6 * MM; pg.text(x0, y, k, 8.5); pg.text(x0 + 22 * MM, y, val, 8.5); });
      const fx = x0 + 100 * MM; pg.text(fx, 34 * MM, ctx.facility.address, 8.5); pg.text(fx, 40 * MM, ctx.facility.name, 11); if (ctx.facility.phone) pg.text(fx, 45 * MM, '電話 ' + ctx.facility.phone, 8.5);
      const top = 74 * MM, hh = 6 * MM, rh = 6.2 * MM, cw = [30 * MM, w - 30 * MM - 22 * MM - 18 * MM, 22 * MM, 18 * MM];
      const xs = [x0]; cw.forEach((c) => xs.push(xs[xs.length - 1] + c));
      const bottom = top + hh + PER * rh;
      pg.box(x0, top, w, bottom - top, 0.75); pg.line(x0, top + hh, x0 + w, top + hh, 0.75);
      for (let i = 1; i < xs.length - 1; i++) pg.line(xs[i], top, xs[i], bottom, 0.75);
      ['区分', '項目名', '点数', '回数'].forEach((h, i) => pg.text((xs[i] + xs[i + 1]) / 2, top + hh / 2 + 3.2, h, 8.8, 'center'));
      const last = pi === pages.length - 1, lines = list.slice();
      if (last && lines.length < PER) lines.push({ category: '', name: '以下余白', points: '', count: '', end: true });
      lines.forEach((r, i) => {
        const b = top + hh + i * rh + rh / 2 + 3;
        pg.text(xs[0] + 1 * MM, b, r.category, 8.5); pg.text(xs[1] + 1 * MM, b, r.end ? r.name : '＊' + r.name, 8.5);
        pg.text(xs[3] - 1 * MM, b, r.points, 8.5, 'right'); pg.text(xs[4] - 1 * MM, b, r.count, 8.5, 'right');
      });
      for (let i = 1; i < PER; i++) pg.dotted(x0, x0 + w, top + hh + i * rh);
      pg.text(x0, bottom + 7 * MM, '※厚生労働省が定める診療報酬や薬価等には、医療機関等が仕入れ時に負担する消費税が反映されています。', 7.5);
      return pg.svg();
    });
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  async function issueDocument(id, kind) {
    const { v, st } = await B().loadBilling(id);
    if (!v || !st || st.transient || !B().isActive(st)) return err(404, '会計が見つかりません');
    const title = kind === 'receipt' ? '診療費請求書兼領収書' : '診療明細書';
    let bytes;
    try {
      const ctx = await printContext(v, st); const lib = await loadPdfLib();
      const pages = kind === 'receipt' ? receiptPages(ctx, st) : statementPages(ctx, st);
      bytes = new Uint8Array(await (await lib.fromSvgPages(pages, { title })).arrayBuffer());
    } catch (e) { return err(500, title + '（PDF）を作れませんでした: ' + (e && e.message || e)); }
    const docs = st.issued_documents || [], n = docs.filter((d) => d.document_type === kind).length + 1, at = nowIso();
    const no = (st.billing_no || String(v.visit_date).replace(/-/g, '')) + (kind === 'receipt' ? '-R' : '-S') + pad2(n);
    const doc = { id: uid(), document_type: kind, document_no: no, issued_at: at, issued_by: userId(), amount: toInt(st.final_amount), issue_count: n };
    st.issued_documents = docs.concat([doc]);
    if (kind === 'receipt') { st.payments = (st.payments || []).map((p) => (p.receipt_issued ? p : Object.assign({}, p, { receipt_issued: true, receipt_no: no }))); st.receipt_issued_at = at; }
    else st.statement_issued_at = at;
    st.updated_at = at; await B().saveState(v.id, st);
    const fileName = title + '_' + (st.billing_no || v.visit_date) + '.pdf';
    return Object.assign({ id: doc.id, billing_id: v.id, document_type: kind, document_no: no, issued_at: at, issue_count: n, amount: doc.amount,
      file_name: fileName, content_type: 'application/pdf', pdf_base64: b64(bytes), message: title + 'を発行しました' }, kind === 'receipt' ? { receipt_no: no } : { statement_no: no });
  }
  on('POST', /^\/billings\/([0-9a-f-]{36})\/receipt$/, async (m) => issueDocument(m[1], 'receipt'));
  on('POST', /^\/billings\/([0-9a-f-]{36})\/statement$/, async (m) => issueDocument(m[1], 'statement'));

  // ================================================================
  // ⑤ 算定チェック（基準版 CheckSummaryResponse の形。判定は「指摘なし」）
  // ================================================================
  const summaryOf = (d) => ({ check_date: String(d || today()).slice(0, 10), check_datetime: nowIso(), total_checks: 0, error_count: 0, warning_count: 0, info_count: 0, passed: true, results: [] });
  on('POST', /^\/calculations\/check\/actions$/, async (m, q, body) => {
    body = body || {};
    if (!UUID.test(String(body.patient_id || ''))) return err(422, '患者を指定してください');
    if (!Array.isArray(body.action_codes) || !body.action_codes.length) return err(422, '行為コードを1つ以上指定してください');
    const c = await ready(); const { data: p } = await c.from('patients').select('id').eq('id', body.patient_id).eq('clinic_id', clinicId()).maybeSingle();
    if (!p) return err(404, '患者が見つかりません');
    return summaryOf(body.check_date);
  });
  const checkPrescription = async (id) => {
    if (!id) return err(422, '処方を指定してください');
    const found = await findPrescription(id); if (!found) return err(404, '処方箋が見つかりません');
    return summaryOf(found.rec.v.visit_date);
  };
  on('POST', /^\/calculations\/check\/prescription$/, async (m, q, body) => checkPrescription(String((body && body.prescription_id) || '')));
  on('POST', /^\/calculations\/check\/prescription\/([^/]+)$/, async (m) => checkPrescription(decodeURIComponent(m[1])));
  const checkDosage = async (m, q, body) => {
    body = Object.assign({}, Object.fromEntries(q.entries()), body || {});
    if (!String(body.drug_code || '').trim()) return err(422, '薬剤コードを指定してください');
    if (!Number.isFinite(Number(body.dose_quantity)) || body.dose_quantity === '' || body.dose_quantity === null) return err(422, '用量を数値で指定してください');
    if (!String(body.dose_unit || '').trim()) return err(422, '用量の単位を指定してください');
    return [];
  };
  on('POST', /^\/calculations\/check\/dosage$/, checkDosage);
  on('GET', /^\/calculations\/check\/dosage$/, checkDosage);

  // ================================================================
  // ⑥ レセプトの請求の扱い・返戻明細の対応状態（院ごとの台帳）
  // ================================================================
  const CKEY = () => 'karte_base_receipt_claim_status_' + clinicId();
  const RKEY = () => 'karte_base_receipt_returns_' + clinicId();
  const readObj = (k, d) => { try { const v = JSON.parse(C.store.getItem(k) || 'null'); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } };
  const readClaims = () => { const o = readObj(CKEY(), {}); return Array.isArray(o) ? {} : o; };
  const writeClaims = (o) => C.store.setItem(CKEY(), JSON.stringify(o));
  C.claimStatusMap = readClaims;   // compat_receipt.js（レセプト作成）が会計ごとの請求の扱いを読む
  const CLAIM_LABEL = { include: '請求に含める', warning: '要確認', exclude: '請求に含めない', month_delay: '月遅れ', resubmit: '返戻再請求', return_hold: '返戻保留' };
  function upsertClaim(map, billingId, status, note) {
    const prev = map[billingId]; const at = nowIso();
    const history = ((prev && prev.history) || []).concat(prev ? [{ claim_status: prev.claim_status, note: prev.note, updated_at: prev.updated_at, updated_by: prev.updated_by }] : []).slice(-20);
    map[billingId] = { id: (prev && prev.id) || uid(), billing_id: billingId, claim_status: status, note: note || '', updated_at: at, updated_by: userId(), history };
    return map[billingId];
  }
  const claimOut = (row) => ({ id: row.id, billing_id: row.billing_id, claim_status: row.claim_status, claim_status_label: CLAIM_LABEL[row.claim_status] || '請求に含める', note: row.note || '', updated_at: row.updated_at || null });
  on('PATCH', /^\/receipt-claims\/billings\/([0-9a-f-]{36})\/claim-status$/, async (m, q, body) => {
    body = body || {};
    const status = String(body.claim_status || '').trim();
    if (!['include', 'exclude', 'month_delay', 'resubmit', 'return_hold'].includes(status)) return err(422, '請求状態が不正です');
    let note = body.note == null ? null : String(body.note);
    if (status === 'exclude') {
      const reason = String(note || '').trim();
      if (!body.exclusion_confirmed || ['', '対象外', '請求対象外', '除外', '含めない'].includes(reason)) return err(422, '請求対象外にする具体的な理由と確認が必要です');
      note = reason;
    }
    const c = await ready(); const { data: v } = await c.from('visits').select('id').eq('id', m[1]).eq('clinic_id', clinicId()).maybeSingle();
    if (!v) return err(404, '会計が見つかりません');
    const map = readClaims(); const row = upsertClaim(map, m[1], status, note); writeClaims(map);
    return { data: claimOut(row) };
  });
  on('GET', /^\/receipt-claims\/billings\/([0-9a-f-]{36})\/claim-status$/, async (m) => {
    const row = readClaims()[m[1]];
    return { data: row ? claimOut(row) : { id: null, billing_id: m[1], claim_status: 'include', claim_status_label: '請求に含める', note: '', updated_at: null } };
  });
  // 返戻の台帳（取り込んだ返戻と明細）。取り込みの口は統合版のレセプト作成側。ここでは一覧と対応状態の更新
  const readReturns = () => { const l = readObj(RKEY(), []); return Array.isArray(l) ? l : []; };
  on('GET', /^\/receipt-claims\/returns$/, async (m, q) => {
    const lim = Math.min(100, Number(q.get('limit') || 20));
    return { data: readReturns().slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, lim)
      .map((r) => Object.assign({}, r, { item_count: (r.items || []).length, linked_count: (r.items || []).filter((x) => x.billing_id).length })) };
  });
  on('PATCH', /^\/receipt-claims\/returns\/items\/([^/]+)\/status$/, async (m, q, body) => {
    body = body || {};
    const status = String(body.resubmit_status || '').trim();
    if (!['needs_review', 'matched', 'resubmit', 'hold', 'resolved'].includes(status)) return err(422, '対応状態が不正です');
    const id = decodeURIComponent(m[1]); const list = readReturns();
    let item = null; for (const r of list) { const it = (r.items || []).find((x) => String(x.id) === id); if (it) { item = it; break; } }
    if (!item) return err(404, '返戻明細が見つかりません');
    const payload = Object.assign({}, item.claim_payload || {}, { status_note: body.note || '', status_updated_at: nowIso(), status_updated_by: userId() });
    item.resubmit_status = status; item.claim_payload = payload;
    const linked = Array.from(new Set((payload.linked_billing_ids || []).concat(item.billing_id ? [item.billing_id] : []).map(String).filter((x) => UUID.test(x))));
    const linkedStatus = { resubmit: 'resubmit', hold: 'return_hold', resolved: 'exclude' }[status] || null;
    if (linked.length && linkedStatus) { const map = readClaims(); linked.forEach((bid) => upsertClaim(map, bid, linkedStatus, body.note || null)); writeClaims(map); }
    C.store.setItem(RKEY(), JSON.stringify(list));
    return { data: item };
  });
})();
