/* 案D 院長・管理者用 ─ 院を切り替えて比べる俯瞰と、開院準備の一括投入
   テスト用の院だけ本番DBにつなぐ（sb.js）。俯瞰・品目の動き・並べ比べのテスト用の列は DB の値、
   開院準備の一括投入はテスト用に対してだけ DB へ書く（SB.apply でまとめて1回＋発注点は SB.upsertMedicine）。
   西春・中川は demo_data.js の見本データのまま（書き込みも端末への保存もしない）。
   localStorage に残すのは「選んだ院」だけ。 */
(function () {
  'use strict';
  var D = window.DEMO_DATA, KS = window.KanaSearch, SB = window.SB;
  var KEY = 'p9D:';
  var OP = '院長', SRC = 'demo:D', BUSY = false;
  function isDB(cid) { return !!(SB && SB.isLive(cid)); }
  var CL = D.clinics, CIDS = CL.map(function (c) { return c.id; });
  var CCOL = { nishiharu: '#16a585', nakagawa: '#6f93dc', test: '#d6b02e' };
  var CNAME = { nishiharu: '西春', nakagawa: '中川', test: 'テスト用' };
  var HOL = { '2026-09-21': 1, '2026-09-22': 1, '2026-09-23': 1 };

  /* ---------- 集計期間（西春の出庫データの範囲） ---------- */
  var DAYS = [];
  (function () {
    var ds = D.daily_out_nishiharu.map(function (r) { return r.d; }).sort();
    var a = new Date(ds[0] + 'T00:00:00'), b = new Date(ds[ds.length - 1] + 'T00:00:00');
    for (var t = a; t <= b; t = new Date(t.getTime() + 864e5)) {
      DAYS.push(t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2));
    }
  })();
  var ND = DAYS.length, DIX = {};
  DAYS.forEach(function (d, i) { DIX[d] = i; });
  function isOff(d) { var w = new Date(d + 'T00:00:00').getDay(); return w === 0 || w === 6 || HOL[d]; }

  /* 西春の出庫（件数・数量）を品目×日に */
  var HN = {};
  D.daily_out_nishiharu.forEach(function (r) {
    var h = HN[r.c] || (HN[r.c] = { n: zeros(), q: zeros(), sn: 0, sq: 0 });
    var i = DIX[r.d]; h.n[i] += r.n; h.q[i] += r.q; h.sn += r.n; h.sq += r.q;
  });
  function zeros() { var a = []; for (var i = 0; i < ND; i++) a.push(0); return a; }
  function ymd(t) { return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }

  /* テスト用（DB）の出庫：DEMO_DATA.daily_out_test を、最後の出庫日までの31日に並べる */
  var HTc = null;
  function HT() {
    if (HTc) return HTc;
    var rows = D.daily_out_test || [], ds = rows.map(function (r) { return r.d; }).sort(), w = { days: DAYS, ix: DIX };
    if (ds.length) {
      var end = new Date(ds[ds.length - 1] + 'T00:00:00'), days = [], ix = {};
      for (var i = ND - 1; i >= 0; i--) days.push(ymd(new Date(end.getTime() - i * 864e5)));
      days.forEach(function (d, k) { ix[d] = k; }); w = { days: days, ix: ix };
    }
    var h = {};
    rows.forEach(function (r) {
      var i = w.ix[r.d]; if (i === undefined) return;
      var x = h[r.c] || (h[r.c] = { n: zeros(), q: zeros(), sn: 0, sq: 0 });
      x.n[i] += r.n; x.q[i] += r.q; x.sn += r.n; x.sq += r.q;
    });
    return (HTc = { w: w, h: h });
  }
  function win(cid) { return cid === 'test' && isDB('test') ? HT().w : { days: DAYS, ix: DIX }; }

  /* ---------- 状態（院ごと・この画面の中だけ。端末には保存しない） ---------- */
  function ls(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(KEY + k)); localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { return null; }
  }
  // 以前の版が端末に残した院ごとの在庫・記録は使わない（消す）
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY + 'st:') === 0) localStorage.removeItem(k); }); } catch (e) {}
  var ST = {};
  function st(cid) {
    if (!ST[cid]) ST[cid] = { off: {}, set: {}, dec: {} };
    return ST[cid];
  }

  function meds(cid) {
    var s = st(cid);
    return (D.medicines[cid] || []).map(function (m) {
      var o = Object.assign({}, m);
      o.name = String(m.name).normalize('NFKC');
      o.current_stock = Number(m.current_stock) || 0;
      o.threshold = Number(m.threshold) || 0;
      // 共通データでは中川の外用薬に西春の在庫数が残っているため、在庫0から開始に揃える
      if (cid === 'nakagawa' && m.stock_untracked) o.current_stock = 0;
      o.handled = !s.off[m.code];
      return o;
    });
  }
  /* 出庫履歴：西春は見本データの実績。テスト用はDBの出庫記録。中川は記録なし */
  function hist(cid, code) {
    if (cid === 'nishiharu') return HN[code] || null;
    if (cid === 'test' && isDB('test')) return HT().h[code] || null;
    return null;
  }
  function hasHist(cid) { return cid === 'nishiharu' || (cid === 'test' && isDB('test') && Object.keys(HT().h).length > 0); }

  /* ---------- 指標 ---------- */
  function metrics(cid) {
    var list = meds(cid).filter(function (m) { return m.handled; });
    var M = { items: list.length, cost: 0, price: 0, zero: 0, minus: 0, low: 0, neg: 0, negLoss: 0, noCost: 0, dead: 0, deadVal: 0, outN: 0, minItem: null, zeroUsed: 0 };
    var hh = hasHist(cid);
    list.forEach(function (m) {
      var s = m.current_stock || 0, h = hist(cid, m.code);
      M.cost += s * (m.cost_per_unit || 0); M.price += s * (m.price || 0);
      if (m.cost_per_unit == null) M.noCost++;
      if ((m.margin_rate_pct || 0) < 0) { M.neg++; if (h) M.negLoss += h.sq * ((m.price || 0) - (m.cost_per_unit || 0)); }
      if (h) M.outN += h.sn;
      if (!m.stock_untracked) {
        if (s < 0) { M.minus++; if (!M.minItem || s < M.minItem.current_stock) M.minItem = m; }
        if (s === 0) { M.zero++; if (HN[m.code]) M.zeroUsed++; }
        if (s < m.threshold) M.low++;
      }
      if (hh && !h && s > 0) { M.dead++; M.deadVal += s * (m.cost_per_unit || 0); }
    });
    M.hasHist = hh;
    return M;
  }

  /* ---------- 書式 ---------- */
  function yen(v) { return (v < 0 ? '-¥' : '¥') + Math.round(Math.abs(v)).toLocaleString('ja-JP'); }
  function num(v) { if (v == null) return '—'; var r = Math.round(v * 10) / 10; return r.toLocaleString('ja-JP'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function up(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function md(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function avgDay(code) { var h = HN[code]; return h ? h.sq / ND : 0; }
  /* 「あと何日」：テスト用（DB）は自院の出庫記録、ほかは西春の出庫ペースで割る */
  function paceOf(cid, code) { if (cid === 'test' && isDB('test')) { var h = HT().h[code]; return h ? h.sq / ND : 0; } return avgDay(code); }
  function cover(m) {
    var a = paceOf(cur, m.code); if (!a) return null; return (m.current_stock || 0) / a;
  }
  function spark(arr, w, h, col) {
    if (!arr) return '<span class="dim">—</span>';
    var mx = Math.max.apply(null, arr) || 1, bw = w / arr.length, s = '';
    arr.forEach(function (v, i) { if (!v) return; var bh = Math.max(1.5, v / mx * h); s += '<rect x="' + (i * bw).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 0.8).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (col || '#8a939e') + '"/>'; });
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><line x1="0" y1="' + (h - 0.5) + '" x2="' + w + '" y2="' + (h - 0.5) + '" stroke="#353d47"/>' + s + '</svg>';
  }
  function tagOf(m) {
    var t = m.category ? m.category.split('/')[0] : '';
    return m.stock_untracked ? '<span class="gx ext">外用</span>' : (t ? '<span class="gx">' + esc(t) + '</span>' : '');
  }
  function stockTxt(m) { return m.stock_untracked ? '<span class="ref">外用</span>' : num(m.current_stock) + '<span class="dim"> ' + esc(m.unit) + '</span>'; }

  /* ---------- 画面の切替 ---------- */
  var cur = null, view = 'ov', itF = 'top', prT = 'nakagawa', prD = 21, prR = 75, SEL = {};
  var $ = function (id) { return document.getElementById(id); };

  function showPicker() {
    $('app').hidden = true; $('picker').hidden = false;
    $('pk-db').innerHTML = dbLine();
    $('pk-list').innerHTML = CL.map(function (c) {
      var M = metrics(c.id);
      return '<button type="button" class="pk ' + c.id + '" id="pk-' + c.id + '" style="--c:' + CCOL[c.id] + '">' +
        '<span class="pk-c"></span><span class="pk-b"><span class="pk-n">' + esc(c.short) + (c.id === 'test' ? '（練習用）' : '') + '</span>' +
        (isDB(c.id) ? '<span class="dbt live">本番DBに接続中・操作すると値が動きます</span>' : '<span class="dbt">見本データ・書き込みしません</span>') +
        '<span class="pk-f">' + esc(c.name) + (c.note ? '<br>' + esc(c.note) : '') + '</span>' +
        '<dl><dt>扱う品目</dt><dd>' + M.items + '</dd><dt>在庫金額（仕入値）</dt><dd>' + yen(M.cost) + '</dd>' +
        '<dt>マイナス在庫</dt><dd>' + M.minus + '</dd><dt>31日の出庫</dt><dd>' + (M.hasHist ? M.outN + ' 件' : '記録なし') + '</dd></dl></span></button>';
    }).join('');
    CL.forEach(function (c) { $('pk-' + c.id).addEventListener('click', function () { setClinic(c.id); }); });
  }
  function dbLine() {
    if (!SB) return 'DBに接続する部品が読み込めていません。3院とも見本データで表示しています（書き込みはできません）。';
    return SB.live ? '<b>テスト用の院は本番DBに接続中。</b>操作すると実際に値が動きます（西春・中川には影響しません）。西春・中川は見本データで表示し、書き込みはしません。'
      : '<b>DBに接続できないため、テスト用も見本データで表示しています</b>（書き込みはできません）。理由：' + esc(SB.error || '不明');
  }
  /* 書き込めない院で押したとき：画面内に文言＋テスト用へ切り替えるボタン */
  function roBox(box, t) {
    var m = SB ? SB.readOnlyMessage(t) : 'DBに接続する部品が読み込めていません。';
    if (t === 'test' && SB && SB.error) m += '（理由：' + SB.error + '）';
    box.className = 'pr-confirm ro'; box.hidden = false;
    box.innerHTML = '<div class="msg"><b>書き込みはしません</b>　' + esc(m) + '</div>' +
      (t !== 'test' && SB && SB.live ? '<button type="button" class="btn-sub" id="ro-totest">テスト用の院で準備する</button>' : '');
    var b = $('ro-totest'); if (b) b.addEventListener('click', function () { prT = 'test'; box.hidden = true; renderPr(); });
  }

  function setClinic(cid) {
    cur = cid; ls('clinic', cid); HTc = null;
    document.body.className = 'cl-' + cid;
    document.documentElement.style.setProperty('--cl', CCOL[cid]);
    $('picker').hidden = true; $('app').hidden = false;
    var c = CL.filter(function (x) { return x.id === cid; })[0];
    $('hd-name').textContent = c.name;
    $('hd-tag').textContent = isDB(cid) ? '本番DBに接続中' : (cid === 'nakagawa' ? '11月開院予定・見本データ' : '見本データ');
    $('dbline').innerHTML = dbLine();
    $('sw').innerHTML = CL.map(function (x) { return '<button type="button" id="sw-' + x.id + '" style="--c:' + CCOL[x.id] + '" class="' + (x.id === cid ? 'on' : '') + '"><i></i>' + esc(x.short) + '</button>'; }).join('');
    CL.forEach(function (x) { $('sw-' + x.id).addEventListener('click', function () { setClinic(x.id); }); });
    prT = cid === 'nishiharu' ? 'nakagawa' : cid;
    render();
  }

  function setView(v) {
    view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) { s.classList.toggle('on', s.id === 'v-' + v); });
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    if (!cur) return;
    HTc = null;   // DB の値が変わっていることがあるので毎回作り直す
    var w = win(cur);
    $('hd-win').textContent = '集計 ' + md(w.days[0]) + '〜' + md(w.days[ND - 1]) + '（' + ND + '日）' + (isDB(cur) ? '・DBの出庫記録' : cur === 'nakagawa' ? '' : '・見本データ');
    if (view === 'ov') renderOv(); else if (view === 'it') renderIt(); else if (view === 'cp') renderCp(); else renderPr();
  }

  /* ---------- 俯瞰 ---------- */
  function renderOv() {
    var M = metrics(cur), cid = cur;
    var outDaily = zeros();
    if (M.hasHist) meds(cid).forEach(function (m) { var h = hist(cid, m.code); if (h) h.n.forEach(function (v, i) { outDaily[i] += v; }); });
    var cells = [
      { id: 'tk-cost', k: '在庫金額（仕入値）', v: yen(M.cost), s: '原価未設定 ' + M.noCost + '品目は0円で計算', f: 'nocost' },
      { id: 'tk-price', k: '在庫金額（薬価）', v: yen(M.price), s: '薬価との差 ' + (M.price - M.cost >= 0 ? '+' : '') + yen(M.price - M.cost), f: 'all' },
      { id: 'tk-zero', k: '在庫0', v: M.zero + '<small>品目</small>', s: M.hasHist ? 'うち西春で出ている薬 ' + M.zeroUsed : 'うち西春で出ている薬 ' + M.zeroUsed, c: M.zero ? 'bad' : 'zero', f: 'short' },
      { id: 'tk-minus', k: 'マイナス在庫', v: M.minus + '<small>品目</small>', s: M.minItem ? '最大 ' + M.minItem.code + ' ' + num(M.minItem.current_stock) : '—', c: M.minus ? 'bad' : 'zero', f: 'short' },
      { id: 'tk-low', k: '発注点割れ', v: M.low + '<small>品目</small>', s: '在庫0・マイナスを含む', c: M.low ? 'warn' : 'zero', f: 'short' },
      { id: 'tk-neg', k: '逆ザヤ（仕入値＞薬価）', v: M.neg + '<small>品目</small>', s: M.hasHist ? '31日の差損 ' + yen(M.negLoss) : '出庫記録なし', c: M.neg ? 'bad' : 'zero', f: 'neg' },
      { id: 'tk-dead', k: '31日間 出庫0', v: M.hasHist ? M.dead + '<small>品目</small>' : '—', s: M.hasHist ? yen(M.deadVal) + ' が棚に' : '出庫記録なし', c: M.dead ? 'warn' : 'zero', f: 'dead' },
      { id: 'tk-out', k: '出庫 31日', v: M.hasHist ? M.outN + '<small>件</small>' : '—', s: M.hasHist ? spark(outDaily, 120, 16, '#58b9e8') : '記録なし', c: 'ref', f: 'top' }
    ];
    $('tick').innerHTML = cells.map(function (c) {
      return '<button type="button" class="tk ' + (c.c || '') + '" id="' + c.id + '" data-f="' + c.f + '"><span class="k">' + c.k + '<em>›</em></span><span class="v">' + c.v + '</span><span class="s">' + c.s + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#tick .tk'), function (b) {
      b.addEventListener('click', function () { itF = b.getAttribute('data-f'); setView('it'); });
    });

    // 推移
    if (M.hasHist) {
      var w = win(cid);
      $('ov-out-n').textContent = '日別の件数（' + md(w.days[0]) + '〜' + md(w.days[ND - 1]) + '）' + (isDB(cid) ? '・DBの出庫記録（1日×1品目＝1件）' : '');
      $('ov-daily').innerHTML = dailyChart(outDaily, w);
      $('ov-hourly').innerHTML = cid === 'nishiharu' ? hourlyChart() : '<div class="empty">時間帯の記録はありません（DBの出庫記録は日単位）。</div>' + opLog(cid);
    } else {
      $('ov-out-n').textContent = '';
      var msg = cid === 'nakagawa' ? '中川は開院前のため、出庫の記録はまだありません。' : isDB(cid) ? 'テスト用の院のDBには、直近の出庫記録がありません。' : 'テスト用の院は見本データで表示中のため、出庫の記録はありません。';
      $('ov-daily').innerHTML = '<div class="empty"><b>記録なし</b><br>' + msg + '<br>推移は、この院で出庫が記録された分だけを表示します。見本の推移は作りません。</div>';
      $('ov-hourly').innerHTML = opLog(cid);
    }
    // リスク
    var risk = meds(cid).filter(function (m) { return m.handled && !m.stock_untracked && (m.current_stock < m.threshold || m.current_stock <= 0); });
    risk.forEach(function (m) { m._cv = cover(m); m._rk = m.current_stock < 0 ? 0 : (m._cv != null ? 1 : 2); });
    risk.sort(function (a, b) { return a._rk - b._rk || (a._rk === 0 ? a.current_stock - b.current_stock : (a._cv != null ? a._cv - b._cv : (b.threshold - a.threshold))); });
    $('ov-risk-n').textContent = 'マイナス ' + M.minus + '／在庫0 ' + M.zero + '／発注点割れ ' + M.low;
    if (cid === 'nakagawa' && M.cost === 0) {
      $('ov-risk').innerHTML = '<div class="empty"><b>開院前：在庫はまだ入っていません</b><br>西春からコピーした ' + M.items + ' 品目は在庫0です。<br>「開院準備」で、西春の出庫ペースから初期在庫と発注点を提案し、一括で入れられます。<br><br><button type="button" class="btn-sub" id="ov-goprep">開院準備を開く</button></div>';
      $('ov-goprep').addEventListener('click', function () { setView('pr'); });
      return;
    }
    $('ov-risk').innerHTML = '<table class="t risk"><thead><tr><th>状態</th><th>薬品</th><th class="r">在庫</th><th class="r">発注点</th><th class="r">あと</th></tr></thead><tbody>' +
      risk.slice(0, 13).map(function (m) {
        var s = m.current_stock, tag = s < 0 ? '<span class="st minus">マイナス</span>' : s === 0 ? '<span class="st zero">在庫0</span>' : '<span class="st low">発注点割れ</span>';
        var cv = m._cv == null ? '<td class="r dim">出庫なし</td>' : '<td class="r ' + (m._cv <= 3 ? 'bad' : m._cv <= 7 ? 'warn' : '') + '">' + (m._cv <= 0 ? '切れ' : num(Math.floor(m._cv)) + '日') + '</td>';
        return '<tr><td>' + tag + '</td><td class="nm">' + esc(m.name) + '</td><td class="r ' + (s < 0 ? 'bad' : '') + '">' + num(s) + '</td><td class="r dim">' + num(m.threshold) + '</td>' + cv + '</tr>';
      }).join('') + (risk.length ? '' : '<tr><td colspan="5" class="dim" style="padding:14px 10px">切れそうな薬・切れた薬はありません。</td></tr>') + '</tbody></table>' +
      (risk.length > 13 ? '<div class="empty" style="padding:6px 10px">ほか ' + (risk.length - 13) + ' 品目 ─ 「品目の動き › 欠品・発注点割れ」で全件</div>' : '') +
      '<div class="empty" style="padding:4px 10px 8px">「あと」＝在庫 ÷ ' + (isDB(cid) ? 'テスト用の院の1日平均出庫（DBの記録）' : '西春の1日平均出庫') + '。マイナス・3日以内は赤。</div>';
  }
  /* 開院準備の投入記録（テスト用＝DBの在庫の動きから） */
  function opLog(cid) {
    if (!(cid === 'test' && isDB('test'))) return '';
    var cpu = {}; meds('test').forEach(function (m) { cpu[m.code] = m.cost_per_unit || 0; });
    var by = {}, keys = [];
    SB.moves('test').forEach(function (l) {
      if (l.reason !== '開院準備の初期在庫' || l.voided_at || l.kind !== 'in') return;
      var d = new Date(l.created_at), k = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '（' + (l.operator || '—') + '）';
      if (!by[k]) { by[k] = { n: 0, v: 0 }; keys.push(k); } by[k].n++; by[k].v += (Number(l.qty) || 0) * (cpu[l.medicine_code] || 0);
    });
    if (!keys.length) return '<div class="empty">開院準備の投入記録（DB）：まだありません。</div>';
    return '<div class="empty">開院準備の投入記録（DB）：<br>' + keys.slice(0, 6).map(function (k) { return '<span class="mono">' + esc(k) + '</span>　初期在庫を投入 ' + by[k].n + '品目・' + yen(by[k].v); }).join('<br>') + '</div>';
  }
  function dailyChart(arr, w) {
    w = w || { days: DAYS, ix: DIX };
    var DAYS_ = w.days, DIX_ = w.ix;
    var W = 540, H = 150, top = 22, bot = 20, ch = H - top - bot, bw = W / ND, mx = Math.max.apply(null, arr) || 1, s = '';
    var order = arr.map(function (v, i) { return [v, i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 3).map(function (x) { return x[1]; });
    arr.forEach(function (v, i) {
      var h = v / mx * ch, x = i * bw, off = isOff(DAYS_[i]);
      if (v) s += '<rect x="' + (x + 1).toFixed(1) + '" y="' + (top + ch - h).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (off ? '#58b9e8' : '#56606b') + '"/>';
      if (order.indexOf(i) >= 0) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (top + ch - h - 4).toFixed(1) + '" fill="#e4e8ed" font-size="10.5" text-anchor="middle">' + v + '</text>';
      var d = DAYS_[i];
      if (i === 0 || /-01$|-08$|-15$|-22$/.test(d)) s += '<text x="' + (i === 0 ? 1 : (x + bw / 2)).toFixed(1) + '" y="' + (H - 5) + '" fill="#8a939e" font-size="10" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + md(d) + '</text>';
    });
    // 連休の注記（直接ラベル）
    var a = DIX_['2026-09-19'], b = DIX_['2026-09-23'];
    if (DAYS_ !== DAYS) a = b = null;   // 連休の注記は西春（見本）の推移だけ
    if (a != null && b != null) {
      var sum = 0; for (var i = a; i <= b; i++) sum += arr[i];
      var x1 = a * bw + 1, x2 = (b + 1) * bw - 1;
      s += '<line x1="' + x1 + '" y1="9" x2="' + x2 + '" y2="9" stroke="#58b9e8"/><text class="jp" x="' + (x1 - 4) + '" y="12" fill="#58b9e8" font-size="10.5" text-anchor="end">連休 9/19〜23 で ' + sum + '件</text>';
    }
    s += '<text class="jp" x="2" y="12" fill="#8a939e" font-size="10.5">水色＝土日祝</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="日別の出庫件数">' + s + '</svg>';
  }
  function hourlyChart() {
    var hr = zeros().slice(0, 24).map(function () { return 0; });
    for (var k = 0; k < 24; k++) hr[k] = 0;
    D.hourly_out_nishiharu.forEach(function (r) { hr[+r.h] = +r.n; });
    var tot = hr.reduce(function (a, b) { return a + b; }, 0), night = 0, day = 0;
    for (var h = 19; h <= 23; h++) night += hr[h];
    for (h = 10; h <= 14; h++) day += hr[h];
    var W = 540, H = 120, top = 26, bot = 18, ch = H - top - bot, bw = W / 24, mx = Math.max.apply(null, hr) || 1, s = '';
    hr.forEach(function (v, i) {
      var hh = v / mx * ch, x = i * bw, nt = i >= 19;
      if (v) s += '<rect x="' + (x + 2).toFixed(1) + '" y="' + (top + ch - hh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + (nt ? '#58b9e8' : '#56606b') + '"/>';
      if (i % 3 === 0) s += '<text x="' + (i === 0 ? 1 : (x + bw / 2)).toFixed(1) + '" y="' + (H - 4) + '" fill="#8a939e" font-size="10" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + i + '時</text>';
    });
    function br(a, b, label, col) {
      var x1 = a * bw + 2, x2 = (b + 1) * bw - 2;
      s += '<line x1="' + x1 + '" y1="14" x2="' + x2 + '" y2="14" stroke="' + col + '"/><text class="jp" x="' + ((x1 + x2) / 2) + '" y="10" fill="' + col + '" font-size="10.5" text-anchor="middle">' + label + '</text>';
    }
    br(10, 14, '10〜14時 ' + Math.round(day / tot * 100) + '%', '#a9b2bc');
    br(19, 23, '夜間 19〜23時 ' + Math.round(night / tot * 100) + '%', '#58b9e8');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="時間帯別の出庫件数">' + s + '</svg>';
  }

  /* ---------- 品目の動き ---------- */
  function renderIt() {
    Array.prototype.forEach.call(document.querySelectorAll('#it-f button'), function (b) { b.classList.toggle('on', b.getAttribute('data-f') === itF); });
    var cid = cur, hh = hasHist(cid), q = $('it-q').value;
    var list = meds(cid).filter(function (m) { return m.handled; });
    list.forEach(function (m) { m._h = hist(cid, m.code); m._cv = cover(m); m._val = (m.current_stock || 0) * (m.cost_per_unit || 0); });
    var ins = '', rows;
    var totN = list.reduce(function (a, m) { return a + (m._h ? m._h.sn : 0); }, 0);
    if (itF === 'top') {
      rows = list.filter(function (m) { return m._h; }).sort(function (a, b) { return b._h.sn - a._h.sn; });
      if (!hh) ins = noHist(cid);
      else {
        var c12 = rows.slice(0, 12).reduce(function (a, m) { return a + m._h.sn; }, 0);
        var cols = ['#58b9e8', '#4ea6d2', '#4594bd', '#3d83a8', '#367494', '#306681'];
        ins = '<span class="big ref">' + Math.round(c12 / totN * 100) + '%</span><span>上位12品目で出庫件数の ' + Math.round(c12 / totN * 100) + '%（' + totN + '件中 ' + c12 + '件）。出ているのは ' + rows.length + ' / ' + list.length + ' 品目。</span>' +
          '<div class="pareto">' + rows.slice(0, 12).map(function (m, i) { var p = m._h.sn / totN * 100; return '<span style="width:' + p + '%;background:' + cols[Math.min(i, 5)] + '" title="' + esc(m.name) + '">' + (p > 6 ? esc(short(m.name)) + ' ' + Math.round(p) + '%' : '') + '</span>'; }).join('') +
          '<span style="flex:1;background:#2a3038;color:#8a939e">残り ' + (rows.length - 12) + '品目</span></div>';
      }
    } else if (itF === 'dead') {
      rows = hh ? list.filter(function (m) { return !m._h && m.current_stock > 0; }).sort(function (a, b) { return b._val - a._val; }) : [];
      if (!hh) ins = noHist(cid);
      else {
        var dv = rows.reduce(function (a, m) { return a + m._val; }, 0), ext = rows.filter(function (m) { return m.stock_untracked; }).length;
        ins = '<span class="big warn">' + yen(dv) + '</span><span>31日間いちども出ていない ' + rows.length + ' 品目の在庫金額（うち外用 ' + ext + '）。棚の整理と、中川で「扱わない」にする候補です。</span>';
      }
    } else if (itF === 'neg') {
      rows = list.filter(function (m) { return (m.margin_rate_pct || 0) < 0; }).sort(function (a, b) { return a.margin_rate_pct - b.margin_rate_pct; });
      var loss = rows.reduce(function (a, m) { return a + (m._h ? m._h.sq * ((m.price || 0) - (m.cost_per_unit || 0)) : 0); }, 0);
      var nc = list.filter(function (m) { return m.cost_per_unit == null; }).length;
      ins = '<span class="big bad">' + rows.length + '品目</span><span>' + rows.map(function (m) { return esc(short(m.name)) + '：仕入 ' + up(m.cost_per_unit) + '円 ＞ 薬価 ' + up(m.price) + '円（1' + esc(m.unit) + 'ごとに ' + up((m.price || 0) - (m.cost_per_unit || 0)) + '円）'; }).join('<br>') + '</span>' +
        (hh ? '<span>31日の差損 <b class="mono bad" style="color:var(--bad)">' + yen(loss) + '</b></span>' : '') +
        '<span class="note">原価未設定の ' + nc + ' 品目は判定できません（仕入値を入れると増える可能性があります）。</span>';
    } else if (itF === 'short') {
      rows = list.filter(function (m) { return !m.stock_untracked && (m.current_stock < m.threshold || m.current_stock <= 0); }).sort(function (a, b) { return a.current_stock - b.current_stock; });
      ins = '<span class="big bad">' + rows.filter(function (m) { return m.current_stock < 0; }).length + '</span><span>マイナス</span><span class="big bad">' + rows.filter(function (m) { return m.current_stock === 0; }).length + '</span><span>在庫0</span><span class="big warn">' + rows.length + '</span><span>発注点割れ（合計）</span><span class="note">マイナス＝記録上の在庫より多く出ている。入庫の記録漏れか数え違いの可能性。</span>';
    } else if (itF === 'nocost') {
      rows = list.filter(function (m) { return m.cost_per_unit == null; });
      ins = '<span class="big warn">' + rows.length + '品目</span><span>仕入値が未設定。在庫金額は0円で計算され、逆ザヤの判定もできません。</span>';
    } else {
      rows = list.slice().sort(function (a, b) { return b._val - a._val; });
      ins = '<span class="big">' + list.length + '品目</span><span>在庫金額の大きい順</span>';
    }
    if (q) rows = KS.filter(rows, q, function (m) { return [m.name, m.furigana, m.code, m.category]; });
    $('it-ins').innerHTML = ins;
    $('it-t').innerHTML = '<thead><tr><th>コード</th><th>薬品名</th><th>31日の出庫</th><th class="r">件数</th><th class="r">数量</th><th class="r">在庫</th><th class="r">あと</th><th class="r">仕入単価</th><th class="r">薬価</th><th class="r">在庫金額</th><th class="r">粗利率</th></tr></thead><tbody>' +
      rows.map(function (m) {
        var h = m._h, mr = m.margin_rate_pct;
        return '<tr><td class="cd">' + m.code + '</td><td class="nm">' + esc(m.name) + tagOf(m) + '</td><td>' + spark(h ? h.q : null, 96, 16, '#58b9e8') + '</td>' +
          '<td class="r">' + (h ? h.sn : '<span class="dim">0</span>') + '</td><td class="r">' + (h ? num(h.sq) : '<span class="dim">0</span>') + '</td>' +
          '<td class="r ' + (!m.stock_untracked && m.current_stock < 0 ? 'bad' : '') + '">' + stockTxt(m) + '</td>' +
          '<td class="r ' + (m._cv != null && m._cv <= 3 ? 'bad' : m._cv != null && m._cv <= 7 ? 'warn' : 'dim') + '">' + (m.stock_untracked ? '' : m._cv == null ? '—' : m._cv <= 0 ? '切れ' : Math.floor(m._cv) + '日') + '</td>' +
          '<td class="r">' + (m.cost_per_unit == null ? '<span class="warn">未設定</span>' : up(m.cost_per_unit)) + '</td><td class="r">' + up(m.price) + '</td>' +
          '<td class="r">' + yen(m._val) + '</td><td class="r ' + (mr < 0 ? 'bad' : 'dim') + '">' + (mr == null ? '—' : num(mr) + '%') + '</td></tr>';
      }).join('') + '</tbody>';
    if (!rows.length) $('it-t').innerHTML += '<tbody><tr><td colspan="11" class="dim" style="padding:14px">該当する品目はありません。</td></tr></tbody>';
  }
  function noHist(cid) {
    return '<span class="big" style="color:var(--dim)">記録なし</span><span>' + CNAME[cid] + 'には出庫の記録がありません。よく出る薬・動いていない薬は、出庫が記録された院（西春）で見られます。</span>';
  }
  function short(n) { return String(n).replace(/[　\s].*$/, ''); }

  /* ---------- 院の並べ比べ ---------- */
  function renderCp() {
    var Ms = {}; CIDS.forEach(function (c) { Ms[c] = metrics(c); });
    var mxC = Math.max.apply(null, CIDS.map(function (c) { return Ms[c].cost; })) || 1;
    var mxP = Math.max.apply(null, CIDS.map(function (c) { return Ms[c].price; })) || 1;
    function head() { return '<thead><tr><th><span class="dim" style="font-weight:400">西春・中川＝見本データ／テスト用＝' + (isDB('test') ? '本番DBの値' : '見本データ（DB未接続）') + '</span></th>' + CIDS.map(function (c) { return '<th class="cl r" style="--c:' + CCOL[c] + '">' + CNAME[c] + '<small class="src">' + (isDB(c) ? 'DB' : '見本') + '</small>' + (c === cur ? ' ◀ 表示中' : '') + '</th>'; }).join('') + '</tr></thead>'; }
    function barCell(c, v, mx, txt) { return '<td class="r"><div class="cell-bar" style="--c:' + CCOL[c] + '"><span class="b"><i style="width:' + Math.max(0, v / mx * 100) + '%"></i></span><span class="v">' + txt + '</span></div></td>'; }
    function row(k, fn, cls) { return '<tr><td class="k">' + k + '</td>' + CIDS.map(function (c) { var r = fn(c, Ms[c]); return typeof r === 'string' && r.indexOf('<td') === 0 ? r : '<td class="r ' + (cls ? cls(Ms[c]) : '') + '">' + r + '</td>'; }).join('') + '</tr>'; }
    var prog = function (c) {
      if (c === 'nishiharu') return '<span class="dim">稼働中</span>';
      var p = prepProg(c); return p.stocked + ' / ' + p.tracked + ' 品目に在庫';
    };
    $('cp-t').innerHTML = head() + '<tbody>' +
      '<tr class="sec"><td colspan="4">お金</td></tr>' +
      row('在庫金額（仕入値）', function (c, M) { return barCell(c, M.cost, mxC, yen(M.cost)); }) +
      row('在庫金額（薬価）', function (c, M) { return barCell(c, M.price, mxP, yen(M.price)); }) +
      row('逆ザヤの品目', function (c, M) { return M.neg; }, function (M) { return M.neg ? 'bad' : 'dim'; }) +
      row('原価未設定の品目', function (c, M) { return M.noCost; }, function (M) { return M.noCost ? 'warn' : 'dim'; }) +
      '<tr class="sec"><td colspan="4">欠品のリスク</td></tr>' +
      row('在庫0', function (c, M) { return M.zero; }, function (M) { return M.zero ? 'bad' : 'dim'; }) +
      row('マイナス在庫', function (c, M) { return M.minus; }, function (M) { return M.minus ? 'bad' : 'dim'; }) +
      row('発注点割れ', function (c, M) { return M.low; }, function (M) { return M.low ? 'warn' : 'dim'; }) +
      '<tr class="sec"><td colspan="4">動き・準備</td></tr>' +
      row('扱う品目', function (c, M) { return M.items + ' / ' + meds(c).length; }) +
      row('31日の出庫', function (c, M) { return M.hasHist ? M.outN + ' 件' : '<span class="dim">記録なし</span>'; }) +
      row('31日間 出庫0', function (c, M) { return M.hasHist ? M.dead + '品目・' + yen(M.deadVal) : '<span class="dim">—</span>'; }) +
      row('開院準備', prog) + '</tbody>';

    var top = Object.keys(HN).sort(function (a, b) { return HN[b].sn - HN[a].sn; }).slice(0, 15);
    var mm = {}; CIDS.forEach(function (c) { mm[c] = {}; meds(c).forEach(function (m) { mm[c][m.code] = m; }); });
    $('cp-m').innerHTML = '<thead><tr><th>薬品（西春の出庫件数順）</th><th class="r">西春 1日平均</th>' + CIDS.map(function (c) { return '<th class="cl r" style="--c:' + CCOL[c] + '">' + CNAME[c] + '<small class="src">' + (isDB(c) ? 'DB' : '見本') + '</small></th>'; }).join('') + '</tr></thead><tbody>' +
      top.map(function (code) {
        var b = mm.nishiharu[code], a = avgDay(code);
        if (!b) return '';
        return '<tr><td class="nm">' + esc(b.name) + tagOf(b) + '</td><td class="r dim">' + num(a) + ' ' + esc(b.unit) + '</td>' + CIDS.map(function (c) {
          var m = mm[c][code];
          if (!m) return '<td class="r dim">—</td>';
          if (!m.handled) return '<td class="r dim">扱わない</td>';
          if (m.stock_untracked) return '<td class="r ref">外用</td>';
          var s = m.current_stock || 0, dd = a ? s / a : 0, w = Math.max(0, Math.min(1, dd / 14)) * 100;
          return '<td class="r"><div class="cell-bar" style="--c:' + CCOL[c] + '"><span class="b"><i class="' + (s < 0 ? 'neg' : '') + '" style="width:' + (s < 0 ? 100 : w) + '%"></i></span><span class="v ' + (s < 0 ? 'bad' : s === 0 ? 'dim' : '') + '" style="' + (s < 0 ? 'color:var(--bad)' : '') + '">' + num(s) + '</span><span class="v dim" style="min-width:40px;color:var(--dim2)">' + (a ? (dd <= 0 ? '0日' : Math.floor(dd) + '日') : '') + '</span></div></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  /* ---------- 開院準備 ---------- */
  function propose(m) {
    var a = avgDay(m.code);
    if (m.stock_untracked || !a) return { a: a, init: 0, thr: null };
    var base = a * prD * prR / 100, pk = m.pack_size || 1, step;
    if (pk > 1 && pk <= base) step = pk; else step = base >= 50 ? 10 : base >= 10 ? 5 : 1;
    return { a: a, init: Math.ceil(base / step) * step, thr: Math.ceil(a * 7 * prR / 100) };
  }
  function sel(t) {
    if (!SEL[t]) {
      var s = st(t), any = Object.keys(s.dec).length > 0; SEL[t] = {};
      D.medicines[t].forEach(function (m) { SEL[t][m.code] = any ? !s.off[m.code] : !!HN[m.code]; });
    }
    return SEL[t];
  }
  function prepProg(t) {
    var s = st(t), list = meds(t), tracked = list.filter(function (m) { return m.handled && !m.stock_untracked; });
    return {
      copied: list.length, decided: Object.keys(s.dec).length, tracked: tracked.length,
      stocked: tracked.filter(function (m) { return m.current_stock > 0; }).length,
      thrSet: Object.keys(s.set).length, value: list.reduce(function (a, m) { return a + (m.handled ? (m.current_stock || 0) * (m.cost_per_unit || 0) : 0); }, 0)
    };
  }
  function plan(t) {
    var S = sel(t), rows = [];
    meds(t).forEach(function (m) {
      var p = propose(m), on = !!S[m.code], cs = m.current_stock || 0;
      var add = on && p.init > cs ? p.init - cs : 0;
      rows.push({ m: m, p: p, on: on, add: add, val: add * (m.cost_per_unit || 0) });
    });
    rows.sort(function (a, b) { return (HN[b.m.code] ? HN[b.m.code].sn : 0) - (HN[a.m.code] ? HN[a.m.code].sn : 0) || (a.m.code < b.m.code ? -1 : 1); });
    return rows;
  }
  function renderPr(flash) {
    var t = prT;
    [['pr-target', 'data-t', t], ['pr-days', 'data-d', String(prD)], ['pr-ratio', 'data-r', String(prR)]].forEach(function (x) {
      Array.prototype.forEach.call(document.querySelectorAll('#' + x[0] + ' button'), function (b) { b.classList.toggle('on', b.getAttribute(x[1]) === x[2]); });
    });
    var P = prepProg(t);
    function step(k, v, of, sub) { return '<div class="step"><div class="k">' + k + '</div><div class="v">' + v + (of != null ? '<small> / ' + of + '</small>' : '') + '</div><div class="m"><i style="width:' + (of ? Math.min(100, v / of * 100) : 100) + '%"></i></div>' + (sub ? '<div class="k">' + sub + '</div>' : '') + '</div>'; }
    $('pr-prog').style.setProperty('--c', CCOL[t]);
    $('pr-prog').innerHTML = '<h3><i></i>' + CNAME[t] + ' の開院準備' + (t === 'test' ? '（練習用）' : '') + '</h3><div class="steps">' +
      step('① 品目のコピー', P.copied, null, '西春から（品目数）') +
      step('② 扱う／扱わない', P.decided, P.copied, '決めた品目') +
      step('③ 初期在庫', P.stocked, P.tracked, '在庫が入った品目') +
      step('④ 発注点', P.thrSet, P.tracked, '西春ペースで設定') +
      '</div><div class="foot">いまの在庫金額（仕入値） <b class="mono" style="color:var(--tx)">' + yen(P.value) + '</b>　／　' +
      (t === 'test' ? (isDB('test') ? 'テスト用は本番DBの在庫（西春の写しから開始）に、足りない分だけ補充します。' : 'テスト用はDBに接続できないため見本で表示しています（投入はできません）。') : '<b>中川は開院前のため見本で表示</b>（在庫0から開始・投入はできません）。') + '</div>';

    var rows = plan(t), q = $('pr-q').value;
    var on = rows.filter(function (r) { return r.on; }), adds = on.filter(function (r) { return r.add > 0; });
    var totV = adds.reduce(function (a, r) { return a + r.val; }, 0), thrN = on.filter(function (r) { return r.p.thr != null; }).length;
    $('pr-sum').innerHTML =
      '<span class="it">扱う<b>' + on.length + ' <small style="font-size:11px;color:var(--dim)">/ ' + rows.length + '</small></b></span>' +
      '<span class="it">在庫を入れる<b>' + adds.length + ' 品目</b></span>' +
      '<span class="it">発注点を設定<b>' + thrN + ' 品目</b></span>' +
      '<span class="it">入れる金額（仕入値・原価未設定は除く）<b>' + yen(totV) + '</b></span>' +
      '<button type="button" class="btn-go' + (SB && SB.canWrite(t) ? '' : ' ro') + '" id="pr-apply">' + (SB && SB.canWrite(t) ? CNAME[t] + ' に一括で入れる（DB）' : CNAME[t] + ' には入れられません（見本）') + '</button>';
    $('pr-apply').addEventListener('click', function () { confirmBox(t, on.length, adds.length, thrN, totV); });
    if (q) rows = rows.filter(function (r) { return KS.match(q, [r.m.name, r.m.furigana, r.m.code, r.m.category]); });
    $('pr-t').innerHTML = '<thead><tr><th>扱う</th><th>薬品</th><th>西春 31日の出庫</th><th class="r">1日平均</th><th class="r">提案 初期在庫</th><th class="r">提案 発注点</th><th class="r">' + CNAME[t] + ' 在庫</th><th class="r">追加</th><th class="r">金額</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var m = r.m, p = r.p, h = HN[m.code];
        return '<tr class="' + (r.on ? '' : 'off') + (flash && flash[m.code] ? ' hi' : '') + '" id="pr-row-' + m.code + '"><td><button type="button" class="tg ' + (r.on ? 'on' : '') + '" data-c="' + m.code + '">' + (r.on ? '扱う' : '扱わない') + '</button></td>' +
          '<td class="nm">' + esc(m.name) + tagOf(m) + '</td><td>' + spark(h ? h.q : null, 90, 16, '#8a939e') + '</td>' +
          '<td class="r ' + (p.a ? '' : 'dim') + '">' + (p.a ? num(p.a) : '0') + '</td>' +
          '<td class="r">' + (m.stock_untracked ? '<span class="ref">外用</span>' : p.a ? num(p.init) : '<span class="dim">実績なし</span>') + '</td>' +
          '<td class="r">' + (p.thr != null ? num(p.thr) : '<span class="dim">—</span>') + '</td>' +
          '<td class="r ' + (m.current_stock < 0 ? 'bad' : '') + '">' + (m.stock_untracked ? '<span class="ref">外用</span>' : num(m.current_stock)) + '</td>' +
          '<td class="r add">' + (r.add ? '+' + num(r.add) : '') + '</td><td class="r">' + (r.add ? (m.cost_per_unit == null ? '<span class="warn">原価未設定</span>' : yen(r.val)) : '') + '</td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call(document.querySelectorAll('#pr-t .tg'), function (b) {
      b.addEventListener('click', function () { var S = sel(t), c = b.getAttribute('data-c'); S[c] = !S[c]; $('pr-confirm').hidden = true; renderPr(); });
    });
  }
  function confirmBox(t, nOn, nAdd, nThr, v) {
    var box = $('pr-confirm');
    if (!(SB && SB.canWrite(t))) { roBox(box, t); return; }   // 中川・DB未接続では投入しない
    box.className = 'pr-confirm'; box.hidden = false;
    box.innerHTML = '<div class="msg"><b>' + CNAME[t] + '</b> に、扱う <b>' + nOn + '</b> 品目を確定し、<b>' + nAdd + '</b> 品目へ初期在庫（計 <b>' + yen(v) + '</b>）を入れ、<b>' + nThr + '</b> 品目の発注点を西春の1週間分に設定します。' +
      '<br><b>テスト用の院の本番DBに書き込みます</b>（在庫の動きとして記録・西春・中川には影響しません）。「扱う／扱わない」はこの画面の中だけの区別で、DBには書きません。</div>' +
      '<button type="button" class="btn-sub" id="pr-cancel">やめる</button><button type="button" class="btn-go" id="pr-go">入れる</button>';
    $('pr-cancel').addEventListener('click', function () { box.hidden = true; });
    $('pr-go').addEventListener('click', function () { apply(t); });
  }
  function busy(on, label) {
    BUSY = on;
    ['pr-apply', 'pr-go', 'pr-cancel', 'pr-undo', 'reset'].forEach(function (id) { var b = $(id); if (b) b.disabled = on; });
    if (on && label) { var g = $('pr-go') || $('pr-undo'); if (g) g.textContent = label; }
  }
  function errBox(box, head, e) {
    box.hidden = false; box.className = 'pr-confirm ro';
    box.innerHTML = '<div class="msg"><b>' + esc(head) + '</b>　' + esc(e && e.message || e) + '</div><button type="button" class="btn-sub" id="pr-errx">閉じる</button>';
    $('pr-errx').addEventListener('click', function () { box.hidden = true; });
  }
  /* テスト用へ一括投入：在庫は SB.apply でまとめて1回、発注点は SB.upsertMedicine（code 指定＝既存品目の更新） */
  async function apply(t) {
    var box = $('pr-confirm');
    if (BUSY) return;
    if (!(SB && SB.canWrite(t))) { roBox(box, t); return; }
    var s = st(t), rows = plan(t), on = rows.filter(function (r) { return r.on; });
    var note = '西春の出庫ペースの' + prD + '日分×' + prR + '%（院長の見取り図）';
    var items = on.filter(function (r) { return r.add > 0; }).map(function (r) { return { code: r.m.code, kind: 'in', delta: r.add, reason: '開院準備の初期在庫', note: note }; });
    var thrs = on.filter(function (r) { return r.p.thr != null && Number(r.m.threshold) !== r.p.thr; }).map(function (r) { return { code: r.m.code, thr: r.p.thr, old: Number(r.m.threshold) || 0 }; });
    var thrN = on.filter(function (r) { return r.p.thr != null; }).length;
    var vals = {}; on.forEach(function (r) { vals[r.m.code] = r.val; });
    busy(true, '在庫を送信中…');
    var res = [];
    try { if (items.length) res = await SB.apply(t, items, OP, SRC); }
    catch (e) { busy(false); errBox(box, '入れられませんでした（在庫の数字は変えていません）', e); return; }
    var okThr = [], thrErr = null, k = 0;
    async function worker() {
      while (k < thrs.length && !thrErr) {
        var x = thrs[k++];
        try { await SB.upsertMedicine(t, { code: x.code, threshold: x.thr }, OP, SRC); okThr.push(x); }
        catch (e) { thrErr = x.code + '：' + e.message; }
        var g = $('pr-go'); if (g) g.textContent = '発注点を送信中… ' + okThr.length + '/' + thrs.length;
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    try { await SB.refresh(t); } catch (e) {}
    rows.forEach(function (r) { var c = r.m.code; s.dec[c] = 1; if (!r.on) s.off[c] = true; else { delete s.off[c]; if (r.p.thr != null) s.set[c] = 1; } });
    var fl = {}, addV = 0; res.forEach(function (r) { fl[r.code] = 1; addV += vals[r.code] || 0; });
    LAST = { tx: res.map(function (r) { return r.tx_id; }), thr: okThr };
    busy(false);
    var after = prepProg(t).value;
    renderPr(fl);
    box.hidden = false; box.className = 'pr-confirm done';
    var ex = res.slice(0, 3).map(function (r) { return r.code + ' ' + num(r.before) + '→' + num(r.after); }).join('、');
    box.innerHTML = '<div class="msg">' + CNAME[t] + ' のDBに入れました：初期在庫 <b>' + res.length + '</b> 品目（補充 <b>+' + yen(addV) + '</b>' + (ex ? '・例 ' + esc(ex) : '') + '）・発注点 <b>' + thrN + '</b> 品目（うち値を変えた <b>' + okThr.length + '</b> 品目）。' +
      '<br>扱う品目の在庫金額（仕入値）はいま <b>' + yen(after) + '</b> です。' +
      (thrErr ? '<br><b style="color:var(--bad)">発注点の一部が保存できませんでした：</b>' + esc(thrErr) : '') + '</div>' +
      '<button type="button" class="btn-sub" id="pr-undo">この投入を取り消す</button><button type="button" class="btn-sub" id="pr-see">並べ比べで見る</button>';
    $('pr-see').addEventListener('click', function () { setView('cp'); });
    $('pr-undo').addEventListener('click', function () { undo(t); });
  }
  /* 直前の投入を取り消す（在庫は SB.voidTx、発注点は元の値へ） */
  var LAST = null;
  async function undo(t) {
    var box = $('pr-confirm');
    if (BUSY || !LAST) return;
    busy(true, '取り消し中…');
    try {
      var r = LAST.tx.length ? await SB.voidTx(t, LAST.tx, OP) : [];
      for (var i = 0; i < LAST.thr.length; i++) await SB.upsertMedicine(t, { code: LAST.thr[i].code, threshold: LAST.thr[i].old }, OP, SRC);
      await SB.refresh(t);
      var n = LAST.thr.length; LAST = null; busy(false); renderPr();
      box.hidden = false; box.className = 'pr-confirm done';
      box.innerHTML = '<div class="msg">取り消しました：在庫 <b>' + r.length + '</b> 品目を元に戻し' + (r[0] ? '（例 ' + esc(r[0].code + ' ' + num(r[0].before) + '→' + num(r[0].after)) + '）' : '') + '、発注点 <b>' + n + '</b> 品目を元の値にしました。</div>';
    } catch (e) { busy(false); errBox(box, '取り消しに失敗しました', e); }
  }

  /* ---------- 初期化・イベント ---------- */
  // デモの初期化：2段階（1回目で確認の表示、5秒以内にもう一度押すと実行）。テスト用の院は SB.resetTest()
  var rsArm = false, rsT = null;
  function rsIdle() { var b = $('reset'); rsArm = false; b.textContent = 'デモの初期化'; b.classList.remove('arm'); }
  async function resetDemo() {
    var b = $('reset');
    if (BUSY) return;
    if (!rsArm) {
      rsArm = true; b.classList.add('arm');
      b.textContent = SB && SB.live ? 'もう一度押すと初期化します（テスト用の院のDBを初期状態へ）' : 'もう一度押すと初期化します';
      clearTimeout(rsT); rsT = setTimeout(rsIdle, 5000); return;
    }
    clearTimeout(rsT); rsIdle();
    if (SB && SB.live) {
      busy(true); b.textContent = '初期化中…';
      try { await SB.resetTest(); }
      catch (e) { busy(false); b.textContent = 'デモの初期化'; $('dbline').innerHTML = '<b style="color:var(--bad)">初期化できませんでした：</b>' + esc(e.message); return; }
      busy(false); b.textContent = 'デモの初期化';
    }
    ST = {}; SEL = {}; LAST = null; cur = null; view = 'ov'; itF = 'top'; prT = 'nakagawa'; prD = 21; prR = 75;
    $('it-q').value = ''; $('pr-q').value = ''; $('pr-confirm').hidden = true;
    setView('ov'); showPicker();
  }
  window.P9D = { reset: resetDemo };

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-v')); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#it-f button'), function (b) { b.addEventListener('click', function () { itF = b.getAttribute('data-f'); renderIt(); }); });
    $('it-q').addEventListener('input', renderIt);
    $('pr-q').addEventListener('input', function () { renderPr(); });
    Array.prototype.forEach.call(document.querySelectorAll('#pr-target button'), function (b) { b.addEventListener('click', function () { prT = b.getAttribute('data-t'); $('pr-confirm').hidden = true; renderPr(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#pr-days button'), function (b) { b.addEventListener('click', function () { prD = +b.getAttribute('data-d'); $('pr-confirm').hidden = true; renderPr(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('#pr-ratio button'), function (b) { b.addEventListener('click', function () { prR = +b.getAttribute('data-r'); $('pr-confirm').hidden = true; renderPr(); }); });
    $('pb-used').addEventListener('click', function () { var S = sel(prT); Object.keys(S).forEach(function (c) { S[c] = !!HN[c]; }); $('pr-confirm').hidden = true; renderPr(); });
    $('pb-all').addEventListener('click', function () { var S = sel(prT); Object.keys(S).forEach(function (c) { S[c] = true; }); $('pr-confirm').hidden = true; renderPr(); });
    $('reset').addEventListener('click', resetDemo);
    (async function () {
      $('picker').hidden = false; $('pk-db').textContent = '';
      $('pk-list').innerHTML = '<div class="pk-wait">接続中…（テスト用の院の在庫を本番DBから読み込んでいます）</div>';
      if (SB) { try { await SB.ready; } catch (e) {} }
      var c = ls('clinic');
      if (c && CIDS.indexOf(c) >= 0) setClinic(c); else showPicker();
    })();
  });
})();
