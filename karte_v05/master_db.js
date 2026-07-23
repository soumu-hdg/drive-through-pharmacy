// ===== Master DB Manager =====
// 支払基金マスタCSV(UTF-8変換済み)をIndexedDBに取込・検索する

const MasterDB = (() => {
  const DB_NAME = 'KarteMasterDB';
  const DB_VERSION = 2;
  const STORES = {
    drugs: 'drugs',       // 医薬品マスタ
    diseases: 'diseases', // 傷病名マスタ
    medical: 'medical',   // 医科診療行為マスタ
    meta: 'meta'          // メタ情報(取込日時等)
  };

  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        // 医薬品
        if (!d.objectStoreNames.contains(STORES.drugs)) {
          const s = d.createObjectStore(STORES.drugs, { keyPath: 'code' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('yjCode', 'yjCode', { unique: false });
          s.createIndex('kana', 'kana', { unique: false });
        }
        // 傷病名
        if (!d.objectStoreNames.contains(STORES.diseases)) {
          const s = d.createObjectStore(STORES.diseases, { keyPath: 'code' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('icd', 'icd', { unique: false });
          s.createIndex('kana', 'kana', { unique: false });
        }
        // 診療行為
        if (!d.objectStoreNames.contains(STORES.medical)) {
          const s = d.createObjectStore(STORES.medical, { keyPath: 'code' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('kana', 'kana', { unique: false });
          s.createIndex('category', 'category', { unique: false });
        }
        // メタ
        if (!d.objectStoreNames.contains(STORES.meta)) {
          d.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // === CSV Parser (支払基金フォーマット: ダブルクォート囲み, カンマ区切り) ===
  function parseCSVLine(line) {
    const fields = [];
    let i = 0, field = '', inQuote = false;
    while (i < line.length) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (c === '"') { inQuote = false; i++; }
        else { field += c; i++; }
      } else {
        if (c === '"') { inQuote = true; i++; }
        else if (c === ',') { fields.push(field); field = ''; i++; }
        else { field += c; i++; }
      }
    }
    fields.push(field);
    return fields;
  }

  // === 医薬品マスタ取込 ===
  // CSVレイアウト: [0]変更区分,[1]種別(Y),[2]医薬品コード(9桁),[3]漢字有効桁数,[4]漢字名称,
  //   [5]カナ有効桁数,[6]カナ名称,[7]単位コード,[8]単位漢字有効桁数,[9]単位漢字名称,
  //   [10]金額種別,[11]新又は現金額,[12-]...[16]後発品,[28]剤形,...
  //   [29]変更年月日,[30]廃止年月日,[31]薬価基準収載医薬品コード(YJ12桁),...[34]基本漢字名称
  function parseDrugCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const records = [];
    for (const line of lines) {
      const f = parseCSVLine(line);
      if (f[1] !== 'Y') continue;
      const abolishDate = f[30] || '';
      if (abolishDate !== '99999999' && abolishDate !== '') {
        // 廃止済みはスキップ（ただし経過措置期間内は含める）
        const now = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (abolishDate < now) continue;
      }
      const changeType = f[0];
      if (changeType === '9') continue; // 廃止レコードをスキップ
      const price = parseFloat(f[11]) || 0;
      const dosageForm = parseInt(f[27]) || 0; // 剤形: 1=内服,3=注射,6=外用 etc
      const dosageFormLabel = { 1: '内服', 2: '内滴', 3: '注射', 4: '湿布', 5: '坐剤', 6: '外用', 7: '歯科', 8: '注入', 9: '材料' }[dosageForm] || '他';
      records.push({
        code: f[2],                    // 医薬品コード(9桁) = レセ電算コード
        name: f[4],                    // 漢字名称
        kana: f[6],                    // カナ名称
        unitCode: f[7],                // 単位コード
        unit: f[9],                    // 単位名称
        price: price,                  // 薬価
        isGeneric: f[16] === '1',      // 後発品フラグ
        dosageForm: dosageFormLabel,    // 剤形ラベル
        dosageFormCode: dosageForm,     // 剤形コード
        yjCode: f[31] || '',           // 薬価基準収載医薬品コード(YJ12桁)
        genericName: f[34] || '',      // 基本漢字名称(一般名)
        abolishDate: abolishDate
      });
    }
    return records;
  }

  // === 傷病名マスタ取込 ===
  // CSVレイアウト: [0]変更区分,[1]種別(B),[2]傷病名コード,[3]傷病名コード(別),[4]漢字有効桁数,
  //   [5]漢字名称,[6]カナ有効桁数,[7]カナ名称,[8]?,[9]カナ名称(別)?,
  //   [10]変更年月日?,[11]?,[12]ICD-10(短縮形),...
  function parseDiseaseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const records = [];
    for (const line of lines) {
      const f = parseCSVLine(line);
      if (f[1] !== 'B') continue;
      if (f[0] === '9') continue; // 廃止
      const abolishDate = f[23] || f[22] || '';
      if (abolishDate !== '99999999' && abolishDate !== '' && abolishDate.length === 8) {
        const now = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (abolishDate < now) continue;
      }
      // ICD-10: 仕様上 field[12] or field[15] に入る
      let icd = '';
      for (let i = 12; i <= 16; i++) {
        if (f[i] && /^[A-Z]\d/.test(f[i])) { icd = f[i]; break; }
      }
      records.push({
        code: f[2],        // 傷病名コード(7桁)
        name: f[5],        // 漢字名称
        kana: f[7] || f[9] || '',  // カナ名称
        icd: icd,          // ICD-10コード
        abolishDate: abolishDate
      });
    }
    return records;
  }

  // === 医科診療行為マスタ取込 ===
  // CSVレイアウト: [0]変更区分,[1]種別(S),[2]診療行為コード(9桁),[3]漢字有効桁数,[4]漢字名称,
  //   [5]カナ有効桁数,[6]カナ名称,...[10]点数識別,[11]新又は現点数,...
  //   [87]廃止年月日,[88]公表順序番号
  function parseMedicalCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const records = [];
    for (const line of lines) {
      const f = parseCSVLine(line);
      if (f[1] !== 'S') continue;
      if (f[0] === '9') continue;
      const code = f[2];
      const abolishDate = f[87] || '';
      if (abolishDate !== '99999999' && abolishDate !== '' && abolishDate.length === 8) {
        const now = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (abolishDate < now) continue;
      }
      const pointsRaw = parseFloat(f[11]) || 0;
      const pointType = parseInt(f[10]) || 0; // 3=点数(+), 1=金額
      // 診療区分: コードの先頭1-2桁で判定
      const catCode = code.substring(0, 2);
      const catMap = {
        '11': '初診', '12': '再診', '13': '医学管理', '14': '在宅',
        '21': '内服', '22': '頓服', '23': '外用', '24': '調剤',
        '25': '処方', '26': '麻毒', '27': '調基',
        '31': '注射(皮下)', '32': '注射(静脈)', '33': '注射(その他)',
        '40': '処置', '50': '手術', '54': '麻酔',
        '60': '検査', '70': '画像', '80': 'その他'
      };
      const category = catMap[catCode] || '他(' + catCode + ')';
      records.push({
        code: code,                  // 診療行為コード(9桁)
        name: f[4],                  // 漢字名称
        kana: f[6],                  // カナ名称
        points: pointsRaw,           // 点数
        pointType: pointType,        // 点数識別
        category: category,          // 診療区分ラベル
        catCode: catCode,            // 区分コード(2桁)
        abolishDate: abolishDate
      });
    }
    return records;
  }

  // === IndexedDBへの一括書き込み ===
  async function bulkWrite(storeName, records, progressCb) {
    const d = await open();
    const batchSize = 500;
    let written = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await new Promise((resolve, reject) => {
        const tx = d.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        batch.forEach(r => store.put(r));
        tx.oncomplete = () => { written += batch.length; if (progressCb) progressCb(written, records.length); resolve(); };
        tx.onerror = (e) => reject(e.target.error);
      });
    }
    // メタ情報更新
    const tx = d.transaction(STORES.meta, 'readwrite');
    tx.objectStore(STORES.meta).put({ key: storeName + '_imported', date: new Date().toISOString(), count: records.length });
    return written;
  }

  // === ファイル取込 (File API) ===
  async function importFile(file, type, progressCb) {
    const text = await file.text();
    let records;
    switch (type) {
      case 'drugs': records = parseDrugCSV(text); break;
      case 'diseases': records = parseDiseaseCSV(text); break;
      case 'medical': records = parseMedicalCSV(text); break;
      default: throw new Error('Unknown type: ' + type);
    }
    // 既存データクリア
    const d = await open();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(type, 'readwrite');
      tx.objectStore(type).clear();
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    const count = await bulkWrite(type, records, progressCb);
    return count;
  }

  // === 検索 ===
  async function search(storeName, query, limit) {
    limit = limit || 30;
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const results = [];
      const q = query.toLowerCase();
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { resolve(results); return; }
        const r = cursor.value;
        if (r.name.toLowerCase().includes(q) || (r.kana && r.kana.toLowerCase().includes(q)) || r.code.includes(q)) {
          results.push(r);
        }
        cursor.continue();
      };
      cursorReq.onerror = (e) => reject(e.target.error);
    });
  }

  // コードで1件取得
  async function getByCode(storeName, code) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(code);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // 件数取得
  async function getCount(storeName) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // メタ情報取得
  async function getMeta(key) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORES.meta, 'readonly');
      const req = tx.objectStore(STORES.meta).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // masterフォルダからの自動取込 (fetch API)
  async function autoImportFromFolder(progressCb) {
    const files = [
      { url: 'master/y_drug.csv', type: 'drugs', label: '医薬品' },
      { url: 'master/b_disease.csv', type: 'diseases', label: '傷病名' },
      { url: 'master/s_medical.csv', type: 'medical', label: '診療行為' }
    ];
    const results = {};
    for (const f of files) {
      try {
        if (progressCb) progressCb(f.label + ' 取得中...');
        const resp = await fetch(f.url);
        if (!resp.ok) { results[f.type] = { error: 'ファイルなし' }; continue; }
        const text = await resp.text();
        let records;
        switch (f.type) {
          case 'drugs': records = parseDrugCSV(text); break;
          case 'diseases': records = parseDiseaseCSV(text); break;
          case 'medical': records = parseMedicalCSV(text); break;
        }
        // クリア
        const d = await open();
        await new Promise((resolve, reject) => {
          const tx = d.transaction(f.type, 'readwrite');
          tx.objectStore(f.type).clear();
          tx.oncomplete = resolve;
          tx.onerror = (e) => reject(e.target.error);
        });
        if (progressCb) progressCb(f.label + ' 書込中... (' + records.length + '件)');
        const count = await bulkWrite(f.type, records, (w, t) => {
          if (progressCb) progressCb(f.label + ' ' + w + '/' + t);
        });
        results[f.type] = { count };
      } catch (e) {
        results[f.type] = { error: e.message };
      }
    }
    return results;
  }

  // 全マスタのステータスを取得
  async function getStatus() {
    const status = {};
    for (const [key, store] of Object.entries(STORES)) {
      if (key === 'meta') continue;
      try {
        status[key] = {
          count: await getCount(store),
          meta: await getMeta(store + '_imported')
        };
      } catch (e) {
        status[key] = { count: 0, meta: null, error: e.message };
      }
    }
    return status;
  }

  return {
    open, search, getByCode, getCount, getMeta,
    importFile, autoImportFromFolder, getStatus,
    STORES,
    // テスト用に公開
    parseDrugCSV, parseDiseaseCSV, parseMedicalCSV
  };
})();
