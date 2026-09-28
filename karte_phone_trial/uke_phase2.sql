-- ============================================================
-- 第2段階（UKE差分）2026-09-19  karte-next
-- カルテに「レセプト摘要（CO）・症状詳記（SJ）・特定器材（TO）」の入力を持たせる受け皿。
--   kartes.receipt_notes jsonb =
--     { comments:  [{code:'810000001'|'82…', text:'…', position:'upper'|'lower', service:'01'}],
--       symptoms:  [{category:'01', text:'…'}],
--       materials: [{code:'9桁', name:'…', qty:1, unitCode:'…', unitPrice:'…', service:'40'}] }
--   空のときは NULL。既存の行には影響しない（列を足すだけ）。
-- ============================================================
begin;

alter table public.kartes
  add column if not exists receipt_notes jsonb;

comment on column public.kartes.receipt_notes is
  'レセプト摘要・症状詳記・特定器材（UKEのCO/SJ/TOの元データ）。{comments:[{code,text,position,service}], symptoms:[{category,text}], materials:[{code,name,qty,unitCode,unitPrice,service}]}';

create table if not exists public.karte_migrations (name text primary key, applied_at timestamptz default now());
insert into public.karte_migrations (name) values ('2026-09-19_phase2_receipt_notes') on conflict do nothing;

commit;

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'kartes' and column_name = 'receipt_notes';
