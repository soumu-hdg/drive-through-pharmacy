/* 案F 入荷カウンター（デモ）
   - テスト用の院: 本番DBの「テスト用の院」につながる（sb.js）。「在庫に反映」で DB の在庫が実際に動く
   - 西春・中川: DB には接続しない。demo_data.js の見本で表示し、書き込みはしない
   - localStorage に残すのは最後に選んだ院だけ（受付中の伝票・在庫・納品の記録は残さない） */
(function () {
  'use strict';
  var D = window.DEMO_DATA, KS = window.KanaSearch;
  var $ = function (s) { return document.querySelector(s); };
  var PFX = 'p9F:';
  var S = null;           // 院ごとの状態 {clinic, meds, draft}
  var view = { panel: 'idle', cur: null, unknownCode: null, sel: null, nd: null, lastLineKey: null, lastRec: null };
  var busy = false;       // DB へ送信中
  var extraGs1 = {};      // この画面で結び付けた箱コード → 品目コード（テスト用）
  var resetArm = false;

  // 以前の版が端末に残した院ごとの在庫・納品（p9F:<院>）は使わない
  try { ['nishiharu', 'nakagawa', 'test'].forEach(function (c) { localStorage.removeItem(PFX + c); }); } catch (e) { }

  // ---- 見本の箱（カメラの代わり）----
  var TRAYS = {
    'アルフレッサ': [
      { gs1: '14987376608401', h: 'セファレキシン' },
      { gs1: '14987035510618', h: 'メプチンエアー' },
      { gs1: '04912345002501', h: '未登録の箱（見本番号）' },
      { gs1: '14987086101674', h: '未登録の箱' },
      { gs1: '14987792290112', h: 'ドンペリドン坐剤' },
      { gs1: '14987081103000', h: 'イナビル' }
    ],
    'スズケン': [
      { gs1: '14987084100679', h: 'アレジオン点眼' },
      { gs1: '14987350365818', h: 'アドレナリン注' },
      { gs1: '14987080268014', h: '未登録の箱' }
    ],
    'モンブラン薬局': [
      { gs1: '14987376505212', h: 'セファクロル細粒' },
      { gs1: '14987080268441', h: 'オセルタミビルDS' },
      { gs1: '14987155885023', h: '未登録の箱' }
    ]
  };

  // ---- ユーティリティ ----
  function yen(n) { return '¥' + Math.round(n || 0).toLocaleString('ja-JP'); }
  function num(n) { return (Math.round(n * 100) / 100).toLocaleString('ja-JP'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function nowHM(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function clinicOf(id) { return D.clinics.filter(function (c) { return c.id === id; })[0]; }
  function isExt(m) { return !!m.stock_untracked || /^外用/.test(m.category || ''); }
  function packCost(m) {
    if (m.cost_per_pack) return Number(m.cost_per_pack);
    if (m.cost_per_unit) return Math.round(m.cost_per_unit * (m.pack_size || 1));
    return Math.round((m.official_price || m.price || 0) * (m.pack_size || 1) * 0.9);
  }
  function medBy(code) { return S.meds.filter(function (m) { return m.code === code; })[0]; }
  function searchMeds(q) { return KS.filter(S.meds, q, function (x) { return [x.name, x.furigana, x.code, x.category]; }); }
  function searchMaster(q) { return KS.filter(D.drug_master_sample, q, function (x) { return [x.name, x.kana, x.rezept_code, x.gs1]; }); }
  // 成分の目安＝名前の先頭のカタカナの並び（例 アセトアミノフェン）
  function ingredient(name) {
    var s = String(name || '').normalize('NFKC').replace(/^〔[^〕]*〕/, '');
    var m = s.match(/^[ァ-ヶー]{3,}/); return m ? m[0] : '';
  }
  // 年月4桁（2808）→ その月の末日（2028-08-31）
  function expDate(yymm) {
    if (!/^\d{4}$/.test(yymm || '')) return null;
    var y = 2000 + Number(yymm.slice(0, 2)), mo = Number(yymm.slice(2));
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + new Date(y, mo, 0).getDate()).slice(-2);
  }

  // ---- 院の状態（テスト用は DB が正。見本の院は見本を写してメモリにだけ持つ）----
  function isLiveC(c) { return !!(window.SB && SB.isLive(c)); }
  function canW() { return !!(S && window.SB && SB.canWrite(S.clinic)); }
  function roMsg(c) { return (window.SB && SB.readOnlyMessage(c || S.clinic)) || 'この院では書き込みをしません。'; }
  function load(clinic) {
    S = { clinic: clinic, draft: null };
    if (isLiveC(clinic)) Object.defineProperty(S, 'meds', { get: function () { return D.medicines[clinic] || []; } });
    else S.meds = JSON.parse(JSON.stringify(D.medicines[clinic] || []));
  }
  function save() { try { if (S) localStorage.setItem(PFX + 'last', S.clinic); } catch (e) { } }
  function docToRec(d) {
    var b = d.body || {};
    return { id: 'D' + d.id, docId: d.id, date: b.date || String(d.created_at || '').slice(0, 10), time: b.time || (d.created_at ? nowHM(new Date(d.created_at)) : ''),
      supplier: b.supplier || '', operator: b.operator || d.operator || '', slipNo: d.doc_no || b.slip_no || '', lines: b.lines || [], boxes: b.boxes || 0,
      amount: Number(b.total) || 0, slipTotal: b.slip_total == null ? null : Number(b.slip_total), canceled: d.status === 'canceled', txIds: b.tx_ids || [] };
  }
  function deliveries(c) { return isLiveC(c) ? SB.docs(c, 'delivery').map(docToRec) : []; }

  // ---- 画面切替 ----
  function show(id) {
    ['clinic', 'home', 'start', 'work', 'done'].forEach(function (k) { $('#scr-' + k).hidden = (k !== id); });
    $('#hdr').hidden = (id === 'clinic');
    $('#hdr-count').hidden = (id !== 'work');
    if (id === 'clinic') renderClinics();
    if (id === 'home') renderHome();
  }
  function setClinicLook() {
    var c = clinicOf(S.clinic);
    document.documentElement.style.setProperty('--clinic', c.color);
    document.body.classList.toggle('c-test', S.clinic === 'test' && isLiveC('test'));
    $('#hdr-clinic-name').textContent = c.short;
  }

  // ---- 院の選択 ----
  function renderClinics() {
    var live = window.SB && SB.live;
    var ll = $('#live-line');
    ll.className = 'live-line' + (live ? '' : ' off');
    ll.textContent = live ? 'テスト用の院は本番DBに接続中。操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データで表示し、書き込みはしません。'
      : 'DBに接続できないため、テスト用の院も見本データで表示しています（書き込みはしません）。' + (window.SB && SB.error ? '理由: ' + SB.error : '');
    $('#clinic-list').innerHTML = D.clinics.map(function (c) {
      var st = isLiveC(c.id) ? 'DB接続中・受付した納品 ' + deliveries(c.id).filter(function (d) { return !d.canceled; }).length + '件' : '見本データ・書き込みなし';
      return '<button type="button" class="cl-btn ' + (c.id === 'test' ? 'test' : '') + '" id="clinic-' + c.id + '" data-id="' + c.id + '" style="--c:' + c.color + '">' +
        '<span class="cl-band"></span><span class="cl-body"><b>' + esc(c.short) + '</b><small>' + esc(c.name) + '</small>' +
        '<small>' + esc(c.note || '稼働中') + '</small><span class="cl-st">' + esc(st) + '</span></span></button>';
    }).join('');
    var rb = $('#btn-reset');
    rb.classList.toggle('arm', resetArm);
    rb.textContent = busy ? '初期化しています…' : resetArm ? 'もう一度押すと初期化します（テスト用の院の在庫と記録を最初の状態に戻す）' : 'デモの初期化（テスト用の院を最初の状態に戻す）';
    rb.disabled = busy;
  }
  function selectClinic(id) {
    load(id); setClinicLook(); save(); resetArm = false; $('#reset-msg').textContent = '';
    show('home');
  }
  $('#clinic-list').addEventListener('click', function (e) {
    var b = e.target.closest('.cl-btn'); if (!b || busy) return;
    selectClinic(b.dataset.id);
  });
  $('#btn-reset').addEventListener('click', async function () {
    if (busy) return;
    var msg = $('#reset-msg');
    if (!resetArm) { resetArm = true; msg.textContent = ''; renderClinics(); return; }
    resetArm = false;
    if (!(window.SB && SB.live)) { msg.textContent = 'DBに接続できないため初期化できません'; renderClinics(); return; }
    busy = true; renderClinics();
    try { await SB.resetTest(); extraGs1 = {}; msg.textContent = 'テスト用の院を最初の状態に戻しました（西春・中川は見本のままです）'; }
    catch (err) { msg.textContent = '初期化できませんでした: ' + err.message; }
    busy = false; renderClinics();
  });
  $('#btn-clinic').addEventListener('click', function () { if (!busy) show('clinic'); });

  // ---- ホーム ----
  function pastDeliveries() {
    if (S.clinic !== 'nishiharu') return [];
    var g = {};
    (D.lots_nishiharu || []).forEach(function (l) {
      var k = l.received_on + '|' + l.supplier; if (!g[k]) g[k] = { date: l.received_on, supplier: l.supplier, n: 0, amt: 0 };
      g[k].n++; g[k].amt += (l.unit_cost || 0) * l.qty_received;
    });
    return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function renderHome() {
    $('#hdr-mid').innerHTML = '<b>' + esc(clinicOf(S.clinic).name) + '</b><span>入荷カウンター' + (isLiveC(S.clinic) ? '　本番DBのテスト用の院に接続中' : '　見本データ（書き込みなし）') + '</span>';
    var ro = $('#home-ro');
    if (canW()) { ro.hidden = true; ro.innerHTML = ''; }
    else {
      ro.hidden = false; ro.classList.remove('flash');
      ro.innerHTML = esc(roMsg()) + (window.SB && SB.live && S.clinic !== 'test' ? '<br><button type="button" class="btn go" id="to-test">テスト用の院へ切り替える</button>' : '');
      var tt = $('#to-test'); if (tt) tt.onclick = function () { selectClinic('test'); };
    }
    var low = S.meds.filter(function (m) { return !isExt(m) && m.threshold && m.current_stock < m.threshold; })
      .sort(function (a, b) { return a.current_stock / a.threshold - b.current_stock / b.threshold; });
    $('#low-list').innerHTML = low.length ? low.slice(0, 40).map(function (m) {
      return '<div class="low-row"><span>' + esc(m.name) + '</span><span class="mono">' + num(m.current_stock) + ' / ' + num(m.threshold) + m.unit + '</span></div>';
    }).join('') : '<div class="low-row">ありません</div>';
    if (S.clinic === 'nakagawa') $('#low-list').insertAdjacentHTML('afterbegin', '<div class="low-row"><span>開院前のため在庫は0から始まっています</span></div>');
    var mine = deliveries(S.clinic).map(function (d) {
      return '<div class="hist-row mine ' + (d.canceled ? 'cancel' : '') + '"><span class="d">' + String(d.date).slice(5) + ' ' + d.time + '</span>' +
        '<span><b>' + esc(d.supplier) + '</b> <span class="s">' + (d.slipNo ? esc(d.slipNo) + '　' : '') + d.lines.length + '品目・' + d.boxes + '箱　' + esc(d.operator) + (d.canceled ? '　取り消し済み' : '') + '</span></span>' +
        '<span class="a">' + yen(d.amount) + '</span></div>';
    }).join('');
    var past = pastDeliveries().slice(0, 14).map(function (p) {
      return '<div class="hist-row"><span class="d">' + p.date.slice(5) + '</span><span><b>' + esc(p.supplier) + '</b> <span class="s">' + p.n + '品目　過去の入荷記録（v0.7の簡易入庫）</span></span><span class="a">' + (p.amt ? yen(p.amt) : '単価なし') + '</span></div>';
    }).join('');
    $('#pane-hist').innerHTML = (mine || '') + (past || (mine ? '' : '<div class="idle"><b>まだ納品の記録がありません</b>' + (isLiveC(S.clinic) ? '「納品を始める」から受け付けると、ここに並びます（DBに記録）' : '開院前の院は、最初の納品から記録が始まります') + '</div>'));
    renderStock();
  }
  function renderStock() {
    var q = $('#stock-q').value, list = searchMeds(q).slice(0, 80);
    $('#stock-list').innerHTML = list.map(function (m) {
      var st = isExt(m) ? '<span class="tag ext">外用</span> 数えない' : '<span class="mono ' + (m.current_stock < 0 ? 'neg' : '') + '">' + num(m.current_stock) + '</span> ' + m.unit;
      return '<div class="st-row"><span class="mono">' + m.code + '</span><span>' + esc(m.name) + (m.gs1 ? '' : ' <span class="tag link">箱コード未登録</span>') + '</span><span class="r">' + st + '</span></div>';
    }).join('') || '<div class="st-row"><span></span><span>見つかりません</span></div>';
  }
  $('#stock-q').addEventListener('input', renderStock);
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === t); });
      $('#pane-hist').hidden = t.dataset.t !== 'hist'; $('#pane-stock').hidden = t.dataset.t !== 'stock';
    });
  });

  // ---- 納品の開始 ----
  var startSel = { sup: null, op: null };
  $('#btn-start').addEventListener('click', function () {
    if (!canW()) {   // 見本の院では受付を始めない（書き込みをしない）
      var ro = $('#home-ro'); ro.hidden = false; ro.classList.remove('flash'); void ro.offsetWidth; ro.classList.add('flash');
      return;
    }
    startSel = { sup: null, op: null }; $('#slipno').value = '';
    $('#hdr-mid').innerHTML = '<b>納品の受付</b><span>卸と担当を選びます</span>';
    $('#sup-list').innerHTML = D.suppliers.map(function (s, i) {
      var n = S.meds.filter(function (m) { return m.supplier_name === s; }).length;
      return '<button type="button" class="sup" id="sup-' + i + '" data-s="' + esc(s) + '">' + esc(s) + '<small>この院の取扱い ' + n + '品目</small></button>';
    }).join('');
    $('#op-list').innerHTML = D.operators.map(function (o, i) { return '<button type="button" class="op" id="op-' + i + '" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
    updStart(); show('start');
  });
  function updStart() {
    document.querySelectorAll('.sup').forEach(function (b) { b.classList.toggle('on', b.dataset.s === startSel.sup); });
    document.querySelectorAll('.op').forEach(function (b) { b.classList.toggle('on', b.dataset.o === startSel.op); });
    $('#btn-begin').disabled = !(startSel.sup && startSel.op);
  }
  $('#sup-list').addEventListener('click', function (e) { var b = e.target.closest('.sup'); if (b) { startSel.sup = b.dataset.s; updStart(); } });
  $('#op-list').addEventListener('click', function (e) { var b = e.target.closest('.op'); if (b) { startSel.op = b.dataset.o; updStart(); } });
  $('#btn-start-cancel').addEventListener('click', function () { show('home'); });
  $('#btn-begin').addEventListener('click', function () {
    S.draft = { supplier: startSel.sup, operator: startSel.op, slipNo: $('#slipno').value.trim(), lines: [], slipTotal: '', scanned: [], started: nowHM() };
    view.panel = 'idle'; $('#commit-msg').textContent = ''; show('work'); renderWork();
  });

  // ---- 受付中 ----
  function draftTotals() {
    var d = S.draft, boxes = 0, amt = 0, codes = {};
    d.lines.forEach(function (l) { boxes += l.boxes; amt += l.amount; codes[l.code] = 1; });
    return { boxes: boxes, amount: amt, items: Object.keys(codes).length };
  }
  function renderWork() {
    var d = S.draft;
    $('#hdr-mid').innerHTML = '<b>' + esc(d.supplier) + '</b><span>' + (d.slipNo ? '納品書 ' + esc(d.slipNo) + '　' : '') + '受付 ' + esc(d.operator) + '　' + d.started + '〜</span>';
    $('#tray').innerHTML = (TRAYS[d.supplier] || []).map(function (b, i) {
      return '<button type="button" class="sbox ' + (d.scanned.indexOf(b.gs1) >= 0 ? 'done' : '') + '" id="box-' + (i + 1) + '" data-g="' + b.gs1 + '"><span class="bars"></span><span class="n">' + b.gs1 + '</span><span class="h">' + esc(b.h) + '</span></button>';
    }).join('');
    renderSlip(); renderPanel(); renderCount();
  }
  function renderCount(animate) {
    var t = draftTotals();
    $('#cnt-box').textContent = t.boxes; $('#cnt-item').textContent = t.items;
    var h = ''; for (var i = 0; i < Math.min(t.boxes, 16); i++) h += '<i' + (animate && i >= t.boxes - animate ? ' class="new"' : '') + '></i>';
    $('#cnt-boxes').innerHTML = h;
  }
  function renderSlip() {
    var d = S.draft, t = draftTotals();
    $('#slip-sup').textContent = d.supplier + '　' + d.operator;
    $('#slip-no').textContent = d.slipNo ? 'No. ' + d.slipNo : '番号なし';
    $('#slip-body').innerHTML = d.lines.length ? d.lines.map(function (l, i) {
      var sub = (l.lot ? 'ロット ' + esc(l.lot) : '') + (l.exp ? '　期限 20' + l.exp.slice(0, 2) + '/' + l.exp.slice(2) : '');
      var tg = l.isNew ? ' <span class="tag new">新規</span>' : (l.linked ? ' <span class="tag link">紐づけ</span>' : '');
      var qty = l.ext ? '外用' : num(l.qty) + l.unit;
      return '<tr class="' + (l.key === view.lastLineKey ? 'fresh' : '') + '"><td><div class="nm">' + esc(l.name) + tg + '</div><div class="sub">' + sub + '</div></td><td class="r">' + l.boxes + '</td><td class="r">' + qty + '</td><td class="r">' + yen(l.amount) + '</td>' +
        '<td><button type="button" class="del" data-i="' + i + '" aria-label="この行を外す">×</button></td></tr>';
    }).join('') : '<tr class="slip-empty"><td colspan="5">まだ箱を読んでいません。<br>左で箱のバーコードを読むと、ここに並びます</td></tr>';
    view.lastLineKey = null;
    $('#sum-calc').textContent = yen(t.amount);
    $('#slip-total').value = d.slipTotal;
    renderDiff();
    var cb = $('#btn-commit');
    cb.disabled = !d.lines.length || busy;
    cb.textContent = busy ? '在庫に反映しています…' : '在庫に反映';
  }
  function renderDiff() {
    var d = S.draft, t = draftTotals(), el = $('#diff');
    var v = String(d.slipTotal || '').replace(/[^\d]/g, '');
    if (!v) { el.className = 'diff'; el.textContent = '納品書の金額を入れると、差を出します'; return; }
    var diff = Number(v) - Math.round(t.amount);
    if (diff === 0) { el.className = 'diff ok'; el.textContent = '一致しました（' + yen(v) + '）'; }
    else { el.className = 'diff ng'; el.textContent = '差 ' + (diff > 0 ? '+' : '−') + yen(Math.abs(diff)) + '　納品書の方が' + (diff > 0 ? '多い' : '少ない') + '。読み忘れの箱か単価を確かめてください'; }
  }
  $('#slip-total').addEventListener('input', function () { S.draft.slipTotal = this.value; renderDiff(); });
  $('#slip-body').addEventListener('click', function (e) {
    var b = e.target.closest('.del'); if (!b || busy) return;
    S.draft.lines.splice(Number(b.dataset.i), 1); renderSlip(); renderCount();
  });
  $('#btn-abort').addEventListener('click', function () {
    if (busy) return;
    if (view.panel === 'abort') { S.draft = null; show('home'); toast('納品の受付をやめました。在庫は変わっていません'); return; }
    view.panel = 'abort'; renderPanel();
  });

  // 読み取り
  function scan(code) {
    code = String(code || '').replace(/[^\d]/g, '');
    if (!code) { toast('番号が読めませんでした'); return; }
    if (S.draft.scanned.indexOf(code) < 0) S.draft.scanned.push(code);
    var hits = S.meds.filter(function (m) { return m.gs1 === code || extraGs1[code] === m.code; });
    view.unknownCode = code;
    if (hits.length === 1) openItem(hits[0], {});
    else if (hits.length > 1) { view.panel = 'choose'; view.hits = hits; }
    else { view.panel = 'unknown'; }
    renderWork();
  }
  $('#tray').addEventListener('click', function (e) { var b = e.target.closest('.sbox'); if (b && !busy) scan(b.dataset.g); });
  $('#scan-go').addEventListener('click', function () { if (busy) return; scan($('#scan-input').value); $('#scan-input').value = ''; });
  $('#scan-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !busy) { scan(this.value); this.value = ''; } });

  function openItem(m, opt) {
    view.panel = 'item';
    view.cur = { code: m.code, boxes: 1, loose: 0, lot: '', exp: '', cost: packCost(m), linked: !!opt.linked, isNew: !!opt.isNew };
  }

  function renderPanel() {
    var p = $('#panel'), v = view;
    if (v.panel === 'idle') {
      var n = S.draft.lines.length;
      p.innerHTML = '<div class="idle"><b>' + (n ? '次の箱を読んでください' : '最初の箱を読んでください') + '</b>箱のバーコードにカメラを向けます。' +
        '<br>（デモでは上の「見本の箱」を押すと、読み取ったことになります）<br><br>読み終わったら、右の伝票で納品書の合計と突き合わせて「在庫に反映」を押します。</div>';
      return;
    }
    if (v.panel === 'abort') {
      p.innerHTML = '<div class="unknown"><div class="lbl-tag">確認</div><div class="item-name">この納品の受付をやめますか</div><div class="u-hint">読んだ ' + S.draft.lines.length + ' 行は捨てます。在庫は変わりません。</div>' +
        '<div class="item-foot"><button type="button" class="btn" id="abort-no">続ける</button><button type="button" class="btn warn" id="abort-yes">やめる</button></div></div>';
      $('#abort-no').onclick = function () { v.panel = 'idle'; renderPanel(); };
      $('#abort-yes').onclick = function () { $('#btn-abort').click(); };
      return;
    }
    if (v.panel === 'choose') {
      p.innerHTML = '<div class="unknown"><div class="lbl-tag">量違いの品目があります</div><div class="u-code">' + v.unknownCode + '</div>' +
        '<div class="u-hint">同じ箱のコードに ' + v.hits.length + ' 品目が結び付いています（分包の量違い）。どの品目として入れますか。</div>' +
        '<div class="pick-list" style="margin-top:10px">' + v.hits.map(function (m) {
          return '<button type="button" class="pick" id="pick-' + m.code + '" data-c="' + m.code + '"><span class="mono">' + m.code + '</span><span>' + esc(m.name) + '</span><small>在庫 ' + num(m.current_stock) + m.unit + '</small></button>';
        }).join('') + '</div></div>';
      p.querySelectorAll('.pick').forEach(function (b) { b.onclick = function () { openItem(medBy(b.dataset.c), {}); renderPanel(); }; });
      return;
    }
    if (v.panel === 'unknown') {
      var mh = D.drug_master_sample.filter(function (x) { return x.gs1 === v.unknownCode; })[0];
      p.innerHTML = '<div class="unknown"><div class="lbl-tag">この院ではまだ知らない箱です</div>' +
        '<div class="u-code">' + v.unknownCode + '</div>' +
        '<div class="u-hint">' + (mh ? '厚労省の医薬品マスタでは「' + esc(mh.name) + '」の箱です。' : '厚労省の医薬品マスタにこの番号は見つかりません。') + '　一度決めれば、次からは読むだけで品目が出ます。</div>' +
        '<div class="u-choice"><button type="button" id="btn-link"><span class="no">1</span>既にある品目に紐づける<small>棚に同じ薬がある（箱のコードが未登録なだけ）</small></button>' +
        '<button type="button" id="btn-new"><span class="no">2</span>新しい薬として登録<small>厚労省マスタから名前・単位・薬価を入れます</small></button></div></div>';
      $('#btn-link').onclick = function () { v.panel = 'link'; renderPanel(); var q = $('#link-q'); q && q.focus(); };
      $('#btn-new').onclick = function () { v.panel = 'new'; v.nd = { q: v.unknownCode, pick: null, target: null, pack: '', cost: '', th: '' }; renderPanel(); };
      return;
    }
    if (v.panel === 'link') {
      p.innerHTML = '<div class="unknown"><div class="lbl-tag">既にある品目に紐づける</div><div class="u-code">' + v.unknownCode + '</div>' +
        '<div class="sub-h">棚にある品目を探す</div><input id="link-q" class="inp" style="width:100%" placeholder="ローマ字・かな・カナ（例 toranekisamu）" autocomplete="off">' +
        '<div class="pick-list" id="link-list" style="margin-top:8px"></div><div id="link-msg" class="errmsg"></div>' +
        '<div class="item-foot"><button type="button" class="btn ghost" id="link-back">戻る</button><span class="u-hint">選ぶと、この箱のコードを品目に登録します（DBに記録）</span></div></div>';
      var draw = function () {
        var q = $('#link-q').value, list = q ? searchMeds(q) : S.meds.filter(function (m) { return !m.gs1; });
        $('#link-list').innerHTML = list.slice(0, 30).map(function (m) {
          return '<button type="button" class="pick" id="lk-' + m.code + '" data-c="' + m.code + '"><span class="mono">' + m.code + '</span><span>' + esc(m.name) + (m.gs1 ? ' <small>（別の箱コードあり）</small>' : '') + '</span><small>在庫 ' + (isExt(m) ? '外用' : num(m.current_stock) + m.unit) + '</small></button>';
        }).join('') || '<div class="pick">見つかりません</div>';
      };
      $('#link-q').oninput = draw; draw();
      $('#link-list').onclick = async function (e) {
        var b = e.target.closest('.pick'); if (!b || !b.dataset.c || busy) return;
        var code = b.dataset.c, gs1 = v.unknownCode, msg = $('#link-msg');
        if (!canW()) { msg.textContent = roMsg(); return; }
        busy = true; msg.textContent = ''; b.disabled = true; b.insertAdjacentHTML('beforeend', '<small>登録しています…</small>');
        try { await SB.mapGs1(S.clinic, gs1, code); }
        catch (err) { busy = false; msg.textContent = '箱のコードを登録できませんでした: ' + err.message; b.disabled = false; draw(); return; }
        busy = false; extraGs1[gs1] = code;
        var m = medBy(code);
        toast('「' + m.name + '」に箱のコードを登録しました。次からは読むだけで出ます');
        openItem(m, { linked: true }); renderWork();
      };
      $('#link-back').onclick = function () { if (!busy) { v.panel = 'unknown'; renderPanel(); } };
      return;
    }
    if (v.panel === 'new') { renderNew(p); return; }
    if (v.panel === 'item') { renderItem(p); return; }
  }

  // 新しい薬の登録
  function renderNew(p) {
    var v = view, nd = v.nd;
    var res = searchMaster(nd.q).slice(0, 20);
    var html = '<div class="unknown"><div class="lbl-tag">新しい薬として登録</div>' +
      '<div class="sub-h">厚労省の医薬品マスタから探す <span class="u-hint">（箱の番号・ローマ字・かなで引けます）</span></div>' +
      '<input id="nm-q" class="inp mono" style="width:100%" value="' + esc(nd.q) + '" autocomplete="off">';
    if (!nd.pick) {
      html += '<div class="pick-list" style="margin-top:8px">' + (res.map(function (x) {
        return '<button type="button" class="pick" id="ms-' + x.rezept_code + '" data-r="' + x.rezept_code + '"><span class="mono">' + x.unit + '</span><span>' + esc(x.name) + ' <small>' + esc(x.makers) + '</small></span><small class="mono">薬価 ' + x.price + '</small></button>';
      }).join('') || '<div class="pick">見つかりません。名前のローマ字でも探せます</div>') + '</div>';
      html += '<div class="item-foot"><button type="button" class="btn ghost" id="nd-back">戻る</button></div></div>';
      p.innerHTML = html;
      $('#nm-q').oninput = function () { nd.q = this.value; var pos = this.selectionStart; renderNew(p); var q = $('#nm-q'); q.focus(); q.setSelectionRange(pos, pos); };
      p.querySelectorAll('.pick[data-r]').forEach(function (b) {
        b.onclick = function () { nd.pick = D.drug_master_sample.filter(function (x) { return x.rezept_code === b.dataset.r; })[0]; renderNew(p); };
      });
      $('#nd-back').onclick = function () { v.panel = 'unknown'; renderPanel(); };
      return;
    }
    var x = nd.pick, ing = ingredient(x.name);
    var same = S.meds.filter(function (m) { return m.rezept_code === x.rezept_code; });
    var sim = ing ? S.meds.filter(function (m) { return same.indexOf(m) < 0 && ingredient(m.name) === ing; }) : [];
    html += '<dl class="auto" style="margin-top:10px">' +
      '<dt>薬品名</dt><dd>' + esc(x.name) + '<span class="src">マスタから</span></dd>' +
      '<dt>単位</dt><dd>' + esc(x.unit) + '<span class="src">マスタから</span></dd>' +
      '<dt>薬価</dt><dd class="mono">' + x.price + ' 円/' + esc(x.unit) + '<span class="src">マスタから</span></dd>' +
      '<dt>メーカー</dt><dd>' + esc(x.makers) + '<span class="src">マスタから</span></dd>' +
      '<dt>箱のコード</dt><dd class="mono">' + v.unknownCode + '<span class="src">読み取りから</span></dd></dl>';
    if (same.length || sim.length) {
      html += '<div class="warnbox"><b>' + (same.length ? '同じ薬が既に登録されています' : '同じ成分（' + esc(ing) + '）の品目が既に ' + sim.length + ' 件あります') + '</b>' +
        '<ul>' + same.concat(sim).slice(0, 5).map(function (m) { return '<li>' + m.code + '　' + esc(m.name) + '（在庫 ' + (isExt(m) ? '外用' : num(m.current_stock) + m.unit) + '）</li>'; }).join('') + '</ul>' +
        '<div style="margin-top:6px">剤形や規格が違う別の薬なら、このまま登録してください。棚の品目と同じ薬なら <button type="button" class="lnk" id="nd-tolink">既にある品目に紐づける</button></div></div>';
    }
    html += '<div class="sub-h">対象 <span class="typed">選ぶ</span></div><div class="seg" id="nd-seg">' +
      [['adult', '成人'], ['child', '小児'], ['ext', '外用'], ['test', '検査']].map(function (t) { return '<button type="button" id="tg-' + t[0] + '" data-t="' + t[1] + '" class="' + (nd.target === t[1] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="fields">' +
      '<label class="fld">入数（1箱あたり ' + esc(x.unit) + '）<span class="typed">入力</span><input id="nd-pack" class="inp mono" inputmode="decimal" value="' + esc(nd.pack) + '"></label>' +
      '<label class="fld">仕入単価（1箱・税抜）<span class="typed">入力</span><input id="nd-cost" class="inp mono" inputmode="numeric" value="' + esc(nd.cost) + '"></label>' +
      '<label class="fld">発注点（' + esc(x.unit) + '）<span class="typed">入力</span><input id="nd-th" class="inp mono" inputmode="decimal" value="' + esc(nd.th) + '"></label></div>' +
      '<div id="nd-msg" class="errmsg"></div>' +
      '<div class="item-foot"><button type="button" class="btn ghost" id="nd-repick">選び直す</button><button type="button" class="btn go" id="btn-nd-save">登録して、この箱の数を入れる</button></div></div>';
    p.innerHTML = html;
    $('#nm-q').oninput = function () { nd.q = this.value; nd.pick = null; renderNew(p); var q = $('#nm-q'); q.focus(); };
    $('#nd-seg').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; nd.target = b.dataset.t; p.querySelectorAll('#nd-seg button').forEach(function (y) { y.classList.toggle('on', y === b); }); };
    ['pack', 'cost', 'th'].forEach(function (k) { $('#nd-' + k).oninput = function () { nd[k] = this.value; }; });
    $('#nd-repick').onclick = function () { if (!busy) { nd.pick = null; renderNew(p); } };
    var tl = $('#nd-tolink'); if (tl) tl.onclick = function () { v.panel = 'link'; renderPanel(); };
    $('#btn-nd-save').onclick = async function () {
      if (busy) return;
      var btn = this, msg = $('#nd-msg');
      var pack = Number(nd.pack), cost = Number(String(nd.cost).replace(/[^\d.]/g, '')), th = Number(nd.th);
      if (!nd.target) { msg.textContent = '対象（成人・小児・外用・検査）を選んでください'; return; }
      if (!(pack > 0)) { msg.textContent = '入数を入れてください'; $('#nd-pack').focus(); return; }
      if (!canW()) { msg.textContent = roMsg(); return; }
      var row = {
        name: x.name, furigana: String(x.kana || '').normalize('NFKC'), unit: x.unit, category: nd.target + '/新規登録',
        price: x.price, pack_size: pack, cost_per_pack: cost || null, threshold: th || 0, current_stock: 0,
        rezept_code: x.rezept_code, maker: x.makers, form: x.form, gs1: v.unknownCode
      };
      busy = true; msg.textContent = ''; btn.disabled = true; btn.textContent = '登録しています…';
      var r;
      try { r = await SB.upsertMedicine(S.clinic, row, S.draft.operator, 'demo:F'); }
      catch (err) { busy = false; btn.disabled = false; btn.textContent = '登録して、この箱の数を入れる'; msg.textContent = '登録できませんでした: ' + err.message; return; }
      busy = false;
      var m = medBy(r && r.code);
      if (!m) { msg.textContent = '登録しましたが、品目の読み直しに失敗しました（' + (r && r.code) + '）。もう一度箱を読んでください'; btn.disabled = false; btn.textContent = '登録して、この箱の数を入れる'; return; }
      extraGs1[v.unknownCode] = m.code;
      toast(m.code + '「' + m.name + '」を登録しました（在庫0から・DBに記録）');
      openItem(m, { isNew: true }); renderWork();
    };
  }

  // 箱の数を入れる
  function renderItem(p) {
    var c = view.cur, m = medBy(c.code), ext = isExt(m);
    var badge = c.isNew ? '<span class="tag new">今登録した薬</span> ' : (c.linked ? '<span class="tag link">今紐づけた箱</span> ' : '');
    p.innerHTML = '<div class="item"><div class="lbl-tag">' + m.code + '　読み取った品目</div>' +
      '<div class="code-strip"><span class="bars"></span>' + (view.unknownCode || m.gs1 || '') + '</div>' +
      '<div class="item-name">' + badge + esc(m.name) + (ext ? ' <span class="tag ext">外用</span>' : '') + '</div>' +
      '<div class="item-sub">1箱 = <b class="mono">' + num(m.pack_size || 1) + '</b> ' + m.unit + '　／　1箱の仕入単価 <span class="mono">' + yen(c.cost) + '</span>　／　今の在庫 ' + (ext ? '外用のため数えない' : '<span class="mono ' + (m.current_stock < 0 ? 'neg' : '') + '">' + num(m.current_stock) + '</span> ' + m.unit) + '</div>' +
      '<div class="qty-row"><div class="stepper"><button type="button" id="box-minus" aria-label="1箱減らす">−</button><input id="boxes" inputmode="numeric" value="' + c.boxes + '"><button type="button" id="box-plus" aria-label="1箱増やす">＋</button></div>' +
      '<div class="conv" id="conv"></div></div>' +
      '<div class="fields"><label class="fld">バラ（端数）<em>任意・' + m.unit + '</em><input id="loose" class="inp mono" inputmode="numeric" value="' + (c.loose || '') + '"></label>' +
      '<label class="fld">ロット<em>任意</em><input id="lot" class="inp mono" value="' + esc(c.lot) + '" autocomplete="off"></label>' +
      '<label class="fld">使用期限<em>任意・年月4桁（例 2808）</em><input id="exp" class="inp mono" inputmode="numeric" maxlength="4" value="' + esc(c.exp) + '"></label></div>' +
      '<div class="item-foot"><button type="button" class="btn ghost" id="item-cancel">この箱を外す</button><button type="button" class="btn go" id="btn-add-line">伝票に載せて、次の箱へ</button></div></div>';
    var conv = function () {
      var q = c.boxes * (m.pack_size || 1) + Number(c.loose || 0);
      var ex = c.exp && /^\d{4}$/.test(c.exp) ? '　期限 20' + c.exp.slice(0, 2) + '年' + Number(c.exp.slice(2)) + '月' : '';
      $('#conv').innerHTML = '<span class="mono">' + c.boxes + '</span>箱 ＝ <span class="mono">' + num(q) + '</span>' + m.unit + '<small>金額 ' + yen(c.cost * c.boxes) + ex + '</small>';
    };
    conv();
    $('#box-minus').onclick = function () { c.boxes = Math.max(0, c.boxes - 1); $('#boxes').value = c.boxes; conv(); };
    $('#box-plus').onclick = function () { c.boxes++; $('#boxes').value = c.boxes; conv(); };
    $('#boxes').oninput = function () { c.boxes = Math.max(0, parseInt(this.value, 10) || 0); conv(); };
    $('#loose').oninput = function () { c.loose = Number(this.value) || 0; conv(); };
    $('#lot').oninput = function () { c.lot = this.value.trim(); };
    $('#exp').oninput = function () { c.exp = this.value.replace(/\D/g, '').slice(0, 4); conv(); };
    $('#item-cancel').onclick = function () { view.panel = 'idle'; renderPanel(); };
    $('#btn-add-line').onclick = function () {
      if (c.exp && !/^\d{4}$/.test(c.exp)) { toast('使用期限は年月の4桁で入れてください（例 2808）'); return; }
      if (c.exp && (Number(c.exp.slice(2)) < 1 || Number(c.exp.slice(2)) > 12)) { toast('使用期限の月が 01〜12 ではありません'); return; }
      if (!c.boxes && !c.loose) { toast('箱数が0です'); return; }
      var q = c.boxes * (m.pack_size || 1) + Number(c.loose || 0);
      var unitCost = c.cost ? Math.round(c.cost / (m.pack_size || 1) * 10000) / 10000 : null;
      var key = m.code + '|' + c.lot + '|' + c.exp;
      var ex = S.draft.lines.filter(function (l) { return l.key === key; })[0];
      if (ex) { ex.boxes += c.boxes; ex.qty += q; ex.amount += c.cost * c.boxes; }
      else S.draft.lines.push({ key: key, code: m.code, name: m.name, unit: m.unit, boxes: c.boxes, qty: q, amount: c.cost * c.boxes, unitCost: unitCost, lot: c.lot, exp: c.exp, isNew: c.isNew, linked: c.linked, ext: isExt(m) });
      view.lastLineKey = key; var add = c.boxes;
      view.panel = 'idle'; renderSlip(); renderPanel(); renderCount(add);
      toast(m.name + '　' + c.boxes + '箱（' + num(q) + m.unit + '）を伝票に載せました');
    };
  }

  // ---- 在庫に反映（納品の全品目を1回で DB へ。失敗したら数字は動かさない）----
  function docBody(rec) {
    return { date: rec.date, time: rec.time, supplier: rec.supplier, operator: rec.operator, slip_no: rec.slipNo, total: Math.round(rec.amount), slip_total: rec.slipTotal,
      boxes: rec.boxes, canceled: rec.canceled, tx_ids: rec.txIds,
      lines: rec.lines.map(function (r) { return { code: r.code, name: r.name, unit: r.unit, boxes: r.boxes, qty: r.qty, amount: r.amount, lot: r.lot, exp: r.exp, before: r.before, after: r.after, ext: r.ext, tx_id: r.tx_id }; }) };
  }
  $('#btn-commit').addEventListener('click', async function () {
    if (busy) return;
    var d = S.draft, t = draftTotals(), msg = $('#commit-msg');
    msg.textContent = '';
    if (!canW()) { msg.textContent = roMsg(); return; }
    var now = new Date();
    var no = d.slipNo || ('F-' + today().replace(/-/g, '') + '-' + nowHM(now).replace(':', ''));
    var items = d.lines.map(function (l) {
      var it = { code: l.code, kind: 'in', delta: l.qty, ref: no };
      if (l.lot) it.lot_no = l.lot;
      if (l.exp) it.expiry_on = expDate(l.exp);
      if (l.unitCost) it.unit_cost = l.unitCost;
      return it;
    });
    busy = true; renderSlip();
    var res;
    try { res = await SB.apply(S.clinic, items, d.operator, 'demo:F'); }
    catch (err) { busy = false; renderSlip(); msg.textContent = '在庫に反映できませんでした（在庫は変わっていません）: ' + err.message; return; }
    var used = {};
    var rows = d.lines.map(function (l, i) {
      var r = res[i] && res[i].code === l.code && !used[i] ? (used[i] = 1, res[i]) : null;
      if (!r) res.some(function (x, j) { if (!used[j] && x.code === l.code) { used[j] = 1; r = x; return true; } return false; });
      r = r || {};
      var m = medBy(l.code); if (m && !m.supplier_name) m.supplier_name = d.supplier;
      return { code: l.code, name: l.name, unit: l.unit, qty: l.qty, boxes: l.boxes, before: Number(r.before), after: Number(r.after), ext: l.ext, lot: l.lot, exp: l.exp, amount: l.amount, tx_id: r.tx_id };
    });
    var slip = String(d.slipTotal || '').replace(/[^\d]/g, '');
    var rec = { id: 'R' + Date.now(), date: today(), time: nowHM(now), supplier: d.supplier, operator: d.operator, slipNo: no, lines: rows, boxes: t.boxes, amount: t.amount,
      slipTotal: slip ? Number(slip) : null, canceled: false, txIds: res.map(function (x) { return x.tx_id; }), docId: null, docErr: '' };
    try { rec.docId = await SB.saveDoc(S.clinic, null, 'delivery', no, 'done', docBody(rec), d.operator); }
    catch (err) { rec.docErr = '在庫には反映しましたが、納品の記録を残せませんでした: ' + err.message; }
    busy = false; S.draft = null;
    view.lastRec = rec; renderDone(rec); show('done');
    if (rec.docErr) $('#undo-msg').textContent = rec.docErr;
  });
  function renderDone(rec) {
    $('#hdr-mid').innerHTML = '<b>' + esc(rec.supplier) + '</b><span>' + (rec.slipNo ? '納品書 ' + esc(rec.slipNo) + '　' : '') + '受付 ' + esc(rec.operator) + '</span>';
    $('#done-stamp').textContent = rec.canceled ? '取消' : '反映済';
    $('#done-stamp').classList.toggle('cancel', rec.canceled);
    $('#done-title').textContent = rec.canceled ? 'この納品を取り消しました。在庫は元に戻っています' : rec.lines.length + '品目・' + rec.boxes + '箱を在庫に反映しました（DBに記録）';
    var chk = rec.slipTotal == null ? '納品書の金額は未入力' : (rec.slipTotal === Math.round(rec.amount) ? '納品書の合計と一致' : '納品書との差 ' + yen(rec.slipTotal - rec.amount));
    $('#done-sub').textContent = rec.date + ' ' + rec.time + '　合計 ' + yen(rec.amount) + '（' + chk + '）';
    $('#res-body').innerHTML = rec.lines.map(function (r) {
      return '<tr class="' + (rec.canceled ? 'cx' : '') + '"><td>' + esc(r.name) + (r.lot ? '<div class="done-s">ロット ' + esc(r.lot) + (r.exp ? '　期限 20' + r.exp.slice(0, 2) + '/' + r.exp.slice(2) : '') + '</div>' : '') + '</td>' +
        '<td class="r">+' + num(r.qty) + r.unit + '</td>' +
        (r.ext ? '<td class="r" colspan="3">外用のため数えない</td>' : '<td class="r">' + num(r.before) + '</td><td class="arw">→</td><td class="r up">' + num(r.after) + '</td>') + '</tr>';
    }).join('');
    $('#btn-undo').hidden = rec.canceled || !rec.txIds.length; $('#btn-undo').disabled = false; $('#btn-undo').textContent = 'この納品を取り消す';
    $('#undo-msg').textContent = '';
  }
  $('#btn-undo').addEventListener('click', async function () {
    var rec = view.lastRec; if (!rec || rec.canceled || busy) return;
    var btn = this, msg = $('#undo-msg');
    if (!canW()) { msg.textContent = roMsg(); return; }
    busy = true; btn.disabled = true; btn.textContent = '取り消しています…'; msg.textContent = '';
    var res;
    try { res = await SB.voidTx(S.clinic, rec.txIds, rec.operator); }
    catch (err) { busy = false; btn.disabled = false; btn.textContent = 'この納品を取り消す'; msg.textContent = '取り消せませんでした（在庫は変わっていません）: ' + err.message; return; }
    rec.canceled = true;
    var back = (res || []).map(function (x) { return x.code + ' ' + num(Number(x.before)) + '→' + num(Number(x.after)); }).join('、');
    var extra = '';
    try { if (rec.docId) await SB.saveDoc(S.clinic, rec.docId, 'delivery', rec.slipNo, 'canceled', docBody(rec), rec.operator); }
    catch (err) { extra = '（納品の記録を「取り消し」に書き換えられませんでした: ' + err.message + '）'; }
    busy = false; renderDone(rec);
    msg.textContent = '在庫を元に戻しました：' + back + '（紐づけた箱のコードと、登録した新しい薬は残ります）' + extra;
  });
  $('#btn-home').addEventListener('click', async function () {
    if (busy) return;
    if (isLiveC(S.clinic)) { try { await SB.refresh(S.clinic); } catch (e) { } }
    show('home');
  });

  // ---- 起動: DB の読み込みを待ってから最初の描画 ----
  window.__F = { state: function () { return S; }, scan: scan };
  $('#clinic-list').innerHTML = '<div class="idle" id="connecting"><b>接続中…</b>テスト用の院の在庫をDBから読み込んでいます</div>';
  (window.SB ? SB.ready : Promise.resolve(false)).then(function () { show('clinic'); });
})();
