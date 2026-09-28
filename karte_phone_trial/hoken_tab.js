/**
 * hoken_tab.js — カルテ画面の左パネル「保険等」タブ（2026-09-24）
 *
 * 基準版の「保険等」タブと同じ区分・同じ見た目・同じ入力の決まりで作り直したもの。
 *   区分: 医療保険／公費／労災・自賠責／レセプト特記事項／症状詳記／レセプト摘要欄コメント／福祉請求書備考欄コメント／レセプト一部負担金欄
 *   画面部品（HTML）は hoken_tab_markup.js、見た目は hoken_tab_reset.css → hoken_tab_base.css（自動生成）→ hoken_tab_extra.css。
 *
 * データは画面の患者オブジェクト p に配列で持つ（UKE 作成側がこの名前で読む。日付は 'YYYY-MM-DD'、数値は number）:
 *   p.insurances / p.publicExpenses / p.receiptSpecialNotes / p.receiptSymptomDetails / p.receiptSummaryComments /
 *   p.welfareInvoiceComments / p.receiptCopayments
 *   労災は従来どおり p.rousai（rousai.js・rousai_uke.js が読む）、自賠責は p.insurances（insuranceType 'auto'・主保険にしない）。
 * 保存は savePatientToApi(p)（= savePatientOnlyToSupabase。配列は patients.receipt_extra に入る）。
 * 今の画面・他の機能のため、主保険（診療日に有効・isPrimary 優先）の値を従来の項目（insurerNumber・insSymbol・insNumber・insEdaban・
 * relationship・ratio・insurance・limitCategory）へ、第1公費を kouhiNumber・recipientNumber へ写す（syncLegacy）。
 *
 * 統合版だけの機能の置き場所:
 *   ・保険証／医療証の写真と読み取り（OCR・予約サイトから届いた画像・スマホから届いた画像）= 医療保険・公費の区分の「カメラ」ボタン、
 *     および各追加小窓の上の「保険証読取」「医療証読取」。読み取った値は小窓の欄に入るだけで、登録を押すまで確定しない。
 *   ・所得区分（70歳以上の負担割合の判定）= 医療保険の小窓の最下段
 *   ・労災の請求（RREC）だけで使う項目 = 労災保険の小窓の下段
 */
(function () {
  'use strict';
  const MARKUP = window.HOKEN_TAB_MARKUP || { tab: '', modals: '' };
  const OFFICES = window.HOKEN_LABOR_OFFICES || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { if (typeof showToast === 'function') showToast(m); };
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'hk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  // ===================== 日付・数字（基準版と同じ決まり） =====================
  const localDate = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = () => localDate(new Date());
  const parseLocal = (v) => { if (!v) return new Date(); const [y, m, d] = String(v).split('-').map(Number); if (!y || !m || !d) return new Date(v); return new Date(y, m - 1, d); };
  const normDate = (v) => { if (!v) return null; if (v instanceof Date && !isNaN(v.getTime())) return localDate(v); const t = String(v).trim(); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3]; const d = new Date(t); return isNaN(d.getTime()) ? null : localDate(d); };
  const era = (y) => y >= 2019 ? '令和' + (y - 2018) : y >= 1989 ? '平成' + (y - 1988) : y >= 1926 ? '昭和' + (y - 1925) : y >= 1912 ? '大正' + (y - 1911) : y >= 1868 ? '明治' + (y - 1867) : '';
  const digits = (v) => String(v == null ? '' : v).replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[^\d]/g, '');
  // 入力欄に出す日付「2026(令和8)年9月24日」
  function fmtInput(date = new Date()) {
    let t = date instanceof Date ? date : parseLocal(String(date));
    if (!(t instanceof Date) || isNaN(t.getTime())) t = new Date();
    return t.getFullYear() + '(' + era(t.getFullYear()) + ')年' + (t.getMonth() + 1) + '月' + t.getDate() + '日';
  }
  // 入力欄の日付を 'YYYY-MM-DD' に（和暦つき・スラッシュ・8桁のどれでも）
  function parseDate(value) {
    const raw = String(value || '').trim(); if (!raw) return null;
    const n = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[年月.]/g, '/').replace(/日/g, '');
    const m = n.match(/^(\d{4})(\d{2})(\d{2})$/) || n.match(/^(\d{4})(?:\([^)]*\))?\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
    return localDate(d);
  }
  const slash = (v) => v ? String(v).split('-').join('/') : '';
  const listDate = (v) => { const n = normDate(v); if (!n) return ''; const [y, m, d] = n.split('-').map(Number); return y + '/' + m + '/' + d; };
  const slashDate = (v, fb) => { const n = normDate(v) || fb || ''; return n ? n.split('-').join('/') : ''; };
  function copayDate(v) { const n = normDate(v) || parseDate(v); if (!n) return ''; const t = parseLocal(n); return t.getFullYear() + '/' + String(t.getMonth() + 1).padStart(2, '0') + '/' + String(t.getDate()).padStart(2, '0') + ' (' + '日月火水木金土'[t.getDay()] + ')'; }
  function birthJa(b) {
    if (!b) return '-'; const d = new Date(b); if (isNaN(d.getTime())) return b;
    const y = d.getFullYear(); const eras = [['令和', 2019], ['平成', 1989], ['昭和', 1926], ['大正', 1912], ['明治', 1868]]; const e = eras.find((x) => y >= x[1]);
    return e ? y + '年(' + e[0] + (y - e[1] + 1) + '年)' + (d.getMonth() + 1) + '月' + d.getDate() + '日' : y + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function ageParts(birth, ref = new Date()) {
    if (!birth) return null; const b = parseLocal(String(birth)); const t = ref instanceof Date ? ref : parseLocal(String(ref));
    if (isNaN(b.getTime()) || isNaN(t.getTime())) return null;
    let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth(); if (t.getDate() < b.getDate()) m--; if (m < 0) { y--; m += 12; }
    return y < 0 ? null : { years: y, months: m };
  }
  const ageLabel = (b) => { const a = ageParts(b); return !a ? '-' : a.years < 10 ? a.years + '歳' + a.months + 'ヶ月' : a.years + '歳'; };
  const addYears = (d, n) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setFullYear(r.getFullYear() + n); return r; };
  const firstNonEmpty = (...v) => v.map((x) => String(x == null ? '' : x).trim()).find(Boolean) || '';

  // ===================== マスタ（基準版の既定値） =====================
  const SPECIAL_NOTE_TYPES = [['01', '公'], ['02', '長'], ['03', '長処'], ['04', '後保'], ['07', '老併'], ['08', '老健'], ['09', '施'], ['10', '第三'], ['11', '薬治'], ['12', '器治'], ['13', '先進'], ['14', '制超'],
    ['16', '長2'], ['17', '上位'], ['18', '一般'], ['19', '低所'], ['20', '二割'], ['21', '高半'], ['22', '多上'], ['25', '出産'], ['26', '区ア'], ['27', '区イ'], ['28', '区ウ'], ['29', '区エ'],
    ['30', '区オ'], ['31', '多ア'], ['32', '多イ'], ['33', '多ウ'], ['34', '多エ'], ['35', '多オ'], ['36', '加治'], ['37', '申出'], ['38', '医併'], ['39', '医療'], ['41', '区カ'], ['42', '区キ'],
    ['43', '多カ'], ['44', '多キ'], ['96', '災1'], ['97', '災2']].map(([code, name]) => ({ code, name }));
  const SYMPTOM_TYPES = [['01', '患者の主たる疾患の臨床症状'], ['02', '患者の主たる疾患の診療・検査所見'], ['03', '主な治療行為の必要性'], ['04', '主な治療行為の経過'], ['05', '100万点以上の薬剤に係る症状等'],
    ['06', '100万点以上の処置に係る症状等'], ['07', 'その他'], ['50', '治験に係る治療概要'], ['51', '疾患別リハビリテーションに係る治療継続の理由等'], ['52', '廃用症候群に係る評価'], ['90', '上記以外の症状詳記']].map(([code, name]) => ({ code, name }));
  function publicTypes() {
    const base = [
      { type_code: 'welfare', law_number: '12', name: '生活保護' }, { type_code: 'support_mental', law_number: '21', name: '自立支援医療（精神通院）' },
      { type_code: 'support_nurturing', law_number: '22', name: '自立支援医療（育成医療）' }, { type_code: 'support_rehabilitation', law_number: '23', name: '自立支援医療（更生医療）' },
      { type_code: 'specific', law_number: '51', name: '特定疾患' }, { type_code: 'child', law_number: '81', name: '乳幼児医療' }, { type_code: 'single_parent', law_number: '82', name: 'ひとり親家庭医療' },
      { type_code: 'disabled', law_number: '83', name: '重度障害者医療' }, { type_code: 'atomic', law_number: '18', name: '原爆被爆者' }, { type_code: 'intractable', law_number: '54', name: '難病医療' }];
    // 統合版の公費一覧（insurance_calc.js の法別番号）にあって上に無いものを後ろに足す
    if (typeof KOUHI_MAP !== 'undefined') Object.keys(KOUHI_MAP).sort().forEach((law) => { if (!base.some((t) => t.law_number === law)) base.push({ type_code: 'law_' + law, law_number: law, name: KOUHI_MAP[law].name }); });
    return base;
  }
  const INSURANCE_TYPE_LABEL = { social: '社会保険', national: '国民健康保険', elderly: '後期高齢者医療', union: '組合健保', mutual: '共済組合', labor: '労災保険', auto: '自賠責保険', self_pay: '自費' };
  const LAW_GROUPS = { social: ['01', '03', '04', '07'], seamen: ['02'], union: ['06', '63'], mutual: ['31', '32', '33', '34', '72', '73', '74', '75'], elderly: ['39'], national: ['67'] };
  function inferInsuranceType(n) {
    const num = digits(n); if (!num) return 'social'; if (num.length === 6) return 'national';
    const law = num.slice(0, 2);
    if (LAW_GROUPS.elderly.includes(law)) return 'elderly'; if (LAW_GROUPS.national.includes(law)) return 'national';
    if (LAW_GROUPS.seamen.includes(law)) return 'seamen'; if (LAW_GROUPS.union.includes(law)) return 'union'; if (LAW_GROUPS.mutual.includes(law)) return 'mutual';
    return 'social';
  }

  // ===================== 患者と配列 =====================
  const KEYS = ['insurances', 'publicExpenses', 'receiptSpecialNotes', 'receiptSymptomDetails', 'receiptSummaryComments', 'welfareInvoiceComments', 'receiptCopayments'];
  function cur() { return (typeof patients !== 'undefined' && typeof currentPatientId !== 'undefined') ? patients.find((x) => x.id === currentPatientId) || null : null; }
  const refDate = () => (typeof selectedDate !== 'undefined' && selectedDate) ? selectedDate : today();
  const list = (p, k) => (p && Array.isArray(p[k])) ? p[k] : [];
  const LABOR_AUTO = ['labor', 'workers', 'workers_comp', 'auto', 'automobile'];
  const isLaborAuto = (i) => LABOR_AUTO.includes(String((i && i.insuranceType) || '').toLowerCase());
  const isCurrent = (e) => { if (!e || e.isActive === false) return false; const u = normDate(e.validUntil); return !u || u >= today(); };
  // 従来の項目だけ入っている患者（配列ができる前の患者）は、従来の項目から1件ぶんを作って見せる（保存するまで患者には入れない）
  const legacyIds = new WeakMap();
  function legacyId(p, kind) { let o = legacyIds.get(p); if (!o) { o = { ins: uid(), pe: uid() }; legacyIds.set(p, o); } return o[kind]; }
  function legacyInsurance(p) {
    if (!p || list(p, 'insurances').length || !(p.insurerNumber || p.insNumber)) return null;
    const label = String(p.insurance || '');
    const type = /後期/.test(label) ? 'elderly' : /国保/.test(label) ? 'national' : /自費/.test(label) ? 'self_pay' : p.insurerNumber ? inferInsuranceType(p.insurerNumber) : 'social';
    const ratio = Number(p.ratio);
    return { id: legacyId(p, 'ins'), insuranceType: type, insurerNumber: digits(p.insurerNumber), insurerName: p.insurerName || '', qualificationUnknownReason: '', qualificationUnknownDetail: '',
      symbol: p.insSymbol || '', number: p.insNumber || '', branchNumber: p.insEdaban || '', relationship: /家族|被扶養/.test(String(p.relationship || '')) ? 'family' : 'main',
      burdenRatio: isNaN(ratio) ? 30 : Math.round(ratio * 100), validFrom: '', validUntil: '', limitCategory: p.limitCategory || '', limitCertificateNumber: '', qualificationAcquiredDate: '',
      holderName: '', reductionType: '', reductionRatio: null, facilityEntryStatus: '', facilityValidFrom: '', facilityValidUntil: '', insurerAddress: '', workplaceName: '', workplaceAddress: '',
      isPrimary: true, isActive: true, _fromLegacy: true };
  }
  function legacyPublic(p) {
    if (!p || list(p, 'publicExpenses').length || !(p.kouhiNumber || p.recipientNumber)) return null;
    const payer = digits(p.kouhiNumber); const law = payer.slice(0, 2); const t = publicTypes().find((x) => x.law_number === law);
    return { id: legacyId(p, 'pe'), type: t ? t.type_code : '', typeCode: law || '', payerNumber: payer, noPayerNumber: !payer, municipality: '', recipientNumber: digits(p.recipientNumber),
      confirmLater: !digits(p.recipientNumber), validFrom: p.iryoValidFrom || '', validUntil: p.iryoValidTo || '', claimTarget: 'medical', prescriptionClaimTarget: 'same_as_medical', priority: 1, isActive: true, _fromLegacy: true };
  }
  const viewInsurances = (p) => { const l = list(p, 'insurances'); if (l.length) return l; const v = legacyInsurance(p); return v ? [v] : []; };
  const viewPublic = (p) => { const l = list(p, 'publicExpenses'); if (l.length) return l; const v = legacyPublic(p); return v ? [v] : []; };
  // 書き込む前に配列を用意し、従来の項目から作った1件を本物にする
  function materialize(p) {
    const vi = legacyInsurance(p), vp = legacyPublic(p);
    KEYS.forEach((k) => { if (!Array.isArray(p[k])) p[k] = []; });
    if (vi) { delete vi._fromLegacy; p.insurances.push(vi); }
    if (vp) { delete vp._fromLegacy; p.publicExpenses.push(vp); }
  }
  // 労災（p.rousai）。rousai.js は先頭の1件を使うので、今有効なもの・開始日の新しいものを先頭にする
  const rousaiList = (p) => (p && Array.isArray(p.rousai)) ? p.rousai : [];
  const rousaiCurrent = (r) => { const e = normDate(r && r.endDate); return !e || e >= today(); };
  function sortRousai(p) {
    if (!Array.isArray(p.rousai)) return;
    p.rousai.sort((a, b) => (rousaiCurrent(b) ? 1 : 0) - (rousaiCurrent(a) ? 1 : 0) || String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  // ===================== 従来の項目への写し =====================
  function primaryInsurance(p, date) {
    const d = date || refDate();
    const act = list(p, 'insurances').filter((i) => !isLaborAuto(i) && i.isActive !== false && (!i.validFrom || String(i.validFrom).slice(0, 10) <= d) && (!i.validUntil || String(i.validUntil).slice(0, 10) >= d));
    return act.slice().sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))[0] || null;
  }
  function ratioLabel(r) { return r === 0.1 ? '1割' : r === 0.2 ? '2割' : r === 0.05 ? '5%' : r === 0.3 ? '3割' : r === 1 ? '10割' : '0割'; }
  function insuranceLabel(ins) {
    const r = Number(ins.burdenRatio) / 100;
    if (ins.insuranceType === 'self_pay') return '自費';
    const type = ins.insuranceType === 'national' ? '国保' : ins.insuranceType === 'elderly' ? '後期高齢者' : '社保';
    return type + ratioLabel(r);
  }
  function syncLegacy(p, date) {
    if (!p) return p;
    const ins = primaryInsurance(p, date);
    if (ins) {
      p.insurerNumber = ins.insurerNumber || '';
      p.insSymbol = ins.symbol || ''; p.insNumber = ins.number || ''; p.insEdaban = ins.branchNumber || '';
      p.relationship = ins.relationship === 'family' ? '家族' : '本人';
      const br = Number(ins.burdenRatio); if (!isNaN(br)) p.ratio = br / 100;
      p.insurance = insuranceLabel(ins);
      p.limitCategory = ins.limitCategory || '';
      if (typeof buildInsuranceNumberStr === 'function') p.insuranceNumber = buildInsuranceNumberStr({ symbol: p.insSymbol, memberNumber: p.insNumber, edaban: p.insEdaban });
    } else if (Array.isArray(p.insurances) && !p.insurances.some((i) => !isLaborAuto(i))) {
      // 医療保険を全部消したとき
      p.insurerNumber = ''; p.insSymbol = ''; p.insNumber = ''; p.insEdaban = ''; p.limitCategory = ''; p.insuranceNumber = '';
      const pub = firstPublic(p, date);
      p.insurance = pub ? '公費' : '保険無し';
    }
    const pub = firstPublic(p, date);
    if (pub) {
      p.kouhiNumber = pub.noPayerNumber ? '' : (pub.payerNumber || '');
      p.recipientNumber = pub.confirmLater ? '' : (pub.recipientNumber || '');
      if (!ins && pub.typeCode === '12') { p.insurance = '公費'; p.ratio = 0; }
    } else if (Array.isArray(p.publicExpenses) && !p.publicExpenses.length) { p.kouhiNumber = ''; p.recipientNumber = ''; }
    return p;
  }
  function firstPublic(p, date) {
    const d = date || refDate();
    return list(p, 'publicExpenses').filter((e) => e.isActive !== false && (!e.validFrom || String(e.validFrom).slice(0, 10) <= d) && (!e.validUntil || String(e.validUntil).slice(0, 10) >= d))
      .slice().sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0] || null;
  }
  // 逆向き: 従来の小窓（保険証情報・患者情報の編集）で従来の項目を直したとき、主保険の配列にも入れる
  function adoptLegacy(p) {
    if (!p || !list(p, 'insurances').length) return false;
    const ins = primaryInsurance(p) || list(p, 'insurances').find((i) => !isLaborAuto(i) && i.isPrimary);
    const ratio = Number(p.ratio);
    if (ins) {
      const label = String(p.insurance || '');
      const before = JSON.stringify(ins);
      ins.insurerNumber = digits(p.insurerNumber); ins.symbol = p.insSymbol || ''; ins.number = p.insNumber || ''; ins.branchNumber = p.insEdaban || '';
      if (!isNaN(ratio)) ins.burdenRatio = Math.round(ratio * 100);
      if (/後期/.test(label)) ins.insuranceType = 'elderly'; else if (/国保/.test(label)) ins.insuranceType = 'national'; else if (/自費/.test(label)) ins.insuranceType = 'self_pay';
      else if (/社保/.test(label) && ['national', 'elderly', 'self_pay'].includes(ins.insuranceType)) ins.insuranceType = 'social';
      if (JSON.stringify(ins) !== before) { ins.updatedAt = new Date().toISOString(); return true; }
      return false;
    }
    if (p.insurerNumber || p.insNumber) {
      const v = Object.assign({}, legacyInsurance(Object.assign({}, p, { insurances: [] })), { id: uid(), updatedAt: new Date().toISOString() });
      delete v._fromLegacy; p.insurances.unshift(v); return true;
    }
    return false;
  }
  function persist(p, message) {
    syncLegacy(p);
    if (typeof savePatientToApi === 'function') savePatientToApi(p);
    if (typeof renderAllKarte === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'karte') renderAllKarte(); else renderTab(p);
    if (message) toast(message);
  }

  // ===================== タブの描画 =====================
  const state = { medicalAll: false, publicAll: false, laborAll: false, specialAll: false, symptomAll: false, summaryAll: false, welfareAll: false, copayPast: false };
  function renderTab(p) {
    const body = $('patientInfoBody'); if (!body) return;
    body.innerHTML = '<div id="hokenTab">' + MARKUP.tab + '</div>';
    const set = (id, v) => { const el = $(id); if (el) el.checked = v; };
    set('insurance-current-toggle', !state.medicalAll); set('public-expense-current-toggle', !state.publicAll); set('labor-auto-current-toggle', !state.laborAll);
    set('receipt-special-note-current-toggle', !state.specialAll); set('receipt-symptom-detail-current-toggle', !state.symptomAll); set('receipt-summary-comment-current-toggle', !state.summaryAll);
    set('welfare-invoice-comment-current-toggle', !state.welfareAll); set('receipt-copayment-past-toggle', state.copayPast);
    renderLists(p);
    wireTab();
  }
  function renderLists(p) {
    renderInsuranceList(p); renderLaborAutoList(p); renderPublicList(p); renderSpecialList(p); renderSymptomList(p); renderSummaryList(p); renderWelfareList(p); renderCopayList(p);
  }
  const editBtn = (attr, id, title = '編集') => '<button type="button" class="m3-icon-btn-sm" ' + attr + '="' + esc(id) + '" title="' + title + '"><i class="fas fa-pen"></i></button>';
  function renderInsuranceList(p) {
    const box = $('insurance-list'); if (!box) return;
    const items = viewInsurances(p).filter((i) => !isLaborAuto(i) && (state.medicalAll || isCurrent(i)));
    const dates = items.map((i) => normDate(i.updatedAt)).filter(Boolean).sort().reverse();
    const c = $('insurance-last-confirmed-date'); if (c) c.textContent = listDate(dates[0]) || '-';
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">有効な医療保険が登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table medical-insurance-table"><thead><tr><th>保険者番号</th><th>記号</th><th>番号</th><th>開始日</th><th>終了日</th><th></th></tr></thead><tbody>' +
      items.map((i) => '<tr><td>' + esc(i.insurerNumber || '') + '</td><td>' + esc(i.symbol || '') + '</td><td>' + esc([i.number, i.branchNumber].filter(Boolean).join('-')) + '</td><td>' + esc(listDate(i.validFrom)) + '</td><td>' + esc(listDate(i.validUntil)) + '</td>' +
        '<td class="insurance-row-actions"><button type="button" class="m3-icon-btn-sm" data-insurance-history-id="' + esc(i.id) + '" title="更新履歴" aria-label="更新履歴"><i class="fas fa-sync-alt"></i></button> ' + editBtn('data-insurance-edit-id', i.id) + '</td></tr>').join('') + '</tbody></table>';
  }
  function laborAutoItems(p) {
    const out = [];
    rousaiList(p).forEach((r, idx) => { if (state.laborAll || rousaiCurrent(r)) out.push({ key: 'rs:' + idx, label: '労災・' + ((r.benefitType === 'injury_pension' || (r.pensionNo && !r.no)) ? '傷病年金' : '短期'), no: firstNonEmpty(r.no, r.pensionNo), from: r.startDate, until: r.endDate }); });
    list(p, 'insurances').filter((i) => String(i.insuranceType) === 'auto' && (state.laborAll || isCurrent(i))).forEach((i) => out.push({ key: 'au:' + i.id, label: '自賠責', no: i.number || '', from: i.validFrom, until: i.validUntil }));
    return out;
  }
  function renderLaborAutoList(p) {
    const box = $('labor-auto-list'); if (!box) return;
    const items = laborAutoItems(p);
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">' + (state.laborAll ? '労災・自賠責が登録されていません。' : '有効な労災・自賠責が登録されていません。') + '</div>'; return; }
    box.innerHTML = '<table class="insurance-table labor-auto-insurance-table"><thead><tr><th>種類</th><th>労保番号・年金番号</th><th>開始日</th><th>終了日</th><th></th></tr></thead><tbody>' +
      items.map((x) => '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.no) + '</td><td>' + esc(listDate(x.from)) + '</td><td>' + esc(listDate(x.until)) + '</td><td class="insurance-row-actions">' + editBtn('data-labor-auto-edit-id', x.key) + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderPublicList(p) {
    const box = $('public-expense-list'); if (!box) return;
    const items = viewPublic(p).filter((e) => state.publicAll || isCurrent(e));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">公費情報が登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table public-expense-table"><thead><tr><th scope="col">負担者番号</th><th scope="col">受給者番号</th><th scope="col">開始日</th><th scope="col">終了日</th><th scope="col" aria-label="操作"></th></tr></thead><tbody>' +
      items.map((e) => '<tr><td>' + esc(e.noPayerNumber ? '' : (e.payerNumber || '')) + '</td><td>' + esc(e.confirmLater ? '' : (e.recipientNumber || '')) + '</td><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td>' +
        '<td class="insurance-row-actions"><button type="button" class="m3-icon-btn-sm" data-public-expense-recheck-id="' + esc(e.id) + '" title="再確認" aria-label="公費を再確認"><i class="fas fa-sync-alt" aria-hidden="true"></i></button> ' +
        '<button type="button" class="m3-icon-btn-sm" data-public-expense-edit-id="' + esc(e.id) + '" title="編集" aria-label="公費を編集"><i class="fas fa-pen" aria-hidden="true"></i></button></td></tr>').join('') + '</tbody></table>';
  }
  const noteName = (code) => { const t = SPECIAL_NOTE_TYPES.find((x) => x.code === code); return t ? t.name : (code || ''); };
  const symptomName = (code) => { const t = SYMPTOM_TYPES.find((x) => x.code === code); return t ? t.name : ''; };
  function renderSpecialList(p) {
    const box = $('receipt-special-note-list'); if (!box) return;
    const items = list(p, 'receiptSpecialNotes').filter((e) => state.specialAll ? e.isActive !== false : isCurrent(e));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">レセプト特記事項が登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table receipt-special-note-table"><thead><tr><th>特記事項</th><th>記載開始日</th><th>記載終了日</th><th></th></tr></thead><tbody>' +
      items.map((e) => '<tr><td>' + esc(noteName(e.code)) + '</td><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td><td class="insurance-row-actions">' + editBtn('data-receipt-special-note-edit-id', e.id) + '</td></tr>').join('') + '</tbody></table>';
  }
  function targetLabel(p, id) {
    if (!id) return '社保・国保';
    const t = targetOptions(p).find((o) => o.value === String(id));
    return t ? t.label : '対象保険';
  }
  function renderSymptomList(p) {
    const box = $('receipt-symptom-detail-list'); if (!box) return;
    const items = list(p, 'receiptSymptomDetails').filter((e) => state.symptomAll ? e.isActive !== false : isCurrent(e));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">症状詳記が登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table receipt-symptom-detail-table"><thead><tr><th>症状詳記区分</th><th>対象保険</th><th>記載開始日</th><th>記載終了日</th><th></th></tr></thead><tbody>' +
      items.map((e) => '<tr><td>' + esc(((e.category || '') + ' ' + symptomName(e.category)).trim()) + '</td><td>' + esc(targetLabel(p, e.insurance)) + '</td><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td><td class="insurance-row-actions">' + editBtn('data-receipt-symptom-detail-edit-id', e.id) + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderSummaryList(p) {
    const box = $('receipt-summary-comment-list'); if (!box) return;
    const items = list(p, 'receiptSummaryComments').filter((e) => state.summaryAll ? e.isActive !== false : isCurrent(e));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">レセプト摘要欄コメントが登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table receipt-summary-comment-table"><thead><tr><th>摘要欄コメント</th><th>対象保険</th><th>記載開始日</th><th>記載終了日</th><th></th></tr></thead><tbody>' +
      items.map((e) => '<tr><td>' + esc(e.content || '') + '</td><td>' + esc(targetLabel(p, e.insurance)) + '</td><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td><td class="insurance-row-actions">' + editBtn('data-receipt-summary-comment-edit-id', e.id) + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderWelfareList(p) {
    const box = $('welfare-invoice-comment-list'); if (!box) return;
    const items = list(p, 'welfareInvoiceComments').filter((e) => state.welfareAll ? e.isActive !== false : isCurrent(e));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">福祉請求書備考欄コメントが登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table welfare-invoice-comment-table"><thead><tr><th>福祉請求書備考欄コメント</th><th>記載開始日</th><th>記載終了日</th><th></th></tr></thead><tbody>' +
      items.map((e) => '<tr><td>' + esc(e.content || '') + '</td><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td><td class="insurance-row-actions">' + editBtn('data-welfare-invoice-comment-edit-id', e.id) + '</td></tr>').join('') + '</tbody></table>';
  }
  const COV = ['covered1', 'covered2', 'covered3', 'covered4'], PUB = ['public1', 'public2', 'public3', 'public4'];
  const yen = (v) => (v === null || v === undefined || v === '') ? '' : (Number.isFinite(Number(v)) ? Number(v).toLocaleString('ja-JP') : '');
  function renderCopayList(p) {
    const box = $('receipt-copayment-list'); if (!box) return;
    const items = list(p, 'receiptCopayments').filter((e) => e.isActive !== false && (state.copayPast || !normDate(e.validUntil) || normDate(e.validUntil) >= today()));
    if (!items.length) { box.innerHTML = '<div class="insurance-empty">レセプト一部負担金欄が登録されていません。</div>'; return; }
    box.innerHTML = '<table class="insurance-table receipt-copayment-table-list"><thead><tr><th>記載開始日</th><th>記載終了日</th><th>保険</th><th>公費</th><th></th></tr></thead><tbody>' +
      items.map((e) => { const pub = PUB.map((k, i) => (e[k] === null || e[k] === undefined || e[k] === '') ? '' : (i + 1) + ':' + yen(e[k])).filter(Boolean).join(' / ');
        return '<tr><td>' + esc(listDate(e.validFrom)) + '</td><td>' + esc(listDate(e.validUntil)) + '</td><td>' + esc(yen(e.insuranceAmount)) + '</td><td>' + esc(pub) + '</td><td class="insurance-row-actions">' + editBtn('data-receipt-copayment-edit-id', e.id) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function wireTab() {
    const root = $('hokenTab'); if (!root || root.dataset.wired) return; root.dataset.wired = '1';
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('button, [data-labor-auto-add]'); if (!t) return;
      const id = t.id, d = t.dataset;
      const go = (fn) => { ev.preventDefault(); fn(); };
      if (id === 'btn-add-insurance') return go(() => openInsurance());
      if (id === 'btn-read-insurance-card') return go(() => openInsurance(null, { reader: true }));
      if (id === 'btn-add-public-expense') return go(() => openPublicExpense());
      if (id === 'btn-read-iryo-card') return go(() => openPublicExpense(null, { reader: true }));
      if (id === 'btn-add-labor-auto') { ev.preventDefault(); ev.stopPropagation(); const m = $('labor-auto-add-menu'); if (m) m.classList.toggle('hidden'); return; }
      if (d.laborAutoAdd) { ev.preventDefault(); const m = $('labor-auto-add-menu'); if (m) m.classList.add('hidden'); return d.laborAutoAdd === 'labor' ? openWorkers() : openAuto(); }
      if (id === 'btn-add-receipt-special-note') return go(() => openSpecialNote());
      if (id === 'btn-add-receipt-symptom-detail') return go(() => openSymptomDetail());
      if (id === 'btn-add-receipt-summary-comment') return go(() => openSummaryComment());
      if (id === 'btn-add-welfare-invoice-comment') return go(() => openWelfareComment());
      if (id === 'btn-add-receipt-copayment') return go(() => openCopayment());
      if (d.insuranceEditId) return go(() => openInsurance(d.insuranceEditId));
      if (d.insuranceHistoryId) return go(() => toast('更新履歴はこの画面では記録していません（最後に更新した日は「前回確認日」に出ます）'));
      if (d.publicExpenseEditId) return go(() => openPublicExpense(d.publicExpenseEditId));
      if (d.publicExpenseRecheckId) return go(() => toast('オンライン資格確認端末とは未接続です。医療証は「医療証読取」から読み取れます'));
      if (d.laborAutoEditId) return go(() => openLaborAutoEditor(d.laborAutoEditId));
      if (d.receiptSpecialNoteEditId) return go(() => openSpecialNote(d.receiptSpecialNoteEditId));
      if (d.receiptSymptomDetailEditId) return go(() => openSymptomDetail(d.receiptSymptomDetailEditId));
      if (d.receiptSummaryCommentEditId) return go(() => openSummaryComment(d.receiptSummaryCommentEditId));
      if (d.welfareInvoiceCommentEditId) return go(() => openWelfareComment(d.welfareInvoiceCommentEditId));
      if (d.receiptCopaymentEditId) return go(() => openCopayment(d.receiptCopaymentEditId));
    });
    root.addEventListener('change', (ev) => {
      const id = ev.target.id, on = ev.target.checked; const p = cur(); if (!p) return;
      const map = { 'insurance-current-toggle': 'medicalAll', 'public-expense-current-toggle': 'publicAll', 'labor-auto-current-toggle': 'laborAll', 'receipt-special-note-current-toggle': 'specialAll',
        'receipt-symptom-detail-current-toggle': 'symptomAll', 'receipt-summary-comment-current-toggle': 'summaryAll', 'welfare-invoice-comment-current-toggle': 'welfareAll' };
      if (map[id]) { state[map[id]] = !on; renderLists(p); }
      if (id === 'receipt-copayment-past-toggle') { state.copayPast = on; renderLists(p); }
    });
  }

  // ===================== 小窓の共通 =====================
  let modalsReady = false;
  function ensureModals() {
    let host = $('hokenModals');
    if (!host) { host = document.createElement('div'); host.id = 'hokenModals'; document.body.appendChild(host); }
    if (modalsReady && $('insurance-modal')) return host;
    host.innerHTML = MARKUP.modals;
    modalsReady = true;
    fillStaticOptions();
    wireModals();
    initDatePicker();
    return host;
  }
  const show = (id) => { const m = $(id); if (m) m.classList.remove('hidden'); document.body.classList.add('hk-modal-open'); };
  function hide(id) {
    const m = $(id); if (m) m.classList.add('hidden'); closeDatePicker();
    if (reader.modal === id) detachReader();
    if (!document.querySelector('#hokenModals .modal:not(.hidden)')) document.body.classList.remove('hk-modal-open');
  }
  const val = (id) => { const e = $(id); return e ? String(e.value || '') : ''; };
  const setVal = (id, v) => { const e = $(id); if (e) e.value = v == null ? '' : String(v); };
  const numOrNull = (id) => { const d = digits(val(id)); return d ? Number(d) : null; };
  const patientSummary = (p) => (p.id || '') + ' ' + (p.name || '-') + ' ' + birthJa(p.dob) + '生まれ ' + (ageLabel(p.dob) === '-' ? '' : ageLabel(p.dob));
  function modeButtons(saveId, delId, editing) {
    const s = $(saveId); if (s) s.textContent = editing ? '更新' : '登録';
    const d = $(delId); if (d) { d.classList.toggle('hidden', !editing); d.disabled = false; }
  }
  function fillStaticOptions() {
    const pt = $('public-expense-type');
    if (pt) pt.innerHTML = '<option value="">選択してください</option>' + publicTypes().map((t) => '<option value="' + esc(t.type_code) + '" data-law-number="' + esc(t.law_number || '') + '">' + esc(t.law_number ? t.law_number + ' ' + t.name : t.name) + '</option>').join('');
    const pref = '<option value=""></option>' + Object.keys(OFFICES).map((c) => '<option value="' + esc(c) + '">' + esc(OFFICES[c].prefecture || '') + '</option>').join('');
    ['workers-policy-business-prefecture', 'workers-policy-bureau-prefecture'].forEach((id) => { const s = $(id); if (s) s.innerHTML = pref; });
    renderOfficeOptions('');
  }
  function renderOfficeOptions(pref, selected) {
    const s = $('workers-policy-office'); if (!s) return;
    const offices = (OFFICES[pref] && OFFICES[pref].offices) || [];
    s.innerHTML = '<option value=""></option>' + offices.map((o) => '<option value="' + esc(o.code) + '">' + esc(o.name) + '</option>').join('');
    s.disabled = !pref;
    if (selected) s.value = String(selected).padStart(2, '0');
  }

  // ===================== 医療保険 =====================
  let editingInsuranceId = null, editingInsuranceRousaiIdx = null, burdenManual = false;
  function burdenRefDate() { return parseLocal(normDate(refDate()) || today()); }
  function isPreschool(birth, ref) { const b = parseLocal(String(birth)); if (isNaN(b.getTime())) return false; const six = addYears(b, 6); const cy = six.getMonth() <= 2 ? six.getFullYear() : six.getFullYear() + 1; return localDate(ref) <= localDate(new Date(cy, 2, 31)); }
  function seventyStart(birth) { const b = parseLocal(String(birth)); if (isNaN(b.getTime())) return null; const s = addYears(b, 70); return s.getDate() === 1 ? new Date(s.getFullYear(), s.getMonth(), 1) : new Date(s.getFullYear(), s.getMonth() + 1, 1); }
  function is70to74(birth, ref) { const s = seventyStart(birth); const b = parseLocal(String(birth)); if (!s || isNaN(b.getTime())) return false; return localDate(ref) >= localDate(s) && !(localDate(ref) >= localDate(addYears(b, 75))); }
  function is75(birth, ref) { const b = parseLocal(String(birth)); if (isNaN(b.getTime())) return false; return localDate(ref) >= localDate(addYears(b, 75)); }
  // 基準版の年齢による既定値に、統合版の所得区分（70歳以上）を重ねる
  function inferBurden(p, type, insurer) {
    const birth = p && p.dob; const ref = burdenRefDate(); const n = digits(insurer); const inc = val('hk-income-level') || (p && p.incomeLevel) || 'ippan';
    const genzai = /^genzai/.test(inc);
    if (type === 'labor' || type === 'auto') return 0; if (type === 'self_pay') return 100;
    if (type === 'elderly' || n.startsWith('39') || is75(birth, ref)) return genzai ? 30 : inc === 'itteijoh' ? 20 : 10;
    if (is70to74(birth, ref)) return genzai ? 30 : 20;
    if (isPreschool(birth, ref)) return 20;
    return 30;
  }
  function burdenReason(p, type, insurer) {
    const birth = p && p.dob; const ref = burdenRefDate(); const a = ageParts(birth, ref); const age = a ? a.years : NaN; const n = digits(insurer);
    const inc = val('hk-income-level') || 'ippan'; const incNote = (/^genzai/.test(inc) || inc === 'itteijoh') && (type === 'elderly' || n.startsWith('39') || is75(birth, ref) || is70to74(birth, ref)) ? '・所得区分' : '';
    if (type === 'labor') return '労災のため0%'; if (type === 'auto') return '自賠責のため0%'; if (type === 'self_pay') return '自費のため100%';
    if (type === 'elderly' || n.startsWith('39')) return '後期高齢者医療の暫定デフォルト' + incNote;
    if (is75(birth, ref) || is70to74(birth, ref)) return age + '歳の年齢デフォルト' + incNote;
    if (isPreschool(birth, ref)) return '就学前の年齢デフォルト';
    return Number.isFinite(age) ? age + '歳の年齢デフォルト' : '年齢未取得のデフォルト';
  }
  function updateAutoFields(force, syncType) {
    const inp = $('insurance-insurer-number'), type = $('insurance-type'), burden = $('insurance-burden-ratio'), hint = $('insurance-auto-hint');
    if (!inp || !type || !burden) return;
    const n = digits(inp.value).slice(0, 8); inp.value = n;
    if (force || (syncType && n.length >= 2)) type.value = inferInsuranceType(n);
    const p = cur();
    if (force || !burdenManual) burden.value = String(inferBurden(p, type.value, n));
    if (hint) { const label = type.options[type.selectedIndex] ? type.options[type.selectedIndex].textContent : ''; hint.textContent = label + ' / ' + burden.value + '%で自動判定（' + burdenReason(p, type.value, n) + '）'; }
  }
  function setInsurerError(msg) {
    const i = $('insurance-insurer-number'), e = $('insurance-insurer-number-error');
    if (i) i.classList.toggle('field-invalid', !!msg);
    if (e) { e.textContent = msg; e.classList.toggle('hidden', !msg); }
  }
  function validateInsurer(showEmpty) {
    const i = $('insurance-insurer-number'); if (!i) return true;
    const n = digits(i.value).slice(0, 8); i.value = n;
    const ok = n.length === 6 || n.length === 8;
    setInsurerError(!ok && (showEmpty || n.length > 0) ? '6文字もしくは8文字で入力してください。' : '');
    return ok;
  }
  function updateReduction() {
    const t = val('insurance-reduction-type'), r = $('insurance-reduction-ratio'); if (!r) return;
    if (t === 'reduction') { r.disabled = false; r.placeholder = '%'; } else if (t === 'exemption') { r.value = '100'; r.disabled = true; } else { r.value = ''; r.placeholder = ''; r.disabled = true; }
  }
  function updateWorkersCompFields() {
    const isW = val('insurance-type') === 'labor'; const isAc = isW && val('workers-claim-type') === 'aftercare';
    const sec = $('workers-comp-fields'); if (sec) sec.classList.toggle('hidden', !isW);
    if (sec && sec.parentElement) sec.parentElement.querySelectorAll('.insurance-form-row').forEach((row, i) => { if (i > 0) row.classList.toggle('hidden', isW); });
    const title = document.querySelector('#insurance-modal .modal-header h3');
    const editing = !!(editingInsuranceId || editingInsuranceRousaiIdx !== null);
    if (title) title.textContent = isW ? (isAc ? (editing ? 'アフターケア編集' : 'アフターケア追加') : (editing ? '労災保険編集' : '労災保険追加')) : (editing ? '医療保険編集' : '保険証追加');
    if (sec) { sec.querySelectorAll('.workers-standard-only').forEach((e) => e.classList.toggle('hidden', isAc)); sec.querySelectorAll('.workers-aftercare-only').forEach((e) => e.classList.toggle('hidden', !isAc)); }
    const initial = !isAc && ['1', '3', '7'].includes(val('workers-new-continuing-code'));
    ['workers-labor-bureau-code', 'workers-inspection-office-code', 'workers-business-name', 'workers-business-address'].forEach((id) => { const e = $(id); const l = e && e.closest('label'); if (l) l.classList.toggle('workers-initial-required', isW && initial); });
  }
  function populateInsurance(ins) {
    setVal('insurance-type', ins.insuranceType || inferInsuranceType(ins.insurerNumber || ''));
    setVal('insurance-insurer-number', digits(ins.insurerNumber).slice(0, 8));
    setVal('insurance-qualification-unknown-reason', ins.qualificationUnknownReason || ''); setVal('insurance-qualification-unknown-detail', ins.qualificationUnknownDetail || '');
    setVal('insurance-symbol', ins.symbol || ''); setVal('insurance-number', ins.number || ''); setVal('insurance-branch-number', digits(ins.branchNumber).slice(0, 2));
    const rel = document.querySelector('input[name="insurance-relationship"][value="' + (ins.relationship === 'family' ? 'family' : 'main') + '"]'); if (rel) rel.checked = true;
    setVal('insurance-valid-from', slash(ins.validFrom) || fmtInput(new Date())); setVal('insurance-valid-until', slash(ins.validUntil));
    setVal('insurance-limit-category', ins.limitCategory || ''); setVal('insurance-burden-ratio', ins.burdenRatio != null && ins.burdenRatio !== '' ? ins.burdenRatio : 30);
    setVal('insurance-qualification-acquired-date', slash(ins.qualificationAcquiredDate)); setVal('insurance-holder-name', ins.holderName || '');
    setVal('insurance-reduction-type', ins.reductionType || ''); setVal('insurance-reduction-ratio', ins.reductionRatio != null ? ins.reductionRatio : '');
    setVal('insurance-facility-status', ins.facilityEntryStatus || ''); setVal('insurance-facility-valid-from', slash(ins.facilityValidFrom)); setVal('insurance-facility-valid-until', slash(ins.facilityValidUntil));
    updateReduction(); burdenManual = true; updateAutoFields(false, false); updateWorkersCompFields();
  }
  function populateWorkersComp(r) {
    setVal('insurance-type', 'labor');
    setVal('workers-claim-type', r.claimType || 'medical'); setVal('workers-accident-type', r.formType === '16-3' ? '3' : '1'); setVal('workers-form-type', r.sheetType || '3');
    setVal('workers-new-continuing-code', r.newContinuing || '1'); setVal('workers-outcome-code', r.outcome || '3');
    setVal('workers-labor-insurance-number', digits(r.no).slice(0, 14)); setVal('workers-pension-certificate-number', digits(r.pensionNo).slice(0, 9));
    setVal('workers-injury-date', slash(r.accidentDate)); setVal('workers-same-injury-count', digits(r.sameInjuryCount).slice(0, 2));
    setVal('workers-labor-bureau-code', digits(r.bureauCode).slice(0, 2)); setVal('workers-inspection-office-code', digits(r.officeCode).slice(0, 2));
    setVal('workers-business-name', r.office || ''); setVal('workers-business-address', r.officeAddr || '');
    setVal('workers-aftercare-disease-code', digits(r.acDiseaseCode).slice(0, 2)); setVal('workers-aftercare-handbook-number', digits(r.acHandbookNo).slice(0, 13)); setVal('workers-aftercare-previous-examination-date', slash(r.acPrevExamDate));
    setVal('workers-worker-kana', r.workerKana || ''); setVal('workers-injury-course', r.course || '');
    setVal('insurance-valid-from', slash(r.startDate) || fmtInput(new Date())); setVal('insurance-burden-ratio', 0);
    burdenManual = true; updateWorkersCompFields();
  }
  function openInsurance(id, opts = {}) {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    ensureModals();
    const form = $('insurance-form'); if (form) form.reset();
    const ins = id ? viewInsurances(p).find((i) => String(i.id) === String(id)) : null;
    if (id && !ins) { toast('編集する医療保険を取得できませんでした。再読み込みしてください'); return; }
    editingInsuranceId = ins ? ins.id : null; editingInsuranceRousaiIdx = (opts.rousaiIdx != null) ? opts.rousaiIdx : null;
    const title = document.querySelector('#insurance-modal .modal-header h3'); if (title) title.textContent = (editingInsuranceId || editingInsuranceRousaiIdx !== null) ? '医療保険編集' : '保険証追加';
    modeButtons('btn-insurance-save', 'btn-insurance-delete', !!(editingInsuranceId || editingInsuranceRousaiIdx !== null));
    const main = document.querySelector('input[name="insurance-relationship"][value="main"]'); if (main) main.checked = true;
    setVal('insurance-valid-from', fmtInput(new Date()));
    const pt = $('insurance-modal-patient'); if (pt) pt.textContent = patientSummary(p);
    setVal('hk-income-level', p.incomeLevel || 'ippan');
    if (ins) populateInsurance(ins);
    else if (editingInsuranceRousaiIdx !== null) populateWorkersComp(rousaiList(p)[editingInsuranceRousaiIdx] || {});
    else {
      burdenManual = false; updateAutoFields(true);
      setVal('workers-accident-type', '1'); setVal('workers-claim-type', 'medical'); setVal('workers-form-type', '3'); setVal('workers-new-continuing-code', '1'); setVal('workers-outcome-code', '3');
      setVal('workers-injury-date', fmtInput(new Date())); setVal('workers-worker-kana', p.nameKana || '');
      updateWorkersCompFields();
    }
    setInsurerError(''); updateReduction();
    show('insurance-modal');
    if (opts.reader) attachReader('insurance-modal'); else detachReader();
    const first = val('insurance-type') === 'labor' ? $('workers-claim-type') : $('insurance-insurer-number'); if (first && !opts.reader) first.focus();
  }
  function buildInsurance(existing) {
    const rel = (document.querySelector('input[name="insurance-relationship"]:checked') || {}).value || 'main';
    const rr = digits(val('insurance-reduction-ratio'));
    return Object.assign({}, existing || {}, {
      id: existing ? existing.id : uid(), insuranceType: val('insurance-type') || 'social', insurerNumber: digits(val('insurance-insurer-number')),
      qualificationUnknownReason: val('insurance-qualification-unknown-reason'), qualificationUnknownDetail: val('insurance-qualification-unknown-detail'),
      symbol: val('insurance-symbol').trim(), number: val('insurance-number').trim(), branchNumber: digits(val('insurance-branch-number')), relationship: rel,
      burdenRatio: Number(val('insurance-burden-ratio') || 30), validFrom: parseDate(val('insurance-valid-from')) || '', validUntil: parseDate(val('insurance-valid-until')) || '',
      limitCategory: val('insurance-limit-category'), qualificationAcquiredDate: parseDate(val('insurance-qualification-acquired-date')) || '', holderName: val('insurance-holder-name').trim(),
      reductionType: val('insurance-reduction-type'), reductionRatio: rr ? Number(rr) : null, facilityEntryStatus: val('insurance-facility-status'),
      facilityValidFrom: parseDate(val('insurance-facility-valid-from')) || '', facilityValidUntil: parseDate(val('insurance-facility-valid-until')) || '',
      insurerName: existing ? (existing.insurerName || '') : '', limitCertificateNumber: existing ? (existing.limitCertificateNumber || '') : '',
      insurerAddress: existing ? (existing.insurerAddress || '') : '', workplaceName: existing ? (existing.workplaceName || '') : '', workplaceAddress: existing ? (existing.workplaceAddress || '') : '',
      isPrimary: existing ? existing.isPrimary !== false : true, isActive: true, updatedAt: new Date().toISOString(),
    });
  }
  function buildWorkersComp(existing) {
    const acc = val('workers-accident-type') || '1';
    return Object.assign({}, existing || {}, {
      id: (existing && existing.id) || uid(), claimType: val('workers-claim-type') || 'medical', formType: acc === '3' ? '16-3' : '5', sheetType: val('workers-form-type') || '3',
      newContinuing: val('workers-new-continuing-code') || '1', outcome: val('workers-outcome-code') || '3',
      no: digits(val('workers-labor-insurance-number')), pensionNo: digits(val('workers-pension-certificate-number')), accidentDate: parseDate(val('workers-injury-date')) || '',
      sameInjuryCount: digits(val('workers-same-injury-count')), bureauCode: digits(val('workers-labor-bureau-code')), officeCode: digits(val('workers-inspection-office-code')),
      office: val('workers-business-name').trim(), officeAddr: val('workers-business-address').trim(),
      acDiseaseCode: digits(val('workers-aftercare-disease-code')), acHandbookNo: digits(val('workers-aftercare-handbook-number')), acPrevExamDate: parseDate(val('workers-aftercare-previous-examination-date')) || '',
      workerKana: val('workers-worker-kana').trim(), course: val('workers-injury-course').trim(), startDate: parseDate(val('insurance-valid-from')) || (existing && existing.startDate) || '',
    });
  }
  function validateWorkersComp(r) {
    if (r.claimType === 'aftercare') {
      if (!r.acDiseaseCode || r.acDiseaseCode.length !== 2) return ['アフターケア対象傷病コードを2桁で入力してください', 'workers-aftercare-disease-code'];
      if (!r.acHandbookNo || r.acHandbookNo.length !== 13) return ['アフターケア手帳番号を13桁で入力してください', 'workers-aftercare-handbook-number'];
      if (!r.workerKana) return ['被災労働者カナを入力してください', 'workers-worker-kana'];
      if (!r.course) return ['傷病の経過を入力してください', 'workers-injury-course'];
      return null;
    }
    if (!r.no && !r.pensionNo) return ['労働保険番号または年金証書番号を入力してください', 'workers-labor-insurance-number'];
    if (r.no && r.no.length !== 14) return ['労働保険番号は14桁で入力してください', 'workers-labor-insurance-number'];
    if (!r.pensionNo && !r.accidentDate) return ['負傷年月日を入力してください', 'workers-injury-date'];
    if (!r.workerKana) return ['被災労働者カナを入力してください', 'workers-worker-kana'];
    if (!r.course) return ['負傷から初診までの経過を入力してください', 'workers-injury-course'];
    if (['1', '3', '7'].includes(r.newContinuing)) {
      if (!r.bureauCode || r.bureauCode.length !== 2) return ['労働局コードを2桁で入力してください', 'workers-labor-bureau-code'];
      if (!r.officeCode || r.officeCode.length !== 2) return ['労基署コードを2桁で入力してください', 'workers-inspection-office-code'];
      if (!r.office) return ['事業場名称を入力してください', 'workers-business-name'];
      if (!r.officeAddr) return ['事業場所在地を入力してください', 'workers-business-address'];
    }
    return null;
  }
  function saveInsurance() {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    const isW = val('insurance-type') === 'labor';
    if (!isW) updateAutoFields();
    if (!isW && !validateInsurer(true)) { const e = $('insurance-insurer-number'); if (e) e.focus(); return; }
    if (!parseDate(val('insurance-valid-from'))) { toast('有効期間の開始日を入力してください'); return; }
    materialize(p);
    if (isW) {
      const existing = editingInsuranceRousaiIdx !== null ? rousaiList(p)[editingInsuranceRousaiIdx] : null;
      const r = buildWorkersComp(existing);
      const err = validateWorkersComp(r); if (err) { toast(err[0]); const e = $(err[1]); if (e) e.focus(); return; }
      if (!Array.isArray(p.rousai)) p.rousai = [];
      if (existing) p.rousai[editingInsuranceRousaiIdx] = r; else p.rousai.push(r);
      if (editingInsuranceId) p.insurances = p.insurances.filter((i) => String(i.id) !== String(editingInsuranceId));   // 医療保険から労災へ種別を変えたとき
      sortRousai(p);
      const edited = !!existing; closeInsurance(); persist(p, edited ? '労災保険を更新しました' : '労災保険を登録しました'); return;
    }
    if (!val('insurance-number').trim()) { toast('番号を入力してください'); return; }
    const existing = editingInsuranceId ? p.insurances.find((i) => String(i.id) === String(editingInsuranceId)) : null;
    const ins = buildInsurance(existing);
    if (ins.insuranceType === 'auto') ins.isPrimary = false;
    p.incomeLevel = val('hk-income-level') || p.incomeLevel || 'ippan';
    if (existing) Object.assign(existing, ins);
    else { if (ins.isPrimary) p.insurances.forEach((i) => { if (!isLaborAuto(i)) i.isPrimary = false; }); p.insurances.unshift(ins); }
    if (editingInsuranceRousaiIdx !== null && Array.isArray(p.rousai)) { p.rousai.splice(editingInsuranceRousaiIdx, 1); if (!p.rousai.length) p.rousai = null; }   // 労災から医療保険へ種別を変えたとき
    closeInsurance(); persist(p, existing ? '医療保険を更新しました' : '医療保険を登録しました');
  }
  async function deleteInsurance() {
    const p = cur(); if (!p) return;
    if (editingInsuranceRousaiIdx !== null) { if (!(await confirmDelete('労災保険を削除してよろしいですか？'))) return; materialize(p); p.rousai.splice(editingInsuranceRousaiIdx, 1); if (!p.rousai.length) p.rousai = null; closeInsurance(); persist(p, '労災保険を削除しました'); return; }
    if (!editingInsuranceId) return;
    if (!(await confirmDelete('医療保険を削除してよろしいですか？'))) return;
    materialize(p);
    const gone = p.insurances.find((i) => String(i.id) === String(editingInsuranceId));
    p.insurances = p.insurances.filter((i) => String(i.id) !== String(editingInsuranceId));
    if (gone && gone.isPrimary && !p.insurances.some((i) => !isLaborAuto(i) && i.isPrimary)) { const next = p.insurances.find((i) => !isLaborAuto(i) && isCurrent(i)); if (next) next.isPrimary = true; }
    closeInsurance(); persist(p, '医療保険を削除しました');
  }
  function closeInsurance() { setInsurerError(''); editingInsuranceId = null; editingInsuranceRousaiIdx = null; hide('insurance-modal'); }

  // ===================== 公費 =====================
  let editingPublicId = null;
  function applyTypeFromPayer() {
    const inp = $('public-expense-payer-number'), sel = $('public-expense-type'); if (!inp || !sel || inp.disabled) return;
    const n = digits(inp.value).slice(0, 8); if (inp.value !== n) inp.value = n;
    const law = n.slice(0, 2);
    if (law.length !== 2) { sel.value = ''; return; }
    const opt = Array.from(sel.options).find((o) => o.dataset && o.dataset.lawNumber === law);
    sel.value = opt ? opt.value : '';
  }
  function updatePublicDisabled() {
    const noPayer = !!($('public-expense-no-payer-number') || {}).checked, later = !!($('public-expense-confirm-later') || {}).checked;
    const pay = $('public-expense-payer-number'), rec = $('public-expense-recipient-number');
    if (pay) { pay.disabled = noPayer; if (noPayer) pay.value = ''; }
    if (rec) { rec.disabled = later; if (later) rec.value = ''; }
  }
  const BURDEN_IDS = ['public-expense-ratio-per-visit', 'public-expense-amount-per-visit', 'public-expense-subsidy-limit', 'public-expense-amount-per-day', 'public-expense-count-per-day', 'public-expense-amount-per-month', 'public-expense-count-per-month', 'public-expense-days-per-month'];
  function updatePublicBurden() {
    const has = (document.querySelector('input[name="public-expense-burden-mode"]:checked') || {}).value === 'has';
    BURDEN_IDS.forEach((id) => { const e = $(id); if (!e) return; e.disabled = !has; if (!has) e.value = ''; });
  }
  function renderMunicipality() { const s = $('public-expense-municipality'); if (!s) return; s.innerHTML = '<option value="">市町村差分なし</option>'; s.disabled = true; const n = $('public-expense-rule-note'); if (n) n.textContent = ''; }
  function openPublicExpense(id, opts = {}) {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    ensureModals();
    const form = $('public-expense-form'); if (form) form.reset();
    const e = id ? viewPublic(p).find((x) => String(x.id) === String(id)) : null;
    if (id && !e) { toast('編集する公費を取得できませんでした。再読み込みしてください'); return; }
    editingPublicId = e ? e.id : null;
    const title = document.querySelector('#public-expense-modal .modal-header h3'); if (title) title.textContent = editingPublicId ? '公費編集' : '公費追加';
    modeButtons('btn-public-expense-save', 'btn-public-expense-delete', !!editingPublicId);
    const none = document.querySelector('input[name="public-expense-burden-mode"][value="none"]'); if (none) none.checked = true;
    setVal('public-expense-valid-from', fmtInput(new Date()));
    const pt = $('public-expense-modal-patient'); if (pt) pt.textContent = patientSummary(p);
    renderMunicipality();
    if (e) {
      const np = $('public-expense-no-payer-number'), cl = $('public-expense-confirm-later');
      if (np) np.checked = !!e.noPayerNumber || !e.payerNumber; if (cl) cl.checked = !!e.confirmLater || !e.recipientNumber;
      setVal('public-expense-payer-number', digits(e.payerNumber).slice(0, 8)); setVal('public-expense-type', e.type || '');
      setVal('public-expense-recipient-number', digits(e.recipientNumber).slice(0, 7));
      setVal('public-expense-valid-from', slash(e.validFrom) || fmtInput(new Date())); setVal('public-expense-valid-until', slash(e.validUntil));
      setVal('public-expense-claim-target', e.claimTarget || 'medical'); setVal('public-expense-prescription-claim-target', e.prescriptionClaimTarget || 'same_as_medical');
      setVal('public-expense-manual-note', e.manualNote || '');
      const has = ['burdenRatio', 'monthlyLimit', 'dailyLimit', 'perVisitLimit', 'countLimitPerDay', 'countLimitPerMonth', 'dayLimitPerMonth'].some((k) => e[k] != null && e[k] !== '');
      const r = document.querySelector('input[name="public-expense-burden-mode"][value="' + (has ? 'has' : 'none') + '"]'); if (r) r.checked = true;
      setVal('public-expense-ratio-per-visit', e.burdenRatio ?? ''); setVal('public-expense-amount-per-visit', e.perVisitLimit ?? ''); setVal('public-expense-subsidy-limit', '');
      setVal('public-expense-amount-per-day', e.dailyLimit ?? ''); setVal('public-expense-count-per-day', e.countLimitPerDay ?? ''); setVal('public-expense-amount-per-month', e.monthlyLimit ?? '');
      setVal('public-expense-count-per-month', e.countLimitPerMonth ?? ''); setVal('public-expense-days-per-month', e.dayLimitPerMonth ?? '');
      updatePublicDisabled(); updatePublicBurden();
      // 数値は負担ありのときだけ残る（updatePublicBurden で消えるので入れ直す）
      if (has) { setVal('public-expense-ratio-per-visit', e.burdenRatio ?? ''); setVal('public-expense-amount-per-visit', e.perVisitLimit ?? ''); setVal('public-expense-amount-per-day', e.dailyLimit ?? ''); setVal('public-expense-count-per-day', e.countLimitPerDay ?? ''); setVal('public-expense-amount-per-month', e.monthlyLimit ?? ''); setVal('public-expense-count-per-month', e.countLimitPerMonth ?? ''); setVal('public-expense-days-per-month', e.dayLimitPerMonth ?? ''); }
    } else {
      setVal('public-expense-claim-target', 'medical'); setVal('public-expense-prescription-claim-target', 'same_as_medical');
      updatePublicDisabled(); updatePublicBurden();
    }
    show('public-expense-modal');
    if (opts.reader) attachReader('public-expense-modal'); else detachReader();
    const f = $('public-expense-payer-number'); if (f && !opts.reader) f.focus();
  }
  function savePublicExpense() {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    const sel = $('public-expense-type'); const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
    const has = (document.querySelector('input[name="public-expense-burden-mode"]:checked') || {}).value === 'has';
    const noPayer = !!($('public-expense-no-payer-number') || {}).checked, later = !!($('public-expense-confirm-later') || {}).checked;
    const num = (id) => has ? numOrNull(id) : null;
    const payer = noPayer ? '' : digits(val('public-expense-payer-number')), rec = later ? '' : digits(val('public-expense-recipient-number'));
    const type = val('public-expense-type');
    if (!type) { toast('公費の種類を選択してください'); return; }
    if (!noPayer && (!payer || !(payer.length === 2 || payer.length === 8))) { toast('負担者番号は2桁または8桁で入力してください'); return; }
    if (!later && (!rec || rec.length !== 7)) { toast('受給者番号は7桁で入力してください'); return; }
    const from = parseDate(val('public-expense-valid-from'));
    if (!from) { toast('有効期間の開始日を入力してください'); return; }
    const ratio = num('public-expense-ratio-per-visit');
    if (ratio != null && (ratio < 0 || ratio > 100)) { toast('負担割合は0〜100で入力してください'); return; }
    materialize(p);
    const existing = editingPublicId ? p.publicExpenses.find((x) => String(x.id) === String(editingPublicId)) : null;
    const e = Object.assign({}, existing || {}, {
      id: existing ? existing.id : uid(), type, typeCode: (opt && opt.dataset.lawNumber) || '', payerNumber: payer, noPayerNumber: noPayer, municipality: val('public-expense-municipality'),
      recipientNumber: rec, confirmLater: later, validFrom: from, validUntil: parseDate(val('public-expense-valid-until')) || '',
      burdenRatio: ratio, perVisitLimit: num('public-expense-amount-per-visit'), dailyLimit: num('public-expense-amount-per-day'), monthlyLimit: num('public-expense-amount-per-month'),
      countLimitPerDay: num('public-expense-count-per-day'), countLimitPerMonth: num('public-expense-count-per-month'), dayLimitPerMonth: num('public-expense-days-per-month'),
      claimTarget: val('public-expense-claim-target') || 'medical', prescriptionClaimTarget: val('public-expense-prescription-claim-target') || 'same_as_medical',
      payerNumberAbsentReason: noPayer ? '負担者番号なし' : '', manualNote: val('public-expense-manual-note').trim(),
      priority: existing ? (existing.priority || p.publicExpenses.length) : p.publicExpenses.length + 1, isActive: true, updatedAt: new Date().toISOString(),
    });
    if (existing) Object.assign(existing, e); else p.publicExpenses.push(e);
    closePublic(); persist(p, existing ? '公費を更新しました' : '公費を登録しました');
  }
  async function deletePublicExpense() {
    const p = cur(); if (!p || !editingPublicId) return;
    if (!(await confirmDelete('公費を削除してよろしいですか？'))) return;
    materialize(p);
    p.publicExpenses = p.publicExpenses.filter((x) => String(x.id) !== String(editingPublicId));
    p.publicExpenses.slice().sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99)).forEach((x, i) => { x.priority = i + 1; });
    closePublic(); persist(p, '公費を削除しました');
  }
  function closePublic() { editingPublicId = null; hide('public-expense-modal'); }

  // ===================== 労災（労災保険の小窓）・自賠責 =====================
  let editingRousaiIdx = null, editingAutoId = null;
  function updatePolicyNumberState() {
    const b = val('workers-policy-benefit-type') || 'short_term', later = !!($('workers-policy-confirm-later') || {}).checked, inp = $('workers-policy-number'); if (!inp) return;
    inp.maxLength = b === 'injury_pension' ? 9 : 14; inp.placeholder = b === 'injury_pension' ? '年金証書番号' : '14桁の労働保険番号'; inp.disabled = later; if (later) inp.value = '';
  }
  const initialMonth = (v) => { const n = String(v || '').trim().replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); const m = n.match(/^(\d{4})(?:\([^)]*\))?[^0-9]+(\d{1,2})/); return m ? m[1] + '/' + String(Number(m[2])).padStart(2, '0') : ''; };
  function openLaborAutoEditor(key) {
    const p = cur(); if (!p) return;
    if (String(key).startsWith('rs:')) {
      const idx = Number(key.slice(3)); const r = rousaiList(p)[idx];
      if (!r) { toast('編集する労災・自賠責情報を取得できませんでした。再読み込みしてください'); return; }
      if (r.claimType === 'aftercare') return openInsurance(null, { rousaiIdx: idx });
      return openWorkers(idx);
    }
    return openAuto(String(key).slice(3));
  }
  function openWorkers(idx) {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    ensureModals();
    const form = $('workers-insurance-form'); if (form) form.reset();
    const r = (idx != null) ? rousaiList(p)[idx] : null;
    editingRousaiIdx = r ? idx : null;
    const title = document.querySelector('#workers-insurance-modal .modal-header h3'); if (title) title.textContent = r ? '労災保険編集' : '労災保険追加';
    modeButtons('btn-workers-insurance-save', 'btn-workers-insurance-delete', !!r);
    const pt = $('workers-insurance-modal-patient'); if (pt) pt.textContent = patientSummary(p);
    const t = fmtInput(new Date());
    setVal('workers-policy-benefit-type', 'short_term'); setVal('workers-policy-accident-type', '1'); setVal('workers-policy-injury-date', t); setVal('workers-policy-treatment-start', t);
    setVal('workers-policy-treatment-end', ''); setVal('workers-policy-new-continuing', '1'); setVal('workers-policy-outcome', '3'); setVal('workers-policy-limb-addition', 'none');
    setVal('workers-policy-initial-month', today().slice(0, 7).replace('-', '/')); setVal('workers-policy-business-prefecture', ''); setVal('workers-policy-bureau-prefecture', ''); renderOfficeOptions('');
    setVal('hk-rs-claim-type', 'medical'); setVal('hk-rs-resubmit', '');
    if (r) {
      const b = (r.benefitType === 'injury_pension' || (r.pensionNo && !r.no)) ? 'injury_pension' : 'short_term';
      setVal('workers-policy-benefit-type', b); setVal('workers-policy-number', b === 'injury_pension' ? digits(r.pensionNo).slice(0, 9) : digits(r.no).slice(0, 14));
      const cl = $('workers-policy-confirm-later'); if (cl) cl.checked = !!r.confirmLater;
      setVal('workers-policy-accident-type', r.formType === '16-3' ? '3' : '1'); setVal('workers-policy-injury-date', slash(r.accidentDate));
      setVal('workers-policy-treatment-start', slash(r.startDate)); setVal('workers-policy-treatment-end', slash(r.endDate));
      setVal('workers-policy-new-continuing', r.newContinuing || '1'); setVal('workers-policy-outcome', r.outcome || '3'); setVal('workers-policy-limb-addition', r.limbAddition || 'none');
      setVal('workers-policy-business-name', r.office || '');
      const bp = r.officePref ? String(r.officePref).padStart(2, '0') : ''; const bpName = (OFFICES[bp] && OFFICES[bp].prefecture) || '';
      let addr = r.officeAddrDetail || r.officeAddr || ''; if (!r.officeAddrDetail && bpName && addr.startsWith(bpName)) addr = addr.slice(bpName.length);
      setVal('workers-policy-business-prefecture', OFFICES[bp] ? bp : ''); setVal('workers-policy-business-address', addr);
      const bu = r.bureauCode ? String(r.bureauCode).padStart(2, '0') : ''; setVal('workers-policy-bureau-prefecture', OFFICES[bu] ? bu : ''); renderOfficeOptions(OFFICES[bu] ? bu : '', r.officeCode || '');
      setVal('workers-policy-initial-month', initialMonth(r.initialMonth || r.startDate || ''));
      setVal('hk-rs-part', r.part || ''); setVal('hk-rs-disease', r.disease || ''); setVal('hk-rs-course', r.course || ''); setVal('hk-rs-claim-type', r.claimType || 'medical');
      setVal('hk-rs-resubmit', r.resubmit ? '1' : ''); setVal('hk-rs-receipt-no', r.receiptNo || ''); setVal('hk-rs-ac-handbook', r.acHandbookNo || ''); setVal('hk-rs-ac-disease', r.acDiseaseCode || '');
      setVal('hk-rs-ac-prev', slash(r.acPrevExamDate)); setVal('hk-rs-note', r.note || '');
    }
    updatePolicyNumberState();
    show('workers-insurance-modal');
    const f = $('workers-policy-benefit-type'); if (f) f.focus();
  }
  function saveWorkers() {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    const existing = editingRousaiIdx !== null ? rousaiList(p)[editingRousaiIdx] : null;
    const b = val('workers-policy-benefit-type') || 'short_term', later = !!($('workers-policy-confirm-later') || {}).checked, num = digits(val('workers-policy-number'));
    const start = parseDate(val('workers-policy-treatment-start')), end = parseDate(val('workers-policy-treatment-end')), injury = parseDate(val('workers-policy-injury-date'));
    const bp = val('workers-policy-business-prefecture'), bpName = (OFFICES[bp] && OFFICES[bp].prefecture) || '', detail = val('workers-policy-business-address').trim();
    const bu = val('workers-policy-bureau-prefecture'), office = val('workers-policy-office');
    const im = val('workers-policy-initial-month');
    if (!later) {
      if (b === 'short_term' && num.length !== 14) return err('労保番号は14桁で入力してください', 'workers-policy-number');
      if (b === 'injury_pension' && (num.length < 1 || num.length > 9)) return err('年金番号は9桁以内で入力してください', 'workers-policy-number');
    }
    if (b === 'short_term' && !injury) return err('傷病年月日を入力してください', 'workers-policy-injury-date');
    if (!start) return err('療養期間の開始日を入力してください', 'workers-policy-treatment-start');
    if (end && end < start) return err('療養期間の終了日は開始日以降にしてください', 'workers-policy-treatment-end');
    if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(im)) return err('初回診療年月はyyyy/mmで入力してください', 'workers-policy-initial-month');
    const r = Object.assign({}, existing || {}, {
      id: (existing && existing.id) || uid(), benefitType: b, confirmLater: later,
      no: b === 'short_term' && !later ? num : '', pensionNo: b === 'injury_pension' && !later ? num : '',
      formType: val('workers-policy-accident-type') === '3' ? '16-3' : '5', accidentDate: injury || '', startDate: start, endDate: end || '',
      newContinuing: val('workers-policy-new-continuing') || '1', outcome: val('workers-policy-outcome') || '3', limbAddition: val('workers-policy-limb-addition') || 'none',
      office: val('workers-policy-business-name').trim(), officePref: bp, officeAddrDetail: detail, officeAddr: (bpName + detail) || '',
      bureauCode: bu, officeCode: office, kantoku: (office && OFFICES[bu]) ? ((OFFICES[bu].offices.find((o) => o.code === office) || {}).name || '').replace(/労働基準監督署.*$/, '') : (existing ? existing.kantoku || '' : ''),
      initialMonth: im, workerKana: (existing && existing.workerKana) || p.nameKana || '',
      part: val('hk-rs-part').trim(), disease: val('hk-rs-disease').trim(), course: val('hk-rs-course').trim(), claimType: val('hk-rs-claim-type') || 'medical',
      resubmit: val('hk-rs-resubmit') === '1', receiptNo: val('hk-rs-receipt-no').trim(), acHandbookNo: digits(val('hk-rs-ac-handbook')), acDiseaseCode: digits(val('hk-rs-ac-disease')),
      acPrevExamDate: parseDate(val('hk-rs-ac-prev')) || '', note: val('hk-rs-note').trim(),
    });
    if (!Array.isArray(p.rousai)) p.rousai = [];
    if (existing) p.rousai[editingRousaiIdx] = r; else p.rousai.push(r);
    sortRousai(p);
    closeWorkers(); persist(p, existing ? '労災保険を更新しました' : '労災保険を登録しました');
  }
  function err(msg, id) { toast(msg); const e = $(id); if (e) e.focus(); return null; }
  async function deleteWorkers() {
    const p = cur(); if (!p || editingRousaiIdx === null) return;
    if (!(await confirmDelete('労災保険を削除してよろしいですか？'))) return;
    p.rousai.splice(editingRousaiIdx, 1); if (!p.rousai.length) p.rousai = null;
    closeWorkers(); persist(p, '労災保険を削除しました');
  }
  function closeWorkers() { editingRousaiIdx = null; hide('workers-insurance-modal'); }
  function openAuto(id) {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    ensureModals();
    const form = $('auto-insurance-form'); if (form) form.reset();
    const ins = id ? list(p, 'insurances').find((i) => String(i.id) === String(id)) : null;
    editingAutoId = ins ? ins.id : null;
    const title = document.querySelector('#auto-insurance-modal .modal-header h3'); if (title) title.textContent = ins ? '自賠責保険編集' : '自賠責保険追加';
    modeButtons('btn-auto-insurance-save', 'btn-auto-insurance-delete', !!ins);
    const pt = $('auto-insurance-modal-patient'); if (pt) pt.textContent = patientSummary(p);
    const t = fmtInput(new Date());
    setVal('auto-policy-patient-claim', 'no_claim'); setVal('auto-policy-injury-date', t); setVal('auto-policy-treatment-start', t); setVal('auto-policy-treatment-end', '');
    setVal('auto-policy-outcome', '3'); setVal('auto-policy-limb-addition', 'none'); setVal('auto-policy-insurer-name', '');
    const ws = document.querySelector('input[name="auto-policy-calculation-standard"][value="workers"]'); if (ws) ws.checked = true;
    if (ins) {
      const a = ins.autoDetails || {};
      setVal('auto-policy-patient-claim', a.patientClaimMode || 'no_claim'); setVal('auto-policy-injury-date', slash(a.injuryDate));
      setVal('auto-policy-treatment-start', slash(ins.validFrom)); setVal('auto-policy-treatment-end', slash(ins.validUntil));
      setVal('auto-policy-outcome', a.outcomeCode || '3'); setVal('auto-policy-limb-addition', a.limbAdditionType || 'none'); setVal('auto-policy-insurer-name', ins.insurerName || '');
      const s = document.querySelector('input[name="auto-policy-calculation-standard"][value="' + (['workers', 'health'].includes(a.calculationStandard) ? a.calculationStandard : 'workers') + '"]'); if (s) s.checked = true;
    }
    show('auto-insurance-modal');
    const f = $('auto-policy-patient-claim'); if (f) f.focus();
  }
  function saveAuto() {
    const p = cur(); if (!p) { toast('患者を選択してください'); return; }
    const mode = val('auto-policy-patient-claim') || 'no_claim';
    const injText = val('auto-policy-injury-date').trim(), endText = val('auto-policy-treatment-end').trim();
    const inj = parseDate(injText), start = parseDate(val('auto-policy-treatment-start')), end = parseDate(endText), outcome = val('auto-policy-outcome') || '3';
    if (!['claim', 'no_claim'].includes(mode)) return err('患者請求を選択してください', 'auto-policy-patient-claim');
    if (injText && !inj) return err('傷病年月日を正しく入力してください', 'auto-policy-injury-date');
    if (!start) return err('療養期間の開始日を入力してください', 'auto-policy-treatment-start');
    if (endText && !end) return err('療養期間の終了日を正しく入力してください', 'auto-policy-treatment-end');
    if (end && end < start) return err('療養期間の終了日は開始日以降にしてください', 'auto-policy-treatment-end');
    if (!['1', '3', '5', '7', '9'].includes(outcome)) return err('転帰事由を選択してください', 'auto-policy-outcome');
    materialize(p);
    const existing = editingAutoId ? p.insurances.find((i) => String(i.id) === String(editingAutoId)) : null;
    const name = val('auto-policy-insurer-name').trim();
    const ins = Object.assign({}, existing || {}, {
      id: existing ? existing.id : uid(), insuranceType: 'auto', insurerNumber: '', insurerName: name, symbol: '', number: '', branchNumber: '', relationship: 'main', burdenRatio: 0,
      validFrom: start, validUntil: end || '', isPrimary: false, isActive: true, updatedAt: new Date().toISOString(),
      autoDetails: { patientClaimMode: mode, patientBilling: mode === 'claim', injuryDate: inj || '', outcomeCode: outcome, limbAdditionType: val('auto-policy-limb-addition') || 'none',
        calculationStandard: (document.querySelector('input[name="auto-policy-calculation-standard"]:checked') || {}).value || 'workers' },
    });
    if (existing) Object.assign(existing, ins); else p.insurances.push(ins);
    closeAuto(); persist(p, existing ? '自賠責保険を更新しました' : '自賠責保険を登録しました');
  }
  async function deleteAuto() {
    const p = cur(); if (!p || !editingAutoId) return;
    if (!(await confirmDelete('自賠責保険を削除してよろしいですか？'))) return;
    p.insurances = list(p, 'insurances').filter((i) => String(i.id) !== String(editingAutoId));
    closeAuto(); persist(p, '自賠責保険を削除しました');
  }
  function closeAuto() { editingAutoId = null; hide('auto-insurance-modal'); }

  // ===================== 特記事項・症状詳記・摘要欄・福祉備考・一部負担金 =====================
  const editing = { special: null, symptom: null, summary: null, welfare: null, copay: null };
  function openSimple(kind, key, id, modalId, titleId, titles, saveId, delId, fill) {
    const p = cur(); if (!p) { toast('患者を選択してください'); return null; }
    ensureModals();
    const e = id ? list(p, key).find((x) => String(x.id) === String(id)) : null;
    if (id && !e) { toast('編集する項目を取得できませんでした。再読み込みしてください'); return null; }
    editing[kind] = e ? e.id : null;
    const form = document.querySelector('#' + modalId + ' form'); if (form) form.reset();
    const t = $(titleId); if (t) t.textContent = e ? titles[1] : titles[0];
    modeButtons(saveId, delId, !!e);
    fill(e || null, p);
    show(modalId);
    return e;
  }
  function saveSimple(kind, key, obj, modalId, msgs) {
    const p = cur(); if (!p) return;
    materialize(p);
    const existing = editing[kind] ? p[key].find((x) => String(x.id) === String(editing[kind])) : null;
    const e = Object.assign({}, existing || {}, obj, { id: existing ? existing.id : uid(), isActive: true, updatedAt: new Date().toISOString() });
    if (existing) Object.assign(existing, e); else p[key].push(e);
    editing[kind] = null; hide(modalId); persist(p, existing ? msgs[1] : msgs[0]);
  }
  async function deleteSimple(kind, key, modalId, label) {
    const p = cur(); if (!p || !editing[kind]) return;
    if (!(await confirmDelete(label + 'を削除してよろしいですか？'))) return;
    p[key] = list(p, key).filter((x) => String(x.id) !== String(editing[kind]));
    editing[kind] = null; hide(modalId); persist(p, label + 'を削除しました');
  }
  function periodCheck(fromId, untilId, startMsg) {
    const from = parseDate(val(fromId)), until = parseDate(val(untilId));
    if (!from) { err(startMsg, fromId); return null; }
    if (until && until < from) { err('記載終了日は記載開始日以降を指定してください', untilId); return null; }
    return { from, until: until || '' };
  }
  function openSpecialNote(id) {
    openSimple('special', 'receiptSpecialNotes', id, 'receipt-special-note-modal', 'receipt-special-note-modal-title', ['レセプト特記事項新規追加', 'レセプト特記事項編集'], 'btn-receipt-special-note-save', 'btn-receipt-special-note-delete', (e) => {
      const s = $('receipt-special-note-code'); if (s) { s.innerHTML = SPECIAL_NOTE_TYPES.map((x) => '<option value="' + esc(x.code) + '">' + esc(x.name) + '</option>').join(''); s.value = (e && e.code) || '01'; }
      setVal('receipt-special-note-valid-from', e && e.validFrom ? fmtInput(e.validFrom) : ''); setVal('receipt-special-note-valid-until', e && e.validUntil ? fmtInput(e.validUntil) : '');
    });
    const c = $('receipt-special-note-code'); if (c && !$('receipt-special-note-modal').classList.contains('hidden')) c.focus();
  }
  function saveSpecialNote() {
    const code = val('receipt-special-note-code');
    if (!code) return err('特記事項を選択してください', 'receipt-special-note-code');
    const from = parseDate(val('receipt-special-note-valid-from')), until = parseDate(val('receipt-special-note-valid-until'));
    if (!from) return err('記載開始日を入力してください', 'receipt-special-note-valid-from');
    if (until && until < from) return err('記載終了日は記載開始日以降を指定してください', 'receipt-special-note-valid-until');
    saveSimple('special', 'receiptSpecialNotes', { code, validFrom: from, validUntil: until || '' }, 'receipt-special-note-modal', ['レセプト特記事項を登録しました', 'レセプト特記事項を更新しました']);
  }
  // 対象保険の選択肢: 社保・国保＋この患者の労災・自賠責
  function targetOptions(p) {
    const opts = [{ value: 'medical', label: '社保・国保' }];
    rousaiList(p).forEach((r) => { if (!r.id) return; const s = slashDate(r.startDate), e = slashDate(r.endDate, '9999-12-31'); opts.push({ value: String(r.id), label: '労災 ' + ((r.benefitType === 'injury_pension' || (r.pensionNo && !r.no)) ? '傷病年金' : '短期') + (s ? ' ' + s + '〜' + e : '') }); });
    list(p, 'insurances').filter((i) => String(i.insuranceType) === 'auto').forEach((i) => { const s = slashDate(i.validFrom), e = slashDate(i.validUntil, '9999-12-31'); opts.push({ value: String(i.id), label: '自賠責' + (s ? ' ' + s + '〜' + e : '') }); });
    return opts;
  }
  function renderTargetOptions(selId, p, selected) {
    const s = $(selId); if (!s) return;
    const opts = targetOptions(p); const v = selected ? String(selected) : 'medical';
    if (selected && !opts.some((o) => o.value === v)) opts.push({ value: v, label: '対象保険' });
    s.innerHTML = opts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join(''); s.value = v;
  }
  function updateKindState() {
    const kind = (document.querySelector('input[name="receipt-symptom-detail-kind"]:checked') || {}).value || 'symptom_detail';
    const c = $('receipt-symptom-detail-category'); if (!c) return;
    const inj = kind === 'injury_course'; if (inj) c.value = '90'; c.disabled = inj; c.setAttribute('aria-disabled', String(inj));
  }
  function openSymptomDetail(id) {
    const e = openSimple('symptom', 'receiptSymptomDetails', id, 'receipt-symptom-detail-modal', 'receipt-symptom-detail-modal-title', ['症状詳記・傷病の経過 新規登録', '症状詳記・傷病の経過 編集'], 'btn-receipt-symptom-detail-save', 'btn-receipt-symptom-detail-delete', (x, p) => {
      const kind = (x && x.kind) || 'symptom_detail'; const k = document.querySelector('input[name="receipt-symptom-detail-kind"][value="' + kind + '"]'); if (k) k.checked = true;
      const c = $('receipt-symptom-detail-category'); if (c) { c.innerHTML = SYMPTOM_TYPES.map((t) => '<option value="' + esc(t.code) + '">' + esc(t.code + ' ' + t.name) + '</option>').join(''); c.value = (x && x.category) || (kind === 'injury_course' ? '90' : '01'); }
      renderTargetOptions('receipt-symptom-detail-insurance', p, x && x.insurance);
      setVal('receipt-symptom-detail-content', (x && x.content) || ''); setVal('receipt-symptom-detail-valid-from', slashDate(x && x.validFrom, today())); setVal('receipt-symptom-detail-valid-until', slashDate(x && x.validUntil));
      updateKindState();
    });
    const c = $('receipt-symptom-detail-category'); if (c && !$('receipt-symptom-detail-modal').classList.contains('hidden')) (c.disabled ? $('receipt-symptom-detail-content') : c).focus();
    return e;
  }
  function saveSymptomDetail() {
    const kind = (document.querySelector('input[name="receipt-symptom-detail-kind"]:checked') || {}).value || 'symptom_detail';
    const category = kind === 'injury_course' ? '90' : val('receipt-symptom-detail-category');
    const content = val('receipt-symptom-detail-content').trim();
    if (!content) return err('記載内容を入力してください', 'receipt-symptom-detail-content');
    const per = periodCheck('receipt-symptom-detail-valid-from', 'receipt-symptom-detail-valid-until', '記載期間の開始日を入力してください'); if (!per) return;
    const ins = val('receipt-symptom-detail-insurance') || 'medical';
    saveSimple('symptom', 'receiptSymptomDetails', { kind, category, content, validFrom: per.from, validUntil: per.until, insurance: ins === 'medical' ? null : ins }, 'receipt-symptom-detail-modal', ['症状詳記を登録しました', '症状詳記を更新しました']);
  }
  function openSummaryComment(id) {
    openSimple('summary', 'receiptSummaryComments', id, 'receipt-summary-comment-modal', 'receipt-summary-comment-modal-title', ['レセプト摘要欄コメント新規登録', 'レセプト摘要欄コメント編集'], 'btn-receipt-summary-comment-save', 'btn-receipt-summary-comment-delete', (x, p) => {
      setVal('receipt-summary-comment-position', (x && x.position) || 'upper'); setVal('receipt-summary-comment-content', (x && x.content) || '');
      setVal('receipt-summary-comment-valid-from', slashDate(x && x.validFrom, today())); setVal('receipt-summary-comment-valid-until', slashDate(x && x.validUntil));
      renderTargetOptions('receipt-summary-comment-insurance', p, x && x.insurance);
    });
    const f = $('receipt-summary-comment-position'); if (f && !$('receipt-summary-comment-modal').classList.contains('hidden')) f.focus();
  }
  function saveSummaryComment() {
    const content = val('receipt-summary-comment-content').trim();
    if (!content) return err('摘要欄コメントを入力してください', 'receipt-summary-comment-content');
    const per = periodCheck('receipt-summary-comment-valid-from', 'receipt-summary-comment-valid-until', '記載期間の開始日を入力してください'); if (!per) return;
    const ins = val('receipt-summary-comment-insurance') || 'medical';
    saveSimple('summary', 'receiptSummaryComments', { position: val('receipt-summary-comment-position') || 'upper', content, validFrom: per.from, validUntil: per.until, insurance: ins === 'medical' ? null : ins }, 'receipt-summary-comment-modal', ['摘要欄コメントを登録しました', '摘要欄コメントを更新しました']);
  }
  function openWelfareComment(id) {
    openSimple('welfare', 'welfareInvoiceComments', id, 'welfare-invoice-comment-modal', 'welfare-invoice-comment-modal-title', ['福祉請求書備考欄コメント新規登録', '福祉請求書備考欄コメント編集'], 'btn-welfare-invoice-comment-save', 'btn-welfare-invoice-comment-delete', (x) => {
      setVal('welfare-invoice-comment-content', (x && x.content) || ''); setVal('welfare-invoice-comment-valid-from', slashDate(x && x.validFrom, today())); setVal('welfare-invoice-comment-valid-until', slashDate(x && x.validUntil));
    });
    const f = $('welfare-invoice-comment-content'); if (f && !$('welfare-invoice-comment-modal').classList.contains('hidden')) f.focus();
  }
  function saveWelfareComment() {
    const content = val('welfare-invoice-comment-content').trim();
    if (!content) return err('福祉請求書備考欄コメントを入力してください', 'welfare-invoice-comment-content');
    const per = periodCheck('welfare-invoice-comment-valid-from', 'welfare-invoice-comment-valid-until', '記載期間の開始日を入力してください'); if (!per) return;
    saveSimple('welfare', 'welfareInvoiceComments', { content, validFrom: per.from, validUntil: per.until }, 'welfare-invoice-comment-modal', ['福祉請求書備考欄コメントを登録しました', '福祉請求書備考欄コメントを更新しました']);
  }
  let copayRef = 0;
  // 差額の比べ先（その期間に画面で計算した保険の一部負担金）。統合版では期間の集計を持っていないので 0 から数える
  function copayReference() { return 0; }
  function updateCopayDiff() {
    const a = numOrNull('receipt-copayment-insurance-amount'); const diff = a === null ? 0 : a - Number(copayRef || 0);
    const o = $('receipt-copayment-difference'); if (o) o.textContent = '差額：' + diff.toLocaleString('ja-JP') + '円';
  }
  function monthBounds(d) { const t = parseLocal(normDate(d) || today()); return { start: localDate(new Date(t.getFullYear(), t.getMonth(), 1)), end: localDate(new Date(t.getFullYear(), t.getMonth() + 1, 0)) }; }
  function openCopayment(id) {
    openSimple('copay', 'receiptCopayments', id, 'receipt-copayment-modal', 'receipt-copayment-modal-title', ['レセプト一部負担金額欄 追加', 'レセプト一部負担金額欄 編集'], 'btn-receipt-copayment-save', 'btn-receipt-copayment-delete', (x) => {
      const b = monthBounds();
      setVal('receipt-copayment-valid-from', copayDate((x && x.validFrom) || b.start)); setVal('receipt-copayment-valid-until', copayDate((x && x.validUntil) || b.end));
      setVal('receipt-copayment-category', (x && x.category) || '00');
      COV.forEach((k, i) => setVal('receipt-copayment-covered-' + (i + 1), x && x[k] != null ? x[k] : ''));
      setVal('receipt-copayment-insurance-amount', x && x.insuranceAmount != null ? x.insuranceAmount : '');
      PUB.forEach((k, i) => setVal('receipt-copayment-public-' + (i + 1), x && x[k] != null ? x[k] : ''));
      copayRef = copayReference(); updateCopayDiff();
    });
    const f = $('receipt-copayment-valid-from'); if (f && !$('receipt-copayment-modal').classList.contains('hidden')) f.focus();
  }
  function saveCopayment() {
    const from = parseDate(val('receipt-copayment-valid-from')), until = parseDate(val('receipt-copayment-valid-until'));
    if (!from) return err('記載期間の開始日を入力してください', 'receipt-copayment-valid-from');
    if (!until) return err('記載期間の終了日を入力してください', 'receipt-copayment-valid-until');
    if (until < from) return err('記載終了日は記載開始日以降を指定してください', 'receipt-copayment-valid-until');
    const o = { validFrom: from, validUntil: until, category: val('receipt-copayment-category') || '00', insuranceAmount: numOrNull('receipt-copayment-insurance-amount') };
    COV.forEach((k, i) => { o[k] = numOrNull('receipt-copayment-covered-' + (i + 1)); });
    PUB.forEach((k, i) => { o[k] = numOrNull('receipt-copayment-public-' + (i + 1)); });
    if (!['insuranceAmount', ...COV, ...PUB].some((k) => o[k] !== null)) return err('一部負担金額を1項目以上入力してください', 'receipt-copayment-insurance-amount');
    const bad = COV.findIndex((k) => o[k] !== null && o[k] < 1);
    if (bad >= 0) return err('①～④の一部負担金額は1以上で入力してください（' + (bad + 1) + '番）', 'receipt-copayment-covered-' + (bad + 1));
    saveSimple('copay', 'receiptCopayments', o, 'receipt-copayment-modal', ['レセプト一部負担金欄を登録しました', 'レセプト一部負担金欄を更新しました']);
  }

  // ===================== 日付選択（基準版と同じ部品） =====================
  const PICKER_INPUTS = ['insurance-valid-from', 'insurance-valid-until', 'insurance-qualification-acquired-date', 'insurance-facility-valid-from', 'insurance-facility-valid-until', 'workers-injury-date',
    'workers-aftercare-previous-examination-date', 'workers-policy-injury-date', 'workers-policy-treatment-start', 'workers-policy-treatment-end', 'auto-policy-injury-date', 'auto-policy-treatment-start',
    'auto-policy-treatment-end', 'receipt-special-note-valid-from', 'receipt-special-note-valid-until', 'receipt-symptom-detail-valid-from', 'receipt-symptom-detail-valid-until',
    'receipt-summary-comment-valid-from', 'receipt-summary-comment-valid-until', 'welfare-invoice-comment-valid-from', 'welfare-invoice-comment-valid-until', 'receipt-copayment-valid-from',
    'receipt-copayment-valid-until', 'public-expense-valid-from', 'public-expense-valid-until', 'hk-rs-ac-prev'];
  let pickTarget = null, pickMonth = null;
  function initDatePicker() {
    const host = $('hokenModals');
    let pk = $('insurance-date-picker');
    if (!pk) {
      pk = document.createElement('div'); pk.id = 'insurance-date-picker'; pk.className = 'insurance-date-picker hidden';
      pk.innerHTML = '<div class="insurance-date-picker-header"><button type="button" class="insurance-date-nav" data-action="prev" aria-label="前月">&lsaquo;</button><div class="insurance-date-picker-title"></div><button type="button" class="insurance-date-nav" data-action="next" aria-label="翌月">&rsaquo;</button></div>' +
        '<div class="insurance-date-weekdays"><span class="sunday">日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span class="saturday">土</span></div><div class="insurance-date-picker-days"></div>' +
        '<div class="insurance-date-picker-footer"><button type="button" data-action="today">今日</button><button type="button" data-action="close">閉じる</button></div>';
      host.appendChild(pk);
      pk.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]'); if (a) { if (a.dataset.action === 'prev') changeMonth(-1); else if (a.dataset.action === 'next') changeMonth(1); else if (a.dataset.action === 'today') selectDate(new Date()); else closeDatePicker(); return; }
        const d = e.target.closest('.insurance-date-day'); if (d) selectDate(parseLocal(d.dataset.date));
      });
      document.addEventListener('click', (e) => { const p = $('insurance-date-picker'); if (!p || p.classList.contains('hidden')) return; if (p.contains(e.target) || e.target === pickTarget) return; closeDatePicker(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDatePicker(); });
      window.addEventListener('resize', positionPicker);
    }
    PICKER_INPUTS.map((id) => $(id)).filter(Boolean).forEach((inp) => {
      if (inp.dataset.insuranceDatePicker === 'ready') return; inp.dataset.insuranceDatePicker = 'ready'; inp.setAttribute('autocomplete', 'off');
      inp.addEventListener('focus', () => openDatePicker(inp)); inp.addEventListener('click', () => openDatePicker(inp));
      inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openDatePicker(inp); } });
    });
    document.querySelectorAll('#hokenModals .modal-body-insurance').forEach((b) => b.addEventListener('scroll', positionPicker));
  }
  function openDatePicker(inp) {
    const d = parseDate(inp.value); const sel = d ? parseLocal(d) : new Date();
    pickTarget = inp; pickMonth = new Date(sel.getFullYear(), sel.getMonth(), 1);
    renderPicker(); const p = $('insurance-date-picker'); if (p) p.classList.remove('hidden'); positionPicker();
  }
  function closeDatePicker() { const p = $('insurance-date-picker'); if (p) p.classList.add('hidden'); pickTarget = null; }
  function changeMonth(n) { if (!pickMonth) pickMonth = new Date(); pickMonth = new Date(pickMonth.getFullYear(), pickMonth.getMonth() + n, 1); renderPicker(); positionPicker(); }
  function renderPicker() {
    const pk = $('insurance-date-picker'); if (!pk || !pickMonth) return;
    const y = pickMonth.getFullYear(), m = pickMonth.getMonth();
    pk.querySelector('.insurance-date-picker-title').textContent = y + '(' + era(y) + ')年' + (m + 1) + '月';
    const selV = pickTarget ? parseDate(pickTarget.value) || '' : ''; const tV = today();
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay()); const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); const v = localDate(d); const c = ['insurance-date-day'];
      if (d.getMonth() !== m) c.push('outside'); if (d.getDay() === 0) c.push('sunday'); if (d.getDay() === 6) c.push('saturday'); if (v === tV) c.push('today'); if (v === selV) c.push('selected');
      days.push('<button type="button" class="' + c.join(' ') + '" data-date="' + v + '">' + String(d.getDate()).padStart(2, '0') + '</button>');
    }
    pk.querySelector('.insurance-date-picker-days').innerHTML = days.join('');
  }
  function selectDate(d) {
    if (!pickTarget || !(d instanceof Date) || isNaN(d.getTime())) return;
    const t = pickTarget;
    t.value = fmtInput(d);   // 基準版と同じ（一部負担金欄は change で「2026/09/01 (火)」の形に直る）
    t.dispatchEvent(new Event('change', { bubbles: true })); closeDatePicker();
  }
  function positionPicker() {
    const pk = $('insurance-date-picker'); if (!pk || pk.classList.contains('hidden') || !pickTarget) return;
    const r = pickTarget.getBoundingClientRect(); const w = pk.offsetWidth || 280, h = pk.offsetHeight || 326, mg = 8;
    const left = Math.min(Math.max(r.left, mg), window.innerWidth - w - mg); const below = r.bottom + 4;
    pk.style.left = left + 'px'; pk.style.top = (below + h > window.innerHeight - mg ? Math.max(r.top - h - 4, mg) : below) + 'px';
  }

  // ===================== 削除の確認（基準版と同じ部品） =====================
  function confirmDelete(message) {
    const old = $('insurance-delete-confirm-dialog'); if (old) old.remove();
    const dlg = document.createElement('div'); dlg.id = 'insurance-delete-confirm-dialog'; dlg.className = 'modal insurance-delete-confirm-modal';
    dlg.innerHTML = '<div class="modal-content insurance-delete-confirm-box" role="dialog" aria-modal="true" aria-describedby="insurance-delete-confirm-message"><p class="insurance-delete-confirm-message" id="insurance-delete-confirm-message"></p>' +
      '<div class="insurance-delete-confirm-actions"><button type="button" class="btn btn-outline insurance-delete-confirm-cancel">キャンセル</button><button type="button" class="btn btn-danger-soft insurance-delete-confirm-ok">削除</button></div></div>';
    dlg.querySelector('#insurance-delete-confirm-message').textContent = message;
    const prev = document.activeElement; ($('hokenModals') || document.body).appendChild(dlg);
    return new Promise((resolve) => {
      let done = false; const close = (v) => { if (done) return; done = true; dlg.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
      dlg.querySelector('.insurance-delete-confirm-cancel').addEventListener('click', () => close(false));
      dlg.querySelector('.insurance-delete-confirm-ok').addEventListener('click', () => close(true));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) close(false); });
      dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
      dlg.querySelector('.insurance-delete-confirm-cancel').focus();
    });
  }

  // ===================== 読み取り（統合版だけ） =====================
  // 保険証情報の小窓にある「予約サイトから届いた画像」「保険証読取」「医療証読取」の部品を、開いている追加小窓の読み取り枠へ一時的に移す。
  // 閉じたら元の場所へ戻す（保険証情報の小窓はそのまま使える）。
  const reader = { modal: null, moved: [] };
  function readerNodes() {
    const a = $('rsvDocsPanel'); const b = $('insuranceOcrCameraWrap'); const c = $('iryoOcrCameraWrap');
    return [a, b && b.closest('.ocr-section'), c && c.closest('.ocr-section')].filter(Boolean);
  }
  function attachReader(modalId) {
    if (reader.modal === modalId) return;
    detachReader();
    const slot = document.querySelector('#' + modalId + ' .hk-reader-slot'); if (!slot) return;
    const iryoFirst = modalId === 'public-expense-modal';
    slot.innerHTML = '<div class="hk-reader-head"><span class="hk-reader-title">' + (iryoFirst ? '医療証' : '保険証') + 'の読み取り</span>' +
      '<span class="hk-reader-note">読み取った値は下の欄に入ります。証と見比べてから「登録」を押してください（自動では確定しません）。</span>' +
      '<button type="button" class="hk-reader-close" title="読み取りを閉じる">&times;</button></div><div class="hk-reader-body"></div>';
    const body = slot.querySelector('.hk-reader-body');
    let nodes = readerNodes(); if (iryoFirst && nodes.length === 3) nodes = [nodes[0], nodes[2], nodes[1]];
    nodes.forEach((n) => { const mark = document.createComment('hk-reader'); n.parentNode.insertBefore(mark, n); reader.moved.push([n, mark]); body.appendChild(n); });
    const mob = $('mobileDocsPanel'); if (mob && mob.parentNode !== body) { const mark = document.createComment('hk-reader'); mob.parentNode.insertBefore(mark, mob); reader.moved.push([mob, mark]); body.insertBefore(mob, body.children[1] || null); }
    slot.classList.remove('hidden'); reader.modal = modalId;
    slot.querySelector('.hk-reader-close').addEventListener('click', () => detachReader());
    try { if (typeof renderRsvDocs === 'function') renderRsvDocs(); } catch (e) { console.warn('[hoken_tab]', e); }
    try { if (window.MobileInbox && MobileInbox.renderPanels) MobileInbox.renderPanels(); } catch (e) { console.warn('[hoken_tab]', e); }
    // スマホから届いた画像の欄は後から作られることがある（予約サイトの欄のすぐ後ろに入る）
    setTimeout(() => { const m = $('mobileDocsPanel'); if (m && reader.modal === modalId && !body.contains(m)) { const mark = document.createComment('hk-reader'); m.parentNode.insertBefore(mark, m); reader.moved.push([m, mark]); body.insertBefore(m, body.children[1] || null); } }, 800);
  }
  function detachReader() {
    reader.moved.reverse().forEach(([n, mark]) => { if (mark.parentNode) { mark.parentNode.insertBefore(n, mark); mark.remove(); } });
    reader.moved = [];
    if (reader.modal) { const slot = document.querySelector('#' + reader.modal + ' .hk-reader-slot'); if (slot) { slot.innerHTML = ''; slot.classList.add('hidden'); } }
    reader.modal = null;
  }
  const isOpen = (id) => { const m = $(id); return !!(m && !m.classList.contains('hidden')); };
  function fillFromInsuranceOcr(qrOnly) {
    const f = window._insuranceOcrResult; if (!f) return;
    const use = (flag) => !qrOnly || flag;
    if (f.insurerNumber && use(f._insurerFromQR)) { setVal('insurance-insurer-number', digits(f.insurerNumber).slice(0, 8)); updateAutoFields(false, true); validateInsurer(false); }
    if (f.symbol && use(f._symbolFromQR)) setVal('insurance-symbol', f.symbol);
    if (f.memberNumber && use(f._memberFromQR)) setVal('insurance-number', f.memberNumber);
    if (f.edaban && use(f._edabanFromQR)) setVal('insurance-branch-number', digits(f.edaban).slice(0, 2));
    toast(qrOnly ? 'QR読取データを欄に入れました（内容を確認して「登録」を押してください）' : '読取結果を欄に入れました（内容を確認して「登録」を押してください）');
  }
  function fillFromIryoOcr() {
    const f = window._iryoOcrResult; if (!f) return;
    const payer = digits(f.kouhiNumber).slice(0, 8);
    if (payer) { const np = $('public-expense-no-payer-number'); if (np) np.checked = false; updatePublicDisabled(); setVal('public-expense-payer-number', payer); applyTypeFromPayer(); }
    else if (f.hobetsu) { const sel = $('public-expense-type'); const opt = sel && Array.from(sel.options).find((o) => o.dataset && o.dataset.lawNumber === digits(f.hobetsu).slice(0, 2)); if (opt) sel.value = opt.value; }
    const rec = digits(f.recipientNumber).slice(0, 7); if (rec) { const cl = $('public-expense-confirm-later'); if (cl) cl.checked = false; updatePublicDisabled(); setVal('public-expense-recipient-number', rec); }
    const vf = parseDate(f.validFrom), vt = parseDate(f.validTo);
    if (vf) setVal('public-expense-valid-from', slash(vf)); if (vt) setVal('public-expense-valid-until', slash(vt));
    const add = []; if (f.copayLimit) add.push('自己負担上限 ' + f.copayLimit); if (f.issuer) add.push('交付 ' + f.issuer);
    if (add.length) { const m = $('public-expense-manual-note'); const line = add.join(' / '); if (m && m.value.indexOf(line) < 0) m.value = (m.value ? m.value + '\n' : '') + line; }
    toast('読取結果を欄に入れました（証と見比べて「登録」を押してください）');
  }

  // ===================== 小窓の配線 =====================
  function wireModals() {
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    const overlay = (id, closeFn) => on(id, 'click', (e) => { if (e.target.id === id) closeFn(); });
    document.querySelectorAll('#hokenModals form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
    // 医療保険
    on('insurance-modal-close', 'click', closeInsurance); on('btn-insurance-save', 'click', saveInsurance); on('btn-insurance-delete', 'click', deleteInsurance); overlay('insurance-modal', closeInsurance);
    on('btn-insurance-online-check', 'click', () => toast('オンライン資格確認端末とは未接続です。保険証・マイナ保険証は「保険証読取」から読み取れます'));
    on('btn-insurance-reader', 'click', () => { if (reader.modal === 'insurance-modal') detachReader(); else attachReader('insurance-modal'); });
    on('insurance-insurer-number', 'input', () => { updateAutoFields(false, true); validateInsurer(false); });
    on('insurance-insurer-number', 'change', () => { updateAutoFields(false, true); validateInsurer(true); });
    on('insurance-type', 'change', () => { updateAutoFields(); updateWorkersCompFields(); });
    ['insurance-symbol', 'insurance-number'].forEach((id) => { on(id, 'input', () => updateAutoFields()); on(id, 'change', () => updateAutoFields()); });
    on('insurance-burden-ratio', 'change', () => { burdenManual = true; });
    on('hk-income-level', 'change', () => updateAutoFields());
    on('insurance-reduction-type', 'change', updateReduction);
    on('workers-claim-type', 'change', updateWorkersCompFields); on('workers-new-continuing-code', 'change', updateWorkersCompFields);
    ['workers-labor-insurance-number', 'workers-pension-certificate-number', 'workers-same-injury-count', 'workers-labor-bureau-code', 'workers-inspection-office-code', 'workers-aftercare-disease-code', 'workers-aftercare-handbook-number']
      .forEach((id) => on(id, 'input', (e) => { const m = Number(e.target.getAttribute('maxlength')); const n = digits(e.target.value); e.target.value = m ? n.slice(0, m) : n; }));
    // 公費
    on('public-expense-modal-close', 'click', closePublic); on('btn-public-expense-save', 'click', savePublicExpense); on('btn-public-expense-delete', 'click', deletePublicExpense); overlay('public-expense-modal', closePublic);
    on('btn-public-expense-online-check', 'click', () => toast('オンライン資格確認端末とは未接続です。医療証は「医療証読取」から読み取れます'));
    on('btn-public-expense-reader', 'click', () => { if (reader.modal === 'public-expense-modal') detachReader(); else attachReader('public-expense-modal'); });
    on('public-expense-no-payer-number', 'change', updatePublicDisabled); on('public-expense-confirm-later', 'change', updatePublicDisabled);
    on('public-expense-payer-number', 'input', applyTypeFromPayer); on('public-expense-payer-number', 'change', applyTypeFromPayer);
    on('public-expense-type', 'change', renderMunicipality);
    document.querySelectorAll('input[name="public-expense-burden-mode"]').forEach((i) => i.addEventListener('change', updatePublicBurden));
    ['public-expense-recipient-number', ...BURDEN_IDS].forEach((id) => on(id, 'input', (e) => { const m = Number(e.target.getAttribute('maxlength')); const n = digits(e.target.value); e.target.value = m ? n.slice(0, m) : n; }));
    // 労災・自賠責
    on('workers-insurance-modal-close', 'click', closeWorkers); on('btn-workers-insurance-save', 'click', saveWorkers); on('btn-workers-insurance-delete', 'click', deleteWorkers); overlay('workers-insurance-modal', closeWorkers);
    on('workers-policy-benefit-type', 'change', updatePolicyNumberState); on('workers-policy-confirm-later', 'change', updatePolicyNumberState);
    on('workers-policy-bureau-prefecture', 'change', (e) => renderOfficeOptions(e.target.value));
    on('workers-policy-number', 'input', (e) => { e.target.value = digits(e.target.value).slice(0, val('workers-policy-benefit-type') === 'injury_pension' ? 9 : 14); });
    on('workers-policy-initial-month', 'change', (e) => { e.target.value = initialMonth(e.target.value) || e.target.value.trim(); });
    on('auto-insurance-modal-close', 'click', closeAuto); on('btn-auto-insurance-save', 'click', saveAuto); on('btn-auto-insurance-delete', 'click', deleteAuto); overlay('auto-insurance-modal', closeAuto);
    // 特記事項・症状詳記・摘要欄・福祉備考・一部負担金
    const simple = [['receipt-special-note', 'special', 'receiptSpecialNotes', saveSpecialNote, 'レセプト特記事項'], ['receipt-symptom-detail', 'symptom', 'receiptSymptomDetails', saveSymptomDetail, '症状詳記'],
      ['receipt-summary-comment', 'summary', 'receiptSummaryComments', saveSummaryComment, 'レセプト摘要欄コメント'], ['welfare-invoice-comment', 'welfare', 'welfareInvoiceComments', saveWelfareComment, '福祉請求書備考欄コメント'],
      ['receipt-copayment', 'copay', 'receiptCopayments', saveCopayment, 'レセプト一部負担金欄']];
    simple.forEach(([k, kind, key, save, label]) => {
      const close = () => { editing[kind] = null; hide(k + '-modal'); };
      on(k + '-modal-close', 'click', close); overlay(k + '-modal', close); on('btn-' + k + '-save', 'click', save);
      on('btn-' + k + '-delete', 'click', () => deleteSimple(kind, key, k + '-modal', label));
    });
    document.querySelectorAll('input[name="receipt-symptom-detail-kind"]').forEach((i) => i.addEventListener('change', updateKindState));
    document.querySelectorAll('#receipt-copayment-modal .receipt-copayment-amount').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault(); });
      inp.addEventListener('input', (e) => { const m = Number(e.target.getAttribute('maxlength') || 9); e.target.value = digits(e.target.value).slice(0, m); if (e.target.id === 'receipt-copayment-insurance-amount') updateCopayDiff(); });
      inp.addEventListener('change', (e) => { if (e.target.value === '') return; const mn = Number(e.target.min || 0), mx = Number(e.target.max || Number.MAX_SAFE_INTEGER), a = Number(e.target.value); e.target.value = Number.isInteger(a) ? String(Math.min(mx, Math.max(mn, a))) : ''; if (e.target.id === 'receipt-copayment-insurance-amount') updateCopayDiff(); });
    });
    ['receipt-copayment-valid-from', 'receipt-copayment-valid-until'].forEach((id) => on(id, 'change', (e) => { const n = parseDate(e.target.value); if (n) e.target.value = copayDate(n); copayRef = copayReference(); updateCopayDiff(); }));
    document.addEventListener('click', (e) => { if (!e.target.closest('.labor-auto-add-control')) { const m = $('labor-auto-add-menu'); if (m) m.classList.add('hidden'); } });
  }

  // ===================== 既存の画面・機能とのつなぎ =====================
  function install() {
    // 1) 左パネルの「保険等」タブをこの画面に置き換える（app.js の switchPatientTab / renderAllKarte から呼ばれる）
    if (typeof renderPatientInfoTab === 'function') {
      const orig = renderPatientInfoTab;
      renderPatientInfoTab = function (p) {
        if (typeof currentPatientTab !== 'undefined' && currentPatientTab === 'insurance') {
          if (typeof syncVitalsInputVisibility === 'function') syncVitalsInputVisibility();
          ensureModals(); renderTab(p); return;
        }
        return orig.apply(this, arguments);
      };
    }
    // 2) 保険証・医療証の読み取り結果: 追加小窓が開いていればその欄に入れる（自動では確定しない）
    if (typeof applyInsuranceOcrResults === 'function') {
      const orig = applyInsuranceOcrResults;
      applyInsuranceOcrResults = function (qrOnly) {
        if (isOpen('insurance-modal') && val('insurance-type') !== 'labor') return fillFromInsuranceOcr(qrOnly);
        if (isOpen('public-expense-modal')) { closePublic(); openInsurance(null, { reader: true }); return fillFromInsuranceOcr(qrOnly); }
        return orig.apply(this, arguments);
      };
    }
    if (typeof applyIryoOcrResults === 'function') {
      const orig = applyIryoOcrResults;
      applyIryoOcrResults = function () {
        if (isOpen('public-expense-modal')) return fillFromIryoOcr();
        if (isOpen('insurance-modal')) { closeInsurance(); openPublicExpense(null, { reader: true }); return fillFromIryoOcr(); }
        return orig.apply(this, arguments);
      };
    }
    // 3) 従来の「保険証情報」「患者情報の編集」で従来の項目を直したら、主保険の配列にも入れて保存し直す
    if (typeof saveInsuranceInfo === 'function') {
      const orig = saveInsuranceInfo;
      saveInsuranceInfo = function () {
        const p = cur(); const before = p ? JSON.stringify([p.insurerNumber, p.insSymbol, p.insNumber, p.insEdaban, p.ratio, p.insurance]) : '';
        const keep = p && Array.isArray(p.rousai) ? p.rousai.slice() : null;
        const r = orig.apply(this, arguments);
        if (p) {
          // 従来の小窓は労災を1件ぶんしか扱わないので、2件目以降と、この画面で足した項目を残す
          if (keep && keep.length) { if (Array.isArray(p.rousai) && p.rousai.length) { p.rousai = [Object.assign({}, keep[0], p.rousai[0])].concat(keep.slice(1)); } else if (keep.length > 1 && p.rousai === null) { p.rousai = keep.slice(1); } }
          const after = JSON.stringify([p.insurerNumber, p.insSymbol, p.insNumber, p.insEdaban, p.ratio, p.insurance]);
          if ((after !== before && adoptLegacy(p)) || keep) { if (typeof savePatientToApi === 'function') savePatientToApi(p); }
        }
        return r;
      };
    }
    if (typeof savePatientEdit === 'function') {
      const orig = savePatientEdit;
      savePatientEdit = function () { const r = orig.apply(this, arguments); const p = cur(); if (p && adoptLegacy(p) && typeof savePatientToApi === 'function') savePatientToApi(p); return r; };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();

  window.HokenTab = {
    current: cur, render: () => { const p = cur(); if (p) { ensureModals(); renderTab(p); } }, syncLegacy, adoptLegacy, primaryInsurance,
    openInsurance, openPublicExpense, openWorkers, openAuto, openSpecialNote, openSymptomDetail, openSummaryComment, openWelfareComment, openCopayment,
    saveInsurance, savePublicExpense, saveWorkers, saveAuto, saveSpecialNote, saveSymptomDetail, saveSummaryComment, saveWelfareComment, saveCopayment,
    closeDatePicker, attachReader, detachReader, parseDate, fmtInput,
  };
})();
