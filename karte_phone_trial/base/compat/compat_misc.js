// ===== 置き換え層：薬剤マスター・チェック・施設ごとの設定ほか（工程4・2026-09-24） compat_misc.js =====
//   ・薬剤の検索・詳細は統合版の公式薬価マスター（master/y_drugs.json）
//   ・算定チェック・相互作用・投与日数は、統合版のチェック（適応症の突合・算定ルール）を後でここにつなぐ。今は「指摘なし」を返す
//   ・施設の設定は、統合版にまだ置き場が無いので院ごとに DB（karte_clinic_store）へ置く。DB を使う印の無い院は従来どおり端末に置く
//   ・セット・施設の警告・ファイル・問診・臨床プロフィールは、統合版の該当機能を後でつなぐ。今は空を返す（画面が読める形で）
(function () {
  const C = window.__compat; if (!C) return;
  const { on, clinicId, realFetch } = C;
  let drugs = null;
  async function drugMaster() { if (!drugs) { drugs = JSON.parse(JSON.stringify((await C.masterJson('y_drugs')) || {})); Object.keys(drugs).forEach((k) => { drugs[k].name = C.cp932Name(drugs[k].name); }); } return drugs; }
  const drugRow = (code, e) => ({ id: code, drug_code: code, name: e.name, name_kana: null, price: e.price ?? null, unit: e.unit || '', is_generic: false, is_active: true,
    yj_code: null, receipt_code: code, generic_name: null, generic_class: null, is_narcotic: false, is_psychotropic: false });
  const toHalf = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  on('GET', /^\/masters\/drugs\/search$/, async (m, q) => {
    const kw = toHalf(C.cp932Name((q.get('q') || '').trim())).toLowerCase(), lim = Number(q.get('limit') || 30); if (!kw) return [];
    const all = await drugMaster(); const terms = kw.split(/\s+/).filter(Boolean); const hits = [];
    for (const code of Object.keys(all)) { const n = toHalf(all[code].name).toLowerCase(); if (code === kw || terms.every((t) => n.includes(t))) hits.push(code); }
    hits.sort((a, b) => (toHalf(all[a].name).toLowerCase().startsWith(terms[0]) ? 0 : 1) - (toHalf(all[b].name).toLowerCase().startsWith(terms[0]) ? 0 : 1) || (all[a].name < all[b].name ? -1 : 1));
    return hits.slice(0, lim).map((c) => drugRow(c, all[c]));
  });
  on('GET', /^\/masters\/drugs\/([0-9]{9})$/, async (m) => { const e = (await drugMaster())[m[1]]; return e ? drugRow(m[1], e) : C.err(404, '薬剤が見つかりません'); });
  on('GET', /^\/masters\/general-prescription-master$/, async () => ({ items: [], exceptions: [], version: null }));
  on('GET', /^\/masters\/facility\/([a-z_-]+)$/, async () => []);
  on('GET', /^\/masters\/receipt-comment-requirements$/, async () => []);

  on('POST', /^\/calculations\/check\/realtime$/, async () => ({ error_count: 0, warning_count: 0, results: [] }));
  on('POST', /^\/calculations\/check\/drug-interaction$/, async () => []);
  on('POST', /^\/calculations\/check\/drug-duration$/, async () => []);

  const SKEY = () => 'karte_base_facility_settings_' + clinicId();
  on('GET', /^\/facilities\/settings$/, async () => { let s = {}; try { s = JSON.parse(C.store.getItem(SKEY()) || '{}'); } catch (e) { s = {}; } return { facility_id: clinicId(), settings: s }; });
  on('PUT', /^\/facilities\/settings$/, async (m, q, body) => {
    let s = {}; try { s = JSON.parse(C.store.getItem(SKEY()) || '{}'); } catch (e) { s = {}; }
    Object.assign(s, (body && body.settings) || {}); try { C.store.setItem(SKEY(), JSON.stringify(s)); } catch (e) { /* 保存できない環境では今回の表示だけ */ }
    return { facility_id: clinicId(), settings: s };
  });

  on('GET', /^\/karte-sets$/, async () => []);
  on('GET', /^\/facility-warnings\/([^/]+)$/, async () => []);
  on('GET', /^\/patients\/files\/storage-usage$/, async () => ({ used_bytes: 0, limit_bytes: 0, file_count: 0 }));
  on('GET', /^\/patients\/([0-9a-f-]{36})\/files$/, async () => []);
  on('GET', /^\/patients\/([0-9a-f-]{36})\/clinical-profile$/, async () => ({}));
  on('GET', /^\/questionnaires\/responses\/by-patient\/([0-9a-f-]{36})$/, async () => []);
})();
