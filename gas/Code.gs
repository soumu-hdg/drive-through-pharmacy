/**
 * 薬品在庫管理システム - Google Apps Script v0.1
 * ドライブスルー診療プロジェクト
 *
 * スプレッドシートID: 13AId0dOUOrrZLnFnZi_V4NcOo5OT9pkaFr1UJPIK02c
 * GASプロジェクト: https://script.google.com/home/projects/1vVktinccj0Hm43dt_bEjCPIhXbIwVyhppdCQr87a1cweCGyayYJh55Nv/edit
 */

// ===== 設定 =====
const SPREADSHEET_ID = '13AId0dOUOrrZLnFnZi_V4NcOo5OT9pkaFr1UJPIK02c';

// Web API 共有トークン（クライアント index.html / demo.html の GAS_TOKEN と同じ値にすること）。
// 目的: 無差別CSRF・drive-by（罠ページのimgタグ等）による書き込み/読み取りを遮断する。
// ※このトークンは公開HTML上にも置かれるため万能ではない。恒久対策は
//   「デプロイ → ウェブアプリ → アクセスできるユーザー」を組織アカウント限定にすること。
const API_TOKEN = 'dtp_f929bbd860e2e96224ded613cd06177e';

function unauthorized_() {
  return ContentService
    .createTextOutput(JSON.stringify({ error: 'unauthorized' }))
    .setMimeType(ContentService.MimeType.JSON);
}

const SHEET_NAMES = {
  MEDICINE_MASTER: '薬品マスタ',
  STOCK_IN: '入庫履歴',
  STOCK_OUT: '出庫履歴',
  CURRENT_STOCK: '在庫サマリー',
  PATIENT_MASTER: '患者マスタ',
  STOCK_ADJUST: '修正（棚卸）履歴'
};

/**
 * スプレッドシートを取得（独立プロジェクト対応）
 * 注: GASが独立プロジェクトのため getActiveSpreadsheet() は使えない
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * コードを正規化（先頭ゼロを除去して数値として比較可能にする）
 * QRコード: 59000001 (8桁) と スプレッドシート: 059000001 (9桁) を一致させる
 */
function normalizeCode(code) {
  if (!code) return '';
  const s = String(code).replace(/^[A-Za-z]+/, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? String(code).trim() : String(n);
}

// ===== Web App エンドポイント =====

/**
 * GETリクエスト処理
 */
function doGet(e) {
  const action = e.parameter.action;

  // 認証: 共有トークン必須（無差別CSRF/drive-by遮断）
  if (!e || !e.parameter || e.parameter.token !== API_TOKEN) return unauthorized_();

  let result;
  switch (action) {
    case 'getMedicines':
      result = getMedicineList();
      break;
    case 'getStock':
      result = getCurrentStock();
      break;
    case 'getHistory':
      result = getHistory(e.parameter.date, e.parameter.dateFrom, e.parameter.dateTo, e.parameter.search);
      break;
    case 'getPatients':
      result = getPatientList();
      break;
    // === 書き込み操作（GETで実行 — ブラウザからのPOSTは302リダイレクト問題あり） ===
    case 'stockIn':
      result = recordStockIn({
        code: e.parameter.code,
        quantity: Number(e.parameter.quantity) || 0,
        operator: e.parameter.operator || '',
        note: e.parameter.note || ''
      });
      break;
    case 'stockOut':
      result = recordStockOut({
        code: e.parameter.code,
        quantity: Number(e.parameter.quantity) || 0,
        patientId: e.parameter.patientId || '',
        patientName: e.parameter.patientName || '',
        operator: e.parameter.operator || '',
        note: e.parameter.note || ''
      });
      break;
    case 'stockAdjust':
      result = recordStockAdjust({
        code: e.parameter.code,
        newQuantity: Number(e.parameter.newQuantity) || 0,
        reason: e.parameter.reason || '棚卸',
        operator: e.parameter.operator || '',
        note: e.parameter.note || ''
      });
      break;
    case 'batch':
      result = processBatch(JSON.parse(e.parameter.items || '[]'));
      break;
    case 'recordPrescription':
      result = recordPrescription({
        patientName: e.parameter.patientName || '',
        operator: e.parameter.operator || '',
        entryDate: e.parameter.entryDate || '',
        drugs: JSON.parse(e.parameter.drugs || '[]')
      });
      break;
    case 'getMonthlyConsumption':
      result = getMonthlyConsumption();
      break;
    default:
      result = { error: 'Unknown action' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POSTリクエスト処理
 */
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  // 認証: 共有トークン必須
  if (!data || data.token !== API_TOKEN) return unauthorized_();

  let result;
  switch (action) {
    case 'stockIn':
      result = recordStockIn(data);
      break;
    case 'stockOut':
      result = recordStockOut(data);
      break;
    case 'stockAdjust':
      result = recordStockAdjust(data);
      break;
    case 'addMedicine':
      result = addNewMedicine(data);
      break;
    case 'batch':
      result = processBatch(data.items);
      break;
    case 'deleteHistory':
      result = deleteHistoryEntries(data.items);
      break;
    default:
      result = { error: 'Unknown action' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * バッチ処理（複数アイテムを1リクエストで処理）
 */
function processBatch(items) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { error: 'バッチアイテムがありません' };
  }

  const results = [];
  for (const item of items) {
    let result;
    switch (item.action) {
      case 'stockIn':
        result = recordStockIn(item);
        break;
      case 'stockOut':
        result = recordStockOut(item);
        break;
      case 'stockAdjust':
        result = recordStockAdjust(item);
        break;
      case 'addMedicine':
        result = addNewMedicine(item);
        break;
      default:
        result = { error: 'Unknown action: ' + item.action };
    }
    results.push({ code: item.code, result });
  }

  SpreadsheetApp.flush();

  const successCount = results.filter(r => r.result && r.result.success).length;
  const errorCount = results.length - successCount;

  return {
    success: errorCount === 0,
    message: `${successCount}件成功` + (errorCount > 0 ? `、${errorCount}件失敗` : ''),
    results
  };
}

// ===== 薬品マスタ操作 =====

/**
 * 薬品一覧を取得
 */
function getMedicineList() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.MEDICINE_MASTER);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  const data = sheet.getDataRange().getValues();
  const medicines = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]) {
      medicines.push({
        code: row[0],
        name: row[1],
        furigana: row[2],
        unit: row[3],
        receiptCode: row[4],
        price: row[5],
        threshold: row[6] || 10
      });
    }
  }

  return { success: true, medicines };
}

/**
 * 新規薬品を薬品マスタと在庫サマリーに追加
 */
function addNewMedicine(data) {
  const { name, furigana, unit, receiptCode, price, threshold, initialStock } = data;
  let { code } = data;

  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEET_NAMES.MEDICINE_MASTER);
  const stockSheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);

  if (!masterSheet) {
    return { error: '薬品マスタシートが見つかりません' };
  }
  if (!stockSheet) {
    return { error: '在庫サマリーシートが見つかりません' };
  }

  // コードが空の場合は自動採番
  if (!code) {
    const masterData = masterSheet.getDataRange().getValues();
    let maxNumeric = 59000000;
    for (let i = 1; i < masterData.length; i++) {
      const existingCode = masterData[i][0];
      if (existingCode) {
        const num = parseInt(String(existingCode), 10);
        if (!isNaN(num) && num > maxNumeric) {
          maxNumeric = num;
        }
      }
    }
    const nextNum = maxNumeric + 1;
    code = String(nextNum).padStart(9, '0');
  }

  // 重複チェック
  const masterData = masterSheet.getDataRange().getValues();
  const normalizedNew = normalizeCode(code);
  for (let i = 1; i < masterData.length; i++) {
    if (normalizeCode(masterData[i][0]) === normalizedNew) {
      return { error: 'コードが重複しています: ' + code };
    }
  }

  const stock = initialStock || 0;
  const thresh = threshold || 10;

  // 薬品マスタに追加
  masterSheet.appendRow([code, name, furigana || '', unit || '', receiptCode || '', price || 0, thresh]);

  // 在庫サマリーに追加
  stockSheet.appendRow([code, name, stock, unit || '', thresh, '']);

  return {
    success: true,
    message: '薬品を登録しました: ' + name,
    medicine: { code, name, furigana: furigana || '', unit: unit || '', receiptCode: receiptCode || '', price: price || 0, threshold: thresh, stock }
  };
}

/**
 * 現在の在庫数を取得
 */
function getCurrentStock() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  const data = sheet.getDataRange().getValues();
  const stock = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]) {
      stock.push({
        code: row[0],
        name: row[1],
        currentStock: row[2],
        unit: row[3],
        threshold: row[4],
        lastUpdated: row[5]
      });
    }
  }

  return { success: true, stock };
}

// ===== 入出庫記録 =====

/**
 * 入庫を記録
 */
function recordStockIn(data) {
  const { code, medicineName, quantity, operator, note } = data;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.STOCK_IN);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  const now = new Date();
  const row = [
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    code,
    medicineName || getMedicineName(code),
    quantity,
    getUnit(code),
    operator || '',
    note || ''
  ];

  sheet.appendRow(row);

  // 在庫サマリーを更新
  updateCurrentStock(code, quantity);

  // 夜間休日外来DBの在庫管理タブを更新（在庫数加算のみ、消費量は加算しない）
  const drugName = medicineName || getMedicineName(code);
  updateNightClinicInventory(drugName, quantity);

  return { success: true, message: '入庫を記録しました' };
}

/**
 * 出庫を記録
 */
function recordStockOut(data) {
  const { code, medicineName, quantity, patientId, patientName, operator, note, skipStockUpdate } = data;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  // 在庫チェック（外用薬はスキップ）
  if (!skipStockUpdate) {
    const currentStock = getStockByCode(code);
    if (currentStock < quantity) {
      return { error: '在庫が不足しています', currentStock };
    }
  }

  const now = new Date();
  const row = [
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    code,
    medicineName || getMedicineName(code),
    quantity,
    getUnit(code),
    patientId || '',
    patientName || '',
    operator || '',
    note || ''
  ];

  sheet.appendRow(row);

  // 在庫サマリーを更新（外用薬はスキップ）
  if (!skipStockUpdate) {
    updateCurrentStock(code, -quantity);
  }

  // 夜間休日外来DBの在庫管理タブを更新（在庫数減算 + 月別消費量加算）
  const drugName = medicineName || getMedicineName(code);
  updateNightClinicInventory(drugName, -quantity);

  return { success: true, message: '出庫を記録しました' };
}

/**
 * 棚卸修正を記録（在庫を指定数量に直接設定）
 */
function recordStockAdjust(data) {
  const { code, medicineName, newQuantity, reason, operator, note } = data;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.STOCK_ADJUST);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  // 現在の在庫数を取得
  const currentStock = getStockByCode(code);
  const diff = newQuantity - currentStock;

  const now = new Date();
  const row = [
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    code,
    medicineName || getMedicineName(code),
    currentStock,     // 修正前
    newQuantity,      // 修正後
    diff,             // 差分
    reason || '棚卸',
    operator || '',
    note || ''
  ];

  sheet.appendRow(row);

  // 在庫サマリーを直接更新（差分ではなく絶対値で設定）
  setCurrentStock(code, newQuantity);

  return { success: true, message: '在庫を修正しました', previousStock: currentStock, newStock: newQuantity, diff: diff };
}

/**
 * 在庫サマリーを更新
 */
function updateCurrentStock(code, delta) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const normalizedInput = normalizeCode(code);

  for (let i = 1; i < data.length; i++) {
    if (normalizeCode(data[i][0]) === normalizedInput) {
      const raw = data[i][2];
      const currentStock = (typeof raw === 'number' && !isNaN(raw)) ? raw : (parseInt(String(raw), 10) || 0);
      const newStock = currentStock + delta;
      const now = new Date();

      sheet.getRange(i + 1, 3).setValue(newStock);
      sheet.getRange(i + 1, 6).setValue(
        Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
      );

      return;
    }
  }

  // 該当コードがない場合は新規追加
  const medicine = getMedicineByCode(code);
  if (medicine) {
    sheet.appendRow([
      code,
      medicine.name,
      delta,
      medicine.unit,
      medicine.threshold || 10,
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
    ]);
  }
}

/**
 * 在庫サマリーを絶対値で設定（棚卸修正用）
 */
function setCurrentStock(code, newQuantity) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const normalizedInput = normalizeCode(code);

  for (let i = 1; i < data.length; i++) {
    if (normalizeCode(data[i][0]) === normalizedInput) {
      const now = new Date();
      sheet.getRange(i + 1, 3).setValue(newQuantity);
      sheet.getRange(i + 1, 6).setValue(
        Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
      );
      return;
    }
  }

  // Not found - add new row
  const medicine = getMedicineByCode(code);
  if (medicine) {
    sheet.appendRow([
      code,
      medicine.name,
      newQuantity,
      medicine.unit,
      medicine.threshold || 10,
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
    ]);
  }
}

// ===== 履歴取得 =====

/**
 * 履歴を取得
 */
function getHistory(dateStr, dateFrom, dateTo, search) {
  const ss = getSpreadsheet();
  const inSheet = ss.getSheetByName(SHEET_NAMES.STOCK_IN);
  const outSheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);
  const adjustSheet = ss.getSheetByName(SHEET_NAMES.STOCK_ADJUST);

  // Date range: if dateFrom/dateTo provided, use range; if neither, return all
  let targetDateStart, targetDateEnd;
  if (dateFrom && dateTo) {
    targetDateStart = dateFrom;
    targetDateEnd = dateTo;
  } else if (dateStr) {
    targetDateStart = dateStr;
    targetDateEnd = dateStr;
  } else {
    // No date params = return all history
    targetDateStart = '2000-01-01';
    targetDateEnd = '2099-12-31';
  }

  const searchLower = search ? search.toLowerCase() : '';

  function formatTimestamp(val) {
    if (val instanceof Date) {
      return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    }
    return String(val);
  }

  function matchesDateRange(ts) {
    const dateOnly = ts.substring(0, 10);
    return dateOnly >= targetDateStart && dateOnly <= targetDateEnd;
  }

  function matchesSearch() {
    if (!searchLower) return true;
    for (let i = 0; i < arguments.length; i++) {
      if (arguments[i] && String(arguments[i]).toLowerCase().indexOf(searchLower) >= 0) return true;
    }
    return false;
  }

  const history = [];

  // 入庫履歴
  if (inSheet) {
    const inData = inSheet.getDataRange().getValues();
    for (let i = 1; i < inData.length; i++) {
      const row = inData[i];
      const ts = formatTimestamp(row[0]);
      if (row[0] && matchesDateRange(ts) && matchesSearch(row[2], row[5])) {
        history.push({
          timestamp: ts, type: 'in', code: row[1], name: row[2],
          quantity: row[3], unit: row[4], operator: row[5], note: row[6]
        });
      }
    }
  }

  // 出庫履歴
  if (outSheet) {
    const outData = outSheet.getDataRange().getValues();
    for (let i = 1; i < outData.length; i++) {
      const row = outData[i];
      const ts = formatTimestamp(row[0]);
      if (row[0] && matchesDateRange(ts) && matchesSearch(row[2], row[6], row[7])) {
        history.push({
          timestamp: ts, type: 'out', code: row[1], name: row[2],
          quantity: row[3], unit: row[4], patientId: row[5],
          patientName: row[6], operator: row[7], note: row[8]
        });
      }
    }
  }

  // 修正（棚卸）履歴
  if (adjustSheet) {
    const adjData = adjustSheet.getDataRange().getValues();
    for (let i = 1; i < adjData.length; i++) {
      const row = adjData[i];
      const ts = formatTimestamp(row[0]);
      if (row[0] && matchesDateRange(ts) && matchesSearch(row[2], row[7])) {
        history.push({
          timestamp: ts, type: 'adjust', code: row[1], name: row[2],
          previousStock: row[3], newStock: row[4], diff: row[5],
          reason: row[6], operator: row[7], note: row[8]
        });
      }
    }
  }

  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { success: true, history };
}

// ===== ヘルパー関数 =====

/**
 * コードから薬品情報を取得
 */
function getMedicineByCode(code) {
  const result = getMedicineList();
  const normalizedInput = normalizeCode(code);
  if (result.medicines) {
    return result.medicines.find(m => normalizeCode(m.code) === normalizedInput);
  }
  return null;
}

/**
 * コードから薬品名を取得
 */
function getMedicineName(code) {
  const medicine = getMedicineByCode(code);
  return medicine ? medicine.name : '';
}

/**
 * コードから単位を取得
 */
function getUnit(code) {
  const medicine = getMedicineByCode(code);
  return medicine ? medicine.unit : '';
}

/**
 * コードから現在在庫を取得
 */
function getStockByCode(code) {
  const result = getCurrentStock();
  const normalizedInput = normalizeCode(code);
  if (result.stock) {
    const item = result.stock.find(s => normalizeCode(s.code) === normalizedInput);
    if (item) {
      const v = item.currentStock;
      return (typeof v === 'number' && !isNaN(v)) ? v : (parseInt(String(v), 10) || 0);
    }
    return 0;
  }
  return 0;
}

// ===== 初期セットアップ =====

/**
 * スプレッドシートを初期化
 * メニューから一度だけ実行
 */
function initializeSheets() {
  const ss = getSpreadsheet();

  // 薬品マスタシート
  let sheet = ss.getSheetByName(SHEET_NAMES.MEDICINE_MASTER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.MEDICINE_MASTER);
    sheet.appendRow(['コード', '名前', 'フリガナ', '単位', 'レセ電算コード', '単価', '発注点']);
    sheet.getRange(1, 1, 1, 7).setBackground('#4285f4').setFontColor('#ffffff').setFontWeight('bold');
  }

  // 入庫履歴シート
  sheet = ss.getSheetByName(SHEET_NAMES.STOCK_IN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.STOCK_IN);
    sheet.appendRow(['日時', 'コード', '薬品名', '数量', '単位', '担当者', '備考']);
    sheet.getRange(1, 1, 1, 7).setBackground('#34a853').setFontColor('#ffffff').setFontWeight('bold');
  }

  // 出庫履歴シート
  sheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.STOCK_OUT);
    sheet.appendRow(['日時', 'コード', '薬品名', '数量', '単位', '患者ID', '患者名', '担当者', '備考']);
    sheet.getRange(1, 1, 1, 9).setBackground('#ea4335').setFontColor('#ffffff').setFontWeight('bold');
  }

  // 在庫サマリーシート
  sheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.CURRENT_STOCK);
    sheet.appendRow(['コード', '薬品名', '現在庫', '単位', '発注点', '最終更新']);
    sheet.getRange(1, 1, 1, 6).setBackground('#fbbc04').setFontColor('#000000').setFontWeight('bold');
  }

  // 修正（棚卸）履歴シート
  sheet = ss.getSheetByName(SHEET_NAMES.STOCK_ADJUST);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.STOCK_ADJUST);
    sheet.appendRow(['日時', 'コード', '薬品名', '修正前', '修正後', '差分', '理由', '担当者', '備考']);
    sheet.getRange(1, 1, 1, 9).setBackground('#ff9800').setFontColor('#ffffff').setFontWeight('bold');
  }

  Logger.log('シートを初期化しました');
}

/**
 * サンプルデータを投入
 */
function insertSampleData() {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEET_NAMES.MEDICINE_MASTER);
  const stockSheet = ss.getSheetByName(SHEET_NAMES.CURRENT_STOCK);

  const sampleMedicines = [
    ['059000001', 'クロピドグレル錠75mg「SANIK」', 'クロピドグレルジョウ', '錠', '710010095', 15.5, 30],
    ['059000002', 'ランソプラゾール15mg腸溶性口腔内崩壊錠', 'ランソプラゾール', '錠', '710010096', 12.0, 20],
    ['059000003', 'アムロジンOD錠10mg', 'アムロジン', '錠', '710010097', 18.5, 50],
    ['059000004', 'トラゼンタ錠5mg', 'トラゼンタジョウ', '錠', '710010098', 145.0, 30],
    ['059000005', 'ロスバスタチン錠5mg「DSEP」', 'ロスバスタチンジョウ', '錠', '710010099', 22.0, 40],
    ['059000006', 'ジャディアンス錠10mg', 'ジャディアンスジョウ', '錠', '710010100', 180.0, 30],
    ['059000007', 'センノシド錠12mg「サワイ」', 'センノシドジョウ', '錠', '710010101', 5.6, 50],
    ['059000008', 'ロキソプロフェンNaテープ100mg', 'ロキソプロフェン', '枚', '710010102', 20.0, 30],
    ['059000009', '万年筆型注入器用注射針（超微細型）', 'マンネンヒツガタチュウシャバリ', '本', '710010103', 15.0, 50],
    ['059000010', 'ライゾデグ配合注 フレックスタッチ 300単位', 'ライゾデグ', 'キット', '710010104', 2500.0, 5],
  ];

  const sampleStock = [
    ['059000001', 'クロピドグレル錠75mg「SANIK」', 120, '錠', 30, ''],
    ['059000002', 'ランソプラゾール15mg腸溶性口腔内崩壊錠', 85, '錠', 20, ''],
    ['059000003', 'アムロジンOD錠10mg', 200, '錠', 50, ''],
    ['059000004', 'トラゼンタ錠5mg', 45, '錠', 30, ''],
    ['059000005', 'ロスバスタチン錠5mg「DSEP」', 150, '錠', 40, ''],
    ['059000006', 'ジャディアンス錠10mg', 60, '錠', 30, ''],
    ['059000007', 'センノシド錠12mg「サワイ」', 180, '錠', 50, ''],
    ['059000008', 'ロキソプロフェンNaテープ100mg', 25, '枚', 30, ''],
    ['059000009', '万年筆型注入器用注射針（超微細型）', 100, '本', 50, ''],
    ['059000010', 'ライゾデグ配合注 フレックスタッチ 300単位', 8, 'キット', 5, ''],
  ];

  if (masterSheet) {
    sampleMedicines.forEach(row => masterSheet.appendRow(row));
  }

  if (stockSheet) {
    sampleStock.forEach(row => stockSheet.appendRow(row));
  }

  SpreadsheetApp.getUi().alert('サンプルデータを投入しました');
}

// ===== 患者マスタ機能 =====

const PATIENT_COLS = {
  ID: 0,
  NAME: 1,
  FURIGANA: 2,
  GENDER: 3,
  BIRTH_DATE: 4,
  AGE: 5,
  LAST_VISIT: 6,
  ZIP: 7,
  ADDRESS: 8,
  PHONE1: 9,
  PHONE2: 10,
  NORMALIZED: 11
};

/**
 * 患者一覧を取得
 */
function getPatientList() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PATIENT_MASTER);

  if (!sheet) {
    return { error: 'シートが見つかりません' };
  }

  const data = sheet.getDataRange().getValues();
  const patients = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[PATIENT_COLS.ID]) {
      patients.push({
        id: String(row[PATIENT_COLS.ID]),
        name: row[PATIENT_COLS.NAME],
        furigana: row[PATIENT_COLS.FURIGANA],
        gender: row[PATIENT_COLS.GENDER],
        birthDate: row[PATIENT_COLS.BIRTH_DATE],
        normalizedName: row[PATIENT_COLS.NORMALIZED] || normalizeNameForSearch(row[PATIENT_COLS.NAME])
      });
    }
  }

  return { success: true, patients };
}

/**
 * 名前を正規化（空白除去）
 */
function normalizeNameForSearch(name) {
  if (!name) return '';
  return name.replace(/[\s　]+/g, '');
}

/**
 * 患者マスタシートを初期化
 */
function initializePatientMasterSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.PATIENT_MASTER);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.PATIENT_MASTER);
  } else {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  }

  sheet.getRange(1, 1, 1, 6).setValues([['患者ID', '患者氏名', 'フリガナ', '性別', '生年月日', '正規化氏名']]);
  sheet.getRange(1, 1, 1, 6).setBackground('#9c27b0').setFontColor('#ffffff').setFontWeight('bold');

  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 60);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 120);

  return sheet;
}

/**
 * Google DriveのCSVファイルから患者マスタをインポート
 */
function importPatientMasterFromDrive() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'DriveからCSVインポート',
    'Google Driveに保存したCSVファイル名を入力してください\n（例: PatientList-20260303172116.csv）:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const fileName = response.getResponseText().trim();
  if (!fileName) {
    ui.alert('ファイル名が入力されていません');
    return;
  }

  try {
    const files = DriveApp.getFilesByName(fileName);
    if (!files.hasNext()) {
      ui.alert('ファイルが見つかりません: ' + fileName);
      return;
    }

    const file = files.next();
    const csvText = file.getBlob().getDataAsString('Shift_JIS');

    const result = importPatientMasterFromCSVText(csvText);
    ui.alert(result.message);

  } catch (e) {
    ui.alert('エラー: ' + e.message);
  }
}

/**
 * CSVテキストから患者マスタをインポート（手動貼り付け）
 */
function importPatientMasterFromText() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    '患者CSVインポート',
    'M3からダウンロードしたCSVの内容をここに貼り付けてください（先頭100行程度）:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const csvText = response.getResponseText();
  if (!csvText) {
    ui.alert('CSVテキストが入力されていません');
    return;
  }

  const result = importPatientMasterFromCSVText(csvText);
  ui.alert(result.message);
}

/**
 * CSVテキストから患者マスタをインポート（内部処理）
 */
function importPatientMasterFromCSVText(csvText) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.PATIENT_MASTER);

  if (!sheet) {
    sheet = initializePatientMasterSheet();
  }

  const lines = csvText.split('\n');
  let importCount = 0;
  let skipCount = 0;

  const existingData = sheet.getDataRange().getValues();
  const existingIds = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][0]) {
      existingIds.add(String(existingData[i][0]));
    }
  }

  const newRows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    if (cols.length < 5) continue;

    const patientId = cols[0];
    const patientName = cols[1];
    const furigana = cols[2];
    const gender = cols[3];
    const birthDate = cols[4];

    if (!patientId || !patientName) continue;

    if (existingIds.has(patientId)) {
      skipCount++;
      continue;
    }

    const normalizedName = normalizeNameForSearch(patientName);
    newRows.push([patientId, patientName, furigana, gender, birthDate, normalizedName]);
    existingIds.add(patientId);
    importCount++;
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 6).setValues(newRows);
  }

  return {
    success: true,
    message: `インポート完了: ${importCount}件追加、${skipCount}件スキップ（重複）`
  };
}

/**
 * CSVの1行を解析
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * 出庫履歴の患者IDを自動補完
 */
function fillMissingPatientIds() {
  const ss = getSpreadsheet();
  const outSheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);
  const patientSheet = ss.getSheetByName(SHEET_NAMES.PATIENT_MASTER);

  if (!outSheet) return { error: '出庫履歴シートが見つかりません' };
  if (!patientSheet) return { error: '患者マスタシートが見つかりません' };

  const patientData = patientSheet.getDataRange().getValues();
  const patientMap = new Map();

  for (let i = 1; i < patientData.length; i++) {
    const row = patientData[i];
    if (!row[PATIENT_COLS.ID] || !row[PATIENT_COLS.NAME]) continue;

    const id = String(row[PATIENT_COLS.ID]);
    const name = row[PATIENT_COLS.NAME];
    const normalizedName = row[PATIENT_COLS.NORMALIZED] || normalizeNameForSearch(name);

    if (!patientMap.has(normalizedName)) {
      patientMap.set(normalizedName, []);
    }
    patientMap.get(normalizedName).push({ id, name });
  }

  const outData = outSheet.getDataRange().getValues();
  let updateCount = 0;
  let multiMatchCount = 0;
  const updates = [];

  for (let i = 1; i < outData.length; i++) {
    const row = outData[i];
    const patientId = row[5];
    const patientName = row[6];

    if (patientName && !patientId) {
      const normalizedSearch = normalizeNameForSearch(patientName);
      const matches = patientMap.get(normalizedSearch);

      if (matches && matches.length > 0) {
        if (matches.length === 1) {
          updates.push({ row: i + 1, col: 6, value: matches[0].id });
          updateCount++;
        } else {
          const ids = matches.map(m => m.id).join(',');
          updates.push({ row: i + 1, col: 6, value: ids });
          multiMatchCount++;
          updateCount++;
        }
      }
    }
  }

  updates.forEach(update => {
    outSheet.getRange(update.row, update.col).setValue(update.value);
  });

  const message = `患者ID補完完了: ${updateCount}件更新（うち複数候補: ${multiMatchCount}件）`;
  Logger.log(message);

  return { success: true, message, updateCount, multiMatchCount };
}

/**
 * 患者マスタの正規化氏名（L列）を一括生成
 */
function generateNormalizedNames() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PATIENT_MASTER);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('患者マスタシートが見つかりません');
    return;
  }

  const lastRow = sheet.getLastRow();

  const normalizedCol = PATIENT_COLS.NORMALIZED + 1;
  sheet.getRange(1, normalizedCol).setValue('正規化氏名');
  sheet.getRange(1, normalizedCol).setBackground('#9c27b0').setFontColor('#ffffff').setFontWeight('bold');

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('データがありません');
    return;
  }

  const names = sheet.getRange(2, PATIENT_COLS.NAME + 1, lastRow - 1, 1).getValues();
  const normalizedNames = names.map(row => [normalizeNameForSearch(row[0])]);
  sheet.getRange(2, normalizedCol, lastRow - 1, 1).setValues(normalizedNames);

  SpreadsheetApp.getUi().alert(`正規化氏名を ${lastRow - 1} 件生成しました`);
}

/**
 * 毎日朝9時のトリガーを設定
 */
function setupDailyPatientIdTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'fillMissingPatientIds') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('fillMissingPatientIds')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  SpreadsheetApp.getUi().alert('毎日朝9時の自動実行を設定しました');
}

/**
 * 患者ID補完を手動実行（メニュー用）
 */
function runFillMissingPatientIds() {
  const result = fillMissingPatientIds();
  SpreadsheetApp.getUi().alert(result.message || result.error);
}

// ===== 夜間休日外来DB連携 =====

const PRESCRIPTION_SS_ID = '12ylHWZhQO2ABfT6xhMM3z8jfD31kH7lRbaGY-Br4Y-k';
const PRESCRIPTION_SHEET_NAME = '処方履歴';
const NIGHTCLINIC_INVENTORY_SHEET = '在庫管理';

/**
 * 夜間休日外来DBの在庫管理タブを更新
 * - 在庫数（B列）を増減
 * - 出庫時のみ: 該当月の消費量列に加算
 *
 * @param {string} medicineName - 薬品名（A列と照合）
 * @param {number} delta - 在庫の変動量（出庫: -N, 入庫: +N）
 */
function updateNightClinicInventory(medicineName, delta) {
  if (!medicineName || delta === 0) return;

  try {
    const ss = SpreadsheetApp.openById(PRESCRIPTION_SS_ID);
    const sheet = ss.getSheetByName(NIGHTCLINIC_INVENTORY_SHEET);
    if (!sheet) {
      Logger.log('在庫管理シートが見つかりません');
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 2) return;

    // ヘッダー行を取得（1行目）
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // A列の薬品名一覧を取得（2行目以降）
    const drugNames = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    // 薬品名の部分一致で行を検索（正規化して比較）
    function normDrug(n) {
      return String(n || '').replace(/[\s\u3000]+/g, '').replace(/[「」『』（）()]/g, '');
    }
    const targetNorm = normDrug(medicineName);
    let matchedRow = -1;

    for (let i = 0; i < drugNames.length; i++) {
      const rowNorm = normDrug(drugNames[i][0]);
      if (rowNorm === targetNorm) {
        matchedRow = i + 2; // 1-indexed, ヘッダー分+1
        break;
      }
    }

    // 完全一致がない場合、部分一致を試す
    if (matchedRow === -1) {
      for (let i = 0; i < drugNames.length; i++) {
        const rowNorm = normDrug(drugNames[i][0]);
        if (rowNorm && targetNorm && (rowNorm.includes(targetNorm) || targetNorm.includes(rowNorm))) {
          matchedRow = i + 2;
          break;
        }
      }
    }

    if (matchedRow === -1) {
      Logger.log('在庫管理: 薬品名不一致 - ' + medicineName);
      return;
    }

    // B列（在庫数）を更新
    const stockCell = sheet.getRange(matchedRow, 2);
    const currentStock = Number(stockCell.getValue()) || 0;
    stockCell.setValue(currentStock + delta);

    // 出庫の場合のみ月別消費量を加算
    if (delta < 0) {
      const now = new Date();
      const currentMonth = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM');
      // 短縮形（2026/1, 2026/01 等）にも対応
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      let monthCol = -1;
      for (let c = 2; c < headers.length; c++) {
        const h = String(headers[c]).trim();
        if (!h) continue;
        // ヘッダーが日付オブジェクトの場合
        if (headers[c] instanceof Date) {
          const hYear = headers[c].getFullYear();
          const hMonth = headers[c].getMonth() + 1;
          if (hYear === year && hMonth === month) {
            monthCol = c + 1; // 1-indexed
            break;
          }
          continue;
        }
        // 文字列ヘッダー: "2026/06", "2026/6", "2026年6月" 等
        const m = h.match(/(\d{4})[\/\-年](\d{1,2})/);
        if (m && Number(m[1]) === year && Number(m[2]) === month) {
          monthCol = c + 1;
          break;
        }
      }

      if (monthCol === -1) {
        // 該当月の列がない → 新しい列を末尾に追加
        monthCol = lastCol + 1;
        const monthLabel = year + '/' + String(month).padStart(2, '0');
        sheet.getRange(1, monthCol).setValue(monthLabel);
      }

      // 消費量を加算（deltaは負なのでMath.absで正にする）
      const consumeCell = sheet.getRange(matchedRow, monthCol);
      const currentConsume = Number(consumeCell.getValue()) || 0;
      consumeCell.setValue(currentConsume + Math.abs(delta));
    }

    Logger.log('在庫管理更新: ' + medicineName + ' delta=' + delta + ' row=' + matchedRow);
  } catch (e) {
    Logger.log('在庫管理更新エラー: ' + e.message);
  }
}

/**
 * 夜間休日外来DBの在庫管理タブから月別消費量データを取得
 */
function getMonthlyConsumption() {
  try {
    const ss = SpreadsheetApp.openById(PRESCRIPTION_SS_ID);
    const sheet = ss.getSheetByName(NIGHTCLINIC_INVENTORY_SHEET);
    if (!sheet) {
      return { success: false, error: '在庫管理シートが見つかりません' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { success: true, months: [], drugs: [] };
    }

    // ヘッダー行: A=薬品名, B=在庫数, C以降=月別
    const headers = data[0];
    const months = [];
    for (let c = 2; c < headers.length; c++) {
      const h = headers[c];
      if (!h) continue;
      if (h instanceof Date) {
        months.push({ col: c, label: Utilities.formatDate(h, 'Asia/Tokyo', 'yyyy/MM') });
      } else {
        const s = String(h).trim();
        if (s) months.push({ col: c, label: s });
      }
    }

    const drugs = [];
    for (let r = 1; r < data.length; r++) {
      const name = String(data[r][0] || '').trim();
      if (!name) continue;
      const stock = Number(data[r][1]) || 0;
      const monthly = {};
      let total = 0;
      for (const m of months) {
        const val = Number(data[r][m.col]) || 0;
        monthly[m.label] = val;
        total += val;
      }
      drugs.push({ name, stock, monthly, total });
    }

    return { success: true, months: months.map(m => m.label), drugs };
  } catch (e) {
    return { success: false, error: '月別消費量取得エラー: ' + e.message };
  }
}

/**
 * 処方履歴を夜間休日外来DBに記録
 * 患者名＋診察日で処方履歴シートを検索し、一致すれば薬品を記入。不一致なら右セクションに追加。
 * 処方管理入力日（H列）は送信日を自動設定。
 */
function recordPrescription(data) {
  const { patientName, operator, entryDate, drugs } = data;
  // entryDate = 診察日（フロントエンドの「診察日」フィールド）
  // drugs: [{name, quantity}, ...]  フロントエンドの薬品名をそのまま使用

  if (!patientName || !drugs || drugs.length === 0) {
    return { success: false, error: 'patientNameとdrugsが必要です' };
  }

  try {
    const ss = SpreadsheetApp.openById(PRESCRIPTION_SS_ID);
    const sheet = ss.getSheetByName(PRESCRIPTION_SHEET_NAME);
    if (!sheet) {
      return { success: false, error: '処方履歴シートが見つかりません' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      return { success: false, error: 'シートにデータがありません' };
    }

    // 患者名正規化（空白の全角/半角の違いを吸収）
    function normName(n) {
      return (n || '').replace(/[\s\u3000]+/g, '').toLowerCase();
    }

    // 日付正規化（yyyy-MM-dd形式に統一）
    function normDate(d) {
      if (!d) return '';
      if (d instanceof Date) {
        return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
      }
      const s = String(d).trim();
      // yyyy/MM/dd → yyyy-MM-dd
      const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
      return s;
    }

    const targetNorm = normName(patientName);
    const targetDate = normDate(entryDate);

    // 左セクション: A列(患者名) + D列(診察日) で検索（薬品未記入の行を優先）
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 11).getValues(); // A2:K{lastRow}

    let matchedRow = -1;
    for (let i = 0; i < dataRange.length; i++) {
      const rowName = normName(dataRange[i][0]); // A列: 患者名
      const rowDate = normDate(dataRange[i][3]); // D列: 診察日
      const rowDrugA = dataRange[i][10];          // K列: 処方薬A

      if (rowName === targetNorm && rowDate === targetDate) {
        // 患者名＋診察日が一致: 処方薬Aが空の行を優先
        if (!rowDrugA) {
          matchedRow = i + 2;
          break;
        }
        if (matchedRow === -1) matchedRow = i + 2;
      }
    }

    // 薬品を最大6つに分割（フロントエンドの薬品名をそのまま使用）
    const maxDrugs = 6;
    const drugList = drugs.slice(0, maxDrugs);

    // 処方管理入力日 = 送信日（今日）を自動設定
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

    if (matchedRow > 0) {
      // === 患者名＋診察日一致: 左セクションに記入 ===
      // G列: 入力担当者、H列: 処方管理入力日（自動＝今日）
      sheet.getRange(matchedRow, 7).setValue(operator || '');
      sheet.getRange(matchedRow, 8).setValue(today);

      // K-V列: 処方薬A~F + 数量（K=11, L=12, M=13, N=14, ...）
      for (let i = 0; i < drugList.length; i++) {
        const col = 11 + i * 2; // K=11, M=13, O=15, Q=17, S=19, U=21
        sheet.getRange(matchedRow, col).setValue(drugList[i].name);
        sheet.getRange(matchedRow, col + 1).setValue(drugList[i].quantity);
      }

      // 7件以上ある場合は右セクションにも追加
      if (drugs.length > maxDrugs) {
        appendToUnmatchedSection(sheet, patientName, operator, today, drugs.slice(maxDrugs));
      }

      return { success: true, message: '処方履歴に記録しました（患者一致）', matched: true, row: matchedRow };
    } else {
      // === 患者名不一致: 右セクション（X列以降、5行目から）に追加 ===
      appendToUnmatchedSection(sheet, patientName, operator, today, drugs);
      return { success: true, message: '処方履歴に記録しました（名前不一致 → 右セクション）', matched: false };
    }

  } catch (e) {
    return { success: false, error: '処方履歴記録エラー: ' + e.message };
  }
}

/**
 * 右セクション（X列以降）にデータを追加
 */
function appendToUnmatchedSection(sheet, patientName, operator, prescriptionDate, drugs) {
  // 右セクションは4行目がヘッダー、5行目からデータ
  // X=24, Y=25, Z=26, AA=27, AB=28, ...
  const startCol = 24; // X列
  const headerRow = 4;
  const dataStartRow = 5;

  // 右セクションで次の空行を探す
  const lastRow = sheet.getLastRow();
  let nextRow = dataStartRow;
  if (lastRow >= dataStartRow) {
    const xCol = sheet.getRange(dataStartRow, startCol, lastRow - dataStartRow + 1, 1).getValues();
    for (let i = 0; i < xCol.length; i++) {
      if (xCol[i][0]) {
        nextRow = dataStartRow + i + 1;
      }
    }
    // xColの最後の値が入っている行の次
    if (nextRow <= dataStartRow) nextRow = dataStartRow;
    // もう一度確認: 最後に値がある行+1
    for (let i = xCol.length - 1; i >= 0; i--) {
      if (xCol[i][0]) {
        nextRow = dataStartRow + i + 1;
        break;
      }
    }
    // 全部空なら5行目から
    const hasAny = xCol.some(r => r[0]);
    if (!hasAny) nextRow = dataStartRow;
  }

  // X: 患者名, Y: 入力担当者, Z: 処方管理入力日
  sheet.getRange(nextRow, startCol).setValue(patientName);
  sheet.getRange(nextRow, startCol + 1).setValue(operator || '');
  sheet.getRange(nextRow, startCol + 2).setValue(prescriptionDate || '');

  // AA以降: 処方薬A, Aの数量, 処方薬B, Bの数量, ...
  const maxDrugs = 6;
  const drugList = drugs.slice(0, maxDrugs);
  for (let i = 0; i < drugList.length; i++) {
    const col = startCol + 3 + i * 2; // AA=27, AC=29, AE=31, AG=33, AI=35, AK=37
    sheet.getRange(nextRow, col).setValue(drugList[i].name);
    sheet.getRange(nextRow, col + 1).setValue(drugList[i].quantity);
  }
}

/**
 * 出庫履歴から処方履歴へバックフィル（1回だけ実行）
 * 出庫履歴の全レコードを患者別にグループ化し、処方履歴シートに転記する。
 * 既に処方薬Aが記入されている行はスキップする。
 */
function backfillPrescriptions() {
  const ss = getSpreadsheet();
  const outSheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);
  if (!outSheet) {
    Logger.log('出庫履歴シートが見つかりません');
    return;
  }

  const outData = outSheet.getDataRange().getValues();
  // ヘッダー: 日時, コード, 薬品名, 数量, 単位, 患者ID, 患者名, 担当者, 備考

  // 患者別にグループ化（同一患者・同一日でグループ）
  const groups = {};
  for (let i = 1; i < outData.length; i++) {
    const row = outData[i];
    const timestamp = row[0];
    const drugName = row[2];
    const quantity = row[3];
    const patientName = String(row[6] || '').trim();
    const operator = row[7];
    const note = row[8] || '';

    if (!patientName || patientName === 'テスト') continue;

    // 入力日を備考から取得、なければタイムスタンプの日付
    let entryDate = '';
    const noteStr = String(note);
    const dateMatch = noteStr.match(/入力日:(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      entryDate = dateMatch[1];
    } else if (timestamp instanceof Date) {
      entryDate = Utilities.formatDate(timestamp, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      entryDate = String(timestamp).substring(0, 10);
    }

    // キー: 患者名 + 入力日（同じ患者でも別の日は別グループ）
    const key = patientName + '|' + entryDate;
    if (!groups[key]) {
      groups[key] = { patientName, operator, entryDate, drugs: [] };
    }
    groups[key].drugs.push({ name: drugName, quantity });
  }

  // 各グループを処方履歴に記録
  let successCount = 0;
  let skipCount = 0;
  let unmatchedCount = 0;

  for (const key of Object.keys(groups)) {
    const g = groups[key];
    const result = recordPrescription({
      patientName: g.patientName,
      operator: g.operator,
      entryDate: g.entryDate,
      drugs: g.drugs
    });

    if (result.success) {
      if (result.matched) {
        successCount++;
      } else {
        unmatchedCount++;
      }
    } else {
      skipCount++;
      Logger.log('スキップ: ' + g.patientName + ' - ' + result.error);
    }
  }

  const msg = `バックフィル完了: ${successCount}件一致, ${unmatchedCount}件不一致(右セクション), ${skipCount}件スキップ`;
  Logger.log(msg);

  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // Web App実行時はUIがないのでログのみ
  }

  return { success: true, message: msg, successCount, unmatchedCount, skipCount };
}

/**
 * カスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('在庫管理')
    .addItem('シートを初期化', 'initializeSheets')
    .addItem('サンプルデータ投入', 'insertSampleData')
    .addSeparator()
    .addSubMenu(ui.createMenu('患者マスタ')
      .addItem('患者マスタシートを作成', 'initializePatientMasterSheet')
      .addItem('DriveのCSVからインポート', 'importPatientMasterFromDrive')
      .addItem('テキスト貼り付けでインポート', 'importPatientMasterFromText')
      .addItem('正規化氏名を生成', 'generateNormalizedNames')
      .addSeparator()
      .addItem('患者ID自動補完（手動実行）', 'runFillMissingPatientIds')
      .addItem('毎日9時の自動実行を設定', 'setupDailyPatientIdTrigger'))
    .addSeparator()
    .addItem('処方履歴バックフィル（出庫→処方履歴転記）', 'backfillPrescriptions')
    .addToUi();
}

/**
 * 履歴エントリを削除し、在庫を自動調整する
 * items: [{type, code, date, time, quantity, medicine, patient}]
 */
function deleteHistoryEntries(items) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { error: '削除対象がありません' };
  }

  const ss = getSpreadsheet();
  const inSheet = ss.getSheetByName(SHEET_NAMES.STOCK_IN);
  const outSheet = ss.getSheetByName(SHEET_NAMES.STOCK_OUT);
  const adjustSheet = ss.getSheetByName(SHEET_NAMES.STOCK_ADJUST);

  let deletedCount = 0;

  // シートごとに削除行を収集（行番号の大きい方から削除するため降順ソート）
  function findAndDeleteRows(sheet, entries, matchFn) {
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const rowsToDelete = [];

    for (const entry of entries) {
      for (let i = data.length - 1; i >= 1; i--) {
        if (matchFn(data[i], entry)) {
          rowsToDelete.push(i + 1); // 1-indexed
          data.splice(i, 1); // prevent double-matching
          break;
        }
      }
    }

    // 降順にソートして削除（行番号がずれないように）
    rowsToDelete.sort((a, b) => b - a);
    for (const row of rowsToDelete) {
      sheet.deleteRow(row);
      deletedCount++;
    }
  }

  function formatTimestamp(val) {
    if (val instanceof Date) {
      return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    }
    return String(val);
  }

  // 入庫履歴の削除
  const inEntries = items.filter(e => e.type === 'in');
  if (inEntries.length > 0) {
    findAndDeleteRows(inSheet, inEntries, (row, entry) => {
      const ts = formatTimestamp(row[0]);
      const rowDate = ts.substring(0, 10);
      const rowTime = ts.substring(11, 16);
      return rowDate === entry.date &&
             rowTime === entry.time &&
             normalizeCode(row[1]) === normalizeCode(entry.code) &&
             Number(row[3]) === Number(entry.quantity);
    });
  }

  // 出庫履歴の削除
  const outEntries = items.filter(e => e.type === 'out');
  if (outEntries.length > 0) {
    findAndDeleteRows(outSheet, outEntries, (row, entry) => {
      const ts = formatTimestamp(row[0]);
      const rowDate = ts.substring(0, 10);
      const rowTime = ts.substring(11, 16);
      return rowDate === entry.date &&
             rowTime === entry.time &&
             normalizeCode(row[1]) === normalizeCode(entry.code) &&
             Number(row[3]) === Number(entry.quantity);
    });
  }

  // 修正履歴の削除
  const adjustEntries = items.filter(e => e.type === 'adjust');
  if (adjustEntries.length > 0) {
    findAndDeleteRows(adjustSheet, adjustEntries, (row, entry) => {
      const ts = formatTimestamp(row[0]);
      const rowDate = ts.substring(0, 10);
      const rowTime = ts.substring(11, 16);
      return rowDate === entry.date &&
             rowTime === entry.time &&
             normalizeCode(row[1]) === normalizeCode(entry.code);
    });
  }

  // 在庫サマリーを調整
  for (const entry of items) {
    if (entry.type === 'in') {
      // 入庫を取り消す → 在庫を減算
      updateCurrentStock(entry.code, -Number(entry.quantity));
    } else if (entry.type === 'out') {
      // 出庫を取り消す → 在庫を加算
      updateCurrentStock(entry.code, Number(entry.quantity));
    }
    // adjust の取り消しは在庫サマリーを変更しない（棚卸修正は差分管理が複雑なため）
  }

  // 処方履歴シートからも出庫に対応するレコードを削除
  const prescSheet = ss.getSheetByName('処方履歴');
  if (prescSheet && outEntries.length > 0) {
    const prescData = prescSheet.getDataRange().getValues();
    const prescRowsToDelete = [];

    for (const entry of outEntries) {
      for (let i = prescData.length - 1; i >= 1; i--) {
        const ts = formatTimestamp(prescData[i][0]);
        const rowDate = ts.substring(0, 10);
        const rowTime = ts.substring(11, 16);
        const rowCode = normalizeCode(prescData[i][2]);
        if (rowDate === entry.date && rowTime === entry.time && rowCode === normalizeCode(entry.code)) {
          prescRowsToDelete.push(i + 1);
          prescData.splice(i, 1);
          break;
        }
      }
    }

    prescRowsToDelete.sort((a, b) => b - a);
    for (const row of prescRowsToDelete) {
      prescSheet.deleteRow(row);
    }
  }

  return { success: true, deleted: deletedCount };
}
