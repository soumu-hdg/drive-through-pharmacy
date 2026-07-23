// ===== 在庫管理アプリ連携モジュール (inventory_stock.js) 2026-07-03 =====
// 薬品在庫管理アプリ（GAS getStock）から在庫を取得し、院内薬タブに
// 在庫数＋横バーで表示する。残少（stock <= threshold）は短く赤（在庫アプリと同基準）。
// ★読み取り専用。カルテからの在庫増減（書き戻し）は未実装（本番運用前のため）。
// 依存(実行時グローバル): drugTabMode, renderBillingMenu（app.js）

// 薬品在庫管理アプリ本番GAS（portalの「薬品在庫管理」= getStockで121件・thresholdあり）
const INV_GAS_URL = 'https://script.google.com/macros/s/AKfycbzK2lx3UDMxKoOdVJy53HpVSyHhMmJaVaf4Cjh90JUALwLj5aQk8_fN2ncYzVlqPZ-mCg/exec';
// 在庫管理GASのAPI_TOKEN（トークン必須化済み。未送信だと unauthorized で院内薬が空になる）
const INV_GAS_TOKEN = 'dtp_f929bbd860e2e96224ded613cd06177e';

let invStockList = [];     // [{code,name,currentStock,unit,threshold}]
let invStockMap = {};      // 正規化名 → entry
let invStockLoaded = false;
let invStockLoading = false;
let invStockError = null;

// 薬品名の正規化（全角/半角・空白・剤形/塩の差異を吸収してカルテ名と照合）
function invNorm(s) {
  if (!s) return '';
  s = String(s).normalize('NFKC');        // 全角英数・記号 → 半角
  s = s.replace(/[\s　]/g, '');        // 半角/全角スペース除去
  s = s.replace(/(錠|カプセル|OD|塩酸塩|カリウム|塩)/g, '');
  return s.toLowerCase();
}

// 在庫データ取得（院内薬タブ初回表示時に遅延ロード）
async function loadInventoryStock() {
  if (invStockLoaded || invStockLoading) return;
  invStockLoading = true;
  invStockError = null;
  try {
    const res = await fetch(INV_GAS_URL + '?action=getStock&token=' + encodeURIComponent(INV_GAS_TOKEN));
    const data = await res.json();
    if (!data || !data.success || !Array.isArray(data.stock)) {
      throw new Error((data && data.error) || 'getStock応答が不正');
    }
    invStockList = data.stock.filter(function (s) { return s && s.name; });
    invStockMap = {};
    invStockList.forEach(function (s) { invStockMap[invNorm(s.name)] = s; });
    invStockLoaded = true;
  } catch (e) {
    invStockError = e.message || String(e);
    console.error('在庫管理アプリ連携エラー:', e);
  } finally {
    invStockLoading = false;
    // 院内薬タブが開いていれば再描画
    if (typeof drugTabMode !== 'undefined' && drugTabMode === 'internal' && typeof renderBillingMenu === 'function') {
      renderBillingMenu();
    }
  }
}

// カルテ薬名から在庫エントリを引く（正規化照合）
function getInvEntry(name) {
  if (!invStockLoaded) return null;
  return invStockMap[invNorm(name)] || null;
}

// 在庫数＋横バーのHTML。残少(stock<=threshold)は短く赤、余裕はティール。
function invStockBar(entry) {
  if (!entry) return '';
  const stock = Number(entry.currentStock) || 0;
  const th = Number(entry.threshold) || 0;
  const unit = entry.unit || '';
  // バー長: 閾値の3倍で満タン（残少なら自然に短くなる）
  const refMax = th > 0 ? th * 3 : Math.max(stock, 1);
  let pct = Math.round((stock / refMax) * 100);
  pct = Math.max(stock > 0 ? 3 : 0, Math.min(100, pct));   // 在庫ありは最低3%見せる
  const low = th > 0 ? stock <= th : stock <= 0;             // 在庫アプリと同基準
  const mid = th > 0 && stock > th && stock <= th * 2;
  const barColor = low ? '#dc2626' : (mid ? '#d97706' : '#0e7c66');
  const numColor = low ? '#dc2626' : 'var(--text)';
  return '<span style="display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;">' +
    '<span title="在庫' + stock + unit + ' / 閾値' + th + '" style="display:inline-block;width:54px;height:7px;background:#e5e7eb;border-radius:4px;overflow:hidden;">' +
      '<span style="display:block;height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;"></span>' +
    '</span>' +
    '<span style="font-size:10px;font-weight:700;color:' + numColor + ';white-space:nowrap;min-width:30px;text-align:right;">' +
      (stock <= 0 ? '在庫0' : (stock + unit)) + (low ? ' ⚠' : '') +
    '</span>' +
  '</span>';
}

// 院内薬タブ用: 在庫121件をカルテのdrug形式で返す（price=0は当面の暫定）
function invDrugMenu() {
  return invStockList.map(function (s) {
    return { id: 'inv_' + s.code, name: s.name, price: 0, unit: s.unit || 'T', category: '院内', _inv: s };
  });
}
