// ===== Supabase Auth モジュール (auth.js) =====
// 電子カルテ v0.9 — ログイン認証

let authUser = null;

async function initAuth() {
  if (!supabaseClient) return false;

  // Handle OAuth redirect callback (Google login returns with hash params)
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  if (hashParams.get('access_token') || window.location.search.includes('code=')) {
    // Let Supabase process the OAuth callback
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session) {
      authUser = session.user;
      await ensureAppUser(session.user);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      let pending = '';
      try { pending = sessionStorage.getItem('karte_clinic_pending') || ''; sessionStorage.removeItem('karte_clinic_pending'); } catch (e) { /* noop */ }
      await enterApp(pending || '');
      return true;
    }
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    authUser = session.user;
    await enterApp('');
    return true;
  }
  showLoginScreen();
  return false;
}

function showLoginScreen(msg) {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  const cred = document.getElementById('loginCredBox'); if (cred) cred.style.display = '';
  const only = document.getElementById('loginClinicOnlyBox'); if (only) only.style.display = 'none';
  const errorEl = document.getElementById('loginError'); if (errorEl) errorEl.textContent = msg || '';
  // v21: 接続クリニックの選択（前回の院を初期選択）
  const box = document.getElementById('loginClinicPicker');
  if (box && window.ClinicCtx) ClinicCtx.renderPicker(box, { selected: ClinicCtx.boot });
}

// v21: 認証済みのIDを「選んだ院」に接続する（ログイン直後・セッション復元・Google 復帰で共通）
//   selected: ログイン画面で選んだ院（'' = セッション復元＝起動時の院を使う）
async function enterApp(selected) {
  if (!window.ClinicCtx) { showApp(); return; }
  await ClinicCtx.loadClinics();
  await ClinicCtx.loadUser(authUser);
  const allowed = ClinicCtx.allowed();
  if (!allowed.length) {
    await signOutQuiet();
    showLoginScreen('このIDには所属クリニックが設定されていません。管理者（総務）に連絡してください');
    return;
  }
  const want = selected || ClinicCtx.boot;
  if (ClinicCtx.canUse(want)) {
    if (want !== ClinicCtx.boot) { ClinicCtx.select(want); return; }   // 再読込して選んだ院で起動
    ClinicCtx.remember(want);
    showApp();
    return;
  }
  if (selected) {
    // ログイン画面で選んだ院に所属していない → 接続しない
    const names = ClinicCtx.isMaster() ? '全院' : allowed.map(id => ClinicCtx.shortOf(id)).join('・');
    await signOutQuiet();
    showLoginScreen('このIDは「' + ClinicCtx.nameOf(want) + '」に所属していません（所属: ' + names + '）');
    return;
  }
  // セッション復元だが起動時の院に所属していない → 院だけ選び直す画面
  showClinicOnlyScreen();
}

async function signOutQuiet() {
  try { await supabaseClient.auth.signOut(); } catch (e) { console.warn('signOut error:', e); }
  authUser = null;
}

// v21: ログイン済みのまま院だけ選び直す（資格情報の欄は隠す）
function showClinicOnlyScreen() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  const cred = document.getElementById('loginCredBox'); if (cred) cred.style.display = 'none';
  const only = document.getElementById('loginClinicOnlyBox'); if (only) only.style.display = '';
  const errorEl = document.getElementById('loginError'); if (errorEl) errorEl.textContent = '';
  const who = document.getElementById('loginClinicOnlyWho'); if (who && authUser) who.textContent = authUser.email;
  const box = document.getElementById('loginClinicPicker');
  if (box && window.ClinicCtx) ClinicCtx.renderPicker(box, { onlyAllowed: true });
}
function loginClinicOnlyConnect() {
  const id = ClinicCtx.pickerValue(document.getElementById('loginClinicPicker'));
  if (!ClinicCtx.canUse(id)) { document.getElementById('loginError').textContent = 'このIDでは選べない院です'; return; }
  if (ClinicCtx.select(id)) return;
  ClinicCtx.remember(id); showApp();
}
async function loginClinicOnlyLogout() { await signOutQuiet(); showLoginScreen(''); }

function showApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appContainer').style.display = '';
  const badge = document.getElementById('authUserBadge');
  if (badge && authUser) {
    badge.textContent = authUser.email;
    badge.style.display = '';
  }
  // v21: 受付見出し・タブ名を接続クリニックに
  if (window.ClinicCtx) ClinicCtx.applyHeader();
  // Load DB data only after authentication
  if (typeof loadDbData === 'function' && !dbLoaded) {
    loadDbData();
  }
  // v19: 予約システムからの来院予定（visits.rsv_code あり）を読み、60秒ごとに更新
  //   v21: スプレッドシートを持たない院は Supabase の患者マスタを先に入れてから来院記録を読む
  if (window.ClinicCtx && !ClinicCtx.hasSheet()) {
    ClinicCtx.loadPatients().catch(e => console.warn('[院] 患者読込失敗:', e)).then(() => { if (window.RsvSync) RsvSync.load(false); });
  } else if (window.RsvSync) RsvSync.load(false);
  // v20: Supabase patients の支払方法・保険証・医療証などを画面へ読み戻す（スプシ読込の後に突合）
  if (typeof hydratePatientsFromSupabase === 'function') setTimeout(function () { hydratePatientsFromSupabase(currentClinicId()); }, 5000);
  // SSKマスター読込（傷病名27,684件等をバックグラウンドで）
  if (typeof MasterLoader !== 'undefined' && !MasterLoader.isLoaded()) {
    MasterLoader.loadAll('master/').then(() => {
      console.log('[MasterLoader] カルテ用マスター読込完了:', MasterLoader.getStats());
    }).catch(e => console.warn('[MasterLoader] 読込失敗:', e));
  }
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'メールアドレスとパスワードを入力してください';
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'ログイン中...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = 'ログイン失敗: ' + error.message;
      btn.disabled = false;
      btn.textContent = 'ログイン';
      return;
    }
    authUser = data.user;
    const picked = window.ClinicCtx ? ClinicCtx.pickerValue(document.getElementById('loginClinicPicker')) : '';
    await enterApp(picked || '');
    btn.disabled = false;
    btn.textContent = 'ログイン';
  } catch (e) {
    errorEl.textContent = 'エラー: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

async function handleGoogleLogin() {
  const btn = document.getElementById('googleLoginBtn');
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    try { sessionStorage.setItem('karte_clinic_pending', window.ClinicCtx ? ClinicCtx.pickerValue(document.getElementById('loginClinicPicker')) : ''); } catch (e) { /* noop */ }
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) {
      errorEl.textContent = 'Google認証エラー: ' + error.message;
      btn.disabled = false;
      btn.style.opacity = '1';
    }
    // Browser will redirect to Google login page
  } catch (e) {
    errorEl.textContent = 'エラー: ' + e.message;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// Ensure Google-authenticated user exists in app_users table
async function ensureAppUser(user) {
  if (!user || !supabaseClient) return;
  const { data } = await supabaseClient.from('app_users').select('id').eq('id', user.id).single();
  if (!data) {
    await supabaseClient.from('app_users').upsert({
      id: user.id,
      email: user.email,
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0],
      role: 'staff',
      clinics: []   // v21: 所属院は管理者が「ID管理」で付ける（付くまでログインできない）
    }, { onConflict: 'id' });
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  try {
    await supabaseClient.auth.signOut();
  } catch (e) {
    // signOut may fail but we still want to clear local state
    console.warn('signOut error:', e);
  }
  authUser = null;
  showLoginScreen();
}

// Listen for auth state changes (token refresh, etc.)
function setupAuthListener() {
  if (!supabaseClient) return;
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      authUser = null;
      const cur = document.getElementById('loginError');
      showLoginScreen(cur ? cur.textContent : '');   // v21: 表示中の理由（所属外など）は消さない
    } else if (session) {
      authUser = session.user;
      // v21: 画面遷移は handleLogin / initAuth 側（enterApp）で行う。ここでは行の用意だけ
      if (event === 'SIGNED_IN') ensureAppUser(session.user).catch(console.error);
    }
  });
}

// ===== ユーザー管理機能 =====

async function openUserManager() {
  const modal = document.getElementById('userManagerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  await loadUserList();
}

function closeUserManager() {
  document.getElementById('userManagerModal').style.display = 'none';
}

async function loadUserList() {
  const tbody = document.getElementById('userListBody');
  if (!tbody || !isSupabaseReady()) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;">読み込み中...</td></tr>';

  const { data, error } = await supabaseClient.from('app_users').select('*').order('email');
  const clinicsAll = window.ClinicCtx ? ClinicCtx.list() : [];
  if (error) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#dc2626;">エラー: ' + error.message + '</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;">ユーザーなし</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => {
    const email = escapeHtml(u.email);
    const name = escapeHtml(u.display_name || '');
    const role = escapeHtml(u.role);
    const active = u.is_active ? '<span style="color:#16a34a;">有効</span>' : '<span style="color:#dc2626;">無効</span>';
    const toggleLabel = u.is_active ? '無効化' : '有効化';
    const toggleColor = u.is_active ? '#dc2626' : '#16a34a';
    const cl = Array.isArray(u.clinics) ? u.clinics : (u.clinic_id ? [u.clinic_id] : []);
    const isAll = cl.indexOf('*') >= 0;
    const clinicsHtml = '<label style="white-space:nowrap;margin-right:6px;"><input type="checkbox" data-uid="' + u.id + '" data-clinic="*"' + (isAll ? ' checked' : '') + ' onchange="onUserClinicToggle(this)"> 全院</label>' +
      clinicsAll.map(c => '<label style="white-space:nowrap;margin-right:6px;"><input type="checkbox" data-uid="' + u.id + '" data-clinic="' + escapeHtml(c.id) + '"' + (cl.indexOf(c.id) >= 0 ? ' checked' : '') + (isAll ? ' disabled' : '') + ' onchange="onUserClinicToggle(this)"> ' + escapeHtml(c.short_name || c.name) + '</label>').join('');
    return '<tr>' +
      '<td>' + email + '</td>' +
      '<td>' + name + '</td>' +
      '<td style="font-size:12px;">' + clinicsHtml + '</td>' +
      '<td><select onchange="updateUserRole(\'' + u.id + '\',this.value)" style="padding:2px 4px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;">' +
        '<option value="admin"' + (u.role==='admin'?' selected':'') + '>admin</option>' +
        '<option value="doctor"' + (u.role==='doctor'?' selected':'') + '>doctor</option>' +
        '<option value="staff"' + (u.role==='staff'?' selected':'') + '>staff</option>' +
        '<option value="readonly"' + (u.role==='readonly'?' selected':'') + '>readonly</option>' +
      '</select></td>' +
      '<td>' + active + '</td>' +
      '<td><button onclick="toggleUserActive(\'' + u.id + '\',' + !u.is_active + ')" style="font-size:11px;padding:2px 8px;border:1px solid ' + toggleColor + ';background:transparent;color:' + toggleColor + ';border-radius:4px;cursor:pointer;">' + toggleLabel + '</button></td>' +
    '</tr>';
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function updateUserRole(userId, newRole) {
  if (!isSupabaseReady()) return;
  const { error } = await supabaseClient.from('app_users').update({ role: newRole, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) alert('更新失敗: ' + error.message);
}

// v21: 所属院の変更（チェックの状態をまとめて保存。「全院」を付けると '*' だけになる）
async function onUserClinicToggle(cb) {
  if (!isSupabaseReady()) return;
  const uid = cb.dataset.uid;
  const boxes = Array.from(document.querySelectorAll('#userListBody input[type=checkbox][data-uid="' + uid + '"]'));
  const all = boxes.find(b => b.dataset.clinic === '*');
  let clinics;
  if (all && all.checked) clinics = ['*'];
  else clinics = boxes.filter(b => b.dataset.clinic !== '*' && b.checked).map(b => b.dataset.clinic);
  const { error } = await supabaseClient.from('app_users').update({ clinics: clinics, updated_at: new Date().toISOString() }).eq('id', uid);
  if (error) { alert('所属院の更新に失敗: ' + error.message + '\n（管理者のIDでのみ変更できます）'); await loadUserList(); return; }
  boxes.forEach(b => { if (b.dataset.clinic !== '*') b.disabled = !!(all && all.checked); });
}

async function toggleUserActive(userId, newState) {
  if (!isSupabaseReady()) return;
  const { error } = await supabaseClient.from('app_users').update({ is_active: newState, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) { alert('更新失敗: ' + error.message); return; }
  await loadUserList();
}

async function addNewUser() {
  const email = document.getElementById('newUserEmail').value.trim();
  const name = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const errorEl = document.getElementById('addUserError');
  errorEl.textContent = '';
  // v21: 所属院（未選択なら接続中の院）
  let newClinics = Array.from(document.querySelectorAll('#newUserClinics input[type=checkbox]:checked')).map(b => b.value);
  if (newClinics.indexOf('*') >= 0) newClinics = ['*'];
  if (!newClinics.length) newClinics = [currentClinicId()];

  if (!email || !password) {
    errorEl.textContent = 'メールアドレスとパスワードは必須です';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'パスワードは6文字以上必要です';
    return;
  }

  // Sign up via public API (creates auth.users entry)
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: { data: { display_name: name, role: role } }
  });

  if (error) {
    errorEl.textContent = '作成失敗: ' + error.message;
    return;
  }

  // Add to app_users table
  if (data.user) {
    await supabaseClient.from('app_users').upsert({
      id: data.user.id,
      email: email,
      display_name: name,
      role: role,
      clinics: newClinics
    }, { onConflict: 'id' });
  }

  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  errorEl.textContent = '';
  errorEl.style.color = '#16a34a';
  errorEl.textContent = email + ' を追加しました（メール確認が必要な場合があります）';
  await loadUserList();
}
