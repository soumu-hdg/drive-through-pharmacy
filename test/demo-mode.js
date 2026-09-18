// ====================================
// DigiMaster デモモード（GitHub Pages 公開用の見本）
//   裏の処理（Python の API サーバー）とデータベースが無い場所で開かれたときだけ、
//   ID admin / パスワード admin のログインを通し、画面の動きを確認できるようにする。
//   データは保存されない。手元 PC の配布版（file:// / localhost）では何もしない。
// ====================================
(function () {
  var host = window.location.hostname || '';
  var onPages = /\.github\.io$/.test(host);
  if (!onPages) return; // ローカル配布版の挙動は変えない

  var realFetch = window.fetch.bind(window);
  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  var facility = {
    facility_id: '00000000-0000-0000-0000-000000000001',
    facility_code: 'DEMO001',
    facility_name: '西春内科・在宅クリニック（デモ）',
    certificate_id: null,
    certificate_label: null,
    certificate_serial: null,
    certificate_expires_at: null,
    development_mode: true,
    password_only_mode: true
  };
  var user = {
    id: '00000000-0000-0000-0000-00000000admin',
    login_id: 'admin',
    name: 'デモ 管理者',
    role: 'admin',
    facility_id: facility.facility_id,
    facility_code: facility.facility_code,
    facility_name: facility.facility_name,
    department: '内科',
    is_active: true
  };

  window.fetch = async function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = url.match(/\/api\/v1(\/[^?]*)/);
    if (!m) return realFetch(input, init);
    var ep = m[1];
    var method = (init.method || 'GET').toUpperCase();

    if (ep === '/auth/facility-context') return json(facility);
    if (ep === '/auth/login' && method === 'POST') {
      var body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) {}
      if (body.login_id === 'admin' && body.password === 'admin') {
        return json({ access_token: 'demo-access-token', refresh_token: 'demo-refresh-token', token_type: 'bearer', user: user });
      }
      return json({ detail: 'ログインIDまたはパスワードが正しくありません（デモは admin / admin のみ）' }, 401);
    }
    if (ep === '/auth/refresh') return json({ access_token: 'demo-access-token' });
    if (ep === '/auth/me') return json(user);
    if (ep === '/auth/logout') return json({ ok: true });
    // それ以外は「空のデータ」を返す（保存はされない）
    if (method === 'GET') return json({ data: [], items: [], results: [], total: 0 });
    return json({ ok: true, demo: true });
  };
  window.DIGIMASTER_DEMO_MODE = true;
  console.info('[DigiMaster] デモモード: admin / admin でログインできます（データは保存されません）');
})();
