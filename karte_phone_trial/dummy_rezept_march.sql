-- ============================================================
-- レセプト作成の撮影用ダミーデータ（2026年3月＝実データが1件も無い月）
--   ・名前は必ず「ZZダミー」で始め、患者番号も ZZD で始める（後でまとめて消すため）
--   ・撮影が終わったら dummy_rezept_cleanup.sql で必ず消す
-- ============================================================
DO $$
DECLARE
  cid  TEXT := 'nishiharu';
  pid  UUID;
  vid  UUID;
BEGIN
  -- ===== 1) 社保3割・初診・内服あり =====
  INSERT INTO patients (clinic_id, patient_no, name, name_kana, dob, sex, insurance_type, copay_rate,
                        insurer_number, ins_symbol, ins_number, pay_method)
  VALUES (cid, 'ZZD001', 'ZZダミー 一郎', 'ズィーズィーダミー イチロウ', '1979-04-02', '男', '社保3割', 0.3,
          '01130012', '1234', '5678', '現金')
  RETURNING id INTO pid;

  INSERT INTO visits (clinic_id, patient_id, visit_date, visit_type, status, department, doctor, revenue_points)
  VALUES (cid, pid, '2026-03-03', '新規', 'done', '内科', '島原　立樹', 605) RETURNING id INTO vid;
  INSERT INTO kartes (visit_id, chief_complaint, findings_html, is_first_visit, rx_days,
                      vitals_temp, vitals_bp_sys, vitals_bp_dia, vitals_spo2, vitals_pulse)
  VALUES (vid, '発熱、咳', 'S：3日前から咳と微熱。<br>O：咽頭発赤あり。<br>A/P：急性上気道炎として対症療法。',
          true, 5, 37.8, 122, 74, 98, 88);
  INSERT INTO diseases_assigned (visit_id, disease_code, disease_name) VALUES (vid, '4610024', '急性上気道感染症');
  INSERT INTO prescriptions (visit_id, drug_name, quantity, unit, days, sort_order)
  VALUES (vid, 'カルボシステイン錠　２５０ｍｇ', 3, '錠', 5, 1),
         (vid, 'アセトアミノフェン錠　２００ｍｇ', 3, '錠', 5, 2);

  -- ===== 2) 国保3割・再診2回 =====
  INSERT INTO patients (clinic_id, patient_no, name, name_kana, dob, sex, insurance_type, copay_rate,
                        insurer_number, ins_symbol, ins_number, pay_method)
  VALUES (cid, 'ZZD002', 'ZZダミー 花子', 'ズィーズィーダミー ハナコ', '1992-11-15', '女', '国保3割', 0.3,
          '138062', '国保', '2233', 'カード')
  RETURNING id INTO pid;

  INSERT INTO visits (clinic_id, patient_id, visit_date, visit_type, status, department, doctor, revenue_points)
  VALUES (cid, pid, '2026-03-05', '再診', 'done', '内科', '島原　立樹', 318) RETURNING id INTO vid;
  INSERT INTO kartes (visit_id, chief_complaint, findings_html, is_first_visit, rx_days)
  VALUES (vid, '鼻汁、くしゃみ', 'S：花粉症の時期になると例年同様。<br>A/P：抗ヒスタミン薬を継続。', false, 14);
  INSERT INTO diseases_assigned (visit_id, disease_code, disease_name) VALUES (vid, '4770011', 'アレルギー性鼻炎');
  INSERT INTO prescriptions (visit_id, drug_name, quantity, unit, days, sort_order)
  VALUES (vid, 'フェキソフェナジン塩酸塩　６０ｍｇ', 2, '錠', 14, 1);

  INSERT INTO visits (clinic_id, patient_id, visit_date, visit_type, status, department, doctor, revenue_points)
  VALUES (cid, pid, '2026-03-19', '再診', 'done', '内科', '島原　立樹', 186) RETURNING id INTO vid;
  INSERT INTO kartes (visit_id, chief_complaint, findings_html, is_first_visit, rx_days)
  VALUES (vid, '経過観察', 'S：症状は軽快。<br>A/P：同処方を継続。', false, 14);
  INSERT INTO diseases_assigned (visit_id, disease_code, disease_name) VALUES (vid, '4770011', 'アレルギー性鼻炎');
  INSERT INTO prescriptions (visit_id, drug_name, quantity, unit, days, sort_order)
  VALUES (vid, 'フェキソフェナジン塩酸塩　６０ｍｇ', 2, '錠', 14, 1);

  -- ===== 3) 後期高齢1割・複数病名 =====
  INSERT INTO patients (clinic_id, patient_no, name, name_kana, dob, sex, insurance_type, copay_rate,
                        insurer_number, ins_symbol, ins_number, pay_method)
  VALUES (cid, 'ZZD003', 'ZZダミー 三郎', 'ズィーズィーダミー サブロウ', '1948-01-20', '男', '後期高齢者1割', 0.1,
          '39130017', '', '4455', '現金')
  RETURNING id INTO pid;

  INSERT INTO visits (clinic_id, patient_id, visit_date, visit_type, status, department, doctor, revenue_points)
  VALUES (cid, pid, '2026-03-10', '再診', 'done', '内科', '島原　立樹', 452) RETURNING id INTO vid;
  INSERT INTO kartes (visit_id, chief_complaint, findings_html, is_first_visit, rx_days,
                      vitals_bp_sys, vitals_bp_dia)
  VALUES (vid, '定期受診', 'S：自覚症状なし。<br>O：血圧やや高め。<br>A/P：内服継続、生活指導。', false, 28, 148, 86);
  INSERT INTO diseases_assigned (visit_id, disease_code, disease_name)
  VALUES (vid, '8830100', '高血圧症'), (vid, '2720010', '脂質異常症');
  INSERT INTO prescriptions (visit_id, drug_name, quantity, unit, days, sort_order)
  VALUES (vid, 'トラネキサム酸錠　２５０ｍｇ', 3, '錠', 28, 1);

  -- ===== 4) 子ども（社保3割＋医療証） =====
  INSERT INTO patients (clinic_id, patient_no, name, name_kana, dob, sex, insurance_type, copay_rate,
                        insurer_number, ins_symbol, ins_number, pay_method,
                        iryo_type, iryo_hobetsu, iryo_recipient_number)
  VALUES (cid, 'ZZD004', 'ZZダミー 太郎', 'ズィーズィーダミー タロウ', '2019-06-01', '男', '社保3割', 0.3,
          '06270031', '5566', '7788', '現金', '子ども医療', '81', '0012345')
  RETURNING id INTO pid;

  INSERT INTO visits (clinic_id, patient_id, visit_date, visit_type, status, department, doctor, revenue_points)
  VALUES (cid, pid, '2026-03-12', '新規', 'done', '内科', '島原　立樹', 528) RETURNING id INTO vid;
  INSERT INTO kartes (visit_id, chief_complaint, findings_html, is_first_visit, rx_days, vitals_temp)
  VALUES (vid, '発熱、のどの痛み', 'S：昨夜から38度台。<br>O：咽頭発赤、扁桃腫大。<br>A/P：急性咽頭炎。', true, 5, 38.4);
  INSERT INTO diseases_assigned (visit_id, disease_code, disease_name) VALUES (vid, '4630001', '急性扁桃炎');
  INSERT INTO prescriptions (visit_id, drug_name, quantity, unit, days, sort_order)
  VALUES (vid, 'カロナール細粒５０％', 1, '包', 5, 1);
END $$;

SELECT '作った患者' AS k, string_agg(patient_no || ' ' || name, ' / ' ORDER BY patient_no) AS v
  FROM patients WHERE patient_no LIKE 'ZZD%'
UNION ALL
SELECT '2026-03の受診', count(*)::text FROM visits
 WHERE visit_date BETWEEN '2026-03-01' AND '2026-03-31';
