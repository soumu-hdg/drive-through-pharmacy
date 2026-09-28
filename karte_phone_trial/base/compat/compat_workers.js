// ===== 置き換え層：労災・自賠責のレセプト作成（工程4・2026-09-24） compat_workers.js =====
// 基準版のレセプト作成の小窓の「労災」「自賠責」タブ（claim_category=workers・auto_liability）を受け持つ。
//   ・compat_receipt.js の処理（/receipt-claims/preview・batches・download など）を C.routeOf で取り出して包み、
//     claim_category が workers・auto_liability のときだけこのファイルで答える。医療保険（medical）は元の処理に任せる
//   ・受診は統合版の DB から読む（visits・kartes.base_record＝基準版の画面で保存したカルテ）。保険は基準版の画面と同じ
//     /insurances/patient/… の応答（労災＝patients.rousai、自賠責＝receipt_extra.insurances の auto）、傷病名は /diagnoses/patient/…
//   ・労災レセ電（RREC・AREC、返戻再請求は .UKS）は基準版の workers_comp_uke_builder.py をそのまま JS に写したもの（下の WB）。
//     使う公式マスターは workers_masters.json（tools/fix4_build_workers_masters.py で厚生労働省・支払基金の公開マスターから生成）
//   ・ZIP は基準版の build_workers_comp_claim_zip_bytes と同じ並び（要確認一覧 → rousai/RRECnn00.UKE …）。
//     要確認一覧は PDF の代わりに同じ行の TXT（帳票 PDF は未対応）。自賠責は基準版と同じくレセ電を作らない（要確認一覧だけ）
//   ・作成履歴は compat_receipt.js と同じ院ごとの台帳（karte_base_receipt_batches_<院ID>）に並べる
//   ・基準版サーバーにある医療保険側の算定点検（電子点数表・算定ルール・摘要要件・月の点検）は、労災・自賠責では行わない
(function (root) {
  'use strict';
  // ================================================================
  // WB：基準版 workers_comp_uke_builder.py（と、それが使う receipt_uke_builder.py・receipt_integrity.py・
  //     workers_comp_masters.py の関数）の写し。DB にも画面にも触らない純粋な計算だけ
  // ================================================================
  const WB = (function () {
    // ---- Python の文字列・数値の扱いをそろえる小道具 ----
    const WSC = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';   // Python の \s（Unicode）
    const RE_WS = new RegExp('[' + WSC + ']+', 'g');
    const RE_EDGE = new RegExp('^[' + WSC + ']+|[' + WSC + ']+$', 'g');
    const strip = (s) => String(s).replace(RE_EDGE, '');
    const isNone = (v) => v === null || v === undefined;
    const isDict = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    function truthyPy(v) {   // Python の真偽（None・''・0・False・空の配列/辞書は偽）
      if (isNone(v) || v === false || v === '' || v === 0 || (typeof v === 'number' && isNaN(v))) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (isDict(v)) return Object.keys(v).length > 0;
      return true;
    }
    const or = (v, d) => (truthyPy(v) ? v : d);
    const pyStr = (v) => (isNone(v) ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v));
    const blank = (v) => isNone(v) || v === '';   // Python の value in (None, "")
    const asciiDigits = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    function intValue(value, dflt) {   // receipt_uke_builder.int_value
      if (dflt === undefined) dflt = 0;
      if (isNone(value) || value === '') return dflt;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'number') return isFinite(value) ? Math.trunc(value) : dflt;
      if (typeof value !== 'string') return dflt;
      const t = asciiDigits(strip(value)).replace(/_/g, '');
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return dflt;
      return Math.trunc(Number(t));
    }
    function pyInt(v) { const n = intValue(v, null); return n === null ? 0 : n; }   // int(x or 0) 相当（数字でない文字は 0）
    const digitsOnly = (v) => pyStr(or(v, '')).replace(/[^\p{Nd}]+/gu, '');
    const zeroFill = (v, n) => { const t = digitsOnly(v); return t ? t.padStart(n, '0').slice(-n) : ''; };
    function formatDate(value) { const t = strip(pyStr(or(value, ''))); if (!t) return ''; const d = digitsOnly(t); return d.length >= 8 ? d.slice(0, 8) : ''; }
    const normalizeClaimMonth = (v) => { const d = digitsOnly(v); return d.length >= 6 ? d.slice(0, 6) : d; };
    function isValidYmd(v) {
      const t = strip(pyStr(or(v, ''))); if (!/^\d{8}$/.test(t)) return false;
      const y = +t.slice(0, 4), m = +t.slice(4, 6), d = +t.slice(6, 8); const dt = new Date(Date.UTC(y, m - 1, d));
      return y >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }
    const firstPresent = (src, ...keys) => { for (const k of keys) { const v = src[k]; if (!blank(v)) return v; } return null; };
    const asList = (v) => (isNone(v) ? [] : Array.isArray(v) ? v : [v]);
    const dedupe = (vals) => [...new Set(vals.filter((x) => truthyPy(x)))];
    const uniq = (vals) => [...new Set(vals)];
    function truthy(v) { if (typeof v === 'boolean') return v; return ['1', 'true', 'yes', 'on', '有', 'あり'].includes(strip(pyStr(or(v, ''))).toLowerCase()); }
    function formatDecimal(value) {
      if (blank(value)) return '';
      const n = Number(asciiDigits(pyStr(value)));
      if (!isFinite(n)) return pyStr(value);
      if (Number.isInteger(n)) return String(n);
      let s = String(n); if (/e/i.test(s)) s = n.toFixed(20);
      return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    }
    const splitCommentLines = (v) => pyStr(or(v, '')).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(strip).filter((x) => x);

    // ---- CP932（Python の cp932、errors="replace"）。ブラウザの Shift_JIS 解読表から逆引きを作る ----
    let CP = null;
    function cpTable() {
      if (CP) return CP;
      CP = new Map();
      for (let b = 0; b < 0x80; b++) CP.set(b, [b]);
      for (let b = 0xA1; b <= 0xDF; b++) CP.set(0xFF61 + (b - 0xA1), [b]);
      const dec = new TextDecoder('shift_jis');
      const leads = []; for (let l = 0x81; l <= 0x9F; l++) leads.push(l); for (let l = 0xE0; l <= 0xFC; l++) if (l !== 0xED && l !== 0xEE) leads.push(l);   // ED・EE（NEC 選定 IBM 拡張）は FA〜FC と重複。cp932 の符号化は FA〜FC
      for (const l of leads) for (let t = 0x40; t <= 0xFC; t++) {
        if (t === 0x7F) continue;
        const s = dec.decode(new Uint8Array([l, t])); const cp = s.codePointAt(0);
        if ([...s].length === 1 && cp !== 0xFFFD && !CP.has(cp)) CP.set(cp, [l, t]);
      }
      return CP;
    }
    const cpBytesOf = (ch) => cpTable().get(ch.codePointAt(0)) || null;
    function encodeCp932(text) {
      const out = []; for (const ch of String(text)) { const b = cpBytesOf(ch); if (b) out.push(...b); else out.push(0x3F); }
      return new Uint8Array(out);
    }
    const cpLen = (text) => { let n = 0; for (const ch of String(text)) { const b = cpBytesOf(ch); n += b ? b.length : 1; } return n; };
    const cpEncodable = (text) => { for (const ch of String(text)) if (!cpBytesOf(ch)) return false; return true; };

    // ---- receipt_uke_builder.py の共通部品 ----
    const UKE_RECORD_FIELD_COUNTS = { IR: 10, RE: 38, HO: 15, KO: 12, SN: 9, JD: 33, MF: 33, SY: 8, SI: 44, IY: 44, TO: 48, CO: 5, SJ: 3, GO: 4 };
    const RECORD_KIND_BY_ITEM_TYPE = { action: 'SI', drug: 'IY', material: 'TO' };
    const PREFECTURE_CODES_BY_NAME = [['北海道', '01'], ['青森', '02'], ['岩手', '03'], ['宮城', '04'], ['秋田', '05'], ['山形', '06'], ['福島', '07'], ['茨城', '08'], ['栃木', '09'], ['群馬', '10'],
      ['埼玉', '11'], ['千葉', '12'], ['東京', '13'], ['神奈川', '14'], ['新潟', '15'], ['富山', '16'], ['石川', '17'], ['福井', '18'], ['山梨', '19'], ['長野', '20'], ['岐阜', '21'], ['静岡', '22'],
      ['愛知', '23'], ['三重', '24'], ['滋賀', '25'], ['京都', '26'], ['大阪', '27'], ['兵庫', '28'], ['奈良', '29'], ['和歌山', '30'], ['鳥取', '31'], ['島根', '32'], ['岡山', '33'], ['広島', '34'],
      ['山口', '35'], ['徳島', '36'], ['香川', '37'], ['愛媛', '38'], ['高知', '39'], ['福岡', '40'], ['佐賀', '41'], ['長崎', '42'], ['熊本', '43'], ['大分', '44'], ['宮崎', '45'], ['鹿児島', '46'], ['沖縄', '47']];
    const VALID_SERVICES = new Set('11 12 13 14 21 22 23 24 25 26 27 28 31 32 33 39 40 50 54 60 70 80 90 92 97'.split(' '));
    function cleanField(value) {
      if (isNone(value)) return '';
      let t = pyStr(value).replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
      t = t.replace(/,/g, ' ').replace(/"/g, '');
      return strip(t.replace(RE_WS, ' '));
    }
    function receiptTextMode(value, force) {
      const t = cleanField(value).replace(/[｡-ﾟ]+/g, (m) => m.normalize('NFKC'));
      const chars = [...t];
      if (force || chars.some((c) => c.codePointAt(0) > 127)) return chars.map((c) => (c === ' ' ? '　' : (c >= '!' && c <= '~') ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c)).join('');
      return t;
    }
    const receiptKana = (v) => pyStr(or(v, '')).normalize('NFKC').replace(RE_WS, '');
    const canEncodeCp932 = (v) => cpEncodable(cleanField(v));
    function makeRecord(fields, fieldCount) {
      const out = fields.map(cleanField); const kind = out[0] || '';
      if (kind === 'IR' && out.length > 6) out[6] = receiptTextMode(fields[6], true);
      if (kind === 'CO' && out.length > 4 && out[3] === '810000001') out[4] = receiptTextMode(fields[4], true);
      ({ RE: [4], HO: [2, 3] }[kind] || []).forEach((p) => { if (out.length > p) out[p] = receiptTextMode(fields[p]); });
      if (kind === 'RE' && out.length > 36) out[36] = receiptKana(fields[36]);
      if (kind === 'HO' && out.length > 1 && out[1]) out[1] = out[1].padStart(8);
      while (fieldCount && out.length < fieldCount) out.push('');
      return out.join(',');
    }
    function makePositionedRecord(type, values) {
      const n = UKE_RECORD_FIELD_COUNTS[type]; const f = new Array(n).fill(''); f[0] = type;
      Object.keys(values).forEach((k) => { const p = Number(k), v = values[k]; if (p > 1 && p <= n && !blank(v)) f[p - 1] = v; });
      return makeRecord(f, n);
    }
    const getClaimPayload = (item) => (isDict(item.claim_payload) ? item.claim_payload : {});
    const getDetails = (item) => asList(or(item.items, or(getClaimPayload(item).items, []))).filter(isDict);
    const getDiagnoses = (item) => asList(or(item.diagnoses, or(getClaimPayload(item).diagnoses, []))).filter(isDict);
    const shouldEmitDetail = (d) => !truthy(d.do_not_bill) && d.item_type !== 'self_pay';
    const recordKindForDetail = (d) => RECORD_KIND_BY_ITEM_TYPE[pyStr(or(d.item_type, 'action'))] || null;
    function medicalInstitutionCode7(f) { const c = digitsOnly(or(f.medical_institution_code, f.facility_code)); return c.length >= 10 ? c.slice(-7) : c; }
    function pointTableCode(f) {
      const ex = digitsOnly(firstPresent(f, 'point_table_code', 'medical_point_table_code')); if (ex) return ex.slice(0, 1);
      const c = digitsOnly(f.medical_institution_code); if (c.length >= 10) return c.slice(2, 3) || '1'; return '1';
    }
    function facilityPrefectureCode(f) {
      const ex = digitsOnly(firstPresent(f, 'prefecture_code', 'medical_prefecture_code')); if (ex.length >= 2) return ex.slice(0, 2);
      const c = digitsOnly(f.medical_institution_code); if (c.length >= 10) return c.slice(0, 2);
      const hay = ['prefecture', 'address', 'name'].map((k) => pyStr(or(f[k], ''))).join(' ');
      for (const [name, code] of PREFECTURE_CODES_BY_NAME) if (hay.includes(name)) return code;
      return '';
    }
    const normalizePhone = (v) => strip(pyStr(or(v, ''))).replace(/[^\p{Nd}+\-()]/gu, '');
    function isClaimIncluded(item) {
      if (item.receipt_claim_type === 'resubmit_paper') return false;
      const v = Object.prototype.hasOwnProperty.call(item, 'is_claim_included') ? item.is_claim_included : ['include', 'warning', 'resubmit'].includes(pyStr(or(item.claim_status, '')));
      return v !== false;
    }
    const isDeletedDiagnosis = (d) => truthy(d.is_deleted) || truthy(d.deleted);
    function receiptVisitDay(item) { const t = formatDate(item.billing_date); return isValidYmd(t) ? Math.max(1, Math.min(31, +t.slice(6, 8))) : 1; }
    function calculationDayValues(kind, day, count) { if (!(day >= 1 && day <= 31)) return {}; const s = kind === 'TO' ? 18 : 14; return { [s + day - 1]: count }; }
    function detailCount(kind, d) {
      if (kind === 'IY') { const days = intValue(d.days); if (days > 0) return days; }
      const q = firstPresent(d, 'occurrence_count', 'count', 'times');
      if (!blank(q)) return Math.max(1, intValue(q, 1));
      return Math.max(1, intValue(d.quantity, 1));
    }
    function quantityForDetail(kind, d) {
      if (kind === 'SI') { const q = firstPresent(d, 'quantity_data'); return (isNone(q) || q === '' || q === 0 || q === 1) ? '' : formatDecimal(q); }
      if (kind === 'IY') return formatDecimal(or(firstPresent(d, 'drug_quantity', 'dose_quantity', 'quantity'), 0));
      return formatDecimal(or(firstPresent(d, 'material_quantity', 'quantity'), 0));
    }
    function normalizeModifierCodes(value) {
      const codes = [];
      for (const it of asList(value)) {
        let code = strip(pyStr(or(it, '')));
        if (isDict(it)) code = strip(pyStr(or(it.code, or(it.modifier_code, ''))));
        code = code.replace(/[^0-9A-Za-z]/g, ''); if (code) codes.push(code);
      }
      return dedupe(codes).slice(0, 20).join('');
    }
    function splitCp932Text(value, maxBytes) {
      const chunks = []; let cur = '', size = 0;
      for (const ch of pyStr(or(value, ''))) { const n = cpLen(ch); if (cur && size + n > maxBytes) { chunks.push(cur); cur = ''; size = 0; } cur += ch; size += n; }
      if (cur) chunks.push(cur); return chunks;
    }
    function parseJsonList(v) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return Array.isArray(v) ? v : []; }
    function makeReceiptSummaryCommentRecords(item, payload, pos) {
      const entries = [];
      for (const src of [item, payload]) entries.push(...parseJsonList(src.receipt_summary_comments).filter(isDict));
      let uniqueEntries = []; const seen = new Set();
      for (const e of entries) {
        const content = strip(pyStr(or(e.content, ''))); const position = strip(pyStr(or(e.output_position, 'upper'))).toLowerCase();
        if (!content || !['upper', 'lower'].includes(position)) continue;
        const id = JSON.stringify([pyStr(or(e.id, '')), position, content]); if (seen.has(id)) continue; seen.add(id);
        uniqueEntries.push({ output_position: position, content });
      }
      const sel = strip(pyStr(or(pos, ''))).toLowerCase();
      if (['upper', 'lower'].includes(sel)) uniqueEntries = uniqueEntries.filter((e) => e.output_position === sel);
      const recs = [];
      for (const e of uniqueEntries) {
        let paras = e.content.split(/\r\n|\r|\n/).map(strip).filter((x) => x); if (!paras.length) paras = [e.content];
        for (const p of paras) for (const chunk of splitCp932Text(p, 76)) recs.push(makePositionedRecord('CO', { 2: '01', 4: '810000001', 5: chunk }));
      }
      return recs;
    }
    function makeSymptomDetailRecords(item, payload) {
      const entries = [];
      for (const src of [item, payload]) entries.push(...parseJsonList(src.receipt_symptom_details).filter(isDict));
      const uniqueEntries = []; const seen = new Set();
      for (const e of entries) {
        const content = strip(pyStr(or(e.content, ''))); if (!content) continue;
        const category = zeroFill(or(e.detail_category_code, or(e.category, '01')), 2) || '01';
        const id = JSON.stringify([pyStr(or(e.id, '')), category, content]); if (seen.has(id)) continue; seen.add(id);
        uniqueEntries.push({ category: category.slice(-2), content });
      }
      const legacy = strip(pyStr(or(firstPresent(item, 'symptom_detail', 'symptom_details', 'detailed_symptoms'), or(firstPresent(payload, 'symptom_detail', 'symptom_details', 'detailed_symptoms'), ''))));
      const registered = uniqueEntries.map((e) => e.content);
      if (legacy && !registered.includes(legacy) && legacy !== registered.join('\n')) {
        const category = or(firstPresent(item, 'symptom_detail_category', 'symptom_detail_code'), or(firstPresent(payload, 'symptom_detail_category', 'symptom_detail_code'), '01'));
        uniqueEntries.push({ category: (zeroFill(category, 2) || '01').slice(-2), content: legacy });
      }
      const recs = [];
      for (const e of uniqueEntries) {
        let paras = e.content.split(/\r\n|\r|\n/).map(strip).filter((x) => x); if (!paras.length) paras = [e.content];
        let first = true;
        for (const p of paras) for (const chunk of splitCp932Text(p, 2400)) { recs.push(makePositionedRecord('SJ', { 2: first ? e.category : '', 3: chunk })); first = false; }
      }
      return recs;
    }

    // ---- マスター（workers_masters.json）----
    let M = null, masterError = null;
    function setMasters(m) { M = m; masterError = m ? null : '労災公式マスターが不足しています'; }
    function master() { if (!M) throw new Error(masterError || '労災公式マスターが読み込まれていません'); return M; }
    const officialRowsComment = () => (M && M.CM) || {};
    // receipt_integrity.official_service（医科の公式マスター：MA＝診療行為の告示等識別区分の枠、DR＝医薬品の剤形）
    function officialService(detail) {
      const kind = or(detail.item_type, 'action');
      const code = pyStr(or(detail.code, or(detail.action_code, or(detail.drug_code, ''))));
      const explicit = pyStr(or(detail.diagnosis_identifier, or(detail.receipt_category_code, ''))).slice(0, 2);
      if (['drug', 'medicine', 'prescription'].includes(kind)) {
        if (VALID_SERVICES.has(explicit)) return explicit;
        const drugType = pyStr(or(detail.drug_type, or(detail.category_name, '')));
        if (drugType.includes('頓服')) return '22';
        const form = M && M.DR ? M.DR[code] : undefined;
        if (drugType.includes('外用') || form === '6') return '23';
        if (drugType.includes('注射') || form === '4') return '33';
        return '21';
      }
      if (VALID_SERVICES.has(explicit)) return explicit;
      const slotRaw = M && M.MA ? M.MA[code] : undefined;
      if (slotRaw !== undefined) {
        const slot = slotRaw.padStart(3, '0');
        if (slot === '300') { const cat = pyStr(or(detail.category_code, '')).slice(0, 2); return ['31', '32', '33'].includes(cat) ? cat : '33'; }
        const svc = slot.slice(0, 2); if (VALID_SERVICES.has(svc)) return svc;
      }
      const cat = pyStr(or(detail.category_code, '')).slice(0, 2);
      if (VALID_SERVICES.has(cat)) return cat;
      return kind === 'material' ? '40' : '80';
    }
    const diagnosisIdentifierCode = (kind, d) => officialService(Object.assign({ item_type: { SI: 'action', IY: 'drug', TO: 'material' }[kind] }, d));
    function unitPoints(detail, count) {
      if (!isNone(detail.unit_score)) return pyInt(or(detail.unit_score, 0));
      const total = Number(or(detail.score, 0)) || 0; const v = total / count;
      return Number.isInteger(v) ? v : 0;
    }
    function countedDates(item, payer) {
      const r = new Set();
      for (const s of (truthyPy(item.source_billings) ? item.source_billings : [item])) {
        const codes = s.visit_day_codes;
        if (isNone(codes) || (codes && codes[payer] === '1')) r.add(pyStr(s.billing_date).slice(0, 10));
      }
      return [...r].sort();
    }
    function publicCoversAll(item) {
      const ex = item.public_expenses || []; if (ex.length !== 1) return false;
      if (ex[0].covers_all_services === true) return true;
      return (item.public_expense_decisions || []).some((d) => d.route === 'combined' && pyStr(or(d.rule_id, '')).startsWith('aichi.'));
    }
    // receipt_integrity.aggregate_receipts（月の受診を 1 枚にまとめる）
    function aggregateReceipts(items) {
      const groups = new Map();
      for (const raw of items || []) {
        if (raw.is_claim_included === false || ['exclude', 'month_delay', 'return_hold'].includes(raw.claim_status)) continue;
        let payload = or(raw.claim_payload, {}); if (typeof payload === 'string') payload = JSON.parse(payload);
        const item = Object.assign({}, payload, raw);
        item.receipt_claim_type = or(item.receipt_claim_type, item.claim_status === 'resubmit' ? 'resubmit' : 'normal');
        item.visit_type = ['inpatient', 'hospitalization', 'admission', '入院'].includes(pyStr(or(item.visit_type, '')).toLowerCase()) ? 'inpatient' : 'outpatient';
        if (truthyPy(item._monthly_receipt)) { groups.set('aggregate|' + groups.size, item); continue; }
        const billingDate = pyStr(or(item.billing_date, '')).slice(0, 10);
        const month = pyStr(or(item.receipt_claim_month, billingDate)).slice(0, 7);
        const publicKey = (item.public_expenses || []).map((e) => [pyStr(e.payer_number), pyStr(e.recipient_number)]);
        const keys = ['payer_group', 'patient_id', 'patient_no', 'insurer_number', 'symbol', 'insurance_number', 'branch_number', 'burden_ratio', 'relationship', 'visit_type', 'receipt_claim_type'];
        const key = JSON.stringify(keys.map((k) => pyStr(or(item[k], ''))).concat([month, publicKey, pyStr(or(item.return_item_id, or(item.receipt_search_number, ''))), item.claim_status === 'resubmit' ? 'resubmit' : 'normal']));
        if (!groups.has(key)) groups.set(key, Object.assign({}, item, { _monthly_receipt: true, items: [], diagnoses: [], billing_dates: [], warning_messages: [], source_billings: [],
          total_score: 0, total_amount: 0, patient_burden: 0, insurance_burden_amount: 0, public_expense_amount: 0, self_pay_amount: 0,
          public_expenses: (item.public_expenses || []).map((e) => Object.assign({}, e)) }));
        const g = groups.get(key);
        g.source_billings.push(item);
        ['total_score', 'total_amount', 'patient_burden', 'public_expense_amount', 'self_pay_amount'].forEach((f) => { g[f] += pyInt(or(item[f], 0)); });
        g.insurance_burden_amount += pyInt(or(Object.prototype.hasOwnProperty.call(item, 'insurance_burden_amount') ? item.insurance_burden_amount : item.patient_burden, 0));
        if (billingDate && !g.billing_dates.includes(billingDate)) g.billing_dates.push(billingDate);
        (item.items || []).forEach((d) => g.items.push(Object.assign({}, d, { billing_date: billingDate, _source_billing_id: pyStr(or(item.billing_id, or(item.record_id, ''))) })));
        const sig = (dx) => JSON.stringify(['diagnosis_code', 'full_name', 'diagnosis_name', 'start_date', 'end_date', 'outcome', 'is_suspected'].map((k) => pyStr(or(dx[k], ''))));
        for (const d of item.diagnoses || []) {
          const ex = g.diagnoses.find((o) => sig(o) === sig(d));
          if (!ex) g.diagnoses.push(Object.assign({}, d)); else if (d.diagnosis_category === 'main') ex.diagnosis_category = 'main';
        }
        g.warning_messages = uniq(g.warning_messages.concat(item.warning_messages || []));
        g.visit_days = countedDates(g, truthyPy(g.public_only) ? '2' : '1').length;
        g.receipt_comments = [].concat(...g.source_billings.map((s) => s.receipt_comments || []));
        g.symptom_detail = uniq(g.source_billings.filter((s) => truthyPy(s.symptom_detail)).map((s) => s.symptom_detail)).join('\n');
        g.receipt_context_errors = uniq([].concat(...g.source_billings.map((s) => s.receipt_context_errors || [])));
        g.public_allocation_verified = g.source_billings.every((s) => truthyPy(s.public_allocation_verified));
        if (!g.public_allocation_verified && publicCoversAll(g)) Object.assign(g.public_expenses[0], { covered_score: g.total_score, visit_days: g.visit_days });
      }
      return [...groups.values()];
    }
    // receipt_integrity.order_receipt_details（一連の行為を切らずに診療識別の順へ並べる）
    function orderReceiptDetails(details) {
      details = details.slice(); const blocks = []; let active = [], activeKey = null;
      for (const d of details) {
        const group = pyStr(or(d.billing_group_id, ''));
        const key = JSON.stringify([isNone(d._source_billing_id) ? null : d._source_billing_id, isNone(d.billing_date) ? null : d.billing_date, group]);
        const cont = d.receipt_group_continuation === true || (!Object.prototype.hasOwnProperty.call(d, 'receipt_group_continuation') && group.startsWith('rx:')
          && ['drug', 'medicine', 'prescription'].includes(d.item_type) && truthyPy(d.billing_group_parent_id));
        if (active.length && key !== activeKey) return [details, ['診療識別の整列を中止しました。一連の行為の継続行と終端行の対応を確認してください']];
        if (cont && !group) return [details, ['診療識別の整列を中止しました。継続行の行為グループが未設定です']];
        active.push(d); activeKey = key;
        if (!cont) { blocks.push(active); active = []; activeKey = null; }
      }
      if (active.length) return [details, ['診療識別の整列を中止しました。一連の行為の終端行がありません']];
      blocks.sort((a, b) => parseInt(officialService(a[0]), 10) - parseInt(officialService(b[0]), 10));   // Array.prototype.sort は安定（Python の sort と同じ）
      return [[].concat(...blocks), []];
    }
    // comment_records_for_detail・comment_record_warnings（コメントのマスターは CM。無いときは空）
    function commentRecordsForDetail(detail) {
      const CMm = officialRowsComment(); const records = []; const mirrored = new Set();
      const codes = asList(detail.comment_codes).map((c) => strip(pyStr(or(c, ''))));
      asList(detail.comment_names).forEach((comment, i) => {
        const paired = i < codes.length ? codes[i] : '';
        if (isDict(comment)) {
          const code = strip(pyStr(or(comment.code, or(comment.comment_code, paired))));
          const m = CMm[code];
          const display = m && m[0] === '10' ? '' : or(comment.name, comment.template);
          const text = or(comment.freeText, or(comment.free_text, or(comment.text, or(display, ''))));
          splitCommentLines(or(comment.freeText, comment.free_text)).forEach((l) => mirrored.add(l));
          let lines = splitCommentLines(text); if (!lines.length) lines = code ? [''] : [];
          lines.forEach((line) => records.push({ code, text: line, free_text: code ? '' : '1' }));
        } else if (strip(pyStr(or(comment, '')))) {
          records.push({ code: paired, text: strip(pyStr(comment)), free_text: paired ? '' : '1' });
        }
      });
      codes.forEach((c) => { if (c && !records.some((r) => r.code === c)) records.push({ code: c, text: '', free_text: '' }); });
      splitCommentLines(detail.free_comment).forEach((l) => { if (!mirrored.has(l)) records.push({ code: '', text: l, free_text: '1' }); });
      records.forEach((r) => {
        if (!r.code && r.text) r.code = '810000001';
        const m = CMm[r.code]; if (m && m[0] === '20' && strip(r.text) === strip(m[1])) r.text = '';
      });
      const seen = new Set(); return records.filter((r) => { const k = JSON.stringify([r.code || '', r.text || '']); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    function validCommentEraDate(v) {
      if (!/^[1-5][0-9]{6}$/.test(v)) return false;
      const eras = { 1: [1867, '18680125', '19120729'], 2: [1911, '19120730', '19261224'], 3: [1925, '19261225', '19890107'], 4: [1988, '19890108', '20190430'], 5: [2018, '20190501', '99991231'] };
      const [off, s, e] = eras[v[0]]; const w = String(off + parseInt(v.slice(1, 3), 10)) + v.slice(3);
      return isValidYmd(w) && s <= w && w <= e;
    }
    function commentRecordWarnings(comment) {
      const code = pyStr(or(comment.code, '')), text = pyStr(or(comment.text, '')); const m = officialRowsComment()[code];
      if (!m) return ['公式コメントマスターにないコードです: ' + code];
      if (m[0] === '20' && text) return ['定型コメント ' + code + ' に任意文字列は記録できません。自由記載は810000001で入力してください'];
      const n = text.normalize('NFKC');
      if (m[0] === '50' && !validCommentEraDate(n)) return ['日付コメント ' + code + ' は元号を含む有効な年月日7桁で入力してください'];
      if (m[0] === '42' && !/^[+-]?[0-9]+(?:\.[0-9]+)?$/.test(n)) return ['数値コメント ' + code + ' の入力値を確認してください'];
      if (m[0] === '30' && !strip(text)) return ['文字列コメント ' + code + ' の本文が未入力です'];
      if (m[0] === '10') {
        if (!strip(text)) return ['自由記載コメントの本文が未入力です'];
        const t = receiptTextMode(text, true); if (canEncodeCp932(t) && cpLen(t) > 76) return ['自由記載コメントは1レコード38文字以内に分けてください'];
      }
      return [];
    }

    // ---- workers_comp_masters.py（WorkersCompMasterIndex）----
    function mDate(v) {
      const t = strip(pyStr(or(v, ''))).replace('-', '').replace('/', '');
      if (['', '00000000', '99999999'].includes(t)) return null;
      return isValidYmd(t) ? t : null;
    }
    const mActive = (s, e, on) => { const sd = mDate(s), ed = mDate(e); return (sd === null || sd <= on) && (ed === null || on <= ed); };
    const decimalOf = (v) => { const n = Number(strip(pyStr(or(v, '0'))) || '0'); return isFinite(n) ? n : 0; };
    const numberOf = (v) => { const d = decimalOf(v); return d > 0 ? d : 1; };
    const halfUp = (x) => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));
    const MI = {
      currentActionAux(code, on) { const rows = (master().V[code] || []).filter((r) => mActive(r[0], r[1], on)); return rows.length ? rows[rows.length - 1] : null; },
      currentMaterialAux(code, on) { const rows = (master().W[code] || []).filter((r) => mActive(r[0], r[1], on)); return rows.length ? rows[rows.length - 1] : null; },
      currentRelations(code, on) { return (master().Z[code] || []).filter((r) => mActive(r[2], r[3], on)); },
      actionCashAmount(code) { const r = master().R[code]; return r && r[0] === '1' ? decimalOf(r[1]) : 0; },
      actionPricing(code) { const r = master().R[code]; return r ? [r[0], decimalOf(r[1])] : ['', 0]; },
      actionService(code) { const r = master().R[code]; const v = r ? r[2] : ''; return v.length >= 3 && v[0].toUpperCase() === 'A' && /^\d\d$/.test(v.slice(1, 3)) ? v.slice(1, 3) : ''; },
      materialCashAmount(code) { const r = master().U[code]; return r && r[0] === '1' ? decimalOf(r[1]) : 0; },
      actionName(code) { const r = master().R[code]; return r ? r[3] : code; },
      validateDetail(detail, on, aftercare, submission) {
        const itemType = strip(pyStr(or(detail.item_type, or(detail.type, '')))).toLowerCase();
        const code = strip(pyStr(or(detail.code, or(detail.action_code, or(detail.material_code, '')))));
        if (!code || ['drug', 'medicine', 'prescription', 'self_pay'].includes(itemType)) return { blocking: [], advisory: [] };
        const blocking = [], advisory = []; let elig = '', limb = '0';
        if (['action', 'medical_action', 'procedure', 'si', 'ri'].includes(itemType)) {
          const aux = MI.currentActionAux(code, on);
          if (!aux) blocking.push('労災医科診療行為補助マスタに有効なコードがありません: ' + code); else { limb = aux[2] || '0'; elig = aux[3]; }
        } else if (['material', 'specific_material', 'to'].includes(itemType)) {
          const aux = MI.currentMaterialAux(code, on);
          if (!aux) blocking.push('特定器材労災補助マスタに有効なコードがありません: ' + code); else elig = aux[2];
        } else return { blocking: [], advisory: [] };
        if (elig === '2') blocking.push('労災保険では算定できないコードです: ' + code);
        else if (elig === '3' && !aftercare) blocking.push('アフターケア専用のため通常の労災診療費では算定できません: ' + code);
        const present = new Set(commentCodes(detail)); const eff = submission || on;
        const required = new Set(MI.currentRelations(code, on).filter((r) => r[0] === 'Z' && r[1]).map((r) => r[1]));
        if (required.size && ![...required].some((c) => present.has(c))) {
          const msg = MI.actionName(code) + '（' + code + '）に必要なコメントがありません（候補: ' + [...required].sort().join('・') + '）';
          if (['4', '5'].includes(limb) && eff < '20261101') advisory.push(msg); else blocking.push(msg);
        }
        return { blocking: uniq(blocking), advisory: uniq(advisory) };
      },
      validateAftercareDisease(code, on) {
        const n = strip(pyStr(or(code, ''))).padStart(2, '0'); const r = master().AC[n];
        if (!r || !mActive(r[0], r[1], on)) return 'アフターケア対象傷病コードを確認してください: ' + n;
        return null;
      },
    };
    function commentCodes(detail) {
      const vals = [];
      ['comments', 'receipt_comments', 'comment_records'].forEach((k) => { if (Array.isArray(detail[k])) vals.push(...detail[k]); });
      ['comment_code', 'receipt_comment_code'].forEach((k) => { if (truthyPy(detail[k])) vals.push(detail[k]); });
      return vals.map((v) => strip(pyStr(or(isDict(v) ? or(v.code, v.comment_code) : v, '')))).filter((x) => x);
    }
    function detailMasterCashAmount(detail) {
      const itemType = strip(pyStr(or(detail.item_type, or(detail.type, '')))).toLowerCase();
      const code = strip(pyStr(or(detail.code, or(detail.action_code, or(detail.material_code, '')))));
      let ex = detail.workers_amount; if (blank(ex)) ex = detail.labor_amount;
      const qty = numberOf(or(detail.count, detail.quantity));
      if (!blank(ex)) return halfUp(decimalOf(ex) * qty);
      let amount = 0;
      if (['action', 'medical_action', 'procedure', 'si', 'ri'].includes(itemType)) amount = MI.actionCashAmount(code);
      else if (['material', 'specific_material', 'to'].includes(itemType)) amount = MI.materialCashAmount(code);
      return halfUp(amount * qty);
    }

    // ---- workers_comp_uke_builder.py ----
    const WORKERS_RECORD_FIELD_COUNTS = { IR: 10, RE: 38, RR: 22, SY: 8, RI: 44, IY: 44, TO: 48, CO: 5, SJ: 3, RS: 13 };
    const AFTERCARE_RECORD_FIELD_COUNTS = { IR: 10, RE: 38, AR: 22, RI: 44, IY: 44, TO: 48, CO: 5, SJ: 3, AS: 13 };
    const INITIAL_NEW_CONTINUING_CODES = new Set(['1', '3', '7']);
    const WORKERS_NEW_CONTINUING_CODES = new Set(['1', '3', '5', '7']);
    const WORKERS_OUTCOME_CODES = new Set(['1', '3', '5', '7', '9']);
    const WORKERS_ACCIDENT_CODES = new Set(['1', '3']);
    const WORKERS_FORM_CODES = new Set(['2', '3', '4', '5']);
    const MAX_RECEIPTS_PER_FILE = 997;
    const KANA_RE = /^[ァ-ヶー]+(?:　[ァ-ヶー]+)+$/;
    function workersDetails(item) { let d = item.workers_comp_details; if (!isDict(d)) d = getClaimPayload(item).workers_comp_details; return isDict(d) ? d : {}; }
    function workerValue(item, names, dflt) {
      if (dflt === undefined) dflt = '';
      for (const src of [workersDetails(item), item, getClaimPayload(item)]) for (const n of names) { const v = src[n]; if (!blank(v)) return v; }
      return dflt;
    }
    function workersClaimType(item) { const v = strip(pyStr(or(workerValue(item, ['workers_claim_type', 'claim_type']), ''))).toLowerCase(); return ['aftercare', 'after_care', 'アフターケア', '2'].includes(v) ? 'aftercare' : 'medical'; }
    function workersIsInitial(item) {
      const ex = workerValue(item, ['is_initial_claim', 'initial_claim'], null);
      if (ex !== null) { if (typeof ex === 'string') return ['1', 'true', 'yes', 'initial', '初回'].includes(strip(ex).toLowerCase()); return truthyPy(ex); }
      return INITIAL_NEW_CONTINUING_CODES.has(pyStr(or(workerValue(item, ['new_continuing_code', 'new_continuing']), '')));
    }
    function aggregateWorkersReceipts(items) {
      const prepared = [];
      for (const item of items || []) {
        if (!isClaimIncluded(item)) continue;
        const id = ['labor_insurance_number', 'pension_certificate_number', 'injury_date', 'form_type_code'].map((n) => pyStr(or(workerValue(item, [n]), ''))).join('|');
        prepared.push(Object.assign({}, item, { insurance_number: id, workers_claim_identity: id }));
      }
      return aggregateReceipts(prepared);
    }
    function aftercareDates(item) {
      let consultation = formatDate(workerValue(item, ['aftercare_consultation_date', 'consultation_date']));
      let examination = formatDate(workerValue(item, ['aftercare_examination_date', 'examination_date', 'checkup_date']));
      if (consultation || examination) return [consultation, examination];
      const bd = formatDate(item.billing_date); let hasEx = false, hasCo = false;
      for (const d of getDetails(item)) {
        if (!shouldEmitDetail(d)) continue;
        const svc = diagnosisIdentifierCode(recordKindForDetail(d) || 'SI', d);
        if (svc === '60' || svc === '70') hasEx = true; else hasCo = true;
      }
      if (hasEx) examination = bd;
      if (hasCo || !hasEx) consultation = bd;
      return [consultation, examination];
    }
    function aggregateAftercareReceipts(items) {
      const prepared = [];
      for (const item of items || []) {
        if (!isClaimIncluded(item)) continue;
        const details = Object.assign({}, workersDetails(item)); const [c, e] = aftercareDates(item);
        details.workers_claim_type = 'aftercare'; details.aftercare_consultation_date = c; details.aftercare_examination_date = e;
        const id = ['aftercare_handbook_number', 'aftercare_disease_code', 'aftercare_consultation_date', 'aftercare_examination_date'].map((n) => pyStr(or(details[n], ''))).join('|');
        prepared.push(Object.assign({}, item, { workers_comp_details: details, insurance_number: id, workers_claim_identity: id }));
      }
      return aggregateReceipts(prepared);
    }
    function partitionWorkersReceipts(items) {
      const initial = new Map(); const continuing = [];
      for (const r of aggregateWorkersReceipts(items)) {
        if (workersIsInitial(r)) {
          const key = [digitsOnly(workerValue(r, ['labor_bureau_code'])).slice(0, 2), digitsOnly(workerValue(r, ['inspection_office_code'])).slice(0, 2)];
          const k = JSON.stringify(key); if (!initial.has(k)) initial.set(k, { key, list: [] }); initial.get(k).list.push(r);
        } else continuing.push(r);
      }
      const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      const groups = [...initial.values()].sort((a, b) => cmp(a.key[0], b.key[0]) || cmp(a.key[1], b.key[1])).map((g) => g.list);
      if (continuing.length) groups.push(continuing);
      return groups;
    }
    function partitionAftercareReceipts(items) {
      const rs = aggregateAftercareReceipts(items); const out = [];
      for (let i = 0; i < rs.length; i += MAX_RECEIPTS_PER_FILE) out.push(rs.slice(i, i + MAX_RECEIPTS_PER_FILE));
      return out;
    }
    function makeTypedRecord(counts, reMode, type, values) {
      const n = counts[type]; const f = new Array(n).fill(''); f[0] = type;
      Object.keys(values).forEach((k) => { const p = Number(k), v = values[k]; if (p > 1 && p <= n && !blank(v)) f[p - 1] = v; });
      const out = makeRecord(f, n).split(',');
      (reMode[type] || []).forEach((p) => { out[p - 1] = receiptTextMode(f[p - 1], true); });
      return out.join(',');
    }
    const makeWorkersRecord = (t, v) => makeTypedRecord(WORKERS_RECORD_FIELD_COUNTS, { RR: [13, 14, 15, 16], RS: [8, 9] }, t, v);
    const makeAftercareRecord = (t, v) => makeTypedRecord(AFTERCARE_RECORD_FIELD_COUNTS, { AR: [13, 16], AS: [8, 9] }, t, v);
    const makeWorkersInstitutionRecord = (f, month) => makeWorkersRecord('IR', { 3: facilityPrefectureCode(f), 4: pointTableCode(f), 5: medicalInstitutionCode7(f), 7: f.name, 8: month, 9: '00', 10: normalizePhone(f.phone) });
    function genderCode(v) {
      const n = strip(pyStr(or(v, ''))).toLowerCase();
      return { 1: '1', m: '1', male: '1', man: '1', '男': '1', '男性': '1', 2: '2', f: '2', female: '2', woman: '2', '女': '2', '女性': '2' }[n] || '';
    }
    const makeWorkersReceiptCommonRecord = (index, item) => makeWorkersRecord('RE', { 2: index, 5: item.patient_name, 6: genderCode(item.gender), 7: formatDate(item.birth_date),
      10: workerValue(item, ['inpatient_start_date', 'admission_date']), 11: workerValue(item, ['ward_code', 'ward_classification']), 14: item.patient_no,
      21: workerValue(item, ['claim_information', 'receipt_claim_information']), 22: workerValue(item, ['department_code']),
      37: workerValue(item, ['patient_kana_for_receipt']), 38: workerValue(item, ['patient_condition_codes']) });
    const personName = (v) => strip(pyStr(or(v, '')).normalize('NFKC')).split(RE_WS).filter((x) => x).join('　');   // workers_person_name・workers_kana
    const workersKana = personName;
    function treatmentDates(item) {
      const vals = [];
      for (const s of (truthyPy(item.source_billings) ? item.source_billings : [item])) { const v = formatDate(s.billing_date); if (v && !vals.includes(v)) vals.push(v); }
      return vals.sort();
    }
    function workersPointUnit(f) { const v = digitsOnly(or(f.workers_comp_point_unit, f.labor_point_unit)); return ['1150', '1200'].includes(v) ? parseInt(v, 10) : 1200; }
    function makeWorkersDiagnosisRecord(d) {
      const code = digitsOnly(or(d.diagnosis_code, d.disease_code));
      const name = or(d.full_name, or(d.diagnosis_name, or(d.name, '')));
      const mod = or(d.modifier_code, or(d.modifier_codes, ''));
      return makeWorkersRecord('SY', { 2: code || '0000999', 3: formatDate(or(d.start_date, d.diagnosis_date)), 5: normalizeModifierCodes(mod), 6: code ? '' : name,
        7: d.diagnosis_category === 'main' ? '01' : '', 8: or(d.supplement_comment, or(d.comment, '')) });
    }
    function workersActionPricing(detail) {
      const code = strip(pyStr(or(detail.code, or(detail.action_code, ''))));
      if (!code) return ['', 0];
      let kind, value; try { [kind, value] = MI.actionPricing(code); } catch (e) { return ['', 0]; }
      return [kind, Number.isInteger(value) ? value : 0];
    }
    function workersDetailService(kind, detail) {
      if (kind === 'RI') {
        const code = strip(pyStr(or(detail.code, or(detail.action_code, ''))));
        let svc = ''; try { svc = MI.actionService(code); } catch (e) { svc = ''; }
        if (svc) return svc;
      }
      return diagnosisIdentifierCode(kind === 'RI' ? 'SI' : kind, detail);
    }
    function workersDetailPointTotal(detail) {
      const kind = recordKindForDetail(detail); const count = detailCount(kind || 'SI', detail);
      if (kind === 'SI') { const [pk, mv] = workersActionPricing(detail); if (pk === '1') return 0; if (pk === '3' && mv) return mv * count; }
      const ex = intValue(detail.score); return ex ? ex : unitPoints(detail, count) * count;
    }
    function workersExplicitCashGroups(details) {
      const g = new Set();
      for (const d of details) { const group = strip(pyStr(or(d.billing_group_id, ''))); if (group && !blank(workerValue(d, ['workers_amount', 'labor_amount'], null))) g.add(group); }
      return g;
    }
    function workersAmounts(item, unit) {
      const details = getDetails(item).filter(shouldEmitDetail);
      const score = details.length && workersClaimType(item) === 'medical' ? details.reduce((s, d) => s + workersDetailPointTotal(d), 0) : intValue(item.total_score);
      const converted = Math.floor(score * unit / 100);
      const mealCount = intValue(workerValue(item, ['meal_count', 'diet_count']));
      const mealAmount = intValue(workerValue(item, ['meal_total_amount', 'diet_total_amount']));
      const exSub = workerValue(item, ['amount_subtotal', 'workers_amount_subtotal'], null);
      const exTotal = workerValue(item, ['claim_total_amount', 'workers_claim_total'], null);
      let subtotal;
      if (exSub !== null) subtotal = intValue(exSub);
      else if (exTotal !== null) subtotal = Math.max(0, intValue(exTotal) - converted - mealAmount);
      else { try { master(); subtotal = getDetails(item).filter(shouldEmitDetail).reduce((s, d) => s + detailMasterCashAmount(d), 0); } catch (e) { subtotal = 0; } }
      const total = intValue(exTotal, converted + subtotal + mealAmount);
      return [score, converted, subtotal, mealCount, (mealCount || mealAmount) ? mealAmount : 0, total];
    }
    function makeWorkersReceiptRecord(item, f) {
      const dates = treatmentDates(item);
      const start = or(workerValue(item, ['treatment_start_date']), dates.length ? dates[0] : '');
      const end = or(workerValue(item, ['treatment_end_date']), dates.length ? dates[dates.length - 1] : '');
      const [score, converted, subtotal, mealCount, mealAmount, total] = workersAmounts(item, workersPointUnit(f));
      const pension = digitsOnly(workerValue(item, ['pension_certificate_number']));
      const laborNumber = pension ? '' : (digitsOnly(workerValue(item, ['labor_insurance_number'])) || '99999999999999');
      const injury = pension ? '' : formatDate(workerValue(item, ['injury_date']));
      return makeWorkersRecord('RR', { 2: workerValue(item, ['same_injury_count']), 3: workerValue(item, ['accident_type_code', 'accident_type']), 4: workerValue(item, ['form_type_code', 'form_type']),
        5: pension, 6: laborNumber, 7: injury, 8: workerValue(item, ['new_continuing_code', 'new_continuing']), 9: workerValue(item, ['outcome_code', 'workers_outcome_code']),
        10: formatDate(start), 11: formatDate(end), 12: intValue(workerValue(item, ['actual_treatment_days']), dates.length),
        13: receiptTextMode(workersKana(or(workerValue(item, ['worker_kana']), item.patient_kana)), true), 14: receiptTextMode(workerValue(item, ['business_name']), true),
        15: receiptTextMode(workerValue(item, ['business_address']), true), 16: receiptTextMode(workerValue(item, ['injury_course', 'course']), true),
        17: score, 18: converted, 19: subtotal, 20: or(mealCount, ''), 21: or(mealAmount, ''), 22: total });
    }
    function makeWorkersDetailRecord(kind, detail, item, serviceOverride, suppressMasterCash) {
      const service = isNone(serviceOverride) ? workersDetailService(kind, detail) : pyStr(serviceOverride);
      const count = detailCount(kind === 'RI' ? 'SI' : kind, detail);
      const visitDay = receiptVisitDay(truthyPy(detail.billing_date) ? detail : item);
      const code = or(detail.code, or(detail.action_code, or(detail.drug_code, detail.material_code)));
      let values;
      if (kind === 'RI') {
        let point = unitPoints(detail, count); let amount = workerValue(detail, ['workers_amount', 'labor_amount']);
        const [pk, mv] = workersActionPricing(detail);
        if (pk === '1') { point = ''; if (blank(amount) && !suppressMasterCash) amount = mv; }
        else if (pk === '3') { amount = ''; if (!truthyPy(point)) point = mv; }
        values = Object.assign({ 2: service, 3: code, 4: quantityForDetail('SI', detail), 5: point, 6: amount, 7: count }, calculationDayValues('SI', visitDay, count));
      } else if (kind === 'IY') {
        values = Object.assign({ 2: service, 4: code, 5: quantityForDetail('IY', detail), 6: unitPoints(detail, count), 7: count }, calculationDayValues('IY', visitDay, count));
      } else {
        values = Object.assign({ 2: service, 4: code, 5: quantityForDetail('TO', detail), 6: unitPoints(detail, count), 7: count,
          8: workerValue(detail, ['material_unit_code', 'unit_code']), 9: workerValue(detail, ['unit_price', 'material_unit_price']),
          10: formatDate(workerValue(detail, ['purchase_date'])), 11: workerValue(detail, ['product_spec', 'standard_name', 'name']) }, calculationDayValues('TO', visitDay, count));
      }
      return makeWorkersRecord(kind, values);
    }
    const makeWorkersCommentRecord = (detail, comment) => makeWorkersRecord('CO', { 2: diagnosisIdentifierCode(recordKindForDetail(detail) || 'SI', detail), 4: comment.code, 5: comment.text });
    function makeWorkersClaimRecord(receipts, f, submitted) {
      const first = receipts[0]; const initial = workersIsInitial(first); const unit = workersPointUnit(f);
      const total = receipts.reduce((s, it) => s + workersAmounts(it, unit)[5], 0);
      return makeWorkersRecord('RS', { 2: digitsOnly(or(f.workers_comp_facility_type, '3')).slice(0, 1), 3: formatDate(submitted) || todayYmd(),
        4: initial ? digitsOnly(workerValue(first, ['labor_bureau_code'])).slice(0, 2) : '', 5: initial ? digitsOnly(workerValue(first, ['inspection_office_code'])).slice(0, 2) : '',
        6: digitsOnly(f.labor_insurance_code).slice(0, 7), 7: zeroFill(f.postal_code, 7), 8: receiptTextMode(f.address, true),
        9: receiptTextMode(personName(or(f.founder_name, f.representative_name)), true), 10: unit, 11: total, 12: receipts.length, 13: '99' });
    }
    function makeAftercareReceiptRecord(item, f) {
      const [c, e] = aftercareDates(item); const [score, converted, subtotal, , , total] = workersAmounts(item, workersPointUnit(f));
      return makeAftercareRecord('AR', { 4: '2', 5: digitsOnly(workerValue(item, ['aftercare_disease_code'])).slice(0, 2), 6: digitsOnly(workerValue(item, ['aftercare_handbook_number'])).slice(0, 13),
        7: formatDate(workerValue(item, ['aftercare_previous_examination_date', 'previous_examination_date'])), 10: c, 11: e,
        13: receiptTextMode(workersKana(or(workerValue(item, ['worker_kana']), item.patient_kana)), true), 16: receiptTextMode(workerValue(item, ['injury_course', 'course']), true),
        17: score, 18: converted, 19: subtotal, 22: total });
    }
    function makeAftercareClaimRecord(receipts, f, submitted) {
      const unit = workersPointUnit(f); const total = receipts.reduce((s, it) => s + workersAmounts(it, unit)[5], 0);
      return makeAftercareRecord('AS', { 2: digitsOnly(or(f.workers_comp_facility_type, '3')).slice(0, 1), 3: formatDate(submitted) || todayYmd(), 6: digitsOnly(f.labor_insurance_code).slice(0, 7),
        7: zeroFill(f.postal_code, 7), 8: receiptTextMode(f.address, true), 9: receiptTextMode(personName(or(f.founder_name, f.representative_name)), true), 10: unit, 11: total, 12: receipts.length });
    }
    function todayYmd() { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10).replace(/-/g, ''); }   // 日本時間
    function validateWorkersFacility(f) {
      const w = [];
      if (digitsOnly(f.labor_insurance_code).length !== 7) w.push('労災指定医療機関番号は7桁で入力してください');
      if (!facilityPrefectureCode(f)) w.push('都道府県コードを施設住所または施設設定から判定できません');
      for (const [label, value, limit] of [['医療機関名', f.name, 40], ['医療機関所在地', f.address, 80], ['医療機関責任者氏名', or(f.founder_name, f.representative_name), 40]]) {
        const t = receiptTextMode(value, true);
        if (!t) w.push(label + 'が未入力です');
        else if (!canEncodeCp932(t) || cpLen(t) > limit) w.push(label + 'が労災レセ電の' + limit + 'バイト上限を超えるか文字コード外です');
      }
      const rep = personName(or(f.founder_name, f.representative_name));
      if (rep && !/^\S+　\S+$/.test(rep)) w.push('医療機関責任者氏名は姓と名を全角スペースで区切って入力してください');
      return w;
    }
    function workersServiceDate(item) { const v = formatDate(item.billing_date); return isValidYmd(v) ? v : todayYmd(); }
    function validateWorkersMasterRules(item, submitted) {
      const blocking = [], advisory = [];
      try { master(); } catch (e) { return [['【点検未完了】労災公式マスターを読み込めません: ' + e.message], []]; }
      const on = workersServiceDate(item); const sub = formatDate(submitted); const subDate = isValidYmd(sub) ? sub : null;
      const aftercare = strip(pyStr(workerValue(item, ['workers_claim_type', 'claim_type']))) === 'aftercare';
      if (aftercare) { const m = MI.validateAftercareDisease(workerValue(item, ['aftercare_disease_code']), on); if (m) blocking.push(m); }
      for (const d of getDetails(item)) {
        if (!shouldEmitDetail(d)) continue;
        const r = MI.validateDetail(d, on, aftercare, subDate); blocking.push(...r.blocking); advisory.push(...r.advisory);
      }
      return [uniq(blocking), uniq(advisory)];
    }
    const detailCodeLabel = (kind) => (kind === 'SI' ? '診療行為' : kind === 'IY' ? '医薬品' : '特定器材');
    function validateWorkersItem(item, isResubmission, submitted) {
      const w = [];
      const name = receiptTextMode(item.patient_name);
      if (!name) w.push('患者氏名が未入力です'); else if (!canEncodeCp932(name) || cpLen(name) > 40) w.push('患者氏名が労災レセ電の40バイト上限を超えるか文字コード外です');
      if (!genderCode(item.gender)) w.push('患者性別が未入力です');
      if (formatDate(item.birth_date).length !== 8) w.push('患者生年月日を確認してください');
      const accident = pyStr(or(workerValue(item, ['accident_type_code', 'accident_type']), '')), form = pyStr(or(workerValue(item, ['form_type_code', 'form_type']), ''));
      const newCode = pyStr(or(workerValue(item, ['new_continuing_code', 'new_continuing']), '')), outcome = pyStr(or(workerValue(item, ['outcome_code', 'workers_outcome_code']), ''));
      if (!WORKERS_ACCIDENT_CODES.has(accident)) w.push('業務災害・通勤災害区分は1または3で入力してください');
      if (!WORKERS_FORM_CODES.has(form)) w.push('労災帳票種別は2・3・4・5のいずれかで入力してください');
      const admission = formatDate(workerValue(item, ['inpatient_start_date', 'admission_date']));
      if (['2', '4'].includes(form) && admission.length !== 8) w.push('入院用の帳票種別には入院年月日が必要です。外来の場合は帳票種別3または5を選択してください');
      if (['3', '5'].includes(form) && admission) w.push('入院年月日があるため、帳票種別は入院用の2または4を確認してください');
      if (!WORKERS_NEW_CONTINUING_CODES.has(newCode)) w.push('新継再別は1・3・5・7のいずれかで入力してください');
      if (!WORKERS_OUTCOME_CODES.has(outcome)) w.push('転帰事由は1・3・5・7・9のいずれかで入力してください');
      const pension = digitsOnly(workerValue(item, ['pension_certificate_number'])), labor = digitsOnly(workerValue(item, ['labor_insurance_number']));
      if (pension && pension.length > 9) w.push('年金証書番号は9桁以内で入力してください');
      if (!pension && labor.length !== 14) w.push('労働保険番号は14桁で入力してください');
      if (!pension && formatDate(workerValue(item, ['injury_date'])).length !== 8) w.push('傷病年月日を入力してください');
      const dates = treatmentDates(item);
      if (!dates.length) w.push('療養期間と診療実日数を確認できません');
      const ts = formatDate(or(workerValue(item, ['treatment_start_date']), dates.length ? dates[0] : ''));
      const te = formatDate(or(workerValue(item, ['treatment_end_date']), dates.length ? dates[dates.length - 1] : ''));
      if (ts.length === 8 && te.length === 8 && ts.slice(0, 6) !== te.slice(0, 6)) w.push('療養期間－初日と療養期間－末日は同一年月で記録してください（R2163）');
      const kana = workersKana(or(workerValue(item, ['worker_kana']), item.patient_kana));
      if (!kana || !KANA_RE.test(kana)) w.push('労働者氏名カナは姓と名を全角スペースで区切って入力してください');
      else if (cpLen(kana) > 40) w.push('労働者氏名カナは20文字以内で入力してください');
      const course = receiptTextMode(workerValue(item, ['injury_course', 'course']), true);
      if (!course) w.push('傷病の経過を入力してください'); else if (!canEncodeCp932(course) || cpLen(course) > 100) w.push('傷病の経過は労災レセ電の100バイト以内で入力してください');
      if (workersIsInitial(item)) {
        if (digitsOnly(workerValue(item, ['labor_bureau_code'])).length !== 2) w.push('初回請求の都道府県労働局コードは2桁で入力してください');
        if (digitsOnly(workerValue(item, ['inspection_office_code'])).length !== 2) w.push('初回請求の労働基準監督署コードは2桁で入力してください');
        if (!truthyPy(workerValue(item, ['business_name']))) w.push('初回請求の事業場名称を入力してください');
        if (!truthyPy(workerValue(item, ['business_address']))) w.push('初回請求の事業場所在地を入力してください');
      }
      if (!getDiagnoses(item).filter((d) => !isDeletedDiagnosis(d)).length) w.push('傷病名が未登録です');
      const details = getDetails(item).filter(shouldEmitDetail);
      if (!details.length) w.push('算定明細がありません');
      for (const d of details) {
        const kind = recordKindForDetail(d); const code = digitsOnly(or(d.code, or(d.action_code, or(d.drug_code, d.material_code))));
        if (kind && code.length !== 9) w.push('労災' + detailCodeLabel(kind) + 'コードは9桁で入力してください');
        for (const c of commentRecordsForDetail(d)) w.push(...commentRecordWarnings(c));
      }
      w.push(...validateWorkersMasterRules(item, submitted)[0]);
      if (isResubmission && !strip(pyStr(or(workerValue(item, ['claim_information', 'receipt_claim_information']), '')))) w.push('返戻再請求には返戻ファイルの電算処理受付番号が必要です');
      return uniq(w);
    }
    function validateAftercareItem(item, isResubmission, submitted) {
      const w = [];
      const name = receiptTextMode(item.patient_name);
      if (!name) w.push('患者氏名が未入力です'); else if (!canEncodeCp932(name) || cpLen(name) > 40) w.push('患者氏名がアフターケアレセ電の40バイト上限を超えるか文字コード外です');
      if (!genderCode(item.gender)) w.push('患者性別が未入力です');
      if (formatDate(item.birth_date).length !== 8) w.push('患者生年月日を確認してください');
      const disease = digitsOnly(workerValue(item, ['aftercare_disease_code'])), handbook = digitsOnly(workerValue(item, ['aftercare_handbook_number']));
      if (disease.length !== 2) w.push('アフターケア対象傷病コードは2桁で入力してください');
      if (handbook.length !== 13) w.push('アフターケア手帳番号は13桁で入力してください');
      const prevRaw = workerValue(item, ['aftercare_previous_examination_date', 'previous_examination_date']);
      if (!blank(prevRaw) && formatDate(prevRaw).length !== 8) w.push('前回の検査年月日を確認してください');
      const [c, e] = aftercareDates(item);
      if (!c && !e) w.push('診察年月日または検査年月日（健康診断年月日）のいずれかを入力してください');
      if (c && e && c !== e) w.push('診察年月日と検査年月日を両方記録する場合は同一日にしてください');
      const sub = formatDate(submitted);
      for (const [label, v] of [['診察年月日', c], ['検査年月日', e]]) if (v && sub && v > sub) w.push(label + 'が請求書提出年月日より後です');
      const kana = workersKana(or(workerValue(item, ['worker_kana']), item.patient_kana));
      if (!kana || !KANA_RE.test(kana)) w.push('労働者氏名カナは姓と名を全角スペースで区切って入力してください');
      else if (cpLen(kana) > 40) w.push('労働者氏名カナは20文字以内で入力してください');
      const course = receiptTextMode(workerValue(item, ['injury_course', 'course']), true);
      if (!course) w.push('傷病の経過を入力してください'); else if (!canEncodeCp932(course) || cpLen(course) > 100) w.push('傷病の経過はアフターケアレセ電の100バイト以内で入力してください');
      const details = getDetails(item).filter(shouldEmitDetail);
      if (!details.length) w.push('算定明細がありません');
      for (const d of details) {
        const kind = recordKindForDetail(d); const code = digitsOnly(or(d.code, or(d.action_code, or(d.drug_code, d.material_code))));
        if (kind && code.length !== 9) w.push('アフターケア' + detailCodeLabel(kind) + 'コードは9桁で入力してください');
        for (const cm of commentRecordsForDetail(d)) w.push(...commentRecordWarnings(cm));
      }
      w.push(...validateWorkersMasterRules(item, submitted)[0]);
      if (isResubmission && !strip(pyStr(or(workerValue(item, ['claim_information', 'receipt_claim_information']), '')))) w.push('アフターケア返戻再請求には電算処理受付番号が必要です');
      return uniq(w);
    }
    function parseRows(body) { return body.split('\r\n').filter((l) => l !== '').map((l) => l.split(',')); }
    function validateSerializedWorkers(content) {
      const w = [];
      if (!content.endsWith('\r\n\x1a') || content.split('\x1a').length - 1 !== 1) w.push('労災UKEは最終CRLFの後にEOF（0x1A）を1つ記録してください');
      const body = content.endsWith('\x1a') ? content.slice(0, -1) : content;
      if (/(?<!\r)\n|\r(?!\n)/.test(body)) w.push('労災UKEの改行はCRLFで記録してください');
      const rows = parseRows(body); const kinds = rows.map((r) => r[0]);
      if (!kinds.length || kinds[0] !== 'IR' || kinds.filter((k) => k === 'IR').length !== 1) w.push('労災UKEのIRは先頭に1件必要です');
      if (!kinds.length || kinds[kinds.length - 1] !== 'RS' || kinds.filter((k) => k === 'RS').length !== 1) w.push('労災UKEのRSは末尾に1件必要です');
      const nums = [], totals = []; let awaiting = false, admission = '';
      rows.forEach((row, i) => {
        const kind = row[0];
        if (awaiting && kind !== 'RR') { w.push('労災UKEのRE直後にRRがありません'); awaiting = false; }
        const expected = WORKERS_RECORD_FIELD_COUNTS[kind];
        if (expected === undefined) { w.push('労災UKE ' + (i + 1) + '行のレコード種別' + kind + 'は使用できません'); return; }
        if (row.length !== expected) { w.push('労災UKE ' + kind + 'の項目数が不正です'); return; }
        if (kind === 'RE') { if (awaiting) w.push('労災UKEのRE直後にRRがありません'); awaiting = true; nums.push(intValue(row[1])); admission = row[9]; }
        else if (kind === 'RR') {
          if (!awaiting) w.push('労災UKEのRRに対応するREがありません'); awaiting = false; totals.push(intValue(row[21]));
          const form = row[3];
          if (['2', '4'].includes(form) && !admission) w.push('入院用の帳票種別に対してREの入院年月日が記録されていません');
          if (['3', '5'].includes(form) && admission) w.push('入院外用の帳票種別に対してREへ入院年月日が記録されています');
          if (row[12] && !/^[ァ-ヶー]+　[ァ-ヶー]+$/.test(row[12])) w.push('RRの労働者氏名カナは姓と名を全角スペースで区切ってください');
          if (row[9].length === 8 && row[10].length === 8 && row[9].slice(0, 6) !== row[10].slice(0, 6)) w.push('労災UKEの療養期間－初日と末日は同一年月で記録してください（R2163）');
        } else if (kind === 'SY') {
          if (!nums.length) w.push('労災UKEのSYに対応するREがありません');
          if (row[3]) w.push('労災UKEのSY予備1は省略してください');
        } else if (kind === 'RI') {
          if (!nums.length) w.push('労災UKEのRIに対応するREがありません');
          const code = row[2]; const [pk, mv] = workersActionPricing({ code });
          if (pk === '1' && row[4]) w.push('労災金額項目' + code + 'はRIの点数欄を空欄にしてください');
          if (pk === '1' && intValue(row[5]) !== Math.trunc(mv)) w.push('労災金額項目' + code + 'の金額は' + Math.trunc(mv) + '円で記録してください');
          if (pk === '3' && row[5]) w.push('労災点数項目' + code + 'はRIの金額欄を空欄にしてください');
          if (pk === '3' && intValue(row[4]) !== Math.trunc(mv)) w.push('労災点数項目' + code + 'の点数は' + Math.trunc(mv) + '点で記録してください');
          let off = ''; try { off = MI.actionService(code); } catch (e) { off = ''; }
          if (row[1] && off && row[1] !== off) w.push('労災診療行為' + code + 'の診療識別は' + off + 'で記録してください');
        } else if (['IY', 'TO', 'CO', 'SJ'].includes(kind) && !nums.length) w.push('労災UKEの' + kind + 'に対応するREがありません');
      });
      if (awaiting) w.push('労災UKEのRE直後にRRがありません');
      if (JSON.stringify(nums) !== JSON.stringify(nums.map((_, i) => i + 1))) w.push('労災UKEのレセプト番号は1からの連番で記録してください');
      if (rows.length && rows[rows.length - 1][0] === 'RS' && rows[rows.length - 1].length === 13) {
        const rs = rows[rows.length - 1];
        if (intValue(rs[11]) !== nums.length) w.push('労災UKEのRS内訳書添付枚数とRE件数が一致しません');
        if (intValue(rs[10]) !== totals.reduce((s, x) => s + x, 0)) w.push('労災UKEのRS請求金額とRR合計額が一致しません');
        if (rs[12] !== '99') w.push('単一ボリュームの労災UKEはRS識別情報を99で記録してください');
        if (rs[8] && !/^\S+　\S+$/.test(rs[8])) w.push('RSの医療機関責任者氏名は姓と名を全角スペースで区切ってください');
      }
      return uniq(w);
    }
    function validateSerializedAftercare(content) {
      const w = [];
      if (!content.endsWith('\r\n\x1a') || content.split('\x1a').length - 1 !== 1) w.push('アフターケアUKEは最終CRLFの後にEOF（0x1A）を1つ記録してください');
      const body = content.endsWith('\x1a') ? content.slice(0, -1) : content;
      if (/(?<!\r)\n|\r(?!\n)/.test(body)) w.push('アフターケアUKEの改行はCRLFで記録してください');
      const rows = parseRows(body); const kinds = rows.map((r) => r[0]);
      if (!kinds.length || kinds[0] !== 'IR' || kinds.filter((k) => k === 'IR').length !== 1) w.push('アフターケアUKEのIRは先頭に1件必要です');
      if (!kinds.length || kinds[kinds.length - 1] !== 'AS' || kinds.filter((k) => k === 'AS').length !== 1) w.push('アフターケアUKEのASは末尾に1件必要です');
      const nums = [], totals = []; let awaiting = false;
      rows.forEach((row, i) => {
        const kind = row[0];
        if (awaiting && kind !== 'AR') { w.push('アフターケアUKEのRE直後にARがありません'); awaiting = false; }
        const expected = AFTERCARE_RECORD_FIELD_COUNTS[kind];
        if (expected === undefined) { w.push('アフターケアUKE ' + (i + 1) + '行のレコード種別' + kind + 'は使用できません'); return; }
        if (row.length !== expected) w.push('アフターケアUKE ' + (i + 1) + '行の' + kind + 'は' + expected + '項目必要です');
        if (kind === 'RE') { if (awaiting) w.push('アフターケアUKEのRE直後にARがありません'); nums.push(intValue(row.length > 1 ? row[1] : 0)); awaiting = true; }
        else if (kind === 'AR') { if (!awaiting) w.push('アフターケアUKEのARに対応するREがありません'); awaiting = false; totals.push(intValue(row.length > 21 ? row[21] : 0)); }
        else if (!['IR', 'AS'].includes(kind) && !nums.length) w.push('アフターケアUKEの' + kind + 'に対応するREがありません');
      });
      if (awaiting) w.push('アフターケアUKEのRE直後にARがありません');
      if (JSON.stringify(nums) !== JSON.stringify(nums.map((_, i) => i + 1))) w.push('アフターケアUKEのレセプト番号は1からの連番で記録してください');
      if (rows.length && rows[rows.length - 1][0] === 'AS' && rows[rows.length - 1].length === 13) {
        const c = rows[rows.length - 1];
        if (intValue(c[11]) !== nums.length) w.push('アフターケアUKEのAS内訳書添付枚数とRE件数が一致しません');
        if (intValue(c[10]) !== totals.reduce((s, x) => s + x, 0)) w.push('アフターケアUKEのAS請求金額とAR合計額が一致しません');
      }
      return uniq(w);
    }
    // build_workers_comp_uke_file と build_aftercare_uke_file（違いは RR/AR・RS/AS・点検の関数だけ）
    function buildFile(aftercare, receipts, f, claimKind, submitted, isResubmission, allowWarnings) {
      let warnings = validateWorkersFacility(f).map((v) => '医療機関: ' + v);
      const details = warnings.map((m) => ({ message: m, scope: 'facility' }));
      const counts = {}; const inc = (k) => { counts[k] = (counts[k] || 0) + 1; };
      const months = receipts.map((r) => normalizeClaimMonth(or(r.receipt_claim_month, r.billing_date))).filter((m) => m);
      const serviceMonth = months.length ? months.reduce((a, b) => (b > a ? b : a)) : '';
      const lines = [makeWorkersInstitutionRecord(f, serviceMonth)]; inc('IR');
      receipts.forEach((item, idx) => {
        const iw = aftercare ? validateAftercareItem(item, isResubmission, submitted) : validateWorkersItem(item, isResubmission, submitted);
        const label = pyStr(or(item.patient_no, '患者番号未設定'));
        warnings.push(...iw.map((m) => label + ': ' + m));
        details.push(...iw.map((m) => ({ message: m, scope: 'claim', billing_id: item.billing_id, patient_id: item.patient_id, patient_no: item.patient_no, patient_name: item.patient_name, billing_date: item.billing_date })));
        lines.push(makeWorkersReceiptCommonRecord(idx + 1, item)); inc('RE');
        if (aftercare) { lines.push(makeAftercareReceiptRecord(item, f)); inc('AR'); }
        else {
          lines.push(makeWorkersReceiptRecord(item, f)); inc('RR');
          for (const d of getDiagnoses(item)) if (!isDeletedDiagnosis(d)) { lines.push(makeWorkersDiagnosisRecord(d)); inc('SY'); }
        }
        const payload = getClaimPayload(item);
        for (const r of makeReceiptSummaryCommentRecords(item, payload, 'upper')) { lines.push(r); inc('CO'); }
        const [ordered] = orderReceiptDetails(getDetails(item).filter(shouldEmitDetail));
        const cashGroups = workersExplicitCashGroups(ordered); let lastService = '';
        for (const d of ordered) {
          const mk = recordKindForDetail(d); if (!mk) continue;
          const kind = mk === 'SI' ? 'RI' : mk; const service = workersDetailService(kind, d);
          const emitted = service !== lastService ? service : '';
          const group = strip(pyStr(or(d.billing_group_id, '')));
          lines.push(makeWorkersDetailRecord(kind, d, item, emitted, !!(group && cashGroups.has(group)))); inc(kind);
          if (service) lastService = service;
          for (const c of commentRecordsForDetail(d)) { lines.push(makeWorkersCommentRecord(d, c)); inc('CO'); }
        }
        for (const r of makeReceiptSummaryCommentRecords(item, payload, 'lower')) { lines.push(r); inc('CO'); }
        for (const r of makeSymptomDetailRecords(item, payload)) { lines.push(r); inc('SJ'); }
      });
      if (aftercare) { lines.push(makeAftercareClaimRecord(receipts, f, submitted)); inc('AS'); }
      else { lines.push(makeWorkersClaimRecord(receipts, f, submitted)); inc('RS'); }
      const content = lines.join('\r\n') + '\r\n\x1a';
      const fw = aftercare ? validateSerializedAftercare(content) : validateSerializedWorkers(content);
      warnings.push(...fw); details.push(...fw.map((m) => ({ message: m, scope: 'format' })));
      warnings = uniq(warnings);
      return { content: claimKind === 'submission' && warnings.length && !allowWarnings ? '' : content, warnings, record_counts: counts, included_count: receipts.length, skipped_count: 0, warning_details: details };
    }
    // build_workers_comp_uke_exports
    function buildExports(items, f, claimMonth, claimKind, submitted, allowWarnings) {
      const exports = []; const src = (items || []).slice();
      for (const [type, prefix, partition, aftercare] of [['medical', 'RREC', partitionWorkersReceipts, false], ['aftercare', 'AREC', partitionAftercareReceipts, true]]) {
        const typed = src.filter((it) => workersClaimType(it) === type);
        const regular = typed.filter((it) => pyStr(or(it.claim_status, '')) !== 'resubmit'), resub = typed.filter((it) => pyStr(or(it.claim_status, '')) === 'resubmit');
        for (const [ext, subset, isResub] of [['UKE', regular, false], ['UKS', resub, true]]) {
          partition(subset).forEach((receipts, i) => {
            const result = buildFile(aftercare, receipts, f, claimKind, submitted, isResub, !!allowWarnings);
            if (receipts.length > MAX_RECEIPTS_PER_FILE) {
              const msg = '同一' + (type === 'aftercare' ? 'アフターケア委託費請求書' : '労災診療費請求書') + 'が997件を超えています。分割して作成してください';
              result.warnings.unshift(msg); result.warning_details.unshift({ message: msg, scope: 'format' });
              if (claimKind === 'submission' && !allowWarnings) result.content = '';
            }
            exports.push({ payer_group: 'workers', folder: 'rousai', filename: prefix + String(i + 1).padStart(2, '0') + '00.' + ext, items: receipts, result, is_resubmission: isResub, workers_claim_type: type });
          });
        }
      }
      return exports;
    }
    return { setMasters, buildExports, validateWorkersItem, validateWorkersMasterRules, workersAmounts, workersPointUnit, workersClaimType, encodeCp932, cpLen, genderCode, formatDate, todayYmd };
  })();
  root.__compatWorkersBuilder = WB;   // 単体の突き合わせ（Node）からも使えるように出しておく

  // ================================================================
  // 置き換え層：基準版の /receipt-claims/… の労災・自賠責
  // ================================================================
  const C = root.__compat; if (!C || typeof C.routeOf !== 'function') return;
  const { on, err, json, clinicId } = C;
  const CAT = { workers: '労災', auto_liability: '自賠責' };
  const LABOR = ['labor', 'workers', 'workers_comp'], AUTO = ['auto', 'auto_liability', 'automobile'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const ymOf = (v) => String(v || '').slice(0, 7);
  const nextYm = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + pad2(m + 1); };
  const one = (x) => (Array.isArray(x) ? x[0] || null : x || null);
  const toInt = (v) => { const n = Math.trunc(Number(v)); return isFinite(n) ? n : 0; };

  // ---- マスター ----
  let masterPromise = null;
  function loadMasters() {
    if (!masterPromise) masterPromise = (async () => {
      try { const r = await C.realFetch('compat/workers_masters.json?v=20260924'); WB.setMasters(r.ok ? await r.json() : null); } catch (e) { WB.setMasters(null); }
    })();
    return masterPromise;
  }

  // ---- 基準版の画面と同じ問い合わせで読む（保険・傷病名・施設。置き換え層の他の部品が答える） ----
  async function api(path) {
    const r = await window.fetch('/api/v1' + path, { method: 'GET' });
    if (!r.ok) throw new Error('読み込めません: ' + path + ' (' + r.status + ')');
    return r.json();
  }
  async function facility() {
    const cur = await api('/facilities/current').catch(() => ({}));
    const acc = await api('/facilities/accident-settings').catch(() => ({}));
    const f = { id: clinicId(), facility_code: clinicId(), name: cur.name || cur.facility_name || '', postal_code: cur.postal_code || null, address: cur.address || null, phone: cur.phone || null,
      fax: cur.fax || null, medical_institution_code: cur.medical_institution_code || null, founder_name: cur.founder_name || null,
      labor_insurance_code: acc.labor_insurance_code || '', workers_comp_point_unit: '1200', workers_comp_facility_type: '3' };
    return f;
  }

  // ---- 記録の行為（基準版の billings）→ レセプトの明細（基準版 billing_item_to_claim_item の形） ----
  const isSelfPay = (b) => !!(b.is_self_pay || b.item_type === 'self_pay' || String(b.category || '') === '自費' || String(b.billing_code || '').startsWith('SELF_'));
  function claimDetail(b, i, vid) {
    const t = isSelfPay(b) ? 'self_pay' : (b.item_type || 'action');
    const code = String(b.billing_code || b.code || '').trim();
    const qty = Number(b.quantity || 1) || 1, unit = b.do_not_bill ? 0 : toInt(b.points != null ? b.points : b.unit_score);
    const comments = Array.isArray(b.comments) ? b.comments : (Array.isArray(b.comment_names) ? b.comment_names : []);
    return { id: vid + '-bi' + i, item_type: t, code: t === 'self_pay' ? '' : code, name: b.billing_name || b.name || '', unit_score: unit, quantity: qty,
      drug_quantity: b.drug_quantity != null && b.drug_quantity !== '' ? Number(b.drug_quantity) : null, drug_unit: b.drug_unit || '', material_quantity: b.material_quantity != null && b.material_quantity !== '' ? Number(b.material_quantity) : null,
      score: t === 'self_pay' ? 0 : unit * toInt(qty), amount: t === 'self_pay' ? toInt(b.unit_price || b.amount) * toInt(qty) : unit * toInt(qty) * 10,
      category_name: b.category || '', category_code: b.category_code || '', diagnosis_identifier: b.diagnosis_identifier || '', drug_type: b.drug_type || '',
      comment_codes: comments.length ? comments.filter((c) => c && c.code).map((c) => String(c.code)) : (b.comment_codes || []), comment_names: comments,
      free_comment: comments.length ? comments.map((c) => String((c && (c.freeText || c.free_text)) || '').trim()).filter(Boolean).join(' / ') || (b.free_comment || '') : '',
      days: toInt(b.days || b.duration_days || b.prescription_days), frequency: b.frequency || '', dose_quantity: Number(b.dose_quantity || b.drug_quantity || b.quantity || 0), dose_unit: b.dose_unit || b.drug_unit || '',
      receipt_position: b.receipt_position || 'summary', do_not_bill: !!b.do_not_bill,
      billing_group_id: b.billing_group_id || null, billing_group_parent_id: b.billing_group_parent_id || null, billing_group_label: b.billing_group_label || null };
  }
  // 受診の保険の区分（基準版 resolve_payer_group の workers・auto_liability 判定）
  function categoryOf(ins) {
    const t = String((ins && ins.insurance_type) || '').toLowerCase();
    return LABOR.includes(t) ? 'workers' : AUTO.includes(t) ? 'auto_liability' : 'medical';
  }
  function pickInsurance(list, rec, date) {
    const act = (x) => x.is_active !== false && (!x.valid_from || String(x.valid_from).slice(0, 10) <= date) && (!x.valid_until || String(x.valid_until).slice(0, 10) >= date);
    if (rec.insurance_id) { const hit = list.find((x) => String(x.id) === String(rec.insurance_id)); if (hit) return hit; }
    if (rec.labor_auto_insurance === 'labor') return list.find((x) => categoryOf(x) === 'workers' && act(x)) || null;
    if (rec.labor_auto_insurance === 'auto') return list.find((x) => categoryOf(x) === 'auto_liability' && act(x)) || null;
    return list.find((x) => categoryOf(x) === 'medical' && x.is_primary && act(x)) || list.find((x) => categoryOf(x) === 'medical' && act(x)) || null;
  }

  // ---- 月の労災・自賠責の会計を集める（基準版 build_claim_preview の workers・auto_liability 部分） ----
  async function collect(ym, category, claimKind, claimDate) {
    await loadMasters();
    const c = await C.ready(); const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const { data, error } = await c.from('visits').select('id,patient_id,visit_date,status,created_at,kartes(base_record,created_at,updated_at),patients(id,patient_no,name,name_kana,sex,dob)')
      .eq('clinic_id', clinicId()).gte('visit_date', ym + '-01').lte('visit_date', ym + '-' + pad2(last)).order('visit_date');
    if (error) throw new Error(error.message);
    const insCache = new Map(), dxCache = new Map();
    const rows = [];
    for (const v of data || []) {
      const k = one(v.kartes), b = k && k.base_record; if (!b || b.is_deleted) continue;
      const billings = Array.isArray(b.billings) ? b.billings : []; const bill = b.billing || null;
      if (bill && bill.is_active === false) continue; if (bill && bill.status === 'cancelled') continue;
      if (!billings.length && !bill) continue;
      if (!insCache.has(v.patient_id)) insCache.set(v.patient_id, await api('/insurances/patient/' + v.patient_id + '?active_only=false&include_expired=true').catch(() => []));
      const ins = pickInsurance(insCache.get(v.patient_id) || [], b, v.visit_date);
      rows.push({ v, b, bill, ins, category: categoryOf(ins) });
    }
    const recordCategories = new Map(rows.map((r) => [r.v.id, r.category]));
    const items = [], raw = [];
    for (const r of rows.filter((x) => x.category === category)) {
      const { v, b, bill, ins } = r; const p = v.patients || {};
      if (!dxCache.has(v.patient_id)) dxCache.set(v.patient_id, await api('/diagnoses/patient/' + v.patient_id + '?active_only=false&include_ended=true').then((r) => (Array.isArray(r) ? r : r.items || [])).catch(() => []));
      const mStart = ymOf(v.visit_date) + '-01';
      const dx = dxCache.get(v.patient_id)
        .filter((d) => d.is_active !== false && d.start_date && String(d.start_date).slice(0, 10) <= v.visit_date && (!d.end_date || String(d.end_date).slice(0, 10) >= mStart))
        .filter((d) => { const lc = d.record_id ? recordCategories.get(d.record_id) : null; return !lc || lc === category; })
        .sort((a, x) => ((a.diagnosis_category === 'main' ? 0 : 1) - (x.diagnosis_category === 'main' ? 0 : 1)) || ((a.sort_order || 0) - (x.sort_order || 0))
          || String(x.start_date || '').localeCompare(String(a.start_date || '')) || String(x.created_at || '').localeCompare(String(a.created_at || '')))
        .map((d) => { const mods = [].concat(d.prefix_modifiers || [], d.suffix_modifiers || []).map((m) => m && m.code).filter(Boolean);
          return { id: d.id, record_id: d.record_id || null, diagnosis_code: d.diagnosis_code || null, diagnosis_name: d.diagnosis_name || null, full_name: d.full_name || d.diagnosis_name || null,
            diagnosis_category: d.diagnosis_category || null, is_suspected: !!d.is_suspected, start_date: d.start_date ? String(d.start_date).slice(0, 10) : null,
            end_date: d.end_date ? String(d.end_date).slice(0, 10) : null, outcome: d.outcome || null, receipt_comment: d.receipt_comment || null, modifier_codes: mods.length ? mods : null }; });
      const details = (Array.isArray(b.billings) ? b.billings : []).map((x, i) => claimDetail(x, i, v.id));
      const totalScore = bill ? toInt(bill.total_score) : details.filter((d) => !d.do_not_bill && d.item_type !== 'self_pay').reduce((s, d) => s + d.score, 0);
      const row = { billing_id: v.id, record_id: v.id, reception_id: v.id, reception_status: { done: 'payment_done', waiting: 'waiting', in_progress: 'in_exam', reserved: 'reserved' }[v.status] || v.status || '',
        patient_id: v.patient_id, patient_no: p.patient_no || '', patient_name: p.name || '', patient_kana: p.name_kana || '', birth_date: p.dob || null,
        gender: { '男': 'male', '女': 'female' }[String(p.sex || '').replace(/性$/, '')] || 'other', billing_date: v.visit_date, selected_insurance_id: ins ? String(ins.id) : null,
        insurance_type: ins ? ins.insurance_type : '', labor_auto_insurance: b.labor_auto_insurance || '', workers_comp_details: (ins && ins.workers_comp_details) || {},
        payer_group: category, payer_group_label: CAT[category], insurer_number: (ins && ins.insurer_number) || '', insurer_name: (ins && ins.insurer_name) || '', symbol: (ins && ins.symbol) || '',
        insurance_number: (ins && ins.number) || '', branch_number: (ins && ins.branch_number) || '', relationship: (ins && ins.relationship) || '', burden_ratio: (ins && toInt(ins.burden_ratio)) || null,
        total_score: totalScore, total_amount: bill ? toInt(bill.total_amount) : totalScore * 10, patient_burden: bill ? toInt(bill.patient_burden_adjusted || bill.patient_burden) : 0, self_pay_amount: bill ? toInt(bill.self_pay_amount) : 0,
        status: (bill && bill.status) || 'draft', receipt_claim_type: b.receipt_claim_type || 'normal', visit_type: b.visit_type === '入院' ? 'inpatient' : '', department: b.department || '',
        receipt_symptom_details: [], receipt_summary_comments: [], items: details, diagnoses: dx, public_expenses: [] };
      // レセプトの記載事項（症状詳記・摘要欄コメント）のうち、この保険が対象のもの
      if (ins) {
        const own = (x) => String(x.target_insurance_id || '') === String(ins.id);
        const sd = await api('/insurances/patient/' + v.patient_id + '/receipt-symptom-details').catch(() => []);
        const sc = await api('/insurances/patient/' + v.patient_id + '/receipt-summary-comments').catch(() => []);
        const actOn = (x) => (!x.valid_from || String(x.valid_from).slice(0, 10) <= v.visit_date) && (!x.valid_until || String(x.valid_until).slice(0, 10) >= v.visit_date);
        row.receipt_symptom_details = (Array.isArray(sd) ? sd : []).filter((x) => own(x) && actOn(x) && String(x.content || '').trim());
        row.receipt_summary_comments = (Array.isArray(sc) ? sc : []).filter((x) => own(x) && actOn(x) && ['upper', 'lower'].includes(x.output_position) && String(x.content || '').trim());
      }
      raw.push(JSON.parse(JSON.stringify(row)));   // 点検前の行（基準版の処理との突き合わせ用に控える）
      // 基準版 build_warning_messages（労災は validate_workers_item、自賠責はレセ電の点検をしない）
      const w = [];
      if (claimKind === 'submission' && row.status === 'draft') w.push('会計が未確定です');
      if (row.reception_status !== 'payment_done') w.push('会計登録がされていません。カルテの編集画面を開き、会計登録を行ってください。');
      const activeDetails = details.filter((d) => !d.do_not_bill);
      if (totalScore > 0 && !activeDetails.length) w.push('算定明細がありません');
      for (const d of activeDetails) { if (['action', 'drug', 'material'].includes(d.item_type) && !d.code) { w.push('レセ電コード未設定: ' + (d.name || '名称未設定')); if (w.length >= 5) break; } }
      if (category === 'workers') w.push(...WB.validateWorkersItem(Object.assign({}, row, { items: activeDetails, diagnoses: dx, is_claim_included: true }), false, undefined));
      row.warning_messages = [...new Set(w)];
      row.claim_status = row.warning_messages.length ? 'warning' : 'include'; row.claim_status_label = row.warning_messages.length ? '要確認' : '請求する';
      row.is_claim_included = true; row.claim_method = 'オンライン';
      items.push(row);
    }
    // 基準版：労災は公式マスターの点検（止める所見・確認の所見）と、労災の点数・金額に置き換え
    const f = await facility();
    if (category === 'workers') {
      const unit = WB.workersPointUnit(f);
      for (const it of items) {
        const [blocking, advisory] = WB.validateWorkersMasterRules(it, claimDate);
        blocking.forEach((m) => { if (!it.warning_messages.includes(m)) it.warning_messages.push(m); });
        it.workers_comp_advisory_messages = advisory;
        if (it.warning_messages.length) it.claim_status = 'warning';
        const [score, amount, subtotal, mealCount, mealAmount, total] = WB.workersAmounts(it, unit);
        Object.assign(it, { health_insurance_reference_amount: toInt(it.total_amount), total_score: score, workers_comp_score_amount: amount, workers_comp_subtotal: subtotal,
          workers_comp_meal_count: mealCount, workers_comp_meal_amount: mealAmount, total_amount: total, patient_burden: 0, patient_burden_adjusted: 0 });
      }
    }
    C.workersLastRaw = { category, claim_kind: claimKind, claim_date: claimDate || null, month: ym, facility: f, rows: raw };
    items.sort((a, b) => (a.payer_group + '\u0000' + a.patient_no + '\u0000' + a.billing_date).localeCompare(b.payer_group + '\u0000' + b.patient_no + '\u0000' + b.billing_date));
    return { items, facility: f };
  }

  // ---- 要確認一覧（基準版 build_receipt_review_report の労災・自賠責で効く部分） ----
  function reviewReport(items, exports) {
    const included = items.filter((i) => i.is_claim_included !== false);
    const groups = new Map();
    const add = (payer, item, message, scope) => {
      message = String(message || '').trim(); if (!message) return;
      const identity = String(item.billing_id || '') || JSON.stringify([String(item.patient_id || item.patient_no || ''), String(item.billing_date || '')]);
      const key = JSON.stringify([payer, scope || 'claim', identity]);
      if (!groups.has(key)) groups.set(key, { item, payer, scope: scope || 'claim', messages: new Map() });
      const g = groups.get(key); if (item.billing_dates) g.item = Object.assign({}, g.item, { billing_dates: item.billing_dates });
      const norm = message.replace(/^L\d{4}\s+/, ''); if (!g.messages.has(norm)) g.messages.set(norm, message);
    };
    included.forEach((it) => (it.warning_messages || []).forEach((m) => add(it.payer_group, it, m)));
    (exports || []).forEach((ex) => (ex.result.warning_details || []).forEach((d) => add(ex.payer_group, d, d.message, d.scope || 'claim')));
    const label = (p) => ({ shaho: '社保', kokuho: '国保', self_pay: '自費', workers: '労災', auto_liability: '自賠責' }[p] || 'その他');
    const blocking = [...groups.values()].map((g) => [label(g.payer || ''), g.item.patient_no || '', g.item.patient_name || (g.scope === 'facility' ? '医療機関' : 'レセ電確認'),
      [...new Set(g.item.billing_dates || [String(g.item.billing_date || '')])].sort().join('\n'), [...g.messages.values()].join('\n')]);
    const advisory = [];
    included.forEach((it) => (it.workers_comp_advisory_messages || []).forEach((m) => advisory.push([label(it.payer_group || 'workers'), it.patient_no || '', it.patient_name || '', String(it.billing_date || ''), m])));
    const unique = (rows) => { const seen = new Set(); return rows.map((r) => r.map((v) => String(v == null ? '' : v))).filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const b = unique(blocking), a = unique(advisory);
    return { blocking_rows: b, advisory_rows: a, review_fingerprint: '' };
  }
  // 基準版の review_fingerprint（sha256(json.dumps(sorted(rows), ensure_ascii=False))）
  const pyJson = (v) => (Array.isArray(v) ? '[' + v.map(pyJson).join(', ') + ']' : JSON.stringify(String(v)).replace(/[\u007f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  async function fingerprint(report) {
    const rows = report.blocking_rows.length ? report.blocking_rows.map((r) => ['blocking', ...r]).concat(report.advisory_rows.map((r) => ['advisory', ...r])) : report.advisory_rows;
    if (!rows.length) return '';
    const cmpArr = (x, y) => { for (let i = 0; i < Math.min(x.length, y.length); i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return x.length - y.length; };
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pyJson(rows.slice().sort(cmpArr))));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function summarize(items) {
    const inc = items.filter((i) => i.is_claim_included !== false); const pts = new Set(inc.map((i) => i.patient_id).filter(Boolean));
    return { all_records: items.length, total_records: inc.length, total_patients: pts.size, total_score: inc.reduce((s, i) => s + toInt(i.total_score), 0), total_amount: inc.reduce((s, i) => s + toInt(i.total_amount), 0),
      shaho_count: 0, kokuho_count: 0, self_pay_count: 0, warning_count: inc.filter((i) => (i.warning_messages || []).length).length, excluded_count: 0, month_delay_count: 0, resubmit_count: 0, return_hold_count: 0 };
  }
  async function preview(q) {
    const ym = ymOf(q.claim_month); if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象月を指定してください');
    const kind = q.claim_kind === 'submission' ? 'submission' : 'inspection', category = q.claim_category;
    const { items, facility: f } = await collect(ym, category, kind, q.claim_date);
    const exports = category === 'workers' ? WB.buildExports(items.filter((i) => i.is_claim_included !== false), f, ym.replace('-', ''), kind, jstToday()) : [];
    const report = reviewReport(items, exports); report.review_fingerprint = await fingerprint(report);
    const summary = summarize(items); summary.warning_count = report.blocking_rows.length; summary.review_count = report.advisory_rows.length;
    return { claim_month: ym + '-01', claim_date: q.claim_date || null, claim_kind: kind, claim_category: category, payer_groups: [], include_self_pay: false, include_draft: kind !== 'submission',
      summary, items, review_report: report, _facility: f };
  }

  // ---- 作成履歴（compat_receipt.js と同じ院ごとの台帳に並べる） ----
  const BKEY = () => 'karte_base_receipt_batches_' + clinicId();
  const loadBatches = () => { try { return JSON.parse(C.store.getItem(BKEY()) || '[]'); } catch (e) { return []; } };
  const saveBatches = (l) => { C.store.setItem(BKEY(), JSON.stringify(l.slice(0, 20))); };
  const publicBatch = (b) => { const o = Object.assign({}, b); delete o.uke; delete o.claim_items; delete o.facility; return o; };
  const isOurs = (b) => b && (b.claim_category === 'workers' || b.claim_category === 'auto_liability');
  // 基準版 receipt_submission_date（提出日：指定日、無ければ作成日。診療月の翌月より前なら翌月10日）
  function submissionDate(b, archiveYmd) {
    const first = nextYm(ymOf(b.claim_month)).replace('-', '');
    const explicit = b.planned_submission_date; const rec = WB.formatDate(explicit || b.created_at_jst || archiveYmd);
    if (rec.slice(0, 6) < first) { if (explicit) throw new Error('提出年月日は診療月の翌月以降を指定してください'); return first + '10'; }
    return rec;
  }

  // ---- 元の処理を包む ----
  const wrap = (method, re, fn) => { const orig = C.routeOf(method, re); on(method, re, async (m, q, body) => fn(m, q, body, orig || (async () => err(404, '見つかりません')))); };
  const catOf = (v) => (v === 'workers' || v === 'auto_liability' ? v : null);

  wrap('GET', /^\/receipt-claims\/preview$/, async (m, q, body, orig) => {
    const cat = catOf(q.get('claim_category')); if (!cat) return orig(m, q, body);
    const p = await preview({ claim_month: q.get('claim_month'), claim_date: q.get('claim_date'), claim_kind: q.get('claim_kind'), claim_category: cat });
    delete p._facility; return { data: p };
  });
  wrap('POST', /^\/receipt-claims\/batches$/, async (m, q, body, orig) => {
    const cat = catOf(body.claim_category); if (!cat) return orig(m, q, body);
    const p = await preview({ claim_month: body.claim_month, claim_date: body.claim_date, claim_kind: body.claim_kind, claim_category: cat });
    const kind = p.claim_kind;
    if (kind === 'submission') {
      const r = p.review_report, conf = body.review_confirmation || {};
      if ((r.blocking_rows.length || r.advisory_rows.length) && (conf.fingerprint !== r.review_fingerprint || String(conf.note || '').trim().length < 3))
        return err(409, '未確認の要確認事項があります。最新の要確認一覧を開き、確認ポップアップから作成してください。');
      if (p.summary.total_records <= 0) return err(400, '提出用レセプトの対象データがありません。');
    }
    // 基準版：労災は作成のたびに電算処理受付番号の元（UTC の年月日時分秒）を入れて保存する
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    if (cat === 'workers') p.items.forEach((it) => { const d = Object.assign({}, it.workers_comp_details || {}); if (d.claim_information === undefined) d.claim_information = stamp; it.workers_comp_details = d; });
    const s = p.summary; const now = new Date();
    const b = { id: crypto.randomUUID(), claim_month: p.claim_month, planned_submission_date: body.claim_date || null, claim_kind: kind, claim_category: cat, status: 'created',
      total_records: s.total_records, total_patients: s.total_patients, total_score: s.total_score, total_amount: s.total_amount, shaho_count: 0, kokuho_count: 0, self_pay_count: 0,
      warning_count: s.warning_count, created_at: now.toISOString(), created_at_jst: jstToday(), summary: s, items: p.items, review_report: p.review_report,
      review_confirmation: body.review_confirmation || null, claim_items: p.items, facility: p._facility };
    saveBatches([b].concat(loadBatches()));
    return { data: publicBatch(b) };
  });
  wrap('GET', /^\/receipt-claims\/batches$/, async (m, q, body, orig) => {
    const r = await orig(m, q, body); const res = r instanceof Response ? await r.clone().json() : r;
    if (res && Array.isArray(res.data)) res.data = res.data.map((b) => { const o = Object.assign({}, b); delete o.claim_items; delete o.facility; return o; });
    return res;
  });
  wrap('GET', /^\/receipt-claims\/batches\/([0-9a-f-]{36})$/, async (m, q, body, orig) => {
    const b = loadBatches().find((x) => x.id === m[1]); if (!isOurs(b)) return orig(m, q, body);
    return { data: publicBatch(b) };
  });
  wrap('GET', /^\/receipt-claims\/batches\/([0-9a-f-]{36})\/download$/, async (m, q, body, orig) => {
    const b = loadBatches().find((x) => x.id === m[1]); if (!isOurs(b)) return orig(m, q, body);
    await loadMasters();
    const z = await zipOf(b, q.get('review_copy') === 'true');
    return new Response(zipStore(z.files), { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(z.filename) } });
  });
  // 基準版 build_workers_comp_claim_zip_bytes（労災）・build_claim_zip_bytes（自賠責はレセ電の対象外＝要確認一覧だけ）
  async function zipOf(b, reviewCopy) {
    const archive = jstToday().replace(/-/g, ''); const kind = b.claim_kind || 'inspection';
    const items = (b.claim_items || b.items || []).filter((i) => i.is_claim_included !== false);
    const f = b.facility || await facility();
    const submitted = submissionDate(b, archive);
    const exports = b.claim_category === 'workers' ? WB.buildExports(items, f, ymOf(b.claim_month).replace('-', ''), kind, submitted, kind === 'submission') : [];
    const report = reviewReport(b.claim_items || b.items || [], exports);
    const lines = [['区分', '患者番号', '氏名', '診療日', '内容']].concat([['', '', '点検結果', '', '修正・再点検が必要: ' + report.blocking_rows.length + '項目 / 内容と理由の確認が必要: ' + report.advisory_rows.length + '項目。']], report.blocking_rows, report.advisory_rows)
      .map((r) => r.map((x) => String(x).replace(/\r?\n/g, ' ')).join('\t'));
    const files = [['要確認レセプト一覧_' + archive + '.txt', new TextEncoder().encode('﻿' + lines.join('\r\n') + '\r\n')]];
    exports.forEach((ex) => files.push(['rousai/' + ex.filename, WB.encodeCp932(ex.result.content)]));
    window.__compat.workersLastZip = { submitted, facility: f, items, claim_kind: kind, claim_month: ymOf(b.claim_month).replace('-', ''), exports: exports.map((e) => ({ filename: e.filename, content: e.result.content, warnings: e.result.warnings })) };
    const prefix = reviewCopy ? '照合用レセプト' : (kind === 'inspection' ? '点検用レセプト' : '提出用レセプト');
    const filename = !reviewCopy && b.claim_category === 'workers' ? '労災-' + prefix + '-' + archive + '.zip' : prefix + '_' + archive + '.zip';
    return { files, filename };
  }
  // 無圧縮（store）の ZIP。名前は UTF-8（汎用フラグ bit 11）。compat_receipt.js と同じ作り
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipStore(files) {
    const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
    const d = new Date(); const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    for (const [name, data] of files) {
      const nb = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nb);
      offset += 30 + nb.length + data.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  Object.assign(C, { workersPreview: preview, workersZipOf: zipOf });
})(typeof window !== 'undefined' ? window : globalThis);
