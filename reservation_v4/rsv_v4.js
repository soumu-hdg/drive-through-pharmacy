/* =============================================================
   予約サイト v4 ── 画面処理（手で書いたファイル。tools/build_prototype4.py は作らない・消さない）
   -------------------------------------------------------------
   ・見た目と部品は基準版（index.html / styles.css の step0〜4・完了・下部ナビ・同意書のポップアップ）をそのまま使う
   ・予約の流れと保存は統合版（store.js ＝ prototype3 と同じ表・同じ列。DB トリガーがカルテの患者・来院予定を作る）
       院 → 診療科（院ごとの区分）→ 施術・日時 → 受診者情報（ログインなしで入力）→ 確認 → 完了
   ・端末に個人情報を残さない: localStorage / sessionStorage / IndexedDB / Cookie を使わない。
     入力はこの画面のメモリだけに持ち、予約が終わったら消す。LINE の SDK は連携を押したときだけ読む
   ・テスト用クリニック（cs_id 9x）は URL が ?clinic=test のときだけ一覧に出す（患者向けの画面には出さない）
   ============================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const params = new URLSearchParams(location.search);
  const TEST_MODE = params.get("clinic") === "test";

  /* ---------- テスト用クリニック（?clinic=test のときだけ）----------
     cs_id の十の位 9 は DB の院の対応（rsv2_karte_clinic_id）で 'test' になる＝予約はテスト院のカルテにだけ入る */
  if (TEST_MODE && !Store.CLINICS.some((c) => c.id === 9)) {
    Store.CLINICS.unshift({ id: 9, name: "テスト用", area: "テスト", test: true,
      address: "（確認用の架空の院・患者向けの画面には出ません）", phone: "000-0000-0000",
      services: [{ id: 91, name: "外来" }, { id: 92, name: "在宅" }, { id: 93, name: "美容" }, { id: 94, name: "夜間休日" }] });
  }

  /* 同意文面の版。文面を変えたら必ず上げる（いつ何に同意したかを後から辿れるように）。prototype3 と同じ版・同じ文面 */
  const CONSENT_VERSION = "2026-08-13";
  const LIFF_ID = "2008141336-KokioNBq";
  const OA_ADD_URL = "https://line.me/R/ti/p/@584zdybj";
  const DOC_LABEL = { insurance: "保険証", iryo: "医療証" };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];

  /* ---------- 画面の状態（メモリだけ）---------- */
  const st = { page: "gate", step: 0, clinicId: null, csId: null, menuId: null, concern: "すべて", week: 0,
               date: null, time: null, slotId: null, done: null, formErr: "" };
  let form = null, consentAt = null, lineUser = null;
  let pendingDocs = { insurance: null, iryo: null };
  const blankForm = () => ({ name: "", kana: "", birthDate: "", phone: "", email: "", visitType: "", note: "", staffId: "", consent: false });

  /* ---------- 日付 ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const dispDate = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  const nowHHMM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
  const isPastSlot = (date, time) => date < Store.todayStr() || (date === Store.todayStr() && time <= nowHHMM());
  const selectable = (date, s) => s.open && s.remaining > 0 && !isPastSlot(date, s.time);
  function weekDates(offset) {                      // 基準版と同じ「日曜はじまりの週」
    const t = new Date(); const s = new Date(t); s.setDate(t.getDate() - t.getDay() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return ymd(d); });
  }
  const MAX_WEEK = 4;

  /* ---------- 院・区分・メニュー ---------- */
  // 表示は院の正式名称（電子カルテの院の一覧と同じ）。無ければ「〇〇クリニック」
  const OFFICIAL = { 1: "西春内科・在宅クリニック", 2: "横浜内科・在宅クリニック", 3: "千葉内科在宅・美容皮膚科クリニック", 4: "中川在宅・夜間休日クリニック" };
  const clinicName = (c) => c ? (OFFICIAL[c.id] || `${c.name}クリニック`) : "";
  const clinicsShown = () => Store.CLINICS.filter((c) => TEST_MODE ? true : !c.test);
  const svcLabel = (s) => s ? (s.name === "美容" ? "美容皮膚科" : s.name === "夜間休日" ? "夜間休日外来" : s.name) : "";
  const staffList = () => { const c = Store.clinicOfCs(st.csId); return c ? Store.resourcesOf(c.id, "staff") : []; };
  const staffNameOf = (id) => { const s = staffList().find((x) => String(x.id) === String(id)); return s ? s.name : ""; };
  function priceText(m) {
    if (!m) return "";
    if (m.firstVisitPrice != null) return `初回 ¥${Number(m.firstVisitPrice).toLocaleString()}`;
    if (m.price != null) return `¥${Number(m.price).toLocaleString()}〜`;
    return "要問合せ";
  }
  function menuImage(m) {
    const n = (m && m.name) || "";
    if (/ボトックス/.test(n)) return "assets/treatments/botox.svg";
    if (/IPL|光治療/.test(n)) return "assets/treatments/ipl.svg";
    if (/カウンセリング/.test(n)) return "assets/treatments/beauty-counseling.svg";
    return "";
  }
  const THEMES = ["gold", "rose", "aqua", "violet", "green", "blue", "pink", "mint", "indigo", "slate"];

  /* ---------- 失敗の伝え方（prototype3 と同じ区別。保存できなければ完了を出さない）---------- */
  const PATIENT_MSG = {
    DUPLICATE: "申し訳ありません。ちょうど今、別の方が同じ時間帯を予約されました。お手数ですが別の時間をお選びください。",
    FAILED: "ただ今、予約を受け付けできませんでした。お手数ですが、しばらく経ってからもう一度お試しいただくか、お電話でご連絡ください。",
    CANCEL: "ただ今、キャンセルの手続きができませんでした。お手数ですが、しばらく経ってからもう一度お試しいただくか、お電話でご連絡ください。",
  };
  function patientMsg(res, key) {
    if (res && res.reason === "DUPLICATE") return PATIENT_MSG.DUPLICATE;
    if (res && ["OFFLINE", "NETWORK", "DB", "COL_MISSING"].includes(res.reason)) return PATIENT_MSG[key || "FAILED"];
    return (res && res.error) || PATIENT_MSG[key || "FAILED"];   // 休診・満員などの事前チェックはその文言のまま
  }

  /* =============================================================
     ページ（基準版の下部ナビ 4 つ）と入口
     ============================================================= */
  function enterApp(page) {
    $("authGate").classList.add("hidden");
    $("appMain").classList.remove("hidden");
    $("bottomNav").classList.remove("hidden");
    switchPage(page);
  }
  function switchPage(page) {
    st.page = page;
    document.querySelectorAll(".page").forEach((p) => { p.classList.add("hidden"); p.classList.remove("active"); });
    const t = $("page-" + page); if (t) { t.classList.remove("hidden"); t.classList.add("active"); }
    document.querySelectorAll(".bottom-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    if (page === "reservation" && st.step === 0) renderClinics();
    if (page === "settings") renderSettings();
    window.scrollTo(0, 0);
  }

  /* 基準版の showStep と同じ見せ方（0=院の選択は段の表示なし、5=完了） */
  function showStep(n) {
    st.step = n;
    const steps = $("reservationSteps");
    steps.classList.toggle("hidden", n === 0);
    if (n > 0) {
      const top = Math.min(Math.max(n, 1), 4);
      steps.querySelectorAll(".step").forEach((el) => {
        const v = Number(el.dataset.step);
        el.classList.remove("active", "completed"); el.removeAttribute("aria-current");
        if (v < top) el.classList.add("completed");
        else if (v === top) { el.classList.add("active"); el.setAttribute("aria-current", "step"); }
      });
    }
    ["step0", "step1", "step2", "step3", "step4", "stepComplete"].forEach((id) => $(id).classList.add("hidden"));
    $(n === 5 ? "stepComplete" : "step" + n).classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  /* ---------- 接続できないときの帯（受け付けられないことを最初から知らせる）---------- */
  function renderConn() {
    const off = Store.isOffline();
    const msg = "ただ今、予約システムに接続できておりません。恐れ入りますが、しばらく経ってからもう一度お試しいただくか、お電話でご連絡ください。";
    [$("connBar"), $("connBar2")].forEach((el) => { if (!el) return; el.textContent = off ? msg : ""; el.classList.toggle("hidden", !off); });
  }

  /* =============================================================
     Step 0: 院の選択（基準版の clinic-card）
     ============================================================= */
  function renderClinics() {
    const list = $("clinicList");
    const cs = clinicsShown();
    $("clinicEmpty").classList.toggle("hidden", cs.length > 0);
    list.innerHTML = cs.map((c) => `
      <button class="clinic-card ${c.openingNote ? "rsv4-preparing" : ""}" type="button" data-id="${c.id}">
        <span class="clinic-card-icon"><i class="fas fa-hospital"></i></span>
        <span class="clinic-card-content">
          <span class="clinic-card-name">${esc(clinicName(c))}</span>
          <span class="rsv4-clinic-sub">${esc(c.address)}</span>
          <span class="rsv4-clinic-svcs">${esc(c.services.map(svcLabel).join("・"))}</span>
          ${c.openingNote ? `<span class="rsv4-badge">${esc(c.openingNote)}・準備中</span>` : ""}
        </span>
        <span class="clinic-card-arrow"><i class="fas fa-chevron-right"></i></span>
      </button>`).join("");
    list.querySelectorAll(".clinic-card").forEach((b) => b.addEventListener("click", () => selectClinic(Number(b.dataset.id))));
  }
  function selectClinic(id) {
    const c = Store.CLINICS.find((x) => x.id === id); if (!c) return;
    Object.assign(st, { clinicId: id, csId: null, menuId: null, date: null, time: null, slotId: null, week: 0, concern: "すべて" });
    $("clinicName").textContent = clinicName(c);
    $("upcomingReservations").classList.add("hidden");
    const dl = $("departmentList");
    dl.innerHTML = c.services.map((s) => c.openingNote
      ? `<button class="department-card rsv4-preparing" type="button" disabled data-id="${s.id}"><span class="department-name">${esc(svcLabel(s))}（準備中）</span></button>`
      : `<button class="department-card" type="button" data-id="${s.id}"><span class="department-name">${esc(svcLabel(s))}</span></button>`).join("")
      + (c.openingNote ? `<p class="rsv4-note">${esc(clinicName(c))}は${esc(c.openingNote)}です。開業後にご予約いただけます。</p>` : "");
    dl.querySelectorAll(".department-card:not([disabled])").forEach((b) => b.addEventListener("click", () => selectService(Number(b.dataset.id))));
    showStep(1);
  }

  /* =============================================================
     Step 2: 施術・日時（基準版の treatment-menu-card と週の表）
     ============================================================= */
  function selectService(csId) {
    Object.assign(st, { csId, menuId: null, date: null, time: null, slotId: null, week: 0, concern: "すべて" });
    $("departmentList").querySelectorAll(".department-card").forEach((b) => b.classList.toggle("active", Number(b.dataset.id) === csId));
    showStep(2);
    renderStep2();
  }
  function setTimeSelectionVisible(v) {
    document.querySelector(".calendar-nav").classList.toggle("hidden", !v);
    document.querySelector(".calendar-table-wrap").classList.toggle("hidden", !v);
    $("timeSlots").classList.toggle("hidden", !v);
    const e = $("rsvEarliest"); if (e) e.classList.toggle("hidden", !v || !e.innerHTML);
    const lg = $("rsvLegend"); if (lg) lg.classList.toggle("hidden", !v);
  }
  function ensureStep2Parts() {
    const nav = document.querySelector(".calendar-nav");
    if (!$("rsvEarliest")) nav.insertAdjacentHTML("beforebegin", '<div class="rsv4-earliest hidden" id="rsvEarliest"></div>');
    if (!$("rsvLegend")) document.querySelector(".calendar-table-wrap").insertAdjacentHTML("afterend",
      '<p class="rsv4-legend" id="rsvLegend"><span><b class="m-ok">○</b>空きあり</span><span><b class="m-few">△</b>残りわずか</span><span><b class="m-full">×</b>満席</span><span><b>−</b>受付できません</span><span><b class="m-closed">休</b>休診</span></p>');
    if (!$("connBar2")) $("reservationSteps").insertAdjacentHTML("beforebegin", '<p class="rsv4-conn hidden" id="connBar2" role="alert"></p>');
  }
  const MENU_FILTERS = [
    { label: "すべて", kw: null }, { label: "毛穴・ニキビ跡", kw: ["毛穴", "ニキビ"] }, { label: "シミ・そばかす", kw: ["シミ", "そばかす", "赤み"] },
    { label: "たるみ", kw: ["たるみ", "フェイスライン"] }, { label: "小じわ・ハリ", kw: ["小じわ", "ハリ"] },
  ];
  function renderStep2() {
    ensureStep2Parts();
    const svc = Store.serviceOfCs(st.csId);
    const menus = Store.menusOfCs(st.csId);
    const menu = st.menuId ? Store.menuById(st.menuId) : null;
    $("selectedDepartment").textContent = `診療科: ${svcLabel(svc)}${menu ? " / メニュー: " + menu.name : ""}`;
    const panel = document.querySelector(".treatment-menu-panel");
    $("treatmentDetailPanel").classList.add("hidden");       // 細かい施術の2段目は基準版だけ（統合版のメニュー台帳は1段）
    panel.classList.toggle("hidden", !menus.length);
    if (menus.length) {
      const filters = MENU_FILTERS.filter((f) => !f.kw || menus.some((m) => f.kw.some((k) => (m.concerns || "").includes(k))));
      $("treatmentConcernTabs").innerHTML = filters.map((f) => `<button type="button" class="treatment-concern-tab ${st.concern === f.label ? "active" : ""}" data-concern="${esc(f.label)}" aria-pressed="${st.concern === f.label}">${esc(f.label)}</button>`).join("");
      $("treatmentConcernTabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st.concern = b.dataset.concern; renderStep2(); }));
      const kw = (filters.find((f) => f.label === st.concern) || {}).kw;
      const shown = [...(kw ? menus.filter((m) => kw.some((k) => (m.concerns || "").includes(k))) : menus)].sort((a, b) => Number(!!b.popular) - Number(!!a.popular));
      const earliest = earliestSlot();
      $("treatmentMenuList").innerHTML = shown.length ? shown.map((m, i) => {
        const img = menuImage(m);
        const tags = (m.concerns || "").split(/[・、,]/).filter(Boolean).slice(0, 4);
        const badges = [m.popular ? "人気" : "", m.firstVisitPrice != null ? "初回価格" : ""].filter(Boolean);
        const price = m.firstVisitPrice != null ? `¥${Number(m.firstVisitPrice).toLocaleString()}` : m.price != null ? `¥${Number(m.price).toLocaleString()}〜` : "要問合せ";
        const sub = m.firstVisitPrice != null ? `初回価格／通常 ¥${Number(m.price || 0).toLocaleString()}〜` : "";
        const detail = [m.downtime ? `ダウンタイム: ${m.downtime}` : "", m.staffType ? `施術担当: ${m.staffType}` : ""].filter(Boolean).join("　");
        return `<div class="treatment-menu-card ${Number(st.menuId) === Number(m.id) ? "active" : ""}" data-menu-id="${m.id}">
          <span class="treatment-menu-visual treatment-menu-visual--${THEMES[i % THEMES.length]} ${img ? "has-image" : ""}" ${img ? `style="background-image:linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0.08)), url('${img}')"` : ""}>
            <span class="treatment-menu-badges">${badges.map((b) => `<span>${esc(b)}</span>`).join("")}</span>
          </span>
          <span class="treatment-menu-main">
            <span class="treatment-menu-name">${esc(m.name)}</span>
            <span class="treatment-menu-lead">${esc(m.catch || "")}</span>
            <span class="treatment-menu-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</span>
            ${detail ? `<span class="treatment-menu-detail">${esc(detail)}</span>` : ""}
          </span>
          <span class="treatment-menu-side">
            <span class="treatment-menu-price">${esc(price)}${/¥/.test(price) ? "<small>（税込）</small>" : ""}</span>
            ${sub ? `<span class="treatment-menu-price-note">${esc(sub)}</span>` : ""}
            <span class="treatment-menu-duration">施術所要時間 約${esc(m.durationMin || 30)}分</span>
            ${earliest ? `<span class="treatment-menu-earliest">最短 ${esc(dispDate(earliest.date))}〜</span>` : ""}
            <button type="button" class="treatment-menu-action" data-menu-id="${m.id}">空き状況を確認する</button>
          </span>
        </div>`;
      }).join("") : '<div class="treatment-menu-empty">このお悩みで選べる施術はまだありません</div>';
      $("treatmentMenuList").querySelectorAll(".treatment-menu-action").forEach((b) => b.addEventListener("click", () => {
        Object.assign(st, { menuId: Number(b.dataset.menuId), date: null, time: null, slotId: null });
        renderStep2();
        document.querySelector(".calendar-nav").scrollIntoView({ behavior: "instant", block: "start" });
      }));
    }
    $("currentWeek").textContent = (() => { const d = parseYmd(weekDates(st.week)[0]); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} 週`; })();
    if (menus.length && !menu) {
      setTimeSelectionVisible(false);
      $("calendar").innerHTML = '<p class="select-date-msg">施術メニューを選択してください</p>';
      return;
    }
    setTimeSelectionVisible(true);
    renderCalendar();
  }
  function earliestSlot() {
    const days = Store.getDays(st.csId, 7 * (MAX_WEEK + 1));
    for (const d of days) { const s = d.slots.find((x) => selectable(d.date, x)); if (s) return { date: d.date, time: s.time, id: s.id }; }
    return null;
  }
  /* 空き枠 = 診療時間 − 予約 − ブロック − カルテの来院予定（store.js の getDays / slotAvail）。休診日は枠が 0 */
  function renderCalendar() {
    const dates = weekDates(st.week);
    const days = Store.getDays(st.csId, 7 * (MAX_WEEK + 1) + 1);
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    $("prevWeek").disabled = st.week <= 0;
    $("nextWeek").disabled = st.week >= MAX_WEEK;
    // 最短日時
    const e = earliestSlot();
    const eBox = $("rsvEarliest");
    eBox.innerHTML = e ? `<span class="rsv4-earliest-label">最短で予約できる日時</span><strong>${esc(dispDate(e.date))} ${esc(e.time)}</strong><button type="button" class="btn-primary rsv4-earliest-btn" id="pickEarliest">この日時を選択</button>` : "";
    eBox.classList.toggle("hidden", !e);
    if (e) $("pickEarliest").addEventListener("click", () => pickSlot(e.date, e.time, e.id));

    const times = [...new Set(dates.flatMap((d) => (byDate[d] ? byDate[d].slots.map((s) => s.time) : [])))].sort();
    if (!times.length) {
      $("calendar").innerHTML = '<p class="select-date-msg">この週は予約できる枠がありません。次週をご確認ください。</p>';
      $("timeSlots").innerHTML = '<p class="select-date-msg">○の日時を選択すると受診者情報の入力へ進みます</p>';
      return;
    }
    const today = Store.todayStr();
    const head = dates.map((ds) => {
      const d = parseYmd(ds), wd = d.getDay(), day = byDate[ds];
      const closed = ds >= today && day && day.closed;
      return `<th class="date-column ${wd === 0 ? "sun" : ""} ${wd === 6 ? "sat" : ""} ${ds === today ? "today" : ""}" scope="col" ${closed && day.closureReason ? `title="${esc(day.closureReason)}"` : ""}>
        <span class="date-weekday">${WD[wd]}</span><span class="date-day">${d.getMonth() + 1}/${d.getDate()}</span>${closed ? `<span class="rsv4-closed">休</span>` : ""}</th>`;
    }).join("");
    const body = times.map((time) => `<tr><td class="time-label"><span>${esc(time)}</span></td>${dates.map((ds) => {
      const d = parseYmd(ds), wd = d.getDay(), day = byDate[ds];
      const slot = day ? day.slots.find((s) => s.time === time) : null;
      const past = isPastSlot(ds, time);
      const rem = slot ? slot.remaining : 0;
      const disabled = past || !slot || rem <= 0;
      const mark = disabled ? (slot && !past ? "×" : "-") : rem <= 1 ? "△" : "○";
      const cls = mark === "△" ? "m-few" : mark === "×" ? "m-full" : "";
      const sel = st.date === ds && st.time === time;
      const label = slot ? `${dispDate(ds)} ${time}から 残り${past ? 0 : rem}枠` : `${dispDate(ds)} ${time} 予約不可`;
      return `<td class="calendar-cell ${wd === 0 ? "sun" : ""} ${wd === 6 ? "sat" : ""} ${ds === today ? "today" : ""} ${disabled ? "closed" : ""} ${past && slot ? "past-slot" : ""} ${sel ? "selected" : ""}">
        <button type="button" class="availability-cell ${disabled ? "disabled" : "available"} ${sel ? "selected" : ""}" data-date="${ds}" data-time="${esc(time)}" data-slot-id="${slot ? esc(slot.id) : ""}" aria-label="${esc(label)}" ${disabled ? "disabled" : ""}>
          <span class="availability-mark ${cls}">${mark}</span></button></td>`;
    }).join("")}</tr>`).join("");
    $("calendar").innerHTML = `<table class="availability-table" aria-label="予約空き状況"><thead><tr>
        <th class="time-column" scope="col"><span class="time-column-title">予約開始時間</span><span class="time-column-month">${parseYmd(dates[0]).getMonth() + 1}月</span></th>${head}</tr></thead>
        <tbody>${body}</tbody></table>`;
    $("calendar").querySelectorAll(".availability-cell:not(.disabled)").forEach((c) => c.addEventListener("click", () => {
      $("calendar").querySelectorAll(".availability-cell").forEach((x) => { x.classList.remove("selected"); x.closest(".calendar-cell").classList.remove("selected"); });
      c.classList.add("selected"); c.closest(".calendar-cell").classList.add("selected");
      pickSlot(c.dataset.date, c.dataset.time, c.dataset.slotId);
    }));
    if (!st.slotId) $("timeSlots").innerHTML = '<p class="select-date-msg">○・△の日時を選択すると受診者情報の入力へ進みます</p>';
  }
  function pickSlot(date, time, slotId) {
    Object.assign(st, { date, time, slotId });
    const d = weekDates(0)[0];
    st.week = Math.max(0, Math.min(MAX_WEEK, Math.floor((parseYmd(date) - parseYmd(d)) / (7 * 86400000))));
    $("timeSlots").innerHTML = `<p class="select-date-msg">${esc(dispDate(date))} ${esc(time)} を選択しました</p>`;
    setTimeout(() => { form = form || blankForm(); st.formErr = ""; renderStep3(); showStep(3); }, 180);
  }

  /* =============================================================
     Step 3: 受診者情報（ログインなしで毎回入力。基準版の「受診者情報を入力してください」の部品）
     ============================================================= */
  function selectionInfoHtml() {
    const c = Store.clinicOfCs(st.csId), s = Store.serviceOfCs(st.csId), m = st.menuId ? Store.menuById(st.menuId) : null;
    return `<div class="reservation-selection-info rsv4-selection">
      <p><strong>クリニック:</strong> ${esc(clinicName(c))}</p>
      <p><strong>診療科:</strong> ${esc(svcLabel(s))}</p>
      ${m ? `<p><strong>メニュー:</strong> ${esc(m.name)}（${esc(priceText(m))}・約${esc(m.durationMin || 30)}分）</p>` : ""}
      <p><strong>日時:</strong> ${esc(dispDate(st.date))} ${esc(st.time)}〜 <button type="button" class="rsv4-link" id="changeSlot">変更</button></p>
    </div>`;
  }
  function phonePartsHtml(base, value) {
    const p = String(value || "").split("-");
    const part = (i, ph, ac) => `<input class="phone-input" type="tel" id="${base}Part${i}" inputmode="numeric" maxlength="4" autocomplete="${ac}" placeholder="${ph}" aria-label="電話番号${i}" value="${esc(p[i - 1] || "")}">`;
    return `<div class="phone-input-group" data-phone-target="${base}" data-phone-required="true">${part(1, "090", "tel-area-code")}<span class="phone-separator">-</span>${part(2, "1234", "tel-local-prefix")}<span class="phone-separator">-</span>${part(3, "5678", "tel-local-suffix")}</div>`;
  }
  function bindPhone(root) {
    root.querySelectorAll(".phone-input-group").forEach((g) => {
      const ins = [...g.querySelectorAll(".phone-input")];
      ins.forEach((inp, i) => {
        inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 4); if (inp.value.length >= 4 && ins[i + 1]) ins[i + 1].focus(); });
        inp.addEventListener("keydown", (ev) => { if (ev.key === "Backspace" && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
      });
    });
  }
  const phoneValue = (base) => [1, 2, 3].map((i) => ($(base + "Part" + i) || {}).value || "").map((v) => v.trim());
  function docButtonsHtml(kind, mode) {
    return `<div class="rsv4-doc-buttons">
      <label class="btn-back post-task-upload rsv4-doc-btn"><i class="fa-solid fa-camera" aria-hidden="true"></i> 写真を撮る<input type="file" accept="image/*" capture="environment" data-doc-kind="${kind}" data-doc-mode="${mode}"></label>
      <label class="btn-back post-task-upload rsv4-doc-btn"><i class="fa-regular fa-image" aria-hidden="true"></i> 保存した写真から選ぶ<input type="file" accept="image/*" data-doc-kind="${kind}" data-doc-mode="${mode}"></label>
    </div>`;
  }
  function preDocStatus(kind) {
    return pendingDocs[kind]
      ? `✓ 選択済み（予約完了と同時に送ります） <button type="button" class="rsv4-link" data-clear-doc="${kind}">取り消す</button>`
      : "";
  }
  function renderStep3() {
    const f = form;
    const staff = staffList();
    $("reservationPatientList").innerHTML = `
      ${selectionInfoHtml()}
      <div class="patient-select-heading">
        <p class="section-kicker">受診者情報</p>
        <h3>受診者情報を入力してください</h3>
        <p class="rsv4-lead">会員登録は不要です。「必須」の付いていない項目は任意です。</p>
      </div>
      <div class="new-patient-form-panel">
        <form id="newPatientForm" class="form" novalidate>
          <div class="rsv4-error" id="formErr" role="alert">${st.formErr ? esc(st.formErr) : ""}</div>
          <div class="form-group"><label for="f_name">お名前 <span class="required">必須</span></label>
            <input type="text" id="f_name" value="${esc(f.name)}" placeholder="山田 花子" autocomplete="name" autocapitalize="off"></div>
          <div class="form-group"><label for="f_kana">フリガナ <span class="required">必須</span></label>
            <input type="text" id="f_kana" value="${esc(f.kana)}" placeholder="ヤマダ ハナコ" autocomplete="off"></div>
          <div class="form-group"><label for="f_birth">生年月日 <span class="rsv4-opt">任意</span></label>
            <input type="date" id="f_birth" value="${esc(f.birthDate)}" autocomplete="bday"></div>
          <div class="form-group"><label>電話番号 <span class="required">必須</span></label>
            ${phonePartsHtml("f_phone", f.phone)}<small class="rsv4-help">予約の確認・キャンセルのときに使います</small></div>
          <div class="form-group"><label for="f_email">メールアドレス <span class="rsv4-opt">任意</span></label>
            <input type="email" id="f_email" value="${esc(f.email)}" placeholder="example@email.com" autocomplete="email" autocapitalize="off" spellcheck="false"></div>
          <div class="form-group"><label>当院のご利用 <span class="required">必須</span></label>
            <div class="rsv4-radio-row">
              <label><input type="radio" name="vt" value="FIRST" ${f.visitType === "FIRST" ? "checked" : ""}> 初めて（初診）</label>
              <label><input type="radio" name="vt" value="REVISIT" ${f.visitType === "REVISIT" ? "checked" : ""}> 2回目以降（再診）</label>
            </div></div>
          ${staff.length ? `<div class="form-group"><label for="f_staff">ご指名（担当スタッフ） <span class="rsv4-opt">任意</span></label>
            <select id="f_staff"><option value="">指名なし（当院にお任せ）</option>${staff.map((s) => `<option value="${s.id}" ${String(f.staffId) === String(s.id) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
            <small class="rsv4-help">ご指名の担当がその時間に埋まっている場合は、確定時にお知らせします。</small></div>` : ""}
          <div class="form-group"><label for="f_note">ご相談内容・気になること <span class="rsv4-opt">任意</span></label>
            <textarea id="f_note" rows="3">${esc(f.note)}</textarea></div>
          <div class="form-group rsv4-docs">
            <label>保険証・医療証の写真 <span class="rsv4-opt">任意</span></label>
            <p class="rsv4-help">いま撮っておくと予約完了と同時に送られ、当日の受付が早く済みます。あとから（予約完了の画面・予約の確認画面）でも送れます。文字が読める向きで、明るい場所で撮影してください。</p>
            ${["insurance", "iryo"].map((k) => `<div class="rsv4-doc-row">
              <span class="rsv4-doc-label">${k === "insurance" ? "保険証（資格確認書・資格情報のお知らせでも可）" : "医療証（お持ちの方のみ）"}</span>
              ${docButtonsHtml(k, "pre")}
              <span class="rsv4-doc-status ${pendingDocs[k] ? "ok" : ""}" id="preDocStatus_${k}">${preDocStatus(k)}</span></div>`).join("")}
            <a class="rsv4-link" href="help/mynumber.html">マイナ保険証をお使いの方（資格情報の画面の撮り方）</a>
          </div>
          <div class="form-group rsv4-consent">
            <label>同意書のご確認 <span class="required">必須</span></label>
            <p class="rsv4-help">施術・診療に関する同意書を必ずご確認ください。</p>
            <div class="rsv4-consent-row"><button type="button" class="btn-back" id="openConsent">同意書を確認する</button>
              <span class="rsv4-doc-status ok" id="consentStatus">${f.consent ? `✓ 同意済み（規約 ${esc(CONSENT_VERSION)}）` : ""}</span></div>
          </div>
          <div class="form-actions"><button type="submit" class="btn-primary" id="toConfirm">確認画面へ進む</button></div>
        </form>
      </div>`;
    const root = $("reservationPatientList");
    bindPhone(root);
    $("changeSlot").addEventListener("click", () => { readForm(); showStep(2); renderStep2(); });
    $("openConsent").addEventListener("click", () => { readForm(); openConsent(true); });
    root.querySelectorAll("[data-clear-doc]").forEach((b) => b.addEventListener("click", () => { pendingDocs[b.dataset.clearDoc] = null; readForm(); renderStep3(); }));
    $("newPatientForm").addEventListener("submit", (ev) => { ev.preventDefault(); goConfirm(); });
  }
  function readForm() {
    if (!$("f_name")) return;
    form.name = $("f_name").value; form.kana = $("f_kana").value; form.birthDate = $("f_birth").value;
    const p = phoneValue("f_phone"); form.phone = p.some(Boolean) ? p.join("-") : "";
    form.email = $("f_email").value; form.note = $("f_note").value;
    form.staffId = $("f_staff") ? $("f_staff").value : "";
    const vt = document.querySelector('input[name="vt"]:checked'); if (vt) form.visitType = vt.value;
  }
  function stepErr(msg) { st.formErr = msg; const e = $("formErr"); if (e) { e.textContent = msg; e.scrollIntoView({ behavior: "instant", block: "center" }); } }
  function goConfirm() {
    readForm();
    const p = phoneValue("f_phone");
    if (!form.name.trim() || !form.kana.trim() || !p.every(Boolean)) return stepErr("お名前・フリガナ・電話番号は必須です（電話番号は3つの欄に分けて入力してください）。");
    if (p.join("").length < 10) return stepErr("電話番号の桁数をご確認ください。");
    if (!form.visitType) return stepErr("初診・再診を選択してください。");
    if (!form.consent) return stepErr("同意書をご確認のうえ、「内容を確認し、同意します」を押してください。");
    st.formErr = "";
    renderConfirm(); showStep(4);
  }

  /* ---------- 同意書（基準版の同意書ポップアップに、統合版の文面・版を出す）---------- */
  const CONSENT_HTML = `
    <div class="consent-document-body rsv4-consent-body">
      <h4>1. 診療・施術について</h4><p>当院の診療・施術は医師の診察に基づき実施されます。効果には個人差があります。</p>
      <h4>2. リスク・副作用について</h4><p>赤み・腫れ・内出血・乾燥などが生じる場合があります。気になる症状が続く場合は速やかにご連絡ください。</p>
      <h4>3. 施術をお受けいただけない場合</h4><p>妊娠中・授乳中の方、特定の疾患・服薬状況のある方は施術をお受けいただけない場合があります。</p>
      <h4>4. 個人情報の取り扱い</h4><p>ご入力いただいた個人情報は診療・予約管理・ご連絡の目的にのみ使用します。</p>
      <h4>5. ご予約の変更・キャンセルについて</h4>
      <p>ご都合が悪くなった場合は、<b>できるだけ早めに</b>予約サイトの「予約の確認・キャンセル」またはお電話でご連絡ください。ご連絡のないキャンセル（無断キャンセル）や当日キャンセルが重なった場合、以降のご予約をお受けできないことがあります。</p>
      <p><b>キャンセル料が発生する施術については、ご予約時に個別にご案内します。</b>ご案内がない場合、キャンセル料はいただきません。</p>
      <h4>6. お支払いについて</h4>
      <p>お支払いは<b>ご来院時</b>にお願いしております。現金・カード等のお取り扱いは院により異なりますので、ご不明な場合は事前にお問い合わせください。</p>
    </div>`;
  function openConsent(withAgree) {
    $("consentModalBody").innerHTML = `<p class="consent-document-progress">規約 ${esc(CONSENT_VERSION)}</p>${CONSENT_HTML}
      ${withAgree ? `<p class="consent-document-description">同意された日時を記録させていただきます（規約 ${esc(CONSENT_VERSION)}）。</p>
      <div class="consent-form-actions"><button type="button" class="btn-back" id="consentCancel">閉じる</button>
        <button type="button" class="btn-primary" id="consentAgree">内容を確認し、同意します</button></div>`
      : `<div class="consent-form-actions"><button type="button" class="btn-primary" id="consentCancel">閉じる</button></div>`}`;
    $("consentModal").classList.remove("hidden");
    $("consentCancel").addEventListener("click", closeConsent);
    if (withAgree) $("consentAgree").addEventListener("click", () => {
      form.consent = true; consentAt = new Date().toISOString(); closeConsent();
      if (st.step === 3) { st.formErr = ""; renderStep3(); }
    });
  }
  function closeConsent() { $("consentModal").classList.add("hidden"); }

  /* =============================================================
     Step 4: 確認（基準版の confirm-card・注意事項の同意チェック）
     ============================================================= */
  function renderConfirm(errMsg, errExtra) {
    const c = Store.clinicOfCs(st.csId), s = Store.serviceOfCs(st.csId), m = st.menuId ? Store.menuById(st.menuId) : null;
    const staff = staffList();
    const docs = ["insurance", "iryo"].filter((k) => pendingDocs[k]).map((k) => DOC_LABEL[k] + " 選択済み");
    $("reservationSummary").classList.add("hidden");
    $("confirmCard").innerHTML = `
      <div class="rsv4-error" id="confirmErr" role="alert">${errMsg ? esc(errMsg) + (errExtra || "") : ""}</div>
      <div class="confirm-section"><div class="confirm-section-title">予約内容</div>
        <div class="confirm-section-content">${esc(clinicName(c))}<br>${esc(svcLabel(s))}${m ? `<br>${esc(m.name)}<br><span class="confirm-subtext">${esc(priceText(m))}・約${esc(m.durationMin || 30)}分</span>` : ""}<br>${esc(dispDate(st.date))} ${esc(st.time)}〜</div></div>
      <div class="confirm-section"><div class="confirm-section-title">受診者</div>
        <div class="confirm-section-content">${esc(form.name)}（${esc(form.kana)}）<br>${esc(form.phone)}
          ${form.birthDate ? `<br><span class="confirm-subtext">生年月日 ${esc(form.birthDate)}</span>` : ""}
          ${form.email ? `<br><span class="confirm-subtext">${esc(form.email)}</span>` : ""}</div></div>
      <div class="confirm-section"><div class="confirm-section-title">初診・再診</div>
        <div class="confirm-section-content">${form.visitType === "FIRST" ? "初めて（初診）" : "2回目以降（再診）"}</div></div>
      ${staff.length ? `<div class="confirm-section"><div class="confirm-section-title">ご指名</div><div class="confirm-section-content">${form.staffId ? esc(staffNameOf(form.staffId)) : "指名なし（当院にお任せ）"}</div></div>` : ""}
      ${form.note ? `<div class="confirm-section"><div class="confirm-section-title">ご相談内容</div><div class="confirm-section-content">${esc(form.note)}</div></div>` : ""}
      <div class="confirm-section"><div class="confirm-section-title">写真登録</div>
        <div class="confirm-section-content">${docs.length ? esc(docs.join("／")) + '<br><span class="confirm-subtext">予約完了と同時に送ります</span>' : 'なし<br><span class="confirm-subtext">予約完了の画面からも送れます</span>'}</div></div>
      <div class="confirm-section"><div class="confirm-section-title">同意書</div>
        <div class="confirm-section-content">✓ 確認・同意済み<br><span class="confirm-subtext">規約 ${esc(CONSENT_VERSION)}</span></div></div>
      <div class="confirm-section confirm-caution-section"><div class="confirm-section-title">注意事項</div>
        <div class="confirm-section-content confirm-notice-content">
          <p class="confirm-notice-lead">以下を確認してから予約を確定してください。</p>
          <ul class="confirmation-check-list">
            <li>ご予約の変更・キャンセルは前日までにお願いいたします。</li>
            <li>当日・無断キャンセルが続いた場合、以降のご予約をお受けできないことがあります。</li>
            <li>ご予約時間の5〜10分前を目安にお越しください。保険証（初診の方）・お薬手帳をご持参ください。</li>
          </ul></div></div>
      <label class="confirmation-agreement" for="reservationConfirmAgreement">
        <input type="checkbox" id="reservationConfirmAgreement"><span>上記の注意事項を確認し、同意しました。</span></label>`;
    const sync = () => { const ok = $("reservationConfirmAgreement").checked; $("submitReservation").disabled = !ok; $("submitReservation").textContent = ok ? "予約を確定する" : "注意事項に同意してください"; };
    $("reservationConfirmAgreement").addEventListener("change", sync);
    sync();
    const re = $("reselectSlot"); if (re) re.addEventListener("click", () => { Object.assign(st, { date: null, time: null, slotId: null }); showStep(2); renderStep2(); });
  }
  async function submitReservation() {
    const btn = $("submitReservation");
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "予約処理中…";
    const res = await Store.createReservation({
      csId: st.csId, date: st.date, time: st.time,
      name: form.name.trim(), kana: form.kana.trim(), birthDate: form.birthDate,
      phone: form.phone.trim(), email: form.email.trim(), visitType: form.visitType,
      menuId: st.menuId, note: form.note.trim(), channel: "WEB",
      staffId: form.staffId ? Number(form.staffId) : null,
      lineUserId: (lineUser && lineUser.id) || null,
      consentAt: consentAt, consentVersion: CONSENT_VERSION,
    });
    if (!res.ok) {
      // 保存できなかったら完了にしない。入力は残したまま、確認画面で再試行できる状態に戻す
      const link = res.reason === "DUPLICATE" || /満員|休診|診療日/.test(res.error || "")
        ? '<div class="rsv4-err-link"><button type="button" class="rsv4-link" id="reselectSlot">別の日時を選び直す →</button></div>' : "";
      renderConfirm(patientMsg(res, "FAILED"), link);
      $("reservationConfirmAgreement").checked = true; $("reservationConfirmAgreement").dispatchEvent(new Event("change"));
      window.scrollTo(0, 0);
      return;
    }
    st.done = Object.assign({}, res.reservation);
    renderComplete();
    showStep(5);
    // 入力は消す（予約番号と表示に要る最小限だけ st.done に残る。画面を閉じれば消える）
    form = null; consentAt = null;
    sendPendingDocs(st.done.code);
  }

  /* =============================================================
     完了（基準版の complete-card・post-task-card）
     ============================================================= */
  function gcalUrl(r, c, s) {
    const m = r.menuId ? Store.menuById(r.menuId) : null;
    const dur = (m && m.durationMin) || 30;
    const a = new Date(`${r.date}T${r.time}:00`), b = new Date(a.getTime() + dur * 60000);
    const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return "https://calendar.google.com/calendar/render?action=TEMPLATE"
      + `&text=${encodeURIComponent(`${clinicName(c)} ${svcLabel(s)} のご予約`)}&dates=${z(a)}/${z(b)}`
      + `&location=${encodeURIComponent(c.address)}&details=${encodeURIComponent("予約番号: " + r.code)}`;
  }
  function docCardsHtml(code, mode) {
    return ["insurance", "iryo"].map((k) => `
      <div class="post-task-card rsv4-doc-card" id="docCard_${mode}_${k}">
        <div class="post-task-status" id="docStatus_${mode}_${k}">未送信</div>
        <div class="post-task-body"><h3>${k === "insurance" ? "保険証を送れます" : "医療証を送れます（お持ちの方のみ）"}</h3>
          <p>${k === "insurance" ? "資格確認書・資格情報のお知らせでも可。" : "こども・ひとり親などの医療証。"}事前に送っていただくと当日の受付が早く済みます。</p>
          <p class="rsv4-doc-msg" id="docMsg_${mode}_${k}"></p></div>
        ${docButtonsHtml(k, mode + ":" + code)}
      </div>`).join("");
  }
  function renderComplete() {
    const r = st.done, c = Store.clinicOfCs(r.csId), s = Store.serviceOfCs(r.csId), m = r.menuId ? Store.menuById(r.menuId) : null;
    const room = Store.roomName(r), staffName = r.staffId ? staffNameOf(r.staffId) : "";
    const row = (l, v, cls) => `<div class="reservation-summary-row ${cls || ""}"><span class="reservation-summary-label">${l}</span><span class="reservation-summary-value">${v}</span></div>`;
    $("completeDetails").innerHTML =
      row("予約番号", `<span class="rsv4-code" id="doneCode">${esc(r.code)}</span>`, "rsv4-code-row")
      + row("クリニック", esc(clinicName(c))) + row("診療科", esc(svcLabel(s)))
      + (m ? row("メニュー", esc(m.name)) : "")
      + row("日時", `${esc(dispDate(r.date))} ${esc(r.time)}〜`)
      + (room ? row("診察室", esc(room)) : "") + (staffName ? row("ご指名", esc(staffName)) : "")
      + row("お名前", esc(r.name) + " 様") + row("初診・再診", r.visitType === "FIRST" ? "初めて（初診）" : "2回目以降（再診）");
    document.querySelector("#stepComplete .complete-message").innerHTML =
      "ご予約ありがとうございます。予約番号は確認・キャンセルの際に必要です。<br>このご予約はクリニックの受付にその場で届いています（お電話での確認は不要です）。";
    $("afterReservationActions").innerHTML = `
      ${docCardsHtml(r.code, "done")}
      <p class="rsv4-help rsv4-doc-foot">写真は送る前にお使いの端末で縮小され、位置情報などは含まれません。受付で内容を確認したうえで登録します（自動では確定しません）。
        <a class="rsv4-link" href="help/mynumber.html">マイナ保険証をお使いの方</a></p>
      <div class="post-task-card"><div class="post-task-status">任意</div>
        <div class="post-task-body"><h3>ご予約のリマインドをLINEで受け取れます</h3><p>前日のお知らせ・変更のご連絡をLINEでお送りします。</p></div>
        <a class="btn-primary post-task-button rsv4-line-btn" href="${OA_ADD_URL}" target="_blank" rel="noopener">LINEで受け取る</a></div>
      <div class="post-task-card rsv4-visit-card"><div class="post-task-status">来院案内</div>
        <div class="post-task-body"><h3>ご来院について</h3>
          <p>${esc(c.address)}<br>電話 ${esc(c.phone)}</p>
          <p>ご予約時間の5〜10分前を目安にお越しください。保険証（初診の方）・お薬手帳をご持参ください。</p></div>
        <div class="rsv4-done-links">
          <a class="btn-back" id="mapLink" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> 地図で場所を見る</a>
          <a class="btn-back" id="gcalLink" href="${gcalUrl(r, c, s)}" target="_blank" rel="noopener"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Googleカレンダーに追加</a>
        </div></div>`;
    $("backToMypage").textContent = "トップに戻る";
  }

  /* =============================================================
     保険証・医療証の写真（端末で長辺1600px の JPEG にし、位置情報などを落としてから送る）
     Storage 非公開バケット rsv-documents の rsv/<予約番号>/ に置き、予約の行にパスを記録（prototype3 と同じ）
     ============================================================= */
  function shrinkImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, (maxSide || 1600) / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => b ? resolve(b) : reject(new Error("画像を変換できませんでした")), "image/jpeg", quality || 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
      img.src = url;
    });
  }
  async function uploadBlob(code, kind, blob) {
    const client = Store.getClient && Store.getClient();
    if (!client) throw new Error("通信の準備ができていません");
    const path = `rsv/${code}/${kind}_${Date.now()}.jpg`;
    const up = await client.storage.from("rsv-documents").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw up.error;
    const row = { docs_uploaded_at: new Date().toISOString() };
    row[kind === "insurance" ? "insurance_card_path" : "iryo_card_path"] = path;
    const { error } = await client.from("rsv2_reservations").update(row).eq("code", code);
    if (error) throw error;
    return path;
  }
  function setDocState(mode, kind, status, msg, cls) {
    const s = $(`docStatus_${mode}_${kind}`), m = $(`docMsg_${mode}_${kind}`);
    if (s) { s.textContent = status; s.classList.toggle("rsv4-ok", cls === "ok"); s.classList.toggle("rsv4-ng", cls === "ng"); }
    if (m) { m.textContent = msg; m.className = "rsv4-doc-msg" + (cls ? " " + cls : ""); }
  }
  async function sendPendingDocs(code) {
    for (const kind of ["insurance", "iryo"]) {
      const blob = pendingDocs[kind]; if (!blob) continue;
      pendingDocs[kind] = null;
      setDocState("done", kind, "送信中", "送信中…", "");
      try { await uploadBlob(code, kind, blob); setDocState("done", kind, "送信済み", `✓ 送信しました（${DOC_LABEL[kind]}）`, "ok"); }
      catch (e) { console.warn("[rsv-docs] pending upload failed", e); setDocState("done", kind, "未送信", "送信できませんでした。この欄からもう一度お送りください。", "ng"); }
    }
  }
  document.addEventListener("change", async (ev) => {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.dataset.docKind) return;
    const file = input.files && input.files[0]; if (!file) return;
    const kind = input.dataset.docKind, modeRaw = input.dataset.docMode || "";
    input.value = "";
    if (modeRaw === "pre") {
      const stEl = $("preDocStatus_" + kind);
      if (stEl) { stEl.textContent = "読み込み中…"; stEl.className = "rsv4-doc-status"; }
      try { pendingDocs[kind] = await shrinkImage(file, 1600, 0.85); readForm(); renderStep3(); }
      catch (e) { pendingDocs[kind] = null; if (stEl) { stEl.textContent = "この画像は使えませんでした。別の写真をお選びください。"; stEl.className = "rsv4-doc-status ng"; } }
      return;
    }
    const [mode, code] = modeRaw.split(":");
    setDocState(mode, kind, "送信中", "送信中…", "");
    try {
      const blob = await shrinkImage(file, 1600, 0.85);
      await uploadBlob(code, kind, blob);
      setDocState(mode, kind, "送信済み", `✓ 送信しました（${DOC_LABEL[kind]}）`, "ok");
    } catch (e) {
      console.warn("[rsv-docs] upload failed", e);
      setDocState(mode, kind, "未送信", "送信できませんでした。当日、受付でご提示ください。", "ng");
    }
  });

  /* =============================================================
     マイページ: 予約の確認・キャンセル（予約番号＋電話番号）
     ============================================================= */
  function doLookup(ev) {
    if (ev) ev.preventDefault();
    const code = $("l_code").value, phone = $("l_phone").value;
    const r = Store.findReservation(code, phone);
    if (!r) { $("lookErr").textContent = "予約が見つかりません。予約番号と電話番号をご確認ください。"; $("lookResult").innerHTML = ""; return; }
    $("lookErr").textContent = "";
    const c = Store.clinicOfCs(r.csId), s = Store.serviceOfCs(r.csId), m = r.menuId ? Store.menuById(r.menuId) : null;
    const cancelled = r.status === "CANCELLED";
    const info = (l, v) => `<div class="reservation-info-row"><span class="reservation-label">${l}</span><span class="reservation-value">${v}</span></div>`;
    $("lookResult").innerHTML = `
      <div class="mypage-reservation-card" id="lookCard">
        <div class="reservation-card-header"><span class="reservation-status ${cancelled ? "cancelled" : "confirmed"}" id="lookStatus">${cancelled ? "キャンセル済み" : "確定"}</span></div>
        <div class="reservation-card-body">
          ${info("予約番号", esc(r.code))}${info("クリニック", esc(clinicName(c)))}${info("診療科", esc(svcLabel(s)))}
          ${m ? info("メニュー", esc(m.name)) : ""}${info("日時", `${esc(dispDate(r.date))} ${esc(r.time)}〜`)}${info("お名前", esc(r.name) + " 様")}
        </div>
        ${cancelled ? "" : `<div class="reservation-card-actions mypage-actions-row"><button type="button" class="btn-back rsv4-danger" id="cancelBtn">この予約をキャンセルする</button></div>`}
      </div>
      ${cancelled ? "" : `<div class="after-reservation-actions rsv4-look-docs">${docCardsHtml(r.code, "look")}
        <p class="rsv4-help rsv4-doc-foot">写真は送る前にお使いの端末で縮小され、位置情報などは含まれません。<a class="rsv4-link" href="help/mynumber.html">マイナ保険証をお使いの方</a></p></div>`}`;
    if (!cancelled) $("cancelBtn").addEventListener("click", () => doCancel(r.code, phone));
  }
  async function doCancel(code, phone) {
    if (!confirm("この予約をキャンセルします。よろしいですか？")) return;
    const btn = $("cancelBtn"); btn.disabled = true; btn.textContent = "キャンセル処理中…";
    const res = await Store.cancelReservation(code, phone);
    if (res.ok) {
      $("lookResult").innerHTML = `<div class="reservation-empty rsv4-success" id="cancelDone"><p>予約をキャンセルしました。クリニックの受付にもすぐに反映されます。</p></div>`;
      return;
    }
    btn.disabled = false; btn.textContent = "この予約をキャンセルする";
    $("lookErr").textContent = patientMsg(res, "CANCEL");            // 失敗は必ず画面に出す
    window.scrollTo(0, 0);
  }

  /* =============================================================
     設定: 基準版の一覧を残し、アカウントが要る行は「準備中」
     ============================================================= */
  function renderSettings() {
    document.querySelectorAll("#settingsMenuView .settings-menu-row[data-settings-panel]").forEach((row) => {
      const p = row.dataset.settingsPanel, label = row.querySelector(".settings-menu-label").textContent;
      let status = row.querySelector(".settings-connection-status");
      if (!status) { status = document.createElement("span"); status.className = "settings-connection-status"; row.insertBefore(status, row.querySelector(".settings-menu-chevron")); row.classList.add("settings-menu-row-connection"); }
      if (label === "LINE連携") { status.textContent = lineUser ? "連携済み" : "未設定"; status.className = "settings-connection-status " + (lineUser ? "is-connected" : "is-disconnected"); row.disabled = false; row.dataset.rsv4 = "line"; }
      else if (p === "reservations") { status.textContent = "予約番号で確認"; status.className = "settings-connection-status"; row.disabled = false; row.dataset.rsv4 = "lookup"; }
      else if (p === "terms" || p === "privacy") { status.textContent = ""; row.disabled = false; row.dataset.rsv4 = "consent"; }
      else { status.textContent = "準備中"; status.className = "settings-connection-status rsv4-prep"; row.disabled = true; row.dataset.rsv4 = "prep"; }
    });
    const v = document.querySelector("#settingsMenuView .settings-menu-meta"); if (v) v.textContent = "4.0";
  }

  /* =============================================================
     LINE 連携（任意）: 押したとき（または LINE から戻ったとき）だけ SDK を読む
     ============================================================= */
  function loadLiff() {
    return new Promise((resolve, reject) => {
      if (window.liff) return resolve(window.liff);
      const s = document.createElement("script"); s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
      s.onload = () => resolve(window.liff); s.onerror = () => reject(new Error("LINE の読み込みに失敗しました")); document.head.appendChild(s);
    });
  }
  async function lineConnect(interactive) {
    try {
      const liff = await loadLiff();
      await liff.init({ liffId: LIFF_ID });
      if (liff.isLoggedIn()) {
        const p = await liff.getProfile(); lineUser = { id: p.userId, name: p.displayName };
        $("authLineLabel").textContent = `LINE連携済み：${lineUser.name} さん（このまま予約へ）`;
        $("authMenuMessage").textContent = "ご予約が確定すると、この LINE に確認メッセージをお送りします（通知の受け取りには友だち追加が必要です）。";
        if (st.page === "settings") renderSettings();
      } else if (interactive) liff.login({ redirectUri: location.href });
    } catch (e) {
      console.warn("LINE 連携を開始できませんでした:", e && e.message);
      if (interactive) alert("LINE連携を開始できませんでした。LINEなしでもご予約いただけます。");
    }
  }

  /* =============================================================
     起動
     ============================================================= */
  function bind() {
    $("guestReserveBtn").addEventListener("click", () => { enterApp("reservation"); showStep(0); renderClinics(); });
    $("guestLookupBtn").addEventListener("click", () => enterApp("mypage"));
    $("authLineLogin").addEventListener("click", async () => { if (lineUser) { enterApp("reservation"); showStep(0); renderClinics(); } else lineConnect(true); });
    document.querySelectorAll(".bottom-nav-item").forEach((b) => b.addEventListener("click", () => switchPage(b.dataset.page)));
    $("changeClinicBtn").addEventListener("click", () => { showStep(0); renderClinics(); });
    $("prevWeek").addEventListener("click", () => { if (st.week > 0) { st.week--; renderStep2(); } });
    $("nextWeek").addEventListener("click", () => { if (st.week < MAX_WEEK) { st.week++; renderStep2(); } });
    $("backToStep1").addEventListener("click", () => showStep(1));
    $("backToStep2").addEventListener("click", () => { readForm(); showStep(2); renderStep2(); });
    $("backToStep3").addEventListener("click", () => { renderStep3(); showStep(3); });
    $("submitReservation").addEventListener("click", submitReservation);
    $("backToMypage").addEventListener("click", () => { Object.assign(st, { csId: null, menuId: null, date: null, time: null, slotId: null, done: null }); showStep(0); renderClinics(); });
    $("consentModalClose").addEventListener("click", closeConsent);
    $("consentModalOverlay").addEventListener("click", closeConsent);
    $("lookupForm").addEventListener("submit", doLookup);
    $("settingsMenuView").addEventListener("click", (ev) => {
      const row = ev.target.closest(".settings-menu-row"); if (!row || row.disabled) return;
      if (row.dataset.rsv4 === "line") lineConnect(true);
      else if (row.dataset.rsv4 === "lookup") switchPage("mypage");
      else if (row.dataset.rsv4 === "consent") openConsent(false);
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeConsent(); });
  }

  bind();
  ensureStep2Parts();
  showStep(0);
  renderClinics();
  // LINE から戻ってきたときだけ連携を確かめる（ふだんは SDK を読まない）
  if (params.has("liff.state") || (params.has("code") && params.has("state"))) lineConnect(false);

  /* 受付側の変更（他の方の予約・取消・ブロック）をすぐ反映（Realtime） */
  Store.onSync(() => {
    if (st.page === "reservation" && st.step === 2 && st.csId) renderCalendar();
    if (st.page === "reservation" && st.step === 0) renderClinics();
  });
  Store.ready.then(() => {
    renderConn();
    if (st.step === 2 && st.csId) renderStep2();
    document.documentElement.dataset.rsvReady = Store.getBackend();   // 確認用（"supabase" / "offline"）
  });
})();
