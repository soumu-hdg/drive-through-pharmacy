/* ============================================================
   情報通信機器を用いた診療に係る報告書（別紙様式14）
   2026-09-11 追加

   ■ これは何か
   厚労省の施設基準で、オンライン診療（情報通信機器を用いた診療）の実績が
   ある医療機関は毎年8月に「別紙様式14」で報告する必要がある。
   集計期間は 前年8月1日〜当年7月31日。実績が無い年は報告不要。

   ■ 作りの方針
   様式が要求する数字は、出どころが3種類に分かれる。
     (a) カルテから自動集計できる … 件数・都道府県内訳・紹介件数・診療前相談件数
     (b) カルテに入れようがない   … 医師の常勤区分／院外での実施場所／他県の対面体制／
                                    診療前相談の実施方式
     (c) カルテ運用より前の期間   … 当院のカルテは2026-04以降しかデータが無いため、
                                    令和7年8月〜令和8年3月ぶんは手入力で補うしかない
   そこで (a)は［カルテから集計］で埋め、(b)は設定として保存し、(c)は各欄を
   手で上書きできるようにした（集計モード auto / hybrid / manual）。

   ■ 保存先
   visits.is_telemedicine ほか（受診ごと）／ telemed_reports（報告年ごと）
   → telemed_report.sql
   ============================================================ */

// 当院の固定情報（receipt_exporter.js の CLINIC と同じ値。変更時は両方直すこと）
const TM_CLINIC = {
  name: '西春内科・在宅クリニック',
  code: '7400840',
  address: '愛知県北名古屋市九之坪北浦31',
  prefName: '愛知県'
};

const TM_PREFS = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県',
  '三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'
];

const TM_PLACES = ['医師の自宅等', '当該医師が所有・所属する他の医療機関', 'その他'];
const TM_RECORDS = ['クラウド型電子カルテ', 'その他'];

let tmData = null;      // 画面が編集中の報告書データ
let tmAgg  = null;      // 直近の自動集計結果
let tmBusy = false;

// ---------- ユーティリティ ----------
function tmEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function tmNum(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function tmPad2(n) { return ('0' + n).slice(-2); }

// 報告年（西暦）→ 集計期間
function tmPeriod(year) {
  return { from: (year - 1) + '-08-01', to: year + '-07-31' };
}
// 西暦 → 令和
function tmReiwa(year) { return year - 2018; }

function tmPeriodLabel(year) {
  return '令和' + tmReiwa(year - 1) + '年8月 〜 令和' + tmReiwa(year) + '年7月';
}

// 空の報告書
function tmBlank(year) {
  return {
    report_year: year,
    institution: { name: TM_CLINIC.name, code: TM_CLINIC.code, address: TM_CLINIC.address },
    doctors: [],
    pref_support: [],
    pre_consult: { series: false, separated: false, other: false, otherText: '' },
    manual_counts: {
      sameCount: 0, sameReferred: 0, diffCount: 0, diffReferred: 0,
      taimenShoshin: 0, taimenSaishin: 0,
      onlineShoshin: 0, onlineSaishin: 0,
      preConsult: 0, noFollowUp: 0
    },
    count_mode: 'hybrid',
    note: ''
  };
}

// ============================================================
//  カルテからの自動集計
// ============================================================
/**
 * 期間内の受診を集計して様式14の各欄の値を出す。
 * ・対象は確定済み（status='done'）の受診のみ。
 * ・初診/再診は kartes.is_first_visit を優先し、無ければ visits.visit_type で判定。
 * ・「その後自院にて対面診療を行わなかった件数」は、オンライン初診の患者に
 *   それ以降の対面受診があるかどうかで自動判定する（入力欄は設けない）。
 */
async function tmAggregateFromDb(year) {
  const per = tmPeriod(year);
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
    return { ok: false, reason: 'Supabase未接続のため集計できません', period: per };
  }

  const { data, error } = await supabaseClient
    .from('visits')
    .select('id,patient_id,visit_date,visit_type,status,is_telemedicine,telemed_patient_pref,telemed_referred,telemed_pre_consult,kartes(is_first_visit)')
    .gte('visit_date', per.from)
    .lte('visit_date', per.to)
    .order('visit_date');

  if (error) {
    console.error('[様式14] 集計エラー:', error);
    return { ok: false, reason: error.message || 'DB取得エラー', period: per };
  }

  const rows = (data || []).filter(function (v) { return v.status === 'done'; });

  const agg = {
    ok: true, period: per,
    total: rows.length,
    taimenShoshin: 0, taimenSaishin: 0,
    onlineShoshin: 0, onlineSaishin: 0,
    sameCount: 0, sameReferred: 0,
    diffCount: 0, diffReferred: 0,
    preConsult: 0, noFollowUp: 0,
    prefBreakdown: [],
    noPrefCount: 0,
    warnings: []
  };

  const isFirst = function (v) {
    const k = v.kartes;
    const kk = Array.isArray(k) ? k[0] : k;
    if (kk && kk.is_first_visit !== null && kk.is_first_visit !== undefined) return !!kk.is_first_visit;
    return v.visit_type === '新規';
  };

  const prefCount = {};
  const onlineFirstVisits = [];

  rows.forEach(function (v) {
    const first = isFirst(v);
    if (!v.is_telemedicine) {
      if (first) agg.taimenShoshin++; else agg.taimenSaishin++;
      return;
    }
    // --- オンライン診療 ---
    if (first) { agg.onlineShoshin++; onlineFirstVisits.push(v); }
    else agg.onlineSaishin++;

    const pref = (v.telemed_patient_pref || '').trim();
    if (!pref) agg.noPrefCount++;
    // 未入力は自院所在地の県として数える（様式は①②の合計＝2の合計を求めるため落とせない）
    const same = !pref || pref === TM_CLINIC.prefName;
    if (same) {
      agg.sameCount++;
      if (v.telemed_referred) agg.sameReferred++;
    } else {
      agg.diffCount++;
      if (v.telemed_referred) agg.diffReferred++;
      prefCount[pref] = (prefCount[pref] || 0) + 1;
    }
    if (first && v.telemed_pre_consult) agg.preConsult++;
  });

  agg.prefBreakdown = Object.keys(prefCount)
    .map(function (p) { return { pref: p, count: prefCount[p] }; })
    .sort(function (a, b) { return b.count - a.count; });

  // 「その後自院にて対面診療を行わなかった件数」
  if (onlineFirstVisits.length) {
    const ids = Array.from(new Set(onlineFirstVisits.map(function (v) { return v.patient_id; })));
    const fu = await supabaseClient
      .from('visits')
      .select('patient_id,visit_date,status,is_telemedicine')
      .in('patient_id', ids)
      .eq('is_telemedicine', false);
    if (fu.error) {
      agg.warnings.push('対面診療の追跡に失敗したため「その後対面診療を行わなかった件数」は0にしています（' + fu.error.message + '）');
    } else {
      const byPatient = {};
      (fu.data || []).forEach(function (v) {
        if (v.status !== 'done') return;
        (byPatient[v.patient_id] = byPatient[v.patient_id] || []).push(String(v.visit_date).slice(0, 10));
      });
      onlineFirstVisits.forEach(function (v) {
        const d = String(v.visit_date).slice(0, 10);
        const later = (byPatient[v.patient_id] || []).some(function (x) { return x > d; });
        if (!later) agg.noFollowUp++;
      });
    }
  }

  if (agg.noPrefCount > 0) {
    agg.warnings.push('オンライン診療 ' + agg.noPrefCount + '件で「患者の所在（都道府県）」が未入力のため、自院と同一県（①）として数えています。');
  }
  if (agg.onlineShoshin + agg.onlineSaishin === 0) {
    agg.warnings.push('この期間にオンライン診療の記録がありません。カルテ運用開始前の期間は手入力で補ってください。');
  }

  return agg;
}

// 自動集計値＋手入力補正 → 実際に様式へ載る値
function tmEffective() {
  const m = tmData.manual_counts || {};
  const a = tmAgg && tmAgg.ok ? tmAgg : null;
  const mode = tmData.count_mode || 'hybrid';
  const pick = function (key) {
    const man = tmNum(m[key]);
    if (mode === 'manual' || !a) return man;
    if (mode === 'auto') return a[key];
    return a[key] + man;                 // hybrid: カルテ集計 ＋ 手入力の補正
  };
  const e = {
    sameCount: pick('sameCount'), sameReferred: pick('sameReferred'),
    diffCount: pick('diffCount'), diffReferred: pick('diffReferred'),
    taimenShoshin: pick('taimenShoshin'), taimenSaishin: pick('taimenSaishin'),
    onlineShoshin: pick('onlineShoshin'), onlineSaishin: pick('onlineSaishin'),
    preConsult: pick('preConsult'), noFollowUp: pick('noFollowUp')
  };
  e.onlineTotal = e.sameCount + e.diffCount;
  e.billTotal   = e.onlineShoshin + e.onlineSaishin;
  e.diffRatio   = e.onlineTotal > 0 ? (e.diffCount / e.onlineTotal * 100) : 0;
  e.matched     = (e.onlineTotal === e.billTotal);
  e.needPrefSupport = e.diffRatio > 20;   // 2割超で 1-2) の記載が必要
  return e;
}

// ============================================================
//  読み込み・保存
// ============================================================
async function tmLoad(year) {
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return tmBlank(year);
  try {
    const { data, error } = await supabaseClient
      .from('telemed_reports')
      .select('*')
      .eq('clinic_id', 'nishiharu')
      .eq('report_year', year)
      .maybeSingle();
    if (error) { console.warn('[様式14] 読込エラー:', error); return tmBlank(year); }
    if (!data) return tmBlank(year);
    const b = tmBlank(year);
    return {
      report_year: year,
      institution: Object.assign({}, b.institution, data.institution || {}),
      doctors: data.doctors || [],
      pref_support: data.pref_support || [],
      pre_consult: Object.assign({}, b.pre_consult, data.pre_consult || {}),
      manual_counts: Object.assign({}, b.manual_counts, data.manual_counts || {}),
      count_mode: data.count_mode || 'hybrid',
      note: data.note || ''
    };
  } catch (e) {
    console.error('[様式14] 読込例外:', e);
    return tmBlank(year);
  }
}

async function tmSave() {
  if (tmBusy) return;
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
    alert('Supabaseに接続していないため保存できません。');
    return;
  }
  tmCollectForm();
  tmBusy = true;
  tmStatus('保存中...');
  try {
    const row = {
      clinic_id: 'nishiharu',
      report_year: tmData.report_year,
      institution: tmData.institution,
      doctors: tmData.doctors,
      pref_support: tmData.pref_support,
      pre_consult: tmData.pre_consult,
      manual_counts: tmData.manual_counts,
      count_mode: tmData.count_mode,
      note: tmData.note,
      updated_by: (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : null
    };
    const { error } = await supabaseClient
      .from('telemed_reports')
      .upsert(row, { onConflict: 'clinic_id,report_year' });
    if (error) throw new Error(error.message);
    tmStatus('保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）');
  } catch (e) {
    console.error('[様式14] 保存失敗:', e);
    tmStatus('保存に失敗しました: ' + (e.message || e), true);
  } finally {
    tmBusy = false;
  }
}

function tmStatus(msg, isErr) {
  const el = document.getElementById('tmStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#b91c1c' : '#3a6b35';
}

// ============================================================
//  画面
// ============================================================
async function openTelemedReport() {
  const ov = document.getElementById('telemedReportModal');
  if (!ov) return;
  ov.classList.add('show');
  const year = (tmData && tmData.report_year) || tmDefaultYear();
  document.getElementById('tmBody').innerHTML = '<div class="tm-loading">読み込み中...</div>';
  tmData = await tmLoad(year);
  tmAgg = null;
  tmRender();
}

function closeTelemedReport() {
  const ov = document.getElementById('telemedReportModal');
  if (ov) ov.classList.remove('show');
}

// 既定の報告年：8月以降は当年、7月以前は前年（＝直近に提出すべき報告）
function tmDefaultYear() {
  const d = new Date();
  return (d.getMonth() + 1) >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}

async function tmChangeYear(year) {
  tmCollectForm();
  tmData = await tmLoad(parseInt(year, 10));
  tmAgg = null;
  tmRender();
}

async function tmRunAggregate() {
  if (tmBusy) return;
  tmCollectForm();
  tmBusy = true;
  tmStatus('カルテを集計中...');
  try {
    tmAgg = await tmAggregateFromDb(tmData.report_year);
    if (!tmAgg.ok) {
      tmStatus('集計できませんでした: ' + tmAgg.reason, true);
    } else {
      tmStatus('カルテ ' + tmAgg.total + '件から集計しました（オンライン ' +
               (tmAgg.onlineShoshin + tmAgg.onlineSaishin) + '件）');
      // 他県が出ていれば 1-2) の行を自動で用意する
      tmAgg.prefBreakdown.slice(0, 10).forEach(function (p) {
        if (!tmData.pref_support.some(function (r) { return r.pref === p.pref; })) {
          tmData.pref_support.push({ pref: p.pref, support: '' });
        }
      });
    }
    tmRender();
  } finally {
    tmBusy = false;
  }
}

// ---------- 入力フォームの描画 ----------
function tmRender() {
  const body = document.getElementById('tmBody');
  if (!body || !tmData) return;
  const y = tmData.report_year;
  const per = tmPeriod(y);
  const e = tmEffective();
  const a = tmAgg && tmAgg.ok ? tmAgg : null;
  const inst = tmData.institution || {};

  // 報告年セレクト
  let years = '';
  const nowY = new Date().getFullYear();
  for (let i = nowY + 1; i >= nowY - 5; i--) {
    years += '<option value="' + i + '"' + (i === y ? ' selected' : '') + '>令和' + tmReiwa(i) + '年8月報告（' + i + '年）</option>';
  }

  const modes = [
    ['auto',   'カルテ集計のみ'],
    ['hybrid', 'カルテ集計＋手入力で補正'],
    ['manual', '手入力のみ']
  ].map(function (m) {
    return '<option value="' + m[0] + '"' + (tmData.count_mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
  }).join('');

  // 件数欄（カルテ集計値・手入力の補正・報告値 の3列）
  const countRow = function (key, label, indent) {
    const auto = a ? a[key] : null;
    return '<tr' + (indent ? ' class="tm-sub"' : '') + '>' +
      '<th>' + tmEsc(label) + '</th>' +
      '<td class="tm-auto">' + (auto === null ? '—' : auto + ' 件') + '</td>' +
      '<td><input type="number" min="0" id="tm_m_' + key + '" value="' + tmNum((tmData.manual_counts || {})[key]) + '" oninput="tmOnCountInput()"></td>' +
      '<td class="tm-eff" id="tm_e_' + key + '">' + e[key] + ' 件</td>' +
      '</tr>';
  };

  let h = '';

  // ===== ツールバー =====
  h += '<div class="tm-toolbar">' +
       '<label>報告年</label><select id="tmYear" onchange="tmChangeYear(this.value)">' + years + '</select>' +
       '<span class="tm-period">対象期間: ' + tmPeriodLabel(y) + '（' + per.from + ' 〜 ' + per.to + '）</span>' +
       '<span class="tm-spacer"></span>' +
       '<label>件数の出し方</label><select id="tmMode" onchange="tmOnModeChange(this.value)">' + modes + '</select>' +
       '<button class="tm-btn tm-btn-main" onclick="tmRunAggregate()">カルテから集計</button>' +
       '<button class="tm-btn" onclick="tmSave()">保存</button>' +
       '<button class="tm-btn tm-btn-print" onclick="tmPrint()">様式14を印刷</button>' +
       '</div>' +
       '<div class="tm-status" id="tmStatus"></div>';

  if (a && a.warnings.length) {
    h += '<div class="tm-warn">' + a.warnings.map(function (w) { return '<div>・' + tmEsc(w) + '</div>'; }).join('') + '</div>';
  }

  // ===== 保険医療機関 =====
  h += '<div class="tm-sec"><div class="tm-sec-title">保険医療機関</div>' +
       '<div class="tm-grid3">' +
       '<label>保険医療機関名<input type="text" id="tmInstName" value="' + tmEsc(inst.name) + '"></label>' +
       '<label>医療機関コード（7桁）<input type="text" id="tmInstCode" value="' + tmEsc(inst.code) + '"></label>' +
       '<label>所在地（都道府県名から）<input type="text" id="tmInstAddr" value="' + tmEsc(inst.address) + '"></label>' +
       '</div></div>';

  // ===== 1-1) 件数 =====
  h += '<div class="tm-sec"><div class="tm-sec-title">1-1）患者の所在毎の情報通信機器を用いた診療実施状況</div>' +
       '<table class="tm-table">' +
       '<thead><tr><th style="width:46%"></th><th>カルテ集計</th><th>手入力の補正</th><th>報告値</th></tr></thead><tbody>' +
       countRow('sameCount',    '① 患者の所在が当院と同一都道府県') +
       countRow('sameReferred', '　うち他院へ紹介した件数', true) +
       countRow('diffCount',    '② 患者の所在が異なる都道府県') +
       countRow('diffReferred', '　うち他院へ紹介した件数', true) +
       '</tbody></table>' +
       '<div class="tm-calc" id="tmCalc11"></div></div>';

  // ===== 1-2) 他県の対面体制 =====
  h += '<div class="tm-sec" id="tmSec12"><div class="tm-sec-title">1-2）異なる都道府県の患者に対し、直接の対面診療を行える体制の整備状況' +
       '<span class="tm-hint">※②の割合が2割を超える場合に記載（件数の多い10箇所）</span></div>' +
       '<div id="tmPrefRows"></div>' +
       '<button class="tm-btn tm-btn-sm" onclick="tmAddPref()">＋ 都道府県を追加</button></div>';

  // ===== 1-3) 院外で実施した医師 =====
  h += '<div class="tm-sec"><div class="tm-sec-title">1-3）医師が当院外で情報通信機器を用いた診療を実施した場合' +
       '<span class="tm-hint">※該当する全ての医師を記載</span></div>' +
       '<div id="tmDoctorRows"></div>' +
       '<button class="tm-btn tm-btn-sm" onclick="tmAddDoctor()">＋ 医師を追加</button></div>';

  // ===== 2 診療の件数 =====
  h += '<div class="tm-sec"><div class="tm-sec-title">2　診療の件数</div>' +
       '<table class="tm-table">' +
       '<thead><tr><th style="width:46%"></th><th>カルテ集計</th><th>手入力の補正</th><th>報告値</th></tr></thead><tbody>' +
       '<tr class="tm-group"><td colspan="4">対面診療で実施した診療の算定件数（オンライン診療を実施していない患者を含む全患者）</td></tr>' +
       countRow('taimenShoshin', '初診料') +
       countRow('taimenSaishin', '再診料等（外来診療料を含む）') +
       '<tr class="tm-group"><td colspan="4">情報通信機器を用いた診療の算定件数</td></tr>' +
       countRow('onlineShoshin', '初診料') +
       countRow('preConsult',    '　うち診療前相談を行った件数', true) +
       countRow('noFollowUp',    '　うちその後自院にて対面診療を行わなかった件数', true) +
       countRow('onlineSaishin', '再診料等（外来診療料を含む）') +
       '</tbody></table>' +
       '<div class="tm-calc" id="tmCalc2"></div></div>';

  // ===== 3 診療前相談 =====
  const pc = tmData.pre_consult || {};
  h += '<div class="tm-sec"><div class="tm-sec-title">3　診療前相談の実施状況（複数回答可）</div>' +
       '<label class="tm-chk"><input type="checkbox" id="tmPcSeries"' + (pc.series ? ' checked' : '') + '> 診療前相談をオンライン診療と一連として実施している</label>' +
       '<label class="tm-chk"><input type="checkbox" id="tmPcSep"' + (pc.separated ? ' checked' : '') + '> 診療前相談とオンライン診療は明確に時間を分けて実施している</label>' +
       '<label class="tm-chk"><input type="checkbox" id="tmPcOther"' + (pc.other ? ' checked' : '') + '> その他' +
       '<input type="text" id="tmPcOtherText" class="tm-inline" value="' + tmEsc(pc.otherText) + '" placeholder="内容"></label>' +
       '</div>';

  // ===== メモ =====
  h += '<div class="tm-sec"><div class="tm-sec-title">社内メモ（様式には印刷されません）</div>' +
       '<textarea id="tmNote" rows="2" placeholder="手入力の根拠、集計上の注意点など">' + tmEsc(tmData.note) + '</textarea></div>';

  body.innerHTML = h;
  tmRenderPrefRows();
  tmRenderDoctorRows();
  tmUpdateCalc();
}

function tmOnModeChange(v) {
  tmCollectForm();
  tmData.count_mode = v;
  tmRender();
}

function tmOnCountInput() {
  tmCollectCounts();
  const e = tmEffective();
  Object.keys(e).forEach(function (k) {
    const el = document.getElementById('tm_e_' + k);
    if (el) el.textContent = e[k] + ' 件';
  });
  tmUpdateCalc();
}

// 割合と「様式上の一致必須」のチェックを表示する
function tmUpdateCalc() {
  const e = tmEffective();
  const c1 = document.getElementById('tmCalc11');
  if (c1) {
    c1.innerHTML =
      '<span>①＋② ＝ <b>' + e.onlineTotal + ' 件</b></span>' +
      '<span>②／（①＋②）＝ <b>' + e.diffRatio.toFixed(1) + ' %</b></span>' +
      (e.needPrefSupport
        ? '<span class="tm-flag">2割超 → 1-2）の記載が必要です</span>'
        : '<span class="tm-ok">2割以下 → 1-2）の記載は不要</span>');
  }
  const c2 = document.getElementById('tmCalc2');
  if (c2) {
    c2.innerHTML =
      '<span>オンライン初診＋再診等 ＝ <b>' + e.billTotal + ' 件</b></span>' +
      (e.matched
        ? '<span class="tm-ok">1-1）の①＋②（' + e.onlineTotal + '件）と一致しています</span>'
        : '<span class="tm-flag">1-1）の①＋②（' + e.onlineTotal + '件）と一致していません。様式は一致が必須です</span>');
  }
  const s12 = document.getElementById('tmSec12');
  if (s12) s12.classList.toggle('tm-required', e.needPrefSupport);
}

// ---------- 1-2) 都道府県行 ----------
function tmRenderPrefRows() {
  const wrap = document.getElementById('tmPrefRows');
  if (!wrap) return;
  const counts = {};
  if (tmAgg && tmAgg.ok) tmAgg.prefBreakdown.forEach(function (p) { counts[p.pref] = p.count; });

  if (!tmData.pref_support.length) {
    wrap.innerHTML = '<div class="tm-empty">行はありません。異なる都道府県の患者がいる場合に追加してください。</div>';
    return;
  }
  wrap.innerHTML = tmData.pref_support.map(function (r, i) {
    const opts = TM_PREFS.map(function (p) {
      return '<option value="' + p + '"' + (r.pref === p ? ' selected' : '') + '>' + p + (counts[p] ? '（' + counts[p] + '件）' : '') + '</option>';
    }).join('');
    return '<div class="tm-row tm-row-pref">' +
      '<select id="tmPref_' + i + '"><option value="">選択...</option>' + opts + '</select>' +
      '<input type="text" id="tmPrefSup_' + i + '" value="' + tmEsc(r.support) + '" placeholder="具体的な医療機関名、紹介・連絡・情報提供の方法、事前合意の有無など">' +
      '<button class="tm-del" onclick="tmDelPref(' + i + ')" title="削除">&times;</button>' +
      '</div>';
  }).join('');
}
function tmAddPref() { tmCollectForm(); tmData.pref_support.push({ pref: '', support: '' }); tmRenderPrefRows(); }
function tmDelPref(i) { tmCollectForm(); tmData.pref_support.splice(i, 1); tmRenderPrefRows(); }

// ---------- 1-3) 医師行 ----------
function tmRenderDoctorRows() {
  const wrap = document.getElementById('tmDoctorRows');
  if (!wrap) return;
  if (!tmData.doctors.length) {
    wrap.innerHTML = '<div class="tm-empty">行はありません。院外（自宅等）からオンライン診療を行った医師がいる場合に追加してください。</div>';
    return;
  }
  wrap.innerHTML =
    '<div class="tm-row tm-row-doc tm-row-head"><span>医師名</span><span>常勤／非常勤</span><span>実施した場所</span><span>都道府県</span><span>過去の患者の状態を把握する体制</span><span></span></div>' +
    tmData.doctors.map(function (d, i) {
      const emp = ['常勤', '非常勤'].map(function (x) {
        return '<option value="' + x + '"' + (d.employment === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
      const place = TM_PLACES.map(function (x) {
        return '<option value="' + x + '"' + (d.place === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
      const pref = TM_PREFS.map(function (x) {
        return '<option value="' + x + '"' + (d.pref === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
      const rec = TM_RECORDS.map(function (x) {
        return '<option value="' + x + '"' + (d.record === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
      return '<div class="tm-row tm-row-doc">' +
        '<input type="text" id="tmDocName_' + i + '" value="' + tmEsc(d.name) + '" placeholder="氏名">' +
        '<select id="tmDocEmp_' + i + '"><option value="">選択...</option>' + emp + '</select>' +
        '<span class="tm-stack">' +
          '<select id="tmDocPlace_' + i + '" onchange="tmSyncDocOther(' + i + ')"><option value="">選択...</option>' + place + '</select>' +
          '<input type="text" id="tmDocPlaceOther_' + i + '" value="' + tmEsc(d.placeOther) + '" placeholder="その他の内容"' + (d.place === 'その他' ? '' : ' style="display:none"') + '>' +
        '</span>' +
        '<select id="tmDocPref_' + i + '"><option value="">選択...</option>' + pref + '</select>' +
        '<span class="tm-stack">' +
          '<select id="tmDocRec_' + i + '" onchange="tmSyncDocOther(' + i + ')"><option value="">選択...</option>' + rec + '</select>' +
          '<input type="text" id="tmDocRecOther_' + i + '" value="' + tmEsc(d.recordOther) + '" placeholder="その他の内容"' + (d.record === 'その他' ? '' : ' style="display:none"') + '>' +
        '</span>' +
        '<button class="tm-del" onclick="tmDelDoctor(' + i + ')" title="削除">&times;</button>' +
        '</div>';
    }).join('');
}
function tmAddDoctor() {
  tmCollectForm();
  tmData.doctors.push({ name: '', employment: '', place: '', placeOther: '', pref: TM_CLINIC.prefName, record: 'クラウド型電子カルテ', recordOther: '' });
  tmRenderDoctorRows();
}
function tmDelDoctor(i) { tmCollectForm(); tmData.doctors.splice(i, 1); tmRenderDoctorRows(); }
function tmSyncDocOther(i) {
  const p = document.getElementById('tmDocPlace_' + i);
  const po = document.getElementById('tmDocPlaceOther_' + i);
  if (p && po) po.style.display = (p.value === 'その他') ? '' : 'none';
  const r = document.getElementById('tmDocRec_' + i);
  const ro = document.getElementById('tmDocRecOther_' + i);
  if (r && ro) ro.style.display = (r.value === 'その他') ? '' : 'none';
}

// ---------- 画面 → tmData ----------
function tmCollectCounts() {
  const m = tmData.manual_counts || (tmData.manual_counts = {});
  Object.keys(m).forEach(function (k) {
    const el = document.getElementById('tm_m_' + k);
    if (el) m[k] = tmNum(el.value);
  });
}

function tmCollectForm() {
  if (!tmData) return;
  const val = function (id) { const el = document.getElementById(id); return el ? el.value : undefined; };
  const chk = function (id) { const el = document.getElementById(id); return el ? el.checked : undefined; };

  const n = val('tmInstName'); if (n !== undefined) tmData.institution.name = n;
  const c = val('tmInstCode'); if (c !== undefined) tmData.institution.code = c;
  const ad = val('tmInstAddr'); if (ad !== undefined) tmData.institution.address = ad;

  const mode = val('tmMode'); if (mode !== undefined) tmData.count_mode = mode;
  tmCollectCounts();

  tmData.pref_support.forEach(function (r, i) {
    const p = val('tmPref_' + i); if (p !== undefined) r.pref = p;
    const s = val('tmPrefSup_' + i); if (s !== undefined) r.support = s;
  });

  tmData.doctors.forEach(function (d, i) {
    const g = function (suffix) { return val('tmDoc' + suffix + '_' + i); };
    if (g('Name') !== undefined) d.name = g('Name');
    if (g('Emp') !== undefined) d.employment = g('Emp');
    if (g('Place') !== undefined) d.place = g('Place');
    if (g('PlaceOther') !== undefined) d.placeOther = g('PlaceOther');
    if (g('Pref') !== undefined) d.pref = g('Pref');
    if (g('Rec') !== undefined) d.record = g('Rec');
    if (g('RecOther') !== undefined) d.recordOther = g('RecOther');
  });

  const pc = tmData.pre_consult;
  if (chk('tmPcSeries') !== undefined) pc.series = chk('tmPcSeries');
  if (chk('tmPcSep') !== undefined) pc.separated = chk('tmPcSep');
  if (chk('tmPcOther') !== undefined) pc.other = chk('tmPcOther');
  const ot = val('tmPcOtherText'); if (ot !== undefined) pc.otherText = ot;

  const note = val('tmNote'); if (note !== undefined) tmData.note = note;
}

// ============================================================
//  様式14 の印刷（別ウィンドウ）
//  ・厚労省の様式レイアウトに合わせる。装飾はせず罫線のみ。
//  ・1-2)は10行、1-3)は5行を下限とし、行が足りなければ空行で埋める（様式どおり）。
// ============================================================
function tmPrint() {
  tmCollectForm();
  const y   = tmData.report_year;
  const e   = tmEffective();
  const inst = tmData.institution || {};
  const pc  = tmData.pre_consult || {};
  const box = function (on) { return on ? '&#9745;' : '&#9744;'; };   // ☑ / □
  const kenLabel = function (n) { return '<span class="num">' + n + '</span> 件'; };

  const fromR = '令和' + tmReiwa(y - 1) + '年8月';
  const toR   = '令和' + tmReiwa(y) + '年7月';

  // --- 1-2) 都道府県別の体制（様式どおり10行） ---
  let prefRows = '';
  const prefs = (tmData.pref_support || []).slice(0, 10);
  for (let i = 0; i < Math.max(10, prefs.length); i++) {
    const r = prefs[i] || { pref: '', support: '' };
    prefRows += '<tr><td class="c">' + tmEsc(r.pref) + '</td><td>' + tmEsc(r.support) + '</td></tr>';
  }

  // --- 1-3) 医師（様式どおり5行以上） ---
  let docRows = '';
  const docs = tmData.doctors || [];
  for (let i = 0; i < Math.max(5, docs.length); i++) {
    const d = docs[i] || {};
    const placeOther = (d.place === 'その他') ? tmEsc(d.placeOther || '') : '';
    const recOther   = (d.record === 'その他') ? tmEsc(d.recordOther || '') : '';
    docRows +=
      '<tr>' +
        '<td class="c">' + tmEsc(d.name || '') + '</td>' +
        '<td class="chk">' +
          box(d.employment === '常勤') + ' 常勤<br>' +
          box(d.employment === '非常勤') + ' 非常勤' +
        '</td>' +
        '<td class="chk">' +
          box(d.place === '医師の自宅等') + ' 医師の自宅等<br>' +
          box(d.place === '当該医師が所有・所属する他の医療機関') + ' 当該医師が所有・所属する他の医療機関<br>' +
          box(d.place === 'その他') + ' その他（' + placeOther + '）' +
        '</td>' +
        '<td class="c">' + tmEsc(d.pref || '') + '</td>' +
        '<td class="chk">' +
          box(d.record === 'クラウド型電子カルテ') + ' クラウド型電子カルテ<br>' +
          box(d.record === 'その他') + ' その他（' + recOther + '）' +
        '</td>' +
      '</tr>';
  }

  const html =
'<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
'<title>情報通信機器を用いた診療に係る報告書（別紙様式14）</title>' +
'<style>' +
'@page { size: A4 portrait; margin: 14mm 12mm; }' +
'body { font-family: "Yu Mincho","Hiragino Mincho ProN",serif; color:#000; font-size:10.5px; line-height:1.5; margin:0; }' +
'.page { page-break-after: always; }' +
'.page:last-child { page-break-after: auto; }' +
'.form-no { font-size:10.5px; }' +
'h1 { font-size:15px; text-align:center; margin:2px 0 0; letter-spacing:1px; font-weight:600; }' +
'.dateline { text-align:right; font-size:10.5px; margin-top:-14px; }' +
'.note-top { font-size:9.5px; margin:6px 0 10px; }' +
'.head-field { margin-left:90px; margin-bottom:8px; }' +
'.head-field .lbl { font-size:10.5px; }' +
'.head-field .val { display:block; border-bottom:1px solid #000; min-height:16px; padding:1px 4px; font-family:"Yu Gothic",sans-serif; }' +
'.head-field .sub { font-size:9px; margin-left:1em; }' +
'h2 { font-size:11.5px; margin:14px 0 4px; font-weight:600; }' +
'h3 { font-size:10.5px; margin:10px 0 3px; font-weight:600; }' +
'table { border-collapse:collapse; width:100%; }' +
'th,td { border:1px solid #000; padding:3px 5px; height:20px; vertical-align:middle; font-weight:normal; font-size:10px; }' +
'th { text-align:center; }' +
'td.c { text-align:center; }' +
'td.r { text-align:right; }' +
'td.chk { font-size:9px; line-height:1.45; }' +
'.num { font-family:"Yu Gothic",sans-serif; font-weight:700; font-size:11.5px; }' +
'.slash { background:linear-gradient(to top right, transparent 49.4%, #000 49.4%, #000 50.6%, transparent 50.6%); }' +
'.notes { font-size:9px; margin-top:12px; line-height:1.6; }' +
'.notes div { text-indent:-1.6em; margin-left:1.6em; }' +
'.mizu { font-size:9px; }' +
'.code-top { text-align:right; margin-bottom:10px; }' +
'.code-top span { border-bottom:1px solid #000; padding:0 24px 1px; font-family:"Yu Gothic",sans-serif; }' +
'@media screen { body { background:#f2f2f0; } .page { background:#fff; width:186mm; margin:12px auto; padding:14mm 12mm; box-shadow:0 1px 4px rgba(0,0,0,.2); } }' +
'</style></head><body>' +

// ============ 1ページ目 ============
'<div class="page">' +
  '<div class="form-no">（別紙様式１４）</div>' +
  '<h1>情報通信機器を用いた診療に係る報告書（8月報告）</h1>' +
  '<div class="dateline">（令和' + tmReiwa(y) + '年8月1日）</div>' +
  '<div class="note-top">※情報通信機器を用いた診療を行った実績がない場合は報告の必要はない。</div>' +

  '<div class="head-field"><span class="lbl">保険医療機関名</span><span class="val">' + tmEsc(inst.name) + '</span></div>' +
  '<div class="head-field"><span class="lbl">医療機関コード</span><span class="val">' + tmEsc(inst.code) + '</span>' +
    '<span class="sub">※レセプトに記載する7桁の数字を記載すること。</span></div>' +
  '<div class="head-field"><span class="lbl">所在地</span><span class="val">' + tmEsc(inst.address) + '</span>' +
    '<span class="sub">※都道府県名から記載すること。</span></div>' +

  '<h2>1　情報通信機器を用いた診療実施状況（' + fromR + '～' + toR + '）</h2>' +
  '<h3>1）患者の所在毎の情報通信機器を用いた診療実施状況</h3>' +
  '<table>' +
    '<tr>' +
      '<th style="width:40%;text-align:left;font-size:9px;padding:4px 6px;">※　①と②の診療件数の合計が2の「情報通信機器を用いた診療の算定件数」の「初診料」と「再診料等」の合計と一致する必要があります。</th>' +
      '<th style="width:16%">診療件数</th>' +
      '<th style="width:44%;font-size:9px;">そのうち「自身では対応困難な疾患・病態の患者や緊急性がある場合」として、他の医療機関へ紹介を実施したものの件数</th>' +
    '</tr>' +
    '<tr><td>患者の所在が、上記医療機関と同一の都道府県である場合（①）</td>' +
        '<td class="r">' + kenLabel(e.sameCount) + '</td>' +
        '<td class="r">' + kenLabel(e.sameReferred) + '</td></tr>' +
    '<tr><td>患者の所在が、上記医療機関の所在都道府県と異なる都道府県である場合（②）</td>' +
        '<td class="r">' + kenLabel(e.diffCount) + '</td>' +
        '<td class="r">' + kenLabel(e.diffReferred) + '</td></tr>' +
    '<tr><td>全診療件数のうち、患者の所在が、上記医療機関の所在都道府県と異なる都道府県である場合の割合（②／①＋②）</td>' +
        '<td class="r"><span class="num">' + e.diffRatio.toFixed(1) + '</span> %</td>' +
        '<td class="slash"></td></tr>' +
  '</table>' +

  '<h3>2）患者の所在が、上記医療機関の所在都道府県と異なる都道府県である場合の直接の対面診療を行える体制の整備状況（具体的な医療機関名、紹介・連絡・情報提供の方法、事前合意の有無など）</h3>' +
  '<table>' +
    '<tr><th style="width:26%">都道府県名</th><th>直接の対面診療を行える体制の整備状況</th></tr>' +
    prefRows +
  '</table>' +

  '<h3>3）医師が上記医療機関外で情報通信機器を用いた診療を実施した場合</h3>' +
  '<table>' +
    '<tr><th style="width:16%">医師名</th><th style="width:12%">常勤／<br>非常勤</th>' +
        '<th style="width:28%">オンライン診療を実施した場所</th>' +
        '<th style="width:12%">都道府県</th>' +
        '<th style="width:32%">診療録等、過去の患者の状態を把握する体制</th></tr>' +
    docRows +
  '</table>' +
'</div>' +

// ============ 2ページ目 ============
'<div class="page">' +
  '<div class="code-top">医療機関コード　<span>' + tmEsc(inst.code) + '</span></div>' +

  '<h2>2　診療の件数（' + fromR + '～' + toR + '）</h2>' +
  '<table>' +
    '<tr>' +
      '<th rowspan="2" style="width:20%"></th>' +
      '<th colspan="2" style="width:26%">対面診療で実施した診療の算定件数</th>' +
      '<th colspan="2" style="width:54%;font-size:9px;">情報通信機器を用いた診療の算定件数<br>' +
        '※「初診料」と「再診料等」の合計は1の「1）患者の所在毎の情報通信機器を用いた診療実施状況」の診療件数①と②の合計と一致する必要があります。</th>' +
    '</tr>' +
    '<tr>' +
      '<th>初診料</th><th style="font-size:9px;">再診料等<br>（外来診療料を含む）</th>' +
      '<th style="font-size:9px;">初診料<br>（初診料を算定した患者の内、診療前相談を行った件数）<br>（初診料を算定した患者の内、その後自院にて対面診療を行わなかった件数）</th>' +
      '<th style="font-size:9px;">再診料等<br>（外来診療料を含む）</th>' +
    '</tr>' +
    '<tr>' +
      '<td class="c">' + fromR + 'から<br>' + toR + 'までの合計</td>' +
      '<td class="r">' + kenLabel(e.taimenShoshin) + '</td>' +
      '<td class="r">' + kenLabel(e.taimenSaishin) + '</td>' +
      '<td class="r">' + kenLabel(e.onlineShoshin) + '</td>' +
      '<td class="r">' + kenLabel(e.onlineSaishin) + '</td>' +
    '</tr>' +
    '<tr>' +
      '<td colspan="3" style="text-align:right;font-size:9px;">初診料を算定した患者の内、診療前相談を行った件数</td>' +
      '<td class="r">' + kenLabel(e.preConsult) + '</td><td></td>' +
    '</tr>' +
    '<tr>' +
      '<td colspan="3" style="text-align:right;font-size:9px;">初診料を算定した患者の内、その後自院にて対面診療を行わなかった件数</td>' +
      '<td class="r">' + kenLabel(e.noFollowUp) + '</td><td></td>' +
    '</tr>' +
  '</table>' +

  '<h2>3　診療前相談の実施状況（複数回答可）</h2>' +
  '<table><tr><td style="padding:8px 10px;line-height:2;">' +
    box(pc.series) + '　診療前相談をオンライン診療と一連として実施している<br>' +
    box(pc.separated) + '　診療前相談とオンライン診療は明確に時間を分けて実施している<br>' +
    box(pc.other) + '　その他（' + tmEsc(pc.otherText || '') + '）' +
  '</td></tr></table>' +

  '<div class="notes">' +
    '<div>〔記載上の注意〕</div>' +
    '<div>1　本報告については、前年8月1日あるいは「情報通信機器を用いた診療」に係る届出を行った以後から当年7月31日の診療実施状況を記載すること。なお、診療した実績がない場合は報告の必要はない。</div>' +
    '<div>2　「1　2）患者の所在が、上記医療機関の所在都道府県と異なる都道府県である場合の直接の対面診療を行える体制の整備状況」については、全診療件数のうち、患者の所在が、上記医療機関の所在都道府県と異なる都道府県である場合の割合が2割を超える場合に記載すること。なお、都道府県については診療件数の多い10箇所について記載すること。</div>' +
    '<div>3　「1　3）医師が上記医療機関外で情報通信機器を用いた診療を実施した場合」については、該当する全ての医師について記載すること。なお、医師が5名を超える場合は適宜行を追加して記載すること。</div>' +
    '<div>4　「2　診療の件数」のうち「対面診療で実施した診療の算定件数」については、情報通信機器を用いた診療を実施していない患者を含む全ての患者を対象として報告すること。</div>' +
  '</div>' +
'</div>' +

'<script>window.onload=function(){setTimeout(function(){window.print();},300);};<' + '/script>' +
'</body></html>';

  const w = window.open('', '_blank');
  if (!w) { alert('ポップアップがブロックされました。ブラウザの設定を確認してください。'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ============================================================
//  カルテ画面側：受診ごとのオンライン診療の記録
//  （index.html の「主訴」直下に置いたバーの読み書き）
// ============================================================
function tmVisitToggle() {
  const on = document.getElementById('tmvOnline');
  const rest = document.getElementById('tmvDetail');
  if (rest) rest.style.display = (on && on.checked) ? '' : 'none';
  if (typeof currentPatientId !== 'undefined' && currentPatientId && typeof karteData !== 'undefined' && karteData[currentPatientId]) {
    tmVisitSaveToKarte(karteData[currentPatientId]);
  }
}

// 都道府県セレクトの中身を1回だけ作る
function tmVisitInitPrefSelect() {
  const sel = document.getElementById('tmvPref');
  if (!sel || sel.options.length > 1) return;
  TM_PREFS.forEach(function (p) {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    sel.appendChild(o);
  });
}

// 画面 → karteData
function tmVisitSaveToKarte(k) {
  if (!k) return;
  const on = document.getElementById('tmvOnline');
  if (!on) return;
  k.isTelemedicine     = on.checked;
  k.telemedPatientPref = (document.getElementById('tmvPref') || {}).value || '';
  k.telemedReferred    = !!(document.getElementById('tmvReferred') || {}).checked;
  k.telemedPreConsult  = !!(document.getElementById('tmvPreConsult') || {}).checked;
}

// karteData → 画面
function tmVisitLoadFromKarte(k) {
  tmVisitInitPrefSelect();
  const on = document.getElementById('tmvOnline');
  if (!on || !k) return;
  on.checked = !!k.isTelemedicine;
  const pref = document.getElementById('tmvPref');
  if (pref) pref.value = k.telemedPatientPref || TM_CLINIC.prefName;
  const ref = document.getElementById('tmvReferred');
  if (ref) ref.checked = !!k.telemedReferred;
  const pcc = document.getElementById('tmvPreConsult');
  if (pcc) pcc.checked = !!k.telemedPreConsult;
  const rest = document.getElementById('tmvDetail');
  if (rest) rest.style.display = on.checked ? '' : 'none';
}

// karteData → visits行（supabase_client.js の toSupabaseVisit から呼ぶ）
function tmVisitFields(karteState) {
  const k = karteState || {};
  return {
    is_telemedicine:      !!k.isTelemedicine,
    telemed_patient_pref: k.isTelemedicine ? (k.telemedPatientPref || null) : null,
    telemed_referred:     !!(k.isTelemedicine && k.telemedReferred),
    telemed_pre_consult:  !!(k.isTelemedicine && k.telemedPreConsult)
  };
}
