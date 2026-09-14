-- =============================================================
-- クリニック予約システム（prototype2）Supabase スキーマ定義
--   プロジェクト: vypwgxkqtxuzqfaaeamf （新HDG・東京リージョン）
--   ※ 旧プロジェクト dyjhxkqzxibcpgoefbiv ではない。2026-07-24 に参照先を新HDGへ切替済み。
--   最終更新: 2026-08-12（Wave3：非患者ブロックの kind 列／診療時間・休診日の2表を追加）
--
--   対象テーブル（すべて rsv2_ プレフィックス。カルテ本番テーブルとは完全に分離）
--     - public.rsv2_reservations … 予約1件＝1行（kind='PATIENT' 以外は非患者ブロック）
--     - public.rsv2_resources    … 院ごとのリソース台帳（部屋／スタッフ／機材）
--     - public.rsv2_daily_notes  … 受付ボードの当日連絡事項（院×日付で1行）
--     - public.rsv2_hours        … 院×診療区分×曜日の診療時間（0件なら store.js の既定を使う）
--     - public.rsv2_closures     … 休診日（臨時休診。cs_id が NULL なら院全体）
--
--   このファイルは冪等（create ... if not exists / add column if not exists /
--   create unique index if not exists）。何度実行しても既存データを壊さない。
--   実データを消す文（drop table / 無条件 delete）は含めない。
--   シード再投入も code like 'SEED%' の偽データだけを対象にする。
-- =============================================================


-- #############################################################
-- # ⚠⚠⚠ 重大警告：現在のRLSは「anonキーがあれば誰でも全操作できる」状態 ⚠⚠⚠
-- #
-- # 下の「4. RLS」ブロックで定義しているポリシーは、デモ用の偽データを
-- # 前提に作られたものが、そのまま残っているだけである。実物の権限は
-- #   rsv2_reservations : policy anon_all           / role anon   / ALL / using true / with check true
-- #   rsv2_resources    : policy rsv2_resources_all / role public / ALL / using true / with check true
-- #   rsv2_daily_notes  : policy rsv2_notes_all     / role public / ALL / using true / with check true
-- # であり、これは
-- #   「公開されている anon キーを1つ持っているだけで、第三者が
-- #     全予約の氏名・電話・生年月日・メールを閲覧でき、内容の改ざんも
-- #     全件削除もできる」
-- # ことを意味する。
-- #
-- # ★ この権限のままで、実際の患者の予約を受け付けてはならない。★
-- #
-- # テスト院で運用を開始する前に、必ず次のRLS絞り込みを実施すること：
-- #   (1) スタッフ（受付ボード）… Supabase Auth でログインさせ、
-- #       authenticated かつ自院（clinic_id）の行だけに限定する。
-- #       受付ボードを無認証で開けるようにしてはならない。
-- #   (2) 患者（予約ページ）… 自分の予約だけを参照・取消できるようにする
-- #       （予約コード＋本人確認、または LINE ログインの line_user_id 一致）。
-- #   (3) anon（未ログイン）… 氏名等のPIIを一切含まない「空き枠情報」だけを
-- #       返す。予約テーブルの直接SELECTは与えず、空き枠を返すビュー or
-- #       RPC（security definer）経由に限定する。
-- #
-- # 対応予定: 次のWave（本ファイルの現状化と同じ 2026-08-12 に課題として起票）
-- #############################################################


-- =============================================================
-- 1. 予約本体 public.rsv2_reservations
--    予約1件＝1行。主キーは予約番号 code（crypto乱数で発行）。
--    実物では code 以外はすべて NULL 許容（画面側の入力チェックに依存している）。
--    room_id / staff_id / device_id は rsv2_resources.id を指すが、
--    実物に外部キー制約は張られていない（リソース削除時の整合は画面側の責任）。
--    ※ room_id は 2026-08-12(Wave2) までは「1/2＝何番目の診察室か」を入れる smallint
--       だった。仕様書v2 §3.2-B に従い rsv2_resources.id（bigint）へ付け替えた。
--       移行SQL: sql/2026-08-12_w2_room_id_to_resource_id.sql（適用済み・冪等）
-- =============================================================
create table if not exists public.rsv2_reservations (
  code        text primary key,          -- 予約番号（crypto乱数で発行）
  cs_id       integer,                   -- クリニック×診療区分ID
  slot_id     text,                      -- 枠ID  "csId_YYYY-MM-DD_HH:MM"
  rdate       text,                      -- 予約日   "YYYY-MM-DD"
  rtime       text,                      -- 予約時刻 "HH:MM"
  name        text,
  kana        text,
  phone       text,
  birth       text,
  email       text,
  visit_type  text,                      -- FIRST / REVISIT
  menu_id     integer,                   -- 美容メニューID
  note        text,
  status      text default 'CONFIRMED',  -- CONFIRMED / CANCELLED / VISITED
  channel     text default 'WEB',        -- WEB / PHONE / LINE
  sent_at     bigint,                    -- 送信時刻(ms)＝レイテンシ計測用
  created_at  timestamptz default now(),
  room_id     bigint,                    -- 診察室（rsv2_resources.id / kind='room'）
  line_user_id text,                     -- LINEログイン(LIFF)のユーザーID
  staff_id    bigint,                    -- 担当スタッフ（rsv2_resources.id / kind='staff'）
  device_id   bigint,                    -- 使用機材（rsv2_resources.id / kind='device'）
  kind        text not null default 'PATIENT',  -- PATIENT=患者予約 / BREAK=休憩 / MAINT=機材メンテ / OTHER=院内業務
  block_group text                       -- 非患者ブロックのまとまり（30分ごとに1行・同じ休憩は同じ値）
);

-- 既存テーブルへの後付け（作成済み環境でも列を揃えるため。既にあれば無視）
alter table public.rsv2_reservations add column if not exists room_id      bigint;
-- 旧環境（smallint で作成済み）を新しい型へ揃える。既に bigint なら実質no-op。
alter table public.rsv2_reservations alter column room_id type bigint;
alter table public.rsv2_reservations add column if not exists line_user_id text;
alter table public.rsv2_reservations add column if not exists staff_id     bigint;
alter table public.rsv2_reservations add column if not exists device_id    bigint;
-- Wave3（2026-08-12）: 非患者ブロック（仕様書v2 §3.6-A）。正＝sql/2026-08-12_w3_block_kind.sql
alter table public.rsv2_reservations add column if not exists kind         text not null default 'PATIENT';
alter table public.rsv2_reservations add column if not exists block_group  text;

do $$ begin
  alter table public.rsv2_reservations
    add constraint rsv2_reservations_kind_check
    check (kind = any (array['PATIENT','BREAK','MAINT','OTHER']));
exception when duplicate_object then null; end $$;

-- ブロック行に患者PIIを入れさせない（仕様書v2 §3.6-A）
do $$ begin
  alter table public.rsv2_reservations
    add constraint rsv2_reservations_block_no_pii
    check (
      kind = 'PATIENT'
      or (name is null and kana is null and phone is null and birth is null
          and email is null and line_user_id is null and visit_type is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists ix_rsv2_block_group
  on public.rsv2_reservations (block_group) where block_group is not null;


-- =============================================================
-- 2. リソース台帳 public.rsv2_resources
--    受付ボードの「リソース設定」画面（2026-07-29 実装）で ＋−して増減する、
--    院ごとの部屋／スタッフ／機材のマスタ。タイムラインの3軸はこれを行に使う。
--    id は identity（GENERATED BY DEFAULT AS IDENTITY／内部シーケンス
--    rsv2_resources_id_seq）。画面からの insert では id を省略して自動採番させる。
--    kind は CHECK 制約 rsv2_resources_kind_check で room/staff/device に限定。
--    ※ (clinic_id, kind, name) の一意制約は実物に無い＝同名の重複登録が可能。
-- =============================================================
create table if not exists public.rsv2_resources (
  id         bigint generated by default as identity primary key,
  clinic_id  integer     not null,       -- 院ID（1=西春 / 2=横浜 / 3=千葉 / 4=中川）
  kind       text        not null,       -- 'room' | 'staff' | 'device'
  name       text        not null,       -- 表示名（例: 部屋A / スタッフA / 機材A）
  sort_order integer     not null default 0,   -- タイムラインでの並び順
  active     boolean     not null default true, -- false で非表示（行は残す）
  created_at timestamptz not null default now(),
  constraint rsv2_resources_kind_check check (kind = any (array['room','staff','device']))
);

-- 既存テーブルへの後付け（作成済み環境でも列を揃えるため）
alter table public.rsv2_resources add column if not exists sort_order integer     not null default 0;
alter table public.rsv2_resources add column if not exists active     boolean     not null default true;
alter table public.rsv2_resources add column if not exists created_at timestamptz not null default now();

-- ※ リソースのシードは投入しない。実物は4院×(部屋2/スタッフ2/機材2)=24行が
--    既に登録済みで、name に一意制約が無いため再投入すると重複が増えてしまう。


-- =============================================================
-- 3. 当日連絡事項 public.rsv2_daily_notes
--    受付ボードの「連絡事項」欄（2026-07-29 実装 / commit 82b037a）。
--    院×日付で1行だけ持ち、上書き保存する（upsert 前提なので複合主キー）。
-- =============================================================
create table if not exists public.rsv2_daily_notes (
  clinic_id  integer     not null,       -- 院ID
  ndate      text        not null,       -- 対象日 "YYYY-MM-DD"
  note       text,                       -- 連絡事項の本文（自由記述）
  updated_at timestamptz not null default now(),
  primary key (clinic_id, ndate)
);


-- =============================================================
-- 3.5 移行の適用記録 public.rsv2_migrations（2026-08-12 Wave2 で新設）
--    データ移行SQLを何度実行しても安全（冪等）にするための適用済みキー台帳。
--    値だけを見ても移行済みか判定できない移行（例: room_id の付け替え）で使う。
-- =============================================================
create table if not exists public.rsv2_migrations (
  key        text primary key,                     -- 移行の識別キー（SQLファイル名相当）
  applied_at timestamptz not null default now(),
  note       text
);


-- =============================================================
-- 3.6 診療時間 public.rsv2_hours ／ 休診日 public.rsv2_closures
--     （2026-08-12 Wave3 で新設。正＝sql/2026-08-12_w3_hours_closures.sql）
--     行が1件も無い診療区分は store.js の TEMPLATES（ハードコード）で動く＝
--     「設定が無い状態では今までと同じ枠が出る」。データはここでは投入しない。
-- =============================================================
create table if not exists public.rsv2_hours (
  id         bigint generated by default as identity primary key,
  clinic_id  integer     not null,
  cs_id      integer     not null,        -- 診療区分ID（11=西春外来 …）
  weekday    smallint    not null,        -- 0=日 … 6=土（行が無い曜日＝休診）
  open_time  text        not null,        -- 'HH:MM'
  close_time text        not null,        -- 'HH:MM'（この時刻ちょうどの枠は作らない）
  slot_min   integer     not null default 30,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  -- 0=日 … 6=土 / 7=祝日（2026-08-17 Wave6。祝日は weekday=7 の行だけを見る）
  constraint rsv2_hours_weekday_check check (weekday between 0 and 7),
  constraint rsv2_hours_slot_check    check (slot_min between 5 and 240)
);
create unique index if not exists uq_rsv2_hours_row on public.rsv2_hours (clinic_id, cs_id, weekday, open_time);
create index if not exists ix_rsv2_hours_cs on public.rsv2_hours (cs_id, weekday) where active;

create table if not exists public.rsv2_closures (
  id         bigint generated by default as identity primary key,
  clinic_id  integer     not null,
  cs_id      integer,                     -- NULL = 院全体
  cdate      text        not null,        -- 'YYYY-MM-DD'
  reason     text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_rsv2_closures_day on public.rsv2_closures (clinic_id, coalesce(cs_id, 0), cdate);
create index if not exists ix_rsv2_closures_date on public.rsv2_closures (clinic_id, cdate);


-- =============================================================
-- 3.7 メニュー台帳 public.rsv2_menus ／ 使う機材・担当 public.rsv2_menu_resources
--     （2026-08-13 Wave4 で新設）
--     ・rsv2_menus が無い診療区分は store.js の FALLBACK_MENUS を使う＝設定ゼロでも退行しない
--     ・rsv2_menu_resources は「このメニューで使える機材／担当の候補」。
--       ★同型機を2台登録しておくと、1台が埋まっていてももう1台で予約を受けられる
--       ＝要望③「機材被りがなく最大の予約が取れる」の中身。
--     ・予約作成時に候補から空いているものを自動確保する（store.js freeResourceFor）。
--       空きが無ければ何も割り当てない＝予約は通す（従来より予約が減ることはない）。
-- =============================================================
create table if not exists public.rsv2_menus (
  id                 bigint generated by default as identity primary key,
  cs_id              integer not null,                     -- 院×診療区分（例: 34 = 千葉/美容）
  name               text    not null,
  price              integer,
  first_visit_price  integer,
  duration_min       integer not null default 30 check (duration_min between 5 and 480),
  concerns           text,
  catch              text,
  downtime           text,
  staff_type         text,
  popular            boolean not null default false,
  sort_order         integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists ix_rsv2_menus_cs on public.rsv2_menus (cs_id, sort_order, id) where active;
create unique index if not exists uq_rsv2_menus_name on public.rsv2_menus (cs_id, name);

create table if not exists public.rsv2_menu_resources (
  menu_id      bigint not null references public.rsv2_menus(id)     on delete cascade,
  resource_id  bigint not null references public.rsv2_resources(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (menu_id, resource_id)
);
create index if not exists ix_rsv2_menu_res_menu on public.rsv2_menu_resources (menu_id);

-- 3.8 リソース × 診療区分 public.rsv2_resource_services（2026-08-17 Wave6）
--     「この部屋（機材・スタッフ）はどの診療区分で使うか」。
--     ★行が1件も無いリソースは全区分で使える（設定しない院は挙動が変わらない）。
--     部屋をここで絞ると、その区分の「1枠あたりの定員」もその部屋数になる
--     （千葉に実名で8室登録したとき、外来の定員まで8になってしまうのを防ぐ）。
create table if not exists public.rsv2_resource_services (
  resource_id bigint      not null references public.rsv2_resources(id) on delete cascade,
  cs_id       integer     not null,
  created_at  timestamptz not null default now(),
  primary key (resource_id, cs_id)
);
create index if not exists ix_rsv2_res_svc_cs on public.rsv2_resource_services (cs_id);

-- 3.9 診療区分ごとの同時予約の上限 public.rsv2_service_limits（2026-08-17 Wave7）
--     枠の定員は「その区分で使う部屋の数」が基本だが、部屋があっても人手が足りない場合がある。
--     例）千葉の美容は処置室4＋医師施術室2＋CSルーム＝7室あるが、スタッフの都合で同時3枠まで。
--     ★既定は3件（store.js の DEFAULT_CONCURRENT）。この表に行がある区分だけ max_concurrent で上書き。
--       部屋数では縛らない（部屋より多く受けた分は「未割当」として入り、受付が割り当てる）。
create table if not exists public.rsv2_service_limits (
  cs_id          integer     primary key,
  max_concurrent integer     not null check (max_concurrent between 1 and 99),
  note           text,
  updated_at     timestamptz not null default now()
);


-- =============================================================
-- 4. 二重予約の拒否（部分一意インデックス3本 / 2026-08-12 追加）
--    背景: それまで二重予約の防止は画面側チェックのみで、同時実行だと貫通した
--          （同一 slot_id・同一 room_id を2件POSTして 201/201 で両方成功を実測）。
--    方式: 予約枠が「15分固定枠 = slot_id」なので、範囲重なり判定(EXCLUDE)ではなく
--          部分一意インデックスで足りる。取消済み(CANCELLED)は対象外、未割当(NULL)も対象外。
--          所要時間が可変になった段階で btree_gist + tstzrange の EXCLUDE 制約へ移行する。
--    正: 一次ソースは sql/2026-08-12_w1_unique_constraints.sql（本番適用済み）。
--    ロールバック: drop index if exists uq_rsv2_room_slot, uq_rsv2_staff_slot, uq_rsv2_device_slot;
-- =============================================================

-- 部屋（診察室）: 同じ枠の同じ部屋に2件入れない
create unique index if not exists uq_rsv2_room_slot
  on public.rsv2_reservations (room_id, slot_id)
  where room_id is not null and (status is null or status <> 'CANCELLED');

-- スタッフ（医師・看護師・施術者）: 同じ枠に同じ担当を2件割り当てない
create unique index if not exists uq_rsv2_staff_slot
  on public.rsv2_reservations (staff_id, slot_id)
  where staff_id is not null and (status is null or status <> 'CANCELLED');

-- 機材（脱毛機・ハイフ等）: 同じ枠に同じ機材を2件割り当てない
create unique index if not exists uq_rsv2_device_slot
  on public.rsv2_reservations (device_id, slot_id)
  where device_id is not null and (status is null or status <> 'CANCELLED');

-- ★この3本は where 句に kind を含めない。したがって非患者ブロック（BREAK/MAINT/OTHER）にも
--   そのまま効き、「同じ枠の同じ部屋／担当／機材に、ブロックと患者予約が重なる」ことを拒否する。
--   ブロックは30分ごとに1行で作る（store.js createBlock）ので、ブロックが覆う全ての枠が対象になる。


-- =============================================================
-- 5. RLS（★冒頭の重大警告を必ず読むこと。現状＝誰でも全操作できる）
--    RLS自体は3表とも有効。ただしポリシーが using true / with check true の
--    全許可なので、実質的に無防備。ここは「現状の記録」であって
--    「これで良い」という意味ではない。次のWaveで絞り込む。
-- =============================================================
alter table public.rsv2_reservations enable row level security;
alter table public.rsv2_resources    enable row level security;
alter table public.rsv2_daily_notes  enable row level security;
alter table public.rsv2_hours        enable row level security;
alter table public.rsv2_closures     enable row level security;
alter table public.rsv2_menus          enable row level security;
alter table public.rsv2_menu_resources enable row level security;
alter table public.rsv2_resource_services enable row level security;
alter table public.rsv2_service_limits    enable row level security;

-- 予約本体: role=anon に対する全許可（実物のポリシー名は anon_all）
drop policy if exists rsv2_anon_all on public.rsv2_reservations;  -- 旧名の残骸があれば掃除
drop policy if exists anon_all on public.rsv2_reservations;
create policy anon_all on public.rsv2_reservations
  for all to anon using (true) with check (true);

-- リソース台帳: role=public に対する全許可
drop policy if exists rsv2_resources_all on public.rsv2_resources;
create policy rsv2_resources_all on public.rsv2_resources
  for all to public using (true) with check (true);

-- 当日連絡事項: role=public に対する全許可
drop policy if exists rsv2_notes_all on public.rsv2_daily_notes;
create policy rsv2_notes_all on public.rsv2_daily_notes
  for all to public using (true) with check (true);

-- 診療時間・休診日: role=public に対する全許可
--   ★患者PIIは含まないが、「第三者が院を臨時休診にできる」状態ではある（Wave1で絞る）
drop policy if exists rsv2_hours_all on public.rsv2_hours;
create policy rsv2_hours_all on public.rsv2_hours
  for all to public using (true) with check (true);

drop policy if exists rsv2_closures_all on public.rsv2_closures;
create policy rsv2_closures_all on public.rsv2_closures
  for all to public using (true) with check (true);

-- メニュー台帳・使う機材の紐づけ: role=public に対する全許可（Wave1で認証と一緒に絞る）
drop policy if exists rsv2_menus_all on public.rsv2_menus;
create policy rsv2_menus_all on public.rsv2_menus
  for all to public using (true) with check (true);

drop policy if exists rsv2_menu_res_all on public.rsv2_menu_resources;
create policy rsv2_menu_res_all on public.rsv2_menu_resources
  for all to public using (true) with check (true);

drop policy if exists rsv2_res_svc_all on public.rsv2_resource_services;
create policy rsv2_res_svc_all on public.rsv2_resource_services
  for all to public using (true) with check (true);
drop policy if exists rsv2_svc_limits_all on public.rsv2_service_limits;
create policy rsv2_svc_limits_all on public.rsv2_service_limits
  for all to public using (true) with check (true);


-- =============================================================
-- 6. Realtime 配信対象
--    実物では rsv2_reservations と rsv2_resources のみ supabase_realtime に
--    含まれている（rsv2_daily_notes は含まれない＝連絡事項は保存時に再取得する運用）。
--    ※ Realtime(postgres_changes) の購読には レガシー anon JWT (eyJ...) が必要。
--      新形式の公開キー sb_publishable_... ではイベントが配信されない（2026-07-17 実証）。
-- =============================================================
do $$ begin
  alter publication supabase_realtime add table public.rsv2_reservations;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.rsv2_resources;
exception when duplicate_object then null; end $$;


-- =============================================================
-- 7. シード（デモ用の偽データ。code が 'SEED' で始まる行だけを入れ直す）
--    ここ以外に delete は書かない。実データ（ランダムな8桁コードの予約）は消さない。
--    on conflict do nothing … 4章の部分一意インデックスと衝突した場合も落とさない。
--    ★room_id は「1／2」の直値ではなく rsv2_resources から引く（2026-08-12 Wave3 で修正）。
--      Wave2 で room_id の意味が「何番目の部屋か」→「rsv2_resources.id」に変わったため、
--      直値のままだと西春(clinic_id=1)の2室目に 横浜の部屋A(id=2) が入ってしまっていた。
-- =============================================================
delete from public.rsv2_reservations where code like 'SEED%';
insert into public.rsv2_reservations
  (code, cs_id, slot_id, rdate, rtime, name, kana, phone, visit_type, menu_id, room_id, channel)
values
 ('SEED0001', 11, '11_'||to_char(current_date,  'YYYY-MM-DD')||'_09:00', to_char(current_date,  'YYYY-MM-DD'), '09:00', '佐藤 一郎', 'サトウ イチロウ', '090-1111-2222', 'REVISIT', null,
   (select id from public.rsv2_resources where clinic_id=1 and kind='room' and active order by sort_order, id limit 1), 'WEB'),
 ('SEED0002', 11, '11_'||to_char(current_date,  'YYYY-MM-DD')||'_09:00', to_char(current_date,  'YYYY-MM-DD'), '09:00', '鈴木 花子', 'スズキ ハナコ',   '090-3333-4444', 'FIRST',   null,
   (select id from public.rsv2_resources where clinic_id=1 and kind='room' and active order by sort_order, id offset 1 limit 1), 'PHONE'),
 -- ★美容は千葉クリニック(cs_id=34)の取り扱い。旧・西春の美容(cs_id=13)は 2026-08-12 に廃止したため、
 --   サンプルも千葉に置く（部屋も千葉 clinic_id=3 から引く）。
 ('SEED0003', 34, '34_'||to_char(current_date+1,'YYYY-MM-DD')||'_10:30', to_char(current_date+1,'YYYY-MM-DD'), '10:30', '田中 美咲', 'タナカ ミサキ',   '080-5555-6666', 'FIRST',   101,
   (select id from public.rsv2_resources where clinic_id=3 and kind='room' and active order by sort_order, id limit 1), 'WEB')
on conflict do nothing;


-- =============================================================
-- 8. 適用結果の確認
-- =============================================================
select 'rsv2_reservations' as tbl, count(*) as rows from public.rsv2_reservations
union all select 'rsv2_resources',   count(*) from public.rsv2_resources
union all select 'rsv2_daily_notes', count(*) from public.rsv2_daily_notes
union all select 'rsv2_hours',       count(*) from public.rsv2_hours
union all select 'rsv2_closures',    count(*) from public.rsv2_closures
order by tbl;

select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename like 'rsv2_%'
 order by tablename, indexname;

select tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename like 'rsv2_%'
 order by tablename, policyname;


-- =============================================================
-- このファイルの実行方法
-- -------------------------------------------------------------
-- 【推奨】pg 直結（作業ディレクトリ = C:\ClaudeWork）
--     node scripts/rsv_db.js projects/clinic_reservation_system/prototype2/supabase_setup.sql
--   ・接続情報は scripts/rsv_db.js 内（pooler 経由 / パスワードは
--     C:\ClaudeWork\.secrets\supabase_soumu-hdg_db.key を読む・リポジトリには入れない）
--   ・引数なし（または --inspect）で実行すると、現在の列定義・インデックス・
--     制約・RLSポリシーを一覧できる:  node scripts/rsv_db.js --inspect
--   ・冪等なので繰り返し実行してよい（2回連続実行でエラーが出ないことを確認済み）
--
-- 【代替】Supabase Dashboard → SQL Editor に全文を貼り付けて Run（Ctrl+Enter）
--     プロジェクトが vypwgxkqtxuzqfaaeamf であることを必ず確認してから実行する。
-- =============================================================


-- =====================================================================
-- Wave 8 (2026-09-14): 予約 → カルテ来院予定の自動生成
--   正本 = ../sql/2026-09-14_w8_karte_autocreate.sql（以下は同内容の写し・冪等）
-- =====================================================================
-- =====================================================================
-- Wave 8 (2026-09-14): 予約 → 電子カルテ「来院予定」の自動生成
--
--   予約サイト（anon）は patients / visits を直接読めない（RLS: authenticated 限定）。
--   そこで rsv2_reservations への INSERT/UPDATE を BEFORE トリガー（SECURITY DEFINER）で受け、
--   DB内部でカルテ側の患者の名寄せ → 来院予定（visits.status='reserved'）の作成/移動/削除を行う。
--
--   ・患者の名寄せ: ①電話＋氏名 → ②生年月日＋氏名（またはカナ）。一致なしなら患者を新規登録
--                 （patient_no = 'RSV-' || 予約番号。カルテで保存すると同じ行に上書きされる）
--   ・来院予定:   visits に rsv_code（予約番号）を持たせて 1予約 = 1来院予定。status='reserved'
--   ・予約の変更: 日時変更は来院予定を追従。取消は「カルテ未記載」の来院予定だけ削除
--   ・来院(VISITED): 来院予定を 'waiting' に進め arrived_at を打つ
--   ・空き枠計算:  rsv2_karte_busy から予約由来（rsv_code あり）の来院予定を除外（二重に差し引かない）
--   ・連携失敗は予約自体を落とさず karte_note に理由を残す
--
--   冪等: 2回実行しても状態は変わらない。
-- =====================================================================

-- 1) 列の追加 ---------------------------------------------------------
alter table public.visits add column if not exists rsv_code text;
create unique index if not exists visits_rsv_code_uq on public.visits (rsv_code) where rsv_code is not null;

alter table public.rsv2_reservations
  add column if not exists karte_patient_no text,
  add column if not exists karte_visit_id   uuid,
  add column if not exists karte_synced_at  timestamptz,
  add column if not exists karte_note       text;

-- 2) 補助関数 ---------------------------------------------------------
create or replace function public.rsv2_karte_clinic_id(p_cs integer)
returns text language sql immutable as $$
  select case p_cs / 10 when 1 then 'nishiharu' when 2 then 'yokohama' when 3 then 'chiba' when 4 then 'nakagawa' end
$$;

create or replace function public.rsv2_norm_phone(t text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')
$$;

create or replace function public.rsv2_norm_name(t text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(t, ''), '[[:space:]　]', '', 'g'), '')
$$;

-- 3) 本体: 予約の INSERT/UPDATE → 来院予定 ------------------------------
create or replace function public.rsv2_sync_karte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic   text;
  v_pid      uuid;
  v_match    text;
  v_pno      text;
  v_vid      uuid;
  v_cnt      integer;
  v_dob      date;
  v_date     date;
  v_time     time;
  v_vtype    text;
  v_dept     text;
  v_changed  boolean;
  -- 既存の連携先（rsv_code = 予約番号 の visits）
  v_ex_id     uuid;
  v_ex_date   date;
  v_ex_pid    uuid;
  v_ex_clinic text;
  v_untouched boolean := false;   -- カルテ未記載（消してよい）
begin
  if NEW.kind is distinct from 'PATIENT' then return NEW; end if;

  -- UPDATE 時は連携に関係する列が変わったときだけ動く（担当・機材・会計の更新では何もしない）
  if TG_OP = 'UPDATE' then
    v_changed := (NEW.status     is distinct from OLD.status)
              or (NEW.rdate      is distinct from OLD.rdate)
              or (NEW.rtime      is distinct from OLD.rtime)
              or (NEW.cs_id      is distinct from OLD.cs_id)
              or (NEW.name       is distinct from OLD.name)
              or (NEW.kana       is distinct from OLD.kana)
              or (NEW.phone      is distinct from OLD.phone)
              or (NEW.birth      is distinct from OLD.birth)
              or (NEW.visit_type is distinct from OLD.visit_type)
              or (NEW.patient_id is distinct from OLD.patient_id);
    if not v_changed then return NEW; end if;
  end if;

  v_clinic := rsv2_karte_clinic_id(NEW.cs_id);
  if v_clinic is null then
    NEW.karte_note := 'カルテ連携なし: 院IDを判定できません（cs_id=' || coalesce(NEW.cs_id::text, 'null') || '）';
    return NEW;
  end if;

  begin   -- ★連携の失敗で予約そのものを落とさない（理由は karte_note に残す）
    select v.id, v.visit_date, v.patient_id, v.clinic_id
      into v_ex_id, v_ex_date, v_ex_pid, v_ex_clinic
      from visits v where v.rsv_code = NEW.code limit 1;
    if v_ex_id is not null then
      v_untouched := exists (select 1 from visits x where x.id = v_ex_id and coalesce(x.status, '') = 'reserved')
                 and not exists (select 1 from kartes k where k.visit_id = v_ex_id)
                 and not exists (select 1 from prescriptions p where p.visit_id = v_ex_id)
                 and not exists (select 1 from diseases_assigned d where d.visit_id = v_ex_id);
    end if;

    -- (a) 取消・不履行 ------------------------------------------------
    if NEW.status in ('CANCELLED', 'NO_SHOW') then
      if v_ex_id is not null then
        if v_untouched then
          delete from visits where id = v_ex_id;
          -- 自動登録した患者で、他に来院が無ければ患者マスタも掃除する
          delete from patients p
           where p.id = v_ex_pid and p.patient_no = 'RSV-' || NEW.code
             and not exists (select 1 from visits x where x.patient_id = p.id);
          NEW.karte_visit_id := null;
          NEW.karte_note := '予約取消により来院予定を削除';
        else
          NEW.karte_note := '予約取消（カルテに記載があるため来院記録は残置）';
        end if;
        NEW.karte_synced_at := now();
      end if;
      return NEW;
    end if;
    if NEW.status not in ('CONFIRMED', 'VISITED') then return NEW; end if;

    -- (b) 予約内容の解釈 --------------------------------------------
    v_date  := NEW.rdate::date;
    v_time  := NEW.rtime::time;
    v_dob   := case when NEW.birth ~ '^\d{4}-\d{2}-\d{2}$' then NEW.birth::date else null end;
    v_vtype := case NEW.visit_type when 'FIRST' then '新規' when 'REVISIT' then '再診' else null end;
    v_dept  := case when NEW.cs_id in (13, 21, 34) then '美容' else '内科' end;

    -- (c) 患者の名寄せ ----------------------------------------------
    v_pid   := NEW.patient_id;
    v_match := NEW.match_status;
    if v_pid is not null and not exists (select 1 from patients where id = v_pid) then v_pid := null; end if;
    if v_pid is null then
      -- ① 電話番号（数字のみ比較）＋ 氏名（空白無視）
      select id, count(*) over () into v_pid, v_cnt
        from patients
       where clinic_id = v_clinic
         and rsv2_norm_phone(phone) is not null
         and rsv2_norm_phone(phone) = rsv2_norm_phone(NEW.phone)
         and rsv2_norm_name(name)   = rsv2_norm_name(NEW.name)
       order by updated_at desc nulls last limit 1;
      -- ② 生年月日 ＋ 氏名（またはカナ）
      if v_pid is null and v_dob is not null then
        select id, count(*) over () into v_pid, v_cnt
          from patients
         where clinic_id = v_clinic and dob = v_dob
           and (rsv2_norm_name(name) = rsv2_norm_name(NEW.name)
                or (rsv2_norm_name(name_kana) is not null and rsv2_norm_name(name_kana) = rsv2_norm_name(NEW.kana)))
         order by updated_at desc nulls last limit 1;
      end if;
      if v_pid is not null then
        v_match := case when coalesce(v_cnt, 1) > 1 then 'CANDIDATE' else 'AUTO' end;
      else
        -- 一致なし → 患者を新規登録（カルテで保存すると patient_no,clinic_id で同じ行に上書きされる）
        insert into patients (clinic_id, patient_no, name, name_kana, dob, age, sex, phone, memo, is_db_source)
        values (v_clinic, 'RSV-' || NEW.code, NEW.name, nullif(NEW.kana, ''), v_dob,
                case when v_dob is null then null else extract(year from age(v_dob))::integer end,
                '不明', nullif(NEW.phone, ''),
                '予約サイトから自動登録（予約番号 ' || NEW.code || '）', false)
        on conflict (patient_no, clinic_id) do update set updated_at = now()
        returning id into v_pid;
        v_match := 'NONE';
      end if;
    end if;
    select patient_no into v_pno from patients where id = v_pid;

    -- (d) 既存の連携先が別日・別患者・別院なら付け替える -----------------
    if v_ex_id is not null and (v_ex_date <> v_date or v_ex_pid is distinct from v_pid or v_ex_clinic <> v_clinic) then
      if v_untouched then
        delete from visits where id = v_ex_id;
      else
        update visits set rsv_code = null where id = v_ex_id;   -- 記載済みの来院記録は残し、紐づけだけ外す
      end if;
      v_ex_id := null;
    end if;

    -- (e) 来院予定の作成／更新（同一患者・同一日の来院があればそれに紐づける） ---
    insert into visits (clinic_id, patient_id, visit_date, visit_time, department, visit_type, status, rsv_code)
    values (v_clinic, v_pid, v_date, v_time, v_dept, v_vtype, 'reserved', NEW.code)
    on conflict (patient_id, visit_date, clinic_id) do update
      set rsv_code   = excluded.rsv_code,
          visit_time = case when coalesce(visits.status, '') = 'reserved' or visits.visit_time is null
                            then excluded.visit_time else visits.visit_time end,
          visit_type = coalesce(visits.visit_type, excluded.visit_type)
    returning id into v_vid;

    -- (f) 来院済みにされたら、来院予定を「待機」に進める ---------------------
    if NEW.status = 'VISITED' then
      update visits
         set status = 'waiting',
             arrived_at = coalesce(arrived_at, date_trunc('minute', (now() at time zone 'Asia/Tokyo'))::time)
       where id = v_vid and coalesce(status, '') = 'reserved';
    end if;

    NEW.patient_id       := v_pid;
    NEW.match_status     := v_match;
    NEW.origin           := coalesce(NEW.origin, 'RSV');
    NEW.karte_patient_no := v_pno;
    NEW.karte_visit_id   := v_vid;
    NEW.karte_synced_at  := now();
    NEW.karte_note       := null;
  exception when others then
    NEW.karte_note      := 'カルテ連携失敗: ' || SQLERRM;
    NEW.karte_synced_at := now();
  end;
  return NEW;
end
$$;

-- 4) 予約行の DELETE（デモ初期化・掃除）→ 手つかずの来院予定だけ消す ---------
create or replace function public.rsv2_unlink_karte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ex_id uuid; v_ex_pid uuid; v_untouched boolean;
begin
  select v.id, v.patient_id into v_ex_id, v_ex_pid from visits v where v.rsv_code = OLD.code limit 1;
  if v_ex_id is null then return OLD; end if;
  v_untouched := exists (select 1 from visits x where x.id = v_ex_id and coalesce(x.status, '') = 'reserved')
             and not exists (select 1 from kartes k where k.visit_id = v_ex_id)
             and not exists (select 1 from prescriptions p where p.visit_id = v_ex_id)
             and not exists (select 1 from diseases_assigned d where d.visit_id = v_ex_id);
  if v_untouched then
    delete from visits where id = v_ex_id;
    delete from patients p
     where p.id = v_ex_pid and p.patient_no = 'RSV-' || OLD.code
       and not exists (select 1 from visits x where x.patient_id = p.id);
  else
    update visits set rsv_code = null where id = v_ex_id;
  end if;
  return OLD;
exception when others then
  return OLD;   -- 掃除の失敗で予約の削除を止めない
end
$$;

drop trigger if exists rsv2_sync_karte_trg on public.rsv2_reservations;
create trigger rsv2_sync_karte_trg
  before insert or update on public.rsv2_reservations
  for each row execute function public.rsv2_sync_karte();

drop trigger if exists rsv2_unlink_karte_trg on public.rsv2_reservations;
create trigger rsv2_unlink_karte_trg
  before delete on public.rsv2_reservations
  for each row execute function public.rsv2_unlink_karte();

-- トリガー関数は直接呼べないが、念のため anon からの実行権を外す
revoke execute on function public.rsv2_sync_karte()   from public, anon;
revoke execute on function public.rsv2_unlink_karte() from public, anon;

-- 4b) 逆方向: カルテで受付（reserved → waiting 等）したら予約を「来院済」に進める --------
--     カルテ画面は authenticated で rsv2_reservations に書けない（RLS は anon 限定）ため DB 内で追従する。
create or replace function public.rsv2_visit_to_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return NEW; end if;          -- 予約側トリガー経由の更新には反応しない
  if NEW.rsv_code is null then return NEW; end if;
  if coalesce(OLD.status, '') = 'reserved' and coalesce(NEW.status, '') in ('waiting', 'in_progress', 'done') then
    update rsv2_reservations set status = 'VISITED'
     where code = NEW.rsv_code and status = 'CONFIRMED';
  end if;
  return NEW;
exception when others then
  return NEW;   -- 追従の失敗でカルテ側の更新を止めない
end
$$;
revoke execute on function public.rsv2_visit_to_reservation() from public, anon;

drop trigger if exists rsv2_visit_to_reservation_trg on public.visits;
create trigger rsv2_visit_to_reservation_trg
  after update of status on public.visits
  for each row execute function public.rsv2_visit_to_reservation();

-- 5) 空き枠の差し引きから「予約由来の来院予定」を除外（同じ予約を二重に数えない） -----
create or replace view public.rsv2_karte_busy as
 select
   case clinic_id when 'nishiharu' then 1 when 'yokohama' then 2 when 'chiba' then 3 when 'nakagawa' then 4 end as clinic_id,
   visit_date::text as rdate,
   to_char(visit_time::interval, 'HH24:MI') as rtime,
   count(*) as busy
   from visits v
  where visit_time is not null
    and visit_date >= current_date - 1
    and coalesce(status, '') <> 'done'
    and rsv_code is null
    and clinic_id in ('nishiharu', 'yokohama', 'chiba', 'nakagawa')
  group by 1, 2, 3;
grant select on public.rsv2_karte_busy to anon, authenticated;

-- 6) 記録 --------------------------------------------------------------
insert into public.rsv2_migrations (key, note)
values ('2026-09-14_w8_karte_autocreate', '予約→カルテ来院予定の自動生成（BEFOREトリガー・名寄せ・取消追従・rsv_code列）')
on conflict (key) do nothing;

