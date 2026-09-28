// ===== 置き換え層：基準版の新しい版（2026-09-25 受領）で増えた問い合わせ compat_base0925.js =====
// 基準版の画面（renderer.js・api.js）の新しい版が出す問い合わせのうち、置き換え層に無かったものを統合版の Supabase につなぐ。
// 応答の形・入力の点検・エラーの番号は基準版のサーバー（server/app/routers の該当箇所）に合わせる。
//   ① お知らせ   GET /announcements・/announcements/unread-count、POST /announcements/:id/read・/announcements/read-all
//        基準版のお知らせは「公式マスターを取り込んだとき」に自動で作られる（固定の既定文は無い）。統合版でも同じく、
//        公式マスターの取込記録（karte_master_meta の件数・取込日時）から取込日ごとに 1 件作る（ID は取込日から決まる固定値）。
//        既読は院×利用者ごとの台帳（karte_clinic_store のキー karte_base_announce_read_<利用者ID>_<院ID>）
//   ② 施設       GET /facilities/clinics（clinics 表のうちこの職員が使える院。職員数は app_users・患者数は patients）
//                POST /facilities/clinics（院の追加）は全院の台帳にかかわるので 403「管理者に依頼してください」
//                GET/PUT /facilities/management-sheets（患者DB・処方DB の同期先。院ごとの台帳 karte_base_facility_management_sheets_<院ID>。
//                統合版には同期の仕組みが無いので service_configured・active は常に false＝基準版でサービス未設定のときと同じ）
//   ③ 帳票       GET /billings/reports/generic-drug-usage・/billings/reports/psychotropic-patients
//                統合版の記録（kartes.base_record の処方。基準版の画面で書いていない記録は処方の表）を直近 3 か月分集計する。
//                医薬品の区分（後発品・向精神薬・長期収載品・一般名）は公式の医薬品マスターから作った compat/drug_flags.json
//                （tools/base0925_build_drug_flags.mjs）。基準版が別に取り込む「薬価基準収載品目リスト」は統合版に無いので、
//                「同じ剤形の後発品がある先発品」は長期収載品の印で代用し、「出荷停止等で除外する品目」は無し（除外後＝除外前）とする
//   ④ 患者・受付 GET /patients/next-number（その院の患者番号 NHC-連番の次。NHC が無く数字だけの番号の院は基準版と同じ 5 桁）
//                POST /patients に auto_patient_no が付いていたら、保存の時点の次番号で登録し直す（基準版と同じ）
//                GET /receptions/patient/:id/previous-context（同じ患者の前回の来院の医師・診療科）
//   ⑤ 記録       POST /records/:id/billings/bulk・DELETE /records/:id/billings/:id（算定の一括追加・取消）
//                PUT・DELETE /records/:id/prescription-groups/:id（処方グループの一括更新・取消）
//                POST /records/:id/prescription-sets/:id/apply（薬セットの適用。薬セットは院ごとの台帳 karte_base_prescription_sets_<院ID>）
//                POST /record-actions/bulk（診療行為の一括登録）
//                どれも記録（kartes.base_record）を compat_records.js の保存処理（C.records.writeRecord・internalDrugFees）で書き換える。
//                入金がある会計の記録は算定・処方を変えさせない（統合版の既存の書き込みと同じ）
//   ⑥ マスター   GET /masters/drugs/:コード（9 桁以外のコードは基準版と同じく 404。9 桁は既存の処理）
//                GET /billings/self-pay/master（既存の処理に、基準版と同じ適用期間の絞り込み include_out_of_period を足す）
//   記録の更新番号（X-Record-Version）は置き換え層に届かないので照合しない。応答の record_version は保存後の記録の版
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, ready, clinicId, routeOf } = C;
  const nowIso = () => new Date().toISOString();
  const pad2 = (n) => String(n).padStart(2, '0');
  const localDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const today = () => localDate(new Date());
  const uid = () => crypto.randomUUID();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  const ASK_ADMIN = '管理者に依頼してください（この画面からは操作できません）';
  async function db() { const c = await ready(); if (!c) throw new Error('データベースに接続できません'); return c; }
  async function userId() {
    if (C.state && C.state.user && C.state.user.id) return C.state.user.id;
    const c = await db(); const { data } = await c.auth.getSession(); return (data && data.session && data.session.user.id) || null;
  }
  const isAdmin = () => {
    const r = (window.ClinicCtx && ClinicCtx.userRow && ClinicCtx.userRow()) || {};
    return r.role === 'admin' && r.is_active !== false;
  };
  const readJson = (key, dflt) => { try { const v = JSON.parse(C.store.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; } };
  const writeJson = (key, v) => {
    if (!C.store.enabled) throw new Error('この院は保存先（院ごとの台帳）が用意されていないため保存できません。管理者に連絡してください');
    C.store.setItem(key, JSON.stringify(v));
  };

  // ================================================================
  // ① お知らせ
  // ================================================================
  // 統合版のマスター名 → 基準版の画面のマスターの種類（renderer.js の SYSTEM_ANNOUNCEMENT_MASTER_INFO のキー）
  const ANN_KEYS = { s_procedures: 'medical_action', y_drugs: 'drug', b_diseases: 'diagnosis', z_modifiers: 'modifier' };
  const ANN_LABELS = { medical_action: '診療行為マスター', drug: '医薬品マスター', diagnosis: '傷病名マスター', modifier: '修飾語マスター' };
  const ANN_ORDER = ['diagnosis', 'drug', 'medical_action', 'modifier'];   // 基準版は master_key の並び
  const ANN_SOURCE_URL = 'https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/index.html';
  // 文字列から決まる固定の UUID（取込日が同じなら毎回同じ ID）
  async function fixedUuid(text) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))).slice(0, 16);
    h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
    const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }
  let annCache = null;
  async function announcements() {
    if (annCache && annCache.at > Date.now() - 60000) return annCache.list;
    const c = await db(); const { data, error } = await c.from('karte_master_meta').select('name,row_count,meta,loaded_at');
    if (error) throw new Error('お知らせ（マスターの取込記録）を読めませんでした: ' + error.message);
    const rows = data || [];
    const drugOfficial = rows.find((r) => r.name === 'drug_official');
    const drugSource = drugOfficial && drugOfficial.meta && drugOfficial.meta.head && drugOfficial.meta.head.source;
    const drugVersion = drugSource && (String(drugSource).match(/(\d{8})/) || [])[1];
    const days = new Map();
    rows.filter((r) => ANN_KEYS[r.name] && r.loaded_at).forEach((r) => {
      const day = localDate(new Date(r.loaded_at));
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(r);
    });
    const list = [];
    for (const [day, group] of days) {
      const validation = {}, manifest = {};
      group.slice().sort((a, b) => ANN_ORDER.indexOf(ANN_KEYS[a.name]) - ANN_ORDER.indexOf(ANN_KEYS[b.name])).forEach((r) => {
        const k = ANN_KEYS[r.name]; validation[k] = { parsed_count: r.row_count };
        manifest[k] = Object.assign({ url: ANN_SOURCE_URL }, k === 'drug' && drugVersion ? { version: drugVersion } : {});
      });
      const names = Object.keys(validation).map((k) => ANN_LABELS[k]).join('、');
      const published = group.map((r) => r.loaded_at).sort().pop();
      list.push({ id: await fixedUuid('master_update_batch:' + day), category: 'master_update', severity: 'important', title: '公式マスターを更新しました',
        body: '【何を】' + (names || '公式マスター') + '\n【どこを】統合版の診療入力・処方入力・算定・レセプト点検で参照する公式マスター\n' +
          '【どう変更】公的配布元のデータを取り込み、件数を検証してから現行データへ反映しました。',
        source_kind: 'master_update_batch', source_ref: day, source_url: ANN_SOURCE_URL,
        metadata: { batch_id: day, trigger_type: 'manual', source_manifest: manifest, validation_summary: validation }, published_at: published, created_at: published });
    }
    list.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    annCache = { at: Date.now(), list };
    return list;
  }
  const readKey = async () => 'karte_base_announce_read_' + (await userId()) + '_' + clinicId();
  on('GET', /^\/announcements$/, async (m, q) => {
    const lim = Number(q.get('limit') || 100), off = Number(q.get('offset') || 0);
    if (!Number.isInteger(lim) || lim < 1 || lim > 200) return err(422, 'limit は 1〜200 で指定してください');
    if (!Number.isInteger(off) || off < 0) return err(422, 'offset は 0 以上で指定してください');
    const list = await announcements(); const reads = readJson(await readKey(), {});
    const now = nowIso(); const visible = list.filter((a) => a.published_at <= now);
    return { data: visible.slice(off, off + lim).map((a) => Object.assign({}, a, { is_read: !!reads[a.id] })), unread_count: visible.filter((a) => !reads[a.id]).length };
  });
  on('GET', /^\/announcements\/unread-count$/, async () => {
    const list = await announcements(); const reads = readJson(await readKey(), {}); const now = nowIso();
    return { unread_count: list.filter((a) => a.published_at <= now && !reads[a.id]).length };
  });
  on('POST', /^\/announcements\/read-all$/, async () => {
    const key = await readKey(); const reads = readJson(key, {}); const now = nowIso();
    const visible = (await announcements()).filter((a) => a.published_at <= now);
    visible.forEach((a) => { reads[a.id] = now; }); writeJson(key, reads);
    return { marked_read: visible.length };
  });
  on('POST', /^\/announcements\/([^/]+)\/read$/, async (m) => {
    const id = decodeURIComponent(m[1]); if (!UUID.test(id)) return err(422, 'お知らせの ID が正しくありません');
    const now = nowIso(); const hit = (await announcements()).find((a) => a.id === id && a.published_at <= now);
    if (!hit) return err(404, 'お知らせが見つかりません');
    const key = await readKey(); const reads = readJson(key, {}); reads[id] = now; writeJson(key, reads);
    return { announcement_id: id, is_read: true };
  });

  // ================================================================
  // ② 施設（クリニック一覧・管理シート）
  // ================================================================
  const needAdmin = () => (isAdmin() ? null : err(403, '施設管理者権限が必要です'));
  on('GET', /^\/facilities\/clinics$/, async () => {
    const no = needAdmin(); if (no) return no;
    const c = await db();
    const { data: clinics, error } = await c.from('clinics').select('id,name,sort_order,is_active,created_at').order('sort_order', { ascending: true });
    if (error) return err(500, 'クリニック一覧を読めませんでした: ' + error.message);
    const allowed = (window.ClinicCtx && ClinicCtx.allowed && ClinicCtx.allowed()) || [clinicId()];
    const mine = (clinics || []).filter((r) => allowed.includes('*') || allowed.includes(r.id));
    const { data: users } = await c.from('app_users').select('id,clinics,is_active');
    const rows = [];
    for (const r of mine) {
      const { count } = await c.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', r.id)
        .or('receipt_extra->baseProfile->>is_active.is.null,receipt_extra->baseProfile->>is_active.neq.false');
      const userCount = (users || []).filter((u) => u.is_active !== false && Array.isArray(u.clinics) && (u.clinics.includes(r.id) || u.clinics.includes('*'))).length;
      rows.push({ clinic_id: r.id, name: r.name, display_order: r.sort_order, is_active: r.is_active !== false, active_user_count: userCount, active_patient_count: count || 0, created_at: r.created_at });
    }
    return { data: rows };
  });
  on('POST', /^\/facilities\/clinics$/, async (m, q, b) => {
    const no = needAdmin(); if (no) return no;
    b = b || {};
    if (!String(b.name || '').trim() || !String(b.admin_login_id || '').trim() || !String(b.admin_name || '').trim()) return err(422, 'クリニック名・管理者名・ログインIDは必須です');
    return err(403, '新しいクリニックの追加は全院の台帳と職員の認証にかかわるため、' + ASK_ADMIN);
  });
  const MS_KEY = () => 'karte_base_facility_management_sheets_' + clinicId();
  function msNormalize(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    return { enabled: o.enabled === true, patient_db_url: String(o.patient_db_url || '').trim(), prescription_db_url: String(o.prescription_db_url || '').trim() };
  }
  const msOut = (v) => Object.assign({ facility_id: clinicId() }, v, { service_configured: false, active: false });
  const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/;
  on('GET', /^\/facilities\/management-sheets$/, async () => msOut(msNormalize(readJson(MS_KEY(), null))));
  on('PUT', /^\/facilities\/management-sheets$/, async (m, q, b) => {
    const no = needAdmin(); if (no) return no;
    b = b || {};
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return err(422, 'enabled は true か false で指定してください');
    for (const k of ['patient_db_url', 'prescription_db_url']) {
      if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') return err(422, k + ' は文字列で指定してください');
      if (String(b[k] || '').length > 1000) return err(422, k + ' は1000文字以内で入力してください');
    }
    const url = (v) => { const s = String(v || '').trim(); if (s && !SHEET_URL.test(s)) throw Object.assign(new Error('GoogleスプレッドシートのURLを入力してください'), { status: 400 }); return s; };
    let value;
    try { value = { enabled: b.enabled === true, patient_db_url: url(b.patient_db_url), prescription_db_url: url(b.prescription_db_url) }; } catch (e) { return err(e.status || 400, e.message); }
    if (value.enabled && !value.patient_db_url) return err(400, '患者DBのURLを入力してください');
    writeJson(MS_KEY(), value);
    return msOut(value);
  });

  // ================================================================
  // ③ 帳票（後発品使用量集計表・向精神薬投与患者一覧）
  // ================================================================
  let flagsP = null;
  function drugFlags() {
    if (!flagsP) flagsP = C.realFetch('compat/drug_flags.json').then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.rows) || {}).catch(() => { flagsP = null; return {}; });
    return flagsP;
  }
  // 直近 3 か月（基準版 generic_usage_months と同じ）
  function reportMonths(endMonth) {
    const [y, mo] = endMonth.split('-').map(Number); const out = [];
    for (const off of [2, 1, 0]) { const s = y * 12 + mo - 1 - off; out.push(Math.floor(s / 12) + '-' + pad2((s % 12) + 1)); }
    return out;
  }
  const nextMonthFirst = (ym) => { const [y, mo] = ym.split('-').map(Number); return (mo === 12 ? y + 1 : y) + '-' + pad2(mo === 12 ? 1 : mo + 1) + '-01'; };
  function reportArgs(q) {
    const endMonth = q.get('end_month') || '', fid = q.get('facility_id');
    if (!fid) return { bad: err(422, 'facility_id を指定してください') };
    if (fid !== clinicId()) return { bad: err(403, 'この施設の集計は表示できません') };
    if (!/^\d{4}-\d{2}$/.test(endMonth)) return { bad: err(422, '対象月はYYYY-MM形式で指定してください') };
    const mo = Number(endMonth.slice(5)); if (mo < 1 || mo > 12) return { bad: err(400, '対象月はYYYY-MM形式で指定してください') };
    const months = reportMonths(endMonth);
    return { months, from: months[0] + '-01', to: nextMonthFirst(months[2]) };
  }
  // その院の期間内の来院（記録つき）を全部読む
  async function visitsBetween(from, to) {
    const c = await db(); const out = []; const PAGE = 500;
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await c.from('visits').select('id,visit_date,patient_id,created_at,kartes(base_record),prescriptions(*),patients(id,patient_no,name,insurance_type,receipt_extra)')
        .eq('clinic_id', clinicId()).gte('visit_date', from).lt('visit_date', to).order('visit_date', { ascending: true }).order('id', { ascending: true }).range(off, off + PAGE - 1);
      if (error) throw new Error('記録を読めませんでした: ' + error.message);
      out.push(...(data || [])); if (!data || data.length < PAGE) break;
    }
    return out;
  }
  // 記録の処方（基準版の画面で書いた記録は base_record・それ以外は処方の表）
  function prescriptionsOf(v) {
    const k = one(v.kartes); const b = k && k.base_record;
    if (b) return b.is_deleted ? [] : (b.prescriptions || []).filter((p) => p && p.status !== 'cancelled' && p.is_active !== false);
    return (v.prescriptions || []).map((r) => ({ drug_code: r.drug_code, drug_name: r.drug_name, dosage: r.quantity != null ? String(r.quantity) : null, days: r.days, total_quantity: r.quantity }));
  }
  const truthy = (x) => x === true || ['true', '1', 'yes', 'on'].includes(String(x == null ? '' : x).trim().toLowerCase());
  const GEN_CLASS = ['2', 'generic', '後発', '後発品', '後発医薬品'], ELIG_CLASS = ['1', '2', 'brand', 'generic', '先発', '先発品', '後発', '後発品', '後発医薬品'];
  // 基準版と同じ使用量: 総量（0 以外）、無ければ 用量（数字だけのとき）×日数
  function quantityOf(p) {
    const t = Number(p.total_quantity); if (Number.isFinite(t) && t !== 0) return t;
    const d = String(p.dosage == null ? '' : p.dosage); if (/^\s*[0-9]+(\.[0-9]+)?\s*$/.test(d)) return Number(d.trim()) * Math.max(parseInt(p.days || 1, 10) || 1, 1);
    return 0;
  }
  // 基準版の患者一覧の保険の表示（billings.py と同じ対応）
  function insuranceLabel(t) {
    const s = String(t || '').toLowerCase();
    if (['elderly', 'kouki', 'late_elderly'].includes(s)) return '後期';
    if (['national', 'kokuho'].includes(s)) return '国保';
    if (['social', 'shaho', 'union', 'mutual', 'seamen'].includes(s)) return '社保';
    if (['labor', 'workers', 'workers_comp'].includes(s)) return '労災';
    if (['auto', 'auto_liability', 'automobile'].includes(s)) return '自賠責';
    if (['self_pay', 'private'].includes(s)) return '自費';
    return t || '';
  }
  async function facilityName() {
    try { const c = await db(); const { data } = await c.from('clinics').select('name').eq('id', clinicId()).maybeSingle(); return (data && data.name) || ''; } catch (e) { return ''; }
  }
  const issuedAt = () => { const d = new Date(); return localDate(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  on('GET', /^\/billings\/reports\/generic-drug-usage$/, async (m, q) => {
    const a = reportArgs(q); if (a.bad) return a.bad;
    const flags = await drugFlags(); const sums = {};
    a.months.forEach((mm) => { sums[mm] = [0, 0, 0, 0, 0, 0]; });
    for (const v of await visitsBetween(a.from, a.to)) {
      const mm = String(v.visit_date).slice(0, 7); if (!sums[mm]) continue;
      for (const p of prescriptionsOf(v)) {
        if (!String(p.drug_code || '') && !String(p.drug_name || '')) continue;
        const f = flags[String(p.drug_code || '')] || [0, '0', 0, ''];
        const gc = String(p.generic_class || '').toLowerCase();
        const isGeneric = truthy(p.is_generic) || f[0] === 1 || GEN_CLASS.includes(gc);
        const isEligible = isGeneric || f[2] === 1 || ELIG_CLASS.includes(gc);
        const excluded = false;   // 出荷停止等で除外する品目（基準版の薬価基準収載品目リストの備考）は統合版に無い
        const qty = quantityOf(p), s = sums[mm];
        s[0] += qty; if (isEligible) s[1] += qty; if (isGeneric) s[2] += qty;
        if (!excluded) { s[3] += qty; if (isEligible) s[4] += qty; if (isGeneric) s[5] += qty; }
      }
    }
    return { date_from: a.months[0], date_to: a.months[2], issued_at: issuedAt(), facility_name: await facilityName(),
      months: a.months.map((mm) => { const s = sums[mm]; return { month: mm, all_quantity: s[0], eligible_quantity: s[1], generic_quantity: s[2], generic_ratio: s[1] ? s[2] / s[1] * 100 : 0,
        excluded_all_quantity: s[3], excluded_eligible_quantity: s[4], excluded_generic_quantity: s[5], excluded_generic_ratio: s[4] ? s[5] / s[4] * 100 : 0 }; }) };
  });
  // 基準版の向精神薬の分類（billings.py の正規表現と同じ語・同じ順）
  const PSY_GROUPS = [
    ['sleeping', /(睡眠|不眠|催眠|ゾルピデム|エスゾピクロン|ゾピクロン|スボレキサント|レンボレキサント|ラメルテオン|トリアゾラム|ブロチゾラム|フルニトラゼパム|ニトラゼパム|エスタゾラム|リルマザホン|クアゼパム|ロルメタゼパム)/],
    ['anxiolytic', /(抗不安|エチゾラム|ロラゼパム|アルプラゾラム|ブロマゼパム|ジアゼパム|クロチアゼパム|タンドスピロン|トフィソパム|ヒドロキシジン)/],
    ['antidepressant', /(抗うつ|セルトラリン|エスシタロプラム|パロキセチン|フルボキサミン|デュロキセチン|ベンラファキシン|ミルタザピン|トラゾドン|ボルチオキセチン|アミトリプチリン|イミプラミン|クロミプラミン)/],
    ['antipsychotic', /(抗精神病|統合失調|リスペリドン|オランザピン|クエチアピン|アリピプラゾール|ブレクスピプラゾール|ハロペリドール|クロルプロマジン|レボメプロマジン|パリペリドン|ルラシドン|アセナピン|クロザピン)/],
  ];
  on('GET', /^\/billings\/reports\/psychotropic-patients$/, async (m, q) => {
    const a = reportArgs(q); if (a.bad) return a.bad;
    const flags = await drugFlags(); const enc = [];
    for (const v of await visitsBetween(a.from, a.to)) {
      const counts = { anxiolytic: new Set(), sleeping: new Set(), antidepressant: new Set(), antipsychotic: new Set(), all: new Set() };
      for (const p of prescriptionsOf(v)) {
        const code = String(p.drug_code || ''); if (!code && !String(p.drug_name || '')) continue;
        const f = flags[code] || [0, '0', 0, ''];
        const text = [f[3], p.generic_name, p.drug_name].filter(Boolean).join(' ').toLowerCase();
        let group = null; for (const [g, re] of PSY_GROUPS) { if (re.test(text)) { group = g; break; } }
        if (!group && f[1] === '5') group = 'other';
        if (!group) continue;
        const key = code || String(p.drug_name || '');
        if (counts[group]) counts[group].add(key); counts.all.add(key);
      }
      if (!counts.all.size) continue;
      const k = one(v.kartes); const b = (k && k.base_record) || {};
      const billingType = b.billing && b.billing.is_active !== false && b.billing.status !== 'cancelled' ? b.billing.insurance_type : null;
      const recType = C.records && C.records.recordOf ? C.records.recordOf(v, false).insurance_type : null;
      const p = v.patients || {};
      enc.push({ patient_id: v.patient_id, patient_no: p.patient_no || '', patient_name: p.name || '', insurance: insuranceLabel(billingType || recType || p.insurance_type), visit_date: v.visit_date,
        anxiolytic_count: counts.anxiolytic.size, sleeping_count: counts.sleeping.size, antidepressant_count: counts.antidepressant.size, antipsychotic_count: counts.antipsychotic.size });
    }
    enc.sort((x, y) => String(x.patient_no).localeCompare(String(y.patient_no)) || String(x.patient_name).localeCompare(String(y.patient_name)) || String(x.visit_date).localeCompare(String(y.visit_date)));
    const KEYS = ['any', 'antidepressant_or_antipsychotic', 'antidepressant', 'antipsychotic', 'multi_drug', 'anxiolytic_three', 'sleeping_three', 'antidepressant_or_antipsychotic_three', 'antidepressant_three', 'antipsychotic_three', 'anxiolytic_sleeping_four'];
    const flagsBy = {};
    const rows = enc.map((r) => {
      const ax = r.anxiolytic_count, sl = r.sleeping_count, ad = r.antidepressant_count, ap = r.antipsychotic_count;
      const multi = ax >= 3 || sl >= 3 || ad >= 3 || ap >= 3 || ax + sl >= 4;
      const f = flagsBy[r.patient_id] = flagsBy[r.patient_id] || Object.fromEntries(KEYS.map((k) => [k, false]));
      f.any = true; f.antidepressant_or_antipsychotic ||= ad > 0 || ap > 0; f.antidepressant ||= ad > 0; f.antipsychotic ||= ap > 0; f.multi_drug ||= multi;
      f.anxiolytic_three ||= ax >= 3; f.sleeping_three ||= sl >= 3; f.antidepressant_or_antipsychotic_three ||= ad >= 3 || ap >= 3; f.antidepressant_three ||= ad >= 3; f.antipsychotic_three ||= ap >= 3; f.anxiolytic_sleeping_four ||= ax + sl >= 4;
      return Object.assign({}, r, { multi_drug: multi });
    });
    const summary = Object.fromEntries(KEYS.map((k) => [k, Object.values(flagsBy).filter((f) => f[k]).length]));
    return { date_from: a.months[0], date_to: a.months[2], issued_at: issuedAt(), rows, summary };
  });

  // ================================================================
  // ④ 患者番号・前回の受付
  // ================================================================
  async function nextPatientNo() {
    const c = await db(); const nos = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await c.from('patients').select('patient_no').eq('clinic_id', clinicId()).range(off, off + 999);
      if (error) throw new Error('患者番号を読めませんでした: ' + error.message);
      (data || []).forEach((r) => { if (r.patient_no) nos.push(String(r.patient_no)); }); if (!data || data.length < 1000) break;
    }
    const used = new Set(nos);
    const nhc = nos.map((x) => (x.match(/^NHC-(\d+)$/) || [])[1]).filter(Boolean).map(Number);
    const digits = nos.filter((x) => /^[0-9]+$/.test(x)).map(Number);
    let n, fmt;
    if (nhc.length || !digits.length) { n = (nhc.length ? Math.max(...nhc) : 0) + 1; fmt = (k) => 'NHC-' + String(k).padStart(4, '0'); }
    else { n = Math.max(...digits) + 1; fmt = (k) => String(k).padStart(5, '0'); }   // 数字だけの番号の院は基準版と同じ 5 桁
    while (used.has(fmt(n))) n++;
    return fmt(n);
  }
  on('GET', /^\/patients\/next-number$/, async () => ({ patient_no: await nextPatientNo() }));
  const createPatient = routeOf('POST', /^\/patients$/);
  if (createPatient) on('POST', /^\/patients$/, async (m, q, b) => {
    // 画面に出した候補より新しい登録があっても、保存の時点の次番号で登録する（基準版と同じ）
    if (b && b.auto_patient_no) b = Object.assign({}, b, { patient_no: await nextPatientNo() });
    return createPatient(m, q, b);
  });
  on('GET', /^\/receptions\/patient\/([^/]+)\/previous-context$/, async (m, q) => {
    const pid = decodeURIComponent(m[1]); if (!UUID.test(pid)) return err(422, '患者の ID が正しくありません');
    const before = q.get('before_date'); if (!/^\d{4}-\d{2}-\d{2}$/.test(before || '')) return err(422, 'before_date を YYYY-MM-DD で指定してください');
    const bt = q.get('before_time'); if (bt && !/^\d{2}:\d{2}(:\d{2})?$/.test(bt)) return err(422, 'before_time を HH:MM で指定してください');
    const ex = q.get('exclude_reception_id'); if (ex && !UUID.test(ex)) return err(422, 'exclude_reception_id が正しくありません');
    const beforeTime = bt ? (bt.length === 5 ? bt + ':00' : bt) : '23:59:59';
    const c = await db();
    const { data, error } = await c.from('visits').select('id,visit_date,visit_time,arrived_at,doctor,department,status,created_at').eq('clinic_id', clinicId()).eq('patient_id', pid).lte('visit_date', before);
    if (error) return err(500, error.message);
    const t = (v) => { const s = String(v.arrived_at || v.visit_time || '23:59:59'); return s.length === 5 ? s + ':00' : s.slice(0, 8); };
    const prev = (data || []).filter((v) => !['cancel', 'cancelled'].includes(v.status) && (!ex || v.id !== ex) && (v.visit_date < before || (v.visit_date === before && t(v) <= beforeTime)))
      .sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)) || t(b).localeCompare(t(a)) || String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    const d = prev.find((v) => String(v.doctor || '').trim()), dep = prev.find((v) => String(v.department || '').trim());
    return { doctor_id: null, doctor_name: d ? String(d.doctor).trim() : null, department: dep ? String(dep.department).trim() : null };
  });

  // ================================================================
  // ⑤ 記録（算定・処方グループ・薬セット・診療行為の一括）
  // ================================================================
  const R = () => { if (!C.records) throw new Error('置き換え層の読み込み順が正しくありません（compat_records.js）'); return C.records; };
  async function recordVisit(id) {
    const v = await R().visitById(id); if (!v) return null;
    const k = one(v.kartes); const base = (k && k.base_record) || R().synth(v, k);
    if (base.is_deleted) return null;
    return { v, k, base };
  }
  const paidLocked = (base) => { const st = base && base.billing; return !!(st && st.is_active !== false && st.status !== 'cancelled' && Number(st.paid_amount) > 0); };
  const frozen = (list, vid, tag) => (list || []).map((x, i) => (x && x.id ? x : Object.assign({ id: vid + '-' + tag + i }, x)));
  // 処方を書き換え、院内の薬剤料を作り直して保存する（カルテ保存・compat_writes_daily.js と同じ保存処理）
  async function writePrescriptions(rec, list, extraPatch) {
    let fees;
    try { fees = await R().internalDrugFees(list, rec.v.visit_date); } catch (e) { return { bad: err(400, e.message) }; }
    const billings = frozen(rec.base.billings, rec.v.id, 'bl').filter((b) => !(b.item_type === 'drug' && String(b.billing_name || '').startsWith('薬剤料（院内）'))).concat(fees.fees);
    const b = await R().writeRecord(rec.v, Object.assign({ prescriptions: fees.prescriptions, billings }, extraPatch || {}), { rx: true, billing: true });
    return { version: b.version };
  }
  const isSelfPay = (b) => !!(b.is_self_pay || b.item_type === 'self_pay' || String(b.category || '') === '自費' || String(b.billing_code || '').startsWith('SELF_'));
  // 基準版 BillingCreate の検査
  function billingIn(x, i) {
    if (!x || typeof x !== 'object') return { error: (i + 1) + '件目の算定が正しくありません' };
    if (typeof x.billing_code !== 'string' || typeof x.billing_name !== 'string') return { error: (i + 1) + '件目: 算定のコードと名称を指定してください' };
    if (!isInt(x.points)) return { error: (i + 1) + '件目: 点数は整数で指定してください' };
    if (x.quantity !== undefined && x.quantity !== null && !isInt(x.quantity)) return { error: (i + 1) + '件目: 回数は整数で指定してください' };
    return { row: { billing_code: x.billing_code, billing_name: x.billing_name, points: x.points, quantity: x.quantity == null ? 1 : x.quantity, category: x.category ?? null, item_type: x.item_type ?? null,
      amount: x.amount ?? 0, unit_price: x.unit_price ?? 0, drug_quantity: x.drug_quantity ?? null, drug_unit: x.drug_unit ?? null, is_self_pay: !!x.is_self_pay,
      comment_codes: Array.isArray(x.comment_codes) ? x.comment_codes : [], comments: Array.isArray(x.comments) ? x.comments : [], free_comment: x.free_comment ?? null,
      receipt_position: x.receipt_position === undefined ? 'summary' : x.receipt_position, do_not_bill: !!x.do_not_bill, billing_group_id: x.billing_group_id ?? null,
      billing_group_parent_id: x.billing_group_parent_id ?? null, billing_group_label: x.billing_group_label ?? null, procedure_order: x.procedure_order ?? null } };
  }
  on('POST', /^\/records\/([0-9a-f-]{36})\/billings\/bulk$/, async (m, q, body) => {
    const list = body && body.billings;
    if (!Array.isArray(list) || list.length < 1 || list.length > 200) return err(422, '算定を1〜200件で指定してください');
    const rows = []; for (let i = 0; i < list.length; i++) { const r = billingIn(list[i], i); if (r.error) return err(422, r.error); rows.push(r.row); }
    for (const b of rows) {
      if (b.do_not_bill || isSelfPay(b) || !(b.item_type == null || b.item_type === 'action')) continue;
      const code = String(b.billing_code || '').trim();
      if (!/^[0-9]{9}$/.test(code)) return err(400, '診療行為「' + b.billing_name + '」のコードが不正です。9桁のレセ電コードでマスターから選択し直してください。内部IDは保存できません');
    }
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため算定を追加できません');
    const cur = frozen(rec.base.billings, rec.v.id, 'bl');
    const start = cur.reduce((mx, b) => Math.max(mx, Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : -1), -1) + 1;
    const add = rows.map((b, i) => Object.assign({ id: uid() }, b, { item_type: b.item_type || 'action', sort_order: start + i, procedure_order: b.procedure_order ?? start + i, created_at: nowIso() }));
    const saved = await R().writeRecord(rec.v, { billings: cur.concat(add) }, { billing: true });
    return { message: '算定を追加しました（' + add.length + '件）', created_ids: add.map((b) => b.id), record_version: saved.version };
  });
  on('DELETE', /^\/records\/([0-9a-f-]{36})\/billings\/([^/]+)$/, async (m) => {
    const id = decodeURIComponent(m[2]);
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    const list = frozen(rec.base.billings, rec.v.id, 'bl');
    const hit = list.map((b, i) => [b, i]).filter(([b]) => String(b.id) === id && b.item_type !== 'drug' && b.is_active !== false);
    if (!hit.length) return err(404, '取消可能な算定が見つかりません');
    if (hit.length > 1) return err(409, '同じ ID の算定が複数あります。カルテを開き直してから操作してください');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため算定を取り消せません');
    const [row, i] = hit[0]; const who = await userId();
    const cancelled = (rec.base.cancelled_actions || []).concat([Object.assign({}, row, { status: 'cancelled', is_active: false, cancelled_at: nowIso(), cancelled_by: who })]);
    const saved = await R().writeRecord(rec.v, { billings: list.filter((x, j) => j !== i), cancelled_actions: cancelled }, { billing: true });
    return { message: '算定を取り消しました', id, record_version: saved.version };
  });
  // 処方グループ（prescription_group_id が同じ処方）。取消済みは含めない
  const groupMembers = (list, gid) => list.map((p, i) => [p, i]).filter(([p]) => String(p.prescription_group_id || '') === gid && p.status !== 'cancelled' && p.is_active !== false);
  const decimalOk = (v) => v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) && Number(v) > 0;
  on('PUT', /^\/records\/([0-9a-f-]{36})\/prescription-groups\/([^/]+)$/, async (m, q, body) => {
    const gid = decodeURIComponent(m[2]); body = body || {};
    if (!['internal', 'external'].includes(body.dispensing_type)) return err(422, '院内・院外（internal・external）を指定してください');
    const freq = typeof body.frequency === 'string' ? body.frequency : '';
    if (freq.length < 1 || freq.length > 200) return err(422, '用法を1〜200文字で入力してください');
    if (!isInt(body.days) || body.days < 1 || body.days > 365) return err(422, '日数は1〜365で入力してください');
    const members = body.members;
    if (!Array.isArray(members) || members.length < 2) return err(422, '処方グループの薬を2つ以上指定してください');
    for (const x of members) { if (!x || !String(x.prescription_id || '').trim()) return err(422, '処方の ID を指定してください'); if (!decimalOk(x.dosage)) return err(422, '用量は0より大きい数で入力してください'); }
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    const list = frozen(rec.base.prescriptions, rec.v.id, 'rx'); const found = groupMembers(list, gid);
    if (found.length < 2) return err(404, '編集可能な処方グループが見つかりません');
    const reqIds = members.map((x) => String(x.prescription_id)); const stored = new Set(found.map(([p]) => String(p.id)));
    if (new Set(reqIds).size !== reqIds.length || reqIds.length !== stored.size || reqIds.some((x) => !stored.has(x))) return err(409, '処方グループの構成が更新されています。画面を再読み込みしてください');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため処方を変更できません');
    const next = list.slice(); const at = nowIso();
    members.forEach((x) => {
      const i = next.findIndex((p) => String(p.id) === String(x.prescription_id)); const dose = Number(x.dosage);
      next[i] = Object.assign({}, next[i], { dispensing_type: body.dispensing_type, dosage: String(x.dosage), frequency: freq.trim(), days: body.days, total_quantity: dose * body.days, updated_at: at });
    });
    const r = await writePrescriptions(rec, next); if (r.bad) return r.bad;
    return { group_id: gid, record_version: r.version, message: '処方グループを更新しました' };
  });
  on('DELETE', /^\/records\/([0-9a-f-]{36})\/prescription-groups\/([^/]+)$/, async (m) => {
    const gid = decodeURIComponent(m[2]);
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    const list = frozen(rec.base.prescriptions, rec.v.id, 'rx'); const found = groupMembers(list, gid);
    if (found.length < 2) return err(404, '取消可能な処方グループが見つかりません');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため処方を削除できません');
    const drop = new Set(found.map(([, i]) => i)); const who = await userId(); const at = nowIso();
    const cancelled = (rec.base.cancelled_prescriptions || []).concat(found.map(([p]) => Object.assign({}, p, { status: 'cancelled', is_active: false, cancelled_at: at, cancelled_by: who })));
    const r = await writePrescriptions(rec, list.filter((p, i) => !drop.has(i)), { cancelled_prescriptions: cancelled }); if (r.bad) return r.bad;
    return { message: '処方グループを取り消しました', count: found.length, record_version: r.version };
  });
  // 薬セット（基準版 prescription_sets の items と同じ形: [{ drugs: [{ drug_code, drug_name, dose_quantity, dose_unit, ... }], days, usage_name, ... }]）
  const RX_SET_KEY = () => 'karte_base_prescription_sets_' + clinicId();
  on('POST', /^\/records\/([0-9a-f-]{36})\/prescription-sets\/([^/]+)\/apply$/, async (m) => {
    const setId = decodeURIComponent(m[2]); if (!UUID.test(setId)) return err(422, '薬セットの ID が正しくありません');
    const rec = await recordVisit(m[1]); if (!rec) return err(404, 'カルテが見つかりません');
    if (rec.base.status === 'locked') return err(400, '確定済みカルテには処方を追加できません');
    const me = await userId();
    const sets = readJson(RX_SET_KEY(), []); const set = (Array.isArray(sets) ? sets : []).find((s) => s && s.id === setId && s.is_active !== false
      && (!s.owner_type || s.owner_type === 'system' || s.owner_type === 'facility' || (s.owner_type === 'personal' && s.owner_id === me)));
    if (!set) return err(404, '薬セットが見つかりません');
    let items = set.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { return err(422, '薬セットの内容が不正です'); } }
    if (!Array.isArray(items) || !items.length) return err(422, '薬セットに薬が登録されていません');
    const list = frozen(rec.base.prescriptions, rec.v.id, 'rx');
    let order = list.reduce((mx, p) => Math.max(mx, Number.isFinite(Number(p.sort_order)) ? Number(p.sort_order) : -1), -1) + 1;
    const add = [];
    items.forEach((item, itemIndex) => {
      if (!item || typeof item !== 'object') return;
      const drugs = Array.isArray(item.drugs) ? item.drugs : []; if (!drugs.length) return;
      const group = drugs.length > 1 ? uid() : null;
      drugs.forEach((d, di) => {
        if (!d || typeof d !== 'object') return;
        const dose = Number(d.dose_quantity || 0), days = parseInt(item.days || 1, 10) || 1;
        const rx = { id: uid(), drug_code: String(d.drug_code || '').trim() || null, drug_name: String(d.drug_name || '').trim(), generic_name: d.generic_name || null,
          dosage: String(dose), unit: String(d.dose_unit || '').trim(), frequency: String(item.usage_name || '').trim(), days, total_quantity: dose * days,
          unit_price: d.unit_price != null ? Number(d.unit_price) : null, is_generic: !!d.is_generic, drug_type: item.dosage_form_type || 'internal', instructions: item.item_memo || null,
          dispensing_type: 'external', prescription_group_id: group, prescription_group_parent_id: group && di > 0 ? group : null,
          prescription_group_label: group ? 'RP' + (item.rp_number || itemIndex + 1) : null, sort_order: order, prescription_date: rec.v.visit_date, created_at: nowIso() };
        add.push(rx); order++;
      });
    });
    if (add.some((rx) => !rx.drug_name || !rx.unit || !rx.frequency || !(Number(rx.dosage) > 0))) return err(422, '薬セットに登録された用法・用量を確認してください');
    if (!add.length) return err(422, '薬セットに薬が登録されていません');
    const r = await writePrescriptions(rec, list.concat(add)); if (r.bad) return r.bad;
    set.use_count = (set.use_count || 0) + 1; set.last_used_at = nowIso(); writeJson(RX_SET_KEY(), sets);
    return { message: '薬セットを追加しました（' + add.length + '剤）', created_ids: add.map((x) => x.id), record_version: r.version };
  });
  // 診療行為の一括登録（基準版 record_actions.py の /bulk。1 件ずつの登録 POST /record-actions と同じ行を、1 回の保存で足す）
  async function resolveAction(code, name, unitScore) {
    const all = (await C.masterJson('s_procedures')) || {}; const e = all[code];
    if (!e) return { code, name, unit: unitScore };
    const pts = parseFloat(e.pts); return { code, name: C.cp932Name(e.name), unit: Number.isFinite(pts) ? Math.trunc(pts) : unitScore };
  }
  on('POST', /^\/record-actions\/bulk$/, async (m, q, body) => {
    body = body || {};
    if (!UUID.test(String(body.record_id || '')) || !UUID.test(String(body.patient_id || ''))) return err(422, 'カルテと患者を指定してください');
    if (!body.facility_id) return err(422, '施設を指定してください');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(body.action_date || ''))) return err(422, '実施日を指定してください');
    if (!Array.isArray(body.actions)) return err(422, '診療行為の一覧（actions）を指定してください');
    for (const a of body.actions) {
      const code = String((a && a.action_code) || '').trim();
      if (!code || code.length > 9) return err(422, '行為コードは1〜9桁で指定してください');
      if (typeof a.action_name !== 'string') return err(422, '行為名を指定してください');
      if (!isInt(a.unit_score)) return err(422, '点数は整数で指定してください');
    }
    if (String(body.facility_id) !== clinicId()) return err(403, 'この施設のカルテは操作できません');
    const rec = await recordVisit(body.record_id); if (!rec) return err(404, 'カルテが見つかりません');
    if (rec.base.status === 'locked') return err(400, '確定済みカルテは変更できません');
    if (rec.v.patient_id !== body.patient_id) return err(400, '患者とカルテが一致しません');
    if (paidLocked(rec.base)) return err(400, '入金済み会計があるため算定を追加できません');
    const list = frozen(rec.base.billings, rec.v.id, 'bl'); const date = String(body.action_date).slice(0, 10); const add = [];
    for (let i = 0; i < body.actions.length; i++) {
      const a = body.actions[i]; const r = await resolveAction(String(a.action_code).trim(), a.action_name, a.unit_score);
      add.push({ id: uid(), billing_code: r.code, billing_name: r.name, points: r.unit, quantity: Number(a.quantity) || 1, category: a.category_name ?? null, category_code: a.category_code ?? null, item_type: 'action',
        amount: 0, unit_price: 0, is_self_pay: false, comment_codes: a.comment_codes || [], comments: [], free_comment: a.free_comment ?? null, receipt_position: 'summary', do_not_bill: false,
        modifier_codes: a.modifier_codes ?? null, body_part: a.body_part ?? null, left_right: a.left_right ?? null, time_category: a.time_category || 'normal',
        action_date: date, status: 'performed', created_at: nowIso(), sort_order: list.length + i, procedure_order: list.length + i });
    }
    const saved = await R().writeRecord(rec.v, { billings: list.concat(add) }, { billing: true });
    return { message: add.length + '件の診療行為を登録しました', created_ids: add.map((x) => x.id), record_version: saved.version };
  });

  // ================================================================
  // ⑥ マスター（医薬品の詳細・自費マスターの適用期間）
  // ================================================================
  // 9 桁の医薬品コードは既存の処理（先に登録されている）。それ以外は基準版と同じく「見つからない」
  on('GET', /^\/masters\/drugs\/((?!search$)[^/]+)$/, async () => err(404, '医薬品が見つかりません'));
  const selfPayList = routeOf('GET', /^\/billings\/self-pay\/master$/);
  if (selfPayList) on('GET', /^\/billings\/self-pay\/master$/, async (m, q, b) => {
    const res = await selfPayList(m, q, b);
    if (!Array.isArray(res) || q.get('include_out_of_period') === 'true') return res;
    const d = today();
    return res.filter((r) => (!r.start_date || String(r.start_date).slice(0, 10) <= d) && (!r.end_date || String(r.end_date).slice(0, 10) >= d));
  });
})();
