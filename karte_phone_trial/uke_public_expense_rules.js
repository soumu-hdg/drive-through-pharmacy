// 公費を UKE（保険請求）に入れるか・保険請求とは別に請求するかの判定
//   基準版 public_expense_claim_rules.py（規則版 2026-09-13.1）の写し。
//   ・「併用（combined）」の公費だけを UKE の KO に入れる（愛知県の同一市町村国保の併用は、基準版と同じく
//     請求用の負担者番号・受給者番号 9999996 に置き換える）
//   ・「別請求（separate）」の公費（愛知県の子ども・障害者・ひとり親家庭等・精神障害者医療で、社保／国保組合／
//     別の市町村の国保／県外の国保のもの）は UKE に入れない。医療費請求書（連記式）で別に請求する
//   ・「未確認（unconfirmed）」は、基準版では UKE に入れず点検の警告になる。統合版は国公費マスター等を持たないので、
//     既定では従来どおり UKE に入れたまま注意書きを出す（UKE_PUBLIC_EXPENSE_STRICT = true で基準版と同じく外す）
//   市町村の名簿（愛知県54市町村）と 2027年4月からの新しい負担者番号表は基準版の既定データをそのまま持つ。
//   国公費マスター（公式 CSV の取込データ）は統合版に無いので、UKE_NATIONAL_PUBLIC_MASTER に行を入れたときだけ使う。

var UKE_PE_RULE_VERSION = '2026-09-13.1';
var UKE_PE_NATIONAL_SOURCE = 'https://www.ssk.or.jp/seikyushiharai/kunikohims/index.html';
var UKE_PE_SMON_MASTER_CODE = 'kunikohi_51_023_d076201302';
var UKE_PE_SMON_DIAGNOSIS_CODE = '8835762';
var UKE_PE_AICHI_SOURCE = 'https://aichi-kokuho.or.jp/medical/renkishiki/index.html';
var UKE_PE_AICHI_NOTICE = 'https://www.aichi-kangokyokai.or.jp/files/libs/14860/202511140956562960.pdf';
var UKE_PE_NAGOYA_SOURCE = 'https://www.city.nagoya.jp/kenkofukushi/iryou/1034391/1011182/1034392/1011186.html';
var UKE_PE_LEGACY_AICHI_SOURCE = 'https://ftp.orca.med.or.jp/pub/data/receipt/chihoukouhi/p23/2010-04-09-aichi.pdf';
var UKE_PE_SWITCH_DATE = '2027-04-01';
var UKE_PE_OLD_SEPARATE_DEADLINE = '2028-03-10';
var UKE_PE_LEGACY_AICHI_PAYERS = {
  aichi_child: '81230005', aichi_disabled: '82230004', aichi_single_parent: '83230003',
  aichi_mental_all: '85230001', aichi_mental_outpatient: '85230001'
};
var UKE_PE_STANDARD_AICHI_PROGRAMS = ['aichi_child', 'aichi_disabled', 'aichi_single_parent', 'aichi_mental_all', 'aichi_mental_outpatient'];
var UKE_PE_LOCAL_PROGRAM_ALIASES = { child: 'aichi_child', disabled: 'aichi_disabled', single_parent: 'aichi_single_parent' };
var UKE_PE_NATIONAL_RULE_FIELDS = ['application_priority', 'law_number', 'inpatient_covered', 'outpatient_covered',
  'subsidy_method', 'in_kind_benefit', 'medical_assistance_combination', 'partial_in_kind_unavailable', 'partial_in_kind_unavailable_note',
  'source_version', 'system_start_date', 'business_start_date', 'end_date'];
// 公費の種類 → 国公費（national）／都道府県（prefecture）／地方単独（local）・法別・名称（基準版の公費種別マスターと同じ）
var UKE_PE_TYPES = {"tuberculosis_outpatient":{"scope":"national","law":"10","name":"感染症法 結核患者の適正医療"},"tuberculosis_inpatient":{"scope":"national","law":"11","name":"感染症法 結核患者の入院"},"welfare":{"scope":"national","law":"12","name":"生活保護 医療扶助"},"war_injury_medical":{"scope":"national","law":"13","name":"戦傷病者特別援護法 療養の給付"},"war_injury_rehabilitation":{"scope":"national","law":"14","name":"戦傷病者特別援護法 更生医療"},"support_rehabilitation":{"scope":"national","law":"15","name":"自立支援医療（更生医療）"},"support_nurturing":{"scope":"national","law":"16","name":"自立支援医療（育成医療）"},"child_welfare_therapy":{"scope":"national","law":"17","name":"児童福祉法 療育の給付"},"atomic":{"scope":"national","law":"18","name":"被爆者援護法 認定疾病医療"},"atomic_general":{"scope":"national","law":"19","name":"被爆者援護法 一般疾病医療費"},"mental_hospitalization":{"scope":"national","law":"20","name":"精神保健福祉法 措置入院"},"support_mental":{"scope":"national","law":"21","name":"自立支援医療（精神通院）"},"narcotics_hospitalization":{"scope":"national","law":"22","name":"麻薬及び向精神薬取締法 入院措置"},"premature_infant_care":{"scope":"national","law":"23","name":"母子保健法 養育医療"},"care_medical":{"scope":"national","law":"24","name":"障害者総合支援法 療養介護医療"},"remaining_japanese_support":{"scope":"national","law":"25","name":"中国残留邦人等医療支援給付"},"class_one_infection":{"scope":"national","law":"28","name":"感染症法 一類感染症等入院・特例"},"new_infection":{"scope":"national","law":"29","name":"感染症法 新感染症入院等"},"medical_treatment_supervision":{"scope":"national","law":"30","name":"心神喪失者等医療観察法 医療の給付"},"hepatitis_treatment":{"scope":"national","law":"38","name":"肝炎治療・肝がん重度肝硬変"},"specific":{"scope":"national","law":"51","name":"特定疾患・先天性血液凝固因子等"},"pediatric_chronic":{"scope":"national","law":"52","name":"小児慢性特定疾病医療費"},"child_welfare_measures":{"scope":"national","law":"53","name":"児童福祉法 措置等に係る医療"},"intractable":{"scope":"national","law":"54","name":"指定難病（特定医療費）"},"hepatitis_b_special":{"scope":"national","law":"62","name":"特定B型肝炎ウイルス感染者給付関連医療"},"asbestos_relief":{"scope":"national","law":"66","name":"石綿健康被害救済医療"},"disabled_child_facility":{"scope":"national","law":"79","name":"障害児入所・肢体不自由児通所医療"},"atomic_experience_research":{"scope":"national","law":"86","name":"被爆体験者精神影響等調査研究等"},"aichi_child":{"scope":"prefecture","law":"81","name":"愛知県 子ども医療"},"aichi_single_parent":{"scope":"prefecture","law":"82","name":"愛知県 ひとり親家庭等医療"},"aichi_disabled":{"scope":"prefecture","law":"83","name":"愛知県 障害者医療"},"aichi_mental_outpatient":{"scope":"prefecture","law":null,"name":"愛知県 精神障害者医療（精神通院のみ）"},"aichi_mental_all":{"scope":"prefecture","law":null,"name":"愛知県 精神障害者医療（全疾病）"},"aichi_welfare_benefit":{"scope":"prefecture","law":"89","name":"愛知県 福祉給付金"},"child":{"scope":"local","law":"81","name":"地方単独 子ども医療"},"single_parent":{"scope":"local","law":"82","name":"地方単独 ひとり親家庭等医療"},"disabled":{"scope":"local","law":"83","name":"地方単独 障害者医療"},"local_other":{"scope":"local","law":null,"name":"地方単独医療費助成（その他）"}};
// 愛知県の市町村（コード → 名称）＝基準版の市町村別公費運用マスターの既定
var UKE_PE_AICHI_MUNICIPALITIES = {"231002":"名古屋市","232017":"豊橋市","232025":"岡崎市","232033":"一宮市","232041":"瀬戸市","232050":"半田市","232068":"春日井市","232076":"豊川市","232084":"津島市","232092":"碧南市","232106":"刈谷市","232114":"豊田市","232122":"安城市","232131":"西尾市","232149":"蒲郡市","232157":"犬山市","232165":"常滑市","232173":"江南市","232190":"小牧市","232203":"稲沢市","232211":"新城市","232220":"東海市","232238":"大府市","232246":"知多市","232254":"知立市","232262":"尾張旭市","232271":"高浜市","232289":"岩倉市","232297":"豊明市","232301":"日進市","232319":"田原市","232327":"愛西市","232335":"清須市","232343":"北名古屋市","232351":"弥富市","232360":"みよし市","232378":"あま市","232386":"長久手市","233021":"東郷町","233421":"豊山町","233617":"大口町","233625":"扶桑町","234249":"大治町","234257":"蟹江町","234273":"飛島村","234419":"阿久比町","234427":"東浦町","234451":"南知多町","234460":"美浜町","234478":"武豊町","235016":"幸田町","235610":"設楽町","235628":"東栄町","235636":"豊根村"};
// 2027年4月診療分からの愛知県 福祉医療の負担者番号（市町村名 → 番号）＝基準版 aichi_public_payers_202704.json
var UKE_PE_AICHI_PAYERS_202704 = {"aichi_child":{"law":"81","payers":{"名古屋市":"81231003","東海市":"81232225","大治町":"81234247","豊橋市":"81232019","大府市":"81232233","蟹江町":"81234254","岡崎市":"81232027","知多市":"81232241","飛島村":"81234270","一宮市":"81232035","知立市":"81232258","阿久比町":"81234411","瀬戸市":"81232043","尾張旭市":"81232266","東浦町":"81234429","半田市":"81232050","高浜市":"81232274","南知多町":"81234452","春日井市":"81232068","岩倉市":"81232282","美浜町":"81234460","豊川市":"81232076","豊明市":"81232290","武豊町":"81234478","津島市":"81232084","日進市":"81232308","幸田町":"81235012","碧南市":"81232092","田原市":"81232316","設楽町":"81235616","刈谷市":"81232100","愛西市":"81232324","東栄町":"81235624","豊田市":"81232118","清須市":"81232332","豊根村":"81235632","安城市":"81232126","北名古屋市":"81232340","西尾市":"81232134","弥富市":"81232357","蒲郡市":"81232142","みよし市":"81232365","犬山市":"81232159","あま市":"81232373","常滑市":"81232167","長久手市":"81232381","江南市":"81232175","東郷町":"81233025","小牧市":"81232191","豊山町":"81233421","稲沢市":"81232209","大口町":"81233611","新城市":"81232217","扶桑町":"81233629"}},"aichi_single_parent":{"law":"85","payers":{"名古屋市":"85231009","東海市":"85232221","大治町":"85234243","豊橋市":"85232015","大府市":"85232239","蟹江町":"85234250","岡崎市":"85232023","知多市":"85232247","飛島村":"85234276","一宮市":"85232031","知立市":"85232254","阿久比町":"85234417","瀬戸市":"85232049","尾張旭市":"85232262","東浦町":"85234425","半田市":"85232056","高浜市":"85232270","南知多町":"85234458","春日井市":"85232064","岩倉市":"85232288","美浜町":"85234466","豊川市":"85232072","豊明市":"85232296","武豊町":"85234474","津島市":"85232080","日進市":"85232304","幸田町":"85235018","碧南市":"85232098","田原市":"85232312","設楽町":"85235612","刈谷市":"85232106","愛西市":"85232320","東栄町":"85235620","豊田市":"85232114","清須市":"85232338","豊根村":"85235638","安城市":"85232122","北名古屋市":"85232346","西尾市":"85232130","弥富市":"85232353","蒲郡市":"85232148","みよし市":"85232361","犬山市":"85232155","あま市":"85232379","常滑市":"85232163","長久手市":"85232387","江南市":"85232171","東郷町":"85233021","小牧市":"85232197","豊山町":"85233427","稲沢市":"85232205","大口町":"85233617","新城市":"85232213","扶桑町":"85233625"}},"aichi_disabled":{"law":"80","payers":{"名古屋市":"80231004","東海市":"80232226","大治町":"80234248","豊橋市":"80232010","大府市":"80232234","蟹江町":"80234255","岡崎市":"80232028","知多市":"80232242","飛島村":"80234271","一宮市":"80232036","知立市":"80232259","阿久比町":"80234412","瀬戸市":"80232044","尾張旭市":"80232267","東浦町":"80234420","半田市":"80232051","高浜市":"80232275","南知多町":"80234453","春日井市":"80232069","岩倉市":"80232283","美浜町":"80234461","豊川市":"80232077","豊明市":"80232291","武豊町":"80234479","津島市":"80232085","日進市":"80232309","幸田町":"80235013","碧南市":"80232093","田原市":"80232317","設楽町":"80235617","刈谷市":"80232101","愛西市":"80232325","東栄町":"80235625","豊田市":"80232119","清須市":"80232333","豊根村":"80235633","安城市":"80232127","北名古屋市":"80232341","西尾市":"80232135","弥富市":"80232358","蒲郡市":"80232143","みよし市":"80232366","犬山市":"80232150","あま市":"80232374","常滑市":"80232168","長久手市":"80232382","江南市":"80232176","東郷町":"80233026","小牧市":"80232192","豊山町":"80233422","稲沢市":"80232200","大口町":"80233612","新城市":"80232218","扶桑町":"80233620"}},"aichi_mental_all":{"law":"90","payers":{"東海市":"90232224","大治町":"90234246","豊橋市":"90232018","大府市":"90232232","蟹江町":"90234253","岡崎市":"90232026","知多市":"90232240","飛島村":"90234279","一宮市":"90232034","知立市":"90232257","阿久比町":"90234410","瀬戸市":"90232042","尾張旭市":"90232265","東浦町":"90234428","半田市":"90232059","高浜市":"90232273","南知多町":"90234451","春日井市":"90232067","岩倉市":"90232281","美浜町":"90234469","豊川市":"90232075","豊明市":"90232299","武豊町":"90234477","津島市":"90232083","日進市":"90232307","幸田町":"90235011","碧南市":"90232091","田原市":"90232315","設楽町":"90235615","刈谷市":"90232109","愛西市":"90232323","東栄町":"90235623","豊田市":"90232117","清須市":"90232331","豊根村":"90235631","安城市":"90232125","北名古屋市":"90232349","西尾市":"90232133","弥富市":"90232356","蒲郡市":"90232141","みよし市":"90232364","犬山市":"90232158","あま市":"90232372","常滑市":"90232166","長久手市":"90232380","江南市":"90232174","東郷町":"90233024","小牧市":"90232190","豊山町":"90233420","稲沢市":"90232208","大口町":"90233610","新城市":"90232216","扶桑町":"90233628"}},"aichi_mental_outpatient":{"law":"92","payers":{"東海市":"92232222","大治町":"92234244","豊橋市":"92232016","大府市":"92232230","蟹江町":"92234251","知多市":"92232248","一宮市":"92232032","知立市":"92232255","阿久比町":"92234418","瀬戸市":"92232040","尾張旭市":"92232263","東浦町":"92234426","半田市":"92232057","高浜市":"92232271","南知多町":"92234459","春日井市":"92232065","岩倉市":"92232289","美浜町":"92234467","豊川市":"92232073","豊明市":"92232297","武豊町":"92234475","津島市":"92232081","日進市":"92232305","幸田町":"92235019","碧南市":"92232099","田原市":"92232313","設楽町":"92235613","刈谷市":"92232107","愛西市":"92232321","東栄町":"92235621","豊田市":"92232115","豊根村":"92235639","安城市":"92232123","北名古屋市":"92232347","西尾市":"92232131","弥富市":"92232354","蒲郡市":"92232149","みよし市":"92232362","犬山市":"92232156","あま市":"92232370","常滑市":"92232164","長久手市":"92232388","江南市":"92232172","東郷町":"92233022","小牧市":"92232198","豊山町":"92233428","稲沢市":"92232206","大口町":"92233618","新城市":"92232214","扶桑町":"92233626"}},"aichi_welfare_benefit":{"law":"89","payers":{"名古屋市":"89231005","東海市":"89232227","大治町":"89234249","豊橋市":"89232011","大府市":"89232235","蟹江町":"89234256","岡崎市":"89232029","知多市":"89232243","飛島村":"89234272","一宮市":"89232037","知立市":"89232250","阿久比町":"89234413","瀬戸市":"89232045","尾張旭市":"89232268","東浦町":"89234421","半田市":"89232052","高浜市":"89232276","南知多町":"89234454","春日井市":"89232060","岩倉市":"89232284","美浜町":"89234462","豊川市":"89232078","豊明市":"89232292","武豊町":"89234470","津島市":"89232086","日進市":"89232300","幸田町":"89235014","碧南市":"89232094","田原市":"89232318","設楽町":"89235618","刈谷市":"89232102","愛西市":"89232326","東栄町":"89235626","豊田市":"89232110","清須市":"89232334","豊根村":"89235634","安城市":"89232128","北名古屋市":"89232342","西尾市":"89232136","弥富市":"89232359","蒲郡市":"89232144","みよし市":"89232367","犬山市":"89232151","あま市":"89232375","常滑市":"89232169","長久手市":"89232383","江南市":"89232177","東郷町":"89233027","小牧市":"89232193","豊山町":"89233423","稲沢市":"89232201","大口町":"89233613","新城市":"89232219","扶桑町":"89233621"}},"aichi_welfare_psychiatric":{"law":"93","payers":{"東海市":"93232221","豊橋市":"93232015","大府市":"93232239","知多市":"93232247","一宮市":"93232031","知立市":"93232254","阿久比町":"93234417","尾張旭市":"93232262","東浦町":"93234425","半田市":"93232056","南知多町":"93234458","春日井市":"93232064","岩倉市":"93232288","美浜町":"93234466","豊明市":"93232296","武豊町":"93234474","津島市":"93232080","日進市":"93232304","幸田町":"93235018","碧南市":"93232098","田原市":"93232312","設楽町":"93235612","刈谷市":"93232106","愛西市":"93232320","東栄町":"93235620","豊田市":"93232114","豊根村":"93235638","安城市":"93232122","北名古屋市":"93232346","蒲郡市":"93232148","犬山市":"93232155","あま市":"93232379","常滑市":"93232163","長久手市":"93232387","江南市":"93232171","東郷町":"93233021","小牧市":"93232197","豊山町":"93233427","稲沢市":"93232205","大口町":"93233617","新城市":"93232213","扶桑町":"93233625"}}};
// 国公費マスターの行（基準版 national_public_expense_master と同じ項目名）。統合版には無いので既定は空
var UKE_NATIONAL_PUBLIC_MASTER = (typeof UKE_NATIONAL_PUBLIC_MASTER !== 'undefined' && Array.isArray(UKE_NATIONAL_PUBLIC_MASTER)) ? UKE_NATIONAL_PUBLIC_MASTER : [];
// true: 未確認の公費を基準版と同じく UKE から外す（既定 false＝従来どおり入れて注意書き）
var UKE_PUBLIC_EXPENSE_STRICT = (typeof UKE_PUBLIC_EXPENSE_STRICT !== 'undefined') ? !!UKE_PUBLIC_EXPENSE_STRICT : false;

function ukePeDigits(v) { return String(v === undefined || v === null ? '' : v).replace(/\D/g, ''); }
function ukePeHas(v) { return v !== undefined && v !== null && v !== ''; }
function ukePeStr(v) { return v === null || v === undefined ? null : String(v); }
// 日付 → 'YYYY-MM-DD'（読めなければ null）
function ukePeDate(v) {
  const s = String(v || '').slice(0, 10).replace(/[-/]/g, '');
  if (!/^[0-9]{8}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}
function ukePeNextMonthTenth(d) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  return m === 12 ? (y + 1) + '-01-10' : y + '-' + String(m + 1).padStart(2, '0') + '-10';
}
function ukePeDecision(expense, route, rule, reason, source, extra) {
  return Object.assign({ public_expense_id: expense.id, expense_type: expense.expense_type, expense_type_name: expense.expense_type_name,
    route: route, rule_id: rule, reason: reason, source_url: source }, extra || {});
}

function ukePeSelectNationalMaster(expense, masters, serviceDate) {
  const law = ukePeDigits(expense.expense_type_code || expense.law_number || String(expense.payer_number || '').slice(0, 2));
  let candidates = masters.filter(function (m) { return m.law_number === law && m.is_active !== false; });
  const exact = candidates.filter(function (m) {
    return (expense.official_master_code && m.master_code === expense.official_master_code) || m.expense_type === expense.expense_type;
  });
  if (exact.length) candidates = exact;
  else if (expense.official_master_code) return null;
  candidates = candidates.filter(function (m) {
    return ['system_start_date', 'business_start_date'].every(function (k) { const d = ukePeDate(m[k]); return !d || d <= serviceDate; }) &&
      (function () { const e = ukePeDate(m.end_date); return !e || e >= serviceDate; })();
  });
  // 同じ法別に複数の制度がある。規則が同じ行だけをまとめてよい
  const sigs = {};
  candidates.forEach(function (m) { sigs[UKE_PE_NATIONAL_RULE_FIELDS.map(function (k) { return String(m[k]); }).join('\u0001')] = 1; });
  return candidates.length && Object.keys(sigs).length === 1 ? candidates[0] : null;
}
function ukePeIsSmonCertificate(expense) {
  return [undefined, null, '', UKE_PE_SMON_MASTER_CODE].indexOf(expense.official_master_code) !== -1 &&
    (expense.official_master_code === UKE_PE_SMON_MASTER_CODE || expense.expense_type === UKE_PE_SMON_MASTER_CODE);
}
function ukePeSmonExceptionConfirmed(expense, item, master, serviceDate) {
  if (!(ukePeIsSmonCertificate(expense) && master.master_code === UKE_PE_SMON_MASTER_CODE && master.law_number === '51' && master.source_version === '20260401')) return false;
  const issued = ukePeDate(expense.certificate_issued_date);
  if (!issued || issued > serviceDate || expense.designated_provider_confirmed !== true) return false;
  return (item.diagnoses || []).some(function (d) {
    if (!d || typeof d !== 'object' || String(d.diagnosis_code || '') !== UKE_PE_SMON_DIAGNOSIS_CODE) return false;
    if (d.is_active === false || d.is_suspected || d.is_deleted || d.deleted || (d.modifier_codes || []).indexOf('8002') !== -1) return false;
    const start = ukePeDate(d.start_date), end = ukePeDate(d.end_date);
    if (!start || start > serviceDate) return false;
    if (d.end_date && (!end || end < serviceDate)) return false;
    return true;
  });
}
function ukePeNationalDecision(expense, item, masters, serviceDate) {
  const master = ukePeSelectNationalMaster(expense, masters, serviceDate);
  if (!master) return ukePeDecision(expense, 'unconfirmed', 'national.master', '診療日に適用する国公費マスターを一意に特定できません', UKE_PE_NATIONAL_SOURCE);
  const visit = String(item.visit_type || '').toLowerCase();
  let coverage;
  if (['inpatient', 'hospitalization', 'admission', '入院'].indexOf(visit) !== -1) coverage = 'inpatient_covered';
  else if (['outpatient', 'initial', 'revisit', '初診', '再診', 'home', 'home_visit', 'visit', '外来', '訪問', '訪問診療', '在宅', 'emergency'].indexOf(visit) !== -1) coverage = 'outpatient_covered';
  else return ukePeDecision(expense, 'unconfirmed', 'national.visit', '入院・外来の診療区分を確認してください', UKE_PE_NATIONAL_SOURCE);
  const extra = { master_code: master.master_code, source_version: master.source_version, application_priority: master.application_priority,
    medical_assistance_combination: master.medical_assistance_combination, law_number: master.law_number };
  if (master[coverage] === false) return ukePeDecision(expense, 'not_applicable', 'national.coverage', '国公費マスターでこの入院・外来区分は対象外です', UKE_PE_NATIONAL_SOURCE, extra);
  if (master[coverage] !== true) return ukePeDecision(expense, 'unconfirmed', 'national.coverage', '国公費マスターの診療区分を確認できません', UKE_PE_NATIONAL_SOURCE, extra);
  if (master.subsidy_method !== 1 || master.in_kind_benefit !== true) {
    return ukePeDecision(expense, 'unconfirmed', 'national.benefit_method', '現物給付の併用請求対象と確認できません。償還払い等の手続きを確認してください', UKE_PE_NATIONAL_SOURCE, extra);
  }
  const conditions = [];
  const issued = ukePeDate(expense.certificate_issued_date);
  const designated = expense.designated_provider_confirmed === true;
  let resolved = (String(master.law_number) === '19' && designated) || (String(master.law_number) === '54' && !!issued && issued <= serviceDate && designated);
  if (ukePeSmonExceptionConfirmed(expense, item, master, serviceDate)) { resolved = true; extra.exception_confirmation_rule = 'national.51.smon'; }
  if (master.partial_in_kind_unavailable && !resolved) conditions.push('現物給付の例外条件を確認してください: ' + String(master.partial_in_kind_unavailable_note || '指定医療機関・認定日等'));
  return ukePeDecision(expense, 'combined', 'national.in_kind', '国公費マスター上の現物給付対象です', UKE_PE_NATIONAL_SOURCE, Object.assign({ conditions: conditions }, extra));
}

function ukePeAichiDecision(expense, item, facilityPref, serviceDate, municipalities, claimDate) {
  const unknown = function (reason) { return ukePeDecision(expense, 'unconfirmed', 'aichi.confirm', reason, UKE_PE_AICHI_SOURCE); };
  const program = UKE_PE_LOCAL_PROGRAM_ALIASES[expense.expense_type] || expense.expense_type;
  if (facilityPref !== '23' || expense.prefecture_code !== '23') {
    return unknown('自治体公費です。受給者証の発行都道府県・市町村を公費情報に登録してください（愛知県以外の請求方法は個別確認）');
  }
  const city = municipalities[String(expense.municipality_code || '')];
  const enteredCity = String(expense.municipality_name || '').trim();
  if (!city) return unknown('医療証を発行した市町村コードが未登録または未確認です。公費情報の発行市町村を選択してください');
  if (enteredCity && enteredCity !== city) {
    return unknown('発行市町村が不一致です。コード' + expense.municipality_code + 'は' + city + 'ですが、名称は' + enteredCity + 'です。受給者証に合わせて公費情報を修正してください');
  }
  const insurer = ukePeDigits(item.insurer_number);
  const payerGroup = item.payer_group;
  if ((payerGroup !== 'shaho' && payerGroup !== 'kokuho') || (insurer.length !== 6 && insurer.length !== 8)) return unknown('加入保険と保険者番号を確認してください');
  const nationalNumber = insurer.length === 6 || ['00', '39', '67'].indexOf(insurer.slice(0, 2)) !== -1;
  if ((payerGroup === 'shaho' && nationalNumber) || (payerGroup === 'kokuho' && !nationalNumber)) return unknown('加入保険の社保・国保区分と保険者番号が矛盾しています');
  if (serviceDate >= UKE_PE_SWITCH_DATE) {
    const table = UKE_PE_AICHI_PAYERS_202704[program] || {};
    const expected = (table.payers || {})[city];
    if (!expected || ukePeDigits(expense.payer_number) !== expected) {
      return ukePeDecision(expense, 'unconfirmed', 'aichi.202704.certificate', '2027年4月以降の新しい医療証を確認してください（番号は自動変更しません）', UKE_PE_AICHI_NOTICE);
    }
    const law = ukePeDigits(expense.expense_type_code);
    if (law !== '' && law !== table.law) return ukePeDecision(expense, 'unconfirmed', 'aichi.202704.law', '新医療証の法別番号と登録された公費種別が一致しません', UKE_PE_AICHI_NOTICE);
    return ukePeDecision(expense, 'combined', 'aichi.202704.combined', '2027年4月診療分から併用レセプト請求', UKE_PE_AICHI_NOTICE,
      { law_number: table.law, source_version: '7高福第2174号', application_priority: 1000 });
  }
  const insurerName0 = String(item.insurer_name || '');
  if (UKE_PE_STANDARD_AICHI_PROGRAMS.indexOf(program) === -1) {
    if (program === 'aichi_welfare_benefit' && payerGroup === 'kokuho' && insurer.indexOf('3923') === 0) {
      // 愛知県の後期高齢者医療と県内の福祉給付金は併用
      if (ukePeDigits(expense.payer_number).indexOf('8923') === 0) {
        return ukePeDecision(expense, 'combined', 'aichi.welfare.elderly', '愛知県後期高齢者医療と県内福祉給付金の併用請求',
          'https://www.orca.med.or.jp/receipt/users/chihoukouhi/p23/index.html', { application_priority: 1000 });
      }
    }
    if (program === 'aichi_welfare_benefit' && city === '名古屋市') {
      let nm = insurerName0; if (nm.indexOf('愛知県') === 0) nm = nm.slice(3);
      if (nm.slice(-6) === '国民健康保険') nm = nm.slice(0, -6);
      if (payerGroup === 'kokuho' && (insurer.indexOf('3923') === 0 || nm === '名古屋市')) {
        return ukePeDecision(expense, 'combined', 'nagoya.welfare.elderly', '愛知県後期高齢者医療の福祉給付金は併用請求', UKE_PE_NAGOYA_SOURCE, { application_priority: 1000 });
      }
      return ukePeDecision(expense, 'unconfirmed', 'nagoya.welfare.other', '福祉給付金は通常の連記式とは別の支払請求書です。保険・請求様式を確認してください', UKE_PE_NAGOYA_SOURCE);
    }
    return unknown('この福祉給付金等の自治体別請求方法は未確認です。通常の連記式には振り分けません');
  }
  let insuranceName = insurerName0.trim();
  if (insuranceName.indexOf('愛知県') === 0) insuranceName = insuranceName.slice(3);
  const association = insuranceName.indexOf('国保組合') !== -1 || insuranceName.indexOf('国民健康保険組合') !== -1;
  if (!association) {
    if (insuranceName.slice(-6) === '国民健康保険') insuranceName = insuranceName.slice(0, -6);
    if (insuranceName.slice(-2) === '国保') insuranceName = insuranceName.slice(0, -2);
  }
  const municipalNumber = (insurer.length === 8 && insurer.indexOf('00') === 0) ? insurer.slice(2) : insurer;
  const municipal = municipalNumber.length === 6;
  const foreignMunicipal = municipal && municipalNumber.indexOf('23') !== 0;
  const cityNames = Object.keys(municipalities).map(function (k) { return municipalities[k]; });
  const otherCity = municipal && cityNames.indexOf(insuranceName) !== -1 && insuranceName !== city;
  if (payerGroup === 'shaho' || association || foreignMunicipal || otherCity) {
    const warnings = [];
    if (claimDate && claimDate > UKE_PE_OLD_SEPARATE_DEADLINE) warnings.push('2027年3月以前分の連記式受付期限（2028年3月10日）を過ぎています。提出先へ確認してください');
    return ukePeDecision(expense, 'separate', 'aichi.before202704.renki', '保険請求とは別に愛知県国保連へ医療費請求書（連記式）で請求', UKE_PE_AICHI_SOURCE, {
      form: '医療費請求書（連記式）', conditions: warnings, monthly_submission_due: ukePeNextMonthTenth(serviceDate),
      legacy_acceptance_until: UKE_PE_OLD_SEPARATE_DEADLINE, transition_source_url: UKE_PE_AICHI_NOTICE });
  }
  if (municipal && municipalNumber.indexOf('23') === 0 && insuranceName === city) {
    const expected = UKE_PE_LEGACY_AICHI_PAYERS[program];
    const payer = ukePeDigits(expense.payer_number);
    if (payer !== expected && payer !== expected.slice(0, 2)) {
      return unknown('2027年3月以前の愛知県国保併用の公費番号を確認してください。通常の' + program + 'は' + expected + 'です。自治体独自の一部負担等の例外番号は個別確認が必要です');
    }
    return ukePeDecision(expense, 'combined', 'aichi.before202704.same_city', '国保の保険者と医療証の発行市町村が一致するため併用請求', UKE_PE_AICHI_SOURCE, {
      application_priority: 1000, receipt_payer_number: expected, receipt_recipient_number: '9999996', number_source_url: UKE_PE_LEGACY_AICHI_SOURCE });
  }
  return unknown('保険情報の保険者名（現在: ' + (item.insurer_name || '未登録') + '）を確認してください。医療証の発行市町村は' + city +
    'です。同じ市の国保か、別の市・国保組合かを確定できないため請求方法を決められません');
}

// 基準版 apply_public_expense_rules と同じ振り分け（金額の付け替えは統合版の UKE では使わないので持たない）
function ukePeApplyRules(item, expenses, masters, municipalities, facilityPref, claimDate) {
  const out = { decisions: [], publicExpenses: [], separate: [], warnings: [] };
  const serviceDate = ukePeDate(item.billing_date);
  claimDate = ukePeDate(claimDate);
  expenses.forEach(function (expense) {
    const prefix = '公費「' + String(expense.expense_type_name || expense.expense_type || '未設定') + '」: ';
    let result;
    const from = ukePeDate(expense.valid_from), until = ukePeDate(expense.valid_until);
    if (expense.missing_certificate || expense.is_active === false) result = ukePeDecision(expense, 'unconfirmed', 'certificate.missing', '選択された受給者証が取得できないか無効です', '');
    else if (!serviceDate) result = ukePeDecision(expense, 'unconfirmed', 'service_date.missing', '診療日が未設定です', '');
    else if ((from && from > serviceDate) || (until && until < serviceDate)) result = ukePeDecision(expense, 'not_applicable', 'certificate.date', '受給者証の有効期間外の診療です', '');
    else if (UKE_PE_LOCAL_PROGRAM_ALIASES[expense.expense_type]) result = ukePeAichiDecision(expense, item, facilityPref, serviceDate, municipalities, claimDate);
    else if (expense.scope === 'national') result = ukePeNationalDecision(expense, item, masters, serviceDate);
    else if (expense.scope === 'prefecture' || expense.scope === 'local') result = ukePeAichiDecision(expense, item, facilityPref, serviceDate, municipalities, claimDate);
    else result = ukePeDecision(expense, 'unconfirmed', 'scope.missing', '国公費・自治体公費の区分が未確認です', '');
    out.decisions.push(result);
    (result.conditions || []).forEach(function (m) { out.warnings.push(prefix + m); });
    if (result.route !== 'combined' && result.route !== 'separate') out.warnings.push(prefix + result.reason);
    if (!String(expense.payer_number || '').trim() || !String(expense.recipient_number || '').trim()) out.warnings.push(prefix + '負担者番号・受給者番号を医療証で確認してください');
    if (result.route === 'combined') {
      const routed = Object.assign({}, expense);
      if (result.receipt_payer_number) { routed.payer_number = result.receipt_payer_number; routed.recipient_number = result.receipt_recipient_number; }
      if (result.law_number) routed.law_number = result.law_number;
      routed.application_priority = ukePeHas(result.application_priority) ? result.application_priority : 1000;
      out.publicExpenses.push(routed);
    } else if (result.route === 'separate') {
      out.separate.push(Object.assign({}, expense, { expense_type: UKE_PE_LOCAL_PROGRAM_ALIASES[expense.expense_type] || expense.expense_type, claim_routing: result }));
    }
  });
  out.publicExpenses.sort(function (a, b) { return (ukePeHas(a.application_priority) ? a.application_priority : 1000) - (ukePeHas(b.application_priority) ? b.application_priority : 1000); });
  out.warnings = out.warnings.filter(function (m, i) { return out.warnings.indexOf(m) === i; });
  return out;
}

// 基準版 resolve_payer_group（医療保険の部分）
function ukePePayerGroup(insuranceType, insurerNumber) {
  const t = String(insuranceType || '').toLowerCase();
  const n = ukePeDigits(insurerNumber);
  const law = n.length >= 8 ? n.slice(0, 2) : '';
  if (['social', 'union', 'mutual', 'seamen'].indexOf(t) !== -1) return 'shaho';
  if (t === 'national' || t === 'elderly') return 'kokuho';
  if (['01', '02', '03', '04', '06', '07', '31', '32', '33', '34', '63', '72', '73', '74', '75'].indexOf(law) !== -1) return 'shaho';
  if (n.length === 6 || law === '67' || law === '39' || t === 'kokuho' || t === 'kouki') return 'kokuho';
  return 'other';
}

// 統合版の公費（patients.receipt_extra.publicExpenses の1件）→ 基準版の公費の項目名
function ukePeExpenseOf(e) {
  const t = UKE_PE_TYPES[e.type] || {};
  const pick = function () { for (let i = 0; i < arguments.length; i++) if (ukePeHas(arguments[i])) return arguments[i]; return null; };
  return {
    id: e.id, expense_type: e.type || null, expense_type_code: pick(e.typeCode, e.expense_type_code), expense_type_name: pick(e.typeName, t.name),
    scope: pick(e.scope, t.scope), law_number: pick(t.law), official_master_code: pick(e.officialMasterCode),
    payer_number: pick(e.payerNumber), recipient_number: pick(e.recipientNumber),
    valid_from: pick(e.validFrom), valid_until: pick(e.validUntil), is_active: e.isActive !== false,
    prefecture_code: ukePeStr(pick(e.prefectureCode, e.prefecture_code)), municipality_code: ukePeStr(pick(e.municipalityCode, e.municipality_code)),
    municipality_name: pick(e.municipality, e.municipalityName, e.municipality_name),
    certificate_issued_date: pick(e.certificateIssuedDate), designated_provider_confirmed: e.designatedProviderConfirmed === true ? true : null,
    _src: e
  };
}

// UKE に載せる公費を選ぶ（uke_generator.js の ukePublicExpenses から呼ぶ）。
//   list = 診療日に有効な統合版の公費。戻り値 = UKE に載せる統合版の公費（併用の番号置き換え済みの写し）。
//   判定の結果は p._ukePublicRouting に残す（別請求の公費・注意書き）
function ukeRoutePublicExpenses(p, list) {
  const ins = p._ukeInsurance || null;
  const item = {
    billing_date: p._ukeDate, visit_type: 'outpatient', diagnoses: [],
    insurer_number: p.insurerNumber || '', insurer_name: (ins && ins.insurerName) || p.insurerName || '',
    payer_group: ukePePayerGroup(ins ? ins.insuranceType : p.insuranceType, p.insurerNumber)
  };
  const facilityPref = ukePeDigits(typeof UKE_INST !== 'undefined' ? UKE_INST.pref : '').slice(0, 2);
  const today = new Date(); const claimDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const expenses = list.map(ukePeExpenseOf);
  const r = ukePeApplyRules(item, expenses, UKE_NATIONAL_PUBLIC_MASTER, UKE_PE_AICHI_MUNICIPALITIES, facilityPref, claimDate);
  const combinedById = {};
  r.publicExpenses.forEach(function (x) { combinedById[x.id] = x; });
  const kept = [];
  expenses.forEach(function (x, i) {
    const d = r.decisions[i];
    if (d.route === 'combined') {
      const c = combinedById[x.id] || x;
      kept.push({ pri: ukePeHas(c.application_priority) ? c.application_priority : 1000, e: Object.assign({}, x._src, { payerNumber: c.payer_number, recipientNumber: c.recipient_number }) });
    } else if (d.route === 'unconfirmed' && !UKE_PUBLIC_EXPENSE_STRICT) {
      kept.push({ pri: 1000, e: x._src });   // 統合版の既定: 判定できないものは従来どおり UKE に入れる（注意書きを出す）
    }
  });
  kept.sort(function (a, b) { return a.pri - b.pri; });
  const notes = r.warnings.slice();
  r.separate.forEach(function (s) {
    notes.push('公費「' + String(s.expense_type_name || s.expense_type) + '」（負担者番号 ' + (s.payer_number || '未登録') + '）は' + s.claim_routing.reason + 'します。UKE には入れていません');
  });
  p._ukePublicRouting = { version: UKE_PE_RULE_VERSION, decisions: r.decisions, separate: r.separate, notes: notes };
  return kept.map(function (k) { return k.e; });
}
