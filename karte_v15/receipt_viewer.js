// ===== レセプト点検ビューア (receipt_viewer.js) =====
// UKEパーサー + UI制御

// ★v0.14 「要対応」警告 = 高・中のみ。低(摘要確認リマインド・検算差・マスタ未登録等)は
//   参考情報として詳細には出すが、一覧の行ハイライト/件数/タブ数には数えない（査定に効く信号のノイズ化を防ぐ）。
function isActionable(w) { return w && (w.severity === 'high' || w.severity === 'mid'); }

// XSS protection
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ===== State =====
let allReceipts = { shaho: [], kokuho: [], shahoHenrei: [], kokuhoHenrei: [] };
let institution = {};
let currentTab = 'shaho';
let currentFilter = 'all';
let currentView = 'list'; // 'list' | 'detail' | 'checklist'
let currentDetailIdx = -1;
let sortCol = null;
let sortAsc = true;

// ===== UKE Parser =====
function parseUKE(text, fileType) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const receipts = [];
  const henreiRecords = []; // ★v0.15 返戻HRレコード（受付番号でRE突合、全件走査後にマッチ）
  let currentReceipt = null;
  let currentCategory = '';
  const isHenrei = fileType.includes('henrei');

  for (let line of lines) {
    // 返戻レコードは先頭に "8,line,flag," プレフィックスが付く
    let fields;
    if (/^\d+,\d+,\d+,/.test(line)) {
      const m = line.match(/^\d+,\d+,\d+,(.+)$/);
      if (m) line = m[1];
      else continue;
    }
    fields = line.split(',');
    const recType = fields[0];

    switch (recType) {
      case 'IR':
        institution = {
          reviewOrg: fields[1], // 1=社保, 2=国保
          prefecture: fields[2],
          tensu: fields[3],
          code: fields[4],
          name: fields[6],
          billingMonth: fields[7],
          phone: fields[9]
        };
        break;

      case 'RE':
        if (currentReceipt) receipts.push(currentReceipt);
        currentCategory = '';
        currentReceipt = {
          seq: parseInt(fields[1]) || 0,
          insuranceTypeCode: fields[2] || '',
          insuranceType: parseInsuranceType(fields[2]),
          billingMonth: fields[3] || '',
          name: fields[4] || '',
          sex: fields[5] === '1' ? '男' : fields[5] === '2' ? '女' : '',
          dob: fields[6] || '',
          copayRatio: fields[7] || '',
          // ★v0.13修正: RE[11]=特記事項, RE[13]=カルテ番号（旧v0.12は両者を取り違えていた）
          tokki: fields[11] || '',
          karteNumber: fields[13] || '',
          uketsukeNumber: fields[18] || '', // 受付番号（返戻HRレコードとの突合キー・v0.15）
          henreiReason: null,               // 返戻理由（HRから後段で付与）
          // 総点数はREには無い。HO[5]（公費単独はKO[5]）から後段で設定する
          totalPoints: 0,
          jitsuNissu: 0,
          nameKana: '',
          insurance: null,
          kouhi: [],
          diseases: [],
          procedures: [],
          comments: [],
          visitDays: [],
          warnings: [],
          isHenrei: isHenrei,
          fileType: fileType,
          _raw: line
        };
        // Find kana name (usually near end of RE record)
        for (let i = fields.length - 1; i > 20; i--) {
          if (fields[i] && /^[\u30A0-\u30FF\u3040-\u309F]+$/.test(fields[i])) {
            currentReceipt.nameKana = fields[i];
            break;
          }
        }
        break;

      case 'HO':
        if (currentReceipt) {
          // ★v0.13修正: HO[4]=診療実日数, HO[5]=合計点数（総点数の正）, HO[6]=一部負担金
          //   旧v0.12は HO[5]（=合計点数）を一部負担金として誤読していた
          currentReceipt.insurance = {
            insurerNumber: (fields[1] || '').trim(),
            symbol: fields[2] || '',
            insuredNumber: fields[3] || '',
            copayAmount: parseInt(fields[6]) || 0
          };
          currentReceipt.jitsuNissu = parseInt(fields[4]) || 0;
          currentReceipt.totalPoints = parseInt(fields[5]) || 0;
        }
        break;

      case 'KO':
        if (currentReceipt) {
          // KO[4]=実日数, KO[5]=合計点数, KO[6]=一部負担金（HOと同構造）
          const koPts = parseInt(fields[5]) || 0;
          const koJitsu = parseInt(fields[4]) || 0;
          currentReceipt.kouhi.push({
            futanshaNumber: fields[1] || '',
            jukyushaNumber: fields[2] || '',
            jitsuNissu: koJitsu,
            points: koPts,
            copayAmount: parseInt(fields[6]) || 0
          });
          // 公費単独（HOなし）の場合はKOから総点数・実日数を採用
          if (!currentReceipt.totalPoints && koPts) currentReceipt.totalPoints = koPts;
          if (!currentReceipt.jitsuNissu && koJitsu) currentReceipt.jitsuNissu = koJitsu;
        }
        break;

      case 'SY':
        if (currentReceipt) {
          const diseaseCode = fields[1] || '';
          const modifierCode = fields[4] || '';
          let name = MasterLoader.getDiseaseName(diseaseCode) || DISEASE_CODES[diseaseCode] || '';
          const modName = MasterLoader.getModifierName(modifierCode) || MODIFIER_CODES[modifierCode] || '';
          if (modifierCode && modName) {
            name += '（' + modName + '）';
          }
          currentReceipt.diseases.push({
            code: diseaseCode,
            name: name,
            startDate: fields[2] || '',
            outcomeFlag: fields[3] || '',
            modifier: modifierCode,
            isPrimary: fields[6] === '01'
          });
        }
        break;

      case 'SI':
        if (currentReceipt) {
          const cat = fields[1] || '';
          if (cat) currentCategory = cat;
          const code = fields[3] || '';
          const pts = parseInt(fields[5]) || 0;
          const qty = parseInt(fields[6]) || 0;
          // ★v0.13修正: 算定日情報は fields[13..43] が日1..31の回数 (day = fieldIndex - 12)。
          //   実UKE全140件で「算定日⊆JD受診日」100%一致を検証（旧di-11は1日ズレ）
          const siDays = [];
          for (let di = 13; di <= 43 && di < fields.length; di++) {
            const dv = fields[di];
            if (dv && dv !== '0') siDays.push(di - 12);
          }
          currentReceipt.procedures.push({
            category: currentCategory,
            categoryName: CATEGORY_NAMES[currentCategory] || currentCategory,
            code: code,
            name: MasterLoader.getProcedureName(code) || PROCEDURE_CODES[code] || '',
            points: pts,
            quantity: qty,
            count: qty, // 回数(fields[6])。SIは数量欄が空で回数=fields[6]＝検算の乗数
            days: siDays,
            _raw: line
          });
        }
        break;

      case 'IY':
        if (currentReceipt) {
          // ★v0.13修正: IYはSIと同構造。fields[1]=診療識別, [2]=負担区分,
          //   [3]=医薬品コード, [4]=数量, [5]=点数, [6]=回数, [13..43]=算定日
          //   （旧v0.12は code=[1], 点数=[3], 数量=[2] と全てズレていた）
          const iyCat = fields[1] || '';
          if (iyCat) currentCategory = iyCat;
          const iyCode = fields[3] || '';
          const iyDays = [];
          for (let di = 13; di <= 43 && di < fields.length; di++) {
            const dv = fields[di];
            if (dv && dv !== '0') iyDays.push(di - 12);
          }
          currentReceipt.procedures.push({
            category: currentCategory,
            categoryName: CATEGORY_NAMES[currentCategory] || currentCategory,
            code: iyCode,
            name: MasterLoader.getDrugName(iyCode),
            points: parseInt(fields[5]) || 0,
            quantity: parseFloat(fields[4]) || 0, // 数量（表示用）
            count: parseInt(fields[6]) || 0,       // 回数(fields[6])＝検算の乗数（数量とは別物）
            days: iyDays,
            isDrug: true,
            _raw: line
          });
        }
        break;

      case 'CO':
        if (currentReceipt) {
          currentReceipt.comments.push({
            identifier: fields[1] || '',
            code: fields[3] || '',
            text: fields.slice(4).join(',') || ''
          });
        }
        break;

      case 'JD':
        if (currentReceipt) {
          // ★v0.13修正: JDは fields[1]=負担者種別, fields[2..32]=受診日1..31 (day = i-1)。
          //   旧v0.12は fields[1]（=負担者種別「1」）を「1日受診」と誤カウントし実日数が過大だった
          for (let i = 2; i <= 32 && i < fields.length; i++) {
            if (fields[i] && fields[i].trim() && fields[i] !== '0') {
              currentReceipt.visitDays.push(i - 1);
            }
          }
        }
        break;

      case 'HR':
        // ★v0.15 返戻レコード。プレフィックス"8,seq,0,"除去後: HR,処理年月,区分,,理由コード,理由テキスト,,,,受付番号
        //   実UKEで L5900/L6209 等の理由コード＋日本語理由文＋RE[18]と一致する受付番号を確認。
        henreiRecords.push({
          reasonCode: fields[4] || '',
          reasonText: fields[5] || '',
          uketsukeNumber: fields[9] || ''
        });
        break;

      case 'GO':
        // 合計レコード（使うかは要検討）
        break;

      case 'SN':
      case 'MF':
        // 資格確認・摘要（現時点ではスキップ）
        break;
    }
  }
  if (currentReceipt) receipts.push(currentReceipt);

  // ★v0.15 返戻理由(HR)を受付番号でレセプトに突合
  if (henreiRecords.length) {
    const byUketsuke = {};
    receipts.forEach(r => { if (r.uketsukeNumber) byUketsuke[r.uketsukeNumber] = r; });
    henreiRecords.forEach(hr => {
      const r = hr.uketsukeNumber && byUketsuke[hr.uketsukeNumber];
      if (r) r.henreiReason = { code: hr.reasonCode, text: hr.reasonText };
    });
  }
  return receipts;
}

// ===== File Loading =====
function detectFileType(text) {
  // IR record の field[1] で社保/国保判定
  const irMatch = text.match(/^IR,(\d)/m);
  if (irMatch) {
    return irMatch[1] === '1' ? 'shaho' : 'kokuho';
  }
  return 'shaho';
}

async function loadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let text;
      try {
        const decoder = new TextDecoder('shift_jis');
        text = decoder.decode(e.target.result);
      } catch {
        text = new TextDecoder('utf-8').decode(e.target.result);
      }
      resolve(text);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function handleFiles(files) {
  const statusEl = document.getElementById('loadStatus');
  let totalLoaded = 0;

  for (const file of files) {
    statusEl.textContent = '読込中: ' + file.name + '...';
    const text = await loadFile(file);
    const baseType = detectFileType(text);

    // 返戻判定: henreiフォルダ名 or ファイルパス or "8,数字,数字," で始まる行がある
    const hasHenreiLines = /^\d+,\d+,\d+,RE/m.test(text);
    // フォルダ名にhenreiが含まれるかチェック（webkitRelativePath）
    const path = file.webkitRelativePath || file.name || '';
    const isHenrei = path.toLowerCase().includes('henrei') || hasHenreiLines;

    let fileType;
    if (isHenrei) {
      fileType = baseType + 'Henrei';
    } else {
      fileType = baseType;
    }

    const receipts = parseUKE(text, fileType);
    // 生データを保存（UKEダウンロード用）
    if (typeof ReceiptExporter !== 'undefined') {
      ReceiptExporter.storeRawUke(fileType, text);
    }
    // マージ
    const key = fileType === 'shahoHenrei' ? 'shahoHenrei' :
                fileType === 'kokuhoHenrei' ? 'kokuhoHenrei' :
                fileType === 'kokuho' ? 'kokuho' : 'shaho';
    allReceipts[key] = allReceipts[key].concat(receipts);
    totalLoaded += receipts.length;
  }

  statusEl.textContent = totalLoaded + '件のレセプトを読み込みました';
  // ツールバー更新 - 診療年月はREレコードから取得（IRは請求年月=翌月）
  const firstReceipt = [...allReceipts.shaho, ...allReceipts.kokuho, ...allReceipts.shahoHenrei, ...allReceipts.kokuhoHenrei][0];
  const displayMonth = firstReceipt ? firstReceipt.billingMonth : institution.billingMonth;
  if (displayMonth) {
    document.getElementById('toolbarMonth').textContent = formatMonth(displayMonth);
  }
  if (institution.name) {
    document.getElementById('toolbarInst').textContent = institution.name;
    document.getElementById('clinicName').textContent = institution.name;
  }
  // 自動チェック実行
  runAllChecks();
  // UI更新 - データがあるタブに自動切替
  for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
    if (allReceipts[key].length > 0) { currentTab = key; break; }
  }
  updateTabs();
  renderList();
  document.getElementById('dropZone').style.display = 'none';
}

// ===== Auto Checks =====
function runAllChecks() {
  for (const key of Object.keys(allReceipts)) {
    for (const r of allReceipts[key]) {
      r.warnings = [];
      checkReceipt(r);
    }
  }
  // 月またぎの回数チェック（複数月のUKEを読み込んでいる場合のみ有効）
  try { checkCrossMonthLimits(); } catch (e) { console.warn('cross-month check error', e); }
}

// ===== 期間跨ぎ（月またぎ）算定回数チェック =====
// 算定回数テーブルの期間単位が「複数月(３月/６月/１２月)」のコードについて、
// 同一患者の複数月レセプトを通算し、期間内の上限回数を超えていないか検査する。
// ※ 単月内(月1回等)は checkSanteiCount が担当。ここは月をまたぐ制限専用。
const CROSS_MONTH_PERIOD = { '１２月': 12, '６月': 6, '３月': 3 };

function checkCrossMonthLimits() {
  if (typeof MasterLoader === 'undefined' || !MasterLoader.isLoaded()) return;
  const flat = [];
  for (const key of Object.keys(allReceipts)) flat.push(...allReceipts[key]);
  if (flat.length < 2) return;
  // 患者(カルテ番号 or 氏名) → コード → [{monthIdx, count, receipt}]
  const byPatient = {};
  for (const r of flat) {
    const pk = ((r.karteNumber || '') || (r.name || '')).trim();
    const ym = (r.billingMonth || '');
    if (!pk || ym.length < 6) continue;
    const monthIdx = parseInt(ym.slice(0, 4)) * 12 + parseInt(ym.slice(4, 6));
    if (isNaN(monthIdx)) continue;
    const codeCount = {};
    for (const p of r.procedures) {
      if (p.isDrug || !p.code) continue;
      codeCount[p.code] = (codeCount[p.code] || 0) + (p.quantity || 1);
    }
    for (const code in codeCount) {
      (byPatient[pk] = byPatient[pk] || {});
      (byPatient[pk][code] = byPatient[pk][code] || []).push({ monthIdx: monthIdx, count: codeCount[code], receipt: r });
    }
  }
  for (const pk in byPatient) {
    for (const code in byPatient[pk]) {
      const occ = byPatient[pk][code];
      if (occ.length < 2) continue; // 複数月に跨って初めて意味を持つ
      const limit = MasterLoader.getSanteiCount(code);
      if (!limit) continue;
      const pm = CROSS_MONTH_PERIOD[limit.un];
      if (!pm) continue; // 複数月周期のコードのみ対象
      const max = Number(limit.max) || 0;
      if (max <= 0) continue;
      occ.sort((a, b) => a.monthIdx - b.monthIdx);
      const flagged = new Set();
      for (let i = 0; i < occ.length; i++) {
        let sum = 0, last = null;
        for (let j = i; j < occ.length && occ[j].monthIdx < occ[i].monthIdx + pm; j++) {
          sum += occ[j].count; last = occ[j];
        }
        if (sum > max && last && !flagged.has(last.receipt)) {
          flagged.add(last.receipt);
          last.receipt.warnings.push({
            severity: 'high',
            message: '期間内回数超過(月またぎ): ' + (MasterLoader.getProcedureName(code) || code) + ' は' + limit.un + max + '回まで（同一患者・期間内' + sum + '回算定）'
          });
        }
      }
    }
  }
}

function checkReceipt(r) {
  // Advanced checks (SSKマスター使用)
  if (typeof ReceiptChecker !== 'undefined') {
    ReceiptChecker.runAdvancedChecks(r);
  }

  // 1. 傷病名なし
  if (r.diseases.length === 0) {
    r.warnings.push({ severity: 'high', message: '傷病名が登録されていません' });
  }

  // 2. 適応症チェック（投薬ありなのに傷病名なし → 簡易版）
  const hasMedication = r.procedures.some(p =>
    ['21','22','23'].includes(p.category) || p.isDrug);
  if (hasMedication && r.diseases.length === 0) {
    r.warnings.push({ severity: 'high', message: '投薬あり・傷病名なし: 適応症未登録の可能性' });
  }

  // 3. 外来管理加算 + 処置の併算定チェック
  const hasGairai = r.procedures.some(p => p.code === '112011010');
  const hasShochi = r.procedures.some(p => p.category === '40');
  if (hasGairai && hasShochi) {
    r.warnings.push({ severity: 'mid', message: '外来管理加算算定不可: 処置行為との併算定' });
  }

  // 4. 3層整合チェック（記録条件仕様のお手本に基づく／v0.13→検算をv0.14で実装）
  //   第1層: 請求合計(HO[5]/KO[5]) ＝ 明細の 剤点数×回数(fields[6]) の総和
  //     ※ 実UKE全140件で社保100%(68/68)・国保97%(70/72)一致を検証。一致=検算OK。
  //       不一致は逓減・公費按分・記録不全の候補として要確認（原理的にゼロにはならない）。
  //   第3層: 算定日(SI/IY fields[13..43]) が 受診日(JD fields[2..32]) に含まれるか
  //     ※ 実UKE全140件で100%含まれることを検証済み。外れる=データ不整合の可能性。
  const calcPoints = r.procedures.reduce((s, p) => {
    const mult = (p.count && p.count > 0) ? p.count : 1;
    return s + (p.points || 0) * mult;
  }, 0);
  const diff = r.totalPoints - calcPoints;
  const reconciled = (r.totalPoints > 0 && diff === 0);
  const jdDaySet = new Set(r.visitDays);
  const santeiDaySet = new Set();
  r.procedures.forEach(p => (p.days || []).forEach(d => santeiDaySet.add(d)));
  const santeiOutside = [...santeiDaySet].filter(d => jdDaySet.size && !jdDaySet.has(d));
  r.integrity = {
    billTotal: r.totalPoints,
    calcPoints: calcPoints,
    diff: diff,
    reconciled: reconciled,
    jitsuNissu: r.jitsuNissu || r.visitDays.length,
    visitDays: [...jdDaySet].sort((a, b) => a - b),
    santeiDays: [...santeiDaySet].sort((a, b) => a - b),
    santeiOutside: santeiOutside
  };
  if (santeiOutside.length > 0) {
    r.warnings.push({ severity: 'mid', message: '算定日整合: 受診日(JD)に無い日付で算定された行為があります（' + santeiOutside.join(',') + '日）' });
  }
  if (r.totalPoints > 0 && calcPoints === 0 && r.procedures.length > 0) {
    r.warnings.push({ severity: 'low', message: '明細の点数を取得できませんでした（請求合計=' + r.totalPoints.toLocaleString() + '点）' });
  } else if (r.totalPoints > 0 && diff !== 0) {
    // 検算不一致（明細合計≠請求合計）。逓減・公費併用の正当差もあり得るため要確認扱い。
    r.warnings.push({ severity: 'low', message: '点数検算: 明細合計' + calcPoints.toLocaleString() + '点 ≠ 請求合計' + r.totalPoints.toLocaleString() + '点（差' + diff.toLocaleString() + '点／逓減・公費按分・記録不全の可能性、要確認）' });
  }

  // 5. 返戻フラグ／返戻理由（v0.15: HRレコードから理由を突合）
  if (r.henreiReason && (r.henreiReason.text || r.henreiReason.code)) {
    r.warnings.push({
      severity: 'high',
      message: '返戻理由' + (r.henreiReason.code ? '[' + r.henreiReason.code + ']' : '') + ': ' + (r.henreiReason.text || '（理由テキストなし）')
    });
  } else if (r.isHenrei) {
    r.warnings.push({ severity: 'info', message: '返戻レセプト（再請求）' });
  }
}

// ===== UI Rendering =====
function getCurrentReceipts() {
  const list = allReceipts[currentTab] || [];
  let filtered = list;
  if (currentFilter === 'warn') {
    filtered = list.filter(r => r.warnings.some(isActionable));
  }
  if (sortCol) {
    filtered = [...filtered].sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'seq': va = a.seq; vb = b.seq; break;
        case 'karte': va = a.karteNumber; vb = b.karteNumber; break;
        case 'name': va = a.name; vb = b.name; break;
        case 'points': va = a.totalPoints; vb = b.totalPoints; break;
        case 'warn': va = a.warnings.length; vb = b.warnings.length; break;
        default: va = a.seq; vb = b.seq;
      }
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
  }
  return filtered;
}

function updateTabs() {
  const tabs = document.querySelectorAll('.rc-tab[data-tab]');
  tabs.forEach(tab => {
    const key = tab.dataset.tab;
    const list = allReceipts[key] || [];
    const countEl = tab.querySelector('.tab-count');
    const warnEl = tab.querySelector('.tab-warn');
    if (countEl) countEl.textContent = '(' + list.length + ')';
    const warnCount = list.filter(r => r.warnings.some(isActionable)).length;
    if (warnEl) {
      warnEl.textContent = warnCount;
      warnEl.style.display = warnCount > 0 ? '' : 'none';
    }
    tab.classList.toggle('active', key === currentTab);
  });
}

function renderList() {
  const container = document.getElementById('receiptTableBody');
  const receipts = getCurrentReceipts();
  const allList = allReceipts[currentTab] || [];

  if (receipts.length === 0) {
    container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">データなし</td></tr>';
    updateSummary(allList);
    return;
  }

  let html = '';
  receipts.forEach((r, i) => {
    const warnCount = r.warnings.filter(isActionable).length;
    const rowClass = warnCount > 0 ? 'warn-row' : (r.isHenrei ? 'henrei-row' : '');
    const realIdx = allList.indexOf(r);
    html += '<tr class="' + rowClass + '" onclick="showDetail(' + realIdx + ')" style="cursor:pointer;">';
    html += '<td>' + esc(String(r.seq)) + '</td>';
    html += '<td>' + esc(r.karteNumber) + '</td>';
    html += '<td>' + esc(r.name) + '</td>';
    html += '<td>' + esc(r.insuranceType) + '</td>';
    html += '<td class="num">' + (r.jitsuNissu || r.visitDays.length) + '</td>';
    html += '<td class="num">' + r.totalPoints.toLocaleString() + '</td>';
    html += '<td style="text-align:center;">';
    if (warnCount > 0) {
      html += '<span style="color:var(--rc-red);font-weight:600;">!</span>';
      html += '<span class="rc-badge rc-badge-red">' + warnCount + '</span>';
    }
    html += '</td>';
    html += '<td><button class="rc-btn" onclick="event.stopPropagation();showDetail(' + realIdx + ')">詳細</button></td>';
    html += '</tr>';
  });
  container.innerHTML = html;
  updateSummary(allList);
}

function updateSummary(list) {
  const el = document.getElementById('summaryBar');
  if (!list || list.length === 0) {
    el.innerHTML = '<span>データなし</span>';
    return;
  }
  const total = list.length;
  const totalPts = list.reduce((s, r) => s + r.totalPoints, 0);
  const totalDays = list.reduce((s, r) => s + (r.jitsuNissu || r.visitDays.length), 0);
  const warnCount = list.filter(r => r.warnings.some(isActionable)).length;
  // ★v0.14 点検サマリー: 検算一致/不一致・深刻度内訳
  const reconOk = list.filter(r => r.integrity && r.integrity.reconciled).length;
  const reconNg = list.filter(r => r.integrity && r.totalPoints > 0 && !r.integrity.reconciled).length;
  let sevHigh = 0, sevMid = 0, sevLow = 0;
  list.forEach(r => r.warnings.forEach(w => {
    if (w.severity === 'high') sevHigh++;
    else if (w.severity === 'mid') sevMid++;
    else if (w.severity === 'low') sevLow++;
  }));
  el.innerHTML =
    '<span><strong>件数:</strong> ' + total + '件</span>' +
    '<span><strong>合計点数:</strong> ' + totalPts.toLocaleString() + '点</span>' +
    '<span><strong>実日数合計:</strong> ' + totalDays + '日</span>' +
    '<span><strong>点数検算:</strong> <span style="color:var(--rc-green);font-weight:600;">一致' + reconOk + '</span>' +
      (reconNg > 0 ? ' / <span style="color:var(--rc-red);font-weight:600;">要確認' + reconNg + '</span>' : '') + '</span>' +
    '<span><strong>警告あり:</strong> <span style="color:var(--rc-red);font-weight:600;">' + warnCount + '件</span>' +
      ' <span style="font-size:11px;color:#888;">(高' + sevHigh + '/中' + sevMid + '/低' + sevLow + ')</span></span>';
}

function formatDate(d) {
  if (!d || d.length < 8) return d || '';
  return d.substring(0, 4) + '/' + d.substring(4, 6) + '/' + d.substring(6, 8);
}
function formatMonth(m) {
  if (!m || m.length < 6) return m || '';
  return m.substring(0, 4) + '/' + m.substring(4, 6);
}

// ===== Detail View =====
function showDetail(idx) {
  const list = allReceipts[currentTab] || [];
  if (idx < 0 || idx >= list.length) return;
  currentDetailIdx = idx;
  currentView = 'detail';
  const r = list[idx];

  document.querySelector('.rc-list-view').classList.add('hidden');
  const detail = document.getElementById('detailView');
  detail.classList.add('visible');

  // Header
  document.getElementById('detailName').textContent = r.name;
  document.getElementById('detailKarte').textContent = '(' + (r.karteNumber || '-') + ')';
  document.getElementById('detailInsType').textContent = r.insuranceType;
  document.getElementById('detailMonth').textContent = '診療年月: ' + formatMonth(r.billingMonth);
  const warnCount = r.warnings.filter(isActionable).length;
  const warnBadge = document.getElementById('detailWarnBadge');
  if (warnCount > 0) {
    warnBadge.innerHTML = '<span class="rc-badge rc-badge-red">要対応 ' + warnCount + '件</span>';
    warnBadge.style.display = '';
  } else {
    warnBadge.style.display = 'none';
  }

  // Insurance info
  let insHtml = '';
  if (r.insurance) {
    insHtml += '<span>保険者番号: <strong>' + esc(r.insurance.insurerNumber) + '</strong></span>';
    if (r.insurance.symbol) insHtml += '<span>記号: <strong>' + esc(r.insurance.symbol) + '</strong></span>';
    insHtml += '<span>番号: <strong>' + esc(r.insurance.insuredNumber) + '</strong></span>';
  }
  insHtml += '<span>生年月日: <strong>' + formatDate(r.dob) + '</strong></span>';
  insHtml += '<span>性別: <strong>' + esc(r.sex) + '</strong></span>';
  if (r.copayRatio) insHtml += '<span>給付割合: <strong>' + esc(r.copayRatio) + '%</strong></span>';
  if (r.visitDays.length > 0) insHtml += '<span>受診日: <strong>' + r.visitDays.join(',') + '日</strong></span>';
  // ★v0.15 返戻理由バナー（返戻レセプトの最重要情報）
  if (r.henreiReason && (r.henreiReason.text || r.henreiReason.code)) {
    insHtml = '<div style="flex-basis:100%;background:#fbf1ee;border-left:5px solid var(--rc-red,#b5442f);' +
      'padding:10px 14px;margin-bottom:8px;font-size:13px;line-height:1.6;">' +
      '<strong style="color:var(--rc-red,#b5442f);">&#9888; 返戻理由' +
      (r.henreiReason.code ? '（' + esc(r.henreiReason.code) + '）' : '') + '</strong><br>' +
      esc(r.henreiReason.text || '（理由テキストなし）') + '</div>' + insHtml;
  }
  document.getElementById('detailInsInfo').innerHTML = insHtml;

  // Diseases
  let diseaseHtml = '';
  if (r.diseases.length === 0) {
    diseaseHtml = '<tr><td colspan="5" style="text-align:center;color:#888;">傷病名なし</td></tr>';
  } else {
    r.diseases.forEach((d, di) => {
      const primary = d.isPrimary ? '<span class="rc-tag rc-tag-blue">主</span>' : '';
      diseaseHtml += '<tr>';
      diseaseHtml += '<td>' + (di + 1) + '</td>';
      diseaseHtml += '<td>' + esc(d.name || d.code) + ' ' + primary + '</td>';
      diseaseHtml += '<td>' + esc(d.code) + '</td>';
      diseaseHtml += '<td>' + formatDate(d.startDate) + '</td>';
      const modText = d.modifier ? (MasterLoader.getModifierName(d.modifier) || MODIFIER_CODES[d.modifier] || d.modifier) : '';
      diseaseHtml += '<td>' + esc(modText) + '</td>';
      diseaseHtml += '</tr>';
    });
  }
  document.getElementById('detailDiseases').innerHTML = diseaseHtml;

  // Procedures
  let procHtml = '';
  let lastCat = '';
  r.procedures.forEach(p => {
    if (p.category !== lastCat && p.category) {
      lastCat = p.category;
      const catName = CATEGORY_NAMES[p.category] || p.category;
      procHtml += '<tr class="cat-row"><td colspan="6">&#9632; ' + esc(catName) + ' (' + esc(p.category) + ')</td></tr>';
    }
    let displayName = p.name;
    if (!displayName && p.isDrug) {
      const drug = MasterLoader.getDrug(p.code);
      displayName = drug ? drug.name + (drug.unit ? ' (' + drug.unit + ')' : '') : '[薬品:' + p.code + ']';
    }
    if (!displayName) displayName = '[' + p.code + ']';
    const subtotal = (p.points && p.quantity) ? p.points * p.quantity : p.points || '';
    procHtml += '<tr>';
    procHtml += '<td></td>';
    procHtml += '<td>' + esc(displayName) + '</td>';
    procHtml += '<td>' + esc(p.code) + '</td>';
    procHtml += '<td class="num">' + (p.points || '') + '</td>';
    procHtml += '<td class="num">' + (p.quantity || '') + '</td>';
    procHtml += '<td class="num">' + (subtotal || '') + '</td>';
    procHtml += '</tr>';
  });
  if (procHtml === '') {
    procHtml = '<tr><td colspan="6" style="text-align:center;color:#888;">診療行為なし</td></tr>';
  }
  document.getElementById('detailProcedures').innerHTML = procHtml;

  // Total
  const copay = r.insurance ? r.insurance.copayAmount : 0;
  document.getElementById('detailTotal').innerHTML =
    '合計点数: <span class="points">' + r.totalPoints.toLocaleString() + '</span>' +
    '&nbsp;&nbsp;&nbsp;実日数: ' + (r.jitsuNissu || r.visitDays.length) +
    '&nbsp;&nbsp;&nbsp;一部負担金: ' + (copay ? copay.toLocaleString() + '円' : '-') +
    renderIntegrityPanel(r);

  // Warnings
  renderDetailWarnings(r);
}

// ===== 3層整合パネル（記録条件仕様のお手本に基づく可視化・v0.13） =====
//   第1層: 請求合計(HO/KO) ⇔ 明細点数の単純和（加算・逓減・包括で差が出るのは正常）
//   第2層: 剤（診療識別ごとのまとまり）の点数配置
//   第3層: 実日数(HO/KO) ⇔ 受診日(JD) ⇔ 算定日(SI/IY)
function renderIntegrityPanel(r) {
  const ig = r.integrity;
  if (!ig) return '';
  // 剤（診療識別ごと）を数える
  const zaiCats = new Set();
  r.procedures.forEach(p => { if (p.category) zaiCats.add(p.category); });
  const diff = ig.diff;
  const diffOk = ig.reconciled;
  const diffColor = diffOk ? 'var(--rc-green)' : 'var(--rc-red)';
  const diffMark = diffOk ? '&#10003; 検算一致' :
    (ig.calcPoints === 0 ? '明細点数なし（要確認）' : '&#9888; 差' + diff.toLocaleString() + '点（逓減・公費按分・記録不全の可能性、要確認）');
  const santeiOk = ig.santeiOutside.length === 0;
  const santeiColor = santeiOk ? 'var(--rc-green)' : 'var(--rc-red)';
  const santeiMark = santeiOk ? '&#10003; 全て受診日内' : '&#9888; 受診日外: ' + ig.santeiOutside.join(',') + '日';
  const vd = ig.visitDays.length ? ig.visitDays.join('・') + '日' : '—';
  const sd = ig.santeiDays.length ? ig.santeiDays.join('・') + '日' : '—';
  return (
    '<div style="margin-top:10px;border:1px solid var(--rc-border,#d9d4c8);border-left:4px solid var(--rc-teal,#0e7c66);background:rgba(14,124,102,0.04);padding:8px 12px;font-size:12px;line-height:1.7;">' +
      '<div style="font-weight:700;color:var(--rc-teal,#0e7c66);margin-bottom:4px;">3層整合チェック（レセ電記録条件仕様）</div>' +
      '<div><span style="display:inline-block;min-width:8.5em;color:#666;">① 点数検算</span>' +
        '請求合計 <strong>' + ig.billTotal.toLocaleString() + '点</strong> ／ 明細(点数×回数) ' + ig.calcPoints.toLocaleString() + '点 ' +
        '<span style="color:' + diffColor + ';font-weight:600;">' + diffMark + '</span></div>' +
      '<div><span style="display:inline-block;min-width:8.5em;color:#666;">② 剤の数</span>' +
        zaiCats.size + '剤（診療識別: ' + [...zaiCats].join(', ') + '）</div>' +
      '<div><span style="display:inline-block;min-width:8.5em;color:#666;">③ 実日数/受診日/算定日</span>' +
        '実' + ig.jitsuNissu + '日 ／ 受診日 ' + vd + ' ／ 算定日 ' + sd + ' ' +
        '<span style="color:' + santeiColor + ';font-weight:600;">' + santeiMark + '</span></div>' +
    '</div>'
  );
}

function renderDetailWarnings(r) {
  const section = document.getElementById('detailCheckSection');
  const body = document.getElementById('detailChecks');
  const realWarns = r.warnings.filter(w => w.severity !== 'info');

  if (realWarns.length === 0) {
    section.className = 'rc-detail-section rc-check-ok';
    section.querySelector('.rc-detail-head').textContent = 'チェック結果';
    body.innerHTML = '<div style="padding:4px 0;color:var(--rc-green);">&#10003; 問題なし</div>';
  } else {
    section.className = 'rc-detail-section rc-check-ng';
    section.querySelector('.rc-detail-head').textContent = '⚠ チェック結果 (' + realWarns.length + '件)';
    let html = '<table class="rc-detail-table"><tr><th>#</th><th>深刻度</th><th>内容</th></tr>';
    realWarns.forEach((w, i) => {
      const sevClass = w.severity === 'high' ? 'rc-badge-red' : w.severity === 'mid' ? 'rc-badge-amber' : 'rc-badge-blue';
      const sevLabel = w.severity === 'high' ? '高' : w.severity === 'mid' ? '中' : '低';
      html += '<tr class="' + (w.severity === 'high' ? 'warn-row' : '') + '">';
      html += '<td>' + (i + 1) + '</td>';
      html += '<td><span class="rc-badge ' + sevClass + '">' + sevLabel + '</span></td>';
      html += '<td>' + esc(w.message) + '</td></tr>';
    });
    html += '</table>';
    body.innerHTML = html;
  }

  // info warnings (henrei etc)
  const infoWarns = r.warnings.filter(w => w.severity === 'info');
  if (infoWarns.length > 0) {
    body.innerHTML += '<div style="margin-top:6px;font-size:11px;color:var(--rc-amber);">' +
      infoWarns.map(w => esc(w.message)).join(', ') + '</div>';
  }
}

function backToList() {
  currentView = 'list';
  document.querySelector('.rc-list-view').classList.remove('hidden');
  document.getElementById('detailView').classList.remove('visible');
  document.getElementById('checklistView').classList.remove('visible');
}

// ===== Checklist View =====
function showChecklist() {
  currentView = 'checklist';
  document.querySelector('.rc-list-view').classList.add('hidden');
  document.getElementById('detailView').classList.remove('visible');
  const cl = document.getElementById('checklistView');
  cl.classList.add('visible');

  // Collect all warnings across all tabs
  const allWarns = [];
  for (const key of Object.keys(allReceipts)) {
    for (const r of allReceipts[key]) {
      for (const w of r.warnings) {
        if (w.severity === 'info') continue;
        allWarns.push({
          karteNumber: r.karteNumber,
          name: r.name,
          insuranceType: r.insuranceType,
          severity: w.severity,
          message: w.message,
          fileType: key
        });
      }
    }
  }

  // Sort: high first
  const sevOrder = { high: 0, mid: 1, low: 2 };
  allWarns.sort((a, b) => (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9));

  let html = '';
  if (allWarns.length === 0) {
    html = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--rc-green);">&#10003; 全レセプト問題なし</td></tr>';
  } else {
    allWarns.forEach((w, i) => {
      const sevClass = w.severity === 'high' ? 'rc-badge-red' : w.severity === 'mid' ? 'rc-badge-amber' : 'rc-badge-blue';
      const sevLabel = w.severity === 'high' ? '高' : w.severity === 'mid' ? '中' : '低';
      html += '<tr class="' + (w.severity === 'high' ? 'warn-row' : '') + '">';
      html += '<td>' + (i + 1) + '</td>';
      html += '<td>' + esc(w.karteNumber) + '</td>';
      html += '<td>' + esc(w.name) + '</td>';
      html += '<td>' + esc(w.insuranceType) + '</td>';
      html += '<td><span class="rc-badge ' + sevClass + '">' + sevLabel + '</span></td>';
      html += '<td>' + esc(w.message) + '</td>';
      html += '</tr>';
    });
  }
  document.getElementById('checklistBody').innerHTML = html;

  // Summary
  const high = allWarns.filter(w => w.severity === 'high').length;
  const mid = allWarns.filter(w => w.severity === 'mid').length;
  const low = allWarns.filter(w => w.severity === 'low').length;
  const patients = new Set(allWarns.map(w => w.karteNumber + w.name)).size;
  document.getElementById('checklistSummary').innerHTML =
    '<span><strong>警告合計:</strong> <span style="color:var(--rc-red);font-weight:600;">' + allWarns.length + '件</span>' +
    '（高: ' + high + ' / 中: ' + mid + ' / 低: ' + low + '）</span>' +
    '<span><strong>対象患者:</strong> ' + patients + '名</span>';
}

// ===== Summary View =====
function showSummaryView() {
  const modal = document.getElementById('summaryModal');
  modal.style.display = 'flex';

  const data = {};
  for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
    const list = allReceipts[key] || [];
    data[key] = {
      count: list.length,
      points: list.reduce((s, r) => s + r.totalPoints, 0),
      days: list.reduce((s, r) => s + r.visitDays.length, 0),
      copay: list.reduce((s, r) => s + (r.insurance ? r.insurance.copayAmount : 0), 0)
    };
  }
  const henreiCount = data.shahoHenrei.count + data.kokuhoHenrei.count;
  const henreiPts = data.shahoHenrei.points + data.kokuhoHenrei.points;
  const total = {
    count: data.shaho.count + data.kokuho.count + henreiCount,
    points: data.shaho.points + data.kokuho.points + henreiPts,
    days: data.shaho.days + data.kokuho.days + data.shahoHenrei.days + data.kokuhoHenrei.days,
    copay: data.shaho.copay + data.kokuho.copay
  };

  document.getElementById('summaryContent').innerHTML =
    '<table class="rc-detail-table">' +
    '<tr><th></th><th style="text-align:center;">社保</th><th style="text-align:center;">国保</th><th style="text-align:center;">返戻（計）</th><th style="text-align:center;">合計</th></tr>' +
    '<tr><td style="font-weight:600;">件数</td>' +
    '<td class="num">' + data.shaho.count + '</td><td class="num">' + data.kokuho.count + '</td>' +
    '<td class="num">' + henreiCount + '</td><td class="num" style="font-weight:600;">' + total.count + '</td></tr>' +
    '<tr><td style="font-weight:600;">合計点数</td>' +
    '<td class="num">' + data.shaho.points.toLocaleString() + '</td><td class="num">' + data.kokuho.points.toLocaleString() + '</td>' +
    '<td class="num">' + henreiPts.toLocaleString() + '</td><td class="num" style="font-weight:600;">' + total.points.toLocaleString() + '</td></tr>' +
    '<tr><td style="font-weight:600;">実日数合計</td>' +
    '<td class="num">' + data.shaho.days + '</td><td class="num">' + data.kokuho.days + '</td>' +
    '<td class="num">' + (data.shahoHenrei.days + data.kokuhoHenrei.days) + '</td><td class="num" style="font-weight:600;">' + total.days + '</td></tr>' +
    '<tr><td style="font-weight:600;">一部負担金</td>' +
    '<td class="num">' + data.shaho.copay.toLocaleString() + '</td><td class="num">' + data.kokuho.copay.toLocaleString() + '</td>' +
    '<td class="num">-</td><td class="num" style="font-weight:600;">' + total.copay.toLocaleString() + '</td></tr>' +
    '</table>' +
    '<p style="font-size:11px;color:#888;margin-top:8px;">※ 上記はUKEファイルから自動集計した値です。実際の総括表（PDF）と照合してください。</p>';
}

function closeSummaryModal() {
  document.getElementById('summaryModal').style.display = 'none';
}

// ===== Tab / Filter handlers =====
function switchTab(tab) {
  currentTab = tab;
  sortCol = null;
  currentFilter = 'all';
  updateTabs();
  updateFilterButtons();
  renderList();
  if (currentView !== 'list') backToList();
}

function setFilter(f) {
  currentFilter = f;
  updateFilterButtons();
  renderList();
}

function updateFilterButtons() {
  document.querySelectorAll('.rc-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentFilter);
  });
}

function sortBy(col) {
  if (sortCol === col) {
    sortAsc = !sortAsc;
  } else {
    sortCol = col;
    sortAsc = true;
  }
  renderList();
}

// ===== Detail navigation =====
function prevDetail() {
  const list = allReceipts[currentTab] || [];
  if (currentDetailIdx > 0) showDetail(currentDetailIdx - 1);
}
function nextDetail() {
  const list = allReceipts[currentTab] || [];
  if (currentDetailIdx < list.length - 1) showDetail(currentDetailIdx + 1);
}

// ===== File input trigger =====
function triggerFileInput() {
  document.getElementById('fileInput').click();
}

function onFileInputChange(e) {
  if (e.target.files.length > 0) {
    handleFiles(e.target.files);
  }
}

// ===== Auth (shared with karte_v09) =====
async function initReceiptAuth() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    // No auth configured - show app directly
    showReceiptApp();
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showReceiptApp();
  } else {
    document.getElementById('receiptLoginOverlay').style.display = 'flex';
  }
}

async function handleReceiptLogin() {
  const email = document.getElementById('rcLoginEmail').value;
  const pw = document.getElementById('rcLoginPassword').value;
  const errEl = document.getElementById('rcLoginError');
  errEl.textContent = '';
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
    if (error) { errEl.textContent = error.message; return; }
    showReceiptApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function showReceiptApp() {
  document.getElementById('receiptLoginOverlay').style.display = 'none';
  document.getElementById('receiptApp').style.display = 'block';

  // Update clinic name from institution if loaded
  if (institution.name) {
    document.getElementById('clinicName').textContent = institution.name;
  }
}

// ===== Init =====
async function initReceiptViewer() {
  // SSKマスター読込
  try {
    await MasterLoader.loadAll('master/');
    console.log('MasterLoader ready:', MasterLoader.getStats());
  } catch (e) {
    console.warn('MasterLoader failed, using fallback dictionaries:', e);
  }

  // Drag and drop
  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (currentView === 'detail') {
      if (e.key === 'Escape') backToList();
      if (e.key === 'ArrowLeft') prevDetail();
      if (e.key === 'ArrowRight') nextDetail();
    }
  });

  // sessionStorageからUKEデータを自動読み込み（uke_generatorから渡される）
  const pendingRaw = localStorage.getItem('pendingUKE');
  if (pendingRaw) {
    localStorage.removeItem('pendingUKE');
    try {
      const pending = JSON.parse(pendingRaw);
      const files = [];
      if (pending.shaho) {
        files.push(new File([new TextEncoder().encode(pending.shaho)], 'shaho_RECEIPTC.UKE', { type: 'application/octet-stream' }));
      }
      if (pending.kokuho) {
        files.push(new File([new TextEncoder().encode(pending.kokuho)], 'kokuho_RECEIPTC.UKE', { type: 'application/octet-stream' }));
      }
      if (files.length > 0) handleFiles(files);
    } catch(e) { console.error('pendingUKE parse error:', e); }
  }

  // Init auth
  initReceiptAuth();
}

// ===== Detail screen: print / CSV helpers =====
function printCurrentDetail() {
  const list = allReceipts[currentTab] || [];
  if (currentDetailIdx >= 0 && currentDetailIdx < list.length) {
    ReceiptExporter.printReceipt(list[currentDetailIdx]);
  }
}
function csvCurrentDetail() {
  const list = allReceipts[currentTab] || [];
  if (currentDetailIdx >= 0 && currentDetailIdx < list.length) {
    ReceiptExporter.exportDetailCSV(list[currentDetailIdx]);
  }
}

document.addEventListener('DOMContentLoaded', initReceiptViewer);
