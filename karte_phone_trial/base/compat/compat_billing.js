// ===== 置き換え層：会計（工程4・2026-09-24） compat_billing.js =====
// 基準版の /billings/... を統合版の来院・カルテに読み書きする。
//   ・会計 1 件 ＝ 来院（visits）1 件。会計の ID は来院の ID（記録 ID ＝ 受付 ID ＝ 会計 ID）
//   ・会計の状態（金額・入金・返金・領収書分割・確定・取消・会計番号）は kartes.base_record.billing に置く（新しい表・列は作らない）
//       書くときは base_record を読み直し、billing のキーだけ差し替えて書き戻す（本文・処方・行為など他のキーは消さない）
//   ・明細は kartes.base_record.billings（記録の行為一覧）から組み立てる。提供元のサーバーがカルテ保存のたびに会計を作り直すのと同じく、
//     記録の版（base_record.version）が変わっていたら次に会計を開いたときに計算し直す。入金がある会計は作り直さない（提供元は保存自体を断る）
//   ・計算は提供元の billing_calculator.py を JS に写したもの（下の Calc）。負担額は10円単位の四捨五入、公費は負担割合と各種上限を適用
//   ・保険・公費は patients.receipt_extra の insurances / publicExpenses（camelCase）から、会計日に有効なものを使う
//       受付で選んだ保険・公費は統合版に保存されていないため、提供元の「受付で指定なし」と同じく主保険と優先順位1の公費を使う
//   ・自費マスター・月まとめ請求は統合版にまだ置き場が無いので院ごとに DB（karte_clinic_store）へ置く。DB を使う印の無い院は従来どおり端末に置く
(function (root) {
  // ================================================================
  // 計算（提供元 billing_calculator.py の写し。DB に触らない純粋な計算だけをここに置く）
  // ================================================================
  // Python の int(x)：小数は 0 方向に切り捨て。文字列は整数表記だけ受け付ける（"10.5" は None 扱い）
  function optInt(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
    const s = String(v).trim(); return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
  }
  const toInt = (v) => { const n = optInt(v); return n === null ? 0 : n; };
  // 小数を含む掛け算の Python Decimal 相当（桁を整数に上げて掛け、0 方向に切り捨て）
  function decimalMulTrunc(a, b) {
    const sa = String(Number(a) || 0), sb = String(Number(b) || 0);
    const da = (sa.split('.')[1] || '').length, db = (sb.split('.')[1] || '').length;
    if (/e/i.test(sa + sb) || da + db > 12) return Math.trunc(Number(a) * Number(b));
    const ia = Math.round(Number(a) * 10 ** da), ib = Math.round(Number(b) * 10 ** db);
    return Math.trunc((ia * ib) / 10 ** (da + db));
  }
  // 患者負担額：総額 × 負担割合(%) を 10円単位に丸める（Decimal.quantize(Decimal('1E1'))）
  //   round＝ROUND_HALF_UP（5円は切り上げ・負は 0 から遠い方へ）／floor＝ROUND_DOWN（0 方向）／ceil＝ROUND_UP（0 から遠い方）
  function calculatePatientBurden(totalAmount, burdenRatio, roundingType) {
    const n = toInt(totalAmount) * toInt(burdenRatio);      // 円 × 100
    const sign = n < 0 ? -1 : 1, a = Math.abs(n);
    const q = Math.floor(a / 1000), r = a - q * 1000;        // 10円の個数と余り（円×100）
    let tens;
    if (roundingType === 'floor') tens = q;
    else if (roundingType === 'ceil') tens = r > 0 ? q + 1 : q;
    else tens = r >= 500 ? q + 1 : q;
    return sign * tens * 10;
  }
  const calculateScoreAmount = (score) => score * 10;
  const ROUNDING_RULES = { 10: 'round', 20: 'round', 30: 'round' };
  const AICHI_FULL = new Set(['aichi_child', 'aichi_disabled', 'aichi_single_parent', 'aichi_mental_all']);
  const ZERO_USAGE = () => ({ used_amount: 0, billing_count: 0, billing_days: 0 });

  // 公費の負担割合と各種上限を患者負担に反映する（apply_public_expense）
  //   usage は { daily, monthly }（同じ公費で同日・同月に既にある会計の集計。今の会計は除く）
  function applyPublicExpense(calc, pe, usage, insuranceBurdenRatio) {
    if (!pe) return;
    const claimTarget = String(pe.claim_target || 'medical');
    if (!['medical', 'same_as_medical', 'all'].includes(claimTarget)) return;
    let originalBurden = calc.patient_burden;
    const burdenRatio = optInt(pe.burden_ratio);
    let newBurden = burdenRatio === null ? originalBurden : calculatePatientBurden(calc.total_amount, burdenRatio);
    newBurden = Math.min(calc.patient_burden, newBurden);

    const peId = pe.id;
    let daily = ZERO_USAGE(), monthly = ZERO_USAGE();
    if (peId) { daily = (usage && usage.daily) || ZERO_USAGE(); monthly = (usage && usage.monthly) || ZERO_USAGE(); }

    const countLimitPerDay = optInt(pe.count_limit_per_day);
    if (countLimitPerDay !== null && daily.billing_count >= countLimitPerDay) return;
    const countLimitPerMonth = optInt(pe.count_limit_per_month);
    if (countLimitPerMonth !== null && monthly.billing_count >= countLimitPerMonth) return;
    const dayLimitPerMonth = optInt(pe.day_limit_per_month);
    if (dayLimitPerMonth !== null && monthly.billing_days >= dayLimitPerMonth && daily.billing_count === 0) return;

    const perVisitLimit = optInt(pe.per_visit_limit);
    if (perVisitLimit !== null) newBurden = Math.min(newBurden, perVisitLimit);
    const dailyLimit = optInt(pe.daily_limit);
    if (dailyLimit !== null && peId) newBurden = Math.min(newBurden, Math.max(dailyLimit - daily.used_amount, 0));
    const monthlyLimit = optInt(pe.monthly_limit);
    if (monthlyLimit !== null && peId) newBurden = Math.min(newBurden, Math.max(monthlyLimit - monthly.used_amount, 0));

    // 愛知県の福祉医療（全額助成）は、窓口の丸めでなく「総点数 × 請求割合」を法定の負担として公費額を出す（提供元と同じ）
    if (AICHI_FULL.has(pe.expense_type) && burdenRatio === 0 && newBurden === 0 && [10, 20, 30].includes(insuranceBurdenRatio)) {
      originalBurden = Math.floor(calc.total_amount * insuranceBurdenRatio / 100);
      calc.insurance_amount = calc.total_amount - originalBurden;
    }
    calc.public_expense_amount = Math.max(originalBurden - newBurden, 0);
    calc.patient_burden = newBurden;
  }

  // 明細から会計を計算する（calculate_billing）。insurance / pe は解決済みの保険・公費（無ければ null）
  function calculateBilling(items, insurance, pe, usage) {
    const calc = { total_score: 0, total_amount: 0, insurance_amount: 0, public_expense_amount: 0, patient_burden: 0, patient_burden_adjusted: 0,
      self_pay_amount: 0, final_amount: 0, items: [] };
    for (const item of items || []) {
      const itemType = item.item_type || 'action';
      const quantity = item.quantity === undefined || item.quantity === null ? 1 : Number(item.quantity);
      if (itemType === 'self_pay') {
        let price = item.price; if (price === undefined || price === null) price = item.unit_price; if (price === undefined || price === null) price = item.amount || 0;
        const amount = decimalMulTrunc(price || 0, quantity);
        calc.self_pay_amount += amount;
        calc.items.push({ item_type: 'self_pay', code: item.code ?? null, name: item.name || '', unit_score: 0, quantity, score: 0, amount });
      } else {
        const unitScore = toInt(item.unit_score || item.points || 0);
        const score = decimalMulTrunc(unitScore, quantity);
        calc.total_score += score;
        calc.items.push({ item_type: itemType, code: item.code ?? null, name: item.name || '', unit_score: unitScore, quantity, score, amount: calculateScoreAmount(score),
          category_code: item.category_code ?? null, category_name: item.category_name ?? null });
      }
    }
    // 保険の負担割合。保険が無ければ 10割（自費）。提供元は割合未登録の保険で止まるため、ここでは 3割として扱う
    const burdenRatio = insurance ? (insurance.burden_ratio === null || insurance.burden_ratio === undefined ? 30 : toInt(insurance.burden_ratio)) : 100;
    calc.total_amount = calculateScoreAmount(calc.total_score);
    if (burdenRatio < 100) {
      calc.patient_burden = calculatePatientBurden(calc.total_amount, burdenRatio, ROUNDING_RULES[burdenRatio] || 'round');
      calc.insurance_amount = calc.total_amount - calc.patient_burden;
    } else {
      calc.patient_burden = calc.total_amount;
    }
    applyPublicExpense(calc, pe, usage, insurance ? burdenRatio : null);
    calc.patient_burden_adjusted = calc.patient_burden;
    calc.final_amount = calc.patient_burden_adjusted + calc.self_pay_amount;
    return calc;
  }

  // ---- 記録の行為（基準版の billings の1行）→ 計算用の明細・会計明細の表示行（提供元 records.py の写し） ----
  const isSelfPay = (b) => !!(b.is_self_pay || b.item_type === 'self_pay' || String(b.category || '') === '自費' || String(b.billing_code || '').startsWith('SELF_'));
  const itemTypeOf = (b) => isSelfPay(b) ? 'self_pay' : (b.item_type || 'action');
  function actionCodeOf(b) { const code = String(b.billing_code || '').trim(); if (!code || isSelfPay(b) || b.item_type === 'drug') return null; return code.length <= 9 ? code : null; }
  function drugCodeOf(b) { if (b.item_type !== 'drug') return null; const code = String(b.billing_code || '').trim(); return code && code.length <= 12 ? code : null; }
  function recordItemToCalc(b) {
    const t = itemTypeOf(b);
    return { item_type: t, code: (t === 'drug' ? drugCodeOf(b) : actionCodeOf(b)) || b.billing_code || null, name: b.billing_name,
      unit_score: b.do_not_bill ? 0 : toInt(b.points), quantity: toInt(b.quantity) || 1, price: b.do_not_bill ? 0 : (Number(b.unit_price) || Number(b.amount) || 0), category_name: b.category ?? null };
  }
  function recordItemToDisplay(b, i, billingId) {
    const t = itemTypeOf(b), qty = toInt(b.quantity) || 1, selfPay = t === 'self_pay';
    const score = b.do_not_bill || selfPay ? 0 : toInt(b.points) * qty;
    const amount = b.do_not_bill ? 0 : selfPay ? Math.trunc(Number(b.unit_price) || Number(b.amount) || 0) * qty : score * 10;
    return { id: billingId + '-bi' + i, item_type: t, code: actionCodeOf(b) || drugCodeOf(b) || null,
      name: ['action', 'drug', 'self_pay'].includes(t) ? b.billing_name : null, quantity: qty, unit_score: toInt(b.points), score, amount, category: b.category ?? null };
  }
  function sortOrderOf(b, fallback) {
    for (const k of ['procedure_order', 'sort_order']) { const n = optInt(b[k]); if (n !== null && n > 0) return n; }
    return fallback;
  }
  // 一括再計算は、保存済みの会計明細から計算し直す（提供元の fetch_billing_items_for_recalculation。「算定しない」行も単位点数のまま入る点も同じ）
  function recalcItemsFromDisplay(items) {
    return (items || []).map((r) => r.item_type === 'self_pay'
      ? { item_type: 'self_pay', code: 'SELF', name: r.name || '', price: toInt(r.amount), quantity: 1 }
      : { item_type: r.item_type || 'action', code: r.code, name: r.name || '', unit_score: toInt(r.unit_score), quantity: Number(r.quantity || 1) });
  }
  // 自費の消費税額（内税）：価格 × 税率 ÷ (100 + 税率) を切り捨て
  function selfPayTaxAmount(price, taxRate) {
    if (taxRate === null || taxRate === undefined || Number(taxRate) <= 0 || Number(price) <= 0) return null;
    const r = Math.round(Number(taxRate) * 100);
    return Math.trunc((Number(price) * r) / (10000 + r));
  }
  const paymentStatusFor = (finalAmount, paidAmount) => paidAmount <= 0 ? 'unpaid' : paidAmount >= finalAmount ? 'paid' : 'partial';

  const Calc = { optInt, calculatePatientBurden, applyPublicExpense, calculateBilling, recordItemToCalc, recordItemToDisplay, recalcItemsFromDisplay, selfPayTaxAmount, paymentStatusFor };
  root.__compatBillingCalc = Calc;   // 計算の単体確認（Node）からも使えるように出しておく

  // ================================================================
  // 置き換え（ここから先はブラウザの置き換え層の上でだけ動く）
  // ================================================================
  const C = root.__compat; if (!C) return;
  const { on, err, ready, clinicId, realFetch } = C;
  const nowIso = () => new Date().toISOString();
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = () => ymd(new Date());
  const uid = () => crypto.randomUUID();
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const METHODS = ['cash', 'card', 'qr', 'ic', 'transfer', 'other'];

  // ---- 保険・公費（patients.receipt_extra → 提供元の計算が読む形） ----
  let masters = null;
  async function peTypes() {
    if (!masters) { try { masters = (await C.masterJson('insurance_masters')) || {}; } catch (e) { masters = {}; } }
    return masters.public_expense_types || [];
  }
  const d10 = (v) => v ? String(v).slice(0, 10) : '';
  const validOn = (x, d) => x.isActive !== false && (!x.validFrom || d10(x.validFrom) <= d) && (!x.validUntil || d10(x.validUntil) >= d);
  // 配列がまだ無い患者は、統合版の従来の項目から1件ぶんを組み立てる（compat_insurance.js と同じ規則・同じ ID）
  function insurancesOf(p) {
    const list = (p && p.receipt_extra && Array.isArray(p.receipt_extra.insurances)) ? p.receipt_extra.insurances : [];
    if (list.length || !p || !(p.insurer_number || p.ins_number)) return list;
    const label = String(p.insurance_type || ''), n = String(p.insurer_number || '').replace(/\D/g, ''), ratio = Number(p.copay_rate);
    const type = /後期/.test(label) ? 'elderly' : /国保/.test(label) ? 'national' : /自費/.test(label) ? 'self_pay' : n.length === 6 ? 'national' : n.startsWith('39') ? 'elderly' : 'social';
    return [{ id: p.id + '-legacy-ins', insuranceType: type, burdenRatio: isNaN(ratio) || !p.copay_rate ? 30 : Math.round(ratio * 100), isPrimary: true, isActive: true }];
  }
  function publicExpensesOf(p) {
    const list = (p && p.receipt_extra && Array.isArray(p.receipt_extra.publicExpenses)) ? p.receipt_extra.publicExpenses : [];
    if (list.length || !p || !(p.kouhi_number || p.recipient_number)) return list;
    const payer = String(p.kouhi_number || '').replace(/\D/g, '');
    return [{ id: p.id + '-legacy-pe', type: '', typeCode: payer.slice(0, 2), payerNumber: payer, claimTarget: 'medical', priority: 1, isActive: true }];
  }
  const insRow = (i) => ({ id: i.id, insurance_type: i.insuranceType || null, burden_ratio: i.burdenRatio === '' || i.burdenRatio === undefined ? null : i.burdenRatio, valid_from: i.validFrom || null });
  // 主保険（get_patient_insurance）：有効・主・会計日に有効、開始日の新しい順
  function defaultInsurance(p, d) {
    const hit = insurancesOf(p).filter((i) => i.isPrimary !== false && validOn(i, d))
      .sort((a, b) => (b.validFrom ? 1 : 0) - (a.validFrom ? 1 : 0) || (d10(b.validFrom) > d10(a.validFrom) ? 1 : d10(b.validFrom) < d10(a.validFrom) ? -1 : 0))[0];
    return hit ? insRow(hit) : null;
  }
  function insuranceById(p, d, id) { if (!id) return null; const hit = insurancesOf(p).find((i) => String(i.id) === String(id) && validOn(i, d)); return hit ? insRow(hit) : null; }
  // 公費：患者の値が無い項目は公費の種類ごとの既定値（提供元の COALESCE(pe.*, 種類マスターの既定値)。市町村別の規則は統合版に無いので使わない）
  async function peRow(x) {
    const t = (await peTypes()).find((m) => m.type_code === x.type) || {};
    const pick = (k, dk) => (x[k] !== undefined && x[k] !== null && x[k] !== '') ? x[k] : (t[dk] ?? null);
    return { id: x.id, expense_type: x.type || null, recipient_number: x.recipientNumber || null, payer_number: x.payerNumber || null, expense_type_code: x.typeCode || null,
      burden_ratio: pick('burdenRatio', 'default_burden_ratio'), monthly_limit: pick('monthlyLimit', 'default_monthly_limit'), daily_limit: pick('dailyLimit', 'default_daily_limit'),
      per_visit_limit: pick('perVisitLimit', 'default_per_visit_limit'), count_limit_per_day: pick('countLimitPerDay', 'default_count_limit_per_day'),
      count_limit_per_month: pick('countLimitPerMonth', 'default_count_limit_per_month'), day_limit_per_month: pick('dayLimitPerMonth', 'default_day_limit_per_month'),
      claim_target: x.claimTarget || t.claim_target || 'medical', prescription_claim_target: x.prescriptionClaimTarget || t.prescription_claim_target || 'same_as_medical', expense_type_name: t.name || null };
  }
  // 優先順位1の公費（get_patient_public_expense）：有効・会計日に有効、優先順位の小さい順（未設定は最後）
  async function defaultPublicExpense(p, d) {
    const pr = (x) => { const n = optInt(x.priority); return n === null ? Infinity : n; };
    const hit = publicExpensesOf(p).filter((x) => validOn(x, d)).sort((a, b) => pr(a) - pr(b))[0];
    return hit ? peRow(hit) : null;
  }
  async function publicExpenseById(p, d, id) { if (!id) return null; const hit = publicExpensesOf(p).find((x) => String(x.id) === String(id) && validOn(x, d)); return hit ? peRow(hit) : null; }

  // ---- 読み込み ----
  const PCOLS = 'id,patient_no,name,receipt_extra,insurer_number,ins_number,copay_rate,insurance_type,kouhi_number,recipient_number';
  const VSEL = 'id,patient_id,visit_date,status,created_at,clinic_id,kartes(id,base_record,created_at),patients(' + PCOLS + ')';
  async function visitById(id) {
    const c = await ready(); const { data, error } = await c.from('visits').select(VSEL).eq('id', id).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message); return data;
  }
  async function patientById(pid) {
    const c = await ready(); const { data, error } = await c.from('patients').select(PCOLS).eq('id', pid).eq('clinic_id', clinicId()).maybeSingle();
    if (error) throw new Error(error.message); return data;
  }
  const baseOf = (v) => { const k = one(v && v.kartes); return (k && k.base_record) || null; };
  const versionOf = (b) => b.version || 1;
  const isActive = (st) => st && st.is_active !== false && st.status !== 'cancelled';
  // 会計が記録の今の版に合っているか（入金がある会計は作り直さないので、そのまま使う）
  const isCurrent = (st, b) => st && (Number(st.paid_amount) > 0 || st.record_version === versionOf(b));

  // 同じ公費の同日・同月の使用状況（get_public_expense_period_usage）。有効な会計の患者負担（公費適用後）を足し上げる
  //   ほかの来院の会計がまだ今の版で作られていなければ、その場で計算した額を使う（上限の集計はしない）
  async function usageFor(p, peId, d, excludeVid) {
    const c = await ready(); const ym = d.slice(0, 7); const [y, m] = ym.split('-').map(Number);
    const end = ymd(new Date(y, m, 0));
    const { data, error } = await c.from('visits').select('id,visit_date,kartes(base_record)').eq('clinic_id', clinicId()).eq('patient_id', p.id).gte('visit_date', ym + '-01').lte('visit_date', end);
    if (error) throw new Error(error.message);
    const rows = [];
    for (const v of data || []) {
      if (v.id === excludeVid) continue;
      const b = baseOf(v); if (!b || b.is_deleted) continue;
      let st = b.billing;
      if (!isCurrent(st, b)) {
        if (st && !isActive(st)) continue;
        if (!(b.billings || []).length) { if (!st) continue; }
        const ins = defaultInsurance(p, v.visit_date), pe = await defaultPublicExpense(p, v.visit_date);
        const calc = Calc.calculateBilling((b.billings || []).map(recordItemToCalc), ins, pe, null);
        st = Object.assign({}, st || {}, { public_expense_id: pe ? pe.id : null, patient_burden_adjusted: calc.patient_burden_adjusted, is_active: true, status: (st && st.status) || 'draft' });
      }
      if (!isActive(st) || String(st.public_expense_id || '') !== String(peId)) continue;
      rows.push({ date: v.visit_date, amt: toInt(st.patient_burden_adjusted) });
    }
    const agg = (list) => ({ used_amount: list.reduce((s, r) => s + r.amt, 0), billing_count: list.length, billing_days: new Set(list.map((r) => r.date)).size });
    return { daily: agg(rows.filter((r) => r.date === d)), monthly: agg(rows) };
  }
  // 保険・公費を決めて計算する。ids を渡すとその保険・公費（提供元の *_by_id）、無ければ既定
  async function compute(p, d, items, excludeVid, ids) {
    const ins = ids && ids.insurance_id ? insuranceById(p, d, ids.insurance_id) : defaultInsurance(p, d);
    const pe = ids && ids.public_expense_id ? await publicExpenseById(p, d, ids.public_expense_id) : await defaultPublicExpense(p, d);
    const usage = pe && pe.id ? await usageFor(p, pe.id, d, excludeVid) : null;
    return { ins, pe, calc: Calc.calculateBilling(items, ins, pe, usage) };
  }

  // ---- 会計番号（YYYYMMDD-連番。その日の会計の数 + 1） ----
  async function nextBillingNo(d) {
    const c = await ready(); const { data } = await c.from('visits').select('id,kartes(base_record)').eq('clinic_id', clinicId()).eq('visit_date', d);
    const n = (data || []).filter((v) => { const b = baseOf(v); return b && b.billing; }).length;
    return d.replace(/-/g, '') + '-' + String(n + 1).padStart(4, '0');
  }
  // ---- 書き込み：base_record を読み直し、billing だけ差し替える ----
  async function saveState(vid, st) {
    const c = await ready();
    const { data: k, error } = await c.from('kartes').select('id,base_record').eq('visit_id', vid).maybeSingle();
    if (error) throw new Error(error.message);
    if (!k || !k.base_record) throw new Error('基準版の画面で保存したカルテが無いため会計を保存できません');
    const next = Object.assign({}, k.base_record, { billing: st });
    const { error: e2 } = await c.from('kartes').update({ base_record: next }).eq('id', k.id);
    if (e2) throw new Error('会計の保存に失敗しました: ' + e2.message);
    return st;
  }

  // 記録から会計を作る・作り直す（提供元の replace_record_billings）。write=false なら計算だけ（保存しない）
  async function ensureBilling(v, write) {
    const b = baseOf(v); if (!b || b.is_deleted) return null;
    let st = b.billing || null;
    if (isCurrent(st, b)) return st;
    const recordItems = (b.billings || []).map((x, i) => ({ x, i, o: sortOrderOf(x, i) })).sort((a, z) => a.o - z.o || a.i - z.i).map((r) => r.x);
    if (!recordItems.length && !(st && isActive(st))) {
      // 行為の無い記録には提供元も会計を作らない。画面が会計を開けるよう、0円の会計を返す（保存しない）
      return fresh(v, { total_score: 0, total_amount: 0, insurance_amount: 0, public_expense_amount: 0, patient_burden: 0, patient_burden_adjusted: 0, self_pay_amount: 0, final_amount: 0 }, null, null, [], versionOf(b), 'transient');
    }
    const p = v.patients || {};
    // 受付・カルテで選んだ保険・公費（記録に残したもの）があればそれで計算する。無ければ既定（主保険・優先順位1の公費）
    const chosen = (b.insurance_id || b.public_expense_id || b.public_expense_1_id) ? { insurance_id: b.insurance_id || null, public_expense_id: b.public_expense_id || b.public_expense_1_id || null } : null;
    const { ins, pe, calc } = await compute(p, v.visit_date, recordItems.map(recordItemToCalc), v.id, chosen);
    const items = recordItems.map((x, i) => recordItemToDisplay(x, i, v.id));
    if (st && isActive(st)) {
      st = Object.assign({}, st, headerOf(calc, ins, pe), { items, items_override: null, record_version: versionOf(b), unpaid_amount: calc.final_amount, payment_status: 'unpaid', updated_at: nowIso() });
    } else {
      st = fresh(v, calc, ins, pe, items, versionOf(b), write ? await nextBillingNo(v.visit_date) : null);
    }
    return write ? saveState(v.id, st) : st;
  }
  function headerOf(calc, ins, pe) {
    return { insurance_id: ins ? ins.id : null, insurance_type: ins ? ins.insurance_type : null, burden_ratio: ins ? optInt(ins.burden_ratio) : null,
      public_expense_id: pe ? pe.id : null, public_expense_type: pe ? pe.expense_type : null,
      total_score: calc.total_score, total_amount: calc.total_amount, insurance_amount: calc.insurance_amount, public_expense_amount: calc.public_expense_amount,
      patient_burden: calc.patient_burden, patient_burden_adjusted: calc.patient_burden_adjusted, self_pay_amount: calc.self_pay_amount, final_amount: calc.final_amount };
  }
  function fresh(v, calc, ins, pe, items, version, billingNo) {
    return Object.assign({ billing_no: billingNo === 'transient' ? null : billingNo, status: 'draft', is_active: true, created_at: nowIso(), updated_at: nowIso(), confirmed_at: null,
      paid_amount: 0, unpaid_amount: calc.final_amount, payment_status: 'unpaid', payments: [], refunds: [], receipt_splits: [], items, record_version: version },
    headerOf(calc, ins, pe), billingNo === 'transient' ? { transient: true } : {});
  }
  // 会計 1 件を取り出す（作り直しが要れば作り直して保存する）
  async function loadBilling(id, opts) {
    const v = await visitById(id); if (!v) return {};
    const st = await ensureBilling(v, !(opts && opts.readOnly));
    return { v, st };
  }
  function response(v, st, detail) {
    const r = { id: v.id, patient_id: v.patient_id, reception_id: v.id, record_id: v.id, billing_date: v.visit_date, billing_no: st.billing_no || null,
      insurance_type: st.insurance_type || null, burden_ratio: st.burden_ratio ?? null, total_score: toInt(st.total_score), total_amount: toInt(st.total_amount),
      insurance_amount: toInt(st.insurance_amount), public_expense_amount: toInt(st.public_expense_amount), patient_burden: toInt(st.patient_burden),
      patient_burden_adjusted: toInt(st.patient_burden_adjusted), self_pay_amount: toInt(st.self_pay_amount), final_amount: toInt(st.final_amount),
      paid_amount: toInt(st.paid_amount), unpaid_amount: toInt(st.unpaid_amount), payment_status: st.payment_status || 'unpaid', status: st.status || 'draft', created_at: st.created_at || v.created_at };
    if (detail) {
      r.items = (st.items || []).slice();
      r.payments = (st.payments || []).slice().sort((a, b) => String(b.payment_datetime).localeCompare(String(a.payment_datetime)))
        .map((x) => ({ id: x.id, payment_date: x.payment_date, payment_amount: x.payment_amount, payment_method: x.payment_method, received_amount: x.received_amount, change_amount: x.change_amount, receipt_issued: !!x.receipt_issued }));
    }
    return r;
  }
  const calcResponse = (calc) => ({ total_score: calc.total_score, total_amount: calc.total_amount, insurance_amount: calc.insurance_amount, public_expense_amount: calc.public_expense_amount,
    patient_burden: calc.patient_burden, self_pay_amount: calc.self_pay_amount, final_amount: calc.final_amount,
    items: calc.items.map((x) => ({ item_type: x.item_type, code: x.code, name: x.name, unit_score: x.unit_score, quantity: Number(x.quantity), score: x.score, amount: x.amount })) });
  // 明細（提供元の BillingItemCreate の形）の検査
  function checkItems(items) {
    if (!Array.isArray(items)) return '明細（items）がありません';
    for (const it of items) { if (!['action', 'drug', 'material', 'self_pay'].includes(it.item_type)) return '明細の種類（item_type）が正しくありません'; if (typeof it.name !== 'string') return '明細の名前（name）がありません'; }
    return null;
  }
  const bodyItems = (items) => items.map((it) => ({ item_type: it.item_type, code: it.code ?? null, name: it.name, unit_score: it.unit_score ?? 0, quantity: it.quantity ?? 1.0, price: it.price ?? 0,
    category_code: it.category_code ?? null, category_name: it.category_name ?? null }));

  // ================================================================
  // 計算・作成
  // ================================================================
  on('POST', /^\/billings\/calculate$/, async (m, q, body) => {
    const bad = checkItems(body.items); if (bad) return err(422, bad);
    const p = await patientById(body.patient_id); if (!p) return err(404, '患者が見つかりません');
    const { calc } = await compute(p, d10(body.billing_date) || today(), bodyItems(body.items), null, body);
    return calcResponse(calc);
  });
  // 明細を指定して会計を作る。統合版では会計＝来院なので、指定の記録（来院）の会計を指定の明細で作り直す
  on('POST', /^\/billings$/, async (m, q, body) => {
    const bad = checkItems(body.items); if (bad) return err(422, bad);
    const c = await ready(); let vid = body.record_id || body.reception_id;
    if (!vid) { const { data } = await c.from('visits').select('id').eq('clinic_id', clinicId()).eq('patient_id', body.patient_id).eq('visit_date', d10(body.billing_date)).maybeSingle(); vid = data && data.id; }
    const v = vid ? await visitById(vid) : null; const b = baseOf(v);
    if (!v || !b) return err(404, '会計を付ける記録が見つかりません（基準版の画面で保存したカルテが必要です）');
    const old = b.billing;
    if (old && isActive(old) && Number(old.paid_amount) > 0) return err(400, '入金済み会計があるため算定を変更できません');
    const items = bodyItems(body.items);
    const { ins, pe, calc } = await compute(v.patients || {}, v.visit_date, items, v.id, body);
    const display = calc.items.map((x, i) => ({ id: v.id + '-bi' + i, item_type: x.item_type, code: x.code, name: x.name, quantity: Number(x.quantity), unit_score: x.unit_score, score: x.score, amount: x.amount, category: x.category_name || null }));
    const st = fresh(v, calc, ins, pe, display, versionOf(b), await nextBillingNo(v.visit_date));
    st.items_override = items;
    await saveState(v.id, st);
    return response(v, st, true);
  });

  // ================================================================
  // 一覧・取得・確定・取消
  // ================================================================
  // 会計のある来院を期間で集める（読むだけ。作り直しが要る会計はその場で計算した値を見せる）
  async function collect(filter) {
    const c = await ready();
    let r = c.from('visits').select(VSEL.replace('kartes(', 'kartes!inner(')).eq('clinic_id', clinicId()).order('visit_date', { ascending: false }).limit(filter.max || 500);
    if (filter.patient_id) r = r.eq('patient_id', filter.patient_id);
    if (filter.date_from) r = r.gte('visit_date', filter.date_from);
    if (filter.date_to) r = r.lte('visit_date', filter.date_to);
    const { data, error } = await r; if (error) throw new Error(error.message);
    const out = [];
    for (const v of data || []) {
      const st = await ensureBilling(v, false);
      if (st && !st.transient && isActive(st)) out.push({ v, st });
    }
    return out;
  }
  on('GET', /^\/billings$/, async (m, q) => {
    const lim = Math.min(Number(q.get('limit') || 50), 200), off = Number(q.get('offset') || 0);
    let rows = await collect({ patient_id: q.get('patient_id'), date_from: q.get('date_from'), date_to: q.get('date_to') });
    if (q.get('payment_status')) rows = rows.filter((x) => x.st.payment_status === q.get('payment_status'));
    if (q.get('status')) rows = rows.filter((x) => x.st.status === q.get('status'));
    rows.sort((a, b) => (b.v.visit_date > a.v.visit_date ? 1 : b.v.visit_date < a.v.visit_date ? -1 : String(b.st.created_at).localeCompare(String(a.st.created_at))));
    return rows.slice(off, off + lim).map((x) => response(x.v, x.st, false));
  });
  on('GET', /^\/billings\/([0-9a-f-]{36})$/, async (m) => {
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || !isActive(st)) return err(404, '会計が見つかりません');
    return response(v, st, true);
  });
  // 確定：会計を確定し、来院（受付）も会計済みにする
  on('PATCH', /^\/billings\/([0-9a-f-]{36})\/confirm$/, async (m) => {
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || st.transient || !isActive(st) || st.status !== 'draft') return err(404, '会計が見つからないか、既に確定済みです');
    const fin = toInt(st.final_amount), paid = toInt(st.paid_amount);
    Object.assign(st, { status: 'confirmed', payment_status: fin <= paid ? 'paid' : st.payment_status, unpaid_amount: Math.max(fin - paid, 0), confirmed_at: nowIso(), updated_at: nowIso() });
    await saveState(v.id, st);
    const c = await ready(); const { error } = await c.from('visits').update({ status: 'done' }).eq('id', v.id).eq('clinic_id', clinicId());
    return { message: '確定しました', billing_id: v.id, reception_id: error ? null : v.id, reception_status: error ? null : 'payment_done' };
  });
  // 取消：入金があれば取り消せない。印を付けるだけ（記録を保存し直すと新しい会計になる）
  on('DELETE', /^\/billings\/([0-9a-f-]{36})$/, async (m) => {
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || st.transient) return err(404, '会計が見つかりません');
    if (toInt(st.paid_amount) > 0) return err(400, '入金済みのため取消できません');
    if (isActive(st)) { Object.assign(st, { status: 'cancelled', is_active: false, updated_at: nowIso() }); await saveState(v.id, st); }
    return { message: '取消しました', billing_id: v.id };
  });

  // ================================================================
  // 入金・返金・領収書分割
  // ================================================================
  on('POST', /^\/billings\/([0-9a-f-]{36})\/payments$/, async (m, q, body) => {
    const amount = optInt(body.payment_amount);
    if (amount === null || amount <= 0) return err(422, '入金額は1円以上で入力してください');
    if (!METHODS.includes(body.payment_method)) return err(422, '支払方法が正しくありません');
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || st.transient) return err(404, '会計が見つかりません');
    const unpaid = toInt(st.unpaid_amount), fin = toInt(st.final_amount);
    if (unpaid <= 0) return err(400, 'この会計は既に入金済みです');
    if (amount > unpaid) return err(400, '入金額が未収金額を超えています');
    const received = body.received_amount === null || body.received_amount === undefined ? null : toInt(body.received_amount);
    const change = received && received > amount ? received - amount : 0;
    const pay = { id: uid(), payment_date: today(), payment_datetime: nowIso(), payment_amount: amount, payment_method: body.payment_method, payment_detail: body.payment_detail || null,
      received_amount: received, change_amount: change, receipt_no: null, receipt_issued: false };
    const newUnpaid = unpaid - amount;
    Object.assign(st, { payments: (st.payments || []).concat([pay]), paid_amount: toInt(st.paid_amount) + amount, unpaid_amount: newUnpaid,
      payment_status: newUnpaid <= 0 ? 'paid' : newUnpaid < fin ? 'partial' : 'unpaid', updated_at: nowIso() });
    await saveState(v.id, st);
    return { payment_id: pay.id, change_amount: change, billing: response(v, st, true), message: '入金を登録しました' };
  });
  on('GET', /^\/billings\/([0-9a-f-]{36})\/payments$/, async (m) => {
    const { st } = await loadBilling(m[1], { readOnly: true }); if (!st) return [];
    return (st.payments || []).slice().sort((a, b) => String(b.payment_datetime).localeCompare(String(a.payment_datetime)))
      .map((x) => ({ id: x.id, payment_date: x.payment_date, payment_datetime: x.payment_datetime, payment_amount: x.payment_amount, payment_method: x.payment_method,
        payment_detail: x.payment_detail, received_amount: x.received_amount, change_amount: x.change_amount, receipt_no: x.receipt_no || null, receipt_issued: !!x.receipt_issued }));
  });
  // 返金：入金済額を戻し、未収額・入金状態を付け直す
  on('POST', /^\/billings\/([0-9a-f-]{36})\/refunds$/, async (m, q, body) => {
    const amount = optInt(body.refund_amount);
    if (amount === null || amount <= 0) return err(422, '返金額は1円以上で入力してください');
    const method = body.refund_method || 'cash'; if (!METHODS.includes(method)) return err(422, '返金方法が正しくありません');
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || st.transient || !isActive(st)) return err(404, '会計が見つかりません');
    const fin = toInt(st.final_amount), paid = toInt(st.paid_amount);
    if (amount > paid) return err(400, '返金額が入金済額を超えています');
    const rf = { id: uid(), payment_id: body.payment_id || null, refund_date: today(), refund_datetime: nowIso(), refund_amount: amount, refund_method: method, reason: body.reason || null };
    const newPaid = Math.max(paid - amount, 0);
    Object.assign(st, { refunds: (st.refunds || []).concat([rf]), paid_amount: newPaid, unpaid_amount: Math.max(fin - newPaid, 0), payment_status: paymentStatusFor(fin, newPaid), updated_at: nowIso() });
    await saveState(v.id, st);
    return Object.assign({ billing_id: v.id }, rf, { billing: response(v, st, true) });
  });
  on('GET', /^\/billings\/([0-9a-f-]{36})\/refunds$/, async (m) => {
    const { st } = await loadBilling(m[1], { readOnly: true }); if (!st) return [];
    return (st.refunds || []).slice().sort((a, b) => String(b.refund_datetime).localeCompare(String(a.refund_datetime)));
  });
  // 領収書の分割：金額の合計が請求額と一致すること。前の分割は置き換える
  on('POST', /^\/billings\/([0-9a-f-]{36})\/receipt-splits$/, async (m, q, body) => {
    const amounts = Array.isArray(body.amounts) ? body.amounts.map(toInt) : [];
    if (amounts.length < 2) return err(422, '分割金額は2つ以上指定してください');
    const type = body.receipt_type || 'receipt'; if (!['receipt', 'detail', 'both'].includes(type)) return err(422, '領収書の種類が正しくありません');
    if (amounts.some((a) => a <= 0)) return err(400, '分割金額は1円以上で入力してください');
    const { v, st } = await loadBilling(m[1]);
    if (!v || !st || st.transient || !isActive(st)) return err(404, '会計が見つかりません');
    if (amounts.reduce((s, a) => s + a, 0) !== toInt(st.final_amount)) return err(400, '分割金額の合計が請求額と一致していません');
    const at = nowIso();
    st.receipt_splits = amounts.map((a, i) => ({ id: uid(), split_no: i + 1, receipt_type: type, amount: a, memo: body.memo || null, receipt_id: null, created_at: at }));
    st.updated_at = at; await saveState(v.id, st);
    return { billing_id: v.id, splits: st.receipt_splits.map(({ receipt_id, ...x }) => x) };
  });
  on('GET', /^\/billings\/([0-9a-f-]{36})\/receipt-splits$/, async (m) => {
    const { st } = await loadBilling(m[1], { readOnly: true }); if (!st) return [];
    return (st.receipt_splits || []).slice().sort((a, b) => a.split_no - b.split_no);
  });

  // ================================================================
  // 未収金・月まとめ請求・一括再計算・集計
  // ================================================================
  // 未収金一覧：提供元は未収金台帳の表から読むが、台帳を作る処理が無い。ここでは会計から組み立てる（仮置き）
  //   active＝確定済みで入金なし・未収あり／partial＝一部入金で未収あり／collected＝入金ありで未収なし
  on('GET', /^\/billings\/unpaid\/list$/, async (m, q) => {
    const df = q.get('date_from'), dt = q.get('date_to'); if (df && dt && dt < df) return err(400, '終了日は開始日以降を指定してください');
    const status = q.get('status') || 'active'; if (status === 'written_off') return [];
    const rows = await collect({ patient_id: q.get('patient_id'), date_from: df, date_to: dt });
    const kind = (st) => { const paid = toInt(st.paid_amount), un = toInt(st.unpaid_amount); if (un > 0 && paid > 0) return 'partial'; if (un > 0 && st.status === 'confirmed') return 'active'; if (un <= 0 && paid > 0) return 'collected'; return null; };
    return rows.filter((x) => kind(x.st) === status).map(({ v, st }) => ({ id: v.id + '-unpaid', billing_id: v.id, patient_id: v.patient_id, original_amount: toInt(st.final_amount),
      unpaid_amount: toInt(st.unpaid_amount), status, reminder_count: 0, last_reminder_date: null, billing_date: v.visit_date, billing_no: st.billing_no || null,
      patient_name: (v.patients || {}).name || null, patient_no: (v.patients || {}).patient_no || null }));
  });
  // 月まとめ請求：統合版に置き場が無いので院ごとに DB（karte_clinic_store）へ置く。DB を使う印の無い院は従来どおり端末に置く
  const MKEY = () => 'karte_base_monthly_invoices_' + clinicId();
  const readInvoices = () => { try { return JSON.parse(C.store.getItem(MKEY()) || '[]'); } catch (e) { return []; } };
  const writeInvoices = (list) => { try { C.store.setItem(MKEY(), JSON.stringify(list)); } catch (e) { /* 保存できない環境では今回の表示だけ */ } };
  const monthStart = (s) => d10(s).slice(0, 7) + '-01';
  on('POST', /^\/billings\/monthly\/invoices$/, async (m, q, body) => {
    if (!body.patient_id || !body.invoice_month) return err(422, '患者と請求月を指定してください');
    const start = monthStart(body.invoice_month), [y, mo] = start.split('-').map(Number), end = ymd(new Date(y, mo, 0));
    let rows = await collect({ patient_id: body.patient_id, date_from: start, date_to: end });
    if (!body.include_paid) rows = rows.filter((x) => toInt(x.st.unpaid_amount) > 0);
    rows.sort((a, b) => (a.v.visit_date < b.v.visit_date ? -1 : a.v.visit_date > b.v.visit_date ? 1 : String(a.st.billing_no).localeCompare(String(b.st.billing_no))));
    const list = readInvoices(); const i = list.findIndex((x) => x.patient_id === body.patient_id && x.invoice_month === start);
    const at = nowIso(), prev = i >= 0 ? list[i] : { id: uid(), status: 'draft', issued_at: null, paid_at: null, created_at: at, created_by: null };
    const inv = Object.assign({}, prev, { facility_id: clinicId(), patient_id: body.patient_id, invoice_month: start, invoice_no: start.slice(0, 7).replace('-', '') + '-' + String(body.patient_id).slice(0, 8),
      billing_ids: rows.map((x) => x.v.id), billing_count: rows.length, total_amount: rows.reduce((s, x) => s + toInt(x.st.final_amount), 0),
      paid_amount: rows.reduce((s, x) => s + toInt(x.st.paid_amount), 0), unpaid_amount: rows.reduce((s, x) => s + toInt(x.st.unpaid_amount), 0), memo: body.memo || null, updated_at: at });
    if (i >= 0) list[i] = inv; else list.push(inv); writeInvoices(list);
    return inv;
  });
  on('GET', /^\/billings\/monthly\/invoices$/, async (m, q) => {
    let list = readInvoices();
    if (q.get('invoice_month')) list = list.filter((x) => x.invoice_month === monthStart(q.get('invoice_month')));
    if (q.get('patient_id')) list = list.filter((x) => x.patient_id === q.get('patient_id'));
    if (q.get('status')) list = list.filter((x) => x.status === q.get('status'));
    const c = await ready(); const ids = [...new Set(list.map((x) => x.patient_id))];
    const { data } = ids.length ? await c.from('patients').select('id,patient_no,name').in('id', ids).eq('clinic_id', clinicId()) : { data: [] };
    const byId = new Map((data || []).map((p) => [p.id, p]));
    return list.filter((x) => byId.has(x.patient_id)).map((x) => Object.assign({}, x, { patient_no: byId.get(x.patient_id).patient_no, patient_name: byId.get(x.patient_id).name }))
      .sort((a, b) => (b.invoice_month.localeCompare(a.invoice_month)) || String(a.patient_no).localeCompare(String(b.patient_no)));
  });
  // 一括再計算：保存済みの会計明細と、会計に記録した保険・公費で計算し直す（入金済額はそのまま・未収額と入金状態を付け直す）
  on('POST', /^\/billings\/recalculate\/month$/, async (m, q, body) => {
    if (!body.target_month) return err(422, '対象月を指定してください');
    const start = monthStart(body.target_month), [y, mo] = start.split('-').map(Number), end = ymd(new Date(y, mo, 0));
    const c = await ready();
    let r = c.from('visits').select(VSEL.replace('kartes(', 'kartes!inner(')).eq('clinic_id', clinicId()).gte('visit_date', start).lte('visit_date', end).order('visit_date');
    if (body.patient_id) r = r.eq('patient_id', body.patient_id);
    const { data, error } = await r; if (error) return err(500, error.message);
    const items = [];
    for (const v of data || []) {
      const st = await ensureBilling(v, !body.dry_run);   // 記録が保存し直されている会計は、まず記録から作り直す（提供元では保存時に済んでいる）
      if (!st || st.transient || !isActive(st)) continue;
      const p = v.patients || {};
      const ins = insuranceById(p, v.visit_date, st.insurance_id), pe = await publicExpenseById(p, v.visit_date, st.public_expense_id);
      const usage = pe && pe.id ? await usageFor(p, pe.id, v.visit_date, v.id) : null;
      const calc = Calc.calculateBilling(recalcItemsFromDisplay(st.items), ins, pe, usage);
      const paid = toInt(st.paid_amount), unpaid = Math.max(calc.final_amount - paid, 0), ps = paymentStatusFor(calc.final_amount, paid);
      items.push({ billing_id: v.id, patient_id: v.patient_id, billing_date: v.visit_date, before_final_amount: toInt(st.final_amount), after_final_amount: calc.final_amount,
        before_unpaid_amount: Math.max(toInt(st.final_amount) - paid, 0), after_unpaid_amount: unpaid, payment_status: ps });
      if (body.dry_run) continue;
      const h = headerOf(calc, null, null);
      ['insurance_id', 'insurance_type', 'burden_ratio', 'public_expense_id', 'public_expense_type'].forEach((k) => delete h[k]);   // 保険・公費の記録は変えない
      await saveState(v.id, Object.assign(st, h, { unpaid_amount: unpaid, payment_status: ps, updated_at: nowIso() }));
    }
    return { target_month: start, dry_run: !!body.dry_run, count: items.length, changed_count: items.filter((x) => x.before_final_amount !== x.after_final_amount).length, items };
  });
  // 集計（日計表・月計表）。入金・返金は日付で数えるので、期間の少し前（90日）の会計まで見る
  const SUMKEYS = ['total_score', 'total_amount', 'insurance_amount', 'public_expense_amount', 'patient_burden_adjusted', 'self_pay_amount', 'final_amount', 'paid_amount', 'unpaid_amount'];
  async function periodStats(df, dt) {
    const back = new Date(df + 'T00:00:00'); back.setDate(back.getDate() - 90);
    const rows = await collect({ date_from: ymd(back), date_to: dt, max: 5000 });
    const inRange = rows.filter((x) => x.v.visit_date >= df && x.v.visit_date <= dt);
    const sum = { billing_count: inRange.length }; SUMKEYS.forEach((k) => { sum[k] = inRange.reduce((s, x) => s + toInt(x.st[k]), 0); });
    const daily = new Map(); inRange.forEach((x) => { const d = daily.get(x.v.visit_date) || { date: x.v.visit_date, billing_count: 0, final_amount: 0, paid_amount: 0, unpaid_amount: 0 };
      d.billing_count++; d.final_amount += toInt(x.st.final_amount); d.paid_amount += toInt(x.st.paid_amount); d.unpaid_amount += toInt(x.st.unpaid_amount); daily.set(x.v.visit_date, d); });
    const pm = {}, rm = {};
    rows.forEach((x) => {
      (x.st.payments || []).forEach((p) => { if (p.payment_date >= df && p.payment_date <= dt) { const o = pm[p.payment_method] || (pm[p.payment_method] = { count: 0, amount: 0 }); o.count++; o.amount += toInt(p.payment_amount); } });
      (x.st.refunds || []).forEach((p) => { if (p.refund_date >= df && p.refund_date <= dt) { const o = rm[p.refund_method] || (rm[p.refund_method] = { count: 0, amount: 0 }); o.count++; o.amount += toInt(p.refund_amount); } });
    });
    return { sum, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), pm, rm };
  }
  on('GET', /^\/billings\/stats\/period$/, async (m, q) => {
    const df = q.get('date_from'), dt = q.get('date_to'); if (!df || !dt) return err(422, '期間を指定してください');
    if (dt < df) return err(400, '終了日は開始日以降を指定してください');
    const s = await periodStats(df, dt);
    return { date_from: df, date_to: dt, summary: { billing_count: s.sum.billing_count, total_score: s.sum.total_score, total_amount: s.sum.total_amount, insurance_amount: s.sum.insurance_amount,
      public_expense_amount: s.sum.public_expense_amount, patient_burden: s.sum.patient_burden_adjusted, self_pay_amount: s.sum.self_pay_amount, final_amount: s.sum.final_amount,
      paid_amount: s.sum.paid_amount, unpaid_amount: s.sum.unpaid_amount }, daily: s.daily, payment_methods: s.pm, refund_methods: s.rm };
  });
  on('GET', /^\/billings\/stats\/daily$/, async (m, q) => {
    const d = q.get('target_date') || today(); const s = await periodStats(d, d);
    return { date: d, billing_count: s.sum.billing_count, total_score: s.sum.total_score, total_amount: s.sum.total_amount, insurance_amount: s.sum.insurance_amount,
      patient_burden: s.sum.patient_burden_adjusted, self_pay_amount: s.sum.self_pay_amount, final_amount: s.sum.final_amount, paid_amount: s.sum.paid_amount, unpaid_amount: s.sum.unpaid_amount, payment_methods: s.pm };
  });

  // 経営データ集計の ZIP は、提供元の書式を写す作業が別にあるため今は出さない（画面には理由を返す）
  on('GET', /^\/billings\/business-report\/export$/, async () => err(501, '経営データ集計ZIPは統合版ではまだ出力できません'));

  // ================================================================
  // 自費マスター：統合版に置き場が無いので院ごとに DB（karte_clinic_store）へ置く。DB を使う印の無い院は従来どおり端末に置く
  //   初回は文書料（診断書）だけを入れる。提供元の既定にある美容施術の品目は、統合版の院に合わないので入れない
  // ================================================================
  const SKEY = () => 'karte_base_self_pay_master_' + clinicId();
  function readSelfPay() {
    let list = null; try { list = JSON.parse(C.store.getItem(SKEY()) || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list)) { const at = nowIso(); list = [{ id: uid(), item_code: 'SELF001', name: '診断書', name_short: '診断書', name_kana: '', price: 2200, tax_type: 'included', tax_rate: 10, tax_amount: null, category: '文書料', start_date: null, end_date: null, is_active: true, updated_at: at }]; writeSelfPay(list); }
    return list;
  }
  function writeSelfPay(list) { try { C.store.setItem(SKEY(), JSON.stringify(list)); } catch (e) { /* 保存できない環境では今回の表示だけ */ } }
  function selfPayOut(r) {
    const rate = r.tax_rate === null || r.tax_rate === undefined ? null : Number(r.tax_rate);
    const kana = r.name_kana || r.name_short || '';
    return { id: r.id, item_code: r.item_code, code: r.item_code, name: r.name, name_short: r.name_short, name_kana: kana, kana, price: r.price, tax_type: r.tax_type || 'included',
      tax_rate: rate, tax_amount: r.tax_amount !== null && r.tax_amount !== undefined ? toInt(r.tax_amount) : selfPayTaxAmount(toInt(r.price), rate), category: r.category, start_date: r.start_date || null, end_date: r.end_date || null };
  }
  // 入力の検査と正規化（提供元の SelfPayMasterCreate と同じ規則）
  function selfPayIn(body) {
    const name = String(body.name || '').trim(); if (!name) return { error: '項目名を入力してください' };
    const price = optInt(body.price); if (price === null || price < 0) return { error: '価格は0円以上で入力してください' };
    const taxRate = body.tax_rate === undefined ? 10 : (body.tax_rate === null ? null : Number(body.tax_rate));
    if (taxRate !== null && (isNaN(taxRate) || taxRate < 0 || taxRate > 100)) return { error: '税率が正しくありません' };
    const nameShort = String(body.name_short || name).slice(0, 100);
    const nameKana = String(body.name_kana || body.kana || nameShort).slice(0, 200).trim();
    const taxAmount = body.tax_amount !== undefined && body.tax_amount !== null ? toInt(body.tax_amount) : selfPayTaxAmount(price, taxRate);
    return { item_code: body.item_code ? String(body.item_code).trim() : null, name, name_short: nameShort, name_kana: nameKana, price, tax_type: 'included', tax_rate: taxRate, tax_amount: taxAmount,
      category: String(body.category || '自費').trim() || '自費', start_date: body.start_date || null, end_date: body.end_date || null };
  }
  on('GET', /^\/billings\/self-pay\/master$/, async (m, q) => {
    const cat = q.get('category');
    return readSelfPay().filter((r) => r.is_active !== false && (!cat || r.category === cat))
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.item_code).localeCompare(String(b.item_code))).map(selfPayOut);
  });
  // 作成：同じ品目コードか同じ名前（大文字小文字を問わない）があれば、削除済みでも復活させて更新する
  on('POST', /^\/billings\/self-pay\/master$/, async (m, q, body) => {
    const x = selfPayIn(body); if (x.error) return err(400, x.error);
    const list = readSelfPay(), lower = x.name.toLowerCase();
    const hit = list.filter((r) => (x.item_code && r.item_code === x.item_code) || String(r.name).toLowerCase() === lower)
      .sort((a, b) => (b.is_active !== false ? 1 : 0) - (a.is_active !== false ? 1 : 0) || String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    let row;
    if (hit) { Object.assign(hit, x, { item_code: x.item_code || hit.item_code, is_active: true, updated_at: nowIso() }); row = hit; }
    else { row = Object.assign({ id: uid() }, x, { item_code: x.item_code || 'SELF' + uid().replace(/-/g, '').slice(0, 8).toUpperCase(), is_active: true, updated_at: nowIso() }); list.push(row); }
    writeSelfPay(list); return selfPayOut(row);
  });
  on('PUT', /^\/billings\/self-pay\/master\/([^/]+)$/, async (m, q, body) => {
    const x = selfPayIn(body); if (x.error) return err(400, x.error);
    const list = readSelfPay(), row = list.find((r) => String(r.id) === decodeURIComponent(m[1]));
    if (!row) return err(404, '自費マスタが見つかりません');
    Object.assign(row, x, { item_code: x.item_code || row.item_code, is_active: true, updated_at: nowIso() }); writeSelfPay(list);
    return selfPayOut(row);
  });
  on('DELETE', /^\/billings\/self-pay\/master\/([^/]+)$/, async (m) => {
    const list = readSelfPay(), row = list.find((r) => String(r.id) === decodeURIComponent(m[1]) && r.is_active !== false);
    if (!row) return err(404, '自費マスタが見つかりません');
    row.is_active = false; row.updated_at = nowIso(); writeSelfPay(list);
    return { message: '削除しました', id: row.id };
  });
  // 日常業務の書き込み（compat_writes_daily.js：記録からの会計作成・会計の更新・領収書と明細書）が同じ計算と保存を使えるように出しておく
  C.billing = { visitById, baseOf, versionOf, isActive, ensureBilling, loadBilling, compute, headerOf, fresh, saveState, response, calcResponse, checkItems, bodyItems, nextBillingNo };
})(typeof window !== 'undefined' ? window : globalThis);
