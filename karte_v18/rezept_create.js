/* ============================================================
   レセプト作成モーダル（M3デジカル準拠レイアウト）
   2026-09-03 追加。

   ・画面レイアウトは digikar.jp の「レセプト作成」ダイアログに合わせている
     （ヘッダ緑 #0a4d12／本文背景 #f4f6f5／枠 #d2dbd8／リンク #337ab7、
       タブ 医療保険・労災・自賠責、月次/日次セレクト、診療月・請求年月日、
       社保/国保、適応症チェックの出力、結果カード、返戻再請求、月遅れ、
       フッタ キャンセル／点検用を作成／提出用を作成）
   ・従来の「押したら即UKE生成」は generateAndOpenReceipt() として温存し、
     モーダル右上の［即UKE生成］ボタンから呼べるようにしてある。
   ============================================================ */

const RZ_JOB_KEY  = 'karte_rzLastJob';
const RZ_OPTS_KEY = 'karte_rzCheckOpts';
const RZ_DOW      = ['日', '月', '火', '水', '木', '金', '土'];

let rzLastJob = null;   // { kind, period, startedAt, finishedAt, count, shaho, kokuho }

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

// 「2026-08」→「2026/8」（M3の結果カード表記に合わせる）
function rzMonthLabel(ym) {
  const parts = String(ym || '').split('-');
  return parts[0] + '/' + parseInt(parts[1], 10);
}

function rzStamp(d) {
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
         rzPad2(d.getHours()) + ':' + rzPad2(d.getMinutes()) + ':' + rzPad2(d.getSeconds());
}

// ---------- 開閉 ----------
function openRezeptCreate() {
  const el = document.getElementById('rezeptCreateModal');
  if (!el) return;

  // 初期値：診療月＝前月、請求年月日＝当月1日（M3の既定と同じ）
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

// 白いフィールドの表示テキストを更新する（M3は 2026/08 ・ 2026/09/01 (火) の表記）
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

// 日付／月ピッカーを開く（表示はM3と同じ体裁の白いボタン、実体は隠した input）
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

// ---------- 対象カルテの収集 ----------
// 既存の generateAndOpenReceipt() と同じ判定（確定済み／処方あり／傷病名あり）を
// 対象期間ぶん繰り返しているだけ。算定ロジックには一切手を入れていない。
function rzCollect() {
  const daily = document.getElementById('rzMode').value === 'daily';
  const dates = daily
    ? [document.getElementById('rzTargetDate').value]
    : rzDatesInMonth(document.getElementById('rzTargetMonth').value);

  const wantShaho  = document.getElementById('rzShaho').checked;
  const wantKokuho = document.getElementById('rzKokuho').checked;

  const normal = [], late = [];
  const seen = {};

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!d) continue;
    const list = (typeof getPatientsForDate === 'function') ? getPatientsForDate(d) : [];
    for (let j = 0; j < list.length; j++) {
      const p = list[j];
      const k = (typeof karteData !== 'undefined') ? karteData[p.id] : null;
      if (!k) continue;
      const hasContent = p.status === 'done'
        || (k.prescriptions && k.prescriptions.length > 0)
        || (k.selectedDiseases && k.selectedDiseases.length > 0);
      if (!hasContent) continue;

      const key = p.id + '|' + d;
      if (seen[key]) continue;
      seen[key] = 1;

      // 社保／国保のチェックで絞り込む
      const org = (typeof getReviewOrg === 'function') ? getReviewOrg(p.insurance) : '1';
      if (org === '1' && !wantShaho) continue;
      if (org === '2' && !wantKokuho) continue;

      const rec = { patient: p, karte: k, visitDate: d };
      // 月遅れ指定のある受診は通常ぶんから外し、月遅れセクションへ回す
      const lc = (typeof getLateClaim === 'function') ? getLateClaim(p.id, d) : null;
      if (lc) late.push({ rec: rec, late: lc }); else normal.push(rec);
    }
  }
  return { normal: normal, late: late, dates: dates };
}

// ---------- 作成 ----------
function rzRun(kind) {
  const startedAt = new Date();
  rzSaveOpts();

  const daily = document.getElementById('rzMode').value === 'daily';
  const period = daily
    ? document.getElementById('rzTargetDate').value
    : document.getElementById('rzTargetMonth').value;
  if (!period) { showToast('対象期間を指定してください'); return; }

  const picked = rzCollect();
  if (picked.normal.length === 0) {
    showToast('対象のカルテがありません（確定済みのカルテが対象です）');
    return;
  }

  const billingMonth = period.replace(/-/g, '').substring(0, 6);
  const uke = generateUKE(picked.normal, billingMonth);
  const finishedAt = new Date();

  rzLastJob = {
    kind: kind,                                   // 'check' | 'submit'
    daily: daily,
    period: period,
    periodLabel: daily ? period.replace(/-/g, '/') : rzMonthLabel(period),
    startedAt: rzStamp(startedAt),
    finishedAt: rzStamp(finishedAt),
    count: picked.normal.length,
    shaho: uke.shaho || '',
    kokuho: uke.kokuho || ''
  };
  try { localStorage.setItem(RZ_JOB_KEY, JSON.stringify(rzLastJob)); } catch (e) { console.warn('作成結果の保存に失敗:', e); }

  rzRenderResult();
  rzRenderSections();

  if (kind === 'check') {
    // 点検用はそのままレセプト点検画面へ渡す（従来と同じ導線）
    openReceiptWithUKE(uke, picked.normal.length);
  } else {
    showToast('提出用レセプトを作成しました（' + picked.normal.length + '件）→ ダウンロードできます');
  }
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
}

function rzDownload() {
  if (!rzLastJob) { showToast('先にレセプトを作成してください'); return; }
  const ym = String(rzLastJob.period || '').replace(/-/g, '');
  const tag = (rzLastJob.kind === 'submit') ? '提出用' : '点検用';
  let n = 0;
  [['社保', rzLastJob.shaho], ['国保', rzLastJob.kokuho]].forEach(function (pair) {
    if (!pair[1]) return;
    const blob = new Blob([pair[1]], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RECEIPTC_' + pair[0] + '_' + tag + '_' + ym + '.UKE';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    n++;
  });
  showToast(n > 0 ? 'UKEファイルを' + n + '件ダウンロードしました' : 'ダウンロードできるファイルがありません');
}

// ---------- 返戻再請求 / 月遅れ ----------
function rzToggleAcc(id) {
  const body = document.getElementById(id);
  const btn  = document.querySelector('[data-rzacc="' + id + '"]');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▶' : '▼';
}

function rzRenderSections() {
  // 返戻再請求：取込データを持たないため常に0件（5日以降に増える項目は後日対応）
  const hc = document.getElementById('rzHenreiCount');
  if (hc) hc.textContent = '返戻再請求（ 0 件）';

  // 月遅れ：既存の月遅れ請求設定（karte_lateClaims）から拾う
  let late = [];
  try { late = rzCollect().late; } catch (e) { late = []; }
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
    return '<div class="rzm-late-row"><span class="rzm-late-date">' + x.rec.visitDate + '</span>' +
      '<span class="rzm-late-name">' + (x.rec.patient.name || '') + '</span>' +
      '<span class="rzm-late-bm">請求月：' + (x.late.billingMonth || '-') + '</span>' +
      '<span class="rzm-late-rs">' + (x.late.reason || '') + '</span></div>';
  }).join('');
}

function rzHenreiNotice() {
  showToast('返戻オンライン請求は後日対応予定です');
}

// 従来どおりの「押したら即UKE生成」（モーダル右上のボタンから呼ぶ）
function rzQuickUKE() {
  closeRezeptCreate();
  generateAndOpenReceipt();
}
