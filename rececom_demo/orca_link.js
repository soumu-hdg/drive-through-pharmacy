/**
 * WebORCA レセコン連携モジュール
 * orca_proxy.js (localhost:3710) 経由でWebORCA APIに接続
 * プロキシ未起動時はモックモードで動作
 */
const ORCA = (() => {
  // プロキシURL自動検出: URLパラメータ > localStorage > 候補リストの順に試行
  function detectProxyUrl() {
    const params = new URLSearchParams(location.search);
    if (params.get('orca_proxy')) return params.get('orca_proxy').replace(/\/+$/, '');
    if (localStorage.getItem('orca_proxy_url')) return localStorage.getItem('orca_proxy_url');
    return null;
  }

  const PROXY_CANDIDATES = [
    detectProxyUrl(),
    'http://localhost:3710',
    'http://' + location.hostname + ':3710'
  ].filter(Boolean);

  let PROXY_URL = PROXY_CANDIDATES[0];
  let connected = false;
  let connectionMode = 'checking'; // 'api', 'mock', 'checking'

  // --- API通信 ---
  async function callProxy(endpoint, body) {
    try {
      const res = await fetch(PROXY_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // --- 接続確認（複数候補を順に試行） ---
  async function checkConnection() {
    for (const candidate of PROXY_CANDIDATES) {
      try {
        const res = await fetch(candidate + '/api/status', { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data.status === 'ok') {
          PROXY_URL = candidate;
          connected = true;
          connectionMode = 'api';
          localStorage.setItem('orca_proxy_url', candidate);
          updateStatusBadge();
          return true;
        }
      } catch {}
    }
    connected = false;
    connectionMode = 'mock';
    updateStatusBadge();
    return false;
  }

  // --- ステータスバッジ ---
  function updateStatusBadge() {
    let badge = document.getElementById('orcaStatusBadge');
    if (!badge) return;
    if (connectionMode === 'api') {
      badge.textContent = 'ORCA API 接続中';
      badge.style.background = '#10b981';
      badge.style.color = '#fff';
    } else if (connectionMode === 'mock') {
      badge.textContent = 'モックモード';
      badge.style.background = '#f59e0b';
      badge.style.color = '#fff';
    } else {
      badge.textContent = '確認中...';
      badge.style.background = '#6b7280';
      badge.style.color = '#fff';
    }
  }

  // --- 患者一覧取得 ---
  async function getPatients() {
    const result = await callProxy('/api/patients');
    return result;
  }

  // --- 患者詳細取得 ---
  async function getPatient(patientId) {
    const result = await callProxy('/api/patient', { patient_id: patientId });
    return result;
  }

  // --- 診療科一覧 ---
  async function getDepartments() {
    const result = await callProxy('/api/departments');
    return result;
  }

  // --- 診療行為取得 ---
  async function getMedical(patientId) {
    const result = await callProxy('/api/medical', { patient_id: patientId });
    return result;
  }

  // --- 傷病名検索 ---
  async function searchDiseases(keyword) {
    const result = await callProxy('/api/diseases', { keyword });
    return result;
  }

  // --- レセプト概要 ---
  async function getReceipt(patientId) {
    const result = await callProxy('/api/receipt', { patient_id: patientId });
    return result;
  }

  // --- 生API呼び出し ---
  async function rawApi(endpoint, body) {
    const result = await callProxy('/api/raw', { endpoint, body });
    return result;
  }

  return {
    checkConnection, getPatients, getPatient, getDepartments,
    getMedical, searchDiseases, getReceipt, rawApi,
    get connected() { return connected; },
    get mode() { return connectionMode; },
    get proxyUrl() { return PROXY_URL; }
  };
})();

// ===== レセコン連携パネルUI =====
function createOrcaPanel() {
  // ヘッダーにバッジ追加
  const headerLogo = document.querySelector('.header .logo');
  if (headerLogo && !document.getElementById('orcaStatusBadge')) {
    const badge = document.createElement('span');
    badge.id = 'orcaStatusBadge';
    badge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:10px;cursor:pointer;';
    badge.title = 'WebORCA接続状態';
    badge.onclick = () => toggleOrcaPanel();
    headerLogo.after(badge);
  }

  // パネルHTML
  if (document.getElementById('orcaPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'orcaPanel';
  panel.style.cssText = `
    display:none; position:fixed; right:16px; top:60px; width:460px; max-height:80vh;
    background:#1a1a2e; color:#e0e0e0; border:1px solid #374151; border-radius:8px;
    box-shadow:0 8px 32px rgba(0,0,0,0.4); z-index:9999; overflow:auto;
    font-family:'游ゴシック','Yu Gothic',sans-serif;
  `;
  panel.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid #374151;display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;font-weight:700;color:#60a5fa;">&#x1F3E5; WebORCA 連携</span>
      <span id="orcaPanelStatus" style="font-size:11px;padding:2px 6px;border-radius:3px;background:#374151;"></span>
      <span style="flex:1"></span>
      <button onclick="toggleOrcaPanel()" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;">&times;</button>
    </div>

    <div style="padding:12px 16px;">
      <!-- タブ -->
      <div id="orcaTabs" style="display:flex;gap:4px;margin-bottom:12px;">
        <button class="orca-tab active" data-tab="patient" onclick="switchOrcaTab('patient')">患者検索</button>
        <button class="orca-tab" data-tab="medical" onclick="switchOrcaTab('medical')">診療行為</button>
        <button class="orca-tab" data-tab="receipt" onclick="switchOrcaTab('receipt')">レセプト</button>
        <button class="orca-tab" data-tab="disease" onclick="switchOrcaTab('disease')">傷病名</button>
        <button class="orca-tab" data-tab="api" onclick="switchOrcaTab('api')">API</button>
      </div>

      <!-- 患者検索タブ -->
      <div id="orcaTabPatient" class="orca-tab-content">
        <button onclick="orcaLoadPatients()" style="width:100%;padding:8px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">
          患者一覧を取得
        </button>
        <div id="orcaPatientList" style="margin-top:8px;max-height:300px;overflow:auto;"></div>
      </div>

      <!-- 診療行為タブ -->
      <div id="orcaTabMedical" class="orca-tab-content" style="display:none;">
        <div style="display:flex;gap:4px;">
          <input id="orcaMedicalPatientId" placeholder="患者番号" style="flex:1;padding:6px;background:#2d2d44;border:1px solid #4b5563;color:#e0e0e0;border-radius:4px;">
          <button onclick="orcaLoadMedical()" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">取得</button>
        </div>
        <div id="orcaMedicalResult" style="margin-top:8px;"></div>
      </div>

      <!-- レセプトタブ -->
      <div id="orcaTabReceipt" class="orca-tab-content" style="display:none;">
        <div style="display:flex;gap:4px;">
          <input id="orcaReceiptPatientId" placeholder="患者番号" style="flex:1;padding:6px;background:#2d2d44;border:1px solid #4b5563;color:#e0e0e0;border-radius:4px;">
          <button onclick="orcaLoadReceipt()" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">表示</button>
        </div>
        <div id="orcaReceiptResult" style="margin-top:8px;"></div>
      </div>

      <!-- 傷病名タブ -->
      <div id="orcaTabDisease" class="orca-tab-content" style="display:none;">
        <div style="display:flex;gap:4px;">
          <input id="orcaDiseaseKeyword" placeholder="傷病名検索（例: 高血圧）" style="flex:1;padding:6px;background:#2d2d44;border:1px solid #4b5563;color:#e0e0e0;border-radius:4px;">
          <button onclick="orcaSearchDiseases()" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">検索</button>
        </div>
        <div id="orcaDiseaseResult" style="margin-top:8px;"></div>
      </div>

      <!-- APIタブ -->
      <div id="orcaTabApi" class="orca-tab-content" style="display:none;">
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;color:#9ca3af;">エンドポイント:</label>
          <input id="orcaApiEndpoint" value="/api01rv2/patientlst1v2?class=01" style="width:100%;padding:6px;background:#2d2d44;border:1px solid #4b5563;color:#e0e0e0;border-radius:4px;font-family:monospace;font-size:12px;">
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:12px;color:#9ca3af;">リクエストボディ (JSON):</label>
          <textarea id="orcaApiBody" rows="4" style="width:100%;padding:6px;background:#2d2d44;border:1px solid #4b5563;color:#e0e0e0;border-radius:4px;font-family:monospace;font-size:12px;resize:vertical;">{"patientlst1req":{"Base_Date":"2026-06-10"}}</textarea>
        </div>
        <button onclick="orcaRawApiCall()" style="width:100%;padding:8px;background:#8b5cf6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">
          API呼び出し
        </button>
        <pre id="orcaApiResult" style="margin-top:8px;padding:8px;background:#111827;border-radius:4px;font-size:11px;max-height:300px;overflow:auto;white-space:pre-wrap;"></pre>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // CSS追加
  if (!document.getElementById('orcaStyles')) {
    const style = document.createElement('style');
    style.id = 'orcaStyles';
    style.textContent = `
      .orca-tab {
        padding: 4px 10px; border: 1px solid #4b5563; background: #2d2d44;
        color: #9ca3af; border-radius: 4px; cursor: pointer; font-size: 12px;
      }
      .orca-tab.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
      .orca-tab:hover { background: #374151; }
      .orca-tab.active:hover { background: #2563eb; }
      .orca-patient-row {
        padding: 8px; border: 1px solid #374151; border-radius: 4px; margin-bottom: 4px;
        cursor: pointer; transition: background 0.15s;
      }
      .orca-patient-row:hover { background: #2d2d44; }
      .orca-label { font-size: 11px; color: #9ca3af; }
      .orca-value { font-size: 13px; font-weight: 600; }
      .orca-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .orca-table th { background: #2d2d44; padding: 4px 8px; text-align: left; border: 1px solid #374151; }
      .orca-table td { padding: 4px 8px; border: 1px solid #374151; }
    `;
    document.head.appendChild(style);
  }
}

function toggleOrcaPanel() {
  const panel = document.getElementById('orcaPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function switchOrcaTab(tabName) {
  document.querySelectorAll('.orca-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.orca-tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById('orcaTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (target) target.style.display = 'block';
}

// --- 患者一覧 ---
async function orcaLoadPatients() {
  const div = document.getElementById('orcaPatientList');
  div.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:16px;">読み込み中...</div>';
  const result = await ORCA.getPatients();
  if (!result) {
    div.innerHTML = '<div style="color:#ef4444;text-align:center;padding:16px;">プロキシに接続できません。<br>orca_proxy.js を起動してください。</div>';
    return;
  }

  const patients = result.patients || [];
  const sourceLabel = result.source === 'api' ? '&#x1F4E1; API' : '&#x1F4CB; モック';
  const apiLabel = result.api_status === 'connected_empty' ? '（ORCA DB 空）' : result.api_status === 'connected' ? '' : '（ORCA未接続）';

  div.innerHTML = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">データソース: ${sourceLabel} ${apiLabel} / ${patients.length}件</div>`;
  patients.forEach(p => {
    const sex = p.Sex === '1' ? '男' : '女';
    const row = document.createElement('div');
    row.className = 'orca-patient-row';
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span class="orca-value">${esc(p.WholeName)}</span>
          <span class="orca-label" style="margin-left:8px;">${esc(p.WholeName_inKana)}</span>
        </div>
        <span style="font-size:12px;color:#60a5fa;">ID: ${esc(p.Patient_ID)}</span>
      </div>
      <div style="font-size:12px;color:#9ca3af;margin-top:2px;">
        ${esc(p.BirthDate)} / ${esc(sex)} / ${esc(p.Age)}歳 / ${esc(p.HealthInsurance?.InsuranceProvider_WholeName || '')} ${esc(p.HealthInsurance?.Rate_Outpatient || '')}%
      </div>
      ${p.Disease ? `<div style="font-size:11px;color:#f59e0b;margin-top:2px;">${p.Disease.map(d => esc(d.Disease_Name)).join(', ')}</div>` : ''}
    `;
    row.onclick = () => {
      document.getElementById('orcaMedicalPatientId').value = p.Patient_ID;
      document.getElementById('orcaReceiptPatientId').value = p.Patient_ID;
    };
    div.appendChild(row);
  });
}

// --- 診療行為 ---
async function orcaLoadMedical() {
  const id = document.getElementById('orcaMedicalPatientId').value.trim();
  if (!id) return;
  const div = document.getElementById('orcaMedicalResult');
  div.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:8px;">読み込み中...</div>';
  const result = await ORCA.getMedical(id);
  if (!result || result.error) {
    div.innerHTML = `<div style="color:#ef4444;">${esc(result?.error || '取得失敗')}</div>`;
    return;
  }
  const records = result.medical_records || [];
  let html = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">患者 ${esc(id)} / ${result.source}</div>`;
  records.forEach(rec => {
    html += `
      <div style="border:1px solid #374151;border-radius:4px;padding:8px;margin-bottom:4px;">
        <div style="font-size:12px;font-weight:600;color:#60a5fa;">${esc(rec.Perform_Date)} ${esc(rec.Department)}</div>
        <table class="orca-table" style="margin-top:4px;">
          <tr><th>項目</th><th>コード</th><th>点数</th></tr>
          ${rec.Items.map(i => `<tr><td>${esc(i.Name)}</td><td style="font-family:monospace;">${esc(i.Code)}</td><td style="text-align:right;">${esc(i.Point)}</td></tr>`).join('')}
        </table>
        <div style="text-align:right;margin-top:4px;font-size:13px;">
          合計 <strong>${esc(rec.Total_Point)}点</strong>
          / 患者負担 <strong style="color:#f59e0b;">&yen;${esc(String(rec.Patient_Burden))}</strong>
        </div>
      </div>
    `;
  });
  div.innerHTML = html;
}

// --- レセプト ---
async function orcaLoadReceipt() {
  const id = document.getElementById('orcaReceiptPatientId').value.trim();
  if (!id) return;
  const div = document.getElementById('orcaReceiptResult');
  div.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:8px;">読み込み中...</div>';
  const result = await ORCA.getReceipt(id);
  if (!result || result.error) {
    div.innerHTML = `<div style="color:#ef4444;">${esc(result?.error || '取得失敗')}</div>`;
    return;
  }
  const r = result.receipt;
  div.innerHTML = `
    <div style="border:1px solid #374151;border-radius:4px;padding:12px;">
      <div style="font-size:14px;font-weight:700;color:#60a5fa;margin-bottom:8px;">
        &#x1F4CB; レセプト概要 (${esc(r.Year_Month)})
      </div>
      <table class="orca-table">
        <tr><td class="orca-label">患者名</td><td>${esc(r.Patient_Name)}</td></tr>
        <tr><td class="orca-label">保険種別</td><td>${esc(r.Insurance)}</td></tr>
        <tr><td class="orca-label">負担割合</td><td>${esc(r.Rate)}</td></tr>
        <tr><td class="orca-label">合計点数</td><td><strong>${esc(r.Total_Point)}点</strong></td></tr>
        <tr><td class="orca-label">患者負担</td><td><strong style="color:#f59e0b;">&yen;${esc(String(r.Patient_Burden))}</strong></td></tr>
        <tr><td class="orca-label">受診回数</td><td>${esc(r.Visit_Count)}回</td></tr>
        <tr><td class="orca-label">傷病名</td><td>${(r.Diseases || []).map(d => esc(d)).join('<br>')}</td></tr>
      </table>
    </div>
  `;
}

// --- 傷病名検索 ---
async function orcaSearchDiseases() {
  const keyword = document.getElementById('orcaDiseaseKeyword').value.trim();
  const div = document.getElementById('orcaDiseaseResult');
  div.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:8px;">検索中...</div>';
  const result = await ORCA.searchDiseases(keyword);
  if (!result) {
    div.innerHTML = '<div style="color:#ef4444;">取得失敗</div>';
    return;
  }
  const diseases = result.diseases || [];
  let html = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${diseases.length}件</div>`;
  html += '<table class="orca-table"><tr><th>コード</th><th>傷病名</th></tr>';
  diseases.forEach(d => {
    html += `<tr><td style="font-family:monospace;">${esc(d.Code)}</td><td>${esc(d.Name)}</td></tr>`;
  });
  html += '</table>';
  div.innerHTML = html;
}

// --- 生API ---
async function orcaRawApiCall() {
  const endpoint = document.getElementById('orcaApiEndpoint').value.trim();
  const bodyText = document.getElementById('orcaApiBody').value.trim();
  const div = document.getElementById('orcaApiResult');
  div.textContent = '送信中...';
  try {
    const body = bodyText ? JSON.parse(bodyText) : {};
    const result = await ORCA.rawApi(endpoint, body);
    div.textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    div.textContent = 'エラー: ' + e.message;
  }
}

// --- カルテ画面内レセプト内訳表示 ---
function toggleOrcaReceiptSection() {
  const body = document.getElementById('orcaReceiptBody');
  const icon = document.getElementById('orcaReceiptCollapseIcon');
  if (!body) return;
  if (body.style.display === 'none') { body.style.display = ''; icon.innerHTML = '&#9660;'; }
  else { body.style.display = 'none'; icon.innerHTML = '&#9654;'; }
}

async function loadOrcaReceiptInline() {
  const div = document.getElementById('orcaReceiptInline');
  if (!div) return;
  // 現在開いているカルテの患者に対応するORCA患者IDを推定
  const p = typeof currentPatientId !== 'undefined' ? patients.find(x => x.id === currentPatientId) : null;
  if (!p) { div.innerHTML = '<div style="color:#ef4444;">患者が選択されていません</div>'; return; }

  div.innerHTML = '<div style="text-align:center;color:#aaa;padding:8px;">取得中...</div>';

  // ORCA IDマッピング（デモ: D001→00001, D002→00002...）
  const orcaId = p.id.replace('D', '').replace(/^0*/, '').padStart(5, '0');
  let medResult, receiptResult;

  if (ORCA.connected) {
    [medResult, receiptResult] = await Promise.all([
      ORCA.getMedical(orcaId),
      ORCA.getReceipt(orcaId)
    ]);
  }

  // プロキシ未接続 or データ取得失敗時はモックデータでフォールバック
  if (!medResult || medResult.error) {
    const mockInsurance = { 'D001': {name:'後期高齢者医療',rate:'10'}, 'D002': {name:'全国健康保険協会',rate:'30'}, 'D003': {name:'乳幼児医療',rate:'0'}, 'D004': {name:'国民健康保険',rate:'20'}, 'D005': {name:'全国健康保険協会',rate:'30'} };
    const mockDisease = { 'D001': '本態性高血圧症', 'D002': '2型糖尿病', 'D003': '急性上気道炎', 'D004': '変形性膝関節症', 'D005': '腰痛症' };
    const ins = mockInsurance[p.id] || {name:'社保',rate:'30'};
    const rate = parseInt(ins.rate);
    medResult = {
      source: 'mock', patient_id: orcaId,
      medical_records: [{
        Perform_Date: new Date().toISOString().split('T')[0], Department: '内科',
        Items: [
          { Name: '再診料', Code: '112007410', Point: '73' },
          { Name: '外来管理加算', Code: '112015670', Point: '52' },
          { Name: '処方箋料', Code: '120002270', Point: '68' }
        ],
        Total_Point: '193', Patient_Burden: Math.round(193 * 10 * rate / 100)
      }]
    };
    receiptResult = {
      source: 'mock', patient_id: orcaId,
      receipt: {
        Year_Month: '2026-06', Patient_Name: p.name, Insurance: ins.name,
        Rate: ins.rate + '%', Total_Point: '580',
        Patient_Burden: Math.round(580 * 10 * rate / 100),
        Visit_Count: '3', Diseases: [mockDisease[p.id] || '未登録']
      }
    };
  }

  let html = '';

  // 診療行為（点数内訳）
  if (medResult && !medResult.error) {
    const recs = medResult.medical_records || [];
    recs.forEach(function(rec) {
      html += '<div style="border:1px solid #ddd;border-radius:4px;padding:8px;margin-bottom:6px;background:#f8fafc;">';
      html += '<div style="font-weight:600;font-size:12px;color:#1e3a5f;margin-bottom:4px;">' + esc(rec.Perform_Date) + ' ' + esc(rec.Department) + '</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html += '<tr style="background:#e8ecf1;"><th style="padding:3px 6px;text-align:left;border:1px solid #ddd;">診療項目</th><th style="padding:3px 6px;text-align:left;border:1px solid #ddd;">コード</th><th style="padding:3px 6px;text-align:right;border:1px solid #ddd;">点数</th></tr>';
      (rec.Items || []).forEach(function(item) {
        html += '<tr><td style="padding:3px 6px;border:1px solid #ddd;">' + esc(item.Name) + '</td>';
        html += '<td style="padding:3px 6px;border:1px solid #ddd;font-family:monospace;font-size:10px;color:#666;">' + esc(item.Code) + '</td>';
        html += '<td style="padding:3px 6px;border:1px solid #ddd;text-align:right;font-weight:600;">' + esc(item.Point) + '</td></tr>';
      });
      html += '</table>';
      html += '<div style="text-align:right;margin-top:4px;font-size:12px;">合計 <b>' + esc(rec.Total_Point) + '点</b>（' + (rec.Total_Point * 10) + '円） / 患者負担 <b style="color:#dc2626;">&yen;' + esc(String(rec.Patient_Burden)) + '</b></div>';
      html += '</div>';
    });
  }

  // レセプト月次概要
  if (receiptResult && !receiptResult.error && receiptResult.receipt) {
    var r = receiptResult.receipt;
    html += '<div style="border:1px solid #3b82f6;border-radius:4px;padding:8px;margin-top:6px;background:#eff6ff;">';
    html += '<div style="font-weight:700;font-size:12px;color:#1e3a5f;margin-bottom:6px;">&#128203; 月次レセプト概要（' + esc(r.Year_Month) + '）</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<tr><td style="padding:3px 6px;color:#666;">保険種別</td><td style="padding:3px 6px;">' + esc(r.Insurance) + '（' + esc(r.Rate) + '）</td></tr>';
    html += '<tr><td style="padding:3px 6px;color:#666;">月間合計点数</td><td style="padding:3px 6px;font-weight:700;">' + esc(r.Total_Point) + '点</td></tr>';
    html += '<tr><td style="padding:3px 6px;color:#666;">患者負担合計</td><td style="padding:3px 6px;font-weight:700;color:#dc2626;">&yen;' + esc(String(r.Patient_Burden)) + '</td></tr>';
    html += '<tr><td style="padding:3px 6px;color:#666;">受診回数</td><td style="padding:3px 6px;">' + esc(r.Visit_Count) + '回</td></tr>';
    html += '<tr><td style="padding:3px 6px;color:#666;">傷病名</td><td style="padding:3px 6px;">' + (r.Diseases || []).map(function(d){ return esc(d); }).join(', ') + '</td></tr>';
    html += '</table>';
    html += '</div>';
  }

  if (!html) {
    html = '<div style="color:#f59e0b;text-align:center;padding:8px;">データ取得失敗（プロキシ未接続またはORCA未登録患者）</div>';
  }

  var srcLabel = ORCA.connected ? '&#x1F4E1; ORCA API' : '&#x1F4CB; モックデータ';
  div.innerHTML = '<div style="font-size:10px;color:#999;margin-bottom:4px;">データソース: ' + srcLabel + '</div>' + html;
}

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  createOrcaPanel();
  ORCA.checkConnection();
});
