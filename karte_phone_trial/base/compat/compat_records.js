// ===== 置き換え層：診療記録（工程4・2026-09-24） compat_records.js =====
// 基準版の /records/... を統合版の来院・カルテ・処方・算定明細に読み書きする。
//   ・記録 1 件 ＝ 来院（visits）1 件。記録の ID と受付の ID はどちらも来院の ID
//   ・基準版の画面で書いた記録は kartes.base_record に基準版の形のまま残し、統合版の列にも写す
//       主訴 ← S ／ 所見 ← O（A・P も続けて入れる）／処方の表 ← 処方／算定明細（billing_items_used）と来院の点数 ← 行為
//   ・統合版の画面で書いたカルテ（base_record なし）は、統合版の列から基準版の形を組み立てて見せる
//   ・削除は印を付けるだけ（行は消さない）。元に戻せる
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, ready, clinicId } = C;
  const nowIso = () => new Date().toISOString();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n'); return (d.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); };
  const htmlOf = (txt) => esc(txt).replace(/\r?\n/g, '<br>');
  const SELECT = '*,kartes(*),patients(id,patient_no,name,name_kana,sex,dob,insurance_type,receipt_extra),prescriptions(*),billing_items_used(*)';
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const SEX = { '男': 'male', '女': 'female' };

  function insuranceOf(p, d) {
    const act = (x) => x.isActive !== false && (!x.validFrom || String(x.validFrom).slice(0, 10) <= d) && (!x.validUntil || String(x.validUntil).slice(0, 10) >= d);
    const ins = ((p && p.receipt_extra && p.receipt_extra.insurances) || []).filter((i) => !['labor', 'auto'].includes(i.insuranceType) && act(i)).sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))[0];
    if (ins) return { insurance_id: ins.id, insurance_type: ins.insuranceType, burden_ratio: ins.burdenRatio };
    const label = String((p && p.insurance_type) || '');
    return { insurance_id: p ? p.id + '-legacy-ins' : null, insurance_type: /後期/.test(label) ? 'elderly' : /国保/.test(label) ? 'national' : /自費/.test(label) ? 'self_pay' : label ? 'social' : null, burden_ratio: null };
  }
  // 統合版の列 → 基準版の記録
  function synth(v, k) {
    const vs = {}; if (k) { if (k.vitals_temp != null) vs.temperature = Number(k.vitals_temp); if (k.vitals_bp_sys != null) vs.blood_pressure_systolic = k.vitals_bp_sys; if (k.vitals_bp_dia != null) vs.blood_pressure_diastolic = k.vitals_bp_dia; if (k.vitals_pulse != null) vs.pulse = k.vitals_pulse; if (k.vitals_spo2 != null) vs.spo2 = k.vitals_spo2; }
    const rx = (v.prescriptions || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r, i) => ({ id: r.id, drug_code: r.drug_code, drug_name: r.drug_name, dosage: r.quantity != null ? String(r.quantity) : null, unit: r.unit, days: r.days, total_quantity: r.quantity, instructions: r.note, sort_order: i, procedure_order: i }));
    const added = (k && k.receipt_detail && Array.isArray(k.receipt_detail.addedBillingItems)) ? k.receipt_detail.addedBillingItems : [];
    const used = (v.billing_items_used || []);
    const bl = (used.length ? used.map((b) => ({ id: b.id, billing_code: '', billing_name: b.item_name, points: b.points, quantity: b.quantity || 1 }))
      : added.map((b, i) => ({ id: v.id + '-b' + i, billing_code: b.code || '', billing_name: b.name, points: b.points, quantity: 1 })))
      .map((b, i) => Object.assign({ category: null, item_type: 'action', amount: 0, unit_price: 0, is_self_pay: false, comment_codes: [], comments: [], free_comment: null, receipt_position: 'summary', do_not_bill: false, sort_order: i, procedure_order: i }, b));
    return { subjective: (k && k.chief_complaint) || '', objective: k ? textOf(k.findings_html) : '', assessment: '', plan: '', vital_signs: Object.keys(vs).length ? vs : null,
      prescriptions: rx, billings: bl, status: 'draft', version: 1 };
  }
  function recordOf(v, detail) {
    const k = one(v.kartes), p = v.patients || {}, b = (k && k.base_record) || synth(v, k);
    const r = {
      id: v.id, patient_id: v.patient_id, reception_id: v.id, visit_date: v.visit_date, visit_type: b.visit_type || '外来', department: b.department || v.department || '内科',
      subjective: b.subjective || '', objective: b.objective || '', assessment: b.assessment || '', plan: b.plan || '', vital_signs: b.vital_signs || null,
      status: b.status || 'draft', version: b.version || 1, doctor_name: v.doctor || null, patient_no: p.patient_no, patient_name: p.name, patient_kana: p.name_kana, name_kana: p.name_kana,
      gender: SEX[String(p.sex || '').replace(/性$/, '')] || 'other', birth_date: p.dob, is_deleted: !!b.is_deleted, deleted_at: b.deleted_at || null,
      confirmed_at: b.confirmed_at || null, created_at: (k && k.created_at) || v.created_at, updated_at: (k && k.updated_at) || v.created_at,
      created_by_name: null, updated_by_name: null, confirmed_by_name: null, receipt_claim_type: b.receipt_claim_type || 'normal',
    };
    Object.assign(r, insuranceOf(p, v.visit_date));
    if (detail) { r.prescriptions = (b.prescriptions || []).map((x, i) => Object.assign({ id: v.id + '-rx' + i }, x)); r.billings = (b.billings || []).map((x, i) => Object.assign({ id: v.id + '-bl' + i }, x)); }
    return r;
  }
  async function visitById(id) {
    const c = await ready(); const { data, error } = await c.from('visits').select(SELECT).eq('id', id).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message); return data;
  }

  // ---- 保存（基準版の形 → kartes.base_record ＋ 統合版の列） ----
  async function ensureVisit(body) {
    const c = await ready();
    const vid = body.record_id || body.reception_id;
    if (vid) { const v = await visitById(vid); if (v) return v; }
    const { data: ex } = await c.from('visits').select('id').eq('clinic_id', clinicId()).eq('patient_id', body.patient_id).eq('visit_date', body.visit_date).maybeSingle();
    if (ex) return visitById(ex.id);
    // 初診・再診は決めない（空＝自動算定が過去の来院から判定する）
    const { data, error } = await c.from('visits').insert({ clinic_id: clinicId(), patient_id: body.patient_id, visit_date: body.visit_date, department: body.department || '内科', visit_type: null, status: 'in_progress', self_pay: 0, revenue_points: 0 }).select('id').single();
    if (error) throw new Error('来院記録を作れません: ' + error.message);
    return visitById(data.id);
  }
  async function writeRecord(v, patch, opts) {
    const c = await ready(); opts = opts || {};
    const k = one(v.kartes); const prev = (k && k.base_record) || synth(v, k);
    const b = Object.assign({}, prev, patch, { version: (prev.version || 1) + (opts.bump === false ? 0 : 1) });
    const vs = b.vital_signs || {};
    const row = { visit_id: v.id, base_record: b, chief_complaint: b.subjective || null,
      findings_html: [b.objective, b.assessment && ('【A】' + b.assessment), b.plan && ('【P】' + b.plan)].filter(Boolean).map(htmlOf).join('<br>') || null,
      vitals_temp: vs.temperature != null && vs.temperature !== '' ? Number(vs.temperature) : (k ? k.vitals_temp : null),
      vitals_bp_sys: vs.blood_pressure_systolic != null ? parseInt(vs.blood_pressure_systolic, 10) || null : (k ? k.vitals_bp_sys : null),
      vitals_bp_dia: vs.blood_pressure_diastolic != null ? parseInt(vs.blood_pressure_diastolic, 10) || null : (k ? k.vitals_bp_dia : null),
      vitals_pulse: vs.pulse != null ? parseInt(vs.pulse, 10) || null : (k ? k.vitals_pulse : null), vitals_spo2: vs.spo2 != null ? parseInt(vs.spo2, 10) || null : (k ? k.vitals_spo2 : null),
      updated_at: nowIso() };
    const { error } = await c.from('kartes').upsert(row, { onConflict: 'visit_id' }); if (error) throw new Error('カルテ保存失敗: ' + error.message);
    if (opts.rx) {
      const { data: old } = await c.from('prescriptions').select('id').eq('visit_id', v.id);
      const rows = (b.prescriptions || []).map((x, i) => ({ visit_id: v.id, drug_name: x.drug_name, drug_code: /^\d{9}$/.test(String(x.drug_code || '')) ? String(x.drug_code) : null,
        quantity: Number(x.total_quantity != null ? x.total_quantity : x.dosage) || 0, unit: x.unit || null, days: x.days || null, sort_order: i, note: [x.frequency, x.instructions].filter(Boolean).join(' ') || null }));
      if (rows.length) { const { error: e } = await c.from('prescriptions').insert(rows); if (e) throw new Error('処方保存失敗: ' + e.message); }
      if (old && old.length) await c.from('prescriptions').delete().in('id', old.map((x) => x.id));
    }
    if (opts.billing) {
      const { data: old } = await c.from('billing_items_used').select('id').eq('visit_id', v.id);
      const rows = (b.billings || []).filter((x) => x.billing_name && !x.do_not_bill && !x.is_self_pay).map((x) => ({ visit_id: v.id, item_name: x.billing_name, points: Math.round(Number(x.points) || 0), quantity: Math.max(1, Math.round(Number(x.quantity) || 1)) }));
      if (rows.length) { const { error: e } = await c.from('billing_items_used').insert(rows); if (e) throw new Error('算定明細の保存失敗: ' + e.message); }
      if (old && old.length) await c.from('billing_items_used').delete().in('id', old.map((x) => x.id));
      await c.from('visits').update({ revenue_points: rows.reduce((s, x) => s + x.points * x.quantity, 0) }).eq('id', v.id);
    }
    return b;
  }
  const SOAP = ['visit_type', 'department', 'subjective', 'objective', 'assessment', 'plan', 'vital_signs'];
  const pick = (o, keys) => { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };

  // ---- 一覧・取得 ----
  async function listRecords(q, deleted) {
    const c = await ready();
    let r = c.from('visits').select(SELECT.replace('kartes(*)', 'kartes!inner(*)')).eq('clinic_id', clinicId()).order('visit_date', { ascending: false }).limit(Number(q.get('limit') || 50));
    if (q.get('patient_id')) r = r.eq('patient_id', q.get('patient_id'));
    if (q.get('reception_id')) r = r.eq('id', q.get('reception_id'));
    if (q.get('visit_date')) r = r.eq('visit_date', q.get('visit_date'));
    const { data, error } = await r; if (error) throw new Error(error.message);
    return (data || []).map((v) => recordOf(v, false)).filter((x) => !!x.is_deleted === !!deleted && (!q.get('status') || x.status === q.get('status')));
  }
  on('GET', /^\/records$/, async (m, q) => ({ data: await listRecords(q, false) }));
  on('GET', /^\/records\/deleted$/, async (m, q) => ({ data: await listRecords(q, true) }));
  on('GET', /^\/records\/drug-price\/([^/]+)$/, async () => ({ price: null }));
  on('GET', /^\/records\/([0-9a-f-]{36})$/, async (m, q) => {
    const v = await visitById(m[1]); if (!v || !one(v.kartes)) return err(404, 'カルテが見つかりません');
    const r = recordOf(v, true); if (r.is_deleted && q.get('include_deleted') !== 'true') return err(404, 'カルテが見つかりません');
    return r;
  });
  on('GET', /^\/records\/([0-9a-f-]{36})\/versions$/, async () => []);
  on('GET', /^\/records\/([0-9a-f-]{36})\/prescriptions$/, async (m) => { const v = await visitById(m[1]); return v ? recordOf(v, true).prescriptions : []; });

  // ---- 院内処方の薬剤料（基準版サーバーの canonical_internal_drug_fees を写したもの） ----
  //   院内の処方を剤形・日数・用法でまとめ、公式薬価×使用量から薬剤料の行（item_type=drug）を作って行為一覧に足す。
  //   処方の総量と用量・日数、処方単位と薬価単位が合わないときは基準版と同じく保存を止める（400）
  let drugOfficial = null;
  async function officialDrugs() { if (!drugOfficial) { drugOfficial = ((await C.masterJson('drug_official')) || {}).rows || {}; } return drugOfficial; }
  const normName = (s) => String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '');
  const round6 = (x) => Math.round(x * 1e6) / 1e6;
  function drugPoints(price) { price = round6(Number(price) || 0); if (price <= 0) return 0; return price <= 15 ? 1 : 1 + Math.ceil(round6((price - 15) / 10)); }
  async function drugPriceForDate(code, date) {
    const row = (await officialDrugs())[String(code)]; const day = String(date).replace(/-/g, '').slice(0, 8);
    if (!row || !(row[3] <= day && day <= row[4])) throw new Error('診療日 ' + date + ' に適用できる公式薬価がありません: ' + code);
    return { price: Number(row[0]), unit: row[1], drug_type: { 1: '内服', 4: '注射', 6: '外用' }[row[2]] || '' };
  }
  async function internalDrugFees(prescriptions, date) {
    const groups = new Map(), normalized = [];
    for (let index = 0; index < prescriptions.length; index++) {
      const rx = Object.assign({}, prescriptions[index]);
      if (!['院内', 'internal', 'inhouse', 'in-house'].includes(String(rx.dispensing_type || rx.prescription_type || ''))) { normalized.push(rx); continue; }
      const master = await drugPriceForDate(rx.drug_code, date);
      const kind = rx.drug_type || master.drug_type; const days = parseInt(rx.days || 1, 10);
      if (days < 1) throw new Error('処方日数・回数は1以上で入力してください');
      let total = Number(rx.total_quantity || 0);
      const dm = String(rx.dosage || '').match(/^\s*(\d+(?:\.\d+)?)/); const dose = dm ? Number(dm[1]) : 0;
      const frequency = String(rx.frequency || ''); const tm = frequency.match(/1日\s*(\d+)\s*回/);
      let expected, count;
      if (kind === '外用') { expected = dose; count = 1; } else if (kind === '頓服') { expected = dose * days; count = days; } else { expected = tm ? dose * parseInt(tm[1], 10) * days : total; count = days; }
      expected = round6(expected);
      if (total <= 0) total = expected;
      if (total <= 0 || (expected > 0 && Math.abs(total - expected) > 0.00001)) throw new Error('処方総量と用量・日数が一致しません: ' + rx.drug_name);
      if (rx.unit && normName(rx.unit) !== normName(master.unit)) throw new Error('薬価単位と処方単位が一致しません: ' + rx.drug_name + '（' + master.unit + '）');
      const quantity = round6(total / count);
      Object.assign(rx, { unit_price: master.price, drug_price: master.price, total_price: round6(master.price * total), total_quantity: total, unit: master.unit });
      normalized.push(rx);
      const key = kind === '内服' ? [String(rx.prescription_group_id || index), kind, count, frequency].join('\u0001') : [String(index), kind, count, frequency].join('\u0001');
      if (!groups.has(key)) groups.set(key, { kind, count, members: [] });
      groups.get(key).members.push([rx, quantity, master.price]);
    }
    const fees = []; let gi = 0;
    for (const g of groups.values()) {
      const points = drugPoints(g.members.reduce((s, m) => s + m[1] * m[2], 0)); const group = 'rx:' + gi++;
      g.members.forEach(([rx, quantity], pos) => {
        const head = pos < g.members.length - 1;
        fees.push({ billing_code: rx.drug_code, billing_name: '薬剤料（院内）：' + rx.drug_name, points: head ? 0 : points, quantity: g.count, category: g.kind, item_type: 'drug',
          drug_quantity: quantity, drug_unit: rx.unit, billing_group_id: group, billing_group_parent_id: head ? group : null, comments: rx.comments || [], comment_codes: rx.comment_codes || [] });
      });
    }
    return { prescriptions: normalized, fees };
  }

  // ---- 保存 ----
  async function save(body) {
    // 基準版サーバーと同じく、院内処方の薬剤料を作り直して行為一覧に足す（前回の「薬剤料（院内）」の行は入れ替え）
    try {
      const r = await internalDrugFees(body.prescriptions || [], body.visit_date);
      body = Object.assign({}, body, { prescriptions: r.prescriptions,
        billings: (body.billings || []).filter((b) => !(b.item_type === 'drug' && String(b.billing_name || '').startsWith('薬剤料（院内）'))).concat(r.fees) });
    } catch (e) { return err(400, e.message); }
    const v = await ensureVisit(body);
    // 基準版と同じく、入金済みの会計がある記録は算定を変えさせない
    const kb = one(v.kartes) && one(v.kartes).base_record;
    if (kb && kb.billing && kb.billing.is_active !== false && Number(kb.billing.paid_amount) > 0) return err(400, '入金済み会計があるため算定を変更できません');
    const patch = Object.assign(pick(body, SOAP), { prescriptions: body.prescriptions || [], billings: body.billings || [], status: 'confirmed', confirmed_at: nowIso() },
      pick(body, ['insurance_id', 'public_expense_id', 'public_expense_1_id', 'public_expense_2_id', 'public_expense_3_id']));   // 選んだ保険・公費（会計の計算に使う）
    if (body.receipt_claim_type) patch.receipt_claim_type = body.receipt_claim_type;
    await writeRecord(v, patch, { rx: true, billing: true });
    if (C.projectDiagnosesForVisit) await C.projectDiagnosesForVisit(v.patient_id, { id: v.id, visit_date: v.visit_date });   // その日に有効な傷病名を来院の病名へ
    return { id: v.id, reception_id: v.id, billing_id: v.id, message: 'カルテを保存しました' };
  }
  on('POST', /^\/records\/save\/?$/, async (m, q, body) => save(body));
  on('PUT', /^\/records\/save\/?$/, async (m, q, body) => save(body));
  on('POST', /^\/records$/, async (m, q, body) => {
    const v = await ensureVisit(body); await writeRecord(v, Object.assign(pick(body, SOAP), { status: 'draft' }), { bump: false });
    return recordOf(await visitById(v.id), true);
  });
  on('PUT', /^\/records\/([0-9a-f-]{36})$/, async (m, q, body) => {
    const v = await visitById(m[1]); if (!v) return err(404, 'カルテが見つかりません');
    await writeRecord(v, pick(body, SOAP)); return recordOf(await visitById(v.id), true);
  });
  on('POST', /^\/records\/([0-9a-f-]{36})\/confirm$/, async (m) => {
    const v = await visitById(m[1]); if (!v || !one(v.kartes)) return err(404, 'カルテが見つかりません');
    await writeRecord(v, { status: 'confirmed', confirmed_at: nowIso() }, { bump: false }); return { message: 'カルテを確定しました' };
  });
  on('DELETE', /^\/records\/([0-9a-f-]{36})$/, async (m) => {
    const v = await visitById(m[1]); if (!v || !one(v.kartes)) return err(404, 'カルテが見つかりません');
    await writeRecord(v, { is_deleted: true, deleted_at: nowIso() }, { bump: false }); return { message: 'カルテを削除しました' };
  });
  on('POST', /^\/records\/([0-9a-f-]{36})\/restore$/, async (m) => {
    const v = await visitById(m[1]); if (!v || !one(v.kartes)) return err(404, 'カルテが見つかりません');
    await writeRecord(v, { is_deleted: false, deleted_at: null }, { bump: false }); return { message: 'カルテを復元しました' };
  });
  // 処方・行為を足す（保存確定の前に個別に足す操作）
  on('POST', /^\/records\/([0-9a-f-]{36})\/prescriptions$/, async (m, q, body) => {
    const v = await visitById(m[1]); if (!v) return err(404, 'カルテが見つかりません');
    const cur = recordOf(v, true).prescriptions.map(({ id, ...x }) => x); const add = Array.isArray(body) ? body : (body.prescriptions || [body]);
    await writeRecord(v, { prescriptions: cur.concat(add) }, { rx: true }); return recordOf(await visitById(v.id), true).prescriptions;
  });
  on('POST', /^\/records\/([0-9a-f-]{36})\/billings$/, async (m, q, body) => {
    const v = await visitById(m[1]); if (!v) return err(404, 'カルテが見つかりません');
    const cur = recordOf(v, true).billings.map(({ id, ...x }) => x); const add = Array.isArray(body) ? body : (body.billings || [body]);
    await writeRecord(v, { billings: cur.concat(add) }, { billing: true }); return recordOf(await visitById(v.id), true).billings;
  });
  // 日常業務の書き込み（compat_writes_daily.js：Do 処方・処方の削除・行為の追加削除）が同じ保存処理を使えるように出しておく
  C.records = { visitById, writeRecord, recordOf, synth, internalDrugFees, one };
})();
