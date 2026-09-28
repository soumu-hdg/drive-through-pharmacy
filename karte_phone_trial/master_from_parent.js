// ===== マスター JSON を親の画面（基準版の画面の置き換え層）経由で Supabase の表から読む（工程4・2026-09-24） master_from_parent.js =====
// 基準版の画面はレセプト作成のために、この統合版の画面を「見えない枠」で開いて UKE を作る（compat_receipt.js）。
// そのとき枠の中の統合版が読むマスター JSON（master/*.json・disease_drug_suggest.json）を、静的なファイルではなく
// 親の置き換え層（compat_masters.js の C.masterForPath）経由で Supabase の表から返す。返す Response の中身は元のファイルと同じ JSON。
//   ・働くのは「同じオリジンの親の画面の中の枠として開かれ、親に置き換え層（__compat.masterForPath）があるとき」だけ。
//     単独で開いた統合版（本番の画面など）では何もしない（fetch も触らない）
//   ・親から読めなかったとき（未ログイン・表に無い・通信の失敗）は、元の fetch（静的なファイル）に任せる
//   ・index.html の最初のスクリプトとして読む（ほかのスクリプトがマスターを読みに行く前に差し込むため）
(function () {
  var parentCompat = null;
  try {
    if (window.parent && window.parent !== window && window.parent.location.origin === window.location.origin &&
        window.parent.__compat && typeof window.parent.__compat.masterForPath === 'function') parentCompat = window.parent.__compat;
  } catch (e) { parentCompat = null; }   // 別オリジンの親は読めない＝何もしない
  if (!parentCompat) return;

  // 親の置き換え層（compat_receipt.js）は、枠の中のマスターの読み込みが終わるのを w.MasterLoader.load() で待ってから UKE を作る。
  // ところが統合版の MasterLoader は const 宣言（窓のプロパティにならない）で load も無いため、待たずに作っていた
  // （静的なファイルは読み込みが速いので間に合っていたが、表から読むと間に合わず点数が変わる）。枠のときだけ待ち口を用意する。
  // 関数の中の MasterLoader は、master_loader.js が読まれたあとはその const（本物）を指す
  window.MasterLoader = { load: function () {
    return (typeof MasterLoader !== 'undefined' && MasterLoader !== window.MasterLoader && typeof MasterLoader.loadAll === 'function') ? MasterLoader.loadAll('master/') : Promise.resolve();
  } };

  var realFetch = window.fetch.bind(window);
  var appBase = new URL('.', window.location.href);   // この画面（app/index.html）のフォルダ
  var MASTER_RE = /^(master\/[a-z0-9_]+\.json|disease_drug_suggest\.json)$/;
  var served = {};
  window.__masterFromParent = { served: served };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    var rel = null;
    try {
      var u = new URL(url, window.location.href);
      if (method === 'GET' && u.origin === window.location.origin && u.pathname.indexOf(appBase.pathname) === 0) {
        var r = u.pathname.slice(appBase.pathname.length);
        if (MASTER_RE.test(r)) rel = r;
      }
    } catch (e) { rel = null; }
    if (!rel) return realFetch(input, init);
    return Promise.resolve().then(function () { return parentCompat.masterForPath(rel); }).then(function (got) {
      if (!got) return realFetch(input, init);
      var body = got.text != null ? got.text : JSON.stringify(got.json);
      served[rel] = (served[rel] || 0) + 1;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }, function () { return realFetch(input, init); });
  };
})();
