// ===== レセプト点検ビューア (receipt_viewer.js) =====
// UKEパーサー + UI制御

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
          karteNumber: fields[11] || '',
          totalPoints: parseInt(fields[13]) || 0,
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
          currentReceipt.insurance = {
            insurerNumber: fields[1] || '',
            symbol: fields[2] || '',
            insuredNumber: fields[3] || '',
            copayAmount: parseInt(fields[5]) || 0
          };
        }
        break;

      case 'KO':
        if (currentReceipt) {
          currentReceipt.kouhi.push({
            futanshaNumber: fields[1] || '',
            jukyushaNumber: fields[2] || '',
            copayAmount: parseInt(fields[5]) || 0
          });
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
          // 算定日情報: fields[12..42] が日1..31の回数 (day = fieldIndex - 11)。実UKEで検証済み
          const siDays = [];
          for (let di = 12; di <= 42 && di < fields.length; di++) {
            const dv = fields[di];
            if (dv && dv !== '0') siDays.push(di - 11);
          }
          currentReceipt.procedures.push({
            category: currentCategory,
            categoryName: CATEGORY_NAMES[currentCategory] || currentCategory,
            code: code,
            name: MasterLoader.getProcedureName(code) || PROCEDURE_CODES[code] || '',
            points: pts,
            quantity: qty,
            days: siDays,
            _raw: line
          });
        }
        break;

      case 'IY':
        if (currentReceipt) {
          currentReceipt.procedures.push({
            category: currentCategory,
            categoryName: CATEGORY_NAMES[currentCategory] || currentCategory,
            code: fields[1] || '',
            name: MasterLoader.getDrugName(fields[1] || ''),
            points: parseInt(fields[3]) || 0,
            quantity: parseFloat(fields[2]) || 0,
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
          // JD record encodes visit days as fields[1..31] for day 1..31
          for (let d = 1; d <= 31; d++) {
            if (fields[d] && fields[d].trim()) {
              currentReceipt.visitDays.push(d);
            }
          }
        }
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

  // 4. 明細取得チェック（パース健全性）
  // 注意: レセ電のSI点数欄は「点数×回数の単純和」ではなく包括・加算・逓減が絡むため、
  //       請求合計(RE)との単純比較は成立しない（旧「合計点数差異」は全件誤検知だったため廃止）。
  //       ここでは明細から点数を1つも取得できなかった=パース不全のみを警告する。
  const calcPoints = r.procedures.reduce((s, p) => {
    if (p.points && p.quantity) return s + p.points * p.quantity;
    if (p.points) return s + p.points;
    return s;
  }, 0);
  if (r.totalPoints > 0 && calcPoints === 0 && r.procedures.length > 0) {
    r.warnings.push({ severity: 'low', message: '明細の点数を取得できませんでした（請求合計=' + r.totalPoints.toLocaleString() + '点）' });
  }

  // 5. 返戻フラグ
  if (r.isHenrei) {
    r.warnings.push({ severity: 'info', message: '返戻レセプト（再請求）' });
  }
}

// ===== UI Rendering =====
function getCurrentReceipts() {
  const list = allReceipts[currentTab] || [];
  let filtered = list;
  if (currentFilter === 'warn') {
    filtered = list.filter(r => r.warnings.some(w => w.severity !== 'info'));
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
    const warnCount = list.filter(r => r.warnings.some(w => w.severity !== 'info')).length;
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
    const warnCount = r.warnings.filter(w => w.severity !== 'info').length;
    const rowClass = warnCount > 0 ? 'warn-row' : (r.isHenrei ? 'henrei-row' : '');
    const realIdx = allList.indexOf(r);
    html += '<tr class="' + rowClass + '" onclick="showDetail(' + realIdx + ')" style="cursor:pointer;">';
    html += '<td>' + esc(String(r.seq)) + '</td>';
    html += '<td>' + esc(r.karteNumber) + '</td>';
    html += '<td>' + esc(r.name) + '</td>';
    html += '<td>' + esc(r.insuranceType) + '</td>';
    html += '<td class="num">' + r.visitDays.length + '</td>';
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
  const totalDays = list.reduce((s, r) => s + r.visitDays.length, 0);
  const warnCount = list.filter(r => r.warnings.some(w => w.severity !== 'info')).length;
  el.innerHTML =
    '<span><strong>件数:</strong> ' + total + '件</span>' +
    '<span><strong>合計点数:</strong> ' + totalPts.toLocaleString() + '点</span>' +
    '<span><strong>実日数合計:</strong> ' + totalDays + '日</span>' +
    '<span><strong>警告あり:</strong> <span style="color:var(--rc-red);font-weight:600;">' + warnCount + '件</span></span>';
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
  const warnCount = r.warnings.filter(w => w.severity !== 'info').length;
  const warnBadge = document.getElementById('detailWarnBadge');
  if (warnCount > 0) {
    warnBadge.innerHTML = '<span class="rc-badge rc-badge-red">警告 ' + warnCount + '件</span>';
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
    '&nbsp;&nbsp;&nbsp;実日数: ' + r.visitDays.length +
    '&nbsp;&nbsp;&nbsp;一部負担金: ' + (copay ? copay.toLocaleString() + '円' : '-');

  // Warnings
  renderDetailWarnings(r);
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
    section.querySelector('.rc-detail-head').textContent = '&#9888; チェック結果 (' + realWarns.length + '件)';
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
