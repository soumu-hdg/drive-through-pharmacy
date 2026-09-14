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
