// ====================================
// DigiMaster - API接続モジュール
// ====================================

function buildApiBases() {
  const bases = [];
  if (window.location.protocol !== 'file:') {
    bases.push(`${window.location.origin}/api/v1`);
  }
  bases.push(
    'http://localhost:18000/api/v1',
    'http://127.0.0.1:18000/api/v1'
  );
  return [...new Set(bases)];
}

const API_BASES = buildApiBases();
const API_BASE = API_BASES[0];
let activeApiBase = API_BASE;

function isNetworkFetchError(error) {
  return error instanceof TypeError && /fetch|network/i.test(error.message || '');
}

async function fetchWithApiFallback(endpoint, config) {
  const bases = [
    activeApiBase,
    ...API_BASES.filter(base => base !== activeApiBase)
  ];
  let lastError = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${endpoint}`, config);
      activeApiBase = base;
      return response;
    } catch (error) {
      lastError = error;
      if (!isNetworkFetchError(error)) {
        throw error;
      }
    }
  }

  console.error('API connection failed:', lastError);
  throw new Error('APIサーバーに接続できません。DigiMasterのサーバーを起動してから再度保存してください。');
}

// トークン管理
const TokenManager = {
  getAccessToken: () => sessionStorage.getItem('dm_access_token'),
  getRefreshToken: () => sessionStorage.getItem('dm_refresh_token'),

  setTokens: (access, refresh) => {
    sessionStorage.setItem('dm_access_token', access);
    sessionStorage.setItem('dm_refresh_token', refresh);
  },

  clearTokens: () => {
    sessionStorage.removeItem('dm_access_token');
    sessionStorage.removeItem('dm_refresh_token');
  },

  isLoggedIn: () => !!sessionStorage.getItem('dm_access_token')
};

// API通信ヘルパー
async function apiRequest(endpoint, options = {}) {
  const { skipAuth = false, skipRefresh = false, ...fetchOptions } = options;
  const token = TokenManager.getAccessToken();

  const config = {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      'X-DigiMaster-Development-Facility-Code': 'DEMO001',
      ...(!skipAuth && token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...fetchOptions.headers
    }
  };

  try {
    const response = await fetchWithApiFallback(endpoint, config);

    // トークン期限切れ
    if (response.status === 401 && !skipAuth && !skipRefresh && token) {
      const refreshed = await refreshToken();
      if (refreshed) {
        // リトライ
        config.headers['Authorization'] = `Bearer ${TokenManager.getAccessToken()}`;
        const retryResponse = await fetchWithApiFallback(endpoint, config);
        return handleResponse(retryResponse);
      } else {
        // ログアウト
        TokenManager.clearTokens();
        window.location.reload();
        throw new Error('セッションが切れました。再ログインしてください。');
      }
    }

    return handleResponse(response);
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

async function handleResponse(response) {
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const detail = data.detail;
    const errorMessage = typeof detail === 'string'
      ? detail
      : (detail?.message || data.message || 'エラーが発生しました');
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    error.detail = detail;
    throw error;
  }

  return data;
}

async function refreshToken() {
  const refreshToken = TokenManager.getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetchWithApiFallback('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (response.ok) {
      const data = await response.json();
      sessionStorage.setItem('dm_access_token', data.access_token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ====================================
// 認証API
// ====================================
const AuthAPI = {
  async getFacilityContext() {
    return apiRequest('/auth/facility-context', { skipAuth: true });
  },

  async login(loginId, password) {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login_id: loginId, password: password })
    });

    TokenManager.setTokens(data.access_token, data.refresh_token);
    sessionStorage.setItem('dm_currentUser', JSON.stringify(data.user));

    return data.user;
  },

  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', skipRefresh: true });
    } catch (e) {
      console.log('Logout API error:', e);
    }
    this.clearLocalSession();
  },

  clearLocalSession() {
    TokenManager.clearTokens();
    sessionStorage.removeItem('dm_currentUser');
  },

  getCurrentUser() {
    const user = sessionStorage.getItem('dm_currentUser');
    return user ? JSON.parse(user) : null;
  },

  isLoggedIn() {
    return TokenManager.isLoggedIn();
  },

  async me() {
    const user = await apiRequest('/auth/me', { skipRefresh: true });
    sessionStorage.setItem('dm_currentUser', JSON.stringify(user));
    return user;
  }
};

const FacilityUserAPI = {
  async list() {
    return apiRequest('/facility-users');
  },

  async create(payload) {
    return apiRequest('/facility-users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async update(userId, payload) {
    return apiRequest(`/facility-users/account/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  async history(userId) {
    return apiRequest(`/facility-users/account/${userId}/history`);
  },

  async setStatus(userId, isActive) {
    return apiRequest(`/facility-users/account/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ is_active: isActive })
    });
  },

  async resetPassword(userId, newPassword) {
    return apiRequest(`/facility-users/account/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword })
    });
  },

  async listCertificates() {
    return apiRequest('/facility-users/certificates/list');
  },

  async createCertificateIssueRequest(terminalName) {
    return apiRequest('/facility-users/certificates/issue-requests', {
      method: 'POST',
      body: JSON.stringify({ terminal_name: terminalName })
    });
  },

  async cancelCertificateIssueRequest(requestId) {
    return apiRequest(`/facility-users/certificates/issue-requests/${requestId}/cancel`, {
      method: 'POST'
    });
  },

  async revokeCertificate(certificateId) {
    return apiRequest(`/facility-users/certificates/${certificateId}/revoke`, {
      method: 'POST'
    });
  }
};

// ====================================
// 患者API
// ====================================
const PatientAPI = {
  async list(query = '', limit = 50, offset = 0) {
    let endpoint = `/patients?limit=${limit}&offset=${offset}`;
    if (query) {
      endpoint += `&q=${encodeURIComponent(query)}`;
    }
    return apiRequest(endpoint);
  },

  async get(patientId) {
    return apiRequest(`/patients/${patientId}`);
  },

  async create(patientData) {
    return apiRequest('/patients', {
      method: 'POST',
      body: JSON.stringify(patientData)
    });
  },

  async update(patientId, patientData) {
    return apiRequest(`/patients/${patientId}`, {
      method: 'PUT',
      body: JSON.stringify(patientData)
    });
  },

  async getClinicalProfile(patientId) {
    return apiRequest(`/patients/${patientId}/clinical-profile`);
  },

  async updateClinicalProfile(patientId, profile) {
    return apiRequest(`/patients/${patientId}/clinical-profile`, {
      method: 'PUT',
      body: JSON.stringify(profile || {})
    });
  },

  async listFiles(patientId) {
    return apiRequest(`/patients/${patientId}/files`);
  },

  async getFileStorageUsage() {
    return apiRequest('/patients/files/storage-usage');
  },

  async addFile(patientId, fileData) {
    return apiRequest(`/patients/${patientId}/files`, {
      method: 'POST',
      body: JSON.stringify(fileData)
    });
  },

  async updateFile(patientId, fileId, fileData) {
    return apiRequest(`/patients/${patientId}/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify(fileData)
    });
  },

  async deleteFile(patientId, fileId) {
    return apiRequest(`/patients/${patientId}/files/${fileId}`, {
      method: 'DELETE'
    });
  },

  async getPrescriptionHistory(patientId, limit = 200) {
    return apiRequest(`/patients/${patientId}/prescriptions?limit=${limit}`);
  },

  async delete(patientId) {
    return apiRequest(`/patients/${patientId}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// カルテAPI
// ====================================
const RecordAPI = {
  async list(patientId = null, limit = 50, offset = 0, params = {}) {
    if (limit && typeof limit === 'object') {
      params = limit;
      limit = params.limit || 50;
      offset = params.offset || 0;
    } else if (offset && typeof offset === 'object') {
      params = offset;
      offset = params.offset || 0;
    }

    const search = new URLSearchParams();
    search.set('limit', String(limit));
    search.set('offset', String(offset));
    if (patientId) {
      search.set('patient_id', patientId);
    }
    if (params.visit_date || params.visitDate) {
      search.set('visit_date', params.visit_date || params.visitDate);
    }
    if (params.status) {
      search.set('status', params.status);
    }
    if (params.reception_id || params.receptionId) {
      search.set('reception_id', params.reception_id || params.receptionId);
    }
    return apiRequest(`/records?${search.toString()}`);
  },

  async get(recordId, options = {}) {
    const includeDeleted = options.includeDeleted || options.include_deleted;
    const query = includeDeleted ? '?include_deleted=true' : '';
    return apiRequest(`/records/${recordId}${query}`);
  },

  async listDeleted(params = {}) {
    const search = new URLSearchParams();
    search.set('limit', params.limit || 50);
    search.set('offset', params.offset || 0);
    if (params.patient_id || params.patientId) {
      search.set('patient_id', params.patient_id || params.patientId);
    }
    if (params.visit_date || params.visitDate) {
      search.set('visit_date', params.visit_date || params.visitDate);
    }
    if (params.reception_id || params.receptionId) {
      search.set('reception_id', params.reception_id || params.receptionId);
    }
    return apiRequest(`/records/deleted?${search.toString()}`);
  },

  async create(recordData) {
    return apiRequest('/records', {
      method: 'POST',
      body: JSON.stringify(recordData)
    });
  },

  async save(recordData) {
    const saveRequest = {
      method: 'POST',
      body: JSON.stringify(recordData)
    };

    try {
      return await apiRequest('/records/save', saveRequest);
    } catch (error) {
      if (!this.isMethodNotAllowed(error)) throw error;
    }

    try {
      return await apiRequest('/records/save/', saveRequest);
    } catch (error) {
      if (!this.isMethodNotAllowed(error)) throw error;
      return this.saveWithLegacyEndpoints(recordData);
    }
  },

  isMethodNotAllowed(error) {
    return error?.status === 405 || error?.message === 'Method Not Allowed';
  },

  buildRecordOnlyPayload(recordData) {
    return {
      patient_id: recordData.patient_id,
      visit_date: recordData.visit_date,
      visit_type: recordData.visit_type,
      department: recordData.department,
      subjective: recordData.subjective,
      objective: recordData.objective,
      assessment: recordData.assessment,
      plan: recordData.plan,
      vital_signs: recordData.vital_signs || null
    };
  },

  async saveWithLegacyEndpoints(recordData) {
    const recordPayload = this.buildRecordOnlyPayload(recordData);
    const result = recordData.record_id
      ? await this.update(recordData.record_id, recordPayload)
      : await this.create(recordPayload);
    const recordId = result.id || recordData.record_id;

    for (const prescription of recordData.prescriptions || []) {
      await this.addPrescription(recordId, prescription);
    }

    for (const billing of recordData.billings || []) {
      await this.addBilling(recordId, billing);
    }

    await this.confirm(recordId);
    return { id: recordId, message: 'カルテを保存しました' };
  },

  async update(recordId, recordData) {
    return apiRequest(`/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify(recordData)
    });
  },

  async delete(recordId) {
    return apiRequest(`/records/${recordId}`, {
      method: 'DELETE'
    });
  },

  async restore(recordId) {
    return apiRequest(`/records/${recordId}/restore`, {
      method: 'POST'
    });
  },

  async versions(recordId) {
    return apiRequest(`/records/${recordId}/versions`);
  },

  async confirm(recordId) {
    return apiRequest(`/records/${recordId}/confirm`, {
      method: 'POST'
    });
  },

  async addPrescription(recordId, prescriptionData) {
    return apiRequest(`/records/${recordId}/prescriptions`, {
      method: 'POST',
      body: JSON.stringify(prescriptionData)
    });
  },

  async addBilling(recordId, billingData) {
    return apiRequest(`/records/${recordId}/billings`, {
      method: 'POST',
      body: JSON.stringify(billingData)
    });
  }
};

// ====================================
// 問診回答API
// ====================================
const QuestionnaireAPI = {
  async listResponsesByPatient(patientId) {
    return apiRequest(`/questionnaires/responses/by-patient/${patientId}`);
  }
};

// ====================================
// 受付API
// ====================================
const ReceptionAPI = {
  async list(receptionDate = null, status = null) {
    let endpoint = '/receptions?';
    const params = [];
    if (receptionDate) {
      params.push(`reception_date=${receptionDate}`);
    }
    if (status) {
      params.push(`status=${encodeURIComponent(status)}`);
    }
    return apiRequest(endpoint + params.join('&'));
  },

  async listMonthlyCounts() {
    return apiRequest('/receptions/monthly-counts');
  },

  async listEditHistory(receptionDate = null, limit = 100, offset = 0) {
    const params = new URLSearchParams();
    if (receptionDate) params.set('reception_date', receptionDate);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return apiRequest(`/receptions/edit-history?${params.toString()}`);
  },

  async getEditHistory(receptionId) {
    return apiRequest(`/receptions/edit-history/${receptionId}`);
  },

  async create(receptionData) {
    return apiRequest('/receptions', {
      method: 'POST',
      body: JSON.stringify(receptionData)
    });
  },

  async update(receptionId, updateData) {
    return apiRequest(`/receptions/${receptionId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
  },

  async delete(receptionId) {
    return apiRequest(`/receptions/${receptionId}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// 保険情報API
// ====================================
const InsuranceAPI = {
  async list(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async create(patientId, insuranceData) {
    return apiRequest(`/insurances/patient/${patientId}`, {
      method: 'POST',
      body: JSON.stringify(insuranceData)
    });
  },

  async update(insuranceId, insuranceData) {
    return apiRequest(`/insurances/${encodeURIComponent(insuranceId)}`, {
      method: 'PUT',
      body: JSON.stringify(insuranceData)
    });
  },

  async history(insuranceId) {
    return apiRequest(`/insurances/${encodeURIComponent(insuranceId)}/history`);
  },

  async delete(insuranceId, reason = '画面から削除') {
    const query = new URLSearchParams({ reason });
    return apiRequest(`/insurances/${encodeURIComponent(insuranceId)}?${query.toString()}`, {
      method: 'DELETE'
    });
  },

  async getTypes() {
    return apiRequest('/insurances/types');
  },

  async listPublicExpenses(patientId, activeOnly = true) {
    return apiRequest(`/insurances/patient/${patientId}/public-expenses?active_only=${activeOnly}`);
  },

  async createPublicExpense(patientId, expenseData) {
    return apiRequest(`/insurances/patient/${patientId}/public-expenses`, {
      method: 'POST',
      body: JSON.stringify(expenseData)
    });
  },

  async updatePublicExpense(expenseId, expenseData) {
    return apiRequest(`/insurances/public-expenses/${encodeURIComponent(expenseId)}`, {
      method: 'PUT',
      body: JSON.stringify(expenseData)
    });
  },

  async deletePublicExpense(expenseId, reason = '画面から削除') {
    const query = new URLSearchParams({ reason });
    return apiRequest(`/insurances/public-expenses/${encodeURIComponent(expenseId)}?${query.toString()}`, {
      method: 'DELETE'
    });
  },

  async getReceiptSpecialNoteTypes() {
    return apiRequest('/insurances/receipt-special-notes/types');
  },

  async listReceiptSpecialNotes(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-special-notes?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async createReceiptSpecialNote(patientId, noteData) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-special-notes`, {
      method: 'POST',
      body: JSON.stringify(noteData)
    });
  },

  async updateReceiptSpecialNote(noteId, noteData) {
    return apiRequest(`/insurances/receipt-special-notes/${encodeURIComponent(noteId)}`, {
      method: 'PUT',
      body: JSON.stringify(noteData)
    });
  },

  async getReceiptSymptomDetailTypes() {
    return apiRequest('/insurances/receipt-symptom-details/types');
  },

  async listReceiptSymptomDetails(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-symptom-details?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async createReceiptSymptomDetail(patientId, detailData) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-symptom-details`, {
      method: 'POST',
      body: JSON.stringify(detailData)
    });
  },

  async updateReceiptSymptomDetail(detailId, detailData) {
    return apiRequest(`/insurances/receipt-symptom-details/${encodeURIComponent(detailId)}`, {
      method: 'PUT',
      body: JSON.stringify(detailData)
    });
  },

  async listReceiptSummaryComments(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-summary-comments?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async createReceiptSummaryComment(patientId, commentData) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-summary-comments`, {
      method: 'POST',
      body: JSON.stringify(commentData)
    });
  },

  async updateReceiptSummaryComment(commentId, commentData) {
    return apiRequest(`/insurances/receipt-summary-comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT',
      body: JSON.stringify(commentData)
    });
  },

  async listWelfareInvoiceComments(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}/welfare-invoice-comments?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async createWelfareInvoiceComment(patientId, commentData) {
    return apiRequest(`/insurances/patient/${patientId}/welfare-invoice-comments`, {
      method: 'POST',
      body: JSON.stringify(commentData)
    });
  },

  async updateWelfareInvoiceComment(commentId, commentData) {
    return apiRequest(`/insurances/welfare-invoice-comments/${encodeURIComponent(commentId)}`, {
      method: 'PUT',
      body: JSON.stringify(commentData)
    });
  },

  async listReceiptCopayments(patientId, activeOnly = true, includeExpired = false) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-copayments?active_only=${activeOnly}&include_expired=${includeExpired}`);
  },

  async getReceiptCopaymentReference(patientId, validFrom, validUntil) {
    const query = new URLSearchParams({ valid_from: validFrom, valid_until: validUntil });
    return apiRequest(`/insurances/patient/${patientId}/receipt-copayments/reference?${query.toString()}`);
  },

  async createReceiptCopayment(patientId, copaymentData) {
    return apiRequest(`/insurances/patient/${patientId}/receipt-copayments`, {
      method: 'POST',
      body: JSON.stringify(copaymentData)
    });
  },

  async updateReceiptCopayment(copaymentId, copaymentData) {
    return apiRequest(`/insurances/receipt-copayments/${encodeURIComponent(copaymentId)}`, {
      method: 'PUT',
      body: JSON.stringify(copaymentData)
    });
  },

  async getPublicExpenseTypes() {
    return apiRequest('/insurances/public-expense-types');
  },

  async listPublicExpenseMunicipalityRules(options = {}) {
    const params = new URLSearchParams();
    if (options.prefecture_code) params.set('prefecture_code', options.prefecture_code);
    if (options.expense_type) params.set('expense_type', options.expense_type);
    if (options.municipality_code) params.set('municipality_code', options.municipality_code);
    if (options.q) params.set('q', options.q);
    const query = params.toString();
    return apiRequest(`/insurances/public-expense-municipality-rules${query ? `?${query}` : ''}`);
  },

  async getPublicExpenseDefaults(options = {}) {
    const params = new URLSearchParams();
    if (options.expense_type) params.set('expense_type', options.expense_type);
    if (options.municipality_rule_id) params.set('municipality_rule_id', options.municipality_rule_id);
    if (options.municipality_code) params.set('municipality_code', options.municipality_code);
    return apiRequest(`/insurances/public-expense-defaults?${params.toString()}`);
  }
};

// ====================================
// 処方API
// ====================================
const PrescriptionAPI = {
  async getDatedDrugPrice(code, serviceDate) {
    return apiRequest(`/records/drug-price/${encodeURIComponent(code)}?service_date=${encodeURIComponent(serviceDate)}`);
  },
  // 薬剤マスタ検索
  async searchDrugs(query, limit = 20) {
    const q = query || '';
    const data = await apiRequest(`/masters/drugs/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return { data };
  },

  // 薬剤マスタ詳細
  async getDrug(drugCode) {
    return apiRequest(`/masters/drugs/${encodeURIComponent(drugCode)}`);
  },

  // 一般名処方マスタ検索
  async searchGeneralPrescriptionMaster(query = '', options = {}) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options.code) params.set('code', options.code);
    params.set('limit', String(options.limit || 100));
    return apiRequest(`/masters/general-prescription-master?${params.toString()}`);
  },

  // 処方作成
  async create(recordId, prescriptionData) {
    return apiRequest(`/records/${recordId}/prescriptions`, {
      method: 'POST',
      body: JSON.stringify(prescriptionData)
    });
  },

  // Do処方（過去の処方を複製）
  async doPrescription(recordId, sourcePrescriptionId) {
    return apiRequest(`/records/${recordId}/prescriptions/do`, {
      method: 'POST',
      body: JSON.stringify({ source_prescription_id: sourcePrescriptionId })
    });
  },

  // 処方一覧取得
  async list(recordId) {
    return apiRequest(`/records/${recordId}/prescriptions`);
  },

  // 処方削除
  async delete(recordId, prescriptionId) {
    return apiRequest(`/records/${recordId}/prescriptions/${prescriptionId}`, {
      method: 'DELETE'
    });
  },

  // 患者の処方履歴を取得
  async getHistory(patientId, limit = 50) {
    return apiRequest(`/patients/${patientId}/prescriptions?limit=${limit}`);
  }
};

// ====================================
// 診療行為API
// ====================================
const RecordActionAPI = {
  // 診療行為マスタ検索
  async search(query, category = null, limit = 50) {
    const q = query || RecordActionAPI.getDefaultQueryForCategory(category);
    const data = await apiRequest(`/masters/actions/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return { data: RecordActionAPI.normalizeActions(data, category) };
  },

  // カテゴリ一覧取得
  async getCategories() {
    return { data: [] };
  },

  // セット一覧取得
  async getSets(facilityId = null) {
    const user = AuthAPI.getCurrentUser();
    const resolvedFacilityId = facilityId || user?.facility_id;
    if (!resolvedFacilityId) {
      return { data: [] };
    }

    const data = await apiRequest(`/record-actions/sets?facility_id=${resolvedFacilityId}`);
    return { data: RecordActionAPI.normalizeSets(data) };
  },

  // セット詳細取得
  async getSet(setId) {
    return apiRequest(`/record-actions/sets/${setId}`);
  },

  // セットをカルテに適用
  async applySet(setId, recordId) {
    return apiRequest(`/records/${recordId}/apply-set`, {
      method: 'POST',
      body: JSON.stringify({ set_id: setId })
    });
  },

  // カルテに診療行為を追加
  async addToRecord(recordId, actionData) {
    return apiRequest('/record-actions', {
      method: 'POST',
      body: JSON.stringify(actionData)
    });
  },

  // カルテから診療行為を削除
  async removeFromRecord(recordId, actionId) {
    return apiRequest(`/record-actions/${actionId}`, {
      method: 'DELETE'
    });
  },

  getDefaultQueryForCategory(category) {
    const queries = {
      exam: '初診',
      home: '在宅',
      medication: '処方',
      injection: '注射',
      treatment: '処置',
      surgery: '手術',
      anesthesia: '麻酔',
      test: '検査',
      imaging: '撮影',
      rehab: 'リハ',
      self_pay: '自費'
    };
    return queries[category] || '初診';
  },

  normalizeActions(actions, fallbackCategory = null) {
    const fallbackLabel = RecordActionAPI.getCategoryLabel(fallbackCategory);
    return (actions || []).map(action => {
      const hasScore = action.score !== undefined && action.score !== null && action.score !== ''
        || action.points !== undefined && action.points !== null && action.points !== '';
      return {
        id: action.id,
        code: action.action_code || action.code,
        name: action.name || action.action_name,
        points: hasScore ? Number(action.score ?? action.points) : 0,
        pointsMissing: !hasScore,
        category: action.category || action.category_name || fallbackLabel,
        raw: action
      };
    });
  },

  normalizeSets(sets) {
    return (sets || []).map(set => ({
      id: set.id,
      name: set.set_name || set.name,
      description: set.description,
      department: set.department,
      items: (set.items || []).map(item => ({
        name: item.action_name || item.name,
        actions: [item.action_name || item.name],
        action: {
          code: item.action_code,
          name: item.action_name,
          points: Number(item.unit_score ?? item.score ?? 0),
          quantity: Number(item.quantity || 1),
          category: item.category_name || item.category_code || '診察'
        }
      }))
    }));
  },

  getCategoryLabel(category) {
    const labels = {
      exam: '診察',
      home: '在宅',
      medication: '投薬',
      injection: '注射',
      treatment: '処置',
      surgery: '手術',
      anesthesia: '麻酔',
      test: '検査',
      imaging: '画像',
      rehab: 'リハ他',
      self_pay: '自費'
    };
    return labels[category] || '診察';
  },

  // 自費マスタ一覧を取得
  async getSelfPayMaster() {
    return apiRequest('/billings/self-pay/master');
  },

  // 自費マスタを作成・復活
  async createSelfPayMaster(item) {
    return apiRequest('/billings/self-pay/master', {
      method: 'POST',
      body: JSON.stringify(item)
    });
  },

  // 自費マスタを更新
  async updateSelfPayMaster(itemId, item) {
    return apiRequest(`/billings/self-pay/master/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(item)
    });
  },

  // 自費マスタを削除
  async deleteSelfPayMaster(itemId) {
    return apiRequest(`/billings/self-pay/master/${itemId}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// 施設別マスタ管理API
// ====================================
const FacilityMasterAPI = {
  async list(masterType, includeInactive = false) {
    const params = new URLSearchParams();
    if (includeInactive) params.set('include_inactive', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/masters/facility/${encodeURIComponent(masterType)}${suffix}`);
  },

  async searchReceiptCommentRequirements(query = '', options = {}) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options.tableKind) params.set('table_kind', options.tableKind);
    params.set('limit', String(options.limit || 100));
    return apiRequest(`/masters/receipt-comment-requirements?${params.toString()}`);
  },

  async searchReceiptRuleSourceDocuments(query = '', options = {}) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options.category) params.set('category', options.category);
    params.set('limit', String(options.limit || 100));
    return apiRequest(`/masters/receipt-rule-source-documents?${params.toString()}`);
  },

  async create(masterType, item) {
    return apiRequest(`/masters/facility/${encodeURIComponent(masterType)}`, {
      method: 'POST',
      body: JSON.stringify(item)
    });
  },

  async update(masterType, itemId, item) {
    return apiRequest(`/masters/facility/${encodeURIComponent(masterType)}/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: JSON.stringify(item)
    });
  },

  async delete(masterType, itemId) {
    return apiRequest(`/masters/facility/${encodeURIComponent(masterType)}/${encodeURIComponent(itemId)}`, {
      method: 'DELETE'
    });
  },

  async bulkImport(masterType, rows, replace = true) {
    return apiRequest(`/masters/facility/${encodeURIComponent(masterType)}/bulk-import`, {
      method: 'POST',
      body: JSON.stringify({ rows, replace })
    });
  },

  async listOfficialImportHistory(options = {}) {
    const params = new URLSearchParams();
    if (options.masterKey) params.set('master_key', options.masterKey);
    if (options.status) params.set('status', options.status);
    params.set('limit', String(options.limit || 50));
    return apiRequest(`/masters/official-imports/history?${params.toString()}`);
  },

  async listLatestOfficialImports() {
    return apiRequest('/masters/official-imports/latest');
  }
};

// ====================================
// 施設情報API
// ====================================
const FacilityAPI = {
  async getCurrent() {
    return apiRequest('/facilities/current');
  },

  async updateCurrent(facilityData) {
    return apiRequest('/facilities/current', {
      method: 'PUT',
      body: JSON.stringify(facilityData)
    });
  },

  async getAccidentSettings() {
    return apiRequest('/facilities/accident-settings');
  },

  async updateAccidentSettings(settings) {
    return apiRequest('/facilities/accident-settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async getSharedPassword() {
    return apiRequest('/facilities/shared-password');
  },

  async updateSharedPassword(password) {
    return apiRequest('/facilities/shared-password', {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
  },

  async getDataSubmissionSettings() {
    return apiRequest('/facilities/data-submission-settings');
  },

  async updateDataSubmissionSettings(settings) {
    return apiRequest('/facilities/data-submission-settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async getRmeNotificationSettings() {
    return apiRequest('/facilities/rme-notification-settings');
  },

  async updateRmeNotificationSettings(notifications) {
    return apiRequest('/facilities/rme-notification-settings', {
      method: 'PUT',
      body: JSON.stringify({ notifications })
    });
  },

  async getSettings() {
    return apiRequest('/facilities/settings');
  },

  async updateSettings(settings) {
    return apiRequest('/facilities/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings })
    });
  }
};

// ====================================
// 文書ひな形API
// ====================================
const DocumentTemplateAPI = {
  async list() {
    return apiRequest('/document-templates');
  },

  async create(templateData) {
    return apiRequest('/document-templates', {
      method: 'POST',
      body: JSON.stringify(templateData)
    });
  },

  async update(templateId, templateData) {
    return apiRequest(`/document-templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(templateData)
    });
  },

  async delete(templateId) {
    return apiRequest(`/document-templates/${templateId}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// カルテセットAPI
// ====================================
const KarteSetAPI = {
  async list(options = {}) {
    const params = new URLSearchParams();
    if (options.department) params.set('department', options.department);
    const query = params.toString();
    return apiRequest(`/karte-sets${query ? '?' + query : ''}`);
  },

  async create(setData) {
    return apiRequest('/karte-sets', {
      method: 'POST',
      body: JSON.stringify(setData)
    });
  },

  async update(setId, setData) {
    return apiRequest(`/karte-sets/${setId}`, {
      method: 'PUT',
      body: JSON.stringify(setData)
    });
  },

  async delete(setId) {
    return apiRequest(`/karte-sets/${setId}`, {
      method: 'DELETE'
    });
  },

  async markUsed(setId) {
    return apiRequest(`/karte-sets/${setId}/use`, {
      method: 'POST'
    });
  }
};

// ====================================
// 会計API
// ====================================
const BillingAPI = {
  // 会計計算
  async calculate(recordId) {
    return apiRequest(`/records/${recordId}/billing/calculate`, {
      method: 'POST'
    });
  },

  // 会計情報取得
  async get(billingId) {
    return apiRequest(`/billings/${billingId}`);
  },

  // 会計確定（患者負担0円など、入金処理が発生しない会計で使用）
  async confirm(billingId) {
    return apiRequest(`/billings/${billingId}/confirm`, {
      method: 'PATCH'
    });
  },

  // 会計作成
  async create(recordId, billingData) {
    return apiRequest(`/records/${recordId}/billing`, {
      method: 'POST',
      body: JSON.stringify(billingData)
    });
  },

  // 会計更新
  async update(billingId, billingData) {
    return apiRequest(`/billings/${billingId}`, {
      method: 'PUT',
      body: JSON.stringify(billingData)
    });
  },

  // 入金処理
  async createPayment(billingId, paymentData) {
    return apiRequest(`/billings/${billingId}/payments`, {
      method: 'POST',
      body: JSON.stringify(paymentData)
    });
  },

  // 入金履歴取得
  async getPayments(billingId) {
    return apiRequest(`/billings/${billingId}/payments`);
  },

  // 領収書発行
  async issueReceipt(billingId) {
    return apiRequest(`/billings/${billingId}/receipt`, {
      method: 'POST'
    });
  },

  // 明細書発行
  async issueStatement(billingId) {
    return apiRequest(`/billings/${billingId}/statement`, {
      method: 'POST'
    });
  },

  async createRefund(billingId, refundData) {
    return apiRequest(`/billings/${billingId}/refunds`, {
      method: 'POST',
      body: JSON.stringify(refundData)
    });
  },

  async getRefunds(billingId) {
    return apiRequest(`/billings/${billingId}/refunds`);
  },

  async createReceiptSplits(billingId, splitData) {
    return apiRequest(`/billings/${billingId}/receipt-splits`, {
      method: 'POST',
      body: JSON.stringify(splitData)
    });
  },

  async getReceiptSplits(billingId) {
    return apiRequest(`/billings/${billingId}/receipt-splits`);
  },

  async listUnpaidRecords(options = {}) {
    const params = new URLSearchParams();
    if (options.patientId) params.set('patient_id', options.patientId);
    if (options.facilityId) params.set('facility_id', options.facilityId);
    if (options.dateFrom) params.set('date_from', options.dateFrom);
    if (options.dateTo) params.set('date_to', options.dateTo);
    if (options.status) params.set('status', options.status);
    return apiRequest(`/billings/unpaid/list?${params.toString()}`);
  },

  async createMonthlyInvoice(invoiceData) {
    return apiRequest('/billings/monthly/invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData)
    });
  },

  async listMonthlyInvoices(options = {}) {
    const params = new URLSearchParams();
    if (options.facilityId) params.set('facility_id', options.facilityId);
    if (options.invoiceMonth) params.set('invoice_month', options.invoiceMonth);
    if (options.patientId) params.set('patient_id', options.patientId);
    if (options.status) params.set('status', options.status);
    return apiRequest(`/billings/monthly/invoices?${params.toString()}`);
  },

  async recalculateMonth(requestData) {
    return apiRequest('/billings/recalculate/month', {
      method: 'POST',
      body: JSON.stringify(requestData)
    });
  },

  async getPeriodStats(facilityId, dateFrom, dateTo) {
    const params = new URLSearchParams();
    params.set('facility_id', facilityId);
    params.set('date_from', dateFrom);
    params.set('date_to', dateTo);
    return apiRequest(`/billings/stats/period?${params.toString()}`);
  },

  async downloadBusinessReportZip(facilityId, dateFrom, dateTo) {
    const params = new URLSearchParams();
    params.set('facility_id', facilityId);
    params.set('date_from', dateFrom);
    params.set('date_to', dateTo);

    const buildConfig = () => {
      const token = TokenManager.getAccessToken();
      return {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      };
    };

    let response = await fetchWithApiFallback(
      `/billings/business-report/export?${params.toString()}`,
      buildConfig()
    );

    if (response.status === 401) {
      const refreshed = await refreshToken();
      if (refreshed) {
        response = await fetchWithApiFallback(
          `/billings/business-report/export?${params.toString()}`,
          buildConfig()
        );
      }
    }

    if (!response.ok) {
      await handleResponse(response);
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    const filename = encodedMatch
      ? decodeURIComponent(encodedMatch[1])
      : (plainMatch?.[1] || `business_report_${dateFrom.replaceAll('-', '')}_${dateTo.replaceAll('-', '')}.zip`);

    return {
      blob: await response.blob(),
      filename
    };
  }
};

// ====================================
// レセプト作成API
// ====================================
const ReceiptClaimAPI = {
  async recordPdf(recordId, options) {
    const params = new URLSearchParams({
      patient_id: options.patientId,
      visit_date: options.visitDate,
      claim_kind: options.claimKind || 'inspection'
    });
    const endpoint = `/receipt-claims/records/${encodeURIComponent(recordId)}/pdf?${params}`;
    const config = () => {
      const token = TokenManager.getAccessToken();
      return { method: 'GET', cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} };
    };
    let response = await fetchWithApiFallback(endpoint, config());
    if (response.status === 401 && await refreshToken()) {
      response = await fetchWithApiFallback(endpoint, config());
    }
    if (!response.ok) await handleResponse(response);
    if (!(response.headers.get('Content-Type') || '').includes('application/pdf')) {
      throw new Error('レセプトPDFを取得できませんでした');
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    return { blob: await response.blob(), filename: encodedName ? decodeURIComponent(encodedName) : 'レセプト.pdf' };
  },

  async preview(claimMonth, options = {}) {
    const params = new URLSearchParams();
    params.set('claim_month', claimMonth);
    params.set('claim_kind', options.claimKind || 'inspection');
    params.set('claim_category', options.claimCategory || 'medical');
    if (Array.isArray(options.payerGroups)) {
      params.set('payer_groups', options.payerGroups.join(','));
    }
    params.set('include_self_pay', options.includeSelfPay ? 'true' : 'false');
    params.set('include_draft', options.includeDraft === false ? 'false' : 'true');
    if (options.billDate) params.set('claim_date', options.billDate);
    return apiRequest(`/receipt-claims/preview?${params.toString()}`);
  },

  async create(payload) {
    return apiRequest('/receipt-claims/batches', {
      method: 'POST',
      body: JSON.stringify({
        claim_month: payload.claimMonth,
        claim_date: payload.billDate || null,
        claim_kind: payload.claimKind || 'inspection',
        claim_category: payload.claimCategory || 'medical',
        payer_groups: Array.isArray(payload.payerGroups) ? payload.payerGroups : [],
        include_self_pay: Boolean(payload.includeSelfPay),
        include_draft: payload.includeDraft === false ? false : true,
        review_confirmation: payload.reviewConfirmation || null
      })
    });
  },

  async updateBatchStatus(batchId, payload) {
    return apiRequest(`/receipt-claims/batches/${encodeURIComponent(batchId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: payload.status,
        note: payload.note || null
      })
    });
  },

  async previewReturn(payload) {
    return apiRequest('/receipt-claims/returns/preview', {
      method: 'POST',
      body: JSON.stringify({ filename: payload.filename || '', content: payload.content || '' })
    });
  },

  async importReturn(payload) {
    return apiRequest('/receipt-claims/returns/import', {
      method: 'POST',
      body: JSON.stringify({
        claim_month: payload.claimMonth || null,
        batch_id: payload.batchId || null,
        filename: payload.filename || '',
        content: payload.content || ''
      })
    });
  },

  async listReturns(limit = 20) {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return apiRequest(`/receipt-claims/returns?${params.toString()}`);
  },

  async updateRecordClaimType(recordId, claimType) {
    return apiRequest(`/receipt-claims/records/${encodeURIComponent(recordId)}/claim-type`, {
      method: 'PATCH',
      body: JSON.stringify({ receipt_claim_type: claimType })
    });
  },

  async updateBillingStatus(billingId, payload) {
    return apiRequest(`/receipt-claims/billings/${encodeURIComponent(billingId)}/claim-status`, {
      method: 'PATCH',
      body: JSON.stringify({
        claim_status: payload.claimStatus || payload.claim_status,
        note: payload.note || null,
        exclusion_confirmed: payload.exclusionConfirmed ?? payload.exclusion_confirmed
      })
    });
  },

  async updateReturnItemStatus(itemId, payload) {
    return apiRequest(`/receipt-claims/returns/items/${encodeURIComponent(itemId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        resubmit_status: payload.resubmitStatus || payload.resubmit_status,
        note: payload.note || null
      })
    });
  },

  async list(limit = 20) {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return apiRequest(`/receipt-claims/batches?${params.toString()}`);
  },

  async get(batchId) {
    return apiRequest(`/receipt-claims/batches/${encodeURIComponent(batchId)}`);
  },

  async download(batchId, { reviewCopy = false } = {}) {
    const path = `/receipt-claims/batches/${encodeURIComponent(batchId)}/download${reviewCopy ? '?review_copy=true' : ''}`;
    const buildConfig = () => {
      const token = TokenManager.getAccessToken();
      return {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      };
    };

    let response = await fetchWithApiFallback(
      path,
      buildConfig()
    );

    if (response.status === 401) {
      const refreshed = await refreshToken();
      if (refreshed) {
        response = await fetchWithApiFallback(
          path,
          buildConfig()
        );
      }
    }

    if (!response.ok) {
      await handleResponse(response);
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    const filename = encodedMatch
      ? decodeURIComponent(encodedMatch[1])
      : (plainMatch?.[1] || `receipt_claim_${new Date().toISOString().slice(0, 10)}.zip`);

    return {
      blob: await response.blob(),
      filename
    };
  }
};

// ====================================
// 自動算定API
// ====================================
const AutoCalculationAPI = {
  // 自動算定を実行
  async calculate(params) {
    return apiRequest('/auto-calculation', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  // 初診/再診判定
  async checkVisitType(patientId, visitDate, facilityId = null) {
    let endpoint = `/auto-calculation/visit-type/${patientId}?visit_date=${visitDate}`;
    if (facilityId) {
      endpoint += `&facility_id=${facilityId}`;
    }
    return apiRequest(endpoint);
  },

  // 時間外・休日・深夜判定
  async checkTimeCategory(visitDatetime, facilityId = null) {
    let endpoint = `/auto-calculation/time-category?visit_datetime=${encodeURIComponent(visitDatetime)}`;
    if (facilityId) {
      endpoint += `&facility_id=${facilityId}`;
    }
    return apiRequest(endpoint);
  },

  // 乳幼児判定
  async checkInfant(birthDate, visitDate) {
    return apiRequest(`/auto-calculation/infant-check?birth_date=${birthDate}&visit_date=${visitDate}`);
  },

  // 指導料チェック
  async checkGuidanceFee(patientId, visitDate, diagnoses) {
    return apiRequest('/auto-calculation/guidance-check', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: patientId,
        visit_date: visitDate,
        diagnoses: diagnoses
      })
    });
  },

  // 特定疾患マスタ取得
  async getSpecificDiseases() {
    return apiRequest('/auto-calculation/specific-diseases');
  },

  // 施設設定取得
  async getSettings(facilityId) {
    return apiRequest(`/auto-calculation/settings/${facilityId}`);
  },

  // 施設設定更新
  async updateSettings(facilityId, settings) {
    return apiRequest(`/auto-calculation/settings/${facilityId}`, {
      method: 'PUT',
      body: JSON.stringify({ settings: settings })
    });
  },

  // 設定初期化
  async initializeSettings(facilityId) {
    return apiRequest(`/auto-calculation/settings/${facilityId}/initialize`, {
      method: 'POST'
    });
  },

  // 施設の自動算定対象診療行為取得
  async getActions(facilityId, includeInactive = false) {
    const params = includeInactive ? '?include_inactive=true' : '';
    return apiRequest(`/auto-calculation/actions/${facilityId}${params}`);
  },

  // 標準自動算定対象診療行為の初期化
  async initializeStandardActions(facilityId) {
    return apiRequest(`/auto-calculation/actions/${facilityId}/initialize-standard`, {
      method: 'POST'
    });
  },

  // 施設の自動算定対象診療行為追加
  async createAction(facilityId, action) {
    return apiRequest(`/auto-calculation/actions/${facilityId}`, {
      method: 'POST',
      body: JSON.stringify(action)
    });
  },

  // 施設の自動算定対象診療行為更新
  async updateAction(facilityId, actionId, action) {
    return apiRequest(`/auto-calculation/actions/${facilityId}/${actionId}`, {
      method: 'PUT',
      body: JSON.stringify(action)
    });
  },

  // 施設の自動算定対象診療行為削除
  async deleteAction(facilityId, actionId) {
    return apiRequest(`/auto-calculation/actions/${facilityId}/${actionId}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// 傷病名API
// ====================================
const DiagnosisAPI = {
  async searchMaster(query, limit = 50) {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', String(limit));
    params.set('active_only', 'true');
    return apiRequest(`/diagnoses/master/search?${params.toString()}`);
  },

  async listByPatient(patientId, options = {}) {
    const params = new URLSearchParams();
    params.set('active_only', options.activeOnly === false ? 'false' : 'true');
    params.set('include_ended', options.includeEnded === true ? 'true' : 'false');
    if (options.category) {
      params.set('category', options.category);
    }
    return apiRequest(`/diagnoses/patient/${patientId}?${params.toString()}`);
  },

  async listByRecord(recordId) {
    return apiRequest(`/diagnoses/record/${recordId}`);
  },

  async create(payload) {
    return apiRequest('/diagnoses/', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async update(diagnosisId, payload) {
    return apiRequest(`/diagnoses/${diagnosisId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  async versions(diagnosisId) {
    return apiRequest(`/diagnoses/${diagnosisId}/versions`);
  },

  async remove(diagnosisId, reason = '画面から削除') {
    const params = new URLSearchParams();
    params.set('reason', reason);
    return apiRequest(`/diagnoses/${diagnosisId}?${params.toString()}`, {
      method: 'DELETE'
    });
  }
};

// ====================================
// 算定チェックAPI
// ====================================
const CalculationsAPI = {
  // 診療行為チェック（既存）
  async checkActions(patientId, actionCodes, birthDate, gender) {
    return apiRequest('/calculations/check/actions', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: patientId,
        action_codes: actionCodes,
        birth_date: birthDate,
        gender: gender
      })
    });
  },

  // リアルタイムチェック（新規）
  async checkRealtime(params) {
    return apiRequest('/calculations/check/realtime', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  // 薬剤相互作用チェック
  async checkDrugInteraction(drugCodes, options = {}) {
    return apiRequest('/calculations/check/drug-interaction', {
      method: 'POST',
      body: JSON.stringify({
        drug_codes: drugCodes,
        patient_id: options.patient_id || options.patientId || null,
        drugs: options.drugs || []
      })
    });
  },

  // 投与日数チェック
  async checkDrugDuration(drugs) {
    return apiRequest('/calculations/check/drug-duration', {
      method: 'POST',
      body: JSON.stringify({ drugs: drugs })
    });
  },

  // 用量チェック
  async checkDosage(drugCode, drugName, doseQuantity, doseUnit, dosePer = 'per_day') {
    return apiRequest('/calculations/check/dosage', {
      method: 'POST',
      body: JSON.stringify({
        drug_code: drugCode,
        drug_name: drugName,
        dose_quantity: doseQuantity,
        dose_unit: doseUnit,
        dose_per: dosePer
      })
    });
  },

  // 算定ルール一覧取得
  async getRules(category = null) {
    let endpoint = '/calculations/rules';
    if (category) {
      endpoint += `?category=${encodeURIComponent(category)}`;
    }
    return apiRequest(endpoint);
  },

  // 薬剤ルール一覧取得
  async getDrugRules(ruleType = null) {
    let endpoint = '/calculations/drug-rules';
    if (ruleType) {
      endpoint += `?rule_type=${encodeURIComponent(ruleType)}`;
    }
    return apiRequest(endpoint);
  },

  // 処方チェック
  async checkPrescription(prescriptionId, patientId, birthDate) {
    return apiRequest('/calculations/check/prescription', {
      method: 'POST',
      body: JSON.stringify({
        prescription_id: prescriptionId,
        patient_id: patientId,
        birth_date: birthDate
      })
    });
  }
};

// ====================================
// 施設警告設定API
// ====================================
const FacilityWarningAPI = {
  // 警告設定一覧取得
  async getWarnings(facilityId) {
    return apiRequest(`/facility-warnings/${facilityId}`);
  },

  // 警告設定作成
  async createWarning(facilityId, warningData) {
    return apiRequest(`/facility-warnings/${facilityId}`, {
      method: 'POST',
      body: JSON.stringify(warningData)
    });
  },

  // 警告設定更新
  async updateWarning(facilityId, warningId, warningData) {
    return apiRequest(`/facility-warnings/${facilityId}/${warningId}`, {
      method: 'PUT',
      body: JSON.stringify(warningData)
    });
  },

  // 警告設定削除
  async deleteWarning(facilityId, warningId) {
    return apiRequest(`/facility-warnings/${facilityId}/${warningId}`, {
      method: 'DELETE'
    });
  },

  // デフォルト設定初期化
  async initializeDefaults(facilityId) {
    return apiRequest(`/facility-warnings/${facilityId}/initialize`, {
      method: 'POST'
    });
  },

  // 警告履歴取得
  async getWarningLogs(facilityId, params = {}) {
    const queryParams = new URLSearchParams();
    if (params.patientId) queryParams.set('patient_id', params.patientId);
    if (params.from) queryParams.set('from', params.from);
    if (params.to) queryParams.set('to', params.to);
    if (params.limit) queryParams.set('limit', params.limit);

    const query = queryParams.toString();
    return apiRequest(`/facility-warnings/${facilityId}/logs${query ? '?' + query : ''}`);
  }
};

// ====================================
// 監査ログAPI
// ====================================
const AuditLogAPI = {
  async list(params = {}) {
    const queryParams = new URLSearchParams();
    if (params.startDate) queryParams.set('start_date', params.startDate);
    if (params.endDate) queryParams.set('end_date', params.endDate);
    if (params.userId) queryParams.set('user_id', params.userId);
    if (params.resourceType) queryParams.set('resource_type', params.resourceType);
    if (params.resourceId) queryParams.set('resource_id', params.resourceId);
    if (params.action) queryParams.set('action', params.action);
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.offset) queryParams.set('offset', String(params.offset));

    const query = queryParams.toString();
    return apiRequest(`/audit-logs${query ? '?' + query : ''}`);
  }
};

// グローバルに公開
window.AuthAPI = AuthAPI;
window.FacilityUserAPI = FacilityUserAPI;
window.PatientAPI = PatientAPI;
window.RecordAPI = RecordAPI;
window.DiagnosisAPI = DiagnosisAPI;
window.QuestionnaireAPI = QuestionnaireAPI;
window.ReceptionAPI = ReceptionAPI;
window.InsuranceAPI = InsuranceAPI;
window.PrescriptionAPI = PrescriptionAPI;
window.RecordActionAPI = RecordActionAPI;
window.KarteSetAPI = KarteSetAPI;
window.BillingAPI = BillingAPI;
window.ReceiptClaimAPI = ReceiptClaimAPI;
window.AutoCalculationAPI = AutoCalculationAPI;
window.CalculationsAPI = CalculationsAPI;
window.FacilityAPI = FacilityAPI;
window.FacilityMasterAPI = FacilityMasterAPI;
window.DocumentTemplateAPI = DocumentTemplateAPI;
window.FacilityWarningAPI = FacilityWarningAPI;
window.AuditLogAPI = AuditLogAPI;
window.TokenManager = TokenManager;
