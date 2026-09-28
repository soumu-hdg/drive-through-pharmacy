-- ============================================================
-- 情報通信機器を用いた診療に係る報告書（別紙様式14）対応
-- 2026-09-11 追加
--
-- 厚労省の施設基準「情報通信機器を用いた診療に係る報告書（8月報告）」は
--   集計期間 = 前年8月1日〜当年7月31日
-- で、以下を求めてくる。カルテ側に受け皿が一切なかったため追加する。
--   1-1) オンライン診療の件数を「患者の所在が自院と同一都道府県／別都道府県」で分ける
--        ＋それぞれ「対応困難・緊急性のため他院へ紹介した件数」
--   1-3) 院外で実施した医師ごとの 常勤/非常勤・実施場所・都道府県・診療録把握体制
--   2   ) 対面／オンラインの初診料・再診料等の算定件数、初診の診療前相談件数、
--        その後自院で対面診療を行わなかった件数
--   3   ) 診療前相談の実施方式
-- ============================================================

-- ===== 1. 受診ごとの記録項目（日々のカルテ入力で貯まる分） =====
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS is_telemedicine      BOOLEAN DEFAULT false,  -- 情報通信機器を用いた診療か
  ADD COLUMN IF NOT EXISTS telemed_patient_pref TEXT,                   -- 診療時の「患者の所在」都道府県
  ADD COLUMN IF NOT EXISTS telemed_referred     BOOLEAN DEFAULT false,  -- 対応困難・緊急性のため他院へ紹介した
  ADD COLUMN IF NOT EXISTS telemed_pre_consult  BOOLEAN DEFAULT false,  -- 診療前相談を行った（初診のみ意味を持つ）
  ADD COLUMN IF NOT EXISTS telemed_doctor_place TEXT;                   -- 医師が院外で実施した場合の場所区分

COMMENT ON COLUMN visits.telemed_patient_pref IS '様式14 1-1)。住所ではなく「診療を受けたときに患者がいた場所」の都道府県';
COMMENT ON COLUMN visits.telemed_referred     IS '様式14 1-1) 右欄。自身では対応困難な疾患・病態／緊急性があり他院へ紹介した件数';

CREATE INDEX IF NOT EXISTS idx_visits_telemed
  ON visits(clinic_id, visit_date)
  WHERE is_telemedicine;

-- ===== 2. 報告書そのもの（1報告年 = 1行） =====
-- カルテから自動集計できない欄（医師の常勤区分・実施場所・他県の対面体制・診療前相談の方式）と、
-- カルテ運用開始前の期間を手入力で補うための値をここに持つ。
CREATE TABLE IF NOT EXISTS telemed_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      TEXT NOT NULL DEFAULT 'nishiharu',
  report_year    INTEGER NOT NULL,             -- 報告する年（西暦）。期間は (year-1)-08-01 〜 year-07-31
  institution    JSONB NOT NULL DEFAULT '{}',  -- {name, code, address}
  doctors        JSONB NOT NULL DEFAULT '[]',  -- 1-3) [{name, employment, place, placeOther, pref, record, recordOther}]
  pref_support   JSONB NOT NULL DEFAULT '[]',  -- 1-2) [{pref, support}]
  pre_consult    JSONB NOT NULL DEFAULT '{}',  -- 3)   {series, separated, other, otherText}
  manual_counts  JSONB NOT NULL DEFAULT '{}',  -- 手入力の補正値（カルテ外期間ぶん）
  count_mode     TEXT NOT NULL DEFAULT 'auto', -- auto=カルテ集計 / manual=手入力 / hybrid=カルテ集計＋補正
  note           TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now(),
  updated_by     TEXT,
  UNIQUE(clinic_id, report_year)
);

ALTER TABLE telemed_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_all ON telemed_reports;
CREATE POLICY auth_all ON telemed_reports
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE TRIGGER trg_telemed_reports_updated
  BEFORE UPDATE ON telemed_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
