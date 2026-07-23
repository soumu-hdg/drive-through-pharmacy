// ===== レセプト データ出力モジュール (receipt_exporter.js) =====
// CSV出力・UKEダウンロード・印刷用レセプト生成・公式帳票出力
//
// 依存: receipt_viewer.js (allReceipts, institution, esc, formatDate, formatMonth)
//       receipt_codes.js (CATEGORY_NAMES, PROCEDURE_CODES, DISEASE_CODES)
//       master_loader.js (MasterLoader)

const ReceiptExporter = (() => {

  // ============================================================
  // 医療機関固定情報（config.jsから取得 or デフォルト）
  // ============================================================
  const CLINIC = {
    code: '7400840',
    name: '西春内科・在宅クリニック',
    address: '愛知県北名古屋市九之坪北浦31',
    founder: '島原　立樹',
    prefecture: '23', // 愛知
    prefectureName: '愛知県',
  };

  // 保険者番号→市町村名マッピング（愛知県内主要）
  const INSURER_NAMES = {
    '230014': '名古屋市千種区', '230022': '名古屋市東区', '230031': '名古屋市北区',
    '230049': '名古屋市西区', '230057': '名古屋市中村区', '230065': '名古屋市中区',
    '230073': '名古屋市昭和区', '230081': '名古屋市瑞穂区', '230090': '名古屋市熱田区',
    '230103': '名古屋市中川区', '230111': '名古屋市港区', '230120': '名古屋市南区',
    '230138': '名古屋市守山区', '230146': '名古屋市緑区', '230154': '名古屋市名東区',
    '230162': '名古屋市天白区',
    '230078': '春日井市', '230086': '小牧市',
    '230171': '豊橋市', '230189': '岡崎市', '230197': '一宮市',
    '230200': '瀬戸市', '230219': '半田市', '230227': '豊川市',
    '230235': '津島市', '230243': '碧南市', '230251': '刈谷市',
    '230260': '豊田市', '230278': '安城市', '230286': '犬山市',
    '230292': '岩倉市', '230294': '江南市',
    '230308': '稲沢市', '230316': '豊明市',
    '230326': '清須市', '230334': '北名古屋市', '230342': 'あま市',
    '230351': '長久手市', '230367': '東郷町', '230375': '豊山町',
    '230383': '大口町', '230391': '扶桑町',
    '234011': '海部郡蟹江町', '234029': '海部郡大治町', '234037': '海部郡飛島村',
    '39230008': '愛知県（後期高齢者）',
  };

  // ============================================================
  // ユーティリティ
  // ============================================================

  function downloadCSV(filename, csvContent) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, filename);
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
    triggerDownload(blob, filename);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvField(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function he(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getDisplayMonth() {
    const firstReceipt = [...(allReceipts.shaho || []), ...(allReceipts.kokuho || []),
                          ...(allReceipts.shahoHenrei || []), ...(allReceipts.kokuhoHenrei || [])][0];
    const m = firstReceipt ? firstReceipt.billingMonth : (institution.billingMonth || '');
    return formatMonth(m);
  }

  /** YYYYMM → 令和XX年X月 */
  function toWareki(yyyymm) {
    if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
    const y = parseInt(yyyymm.substring(0, 4));
    const m = parseInt(yyyymm.substring(4, 6));
    const reiwa = y - 2018;
    return '令和' + (reiwa < 10 ? '0' : '') + reiwa + '年' + m + '月';
  }

  /** 提出年月（診療月の翌月1日） */
  function getSubmitDate(yyyymm) {
    if (!yyyymm || yyyymm.length < 6) return '';
    let y = parseInt(yyyymm.substring(0, 4));
    let m = parseInt(yyyymm.substring(4, 6)) + 1;
    if (m > 12) { m = 1; y++; }
    const reiwa = y - 2018;
    return '令和' + (reiwa < 10 ? '0' : '') + reiwa + '年' + m + '月1日';
  }

  /** 保険者番号→名称 */
  function getInsurerName(num) {
    return INSURER_NAMES[num] || ('保険者' + num);
  }

  /** レセプト種別コードから保険分類を取得 */
  function getInsuranceCategory(receipt) {
    const code = receipt.insuranceTypeCode || '';
    if (code.length < 4) return { type: 'other', label: '不明' };
    const d1 = code[1];
    const d2 = code[2]; // 1=本人, 2=未就学, 3=家族
    const d3 = code[3]; // 0=一般, 2=本人外来, 4=6歳未満, 6=家族外来, 8=高齢
    switch (d1) {
      case '1': return { type: 'shaho', subType: d2, ageType: d3, label: '社保' };
      case '2': return { type: 'kouhi', subType: d2, ageType: d3, label: '公費' };
      case '3': return { type: 'kokuho', subType: d2, ageType: d3, label: '国保' };
      case '4': return { type: 'taishoku', subType: d2, ageType: d3, label: '退職' };
      case '6': return { type: 'kouki', subType: d2, ageType: d3, label: '後期高齢' };
      default: return { type: 'other', label: '不明' };
    }
  }

  // ============================================================
  // 1. レセプト一覧 CSV出力
  // ============================================================

  function hasAnyData() {
    return (allReceipts.shaho || []).length > 0 || (allReceipts.kokuho || []).length > 0 ||
           (allReceipts.shahoHenrei || []).length > 0 || (allReceipts.kokuhoHenrei || []).length > 0;
  }

  function exportListCSV() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    const rows = [['種別', 'カルテ番号', '氏名', '性別', '生年月日', '保険種別',
                   '保険者番号', '被保険者番号', '実日数', '合計点数', '一部負担金', '警告数'].join(',')];

    for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
      const label = { shaho: '社保', kokuho: '国保', shahoHenrei: '社保返戻', kokuhoHenrei: '国保返戻' }[key];
      for (const r of (allReceipts[key] || [])) {
        const warnCount = r.warnings.filter(w => w.severity !== 'info').length;
        const copay = r.insurance ? r.insurance.copayAmount : 0;
        rows.push([
          csvField(label), csvField(r.karteNumber), csvField(r.name), csvField(r.sex),
          csvField(formatDate(r.dob)), csvField(r.insuranceType),
          csvField(r.insurance ? r.insurance.insurerNumber : ''),
          csvField(r.insurance ? r.insurance.insuredNumber : ''),
          r.visitDays.length, r.totalPoints, copay, warnCount,
        ].join(','));
      }
    }
    const month = getDisplayMonth();
    downloadCSV('レセプト一覧_' + month + '.csv', rows.join('\r\n'));
  }

  // ============================================================
  // 2. 要確認レセプト CSV出力
  // ============================================================

  function exportChecklistCSV() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    const rows = [['種別', 'カルテ番号', '氏名', '保険種別', '深刻度', 'チェック内容'].join(',')];
    const sevLabel = { high: '高', mid: '中', low: '低', info: '情報' };

    for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
      const label = { shaho: '社保', kokuho: '国保', shahoHenrei: '社保返戻', kokuhoHenrei: '国保返戻' }[key];
      for (const r of (allReceipts[key] || [])) {
        for (const w of r.warnings) {
          rows.push([
            csvField(label), csvField(r.karteNumber), csvField(r.name),
            csvField(r.insuranceType), csvField(sevLabel[w.severity] || w.severity),
            csvField(w.message),
          ].join(','));
        }
      }
    }
    const month = getDisplayMonth();
    downloadCSV('要確認レセプト_' + month + '.csv', rows.join('\r\n'));
  }

  // ============================================================
  // 3. レセプト詳細 CSV出力
  // ============================================================

  function exportDetailCSV(receipt) {
    if (!receipt) return;
    const rows = [];
    rows.push('# 患者情報');
    rows.push(['氏名', csvField(receipt.name)].join(','));
    rows.push(['カルテ番号', csvField(receipt.karteNumber)].join(','));
    rows.push(['性別', csvField(receipt.sex)].join(','));
    rows.push(['生年月日', csvField(formatDate(receipt.dob))].join(','));
    rows.push(['保険種別', csvField(receipt.insuranceType)].join(','));
    if (receipt.insurance) {
      rows.push(['保険者番号', csvField(receipt.insurance.insurerNumber)].join(','));
      rows.push(['被保険者番号', csvField(receipt.insurance.insuredNumber)].join(','));
    }
    rows.push(['診療年月', csvField(formatMonth(receipt.billingMonth))].join(','));
    rows.push(['合計点数', receipt.totalPoints].join(','));
    rows.push(['実日数', receipt.visitDays.length].join(','));
    rows.push('');
    rows.push('# 傷病名');
    rows.push(['コード', '傷病名', '開始日', '修飾語'].join(','));
    for (const d of receipt.diseases) {
      const modName = d.modifier ? (MasterLoader.getModifierName(d.modifier) || MODIFIER_CODES[d.modifier] || d.modifier) : '';
      rows.push([csvField(d.code), csvField(d.name || d.code), csvField(formatDate(d.startDate)), csvField(modName)].join(','));
    }
    rows.push('');
    rows.push('# 診療内容');
    rows.push(['区分', '区分名', 'コード', '名称', '点数', '数量', '小計'].join(','));
    for (const p of receipt.procedures) {
      let displayName = p.name;
      if (!displayName && p.isDrug) {
        const drug = MasterLoader.getDrug(p.code);
        displayName = drug ? drug.name : p.code;
      }
      if (!displayName) displayName = p.code;
      const subtotal = (p.points && p.quantity) ? p.points * p.quantity : p.points || '';
      rows.push([csvField(p.category), csvField(CATEGORY_NAMES[p.category] || p.category),
        csvField(p.code), csvField(displayName), p.points || '', p.quantity || '', subtotal].join(','));
    }
    const month = getDisplayMonth();
    downloadCSV('レセプト詳細_' + receipt.karteNumber + '_' + receipt.name + '_' + month + '.csv', rows.join('\r\n'));
  }

  // ============================================================
  // 4. 総括表 CSV出力
  // ============================================================

  function exportSummaryCSV() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    const data = {};
    for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
      const list = allReceipts[key] || [];
      data[key] = {
        count: list.length,
        points: list.reduce((s, r) => s + r.totalPoints, 0),
        days: list.reduce((s, r) => s + r.visitDays.length, 0),
        copay: list.reduce((s, r) => s + (r.insurance ? r.insurance.copayAmount : 0), 0),
      };
    }
    const henrei = {
      count: data.shahoHenrei.count + data.kokuhoHenrei.count,
      points: data.shahoHenrei.points + data.kokuhoHenrei.points,
      days: data.shahoHenrei.days + data.kokuhoHenrei.days,
    };
    const total = {
      count: data.shaho.count + data.kokuho.count + henrei.count,
      points: data.shaho.points + data.kokuho.points + henrei.points,
      days: data.shaho.days + data.kokuho.days + henrei.days,
      copay: data.shaho.copay + data.kokuho.copay,
    };
    const rows = [];
    rows.push(['', '社保', '国保', '返戻（計）', '合計'].join(','));
    rows.push(['件数', data.shaho.count, data.kokuho.count, henrei.count, total.count].join(','));
    rows.push(['合計点数', data.shaho.points, data.kokuho.points, henrei.points, total.points].join(','));
    rows.push(['実日数合計', data.shaho.days, data.kokuho.days, henrei.days, total.days].join(','));
    rows.push(['一部負担金', data.shaho.copay, data.kokuho.copay, '-', total.copay].join(','));
    const month = getDisplayMonth();
    downloadCSV('総括表_' + month + '.csv', rows.join('\r\n'));
  }

  // ============================================================
  // 5. UKEファイルダウンロード
  // ============================================================

  let rawUkeData = {};

  function storeRawUke(fileType, text) {
    rawUkeData[fileType] = text;
  }

  function downloadUKE(fileType) {
    if (!rawUkeData[fileType]) {
      alert('UKEデータがありません（' + fileType + '）');
      return;
    }
    const month = getDisplayMonth().replace('/', '');
    downloadText('RECEIPTC_' + fileType + '_' + month + '.UKE', rawUkeData[fileType], 'application/octet-stream');
  }

  function downloadAllUKE() {
    let count = 0;
    for (const key of Object.keys(rawUkeData)) {
      if (rawUkeData[key]) { downloadUKE(key); count++; }
    }
    if (count === 0) alert('UKEデータが読み込まれていません');
  }

  // ============================================================
  // 6. 印刷用レセプト（個別）
  // ============================================================

  function printReceipt(receipt) {
    if (!receipt) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    const instName = institution.name || CLINIC.name;
    const month = formatMonth(receipt.billingMonth);

    let diseasesHtml = '';
    receipt.diseases.forEach((d, i) => {
      const modName = d.modifier ? (MasterLoader.getModifierName(d.modifier) || MODIFIER_CODES[d.modifier] || '') : '';
      diseasesHtml += '<tr><td>' + (i + 1) + '</td><td>' + he(d.name || d.code) + (modName ? ' (' + he(modName) + ')' : '') +
        '</td><td>' + formatDate(d.startDate) + '</td></tr>';
    });
    if (!diseasesHtml) diseasesHtml = '<tr><td colspan="3" style="text-align:center;color:#999;">傷病名なし</td></tr>';

    let procHtml = '';
    let lastCat = '';
    receipt.procedures.forEach(p => {
      if (p.category !== lastCat && p.category) {
        lastCat = p.category;
        const catName = CATEGORY_NAMES[p.category] || p.category;
        procHtml += '<tr style="background:#f0f0f0;font-weight:600;"><td colspan="5">' + he(catName) + ' (' + he(p.category) + ')</td></tr>';
      }
      let displayName = p.name;
      if (!displayName && p.isDrug) {
        const drug = MasterLoader.getDrug(p.code);
        displayName = drug ? drug.name : '[' + p.code + ']';
      }
      if (!displayName) displayName = '[' + p.code + ']';
      const subtotal = (p.points && p.quantity) ? p.points * p.quantity : p.points || '';
      procHtml += '<tr><td>' + he(displayName) + '</td><td style="text-align:right;">' + (p.points || '') +
        '</td><td style="text-align:right;">' + (p.quantity || '') +
        '</td><td style="text-align:right;">' + subtotal + '</td><td>' + he(p.code) + '</td></tr>';
    });

    const copay = receipt.insurance ? receipt.insurance.copayAmount : 0;
    let warningsHtml = '';
    const realWarns = receipt.warnings.filter(w => w.severity !== 'info');
    if (realWarns.length > 0) {
      warningsHtml = '<div class="section"><div class="section-head warn-head">チェック結果 (' + realWarns.length + '件)</div><table><tr><th>#</th><th>深刻度</th><th>内容</th></tr>';
      realWarns.forEach((w, i) => {
        const sevLabel = w.severity === 'high' ? '高' : w.severity === 'mid' ? '中' : '低';
        warningsHtml += '<tr><td>' + (i + 1) + '</td><td>' + sevLabel + '</td><td>' + he(w.message) + '</td></tr>';
      });
      warningsHtml += '</table></div>';
    }

    w.document.write(buildPrintHTML({
      title: 'レセプト詳細 — ' + he(receipt.name),
      body: `
        <div class="header-bar">${he(instName)} | 診療年月: ${month}</div>
        <h2>${he(receipt.name)} (${he(receipt.karteNumber)}) — ${he(receipt.insuranceType)}</h2>
        <div class="info-grid">
          <div><span class="label">保険者番号:</span> ${he(receipt.insurance ? receipt.insurance.insurerNumber : '-')}</div>
          <div><span class="label">被保険者番号:</span> ${he(receipt.insurance ? receipt.insurance.insuredNumber : '-')}</div>
          <div><span class="label">生年月日:</span> ${formatDate(receipt.dob)}</div>
          <div><span class="label">性別:</span> ${he(receipt.sex)}</div>
          <div><span class="label">受診日:</span> ${receipt.visitDays.join(', ')}日</div>
          <div><span class="label">給付割合:</span> ${receipt.copayRatio || '-'}%</div>
        </div>
        <div class="section">
          <div class="section-head">傷病名</div>
          <table><tr><th>#</th><th>傷病名</th><th>開始日</th></tr>${diseasesHtml}</table>
        </div>
        <div class="section">
          <div class="section-head">診療内容</div>
          <table><tr><th>名称</th><th style="width:60px;">点数</th><th style="width:40px;">数量</th><th style="width:60px;">小計</th><th style="width:100px;">コード</th></tr>${procHtml}</table>
        </div>
        <div class="total-bar">
          合計点数: <strong>${receipt.totalPoints.toLocaleString()}</strong>
          &nbsp;&nbsp; 実日数: ${receipt.visitDays.length}
          &nbsp;&nbsp; 一部負担金: ${copay ? copay.toLocaleString() + '円' : '-'}
        </div>
        ${warningsHtml}
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 7. 総括表 印刷（簡易サマリー）
  // ============================================================

  function printSummary() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    const data = {};
    for (const key of ['shaho', 'kokuho', 'shahoHenrei', 'kokuhoHenrei']) {
      const list = allReceipts[key] || [];
      data[key] = {
        count: list.length, points: list.reduce((s, r) => s + r.totalPoints, 0),
        days: list.reduce((s, r) => s + r.visitDays.length, 0),
        copay: list.reduce((s, r) => s + (r.insurance ? r.insurance.copayAmount : 0), 0),
      };
    }
    const henreiCount = data.shahoHenrei.count + data.kokuhoHenrei.count;
    const henreiPts = data.shahoHenrei.points + data.kokuhoHenrei.points;
    const henreiDays = data.shahoHenrei.days + data.kokuhoHenrei.days;
    const total = {
      count: data.shaho.count + data.kokuho.count + henreiCount,
      points: data.shaho.points + data.kokuho.points + henreiPts,
      days: data.shaho.days + data.kokuho.days + henreiDays,
      copay: data.shaho.copay + data.kokuho.copay,
    };
    const instName = institution.name || CLINIC.name;
    const month = getDisplayMonth();
    let shahoDetail = buildCategoryBreakdown(allReceipts.shaho || [], '社保');
    let kokuhoDetail = buildCategoryBreakdown(allReceipts.kokuho || [], '国保');

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }
    w.document.write(buildPrintHTML({
      title: '総括表 — ' + month,
      body: `
        <div class="header-bar">${he(instName)} | 請求年月: ${month}</div>
        <h2>レセプト総括表</h2>
        <div class="section"><div class="section-head">サマリー</div>
          <table>
            <tr><th></th><th style="text-align:right;">社保</th><th style="text-align:right;">国保</th><th style="text-align:right;">返戻（計）</th><th style="text-align:right;font-weight:700;">合計</th></tr>
            <tr><td style="font-weight:600;">件数</td><td style="text-align:right;">${data.shaho.count}</td><td style="text-align:right;">${data.kokuho.count}</td><td style="text-align:right;">${henreiCount}</td><td style="text-align:right;font-weight:700;">${total.count}</td></tr>
            <tr><td style="font-weight:600;">合計点数</td><td style="text-align:right;">${data.shaho.points.toLocaleString()}</td><td style="text-align:right;">${data.kokuho.points.toLocaleString()}</td><td style="text-align:right;">${henreiPts.toLocaleString()}</td><td style="text-align:right;font-weight:700;">${total.points.toLocaleString()}</td></tr>
            <tr><td style="font-weight:600;">実日数合計</td><td style="text-align:right;">${data.shaho.days}</td><td style="text-align:right;">${data.kokuho.days}</td><td style="text-align:right;">${henreiDays}</td><td style="text-align:right;font-weight:700;">${total.days}</td></tr>
            <tr><td style="font-weight:600;">一部負担金</td><td style="text-align:right;">${data.shaho.copay.toLocaleString()}</td><td style="text-align:right;">${data.kokuho.copay.toLocaleString()}</td><td style="text-align:right;">-</td><td style="text-align:right;font-weight:700;">${total.copay.toLocaleString()}</td></tr>
          </table>
        </div>
        ${shahoDetail}${kokuhoDetail}
        <div style="margin-top:16px;font-size:10px;color:#999;">
          ※ UKEファイルから自動集計した参考値です。<br>出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 8. 要確認レセプト一覧 印刷
  // ============================================================

  function printChecklist() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    const allWarns = [];
    for (const key of Object.keys(allReceipts)) {
      const label = { shaho: '社保', kokuho: '国保', shahoHenrei: '社保返戻', kokuhoHenrei: '国保返戻' }[key];
      for (const r of (allReceipts[key] || [])) {
        for (const w of r.warnings) {
          if (w.severity === 'info') continue;
          allWarns.push({ karteNumber: r.karteNumber, name: r.name, insuranceType: r.insuranceType, severity: w.severity, message: w.message, fileType: label });
        }
      }
    }
    const sevOrder = { high: 0, mid: 1, low: 2 };
    allWarns.sort((a, b) => (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9));

    let tableRows = '';
    if (allWarns.length === 0) {
      tableRows = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#3a6b35;">全レセプト問題なし</td></tr>';
    } else {
      allWarns.forEach((w, i) => {
        const sevLabel = w.severity === 'high' ? '高' : w.severity === 'mid' ? '中' : '低';
        const sevColor = w.severity === 'high' ? '#c1272d' : w.severity === 'mid' ? '#b45309' : '#457b9d';
        tableRows += '<tr' + (w.severity === 'high' ? ' style="background:#fff0f0;"' : '') + '>' +
          '<td>' + (i + 1) + '</td><td>' + he(w.fileType) + '</td><td>' + he(w.karteNumber) + '</td>' +
          '<td>' + he(w.name) + '</td><td style="color:' + sevColor + ';font-weight:600;">' + sevLabel + '</td>' +
          '<td>' + he(w.message) + '</td></tr>';
      });
    }

    const instName = institution.name || CLINIC.name;
    const month = getDisplayMonth();
    const high = allWarns.filter(w => w.severity === 'high').length;
    const mid = allWarns.filter(w => w.severity === 'mid').length;
    const low = allWarns.filter(w => w.severity === 'low').length;

    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) { alert('ポップアップがブロックされました'); return; }
    win.document.write(buildPrintHTML({
      title: '要確認レセプト一覧 — ' + month,
      body: `
        <div class="header-bar">${he(instName)} | 診療年月: ${month}</div>
        <h2>要確認レセプト チェック結果</h2>
        <div style="margin-bottom:12px;font-size:12px;">
          警告合計: <strong style="color:#c1272d;">${allWarns.length}件</strong>（高: ${high} / 中: ${mid} / 低: ${low}）
        </div>
        <table>
          <tr><th>#</th><th>種別</th><th>カルテ番号</th><th>氏名</th><th>深刻度</th><th>チェック内容</th></tr>
          ${tableRows}
        </table>
        <div style="margin-top:12px;font-size:10px;color:#999;">出力日時: ${new Date().toLocaleString('ja-JP')}</div>
      `
    }));
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  // ============================================================
  // 9. 社保総括表（様式第一）印刷
  // ============================================================

  function printShahoSoukatu() {
    const receipts = allReceipts.shaho || [];
    if (receipts.length === 0) { alert('社保データがありません'); return; }

    const billingMonth = receipts[0] ? receipts[0].billingMonth : '';
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);

    // 保険区分別集計
    // 協会(01): 保険者番号が01で始まる
    // 組合(06): 保険者番号が06で始まる
    // 共済(31-34): 保険者番号が31-34で始まる
    // 船員(02): 保険者番号が02
    // 日雇(63): 保険者番号が63
    // 公費単独(2x): insuranceTypeCodeの2桁目が2
    const cats = {
      kyokai: { label: '協会けんぽ', count: 0, days: 0, points: 0 },
      kumiai: { label: '組合健保', count: 0, days: 0, points: 0 },
      kyosai: { label: '共済', count: 0, days: 0, points: 0 },
      senin:  { label: '船員', count: 0, days: 0, points: 0 },
      hiyatoi:{ label: '日雇', count: 0, days: 0, points: 0 },
      kouhi:  { label: '公費単独', count: 0, days: 0, points: 0 },
      other:  { label: 'その他', count: 0, days: 0, points: 0 },
    };

    for (const r of receipts) {
      const insurerNum = r.insurance ? r.insurance.insurerNumber : '';
      const insCategory = getInsuranceCategory(r);
      let cat = 'other';

      if (insCategory.type === 'kouhi') {
        cat = 'kouhi';
      } else if (insurerNum.startsWith('01') || insurerNum.startsWith('39')) {
        // 協会けんぽは保険者番号の法別番号01
        // ただし39は後期高齢者（社保ファイルには通常入らないが念のため）
        cat = insurerNum.startsWith('39') ? 'other' : 'kyokai';
      } else if (insurerNum.startsWith('06')) {
        cat = 'kumiai';
      } else if (/^(31|32|33|34)/.test(insurerNum)) {
        cat = 'kyosai';
      } else if (insurerNum.startsWith('02')) {
        cat = 'senin';
      } else if (insurerNum.startsWith('63')) {
        cat = 'hiyatoi';
      } else {
        // 法別番号から分類
        const houbetsu = insurerNum.substring(0, 2);
        if (houbetsu === '01') cat = 'kyokai';
        else if (houbetsu === '06') cat = 'kumiai';
        else if (['31','32','33','34'].includes(houbetsu)) cat = 'kyosai';
        else if (houbetsu === '02') cat = 'senin';
        else if (houbetsu === '63') cat = 'hiyatoi';
        else cat = 'other';
      }

      cats[cat].count++;
      cats[cat].days += r.visitDays.length;
      cats[cat].points += r.totalPoints;
    }

    const totalCount = receipts.length;
    const totalDays = receipts.reduce((s, r) => s + r.visitDays.length, 0);
    const totalPoints = receipts.reduce((s, r) => s + r.totalPoints, 0);

    // 公費集計（KOレコード持ちの患者）
    let kouhiReceipts = receipts.filter(r => r.kouhi && r.kouhi.length > 0);
    const kouhiByHoubetsu = {};
    for (const r of kouhiReceipts) {
      for (const k of r.kouhi) {
        const houbetsu = k.futanshaNumber.substring(0, 2);
        const label = { '12': '生活保護', '21': '精神通院', '51': '特定疾患', '54': '特定医療費(難病)',
          '81': 'こども医療', '82': '障害者医療', '83': 'ひとり親', '85': 'こども(85)', '89': '福祉給付金', '19': '被爆者' }[houbetsu] || ('公費' + houbetsu);
        if (!kouhiByHoubetsu[houbetsu]) kouhiByHoubetsu[houbetsu] = { label: label, count: 0, points: 0 };
        kouhiByHoubetsu[houbetsu].count++;
        kouhiByHoubetsu[houbetsu].points += r.totalPoints;
      }
    }

    let catRows = '';
    for (const [key, d] of Object.entries(cats)) {
      if (d.count === 0) continue;
      catRows += `<tr><td style="font-weight:600;">${he(d.label)}</td>
        <td style="text-align:right;">${d.count}</td>
        <td style="text-align:right;">${d.days}</td>
        <td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`;
    }

    let kouhiRows = '';
    for (const [houbetsu, d] of Object.entries(kouhiByHoubetsu)) {
      kouhiRows += `<tr style="color:#457b9d;"><td style="padding-left:20px;">公費(${he(houbetsu)}) ${he(d.label)}</td>
        <td style="text-align:right;">${d.count}</td><td></td>
        <td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`;
    }

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    w.document.write(buildOfficialFormHTML({
      title: '社保総括表（様式第一）',
      body: `
        <div class="form-title">診療報酬請求書<span style="font-size:12px;color:#666;margin-left:12px;">（様式第一 医科・入院外）</span></div>
        <div class="form-subtitle">${wareki}分</div>
        <div class="form-dest">社会保険診療報酬支払基金 ${he(CLINIC.prefectureName)}支部 御中</div>

        <table class="form-info">
          <tr><td class="fi-label">医療機関コード</td><td>${he(institution.code || CLINIC.code)}</td>
              <td class="fi-label">所在地</td><td>${he(CLINIC.address)}</td></tr>
          <tr><td class="fi-label">名称</td><td>${he(institution.name || CLINIC.name)}</td>
              <td class="fi-label">開設者氏名</td><td>${he(CLINIC.founder)}</td></tr>
          <tr><td class="fi-label">請求日</td><td colspan="3">${submitDate}</td></tr>
        </table>

        <div class="form-section-title">保険区分別内訳</div>
        <table class="form-table">
          <tr><th>区分</th><th style="width:80px;">件数</th><th style="width:80px;">実日数</th><th style="width:120px;">点数</th></tr>
          ${catRows}
          <tr style="font-weight:700;border-top:2px solid #333;">
            <td>合計</td><td style="text-align:right;">${totalCount}</td>
            <td style="text-align:right;">${totalDays}</td>
            <td style="text-align:right;">${totalPoints.toLocaleString()}</td>
          </tr>
        </table>

        ${kouhiRows ? `
        <div class="form-section-title" style="margin-top:16px;">公費負担分（再掲）</div>
        <table class="form-table">
          <tr><th>公費種別</th><th style="width:80px;">件数</th><th style="width:80px;"></th><th style="width:120px;">点数</th></tr>
          ${kouhiRows}
        </table>` : ''}

        <div class="form-footer-note">
          ※ UKEファイルから自動集計した参考値です。正式提出時は審査支払機関の総括表をご使用ください。<br>
          出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 10. 国保総括表（保険者別）印刷
  // ============================================================

  function printKokuhoSoukatu() {
    const receipts = allReceipts.kokuho || [];
    if (receipts.length === 0) { alert('国保データがありません'); return; }

    const billingMonth = receipts[0] ? receipts[0].billingMonth : '';
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);

    // 国保と後期に分離
    const kokuhoList = [];
    const koukiList = [];
    for (const r of receipts) {
      const cat = getInsuranceCategory(r);
      if (cat.type === 'kouki') koukiList.push(r);
      else kokuhoList.push(r);
    }

    // 保険者番号別集計（国保）
    function groupByInsurer(list) {
      const map = {};
      for (const r of list) {
        const num = r.insurance ? r.insurance.insurerNumber : '不明';
        if (!map[num]) map[num] = { insurerNumber: num, name: getInsurerName(num), count: 0, days: 0, points: 0, copay: 0 };
        map[num].count++;
        map[num].days += r.visitDays.length;
        map[num].points += r.totalPoints;
        map[num].copay += r.insurance ? r.insurance.copayAmount : 0;
      }
      return Object.values(map).sort((a, b) => a.insurerNumber.localeCompare(b.insurerNumber));
    }

    const kokuhoInsurers = groupByInsurer(kokuhoList);
    const koukiInsurers = groupByInsurer(koukiList);

    function makeInsurerTable(insurers, label) {
      if (insurers.length === 0) return `<div class="form-section-title">${he(label)}</div><p style="text-align:center;color:#999;padding:12px;">対象なし</p>`;
      let rows = '';
      let totalCount = 0, totalDays = 0, totalPoints = 0, totalCopay = 0;
      for (const ins of insurers) {
        rows += `<tr>
          <td>${he(ins.insurerNumber)}</td><td>${he(ins.name)}</td>
          <td style="text-align:right;">${ins.count}</td>
          <td style="text-align:right;">${ins.days}</td>
          <td style="text-align:right;">${ins.points.toLocaleString()}</td>
          <td style="text-align:right;">${ins.copay ? ins.copay.toLocaleString() : '-'}</td>
        </tr>`;
        totalCount += ins.count; totalDays += ins.days;
        totalPoints += ins.points; totalCopay += ins.copay;
      }
      return `
        <div class="form-section-title">${he(label)} (${totalCount}件)</div>
        <table class="form-table">
          <tr><th>保険者番号</th><th>保険者名</th><th style="width:60px;">件数</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th><th style="width:90px;">一部負担金</th></tr>
          ${rows}
          <tr style="font-weight:700;border-top:2px solid #333;">
            <td colspan="2">合計</td>
            <td style="text-align:right;">${totalCount}</td>
            <td style="text-align:right;">${totalDays}</td>
            <td style="text-align:right;">${totalPoints.toLocaleString()}</td>
            <td style="text-align:right;">${totalCopay ? totalCopay.toLocaleString() : '-'}</td>
          </tr>
        </table>`;
    }

    // 後期高齢者 負担割合別集計
    let koukiByRatio = '';
    if (koukiList.length > 0) {
      const ratioMap = {};
      for (const r of koukiList) {
        const ratio = r.copayRatio || '不明';
        const label = ratio === '90' ? '9割' : ratio === '80' ? '8割' : ratio === '70' ? '7割' : ratio + '%';
        if (!ratioMap[ratio]) ratioMap[ratio] = { label: label, count: 0, days: 0, points: 0 };
        ratioMap[ratio].count++;
        ratioMap[ratio].days += r.visitDays.length;
        ratioMap[ratio].points += r.totalPoints;
      }
      let ratioRows = '';
      for (const [ratio, d] of Object.entries(ratioMap).sort((a, b) => b[0].localeCompare(a[0]))) {
        ratioRows += `<tr><td>${he(d.label)}</td><td style="text-align:right;">${d.count}</td>
          <td style="text-align:right;">${d.days}</td><td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`;
      }
      koukiByRatio = `
        <div class="form-section-title" style="margin-top:8px;">後期高齢者 負担割合別</div>
        <table class="form-table">
          <tr><th>負担割合</th><th style="width:60px;">件数</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th></tr>
          ${ratioRows}
        </table>`;
    }

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    w.document.write(buildOfficialFormHTML({
      title: '国保総括表（一覧）',
      body: `
        <div class="form-title">診療報酬等請求総括表<span style="font-size:12px;color:#666;margin-left:12px;">（国保・後期高齢者）</span></div>
        <div class="form-subtitle">${wareki}分</div>
        <div class="form-dest">${he(CLINIC.prefectureName)}国民健康保険団体連合会 御中</div>

        <table class="form-info">
          <tr><td class="fi-label">医療機関コード</td><td>${he(institution.code || CLINIC.code)}</td>
              <td class="fi-label">名称</td><td>${he(institution.name || CLINIC.name)}</td></tr>
          <tr><td class="fi-label">請求日</td><td colspan="3">${submitDate}</td></tr>
        </table>

        ${makeInsurerTable(kokuhoInsurers, '国保 当月分')}
        ${makeInsurerTable(koukiInsurers, '後期高齢者 当月分')}
        ${koukiByRatio}

        <div class="form-footer-note">
          ※ UKEファイルから自動集計した参考値です。<br>出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 11. 光ディスク等送付書 印刷（社保/国保）
  // ============================================================

  function printDiscCoverLetter(target) {
    // target: 'shaho' or 'kokuho'
    const receipts = target === 'shaho' ? (allReceipts.shaho || []) : (allReceipts.kokuho || []);
    const billingMonth = receipts[0] ? receipts[0].billingMonth : (institution.billingMonth || '');
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);

    const dest = target === 'shaho'
      ? '社会保険診療報酬支払基金 ' + CLINIC.prefectureName + '支部 御中'
      : CLINIC.prefectureName + '国民健康保険団体連合会 御中';

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    w.document.write(buildOfficialFormHTML({
      title: '光ディスク等送付書',
      body: `
        <div class="form-title">光ディスク等送付書</div>
        <div class="form-dest" style="margin-top:20px;font-size:16px;">${he(dest)}</div>

        <p style="margin:20px 0;font-size:13px;">
          下記のとおり、診療（調剤）報酬等の請求に係る光ディスク等を送付します。
        </p>

        <table class="form-table" style="max-width:500px;">
          <tr><td class="fi-label" style="width:180px;">点数表区分</td><td>医科</td></tr>
          <tr><td class="fi-label">診療（調剤）月分</td><td>${wareki}</td></tr>
          <tr><td class="fi-label">媒体種類</td><td>CD-R</td></tr>
          <tr><td class="fi-label">媒体枚数</td><td>1枚</td></tr>
          <tr><td class="fi-label">提出年月日</td><td>${submitDate}</td></tr>
        </table>

        <div style="margin-top:40px;border-top:1px solid #ccc;padding-top:16px;">
          <table class="form-table" style="max-width:500px;">
            <tr><td class="fi-label" style="width:180px;">医療機関コード</td><td>${he(institution.code || CLINIC.code)}</td></tr>
            <tr><td class="fi-label">所在地</td><td>${he(CLINIC.address)}</td></tr>
            <tr><td class="fi-label">名称</td><td>${he(institution.name || CLINIC.name)}</td></tr>
            <tr><td class="fi-label">開設者氏名</td><td>${he(CLINIC.founder)}</td></tr>
          </table>
        </div>

        <div class="form-footer-note">
          ※ 印刷後、開設者印を押印の上ご提出ください。<br>
          出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 12. 返戻処理結果.txt ダウンロード
  // ============================================================

  function downloadHenreiResult(target) {
    // target: 'shaho' or 'kokuho'
    const henreiKey = target + 'Henrei';
    const receipts = allReceipts[henreiKey] || [];
    const billingMonth = getDisplayMonth();
    const label = target === 'shaho' ? '社保' : '国保';

    let text = '';
    if (receipts.length === 0) {
      text = '返戻処理結果\r\n\r\n' +
        '医療機関: ' + (institution.name || CLINIC.name) + '\r\n' +
        '処理日: ' + new Date().toLocaleDateString('ja-JP') + '\r\n' +
        '対象: ' + label + '\r\n\r\n' +
        '出力対象のレセプトが見つかりません\r\n';
    } else {
      text = '返戻処理結果\r\n\r\n' +
        '医療機関: ' + (institution.name || CLINIC.name) + '\r\n' +
        '処理日: ' + new Date().toLocaleDateString('ja-JP') + '\r\n' +
        '対象: ' + label + '\r\n' +
        '件数: ' + receipts.length + '\r\n\r\n' +
        '--- 返戻レセプト一覧 ---\r\n';
      receipts.forEach((r, i) => {
        text += (i + 1) + '. カルテ番号: ' + r.karteNumber +
          ' | 氏名: ' + r.name +
          ' | 診療月: ' + formatMonth(r.billingMonth) +
          ' | 点数: ' + r.totalPoints + '\r\n';
      });
    }

    downloadText('返戻処理結果_' + label + '_' + billingMonth.replace('/', '') + '.txt', text);
  }

  // ============================================================
  // 13. 返戻用総括表 印刷
  // ============================================================

  function printHenreiSoukatu(target) {
    const henreiKey = target + 'Henrei';
    const receipts = allReceipts[henreiKey] || [];
    const label = target === 'shaho' ? '社保' : '国保';
    const dest = target === 'shaho'
      ? '社会保険診療報酬支払基金 ' + CLINIC.prefectureName + '支部 御中'
      : CLINIC.prefectureName + '国民健康保険団体連合会 御中';

    if (receipts.length === 0) {
      alert('返戻データがありません（' + label + '）');
      return;
    }

    const billingMonth = receipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(institution.billingMonth || billingMonth);

    let rows = '';
    let totalPoints = 0, totalDays = 0;
    receipts.forEach((r, i) => {
      rows += `<tr>
        <td>${i + 1}</td><td>${he(r.karteNumber)}</td><td>${he(r.name)}</td>
        <td>${he(r.insuranceType)}</td>
        <td style="text-align:right;">${r.visitDays.length}</td>
        <td style="text-align:right;">${r.totalPoints.toLocaleString()}</td>
      </tr>`;
      totalPoints += r.totalPoints;
      totalDays += r.visitDays.length;
    });

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    w.document.write(buildOfficialFormHTML({
      title: '返戻用' + label + '総括表',
      body: `
        <div class="form-title">返戻分 診療報酬請求書<span style="font-size:12px;color:#666;margin-left:12px;">（${he(label)}）</span></div>
        <div class="form-dest">${he(dest)}</div>

        <table class="form-info">
          <tr><td class="fi-label">医療機関コード</td><td>${he(institution.code || CLINIC.code)}</td>
              <td class="fi-label">名称</td><td>${he(institution.name || CLINIC.name)}</td></tr>
          <tr><td class="fi-label">請求日</td><td colspan="3">${submitDate}</td></tr>
        </table>

        <div class="form-section-title">返戻レセプト一覧 (${receipts.length}件)</div>
        <table class="form-table">
          <tr><th>#</th><th>カルテ番号</th><th>氏名</th><th>保険種別</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th></tr>
          ${rows}
          <tr style="font-weight:700;border-top:2px solid #333;">
            <td colspan="4">合計</td>
            <td style="text-align:right;">${totalDays}</td>
            <td style="text-align:right;">${totalPoints.toLocaleString()}</td>
          </tr>
        </table>

        <div class="form-footer-note">
          ※ UKEファイルから自動集計した参考値です。<br>出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 14. 公費医療費請求書 印刷（市町村別）
  // ============================================================

  function printKouhiSeikyu() {
    // 公費(KOレコード)を持つ全レセプトを市町村ごとにグループ化
    const allKouhiReceipts = [];
    for (const key of ['shaho', 'kokuho']) {
      for (const r of (allReceipts[key] || [])) {
        if (r.kouhi && r.kouhi.length > 0) {
          allKouhiReceipts.push(r);
        }
      }
    }

    if (allKouhiReceipts.length === 0) {
      alert('公費データがありません');
      return;
    }

    // 市町村(保険者番号ベース)でグルーピング
    const cityMap = {};
    for (const r of allKouhiReceipts) {
      // 市町村特定: 保険者番号の上6桁、または公費負担者番号の構成から
      const insurerNum = r.insurance ? r.insurance.insurerNumber : '';
      // 市町村コード: 保険者番号の3-6桁目 or 公費負担者番号の3-8桁目
      let cityKey = insurerNum || 'unknown';
      let cityName = getInsurerName(insurerNum);

      // 後期高齢者の場合、公費負担者番号から市町村を特定
      if (insurerNum.startsWith('39')) {
        const kouhiNum = r.kouhi[0] ? r.kouhi[0].futanshaNumber : '';
        if (kouhiNum.length >= 8) {
          // 公費負担者番号: 法別2桁 + 都道府県2桁 + 実施機関(市町村)4桁
          cityKey = 'kouhi_' + kouhiNum.substring(0, 8);
          cityName = '公費市町村(' + kouhiNum.substring(4, 8) + ')';
        }
      }

      if (!cityMap[cityKey]) cityMap[cityKey] = { cityName: cityName, insurerNumber: insurerNum, receipts: [] };
      cityMap[cityKey].receipts.push(r);
    }

    const billingMonth = allKouhiReceipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);

    let pages = '';
    let pageNum = 0;
    for (const [cityKey, group] of Object.entries(cityMap)) {
      pageNum++;
      let rows = '';
      let totalPoints = 0, totalAmount = 0;

      for (const r of group.receipts) {
        const kouhiInfo = r.kouhi[0] || {};
        const kouhiType = kouhiInfo.futanshaNumber ? kouhiInfo.futanshaNumber.substring(0, 2) : '';
        const typeLabel = { '12': '生活保護', '21': '精神通院', '51': '特定疾患', '54': '難病',
          '81': 'こども', '82': '障害者', '83': 'ひとり親', '85': 'こども', '89': '福祉給付金' }[kouhiType] || kouhiType;
        // 金額 = 点数 × 10 × 公費負担割合（概算: 3割負担なら7割公費 = 点数×7）
        // 簡易計算: 一部負担金がある場合、総額 - 一部負担金
        const amount = r.totalPoints * 10 - (r.insurance ? r.insurance.copayAmount : 0);

        rows += `<tr>
          <td>${he(kouhiInfo.jukyushaNumber || '-')}</td>
          <td>${he(r.name)}</td>
          <td>${he(typeLabel)}</td>
          <td style="text-align:right;">${r.totalPoints.toLocaleString()}</td>
          <td style="text-align:right;">${amount > 0 ? amount.toLocaleString() + '円' : '-'}</td>
        </tr>`;
        totalPoints += r.totalPoints;
        totalAmount += amount > 0 ? amount : 0;
      }

      pages += `
        ${pageNum > 1 ? '<div style="page-break-before:always;"></div>' : ''}
        <div class="form-title" style="font-size:14px;">医療費請求書<span style="font-size:11px;color:#666;margin-left:8px;">${wareki}分 (${pageNum}/${Object.keys(cityMap).length})</span></div>
        <div class="form-dest" style="font-size:14px;">${he(group.cityName)} 長 様</div>

        <table class="form-info" style="margin-top:12px;">
          <tr><td class="fi-label" style="width:140px;">医療機関名</td><td>${he(institution.name || CLINIC.name)}</td></tr>
          <tr><td class="fi-label">医療機関コード</td><td>${he(institution.code || CLINIC.code)}</td></tr>
          <tr><td class="fi-label">請求件数</td><td>${group.receipts.length}件</td></tr>
          <tr><td class="fi-label">請求金額合計</td><td style="font-weight:700;">${totalAmount.toLocaleString()}円</td></tr>
        </table>

        <table class="form-table" style="margin-top:12px;">
          <tr><th>受給者番号</th><th>氏名</th><th>公費種別</th><th style="width:80px;">点数</th><th style="width:100px;">請求金額</th></tr>
          ${rows}
          <tr style="font-weight:700;border-top:2px solid #333;">
            <td colspan="3">合計</td>
            <td style="text-align:right;">${totalPoints.toLocaleString()}</td>
            <td style="text-align:right;">${totalAmount.toLocaleString()}円</td>
          </tr>
        </table>
      `;
    }

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('ポップアップがブロックされました'); return; }

    w.document.write(buildOfficialFormHTML({
      title: '公費医療費請求書',
      body: pages + `
        <div class="form-footer-note">
          ※ UKEファイルから自動集計した参考値です。金額は概算です。<br>
          出力日時: ${new Date().toLocaleString('ja-JP')}
        </div>
      `
    }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ============================================================
  // 15. エクスポートメニュー UI
  // ============================================================

  function showExportMenu(e) {
    const old = document.getElementById('exportMenu');
    if (old) { old.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'exportMenu';
    menu.className = 'rc-export-menu';
    menu.innerHTML = `
      <div class="rc-export-title">データ出力</div>
      <button onclick="ReceiptExporter.exportAllAsZip();closeExportMenu();" style="background:#264653;color:#fff;font-weight:700;font-size:14px;padding:10px 16px;border:none;border-radius:4px;cursor:pointer;width:100%;margin-bottom:8px;">全ファイル一括出力（ZIP）</button>

      <div class="rc-export-group">CSV出力</div>
      <button onclick="ReceiptExporter.exportListCSV();closeExportMenu();">レセプト一覧 CSV</button>
      <button onclick="ReceiptExporter.exportChecklistCSV();closeExportMenu();">要確認一覧 CSV</button>
      <button onclick="ReceiptExporter.exportSummaryCSV();closeExportMenu();">総括表 CSV</button>

      <div class="rc-export-group">公式帳票（印刷）</div>
      <button onclick="ReceiptExporter.printShahoSoukatu();closeExportMenu();">社保総括表（様式第一）</button>
      <button onclick="ReceiptExporter.printKokuhoSoukatu();closeExportMenu();">国保総括表（保険者別）</button>
      <button onclick="ReceiptExporter.printDiscCoverLetter('shaho');closeExportMenu();">光ディスク等送付書（社保）</button>
      <button onclick="ReceiptExporter.printDiscCoverLetter('kokuho');closeExportMenu();">光ディスク等送付書（国保）</button>
      <button onclick="ReceiptExporter.printKouhiSeikyu();closeExportMenu();">公費医療費請求書</button>

      <div class="rc-export-group">返戻関連</div>
      <button onclick="ReceiptExporter.printHenreiSoukatu('shaho');closeExportMenu();">返戻用社保総括表</button>
      <button onclick="ReceiptExporter.printHenreiSoukatu('kokuho');closeExportMenu();">返戻用国保総括表</button>
      <button onclick="ReceiptExporter.downloadHenreiResult('shaho');closeExportMenu();">返戻処理結果.txt（社保）</button>
      <button onclick="ReceiptExporter.downloadHenreiResult('kokuho');closeExportMenu();">返戻処理結果.txt（国保）</button>

      <div class="rc-export-group">印刷</div>
      <button onclick="ReceiptExporter.printSummary();closeExportMenu();">総括表サマリー 印刷</button>
      <button onclick="ReceiptExporter.printChecklist();closeExportMenu();">要確認一覧 印刷</button>

      <div class="rc-export-group">UKEファイル</div>
      <button onclick="ReceiptExporter.downloadAllUKE();closeExportMenu();">UKE 一括ダウンロード</button>
    `;

    const rect = e.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.maxHeight = '80vh';
    menu.style.overflowY = 'auto';
    document.body.appendChild(menu);

    setTimeout(() => {
      document.addEventListener('click', closeExportMenuOnOutside, { once: true });
    }, 50);
  }

  // ============================================================
  // 内部ヘルパー
  // ============================================================

  function buildCategoryBreakdown(receipts, label) {
    if (receipts.length === 0) return '';
    const catTotals = {};
    for (const r of receipts) {
      for (const p of r.procedures) {
        const cat = p.category || '99';
        const catName = CATEGORY_NAMES[cat] || cat;
        if (!catTotals[cat]) catTotals[cat] = { name: catName, points: 0, count: 0 };
        const pts = (p.points && p.quantity) ? p.points * p.quantity : (p.points || 0);
        catTotals[cat].points += pts;
        catTotals[cat].count++;
      }
    }
    const entries = Object.entries(catTotals).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    let rows = '';
    let grandTotal = 0;
    for (const [cat, d] of entries) {
      rows += '<tr><td>' + he(cat) + '</td><td>' + he(d.name) + '</td><td style="text-align:right;">' +
        d.count + '</td><td style="text-align:right;">' + d.points.toLocaleString() + '</td></tr>';
      grandTotal += d.points;
    }
    return `
      <div class="section">
        <div class="section-head">${he(label)} 診療区分内訳 (${receipts.length}件)</div>
        <table>
          <tr><th>区分</th><th>名称</th><th style="text-align:right;">行為数</th><th style="text-align:right;">点数計</th></tr>
          ${rows}
          <tr style="font-weight:700;border-top:2px solid #333;"><td colspan="3">合計</td><td style="text-align:right;">${grandTotal.toLocaleString()}</td></tr>
        </table>
      </div>`;
  }

  /** 印刷用HTML共通テンプレート（レセプト詳細・サマリー・チェックリスト用） */
  function buildPrintHTML({ title, body }) {
    return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${he(title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Yu Gothic", "Meiryo", sans-serif; font-size: 11px; color: #222; line-height: 1.5; }
  h2 { font-size: 16px; margin: 8px 0 12px; color: #1a2744; }
  .header-bar { background: #264653; color: #fff; padding: 6px 12px; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; margin-bottom: 12px; font-size: 11px; }
  .info-grid .label { color: #666; }
  .section { border: 1px solid #ccc; margin-bottom: 10px; }
  .section-head { background: #e8e4dc; padding: 4px 10px; font-weight: 600; font-size: 11px; border-bottom: 1px solid #ccc; }
  .warn-head { background: #fff0f0; color: #c1272d; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f0ede6; padding: 3px 6px; border: 1px solid #bbb; font-size: 10px; text-align: left; }
  td { padding: 3px 6px; border: 1px solid #ddd; font-size: 10px; }
  .total-bar { border-top: 2px solid #264653; padding: 6px 10px; font-size: 12px; margin-bottom: 10px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
</style></head><body>${body}</body></html>`;
  }

  /** 公式帳票用HTMLテンプレート（様式第一、総括表、送付書、請求書） */
  function buildOfficialFormHTML({ title, body }) {
    return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${he(title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Yu Gothic", "Meiryo", sans-serif; font-size: 12px; color: #222; line-height: 1.6; padding: 16px; }
  .form-title { font-size: 20px; font-weight: 700; text-align: center; color: #1a2744; margin-bottom: 4px; padding-bottom: 8px; border-bottom: 3px double #1a2744; }
  .form-subtitle { text-align: center; font-size: 14px; color: #555; margin-bottom: 8px; }
  .form-dest { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
  .form-section-title { font-size: 13px; font-weight: 700; color: #264653; border-bottom: 2px solid #264653; padding-bottom: 3px; margin: 16px 0 8px; }
  .form-info { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .form-info td { padding: 4px 8px; border: 1px solid #ccc; font-size: 12px; }
  .fi-label { background: #f0ede6; font-weight: 600; width: 140px; white-space: nowrap; }
  .form-table { width: 100%; border-collapse: collapse; }
  .form-table th { background: #e8e4dc; padding: 5px 8px; border: 1px solid #bbb; font-size: 11px; font-weight: 600; text-align: center; }
  .form-table td { padding: 4px 8px; border: 1px solid #ccc; font-size: 11px; }
  .form-footer-note { margin-top: 20px; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
</style></head><body>${body}</body></html>`;
  }

  // ============================================================
  // 16. 一括ZIP出力（receipt_202606フォルダ構造を再現）
  // ============================================================

  async function exportAllAsZip() {
    if (!hasAnyData()) { alert('UKEファイルを先に読み込んでください'); return; }
    if (typeof JSZip === 'undefined') { alert('JSZipライブラリが読み込まれていません'); return; }

    const zip = new JSZip();
    const month = getDisplayMonth();
    const billingMonth = (() => {
      const first = [...(allReceipts.shaho||[]),...(allReceipts.kokuho||[]),...(allReceipts.shahoHenrei||[]),...(allReceipts.kokuhoHenrei||[])][0];
      return first ? first.billingMonth : '';
    })();

    const hasShaho = (allReceipts.shaho || []).length > 0;
    const hasKokuho = (allReceipts.kokuho || []).length > 0;
    const hasShahoHenrei = (allReceipts.shahoHenrei || []).length > 0;
    const hasKokuhoHenrei = (allReceipts.kokuhoHenrei || []).length > 0;
    const hasKouhi = [...(allReceipts.shaho||[]),...(allReceipts.kokuho||[])].some(r => r.kouhi && r.kouhi.length > 0);

    // --- shaho/ フォルダ ---
    if (hasShaho) {
      const shahoDir = zip.folder('shaho');
      shahoDir.file('RECEIPTC.UKE', rawUkeData.shaho || _buildUKE('shaho'));
      shahoDir.file('社保総括表.html', _buildShahoSoukatuHTML());
      shahoDir.file('光ディスク等送付書.html', _buildDiscCoverLetterHTML('shaho'));
      shahoDir.file('返戻処理結果.txt', _buildHenreiResultText('shaho'));
      if (hasShahoHenrei) {
        shahoDir.file('返戻用社保総括表.html', _buildHenreiSoukatuHTML('shaho'));
      }
    }

    // --- kokuho/ フォルダ ---
    if (hasKokuho) {
      const kokuhoDir = zip.folder('kokuho');
      kokuhoDir.file('RECEIPTC.UKE', rawUkeData.kokuho || _buildUKE('kokuho'));
      kokuhoDir.file('国保総括表.html', _buildKokuhoSoukatuHTML());
      kokuhoDir.file('光ディスク等送付書.html', _buildDiscCoverLetterHTML('kokuho'));
      kokuhoDir.file('返戻処理結果.txt', _buildHenreiResultText('kokuho'));
      if (hasKokuhoHenrei) {
        kokuhoDir.file('返戻用国保総括表.html', _buildHenreiSoukatuHTML('kokuho'));
        kokuhoDir.file('返戻用国保請求書.html', _buildKokuhoSeikyushoHTML());
        kokuhoDir.file('返戻用後期高齢者請求書.html', _buildKoukiSeikyushoHTML());
      }
    }

    // --- kouhi/ フォルダ ---
    if (hasKouhi) {
      const kouhiDir = zip.folder('kouhi');
      kouhiDir.file('医療費請求書.html', _buildKouhiSeikyuHTML());
    }

    // --- shaho-henrei/ フォルダ ---
    if (hasShahoHenrei) {
      zip.folder('shaho-henrei').file('RECEIPTC.UKE', rawUkeData.shahoHenrei || _buildUKE('shahoHenrei'));
    }

    // --- kokuho-henrei/ フォルダ ---
    if (hasKokuhoHenrei) {
      zip.folder('kokuho-henrei').file('RECEIPTC.UKE', rawUkeData.kokuhoHenrei || _buildUKE('kokuhoHenrei'));
    }

    // --- ルート ---
    zip.file('社保総括表.html', hasShaho ? _buildShahoSoukatuHTML() : '<html><body>社保データなし</body></html>');
    zip.file('国保総括表（一覧）.html', hasKokuho ? _buildKokuhoSoukatuHTML() : '<html><body>国保データなし</body></html>');
    zip.file('要確認レセプト一覧.html', _buildChecklistHTML());
    zip.file('レセプト一覧.csv', _buildListCSV());
    zip.file('総括表.csv', _buildSummaryCSV());

    // ZIP生成＆ダウンロード
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, 'receipt_' + (billingMonth || month) + '.zip');
  }

  // --- ZIP用ビルダー関数群 ---

  function _buildListCSV() {
    const rows = [['種別','カルテ番号','氏名','性別','生年月日','保険種別','保険者番号','被保険者番号','実日数','合計点数','一部負担金','警告数'].join(',')];
    for (const key of ['shaho','kokuho','shahoHenrei','kokuhoHenrei']) {
      const label = {shaho:'社保',kokuho:'国保',shahoHenrei:'社保返戻',kokuhoHenrei:'国保返戻'}[key];
      for (const r of (allReceipts[key]||[])) {
        const wc = r.warnings.filter(w => w.severity !== 'info').length;
        const copay = r.insurance ? r.insurance.copayAmount : 0;
        rows.push([csvField(label),csvField(r.karteNumber),csvField(r.name),csvField(r.sex),csvField(formatDate(r.dob)),csvField(r.insuranceType),csvField(r.insurance?r.insurance.insurerNumber:''),csvField(r.insurance?r.insurance.insuredNumber:''),r.visitDays.length,r.totalPoints,copay,wc].join(','));
      }
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  function _buildSummaryCSV() {
    const data = {};
    for (const key of ['shaho','kokuho','shahoHenrei','kokuhoHenrei']) {
      const list = allReceipts[key]||[];
      data[key] = { count: list.length, points: list.reduce((s,r) => s + r.totalPoints, 0), days: list.reduce((s,r) => s + r.visitDays.length, 0), warns: list.reduce((s,r) => s + r.warnings.filter(w => w.severity !== 'info').length, 0) };
    }
    const rows = [['種別','件数','実日数合計','合計点数','警告件数'].join(',')];
    const labels = {shaho:'社保',kokuho:'国保',shahoHenrei:'社保返戻',kokuhoHenrei:'国保返戻'};
    for (const [k,d] of Object.entries(data)) {
      rows.push([csvField(labels[k]),d.count,d.days,d.points,d.warns].join(','));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  function _buildChecklistHTML() {
    var allWarns = [];
    for (var key of Object.keys(allReceipts)) {
      var lbl = {shaho:'社保',kokuho:'国保',shahoHenrei:'社保返戻',kokuhoHenrei:'国保返戻'}[key];
      for (var r of (allReceipts[key]||[])) {
        for (var w of r.warnings) {
          if (w.severity === 'info') continue;
          allWarns.push({ label: lbl, name: r.name, karte: r.karteNumber, insType: r.insuranceType, severity: w.severity, message: w.message });
        }
      }
    }
    var sevLabel = {high:'高',mid:'中',low:'低'};
    var rows = '';
    allWarns.forEach(function(w, i) {
      var sevClass = w.severity === 'high' ? 'color:#c1272d;font-weight:700;' : w.severity === 'mid' ? 'color:#b45309;' : '';
      rows += '<tr><td>' + (i+1) + '</td><td>' + he(w.label) + '</td><td>' + he(w.karte) + '</td><td>' + he(w.name) + '</td><td style="' + sevClass + '">' + (sevLabel[w.severity]||w.severity) + '</td><td>' + he(w.message) + '</td></tr>';
    });
    var bodyHtml = '<div style="margin-bottom:8px;font-size:13px;">要確認件数: <strong style="color:#c1272d;">' + allWarns.length + '件</strong></div>' +
      '<table><thead><tr><th>#</th><th>種別</th><th>カルテ番号</th><th>氏名</th><th>深刻度</th><th>チェック内容</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:12px;font-size:10px;color:#999;">出力日時: ' + new Date().toLocaleString('ja-JP') + '</div>';
    return buildPrintHTML({ title: '要確認レセプト一覧', body: bodyHtml });
  }

  function _buildShahoSoukatuHTML() {
    const receipts = allReceipts.shaho || [];
    if (receipts.length === 0) return '<html><body>社保データなし</body></html>';
    const billingMonth = receipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);
    const cats = { kyokai:{label:'協会けんぽ',count:0,days:0,points:0}, kumiai:{label:'組合健保',count:0,days:0,points:0}, kyosai:{label:'共済',count:0,days:0,points:0}, senin:{label:'船員',count:0,days:0,points:0}, hiyatoi:{label:'日雇',count:0,days:0,points:0}, kouhi:{label:'公費単独',count:0,days:0,points:0}, other:{label:'その他',count:0,days:0,points:0} };
    for (const r of receipts) {
      const insurerNum = r.insurance ? r.insurance.insurerNumber : '';
      const insCategory = getInsuranceCategory(r);
      let cat = 'other';
      if (insCategory.type === 'kouhi') cat = 'kouhi';
      else { const h = insurerNum.substring(0,2); if(h==='01')cat='kyokai'; else if(h==='06')cat='kumiai'; else if(['31','32','33','34'].includes(h))cat='kyosai'; else if(h==='02')cat='senin'; else if(h==='63')cat='hiyatoi'; }
      cats[cat].count++; cats[cat].days += r.visitDays.length; cats[cat].points += r.totalPoints;
    }
    const totalCount = receipts.length, totalDays = receipts.reduce((s,r)=>s+r.visitDays.length,0), totalPoints = receipts.reduce((s,r)=>s+r.totalPoints,0);
    let catRows = '';
    for (const [k,d] of Object.entries(cats)) { if(d.count===0)continue; catRows += `<tr><td style="font-weight:600;">${he(d.label)}</td><td style="text-align:right;">${d.count}</td><td style="text-align:right;">${d.days}</td><td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`; }
    return buildOfficialFormHTML({ title:'社保総括表（様式第一）', body:`
      <div class="form-title">診療報酬請求書<span style="font-size:12px;color:#666;margin-left:12px;">（様式第一 医科・入院外）</span></div>
      <div class="form-subtitle">${wareki}分</div>
      <div class="form-dest">社会保険診療報酬支払基金 ${he(CLINIC.prefectureName)}支部 御中</div>
      <table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>${he(institution.code||CLINIC.code)}</td><td class="fi-label">所在地</td><td>${he(CLINIC.address)}</td></tr><tr><td class="fi-label">名称</td><td>${he(institution.name||CLINIC.name)}</td><td class="fi-label">開設者氏名</td><td>${he(CLINIC.founder)}</td></tr><tr><td class="fi-label">請求日</td><td colspan="3">${submitDate}</td></tr></table>
      <div class="form-section-title">保険区分別内訳</div>
      <table class="form-table"><tr><th>区分</th><th style="width:80px;">件数</th><th style="width:80px;">実日数</th><th style="width:120px;">点数</th></tr>${catRows}<tr style="font-weight:700;border-top:2px solid #333;"><td>合計</td><td style="text-align:right;">${totalCount}</td><td style="text-align:right;">${totalDays}</td><td style="text-align:right;">${totalPoints.toLocaleString()}</td></tr></table>
      <div class="form-footer-note">※ UKEファイルから自動集計した参考値です。<br>出力日時: ${new Date().toLocaleString('ja-JP')}</div>
    `});
  }

  function _buildKokuhoSoukatuHTML() {
    const receipts = allReceipts.kokuho || [];
    if (receipts.length === 0) return '<html><body>国保データなし</body></html>';
    const billingMonth = receipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);
    const byInsurer = {};
    for (const r of receipts) {
      const num = r.insurance ? r.insurance.insurerNumber : '000000';
      if (!byInsurer[num]) byInsurer[num] = { name: getInsurerName(num), count: 0, days: 0, points: 0 };
      byInsurer[num].count++; byInsurer[num].days += r.visitDays.length; byInsurer[num].points += r.totalPoints;
    }
    const totalCount = receipts.length, totalDays = receipts.reduce((s,r)=>s+r.visitDays.length,0), totalPoints = receipts.reduce((s,r)=>s+r.totalPoints,0);
    let insurerRows = '';
    for (const [num, d] of Object.entries(byInsurer).sort((a,b) => a[0].localeCompare(b[0]))) {
      insurerRows += `<tr><td>${he(num)}</td><td>${he(d.name)}</td><td style="text-align:right;">${d.count}</td><td style="text-align:right;">${d.days}</td><td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`;
    }
    return buildOfficialFormHTML({ title:'国保総括表（保険者別）', body:`
      <div class="form-title">診療報酬等請求書<span style="font-size:12px;color:#666;margin-left:12px;">（国民健康保険・保険者別）</span></div>
      <div class="form-subtitle">${wareki}分</div>
      <div class="form-dest">${he(CLINIC.prefectureName)}国民健康保険団体連合会 御中</div>
      <table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>${he(institution.code||CLINIC.code)}</td><td class="fi-label">名称</td><td>${he(institution.name||CLINIC.name)}</td></tr><tr><td class="fi-label">所在地</td><td>${he(CLINIC.address)}</td><td class="fi-label">請求日</td><td>${submitDate}</td></tr></table>
      <div class="form-section-title">保険者別内訳</div>
      <table class="form-table"><tr><th>保険者番号</th><th>保険者名</th><th style="width:60px;">件数</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th></tr>${insurerRows}<tr style="font-weight:700;border-top:2px solid #333;"><td colspan="2">合計</td><td style="text-align:right;">${totalCount}</td><td style="text-align:right;">${totalDays}</td><td style="text-align:right;">${totalPoints.toLocaleString()}</td></tr></table>
      <div class="form-footer-note">※ UKEファイルから自動集計した参考値です。<br>出力日時: ${new Date().toLocaleString('ja-JP')}</div>
    `});
  }

  function _buildDiscCoverLetterHTML(target) {
    const receipts = target === 'shaho' ? (allReceipts.shaho||[]) : (allReceipts.kokuho||[]);
    if (receipts.length === 0) return '<html><body>データなし</body></html>';
    const billingMonth = receipts[0].billingMonth || (institution.billingMonth||'');
    const wareki = toWareki(billingMonth);
    const submitDate = getSubmitDate(billingMonth);
    const dest = target === 'shaho' ? '社会保険診療報酬支払基金 ' + CLINIC.prefectureName + '支部' : CLINIC.prefectureName + '国民健康保険団体連合会';
    const totalCount = receipts.length, totalPoints = receipts.reduce((s,r) => s + r.totalPoints, 0);
    return buildOfficialFormHTML({ title: '光ディスク等送付書', body: `
      <div class="form-title">光ディスク等送付書</div>
      <div class="form-subtitle">${wareki}分</div>
      <div class="form-dest">${he(dest)} 御中</div>
      <table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>${he(institution.code||CLINIC.code)}</td><td class="fi-label">名称</td><td>${he(institution.name||CLINIC.name)}</td></tr><tr><td class="fi-label">所在地</td><td>${he(CLINIC.address)}</td><td class="fi-label">電話番号</td><td>${he(institution.phone||'')}</td></tr><tr><td class="fi-label">提出日</td><td colspan="3">${submitDate}</td></tr></table>
      <div class="form-section-title">送付内容</div>
      <table class="form-table"><tr><th>項目</th><th>内容</th></tr><tr><td>媒体</td><td>オンライン請求（光ディスク等）</td></tr><tr><td>レセプト件数</td><td style="text-align:right;font-weight:600;">${totalCount}件</td></tr><tr><td>合計点数</td><td style="text-align:right;font-weight:600;">${totalPoints.toLocaleString()}点</td></tr><tr><td>ファイル名</td><td>RECEIPTC.UKE</td></tr></table>
      <div class="form-footer-note">出力日時: ${new Date().toLocaleString('ja-JP')}</div>
    `});
  }

  function _buildHenreiResultText(target) {
    const henreiKey = target + 'Henrei';
    const receipts = allReceipts[henreiKey] || [];
    const label = target === 'shaho' ? '社保' : '国保';
    const lines = ['=== 返戻処理結果 (' + label + ') ===', '出力日時: ' + new Date().toLocaleString('ja-JP'), '診療月: ' + getDisplayMonth(), ''];
    if (receipts.length === 0) {
      lines.push('返戻レセプトはありません。');
    } else {
      lines.push('返戻件数: ' + receipts.length + '件', '');
      receipts.forEach((r, i) => {
        lines.push((i+1) + '. ' + r.name + ' (カルテ: ' + r.karteNumber + ')');
        lines.push('   保険種別: ' + r.insuranceType + '  合計点数: ' + r.totalPoints);
        if (r.warnings.length > 0) { r.warnings.forEach(w => lines.push('   [' + w.severity + '] ' + w.message)); }
        lines.push('');
      });
    }
    return lines.join('\r\n');
  }

  function _buildHenreiSoukatuHTML(target) {
    const henreiKey = target + 'Henrei';
    const receipts = allReceipts[henreiKey] || [];
    const label = target === 'shaho' ? '社保' : '国保';
    if (receipts.length === 0) return '<html><body>返戻データなし</body></html>';
    const billingMonth = receipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);
    const totalCount = receipts.length, totalPoints = receipts.reduce((s,r)=>s+r.totalPoints,0);
    let detailRows = '';
    receipts.forEach((r,i) => {
      detailRows += `<tr><td>${i+1}</td><td>${he(r.karteNumber)}</td><td>${he(r.name)}</td><td>${he(r.insuranceType)}</td><td style="text-align:right;">${r.totalPoints.toLocaleString()}</td><td>${r.warnings.length}</td></tr>`;
    });
    return buildOfficialFormHTML({ title: '返戻用' + label + '総括表', body: `
      <div class="form-title">返戻再請求 総括表（${he(label)}）</div>
      <div class="form-subtitle">${wareki}分 返戻再請求</div>
      <table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>${he(institution.code||CLINIC.code)}</td><td class="fi-label">名称</td><td>${he(institution.name||CLINIC.name)}</td></tr></table>
      <div class="form-section-title">返戻レセプト一覧</div>
      <table class="form-table"><tr><th>#</th><th>カルテ番号</th><th>氏名</th><th>保険種別</th><th>合計点数</th><th>警告</th></tr>${detailRows}<tr style="font-weight:700;border-top:2px solid #333;"><td colspan="3">合計</td><td></td><td style="text-align:right;">${totalPoints.toLocaleString()}</td><td></td></tr></table>
      <div class="form-footer-note">返戻件数: ${totalCount}件<br>出力日時: ${new Date().toLocaleString('ja-JP')}</div>
    `});
  }

  function _buildKouhiSeikyuHTML() {
    const allKouhiReceipts = [];
    for (const key of ['shaho','kokuho']) {
      for (const r of (allReceipts[key]||[])) {
        if (r.kouhi && r.kouhi.length > 0) allKouhiReceipts.push(r);
      }
    }
    if (allKouhiReceipts.length === 0) return '<html><body>公費データなし</body></html>';
    const billingMonth = allKouhiReceipts[0].billingMonth || '';
    const wareki = toWareki(billingMonth);
    const byMunicipality = {};
    for (const r of allKouhiReceipts) {
      for (const k of r.kouhi) {
        const fNum = k.futanshaNumber || '';
        const mKey = fNum.substring(0,6) || 'unknown';
        const houbetsu = fNum.substring(0,2);
        const label = {'12':'生活保護','21':'精神通院','51':'特定疾患','54':'特定医療費(難病)','81':'こども医療','82':'障害者医療','83':'ひとり親','85':'こども(85)','89':'福祉給付金','19':'被爆者'}[houbetsu] || ('公費'+houbetsu);
        if (!byMunicipality[mKey]) byMunicipality[mKey] = { name: getInsurerName(mKey), houbetsu, label, count: 0, points: 0 };
        byMunicipality[mKey].count++; byMunicipality[mKey].points += r.totalPoints;
      }
    }
    let rows = '';
    for (const [k,d] of Object.entries(byMunicipality)) {
      rows += `<tr><td>${he(k)}</td><td>${he(d.name)}</td><td>${he(d.label)}</td><td style="text-align:right;">${d.count}</td><td style="text-align:right;">${d.points.toLocaleString()}</td></tr>`;
    }
    return buildOfficialFormHTML({ title: '公費医療費請求書', body: `
      <div class="form-title">公費負担医療費請求書</div>
      <div class="form-subtitle">${wareki}分</div>
      <table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>${he(institution.code||CLINIC.code)}</td><td class="fi-label">名称</td><td>${he(institution.name||CLINIC.name)}</td></tr></table>
      <div class="form-section-title">市区町村別 公費負担内訳</div>
      <table class="form-table"><tr><th>負担者番号</th><th>市区町村</th><th>公費種別</th><th style="width:60px;">件数</th><th style="width:100px;">点数</th></tr>${rows}</table>
      <div class="form-footer-note">出力日時: ${new Date().toLocaleString('ja-JP')}</div>
    `});
  }

  function _buildKokuhoSeikyushoHTML() {
    var receipts = allReceipts.kokuho || [];
    var kokuhoOnly = receipts.filter(function(r) { var cat = getInsuranceCategory(r); return cat.type === 'kokuho'; });
    if (kokuhoOnly.length === 0) return '<html><body>国保請求データなし</body></html>';
    var billingMonth = kokuhoOnly[0].billingMonth || '';
    var wareki = toWareki(billingMonth);
    var submitDate = getSubmitDate(billingMonth);
    var totalCount = kokuhoOnly.length;
    var totalDays = kokuhoOnly.reduce(function(s,r){ return s + r.visitDays.length; }, 0);
    var totalPoints = kokuhoOnly.reduce(function(s,r){ return s + r.totalPoints; }, 0);
    var insurerMap = {};
    for (var i = 0; i < kokuhoOnly.length; i++) {
      var r = kokuhoOnly[i];
      var num = r.insurance ? r.insurance.insurerNumber : '';
      if (!insurerMap[num]) insurerMap[num] = { name: getInsurerName(num), count: 0, days: 0, points: 0 };
      insurerMap[num].count++; insurerMap[num].days += r.visitDays.length; insurerMap[num].points += r.totalPoints;
    }
    var rows = '';
    for (var key in insurerMap) {
      var d = insurerMap[key];
      rows += '<tr><td>' + he(key) + '</td><td>' + he(d.name) + '</td><td style="text-align:right;">' + d.count + '</td><td style="text-align:right;">' + d.days + '</td><td style="text-align:right;">' + d.points.toLocaleString() + '</td></tr>';
    }
    return buildOfficialFormHTML({ title: '国保請求書', body: '<div class="form-title">診療報酬請求書（国保）</div>' +
      '<div class="form-subtitle">' + wareki + '分</div>' +
      '<div class="form-dest">' + he(CLINIC.prefectureName) + '国民健康保険団体連合会 御中</div>' +
      '<table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>' + he(institution.code||CLINIC.code) + '</td><td class="fi-label">名称</td><td>' + he(institution.name||CLINIC.name) + '</td></tr>' +
      '<tr><td class="fi-label">所在地</td><td>' + he(CLINIC.address) + '</td><td class="fi-label">開設者</td><td>' + he(CLINIC.founder) + '</td></tr>' +
      '<tr><td class="fi-label">請求年月日</td><td colspan="3">' + submitDate + '</td></tr></table>' +
      '<div class="form-section-title">保険者別請求内訳</div>' +
      '<table class="form-table"><tr><th>保険者番号</th><th>保険者名</th><th style="width:60px;">件数</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th></tr>' + rows +
      '<tr style="font-weight:700;border-top:2px solid #333;"><td colspan="2">合計</td><td style="text-align:right;">' + totalCount + '</td><td style="text-align:right;">' + totalDays + '</td><td style="text-align:right;">' + totalPoints.toLocaleString() + '</td></tr></table>' +
      '<div class="form-footer-note">出力日時: ' + new Date().toLocaleString('ja-JP') + '</div>'
    });
  }

  function _buildKoukiSeikyushoHTML() {
    var receipts = allReceipts.kokuho || [];
    var koukiOnly = receipts.filter(function(r) { var cat = getInsuranceCategory(r); return cat.type === 'kouki'; });
    if (koukiOnly.length === 0) return '<html><body>後期高齢者請求データなし</body></html>';
    var billingMonth = koukiOnly[0].billingMonth || '';
    var wareki = toWareki(billingMonth);
    var submitDate = getSubmitDate(billingMonth);
    var totalCount = koukiOnly.length;
    var totalDays = koukiOnly.reduce(function(s,r){ return s + r.visitDays.length; }, 0);
    var totalPoints = koukiOnly.reduce(function(s,r){ return s + r.totalPoints; }, 0);
    var ratioMap = {};
    for (var i = 0; i < koukiOnly.length; i++) {
      var r = koukiOnly[i];
      var ratio = r.copayRatio || '不明';
      var label = ratio === '90' ? '9割' : ratio === '80' ? '8割' : ratio === '70' ? '7割' : ratio + '%';
      if (!ratioMap[ratio]) ratioMap[ratio] = { label: label, count: 0, days: 0, points: 0 };
      ratioMap[ratio].count++; ratioMap[ratio].days += r.visitDays.length; ratioMap[ratio].points += r.totalPoints;
    }
    var rows = '';
    for (var key in ratioMap) {
      var d = ratioMap[key];
      rows += '<tr><td>' + he(d.label) + '</td><td style="text-align:right;">' + d.count + '</td><td style="text-align:right;">' + d.days + '</td><td style="text-align:right;">' + d.points.toLocaleString() + '</td></tr>';
    }
    return buildOfficialFormHTML({ title: '後期高齢者請求書', body: '<div class="form-title">診療報酬請求書（後期高齢者）</div>' +
      '<div class="form-subtitle">' + wareki + '分</div>' +
      '<div class="form-dest">' + he(CLINIC.prefectureName) + '後期高齢者医療広域連合 御中</div>' +
      '<table class="form-info"><tr><td class="fi-label">医療機関コード</td><td>' + he(institution.code||CLINIC.code) + '</td><td class="fi-label">名称</td><td>' + he(institution.name||CLINIC.name) + '</td></tr>' +
      '<tr><td class="fi-label">所在地</td><td>' + he(CLINIC.address) + '</td><td class="fi-label">開設者</td><td>' + he(CLINIC.founder) + '</td></tr>' +
      '<tr><td class="fi-label">請求年月日</td><td colspan="3">' + submitDate + '</td></tr></table>' +
      '<div class="form-section-title">負担割合別内訳</div>' +
      '<table class="form-table"><tr><th>負担割合</th><th style="width:60px;">件数</th><th style="width:60px;">実日数</th><th style="width:100px;">点数</th></tr>' + rows +
      '<tr style="font-weight:700;border-top:2px solid #333;"><td>合計</td><td style="text-align:right;">' + totalCount + '</td><td style="text-align:right;">' + totalDays + '</td><td style="text-align:right;">' + totalPoints.toLocaleString() + '</td></tr></table>' +
      '<div class="form-footer-note">出力日時: ' + new Date().toLocaleString('ja-JP') + '</div>'
    });
  }

  // ============================================================
  // UKE ジェネレーター（パース済みデータからUKE形式テキストを再構築）
  // ============================================================

  function _buildUKE(fileType) {
    var receipts = allReceipts[fileType] || [];
    if (receipts.length === 0) return '';

    var lines = [];
    // IR レコード（医療機関情報）
    var reviewOrg = (fileType === 'shaho' || fileType === 'shahoHenrei') ? '1' : '2';
    var inst = institution || {};
    lines.push([
      'IR', reviewOrg, inst.prefecture || '', inst.tensu || '1',
      inst.code || '', '', inst.name || '',
      receipts[0].billingMonth || '', '', inst.phone || ''
    ].join(','));

    for (var i = 0; i < receipts.length; i++) {
      var r = receipts[i];

      // RE レコード（レセプト共通）
      var reFields = new Array(35).fill('');
      reFields[0] = 'RE';
      reFields[1] = String(r.seq || (i + 1));
      reFields[2] = r.insuranceTypeCode || '';
      reFields[3] = r.billingMonth || '';
      reFields[4] = r.name || '';
      reFields[5] = r.sex === '男' ? '1' : r.sex === '女' ? '2' : '';
      reFields[6] = r.dob || '';
      reFields[7] = r.copayRatio || '';
      // ★v0.13: RE[11]=特記事項, RE[13]=カルテ番号（総点数はREには持たせない）
      reFields[11] = r.tokki || '';
      reFields[13] = r.karteNumber || '';
      // Trim trailing empty fields
      while (reFields.length > 1 && reFields[reFields.length - 1] === '') reFields.pop();
      lines.push(reFields.join(','));

      // HO レコード（保険者情報）: HO[4]=実日数, HO[5]=合計点数, HO[6]=一部負担金
      if (r.insurance) {
        lines.push([
          'HO', r.insurance.insurerNumber || '',
          r.insurance.symbol || '', r.insurance.insuredNumber || '',
          String(r.jitsuNissu || r.visitDays.length || ''),
          String(r.totalPoints || 0),
          String(r.insurance.copayAmount || '')
        ].join(','));
      }

      // KO レコード（公費）: KO[4]=実日数, KO[5]=合計点数, KO[6]=一部負担金
      if (r.kouhi) {
        for (var k = 0; k < r.kouhi.length; k++) {
          var ko = r.kouhi[k];
          lines.push([
            'KO', ko.futanshaNumber || '', ko.jukyushaNumber || '',
            '', String(ko.jitsuNissu || ''),
            String(ko.points || r.totalPoints || 0),
            String(ko.copayAmount || '')
          ].join(','));
        }
      }

      // SY レコード（傷病名）
      if (r.diseases) {
        for (var d = 0; d < r.diseases.length; d++) {
          var dis = r.diseases[d];
          lines.push([
            'SY', dis.code || '', dis.startDate || '',
            dis.outcomeFlag || '', dis.modifier || '',
            '', dis.isPrimary ? '01' : ''
          ].join(','));
        }
      }

      // SI/IY レコード（診療行為・医薬品）
      if (r.procedures) {
        for (var p = 0; p < r.procedures.length; p++) {
          var proc = r.procedures[p];
          if (proc._raw) {
            // 生データがあればそのまま使う
            lines.push(proc._raw);
          } else if (proc.isDrug) {
            // ★v0.13: IYはSIと同構造 IY,診療識別,負担区分,医薬品コード,数量,点数
            lines.push([
              'IY', proc.category || '', '',
              proc.code || '', String(proc.quantity || 0),
              String(proc.points || 0)
            ].join(','));
          } else {
            lines.push([
              'SI', proc.category || '', '',
              proc.code || '', '', String(proc.points || 0),
              String(proc.quantity || 0)
            ].join(','));
          }
        }
      }

      // CO レコード（コメント）
      if (r.comments) {
        for (var c = 0; c < r.comments.length; c++) {
          var co = r.comments[c];
          lines.push(['CO', co.identifier || '', '', co.code || '', co.text || ''].join(','));
        }
      }

      // JD レコード（診療日）
      if (r.visitDays && r.visitDays.length > 0) {
        var jdFields = new Array(32).fill('');
        jdFields[0] = 'JD';
        for (var v = 0; v < r.visitDays.length; v++) {
          var day = r.visitDays[v];
          if (day >= 1 && day <= 31) jdFields[day] = '1';
        }
        while (jdFields.length > 1 && jdFields[jdFields.length - 1] === '') jdFields.pop();
        lines.push(jdFields.join(','));
      }
    }

    // GO レコード（合計）
    var totalPoints = receipts.reduce(function(s, r) { return s + (r.totalPoints || 0); }, 0);
    lines.push(['GO', String(receipts.length), String(totalPoints)].join(','));

    return lines.join('\r\n') + '\r\n';
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    exportListCSV,
    exportChecklistCSV,
    exportDetailCSV,
    exportSummaryCSV,
    storeRawUke,
    downloadUKE,
    downloadAllUKE,
    printReceipt,
    printSummary,
    printChecklist,
    printShahoSoukatu,
    printKokuhoSoukatu,
    printDiscCoverLetter,
    printKouhiSeikyu,
    printHenreiSoukatu,
    downloadHenreiResult,
    exportAllAsZip,
    showExportMenu,
  };
})();

// グローバルからメニューを閉じるヘルパー
function closeExportMenu() {
  const el = document.getElementById('exportMenu');
  if (el) el.remove();
}
function closeExportMenuOnOutside(e) {
  const menu = document.getElementById('exportMenu');
  if (menu && !menu.contains(e.target)) {
    menu.remove();
  }
}
