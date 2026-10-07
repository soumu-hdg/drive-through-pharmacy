/* 薬品在庫 v0.8（ログイン版・2026-10-07 準備中）
   電子カルテと同じ職員アカウントでログインしてから画面を起動する。
   ・DB の守り（01_login_lockdown.sql）を適用すると、ログインなしの v0.6〜v0.8 は読み書きできなくなる。その切替先がこの版
   ・二要素認証を登録している人は、6桁の番号まで入れてから起動する（電子カルテと同じ条件）
   ・アプリ本体のコードはそのまま。起動処理（DOMContentLoaded）をログインが終わるまで預かっておき、終わったら流す */
(function () {
  var SB_URL = 'https://vypwgxkqtxuzqfaaeamf.supabase.co';
  var SB_KEY = 'sb_publishable_WVbE1jJE6sBDli7qO-xSJA_GqDqu4OE';
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'p8_login_session' } });
  window.P8_SB = sb;

  // 起動処理を預かる
  var held = [], released = false, domReady = false;
  var origAdd = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opt) {
    if (type === 'DOMContentLoaded' && !released) { held.push(fn); return; }
    return origAdd(type, fn, opt);
  };
  origAdd('DOMContentLoaded', function () { domReady = true; start(); });
  function release() {
    if (released) return; released = true;
    document.addEventListener = origAdd;
    document.getElementById('p8-login').remove();
    held.forEach(function (fn) { try { fn.call(document, new Event('DOMContentLoaded')); } catch (e) { console.error(e); } });
  }

  function setToken(session) { window.P8_ACCESS_TOKEN = session ? session.access_token : null; }
  sb.auth.onAuthStateChange(function (ev, session) {
    setToken(session);
    if (ev === 'SIGNED_OUT' && released) location.reload();
  });

  function overlay() {
    var d = document.createElement('div'); d.id = 'p8-login';
    d.innerHTML =
      '<div class="p8l-box"><div class="p8l-title">薬品在庫 v0.8</div><div class="p8l-sub">電子カルテと同じ職員アカウントでログインしてください</div>' +
      '<form id="p8l-form"><label>メールアドレス<input id="p8l-email" type="email" autocomplete="username" required></label>' +
      '<label>パスワード<input id="p8l-pass" type="password" autocomplete="current-password" required></label>' +
      '<label id="p8l-otp-row" hidden>認証アプリの6桁の番号<input id="p8l-otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>' +
      '<button id="p8l-btn" type="submit">ログイン</button><div id="p8l-msg" class="p8l-msg"></div></form></div>';
    var st = document.createElement('style');
    st.textContent = '#p8-login{position:fixed;inset:0;z-index:9999;background:#e8ebe6;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}' +
      '.p8l-box{background:#f7f8f5;border:1px solid #c9cec6;border-left:4px solid #0e7c66;padding:24px;width:100%;max-width:360px}' +
      '.p8l-title{font-weight:800;font-size:20px}.p8l-sub{font-size:13px;color:#555;margin:4px 0 16px}' +
      '#p8-login label{display:block;font-size:13px;margin-bottom:12px}#p8-login input{display:block;width:100%;box-sizing:border-box;padding:10px;font-size:16px;margin-top:4px;border:1px solid #b9bfb6;border-radius:2px}' +
      '#p8l-btn{width:100%;padding:12px;font-size:16px;font-weight:700;background:#0e7c66;color:#fff;border:0;border-radius:2px;cursor:pointer}' +
      '.p8l-msg{color:#b23a2b;font-size:13px;margin-top:10px;min-height:1em}';
    document.head.appendChild(st); document.body.appendChild(d);
    document.getElementById('p8l-form').addEventListener('submit', submit);
  }
  function msg(t) { document.getElementById('p8l-msg').textContent = t || ''; }

  var pendingFactor = null;
  async function submit(ev) {
    ev.preventDefault(); msg('');
    var btn = document.getElementById('p8l-btn'); btn.disabled = true;
    try {
      if (pendingFactor) {
        var code = document.getElementById('p8l-otp').value.trim();
        var v = await sb.auth.mfa.challengeAndVerify({ factorId: pendingFactor, code: code });
        if (v.error) throw new Error('番号が違います');
        return afterAuth();
      }
      var r = await sb.auth.signInWithPassword({ email: document.getElementById('p8l-email').value.trim(), password: document.getElementById('p8l-pass').value });
      if (r.error) throw new Error('メールアドレスかパスワードが違います');
      await afterAuth();
    } catch (e) { msg(e.message); } finally { btn.disabled = false; }
  }

  async function afterAuth() {
    var a = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (a.data && a.data.nextLevel === 'aal2' && a.data.currentLevel !== 'aal2') {
      var f = await sb.auth.mfa.listFactors();
      var totp = f.data && f.data.totp && f.data.totp[0];
      if (!totp) throw new Error('二要素認証の設定を確認してください');
      pendingFactor = totp.id;
      document.getElementById('p8l-otp-row').hidden = false; document.getElementById('p8l-otp').focus();
      document.getElementById('p8l-btn').textContent = '番号を確かめる';
      return;
    }
    // 西春の在庫を見られる職員か（DB と同じ判定）
    var ok = await sb.rpc('karte_can_access', { p_clinic: 'nishiharu' });
    if (ok.error || ok.data !== true) { await sb.auth.signOut(); throw new Error('このアカウントでは薬品在庫を使えません'); }
    var s = await sb.auth.getSession(); setToken(s.data.session);
    release();
  }

  async function start() {
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) {
      setToken(s.data.session);
      try { await afterAuth(); if (released) return; } catch (e) { /* ログイン画面へ */ }
    }
    overlay();
  }
})();
