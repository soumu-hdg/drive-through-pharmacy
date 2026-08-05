/* =============================================================
   クリニック予約システム ── 同期ストア（ローカル/Supabase 両対応）
   -------------------------------------------------------------
   ■ 設計方針
     ・空き枠 = 「診療時間マスタ（テンプレ）」 − 「予約（正本）」の引き算で算出
     ・予約の正本は1つ。ダブルブッキングは構造的に排除
     ・リアルタイム同期：予約が入った瞬間、患者UIと受付ボードの双方へ即反映

   ■ バックエンドは実行時に自動選択
     ・window.__RSV_SUPABASE__ && window.supabase(UMD) が揃う → Supabase バックエンド
       - 予約正本 = Supabase テーブル rsv2_reservations（既存データと分離・RLS）
       - 同期 = Supabase Realtime（postgres_changes、レガシー anon JWT）
     ・揃わない（ローカルfile://・CDN不達 等） → ローカルバックエンド
       - localStorage + BroadcastChannel で同一オリジンのタブ/iframe間を同期

   ■ 本番化（★SEAM★）：anon直書き → サーバ関数(Vercel /api)経由へ。RLSで窓口ごとに権限判定。
   ============================================================= */

const Store = (() => {
  "use strict";

  /* ---------- Supabase 接続設定（新HDGプロジェクト vypw・公開キー相当のレガシー anon JWT） ----------
     移行方針: 予約システムは業務アカウント soumu-hdg の新プロジェクト vypwgxkqtxuzqfaaeamf を参照。
     Realtime(postgres_changes) を効かせるため publishable ではなくレガシー anon JWT を使用。 */
  const SUPA_URL = "https://vypwgxkqtxuzqfaaeamf.supabase.co";
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5cHdneGtxdHh1enFmYWFlYW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NzMxNTgsImV4cCI6MjEwMDM0OTE1OH0.Vyo6iOvAYF4DOVF1bfNwNWoA1e8ja-9byx8dULmWzb8";
  const TABLE = "rsv2_reservations";
  const USE_SUPABASE = typeof window !== "undefined" && window.__RSV_SUPABASE__ && window.supabase;

  /* ---------- マスタ：クリニック・診療区分 ---------- */
  const CLINICS = [
    { id: 1, name: "西春", area: "愛知", address: "愛知県北名古屋市徳重", phone: "0568-00-0000",
      services: [ { id: 11, name: "外来" }, { id: 12, name: "在宅" }, { id: 13, name: "美容" } ] },
    { id: 2, name: "横浜", area: "神奈川", address: "神奈川県横浜市西区", phone: "045-000-0000",
      services: [ { id: 21, name: "美容" }, { id: 22, name: "外来" } ] },
    { id: 3, name: "千葉", area: "千葉", address: "千葉県千葉市中央区", phone: "043-000-0000",
      services: [ { id: 31, name: "外来" }, { id: 32, name: "夜間休日" } ] },
    { id: 4, name: "中川", area: "愛知", address: "愛知県名古屋市中川区", phone: "052-000-0000",
      openingNote: "11月開業予定",
      services: [ { id: 41, name: "外来" } ] },
  ];

  const MENUS = [
    { id: 101, csId: 13, name: "ダーマペン4", concerns: "毛穴・ニキビ跡・肌質", price: 19800, firstVisitPrice: 14800, durationMin: 60, popular: true, catch: "毛穴・ニキビ跡が気になる方へ", downtime: "赤みが数時間", staffType: "看護師（医師診察あり）" },
    { id: 102, csId: 13, name: "医療ハイフ（全顔）", concerns: "たるみ・フェイスライン", price: 49800, firstVisitPrice: 39800, durationMin: 45, popular: true, catch: "切らないリフトアップ", downtime: "ほぼなし", staffType: "看護師" },
    { id: 103, csId: 13, name: "IPL光治療", concerns: "シミ・そばかす・赤み", price: 12000, firstVisitPrice: null, durationMin: 30, popular: false, catch: "肌トーンを整える", downtime: "なし", staffType: "看護師" },
    { id: 104, csId: 13, name: "医療脱毛（両ワキ）", concerns: "むだ毛", price: 3000, firstVisitPrice: null, durationMin: 20, popular: false, catch: "スピーディに完了", downtime: "なし", staffType: "看護師" },
    { id: 201, csId: 21, name: "ボトックス（額）", concerns: "小じわ・ハリ不足", price: 22000, firstVisitPrice: 16800, durationMin: 20, popular: true, catch: "表情じわをやわらげる", downtime: "ほぼなし", staffType: "医師" },
    { id: 202, csId: 21, name: "ダーマペン4", concerns: "毛穴・ニキビ跡", price: 20800, firstVisitPrice: 15800, durationMin: 60, popular: false, catch: "肌の生まれ変わりを促す", downtime: "赤みが数時間", staffType: "看護師（医師診察あり）" },
  ];

  /* ---------- 診察室：各クリニック・各区分に2室（診察室1／診察室2） ---------- */
  //   予約枠 = 「時間帯 × 診察室数」で用意する。capacity = 室数(2) とし、
  //   各予約がどの室かは枠内の先着順で決定的に割り当てる（roomOf）。
  const ROOMS = [ { id: 1, name: "診察室1" }, { id: 2, name: "診察室2" } ];

  const TEMPLATES = {
    "外来":     { weekdays: [1,2,3,4,5],   times: gen("09:00","11:30",30).concat(gen("15:00","17:30",30)), capacity: ROOMS.length, dur: 30 },
    "在宅":     { weekdays: [1,3,5],       times: gen("13:00","16:00",60), capacity: ROOMS.length, dur: 60 },
    "美容":     { weekdays: [2,3,4,5,6],   times: gen("10:00","17:30",30), capacity: ROOMS.length, dur: 30, role: "NURSE" },
    "夜間休日": { weekdays: [0,6],         times: gen("19:00","21:30",30), capacity: ROOMS.length, dur: 30 },
  };

  function gen(from, to, step) {
    const out = [];
    let [h, m] = from.split(":").map(Number);
    const [eh, em] = to.split(":").map(Number);
    while (h * 60 + m <= eh * 60 + em) {
      out.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
      m += step; if (m >= 60) { h += Math.floor(m/60); m %= 60; }
    }
    return out;
  }

  /* ---------- 日付ユーティリティ ---------- */
  const WD = ["日","月","火","水","木","金","土"];
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function addDays(base, n) {
    const d = new Date(base); d.setDate(d.getDate()+n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function fmtJa(dateStr) {
    const [y,m,d] = dateStr.split("-").map(Number);
    return `${m}/${d}(${WD[new Date(y,m-1,d).getDay()]})`;
  }
  function weekday(dateStr) {
    const [y,m,d] = dateStr.split("-").map(Number);
    return new Date(y,m-1,d).getDay();
  }

  function clinicOfCs(csId) { return CLINICS.find(c => c.services.some(s => s.id === csId)); }
  function serviceOfCs(csId) {
    for (const c of CLINICS) { const s = c.services.find(x => x.id === csId); if (s) return s; }
    return null;
  }
  function menusOfCs(csId) { return MENUS.filter(m => m.csId === csId); }
  function menuById(id) { return MENUS.find(m => m.id === id); }

  /* ---------- 診察室の割り当て ----------
     ・予約は診察室IDを保存（roomId）。受付が任意に切り替えられる。
     ・roomId未設定の旧データは、同枠(csId×date×time)の空き室を先着順で埋めて導出（互換）。 */
  function sameSlotPeers(res) {
    return _cache
      .filter(r => r.status === "CONFIRMED" && r.csId === res.csId && r.date === res.date && r.time === res.time)
      .sort((a, b) => String(a.createdAt||"").localeCompare(String(b.createdAt||"")) || String(a.code||"").localeCompare(String(b.code||"")));
  }
  function roomOf(res) {
    if (!res) return null;
    if (res.roomId) return res.roomId;                 // 明示割当があればそれを優先
    const peers = sameSlotPeers(res);                  // 旧データ互換：空き室を先着順で
    const taken = new Set(peers.filter(p => p.roomId).map(p => p.roomId));
    const free = ROOMS.map(r => r.id).filter(id => !taken.has(id));
    const idx = peers.filter(p => !p.roomId).findIndex(p => p.code === res.code);
    return (idx >= 0 && free[idx]) ? free[idx] : null;
  }
  function roomName(res) { const id = roomOf(res); const rm = ROOMS.find(r => r.id === id); return rm ? rm.name : ""; }
  // 枠内で空いている診察室を1つ返す（無ければnull=満員）
  function freeRoom(csId, date, time) {
    const taken = new Set(_cache
      .filter(r => r.status === "CONFIRMED" && r.csId === csId && r.date === date && r.time === time)
      .map(r => roomOf(r)));
    return ROOMS.map(r => r.id).find(id => !taken.has(id)) || null;
  }

  /* ---------- スタッフ/機材の割当（被り防止） ---------- */
  function _toMin(hhmm){ const [h,m]=String(hhmm).split(":").map(Number); return h*60+m; }
  // 予約の所要分（メニュー基準・無ければ外来30/在宅60）
  function durMin(r){
    if(r && r.menuId){ const m=menuById(r.menuId); if(m&&m.durationMin) return m.durationMin; }
    const s=serviceOfCs(r && r.csId); return (s&&s.name==="在宅")?60:30;
  }
  // スタッフ/機材が指定時間帯に別予約で埋まっているか（時間の重なりで判定）
  function resourceConflict(kind, resourceId, date, startMin, endMin, exceptCode){
    if(!resourceId) return false;
    return _cache.some(r=>{
      if(r.status!=="CONFIRMED" || r.code===exceptCode || r.date!==date) return false;
      const rid = kind==="staff" ? r.staffId : r.deviceId;
      if(Number(rid)!==Number(resourceId)) return false;
      const s=_toMin(r.time), e=s+durMin(r);
      return startMin<e && s<endMin;
    });
  }

  /* ---------- 予約キャッシュ（getDays等が同期参照） ---------- */
  let _cache = [];       // 予約の正本（メモリ）。ローカル=localStorageと同期／Supabase=DBと同期
  let _resources = [];   // 院ごとのリソース（部屋/スタッフ/機材）。管理画面で編集

  // 院×種別のリソース一覧（sort_order順）。kind省略で全種別。
  function resourcesOf(clinicId, kind) {
    return _resources
      .filter(r => r.clinicId === clinicId && (!kind || r.kind === kind))
      .sort((a,b) => (a.sortOrder-b.sortOrder) || (a.id-b.id));
  }

  function mkRes(o) {
    return {
      code: o.code || genCode(),
      csId: o.csId, slotId: `${o.csId}_${o.date}_${o.time}`,
      date: o.date, time: o.time,
      name: o.name, kana: o.kana || "", phone: o.phone, birthDate: o.birthDate || "",
      roomId: o.roomId ?? null, staffId: o.staffId ?? null, deviceId: o.deviceId ?? null,
      lineUserId: o.lineUserId || null,
      email: o.email || "", visitType: o.visitType || "", menuId: o.menuId || null,
      note: o.note || "", status: "CONFIRMED", channel: o.channel || "WEB",
      createdAt: o.createdAt || new Date().toISOString(), sentAt: o.sentAt || null,
    };
  }

  // 暗号的に安全な予約番号（予測されないよう crypto 乱数を使用）
  function genCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let c = "";
    const rnd = (window.crypto && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint32Array(8)))
      : Array.from({length:8}, () => Math.floor(Math.random()*1e9));
    for (let i=0;i<8;i++) c += chars[rnd[i] % chars.length];
    return c;
  }

  /* ---------- 空き枠 = マスタ − 予約 ---------- */
  function getDays(csId, days) {
    const svc = serviceOfCs(csId);
    const tpl = TEMPLATES[svc.name];
    const res = _cache.filter(r => r.status === "CONFIRMED" && r.csId === csId);
    const base = todayStr();
    const out = [];
    for (let i=0;i<days;i++) {
      const date = addDays(base, i);
      const isOpen = tpl.weekdays.includes(weekday(date));
      const slots = isOpen ? tpl.times.map(time => {
        const id = `${csId}_${date}_${time}`;
        const used = res.filter(r => r.slotId === id).length;
        return { id, time, capacity: tpl.capacity, remaining: Math.max(0, tpl.capacity - used), open: true };
      }) : [];
      out.push({ date, label: fmtJa(date), wd: WD[weekday(date)], slots });
    }
    return out;
  }

  function slotRemaining(slotId) {
    const csId = Number(slotId.split("_")[0]);
    const cap = TEMPLATES[serviceOfCs(csId).name].capacity;
    const used = _cache.filter(r => r.status === "CONFIRMED" && r.slotId === slotId).length;
    return Math.max(0, cap - used);
  }

  function loadReservations() { return _cache.slice(); }
  function dayReservations(date) {
    return _cache.filter(r => r.date === date && r.status === "CONFIRMED").sort((a,b) => a.time.localeCompare(b.time));
  }
  function findReservation(code, phone) {
    const r = _cache.find(x => x.code === (code||"").toUpperCase().trim());
    if (!r) return null;
    if (r.phone.replace(/-/g,"") !== (phone||"").replace(/-/g,"").trim()) return null;
    return r;
  }

  /* ---------- 同期（listeners） ---------- */
  const listeners = [];
  function dispatch(msg) { listeners.forEach(f => { try { f(msg); } catch {} }); }
  function onSync(cb) { listeners.push(cb); }

  /* =========================================================
     バックエンド実装（local / supabase）
     共通API: init() / insert(res) / setStatus(code,status) / resetDemo()
     ・Supabaseが使える設定でも、初期接続/テーブルが無ければ自動でローカルへフォールバック
     ========================================================= */
  let backendName = "local";

  function makeSupabaseBackend() {
    // ★重要: anon専用クライアント。同一ドメイン(github.io)のカルテ等のログインセッションを
    //   読まない/触らない（persistSession:false）。予約アプリは常にanonロールで動作し、
    //   カルテ側の認証に干渉しない。RLSポリシーは to public（anon/authenticated両対応）。
    const client = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const fromRow = r => ({
      code: r.code, csId: r.cs_id, slotId: r.slot_id, date: r.rdate, time: r.rtime,
      name: r.name, kana: r.kana || "", phone: r.phone, birthDate: r.birth || "", email: r.email || "",
      roomId: r.room_id ?? null, staffId: r.staff_id ?? null, deviceId: r.device_id ?? null,
      visitType: r.visit_type || "", menuId: r.menu_id, note: r.note || "", status: r.status,
      channel: r.channel || "WEB", createdAt: r.created_at, sentAt: r.sent_at,
      lineUserId: r.line_user_id || null,
    });
    const toRow = res => ({
      code: res.code, cs_id: res.csId, slot_id: res.slotId, rdate: res.date, rtime: res.time,
      name: res.name, kana: res.kana, phone: res.phone, birth: res.birthDate, email: res.email,
      room_id: res.roomId ?? null, staff_id: res.staffId ?? null, device_id: res.deviceId ?? null,
      visit_type: res.visitType, menu_id: res.menuId, note: res.note, status: res.status,
      channel: res.channel, sent_at: res.sentAt, line_user_id: res.lineUserId || null,
    });
    return {
      async init() {
        const { data, error } = await client.from(TABLE).select("*").eq("status", "CONFIRMED");
        if (error) throw error;   // テーブル未作成等 → 呼び出し側でローカルにフォールバック
        _cache = (data || []).map(fromRow);
        client.channel("rsv2-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
            const recvAt = Date.now();
            const row = payload.new && payload.new.code ? payload.new : payload.old;
            if (!row) return;
            const res = fromRow(row);
            const i = _cache.findIndex(x => x.code === res.code);
            if (res.status === "CONFIRMED") { if (i>=0) _cache[i]=res; else _cache.push(res); }
            else if (i>=0) _cache[i] = res;
            const latency = res.sentAt ? recvAt - Number(res.sentAt) : null;
            dispatch({ type: "reservation", at: res.sentAt || (Date.now()-0), latency });
          })
          .subscribe((s) => dispatch({ type: "status", status: s }));
      },
      async insert(res) {
        res.sentAt = Date.now();
        const row = toRow(res);
        let { error } = await client.from(TABLE).insert(row);
        let tries = 0;   // room_id/staff_id/device_id 列が無い環境 → その列を外して再送（予約は通す）
        while (error && tries < 3 && /(room_id|staff_id|device_id)/.test(error.message||"")) {
          ["room_id","staff_id","device_id"].forEach(c => { if (new RegExp(c).test(error.message||"")) delete row[c]; });
          ({ error } = await client.from(TABLE).insert(row)); tries++;
        }
        if (error) throw error;
        const i = _cache.findIndex(x => x.code === res.code);
        if (i<0) _cache.push(res);
      },
      async setStatus(code, status) {
        const { error } = await client.from(TABLE).update({ status }).eq("code", code);
        if (error) throw error;
        const r = _cache.find(x => x.code === code); if (r) r.status = status;
      },
      async setRoom(updates) {
        for (const u of updates) {
          const { error } = await client.from(TABLE).update({ room_id: u.roomId }).eq("code", u.code);
          if (error) { if (/room_id/.test(error.message||"")) throw new Error("NO_ROOM_COLUMN"); throw error; }
        }
        updates.forEach(u => { const r = _cache.find(x => x.code === u.code); if (r) r.roomId = u.roomId; });
      },
      async resetDemo() {
        await client.from(TABLE).delete().not("code","like","SEED%");
        await client.from(TABLE).update({ status: "CONFIRMED" }).like("code","SEED%");
        const { data } = await client.from(TABLE).select("*").eq("status","CONFIRMED");
        _cache = (data || []).map(fromRow);
        dispatch({ type: "reservation", at: Date.now() });
      },
      async assignResource(code, kind, resourceId) {
        const col = kind === "staff" ? "staff_id" : "device_id";
        const { error } = await client.from(TABLE).update({ [col]: resourceId }).eq("code", code);
        if (error) throw error;
        const r = _cache.find(x => x.code === code);
        if (r) { if (kind === "staff") r.staffId = resourceId; else r.deviceId = resourceId; }
      },
      async reschedule(code, newTime) {
        const r = _cache.find(x => x.code === code); const slot = r ? `${r.csId}_${r.date}_${newTime}` : null;
        const { error } = await client.from(TABLE).update({ rtime: newTime, slot_id: slot }).eq("code", code);
        if (error) throw error;
        if (r) { r.time = newTime; r.slotId = slot; }
      },
      /* --- リソース（部屋/スタッフ/機材） --- */
      async loadResources() {
        const { data, error } = await client.from("rsv2_resources").select("*").eq("active", true);
        if (error) return [];   // テーブル未作成でも予約本体は動かす
        return (data || []).map(r => ({ id: r.id, clinicId: r.clinic_id, kind: r.kind, name: r.name, sortOrder: r.sort_order }));
      },
      async getNote(clinicId, date) { const { data } = await client.from("rsv2_daily_notes").select("note").eq("clinic_id", clinicId).eq("ndate", date).maybeSingle(); return data ? (data.note||"") : ""; },
      async saveNote(clinicId, date, note) { const { error } = await client.from("rsv2_daily_notes").upsert({ clinic_id:clinicId, ndate:date, note, updated_at:new Date().toISOString() }, { onConflict:"clinic_id,ndate" }); if (error) throw error; },
      async addResource(r) { const { error } = await client.from("rsv2_resources").insert({ clinic_id:r.clinicId, kind:r.kind, name:r.name, sort_order:r.sortOrder||0 }); if (error) throw error; },
      async renameResource(id, name) { const { error } = await client.from("rsv2_resources").update({ name }).eq("id", id); if (error) throw error; },
      async removeResource(id) { const { error } = await client.from("rsv2_resources").delete().eq("id", id); if (error) throw error; },
    };
  }

  function makeLocalBackend() {
    /* ---- ローカル バックエンド（localStorage + BroadcastChannel） ---- */
    const LS_KEY = "rsv2.reservations";
    const RES_KEY = "rsv2.resources";
    const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } };
    const save = (l) => localStorage.setItem(LS_KEY, JSON.stringify(l));
    function resSeed(){
      if (localStorage.getItem(RES_KEY) !== null) return;
      const out=[]; let id=1;
      [1,2,3,4].forEach(cid=>{
        [["room","部屋A",1],["room","部屋B",2],["staff","スタッフA",1],["staff","スタッフB",2],["device","機材A",1],["device","機材B",2]]
          .forEach(([k,n,so])=>out.push({id:id++,clinicId:cid,kind:k,name:n,sortOrder:so}));
      });
      localStorage.setItem(RES_KEY, JSON.stringify(out));
    }
    let bc = null; try { bc = new BroadcastChannel("rsv2_sync"); } catch { bc = null; }
    function fire(msg) { if (bc) bc.postMessage(msg); localStorage.setItem("rsv2.ping", JSON.stringify(msg)); }
    function seed() {
      if (localStorage.getItem(LS_KEY) !== null) return;
      const t = todayStr();
      save([
        mkRes({ code:"SEED0001", csId: 11, date: t, time: "09:00", name: "佐藤 一郎", kana: "サトウ イチロウ", phone: "090-1111-2222", visitType: "REVISIT", channel: "WEB" }),
        mkRes({ code:"SEED0002", csId: 11, date: t, time: "09:00", name: "鈴木 花子", kana: "スズキ ハナコ", phone: "090-3333-4444", visitType: "FIRST", channel: "PHONE" }),
        mkRes({ code:"SEED0003", csId: 13, date: addDays(t,1), time: "10:30", name: "田中 美咲", kana: "タナカ ミサキ", phone: "080-5555-6666", visitType: "FIRST", menuId: 101, channel: "WEB" }),
      ]);
    }
    return {
      async init() {
        seed(); _cache = load();
        if (bc) bc.onmessage = (e) => { _cache = load(); dispatch(e.data); };
        window.addEventListener("storage", (e) => {
          if (e.key === "rsv2.ping" && e.newValue) { _cache = load(); try { dispatch(JSON.parse(e.newValue)); } catch {} }
        });
      },
      async insert(res) { const l = load(); l.push(res); save(l); _cache = l; fire({ type:"reservation", at: Date.now() }); },
      async setStatus(code, status) { const l = load(); const r = l.find(x=>x.code===code); if (r){ r.status=status; save(l); _cache=l; fire({type:"reservation",at:Date.now()}); } },
      async setRoom(updates) { const l = load(); updates.forEach(u=>{ const r=l.find(x=>x.code===u.code); if(r) r.roomId=u.roomId; }); save(l); _cache=l; fire({type:"reservation",at:Date.now()}); },
      async resetDemo() { localStorage.removeItem(LS_KEY); seed(); _cache = load(); fire({ type:"reservation", at: Date.now() }); },
      async assignResource(code, kind, resourceId) { const l=load(); const r=l.find(x=>x.code===code); if(r){ if(kind==="staff") r.staffId=resourceId; else r.deviceId=resourceId; save(l); _cache=l; fire({type:"reservation",at:Date.now()}); } },
      async reschedule(code, newTime){ const l=load(); const r=l.find(x=>x.code===code); if(r){ r.time=newTime; r.slotId=`${r.csId}_${r.date}_${newTime}`; save(l); _cache=l; fire({type:"reservation",at:Date.now()}); } },
      /* --- リソース（localStorage） --- */
      async loadResources() { resSeed(); try { return JSON.parse(localStorage.getItem(RES_KEY)||"[]"); } catch { return []; } },
      async getNote(clinicId,date){ try{ return localStorage.getItem(`rsv2.note.${clinicId}.${date}`)||""; }catch{ return ""; } },
      async saveNote(clinicId,date,note){ try{ localStorage.setItem(`rsv2.note.${clinicId}.${date}`, note); }catch{} },
      async addResource(r) { resSeed(); const l=JSON.parse(localStorage.getItem(RES_KEY)||"[]"); const id=Math.max(0,...l.map(x=>x.id||0))+1; l.push({id,clinicId:r.clinicId,kind:r.kind,name:r.name,sortOrder:r.sortOrder||0}); localStorage.setItem(RES_KEY,JSON.stringify(l)); },
      async renameResource(id,name){ const l=JSON.parse(localStorage.getItem(RES_KEY)||"[]"); const r=l.find(x=>x.id===id); if(r){r.name=name; localStorage.setItem(RES_KEY,JSON.stringify(l));} },
      async removeResource(id){ let l=JSON.parse(localStorage.getItem(RES_KEY)||"[]"); l=l.filter(x=>x.id!==id); localStorage.setItem(RES_KEY,JSON.stringify(l)); },
    };
  }

  /* ---------- バックエンド確定（Supabase優先・失敗時ローカル） ---------- */
  let backend = makeLocalBackend();   // 既定
  const ready = (async () => {
    let ok = false;
    if (USE_SUPABASE) {
      try {
        const sb = makeSupabaseBackend();
        await sb.init();
        backend = sb; backendName = "supabase"; ok = true;
      } catch (e) {
        console.warn("[予約システム] Supabase未接続のためローカル同期にフォールバックします（テーブル未作成の可能性）:", e && e.message);
      }
    }
    if (!ok) { await backend.init(); backendName = "local"; }
    try { _resources = await backend.loadResources(); } catch { _resources = []; }
  })();

  // リソースCRUD（管理画面から呼ぶ）。編集後は再取得して同期通知。
  async function refreshResources() { try { _resources = await backend.loadResources(); } catch { _resources = []; } }
  async function addResource(clinicId, kind, name) {
    const last = resourcesOf(clinicId, kind).slice(-1)[0];
    await backend.addResource({ clinicId, kind, name, sortOrder: (last ? last.sortOrder : 0) + 1 });
    await refreshResources(); dispatch({ type: "resources", at: Date.now() });
  }
  async function renameResource(id, name) { await backend.renameResource(id, name); await refreshResources(); dispatch({ type: "resources", at: Date.now() }); }
  async function removeResource(id) { await backend.removeResource(id); await refreshResources(); dispatch({ type: "resources", at: Date.now() }); }
  async function getNote(clinicId, date) { try { return await backend.getNote(clinicId, date); } catch { return ""; } }
  async function saveNote(clinicId, date, note) { try { await backend.saveNote(clinicId, date, note); return { ok:true }; } catch { return { ok:false }; } }

  /* ---------- 公開API（UIが呼ぶ） ---------- */

  async function createReservation(input) {
    const slotId = `${input.csId}_${input.date}_${input.time}`;
    if (slotRemaining(slotId) <= 0) return { ok: false, error: "この枠は満員です。別の日時をお選びください。" };
    const dup = _cache.find(r => r.status === "CONFIRMED" && r.date === input.date && r.time === input.time
      && r.phone.replace(/-/g,"") === input.phone.replace(/-/g,"") && r.name === input.name);
    if (dup) return { ok: false, error: "同じ日時に既にご予約があります。" };
    if (input.roomId == null) input.roomId = freeRoom(input.csId, input.date, input.time);  // 空き診察室を自動割当
    // スタッフ・機材の被りチェック（受付が指定した場合）
    const st = _toMin(input.time), en = st + durMin({ csId: input.csId, menuId: input.menuId });
    if (input.staffId && resourceConflict("staff", Number(input.staffId), input.date, st, en))
      return { ok: false, error: "選択したスタッフはその時間帯に別の予約があります。" };
    if (input.deviceId && resourceConflict("device", Number(input.deviceId), input.date, st, en))
      return { ok: false, error: "選択した機材はその時間帯に別の予約で使用中です。" };
    const r = mkRes(input);
    try { await backend.insert(r); } catch (e) { return { ok: false, error: "通信エラーで予約できませんでした。時間をおいてお試しください。" }; }
    return { ok: true, reservation: r };
  }
  // スタッフ/機材の割当変更（受付ボードから）。被りは拒否。
  async function assignResource(code, kind, resourceId) {
    if (kind !== "staff" && kind !== "device") return { ok: false, error: "種別が不正です。" };
    const res = _cache.find(x => x.code === code && x.status === "CONFIRMED");
    if (!res) return { ok: false, error: "予約が見つかりません。" };
    resourceId = resourceId ? Number(resourceId) : null;
    if (resourceId) {
      const s = _toMin(res.time), e = s + durMin(res);
      if (resourceConflict(kind, resourceId, res.date, s, e, code))
        return { ok: false, error: "その時間帯、この" + (kind === "staff" ? "スタッフ" : "機材") + "は別の予約と重複します。" };
    }
    try { await backend.assignResource(code, kind, resourceId); }
    catch (e) {
      if (/staff_id|device_id/.test(e && e.message || "")) return { ok: false, error: "COL_MISSING" };
      return { ok: false, error: "通信エラーで保存できませんでした。" };
    }
    return { ok: true };
  }
  // 時刻の移動（ドラッグ）。満員・スタッフ/機材の被りは拒否。
  async function moveReservation(code, newTime) {
    const res = _cache.find(x => x.code === code && x.status === "CONFIRMED");
    if (!res) return { ok: false, error: "予約が見つかりません。" };
    if (newTime === res.time) return { ok: true };
    const s = _toMin(newTime), e = s + durMin(res);
    const used = _cache.filter(r => r.status === "CONFIRMED" && r.code !== code && r.csId === res.csId && r.date === res.date && r.time === newTime).length;
    if (used >= ROOMS.length) return { ok: false, error: "移動先の枠は満員です。" };
    if (res.staffId && resourceConflict("staff", res.staffId, res.date, s, e, code)) return { ok: false, error: "移動先の時間は担当スタッフが別予約と重複します。" };
    if (res.deviceId && resourceConflict("device", res.deviceId, res.date, s, e, code)) return { ok: false, error: "移動先の時間は機材が別予約で使用中です。" };
    try { await backend.reschedule(code, newTime); } catch (e2) { return { ok: false, error: "通信エラーで移動できませんでした。" }; }
    return { ok: true };
  }
  // 診察室の切り替え（対象室に別の予約があれば入れ替え）
  async function setRoom(code, targetRoomId) {
    targetRoomId = Number(targetRoomId);
    if (!ROOMS.some(r => r.id === targetRoomId)) return { ok: false, error: "診察室の指定が不正です。" };
    const res = _cache.find(x => x.code === code && x.status === "CONFIRMED");
    if (!res) return { ok: false, error: "予約が見つかりません。" };
    const cur = roomOf(res);
    if (cur === targetRoomId) return { ok: true };
    const other = _cache.find(x => x.status === "CONFIRMED" && x.code !== code
      && x.csId === res.csId && x.date === res.date && x.time === res.time && roomOf(x) === targetRoomId);
    const updates = [{ code: res.code, roomId: targetRoomId }];
    if (other) updates.push({ code: other.code, roomId: cur });   // 入れ替え
    try {
      await backend.setRoom(updates);
    } catch (e) {
      if (String(e && e.message) === "NO_ROOM_COLUMN")
        return { ok: false, error: "診察室の変更を保存できません（DBに room_id 列の追加が必要です）。" };
      return { ok: false, error: "通信エラーで診察室を変更できませんでした。" };
    }
    return { ok: true, swapped: !!other };
  }
  async function cancelReservation(code, phone) {
    const r = _cache.find(x => x.code === (code||"").toUpperCase().trim());
    if (!r || r.phone.replace(/-/g,"") !== (phone||"").replace(/-/g,"").trim())
      return { ok: false, error: "予約が見つかりません。予約番号と電話番号をご確認ください。" };
    if (r.status !== "CONFIRMED") return { ok: false, error: "この予約はすでにキャンセル済みです。" };
    try { await backend.setStatus(r.code, "CANCELLED"); } catch { return { ok:false, error:"通信エラーでキャンセルできませんでした。" }; }
    return { ok: true };
  }
  async function updateStatus(code, status) { try { await backend.setStatus(code, status); } catch {} }

  return {
    CLINICS, MENUS, ROOMS, WD, getBackend: () => backendName,
    todayStr, addDays, fmtJa, weekday,
    clinicOfCs, serviceOfCs, menusOfCs, menuById, roomOf, roomName, freeRoom, durMin, resourceConflict,
    getDays, createReservation, setRoom, assignResource, moveReservation, findReservation, cancelReservation, updateStatus,
    dayReservations, loadReservations,
    resourcesOf, refreshResources, addResource, renameResource, removeResource, getNote, saveNote,
    onSync, ready,
    resetDemo() { return backend.resetDemo(); },
  };
})();
