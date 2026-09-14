// ===== 予約システム連携 (reservation_sync.js) — v19 =====
// 予約サイトで予約が入ると、DBトリガー（rsv2_sync_karte）が visits に
// 「来院予定」(status='reserved', rsv_code=予約番号) を作る。
// このモジュールはその来院予定を読み、患者一覧に「予約 HH:MM」として並べ、
// 受付ボタンで「待機」に進める（visits.status='waiting' / arrived_at）。
//
//   ・読み込み元: visits（rsv_code あり）＋ patients（patient_no 等）
//   ・患者一覧への合流: 既存患者（患者番号 or 氏名一致）に予約を付ける／無ければ行を作る
//   ・更新: 起動時・日付移動時・60秒ごと・「予約更新」ボタン
//   ※ 予約サイト側の状態（来院済）は DB トリガー（rsv2_visit_to_reservation）が追従する
(function () {
  const CLINIC_ID = 'nishiharu';
  const POLL_MS = 60 * 1000;
  let _rows = [];           // 最後に取得した来院予定（生データ）
  let _timer = null;
  let _loading = false;
  let _lastError = '';

  function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }
  function normName(s) { return String(s || '').replace(/[\s　]/g, ''); }
  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function calcAge(dob) {
    if (!dob) return null;
    const t = new Date(), b = new Date(dob);
    if (isNaN(b)) return null;
    let a = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a;
  }
  // visits.status → 画面の状態
  function toUiStatus(s) {
    return s === 'reserved' ? 'reserved' : s === 'in_progress' ? 'active' : s === 'done' ? 'done' : 'waiting';
  }

  async function fetchRows() {
    if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) return null;
    const from = new Date(); from.setDate(from.getDate() - 7);
    const fromIso = from.toISOString().split('T')[0];
    const { data, error } = await supabaseClient
      .from('visits')
      .select('id,clinic_id,patient_id,visit_date,visit_time,visit_type,status,arrived_at,rsv_code,department,' +
              'patients(patient_no,name,name_kana,dob,age,sex,phone,address,memo)')
      .eq('clinic_id', CLINIC_ID)
      .not('rsv_code', 'is', null)
      .gte('visit_date', fromIso)
      .order('visit_date').order('visit_time');
    if (error) throw new Error(error.message);
    return data || [];
  }

  function entryOf(r) {
    return {
      code: r.rsv_code, visitId: r.id, patientId: r.patient_id,
      date: r.visit_date, time: hhmm(r.visit_time), status: r.status || 'reserved',
      arrivedAt: hhmm(r.arrived_at), visitType: r.visit_type || '', department: r.department || ''
    };
  }

  // 取得済みの来院予定を patients 配列へ合流（何度呼んでも同じ結果になるように作る）
  function merge() {
    if (typeof patients === 'undefined') return;
    const seen = new Set();
    _rows.forEach(r => {
      const pt = r.patients || {};
      const pno = pt.patient_no || ('RSV-' + r.rsv_code);
      const e = entryOf(r);
      seen.add(e.code);
      // 1) 患者番号一致 → 2) 氏名一致（スプシ由来のDB患者は電話・生年月日を持たないため氏名で寄せる）
      let p = patients.find(x => x.id === pno);
      if (!p && pt.name) p = patients.find(x => normName(x.name) === normName(pt.name));
      if (!p) {
        p = {
          id: pno, name: pt.name || '(氏名未設定)', nameKana: pt.name_kana || '', dob: pt.dob || '',
          age: (typeof pt.age === 'number') ? pt.age : (calcAge(pt.dob) ?? ''),
          sex: (pt.sex || '').replace(/性$/, '') || '不明',
          insurance: '', ratio: 0.3, address: pt.address || '', phone: pt.phone || '',
          allergies: [], history: [], prevRx: [], prevDays: 0, prevVisitDate: '',
          vehicle: { plate: '---', lane: 0 }, status: toUiStatus(e.status), memo: pt.memo || '',
          insurancePhoto: null, insuranceNumber: '', questionnaire: null,
          arrivedAt: e.arrivedAt || e.time, visitDate: e.date, pastKartes: [], pastVitals: [],
          rsvSource: true, rsvVisits: []
        };
        patients.push(p);
        if (typeof karteData !== 'undefined' && !karteData[p.id]) {
          karteData[p.id] = { chiefComplaint: '', chiefComplaintSelect: '', findingsHtml: '', vitals: { t: '', bps: '', bpd: '', spo2: '', pulse: '' },
            selectedDiseases: [], prescriptions: [], rxDays: 7, isFirstVisit: e.visitType !== '再診', selectedExams: [], addedBillingItems: [], excludedBillingRows: {} };
        }
      }
      p.rsvVisits = p.rsvVisits || [];
      const i = p.rsvVisits.findIndex(v => v.code === e.code);
      if (i >= 0) p.rsvVisits[i] = e; else p.rsvVisits.push(e);
      // 予約由来で作った行は、その日の来院予定の状態を行の状態に反映する
      if (p.rsvSource && p.visitDate === e.date) {
        if (p.status === 'reserved' || e.status !== 'reserved') p.status = toUiStatus(e.status);
        if (e.arrivedAt) p.arrivedAt = e.arrivedAt; else if (p.status === 'reserved') p.arrivedAt = e.time;
      }
      // 電話・生年月日・カナが空なら予約側の情報で補う（スプシ由来の患者は大半が空）
      if (!p.phone && pt.phone) p.phone = pt.phone;
      if (!p.dob && pt.dob) p.dob = pt.dob;
      if (!p.nameKana && pt.name_kana) p.nameKana = pt.name_kana;
    });
    // 取消された予約（来院予定が消えた）を外す。予約由来の行で他に何も無ければ行ごと消す
    for (let k = patients.length - 1; k >= 0; k--) {
      const p = patients[k];
      if (!p.rsvVisits) continue;
      p.rsvVisits = p.rsvVisits.filter(v => seen.has(v.code) || v.date < todayIsoMinus7());
      if (p.rsvSource && p.rsvVisits.length === 0 && p.status === 'reserved') {
        patients.splice(k, 1);
        if (typeof karteData !== 'undefined') delete karteData[p.id];
      }
    }
  }
  function todayIsoMinus7() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; }

  async function load(manual) {
    if (_loading) return;
    _loading = true;
    try {
      const rows = await fetchRows();
      if (rows === null) return;   // 未接続
      _rows = rows;
      _lastError = '';
      merge();
      if (typeof renderPatientList === 'function') renderPatientList();
      if (manual && typeof showToast === 'function') showToast('予約を更新しました（' + rows.length + '件）');
    } catch (e) {
      _lastError = e.message || String(e);
      console.warn('[予約連携] 読込失敗:', _lastError);
      if (manual && typeof showToast === 'function') showToast('予約の読込に失敗: ' + _lastError);
    } finally {
      _loading = false;
    }
    if (!_timer) _timer = setInterval(() => load(false), POLL_MS);
  }

  // 指定日の予約（来院予定）を返す
  function visitFor(p, dateIso) {
    if (!p || !p.rsvVisits) return null;
    return p.rsvVisits.find(v => v.date === dateIso) || null;
  }
  // 状態バッジ（予約は琥珀・受付後は通常の状態バッジに戻す）
  function badgeHtml(p, dateIso) {
    const v = visitFor(p, dateIso);
    if (v && v.status === 'reserved') return '<span class="status-badge reserved" title="予約番号 ' + esc(v.code) + '">予約 ' + esc(v.time) + '</span>';
    return '';
  }
  function subHtml(p, dateIso) {
    const v = visitFor(p, dateIso);
    if (!v) return '';
    return ' / 予約 ' + esc(v.code) + (v.arrivedAt ? '（受付 ' + esc(v.arrivedAt) + '）' : '');
  }
  function arriveBtnHtml(p, dateIso) {
    const v = visitFor(p, dateIso);
    if (v && v.status === 'reserved') return '<button class="action-btn arrive-btn" onclick="event.stopPropagation();rsvArrive(\'' + esc(p.id) + '\')">受付</button>';
    return '';
  }

  // 受付: 来院予定を「待機」に進める（visits.status='waiting', arrived_at=今）
  async function arrive(patientId) {
    const p = patients.find(x => x.id === patientId);
    const v = visitFor(p, selectedDate);
    if (!p || !v) { showToast('この日の予約が見つかりません'); return; }
    if (typeof isSupabaseReady !== 'function' || !isSupabaseReady()) { showToast('DB未接続のため受付できません'); return; }
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const { data, error } = await supabaseClient.from('visits')
      .update({ status: 'waiting', arrived_at: hm + ':00' })
      .eq('id', v.visitId).eq('status', 'reserved').select('id');
    if (error) { showToast('受付に失敗: ' + error.message); return; }
    if (!data || !data.length) { showToast('すでに受付済みです'); await load(false); return; }
    v.status = 'waiting'; v.arrivedAt = hm;
    if (!p.dbSource) { p.status = 'waiting'; p.arrivedAt = hm; }
    renderPatientList();
    showToast(p.name + 'さんを受付しました（予約 ' + v.time + '）');
  }

  window.RsvSync = { load, remerge: merge, visitFor, badgeHtml, subHtml, arriveBtnHtml, rows: () => _rows, lastError: () => _lastError };
  window.rsvArrive = arrive;
})();
