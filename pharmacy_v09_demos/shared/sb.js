/* 薬品在庫 v0.9 デモ ─ Supabase 接続（全デモ共通）
   読み込み順: demo_data.js（接続できないときの見本）→ kana.js → sb.js → 各デモの app.js

   ・テスト用: 本番DBの「テスト用の院」につながり、読み書きできる（西春・中川には影響しない）
   ・西春・中川: 本番DBには接続しない。demo_data.js の見本データで表示し、書き込みはしない

   使い方:
     await SB.ready;                         // 起動時に必ず待つ。DEMO_DATA.medicines.test などがDBの値で上書きされる
     SB.live                                 // true=テスト用の院がDBに接続中 / false=接続できず見本データで表示中
     SB.isLive(clinic)                       // その院がDBにつながっているか（テスト用だけ true）
     SB.canWrite(clinic)                     // clinic==='test' のときだけ true
     await SB.apply('test', [{code:'M005', kind:'in', delta:200, ref:'AL-001', lot_no:'X1', expiry_on:'2028-08-01', unit_cost:9.8}], 'スタッフA', 'demo:F')
     await SB.apply('test', [{code:'M005', kind:'count', count:120, reason:'数え直し（記録漏れ）', note:'…'}], op, 'demo:E')   // 実数で直す
     await SB.apply('test', [{code:'M005', kind:'adjust', delta:-3, reason:'破損・汚損'}], op, 'demo:H')
       → [{tx_id, code, before, after, delta}]   ※ DEMO_DATA.medicines.test の在庫も自動で書き換わる
     await SB.voidTx('test', [tx_id, ...], op)            // 取り消し（在庫を戻す）
     await SB.upsertMedicine('test', {name, furigana, unit, category, price, pack_size, cost_per_pack, threshold, current_stock, rezept_code, maker, form, gs1}, op, 'demo:F')
       → {code, created}                                  // code を省くと M+連番を振る
     await SB.mapGs1('test', '1498…', 'M021')             // 箱のバーコードを品目に結び付ける
     await SB.saveDoc('test', null, 'order', 'PO-0930-01', 'sent', {...}, op) → id
     await SB.resolveUnmatched('test', id, 'linked'|'dismissed', 'M189', op, 'メモ')
     await SB.resetTest()                                 // テスト用の院を初期状態へ（西春の今の値を写し直す）
     await SB.refresh('test')                             // 品目・動き・未結び付けを読み直す
     SB.moves(clinic)          // 在庫の動き（新しい順）[{id, medicine_code, kind, qty, stock_before, stock_after, reason, note, operator, source, ref, occurred_on, created_at, voided_at}]
     SB.unmatched(clinic)      // カルテで結び付かなかった処方（未処理）[{id, karte_name, qty, unit, occurred_on, reason, note}]
     SB.docs(clinic, kind)     // 書類
     SB.readOnlyMessage(clinic) // 書き込めない院で出す文言
   失敗は Error を投げる（message に理由）。画面内に表示すること（alert は使わない）
*/
(function () {
  'use strict';
  var URL0 = 'https://vypwgxkqtxuzqfaaeamf.supabase.co/rest/v1/';
  var KEY = 'sb_publishable_WVbE1jJE6sBDli7qO-xSJA_GqDqu4OE';
  var H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  var CLINICS = ['test'];   // DBにつなぐのはテスト用の院だけ
  var D = window.DEMO_DATA = window.DEMO_DATA || {};
  var state = { moves: {}, unmatched: {}, docs: {} };

  async function get(path) {
    var r = await fetch(URL0 + path, { headers: H, cache: 'no-store' });
    if (!r.ok) throw new Error('読み込みに失敗しました（' + r.status + '）');
    return r.json();
  }
  async function rpc(name, args) {
    var r = await fetch(URL0 + 'rpc/' + name, { method: 'POST', headers: H, body: JSON.stringify(args || {}) });
    var t = await r.text(); var j = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('書き込みに失敗しました（' + r.status + '）'));
    return j;
  }
  function daysAgo(n) { var d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); }

  async function loadClinic(c) {
    var meds = await get('pharmacy_c_v_medicines?clinic_id=eq.' + c + '&order=code');
    D.medicines = D.medicines || {};
    D.medicines[c] = meds;
    var mv = await get('pharmacy_c_v_moves?clinic_id=eq.' + c + '&occurred_on=gte.' + daysAgo(40) +
      '&select=id,medicine_code,kind,qty,stock_before,stock_after,reason,note,operator,source,ref,occurred_on,created_at,voided_at&order=created_at.desc&limit=5000');
    state.moves[c] = mv;
    // 日別×品目の出庫（カルテから・手入力とも）＝ DEMO_DATA.daily_out_<clinic>
    var agg = {};
    mv.forEach(function (m) {
      if ((m.kind !== 'out' && m.kind !== 'karte_out') || m.voided_at) return;
      var k = m.occurred_on + '|' + m.medicine_code;
      var a = agg[k] || (agg[k] = { d: m.occurred_on, c: m.medicine_code, n: 0, q: 0 });
      a.n += 1; a.q += Math.abs(Number(m.qty) || 0);
    });
    D['daily_out_' + c] = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    state.unmatched[c] = await get('pharmacy_c_karte_unmatched?clinic_id=eq.' + c + '&status=eq.open&order=id');
    state.docs[c] = await get('pharmacy_c_docs?clinic_id=eq.' + c + '&order=id.desc&limit=200');
    D.karte_unmatched = D.karte_unmatched || {};
    D.karte_unmatched[c] = state.unmatched[c];
  }

  function applyLocal(c, res) {
    var list = (D.medicines && D.medicines[c]) || [];
    (res || []).forEach(function (r) {
      var m = list.find(function (x) { return x.code === r.code; });
      if (m) m.current_stock = Number(r.after);
    });
  }

  var SB = {
    live: false, error: null, loadedAt: null,
    canWrite: function (c) { return c === 'test' && SB.live; },
    isLive: function (c) { return c === 'test' && SB.live; },
    readOnlyMessage: function (c) {
      return c === 'nishiharu' ? '西春は本番の院のため、このデモでは見本データを表示しています（書き込みはしません）。操作はテスト用の院で試してください。'
           : c === 'nakagawa' ? '中川は開院前のため、このデモでは見本データを表示しています（書き込みはしません）。操作はテスト用の院で試してください。'
           : (SB.live ? '' : 'DBに接続できないため、見本データで表示しています。');
    },
    moves: function (c) { return state.moves[c] || []; },
    unmatched: function (c) { return state.unmatched[c] || []; },
    docs: function (c, kind) { return (state.docs[c] || []).filter(function (d) { return !kind || d.kind === kind; }); },
    refresh: async function (c) { await loadClinic(c); SB.loadedAt = new Date(); return D.medicines[c]; },
    apply: async function (c, items, op, src) {
      var res = await rpc('pharmacy_c_apply', { p_clinic: c, p_items: items, p_operator: op || null, p_source: src || null });
      applyLocal(c, res); loadClinic(c).catch(function () {}); return res;
    },
    voidTx: async function (c, ids, op) {
      var res = await rpc('pharmacy_c_void', { p_clinic: c, p_tx_ids: ids, p_operator: op || null });
      applyLocal(c, res); loadClinic(c).catch(function () {}); return res;
    },
    upsertMedicine: async function (c, row, op, src) {
      var res = await rpc('pharmacy_c_upsert_medicine', { p_clinic: c, p_row: row, p_operator: op || null, p_source: src || null });
      await loadClinic(c); return res;
    },
    mapGs1: async function (c, gs1, code) {
      await rpc('pharmacy_c_map_gs1', { p_clinic: c, p_gs1: gs1, p_code: code });
      var m = (D.medicines[c] || []).find(function (x) { return x.code === code; }); if (m && !m.gs1) m.gs1 = gs1;
    },
    saveDoc: async function (c, id, kind, no, status, body, op) {
      var i = await rpc('pharmacy_c_doc_save', { p_clinic: c, p_id: id || null, p_kind: kind, p_doc_no: no || null, p_status: status || null, p_body: body || null, p_operator: op || null });
      loadClinic(c).catch(function () {}); return i;
    },
    resolveUnmatched: async function (c, id, status, code, op, note) {
      var res = await rpc('pharmacy_c_unmatched_resolve', { p_clinic: c, p_id: id, p_status: status, p_code: code || null, p_operator: op || null, p_note: note || null });
      applyLocal(c, res); await loadClinic(c); return res;
    },
    resetTest: async function () { var r = await rpc('pharmacy_c_reset_test', {}); await loadClinic('test'); return r; },
    badge: function () {
      var el = document.getElementById('sb-live-badge');
      if (!el) { el = document.createElement('div'); el.id = 'sb-live-badge'; document.body.appendChild(el); }
      el.setAttribute('style', 'position:fixed;right:8px;bottom:8px;z-index:9999;font:12px/1.4 sans-serif;padding:4px 8px;border-radius:3px;pointer-events:none;' +
        (SB.live ? 'background:#0e7c66;color:#fff' : 'background:#b3372f;color:#fff'));
      el.textContent = SB.live ? 'テスト用の院はDBに接続中（西春・中川は見本データ）' : 'DBに接続できないため見本データで表示中';
    }
  };

  SB.ready = (async function () {
    try {
      for (var i = 0; i < CLINICS.length; i++) await loadClinic(CLINICS[i]);
      SB.live = true; SB.loadedAt = new Date();
    } catch (e) {
      SB.live = false; SB.error = e.message; console.warn('SB: 見本データで表示します', e);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', SB.badge); else SB.badge();
    return SB.live;
  })();

  window.SB = SB;
})();
