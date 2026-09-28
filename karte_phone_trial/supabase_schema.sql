-- ===== 電子カルテ v0.5 Supabase スキーマ =====
-- スプシ ←→ Vercel → Supabase 両軸構成
-- 実行先: Supabase Dashboard > SQL Editor

-- ===== マスタテーブル =====

-- 薬品マスタ
CREATE TABLE IF NOT EXISTS drugs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   TEXT,
  drug_code   TEXT,
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) DEFAULT 0,
  unit        TEXT DEFAULT 'T',
  category    TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 傷病名マスタ
CREATE TABLE IF NOT EXISTS diseases_master (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icd_code    TEXT,
  name        TEXT NOT NULL,
  is_quick    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 検査項目マスタ
CREATE TABLE IF NOT EXISTS exam_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code   TEXT,
  name        TEXT NOT NULL,
  points      INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 算定メニューマスタ
CREATE TABLE IF NOT EXISTS billing_menu (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,
  name        TEXT NOT NULL,
  points      INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- セット処方マスタ
CREATE TABLE IF NOT EXISTS set_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   TEXT,
  name        TEXT NOT NULL,
  days        INTEGER DEFAULT 7,
  items       JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ===== 業務テーブル =====

-- 患者マスタ
CREATE TABLE IF NOT EXISTS patients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       TEXT NOT NULL DEFAULT 'nishiharu',
  patient_no      TEXT,
  name            TEXT NOT NULL,
  name_kana       TEXT,
  dob             DATE,
  age             INTEGER,
  sex             TEXT CHECK (sex IN ('男','女','不明')) DEFAULT '不明',
  phone           TEXT,
  address         TEXT,
  allergies       TEXT[] DEFAULT '{}',
  medical_history TEXT[] DEFAULT '{}',
  insurance_type  TEXT,
  copay_rate      NUMERIC(3,2),
  insurer_number  TEXT,
  kouhi_number    TEXT,
  income_level    TEXT,
  memo            TEXT,
  is_db_source    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(patient_no, clinic_id)
);

-- 来院記録
CREATE TABLE IF NOT EXISTS visits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       TEXT NOT NULL DEFAULT 'nishiharu',
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date      DATE NOT NULL,
  visit_time      TIME,
  doctor          TEXT,
  department      TEXT DEFAULT '内科',
  visit_type      TEXT CHECK (visit_type IN ('新規','再診')),
  status          TEXT DEFAULT 'waiting',
  route           TEXT,
  lane            INTEGER,
  vehicle_plate   TEXT,
  arrived_at      TIME,
  exam_start      TIMESTAMPTZ,
  exam_end        TIMESTAMPTZ,
  self_pay        INTEGER DEFAULT 0,
  revenue_points  INTEGER DEFAULT 0,
  covid_positive  BOOLEAN DEFAULT false,
  flu_positive    BOOLEAN DEFAULT false,
  strep_positive  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(patient_id, visit_date, clinic_id)
);

-- カルテ（SOAP）
CREATE TABLE IF NOT EXISTS kartes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  chief_complaint TEXT,
  findings_html   TEXT,
  vitals_temp     NUMERIC(4,1),
  vitals_bp_sys   INTEGER,
  vitals_bp_dia   INTEGER,
  vitals_pulse    INTEGER,
  vitals_spo2     INTEGER,
  rx_days         INTEGER DEFAULT 7,
  is_first_visit  BOOLEAN DEFAULT false,
  time_surcharge  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(visit_id)
);

-- 処方
CREATE TABLE IF NOT EXISTS prescriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  drug_id     UUID REFERENCES drugs(id),
  drug_name   TEXT NOT NULL,
  quantity    NUMERIC(8,2) DEFAULT 0,
  unit        TEXT DEFAULT 'T',
  days        INTEGER,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 傷病名（付与済み）
CREATE TABLE IF NOT EXISTS diseases_assigned (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  disease_code  TEXT,
  disease_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 検査オーダー
CREATE TABLE IF NOT EXISTS exams_ordered (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  exam_code   TEXT,
  exam_name   TEXT NOT NULL,
  points      INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 算定項目
CREATE TABLE IF NOT EXISTS billing_items_used (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  item_name   TEXT NOT NULL,
  points      INTEGER DEFAULT 0,
  quantity    INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ===== updated_at 自動更新トリガー =====
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_patients_updated
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_kartes_updated
  BEFORE UPDATE ON kartes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_drugs_updated
  BEFORE UPDATE ON drugs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===== RLS（行レベルセキュリティ） =====
-- Phase D で認証実装時に有効化
-- ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE kartes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE diseases_assigned ENABLE ROW LEVEL SECURITY;

-- ===== インデックス =====
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_clinic_date ON visits(clinic_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_kartes_visit ON kartes(visit_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_visit ON prescriptions(visit_id);
CREATE INDEX IF NOT EXISTS idx_diseases_assigned_visit ON diseases_assigned(visit_id);
CREATE INDEX IF NOT EXISTS idx_drugs_clinic ON drugs(clinic_id);
