-- =====================================================================
-- スマホ版（医療補助の報告）2026-09-19  karte-next
--   診察中に医師の隣の医療補助がスマホで送る「保険証・医療証の提示／処方した薬／検査結果」の
--   写真とメモを受け取り、PC のカルテ側で候補として表示 → 担当者が確認して追加する。
--   ・写真は職員だけが読める非公開バケット mobile-reports（8MB・画像のみ）
--   ・1報告＝1行。status: pending（未確認）→ applied（PC で確認・追加した）／dismissed（却下）
--   ・患者の対応付けは patient_no（予約由来 RSV-… など）か、無ければ氏名（同じ院・同じ日）
--   冪等: 2回実行しても状態は変わらない。
-- =====================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mobile-reports', 'mobile-reports', false, 8388608, array['image/jpeg','image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mobile_reports_select_authenticated on storage.objects;
create policy mobile_reports_select_authenticated on storage.objects
  for select to authenticated using (bucket_id = 'mobile-reports');
drop policy if exists mobile_reports_insert_authenticated on storage.objects;
create policy mobile_reports_insert_authenticated on storage.objects
  for insert to authenticated with check (bucket_id = 'mobile-reports' and name like 'mobile/%');
drop policy if exists mobile_reports_update_authenticated on storage.objects;
create policy mobile_reports_update_authenticated on storage.objects
  for update to authenticated using (bucket_id = 'mobile-reports');
drop policy if exists mobile_reports_delete_authenticated on storage.objects;
create policy mobile_reports_delete_authenticated on storage.objects
  for delete to authenticated using (bucket_id = 'mobile-reports');

create table if not exists public.karte_mobile_reports (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     text not null,
  visit_date    date not null,
  patient_no    text,                       -- 分かるとき（RSV-… / SB-…）。GAS 由来の患者は null
  patient_name  text not null,
  patient_kana  text,
  kind          text not null check (kind in ('insurance','iryo','rx','exam')),
  photo_path    text check (photo_path is null or photo_path ~ '^mobile/[A-Za-z0-9_./-]+$'),
  memo          text,
  status        text not null default 'pending' check (status in ('pending','applied','dismissed')),
  reported_by   text,
  created_at    timestamptz not null default now(),
  applied_by    text,
  applied_at    timestamptz,
  applied_note  text,
  constraint karte_mobile_reports_content_chk check (photo_path is not null or (memo is not null and memo <> ''))
);
comment on table public.karte_mobile_reports is 'スマホ版（医療補助）からの報告: 保険証・医療証の提示／処方した薬／検査結果の写真とメモ。PC のカルテで候補として表示し、担当者が確認して追加する';
create index if not exists idx_karte_mobile_reports_day on public.karte_mobile_reports (clinic_id, visit_date, status);

alter table public.karte_mobile_reports enable row level security;
drop policy if exists karte_clinic_all on public.karte_mobile_reports;
create policy karte_clinic_all on public.karte_mobile_reports
  as permissive for all to authenticated
  using (karte_can_access(clinic_id)) with check (karte_can_access(clinic_id));

create table if not exists public.karte_migrations (name text primary key, applied_at timestamptz default now());
insert into public.karte_migrations (name) values ('2026-09-19_mobile_reports') on conflict do nothing;

commit;

select 'bucket' as what, id from storage.buckets where id = 'mobile-reports'
union all
select 'table', table_name from information_schema.tables where table_schema = 'public' and table_name = 'karte_mobile_reports'
union all
select 'policies', count(*)::text from pg_policies where tablename = 'objects' and policyname like 'mobile_reports_%';
