// ===== 診療報酬改定 新旧点数切替モジュール v1.0 =====
// 2026年6月1日施行の令和8年度診療報酬改定に対応
// 診察日に基づいて適用する点数テーブルを自動判定する

const REVISION_DATE_2026 = '2026-06-01';

/**
 * 診察日が改定施行日以降かどうかを判定
 * @param {string} visitDate - "YYYY-MM-DD" 形式の診察日
 * @returns {boolean} true=新点数適用, false=旧点数適用
 */
function isPostRevision2026(visitDate) {
  if (!visitDate) return new Date() >= new Date(REVISION_DATE_2026);
  return visitDate >= REVISION_DATE_2026;
}

// ===================================================================
// 点数マスタ: 旧（～2026/5/31）と 新（2026/6/1～）
// ===================================================================

const BILLING_MASTER = {
  // ----- 旧点数（2026年5月31日以前） -----
  before: {
    initial: [
      { name: '初診料', points: 291 },
      { name: '再診料', points: 75 },
      { name: '外来管理加算', points: 52 },
      { name: '時間外加算（初診）', points: 85 },
      { name: '休日加算（初診）', points: 250 },
      { name: '深夜加算（初診）', points: 480 },
      { name: '時間外加算（再診）', points: 65 },
      { name: '休日加算（再診）', points: 190 },
      { name: '深夜加算（再診）', points: 420 },
    ],
    management: [
      { name: '特定疾患療養管理料', points: 225 },
      { name: '薬剤情報提供料', points: 10 },
      { name: '診療情報提供料(I)', points: 250 },
      { name: '療養費同意書交付料', points: 100 },
    ],
    procedure: [
      { name: '創傷処置（100cm2未満）', points: 52 },
      { name: '創傷処置（100〜500cm2）', points: 60 },
      { name: '消炎鎮痛等処置', points: 35 },
      { name: '鼻腔・咽頭処置', points: 12 },
      { name: 'ネブライザー', points: 12 },
      { name: '皮膚科軟膏処置', points: 55 },
    ],
    labtest: [
      { name: '血液一般（末梢血）', points: 21 },
      { name: '生化学（10項目まで）', points: 106 },
      { name: 'CRP定量', points: 16 },
      { name: 'HbA1c', points: 49 },
      { name: '尿一般', points: 26 },
      { name: '便潜血（2回法）', points: 41 },
      { name: 'コロナ抗原定性', points: 150 },
      { name: 'インフル抗原定性', points: 150 },
    ],
    injection: [
      { name: '皮下・筋肉内注射', points: 20 },
      { name: '静脈内注射', points: 32 },
      { name: '点滴注射（500mL以上）', points: 98 },
      { name: '点滴注射（500mL未満）', points: 49 },
    ],
    imaging: [
      { name: '胸部X線（単純）', points: 210 },
      { name: '腹部X線（単純）', points: 210 },
      { name: '心電図（12誘導）', points: 130 },
      { name: '超音波検査（腹部）', points: 530 },
    ],
  },

  // ----- 新点数（2026年6月1日以降） -----
  after: {
    initial: [
      { name: '初診料', points: 291 },
      { name: '再診料', points: 76 },  // 75→76
      { name: '外来管理加算', points: 52 },
      { name: '外来・在宅物価対応料', points: 2 },  // 新設
      { name: 'ベースアップ評価料(I) 初診', points: 17 },  // 6→17
      { name: 'ベースアップ評価料(I) 再診', points: 4 },   // 2→4
      { name: '時間外加算（初診）', points: 85 },
      { name: '休日加算（初診）', points: 250 },
      { name: '深夜加算（初診）', points: 480 },
      { name: '時間外加算（再診）', points: 65 },
      { name: '休日加算（再診）', points: 190 },
      { name: '深夜加算（再診）', points: 420 },
    ],
    management: [
      { name: '特定疾患療養管理料', points: 225, note: 'NSAIDs+消化性潰瘍は算定不可' },
      { name: '生活習慣病管理料(I) 脂質異常症', points: 610 },  // 新規追加
      { name: '生活習慣病管理料(I) 高血圧症', points: 660 },    // 新規追加
      { name: '生活習慣病管理料(I) 糖尿病', points: 760 },      // 新規追加
      { name: '生活習慣病管理料(II)', points: 333 },             // 新規追加
      { name: '眼科連携強化加算', points: 60, note: '年1回・糖尿病' },  // 新設
      { name: '歯科連携強化加算', points: 60, note: '年1回・糖尿病' },  // 新設
      { name: '薬剤情報提供料', points: 10 },
      { name: '診療情報提供料(I)', points: 250 },
      { name: '療養費同意書交付料', points: 100 },
    ],
    procedure: [
      { name: '創傷処置（100cm2未満）', points: 52 },
      { name: '創傷処置（100〜500cm2）', points: 60 },
      { name: '消炎鎮痛等処置', points: 35 },
      { name: '鼻腔・咽頭処置', points: 12 },
      { name: 'ネブライザー', points: 12 },
      { name: '皮膚科軟膏処置', points: 55 },
    ],
    labtest: [
      { name: '血液一般（末梢血）', points: 21 },
      { name: '生化学（10項目まで）', points: 106 },
      { name: 'CRP定量', points: 16 },
      { name: 'HbA1c', points: 49 },
      { name: '尿一般', points: 26 },
      { name: '便潜血（2回法）', points: 41 },
      { name: 'コロナ抗原定性', points: 150 },
      { name: 'インフル抗原定性', points: 150 },
    ],
    injection: [
      { name: '皮下・筋肉内注射', points: 20 },
      { name: '静脈内注射', points: 32 },
      { name: '点滴注射（500mL以上）', points: 98 },
      { name: '点滴注射（500mL未満）', points: 49 },
    ],
    imaging: [
      { name: '胸部X線（単純）', points: 210 },
      { name: '腹部X線（単純）', points: 210 },
      { name: '心電図（12誘導）', points: 130 },
      { name: '超音波検査（腹部）', points: 530 },
    ],
  },
};

// ===================================================================
// 点数取得API（app.jsから呼び出す）
// ===================================================================

/**
 * 診察日に応じた点数マスタを返す
 * @param {string} visitDate - "YYYY-MM-DD" 形式
 * @returns {object} billingMenuItems互換のオブジェクト
 */
function getBillingMenuItems(visitDate) {
  return isPostRevision2026(visitDate) ? BILLING_MASTER.after : BILLING_MASTER.before;
}

/**
 * 特定の項目名の点数を取得
 * @param {string} itemName - 項目名
 * @param {string} visitDate - 診察日
 * @returns {number|null} 点数（見つからない場合null）
 */
function getBillingPoints(itemName, visitDate) {
  const master = getBillingMenuItems(visitDate);
  for (const category of Object.values(master)) {
    const found = category.find(item => item.name === itemName);
    if (found) return found.points;
  }
  return null;
}

/**
 * 初診料/再診料を診察日に応じて取得
 * @param {boolean} isFirstVisit - 初診かどうか
 * @param {string} visitDate - 診察日
 * @returns {{ name: string, points: number }}
 */
function getVisitFee(isFirstVisit, visitDate) {
  if (isFirstVisit) {
    return { name: '初診料', points: 291 };
  }
  const points = isPostRevision2026(visitDate) ? 76 : 75;
  return { name: '再診料', points: points };
}

/**
 * 改定情報のサマリーを返す（UI表示用）
 * @param {string} visitDate
 * @returns {object}
 */
function getRevisionInfo(visitDate) {
  const isNew = isPostRevision2026(visitDate);
  return {
    isNewRevision: isNew,
    label: isNew ? '令和8年6月改定（新点数）' : '令和6年改定（旧点数）',
    revisionDate: REVISION_DATE_2026,
  };
}
