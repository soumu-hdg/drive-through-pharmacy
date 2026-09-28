// ===== 置き換え層：傷病名（工程4・2026-09-24） compat_diagnoses.js =====
// 基準版の傷病名は「患者ごと」に続く一覧、統合版の病名は「来院ごと」の写し（diseases_assigned）。
//   ・基準版の画面で登録した傷病名は patients.receipt_extra.baseDiagnoses に基準版の形で置く（患者ごと）
//   ・カルテを保存したとき・傷病名を変えたとき、その来院日に有効な傷病名を来院の病名（diseases_assigned）へ写す
//       → UKE（SY）・適応症の突合・月次の集計は従来どおり来院の病名から作れる
//   ・まだ baseDiagnoses が無い患者は、来院の病名から患者ごとの一覧を組み立てて見せる（最初に書いたときに一覧になる）
//   ・傷病名マスターの検索は統合版の公式マスター（master/b_diseases.json・z_modifiers.json）
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, ready, clinicId, realFetch } = C;
  const nowIso = () => new Date().toISOString();
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const M = {};
  async function master(name) {
    if (!M[name]) {
      const all = JSON.parse(JSON.stringify((await C.masterJson(name)) || {}));
      Object.keys(all).forEach((k) => { if (all[k] && typeof all[k] === 'object') all[k].name = C.cp932Name(all[k].name); else all[k] = C.cp932Name(all[k]); });   // 記号を基準版の読み方に
      M[name] = all;
    }
    return M[name];
  }
  const OUT_TO_OURS = { continuing: null, cured: '治癒', died: '死亡', discontinued: '中止', transferred: '転医', other: '中止' };
  const OURS_TO_OUT = { '治癒': 'cured', '治ゆ': 'cured', '死亡': 'died', '中止': 'discontinued', '転医': 'transferred', '移行': 'transferred', '2': 'cured', '3': 'died', '4': 'discontinued' };

  async function loadPatient(pid) {
    const c = await ready();
    const { data, error } = await c.from('patients').select('id,clinic_id,receipt_extra').eq('id', pid).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message); return data;
  }
  // 来院の病名 → 患者ごとの一覧（同じ病名は一番新しい来院の属性を採る）
  async function fromVisits(pid) {
    const c = await ready();
    const { data } = await c.from('visits').select('id,visit_date,diseases_assigned(*)').eq('clinic_id', clinicId()).eq('patient_id', pid).order('visit_date', { ascending: true });
    const by = new Map();
    (data || []).forEach((v) => (v.diseases_assigned || []).forEach((d) => {
      const key = (d.disease_code || '') + '|' + d.disease_name;
      const prev = by.get(key);
      by.set(key, { id: prev ? prev.id : d.id, recordId: v.id, diagnosisCode: d.disease_code || null, diagnosisName: d.disease_name, fullName: d.disease_name,
        diagnosisCategory: d.is_main ? 'main' : 'sub', isSuspected: d.status === 'suspected', startDate: d.start_date || (prev && prev.startDate) || v.visit_date,
        endDate: null, outcome: OURS_TO_OUT[d.outcome] || (d.outcome ? 'other' : null), prefixModifiers: (d.modifier_codes || []).filter((x) => x !== '8002').map((code) => ({ code, name: '' })), suffixModifiers: [],
        receiptComment: d.supplement || null, isActive: true, createdAt: d.created_at, updatedAt: d.created_at });
    }));
    return [...by.values()];
  }
  async function listOf(row) {
    const ex = row.receipt_extra && Array.isArray(row.receipt_extra.baseDiagnoses) ? row.receipt_extra.baseDiagnoses : null;
    return ex || fromVisits(row.id);
  }
  async function toBase(d, pid) {
    const zm = await master('z_modifiers');
    const mods = (l) => (l || []).map((x) => ({ code: x.code, name: x.name || zm[x.code] || '' }));
    const pre = mods(d.prefixModifiers), suf = mods(d.suffixModifiers);
    const name = d.diagnosisName || '';
    return { id: d.id, patient_id: pid, record_id: d.recordId || null, facility_id: clinicId(), diagnosis_code: d.diagnosisCode || null, diagnosis_name: name,
      department: d.department || '内科', visit_type: d.visitType || 'outpatient', insurance_scope: d.insuranceScope || null, insurance_none: !!d.insuranceNone, icd10_code: d.icd10Code || null,
      prefix_modifiers: pre, suffix_modifiers: suf, full_name: d.fullName && d.fullName !== name ? d.fullName : pre.map((x) => x.name).join('') + name + suf.map((x) => x.name).join(''),
      diagnosis_category: d.diagnosisCategory || 'sub', is_suspected: !!d.isSuspected, is_acute: !!d.isAcute, onset_date: d.onsetDate || null, start_date: d.startDate || today(),
      end_date: d.endDate || null, outcome: d.outcome || null, exclude_outpatient_admin: !!d.excludeOutpatientAdmin, receipt_comment: d.receiptComment || null,
      sort_order: d.sortOrder || 0, is_active: d.isActive !== false, created_at: d.createdAt || nowIso(), updated_at: d.updatedAt || d.createdAt || nowIso() };
  }
  const IN = { diagnosis_code: 'diagnosisCode', diagnosis_name: 'diagnosisName', full_name: 'fullName', department: 'department', visit_type: 'visitType', insurance_scope: 'insuranceScope',
    insurance_none: 'insuranceNone', icd10_code: 'icd10Code', prefix_modifiers: 'prefixModifiers', suffix_modifiers: 'suffixModifiers', diagnosis_category: 'diagnosisCategory',
    is_suspected: 'isSuspected', is_acute: 'isAcute', onset_date: 'onsetDate', start_date: 'startDate', end_date: 'endDate', outcome: 'outcome',
    exclude_outpatient_admin: 'excludeOutpatientAdmin', receipt_comment: 'receiptComment', record_id: 'recordId', sort_order: 'sortOrder' };
  const fromBase = (b) => { const o = {}; Object.keys(IN).forEach((k) => { if (b[k] !== undefined) o[IN[k]] = b[k]; }); return o; };
  async function saveList(row, list, fromDate) {
    const c = await ready(); const extra = Object.assign({}, row.receipt_extra || {}, { baseDiagnoses: list });
    const { error } = await c.from('patients').update({ receipt_extra: extra }).eq('id', row.id).eq('clinic_id', clinicId());
    if (error) throw new Error(error.message);
    row.receipt_extra = extra;
    await projectAll(row, fromDate);
  }
  // その来院日に有効な傷病名 → 来院の病名（diseases_assigned）
  const activeOn = (d, date) => d.isActive !== false && (!d.startDate || String(d.startDate).slice(0, 10) <= date) && (!d.endDate || String(d.endDate).slice(0, 10) >= date);
  async function projectVisit(row, visit) {
    const c = await ready(); const list = (await listOf(row)).filter((d) => activeOn(d, visit.visit_date));
    const rows = list.map((d) => ({ visit_id: visit.id, disease_code: d.diagnosisCode || null, disease_name: d.fullName || d.diagnosisName, is_main: d.diagnosisCategory === 'main',
      status: d.isSuspected ? 'suspected' : 'confirmed', start_date: d.startDate || null,
      outcome: d.endDate && String(d.endDate).slice(0, 10) <= visit.visit_date ? (OUT_TO_OURS[d.outcome] || null) : null,
      modifier_codes: [].concat((d.prefixModifiers || []).map((x) => x.code), (d.suffixModifiers || []).map((x) => x.code)).filter(Boolean).length ? [].concat((d.prefixModifiers || []).map((x) => x.code), (d.suffixModifiers || []).map((x) => x.code)).filter(Boolean) : null,
      supplement: d.receiptComment || null }));
    const { data: old } = await c.from('diseases_assigned').select('id').eq('visit_id', visit.id);
    if (rows.length) { const { error } = await c.from('diseases_assigned').insert(rows); if (error) throw new Error('病名の保存失敗: ' + error.message); }
    if (old && old.length) await c.from('diseases_assigned').delete().in('id', old.map((x) => x.id));
  }
  // 基準版の一覧を持つ患者だけ、変えた傷病名の開始日（転帰なら終了日）以降の来院へ写し直す
  //   それより前の来院（提出済みの月など）の病名は触らない。統合版の画面だけの患者も触らない
  async function projectAll(row, fromDate) {
    if (!(row.receipt_extra && Array.isArray(row.receipt_extra.baseDiagnoses))) return;
    const c = await ready();
    let r = c.from('visits').select('id,visit_date,kartes!inner(id)').eq('clinic_id', clinicId()).eq('patient_id', row.id);
    if (fromDate) r = r.gte('visit_date', String(fromDate).slice(0, 10));
    const { data } = await r;
    for (const v of data || []) await projectVisit(row, v);
  }
  C.projectDiagnosesForVisit = async (pid, visit) => { const row = await loadPatient(pid); if (row && row.receipt_extra && Array.isArray(row.receipt_extra.baseDiagnoses)) await projectVisit(row, visit); };

  async function ownerOf(id) {
    const c = await ready();
    const { data } = await c.from('patients').select('id,clinic_id,receipt_extra').eq('clinic_id', clinicId()).contains('receipt_extra', { baseDiagnoses: [{ id }] }).limit(1);
    if (data && data[0]) return data[0];
    const { data: d2 } = await c.from('diseases_assigned').select('id,visits(patient_id,clinic_id)').eq('id', id).maybeSingle();
    return d2 && d2.visits && d2.visits.clinic_id === clinicId() ? loadPatient(d2.visits.patient_id) : null;
  }
  async function materialized(row) { return (await listOf(row)).map((d) => Object.assign({}, d)); }

  // ---- マスター ----
  on('GET', /^\/diagnoses\/master\/search$/, async (m, q) => {
    const kw = C.cp932Name((q.get('q') || '').trim()), lim = Number(q.get('limit') || 20); if (!kw) return [];
    const all = await master('b_diseases'); const hits = [];
    for (const code of Object.keys(all)) { const e = all[code]; if (e.name.includes(kw) || code === kw) { hits.push({ disease_code: code, name: e.name, name_kana: null, icd10_code: e.icd || null, is_active: true }); } }
    hits.sort((a, b) => (a.name.startsWith(kw) ? 0 : 1) - (b.name.startsWith(kw) ? 0 : 1) || a.name.length - b.name.length);
    return hits.slice(0, lim);
  });
  on('GET', /^\/diagnoses\/modifiers\/search$/, async (m, q) => {
    const kw = C.cp932Name((q.get('q') || '').trim()), lim = Number(q.get('limit') || 20); const all = await master('z_modifiers');
    return Object.keys(all).filter((c) => !kw || all[c].includes(kw) || c === kw).slice(0, lim).map((c) => ({ code: c, name: all[c], name_kana: null, modifier_type: Number(c) >= 8000 ? 'suffix' : 'prefix', category: null }));
  });
  on('GET', /^\/diagnoses\/master\/([0-9]{7})$/, async (m) => {
    const e = (await master('b_diseases'))[m[1]]; if (!e) return err(404, '見つかりません');
    return { id: m[1], disease_code: m[1], name: e.name, name_kana: null, icd10_code: e.icd || null, is_single_use: true, is_main_disease: true, is_active: true };
  });

  // ---- 患者ごとの一覧・来院ごとの一覧 ----
  on('GET', /^\/diagnoses\/patient\/([0-9a-f-]{36})$/, async (m, q) => {
    const row = await loadPatient(m[1]); if (!row) return err(404, '患者が見つかりません');
    const activeOnly = q.get('active_only') !== 'false', inclEnded = q.get('include_ended') === 'true', cat = q.get('category');
    const items = (await Promise.all((await listOf(row)).map((d) => toBase(d, row.id))))
      .filter((d) => (!activeOnly || d.is_active) && (inclEnded || !d.end_date) && (!cat || d.diagnosis_category === cat))
      .sort((a, b) => (a.diagnosis_category === 'main' ? 0 : 1) - (b.diagnosis_category === 'main' ? 0 : 1) || a.sort_order - b.sort_order || String(b.start_date).localeCompare(String(a.start_date)));
    return { items, total: items.length };
  });
  on('GET', /^\/diagnoses\/record\/([0-9a-f-]{36})$/, async (m) => {
    const c = await ready(); const { data: v } = await c.from('visits').select('patient_id,visit_date').eq('id', m[1]).eq('clinic_id', clinicId()).maybeSingle();
    if (!v) return { items: [], total: 0 };
    const row = await loadPatient(v.patient_id);
    const items = await Promise.all((await listOf(row)).filter((d) => activeOn(d, v.visit_date)).map((d) => toBase(d, row.id)));
    return { items, total: items.length };
  });

  // ---- 追加・更新・転帰・並べ替え・削除 ----
  on('POST', /^\/diagnoses\/?$/, async (m, q, body) => {
    const row = await loadPatient(body.patient_id); if (!row) return err(404, '患者が見つかりません');
    const list = await materialized(row);
    const d = Object.assign(fromBase(body), { id: crypto.randomUUID(), isActive: true, createdAt: nowIso(), updatedAt: nowIso(), sortOrder: list.length });
    list.push(d); await saveList(row, list, d.startDate || today());
    return new Response(JSON.stringify(await toBase(d, row.id)), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });
  async function editOne(id, fn) {
    const row = await ownerOf(id); if (!row) return err(404, '傷病名が見つかりません');
    const list = await materialized(row); const i = list.findIndex((x) => String(x.id) === String(id)); if (i < 0) return err(404, '傷病名が見つかりません');
    const before = Object.assign({}, list[i]);
    const res = fn(list, i); const after = list[i] && String(list[i].id) === String(id) ? list[i] : before;
    const dates = [before.startDate, after.startDate, after.endDate].filter(Boolean).map((x) => String(x).slice(0, 10)).sort();
    await saveList(row, list, dates[0] || today());
    return res === undefined ? toBase(list[i], row.id) : res;
  }
  on('GET', /^\/diagnoses\/([0-9a-f-]{36})$/, async (m) => { const row = await ownerOf(m[1]); if (!row) return err(404, '傷病名が見つかりません'); const d = (await listOf(row)).find((x) => String(x.id) === m[1]); return d ? toBase(d, row.id) : err(404, '傷病名が見つかりません'); });
  on('PUT', /^\/diagnoses\/([0-9a-f-]{36})$/, async (m, q, body) => editOne(m[1], (l, i) => { Object.assign(l[i], fromBase(body), { updatedAt: nowIso() }); }));
  on('POST', /^\/diagnoses\/([0-9a-f-]{36})\/outcome$/, async (m, q, body) => editOne(m[1], (l, i) => { Object.assign(l[i], { outcome: body.outcome || l[i].outcome, endDate: body.end_date || body.outcome_date || today(), updatedAt: nowIso() }); }));
  on('PUT', /^\/diagnoses\/([0-9a-f-]{36})\/sort-order$/, async (m, q, body) => editOne(m[1], (l, i) => { l[i].sortOrder = Number(body.sort_order || 0); }));
  on('GET', /^\/diagnoses\/([0-9a-f-]{36})\/versions$/, async () => []);
  on('DELETE', /^\/diagnoses\/([0-9a-f-]{36})$/, async (m) => editOne(m[1], (l, i) => { l.splice(i, 1); return new Response(null, { status: 204 }); }));
})();
