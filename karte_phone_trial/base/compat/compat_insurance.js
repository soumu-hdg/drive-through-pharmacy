// ===== 置き換え層：保険・公費・レセプト記載事項（工程4・2026-09-24） compat_insurance.js =====
// 基準版の /insurances/... の問い合わせを、統合版の患者データに読み書きする。
//   ・保存先は patients.receipt_extra の配列（統合版の保険等タブと同じ入れ物・同じ項目名）と、労災は patients.rousai
//   ・基準版は項目名が snake_case、統合版の配列は camelCase。名前の違う項目だけ対応表で直し、残りは機械的に変換する
//   ・保存したら、統合版の従来の項目（保険者番号・記号・番号・負担割合・公費番号など）も主保険から写す（UKE・会計が読む）
//   ・一覧は配列で返す（基準版の画面は .filter で読む）。削除は 204
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, ready, clinicId, realFetch } = C;
  let masters = null;
  async function mastersOf() {
    if (!masters) { masters = (await C.masterJson('insurance_masters')) || { insurance_types: [], public_expense_types: [], special_note_types: [], symptom_detail_types: [] }; }
    return masters;
  }
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const uid = () => crypto.randomUUID();
  const toCamel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  const toSnake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()).replace(/([a-z])([0-9])/g, '$1_$2');
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const LABOR = ['labor', 'workers', 'workers_comp'], AUTO = ['auto', 'automobile'];

  // ---- 種類ごとの対応（基準版の項目名 ⇔ 統合版の項目名）。載っていない項目は snake ⇔ camel の機械変換 ----
  const KINDS = {
    'insurances': { key: 'insurances', map: { workers_comp_details: 'workersCompDetails' } },
    'public-expenses': { key: 'publicExpenses', map: { expense_type: 'type', expense_type_code: 'typeCode', recipient_confirm_later: 'confirmLater', municipality_name: 'municipality' } },
    'receipt-special-notes': { key: 'receiptSpecialNotes', map: { special_note_code: 'code' } },
    'receipt-symptom-details': { key: 'receiptSymptomDetails', map: { record_kind: 'kind', detail_category_code: 'category', target_insurance_id: 'insurance' } },
    'receipt-summary-comments': { key: 'receiptSummaryComments', map: { output_position: 'position', target_insurance_id: 'insurance' } },
    'welfare-invoice-comments': { key: 'welfareInvoiceComments', map: {} },
    'receipt-copayments': { key: 'receiptCopayments', map: { copayment_category: 'category', insurance_amount: 'insuranceAmount',
      public_expense_1_covered_amount: 'covered1', public_expense_2_covered_amount: 'covered2', public_expense_3_covered_amount: 'covered3', public_expense_4_covered_amount: 'covered4',
      public_expense_1_amount: 'public1', public_expense_2_amount: 'public2', public_expense_3_amount: 'public3', public_expense_4_amount: 'public4' } },
  };
  const SKIP_IN = new Set(['change_reason', 'patient_id', 'id', 'created_at', 'updated_at', 'insurance_type_name', 'expense_type_name', 'special_note_name', 'detail_category_name',
    'target_insurance_label', 'output_position_label', 'calculated_insurance_amount', 'difference_amount', 'requires_local_confirmation', 'rule_remarks']);
  function fromBase(kind, body) {
    const map = KINDS[kind].map, o = {};
    Object.keys(body || {}).forEach((k) => { if (SKIP_IN.has(k)) return; o[map[k] || toCamel(k)] = body[k] === undefined ? null : body[k]; });
    if (kind === 'public-expenses') { o.noPayerNumber = !o.payerNumber; }
    return o;
  }
  function toBase(kind, item, pid) {
    const map = KINDS[kind].map, rev = {}; Object.keys(map).forEach((k) => { rev[map[k]] = k; });
    const o = { id: item.id, patient_id: pid };
    Object.keys(item).forEach((k) => { if (k === 'id' || k.startsWith('_')) return; o[rev[k] || toSnake(k)] = item[k] === '' ? null : item[k]; });
    delete o.no_payer_number;
    o.is_active = item.isActive !== false;
    o.created_at = item.createdAt || item.updatedAt || '2026-01-01T00:00:00Z';
    o.updated_at = item.updatedAt || o.created_at;
    return o;
  }

  // ---- 労災（統合版は patients.rousai）⇔ 基準版の労災保険（insurance_type=labor・workers_comp_details） ----
  const RS = { claimType: 'workers_claim_type', benefitType: 'benefit_type', sheetType: 'form_type_code', newContinuing: 'new_continuing_code', outcome: 'outcome_code',
    no: 'labor_insurance_number', pensionNo: 'pension_certificate_number', accidentDate: 'injury_date', startDate: 'treatment_start_date', endDate: 'treatment_end_date',
    sameInjuryCount: 'same_injury_count', bureauCode: 'labor_bureau_code', officeCode: 'inspection_office_code', office: 'business_name', officeAddr: 'business_address',
    acDiseaseCode: 'aftercare_disease_code', acHandbookNo: 'aftercare_handbook_number', acPrevExamDate: 'aftercare_previous_examination_date', workerKana: 'worker_kana', course: 'injury_course' };
  function rousaiToBase(r, pid) {
    const d = Object.assign({}, r.workersCompDetails || {});
    Object.keys(RS).forEach((k) => { if (r[k] != null && r[k] !== '') d[RS[k]] = r[k]; });
    d.accident_type_code = r.formType === '16-3' ? '3' : (d.accident_type_code || '1');
    return { id: r.id, patient_id: pid, insurance_type: 'labor', insurer_number: null, symbol: null, number: r.no || r.pensionNo || null, branch_number: null, relationship: 'main', burden_ratio: 0,
      valid_from: r.startDate || null, valid_until: r.endDate || null, workers_comp_details: d, is_primary: false, is_active: true, created_at: r.updatedAt || '2026-01-01T00:00:00Z', updated_at: r.updatedAt || '2026-01-01T00:00:00Z' };
  }
  function rousaiFromBase(b, existing) {
    const d = b.workers_comp_details || {}, r = Object.assign({}, existing || {});
    Object.keys(RS).forEach((k) => { if (d[RS[k]] !== undefined) r[k] = d[RS[k]] == null ? '' : d[RS[k]]; });
    r.formType = d.accident_type_code === '3' ? '16-3' : '5';
    if (b.valid_from !== undefined) r.startDate = b.valid_from || ''; if (b.valid_until !== undefined) r.endDate = b.valid_until || '';
    r.workersCompDetails = d; r.updatedAt = new Date().toISOString();
    return r;
  }

  // ---- 患者の読み書き ----
  const COLS = 'id,clinic_id,dob,receipt_extra,rousai,insurer_number,ins_symbol,ins_number,ins_edaban,relationship,copay_rate,insurance_type,kouhi_number,recipient_number';
  async function loadPatient(pid) {
    const c = await ready();
    const { data, error } = await c.from('patients').select(COLS).eq('id', pid).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message); return data;
  }
  async function findOwner(kind, id) {
    const c = await ready(); const key = KINDS[kind].key;
    let { data, error } = await c.from('patients').select(COLS).eq('clinic_id', clinicId()).contains('receipt_extra', { [key]: [{ id }] }).limit(1);
    if (error) throw new Error(error.message);
    if ((!data || !data.length) && kind === 'insurances') ({ data } = await c.from('patients').select(COLS).eq('clinic_id', clinicId()).contains('rousai', [{ id }]).limit(1));
    if ((!data || !data.length) && LEGACY.test(id)) return loadPatient(id.replace(LEGACY, ''));
    return data && data[0] ? data[0] : null;
  }
  const arr = (row, key) => (row && row.receipt_extra && Array.isArray(row.receipt_extra[key])) ? row.receipt_extra[key] : [];
  function ratioLabel(r) { return r === 10 ? '1割' : r === 20 ? '2割' : r === 5 ? '5%' : r === 30 ? '3割' : r === 100 ? '10割' : '0割'; }
  // 統合版の従来の項目（UKE・会計・受付一覧が読む）を、今日有効な主保険と優先順位1の公費から写す
  function legacyColumns(extra, d) {
    const act = (x) => x.isActive !== false && (!x.validFrom || String(x.validFrom).slice(0, 10) <= d) && (!x.validUntil || String(x.validUntil).slice(0, 10) >= d);
    const ins = (extra.insurances || []).filter((i) => !LABOR.includes(i.insuranceType) && !AUTO.includes(i.insuranceType) && act(i)).sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))[0];
    const pub = (extra.publicExpenses || []).filter(act).sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0];
    const o = {};
    if (ins) {
      const br = Number(ins.burdenRatio);
      Object.assign(o, { insurer_number: ins.insurerNumber || null, ins_symbol: ins.symbol || null, ins_number: ins.number || null, ins_edaban: ins.branchNumber || null,
        relationship: ins.relationship === 'family' ? '家族' : '本人', copay_rate: isNaN(br) ? null : br / 100,
        insurance_type: ins.insuranceType === 'self_pay' ? '自費' : (ins.insuranceType === 'national' ? '国保' : ins.insuranceType === 'elderly' ? '後期高齢者' : '社保') + ratioLabel(br) });
    }
    if (pub) Object.assign(o, { kouhi_number: pub.payerNumber || null, recipient_number: pub.confirmLater ? null : (pub.recipientNumber || null) });
    return o;
  }
  async function savePatient(row, extra, rousai) {
    const c = await ready();
    const clean = {}; Object.keys(extra).forEach((k) => { const v = extra[k]; if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) clean[k] = v; });
    const patch = Object.assign({ receipt_extra: Object.keys(clean).length ? clean : null }, legacyColumns(clean, today()));
    if (rousai !== undefined) patch.rousai = rousai && rousai.length ? rousai : null;
    const { error } = await c.from('patients').update(patch).eq('id', row.id).eq('clinic_id', clinicId());
    if (error) throw new Error(error.message);
  }
  function passFilter(item, q) {
    const activeOnly = q.get('active_only') !== 'false', inclExpired = q.get('include_expired') === 'true';
    if (activeOnly && item.is_active === false) return false;
    if (!inclExpired && item.valid_until && String(item.valid_until).slice(0, 10) < today()) return false;
    return true;
  }

  // ---- 名前・表示用の項目を足す ----
  async function decorate(kind, o, row) {
    const m = await mastersOf();
    if (kind === 'insurances') { const t = m.insurance_types.find((x) => x.type_code === o.insurance_type); o.insurance_type_name = t ? t.name : o.insurance_type; if (!o.workers_comp_details) o.workers_comp_details = {}; if (o.is_primary == null) o.is_primary = true; }
    if (kind === 'public-expenses') { const t = m.public_expense_types.find((x) => x.type_code === o.expense_type); o.expense_type_name = t ? t.name : (o.expense_type || ''); if (!o.expense_type_code && t) o.expense_type_code = t.law_number; if (o.priority == null) o.priority = 1; }
    if (kind === 'receipt-special-notes') { const t = m.special_note_types.find((x) => x.code === o.special_note_code); o.special_note_name = t ? t.name : ''; }
    if (kind === 'receipt-symptom-details') { const t = m.symptom_detail_types.find((x) => x.code === o.detail_category_code); o.detail_category_name = t ? t.name : ''; if (!o.record_kind) o.record_kind = 'symptom_detail'; }
    if (kind === 'receipt-summary-comments') o.output_position_label = o.output_position === 'lower' ? '摘要欄下部' : '摘要欄上部';
    if (kind === 'receipt-symptom-details' || kind === 'receipt-summary-comments') o.target_insurance_label = targetLabel(o.target_insurance_id, row);
    if (kind === 'receipt-copayments') { o.calculated_insurance_amount = 0; o.difference_amount = 0; if (!o.copayment_category) o.copayment_category = '00'; }
    return o;
  }
  function targetLabel(id, row) {
    if (!id) return '社保・国保';
    const r = (row && Array.isArray(row.rousai) ? row.rousai : []).find((x) => String(x.id) === String(id));
    const i = arr(row, 'insurances').find((x) => String(x.id) === String(id));
    const from = (r && r.startDate) || (i && i.validFrom) || '', until = (r && r.endDate) || (i && i.validUntil) || '';
    const prefix = r || (i && LABOR.includes(i.insuranceType)) ? '労災 ' + ((r && (r.benefitType === 'injury_pension' || (r.pensionNo && !r.no))) ? '傷病年金' : '短期') : (i && AUTO.includes(i.insuranceType)) ? '自賠責' : '対象保険';
    return from ? prefix + ' ' + String(from).replace(/-/g, '/') + '〜' + (until ? String(until).replace(/-/g, '/') : '') : prefix;
  }
  // 配列がまだ無い患者（統合版の従来の項目だけの患者）は、従来の項目から1件ぶんを見せる。保存したときに配列の1件になる
  const LEGACY = /-legacy-(ins|pe)$/;
  function legacyItems(kind, row) {
    if (kind === 'insurances' && !arr(row, 'insurances').length && (row.insurer_number || row.ins_number)) {
      const label = String(row.insurance_type || ''), n = digits(row.insurer_number);
      const type = /後期/.test(label) ? 'elderly' : /国保/.test(label) ? 'national' : /自費/.test(label) ? 'self_pay' : n.length === 6 ? 'national' : n.startsWith('39') ? 'elderly' : 'social';
      const ratio = Number(row.copay_rate);
      return [{ id: row.id + '-legacy-ins', insuranceType: type, insurerNumber: n, symbol: row.ins_symbol || '', number: row.ins_number || '', branchNumber: row.ins_edaban || '',
        relationship: /家族|被扶養/.test(String(row.relationship || '')) ? 'family' : 'main', burdenRatio: isNaN(ratio) || !row.copay_rate ? 30 : Math.round(ratio * 100), isPrimary: true, isActive: true }];
    }
    if (kind === 'public-expenses' && !arr(row, 'publicExpenses').length && (row.kouhi_number || row.recipient_number)) {
      const payer = digits(row.kouhi_number);
      return [{ id: row.id + '-legacy-pe', type: '', typeCode: payer.slice(0, 2), payerNumber: payer, recipientNumber: digits(row.recipient_number), confirmLater: !row.recipient_number, claimTarget: 'medical', prescriptionClaimTarget: 'same_as_medical', priority: 1, isActive: true }];
    }
    return [];
  }
  async function listOf(kind, row) {
    const key = KINDS[kind].key;
    const items = arr(row, key).concat(legacyItems(kind, row)).map((x) => toBase(kind, x, row.id));
    if (kind === 'insurances') {
      const have = new Set(items.map((x) => String(x.id)));
      (Array.isArray(row.rousai) ? row.rousai : []).forEach((r) => { if (!r.id) r.id = uid(); if (!have.has(String(r.id))) items.push(rousaiToBase(r, row.id)); });
    }
    return Promise.all(items.map((o) => decorate(kind, o, row)));
  }

  // ---- 選択肢 ----
  on('GET', /^\/insurances\/types$/, async () => (await mastersOf()).insurance_types);
  on('GET', /^\/insurances\/public-expense-types$/, async () => (await mastersOf()).public_expense_types);
  on('GET', /^\/insurances\/receipt-special-notes\/types$/, async () => (await mastersOf()).special_note_types);
  on('GET', /^\/insurances\/receipt-symptom-details\/types$/, async () => (await mastersOf()).symptom_detail_types);
  on('GET', /^\/insurances\/public-expense-municipality-rules$/, async () => []);
  on('GET', /^\/insurances\/national-public-expenses$/, async () => []);
  on('GET', /^\/insurances\/public-expense-defaults$/, async (m, q) => {
    const t = (await mastersOf()).public_expense_types.find((x) => x.type_code === q.get('expense_type')) || {};
    return { expense_type: q.get('expense_type'), burden_ratio: t.default_burden_ratio ?? null, monthly_limit: t.default_monthly_limit ?? null, daily_limit: t.default_daily_limit ?? null,
      per_visit_limit: t.default_per_visit_limit ?? null, count_limit_per_day: t.default_count_limit_per_day ?? null, count_limit_per_month: t.default_count_limit_per_month ?? null,
      day_limit_per_month: t.default_day_limit_per_month ?? null, claim_target: t.claim_target || 'medical', prescription_claim_target: t.prescription_claim_target || 'same_as_medical', rule: null };
  });
  on('GET', /^\/insurances\/patient\/([^/]+)\/receipt-copayments\/reference$/, async () => ({ calculated_insurance_amount: 0 }));

  // ---- 患者ごとの一覧・追加 ----
  const PATIENT_KIND = /^\/insurances\/patient\/([^/]+)(?:\/(public-expenses|receipt-special-notes|receipt-symptom-details|receipt-summary-comments|welfare-invoice-comments|receipt-copayments))?$/;
  on('GET', PATIENT_KIND, async (m, q) => {
    const kind = m[2] || 'insurances'; const row = await loadPatient(m[1]); if (!row) return [];
    return (await listOf(kind, row)).filter((x) => passFilter(x, q));
  });
  on('POST', PATIENT_KIND, async (m, q, body) => {
    const kind = m[2] || 'insurances'; const row = await loadPatient(m[1]); if (!row) return err(404, '患者が見つかりません');
    const key = KINDS[kind].key, extra = Object.assign({}, row.receipt_extra || {});
    const now = new Date().toISOString();
    if (kind === 'insurances' && LABOR.includes(String(body.insurance_type || '').toLowerCase())) {
      const r = rousaiFromBase(body, { id: uid() }); const rs = (row.rousai || []).concat([r]);
      await savePatient(row, extra, rs); return new Response(JSON.stringify(await decorate(kind, rousaiToBase(r, row.id), row)), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    const item = Object.assign(fromBase(kind, body), { id: uid(), isActive: true, createdAt: now, updatedAt: now });
    if (kind === 'insurances' && item.isPrimary !== false && !AUTO.includes(item.insuranceType)) (extra.insurances || []).forEach((i) => { if (!LABOR.includes(i.insuranceType) && !AUTO.includes(i.insuranceType)) i.isPrimary = false; });
    if (kind === 'insurances' && AUTO.includes(item.insuranceType)) item.isPrimary = false;
    extra[key] = (Array.isArray(extra[key]) ? extra[key] : []).concat([item]);
    await savePatient(row, extra);
    return new Response(JSON.stringify(await decorate(kind, toBase(kind, item, row.id), Object.assign({}, row, { receipt_extra: extra }))), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });

  // ---- 1件の取得・更新・削除 ----
  const ITEM = /^\/insurances\/(?:(public-expenses|receipt-special-notes|receipt-symptom-details|receipt-summary-comments|welfare-invoice-comments|receipt-copayments)\/)?([0-9a-zA-Z-]{8,})$/;
  async function locate(m) {
    const kind = m[1] || 'insurances', id = decodeURIComponent(m[2]);
    const row = await findOwner(kind, id); if (!row) return { kind, id };
    const rs = Array.isArray(row.rousai) ? row.rousai : [];
    const ri = kind === 'insurances' ? rs.findIndex((x) => String(x.id) === id) : -1;
    return { kind, id, row, rs, ri };
  }
  on('GET', ITEM, async (m) => {
    const L = await locate(m); if (!L.row) return err(404, '見つかりません');
    const one = (await listOf(L.kind, L.row)).find((x) => String(x.id) === L.id);
    return one || err(404, '見つかりません');
  });
  on('GET', /^\/insurances\/([^/]+)\/history$/, async () => []);
  on('PUT', ITEM, async (m, q, body) => {
    const L = await locate(m); if (!L.row) return err(404, '見つかりません');
    const key = KINDS[L.kind].key, extra = Object.assign({}, L.row.receipt_extra || {});
    if (L.ri >= 0 || (L.kind === 'insurances' && LABOR.includes(String(body.insurance_type || '').toLowerCase()))) {
      const rs = L.rs.slice(); const prev = L.ri >= 0 ? rs[L.ri] : { id: L.id };
      const r = rousaiFromBase(body, prev); if (L.ri >= 0) rs[L.ri] = r; else rs.push(r);
      if (L.ri < 0) extra.insurances = (extra.insurances || []).filter((x) => String(x.id) !== L.id);   // 医療保険から労災へ種別を変えたとき
      await savePatient(L.row, extra, rs); return decorate('insurances', rousaiToBase(r, L.row.id), L.row);
    }
    let list = (extra[key] || []).slice();
    if (LEGACY.test(L.id) && !list.some((x) => String(x.id) === L.id)) { const lg = legacyItems(L.kind, L.row).find((x) => x.id === L.id); if (lg) list = list.concat([Object.assign({}, lg, { id: uid() })]); L.id = list.length ? list[list.length - 1].id : L.id; }
    const i = list.findIndex((x) => String(x.id) === L.id); if (i < 0) return err(404, '見つかりません');
    list[i] = Object.assign({}, list[i], fromBase(L.kind, body), { id: L.id, updatedAt: new Date().toISOString() });
    extra[key] = list; await savePatient(L.row, extra);
    return decorate(L.kind, toBase(L.kind, list[i], L.row.id), Object.assign({}, L.row, { receipt_extra: extra }));
  });
  on('DELETE', ITEM, async (m) => {
    const L = await locate(m); if (!L.row) return err(404, '見つかりません');
    const key = KINDS[L.kind].key, extra = Object.assign({}, L.row.receipt_extra || {});
    if (L.ri >= 0) { const rs = L.rs.filter((x, j) => j !== L.ri); await savePatient(L.row, extra, rs); return new Response(null, { status: 204 }); }
    extra[key] = (extra[key] || []).filter((x) => String(x.id) !== L.id);
    if (L.kind === 'public-expenses') extra[key].slice().sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99)).forEach((x, j) => { x.priority = j + 1; });
    await savePatient(L.row, extra); return new Response(null, { status: 204 });
  });
})();
