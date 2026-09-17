/**
 * rousai.js - 労災（労働者災害補償保険）  カルテ v22
 *
 * 当院の労災は月に数件のため、請求書・内訳書そのものは厚労省指定の専用用紙へ書き写す運用とし、
 * ここでは「書き写すための下書き」を出せるところまでを持つ。
 *   ・診機様式第3号 診療費請求内訳書（入院外用）＝患者ごと・診療月ごとに1枚
 *   ・診機様式第1号 労災保険診療費請求書       ＝監督署ごとの表紙
 *   ・単価は1点12円（国公立等11.50円）。患者の一部負担金は無い。
 *   ・提出先は当院の所在地を管轄する労働局、提出期限は診療月の翌月10日。
 */
var ROUSAI_YEN_PER_POINT = 12;      // 労災の1点単価（国公立等は11.50円）

// ===== 患者の労災情報（patients.rousai = 配列。いまは1件ぶんを画面から編集する） =====
function rousaiOf(p) {
  if (!p) return null;
  var arr = p.rousai;
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[0];
}
function rousaiHas(p) {
  var r = rousaiOf(p);
  return !!(r && (r.no || r.office || r.accidentDate));
}
function rousaiLoadToModal(p) {
  var r = rousaiOf(p) || {};
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
  var chk = document.getElementById('rsChk');
  if (chk) chk.checked = rousaiHas(p);
  set('rsNo', r.no); set('rsOffice', r.office); set('rsOfficeAddr', r.officeAddr);
  set('rsAccidentDate', r.accidentDate); set('rsPart', r.part); set('rsDisease', r.disease);
  set('rsPensionNo', r.pensionNo); set('rsKantoku', r.kantoku); set('rsStartDate', r.startDate);
  set('rsNote', r.note);
  set('rsBureauCode', r.bureauCode || '23'); set('rsOfficeCode', r.officeCode); set('rsCourse', r.course);
  set('rsNewContinuing', r.newContinuing); set('rsOutcome', r.outcome || '3');
  var form = document.getElementById('rsFormType');
  if (form) form.value = r.formType || '5';
  rousaiToggleFields();
}
function rousaiToggleFields() {
  var chk = document.getElementById('rsChk');
  var body = document.getElementById('rsBody');
  if (body) body.style.display = (chk && chk.checked) ? '' : 'none';
}
function rousaiSaveFromModal(p) {
  if (!p) return;
  var chk = document.getElementById('rsChk');
  if (!chk || !chk.checked) { p.rousai = null; return; }
  var val = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  p.rousai = [{
    no: val('rsNo'), office: val('rsOffice'), officeAddr: val('rsOfficeAddr'),
    accidentDate: val('rsAccidentDate'), part: val('rsPart'), disease: val('rsDisease'),
    formType: val('rsFormType') || '5', pensionNo: val('rsPensionNo'),
    kantoku: val('rsKantoku'), startDate: val('rsStartDate'), note: val('rsNote'),
    // 労災レセ電（RREC）で使う項目
    bureauCode: val('rsBureauCode'), officeCode: val('rsOfficeCode'), course: val('rsCourse'),
    newContinuing: val('rsNewContinuing'), outcome: val('rsOutcome') || '3'
  }];
}

// ===== 受診が労災かどうか（診察画面のチェック） =====
function rousaiVisitToggle() {
  var on = document.getElementById('rsvOn');
  var detail = document.getElementById('rsvDetail');
  if (detail) detail.style.display = (on && on.checked) ? '' : 'none';
  if (typeof currentPatientId !== 'undefined' && currentPatientId && karteData[currentPatientId]) {
    rousaiVisitSaveToKarte(karteData[currentPatientId]);
    if (typeof recalcBilling === 'function') recalcBilling();
  }
}
function rousaiVisitSaveToKarte(k) {
  if (!k) return;
  var on = document.getElementById('rsvOn');
  k.isRousai = !!(on && on.checked);
  var p = patients.find(function (x) { return x.id === currentPatientId; });
  var r = rousaiOf(p);
  k.rousaiNo = k.isRousai ? ((r && r.no) || '') : '';
}
function rousaiVisitLoadFromKarte(k) {
  var on = document.getElementById('rsvOn');
  if (on) on.checked = !!(k && k.isRousai);
  var bar = document.getElementById('rousaiVisitBar');
  if (bar) {
    // 労災情報が登録されていない患者でもチェックはできる（先に受診が来ることがあるため）
    var p = patients.find(function (x) { return x.id === currentPatientId; });
    var warn = document.getElementById('rsvWarn');
    if (warn) warn.style.display = (on && on.checked && !rousaiHas(p)) ? '' : 'none';
  }
  rousaiVisitToggle();
}
/** Supabase visits に渡す列 */
function rousaiVisitFields(karteState) {
  var k = karteState || {};
  var pts = (typeof k.totalPoints === 'number') ? k.totalPoints : 0;
  return {
    is_rousai:  !!k.isRousai,
    rousai_no:  k.isRousai ? (k.rousaiNo || null) : null,
    rousai_yen: k.isRousai ? Math.round(pts * ROUSAI_YEN_PER_POINT) : null
  };
}

// ===== レセプト作成画面「労災」タブ：転記用の下書き =====
function rzRousaiMonth() {
  var el = document.getElementById('rsMonth');
  if (el && el.value) return el.value;
  var d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function rousaiMonthRange(ym) {
  var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
  var last = new Date(y, m, 0).getDate();
  return { from: ym + '-01', to: ym + '-' + ('0' + last).slice(-2) };
}
async function rzRousaiLoad() {
  var box = document.getElementById('rsResult');
  var ym = rzRousaiMonth();
  box.innerHTML = '<div class="rzm-empty">読み込み中...</div>';
  if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) {
    box.innerHTML = '<div class="rzm-empty">DBに接続していないため読み込めません</div>';
    return;
  }
  var range = rousaiMonthRange(ym);
  var res = await supabaseClient
    .from('visits')
    .select('id,visit_date,visit_time,arrived_at,visit_type,status,revenue_points,rousai_no,rousai_yen,patients(*),kartes(*),prescriptions(*),diseases_assigned(*)')
    .eq('clinic_id', currentClinicId())
    .eq('is_rousai', true)
    .gte('visit_date', range.from)
    .lte('visit_date', range.to)
    .order('visit_date');
  if (res.error) {
    box.innerHTML = '<div class="rzm-empty">読み込みに失敗しました: ' + esc(res.error.message || '') + '</div>';
    return;
  }
  var rows = res.data || [];
  window._rousaiRows = rows;
  window._rousaiYm = ym;
  if (!rows.length) {
    box.innerHTML = '<div class="rzm-empty">' + esc(ym) + ' の労災の受診はありません</div>';
    return;
  }
  var byPatient = rousaiGroup(rows);
  var total = 0, visits = 0;
  byPatient.forEach(function (g) { total += g.yen; visits += g.visits.length; });
  box.innerHTML = '<div class="rs-sum"><b>' + esc(ym) + '</b>　'
    + byPatient.length + '名 / 受診' + visits + '件 / 合計 ' + total.toLocaleString() + '円'
    + '<span class="rs-note">（点数×' + ROUSAI_YEN_PER_POINT + '円。専用用紙へ書き写すための下書きです）</span></div>'
    + '<table class="rs-tbl"><tr><th>患者</th><th>労働保険番号</th><th>受診日</th><th>実日数</th><th>点数</th><th>金額</th></tr>'
    + byPatient.map(function (g) {
        return '<tr><td>' + esc(g.name) + '</td><td>' + esc(g.rousai.no || '—') + '</td>'
          + '<td>' + g.visits.map(function (v) { return String(v.visit_date).slice(8, 10); }).join('・') + '日</td>'
          + '<td class="num">' + g.visits.length + '</td>'
          + '<td class="num">' + g.points.toLocaleString() + '</td>'
          + '<td class="num">' + g.yen.toLocaleString() + '円</td></tr>';
      }).join('')
    + '</table>';
}
function rousaiGroup(rows) {
  var map = {};
  rows.forEach(function (v) {
    var pt = v.patients || {};
    var key = pt.patient_no || pt.name || v.id;
    if (!map[key]) {
      var r = (Array.isArray(pt.rousai) && pt.rousai.length) ? pt.rousai[0] : {};
      map[key] = { key: key, name: pt.name || '', sex: pt.sex || '', dob: pt.dob || '',
                   patientNo: pt.patient_no || '', rousai: r || {}, visits: [], points: 0, yen: 0 };
    }
    var g = map[key];
    g.visits.push(v);
    var pts = Number(v.revenue_points) || 0;
    g.points += pts;
    g.yen += (v.rousai_yen !== null && v.rousai_yen !== undefined) ? Number(v.rousai_yen) : Math.round(pts * ROUSAI_YEN_PER_POINT);
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}
function rousaiFormName(t) { return t === '16-3' ? '通勤災害（様式16号の3）' : '業務災害（様式5号）'; }
function rzRousaiPrint() {
  var rows = window._rousaiRows || [];
  var ym = window._rousaiYm || rzRousaiMonth();
  if (!rows.length) { showToast('印刷する労災の受診がありません'); return; }
  var groups = rousaiGroup(rows);
  var total = groups.reduce(function (s, g) { return s + g.yen; }, 0);
  var html = groups.map(function (g) { return rousaiSheetHTML(g, ym); }).join('');
  var cover = '<section class="sheet"><h1>労災 診療費請求書（診機様式第1号）への転記用</h1>'
    + '<table class="kv"><tr><th>診療年月</th><td>' + esc(ym) + '</td></tr>'
    + '<tr><th>請求金額</th><td class="big">￥' + total.toLocaleString() + '</td></tr>'
    + '<tr><th>内訳書の枚数</th><td>' + groups.length + '枚</td></tr>'
    + '<tr><th>提出先</th><td>当院の所在地を管轄する労働局（監督署ごとに請求書を分けて編綴）</td></tr>'
    + '<tr><th>提出期限</th><td>診療月の翌月10日まで</td></tr></table>'
    + '<p class="memo">※ 金額の頭には￥マークを記入します。初回分は監督署ごとに1枚、2回目以降は1枚にまとめます。</p>'
    + '</section>';
  var win = window.open('', '_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>労災 転記用下書き ' + esc(ym) + '</title>'
    + '<style>' + rousaiPrintCSS() + '</style></head><body>' + cover + html
    + '<script>window.onload=function(){window.print();}<\/script></body></html>');
  win.document.close();
}
function rousaiSheetHTML(g, ym) {
  var r = g.rousai || {};
  var days = g.visits.length;
  var dates = g.visits.map(function (v) { return String(v.visit_date).slice(5).replace('-', '/'); }).join('、');
  var dx = [];
  var rx = [];
  g.visits.forEach(function (v) {
    (v.diseases_assigned || []).forEach(function (d) {
      var n = d.disease_name || '';
      if (n && dx.indexOf(n) < 0) dx.push(n);
    });
    (v.prescriptions || []).forEach(function (p) {
      var line = (p.drug_name || '') + ' ' + (p.quantity || 1) + ' × ' + (p.days || '') + '日分';
      if (rx.indexOf(line) < 0) rx.push(line);
    });
  });
  return '<section class="sheet"><h1>労災 診療費請求内訳書（診機様式第3号・入院外用）への転記用</h1>'
    + '<table class="kv">'
    + '<tr><th>診療年月</th><td>' + esc(ym) + '</td><th>災害区分</th><td>' + esc(rousaiFormName(r.formType)) + '</td></tr>'
    + '<tr><th>労働保険番号</th><td>' + esc(r.no || '') + '</td><th>年金証書番号</th><td>' + esc(r.pensionNo || '') + '</td></tr>'
    + '<tr><th>患者番号</th><td>' + esc(g.patientNo) + '</td><th>氏名</th><td>' + esc(g.name) + '</td></tr>'
    + '<tr><th>生年月日</th><td>' + esc(String(g.dob || '').slice(0, 10)) + '</td><th>性別</th><td>' + esc(String(g.sex || '').replace(/性$/, '')) + '</td></tr>'
    + '<tr><th>事業場</th><td colspan="3">' + esc(r.office || '') + '　' + esc(r.officeAddr || '') + '</td></tr>'
    + '<tr><th>災害発生年月日</th><td>' + esc(r.accidentDate || '') + '</td><th>所轄監督署</th><td>' + esc(r.kantoku || '') + '</td></tr>'
    + '<tr><th>傷病の部位</th><td colspan="3">' + esc(r.part || '') + '</td></tr>'
    + '<tr><th>傷病名</th><td colspan="3">' + esc(dx.join('、') || r.disease || '') + '</td></tr>'
    + '<tr><th>診療実日数</th><td>' + days + '日</td><th>診療日</th><td>' + esc(dates) + '</td></tr>'
    + '<tr><th>合計点数</th><td class="num">' + g.points.toLocaleString() + ' 点</td>'
    + '<th>金額（点数×' + ROUSAI_YEN_PER_POINT + '円）</th><td class="big">￥' + g.yen.toLocaleString() + '</td></tr>'
    + '</table>'
    + (rx.length ? '<h2>処方</h2><ul class="rx">' + rx.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '')
    + '<h2>受診ごとの点数</h2><table class="vt"><tr><th>受診日</th><th>区分</th><th>点数</th><th>金額</th></tr>'
    + g.visits.map(function (v) {
        var pts = Number(v.revenue_points) || 0;
        var yen = (v.rousai_yen !== null && v.rousai_yen !== undefined) ? Number(v.rousai_yen) : Math.round(pts * ROUSAI_YEN_PER_POINT);
        return '<tr><td>' + esc(String(v.visit_date).slice(0, 10)) + '</td><td>' + esc(v.visit_type || '') + '</td>'
          + '<td class="num">' + pts.toLocaleString() + '</td><td class="num">' + yen.toLocaleString() + '円</td></tr>';
      }).join('')
    + '</table>'
    + '<p class="memo">※ 一部負担金はありません。摘要欄・療養の給付請求書（様式' + (r.formType === '16-3' ? '16号の3' : '5号') + '）の添付は用紙側に手書きで記入してください。</p>'
    + '</section>';
}
function rousaiPrintCSS() {
  return 'body{font-family:"Yu Gothic","Meiryo",sans-serif;font-size:12px;color:#111;margin:0;}'
    + '.sheet{padding:14mm 12mm;page-break-after:always;}'
    + 'h1{font-size:15px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #111;}'
    + 'h2{font-size:12px;margin:14px 0 4px;}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:8px;}'
    + 'th,td{border:1px solid #666;padding:5px 7px;text-align:left;vertical-align:top;}'
    + 'th{background:#f0f0f0;width:16%;white-space:nowrap;}'
    + 'td.num{text-align:right;font-variant-numeric:tabular-nums;}'
    + 'td.big{font-size:16px;font-weight:700;}'
    + 'ul.rx{margin:4px 0 8px 18px;padding:0;} ul.rx li{margin:2px 0;}'
    + '.memo{font-size:11px;color:#555;margin-top:8px;}'
    + '@media print{.sheet{padding:10mm;}}';
}

// ===== 労災レセ電（RREC）を作る =====
async function rzRousaiUke() {
  var out = document.getElementById('rsUkeResult');
  var rows = window._rousaiRows;
  if (!rows || window._rousaiYm !== rzRousaiMonth()) { await rzRousaiLoad(); rows = window._rousaiRows; }
  if (!rows || !rows.length) { showToast('この月の労災の受診がありません'); if (out) out.innerHTML = ''; return; }
  await Promise.all([ukeLoadServiceTable(), rousaiLoadCodeTable()]);
  var records = rows.map(function (v) {
    var rec = rzDbRecord(v);
    var pt = v.patients || {};
    rec.patient.rousai = pt.rousai || null;
    rec.karte.isRousai = true;
    return rec;
  });
  var ym = window._rousaiYm || rzRousaiMonth();
  var sd = document.getElementById('rsSubmitDate');
  var files = buildRousaiUke(records, { serviceYm: ym, submitDate: sd && sd.value ? sd.value : '' });
  window._rousaiUkeFiles = files;
  var grand = files.reduce(function (a, f) { return a + f.total; }, 0);
  out.innerHTML = '<div class="rs-sum"><b>労災レセ電</b>　' + files.length + 'ファイル ／ 請求金額 ' + grand.toLocaleString() + '円'
    + '<span class="rs-note">（点数×12円＋労災の円建て項目。初診料3,850円・再診料1,430円など）</span></div>'
    + files.map(function (f, i) {
        var ok = !f.warnings.length;
        return '<div class="rs-file" style="border-left:4px solid ' + (ok ? '#0e7c66' : '#b3261e') + ';padding:6px 10px;margin:6px 0;background:#fff;">'
          + '<b>' + esc(f.filename) + '</b>　' + (f.initial ? '初回請求' : '継続') + ' ／ ' + f.count + '件 ／ ' + f.total.toLocaleString() + '円　'
          + '<button class="btn btn-outline" style="padding:2px 10px;" onclick="rzRousaiUkeDownload(' + i + ')">ダウンロード</button>'
          + (ok ? '<div style="color:#0e7c66;font-size:12px;margin-top:4px;">点検：問題なし</div>'
                : '<div style="color:#b3261e;font-size:12px;margin-top:4px;">点検：' + f.warnings.length + '件<br>'
                  + f.warnings.map(function (m) { return esc(m); }).join('<br>') + '</div>')
          + '</div>';
      }).join('');
}
function rzRousaiUkeDownload(i) {
  var f = (window._rousaiUkeFiles || [])[i];
  if (!f) return;
  if (f.warnings.length && !confirm('点検で ' + f.warnings.length + ' 件の指摘があります。このままダウンロードしますか？')) return;
  var blob = rzUkeBlob(f.content);
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = f.filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
