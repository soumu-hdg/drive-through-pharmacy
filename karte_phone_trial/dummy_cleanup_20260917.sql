-- ============================================================
-- 撮影用ダミーデータの整理削除（2026-09-17）
--   今回ぶん（ZZダミー＝3月の受診）と、以前から残っていたテスト患者をまとめて消す。
--   消す前に「何をどれだけ消すか」を必ず出す。
-- ============================================================

-- ===== 1) 消す前の状況 =====
SELECT '① 対象の患者' AS k,
       coalesce(string_agg(format('%s %s（受診%s件）', patient_no, name,
         (SELECT count(*) FROM visits v WHERE v.patient_id = p.id)), ' / ' ORDER BY patient_no), '（なし）') AS v
  FROM patients p
 WHERE patient_no LIKE 'ZZD%' OR name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%'
UNION ALL
SELECT '② 2026-03の受診', count(*)::text FROM visits WHERE visit_date BETWEEN '2026-03-01' AND '2026-03-31'
UNION ALL
SELECT '③ カルテ由来の在庫記録', count(*)::text FROM pharmacy_transactions WHERE karte_visit_id IS NOT NULL
UNION ALL
SELECT '④ 予約のテスト行', count(*)::text FROM rsv2_reservations
 WHERE name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%';

-- ===== 2) 削除（子から順に） =====
CREATE TEMP TABLE _del_p AS
  SELECT id FROM patients
   WHERE patient_no LIKE 'ZZD%' OR name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%';
CREATE TEMP TABLE _del_v AS
  SELECT id FROM visits WHERE patient_id IN (SELECT id FROM _del_p);

DELETE FROM prescriptions      WHERE visit_id IN (SELECT id FROM _del_v);
DELETE FROM diseases_assigned  WHERE visit_id IN (SELECT id FROM _del_v);
DELETE FROM kartes             WHERE visit_id IN (SELECT id FROM _del_v);
DELETE FROM visits             WHERE id IN (SELECT id FROM _del_v);
DELETE FROM patients           WHERE id IN (SELECT id FROM _del_p);

-- 撮影で動かした在庫の記録（カルテ由来のテスト印）も念のため掃除
DELETE FROM pharmacy_transactions
 WHERE karte_visit_id LIKE '%ZZ%' OR karte_visit_id LIKE 'TEST%';

-- 予約のテスト行
DELETE FROM rsv2_reservations
 WHERE name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%';

-- ===== 3) 消したあとの確認 =====
SELECT '⑤ 残ったダミー患者' AS k, count(*)::text AS v FROM patients
 WHERE patient_no LIKE 'ZZD%' OR name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%'
UNION ALL
SELECT '⑥ 2026-03の受診', count(*)::text FROM visits WHERE visit_date BETWEEN '2026-03-01' AND '2026-03-31'
UNION ALL
SELECT '⑦ カルテ由来の在庫記録', count(*)::text FROM pharmacy_transactions WHERE karte_visit_id IS NOT NULL
UNION ALL
SELECT '⑧ 予約のテスト行', count(*)::text FROM rsv2_reservations
 WHERE name LIKE 'ZZ%' OR name LIKE 'テスト%' OR name LIKE 'デモ%'
UNION ALL
SELECT '⑨ 患者の総数（参考）', count(*)::text FROM patients;
