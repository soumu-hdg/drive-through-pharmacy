/* ============================================================
   レセプト作成モーダル（旧システム準拠レイアウト）
   2026-09-03 追加 ／ 2026-09-07 拡張。

   ・画面レイアウトは旧システムの「レセプト作成」ダイアログに合わせている
     （ヘッダ緑 #0a4d12／本文背景 #f4f6f5／枠 #d2dbd8／リンク #337ab7、
       タブ 医療保険・労災・自賠責、月次/日次セレクト、診療月・請求年月日、
       社保/国保、適応症チェックの出力、結果カード、返戻再請求、月遅れ、
       フッタ キャンセル／点検用を作成／提出用を作成）
   ・従来の「押したら即UKE生成」は generateAndOpenReceipt() として温存し、
     モーダル右上の［即UKE生成］ボタンから呼べるようにしてある。

   ■ 2026-09-07 の追加（保留にしていた2点）
   1. 対象月のカルテを Supabase（visits/kartes/prescriptions/diseases_assigned）から読む。
      従来は「そのときブラウザに開いているカルテ」しか見ておらず、過去月は常に0件だった。
      月次は同一患者の同月受診を1枚に集約する（レセプトは患者ごと月1枚）。
   2. 返戻レセプト取込／返戻再請求。オンライン請求システムから落とした返戻UKEを取り込み、
      「含める／含めない」を選んで再請求ぶんのUKEを作る。診療年月は変えず請求年月だけ当月にする。
   ============================================================ */

const RZ_JOB_KEY    = 'karte_rzLastJob';
const RZ_OPTS_KEY   = 'karte_rzCheckOpts';
const RZ_HENREI_KEY = 'karte_rzHenrei';      // 取り込んだ返戻レセプト（この端末に保存）
const RZ_DOW        = ['日', '月', '火', '水', '木', '金', '土'];

let rzLastJob = null;   // { kind, period, startedAt, finishedAt, count, shaho, kokuho, henrei* }
let rzBusy = false;

// ---------- 日付ユーティリティ ----------
function rzPad2(n) { return ('0' + n).slice(-2); }

function rzPrevMonth(base) {
  const d = base ? new Date(base + 'T00:00:00') : new Date();
  if (isNaN(d)) return rzPrevMonth(null);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + '-' + rzPad2(d.getMonth() + 1);
}

function rzThisMonthFirstDay() {
  const d = new Date();
  return d.getFullYear() + '-' + rzPad2(d.getMonth() + 1) + '-01';
}

function rzDatesInMonth(ym) {
  const parts = String(ym || '').split('-');
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (!y || !m) return [];
  const last = new Date(y, m, 0).getDate();
  const out = [];
  for (let i = 1; i <= last; i++) out.push(y + '-' + rzPad2(m) + '-' + rzPad2(i));
  return out;
}

// 「2026-08」→「2026/8」（旧システムの結果カード表記に合わせる）
function rzMonthLabel(ym) {
  const parts = String(ym || '').split('-');
  return parts[0] + '/' + parseInt(parts[1], 10);
}

function rzStamp(d) {
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
         rzPad2(d.getHours()) + ':' + rzPad2(d.getMinutes()) + ':' + rzPad2(d.getSeconds());
}

function rzEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- 開閉 ----------
function openRezeptCreate() {
  const el = document.getElementById('rezeptCreateModal');
  if (!el) return;

  // 初期値：診療月＝前月、請求年月日＝当月1日（旧システムの既定と同じ）
  const month = document.getElementById('rzTargetMonth');
  const day   = document.getElementById('rzTargetDate');
  const claim = document.getElementById('rzClaimDate');
  const sel   = (typeof selectedDate !== 'undefined' && selectedDate) ? selectedDate : null;
  if (month && !month.value) month.value = rzPrevMonth(sel);
  if (day && !day.value)     day.value   = sel || new Date().toISOString().slice(0, 10);
  if (claim && !claim.value) claim.value = rzThisMonthFirstDay();

  // 適応症チェックの出力（前回の選択を復元）
  try {
    const o = JSON.parse(localStorage.getItem(RZ_OPTS_KEY) || 'null');
    if (o) {
      document.getElementById('rzChkDrug').checked = !!o.drug;
      document.getElementById('rzChkProc').checked = !!o.proc;
    }
  } catch (e) { /* 既定値のまま */ }

  // 直近の作成結果を復元
  if (!rzLastJob) {
    try { rzLastJob = JSON.parse(localStorage.getItem(RZ_JOB_KEY) || 'null'); } catch (e) { rzLastJob = null; }
  }

  rzOnModeChange();
  rzSyncFieldTexts();
  rzRenderResult();
  rzRenderSections();
  el.classList.add('show');
}

function closeRezeptCreate() {
  const el = document.getElementById('rezeptCreateModal');
  if (el) el.classList.remove('show');
}

function rzSwitchTab(name) {
  document.querySelectorAll('#rezeptCreateModal .rzm-tabs li').forEach(function (li) {
    li.classList.toggle('active', li.getAttribute('data-rztab') === name);
  });
  ['hoken', 'rousai', 'jibai'].forEach(function (n) {
    const p = document.getElementById('rzPane_' + n);
    if (p) p.style.display = (n === name) ? '' : 'none';
  });
  const foot = document.getElementById('rzFootActions');
  if (foot) foot.style.visibility = (name === 'hoken') ? 'visible' : 'hidden';
}

// 月次 ⇔ 日次でラベルと入力欄を差し替える
function rzOnModeChange() {
  const daily = document.getElementById('rzMode').value === 'daily';
  document.getElementById('rzPeriodLabel').textContent = daily ? '診療日' : '診療月';
  document.getElementById('rzTargetMonthWrap').style.display = daily ? 'none' : 'inline-flex';
  document.getElementById('rzTargetDateWrap').style.display  = daily ? 'inline-flex' : 'none';
  rzSyncFieldTexts();
  rzRenderSections();
}

// 白いフィールドの表示テキストを更新する（旧システムは 2026/08 ・ 2026/09/01 (火) の表記）
function rzSyncFieldTexts() {
  const m = document.getElementById('rzTargetMonth').value;
  document.getElementById('rzTargetMonthTxt').textContent = m ? m.replace('-', '/') : '----/--';

  const t = document.getElementById('rzTargetDate').value;
  document.getElementById('rzTargetDateTxt').textContent = t ? t.replace(/-/g, '/') : '----/--/--';

  const c = document.getElementById('rzClaimDate').value;
  let txt = '----/--/--';
  if (c) {
    const d = new Date(c + 'T00:00:00');
    txt = c.replace(/-/g, '/') + (isNaN(d) ? '' : ' (' + RZ_DOW[d.getDay()] + ')');
  }
  document.getElementById('rzClaimDateTxt').textContent = txt;
}

function rzOnFieldChange() {
  rzSyncFieldTexts();
  rzRenderSections();
}

// 日付／月ピッカーを開く（表示は旧システムと同じ体裁の白いボタン、実体は隠した input）
function rzPick(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof el.showPicker === 'function') {
    try { el.showPicker(); return; } catch (e) { /* フォールバックへ */ }
  }
  // showPicker() が使えない環境では入力欄そのものを出して編集できるようにする
  el.classList.remove('rzm-hidden-input');
  el.classList.add('rzm-date-input-fallback');
  const btn = el.parentElement ? el.parentElement.querySelector('button') : null;
  if (btn) btn.style.display = 'none';
  el.focus();
}

function rzSaveOpts() {
  try {
    localStorage.setItem(RZ_OPTS_KEY, JSON.stringify({
      drug: document.getElementById('rzChkDrug').checked,
      proc: document.getElementById('rzChkProc').checked
    }));
  } catch (e) { console.warn('適応症チェック設定の保存に失敗:', e); }
}

// ============================================================
// 対象カルテの収集
//   ① 画面で開いているカルテ（従来どおり）
//   ② Supabase の visits（2026-09-07 追加。過去月がここにしか無いため）
//   同じ患者・同じ日が両方にある場合は①を優先する（医師が今いじっている値が最新）。
// ============================================================

// 判定は従来の generateAndOpenReceipt() と同じ（確定済み／処方あり／傷病名あり）。
function rzHasContent(status, k) {
  return status === 'done'
    || (k && k.prescriptions && k.prescriptions.length > 0)
    || (k && k.selectedDiseases && k.selectedDiseases.length > 0);
}

function rzCollectScreen(dates) {
  const out = [];
  const seen = {};
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!d) continue;
    const list = (typeof getPatientsForDate === 'function') ? getPatientsForDate(d) : [];
    for (let j = 0; j < list.length; j++) {
      const p = list[j];
      const k = (typeof karteData !== 'undefined') ? karteData[p.id] : null;
      if (!k) continue;
      if (!rzHasContent(p.status, k)) continue;
      const key = p.id + '|' + d;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ patient: p, karte: k, visitDate: d, src: 'screen' });
    }
  }
  return out;
}

// 保険種別の文字列から負担割合を推定（DBの copay_rate が空のとき用）
function rzRatioFromInsurance(ins) {
  const s = String(ins || '');
  if (s.indexOf('1割') !== -1) return 0.1;
  if (s.indexOf('2割') !== -1) return 0.2;
  if (s.indexOf('公費') !== -1) return 0;
  return 0.3;
}

// 薬品名 → 薬価・薬価基準コード。院内プリセット → 医薬品マスタ の順に引く。
function rzResolveDrug(name) {
  const nm = String(name || '');
  if (typeof drugs !== 'undefined' && Array.isArray(drugs)) {
    const hit = drugs.find(function (d) { return d.name === nm; });
    if (hit) return hit;
  }
  let price = null, code = null;
  if (typeof MasterLoader !== 'undefined') {
    try {
      if (MasterLoader.getDrugPriceByName) price = MasterLoader.getDrugPriceByName(nm);
      if (MasterLoader.getDrugCodeByName)  code  = MasterLoader.getDrugCodeByName(nm);
    } catch (e) { /* マスタ未ロード時は薬価0で通す（点数検算の警告で気付ける） */ }
  }
  return { id: '', name: nm, price: price || 0, unit: 'T', code: code || '' };
}

// visits の1行 → generateUKE が受け取る { patient, karte, visitDate }
function rzDbRecord(v) {
  const pt = v.patients || {};
  const k  = (Array.isArray(v.kartes) ? v.kartes[0] : v.kartes) || {};
  const rx = (v.prescriptions || []).slice().sort(function (a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
  const dx = v.diseases_assigned || [];

  const insurance = pt.insurance_type || '社保3割';
  const ratio = (pt.copay_rate === null || pt.copay_rate === undefined || pt.copay_rate === '')
    ? rzRatioFromInsurance(insurance) : Number(pt.copay_rate);
  const rxDays = k.rx_days || 7;

  const patient = {
    id: pt.patient_no || '',
    name: String(pt.name || '').trim(),
    sex: String(pt.sex || '').replace(/性$/, ''),
    dob: pt.dob ? String(pt.dob).slice(0, 10) : '',
    insurance: insurance,
    ratio: isNaN(ratio) ? 0.3 : ratio,
    insurerNumber: pt.insurer_number || '',
    insSymbol: pt.ins_symbol || '',
    insNumber: pt.ins_number || '',
    insuranceNumber: '',
    arrivedAt: String(v.visit_time || v.arrived_at || '').slice(0, 8),
    status: v.status || 'none',
    dbSource: true
  };
  const karte = {
    prescriptions: rx.map(function (r) {
      return { drug: rzResolveDrug(r.drug_name), qty: Number(r.quantity) || 1, days: r.days || rxDays, note: r.note || '' };
    }),
    selectedDiseases: dx.map(function (d) { return { name: d.disease_name || '', code: d.disease_code || '' }; }),
    isFirstVisit: (k.is_first_visit !== undefined && k.is_first_visit !== null) ? !!k.is_first_visit : (v.visit_type === '新規'),
    rxDays: rxDays,
    addedBillingItems: [],
    excludedBillingRows: {},
    selectedExams: [],
    dbSource: true
  };
  return { patient: patient, karte: karte, visitDate: String(v.visit_date).slice(0, 10), src: 'db' };
}

// 対象期間の受診をSupabaseから取得する
async function rzFetchFromDb(fromDate, toDate) {
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
    return { ok: false, reason: 'Supabase未接続', records: [] };
  }
  try {
    const { data, error } = await supabaseClient
      .from('visits')
      .select('id,visit_date,visit_time,arrived_at,visit_type,status,patients(*),kartes(*),prescriptions(*),diseases_assigned(*)')
      .gte('visit_date', fromDate)
      .lte('visit_date', toDate)
      .order('visit_date');
    if (error) {
      console.error('[レセプト作成] DB取得エラー:', error);
      return { ok: false, reason: error.message || 'DB取得エラー', records: [] };
    }
    const recs = [];
    (data || []).forEach(function (v) {
      const r = rzDbRecord(v);
      if (!rzHasContent(r.patient.status, r.karte)) return;   // 画面と同じ条件で絞る
      recs.push(r);
    });
    return { ok: true, records: recs };
  } catch (e) {
    console.error('[レセプト作成] DB取得例外:', e);
    return { ok: false, reason: String(e && e.message || e), records: [] };
  }
}

// 画面ぶん＋DBぶんをまとめ、社保/国保のチェックと月遅れ指定で振り分ける
async function rzCollect(useDb) {
  const daily = document.getElementById('rzMode').value === 'daily';
  const dates = daily
    ? [document.getElementById('rzTargetDate').value]
    : rzDatesInMonth(document.getElementById('rzTargetMonth').value);

  const wantShaho  = document.getElementById('rzShaho').checked;
  const wantKokuho = document.getElementById('rzKokuho').checked;

  let all = rzCollectScreen(dates);
  let dbInfo = null;

  if (useDb && dates.length > 0) {
    dbInfo = await rzFetchFromDb(dates[0], dates[dates.length - 1]);
    const seen = {};
    all.forEach(function (r) { seen[(r.patient.id || r.patient.name) + '|' + r.visitDate] = 1; });
    dbInfo.records.forEach(function (r) {
      const key = (r.patient.id || r.patient.name) + '|' + r.visitDate;
      if (seen[key]) return;      // 画面のカルテを優先
      seen[key] = 1;
      all.push(r);
    });
  }

  const normal = [], late = [];
  all.forEach(function (rec) {
    const org = (typeof getReviewOrg === 'function') ? getReviewOrg(rec.patient.insurance) : '1';
    if (org === '1' && !wantShaho) return;
    if (org === '2' && !wantKokuho) return;
    const lc = (typeof getLateClaim === 'function') ? getLateClaim(rec.patient.id, rec.visitDate) : null;
    if (lc) late.push({ rec: rec, late: lc }); else normal.push(rec);
  });

  return { normal: normal, late: late, dates: dates, daily: daily, db: dbInfo };
}

// ============================================================
// 作成
// ============================================================
async function rzRun(kind) {
  if (rzBusy) return;
  const startedAt = new Date();
  rzSaveOpts();

  const daily = document.getElementById('rzMode').value === 'daily';
  const period = daily
    ? document.getElementById('rzTargetDate').value
    : document.getElementById('rzTargetMonth').value;
  if (!period) { showToast('対象期間を指定してください'); return; }

  rzSetBusy(true, kind === 'submit' ? '提出用を作成中…' : '点検用を作成中…');
  let picked;
  try {
    picked = await rzCollect(true);
  } finally {
    rzSetBusy(false);
  }

  const henrei = rzHenreiIncluded();
  if (picked.normal.length === 0 && henrei.length === 0) {
    const dbNg = picked.db && !picked.db.ok ? '（DB: ' + picked.db.reason + '）' : '';
    showToast('対象のカルテがありません（確定済み／処方／傷病名のあるカルテが対象です）' + dbNg);
    return;
  }

  const billingMonth = period.replace(/-/g, '').substring(0, 6);
  // 月次は「1患者＝1枚」に集約する。日次は従来どおり受診ごと。
  const uke = picked.normal.length
    ? generateUKE(picked.normal, billingMonth, { aggregate: !daily })
    : {};

  // 返戻の再請求ぶん（含める にした行）。診療年月は変えず、請求年月だけ当月にする。
  const resub = rzBuildResubmitUKE(henrei);
  const finishedAt = new Date();

  rzLastJob = {
    kind: kind,                                   // 'check' | 'submit'
    daily: daily,
    period: period,
    periodLabel: daily ? period.replace(/-/g, '/') : rzMonthLabel(period),
    startedAt: rzStamp(startedAt),
    finishedAt: rzStamp(finishedAt),
    count: picked.normal.length,
    fromDb: picked.db && picked.db.ok ? picked.normal.filter(function (r) { return r.src === 'db'; }).length : 0,
    shaho: uke.shaho || '',
    kokuho: uke.kokuho || '',
    henreiCount: henrei.length,
    henreiShaho: resub.shaho || '',
    henreiKokuho: resub.kokuho || ''
  };
  try { localStorage.setItem(RZ_JOB_KEY, JSON.stringify(rzLastJob)); } catch (e) { console.warn('作成結果の保存に失敗:', e); }

  // 「最後に含めた日時」を更新（旧システムと同じ挙動）
  if (henrei.length) rzHenreiMarkIncluded(henrei, finishedAt);

  rzRenderResult();
  rzRenderSections();

  if (kind === 'check') {
    // 点検用はそのままレセプト点検画面へ渡す（従来と同じ導線）。返戻ぶんは返戻タブに入る。
    openReceiptWithUKE({
      shaho: uke.shaho, kokuho: uke.kokuho,
      shahoHenrei: resub.shaho, kokuhoHenrei: resub.kokuho
    }, picked.normal.length + henrei.length);
  } else {
    showToast('提出用レセプトを作成しました（通常 ' + picked.normal.length + '件' +
      (henrei.length ? ' ／ 返戻再請求 ' + henrei.length + '件' : '') + '）→ ダウンロードできます');
  }
}

function rzSetBusy(on, msg) {
  rzBusy = !!on;
  const foot = document.getElementById('rzFootActions');
  if (foot) foot.querySelectorAll('button').forEach(function (b) { b.disabled = !!on; });
  const st = document.getElementById('rzStatus');
  if (st) st.textContent = on ? (msg || '処理中…') : '';
}

function rzRenderResult() {
  const card = document.getElementById('rzResult');
  if (!card) return;
  if (!rzLastJob) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('rzResultTitle').textContent =
    (rzLastJob.kind === 'submit' ? '提出用レセプト' : '点検用レセプト');
  document.getElementById('rzResultMonth').textContent =
    (rzLastJob.daily ? '診療日：' : '診療月：') + rzLastJob.periodLabel;
  document.getElementById('rzResultStart').textContent = '作成開始：' + rzLastJob.startedAt;
  document.getElementById('rzResultEnd').textContent   = '完了：' + rzLastJob.finishedAt;
  const cnt = document.getElementById('rzResultCount');
  if (cnt) {
    cnt.textContent = '通常 ' + (rzLastJob.count || 0) + '件' +
      (rzLastJob.fromDb ? '（うちDB ' + rzLastJob.fromDb + '件）' : '') +
      (rzLastJob.henreiCount ? ' ／ 返戻再請求 ' + rzLastJob.henreiCount + '件' : '');
  }
}

function rzDownload() {
  if (!rzLastJob) { showToast('先にレセプトを作成してください'); return; }
  const ym = String(rzLastJob.period || '').replace(/-/g, '');
  const tag = (rzLastJob.kind === 'submit') ? '提出用' : '点検用';
  let n = 0;
  const files = [
    ['RECEIPTC_社保_' + tag + '_' + ym + '.UKE', rzLastJob.shaho],
    ['RECEIPTC_国保_' + tag + '_' + ym + '.UKE', rzLastJob.kokuho],
    ['RECEIPTC_返戻再請求_社保_' + rzClaimYm() + '.UKE', rzLastJob.henreiShaho],
    ['RECEIPTC_返戻再請求_国保_' + rzClaimYm() + '.UKE', rzLastJob.henreiKokuho]
  ];
  files.forEach(function (pair) {
    if (!pair[1]) return;
    const blob = new Blob([pair[1]], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pair[0];
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    n++;
  });
  showToast(n > 0 ? 'UKEファイルを' + n + '件ダウンロードしました' : 'ダウンロードできるファイルがありません');
}

// ============================================================
// 返戻レセプト取込／返戻再請求（2026-09-07）
//   オンライン請求システムから落とした返戻ファイル（レセ電形式）を読み込む。
//   返戻レコードは各行の先頭に "8,行番号,0," が付くのでそれを外して解釈する。
// ============================================================

function rzHenreiLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(RZ_HENREI_KEY) || 'null');
    if (o && Array.isArray(o.items)) return o;
  } catch (e) { /* 壊れていたら作り直す */ }
  return { items: [] };
}

function rzHenreiSave(store) {
  try { localStorage.setItem(RZ_HENREI_KEY, JSON.stringify(store)); }
  catch (e) { showToast('返戻データの保存に失敗しました（容量超過の可能性）'); }
}

function rzHenreiIncluded() {
  return rzHenreiLoad().items.filter(function (x) { return x.include; });
}

function rzHenreiOpenPicker() {
  const el = document.getElementById('rzHenreiFile');
  if (el) { el.value = ''; el.click(); }
}

// Shift_JIS優先で読む（レセ電ファイルはSJIS。UTF-8で保存し直した物にも対応）
function rzReadFile(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function (e) {
      let text;
      try { text = new TextDecoder('shift_jis', { fatal: true }).decode(e.target.result); }
      catch (err) { text = new TextDecoder('utf-8').decode(e.target.result); }
      resolve(text);
    };
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

// 保険種別コード（RE[2]）→ 表示名。旧システムの「後期」「協会」等の欄に相当。
function rzInsLabel(code) {
  const c = String(code || '');
  if (c.length < 2) return c || '—';
  const d1 = c[1];
  let s = d1 === '1' ? '社保' : d1 === '2' ? '公費' : d1 === '3' ? '国保'
        : d1 === '4' ? '退職' : d1 === '6' ? '後期' : '保険(' + d1 + ')';
  const d2 = c[2];
  if (d2 === '1') s += ' 本人';
  else if (d2 === '2') s += ' 未就学';
  else if (d2 === '3') s += ' 家族';
  return s;
}

function rzYmSlash(ym) {
  const s = String(ym || '');
  return s.length >= 6 ? s.slice(0, 4) + '/' + s.slice(4, 6) : (s || '—');
}

// 返戻UKEテキストを1件ずつに分解する
function rzParseHenreiText(text, fileName) {
  const lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  const items = [];
  const hrs = [];
  let org = '1';
  let irLine = '';
  let cur = null;

  lines.forEach(function (line) {
    const m = line.match(/^\d+,\d+,\d+,(.+)$/);
    if (m) line = m[1];                       // 返戻の "8,seq,0," プレフィックスを外す
    const f = line.split(',');
    switch (f[0]) {
      case 'IR':
        org = f[1] || '1';
        irLine = line;
        cur = null;
        break;
      case 'RE':
        cur = {
          key: '',
          org: org,
          fileName: fileName,
          seq: f[1] || '',
          insCode: f[2] || '',
          ym: f[3] || '',                     // 診療年月（返戻はここが元の診療月）
          name: f[4] || '',
          sex: f[5] || '',
          dob: f[6] || '',
          patientNo: f[13] || '',
          uketsuke: f[18] || '',
          points: 0,
          days: [],
          reasonCode: '',
          reasonText: '',
          include: true,                      // 旧システムの既定は「含める」
          lastIncludedAt: '',
          raw: [line]
        };
        items.push(cur);
        break;
      case 'HO':
        if (cur) { cur.points = parseInt(f[5], 10) || cur.points; cur.raw.push(line); }
        break;
      case 'KO':
        if (cur) { if (!cur.points) cur.points = parseInt(f[5], 10) || 0; cur.raw.push(line); }
        break;
      case 'JD':
        if (cur) {
          for (let i = 2; i <= 32; i++) if (f[i]) cur.days.push(i - 1);
          cur.raw.push(line);
        }
        break;
      case 'HR':
        // HR,処理年月,区分,,理由コード,理由テキスト,,,,受付番号
        hrs.push({ code: f[4] || '', text: f[5] || '', uketsuke: f[9] || '' });
        break;
      case 'GO':
        cur = null;
        break;
      default:
        if (cur) cur.raw.push(line);
        break;
    }
  });

  // 返戻理由（HR）を受付番号で突合
  if (hrs.length) {
    const byU = {};
    items.forEach(function (x) { if (x.uketsuke) byU[x.uketsuke] = x; });
    hrs.forEach(function (h) {
      const t = h.uketsuke && byU[h.uketsuke];
      if (t) { t.reasonCode = h.code; t.reasonText = h.text; }
    });
  }

  items.forEach(function (x) {
    x.irLine = irLine;
    x.key = x.org + '|' + (x.uketsuke || '') + '|' + (x.patientNo || '') + '|' + x.ym + '|' + x.name;
  });
  return items;
}

async function rzHenreiOnFiles(ev) {
  const files = ev && ev.target && ev.target.files ? Array.prototype.slice.call(ev.target.files) : [];
  if (!files.length) return;
  const store = rzHenreiLoad();
  const known = {};
  store.items.forEach(function (x) { known[x.key] = x; });

  let added = 0, dup = 0, bad = 0;
  for (const file of files) {
    let text = '';
    try { text = await rzReadFile(file); } catch (e) { bad++; continue; }
    const parsed = rzParseHenreiText(text, file.name);
    if (!parsed.length) { bad++; continue; }
    parsed.forEach(function (x) {
      if (known[x.key]) {
        // 同じ返戻を読み直したら中身だけ更新し、「含める」の選択は残す
        const prev = known[x.key];
        x.include = prev.include;
        x.lastIncludedAt = prev.lastIncludedAt;
        Object.assign(prev, x);
        dup++;
        return;
      }
      x.importedAt = rzStamp(new Date());
      known[x.key] = x;
      store.items.push(x);
      added++;
    });
  }

  rzHenreiSave(store);
  rzRenderSections();
  showToast('返戻レセプトを取り込みました（新規' + added + '件' +
    (dup ? '／更新' + dup + '件' : '') + (bad ? '／読めないファイル' + bad + '件' : '') + '）');
}

function rzHenreiSetInclude(key, val) {
  const store = rzHenreiLoad();
  const t = store.items.find(function (x) { return x.key === key; });
  if (!t) return;
  t.include = (val === '1' || val === true);
  rzHenreiSave(store);
  rzRenderSections();
}

function rzHenreiDelete(key) {
  const store = rzHenreiLoad();
  const t = store.items.find(function (x) { return x.key === key; });
  if (!t) return;
  if (!confirm('この返戻レセプトを一覧から削除します。\n' + (t.name || '') + '（' + rzYmSlash(t.ym) + '）\nよろしいですか？')) return;
  store.items = store.items.filter(function (x) { return x.key !== key; });
  rzHenreiSave(store);
  rzRenderSections();
}

function rzHenreiDeleteAll() {
  const store = rzHenreiLoad();
  if (!store.items.length) { showToast('取り込んだ返戻レセプトはありません'); return; }
  if (!confirm('取り込んだ返戻レセプト ' + store.items.length + '件をすべて削除します。よろしいですか？')) return;
  rzHenreiSave({ items: [] });
  rzRenderSections();
}

// 返戻ぶんを点検ビューアーで開く（社保・国保それぞれ1本にまとめて渡す）
function rzHenreiViewer() {
  const items = rzHenreiLoad().items;
  if (!items.length) { showToast('先に［返戻レセプト取込］で返戻ファイルを読み込んでください'); return; }
  const built = rzBuildResubmitUKE(items, true);   // 全件・請求年月はそのまま
  openReceiptWithUKE({ shahoHenrei: built.shaho, kokuhoHenrei: built.kokuho }, items.length);
}

function rzClaimYm() {
  const c = document.getElementById('rzClaimDate');
  const v = c && c.value ? c.value.replace(/-/g, '') : '';
  if (v.length >= 6) return v.slice(0, 6);
  const d = new Date();
  return String(d.getFullYear()) + rzPad2(d.getMonth() + 1);
}

/**
 * 返戻ぶんのUKEを組み立てる。
 * ★診療年月（REレコード）は変えない。請求年月（IR[7]）だけを当月にする＝月遅れ・返戻の再請求は診療月のまま。
 * @param {array} items   対象の返戻レセプト
 * @param {boolean} keepYm true なら請求年月も元のまま（ビューアーで見るだけのとき）
 */
function rzBuildResubmitUKE(items, keepYm) {
  const out = {};
  ['1', '2'].forEach(function (org) {
    const list = (items || []).filter(function (x) { return x.org === org; });
    if (!list.length) return;
    const lines = [];
    let ir = (list[0].irLine || '').split(',');
    if (!ir.length || ir[0] !== 'IR') ir = ['IR', org, '13', '1', '1312345678', '', 'デモクリニック', '', '', ''];
    if (!keepYm && ir.length > 7) ir[7] = rzClaimYm();
    lines.push(ir.join(','));

    let seq = 1, total = 0;
    list.forEach(function (x) {
      (x.raw || []).forEach(function (line, i) {
        if (i === 0) {
          const f = line.split(',');
          f[1] = String(seq);                    // 連番だけ振り直す（内容は返戻データのまま）
          lines.push(f.join(','));
        } else {
          lines.push(line);
        }
      });
      total += x.points || 0;
      seq++;
    });
    lines.push(['GO', String(list.length), String(total), '99'].join(','));
    out[org === '1' ? 'shaho' : 'kokuho'] = lines.join('\r\n') + '\r\n';
  });
  return out;
}

function rzHenreiMarkIncluded(items, when) {
  const store = rzHenreiLoad();
  const stamp = rzStamp(when || new Date());
  const keys = {};
  items.forEach(function (x) { keys[x.key] = 1; });
  store.items.forEach(function (x) { if (keys[x.key]) x.lastIncludedAt = stamp; });
  rzHenreiSave(store);
}

// 返戻の診療日表示：JDの受診日から先頭を採る。無ければ診療年月だけ出す。
function rzHenreiDateLabel(x) {
  const ym = rzYmSlash(x.ym);
  if (!x.days || !x.days.length) return ym;
  return ym + '/' + rzPad2(Math.min.apply(null, x.days));
}

// ---------- 返戻再請求 / 月遅れ の描画 ----------
function rzToggleAcc(id) {
  const body = document.getElementById(id);
  const btn  = document.querySelector('[data-rzacc="' + id + '"]');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▶' : '▼';
}

function rzRenderSections() {
  // ---- 返戻再請求 ----
  const items = rzHenreiLoad().items;
  const hc = document.getElementById('rzHenreiCount');
  if (hc) hc.textContent = '返戻再請求（ ' + items.length + ' 件）';

  const hbox = document.getElementById('rzHenreiBody');
  if (hbox) {
    if (!items.length) {
      hbox.className = 'rzm-box';
      hbox.innerHTML = '返戻再請求するカルテはありません。' +
        '<span class="rzm-note">［返戻レセプト取込］からオンライン請求システムの返戻ファイル（.UKE）を読み込みます。</span>';
    } else {
      hbox.className = 'rzm-box rzm-box-table';
      const rows = items.map(function (x) {
        return '<tr>' +
          '<td>' + rzEsc(x.patientNo || '—') + '</td>' +
          '<td>' + rzEsc(x.name) + '</td>' +
          '<td>' + rzEsc(rzHenreiDateLabel(x)) + '</td>' +
          '<td>' + rzEsc(rzInsLabel(x.insCode)) + '</td>' +
          '<td>オンライン</td>' +
          '<td><select class="rzm-mini-select" onchange="rzHenreiSetInclude(\'' + rzEsc(x.key) + '\', this.value)">' +
            '<option value="0"' + (x.include ? '' : ' selected') + '>含めない</option>' +
            '<option value="1"' + (x.include ? ' selected' : '') + '>含める</option>' +
          '</select></td>' +
          '<td>' + rzEsc(x.lastIncludedAt || '') + '</td>' +
          '<td class="rzm-td-act"><button class="rzm-icon" title="この返戻を削除" onclick="rzHenreiDelete(\'' + rzEsc(x.key) + '\')">🗑</button></td>' +
          '</tr>' +
          (x.reasonText ? '<tr class="rzm-reason-row"><td colspan="8">返戻理由：' +
            rzEsc((x.reasonCode ? x.reasonCode + ' ' : '') + x.reasonText) + '</td></tr>' : '');
      }).join('');
      hbox.innerHTML =
        '<table class="rzm-table"><thead><tr>' +
          '<th style="width:120px;">患者番号</th><th style="width:141px;">氏名</th>' +
          '<th style="width:120px;">診療日</th><th style="width:159px;">保険種類</th>' +
          '<th style="width:120px;">請求方法</th><th style="width:120px;">レセプト請求</th>' +
          '<th style="width:137px;">最後に含めた日時</th>' +
          '<th style="width:63px;text-align:right;"><button class="rzm-icon" title="取り込んだ返戻をすべて削除" onclick="rzHenreiDeleteAll()">🗑</button></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
  }

  // ---- 月遅れ（既存の月遅れ請求設定 karte_lateClaims から拾う。画面ぶんのみ・DBは見ない）----
  const daily = document.getElementById('rzMode').value === 'daily';
  const dates = daily
    ? [document.getElementById('rzTargetDate').value]
    : rzDatesInMonth(document.getElementById('rzTargetMonth').value);
  let late = [];
  try {
    late = rzCollectScreen(dates).map(function (rec) {
      const lc = (typeof getLateClaim === 'function') ? getLateClaim(rec.patient.id, rec.visitDate) : null;
      return lc ? { rec: rec, late: lc } : null;
    }).filter(Boolean);
  } catch (e) { late = []; }

  const lc = document.getElementById('rzLateCount');
  if (lc) lc.textContent = '月遅れ（ ' + late.length + ' 件）';

  const box = document.getElementById('rzLateBody');
  if (!box) return;
  if (late.length === 0) {
    box.className = 'rzm-box';
    box.textContent = '月遅れするカルテはありません。';
    return;
  }
  box.className = 'rzm-box rzm-box-list';
  box.innerHTML = late.map(function (x) {
    return '<div class="rzm-late-row"><span class="rzm-late-date">' + rzEsc(x.rec.visitDate) + '</span>' +
      '<span class="rzm-late-name">' + rzEsc(x.rec.patient.name || '') + '</span>' +
      '<span class="rzm-late-bm">請求月：' + rzEsc(x.late.billingMonth || '-') + '</span>' +
      '<span class="rzm-late-rs">' + rzEsc(x.late.reason || '') + '</span></div>';
  }).join('');
}

// 従来どおりの「押したら即UKE生成」（モーダル右上のボタンから呼ぶ）
function rzQuickUKE() {
  closeRezeptCreate();
  generateAndOpenReceipt();
}
