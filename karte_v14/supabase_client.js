// ===== Supabase連携モジュール (supabase_client.js) =====
// 電子カルテ v0.5 — Supabase + スプシ両軸構成
//
// 構成:
//   スプシ ←→ Vercel(カルテUI) → Supabase
//   - スプシ: 既存運用DBとして読み書き継続 (db_integration.js)
//   - Supabase: 型付き正規化DB。同じデータを構造化して送信
//
// このファイルの責務:
//   1. Supabase接続の初期化
//   2. カルテデータの型変換・送信
//   3. マスタデータの取得（将来的にスプシから移行）
//   4. 認証（Phase D で実装）

// ===== 設定 =====
// Vercel環境変数から取得（ローカル開発時はここに直書きも可）
// Supabase新形式: publishable key (sb_publishable_...) = 旧anon key相当
const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || window.__SUPABASE_PUBLISHABLE_KEY__ || '';

let supabaseClient = null;
let supabaseReady = false;

// ===== 初期化 =====
async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('[Supabase] URL/KEY未設定 → スプシのみモードで動作');
    return false;
  }

  try {
    // supabase-js CDN版を使用
    const { createClient } = supabase;
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = true;
    console.log('[Supabase] 接続OK');

    // Auth: check session and setup listener
    setupAuthListener();
    await initAuth();
    return true;
  } catch (e) {
    console.error('[Supabase] 初期化失敗:', e);
    supabaseReady = false;
    return false;
  }
}

// ===== ステータス =====
function isSupabaseReady() {
  return supabaseReady && supabaseClient !== null;
}

// ===== 型変換ユーティリティ =====

/**
 * app.jsの患者オブジェクトをSupabaseのpatients行に変換
 */
function toSupabasePatient(p, clinicId) {
  return {
    patient_no: p.id || null,
    clinic_id: clinicId || 'nishiharu',
    name: p.name,
    name_kana: p.nameKana || null,
    dob: p.dob || null,
    age: typeof p.age === 'number' ? p.age : parseInt(p.age) || null,
    sex: (p.sex || '').replace(/性$/, '') || '不明',
    phone: p.phone || null,
    address: p.address || null,
    allergies: Array.isArray(p.allergies) ? p.allergies : [],
    medical_history: Array.isArray(p.history) ? p.history : [],
    insurance_type: p.insurance || null,
    copay_rate: p.ratio || null,
    insurer_number: p.insurerNumber || p.insuranceNumber || null,
    kouhi_number: p.kouhiNumber || null,
    income_level: p.incomeLevel || null,
    memo: p.memo || null,
    is_db_source: p.dbSource || false,
  };
}

/**
 * app.jsの来院データをSupabaseのvisits行に変換
 */
function toSupabaseVisit(p, karteState, clinicId) {
  return {
    clinic_id: clinicId || 'nishiharu',
    // patient_id は Supabase側のUUIDで紐付け（後で解決）
    patient_name: p.name,  // 紐付け用（暫定）
    visit_date: p.visitDate || new Date().toISOString().split('T')[0],
    visit_time: p.arrivedAt || null,
    doctor: null,  // シフトから取得
    department: '内科',
    visit_type: karteState?.isFirstVisit ? '新規' : '再診',
    status: p.status || 'waiting',
    route: p.route || null,
    lane: p.vehicle?.lane || null,
    vehicle_plate: p.vehicle?.plate || null,
    self_pay: 0,
    revenue_points: 0,
    covid_positive: false,
    flu_positive: false,
    strep_positive: false,
  };
}

/**
 * app.jsのkarteDataをSupabaseのkartes行に変換
 */
function toSupabaseKarte(karteState) {
  if (!karteState) return null;
  const v = karteState.vitals || {};
  return {
    chief_complaint: karteState.chiefComplaint || null,
    findings_html: karteState.findingsHtml || null,
    vitals_temp: parseFloat(v.t) || null,
    vitals_bp_sys: parseInt(v.bps) || null,
    vitals_bp_dia: parseInt(v.bpd) || null,
    vitals_pulse: parseInt(v.pulse) || null,
    vitals_spo2: parseInt(v.spo2) || null,
    rx_days: karteState.rxDays || 7,
    is_first_visit: karteState.isFirstVisit || false,
  };
}

/**
 * 処方配列をSupabaseのprescriptions行に変換
 * app.jsの処方形式: {drug: {id, name, unit, price}, qty}
 */
function toSupabasePrescriptions(prescriptions) {
  if (!Array.isArray(prescriptions)) return [];
  return prescriptions.map((rx, i) => ({
    drug_name: rx.drug ? rx.drug.name : 'unknown',
    quantity: rx.qty || 0,
    unit: rx.drug ? rx.drug.unit || 'T' : 'T',
    sort_order: i,
    note: rx.note || null,
  }));
}

/**
 * 病名配列をSupabaseのdiseases_assigned行に変換
 */
function toSupabaseDiseases(selectedDiseases) {
  if (!Array.isArray(selectedDiseases)) return [];
  return selectedDiseases.map(d => ({
    disease_code: d.code || null,
    disease_name: d.name || d,
  }));
}

// ===== データ送信（二重書き込みの Supabase側） =====

/**
 * カルテ保存: Supabaseに型付きデータを送信
 * スプシへの書き込みは既存の saveToSpreadsheet() が担当
 * この関数はスプシ保存と並行して呼ばれる
 *
 * @param {object} patient - app.jsの患者オブジェクト
 * @param {object} karteState - karteData[patientId]
 * @param {array} drugsList - drugs配列
 * @returns {object} { success: boolean, error?: string }
 */
async function saveToSupabase(patient, karteState, drugsList) {
  if (!isSupabaseReady()) {
    console.log('[Supabase] 未接続 → スキップ');
    return { success: false, error: 'Supabase未接続' };
  }

  const clinicId = 'nishiharu';

  try {
    // 1. 患者を upsert（patient_no + clinic_id で一意）
    const patientRow = toSupabasePatient(patient, clinicId);
    const { data: patientData, error: patientErr } = await supabaseClient
      .from('patients')
      .upsert(patientRow, { onConflict: 'patient_no,clinic_id' })
      .select('id')
      .single();

    if (patientErr) throw new Error('患者保存失敗: ' + patientErr.message);
    const patientId = patientData.id;

    // 2. 来院記録を upsert
    const visitRow = toSupabaseVisit(patient, karteState, clinicId);
    visitRow.patient_id = patientId;
    delete visitRow.patient_name;

    const { data: visitData, error: visitErr } = await supabaseClient
      .from('visits')
      .upsert(visitRow, { onConflict: 'patient_id,visit_date,clinic_id' })
      .select('id')
      .single();

    if (visitErr) throw new Error('来院記録保存失敗: ' + visitErr.message);
    const visitId = visitData.id;

    // 3. カルテ（SOAP）を upsert
    const karteRow = toSupabaseKarte(karteState);
    if (karteRow) {
      karteRow.visit_id = visitId;
      const { error: karteErr } = await supabaseClient
        .from('kartes')
        .upsert(karteRow, { onConflict: 'visit_id' });
      if (karteErr) throw new Error('カルテ保存失敗: ' + karteErr.message);
    }

    // 4. 処方を差し替え（既存削除→新規挿入）
    if (karteState.prescriptions && karteState.prescriptions.length > 0) {
      // 既存処方を削除
      await supabaseClient
        .from('prescriptions')
        .delete()
        .eq('visit_id', visitId);

      // 新規挿入
      const rxRows = toSupabasePrescriptions(karteState.prescriptions);
      const insertRows = rxRows.map(rx => ({ ...rx, visit_id: visitId }));
      const { error: rxErr } = await supabaseClient
        .from('prescriptions')
        .insert(insertRows);
      if (rxErr) throw new Error('処方保存失敗: ' + rxErr.message);
    }

    // 5. 病名を差し替え
    if (karteState.selectedDiseases && karteState.selectedDiseases.length > 0) {
      await supabaseClient
        .from('diseases_assigned')
        .delete()
        .eq('visit_id', visitId);

      const diseaseRows = toSupabaseDiseases(karteState.selectedDiseases);
      const insertDiseases = diseaseRows.map(d => ({ ...d, visit_id: visitId }));
      const { error: dErr } = await supabaseClient
        .from('diseases_assigned')
        .insert(insertDiseases);
      if (dErr) throw new Error('病名保存失敗: ' + dErr.message);
    }

    console.log('[Supabase] カルテ保存完了 patient=' + patientId + ' visit=' + visitId);
    return { success: true, patientId, visitId };

  } catch (e) {
    console.error('[Supabase] 保存エラー:', e);
    return { success: false, error: e.message };
  }
}

// ===== データ取得（将来、スプシからの移行用） =====

/**
 * Supabaseから患者一覧を取得
 * 現在はスプシから取得しているが、将来こちらに切り替え可能
 */
async function fetchPatientsFromSupabase(clinicId) {
  if (!isSupabaseReady()) return [];
  const { data, error } = await supabaseClient
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId || 'nishiharu')
    .order('name');
  if (error) { console.error('[Supabase] 患者取得エラー:', error); return []; }
  return data || [];
}

/**
 * Supabaseから特定患者のカルテ履歴を取得
 */
async function fetchKarteHistory(patientId) {
  if (!isSupabaseReady()) return [];
  const { data, error } = await supabaseClient
    .from('visits')
    .select(`
      *,
      kartes (*),
      prescriptions (*),
      diseases_assigned (*)
    `)
    .eq('patient_id', patientId)
    .order('visit_date', { ascending: false });
  if (error) { console.error('[Supabase] カルテ履歴取得エラー:', error); return []; }
  return data || [];
}

/**
 * Supabaseから薬品マスタを取得
 */
async function fetchDrugsFromSupabase(clinicId) {
  if (!isSupabaseReady()) return [];
  const { data, error } = await supabaseClient
    .from('drugs')
    .select('*')
    .or('clinic_id.is.null,clinic_id.eq.' + (clinicId || 'nishiharu'))
    .eq('is_active', true)
    .order('name');
  if (error) { console.error('[Supabase] 薬品取得エラー:', error); return []; }
  return data || [];
}
