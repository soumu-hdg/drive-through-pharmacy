-- ===== 電子カルテ v0.5 マスタデータ投入 =====
-- supabase_schema.sql 実行後に実行すること
-- Supabase Dashboard > SQL Editor にペースト

-- ===== 薬品マスタ（20件） =====
INSERT INTO drugs (clinic_id, drug_code, name, price, unit, category) VALUES
  ('nishiharu', 'amlodipine5',       'アムロジピン錠5mg',           10.10, 'T', '降圧'),
  ('nishiharu', 'amlodipine2.5',     'アムロジピン錠2.5mg',         10.10, 'T', '降圧'),
  ('nishiharu', 'metformin500',      'メトホルミン錠500mg',         10.10, 'T', '糖尿病'),
  ('nishiharu', 'metformin250',      'メトホルミン錠250mg',         10.10, 'T', '糖尿病'),
  ('nishiharu', 'atorvastatin10',    'アトルバスタチン錠10mg',       14.50, 'T', '脂質'),
  ('nishiharu', 'atorvastatin5',     'アトルバスタチン錠5mg',       11.80, 'T', '脂質'),
  ('nishiharu', 'montelukast10',     'モンテルカスト錠10mg',         14.50, 'T', 'アレルギー'),
  ('nishiharu', 'fexofenadine60',    'フェキソフェナジン錠60mg',     10.10, 'T', 'アレルギー'),
  ('nishiharu', 'loxoprofen60',      'ロキソプロフェン錠60mg',       5.70,  'T', '鎮痛'),
  ('nishiharu', 'acetaminophen200',  'アセトアミノフェン錠200mg',     5.70,  'T', '鎮痛'),
  ('nishiharu', 'acetaminophen500',  'アセトアミノフェン錠500mg',     7.00,  'T', '鎮痛'),
  ('nishiharu', 'rebamipide100',     'レバミピド錠100mg',           10.10, 'T', '胃腸'),
  ('nishiharu', 'lansoprazole15',    'ランソプラゾールOD錠15mg',     10.40, 'T', '胃腸'),
  ('nishiharu', 'domperidone10',     'ドンペリドン錠10mg',           5.70,  'T', '胃腸'),
  ('nishiharu', 'loperamide1',       'ロペラミド錠1mg',             5.70,  'T', '胃腸'),
  ('nishiharu', 'carbocisteine500',  'カルボシステイン錠500mg',       7.00,  'T', '咳・痰'),
  ('nishiharu', 'dextromethorphan15','デキストロメトルファン錠15mg',   5.70,  'T', '咳・痰'),
  ('nishiharu', 'tranexamic250',     'トラネキサム酸錠250mg',       10.10, 'T', '咳・痰'),
  ('nishiharu', 'prednisolone5',     'プレドニゾロン錠5mg',          5.70,  'T', 'ステロイド'),
  ('nishiharu', 'losartan50',        'ロサルタンカリウム錠50mg',     10.10, 'T', '降圧')
ON CONFLICT DO NOTHING;

-- ===== 傷病名マスタ（20件） =====
INSERT INTO diseases_master (icd_code, name, is_quick) VALUES
  ('J069',  '急性上気道感染症',       true),
  ('J00',   '急性鼻咽頭炎（かぜ）',   false),
  ('J039',  '急性扁桃炎',             false),
  ('J209',  '急性気管支炎',           false),
  ('J304',  'アレルギー性鼻炎',       true),
  ('J459',  '喘息',                   false),
  ('K529',  '急性胃腸炎',             true),
  ('K21',   '胃食道逆流症',           false),
  ('K2900', '急性胃炎',               false),
  ('I10',   '高血圧症',               true),
  ('E119',  '2型糖尿病',              true),
  ('E785',  '脂質異常症',             false),
  ('G439',  '片頭痛',                 true),
  ('M545',  '腰痛症',                 false),
  ('R509',  '発熱',                   false),
  ('N390',  '膀胱炎',                 false),
  ('L300',  '湿疹',                   false),
  ('B349',  'ウイルス感染症',          false),
  ('R05',   '咳嗽',                   false),
  ('U071',  'COVID-19',               false)
ON CONFLICT DO NOTHING;

-- ===== 検査項目マスタ（10件） =====
INSERT INTO exam_items (item_code, name, points) VALUES
  ('blood_general', '血液一般',       21),
  ('blood_biochem', '生化学検査',     11),
  ('crp',           'CRP',           16),
  ('hba1c',         'HbA1c',         49),
  ('urinalysis',    '尿一般',        26),
  ('ecg',           '心電図',        130),
  ('xray_chest',    '胸部X線',       210),
  ('covid_antigen', 'コロナ抗原',    150),
  ('flu_antigen',   'インフル抗原',  150),
  ('spo2_monitor',  'SpO2モニタ',    30)
ON CONFLICT DO NOTHING;

-- ===== 算定メニューマスタ（31件） =====
INSERT INTO billing_menu (category, name, points) VALUES
  -- 初再診
  ('initial',    '初診料',                     291),
  ('initial',    '再診料',                      75),
  ('initial',    '外来管理加算',                 52),
  ('initial',    '時間外加算（初診）',            85),
  ('initial',    '休日加算（初診）',             250),
  ('initial',    '深夜加算（初診）',             480),
  ('initial',    '時間外加算（再診）',            65),
  ('initial',    '休日加算（再診）',             190),
  ('initial',    '深夜加算（再診）',             420),
  -- 管理料
  ('management', '特定疾患療養管理料',           225),
  ('management', '薬剤情報提供料',               10),
  ('management', '診療情報提供料(I)',            250),
  ('management', '療養費同意書交付料',           100),
  -- 処置
  ('procedure',  '創傷処置（100cm2未満）',        52),
  ('procedure',  '創傷処置（100〜500cm2）',       60),
  ('procedure',  '消炎鎮痛等処置',               35),
  ('procedure',  '鼻腔・咽頭処置',               12),
  ('procedure',  'ネブライザー',                 12),
  ('procedure',  '皮膚科軟膏処置',               55),
  -- 検査
  ('labtest',    '血液一般（末梢血）',            21),
  ('labtest',    '生化学（10項目まで）',          106),
  ('labtest',    'CRP定量',                     16),
  ('labtest',    'HbA1c',                       49),
  ('labtest',    '尿一般',                       26),
  ('labtest',    '便潜血（2回法）',               41),
  ('labtest',    'コロナ抗原定性',               150),
  ('labtest',    'インフル抗原定性',             150),
  -- 注射
  ('injection',  '皮下・筋肉内注射',             20),
  ('injection',  '静脈内注射',                   32),
  ('injection',  '点滴注射（500mL以上）',         98),
  ('injection',  '点滴注射（500mL未満）',         49),
  -- 画像
  ('imaging',    '胸部X線（単純）',              210),
  ('imaging',    '腹部X線（単純）',              210),
  ('imaging',    '心電図（12誘導）',             130),
  ('imaging',    '超音波検査（腹部）',            530)
ON CONFLICT DO NOTHING;

-- ===== セット処方マスタ（4件） =====
INSERT INTO set_orders (clinic_id, name, days, items) VALUES
  ('nishiharu', '風邪セット',   5,  '[{"drugId":"acetaminophen200","qty":3},{"drugId":"carbocisteine500","qty":3},{"drugId":"tranexamic250","qty":3},{"drugId":"rebamipide100","qty":3}]'::jsonb),
  ('nishiharu', '胃腸炎セット', 5,  '[{"drugId":"domperidone10","qty":3},{"drugId":"rebamipide100","qty":3},{"drugId":"loperamide1","qty":1}]'::jsonb),
  ('nishiharu', '高血圧セット', 28, '[{"drugId":"amlodipine5","qty":1}]'::jsonb),
  ('nishiharu', '花粉症セット', 14, '[{"drugId":"fexofenadine60","qty":2},{"drugId":"montelukast10","qty":1}]'::jsonb)
ON CONFLICT DO NOTHING;
