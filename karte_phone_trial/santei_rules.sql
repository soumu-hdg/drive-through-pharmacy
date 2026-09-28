-- ============================================================
-- 算定ルール設定（院ごと・選択式）  2026-09-16 追加  カルテ v22
--
-- 「この院でその加算を算定するか」を院ごとに持つ。値は次の3つだけ。
--   on    … 算定する（自動算定の候補になる）
--   off   … 算定しない
--   unset … 未設定（既定。候補にも出さない＝何も起こらない）
--
-- 画面側の既定は、当院で従来から付けている3加算＝on、それ以外＝unset。
-- この表が空でも従来どおり動く（画面が既定値を持っているため）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.karte_santei_rules (
  clinic_id  TEXT NOT NULL,
  rule_key   TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'unset',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  PRIMARY KEY (clinic_id, rule_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'karte_santei_rules_mode_chk'
  ) THEN
    ALTER TABLE public.karte_santei_rules
      ADD CONSTRAINT karte_santei_rules_mode_chk CHECK (mode IN ('on', 'off', 'unset'));
  END IF;
END $$;

COMMENT ON TABLE  public.karte_santei_rules        IS '院ごとの算定ルール設定（v22 算定ルール設定画面から更新）';
COMMENT ON COLUMN public.karte_santei_rules.rule_key IS 'santei_rules.js の CATALOG の key と対応';
COMMENT ON COLUMN public.karte_santei_rules.mode     IS 'on=算定する / off=算定しない / unset=未設定（候補にも出さない）';

-- ===== 院ごとの閉じ込め（既存のカルテ表と同じ考え方） =====
ALTER TABLE public.karte_santei_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karte_clinic_all ON public.karte_santei_rules;
CREATE POLICY karte_clinic_all ON public.karte_santei_rules
  FOR ALL TO authenticated
  USING (public.karte_can_access(clinic_id))
  WITH CHECK (public.karte_can_access(clinic_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.karte_santei_rules TO authenticated;

-- ===== 現状維持の初期値（西春）。既に行があれば触らない =====
INSERT INTO public.karte_santei_rules (clinic_id, rule_key, mode, updated_by)
VALUES ('nishiharu', 'kinou_kyouka', 'on', 'v22 migration'),
       ('nishiharu', 'bukka',        'on', 'v22 migration'),
       ('nishiharu', 'baseup',       'on', 'v22 migration')
ON CONFLICT (clinic_id, rule_key) DO NOTHING;

-- 確認
SELECT clinic_id, rule_key, mode FROM public.karte_santei_rules ORDER BY clinic_id, rule_key;
