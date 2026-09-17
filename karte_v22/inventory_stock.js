// ===== 在庫管理アプリ連携モジュール (inventory_stock.js) 2026-07-03 =====
// 薬品在庫管理アプリ（GAS getStock）から在庫を取得し、院内薬タブに
// 在庫数＋横バーで表示する。残少（stock <= threshold）は短く赤（在庫アプリと同基準）。
// ★2026-09-17: 在庫アプリと同じ Supabase を直接見る。カルテの確定で在庫を減らし、取り消しで戻す。
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
async function loadInventoryStock(force) {
  if ((invStockLoaded && !force) || invStockLoading) return;
  invStockLoading = true;
  invStockError = null;
  try {
    // ★2026-09-17: 在庫アプリと同じ Supabase のビューを直接読む（GAS経由は廃止）。
    //   在庫を減らすかの判定は必ず stock_untracked を使う（画面側で category 文字列を判定しない）。
    if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
      throw new Error('Supabaseに接続していません');
    }
    const res = await supabaseClient
      .from('pharmacy_v_medicines')
      .select('code,name,unit,current_stock,threshold,stock_untracked,price,active')
      .eq('active', true)
      .order('code');
    if (res.error) throw new Error(res.error.message || '在庫の取得に失敗');
    invStockList = (res.data || []).filter(function (s) { return s && s.name; })
      .map(function (s) {
        return { code: s.code, name: s.name, unit: s.unit, currentStock: s.current_stock,
                 threshold: s.threshold, stockUntracked: !!s.stock_untracked, price: s.price };
      });
    invStockMap = {};
    invStockList.forEach(function (s) {
      invStockMap[invNorm(s.name)] = s;
      invStockMap['#' + s.code] = s;       // コードでも引けるようにする
    });
    invStockLoaded = true;
  } catch (e) {
    invStockError = e.message || String(e);
    console.error('在庫連携エラー:', e);
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

// 名称照合で拾えない商品名/規格の薬価 上書き表（枠）。必要時にここへ追加。
// キー = 院内薬名を NFKC・空白除去したもの（部分一致）。
const INHOUSE_PRICE_OVERRIDE = {
  'プリンペラン錠5mg': 10.8,
  'サワシリンカプセル250mg': 15.3,
  'アンヒバ坐剤100mg': 21.6,
  'アンヒバ坐剤200mg': 21.6,
  'ダイアップ6mg': 50.3
};
// 院内薬の薬価を解決: ①上書き表 → ②公式マスタ名称照合(getDrugPriceByName) → ③0。
function resolveInvPrice(name) {
  const nm = String(name || '').normalize('NFKC').replace(/[\s　]/g, '');
  for (const k in INHOUSE_PRICE_OVERRIDE) { if (nm.indexOf(k) !== -1) return INHOUSE_PRICE_OVERRIDE[k]; }
  try {
    if (typeof MasterLoader !== 'undefined' && MasterLoader.getDrugPriceByName) {
      const p = MasterLoader.getDrugPriceByName(name);
      if (p != null) return p;
    }
  } catch (e) { /* マスタ未ロード時は0 */ }
  return 0;
}

// 院内薬タブ用: 在庫をカルテのdrug形式で返す。薬価は公式マスタ名称照合＋上書き表で解決。
function invDrugMenu() {
  return invStockList.map(function (s) {
    return { id: 'inv_' + s.code, name: s.name, price: resolveInvPrice(s.name), unit: s.unit || 'T', category: '院内', _inv: s };
  });
}

// ===== v22（2026-09-17）: カルテの操作を在庫に反映する =====
// 決めごと（ユーザー確定 2026-09-16）
//   ・院内処方だけ減らす（院外処方箋は減らさない）
//   ・在庫を追わない薬（stock_untracked＝外用など）は減らさない … 判定はDB側のビューで行う
//   ・数量は「1回量 × 日数」
//   ・同じ受診で二度減らさない。取り消したら戻す。名寄せできなかった薬は必ず画面に出す。

/** この受診を表す印。クリニック・患者番号・診療日で一意にする（保存のUUIDに依存しない） */
function invVisitKey(p, dateStr) {
  var clinic = (typeof currentClinicId === 'function') ? currentClinicId() : 'nishiharu';
  var no = (p && (p.patientNo || p.id)) || '';
  var d = dateStr || (typeof selectedDate !== 'undefined' ? selectedDate : '');
  return clinic + '|' + no + '|' + d;
}

/** 処方から「在庫を動かす品目」を作る。コードが分かるものはコードで、無ければ名前で引く */
function invItemsFromKarte(k) {
  var items = [], unresolved = [];
  ((k && k.prescriptions) || []).forEach(function (rx) {
    var d = rx.drug || {};
    var qty = Math.round((Number(rx.qty) || 0) * (Number(rx.days) || Number(k.rxDays) || 0));
    if (qty <= 0) return;
    var code = null;
    if (typeof d.id === 'string' && d.id.indexOf('inv_') === 0) code = d.id.slice(4);
    if (!code) {
      var e = getInvEntry(d.name);
      if (e) code = e.code;
    }
    if (!code) { unresolved.push(d.name || '(名称なし)'); return; }
    items.push({ code: code, qty: qty, name: d.name || '' });
  });
  return { items: items, unresolved: unresolved };
}

/** カルテの確定で在庫を減らす。戻り値＝画面に出すための内訳 */
async function invApplyDispense(p, k) {
  if (!k || k.rxModeExternal) return null;          // 院外処方は在庫を動かさない
  var built = invItemsFromKarte(k);
  if (!built.items.length && !built.unresolved.length) return null;
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
    return { error: 'Supabaseに接続していないため在庫を更新できませんでした', unresolved: built.unresolved };
  }
  var operator = '';
  try { operator = (typeof currentUserEmail === 'function' && currentUserEmail()) || ''; } catch (e) { operator = ''; }
  var res = await supabaseClient.rpc('pharmacy_dispense_from_karte', {
    p_visit_id: invVisitKey(p),
    p_patient_no: (p && (p.patientNo || p.id)) || '',
    p_patient_name: (p && p.name) || '',
    p_operator: operator || 'karte',
    p_occurred_on: (typeof selectedDate !== 'undefined' && selectedDate) || null,
    p_items: built.items
  });
  if (res.error) return { error: res.error.message || '在庫の更新に失敗しました', unresolved: built.unresolved };
  var out = res.data || {};
  out.unresolved = built.unresolved;
  invStockLoaded = false;
  loadInventoryStock(true);          // 画面の在庫表示を更新
  return out;
}

/** カルテを取り消したときに在庫を戻す */
async function invCancelDispense(p, dateStr) {
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return null;
  var res = await supabaseClient.rpc('pharmacy_cancel_karte_dispense', {
    p_visit_id: invVisitKey(p, dateStr), p_operator: 'karte'
  });
  if (res.error) { console.warn('在庫の戻しに失敗', res.error); return null; }
  invStockLoaded = false;
  loadInventoryStock(true);
  return res.data || null;
}

/** 結果を画面に出す。減らせなかったものは必ず見せる（無言で飛ばさない） */
function invShowDispenseResult(r) {
  if (!r) return;
  var applied = (r.applied || []).length;
  if (r.error) { if (typeof showToast === 'function') showToast('在庫: ' + r.error); }
  else if (applied) {
    var head = (r.applied || []).map(function (a) { return a.name + ' −' + a.qty + (a.unit || ''); }).join('、');
    if (typeof showToast === 'function') showToast('在庫を減らしました: ' + head);
  }
  var warn = [];
  (r.untracked || []).forEach(function (u) { warn.push(u.name + '（在庫を追わない薬のため減らしていません）'); });
  (r.unknown || []).forEach(function (u) { warn.push((u.name || u.code) + '（在庫マスタに無いため減らしていません）'); });
  (r.unresolved || []).forEach(function (n) { warn.push(n + '（在庫の薬品と結び付かないため減らしていません）'); });
  (r.already || []).forEach(function (a) { warn.push(a.name + '（この受診では反映済み）'); });
  var box = document.getElementById('invDispenseNote');
  if (!box) return;
  if (!warn.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = '<b>在庫を動かさなかった薬</b><ul>' +
    warn.map(function (w) { return '<li>' + (typeof esc === 'function' ? esc(w) : w) + '</li>'; }).join('') + '</ul>';
}
