/* =========================================================
   v0.8 store.js ― アプリ状態・マスタキャッシュ・派生計算
   在庫を減らすかの判定は必ず stockUntracked（ビュー算出値）を使う。
   画面側で category 文字列を直接判定するコードを書かないこと。
   ========================================================= */
(function () {
  'use strict';
  window.P8 = window.P8 || {};

  // 項目を増やすたびに末尾の版数を上げる。古い形のキャッシュを読むと、
  // 編集フォームが「値が無い」状態で開き、保存でDBの値を消してしまう
  var CACHE_KEY = 'p8_master_cache_v2';

  // ---- 汎用ヘルパー ----
  function normalizeCode(code) {
    if (!code) return '';
    var s = String(code).replace(/^[A-Za-z]+/, '');
    var n = parseInt(s, 10);
    return isNaN(n) ? String(code).trim() : String(n);
  }
  function normalizeName(s) {
    return String(s || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/^後）/, '').toLowerCase();
  }
  function YEN(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : '¥' + Math.round(n).toLocaleString(); }
  function todayJst() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function sbToJst(iso) {
    var d = new Date(iso);
    return {
      date: d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      time: d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
    };
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 使用期限の年月4桁 → 月末日 'YYYY-MM-DD'（26〜49年を20xxと解釈。無効はnull）
  function parseYm4(s) {
    var m = /^(\d{2})(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var yy = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    if (yy < 26 || yy > 49 || mo < 1 || mo > 12) return null;
    var y = 2000 + yy;
    var last = new Date(y, mo, 0).getDate();
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(last).padStart(2, '0');
  }

  // 担当者（v0.7の10名を継続・ハードコード）
  var OPERATORS = ['島原', '森', '湯浅', '長部', '田中', '沓名', '西村', '佐川', '萩原', '加藤'];

  // 体重別用量マッピング（v0.7から移植・DB化は将来課題）
  var weightDoseMap = {
    '6m': { label: '6ヶ月(7kg)', codes: ['M005', 'M010', 'M016', 'M015', 'M031', 'M026', 'M032'], notes: { 'M015': '0.3g×1包', 'M031': '1.0g処方' } },
    '1y': { label: '1歳(10kg)', codes: ['M001', 'M006', 'M011', 'M017', 'M015', 'M031', 'M027', 'M033'], notes: { 'M015': '0.3g×1包', 'M031': '1.5g処方' } },
    '3y': { label: '3歳(15kg)', codes: ['M002', 'M007', 'M012', 'M018', 'M015', 'M031', 'M023', 'M028', 'M034'], notes: { 'M015': '0.6g×2包', 'M031': '2.0g処方' } },
    '5y': { label: '5歳(20kg)', codes: ['M003', 'M008', 'M013', 'M019', 'M015', 'M031', 'M024', 'M029', 'M035'], notes: { 'M015': '0.6g×2包', 'M031': '3.0g処方' } },
    '7y': { label: '7歳(25kg)', codes: ['M004', 'M009', 'M014', 'M020', 'M015', 'M031', 'M025', 'M030', 'M036'], notes: { 'M015': '0.6g×2包', 'M031': '3.5g処方' } }
  };

  // カルテ分類 → この画面の分類の推定（v0.7から移植）
  function guessCategory(name, karteCategory) {
    var SUB = {
      '解熱鎮痛': '解熱鎮痛剤', '咳・痰': '咳止め', '胃腸': '整腸剤', 'アレルギー': '抗アレルギー剤',
      '抗菌': '抗生剤', '抗ウイルス': '抗ウイルス薬', 'めまい': '鎮暈剤', '気管支': '気管支拡張剤',
      '救急': '救急', '検査キット': '検査キット', '坐剤': '坐剤', '内服': '内服', '外用': '外用'
    };
    var sub = SUB[karteCategory] || karteCategory || 'その他';
    var n = String(name || '');
    if (karteCategory === '検査キット') return '検査/' + sub;
    if (/点眼|軟膏|クリーム|ローション|テープ|吸入/.test(n)) return '外用/' + sub;
    if (/DS|ドライシロップ|細粒|シロップ|小児/.test(n)) return '小児/' + sub;
    return '成人/' + sub;
  }

  // ---- マスタ（pharmacy_v_medicines） ----
  function toStockItem(r) {
    return {
      code: r.code,
      name: r.name || '',
      furigana: r.furigana || '',
      stock: r.current_stock || 0,
      unit: r.unit || '',
      threshold: r.threshold || 0,
      category: r.category || '',
      usage: r.usage_text || '',
      price: (r.price === null || r.price === undefined || r.price === 0) ? '' : String(r.price),
      maker: r.maker || '',
      csvGroup: r.csv_group || 'master',
      rezeptCode: r.rezept_code || '',
      packSize: r.pack_size || null,
      costPerPack: (r.cost_per_pack === null || r.cost_per_pack === undefined) ? null : Number(r.cost_per_pack),
      costPerUnit: (r.cost_per_unit === null || r.cost_per_unit === undefined) ? null : Number(r.cost_per_unit),
      supplierId: r.supplier_id || null,
      supplierName: r.supplier_name || '',
      marginPerUnit: (r.margin_per_unit === null || r.margin_per_unit === undefined) ? null : Number(r.margin_per_unit),
      marginRate: (r.margin_rate_pct === null || r.margin_rate_pct === undefined) ? null : Number(r.margin_rate_pct),
      officialName: r.official_name || '',
      officialStatus: r.official_status || '',
      stockUntracked: !!r.stock_untracked,
      stockTracking: (r.stock_tracking === null || r.stock_tracking === undefined) ? null : !!r.stock_tracking,
      gapExempt: !!r.master_gap_exempt,
      legacyCodes: Array.isArray(r.legacy_codes) ? r.legacy_codes : [],
      // 2026-09-04 追加: 薬品マスタの項目をDBへ集約したぶん
      cat1: r.cat1 || '',
      cat2: r.cat2 || '',
      cat3: r.cat3 || '',
      cat4: r.cat4 || '',
      cat5: r.cat5 || '',
      brandSuffix: r.brand_suffix || '',
      groupName: r.group_name || '',
      stockClass: r.stock_class || '',
      orderUnit: r.order_unit || '',
      totalG: num(r.total_g),
      unitPriceOfficial: num(r.unit_price_official),
      yjBaseCode: r.yj_base_code || '',
      rezeptCode2: r.rezept_code2 || '',
      yjCode: r.yj_code || '',
      hot7: r.hot_code || '',
      hot9: r.hot9 || '',
      hot13: r.hot13 || '',
      form: r.form || '',
      spec: r.spec || '',
      // ビュー側で計算済み（入数×12 / 総量g×薬価基準単価）。画面で掛け算し直さない
      packX12: num(r.pack_x12),
      lotListValue: num(r.lot_list_value)
    };
  }

  // null/undefined/空文字はそのまま null。数値化できないものも null
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  var store = {
    stock: [],          // 採用薬マスタ（表示用オブジェクト）
    reorder: [],        // pharmacy_v_reorder
    suppliers: [],
    gapStats: null,     // pharmacy_v_master_gap_stats
    noExpiryCount: null,
    missingDrugs: [],   // カルテ突合の未登録薬
    ready: false,
    listeners: []
  };

  function findByCode(code) {
    var nc = normalizeCode(code);
    return store.stock.find(function (m) {
      if (normalizeCode(m.code) === nc) return true;
      return (m.legacyCodes || []).some(function (c) { return normalizeCode(c) === nc; });
    }) || null;
  }

  async function loadMaster() {
    var cols = 'code,name,furigana,current_stock,unit,threshold,category,usage_text,price,csv_group,'
      + 'rezept_code,yj_code,hot_code,form,spec,pack_size,cost_per_pack,cost_per_unit,supplier_id,supplier_name,maker,'
      + 'margin_per_unit,margin_rate_pct,official_name,official_status,stock_untracked,legacy_codes,'
      + 'stock_tracking,master_gap_exempt,'
      + 'cat1,cat2,cat3,cat4,cat5,brand_suffix,group_name,stock_class,order_unit,'
      + 'total_g,unit_price_official,yj_base_code,rezept_code2,hot9,hot13,pack_x12,lot_list_value';
    var data = await P8.db.get('pharmacy_v_medicines?select=' + cols + '&order=code');
    if (!data || !data.length) return false;
    store.stock = data.map(toStockItem);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: store.stock })); } catch (e) {}
    return true;
  }

  function loadMasterFromCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      var c = JSON.parse(raw);
      if (!c || !Array.isArray(c.items) || !c.items.length) return false;
      // 旧バージョンのキャッシュには新項目が無い。undefined のまま画面へ渡すと表示が壊れるので埋める
      var TXT = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'brandSuffix', 'groupName', 'stockClass',
        'orderUnit', 'yjBaseCode', 'yjCode', 'rezeptCode2', 'hot7', 'hot9', 'hot13', 'form', 'spec'];
      var NUM = ['totalG', 'unitPriceOfficial', 'packX12', 'lotListValue'];
      c.items.forEach(function (m) {
        TXT.forEach(function (k) { if (m[k] === undefined) m[k] = ''; });
        NUM.forEach(function (k) { if (m[k] === undefined) m[k] = null; });
      });
      store.stock = c.items;
      return true;
    } catch (e) { return false; }
  }

  async function loadReorder() {
    var rows = await P8.db.get('pharmacy_v_reorder?select=*&order=priority.asc,days_left.asc.nullslast,current_stock.asc');
    if (rows) store.reorder = rows;
    return !!rows;
  }

  async function loadSuppliers() {
    if (store.suppliers.length) return store.suppliers;
    store.suppliers = (await P8.db.get('pharmacy_suppliers?select=id,name&active=is.true&order=name')) || [];
    return store.suppliers;
  }

  async function loadGapStats() {
    var rows = await P8.db.get('pharmacy_v_master_gap_stats?select=*');
    store.gapStats = (rows && rows[0]) || null;
    return store.gapStats;
  }

  async function loadNoExpiryCount() {
    store.noExpiryCount = await P8.db.count('pharmacy_lots?select=id&expiry_on=is.null&qty_remaining=gt.0');
    return store.noExpiryCount;
  }

  // ---- カルテ薬品マスタとの突合（1日1回・読み取りのみ） ----
  var DRIFT_KEY = 'p8_drift_checked_on';
  function recomputeMissing(karteDrugs) {
    var haveName = new Set(store.stock.map(function (m) { return normalizeName(m.name); }));
    var haveCode = new Set();
    store.stock.forEach(function (m) {
      haveCode.add(normalizeCode(m.code));
      (m.legacyCodes || []).forEach(function (c) { haveCode.add(normalizeCode(c)); });
    });
    store.missingDrugs = (karteDrugs || []).filter(function (d) {
      var raw = String(d.name || '').trim();
      if (!raw) return false;
      if (/^M\d{2,4}$/i.test(raw)) return !haveCode.has(normalizeCode(raw));
      return !haveName.has(normalizeName(raw));
    });
  }
  async function checkMasterDrift(force) {
    var today = todayJst();
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(DRIFT_KEY) || 'null'); } catch (e) {}
    if (cached && Array.isArray(cached.drugs)) recomputeMissing(cached.drugs);
    if (!force && cached && cached.date === today) return;
    try {
      var data = await P8.db.karteFetch('action=all&date_from=' + today + '&date_to=' + today);
      if (!data || !Array.isArray(data.drugs)) return;
      localStorage.setItem(DRIFT_KEY, JSON.stringify({
        date: today,
        drugs: data.drugs.map(function (d) { return { name: d.name, category: d.category }; })
      }));
      recomputeMissing(data.drugs);
      notify();
    } catch (e) { console.warn('カルテ突合に失敗:', e.message); }
  }

  // ---- 派生計算 ----
  function stockCostValue() {
    return store.stock.reduce(function (s, m) { return s + (m.costPerUnit || 0) * (m.stock || 0); }, 0);
  }
  function stockListValue() {
    return store.stock.reduce(function (s, m) { return s + (Number(m.price) || 0) * (m.stock || 0); }, 0);
  }
  function reverseMargins() {
    return store.stock.filter(function (m) { return m.marginPerUnit !== null && m.marginPerUnit < 0; });
  }
  function reorderCount(statuses) {
    return store.reorder.filter(function (r) { return statuses.indexOf(r.status) >= 0; }).length;
  }
  function categories() {
    var set = {};
    store.stock.forEach(function (m) { if (m.category) set[m.category] = 1; });
    return Object.keys(set).sort();
  }
  // マスタの既存値から候補（datalist / 絞り込み欄）を作る。値は固定リストにしない
  function distinct(field) {
    var set = {};
    store.stock.forEach(function (m) {
      var v = m[field];
      if (v !== null && v !== undefined && String(v).trim() !== '') set[String(v).trim()] = 1;
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  }

  // ---- リフレッシュ・通知 ----
  function onChange(fn) { store.listeners.push(fn); }
  function notify() {
    store.listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } });
  }
  async function refresh() {
    await Promise.all([loadMaster(), loadReorder(), loadGapStats(), loadNoExpiryCount()]);
    if (P8.ui && P8.ui.updateBadges) P8.ui.updateBadges();
    notify();
  }

  async function init() {
    if (loadMasterFromCache()) { store.ready = true; notify(); }
    var ok = await loadMaster();
    if (ok) store.ready = true;
    await Promise.all([loadReorder(), loadSuppliers(), loadGapStats(), loadNoExpiryCount()]);
    if (P8.ui && P8.ui.updateBadges) P8.ui.updateBadges();
    notify();
    checkMasterDrift(false); // 背景で1日1回
    return ok;
  }

  P8.store = store;
  Object.assign(P8.store, {
    init: init, refresh: refresh, onChange: onChange, notify: notify,
    loadMaster: loadMaster, loadReorder: loadReorder, loadSuppliers: loadSuppliers,
    loadGapStats: loadGapStats, loadNoExpiryCount: loadNoExpiryCount,
    checkMasterDrift: checkMasterDrift, recomputeMissing: recomputeMissing,
    findByCode: findByCode, toStockItem: toStockItem,
    stockCostValue: stockCostValue, stockListValue: stockListValue,
    reverseMargins: reverseMargins, reorderCount: reorderCount, categories: categories,
    distinct: distinct
  });
  P8.util = {
    normalizeCode: normalizeCode, normalizeName: normalizeName, YEN: YEN,
    todayJst: todayJst, sbToJst: sbToJst, esc: esc, parseYm4: parseYm4,
    guessCategory: guessCategory, weightDoseMap: weightDoseMap, OPERATORS: OPERATORS
  };
})();
