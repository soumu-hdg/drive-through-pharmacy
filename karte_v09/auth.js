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
      showApp();
      return true;
    }
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    authUser = session.user;
    showApp();
    return true;
  }
  showLoginScreen();
  return false;
}

function showLoginScreen() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
}

function showApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appContainer').style.display = '';
  const badge = document.getElementById('authUserBadge');
  if (badge && authUser) {
    badge.textContent = authUser.email;
    badge.style.display = '';
  }
  // Load DB data only after authentication
  if (typeof loadDbData === 'function' && !dbLoaded) {
    loadDbData();
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
    showApp();
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
      role: 'staff'
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
      showLoginScreen();
    } else if (session) {
      authUser = session.user;
      if (event === 'SIGNED_IN') {
        // Fire-and-forget: don't block the listener
        ensureAppUser(session.user).then(() => showApp()).catch(console.error);
      }
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

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;">読み込み中...</td></tr>';

  const { data, error } = await supabaseClient.from('app_users').select('*').order('email');
  if (error) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#dc2626;">エラー: ' + error.message + '</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;">ユーザーなし</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => {
    const email = escapeHtml(u.email);
    const name = escapeHtml(u.display_name || '');
    const role = escapeHtml(u.role);
    const active = u.is_active ? '<span style="color:#16a34a;">有効</span>' : '<span style="color:#dc2626;">無効</span>';
    const toggleLabel = u.is_active ? '無効化' : '有効化';
    const toggleColor = u.is_active ? '#dc2626' : '#16a34a';
    return '<tr>' +
      '<td>' + email + '</td>' +
      '<td>' + name + '</td>' +
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
      role: role
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
