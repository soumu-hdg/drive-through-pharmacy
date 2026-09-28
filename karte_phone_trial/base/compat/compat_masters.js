// ===== 置き換え層：公式マスターを Supabase の表から読む（工程4・2026-09-24） compat_masters.js =====
// 基準版のサーバーはマスターを DB の表から引いている。統合版も同じく Supabase の表（karte_master_*・全院共通・読み取りのみ）から引く。
//   ・全件が要るもの（自動算定・保険の選択肢・薬価の適用期間など）: window.__compat.masterSource(name) が表を全件読み（1000 行ずつ）、
//     今までの静的 JSON と同じ形に組み立てて返す。読んだものは同じ画面の間は使い回す。
//     件数が karte_master_meta の件数とそろわない・読めないときは null を返す（compat_api.js の masterJson が静的 JSON に戻る）
//   ・全件を読まなくてよい検索（診療行為・医薬品・傷病名・修飾語・一般名処方）は、表を直接検索する（Supabase の関数 karte_master_search_*）。
//     条件・並び順・件数・応答の形は今までの処理と同じ。名前の記号は基準版の読み方（C.cp932Name）にそろえてある（表の name_cp 列）
//   ・表と関数は tools/sql/2026-09-24_fix4_masters.sql、投入は tools/fix4_load_masters.mjs
(function () {
  // ---- 正規化（投入の道具 tools/fix4_load_masters.mjs も同じものを使う） ----
  const toHalf = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 基準版のサーバー（Python）の \s と同じ空白の集合
  const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const RE_PREFIX = new RegExp('^[【〖]' + WS + '*般' + WS + '*[】〗]'), RE_WS = new RegExp(WS + '+', 'g');
  // 一般名処方マスターの検索用の文字列・コード（基準版の normalize_general_prescription_text / _code / to_general_prescription_code と同じ）
  const gpText = (v) => String(v || '').normalize('NFKC').replace(RE_PREFIX, '').replace(RE_WS, '').toLowerCase();
  const gpCode = (v) => String(v || '').normalize('NFKC').replace(RE_WS, '').toUpperCase();
  const gpToGeneral = (v) => { const c = gpCode(v); return c.length < 9 ? '' : c.slice(0, 9) + 'ZZZ'; };
  // 医薬品の検索用の名前（今までの検索と同じ: 全角英数字を半角に・小文字に）
  const drugSearchName = (cpName) => toHalf(cpName).toLowerCase();
  const norm = { toHalf, gpText, gpCode, gpToGeneral, drugSearchName };
  if (typeof window !== 'undefined') window.__compatMasterNorm = norm;

  const C = typeof window !== 'undefined' && window.__compat; if (!C) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PAGE = 1000, PARALLEL = 6;

  // ログインが済むまで待つ（表はログイン済みの職員だけが読める）
  async function signedIn() {
    const c = await C.ready(); if (!c) return null;
    for (let i = 0; i < 240; i++) { const { data } = await c.auth.getSession(); if (data && data.session) return c; await sleep(500); }
    return null;
  }
  async function readAll(c, table, cols, orders) {
    const head = await c.from(table).select('ord', { count: 'exact', head: true });
    if (head.error) throw new Error(table + ': ' + head.error.message);
    const n = head.count || 0, pages = Math.ceil(n / PAGE), out = new Array(pages);
    let next = 0;
    async function worker() {
      while (next < pages) {
        const p = next++; let r = c.from(table).select(cols);
        orders.forEach((o) => { r = r.order(o, { ascending: true }); });
        const { data, error } = await r.range(p * PAGE, p * PAGE + PAGE - 1);
        if (error) throw new Error(table + ': ' + error.message);
        out[p] = data || [];
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, pages) }, worker));
    return [].concat(...out);
  }
  const KEYED = { s_procedures: 'karte_master_s_procedures', y_drugs: 'karte_master_y_drugs', b_diseases: 'karte_master_b_diseases', z_modifiers: 'karte_master_z_modifiers',
    proc_kubun: 'karte_master_proc_kubun', beppyo1_codes: 'karte_master_beppyo1_codes', drug_official: 'karte_master_drug_official' };
  const stats = {}; C.masterStats = stats;
  async function load(name) {
    const t0 = Date.now();
    const c = await signedIn(); if (!c) return null;
    const { data: meta, error } = await c.from('karte_master_meta').select('row_count,meta').eq('name', name).maybeSingle();
    if (error || !meta) throw new Error('マスターの件数が読めません: ' + name + (error ? ' ' + error.message : ''));
    let value, n;
    if (name === 'insurance_masters') {
      const rows = await readAll(c, 'karte_master_insurance_options', 'kind,ord,data', ['kind', 'ord']); n = rows.length;
      value = {}; ((meta.meta && meta.meta.kinds) || []).forEach((k) => { value[k] = []; });
      rows.forEach((r) => { (value[r.kind] = value[r.kind] || []).push(r.data); });
    } else {
      const rows = await readAll(c, KEYED[name], 'code,data', ['ord']); n = rows.length;
      const obj = {}; rows.forEach((r) => { obj[r.code] = r.data; });
      value = name === 'drug_official' ? Object.assign({}, (meta.meta && meta.meta.head) || {}, { rows: obj }) : obj;
    }
    if (n !== meta.row_count) throw new Error('マスターの件数が合いません: ' + name + ' ' + n + '/' + meta.row_count);
    stats[name] = { source: 'db', rows: n, ms: Date.now() - t0 };
    return value;
  }
  const cache = new Map();
  C.masterSource = (name) => {
    if (!KEYED[name] && name !== 'insurance_masters') return Promise.resolve(null);
    if (!cache.has(name)) {
      cache.set(name, load(name).catch((e) => { console.warn('[置き換え層] マスターを表から読めないため静的 JSON を使います:', e.message); stats[name] = { source: 'static', error: e.message }; cache.delete(name); return null; }));
    }
    return cache.get(name);
  };

  // ---- マスター JSON の本文（その2・karte_master_files）: レセプト作成の部品（見えない枠の統合版の画面）が読むもの ----
  //   C.masterFile('master/haihan_daily.json') → 元のファイルと同じ本文（文字列）。分割の数が meta と合わないときは null（枠の側で静的 JSON に戻る）
  //   診療行為・医薬品・傷病名・修飾語・区分番号・別表Ⅰのコメントは C.masterJson（その1の表）を使う（C.masterFileAsJson が名前を振り分ける）
  const fileCache = new Map();
  async function loadFile(rel) {
    const t0 = Date.now();
    const c = await signedIn(); if (!c) return null;
    const { data: meta, error: e1 } = await c.from('karte_master_meta').select('row_count,meta').eq('name', 'file:' + rel).maybeSingle();
    if (e1 || !meta) throw new Error('マスターの記録が読めません: ' + rel + (e1 ? ' ' + e1.message : ''));
    const { data, error } = await c.from('karte_master_files').select('part,body').eq('name', rel).order('part', { ascending: true });
    if (error) throw new Error(rel + ': ' + error.message);
    const rows = data || [];
    if (rows.length !== meta.row_count || rows.some((r, i) => r.part !== i)) throw new Error('マスターの分割の数が合いません: ' + rel);
    const text = rows.map((r) => r.body).join('');
    if (meta.meta && meta.meta.chars != null && text.length !== meta.meta.chars) throw new Error('マスターの長さが合いません: ' + rel);
    stats['file:' + rel] = { source: 'db', parts: rows.length, chars: text.length, ms: Date.now() - t0 };
    return text;
  }
  C.masterFile = (rel) => {
    if (!fileCache.has(rel)) fileCache.set(rel, loadFile(rel).catch((e) => { console.warn('[置き換え層] マスターを表から読めないため静的 JSON を使います:', e.message); stats['file:' + rel] = { source: 'static', error: e.message }; fileCache.delete(rel); return null; }));
    return fileCache.get(rel);
  };
  // 名前の振り分け: app/ からの相対パス → その1の表（JSON の値）か、その2の本文か
  C.masterForPath = async (rel) => {
    const m = /^master\/([a-z0-9_]+)\.json$/.exec(rel);
    if (m && KEYED[m[1]] && m[1] !== 'drug_official') { const v = await C.masterJson(m[1]); return v ? { json: v } : null; }
    const t = await C.masterFile(rel); return t != null ? { text: t } : null;
  };

  // ---- 表を直接検索する問い合わせ ----
  //   基準版の画面はログイン前にも検索を出すことがある（一般名処方マスターの先読みなど）。表はログイン済みの職員だけが読めるので、ログインを待ってから引く
  async function rpc(fn, args) {
    const c = await signedIn(); if (!c) throw new Error('ログインしていないためマスターを検索できません');
    const { data, error } = await c.rpc(fn, args);
    if (error) throw new Error('マスター検索に失敗しました: ' + error.message);
    return data;
  }
  async function one(table, code) {
    const c = await signedIn(); if (!c) throw new Error('ログインしていないためマスターを読めません');
    const { data, error } = await c.from(table).select('code,name_cp,data').eq('code', code).maybeSingle();
    if (error) throw new Error('マスターを読めません: ' + error.message);
    return data;
  }
  //   yj_code は薬価基準の YJ コード（karte_master_drug_official の 6 列目。無ければ null）。基準版は剤形の判定（坐剤＝外用など）に使う
  const drugRow = (code, e) => ({ id: code, drug_code: code, name: e.name, name_kana: null, price: e.price ?? null, unit: e.unit || '', is_generic: false, is_active: true,
    yj_code: e.yj || null, receipt_code: code, generic_name: null, generic_class: null, is_narcotic: false, is_psychotropic: false });

  function register() {
    const { on, err } = C;
    // 診療行為（compat_api.js の検索と同じ: コードか名前の部分一致・名前の前方一致を先に・名前順）
    on('GET', /^\/masters\/actions\/search$/, async (m, q) => {
      const kw = C.cp932Name(q.get('q') || ''), lim = Number(q.get('limit') || 30);
      const rows = await rpc('karte_master_search_procedures', { p_kw: kw, p_limit: lim });
      return (rows || []).map((r) => ({ id: r.code, action_code: r.code, name: r.name_cp, score: Math.round(parseFloat(r.pts) || 0), is_active: true }));
    });
    // 医薬品（compat_misc.js の検索と同じ: 空白で区切った語をすべて含む・またはコード一致／先頭の語で始まるものを先に・名前順）
    on('GET', /^\/masters\/drugs\/search$/, async (m, q) => {
      const kw = drugSearchName(C.cp932Name((q.get('q') || '').trim())), lim = Number(q.get('limit') || 30); if (!kw) return [];
      const terms = kw.split(/\s+/).filter(Boolean);
      const rows = await rpc('karte_master_search_drugs', { p_kw: kw, p_terms: terms, p_limit: lim });
      return (rows || []).map((r) => drugRow(r.code, { name: r.name_cp, price: r.data && r.data.price, unit: r.data && r.data.unit, yj: r.yj }));
    });
    on('GET', /^\/masters\/drugs\/([0-9]{9})$/, async (m) => {
      const r = await one('karte_master_y_drugs', m[1]); if (!r) return err(404, '薬剤が見つかりません');
      const c = await signedIn(); const { data: o } = await c.from('karte_master_drug_official').select('data').eq('code', m[1]).maybeSingle();
      return drugRow(r.code, { name: r.name_cp, price: r.data && r.data.price, unit: r.data && r.data.unit, yj: (o && Array.isArray(o.data) && o.data[5]) || null });
    });
    // 一般名処方マスター（基準版の応答の形: version・total・items・exceptions）
    on('GET', /^\/masters\/general-prescription-master$/, async (m, q) => {
      const code = gpCode(q.get('code')), lim = parseInt(q.get('limit') || '100', 10);
      return rpc('karte_master_search_general_rx', { p_q: gpText(q.get('q')), p_code: code, p_code_general: gpToGeneral(code), p_limit: isNaN(lim) ? 100 : lim });
    });
    // 傷病名（compat_diagnoses.js の検索と同じ: 名前の部分一致かコード一致／前方一致を先に・短い名前から）
    on('GET', /^\/diagnoses\/master\/search$/, async (m, q) => {
      const kw = C.cp932Name((q.get('q') || '').trim()), lim = Number(q.get('limit') || 20); if (!kw) return [];
      const rows = await rpc('karte_master_search_diseases', { p_kw: kw, p_limit: lim });
      return (rows || []).map((r) => ({ disease_code: r.code, name: r.name_cp, name_kana: null, icd10_code: (r.data && r.data.icd) || null, is_active: true }));
    });
    on('GET', /^\/diagnoses\/master\/([0-9]{7})$/, async (m) => {
      const r = await one('karte_master_b_diseases', m[1]); if (!r) return err(404, '見つかりません');
      return { id: m[1], disease_code: m[1], name: r.name_cp, name_kana: null, icd10_code: (r.data && r.data.icd) || null, is_single_use: true, is_main_disease: true, is_active: true };
    });
    // 修飾語（compat_diagnoses.js の検索と同じ: 空なら先頭から・名前の部分一致かコード一致／コード順）
    on('GET', /^\/diagnoses\/modifiers\/search$/, async (m, q) => {
      const kw = C.cp932Name((q.get('q') || '').trim()), lim = Number(q.get('limit') || 20);
      const rows = await rpc('karte_master_search_modifiers', { p_kw: kw, p_limit: lim });
      return (rows || []).map((r) => ({ code: r.code, name: r.name_cp, name_kana: null, modifier_type: Number(r.code) >= 8000 ? 'suffix' : 'prefix', category: null }));
    });
  }
  // このファイルは compat_api.js の直後（ほかの compat_*.js より前）に読まれる。同じ問い合わせをあとの compat_*.js が登録するので、
  // 画面の読み込みが終わった時点（DOMContentLoaded＝最後の compat_*.js のあと）でもう一度登録して、表を検索する処理にそろえる
  register();
  if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
})();
