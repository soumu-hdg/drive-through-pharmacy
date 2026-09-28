-- =====================================================================
-- 電子カルテ v21: クリニック別のDB参照分離（2026-09-15）
--
--  目的: ログインしたIDの「所属クリニック」の行だけを読み書きできるようにする。
--        画面側で選んだ院（接続クリニック）はあくまで表示の切替で、
--        権限の境界はこのRLSが担う。
--
--  内容（冪等・何度流しても同じ結果）
--   1) 院マスタ public.clinics（西春/横浜/千葉/中川）
--   2) app_users.clinics text[]  … 所属院の一覧。'*' は全院（マスターID）
--      - 既存3件: soumu@… は '*'、その他は従来の clinic_id をそのまま配列に
--   3) 判定関数 karte_user_clinics() / karte_can_access(clinic) /
--      karte_visit_clinic(visit_id) / karte_is_admin()
--   4) RLS: clinic_id を持つ表は「所属院の行だけ」、
--      visit_id しか持たない表（kartes/prescriptions/diseases_assigned/
--      exams_ordered/billing_items_used）は visits の院で判定
--   5) app_users: 一覧は職員なら誰でも／作成・変更は管理者のみ
--      （Googleログイン初回の自分の行は「所属院なし・staff」でのみ作れる）
--
--  既存データはすべて nishiharu（patients 292／visits 314 … 2026-09-15 実測）なので
--  行の書き換えは不要。予約→カルテのトリガー（rsv2_sync_karte 等）は
--  SECURITY DEFINER なので、このRLSの影響を受けない。
--
--  適用: node scripts/rsv_db.js karte_v20_work/multiclinic_rls.sql
--  戻し: 末尾の「ロールバック」コメント参照
-- =====================================================================

begin;

-- ---------------------------------------------------------------
-- 1) 院マスタ
-- ---------------------------------------------------------------
create table if not exists public.clinics (
  id            text primary key,                 -- カルテ側の clinic_id（patients.clinic_id 等）
  name          text not null,                    -- 正式名称（受付画面の見出し）
  short_name    text not null,                    -- 短縮名（ログイン画面のボタン等）
  rsv_clinic_id integer unique,                   -- 予約システムの院番号（1西春/2横浜/3千葉/4中川）
  has_sheet     boolean not null default false,   -- 夜間休日外来DB（スプレッドシート）を読む院か
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.clinics (id, name, short_name, rsv_clinic_id, has_sheet, sort_order) values
  ('nishiharu', '西春内科・在宅クリニック', '西春', 1, true,  1),
  ('yokohama',  '横浜クリニック',           '横浜', 2, false, 2),
  ('chiba',     '千葉クリニック',           '千葉', 3, false, 3),
  ('nakagawa',  '中川クリニック',           '中川', 4, false, 4)
on conflict (id) do update
  set short_name = excluded.short_name,
      rsv_clinic_id = excluded.rsv_clinic_id,
      sort_order = excluded.sort_order;
-- ※ name / has_sheet は運用で書き換えられるよう上書きしない

alter table public.clinics enable row level security;
drop policy if exists clinics_read on public.clinics;
create policy clinics_read on public.clinics for select to anon, authenticated using (true);
-- 書き込みポリシーは作らない（変更はSQLのみ）

-- ---------------------------------------------------------------
-- 2) app_users.clinics（所属院）
-- ---------------------------------------------------------------
alter table public.app_users add column if not exists clinics text[];

-- 初回のみ: 従来の clinic_id を配列に写す。soumu@… はマスターID（全院）
update public.app_users
   set clinics = array[coalesce(clinic_id, 'nishiharu')]
 where clinics is null;
update public.app_users
   set clinics = array['*'], role = 'admin'
 where lower(email) in ('soumu@hundred-dr.com', 'soumu@hdg-holdings.com')
   and not ('*' = any(clinics));

alter table public.app_users alter column clinics set default '{}'::text[];
alter table public.app_users alter column clinics set not null;

-- 所属院は 4院の id か '*' だけ（CHECKにサブクエリは書けないので固定リスト）
alter table public.app_users drop constraint if exists app_users_clinics_chk;
alter table public.app_users add constraint app_users_clinics_chk
  check (clinics <@ array['*','nishiharu','yokohama','chiba','nakagawa']::text[]);

-- ---------------------------------------------------------------
-- 3) 判定関数（SECURITY DEFINER: app_users / visits のRLSを迂回して判定だけ行う）
-- ---------------------------------------------------------------
create or replace function public.karte_user_clinics()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select clinics from public.app_users where id = auth.uid() and is_active),
    '{}'::text[]);
$$;

create or replace function public.karte_can_access(p_clinic text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_clinic is not null
     and (p_clinic = any(public.karte_user_clinics()) or '*' = any(public.karte_user_clinics()));
$$;

create or replace function public.karte_visit_clinic(p_visit uuid)
returns text language sql stable security definer set search_path = public as $$
  select clinic_id from public.visits where id = p_visit;
$$;

create or replace function public.karte_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where id = auth.uid() and is_active and role = 'admin');
$$;

revoke all on function public.karte_user_clinics() from public;
revoke all on function public.karte_can_access(text) from public;
revoke all on function public.karte_visit_clinic(uuid) from public;
revoke all on function public.karte_is_admin() from public;
grant execute on function public.karte_user_clinics() to authenticated;
grant execute on function public.karte_can_access(text) to authenticated;
grant execute on function public.karte_visit_clinic(uuid) to authenticated;
grant execute on function public.karte_is_admin() to authenticated;

-- ---------------------------------------------------------------
-- 4) RLS 差し替え
-- ---------------------------------------------------------------
-- 4a) clinic_id を持つ表 … 所属院の行だけ
do $$
declare t text;
begin
  foreach t in array array['patients','visits','karte_db_patients','karte_documents',
                           'doctor_shifts','telemed_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('drop policy if exists karte_clinic_all on public.%I', t);
    execute format($p$create policy karte_clinic_all on public.%I for all to authenticated
                     using (public.karte_can_access(clinic_id))
                     with check (public.karte_can_access(clinic_id))$p$, t);
  end loop;
end $$;

-- 4b) drugs / set_orders … clinic_id が NULL の行は全院共通（画面が or(clinic_id.is.null,…) で読む）
do $$
declare t text;
begin
  foreach t in array array['drugs','set_orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('drop policy if exists karte_clinic_all on public.%I', t);
    execute format($p$create policy karte_clinic_all on public.%I for all to authenticated
                     using (clinic_id is null or public.karte_can_access(clinic_id))
                     with check (clinic_id is null or public.karte_can_access(clinic_id))$p$, t);
  end loop;
end $$;

-- 4c) karte_delete_logs … 記録は所属院にだけ書け、所属院のものだけ読める（更新・削除は従来どおり不可）
alter table public.karte_delete_logs enable row level security;
drop policy if exists auth_insert on public.karte_delete_logs;
drop policy if exists auth_select on public.karte_delete_logs;
drop policy if exists karte_clinic_insert on public.karte_delete_logs;
drop policy if exists karte_clinic_select on public.karte_delete_logs;
create policy karte_clinic_insert on public.karte_delete_logs for insert to authenticated
  with check (public.karte_can_access(clinic_id));
create policy karte_clinic_select on public.karte_delete_logs for select to authenticated
  using (public.karte_can_access(clinic_id));

-- 4d) visit_id しか持たない表 … 来院記録の院で判定
do $$
declare t text;
begin
  foreach t in array array['kartes','prescriptions','diseases_assigned','exams_ordered','billing_items_used']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name=t and column_name='visit_id') then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists auth_all on public.%I', t);
      execute format('drop policy if exists karte_clinic_all on public.%I', t);
      execute format($p$create policy karte_clinic_all on public.%I for all to authenticated
                       using (public.karte_can_access(public.karte_visit_clinic(visit_id)))
                       with check (public.karte_can_access(public.karte_visit_clinic(visit_id)))$p$, t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 5) app_users … 一覧は職員なら誰でも／作成・変更・削除は管理者だけ
--    例外: Googleログイン初回に自分の行を「所属院なし・staff」で作るのは可
-- ---------------------------------------------------------------
alter table public.app_users enable row level security;
drop policy if exists auth_all on public.app_users;
drop policy if exists app_users_select on public.app_users;
drop policy if exists app_users_insert on public.app_users;
drop policy if exists app_users_update on public.app_users;
drop policy if exists app_users_delete on public.app_users;
create policy app_users_select on public.app_users for select to authenticated using (true);
create policy app_users_insert on public.app_users for insert to authenticated
  with check (public.karte_is_admin()
              or (id = auth.uid() and role = 'staff' and clinics = '{}'::text[]));
create policy app_users_update on public.app_users for update to authenticated
  using (public.karte_is_admin()) with check (public.karte_is_admin());
create policy app_users_delete on public.app_users for delete to authenticated
  using (public.karte_is_admin());

-- ---------------------------------------------------------------
-- 6) 適用記録
-- ---------------------------------------------------------------
insert into public.rsv2_migrations (key, applied_at, note) values
  ('2026-09-15_w9_multiclinic_rls', now(),
   'クリニック別DB参照分離: clinics表／app_users.clinics(所属院・*=全院)／karte_can_access() で全カルテ表のRLSを自院限定へ')
on conflict (key) do update set applied_at = excluded.applied_at, note = excluded.note;

commit;

-- =====================================================================
-- ロールバック（必要なとき手で流す）
--   各表: drop policy karte_clinic_all; create policy auth_all for all to authenticated using(true) with check(true);
--   karte_delete_logs: auth_insert(with check true) / auth_select(using true) を復元
--   app_users: 4本を drop し auth_all を復元。列 clinics は残しても害はない
-- =====================================================================
