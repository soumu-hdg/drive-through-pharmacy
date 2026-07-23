/**
 * master_loader.js - SSK公式マスターJSON読込ユーティリティ
 * レセプト電算処理システム 基本マスター (S/Y/B/Z)
 *
 * 使い方:
 *   await MasterLoader.loadAll();
 *   const name = MasterLoader.getProcedureName('111000110'); // '初診料'
 *   const drug = MasterLoader.getDrug('610406079');          // {name:'ガスター散２％', unit:'ｇ', price:6.3}
 */
const MasterLoader = (() => {
  const masters = {
    s: null,  // 診療行為 Map<code, {name, pts, inout}>
    y: null,  // 医薬品   Map<code, {name, unit, price, g}>
    b: null,  // 傷病名   Map<code, {name, icd}>
    z: null,  // 修飾語   Map<code, name>
  };

  // 電子点数表テーブル
  const tables = {
    haihanDaily: null,       // 背反テーブル1(同日) [[code1,code2,type],...]
    haihanMonthly: null,     // 背反テーブル2(同月)
    haihanSimultaneous: null,// 背反テーブル3(同時)
    haihanWeekly: null,      // 背反テーブル4(週)
    houkatsu: null,          // 包括テーブル {groupNo: [code,...]}
    santeiCount: null,       // 算定回数テーブル Map<code, {u,un,max}>
    syRelation: null,        // 傷病名関連区分 {procCode: {sy, name}} (col24)
    diseaseFlags: null,      // 傷病名フラグ {diseaseCode: {tk,nb,tan}} (特定疾患/難病/単独禁止)
    procAge: null,           // 診療行為の年齢制限 {procCode: {lo,hi,name}} (下限/上限年齢)
    memoRules: null,         // 摘要リマインドルール {rules:[{matchKeywords,memo}]}
    // ★v0.16 別表Ⅰ（厚労省 摘要欄記載事項一覧・医科）
    beppyoCodes: null,       // コメントコード→{d:表示文言, k:区分, p:診療行為名}  CO権威エンリッチ用
    beppyoRules: null,       // {byKubun: {"A000": [{name, items:[{cond,code,disp}]}]}}
    procKubun: null,         // 9桁診療行為コード→区分番号 {code: "A000"}（別表Ⅰ該当のみ）
  };

  let loaded = false;
  let loading = null;

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }

  async function loadAll(basePath = 'master/') {
    if (loaded) return;
    if (loading) return loading;

    loading = (async () => {
      const masterFiles = [
        { key: 's', file: 's_procedures.json', label: '診療行為' },
        { key: 'y', file: 'y_drugs.json',      label: '医薬品' },
        { key: 'b', file: 'b_diseases.json',   label: '傷病名' },
        { key: 'z', file: 'z_modifiers.json',  label: '修飾語' },
      ];

      const tableFiles = [
        { key: 'haihanDaily',       file: 'haihan_daily.json',        label: '背反(同日)' },
        { key: 'haihanMonthly',     file: 'haihan_monthly.json',      label: '背反(同月)' },
        { key: 'haihanSimultaneous',file: 'haihan_simultaneous.json', label: '背反(同時)' },
        { key: 'haihanWeekly',      file: 'haihan_weekly.json',       label: '背反(週)' },
        { key: 'houkatsu',          file: 'houkatsu.json',            label: '包括' },
        { key: 'santeiCount',       file: 'santei_count.json',        label: '算定回数' },
        { key: 'syRelation',        file: 'sy_relation.json',         label: '傷病名関連区分' },
        { key: 'diseaseFlags',      file: 'disease_flags.json',       label: '傷病名フラグ' },
        { key: 'procAge',           file: 'proc_age.json',            label: '年齢制限' },
        { key: 'memoRules',         file: 'memo_reminder_rules.json',  label: '摘要リマインド' },
        { key: 'beppyoCodes',       file: 'beppyo1_codes.json',       label: '別表Ⅰコメント辞書' },
        { key: 'beppyoRules',       file: 'beppyo1_rules.json',       label: '別表Ⅰ記載事項' },
        { key: 'procKubun',         file: 'proc_kubun.json',          label: '区分番号ブリッジ' },
      ];

      const allFiles = [...masterFiles, ...tableFiles];
      const progressEl = document.getElementById('master-loading-progress');

      for (let i = 0; i < allFiles.length; i++) {
        const { key, file, label } = allFiles[i];
        if (progressEl) {
          progressEl.textContent = `マスター読込中... ${label} (${i + 1}/${allFiles.length})`;
        }
        try {
          const data = await fetchJSON(basePath + file);
          if (masterFiles.some(m => m.key === key)) {
            masters[key] = new Map(Object.entries(data));
          } else if (key === 'santeiCount') {
            tables[key] = new Map(Object.entries(data));
          } else {
            tables[key] = data;
          }
        } catch (e) {
          console.warn(`Load failed: ${file}`, e);
          if (masterFiles.some(m => m.key === key)) {
            masters[key] = new Map();
          } else {
            tables[key] = key === 'santeiCount' ? new Map() :
                          (key === 'houkatsu' || key === 'syRelation' || key === 'diseaseFlags' || key === 'procAge' || key === 'memoRules' || key === 'beppyoCodes' || key === 'beppyoRules' || key === 'procKubun') ? {} : [];
          }
        }
      }

      loaded = true;
      if (progressEl) {
        const masterTotal = Array.from(Object.values(masters)).reduce((s, m) => s + m.size, 0);
        progressEl.textContent = `マスター読込完了 (${masterTotal.toLocaleString()}件 + 点数表6種)`;
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
      }
      console.log('MasterLoader: loaded',
        Object.entries(masters).map(([k, m]) => `${k}:${m.size}`).join(', '),
        '| tables:',
        `haihan=${(tables.haihanDaily?.length||0)+(tables.haihanMonthly?.length||0)+(tables.haihanSimultaneous?.length||0)+(tables.haihanWeekly?.length||0)}`,
        `houkatsu=${Object.keys(tables.houkatsu||{}).length}groups`,
        `santei=${tables.santeiCount?.size||0}`
      );
    })();

    return loading;
  }

  function getProcedure(code) {
    return masters.s?.get(code) || null;
  }

  function getProcedureName(code) {
    const entry = masters.s?.get(code);
    return entry ? entry.name : '';
  }

  function getProcedurePoints(code) {
    const entry = masters.s?.get(code);
    return entry ? (entry.pts || 0) : 0;
  }

  function getDrug(code) {
    return masters.y?.get(code) || null;
  }

  function getDrugName(code) {
    const entry = masters.y?.get(code);
    return entry ? entry.name : '';
  }

  function getDiseaseName(code) {
    const entry = masters.b?.get(code);
    return entry ? entry.name : '';
  }

  function getDisease(code) {
    return masters.b?.get(code) || null;
  }

  function getModifierName(code) {
    return masters.z?.get(code) || '';
  }

  /** 傷病名検索: 名称またはコードの部分一致で検索 (カルテ傷病名入力用) */
  function searchDiseases(query, limit) {
    if (!masters.b || !query) return [];
    limit = limit || 50;
    const results = [];
    const q = query.toLowerCase();
    for (const [code, entry] of masters.b) {
      if (results.length >= limit) break;
      if (entry.name.includes(query) || code.includes(query)) {
        results.push({ code, name: entry.name, icd: entry.icd || '' });
      }
    }
    return results;
  }

  // === テーブルアクセサ ===

  /** 背反チェック: 指定タイプで code1-code2 ペアが背反か判定 */
  function isHaihan(type, code1, code2) {
    const table = tables['haihan' + type];
    if (!table || !Array.isArray(table)) return false;
    for (const [c1, c2, htype] of table) {
      if (c1 === code1 && c2 === code2) return true;
      if (htype === 2 && c1 === code2 && c2 === code1) return true; // 双方向
    }
    return false;
  }

  /** 背反ペア検索: コードリストから背反ペアを全て返す */
  function findHaihanPairs(type, codes) {
    const table = tables['haihan' + type];
    if (!table || !Array.isArray(table)) return [];
    const codeSet = new Set(codes);
    const found = [];
    for (const [c1, c2, htype] of table) {
      if (codeSet.has(c1) && codeSet.has(c2)) {
        found.push([c1, c2, htype]);
      }
    }
    return found;
  }

  /** 包括チェック: コードが包括グループに属しているか */
  function findHoukatsuGroup(code) {
    if (!tables.houkatsu) return null;
    for (const [groupNo, codes] of Object.entries(tables.houkatsu)) {
      if (codes.includes(code)) return groupNo;
    }
    return null;
  }

  /** 包括グループ内の全コード取得 */
  function getHoukatsuGroupCodes(groupNo) {
    return tables.houkatsu?.[groupNo] || [];
  }

  /** 算定回数取得 */
  function getSanteiCount(code) {
    return tables.santeiCount?.get(code) || null;
  }

  /** 診療行為の傷病名関連区分を取得 {sy:'5',name} / null (sy: 3・4皮膚科特定疾患 / 5特定疾患療養管理料 / 7てんかん / 9難病外来) */
  function getSyRelation(code) {
    return tables.syRelation?.[code] || null;
  }

  /** 傷病名フラグを取得 {tk:特定疾患等対象区分, nb:難病外来対象区分, tan:単独使用禁止区分} / null */
  function getDiseaseFlags(code) {
    return tables.diseaseFlags?.[code] || null;
  }

  /** 診療行為の年齢制限を取得 {lo:下限年齢, hi:上限年齢(この歳未満まで有効), name} / null */
  function getProcAge(code) {
    return tables.procAge?.[code] || null;
  }

  /** 摘要リマインドルール配列を取得 [{matchKeywords:[], memo}] */
  function getMemoRules() {
    return (tables.memoRules && tables.memoRules.rules) || [];
  }

  // === 別表Ⅰ（厚労省 摘要欄記載事項一覧・医科）アクセサ ===

  /** コメントコード(CO fields[3])→別表Ⅰの公式情報 {d:表示文言, k:区分, p:診療行為名} / null */
  function getBeppyoComment(code) {
    return (tables.beppyoCodes && tables.beppyoCodes[code]) || null;
  }

  /** 9桁診療行為コード→区分番号 'A000' / null（別表Ⅰにルールがある区分のみ登録） */
  function getBeppyoKubun(procCode) {
    return (tables.procKubun && tables.procKubun[procCode]) || null;
  }

  /** 区分番号→別表Ⅰ記載事項グループ配列 [{name, items:[{cond,code,disp}]}] / [] */
  function getBeppyoRulesByKubun(kubun) {
    return (tables.beppyoRules && tables.beppyoRules.byKubun && tables.beppyoRules.byKubun[kubun]) || [];
  }

  /** 9桁診療行為コードから別表Ⅰ記載事項を引く {kubun, groups:[...]} / null */
  function getBeppyoRulesByProc(procCode) {
    const kubun = getBeppyoKubun(procCode);
    if (!kubun) return null;
    const groups = getBeppyoRulesByKubun(kubun);
    if (!groups.length) return null;
    return { kubun, groups };
  }

  function isLoaded() {
    return loaded;
  }

  function getStats() {
    return {
      s: masters.s?.size || 0,
      y: masters.y?.size || 0,
      b: masters.b?.size || 0,
      z: masters.z?.size || 0,
      haihanDaily: tables.haihanDaily?.length || 0,
      haihanMonthly: tables.haihanMonthly?.length || 0,
      haihanSimultaneous: tables.haihanSimultaneous?.length || 0,
      haihanWeekly: tables.haihanWeekly?.length || 0,
      houkatsuGroups: Object.keys(tables.houkatsu || {}).length,
      santeiCount: tables.santeiCount?.size || 0,
    };
  }

  return {
    loadAll,
    getProcedure,
    getProcedureName,
    getProcedurePoints,
    getDrug,
    getDrugName,
    getDiseaseName,
    getDisease,
    getModifierName,
    searchDiseases,
    isHaihan,
    findHaihanPairs,
    findHoukatsuGroup,
    getHoukatsuGroupCodes,
    getSanteiCount,
    getSyRelation,
    getDiseaseFlags,
    getProcAge,
    getMemoRules,
    getBeppyoComment,
    getBeppyoKubun,
    getBeppyoRulesByKubun,
    getBeppyoRulesByProc,
    isLoaded,
    getStats,
  };
})();
