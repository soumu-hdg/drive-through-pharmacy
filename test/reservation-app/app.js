/**
 * DigiMaster 患者様マイページ
 * 予約・書類・薬剤情報を扱う患者ポータル
 */

// 設定
function resolveApiOrigin() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:8000';
    }

    const isLocalHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
    if (isLocalHost && window.location.port && window.location.port !== '8000') {
        return 'http://localhost:8000';
    }

    return window.location.origin;
}

const API_ORIGIN = resolveApiOrigin();

const CONFIG = {
    // APIベースURL（サーバーのURL）
    API_BASE: `${API_ORIGIN}/api/v1`,
    // 施設ID（実際の運用では環境変数やURLパラメータから取得）
    FACILITY_ID: 'ea63ea0c-21a4-4530-af2d-37f21909c5f2'
};

const STORAGE_KEYS = {
    ACCOUNTS: 'digimaster_reservation_accounts_v1',
    RESERVATIONS: 'digimaster_reservations_v1',
    LINE_TOKEN: 'digimaster_line_patient_token_v1',
    LINE_PROFILE: 'digimaster_line_patient_profile_v1',
    GOOGLE_TOKEN: 'digimaster_google_patient_token_v1',
    GOOGLE_PROFILE: 'digimaster_google_patient_profile_v1',
    PATIENT_SELECTION: 'digimaster_reservation_selected_patient_v1',
    REVIEW_SETTINGS: 'digimaster.reviewSettings.v1'
};

// クリニック管理用ストレージキー（admin.jsと共有）
const CLINIC_STORAGE_KEY = 'digimaster.clinics.v1';
const CURRENT_CLINIC_KEY = 'digimaster.currentClinicId';
const CALENDAR_STORAGE_KEY = 'digimaster.reservationCalendars.v1';
const DEPARTMENT_GROUP_STORAGE_KEY = 'digimaster.departmentGroups.v1';
const TREATMENT_MENU_STORAGE_KEY = 'digimaster.treatmentMenus.v1';

const CANONICAL_CLINICS = [
    { id: 'clinic-nishiharu', name: '西春内科・在宅クリニック', aliases: ['西春'] }
];

const CLINIC_SCOPED_STORAGE_KEYS = [
    CALENDAR_STORAGE_KEY,
    DEPARTMENT_GROUP_STORAGE_KEY,
    TREATMENT_MENU_STORAGE_KEY
];

const DOCUMENT_TYPES = [
    { key: 'insurance_card', label: '保険証' },
    { key: 'medical_certificate', label: '医療証' }
];

const DEFAULT_TREATMENT_MENUS = [
    { code: 'lala_doctor', label: 'ララドクター', resourceType: 'nurse', duration_minutes: 40, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'lala_doctor', equipment_label: 'ララドクター' },
    { code: 'botox', label: 'ボトックス注射（アラガン）', resourceType: 'doctor', duration_minutes: 20, set_duration_minutes: 20, room_codes: ['room-07'], equipment_code: 'botox', equipment_label: 'ボトックス注射（アラガン）' },
    { code: 'juvelook', label: 'ジュベルック', resourceType: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'juvelook', equipment_label: 'ジュベルック' },
    { code: 'pluryal_densify', label: 'プルリアルデンシファイ', resourceType: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'pluryal_densify', equipment_label: 'プルリアルデンシファイ' },
    { code: 'profhilo', label: 'プロファイロ', resourceType: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'profhilo', equipment_label: 'プロファイロ' },
    { code: 'potenza', label: 'ポテンツァ（POTENZA）', resourceType: 'nurse', duration_minutes: 60, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'potenza', equipment_label: 'ポテンツァ（POTENZA）' },
    { code: 'density', label: 'デンシティ（DENSITY）', resourceType: 'nurse', duration_minutes: 60, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'density', equipment_label: 'デンシティ（DENSITY）' },
    { code: 'ipl', label: 'IPL光治療（フォトフェイシャル・ステラM22）', resourceType: 'nurse', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-03'], equipment_code: 'ipl', equipment_label: 'IPL光治療（フォトフェイシャル・ステラM22）' },
    { code: 'electroporation', label: 'エレクトロポレーション（メソナJ）', resourceType: 'nurse', duration_minutes: 30, set_duration_minutes: 20, room_codes: ['room-03'], equipment_code: 'electroporation', equipment_label: 'エレクトロポレーション（メソナJ）' },
    { code: 'visia', label: '肌診断器VISIA®（ビジア）', resourceType: 'nurse', duration_minutes: 30, set_duration_minutes: 30, room_codes: ['room-03'], equipment_code: 'visia', equipment_label: '肌診断器VISIA®（ビジア）' },
    { code: 'art_make', label: 'アートメイク', resourceType: 'nurse', duration_minutes: 150, set_duration_minutes: 150, room_codes: ['room-03'], equipment_code: 'artmake', equipment_label: 'アートメイク' },
    { code: 'nurse_counseling', label: '美容カウンセリング', resourceType: 'nurse', duration_minutes: 15, set_duration_minutes: 15, room_codes: ['room-01'], equipment_code: '', equipment_label: '' },
    { code: 'doctor_counseling', label: '医師カウンセリング', resourceType: 'doctor', duration_minutes: 15, set_duration_minutes: 15, room_codes: ['room-01'], equipment_code: '', equipment_label: '' },
];

const EQUIPMENTLESS_TREATMENT_CODES = new Set([]);
const LEGACY_TREATMENT_ROOM_CODES = new Set(['beauty-room-1', 'beauty-room-2', 'consult-room']);

const TREATMENT_RESOURCE_ROLES = [
    { value: 'doctor', label: '医師' },
    { value: 'nurse', label: '看護師' },
    { value: 'clerk', label: '事務員' }
];

function normalizeTreatmentResourceType(value, fallback = 'nurse') {
    const role = String(value || fallback || 'nurse').trim();
    return TREATMENT_RESOURCE_ROLES.some(item => item.value === role) ? role : fallback;
}

function normalizeTreatmentResourceTypes(value, fallback = 'nurse') {
    let values = [];
    if (Array.isArray(value)) {
        values = value;
    } else if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) values = parsed;
            } catch (error) {
                values = [];
            }
        }
        if (!values.length) values = trimmed.replace(/,/g, '、').split('、');
    }
    if (!values.length) values = [fallback || 'nurse'];
    const normalized = [];
    values.forEach(value => {
        const role = normalizeTreatmentResourceType(value, '');
        if (role && !normalized.includes(role)) normalized.push(role);
    });
    return normalized.length ? normalized : [normalizeTreatmentResourceType(fallback || 'nurse')];
}

function getTreatmentResourceLabel(value) {
    return TREATMENT_RESOURCE_ROLES.find(item => item.value === value)?.label || value || '';
}

function getTreatmentResourceLabels(values) {
    return normalizeTreatmentResourceTypes(values).map(getTreatmentResourceLabel).join(' / ');
}

function getPrimaryTreatmentResourceType(menu) {
    return normalizeTreatmentResourceTypes(menu?.resource_types || menu?.resourceTypes, menu?.resource_type || menu?.resourceType || 'nurse')[0];
}

const TREATMENT_MENU_DEMOS = {
    lala_doctor: {
        lead: '肌を育てるピーリング。毎週水曜日はララドクターの日',
        description: '肌のハリ、毛穴、くすみをまとめて整える美肌ケアです。',
        tags: ['毛穴', 'くすみ', 'ニキビ', 'ハリ不足'],
        downtime: '軽い赤み・皮むけが数日出る場合があります',
        staffLabel: '看護師（医師診察あり）',
        duration: '約30分',
        price: '初回 ¥9,900',
        priceSub: '通常 ¥12,100〜',
        badges: ['人気', '水曜日限定'],
        visualLabel: 'LHALA Doctor',
        visualSub: 'Skin peel',
        imageUrl: './assets/treatments/lala-doctor.svg',
        visualTheme: 'orange'
    },
    botox: {
        lead: '表情じわを自然に整えたい方へ',
        description: '表情じわやフェイスラインを自然に調整する注入治療です。',
        tags: ['しわ', 'エラ', '汗', '小顔'],
        downtime: '注射部位に赤み・内出血が出る場合があります',
        staffLabel: '医師',
        duration: '約20分',
        price: '¥9,900〜',
        priceSub: '部位により異なります',
        badges: ['人気'],
        visualLabel: 'Botox',
        visualSub: 'Allergan',
        imageUrl: './assets/treatments/botox.svg',
        visualTheme: 'blue'
    },
    juvelook: {
        lead: '毛穴やニキビ跡をなめらかに',
        description: '毛穴、ニキビ跡、肌質のなめらかさを目指す肌育治療です。',
        tags: ['毛穴', 'ニキビ跡', '肌質改善'],
        downtime: '赤み・腫れが数日出る場合があります',
        staffLabel: '医師',
        duration: '約45分',
        price: '¥44,000',
        priceSub: '全顔 4cc',
        badges: ['肌育'],
        visualLabel: 'Juvelook',
        visualSub: 'Skin booster',
        imageUrl: './assets/treatments/juvelook.svg',
        visualTheme: 'pink'
    },
    pluryal_densify: {
        lead: 'ハリ・弾力、乾燥小じわ、肌質改善へ',
        description: '乾燥小じわやハリ不足に、うるおいを補う注入治療です。',
        tags: ['ハリ不足', '乾燥', '小じわ'],
        downtime: '赤み・腫れ・内出血が出る場合があります',
        staffLabel: '医師',
        duration: '約45分',
        price: '¥55,000',
        priceSub: '顔全体 2cc',
        badges: ['肌育'],
        visualLabel: 'Pluryal',
        visualSub: 'Densify',
        imageUrl: './assets/treatments/pluryal-densify.svg',
        visualTheme: 'violet'
    },
    profhilo: {
        lead: '自然なハリ感とたるみ・肌のもたつきへ',
        description: '肌の土台を整え、自然なハリ感を引き出す注入治療です。',
        tags: ['ハリ不足', 'たるみ', '小じわ'],
        downtime: '赤み・腫れが数日出る場合があります',
        staffLabel: '医師',
        duration: '約45分',
        price: '¥66,000',
        priceSub: '顔全体 2cc',
        badges: ['人気'],
        visualLabel: 'Profhilo',
        visualSub: 'Bio remodeling',
        imageUrl: './assets/treatments/profhilo.svg',
        visualTheme: 'green'
    },
    potenza: {
        lead: '肝斑・赤み・毛穴、ニキビ跡の肌質改善に',
        description: '毛穴、赤み、ニキビ跡にアプローチする高周波治療です。',
        tags: ['毛穴', 'ニキビ跡', '肌質改善', '赤み'],
        downtime: '赤み・ほてりが数日出る場合があります',
        staffLabel: '看護師（医師診察あり）',
        duration: '約60分',
        price: '¥29,700〜',
        priceSub: 'チップ・薬剤により異なります',
        badges: ['人気'],
        visualLabel: 'POTENZA',
        visualSub: 'Jeisys',
        imageUrl: './assets/treatments/potenza.svg',
        visualTheme: 'gold'
    },
    density: {
        lead: 'たるみ、小じわ、肌質改善を集中的にケア',
        description: 'たるみや引き締めを目的とした高周波リフトケアです。',
        tags: ['たるみ', '引き締め', 'ハリ不足'],
        downtime: '赤み・熱感が出る場合があります',
        staffLabel: '看護師（医師診察あり）',
        duration: '約60分',
        price: '¥27,500〜',
        priceSub: 'ショット数により異なります',
        badges: ['リフト'],
        visualLabel: 'DENSITY',
        visualSub: 'Tightening',
        imageUrl: './assets/treatments/density.svg',
        visualTheme: 'slate'
    },
    ipl: {
        lead: 'シミ・そばかす・赤みをまとめてケア',
        description: 'しみ、くすみ、赤みをまとめてケアする光治療です。',
        tags: ['シミ', 'そばかす', '赤み', 'くすみ'],
        downtime: '赤み・かさぶたが出る場合があります',
        staffLabel: '看護師（医師診察あり）',
        duration: '約45分',
        price: '¥8,800〜',
        priceSub: '部位により異なります',
        badges: ['人気'],
        visualLabel: 'Photofacial',
        visualSub: 'IPL',
        imageUrl: './assets/treatments/ipl.svg',
        visualTheme: 'aqua'
    },
    electroporation: {
        lead: '美白、ハリ、ダウンタイム軽減を目的にした導入ケア',
        description: '美容成分を肌に届け、うるおいと透明感を補う導入ケアです。',
        tags: ['乾燥', 'くすみ', 'ハリ不足', '赤み'],
        downtime: 'ダウンタイムはほとんどありません',
        staffLabel: '看護師',
        duration: '約30分',
        price: '¥7,700〜',
        priceSub: '他施術セットあり',
        badges: ['導入'],
        visualLabel: 'Mesona J',
        visualSub: 'Electroporation',
        imageUrl: './assets/treatments/electroporation.svg',
        visualTheme: 'mint'
    },
    art_make: {
        lead: '自然な眉・リップを医療の技術で',
        description: '眉やリップなどを自然に整える医療アートメイクの相談枠です。',
        tags: ['眉', 'リップ'],
        downtime: '赤み・腫れが数日出る場合があります',
        staffLabel: '看護師（医師診察あり）',
        duration: '約120〜180分',
        price: '¥39,800〜',
        priceSub: '部位・リタッチにより異なります',
        badges: [],
        visualLabel: 'Art Make',
        visualSub: 'Brow & lip',
        imageUrl: './assets/treatments/art-make.svg',
        visualTheme: 'rose'
    },
    visia: {
        lead: '肌状態を撮影して適したケアを確認',
        description: '肌状態を撮影・解析し、適したケアをご案内する肌診断です。',
        tags: ['肌診断', 'シミ', '毛穴', '赤み'],
        downtime: '撮影のみのためダウンタイムはありません',
        staffLabel: '看護師',
        duration: '約30分',
        price: '¥0',
        priceSub: '美容カウンセリング',
        badges: ['肌診断'],
        visualLabel: 'VISIA',
        visualSub: 'Skin analysis',
        imageUrl: './assets/treatments/visia.svg',
        visualTheme: 'indigo'
    },
    nurse_counseling: {
        lead: '美容施術の不安や希望を相談したい方へ',
        description: '肌悩みや希望を整理し、適した美容施術をご案内する相談枠です。',
        tags: ['相談', '美容カウンセリング'],
        downtime: '相談のみのためダウンタイムはありません',
        staffLabel: '看護師',
        duration: '約15分',
        price: '¥1,100',
        priceSub: '美容カウンセリング',
        badges: ['相談'],
        visualLabel: 'Counseling',
        visualSub: 'Beauty',
        imageUrl: './assets/treatments/beauty-counseling.svg',
        visualTheme: 'indigo'
    },
    doctor_counseling: {
        lead: '施術前に医師へ相談したい方へ',
        description: '肌状態や希望内容を確認し、適した美容施術をご案内する相談枠です。',
        tags: ['相談', '美容カウンセリング'],
        downtime: '相談のみのためダウンタイムはありません',
        staffLabel: '医師',
        duration: '約15分',
        price: '¥3,300',
        priceSub: '医師カウンセリング',
        badges: ['相談'],
        visualLabel: 'Counseling',
        visualSub: 'Doctor',
        imageUrl: './assets/treatments/doctor-counseling.svg',
        visualTheme: 'indigo'
    }
};

const TREATMENT_RECOMMENDATION_DEFAULTS = {
    lala_doctor: ['electroporation', 'visia', 'ipl'],
    botox: ['visia', 'art_make'],
    juvelook: ['visia', 'electroporation', 'potenza'],
    pluryal_densify: ['visia', 'electroporation'],
    profhilo: ['density', 'visia'],
    potenza: ['electroporation', 'visia', 'juvelook'],
    density: ['profhilo', 'visia'],
    ipl: ['electroporation', 'visia', 'lala_doctor'],
    electroporation: ['ipl', 'potenza', 'lala_doctor'],
    art_make: ['visia'],
    visia: ['ipl', 'potenza', 'lala_doctor'],
    nurse_counseling: ['visia'],
    doctor_counseling: ['visia']
};

const COMMON_CONFIRMATION_ITEMS = [
    '予約日時、クリニック、診療科、施術メニュー、料金表示を確認しました。',
    '予約時間の10分前を目安に来院します。遅刻した場合、施術時間の短縮または当日施術不可となる場合があります。',
    '体調不良、発熱、強い日焼け、皮膚トラブルがある場合は、事前にクリニックへ連絡します。',
    '妊娠中、授乳中、妊娠の可能性がある場合、または治療中の疾患・内服薬・アレルギーがある場合は必ず申告します。',
    '医師の診察・判断により、当日施術内容の変更、延期、または施術不可となる場合があることを理解しました。',
    '施術前後は、飲酒、激しい運動、サウナ、長時間の入浴、強い日焼けを控える必要がある場合があります。',
    '施術後に赤み、腫れ、痛み、乾燥、かさぶた、内出血などが出る可能性があることを理解しました。',
    '施術効果、必要回数、ダウンタイムには個人差があり、希望する結果を保証するものではないことを理解しました。',
    '予約変更・キャンセルはクリニックの案内に従い、無断キャンセルをしません。',
    '本人確認、問診、同意確認、写真撮影、保険証・医療証等の確認が必要になる場合があります。'
];

const TREATMENT_CONFIRMATION_DEFAULTS = {
    lala_doctor: [
        'ピーリング後は乾燥しやすいため、保湿と紫外線対策をしっかり行ってください。',
        '施術前後は強いスクラブ、ピーリング剤、レチノール製品など刺激の強いケアを控えてください。',
        '赤み、ひりつき、薄い皮むけが出る場合があります。'
    ],
    botox: [
        '注射後は当日の飲酒、激しい運動、サウナ、長時間の入浴、施術部位の強いマッサージを控えてください。',
        '内出血、腫れ、左右差、効きすぎ・効きにくさが出る場合があります。',
        '効果の出方には個人差があり、通常数日から2週間程度かけて変化します。'
    ],
    juvelook: [
        '注入部位に赤み、腫れ、痛み、内出血、しこり感が出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '複数回の施術で変化を見ていく治療のため、効果実感には個人差があります。'
    ],
    pluryal_densify: [
        '注入部位に赤み、腫れ、痛み、内出血、むくみが出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '肌状態や診察結果により、施術可否や注入量が変わる場合があります。'
    ],
    profhilo: [
        '注入部位に膨らみ、赤み、内出血、圧痛が一時的に出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '自然な変化を目指す治療のため、効果実感には個人差があります。'
    ],
    potenza: [
        '施術後は赤み、ほてり、乾燥、ざらつき、点状出血が出る場合があります。',
        '施術後数日は保湿と紫外線対策を徹底してください。',
        '肝斑、炎症、肌荒れの状態により、出力や薬剤、施術可否が変わる場合があります。'
    ],
    density: [
        '施術後に赤み、熱感、むくみ、圧痛が出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '金属、ペースメーカー、妊娠中など該当事項がある場合は必ず申告してください。'
    ],
    ipl: [
        '施術後に赤み、ほてり、かさぶた、色素沈着、乾燥が出る場合があります。',
        '施術前後は日焼けを避け、日焼け止めを使用してください。',
        '濃い日焼け、肝斑、炎症、内服薬の内容により施術できない場合があります。'
    ],
    electroporation: [
        '導入薬剤により一時的な赤み、刺激感、乾燥が出る場合があります。',
        '薬剤アレルギー、妊娠・授乳、治療中の疾患がある場合は必ず申告してください。',
        '他施術と組み合わせる場合は、当日の肌状態により内容が変わる場合があります。'
    ],
    visia: [
        '肌診断は撮影・解析を行う検査で、診断結果は治療提案の参考情報です。',
        'メイクや日焼け止めの状態により、撮影結果に影響する場合があります。',
        '診断結果により、希望施術とは別の施術をご案内する場合があります。'
    ],
    art_make: [
        '施術後は腫れ、赤み、かさぶた、色むらが出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '既往歴、アレルギー、妊娠・授乳、ケロイド体質がある場合は必ず申告してください。'
    ],
    nurse_counseling: [
        '相談内容により、当日施術ではなく別日の施術予約をご案内する場合があります。',
        '既往歴、治療中の疾患、内服薬、アレルギーがある場合は必ず申告してください。',
        'カウンセリングのみの予約で、施術実施は当日の空き状況と診察判断により変わります。'
    ],
    doctor_counseling: [
        '相談内容により、当日施術ではなく別日の施術予約をご案内する場合があります。',
        '既往歴、治療中の疾患、内服薬、アレルギーがある場合は必ず申告してください。',
        '診察結果により、希望施術とは別の施術や保険診療をご案内する場合があります。'
    ]
};

const DETAIL_CONFIRMATION_RULES = [
    {
        keywords: ['メソナ', 'エレクトロポレーション'],
        items: [
            'メソナJを含むセットでは、導入薬剤や肌状態により施術内容が変わる場合があります。',
            '薬剤アレルギーや過去に刺激が出た成分がある場合は必ず申告してください。'
        ]
    },
    {
        keywords: ['IPL', 'フォト'],
        items: [
            'IPLを含むセットでは、施術前後の日焼けを避け、紫外線対策を徹底してください。',
            '肝斑、強い炎症、日焼け直後の肌では施術できない場合があります。'
        ]
    },
    {
        keywords: ['ボトックス', 'エラ', '眉間', '目尻', '額', '小顔'],
        items: [
            'ボトックスを含むメニューでは、施術後しばらく施術部位を強く揉まないでください。',
            '注入量や部位は診察により変更となる場合があります。'
        ]
    }
];

const TREATMENT_DETAIL_MENU_DEFAULTS = {
    lala_doctor: [
        { id: 'lala_face_initial', label: 'ララドクター（顔全体）初回', price: '¥9,900', duration: '約30分' },
        { id: 'lala_face_once', label: '2回目以降ララドクター', price: '¥12,100', duration: '約30分' },
        { id: 'lala_set_ipl_double', label: '+ IPL（フォトダブル）', price: '¥9,900', duration: '約60分', description: 'セットメニュー' },
        { id: 'lala_set_ipl_triple', label: '+ IPL（フォトトリプル）', price: '¥12,100', duration: '約60分', description: 'セットメニュー' },
        { id: 'lala_set_mesona_antiaging', label: '+ メソナJ（アンチエイジングコース）', price: '¥6,600', duration: '約60分', description: 'セットメニュー' },
        { id: 'lala_set_mesona_basic', label: '+ メソナJ（ベーシックケアコース）', price: '¥8,800', duration: '約60分', description: 'セットメニュー' },
        { id: 'lala_set_mesona_total', label: '+ メソナJ（トータルケアコース）', price: '¥11,000', duration: '約60分', description: 'セットメニュー' }
    ],
    botox: [
        { id: 'botox_jaw_40', label: 'エラ（40単位）', price: '¥22,000', duration: '約20分' },
        { id: 'botox_jaw_80', label: 'エラ（80単位）', price: '¥44,000', duration: '約20分' },
        { id: 'botox_forehead', label: '額（8〜15単位）', price: '¥13,200', duration: '約20分' },
        { id: 'botox_glabella', label: '眉間', price: '¥9,900', duration: '約20分' },
        { id: 'botox_bunny', label: 'バニーライン', price: '¥9,900', duration: '約20分' },
        { id: 'botox_crow_feet', label: '目尻', price: '¥9,900', duration: '約20分' },
        { id: 'botox_gummy', label: 'ガミースマイル', price: '¥9,900', duration: '約20分' },
        { id: 'botox_droopy_eye', label: 'たれ目', price: '¥9,900', duration: '約20分' },
        { id: 'botox_nasal_alar', label: '鼻翼', price: '¥9,900', duration: '約20分' },
        { id: 'botox_philtrum', label: '人中短縮', price: '¥9,900', duration: '約20分' },
        { id: 'botox_mouth_corner', label: '口角', price: '¥9,900', duration: '約20分' },
        { id: 'botox_chin', label: 'あご（10単位）', price: '¥9,900', duration: '約20分' },
        { id: 'botox_shoulders', label: '両肩（80単位）', price: '¥49,500', duration: '約20分' },
        { id: 'botox_armpits', label: '両脇（80単位・麻酔あり）', price: '¥49,500', duration: '約20分' },
        { id: 'botox_platysma', label: '広頚筋フェイスライン（40〜60単位）', price: '¥49,500', duration: '約20分' }
    ],
    juvelook: [
        { id: 'juvelook_full_face_4cc', label: '全顔（4cc）', price: '¥44,000', duration: '約45分' }
    ],
    pluryal_densify: [
        { id: 'pluryal_full_face_2cc', label: '顔全体（2cc）', price: '¥55,000', duration: '約45分' }
    ],
    profhilo: [
        { id: 'profhilo_full_face_2cc', label: '顔全体（2cc）', price: '¥66,000', duration: '約45分' }
    ],
    density: [
        { id: 'density_mono_bipolar_300', label: 'モノバイポーラ 顔＋首（300ショット）', price: '¥55,000', duration: '約60分' },
        { id: 'density_mono_bipolar_600', label: 'モノバイポーラ 顔＋首（600ショット）', price: '¥110,000', duration: '約75分' },
        { id: 'density_cheek_100', label: 'モノバイポーラ ほほ周り（100ショット）', price: '¥27,500', duration: '約45分' },
        { id: 'density_chin_100', label: 'モノバイポーラ あご周り（100ショット）', price: '¥27,500', duration: '約45分' },
        { id: 'density_monopolar_300', label: 'モノポーラ 顔＋首（300ショット）', price: '¥44,000', duration: '約60分' },
        { id: 'density_monopolar_600', label: 'モノポーラ 顔＋首（600ショット）', price: '¥88,000', duration: '約75分' },
        { id: 'density_mesona_antiaging', label: '+ メソナJ（アンチエイジングコース）', price: '¥6,600', duration: '約60分', description: 'セットメニュー' },
        { id: 'density_mesona_basic', label: '+ メソナJ（ベーシックケアコース）', price: '¥8,800', duration: '約60分', description: 'セットメニュー' },
        { id: 'density_mesona_total', label: '+ メソナJ（トータルケアコース）', price: '¥11,000', duration: '約60分', description: 'セットメニュー' }
    ],
    ipl: [
        { id: 'ipl_face_double', label: '顔（フォトダブル）', price: '¥9,900', duration: '約45分' },
        { id: 'ipl_neck_double', label: '首（フォトダブル）', price: '¥9,900', duration: '約45分' },
        { id: 'ipl_face_triple', label: '顔（フォトトリプル）', price: '¥12,100', duration: '約45分' },
        { id: 'ipl_neck_triple', label: '首（フォトトリプル）', price: '¥12,100', duration: '約45分' },
        { id: 'ipl_hands', label: '手の甲（両手）', price: '¥8,800', duration: '約30分' },
        { id: 'ipl_forearms', label: '前腕（両手）', price: '¥9,900', duration: '約45分' },
        { id: 'ipl_upper_arms', label: '上腕（両手）', price: '¥9,900', duration: '約45分' },
        { id: 'ipl_full_arms', label: '腕全体（両手）', price: '¥13,200', duration: '約60分' },
        { id: 'ipl_mesona_antiaging', label: '+ メソナJ（アンチエイジングコース）', price: '¥6,600', duration: '約60分', description: 'セットメニュー' },
        { id: 'ipl_mesona_basic', label: '+ メソナJ（ベーシックケアコース）', price: '¥8,800', duration: '約60分', description: 'セットメニュー' },
        { id: 'ipl_mesona_total', label: '+ メソナJ（トータルケアコース）', price: '¥11,000', duration: '約60分', description: 'セットメニュー' }
    ],
    potenza: [
        { id: 'potenza_s16', label: 'POTENZA S-16（肝斑・赤み・毛穴）', price: '¥29,700', duration: '約60分' },
        { id: 'potenza_cp25_macoom', label: 'CP-25 マックーム25mg（瘢痕）', price: '¥66,000', duration: '約75分' },
        { id: 'potenza_cp25_botox', label: 'CP-25 ボトックス25単位（皮脂抑制）', price: '¥66,000', duration: '約75分' },
        { id: 'potenza_surface_anesthesia_cp25', label: '表面麻酔（CP-25）', price: '¥0', duration: '約15分', description: '薬剤追加メニュー' },
        { id: 'potenza_add_macoom', label: '薬剤追加 マックーム25mg', price: '¥9,900', duration: '約15分', description: 'CP-25追加メニュー' },
        { id: 'potenza_add_botox', label: '薬剤追加 ボトックス25単位', price: '¥9,900', duration: '約15分', description: 'CP-25追加メニュー' },
        { id: 'potenza_mesona_antiaging', label: '+ メソナJ（アンチエイジングコース）', price: '¥6,600', duration: '約60分', description: 'セットメニュー' },
        { id: 'potenza_mesona_basic', label: '+ メソナJ（ベーシックケアコース）', price: '¥8,800', duration: '約60分', description: 'セットメニュー' },
        { id: 'potenza_mesona_total', label: '+ メソナJ（トータルケアコース）', price: '¥11,000', duration: '約60分', description: 'セットメニュー' }
    ],
    electroporation: [
        { id: 'mesona_antiaging', label: 'アンチエイジングコース（顔＋首）', price: '¥7,700', priceSub: '他施術セット ¥6,600', duration: '約30分' },
        { id: 'mesona_basic_wrinkle', label: 'ベーシックケア シワ・たるみ（顔＋首）', price: '¥9,900', priceSub: '他施術セット ¥8,800', duration: '約30分' },
        { id: 'mesona_basic_acne', label: 'ベーシックケア 毛穴・ニキビ（顔＋首）', price: '¥9,900', priceSub: '他施術セット ¥8,800', duration: '約30分' },
        { id: 'mesona_basic_spot', label: 'ベーシックケア シミ・美白・肝斑（顔＋首）', price: '¥9,900', priceSub: '他施術セット ¥8,800', duration: '約30分' },
        { id: 'mesona_basic_redness', label: 'ベーシックケア 赤ら顔・アトピー性皮膚炎・眼下のくま', price: '¥9,900', priceSub: '他施術セット ¥8,800', duration: '約30分' },
        { id: 'mesona_total', label: 'トータルケアコース（顔＋首）', price: '¥16,500', priceSub: '他施術セット ¥11,000', duration: '約30分' }
    ],
    visia: [
        { id: 'visia_skin_analysis_counseling', label: '肌診断＋美容カウンセリング', price: '¥0', duration: '約30分' }
    ],
    art_make: [
        { id: 'artmake_brow_hair_or_powder', label: '眉（毛並みorパウダー）', price: '¥39,800', priceSub: 'リタッチ ¥34,800', duration: '約120〜180分' },
        { id: 'artmake_brow_hair_and_powder', label: '眉（毛並み＋パウダー）', price: '¥49,800', priceSub: 'リタッチ ¥44,800', duration: '約120〜180分' },
        { id: 'artmake_lip', label: 'リップ', price: '¥39,800', priceSub: 'リタッチ ¥34,800', duration: '約120〜180分' },
        { id: 'artmake_eyeline_upper', label: 'アイライン（上のみ）', price: '¥39,800', priceSub: 'リタッチ ¥34,800', duration: '約120〜180分' },
        { id: 'artmake_eyeline_upper_lower', label: 'アイライン（上下）', price: '¥49,800', priceSub: 'リタッチ ¥44,800', duration: '約120〜180分' },
        { id: 'artmake_metal_allergy_test', label: '金属アレルギースクラッチテスト 30分', price: '¥5,500', duration: '約30分' },
        { id: 'artmake_anesthesia', label: '麻酔代', price: '¥0', duration: '約15分' }
    ],
    nurse_counseling: [
        { id: 'beauty_counseling_once', label: '美容カウンセリング', price: '¥1,100', duration: '約15分' }
    ],
    doctor_counseling: [
        { id: 'doctor_counseling_once', label: '医師カウンセリング', price: '¥3,300', duration: '約15分' }
    ]
};

const TREATMENT_CONCERN_TABS = [
    { id: 'all', label: 'すべて', keywords: [] },
    { id: 'pores', label: '毛穴', keywords: ['毛穴', 'ニキビ跡', '肌質改善'] },
    { id: 'spots', label: 'しみ・くすみ', keywords: ['シミ', 'しみ', 'そばかす', 'くすみ'] },
    { id: 'acne', label: 'ニキビ', keywords: ['ニキビ', 'ニキビ跡', '赤み'] },
    { id: 'firmness', label: 'ハリ不足', keywords: ['ハリ不足', '小じわ', '乾燥', '肌育'] },
    { id: 'redness', label: '赤み', keywords: ['赤み', 'IPL', '肌診断'] },
    { id: 'lift', label: 'たるみ', keywords: ['たるみ', '引き締め', 'リフト'] },
    { id: 'brows', label: '眉・リップ', keywords: ['眉', 'リップ', 'アートメイク'] }
];

function getClinicStorageKey(baseKey, clinicId = state.currentClinicId) {
    return clinicId ? `${baseKey}.${clinicId}` : baseKey;
}

function findCanonicalClinicByName(name = '') {
    const value = String(name || '').trim();
    if (!value) return null;
    return CANONICAL_CLINICS.find(clinic =>
        value === clinic.name ||
        clinic.name.includes(value) ||
        value.includes(clinic.name) ||
        clinic.aliases.some(alias => value.includes(alias))
    ) || null;
}

function findCanonicalClinicById(id = '') {
    return CANONICAL_CLINICS.find(clinic => clinic.id === String(id || '')) || null;
}

function createClinicStorageId(name = '') {
    const canonical = findCanonicalClinicByName(name);
    return canonical?.id || `clinic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeClinicId(id = '', name = '') {
    const canonical = findCanonicalClinicById(id) || findCanonicalClinicByName(name);
    return canonical?.id || String(id || '');
}

function migrateClinicScopedStorage(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    CLINIC_SCOPED_STORAGE_KEYS.forEach(baseKey => {
        const oldKey = `${baseKey}.${oldId}`;
        const newKey = `${baseKey}.${newId}`;
        const oldValue = localStorage.getItem(oldKey);
        if (oldValue !== null && localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, oldValue);
        }
    });
}

function normalizeStoredReservationClinicIds() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.RESERVATIONS);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return false;

        let changed = false;
        const normalized = parsed.map(reservation => {
            const canonicalId = normalizeClinicId(reservation.clinic_id, reservation.clinic_name);
            const canonicalClinic = findCanonicalClinicById(canonicalId);
            if (canonicalId && canonicalId !== reservation.clinic_id) {
                changed = true;
            }
            if (canonicalClinic && !reservation.clinic_name) {
                changed = true;
            }
            return {
                ...reservation,
                clinic_id: canonicalId || reservation.clinic_id || null,
                clinic_name: reservation.clinic_name || canonicalClinic?.name || ''
            };
        });

        if (changed) {
            localStorage.setItem(STORAGE_KEYS.RESERVATIONS, JSON.stringify(normalized));
        }
        return changed;
    } catch (error) {
        console.error('Reservation clinic migration error:', error);
        return false;
    }
}

function normalizeClinicStore() {
    const previousCurrentId = localStorage.getItem(CURRENT_CLINIC_KEY) || state.currentClinicId || '';
    const normalizedCurrentId = normalizeClinicId(previousCurrentId);
    const byId = new Map();
    let changed = false;

    (state.clinics || []).forEach(clinic => {
        const canonical = findCanonicalClinicByName(clinic.name);
        const nextId = canonical?.id || String(clinic.id || createClinicStorageId(clinic.name));
        if (canonical && clinic.id !== nextId) {
            migrateClinicScopedStorage(clinic.id, nextId);
            changed = true;
        }
        const existing = byId.get(nextId);
        byId.set(nextId, {
            ...existing,
            ...clinic,
            id: nextId,
            name: canonical?.name || String(clinic.name || '').trim() || 'クリニック'
        });
    });

    CANONICAL_CLINICS.forEach(canonical => {
        if (!byId.has(canonical.id)) {
            byId.set(canonical.id, {
                id: canonical.id,
                name: canonical.name,
                createdAt: new Date().toISOString()
            });
            changed = true;
        }
    });

    state.clinics = Array.from(byId.values());
    if (changed) {
        localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(state.clinics));
    }

    if (normalizedCurrentId && state.clinics.find(clinic => clinic.id === normalizedCurrentId)) {
        state.currentClinicId = normalizedCurrentId;
        if (previousCurrentId !== normalizedCurrentId) {
            localStorage.setItem(CURRENT_CLINIC_KEY, normalizedCurrentId);
        }
    } else {
        state.currentClinicId = CANONICAL_CLINICS[0].id;
        localStorage.setItem(CURRENT_CLINIC_KEY, state.currentClinicId);
    }

    normalizeStoredReservationClinicIds();
}

function createTreatmentMenuCode(label = 'menu') {
    const ascii = String(label)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ascii || `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTreatmentRecommendationCodes(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/[、,\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function getTreatmentDetailMenuDefaultCode(menu = {}) {
    if (menu.code && TREATMENT_DETAIL_MENU_DEFAULTS[menu.code]) {
        return menu.code;
    }

    const label = String(menu.label || '').toLowerCase();
        if (label.includes('ipl') || label.includes('光治療') || label.includes('フォト')) {
            return 'ipl';
        }
        if (label.includes('ララ')) return 'lala_doctor';
        if (label.includes('ボトックス')) return 'botox';
        if (label.includes('ジュベルック')) return 'juvelook';
        if (label.includes('プルリアル')) return 'pluryal_densify';
        if (label.includes('プロファイロ')) return 'profhilo';
        if (label.includes('density') || label.includes('デンシティ')) return 'density';
        if (label.includes('ポテンツァ')) return 'potenza';
        if (label.includes('エレクトロポレーション') || label.includes('メソナ')) return 'electroporation';
        if (label.includes('visia') || label.includes('ビジア') || label.includes('肌診断')) return 'visia';
        if (label.includes('アートメイク')) return 'art_make';
        if (label.includes('美容カウンセリング') || label.includes('看護師カウンセリング')) return 'nurse_counseling';
        if (label.includes('医師カウンセリング')) return 'doctor_counseling';
        return null;
    }

function getTreatmentDetailMenuDefaults(menu = {}) {
    const code = getTreatmentDetailMenuDefaultCode(menu);
    return code ? (TREATMENT_DETAIL_MENU_DEFAULTS[code] || []).map(item => ({ ...item })) : [];
}

function hasTreatmentDetailMenuData(menu = {}) {
    return ['detail_menus', 'detailMenus', 'sub_menus', 'subMenus', 'options']
        .some(key => Object.prototype.hasOwnProperty.call(menu, key));
}

function getTreatmentDetailMenuData(menu = {}) {
    return menu.detail_menus || menu.detailMenus || menu.sub_menus || menu.subMenus || menu.options || [];
}

function normalizeTreatmentDetailLabel(item = {}) {
    const label = item.label || item.name || '';
    if (
        String(item.id || item.code || '') === 'lala_face_once' &&
        label === 'ララドクター（顔全体）1回'
    ) {
        return '2回目以降ララドクター';
    }
    return label;
}

function createTreatmentDetailMenuId(label = 'detail') {
    const ascii = String(label)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ascii || `detail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function getTreatmentDetailBenefitDefault(label = '', description = '') {
    const text = `${label} ${description}`;
    if (text.includes('初回')) return 'はじめての方が試しやすいおすすめメニュー';
    if (text.includes('1回')) return '肌状態に合わせて継続しやすい基本メニュー';
    if (text.includes('フォトダブル')) return 'シミ・そばかす・くすみをまとめてケア';
    if (text.includes('フォトトリプル')) return '赤みや肌質までしっかり整えたい方に';
    if (text.includes('アンチエイジング')) return 'ハリ不足や乾燥小じわのケアに';
    if (text.includes('ベーシックケア')) return '肌悩みに合わせて美容成分を導入';
    if (text.includes('トータルケア')) return '複数の肌悩みをまとめてケア';
    if (text.includes('肝斑') || text.includes('赤み')) return '肝斑・赤み・毛穴が気になる方に';
    if (text.includes('毛穴') || text.includes('ニキビ')) return '毛穴やニキビ跡の肌質改善に';
    if (text.includes('ボトックス') || text.includes('エラ') || text.includes('眉間') || text.includes('目尻')) return '気になる表情じわや輪郭を自然に整える';
    if (text.includes('美容カウンセリング')) return '肌悩みや希望を整理して施術相談';
    return '';
}

function parseTreatmentDurationMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(480, Math.round(numeric));
    }
    const text = String(value);
    const match = text.match(/(\d+)\s*分?/);
    if (match) return Math.min(480, Number(match[1]));
    if (text.includes('オンライン')) return 15;
    return null;
}

function normalizeTreatmentBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    }
    return Boolean(value);
}

function normalizeTreatmentDateValue(value = '') {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeTreatmentStepIds(value, fallback = []) {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,\n]+/)
            .map(item => item.trim())
            .filter(Boolean);
    const selected = source.length ? source : fallback;
    return [...new Set(selected.map(item => String(item || '').trim()).filter(Boolean))];
}

function getTreatmentStepIdForCode(code = '') {
    const byCode = {
        lala_doctor: 'step-lala_doctor',
        ipl: 'step-ipl',
        density: 'step-density',
        potenza: 'step-potenza',
        electroporation: 'step-mesona',
        botox: 'step-botox',
        juvelook: 'step-juvelook',
        pluryal_densify: 'step-pluryal_densify',
        profhilo: 'step-profhilo',
        art_make: 'step-art_make'
    };
    return byCode[String(code || '').trim()] || '';
}

function getCounselingStepIdForTreatmentMenu(menu = {}) {
    const code = String(menu.code || '').trim();
    if (code === 'art_make') return 'step-art_make_counseling';
    if (code === 'doctor_counseling') return 'step-doctor_counseling';
    const doctorOnlyCodes = new Set(['botox', 'juvelook', 'pluryal_densify', 'profhilo']);
    const roles = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    if (doctorOnlyCodes.has(code) || (roles.length === 1 && roles[0] === 'doctor')) return 'step-doctor_counseling';
    return 'step-counseling';
}

function defaultStepIdsForTreatmentMenu(menu = {}) {
    const code = String(menu.code || '').trim();
    if (code === 'art_make') return ['step-art_make_counseling', 'step-art_make'];
    if (code === 'doctor_counseling') return ['step-doctor_counseling'];
    return [getCounselingStepIdForTreatmentMenu(menu), getTreatmentStepIdForCode(code)].filter(Boolean);
}

function inferTreatmentStepIdsFromText(source = {}, fallbackCode = '') {
    const text = `${source.label || source.name || ''} ${source.description || source.note || ''} ${source.id || source.code || ''} ${fallbackCode || ''}`.toLowerCase();
    const ids = [];
    const add = stepId => {
        if (stepId && !ids.includes(stepId)) ids.push(stepId);
    };
    if (/エレクトロ|エレポ|メソナ|electro|mesona/.test(text)) add('step-mesona');
    if (/ララ|lhala|lala/.test(text)) add('step-lala_doctor');
    if (/ipl|光治療|フォト/.test(text)) add('step-ipl');
    if (/ポテンツァ|potenza/.test(text)) add('step-potenza');
    if (/density|デンシティ/.test(text)) add('step-density');
    if (/ボトックス|botox/.test(text)) add('step-botox');
    if (/ジュベルック|juvelook/.test(text)) add('step-juvelook');
    if (/プルリアル|densify/.test(text)) add('step-pluryal_densify');
    if (/プロファイロ|profhilo/.test(text)) add('step-profhilo');
    if (/アートメイク|眉|リップ|アイライン|artmake|art_make/.test(text)) add('step-art_make');
    return ids;
}

function getDefaultTreatmentDetailStepIds(item = {}, menu = {}) {
    const menuStepIds = normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, defaultStepIdsForTreatmentMenu(menu));
    const fallbackStepIds = normalizeTreatmentStepIds(item.step_ids || item.stepIds, menuStepIds);
    const inferredStepIds = inferTreatmentStepIdsFromText(item, menu.code || '');
    const counselingStepId = fallbackStepIds.find(stepId =>
        ['step-counseling', 'step-art_make_counseling', 'step-doctor_counseling'].includes(stepId)
    ) || getCounselingStepIdForTreatmentMenu(menu);
    const result = [];
    const add = stepId => {
        if (stepId && !result.includes(stepId)) result.push(stepId);
    };
    add(counselingStepId);
    add(getTreatmentStepIdForCode(menu.code));
    fallbackStepIds.forEach(stepId => {
        if (!['step-counseling', 'step-art_make_counseling', 'step-doctor_counseling'].includes(stepId)) add(stepId);
    });
    inferredStepIds.forEach(add);
    return result;
}

function normalizeTreatmentDetailStepAssignments(value, fallbackDuration = null) {
    const rows = Array.isArray(value) ? value : [];
    return rows
        .map((item, index) => {
            const stepId = typeof item === 'string'
                ? item
                : (item.step_id || item.stepId || item.id || item.code || '');
            const duration = parseTreatmentDurationMinutes(
                typeof item === 'string' ? fallbackDuration : (item.duration_minutes ?? item.durationMinutes ?? item.minutes ?? fallbackDuration)
            );
            if (!stepId) return null;
            return {
                step_id: String(stepId).trim(),
                stepId: String(stepId).trim(),
                duration_minutes: duration,
                durationMinutes: duration,
                nomination_enabled: normalizeTreatmentBoolean(
                    typeof item === 'string' ? undefined : (item.nomination_enabled ?? item.nominationEnabled ?? item.staff_selectable ?? item.staffSelectable),
                    false
                ),
                nominationEnabled: normalizeTreatmentBoolean(
                    typeof item === 'string' ? undefined : (item.nomination_enabled ?? item.nominationEnabled ?? item.staff_selectable ?? item.staffSelectable),
                    false
                ),
                display_order: Number((typeof item === 'string' ? undefined : item.display_order ?? item.displayOrder) ?? index * 10)
            };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function completeTreatmentDetailStepAssignments(value, fallbackStepIds = [], fallbackDuration = null) {
    const rows = Array.isArray(value) ? value : [];
    const completed = rows.length ? normalizeTreatmentDetailStepAssignments(rows, fallbackDuration) : [];
    const selected = new Set(completed.map(item => item.step_id || item.stepId).filter(Boolean));
    const orderedStepIds = normalizeTreatmentStepIds(fallbackStepIds, []);
    const defaultDurations = {
        'step-counseling': 15,
        'step-art_make_counseling': 15,
        'step-doctor_counseling': 15,
        'step-lala_doctor': 40,
        'step-ipl': 45,
        'step-density': 60,
        'step-potenza': 60,
        'step-mesona': 30,
        'step-botox': 20,
        'step-juvelook': 45,
        'step-pluryal_densify': 45,
        'step-profhilo': 45,
        'step-art_make': 150
    };
    orderedStepIds.forEach(stepId => {
        if (selected.has(stepId)) return;
        const duration = defaultDurations[stepId] || parseTreatmentDurationMinutes(fallbackDuration) || 30;
        completed.push({
            step_id: stepId,
            stepId,
            duration_minutes: duration,
            durationMinutes: duration,
            nomination_enabled: false,
            nominationEnabled: false,
            display_order: completed.length * 10
        });
        selected.add(stepId);
    });
    const orderByStepId = new Map(orderedStepIds.map((stepId, index) => [stepId, index]));
    return normalizeTreatmentDetailStepAssignments(completed, fallbackDuration)
        .sort((a, b) => {
            const aOrder = orderByStepId.has(a.step_id) ? orderByStepId.get(a.step_id) : Number.MAX_SAFE_INTEGER;
            const bOrder = orderByStepId.has(b.step_id) ? orderByStepId.get(b.step_id) : Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder || Number(a.display_order || 0) - Number(b.display_order || 0);
        });
}

function treatmentDetailDurationFromSteps(assignments = []) {
    const total = assignments.reduce((sum, item) => sum + (parseTreatmentDurationMinutes(item.duration_minutes ?? item.durationMinutes) || 0), 0);
    return total > 0 ? total : null;
}

function formatTreatmentDetailPriceLabel(value = '', lowestPrice = false) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const numericOnly = /^[0-9,]+$/.test(raw);
    const price = numericOnly ? `${raw}円` : raw;
    return lowestPrice && !/[〜~]$/.test(price) ? `${price}〜` : price;
}

function addMinutesToTimeLabel(startTime, minutes, fallbackEndTime = '') {
    if (!startTime || !minutes) return fallbackEndTime || '';
    const [hourText, minuteText = '0'] = String(startTime).split(':');
    const hours = Number(hourText);
    const startMinutes = Number(minuteText);
    if (!Number.isFinite(hours) || !Number.isFinite(startMinutes)) {
        return fallbackEndTime || '';
    }
    const total = hours * 60 + startMinutes + Number(minutes);
    if (!Number.isFinite(total) || total <= 0 || total >= 24 * 60) {
        return fallbackEndTime || '';
    }
    const endHours = Math.floor(total / 60);
    const endMinutes = total % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

function inferTreatmentEquipmentCode(source = {}, fallbackCode = '') {
    const explicit = source.equipment_code || source.equipmentCode || source.resource_code || source.resourceCode;
    if (explicit) return String(explicit).trim();
    const text = `${source.label || source.name || ''} ${fallbackCode || ''}`.toLowerCase();
    if (/エレクトロ|エレポ|メソナ|electro|mesona/.test(text)) return 'electroporation';
    if (/ララ|lhala|lala/.test(text)) return 'lala_doctor';
    if (/ipl|光治療|フォト/.test(text)) return 'ipl';
    if (/ポテンツァ|potenza/.test(text)) return 'potenza';
    if (/visia|ビジア/.test(text)) return 'visia';
    if (/アートメイク|art/.test(text)) return 'artmake';
    if (/ボトックス|botox/.test(text)) return 'botox';
    if (/ジュベルック|juvelook/.test(text)) return 'juvelook';
    if (/プルリアル|densify/.test(text)) return 'pluryal_densify';
    if (/プロファイロ|profhilo/.test(text)) return 'profhilo';
    if (/density|デンシティ/.test(text)) return 'density';
    return String(fallbackCode || source.id || source.code || '').trim();
}

function inferTreatmentEquipmentLabel(source = {}, fallbackLabel = '') {
    const explicit = source.equipment_label || source.equipmentLabel || source.resource_label || source.resourceLabel;
    if (explicit) return String(explicit).trim();
    const code = inferTreatmentEquipmentCode(source, source.code || source.id || '');
    const labels = {
        electroporation: 'エレクトロポレーション（メソナJ）',
        lala_doctor: 'ララドクター',
        ipl: 'IPL光治療（フォトフェイシャル・ステラM22）',
        potenza: 'ポテンツァ（POTENZA）',
        visia: '肌診断器VISIA®（ビジア）',
        artmake: 'アートメイク',
        botox: 'ボトックス注射（アラガン）',
        juvelook: 'ジュベルック',
        pluryal_densify: 'プルリアルデンシファイ',
        profhilo: 'プロファイロ',
        density: 'デンシティ（DENSITY）'
    };
    return labels[code] || String(fallbackLabel || source.label || source.name || code).trim();
}

function treatmentMenuUsesEquipment(menu = {}, code = '') {
    if (menu.uses_equipment === false || menu.usesEquipment === false) return false;
    return !EQUIPMENTLESS_TREATMENT_CODES.has(String(code || menu.code || menu.id || '').trim());
}

function normalizeTreatmentRoomCodes(value) {
    let values = [];
    if (Array.isArray(value)) {
        values = value;
    } else if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) values = parsed;
            } catch (error) {
                values = [];
            }
        }
        if (!values.length) values = trimmed.replace(/,/g, '、').split('、');
    }
    return values
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

function getDefaultTreatmentRoomCodesForMenu(menu = {}, code = '') {
    const selectedCode = String(code || menu.code || menu.id || '').trim();
    if (!treatmentMenuUsesEquipment(menu, selectedCode)) return [];
    const resourceTypes = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    return resourceTypes.includes('doctor') ? ['room-07'] : ['room-03'];
}

function normalizeTreatmentMenuRoomCodes(menu = {}, code = '') {
    const selectedCode = String(code || menu.code || menu.id || '').trim();
    const roomCodes = normalizeTreatmentRoomCodes(menu.room_codes || menu.roomCodes);
    if (!roomCodes.length || roomCodes.some(roomCode => LEGACY_TREATMENT_ROOM_CODES.has(roomCode))) {
        return getDefaultTreatmentRoomCodesForMenu(menu, selectedCode);
    }
    return roomCodes;
}

function normalizeTreatmentStaffIds(value) {
    let values = [];
    if (Array.isArray(value)) {
        values = value;
    } else if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) values = parsed;
            } catch (error) {
                values = [];
            }
        }
        if (!values.length) values = trimmed.replace(/,/g, '、').split('、');
    }
    return values
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

function normalizeTreatmentEquipmentRequirements(value, fallbackMenu = {}) {
    if (!treatmentMenuUsesEquipment(fallbackMenu, fallbackMenu.code || fallbackMenu.id || fallbackMenu.equipment_code || fallbackMenu.equipmentCode)) {
        return [];
    }

    let rows = [];
    if (Array.isArray(value)) {
        rows = value;
    } else if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) rows = parsed;
        } catch (error) {
            rows = [];
        }
    }

    if (!rows.length) {
        const resourceCode = inferTreatmentEquipmentCode(fallbackMenu, fallbackMenu.code || fallbackMenu.id || '');
        const durationMinutes = parseTreatmentDurationMinutes(
            fallbackMenu.duration_minutes ??
            fallbackMenu.durationMinutes ??
            fallbackMenu.duration ??
            fallbackMenu.durationLabel
        );
        if (resourceCode && durationMinutes) {
            rows = [{
                resource_code: resourceCode,
                resource_label: inferTreatmentEquipmentLabel(fallbackMenu, fallbackMenu.label || resourceCode),
                duration_minutes: durationMinutes,
                source: 'main'
            }];
        }
    }

    const normalized = [];
    rows.forEach((row, index) => {
        const resourceCode = inferTreatmentEquipmentCode(row, row.resource_code || row.resourceCode || row.code || row.id || '');
        const durationMinutes = parseTreatmentDurationMinutes(
            row.duration_minutes ?? row.durationMinutes ?? row.duration ?? row.durationLabel
        );
        if (!resourceCode || !durationMinutes) return;
        const source = row.source || (index === 0 ? 'main' : 'set');
        const existing = normalized.find(item => item.resource_code === resourceCode && item.source === source);
        const next = {
            resource_code: resourceCode,
            resource_label: inferTreatmentEquipmentLabel(row, row.resource_label || row.resourceLabel || row.label || resourceCode),
            duration_minutes: durationMinutes,
            source
        };
        if (existing) {
            if (durationMinutes > Number(existing.duration_minutes || 0)) Object.assign(existing, next);
        } else {
            normalized.push(next);
        }
    });
    return normalized;
}

function getDefaultTreatmentSetDuration(code) {
    const durations = {
        lala_doctor: 60,
        electroporation: 20,
        ipl: 45,
        potenza: 60,
        density: 60,
        visia: 30,
        botox: 20,
        juvelook: 45,
        pluryal_densify: 45,
        profhilo: 45,
        artmake: 90
    };
    return durations[String(code || '')] || null;
}

function normalizeTreatmentDetailMenus(value, menu = {}, options = {}) {
    const useDefaults = options.useDefaults !== false;
    let rows = [];

    if (Array.isArray(value)) {
        rows = value;
    } else if (typeof value === 'string') {
        rows = value
            .split(/\n+/)
            .map(label => ({ label: label.trim() }))
            .filter(item => item.label);
    }

    if (!rows.length && useDefaults && !hasTreatmentDetailMenuData(menu)) {
        rows = getTreatmentDetailMenuDefaults(menu);
    }

    return rows
        .map((item, index) => {
            const label = normalizeTreatmentDetailLabel(item);
            const baseDuration = parseTreatmentDurationMinutes(item.duration_minutes ?? item.durationMinutes ?? item.duration ?? item.durationLabel);
            const fallbackStepIds = getDefaultTreatmentDetailStepIds(item, menu);
            const stepAssignments = completeTreatmentDetailStepAssignments(
                item.step_assignments || item.stepAssignments,
                fallbackStepIds,
                baseDuration
            );
            const durationMinutes = baseDuration || treatmentDetailDurationFromSteps(stepAssignments);
            const equipmentCode = inferTreatmentEquipmentCode(item, item.id || item.code || '');
            const equipmentLabel = inferTreatmentEquipmentLabel(item, label);
            const setDurationMinutes = parseTreatmentDurationMinutes(item.set_duration_minutes ?? item.setDurationMinutes) ||
                getDefaultTreatmentSetDuration(equipmentCode) ||
                durationMinutes;
            const stepIds = stepAssignments.map(row => row.step_id).filter(Boolean);
            return {
                id: item.id || item.code || item.local_id || createTreatmentDetailMenuId(label),
                label,
                price: item.price || '',
                priceSub: item.priceSub || item.price_sub || '',
                lowest_price: normalizeTreatmentBoolean(item.lowest_price ?? item.lowestPrice, false),
                lowestPrice: normalizeTreatmentBoolean(item.lowest_price ?? item.lowestPrice, false),
                prepaid_price: item.prepaid_price || item.prepaidPrice || '',
                prepaidPrice: item.prepaid_price || item.prepaidPrice || '',
                prepaid_only: normalizeTreatmentBoolean(item.prepaid_only ?? item.prepaidOnly, false),
                prepaidOnly: normalizeTreatmentBoolean(item.prepaid_only ?? item.prepaidOnly, false),
                tax_category: item.tax_category || item.taxCategory || 'standard_10',
                taxCategory: item.tax_category || item.taxCategory || 'standard_10',
                point_eligible: normalizeTreatmentBoolean(item.point_eligible ?? item.pointEligible, true),
                pointEligible: normalizeTreatmentBoolean(item.point_eligible ?? item.pointEligible, true),
                duration: item.duration || item.durationLabel || (durationMinutes ? `約${durationMinutes}分` : ''),
                duration_minutes: durationMinutes,
                equipment_code: equipmentCode,
                equipmentCode: equipmentCode,
                equipment_label: equipmentLabel,
                equipmentLabel: equipmentLabel,
                set_duration_minutes: setDurationMinutes,
                setDurationMinutes: setDurationMinutes,
                description: item.description || item.note || '',
                benefit: item.benefit || item.merit || item.oneLine || item.one_line || getTreatmentDetailBenefitDefault(label, item.description || item.note || ''),
                caution: item.caution || item.notice || item.attention || '',
                notice: item.caution || item.notice || item.attention || '',
                customer_visible: normalizeTreatmentBoolean(item.customer_visible ?? item.customerVisible ?? item.is_public ?? item.isPublic, true),
                customerVisible: normalizeTreatmentBoolean(item.customer_visible ?? item.customerVisible ?? item.is_public ?? item.isPublic, true),
                available_from: normalizeTreatmentDateValue(item.available_from || item.availableFrom),
                availableFrom: normalizeTreatmentDateValue(item.available_from || item.availableFrom),
                available_to: normalizeTreatmentDateValue(item.available_to || item.availableTo),
                availableTo: normalizeTreatmentDateValue(item.available_to || item.availableTo),
                start_time_limited: normalizeTreatmentBoolean(item.start_time_limited ?? item.startTimeLimited, false),
                startTimeLimited: normalizeTreatmentBoolean(item.start_time_limited ?? item.startTimeLimited, false),
                closing_buffer_enabled: normalizeTreatmentBoolean(item.closing_buffer_enabled ?? item.closingBufferEnabled, false),
                closingBufferEnabled: normalizeTreatmentBoolean(item.closing_buffer_enabled ?? item.closingBufferEnabled, false),
                closing_buffer_minutes: parseTreatmentDurationMinutes(item.closing_buffer_minutes ?? item.closingBufferMinutes),
                closingBufferMinutes: parseTreatmentDurationMinutes(item.closing_buffer_minutes ?? item.closingBufferMinutes),
                daily_limit_enabled: normalizeTreatmentBoolean(item.daily_limit_enabled ?? item.dailyLimitEnabled, false),
                dailyLimitEnabled: normalizeTreatmentBoolean(item.daily_limit_enabled ?? item.dailyLimitEnabled, false),
                daily_limit: Number(item.daily_limit ?? item.dailyLimit ?? '') || null,
                dailyLimit: Number(item.daily_limit ?? item.dailyLimit ?? '') || null,
                change_cancel_allowed: normalizeTreatmentBoolean(item.change_cancel_allowed ?? item.changeCancelAllowed, true),
                changeCancelAllowed: normalizeTreatmentBoolean(item.change_cancel_allowed ?? item.changeCancelAllowed, true),
                skip_duplicate: normalizeTreatmentBoolean(item.skip_duplicate ?? item.skipDuplicate, true),
                skipDuplicate: normalizeTreatmentBoolean(item.skip_duplicate ?? item.skipDuplicate, true),
                step_ids: item.step_ids || item.stepIds || stepIds,
                stepIds: item.step_ids || item.stepIds || stepIds,
                step_assignments: stepAssignments,
                stepAssignments,
                is_active: item.is_active !== false,
                display_order: Number(item.display_order ?? index * 10)
            };
        })
        .filter(item => item.is_active !== false)
        .filter(item => item.label || item.price || item.duration || item.description || item.benefit)
        .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function normalizeStoredTreatmentMenu(menu, index = 0) {
    const code = menu.code || menu.local_id || createTreatmentMenuCode(menu.label);
    const resourceTypes = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    const usesEquipment = treatmentMenuUsesEquipment(menu, code);
    const roomCodes = normalizeTreatmentMenuRoomCodes(menu, code);
    const hasRecommendations =
        Object.prototype.hasOwnProperty.call(menu, 'recommended_menu_codes') ||
        Object.prototype.hasOwnProperty.call(menu, 'recommendedMenuCodes') ||
        Object.prototype.hasOwnProperty.call(menu, 'recommendations');
    const normalized = {
        ...menu,
        code,
        label: menu.label || code,
        resource_type: resourceTypes[0],
        resourceType: resourceTypes[0],
        resource_types: resourceTypes,
        resourceTypes,
        staff_ids: normalizeTreatmentStaffIds(menu.staff_ids || menu.staffIds),
        staffIds: normalizeTreatmentStaffIds(menu.staff_ids || menu.staffIds),
        menu_capacity: Number(menu.menu_capacity ?? menu.menuCapacity ?? 1),
        duration_minutes: parseTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel),
        equipment_code: usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '',
        equipmentCode: usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '',
        equipment_label: usesEquipment ? inferTreatmentEquipmentLabel(menu, menu.label || code) : '',
        equipmentLabel: usesEquipment ? inferTreatmentEquipmentLabel(menu, menu.label || code) : '',
        uses_equipment: usesEquipment,
        usesEquipment,
        set_duration_minutes: parseTreatmentDurationMinutes(menu.set_duration_minutes ?? menu.setDurationMinutes) ||
            getDefaultTreatmentSetDuration(code) ||
            parseTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel),
        setDurationMinutes: parseTreatmentDurationMinutes(menu.set_duration_minutes ?? menu.setDurationMinutes) ||
            getDefaultTreatmentSetDuration(code) ||
            parseTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel),
        room_codes: roomCodes,
        roomCodes,
        equipment_requirements: usesEquipment ? normalizeTreatmentEquipmentRequirements(
            menu.equipment_requirements || menu.equipmentRequirements,
            { ...menu, code }
        ) : [],
        equipmentRequirements: usesEquipment ? normalizeTreatmentEquipmentRequirements(
            menu.equipment_requirements || menu.equipmentRequirements,
            { ...menu, code }
        ) : [],
        recommended_menu_codes: hasRecommendations
            ? normalizeTreatmentRecommendationCodes(menu.recommended_menu_codes || menu.recommendedMenuCodes || menu.recommendations)
            : undefined,
        detail_menus: normalizeTreatmentDetailMenus(
            getTreatmentDetailMenuData(menu),
            { ...menu, code },
            { useDefaults: !hasTreatmentDetailMenuData(menu) }
        ),
        display_order: Number(menu.display_order ?? index * 10),
        is_active: menu.is_active !== false
    };
    if (!hasRecommendations) {
        delete normalized.recommended_menu_codes;
    }
    return normalized;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeLookupText(value = '') {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function findDepartmentByName(departments = [], name = '') {
    const target = normalizeLookupText(name);
    if (!target) return null;
    return departments.find(department => {
        const candidate = normalizeLookupText(department?.name);
        return candidate && (candidate === target || candidate.includes(target) || target.includes(candidate));
    }) || null;
}

function getDepartmentApiId(department = state.selectedDepartment) {
    if (!department) return null;
    return department.api_id || department.server_id || department.real_id || (isUuid(department.id) ? department.id : null);
}

async function ensureDepartmentApiId(department = state.selectedDepartment) {
    const currentId = getDepartmentApiId(department);
    if (currentId) return currentId;

    const publicDepartments = await api.fetchServerDepartments();
    const matched = findDepartmentByName(publicDepartments, department?.name);
    if (!matched?.id) return null;

    department.api_id = matched.id;
    department.server_id = matched.id;
    return matched.id;
}

function isMeaningfulMessage(value) {
    const text = String(value || '').trim();
    return Boolean(text && text !== '[object Object]' && text !== 'undefined' && text !== 'null' && text !== '{}');
}

function formatApiErrorDetail(detail) {
    if (!detail) return '';
    if (detail instanceof Error) {
        return isMeaningfulMessage(detail.message) ? detail.message : '';
    }
    if (typeof detail === 'string') return isMeaningfulMessage(detail) ? detail : '';
    if (Array.isArray(detail)) {
        return detail
            .map(formatApiErrorDetail)
            .filter(Boolean)
            .join('\n');
    }
    if (typeof detail === 'object') {
        const message = detail.msg || detail.message || detail.detail || '';
        const location = Array.isArray(detail.loc) ? detail.loc.filter(part => part !== 'body').join('.') : '';
        if (message) return location ? `${location}: ${message}` : String(message);
        try {
            return JSON.stringify(detail, null, 2);
        } catch (error) {
            return String(detail);
        }
    }
    return String(detail);
}

function getApiErrorMessage(payload, fallback = '処理に失敗しました') {
    if (!payload) return fallback;
    const candidates = typeof payload === 'object'
        ? [payload.detail, payload.message, payload.error, payload.errors, payload]
        : [payload];
    for (const candidate of candidates) {
        const message = formatApiErrorDetail(candidate);
        if (isMeaningfulMessage(message)) return message;
    }
    return fallback;
}

function getErrorMessage(error, fallback = '処理に失敗しました') {
    if (!error) return fallback;
    if (typeof error === 'string') return isMeaningfulMessage(error) ? error : fallback;
    if (error instanceof Error && isMeaningfulMessage(error.message)) {
        return error.message;
    }
    if (error instanceof Error && error.cause) {
        return getApiErrorMessage(error.cause, fallback);
    }
    return getApiErrorMessage(error, fallback);
}

function hasSlotEntries(slots) {
    return Object.values(slots || {}).some(daySlots => Array.isArray(daySlots) && daySlots.length > 0);
}

function loadStoredTreatmentMenus(departmentId = null) {
    if (!state.currentClinicId) return [];

    try {
        const raw = localStorage.getItem(getClinicStorageKey(TREATMENT_MENU_STORAGE_KEY));
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map(normalizeStoredTreatmentMenu)
            .filter(menu => {
                if (menu.is_active === false) return false;
                if (!departmentId) return true;
                return !menu.department_id || String(menu.department_id) === String(departmentId);
            })
            .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
    } catch (error) {
        console.error('Treatment menu storage load error:', error);
        return [];
    }
}

function getTodayISODate() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function makeLocalDepartment(name) {
    return {
        id: `dept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        description: '',
        min_advance_hours: 1
    };
}

function makeNightHolidayCalendar(department) {
    return {
        id: `cal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: department.name,
        departments: [{
            id: department.id,
            name: department.name,
            real: false
        }],
        queueEnabled: false,
        closeOffsetMinutes: 60,
        periods: [{
            id: `period-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            effective_from: getTodayISODate(),
            effective_until: null,
            rows: [{
                id: `row-night-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                start_time: '18:00',
                end_time: '22:00',
                days: [true, true, true, true, true, false, false, false],
                slotDuration: 15,
                slotCapacity: 1,
                firstSlotDuration: 15,
                returnSlotDuration: 15,
                doctorCount: 1
            }, {
                id: `row-holiday-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                start_time: '09:00',
                end_time: '17:00',
                days: [false, false, false, false, false, true, true, true],
                slotDuration: 15,
                slotCapacity: 1,
                firstSlotDuration: 15,
                returnSlotDuration: 15,
                doctorCount: 1
            }]
        }],
        temporarySettings: [],
        staff: [],
        isActive: true
    };
}

function ensureRequestedClinicDefaults() {
    const nishiharu = state.clinics.find(clinic => clinic.name?.includes('西春'));
    if (nishiharu) {
        const deptKey = `${DEPARTMENT_GROUP_STORAGE_KEY}.${nishiharu.id}`;
        const groups = JSON.parse(localStorage.getItem(deptKey) || '[]');
        const safeGroups = Array.isArray(groups) ? groups : [];
        let targetGroup = safeGroups.find(group => Array.isArray(group.departments));
        if (!targetGroup) {
            targetGroup = {
                id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: '診療科',
                departments: []
            };
            safeGroups.push(targetGroup);
        }

        let nightDepartment = safeGroups
            .flatMap(group => group.departments || [])
            .find(dept => dept.name === '夜間休日外来');
        if (!nightDepartment) {
            nightDepartment = makeLocalDepartment('夜間休日外来');
            targetGroup.departments.push(nightDepartment);
            localStorage.setItem(deptKey, JSON.stringify(safeGroups));
        }

        const calendarKey = `${CALENDAR_STORAGE_KEY}.${nishiharu.id}`;
        const calendars = JSON.parse(localStorage.getItem(calendarKey) || '[]');
        const safeCalendars = Array.isArray(calendars) ? calendars : [];
        const hasNightCalendar = safeCalendars.some(calendar =>
            calendar.name === '夜間休日外来' ||
            calendar.departments?.some(dept => dept.id === nightDepartment.id || dept.name === '夜間休日外来')
        );
        if (!hasNightCalendar) {
            safeCalendars.push(makeNightHolidayCalendar(nightDepartment));
            localStorage.setItem(calendarKey, JSON.stringify(safeCalendars));
        }
    }

    const chiba = state.clinics.find(clinic => clinic.name?.includes('千葉'));
    if (!chiba) return;

    const deptKey = `${DEPARTMENT_GROUP_STORAGE_KEY}.${chiba.id}`;
    const groups = JSON.parse(localStorage.getItem(deptKey) || '[]');
    const beautyDepartment = (Array.isArray(groups) ? groups : [])
        .flatMap(group => group.departments || [])
        .find(dept => dept.name?.includes('美容'));
    if (!beautyDepartment) return;

    const calendarKey = `${CALENDAR_STORAGE_KEY}.${chiba.id}`;
    const calendars = JSON.parse(localStorage.getItem(calendarKey) || '[]');
    const safeCalendars = Array.isArray(calendars) ? calendars : [];
    const isWeekdayOnly = days => [true, true, true, true, true, false, false, false]
        .every((value, dayIndex) => Boolean(days?.[dayIndex]) === value);
    const makeChibaRows = () => [{
        id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        start_time: '09:00',
        end_time: '12:00',
        days: [true, true, true, true, true, true, false, false],
        slotDuration: 15,
        slotCapacity: 1,
        firstSlotDuration: 15,
        returnSlotDuration: 15,
        doctorCount: 1
    }, {
        id: `row2-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        start_time: '13:30',
        end_time: '18:00',
        days: [true, true, true, true, true, true, false, false],
        slotDuration: 15,
        slotCapacity: 1,
        firstSlotDuration: 15,
        returnSlotDuration: 15,
        doctorCount: 1
    }];
    let calendarsChanged = false;
    safeCalendars.forEach(calendar => {
        const linkedToBeauty = calendar.name?.includes('美容') ||
            calendar.departments?.some(dept =>
                String(dept.id) === String(beautyDepartment.id) ||
                String(dept.name || '').includes('美容')
            );
        if (!linkedToBeauty) return;

        (calendar.periods || []).forEach(period => {
            const rows = Array.isArray(period.rows) ? period.rows : [];
            const hasLegacyMorning = rows.some(row =>
                row.start_time === '09:00' &&
                row.end_time === '12:00' &&
                isWeekdayOnly(row.days)
            );
            const hasLegacyAfternoon = rows.some(row =>
                row.start_time === '14:00' &&
                row.end_time === '17:00' &&
                isWeekdayOnly(row.days)
            );
            if (hasLegacyMorning && hasLegacyAfternoon) {
                period.rows = makeChibaRows();
                calendarsChanged = true;
            }
        });
    });
    if (calendarsChanged) {
        localStorage.setItem(calendarKey, JSON.stringify(safeCalendars));
    }

    const menuKey = `${TREATMENT_MENU_STORAGE_KEY}.${chiba.id}`;
    const menus = JSON.parse(localStorage.getItem(menuKey) || '[]');
    const safeMenus = Array.isArray(menus) ? menus : [];
    let maxOrder = safeMenus.reduce((max, menu) => Math.max(max, Number(menu.display_order || 0)), 0);
    let menusChanged = false;
    const legacyTreatmentLabels = {
        botox: ['ボトックス'],
        potenza: ['ポテンツァ'],
        density: ['DENSITY', 'デンシティ'],
        ipl: ['IPL光治療', 'IPL'],
        electroporation: ['エレクトロポレーション'],
        visia: ['肌診断器VISIA®(ビジア)']
    };

    DEFAULT_TREATMENT_MENUS.forEach(menu => {
        const existing = safeMenus.find(item => item.code === menu.code);
        if (existing) {
            const oldLabels = legacyTreatmentLabels[menu.code] || [];
            if (!existing.label || oldLabels.includes(existing.label)) {
                existing.label = menu.label;
                menusChanged = true;
            }
            return;
        }
        const sameLabelExists = safeMenus.some(item => item.label === menu.label);
        if (sameLabelExists) return;

        maxOrder += 10;
        safeMenus.push({
            local_id: `menu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            code: menu.code,
            label: menu.label,
            department_id: beautyDepartment.id,
            resource_type: menu.resourceType,
            resource_types: [menu.resourceType],
            menu_capacity: 1,
            duration_minutes: menu.duration_minutes || null,
            set_duration_minutes: menu.set_duration_minutes || menu.duration_minutes || null,
            room_codes: menu.room_codes || [],
            equipment_requirements: menu.equipment_requirements || [],
            equipment_code: menu.equipment_code || '',
            equipment_label: menu.equipment_label || '',
            uses_equipment: menu.uses_equipment !== false,
            display_order: maxOrder,
            is_active: true
        });
        menusChanged = true;
    });

    if (menusChanged) {
        localStorage.setItem(menuKey, JSON.stringify(safeMenus));
    }
}

// アプリケーション状態
const state = {
    clinics: [],
    currentClinicId: null,
    currentStep: 0,  // 0: クリニック選択, 1-4: 予約フロー
    departments: [],
    treatmentMenus: [],
    selectedDepartment: null,
    selectedTreatmentMenu: null,
    selectedTreatmentOption: null,
    selectedTreatmentConcern: 'all',
    selectedSameDayAddOns: [],
    sameDayAddOnRows: [],
    sameDayAddOnRequestId: 0,
    selectedDate: null,
    selectedSlot: null,
    weekOffset: 0,
    availableSlots: {},
    patientInfo: {},
    accounts: [],
    selectedAccountId: null,
    selectedPatientMemberId: null,
    reservationResult: null,
    questionnaire: null,
    questionnaireCompleted: false,
    insuranceCardData: null,
    insuranceUploaded: false,
    reservations: [],
    reviewSettings: { googleReviewUrl: '' },
    selectedHistoryVisitKey: null,
    selectedPortalAction: null,
    lineAuth: {
        token: null,
        profile: null,
        publicConfig: null,
        liffInitialized: false,
        liffReady: false,
        syncing: false,
        notice: null,
        noticeType: 'notice'
    },
    googleAuth: {
        token: null,
        profile: null,
        syncing: false,
        notice: null,
        noticeType: 'notice'
    },
    closeOffset: 60  // 予約受付終了（分）- デフォルト60分前
};

const patientSelectionStore = {
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.PATIENT_SELECTION);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.error('Patient selection load error:', error);
            return null;
        }
    },

    save(accountId = state.selectedAccountId, patientMemberId = state.selectedPatientMemberId) {
        if (!accountId && !patientMemberId) {
            this.clear();
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEYS.PATIENT_SELECTION, JSON.stringify({
                selectedAccountId: accountId || null,
                selectedPatientMemberId: patientMemberId || null,
                updatedAt: new Date().toISOString()
            }));
        } catch (error) {
            console.error('Patient selection save error:', error);
        }
    },

    clear() {
        localStorage.removeItem(STORAGE_KEYS.PATIENT_SELECTION);
    }
};

function getAccountIdFromPatientCandidate(candidate) {
    if (!candidate) return null;
    if (candidate.accountId) return candidate.accountId;
    const candidateId = String(candidate.id || '');
    if (candidateId.endsWith('__self')) return candidateId.replace('__self', '');
    return state.selectedAccountId || null;
}

function selectPatientCandidate(candidate, options = {}) {
    if (!candidate) return null;
    const accountId = getAccountIdFromPatientCandidate(candidate);
    state.selectedPatientMemberId = candidate.id || null;
    state.selectedAccountId = accountId || state.selectedAccountId || null;
    if (options.persist !== false) {
        patientSelectionStore.save(state.selectedAccountId, state.selectedPatientMemberId);
    }
    return candidate;
}

function restoreSelectedPatientSelection(candidates = []) {
    const saved = patientSelectionStore.load();
    if (!saved?.selectedPatientMemberId) return null;
    const selected = candidates.find(candidate => candidate.id === saved.selectedPatientMemberId);
    return selected ? selectPatientCandidate(selected, { persist: false }) : null;
}

function ensureSelectedPatientSelection(candidates = [], options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        state.selectedAccountId = null;
        state.selectedPatientMemberId = null;
        patientSelectionStore.clear();
        return null;
    }

    const current = candidates.find(candidate => candidate.id === state.selectedPatientMemberId);
    if (current) return selectPatientCandidate(current, options);

    const restored = restoreSelectedPatientSelection(candidates);
    if (restored) {
        if (options.persist !== false) patientSelectionStore.save(state.selectedAccountId, state.selectedPatientMemberId);
        return restored;
    }

    if (options.allowFallback === false) return null;
    return selectPatientCandidate(candidates[0], options);
}

const DEFAULT_TIME_ROWS = [
    { start_time: '09:00', end_time: '09:30' },
    { start_time: '09:30', end_time: '10:00' },
    { start_time: '10:00', end_time: '10:30' },
    { start_time: '10:30', end_time: '11:00' },
    { start_time: '11:00', end_time: '11:30' },
    { start_time: '11:30', end_time: '12:00' },
    { start_time: '14:00', end_time: '14:30' },
    { start_time: '14:30', end_time: '15:00' },
    { start_time: '15:00', end_time: '15:30' },
    { start_time: '15:30', end_time: '16:00' },
    { start_time: '16:00', end_time: '16:30' },
    { start_time: '16:30', end_time: '17:00' }
];

// DOM要素
const elements = {
    steps: document.querySelectorAll('.step'),
    serviceFlowItems: document.querySelectorAll('.service-flow-item'),
    sections: {
        step0: document.getElementById('step0'),  // クリニック選択
        step1: document.getElementById('step1'),
        step2: document.getElementById('step2'),
        step3: document.getElementById('step3'),
        step4: document.getElementById('step4'),
        complete: document.getElementById('stepComplete')
    },
    clinicList: document.getElementById('clinicList'),
    clinicName: document.getElementById('clinicName'),
    lineAuthPanel: document.getElementById('lineAuthPanel'),
    lineAuthStatus: document.getElementById('lineAuthStatus'),
    lineLoginBtn: document.getElementById('lineLoginBtn'),
    lineLogoutBtn: document.getElementById('lineLogoutBtn'),
    googleAuthPanel: document.getElementById('googleAuthPanel'),
    googleAuthStatus: document.getElementById('googleAuthStatus'),
    googleLoginBtn: document.getElementById('googleLoginBtn'),
    googleLogoutBtn: document.getElementById('googleLogoutBtn'),
    departmentList: document.getElementById('departmentList'),
    selectedDepartment: document.getElementById('selectedDepartment'),
    treatmentMenuPanel: document.querySelector('.treatment-menu-panel'),
    treatmentConcernTabs: document.getElementById('treatmentConcernTabs'),
    treatmentMenuList: document.getElementById('treatmentMenuList'),
    treatmentDetailPanel: document.getElementById('treatmentDetailPanel'),
    treatmentDetailList: document.getElementById('treatmentDetailList'),
    calendarNav: document.querySelector('.calendar-nav'),
    calendarTableWrap: document.querySelector('.calendar-table-wrap'),
    calendar: document.getElementById('calendar'),
    timeSlots: document.getElementById('timeSlots'),
    currentWeek: document.getElementById('currentWeek'),
    accountForm: document.getElementById('accountForm'),
    accountList: document.getElementById('accountList'),
    accountEmpty: document.getElementById('accountEmpty'),
    familyPanel: document.getElementById('familyPanel'),
    familyForm: document.getElementById('familyForm'),
    familyList: document.getElementById('familyList'),
    portalContent: document.getElementById('portalContent'),
    patientSelectPanel: document.getElementById('patientSelectPanel'),
    reservationPatientList: document.getElementById('reservationPatientList'),
    reservationSameDayAddOns: document.getElementById('reservationSameDayAddOns'),
    reservationSummary: document.getElementById('reservationSummary'),
    confirmCard: document.getElementById('confirmCard'),
    questionnairePanel: document.getElementById('questionnairePanel'),
    questionnaireForm: document.getElementById('questionnaireForm'),
    questionnaireTitle: document.getElementById('questionnaireTitle'),
    questionnaireTaskStatus: document.getElementById('questionnaireTaskStatus'),
    insuranceTaskStatus: document.getElementById('insuranceTaskStatus'),
    insurancePreview: document.getElementById('insurancePreview'),
    insurancePreviewImage: document.getElementById('insurancePreviewImage'),
    checkModal: document.getElementById('checkModal'),
    checkResult: document.getElementById('checkResult')
};

// ユーティリティ
const utils = {
    calcAge(birthdate) {
        if (!birthdate) return null;
        const birth = new Date(birthdate);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    },

    formatAge(birthdate) {
        if (!birthdate) return '';
        const birth = new Date(birthdate);
        const today = new Date();

        let years = today.getFullYear() - birth.getFullYear();
        let months = today.getMonth() - birth.getMonth();

        if (today.getDate() < birth.getDate()) {
            months--;
        }
        if (months < 0) {
            years--;
            months += 12;
        }

        if (years < 0) return '';
        if (years >= 10) {
            return `${years}歳`;
        }
        return `${years}歳${months}ヶ月`;
    },

    formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    formatDisplayDate(date) {
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        return `${date.getMonth() + 1}/${date.getDate()}(${days[date.getDay()]})`;
    },

    getDayName(date) {
        return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    },

    formatDateHeading(date) {
        return `${date.getMonth() + 1}/${date.getDate()}`;
    },

    formatWeekRange(dates) {
        return `${dates[0].getFullYear()}/${String(dates[0].getMonth() + 1).padStart(2, '0')}/${String(dates[0].getDate()).padStart(2, '0')} 週`;
    },

    getWeekDates(offset = 0) {
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay() + (offset * 7));

        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            dates.push(date);
        }
        return dates;
    },

    isToday(date) {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    },

    isPast(date) {
        // 今日の0時と比較して過去かどうか
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);
        return targetDate < today;
    },

    // 時間枠が予約不可かどうか（closeOffset分前まで予約可能）
    isSlotPast(date, startTime, closeOffsetMinutes = 60) {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() + closeOffsetMinutes * 60 * 1000);
        const [hours, minutes] = startTime.split(':').map(Number);
        const slotDateTime = new Date(date);
        slotDateTime.setHours(hours, minutes, 0, 0);
        return slotDateTime <= cutoffTime;
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    normalizePersonIdentity(value) {
        return String(value || '')
            .normalize('NFKC')
            .replace(/[\s\u3000]+/g, '')
            .toUpperCase();
    },

    normalizePersonKana(value) {
        return this.normalizePersonIdentity(value).replace(/[ぁ-ゖ]/g, char =>
            String.fromCharCode(char.charCodeAt(0) + 0x60)
        );
    },

    safeColor(value) {
        return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '') ? value : '#1f73d1';
    },

    safeImageUrl(value) {
        const url = String(value || '').trim();
        if (!url) return '';
        if (/["\\\r\n]/.test(url)) return '';
        if (/^(https?:|data:image\/|\.{0,2}\/)/i.test(url)) return url;
        return '';
    },

    safeExternalUrl(value) {
        const url = String(value || '').trim();
        if (!url || /["\\\r\n\t]/.test(url)) return '';
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
        } catch (error) {
            return '';
        }
    },

    generateId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    },

    formatJapaneseTime(timeStr) {
        if (!timeStr) return '';
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parts[1] || '00';
        return `${hours}時${minutes}分`;
    },

    parseDurationMinutes(value) {
        return parseTreatmentDurationMinutes(value);
    },

    findTreatmentMenuDemo(menu) {
        if (menu?.code && TREATMENT_MENU_DEMOS[menu.code]) {
            return TREATMENT_MENU_DEMOS[menu.code];
        }

        const label = String(menu?.label || '').toLowerCase();
        if (!label) return {};

        if (label.includes('ララ')) return TREATMENT_MENU_DEMOS.lala_doctor;
        if (label.includes('ボトックス')) return TREATMENT_MENU_DEMOS.botox;
        if (label.includes('ジュベルック')) return TREATMENT_MENU_DEMOS.juvelook;
        if (label.includes('プルリアル')) return TREATMENT_MENU_DEMOS.pluryal_densify;
        if (label.includes('プロファイロ')) return TREATMENT_MENU_DEMOS.profhilo;
        if (label.includes('ポテンツァ')) return TREATMENT_MENU_DEMOS.potenza;
        if (label.includes('density') || label.includes('デンシティ')) return TREATMENT_MENU_DEMOS.density;
        if (label.includes('ipl') || label.includes('光治療') || label.includes('フォト')) return TREATMENT_MENU_DEMOS.ipl;
        if (label.includes('エレクトロポレーション') || label.includes('メソナ')) return TREATMENT_MENU_DEMOS.electroporation;
        if (label.includes('アートメイク')) return TREATMENT_MENU_DEMOS.art_make;
        if (label.includes('visia') || label.includes('ビジア') || label.includes('肌診断')) return TREATMENT_MENU_DEMOS.visia;
        if (label.includes('美容カウンセリング') || label.includes('看護師カウンセリング')) return TREATMENT_MENU_DEMOS.nurse_counseling;
        if (label.includes('医師カウンセリング')) return TREATMENT_MENU_DEMOS.doctor_counseling;
        return {};
    },

    findTreatmentMenuDefaultCode(menu) {
        if (menu?.code && TREATMENT_MENU_DEMOS[menu.code]) return menu.code;
        const demo = this.findTreatmentMenuDemo(menu);
        return Object.keys(TREATMENT_MENU_DEMOS).find(code => TREATMENT_MENU_DEMOS[code] === demo) || '';
    },

    normalizeMenuTags(tags) {
        if (Array.isArray(tags)) {
            return tags.map(tag => String(tag).trim()).filter(Boolean);
        }
        return String(tags || '')
            .split(/[、,\s/・]+/)
            .map(tag => tag.trim())
            .filter(Boolean);
    },

    normalizeConfirmationNotes(value) {
        if (Array.isArray(value)) {
            return value.map(item => String(item).trim()).filter(Boolean);
        }
        return String(value || '')
            .split(/\n+/)
            .map(item => item.trim())
            .filter(Boolean);
    },

    uniqueList(items) {
        return Array.from(new Set((items || []).map(item => String(item).trim()).filter(Boolean)));
    },

    treatmentConfirmationNotes(menu = {}) {
        const saved = this.normalizeConfirmationNotes(
            menu?.confirmationNotes || menu?.confirmation_notes || menu?.confirmation_note
        );
        if (saved.length) return saved;
        const defaultCode = this.findTreatmentMenuDefaultCode(menu);
        return TREATMENT_CONFIRMATION_DEFAULTS[defaultCode] || [];
    },

    treatmentDetailConfirmationNotes(option = {}) {
        const saved = this.normalizeConfirmationNotes(
            option?.confirmationNotes || option?.confirmation_notes || option?.confirmation_note
        );
        if (saved.length) return saved;
        const text = `${option?.label || ''} ${option?.description || ''}`;
        return DETAIL_CONFIRMATION_RULES
            .filter(rule => rule.keywords.some(keyword => text.includes(keyword)))
            .flatMap(rule => rule.items);
    },

    inferTreatmentTags(menu, demo = {}) {
        const text = `${menu?.label || ''} ${menu?.description || ''} ${demo.lead || ''} ${demo.description || ''}`;
        const rules = [
            { tag: '毛穴', words: ['毛穴'] },
            { tag: 'ニキビ跡', words: ['ニキビ跡'] },
            { tag: 'ニキビ', words: ['ニキビ'] },
            { tag: 'シミ', words: ['シミ', 'しみ'] },
            { tag: 'そばかす', words: ['そばかす'] },
            { tag: 'くすみ', words: ['くすみ'] },
            { tag: '赤み', words: ['赤み'] },
            { tag: 'ハリ不足', words: ['ハリ', '肌育'] },
            { tag: 'たるみ', words: ['たるみ', 'リフト', '引き締め'] },
            { tag: '乾燥', words: ['乾燥', 'うるおい'] },
            { tag: '眉', words: ['眉'] },
            { tag: 'リップ', words: ['リップ'] },
            { tag: '肌診断', words: ['肌診断', 'VISIA', 'ビジア'] }
        ];
        return rules
            .filter(rule => rule.words.some(word => text.includes(word)))
            .map(rule => rule.tag);
    },

    treatmentStaffLabel(menu, demo = {}) {
        if (menu?.staffLabel || menu?.staff_label) return menu.staffLabel || menu.staff_label;
        if (demo.staffLabel) return demo.staffLabel;
        const resourceTypes = normalizeTreatmentResourceTypes(menu?.resource_types || menu?.resourceTypes, menu?.resource_type || menu?.resourceType || 'nurse');
        if (resourceTypes.length > 1) return getTreatmentResourceLabels(resourceTypes);
        if (resourceTypes[0] === 'doctor') return '医師';
        if (resourceTypes[0] === 'clerk') return '事務員';
        return '看護師（医師診察あり）';
    },

    treatmentVisualTheme(theme) {
        const safeTheme = String(theme || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return safeTheme || 'default';
    },

    formatTreatmentEarliestDate() {
        return this.formatDisplayDate(new Date());
    },

    enrichTreatmentMenu(menu) {
        const demo = this.findTreatmentMenuDemo(menu);
        const tags = this.normalizeMenuTags(menu?.tags || menu?.concerns || demo.tags);
        const inferredTags = tags.length ? tags : this.inferTreatmentTags(menu, demo);
        const code = menu?.code || menu?.local_id || createTreatmentMenuCode(menu?.label);
        const detailMenus = normalizeTreatmentDetailMenus(
            getTreatmentDetailMenuData(menu),
            { ...menu, code },
            { useDefaults: !hasTreatmentDetailMenuData(menu) }
        );
        const usesEquipment = treatmentMenuUsesEquipment(menu, code);
        const roomCodes = normalizeTreatmentMenuRoomCodes(menu || {}, code);
        const staffIds = normalizeTreatmentStaffIds(menu?.staff_ids || menu?.staffIds);
        const equipmentRequirements = usesEquipment ? normalizeTreatmentEquipmentRequirements(
            menu?.equipment_requirements || menu?.equipmentRequirements,
            { ...menu, code }
        ) : [];
        return {
            ...menu,
            code,
            description: menu?.description || demo.description || '内容を確認しながら、適した施術枠をご案内します。',
            lead: menu?.lead || demo.lead || menu?.description || demo.description || '肌状態に合わせて施術内容をご案内します',
            tags: inferredTags.slice(0, 5),
            downtime: menu?.downtime || demo.downtime || 'ダウンタイムは診察時にご案内します',
            staffLabel: this.treatmentStaffLabel(menu, demo),
            duration: menu?.duration || menu?.durationLabel || demo.duration || '約30分',
            duration_minutes: this.parseDurationMinutes(menu?.duration_minutes ?? menu?.durationMinutes ?? menu?.duration ?? menu?.durationLabel ?? demo.duration),
            price: menu?.price || demo.price || '料金確認中',
            priceSub: menu?.priceSub || menu?.price_sub || demo.priceSub || '',
            badges: this.normalizeMenuTags(menu?.badges || demo.badges).slice(0, 2),
            recommendedMenuCodes: normalizeTreatmentRecommendationCodes(
                menu?.recommended_menu_codes || menu?.recommendedMenuCodes || menu?.recommendations || TREATMENT_RECOMMENDATION_DEFAULTS[this.findTreatmentMenuDefaultCode(menu)]
            ),
            confirmationNotes: this.treatmentConfirmationNotes(menu),
            confirmation_notes: this.treatmentConfirmationNotes(menu),
            imageUrl: this.safeImageUrl(menu?.image_url || menu?.imageUrl || menu?.visualImage || menu?.visual_image || demo.imageUrl),
            visualLabel: menu?.visualLabel || menu?.visual_label || demo.visualLabel || menu?.label || 'Treatment',
            visualSub: menu?.visualSub || menu?.visual_sub || demo.visualSub || 'Beauty care',
            visualTheme: this.treatmentVisualTheme(menu?.visualTheme || menu?.visual_theme || demo.visualTheme),
            detailMenus,
            detail_menus: detailMenus,
            staff_ids: staffIds,
            staffIds,
            room_codes: roomCodes,
            roomCodes,
            equipment_requirements: equipmentRequirements,
            equipmentRequirements,
            equipment_code: usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '',
            equipmentCode: usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '',
            equipment_label: usesEquipment ? inferTreatmentEquipmentLabel(menu, menu?.label || code) : '',
            equipmentLabel: usesEquipment ? inferTreatmentEquipmentLabel(menu, menu?.label || code) : '',
            uses_equipment: usesEquipment,
            usesEquipment
        };
    },

    matchesTreatmentConcern(menu, tab) {
        if (!tab || tab.id === 'all') return true;
        const haystack = [
            menu.label,
            menu.lead,
            menu.description,
            menu.downtime,
            ...(menu.tags || [])
        ].join(' ');
        return tab.keywords.some(keyword => haystack.includes(keyword));
    },

    phoneDigits(value) {
        return String(value || '').replace(/\D/g, '');
    },

    splitPhoneNumber(value) {
        const raw = String(value || '').trim();
        if (raw.includes('-')) {
            const parts = raw.split('-').map(part => this.phoneDigits(part)).slice(0, 3);
            return [parts[0] || '', parts[1] || '', parts[2] || ''];
        }

        const digits = this.phoneDigits(raw);
        if (!digits) return ['', '', ''];
        if (digits.length === 11) {
            return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
        }
        if (digits.length === 10 && (digits.startsWith('03') || digits.startsWith('06'))) {
            return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6, 10)];
        }
        if (digits.length === 10) {
            return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)];
        }
        return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)];
    },

    getPhoneParts(baseId) {
        const group = document.querySelector(`.phone-input-group[data-phone-target="${baseId}"]`);
        if (!group) return null;
        return Array.from(group.querySelectorAll('.phone-input'));
    },

    getPhoneValue(baseId) {
        const inputs = this.getPhoneParts(baseId);
        const hidden = document.getElementById(baseId);
        if (!inputs) {
            return hidden?.value.trim() || '';
        }
        const parts = inputs.map(input => this.phoneDigits(input.value));
        const phone = parts.every(Boolean) ? parts.join('-') : '';
        if (hidden) hidden.value = phone;
        return phone;
    },

    isPhoneIncomplete(baseId) {
        const inputs = this.getPhoneParts(baseId);
        if (!inputs) return false;
        const parts = inputs.map(input => this.phoneDigits(input.value));
        return parts.some(Boolean) && !parts.every(Boolean);
    },

    setPhoneParts(baseId, value) {
        const inputs = this.getPhoneParts(baseId);
        const hidden = document.getElementById(baseId);
        const parts = this.splitPhoneNumber(value);
        if (inputs) {
            inputs.forEach((input, index) => {
                input.value = parts[index] || '';
            });
        }
        if (hidden) hidden.value = parts.every(Boolean) ? parts.join('-') : '';
    },

    renderPhoneInput(baseId, required = false) {
        return `
            <div class="phone-input-group" data-phone-target="${this.escapeHTML(baseId)}" ${required ? 'data-phone-required="true"' : ''}>
                <input class="phone-input" type="tel" id="${this.escapeHTML(baseId)}Part1" inputmode="numeric" maxlength="4" autocomplete="tel-area-code" placeholder="090" aria-label="電話番号1">
                <span class="phone-separator">-</span>
                <input class="phone-input" type="tel" id="${this.escapeHTML(baseId)}Part2" inputmode="numeric" maxlength="4" autocomplete="tel-local-prefix" placeholder="1234" aria-label="電話番号2">
                <span class="phone-separator">-</span>
                <input class="phone-input" type="tel" id="${this.escapeHTML(baseId)}Part3" inputmode="numeric" maxlength="4" autocomplete="tel-local-suffix" placeholder="5678" aria-label="電話番号3">
                <input type="hidden" id="${this.escapeHTML(baseId)}" name="phone">
            </div>
        `;
    },

    bindPhoneInputs(root = document) {
        root.querySelectorAll('.phone-input-group').forEach(group => {
            if (group.dataset.bound === 'true') return;
            group.dataset.bound = 'true';
            const baseId = group.dataset.phoneTarget;
            const inputs = Array.from(group.querySelectorAll('.phone-input'));
            inputs.forEach((input, index) => {
                input.addEventListener('input', () => {
                    input.value = this.phoneDigits(input.value).slice(0, Number(input.maxLength) || 4);
                    this.getPhoneValue(baseId);
                    if (input.value.length >= Number(input.maxLength || 4) && inputs[index + 1]) {
                        inputs[index + 1].focus();
                    }
                });
                input.addEventListener('keydown', event => {
                    if (event.key === 'Backspace' && !input.value && inputs[index - 1]) {
                        inputs[index - 1].focus();
                    }
                });
            });
            this.getPhoneValue(baseId);
        });
    }
};

// API呼び出し
const api = {
    async fetchServerDepartments() {
        const response = await fetch(
            `${CONFIG.API_BASE}/departments/public/${CONFIG.FACILITY_ID}`
        );
        if (!response.ok) throw new Error('診療科の取得に失敗しました');
        const departments = await response.json();
        return Array.isArray(departments)
            ? departments.map(department => ({
                ...department,
                local_id: department.local_id || department.id,
                api_id: department.id,
                server_id: department.id
            }))
            : [];
    },

    async fetchDepartments() {
        const serverDepartments = await this.fetchServerDepartments().catch(error => {
            console.error('Server departments load error:', error);
            return [];
        });
        if (serverDepartments.length > 0) {
            return serverDepartments;
        }

        // APIに接続できない場合だけ、退避データとしてlocalStorageを使用
        if (state.currentClinicId) {
            const key = `digimaster.departmentGroups.v1.${state.currentClinicId}`;
            const raw = localStorage.getItem(key);
            if (raw) {
                const groups = JSON.parse(raw);
                // グループ配下の診療科を展開
                const departments = [];
                groups.forEach(group => {
                    if (Array.isArray(group.departments)) {
                        group.departments.forEach(dept => {
                            const serverDepartment = findDepartmentByName(serverDepartments, dept.name);
                            departments.push({
                                id: dept.id,
                                local_id: dept.id,
                                api_id: serverDepartment?.id || (isUuid(dept.id) ? dept.id : null),
                                server_id: serverDepartment?.id || null,
                                name: dept.name,
                                description: dept.description || '',
                                min_advance_hours: dept.min_advance_hours || serverDepartment?.min_advance_hours || 1,
                                groupId: group.id,
                                groupName: group.name
                            });
                        });
                    }
                });
                return departments;
            }
        }
        // localStorageにデータがない場合はサーバーAPIを使用
        return serverDepartments;
    },

    async fetchTreatmentMenus(departmentId = null) {
        const selectedDepartment = state.departments.find(department => String(department.id) === String(departmentId));
        const apiDepartmentId = getDepartmentApiId(selectedDepartment) || (isUuid(departmentId) ? departmentId : null);
        const params = apiDepartmentId
            ? `?${new URLSearchParams({ department_id: apiDepartmentId }).toString()}`
            : '';
        try {
            const response = await fetch(
                `${CONFIG.API_BASE}/reservations/public/${CONFIG.FACILITY_ID}/treatment-menus${params}`
            );
            if (!response.ok) throw new Error('施術メニューの取得に失敗しました');
            const menus = await response.json();
            return Array.isArray(menus) ? menus : [];
        } catch (error) {
            console.error('Treatment menu API load error:', error);
            return loadStoredTreatmentMenus(departmentId);
        }
    },

    async fetchReviewSettings() {
        const response = await fetch(
            `${CONFIG.API_BASE}/reservations/public/${CONFIG.FACILITY_ID}/review-settings`
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '口コミリンク設定を取得できませんでした'));
        }
        return await response.json();
    },

    async fetchLinePublicConfig() {
        const response = await fetch(`${CONFIG.API_BASE}/auth/line/public-config`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'LINE連携設定を取得できませんでした'));
        }
        return await response.json();
    },

    async createLineLiffSession(idToken) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/line/liff-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                facility_id: CONFIG.FACILITY_ID,
                id_token: idToken
            })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'LINE連携に失敗しました'));
        }
        return await response.json();
    },

    async startLineLogin() {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        const params = new URLSearchParams({
            facility_id: CONFIG.FACILITY_ID,
            return_to: returnTo || '/reserve/'
        });
        const response = await fetch(`${CONFIG.API_BASE}/auth/line/start?${params.toString()}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'LINEログインを開始できませんでした'));
        }
        return await response.json();
    },

    async fetchLineSession(token) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/line/me`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'LINEログイン情報を取得できませんでした'));
        }
        return await response.json();
    },

    async saveLineAccount(token, accountData) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/line/account`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ account_data: accountData })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'LINEアカウント情報を保存できませんでした'));
        }
        return await response.json();
    },

    async startGoogleLogin() {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        const params = new URLSearchParams({
            facility_id: CONFIG.FACILITY_ID,
            return_to: returnTo || '/reserve/'
        });
        const response = await fetch(`${CONFIG.API_BASE}/auth/google/start?${params.toString()}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'Googleログインを開始できませんでした'));
        }
        return await response.json();
    },

    async fetchGoogleSession(token) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/google/me`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'Googleログイン情報を取得できませんでした'));
        }
        return await response.json();
    },

    async saveGoogleAccount(token, accountData) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/google/account`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ account_data: accountData })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'Googleアカウント情報を保存できませんでした'));
        }
        return await response.json();
    },

    async fetchSlots(departmentId, startDate, endDate, treatmentMenu = null, durationMinutes = null, equipmentBookings = []) {
        const params = new URLSearchParams({
            department_id: departmentId,
            start_date: startDate,
            end_date: endDate
        });
        if (treatmentMenu?.code) {
            params.set('treatment_menu', treatmentMenu.code);
        }
        if (durationMinutes) {
            params.set('duration_minutes', String(durationMinutes));
        }
        if (Array.isArray(equipmentBookings) && equipmentBookings.length) {
            params.set('equipment_bookings', JSON.stringify(equipmentBookings));
        }

        const response = await fetch(
            `${CONFIG.API_BASE}/schedules/public/${CONFIG.FACILITY_ID}/slots?${params.toString()}`
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '予約枠を取得できませんでした'));
        }

        return await response.json();
    },

    async createReservation(data) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/reservations/public/book`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(getApiErrorMessage(error, '予約の作成に失敗しました'));
            }
            return await response.json();
        } catch (error) {
            if (error instanceof TypeError) {
                throw new Error('サーバーに接続できないため、予約を確定できませんでした。時間をおいて再度お試しください。');
            }
            throw error;
        }
    },

    createLocalReservation(data) {
        const now = new Date();
        const number = `L${utils.formatDate(now).replaceAll('-', '')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}${String(now.getMilliseconds()).padStart(3, '0')}`;
        const treatmentLabel = ui.selectedTreatmentDisplayLabel();
        const selectedClinic = state.clinics.find(c => c.id === state.currentClinicId);
        return {
            id: `local-${number}`,
            reservation_number: number,
            clinic_id: state.currentClinicId || data.clinic_id || null,
            clinic_name: selectedClinic?.name || data.clinic_name || '',
            patient_id: data.patient_id || null,
            department_name: state.selectedDepartment?.name || '',
            treatment_menu: state.selectedTreatmentMenu?.code || null,
            treatment_menu_label: state.selectedTreatmentMenu?.label || '',
            treatment_detail_menu: state.selectedTreatmentOption?.id || null,
            treatment_detail_menu_label: state.selectedTreatmentOption?.label || '',
            treatment_detail_price: ui.selectedTreatmentPriceLabel() || '',
            treatment_display_label: treatmentLabel,
            treatment_resource_type: getPrimaryTreatmentResourceType(state.selectedTreatmentMenu),
            reservation_date: state.selectedSlot?.date || '',
            start_time: state.selectedSlot?.start_time || '',
            end_time: ui.selectedSlotEndTime(),
            patient_name: data.patient_name,
            patient_name_kana: data.patient_name_kana || '',
            patient_phone: data.patient_phone || '',
            patient_email: data.patient_email || '',
            patient_birthdate: data.patient_birthdate || '',
            status: 'confirmed',
            symptoms: data.symptoms || '',
            created_at: now.toISOString()
        };
    },

    async syncPatient(patientData) {
        const response = await fetch(`${CONFIG.API_BASE}/patients/public/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patientData)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const apiError = new Error(getApiErrorMessage(error, '患者様情報の同期に失敗しました'));
            apiError.status = response.status;
            apiError.data = error;
            throw apiError;
        }
        return await response.json();
    },

    async checkReservation(reservationNumber, phone) {
        try {
            const response = await fetch(
                `${CONFIG.API_BASE}/reservations/public/check/${reservationNumber}?phone=${encodeURIComponent(phone)}`
            );
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(getApiErrorMessage(error, '予約が見つかりません'));
            }
            return await response.json();
        } catch (error) {
            throw error;
        }
    },

    async fetchCurrentReservations(patient, token, options = {}) {
        const params = new URLSearchParams();
        params.set('facility_id', CONFIG.FACILITY_ID);
        if (options.includePast) {
            params.set('include_past', 'true');
            params.set('limit', String(options.limit || 100));
        }
        if (isUuid(patient?.patient_id)) {
            params.set('patient_id', patient.patient_id);
        }
        if (patient?.patient_no) {
            params.set('patient_no', patient.patient_no);
        }
        if (patient?.name) {
            params.set('patient_name', patient.name);
        }
        if (patient?.phone) {
            params.set('phone', patient.phone);
        }

        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`${CONFIG.API_BASE}/reservations/public/current?${params.toString()}`, { headers });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '現在予約の取得に失敗しました'));
        }
        return await response.json();
    },

    async cancelReservation(reservationNumber, phone, reason = null) {
        try {
            let url = `${CONFIG.API_BASE}/reservations/public/cancel/${reservationNumber}?phone=${encodeURIComponent(phone)}`;
            if (reason) url += `&reason=${encodeURIComponent(reason)}`;

            const response = await fetch(url, { method: 'POST' });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(getApiErrorMessage(error, 'キャンセルに失敗しました'));
            }
            return await response.json();
        } catch (error) {
            throw error;
        }
    },

    async fetchQuestionnaire(departmentId) {
        try {
            const response = await fetch(
                `${CONFIG.API_BASE}/questionnaires/public/${CONFIG.FACILITY_ID}/by-department/${departmentId}`
            );
            if (!response.ok) throw new Error('問診票の取得に失敗しました');
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            return null;
        }
    },

    async submitQuestionnaire(questionnaireId, responses, context = {}) {
        const reservationId = context.reservationId ?? state.reservationResult?.id ?? null;
        const patientId = context.patientId ?? state.patientInfo.patient_id ?? null;
        const patientPhone = context.patientPhone ?? state.patientInfo.patient_phone ?? null;

        const response = await fetch(`${CONFIG.API_BASE}/questionnaires/${questionnaireId}/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reservation_id: reservationId,
                patient_id: patientId,
                patient_phone: patientPhone,
                responses
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '問診回答の保存に失敗しました'));
        }

        return await response.json();
    },

    async uploadReservationAttachment(attachmentType, documentData) {
        if (!state.reservationResult?.id || !documentData?.data_url) return null;

        const response = await fetch(`${CONFIG.API_BASE}/reservations/public/attachment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reservation_id: state.reservationResult.id,
                patient_phone: state.patientInfo.patient_phone,
                attachment_type: attachmentType,
                file_name: documentData.file_name,
                content_type: documentData.content_type,
                data_url: documentData.data_url
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '提出書類の登録に失敗しました'));
        }

        return await response.json();
    },

    async uploadInsuranceCard() {
        const response = await fetch(`${CONFIG.API_BASE}/reservations/public/insurance-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reservation_id: state.reservationResult?.id,
                patient_phone: state.patientInfo.patient_phone,
                ...state.insuranceCardData
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, '保険証画像の登録に失敗しました'));
        }

        return await response.json();
    }
};

const accountStore = {
    restoreFromReservations() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.RESERVATIONS);
            const reservations = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(reservations)) return [];

            const accountsByKey = new Map();
            reservations.forEach((reservation, index) => {
                const name = String(reservation.patient_name || '').trim();
                const phone = String(reservation.patient_phone || '').trim();
                const birthdate = String(reservation.patient_birthdate || '').trim();
                if (!name || !phone || !birthdate) return;

                const key = [
                    reservation.patient_id || reservation.patient_no || '',
                    name,
                    phone.replace(/\D/g, ''),
                    birthdate
                ].join('|');

                if (accountsByKey.has(key)) return;

                accountsByKey.set(key, {
                    id: utils.generateId(`account-recovered-${index}`),
                    type: 'parent',
                    name,
                    kana: reservation.patient_name_kana || '',
                    phone,
                    email: reservation.patient_email || '',
                    birthdate,
                    patient_id: isUuid(reservation.patient_id) ? reservation.patient_id : null,
                    patient_no: reservation.patient_no || '',
                    documents: {},
                    members: [],
                    recovered_from_reservation: true
                });
            });

            return Array.from(accountsByKey.values());
        } catch (error) {
            console.error('Account recovery from reservations failed:', error);
            return [];
        }
    },

    normalize(accounts) {
        return accounts.map(account => ({
            ...account,
            documents: account.documents || {},
            members: (account.members || []).map(member => ({
                ...member,
                documents: member.documents || {}
            }))
        }));
    },

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNTS);
            const accounts = raw ? JSON.parse(raw) : [];
            if (Array.isArray(accounts) && accounts.length > 0) {
                return this.normalize(accounts);
            }

            const restored = this.restoreFromReservations();
            if (restored.length > 0) {
                localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(restored));
                return this.normalize(restored);
            }

            return [];
        } catch (error) {
            console.error('Account storage load error:', error);
            return [];
        }
    },

    save(accounts, options = {}) {
        try {
            const normalized = this.normalize(Array.isArray(accounts) ? accounts : []);
            localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(normalized));
            if (state.selectedAccountId || state.selectedPatientMemberId) {
                patientSelectionStore.save();
            }
            if (!options.skipRemoteSync) {
                lineAuth.scheduleAccountSync(normalized);
                googleAuth.scheduleAccountSync(normalized);
            }
            return true;
        } catch (error) {
            console.error('Account storage save error:', error);
            return false;
        }
    }
};

function getAllLocalPatientIdentityCandidates() {
    return state.accounts.flatMap(account => {
        const self = {
            id: `${account.id}__self`,
            accountId: account.id,
            patient_id: account.patient_id || null,
            patient_no: account.patient_no || '',
            name: account.name || '',
            kana: account.kana || '',
            birthdate: account.birthdate || '',
            isPrimary: true
        };
        const members = (account.members || []).map(member => ({
            id: member.id,
            accountId: account.id,
            patient_id: member.patient_id || null,
            patient_no: member.patient_no || '',
            name: member.name || '',
            kana: member.kana || '',
            birthdate: member.birthdate || '',
            isPrimary: false
        }));
        return [self, ...members];
    });
}

function isExcludedPatientIdentityCandidate(candidate, options = {}) {
    const excludePatientId = String(options.excludePatientId || '');
    if (!excludePatientId) return false;

    const excludeAccountId = String(options.excludeAccountId || '');
    const excludeType = options.excludePatientType || '';

    if (candidate.isPrimary && (excludeType === 'account' || !excludeType)) {
        return candidate.accountId === excludePatientId
            || candidate.id === excludePatientId
            || candidate.id === `${excludePatientId}__self`;
    }

    if (!candidate.isPrimary && (excludeType === 'member' || !excludeType)) {
        return candidate.id === excludePatientId
            && (!excludeAccountId || candidate.accountId === excludeAccountId);
    }

    return false;
}

function findDuplicateLocalPatient(patient, options = {}) {
    const targetBirthdate = String(patient?.birthdate || patient?.birth_date || '').slice(0, 10);
    const targetName = utils.normalizePersonIdentity(patient?.name);
    const targetKana = utils.normalizePersonKana(patient?.kana || patient?.name_kana);
    if (!targetName || !targetBirthdate) return null;

    return getAllLocalPatientIdentityCandidates().find(candidate => {
        if (isExcludedPatientIdentityCandidate(candidate, options)) return false;
        if (String(candidate.birthdate || '').slice(0, 10) !== targetBirthdate) return false;

        const candidateName = utils.normalizePersonIdentity(candidate.name);
        const candidateKana = utils.normalizePersonKana(candidate.kana);
        return candidateName === targetName || (targetKana && candidateKana === targetKana);
    }) || null;
}

function duplicateLocalPatientMessage(patient) {
    const patientNo = patient?.patient_no ? `（患者番号: ${patient.patient_no}）` : '';
    return `${patient?.name || '同一患者様'}${patientNo}は既に登録されています。登録済みの患者様を選択してください。`;
}

async function syncAccountPatientToServer(account) {
    if (!account?.name || !account?.phone || !account?.birthdate) return null;

    const synced = await api.syncPatient({
        facility_id: CONFIG.FACILITY_ID,
        patient_id: isUuid(account.patient_id) ? account.patient_id : null,
        name: account.name,
        name_kana: account.kana || account.name,
        phone: account.phone,
        email: account.email || '',
        birth_date: account.birthdate,
        gender: account.gender || 'other'
    });

    account.patient_id = synced.id;
    account.patient_no = synced.patient_no || account.patient_no || '';
    return synced;
}

const lineAuth = {
    syncTimer: null,

    officialName() {
        return state.lineAuth.publicConfig?.official_account_name || '西春内科・在宅クリニック公式LINE';
    },

    officialUrl() {
        return state.lineAuth.publicConfig?.official_account_url || '';
    },

    liffId() {
        return state.lineAuth.publicConfig?.liff_id || '';
    },

    liffUrl() {
        const id = this.liffId();
        return id ? `https://liff.line.me/${encodeURIComponent(id)}` : '';
    },

    loadToken() {
        return localStorage.getItem(STORAGE_KEYS.LINE_TOKEN) || '';
    },

    saveToken(token) {
        state.lineAuth.token = token || null;
        if (token) {
            localStorage.setItem(STORAGE_KEYS.LINE_TOKEN, token);
        } else {
            localStorage.removeItem(STORAGE_KEYS.LINE_TOKEN);
        }
    },

    saveProfile(profile) {
        state.lineAuth.profile = profile || null;
        if (profile) {
            localStorage.setItem(STORAGE_KEYS.LINE_PROFILE, JSON.stringify(profile));
        } else {
            localStorage.removeItem(STORAGE_KEYS.LINE_PROFILE);
        }
    },

    loadProfile() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LINE_PROFILE);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    isLoggedIn() {
        return Boolean(state.lineAuth.token);
    },

    setNotice(message, type = 'notice') {
        state.lineAuth.notice = message || null;
        state.lineAuth.noticeType = type;
        this.renderStatus();
    },

    clearNotice() {
        this.setNotice(null);
    },

    async loadPublicConfig() {
        try {
            state.lineAuth.publicConfig = await api.fetchLinePublicConfig();
        } catch (error) {
            console.error('LINE public config load error:', error);
            state.lineAuth.publicConfig = {
                official_account_name: '西春内科・在宅クリニック公式LINE',
                official_account_url: '',
                liff_id: '',
                liff_enabled: false,
                login_enabled: false,
                messaging_enabled: false
            };
            this.setNotice('LINE連携設定を取得できませんでした。通常予約はこのまま利用できます。', 'warning');
        }
        this.renderStatus();
    },

    async initLiffSession() {
        const liffId = this.liffId();
        if (!liffId || !window.liff || state.lineAuth.liffInitialized) return;

        state.lineAuth.liffInitialized = true;
        try {
            await window.liff.init({
                liffId,
                withLoginOnExternalBrowser: false
            });
            state.lineAuth.liffReady = true;

            if (!window.liff.isLoggedIn()) {
                this.renderStatus();
                return;
            }

            const idToken = window.liff.getIDToken();
            if (idToken && !this.isLoggedIn()) {
                await this.loginWithLiffToken(idToken);
            }
        } catch (error) {
            console.error('LIFF init error:', error);
            this.setNotice('公式LINE連携を開始できませんでした。通常予約はこのまま利用できます。', 'warning');
        }
    },

    async loginWithLiffToken(idToken) {
        const session = await api.createLineLiffSession(idToken);
        this.saveToken(session.token);
        this.saveProfile(session.profile);
        this.applyRemoteAccountData(session.account_data || {}, session.profile);
        this.renderStatus();
    },

    cleanLoginQuery() {
        const url = new URL(window.location.href);
        ['line_token', 'line_login', 'line_error'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    },

    async consumeRedirectToken() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('line_token');
        const loginStatus = params.get('line_login');
        const errorMessage = params.get('line_error');

        if (token) {
            this.saveToken(token);
            this.cleanLoginQuery();
            return;
        }

        if (loginStatus === 'error') {
            this.cleanLoginQuery();
            this.setNotice(errorMessage || 'LINEログインに失敗しました', 'error');
        }
    },

    createLineAccount(profile) {
        const displayName = profile?.display_name || 'LINEユーザー';
        return {
            id: utils.generateId('account'),
            type: 'parent',
            name: displayName,
            kana: '',
            phone: '',
            email: profile?.email || '',
            birthdate: '',
            line_user_id: profile?.line_user_id || '',
            line_display_name: displayName,
            line_picture_url: profile?.picture_url || '',
            patient_id: null,
            patient_no: '',
            documents: {},
            members: []
        };
    },

    applyRemoteAccountData(accountData, profile) {
        const remoteAccounts = Array.isArray(accountData?.accounts)
            ? accountStore.normalize(accountData.accounts)
            : [];

        if (remoteAccounts.length > 0) {
            state.accounts = remoteAccounts;
            state.selectedAccountId = accountData.selectedAccountId || remoteAccounts[0].id;
            state.selectedPatientMemberId = accountData.selectedPatientMemberId || `${state.selectedAccountId}__self`;
            restoreSelectedPatientSelection(ui.getAllPatientCandidates()) || ensureSelectedPatientSelection(ui.getAllPatientCandidates());
            accountStore.save(state.accounts, { skipRemoteSync: true });
            return 'restored';
        }

        if (state.accounts.length > 0) {
            state.accounts = state.accounts.map((account, index) => index === 0
                ? {
                    ...account,
                    line_user_id: profile?.line_user_id || account.line_user_id || '',
                    line_display_name: profile?.display_name || account.line_display_name || '',
                    line_picture_url: profile?.picture_url || account.line_picture_url || ''
                }
                : account
            );
            state.selectedAccountId = state.selectedAccountId || state.accounts[0].id;
            restoreSelectedPatientSelection(ui.getAllPatientCandidates()) || ensureSelectedPatientSelection(ui.getAllPatientCandidates());
            accountStore.save(state.accounts);
            return 'linked-local';
        }

        const account = this.createLineAccount(profile);
        state.accounts = [account];
        selectPatientCandidate({ id: `${account.id}__self`, accountId: account.id });
        accountStore.save(state.accounts);
        return 'created';
    },

    buildAccountData(accounts = state.accounts) {
        return {
            accounts: accountStore.normalize(accounts),
            selectedAccountId: state.selectedAccountId || null,
            selectedPatientMemberId: state.selectedPatientMemberId || null,
            updatedAt: new Date().toISOString()
        };
    },

    scheduleAccountSync(accounts = state.accounts) {
        if (!this.isLoggedIn() || state.lineAuth.syncing) return;
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
            this.syncAccounts(accounts).catch(error => {
                console.error('LINE account sync error:', error);
            });
        }, 500);
    },

    async syncAccounts(accounts = state.accounts) {
        if (!this.isLoggedIn()) return;
        state.lineAuth.syncing = true;
        try {
            const session = await api.saveLineAccount(
                state.lineAuth.token,
                this.buildAccountData(accounts)
            );
            this.saveProfile(session.profile);
            this.renderStatus();
        } finally {
            state.lineAuth.syncing = false;
        }
    },

    async refreshSession() {
        const token = this.loadToken();
        const cachedProfile = this.loadProfile();
        state.lineAuth.token = token || null;
        state.lineAuth.profile = cachedProfile;

        if (!token) {
            this.renderStatus();
            return;
        }

        try {
            const session = await api.fetchLineSession(token);
            this.saveProfile(session.profile);
            this.applyRemoteAccountData(session.account_data || {}, session.profile);
            this.renderStatus();
        } catch (error) {
            console.error('LINE session refresh error:', error);
            this.logout({ silent: true });
        }
    },

    async login() {
        try {
            this.clearNotice();
            elements.lineLoginBtn?.setAttribute('disabled', 'true');

            if (this.liffUrl()) {
                window.location.href = this.liffUrl();
                return;
            }

            if (this.officialUrl()) {
                window.location.href = this.officialUrl();
                return;
            }

            this.setNotice('公式LINEの予約リンク設定が未接続です。通常予約はこのまま利用できます。', 'warning');
        } catch (error) {
            console.error('LINE official account start error:', error);
            this.setNotice(error.message || '公式LINE連携を開始できませんでした', 'error');
        } finally {
            elements.lineLoginBtn?.removeAttribute('disabled');
        }
    },

    logout(options = {}) {
        this.saveToken('');
        this.saveProfile(null);
        clearTimeout(this.syncTimer);
        this.renderStatus();
        if (!options.silent) {
            alert('LINE連携を解除しました');
        }
    },

    renderStatus() {
        if (!elements.lineAuthPanel || !elements.lineAuthStatus) return;
        const profile = state.lineAuth.profile;
        const loggedIn = this.isLoggedIn();
        const notice = state.lineAuth.notice;
        const noticeType = state.lineAuth.noticeType || 'notice';
        const officialName = this.officialName();
        const defaultNotice = this.liffUrl()
            ? '公式LINEから予約すると通知を受け取れます'
            : '公式LINEの予約リンク設定待ちです。通常予約は利用できます';
        elements.lineAuthPanel.classList.toggle('logged-in', loggedIn);
        elements.lineAuthStatus.innerHTML = loggedIn ? `
            ${profile?.picture_url ? `<img src="${utils.escapeHTML(profile.picture_url)}" alt="">` : '<span class="line-auth-avatar">LINE</span>'}
            <span>
                <strong>${utils.escapeHTML(profile?.display_name || 'LINEユーザー')}</strong>
                <small>${utils.escapeHTML(officialName)}の予約通知を受け取れます</small>
            </span>
        ` : `
            <span class="line-auth-avatar">LINE</span>
            <span>
                <strong>${utils.escapeHTML(officialName)}</strong>
                <small class="${notice ? `line-auth-notice ${noticeType}` : ''}">
                    ${utils.escapeHTML(notice || defaultNotice)}
                </small>
            </span>
        `;
        if (elements.lineLoginBtn) {
            elements.lineLoginBtn.textContent = this.liffUrl() ? '公式LINEから開く' : '設定待ち';
            elements.lineLoginBtn.disabled = !this.liffUrl() && !this.officialUrl();
        }
        elements.lineLoginBtn?.classList.toggle('hidden', loggedIn);
        elements.lineLogoutBtn?.classList.toggle('hidden', !loggedIn);
    }
};

const googleAuth = {
    syncTimer: null,

    loadToken() {
        return localStorage.getItem(STORAGE_KEYS.GOOGLE_TOKEN) || '';
    },

    saveToken(token) {
        state.googleAuth.token = token || null;
        if (token) {
            localStorage.setItem(STORAGE_KEYS.GOOGLE_TOKEN, token);
        } else {
            localStorage.removeItem(STORAGE_KEYS.GOOGLE_TOKEN);
        }
    },

    saveProfile(profile) {
        state.googleAuth.profile = profile || null;
        if (profile) {
            localStorage.setItem(STORAGE_KEYS.GOOGLE_PROFILE, JSON.stringify(profile));
        } else {
            localStorage.removeItem(STORAGE_KEYS.GOOGLE_PROFILE);
        }
    },

    loadProfile() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.GOOGLE_PROFILE);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    isLoggedIn() {
        return Boolean(state.googleAuth.token);
    },

    setNotice(message, type = 'notice') {
        state.googleAuth.notice = message || null;
        state.googleAuth.noticeType = type;
        this.renderStatus();
    },

    clearNotice() {
        this.setNotice(null);
    },

    cleanLoginQuery() {
        const url = new URL(window.location.href);
        ['google_token', 'google_login', 'google_error'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    },

    async consumeRedirectToken() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('google_token');
        const loginStatus = params.get('google_login');
        const errorMessage = params.get('google_error');

        if (token) {
            this.saveToken(token);
            this.cleanLoginQuery();
            return;
        }

        if (loginStatus === 'error') {
            this.cleanLoginQuery();
            this.setNotice(errorMessage || 'Googleログインに失敗しました', 'error');
        }
    },

    createGoogleAccount(profile) {
        const displayName = profile?.display_name || profile?.email || 'Googleユーザー';
        return {
            id: utils.generateId('account'),
            type: 'parent',
            name: displayName,
            kana: '',
            phone: '',
            email: profile?.email || '',
            birthdate: '',
            google_user_id: profile?.google_user_id || '',
            google_display_name: profile?.display_name || displayName,
            google_picture_url: profile?.picture_url || '',
            patient_id: null,
            patient_no: '',
            documents: {},
            members: []
        };
    },

    applyRemoteAccountData(accountData, profile) {
        const remoteAccounts = Array.isArray(accountData?.accounts)
            ? accountStore.normalize(accountData.accounts)
            : [];

        if (remoteAccounts.length > 0) {
            state.accounts = remoteAccounts;
            state.selectedAccountId = accountData.selectedAccountId || remoteAccounts[0].id;
            state.selectedPatientMemberId = accountData.selectedPatientMemberId || `${state.selectedAccountId}__self`;
            restoreSelectedPatientSelection(ui.getAllPatientCandidates()) || ensureSelectedPatientSelection(ui.getAllPatientCandidates());
            accountStore.save(state.accounts, { skipRemoteSync: true });
            return 'restored';
        }

        if (state.accounts.length > 0) {
            state.accounts = state.accounts.map((account, index) => index === 0
                ? {
                    ...account,
                    email: account.email || profile?.email || '',
                    google_user_id: profile?.google_user_id || account.google_user_id || '',
                    google_display_name: profile?.display_name || account.google_display_name || '',
                    google_picture_url: profile?.picture_url || account.google_picture_url || ''
                }
                : account
            );
            state.selectedAccountId = state.selectedAccountId || state.accounts[0].id;
            restoreSelectedPatientSelection(ui.getAllPatientCandidates()) || ensureSelectedPatientSelection(ui.getAllPatientCandidates());
            accountStore.save(state.accounts);
            return 'linked-local';
        }

        const account = this.createGoogleAccount(profile);
        state.accounts = [account];
        selectPatientCandidate({ id: `${account.id}__self`, accountId: account.id });
        accountStore.save(state.accounts);
        return 'created';
    },

    buildAccountData(accounts = state.accounts) {
        return {
            accounts: accountStore.normalize(accounts),
            selectedAccountId: state.selectedAccountId || null,
            selectedPatientMemberId: state.selectedPatientMemberId || null,
            updatedAt: new Date().toISOString()
        };
    },

    scheduleAccountSync(accounts = state.accounts) {
        if (!this.isLoggedIn() || state.googleAuth.syncing) return;
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
            this.syncAccounts(accounts).catch(error => {
                console.error('Google account sync error:', error);
            });
        }, 500);
    },

    async syncAccounts(accounts = state.accounts) {
        if (!this.isLoggedIn()) return;
        state.googleAuth.syncing = true;
        try {
            const session = await api.saveGoogleAccount(
                state.googleAuth.token,
                this.buildAccountData(accounts)
            );
            this.saveProfile(session.profile);
            this.renderStatus();
        } finally {
            state.googleAuth.syncing = false;
        }
    },

    async refreshSession() {
        const token = this.loadToken();
        const cachedProfile = this.loadProfile();
        state.googleAuth.token = token || null;
        state.googleAuth.profile = cachedProfile;

        if (!token) {
            this.renderStatus();
            return;
        }

        try {
            const session = await api.fetchGoogleSession(token);
            this.saveProfile(session.profile);
            this.applyRemoteAccountData(session.account_data || {}, session.profile);
            this.renderStatus();
        } catch (error) {
            console.error('Google session refresh error:', error);
            this.logout({ silent: true });
        }
    },

    async login() {
        try {
            this.clearNotice();
            elements.googleLoginBtn?.setAttribute('disabled', 'true');
            const result = await api.startGoogleLogin();
            if (!result.enabled) {
                this.setNotice('Googleログイン設定が未接続です。通常予約はこのまま利用できます。', 'warning');
                return;
            }
            window.location.href = result.auth_url;
        } catch (error) {
            console.error('Google login start error:', error);
            const message = error.message || 'Googleログインを開始できませんでした';
            const isMissingConfig = message.includes('GOOGLE_OAUTH_CLIENT_ID') || message.includes('GOOGLE_OAUTH_CLIENT_SECRET');
            this.setNotice(
                isMissingConfig
                    ? 'Googleログイン設定が未接続です。通常予約はこのまま利用できます。'
                    : message,
                isMissingConfig ? 'warning' : 'error'
            );
        } finally {
            elements.googleLoginBtn?.removeAttribute('disabled');
        }
    },

    logout(options = {}) {
        this.saveToken('');
        this.saveProfile(null);
        clearTimeout(this.syncTimer);
        this.renderStatus();
        if (!options.silent) {
            alert('Googleログインを解除しました');
        }
    },

    renderStatus() {
        if (!elements.googleAuthPanel || !elements.googleAuthStatus) return;
        const profile = state.googleAuth.profile;
        const loggedIn = this.isLoggedIn();
        const notice = state.googleAuth.notice;
        const noticeType = state.googleAuth.noticeType || 'notice';
        elements.googleAuthPanel.classList.toggle('logged-in', loggedIn);
        elements.googleAuthStatus.innerHTML = loggedIn ? `
            ${profile?.picture_url ? `<img src="${utils.escapeHTML(profile.picture_url)}" alt="">` : '<span class="line-auth-avatar google-auth-avatar">G</span>'}
            <span>
                <strong>${utils.escapeHTML(profile?.display_name || profile?.email || 'Googleユーザー')}</strong>
                <small>${utils.escapeHTML(profile?.email || 'Googleでログイン中')}</small>
            </span>
        ` : `
            <span class="line-auth-avatar google-auth-avatar">G</span>
            <span>
                <strong>Googleでログイン</strong>
                <small class="${notice ? `line-auth-notice ${noticeType}` : ''}">
                    ${utils.escapeHTML(notice || 'Gmailへ予約通知を送れます')}
                </small>
            </span>
        `;
        elements.googleLoginBtn?.classList.toggle('hidden', loggedIn);
        elements.googleLogoutBtn?.classList.toggle('hidden', !loggedIn);
    }
};

// 予約データストレージ
const reservationStore = {
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.RESERVATIONS);
            const reservations = raw ? JSON.parse(raw) : [];
            return Array.isArray(reservations) ? reservations : [];
        } catch (error) {
            console.error('Reservation storage load error:', error);
            return [];
        }
    },

    save(reservations) {
        try {
            localStorage.setItem(STORAGE_KEYS.RESERVATIONS, JSON.stringify(reservations));
            return true;
        } catch (error) {
            console.error('Reservation storage save error:', error);
            return false;
        }
    },

    add(reservation) {
        const reservations = this.load();
        const index = reservations.findIndex(item => item.reservation_number === reservation.reservation_number);
        if (index !== -1) {
            reservations[index] = {
                ...reservations[index],
                ...reservation,
                updated_at: new Date().toISOString()
            };
            return this.save(reservations);
        }
        reservations.push({
            ...reservation,
            created_at: new Date().toISOString()
        });
        return this.save(reservations);
    },

    isLocalOnly(reservation) {
        return String(reservation?.reservation_number || '').startsWith('L');
    },

    findPatientOwnerForReservation(reservation) {
        const targetName = String(reservation?.patient_name || '').trim();
        const targetPhone = String(reservation?.patient_phone || '').replace(/\D/g, '');
        if (!targetName && !targetPhone) return null;

        for (const account of state.accounts || []) {
            const accountPhone = String(account.phone || '').replace(/\D/g, '');
            const phoneMatches = !targetPhone || !accountPhone || accountPhone === targetPhone;
            if (account.name === targetName && phoneMatches) {
                return { account, owner: account };
            }

            for (const member of account.members || []) {
                if (member.name === targetName && phoneMatches) {
                    return { account, owner: member };
                }
            }
        }

        if (targetPhone) {
            const account = (state.accounts || []).find(item =>
                String(item.phone || '').replace(/\D/g, '') === targetPhone
            );
            if (account) return { account, owner: account };
        }

        return null;
    },

    async ensureServerPatientForReservation(reservation) {
        if (isUuid(reservation?.patient_id)) return reservation;

        const matched = this.findPatientOwnerForReservation(reservation);
        const account = matched?.account || null;
        const owner = matched?.owner || null;
        const birthDate = owner?.birthdate || reservation.patient_birthdate || null;
        const patientName = owner?.name || reservation.patient_name || '';
        const patientPhone = account?.phone || owner?.phone || reservation.patient_phone || '';

        if (!patientName || !patientPhone || !birthDate) {
            return {
                ...reservation,
                patient_id: null
            };
        }

        const synced = await api.syncPatient({
            facility_id: CONFIG.FACILITY_ID,
            patient_id: isUuid(owner?.patient_id) ? owner.patient_id : null,
            name: patientName,
            name_kana: owner?.kana || reservation.patient_name_kana || patientName,
            phone: patientPhone,
            email: account?.email || owner?.email || reservation.patient_email || '',
            birth_date: birthDate,
            gender: owner?.gender || reservation.gender || 'other'
        });

        if (owner) {
            owner.patient_id = synced.id;
            owner.patient_no = synced.patient_no || owner.patient_no || '';
            accountStore.save(state.accounts);
        }

        return {
            ...reservation,
            patient_id: synced.id,
            patient_no: synced.patient_no || reservation.patient_no || '',
            patient_name: synced.name || patientName,
            patient_name_kana: synced.name_kana || owner?.kana || reservation.patient_name_kana || '',
            patient_phone: synced.phone1 || patientPhone,
            patient_email: synced.email || account?.email || owner?.email || reservation.patient_email || '',
            patient_birthdate: synced.birth_date || birthDate
        };
    },

    buildServerPayload(reservation) {
        return {
            slot_id: reservation.slot_id || reservation.id || `slot-${reservation.reservation_date}-${reservation.start_time}`,
            facility_id: CONFIG.FACILITY_ID,
            clinic_id: reservation.clinic_id || null,
            clinic_name: reservation.clinic_name || null,
            department_id: reservation.department_id || null,
            department_name: reservation.department_name || '',
            reservation_date: reservation.reservation_date,
            start_time: reservation.start_time,
            end_time: reservation.end_time,
            max_bookings: Number(reservation.max_bookings || reservation.slot_capacity || 1),
            treatment_menu: reservation.treatment_menu || null,
            treatment_menu_label: reservation.treatment_menu_label || null,
            treatment_resource_type: reservation.treatment_resource_type || null,
            treatment_menu_capacity: Number(reservation.treatment_menu_capacity || 1),
            treatment_detail_menu: reservation.treatment_detail_menu || null,
            treatment_detail_menu_label: reservation.treatment_detail_menu_label || null,
            treatment_detail_price: reservation.treatment_detail_price || null,
            treatment_display_label: reservation.treatment_display_label || null,
            patient_id: isUuid(reservation.patient_id) ? reservation.patient_id : null,
            patient_name: reservation.patient_name || '',
            patient_name_kana: reservation.patient_name_kana || null,
            patient_phone: reservation.patient_phone || '',
            patient_email: reservation.patient_email || null,
            patient_birthdate: reservation.patient_birthdate || null,
            symptoms: reservation.symptoms || '',
            suppress_notifications: true
        };
    },

    async createServerReservationFromLocal(reservation) {
        if (!this.isLocalOnly(reservation)) return reservation;
        const readyReservation = await this.ensureServerPatientForReservation(reservation);
        if (!readyReservation.patient_name || !readyReservation.patient_phone) return readyReservation;
        if (!readyReservation.reservation_date || !readyReservation.start_time || !readyReservation.end_time) return readyReservation;

        const response = await fetch(`${CONFIG.API_BASE}/reservations/public/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildServerPayload(readyReservation))
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(getApiErrorMessage(error, 'ローカル予約をサーバーへ同期できませんでした'));
        }
        const result = await response.json();
        return {
            ...readyReservation,
            id: result.id,
            reservation_number: result.reservation_number,
            migrated_from_reservation_number: reservation.reservation_number,
            department_name: result.department_name || readyReservation.department_name || '',
            treatment_menu: result.treatment_menu || readyReservation.treatment_menu || null,
            treatment_menu_label: result.treatment_menu_label || readyReservation.treatment_menu_label || '',
            treatment_resource_type: result.treatment_resource_type || readyReservation.treatment_resource_type || '',
            treatment_detail_menu: result.treatment_detail_menu || readyReservation.treatment_detail_menu || null,
            treatment_detail_menu_label: result.treatment_detail_menu_label || readyReservation.treatment_detail_menu_label || '',
            treatment_detail_price: result.treatment_detail_price || readyReservation.treatment_detail_price || '',
            treatment_display_label: result.treatment_display_label || readyReservation.treatment_display_label || '',
            reservation_date: result.reservation_date || readyReservation.reservation_date,
            start_time: result.start_time || readyReservation.start_time,
            end_time: result.end_time || readyReservation.end_time,
            patient_name: result.patient_name || readyReservation.patient_name,
            patient_id: result.patient_id || readyReservation.patient_id || null,
            patient_no: result.patient_no || readyReservation.patient_no || '',
            status: result.status || readyReservation.status || 'confirmed',
            created_at: result.created_at || readyReservation.created_at || new Date().toISOString()
        };
    },

    async syncLocalOnlyToServer() {
        const reservations = this.load();
        if (!reservations.some(reservation => this.isLocalOnly(reservation))) return false;

        const syncedReservations = [];
        let changed = false;
        for (const reservation of reservations) {
            if (!this.isLocalOnly(reservation)) {
                syncedReservations.push(reservation);
                continue;
            }
            try {
                const synced = await this.createServerReservationFromLocal(reservation);
                syncedReservations.push(synced);
                changed = changed || synced.reservation_number !== reservation.reservation_number;
            } catch (error) {
                console.warn(`Local reservation ${reservation.reservation_number} sync skipped:`, error);
                syncedReservations.push(reservation);
            }
        }

        if (changed) {
            this.save(syncedReservations);
        }
        return changed;
    },

    remove(reservationNumber) {
        const reservations = this.load();
        const filtered = reservations.filter(r => r.reservation_number !== reservationNumber);
        return this.save(filtered);
    },

    matchesPatient(reservation, patient = null) {
        if (Array.isArray(patient)) {
            return patient.length === 0 || patient.some(candidate => this.matchesPatient(reservation, candidate));
        }
        if (!patient) return true;

        const reservationPatientId = String(reservation?.patient_id || '');
        if (patient.patient_id && reservationPatientId && reservationPatientId === String(patient.patient_id)) {
            return true;
        }

        const reservationPatientNo = String(reservation?.patient_no || '').trim();
        const patientNo = String(patient?.patient_no || '').trim();
        if (patientNo && reservationPatientNo && patientNo === reservationPatientNo) {
            return true;
        }

        const reservationName = String(reservation?.patient_name || '').trim();
        const patientName = String(patient?.name || '').trim();
        const reservationPhone = utils.phoneDigits(reservation?.patient_phone);
        const patientPhone = utils.phoneDigits(patient?.phone);
        if (patientPhone && reservationPhone && patientPhone === reservationPhone) {
            return true;
        }
        const nameMatches = Boolean(patientName && reservationName === patientName);
        const phoneMatches = !patientPhone || !reservationPhone || patientPhone === reservationPhone;
        return nameMatches && phoneMatches;
    },

    getUpcoming(patient = null) {
        const reservations = this.load();
        const today = utils.formatDate(new Date());
        return reservations.filter(r => {
            const reservationDate = String(r.reservation_date || '').slice(0, 10);
            return reservationDate >= today
                && !['cancelled', 'completed', 'no_show'].includes(r.status)
                && this.matchesPatient(r, patient);
        }).sort((a, b) => {
            const dateA = new Date(`${a.reservation_date}T${a.start_time || '00:00'}`);
            const dateB = new Date(`${b.reservation_date}T${b.start_time || '00:00'}`);
            return dateA - dateB;
        });
    },

    mergeServerReservation(localReservation = {}, serverReservation = {}) {
        const questionnaireCompleted = Boolean(
            localReservation.questionnaire_completed ||
            serverReservation.questionnaire_response_id ||
            serverReservation.questionnaire_status === 'completed' ||
            serverReservation.questionnaire_completed_at
        );
        const insuranceUploaded = Boolean(
            localReservation.insurance_uploaded ||
            serverReservation.insurance_card_id ||
            serverReservation.insurance_card_status
        );
        const medicalCertificateUploaded = Boolean(
            localReservation.medical_certificate_uploaded ||
            serverReservation.medical_certificate_id ||
            serverReservation.medical_certificate_status
        );

        return {
            ...localReservation,
            id: serverReservation.id || localReservation.id || null,
            department_id: serverReservation.department_id || localReservation.department_id || null,
            department_name: serverReservation.department_name || localReservation.department_name || '',
            treatment_menu: serverReservation.treatment_menu || localReservation.treatment_menu || null,
            treatment_menu_label: serverReservation.treatment_menu_label || localReservation.treatment_menu_label || '',
            treatment_detail_menu: serverReservation.treatment_detail_menu || localReservation.treatment_detail_menu || null,
            treatment_detail_menu_label: serverReservation.treatment_detail_menu_label || localReservation.treatment_detail_menu_label || '',
            treatment_detail_price: serverReservation.treatment_detail_price || localReservation.treatment_detail_price || '',
            treatment_display_label: serverReservation.treatment_display_label || localReservation.treatment_display_label || '',
            treatment_resource_type: serverReservation.treatment_resource_type || localReservation.treatment_resource_type || '',
            reservation_date: serverReservation.reservation_date || localReservation.reservation_date || '',
            start_time: serverReservation.start_time || localReservation.start_time || '',
            end_time: serverReservation.end_time || localReservation.end_time || '',
            patient_id: serverReservation.patient_id || localReservation.patient_id || null,
            patient_no: serverReservation.patient_no || localReservation.patient_no || '',
            patient_name: serverReservation.patient_name || localReservation.patient_name || '',
            patient_phone: serverReservation.patient_phone || localReservation.patient_phone || '',
            status: serverReservation.status || localReservation.status || 'confirmed',
            questionnaire_completed: questionnaireCompleted,
            questionnaire_response_id: serverReservation.questionnaire_response_id || localReservation.questionnaire_response_id || null,
            insurance_uploaded: insuranceUploaded,
            insurance_card_id: serverReservation.insurance_card_id || localReservation.insurance_card_id || null,
            medical_certificate_uploaded: medicalCertificateUploaded,
            medical_certificate_id: serverReservation.medical_certificate_id || localReservation.medical_certificate_id || null
        };
    },

    upsertServerReservations(serverReservations = []) {
        if (!Array.isArray(serverReservations) || serverReservations.length === 0) return false;

        const reservations = this.load();
        let changed = false;
        serverReservations.forEach(serverReservation => {
            const reservationNumber = serverReservation?.reservation_number;
            if (!reservationNumber) return;
            const index = reservations.findIndex(item => item.reservation_number === reservationNumber);
            if (index === -1) {
                reservations.push(this.mergeServerReservation({}, serverReservation));
                changed = true;
                return;
            }
            const merged = this.mergeServerReservation(reservations[index], serverReservation);
            if (JSON.stringify(merged) !== JSON.stringify(reservations[index])) {
                reservations[index] = merged;
                changed = true;
            }
        });

        if (changed) {
            this.save(reservations);
        }
        return changed;
    },

    updateReservation(reservationNumber, updates) {
        const reservations = this.load();
        const index = reservations.findIndex(r => r.reservation_number === reservationNumber);
        if (index === -1) return null;

        reservations[index] = {
            ...reservations[index],
            ...updates
        };
        this.save(reservations);
        return reservations[index];
    },

    // サーバーと同期してキャンセル済み予約をローカルから削除
    async syncWithServer() {
        const reservations = this.load();
        if (reservations.length === 0) return false;

        const validReservations = [];
        for (const reservation of reservations) {
            if (this.isLocalOnly(reservation)) {
                try {
                    validReservations.push(await this.createServerReservationFromLocal(reservation));
                } catch (error) {
                    console.warn(`Local reservation ${reservation.reservation_number} sync skipped:`, error);
                    validReservations.push(reservation);
                }
                continue;
            }
            try {
                if (!reservation.patient_phone) {
                    validReservations.push(reservation);
                    continue;
                }
                const result = await api.checkReservation(
                    reservation.reservation_number,
                    reservation.patient_phone
                );
                // 予約が有効な場合のみ保持
                if (result && result.status !== 'cancelled') {
                    validReservations.push(this.mergeServerReservation(reservation, result));
                }
            } catch (error) {
                // 通信・電話番号形式差分などで確認できないだけなら、患者画面から消さない
                console.warn(`Reservation ${reservation.reservation_number} could not be verified, keeping local copy`);
                validReservations.push(reservation);
            }
        }

        // 変更があった場合のみ保存
        if (JSON.stringify(validReservations) !== JSON.stringify(reservations)) {
            this.save(validReservations);
            return true; // 変更あり
        }
        return false; // 変更なし
    },

    getByNumber(reservationNumber) {
        const reservations = this.load();
        return reservations.find(r => r.reservation_number === reservationNumber) || null;
    },

    updateQuestionnaireStatus(reservationNumber, completed, responseId = null) {
        return Boolean(this.updateReservation(reservationNumber, {
            questionnaire_completed: completed,
            questionnaire_response_id: responseId
        }));
    },

    updateInsuranceStatus(reservationNumber, uploaded, insuranceCardId = null) {
        return Boolean(this.updateReservation(reservationNumber, {
            insurance_uploaded: uploaded,
            insurance_card_id: insuranceCardId
        }));
    }
};

const legacyStorageBridge = {
    requestType: 'digimaster-reservation-storage-export',
    importOrigins: [
        'http://localhost:8100/reservation-app/index.html'
    ],

    isBridgeRequest() {
        return new URLSearchParams(window.location.search).get('storage_bridge') === '1';
    },

    exportToParent() {
        if (!window.parent || window.parent === window) return;
        const payload = {
            type: this.requestType,
            accounts: accountStore.load(),
            reservations: reservationStore.load(),
            selectedPatient: localStorage.getItem(STORAGE_KEYS.PATIENT_SELECTION) || ''
        };
        window.parent.postMessage(payload, '*');
        document.body.innerHTML = '';
    },

    accountKey(account) {
        const patientId = String(account?.patient_id || '').trim();
        if (patientId) return `id:${patientId}`;
        const patientNo = String(account?.patient_no || '').trim();
        if (patientNo) return `no:${patientNo}`;
        return [
            String(account?.name || '').trim(),
            utils.phoneDigits(account?.phone),
            String(account?.birthdate || '').trim()
        ].join('|');
    },

    mergeAccounts(importedAccounts = []) {
        if (!Array.isArray(importedAccounts) || importedAccounts.length === 0) return false;
        const merged = accountStore.load();
        const indexByKey = new Map();
        merged.forEach((account, index) => {
            const key = this.accountKey(account);
            if (key) indexByKey.set(key, index);
        });

        let changed = false;
        importedAccounts.forEach(importedAccount => {
            const key = this.accountKey(importedAccount);
            if (!key) return;
            const index = indexByKey.get(key);
            if (index === undefined) {
                merged.push(importedAccount);
                indexByKey.set(key, merged.length - 1);
                changed = true;
                return;
            }

            const current = merged[index];
            merged[index] = {
                ...importedAccount,
                ...current,
                patient_id: current.patient_id || importedAccount.patient_id || null,
                patient_no: current.patient_no || importedAccount.patient_no || '',
                phone: current.phone || importedAccount.phone || '',
                email: current.email || importedAccount.email || '',
                birthdate: current.birthdate || importedAccount.birthdate || '',
                documents: { ...(importedAccount.documents || {}), ...(current.documents || {}) },
                members: accountStore.normalize([{ members: [
                    ...(importedAccount.members || []),
                    ...(current.members || [])
                ] }])[0].members
            };
            changed = true;
        });

        if (changed) accountStore.save(merged);
        return changed;
    },

    mergeReservations(importedReservations = []) {
        if (!Array.isArray(importedReservations) || importedReservations.length === 0) return false;
        const reservations = reservationStore.load();
        let changed = false;
        importedReservations.forEach(importedReservation => {
            const number = importedReservation?.reservation_number;
            if (!number) return;
            const index = reservations.findIndex(item => item.reservation_number === number);
            if (index === -1) {
                reservations.push(importedReservation);
                changed = true;
            } else {
                reservations[index] = reservationStore.mergeServerReservation(reservations[index], importedReservation);
                changed = true;
            }
        });
        if (changed) reservationStore.save(reservations);
        return changed;
    },

    importFromLegacyOrigins() {
        if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
            return Promise.resolve(false);
        }

        const currentUrl = `${window.location.origin}${window.location.pathname}`;
        const targets = this.importOrigins.filter(url => !currentUrl.startsWith(url.replace(/\/index\.html$/, '')));
        if (targets.length === 0) return Promise.resolve(false);

        return new Promise(resolve => {
            let changed = false;
            let remaining = targets.length;
            const frames = [];

            const cleanup = () => {
                window.removeEventListener('message', onMessage);
                frames.forEach(frame => frame.remove());
                resolve(changed);
            };

            const finishOne = () => {
                remaining -= 1;
                if (remaining <= 0) cleanup();
            };

            const timer = window.setTimeout(cleanup, 1600);
            const onMessage = event => {
                const data = event.data || {};
                if (data.type !== this.requestType) return;
                changed = this.mergeAccounts(data.accounts) || changed;
                changed = this.mergeReservations(data.reservations) || changed;
                if (data.selectedPatient && !localStorage.getItem(STORAGE_KEYS.PATIENT_SELECTION)) {
                    localStorage.setItem(STORAGE_KEYS.PATIENT_SELECTION, data.selectedPatient);
                }
                window.clearTimeout(timer);
                finishOne();
            };

            window.addEventListener('message', onMessage);
            targets.forEach(url => {
                const frame = document.createElement('iframe');
                frame.src = `${url}?storage_bridge=1&v=patient-account-origin-20260727-1`;
                frame.style.display = 'none';
                frame.addEventListener('error', finishOne, { once: true });
                document.body.appendChild(frame);
                frames.push(frame);
            });
        });
    }
};

// UI更新
const ui = {
    showStep(stepNumber) {
        state.currentStep = stepNumber;

        // step0（クリニック選択）の場合はステップインジケーターを非表示
        const stepsElement = document.getElementById('reservationSteps');
        if (stepsElement) {
            stepsElement.classList.toggle('hidden', stepNumber === 0);
        }

        // step0以外の場合のみステップインジケーター更新
        if (stepNumber > 0) {
            const topLevelStep = Math.min(Math.max(stepNumber, 1), 4);
            elements.steps.forEach((step) => {
                const stepValue = Number(step.dataset.step);
                step.classList.remove('active', 'completed');
                step.removeAttribute('aria-current');
                if (stepValue < topLevelStep) {
                    step.classList.add('completed');
                } else if (stepValue === topLevelStep) {
                    step.classList.add('active');
                    step.setAttribute('aria-current', 'step');
                }
            });
            elements.serviceFlowItems.forEach(item => {
                item.classList.toggle('active', Number(item.dataset.topStep) === topLevelStep);
            });
        }

        // セクション表示切替
        Object.values(elements.sections).forEach(section => {
            section?.classList.add('hidden');
        });

        const sectionKey = stepNumber === 5 ? 'complete' : `step${stepNumber}`;
        elements.sections[sectionKey]?.classList.remove('hidden');
    },

    // クリニック一覧読み込み
    loadClinics() {
        const raw = localStorage.getItem(CLINIC_STORAGE_KEY);
        state.clinics = raw ? JSON.parse(raw) : [];

        // クリニックがない場合はサンプルデータを初期化
        if (state.clinics.length === 0) {
            this.initializeSampleClinics();
        }
        normalizeClinicStore();
        ensureRequestedClinicDefaults();

        return state.clinics;
    },

    // サンプルクリニックと診療科の初期化
    initializeSampleClinics() {
        const DEPARTMENT_GROUP_STORAGE_KEY = 'digimaster.departmentGroups.v1';
        const CALENDAR_STORAGE_KEY = 'digimaster.reservationCalendars.v1';

        const sampleClinics = [
            { name: '西春内科・在宅クリニック', departments: ['内科', '在宅', '夜間休日外来', '美容施術'] }
        ];

        // 今日の日付
        const today = new Date();
        const effectiveFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        sampleClinics.forEach((clinicDef, index) => {
            const clinic = {
                id: createClinicStorageId(clinicDef.name),
                name: clinicDef.name,
                createdAt: new Date().toISOString()
            };
            state.clinics.push(clinic);

            // 診療科を作成
            const departments = clinicDef.departments.map((deptName, deptIndex) => ({
                id: `dept-${Date.now()}-${index}-${deptIndex}-${Math.random().toString(36).substr(2, 9)}`,
                name: deptName,
                description: '',
                min_advance_hours: 1
            }));

            // 診療科グループを作成
            const departmentGroups = [{
                id: `group-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                name: '診療科',
                departments: departments
            }];

            // クリニック固有のストレージキーで診療科を保存
            const deptKey = `${DEPARTMENT_GROUP_STORAGE_KEY}.${clinic.id}`;
            localStorage.setItem(deptKey, JSON.stringify(departmentGroups));

            // 各診療科に対応する予約カレンダーを作成
            const calendars = departments.map(dept => ({
                id: `cal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: dept.name,
                departments: [{
                    id: dept.id,
                    name: dept.name,
                    real: false
                }],
                queueEnabled: false,
                closeOffsetMinutes: 60,
                periods: [{
                    id: `period-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    effective_from: effectiveFrom,
                    effective_until: null,
                    rows: dept.name === '夜間休日外来' ? [{
                        id: `row-night-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '18:00',
                        end_time: '22:00',
                        days: [true, true, true, true, true, false, false, false], // 平日夜間
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }, {
                        id: `row-holiday-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '09:00',
                        end_time: '17:00',
                        days: [false, false, false, false, false, true, true, true], // 土日祝
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }] : clinic.name?.includes('千葉') ? [{
                        id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '09:00',
                        end_time: '12:00',
                        days: [true, true, true, true, true, true, false, false], // 月〜土
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }, {
                        id: `row2-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '13:30',
                        end_time: '18:00',
                        days: [true, true, true, true, true, true, false, false], // 月〜土
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }] : [{
                        id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '09:00',
                        end_time: '12:00',
                        days: [true, true, true, true, true, false, false, false], // 月〜金
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }, {
                        id: `row2-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        start_time: '14:00',
                        end_time: '17:00',
                        days: [true, true, true, true, true, false, false, false], // 月〜金
                        slotDuration: 15,
                        slotCapacity: 1,
                        firstSlotDuration: 15,
                        returnSlotDuration: 15,
                        doctorCount: 1
                    }]
                }],
                temporarySettings: [],
                staff: [],
                isActive: true
            }));

            // クリニック固有のストレージキーでカレンダーを保存
            const calKey = `${CALENDAR_STORAGE_KEY}.${clinic.id}`;
            localStorage.setItem(calKey, JSON.stringify(calendars));

            const beautyDepartment = departments.find(dept => dept.name.includes('美容'));
            if (beautyDepartment) {
                const menus = DEFAULT_TREATMENT_MENUS.map((menu, menuIndex) => ({
                    local_id: `menu-${Date.now()}-${index}-${menuIndex}-${Math.random().toString(36).substr(2, 9)}`,
                        code: menu.code,
                        label: menu.label,
                        department_id: beautyDepartment.id,
                        resource_type: menu.resourceType,
                        resource_types: [menu.resourceType],
                        menu_capacity: 1,
                        duration_minutes: menu.duration_minutes || null,
                        set_duration_minutes: menu.set_duration_minutes || menu.duration_minutes || null,
                        room_codes: menu.room_codes || [],
                        equipment_requirements: menu.equipment_requirements || [],
                        equipment_code: menu.equipment_code || '',
                        equipment_label: menu.equipment_label || '',
                        uses_equipment: menu.uses_equipment !== false,
                        display_order: (menuIndex + 1) * 10,
                        is_active: true
                    }));
                localStorage.setItem(`${TREATMENT_MENU_STORAGE_KEY}.${clinic.id}`, JSON.stringify(menus));
            }
        });

        // クリニック一覧を保存
        localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(state.clinics));
        console.log('サンプルクリニックを初期化しました');
    },

    // クリニック一覧描画
    renderClinics() {
        const clinicListEl = elements.clinicList;
        const clinicEmptyEl = document.getElementById('clinicEmpty');

        if (!clinicListEl) return;

        if (state.clinics.length === 0) {
            clinicListEl.innerHTML = '';
            clinicListEl.classList.add('hidden');
            clinicEmptyEl?.classList.remove('hidden');
            return;
        }

        clinicEmptyEl?.classList.add('hidden');
        clinicListEl.classList.remove('hidden');

        clinicListEl.innerHTML = state.clinics.map(clinic => `
            <button class="clinic-card" type="button" data-id="${utils.escapeHTML(clinic.id)}">
                <span class="clinic-card-icon"><i class="fas fa-hospital"></i></span>
                <span class="clinic-card-content">
                    <span class="clinic-card-name">${utils.escapeHTML(clinic.name)}</span>
                </span>
                <span class="clinic-card-arrow"><i class="fas fa-chevron-right"></i></span>
            </button>
        `).join('');

        // イベント設定
        clinicListEl.querySelectorAll('.clinic-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectClinic(card.dataset.id);
            });
        });
    },

    // クリニック選択
    async selectClinic(clinicId) {
        const normalizedClinicId = normalizeClinicId(clinicId);
        const clinic = state.clinics.find(c => c.id === normalizedClinicId);
        if (!clinic) return;

        state.currentClinicId = normalizedClinicId;
        localStorage.setItem(CURRENT_CLINIC_KEY, normalizedClinicId);
        state.selectedDepartment = null;
        state.selectedTreatmentMenu = null;
        state.selectedTreatmentOption = null;
        state.selectedDate = null;
        state.selectedSlot = null;
        this.clearSameDayAddOns();

        // クリニック名バッジを更新
        if (elements.clinicName) {
            elements.clinicName.textContent = clinic.name;
        }

        // 診療科を読み込み直す（クリニック別のデータを使用）
        try {
            state.departments = await api.fetchDepartments();
            this.renderDepartments();
        } catch (error) {
            console.error('Departments load error:', error);
            if (elements.departmentList) {
                elements.departmentList.innerHTML = '<div class="account-empty">診療科を取得できませんでした。</div>';
            }
        }

        this.showStep(1);
    },

    renderDepartments() {
        elements.departmentList.innerHTML = state.departments.map(dept => `
            <button class="department-card" type="button" data-id="${utils.escapeHTML(dept.id)}">
                <span class="department-name">${utils.escapeHTML(dept.name)}</span>
            </button>
        `).join('');

        // イベント設定
        elements.departmentList.querySelectorAll('.department-card').forEach(card => {
            card.addEventListener('click', async () => {
                await this.selectDepartment(card.dataset.id, true);
            });
        });
    },

    async selectDepartment(id, advance = false) {
        const department = state.departments.find(d => String(d.id) === String(id));
        if (!department) return;

        state.selectedDepartment = department;
        state.selectedTreatmentMenu = null;
        state.selectedTreatmentOption = null;
        state.selectedTreatmentConcern = 'all';
        state.selectedDate = null;
        state.selectedSlot = null;
        this.clearSameDayAddOns();
        // 予約受付終了時間を設定（min_advance_hoursは時間単位なので分に変換）
        state.closeOffset = (department.min_advance_hours || 1) * 60;

        elements.departmentList.querySelectorAll('.department-card').forEach(card => {
            card.classList.toggle('active', String(card.dataset.id) === String(id));
        });

        if (advance) {
            this.showStep(2);
        }
        await this.loadTreatmentMenusForDepartment(department.id);
        await this.loadCalendar();
    },

    async loadTreatmentMenusForDepartment(departmentId) {
        try {
            const menus = await api.fetchTreatmentMenus(departmentId);
            state.treatmentMenus = Array.isArray(menus) ? menus.map(menu => utils.enrichTreatmentMenu(menu)) : [];
        } catch (error) {
            console.error('Treatment menus load error:', error);
            state.treatmentMenus = [];
        }
    },

    setTimeSelectionVisible(visible) {
        elements.calendarNav?.classList.toggle('hidden', !visible);
        elements.calendarTableWrap?.classList.toggle('hidden', !visible);
        elements.timeSlots?.classList.toggle('hidden', !visible);
    },

    scrollToTimeSelection() {
        const target = elements.calendarNav || elements.calendarTableWrap || elements.calendar;
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    scrollToTreatmentDetailSelection() {
        const target = elements.treatmentDetailPanel || elements.treatmentMenuPanel;
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    renderTreatmentConcernTabs() {
        if (!elements.treatmentConcernTabs) return;

        elements.treatmentConcernTabs.innerHTML = TREATMENT_CONCERN_TABS.map(tab => `
            <button
                type="button"
                class="treatment-concern-tab ${state.selectedTreatmentConcern === tab.id ? 'active' : ''}"
                data-concern-id="${utils.escapeHTML(tab.id)}"
                aria-pressed="${state.selectedTreatmentConcern === tab.id ? 'true' : 'false'}"
            >
                ${utils.escapeHTML(tab.label)}
            </button>
        `).join('');

        elements.treatmentConcernTabs.querySelectorAll('.treatment-concern-tab').forEach(tabButton => {
            tabButton.addEventListener('click', async () => {
                const nextConcern = tabButton.dataset.concernId || 'all';
                if (state.selectedTreatmentConcern === nextConcern) return;
                state.selectedTreatmentConcern = nextConcern;
                state.selectedTreatmentMenu = null;
                state.selectedTreatmentOption = null;
                state.selectedDate = null;
                state.selectedSlot = null;
                this.clearSameDayAddOns();
                await this.loadCalendar();
            });
        });
    },

    getFilteredTreatmentMenus() {
        const activeTab = TREATMENT_CONCERN_TABS.find(tab => tab.id === state.selectedTreatmentConcern) || TREATMENT_CONCERN_TABS[0];
        return state.treatmentMenus.filter(menu => utils.matchesTreatmentConcern(menu, activeTab));
    },

    getTreatmentRecommendations(menu) {
        const codes = normalizeTreatmentRecommendationCodes(menu?.recommendedMenuCodes || menu?.recommended_menu_codes);
        if (!codes.length) return [];
        const selectedCode = menu?.code;
        const byCode = new Map(state.treatmentMenus.map(item => [item.code, item]));
        return codes
            .map(code => byCode.get(code))
            .filter(item => item && item.code !== selectedCode && item.is_active !== false);
    },

    getTreatmentDetailOptions(menu) {
        if (!menu) return [];
        return normalizeTreatmentDetailMenus(
            menu.detailMenus || menu.detail_menus || getTreatmentDetailMenuData(menu),
            menu,
            { useDefaults: false }
        ).filter(option => option.customer_visible !== false && option.customerVisible !== false);
    },

    selectedPrimaryTreatmentDisplayLabel() {
        const main = state.selectedTreatmentMenu?.label || '';
        const detail = state.selectedTreatmentOption?.label || '';
        return [main, detail].filter(Boolean).join(' / ');
    },

    selectedSameDayAddOns() {
        return Array.isArray(state.selectedSameDayAddOns) ? state.selectedSameDayAddOns : [];
    },

    sameDayAddOnDisplayLabel(addOn = {}) {
        const main = addOn.menu?.label || addOn.menuLabel || '';
        const detail = addOn.option?.label || addOn.optionLabel || '';
        return [main, detail].filter(Boolean).join(' / ');
    },

    selectedTreatmentDisplayLabel() {
        const primary = this.selectedPrimaryTreatmentDisplayLabel();
        const addOnLabels = this.selectedSameDayAddOns()
            .map(addOn => this.sameDayAddOnDisplayLabel(addOn))
            .filter(Boolean)
            .map(label => `追加: ${label}`);
        return [primary, ...addOnLabels].filter(Boolean).join(' / ');
    },

    selectedPrimaryTreatmentPriceLabel() {
        if (state.selectedTreatmentOption) {
            return formatTreatmentDetailPriceLabel(
                state.selectedTreatmentOption.price,
                state.selectedTreatmentOption.lowest_price || state.selectedTreatmentOption.lowestPrice
            );
        }
        return state.selectedTreatmentMenu?.price || '';
    },

    normalizeSameDayAddOnPriceLabel(value = '') {
        const price = String(value || '')
            .trim()
            .replace(/^追加料金[:：]\s*/, '')
            .replace(/^[+＋]\s*/, '')
            .replace(/￥/g, '¥');
        if (!price) return '';
        const compact = price.replace(/\s+/g, '');
        if (/^(無料|0|0円|¥0|¥0円)$/i.test(compact)) return '無料';
        return price;
    },

    extractSameDayAddOnSetPrice(value = '') {
        const text = String(value || '').trim();
        if (!/(セット|同時|追加|併用)/.test(text)) return '';
        if (text.includes('無料')) return '無料';
        const match = text.match(/[+＋]?\s*[¥￥]?\s*[0-9,]+(?:円)?/);
        if (!match) return '';
        const price = match[0].replace(/\s+/g, '').replace(/^[+＋]/, '');
        if (!price) return '';
        return this.normalizeSameDayAddOnPriceLabel(/[¥￥]|円/.test(price) ? price : `${price}円`);
    },

    sameDayAddOnPriceLabel(menu, option = null) {
        const setPrice = this.extractSameDayAddOnSetPrice(option?.priceSub || option?.price_sub || '');
        if (setPrice) return setPrice;
        if (option) {
            const optionPrice = formatTreatmentDetailPriceLabel(option.price, option.lowest_price || option.lowestPrice);
            if (optionPrice) return this.normalizeSameDayAddOnPriceLabel(optionPrice);
        }
        return this.normalizeSameDayAddOnPriceLabel(menu?.price || '');
    },

    selectedTreatmentPriceLabel() {
        const addOnPrices = this.selectedSameDayAddOns()
            .map(addOn => addOn.priceLabel || this.sameDayAddOnPriceLabel(addOn.menu, addOn.option))
            .filter(Boolean);
        return [this.selectedPrimaryTreatmentPriceLabel(), ...addOnPrices]
            .filter(Boolean)
            .join(' + ');
    },

    treatmentEquipmentBookingsFor(menu, detail = null, sourcePrefix = '') {
        if (!menu) return [];
        if (!treatmentMenuUsesEquipment(menu, menu.code || '')) return [];
        const hasDetail = Boolean(detail);
        const bookings = [];
        const addBooking = (source, item, duration) => {
            const durationMinutes = utils.parseDurationMinutes(duration);
            const resourceCode = inferTreatmentEquipmentCode(item, item?.code || item?.id || '');
            if (!resourceCode || !durationMinutes) return;
            const resourceLabel = inferTreatmentEquipmentLabel(item, item?.label || item?.name || resourceCode);
            const existing = bookings.find(row => row.resource_code === resourceCode);
            const next = {
                resource_code: resourceCode,
                resource_label: resourceLabel,
                duration_minutes: durationMinutes,
                source: sourcePrefix ? `${sourcePrefix}_${source}`.slice(0, 20) : source
            };
            if (!existing) {
                bookings.push(next);
            } else if (durationMinutes > Number(existing.duration_minutes || 0)) {
                Object.assign(existing, next);
            }
        };

        const mainResourceCode = inferTreatmentEquipmentCode(menu, menu.code || '');
        const detailResourceCode = detail ? inferTreatmentEquipmentCode(detail, detail.code || detail.id || '') : '';
        const hasSetDetail = Boolean(hasDetail && detailResourceCode && mainResourceCode && detailResourceCode !== mainResourceCode);
        const mainRequirements = normalizeTreatmentEquipmentRequirements(
            menu.equipment_requirements || menu.equipmentRequirements,
            menu
        );
        if (mainRequirements.length) {
            mainRequirements.forEach(requirement => {
                const requirementDuration = hasSetDetail && requirement.resource_code === mainResourceCode
                    ? (menu.set_duration_minutes ?? menu.setDurationMinutes ?? requirement.duration_minutes)
                    : requirement.duration_minutes;
                addBooking(requirement.source || 'main', requirement, requirementDuration);
            });
        } else {
            const mainDuration = hasSetDetail
                ? (menu.set_duration_minutes ?? menu.setDurationMinutes ?? menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel)
                : (menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel);
            addBooking('main', menu, mainDuration);
        }

        if (detail) {
            addBooking(
                'set',
                detail,
                detail.set_duration_minutes ??
                    detail.setDurationMinutes ??
                    detail.duration_minutes ??
                    detail.durationMinutes ??
                    detail.duration ??
                    detail.durationLabel
            );
        }

        return bookings;
    },

    selectedPrimaryTreatmentEquipmentBookings() {
        return this.treatmentEquipmentBookingsFor(state.selectedTreatmentMenu, state.selectedTreatmentOption);
    },

    selectedTreatmentEquipmentBookings() {
        return this.selectedPrimaryTreatmentEquipmentBookings();
    },

    sameDayAddOnEquipmentBookings(menu, option = null) {
        const durationMinutes = this.treatmentDurationMinutesFor(menu, option, { preferSameDayAddOn: true });
        return this.treatmentEquipmentBookingsFor(menu, option, 'same_day')
            .map(item => ({
                ...item,
                duration_minutes: durationMinutes || item.duration_minutes,
                source: 'same_day'
            }));
    },

    treatmentDurationMinutesFor(menu, option = null, options = {}) {
        if (!menu) return 0;
        if (options.preferSameDayAddOn) {
            const addOnDuration = utils.parseDurationMinutes(
                option?.set_duration_minutes ??
                option?.setDurationMinutes ??
                option?.duration_minutes ??
                option?.durationMinutes ??
                option?.duration ??
                option?.durationLabel ??
                menu?.set_duration_minutes ??
                menu?.setDurationMinutes ??
                menu?.duration_minutes ??
                menu?.durationMinutes ??
                menu?.duration ??
                menu?.durationLabel
            );
            if (addOnDuration) return addOnDuration;
        }

        const equipmentDuration = Math.max(
            0,
            ...this.treatmentEquipmentBookingsFor(menu, option).map(item => Number(item.duration_minutes || 0))
        );
        if (equipmentDuration > 0) return equipmentDuration;
        return utils.parseDurationMinutes(
            option?.duration_minutes ??
            option?.durationMinutes ??
            option?.duration ??
            option?.durationLabel ??
            menu?.duration_minutes ??
            menu?.durationMinutes ??
            menu?.duration ??
            menu?.durationLabel
        ) || 0;
    },

    selectedPrimaryTreatmentDurationMinutes() {
        return this.treatmentDurationMinutesFor(state.selectedTreatmentMenu, state.selectedTreatmentOption);
    },

    selectedSameDayAddOnDurationMinutes() {
        return this.selectedSameDayAddOns()
            .reduce((total, addOn) => total + Number(
                addOn.durationMinutes ||
                this.treatmentDurationMinutesFor(addOn.menu, addOn.option, { preferSameDayAddOn: true }) ||
                0
            ), 0);
    },

    selectedTreatmentDurationMinutes() {
        return this.selectedPrimaryTreatmentDurationMinutes() + this.selectedSameDayAddOnDurationMinutes();
    },

    baseSelectedSlotEndTime(slot = state.selectedSlot) {
        return slot?.booking_end_time || slot?.end_time || '';
    },

    selectedSlotEndTime(slot = state.selectedSlot) {
        const baseEndTime = this.baseSelectedSlotEndTime(slot);
        const addOnMinutes = slot === state.selectedSlot ? this.selectedSameDayAddOnDurationMinutes() : 0;
        return addMinutesToTimeLabel(baseEndTime, addOnMinutes, baseEndTime);
    },

    clearSameDayAddOns() {
        state.selectedSameDayAddOns = [];
        state.sameDayAddOnRows = [];
        state.sameDayAddOnRequestId += 1;
    },

    sameDayAddOnKey(menu, option = null) {
        return `${menu?.code || ''}::${option?.id || option?.code || ''}`;
    },

    getPreferredSameDayAddOnOption(menu) {
        const options = this.getTreatmentDetailOptions(menu);
        if (!options.length) return null;
        return options.find(option => {
            const text = `${option.priceSub || option.price_sub || ''} ${option.label || ''} ${option.description || ''}`;
            return /(セット|同時|追加|併用)/.test(text);
        }) || options[0];
    },

    makeSameDayAddOnBaseRow(menu, option = this.getPreferredSameDayAddOnOption(menu)) {
        if (!menu) return null;
        const durationMinutes = this.treatmentDurationMinutesFor(menu, option, { preferSameDayAddOn: true });
        const durationLabel = durationMinutes ? `約${durationMinutes}分` : (option?.duration || option?.durationLabel || menu.duration || menu.durationLabel || '');
        const priceLabel = this.sameDayAddOnPriceLabel(menu, option);
        const menuLabel = menu.label || menu.code || '';
        const optionLabel = option?.label || '';
        return {
            key: this.sameDayAddOnKey(menu, option),
            menu,
            option,
            menuCode: menu.code || '',
            optionId: option?.id || option?.code || '',
            menuLabel,
            optionLabel,
            title: menuLabel,
            displayLabel: [menuLabel, optionLabel].filter(Boolean).join(' / '),
            lead: option?.benefit || option?.description || menu.lead || menu.description || '',
            description: option?.description || menu.description || '',
            priceLabel,
            durationMinutes,
            durationLabel,
            imageUrl: utils.safeImageUrl(menu.imageUrl || menu.image_url || ''),
            visualLabel: menu.visualLabel || menu.visual_label || menuLabel,
            visualTheme: utils.treatmentVisualTheme(menu.visualTheme || menu.visual_theme || 'default'),
            equipmentBookings: this.sameDayAddOnEquipmentBookings(menu, option),
            available: false,
            alternateAvailable: false,
            slot: null,
            startTime: '',
            endTime: ''
        };
    },

    getSameDayAddOnCandidates() {
        if (!state.selectedTreatmentMenu || !state.selectedDate || !state.selectedSlot) return [];
        const selectedCodes = new Set(
            this.selectedSameDayAddOns()
                .map(addOn => addOn.menuCode || addOn.menu?.code || '')
                .filter(Boolean)
        );
        return this.getTreatmentRecommendations(state.selectedTreatmentMenu)
            .filter(menu => !selectedCodes.has(menu.code))
            .map(menu => this.makeSameDayAddOnBaseRow(menu))
            .filter(row => row && row.durationMinutes > 0)
            .slice(0, 3);
    },

    getSameDayAddOnStartTime() {
        return this.selectedSlotEndTime();
    },

    findExactSameDaySlot(slotsByDate, startTime) {
        const slots = Array.isArray(slotsByDate?.[state.selectedDate]) ? slotsByDate[state.selectedDate] : [];
        return slots.find(slot => slot.start_time === startTime && Number(slot.available || 0) > 0) || null;
    },

    async buildSameDayAddOnRecommendationRows(candidates = this.getSameDayAddOnCandidates()) {
        if (!candidates.length) return [];
        const departmentApiId = await ensureDepartmentApiId(state.selectedDepartment);
        if (!departmentApiId) return candidates;
        const startTime = this.getSameDayAddOnStartTime();

        return Promise.all(candidates.map(async candidate => {
            try {
                const slotsByDate = await api.fetchSlots(
                    departmentApiId,
                    state.selectedDate,
                    state.selectedDate,
                    candidate.menu,
                    candidate.durationMinutes,
                    candidate.equipmentBookings
                );
                const daySlots = Array.isArray(slotsByDate?.[state.selectedDate]) ? slotsByDate[state.selectedDate] : [];
                const slot = this.findExactSameDaySlot(slotsByDate, startTime);
                const endTime = slot?.booking_end_time || addMinutesToTimeLabel(startTime, candidate.durationMinutes, '');
                return {
                    ...candidate,
                    available: Boolean(slot),
                    alternateAvailable: daySlots.length > 0,
                    slot,
                    startTime,
                    endTime
                };
            } catch (error) {
                console.warn('Same day add-on availability error:', error);
                return {
                    ...candidate,
                    available: false,
                    alternateAvailable: false,
                    startTime,
                    endTime: addMinutesToTimeLabel(startTime, candidate.durationMinutes, '')
                };
            }
        }));
    },

    sameDayAddOnMetaText(row = {}) {
        const formatPrice = (priceLabel) => {
            const price = String(priceLabel || '').trim();
            if (!price) return '';
            if (price === '無料') return '無料';
            if (/(税込|税別|非課税)/.test(price) || !/[¥￥円]/.test(price)) return `+${price}`;
            return `+${price}（税込）`;
        };
        const price = row.priceLabel
            ? `追加料金: ${formatPrice(row.priceLabel)}`
            : '追加料金: 確認中';
        const duration = row.durationMinutes
            ? `追加時間: ${row.durationLabel || `約${row.durationMinutes}分`}`
            : (row.durationLabel ? `追加時間: ${row.durationLabel}` : '');
        return [price, duration].filter(Boolean).join(' / ');
    },

    renderSameDayAddOnRow(row = {}, selected = false) {
        const optionLabel = row.optionLabel ? `（${row.optionLabel}）` : '';
        const isUnavailable = !selected && !row.available;
        const action = selected
            ? `<button type="button" class="same-day-addon-action added" data-addon-action="remove" data-addon-key="${utils.escapeHTML(row.key)}">追加を外す</button>`
            : row.available
                ? `<button type="button" class="same-day-addon-action" data-addon-action="add" data-addon-key="${utils.escapeHTML(row.key)}">この施術を追加する</button>`
                : `<button type="button" class="same-day-addon-action outline" data-addon-action="view" data-addon-key="${utils.escapeHTML(row.key)}">別日で空き状況を見る</button>`;
        return `
            <div class="same-day-addon-card ${selected ? 'selected' : ''} ${isUnavailable ? 'unavailable' : ''}">
                <span
                    class="same-day-addon-thumb same-day-addon-thumb--${utils.escapeHTML(row.visualTheme || 'default')} ${row.imageUrl ? 'has-image' : ''}"
                    data-image-url="${utils.escapeHTML(row.imageUrl || '')}"
                >
                    <span>${utils.escapeHTML(row.visualLabel || row.title || '施術')}</span>
                </span>
                <span class="same-day-addon-main">
                    <span class="same-day-addon-name">${utils.escapeHTML(row.title || row.menuLabel || '')}<small>${utils.escapeHTML(optionLabel)}</small></span>
                    ${row.lead ? `<span class="same-day-addon-lead">${utils.escapeHTML(row.lead)}</span>` : ''}
                    <span class="same-day-addon-meta">${utils.escapeHTML(this.sameDayAddOnMetaText(row))}</span>
                </span>
                <span class="same-day-addon-side">
                    ${action}
                </span>
            </div>
        `;
    },

    renderSameDayAddOnPanel({ rows = [], loading = false, error = '' } = {}) {
        const selectedRows = this.selectedSameDayAddOns();
        if (!selectedRows.length && !rows.length && !loading && !error) return '';
        return `
            <section class="same-day-addon-panel" id="sameDayAddOnPanel">
                <div class="same-day-addon-heading">
                    <h3>同日に追加できる施術</h3>
                    <p>気になる施術があれば、同日の予約に追加できます。追加しない場合はそのまま予約へお進みください。追加すると所要時間が延びるため、空き状況が変わる場合があります。</p>
                </div>
                <div class="same-day-addon-list">
                    ${selectedRows.map(row => this.renderSameDayAddOnRow(row, true)).join('')}
                    ${loading ? '<div class="same-day-addon-loading">追加できる施術を確認しています...</div>' : ''}
                    ${error ? `<div class="same-day-addon-error">${utils.escapeHTML(error)}</div>` : ''}
                    ${rows.map(row => this.renderSameDayAddOnRow(row, false)).join('')}
                </div>
                ${selectedRows.length ? '<p class="same-day-addon-note">追加した施術は確認画面と予約内容に反映されます。</p>' : ''}
            </section>
        `;
    },

    bindSameDayAddOnPanelEvents() {
        const panel = document.getElementById('sameDayAddOnPanel');
        if (!panel) return;
        panel.querySelectorAll('.same-day-addon-thumb[data-image-url]').forEach(thumb => {
            const imageUrl = utils.safeImageUrl(thumb.dataset.imageUrl);
            if (!imageUrl) return;
            thumb.style.backgroundImage = `linear-gradient(90deg, rgba(20, 24, 38, 0.22), rgba(20, 24, 38, 0.04)), url("${imageUrl}")`;
        });
        panel.querySelectorAll('[data-addon-action]').forEach(button => {
            button.addEventListener('click', async () => {
                const key = button.dataset.addonKey || '';
                const action = button.dataset.addonAction || '';
                if (action === 'add') {
                    this.addSameDayAddOn(key);
                    return;
                }
                if (action === 'remove') {
                    this.removeSameDayAddOn(key);
                    return;
                }
                if (action === 'view') {
                    await this.openSameDayAddOnCalendar(key);
                }
            });
        });
    },

    renderSameDayAddOnContainer(options = {}) {
        if (!elements.reservationSameDayAddOns) return;
        elements.reservationSameDayAddOns.innerHTML = this.renderSameDayAddOnPanel(options);
        this.bindSameDayAddOnPanelEvents();
    },

    updateSameDayAddOnPanel(options = {}) {
        if (elements.reservationSameDayAddOns) {
            this.renderSameDayAddOnContainer(options);
            return;
        }
        const panel = document.getElementById('sameDayAddOnPanel');
        if (!panel) return;
        panel.outerHTML = this.renderSameDayAddOnPanel(options);
        this.bindSameDayAddOnPanelEvents();
    },

    async loadSameDayAddOnRecommendations() {
        const panel = document.getElementById('sameDayAddOnPanel');
        if (!panel) return;
        const candidates = this.getSameDayAddOnCandidates();
        if (!candidates.length) {
            state.sameDayAddOnRows = [];
            this.updateSameDayAddOnPanel({ rows: [], loading: false });
            return;
        }
        const requestId = ++state.sameDayAddOnRequestId;
        try {
            const rows = await this.buildSameDayAddOnRecommendationRows(candidates);
            if (requestId !== state.sameDayAddOnRequestId) return;
            state.sameDayAddOnRows = rows;
            this.updateSameDayAddOnPanel({ rows, loading: false });
        } catch (error) {
            if (requestId !== state.sameDayAddOnRequestId) return;
            console.warn('Same day add-on load error:', error);
            state.sameDayAddOnRows = [];
            this.updateSameDayAddOnPanel({
                rows: [],
                loading: false,
                error: '追加できる施術の確認に失敗しました。'
            });
        }
    },

    findSameDayAddOnRow(key) {
        return (state.sameDayAddOnRows || []).find(row => row.key === key) ||
            this.selectedSameDayAddOns().find(row => row.key === key) ||
            this.getSameDayAddOnCandidates().find(row => row.key === key) ||
            null;
    },

    addSameDayAddOn(key) {
        const row = this.findSameDayAddOnRow(key);
        if (!row || !row.available) {
            alert('この施術は同日の連続枠を確認できませんでした。別日で空き状況を確認してください。');
            return;
        }
        if (this.selectedSameDayAddOns().some(addOn => addOn.key === key || addOn.menuCode === row.menuCode)) return;
        state.selectedSameDayAddOns.push({
            ...row,
            priceLabel: row.priceLabel || this.sameDayAddOnPriceLabel(row.menu, row.option),
            durationMinutes: row.durationMinutes || this.treatmentDurationMinutesFor(row.menu, row.option, { preferSameDayAddOn: true })
        });
        state.sameDayAddOnRows = [];
        this.renderPatientSelection();
    },

    removeSameDayAddOn(key) {
        state.selectedSameDayAddOns = this.selectedSameDayAddOns().filter(row => row.key !== key);
        state.sameDayAddOnRows = [];
        this.renderPatientSelection();
    },

    async openSameDayAddOnCalendar(key) {
        const row = this.findSameDayAddOnRow(key);
        if (!row?.menu) return;
        state.selectedTreatmentMenu = row.menu;
        state.selectedTreatmentOption = row.option || null;
        this.clearSameDayAddOns();
        state.selectedDate = null;
        state.selectedSlot = null;
        await this.loadCalendar();
        this.showStep(2);
        this.scrollToTimeSelection();
    },

    async ensureSelectedSameDayAddOnsAvailable() {
        const addOns = this.selectedSameDayAddOns();
        if (!addOns.length) return;
        const departmentApiId = await ensureDepartmentApiId(state.selectedDepartment);
        if (!departmentApiId) {
            throw new Error('追加施術の空き状況を確認できませんでした');
        }

        let startTime = this.baseSelectedSlotEndTime();
        const refreshed = [];
        for (const addOn of addOns) {
            const menu = state.treatmentMenus.find(item => item.code === addOn.menuCode) || addOn.menu;
            const option = addOn.optionId
                ? (this.getTreatmentDetailOptions(menu).find(item => String(item.id || item.code) === String(addOn.optionId)) || addOn.option || null)
                : (addOn.option || null);
            const row = this.makeSameDayAddOnBaseRow(menu, option);
            if (!row) continue;
            const slotsByDate = await api.fetchSlots(
                departmentApiId,
                state.selectedDate,
                state.selectedDate,
                row.menu,
                row.durationMinutes,
                row.equipmentBookings
            );
            const slot = this.findExactSameDaySlot(slotsByDate, startTime);
            if (!slot) {
                throw new Error(`${row.menuLabel}は同日の連続枠が埋まりました。追加を外すか、日時を選び直してください。`);
            }
            const endTime = slot.booking_end_time || addMinutesToTimeLabel(startTime, row.durationMinutes, '');
            refreshed.push({
                ...row,
                available: true,
                slot,
                startTime,
                endTime
            });
            startTime = endTime;
        }
        state.selectedSameDayAddOns = refreshed;
    },

    selectedSameDayAddOnSummaries() {
        return this.selectedSameDayAddOns()
            .map(addOn => {
                const label = this.sameDayAddOnDisplayLabel(addOn);
                if (!label) return '';
                const price = addOn.priceLabel || this.sameDayAddOnPriceLabel(addOn.menu, addOn.option);
                const duration = addOn.durationMinutes ? `追加時間 ${addOn.durationMinutes}分` : '';
                return [label, price ? `追加料金 ${price}` : '', duration].filter(Boolean).join(' / ');
            })
            .filter(Boolean);
    },

    reservationTreatmentDisplayLabel(reservation = {}) {
        const main = reservation.treatment_menu_label || reservation.treatment_menu || '';
        const detail = reservation.treatment_detail_menu_label || reservation.treatment_detail_label || '';
        return reservation.treatment_display_label || [main, detail].filter(Boolean).join(' / ');
    },

    normalizeReviewSettings(settings = {}) {
        return {
            googleReviewUrl: utils.safeExternalUrl(settings.googleReviewUrl || settings.google_review_url || '')
        };
    },

    loadStoredReviewSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.REVIEW_SETTINGS);
            state.reviewSettings = this.normalizeReviewSettings(raw ? JSON.parse(raw) : {});
        } catch (error) {
            console.error('Review settings storage load error:', error);
            state.reviewSettings = { googleReviewUrl: '' };
        }
        return state.reviewSettings;
    },

    saveStoredReviewSettings(settings = state.reviewSettings) {
        state.reviewSettings = this.normalizeReviewSettings(settings);
        localStorage.setItem(STORAGE_KEYS.REVIEW_SETTINGS, JSON.stringify(state.reviewSettings));
    },

    async loadReviewSettings() {
        this.loadStoredReviewSettings();
        this.renderGoogleReviewCard();
        try {
            const settings = await api.fetchReviewSettings();
            state.reviewSettings = this.normalizeReviewSettings(settings);
            this.saveStoredReviewSettings(state.reviewSettings);
            this.renderGoogleReviewCard();
        } catch (error) {
            console.warn('Review settings load skipped:', error);
        }
    },

    googleReviewUrl() {
        return utils.safeExternalUrl(state.reviewSettings?.googleReviewUrl || '');
    },

    renderGoogleReviewCard() {
        const url = this.googleReviewUrl();
        const card = document.getElementById('googleReviewTaskCard');
        const button = document.getElementById('googleReviewButton');
        if (!card || !button) return;
        card.classList.toggle('hidden', !url);
        button.href = url || '#';
    },

    renderGoogleReviewAction(extraClass = '') {
        const url = this.googleReviewUrl();
        if (!url) return '';
        return `
            <div class="google-review-action ${utils.escapeHTML(extraClass)}">
                <a class="btn-primary google-review-button" href="${utils.escapeHTML(url)}" target="_blank" rel="noopener">Googleで口コミを書く</a>
            </div>
        `;
    },

    renderTreatmentDetailOptionCard(option) {
        const active = state.selectedTreatmentOption?.id === option.id;
        const price = formatTreatmentDetailPriceLabel(option.price, option.lowest_price || option.lowestPrice) || '料金確認中';
        const taxLabel = /¥|円/.test(String(price)) ? '<small>（税込）</small>' : '';
        return `
            <button
                type="button"
                class="treatment-detail-card ${active ? 'active' : ''}"
                data-detail-id="${utils.escapeHTML(option.id)}"
            >
                <span class="treatment-detail-main">
                    <span class="treatment-detail-name">${utils.escapeHTML(option.label)}</span>
                    ${option.description ? `<span class="treatment-detail-description">${utils.escapeHTML(option.description)}</span>` : ''}
                    ${option.benefit ? `<span class="treatment-detail-benefit">${utils.escapeHTML(option.benefit)}</span>` : ''}
                </span>
                <span class="treatment-detail-side">
                    <span class="treatment-detail-price">${utils.escapeHTML(price)}${taxLabel}</span>
                    ${option.duration ? `<span class="treatment-detail-duration">施術所要時間 ${utils.escapeHTML(option.duration)}</span>` : ''}
                    <span class="treatment-detail-action">このメニューで空き確認</span>
                </span>
            </button>
        `;
    },

    renderTreatmentDetailOptions() {
        if (!elements.treatmentDetailPanel || !elements.treatmentDetailList) return;
        const options = this.getTreatmentDetailOptions(state.selectedTreatmentMenu);
        elements.treatmentDetailPanel.classList.toggle('hidden', !options.length);

        if (!options.length) {
            elements.treatmentDetailList.innerHTML = '';
            return;
        }

        elements.treatmentDetailList.innerHTML = options.map(option => this.renderTreatmentDetailOptionCard(option)).join('');
        elements.treatmentDetailList.querySelectorAll('.treatment-detail-card').forEach(button => {
            button.addEventListener('click', async () => {
                const option = options.find(item => item.id === button.dataset.detailId);
                if (!option) return;
                state.selectedTreatmentOption = option;
                state.selectedDate = null;
                state.selectedSlot = null;
                this.clearSameDayAddOns();
                await this.loadCalendar();
                this.scrollToTimeSelection();
            });
        });
    },

    renderTreatmentMenuCard(menu) {
        const active = state.selectedTreatmentMenu?.code === menu.code;
        const tags = (menu.tags || []).slice(0, 4);
        const badges = menu.badges || [];
        const recommendations = this.getTreatmentRecommendations(menu).slice(0, 3);
        const earliest = utils.formatTreatmentEarliestDate();
        const taxLabel = /¥|円/.test(String(menu.price || '')) ? '<small>（税込）</small>' : '';
        const hasDetailOptions = this.getTreatmentDetailOptions(menu).length > 0;

        return `
            <div
                class="treatment-menu-card ${active ? 'active' : ''}"
                data-menu-code="${utils.escapeHTML(menu.code)}"
            >
                <span
                    class="treatment-menu-visual treatment-menu-visual--${utils.escapeHTML(menu.visualTheme)} ${menu.imageUrl ? 'has-image' : ''}"
                    data-image-url="${utils.escapeHTML(menu.imageUrl || '')}"
                >
                    <span class="treatment-menu-badges">
                        ${badges.map(badge => `<span>${utils.escapeHTML(badge)}</span>`).join('')}
                    </span>
                </span>

                <span class="treatment-menu-main">
                    <span class="treatment-menu-name">${utils.escapeHTML(menu.label)}</span>
                    <span class="treatment-menu-lead">${utils.escapeHTML(menu.lead)}</span>
                    <span class="treatment-menu-tags">
                        ${tags.map(tag => `<span>${utils.escapeHTML(tag)}</span>`).join('')}
                    </span>
                    ${recommendations.length ? `
                        <span class="treatment-menu-recommendations">
                            <span class="treatment-menu-recommendation-title">同時施術におすすめ</span>
                            <span class="treatment-menu-recommendation-list">
                                ${recommendations.map(item => `<span>${utils.escapeHTML(item.label || item.code)}</span>`).join('')}
                            </span>
                        </span>
                    ` : ''}
                    <span class="treatment-menu-detail">${hasDetailOptions ? 'メニューを選択する' : '施術内容を確認する'}</span>
                </span>

                <span class="treatment-menu-side">
                    <span class="treatment-menu-price">${utils.escapeHTML(menu.price)}${taxLabel}</span>
                    ${menu.priceSub ? `<span class="treatment-menu-price-note">${utils.escapeHTML(menu.priceSub)}</span>` : ''}
                    <span class="treatment-menu-duration">施術所要時間 ${utils.escapeHTML(menu.duration)}</span>
                    <span class="treatment-menu-earliest">最短 ${utils.escapeHTML(earliest)}〜</span>
                    <button
                        type="button"
                        class="treatment-menu-action"
                        data-menu-code="${utils.escapeHTML(menu.code)}"
                    >${hasDetailOptions ? 'メニューを選ぶ' : '空き状況を確認する'}</button>
                </span>
            </div>
        `;
    },

    renderTreatmentMenus() {
        if (!elements.treatmentMenuList) return;
        const hasMenus = state.treatmentMenus.length > 0;
        elements.treatmentMenuPanel?.classList.toggle('hidden', !hasMenus);

        if (!hasMenus) {
            if (elements.treatmentConcernTabs) elements.treatmentConcernTabs.innerHTML = '';
            elements.treatmentMenuList.innerHTML = '';
            elements.treatmentDetailPanel?.classList.add('hidden');
            return;
        }

        this.renderTreatmentConcernTabs();
        const filteredMenus = this.getFilteredTreatmentMenus();
        elements.treatmentMenuList.innerHTML = filteredMenus.length
            ? filteredMenus.map(menu => this.renderTreatmentMenuCard(menu)).join('')
            : '<div class="treatment-menu-empty">この肌悩みで選べる施術はまだありません</div>';

        elements.treatmentMenuList.querySelectorAll('.treatment-menu-action').forEach(button => {
            button.addEventListener('click', async () => {
                const menu = state.treatmentMenus.find(item => item.code === button.dataset.menuCode);
                if (!menu) return;
                state.selectedTreatmentMenu = menu;
                state.selectedTreatmentOption = null;
                state.selectedDate = null;
                state.selectedSlot = null;
                this.clearSameDayAddOns();
                await this.loadCalendar();
                if (this.getTreatmentDetailOptions(menu).length > 0) {
                    this.scrollToTreatmentDetailSelection();
                } else {
                    this.scrollToTimeSelection();
                }
            });
        });

        elements.treatmentMenuList.querySelectorAll('.treatment-menu-visual[data-image-url]').forEach(visual => {
            const imageUrl = utils.safeImageUrl(visual.dataset.imageUrl);
            if (!imageUrl) return;
            visual.style.backgroundImage = `linear-gradient(90deg, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.08)), url("${imageUrl}")`;
        });
    },

    async loadCalendar() {
        if (!state.selectedDepartment) {
            elements.selectedDepartment.textContent = '診療科を選択してください';
            elements.calendar.innerHTML = '<p class="select-date-msg">左の診療科を選択してください</p>';
            elements.treatmentDetailPanel?.classList.add('hidden');
            return;
        }

        const selectedTreatmentLabel = this.selectedTreatmentDisplayLabel();
        elements.selectedDepartment.textContent = selectedTreatmentLabel
            ? `診療科: ${state.selectedDepartment.name} / メニュー: ${selectedTreatmentLabel}`
            : `診療科: ${state.selectedDepartment.name}`;
        this.renderTreatmentMenus();
        this.renderTreatmentDetailOptions();

        const dates = utils.getWeekDates(state.weekOffset);
        elements.currentWeek.textContent = utils.formatWeekRange(dates);

        if (state.treatmentMenus.length > 0 && !state.selectedTreatmentMenu) {
            state.availableSlots = {};
            this.setTimeSelectionVisible(false);
            elements.calendar.innerHTML = '<p class="select-date-msg">施術メニューを選択してください</p>';
            elements.timeSlots.innerHTML = '<p class="select-date-msg">メニューごとの空き枠を表示します</p>';
            return;
        }

        const detailOptions = this.getTreatmentDetailOptions(state.selectedTreatmentMenu);
        if (detailOptions.length > 0 && !state.selectedTreatmentOption) {
            state.availableSlots = {};
            this.setTimeSelectionVisible(false);
            elements.calendar.innerHTML = '<p class="select-date-msg">細かい施術メニューを選択してください</p>';
            elements.timeSlots.innerHTML = '<p class="select-date-msg">メニュー選択後に空き枠を表示します</p>';
            return;
        }
        this.setTimeSelectionVisible(true);

        const startDate = utils.formatDate(dates[0]);
        const endDate = utils.formatDate(dates[6]);

        elements.calendar.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        elements.timeSlots.innerHTML = '<p class="select-date-msg">○の日時を選択すると確認画面へ進みます</p>';

        // スロット取得
        try {
            const departmentApiId = await ensureDepartmentApiId(state.selectedDepartment);
            if (!departmentApiId) {
                throw new Error('診療科IDを予約管理画面のDBと照合できませんでした。診療科マスタをご確認ください。');
            }
            state.availableSlots = await api.fetchSlots(
                departmentApiId,
                startDate,
                endDate,
                state.selectedTreatmentMenu,
                this.selectedTreatmentDurationMinutes(),
                this.selectedTreatmentEquipmentBookings()
            );

            if (!this.hasCalendarSlots(state.availableSlots)) {
                elements.calendar.innerHTML = '<p class="select-date-msg">予約可能な枠がありません</p>';
                elements.timeSlots.innerHTML = '<p class="select-date-msg">予約管理画面のカレンダー設定と予約枠をご確認ください</p>';
                return;
            }

            elements.timeSlots.innerHTML = '<p class="select-date-msg">○の日時を選択すると確認画面へ進みます</p>';
            this.renderAvailabilityTable(dates);
        } catch (error) {
            console.error('Slots load error:', error);
            state.availableSlots = {};
            const message = getErrorMessage(error, '予約枠を取得できませんでした');
            elements.calendar.innerHTML = `<p class="select-date-msg">${utils.escapeHTML(message)}</p>`;
            elements.timeSlots.innerHTML = '<p class="select-date-msg">予約管理画面のカレンダー設定とAPI接続をご確認ください</p>';
        }
    },

    hasCalendarSlots(slots) {
        return hasSlotEntries(slots);
    },

    getSlotRows(dates) {
        const rows = new Map();

        dates.forEach(date => {
            const dateStr = utils.formatDate(date);
            (state.availableSlots[dateStr] || []).forEach(slot => {
                const key = `${slot.start_time}-${slot.end_time}`;
                if (!rows.has(key)) {
                    rows.set(key, {
                        start_time: slot.start_time,
                        end_time: slot.end_time
                    });
                }
            });
        });

        const slotRows = Array.from(rows.values()).sort((a, b) => a.start_time.localeCompare(b.start_time));
        return slotRows.length > 0 ? slotRows : DEFAULT_TIME_ROWS;
    },

    renderAvailabilityTable(dates, { isDemo = false } = {}) {
        const rows = this.getSlotRows(dates);
        elements.calendar.classList.toggle('calendar-demo-mode', isDemo);
        const headerCells = dates.map(date => {
            const day = date.getDay();
            const classNames = [
                'date-column',
                day === 0 ? 'sun' : '',
                day === 6 ? 'sat' : '',
                utils.isToday(date) ? 'today' : ''
            ].filter(Boolean).join(' ');

            return `
                <th class="${classNames}" scope="col">
                    <span class="date-weekday">${utils.getDayName(date)}</span>
                    <span class="date-day">${utils.formatDateHeading(date)}</span>
                </th>
            `;
        }).join('');

        const bodyRows = rows.map(row => {
            const cells = dates.map(date => {
                const day = date.getDay();
                const dateStr = utils.formatDate(date);
                const slots = state.availableSlots[dateStr] || [];
                const slot = slots.find(s => s.start_time === row.start_time && s.end_time === row.end_time);
                const available = Number(slot?.available || 0);
                // 日付が過去、または今日で時間枠が過去の場合は予約不可
                const isPastDate = utils.isPast(date);
                const isPastSlot = utils.isSlotPast(date, row.start_time, state.closeOffset);
                const disabled = isPastDate || isPastSlot || !slot || available <= 0;
                const selected = state.selectedDate === dateStr && state.selectedSlot?.id === slot?.id;
                const availabilityClass = [
                    isDemo ? 'demo' : '',
                    disabled ? 'disabled' : 'available'
                ].filter(Boolean).join(' ');
                const availabilityMark = disabled ? '-' : '○';
                // 過去の時間枠は視覚的にわかりやすく
                const isPastCell = !isDemo && (isPastDate || isPastSlot);
                const cellLabel = slot
                    ? `${utils.formatDisplayDate(date)} ${slot.start_time}から${slot.end_time} 残り${available}枠`
                    : `${utils.formatDisplayDate(date)} ${row.start_time}から${row.end_time} 予約不可`;
                const cellClasses = [
                    'calendar-cell',
                    day === 0 ? 'sun' : '',
                    day === 6 ? 'sat' : '',
                    utils.isToday(date) ? 'today' : '',
                    disabled ? 'closed' : '',
                    isPastCell ? 'past-slot' : ''
                ].filter(Boolean).join(' ');

                return `
                    <td class="${cellClasses}">
                        <button
                            type="button"
                            class="availability-cell ${availabilityClass} ${selected ? 'selected' : ''}"
                            data-date="${dateStr}"
                            data-slot-id="${slot ? utils.escapeHTML(slot.id) : ''}"
                            aria-label="${utils.escapeHTML(cellLabel)}"
                            ${disabled ? 'disabled' : ''}
                        >
                            <span class="availability-mark">${availabilityMark}</span>
                        </button>
                    </td>
                `;
            }).join('');

            const rowTimeLabel = row.start_time;

            return `
                <tr>
                    <td class="time-label">
                        <span>${utils.escapeHTML(rowTimeLabel)}</span>
                    </td>
                    ${cells}
                </tr>
            `;
        }).join('');

        elements.calendar.innerHTML = `
            <table class="availability-table ${isDemo ? 'demo-calendar' : ''}" aria-label="予約空き状況">
                    <thead>
                        <tr>
                            <th class="time-column" scope="col">
                                <span class="time-column-title">予約開始時間</span>
                                <span class="time-column-month">${dates[0].getMonth() + 1}月</span>
                            </th>
                            ${headerCells}
                        </tr>
                    </thead>
                    <tbody>
                        ${bodyRows}
                    </tbody>
                </table>
        `;

        this.bindAvailabilityCells();
    },

    bindAvailabilityCells() {
        elements.calendar.querySelectorAll('.availability-cell:not(.disabled)').forEach(cell => {
            cell.addEventListener('click', () => {
                const date = cell.dataset.date;
                const slotId = cell.dataset.slotId;
                const slot = (state.availableSlots[date] || []).find(s => String(s.id) === String(slotId));
                if (!slot) return;

                state.selectedDate = date;
                state.selectedSlot = slot;
                this.clearSameDayAddOns();

                // 以前の選択を解除
                elements.calendar.querySelectorAll('.availability-cell').forEach(el => {
                    el.classList.remove('selected');
                    el.closest('.calendar-cell')?.classList.remove('selected');
                });
                // 新しい選択を追加（セル全体の背景色も変更）
                cell.classList.add('selected');
                cell.closest('.calendar-cell')?.classList.add('selected');

                const selectedDate = new Date(state.selectedDate);
                elements.timeSlots.innerHTML = `
                    <p class="select-date-msg">
                        ${utils.formatDisplayDate(selectedDate)} ${utils.escapeHTML(slot.start_time)} - ${utils.escapeHTML(this.selectedSlotEndTime(slot))} を選択しました
                    </p>
                `;

                setTimeout(() => {
                    this.renderPatientSelection();
                    this.showStep(3);
                }, 180);
            });
        });
    },

    renderReservationSummary() {
        const selectedDate = new Date(state.selectedDate);
        const treatmentLabel = this.selectedTreatmentDisplayLabel();
        const priceLabel = this.selectedTreatmentPriceLabel();
        const menuRow = treatmentLabel ? `
            <div class="reservation-summary-row">
                <span class="reservation-summary-label">メニュー</span>
                <span class="reservation-summary-value">${utils.escapeHTML(treatmentLabel)}</span>
            </div>
        ` : '';
        const priceRow = priceLabel ? `
            <div class="reservation-summary-row">
                <span class="reservation-summary-label">料金</span>
                <span class="reservation-summary-value">${utils.escapeHTML(priceLabel)}</span>
            </div>
        ` : '';
        elements.reservationSummary.innerHTML = `
            <div class="reservation-summary-row">
                <span class="reservation-summary-label">診療科</span>
                <span class="reservation-summary-value">${utils.escapeHTML(state.selectedDepartment.name)}</span>
            </div>
            ${menuRow}
            ${priceRow}
            <div class="reservation-summary-row">
                <span class="reservation-summary-label">日時</span>
                <span class="reservation-summary-value">${utils.formatDisplayDate(selectedDate)} ${utils.escapeHTML(state.selectedSlot.start_time)} - ${utils.escapeHTML(this.selectedSlotEndTime())}</span>
            </div>
        `;
    },

    getSelectedAccount() {
        return state.accounts.find(account => account.id === state.selectedAccountId) || null;
    },

    getPatientCandidates(account = this.getSelectedAccount()) {
        if (!account) return [];

        return [
            {
                id: `${account.id}__self`,
                accountId: account.id,
                name: account.name,
                kana: account.kana || '',
                birthdate: account.birthdate || '',
                patient_id: account.patient_id || null,
                patient_no: account.patient_no || '',
                documents: account.documents || {},
                isPrimary: true
            },
            ...(account.members || []).map(member => ({
                ...member,
                accountId: account.id
            }))
        ];
    },

    renderAccountPanel() {
        this.renderAccountList();
        this.renderFamilyPanel();
    },

    renderAccountList() {
        if (!state.accounts.length) {
            if (elements.accountList) elements.accountList.innerHTML = '';
            elements.accountEmpty?.classList.remove('hidden');
            elements.accountForm?.classList.remove('hidden');
            elements.familyPanel?.classList.add('hidden');
            return;
        }

        elements.accountEmpty?.classList.add('hidden');
        elements.accountForm?.classList.add('hidden');

        ensureSelectedPatientSelection(this.getAllPatientCandidates());
        if (!state.selectedAccountId || !state.accounts.some(account => account.id === state.selectedAccountId)) {
            selectPatientCandidate({ id: `${state.accounts[0].id}__self`, accountId: state.accounts[0].id });
        }

        elements.accountList.innerHTML = state.accounts.map(account => `
            <button type="button" class="account-card ${account.id === state.selectedAccountId ? 'active' : ''}" data-account-id="${utils.escapeHTML(account.id)}">
                <span class="account-card-main">${utils.escapeHTML(account.name)}</span>
                <span class="account-card-sub">${utils.escapeHTML(account.phone)} / 登録患者様${(account.members?.length || 0) + 1}名</span>
            </button>
        `).join('');

        elements.accountList.querySelectorAll('.account-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectAccount(card.dataset.accountId);
            });
        });
    },

    renderDocumentUploads(ownerType, ownerId, documents = {}) {
        return `
            <div class="document-upload-list">
                ${DOCUMENT_TYPES.map(documentType => {
                    const documentData = documents?.[documentType.key];
                    const hasDocument = Boolean(documentData?.data_url);
                    return `
                        <div class="document-upload-row ${hasDocument ? 'completed' : ''}">
                            <div class="document-upload-info">
                                <span class="document-upload-title">${utils.escapeHTML(documentType.label)}</span>
                                <span class="document-upload-status ${hasDocument ? 'completed' : ''}">${hasDocument ? '登録済' : '未登録'}</span>
                            </div>
                            <div class="document-upload-action">
                                ${hasDocument ? `<img class="document-preview" src="${utils.escapeHTML(documentData.data_url)}" alt="${utils.escapeHTML(documentType.label)}プレビュー">` : ''}
                                <label class="document-upload-button">
                                    写真を選択
                                    <input
                                        class="document-input"
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        data-owner-type="${utils.escapeHTML(ownerType)}"
                                        data-owner-id="${utils.escapeHTML(ownerId)}"
                                        data-document-type="${utils.escapeHTML(documentType.key)}"
                                    >
                                </label>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderFamilyPanel() {
        const account = this.getSelectedAccount();
        if (!account) {
            elements.familyPanel?.classList.add('hidden');
            return;
        }

        elements.familyPanel?.classList.remove('hidden');
        const members = account.members || [];
        const selectedPatientId = state.selectedPatientMemberId || `${account.id}__self`;

        elements.familyList.innerHTML = `
            <div class="family-member-card primary ${selectedPatientId === `${account.id}__self` ? 'active' : ''}">
                <div class="family-member-header">
                    <span>
                        <span class="family-member-name">${utils.escapeHTML(account.name)}</span>
                        <span class="family-member-meta">${account.birthdate ? utils.escapeHTML(account.birthdate) : ''}</span>
                    </span>
                    <button type="button" class="patient-select-button" data-patient-id="${utils.escapeHTML(`${account.id}__self`)}">選択</button>
                </div>
                ${this.renderDocumentUploads('self', account.id, account.documents)}
            </div>
            ${members.map(member => `
                <div class="family-member-card ${selectedPatientId === member.id ? 'active' : ''}">
                    <div class="family-member-header">
                        <span>
                            <span class="family-member-name">${utils.escapeHTML(member.name)}</span>
                            <span class="family-member-meta">${member.birthdate ? utils.escapeHTML(member.birthdate) : ''}</span>
                        </span>
                        <button type="button" class="patient-select-button" data-patient-id="${utils.escapeHTML(member.id)}">選択</button>
                    </div>
                    ${this.renderDocumentUploads('member', member.id, member.documents)}
                </div>
            `).join('')}
        `;

        this.bindPatientSelectEvents();
        this.bindDocumentUploadEvents();
        this.bindPortalActionEvents();
    },

    bindPatientSelectEvents() {
        elements.familyList.querySelectorAll('.patient-select-button').forEach(button => {
            button.addEventListener('click', () => {
                selectPatientCandidate({ id: button.dataset.patientId, accountId: state.selectedAccountId });
                elements.portalContent?.classList.add('hidden');
                this.renderFamilyPanel();
            });
        });
    },

    bindPortalActionEvents() {
        document.querySelectorAll('[data-portal-action]').forEach(button => {
            if (button.dataset.bound === 'true') return;
            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
                state.selectedPortalAction = button.dataset.portalAction;
                this.renderVisitDocumentCards(this.getSelectedHistoryVisit());
                this.renderPortalContent(button.dataset.portalAction);
            });
        });
    },

    historyVisitKey(history) {
        return String(
            history?.reservation_number ||
            history?.id ||
            [
                history?.reservation_date || '',
                history?.start_time || '',
                history?.department_id || history?.department_name || '',
                history?.patient_id || history?.patient_name || ''
            ].join('|')
        );
    },

    getSelectedHistoryVisit() {
        const key = state.selectedHistoryVisitKey;
        if (!key) return null;
        return reservationStore.load().find(history => this.historyVisitKey(history) === key) || null;
    },

    formatHistoryVisitDate(history) {
        const rawDate = String(history?.reservation_date || '').slice(0, 10);
        if (!rawDate) return '日付未登録';
        return rawDate.replaceAll('-', '/');
    },

    formatHistoryVisitTime(history) {
        const start = utils.formatJapaneseTime(history?.start_time);
        const end = utils.formatJapaneseTime(history?.end_time);
        if (start && end) return `${start} - ${end}`;
        return start || '';
    },

    formatHistoryDateTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value).replace('T', ' ').slice(0, 16);
        }
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${y}/${m}/${d} ${hh}:${mm}`;
    },

    formatReservationStatus(status) {
        const statusMap = {
            confirmed: '予約確定',
            pending: '確認中',
            checked_in: '受付済み',
            completed: '診療完了',
            cancelled: 'キャンセル済み',
            no_show: '来院なし'
        };
        return statusMap[status] || status || '未登録';
    },

    formatDocumentStatus(uploaded, completedLabel = '登録済', pendingLabel = '未登録') {
        return uploaded ? completedLabel : pendingLabel;
    },

    buildHistoryDetailRows(history, patient = null) {
        const treatmentLabel = this.reservationTreatmentDisplayLabel(history) || history?.symptoms || '受診';
        const priceLabel = history?.treatment_detail_price || history?.amount || history?.billing_amount || '';
        const questionnaireDone = Boolean(
            history?.questionnaire_completed ||
            history?.questionnaire_response_id ||
            history?.questionnaire_status === 'completed' ||
            history?.questionnaire_completed_at
        );
        const insuranceUploaded = Boolean(history?.insurance_uploaded || history?.insurance_card_id || history?.insurance_card_status);
        const medicalCertificateUploaded = Boolean(history?.medical_certificate_uploaded || history?.medical_certificate_id || history?.medical_certificate_status);
        const rows = [
            ['患者様', history?.patient_name || patient?.name || '未登録'],
            ['患者番号', history?.patient_no || '未登録'],
            ['予約番号', history?.reservation_number || '未登録'],
            ['診療日', this.formatHistoryVisitDate(history)],
            ['時間', this.formatHistoryVisitTime(history) || '未登録'],
            ['クリニック', history?.clinic_name || '未登録'],
            ['診療科', history?.department_name || '診療'],
            ['診療内容', treatmentLabel],
            ['料金', priceLabel || '未登録'],
            ['状態', this.formatReservationStatus(history?.status)],
            ['問診票', this.formatDocumentStatus(questionnaireDone, '回答済', '未回答')],
            ['保険証', this.formatDocumentStatus(insuranceUploaded)],
            ['医療証', this.formatDocumentStatus(medicalCertificateUploaded)],
            ['受付日時', this.formatHistoryDateTime(history?.checked_in_at) || '未登録'],
            ['登録日時', this.formatHistoryDateTime(history?.created_at) || '未登録']
        ];
        return rows;
    },

    renderHistoryDetailRows(rows) {
        return rows.map(([label, value]) => `
            <div class="history-detail-modal-row">
                <span>${utils.escapeHTML(label)}</span>
                <strong>${utils.escapeHTML(value || '未登録')}</strong>
            </div>
        `).join('');
    },

    showHistoryVisitModal(history) {
        const modal = document.getElementById('historyDetailModal');
        const body = document.getElementById('historyDetailModalBody');
        if (!modal || !body || !history) return;

        const patient = pageController.getMypageSelectedPatient?.() || this.getSelectedPatientMember?.() || null;
        const treatmentLabel = this.reservationTreatmentDisplayLabel(history) || history?.symptoms || '受診';
        const dateLabel = this.formatHistoryVisitDate(history);
        const timeLabel = this.formatHistoryVisitTime(history);
        const notes = [
            ['症状・相談内容', history?.symptoms],
            ['メモ', history?.notes]
        ].filter(([, value]) => String(value || '').trim());

        body.innerHTML = `
            <div class="history-detail-modal-summary">
                <span class="history-detail-modal-date">${utils.escapeHTML(dateLabel)}</span>
                <div>
                    <h4>${utils.escapeHTML(treatmentLabel)}</h4>
                    <p>${utils.escapeHTML([history?.department_name, timeLabel].filter(Boolean).join(' / ') || '診療')}</p>
                </div>
            </div>
            <div class="history-detail-modal-grid">
                ${this.renderHistoryDetailRows(this.buildHistoryDetailRows(history, patient))}
            </div>
            ${notes.length ? `
                <div class="history-detail-modal-notes">
                    ${notes.map(([label, value]) => `
                        <section>
                            <span>${utils.escapeHTML(label)}</span>
                            <p>${utils.escapeHTML(value).replace(/\n/g, '<br>')}</p>
                        </section>
                    `).join('')}
                </div>
            ` : ''}
            ${this.renderGoogleReviewAction('history-detail-review-action')}
        `;

        modal.classList.remove('hidden');
    },

    closeHistoryVisitModal() {
        document.getElementById('historyDetailModal')?.classList.add('hidden');
    },

    buildVisitDocumentData(action, history, patient = this.getSelectedPatientMember()) {
        const treatmentLabel = this.reservationTreatmentDisplayLabel(history) || history?.symptoms || '診療';
        const dateLabel = this.formatHistoryVisitDate(history);
        const timeLabel = this.formatHistoryVisitTime(history);
        const visitMeta = [dateLabel, timeLabel, history?.department_name, treatmentLabel]
            .filter(Boolean)
            .join(' / ');
        const priceLabel = history?.treatment_detail_price || history?.amount || history?.billing_amount || '金額未登録';
        const patientName = history?.patient_name || patient?.name || '患者様';

        const documents = {
            receipts: {
                title: '電子領収書',
                status: history?.receipt_status || '診療日連携',
                meta: `${dateLabel} の領収書`,
                body: 'この診療日の会計情報に紐づく領収書です。',
                rows: [
                    ['受診者', patientName],
                    ['診療日', visitMeta],
                    ['金額', priceLabel],
                    ['予約番号', history?.reservation_number || '未登録']
                ]
            },
            referral: {
                title: '電子診療情報提供書',
                status: history?.referral_document_status || '診療日連携',
                meta: `${dateLabel} の提供書`,
                body: 'この診療日にカルテ側で作成・添付された診療情報提供書を表示します。',
                rows: [
                    ['受診者', patientName],
                    ['診療日', visitMeta],
                    ['診療科', history?.department_name || '未登録'],
                    ['文書状態', history?.referral_document_status || '未発行']
                ]
            },
            medication: {
                title: '電子薬剤情報',
                status: history?.medication_status || '診療日連携',
                meta: `${dateLabel} の薬剤情報`,
                body: 'この診療日に処方・登録された薬剤情報を表示します。',
                rows: [
                    ['受診者', patientName],
                    ['診療日', visitMeta],
                    ['メニュー', treatmentLabel],
                    ['薬剤情報', history?.medication_summary || '未登録']
                ]
            }
        };

        return documents[action] || null;
    },

    renderVisitDocumentCards(history) {
        const context = document.getElementById('selectedVisitContext');
        const portalActions = document.getElementById('portalActions');
        if (!context || !portalActions) return;

        if (!history) {
            context.innerHTML = '<p class="visit-document-empty">診療履歴を選択してください。</p>';
            portalActions.querySelectorAll('[data-portal-action]').forEach(button => {
                button.disabled = true;
                button.classList.remove('active');
            });
            elements.portalContent?.classList.add('hidden');
            return;
        }

        const treatmentLabel = this.reservationTreatmentDisplayLabel(history) || history.symptoms || '受診';
        const dateLabel = this.formatHistoryVisitDate(history);
        const timeLabel = this.formatHistoryVisitTime(history);
        context.innerHTML = `
            <div class="visit-document-summary">
                <span class="visit-document-date">${utils.escapeHTML(dateLabel)}</span>
                <span class="visit-document-department">${utils.escapeHTML(history.department_name || '診療')}</span>
                <span class="visit-document-detail">${utils.escapeHTML(treatmentLabel)}</span>
                ${timeLabel ? `<span class="visit-document-time">${utils.escapeHTML(timeLabel)}</span>` : ''}
            </div>
        `;

        portalActions.querySelectorAll('[data-portal-action]').forEach(button => {
            const action = button.dataset.portalAction;
            const documentData = this.buildVisitDocumentData(action, history);
            button.disabled = false;
            button.classList.toggle('active', state.selectedPortalAction === action);
            const meta = button.querySelector('.portal-action-meta');
            if (meta && documentData) {
                meta.textContent = documentData.meta;
            }
        });
    },

    renderPortalContent(action) {
        const patient = this.getSelectedPatientMember();
        const history = this.getSelectedHistoryVisit();
        const content = this.buildVisitDocumentData(action, history, patient);

        if (!content || !elements.portalContent) return;

        elements.portalContent.innerHTML = `
            <div class="portal-content-header">
                <div>
                    <p class="section-kicker">${utils.escapeHTML(patient?.name || '患者様')}</p>
                    <h3>${utils.escapeHTML(content.title)}</h3>
                </div>
                <span class="portal-content-status">${utils.escapeHTML(content.status)}</span>
            </div>
            <p>${utils.escapeHTML(content.body)}</p>
            <div class="portal-document-rows">
                ${content.rows.map(([label, value]) => `
                    <div class="portal-document-row">
                        <span>${utils.escapeHTML(label)}</span>
                        <strong>${utils.escapeHTML(value || '未登録')}</strong>
                    </div>
                `).join('')}
            </div>
        `;
        elements.portalContent.classList.remove('hidden');
    },

    bindDocumentUploadEvents() {
        elements.familyList.querySelectorAll('.document-input').forEach(input => {
            input.addEventListener('change', (event) => {
                this.handlePatientDocumentFile({
                    ownerType: input.dataset.ownerType,
                    ownerId: input.dataset.ownerId,
                    documentType: input.dataset.documentType,
                    file: event.target.files?.[0]
                });
            });
        });
    },

    getDocumentOwner(ownerType, ownerId) {
        const account = this.getSelectedAccount();
        if (!account) return null;
        if (ownerType === 'self') return account.id === ownerId ? account : null;
        return (account.members || []).find(member => member.id === ownerId) || null;
    },

    getDocumentStatusText(documents = {}) {
        return DOCUMENT_TYPES.map(documentType => {
            const hasDocument = Boolean(documents?.[documentType.key]?.data_url);
            return `${documentType.label}: ${hasDocument ? '登録済' : '未登録'}`;
        }).join(' / ');
    },

    getPatientOwner(patient = this.getSelectedPatientMember()) {
        const account = this.getSelectedAccount();
        if (!account || !patient) return null;
        if (patient.isPrimary || patient.id === `${account.id}__self`) return account;
        return (account.members || []).find(member => member.id === patient.id) || null;
    },

    buildPatientSyncPayload(owner, account = this.getSelectedAccount()) {
        return {
            facility_id: CONFIG.FACILITY_ID,
            patient_id: owner.patient_id || null,
            name: owner.name,
            name_kana: owner.kana || owner.name,
            phone: account?.phone || owner.phone || '',
            email: account?.email || owner.email || '',
            birth_date: owner.birthdate,
            gender: owner.gender || 'other'
        };
    },

    async syncPatientOwner(owner) {
        const account = this.getSelectedAccount();
        if (!owner || !account) throw new Error('患者様情報が見つかりません');
        if (!owner.name || !owner.birthdate || !account.phone) {
            throw new Error('患者様のお名前・電話番号・生年月日を入力してください');
        }

        const synced = await api.syncPatient(this.buildPatientSyncPayload(owner, account));
        owner.patient_id = synced.id;
        owner.patient_no = synced.patient_no || owner.patient_no || '';
        accountStore.save(state.accounts);
        return synced;
    },

    async ensureSelectedPatientSynced() {
        const patient = this.getSelectedPatientMember();
        const owner = this.getPatientOwner(patient);
        if (!owner) throw new Error('患者様を選択してください');
        if (!owner.patient_id) {
            await this.syncPatientOwner(owner);
            this.renderAccountPanel();
        }
        return this.getSelectedPatientMember();
    },

    readImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                if (typeof Image === 'undefined' || typeof document.createElement !== 'function') {
                    resolve(dataUrl);
                    return;
                }

                const image = new Image();
                image.onload = () => {
                    try {
                        const maxSide = 1280;
                        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(image.width * scale);
                        canvas.height = Math.round(image.height * scale);
                        const context = canvas.getContext('2d');
                        if (!context) {
                            resolve(dataUrl);
                            return;
                        }

                        context.drawImage(image, 0, 0, canvas.width, canvas.height);
                        resolve(canvas.toDataURL('image/jpeg', 0.82));
                    } catch (error) {
                        console.error('Document image resize error:', error);
                        resolve(dataUrl);
                    }
                };
                image.onerror = () => resolve(dataUrl);
                image.src = dataUrl;
            };
            reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            reader.readAsDataURL(file);
        });
    },

    async handlePatientDocumentFile({ ownerType, ownerId, documentType, file }) {
        if (!file) return;
        if (!file.type?.startsWith('image/')) {
            alert('画像ファイルを選択してください');
            return;
        }
        if (!DOCUMENT_TYPES.some(item => item.key === documentType)) {
            alert('写真の種類を確認できませんでした');
            return;
        }

        const owner = this.getDocumentOwner(ownerType, ownerId);
        if (!owner) {
            alert('患者様情報が見つかりませんでした');
            return;
        }

        try {
            const dataUrl = await this.readImageFile(file);
            owner.documents = owner.documents || {};
            const previousDocument = owner.documents[documentType];
            owner.documents[documentType] = {
                file_name: file.name || '',
                content_type: dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : (file.type || 'image/*'),
                data_url: dataUrl,
                updated_at: new Date().toISOString()
            };

            if (!accountStore.save(state.accounts)) {
                if (previousDocument) {
                    owner.documents[documentType] = previousDocument;
                } else {
                    delete owner.documents[documentType];
                }
                alert('写真を保存できませんでした。画像サイズを小さくして再度お試しください。');
                return;
            }

            this.renderFamilyPanel();
            if (state.currentStep === 4) {
                this.renderConfirmation();
            }
        } catch (error) {
            console.error('Document image load error:', error);
            alert('写真の読み込みに失敗しました。もう一度お試しください。');
        }
    },

    selectAccount(accountId) {
        selectPatientCandidate({ id: `${accountId}__self`, accountId });
        elements.portalContent?.classList.add('hidden');
        this.renderAccountPanel();
    },

    async createAccount() {
        const formData = new FormData(elements.accountForm);
        const account = {
            id: utils.generateId('account'),
            type: 'parent',
            name: String(formData.get('name') || '').trim(),
            kana: String(formData.get('kana') || '').trim(),
            phone: utils.getPhoneValue('accountPhone') || String(formData.get('phone') || '').trim(),
            email: String(formData.get('email') || '').trim(),
            birthdate: String(formData.get('birthdate') || '').trim(),
            documents: {},
            members: []
        };

        if (utils.isPhoneIncomplete('accountPhone')) {
            alert('電話番号は3つの欄に分けて入力してください');
            return;
        }
        if (!account.name || !account.phone || !account.birthdate) {
            alert('お名前・電話番号・生年月日を入力してください');
            return;
        }
        const duplicate = findDuplicateLocalPatient(account);
        if (duplicate) {
            alert(duplicateLocalPatientMessage(duplicate));
            return;
        }

        state.accounts.push(account);
        selectPatientCandidate({ id: `${account.id}__self`, accountId: account.id });
        accountStore.save(state.accounts);
        elements.accountForm.reset();
        this.renderAccountPanel();

        try {
            await this.syncPatientOwner(account);
            this.renderAccountPanel();
        } catch (error) {
            if (error.status === 409) {
                state.accounts = state.accounts.filter(item => item.id !== account.id);
                ensureSelectedPatientSelection(this.getAllPatientCandidates());
                accountStore.save(state.accounts);
                this.renderAccountPanel();
            }
            alert(getErrorMessage(error, '患者様情報の同期に失敗しました'));
        }
    },

    async addFamilyMember() {
        const account = this.getSelectedAccount();
        if (!account) {
            alert('先に患者様情報を登録してください');
            return;
        }

        const formData = new FormData(elements.familyForm);
        const member = {
            id: utils.generateId('member'),
            name: String(formData.get('name') || '').trim(),
            kana: String(formData.get('kana') || '').trim(),
            birthdate: String(formData.get('birthdate') || '').trim(),
            documents: {}
        };

        if (!member.name || !member.birthdate) {
            alert('患者様のお名前と生年月日を入力してください');
            return;
        }
        const duplicate = findDuplicateLocalPatient(member);
        if (duplicate) {
            alert(duplicateLocalPatientMessage(duplicate));
            return;
        }

        account.members = account.members || [];
        account.members.push(member);
        selectPatientCandidate({ id: member.id, accountId: account.id });
        accountStore.save(state.accounts);
        elements.familyForm.reset();
        this.renderAccountPanel();

        try {
            await this.syncPatientOwner(member);
            this.renderAccountPanel();
        } catch (error) {
            if (error.status === 409) {
                account.members = (account.members || []).filter(item => item.id !== member.id);
                ensureSelectedPatientSelection(this.getAllPatientCandidates());
                accountStore.save(state.accounts);
                this.renderAccountPanel();
            }
            alert(getErrorMessage(error, '患者様情報の同期に失敗しました'));
        }
    },

    continueToConfirmation() {
        const account = this.getSelectedAccount();
        if (!account) {
            alert('患者様を選択してください');
            return;
        }

        const candidates = this.getPatientCandidates(account);
        ensureSelectedPatientSelection(candidates);

        this.renderConfirmation();
        this.showStep(4);
    },

    async continueToDepartment() {
        const account = this.getSelectedAccount();
        if (!account) {
            alert('患者様を登録または選択してください');
            return;
        }

        const candidates = this.getPatientCandidates(account);
        ensureSelectedPatientSelection(candidates);

        try {
            await this.ensureSelectedPatientSynced();
        } catch (error) {
            alert(getErrorMessage(error, '患者様情報の同期に失敗しました'));
            return;
        }

        this.showStep(2);
    },

    renderPatientSelector() {
        if (!elements.patientSelectPanel) return;

        const account = this.getSelectedAccount();
        const candidates = this.getPatientCandidates(account);

        elements.patientSelectPanel.innerHTML = `
            <div class="patient-select-heading">
                <div>
                    <p class="section-kicker">受診者</p>
                    <h3>だれが受診しますか</h3>
                </div>
            </div>
            <div class="patient-choice-list">
                ${candidates.map(candidate => `
                    <label class="patient-choice ${candidate.id === state.selectedPatientMemberId ? 'active' : ''}">
                        <input type="radio" name="patient_member" value="${utils.escapeHTML(candidate.id)}" ${candidate.id === state.selectedPatientMemberId ? 'checked' : ''}>
                        <span>
                            <strong>${utils.escapeHTML(candidate.name)}</strong>
                            <small>${candidate.birthdate ? utils.formatAge(candidate.birthdate) : '生年月日未登録'}</small>
                            <small>${utils.escapeHTML(this.getDocumentStatusText(candidate.documents))}</small>
                        </span>
                    </label>
                `).join('')}
            </div>
        `;

        elements.patientSelectPanel.querySelectorAll('input[name="patient_member"]').forEach(input => {
            input.addEventListener('change', () => {
                const selected = candidates.find(candidate => candidate.id === input.value);
                selectPatientCandidate(selected || { id: input.value, accountId: state.selectedAccountId });
                this.renderConfirmation();
            });
        });
    },

    // すべてのアカウントから患者候補を取得
    getAllPatientCandidates() {
        const candidates = [];
        state.accounts.forEach(account => {
            candidates.push({
                id: `${account.id}__self`,
                accountId: account.id,
                name: account.name,
                kana: account.kana || '',
                birthdate: account.birthdate || '',
                phone: account.phone || '',
                patient_id: account.patient_id || null,
                patient_no: account.patient_no || '',
                documents: account.documents || {},
                isPrimary: true
            });
            (account.members || []).forEach(member => {
                candidates.push({
                    ...member,
                    accountId: account.id,
                    phone: account.phone || ''
                });
            });
        });
        return candidates;
    },

    // Step 3: 患者選択画面を描画
    renderPatientSelection() {
        const selectedDate = new Date(state.selectedDate);
        const candidates = this.getAllPatientCandidates();
        const treatmentLabel = this.selectedTreatmentDisplayLabel();
        const priceLabel = this.selectedTreatmentPriceLabel();
        const menuInfoRow = treatmentLabel ? `
                    <p><strong>メニュー:</strong> ${utils.escapeHTML(treatmentLabel)}</p>
                    ${priceLabel ? `<p><strong>料金:</strong> ${utils.escapeHTML(priceLabel)}</p>` : ''}
        ` : '';
        const addOnCandidates = this.getSameDayAddOnCandidates();

        if (!elements.reservationPatientList) return;

        // 患者が登録されていない場合は新規登録フォームを表示
        if (candidates.length === 0) {
            elements.reservationPatientList.innerHTML = `
                <div class="reservation-selection-info">
                    <p><strong>診療科:</strong> ${utils.escapeHTML(state.selectedDepartment.name)}</p>
                    ${menuInfoRow}
                    <p><strong>日時:</strong> ${utils.formatDisplayDate(selectedDate)} ${utils.formatJapaneseTime(state.selectedSlot.start_time)} - ${utils.formatJapaneseTime(this.selectedSlotEndTime())}</p>
                </div>
                <div class="patient-select-heading">
                    <p class="section-kicker">受診者情報</p>
                    <h3>受診者情報を入力してください</h3>
                </div>
                <div class="new-patient-form-panel">
                    <form id="newPatientForm" class="form">
                        <div class="form-group">
                            <label>お名前 <span class="required">必須</span></label>
                            <input type="text" id="newPatientName" required placeholder="山田 太郎">
                        </div>
                        <div class="form-group">
                            <label>フリガナ</label>
                            <input type="text" id="newPatientKana" placeholder="ヤマダ タロウ">
                        </div>
                        <div class="form-group">
                            <label>生年月日 <span class="required">必須</span></label>
                            <input type="date" id="newPatientBirthdate" required>
                        </div>
                        <div class="form-group">
                            <label>電話番号 <span class="required">必須</span></label>
                            ${utils.renderPhoneInput('newPatientPhone', true)}
                        </div>
                        <div class="form-group">
                            <label>メールアドレス</label>
                            <input type="email" id="newPatientEmail" placeholder="example@email.com">
                        </div>
                        <div class="form-actions">
                            <button type="submit" class="btn-primary">確認画面へ進む</button>
                        </div>
                    </form>
                </div>
            `;
            utils.bindPhoneInputs(elements.reservationPatientList);

            // 新規患者登録フォームのイベント
            document.getElementById('newPatientForm')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('newPatientName')?.value.trim();
                const birthdate = document.getElementById('newPatientBirthdate')?.value;
                const phone = utils.getPhoneValue('newPatientPhone');
                if (!name) {
                    alert('お名前を入力してください');
                    return;
                }
                if (!birthdate) {
                    alert('生年月日を入力してください');
                    return;
                }
                if (utils.isPhoneIncomplete('newPatientPhone')) {
                    alert('電話番号は3つの欄に分けて入力してください');
                    return;
                }
                if (!phone) {
                    alert('電話番号を入力してください');
                    return;
                }

                // 新規アカウントを作成
                const newAccount = {
                    id: utils.generateId('account'),
                    name: name,
                    kana: document.getElementById('newPatientKana')?.value.trim() || '',
                    birthdate: birthdate,
                    phone: phone,
                    email: document.getElementById('newPatientEmail')?.value.trim() || '',
                    patient_id: null,
                    patient_no: '',
                    members: [],
                    documents: {}
                };
                const duplicate = findDuplicateLocalPatient(newAccount);
                if (duplicate) {
                    alert(duplicateLocalPatientMessage(duplicate));
                    selectPatientCandidate({
                        id: duplicate.id,
                        accountId: duplicate.accountId
                    });
                    this.renderConfirmation();
                    this.showStep(4);
                    return;
                }

                state.accounts.push(newAccount);
                selectPatientCandidate({ id: `${newAccount.id}__self`, accountId: newAccount.id });
                accountStore.save(state.accounts);

                try {
                    await syncAccountPatientToServer(newAccount);
                    accountStore.save(state.accounts);
                } catch (error) {
                    if (error.status === 409) {
                        state.accounts = state.accounts.filter(account => account.id !== newAccount.id);
                        ensureSelectedPatientSelection(this.getAllPatientCandidates());
                        accountStore.save(state.accounts);
                        alert(getErrorMessage(error, '患者様情報の同期に失敗しました'));
                        return;
                    }
                    console.warn('患者様情報のサーバー同期に失敗しました:', error);
                }

                this.renderConfirmation();
                this.showStep(4);
            });
            this.renderSameDayAddOnContainer({ loading: addOnCandidates.length > 0 });
            this.loadSameDayAddOnRecommendations();
            return;
        }

        // 1人だけの場合は自動選択
        if (candidates.length === 1) {
            selectPatientCandidate(candidates[0]);
        }

        // 現在選択中の候補がない場合は最初の候補を選択
        ensureSelectedPatientSelection(candidates);

        elements.reservationPatientList.innerHTML = `
            <div class="reservation-selection-info">
                <p><strong>診療科:</strong> ${utils.escapeHTML(state.selectedDepartment.name)}</p>
                ${menuInfoRow}
                <p><strong>日時:</strong> ${utils.formatDisplayDate(selectedDate)} ${utils.formatJapaneseTime(state.selectedSlot.start_time)} - ${utils.formatJapaneseTime(this.selectedSlotEndTime())}</p>
            </div>
            <div class="patient-select-heading">
                <p class="section-kicker">受診者</p>
                <h3>だれが受診しますか？</h3>
            </div>
            <div class="patient-choice-dropdown">
                <select id="reservationPatientSelect" class="patient-select">
                    ${candidates.map(candidate => `
                        <option value="${utils.escapeHTML(candidate.id)}" data-account-id="${utils.escapeHTML(candidate.accountId)}" ${candidate.id === state.selectedPatientMemberId ? 'selected' : ''}>
                            ${utils.escapeHTML(candidate.name)}　${candidate.birthdate ? utils.formatAge(candidate.birthdate) : ''}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div class="patient-add-link" style="margin-top: 12px; text-align: center;">
                <a href="#" id="goToAddPatient" style="color: var(--primary); text-decoration: underline; font-size: 14px;">他の人で受診する（新規登録）</a>
            </div>
            <div class="form-actions" style="margin-top: 16px;">
                <button type="button" class="btn-primary" id="proceedToConfirm">確認画面へ進む</button>
            </div>
        `;

        // 患者選択イベント
        const patientSelect = document.getElementById('reservationPatientSelect');
        if (patientSelect) {
            patientSelect.addEventListener('change', () => {
                const selectedOption = patientSelect.options[patientSelect.selectedIndex];
                selectPatientCandidate({
                    id: patientSelect.value,
                    accountId: selectedOption.dataset.accountId
                });
            });
        }

        // 新規登録リンク
        document.getElementById('goToAddPatient')?.addEventListener('click', (e) => {
            e.preventDefault();
            // 予約フローから設定ページに遷移し、登録後に戻ってくるフラグを設定
            state.returnToReservationAfterPatientAdd = true;
            pageController.switchPage('settings');
            // 新規登録フォームを開く
            document.getElementById('settingsNewPatientForm')?.classList.remove('hidden');
        });

        // 確認画面へ進むボタン
        document.getElementById('proceedToConfirm')?.addEventListener('click', () => {
            ensureSelectedPatientSelection(candidates);
            this.renderConfirmation();
            this.showStep(4);
        });
        this.renderSameDayAddOnContainer({ loading: addOnCandidates.length > 0 });
        this.loadSameDayAddOnRecommendations();
    },

    getSelectedPatientMember() {
        // 予約フローでは全アカウントから候補を取得
        const candidates = this.getAllPatientCandidates();
        return ensureSelectedPatientSelection(candidates);
    },

    buildReservationPayload() {
        const account = this.getSelectedAccount();
        const patient = this.getSelectedPatientMember();
        const clinic = state.clinics.find(c => c.id === state.currentClinicId);
        const departmentApiId = getDepartmentApiId(state.selectedDepartment);

        if (!account || !patient) {
            throw new Error('受診者を選択してください');
        }
        if (!patient.patient_id) {
            throw new Error('患者様情報の同期が完了していません');
        }

        const optional = {};
        if (patient.kana) optional.patient_name_kana = patient.kana;
        if (account.email) optional.patient_email = account.email;
        if (patient.birthdate) optional.patient_birthdate = patient.birthdate;

        const documentStatusText = this.getDocumentStatusText(patient.documents);
        const treatmentLabel = this.selectedTreatmentDisplayLabel();
        const treatmentPrice = this.selectedTreatmentPriceLabel();
        const symptomLines = [
            clinic?.name ? `クリニック: ${clinic.name}` : '',
            `マイページ登録者: ${account.name}`,
            `受診者: ${patient.name}`
        ];
        if (treatmentLabel) {
            symptomLines.push(`メニュー: ${treatmentLabel}`);
        }
        if (treatmentPrice) {
            symptomLines.push(`料金: ${treatmentPrice}`);
        }
        const addOnSummaries = this.selectedSameDayAddOnSummaries();
        if (addOnSummaries.length) {
            symptomLines.push(`同日追加施術: ${addOnSummaries.join('、')}`);
        }
        symptomLines.push(documentStatusText);

        const payload = {
            slot_id: state.selectedSlot.id,
            facility_id: CONFIG.FACILITY_ID,
            clinic_id: state.currentClinicId || null,
            clinic_name: clinic?.name || null,
            department_id: departmentApiId || state.selectedDepartment?.id || null,
            department_name: state.selectedDepartment?.name || '',
            reservation_date: state.selectedSlot?.date || state.selectedDate || '',
            start_time: state.selectedSlot?.start_time || '',
            end_time: this.selectedSlotEndTime(),
            max_bookings: Number(state.selectedSlot?.max_bookings || state.selectedSlot?.capacity || 1),
            treatment_menu: state.selectedTreatmentMenu?.code || null,
            treatment_menu_label: state.selectedTreatmentMenu?.label || null,
            treatment_resource_type: getPrimaryTreatmentResourceType(state.selectedTreatmentMenu),
            treatment_menu_capacity: Number(state.selectedTreatmentMenu?.menu_capacity || state.selectedTreatmentMenu?.menuCapacity || 1),
            treatment_detail_menu: state.selectedTreatmentOption?.id || null,
            treatment_detail_menu_label: state.selectedTreatmentOption?.label || null,
            treatment_detail_price: treatmentPrice || null,
            treatment_display_label: treatmentLabel || state.selectedTreatmentMenu?.label || null,
            treatment_duration_minutes: this.selectedTreatmentDurationMinutes(),
            treatment_equipment_bookings: this.selectedTreatmentEquipmentBookings(),
            patient_id: patient.patient_id,
            patient_name: patient.name,
            patient_phone: account.phone,
            google_patient_token: googleAuth.loadToken() || null,
            line_patient_token: lineAuth.loadToken() || null,
            symptoms: symptomLines.filter(Boolean).join('\n'),
            ...optional
        };

        state.patientInfo = {
            patient_id: patient.patient_id,
            patient_no: patient.patient_no,
            patient_name: patient.name,
            patient_phone: account.phone,
            patient_email: account.email,
            patient_birthdate: patient.birthdate
        };

        return payload;
    },

    getReservationConfirmationItems() {
        return {
            common: COMMON_CONFIRMATION_ITEMS,
            treatment: utils.uniqueList([
                ...utils.treatmentConfirmationNotes(state.selectedTreatmentMenu),
                ...utils.treatmentDetailConfirmationNotes(state.selectedTreatmentOption),
                ...this.selectedSameDayAddOns().flatMap(addOn => [
                    ...utils.treatmentConfirmationNotes(addOn.menu),
                    ...utils.treatmentDetailConfirmationNotes(addOn.option)
                ])
            ])
        };
    },

    renderConfirmationList(items = []) {
        if (!items.length) {
            return '<p class="confirm-notice-empty">この施術の追加確認事項はありません。</p>';
        }
        return `
            <ul class="confirmation-check-list">
                ${items.map(item => `<li>${utils.escapeHTML(item)}</li>`).join('')}
            </ul>
        `;
    },

    syncConfirmationAgreement() {
        const submitBtn = document.getElementById('submitReservation');
        const agreement = document.getElementById('reservationConfirmAgreement');
        if (!submitBtn || !agreement) return;
        submitBtn.disabled = !agreement.checked;
        submitBtn.textContent = agreement.checked ? '予約を確定する' : '確認事項に同意してください';
    },

    renderConfirmation() {
        elements.reservationSummary?.classList.add('hidden');
        if (elements.reservationSummary) {
            elements.reservationSummary.innerHTML = '';
        }

        const account = this.getSelectedAccount();
        const patient = this.getSelectedPatientMember();
        const selectedDate = new Date(state.selectedDate);
        const documentStatusText = this.getDocumentStatusText(patient?.documents);
        const treatmentLabel = this.selectedTreatmentDisplayLabel();
        const priceLabel = this.selectedTreatmentPriceLabel();
        const confirmationItems = this.getReservationConfirmationItems();
        const treatmentLine = treatmentLabel
            ? `<br>${utils.escapeHTML(treatmentLabel)}${priceLabel ? `<br><span class="confirm-subtext">${utils.escapeHTML(priceLabel)}</span>` : ''}`
            : '';

        elements.confirmCard.innerHTML = `
            <div class="confirm-section">
                <div class="confirm-section-title">予約内容</div>
                <div class="confirm-section-content">
                    ${utils.escapeHTML(state.selectedDepartment.name)}${treatmentLine}<br>
                    ${utils.formatDisplayDate(selectedDate)} ${utils.escapeHTML(state.selectedSlot.start_time)} - ${utils.escapeHTML(this.selectedSlotEndTime())}
                </div>
            </div>
            <div class="confirm-section">
                <div class="confirm-section-title">受診者</div>
                <div class="confirm-section-content">
                    ${utils.escapeHTML(patient?.name || '')}<br>
                    ${utils.escapeHTML(account?.phone || '')}
                    ${patient?.birthdate ? `<br><span class="confirm-subtext">${utils.escapeHTML(patient.birthdate)}（${utils.calcAge(patient.birthdate)}歳）</span>` : ''}
                </div>
            </div>
            <div class="confirm-section">
                <div class="confirm-section-title">写真登録</div>
                <div class="confirm-section-content">
                    ${utils.escapeHTML(documentStatusText)}
                </div>
            </div>
            <div class="confirm-section confirm-caution-section">
                <div class="confirm-section-title">注意事項</div>
                <div class="confirm-section-content confirm-notice-content">
                    <p class="confirm-notice-lead">以下を確認してから予約を確定してください。</p>
                    ${this.renderConfirmationList(confirmationItems.common)}
                </div>
            </div>
            <div class="confirm-section confirm-caution-section">
                <div class="confirm-section-title">施術別の確認事項</div>
                <div class="confirm-section-content confirm-notice-content">
                    ${this.renderConfirmationList(confirmationItems.treatment)}
                </div>
            </div>
            <label class="confirmation-agreement" for="reservationConfirmAgreement">
                <input type="checkbox" id="reservationConfirmAgreement">
                <span>上記の注意事項・確認事項をすべて確認し、同意しました。</span>
            </label>
        `;

        const submitBtn = document.getElementById('submitReservation');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '確認事項に同意してください';
        }
        document.getElementById('reservationConfirmAgreement')?.addEventListener('change', () => this.syncConfirmationAgreement());
        this.syncConfirmationAgreement();
    },

    resetAfterReservationActionsUI() {
        const questionnaireCard = document.getElementById('questionnaireTaskCard');
        const insuranceCard = document.getElementById('insuranceTaskCard');
        const openQuestionnaire = document.getElementById('openQuestionnaire');
        const uploadButton = document.getElementById('uploadInsuranceCard');
        const insuranceInput = document.getElementById('insuranceCardInput');

        questionnaireCard?.classList.remove('completed', 'muted');
        insuranceCard?.classList.remove('completed', 'muted');
        elements.questionnaireTaskStatus.textContent = '未回答';
        elements.insuranceTaskStatus.textContent = '未登録';
        elements.questionnairePanel?.classList.add('hidden');
        if (elements.questionnaireForm) elements.questionnaireForm.innerHTML = '';
        if (openQuestionnaire) {
            openQuestionnaire.disabled = true;
            openQuestionnaire.textContent = '問診票確認中';
        }
        elements.insurancePreview?.classList.add('hidden');
        if (elements.insurancePreviewImage) elements.insurancePreviewImage.removeAttribute('src');
        if (insuranceInput) insuranceInput.value = '';
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = '保険証を登録';
        }
        this.renderGoogleReviewCard();
    },

    async prepareAfterReservationActions() {
        this.renderGoogleReviewCard();
        this.prepareInsuranceTask();
        const departmentApiId = await ensureDepartmentApiId(state.selectedDepartment).catch(error => {
            console.error('Questionnaire department resolve error:', error);
            return null;
        });
        state.questionnaire = departmentApiId ? await api.fetchQuestionnaire(departmentApiId) : null;

        const questionnaireCard = document.getElementById('questionnaireTaskCard');
        const openQuestionnaire = document.getElementById('openQuestionnaire');

        if (!state.questionnaire || !state.questionnaire.items?.length) {
            elements.questionnaireTaskStatus.textContent = '対象なし';
            questionnaireCard.classList.add('muted');
            openQuestionnaire.disabled = true;
            openQuestionnaire.textContent = '問診票なし';
            return;
        }

        elements.questionnaireTaskStatus.textContent = '未回答';
        questionnaireCard.classList.remove('muted');
        openQuestionnaire.disabled = false;
        openQuestionnaire.textContent = '問診記入';
        this.renderQuestionnaireForm();
    },

    prepareInsuranceTask() {
        const insuranceCard = document.getElementById('insuranceTaskCard');
        const uploadButton = document.getElementById('uploadInsuranceCard');
        if (!insuranceCard || !elements.insuranceTaskStatus) return;

        if (state.insuranceUploaded) {
            elements.insuranceTaskStatus.textContent = '登録済';
            insuranceCard.classList.add('completed');
            if (uploadButton) {
                uploadButton.disabled = false;
                uploadButton.textContent = '再登録';
            }
            return;
        }

        elements.insuranceTaskStatus.textContent = state.insuranceCardData ? '選択済' : '未登録';
        insuranceCard.classList.remove('completed');
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = '保険証を登録';
        }
    },

    renderQuestionnaireForm() {
        const questionnaire = state.questionnaire;
        if (!questionnaire) return;

        elements.questionnaireTitle.textContent = questionnaire.name || '問診票';

        const fields = questionnaire.items.map(item => {
            const id = `q-${item.id}`;
            const label = utils.escapeHTML(item.label || item.custom_label || '質問');
            const required = item.is_required ? '<span class="required">必須</span>' : '';
            const description = item.description
                ? `<p class="questionnaire-description">${utils.escapeHTML(item.description)}</p>`
                : '';
            const placeholder = utils.escapeHTML(item.placeholder || '');
            const name = utils.escapeHTML(item.id);
            const options = Array.isArray(item.options) ? item.options : [];

            let input = '';
            if (item.item_type === 'custom_description') {
                input = `<div class="questionnaire-note">${description || label}</div>`;
            } else if (item.item_type === 'radio') {
                input = `<div class="questionnaire-options">
                    ${options.map((opt, index) => `
                        <label class="questionnaire-option">
                            <input type="radio" name="${name}" value="${utils.escapeHTML(opt)}" ${item.is_required && index === 0 ? 'required' : ''}>
                            <span>${utils.escapeHTML(opt)}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else if (item.item_type === 'checkbox_multi') {
                input = `<div class="questionnaire-options">
                    ${options.map(opt => `
                        <label class="questionnaire-option">
                            <input type="checkbox" name="${name}" value="${utils.escapeHTML(opt)}">
                            <span>${utils.escapeHTML(opt)}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else if (item.item_type === 'yesno_text') {
                input = `
                    <div class="questionnaire-options compact">
                        <label class="questionnaire-option"><input type="radio" name="${name}__choice" value="なし" checked><span>なし</span></label>
                        <label class="questionnaire-option"><input type="radio" name="${name}__choice" value="あり"><span>あり</span></label>
                    </div>
                    <textarea name="${name}__text" rows="3" placeholder="ありの場合は内容をご記入ください"></textarea>
                `;
            } else if (item.item_type === 'address') {
                input = `<textarea id="${id}" name="${name}" rows="3" ${item.is_required ? 'required' : ''} placeholder="${placeholder || '住所を入力してください'}"></textarea>`;
            } else if (item.item_type === 'date' || item.item_type === 'custom_date') {
                input = `<input id="${id}" type="date" name="${name}" ${item.is_required ? 'required' : ''}>`;
            } else if (item.item_type === 'number') {
                input = `<input id="${id}" type="number" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            } else if (item.item_type === 'tel') {
                input = `<input id="${id}" type="tel" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            } else {
                input = `<input id="${id}" type="text" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            }

            return `
                <div class="form-group questionnaire-field" data-item-id="${name}">
                    <label for="${id}">${label} ${required}</label>
                    ${description}
                    ${input}
                </div>
            `;
        }).join('');

        elements.questionnaireForm.innerHTML = `
            ${fields}
            <button type="submit" class="btn-primary">問診を送信</button>
        `;
    },

    collectQuestionnaireResponses() {
        const responses = {};
        state.questionnaire.items.forEach(item => {
            const key = item.id;
            if (item.item_type === 'checkbox_multi') {
                responses[key] = Array.from(elements.questionnaireForm.querySelectorAll(`[name="${key}"]:checked`))
                    .map(input => input.value);
            } else if (item.item_type === 'yesno_text') {
                responses[key] = {
                    choice: elements.questionnaireForm.querySelector(`[name="${key}__choice"]:checked`)?.value || '',
                    text: elements.questionnaireForm.querySelector(`[name="${key}__text"]`)?.value || ''
                };
            } else if (item.item_type !== 'custom_description') {
                responses[key] = elements.questionnaireForm.querySelector(`[name="${key}"]`)?.value || '';
            }
        });
        return responses;
    },

    validateQuestionnaireResponses(responses) {
        const missingItem = state.questionnaire.items.find(item => {
            if (!item.is_required || item.item_type === 'custom_description') return false;
            const value = responses[item.id];
            if (Array.isArray(value)) return value.length === 0;
            if (value && typeof value === 'object') {
                return !String(value.choice || '').trim() && !String(value.text || '').trim();
            }
            return !String(value ?? '').trim();
        });
        if (!missingItem) return '';
        return `${missingItem.label || missingItem.custom_label || '必須項目'}を入力してください`;
    },

    async submitQuestionnaire() {
        if (!state.questionnaire || state.questionnaireCompleted) return;
        if (elements.questionnaireForm.reportValidity && !elements.questionnaireForm.reportValidity()) return;

        const responses = this.collectQuestionnaireResponses();
        const validationMessage = this.validateQuestionnaireResponses(responses);
        if (validationMessage) {
            alert(validationMessage);
            return;
        }

        const submitBtn = elements.questionnaireForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';

        try {
            const result = await api.submitQuestionnaire(state.questionnaire.id, responses);
            state.questionnaireCompleted = true;
            if (state.reservationResult) {
                state.reservationResult.questionnaire_response_id = result?.id || null;
                state.reservationResult.questionnaire_status = 'completed';
            }
            elements.questionnaireTaskStatus.textContent = '回答済';
            document.getElementById('questionnaireTaskCard').classList.add('completed');
            elements.questionnairePanel.classList.add('hidden');

            // LocalStorageの予約データの問診票ステータスも更新
            if (state.reservationResult?.reservation_number) {
                reservationStore.updateQuestionnaireStatus(
                    state.reservationResult.reservation_number,
                    true,
                    result?.id || null
                );
            }
        } catch (error) {
            alert(getErrorMessage(error, '問診回答の保存に失敗しました'));
            submitBtn.disabled = false;
            submitBtn.textContent = '問診を送信';
        }
    },

    handleInsuranceCardFile(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('画像ファイルを選択してください');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            state.insuranceCardData = {
                file_name: file.name,
                content_type: file.type,
                data_url: reader.result
            };
            state.insuranceUploaded = false;
            elements.insurancePreviewImage.src = reader.result;
            elements.insurancePreview.classList.remove('hidden');
            elements.insuranceTaskStatus.textContent = '選択済';
            document.getElementById('insuranceTaskCard')?.classList.remove('completed');
            const uploadButton = document.getElementById('uploadInsuranceCard');
            if (uploadButton) {
                uploadButton.disabled = false;
                uploadButton.textContent = '保険証を登録';
            }
        };
        reader.readAsDataURL(file);
    },

    async uploadInsuranceCard() {
        if (!state.insuranceCardData) {
            alert('保険証画像を選択してください');
            return;
        }
        if (!state.reservationResult?.id) {
            alert('予約IDが取得できないため、保険証を登録できません');
            return;
        }

        const uploadButton = document.getElementById('uploadInsuranceCard');
        uploadButton.disabled = true;
        uploadButton.textContent = '登録中...';

        try {
            const result = await api.uploadInsuranceCard();
            state.insuranceUploaded = true;
            if (state.reservationResult) {
                state.reservationResult.insurance_card_id = result?.id || null;
                state.reservationResult.insurance_card_status = 'uploaded';
            }
            state.insuranceCardData = null;
            elements.insuranceTaskStatus.textContent = '登録済';
            document.getElementById('insuranceTaskCard').classList.add('completed');
            elements.insurancePreview.classList.add('hidden');
            uploadButton.disabled = false;
            uploadButton.textContent = '再登録';
            const input = document.getElementById('insuranceCardInput');
            if (input) input.value = '';
            if (state.reservationResult?.reservation_number) {
                reservationStore.updateInsuranceStatus(
                    state.reservationResult.reservation_number,
                    true,
                    result?.id || null
                );
            }
        } catch (error) {
            alert(getErrorMessage(error, '保険証画像の登録に失敗しました'));
            uploadButton.disabled = false;
            uploadButton.textContent = '保険証を登録';
        }
    },

    async uploadSelectedPatientDocuments() {
        const owner = this.getPatientOwner();
        const documents = owner?.documents || {};
        const uploads = DOCUMENT_TYPES
            .filter(documentType => documents[documentType.key]?.data_url)
            .map(async documentType => {
                await api.uploadReservationAttachment(documentType.key, documents[documentType.key]);
                return documentType.key;
            });

        if (!uploads.length) return [];
        const uploadedTypes = await Promise.all(uploads);
        if (uploadedTypes.includes('insurance_card')) {
            state.insuranceUploaded = true;
        }
        return uploadedTypes;
    },

    async submitReservation() {
        const submitBtn = document.getElementById('submitReservation');
        const agreement = document.getElementById('reservationConfirmAgreement');
        if (!agreement?.checked) {
            alert('注意事項・確認事項を確認し、チェックを入れてください。');
            ui.syncConfirmationAgreement();
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';

        try {
            await ui.ensureSelectedPatientSynced();
            await ui.ensureSelectedSameDayAddOnsAvailable();
            const data = ui.buildReservationPayload();

            const result = await api.createReservation(data);
            state.reservationResult = result;
            state.questionnaire = null;
            state.questionnaireCompleted = false;
            state.insuranceCardData = null;
            state.insuranceUploaded = false;
            ui.resetAfterReservationActionsUI();

            let documentSyncMessage = '';
            try {
                await ui.uploadSelectedPatientDocuments();
            } catch (documentError) {
                console.error('Document sync error:', documentError);
                documentSyncMessage = '<div class="reservation-sync-warning">保険証・医療証の一部を同期できませんでした。管理画面で再確認してください。</div>';
            }

            // 予約をローカルストレージに保存
            const selectedClinic = state.clinics.find(c => c.id === state.currentClinicId);
            const treatmentDisplayLabel = ui.selectedTreatmentDisplayLabel();
            const syncedPatient = ui.getSelectedPatientMember();
            const departmentApiId = getDepartmentApiId(state.selectedDepartment);
            reservationStore.add({
                id: result.id,
                reservation_number: result.reservation_number,
                clinic_id: result.clinic_id || state.currentClinicId,
                clinic_name: result.clinic_name || selectedClinic?.name || '',
                facility_id: CONFIG.FACILITY_ID,
                slot_id: data.slot_id,
                department_id: departmentApiId || state.selectedDepartment.id,
                department_name: result.department_name,
                treatment_menu: result.treatment_menu || state.selectedTreatmentMenu?.code || null,
                treatment_menu_label: result.treatment_menu_label || state.selectedTreatmentMenu?.label || '',
                treatment_detail_menu: state.selectedTreatmentOption?.id || null,
                treatment_detail_menu_label: state.selectedTreatmentOption?.label || '',
                treatment_detail_price: ui.selectedTreatmentPriceLabel() || '',
                treatment_display_label: treatmentDisplayLabel,
                treatment_resource_type: result.treatment_resource_type || getPrimaryTreatmentResourceType(state.selectedTreatmentMenu),
                reservation_date: result.reservation_date,
                start_time: result.start_time,
                end_time: result.end_time,
                max_bookings: data.max_bookings || 1,
                patient_name: result.patient_name || state.patientInfo.patient_name || syncedPatient?.name || '',
                patient_name_kana: data.patient_name_kana || '',
                patient_phone: result.patient_phone || state.patientInfo.patient_phone,
                patient_email: result.patient_email || state.patientInfo.patient_email || '',
                patient_birthdate: result.patient_birthdate || state.patientInfo.patient_birthdate || '',
                patient_id: result.patient_id || state.patientInfo.patient_id || syncedPatient?.patient_id || null,
                patient_no: result.patient_no || state.patientInfo.patient_no || syncedPatient?.patient_no || '',
                status: 'confirmed',
                symptoms: data.symptoms || '',
                questionnaire_completed: false,
                insurance_uploaded: state.insuranceUploaded
            });

            const completeTreatmentLabel = treatmentDisplayLabel || result.treatment_menu_label || state.selectedTreatmentMenu?.label || '';
            const completeTreatmentPrice = ui.selectedTreatmentPriceLabel() || '';
            const completeTreatmentRow = completeTreatmentLabel ? `
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">メニュー</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(completeTreatmentLabel)}</span>
                </div>
                ${completeTreatmentPrice ? `
                    <div class="reservation-summary-row">
                        <span class="reservation-summary-label">料金</span>
                        <span class="reservation-summary-value">${utils.escapeHTML(completeTreatmentPrice)}</span>
                    </div>
                ` : ''}
            ` : '';

            // 完了画面表示
            document.getElementById('completeDetails').innerHTML = `
                ${selectedClinic?.name ? `
                    <div class="reservation-summary-row">
                        <span class="reservation-summary-label">クリニック</span>
                        <span class="reservation-summary-value">${utils.escapeHTML(selectedClinic.name)}</span>
                    </div>
                ` : ''}
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">診療科</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(result.department_name)}</span>
                </div>
                ${completeTreatmentRow}
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">日時</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(result.reservation_date)} ${utils.formatJapaneseTime(result.start_time)} - ${utils.formatJapaneseTime(result.end_time)}</span>
                </div>
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">お名前</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(result.patient_name)}</span>
                </div>
                ${documentSyncMessage}
            `;

            await ui.prepareAfterReservationActions();
            ui.showStep(5);

        } catch (error) {
            alert(getErrorMessage(error, '予約の作成に失敗しました'));
            submitBtn.disabled = false;
            submitBtn.textContent = '予約を確定する';
        }
    },

    showCheckModal() {
        if (!elements.checkModal || !elements.checkResult) return;
        elements.checkModal.classList.remove('hidden');
        elements.checkResult.classList.add('hidden');
    },

    hideCheckModal() {
        if (!elements.checkModal || !elements.checkResult) return;
        elements.checkModal.classList.add('hidden');
        const checkNumber = document.getElementById('checkNumber');
        const checkPhone = document.getElementById('checkPhone');
        if (checkNumber) checkNumber.value = '';
        if (utils.getPhoneParts('checkPhone')) {
            utils.setPhoneParts('checkPhone', '');
        } else if (checkPhone) {
            checkPhone.value = '';
        }
        elements.checkResult.classList.add('hidden');
    },

    async checkReservation() {
        const number = document.getElementById('checkNumber')?.value.trim() || '';
        const phone = utils.getPhoneValue('checkPhone') || document.getElementById('checkPhone')?.value.trim() || '';

        if (!number || !phone) {
            alert('予約番号と電話番号を入力してください');
            return;
        }

        try {
            const localReservation = String(number || '').startsWith('L')
                ? reservationStore.getByNumber(number)
                : null;
            if (localReservation && utils.phoneDigits(localReservation.patient_phone) !== utils.phoneDigits(phone)) {
                throw new Error('予約が見つかりません');
            }
            const result = localReservation || await api.checkReservation(number, phone);
            const treatmentLabel = ui.reservationTreatmentDisplayLabel(result);
            const treatmentPrice = result.treatment_detail_price || '';
            const treatmentRow = treatmentLabel ? `
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">メニュー</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(treatmentLabel)}</span>
                </div>
                ${treatmentPrice ? `
                    <div class="reservation-summary-row">
                        <span class="reservation-summary-label">料金</span>
                        <span class="reservation-summary-value">${utils.escapeHTML(treatmentPrice)}</span>
                    </div>
                ` : ''}
            ` : '';
            const clinicRow = result.clinic_name ? `
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">クリニック</span>
                    <span class="reservation-summary-value">${utils.escapeHTML(result.clinic_name)}</span>
                </div>
            ` : '';
            elements.checkResult.classList.remove('hidden', 'error');
            elements.checkResult.innerHTML = `
                ${clinicRow}
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">診療科</span>
                    <span class="reservation-summary-value">${result.department_name}</span>
                </div>
                ${treatmentRow}
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">日時</span>
                    <span class="reservation-summary-value">${result.reservation_date} ${utils.formatJapaneseTime(result.start_time)}</span>
                </div>
                <div class="reservation-summary-row">
                    <span class="reservation-summary-label">ステータス</span>
                    <span class="reservation-summary-value">${result.status === 'confirmed' ? '確定' : result.status === 'cancelled' ? 'キャンセル済み' : result.status}</span>
                </div>
                ${result.status === 'confirmed' ? `
                <button class="btn-back" style="margin-top: 12px; width: 100%;" onclick="handlers.cancelReservation('${result.reservation_number}', '${phone}')">
                    この予約をキャンセルする
                </button>
                ` : ''}
            `;
        } catch (error) {
            elements.checkResult.classList.remove('hidden');
            elements.checkResult.classList.add('error');
            elements.checkResult.textContent = error.message || '予約が見つかりません';
        }
    }
};

// イベントハンドラー
const handlers = {
    async cancelReservation(number, phone) {
        if (!confirm('この予約をキャンセルしますか？')) return;

        try {
            if (String(number || '').startsWith('L')) {
                reservationStore.remove(number);
                alert('予約をキャンセルしました');
                ui.hideCheckModal();
                pageController.renderMypageReservations();
                pageController.renderSettingsReservations();
                return;
            }
            await api.cancelReservation(number, phone);
            reservationStore.remove(number);
            alert('予約をキャンセルしました');
            ui.hideCheckModal();
            pageController.renderMypageReservations();
            pageController.renderSettingsReservations();
        } catch (error) {
            alert(error.message || 'キャンセルに失敗しました');
        }
    },

    async cancelLocalReservation(number, phone) {
        if (!confirm('この予約をキャンセルしますか？')) return;

        try {
            if (String(number || '').startsWith('L')) {
                reservationStore.remove(number);
                alert('予約をキャンセルしました');
                pageController.renderMypageReservations();
                pageController.renderSettingsReservations();
                return;
            }
            await api.cancelReservation(number, phone);
            reservationStore.remove(number);
            alert('予約をキャンセルしました');
            pageController.renderMypageReservations();
            pageController.renderSettingsReservations();
        } catch (error) {
            // サーバーで見つからない場合（既にキャンセル済み等）はローカルからも削除
            if (error.message && (error.message.includes('見つかりません') || error.message.includes('not found'))) {
                reservationStore.remove(number);
                alert('予約を削除しました（サーバー上では既にキャンセル済みでした）');
                pageController.renderMypageReservations();
                pageController.renderSettingsReservations();
            } else {
                alert(error.message || 'キャンセルに失敗しました');
            }
        }
    }
};

// ページコントローラー
const pageController = {
    currentPage: 'mypage',

    switchPage(pageName) {
        this.currentPage = pageName;

        // ページ切り替え
        document.querySelectorAll('.page').forEach(page => {
            page.classList.add('hidden');
            page.classList.remove('active');
        });
        const targetPage = document.getElementById(`page-${pageName}`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('active');
        }

        // ナビゲーションボタンのアクティブ状態
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });

        // ヘッダータイトル更新
        const pageTitle = document.getElementById('pageTitle');
        const titles = {
            mypage: 'マイページ',
            reservation: '予約',
            settings: '設定'
        };
        if (pageTitle) {
            pageTitle.textContent = titles[pageName] || 'デジスマ診療';
        }

        // ページ別の初期化処理
        if (pageName === 'mypage') {
            this.updateMypagePatientSelect();
            // サーバーと同期してキャンセル済み予約を削除
            this.syncAndRenderReservations('mypage');
        } else if (pageName === 'reservation') {
            ui.loadClinics();
            ui.renderClinics();
            ui.showStep(0);
        } else if (pageName === 'settings') {
            // サーバーと同期してキャンセル済み予約を削除
            this.syncAndRenderReservations('settings');
            this.renderSettingsPatientList();
        }
    },

    // 予約を同期してから描画
    async syncAndRenderReservations(page) {
        try {
            const hasChanges = await reservationStore.syncWithServer();
            if (hasChanges) {
                console.log('Reservations synced with server');
            }
            if (page === 'mypage') {
                await this.syncAuthenticatedCurrentReservations(ui.getAllPatientCandidates());
            }
        } catch (error) {
            console.error('Failed to sync reservations:', error);
        }

        // 同期後に描画
        if (page === 'mypage') {
            this.renderMypageReservations();
            this.renderMypageHistory();
        } else if (page === 'settings') {
            this.renderSettingsReservations();
        }
    },

    getMypageSelectedPatient() {
        const candidates = ui.getAllPatientCandidates();
        if (candidates.length === 0) return null;
        return ensureSelectedPatientSelection(candidates);
    },

    async syncAuthenticatedCurrentReservations(patient) {
        const patients = (Array.isArray(patient) ? patient : [patient]).filter(Boolean);
        if (patients.length === 0) return false;

        const authSources = [
            {
                token: googleAuth.loadToken(),
                sync: () => googleAuth.syncAccounts(state.accounts)
            },
            {
                token: lineAuth.loadToken(),
                sync: () => lineAuth.syncAccounts(state.accounts)
            }
        ].filter(source => source.token);

        for (const source of authSources) {
            try {
                await source.sync();
                let changed = false;
                let fetchedAny = false;
                for (const targetPatient of patients) {
                    try {
                        const serverReservations = await api.fetchCurrentReservations(targetPatient, source.token, {
                            includePast: true,
                            limit: 100
                        });
                        fetchedAny = true;
                        changed = reservationStore.upsertServerReservations(serverReservations) || changed;
                    } catch (patientError) {
                        console.warn('Current reservation sync skipped for patient:', patientError);
                    }
                }
                if (fetchedAny) return changed;
            } catch (error) {
                console.warn('Current reservation sync skipped:', error);
            }
        }

        return false;
    },

    renderMypageReservations() {
        const container = document.getElementById('mypageReservations');
        if (!container) return;

        const patients = ui.getAllPatientCandidates();
        let reservations = reservationStore.getUpcoming(patients);
        if (reservations.length === 0) {
            reservations = reservationStore.getUpcoming();
        }

        if (reservations.length === 0) {
            container.innerHTML = `
                <div class="reservation-empty">
                    <p>現在予約はありません</p>
                </div>
            `;
            return;
        }

        container.innerHTML = reservations.map(r => {
            const questionnaireStatus = r.questionnaire_completed ? '回答済' : '未回答';
            const questionnaireClass = r.questionnaire_completed ? 'completed' : 'pending';
            const clinicRow = r.clinic_name ? `
                    <div class="reservation-info-row">
                        <span class="reservation-label">クリニック</span>
                        <span class="reservation-value">${utils.escapeHTML(r.clinic_name)}</span>
                    </div>
            ` : '';
            const treatmentLabel = ui.reservationTreatmentDisplayLabel(r);
            const treatmentRow = treatmentLabel ? `
                    <div class="reservation-info-row">
                        <span class="reservation-label">メニュー</span>
                        <span class="reservation-value">${utils.escapeHTML(treatmentLabel)}</span>
                    </div>
                    ${r.treatment_detail_price ? `
                        <div class="reservation-info-row">
                            <span class="reservation-label">料金</span>
                            <span class="reservation-value">${utils.escapeHTML(r.treatment_detail_price)}</span>
                        </div>
                    ` : ''}
            ` : '';

            return `
            <div class="mypage-reservation-card">
                <div class="reservation-card-header">
                    <span class="reservation-status confirmed">確定</span>
                </div>
                <div class="reservation-card-body">
                    ${clinicRow}
                    <div class="reservation-info-row">
                        <span class="reservation-label">診療科</span>
                        <span class="reservation-value">${utils.escapeHTML(r.department_name)}</span>
                    </div>
                    ${treatmentRow}
                    <div class="reservation-info-row">
                        <span class="reservation-label">日時</span>
                        <span class="reservation-value">${utils.escapeHTML(r.reservation_date)} ${utils.formatJapaneseTime(r.start_time)}</span>
                    </div>
                    <div class="reservation-info-row">
                        <span class="reservation-label">患者様</span>
                        <span class="reservation-value">${utils.escapeHTML(r.patient_name)}</span>
                    </div>
                    <div class="reservation-info-row">
                        <span class="reservation-label">問診票</span>
                        <span class="reservation-value questionnaire-status ${questionnaireClass}">${questionnaireStatus}</span>
                    </div>
                </div>
                <div class="reservation-card-actions mypage-actions-row">
                    ${!r.questionnaire_completed ? `
                    <button type="button" class="btn-questionnaire"
                            data-reservation-number="${utils.escapeHTML(r.reservation_number)}"
                            data-department-id="${utils.escapeHTML(r.department_id || '')}">
                        問診票を記入
                    </button>
                    ` : ''}
                    <button type="button" class="btn-cancel-reservation"
                            onclick="handlers.cancelLocalReservation('${utils.escapeHTML(r.reservation_number)}', '${utils.escapeHTML(r.patient_phone || '')}')">
                        キャンセル
                    </button>
                </div>
            </div>
        `;
        }).join('');

        // 問診票ボタンのイベントをバインド
        container.querySelectorAll('.btn-questionnaire').forEach(btn => {
            btn.addEventListener('click', () => {
                const reservationNumber = btn.dataset.reservationNumber;
                const departmentId = btn.dataset.departmentId;
                this.openQuestionnaireModal(reservationNumber, departmentId);
            });
        });
    },

    renderSettingsReservations() {
        const container = document.getElementById('settingsReservationList');
        if (!container) return;

        const reservations = reservationStore.getUpcoming();

        if (reservations.length === 0) {
            container.innerHTML = `
                <div class="reservation-empty">
                    <p>予約はありません</p>
                </div>
            `;
            return;
        }

        container.innerHTML = reservations.map(r => {
            const clinicRow = r.clinic_name ? `
                    <div class="reservation-info-row">
                        <span class="reservation-label">クリニック</span>
                        <span class="reservation-value">${utils.escapeHTML(r.clinic_name)}</span>
                    </div>
            ` : '';
            const treatmentLabel = ui.reservationTreatmentDisplayLabel(r);
            const treatmentRow = treatmentLabel ? `
                    <div class="reservation-info-row">
                        <span class="reservation-label">メニュー</span>
                        <span class="reservation-value">${utils.escapeHTML(treatmentLabel)}</span>
                    </div>
                    ${r.treatment_detail_price ? `
                        <div class="reservation-info-row">
                            <span class="reservation-label">料金</span>
                            <span class="reservation-value">${utils.escapeHTML(r.treatment_detail_price)}</span>
                        </div>
                    ` : ''}
            ` : '';

            return `
            <div class="settings-reservation-card">
                <div class="reservation-card-header">
                    <span class="reservation-status confirmed">確定</span>
                </div>
                <div class="reservation-card-body">
                    ${clinicRow}
                    <div class="reservation-info-row">
                        <span class="reservation-label">診療科</span>
                        <span class="reservation-value">${utils.escapeHTML(r.department_name)}</span>
                    </div>
                    ${treatmentRow}
                    <div class="reservation-info-row">
                        <span class="reservation-label">日時</span>
                        <span class="reservation-value">${utils.escapeHTML(r.reservation_date)} ${utils.formatJapaneseTime(r.start_time)}</span>
                    </div>
                    <div class="reservation-info-row">
                        <span class="reservation-label">患者様</span>
                        <span class="reservation-value">${utils.escapeHTML(r.patient_name)}</span>
                    </div>
                </div>
                <div class="reservation-card-actions">
                    <button type="button" class="btn-cancel-reservation"
                            onclick="handlers.cancelLocalReservation('${utils.escapeHTML(r.reservation_number)}', '${utils.escapeHTML(r.patient_phone || '')}')">
                        キャンセル
                    </button>
                </div>
            </div>
            `;
        }).join('');
    },

    updateMypagePatientSelect() {
        const select = document.getElementById('mypagePatientSelect');
        if (!select) return;

        const candidates = ui.getAllPatientCandidates();
        ensureSelectedPatientSelection(candidates);

        select.innerHTML = `
            <option value="">患者様を選択してください</option>
            ${candidates.map(c => `
                <option value="${utils.escapeHTML(c.id)}" data-account-id="${utils.escapeHTML(c.accountId || '')}">
                    ${utils.escapeHTML(c.name)}
                </option>
            `).join('')}
        `;
        select.value = state.selectedPatientMemberId || '';
        if (state.selectedPatientMemberId && select.value !== state.selectedPatientMemberId && candidates.length > 0) {
            const fallback = ensureSelectedPatientSelection(candidates);
            select.value = fallback.id;
        }
        this.renderMypageHistory();
    },

    renderMypageHistory() {
        const historyList = document.getElementById('historyList');
        const mypageActions = document.getElementById('mypageActions');
        const patientSelect = document.getElementById('mypagePatientSelect');
        if (!historyList) return;

        let selectedPatient = this.getMypageSelectedPatient();
        const selectedOption = patientSelect?.selectedOptions?.[0] || null;
        const selectedOptionName = (selectedOption?.textContent || '').trim();
        if (!selectedPatient && selectedOptionName && patientSelect?.value) {
            selectedPatient = {
                id: patientSelect.value,
                accountId: selectedOption?.dataset?.accountId || '',
                name: selectedOptionName,
                phone: ''
            };
        }
        if (selectedPatient && patientSelect && patientSelect.value !== selectedPatient.id) {
            patientSelect.value = selectedPatient.id;
        }

        if (patientSelect && !patientSelect.value) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <p>患者様を選択すると、過去の診療履歴が表示されます。</p>
                </div>
            `;
            state.selectedHistoryVisitKey = null;
            state.selectedPortalAction = null;
            mypageActions?.classList.add('hidden');
            elements.portalContent?.classList.add('hidden');
            return;
        }

        if (!selectedPatient) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <p>患者様を選択すると、過去の診療履歴が表示されます。</p>
                </div>
            `;
            state.selectedHistoryVisitKey = null;
            state.selectedPortalAction = null;
            mypageActions?.classList.add('hidden');
            elements.portalContent?.classList.add('hidden');
            return;
        }

        const today = utils.formatDate(new Date());
        const histories = reservationStore.load()
            .filter(reservation => {
                const reservationDate = String(reservation.reservation_date || '').slice(0, 10);
                return reservationDate
                    && reservationDate < today
                    && reservation.status !== 'cancelled'
                    && reservationStore.matchesPatient(reservation, selectedPatient);
            })
            .sort((a, b) => {
                const dateA = new Date(`${a.reservation_date}T${a.start_time || '00:00'}`);
                const dateB = new Date(`${b.reservation_date}T${b.start_time || '00:00'}`);
                return dateB - dateA;
            });

        if (histories.length === 0) {
            state.selectedHistoryVisitKey = null;
            state.selectedPortalAction = null;
            historyList.innerHTML = `
                <div class="history-empty">
                    <p>この患者様の診療履歴はありません。</p>
                </div>
            `;
            mypageActions?.classList.add('hidden');
            elements.portalContent?.classList.add('hidden');
            return;
        }

        if (!histories.some(history => ui.historyVisitKey(history) === state.selectedHistoryVisitKey)) {
            state.selectedHistoryVisitKey = ui.historyVisitKey(histories[0]);
            state.selectedPortalAction = null;
        }

        historyList.innerHTML = histories.map(history => {
            const visitKey = ui.historyVisitKey(history);
            const treatmentLabel = ui.reservationTreatmentDisplayLabel(history);
            const isSelected = visitKey === state.selectedHistoryVisitKey;
            const timeLabel = ui.formatHistoryVisitTime(history);
            return `
                <button type="button"
                        class="history-item ${isSelected ? 'active' : ''}"
                        data-history-key="${utils.escapeHTML(visitKey)}"
                        aria-pressed="${isSelected ? 'true' : 'false'}">
                    <div class="history-date">${utils.escapeHTML(String(history.reservation_date || '').replaceAll('-', '/'))}</div>
                    <div class="history-content">
                        <span class="history-department">${utils.escapeHTML(history.department_name || '診療')}</span>
                        <span class="history-detail">${utils.escapeHTML(treatmentLabel || history.symptoms || '受診')}</span>
                        ${timeLabel ? `<span class="history-time">${utils.escapeHTML(timeLabel)}</span>` : ''}
                    </div>
                </button>
            `;
        }).join('');

        historyList.querySelectorAll('[data-history-key]').forEach(button => {
            button.addEventListener('click', () => {
                state.selectedHistoryVisitKey = button.dataset.historyKey || null;
                state.selectedPortalAction = null;
                elements.portalContent?.classList.add('hidden');
                const selectedHistory = ui.getSelectedHistoryVisit();
                this.renderMypageHistory();
                ui.showHistoryVisitModal(selectedHistory);
            });
        });

        mypageActions?.classList.add('hidden');
        elements.portalContent?.classList.add('hidden');
    },

    renderSettingsPatientList() {
        const container = document.getElementById('settingsPatientList');
        if (!container) return;

        if (state.accounts.length === 0) {
            container.innerHTML = `
                <div class="patient-empty">
                    <p>登録された患者様はいません</p>
                </div>
            `;
            return;
        }

        const patientCards = [];
        state.accounts.forEach(account => {
            // 本人
            patientCards.push(`
                <div class="patient-management-card">
                    <div class="patient-card-main">
                        <span class="patient-name">${utils.escapeHTML(account.name)}</span>
                        <span class="patient-meta">${account.birthdate || ''} / ${account.phone || ''}</span>
                    </div>
                    <div class="patient-card-actions">
                        <button type="button" class="btn-edit-patient" data-patient-id="${utils.escapeHTML(account.id)}" data-patient-type="account">編集</button>
                        <button type="button" class="btn-delete-patient" data-patient-id="${utils.escapeHTML(account.id)}" data-patient-type="account">削除</button>
                    </div>
                </div>
            `);

            // 家族
            (account.members || []).forEach(member => {
                patientCards.push(`
                    <div class="patient-management-card member">
                        <div class="patient-card-main">
                            <span class="patient-name">${utils.escapeHTML(member.name)}</span>
                            <span class="patient-meta">${member.birthdate || ''}</span>
                        </div>
                        <div class="patient-card-actions">
                            <button type="button" class="btn-edit-patient" data-patient-id="${utils.escapeHTML(member.id)}" data-account-id="${utils.escapeHTML(account.id)}" data-patient-type="member">編集</button>
                            <button type="button" class="btn-delete-patient" data-patient-id="${utils.escapeHTML(member.id)}" data-account-id="${utils.escapeHTML(account.id)}" data-patient-type="member">削除</button>
                        </div>
                    </div>
                `);
            });
        });

        container.innerHTML = patientCards.join('');
        this.bindPatientManagementEvents();
    },

    bindPatientManagementEvents() {
        // 編集ボタン
        document.querySelectorAll('.btn-edit-patient').forEach(btn => {
            btn.addEventListener('click', () => {
                const patientId = btn.dataset.patientId;
                const patientType = btn.dataset.patientType;
                const accountId = btn.dataset.accountId;
                this.openEditModal(patientId, patientType, accountId);
            });
        });

        // 削除ボタン
        document.querySelectorAll('.btn-delete-patient').forEach(btn => {
            btn.addEventListener('click', () => {
                const patientId = btn.dataset.patientId;
                const patientType = btn.dataset.patientType;
                const accountId = btn.dataset.accountId;
                this.deletePatient(patientId, patientType, accountId);
            });
        });
    },

    openEditModal(patientId, patientType, accountId = null) {
        const modal = document.getElementById('editPatientModal');
        if (!modal) return;

        let patient;
        if (patientType === 'account') {
            patient = state.accounts.find(a => a.id === patientId);
        } else {
            const account = state.accounts.find(a => a.id === accountId);
            patient = account?.members?.find(m => m.id === patientId);
        }

        if (!patient) return;

        document.getElementById('editPatientId').value = patientId;
        document.getElementById('editPatientType').value = patientType;
        document.getElementById('editPatientName').value = patient.name || '';
        document.getElementById('editPatientNameKana').value = patient.kana || '';
        utils.setPhoneParts('editPatientPhone', patient.phone || '');
        document.getElementById('editPatientEmail').value = patient.email || '';
        document.getElementById('editPatientBirthdate').value = patient.birthdate || '';

        // accountIdを隠しフィールドに保存
        const form = document.getElementById('editPatientForm');
        form.dataset.accountId = accountId || '';

        modal.classList.remove('hidden');
    },

    closeEditModal() {
        const modal = document.getElementById('editPatientModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    },

    savePatientEdit() {
        const form = document.getElementById('editPatientForm');
        const patientId = document.getElementById('editPatientId').value;
        const patientType = document.getElementById('editPatientType').value;
        const accountId = form.dataset.accountId;

        const data = {
            name: document.getElementById('editPatientName').value.trim(),
            kana: document.getElementById('editPatientNameKana').value.trim(),
            phone: utils.getPhoneValue('editPatientPhone'),
            email: document.getElementById('editPatientEmail').value.trim(),
            birthdate: document.getElementById('editPatientBirthdate').value
        };

        if (!data.name || !data.birthdate) {
            alert('お名前と生年月日は必須です');
            return;
        }
        if (utils.isPhoneIncomplete('editPatientPhone')) {
            alert('電話番号は3つの欄に分けて入力してください');
            return;
        }
        const duplicate = findDuplicateLocalPatient(data, {
            excludePatientId: patientId,
            excludeAccountId: accountId,
            excludePatientType: patientType
        });
        if (duplicate) {
            alert(duplicateLocalPatientMessage(duplicate));
            return;
        }

        if (patientType === 'account') {
            const account = state.accounts.find(a => a.id === patientId);
            if (account) {
                Object.assign(account, data);
            }
        } else {
            const account = state.accounts.find(a => a.id === accountId);
            const member = account?.members?.find(m => m.id === patientId);
            if (member) {
                Object.assign(member, data);
            }
        }

        accountStore.save(state.accounts);
        this.closeEditModal();
        this.renderSettingsPatientList();
        this.updateMypagePatientSelect();
    },

    deletePatient(patientId, patientType, accountId = null) {
        if (!confirm('この患者様情報を削除しますか？')) return;

        if (patientType === 'account') {
            state.accounts = state.accounts.filter(a => a.id !== patientId);
        } else {
            const account = state.accounts.find(a => a.id === accountId);
            if (account && account.members) {
                account.members = account.members.filter(m => m.id !== patientId);
            }
        }

        accountStore.save(state.accounts);
        ensureSelectedPatientSelection(ui.getAllPatientCandidates());
        this.renderSettingsPatientList();
        this.updateMypagePatientSelect();
        ui.renderAccountPanel();
    },

    async createSettingsPatient() {
        const form = document.getElementById('settingsAccountForm');
        const formData = new FormData(form);

        const account = {
            id: utils.generateId('account'),
            type: 'parent',
            name: String(formData.get('name') || '').trim(),
            kana: String(formData.get('kana') || '').trim(),
            phone: utils.getPhoneValue('settingsPatientPhone'),
            email: String(formData.get('email') || '').trim(),
            birthdate: String(formData.get('birthdate') || '').trim(),
            documents: {},
            members: []
        };

        if (utils.isPhoneIncomplete('settingsPatientPhone')) {
            alert('電話番号は3つの欄に分けて入力してください');
            return;
        }
        if (!account.name || !account.phone || !account.birthdate) {
            alert('お名前・電話番号・生年月日を入力してください');
            return;
        }
        const duplicate = findDuplicateLocalPatient(account);
        if (duplicate) {
            alert(duplicateLocalPatientMessage(duplicate));
            selectPatientCandidate({
                id: duplicate.id,
                accountId: duplicate.accountId
            });
            return;
        }

        state.accounts.push(account);
        selectPatientCandidate({ id: `${account.id}__self`, accountId: account.id });
        accountStore.save(state.accounts);

        try {
            await syncAccountPatientToServer(account);
            accountStore.save(state.accounts);
        } catch (error) {
            if (error.status === 409) {
                state.accounts = state.accounts.filter(item => item.id !== account.id);
                ensureSelectedPatientSelection(ui.getAllPatientCandidates());
                accountStore.save(state.accounts);
                alert(getErrorMessage(error, '患者様情報の同期に失敗しました'));
                return;
            }
            console.warn('患者様情報のサーバー同期に失敗しました:', error);
        }

        form.reset();
        document.getElementById('settingsNewPatientForm').classList.add('hidden');
        this.renderSettingsPatientList();
        this.updateMypagePatientSelect();
        ui.renderAccountPanel();

        // 予約フローから来ていた場合は予約ステップ3に戻る
        if (state.returnToReservationAfterPatientAdd) {
            state.returnToReservationAfterPatientAdd = false;
            // 新しく登録したアカウントを選択
            selectPatientCandidate({ id: `${account.id}__self`, accountId: account.id });
            this.switchPage('reservation');
            ui.showStep(3);
        }
    },

    // 問診票モーダル関連
    currentQuestionnaireReservation: null,

    async openQuestionnaireModal(reservationNumber, departmentId) {
        const modal = document.getElementById('questionnaireModal');
        if (!modal) return;

        let reservation = reservationStore.getByNumber(reservationNumber);
        if (!reservation) {
            alert('予約情報が見つかりません');
            return;
        }

        try {
            if (reservation.patient_phone) {
                const serverReservation = await api.checkReservation(
                    reservation.reservation_number,
                    reservation.patient_phone
                );
                const merged = reservationStore.mergeServerReservation(reservation, serverReservation);
                reservationStore.updateReservation(reservation.reservation_number, merged);
                reservation = merged;
            }
        } catch (error) {
            console.error('Reservation refresh error:', error);
        }

        this.currentQuestionnaireReservation = reservation;

        // 問診票を取得
        const formContainer = document.getElementById('mypageQuestionnaireForm');
        const titleEl = document.getElementById('mypageQuestionnaireTitle');

        formContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        modal.classList.remove('hidden');

        try {
            const questionnaire = await api.fetchQuestionnaire(departmentId || reservation.department_id);

            if (!questionnaire || !questionnaire.items?.length) {
                formContainer.innerHTML = '<p class="questionnaire-note">この診療科には問診票がありません。</p>';
                titleEl.textContent = '問診票';
                return;
            }

            state.questionnaire = questionnaire;
            titleEl.textContent = questionnaire.name || '問診票';

            this.renderMypageQuestionnaireForm(questionnaire);
        } catch (error) {
            console.error('Questionnaire load error:', error);
            formContainer.innerHTML = '<p class="questionnaire-error">問診票の取得に失敗しました。</p>';
        }
    },

    renderMypageQuestionnaireForm(questionnaire) {
        const formContainer = document.getElementById('mypageQuestionnaireForm');

        const fields = questionnaire.items.map(item => {
            const id = `mq-${item.id}`;
            const label = utils.escapeHTML(item.label || item.custom_label || '質問');
            const required = item.is_required ? '<span class="required">必須</span>' : '';
            const description = item.description
                ? `<p class="questionnaire-description">${utils.escapeHTML(item.description)}</p>`
                : '';
            const placeholder = utils.escapeHTML(item.placeholder || '');
            const name = utils.escapeHTML(item.id);
            const options = Array.isArray(item.options) ? item.options : [];

            let input = '';
            if (item.item_type === 'custom_description') {
                input = `<div class="questionnaire-note">${description || label}</div>`;
            } else if (item.item_type === 'radio') {
                input = `<div class="questionnaire-options">
                    ${options.map((opt, index) => `
                        <label class="questionnaire-option">
                            <input type="radio" name="${name}" value="${utils.escapeHTML(opt)}" ${item.is_required && index === 0 ? 'required' : ''}>
                            <span>${utils.escapeHTML(opt)}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else if (item.item_type === 'checkbox_multi') {
                input = `<div class="questionnaire-options">
                    ${options.map(opt => `
                        <label class="questionnaire-option">
                            <input type="checkbox" name="${name}" value="${utils.escapeHTML(opt)}">
                            <span>${utils.escapeHTML(opt)}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else if (item.item_type === 'yesno_text') {
                input = `
                    <div class="questionnaire-options compact">
                        <label class="questionnaire-option"><input type="radio" name="${name}__choice" value="なし" checked><span>なし</span></label>
                        <label class="questionnaire-option"><input type="radio" name="${name}__choice" value="あり"><span>あり</span></label>
                    </div>
                    <textarea name="${name}__text" rows="3" placeholder="ありの場合は内容をご記入ください"></textarea>
                `;
            } else if (item.item_type === 'address') {
                input = `<textarea id="${id}" name="${name}" rows="3" ${item.is_required ? 'required' : ''} placeholder="${placeholder || '住所を入力してください'}"></textarea>`;
            } else if (item.item_type === 'date' || item.item_type === 'custom_date') {
                input = `<input id="${id}" type="date" name="${name}" ${item.is_required ? 'required' : ''}>`;
            } else if (item.item_type === 'number') {
                input = `<input id="${id}" type="number" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            } else if (item.item_type === 'tel') {
                input = `<input id="${id}" type="tel" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            } else {
                input = `<input id="${id}" type="text" name="${name}" ${item.is_required ? 'required' : ''} placeholder="${placeholder}">`;
            }

            return `
                <div class="form-group questionnaire-field" data-item-id="${name}">
                    <label for="${id}">${label} ${required}</label>
                    ${description}
                    ${input}
                </div>
            `;
        }).join('');

        formContainer.innerHTML = `
            ${fields}
            <div class="form-actions">
                <button type="button" class="btn-back" id="cancelMypageQuestionnaire">キャンセル</button>
                <button type="submit" class="btn-primary">問診を送信</button>
            </div>
        `;

        // キャンセルボタンのイベント
        document.getElementById('cancelMypageQuestionnaire')?.addEventListener('click', () => {
            this.closeQuestionnaireModal();
        });
    },

    closeQuestionnaireModal() {
        const modal = document.getElementById('questionnaireModal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.currentQuestionnaireReservation = null;
    },

    collectMypageQuestionnaireResponses() {
        const form = document.getElementById('mypageQuestionnaireForm');
        const responses = {};

        state.questionnaire.items.forEach(item => {
            const key = item.id;
            if (item.item_type === 'checkbox_multi') {
                responses[key] = Array.from(form.querySelectorAll(`[name="${key}"]:checked`))
                    .map(input => input.value);
            } else if (item.item_type === 'yesno_text') {
                responses[key] = {
                    choice: form.querySelector(`[name="${key}__choice"]:checked`)?.value || '',
                    text: form.querySelector(`[name="${key}__text"]`)?.value || ''
                };
            } else if (item.item_type !== 'custom_description') {
                responses[key] = form.querySelector(`[name="${key}"]`)?.value || '';
            }
        });

        return responses;
    },

    async submitMypageQuestionnaire() {
        if (!state.questionnaire || !this.currentQuestionnaireReservation) return;

        const form = document.getElementById('mypageQuestionnaireForm');
        if (form?.reportValidity && !form.reportValidity()) return;

        const responses = this.collectMypageQuestionnaireResponses();
        const validationMessage = ui.validateQuestionnaireResponses(responses);
        if (validationMessage) {
            alert(validationMessage);
            return;
        }

        const submitBtn = document.querySelector('#mypageQuestionnaireForm button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '送信中...';
        }

        try {
            const reservation = this.currentQuestionnaireReservation;
            if (!reservation.id) {
                throw new Error('予約情報を同期できないため、問診票を送信できません');
            }
            const result = await api.submitQuestionnaire(state.questionnaire.id, responses, {
                reservationId: reservation.id,
                patientId: reservation.patient_id || null,
                patientPhone: reservation.patient_phone || null
            });

            // 予約の問診票ステータスを更新
            reservationStore.updateQuestionnaireStatus(
                this.currentQuestionnaireReservation.reservation_number,
                true,
                result?.id || null
            );

            alert('問診票を送信しました');
            this.closeQuestionnaireModal();
            this.renderMypageReservations();
        } catch (error) {
            alert(error.message || '問診票の送信に失敗しました');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '問診を送信';
            }
        }
    }
};

// グローバルに公開（HTML内のonclickから呼べるように）
window.handlers = handlers;
window.pageController = pageController;

// 初期化
async function init() {
    if (legacyStorageBridge.isBridgeRequest()) {
        legacyStorageBridge.exportToParent();
        return;
    }

    state.accounts = accountStore.load();
    state.reservations = reservationStore.load();
    if (await legacyStorageBridge.importFromLegacyOrigins()) {
        state.accounts = accountStore.load();
        state.reservations = reservationStore.load();
    }
    utils.bindPhoneInputs(document);
    await ui.loadReviewSettings();
    await lineAuth.loadPublicConfig();
    await lineAuth.consumeRedirectToken();
    await googleAuth.consumeRedirectToken();
    await lineAuth.initLiffSession();
    await lineAuth.refreshSession();
    await googleAuth.refreshSession();
    restoreSelectedPatientSelection(ui.getAllPatientCandidates());

    // クリニック読み込み
    ui.loadClinics();
    ui.renderClinics();

    // 以前選択されていたクリニックがあれば復元
    const savedClinicId = normalizeClinicId(localStorage.getItem(CURRENT_CLINIC_KEY));
    if (savedClinicId && state.clinics.find(c => c.id === savedClinicId)) {
        state.currentClinicId = savedClinicId;
        localStorage.setItem(CURRENT_CLINIC_KEY, savedClinicId);
        const clinic = state.clinics.find(c => c.id === savedClinicId);
        if (elements.clinicName && clinic) {
            elements.clinicName.textContent = clinic.name;
        }
    }
    // 予約フローは必ずクリニック選択画面から開始
    ui.showStep(0);

    if (await reservationStore.syncLocalOnlyToServer()) {
        state.reservations = reservationStore.load();
    }

    // クリニック変更ボタン
    document.getElementById('changeClinicBtn')?.addEventListener('click', () => {
        ui.showStep(0);
    });

    // 下部ナビゲーションイベント
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            pageController.switchPage(item.dataset.page);
        });
    });
    ui.bindPortalActionEvents();

    elements.lineLoginBtn?.addEventListener('click', () => {
        lineAuth.login();
    });
    elements.lineLogoutBtn?.addEventListener('click', () => {
        lineAuth.logout();
    });
    elements.googleLoginBtn?.addEventListener('click', () => {
        googleAuth.login();
    });
    elements.googleLogoutBtn?.addEventListener('click', () => {
        googleAuth.logout();
    });

    pageController.updateMypagePatientSelect();
    pageController.syncAndRenderReservations('mypage');

    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEYS.RESERVATIONS) return;
        state.reservations = reservationStore.load();
        pageController.renderMypageReservations();
        pageController.renderMypageHistory();
        pageController.renderSettingsReservations();
    });

    // マイページ患者選択イベント
    const mypagePatientSelect = document.getElementById('mypagePatientSelect');
    if (mypagePatientSelect) {
        mypagePatientSelect.addEventListener('change', () => {
            const selectedOption = mypagePatientSelect.options[mypagePatientSelect.selectedIndex];
            state.selectedHistoryVisitKey = null;
            state.selectedPortalAction = null;
            elements.portalContent?.classList.add('hidden');
            if (mypagePatientSelect.value) {
                selectPatientCandidate({
                    id: mypagePatientSelect.value,
                    accountId: selectedOption?.dataset.accountId || state.selectedAccountId
                });
            } else {
                state.selectedPatientMemberId = null;
                patientSelectionStore.clear();
            }
            pageController.syncAndRenderReservations('mypage');
            pageController.renderMypageHistory();
        });
    }

    // カレンダーナビゲーションイベント
    document.getElementById('prevWeek')?.addEventListener('click', () => {
        if (state.selectedDepartment && state.weekOffset > 0) {
            state.weekOffset--;
            state.selectedDate = null;
            state.selectedSlot = null;
            ui.clearSameDayAddOns();
            ui.loadCalendar();
        }
    });

    document.getElementById('nextWeek')?.addEventListener('click', () => {
        if (state.selectedDepartment && state.weekOffset < 4) {
            state.weekOffset++;
            state.selectedDate = null;
            state.selectedSlot = null;
            ui.clearSameDayAddOns();
            ui.loadCalendar();
        }
    });

    // 予約ページ内の戻るボタン
    document.getElementById('backToStep1')?.addEventListener('click', () => {
        ui.showStep(1);
    });

    document.getElementById('changeTreatmentMenu')?.addEventListener('click', async () => {
        state.selectedTreatmentMenu = null;
        state.selectedTreatmentOption = null;
        state.selectedDate = null;
        state.selectedSlot = null;
        ui.clearSameDayAddOns();
        await ui.loadCalendar();
        elements.treatmentMenuPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('backToStep2')?.addEventListener('click', () => {
        ui.clearSameDayAddOns();
        ui.showStep(2);
    });

    document.getElementById('backToStep3')?.addEventListener('click', () => {
        ui.showStep(3);
    });

    // 予約確定
    document.getElementById('submitReservation')?.addEventListener('click', ui.submitReservation);

    // 予約後タスク
    document.getElementById('openQuestionnaire')?.addEventListener('click', () => {
        elements.questionnairePanel?.classList.remove('hidden');
    });
    document.getElementById('closeQuestionnairePanel')?.addEventListener('click', () => {
        elements.questionnairePanel?.classList.add('hidden');
    });
    elements.questionnaireForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.submitQuestionnaire();
    });
    document.getElementById('insuranceCardInput')?.addEventListener('change', (e) => {
        ui.handleInsuranceCardFile(e.target.files?.[0]);
    });
    document.getElementById('uploadInsuranceCard')?.addEventListener('click', () => {
        ui.uploadInsuranceCard();
    });

    // 完了画面からマイページへ戻る
    document.getElementById('backToMypage')?.addEventListener('click', () => {
        pageController.switchPage('mypage');
    });

    // 設定画面: 新規患者登録フォームのトグル
    document.getElementById('toggleSettingsNewPatient')?.addEventListener('click', () => {
        const formPanel = document.getElementById('settingsNewPatientForm');
        formPanel?.classList.toggle('hidden');
    });
    document.getElementById('cancelSettingsNewPatient')?.addEventListener('click', () => {
        document.getElementById('settingsNewPatientForm')?.classList.add('hidden');
        document.getElementById('settingsAccountForm')?.reset();
    });
    document.getElementById('settingsAccountForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        pageController.createSettingsPatient().catch(error => {
            console.error('患者様登録エラー:', error);
            alert(error.message || '患者様情報の登録に失敗しました');
        });
    });

    // 設定画面: データ削除
    document.getElementById('clearAllData')?.addEventListener('click', () => {
        if (confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
            localStorage.removeItem(STORAGE_KEYS.ACCOUNTS);
            localStorage.removeItem(STORAGE_KEYS.RESERVATIONS);
            patientSelectionStore.clear();
            lineAuth.logout({ silent: true });
            googleAuth.logout({ silent: true });
            state.accounts = [];
            state.reservations = [];
            pageController.renderSettingsPatientList();
            pageController.renderSettingsReservations();
            pageController.renderMypageReservations();
            pageController.updateMypagePatientSelect();
            ui.renderAccountPanel();
            alert('すべてのデータを削除しました');
        }
    });

    // 編集モーダルイベント
    document.getElementById('editModalClose')?.addEventListener('click', () => {
        pageController.closeEditModal();
    });
    document.getElementById('editModalOverlay')?.addEventListener('click', () => {
        pageController.closeEditModal();
    });
    document.getElementById('editModalCancel')?.addEventListener('click', () => {
        pageController.closeEditModal();
    });
    document.getElementById('editPatientForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        pageController.savePatientEdit();
    });

    // 問診票モーダルイベント
    document.getElementById('questionnaireModalClose')?.addEventListener('click', () => {
        pageController.closeQuestionnaireModal();
    });
    document.getElementById('questionnaireModalOverlay')?.addEventListener('click', () => {
        pageController.closeQuestionnaireModal();
    });
    document.getElementById('mypageQuestionnaireFormWrapper')?.addEventListener('submit', (e) => {
        e.preventDefault();
        pageController.submitMypageQuestionnaire();
    });

    // 診療履歴詳細モーダルイベント
    document.getElementById('historyDetailModalClose')?.addEventListener('click', () => {
        ui.closeHistoryVisitModal();
    });
    document.getElementById('historyDetailModalOverlay')?.addEventListener('click', () => {
        ui.closeHistoryVisitModal();
    });
    document.getElementById('historyDetailModalDone')?.addEventListener('click', () => {
        ui.closeHistoryVisitModal();
    });

    // ステップフローアイテム（旧UIの互換性用）
    elements.serviceFlowItems?.forEach(item => {
        item.addEventListener('click', () => {
            if (Number(item.dataset.topStep) === 1) {
                ui.showStep(1);
            }
        });
    });
}

// 起動
document.addEventListener('DOMContentLoaded', init);
