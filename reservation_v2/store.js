/* =============================================================
   クリニック予約システム ── 同期ストア（ローカル/Supabase 両対応）
   -------------------------------------------------------------
   ■ 設計方針
     ・空き枠 = 「診療時間マスタ」 − 「予約（正本）」 − 「非患者ブロック」 の引き算で算出
       - 診療時間マスタは rsv2_hours（院×診療区分×曜日）／休診日は rsv2_closures。
         どちらも行が無い診療区分は、従来どおり下の TEMPLATES（ハードコード）を使う。
       - 非患者ブロック（休憩・機材メンテ・院内業務）は予約と同じテーブルに kind 列で持つ
         （仕様書v2 §3.6-A。別テーブルにすると「ブロックの上に予約が入る」のをDBで防げない）
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
  /* この画面がSupabaseを使う設定か（患者予約サイト・受付ボードは true。demo.html は宣言せずローカルデモ）と、
     supabase-js（CDN）が実際に読み込めたかを分けて持つ。
     ★両者を混ぜると「CDNが読めなかった」ときに黙ってローカル保存へ落ちて「予約完了」と出てしまう（2026-08-12 是正）。 */
  const WANT_SUPABASE = typeof window !== "undefined" && window.__RSV_SUPABASE__ === true;
  const SDK_LOADED    = typeof window !== "undefined" && !!window.supabase;
  const USE_SUPABASE  = WANT_SUPABASE && SDK_LOADED;

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

  /* ---------- 診察室：リソース台帳（rsv2_resources / kind='room'）が正 ----------
     ★Wave2（仕様書v2 §3.2-B / 欠陥D-4）で、固定配列 ROOMS（2室決め打ち）を廃止した。
       部屋の数と並びは院ごとの登録リソースから取得し、枠の定員＝その院の有効な部屋数とする。
       これにより「リソース設定で3室目を登録したのに予約を置けない」状態が解消される。
       予約の roomId には rsv2_resources.id（bigint）が入る（DBは移行SQLで変換済み）。 */

  const TEMPLATES = {
    "外来":     { weekdays: [1,2,3,4,5],   times: gen("09:00","11:30",30).concat(gen("15:00","17:30",30)), dur: 30 },
    "在宅":     { weekdays: [1,3,5],       times: gen("13:00","16:00",60), dur: 60 },
    "美容":     { weekdays: [2,3,4,5,6],   times: gen("10:00","17:30",30), dur: 30, role: "NURSE" },
    "夜間休日": { weekdays: [0,6],         times: gen("19:00","21:30",30), dur: 30 },
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

  /* =========================================================
     非患者ブロック（休憩・機材メンテ・院内業務）── 仕様書v2 §3.6-A
     ---------------------------------------------------------
     ・予約と同じ rsv2_reservations に kind 列で持つ。別テーブルにすると
       「ブロックの上に患者予約が入る」のをDBで防げないため（§3.5 と同じ理由）。
     ・kind='PATIENT' 以外の行は患者情報（氏名・電話・生年月日等）を持たない
       （DB側の CHECK 制約 rsv2_reservations_block_no_pii でも強制）。
     ・ブロックは「30分の枠ごとに1行」で作り、同じ休憩の行を block_group でまとめる。
       こうすると uq_rsv2_room_slot / uq_rsv2_staff_slot / uq_rsv2_device_slot が
       ブロックの覆う全ての枠に効き、患者予約との重なりをDBが拒否できる。
     ========================================================= */
  const BLOCK_STEP = 30;                       // ブロック1行あたりの長さ（分）
  const BLOCK_KINDS = [
    { kind: "BREAK", label: "休憩" },
    { kind: "MAINT", label: "機材メンテ" },
    { kind: "OTHER", label: "院内業務" },
  ];
  function isBlock(r) { return !!r && !!r.kind && r.kind !== "PATIENT"; }
  function blockKindLabel(kind) { const k = BLOCK_KINDS.find(x => x.kind === kind); return k ? k.label : "ブロック"; }
  // ブロックの表示名（ラベル未入力なら種別名）
  function blockLabel(r) { return (r && r.note) ? r.note : blockKindLabel(r && r.kind); }

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

  /* ---------- 診察室の割り当て（部屋＝リソース台帳） ----------
     ・部屋の一覧は院ごとの登録リソース（kind='room'・active）。並びは sort_order→id。
     ・予約は診察室IDを保存（roomId＝rsv2_resources.id）。受付が任意に切り替えられる。
     ・roomId未設定の旧データは、同枠(csId×date×time)の空き室を先着順で埋めて導出（互換）。 */
  function roomsOf(clinicId) { return resourcesOf(clinicId, "room"); }
  // 診療区分ID（csId）からその院の部屋一覧を引く
  function roomsOfCs(csId) { const c = clinicOfCs(csId); return c ? roomsOf(c.id) : []; }
  // 枠の定員＝その院の有効な部屋数。未登録（0室）の院は従来どおり1件は受けられるようにする
  //（この場合 roomId は null のまま＝部屋の一意インデックスの対象外になる点に注意）
  function capacityOfCs(csId) { return Math.max(1, roomsOfCs(csId).length); }

  function sameSlotPeers(res) {
    // ★ブロック（非患者）は含めない。ブロックは必ず明示のリソースを持つ／持たないかのどちらかで、
    //   患者予約の「先着順で空き室を埋める」導出には参加させない。
    return _cache
      .filter(r => r.status === "CONFIRMED" && !isBlock(r) && r.csId === res.csId && r.date === res.date && r.time === res.time)
      .sort((a, b) => String(a.createdAt||"").localeCompare(String(b.createdAt||"")) || String(a.code||"").localeCompare(String(b.code||"")));
  }
  function roomOf(res) {
    if (!res) return null;
    // ブロックは指定された部屋のみ（自動導出しない。部屋指定なし＝担当/機材だけ、または院全体のブロック）
    if (isBlock(res)) return (res.roomId != null && res.roomId !== "") ? Number(res.roomId) : null;
    const rooms = roomsOfCs(res.csId);
    if (res.roomId != null && res.roomId !== "") {
      const id = Number(res.roomId);
      if (rooms.some(r => Number(r.id) === id)) return id;         // 明示割当（リソースID）
      // 旧データ互換：room_id が「何番目の部屋か（1,2…）」で入っている場合は順番で解決する。
      // （本番DBは移行SQL 2026-08-12_w2 でリソースIDへ変換済み。ローカルデモ用の保険）
      if (id >= 1 && id <= rooms.length) return Number(rooms[id-1].id);
      return id;                                                    // 不明なIDは値をそのまま保持
    }
    const peers = sameSlotPeers(res);                  // 未割当データ互換：空き室を先着順で
    const taken = new Set(peers.filter(p => p.roomId != null).map(p => Number(roomOf(p))));
    const free = rooms.map(r => Number(r.id)).filter(id => !taken.has(id));
    const idx = peers.filter(p => p.roomId == null).findIndex(p => p.code === res.code);
    return (idx >= 0 && free[idx] != null) ? free[idx] : null;
  }
  function roomName(res) {
    const id = roomOf(res);
    const rm = roomsOfCs(res && res.csId).find(r => Number(r.id) === Number(id));
    return rm ? rm.name : "";
  }
  // 部屋の並び順（0始まり）。表示色の出し分けに使う（-1＝一覧に無い）
  function roomIndex(res) {
    const id = roomOf(res);
    return roomsOfCs(res && res.csId).findIndex(r => Number(r.id) === Number(id));
  }
  // 枠内で空いている診察室を1つ返す（無ければnull=満員／部屋未登録の院もnull）
  //   ★ブロック（休憩・機材メンテ）で塞がっている部屋は候補から外す。
  //     外さないと自動割当がブロック中の部屋を選び、DBの一意インデックスで弾かれてしまう。
  function freeRoom(csId, date, time) {
    const taken = new Set(_cache
      .filter(r => r.status === "CONFIRMED" && !isBlock(r) && r.csId === csId && r.date === date && r.time === time)
      .map(r => Number(roomOf(r))));
    const st = _toMin(time), en = st + slotStepOf(csId, date);
    blocksOverlapping(csId, date, st, en).forEach(b => { if (b.roomId != null) taken.add(Number(b.roomId)); });
    const id = roomsOfCs(csId).map(r => Number(r.id)).find(id => !taken.has(id));
    return id != null ? id : null;
  }

  /* ---------- 非患者ブロックの引き当て ----------
     ブロックは院単位で効かせる（休憩は診療区分をまたいでその部屋/担当を塞ぐため）。
     時間の重なりで判定するので、60分の休憩は30分枠2つを塞ぐ。 */
  function blocksOverlapping(csId, date, startMin, endMin) {
    const c = clinicOfCs(csId);
    if (!c) return [];
    return _cache.filter(r => {
      if (r.status !== "CONFIRMED" || !isBlock(r) || r.date !== date) return false;
      const rc = clinicOfCs(r.csId);
      if (!rc || rc.id !== c.id) return false;
      const s = _toMin(r.time), e = s + durMin(r);
      return startMin < e && s < endMin;
    });
  }
  /* 枠の空き＝定員 −（患者予約）−（ブロックで塞がった部屋数）。
     リソースを一つも指定しないブロック（院全体の休止）はその枠を丸ごと閉じる。
     担当/機材だけのブロックは部屋の定員には影響しない（その担当・機材だけがDBで塞がる）。 */
  function slotAvail(csId, date, time, exceptCode) {
    const cap = capacityOfCs(csId);
    const st = _toMin(time), en = st + slotStepOf(csId, date);
    const patients = _cache.filter(r => r.status === "CONFIRMED" && !isBlock(r)
      && r.csId === csId && r.date === date && r.time === time && r.code !== exceptCode).length;
    const blocks = blocksOverlapping(csId, date, st, en);
    if (blocks.some(b => b.roomId == null && b.staffId == null && b.deviceId == null))
      return { capacity: cap, used: cap, remaining: 0, blocked: true };
    const rooms = new Set(blocks.filter(b => b.roomId != null).map(b => Number(b.roomId)));
    const used = patients + rooms.size;
    return { capacity: cap, used, remaining: Math.max(0, cap - used), blocked: rooms.size > 0 };
  }

  /* ---------- スタッフ/機材の割当（被り防止） ---------- */
  function _toMin(hhmm){ const [h,m]=String(hhmm).split(":").map(Number); return h*60+m; }
  function _hhmm(min){ return `${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`; }
  // 予約の所要分（メニュー基準・無ければ外来30/在宅60）。ブロックは1行=30分
  function durMin(r){
    if(isBlock(r)) return BLOCK_STEP;
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
  let _hours = [];       // 診療時間（rsv2_hours）。0件の診療区分は TEMPLATES にフォールバック
  let _closures = [];    // 休診日（rsv2_closures）。臨時休診はここに入る

  // 院×種別のリソース一覧（sort_order順）。kind省略で全種別。
  function resourcesOf(clinicId, kind) {
    return _resources
      .filter(r => r.clinicId === clinicId && (!kind || r.kind === kind))
      .sort((a,b) => (a.sortOrder-b.sortOrder) || (a.id-b.id));
  }

  /* =========================================================
     診療時間・休診日（院ごと）── 競合機能調査 §F#2 / 仕様書v2 §3.6-B
     ---------------------------------------------------------
     問題だったこと: 診療時間が全院共通のハードコード（TEMPLATES）で、休診日の設定が無い。
       臨時休診にしてもWeb予約の枠が開いたままで、新規予約が入ってきてしまう＝事故の構造。
     方針:
       ・rsv2_hours（院×診療区分×曜日×開始/終了/刻み）に1件でも行があれば、その区分は
         DBの設定が正。行が1件も無い区分は従来どおり TEMPLATES を使う
         （＝設定が無い状態では今までと同じ枠が出る。移行時に枠が消えない）。
       ・休診は2種類。定休＝その曜日の rsv2_hours 行を作らない。
         臨時休診＝rsv2_closures に日付で持つ（cs_id が null なら院全体）。
     ========================================================= */
  // 院×診療区分の診療時間（曜日→開始時刻の順）
  function hoursOf(csId) {
    return _hours
      .filter(h => Number(h.csId) === Number(csId) && h.active !== false)
      .sort((a,b) => (a.weekday-b.weekday) || String(a.openTime).localeCompare(String(b.openTime)));
  }
  // その診療区分の診療時間がDBで設定されているか（false＝ハードコードのTEMPLATESを使う）
  function hasHours(csId) { return hoursOf(csId).length > 0; }
  // 院の休診日（新しい日付順）
  function closuresOf(clinicId) {
    return _closures
      .filter(c => Number(c.clinicId) === Number(clinicId))
      .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }
  // その日が休診か（臨時休診の行があるか）。院全体(csId=null)の休診も見る
  function closureOn(csId, date) {
    const c = clinicOfCs(csId);
    if (!c) return null;
    return _closures.find(x => Number(x.clinicId) === c.id && x.date === date
      && (x.csId == null || Number(x.csId) === Number(csId))) || null;
  }
  // ハードコードの診療時間テンプレ（フォールバック元）
  function templateOfCs(csId) {
    const svc = serviceOfCs(csId);
    return (svc && TEMPLATES[svc.name]) || TEMPLATES["外来"];
  }
  // 現在の既定（TEMPLATES）を rsv2_hours の行の形に直したもの。管理画面の「既定を取り込む」で使う
  function defaultHoursOf(csId) {
    const tpl = templateOfCs(csId), c = clinicOfCs(csId);
    if (!tpl || !c) return [];
    // 連続した時刻の並びを「開始〜終了」の区間に畳む（例: 09:00…11:30 → 09:00-12:00）
    const step = (tpl.times.length > 1) ? (_toMin(tpl.times[1]) - _toMin(tpl.times[0])) : (tpl.dur || 30);
    const runs = [];
    tpl.times.forEach(t => {
      const m = _toMin(t), last = runs[runs.length-1];
      if (last && m === last.end) last.end = m + step;
      else runs.push({ start: m, end: m + step });
    });
    const out = [];
    tpl.weekdays.forEach(wd => runs.forEach(r => out.push({
      clinicId: c.id, csId, weekday: wd,
      openTime: _hhmm(r.start), closeTime: _hhmm(r.end), slotMin: step,
    })));
    return out;
  }
  // その日の枠の開始時刻一覧（休診日・時間外は空配列）
  function daySlotTimes(csId, date) {
    if (closureOn(csId, date)) return [];
    const wd = weekday(date);
    if (hasHours(csId)) {
      const rows = hoursOf(csId).filter(h => Number(h.weekday) === wd);
      const set = [];
      rows.forEach(h => {
        const step = Math.max(5, Number(h.slotMin) || 30);
        for (let m = _toMin(h.openTime); m + step <= _toMin(h.closeTime); m += step) {
          const t = _hhmm(m); if (set.indexOf(t) < 0) set.push(t);
        }
      });
      return set.sort();
    }
    const tpl = templateOfCs(csId);
    return tpl.weekdays.includes(wd) ? tpl.times.slice() : [];
  }
  // 枠1つの長さ（分）。ブロックとの重なり判定に使う
  function slotStepOf(csId, date) {
    if (hasHours(csId)) {
      const rows = hoursOf(csId).filter(h => Number(h.weekday) === weekday(date));
      if (rows.length) return Math.max(5, Number(rows[0].slotMin) || 30);
    }
    const tpl = templateOfCs(csId);
    return (tpl.times.length > 1) ? (_toMin(tpl.times[1]) - _toMin(tpl.times[0])) : (tpl.dur || 30);
  }
  // その日が休診かどうか（受付ボードの表示用）
  function isClosed(csId, date) { return daySlotTimes(csId, date).length === 0; }

  function mkRes(o) {
    const kind = o.kind || "PATIENT";
    // ★ブロック（非患者）は患者情報を一切持たない。空文字も入れない（DBのCHECK制約がNULLを要求する）
    if (kind !== "PATIENT") {
      return {
        code: o.code || genCode(), kind, blockGroup: o.blockGroup || null,
        csId: o.csId, slotId: `${o.csId}_${o.date}_${o.time}`, date: o.date, time: o.time,
        name: null, kana: null, phone: null, birthDate: null, email: null, visitType: null, lineUserId: null,
        roomId: o.roomId ?? null, staffId: o.staffId ?? null, deviceId: o.deviceId ?? null,
        menuId: null, note: o.note || "", status: "CONFIRMED", channel: o.channel || "STAFF",
        createdAt: o.createdAt || new Date().toISOString(), sentAt: o.sentAt || null,
      };
    }
    return {
      code: o.code || genCode(),
      kind,
      blockGroup: null,
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

  /* =========================================================
     保存失敗の分類（Wave1：失敗を握りつぶさず必ず利用者へ見せる）
     ---------------------------------------------------------
     ・DUPLICATE … DBの一意/排他制約違反。同じ枠の同じ部屋/担当/機材への二重登録を
                   DB側（uq_rsv2_room_slot / uq_rsv2_staff_slot / uq_rsv2_device_slot）が拒否した。
                   ★判定は HTTPステータスではなく error.code で行う。
                     PostgRESTは 23505→409、23P01→400 とマッピングが異なり、
                     ステータスでの分岐は将来 EXCLUDE 制約へ移行した時に壊れるため。
     ・OFFLINE   … 予約の正本（Supabase）へ接続できていない。ローカル保存で代替してはいけない。
     ・NETWORK   … 通信不達（fetch失敗）。
     ・DB        … その他のDBエラー（権限/列欠落など）。
     ========================================================= */
  const DUP_CODES = ["23505", "23P01"];          // 一意制約違反 / 排他制約違反
  const ERR_MSG = {
    duplicate:  "その部屋／担当／機材には、同じ時間帯に別の予約が入っています。",
    offline:    "予約データベースに接続できていないため保存できませんでした。ネットワーク状況をご確認ください。",
    createFail: "予約を保存できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
    saveFail:   "保存できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
    moveFail:   "移動を保存できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
    cancelFail: "キャンセルを保存できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
  };

  function classifyError(e) {
    const code    = String((e && e.code) || "");
    const message = String((e && e.message) || "");
    const details = String((e && e.details) || "");
    if (e && e.__rsvOffline) return { reason: "OFFLINE", code, message, details, resource: null };
    if (DUP_CODES.indexOf(code) >= 0) {
      const m = (message + " " + details).match(/uq_rsv2_(room|staff|device)_slot/);
      return { reason: "DUPLICATE", code, message, details, resource: m ? m[1] : null };
    }
    if (!code && /failed to fetch|networkerror|network request failed|load failed|fetcherror/i.test(message))
      return { reason: "NETWORK", code, message, details, resource: null };
    return { reason: "DB", code, message, details, resource: null };
  }

  // ネットワーク断・DBエラー・制約違反を区別してコンソールに残す（利用者向け文言は別途UIが出す）
  function logFail(op, info, raw) {
    const tag = { DUPLICATE:"重複＝DB制約が拒否", OFFLINE:"Supabase未接続", NETWORK:"通信不達", DB:"DBエラー" }[info.reason] || info.reason;
    console.error(
      `[予約システム] ${op}に失敗 / 種別=${info.reason}（${tag}）`
      + ` code=${info.code || "-"}`
      + (info.resource ? ` 競合リソース=${info.resource}` : "")
      + ` message=${info.message || "-"}`
      + (info.details ? ` details=${info.details}` : ""),
      raw
    );
  }

  // 予約の最新状態を取り直す（古い表示のまま再試行させない）
  async function refreshReservations() {
    try {
      if (backend && backend.refresh) { await backend.refresh(); dispatch({ type: "reservation", at: Date.now() }); }
    } catch (e) { console.warn("[予約システム] 予約状況の再読込に失敗しました:", e && e.message); }
  }

  // 書き込み失敗の共通処理：分類 → ログ → 最新状態の再読込 → UIへ結果を返す
  async function failResult(op, e, failMsg) {
    const info = classifyError(e);
    logFail(op, info, e);
    await refreshReservations();
    const error = info.reason === "DUPLICATE" ? ERR_MSG.duplicate
                : info.reason === "OFFLINE"   ? ERR_MSG.offline
                : failMsg;
    return { ok: false, reason: info.reason, resource: info.resource, error };
  }

  /* ---------- 空き枠 = 診療時間マスタ − 予約 − ブロック ----------
     ・その日の枠 = daySlotTimes（rsv2_hours があればそれ、無ければ TEMPLATES）
     ・休診日（rsv2_closures）は slots が空配列になる＝患者画面では「休」表示になる
     ・ブロック（休憩・機材メンテ）は slotAvail が差し引く */
  function getDays(csId, days) {
    const base = todayStr();
    const out = [];
    for (let i=0;i<days;i++) {
      const date = addDays(base, i);
      const times = daySlotTimes(csId, date);
      const closure = closureOn(csId, date);
      const slots = times.map(time => {
        const a = slotAvail(csId, date, time);
        return { id: `${csId}_${date}_${time}`, time, capacity: a.capacity, remaining: a.remaining, open: true };
      });
      out.push({ date, label: fmtJa(date), wd: WD[weekday(date)], slots,
                 closed: slots.length === 0, closureReason: closure ? (closure.reason || "臨時休診") : null });
    }
    return out;
  }

  function slotRemaining(slotId) {
    // slotId = "csId_YYYY-MM-DD_HH:MM"
    const p = String(slotId).split("_");
    const csId = Number(p[0]), date = p[1], time = p[2];
    // 休診日（臨時休診・その曜日の診療時間が無い日）は残0。
    // ★時間の一致までは求めない：受付が枠グリッド外の時刻（例 昼休みの割り込み）で
    //   代理入力できる従来の運用を壊さないため。
    if (daySlotTimes(csId, date).length === 0) return 0;
    return slotAvail(csId, date, time).remaining;
  }

  function loadReservations() { return _cache.slice(); }
  function dayReservations(date) {
    return _cache.filter(r => r.date === date && r.status === "CONFIRMED").sort((a,b) => a.time.localeCompare(b.time));
  }
  function findReservation(code, phone) {
    const r = _cache.find(x => x.code === (code||"").toUpperCase().trim());
    if (!r || isBlock(r)) return null;                    // ブロックは患者からは引けない（電話番号を持たない）
    if (String(r.phone||"").replace(/-/g,"") !== (phone||"").replace(/-/g,"").trim()) return null;
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
      kind: r.kind || "PATIENT", blockGroup: r.block_group || null,
    });
    const toRow = res => ({
      code: res.code, cs_id: res.csId, slot_id: res.slotId, rdate: res.date, rtime: res.time,
      name: res.name, kana: res.kana, phone: res.phone, birth: res.birthDate, email: res.email,
      room_id: res.roomId ?? null, staff_id: res.staffId ?? null, device_id: res.deviceId ?? null,
      visit_type: res.visitType, menu_id: res.menuId, note: res.note, status: res.status,
      channel: res.channel, sent_at: res.sentAt, line_user_id: res.lineUserId || null,
      kind: res.kind || "PATIENT", block_group: res.blockGroup || null,
    });
    return {
      async init() {
        const { data, error } = await client.from(TABLE).select("*").eq("status", "CONFIRMED");
        if (error) throw error;   // テーブル未作成等 → 呼び出し側でローカルにフォールバック
        _cache = (data || []).map(fromRow);
        client.channel("rsv2-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
            const recvAt = Date.now();
            // DELETE（ブロックの削除・デモ初期化）は行をキャッシュから外す。
            // ※ payload.old は主キー(code)だけのことがあるため、fromRow に通さず code で消す。
            if (payload.eventType === "DELETE" || payload.type === "DELETE") {
              const code = payload.old && payload.old.code;
              if (code) { const i = _cache.findIndex(x => x.code === code); if (i >= 0) _cache.splice(i,1); }
              dispatch({ type: "reservation", at: Date.now() });
              return;
            }
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
      // 最新の予約状況を取り直す（重複エラー時などに古い表示のまま再試行させないため）
      async refresh() {
        const { data, error } = await client.from(TABLE).select("*").eq("status", "CONFIRMED");
        if (error) throw error;
        _cache = (data || []).map(fromRow);
      },
      async insert(res) {
        res.sentAt = Date.now();
        const row = toRow(res);
        let { error } = await client.from(TABLE).insert(row);
        // room_id/staff_id/device_id（および患者予約なら kind/block_group）の列が無い環境
        //  → その列を外して再送（予約自体は通す）。
        //   ★制約違反(23505/23P01)はここで再送してはいけない（DBが正しく拒否した二重予約のため）
        //   ★ブロック行から kind を外すと患者予約になってしまうので、ブロックでは外さない（＝失敗させる）
        const strip = ["room_id","staff_id","device_id"].concat(row.kind === "PATIENT" ? ["kind","block_group"] : []);
        let tries = 0;
        while (error && tries < 3 && DUP_CODES.indexOf(String(error.code||"")) < 0
               && strip.some(c => new RegExp(c).test(error.message||""))) {
          strip.forEach(c => { if (new RegExp(c).test(error.message||"")) delete row[c]; });
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
        // 診察室の入れ替え（2件更新）は、途中経過で uq_rsv2_room_slot(部屋×枠) に触れてしまうため、
        // 相手をいったん NULL（＝部分一意インデックスの対象外）へ退避してから順に確定する。
        const undo = updates.map(u => {
          const r = _cache.find(x => x.code === u.code);
          return { code: u.code, roomId: r ? (r.roomId ?? null) : null };
        });
        const put = async (code, roomId) => {
          const { error } = await client.from(TABLE).update({ room_id: roomId }).eq("code", code);
          if (error) { if (/room_id/.test(error.message||"") && !error.code) throw new Error("NO_ROOM_COLUMN"); throw error; }
        };
        try {
          for (const u of updates.slice(1)) await put(u.code, null);   // 相手を退避
          for (const u of updates) await put(u.code, u.roomId);        // 本命→相手の順に確定
        } catch (e) {
          // 途中失敗時は元の割当へ戻す（戻せなくても予約自体は残る）
          for (const b of undo) { try { await put(b.code, b.roomId); } catch (e2) { console.warn("[予約システム] 診察室の巻き戻しに失敗:", b.code, e2 && e2.message); } }
          throw e;
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
      /* --- 非患者ブロック（グループ単位で削除） --- */
      async removeBlock(group) {
        const { error } = await client.from(TABLE).delete().eq("block_group", group);
        if (error) throw error;
        _cache = _cache.filter(r => r.blockGroup !== group);
      },
      /* --- 診療時間・休診日 --- */
      async loadHours() {
        const { data, error } = await client.from("rsv2_hours").select("*").eq("active", true);
        if (error) return [];   // テーブル未作成でも予約本体は動かす（＝従来のハードコード運用）
        return (data || []).map(h => ({ id:h.id, clinicId:h.clinic_id, csId:h.cs_id, weekday:h.weekday,
          openTime:h.open_time, closeTime:h.close_time, slotMin:h.slot_min, active:h.active }));
      },
      async loadClosures() {
        const { data, error } = await client.from("rsv2_closures").select("*");
        if (error) return [];
        return (data || []).map(c => ({ id:c.id, clinicId:c.clinic_id, csId:c.cs_id, date:c.cdate, reason:c.reason||"" }));
      },
      async addHours(rows) {
        const { error } = await client.from("rsv2_hours").insert(rows.map(h => ({
          clinic_id:h.clinicId, cs_id:h.csId, weekday:h.weekday,
          open_time:h.openTime, close_time:h.closeTime, slot_min:h.slotMin||30 })));
        if (error) throw error;
      },
      async removeHours(id)   { const { error } = await client.from("rsv2_hours").delete().eq("id", id); if (error) throw error; },
      async clearHours(csId)  { const { error } = await client.from("rsv2_hours").delete().eq("cs_id", csId); if (error) throw error; },
      async addClosure(c)     { const { error } = await client.from("rsv2_closures").insert({ clinic_id:c.clinicId, cs_id:c.csId ?? null, cdate:c.date, reason:c.reason||null }); if (error) throw error; },
      async removeClosure(id) { const { error } = await client.from("rsv2_closures").delete().eq("id", id); if (error) throw error; },
    };
  }

  function makeLocalBackend() {
    /* ---- ローカル バックエンド（localStorage + BroadcastChannel） ---- */
    const LS_KEY = "rsv2.reservations";
    const RES_KEY = "rsv2.resources";
    const HR_KEY  = "rsv2.hours";        // 診療時間（既定は空＝TEMPLATESを使う）
    const CL_KEY  = "rsv2.closures";     // 休診日
    const lsList = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
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
      async refresh() { _cache = load(); },
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
      /* --- 非患者ブロック（localStorage） --- */
      async removeBlock(group){ const l=load().filter(x=>x.blockGroup!==group); save(l); _cache=l; fire({type:"reservation",at:Date.now()}); },
      /* --- 診療時間・休診日（localStorage。既定は空＝ハードコードのTEMPLATESを使う） --- */
      async loadHours(){ try{ return JSON.parse(localStorage.getItem(HR_KEY)||"[]"); }catch{ return []; } },
      async loadClosures(){ try{ return JSON.parse(localStorage.getItem(CL_KEY)||"[]"); }catch{ return []; } },
      async addHours(rows){ const l=lsList(HR_KEY); let id=Math.max(0,...l.map(x=>x.id||0)); rows.forEach(h=>l.push(Object.assign({id:++id, active:true}, h))); localStorage.setItem(HR_KEY,JSON.stringify(l)); },
      async removeHours(id){ localStorage.setItem(HR_KEY, JSON.stringify(lsList(HR_KEY).filter(x=>x.id!==id))); },
      async clearHours(csId){ localStorage.setItem(HR_KEY, JSON.stringify(lsList(HR_KEY).filter(x=>Number(x.csId)!==Number(csId)))); },
      async addClosure(c){ const l=lsList(CL_KEY); const id=Math.max(0,...l.map(x=>x.id||0))+1; l.push({id, clinicId:c.clinicId, csId:c.csId??null, date:c.date, reason:c.reason||""}); localStorage.setItem(CL_KEY,JSON.stringify(l)); },
      async removeClosure(id){ localStorage.setItem(CL_KEY, JSON.stringify(lsList(CL_KEY).filter(x=>x.id!==id))); },
    };
  }

  /* ---------- 接続不可バックエンド（★Wave1で新設） ----------
     Supabase を使う設定なのに接続できなかった場合に使う。書き込みは必ず失敗させる。
     ・以前はここで localStorage へ黙って保存し、患者へ「予約完了」と表示していた。
       院に予約が届いていないのに患者が予約できたと思い込む事故につながるため廃止した。 */
  function makeUnavailableBackend(cause) {
    const fail = () => {
      const e = new Error("予約データベース（Supabase）へ接続できていません: " + ((cause && cause.message) || "原因不明"));
      e.__rsvOffline = true;
      throw e;
    };
    return {
      async init() {},
      async refresh() {},                       // 取り直せるものが無い（キャッシュは空のまま）
      async insert() { fail(); },
      async setStatus() { fail(); },
      async setRoom() { fail(); },
      async assignResource() { fail(); },
      async reschedule() { fail(); },
      async resetDemo() { fail(); },
      async loadResources() { return []; },
      async getNote() { return ""; },
      async saveNote() { fail(); },
      async addResource() { fail(); },
      async renameResource() { fail(); },
      async removeResource() { fail(); },
      async removeBlock() { fail(); },
      async loadHours() { return []; },
      async loadClosures() { return []; },
      async addHours() { fail(); },
      async removeHours() { fail(); },
      async clearHours() { fail(); },
      async addClosure() { fail(); },
      async removeClosure() { fail(); },
    };
  }

  /* ---------- バックエンド確定 ----------
     ・Supabaseを使う設定（__RSV_SUPABASE__ && supabase-js 読込済）→ Supabase。失敗したら「接続不可」。
       ★ローカル保存へ黙ってフォールバックしない（失敗は必ず利用者に見せる）。
     ・そもそもSupabaseを使わない設定（file://・CDN不達 等）→ 従来どおりローカル同期（デモ用）。 */
  let backend = makeLocalBackend();   // 既定
  let backendError = null;            // 接続不可のときの分類結果（UIの警告表示に使う）
  const ready = (async () => {
    if (USE_SUPABASE) {
      try {
        const sb = makeSupabaseBackend();
        await sb.init();
        backend = sb; backendName = "supabase";
      } catch (e) {
        backendError = classifyError(e);
        logFail("Supabaseへの接続", backendError, e);
        backend = makeUnavailableBackend(e); backendName = "offline";
        _cache = [];
      }
    } else if (WANT_SUPABASE) {
      // Supabaseを使う画面なのに supabase-js（CDN）が読み込めていない。
      // ここでローカル保存に落ちると、院に届いていないのに「予約完了」と表示されてしまうため接続不可として扱う。
      const e = new Error("予約システムの読み込みに失敗しました（supabase-js を取得できませんでした）");
      e.__rsvOffline = true;
      backendError = classifyError(e);
      logFail("予約システムの読み込み", backendError, e);
      backend = makeUnavailableBackend(e); backendName = "offline";
      _cache = [];
    } else {
      await backend.init(); backendName = "local";
    }
    try { _resources = await backend.loadResources(); } catch { _resources = []; }
    try { _hours    = await backend.loadHours(); }    catch { _hours = []; }
    try { _closures = await backend.loadClosures(); } catch { _closures = []; }
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
  async function saveNote(clinicId, date, note) {
    try { await backend.saveNote(clinicId, date, note); return { ok:true }; }
    catch (e) { const info = classifyError(e); logFail("連絡事項の保存", info, e); return { ok:false, reason: info.reason }; }
  }

  /* =========================================================
     診療時間・休診日 の編集API（受付ボードの「診療時間・休診日」タブから呼ぶ）
     ・保存に失敗したら必ず {ok:false,error} を返す（黙って成功にしない）
     ========================================================= */
  async function refreshHours() {
    try { _hours = await backend.loadHours(); } catch { _hours = []; }
    try { _closures = await backend.loadClosures(); } catch { _closures = []; }
  }
  async function hoursOp(op, fn, failMsg) {
    try { await fn(); } catch (e) { return await failResult(op, e, failMsg); }
    await refreshHours(); dispatch({ type: "hours", at: Date.now() });
    return { ok: true };
  }
  // 診療時間の1行追加（院×区分×曜日×開始/終了/刻み）
  function addHours(csId, weekday, openTime, closeTime, slotMin) {
    const c = clinicOfCs(csId);
    if (!c) return Promise.resolve({ ok:false, error:"診療区分が不正です。" });
    if (_toMin(closeTime) <= _toMin(openTime)) return Promise.resolve({ ok:false, error:"終了時刻は開始時刻より後にしてください。" });
    return hoursOp("診療時間の追加",
      () => backend.addHours([{ clinicId:c.id, csId, weekday:Number(weekday), openTime, closeTime, slotMin:Number(slotMin)||30 }]),
      "診療時間を保存できませんでした。");
  }
  function removeHours(id) { return hoursOp("診療時間の削除", () => backend.removeHours(id), "診療時間を削除できませんでした。"); }
  // 現在の既定（ハードコードの診療時間）を取り込んで編集可能にする
  function importDefaultHours(csId) {
    const rows = defaultHoursOf(csId);
    if (!rows.length) return Promise.resolve({ ok:false, error:"取り込める既定の診療時間がありません。" });
    return hoursOp("既定の診療時間の取り込み", () => backend.addHours(rows), "診療時間を保存できませんでした。");
  }
  // その区分の設定を全消し＝既定（ハードコード）へ戻す
  function resetHours(csId) { return hoursOp("診療時間の初期化", () => backend.clearHours(csId), "診療時間を初期化できませんでした。"); }
  // 臨時休診の登録／解除（csId=null で院全体）
  function addClosure(clinicId, csId, date, reason) {
    if (!date) return Promise.resolve({ ok:false, error:"日付を選んでください。" });
    return hoursOp("休診日の登録", () => backend.addClosure({ clinicId, csId: csId||null, date, reason }), "休診日を保存できませんでした。");
  }
  function removeClosure(id) { return hoursOp("休診日の解除", () => backend.removeClosure(id), "休診日を解除できませんでした。"); }

  /* =========================================================
     非患者ブロック（休憩・機材メンテ・院内業務）の登録／削除
     ・30分ごとに1行を作り、同じ block_group でまとめる
       → ブロックが覆うすべての枠に、既存の一意インデックス3本がそのまま効く
     ・患者情報は一切持たない（氏名・電話は不要）
     ========================================================= */
  async function createBlock(input) {
    const kind = input.kind || "BREAK";
    if (!BLOCK_KINDS.some(k => k.kind === kind)) return { ok:false, error:"ブロックの種別が不正です。" };
    const st = _toMin(input.startTime), en = _toMin(input.endTime);
    if (!(en > st)) return { ok:false, error:"終了時刻は開始時刻より後にしてください。" };
    if (en - st > 12*60) return { ok:false, error:"1件のブロックは12時間までにしてください。" };
    const group = "BG" + genCode();
    const rows = [];
    for (let m = st; m < en; m += BLOCK_STEP) {
      rows.push(mkRes({
        kind, blockGroup: group, csId: input.csId, date: input.date, time: _hhmm(m),
        roomId: input.roomId ?? null, staffId: input.staffId ?? null, deviceId: input.deviceId ?? null,
        note: (input.label || "").trim() || blockKindLabel(kind), channel: "STAFF",
      }));
    }
    const done = [];
    for (const r of rows) {
      try { await backend.insert(r); done.push(r); }
      catch (e) {
        // 途中で失敗（＝その枠に既に予約/別ブロックがある）→ 作りかけを取り消して、まとめて失敗にする
        try { if (done.length) await backend.removeBlock(group); } catch (e2) { console.warn("[予約システム] ブロックの巻き戻しに失敗:", e2 && e2.message); }
        _cache = _cache.filter(x => x.blockGroup !== group);
        const info = classifyError(e);
        logFail("ブロックの登録", info, e);
        await refreshReservations();
        return { ok:false, reason: info.reason,
          error: info.reason === "DUPLICATE"
            ? "その時間帯には既に予約またはブロックが入っています（" + _hhmm(_toMin(r.time)) + "）。"
            : (info.reason === "OFFLINE" ? ERR_MSG.offline : "ブロックを登録できませんでした。") };
      }
    }
    dispatch({ type: "reservation", at: Date.now() });
    return { ok:true, group, rows: done.length };
  }
  async function removeBlock(group) {
    try { await backend.removeBlock(group); }
    catch (e) { return await failResult("ブロックの削除", e, "ブロックを削除できませんでした。"); }
    dispatch({ type: "reservation", at: Date.now() });
    return { ok:true };
  }

  /* ---------- 公開API（UIが呼ぶ） ---------- */

  async function createReservation(input) {
    const slotId = `${input.csId}_${input.date}_${input.time}`;
    // 休診日（臨時休診・診療時間の設定なし）は理由がわかる文言で断る
    if (daySlotTimes(input.csId, input.date).length === 0) {
      const cl = closureOn(input.csId, input.date);
      return { ok: false, reason: "CLOSED",
        error: cl ? `この日は休診です（${cl.reason || "臨時休診"}）。別の日をお選びください。`
                  : "この日は診療日ではありません。別の日をお選びください。" };
    }
    if (slotRemaining(slotId) <= 0) return { ok: false, error: "この枠は満員です。別の日時をお選びください。" };
    const dup = _cache.find(r => r.status === "CONFIRMED" && !isBlock(r) && r.date === input.date && r.time === input.time
      && String(r.phone||"").replace(/-/g,"") === String(input.phone||"").replace(/-/g,"") && r.name === input.name);
    if (dup) return { ok: false, error: "同じ日時に既にご予約があります。" };
    if (input.roomId == null) input.roomId = freeRoom(input.csId, input.date, input.time);  // 空き診察室を自動割当
    // スタッフ・機材の被りチェック（受付が指定した場合）
    const st = _toMin(input.time), en = st + durMin({ csId: input.csId, menuId: input.menuId });
    if (input.staffId && resourceConflict("staff", Number(input.staffId), input.date, st, en))
      return { ok: false, error: "選択したスタッフはその時間帯に別の予約があります。" };
    if (input.deviceId && resourceConflict("device", Number(input.deviceId), input.date, st, en))
      return { ok: false, error: "選択した機材はその時間帯に別の予約で使用中です。" };
    const r = mkRes(input);
    // ★予約番号は「保存が成功してから」確定・表示する（失敗したのに番号は出さない）
    try { await backend.insert(r); }
    catch (e) { return await failResult("予約の登録", e, ERR_MSG.createFail); }
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
      // 列そのものが無い環境（DB未整備）は従来どおり COL_MISSING を返す
      if (!e.code && !e.__rsvOffline && /staff_id|device_id/.test(e && e.message || "")) return { ok: false, reason: "COL_MISSING", error: "COL_MISSING" };
      return await failResult((kind === "staff" ? "担当" : "機材") + "の割当", e, ERR_MSG.saveFail);
    }
    return { ok: true };
  }
  // 時刻の移動（ドラッグ）。満員・スタッフ/機材の被りは拒否。
  async function moveReservation(code, newTime) {
    const res = _cache.find(x => x.code === code && x.status === "CONFIRMED");
    if (!res) return { ok: false, error: "予約が見つかりません。" };
    if (isBlock(res)) return { ok: false, error: "ブロックは移動できません。いったん削除して、登録し直してください。" };
    if (newTime === res.time) return { ok: true };
    const s = _toMin(newTime), e = s + durMin(res);
    // 移動先の空き＝定員 − 患者予約 − ブロック（自分自身は除外して数える）
    if (slotAvail(res.csId, res.date, newTime, code).remaining <= 0)
      return { ok: false, error: "移動先の枠は満員（またはブロック中）です。" };
    if (res.staffId && resourceConflict("staff", res.staffId, res.date, s, e, code)) return { ok: false, error: "移動先の時間は担当スタッフが別予約と重複します。" };
    if (res.deviceId && resourceConflict("device", res.deviceId, res.date, s, e, code)) return { ok: false, error: "移動先の時間は機材が別予約で使用中です。" };
    try { await backend.reschedule(code, newTime); }
    catch (e2) { return await failResult("予約時刻の移動", e2, ERR_MSG.moveFail); }
    return { ok: true };
  }
  // 診察室の切り替え（対象室に別の予約があれば入れ替え）
  async function setRoom(code, targetRoomId) {
    targetRoomId = Number(targetRoomId);
    const res = _cache.find(x => x.code === code && x.status === "CONFIRMED");
    if (!res) return { ok: false, error: "予約が見つかりません。" };
    // ★対象は「その院に登録されている部屋リソース」であること（Wave2：台帳が正）
    if (!roomsOfCs(res.csId).some(r => Number(r.id) === targetRoomId)) return { ok: false, error: "診察室の指定が不正です。" };
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
        return { ok: false, reason: "COL_MISSING", error: "診察室の変更を保存できません（DBに room_id 列の追加が必要です）。" };
      return await failResult("診察室の変更", e, ERR_MSG.saveFail);
    }
    return { ok: true, swapped: !!other };
  }
  async function cancelReservation(code, phone) {
    const r = _cache.find(x => x.code === (code||"").toUpperCase().trim());
    if (!r || r.phone.replace(/-/g,"") !== (phone||"").replace(/-/g,"").trim())
      return { ok: false, error: "予約が見つかりません。予約番号と電話番号をご確認ください。" };
    if (r.status !== "CONFIRMED") return { ok: false, error: "この予約はすでにキャンセル済みです。" };
    try { await backend.setStatus(r.code, "CANCELLED"); }
    catch (e) { return await failResult("予約のキャンセル", e, ERR_MSG.cancelFail); }
    return { ok: true };
  }
  // 状態変更（来院済/取消/戻す）。★失敗を握りつぶさず結果を返す（呼び出し側が必ず表示する）
  async function updateStatus(code, status) {
    try { await backend.setStatus(code, status); }
    catch (e) { return await failResult("予約状態の変更", e, ERR_MSG.saveFail); }
    return { ok: true };
  }

  return {
    CLINICS, MENUS, WD, BLOCK_KINDS, BLOCK_STEP,
    // 非患者ブロック（休憩・機材メンテ・院内業務）
    isBlock, blockLabel, blockKindLabel, createBlock, removeBlock,
    // 診療時間・休診日
    hoursOf, hasHours, closuresOf, closureOn, isClosed, daySlotTimes, slotStepOf, defaultHoursOf,
    addHours, removeHours, importDefaultHours, resetHours, addClosure, removeClosure, refreshHours,
    slotAvail,
    getBackend: () => backendName,                                   // "supabase" | "local" | "offline"
    isOffline: () => backendName === "offline",                      // 予約の正本に書けない状態
    getBackendError: () => backendError,                             // {reason,code,message,details}
    refreshReservations,                                             // 明示的な再読込（UIから呼べる）
    todayStr, addDays, fmtJa, weekday,
    clinicOfCs, serviceOfCs, menusOfCs, menuById,
    roomsOf, roomsOfCs, capacityOfCs, roomOf, roomName, roomIndex, freeRoom, durMin, resourceConflict,
    getDays, createReservation, setRoom, assignResource, moveReservation, findReservation, cancelReservation, updateStatus,
    dayReservations, loadReservations,
    resourcesOf, refreshResources, addResource, renameResource, removeResource, getNote, saveNote,
    onSync, ready,
    async resetDemo() {
      try { await backend.resetDemo(); return { ok:true }; }
      catch (e) { return await failResult("デモ初期化", e, ERR_MSG.saveFail); }
    },
  };
})();
