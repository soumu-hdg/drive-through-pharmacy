-- ============================================================
-- カルテの操作で薬の在庫を増減させる  2026-09-17  カルテ v22
--
-- 方針（ユーザー決定 2026-09-16）
--   ・カルテは在庫アプリと同じ Supabase の表を直接見る（GAS経由をやめる）
--   ・院内処方のみ減らす（院外処方箋は減らさない）
--   ・在庫を追わない薬（pharmacy_v_medicines.stock_untracked＝外用など）は減らさない
--   ・数量は「1回量 × 日数」
--
-- 安全側の決め事
--   ・同じ受診で二度減らさない（karte_visit_id ＋ 薬品コード ＋ 区分で一意）
--   ・カルテを取り消したら戻す（打ち消しの入庫を作り、元の出庫は void 印を付けて再実行できるようにする）
--   ・名寄せできなかった薬は無言で飛ばさず、呼び出し元へ返して画面に出す
--   ・出庫の記録と在庫数の更新は必ず同じ関数の中で行う（トリガーが無いため画面側でバラバラに書かない）
-- ============================================================

ALTER TABLE public.pharmacy_transactions
  ADD COLUMN IF NOT EXISTS karte_visit_id TEXT;

COMMENT ON COLUMN public.pharmacy_transactions.karte_visit_id IS
  'カルテ由来の増減。値は「クリニックID|患者番号|診療日」。取り消し時は末尾に :void:<id> を付けて無効化する';

CREATE UNIQUE INDEX IF NOT EXISTS ux_pharmacy_tx_karte
  ON public.pharmacy_transactions (karte_visit_id, medicine_code, transaction_type)
  WHERE karte_visit_id IS NOT NULL;

-- ===== 1. カルテの確定で減らす =====
CREATE OR REPLACE FUNCTION public.pharmacy_dispense_from_karte(
  p_visit_id     TEXT,
  p_patient_no   TEXT,
  p_patient_name TEXT,
  p_operator     TEXT,
  p_occurred_on  DATE,
  p_items        JSONB          -- [{"code":"M001","qty":15}, ...]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it        JSONB;
  v_code    TEXT;
  v_qty     INTEGER;
  m         RECORD;
  v_ins     INTEGER;
  applied   JSONB := '[]'::jsonb;
  already   JSONB := '[]'::jsonb;
  untracked JSONB := '[]'::jsonb;
  unknown   JSONB := '[]'::jsonb;
BEGIN
  IF p_visit_id IS NULL OR btrim(p_visit_id) = '' THEN
    RAISE EXCEPTION '受診を特定できません（karte_visit_id が空）';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  LOOP
    v_code := btrim(coalesce(it->>'code', ''));
    v_qty  := coalesce((it->>'qty')::numeric, 0)::integer;
    IF v_code = '' OR v_qty <= 0 THEN
      unknown := unknown || jsonb_build_object('code', v_code, 'name', it->>'name', 'reason', '数量またはコードが空');
      CONTINUE;
    END IF;

    SELECT v.code, v.name, v.unit, v.stock_untracked, v.current_stock
      INTO m
      FROM public.pharmacy_v_medicines v
     WHERE v.code = v_code AND v.active;

    IF NOT FOUND THEN
      unknown := unknown || jsonb_build_object('code', v_code, 'name', it->>'name', 'reason', '在庫の薬品マスタに無い');
      CONTINUE;
    END IF;

    IF m.stock_untracked THEN
      untracked := untracked || jsonb_build_object('code', m.code, 'name', m.name, 'qty', v_qty);
      CONTINUE;
    END IF;

    INSERT INTO public.pharmacy_transactions
      (medicine_code, transaction_type, quantity, patient_id, patient_name, note,
       operator, source, occurred_on, karte_visit_id)
    VALUES
      (m.code, 'out', v_qty, p_patient_no, p_patient_name, 'カルテの確定による出庫',
       coalesce(p_operator, 'karte'), 'karte', coalesce(p_occurred_on, current_date), p_visit_id)
    ON CONFLICT (karte_visit_id, medicine_code, transaction_type) WHERE karte_visit_id IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 0 THEN
      already := already || jsonb_build_object('code', m.code, 'name', m.name, 'qty', v_qty);
      CONTINUE;
    END IF;

    UPDATE public.pharmacy_medicines
       SET current_stock = current_stock - v_qty,
           last_updated  = now()
     WHERE code = m.code;

    applied := applied || jsonb_build_object('code', m.code, 'name', m.name, 'qty', v_qty,
                                             'unit', m.unit, 'stock_after', m.current_stock - v_qty);
  END LOOP;

  RETURN jsonb_build_object('visit', p_visit_id, 'applied', applied, 'already', already,
                            'untracked', untracked, 'unknown', unknown);
END $$;

-- ===== 2. カルテの取り消しで戻す =====
CREATE OR REPLACE FUNCTION public.pharmacy_cancel_karte_dispense(
  p_visit_id TEXT,
  p_operator TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  restored JSONB := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT id, medicine_code, quantity, patient_id, patient_name, occurred_on
      FROM public.pharmacy_transactions
     WHERE karte_visit_id = p_visit_id AND transaction_type = 'out'
  LOOP
    INSERT INTO public.pharmacy_transactions
      (medicine_code, transaction_type, quantity, patient_id, patient_name, note,
       operator, source, occurred_on, karte_visit_id)
    VALUES
      (r.medicine_code, 'in', r.quantity, r.patient_id, r.patient_name, 'カルテ取り消しによる戻し',
       coalesce(p_operator, 'karte'), 'karte', current_date, p_visit_id || ':undo:' || r.id);

    UPDATE public.pharmacy_medicines
       SET current_stock = current_stock + r.quantity,
           last_updated  = now()
     WHERE code = r.medicine_code;

    -- 元の出庫は記録として残しつつ、同じ受診でもう一度確定できるように印を外す
    UPDATE public.pharmacy_transactions
       SET karte_visit_id = p_visit_id || ':void:' || r.id,
           note = coalesce(note, '') || '（取り消し済み）'
     WHERE id = r.id;

    restored := restored || jsonb_build_object('code', r.medicine_code, 'qty', r.quantity);
  END LOOP;

  RETURN jsonb_build_object('visit', p_visit_id, 'restored', restored);
END $$;

GRANT EXECUTE ON FUNCTION public.pharmacy_dispense_from_karte(TEXT, TEXT, TEXT, TEXT, DATE, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_cancel_karte_dispense(TEXT, TEXT) TO anon, authenticated;

-- 確認
SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname IN ('pharmacy_dispense_from_karte', 'pharmacy_cancel_karte_dispense')
 ORDER BY proname;
