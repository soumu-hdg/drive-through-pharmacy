// ===== 置き換え層：統合版の独自機能を基準版の画面でも動かす（担当C・2026-09-24） compat_features_c.js =====
// compat_records.js・compat_autocalc.js の処理は変えず、C.routeOf で取り出した元の処理を包む。
//   ① 在庫連動   … 保存確定（/records/save）で院内処方の在庫を減らし、記録の削除で戻す（復元でもう一度減らす）。
//                   統合版（inventory_stock.js）と同じ RPC 2 本・同じ受診の印「院ID|患者番号|診療日」・同じ規則
//                   （院内処方だけ／在庫を追うかは pharmacy_v_medicines.stock_untracked だけで判定／名寄せできない薬は画面に出す）。
//                   ★在庫の表には院の区別が無い（全院で 1 つ）。テスト用クリニックでは本番の在庫を動かさないよう、
//                     テスト用の RPC（…_test）があればそれを、無ければ「動かす予定」を出すだけにする
//   ② 算定ルール … 統合版の院ごとの選択（karte_santei_rules：on／off／unset）を正として、基準版の「自動算定する診療行為」
//                   （標準算定の行）の有効・無効に写す。基準版の画面で行を削除・有効にしたときは逆に選択へ書き戻す。
//                   選択の行が無い加算はどちらの画面も従来どおりの既定のまま（既定を変えると黙って算定が減るため）
//   ③ 様式14     … 画面の部品は compat_ui_features.js（担当C の部分）。ここでは統合版の部品を読み込む口だけ持つ
(function () {
  const C = window.__compat; if (!C) return;
  const { on, ready, clinicId, routeOf } = C;
  const nowIso = () => new Date().toISOString();
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const isErr = (res) => res instanceof Response && res.status >= 400;
  const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* 画面が無いときは何もしない */ } };

  // ---- 統合版の部品（app/*.js）を基準版の画面に読み込む。1 回だけ ----
  const loaded = new Map();
  function loadAppScript(file, globalName) {
    if (globalName && typeof window[globalName] !== 'undefined') return Promise.resolve(true);
    if (!loaded.has(file)) loaded.set(file, new Promise((resolve) => {
      const s = document.createElement('script'); s.src = '../' + file; s.async = false;
      s.onload = () => resolve(true); s.onerror = () => { console.warn('[置き換え層] 読み込めません', file); resolve(false); };
      document.head.appendChild(s);
    }));
    return loaded.get(file);
  }
  function loadAppStyle(file) {
    if (document.querySelector('link[data-app-style="' + file + '"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../' + file; l.setAttribute('data-app-style', file);
    document.head.appendChild(l);
  }

  // ======================================================================
  // ① 在庫連動
  // ======================================================================
  const INHOUSE = ['院内', 'internal', 'inhouse', 'in-house'];   // compat_records.js の院内処方の判定と同じ
  const isInhouse = (rx) => INHOUSE.includes(String(rx.dispensing_type || rx.prescription_type || ''));
  // 薬品名の正規化は統合版（inventory_stock.js の invNorm）をそのまま使う。読めないときだけ同じ中身の控えを使う
  const normName = (s) => {
    if (typeof window.invNorm === 'function') return window.invNorm(s);
    if (!s) return ''; s = String(s).normalize('NFKC').replace(/[\s　]/g, '').replace(/(錠|カプセル|OD|塩酸塩|カリウム|塩)/g, ''); return s.toLowerCase();
  };
  // 在庫の薬品一覧（在庫アプリと同じビュー）
  let invRows = null, invAt = 0;
  async function inventoryRows(force) {
    if (!force && invRows && Date.now() - invAt < 60000) return invRows;
    const c = await ready();
    const { data, error } = await c.from('pharmacy_v_medicines').select('code,name,unit,current_stock,stock_untracked,rezept_code,rezept_code2,active').eq('active', true).order('code');
    if (error) throw new Error('在庫の薬品一覧を読めません: ' + error.message);
    invRows = data || []; invAt = Date.now(); return invRows;
  }
  // 処方 1 行 → 在庫の薬品コード。基準版の処方は公式の薬品コード（9 桁）を持つので、まずそれで引き、
  // 無ければ統合版と同じ名前の正規化で引く。複数の在庫品目に当たるときは決めつけずに「結び付かない」とする
  function resolveDrug(rows, rx) {
    const code = String(rx.drug_code || '').trim(), nn = normName(rx.drug_name);
    if (/^\d{9}$/.test(code)) {
      const hits = rows.filter((r) => r.rezept_code === code || r.rezept_code2 === code);
      if (hits.length === 1) return { code: hits[0].code };
      if (hits.length > 1) {
        const byName = hits.filter((r) => normName(r.name) === nn);
        return byName.length === 1 ? { code: byName[0].code } : { reason: '在庫の薬品が複数当たる（' + hits.map((h) => h.code).join('・') + '）' };
      }
    }
    const byName = rows.filter((r) => normName(r.name) === nn);
    if (byName.length === 1) return { code: byName[0].code };
    if (byName.length > 1) return { reason: '在庫の薬品が複数当たる（' + byName.map((h) => h.code).join('・') + '）' };
    return { reason: null };
  }
  // RPC の呼び先。在庫の表に院の区別が無いので、テスト用クリニックは …_test（テスト用の在庫の枠）へ向ける
  const INV = {
    rpcName: (base) => (clinicId() === 'test' ? base + '_test' : base),
    // 呼び出し口（検証の台本はここを差し替えて、本番の在庫に触れずに確かめる）
    transport: async (fn, args) => { const c = await ready(); return c.rpc(fn, args); },
    last: null,
  };
  const missingFn = (e) => e && (e.code === 'PGRST202' || /Could not find the function|does not exist/i.test(String(e.message || '')));
  async function visitInfo(vid) {
    const c = await ready();
    const { data, error } = await c.from('visits').select('id,visit_date,clinic_id,patients(patient_no,name),kartes(base_record)').eq('id', vid).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const visitKey = (v) => clinicId() + '|' + ((v.patients && v.patients.patient_no) || '') + '|' + v.visit_date;
  const operator = () => { const u = C.state && C.state.user; return (u && u.login_id) || 'karte'; };

  async function dispenseVisit(vid) {
    const v = await visitInfo(vid); if (!v) return null;
    const b = (one(v.kartes) || {}).base_record; if (!b || b.is_deleted) return null;
    const rxs = (b.prescriptions || []).filter(isInhouse);   // 院外処方は在庫を動かさない
    if (!rxs.length) return null;
    const rows = await inventoryRows(false);
    const items = [], unresolved = [];
    rxs.forEach((rx) => {
      const qty = Math.round(Number(rx.total_quantity) || 0);   // 院内処方の総量（1回量×回数×日数。外用は1回分）＝統合版の「1回量×日数」と同じ量
      if (qty <= 0) return;
      const r = resolveDrug(rows, rx);
      if (!r.code) { unresolved.push((rx.drug_name || '(名称なし)') + (r.reason ? '・' + r.reason : '')); return; }
      items.push({ code: r.code, qty, name: rx.drug_name || '' });
    });
    if (!items.length && !unresolved.length) return null;
    const args = { p_visit_id: visitKey(v), p_patient_no: (v.patients && v.patients.patient_no) || '', p_patient_name: (v.patients && v.patients.name) || '',
      p_operator: operator(), p_occurred_on: v.visit_date, p_items: items };
    let out;
    const res = await INV.transport(INV.rpcName('pharmacy_dispense_from_karte'), args);
    if (res && res.error && clinicId() === 'test' && missingFn(res.error)) {
      out = { dryRun: true, planned: items.map((i) => ({ code: i.code, name: i.name, qty: i.qty })) };   // テスト用の在庫の枠が無い
    } else if (res && res.error) {
      out = { error: res.error.message || '在庫の更新に失敗しました' };
    } else {
      out = Object.assign({}, (res && res.data) || {});
    }
    out.unresolved = unresolved; out.visit = args.p_visit_id; out.kind = 'dispense';
    invRows = null;   // 次は在庫数を読み直す
    INV.last = out; emit('compat:inventory', out);
    return out;
  }
  async function cancelVisit(v) {
    if (!v) return null;
    const res = await INV.transport(INV.rpcName('pharmacy_cancel_karte_dispense'), { p_visit_id: visitKey(v), p_operator: operator() });
    let out;
    if (res && res.error && clinicId() === 'test' && missingFn(res.error)) out = { dryRun: true, restored: [] };
    else if (res && res.error) { console.warn('[置き換え層] 在庫の戻しに失敗', res.error); out = { error: res.error.message || '在庫を戻せませんでした', restored: [] }; }
    else out = Object.assign({ restored: [] }, (res && res.data) || {});
    out.kind = 'cancel'; out.visit = visitKey(v);
    invRows = null; INV.last = out; emit('compat:inventory', out);
    return out;
  }
  // 保存確定のあとで減らす（保存そのものは元の処理のまま。在庫の失敗で保存を失敗にしない）
  const SAVE_RE = /^\/records\/save\/?$/;
  ['POST', 'PUT'].forEach((method) => {
    const orig = routeOf(method, SAVE_RE); if (!orig) return;
    on(method, SAVE_RE, async (m, q, body) => {
      const res = await orig(m, q, body);
      if (isErr(res) || !(res && res.id)) return res;
      try { res.inventory = await dispenseVisit(res.id); } catch (e) { console.warn('[置き換え層] 在庫の反映に失敗', e); emit('compat:inventory', { kind: 'dispense', error: String(e.message || e), unresolved: [] }); }
      return res;
    });
  });
  // 記録の削除で戻す・復元でもう一度減らす
  const ONE_RE = /^\/records\/([0-9a-f-]{36})$/, RESTORE_RE = /^\/records\/([0-9a-f-]{36})\/restore$/;
  const origDelete = routeOf('DELETE', ONE_RE);
  if (origDelete) on('DELETE', ONE_RE, async (m, q, body) => {
    let v = null; try { v = await visitInfo(m[1]); } catch (e) { /* 読めなくても削除は元の処理に任せる */ }
    const res = await origDelete(m, q, body);
    if (!isErr(res) && v) { try { await cancelVisit(v); } catch (e) { console.warn('[置き換え層] 在庫の戻しに失敗', e); } }
    return res;
  });
  const origRestore = routeOf('POST', RESTORE_RE);
  if (origRestore) on('POST', RESTORE_RE, async (m, q, body) => {
    const res = await origRestore(m, q, body);
    if (!isErr(res)) {
      try { const v = await visitInfo(m[1]); const b = v && (one(v.kartes) || {}).base_record; if (b && b.status === 'confirmed') await dispenseVisit(m[1]); }
      catch (e) { console.warn('[置き換え層] 在庫の反映に失敗', e); }
    }
    return res;
  });

  // ======================================================================
  // ② 算定ルール（院ごとの選択式）
  // ======================================================================
  // 統合版の選択（santei_rules.js の CATALOG の key） ↔ 基準版の標準算定の行（condition_key）。
  // 基準版に対応する行が無い加算（サーベイランス強化加算など）は写さない（統合版の画面だけで効く）
  const RULE_MAP = {
    kinou_kyouka: ['initial_clinic_function_enhancement'],
    bukka: ['initial_price_support_1', 'revisit_price_support_1'],
    baseup: ['initial_baseup_1_wage'],
    gairai_kansen: ['initial_outpatient_infection_control'],
    renkei_kyouka: ['initial_infection_collaboration'],
  };
  const KEY_OF = {}; Object.keys(RULE_MAP).forEach((k) => RULE_MAP[k].forEach((ck) => { KEY_OF[ck] = k; }));
  const TABLE = 'karte_santei_rules';
  const AKEY = (fid) => 'karte_base_autocalc_actions_' + fid;   // compat_autocalc.js と同じ置き場
  const condKey = (row) => (row && row.trigger_condition && row.trigger_condition.condition_key) || null;
  async function readRules() {
    const c = await ready();
    const { data, error } = await c.from(TABLE).select('rule_key,mode').eq('clinic_id', clinicId());
    if (error) throw new Error('算定ルールを読めません: ' + error.message);
    const r = {}; (data || []).forEach((x) => { r[x.rule_key] = x.mode || 'unset'; }); return r;
  }
  async function writeRule(key, mode) {
    const c = await ready();
    const { error } = await c.from(TABLE).upsert({ clinic_id: clinicId(), rule_key: key, mode, updated_at: nowIso(), updated_by: operator() }, { onConflict: 'clinic_id,rule_key' });
    if (error) throw new Error('算定ルールを保存できません: ' + error.message);
    if (typeof window.SanteiRules !== 'undefined') { try { await window.SanteiRules.load(true); } catch (e) { /* 表示用の控え */ } }
  }
  const readRows = (fid) => { try { return JSON.parse(C.store.getItem(AKEY(fid)) || '[]') || []; } catch (e) { return []; } };
  // 選択のある加算だけ、基準版の行の有効・無効を合わせる（on＝有効、off・unset＝無効。選択の行が無ければ触らない）
  function applyRules(rows, rules) {
    let changed = false;
    rows.forEach((row) => {
      const key = KEY_OF[condKey(row)]; if (!key || !(key in rules)) return;
      const want = rules[key] === 'on';
      if (!!row.is_active !== want) { row.is_active = want; row.updated_at = nowIso(); changed = true; }
    });
    return changed;
  }
  const ACT_RE = /^\/auto-calculation\/actions\/([^/]+)$/, ACT_ONE_RE = /^\/auto-calculation\/actions\/([^/]+)\/([^/]+)$/;
  const INIT_RE = /^\/auto-calculation\/actions\/([^/]+)\/initialize-standard$/, CALC_RE = /^\/auto-calculation\/?$/;
  const origList = routeOf('GET', ACT_RE);
  async function syncBase(fid) {
    fid = fid || clinicId(); if (fid !== clinicId() || !origList) return false;
    await origList(['', fid], new URLSearchParams(), {});   // 標準の行が無ければ作らせる（compat_autocalc.js）
    const rows = readRows(fid); const rules = await readRules();
    if (!applyRules(rows, rules)) return false;
    C.store.setItem(AKEY(fid), JSON.stringify(rows)); return true;
  }
  const fidOf = (m) => decodeURIComponent(m[1] || '') || clinicId();
  if (origList) on('GET', ACT_RE, async (m, q, body) => { await syncBase(fidOf(m)); return origList(m, q, body); });
  const origCalc = routeOf('POST', CALC_RE);
  // 基準版の自動算定は、標準算定の行とは別に「算定ルール」（初診時の物価対応料・ベースアップ評価料など）からも候補を出す。
  // 選択が「算定しない」「未設定」の加算は、どこから出た候補でも外す（統合版の画面と同じ結果にする）
  const RULE_CODES = {
    kinou_kyouka: ['111013770'], bukka: ['180819910', '180820010'], baseup: ['180853810', '180853910'],
    gairai_kansen: ['111014870'], renkei_kyouka: ['111014970'],
  };
  if (origCalc) on('POST', CALC_RE, async (m, q, body) => {
    const fid = body && body.facility_id;
    if (fid) await syncBase(fid);
    const res = await origCalc(m, q, body);
    if (isErr(res) || !fid || fid !== clinicId() || !res || !Array.isArray(res.suggested_actions)) return res;
    const rules = await readRules(); const drop = new Set();
    Object.keys(RULE_CODES).forEach((k) => { if (k in rules && rules[k] !== 'on') RULE_CODES[k].forEach((c) => drop.add(c)); });
    const removed = res.suggested_actions.filter((a) => drop.has(String(a.code)));
    if (removed.length) {
      res.suggested_actions = res.suggested_actions.filter((a) => !drop.has(String(a.code)));
      res.info = (res.info || []).concat(['院ごとの算定ルールで算定しない加算を外しました: ' + removed.map((a) => a.name).join('、')]);
    }
    return res;
  });
  // 基準版の画面で行を有効・無効にしたら、統合版の選択へ書き戻す（初診・再診の 2 行ある加算は 2 行ともそろえる）
  async function writeBackFromRow(fid, id, active) {
    if (fid !== clinicId()) return;
    const row = readRows(fid).find((r) => r.id === id); const key = row && KEY_OF[condKey(row)]; if (!key) return;
    await writeRule(key, active ? 'on' : 'off'); await syncBase(fid);
    emit('compat:santei', { key, mode: active ? 'on' : 'off' });
  }
  const origPut = routeOf('PUT', ACT_ONE_RE);
  if (origPut) on('PUT', ACT_ONE_RE, async (m, q, body) => {
    const res = await origPut(m, q, body);
    if (!isErr(res) && body && body.is_active != null) await writeBackFromRow(fidOf(m), m[2], !!body.is_active);
    return res;
  });
  const origDel = routeOf('DELETE', ACT_ONE_RE);
  if (origDel) on('DELETE', ACT_ONE_RE, async (m, q, body) => {
    const res = await origDel(m, q, body);
    if (!isErr(res)) await writeBackFromRow(fidOf(m), m[2], false);
    return res;
  });
  // 「標準に戻す」は基準版では全行を有効に戻す。対応する選択が「算定しない」「未設定」なら「算定する」に合わせる
  const origInit = routeOf('POST', INIT_RE);
  if (origInit) on('POST', INIT_RE, async (m, q, body) => {
    const fid = fidOf(m);
    if (fid === clinicId()) { const rules = await readRules(); for (const k of Object.keys(RULE_MAP)) { if (k in rules && rules[k] !== 'on') await writeRule(k, 'on'); } }
    const res = await origInit(m, q, body); emit('compat:santei', { init: true }); return res;
  });

  // 統合版の選択の一覧（CATALOG・点数・既定）は santei_rules.js をそのまま使う
  const santeiReady = loadAppScript('santei_rules.js', 'SanteiRules');
  loadAppScript('inventory_stock.js', 'invNorm');

  C.featuresC = {
    loadAppScript, loadAppStyle,
    inventory: Object.assign(INV, { dispenseVisit, cancelVisit, inventoryRows, resolveDrug, visitKey }),
    santei: { RULE_MAP, RULE_CODES, KEY_OF, readRules, writeRule, syncBase, ready: santeiReady },
  };
})();
