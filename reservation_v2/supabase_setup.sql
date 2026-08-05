-- =============================================================
-- クリニック予約システム用 Supabase セットアップ（デモ専用テーブル）
-- プロジェクト: dyjhxkqzxibcpgoefbiv （業務・カルテ/KPIと同一プロジェクト）
-- 既存データとは完全に分離した専用テーブル。中身はデモ用の偽データのみ。
-- Supabase Dashboard の SQL Editor に貼り付けて Run（Ctrl+Enter）で1回実行するだけ。
-- =============================================================

create table if not exists public.rsv2_reservations (
  code        text primary key,          -- 予約番号（crypto乱数で発行）
  cs_id       int  not null,             -- クリニック×診療区分ID
  slot_id     text not null,             -- 枠ID  "csId_YYYY-MM-DD_HH:MM"
  rdate       text not null,             -- 予約日  "YYYY-MM-DD"
  rtime       text not null,             -- 予約時刻 "HH:MM"
  name        text not null,
  kana        text,
  phone       text not null,
  birth       text,
  email       text,
  visit_type  text,                      -- FIRST / REVISIT
  menu_id     int,                       -- 美容メニューID
  room_id     smallint,                  -- 診察室ID（1=診察室1 / 2=診察室2・受付で切替可）
  note        text,
  status      text not null default 'CONFIRMED',   -- CONFIRMED / CANCELLED / VISITED
  channel     text not null default 'WEB',
  sent_at     bigint,                    -- 送信時刻(ms)＝レイテンシ計測用
  created_at  timestamptz not null default now()
);

-- 既存テーブルへ room_id 列を後付け（未作成なら追加。作成済みなら無視）
alter table public.rsv2_reservations add column if not exists room_id smallint;

-- RLS 有効化＋このデモ専用テーブルのみ anon 許可（偽データ限定）
alter table public.rsv2_reservations enable row level security;
drop policy if exists rsv2_anon_all on public.rsv2_reservations;
create policy rsv2_anon_all on public.rsv2_reservations
  for all to anon using (true) with check (true);

-- Realtime 配信対象に追加（既に追加済みならエラーは無視でOK）
do $$ begin
  alter publication supabase_realtime add table public.rsv2_reservations;
exception when duplicate_object then null; end $$;

-- シード（本日分の偽データ）を入れ直し
delete from public.rsv2_reservations where code like 'SEED%';
insert into public.rsv2_reservations (code, cs_id, slot_id, rdate, rtime, name, kana, phone, visit_type, menu_id, room_id, channel) values
 ('SEED0001', 11, '11_'||to_char(current_date,'YYYY-MM-DD')||'_09:00', to_char(current_date,'YYYY-MM-DD'), '09:00', '佐藤 一郎', 'サトウ イチロウ', '090-1111-2222', 'REVISIT', null, 1, 'WEB'),
 ('SEED0002', 11, '11_'||to_char(current_date,'YYYY-MM-DD')||'_09:00', to_char(current_date,'YYYY-MM-DD'), '09:00', '鈴木 花子', 'スズキ ハナコ', '090-3333-4444', 'FIRST', null, 2, 'PHONE'),
 ('SEED0003', 13, '13_'||to_char(current_date+1,'YYYY-MM-DD')||'_10:30', to_char(current_date+1,'YYYY-MM-DD'), '10:30', '田中 美咲', 'タナカ ミサキ', '080-5555-6666', 'FIRST', 101, 1, 'WEB');
