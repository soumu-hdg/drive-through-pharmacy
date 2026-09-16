/**
 * santei_rules.js - 算定ルール設定（院ごと・選択式）＋ 自動算定モード（端末ごと）
 *
 * 考え方
 *  - 「この院でその加算を算定するか」は院ごとに違う。分からないうちは何も起こさない＝'unset'。
 *  - 「自動でどこまで入れるか」は担当者がその場でボタンで選ぶ（端末に記憶）。
 *  - 既定は"いまと同じ動き"（当院で従来から付けている3つは 'on'／モードは 'auto'）。
 *    設定を触らなければ挙動は一切変わらない。
 *
 * 保存先
 *  - 院の設定: Supabase karte_santei_rules（clinic_id, rule_key, mode）。読めない時はlocalStorageへ退避。
 *  - 自動算定モード: localStorage（端末ごと・担当者の好み）
 */
var SanteiRules = (function () {
  var TABLE = 'karte_santei_rules';
  var LS_MODE = 'karte_santei_auto_mode';
  var LS_RULES = 'karte_santei_rules_cache';
  var VALID_MODE = ['auto', 'suggest', 'off'];

  // 候補になり得る加算の一覧。点数は当院で実際に算定してきた値（従来の標準加算）を初期値にしている。
  // first/re が null の項目は、その受診種別では候補にしない。
  var CATALOG = [
    { key: 'kinou_kyouka', name: '機能強化加算', first: 80, re: null, def: 'on',
      note: '初診のみ。届出済みの医療機関で算定' },
    { key: 'bukka', name: '外来・在宅物価対応料', first: 4, re: 4, def: 'on',
      note: '初診・再診とも算定' },
    { key: 'baseup', name: '外来・在宅ベースアップ評価料', first: 17, re: 4, def: 'on',
      note: '初診17点・再診4点' },
    // ここから下は当院で算定しているか未確認のため既定は「未設定」。分かったものから「算定する」に変える。
    // 点数の出どころ = master/consultation_add.json（官報・令和8年度改定で確定させたもの）
    { key: 'gairai_kansen', name: '外来感染対策向上加算', first: 6, re: 6, def: 'unset', limit: 'month',
      note: '届出が要る。月1回だけ算定できる' },
    { key: 'renkei_kyouka', name: '連携強化加算', first: 3, re: 3, def: 'unset', limit: 'month',
      note: '外来感染対策向上加算の届出が前提。月1回' },
    { key: 'surveillance', name: 'サーベイランス強化加算', first: 1, re: 1, def: 'unset', limit: 'month',
      note: '外来感染対策向上加算の届出が前提。月1回' },
    { key: 'kokinyaku', name: '抗菌薬適正使用体制加算', first: 5, re: 5, def: 'unset', limit: 'month',
      note: '外来感染対策向上加算の届出が前提。月1回' },
    { key: 'meisai', name: '明細書発行体制等加算', first: null, re: 1, def: 'unset',
      note: '再診のときに毎回。電子的診療情報連携体制整備加算とは同月に併算定できない' },
    { key: 'jikangai_taisei1', name: '時間外対応体制加算1', first: null, re: 7, def: 'unset',
      note: '届出の区分に応じて1〜4のどれか1つだけを「算定する」にする' },
    { key: 'jikangai_taisei2', name: '時間外対応体制加算2', first: null, re: 5, def: 'unset',
      note: '届出の区分に応じて1〜4のどれか1つだけ' },
    { key: 'jikangai_taisei3', name: '時間外対応体制加算3', first: null, re: 4, def: 'unset',
      note: '届出の区分に応じて1〜4のどれか1つだけ' },
    { key: 'jikangai_taisei4', name: '時間外対応体制加算4', first: null, re: 2, def: 'unset',
      note: '届出の区分に応じて1〜4のどれか1つだけ' }
  ];

  var modes = null;        // { rule_key: 'on' | 'off' | 'unset' }
  var loadedClinic = null;

  function clinic() {
    return (typeof currentClinicId === 'function') ? currentClinicId() : 'nishiharu';
  }
  function defaults() {
    var m = {};
    CATALOG.forEach(function (r) { m[r.key] = r.def; });
    return m;
  }
  function lsKey() { return LS_RULES + ':' + clinic(); }

  function cacheToLocal() {
    try { localStorage.setItem(lsKey(), JSON.stringify(modes)); } catch (e) { /* 使えない環境は無視 */ }
  }
  function loadFromLocal() {
    try {
      var v = JSON.parse(localStorage.getItem(lsKey()) || 'null');
      if (v && typeof v === 'object') return v;
    } catch (e) { /* 壊れていたら既定へ */ }
    return null;
  }

  /** 院の設定を読む。読めなければ localStorage → 既定 の順で落ちる（落ちても現状維持の動き） */
  async function load(force) {
    var c = clinic();
    if (!force && modes && loadedClinic === c) return modes;
    modes = Object.assign(defaults(), loadFromLocal() || {});
    loadedClinic = c;
    try {
      if (typeof isSupabaseReady === 'function' && isSupabaseReady()) {
        var res = await supabaseClient.from(TABLE).select('rule_key,mode').eq('clinic_id', c);
        if (!res.error && Array.isArray(res.data)) {
          res.data.forEach(function (row) {
            if (row && row.rule_key) modes[row.rule_key] = row.mode || 'unset';
          });
          cacheToLocal();
        }
      }
    } catch (e) {
      console.warn('[算定ルール] 設定を読めなかったので手元の値で動きます', e);
    }
    return modes;
  }

  async function save(ruleKey, mode) {
    if (VALID_MODE.indexOf(mode) < 0 && ['on', 'off', 'unset'].indexOf(mode) < 0) return false;
    if (!modes) await load();
    modes[ruleKey] = mode;
    cacheToLocal();
    try {
      if (typeof isSupabaseReady === 'function' && isSupabaseReady()) {
        var row = { clinic_id: clinic(), rule_key: ruleKey, mode: mode, updated_at: new Date().toISOString() };
        var res = await supabaseClient.from(TABLE).upsert(row, { onConflict: 'clinic_id,rule_key' });
        if (res.error) { console.warn('[算定ルール] 保存できませんでした', res.error); return false; }
      }
    } catch (e) {
      console.warn('[算定ルール] 保存できませんでした', e);
      return false;
    }
    return true;
  }

  function modeOf(ruleKey) {
    var m = modes || defaults();
    return m[ruleKey] || 'unset';
  }

  function pointsOf(rule, isFirst) {
    return isFirst ? rule.first : rule.re;
  }

  /** この受診種別で「算定する」に設定されている加算
   *  limit==='month' の加算は、その月に算定済みかを画面が知らないので
   *  「まとめて入れる」でも自動では入れず、必ず候補どまりにする（二重算定を出さないため）。 */
  function desired(isFirst) {
    var out = [];
    CATALOG.forEach(function (r) {
      if (modeOf(r.key) !== 'on') return;
      var p = pointsOf(r, isFirst);
      if (p === null || p === undefined) return;
      out.push({ key: r.key, name: r.name, points: p, limit: r.limit || 'visit', note: r.note || '' });
    });
    return out;
  }

  /** 自動算定モード（端末ごと）。既定は従来どおりの 'auto' */
  function autoMode() {
    try {
      var v = localStorage.getItem(LS_MODE);
      if (VALID_MODE.indexOf(v) >= 0) return v;
    } catch (e) { /* 使えない環境は既定へ */ }
    return 'auto';
  }
  function setAutoMode(v) {
    if (VALID_MODE.indexOf(v) < 0) return;
    try { localStorage.setItem(LS_MODE, v); } catch (e) { /* 保存できなくてもその場では効く */ }
  }

  return {
    CATALOG: CATALOG,
    load: load,
    save: save,
    modeOf: modeOf,
    desired: desired,
    autoMode: autoMode,
    setAutoMode: setAutoMode,
    _defaults: defaults
  };
})();
