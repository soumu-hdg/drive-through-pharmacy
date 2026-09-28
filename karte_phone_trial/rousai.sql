-- ============================================================
-- 労災（労働者災害補償保険）の受け皿  2026-09-16 追加  カルテ v22
--
-- 当院の労災は月に数件のため、請求書・内訳書そのものは厚労省指定の専用用紙に
-- 書き写す運用とし、カルテ側は「書き写すための下書き」を出せるところまでを持つ。
--   ・診機様式第3号 診療費請求内訳書（入院外用）＝患者ごと・診療月ごとに1枚
--   ・診機様式第1号 労災保険診療費請求書       ＝監督署ごとの表紙
-- 単価は1点12円（国公立等は11.50円）、患者の一部負担金は無い。
-- ============================================================

-- ===== 1. 患者の労災情報（1患者に複数の災害があり得るので配列で持つ） =====
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS rousai JSONB;

COMMENT ON COLUMN patients.rousai IS
  '労災情報の配列。要素={no:労働保険番号, office:事業場名, officeAddr:事業場所在地, '
  'accidentDate:災害発生年月日, part:傷病の部位, disease:傷病名, formType:"5"業務災害/"16-3"通勤災害, '
  'pensionNo:年金証書番号, kantoku:所轄労働基準監督署, startDate:療養開始日, note:備考}';

-- ===== 2. 受診が労災かどうか（医療保険の集計に混ぜないための印） =====
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS is_rousai   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rousai_no   TEXT,      -- その受診がどの災害のものか（労働保険番号）
  ADD COLUMN IF NOT EXISTS rousai_yen  INTEGER;   -- 労災単価で計算した金額（点数×12円）

COMMENT ON COLUMN visits.is_rousai  IS '労災の診療か。true の受診は医療保険のレセプト集計から外す';
COMMENT ON COLUMN visits.rousai_no  IS 'patients.rousai のどの災害に紐づくか（労働保険番号）';
COMMENT ON COLUMN visits.rousai_yen IS '労災の金額（点数×12円）。一部負担金は発生しない';

CREATE INDEX IF NOT EXISTS idx_visits_rousai
  ON visits(clinic_id, visit_date)
  WHERE is_rousai;

-- ===== 3. 確認 =====
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'patients' AND column_name = 'rousai')
     OR (table_name = 'visits' AND column_name IN ('is_rousai', 'rousai_no', 'rousai_yen')))
 ORDER BY table_name, column_name;
