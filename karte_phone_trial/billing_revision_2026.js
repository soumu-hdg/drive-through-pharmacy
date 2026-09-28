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
// 段階A（2026-09-24・受領パッケージの仕様に合わせる）: 令和8年6月以降の算定メニューは公式診療行為コード版。
//   名称・点数は支払基金の公式マスターから（tools/fixA_billing_official.py で生成・master/billing_menu_official.json と同じ内容）。
//   code=公式コード／parts=公式の複数行で記録するもの／codeFirst・codeRevisit=初診・再診で別コード
BILLING_MASTER.after = {
 "initial": [
  {
   "code": "111000110",
   "name": "初診料",
   "points": 291
  },
  {
   "code": "112007410",
   "name": "再診料",
   "points": 76
  },
  {
   "code": "112011010",
   "name": "外来管理加算",
   "points": 52
  },
  {
   "name": "外来・在宅物価対応料",
   "points": 2,
   "codeFirst": "180819910",
   "codeRevisit": "180820010"
  },
  {
   "code": "180725710",
   "name": "外来・在宅ベースアップ評価料（１）１（初診時）",
   "points": 17
  },
  {
   "code": "180725810",
   "name": "外来・在宅ベースアップ評価料（１）２（再診時等）",
   "points": 4
  },
  {
   "code": "111000570",
   "name": "時間外加算（初診）",
   "points": 85
  },
  {
   "code": "111000670",
   "name": "休日加算（初診）",
   "points": 250
  },
  {
   "code": "111000770",
   "name": "深夜加算（初診）",
   "points": 480
  },
  {
   "code": "112001110",
   "name": "時間外加算（再診）（入院外）",
   "points": 65
  },
  {
   "code": "112001210",
   "name": "休日加算（再診）（入院外）",
   "points": 190
  },
  {
   "code": "112001310",
   "name": "深夜加算（再診）（入院外）",
   "points": 420
  }
 ],
 "management": [
  {
   "code": "113001810",
   "name": "特定疾患療養管理料（診療所）",
   "points": 225
  },
  {
   "code": "113041710",
   "name": "生活習慣病管理料１（脂質異常症を主病）",
   "points": 610
  },
  {
   "code": "113041810",
   "name": "生活習慣病管理料１（高血圧症を主病）",
   "points": 660
  },
  {
   "code": "113041910",
   "name": "生活習慣病管理料１（糖尿病を主病）",
   "points": 760
  },
  {
   "code": "113707110",
   "name": "生活習慣病管理料２",
   "points": 333
  },
  {
   "code": "113713170",
   "name": "眼科医療機関連携強化加算（生活習慣病管理料１）",
   "points": 60
  },
  {
   "code": "113709770",
   "name": "眼科医療機関連携強化加算（生活習慣病管理料２）",
   "points": 60
  },
  {
   "code": "113713270",
   "name": "歯科医療機関連携強化加算（生活習慣病管理料１）",
   "points": 60
  },
  {
   "code": "113709870",
   "name": "歯科医療機関連携強化加算（生活習慣病管理料２）",
   "points": 60
  },
  {
   "code": "120002370",
   "name": "薬剤情報提供料",
   "points": 4
  },
  {
   "code": "180016110",
   "name": "診療情報提供料（１）",
   "points": 250
  },
  {
   "code": "113004310",
   "name": "療養費同意書交付料",
   "points": 100
  }
 ],
 "procedure": [
  {
   "code": "140000610",
   "name": "創傷処置（１００ｃｍ２未満）",
   "points": 52
  },
  {
   "code": "140000710",
   "name": "創傷処置（１００ｃｍ２以上５００ｃｍ２未満）",
   "points": 60
  },
  {
   "code": "140002210",
   "name": "消炎鎮痛等処置（湿布処置）",
   "points": 35
  },
  {
   "code": "140029610",
   "name": "消炎鎮痛等処置（マッサージ等の手技による療法）",
   "points": 35
  },
  {
   "code": "140040310",
   "name": "消炎鎮痛等処置（器具等による療法）",
   "points": 35
  },
  {
   "code": "140019710",
   "name": "鼻処置",
   "points": 16
  },
  {
   "code": "140022710",
   "name": "ネブライザ",
   "points": 12
  },
  {
   "code": "140011610",
   "name": "皮膚科軟膏処置（１００ｃｍ２以上５００ｃｍ２未満）",
   "points": 55
  }
 ],
 "labtest": [
  {
   "code": "160008010",
   "name": "末梢血液一般検査",
   "points": 21
  },
  {
   "code": "160054710",
   "name": "ＣＲＰ",
   "points": 16
  },
  {
   "code": "160010010",
   "name": "ＨｂＡ１ｃ",
   "points": 49
  },
  {
   "code": "160000310",
   "name": "尿一般",
   "points": 26
  },
  {
   "code": "160006810",
   "name": "糞便中ヘモグロビン",
   "points": 41
  },
  {
   "code": "160229850",
   "name": "ＳＡＲＳ－ＣｏＶ－２抗原定性",
   "points": 150
  },
  {
   "code": "160169450",
   "name": "インフルエンザウイルス抗原定性",
   "points": 132
  },
  {
   "code": "160155510",
   "name": "経皮的動脈血酸素飽和度測定",
   "points": 35
  },
  {
   "code": "160068410",
   "name": "ＥＣＧ１２",
   "points": 130
  },
  {
   "code": "160017410",
   "name": "ＴＰ",
   "points": 11
  },
  {
   "code": "160018910",
   "name": "Ａｌｂ（ＢＣＰ改良法）",
   "points": 11
  },
  {
   "code": "160017010",
   "name": "ＢＩＬ／総",
   "points": 11
  },
  {
   "code": "160022510",
   "name": "ＡＳＴ",
   "points": 17
  },
  {
   "code": "160022610",
   "name": "ＡＬＴ",
   "points": 17
  },
  {
   "code": "160019510",
   "name": "ＬＤ",
   "points": 11
  },
  {
   "code": "160020010",
   "name": "ＡＬＰ",
   "points": 11
  },
  {
   "code": "160020410",
   "name": "γ－ＧＴ",
   "points": 11
  },
  {
   "code": "160020610",
   "name": "ＣＫ",
   "points": 11
  },
  {
   "code": "160019010",
   "name": "ＢＵＮ",
   "points": 11
  },
  {
   "code": "160019210",
   "name": "クレアチニン",
   "points": 11
  },
  {
   "code": "160019310",
   "name": "ＵＡ",
   "points": 11
  },
  {
   "code": "160021110",
   "name": "ナトリウム及びクロール",
   "points": 11
  },
  {
   "code": "160021410",
   "name": "カリウム",
   "points": 11
  },
  {
   "code": "160021510",
   "name": "カルシウム",
   "points": 11
  },
  {
   "code": "160019410",
   "name": "グルコース",
   "points": 11
  },
  {
   "code": "160020910",
   "name": "ＴＧ",
   "points": 11
  },
  {
   "code": "160023410",
   "name": "ＨＤＬ－コレステロール",
   "points": 17
  },
  {
   "code": "160167250",
   "name": "ＬＤＬ－コレステロール",
   "points": 18
  },
  {
   "code": "160020310",
   "name": "Ａｍｙ",
   "points": 11
  },
  {
   "code": "160061810",
   "name": "血液学的検査判断料",
   "points": 125
  },
  {
   "code": "160061910",
   "name": "生化学的検査（１）判断料",
   "points": 144
  },
  {
   "code": "160061710",
   "name": "尿・糞便等検査判断料",
   "points": 34
  }
 ],
 "injection": [
  {
   "code": "130000510",
   "name": "皮内、皮下及び筋肉内注射",
   "points": 25
  },
  {
   "code": "130003510",
   "name": "静脈内注射",
   "points": 37
  },
  {
   "code": "130003810",
   "name": "点滴注射",
   "points": 102
  },
  {
   "code": "130009310",
   "name": "点滴注射（その他）（入院外）",
   "points": 53
  }
 ],
 "imaging": [
  {
   "name": "胸部単純撮影（デジタル・写真診断・電子画像管理加算）",
   "points": 210,
   "parts": [
    {
     "code": "170000410",
     "points": 85,
     "name": "単純撮影（イ）の写真診断"
    },
    {
     "code": "170027910",
     "points": 68,
     "name": "単純撮影（デジタル撮影）"
    },
    {
     "code": "170000210",
     "points": 57,
     "name": "電子画像管理加算（単純撮影）"
    }
   ]
  },
  {
   "name": "腹部単純撮影（デジタル・写真診断・電子画像管理加算）",
   "points": 210,
   "parts": [
    {
     "code": "170000410",
     "points": 85,
     "name": "単純撮影（イ）の写真診断"
    },
    {
     "code": "170027910",
     "points": 68,
     "name": "単純撮影（デジタル撮影）"
    },
    {
     "code": "170000210",
     "points": 57,
     "name": "電子画像管理加算（単純撮影）"
    }
   ]
  },
  {
   "code": "160072210",
   "name": "超音波検査（断層撮影法）（胸腹部）",
   "points": 530
  }
 ]
};

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
