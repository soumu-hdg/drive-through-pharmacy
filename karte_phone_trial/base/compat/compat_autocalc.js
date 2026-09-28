// ===== 置き換え層：自動算定（工程4・2026-09-24） compat_autocalc.js =====
// 基準版の /auto-calculation...（カルテ下の電卓ボタン・施設設定の「自動算定」）を、基準版のサーバーと同じ判定で返す。
//   ・判定（初再診・時間外/休日/深夜・乳幼児・外来管理加算・処方料/処方箋料/調剤料・指導料・施設ごとの標準算定・算定ルール）は
//     基準版のサーバー（routers/auto_calculation.py・services/auto_calculator.py・auto_calc_standard_actions.py・
//     medical_action_resolver.py・santei_rule_engine.py）をそのまま JS に写した。点数・コードも基準版と同じ
//   ・基準版が DB から読む「過去の来院・その月の算定」は統合版の来院（visits）＋カルテ（kartes.base_record の行為、無ければ算定明細）、
//     「患者ごとの傷病名」は傷病名の置き換え（compat_diagnoses.js）が返す一覧から読む
//   ・公式の診療行為マスターは master/s_procedures.json、医薬品は master/y_drugs.json、区分番号は proc_kubun.json・beppyo1_codes.json
//   ・特定疾患マスター・算定ルールは基準版の初期データ（migrations 019・028・029・045）をここに持つ（基準版も DB の初期データのまま）
//   ・施設ごとの設定（自動算定の ON/OFF・時間帯）と「自動算定する診療行為」の一覧は、統合版にまだ置き場が無いので
//     院ごとに DB（karte_clinic_store。compat_api.js の store）へ置く。無いときは基準版の既定値。DB を使う印の無い院は従来どおり端末に置く
//   ・判定の本体は window.__autocalcCore にも出す（DB を使わない部分を Node の突き合わせ台本から呼ぶため）
(function () {
  // ======================================================================
  // 判定の本体（DB・画面に依存しない。データは deps で渡す）
  // ======================================================================
  const core = (function () {
    // ---- Python の書き方に合わせる小道具 ----
    const s = (v) => (v ? String(v) : '');                       // str(v or "")
    const truthy = (v) => Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object') ? Object.keys(v).length > 0 : !!v;
    const toInt = (v, d = 0) => { if (v === null || v === undefined || v === '') return d; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
    const nfkc = (v) => String(v == null ? '' : v).normalize('NFKC');
    const pad = (n, w) => String(n).padStart(w || 2, '0');
    const isoDate = (v) => { if (!v) return null; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
    const addDays0 = (d) => d.slice(0, 8) + '01';                 // 月初
    const unique = (list, values) => { const seen = new Set(list); values.forEach((x) => { if (x && !seen.has(x)) { list.push(x); seen.add(x); } }); };

    // ---- 日付・時刻（受付の日時。タイムゾーンは付いていてもそのままの時刻を使う＝基準版と同じ） ----
    function parseDatetime(v) {
      const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6})\d*)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
      if (!m) return null;
      const micro = m[7] ? Number(m[7].padEnd(6, '0')) : 0;
      return { date: `${m[1]}-${m[2]}-${m[3]}`, h: Number(m[4] || 0), mi: Number(m[5] || 0), se: Number(m[6] || 0), micro, tz: m[8] || '' };
    }
    const secOf = (dt) => dt.h * 3600 + dt.mi * 60 + dt.se + dt.micro / 1e6;
    const secOfText = (t) => { const m = String(t).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : 0; };
    function isoDatetime(dt) {
      let t = `${dt.date}T${pad(dt.h)}:${pad(dt.mi)}:${pad(dt.se)}`;
      if (dt.micro) t += '.' + pad(dt.micro, 6);
      if (dt.tz) t += dt.tz === 'Z' ? '+00:00' : (dt.tz.includes(':') ? dt.tz : dt.tz.slice(0, 3) + ':' + dt.tz.slice(3));
      return t;
    }
    const ymd = (d) => d.split('-').map(Number);
    const weekday = (d) => { const [y, mo, da] = ymd(d); return (new Date(Date.UTC(y, mo - 1, da)).getUTCDay() + 6) % 7; };   // 0=月曜・6=日曜

    // ======================================================================
    // 診療行為の名寄せ（medical_action_resolver.py）
    // ======================================================================
    const KNOWN = [
      ['111000110', '初診料', 291, '診察', [], ['A000']],
      ['112007410', '再診料', 76, '診察', [], ['A001']],
      ['111000570', '時間外加算（初診）', 85, '診察', ['時間外加算(初診)'], ['A000-T1']],
      ['111000670', '休日加算（初診）', 250, '診察', ['休日加算(初診)'], ['A000-T2']],
      ['111000770', '深夜加算（初診）', 480, '診察', ['深夜加算(初診)', '深夜加算（22時〜）（初診）'], ['A000-T3']],
      ['112001110', '時間外加算（再診）', 65, '診察', ['時間外加算(再診)'], ['A001-T1']],
      ['112001210', '休日加算（再診）', 190, '診察', ['休日加算(再診)'], ['A001-T2']],
      ['112001310', '深夜加算（再診）', 420, '診察', ['深夜加算(再診)', '深夜加算（22時〜）（再診）'], ['A001-T3']],
      ['111000370', '乳幼児加算（初診）', 75, '診察', ['乳幼児加算(初診)'], ['A000-I']],
      ['112000970', '乳幼児加算（再診）', 38, '診察', ['乳幼児加算(再診)'], ['A001-I']],
      ['111013770', '機能強化加算（初診）', 80, '診察', ['機能強化加算', '機能強化加算(初診)'], ['A000-F', 'A003']],
      ['111014870', '外来感染対策向上加算（初診）', 6, '診察', ['外来感染対策向上加算', '外来感染対策向上加算(初診)'], ['A005']],
      ['111702970', '発熱患者等対応加算（初診）', 20, '診察', ['発熱患者等対応加算', '発熱患者等対応加算(初診)'], []],
      ['111014970', '連携強化加算（初診）', 3, '診察', ['連携強化加算', '連携強化加算(初診)'], []],
      ['111704170', '電子的診療情報連携体制整備加算２（初診）', 9, '診察', ['電子的診療情報連携体制整備加算2（初診）', '電子的診療情報連携体制整備加算２(初診)', '電子的診療情報連携体制整備加算2(初診)'], []],
      ['180819910', '物価対応料１（外来・在宅物価対応料）（初診時）イ', 2, 'その他', ['物価対応料1（外来・在宅物価対応料）（初診時）イ', '物価対応料１(外来・在宅物価対応料)(初診時)イ', '物価対応料1(外来・在宅物価対応料)(初診時)イ'], ['41']],
      ['180820010', '物価対応料１（外来・在宅物価対応料）（再診時等）ロ', 2, 'その他', [], []],
      ['180853810', '外来・在宅ベースアップ評価料（１）１（初診時）（賃上取組）', 23, 'その他', ['外来・在宅ベースアップ評価料(1)1(初診時)(賃上取組)', '外来・在宅ベースアップ評価料（１）１（初診時）'], ['2']],
      ['180853910', '外来・在宅ベースアップ評価料（１）２（再診時等）（賃上取組）', 6, 'その他', ['外来・在宅ベースアップ評価料(1)2(再診時等)(賃上取組)', '外来・在宅ベースアップ評価料（１）２（再診時等）'], ['3']],
    ].map(([action_code, name, score, category, aliases, code_aliases]) => ({ action_code, name, score, category, aliases, code_aliases }));
    const lookupText = (v) => nfkc(s(v)).replace(/〜/g, '~').replace(/～/g, '~').replace(/･/g, '・').replace(/\s+/g, '').trim().toLowerCase();
    const KNOWN_BY_CODE = new Map(), KNOWN_BY_NAME = new Map();
    KNOWN.forEach((a) => { KNOWN_BY_CODE.set(a.action_code, a); });
    KNOWN.forEach((a) => a.code_aliases.forEach((c) => KNOWN_BY_CODE.set(c, a)));
    KNOWN.forEach((a) => [a.name].concat(a.aliases).forEach((n) => KNOWN_BY_NAME.set(lookupText(n), a)));
    const pickKnown = (a) => ({ action_code: a.action_code, name: a.name, score: a.score, category: a.category });
    // 名称が一致すれば名称を優先（古いコードでも名称が正しければ直す）
    function getKnown(code, name) {
      const nn = lookupText(name); if (KNOWN_BY_NAME.has(nn)) return pickKnown(KNOWN_BY_NAME.get(nn));
      const cv = s(code).trim(); if (KNOWN_BY_CODE.has(cv)) return pickKnown(KNOWN_BY_CODE.get(cv));
      const nc = lookupText(code); if (KNOWN_BY_CODE.has(nc)) return pickKnown(KNOWN_BY_CODE.get(nc));
      return null;
    }

    // ---- 公式マスター（s_procedures.json 等）。基準版の medical_action_master 相当 ----
    // 基準版は公式マスターの取込で category に「点数欄集計先識別」を入れている。標準算定の一覧に出る行だけここに持つ
    const POINT_COL = { '112011010': '122', '120001210': '250', '120000710': '210', '120001010': '230', '120002170': '250', '120002910': '800', '120002470': '800',
      '120003610': '250', '120005610': '250', '120005710': '800', '160061710': '600', '160061810': '600', '160061910': '600', '160062010': '600', '160062110': '600',
      '160062210': '600', '160146910': '600', '160147610': '600', '160218110': '600', '160062310': '600', '160000190': '600', '180020570': '800' };
    function makeMasters(proc, drugs, kubunList) {
      const byName = new Map(); Object.keys(proc || {}).sort().forEach((c) => { const n = proc[c].name; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(c); });
      const drugByName = new Map(); Object.keys(drugs || {}).sort().forEach((c) => { const n = drugs[c].name; if (!drugByName.has(n)) drugByName.set(n, []); drugByName.get(n).push(c); });
      const kubun = {}; (kubunList || []).forEach((m) => Object.keys(m || {}).forEach((c) => { const k = typeof m[c] === 'string' ? m[c] : (m[c] && m[c].k); if (k) kubun[c] = k; }));
      return { proc: proc || {}, byName, drugs: drugs || {}, drugByName, kubun, ok: !!(proc && Object.keys(proc).length) };
    }
    const procScore = (e) => Math.trunc(parseFloat(e.pts) || 0);
    // 基準版 resolve_exact_auto_calc_medical_action：既知 → 公式マスター（コード一致 または 名称一致・コードの若い順に1件）
    function resolveExact(M, code, name) {
      const known = getKnown(code, name); if (known) return known;
      const cv = s(code).trim(), nv = s(name).trim(); if (!cv && !nv) return null;
      const cand = [];
      if (cv && !cv.startsWith('DMSTD') && M.proc[cv]) cand.push(cv);
      if (nv && M.byName.has(nv)) cand.push(...M.byName.get(nv));
      if (!cand.length) return null;
      const c = cand.sort()[0], e = M.proc[c];
      return { action_code: c, name: e.name, score: procScore(e), category: POINT_COL[c] || null };
    }
    const codeByName = (M, name) => { const l = M.byName.get(s(name).trim()); return l ? l[0] : ''; };

    // ======================================================================
    // 施設ごとの標準算定一覧（auto_calc_standard_actions.py）
    // ======================================================================
    const STD_PERIOD_START = '2026-06-01', STD_PERIOD_END = '9999-12-31';
    const knownStd = (code, group, condition_key, condition_text) => { const k = getKnown(code); return { group, category: k.category, action_code: k.action_code, action_name: k.name, score: k.score, condition_key, condition_text, is_auto_add: true }; };
    const std = (group, category, action_code, action_name, score, condition_key, condition_text, is_auto_add) => ({ group, category, action_code, action_name, score, condition_key, condition_text, is_auto_add });
    const JUDGE = '判断料が算定できる検査・撮影を実施する場合に算定';
    const STANDARD = [
      knownStd('111013770', '11', 'initial_clinic_function_enhancement', '初診で機能強化加算の施設基準を満たす場合に算定'),
      knownStd('111014870', '11', 'initial_outpatient_infection_control', '初診で外来感染対策向上加算の施設基準を満たす場合に算定'),
      knownStd('111702970', '11', 'initial_fever_patient_response', '初診で発熱患者等対応加算の算定条件を満たす場合に算定'),
      knownStd('111014970', '11', 'initial_infection_collaboration', '初診で連携強化加算の施設基準を満たす場合に算定'),
      knownStd('111704170', '44', 'initial_electronic_info_2', '初診で電子的診療情報連携体制整備加算2の算定条件を満たす場合に算定'),
      knownStd('180819910', '41', 'initial_price_support_1', '初診時の外来・在宅物価対応料1を算定'),
      knownStd('180820010', '80', 'revisit_price_support_1', '再診時の外来・在宅物価対応料1を算定'),
      knownStd('180853810', '2', 'initial_baseup_1_wage', '初診時の外来・在宅ベースアップ評価料（1）1を算定'),
      std('11', '診察', '111000370', '乳幼児加算（初診）', 75, 'infant_initial_visit', '6歳未満の乳幼児に対して初診を行った場合に算定', true),
      std('12', '診察', '112000970', '乳幼児加算（再診）', 38, 'infant_revisit', '6歳未満の乳幼児に対して再診を行った場合に算定', true),
      std('12', '診察', '112011010', '外来管理加算', 52, 'outpatient_management', '再診で外来管理加算を算定できない診療行為が入力されていない場合に算定', true),
      std('25', '投薬', '120001210', '処方料（その他）', 42, 'internal_prescription_fee_other', '院内処方の場合に算定', true),
      std('25', '投薬', 'DMSTD005', '処方料（向精神薬多剤投与）', 0, 'internal_psychotropic_multi_prescription_fee', '抗不安薬、睡眠薬、抗うつ薬、向精神薬が3種類以上院内処方されている場合に算定', false),
      std('25', '投薬', '120000710', '調剤料（内服薬・浸煎薬・屯服薬）', 11, 'internal_dispensing_oral_decoction_prn', '内服薬の院内処方がある場合に算定', true),
      std('25', '投薬', '120001010', '調剤料（外用薬）', 8, 'internal_dispensing_external', '外用薬の院内処方がある場合に算定', true),
      std('25', '投薬', '120002170', '乳幼児加算(処方料)', 3, 'infant_internal_prescription_fee_addition', '3歳未満の乳幼児に院内処方した場合に算定', true),
      std('25', '投薬', 'DMSTD009', '処方料(7種類以上内服薬)', 0, 'internal_prescription_fee_seven_or_more_oral', '内服薬が７種類以上院内処方されている場合に算定', false),
      std('25', '投薬', 'DMSTD010', '薬剤料逓減（7種類以上の院内処方）', 0, 'internal_drug_fee_reduction_seven_or_more', '7種類以上の内服薬・頓服薬が院内処方されている場合（臨時投薬を除く）に算定', false),
      std('25', '投薬', 'DMSTD011', '特定疾患処方管理加算（処方料）', 56, 'specific_disease_internal_prescription_management', '特定の傷病名が登録され、病名診療科とカルテ診療科が同じ条件で、28日以上の院内処方を行った場合に算定。頓服薬・外用薬は自動算定対象外', false),
      std('26', '投薬', 'DMSTD012', '麻薬等加算(処方料)', 0, 'narcotic_etc_internal_prescription_fee_addition', '麻薬・向精神薬・覚せい剤原料・向精神薬を院内処方した場合に算定', false),
      std('26', '投薬', 'DMSTD013', '麻薬等加算(調剤料)(入院外)', 0, 'narcotic_etc_internal_dispensing_fee_addition', '麻薬・向精神薬・覚せい剤原料・向精神薬を院内処方した場合に算定', false),
      std('30', '注射', 'DMSTD014', '乳幼児加算（静脈内注射）(点滴注射)', 0, 'infant_intravenous_drip_addition', '６歳未満の乳幼児に対して行った場合', false),
      std('40', '処置', 'DMSTD015', '乳幼児加算/幼児加算（処置）', 0, 'infant_child_procedure_addition', '特定の処置について、年齢条件を満たす場合に算定', false),
      std('50', '手術', 'DMSTD016', '乳幼児加算/幼児加算（手術・麻酔）', 0, 'infant_child_surgery_anesthesia_addition', '特定の手術について、年齢条件を満たす場合に算定', false),
      std('60', '検査', 'DMSTD017', '尿・糞便等検査判断料', 0, 'urine_feces_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD018', '血液学的検査判断料', 0, 'hematology_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD019', '生化学的検査（１）判断料', 0, 'biochemistry_1_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD020', '生化学的検査（２）判断料', 0, 'biochemistry_2_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD021', '免疫学的検査判断料', 0, 'immunology_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD022', '微生物学的検査判断料', 0, 'microbiology_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD023', '呼吸機能検査等判断料', 0, 'respiratory_function_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD024', '脳波検査判断料２', 0, 'eeg_exam_judgment_fee_2', JUDGE, false),
      std('60', '検査', 'DMSTD025', '神経・筋検査判断料', 0, 'nerve_muscle_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD026', 'ラジオ・アイソトープ検査判断料', 0, 'radioisotope_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD027', '遺伝子関連・染色体検査判断料', 0, 'genetic_chromosome_exam_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD028', '病理判断料', 0, 'pathology_judgment_fee', JUDGE, false),
      std('60', '検査', 'DMSTD029', 'B-V', 0, 'blood_collection_bv', '血液採取を伴う検体検査がある場合に算定', false),
      std('60', '検査', 'DMSTD030', '乳幼児加算(血液採取)', 0, 'infant_blood_collection_addition', '６歳未満の乳幼児に対して行った場合', false),
      std('60', '検査', 'DMSTD031', '新生児加算/乳幼児加算（生体検査）', 0, 'newborn_infant_physiological_exam_addition', '特定の生体検査について、年齢条件を満たす場合に算定', false),
      std('60', '検査', 'DMSTD032', '検査逓減', 0, 'physiological_exam_reduction', '生体検査が、月２回以上算定されている場合に算定', false),
      std('70', '画像', 'DMSTD033', '乳幼児加算/幼児加算（画像診断）', 0, 'infant_child_imaging_addition', '特定の画像診断について、年齢条件を満たす場合に算定', false),
      std('70', '画像', 'DMSTD034', '核医学診断（E101-2～E101-5）', 0, 'nuclear_medicine_e101_2_to_e101_5', JUDGE, false),
      std('70', '画像', 'DMSTD035', '核医学診断（それ以外）', 0, 'nuclear_medicine_other', JUDGE, false),
      std('70', '画像', 'DMSTD036', 'コンピュータ断層診断', 0, 'computed_tomography_diagnosis', JUDGE, false),
      std('70', '画像', 'DMSTD037', '2回目以降減算(CT、MRI)', 0, 'ct_mri_second_or_later_reduction', '撮影料（CT/MRI）が、月２回以上算定されている場合に算定', false),
      std('80', '投薬', '120002910', '処方箋料(リフィル以外・その他)', 60, 'external_prescription_fee_non_refill_other', '院外処方がある場合に算定', true),
      std('80', '投薬', 'DMSTD039', '処方箋料(リフィル処方箋・その他)', 0, 'external_prescription_fee_refill_other', '院外処方があって、「リフィル可」コメントが入力されている場合に算定', false),
      std('80', '投薬', 'DMSTD040', '処方箋料(リフィル以外・向精神薬多剤投与)', 0, 'external_prescription_fee_non_refill_psychotropic_multi', '抗不安薬、睡眠薬、抗うつ薬、向精神薬が3種類以上院外処方されている場合に算定', false),
      std('80', '投薬', 'DMSTD041', '処方箋料(リフィル処方箋・向精神薬多剤投与)', 0, 'external_prescription_fee_refill_psychotropic_multi', '抗不安薬、睡眠薬、抗うつ薬、向精神薬が3種類以上院外処方されていて、「リフィル可」コメントが入力されている場合に算定', false),
      std('80', '投薬', '120002470', '処方せん（乳幼児）加算', 3, 'infant_external_prescription_addition', '3歳未満の乳幼児に院外処方した場合に算定', true),
      std('80', '投薬', 'DMSTD043', '処方箋料(リフィル以外・7種類以上内服薬)', 0, 'external_prescription_fee_non_refill_seven_or_more_oral', '内服薬が７種類以上院外処方されている場合（臨時投薬を除く）に算定', false),
      std('80', '投薬', 'DMSTD044', '処方箋料(リフィル処方箋・7種類以上内服薬)', 0, 'external_prescription_fee_refill_seven_or_more_oral', '内服薬が７種類以上院外処方されていて（臨時投薬を除く）、「リフィル可」コメントが入力されている場合に算定', false),
      std('80', '投薬', 'DMSTD045', '一般名処方加算１、２', 0, 'generic_prescription_addition', '一般名処方を含む院外処方がある場合に算定', false),
      std('80', '精神科', 'DMSTD046', '通院・在宅精神療法（２０歳未満）加算', 0, 'psychiatric_therapy_under_20_addition', '20歳未満の患者（初診から1年以内）に通院・在宅精神療法を行った場合に算定', false),
      std('80', '投薬', 'DMSTD047', '特定疾患処方管理加算（処方箋料）', 56, 'specific_disease_external_prescription_management', '特定の傷病名が登録され、病名診療科とカルテ診療科が同じ条件で、28日以上の院外処方を行った場合に算定。リフィル処方箋で合計28日以上になる場合も含む', false),
      std('-', '労災', 'DMSTD048', '外来管理加算（労災）', 0, 'workers_comp_outpatient_management', '労災（労災準拠自賠責）の再診で外来管理加算の算定基準を満たす場合に算定', false),
      std('-', '労災', 'DMSTD049', '外来管理加算（読み替え加算）', 0, 'workers_comp_outpatient_management_replacement', '労災（労災準拠自賠責）の再診で外来管理加算の算定基準を満たす場合に算定', false),
      std('-', '年齢加算', 'DMSTD050', 'その他の年齢加算（乳幼児・幼児）', 0, 'other_age_addition_infant_child', '各診療行為で年齢加算が算定できる項目を入力した場合に年齢加算を算定', false),
    ];
    const isUnresolved = (a) => s(a.action_code).startsWith('DMSTD');
    const sanitize = (a) => { const x = Object.assign({}, a); if (isUnresolved(x)) { x.score = 0; x.is_auto_add = false; } return x; };
    function resolveStandard(M, a) {
      const x = Object.assign({}, a); const r = resolveExact(M, x.action_code, x.action_name); if (!r) return sanitize(x);
      const orig = s(x.action_code);
      Object.assign(x, { action_code: r.action_code, action_name: r.name, score: toInt(r.score), category: r.category || x.category, resolved_from_master: true });
      if (orig && orig !== x.action_code) x.source_action_code = orig;
      return x;
    }
    const stdTrigger = (a) => ({ source: 'digikar_standard', group: a.group, condition_key: a.condition_key, condition_text: a.condition_text,
      period_start: STD_PERIOD_START, period_end: STD_PERIOD_END, requires_exact_master_code: isUnresolved(a) });
    const resolvedStandard = (M) => STANDARD.map((a) => resolveStandard(M, a));
    // 基準版 ensure_standard_auto_calculation_actions：施設の一覧に標準の行を補う（既にある行は内容を標準に合わせ直す。無効化は残す）
    function ensureStandard(M, rows, facilityId, reactivate, now, newId) {
      resolvedStandard(M).forEach((a, i) => {
        const sort_order = 10 + i, trig = stdTrigger(a);
        const ex = rows.find((r) => (r.action_code === a.action_code && r.action_name === a.action_name) || (r.trigger_condition && r.trigger_condition.condition_key) === trig.condition_key);
        const vals = { action_code: a.action_code, action_name: a.action_name, score: a.score, category: a.category, trigger_condition: trig, is_auto_add: a.is_auto_add, sort_order };
        if (ex) { Object.assign(ex, vals, { is_active: reactivate ? true : ex.is_active, updated_at: now }); return; }
        rows.push(Object.assign({ id: newId(), facility_id: facilityId }, vals, { is_active: true, created_at: now, updated_at: now }));
      });
      return rows;
    }
    const sortRows = (rows) => rows.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.action_name < b.action_name ? -1 : a.action_name > b.action_name ? 1 : 0));
    // 基準版 normalize_auto_calc_catalog_row_from_master
    function normalizeCatalogRow(M, row) {
      let x = Object.assign({}, row); const r = resolveExact(M, x.action_code, x.action_name);
      if (r) Object.assign(x, { action_code: r.action_code, action_name: r.name, score: toInt(r.score), category: r.category || x.category }); else x = sanitize(x);
      const cond = Object.assign({}, x.trigger_condition || {});
      if (truthy(cond)) { cond.requires_exact_master_code = isUnresolved(x); x.trigger_condition = cond; }
      return x;
    }
    const activeCatalog = (M, rows) => sortRows(rows.filter((r) => r.is_active)).map((r) => normalizeCatalogRow(M, r));
    function actionResponse(row) {
      const t = row.trigger_condition || {};
      return { id: row.id, facility_id: row.facility_id, action_code: row.action_code, action_name: row.action_name, score: row.score || 0, category: row.category == null ? null : row.category,
        group: t.group || row.category || null, condition_text: t.condition_text == null ? null : t.condition_text, period_start: isoDate(t.period_start), period_end: isoDate(t.period_end),
        trigger_condition: t, is_auto_add: !!row.is_auto_add, sort_order: row.sort_order || 0, is_active: !!row.is_active, created_at: row.created_at || null, updated_at: row.updated_at || null };
    }
    function buildTrigger(group, conditionText, periodStart, periodEnd, base) {
      const t = Object.assign({}, base || {});
      if (group != null) t.group = group; if (conditionText != null) t.condition_text = conditionText;
      if (periodStart != null) t.period_start = periodStart; if (periodEnd != null) t.period_end = periodEnd;
      return t;
    }

    // ======================================================================
    // 自動算定エンジン（auto_calculator.py）
    // ======================================================================
    const C_ = { INITIAL_VISIT: '111000110', REVISIT: '112007410', OUTPATIENT_CLINIC: '112011310', OUTPATIENT_MANAGEMENT: '112011010',
      INFANT_ADD_INITIAL: '111000370', OVERTIME_ADD_INITIAL: '111000570', HOLIDAY_ADD_INITIAL: '111000670', NIGHT_ADD_INITIAL: '111000770',
      INFANT_ADD_REVISIT: '112000970', OVERTIME_ADD_REVISIT: '112001110', HOLIDAY_ADD_REVISIT: '112001210', NIGHT_ADD_REVISIT: '112001310',
      PRESCRIPTION_FEE: '120002910', DISPENSING_FEE: '120001210', DISPENSING_ORAL: '120000710', DISPENSING_EXTERNAL: '120001010', INFANT_ADD_PRESC: '120002470', INFANT_ADD_DISP: '120002170',
      SPECIFIC_DISEASE: '113001810', DERMATOLOGY: '113000910', EPILEPSY: '113002850', INTRACTABLE_DISEASE: '113002910' };
    const SPECIFIC_DISEASE_KEYWORDS = ['糖尿病', '高血圧', '脂質異常症', '高脂血症', '甲状腺', '副甲状腺', '副腎皮質', '心不全', '心筋梗塞', '狭心症', '不整脈', '脳血管疾患', '脳梗塞', '脳出血',
      '慢性閉塞性肺疾患', 'COPD', '慢性気管支炎', '肺気腫', '喘息', '気管支喘息', '胃潰瘍', '十二指腸潰瘍', '肝硬変', '慢性肝炎', '慢性腎臓病', 'CKD', '慢性腎不全', '貧血', '痛風', '高尿酸血症'];
    const DERMATOLOGY_DISEASE_KEYWORDS = ['帯状疱疹', '蕁麻疹', 'じんましん', 'アトピー', 'アトピー性皮膚炎', '尋常性乾癬', '乾癬', '掌蹠膿疱症', '天疱瘡', '類天疱瘡', '円形脱毛症', '脂漏性皮膚炎', '慢性湿疹', '紅皮症'];
    const EPILEPSY_KEYWORDS = ['てんかん', '癲癇'];
    const INTRACTABLE_DISEASE_KEYWORDS = ['パーキンソン病', '多発性硬化症', '筋萎縮性側索硬化症', 'ALS', '全身性エリテマトーデス', 'SLE', '強皮症', '皮膚筋炎', '潰瘍性大腸炎', 'クローン病', '原発性胆汁性胆管炎', 'PBC', '特発性肺線維症', 'IPF'];
    const GUIDANCE_ACTIONS = { specific_disease: [C_.SPECIFIC_DISEASE, '特定疾患療養管理料（診療所）', 225], dermatology: [C_.DERMATOLOGY, '皮膚科特定疾患指導管理料(1)', 250],
      epilepsy: [C_.EPILEPSY, 'てんかん指導料', 250], intractable: [C_.INTRACTABLE_DISEASE, '難病外来指導管理料1', 270] };
    const PROCEDURE_PREFIXES = ['14', '15', '16', '17'];
    const SA = (code, name, score, reason, category, auto_add) => ({ code, name, score, reason, category: category || '', auto_add: auto_add !== false });

    // 特定疾患マスター（migrations/019 の初期データ。コードは空・キーワードで照合）
    const SD_SEED = [
      ['糖尿病', 'specific_disease', ['糖尿病', '1型糖尿病', '2型糖尿病', 'DM']], ['高血圧症', 'specific_disease', ['高血圧', '本態性高血圧', '二次性高血圧']],
      ['脂質異常症', 'specific_disease', ['脂質異常', '高脂血症', '高コレステロール', 'LDL', 'TG']], ['甲状腺機能障害', 'specific_disease', ['甲状腺機能低下', '甲状腺機能亢進', 'バセドウ', '橋本病']],
      ['慢性心不全', 'specific_disease', ['心不全', 'CHF', 'うっ血性心不全']], ['心筋梗塞', 'specific_disease', ['心筋梗塞', 'AMI', '急性心筋梗塞', '陳旧性心筋梗塞']],
      ['狭心症', 'specific_disease', ['狭心症', '労作性狭心症', '不安定狭心症']], ['不整脈', 'specific_disease', ['不整脈', '心房細動', 'AF', '期外収縮']],
      ['脳血管疾患', 'specific_disease', ['脳梗塞', '脳出血', '脳卒中', 'TIA', '一過性脳虚血']], ['慢性閉塞性肺疾患', 'specific_disease', ['COPD', '慢性気管支炎', '肺気腫']],
      ['気管支喘息', 'specific_disease', ['喘息', '気管支喘息', 'BA']], ['胃潰瘍', 'specific_disease', ['胃潰瘍', '十二指腸潰瘍', '消化性潰瘍']],
      ['肝硬変', 'specific_disease', ['肝硬変', 'LC']], ['慢性肝炎', 'specific_disease', ['慢性肝炎', 'B型肝炎', 'C型肝炎', 'HBV', 'HCV']],
      ['慢性腎臓病', 'specific_disease', ['CKD', '慢性腎臓病', '慢性腎不全', '腎機能低下']], ['貧血', 'specific_disease', ['貧血', '鉄欠乏性貧血', '腎性貧血']],
      ['痛風', 'specific_disease', ['痛風', '高尿酸血症']],
      ['帯状疱疹', 'dermatology', ['帯状疱疹', '帯状ヘルペス']], ['蕁麻疹', 'dermatology', ['蕁麻疹', 'じんましん', 'urticaria']], ['アトピー性皮膚炎', 'dermatology', ['アトピー', 'アトピー性皮膚炎', 'AD']],
      ['乾癬', 'dermatology', ['乾癬', '尋常性乾癬', 'psoriasis']], ['掌蹠膿疱症', 'dermatology', ['掌蹠膿疱症', 'PPP']], ['天疱瘡', 'dermatology', ['天疱瘡', '尋常性天疱瘡']],
      ['類天疱瘡', 'dermatology', ['類天疱瘡', '水疱性類天疱瘡']], ['円形脱毛症', 'dermatology', ['円形脱毛', 'alopecia']], ['脂漏性皮膚炎', 'dermatology', ['脂漏性皮膚炎', 'SD']],
      ['てんかん', 'epilepsy', ['てんかん', '癲癇', 'epilepsy', '部分発作', '全般発作']],
      ['パーキンソン病', 'intractable', ['パーキンソン病', 'PD', 'パーキンソン']], ['多発性硬化症', 'intractable', ['多発性硬化症', 'MS']], ['筋萎縮性側索硬化症', 'intractable', ['筋萎縮性側索硬化症', 'ALS']],
      ['全身性エリテマトーデス', 'intractable', ['全身性エリテマトーデス', 'SLE']], ['強皮症', 'intractable', ['強皮症', '全身性強皮症', 'SSc']], ['皮膚筋炎', 'intractable', ['皮膚筋炎', '多発性筋炎', 'PM', 'DM']],
      ['潰瘍性大腸炎', 'intractable', ['潰瘍性大腸炎', 'UC']], ['クローン病', 'intractable', ['クローン病', 'CD']], ['原発性胆汁性胆管炎', 'intractable', ['原発性胆汁性胆管炎', 'PBC', '原発性胆汁性肝硬変']],
      ['特発性肺線維症', 'intractable', ['特発性肺線維症', 'IPF']],
    ].map(([disease_name, guidance_type, keywords], i) => ({ id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), disease_code: null, disease_name, guidance_type, keywords }));
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const SPECIFIC_DISEASES = SD_SEED.slice().sort((a, b) => cmp(a.guidance_type, b.guidance_type) || cmp(a.disease_name, b.disease_name));   // ORDER BY guidance_type, disease_name

    // ---- 年齢・時間区分 ----
    function calcAge(birth, target) {
      const [by, bm, bd] = ymd(birth), [ty, tm, td] = ymd(target);
      let age = ty - by; if (tm < bm || (tm === bm && td < bd)) age -= 1; return age;
    }
    const isInfant = (birth, visit) => calcAge(birth, visit) < 6;
    const isUnderAge = (birth, visit, lim) => calcAge(birth, visit) < lim;
    function isJapaneseHoliday(d) {
      const [, m, day] = ymd(d), wd = weekday(d);
      const fixed = ['1-1', '2-11', '2-23', '4-29', '5-3', '5-4', '5-5', '8-11', '11-3', '11-23'];
      if (fixed.includes(m + '-' + day)) return true;
      if (m === 1 && wd === 0 && day >= 8 && day <= 14) return true;       // 成人の日
      if (m === 7 && wd === 0 && day >= 15 && day <= 21) return true;      // 海の日
      if (m === 9 && wd === 0 && day >= 15 && day <= 21) return true;      // 敬老の日
      if (m === 10 && wd === 0 && day >= 8 && day <= 14) return true;      // スポーツの日
      if (m === 3 && day >= 19 && day <= 22) return true;                  // 春分の日（簡易）
      if (m === 9 && day >= 22 && day <= 24) return true;                  // 秋分の日（簡易）
      return false;
    }
    function timeCategory(dt, settings) {
      const st = settings || {};
      const normalStart = secOfText(st.normal_start != null ? st.normal_start : '08:00'), normalEnd = secOfText(st.normal_end != null ? st.normal_end : '18:00');
      const nightStart = secOfText(st.night_start != null ? st.night_start : '22:00'), nightEnd = secOfText(st.night_end != null ? st.night_end : '06:00');
      const t = secOf(dt);
      if (weekday(dt.date) === 6) return 'holiday';
      const hol = st.holidays != null ? st.holidays : [];
      if (Array.isArray(hol) ? hol.includes(dt.date) : String(hol).includes(dt.date)) return 'holiday';
      if (isJapaneseHoliday(dt.date)) return 'holiday';
      if (t >= nightStart || t < nightEnd) return 'night';
      if (normalStart <= t && t < normalEnd) return 'normal';
      return 'overtime';
    }

    // ---- 過去のカルテ（deps.records: [{ id, visit_date, deleted, actions:[{code,name}] }]）----
    //   基準版の medical_records（削除印つき）・record_actions に当たる
    function sameDayReason(D, date, recordId, receptionId) {
      if (D.recordsError) return '判定エラー（同日受診チェック）';
      const hit = (D.records || []).filter((r) => r.visit_date === date && !r.deleted && (!recordId || r.id !== recordId) && (!receptionId || r.id === receptionId));
      return hit.length ? '同一診療日に既存カルテあり（初再診料は自動追加しない）' : null;
    }
    // 初診/再診（同一傷病 → 前回来院日）
    function determineVisitType(D, date, diagnoses, recordId, receptionId) {
      const same = sameDayReason(D, date, recordId, receptionId); if (same) return ['revisit', same];
      if (diagnoses && diagnoses.length) {
        const codes = diagnoses.map((d) => d.diagnosis_code || d.disease_code).filter(Boolean);
        const names = diagnoses.map((d) => d.diagnosis_name || d.disease_name || d.name).filter(Boolean);
        if (codes.length || names.length) {
          if (D.diagnosesError) return ['revisit', '判定エラー（同一傷病チェック）'];
          const recDate = new Map((D.records || []).filter((r) => !r.deleted).map((r) => [r.id, r.visit_date]));
          const groups = new Map();
          (D.diagnoses || []).forEach((d) => {
            const sd = isoDate(d.start_date), ed = isoDate(d.end_date);
            if (d.is_active === false || !sd || !(sd < date) || (ed && ed < date)) return;
            if (!((codes.length && codes.includes(d.diagnosis_code)) || (names.length && (names.includes(d.diagnosis_name) || names.includes(d.full_name))))) return;
            const key = d.diagnosis_name + '\u0000' + sd; const g = groups.get(key) || { name: d.diagnosis_name, start: sd, max: null };
            const vd = d.record_id ? recDate.get(d.record_id) : null; if (vd && (!g.max || vd > g.max)) g.max = vd;
            groups.set(key, g);
          });
          const rows = [...groups.values()].map((g) => ({ name: g.name, last: g.max || g.start })).sort((a, b) => (a.last === b.last ? 0 : !a.last ? 1 : !b.last ? -1 : a.last > b.last ? -1 : 1));
          if (rows.length) return ['revisit', `同一傷病継続（${rows[0].name || '同一傷病'}、前回来院日/開始日: ${rows[0].last || '不明'}）`];
        }
      }
      if (D.recordsError) return ['revisit', '判定エラー（初再診判定）'];
      const prev = (D.records || []).filter((r) => r.visit_date < date && !r.deleted).map((r) => r.visit_date).sort().pop();
      return prev ? ['revisit', `前回来院日あり（${prev}）`] : ['initial', '前回来院日なし'];
    }
    // その月に同じ行為が何回あるか（基準版 record_actions の件数）
    function monthCount(D, date, code, inclusive) {
      const ms = addDays0(date);
      return (D.records || []).filter((r) => r.visit_date >= ms && (inclusive ? r.visit_date <= date : r.visit_date < date))
        .reduce((n, r) => n + (r.actions || []).filter((a) => a.code === code && a.active !== false).length, 0);
    }
    const checkMonthlyLimit = (D, date, code, limit) => monthCount(D, date, code, true) < (limit || 1);

    function calcVisitFee(visitType, tc, infant, is200) {
      const a = [];
      if (visitType === 'initial') {
        a.push(SA(C_.INITIAL_VISIT, '初診料', 291, '初診', '初再診'));
        if (tc === 'overtime') a.push(SA(C_.OVERTIME_ADD_INITIAL, '時間外加算（初診）', 85, '時間外', '初再診'));
        else if (tc === 'holiday') a.push(SA(C_.HOLIDAY_ADD_INITIAL, '休日加算（初診）', 250, '休日', '初再診'));
        else if (tc === 'night') a.push(SA(C_.NIGHT_ADD_INITIAL, '深夜加算（初診）', 480, '深夜', '初再診'));
        if (infant) a.push(SA(C_.INFANT_ADD_INITIAL, '乳幼児加算（初診）', 75, '6歳未満', '初再診'));
      } else {
        if (is200) a.push(SA(C_.OUTPATIENT_CLINIC, '外来診療料', 77, '200床以上病院の再診', '初再診'));
        else a.push(SA(C_.REVISIT, '再診料', 76, '再診', '初再診'));
        if (tc === 'overtime') a.push(SA(C_.OVERTIME_ADD_REVISIT, '時間外加算（再診）', 65, '時間外', '初再診'));
        else if (tc === 'holiday') a.push(SA(C_.HOLIDAY_ADD_REVISIT, '休日加算（再診）', 190, '休日', '初再診'));
        else if (tc === 'night') a.push(SA(C_.NIGHT_ADD_REVISIT, '深夜加算（再診）', 420, '深夜', '初再診'));
        if (infant) a.push(SA(C_.INFANT_ADD_REVISIT, '乳幼児加算（再診）', 38, '6歳未満', '初再診'));
      }
      return a;
    }
    function outpatientManagement(D, visitType, actions, date) {
      if (visitType === 'initial') return null;
      for (const a of actions) { if (PROCEDURE_PREFIXES.includes(s(a.code).slice(0, 2))) return null; }
      if (monthCount(D, date, C_.OUTPATIENT_MANAGEMENT, false) >= 2) return null;   // 月2回まで
      return SA(C_.OUTPATIENT_MANAGEMENT, '外来管理加算', 52, '処置・手術・検査なし', '初再診', false);
    }
    function normalizeRxType(p) {
      const raw = p.dispensing_type || p.prescription_type || '院外';
      const v = String(raw).toLowerCase();
      return (raw === '院内' || ['internal', 'inhouse', 'in-house'].includes(v)) ? '院内' : '院外';
    }
    function normalizeDrugType(p) {
      const raw = p.drug_type; if (['内服', '外用', '頓服', '注射'].includes(raw)) return raw;
      const freq = s(p.frequency), unit = s(p.unit || p.dosage_unit), name = s(p.drug_name);
      if (freq.startsWith('[注]') || ['注', '点滴', '静注', '筋注', '皮下注', '注射'].some((t) => name.includes(t))) return '注射';
      if (freq.startsWith('[外]') || ['枚', 'g', 'mL', '個'].includes(unit)) return '外用';
      if (freq.startsWith('[頓]') || freq.includes('頓服')) return '頓服';
      return '内服';
    }
    const PRESENT_ALIASES = { [C_.PRESCRIPTION_FEE]: ['処方箋料', '処方箋料（その他）'], [C_.DISPENSING_FEE]: ['処方料', '処方料（その他）'], [C_.DISPENSING_ORAL]: ['調剤料（内服薬）', '調剤料'],
      [C_.DISPENSING_EXTERNAL]: ['調剤料（外用薬）', '調剤料'], [C_.INFANT_ADD_PRESC]: ['乳幼児加算（処方箋料）'], [C_.INFANT_ADD_DISP]: ['乳幼児加算（処方料）'] };
    function isPresent(code, name, codes, names) {
      const cand = new Set(PRESENT_ALIASES[code] || []); if (name) cand.add(name);
      return codes.has(code) || [...cand].some((n) => names.has(n));
    }
    const hasKeyword = (text, kws) => kws.some((k) => text.includes(k));
    const matchedKeyword = (text, kws) => kws.find((k) => text.includes(k)) || '';
    function calcPrescriptionFee(prescriptions, infantRx, diagnoses, codes, names) {
      const actions = [], warnings = [], info = [];
      if (!prescriptions.length) return [actions, warnings, info];
      const types = prescriptions.map(normalizeRxType), dtypes = prescriptions.map(normalizeDrugType);
      const typeSet = new Set(types), dset = new Set(dtypes);
      const internalCount = dtypes.filter((x) => x === '内服').length;
      const maxDays = Math.max(0, ...prescriptions.map((p) => toInt(p.days)));
      if (!['内服', '外用', '頓服'].some((x) => dset.has(x))) { warnings.push('注射のみの処方は投薬（F000/F100/F400）ではなく注射料側で確認してください'); return [actions, warnings, info]; }
      if (typeSet.has('院内') && typeSet.has('院外')) {
        warnings.push('同一診療日の院内投薬と院外処方の混在は原則不可のため、処方料・調剤料は自動追加しません');
        if (!isPresent(C_.PRESCRIPTION_FEE, '処方箋料（その他）', codes, names)) actions.push(SA(C_.PRESCRIPTION_FEE, '処方箋料（その他）', 60, '院内/院外混在: 緊急やむを得ない場合のみ確認', '処方', false));
        return [actions, warnings, info];
      }
      const seven = internalCount >= 7 && maxDays > 14;
      const dxNames = diagnoses.map((d) => d.diagnosis_name || d.disease_name || d.name || '').join(' ');
      if (hasKeyword(dxNames, SPECIFIC_DISEASE_KEYWORDS) && maxDays >= 28) warnings.push('特定疾患の28日以上処方は特定疾患処方管理加算（56点）の可能性があります。施設要件・主病・月1回制限を確認してください');
      if (typeSet.size === 1 && typeSet.has('院外')) {
        if (seven) { warnings.push('7種類以上の内服薬かつ14日超の可能性があるため、処方箋料は60点ではなく32点等の確認が必要です'); return [actions, warnings, info]; }
        if (!isPresent(C_.PRESCRIPTION_FEE, '処方箋料（その他）', codes, names)) actions.push(SA(C_.PRESCRIPTION_FEE, '処方箋料（その他）', 60, '院外処方', '処方'));
        else info.push('処方箋料は入力済みのため候補から除外しました');
        if (infantRx && !isPresent(C_.INFANT_ADD_PRESC, '乳幼児加算（処方箋料）', codes, names)) actions.push(SA(C_.INFANT_ADD_PRESC, '乳幼児加算（処方箋料）', 3, '3歳未満', '処方'));
      } else {
        if (seven) { warnings.push('7種類以上の内服薬かつ14日超の可能性があるため、処方料は42点ではなく29点等の確認が必要です'); return [actions, warnings, info]; }
        if (!isPresent(C_.DISPENSING_FEE, '処方料（その他）', codes, names)) actions.push(SA(C_.DISPENSING_FEE, '処方料（その他）', 42, '院内処方', '処方'));
        else info.push('処方料は入力済みのため候補から除外しました');
        if ((dset.has('内服') || dset.has('頓服')) && !isPresent(C_.DISPENSING_ORAL, '調剤料（内服薬）', codes, names)) actions.push(SA(C_.DISPENSING_ORAL, '調剤料（内服薬）', 11, '内服薬', '処方'));
        if (dset.has('外用') && !isPresent(C_.DISPENSING_EXTERNAL, '調剤料（外用薬）', codes, names)) actions.push(SA(C_.DISPENSING_EXTERNAL, '調剤料（外用薬）', 8, '外用薬', '処方'));
        if (infantRx && !isPresent(C_.INFANT_ADD_DISP, '乳幼児加算（処方料）', codes, names)) actions.push(SA(C_.INFANT_ADD_DISP, '乳幼児加算（処方料）', 3, '3歳未満', '処方'));
      }
      return [actions, warnings, info];
    }
    // 指導料（特定疾患マスター照合 → 内蔵キーワード）
    const GUIDANCE_ALIAS = { specific: 'specific_disease', specific_disease: 'specific_disease', dermatology: 'dermatology', epilepsy: 'epilepsy', intractable: 'intractable', intractable_disease: 'intractable' };
    const guidanceEnabled = (type, enabled) => (enabled == null ? true : (enabled[type] === undefined ? true : truthy(enabled[type])));
    function effectiveGuidanceDiagnosis(d) {
      if (d.is_suspected === true) return false; if (d.end_date) return false;
      if (['治癒', '中止', '転医', '移行', '死亡', 'cured', 'discontinued', 'transferred', 'died'].includes(s(d.outcome))) return false;
      return !!(d.diagnosis_code || d.disease_code || d.diagnosis_name || d.disease_name || d.full_name || d.name);
    }
    function matchesMaster(code, text, mCode, mName, kws) {
      if (code && mCode && String(code) === String(mCode)) return true;
      if (mName && text.includes(mName)) return true;
      return (kws || []).some((k) => k && text.includes(k));
    }
    function guidanceByMaster(D, diagnoses, date, enabled) {
      const out = []; if (!diagnoses.length) return out;
      const added = new Set();
      for (const d of diagnoses) {
        const dc = d.diagnosis_code || d.disease_code, dn = d.diagnosis_name || d.disease_name || d.full_name || d.name || '';
        const text = [dn, d.full_name || ''].filter(Boolean).map(String).join(' ');
        if (!dc && !text) continue;
        for (const row of (D.specificDiseases || SPECIFIC_DISEASES)) {
          const gt = GUIDANCE_ALIAS[row.guidance_type || '']; if (!gt || added.has(gt)) continue;
          if (!guidanceEnabled(gt, enabled)) continue;
          if (!matchesMaster(dc, text, row.disease_code, row.disease_name || '', row.keywords || [])) continue;
          const [code, name, score] = GUIDANCE_ACTIONS[gt];
          if (!checkMonthlyLimit(D, date, code)) continue;
          out.push(SA(code, name, score, `${dn || dc} -> ${row.disease_name || ''}`, '指導料', false)); added.add(gt); break;
        }
      }
      return out;
    }
    function calcGuidanceFee(D, diagnoses, date, visitType, enabled) {
      const a = []; if (visitType === 'initial') return a;
      const eff = diagnoses.filter(effectiveGuidanceDiagnosis); if (!eff.length) return a;
      const all = eff.map((d) => d.diagnosis_name || d.disease_name || d.name || '').join(' ');
      a.push(...guidanceByMaster(D, eff, date, enabled));
      const added = new Set(a.map((x) => x.code));
      if (!added.has(C_.SPECIFIC_DISEASE) && guidanceEnabled('specific_disease', enabled) && hasKeyword(all, SPECIFIC_DISEASE_KEYWORDS) && checkMonthlyLimit(D, date, C_.SPECIFIC_DISEASE))
        a.push(SA(C_.SPECIFIC_DISEASE, '特定疾患療養管理料（診療所）', 225, `特定疾患（${matchedKeyword(all, SPECIFIC_DISEASE_KEYWORDS)}）`, '指導料', false));
      if (!added.has(C_.DERMATOLOGY) && guidanceEnabled('dermatology', enabled) && hasKeyword(all, DERMATOLOGY_DISEASE_KEYWORDS) && checkMonthlyLimit(D, date, C_.DERMATOLOGY))
        a.push(SA(C_.DERMATOLOGY, '皮膚科特定疾患指導管理料(1)', 250, `皮膚科特定疾患（${matchedKeyword(all, DERMATOLOGY_DISEASE_KEYWORDS)}）`, '指導料', false));
      if (!added.has(C_.EPILEPSY) && guidanceEnabled('epilepsy', enabled) && hasKeyword(all, EPILEPSY_KEYWORDS) && checkMonthlyLimit(D, date, C_.EPILEPSY))
        a.push(SA(C_.EPILEPSY, 'てんかん指導料', 250, 'てんかん', '指導料', false));
      if (!added.has(C_.INTRACTABLE_DISEASE) && guidanceEnabled('intractable', enabled) && hasKeyword(all, INTRACTABLE_DISEASE_KEYWORDS) && checkMonthlyLimit(D, date, C_.INTRACTABLE_DISEASE))
        a.push(SA(C_.INTRACTABLE_DISEASE, '難病外来指導管理料1', 270, `指定難病（${matchedKeyword(all, INTRACTABLE_DISEASE_KEYWORDS)}）`, '指導料', false));
      return a;
    }
    // 基準版 AutoCalculator.auto_calculate
    function autoCalculate(D, p) {
      const r = { visit_type: 'revisit', visit_reason: '', time_category: 'normal', is_infant: false, suggested_actions: [], warnings: [], info: [] };
      const st = p.settings || {}, date = p.dt.date;
      const same = sameDayReason(D, date, p.record_id, p.reception_id);
      if (same) { r.visit_type = 'revisit'; r.visit_reason = same; }
      else if (p.first_visit != null) { r.visit_type = p.first_visit ? 'initial' : 'revisit'; r.visit_reason = '受付の初診フラグ'; }
      else [r.visit_type, r.visit_reason] = determineVisitType(D, date, p.diagnoses, p.record_id, p.reception_id);
      r.time_category = timeCategory(p.dt, st);
      r.is_infant = isInfant(p.birth_date, date);
      const codes = new Set(p.actions.map((a) => a.code || a.action_code || null)), names = new Set(p.actions.map((a) => a.name || a.action_name || null));
      const feeCodes = [C_.INITIAL_VISIT, C_.REVISIT, C_.OUTPATIENT_CLINIC], feeNames = ['初診料', '再診料', '外来診療料'];
      const hasFee = feeCodes.some((c) => codes.has(c)) || [...names].some((n) => feeNames.includes(n));
      const uncertain = r.visit_reason.startsWith('判定エラー'), blocked = r.visit_reason.startsWith('同一診療日に');
      if (blocked) r.warnings.push('同一診療日に既存カルテがあるため、初診料/再診料は自動候補から除外しました');
      else if (uncertain) r.warnings.push('初再診判定に失敗したため、初再診料は自動候補から除外しました');
      else if (truthy(st.visit_fee_enabled !== undefined ? st.visit_fee_enabled : true)) {
        const tc = truthy(st.time_addition_enabled !== undefined ? st.time_addition_enabled : true) ? r.time_category : 'normal';
        let fees = calcVisitFee(r.visit_type, tc, r.is_infant, truthy(st.is_hospital_200plus));
        if (hasFee) { r.info.push('初再診料は入力済みのため候補から除外しました'); fees = fees.filter((f) => !feeCodes.includes(f.code) && !feeNames.includes(f.name)); }
        r.suggested_actions.push(...fees.filter((f) => !isPresent(f.code, f.name, codes, names)));
      } else r.info.push('初再診料の自動算定は施設設定でOFFです');
      const om = outpatientManagement(D, r.visit_type, p.actions, date); if (om) r.suggested_actions.push(om);
      if (p.prescriptions.length) {
        const [a, w, i] = calcPrescriptionFee(p.prescriptions, isUnderAge(p.birth_date, date, 3), p.diagnoses, codes, names);
        r.suggested_actions.push(...a); r.warnings.push(...w); r.info.push(...i);
      }
      if (truthy(st.guidance_fee_enabled !== undefined ? st.guidance_fee_enabled : true)) {
        const en = {}; ['specific_disease', 'dermatology', 'epilepsy', 'intractable'].forEach((k) => { en[k] = st[k + '_enabled'] !== undefined ? st[k + '_enabled'] : true; });
        r.suggested_actions.push(...calcGuidanceFee(D, p.diagnoses, date, r.visit_type, en).filter((f) => !isPresent(f.code, f.name, codes, names)));
      }
      r.info.push(r.visit_type === 'initial' ? `初診として判定されました（${r.visit_reason}）` : `再診として判定されました（${r.visit_reason}）`);
      if (r.time_category !== 'normal') r.info.push(`${{ overtime: '時間外', holiday: '休日', night: '深夜' }[r.time_category]}として判定されました`);
      if (r.is_infant) r.info.push('乳幼児加算の対象です（6歳未満）');
      return r;
    }

    // ======================================================================
    // 施設の「自動算定する診療行為」の条件評価（routers/auto_calculation.py）
    // ======================================================================
    const lookupLite = (v) => s(v).replace(/（/g, '(').replace(/）/g, ')').replace(/　/g, ' ').replace(/ /g, '').trim().toLowerCase();
    const ITEM_KEYS = ['code', 'action_code', 'billing_code', 'receipt_code', 'category', 'category_code', 'category_name', 'name', 'action_name', 'drug_name', 'generic_name',
      'generic_prescription_code', 'generic_prescription_name', 'generic_prescription_addition_category', 'frequency', 'route', 'note', 'comment', 'instructions'];
    const itemText = (item) => ITEM_KEYS.map((k) => s(item[k])).join(' ');
    const firstOf = (o, keys) => { for (const k of keys) { if (o[k]) return String(o[k]); } return ''; };
    const primaryCode = (a) => firstOf(a, ['code', 'action_code', 'billing_code', 'receipt_code', 'recept_code']);
    const primaryName = (a) => firstOf(a, ['name', 'action_name', 'billing_name', 'short_name', 'display_name']);
    function hasAutoCalcAction(items, code, name) {
      code = s(code).trim(); const nn = lookupLite(name);
      for (const it of items) {
        const ic = primaryCode(it); if (code && ic && code === ic) return true;
        const iname = lookupLite(primaryName(it)); if (!nn || !iname) continue;
        if (nn === iname || iname.includes(nn) || nn.includes(iname)) return true;
      }
      return false;
    }
    function pyTruthyValue(v) {
      if (typeof v === 'boolean') return v; if (v === null || v === undefined) return false; if (typeof v === 'number') return v !== 0;
      return ['1', 'true', 'on', 'yes', 'y', 'する', '有効', 'あり', '可'].includes(String(v).trim().toLowerCase());
    }
    function insertable(a) {
      const code = s(a.action_code).trim(); if (!code && !a.action_name) return false;
      if (a.is_auto_add === false) return false; if (code.startsWith('DMSTD')) return false; return true;
    }
    function periodActive(cond, date) {
      const st = cond.period_start, en = cond.period_end;
      const sd = st ? isoDate(st) : null, ed = en ? isoDate(en) : null;
      if ((st && !sd) || (en && !ed)) return true;   // 日付として読めないときは基準版と同じく対象にする
      if (sd && date < sd) return false; if (ed && date > ed) return false; return true;
    }
    const isTemporary = (p) => pyTruthyValue(p.is_temporary) || pyTruthyValue(p.temporary) || itemText(p).includes('臨時');
    const isRefill = (p) => pyTruthyValue(p.is_refill) || pyTruthyValue(p.refill_allowed) || toInt(p.refill_count) > 0 || itemText(p).includes('リフィル');
    function isGeneric(p) {
      if (p.generic_prescription_name || p.generic_prescription_code) return true;
      if (pyTruthyValue(p.generic_name_prescription) || pyTruthyValue(p.general_name_prescription) || pyTruthyValue(p.print_generic_name) || pyTruthyValue(p.is_generic)) return true;
      if (p.generic_name) return true; const t = itemText(p); return t.includes('一般名') || t.includes('【般】');
    }
    const PSY_KW = ['向精神', '抗不安', '睡眠', '抗うつ', 'ベンゾ', 'ゾルピデム', 'エチゾラム', 'デエビゴ', 'ベルソムラ', 'マイスリー', 'レンドルミン', 'サイレース', 'デパス', 'リーゼ', 'ワイパックス', 'レキソタン', 'ルネスタ'];
    function isPsychotropic(p) { const c = s(p.therapeutic_category || p.therapeutic_category_code); if (c.startsWith('112') || c.startsWith('117')) return true; const t = itemText(p); return PSY_KW.some((k) => t.includes(k)); }
    function isNarcoticEtc(p) {
      if (isPsychotropic(p)) return true; const c = s(p.therapeutic_category || p.therapeutic_category_code); if (c.startsWith('811') || c.startsWith('821')) return true;
      const t = itemText(p); return ['麻薬', '覚せい剤', '覚醒剤', 'モルヒネ', 'フェンタニル', 'オキシコドン', 'コデイン', 'メチルフェニデート'].some((k) => t.includes(k));
    }
    function effectiveDiagnosis(d, date) {
      if (d.is_suspected === true) return false;
      if (['治癒', '中止', '転医', '移行', '死亡', 'cured', 'discontinued', 'transferred', 'died'].includes(s(d.outcome))) return false;
      const ed = isoDate(d.end_date); if (ed && ed < date) return false;
      return !!(d.diagnosis_code || d.diagnosis_name || d.disease_code || d.disease_name || d.name);
    }
    const medText = (v) => nfkc(s(v)).replace(/･/g, '・').replace(/〜/g, '~').replace(/～/g, '~').replace(/[\s　・･「」『』"'（）()[\]［］【】,，、。%％]+/g, '').toLowerCase();
    const hasNormKw = (text, kws) => kws.some((k) => text.includes(medText(k)));
    function actionEntry(a) {
      const code = primaryCode(a), name = primaryName(a);
      const cat = ['category', 'category_code', 'category_name', 'item_type'].map((k) => s(a[k])).join(' ');
      const full = itemText(a) + ' ' + cat;
      return { data: a, code, name, text: full, normalized_text: medText(full), category_text: cat, normalized_category: medText(cat) };
    }
    const billable = (e) => !(e.data.do_not_bill || e.data.is_self_pay || e.data.item_type === 'self_pay');
    function examOrImage(e) {
      if (['16', '17', '70'].some((p) => e.code.startsWith(p))) return true;
      if (hasNormKw(e.normalized_category, ['検査', '画像', '病理'])) return true;
      return hasNormKw(e.normalized_text, ['検査', '採取', '測定', '判定', '培養', '抗原', '抗体', 'PCR', '心電図', '超音波', 'CT', 'MRI', 'エックス線', 'X線', 'レントゲン']);
    }
    const judgeTarget = (e) => billable(e) && !hasNormKw(e.normalized_text, ['判断料', 'B-V', '血液採取', '検査逓減', '減算', '加算']) && examOrImage(e);
    const EXAM_KW = {
      urine_feces_exam_judgment_fee: ['尿', '尿中', '尿沈渣', '検尿', '糞便', '便', '便潜血'],
      hematology_exam_judgment_fee: ['血液学', '血算', '末梢血', '赤血球', '白血球', '血小板', 'ヘモグロビン', 'Hb', 'CBC'],
      biochemistry_1_exam_judgment_fee: ['生化学', '蛋白', 'アルブミン', 'ビリルビン', 'AST', 'ALT', 'γ-GT', 'ALP', 'LD', 'CK', 'クレアチニン', '尿素窒素', '尿酸', 'Na', 'K', 'Cl', '血糖', 'HbA1c', 'コレステロール', 'HDL', 'LDL', '中性脂肪', 'CRP'],
      biochemistry_2_exam_judgment_fee: ['ホルモン', 'TSH', 'FT3', 'FT4', 'インスリン', 'PTH'],
      immunology_exam_judgment_fee: ['免疫', '血清', 'IgE', 'IgG', 'IgA', 'IgM', 'アレルゲン', '抗原', '抗体', 'HBs', 'HCV', '梅毒'],
      microbiology_exam_judgment_fee: ['微生物', '細菌', '培養', '同定', '感受性'],
      respiratory_function_exam_judgment_fee: ['呼吸機能', '肺機能', 'スパイロ', 'フローボリューム'],
      eeg_exam_judgment_fee_2: ['脳波', 'EEG'],
      nerve_muscle_exam_judgment_fee: ['神経', '筋電図', '誘発筋電図', '末梢神経'],
      radioisotope_exam_judgment_fee: ['ラジオアイソトープ', 'RI', 'シンチ', 'PET'],
      genetic_chromosome_exam_judgment_fee: ['遺伝子', '染色体'],
      pathology_judgment_fee: ['病理', '細胞診', '組織診'],
    };
    const examKeys = (e) => judgeTarget(e) ? Object.keys(EXAM_KW).filter((k) => hasNormKw(e.normalized_text, EXAM_KW[k])) : [];
    const bloodTest = (e) => judgeTarget(e) && hasNormKw(e.normalized_text, ['血液', '血算', '末梢血', '赤血球', '白血球', '血小板', 'ヘモグロビン', 'Hb', '生化学', '血糖', 'HbA1c', 'CRP', 'コレステロール', 'HDL', 'LDL', '中性脂肪', '抗原', '抗体', 'IgE']);
    const physioExam = (e) => judgeTarget(e) && hasNormKw(e.normalized_text, ['心電図', '超音波', '呼吸機能', '肺機能', '脳波', '筋電図', '神経', '聴力', '視野', '眼底', '内視鏡']);
    const ctMri = (e) => billable(e) && !hasNormKw(e.normalized_text, ['コンピュータ断層診断', '電子画像管理加算', '減算']) && hasNormKw(e.normalized_text, ['CT', 'MRI', 'コンピュータ断層撮影']);
    function repeated(entries) { const seen = new Set(); for (const e of entries) { const k = e.code || e.normalized_text; if (!k) continue; if (seen.has(k)) return true; seen.add(k); } return false; }
    function prevMonthlyCatalogAction(D, date, recordId, entries, mode) {
      if (!D.patientId || !entries.length) return false;
      const codes = entries.map((e) => e.code).filter(Boolean), names = entries.map((e) => e.name).filter(Boolean);
      if (mode !== 'ct_mri' && !codes.length && !names.length) return false;
      const ms = addDays0(date);
      return (D.records || []).some((r) => r.visit_date >= ms && r.visit_date < date && (!recordId || r.id !== recordId) && (r.actions || []).some((a) => {
        if (a.active === false || a.status === 'cancelled') return false;
        if (mode === 'ct_mri') { const n = s(a.name).toUpperCase(); return n.includes('CT') || n.includes('MRI') || n.includes('コンピュータ断層撮影'); }
        return (codes.length && codes.includes(a.code)) || (names.length && names.includes(a.name));
      }));
    }
    const hasActionKeyword = (actions, kws) => actions.some((a) => { const t = itemText(a); return kws.some((k) => t.includes(k)); });
    const hasOmBlocker = (actions) => actions.some((a) => ['14', '15', '16', '17'].includes(primaryCode(a).slice(0, 2)) || ['処置', '手術', '検査', '画像', '注射'].some((k) => itemText(a).includes(k)));
    function conditionContext(p) {
      const age = calcAge(p.birth_date, p.dt.date);
      const entries = p.prescriptions.map((x) => ({ data: x, dispensing_type: normalizeRxType(x), drug_type: normalizeDrugType(x), days: toInt(x.days), is_temporary: isTemporary(x) }));
      const distinct = (pred) => { const seen = new Set(); entries.forEach((e) => { if (!pred(e)) return; const d = e.data; const k = d.drug_code || d.yj_code || d.hot_code || d.receipt_code || d.code || d.drug_name || d.name; if (k) seen.add(String(k)); }); return seen.size; };
      const claim = (e) => ['内服', '外用', '頓服'].includes(e.drug_type);
      const internal = entries.filter((e) => e.dispensing_type === '院内' && claim(e)), external = entries.filter((e) => e.dispensing_type === '院外' && claim(e));
      const active = p.diagnoses.filter((d) => effectiveDiagnosis(d, p.dt.date));
      const dxText = active.map(itemText).join(' ');   // 基準版どおり itemText（傷病名の項目は拾わない）
      const hasSpecific = hasKeyword(dxText, SPECIFIC_DISEASE_KEYWORDS), hasMain = active.some((d) => d.is_main);
      const aEntries = p.actions.map(actionEntry); const ek = new Set(); aEntries.forEach((e) => examKeys(e).forEach((k) => ek.add(k)));
      const physio = aEntries.filter(physioExam), ct = aEntries.filter(ctMri);
      return {
        age, is_infant: p.is_infant, is_under_3: age < 3, is_under_6: age < 6, is_under_20: age < 20, visit_type: p.visit_type, time_category: p.time_category,
        actions: p.actions, action_entries: aEntries, exam_judgment_condition_keys: ek, has_blood_collection_test: aEntries.some(bloodTest),
        has_physiological_exam: physio.length > 0, has_current_repeated_physiological_exam: repeated(physio), physiological_exam_entries: physio,
        has_ct_mri: ct.length > 0, has_current_repeated_ct_mri: ct.length >= 2, ct_mri_entries: ct, prescriptions: p.prescriptions, prescription_entries: entries,
        has_internal_prescription: internal.length > 0, has_external_prescription: external.length > 0, has_mixed_internal_external: internal.length > 0 && external.length > 0,
        has_internal_oral_prn: internal.some((e) => e.drug_type === '内服' || e.drug_type === '頓服'), has_internal_external_drug: internal.some((e) => e.drug_type === '外用'),
        internal_oral_count: distinct((e) => e.dispensing_type === '院内' && e.drug_type === '内服' && !e.is_temporary),
        internal_oral_prn_count: distinct((e) => e.dispensing_type === '院内' && (e.drug_type === '内服' || e.drug_type === '頓服') && !e.is_temporary),
        external_oral_count: distinct((e) => e.dispensing_type === '院外' && e.drug_type === '内服' && !e.is_temporary),
        internal_max_days: Math.max(0, ...internal.filter((e) => !e.is_temporary).map((e) => e.days)),
        external_max_days: Math.max(0, ...external.filter((e) => !e.is_temporary).map((e) => e.days)),
        has_refill: p.prescriptions.some(isRefill), has_generic_external: entries.some((e) => e.dispensing_type === '院外' && isGeneric(e.data)),
        internal_psychotropic_count: distinct((e) => e.dispensing_type === '院内' && isPsychotropic(e.data)),
        external_psychotropic_count: distinct((e) => e.dispensing_type === '院外' && isPsychotropic(e.data)),
        has_internal_narcotic_etc: entries.some((e) => e.dispensing_type === '院内' && isNarcoticEtc(e.data)),
        specific_disease_ready: hasSpecific && (active.length <= 1 || hasMain),
      };
    }
    const INITIAL_FACILITY = { initial_clinic_function_enhancement: '初診・機能強化加算の施設基準あり', initial_outpatient_infection_control: '初診・外来感染対策向上加算の施設基準あり',
      initial_fever_patient_response: '初診・発熱患者等対応加算の条件あり', initial_infection_collaboration: '初診・連携強化加算の施設基準あり', initial_electronic_info_2: '初診・電子的診療情報連携体制整備加算2の条件あり',
      initial_price_support_1: '初診・外来在宅物価対応料1の期間内', initial_baseup_1_wage: '初診・外来在宅ベースアップ評価料(1)1の期間内' };
    function conditionReason(key, c) {
      key = s(key);
      if (INITIAL_FACILITY[key]) return c.visit_type === 'initial' ? INITIAL_FACILITY[key] : null;
      if (key === 'revisit_price_support_1') return c.visit_type === 'revisit' ? '再診・外来在宅物価対応料1の期間内' : null;
      if (key === 'infant_initial_visit') return c.is_under_6 && c.visit_type === 'initial' ? '6歳未満・初診' : null;
      if (key === 'infant_revisit') return c.is_under_6 && c.visit_type === 'revisit' ? '6歳未満・再診' : null;
      if (key === 'outpatient_management') return c.visit_type === 'revisit' && !hasOmBlocker(c.actions) ? '再診で外来管理加算を妨げる診療行為なし' : null;
      if (key === 'internal_prescription_fee_other') return c.has_internal_prescription && !c.has_mixed_internal_external && c.internal_psychotropic_count < 3 && c.internal_oral_count < 7 ? '院内処方あり' : null;
      if (key === 'internal_psychotropic_multi_prescription_fee') return c.internal_psychotropic_count >= 3 ? '院内の向精神薬等が3種類以上' : null;
      if (key === 'internal_dispensing_oral_decoction_prn') return c.has_internal_oral_prn ? '院内の内服薬・頓服薬あり' : null;
      if (key === 'internal_dispensing_external') return c.has_internal_external_drug ? '院内の外用薬あり' : null;
      if (key === 'infant_internal_prescription_fee_addition') return c.is_under_3 && c.has_internal_prescription ? '3歳未満・院内処方あり' : null;
      if (key === 'internal_prescription_fee_seven_or_more_oral') return c.internal_oral_count >= 7 ? '院内の内服薬が7種類以上' : null;
      if (key === 'internal_drug_fee_reduction_seven_or_more') return c.internal_oral_prn_count >= 7 ? '院内の内服薬・頓服薬が7種類以上' : null;
      if (key === 'specific_disease_internal_prescription_management') return c.specific_disease_ready && c.has_internal_prescription && c.internal_max_days >= 28 ? '特定疾患・院内28日以上処方' : null;
      if (key === 'narcotic_etc_internal_prescription_fee_addition' || key === 'narcotic_etc_internal_dispensing_fee_addition') return c.has_internal_narcotic_etc ? '院内処方に麻薬等あり' : null;
      if (key === 'infant_intravenous_drip_addition') return c.is_under_6 && (hasActionKeyword(c.actions, ['静脈内注射', '点滴注射', '点滴', '静注']) || c.prescription_entries.some((e) => e.drug_type === '注射')) ? '6歳未満・静脈内注射/点滴注射あり' : null;
      if (key === 'infant_child_procedure_addition') return c.is_under_6 && hasActionKeyword(c.actions, ['処置']) ? '年齢条件あり・処置あり' : null;
      if (key === 'infant_child_surgery_anesthesia_addition') return c.is_under_6 && hasActionKeyword(c.actions, ['手術', '麻酔']) ? '年齢条件あり・手術/麻酔あり' : null;
      if (EXAM_KW[key]) return c.exam_judgment_condition_keys.has(key) ? '判断料対象の検査あり' : null;
      if (key === 'blood_collection_bv') return c.has_blood_collection_test ? '血液採取を伴う検体検査あり' : null;
      if (key === 'infant_blood_collection_addition') return c.is_under_6 && c.has_blood_collection_test ? '6歳未満・血液採取あり' : null;
      if (key === 'newborn_infant_physiological_exam_addition') return c.is_under_6 && c.has_physiological_exam ? '6歳未満・生体検査あり' : null;
      if (key === 'physiological_exam_reduction') return c.has_monthly_repeated_physiological_exam ? '生体検査が同月2回目以降' : null;
      if (key === 'infant_child_imaging_addition') return c.is_under_6 && hasActionKeyword(c.actions, ['画像']) ? '年齢条件あり・画像診断あり' : null;
      if (key === 'nuclear_medicine_e101_2_to_e101_5') return hasActionKeyword(c.actions, ['核医学', 'E101-2', 'E101-3', 'E101-4', 'E101-5']) ? '核医学診断あり' : null;
      if (key === 'nuclear_medicine_other') return hasActionKeyword(c.actions, ['核医学', 'シンチ', 'PET']) ? '核医学診断あり' : null;
      if (key === 'computed_tomography_diagnosis') return c.has_ct_mri ? 'CT/MRI等の画像診断あり' : null;
      if (key === 'ct_mri_second_or_later_reduction') return c.has_monthly_repeated_ct_mri ? 'CT/MRI撮影が同月2回目以降' : null;
      if (key === 'external_prescription_fee_non_refill_other') return c.has_external_prescription && !c.has_mixed_internal_external && !c.has_refill && c.external_psychotropic_count < 3 && c.external_oral_count < 7 ? '院外処方あり' : null;
      if (key === 'external_prescription_fee_refill_other') return c.has_external_prescription && c.has_refill ? 'リフィル可の院外処方あり' : null;
      if (key === 'external_prescription_fee_non_refill_psychotropic_multi') return c.has_external_prescription && !c.has_refill && c.external_psychotropic_count >= 3 ? '院外の向精神薬等が3種類以上' : null;
      if (key === 'external_prescription_fee_refill_psychotropic_multi') return c.has_external_prescription && c.has_refill && c.external_psychotropic_count >= 3 ? 'リフィル可・院外の向精神薬等が3種類以上' : null;
      if (key === 'infant_external_prescription_addition') return c.is_under_3 && c.has_external_prescription ? '3歳未満・院外処方あり' : null;
      if (key === 'external_prescription_fee_non_refill_seven_or_more_oral') return c.has_external_prescription && !c.has_refill && c.external_oral_count >= 7 ? '院外の内服薬が7種類以上' : null;
      if (key === 'external_prescription_fee_refill_seven_or_more_oral') return c.has_external_prescription && c.has_refill && c.external_oral_count >= 7 ? 'リフィル可・院外の内服薬が7種類以上' : null;
      if (key === 'generic_prescription_addition') return c.has_generic_external ? '一般名処方を含む院外処方あり' : null;
      if (key === 'psychiatric_therapy_under_20_addition') return c.is_under_20 && hasActionKeyword(c.actions, ['通院精神療法', '在宅精神療法']) ? '20歳未満・通院/在宅精神療法あり' : null;
      if (key === 'specific_disease_external_prescription_management') return c.specific_disease_ready && c.has_external_prescription && c.external_max_days >= 28 ? '特定疾患・院外28日以上処方' : null;
      if (key === 'workers_comp_outpatient_management' || key === 'workers_comp_outpatient_management_replacement') return null;
      if (key === 'other_age_addition_infant_child') return c.is_under_6 && hasActionKeyword(c.actions, ['処置', '検査', '画像', '手術', '麻酔']) ? '乳幼児・幼児の年齢加算対象行為あり' : null;
      return null;
    }
    function evaluateCatalog(D, M, p, candidates) {
      const catalog = D.catalog || [];
      const c = conditionContext(p);
      c.has_monthly_repeated_physiological_exam = c.has_current_repeated_physiological_exam || prevMonthlyCatalogAction(D, p.dt.date, p.record_id, c.physiological_exam_entries, 'physiological');
      c.has_monthly_repeated_ct_mri = c.has_current_repeated_ct_mri || prevMonthlyCatalogAction(D, p.dt.date, p.record_id, c.ct_mri_entries, 'ct_mri');
      const out = [], info = [], existing = candidates.slice(), date = p.dt.date;
      for (const a of catalog) {
        if (a.is_active === false) continue;
        const cond = a.trigger_condition || {}; if (!periodActive(cond, date)) continue;
        const key = cond.condition_key;
        if ((key === 'initial_price_support_1' || key === 'revisit_price_support_1') && !(date >= '2026-06-01' && date < '2027-06-01')) continue;
        if (!key) continue;
        const reason = conditionReason(key, c); if (!reason) continue;
        let code = s(a.action_code).trim(), name = s(a.action_name).trim(), score = toInt(a.score), category = String(a.category || cond.group || '診察');
        const known = getKnown(code, name) || resolveExact(M, code, name);
        if (known) { code = known.action_code; name = known.name; score = toInt(known.score); category = String(known.category || category); }
        if (hasAutoCalcAction(existing, code, name)) continue;
        if (!insertable(a)) { if (code.startsWith('DMSTD')) info.push(`${name} は条件を満たしましたが、診療行為コード未確定のため自動追加しません`); continue; }
        const sg = { code, name, score, reason: reason || cond.condition_text || '施設管理の自動算定条件に一致', category, auto_add: a.is_auto_add === undefined ? true : !!a.is_auto_add };
        out.push(sg); existing.push({ code: sg.code, name: sg.name, score: sg.score, category: sg.category });
      }
      return [out, info];
    }

    // ======================================================================
    // 算定ルール（santei_rule_engine.py と migrations 028・029・045 の初期ルール）
    // ======================================================================
    const R = (rule_code, rule_name, rule_kind, trigger_condition, suggestion, message, default_checked, sort_order) => ({ rule_code, rule_name, rule_kind, trigger_condition, suggestion, message, default_checked, sort_order, effective_date: '2026-04-01', expiry_date: null });
    const RULES = [
      R('ADD_EXTERNAL_PRESCRIPTION_FEE', '院外処方時の処方箋料', 'suggest', { has_external_prescription: true, missing_all_codes: ['120002910'], missing_all_names: ['処方箋料'] },
        { code: '120002910', name: '処方箋料（リフィル以外・その他）', score: 60, category: '処方', reason: '院外処方があります', auto_add: true }, '院外処方があるため処方箋料を候補に追加します。', true, 100),
      R('ADD_OUTPATIENT_MANAGEMENT_SURCHARGE', '再診時の外来管理加算', 'suggest', { visit_type: 'revisit', present_any_codes: ['112007410', '112000110'], present_any_names: ['再診料'], missing_all_codes: ['112011010'], missing_all_names: ['外来管理加算'], requires_no_procedure_or_exam: true },
        { code: '112011010', name: '外来管理加算', score: 52, category: '診察', reason: '再診で処置・手術・検査がありません', auto_add: true }, '再診で処置・手術・検査がないため外来管理加算を候補に追加します。', true, 110),
      R('ADD_INITIAL_ELECTRONIC_INFO_2', '初診時の電子的診療情報連携体制整備加算2', 'suggest', { visit_type: 'initial', present_any_codes: ['111000110'], present_any_names: ['初診料'], missing_all_codes: ['111704170'], missing_all_names: ['電子的診療情報連携体制整備加算2(初診)'] },
        { code: '111704170', name: '電子的診療情報連携体制整備加算2(初診)', score: 9, category: '診察', reason: '初診に対する施設設定候補', auto_add: true }, '初診に対する電子的診療情報連携体制整備加算2を候補に追加します。', true, 120),
      R('ADD_INITIAL_PRICE_SUPPORT_1', '初診時の物価対応料1', 'suggest', { visit_type: 'initial', present_any_codes: ['111000110'], present_any_names: ['初診料'], missing_all_codes: ['180819910'], missing_all_names: ['物価対応料1(外来・在宅物価対応料)(初診時)イ'] },
        { code: '180819910', name: '物価対応料1(外来・在宅物価対応料)(初診時)イ', score: 2, category: '医学管理等', reason: '初診に対する施設設定候補', auto_add: true }, '初診に対する物価対応料1を候補に追加します。', true, 130),
      R('ADD_INITIAL_BASEUP_1', '初診時の外来・在宅ベースアップ評価料', 'suggest', { visit_type: 'initial', present_any_codes: ['111000110'], present_any_names: ['初診料'], missing_all_codes: ['180853810'], missing_all_names: ['外来・在宅ベースアップ評価料(1)1(初診時)(賃上取組)'] },
        { code: '180853810', name: '外来・在宅ベースアップ評価料(1)1(初診時)(賃上取組)', score: 23, category: '医学管理等', reason: '初診に対する施設設定候補', auto_add: true }, '初診に対する外来・在宅ベースアップ評価料を候補に追加します。', true, 140),
      R('WARN_INITIAL_AND_REVISIT_FEE_TOGETHER', '初診料と再診料の同時算定チェック', 'warning', { any_of: [{ present_all_code_sets: [['111000110'], ['112007410', '112000110', '112011310']] }, { present_all_name_sets: [['初診料'], ['再診料', '外来診療料']] }] }, {},
        '初診料と再診料/外来診療料が同時に入っています。初診・再診のどちらで算定するか確認してください。', false, 800),
      R('WARN_INITIAL_WITHOUT_INITIAL_FEE', '初診判定時の初診料不足チェック', 'warning', { visit_type: 'initial', missing_all_codes: ['111000110'], missing_all_names: ['初診料'] }, {}, '初診判定ですが初診料がありません。', false, 810),
      R('WARN_REVISIT_WITHOUT_REVISIT_FEE', '再診判定時の再診料不足チェック', 'warning', { visit_type: 'revisit', missing_all_codes: ['112007410', '112000110', '112011310'], missing_all_names: ['再診料', '外来診療料'] }, {}, '再診判定ですが再診料または外来診療料がありません。', false, 820),
      R('WARN_EXTERNAL_PRESCRIPTION_WITHOUT_PRESCRIPTION_FEE', '院外処方時の処方箋料不足チェック', 'warning', { has_external_prescription: true, missing_all_codes: ['120002910'], missing_all_names: ['処方箋料'] }, {}, '院外処方がありますが処方箋料がありません。', false, 830),
      R('WARN_OUTPATIENT_MANAGEMENT_WITH_PROCEDURE_OR_EXAM', '外来管理加算と処置・検査系の同時算定チェック', 'warning', { present_any_codes: ['112011010'], present_any_names: ['外来管理加算'], requires_procedure_or_exam: true }, {},
        '外来管理加算がありますが、処置・手術・検査・画像等が同日算定されています。算定可否を確認してください。', false, 840),
      R('WARN_INITIAL_DIAGNOSIS_REMAINS', '初診算定時の残存傷病名チェック', 'warning', { visit_type: 'initial', present_any_codes: ['111000110'], present_any_names: ['初診料'], requires_active_prior_diagnosis: true }, {}, '傷病名が残っています。', false, 895),
      R('WARN_INITIAL_DIAGNOSIS_START_REQUIRED', '初診算定日の傷病名開始日チェック', 'warning', { visit_type: 'initial', present_any_codes: ['111000110'], present_any_names: ['初診料'], requires_diagnosis_started_on_visit_date: true, requires_no_active_prior_diagnosis: true }, {},
        '初診算定日に開始される傷病名がありません。', false, 900),
    ];
    const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const asNested = (v) => asList(v).map(asList).filter((g) => g.length);
    function containsName(existing, cands) {
      const names = [...existing].map((n) => String(n).trim()).filter(Boolean);
      return cands.some((c) => { const t = String(c).trim(); return t && names.some((n) => t === n || n.includes(t) || t.includes(n)); });
    }
    const containsAll = (existing, cands) => cands.every((c) => containsName(existing, [c]));
    const extractCodes = (a) => ['code', 'action_code', 'receipt_code', 'recept_code'].filter((k) => a[k]).map((k) => String(a[k]));
    const extractNames = (a) => ['name', 'action_name', 'short_name', 'display_name', 'category'].filter((k) => a[k]).map((k) => String(a[k]));
    const EXTERNAL_MARKERS = ['院外', 'external', 'outside', '[外]'];
    const hasExternalRx = (rx) => rx.some((p) => { const j = [p.prescription_type, p.dispensing_type, p.frequency, p.route].filter(Boolean).map((f) => String(f).toLowerCase()).join(' '); return EXTERNAL_MARKERS.some((m) => j.includes(m.toLowerCase())); });
    // 区分番号（章＋番号）。E＝画像・D000〜D199＝検体検査は外来管理加算の妨げにしない（基準版は公式マスターの区分番号で判定）
    function kubunOf(M, code) { if (!M.proc[code]) return null; if (M.kubun[code]) return M.kubun[code]; if (code.startsWith('17')) return 'E'; return null; }
    const PROC_KW = ['処置', '手術', '検査', '画像', '注射', 'リハ', '麻酔'];
    function hasProcedureOrExam(M, actions) {
      for (const a of actions) {
        const code = firstOf(a, ['code', 'action_code', 'receipt_code']).trim(); const k = kubunOf(M, code);
        if (k && (k[0] === 'E' || (k[0] === 'D' && toInt(k.slice(1, 4), 999) < 200))) continue;
        if (extractNames(a).some((n) => PROC_KW.some((w) => n.includes(w)))) return true;
      }
      return false;
    }
    const ENDED = ['cured', 'discontinued', 'improved', 'died', 'transferred', '治癒', '中止', '軽快', '死亡', '移行'];
    function activePriorDiagnosis(date, dx) {
      return dx.some((d) => { const sd = isoDate(d.start_date || d.diagnosis_start_date || d.started_at); if (!sd || sd >= date) return false;
        if (ENDED.includes(s(d.outcome).trim().toLowerCase())) return false; const ed = isoDate(d.end_date || d.diagnosis_end_date || d.ended_at); if (ed && ed < date) return false; return true; });
    }
    const startedOn = (date, dx) => dx.some((d) => isoDate(d.start_date || d.diagnosis_start_date || d.started_at) === date);
    function ruleContext(M, p, actions) {
      const codes = new Set(), names = new Set(); actions.forEach((a) => { extractCodes(a).forEach((c) => codes.add(c)); extractNames(a).forEach((n) => names.add(n)); });
      return { visit_date: p.dt.date, visit_type: p.visit_type, actions, prescriptions: p.prescriptions, action_codes: codes, action_names: names,
        has_external_prescription: hasExternalRx(p.prescriptions), has_procedure_or_exam: hasProcedureOrExam(M, actions),
        has_active_prior_diagnosis: activePriorDiagnosis(p.dt.date, p.diagnoses), has_diagnosis_started_on_visit_date: startedOn(p.dt.date, p.diagnoses) };
    }
    function condMatches(cond, c) {
      const allOf = asList(cond.all_of); if (allOf.length && !allOf.every((x) => condMatches(x || {}, c))) return false;
      const anyOf = asList(cond.any_of); if (anyOf.length && !anyOf.some((x) => condMatches(x || {}, c))) return false;
      const noneOf = asList(cond.none_of); if (noneOf.length && noneOf.some((x) => condMatches(x || {}, c))) return false;
      if (cond.visit_type && String(cond.visit_type) !== String(c.visit_type)) return false;
      const pac = asList(cond.present_any_codes).map(String); if (pac.length && !pac.some((x) => c.action_codes.has(x))) return false;
      const pall = asList(cond.present_all_codes).map(String); if (pall.length && !pall.every((x) => c.action_codes.has(x))) return false;
      for (const g of asNested(cond.present_all_code_sets)) { if (!g.map(String).some((x) => c.action_codes.has(x))) return false; }
      const pan = asList(cond.present_any_names); if (pan.length && !containsName(c.action_names, pan)) return false;
      const paln = asList(cond.present_all_names); if (paln.length && !containsAll(c.action_names, paln)) return false;
      for (const g of asNested(cond.present_all_name_sets)) { if (!containsName(c.action_names, g)) return false; }
      const mac = asList(cond.missing_all_codes).map(String); if (mac.length && mac.some((x) => c.action_codes.has(x))) return false;
      const many = asList(cond.missing_any_codes).map(String); if (many.length && many.every((x) => c.action_codes.has(x))) return false;
      const man = asList(cond.missing_all_names); if (man.length && containsName(c.action_names, man)) return false;
      const manyn = asList(cond.missing_any_names); if (manyn.length && containsAll(c.action_names, manyn)) return false;
      if (cond.has_prescriptions === true && !c.prescriptions.length) return false;
      if (cond.has_prescriptions === false && c.prescriptions.length) return false;
      if (cond.has_external_prescription === true && !c.has_external_prescription) return false;
      if (cond.has_external_prescription === false && c.has_external_prescription) return false;
      if (cond.requires_no_procedure_or_exam === true && c.has_procedure_or_exam) return false;
      if (cond.requires_procedure_or_exam === true && !c.has_procedure_or_exam) return false;
      if (cond.requires_active_prior_diagnosis === true && !c.has_active_prior_diagnosis) return false;
      if (cond.requires_no_active_prior_diagnosis === true && c.has_active_prior_diagnosis) return false;
      if (cond.requires_diagnosis_started_on_visit_date === true && c.has_diagnosis_started_on_visit_date) return false;   // 当日開始の傷病名が無いときに出す警告
      return true;
    }
    // 初診料・再診料の種別（公式マスターの名称で判定）
    function visitFeeKind(M, a) {
      const code = s(a.code || a.action_code || a.billing_code); const row = M.proc[code];
      const name = nfkc(row ? row.name : s(a.name || a.action_name || a.billing_name)).replace(/\s+/g, '');
      if (name.startsWith('初診料')) return name.includes('2科目') ? 'second_initial' : 'initial';
      if (['再診料', '電話等再診料', '外来診療料'].some((x) => name.startsWith(x))) return 'revisit';
      return null;
    }
    function buildRuleSuggestion(rule) {
      const sg = Object.assign({}, rule.suggestion || {});
      let code = s(sg.code || sg.action_code).trim(), name = s(sg.name || sg.action_name).trim(); if (!code && !name) return null;
      let score = toInt(sg.score !== undefined ? sg.score : (sg.points !== undefined ? sg.points : 0));
      const known = getKnown(code, name); if (known) { code = known.action_code; name = known.name; score = toInt(known.score); sg.category = known.category || sg.category; }
      return { code, name: name || s(rule.rule_name) || code, score, reason: s(sg.reason || rule.message || rule.rule_name), category: s(sg.category) || '診察', auto_add: !!(sg.auto_add !== undefined ? sg.auto_add : (rule.default_checked !== undefined ? rule.default_checked : true)) };
    }
    // 公式マスター照合（点数・名称・コードの存在）。有効期間は JSON に無いので見ない
    const looksCode = (c) => /^\d{6,}$/.test(String(c || '').trim());
    const normName = (v) => s(v).replace(/（/g, '(').replace(/）/g, ')').replace(/　/g, ' ').replace(/ /g, '').trim();
    const similar = (a, b) => { const l = normName(a), r = normName(b); if (!l || !r) return true; return l === r || r.includes(l) || l.includes(r); };
    function inferMasterType(a) {
      const ex = a.item_type; if (['action', 'medical_action', 'procedure'].includes(ex)) return 'medical_action'; if (ex === 'drug' || ex === 'material') return ex;
      if (['drug_code', 'yj_code', 'hot_code'].some((k) => a[k])) return 'drug'; if (['material_code', 'material_master'].some((k) => a[k])) return 'material';
      const t = ['category', 'category_name', 'name', 'action_name', 'billing_name'].map((k) => s(a[k])).join(' ');
      return (t.includes('特定器材') || t.includes('材料')) ? 'material' : 'medical_action';
    }
    function primaryScore(a) { for (const k of ['unit_score', 'points', 'score']) { const v = a[k]; if (v === null || v === undefined || v === '') continue; const n = Number(v); if (Number.isFinite(n)) return Math.trunc(n); } return null; }
    function findMaster(M, type, code, name, score) {
      if (type === 'medical_action') {
        if (code && looksCode(code) && M.proc[code]) return { code, name: M.proc[code].name, score: procScore(M.proc[code]), byName: false };
        if (name && M.byName.has(name)) { const l = M.byName.get(name); const c = (score != null && l.find((x) => procScore(M.proc[x]) === score)) || l[0]; return { code: c, name: M.proc[c].name, score: procScore(M.proc[c]), byName: true }; }
      } else if (type === 'drug') {
        if (code && looksCode(code) && M.drugs[code]) return { code, name: M.drugs[code].name, score: null, byName: false };
        if (name && M.drugByName.has(name)) { const c = M.drugByName.get(name)[0]; return { code: c, name: M.drugs[c].name, score: null, byName: true }; }
      }
      return null;
    }
    const LABEL = { medical_action: '診療行為', drug: '医薬品', material: '特定器材' };
    function validateItem(M, type, code, name, score) {
      const w = [], i = [];
      if (!LABEL[type] || type === 'material' || !M.ok) return [w, i];   // 特定器材マスターは統合版に無いので照合しない
      code = s(code).trim(); name = s(name).trim(); if (!code && !name) return [w, i];
      const m = findMaster(M, type, code, name, score);
      if (!m) { if (code && looksCode(code)) w.push(`公式マスターに存在しない${LABEL[type]}コードです: ${name || '(名称なし)'} (${code})`); return [w, i]; }
      if (type === 'medical_action' && score != null && m.score != null && score !== m.score) w.push(`点数が公式マスターと違います: ${name || m.name} 入力 ${score}点 / 公式 ${m.score}点 (${code || m.code})`);
      if (m.byName && m.code && (!code || code === name)) i.push(`公式マスター照合: ${name || m.name} の公式コード候補は ${m.code} です`);
      else if (code && m.code && code !== m.code && looksCode(code)) i.push(`公式マスター照合: ${name || m.name} は ${m.code} として登録されています`);
      if (code && m.name && name && !similar(name, m.name)) i.push(`公式マスター照合: ${code || m.code} の公式名称は「${m.name}」です`);
      return [w, i];
    }
    function validateAgainstMasters(M, c) {
      const w = [], i = [], seen = new Set();
      for (const a of c.actions) {
        const type = inferMasterType(a), code = firstOf(a, ['code', 'action_code', 'billing_code', 'receipt_code', 'recept_code', 'material_code']).trim();
        const name = firstOf(a, ['name', 'action_name', 'billing_name', 'short_name']).trim(), score = primaryScore(a);
        const key = type + '|' + code + '|' + name; if (seen.has(key)) continue; seen.add(key);
        const [iw, ii] = validateItem(M, type, code, name, score); unique(w, iw); unique(i, ii);
      }
      for (const p of c.prescriptions) {
        const code = firstOf(p, ['drug_code', 'code', 'yj_code', 'hot_code', 'receipt_code', 'recept_code']).trim(), name = firstOf(p, ['drug_name', 'name']).trim();
        const key = 'drug|' + code + '|' + name; if (seen.has(key)) continue; seen.add(key);
        const [iw, ii] = validateItem(M, 'drug', code, name, null); unique(w, iw); unique(i, ii);
      }
      return [w, i];
    }
    function evaluateRules(D, M, p, actions) {
      const c = ruleContext(M, p, actions), sug = [], w = [], i = [];
      const rules = (D.rules || RULES).filter((r) => r.is_active !== false && r.effective_date <= c.visit_date && (!r.expiry_date || r.expiry_date >= c.visit_date))
        .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || cmp(a.rule_code, b.rule_code));
      for (const rule of rules) {
        let cond = rule.trigger_condition || {};
        if (rule.rule_code === 'WARN_INITIAL_AND_REVISIT_FEE_TOGETHER') {
          const kinds = new Set(c.actions.map((a) => visitFeeKind(M, a)));
          if (!(kinds.has('revisit') && (kinds.has('initial') || kinds.has('second_initial')))) continue;
          cond = {};
        }
        if (!condMatches(cond, c)) continue;
        const kind = s(rule.rule_kind).toLowerCase();
        if (kind === 'suggest') { const x = buildRuleSuggestion(rule); if (x) sug.push(x); }
        else if (kind === 'warning' || kind === 'error') { const m = rule.message || rule.rule_name; if (m) w.push(String(m)); }
        else if (rule.message) i.push(String(rule.message));
      }
      const [mw, mi] = validateAgainstMasters(M, c); unique(w, mw); unique(i, mi);
      return { suggestions: sug, warnings: w, info: i };
    }

    // ======================================================================
    // 入力の形を基準版（pydantic のモデル）に合わせる：宣言された項目だけ・既定値つき
    // ======================================================================
    const ACTION_SPEC = { code: ['str', undefined], name: ['str', null], score: ['int', null], points: ['int', null], unit_score: ['int', null], quantity: ['float', null], category: ['str', null],
      category_code: ['str', null], category_name: ['str', null], item_type: ['str', null], receipt_code: ['str', null], billing_code: ['str', null], do_not_bill: ['bool', null],
      is_self_pay: ['bool', null], comment_codes: ['list', []], comments: ['list', []], free_comment: ['str', null], karte_comment: ['str', null] };
    const RX_SPEC = { prescription_type: ['str', '院外'], dispensing_type: ['str', null], drug_type: ['str', '内服'], code: ['str', null], drug_code: ['str', null], yj_code: ['str', null],
      hot_code: ['str', null], receipt_code: ['str', null], drug_name: ['str', null], name: ['str', null], route: ['str', null], days: ['int', null], quantity: ['float', null],
      frequency: ['str', null], unit: ['str', null], generic_name: ['str', null], generic_prescription_code: ['str', null], generic_prescription_name: ['str', null],
      generic_prescription_addition_category: ['str', null], generic_prescription_master_note: ['str', null], generic_prescription_master_version: ['str', null], is_generic: ['bool', null],
      therapeutic_category: ['str', null], therapeutic_category_code: ['str', null], generic_class: ['str', null], refill_allowed: ['bool', null], is_refill: ['bool', null],
      refill_count: ['int', null], note: ['str', null], comment: ['str', null], instructions: ['str', null], comment_codes: ['list', []], comments: ['list', []], free_comment: ['str', null],
      karte_comment: ['str', null], requires_comment: ['bool', null], comment_required: ['bool', null], selectable_comment_required: ['bool', null], long_term_listed: ['bool', null],
      long_term_patient_choice: ['bool', null], generic_change_allowed: ['bool', null], generic_change_reason: ['str', null], is_temporary: ['bool', null], temporary: ['bool', null] };
    const DX_SPEC = { diagnosis_code: ['str', null], diagnosis_name: ['str', undefined], is_main: ['bool', false], is_suspected: ['bool', false], start_date: ['date', null], end_date: ['date', null], outcome: ['str', null] };
    function coerce(type, v) {
      if (type === 'str') return String(v);
      if (type === 'int') { const n = Number(v); if (!Number.isFinite(n)) throw new Error('整数ではありません'); return Math.trunc(n); }
      if (type === 'float') { const n = Number(v); if (!Number.isFinite(n)) throw new Error('数値ではありません'); return n; }
      if (type === 'bool') { if (typeof v === 'boolean') return v; const t = String(v).trim().toLowerCase(); if (['1', 'true', 'yes', 'on', 'y', 't'].includes(t)) return true; if (['0', 'false', 'no', 'off', 'n', 'f'].includes(t)) return false; throw new Error('真偽値ではありません'); }
      if (type === 'list') { if (!Array.isArray(v)) throw new Error('一覧ではありません'); return v; }
      if (type === 'date') { const d = isoDate(v); if (!d) throw new Error('日付ではありません'); return d; }
      return v;
    }
    function dump(obj, spec, label) {
      const o = obj || {}, out = {};
      for (const k of Object.keys(spec)) {
        const [type, def] = spec[k]; const v = o[k];
        if (v === undefined || (v === null && def !== null && def !== undefined)) { if (def === undefined) throw new Error(`${label}.${k} is required`); out[k] = Array.isArray(def) ? def.slice() : def; continue; }
        if (v === null) { out[k] = null; continue; }
        try { out[k] = coerce(type, v); } catch (e) { throw new Error(`${label}.${k}: ${e.message}`); }
      }
      return out;
    }

    // ======================================================================
    // POST /auto-calculation の本体（routers/auto_calculation.py calculate_auto）
    //   D: { patientId, records, diagnoses, catalog, settings, specificDiseases?, rules? }  M: 公式マスター
    // ======================================================================
    function calculate(body, D, M) {
      const b = body || {};
      if (!b.patient_id) return { status: 422, body: { detail: 'patient_id is required' } };
      const dt = parseDatetime(b.visit_datetime); if (!dt) return { status: 422, body: { detail: 'visit_datetime is required' } };
      const birth = isoDate(b.birth_date) || isoDate(b.patient_birth_date); if (!birth) return { status: 422, body: { detail: 'birth_date is required' } };
      let actions, prescriptions, diagnoses;
      try {
        actions = (b.actions || []).map((a) => dump(a, ACTION_SPEC, 'actions'));
        const rxIn = (b.prescriptions && b.prescriptions.length) ? b.prescriptions : (b.prescription_medicines || []);
        prescriptions = rxIn.map((p) => dump(p, RX_SPEC, 'prescriptions'));
        diagnoses = (b.diagnoses || []).map((d) => dump(d, DX_SPEC, 'diagnoses'));
      } catch (e) { return { status: 422, body: { detail: e.message } }; }
      const settings = Object.assign({}, b.facility_id ? (D.settings || {}) : {});
      ['visit_fee_enabled', 'time_addition_enabled', 'guidance_fee_enabled', 'specific_disease_enabled', 'dermatology_enabled', 'epilepsy_enabled', 'intractable_enabled']
        .forEach((k) => { if (b[k] !== undefined && b[k] !== null) settings[k] = b[k]; });
      const Dx = Object.assign({}, D, { catalog: b.facility_id ? (D.catalog || []) : [] });   // 施設が分からないときは施設の一覧を使わない（基準版と同じ）
      const p = { dt, birth_date: birth, actions, prescriptions, diagnoses, settings, record_id: b.record_id || null, reception_id: b.reception_id || null,
        first_visit: b.first_visit === undefined || b.first_visit === null ? null : !!b.first_visit };
      const result = autoCalculate(Dx, p);
      const candidates = actions.concat(result.suggested_actions.map((a) => ({ code: a.code, name: a.name, score: a.score, category: a.category })));
      const [catSug, catInfo] = evaluateCatalog(Dx, M, Object.assign({}, p, { visit_type: result.visit_type, time_category: result.time_category, is_infant: result.is_infant }), candidates);
      for (const sg of catSug) {
        if (hasAutoCalcAction(candidates, sg.code, sg.name)) continue;
        result.suggested_actions.push(sg); candidates.push({ code: sg.code, name: sg.name, score: sg.score, category: sg.category });
      }
      catInfo.forEach((x) => { if (!result.info.includes(x)) result.info.push(x); });
      const rules = evaluateRules(Dx, M, Object.assign({}, p, { visit_type: result.visit_type }), candidates);
      const exCodes = new Set(candidates.filter((a) => a.code).map((a) => String(a.code))), exNames = new Set(candidates.filter((a) => a.name).map((a) => String(a.name)));
      const hasExisting = (code, name) => (code && exCodes.has(code)) || (name && [...exNames].some((n) => name === n || n.includes(name) || name.includes(n)));
      for (const rs of rules.suggestions) {
        if (hasExisting(rs.code, rs.name)) continue;
        result.suggested_actions.push({ code: rs.code, name: rs.name, score: rs.score, reason: rs.reason, category: rs.category, auto_add: rs.auto_add });
        if (rs.code) exCodes.add(rs.code); if (rs.name) exNames.add(rs.name);
      }
      rules.warnings.forEach((x) => { if (!result.warnings.includes(x)) result.warnings.push(x); });
      rules.info.forEach((x) => { if (!result.info.includes(x)) result.info.push(x); });
      result.suggested_actions = result.suggested_actions.map((a) => ({ code: a.code, name: a.name, score: a.score, reason: a.reason, category: a.category, auto_add: a.auto_add }));
      return { status: 200, body: result };
    }

    const DEFAULT_SETTINGS = { visit_fee_enabled: true, time_addition_enabled: true, guidance_fee_enabled: true, prescription_fee_enabled: true, is_hospital_200plus: false,
      normal_start: '08:00', normal_end: '18:00', overtime_start: '06:00', overtime_end: '22:00', night_start: '22:00', night_end: '06:00', holidays: [] };

    return { calculate, calcAge, isInfant, timeCategory, isJapaneseHoliday, parseDatetime, isoDatetime, calcVisitFee, calcPrescriptionFee, calcGuidanceFee, determineVisitType,
      conditionContext, conditionReason, evaluateCatalog, evaluateRules, getKnown, resolveExact, resolvedStandard, ensureStandard, activeCatalog, sortRows, actionResponse, buildTrigger,
      stdTrigger, makeMasters, dump, ACTION_SPEC, RX_SPEC, DX_SPEC, STANDARD, SPECIFIC_DISEASES, RULES, DEFAULT_SETTINGS, normalizeRxType, normalizeDrugType, hasAutoCalcAction,
      itemText, medText, lookupText, isGeneric, isRefill, isPsychotropic, isNarcoticEtc, visitFeeKind, condMatches, ruleContext, codeByName };
  })();
  window.__autocalcCore = core;

  // ======================================================================
  // 画面から来る問い合わせ（置き換え層）
  // ======================================================================
  const C = window.__compat; if (!C) return;
  const { on, json, err, ready, clinicId, realFetch } = C;
  const nowIso = () => new Date().toISOString();
  const one = (x) => Array.isArray(x) ? x[0] || null : x || null;
  const fidOf = (m) => decodeURIComponent(m[1] || '') || clinicId();

  // ---- 公式マスター（最初の1回だけ読む） ----
  let masters = null;
  async function loadMasters() {
    if (masters) return masters;
    const get = async (name) => { try { const v = await C.masterJson(name); return v ? JSON.parse(JSON.stringify(v)) : {}; } catch (e) { return {}; } };
    const [proc, drugs, kubun, beppyo] = await Promise.all([get('s_procedures'), get('y_drugs'), get('proc_kubun'), get('beppyo1_codes')]);
    [proc, drugs].forEach((m) => Object.keys(m || {}).forEach((k) => { if (m[k] && m[k].name) m[k].name = C.cp932Name(m[k].name); }));   // 記号を基準版の読み方に（compat_api.js）
    masters = core.makeMasters(proc, drugs, [beppyo, kubun]);
    return masters;
  }

  // ---- 施設ごとの設定・一覧（院ごとに DB へ。compat_api.js の store） ----
  const SKEY = (fid) => 'karte_base_autocalc_settings_' + fid, AKEY = (fid) => 'karte_base_autocalc_actions_' + fid;
  const readLS = (k, d) => { try { const v = C.store.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const writeLS = (k, v) => { try { C.store.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では今回の表示だけ */ } };
  // 基準版は施設の初期化で既定値を入れている。保存が無いときは既定値、保存があれば既定値に重ねる
  const settingsOf = (fid) => Object.assign({}, core.DEFAULT_SETTINGS, readLS(SKEY(fid), {}));
  async function actionRows(fid, reactivate) {
    const M = await loadMasters();
    const rows = core.ensureStandard(M, readLS(AKEY(fid), []), fid, !!reactivate, nowIso(), () => crypto.randomUUID());
    writeLS(AKEY(fid), rows);
    return rows;
  }

  // ---- 基準版が DB から読む「過去のカルテ」「患者ごとの傷病名」 ----
  //   カルテ 1 件 ＝ カルテのある来院 1 件。行為は kartes.base_record の算定（無ければ算定明細の名称から公式コードを引く）
  async function patientRecords(pid) {
    const c = await ready(); const M = await loadMasters();
    const { data, error } = await c.from('visits').select('id,visit_date,kartes!inner(base_record),billing_items_used(item_name)').eq('clinic_id', clinicId()).eq('patient_id', pid);
    if (error) throw new Error(error.message);
    return (data || []).map((v) => {
      const b = (one(v.kartes) || {}).base_record;
      const acts = b ? (b.billings || []).filter((x) => x.billing_name || x.billing_code).map((x) => ({ code: String(x.billing_code || core.codeByName(M, x.billing_name) || ''), name: x.billing_name || '' }))
        : (v.billing_items_used || []).map((x) => ({ code: core.codeByName(M, x.item_name), name: x.item_name || '' }));
      return { id: v.id, visit_date: v.visit_date, deleted: !!(b && b.is_deleted), actions: acts };
    });
  }
  async function patientDiagnoses(pid) {
    const r = await window.fetch('/api/v1/diagnoses/patient/' + pid + '?active_only=false&include_ended=true');   // 傷病名の置き換え（compat_diagnoses.js）と同じ一覧
    if (!r.ok) throw new Error('傷病名を読めません');
    const j = await r.json(); return j.items || [];
  }
  async function depsFor(pid, fid, needCatalog) {
    const D = { patientId: pid, settings: fid ? settingsOf(fid) : {} };
    try { D.records = pid ? await patientRecords(pid) : []; } catch (e) { console.warn('[置き換え層] 過去のカルテを読めません', e); D.records = []; D.recordsError = true; }
    try { D.diagnoses = pid ? await patientDiagnoses(pid) : []; } catch (e) { console.warn('[置き換え層] 傷病名を読めません', e); D.diagnoses = []; D.diagnosesError = true; }
    if (needCatalog && fid) D.catalog = core.activeCatalog(await loadMasters(), await actionRows(fid, false));
    return D;
  }

  // ---- 自動算定（電卓ボタン・会計前） ----
  on('POST', /^\/auto-calculation\/?$/, async (m, q, body) => {
    const fid = body.facility_id || null;
    const D = await depsFor(body.patient_id, fid, true);
    const r = core.calculate(body, D, await loadMasters());
    return r.status === 200 ? r.body : json(r.body, r.status);
  });

  // ---- 施設の設定 ----
  on('GET', /^\/auto-calculation\/settings\/([^/]+)$/, async (m) => { const fid = fidOf(m); return { facility_id: fid, settings: settingsOf(fid) }; });
  on('PUT', /^\/auto-calculation\/settings\/([^/]+)$/, async (m, q, body) => {
    const fid = fidOf(m); const cur = readLS(SKEY(fid), {}); Object.assign(cur, (body && body.settings) || {}); writeLS(SKEY(fid), cur);
    return { message: '設定を更新しました', facility_id: fid };
  });
  on('POST', /^\/auto-calculation\/settings\/([^/]+)\/initialize$/, async (m) => {
    const fid = fidOf(m); const cur = readLS(SKEY(fid), {});
    Object.keys(core.DEFAULT_SETTINGS).forEach((k) => { if (!(k in cur)) cur[k] = core.DEFAULT_SETTINGS[k]; }); writeLS(SKEY(fid), cur);   // 既にある設定は変えない
    return { message: '自動算定設定を初期化しました', facility_id: fid, settings: core.DEFAULT_SETTINGS };
  });

  // ---- 施設の「自動算定する診療行為」 ----
  const listResponse = (fid, rows, includeInactive) => {
    const list = core.sortRows(rows.filter((r) => includeInactive || r.is_active)).map(core.actionResponse);
    return { facility_id: fid, count: list.length, actions: list };
  };
  on('GET', /^\/auto-calculation\/actions\/([^/]+)$/, async (m, q) => { const fid = fidOf(m); return listResponse(fid, await actionRows(fid, false), q.get('include_inactive') === 'true'); });
  on('POST', /^\/auto-calculation\/actions\/([^/]+)\/initialize-standard$/, async (m) => { const fid = fidOf(m); return listResponse(fid, await actionRows(fid, true), false); });
  on('POST', /^\/auto-calculation\/actions\/([^/]+)$/, async (m, q, body) => {
    const fid = fidOf(m); if (!body.action_name) return err(422, 'action_name is required');
    const rows = readLS(AKEY(fid), []); const sort = Math.max(0, ...rows.map((r) => r.sort_order || 0)) + 10;
    const trig = core.buildTrigger(body.group, body.condition_text, body.period_start || null, body.period_end || null,
      (body.trigger_condition && Object.keys(body.trigger_condition).length) ? body.trigger_condition : { source: 'facility_custom' });
    const row = { id: crypto.randomUUID(), facility_id: fid, action_code: String(body.action_code || ('USERAUTO' + sort)).slice(0, 20), action_name: body.action_name, score: body.score || 0,
      category: body.category == null ? null : body.category, trigger_condition: trig, is_auto_add: body.is_auto_add != null ? !!body.is_auto_add : true, sort_order: sort,
      is_active: body.is_active != null ? !!body.is_active : true, created_at: nowIso(), updated_at: nowIso() };
    rows.push(row); writeLS(AKEY(fid), rows); return core.actionResponse(row);
  });
  on('PUT', /^\/auto-calculation\/actions\/([^/]+)\/([^/]+)$/, async (m, q, body) => {
    const fid = fidOf(m); const rows = readLS(AKEY(fid), []); const row = rows.find((r) => r.id === m[2]);
    if (!row) return err(404, '自動算定対象診療行為が見つかりません');
    row.trigger_condition = core.buildTrigger(body.group, body.condition_text, body.period_start || null, body.period_end || null,
      (body.trigger_condition && Object.keys(body.trigger_condition).length) ? body.trigger_condition : (row.trigger_condition || {}));
    if (body.action_code) row.action_code = String(body.action_code).slice(0, 20);
    ['action_name', 'score', 'category'].forEach((k) => { if (body[k] != null) row[k] = body[k]; });
    if (body.is_auto_add != null) row.is_auto_add = !!body.is_auto_add; if (body.is_active != null) row.is_active = !!body.is_active;
    row.updated_at = nowIso(); writeLS(AKEY(fid), rows); return core.actionResponse(row);
  });
  on('DELETE', /^\/auto-calculation\/actions\/([^/]+)\/([^/]+)$/, async (m) => {
    const fid = fidOf(m); const rows = readLS(AKEY(fid), []); const row = rows.find((r) => r.id === m[2]);
    if (!row) return err(404, '自動算定対象診療行為が見つかりません');
    row.is_active = false; row.updated_at = nowIso(); writeLS(AKEY(fid), rows);   // 行は消さず無効にする（基準版と同じ）
    return { message: '自動算定対象診療行為を無効化しました', id: row.id };
  });

  // ---- 単独の判定（初再診・時間区分・乳幼児・特定疾患・指導料） ----
  on('GET', /^\/auto-calculation\/visit-type\/([^/]+)$/, async (m, q) => {
    const pid = m[1], date = (q.get('visit_date') || '').slice(0, 10); if (!date) return err(422, 'visit_date is required');
    const D = await depsFor(pid, q.get('facility_id'), false);
    const [vt, reason] = core.determineVisitType(D, date, [], null, null);
    return { patient_id: pid, visit_date: date, visit_type: vt, visit_type_name: vt === 'initial' ? '初診' : '再診', visit_reason: reason };
  });
  on('GET', /^\/auto-calculation\/time-category$/, async (m, q) => {
    const dt = core.parseDatetime(q.get('visit_datetime')); if (!dt) return err(422, 'visit_datetime is required');
    const fid = q.get('facility_id'); const tc = core.timeCategory(dt, fid ? settingsOf(fid) : {});
    return { visit_datetime: core.isoDatetime(dt), time_category: tc, time_category_name: { normal: '通常', overtime: '時間外', holiday: '休日', night: '深夜' }[tc] || '不明' };
  });
  on('GET', /^\/auto-calculation\/infant-check$/, async (m, q) => {
    const b = (q.get('birth_date') || '').slice(0, 10), v = (q.get('visit_date') || '').slice(0, 10); if (!b || !v) return err(422, 'birth_date and visit_date are required');
    const inf = core.isInfant(b, v);
    return { birth_date: b, visit_date: v, age: core.calcAge(b, v), is_infant: inf, message: inf ? '乳幼児加算の対象です' : '乳幼児加算の対象外です' };
  });
  on('GET', /^\/auto-calculation\/specific-diseases$/, async () => {
    const list = core.SPECIFIC_DISEASES.map((d) => ({ id: d.id, disease_code: d.disease_code, disease_name: d.disease_name, guidance_type: d.guidance_type }));
    return { count: list.length, diseases: list };
  });
  // 基準版は patient_id・visit_date を URL に、傷病名の一覧を本文に取る。画面（api.js）は本文にまとめて送るので両方受ける
  on('POST', /^\/auto-calculation\/guidance-check$/, async (m, q, body) => {
    const pid = q.get('patient_id') || (body && body.patient_id), date = String(q.get('visit_date') || (body && body.visit_date) || '').slice(0, 10);
    if (!pid || !date) return err(422, 'patient_id and visit_date are required');
    let dx; try { dx = (Array.isArray(body) ? body : (body.diagnoses || [])).map((d) => core.dump(d, core.DX_SPEC, 'diagnoses')); } catch (e) { return err(422, e.message); }
    const D = await depsFor(pid, null, false);
    const [vt, reason] = core.determineVisitType(D, date, [], null, null);
    const fees = core.calcGuidanceFee(D, dx, date, vt, null);
    return { patient_id: pid, visit_date: date, visit_type: vt, visit_reason: reason, suggested_guidance_fees: fees.map((g) => ({ code: g.code, name: g.name, score: g.score, reason: g.reason })),
      note: vt === 'initial' ? '初診時は指導料は算定できません' : null };
  });
})();
