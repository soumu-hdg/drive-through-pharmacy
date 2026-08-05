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
    // ★v0.17 ①薬と病名の対応表（適応症突合） / ②診察料加算（当院標準スタック・官報点数）
    drugIndication: null,    // {meta, drugs:[{name,adopted,auto,match,key,...}]}
    consultAdd: null,        // 診察料加算マスタ（clinic_standard / exclusive / official_points）
  };
  // 薬名→適応症エントリの正規化インデックス（drugIndication読込後に構築）
  let drugIndList = null;

  let loaded = false;
  let loading = null;

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }

  // マスタJSON更新時はこの版数を上げる（キャッシュ無効化）。
  const MASTER_VERSION = '20260728_v21';

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
        { key: 'drugIndication',    file: 'drug_indication.json',     label: '薬-適応症(①)' },
        { key: 'consultAdd',        file: 'consultation_add.json',    label: '診察料加算(②)' },
      ];

      const allFiles = [...masterFiles, ...tableFiles];
      const progressEl = document.getElementById('master-loading-progress');

      for (let i = 0; i < allFiles.length; i++) {
        const { key, file, label } = allFiles[i];
        if (progressEl) {
          progressEl.textContent = `マスター読込中... ${label} (${i + 1}/${allFiles.length})`;
        }
        try {
          // ★マスタJSONにキャッシュバスターを付与（無いとマスタ更新がブラウザキャッシュで届かない）
          const data = await fetchJSON(basePath + file + '?v=' + MASTER_VERSION);
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
                          (key === 'houkatsu' || key === 'syRelation' || key === 'diseaseFlags' || key === 'procAge' || key === 'memoRules' || key === 'beppyoCodes' || key === 'beppyoRules' || key === 'procKubun' || key === 'drugIndication' || key === 'consultAdd') ? {} : [];
          }
        }
      }

      // ★v0.17 薬-適応症の正規化インデックスを構築
      buildDrugIndIndex();

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
    // pts は "291.00" 等の文字列保持がありうる。B相の算定計算で使う際のNaN/文字列連結地雷を防ぐため数値化する。
    return entry ? (parseFloat(entry.pts) || 0) : 0;
  }

  function getDrug(code) {
    return masters.y?.get(code) || null;
  }

  // 医薬品名→薬価の索引（院内薬など SSKコードを持たない薬の薬価を名称照合で引く）。
  // 正規化: メーカー名の括弧を"中身ごと"除去＋漢方接頭辞除去＋剤形/塩/規格記号除去。
  function priceNorm(s) {
    let x = String(s || '').normalize('NFKC');
    x = x.replace(/「[^」]*」|〈[^〉]*〉|（[^）]*）|\([^)]*\)|【[^】]*】/g, ''); // メーカー名等の括弧を中身ごと
    x = x.replace(/^後）?/, '');                                              // 後発の「後）」
    x = x.replace(/^(ツムラ|クラシエ|コタロー|小太郎|ジュンコウ|本草|オースギ|JPS|三和|東洋|太虎堂|マツウラ)/, ''); // 漢方接頭辞
    const isPowder = /細粒|散|顆粒|DS|ドライシロップ|シロップ/.test(x);       // 粉末/液剤（用量分割されやすい）
    x = x.replace(/(錠剤|錠|カプセル|OD|口腔内崩壊|徐放|坐剤|坐薬|細粒|顆粒|ドライシロップ|DS|散|末|テープ|軟膏|点眼液|点眼|クリーム|ローション|ゲル|吸入液|吸入|注射液|注射|注|液|シロップ|FC|エキス|医療用|配合)/g, '');
    x = x.replace(/[\s　・,，.。／/\-]/g, '');
    x = x.replace(/(塩酸塩|硫酸塩|臭化水素酸塩|マレイン酸塩|カリウム|ナトリウム|水和物)/g, '');
    // 院内プリセットの末尾"分量"を除去（粉末は数量、それ以外は濃度%の後の分量）
    if (isPowder) x = x.replace(/[\d]+(?:g|mg|ml)$/i, '');
    else x = x.replace(/([%％])[\d]+(?:g|mg|ml)$/i, '$1');
    return x.toLowerCase();
  }
  let _nameToPrice = null;
  function getDrugPriceByName(name) {
    if (!masters.y) return null;
    if (!_nameToPrice) {
      _nameToPrice = Object.create(null);
      masters.y.forEach((d) => {
        if (d && d.price != null) { const k = priceNorm(d.name); if (!(k in _nameToPrice)) _nameToPrice[k] = d.price; }
      });
    }
    const v = _nameToPrice[priceNorm(name)];
    return (v == null) ? null : v;
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

  // === ①薬-適応症（drug_indication.json）===

  /** 薬名の正規化（Python make_drug_indication.py の norm_drug と同一規則: NFKC＋空白除去＋小文字） */
  function normDrugName(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
  }

  function buildDrugIndIndex() {
    drugIndList = [];
    const di = tables.drugIndication;
    const arr = di && Array.isArray(di.drugs) ? di.drugs : [];
    for (const e of arr) {
      const key = e.key || normDrugName(e.name);
      drugIndList.push({ key, entry: e });
    }
    // 長いキー優先（アセトアミノフェン錠500mg が 短い曖昧一致より先にマッチ）
    drugIndList.sort((a, b) => b.key.length - a.key.length);
  }

  /** 薬名から適応症エントリを引く（正規化＋包含一致。規格違いは別薬として区別）。
   *  戻り値: {name,adopted,auto,match,note,...} / null */
  function getDrugIndicationByName(name) {
    if (!drugIndList) buildDrugIndIndex();
    if (!drugIndList.length) return null;
    const nd = normDrugName(name);
    if (!nd) return null;
    for (const { key, entry } of drugIndList) {
      if (key.length < 4) continue;
      // 薬名(official)にメーカー等の付加があっても、規格を含むキーの包含で一致
      if (nd === key || nd.includes(key) || key.includes(nd)) return entry;
    }
    return null;
  }

  /** 患者の傷病名が、その薬の適応(match受理語)のいずれかに合致するか（正規化・双方向包含） */
  function diseaseMatchesIndication(diseaseName, entry) {
    if (!entry || !Array.isArray(entry.match)) return false;
    const dn = normDrugName(String(diseaseName).replace(/[（(].*?[）)]/g, '')); // 修飾語括弧除去
    if (dn.length < 2) return false;
    for (const term of entry.match) {
      if (!term || term.length < 2) continue;
      if (dn.includes(term) || term.includes(dn)) return true;
    }
    return false;
  }

  // === ②診察料加算（consultation_add.json）===
  function getConsultAdd() { return tables.consultAdd || null; }

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
    getDrugPriceByName,
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
    getDrugIndicationByName,
    diseaseMatchesIndication,
    getConsultAdd,
    isLoaded,
    getStats,
  };
})();
