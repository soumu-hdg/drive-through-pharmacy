// ===== 置き換え層：レセプト作成（工程4・2026-09-24） compat_receipt.js =====
// 基準版の /receipt-claims/... を、統合版のレセプト作成（DB から月の受診を読み → UKE を作る → 読み戻して点検）に置き換える。
//   ・UKE・点検は統合版の部品をそのまま使う。統合版の画面（../classic.html）を見えない枠で開き、その中の
//     rzFetchFromDb（DB から受診を読む）・generateUKE（UKE を作る）・ukeValidate（読み戻し点検）を呼ぶ
//     （算定の部品が app.js にあるため。基準版の画面に直接読み込むと名前がぶつかる）
//   ・点検用の様式（PDF）は統合版の様式（基準版と同じ座標の SVG）から作る。PDF にする部品（RezeptFormPdf）が読めないときは様式を入れない
//   ・作成履歴（バッチ）は、統合版にまだ置き場が無いので院ごとに DB（karte_clinic_store）へ置く（直近 20 件）。DB を使う印の無い院は従来どおり端末に置く
//   ・ダウンロードの ZIP は基準版と同じ中身・同じ並び（2026-09-24 担当B）:
//       点検用（build_inspection_claim_zip_bytes）… shaho/点検用.UKE・kokuho/点検用.UKE → shaho/社保レセプト.pdf・kokuho/国保レセプト.pdf
//         → 要確認レセプト一覧_<日付>.pdf → （別請求の公費があれば）kouhi/医療費請求書.pdf
//       提出用（build_claim_zip_bytes）… 国保総括表（一覧）.pdf・社保総括表.pdf → 要確認レセプト一覧_<日付>.pdf
//         → kokuho/光ディスク等送付書.pdf・返戻処理結果.txt・返戻用国保総括表.pdf・返戻用国保請求書.pdf・返戻用後期高齢者請求書.pdf
//         → shaho/光ディスク等送付書.pdf・返戻処理結果.txt・返戻用社保総括表.pdf → kouhi/医療費請求書.pdf（無ければ白紙）
//         → shaho|kokuho/RECEIPTC.UKE（対象の無い側も空の UKE）→ kokuho-henrei|shaho-henrei/RECEIPTC.UKE（返戻再請求ぶん）
//     要確認レセプト一覧・医療費請求書は receipt_review_svg.js、総括表・送付書・返戻用の帳票は receipt_ledger_svg.js（ReceiptLedgerSvg）で作る。
//     どちらも見えない枠（../receipt.html）に必要になったときに読み込み、読めない帳票は ZIP に入れない
//   ・要確認一覧の行は、統合版の読み戻し点検の結果を患者ごとにまとめたもの（列は基準版の一覧と同じ: 請求先・患者番号・氏名・診療日・確認内容）
(function () {
  const C = window.__compat; if (!C) return;
  const { on, err, clinicId } = C;
  const pad2 = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const ymOf = (v) => String(v || '').slice(0, 7);
  const nextYm = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + pad2(m + 1); };
  const GROUP_LABEL = { shaho: '社保', kokuho: '国保' };
  const isResubmit = (x) => ['resubmit', 'resubmit_paper'].includes(x.receipt_claim_type) || x.claim_status === 'resubmit';

  // ---- 見えない枠で統合版の画面を開く（1 回だけ） ----
  const frames = {};
  function frame(key, src, isReady, timeoutMs) {
    if (frames[key]) return frames[key];
    frames[key] = new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:900px;border:0;visibility:hidden;';
      f.src = src; document.body.appendChild(f);
      const t0 = Date.now();
      const poll = () => {
        let w = null; try { w = f.contentWindow; } catch (e) { w = null; }
        let ok = false; try { ok = !!(w && isReady(w)); } catch (e) { ok = false; }
        if (ok) return resolve(w);
        if (Date.now() - t0 > (timeoutMs || 90000)) { frames[key] = null; f.remove(); return reject(new Error('レセプト作成の部品を読み込めませんでした')); }
        setTimeout(poll, 300);
      };
      poll();
    });
    return frames[key];
  }
  const karteEngine = () => frame('karte', '../classic.html' + location.search,
    (w) => typeof w.rzFetchFromDb === 'function' && typeof w.generateUKE === 'function' && typeof w.isSupabaseReady === 'function' && w.isSupabaseReady() && typeof w.currentClinicId === 'function' && w.currentClinicId() === clinicId());
  // 様式の部品（RezeptFormSvg）は const 宣言なので窓の外から見えない。枠の中で名前を引く
  const inFrame = (w, name) => { try { return w.eval('typeof ' + name + ' !== "undefined" ? ' + name + ' : null'); } catch (e) { return null; } };
  const viewerEngine = () => frame('viewer', '../receipt.html', (w) => typeof w.parseUKE === 'function' && !!inFrame(w, 'RezeptFormSvg'));
  // 帳票の部品は必要になったときに枠へ読み込む（1 回だけ試す。無い部品は null）
  async function viewerPart(name, file) {
    let v; try { v = await viewerEngine(); } catch (e) { return null; }
    v.__rzTried = v.__rzTried || {};
    if (!inFrame(v, name) && !v.__rzTried[name]) {
      v.__rzTried[name] = new Promise((ok) => { const s = v.document.createElement('script'); s.src = file + '?v=20260924_ledger'; s.onload = ok; s.onerror = ok; v.document.head.appendChild(s); });
    }
    if (v.__rzTried[name]) await v.__rzTried[name];
    return inFrame(v, name);
  }
  const pdfPart = () => viewerPart('RezeptFormPdf', 'rezept_form_pdf.js');
  async function reviewPart() {
    if (!(await pdfPart())) return null;
    const R = await viewerPart('ReceiptReviewSvg', 'receipt_review_svg.js');
    if (!R) return null;
    try { await R.ready(); } catch (e) { return null; }
    return R;
  }
  async function ledgerPart() { if (!(await pdfPart())) return null; return viewerPart('ReceiptLedgerSvg', 'receipt_ledger_svg.js'); }

  // ---- 医療機関情報（施設管理画面の値。compat_facility.js） ----
  async function facilityInfo(ukeText) {
    const f = { name: '', address: '', phone: '', founder_name: '', medical_institution_code: '', prefecture_code: '' };
    const ir = String(ukeText || '').split(/\r?\n/).find((l) => l.startsWith('IR,'));
    if (ir) { const x = ir.split(','); f.prefecture_code = x[2]; f.medical_institution_code = x[2] + x[3] + x[4]; f.name = x[6]; f.phone = x[9]; }
    const cur = C.routeOf && C.routeOf('GET', /^\/facilities\/current$/);
    if (cur) { try { const p = await cur(); if (p && typeof p === 'object') ['name', 'address', 'phone', 'founder_name', 'medical_institution_code', 'postal_code'].forEach((k) => { if (p[k]) f[k] = p[k]; }); } catch (e) { /* 従来どおり */ } }
    const fx = C.facilityForForm ? await C.facilityForForm() : null; if (fx) ['name', 'address', 'phone'].forEach((k) => { if (fx[k]) f[k] = fx[k]; });
    return f;
  }

  // ---- 別請求の公費（愛知県の福祉医療・連記式の医療費請求書） ----
  //   基準版 public_expense_claim_rules.aichi_decision の「別請求」の分かれ道を写したもの（2027年3月診療分まで）:
  //   愛知県の医療機関で、愛知県の子ども・障害者・ひとり親家庭等・精神障害者の医療証が
  //   社保の患者／国保組合／県外の市町村国保 のときは、保険請求とは別に医療費請求書（連記式）で請求する。
  //   市町村の名簿（コード → 名称）は統合版に無いので、公費に登録された発行市町村の名称・コードをそのまま使う
  const AICHI_PROGRAMS = new Set(['aichi_child', 'aichi_disabled', 'aichi_single_parent', 'aichi_mental_all', 'aichi_mental_outpatient']);
  const PROGRAM_ALIASES = { child: 'aichi_child', disabled: 'aichi_disabled', single_parent: 'aichi_single_parent' };
  const digitsOf = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const activeOn = (x, d) => x.isActive !== false && (!x.validFrom || String(x.validFrom).slice(0, 10) <= d) && (!x.validUntil || String(x.validUntil).slice(0, 10) >= d);
  function separateExpenses(item, extra, facilityPref) {
    const d = String(item.billing_date || '').slice(0, 10);
    if (!d || d >= '2027-04-01' || facilityPref !== '23') return { selected: [], separate: [] };
    const selected = (extra.publicExpenses || []).filter((x) => activeOn(x, d));
    const separate = [];
    for (const x of selected) {
      const program = PROGRAM_ALIASES[x.type] || x.type;
      if (!AICHI_PROGRAMS.has(program)) continue;
      const code = digitsOf(x.municipalityCode), pref = digitsOf(x.prefectureCode) || code.slice(0, 2);
      if (pref !== '23') continue;
      const insurer = digitsOf(item.insurer_number);
      const insName = String(item.insurer_name || '');
      const association = /国保組合|国民健康保険組合/.test(insName);
      const municipal = insurer.length === 8 && insurer.startsWith('00') ? insurer.slice(2) : insurer;
      const foreign = municipal.length === 6 && !municipal.startsWith('23');
      if (!(item.payer_group === 'shaho' || association || foreign)) continue;
      separate.push({ expense_type: program, expense_type_name: x.typeName || '', municipality_name: x.municipality || '', municipality_code: code, prefecture_code: pref,
        payer_number: x.payerNumber || '', recipient_number: x.confirmLater ? '' : (x.recipientNumber || ''),
        claim_routing: { form: '医療費請求書（連記式）', reason: '保険請求とは別に愛知県国保連へ医療費請求書（連記式）で請求', source_url: 'https://aichi-kokuho.or.jp/medical/renkishiki/index.html' } });
    }
    return { selected, separate };
  }
  // 患者の保険等タブの内容（patients.receipt_extra）。レセプトの行に、総括表・連記式で使う項目を足す
  async function patientExtras(items) {
    const ids = Array.from(new Set(items.map((x) => x.patient_id).filter(Boolean)));
    if (!ids.length) return new Map();
    const { data } = await (await C.ready()).from('patients').select('id,receipt_extra').eq('clinic_id', clinicId()).in('id', ids);
    return new Map((data || []).map((p) => [p.id, p.receipt_extra || {}]));
  }
  const facilityPref = (facility) => (digitsOf(facility.medical_institution_code).length >= 9 ? digitsOf(facility.medical_institution_code).slice(0, 2)
    : (/愛知/.test(facility.address + facility.name) ? '23' : facility.prefecture_code));
  // 基準版の請求データの項目名で: 保険者名・一部負担金（保険等タブの「一部負担金」）・保険請求に入れる公費（別請求の公費は除く）
  function decorateItem(it, extra, pref) {
    const d = String(it.billing_date || '').slice(0, 10);
    const ins = (extra.insurances || []).filter((x) => activeOn(x, d) && digitsOf(x.insurerNumber) === digitsOf(it.insurer_number))[0];
    if (ins && ins.insurerName) it.insurer_name = ins.insurerName;
    const cp = (extra.receiptCopayments || [])[0];
    if (cp && cp.insuranceAmount !== undefined && cp.insuranceAmount !== null && cp.insuranceAmount !== '') it.receipt_copayment = { category: cp.category || '00', amount: cp.insuranceAmount };
    const { selected, separate } = separateExpenses(it, extra, pref);
    const sepTypes = new Set(separate.map((x) => x.expense_type));
    it.public_expenses = selected.filter((x) => !sepTypes.has(PROGRAM_ALIASES[x.type] || x.type)).map((x) => ({ payer_number: x.payerNumber || '', recipient_number: x.confirmLater ? '' : (x.recipientNumber || ''),
      expense_type: x.type || '', expense_type_name: x.typeName || '', scope: x.scope || (/^(aichi_|child$|disabled$|single_parent$|local_)/.test(String(x.type || '')) ? 'prefecture' : 'national'),
      covered_score: it.total_score, burden_amount: x.burdenAmount === undefined ? null : x.burdenAmount }));
    it.separate_public_expenses = separate;
    it.selected_public_expenses = selected;
    return it;
  }
  async function prepareRenki(items, ym, claimDate, facility) {
    const out = [];
    let R = null;
    for (const it of items) {
      const separate = it.separate_public_expenses || [];
      if (!separate.length) continue;
      if (!R) R = await reviewPart(); if (!R) return [];
      // 会計の内訳（保険・公費・本人）は統合版に無いので、福祉医療（全額助成）の規則で出す（compat_billing.js の applyPublicExpense と同じ）
      const total = it.total_score * 10, ratio = it.burden_ratio;
      const pub = [10, 20, 30].includes(ratio) ? Math.floor(total * ratio / 100) : 0;
      const src = Object.assign({}, it, { visit_type: 'outpatient', public_expense_amount: pub, patient_burden: 0, insurance_amount: total - pub, total_amount: total });
      R.prepareRenkiItem(src, facility, ym + '-01', claimDate);
      out.push({ billing_id: it.billing_id, patient_no: it.patient_no, patient_name: it.patient_name, billing_date: it.billing_date, payer_group: it.payer_group,
        claim_status: 'include', is_claim_included: true, separate_public_expenses: separate, renki_entry: src.renki_entry, renki_header: src.renki_header, renki_errors: src.renki_errors });
    }
    return out;
  }
  // 総括表に渡す「1件＝月単位に束ねたレセプト1枚」（同じ患者・同じ請求先・同じ診療月の受診を束ねる。基準版 aggregate_receipts と同じ単位）
  function monthly(items) {
    const m = new Map();
    for (const it of items) {
      const key = [it.patient_no, it.payer_group, String(it.billing_date || '').slice(0, 7), digitsOf(it.insurer_number)].join('|');
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(it);
    }
    return Array.from(m.values()).map((list) => {
      const head = list[0];
      const dates = Array.from(new Set(list.map((x) => String(x.billing_date || '').slice(0, 10)))).sort();
      return Object.assign({}, head, { billing_date: dates[0], visit_days: dates.length, total_score: list.reduce((s, x) => s + (x.total_score || 0), 0),
        total_amount: list.reduce((s, x) => s + (x.total_amount || 0), 0), patient_burden: list.reduce((s, x) => s + (x.patient_burden || 0), 0),
        receipt_claim_type: (list.find(isResubmit) || head).receipt_claim_type, source_billings: list });
    });
  }

  // ---- 要確認レセプト一覧の行（基準版 build_receipt_review_report の pdf_rows と同じ形: 点検結果の行 → 確認事項） ----
  //   基準版 collect_receipt_warning_rows と同じまとめ方: 会計（受診）ごとの確認事項は受診ごと（その日付だけ）→
  //   月単位のレセプトの確認事項（統合版の読み戻し点検）は患者ごと（その月の受診日すべて）→ 患者に結び付かないものは「レセ電確認」
  function reviewRows(items, checks, perItem) {
    const groups = new Map(), loose = [];
    const add = (key, it, dates, msg) => {
      if (!groups.has(key)) groups.set(key, { it, dates, msgs: [] });
      const g = groups.get(key); if (!g.msgs.includes(msg)) g.msgs.push(msg);
    };
    (perItem || []).forEach(([it, msg]) => add('billing|' + (it.billing_id || it.patient_no + '|' + it.billing_date), it, [it.billing_date], msg));
    checks.forEach((m) => {
      const msg = String(m).replace(/^(社保|国保)：/, '');
      const it = items.find((x) => x.patient_no && m.includes(x.patient_no)) || items.find((x) => x.patient_name && m.includes(x.patient_name));
      if (!it) { loose.push(['', '', 'レセ電確認', '', msg]); return; }
      const dates = items.filter((x) => x.patient_no === it.patient_no && x.payer_group === it.payer_group).map((x) => x.billing_date);
      add('receipt|' + it.payer_group + '|' + it.patient_no, it, dates, msg);
    });
    return Array.from(groups.values()).map(({ it, dates, msgs }) => [GROUP_LABEL[it.payer_group] || 'その他', it.patient_no || '', it.patient_name || '',
      Array.from(new Set(dates.map(String))).sort().join('\n'), msgs.join('\n')]).concat(loose);
  }
  const summaryRow = (blocking, advisory) => ['', '', '点検結果', '', '修正・再点検が必要: ' + blocking + '項目 / 内容と理由の確認が必要: ' + advisory + '項目。'
    + '確認事項は一覧に保持します。確認後は、要確認を残したまま提出用レセプトを作成できます。'];
  async function fingerprintOf(rows) {
    if (!rows.length) return '';
    const text = JSON.stringify(rows.map((r) => r.map((v) => String(v || ''))).sort());
    try { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return String(rows.length); }
  }

  // ---- 月のレセプトを作る（統合版の作成処理と同じ順番） ----
  async function build(q) {
    const t0 = performance.now(); const lap = (s) => console.info('[置き換え層] レセプト ' + s + ' ' + Math.round(performance.now() - t0) + 'ms');
    const w = await karteEngine(); lap('部品の読み込み');
    if (w.currentClinicId() !== clinicId()) throw new Error('院が一致しません');
    if (typeof w.ukeLoadServiceTable === 'function') await w.ukeLoadServiceTable();
    if (w.MasterLoader && w.MasterLoader.load) { try { await Promise.race([w.MasterLoader.load(), new Promise((r) => setTimeout(r, 20000))]); } catch (e) { /* マスター無しでも作る */ } }
    const ym = ymOf(q.claim_month); if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象月を指定してください');
    const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    lap('マスター'); const f = await w.rzFetchFromDb(ym + '-01', ym + '-' + pad2(last)); lap('DB');
    if (!f.ok) throw new Error('受診を読めません: ' + f.reason);
    const groups = String(q.payer_groups || '').split(',').filter(Boolean);
    const org = (r) => w.getReviewOrg(r.patient.insurance, r.patient.insurerNumber) === '1' ? 'shaho' : 'kokuho';
    const records = f.records.filter((r) => !groups.length || groups.includes(org(r)));
    // 受診ごとの行（基準版の一覧の 1 行 ＝ 1 会計）。会計ごとの請求の扱い（compat_writes_daily.js の台帳）もここで引く
    const { data: vis } = await (await C.ready()).from('visits').select('id,patient_id,visit_date,patients(id,patient_no,name,name_kana,dob,sex,insurer_number,insurance_type,copay_rate)').eq('clinic_id', clinicId()).gte('visit_date', ym + '-01').lte('visit_date', ym + '-' + pad2(last));
    const byKey = new Map((vis || []).map((v) => [v.patients.patient_no + '|' + v.visit_date, v]));
    const overrides = C.claimStatusMap ? C.claimStatusMap() : {};
    const claimOf = (r) => { const v = byKey.get(r.patient.id + '|' + r.visitDate); return (v && overrides[v.id]) || null; };
    const statusOf = (r) => { const o = claimOf(r); return o ? o.claim_status : 'include'; };
    const included = (s) => ['include', 'warning', 'resubmit'].includes(s);   // 基準版 is_claim_included_status と同じ
    const ukeRecords = records.filter((r) => included(statusOf(r)));          // 請求に含めない・月遅れ・返戻保留の会計は UKE に入れない
    const warnings = [], notes = [];
    const claimYm = (q.claim_date ? ymOf(q.claim_date) : nextYm(ym)).replace('-', '');
    if (C.applyFacilityToUke) await C.applyFacilityToUke(w);   // 医療機関情報（compat_facility.js）が入っている院は UKE の IR にその値を使う
    const opts = () => ({ aggregate: true, claimYm, warnings, notes });
    const uke = ukeRecords.length ? w.generateUKE(ukeRecords, ym.replace('-', ''), opts()) : {};
    // 提出用は返戻再請求ぶんを別の UKE にする（基準版と同じ。点検用は1つにまとめたまま）
    const recType = (r) => (statusOf(r) === 'resubmit' ? 'resubmit' : null) || (r.karte.baseRecord && r.karte.baseRecord.receipt_claim_type) || 'normal';
    const resubmitRecs = ukeRecords.filter((r) => ['resubmit', 'resubmit_paper'].includes(recType(r)));
    const split = resubmitRecs.length ? { regular: w.generateUKE(ukeRecords.filter((r) => !resubmitRecs.includes(r)), ym.replace('-', ''), opts()), henrei: w.generateUKE(resubmitRecs, ym.replace('-', ''), opts()) } : null;
    const checks = [];
    [['shaho', '社保'], ['kokuho', '国保']].forEach(([g, label]) => { if (uke[g] && typeof w.ukeValidate === 'function') w.ukeValidate(uke[g]).forEach((m) => checks.push(label + '：' + m)); });
    if (typeof w.ukeValidateExt === 'function') [['shaho', '社保'], ['kokuho', '国保']].forEach(([g, label]) => { if (uke[g]) w.ukeValidateExt(uke[g]).forEach((m) => { const s = label + '：' + m; if (!checks.includes(s)) checks.push(s); }); });
    warnings.forEach((m) => { if (!checks.includes(m)) checks.push(m); });
    const items = records.map((r) => {
      const v = byKey.get(r.patient.id + '|' + r.visitDate) || {};
      const it = w.computeVisitItems(r); const score = it.si.reduce((s, x) => s + x.points * (x.count || 1), 0) + it.iy.reduce((s, x) => s + (x.cont ? 0 : x.dayPoints * x.days), 0);
      const ratio = Number(r.patient.ratio); const g = org(r);
      const mine = checks.filter((m) => m.includes(r.patient.id) || (r.patient.name && m.includes(r.patient.name)));
      return { id: v.id, billing_id: v.id, record_id: v.id, patient_id: v.patient_id, patient_no: r.patient.id, patient_name: r.patient.name, patient_kana: r.patient.nameKana,
        birth_date: r.patient.dob, gender: r.patient.sex === '女' ? 'female' : 'male', billing_date: r.visitDate, service_month: ym, claim_month: ym,
        insurance_type: g === 'shaho' ? 'social' : 'national', payer_group: g, payer_group_label: GROUP_LABEL[g], insurer_number: r.patient.insurerNumber,
        relationship: r.patient.relationship || null, visit_type: 'outpatient',
        burden_ratio: isNaN(ratio) ? null : Math.round(ratio * 100), total_score: score, total_amount: score * 10, patient_burden: isNaN(ratio) ? 0 : Math.round(score * 10 * ratio / 10) * 10,
        claim_status: statusOf(r), is_claim_included: included(statusOf(r)), is_month_delay_candidate: false, receipt_claim_type: recType(r),
        claim_status_note: (claimOf(r) || {}).note || '',
        warning_messages: mine, source_format: r.karte.baseRecord ? 'base' : 'karte' };
    });
    // 別請求の公費（連記式の医療費請求書）。作れない理由は要確認一覧に出す（基準版と同じ）
    const facility = await facilityInfo(uke.shaho || uke.kokuho);
    try { const ex = await patientExtras(items); const pref = facilityPref(facility); items.forEach((it) => decorateItem(it, ex.get(it.patient_id) || {}, pref)); } catch (e) { console.info('[置き換え層] 保険等タブの読み込み ' + e.message); }
    let claimDate; try { claimDate = receiptSubmissionDate({ claim_month: ym + '-01', planned_submission_date: q.claim_date }, today().replace(/-/g, '')); } catch (e) { claimDate = nextYm(ym).replace('-', '') + '10'; }
    let renki = [];
    try { renki = await prepareRenki(items.filter((x) => x.is_claim_included !== false), ym, claimDate.slice(0, 4) + '-' + claimDate.slice(4, 6) + '-' + claimDate.slice(6, 8), facility); } catch (e) { console.info('[置き換え層] 医療費請求書の準備 ' + e.message); }
    const perItem = [];
    renki.forEach((x) => { const it = items.find((i) => i.billing_id === x.billing_id && i.patient_no === x.patient_no && i.billing_date === x.billing_date); (x.renki_errors || []).forEach((e) => { if (it) { perItem.push([it, e]); if (!it.warning_messages.includes(e)) it.warning_messages.push(e); } }); });
    const inc = items.filter((x) => x.is_claim_included !== false);   // 集計は請求に含める会計だけ（基準版と同じ）
    const pts = new Set(inc.map((x) => x.patient_id));
    const advisory = reviewRows(items, checks, perItem);
    const summary = { total_records: inc.length, total_patients: pts.size, total_score: inc.reduce((s, x) => s + x.total_score, 0), total_amount: inc.reduce((s, x) => s + x.total_amount, 0),
      shaho_count: inc.filter((x) => x.payer_group === 'shaho').length, kokuho_count: inc.filter((x) => x.payer_group === 'kokuho').length, self_pay_count: 0,
      warning_count: 0, review_count: advisory.length, excluded_count: items.filter((x) => x.claim_status === 'exclude').length,
      month_delay_count: items.filter((x) => x.claim_status === 'month_delay').length, return_hold_count: items.filter((x) => x.claim_status === 'return_hold').length };
    const review_report = { blocking_rows: [], advisory_rows: advisory, review_fingerprint: await fingerprintOf(advisory), pdf_rows: [summaryRow(0, advisory.length)].concat(advisory) };
    return { ym, claimYm, uke, split, summary, items, review_report, checks, renki };
  }

  // ---- 作成履歴（院ごとに DB へ。compat_api.js の store） ----
  const BKEY = () => 'karte_base_receipt_batches_' + clinicId();
  const loadBatches = () => { try { return JSON.parse(C.store.getItem(BKEY()) || '[]'); } catch (e) { return []; } };
  const saveBatches = (l) => { try { C.store.setItem(BKEY(), JSON.stringify(l.slice(0, 20))); } catch (e) { /* 保存できない環境では今回の表示だけ */ } };
  const publicBatch = (b) => { const o = Object.assign({}, b); delete o.uke; delete o.uke_split; delete o.renki_items; return o; };

  on('GET', /^\/receipt-claims\/preview$/, async (m, q) => {
    const r = await build({ claim_month: q.get('claim_month'), claim_date: q.get('claim_date'), payer_groups: q.get('payer_groups') });
    return { data: { claim_month: r.ym + '-01', claim_kind: q.get('claim_kind') || 'inspection', claim_category: q.get('claim_category') || 'medical', summary: r.summary, items: r.items, review_report: r.review_report } };
  });
  on('POST', /^\/receipt-claims\/batches$/, async (m, q, body) => {
    if ((body.claim_category || 'medical') !== 'medical') return err(400, '労災・自賠責のレセプト作成は統合版の労災タブを使ってください（この画面は未対応）');
    const r = await build(body);
    if (body.claim_kind === 'submission' && r.summary.total_records <= 0) return err(400, '提出用レセプトの対象データがありません。');
    const b = { id: crypto.randomUUID(), claim_month: r.ym + '-01', planned_submission_date: body.claim_date || null, claim_kind: body.claim_kind || 'inspection', claim_category: 'medical', status: 'created',
      total_records: r.summary.total_records, total_patients: r.summary.total_patients, total_score: r.summary.total_score, total_amount: r.summary.total_amount,
      shaho_count: r.summary.shaho_count, kokuho_count: r.summary.kokuho_count, self_pay_count: 0, warning_count: r.summary.warning_count, created_at: new Date().toISOString(),
      summary: r.summary, items: r.items, review_report: r.review_report, review_confirmation: body.review_confirmation || null,
      uke: r.uke, uke_split: r.split, renki_items: r.renki, claim_ym: r.claimYm };
    saveBatches([b].concat(loadBatches()));
    return { data: publicBatch(b) };
  });
  on('GET', /^\/receipt-claims\/batches$/, async (m, q) => ({ data: loadBatches().slice(0, Number(q.get('limit') || 20)).map((b) => { const o = publicBatch(b); delete o.items; return o; }) }));
  on('GET', /^\/receipt-claims\/batches\/([0-9a-f-]{36})$/, async (m) => { const b = loadBatches().find((x) => x.id === m[1]); return b ? { data: publicBatch(b) } : err(404, '作成データが見つかりません'); });
  on('PATCH', /^\/receipt-claims\/batches\/([0-9a-f-]{36})\/status$/, async (m, q, body) => {
    const l = loadBatches(); const b = l.find((x) => x.id === m[1]); if (!b) return err(404, '作成データが見つかりません');
    b.status = body.status || b.status; b.status_note = body.note || null; b.updated_at = new Date().toISOString(); saveBatches(l); return { data: publicBatch(b) };
  });
  on('GET', /^\/receipt-claims\/batches\/([0-9a-f-]{36})\/download$/, async (m, q) => {
    const b = loadBatches().find((x) => x.id === m[1]); if (!b) return err(404, '作成データが見つかりません');
    let files;
    try { files = b.claim_kind === 'submission' ? await submissionFiles(b) : await inspectionFiles(b); } catch (e) { return err(400, e.message); }
    const stamp = today().replace(/-/g, '');
    const prefix = q.get('review_copy') === 'true' ? '照合用レセプト' : (b.claim_kind === 'inspection' ? '点検用レセプト' : '提出用レセプト');
    const filename = prefix + '_' + stamp + '.zip';
    return new Response(zipStore(files), { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename) } });
  });
  // 受診 1 件の点検用 PDF（その患者のその月の 1 枚）
  on('GET', /^\/receipt-claims\/records\/([0-9a-f-]{36})\/pdf$/, async (m, q) => {
    const r = await build({ claim_month: q.get('visit_date') });
    const it = r.items.find((x) => x.record_id === m[1]); if (!it) return err(404, 'この受診はレセプトの対象になっていません');
    const pdf = await formPdf(r.uke[it.payer_group], it.payer_group, it.patient_no);
    if (!pdf) return err(501, '点検用の様式（PDF）を作る部品が読み込めません');
    return new Response(new Blob([pdf], { type: 'application/pdf' }), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent('点検用レセプト_' + it.patient_no + '.pdf') } });
  });
  // 請求区分（通常・月遅れ等）と、会計ごとの請求の扱い
  on('PATCH', /^\/receipt-claims\/records\/([0-9a-f-]{36})\/claim-type$/, async (m, q, body) => {
    const c = await C.ready(); const { data: k } = await c.from('kartes').select('base_record').eq('visit_id', m[1]).maybeSingle();
    const b = Object.assign({}, (k && k.base_record) || {}, { receipt_claim_type: body.receipt_claim_type || 'normal' });
    if (k && k.base_record) { const { error } = await c.from('kartes').update({ base_record: b }).eq('visit_id', m[1]); if (error) return err(400, error.message); }
    return { data: { record_id: m[1], receipt_claim_type: b.receipt_claim_type } };
  });
  on('PATCH', /^\/receipt-claims\/billings\/([0-9a-f-]{36})\/claim-status$/, async (m, q, body) => ({ data: { billing_id: m[1], claim_status: body.claim_status || 'include', note: body.note || null } }));
  // 返戻は統合版のレセプト作成（返戻レセプト取込）で扱う。この画面からは未対応
  on('GET', /^\/receipt-claims\/returns$/, async () => ({ data: [] }));
  on('POST', /^\/receipt-claims\/returns\/(preview|import)$/, async () => err(501, '返戻の取り込みは統合版のレセプト作成（返戻レセプト取込）を使ってください'));

  // ---- ZIP の中身（基準版と同じ並び） ----
  // 提出年月日（基準版 receipt_submission_date と同じ: 予定日 → 作成日。診療月の翌月より前なら翌月10日）
  function receiptSubmissionDate(b, archiveDate) {
    const first = ymOf(nextYm(ymOf(b.claim_month))).replace('-', '');
    const explicit = b.submission_date || b.submitted_at || b.planned_submission_date;
    const recorded = String(explicit || b.created_at || archiveDate || '').replace(/-/g, '').slice(0, 8);
    if (!/^\d{8}$/.test(recorded)) throw new Error('提出年月日を確認してください');
    if (recorded.slice(0, 6) < first) { if (explicit) throw new Error('提出年月日は診療月の翌月以降を指定してください'); return first + '10'; }
    return recorded;
  }
  function warningRowsOf(b) {
    const rep = b.review_report || {};
    const rows = Array.isArray(rep.pdf_rows) ? rep.pdf_rows.slice()
      : [summaryRow(0, (rep.advisory_rows || []).length)].concat((rep.advisory_rows || []).map((r) => (Array.isArray(r) ? r : ['', r.patient_no || '', '', '', r.message || ''])));
    let conf = b.review_confirmation; if (typeof conf === 'string') { try { conf = JSON.parse(conf); } catch (e) { conf = null; } }
    if (b.claim_kind === 'submission' && conf && typeof conf === 'object' && Object.keys(conf).length) {
      rows.push(['', '', '確認記録', '', '確認者: ' + (conf.reviewed_by || '') + '\n確認日時: ' + (conf.reviewed_at || '') + '\n確認理由: ' + (conf.note || '') + '\n元の確認事項は上記に保持しています。']);
    }
    return rows;
  }
  async function warningListPdf(b, stamp) {
    const R = await reviewPart(); if (!R) return null;
    const pages = R.buildWarningListPages(warningRowsOf(b), ymOf(b.claim_month).replace('-', ''), stamp);
    return new Uint8Array(await (await R.toPdf(pages, { title: '要確認レセプト一覧' })).arrayBuffer());
  }
  // 医療費請求書（連記式）。点検用は対象があるときだけ、提出用は対象が無ければ白紙（基準版と同じ）
  async function renkiPdf(b, submission) {
    const items = b.renki_items || [];
    const R = await reviewPart(); if (!R) return { pdf: null, errors: [] };
    if (!items.length) return { pdf: submission ? await blankPdf(R) : null, errors: [] };
    const submitted = receiptSubmissionDate(b, today().replace(/-/g, ''));
    const claimDate = submitted.slice(0, 4) + '-' + submitted.slice(4, 6) + '-' + submitted.slice(6, 8);
    const src = items.map((x) => (x.renki_header ? Object.assign({}, x, { renki_header: Object.assign({}, x.renki_header, { claim_date: claimDate }) }) : x));
    const errors = Array.from(new Set(src.flatMap((x) => x.renki_errors || [])));
    const r = R.buildRenkiPages(src, { inspection: !submission });   // 提出用で直すべき点が残っていれば止める（基準版と同じ）
    return { pdf: r.pages.length ? new Uint8Array(await (await R.toPdf(r.pages, { title: '愛知県 医療費請求書（連記式）' })).arrayBuffer()) : (submission ? await blankPdf(R) : null), errors };
  }
  async function blankPdf(R) { return new Uint8Array(await (await R.toPdf([R.buildBlankPage()], { title: '医療費請求書' })).arrayBuffer()); }
  // 総括表・送付書・返戻用の帳票（receipt_ledger_svg.js の ReceiptLedgerSvg が有れば。name は discSubmission / socialSummary / nationalList /
  // nationalReturnSummary / nationalReturnInvoice。引数は基準版の build_…_pdf と同じ並び）
  async function ledgerPdf(name, args, title) {
    const L = await ledgerPart(); if (!L || typeof L[name] !== 'function') return null;
    try {
      const pages = await L[name].apply(L, args);
      if (!pages || !pages.length) return null;
      const blob = typeof L.toPdf === 'function' ? await L.toPdf(pages, { title }) : await (await pdfPart()).fromSvgPages(pages, { title });
      return new Uint8Array(await blob.arrayBuffer());
    } catch (e) { console.info('[置き換え層] ' + title + ' を作れません: ' + e.message); }
    return null;
  }
  const payerPdfName = (g) => g + '/' + (g === 'shaho' ? '社保レセプト.pdf' : '国保レセプト.pdf');
  async function inspectionFiles(b) {
    const files = [], stamp = today().replace(/-/g, '');
    for (const g of ['shaho', 'kokuho']) if (b.uke && b.uke[g]) files.push([g + '/点検用.UKE', await cp932(b.uke[g])]);
    for (const g of ['shaho', 'kokuho']) if (b.uke && b.uke[g]) { const pdf = await formPdf(b.uke[g], g); if (pdf) files.push([payerPdfName(g), pdf]); }
    const wl = await warningListPdf(b, stamp);
    if (wl) files.push(['要確認レセプト一覧_' + stamp + '.pdf', wl]);
    else files.push(['要確認レセプト一覧_' + stamp + '.txt', new TextEncoder().encode(warningRowsOf(b).map((r) => r[4]).join('\r\n') + '\r\n')]);
    const k = await renkiPdf(b, false);
    if (k.pdf) files.push(['kouhi/医療費請求書.pdf', k.pdf]);
    return files;
  }
  async function submissionFiles(b) {
    const files = [], stamp = today().replace(/-/g, '');
    const ym = ymOf(b.claim_month).replace('-', '');
    const submitted = receiptSubmissionDate(b, stamp);
    const items = (b.items || []).filter((x) => x.is_claim_included !== false);
    const facility = await facilityInfo((b.uke && (b.uke.shaho || b.uke.kokuho)) || '');
    const receipts = monthly(items);   // 総括表・返戻用は月単位に束ねたレセプトで数える
    const regular = receipts.filter((x) => !isResubmit(x)), returns = receipts.filter(isResubmit);
    const paper = (x) => x.receipt_claim_type === 'resubmit_paper';
    const add = (name, data) => { if (data) files.push([name, data]); };
    add('国保総括表（一覧）.pdf', await ledgerPdf('nationalList', [regular.filter((x) => x.payer_group === 'kokuho'), returns.filter((x) => x.payer_group === 'kokuho'), facility, ym, stamp], '国保総括表（一覧）'));
    add('社保総括表.pdf', await ledgerPdf('socialSummary', [regular.filter((x) => x.payer_group === 'shaho'), facility, ym, submitted], '社保総括表'));
    const wl = await warningListPdf(b, stamp);
    if (wl) add('要確認レセプト一覧_' + stamp + '.pdf', wl);
    else add('要確認レセプト一覧_' + stamp + '.txt', new TextEncoder().encode(warningRowsOf(b).map((r) => r[4]).join('\r\n') + '\r\n'));
    for (const payer of ['kokuho', 'shaho']) {
      const returned = returns.filter((x) => x.payer_group === payer), paperReturns = returned.filter(paper);
      add(payer + '/光ディスク等送付書.pdf', await ledgerPdf('discSubmission', [facility, ym, submitted, payer], '光ディスク等送付書'));
      const returnedBillings = items.filter((x) => isResubmit(x) && x.payer_group === payer).length;   // 基準版は会計（受診）単位で数える
      add(payer + '/返戻処理結果.txt', await cp932(returnedBillings ? '返戻再請求対象: ' + returnedBillings + '件\r\n' : '返戻再請求対象はありません。\r\n'));
      if (payer === 'shaho') add('shaho/返戻用社保総括表.pdf', await ledgerPdf('socialSummary', [paperReturns, facility, ym, submitted, true], '返戻用社保総括表'));
      else {
        add('kokuho/返戻用国保総括表.pdf', await ledgerPdf('nationalReturnSummary', [paperReturns, facility, ym, submitted], '返戻用国保総括表'));
        const elderly = (x) => digitsOf(x.insurer_number).startsWith('39');
        add('kokuho/返戻用国保請求書.pdf', await ledgerPdf('nationalReturnInvoice', [paperReturns.filter((x) => !elderly(x)), facility, ym, submitted, false], '返戻用国保請求書'));
        add('kokuho/返戻用後期高齢者請求書.pdf', await ledgerPdf('nationalReturnInvoice', [paperReturns.filter(elderly), facility, ym, submitted, true], '返戻用後期高齢者請求書'));
      }
    }
    const k = await renkiPdf(b, true);
    add('kouhi/医療費請求書.pdf', k.pdf);
    if (k.errors.length) add('kouhi/連記式_要確認.txt', new TextEncoder().encode(k.errors.join('\n')));
    // UKE: 通常ぶん（対象のある側を社保→国保の順、無い側は空の UKE を後ろに）→ 返戻再請求ぶん（-henrei）
    const sets = b.uke_split ? [['', b.uke_split.regular || {}], ['-henrei', b.uke_split.henrei || {}]] : [['', b.uke || {}], ['-henrei', {}]];
    for (const [suffix, u] of sets) {
      const have = ['shaho', 'kokuho'].filter((g) => u[g]);
      const order = have.concat(['kokuho', 'shaho'].filter((g) => !u[g]));
      for (const g of order) add(g + suffix + '/RECEIPTC.UKE', await cp932(u[g] || await emptyUke(g, ym, b.claim_ym || submitted.slice(0, 6))));
    }
    return files;
  }
  // 対象の無い請求先の UKE（医療機関の行と合計 0 の行だけ。基準版と同じく提出の置き場をそろえる）
  async function emptyUke(g, serviceYm, claimYm) {
    const w = await karteEngine();
    if (C.applyFacilityToUke) await C.applyFacilityToUke(w);
    return w.buildUkeText([], g === 'shaho' ? '1' : '2', null, null, null, serviceYm, { claimYm: String(claimYm).replace('-', '') });
  }

  // ---- UKE の文字コード（CP932）・様式 PDF・無圧縮 ZIP ----
  async function cp932(text) {
    const w = await karteEngine(); const E = w.Encoding;
    if (!E) throw new Error('文字コード変換の部品がありません');
    const body = text.endsWith('\x1a') ? text.slice(0, -1) : text;   // 末尾の 0x1A は変換に通さず足す
    const arr = E.convert(E.stringToCode(body), { to: 'SJIS', from: 'UNICODE' });
    const out = new Uint8Array(arr.length + (text.endsWith('\x1a') ? 1 : 0)); out.set(arr); if (text.endsWith('\x1a')) out[arr.length] = 0x1a;
    return out;
  }
  async function formPdf(ukeText, group, patientNo) {
    let v; try { v = await viewerEngine(); } catch (e) { return null; }
    const RFS = inFrame(v, 'RezeptFormSvg'), RFP = await pdfPart();   // PDF にする部品は必要になったときに読む
    if (!RFS || !RFP) return null;
    const recs = v.parseUKE(ukeText, group).filter((r) => !patientNo || r.karteNumber === patientNo);
    const facility = { name: '', address: '', phone: '', medical_institution_code: '' };
    const ir = String(ukeText).split(/\r?\n/).find((l) => l.startsWith('IR,')); if (ir) { const f = ir.split(','); facility.medical_institution_code = f[4]; facility.name = f[6]; facility.phone = f[9]; }
    const fx = C.facilityForForm ? await C.facilityForForm() : null; if (fx) Object.assign(facility, fx);   // 医療機関情報が入っている院はその値
    const pages = []; recs.forEach((r, i) => { pages.push(...RFS.buildReceiptPages(RFS.receiptFromViewer(r), facility, i + 1).pages); });
    if (!pages.length) return null;
    const blob = await RFP.fromSvgPages(pages, { title: '点検用レセプト' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // 無圧縮（store）の ZIP。名前は UTF-8（汎用フラグ bit 11）
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
})();
