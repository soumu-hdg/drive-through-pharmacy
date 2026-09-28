-- =====================================================
-- karte_v09 セキュリティ移行SQL
-- 実行順序: 1. RLS有効化 → 2. 旧ポリシー削除 → 3. 新ポリシー作成
-- =====================================================

-- ===== STEP 1: 全テーブルのRLS有効化 =====
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE kartes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diseases_assigned ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams_ordered ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_shifts ENABLE ROW LEVEL SECURITY;

-- ===== STEP 2: 旧ポリシー削除（{public}ロールの無制限ポリシー） =====

-- patients
DROP POLICY IF EXISTS patients_select ON patients;
DROP POLICY IF EXISTS patients_insert ON patients;
DROP POLICY IF EXISTS patients_update ON patients;
DROP POLICY IF EXISTS patients_delete ON patients;

-- visits
DROP POLICY IF EXISTS visits_select ON visits;
DROP POLICY IF EXISTS visits_insert ON visits;
DROP POLICY IF EXISTS visits_update ON visits;
DROP POLICY IF EXISTS visits_delete ON visits;

-- kartes
DROP POLICY IF EXISTS kartes_select ON kartes;
DROP POLICY IF EXISTS kartes_insert ON kartes;
DROP POLICY IF EXISTS kartes_update ON kartes;
DROP POLICY IF EXISTS kartes_delete ON kartes;

-- prescriptions
DROP POLICY IF EXISTS prescriptions_select ON prescriptions;
DROP POLICY IF EXISTS prescriptions_insert ON prescriptions;
DROP POLICY IF EXISTS prescriptions_update ON prescriptions;
DROP POLICY IF EXISTS prescriptions_delete ON prescriptions;

-- diseases_assigned
DROP POLICY IF EXISTS diseases_assigned_select ON diseases_assigned;
DROP POLICY IF EXISTS diseases_assigned_insert ON diseases_assigned;
DROP POLICY IF EXISTS diseases_assigned_update ON diseases_assigned;
DROP POLICY IF EXISTS diseases_assigned_delete ON diseases_assigned;

-- exams_ordered
DROP POLICY IF EXISTS exams_ordered_select ON exams_ordered;
DROP POLICY IF EXISTS exams_ordered_insert ON exams_ordered;
DROP POLICY IF EXISTS exams_ordered_update ON exams_ordered;
DROP POLICY IF EXISTS exams_ordered_delete ON exams_ordered;

-- billing (also had {public} policies)
DROP POLICY IF EXISTS billing_items_used_select ON billing_items_used;
DROP POLICY IF EXISTS billing_items_used_insert ON billing_items_used;
DROP POLICY IF EXISTS billing_items_used_update ON billing_items_used;
DROP POLICY IF EXISTS billing_items_used_delete ON billing_items_used;
DROP POLICY IF EXISTS billing_menu_all ON billing_menu;

-- drugs (also had {public} policies)
DROP POLICY IF EXISTS drugs_select ON drugs;
DROP POLICY IF EXISTS drugs_insert ON drugs;
DROP POLICY IF EXISTS drugs_update ON drugs;
DROP POLICY IF EXISTS drugs_delete ON drugs;

-- exam_items
DROP POLICY IF EXISTS exam_items_all ON exam_items;

-- diseases_master
DROP POLICY IF EXISTS diseases_master_all ON diseases_master;

-- set_orders
DROP POLICY IF EXISTS set_orders_select ON set_orders;
DROP POLICY IF EXISTS set_orders_insert ON set_orders;
DROP POLICY IF EXISTS set_orders_update ON set_orders;
DROP POLICY IF EXISTS set_orders_delete ON set_orders;

-- ===== STEP 3: 新ポリシー作成 =====

-- ---- 医療データ: authenticated ロールのみ ----

-- patients
CREATE POLICY "auth_patients_select" ON patients FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_patients_insert" ON patients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_patients_update" ON patients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_patients_delete" ON patients FOR DELETE TO authenticated USING (true);

-- visits
CREATE POLICY "auth_visits_select" ON visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_visits_insert" ON visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_visits_update" ON visits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_visits_delete" ON visits FOR DELETE TO authenticated USING (true);

-- kartes
CREATE POLICY "auth_kartes_select" ON kartes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_kartes_insert" ON kartes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_kartes_update" ON kartes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_kartes_delete" ON kartes FOR DELETE TO authenticated USING (true);

-- prescriptions
CREATE POLICY "auth_prescriptions_select" ON prescriptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_prescriptions_insert" ON prescriptions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_prescriptions_update" ON prescriptions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_prescriptions_delete" ON prescriptions FOR DELETE TO authenticated USING (true);

-- diseases_assigned
CREATE POLICY "auth_diseases_assigned_select" ON diseases_assigned FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_diseases_assigned_insert" ON diseases_assigned FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_diseases_assigned_update" ON diseases_assigned FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_diseases_assigned_delete" ON diseases_assigned FOR DELETE TO authenticated USING (true);

-- exams_ordered
CREATE POLICY "auth_exams_ordered_select" ON exams_ordered FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_exams_ordered_insert" ON exams_ordered FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_exams_ordered_update" ON exams_ordered FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_exams_ordered_delete" ON exams_ordered FOR DELETE TO authenticated USING (true);

-- doctor_shifts
CREATE POLICY "auth_doctor_shifts_select" ON doctor_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_doctor_shifts_insert" ON doctor_shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_doctor_shifts_update" ON doctor_shifts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_doctor_shifts_delete" ON doctor_shifts FOR DELETE TO authenticated USING (true);

-- billing_items_used
CREATE POLICY "auth_billing_items_select" ON billing_items_used FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_billing_items_insert" ON billing_items_used FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_billing_items_update" ON billing_items_used FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_billing_items_delete" ON billing_items_used FOR DELETE TO authenticated USING (true);

-- ---- マスタデータ: authenticated は全操作可、anon は SELECT のみ ----

-- billing_menu
CREATE POLICY "auth_billing_menu_all" ON billing_menu FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_billing_menu_select" ON billing_menu FOR SELECT TO anon USING (true);

-- diseases_master
CREATE POLICY "auth_diseases_master_all" ON diseases_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_diseases_master_select" ON diseases_master FOR SELECT TO anon USING (true);

-- drugs
CREATE POLICY "auth_drugs_all" ON drugs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_drugs_select" ON drugs FOR SELECT TO anon USING (true);

-- exam_items
CREATE POLICY "auth_exam_items_all" ON exam_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_exam_items_select" ON exam_items FOR SELECT TO anon USING (true);

-- set_orders
CREATE POLICY "auth_set_orders_all" ON set_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_set_orders_select" ON set_orders FOR SELECT TO anon USING (true);

-- ---- KPI テーブル: anon は SELECT + INSERT/UPDATE（GAS同期用）、DELETE は不可 ----
-- (既存ポリシーを置き換え)

DROP POLICY IF EXISTS anon_all_kpi_daily ON kpi_daily_summary;
DROP POLICY IF EXISTS anon_all_kpi_ga4 ON kpi_ga4_metrics;
DROP POLICY IF EXISTS anon_all_kpi_inv ON kpi_inventory;
DROP POLICY IF EXISTS anon_all_kpi_orders ON kpi_orders;
DROP POLICY IF EXISTS anon_all_kpi_seo_articles ON kpi_seo_articles;
DROP POLICY IF EXISTS anon_all_kpi_seo ON kpi_seo_daily;
DROP POLICY IF EXISTS anon_all_kpi_sns ON kpi_sns_metrics;
DROP POLICY IF EXISTS anon_all_kpi_sync ON kpi_sync_status;

CREATE POLICY "anon_kpi_daily_select" ON kpi_daily_summary FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_daily_insert" ON kpi_daily_summary FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_daily_update" ON kpi_daily_summary FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_ga4_select" ON kpi_ga4_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_ga4_insert" ON kpi_ga4_metrics FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_ga4_update" ON kpi_ga4_metrics FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_inv_select" ON kpi_inventory FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_inv_insert" ON kpi_inventory FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_inv_update" ON kpi_inventory FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_orders_select" ON kpi_orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_orders_insert" ON kpi_orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_orders_update" ON kpi_orders FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_seo_articles_select" ON kpi_seo_articles FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_seo_articles_insert" ON kpi_seo_articles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_seo_articles_update" ON kpi_seo_articles FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_seo_select" ON kpi_seo_daily FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_seo_insert" ON kpi_seo_daily FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_seo_update" ON kpi_seo_daily FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_sns_select" ON kpi_sns_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_sns_insert" ON kpi_sns_metrics FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_sns_update" ON kpi_sns_metrics FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_kpi_sync_select" ON kpi_sync_status FOR SELECT TO anon USING (true);
CREATE POLICY "anon_kpi_sync_insert" ON kpi_sync_status FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_kpi_sync_update" ON kpi_sync_status FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ---- medicines, stock_transactions: 既存ポリシー修正 ----
DROP POLICY IF EXISTS anon_all_medicines ON medicines;
CREATE POLICY "anon_medicines_select" ON medicines FOR SELECT TO anon USING (true);
CREATE POLICY "anon_medicines_insert" ON medicines FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_medicines_update" ON medicines FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_all_transactions ON stock_transactions;
CREATE POLICY "anon_transactions_select" ON stock_transactions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_transactions_insert" ON stock_transactions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_transactions_update" ON stock_transactions FOR UPDATE TO anon USING (true) WITH CHECK (true);
