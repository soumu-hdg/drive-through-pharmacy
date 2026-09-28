// ===== 置き換え層：施設情報・施設の各設定（工程4・2026-09-24） compat_facility.js =====
// 基準版の施設管理画面が出す /facilities/... を、院ごとの保存先（Supabase の karte_clinic_store。compat_api.js の store）に置き換える。
//   ・応答の形・既定値・値の正規化・入力の点検は基準版のサーバーと同じにする
//       GET/PUT /facilities/current                   医療機関情報（院名は clinics 表から読む。そのほかの項目を院ごとに保存）
//       GET/PUT /facilities/accident-settings         労災・自賠責の設定
//       GET/PUT /facilities/data-submission-settings  外来データ提出加算の設定
//       GET/PUT /facilities/rme-notification-settings RME 通知の管理
//       GET/PUT /facilities/shared-password           共通パスワード（平文は保存しない。塩付きのハッシュだけを置き、応答は is_set だけ）
//   ・保存キー（院ごと）: karte_base_facility_profile_<院ID>・karte_base_facility_accident_<院ID>・karte_base_facility_data_submission_<院ID>・
//       karte_base_facility_rme_<院ID>・karte_base_facility_shared_password_<院ID>
//   ・医療機関情報に医療機関コードが入っている院では、レセプト作成（compat_receipt.js）の UKE の医療機関の行（IR）と
//     点検用様式の医療機関欄にその値を使う（window.__compat.applyFacilityToUke・facilityForForm）。入っていない院は従来どおり
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, clinicId } = C;
  const key = (name) => 'karte_base_facility_' + name + '_' + clinicId();
  const read = (name) => { try { const v = JSON.parse(C.store.getItem(key(name)) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  const write = (name, v) => C.store.setItem(key(name), JSON.stringify(v));
  const bad = (detail) => err(422, detail);
  const str = (v) => (v == null ? '' : String(v));
  const digits = (v) => str(v).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));   // 基準版の normalize_ascii_digits
  const isDigits = (v, n) => /^\d+$/.test(v) && (!n || v.length === n);

  // ---- 院名（clinics 表・読み取りのみ） ----
  const nameCache = new Map();
  async function clinicName() {
    const cid = clinicId();
    if (!nameCache.has(cid)) {
      let name = '';
      try { const c = await C.ready(); const { data } = await c.from('clinics').select('name').eq('id', cid).maybeSingle(); name = (data && data.name) || ''; } catch (e) { name = ''; }
      if (!name) name = (C.facilityOf().facility_name || '');
      nameCache.set(cid, name);
    }
    return nameCache.get(cid);
  }

  // ---- 医療機関情報 ----
  const PROFILE_FIELDS = [['founder_name', 200], ['postal_code', 10], ['address', null], ['phone', 20], ['fax', 20], ['medical_institution_code', 20], ['email', 255], ['outpatient_type', 20], ['invoice_registration_number', 30]];
  const profile = () => read('profile') || {};
  async function currentFacility() {
    const p = profile(); const out = { id: clinicId(), facility_code: clinicId(), name: await clinicName() };
    PROFILE_FIELDS.forEach(([k]) => { out[k] = p[k] == null ? null : p[k]; });
    return out;
  }
  on('GET', /^\/facilities\/current$/, async () => currentFacility());
  on('PUT', /^\/facilities\/current$/, async (m, q, body) => {
    const name = body.name;
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) return bad('施設名は1〜200文字で入力してください');
    const next = Object.assign({}, profile());
    for (const [k, max] of PROFILE_FIELDS) {
      if (k === 'founder_name' && !Object.prototype.hasOwnProperty.call(body, k)) continue;   // 基準版と同じく、送られていないときは前の値のまま
      const v = body[k];
      if (v != null && typeof v !== 'string') return bad(k + ' は文字列で入力してください');
      if (v != null && max && v.length > max) return bad(k + ' は' + max + '文字以内で入力してください');
      next[k] = v == null ? null : v;
    }
    write('profile', next);
    return currentFacility();
  });

  // ---- 労災・自賠責 ----
  const ACCIDENT_DEFAULT = { labor_insurance_code: '2392381', auto_liability_calculation: 'workers_comp' };
  on('GET', /^\/facilities\/accident-settings$/, async () => {
    const s = Object.assign({}, ACCIDENT_DEFAULT);
    const saved = read('accident') || {};
    ['labor_insurance_code', 'auto_liability_calculation'].forEach((k) => { if (Object.prototype.hasOwnProperty.call(saved, k)) s[k] = saved[k]; });
    if (!['workers_comp', 'health_fee'].includes(s.auto_liability_calculation)) s.auto_liability_calculation = 'workers_comp';
    return { facility_id: clinicId(), ...s };
  });
  on('PUT', /^\/facilities\/accident-settings$/, async (m, q, body) => {
    const code = body.labor_insurance_code;
    if (typeof code !== 'string' || code.length < 1 || code.length > 20) return bad('労災指定医療機関コードは1〜20文字で入力してください');
    const calc = body.auto_liability_calculation === undefined ? 'workers_comp' : body.auto_liability_calculation;
    if (!/^(workers_comp|health_fee)$/.test(str(calc))) return bad('自賠責の算定方法が不正です');
    if (!code.trim()) return bad('労災指定医療機関コードは必須です');
    const s = { labor_insurance_code: code.trim(), auto_liability_calculation: calc };
    write('accident', s);
    return { facility_id: clinicId(), ...s };
  });

  // ---- 共通パスワード（塩付き PBKDF2-SHA256 のハッシュだけを置く） ----
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  async function hashPassword(pw, salt) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, k, 256));
  }
  on('GET', /^\/facilities\/shared-password$/, async () => { const s = read('shared_password'); return { facility_id: clinicId(), is_set: !!(s && s.hash) }; });
  on('PUT', /^\/facilities\/shared-password$/, async (m, q, body) => {
    const pw = body.password;
    if (typeof pw !== 'string' || pw.length < 1 || pw.length > 128) return bad('パスワードは1〜128文字で入力してください');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(pw, salt);
    write('shared_password', { algorithm: 'PBKDF2-SHA256', iterations: 210000, salt: b64(salt), hash: b64(hash), updated_at: new Date().toISOString() });
    return { facility_id: clinicId(), is_set: true };
  });
  // 入力されたパスワードが設定済みのものと同じかを確かめる（平文は持たないので照合だけできる）
  C.verifySharedPassword = async (pw) => {
    const s = read('shared_password'); if (!s || !s.hash) return false;
    const salt = Uint8Array.from(atob(s.salt), (ch) => ch.charCodeAt(0));
    return b64(await hashPassword(String(pw || ''), salt)) === s.hash;
  };

  // ---- 外来データ提出加算 ----
  const DEPARTMENTS = [['01', '救急往診'], ['02', 'オンライン診療'], ['03', '内科'], ['04', '在宅'], ['05', '夜間休日外来'], ['06', '発熱外来']];
  const RECEIPT_DEPARTMENT_CODES = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '30', '31', '33', '34', '35', '36', '37', '38', '39']);
  const CATEGORY_CODES = new Set(); for (let n = 10; n < 631; n += 10) CATEGORY_CODES.add(String(n).padStart(3, '0'));
  const PREF_FULL = { '北海道': '01', '青森県': '02', '岩手県': '03', '宮城県': '04', '秋田県': '05', '山形県': '06', '福島県': '07', '茨城県': '08', '栃木県': '09', '群馬県': '10',
    '埼玉県': '11', '千葉県': '12', '東京都': '13', '神奈川県': '14', '新潟県': '15', '富山県': '16', '石川県': '17', '福井県': '18', '山梨県': '19', '長野県': '20',
    '岐阜県': '21', '静岡県': '22', '愛知県': '23', '三重県': '24', '滋賀県': '25', '京都府': '26', '大阪府': '27', '兵庫県': '28', '奈良県': '29', '和歌山県': '30',
    '鳥取県': '31', '島根県': '32', '岡山県': '33', '広島県': '34', '山口県': '35', '徳島県': '36', '香川県': '37', '愛媛県': '38', '高知県': '39', '福岡県': '40',
    '佐賀県': '41', '長崎県': '42', '熊本県': '43', '大分県': '44', '宮崎県': '45', '鹿児島県': '46', '沖縄県': '47' };
  function deriveCode9(code, address) {
    const c = digits(code);
    if (isDigits(c, 9)) return c;
    if (!isDigits(c, 7)) return '';
    const a = str(address).trim(); const hit = Object.keys(PREF_FULL).find((p) => a.includes(p));
    return hit ? PREF_FULL[hit] + c : '';
  }
  function normalizeDataSubmission(raw, defaultCode) {
    raw = raw && typeof raw === 'object' ? raw : {};
    let code = digits(raw.medical_institution_code_9); if (!isDigits(code, 9)) code = defaultCode;
    const byCode = {}; (Array.isArray(raw.department_mappings) ? raw.department_mappings : []).forEach((x) => { if (x && typeof x === 'object') byCode[digits(x.department_code)] = x; });
    const department_mappings = DEPARTMENTS.map(([dc, dn]) => {
      const s = byCode[dc] || {}; const rc = digits(s.receipt_department_code), cc = digits(s.department_category_code);
      return { department_code: dc, department_name: dn, receipt_department_code: RECEIPT_DEPARTMENT_CODES.has(rc) ? rc : '01', department_category_code: CATEGORY_CODES.has(cc) ? cc : '010' };
    });
    return { medical_institution_code_9: code, department_mappings };
  }
  on('GET', /^\/facilities\/data-submission-settings$/, async () => {
    const p = profile();
    return { facility_id: clinicId(), ...normalizeDataSubmission(read('data_submission'), deriveCode9(p.medical_institution_code, p.address)) };
  });
  on('PUT', /^\/facilities\/data-submission-settings$/, async (m, q, body) => {
    // 項目の形（基準版の入力の型と同じ制約）
    if (typeof body.medical_institution_code_9 !== 'string' || body.medical_institution_code_9.length !== 9) return bad('医療機関コードは9桁の半角数字で入力してください');
    if (!Array.isArray(body.department_mappings)) return bad('診療科の設定がありません');
    for (const x of body.department_mappings) {
      if (!x || typeof x !== 'object' || typeof x.department_code !== 'string' || x.department_code.length !== 2 || typeof x.receipt_department_code !== 'string' || x.receipt_department_code.length !== 2
        || typeof x.department_category_code !== 'string' || x.department_category_code.length !== 3) return bad('診療科の設定の形が不正です');
    }
    const code = digits(body.medical_institution_code_9);
    if (!isDigits(code, 9)) return bad('医療機関コードは9桁の半角数字で入力してください');
    const expected = new Map(DEPARTMENTS); const got = new Map();
    for (const x of body.department_mappings) {
      const dc = digits(x.department_code);
      if (!expected.has(dc)) return bad('対象外の診療科コードです: ' + dc);
      if (got.has(dc)) return bad('診療科コードが重複しています: ' + dc);
      const rc = digits(x.receipt_department_code), cc = digits(x.department_category_code);
      if (!RECEIPT_DEPARTMENT_CODES.has(rc)) return bad('レセプト診療科コードが不正です: ' + rc);
      if (!CATEGORY_CODES.has(cc)) return bad('診療科区分が不正です: ' + cc);
      got.set(dc, { department_code: dc, department_name: expected.get(dc), receipt_department_code: rc, department_category_code: cc });
    }
    if (got.size !== expected.size) return bad('6種類すべての診療科設定が必要です');
    const v = { medical_institution_code_9: code, department_mappings: DEPARTMENTS.map(([dc]) => got.get(dc)) };
    write('data_submission', v);
    return { facility_id: clinicId(), ...v };
  });

  // ---- RME 通知の管理 ----
  const RME_CATALOG = [
    ['opioid_constipation_online_eligibility', 'オピオイド誘発性便秘症 疾患情報（オン資）'], ['ckd_proteinuria_treatment', '尿蛋白陽性のCKD患者における治療方針確認'],
    ['proteinuria_treatment', '尿蛋白陽性患者における治療方針確認'], ['dkd_treatment', '糖尿病合併CKD（DKD）の治療方針確認'],
    ['mash_notice_2', '代謝機能障害関連脂肪性肝炎（MASH／旧NASH）疑い患者に関する通知②'], ['hpp_information_3', 'HPP疑い患者への疾患情報③'],
    ['hpp_information_2', 'HPP疑い患者への疾患情報②'], ['hpp_information_1', 'HPP疑い患者への疾患情報①'], ['high_tg_information_3', '高TG血症に関する疾患情報③'],
    ['high_tg_information_2', '高TG血症に関する疾患情報②'], ['high_tg_information_1', '高TG血症に関する疾患情報①'], ['ckd_high_risk', 'CKD高リスク患者への情報'],
    ['covid_antiviral_lagevrio', 'COVID-19 抗ウイルス薬処方に関する情報（ラゲブリオ）'], ['covid_antiviral_xocova', 'COVID-19 抗ウイルス薬処方に関する情報（ゾコーバ）'],
    ['eye_redness', '充血に関する疾患情報'], ['ptosis_diplopia', '眼瞼下垂、複視に関する疾患情報'], ['thyroid_eye', '甲状腺眼症に関する疾患情報'],
    ['basedow_eye', 'バセドウ病と眼症状に関する疾患情報'], ['thyroid_eye_symptoms', '甲状腺疾患と眼症状に関する疾患情報'], ['blood_test_abnormality', '血液検査値異常に関する疾患情報'],
    ['anemia_vitamin_folate', '貧血症状に関する疾患情報（ビタミン剤・葉酸処方）'], ['anemia_iron', '貧血症状に関する疾患情報（鉄剤処方）'],
    ['dementia_bpsd', '認知症に伴うBPSDに関する疾患情報'], ['mash_notice_1', '代謝機能障害関連脂肪性肝炎（MASH／旧NASH）疑い患者に関する通知①'],
    ['opioid_constipation', 'オピオイド誘発性便秘症 疾患情報'], ['ckd_guideline_3', 'CKD診療ガイドライン 疾患情報③'], ['ckd_guideline_2', 'CKD診療ガイドライン 疾患情報②'],
    ['ckd_guideline_1', 'CKD診療ガイドライン 疾患情報①']];
  const RME_VALUES = new Set(['all_patients_enabled', 'all_patients_disabled']);
  function normalizeRme(raw) {
    const list = raw && typeof raw === 'object' && Array.isArray(raw.notifications) ? raw.notifications : [];
    const byId = {}; list.forEach((x) => { if (!x || typeof x !== 'object') return; const id = str(x.notification_id).trim(), mg = str(x.management).trim(); if (id && RME_VALUES.has(mg)) byId[id] = mg; });
    return RME_CATALOG.map(([id, title]) => ({ notification_id: id, title, management: byId[id] || 'all_patients_enabled' }));
  }
  on('GET', /^\/facilities\/rme-notification-settings$/, async () => ({ facility_id: clinicId(), notifications: normalizeRme(read('rme')) }));
  on('PUT', /^\/facilities\/rme-notification-settings$/, async (m, q, body) => {
    if (!Array.isArray(body.notifications)) return bad('RME通知の設定がありません');
    const catalog = new Map(RME_CATALOG); const got = new Map();
    for (const x of body.notifications) {
      if (!x || typeof x !== 'object' || typeof x.notification_id !== 'string' || x.notification_id.length < 1 || x.notification_id.length > 100) return bad('RME通知の設定の形が不正です');
      if (!RME_VALUES.has(x.management)) return bad('RME通知の管理区分が不正です: ' + x.management);
      const id = x.notification_id.trim();
      if (!catalog.has(id)) return bad('対象外のRME通知です: ' + id);
      if (got.has(id)) return bad('RME通知が重複しています: ' + id);
      got.set(id, x.management);
    }
    if (got.size !== catalog.size) return bad('すべてのRME通知設定が必要です');
    const notifications = RME_CATALOG.map(([id, title]) => ({ notification_id: id, title, management: got.get(id) }));
    write('rme', { notifications });
    return { facility_id: clinicId(), notifications };
  });

  // ---- レセプト作成で使う医療機関の値（UKE の IR・点検用様式） ----
  //   基準版の UKE 作成と同じ読み方: 10桁以上のコードは 先頭2桁＝都道府県・3桁目＝点数表・末尾7桁＝医療機関コード。
  //   7桁のときは都道府県を住所（なければ院名）から、点数表は医科（1）。9桁（都道府県＋7桁）も先頭2桁・末尾7桁で読む
  const PREF_SHORT = Object.keys(PREF_FULL).map((p) => [p === '北海道' ? p : p.replace(/[都府県]$/, ''), PREF_FULL[p]]);
  async function ukeFacility() {
    const p = profile(); const raw = digits(p.medical_institution_code).replace(/\D/g, '');
    if (!raw) return null;   // コードが無い院は従来どおり
    const name = await clinicName();
    let pref = '', tensu = '1', code = raw;
    if (raw.length >= 10) { pref = raw.slice(0, 2); tensu = raw.slice(2, 3) || '1'; code = raw.slice(-7); }
    else if (raw.length === 9) { pref = raw.slice(0, 2); code = raw.slice(-7); }
    if (!pref) { const hay = [p.address, name].map(str).join(' '); const hit = PREF_SHORT.find(([n]) => hay.includes(n)); pref = hit ? hit[1] : ''; }
    return { pref, tensu, code, name, phone: str(p.phone), address: str(p.address), medical_institution_code: code };
  }
  // 統合版の画面（見えない枠）の UKE_INST を、その院の医療機関情報で上書きする。情報の無い院は最初の値に戻す
  C.applyFacilityToUke = async (w) => {
    let inst = null; try { inst = w.eval('typeof UKE_INST !== "undefined" ? UKE_INST : null'); } catch (e) { inst = null; }
    if (!inst) return null;
    if (!w.__ukeInstOriginal) w.__ukeInstOriginal = Object.assign({}, inst);
    Object.assign(inst, w.__ukeInstOriginal);
    const f = await ukeFacility(); if (!f) return null;
    Object.assign(inst, { pref: f.pref, tensu: f.tensu, code: f.code, name: f.name, phone: f.phone });
    return f;
  };
  // 点検用様式の医療機関欄（情報の無い院は null ＝ 従来どおり UKE の IR から読む）
  C.facilityForForm = async () => { const f = await ukeFacility(); return f ? { name: f.name, address: f.address, phone: f.phone, medical_institution_code: f.code } : null; };
})();
