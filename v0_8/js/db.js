/* =========================================================
   v0.8 db.js ― Supabase REST / GAS アダプタ / オフラインキュー
   書き込みは必ず結果を確認してから成功扱いにする（送りっぱなし禁止）
   ========================================================= */
(function () {
  'use strict';
  window.P8 = window.P8 || {};

  var SB_URL = 'https://vypwgxkqtxuzqfaaeamf.supabase.co';
  var SB_KEY = 'sb_publishable_WVbE1jJE6sBDli7qO-xSJA_GqDqu4OE';
  var SB_HEADERS = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

  var GAS_URL = 'https://script.google.com/macros/s/AKfycby1zgHFyfsxTyqXTf-UXhu25ef5Hhp2ZvSkQ9ETYzCJIJumoYiKkuQl2IclDHpfrfuJ9w/exec';
  var GAS_TOKEN = 'dtp_f929bbd860e2e96224ded613cd06177e';
  var KARTE_API_URL = 'https://script.google.com/macros/s/AKfycbwWCL1aVy4RcCZsr2Wzrpy5JE8LU8pGWa2u_CY7qo7OGMgXrB0OZGir6rGJZiiV6hRd/exec';

  function raw(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, SB_HEADERS, opts.headers || {});
    return fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers }));
  }

  // 読み取り: 失敗は null（呼び出し側がキャッシュ等で代替する）
  async function get(path) {
    try {
      var res = await raw(path);
      if (!res.ok) { console.warn('SB GET ' + res.status + ': ' + path); return null; }
      var t = await res.text();
      return t ? JSON.parse(t) : null;
    } catch (e) { console.warn('SB GET error:', e.message); return null; }
  }

  // 書き込み: Prefer return=representation で結果を必ず受け取る。失敗は throw。
  async function write(path, method, body, headers) {
    var res = await raw(path, {
      method: method,
      headers: Object.assign({ Prefer: 'return=representation' }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error('DB書き込みに失敗 (' + res.status + ')');
      err.status = res.status; err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  // RPC 呼び出し。失敗は throw。
  async function rpc(name, args) {
    var res = await raw('rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error('RPC ' + name + ' に失敗 (' + res.status + ')');
      err.status = res.status; err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  // 件数だけ取る（Content-Range利用）
  async function count(path) {
    try {
      var res = await raw(path + (path.indexOf('?') >= 0 ? '&' : '?') + 'limit=1', {
        method: 'HEAD', headers: { Prefer: 'count=exact' }
      });
      if (!res.ok) return null;
      var cr = res.headers.get('content-range');
      if (!cr) return null;
      var n = parseInt(cr.split('/')[1], 10);
      return isNaN(n) ? null : n;
    } catch (e) { return null; }
  }

  // ---- GAS（維持するのは recordPrescription と カルテ突合の読み取りのみ） ----
  async function gasGet(action, params) {
    try {
      var url = new URL(GAS_URL);
      url.searchParams.append('action', action);
      url.searchParams.append('token', GAS_TOKEN);
      Object.entries(params || {}).forEach(function (kv) { url.searchParams.append(kv[0], String(kv[1])); });
      url.searchParams.append('_t', Date.now() + '_' + Math.random().toString(36).slice(2));
      var res = await fetch(url.toString(), { cache: 'no-store' });
      return await res.json();
    } catch (e) { console.warn('GAS GET error:', e.message); return null; }
  }

  async function karteFetch(params) {
    var url = KARTE_API_URL + '?token=' + encodeURIComponent(GAS_TOKEN) + '&' + params;
    var res = await fetch(url);
    return await res.json();
  }

  // ---- オフラインキュー（出庫送信のみ対象） ----
  var QKEY = 'p8_txqueue';
  function qAll() {
    try { var a = JSON.parse(localStorage.getItem(QKEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function qSave(a) { try { localStorage.setItem(QKEY, JSON.stringify(a)); } catch (e) { console.warn(e); } }
  function queueCount() { return qAll().length; }

  function enqueueDispense(item) {
    item.id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    var a = qAll(); a.push(item); qSave(a);
    if (P8.ui) P8.ui.queueBar();
  }

  // 再送: transactions INSERT → 在庫は「再送時点の実値」から減算（滞留中の他操作とずらさない）
  async function replayDispense(it) {
    await write('pharmacy_transactions', 'POST', it.txRows);
    var codes = (it.decs || []).map(function (d) { return d.code; });
    if (codes.length) {
      var rows = await get('pharmacy_medicines?code=in.(' + codes.map(encodeURIComponent).join(',') + ')&select=code,current_stock');
      if (!rows) throw new Error('在庫の再取得に失敗');
      for (var i = 0; i < it.decs.length; i++) {
        var d = it.decs[i];
        var row = rows.find(function (r) { return r.code === d.code; });
        if (!row) continue;
        var patched = await write('pharmacy_medicines?code=eq.' + encodeURIComponent(d.code), 'PATCH',
          { current_stock: (row.current_stock || 0) - d.qty, last_updated: new Date().toISOString() });
        if (!patched || !patched.length) throw new Error('在庫更新の結果を確認できません');
      }
    }
    if (it.presc) gasGet('recordPrescription', it.presc); // fire-and-forget
  }

  var flushing = false;
  async function flushQueue() {
    if (flushing) return;
    if (!navigator.onLine) { if (P8.ui) P8.ui.queueBar(); return; }
    var items = qAll();
    if (!items.length) { if (P8.ui) P8.ui.queueBar(); return; }
    flushing = true;
    var sent = 0;
    try {
      while (true) {
        var cur = qAll();
        if (!cur.length) break;
        await replayDispense(cur[0]);   // 失敗したら throw → キューに残る
        cur = qAll(); cur.shift(); qSave(cur);
        sent++;
        if (P8.ui) P8.ui.queueBar();
      }
      if (sent > 0) {
        if (P8.ui) { P8.ui.queueBar('ok'); P8.ui.toast('未送信だった出庫 ' + sent + ' 件を送信しました', 'success'); }
        if (P8.store && P8.store.refresh) P8.store.refresh();
      }
    } catch (e) {
      console.warn('キュー再送失敗（次の機会に再試行）:', e.message);
      if (P8.ui) P8.ui.queueBar();
    } finally { flushing = false; }
  }

  window.addEventListener('online', function () { flushQueue(); });
  setInterval(flushQueue, 60000);

  P8.db = {
    get: get, write: write, rpc: rpc, count: count,
    gasGet: gasGet, karteFetch: karteFetch,
    enqueueDispense: enqueueDispense, flushQueue: flushQueue, queueCount: queueCount
  };
})();
