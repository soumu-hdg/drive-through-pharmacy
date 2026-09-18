/**
 * DigiMaster 予約管理画面
 */

// 設定
const API_ORIGIN = window.location.protocol === 'file:'
    ? 'http://localhost:8000'
    : window.location.origin;

const CONFIG = {
    API_BASE: `${API_ORIGIN}/api/v1`
};

const AUTH_BRIDGE_STORAGE_KEY = 'dm_access_token_bridge';

function isLocalDevelopmentHost() {
    const hostname = window.location.hostname;
    return !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function consumeSharedKarteToken() {
    try {
        const raw = localStorage.getItem(AUTH_BRIDGE_STORAGE_KEY);
        if (!raw) return null;
        localStorage.removeItem(AUTH_BRIDGE_STORAGE_KEY);
        const data = JSON.parse(raw);
        if (!data?.accessToken || Number(data.expiresAt || 0) < Date.now()) return null;
        sessionStorage.setItem('dm_access_token', data.accessToken);
        if (data.refreshToken) sessionStorage.setItem('dm_refresh_token', data.refreshToken);
        return data.accessToken;
    } catch (error) {
        console.warn('カルテからのログイン情報を読み込めませんでした:', error);
        return null;
    }
}

function getAdminAccessToken() {
    const sessionToken = sessionStorage.getItem('dm_access_token');
    if (sessionToken) return sessionToken;
    const bridgedToken = consumeSharedKarteToken();
    if (bridgedToken) return bridgedToken;
    if (window.location.protocol === 'file:' || isLocalDevelopmentHost()) return 'dev-token';
    return '';
}

async function refreshAdminAccessToken() {
    const refreshToken = sessionStorage.getItem('dm_refresh_token');
    if (!refreshToken) return false;

    try {
        const response = await fetch(`${CONFIG.API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!response.ok) return false;
        const data = await response.json();
        if (!data?.access_token) return false;
        sessionStorage.setItem('dm_access_token', data.access_token);
        return true;
    } catch (error) {
        console.warn('ログイン情報の更新に失敗しました:', error);
        return false;
    }
}

// 状態
const state = {
    // クリニック管理
    clinics: [],
    currentClinicId: null,
    // 既存の状態
    departments: [],
    departmentGroups: [],
    templates: [],
    reservations: [],
    calendarRows: [],
    customCalendars: [],
    editingCalendarId: null,
    questionnaires: [],
    editingQuestionnaireId: null,
    beautyCategories: [],
    treatmentMenus: [],
    treatmentSteps: [],
    treatmentStaff: [],
    treatmentRooms: [],
    treatmentEquipment: [],
    treatmentResourceCapacities: { doctor: 1, nurse: 2, clerk: 1 },
    reviewSettings: { googleReviewUrl: '' },
    reservationViewMode: 'timeline',
    reservationRangeMode: 'week',
    reservationResourceAxis: 'staff'
};

// 診療科グループサンプルデータ
// デモデータは削除済み - 診療科はAPIまたはlocalStorageから取得
const sampleDepartmentGroups = [];

const CALENDAR_STORAGE_KEY = 'digimaster.reservationCalendars.v1';
const QUESTIONNAIRE_STORAGE_KEY = 'digimaster.questionnaires.v1';
const DEPARTMENT_GROUP_STORAGE_KEY = 'digimaster.departmentGroups.v1';
const BEAUTY_CATEGORY_STORAGE_KEY = 'digimaster.beautyCategories.v1';
const TREATMENT_MENU_STORAGE_KEY = 'digimaster.treatmentMenus.v1';
const TREATMENT_STEP_STORAGE_KEY = 'digimaster.treatmentSteps.v1';
const TREATMENT_RESOURCE_STORAGE_KEY = 'digimaster.treatmentResourceCapacities.v1';
const TREATMENT_STAFF_STORAGE_KEY = 'digimaster.treatmentStaff.v1';
const TREATMENT_ROOM_STORAGE_KEY = 'digimaster.treatmentRooms.v1';
const TREATMENT_EQUIPMENT_STORAGE_KEY = 'digimaster.treatmentEquipment.v1';
const PATIENT_RESERVATION_STORAGE_KEY = 'digimaster_reservations_v1';
const REVIEW_SETTINGS_STORAGE_KEY = 'digimaster.reviewSettings.v1';

// クリニック管理用ストレージキー
const CLINIC_STORAGE_KEY = 'digimaster.clinics.v1';
const CURRENT_CLINIC_KEY = 'digimaster.currentClinicId';

const CANONICAL_CLINICS = [
    { id: 'clinic-nishiharu', name: '西春内科・在宅クリニック', aliases: ['西春'] }
];

const CLINIC_SCOPED_STORAGE_KEYS = [
    CALENDAR_STORAGE_KEY,
    QUESTIONNAIRE_STORAGE_KEY,
    DEPARTMENT_GROUP_STORAGE_KEY,
    BEAUTY_CATEGORY_STORAGE_KEY,
    TREATMENT_MENU_STORAGE_KEY,
    TREATMENT_STEP_STORAGE_KEY,
    TREATMENT_RESOURCE_STORAGE_KEY,
    TREATMENT_STAFF_STORAGE_KEY,
    TREATMENT_ROOM_STORAGE_KEY,
    TREATMENT_EQUIPMENT_STORAGE_KEY
];

const DEFAULT_TREATMENT_MENUS = [
    { code: 'lala_doctor', label: 'ララドクター', resource_type: 'nurse', duration_minutes: 40, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'lala_doctor', equipment_label: 'ララドクター' },
    { code: 'botox', label: 'ボトックス注射（アラガン）', resource_type: 'doctor', duration_minutes: 20, set_duration_minutes: 20, room_codes: ['room-07'], equipment_code: 'botox', equipment_label: 'ボトックス注射（アラガン）' },
    { code: 'juvelook', label: 'ジュベルック', resource_type: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'juvelook', equipment_label: 'ジュベルック' },
    { code: 'pluryal_densify', label: 'プルリアルデンシファイ', resource_type: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'pluryal_densify', equipment_label: 'プルリアルデンシファイ' },
    { code: 'profhilo', label: 'プロファイロ', resource_type: 'doctor', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-07'], equipment_code: 'profhilo', equipment_label: 'プロファイロ' },
    { code: 'potenza', label: 'ポテンツァ（POTENZA）', resource_type: 'nurse', duration_minutes: 60, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'potenza', equipment_label: 'ポテンツァ（POTENZA）' },
    { code: 'density', label: 'デンシティ（DENSITY）', resource_type: 'nurse', duration_minutes: 60, set_duration_minutes: 60, room_codes: ['room-03'], equipment_code: 'density', equipment_label: 'デンシティ（DENSITY）' },
    { code: 'ipl', label: 'IPL光治療（フォトフェイシャル・ステラM22）', resource_type: 'nurse', duration_minutes: 45, set_duration_minutes: 45, room_codes: ['room-03'], equipment_code: 'ipl', equipment_label: 'IPL光治療（フォトフェイシャル・ステラM22）' },
    { code: 'electroporation', label: 'エレクトロポレーション（メソナJ）', resource_type: 'nurse', duration_minutes: 30, set_duration_minutes: 20, room_codes: ['room-03'], equipment_code: 'electroporation', equipment_label: 'エレクトロポレーション（メソナJ）' },
    { code: 'visia', label: '肌診断器VISIA®（ビジア）', resource_type: 'nurse', duration_minutes: 30, set_duration_minutes: 30, room_codes: ['room-03'], equipment_code: 'visia', equipment_label: '肌診断器VISIA®（ビジア）' },
    { code: 'beauty_oral_medicine', label: '美肌内服', resource_type: 'doctor', duration_minutes: 15, set_duration_minutes: 15, room_codes: [], equipment_requirements: [], equipment_code: '', equipment_label: '', uses_equipment: false },
    { code: 'mounjaro', label: 'マンジャロ', resource_type: 'doctor', duration_minutes: 15, set_duration_minutes: 15, room_codes: [], equipment_requirements: [], equipment_code: '', equipment_label: '', uses_equipment: false },
    { code: 'art_make', label: 'アートメイク', resource_type: 'nurse', duration_minutes: 150, set_duration_minutes: 150, room_codes: ['room-03'], equipment_code: 'artmake', equipment_label: 'アートメイク' },
    { code: 'doctor_counseling', label: '医師カウンセリング', resource_type: 'doctor', duration_minutes: 15, set_duration_minutes: 15, room_codes: ['room-01'], equipment_code: '', equipment_label: '' },
    { code: 'doctors_cosmetics', label: 'ドクターズコスメ', resource_type: 'clerk', duration_minutes: 10, set_duration_minutes: 10, room_codes: [], equipment_requirements: [], equipment_code: '', equipment_label: '', uses_equipment: false },
];

const EQUIPMENTLESS_TREATMENT_CODES = new Set(['beauty_oral_medicine', 'mounjaro', 'doctors_cosmetics']);

const DEFAULT_BEAUTY_CATEGORIES = DEFAULT_TREATMENT_MENUS.map((menu, index) => ({
    id: `beauty-category-${menu.code}`,
    code: menu.code,
    name: menu.label,
    description: '',
    display_order: (index + 1) * 10,
    is_active: true
}));

const DEFAULT_TREATMENT_STEPS = [
    { id: 'step-counseling', code: 'counseling', display_id: 40294, name: 'カウンセリング', step_type: 'counseling', description: 'カウンセリングに使用します', duration_minutes: 15, resource_type: 'nurse', room_codes: ['room-02'], display_order: 10, is_active: true },
    { id: 'step-art_make_counseling', code: 'art_make_counseling', display_id: 43151, name: 'アートメイク　カウンセリング', step_type: 'counseling', description: 'アートメイクのカウンセリングに使用します', duration_minutes: 15, resource_type: 'nurse', room_codes: ['room-02'], display_order: 20, is_active: true },
    { id: 'step-doctor_counseling', code: 'doctor_counseling', display_id: 47128, name: '医師カウンセリング', step_type: 'diagnosis', description: '医師による診察・カウンセリングに使用します', duration_minutes: 15, resource_type: 'doctor', room_codes: ['room-01'], display_order: 30, is_active: true },
    { id: 'step-lala_doctor', code: 'lala_doctor', display_id: 47265, name: 'ララドクター', step_type: 'treatment', description: 'ララドクターの施術に使用します', duration_minutes: 40, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['lala_doctor'], display_order: 40, is_active: true },
    { id: 'step-pre_consultation', code: 'pre_consultation', display_id: 40295, name: '施術前診察', step_type: 'diagnosis', description: '施術前の診察に使用します', duration_minutes: 15, resource_type: 'doctor', room_codes: ['room-01'], display_order: 50, is_active: true },
    { id: 'step-ipl', code: 'ipl', display_id: 40296, name: 'フォトフェイシャル', step_type: 'treatment', description: 'フォトフェイシャルの施術に使用します', duration_minutes: 45, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['ipl'], display_order: 60, is_active: true },
    { id: 'step-density', code: 'density', display_id: 40297, name: 'デンシティ', step_type: 'treatment', description: 'デンシティの施術に使用します', duration_minutes: 60, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['density'], display_order: 70, is_active: true },
    { id: 'step-potenza', code: 'potenza', display_id: 40298, name: 'ポテンツァ', step_type: 'treatment', description: 'ポテンツァの施術に使用します', duration_minutes: 60, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['potenza'], display_order: 80, is_active: true },
    { id: 'step-mesona', code: 'mesona', display_id: 40299, name: 'メソナJ', step_type: 'treatment', description: 'メソナJの施術に使用します', duration_minutes: 30, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['electroporation'], display_order: 90, is_active: true },
    { id: 'step-botox', code: 'botox', display_id: 40300, name: 'ボトックス', step_type: 'treatment', description: 'ボトックスの施術に使用します', duration_minutes: 20, resource_type: 'doctor', room_codes: ['room-07'], equipment_codes: ['botox'], display_order: 100, is_active: true },
    { id: 'step-juvelook', code: 'juvelook', display_id: 41015, name: 'ジュベルック', step_type: 'treatment', description: 'ジュベルックの施術に使用します', duration_minutes: 45, resource_type: 'doctor', room_codes: ['room-07'], equipment_codes: ['juvelook'], display_order: 130, is_active: true },
    { id: 'step-art_make', code: 'art_make', display_id: 43150, name: 'アートメイク', step_type: 'treatment', description: 'アートメイクの施術に使用します', duration_minutes: 150, resource_type: 'nurse', room_codes: ['room-03'], equipment_codes: ['artmake'], display_order: 150, is_active: true },
    { id: 'step-pluryal_densify', code: 'pluryal_densify', display_id: 47063, name: 'プルリアルデンシファイ', step_type: 'treatment', description: 'プルリアルデンシファイの施術に使用します', duration_minutes: 45, resource_type: 'doctor', room_codes: ['room-07'], equipment_codes: ['pluryal_densify'], display_order: 160, is_active: true },
    { id: 'step-profhilo', code: 'profhilo', display_id: 47064, name: 'プロファイロ', step_type: 'treatment', description: 'プロファイロの施術に使用します', duration_minutes: 45, resource_type: 'doctor', room_codes: ['room-07'], equipment_codes: ['profhilo'], display_order: 170, is_active: true }
];

const LEGACY_OBSOLETE_TREATMENT_STEP_IDS = new Set([
    'step-reception',
    'step-consultation',
    'step-cleansing',
    'step-skin-analysis',
    'step-skin_analysis',
    'step-anesthesia',
    'step-cooling',
    'step-aftercare',
    'step-treatment',
    'step-fat_dissolving',
    'step-rizne',
    'step-fat_x_core'
]);

const LEGACY_TREATMENT_STEP_ID_MAP = {
    counseling: 'step-counseling',
    reception: 'step-counseling',
    consultation: 'step-counseling',
    skin_analysis: 'step-counseling',
    'skin-analysis': 'step-counseling',
    aftercare: 'step-counseling',
    cleansing: 'step-treatment',
    anesthesia: 'step-treatment',
    cooling: '',
    treatment: '',
    fat_dissolving: '',
    rizne: '',
    fat_x_core: ''
};

const TREATMENT_STEP_TYPES = [
    { value: 'diagnosis', label: '診察' },
    { value: 'counseling', label: 'カウンセリング' },
    { value: 'treatment', label: '施術' },
    { value: 'other', label: 'その他' }
];

const TREATMENT_RESOURCE_ROLES = [
    { value: 'doctor', label: '医師' },
    { value: 'nurse', label: '看護師' },
    { value: 'clerk', label: '事務員' }
];

const DEFAULT_TREATMENT_ROOMS = [
    { code: 'room-01', label: '01.診察室', capacity: 1 },
    { code: 'room-02', label: '02.CSルーム', capacity: 1 },
    { code: 'room-03', label: '03.処置室①', capacity: 1 },
    { code: 'room-04', label: '04.処置室②', capacity: 1 },
    { code: 'room-05', label: '05.処置室③', capacity: 1 },
    { code: 'room-06', label: '06.処置室④', capacity: 1 },
    { code: 'room-07', label: '07.医師施術室①', capacity: 1 },
    { code: 'room-08', label: '08.医師施術室②', capacity: 1 }
];

const LEGACY_TREATMENT_ROOM_CODES = new Set(['beauty-room-1', 'beauty-room-2', 'consult-room']);

const DEFAULT_TREATMENT_EQUIPMENT = [
    { code: 'lala_doctor', label: 'ララドクター', capacity: 1, default_duration_minutes: 40 },
    { code: 'electroporation', label: 'エレクトロポレーション（メソナJ）', capacity: 1, default_duration_minutes: 20 },
    { code: 'ipl', label: 'IPL光治療（フォトフェイシャル・ステラM22）', capacity: 1, default_duration_minutes: 45 },
    { code: 'potenza', label: 'ポテンツァ（POTENZA）', capacity: 1, default_duration_minutes: 60 },
    { code: 'density', label: 'デンシティ（DENSITY）', capacity: 1, default_duration_minutes: 60 },
    { code: 'visia', label: '肌診断器VISIA®（ビジア）', capacity: 1, default_duration_minutes: 30 },
    { code: 'botox', label: 'ボトックス注射（アラガン）', capacity: 1, default_duration_minutes: 20 },
    { code: 'juvelook', label: 'ジュベルック', capacity: 1, default_duration_minutes: 45 },
    { code: 'pluryal_densify', label: 'プルリアルデンシファイ', capacity: 1, default_duration_minutes: 45 },
    { code: 'profhilo', label: 'プロファイロ', capacity: 1, default_duration_minutes: 45 },
    { code: 'artmake', label: 'アートメイク', capacity: 1, default_duration_minutes: 150 }
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

const TREATMENT_CARD_DEFAULTS = {
    lala_doctor: { lead: '肌を育てるピーリング。毎週水曜日はララドクターの日', tags: ['毛穴', 'くすみ', 'ニキビ', 'ハリ不足'], downtime: '軽い赤み・皮むけが数日出る場合があります', staffLabel: '看護師（医師診察あり）', duration: '約30分', price: '初回 ¥9,900', priceSub: '通常 ¥12,100〜', badges: ['人気', '水曜日限定'], visualLabel: 'LHALA Doctor', visualSub: 'Skin peel', visualTheme: 'orange' },
    botox: { lead: '表情じわやフェイスラインを自然に整えたい方へ', tags: ['しわ', 'エラ', '汗', '小顔'], downtime: '注射部位に赤み・内出血が出る場合があります', staffLabel: '医師', duration: '約20分', price: '¥9,900〜', priceSub: '部位により異なります', badges: ['人気'], visualLabel: 'Botox', visualSub: 'Allergan', visualTheme: 'blue' },
    juvelook: { lead: '毛穴やニキビ跡をなめらかに', tags: ['毛穴', 'ニキビ跡', '肌質改善'], downtime: '赤み・腫れが数日出る場合があります', staffLabel: '医師', duration: '約45分', price: '¥44,000', priceSub: '全顔 4cc', badges: ['肌育'], visualLabel: 'Juvelook', visualSub: 'Skin booster', visualTheme: 'pink' },
    pluryal_densify: { lead: 'ハリ・弾力、乾燥小じわ、肌質改善へ', tags: ['ハリ不足', '乾燥', '小じわ'], downtime: '赤み・腫れ・内出血が出る場合があります', staffLabel: '医師', duration: '約45分', price: '¥55,000', priceSub: '顔全体 2cc', badges: ['肌育'], visualLabel: 'Pluryal', visualSub: 'Densify', visualTheme: 'violet' },
    profhilo: { lead: '自然なハリ感とたるみ・肌のもたつきへ', tags: ['ハリ不足', 'たるみ', '小じわ'], downtime: '赤み・腫れが数日出る場合があります', staffLabel: '医師', duration: '約45分', price: '¥66,000', priceSub: '顔全体 2cc', badges: ['人気'], visualLabel: 'Profhilo', visualSub: 'Bio remodeling', visualTheme: 'green' },
    potenza: { lead: '肝斑・赤み・毛穴、ニキビ跡の肌質改善に', tags: ['毛穴', 'ニキビ跡', '肌質改善', '赤み'], downtime: '赤み・ほてりが数日出る場合があります', staffLabel: '看護師（医師診察あり）', duration: '約60分', price: '¥29,700〜', priceSub: 'チップ・薬剤により異なります', badges: ['人気'], visualLabel: 'POTENZA', visualSub: 'Jeisys', visualTheme: 'gold' },
    density: { lead: 'たるみ、小じわ、肌質改善を集中的にケア', tags: ['たるみ', '引き締め', 'ハリ不足'], downtime: '赤み・熱感が出る場合があります', staffLabel: '看護師（医師診察あり）', duration: '約60分', price: '¥27,500〜', priceSub: 'ショット数により異なります', badges: ['リフト'], visualLabel: 'DENSITY', visualSub: 'Tightening', visualTheme: 'slate' },
    ipl: { lead: 'シミ・そばかす・赤みをまとめてケア', tags: ['シミ', 'そばかす', '赤み', 'くすみ'], downtime: '赤み・かさぶたが出る場合があります', staffLabel: '看護師（医師診察あり）', duration: '約45分', price: '¥8,800〜', priceSub: '部位により異なります', badges: ['人気'], visualLabel: 'Photofacial', visualSub: 'IPL', visualTheme: 'aqua' },
    electroporation: { lead: '美白、ハリ、ダウンタイム軽減を目的にした導入ケア', tags: ['乾燥', 'くすみ', 'ハリ不足', '赤み'], downtime: 'ダウンタイムはほとんどありません', staffLabel: '看護師', duration: '約30分', price: '¥7,700〜', priceSub: '他施術セットあり', badges: ['導入'], visualLabel: 'Mesona J', visualSub: 'Electroporation', visualTheme: 'mint' },
    art_make: { lead: '自然な眉・リップを医療の技術で', tags: ['眉', 'リップ'], downtime: '赤み・腫れが数日出る場合があります', staffLabel: '看護師（医師診察あり）', duration: '約120〜180分', price: '¥39,800〜', priceSub: '部位・リタッチにより異なります', badges: [], visualLabel: 'Art Make', visualSub: 'Brow & lip', visualTheme: 'rose' },
    visia: { lead: '肌状態を撮影して適したケアを確認', tags: ['肌診断', 'シミ', '毛穴', '赤み'], downtime: '撮影のみのためダウンタイムはありません', staffLabel: '看護師', duration: '約30分', price: '¥0', priceSub: '美容カウンセリング', badges: ['肌診断'], visualLabel: 'VISIA', visualSub: 'Skin analysis', visualTheme: 'indigo' },
    beauty_oral_medicine: { lead: 'シナール、トラネキサム酸、イソトレチノインなど', tags: ['シミ', 'くすみ', 'ニキビ'], downtime: '内服内容により医師が注意点をご案内します', staffLabel: '医師', duration: 'オンライン診療', price: '¥4,400〜', priceSub: 'セット内容・期間により異なります', badges: ['オンライン'], visualLabel: 'Oral Care', visualSub: 'Skin medicine', visualTheme: 'green' },
    mounjaro: { lead: '体重管理のオンライン診療', tags: ['体重管理', 'オンライン'], downtime: '医師が適応と注意点をご案内します', staffLabel: '医師', duration: 'オンライン診療', price: '¥19,800〜', priceSub: '容量・本数により異なります', badges: ['オンライン'], visualLabel: 'Mounjaro', visualSub: 'Weight care', visualTheme: 'slate' },
    doctor_counseling: { lead: '施術前に医師へ相談したい方へ', tags: ['相談', '美容カウンセリング'], downtime: '相談のみのためダウンタイムはありません', staffLabel: '医師', duration: '約15分', price: '¥3,300', priceSub: '医師カウンセリング', badges: ['相談'], visualLabel: 'Counseling', visualSub: 'Doctor', visualTheme: 'indigo' },
    doctors_cosmetics: { lead: '院内で購入できるドクターズコスメ', tags: ['物販', 'スキンケア', 'ドクターズコスメ'], downtime: '物販のためダウンタイムはありません', staffLabel: '事務員', duration: '約10分', price: '¥3,500〜', priceSub: '商品により異なります', badges: ['物販'], visualLabel: 'Cosme', visualSub: "Doctor's cosmetics", visualTheme: 'mint' }
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
    beauty_oral_medicine: ['visia', 'ipl'],
    mounjaro: ['beauty_oral_medicine'],
    art_make: ['visia'],
    visia: ['ipl', 'potenza', 'lala_doctor'],
    doctor_counseling: ['visia'],
    doctors_cosmetics: ['beauty_oral_medicine', 'visia']
};

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
    beauty_oral_medicine: [
        '既往歴、妊娠・授乳、内服中の薬、アレルギーは必ず申告してください。',
        '医師の判断により、処方内容の変更または処方不可となる場合があります。',
        '副作用や体調変化があった場合は服用を中止し、クリニックへ連絡してください。'
    ],
    mounjaro: [
        '既往歴、内服薬、妊娠・授乳、糖尿病治療中の有無を必ず申告してください。',
        '吐き気、便秘、下痢、食欲低下、低血糖症状などが出る場合があります。',
        '医師の判断により、処方不可または容量変更となる場合があります。'
    ],
    art_make: [
        '施術後は腫れ、赤み、かさぶた、色むらが出る場合があります。',
        '当日は飲酒、激しい運動、サウナ、長時間の入浴を控えてください。',
        '既往歴、アレルギー、妊娠・授乳、ケロイド体質がある場合は必ず申告してください。'
    ],
    doctor_counseling: [
        '相談内容により、当日施術ではなく別日の施術予約をご案内する場合があります。',
        '既往歴、治療中の疾患、内服薬、アレルギーがある場合は必ず申告してください。',
        '診察結果により、希望施術とは別の施術や保険診療をご案内する場合があります。'
    ],
    doctors_cosmetics: [
        '医薬品成分や準ずる成分を含む商品は、肌状態や既往歴により販売可否が変わる場合があります。',
        '使用中に赤み、かゆみ、刺激感などが出た場合は使用を中止し、クリニックへ相談してください。',
        '購入希望商品が在庫切れの場合は、入荷後のご案内となる場合があります。'
    ]
};

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
    beauty_oral_medicine: [
        { id: 'oral_strong_1m', label: '美肌最強セット（1か月毎）', price: '¥6,600', duration: 'オンライン診療' },
        { id: 'oral_strong_3m', label: '美肌最強セット（3か月毎）', price: '¥18,810', priceSub: '1か月あたり ¥6,270', duration: 'オンライン診療' },
        { id: 'oral_strong_6m', label: '美肌最強セット（6か月毎）', price: '¥35,640', priceSub: '1か月あたり ¥5,940', duration: 'オンライン診療' },
        { id: 'oral_strong_12m', label: '美肌最強セット（12か月毎）', price: '¥63,360', priceSub: '1か月あたり ¥5,280', duration: 'オンライン診療' },
        { id: 'oral_pill_1m', label: 'ピル内服中美肌セット（1か月毎）', price: '¥5,500', duration: 'オンライン診療' },
        { id: 'oral_pill_3m', label: 'ピル内服中美肌セット（3か月毎）', price: '¥15,675', priceSub: '1か月あたり ¥5,225', duration: 'オンライン診療' },
        { id: 'oral_pill_6m', label: 'ピル内服中美肌セット（6か月毎）', price: '¥29,700', priceSub: '1か月あたり ¥4,950', duration: 'オンライン診療' },
        { id: 'oral_pill_12m', label: 'ピル内服中美肌セット（12か月毎）', price: '¥52,800', priceSub: '1か月あたり ¥4,400', duration: 'オンライン診療' },
        { id: 'oral_basic_1m', label: '飲む美肌セット（1か月毎）', price: '¥4,400', duration: 'オンライン診療' },
        { id: 'oral_basic_3m', label: '飲む美肌セット（3か月毎）', price: '¥12,540', priceSub: '1か月あたり ¥4,180', duration: 'オンライン診療' },
        { id: 'oral_basic_6m', label: '飲む美肌セット（6か月毎）', price: '¥23,760', priceSub: '1か月あたり ¥3,960', duration: 'オンライン診療' },
        { id: 'oral_basic_12m', label: '飲む美肌セット（12か月毎）', price: '¥42,240', priceSub: '1か月あたり ¥3,520', duration: 'オンライン診療' },
        { id: 'oral_beginner_1m', label: '美肌初心者セット（1か月毎）', price: '¥4,400', duration: 'オンライン診療' },
        { id: 'oral_beginner_3m', label: '美肌初心者セット（3か月毎）', price: '¥12,540', priceSub: '1か月あたり ¥4,180', duration: 'オンライン診療' },
        { id: 'oral_beginner_6m', label: '美肌初心者セット（6か月毎）', price: '¥23,760', priceSub: '1か月あたり ¥3,960', duration: 'オンライン診療' },
        { id: 'oral_beginner_12m', label: '美肌初心者セット（12か月毎）', price: '¥42,240', priceSub: '1か月あたり ¥3,520', duration: 'オンライン診療' },
        { id: 'oral_isotretinoin_1m', label: 'イソトレチノイン20mg（1か月毎）', price: '¥6,600', duration: 'オンライン診療' },
        { id: 'oral_isotretinoin_3m', label: 'イソトレチノイン20mg（3か月毎）', price: '¥18,810', priceSub: '1か月あたり ¥6,270', duration: 'オンライン診療' },
        { id: 'oral_isotretinoin_6m', label: 'イソトレチノイン20mg（6か月毎）', price: '¥35,640', priceSub: '1か月あたり ¥5,940', duration: 'オンライン診療' },
        { id: 'oral_acne_total_1m', label: 'ニキビトータル治療セット（1か月毎）', price: '¥7,700', duration: 'オンライン診療' },
        { id: 'oral_acne_total_3m', label: 'ニキビトータル治療セット（3か月毎）', price: '¥21,945', priceSub: '1か月あたり ¥7,315', duration: 'オンライン診療' }
    ],
    mounjaro: [
        { id: 'mounjaro_25_4', label: 'マンジャロ2.5mg 4本（1か月分）', price: '¥19,800', duration: 'オンライン診療' },
        { id: 'mounjaro_25_8', label: 'マンジャロ2.5mg 8本（2か月分）', price: '¥37,620', duration: 'オンライン診療' },
        { id: 'mounjaro_25_12', label: 'マンジャロ2.5mg 12本（3か月分）', price: '¥53,460', duration: 'オンライン診療' },
        { id: 'mounjaro_50_4', label: 'マンジャロ5.0mg 4本（1か月分）', price: '¥33,000', duration: 'オンライン診療' },
        { id: 'mounjaro_50_8', label: 'マンジャロ5.0mg 8本（2か月分）', price: '¥62,700', duration: 'オンライン診療' },
        { id: 'mounjaro_50_12', label: 'マンジャロ5.0mg 12本（3か月分）', price: '¥89,100', duration: 'オンライン診療' },
        { id: 'mounjaro_75_4', label: 'マンジャロ7.5mg 4本（1か月分）', price: '¥44,000', duration: 'オンライン診療' },
        { id: 'mounjaro_75_8', label: 'マンジャロ7.5mg 8本（2か月分）', price: '¥83,600', duration: 'オンライン診療' },
        { id: 'mounjaro_75_12', label: 'マンジャロ7.5mg 12本（3か月分）', price: '¥118,800', duration: 'オンライン診療' }
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
    doctor_counseling: [
        { id: 'doctor_counseling_once', label: '医師カウンセリング', price: '¥3,300', duration: '約15分' }
    ],
    doctors_cosmetics: [
        { id: 'cosme_underarm_cream', label: 'わき用クリーム', price: '¥3,980', duration: '物販' },
        { id: 'cosme_skin_lotion', label: 'スキンローション', price: '¥3,500', duration: '物販' },
        { id: 'cosme_mens_skin_lotion', label: 'メンズスキンローション', price: '¥3,500', duration: '物販' },
        { id: 'cosme_skin_serum', label: 'スキンセラム', price: '¥4,500', duration: '物販' },
        { id: 'cosme_mens_skin_serum', label: 'メンズスキンセラム', price: '¥4,500', duration: '物販' }
    ]
};

function getErrorMessage(error, fallback = 'エラーが発生しました') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message && error.message !== '[object Object]') {
        return error.message;
    }
    if (Array.isArray(error)) {
        const messages = error.map(item => getErrorMessage(item, '')).filter(Boolean);
        return messages.length ? messages.join(' / ') : fallback;
    }
    if (typeof error === 'object') {
        if (error.detail) return getErrorMessage(error.detail, fallback);
        if (error.message && error.message !== '[object Object]') return getErrorMessage(error.message, fallback);
        if (error.msg) return getErrorMessage(error.msg, fallback);
        if (error.reason) return getErrorMessage(error.reason, fallback);
        if (error.loc && error.type) {
            return `${Array.isArray(error.loc) ? error.loc.join('.') : error.loc}: ${error.type}`;
        }
        try {
            return JSON.stringify(error);
        } catch {
            return fallback;
        }
    }
    return String(error);
}

// カスタムアラート
function showAlert(message, type = 'warning') {
    const overlay = document.getElementById('customAlertOverlay');
    const messageEl = document.getElementById('customAlertMessage');
    const iconEl = document.getElementById('customAlertIcon');

    messageEl.textContent = getErrorMessage(message);

    // アイコンタイプ設定
    iconEl.className = 'custom-alert-icon';
    if (type === 'success') {
        iconEl.classList.add('success');
        iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>`;
    } else if (type === 'error') {
        iconEl.classList.add('error');
        iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`;
    } else {
        iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>`;
    }

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });

    return new Promise(resolve => {
        const okBtn = document.getElementById('customAlertOk');
        const closeAlert = () => {
            overlay.classList.remove('visible');
            setTimeout(() => {
                overlay.classList.add('hidden');
            }, 300);
            okBtn.removeEventListener('click', closeAlert);
            resolve();
        };
        okBtn.addEventListener('click', closeAlert);
    });
}

// =====================================================
// クリニック管理機能
// =====================================================

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

function normalizePatientReservationClinicIds() {
    try {
        const raw = localStorage.getItem(PATIENT_RESERVATION_STORAGE_KEY);
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
            localStorage.setItem(PATIENT_RESERVATION_STORAGE_KEY, JSON.stringify(normalized));
        }
        return changed;
    } catch (error) {
        console.error('Local reservation clinic migration error:', error);
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
    if (changed) saveClinics();

    if (normalizedCurrentId && state.clinics.find(clinic => clinic.id === normalizedCurrentId)) {
        state.currentClinicId = normalizedCurrentId;
        if (previousCurrentId !== normalizedCurrentId) saveCurrentClinicId();
    } else {
        state.currentClinicId = CANONICAL_CLINICS[0].id;
        saveCurrentClinicId();
    }

    normalizePatientReservationClinicIds();
}

function getCurrentClinic() {
    return state.clinics.find(clinic => String(clinic.id) === String(state.currentClinicId)) || null;
}

function reservationBelongsToCurrentClinic(reservation) {
    const clinic = getCurrentClinic();
    if (!clinic) return true;
    const reservationClinicId = normalizeClinicId(reservation.clinic_id, reservation.clinic_name);
    if (reservationClinicId && reservationClinicId === clinic.id) return true;
    const reservationClinicName = String(reservation.clinic_name || '').trim();
    return Boolean(reservationClinicName && clinic.name && reservationClinicName === clinic.name);
}

// クリニック一覧を読み込み
function loadClinics() {
    try {
        const raw = localStorage.getItem(CLINIC_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        state.clinics = Array.isArray(parsed) ? parsed : [];

        // クリニックがない場合はサンプルデータを追加
        if (state.clinics.length === 0) {
            initializeSampleClinics();
        }
        normalizeClinicStore();
        ensureRequestedClinicDefaults();
    } catch (e) {
        console.warn('クリニックデータの読み込みに失敗:', e);
        state.clinics = [];
    }
}

// サンプルクリニックと診療科の初期化
function initializeSampleClinics() {
    // クリニック定義
    const sampleClinics = [
        { name: '西春内科・在宅クリニック', departments: ['内科', '在宅', '夜間休日外来', '美容施術'] }
    ];

    // 今日の日付を取得
    const today = new Date();
    const effectiveFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    sampleClinics.forEach((clinicDef, index) => {
        const clinic = createClinic(clinicDef.name);
        state.clinics.push(clinic);

        // 診療科を作成
        const departments = clinicDef.departments.map(deptName => ({
            id: `dept-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
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
            const beautyCategoryKey = `${BEAUTY_CATEGORY_STORAGE_KEY}.${clinic.id}`;
            const treatmentStepKey = `${TREATMENT_STEP_STORAGE_KEY}.${clinic.id}`;
            if (!localStorage.getItem(beautyCategoryKey)) {
                localStorage.setItem(beautyCategoryKey, JSON.stringify(cloneDefaultBeautyCategories()));
            }
            if (!localStorage.getItem(treatmentStepKey)) {
                localStorage.setItem(treatmentStepKey, JSON.stringify(cloneDefaultTreatmentSteps()));
            }
            const menus = DEFAULT_TREATMENT_MENUS.map((menu, menuIndex) => ({
                local_id: `menu-${Date.now()}-${index}-${menuIndex}-${Math.random().toString(36).substr(2, 9)}`,
                code: menu.code,
                label: menu.label,
                department_id: beautyDepartment.id,
                beauty_category_id: defaultBeautyCategoryIdForCode(menu.code),
                step_ids: defaultStepIdsForTreatmentMenu(menu),
                resource_type: menu.resource_type,
                resource_types: menu.resource_types || [menu.resource_type],
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

    saveClinics();
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
            resource_type: menu.resource_type,
            resource_types: menu.resource_types || [menu.resource_type],
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

// 既存データをクリアしてサンプルデータをリセット（開発用）
function resetToSampleClinics() {
    // クリニック関連のデータをすべて削除
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
            key.startsWith('digimaster.clinics') ||
            key.startsWith('digimaster.currentClinicId') ||
            key.startsWith('digimaster.departmentGroups') ||
            key.startsWith('digimaster.reservationCalendars') ||
            key.startsWith('digimaster.questionnaires') ||
            key.startsWith('digimaster.treatmentMenus') ||
            key.startsWith('digimaster.treatmentResourceCapacities') ||
            key.startsWith('digimaster.treatmentStaff')
        )) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // stateをリセット
    state.clinics = [];
    state.currentClinicId = null;

    // サンプルデータを追加
    initializeSampleClinics();

    // 最初のクリニックを選択
    if (state.clinics.length > 0) {
        state.currentClinicId = state.clinics[0].id;
        saveCurrentClinicId();
    }

    // UIを更新
    ui.renderClinicSelector();
    loadStoredDepartmentGroups();
    ui.renderDepartmentTable();
    loadStoredCalendars();
    state.calendarRows = buildCalendarRows();  // カレンダー行を再構築
    ui.renderCalendarList();
    loadStoredQuestionnaires();
    ui.renderQuestionnaireList();

    showAlert('サンプルクリニックデータをリセットしました', 'success');
}

// 完全クリア関数（すべてのDigiMasterデータを削除）
function clearAllDigimasterData() {
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) allKeys.push(key);
    }

    // digimasterで始まるキーをすべて削除
    const deleted = [];
    allKeys.forEach(key => {
        if (key.toLowerCase().includes('digimaster')) {
            localStorage.removeItem(key);
            deleted.push(key);
        }
    });

    console.log('削除されたキー:', deleted);
    console.log('残っているキー:', Object.keys(localStorage));

    alert(`${deleted.length}件のキーを削除しました。ページをリロードしてください。`);
}

// グローバルに公開（コンソールから呼び出せるように）
window.resetToSampleClinics = resetToSampleClinics;
window.clearAllDigimasterData = clearAllDigimasterData;

// クリニック一覧を保存
function saveClinics() {
    localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(state.clinics));
}

// 現在選択中のクリニックIDを読み込み
function loadCurrentClinicId() {
    const stored = localStorage.getItem(CURRENT_CLINIC_KEY);
    const normalizedStored = normalizeClinicId(stored);
    if (normalizedStored && state.clinics.find(c => c.id === normalizedStored)) {
        state.currentClinicId = normalizedStored;
        if (stored !== normalizedStored) saveCurrentClinicId();
    } else if (state.clinics.length > 0) {
        state.currentClinicId = state.clinics[0].id;
        saveCurrentClinicId();
    }
}

// 現在選択中のクリニックIDを保存
function saveCurrentClinicId() {
    localStorage.setItem(CURRENT_CLINIC_KEY, state.currentClinicId);
}

// 旧データ（クリニックIDなし）を現在のクリニックに移行
function migrateOldDataToCurrentClinic() {
    if (!state.currentClinicId) return;

    // カレンダーデータの移行
    const oldCalendarKey = CALENDAR_STORAGE_KEY;
    const newCalendarKey = `${CALENDAR_STORAGE_KEY}.${state.currentClinicId}`;
    const oldCalendars = localStorage.getItem(oldCalendarKey);
    const newCalendars = localStorage.getItem(newCalendarKey);

    if (oldCalendars && !newCalendars) {
        localStorage.setItem(newCalendarKey, oldCalendars);
        localStorage.removeItem(oldCalendarKey);
        console.log('カレンダーデータを移行しました');
    }

    // 問診票データの移行
    const oldQuestionnaireKey = QUESTIONNAIRE_STORAGE_KEY;
    const newQuestionnaireKey = `${QUESTIONNAIRE_STORAGE_KEY}.${state.currentClinicId}`;
    const oldQuestionnaires = localStorage.getItem(oldQuestionnaireKey);
    const newQuestionnaires = localStorage.getItem(newQuestionnaireKey);

    if (oldQuestionnaires && !newQuestionnaires) {
        localStorage.setItem(newQuestionnaireKey, oldQuestionnaires);
        localStorage.removeItem(oldQuestionnaireKey);
        console.log('問診票データを移行しました');
    }

    // 診療科データの移行
    const oldDeptKey = DEPARTMENT_GROUP_STORAGE_KEY;
    const newDeptKey = `${DEPARTMENT_GROUP_STORAGE_KEY}.${state.currentClinicId}`;
    const oldDepts = localStorage.getItem(oldDeptKey);
    const newDepts = localStorage.getItem(newDeptKey);

    if (oldDepts && !newDepts) {
        localStorage.setItem(newDeptKey, oldDepts);
        localStorage.removeItem(oldDeptKey);
        console.log('診療科データを移行しました');
    }
}

// クリニックを新規作成
function createClinic(name) {
    return {
        id: createClinicStorageId(name),
        name: name,
        createdAt: new Date().toISOString()
    };
}

// クリニックを追加
function addClinic(name) {
    const clinic = createClinic(name);
    state.clinics.push(clinic);
    saveClinics();
    return clinic;
}

// クリニックを更新
function updateClinic(id, newName) {
    const clinic = state.clinics.find(c => c.id === id);
    if (clinic) {
        clinic.name = newName;
        saveClinics();
    }
    return clinic;
}

// クリニックを削除
function deleteClinic(id) {
    if (state.clinics.length <= 1) {
        showAlert('最低1つのクリニックが必要です');
        return false;
    }

    const index = state.clinics.findIndex(c => c.id === id);
    if (index === -1) return false;

    state.clinics.splice(index, 1);
    saveClinics();

    // 削除したクリニックが選択中だった場合、別のクリニックを選択
    if (state.currentClinicId === id) {
        state.currentClinicId = state.clinics[0].id;
        saveCurrentClinicId();
    }

    // 関連データは保持（他クリニックのデータを削除しないため）
    return true;
}

// クリニックを切り替え
function switchClinic(clinicId) {
    const normalizedClinicId = normalizeClinicId(clinicId);
    if (!state.clinics.find(c => c.id === normalizedClinicId)) {
        console.warn('指定されたクリニックが見つかりません:', clinicId);
        return;
    }

    state.currentClinicId = normalizedClinicId;
    saveCurrentClinicId();

    // クリニック別データを再読み込み
    loadStoredCalendars();
    loadStoredQuestionnaires();
    loadStoredDepartmentGroups();
    loadStoredBeautyCategories();
    loadStoredTreatmentMenus();
    loadStoredTreatmentSteps();
    loadStoredTreatmentResourceCapacities();
    loadStoredTreatmentStaff();

    // カレンダー行データを再構築
    state.calendarRows = buildCalendarRows();

    // UI を更新
    ui.renderCalendarList();
    ui.renderQuestionnaireList();
    ui.renderDepartmentTable();
    ui.renderTreatmentSettings();
    ui.renderClinicSelector();

    if (document.getElementById('page-reservations')?.classList.contains('active')) {
        ui.loadReservations();
    } else if (document.getElementById('page-dashboard')?.classList.contains('active')) {
        ui.loadDashboard();
    } else if (document.getElementById('page-treatment-menus')?.classList.contains('active')) {
        ui.loadTreatmentSettings();
    }
}

// クリニック別のストレージキーを生成
function getClinicStorageKey(baseKey) {
    if (!state.currentClinicId) {
        return baseKey;
    }
    return `${baseKey}.${state.currentClinicId}`;
}

const beautyQuestionnaireItems = [
    {
        id: 'beauty_qi_intro',
        label: '美容施術前問診',
        type: 'custom_description',
        item_type: 'custom_description',
        description: '施術内容や肌状態の確認に使用します。わかる範囲でご回答ください。'
    },
    {
        id: 'beauty_qi_skin_concerns',
        label: '気になる肌悩みを選択してください',
        type: 'checkbox_multi',
        item_type: 'checkbox_multi',
        required: true,
        is_required: true,
        options: ['毛穴', 'しみ・くすみ', 'ニキビ', 'ニキビ跡', '赤み', 'たるみ', 'しわ', 'ハリ不足', '肝斑が気になる', 'その他']
    },
    {
        id: 'beauty_qi_desired_treatments',
        label: '希望している施術・相談内容を選択してください',
        type: 'checkbox_multi',
        item_type: 'checkbox_multi',
        required: true,
        is_required: true,
        options: ['ララドクター', 'ボトックス', 'ジュベルック', 'ポテンツァ', 'IPL光治療', 'エレクトロポレーション', '肌診断VISIA', 'アートメイク', '内服・マンジャロ相談', 'まだ決まっていない']
    },
    {
        id: 'beauty_qi_current_condition',
        label: '現在治療中の病気、内服中の薬、アレルギーはありますか',
        type: 'yesno_text',
        item_type: 'yesno_text',
        required: true,
        is_required: true,
        description: 'ありの場合は病名・薬剤名・アレルギー内容をご記入ください。'
    },
    {
        id: 'beauty_qi_pregnancy',
        label: '妊娠中・授乳中、または妊娠の可能性はありますか',
        type: 'yesno_text',
        item_type: 'yesno_text',
        description: '該当する場合は詳細をご記入ください。'
    },
    {
        id: 'beauty_qi_past_trouble',
        label: '過去に美容施術でトラブルや強い副作用がありましたか',
        type: 'yesno_text',
        item_type: 'yesno_text',
        description: '施術名、時期、症状などをご記入ください。'
    },
    {
        id: 'beauty_qi_sunburn',
        label: '日焼けの状況を選択してください',
        type: 'radio',
        item_type: 'radio',
        required: true,
        is_required: true,
        options: ['直近2週間で強い日焼けなし', '直近2週間で日焼けした', '近日中に日焼け予定あり']
    },
    {
        id: 'beauty_qi_downtime',
        label: 'ダウンタイムの希望を選択してください',
        type: 'radio',
        item_type: 'radio',
        options: ['できるだけ少ない', '数日なら可能', '効果重視で相談したい']
    },
    {
        id: 'beauty_qi_important_date',
        label: '大事な予定・イベント日があれば入力してください',
        type: 'date',
        item_type: 'date',
        description: '結婚式、旅行、撮影など施術後の予定があればご入力ください。'
    },
    {
        id: 'beauty_qi_free_note',
        label: 'その他相談したいこと',
        type: 'custom_text',
        item_type: 'custom_text',
        placeholder: '例：予算、希望する仕上がり、避けたい施術など'
    }
];

// 問診票サンプルデータ
const sampleQuestionnaires = [
    { id: 'q1', name: '内科', departments: ['内科'], items: [] },
    { id: 'q2', name: 'コロナ後遺症外来', departments: ['コロナ後遺症外来'], items: [] },
    { id: 'q3', name: 'オンライン診療', departments: ['オンライン診療'], items: [] },
    { id: 'q4', name: '美容施術 問診票', departments: ['美容施術', '美容皮膚科'], items: beautyQuestionnaireItems },
    { id: 'q5', name: '美肌オンライン診療', departments: ['美肌オンライン診療'], items: [] },
    { id: 'q6', name: 'ED・AGAオンライン診療', departments: ['ED・AGAオンライン診療'], items: [] },
    { id: 'q7', name: '美肌オンライン診療（クーポン）', departments: ['美肌オンライン診療（クーポン）'], items: [] },
    { id: 'q8', name: '皮膚科', departments: ['皮膚科'], items: [] },
    { id: 'q9', name: 'マンジャロ（体重管理オンライン診療）', departments: ['マンジャロ'], items: [] },
    { id: 'q10', name: '【スキンケアセット】美肌オンライン診療', departments: ['スキンケアセット'], items: [] }
];

// 問診項目テンプレート
const questionTemplates = {
    name: { label: '名前', type: 'text', required: true },
    address: { label: '住所', type: 'address', required: true },
    phone: { label: '電話番号', type: 'tel', required: true },
    gender: { label: '性別', type: 'radio', options: ['男性', '女性', 'その他'], required: true },
    birthdate: { label: '生年月日', type: 'date', required: true },
    weight: { label: '体重', type: 'number', unit: 'kg', required: true },
    height: { label: '身長', type: 'number', unit: 'cm', required: false },
    allergy: { label: 'アレルギー', type: 'yesno_text', required: true },
    history: { label: '既往歴', type: 'checkbox_multi', options: ['糖尿病', '心臓病', '高血圧', '高脂血症', '肝臓病', '喘息', '脳出血/脳梗塞', '癌', 'その他'], required: true },
    medication: { label: '服用中の薬', type: 'yesno_text', required: true },
    surgery: { label: '手術', type: 'yesno_text', required: false },
    alcohol: { label: 'お酒', type: 'alcohol', required: false },
    smoking: { label: 'タバコ', type: 'radio', options: ['吸わない', '以前は吸っていたがやめた', '吸う'], required: true },
    pregnancy: { label: '妊娠', type: 'radio', options: ['いいえ', '妊娠中', '妊娠の可能性あり'], required: true },
    breastfeeding: { label: '授乳', type: 'radio', options: ['いいえ', '授乳中'], required: true },
    // 症状カテゴリ
    symptom_internal: {
        label: '症状（内科・小児科）',
        type: 'checkbox_multi',
        options: ['熱', '頭痛', '喉の痛み', '咳', '鼻水・鼻づまり', '倦怠感', '腹痛', '吐き気', '下痢', '便秘', '胸の痛み', '息苦しさ', '食欲不振', 'めまい', 'その他'],
        required: false
    },
    symptom_surgical: {
        label: '症状（外科・整形科）',
        type: 'checkbox_multi',
        options: ['腰痛', '肩こり', '関節痛', '骨折', '捻挫', '打撲', '切り傷', '擦り傷', 'やけど', '腫れ', 'しびれ', 'その他'],
        required: false
    },
    symptom_ent: {
        label: '症状（耳鼻科）',
        type: 'checkbox_multi',
        options: ['耳の痛み', '耳鳴り', '難聴', '鼻水', '鼻づまり', '鼻血', '嗅覚障害', '喉の痛み', '声がれ', 'いびき', '無呼吸', 'めまい', 'その他'],
        required: false
    },
    symptom_derma: {
        label: '症状（皮膚科）',
        type: 'checkbox_multi',
        options: ['かゆみ', '発疹', '湿疹', 'じんましん', 'にきび', 'ほくろ', 'いぼ', '水虫', 'やけど', '傷跡', '乾燥肌', '脱毛', 'その他'],
        required: false
    },
    symptom_mental: {
        label: '症状（心療内科・精神科）',
        type: 'checkbox_multi',
        options: ['不眠', '不安', 'うつ症状', 'イライラ', '集中力低下', '食欲変化', '意欲低下', 'パニック発作', '対人恐怖', '強迫症状', 'その他'],
        required: false
    },
    symptom_urology: {
        label: '症状（泌尿器科）',
        type: 'checkbox_multi',
        options: ['頻尿', '残尿感', '排尿痛', '血尿', '尿漏れ', '夜間頻尿', '尿が出にくい', '下腹部痛', 'その他'],
        required: false
    },
    body_part: {
        label: '部位',
        type: 'body_part',
        required: false
    },
    delivery_address: {
        label: '配送先住所',
        type: 'address',
        required: false
    },
    // カスタム項目
    custom_text: { label: 'カスタム（テキスト）', type: 'custom_text', customizable: true, required: false },
    custom_single: { label: 'カスタム（単一選択）', type: 'custom_single', customizable: true, options: [], required: false },
    custom_multi: { label: 'カスタム（複数選択）', type: 'custom_multi', customizable: true, options: [], required: false },
    custom_image: { label: 'カスタム（画像）', type: 'custom_image', customizable: true, required: false },
    custom_date: { label: 'カスタム（日付）', type: 'custom_date', customizable: true, required: false },
    custom_description: { label: 'カスタム（説明のみ）', type: 'custom_description', customizable: true, required: false }
};

// デモデータは削除済み - 診療科はAPIまたはlocalStorageから取得
const sampleDepartmentOptions = [];

// ロックされた診療科名（空）
const lockedSampleDepartmentNames = new Set([]);

// カレンダープレビューデータは削除済み - APIまたはlocalStorageから取得
const calendarPreviewRows = [];

// API呼び出し
const api = {
    headers() {
        const token = getAdminAccessToken();
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    },

    async request(url, options = {}) {
        try {
            const buildRequest = () => fetch(`${CONFIG.API_BASE}${url}`, {
                ...options,
                headers: {
                    ...this.headers(),
                    ...options.headers
                }
            });

            let response = await buildRequest();
            if (response.status === 401 && await refreshAdminAccessToken()) {
                response = await buildRequest();
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(getErrorMessage(error.detail || error, `HTTP ${response.status}`));
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    // 診療科
    async getDepartments() {
        return this.request('/departments?include_inactive=true');
    },

    async createDepartment(data) {
        return this.request('/departments', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateDepartment(id, data) {
        return this.request(`/departments/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteDepartment(id) {
        return this.request(`/departments/${id}`, { method: 'DELETE' });
    },

    // 予約カレンダー
    async getCalendars() {
        return this.request('/reservation-calendars?include_inactive=true');
    },

    async createCalendar(data) {
        return this.request('/reservation-calendars', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateCalendar(id, data) {
        return this.request(`/reservation-calendars/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteCalendar(id) {
        return this.request(`/reservation-calendars/${id}`, { method: 'DELETE' });
    },

    // テンプレート
    async getTemplates(departmentId = null) {
        const params = departmentId ? `?department_id=${departmentId}` : '';
        return this.request(`/schedules/templates${params}`);
    },

    async createTemplate(data) {
        return this.request('/schedules/templates', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async deleteTemplate(id) {
        return this.request(`/schedules/templates/${id}`, { method: 'DELETE' });
    },

    // 予約枠生成
    async generateSlots(departmentId, startDate, endDate) {
        return this.request(
            `/schedules/generate?department_id=${departmentId}&start_date=${startDate}&end_date=${endDate}`,
            { method: 'POST' }
        );
    },

    // 休診設定
    async createClosure(data) {
        return this.request('/schedules/closures', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // 予約
    async getTodayReservations(departmentId = null) {
        const params = new URLSearchParams();
        const currentClinic = getCurrentClinic();
        if (departmentId) params.set('department_id', departmentId);
        if (currentClinic) {
            params.set('clinic_id', currentClinic.id);
            params.set('clinic_name', currentClinic.name);
        }
        const query = params.toString();
        return this.request(`/reservations/today${query ? `?${query}` : ''}`);
    },

    async getReservations(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/reservations?${queryString}`);
    },

    async updateReservationStatus(id, status, notes = null, cancelReason = null) {
        return this.request(`/reservations/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status, notes, cancel_reason: cancelReason })
        });
    },

    async checkinReservation(id) {
        return this.request(`/reservations/${id}/checkin`, { method: 'POST' });
    },

    async getDailyStats(date = null) {
        const params = date ? `?target_date=${date}` : '';
        return this.request(`/reservations/stats/daily${params}`);
    },

    async getReviewSettings() {
        return this.request('/reservations/review-settings');
    },

    async updateReviewSettings(data) {
        return this.request('/reservations/review-settings', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    // 施術メニュー設定
    async getTreatmentSettings() {
        return this.request('/reservations/treatment-settings');
    },

    async updateTreatmentResourceCapacities(data) {
        return this.request('/reservations/treatment-settings/resources', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async updateTreatmentStaff(staff) {
        return this.request('/reservations/treatment-settings/staff', {
            method: 'PUT',
            body: JSON.stringify({ staff })
        });
    },

    async updateTreatmentRooms(rooms) {
        return this.request('/reservations/treatment-settings/rooms', {
            method: 'PUT',
            body: JSON.stringify({ rooms })
        });
    },

    async updateTreatmentEquipment(equipment) {
        return this.request('/reservations/treatment-settings/equipment', {
            method: 'PUT',
            body: JSON.stringify({ equipment })
        });
    },

    async updateTreatmentCategories(categories) {
        return this.request('/reservations/treatment-settings/categories', {
            method: 'PUT',
            body: JSON.stringify({ categories })
        });
    },

    async updateTreatmentSteps(steps) {
        return this.request('/reservations/treatment-settings/steps', {
            method: 'PUT',
            body: JSON.stringify({ steps })
        });
    },

    async createTreatmentMenu(data) {
        return this.request('/reservations/treatment-menus', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateTreatmentMenu(id, data) {
        return this.request(`/reservations/treatment-menus/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteTreatmentMenu(id) {
        return this.request(`/reservations/treatment-menus/${id}`, { method: 'DELETE' });
    },

    // 問診票
    async getQuestionnaires() {
        return this.request('/questionnaires?include_inactive=true');
    },

    async getQuestionnaire(id) {
        return this.request(`/questionnaires/${id}`);
    },

    async createQuestionnaire(data) {
        return this.request('/questionnaires', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateQuestionnaire(id, data) {
        return this.request(`/questionnaires/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteQuestionnaire(id) {
        return this.request(`/questionnaires/${id}`, { method: 'DELETE' });
    },

    async duplicateQuestionnaire(id) {
        return this.request(`/questionnaires/${id}/duplicate`, { method: 'POST' });
    },

    async getQuestionnaireResponsesByReservation(reservationId) {
        return this.request(`/questionnaires/responses/by-reservation/${reservationId}`);
    },

    async getReservationAttachment(reservationId, attachmentType) {
        return this.request(`/reservations/${reservationId}/attachments/${attachmentType}`);
    }
};

// ユーティリティ
const utils = {
    parseDate(dateStr) {
        if (!dateStr) return new Date();
        if (dateStr instanceof Date) return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
        const [year, month, day] = String(dateStr).slice(0, 10).split('-').map(Number);
        if (!year || !month || !day) return new Date(dateStr);
        return new Date(year, month - 1, day);
    },

    formatDate(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    formatDisplayDate(dateStr) {
        const d = this.parseDate(dateStr);
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
    },

    formatDateLabel(dateStr) {
        const d = this.parseDate(dateStr);
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}(${days[d.getDay()]})`;
    },

    addDays(date, days) {
        const d = this.parseDate(date);
        d.setDate(d.getDate() + days);
        return d;
    },

    startOfWeek(date) {
        const d = this.parseDate(date);
        d.setDate(d.getDate() - d.getDay());
        return d;
    },

    endOfWeek(date) {
        return this.addDays(this.startOfWeek(date), 6);
    },

    startOfMonth(date) {
        const d = this.parseDate(date);
        return new Date(d.getFullYear(), d.getMonth(), 1);
    },

    endOfMonth(date) {
        const d = this.parseDate(date);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0);
    },

    eachDate(startDate, endDate) {
        const dates = [];
        let cursor = this.parseDate(startDate);
        const end = this.parseDate(endDate);
        while (cursor <= end) {
            dates.push(this.formatDate(cursor));
            cursor = this.addDays(cursor, 1);
        }
        return dates;
    },

    dayOfWeekName(dow) {
        return ['日', '月', '火', '水', '木', '金', '土'][dow];
    },

    statusText(status) {
        const map = {
            'pending': '仮予約',
            'confirmed': '確定',
            'checked_in': '来院済み',
            'completed': '完了',
            'cancelled': 'キャンセル',
            'no_show': '無断キャンセル'
        };
        return map[status] || status;
    }
};

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatQuestionnaireValue(value) {
    if (Array.isArray(value)) return value.join('、');
    if (value && typeof value === 'object') {
        return Object.entries(value)
            .filter(([, v]) => v !== '' && v !== null && v !== undefined)
            .map(([key, v]) => `${key}: ${Array.isArray(v) ? v.join('、') : v}`)
            .join(' / ');
    }
    return String(value ?? '');
}

function formatQuestionnaireResponsesForText(responses) {
    if (!responses?.length) return '問診回答はありません。';
    return responses.map(response => {
        const labels = response.item_labels || {};
        const lines = Object.entries(response.responses || {}).map(([key, value]) => {
            const label = labels[key] || key;
            return `${label}: ${formatQuestionnaireValue(value)}`;
        });
        return [
            response.questionnaire_name || '問診票',
            response.completed_at ? `回答日時: ${new Date(response.completed_at).toLocaleString('ja-JP')}` : '',
            response.department_name ? `診療科: ${response.department_name}` : '',
            ...lines
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

function generateLocalId(prefix = 'calendar') {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isApiCalendarId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
}

function loadStoredCalendars() {
    try {
        const key = getClinicStorageKey(CALENDAR_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        state.customCalendars = Array.isArray(parsed) ? parsed : [];
        return state.customCalendars;
    } catch (error) {
        console.error('Calendar storage load error:', error);
        state.customCalendars = [];
        return [];
    }
}

function saveStoredCalendars() {
    const key = getClinicStorageKey(CALENDAR_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.customCalendars));
}

function normalizeReviewSettings(settings = {}) {
    return {
        googleReviewUrl: String(settings.googleReviewUrl || settings.google_review_url || '').trim()
    };
}

function loadStoredReviewSettings() {
    try {
        const raw = localStorage.getItem(REVIEW_SETTINGS_STORAGE_KEY);
        state.reviewSettings = normalizeReviewSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
        console.error('Review settings storage load error:', error);
        state.reviewSettings = { googleReviewUrl: '' };
    }
    return state.reviewSettings;
}

function saveStoredReviewSettings(settings = state.reviewSettings) {
    state.reviewSettings = normalizeReviewSettings(settings);
    localStorage.setItem(REVIEW_SETTINGS_STORAGE_KEY, JSON.stringify(state.reviewSettings));
}

function calendarPayload(calendar, overrides = {}) {
    const { id, facility_id, created_at, updated_at, isActive, ...payload } = calendar;
    return { ...payload, ...overrides };
}

function cloneDepartmentGroups(groups) {
    return JSON.parse(JSON.stringify(groups));
}

function loadStoredDepartmentGroups() {
    try {
        const key = getClinicStorageKey(DEPARTMENT_GROUP_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        state.departmentGroups = Array.isArray(parsed) ? parsed : [];
        return state.departmentGroups;
    } catch (error) {
        console.error('Department group storage load error:', error);
        state.departmentGroups = [];
        return [];
    }
}

function saveStoredDepartmentGroups() {
    const key = getClinicStorageKey(DEPARTMENT_GROUP_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.departmentGroups));
}

function getDepartmentGroupsForDisplay() {
    if (state.departmentGroups.length) return state.departmentGroups;
    const storedGroups = loadStoredDepartmentGroups();
    return storedGroups;
}

function ensureEditableDepartmentGroups() {
    if (!state.departmentGroups.length) {
        const storedGroups = loadStoredDepartmentGroups();
        state.departmentGroups = storedGroups.length
            ? storedGroups
            : cloneDepartmentGroups(sampleDepartmentGroups);
    }
    return state.departmentGroups;
}

function loadStoredQuestionnaires() {
    try {
        const key = getClinicStorageKey(QUESTIONNAIRE_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        state.questionnaires = Array.isArray(parsed) ? parsed : [];
        return state.questionnaires;
    } catch (error) {
        console.error('Questionnaire storage load error:', error);
        state.questionnaires = [];
        return [];
    }
}

function saveStoredQuestionnaires() {
    const key = getClinicStorageKey(QUESTIONNAIRE_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.questionnaires));
}

function createTreatmentMenuCode(label = 'menu') {
    const ascii = String(label)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ascii || `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createBeautyCategoryCode(name = 'category') {
    return createTreatmentMenuCode(name).replace(/^menu_/, 'category_') || `category_${Date.now()}`;
}

function createTreatmentStepCode(name = 'step') {
    return createTreatmentMenuCode(name).replace(/^menu_/, 'step_') || `step_${Date.now()}`;
}

function splitTreatmentMetaList(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/[、,\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function cloneDefaultBeautyCategories() {
    return DEFAULT_BEAUTY_CATEGORIES.map(category => ({ ...category }));
}

function cloneDefaultTreatmentSteps() {
    return DEFAULT_TREATMENT_STEPS.map(step => ({ ...step }));
}

function simplifyTreatmentStepId(value = '') {
    const rawId = String(value || '').trim();
    const cleanId = rawId.replace(/^step-/, '');
    return LEGACY_TREATMENT_STEP_ID_MAP[cleanId] || rawId;
}

function mergeSimpleTreatmentSteps(steps = []) {
    const defaultsById = new Map(cloneDefaultTreatmentSteps().map(step => [String(step.id), step]));
    const merged = [];
    const seen = new Set();

    steps.map(normalizeTreatmentStep)
        .filter(step => step.is_active !== false)
        .forEach(step => {
            const simpleId = simplifyTreatmentStepId(step.id || step.code);
            if (!simpleId) return;
            if (LEGACY_OBSOLETE_TREATMENT_STEP_IDS.has(String(step.id)) || seen.has(String(simpleId))) return;
            const defaultStep = defaultsById.get(String(simpleId));
            const shouldUseDefaultLabel = defaultStep && (!step.name || step.name === '施術');
            const nextStep = normalizeTreatmentStep({
                ...(defaultStep || {}),
                ...step,
                id: simpleId,
                code: defaultStep?.code || step.code,
                name: shouldUseDefaultLabel ? defaultStep.name : step.name,
                description: shouldUseDefaultLabel ? defaultStep.description : step.description,
                step_type: defaultStep?.step_type || step.step_type || step.stepType,
                staff_ids: step.staff_ids || step.staffIds || defaultStep?.staff_ids || [],
                room_codes: step.room_codes || step.roomCodes || defaultStep?.room_codes || [],
                equipment_codes: step.equipment_codes || step.equipmentCodes || defaultStep?.equipment_codes || [],
                display_order: defaultStep?.display_order ?? step.display_order
            });
            merged.push(nextStep);
            seen.add(String(nextStep.id));
        });

    defaultsById.forEach((defaultStep, id) => {
        if (seen.has(id)) return;
        merged.push({ ...defaultStep });
        seen.add(id);
    });

    return merged.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function defaultBeautyCategoryIdForCode(code = '') {
    const normalizedCode = String(code || '').trim();
    return DEFAULT_BEAUTY_CATEGORIES.some(category => category.code === normalizedCode)
        ? `beauty-category-${normalizedCode}`
        : '';
}

function defaultStepIdsForTreatmentMenu(menu = {}) {
    const code = String(menu.code || '').trim();
    const treatmentStepId = getTreatmentStepIdForCode(code);
    if (code === 'art_make') return ['step-art_make_counseling', 'step-art_make'];
    if (code === 'doctor_counseling') return ['step-doctor_counseling'];
    return [getCounselingStepIdForTreatmentMenu(menu), treatmentStepId].filter(Boolean);
}

function normalizeBeautyCategory(category = {}, index = 0) {
    const name = String(category.name || category.label || '').trim();
    const code = String(category.code || createBeautyCategoryCode(name || `category_${index + 1}`)).trim();
    return {
        id: category.id || `beauty-category-${code}`,
        code,
        name: name || code,
        description: category.description || category.note || '',
        display_order: Number(category.display_order ?? category.displayOrder ?? (index + 1) * 10),
        is_active: category.is_active !== false
    };
}

function normalizeTreatmentStep(step = {}, index = 0) {
    const name = String(step.name || step.label || '').trim();
    const code = String(step.code || createTreatmentStepCode(name || `step_${index + 1}`)).trim();
    const durationMinutes = normalizeTreatmentDurationMinutes(step.duration_minutes ?? step.durationMinutes ?? step.duration);
    const stepType = normalizeTreatmentStepType(step.step_type || step.stepType || step.kind || step.type);
    return {
        id: step.id || `step-${code}`,
        code,
        display_id: step.display_id || step.displayId || '',
        name: name || code,
        description: step.description || step.note || '',
        duration_minutes: durationMinutes || 0,
        step_type: stepType,
        stepType,
        resource_type: normalizeTreatmentResourceType(step.resource_type || step.resourceType || 'nurse'),
        staff_ids: normalizeTreatmentStaffIds(step.staff_ids || step.staffIds),
        staffIds: normalizeTreatmentStaffIds(step.staff_ids || step.staffIds),
        room_codes: normalizeTreatmentRoomCodes(step.room_codes || step.roomCodes),
        roomCodes: normalizeTreatmentRoomCodes(step.room_codes || step.roomCodes),
        equipment_codes: normalizeTreatmentEquipmentCodes(step.equipment_codes || step.equipmentCodes),
        equipmentCodes: normalizeTreatmentEquipmentCodes(step.equipment_codes || step.equipmentCodes),
        display_order: Number(step.display_order ?? step.displayOrder ?? (index + 1) * 10),
        is_active: step.is_active !== false
    };
}

function normalizeTreatmentStepType(value = 'treatment') {
    const stepType = String(value || 'treatment').trim();
    return TREATMENT_STEP_TYPES.some(type => type.value === stepType) ? stepType : 'treatment';
}

function getTreatmentStepTypeLabel(value = 'treatment') {
    return TREATMENT_STEP_TYPES.find(type => type.value === normalizeTreatmentStepType(value))?.label || '施術';
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
    const doctorOnlyCodes = new Set(['botox', 'juvelook', 'pluryal_densify', 'profhilo', 'beauty_oral_medicine', 'mounjaro']);
    if (doctorOnlyCodes.has(code)) return 'step-doctor_counseling';
    const roles = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    if (roles.length === 1 && roles[0] === 'doctor') return 'step-doctor_counseling';
    return 'step-counseling';
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

function normalizeTreatmentEquipmentCodes(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[、,\n]+/)
            .map(item => item.trim())
            .filter(Boolean);
    return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

function normalizeTreatmentStepIds(value, fallback = []) {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,\n]+/)
            .map(item => item.trim())
            .filter(Boolean);
    const normalized = (source.length ? source : fallback)
        .map(item => simplifyTreatmentStepId(item))
        .filter(id => id && !LEGACY_OBSOLETE_TREATMENT_STEP_IDS.has(String(id)));
    return normalized.length ? [...new Set(normalized)] : [...fallback];
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

function getDefaultTreatmentDetailDescription() {
    return [
        '前日・当日のでご予約の希望の方は、電話でのご予約も承っております。',
        'お気軽にお問合せください。',
        '※御予約の都合によってはご希望に添えない状況もございます。あらかじめご了承ください。'
    ].join('\n');
}

function getDefaultTreatmentDetailCaution() {
    return [
        '西春内科・在宅クリニックです。',
        'ご予約ありがとうございます。',
        '当院に初めてご来院の方は',
        '当日のご来院までにこちらの',
        'カウンセリングシートのご記載をお願いいたします。'
    ].join('\n');
}

function getTreatmentStepById(stepId = '') {
    const id = simplifyTreatmentStepId(stepId);
    return (state.treatmentSteps || []).find(step => String(step.id) === String(id)) ||
        DEFAULT_TREATMENT_STEPS.find(step => String(step.id) === String(id)) ||
        null;
}

function normalizeTreatmentDetailStepAssignments(value, fallbackStepIds = [], fallbackDuration = null) {
    const rows = Array.isArray(value) ? value : [];
    const fallbackIds = normalizeTreatmentStepIds(fallbackStepIds, []);
    const source = rows.length
        ? rows
        : fallbackIds.map(stepId => ({ step_id: stepId }));
    const normalized = [];

    source.forEach((item, index) => {
        const rawStepId = typeof item === 'string'
            ? item
            : (item.step_id || item.stepId || item.id || item.code || '');
        const stepId = normalizeTreatmentStepIds([rawStepId], [])[0];
        if (!stepId) return;
        const master = getTreatmentStepById(stepId);
        const rowDuration = normalizeTreatmentDurationMinutes(
            typeof item === 'string' ? null : (item.duration_minutes ?? item.durationMinutes ?? item.minutes)
        );
        const duration = rowDuration || normalizeTreatmentDurationMinutes(master?.duration_minutes) || normalizeTreatmentDurationMinutes(fallbackDuration) || 30;
        const nominationEnabled = normalizeTreatmentBoolean(
            typeof item === 'string' ? undefined : (item.nomination_enabled ?? item.nominationEnabled ?? item.staff_selectable ?? item.staffSelectable),
            false
        );
        const existing = normalized.find(row => row.step_id === stepId);
        if (existing) {
            existing.duration_minutes = Math.max(Number(existing.duration_minutes || 0), duration);
            existing.durationMinutes = existing.duration_minutes;
            existing.nomination_enabled = Boolean(existing.nomination_enabled || nominationEnabled);
            existing.nominationEnabled = existing.nomination_enabled;
            return;
        }
        normalized.push({
            step_id: stepId,
            stepId,
            duration_minutes: duration,
            durationMinutes: duration,
            nomination_enabled: nominationEnabled,
            nominationEnabled,
            display_order: Number((typeof item === 'string' ? undefined : item.display_order ?? item.displayOrder) ?? index * 10)
        });
    });

    if (!normalized.length) {
        const fallback = getTreatmentStepById('step-counseling') || DEFAULT_TREATMENT_STEPS[0];
        if (fallback) {
            const duration = normalizeTreatmentDurationMinutes(fallbackDuration) || normalizeTreatmentDurationMinutes(fallback.duration_minutes) || 30;
            normalized.push({
                step_id: fallback.id,
                stepId: fallback.id,
                duration_minutes: duration,
                durationMinutes: duration,
                nomination_enabled: false,
                nominationEnabled: false,
                display_order: 0
            });
        }
    }

    return normalized.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function completeTreatmentDetailStepAssignments(value, fallbackStepIds = [], fallbackDuration = null) {
    const rows = Array.isArray(value) ? value : [];
    const normalized = rows.length ? normalizeTreatmentDetailStepAssignments(rows, [], fallbackDuration) : [];
    const completed = [...normalized];
    const selected = new Set(completed.map(item => item.step_id || item.stepId).filter(Boolean));
    const orderedStepIds = normalizeTreatmentStepIds(fallbackStepIds, []);
    orderedStepIds.forEach(stepId => {
        if (selected.has(stepId)) return;
        const master = getTreatmentStepById(stepId);
        const duration = normalizeTreatmentDurationMinutes(master?.duration_minutes) ||
            normalizeTreatmentDurationMinutes(fallbackDuration) ||
            30;
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
    return normalizeTreatmentDetailStepAssignments(completed, fallbackStepIds, fallbackDuration)
        .sort((a, b) => {
            const aOrder = orderByStepId.has(a.step_id) ? orderByStepId.get(a.step_id) : Number.MAX_SAFE_INTEGER;
            const bOrder = orderByStepId.has(b.step_id) ? orderByStepId.get(b.step_id) : Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder || Number(a.display_order || 0) - Number(b.display_order || 0);
        });
}

function treatmentDetailStepIds(assignments = []) {
    return normalizeTreatmentStepIds(assignments.map(item => item.step_id || item.stepId), []);
}

function treatmentDetailDurationFromSteps(assignments = []) {
    const total = assignments.reduce((sum, item) => sum + (normalizeTreatmentDurationMinutes(item.duration_minutes ?? item.durationMinutes) || 0), 0);
    return total > 0 ? total : null;
}

function formatTreatmentDetailPriceLabel(value = '', lowestPrice = false) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const numericOnly = /^[0-9,]+$/.test(raw);
    const price = numericOnly ? `${raw}円` : raw;
    return lowestPrice && !/[〜~]$/.test(price) ? `${price}〜` : price;
}

function formatTreatmentMenuListPriceLabel(detail = {}) {
    const raw = String(detail.price || detail.priceSub || '').trim();
    if (!raw) return '';
    let price = formatTreatmentDetailPriceLabel(raw, detail.lowest_price || detail.lowestPrice);
    const rangeSuffix = /[〜~]$/.test(price) ? price.slice(-1) : '';
    if (rangeSuffix) price = price.slice(0, -1);
    if (/^[0-9,]+円/.test(price)) {
        const suffix = price.replace(/^[0-9,]+円/, '');
        const numeric = Number(price.replace(/円.*$/, '').replace(/,/g, ''));
        if (Number.isFinite(numeric)) price = `${numeric.toLocaleString('ja-JP')}円${suffix}`;
    }
    const taxIncluded = /税込/.test(price) ? price : `${price}（税込）`;
    return `${taxIncluded}${rangeSuffix}`;
}

function getTreatmentTaxCategoryLabel(value = 'standard_10') {
    const labels = {
        standard_10: '10%',
        reduced_8: '8%（軽減税率）',
        tax_exempt: '非課税'
    };
    return labels[value] || value || '未設定';
}

function renderTreatmentStepSummaryList(assignments = [], fallbackStepIds = [], fallbackDuration = null) {
    const rows = completeTreatmentDetailStepAssignments(assignments, fallbackStepIds, fallbackDuration);
    if (!rows.length) return '<span class="muted-cell">未設定</span>';
    return `
        <ol class="treatment-menu-step-summary">
            ${rows.map((assignment, index) => {
                const step = getTreatmentStepById(assignment.step_id || assignment.stepId);
                const duration = normalizeTreatmentDurationMinutes(assignment.duration_minutes ?? assignment.durationMinutes);
                return `
                    <li>
                        <span class="treatment-menu-step-number">${index + 1}.</span>
                        <span class="treatment-menu-step-label">${escapeHTML(step?.name || assignment.step_id || '未設定')}</span>
                        ${duration ? `<span class="treatment-menu-step-duration">${duration}分</span>` : ''}
                    </li>
                `;
            }).join('')}
        </ol>
    `;
}

function splitTreatmentConfirmationNotes(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/\n+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeTreatmentRecommendationCodes(value) {
    return splitTreatmentMetaList(value)
        .map(item => String(item).trim())
        .filter(Boolean);
}

function getTreatmentCardDefaults(menu = {}) {
    if (menu.code && TREATMENT_CARD_DEFAULTS[menu.code]) {
        return TREATMENT_CARD_DEFAULTS[menu.code];
    }

    const label = String(menu.label || '').toLowerCase();
    if (label.includes('ララ')) return TREATMENT_CARD_DEFAULTS.lala_doctor;
    if (label.includes('ボトックス')) return TREATMENT_CARD_DEFAULTS.botox;
    if (label.includes('ジュベルック')) return TREATMENT_CARD_DEFAULTS.juvelook;
    if (label.includes('プルリアル')) return TREATMENT_CARD_DEFAULTS.pluryal_densify;
    if (label.includes('プロファイロ')) return TREATMENT_CARD_DEFAULTS.profhilo;
    if (label.includes('ポテンツァ')) return TREATMENT_CARD_DEFAULTS.potenza;
    if (label.includes('density') || label.includes('デンシティ')) return TREATMENT_CARD_DEFAULTS.density;
    if (label.includes('ipl') || label.includes('光治療') || label.includes('フォト')) return TREATMENT_CARD_DEFAULTS.ipl;
    if (label.includes('エレクトロポレーション')) return TREATMENT_CARD_DEFAULTS.electroporation;
    if (label.includes('美肌内服') || label.includes('シナール') || label.includes('トラネキサム')) return TREATMENT_CARD_DEFAULTS.beauty_oral_medicine;
    if (label.includes('マンジャロ')) return TREATMENT_CARD_DEFAULTS.mounjaro;
    if (label.includes('アートメイク')) return TREATMENT_CARD_DEFAULTS.art_make;
    if (label.includes('visia') || label.includes('ビジア') || label.includes('肌診断')) return TREATMENT_CARD_DEFAULTS.visia;
    if (label.includes('医師カウンセリング')) return TREATMENT_CARD_DEFAULTS.doctor_counseling;
    if (label.includes('ドクターズコスメ') || label.includes('コスメ') || label.includes('スキンローション') || label.includes('スキンセラム') || label.includes('わき用クリーム')) return TREATMENT_CARD_DEFAULTS.doctors_cosmetics;
    return {};
}

function getTreatmentRecommendationDefaults(menu = {}) {
    if (menu.code && TREATMENT_RECOMMENDATION_DEFAULTS[menu.code]) {
        return TREATMENT_RECOMMENDATION_DEFAULTS[menu.code];
    }

    const defaultCard = getTreatmentCardDefaults(menu);
    const defaultCode = Object.keys(TREATMENT_CARD_DEFAULTS)
        .find(code => TREATMENT_CARD_DEFAULTS[code] === defaultCard);
    return defaultCode ? TREATMENT_RECOMMENDATION_DEFAULTS[defaultCode] || [] : [];
}

function getTreatmentConfirmationDefaults(menu = {}) {
    const defaultCard = getTreatmentCardDefaults(menu);
    const defaultCode = Object.keys(TREATMENT_CARD_DEFAULTS)
        .find(code => TREATMENT_CARD_DEFAULTS[code] === defaultCard);
    return defaultCode ? TREATMENT_CONFIRMATION_DEFAULTS[defaultCode] || [] : [];
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
    if (label.includes('美肌内服') || label.includes('シナール') || label.includes('トラネキサム')) return 'beauty_oral_medicine';
    if (label.includes('マンジャロ')) return 'mounjaro';
    if (label.includes('アートメイク')) return 'art_make';
    if (label.includes('医師カウンセリング')) return 'doctor_counseling';
    if (label.includes('ドクターズコスメ') || label.includes('コスメ') || label.includes('スキンローション') || label.includes('スキンセラム') || label.includes('わき用クリーム')) return 'doctors_cosmetics';
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
    if (text.includes('マンジャロ')) return '容量・期間に合わせて医師が案内';
    if (text.includes('美肌')) return '内側から肌コンディションを整えたい方に';
    return '';
}

function normalizeTreatmentDurationMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(480, Math.round(numeric));
    }
    const match = String(value).match(/(\d+)\s*分?/);
    return match ? Math.min(480, Number(match[1])) : null;
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
            const baseDuration = normalizeTreatmentDurationMinutes(item.duration_minutes ?? item.durationMinutes ?? item.duration ?? item.durationLabel);
            const fallbackStepIds = getDefaultTreatmentDetailStepIds(item, menu);
            const stepAssignments = completeTreatmentDetailStepAssignments(
                item.step_assignments || item.stepAssignments,
                fallbackStepIds,
                baseDuration
            );
            const stepDuration = treatmentDetailDurationFromSteps(stepAssignments);
            const durationMinutes = baseDuration || stepDuration;
            const equipmentCode = inferTreatmentEquipmentCode(item, item.id || item.code || '');
            const equipmentLabel = inferTreatmentEquipmentLabel(item, label);
            const setDurationMinutes = normalizeTreatmentDurationMinutes(item.set_duration_minutes ?? item.setDurationMinutes) ||
                getDefaultTreatmentSetDuration(equipmentCode) ||
                durationMinutes;
            const stepIds = treatmentDetailStepIds(stepAssignments);
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
                closing_buffer_minutes: normalizeTreatmentDurationMinutes(item.closing_buffer_minutes ?? item.closingBufferMinutes),
                closingBufferMinutes: normalizeTreatmentDurationMinutes(item.closing_buffer_minutes ?? item.closingBufferMinutes),
                daily_limit_enabled: normalizeTreatmentBoolean(item.daily_limit_enabled ?? item.dailyLimitEnabled, false),
                dailyLimitEnabled: normalizeTreatmentBoolean(item.daily_limit_enabled ?? item.dailyLimitEnabled, false),
                daily_limit: Number(item.daily_limit ?? item.dailyLimit ?? '') || null,
                dailyLimit: Number(item.daily_limit ?? item.dailyLimit ?? '') || null,
                change_cancel_allowed: normalizeTreatmentBoolean(item.change_cancel_allowed ?? item.changeCancelAllowed, true),
                changeCancelAllowed: normalizeTreatmentBoolean(item.change_cancel_allowed ?? item.changeCancelAllowed, true),
                skip_duplicate: normalizeTreatmentBoolean(item.skip_duplicate ?? item.skipDuplicate, true),
                skipDuplicate: normalizeTreatmentBoolean(item.skip_duplicate ?? item.skipDuplicate, true),
                step_ids: stepIds,
                stepIds,
                step_assignments: stepAssignments,
                stepAssignments,
                is_active: item.is_active !== false,
                display_order: Number(item.display_order ?? index * 10)
            };
        })
        .filter(item => item.label || item.price || item.duration || item.description || item.benefit);
}

function readTreatmentImageFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve('');
            return;
        }
        if (!file.type?.startsWith('image/')) {
            reject(new Error('画像ファイルを選択してください'));
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            reject(new Error('画像は3MB以下にしてください'));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
        reader.readAsDataURL(file);
    });
}

function loadStoredBeautyCategories() {
    try {
        const key = getClinicStorageKey(BEAUTY_CATEGORY_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        state.beautyCategories = Array.isArray(parsed) && parsed.length
            ? parsed.map(normalizeBeautyCategory)
            : cloneDefaultBeautyCategories();
        if (!raw) saveStoredBeautyCategories();
        return state.beautyCategories;
    } catch (error) {
        console.error('Beauty category storage load error:', error);
        state.beautyCategories = cloneDefaultBeautyCategories();
        return state.beautyCategories;
    }
}

function saveStoredBeautyCategories() {
    const key = getClinicStorageKey(BEAUTY_CATEGORY_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.beautyCategories.map(normalizeBeautyCategory)));
}

function loadStoredTreatmentSteps() {
    try {
        const key = getClinicStorageKey(TREATMENT_STEP_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        state.treatmentSteps = Array.isArray(parsed) && parsed.length
            ? mergeSimpleTreatmentSteps(parsed)
            : cloneDefaultTreatmentSteps();
        if (!raw || JSON.stringify(parsed || []) !== JSON.stringify(state.treatmentSteps)) saveStoredTreatmentSteps();
        return state.treatmentSteps;
    } catch (error) {
        console.error('Treatment step storage load error:', error);
        state.treatmentSteps = cloneDefaultTreatmentSteps();
        return state.treatmentSteps;
    }
}

function saveStoredTreatmentSteps() {
    const key = getClinicStorageKey(TREATMENT_STEP_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.treatmentSteps.map(normalizeTreatmentStep)));
}

function getBeautyCategoryById(categoryId = '') {
    return (state.beautyCategories || []).find(category => String(category.id) === String(categoryId)) || null;
}

function getBeautyCategoryName(categoryId = '') {
    return getBeautyCategoryById(categoryId)?.name || '未設定';
}

function getTreatmentStepLabels(stepIds = []) {
    const selected = new Set(normalizeTreatmentStepIds(stepIds, []));
    return (state.treatmentSteps || [])
        .filter(step => selected.has(String(step.id)))
        .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .map(step => step.name);
}

function normalizeTreatmentMenu(menu, index = 0) {
    const code = menu.code || menu.local_id || createTreatmentMenuCode(menu.label);
    const resourceTypes = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    const staffIds = normalizeTreatmentStaffIds(menu.staff_ids || menu.staffIds);
    const durationMinutes = normalizeTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel);
    const usesEquipment = treatmentMenuUsesEquipment(menu, code);
    const roomCodes = normalizeTreatmentMenuRoomCodes(menu, code);
    const equipmentCode = usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '';
    const equipmentLabel = usesEquipment ? inferTreatmentEquipmentLabel(menu, menu.label || code) : '';
    const setDurationMinutes = normalizeTreatmentDurationMinutes(menu.set_duration_minutes ?? menu.setDurationMinutes) ||
        getDefaultTreatmentSetDuration(code) ||
        durationMinutes;
    const equipmentRequirements = usesEquipment ? normalizeTreatmentEquipmentRequirements(
        menu.equipment_requirements || menu.equipmentRequirements,
        {
            equipment_code: equipmentCode,
            equipment_label: equipmentLabel,
            duration_minutes: durationMinutes,
            set_duration_minutes: setDurationMinutes
        }
    ) : [];
    const hasRecommendations =
        Object.prototype.hasOwnProperty.call(menu, 'recommended_menu_codes') ||
        Object.prototype.hasOwnProperty.call(menu, 'recommendedMenuCodes') ||
        Object.prototype.hasOwnProperty.call(menu, 'recommendations');
    const normalized = {
        ...menu,
        local_id: menu.local_id || (!menu.id ? generateLocalId('menu') : null),
        code,
        label: menu.label || code,
        department_id: menu.department_id || null,
        beauty_category_id: menu.beauty_category_id || menu.beautyCategoryId || menu.category_id || defaultBeautyCategoryIdForCode(code),
        beautyCategoryId: menu.beauty_category_id || menu.beautyCategoryId || menu.category_id || defaultBeautyCategoryIdForCode(code),
        step_ids: normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, defaultStepIdsForTreatmentMenu({ ...menu, code })),
        stepIds: normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, defaultStepIdsForTreatmentMenu({ ...menu, code })),
        resource_type: resourceTypes[0],
        resource_types: resourceTypes,
        resourceTypes,
        staff_ids: staffIds,
        staffIds,
        menu_capacity: Number(menu.menu_capacity ?? menu.menuCapacity ?? 1),
        display_order: Number(menu.display_order ?? index * 10),
        lead: menu.lead || '',
        tags: splitTreatmentMetaList(menu.tags || menu.concerns),
        downtime: menu.downtime || '',
        staffLabel: menu.staffLabel || menu.staff_label || '',
        duration: menu.duration || menu.durationLabel || '',
        duration_minutes: durationMinutes,
        room_codes: roomCodes,
        roomCodes,
        equipment_requirements: equipmentRequirements,
        equipmentRequirements,
        equipment_code: equipmentCode,
        equipmentCode,
        equipment_label: equipmentLabel,
        equipmentLabel,
        uses_equipment: usesEquipment,
        usesEquipment,
        set_duration_minutes: setDurationMinutes,
        setDurationMinutes,
        price: menu.price || '',
        priceSub: menu.priceSub || menu.price_sub || '',
        badges: splitTreatmentMetaList(menu.badges),
        confirmation_notes: splitTreatmentConfirmationNotes(
            menu.confirmation_notes || menu.confirmationNotes || menu.confirmation_note || getTreatmentConfirmationDefaults(menu)
        ),
        detail_menus: normalizeTreatmentDetailMenus(
            getTreatmentDetailMenuData(menu),
            { ...menu, code },
            { useDefaults: !hasTreatmentDetailMenuData(menu) }
        ),
        recommended_menu_codes: hasRecommendations
            ? normalizeTreatmentRecommendationCodes(menu.recommended_menu_codes || menu.recommendedMenuCodes || menu.recommendations)
            : undefined,
        image_url: menu.image_url || menu.imageUrl || menu.visualImage || menu.visual_image || '',
        visualLabel: menu.visualLabel || menu.visual_label || '',
        visualSub: menu.visualSub || menu.visual_sub || '',
        visualTheme: menu.visualTheme || menu.visual_theme || '',
        is_active: menu.is_active !== false
    };
    if (!hasRecommendations) {
        delete normalized.recommended_menu_codes;
    }
    return normalized;
}

function loadStoredTreatmentMenus() {
    try {
        const key = getClinicStorageKey(TREATMENT_MENU_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        state.treatmentMenus = Array.isArray(parsed)
            ? parsed.map(normalizeTreatmentMenu).filter(menu => menu.is_active !== false)
            : [];
        return state.treatmentMenus;
    } catch (error) {
        console.error('Treatment menu storage load error:', error);
        state.treatmentMenus = [];
        return [];
    }
}

function saveStoredTreatmentMenus() {
    const key = getClinicStorageKey(TREATMENT_MENU_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.treatmentMenus.map(normalizeTreatmentMenu)));
}

function buildTreatmentMenuApiPayload(menu) {
    const code = menu.code || createTreatmentMenuCode(menu.label);
    const resourceTypes = normalizeTreatmentResourceTypes(menu.resource_types || menu.resourceTypes, menu.resource_type || menu.resourceType || 'nurse');
    const staffIds = normalizeTreatmentStaffIds(menu.staff_ids || menu.staffIds);
    const durationMinutes = normalizeTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel);
    const usesEquipment = treatmentMenuUsesEquipment(menu, code);
    const roomCodes = normalizeTreatmentMenuRoomCodes(menu, code);
    const equipmentCode = usesEquipment ? inferTreatmentEquipmentCode(menu, code) : '';
    const equipmentLabel = usesEquipment ? inferTreatmentEquipmentLabel(menu, menu.label || code) : '';
    const setDurationMinutes = normalizeTreatmentDurationMinutes(menu.set_duration_minutes ?? menu.setDurationMinutes) ||
        getDefaultTreatmentSetDuration(code) ||
        durationMinutes;
    return {
        code,
        label: (menu.label || '').trim(),
        department_id: menu.department_id || null,
        beauty_category_id: menu.beauty_category_id || menu.beautyCategoryId || '',
        beautyCategoryId: menu.beauty_category_id || menu.beautyCategoryId || '',
        step_ids: normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, []),
        stepIds: normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, []),
        resource_type: resourceTypes[0],
        resource_types: resourceTypes,
        staff_ids: staffIds,
        menu_capacity: Number(menu.menu_capacity ?? menu.menuCapacity ?? 1),
        display_order: Number(menu.display_order || 0),
        is_active: menu.is_active !== false,
        lead: menu.lead || '',
        description: menu.description || '',
        tags: splitTreatmentMetaList(menu.tags || menu.concerns),
        downtime: menu.downtime || '',
        price: menu.price || '',
        price_sub: menu.priceSub || menu.price_sub || '',
        duration: menu.duration || menu.durationLabel || '',
        duration_minutes: durationMinutes,
        room_codes: roomCodes,
        equipment_requirements: usesEquipment ? normalizeTreatmentEquipmentRequirements(
            menu.equipment_requirements || menu.equipmentRequirements,
            {
                equipment_code: equipmentCode,
                equipment_label: equipmentLabel,
                duration_minutes: durationMinutes,
                set_duration_minutes: setDurationMinutes
            }
        ) : [],
        equipment_code: equipmentCode,
        equipment_label: equipmentLabel,
        set_duration_minutes: setDurationMinutes,
        staff_label: menu.staffLabel || menu.staff_label || '',
        badges: splitTreatmentMetaList(menu.badges),
        confirmation_notes: splitTreatmentConfirmationNotes(menu.confirmation_notes || menu.confirmationNotes || ''),
        detail_menus: normalizeTreatmentDetailMenus(
            getTreatmentDetailMenuData(menu),
            menu,
            { useDefaults: false }
        ),
        recommended_menu_codes: normalizeTreatmentRecommendationCodes(menu.recommended_menu_codes || menu.recommendedMenuCodes || menu.recommendations),
        image_url: menu.image_url || menu.imageUrl || menu.visualImage || menu.visual_image || '',
        visual_label: menu.visualLabel || menu.visual_label || '',
        visual_sub: menu.visualSub || menu.visual_sub || '',
        visual_theme: menu.visualTheme || menu.visual_theme || ''
    };
}

function loadStoredTreatmentResourceCapacities() {
    try {
        const key = getClinicStorageKey(TREATMENT_RESOURCE_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        state.treatmentResourceCapacities = parsed && typeof parsed === 'object'
            ? {
                doctor: Number(parsed.doctor ?? 1),
                nurse: Number(parsed.nurse ?? 2),
                clerk: Number(parsed.clerk ?? 1)
            }
            : { doctor: 1, nurse: 2, clerk: 1 };
    } catch (error) {
        console.error('Treatment resource storage load error:', error);
        state.treatmentResourceCapacities = { doctor: 1, nurse: 2, clerk: 1 };
    }
    return state.treatmentResourceCapacities;
}

function saveStoredTreatmentResourceCapacities() {
    const key = getClinicStorageKey(TREATMENT_RESOURCE_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(state.treatmentResourceCapacities));
}

function createTreatmentMasterCode(label = 'resource') {
    return String(label || 'resource')
        .trim()
        .toLowerCase()
        .replace(/[^\w]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || `resource_${Date.now()}`;
}

function normalizeTreatmentRoom(room, index = 0) {
    const code = String(room.code || room.local_id || createTreatmentMasterCode(room.label || `room_${index + 1}`)).trim();
    return {
        id: room.id || room.local_id || generateLocalId('room'),
        code,
        label: (room.label || room.name || code).trim(),
        capacity: Math.max(0, Number(room.capacity ?? 1)),
        display_order: Number(room.display_order ?? (index + 1) * 10),
        is_active: room.is_active !== false
    };
}

function normalizeTreatmentEquipment(equipment, index = 0) {
    const code = String(equipment.code || equipment.local_id || createTreatmentMasterCode(equipment.label || `equipment_${index + 1}`)).trim();
    const duration = normalizeTreatmentDurationMinutes(equipment.default_duration_minutes ?? equipment.defaultDurationMinutes ?? equipment.duration_minutes ?? equipment.durationMinutes);
    return {
        id: equipment.id || equipment.local_id || generateLocalId('equipment'),
        code,
        label: (equipment.label || equipment.name || code).trim(),
        capacity: Math.max(0, Number(equipment.capacity ?? 1)),
        default_duration_minutes: duration,
        defaultDurationMinutes: duration,
        display_order: Number(equipment.display_order ?? (index + 1) * 10),
        is_active: equipment.is_active !== false
    };
}

function normalizeTreatmentRoomCodes(value) {
    let raw = [];
    if (Array.isArray(value)) {
        raw = value;
    } else if (typeof value === 'string') {
        const stripped = value.trim();
        if (stripped.startsWith('[')) {
            try {
                const parsed = JSON.parse(stripped);
                raw = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                raw = [];
            }
        }
        if (!raw.length) {
            raw = stripped.split(/[、,\n]/);
        }
    }
    const result = [];
    raw.forEach(item => {
        const code = String(typeof item === 'object' ? item.code || item.room_code || item.roomCode || '' : item || '').trim();
        if (code && !result.includes(code)) result.push(code);
    });
    return result;
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

function mergeDefaultTreatmentRooms(rooms = []) {
    const normalizedRooms = Array.isArray(rooms)
        ? rooms.map(normalizeTreatmentRoom).filter(room => room.is_active !== false)
        : [];
    const existingByCode = new Map(normalizedRooms.map(room => [room.code, room]));
    const defaultCodes = new Set(DEFAULT_TREATMENT_ROOMS.map(room => room.code));
    const merged = DEFAULT_TREATMENT_ROOMS.map((defaultRoom, index) => {
        const existing = existingByCode.get(defaultRoom.code);
        return normalizeTreatmentRoom({
            ...defaultRoom,
            ...existing,
            code: defaultRoom.code,
            label: existing?.label || defaultRoom.label,
            capacity: existing?.capacity ?? defaultRoom.capacity,
            display_order: defaultRoom.display_order ?? (index + 1) * 10,
            is_active: existing?.is_active ?? true
        }, index);
    });
    normalizedRooms.forEach(room => {
        if (LEGACY_TREATMENT_ROOM_CODES.has(room.code)) return;
        if (defaultCodes.has(room.code)) return;
        merged.push(room);
    });
    return merged.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
}

function normalizeTreatmentEquipmentRequirements(value, fallback = {}) {
    if (!treatmentMenuUsesEquipment(fallback, fallback.code || fallback.id || fallback.equipment_code || fallback.equipmentCode)) {
        return [];
    }

    let raw = [];
    if (Array.isArray(value)) {
        raw = value;
    } else if (typeof value === 'string') {
        const stripped = value.trim();
        if (stripped.startsWith('[')) {
            try {
                const parsed = JSON.parse(stripped);
                raw = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                raw = [];
            }
        } else if (stripped) {
            raw = stripped.split(/[、,\n]/).map(code => ({ resource_code: code.trim() }));
        }
    }

    const byCode = new Map((state.treatmentEquipment || []).map(item => [item.code, item]));
    const result = [];
    const addRequirement = (item, index = 0) => {
        const code = String(
            item.resource_code ||
            item.resourceCode ||
            item.equipment_code ||
            item.equipmentCode ||
            item.code ||
            ''
        ).trim();
        if (!code) return;
        const master = byCode.get(code);
        const duration = normalizeTreatmentDurationMinutes(
            item.duration_minutes ||
            item.durationMinutes ||
            item.duration ||
            master?.default_duration_minutes ||
            master?.defaultDurationMinutes ||
            fallback.duration_minutes ||
            fallback.durationMinutes
        );
        if (!duration) return;
        const label = String(
            item.resource_label ||
            item.resourceLabel ||
            item.equipment_label ||
            item.equipmentLabel ||
            item.label ||
            master?.label ||
            code
        ).trim();
        const existing = result.find(row => row.resource_code === code);
        const next = {
            resource_code: code,
            resourceCode: code,
            resource_label: label,
            resourceLabel: label,
            duration_minutes: duration,
            durationMinutes: duration,
            source: String(item.source || (index === 0 ? 'main' : 'set')).slice(0, 20)
        };
        if (!existing) {
            result.push(next);
        } else if (duration > Number(existing.duration_minutes || 0)) {
            Object.assign(existing, next);
        }
    };
    raw.forEach(addRequirement);
    if (!result.length) {
        const fallbackCode = String(fallback.equipment_code || fallback.equipmentCode || fallback.code || '').trim();
        if (fallbackCode) {
            addRequirement({
                resource_code: fallbackCode,
                resource_label: fallback.equipment_label || fallback.equipmentLabel || fallback.label || fallbackCode,
                duration_minutes: fallback.duration_minutes || fallback.durationMinutes || fallback.set_duration_minutes || fallback.setDurationMinutes,
                source: 'main'
            });
        }
    }
    return result;
}

function loadStoredTreatmentRooms() {
    try {
        const raw = localStorage.getItem(getClinicStorageKey(TREATMENT_ROOM_STORAGE_KEY));
        const parsed = raw ? JSON.parse(raw) : DEFAULT_TREATMENT_ROOMS;
        state.treatmentRooms = mergeDefaultTreatmentRooms(Array.isArray(parsed) ? parsed : DEFAULT_TREATMENT_ROOMS);
    } catch (error) {
        console.error('Treatment room storage load error:', error);
        state.treatmentRooms = mergeDefaultTreatmentRooms(DEFAULT_TREATMENT_ROOMS);
    }
    return state.treatmentRooms;
}

function saveStoredTreatmentRooms() {
    localStorage.setItem(getClinicStorageKey(TREATMENT_ROOM_STORAGE_KEY), JSON.stringify((state.treatmentRooms || []).map(normalizeTreatmentRoom)));
}

function loadStoredTreatmentEquipment() {
    try {
        const raw = localStorage.getItem(getClinicStorageKey(TREATMENT_EQUIPMENT_STORAGE_KEY));
        const parsed = raw ? JSON.parse(raw) : DEFAULT_TREATMENT_EQUIPMENT;
        state.treatmentEquipment = Array.isArray(parsed) ? parsed.map(normalizeTreatmentEquipment).filter(item => item.is_active !== false) : [];
    } catch (error) {
        console.error('Treatment equipment storage load error:', error);
        state.treatmentEquipment = DEFAULT_TREATMENT_EQUIPMENT.map(normalizeTreatmentEquipment);
    }
    return state.treatmentEquipment;
}

function saveStoredTreatmentEquipment() {
    localStorage.setItem(getClinicStorageKey(TREATMENT_EQUIPMENT_STORAGE_KEY), JSON.stringify((state.treatmentEquipment || []).map(normalizeTreatmentEquipment)));
}

function normalizeTreatmentStaff(staff, index = 0) {
    const role = staff.role || staff.resource_type || staff.group || 'nurse';
    return {
        id: staff.id || staff.local_id || generateLocalId('staff'),
        name: (staff.name || '').trim(),
        role: normalizeTreatmentResourceType(role, 'nurse'),
        display_order: Number(staff.display_order ?? (index + 1) * 10),
        is_active: staff.is_active !== false
    };
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

function makeDefaultTreatmentStaff(capacities = state.treatmentResourceCapacities) {
    const doctorCount = Math.max(0, Number(capacities?.doctor ?? 1));
    const nurseCount = Math.max(0, Number(capacities?.nurse ?? 2));
    const clerkCount = Math.max(0, Number(capacities?.clerk ?? 1));
    return [
        ...Array.from({ length: doctorCount }, (_, index) => normalizeTreatmentStaff({
            name: '島原　立樹',
            role: 'doctor',
            display_order: (index + 1) * 10
        })),
        ...Array.from({ length: nurseCount }, (_, index) => normalizeTreatmentStaff({
            name: `看護師${index + 1}`,
            role: 'nurse',
            display_order: (doctorCount + index + 1) * 10
        })),
        ...Array.from({ length: clerkCount }, (_, index) => normalizeTreatmentStaff({
            name: clerkCount > 1 ? `事務員${index + 1}` : '事務員',
            role: 'clerk',
            display_order: (doctorCount + nurseCount + index + 1) * 10
        }))
    ];
}

function syncTreatmentResourceCapacitiesFromStaff() {
    const activeStaff = (state.treatmentStaff || []).filter(staff => staff.is_active !== false && staff.name);
    state.treatmentResourceCapacities = {
        doctor: activeStaff.filter(staff => staff.role === 'doctor').length,
        nurse: activeStaff.filter(staff => staff.role === 'nurse').length,
        clerk: activeStaff.filter(staff => staff.role === 'clerk').length
    };
    saveStoredTreatmentResourceCapacities();
    return state.treatmentResourceCapacities;
}

function loadStoredTreatmentStaff() {
    try {
        const key = getClinicStorageKey(TREATMENT_STAFF_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        state.treatmentStaff = Array.isArray(parsed)
            ? parsed.map(normalizeTreatmentStaff).filter(staff => staff.is_active !== false)
            : makeDefaultTreatmentStaff();
        syncTreatmentResourceCapacitiesFromStaff();
        return state.treatmentStaff;
    } catch (error) {
        console.error('Treatment staff storage load error:', error);
        state.treatmentStaff = makeDefaultTreatmentStaff();
        syncTreatmentResourceCapacitiesFromStaff();
        return state.treatmentStaff;
    }
}

function hasStoredTreatmentStaff() {
    return localStorage.getItem(getClinicStorageKey(TREATMENT_STAFF_STORAGE_KEY)) !== null;
}

function saveStoredTreatmentStaff() {
    state.treatmentStaff = (state.treatmentStaff || [])
        .map(normalizeTreatmentStaff)
        .filter(staff => staff.name);
    localStorage.setItem(getClinicStorageKey(TREATMENT_STAFF_STORAGE_KEY), JSON.stringify(state.treatmentStaff));
    syncTreatmentResourceCapacitiesFromStaff();
}

function getStoredDepartments() {
    return getDepartmentGroupsForDisplay()
        .flatMap(group => group.departments || [])
        .filter(Boolean);
}

function findStoredDepartmentById(id) {
    return getStoredDepartments().find(dept => String(dept.id) === String(id)) || null;
}

function ensureDepartmentTargetGroup(groupId = '') {
    const groups = ensureEditableDepartmentGroups();
    let target = groupId ? groups.find(group => String(group.id) === String(groupId)) : null;

    if (!target) {
        target = groups[0];
    }

    if (!target) {
        target = {
            id: generateLocalId('group'),
            name: '診療科',
            collapsed: false,
            departments: []
        };
        groups.push(target);
    }

    target.departments = target.departments || [];
    return target;
}

function saveStoredDepartment(data) {
    const groups = ensureEditableDepartmentGroups();
    const departmentId = data.id || generateLocalId('dept');
    let existing = null;

    groups.forEach(group => {
        const index = (group.departments || []).findIndex(dept => String(dept.id) === String(departmentId));
        if (index >= 0) {
            existing = group.departments[index];
            group.departments.splice(index, 1);
        }
    });

    const targetGroup = ensureDepartmentTargetGroup(data.groupId || existing?.groupId || '');
    const department = {
        ...existing,
        ...data,
        id: departmentId,
        groupId: targetGroup.id,
        name: (data.name || existing?.name || '').trim(),
        description: data.description || existing?.description || '',
        default_duration: Number(data.default_duration || existing?.default_duration || 15),
        min_advance_hours: Number(data.min_advance_hours || existing?.min_advance_hours || 1),
        is_visible: data.is_visible ?? existing?.is_visible ?? true,
        is_active: data.is_active ?? existing?.is_active ?? true
    };

    targetGroup.departments.push(department);
    saveStoredDepartmentGroups();
    return department;
}

function loadLocalReservationsForCurrentClinic(params = {}) {
    try {
        const raw = localStorage.getItem(PATIENT_RESERVATION_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(reservation => {
                if (state.currentClinicId && !reservationBelongsToCurrentClinic(reservation)) {
                    return false;
                }
                if (params.date_from && reservation.reservation_date < params.date_from) return false;
                if (params.date_to && reservation.reservation_date > params.date_to) return false;
                if (params.status && reservation.status !== params.status) return false;
                return reservation.status !== 'cancelled';
            })
            .map(reservation => ({
                ...reservation,
                id: reservation.id || reservation.reservation_number,
                facility_id: reservation.facility_id || '',
                status: reservation.status || 'confirmed',
                treatment_menu_label: reservation.treatment_menu_label || '',
                treatment_resource_type: reservation.treatment_resource_type || '',
                patient_name_kana: reservation.patient_name_kana || '',
                patient_email: reservation.patient_email || '',
                patient_birthdate: reservation.patient_birthdate || null,
                symptoms: reservation.symptoms || '',
                notes: reservation.notes || '',
                created_at: reservation.created_at || '',
                checked_in_at: reservation.checked_in_at || null,
                cancelled_at: reservation.cancelled_at || null,
                local_only: true
            }));
    } catch (error) {
        console.error('Local reservation load error:', error);
        return [];
    }
}

function mergeReservationSources(apiReservations, localReservations, options = {}) {
    const includeLocalOnly = options.includeLocalOnly === true;
    const localByNumber = new Map(
        localReservations
            .filter(reservation => reservation.reservation_number)
            .map(reservation => [reservation.reservation_number, reservation])
    );
    const merged = [];
    const usedLocalNumbers = new Set();

    (apiReservations || []).forEach(reservation => {
        const local = localByNumber.get(reservation.reservation_number);
        if (local) usedLocalNumbers.add(local.reservation_number);
        merged.push({
            ...reservation,
            clinic_id: local?.clinic_id || reservation.clinic_id || '',
            clinic_name: local?.clinic_name || reservation.clinic_name || '',
            treatment_detail_menu: local?.treatment_detail_menu || reservation.treatment_detail_menu || null,
            treatment_detail_menu_label: local?.treatment_detail_menu_label || reservation.treatment_detail_menu_label || '',
            treatment_detail_price: local?.treatment_detail_price || reservation.treatment_detail_price || '',
            treatment_display_label: local?.treatment_display_label || reservation.treatment_display_label || reservation.treatment_menu_label || ''
        });
    });

    if (includeLocalOnly) {
        localReservations.forEach(reservation => {
            if (!reservation.reservation_number || !usedLocalNumbers.has(reservation.reservation_number)) {
                merged.push(reservation);
            }
        });
    }

    return merged;
}

function upsertPatientReservationCache(reservations = []) {
    try {
        const raw = localStorage.getItem(PATIENT_RESERVATION_STORAGE_KEY);
        const existing = raw ? JSON.parse(raw) : [];
        const byNumber = new Map(
            (Array.isArray(existing) ? existing : [])
                .filter(reservation => reservation?.reservation_number)
                .map(reservation => [reservation.reservation_number, reservation])
        );

        let changed = false;
        (reservations || []).forEach(reservation => {
            if (!reservation?.reservation_number) return;
            const current = byNumber.get(reservation.reservation_number) || {};
            const next = {
                ...current,
                ...reservation,
                patient_no: reservation.patient_no || current.patient_no || '',
                local_only: false
            };
            if (JSON.stringify(current) !== JSON.stringify(next)) {
                byNumber.set(reservation.reservation_number, next);
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem(PATIENT_RESERVATION_STORAGE_KEY, JSON.stringify(Array.from(byNumber.values())));
        }
        return changed;
    } catch (error) {
        console.error('Patient reservation cache update error:', error);
        return false;
    }
}

function removeLocalReservation(reservationNumber) {
    const raw = localStorage.getItem(PATIENT_RESERVATION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return false;
    const next = parsed.filter(reservation => reservation.reservation_number !== reservationNumber);
    localStorage.setItem(PATIENT_RESERVATION_STORAGE_KEY, JSON.stringify(next));
    return next.length !== parsed.length;
}

function normalizeQuestionnaireList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.questionnaires)) return data.questionnaires;
    return [];
}

function normalizeQuestionnaireItem(item) {
    return {
        ...item,
        type: item.type || item.item_type || 'text',
        required: Boolean(item.required ?? item.is_required),
        customizable: Boolean(item.customizable ?? item.is_customizable),
        customLabel: item.customLabel || item.custom_label || item.label,
        customOptions: item.customOptions || item.options || [],
        options: item.options || item.customOptions || []
    };
}

function normalizeQuestionnaireDetail(questionnaire) {
    return {
        ...questionnaire,
        items: (questionnaire.items || []).map(normalizeQuestionnaireItem),
        departments: questionnaire.departments || questionnaire.department_ids || []
    };
}

function getDepartmentOptions() {
    const realOptions = state.departments.map(department => ({
        id: department.id,
        name: department.name,
        locked: false,
        real: true
    }));

    const existingIds = new Set(realOptions.map(option => String(option.id)));
    const localOptions = getStoredDepartments()
        .filter(department => !existingIds.has(String(department.id)))
        .map(department => ({
            id: department.id,
            name: department.name,
            locked: false,
            real: false
        }));

    const realNames = new Set([...realOptions, ...localOptions].map(option => option.name));
    const sampleOptions = sampleDepartmentOptions
        .filter(name => !realNames.has(name))
        .map((name, index) => ({
            id: `sample-${index}`,
            name,
            locked: lockedSampleDepartmentNames.has(name),
            real: false
        }));

    return [...realOptions, ...localOptions, ...sampleOptions];
}

function optionRange(start, end, selected, pad = true) {
    const items = [];
    for (let value = start; value <= end; value += 1) {
        const label = pad ? String(value).padStart(2, '0') : String(value);
        items.push(`<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${label}</option>`);
    }
    return items.join('');
}

function yearOptions(selected = new Date().getFullYear(), includeBlank = false) {
    const current = new Date().getFullYear();
    const blanks = includeBlank ? '<option value="">----</option>' : '';
    const options = [];
    for (let year = current - 1; year <= current + 4; year += 1) {
        const label = `${year}（令和${year - 2018}年）`;
        options.push(`<option value="${year}" ${Number(selected) === year ? 'selected' : ''}>${label}</option>`);
    }
    return blanks + options.join('');
}

function monthOptions(selected, includeBlank = false) {
    const blanks = includeBlank ? '<option value="">--</option>' : '';
    return blanks + optionRange(1, 12, selected);
}

function dayOptions(selected, includeBlank = false) {
    const blanks = includeBlank ? '<option value="">--</option>' : '';
    return blanks + optionRange(1, 31, selected);
}

function timeToParts(timeValue, fallbackHour = 9, fallbackMinute = 0) {
    if (!timeValue) return { hour: fallbackHour, minute: fallbackMinute };
    const [hour, minute] = String(timeValue).split(':').map(Number);
    return {
        hour: Number.isFinite(hour) ? hour : fallbackHour,
        minute: Number.isFinite(minute) ? minute : fallbackMinute
    };
}

function dateToParts(dateValue) {
    if (!dateValue) return { year: '', month: '', day: '' };
    const [year, month, day] = String(dateValue).split('-').map(Number);
    return { year, month, day };
}

function partsToDate(year, month, day) {
    if (!year || !month || !day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildRangeLabel(period) {
    const from = period.effective_from ? formatDateJP(period.effective_from) : '----/--/--';
    const until = period.effective_until ? formatDateJP(period.effective_until) : '';
    return `${from} 〜${until}`;
}

function formEndTime(hour, minute) {
    if (Number(hour) === 24) return '23:59';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatDateJP(dateStr) {
    const date = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}（${days[date.getDay()]}）`;
}

function weekdayFlagsFromTemplate(template) {
    const flags = [false, false, false, false, false, false, false, false];
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    flags[map[template.day_of_week]] = true;
    return flags;
}

function mergeDayFlags(rows) {
    return rows.reduce((flags, row) => {
        const days = normalizeWeekDayFlags(Array.isArray(row) ? row : row.days);
        return flags.map((value, index) => value || Boolean(days[index]));
    }, [false, false, false, false, false, false, false, false]);
}

function normalizeWeekDayFlags(days = []) {
    const source = Array.isArray(days) ? days : [];
    return Array.from({ length: 8 }, (_, index) => Boolean(source[index]));
}

function customCalendarToRow(calendar) {
    return {
        id: `custom-${calendar.id}`,
        calendarId: calendar.id,
        name: calendar.name,
        queue: '利用しない',
        closeOffset: `各枠終了${calendar.closeOffset || 0}分前`,
        periods: calendar.periods.map(period => ({
            range: buildRangeLabel(period),
            rows: period.rows.map(row => {
                // キャメルケースとスネークケースの両方に対応
                const slotDuration = row.slot_duration ?? row.slotDuration ?? 15;
                const firstDuration = row.first_duration ?? row.firstSlotDuration ?? 15;
                const revisitDuration = row.revisit_duration ?? row.returnSlotDuration ?? 15;
                const maxBookings = row.max_bookings ?? row.doctorCount ?? 1;
                return {
                    time: `${row.start_time}〜${row.end_time === '23:59' ? '24:00' : row.end_time}`,
                    days: normalizeWeekDayFlags(row.days),
                    setting: `${slotDuration}分枠 初診${firstDuration}分 再診${revisitDuration}分 医師${maxBookings}人`
                };
            })
        })),
        closures: calendar.temporarySettings.length
            ? calendar.temporarySettings.map(setting => {
                // 新形式の場合
                if (setting.periodType) {
                    let dateText;
                    if (setting.periodType === 'yearly') {
                        dateText = `毎年${String(setting.fromMonth).padStart(2, '0')}/${String(setting.fromDay).padStart(2, '0')}〜${String(setting.untilMonth).padStart(2, '0')}/${String(setting.untilDay).padStart(2, '0')}`;
                    } else {
                        const fromDate = `${setting.fromYear}/${String(setting.onceFromMonth).padStart(2, '0')}/${String(setting.onceFromDay).padStart(2, '0')}`;
                        const untilDate = `${setting.untilYear}/${String(setting.onceUntilMonth).padStart(2, '0')}/${String(setting.onceUntilDay).padStart(2, '0')}`;
                        dateText = fromDate === untilDate ? fromDate : `${fromDate}〜${untilDate}`;
                    }
                    const statusText = setting.status === 'closed'
                        ? '全日休診'
                        : `${setting.start_time}〜${setting.end_time} ${setting.slotDuration}分枠`;
                    return `${dateText} ${statusText}`;
                }
                // 旧形式の場合
                const timeText = setting.type === 'modified'
                    ? ` ${setting.start_time}〜${setting.end_time}`
                    : ' 全日休診';
                return `${setting.date.replaceAll('-', '/')}${timeText}`;
            })
            : []
    };
}

function buildCalendarRows() {
    const customRows = state.customCalendars.map(customCalendarToRow);
    const realRows = state.departments.map((department) => {
        const templates = state.templates.filter(t => t.department_id === department.id);
        const grouped = new Map();

        templates.forEach((template) => {
            const key = `${template.start_time}-${template.end_time}-${template.slot_duration}-${template.max_bookings}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(template);
        });

        const rows = Array.from(grouped.values()).map((group) => {
            const first = group[0];
            return {
                time: `${first.start_time.slice(0, 5)}〜${first.end_time.slice(0, 5)}`,
                days: mergeDayFlags(group.map(weekdayFlagsFromTemplate)),
                setting: `${first.slot_duration}分枠 医師${first.max_bookings}人`
            };
        });

        return {
            id: department.id,
            departmentId: department.id,
            name: department.name,
            queue: '利用しない',
            closeOffset: `各枠終了${department.min_advance_hours ? department.min_advance_hours * 60 : 0}分前`,
            periods: [
                {
                    range: `${formatDateJP(new Date().toISOString())}〜`,
                    rows: rows.length ? rows : [
                        {
                            time: `09:00〜${String(9 + Math.ceil((department.default_duration || 15) / 15)).padStart(2, '0')}:00`,
                            days: [true, true, true, true, true, false, false, false],
                            setting: `${department.default_duration || 15}分枠 医師1人`
                        }
                    ]
                }
            ],
            closures: []
        };
    });

    const neededPreviewRows = Math.max(0, 7 - realRows.length);
    return [
        ...customRows,
        ...realRows,
        ...calendarPreviewRows.slice(0, Math.max(0, neededPreviewRows - customRows.length))
    ];
}

function renderMiniSchedule(period) {
    const dayLabels = ['月', '火', '水', '木', '金', '土', '日', '祝'];
    const dayClasses = ['', '', '', '', '', 'sat', 'sun', 'holiday'];

    return `
        <div class="schedule-period">
            <div class="schedule-period-range">${period.range}</div>
            <table class="mini-schedule">
                <thead>
                    <tr>
                        <th>診療時間</th>
                        ${dayLabels.map((day, index) => `<th class="${dayClasses[index]}">${day}</th>`).join('')}
                        <th>枠設定</th>
                    </tr>
                </thead>
                <tbody>
                    ${period.rows.map(row => {
                        const days = normalizeWeekDayFlags(row.days);
                        return `
                        <tr>
                            <td class="time-cell">${row.time}</td>
                            ${days.map((active) => `<td>${active ? '<span class="schedule-dot"></span>' : '<span class="schedule-dash">-</span>'}</td>`).join('')}
                            <td class="setting-cell">${row.setting}</td>
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
            ${period.note ? `<div class="schedule-note">${period.note}</div>` : ''}
        </div>
    `;
}

function defaultScheduleRow() {
    return {
        start_time: '09:00',
        end_time: '12:00',
        days: [false, false, false, false, false, false, false, false],
        slot_duration: 15,
        first_duration: 15,
        revisit_duration: 15,
        max_bookings: 1,
        weeks: [true, true, true, true, true, true]
    };
}

function defaultPeriod() {
    return {
        id: generateLocalId('period'),
        effective_from: utils.formatDate(new Date()),
        effective_until: null,
        rows: [defaultScheduleRow()]
    };
}

function renderDepartmentCheckboxes(selectedIds = []) {
    const grid = document.getElementById('calendarDepartmentGrid');
    const selected = new Set(selectedIds);
    grid.innerHTML = getDepartmentOptions().map(option => `
        <label class="link-check-item ${selected.has(option.id) ? 'checked' : ''} ${option.locked ? 'locked' : ''}">
            <input
                type="checkbox"
                class="calendar-dept-checkbox"
                value="${escapeHTML(option.id)}"
                data-name="${escapeHTML(option.name)}"
                data-real="${option.real ? 'true' : 'false'}"
                ${option.locked ? 'disabled' : ''}
                ${selected.has(option.id) ? 'checked' : ''}
            >
            <span class="item-name">${escapeHTML(option.name)}</span>
            ${option.locked ? '<span class="lock-icon" aria-hidden="true"></span>' : ''}
        </label>
    `).join('');

    // チェック状態の変更でスタイル更新
    grid.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            checkbox.closest('.link-check-item').classList.toggle('checked', checkbox.checked);
        });
    });
}

function renderStaffCheckboxes(selectedIds = []) {
    const grid = document.getElementById('calendarStaffGrid');
    if (!grid) return;
    const selected = new Set(selectedIds.map(id => String(id)));
    if (!state.treatmentStaff.length) {
        loadStoredTreatmentStaff();
    }
    const staffOptions = (state.treatmentStaff || []).filter(staff => staff.is_active !== false && staff.name);
    if (!staffOptions.length) {
        grid.innerHTML = '<div class="text-muted">施術メニュー画面でスタッフを登録してください</div>';
        return;
    }
    grid.innerHTML = staffOptions.map(staff => `
        <label class="link-check-item ${selected.has(String(staff.id)) ? 'checked' : ''}">
            <input
                type="checkbox"
                class="calendar-staff-checkbox"
                value="${staff.id}"
                data-name="${escapeHTML(staff.name)}"
                data-role="${escapeHTML(staff.role)}"
                ${selected.has(String(staff.id)) ? 'checked' : ''}
            >
            <span class="item-name">${escapeHTML(staff.name)}</span>
            <span class="item-role">${escapeHTML(getTreatmentResourceLabel(staff.role))}</span>
        </label>
    `).join('');

    // チェック状態の変更でスタイル更新
    grid.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            checkbox.closest('.link-check-item').classList.toggle('checked', checkbox.checked);
        });
    });
}

function renderHourMinuteSelects(prefix, hour, minute, allow24 = false) {
    const maxHour = allow24 ? 24 : 23;
    return `
        <select class="calendar-select ${prefix}-hour">${optionRange(0, maxHour, hour)}</select>
        <span>時</span>
        <select class="calendar-select ${prefix}-minute">${optionRange(0, 55, minute)}</select>
        <span>分</span>
    `;
}

function renderScheduleRow(row = defaultScheduleRow()) {
    const start = timeToParts(row.start_time, 9, 0);
    const end = row.end_time === '23:59'
        ? { hour: 24, minute: 0 }
        : timeToParts(row.end_time, 12, 0);
    const dayClasses = ['', '', '', '', '', 'sat', 'sun', 'holiday'];
    const days = normalizeWeekDayFlags(row.days);

    return `
        <div class="schedule-config-row">
            <div class="schedule-time-controls">
                ${renderHourMinuteSelects('schedule-start', start.hour, start.minute)}
                <span>〜</span>
                ${renderHourMinuteSelects('schedule-end', end.hour, end.minute, true)}
            </div>
            ${days.map((checked, index) => `
                <label class="day-circle ${dayClasses[index]}">
                    <input type="checkbox" class="schedule-day" data-day-index="${index}" ${checked ? 'checked' : ''}>
                    <span></span>
                </label>
            `).join('')}
            <div class="schedule-slot-controls">
                <input type="number" class="slot-duration-input" min="1" value="${row.slot_duration}">
                <span>分枠・初診</span>
                <input type="number" class="first-duration-input" min="1" value="${row.first_duration}">
                <span>分・再診</span>
                <input type="number" class="revisit-duration-input" min="1" value="${row.revisit_duration}">
                <span>分・医師</span>
                <input type="number" class="max-bookings-input" min="1" value="${row.max_bookings}">
                <span>人</span>
                <button type="button" class="remove-inline-btn remove-time-row" title="削除">×</button>
            </div>
            <div class="week-checks">
                ${[1, 2, 3, 4, 5, 6].map((week, index) => `
                    <label><input type="checkbox" class="week-check" data-week="${week}" ${row.weeks?.[index] !== false ? 'checked' : ''}> 第${week}</label>
                `).join('')}
            </div>
        </div>
    `;
}

function renderCalendarPeriod(period = defaultPeriod()) {
    const from = dateToParts(period.effective_from);
    const until = dateToParts(period.effective_until);

    return `
        <div class="calendar-period-block">
            <div class="calendar-field-row target-period-row">
                <div class="field-label">対象期間<span class="required">*</span></div>
                <select class="calendar-select period-from-year">${yearOptions(from.year || new Date().getFullYear())}</select><span>年</span>
                <select class="calendar-select period-from-month">${monthOptions(from.month || 1)}</select><span>月</span>
                <select class="calendar-select period-from-day">${dayOptions(from.day || 1)}</select><span>日</span>
                <span>〜</span>
                <select class="calendar-select period-until-year">${yearOptions(until.year, true)}</select><span>年</span>
                <select class="calendar-select period-until-month">${monthOptions(until.month, true)}</select><span>月</span>
                <select class="calendar-select period-until-day">${dayOptions(until.day, true)}</select><span>日</span>
            </div>

            <div class="schedule-config-table">
                <div class="schedule-config-head">
                    <div>診療時間</div>
                    <div>月</div>
                    <div>火</div>
                    <div>水</div>
                    <div>木</div>
                    <div>金</div>
                    <div class="sat">土</div>
                    <div class="sun">日</div>
                    <div class="holiday">祝</div>
                    <div>枠設定</div>
                </div>
                <div class="schedule-config-rows">
                    ${period.rows.map(renderScheduleRow).join('')}
                </div>
            </div>

            <div class="time-change-note">初再診時間を変更すると変更前に取得された予約の初再診時間も変更されます。</div>
        </div>
    `;
}

function renderTemporarySetting(setting = {}) {
    const id = generateLocalId('temp');
    const periodType = setting.periodType || 'once';  // 'yearly' or 'once'
    const status = setting.status || 'closed';  // 'closed' or 'open'

    // 毎年の場合: 月日のみ
    const fromMonth = setting.fromMonth || 12;
    const fromDay = setting.fromDay || 28;
    const untilMonth = setting.untilMonth || 12;
    const untilDay = setting.untilDay || 31;

    // 一回のみの場合: 年月日
    const fromYear = setting.fromYear || new Date().getFullYear();
    const untilYear = setting.untilYear || new Date().getFullYear();
    const onceFromMonth = setting.onceFromMonth || (new Date().getMonth() + 1);
    const onceFromDay = setting.onceFromDay || new Date().getDate();
    const onceUntilMonth = setting.onceUntilMonth || (new Date().getMonth() + 1);
    const onceUntilDay = setting.onceUntilDay || new Date().getDate();

    // 診療時の設定
    const start = timeToParts(setting.start_time, 9, 0);
    const end = timeToParts(setting.end_time, 18, 0);
    const slotDuration = setting.slotDuration || 10;
    const firstDuration = setting.firstDuration || 10;
    const revisitDuration = setting.revisitDuration || 10;
    const maxBookings = setting.maxBookings || 1;

    return `
        <div class="temporary-setting-block" data-id="${id}">
            <div class="temp-setting-header">
                <button type="button" class="remove-temp-btn remove-temporary-row" title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </div>

            <div class="temp-setting-row">
                <div class="temp-field-label">対象期間</div>
                <div class="temp-field-content">
                    <div class="temp-period-options">
                        <label class="radio-label">
                            <input type="radio" name="periodType-${id}" value="yearly" class="temp-period-type" ${periodType === 'yearly' ? 'checked' : ''}>
                            毎年
                        </label>
                        <div class="temp-yearly-fields ${periodType === 'yearly' ? '' : 'hidden'}">
                            <select class="calendar-select temp-from-month">${monthOptions(fromMonth)}</select><span>月</span>
                            <select class="calendar-select temp-from-day">${dayOptions(fromDay)}</select><span>日</span>
                            <span class="range-separator">〜</span>
                            <select class="calendar-select temp-until-month">${monthOptions(untilMonth)}</select><span>月</span>
                            <select class="calendar-select temp-until-day">${dayOptions(untilDay)}</select><span>日</span>
                        </div>
                    </div>
                    <div class="temp-period-options">
                        <label class="radio-label">
                            <input type="radio" name="periodType-${id}" value="once" class="temp-period-type" ${periodType === 'once' ? 'checked' : ''}>
                            一回のみ
                        </label>
                        <div class="temp-once-fields ${periodType === 'once' ? '' : 'hidden'}">
                            <select class="calendar-select temp-once-from-year">${yearOptions(fromYear)}</select><span>年</span>
                            <select class="calendar-select temp-once-from-month">${monthOptions(onceFromMonth)}</select><span>月</span>
                            <select class="calendar-select temp-once-from-day">${dayOptions(onceFromDay)}</select><span>日</span>
                            <span class="range-separator">〜</span>
                            <select class="calendar-select temp-once-until-year">${yearOptions(untilYear)}</select><span>年</span>
                            <select class="calendar-select temp-once-until-month">${monthOptions(onceUntilMonth)}</select><span>月</span>
                            <select class="calendar-select temp-once-until-day">${dayOptions(onceUntilDay)}</select><span>日</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="temp-setting-row">
                <div class="temp-field-label">診療・休診</div>
                <div class="temp-field-content">
                    <div class="temp-status-options">
                        <label class="radio-label">
                            <input type="radio" name="status-${id}" value="closed" class="temp-status" ${status === 'closed' ? 'checked' : ''}>
                            休診
                        </label>
                    </div>
                    <div class="temp-status-options">
                        <label class="radio-label">
                            <input type="radio" name="status-${id}" value="open" class="temp-status" ${status === 'open' ? 'checked' : ''}>
                            診療
                        </label>
                        <div class="temp-open-fields ${status === 'open' ? '' : 'hidden'}">
                            ${renderHourMinuteSelects('temp-start', start.hour, start.minute)}
                            <span class="range-separator">〜</span>
                            ${renderHourMinuteSelects('temp-end', end.hour, end.minute)}
                            <span class="slot-separator"></span>
                            <input type="number" class="temp-slot-duration" min="1" value="${slotDuration}">
                            <span>分枠・初診</span>
                            <input type="number" class="temp-first-duration" min="1" value="${firstDuration}">
                            <span>分・再診</span>
                            <input type="number" class="temp-revisit-duration" min="1" value="${revisitDuration}">
                            <span>分・医師</span>
                            <input type="number" class="temp-max-bookings" min="1" value="${maxBookings}">
                            <span>人</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderTimeSelectOptions() {
    document.getElementById('calendarStartHour').innerHTML = optionRange(0, 23, 0);
    document.getElementById('calendarStartMinute').innerHTML = optionRange(0, 55, 0);
}

function readScheduleRow(rowElement) {
    const startHour = rowElement.querySelector('.schedule-start-hour').value;
    const startMinute = rowElement.querySelector('.schedule-start-minute').value;
    const endHour = rowElement.querySelector('.schedule-end-hour').value;
    const endMinute = rowElement.querySelector('.schedule-end-minute').value;

    return {
        start_time: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
        end_time: formEndTime(endHour, endMinute),
        days: Array.from(rowElement.querySelectorAll('.schedule-day')).map(input => input.checked),
        slot_duration: parseInt(rowElement.querySelector('.slot-duration-input').value, 10) || 15,
        first_duration: parseInt(rowElement.querySelector('.first-duration-input').value, 10) || 15,
        revisit_duration: parseInt(rowElement.querySelector('.revisit-duration-input').value, 10) || 15,
        max_bookings: parseInt(rowElement.querySelector('.max-bookings-input').value, 10) || 1,
        weeks: Array.from(rowElement.querySelectorAll('.week-check')).map(input => input.checked)
    };
}

function readPeriod(periodElement) {
    const fromDate = partsToDate(
        periodElement.querySelector('.period-from-year').value,
        periodElement.querySelector('.period-from-month').value,
        periodElement.querySelector('.period-from-day').value
    );
    const untilDate = partsToDate(
        periodElement.querySelector('.period-until-year').value,
        periodElement.querySelector('.period-until-month').value,
        periodElement.querySelector('.period-until-day').value
    );

    return {
        id: generateLocalId('period'),
        effective_from: fromDate,
        effective_until: untilDate,
        rows: Array.from(periodElement.querySelectorAll('.schedule-config-row')).map(readScheduleRow)
    };
}

function readTemporarySetting(blockElement) {
    const periodType = blockElement.querySelector('.temp-period-type:checked')?.value || 'once';
    const status = blockElement.querySelector('.temp-status:checked')?.value || 'closed';

    // 毎年の場合
    const fromMonth = parseInt(blockElement.querySelector('.temp-from-month')?.value, 10) || 1;
    const fromDay = parseInt(blockElement.querySelector('.temp-from-day')?.value, 10) || 1;
    const untilMonth = parseInt(blockElement.querySelector('.temp-until-month')?.value, 10) || 1;
    const untilDay = parseInt(blockElement.querySelector('.temp-until-day')?.value, 10) || 1;

    // 一回のみの場合
    const fromYear = parseInt(blockElement.querySelector('.temp-once-from-year')?.value, 10) || new Date().getFullYear();
    const onceFromMonth = parseInt(blockElement.querySelector('.temp-once-from-month')?.value, 10) || 1;
    const onceFromDay = parseInt(blockElement.querySelector('.temp-once-from-day')?.value, 10) || 1;
    const untilYear = parseInt(blockElement.querySelector('.temp-once-until-year')?.value, 10) || new Date().getFullYear();
    const onceUntilMonth = parseInt(blockElement.querySelector('.temp-once-until-month')?.value, 10) || 1;
    const onceUntilDay = parseInt(blockElement.querySelector('.temp-once-until-day')?.value, 10) || 1;

    // 診療時間
    const startHour = blockElement.querySelector('.temp-start-hour')?.value || 9;
    const startMinute = blockElement.querySelector('.temp-start-minute')?.value || 0;
    const endHour = blockElement.querySelector('.temp-end-hour')?.value || 18;
    const endMinute = blockElement.querySelector('.temp-end-minute')?.value || 0;

    return {
        periodType,
        status,
        // 毎年用
        fromMonth,
        fromDay,
        untilMonth,
        untilDay,
        // 一回のみ用
        fromYear,
        onceFromMonth,
        onceFromDay,
        untilYear,
        onceUntilMonth,
        onceUntilDay,
        // 診療時間
        start_time: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
        end_time: formEndTime(endHour, endMinute),
        slotDuration: parseInt(blockElement.querySelector('.temp-slot-duration')?.value, 10) || 10,
        firstDuration: parseInt(blockElement.querySelector('.temp-first-duration')?.value, 10) || 10,
        revisitDuration: parseInt(blockElement.querySelector('.temp-revisit-duration')?.value, 10) || 10,
        maxBookings: parseInt(blockElement.querySelector('.temp-max-bookings')?.value, 10) || 1,
        // 旧フォーマット用に変換
        type: status === 'closed' ? 'closed' : 'modified',
        date: periodType === 'yearly'
            ? `毎年${String(fromMonth).padStart(2, '0')}/${String(fromDay).padStart(2, '0')}`
            : partsToDate(fromYear, onceFromMonth, onceFromDay)
    };
}

function readCalendarForm() {
    const calendarId = document.getElementById('calendarId').value || generateLocalId('calendar');
    const existingCalendar = state.customCalendars.find(item => item.id === calendarId);
    const selectedDepartments = Array.from(document.querySelectorAll('.calendar-dept-checkbox:checked')).map(input => ({
        id: input.value,
        name: input.dataset.name,
        real: input.dataset.real === 'true'
    }));

    const selectedStaff = Array.from(document.querySelectorAll('.calendar-staff-checkbox:checked')).map(input => ({
        id: input.value,
        name: input.dataset.name,
        role: input.dataset.role || 'nurse'
    }));

    return {
        id: calendarId,
        name: document.getElementById('calendarName').value.trim(),
        departments: selectedDepartments,
        staff: selectedStaff,
        closeOffset: parseInt(document.getElementById('calendarCloseOffset').value, 10) || 0,
        weekRule: document.querySelector('input[name="calendarWeekRule"]:checked')?.value || 'date',
        visitTimeMode: document.querySelector('input[name="calendarVisitTimeMode"]:checked')?.value || 'time',
        startRule: document.querySelector('input[name="calendarStartRule"]:checked')?.value || 'calendar',
        startMonthOffset: parseInt(document.getElementById('calendarStartMonthOffset').value, 10) || 6,
        startHour: parseInt(document.getElementById('calendarStartHour').value, 10) || 0,
        startMinute: parseInt(document.getElementById('calendarStartMinute').value, 10) || 0,
        timeDisplay: document.querySelector('input[name="calendarTimeDisplay"]:checked')?.value || 'range',
        holidayPriority: document.getElementById('holidayPriority').checked,
        periods: Array.from(document.querySelectorAll('.calendar-period-block')).map(readPeriod),
        temporarySettings: Array.from(document.querySelectorAll('.temporary-setting-block')).map(readTemporarySetting),
        syncedAt: existingCalendar?.syncedAt || null
    };
}

// UI
const ui = {
    // =====================================================
    // クリニック管理 UI
    // =====================================================

    // クリニックセレクターを描画
    renderClinicSelector() {
        const selector = document.getElementById('clinicSelector');
        const currentClinic = getCurrentClinic();
        const headerClinicName = document.getElementById('headerClinicName');
        if (headerClinicName) {
            headerClinicName.textContent = currentClinic?.name || '西春内科・在宅クリニック';
        }
        if (!selector) return;

        selector.innerHTML = state.clinics.map(clinic => `
            <option value="${clinic.id}" ${clinic.id === state.currentClinicId ? 'selected' : ''}>
                ${escapeHTML(clinic.name)}
            </option>
        `).join('');
    },

    // クリニック管理モーダルを表示
    showClinicModal() {
        const modal = document.getElementById('clinicManageModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this.renderClinicList();
    },

    // クリニック管理モーダルを閉じる
    hideClinicModal() {
        const modal = document.getElementById('clinicManageModal');
        if (!modal) return;
        modal.classList.add('hidden');
        document.getElementById('newClinicName').value = '';
    },

    // クリニック一覧を描画
    renderClinicList() {
        const list = document.getElementById('clinicList');
        if (!list) return;

        if (state.clinics.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 20px;">クリニックがありません</div>';
            return;
        }

        list.innerHTML = state.clinics.map(clinic => `
            <div class="clinic-list-item" data-clinic-id="${clinic.id}">
                <span class="clinic-item-name">${escapeHTML(clinic.name)}</span>
                <div class="clinic-item-actions">
                    <button type="button" class="clinic-item-btn edit admin-action-edit" data-action="edit">編集</button>
                    <button type="button" class="clinic-item-btn delete admin-action-delete" data-action="delete" ${state.clinics.length <= 1 ? 'disabled' : ''}>削除</button>
                </div>
            </div>
        `).join('');
    },

    // クリニック編集モードに切り替え
    startEditClinic(clinicId) {
        const item = document.querySelector(`.clinic-list-item[data-clinic-id="${clinicId}"]`);
        if (!item) return;

        const clinic = state.clinics.find(c => c.id === clinicId);
        if (!clinic) return;

        item.classList.add('editing');
        item.innerHTML = `
            <input type="text" class="clinic-item-input" value="${escapeHTML(clinic.name)}" data-clinic-id="${clinicId}">
            <div class="clinic-item-actions">
                <button type="button" class="clinic-item-btn save" data-action="save">保存</button>
                <button type="button" class="clinic-item-btn cancel" data-action="cancel">キャンセル</button>
            </div>
        `;

        const input = item.querySelector('.clinic-item-input');
        input.focus();
        input.select();
    },

    // クリニック編集を保存
    saveEditClinic(clinicId, newName) {
        if (!newName.trim()) {
            showAlert('クリニック名を入力してください');
            return;
        }

        updateClinic(clinicId, newName.trim());
        this.renderClinicList();
        this.renderClinicSelector();
    },

    // クリニックを削除
    async confirmDeleteClinic(clinicId) {
        const clinic = state.clinics.find(c => c.id === clinicId);
        if (!clinic) return;

        if (state.clinics.length <= 1) {
            showAlert('最低1つのクリニックが必要です');
            return;
        }

        if (confirm(`「${clinic.name}」を削除しますか？\n\nこのクリニックのデータは保持されますが、削除後は参照できなくなります。`)) {
            const wasCurrentClinic = state.currentClinicId === clinicId;
            deleteClinic(clinicId);
            this.renderClinicList();
            this.renderClinicSelector();

            if (wasCurrentClinic) {
                // データを再読み込み
                switchClinic(state.currentClinicId);
            }
        }
    },

    // 新規クリニックを追加
    addNewClinic() {
        const input = document.getElementById('newClinicName');
        const name = input.value.trim();

        if (!name) {
            showAlert('クリニック名を入力してください');
            return;
        }

        const clinic = addClinic(name);
        state.currentClinicId = clinic.id;
        saveCurrentClinicId();
        state.departmentGroups = [{
            id: generateLocalId('group'),
            name: '診療科',
            collapsed: false,
            departments: []
        }];
        state.customCalendars = [];
        state.questionnaires = [];
        state.treatmentMenus = [];
        state.treatmentStaff = makeDefaultTreatmentStaff({ doctor: 1, nurse: 2 });
        state.treatmentResourceCapacities = { doctor: 1, nurse: 2 };
        saveStoredDepartmentGroups();
        saveStoredCalendars();
        saveStoredQuestionnaires();
        saveStoredTreatmentMenus();
        saveStoredTreatmentStaff();
        saveStoredTreatmentResourceCapacities();
        input.value = '';
        switchClinic(clinic.id);
        this.renderClinicList();
        this.renderClinicSelector();
        showAlert(`「${name}」を追加しました`, 'success');
    },

    // =====================================================
    // 施設情報
    // =====================================================
    async loadFacilityInfo() {
        const fallback = loadStoredReviewSettings();
        state.reviewSettings = fallback;
        this.renderFacilityReviewSettings();

        try {
            const settings = await api.getReviewSettings();
            state.reviewSettings = normalizeReviewSettings(settings);
            saveStoredReviewSettings(state.reviewSettings);
            this.renderFacilityReviewSettings();
        } catch (error) {
            console.error('Review settings load error:', error);
            if (!fallback.googleReviewUrl) {
                showAlert('口コミリンク設定を取得できませんでした: ' + error.message, 'error');
            }
        }
    },

    renderFacilityReviewSettings() {
        const input = document.getElementById('googleReviewUrl');
        const openLink = document.getElementById('openGoogleReviewLink');
        const url = state.reviewSettings?.googleReviewUrl || '';
        if (input) input.value = url;
        if (openLink) {
            openLink.href = url || '#';
            openLink.classList.toggle('hidden', !url);
        }
    },

    cleanGoogleReviewUrl(value) {
        const url = String(value || '').trim();
        if (!url) return '';
        let parsed;
        try {
            parsed = new URL(url);
        } catch (error) {
            throw new Error('Google口コミURLを確認してください');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Google口コミURLは http または https で入力してください');
        }
        return url;
    },

    async saveFacilityReviewSettings() {
        const input = document.getElementById('googleReviewUrl');
        const saveButton = document.getElementById('saveFacilityReviewSettings');
        if (!input) return;

        let url;
        try {
            url = this.cleanGoogleReviewUrl(input.value);
        } catch (error) {
            showAlert(error.message, 'error');
            return;
        }

        if (saveButton) saveButton.disabled = true;
        try {
            const settings = await api.updateReviewSettings({ google_review_url: url });
            state.reviewSettings = normalizeReviewSettings(settings);
            saveStoredReviewSettings(state.reviewSettings);
            this.renderFacilityReviewSettings();
            showAlert(url ? '口コミリンクを保存しました' : '口コミリンクを非表示にしました', 'success');
        } catch (error) {
            console.error('Review settings save error:', error);
            state.reviewSettings = { googleReviewUrl: url };
            saveStoredReviewSettings(state.reviewSettings);
            this.renderFacilityReviewSettings();
            showAlert('API保存に失敗したため、この端末に一時保存しました: ' + error.message, 'error');
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    },

    // =====================================================
    // ページ切替
    // =====================================================

    // ページ切替
    async showPage(pageName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageName}`);
        });

        // ページ固有の初期化
        if (pageName === 'facility-info') await this.loadFacilityInfo();
        if (pageName === 'dashboard') this.loadDashboard();
        if (pageName === 'calendar-editor') this.loadCalendarForm();
        if (pageName === 'reservations') this.loadReservations();
        if (pageName === 'schedules') this.loadDepartments();
        if (['treatment-staff', 'treatment-rooms', 'treatment-equipment', 'treatment-menus', 'treatment-menu-items', 'treatment-steps'].includes(pageName)) {
            await this.loadTreatmentSettings();
        }
        if (pageName === 'questionnaires') await this.renderQuestionnaireList();
    },

    // 予約カレンダー一覧
    async loadDashboard() {
        const storedCalendars = loadStoredCalendars();
        loadStoredDepartmentGroups();

        try {
            const [calendars, departments, templates] = await Promise.all([
                api.getCalendars(),
                api.getDepartments(),
                api.getTemplates()
            ]);
            const apiCalendars = (calendars || []).filter(calendar => calendar.isActive !== false);
            const apiIds = new Set(apiCalendars.map(calendar => String(calendar.id)));
            const localOnlyCalendars = storedCalendars
                .filter(calendar => !isApiCalendarId(calendar.id) || !apiIds.has(String(calendar.id)))
                .filter(calendar => calendar.isActive !== false);

            state.customCalendars = [...apiCalendars, ...localOnlyCalendars];
            state.departments = (departments || []).filter(d => d.is_active !== false);
            state.templates = templates || [];
            saveStoredCalendars();
        } catch (error) {
            console.error('API load error:', error);
            state.customCalendars = storedCalendars.filter(calendar => calendar.isActive !== false);
            if (state.departmentGroups.length) {
                state.departments = [];
                state.templates = [];
            }
        }

        state.calendarRows = buildCalendarRows();
        this.renderCalendarList();
    },

    renderCalendarList() {
        const body = document.getElementById('calendarListBody');
        if (!body) return;

        if (!state.calendarRows.length) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--gray-500);">予約カレンダーがありません</td></tr>';
            return;
        }

        body.innerHTML = state.calendarRows.map(row => `
            <tr data-id="${row.id}">
                <td class="col-name">
                    <div class="dept-name-main">${escapeHTML(row.name)}</div>
                    <div class="dept-name-sub">順番待: ${escapeHTML(row.queue)} / 予約枠終了: ${escapeHTML(row.closeOffset)}</div>
                </td>
                <td>
                    ${row.periods.map(renderMiniSchedule).join('')}
                </td>
                <td>
                    ${row.closures.length
                        ? row.closures.map(item => `<span class="closure-tag">${escapeHTML(item)}</span>`).join(' ')
                        : '<span class="text-muted">設定なし</span>'
                    }
                </td>
                <td class="col-actions admin-row-actions">
                    <div class="admin-action-pair">
                        <button class="admin-action-edit" type="button" onclick="handlers.editCalendar('${row.id}')">編集</button>
                        <button class="admin-action-delete" type="button" onclick="handlers.deleteCalendar('${row.id}')">削除</button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    async loadCalendarForm() {
        loadStoredDepartmentGroups();
        if (!state.departments.length) {
            try {
                const allDepts = await api.getDepartments();
                state.departments = (allDepts || []).filter(d => d.is_active !== false);
            } catch (error) {
                console.error('Departments load error:', error);
                state.departments = [];
            }
        }
        const editingCalendar = state.customCalendars.find(calendar => calendar.id === state.editingCalendarId);
        this.renderCalendarForm(editingCalendar);
    },

    showCalendarForm(calendar = null) {
        if (!state.customCalendars.length) loadStoredCalendars();
        state.editingCalendarId = calendar?.id || null;
        this.showCalendarDrawer(calendar);
    },

    showCalendarDrawer(calendar = null) {
        const overlay = document.getElementById('calendarDrawerOverlay');
        const drawer = document.getElementById('calendarDrawer');

        // フォームをロード
        this.renderCalendarForm(calendar);

        // タイトルを更新
        const titleEl = document.getElementById('calendarEditorTitle');
        if (titleEl) titleEl.textContent = calendar ? '予約カレンダー編集' : '新規カレンダー作成';

        // ドロワーを表示
        overlay.classList.remove('hidden');
        drawer.classList.remove('hidden');

        // アニメーション用に少し遅延
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            drawer.classList.add('visible');
        });

        // 背景スクロールを防止
        document.body.style.overflow = 'hidden';
    },

    hideCalendarDrawer() {
        const overlay = document.getElementById('calendarDrawerOverlay');
        const drawer = document.getElementById('calendarDrawer');

        overlay.classList.remove('visible');
        drawer.classList.remove('visible');

        // アニメーション完了後に非表示
        setTimeout(() => {
            overlay.classList.add('hidden');
            drawer.classList.add('hidden');
        }, 300);

        // 背景スクロールを復元
        document.body.style.overflow = '';

        state.editingCalendarId = null;
    },

    // =====================================================
    // 問診票 UI
    // =====================================================
    async renderQuestionnaireList() {
        const tbody = document.getElementById('questionnaireListBody');
        if (!tbody) return;

        // APIから問診票一覧と診療科一覧を取得（非アクティブを除外）
        try {
            const [questionnaireData, departments] = await Promise.all([
                api.getQuestionnaires(),
                api.getDepartments()
            ]);
            const allQuestionnaires = normalizeQuestionnaireList(questionnaireData);
            state.questionnaires = allQuestionnaires.filter(q => q.is_active !== false);
            state.departments = (departments || []).filter(d => d.is_active !== false);
        } catch (error) {
            console.error('問診票の読み込みに失敗:', error);
            state.questionnaires = [];
        }

        if (!state.questionnaires.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--gray-500);">問診票がありません</td></tr>';
            return;
        }

        // 診療科名を取得するヘルパー
        const getDepartmentNames = (deptIds) => {
            if (!deptIds || !deptIds.length) return '-';
            const names = deptIds.map(id => {
                const dept = state.departments.find(d => d.id === id);
                return dept ? dept.name : null;
            }).filter(Boolean);
            return names.length ? names.join(', ') : '-';
        };

        tbody.innerHTML = state.questionnaires.map(q => {
            const itemCount = Number(q.item_count ?? (q.items || []).length);
            const deptNames = q.department_ids?.length
                ? getDepartmentNames(q.department_ids)
                : (q.department_count ? `${q.department_count}診療科` : '-');
            return `
                <tr data-id="${q.id}">
                    <td class="col-name">
                        <div class="dept-name-main">${escapeHTML(q.name)}</div>
                    </td>
                    <td>${escapeHTML(deptNames)}</td>
                    <td>${itemCount}項目</td>
                    <td class="col-actions admin-row-actions">
                        <div class="admin-action-pair compact">
                            <button class="admin-action-edit" type="button" onclick="handlers.editQuestionnaire('${q.id}')">編集</button>
                            <button class="admin-action-copy" type="button" onclick="handlers.duplicateQuestionnaire('${q.id}')">複製</button>
                            <button class="admin-action-delete" type="button" onclick="handlers.deleteQuestionnaire('${q.id}')">削除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    showQuestionnaireDrawer(questionnaire = null) {
        const overlay = document.getElementById('questionnaireDrawerOverlay');
        const drawer = document.getElementById('questionnaireDrawer');

        this.renderQuestionnaireForm(questionnaire);

        overlay.classList.remove('hidden');
        drawer.classList.remove('hidden');

        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            drawer.classList.add('visible');
        });

        document.body.style.overflow = 'hidden';
    },

    hideQuestionnaireDrawer() {
        const overlay = document.getElementById('questionnaireDrawerOverlay');
        const drawer = document.getElementById('questionnaireDrawer');

        overlay.classList.remove('visible');
        drawer.classList.remove('visible');

        setTimeout(() => {
            overlay.classList.add('hidden');
            drawer.classList.add('hidden');
        }, 300);

        document.body.style.overflow = '';
        state.editingQuestionnaireId = null;
    },

    renderQuestionnaireForm(questionnaire = null) {
        const nameInput = document.getElementById('questionnaireName');
        const itemsContainer = document.getElementById('questionnaireItems');

        if (questionnaire) {
            state.editingQuestionnaireId = questionnaire.id;
            nameInput.value = questionnaire.name || '';
            this.renderQuestionnaireItems(questionnaire.items || []);
        } else {
            state.editingQuestionnaireId = null;
            nameInput.value = '';
            // 新規作成時はデフォルト項目を追加（名前、住所、電話番号、性別）
            const defaultItems = [
                { ...questionTemplates.name, id: generateLocalId('qi') },
                { ...questionTemplates.address, id: generateLocalId('qi') },
                { ...questionTemplates.phone, id: generateLocalId('qi') },
                { ...questionTemplates.gender, id: generateLocalId('qi') }
            ];
            this.renderQuestionnaireItems(defaultItems);
        }

        // 診療科チェックボックスを描画
        this.renderQuestionnaireDepartments(questionnaire?.departments || []);

        // タブを初期状態に
        this.switchQuestionnaireTab('monshin');
    },

    renderQuestionnaireItems(items) {
        const container = document.getElementById('questionnaireItems');
        if (!container) return;

        container.innerHTML = items.map(item => this.renderQuestionnaireItem(item)).join('');
    },

    renderQuestionnaireItem(item) {
        const requiredBadge = item.required ? '<span class="questionnaire-required-badge">必須</span>' : '';
        const itemPayload = encodeURIComponent(JSON.stringify(item));
        let inputPreview = '';

        switch (item.type) {
            case 'text':
            case 'tel':
            case 'date':
                inputPreview = `<input type="text" class="questionnaire-text-input" placeholder="${item.label}を入力してください" disabled>`;
                break;
            case 'number':
                inputPreview = `
                    <div class="questionnaire-unit-input">
                        <input type="text" placeholder="${item.label}を入力してください" disabled>
                        <span>${item.unit || ''}</span>
                    </div>`;
                break;
            case 'address':
                inputPreview = `
                    <div class="questionnaire-postal-input">
                        <span>〒</span>
                        <input type="text" placeholder="0000000" disabled>
                    </div>
                    <input type="text" class="questionnaire-text-input" placeholder="住所を入力して下さい" disabled>`;
                break;
            case 'radio':
                inputPreview = `
                    <div class="questionnaire-radio-list">
                        ${(item.options || []).map(opt => `
                            <div class="questionnaire-radio-item">${opt}</div>
                        `).join('')}
                    </div>`;
                break;
            case 'yesno_text':
                inputPreview = `
                    <div class="questionnaire-toggle-group">
                        <button type="button" class="questionnaire-toggle-btn">なし</button>
                        <button type="button" class="questionnaire-toggle-btn">あり</button>
                    </div>
                    <textarea class="questionnaire-text-input" style="margin-top: 12px; min-height: 80px;" disabled></textarea>`;
                break;
            case 'checkbox_multi':
                inputPreview = `
                    <div class="questionnaire-toggle-group" style="margin-bottom: 12px;">
                        <button type="button" class="questionnaire-toggle-btn">いいえ</button>
                        <button type="button" class="questionnaire-toggle-btn">はい</button>
                    </div>
                    <div class="questionnaire-checkbox-grid">
                        ${(item.options || []).map(opt => `
                            <label class="questionnaire-checkbox-item">
                                <input type="checkbox" disabled> ${opt}
                            </label>
                        `).join('')}
                    </div>`;
                break;
            case 'alcohol':
                inputPreview = `
                    <div class="questionnaire-toggle-group">
                        <button type="button" class="questionnaire-toggle-btn">なし</button>
                        <button type="button" class="questionnaire-toggle-btn">あり</button>
                    </div>
                    <div style="margin-top: 12px; display: flex; gap: 12px; align-items: center;">
                        <span>週に</span>
                        <select disabled style="padding: 8px;"><option>日数</option></select>
                        <span>日</span>
                    </div>
                    <div style="margin-top: 8px; display: flex; gap: 12px; align-items: center;">
                        <span>量</span>
                        <select disabled style="padding: 8px; flex: 1;"><option>一日に飲むお酒の量</option></select>
                    </div>`;
                break;
            case 'body_part':
                inputPreview = `
                    <div class="questionnaire-body-part-preview">
                        <div class="body-part-image-container">
                            <div class="body-part-placeholder">
                                <i class="fas fa-user" style="font-size: 48px; color: var(--gray-400);"></i>
                                <p style="margin-top: 8px; color: var(--gray-500); font-size: 13px;">痛みや症状のある部位をタップして選択</p>
                            </div>
                        </div>
                    </div>`;
                break;
            case 'custom_text':
                inputPreview = `
                    <p style="color: var(--gray-500); font-size: 13px; margin-bottom: 8px;">${item.description || 'テキスト入力項目'}</p>
                    <input type="text" class="questionnaire-text-input" placeholder="${item.customLabel || '回答を入力'}" disabled>`;
                break;
            case 'custom_single':
                const singleOptions = item.customOptions || ['選択肢1', '選択肢2', '選択肢3'];
                inputPreview = `
                    <p style="color: var(--gray-500); font-size: 13px; margin-bottom: 8px;">${item.description || '単一選択項目'}</p>
                    <div class="questionnaire-radio-list">
                        ${singleOptions.map(opt => `
                            <div class="questionnaire-radio-item">${opt}</div>
                        `).join('')}
                    </div>`;
                break;
            case 'custom_multi':
                const multiOptions = item.customOptions || ['選択肢1', '選択肢2', '選択肢3'];
                inputPreview = `
                    <p style="color: var(--gray-500); font-size: 13px; margin-bottom: 8px;">${item.description || '複数選択項目'}</p>
                    <div class="questionnaire-checkbox-grid">
                        ${multiOptions.map(opt => `
                            <label class="questionnaire-checkbox-item">
                                <input type="checkbox" disabled> ${opt}
                            </label>
                        `).join('')}
                    </div>`;
                break;
            case 'custom_image':
                inputPreview = `
                    <p style="color: var(--gray-500); font-size: 13px; margin-bottom: 8px;">${item.description || '画像をアップロードしてください'}</p>
                    <div class="questionnaire-image-upload-preview">
                        <div class="image-upload-placeholder">
                            <i class="fas fa-camera" style="font-size: 32px; color: var(--gray-400);"></i>
                            <p style="margin-top: 8px; color: var(--gray-500); font-size: 13px;">タップして画像を撮影・選択</p>
                        </div>
                    </div>`;
                break;
            case 'custom_date':
                inputPreview = `
                    <p style="color: var(--gray-500); font-size: 13px; margin-bottom: 8px;">${item.description || '日付を選択してください'}</p>
                    <input type="text" class="questionnaire-text-input" placeholder="日付を選択" disabled>`;
                break;
            case 'custom_description':
                inputPreview = `
                    <div class="questionnaire-description-only">
                        <p style="color: var(--gray-600); font-size: 14px; line-height: 1.6;">${item.description || 'ここに説明文が表示されます。回答入力欄はありません。'}</p>
                    </div>`;
                break;
        }

        return `
            <div class="questionnaire-item" data-item-id="${item.id}" data-item-json="${itemPayload}">
                <button type="button" class="questionnaire-item-delete" onclick="handlers.removeQuestionItem('${item.id}')">
                    <i class="fas fa-trash"></i>
                </button>
                <div class="questionnaire-item-header">
                    <span class="questionnaire-item-label">${item.label}</span>
                    ${requiredBadge}
                </div>
                <div class="questionnaire-input-preview">
                    ${inputPreview}
                </div>
            </div>
        `;
    },

    renderQuestionnaireDepartments(selectedDepts = []) {
        const grid = document.getElementById('questionnaireDepartmentGrid');
        if (!grid) return;

        const selectedDeptNames = selectedDepts.map(dept =>
            typeof dept === 'object' ? dept.name : dept
        );
        const selectedDeptIds = selectedDepts.map(dept =>
            typeof dept === 'object' ? dept.id : dept
        );

        // state.departmentsから診療科一覧を表示
        const departments = state.departments || [];
        grid.innerHTML = departments.map(dept => `
            <label class="link-checkbox-label">
                <input type="checkbox" name="questionnaireDept" value="${dept.name}"
                    ${selectedDeptNames.includes(dept.name) || selectedDeptIds.includes(dept.id) ? 'checked' : ''}>
                <span>${dept.name}</span>
            </label>
        `).join('');
    },

    switchQuestionnaireTab(tabName) {
        document.querySelectorAll('.questionnaire-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.questionnaire-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `questionnaire-tab-${tabName}`);
        });
    },

    async saveQuestionnaireForm() {
        const name = document.getElementById('questionnaireName').value.trim();
        if (!name) {
            showAlert('問診票名を入力してください');
            return;
        }

        // 選択された診療科名を取得し、IDに変換
        const selectedDeptNames = Array.from(document.querySelectorAll('input[name="questionnaireDept"]:checked'))
            .map(cb => cb.value);

        // 診療科名からIDに変換
        const department_ids = selectedDeptNames
            .map(deptName => {
                const dept = state.departments.find(d => d.name === deptName);
                return dept ? dept.id : null;
            })
            .filter(id => id !== null);

        const items = [];
        document.querySelectorAll('.questionnaire-item').forEach((el, index) => {
            const itemId = el.dataset.itemId;
            const item = el.dataset.itemJson
                ? JSON.parse(decodeURIComponent(el.dataset.itemJson))
                : { id: itemId };
            const itemType = item.item_type || item.type || 'text';
            items.push({
                item_key: item.item_key || item.id || itemId,
                label: item.label || item.customLabel || item.custom_label || '質問',
                item_type: itemType,
                options: item.options || item.customOptions || null,
                unit: item.unit || null,
                placeholder: item.placeholder || null,
                description: item.description || null,
                custom_label: item.customLabel || item.custom_label || null,
                is_required: Boolean(item.is_required ?? item.required),
                is_customizable: Boolean(item.is_customizable ?? item.customizable),
                sort_order: index
            });
        });

        const questionnaireData = {
            name,
            department_ids,
            items
        };

        try {
            if (state.editingQuestionnaireId) {
                // 更新
                await api.updateQuestionnaire(state.editingQuestionnaireId, questionnaireData);
            } else {
                // 新規作成
                await api.createQuestionnaire(questionnaireData);
            }

            this.hideQuestionnaireDrawer();
            await this.renderQuestionnaireList();
        } catch (error) {
            console.error('問診票の保存に失敗:', error);
            showAlert('問診票の保存に失敗しました: ' + (error.message || 'エラーが発生しました'), 'error');
        }
    },

    renderCalendarForm(calendar = null) {
        document.getElementById('calendarForm').reset();
        renderTimeSelectOptions();

        document.getElementById('calendarId').value = calendar?.id || '';
        document.getElementById('calendarName').value = calendar?.name || '';
        document.getElementById('calendarCloseOffset').value = calendar?.closeOffset ?? 0;
        document.getElementById('calendarStartMonthOffset').value = calendar?.startMonthOffset || 6;
        document.getElementById('calendarStartHour').value = calendar?.startHour ?? 0;
        document.getElementById('calendarStartMinute').value = calendar?.startMinute ?? 0;
        document.getElementById('holidayPriority').checked = Boolean(calendar?.holidayPriority);

        if (calendar) {
            const setRadio = (name, value) => {
                const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
                if (input) input.checked = true;
            };
            setRadio('calendarWeekRule', calendar.weekRule);
            setRadio('calendarVisitTimeMode', calendar.visitTimeMode);
            setRadio('calendarStartRule', calendar.startRule);
            setRadio('calendarTimeDisplay', calendar.timeDisplay);
        }

        renderDepartmentCheckboxes(calendar?.departments?.map(department => department.id) || []);
        renderStaffCheckboxes(calendar?.staff?.map(s => s.id) || []);

        // エディタータイトル更新
        const titleEl = document.getElementById('calendarEditorTitle');
        if (titleEl) titleEl.textContent = calendar ? 'カレンダー編集' : '新規カレンダー作成';

        document.getElementById('calendarPeriods').innerHTML = (calendar?.periods?.length ? calendar.periods : [defaultPeriod()])
            .map(renderCalendarPeriod)
            .join('');
        document.getElementById('temporarySettings').innerHTML = (calendar?.temporarySettings || [])
            .map(renderTemporarySetting)
            .join('');
    },

    async saveCalendarForm() {
        const calendar = readCalendarForm();
        if (!calendar.name) {
            showAlert('カレンダー名を入力してください');
            return;
        }
        if (!calendar.departments.length) {
            showAlert('連携する診療科を選択してください');
            return;
        }
        if (!calendar.periods.some(period => period.rows.some(row => row.days.some(Boolean)))) {
            showAlert('予約日時を設定してください');
            return;
        }

        const hasLocalDepartment = calendar.departments.some(department => department.real === false);
        if (hasLocalDepartment) {
            const existingIndex = state.customCalendars.findIndex(item => item.id === calendar.id);
            if (existingIndex >= 0) {
                state.customCalendars.splice(existingIndex, 1, calendar);
            } else {
                state.customCalendars.unshift(calendar);
            }
            saveStoredCalendars();
            this.hideCalendarDrawer();
            await this.loadDashboard();
            showAlert('予約カレンダーを保存しました', 'success');
            return;
        }

        try {
            let savedCalendar = isApiCalendarId(calendar.id)
                ? await api.updateCalendar(calendar.id, calendarPayload(calendar))
                : await api.createCalendar(calendarPayload(calendar, { syncedAt: null }));

            if (!savedCalendar.syncedAt) {
                try {
                    await this.syncCalendarToApi(savedCalendar);
                    savedCalendar = await api.updateCalendar(savedCalendar.id, {
                        syncedAt: new Date().toISOString()
                    });
                } catch (syncError) {
                    console.error('Calendar template sync error:', syncError);
                    showAlert('カレンダーは保存しましたが、予約枠テンプレート同期でエラーが発生しました: ' + syncError.message, 'error');
                }
            }

            const existingIndex = state.customCalendars.findIndex(item => item.id === calendar.id || item.id === savedCalendar.id);
            if (existingIndex >= 0) {
                state.customCalendars.splice(existingIndex, 1, savedCalendar);
            } else {
                state.customCalendars.unshift(savedCalendar);
            }

            saveStoredCalendars();
            this.hideCalendarDrawer();
            await this.loadDashboard();
        } catch (error) {
            console.error('Calendar save error:', error);
            const existingIndex = state.customCalendars.findIndex(item => item.id === calendar.id);
            if (existingIndex >= 0) {
                state.customCalendars.splice(existingIndex, 1, calendar);
            } else {
                state.customCalendars.unshift(calendar);
            }
            saveStoredCalendars();
            this.hideCalendarDrawer();
            await this.loadDashboard();
            showAlert('API保存に失敗したため、この端末に一時保存しました: ' + error.message, 'error');
        }
    },

    async syncCalendarToApi(calendar) {
        const realDepartments = (calendar.departments || [])
            .filter(department => department.real !== false && isApiCalendarId(department.id));
        const dayToApi = [1, 2, 3, 4, 5, 6, 0];
        const tasks = [];

        realDepartments.forEach(department => {
            (calendar.periods || []).forEach(period => {
                (period.rows || []).forEach(row => {
                    (row.days || []).slice(0, 7).forEach((enabled, dayIndex) => {
                        if (!enabled) return;
                        tasks.push(api.createTemplate({
                            department_id: department.id,
                            day_of_week: dayToApi[dayIndex],
                            start_time: row.start_time,
                            end_time: row.end_time,
                            slot_duration: row.slot_duration,
                            max_bookings: row.max_bookings,
                            effective_from: period.effective_from,
                            effective_until: period.effective_until
                        }));
                    });
                });
            });

            (calendar.temporarySettings || []).forEach(setting => {
                if (setting.periodType && setting.periodType !== 'once') return;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(setting.date || ''))) return;

                tasks.push(api.createClosure({
                    department_id: department.id,
                    closure_date: setting.date,
                    closure_type: setting.type,
                    reason: setting.reason || null,
                    modified_start: setting.type === 'modified' ? setting.start_time : null,
                    modified_end: setting.type === 'modified' ? setting.end_time : null
                }));
            });
        });

        if (tasks.length) await Promise.all(tasks);
    },

    // 施術メニュー設定
    async loadTreatmentSettings() {
        const tbody = document.getElementById('treatmentMenuBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--gray-500);">読み込み中...</td></tr>';
        }

        loadStoredDepartmentGroups();
        const fallbackCapacities = loadStoredTreatmentResourceCapacities();
        const fallbackStaff = loadStoredTreatmentStaff();
        const fallbackRooms = loadStoredTreatmentRooms();
        const fallbackEquipment = loadStoredTreatmentEquipment();
        const fallbackCategories = loadStoredBeautyCategories();
        const fallbackSteps = loadStoredTreatmentSteps();
        const fallbackMenus = loadStoredTreatmentMenus();

        try {
            // 診療科も取得（非アクティブを除外）
            if (!state.departments || !state.departments.length) {
                const allDepts = await api.getDepartments();
                state.departments = allDepts.filter(d => d.is_active !== false);
            }
            const settings = await api.getTreatmentSettings();
            state.treatmentResourceCapacities = settings.resource_capacities || { doctor: 1, nurse: 2, clerk: 1 };
            state.treatmentStaff = Array.isArray(settings.staff) && settings.staff.length
                ? settings.staff.map(normalizeTreatmentStaff).filter(staff => staff.is_active !== false)
                : makeDefaultTreatmentStaff(state.treatmentResourceCapacities);
            state.treatmentRooms = Array.isArray(settings.rooms) && settings.rooms.length
                ? mergeDefaultTreatmentRooms(settings.rooms)
                : mergeDefaultTreatmentRooms(fallbackRooms);
            state.treatmentEquipment = Array.isArray(settings.equipment) && settings.equipment.length
                ? settings.equipment.map(normalizeTreatmentEquipment).filter(item => item.is_active !== false)
                : fallbackEquipment;
            const categories = settings.categories || settings.beauty_categories || settings.beautyCategories || [];
            state.beautyCategories = Array.isArray(categories) && categories.length
                ? categories.map(normalizeBeautyCategory)
                : fallbackCategories;
            const steps = settings.steps || settings.treatment_steps || settings.treatmentSteps || [];
            state.treatmentSteps = Array.isArray(steps) && steps.length
                ? mergeSimpleTreatmentSteps(steps)
                : fallbackSteps;
            // 非アクティブなメニューを除外して表示
            const allMenus = Array.isArray(settings.menus) ? settings.menus : [];
            state.treatmentMenus = allMenus
                .map(normalizeTreatmentMenu)
                .filter(m => m.is_active !== false);
            if (state.treatmentMenus.length > 0) {
                saveStoredTreatmentMenus();
            }
            saveStoredTreatmentStaff();
            saveStoredTreatmentRooms();
            saveStoredTreatmentEquipment();
            saveStoredBeautyCategories();
            saveStoredTreatmentSteps();
            saveStoredTreatmentResourceCapacities();
            this.renderTreatmentSettings();
        } catch (error) {
            console.error('Treatment settings load error:', error);
            state.treatmentMenus = fallbackMenus;
            state.treatmentStaff = fallbackStaff;
            state.treatmentRooms = fallbackRooms;
            state.treatmentEquipment = fallbackEquipment;
            state.beautyCategories = fallbackCategories;
            state.treatmentSteps = fallbackSteps;
            state.treatmentResourceCapacities = fallbackCapacities;
            this.renderTreatmentSettings();
            if (!fallbackMenus.length) {
                showAlert('施術メニュー設定を取得できませんでした: ' + error.message, 'error');
            }
        }
    },

    renderTreatmentSettings() {
        this.renderTreatmentStaffList();
        this.renderTreatmentRoomList();
        this.renderTreatmentEquipmentList();
        this.renderBeautyCategoryList();
        this.renderTreatmentStepList();
        this.renderTreatmentMenuTable();
    },

    renderTreatmentStaffList() {
        const list = document.getElementById('treatmentStaffList');
        const counts = document.getElementById('treatmentStaffCounts');
        if (!list) return;

        if (!state.treatmentStaff.length && !localStorage.getItem(getClinicStorageKey(TREATMENT_STAFF_STORAGE_KEY))) {
            state.treatmentStaff = makeDefaultTreatmentStaff();
        }

        syncTreatmentResourceCapacitiesFromStaff();
        if (counts) {
            counts.textContent = `医師${state.treatmentResourceCapacities.doctor}名 / 看護師${state.treatmentResourceCapacities.nurse}名 / 事務員${state.treatmentResourceCapacities.clerk}名`;
        }

        list.innerHTML = state.treatmentStaff
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
            .map((staff, index) => `
                <div class="treatment-staff-row treatment-resource-list-row" data-staff-id="${escapeHTML(staff.id)}">
                    <div class="treatment-resource-list-name">${escapeHTML(staff.name || '未設定')}</div>
                    <div class="treatment-resource-list-meta">${escapeHTML(getTreatmentResourceLabel(staff.role))}</div>
                    <div class="treatment-resource-row-actions">
                        <button type="button" class="admin-action-edit" onclick="handlers.editTreatmentStaff(this.closest('.treatment-staff-row').dataset.staffId)">編集</button>
                        <button type="button" class="admin-action-delete" onclick="handlers.deleteTreatmentStaff(this.closest('.treatment-staff-row').dataset.staffId)">削除</button>
                    </div>
                    <input type="hidden" class="treatment-staff-order" value="${Number(staff.display_order || (index + 1) * 10)}">
                </div>
            `).join('');
    },

    readTreatmentStaffRows({ keepBlank = true } = {}) {
        const rows = Array.from(document.querySelectorAll('#treatmentStaffList .treatment-staff-row'));
        const staff = rows.map((row, index) => {
            const existing = state.treatmentStaff.find(item => String(item.id) === String(row.dataset.staffId)) || {};
            return normalizeTreatmentStaff({
                ...existing,
                id: row.dataset.staffId || existing.id || generateLocalId('staff'),
                name: row.querySelector('.treatment-staff-name')?.value || existing.name || '',
                role: row.querySelector('.treatment-staff-role')?.value || existing.role || 'nurse',
                display_order: Number(row.querySelector('.treatment-staff-order')?.value || existing.display_order || (index + 1) * 10)
            });
        });

        return keepBlank ? staff : staff.filter(item => item.name);
    },

    renderTreatmentRoomList() {
        const list = document.getElementById('treatmentRoomList');
        if (!list) return;
        if (!state.treatmentRooms.length) {
            state.treatmentRooms = mergeDefaultTreatmentRooms(DEFAULT_TREATMENT_ROOMS);
        }
        list.innerHTML = state.treatmentRooms
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
            .map((room, index) => `
                <div class="treatment-master-row treatment-resource-list-row" data-room-id="${escapeHTML(room.id)}">
                    <div class="treatment-resource-list-name">${escapeHTML(room.label || '未設定')}</div>
                    <div class="treatment-resource-list-meta">同時使用数 ${Number(room.capacity || 1)}</div>
                    <div class="treatment-resource-row-actions">
                        <button type="button" class="admin-action-edit" onclick="handlers.editTreatmentRoom(this.closest('.treatment-master-row').dataset.roomId)">編集</button>
                        <button type="button" class="admin-action-delete" onclick="handlers.deleteTreatmentRoom(this.closest('.treatment-master-row').dataset.roomId)">削除</button>
                    </div>
                    <input type="hidden" class="treatment-room-order" value="${Number(room.display_order || (index + 1) * 10)}">
                </div>
            `).join('');
    },

    readTreatmentRoomRows({ keepBlank = true } = {}) {
        const rows = Array.from(document.querySelectorAll('#treatmentRoomList .treatment-master-row'));
        const rooms = rows.map((row, index) => {
            const existing = state.treatmentRooms.find(item => String(item.id) === String(row.dataset.roomId)) || {};
            return normalizeTreatmentRoom({
                ...existing,
                id: row.dataset.roomId || existing.id || generateLocalId('room'),
                label: row.querySelector('.treatment-room-label')?.value || existing.label || '',
                code: row.querySelector('.treatment-room-code')?.value || existing.code || createTreatmentMasterCode(`room_${Date.now()}`),
                capacity: row.querySelector('.treatment-room-capacity')?.value || existing.capacity || 1,
                display_order: Number(row.querySelector('.treatment-room-order')?.value || existing.display_order || (index + 1) * 10)
            });
        });
        return keepBlank ? rooms : rooms.filter(item => item.label && item.code);
    },

    renderTreatmentEquipmentList() {
        const list = document.getElementById('treatmentEquipmentList');
        if (!list) return;
        if (!state.treatmentEquipment.length) {
            state.treatmentEquipment = DEFAULT_TREATMENT_EQUIPMENT.map(normalizeTreatmentEquipment);
        }
        list.innerHTML = state.treatmentEquipment
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
            .map((equipment, index) => `
                <div class="treatment-master-row treatment-equipment-row treatment-resource-list-row" data-equipment-id="${escapeHTML(equipment.id)}">
                    <div class="treatment-resource-list-name">${escapeHTML(equipment.label || '未設定')}</div>
                    <div class="treatment-resource-list-meta">${Number(equipment.capacity || 1)}台</div>
                    <div class="treatment-resource-row-actions">
                        <button type="button" class="admin-action-edit" onclick="handlers.editTreatmentEquipment(this.closest('.treatment-master-row').dataset.equipmentId)">編集</button>
                        <button type="button" class="admin-action-delete" onclick="handlers.deleteTreatmentEquipment(this.closest('.treatment-master-row').dataset.equipmentId)">削除</button>
                    </div>
                    <input type="hidden" class="treatment-equipment-order" value="${Number(equipment.display_order || (index + 1) * 10)}">
                </div>
            `).join('');
    },

    readTreatmentEquipmentRows({ keepBlank = true } = {}) {
        const rows = Array.from(document.querySelectorAll('#treatmentEquipmentList .treatment-master-row'));
        const equipment = rows.map((row, index) => {
            const existing = state.treatmentEquipment.find(item => String(item.id) === String(row.dataset.equipmentId)) || {};
            return normalizeTreatmentEquipment({
                ...existing,
                id: row.dataset.equipmentId || existing.id || generateLocalId('equipment'),
                label: row.querySelector('.treatment-equipment-label')?.value || existing.label || '',
                code: row.querySelector('.treatment-equipment-code')?.value || existing.code || createTreatmentMasterCode(`equipment_${Date.now()}`),
                capacity: row.querySelector('.treatment-equipment-capacity')?.value || existing.capacity || 1,
                default_duration_minutes: row.querySelector('.treatment-equipment-duration')?.value || existing.default_duration_minutes || '',
                display_order: Number(row.querySelector('.treatment-equipment-order')?.value || existing.display_order || (index + 1) * 10)
            });
        });
        return keepBlank ? equipment : equipment.filter(item => item.label && item.code);
    },

    getTreatmentResourceItems(kind) {
        if (kind === 'staff') return state.treatmentStaff || [];
        if (kind === 'room') return state.treatmentRooms || [];
        if (kind === 'equipment') return state.treatmentEquipment || [];
        if (kind === 'beauty-category') return state.beautyCategories || [];
        return [];
    },

    setTreatmentResourceItems(kind, items) {
        if (kind === 'staff') state.treatmentStaff = items;
        if (kind === 'room') state.treatmentRooms = items;
        if (kind === 'equipment') state.treatmentEquipment = items;
        if (kind === 'beauty-category') state.beautyCategories = items;
    },

    getTreatmentResourceEditConfig(kind) {
        const configs = {
            staff: {
                title: 'スタッフ',
                nameLabel: 'スタッフ名',
                nameKey: 'name',
                defaultRole: 'nurse'
            },
            room: {
                title: '部屋',
                nameLabel: '部屋名',
                nameKey: 'label',
                capacityLabel: '同時使用数',
                defaultCapacity: 1
            },
            equipment: {
                title: '機器',
                nameLabel: '機器名',
                nameKey: 'label',
                capacityLabel: '台数',
                defaultCapacity: 1,
                defaultDuration: 30
            },
            'beauty-category': {
                title: '美容施術',
                nameLabel: 'カテゴリー名',
                nameKey: 'name'
            }
        };
        return configs[kind] || configs.equipment;
    },

    showTreatmentResourceModal(kind, resourceId = '') {
        const modal = document.getElementById('treatmentResourceModal');
        const form = document.getElementById('treatmentResourceForm');
        const title = document.getElementById('treatmentResourceModalTitle');
        const kindInput = document.getElementById('treatmentResourceKind');
        const idInput = document.getElementById('treatmentResourceId');
        const codeInput = document.getElementById('treatmentResourceCode');
        const nameInput = document.getElementById('treatmentResourceName');
        const nameLabel = document.getElementById('treatmentResourceNameLabel');
        const roleField = document.getElementById('treatmentResourceRoleField');
        const roleSelect = document.getElementById('treatmentResourceRole');
        const usageFields = document.getElementById('treatmentResourceUsageFields');
        const durationField = document.getElementById('treatmentResourceDurationField');
        const durationInput = document.getElementById('treatmentResourceDuration');
        const capacityInput = document.getElementById('treatmentResourceCapacity');
        const capacityLabel = document.getElementById('treatmentResourceCapacityLabel');
        if (!modal || !form || !nameInput) return;

        const config = this.getTreatmentResourceEditConfig(kind);
        const items = this.getTreatmentResourceItems(kind);
        const item = resourceId
            ? items.find(resource => String(resource.id) === String(resourceId))
            : null;

        form.reset();
        title.textContent = item ? `${config.title}編集` : `${config.title}追加`;
        kindInput.value = kind;
        idInput.value = item?.id || '';
        codeInput.value = item?.code || '';
        nameLabel.textContent = config.nameLabel;
        nameInput.value = item?.[config.nameKey] || '';

        if (roleSelect) {
            roleSelect.innerHTML = TREATMENT_RESOURCE_ROLES.map(role => `
                <option value="${role.value}">${escapeHTML(role.label)}</option>
            `).join('');
            roleSelect.value = item?.role || config.defaultRole || 'nurse';
        }

        roleField?.classList.toggle('hidden', kind !== 'staff');
        usageFields?.classList.toggle('hidden', kind === 'staff' || kind === 'beauty-category');
        durationField?.classList.add('hidden');
        if (capacityLabel) capacityLabel.textContent = config.capacityLabel || '数';
        if (capacityInput) capacityInput.value = item?.capacity ?? config.defaultCapacity ?? 1;
        if (durationInput) durationInput.value = item?.default_duration_minutes ?? config.defaultDuration ?? '';
        this.renderTreatmentResourceLinkedMenus(kind, item || resourceId || '');

        modal.classList.remove('hidden');
        requestAnimationFrame(() => nameInput.focus());
    },

    getBeautyCategoryLinkedMenuRows(categoryId = '') {
        if (!categoryId) return [];
        return this.getTreatmentDetailMenuRows()
            .filter(row => String(row.categoryId || '') === String(categoryId));
    },

    getEquipmentLinkedMenuRows(resource = '') {
        const equipment = typeof resource === 'object' && resource
            ? resource
            : (state.treatmentEquipment || []).find(item =>
                String(item.id || '') === String(resource || '') ||
                String(item.code || '') === String(resource || '')
            );
        const equipmentCode = String(equipment?.code || resource?.code || resource || '').trim();
        if (!equipmentCode) return [];

        const includesEquipment = row => {
            const detail = row.detail || {};
            const parent = this.findTreatmentMenuByKey(row.parentKey) || {};
            const equipmentCodes = new Set((state.treatmentEquipment || []).map(item => String(item.code || '').trim()).filter(Boolean));
            const getKnownEquipmentCode = source => {
                const inferred = inferTreatmentEquipmentCode(source, '');
                return equipmentCodes.has(inferred) ? inferred : '';
            };
            const detailCodes = [
                detail.equipment_code,
                detail.equipmentCode,
                detail.resource_code,
                detail.resourceCode,
                getKnownEquipmentCode(detail)
            ].filter(Boolean).map(code => String(code).trim());
            const detailRequirements = normalizeTreatmentEquipmentRequirements(
                detail.equipment_requirements || detail.equipmentRequirements,
                {
                    equipment_code: detail.equipment_code || detail.equipmentCode,
                    equipment_label: detail.equipment_label || detail.equipmentLabel || detail.label,
                    duration_minutes: detail.duration_minutes || detail.durationMinutes
                }
            );
            const detailRequirementCodes = detailRequirements
                .map(item => String(item.resource_code || item.resourceCode || '').trim())
                .filter(Boolean);

            const detailLinkedCodes = [...detailCodes, ...detailRequirementCodes];
            if (detailLinkedCodes.length) {
                return detailLinkedCodes.some(code => code === equipmentCode);
            }

            const parentCodes = [
                parent.equipment_code,
                parent.equipmentCode,
                parent.resource_code,
                parent.resourceCode,
                getKnownEquipmentCode(parent)
            ].filter(Boolean).map(code => String(code).trim());
            const parentRequirements = normalizeTreatmentEquipmentRequirements(
                parent.equipment_requirements || parent.equipmentRequirements,
                {
                    equipment_code: parent.equipment_code || parent.equipmentCode,
                    equipment_label: parent.equipment_label || parent.equipmentLabel || parent.label,
                    duration_minutes: parent.duration_minutes || parent.durationMinutes
                }
            );
            const requirementCodes = [...detailRequirements, ...parentRequirements]
                .map(item => String(item.resource_code || item.resourceCode || '').trim())
                .filter(Boolean);

            return [...parentCodes, ...requirementCodes].some(code => code === equipmentCode);
        };

        return this.getTreatmentDetailMenuRows().filter(includesEquipment);
    },

    renderTreatmentResourceLinkedMenus(kind = '', resource = '') {
        const section = document.getElementById('treatmentResourceLinkedMenuSection');
        const list = document.getElementById('treatmentResourceLinkedMenuList');
        const count = document.getElementById('treatmentResourceLinkedMenuCount');
        if (!section || !list || !count) return;

        const shouldShow = kind === 'beauty-category' || kind === 'equipment';
        section.classList.toggle('hidden', !shouldShow);
        if (!shouldShow) {
            list.innerHTML = '';
            count.textContent = '0件';
            return;
        }

        const rows = kind === 'equipment'
            ? this.getEquipmentLinkedMenuRows(resource)
            : this.getBeautyCategoryLinkedMenuRows(resource?.id || resource || '');
        count.textContent = `${rows.length}件`;
        if (!rows.length) {
            list.innerHTML = '<div class="treatment-linked-menu-empty">リンクされているメニューはありません</div>';
            return;
        }

        list.innerHTML = rows.map(row => {
            const detail = row.detail || {};
            const duration = detail.duration || (detail.duration_minutes ? `約${Number(detail.duration_minutes)}分` : '');
            const price = formatTreatmentDetailPriceLabel(detail.price || detail.priceSub || '', detail.lowest_price || detail.lowestPrice);
            return `
                <div class="treatment-linked-menu-item">
                    <div class="treatment-linked-menu-name">${escapeHTML(detail.label || '未設定')}</div>
                    <div class="treatment-linked-menu-meta">
                        ${price ? `<span>${escapeHTML(price)}</span>` : ''}
                        ${duration ? `<span>${escapeHTML(duration)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    hideTreatmentResourceModal() {
        document.getElementById('treatmentResourceModal')?.classList.add('hidden');
    },

    async saveTreatmentResourceFromModal() {
        const kind = document.getElementById('treatmentResourceKind')?.value || '';
        const id = document.getElementById('treatmentResourceId')?.value || '';
        const code = document.getElementById('treatmentResourceCode')?.value || '';
        const name = document.getElementById('treatmentResourceName')?.value.trim() || '';
        const role = document.getElementById('treatmentResourceRole')?.value || 'nurse';
        const capacity = Number(document.getElementById('treatmentResourceCapacity')?.value || 1);
        const config = this.getTreatmentResourceEditConfig(kind);

        if (!name) {
            showAlert(`${config.nameLabel}を入力してください`, 'warning');
            document.getElementById('treatmentResourceName')?.focus();
            return;
        }

        const items = [...this.getTreatmentResourceItems(kind)];
        const existingIndex = items.findIndex(item => String(item.id) === String(id));
        const existing = existingIndex >= 0 ? items[existingIndex] : {};
        const nextOrder = items.reduce((max, item) => Math.max(max, Number(item.display_order || 0)), 0) + 10;
        const generatedCode = kind === 'beauty-category'
            ? createBeautyCategoryCode(name)
            : createTreatmentMasterCode(`${kind}_${Date.now()}`);
        const base = {
            ...existing,
            id: id || existing.id || (kind === 'beauty-category' ? `beauty-category-${code || existing.code || generatedCode}` : generateLocalId(kind)),
            code: code || existing.code || generatedCode,
            display_order: existing.display_order || nextOrder
        };
        const preservedDuration = normalizeTreatmentDurationMinutes(
            existing.default_duration_minutes ??
            existing.defaultDurationMinutes ??
            document.getElementById('treatmentResourceDuration')?.value ??
            config.defaultDuration
        ) || config.defaultDuration || null;

        let nextItem;
        if (kind === 'staff') {
            nextItem = normalizeTreatmentStaff({
                ...base,
                name,
                role
            });
        } else if (kind === 'room') {
            nextItem = normalizeTreatmentRoom({
                ...base,
                label: name,
                capacity
            });
        } else if (kind === 'equipment') {
            nextItem = normalizeTreatmentEquipment({
                ...base,
                label: name,
                capacity,
                default_duration_minutes: preservedDuration
            });
        } else if (kind === 'beauty-category') {
            nextItem = normalizeBeautyCategory({
                ...base,
                name,
                description: ''
            });
        } else {
            return;
        }

        if (existingIndex >= 0) {
            items[existingIndex] = nextItem;
        } else {
            items.push(nextItem);
        }
        this.setTreatmentResourceItems(kind, items);
        this.hideTreatmentResourceModal();

        if (kind === 'beauty-category') {
            await this.saveBeautyCategories({ readRows: false });
            return;
        }

        this.renderTreatmentSettings();

        if (kind === 'staff') await this.saveResourceCapacities();
        if (kind === 'room') await this.saveTreatmentRooms();
        if (kind === 'equipment') await this.saveTreatmentEquipment();
    },

    renderBeautyCategoryList() {
        const tbody = document.getElementById('beautyCategoryBody');
        if (!tbody) return;

        if (!state.beautyCategories.length) {
            state.beautyCategories = cloneDefaultBeautyCategories();
        }

        const menuCounts = new Map();
        (state.treatmentMenus || []).forEach(menu => {
            const categoryId = menu.beauty_category_id || menu.beautyCategoryId || defaultBeautyCategoryIdForCode(menu.code) || '';
            if (!categoryId) return;
            const detailCount = normalizeTreatmentDetailMenus(
                getTreatmentDetailMenuData(menu),
                menu,
                { useDefaults: !hasTreatmentDetailMenuData(menu) }
            ).filter(detail => detail.is_active !== false).length;
            menuCounts.set(categoryId, (menuCounts.get(categoryId) || 0) + detailCount);
        });

        const rows = [...state.beautyCategories]
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));

        tbody.innerHTML = rows.map((category, index) => `
            <tr class="beauty-category-row" data-category-id="${escapeHTML(category.id)}">
                <td>
                    <span class="beauty-category-name-text">${escapeHTML(category.name)}</span>
                </td>
                <td class="treatment-master-count-cell">${Number(menuCounts.get(category.id) || 0)}件</td>
                <td>
                    <label class="treatment-active-toggle">
                        <input type="checkbox" class="beauty-category-active" ${category.is_active !== false ? 'checked' : ''}>
                        <span>表示</span>
                    </label>
                </td>
                <td class="col-actions admin-row-actions">
                    <input type="hidden" class="beauty-category-order" value="${Number(category.display_order || (index + 1) * 10)}">
                    <div class="admin-action-pair compact">
                        <button type="button" class="admin-action-edit" onclick="handlers.editBeautyCategory('${escapeHTML(category.id)}')">編集</button>
                        <button type="button" class="admin-action-delete" onclick="handlers.deleteBeautyCategory('${escapeHTML(category.id)}')">削除</button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    readBeautyCategoryRows() {
        return Array.from(document.querySelectorAll('#beautyCategoryBody .beauty-category-row'))
            .map((row, index) => {
                const existing = state.beautyCategories.find(item => String(item.id) === String(row.dataset.categoryId)) || {};
                const name = existing.name || row.querySelector('.beauty-category-name-text')?.textContent.trim() || '';
                return normalizeBeautyCategory({
                    ...existing,
                    id: row.dataset.categoryId || existing.id || generateLocalId('beauty-category'),
                    code: existing.code || createBeautyCategoryCode(name),
                    name,
                    description: '',
                    is_active: row.querySelector('.beauty-category-active')?.checked !== false,
                    display_order: Number(row.querySelector('.beauty-category-order')?.value || existing.display_order || (index + 1) * 10)
                }, index);
            })
            .filter(category => category.name);
    },

    addBeautyCategoryRow() {
        this.showTreatmentResourceModal('beauty-category');
    },

    editBeautyCategory(categoryId) {
        this.showTreatmentResourceModal('beauty-category', categoryId);
    },

    async saveBeautyCategories({ readRows = true } = {}) {
        if (readRows) {
            state.beautyCategories = this.readBeautyCategoryRows();
        }
        try {
            const result = await api.updateTreatmentCategories(state.beautyCategories);
            if (Array.isArray(result.categories)) {
                state.beautyCategories = result.categories.map(normalizeBeautyCategory);
            }
        } catch (error) {
            console.warn('Beauty category server save failed, keeping local data:', error);
        }
        saveStoredBeautyCategories();
        this.renderBeautyCategoryList();
        this.renderTreatmentMenuTable();
        showAlert('美容施術カテゴリーを保存しました', 'success');
    },

    async deleteBeautyCategory(categoryId) {
        const category = state.beautyCategories.find(item => String(item.id) === String(categoryId));
        if (!category) return;
        const usedCount = (state.treatmentMenus || []).filter(menu => String(menu.beauty_category_id || menu.beautyCategoryId || '') === String(categoryId)).length;
        if (usedCount && !confirm(`「${category.name}」は${usedCount}件のメニューで使用されています。削除するとメニュー側は未設定になります。`)) return;
        state.beautyCategories = state.beautyCategories.filter(item => String(item.id) !== String(categoryId));
        state.treatmentMenus = state.treatmentMenus.map(menu => {
            if (String(menu.beauty_category_id || menu.beautyCategoryId || '') !== String(categoryId)) return menu;
            return {
                ...menu,
                beauty_category_id: '',
                beautyCategoryId: ''
            };
        });
        saveStoredBeautyCategories();
        saveStoredTreatmentMenus();
        try {
            const result = await api.updateTreatmentCategories(state.beautyCategories);
            if (Array.isArray(result.categories)) {
                state.beautyCategories = result.categories.map(normalizeBeautyCategory);
                saveStoredBeautyCategories();
            }
        } catch (error) {
            console.warn('Beauty category server delete failed, keeping local data:', error);
        }
        this.renderTreatmentSettings();
    },

    renderTreatmentStepList() {
        const tbody = document.getElementById('treatmentStepBody');
        if (!tbody) return;

        if (!state.treatmentSteps.length) {
            state.treatmentSteps = cloneDefaultTreatmentSteps();
        }

        const rows = [...state.treatmentSteps]
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));

        tbody.innerHTML = rows.map((step, index) => `
            <tr class="treatment-step-row" data-step-id="${escapeHTML(step.id)}">
                <td class="treatment-step-id-cell">${escapeHTML(this.getTreatmentStepDisplayId(step, index))}</td>
                <td>
                    <button type="button" class="treatment-step-name-link" onclick="handlers.editTreatmentStep('${escapeHTML(step.id)}')">${escapeHTML(step.name)}</button>
                </td>
                <td>${escapeHTML(getTreatmentStepTypeLabel(step.step_type || step.stepType))}</td>
                <td>
                    <button type="button" class="admin-action-edit" onclick="handlers.editTreatmentStep('${escapeHTML(step.id)}')">編集</button>
                </td>
            </tr>
        `).join('');
    },

    getTreatmentStepDisplayId(step = {}, index = 0) {
        if (step.display_id || step.displayId) return step.display_id || step.displayId;
        const numeric = String(step.id || step.code || '').replace(/\D/g, '').slice(-5);
        return numeric || (40294 + Number(index || 0));
    },

    addTreatmentStepRow() {
        this.showTreatmentStepModal();
    },

    async saveTreatmentSteps() {
        try {
            const result = await api.updateTreatmentSteps(state.treatmentSteps);
            if (Array.isArray(result.steps)) {
                state.treatmentSteps = mergeSimpleTreatmentSteps(result.steps);
            }
        } catch (error) {
            console.warn('Treatment step server save failed, keeping local data:', error);
        }
        saveStoredTreatmentSteps();
        this.renderTreatmentStepList();
        this.renderTreatmentMenuTable();
        showAlert('施術ステップを保存しました', 'success');
    },

    async deleteTreatmentStep(stepId) {
        const step = state.treatmentSteps.find(item => String(item.id) === String(stepId));
        if (!step) return;
        const usedCount = (state.treatmentMenus || []).filter(menu => normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, []).includes(stepId)).length;
        if (usedCount && !confirm(`「${step.name}」は${usedCount}件のメニューで使用されています。削除するとメニュー側から外れます。`)) return;
        state.treatmentSteps = state.treatmentSteps.filter(item => String(item.id) !== String(stepId));
        state.treatmentMenus = state.treatmentMenus.map(menu => {
            const stepIds = normalizeTreatmentStepIds(menu.step_ids || menu.stepIds, []).filter(id => String(id) !== String(stepId));
            return {
                ...menu,
                step_ids: stepIds,
                stepIds
            };
        });
        saveStoredTreatmentSteps();
        saveStoredTreatmentMenus();
        try {
            const result = await api.updateTreatmentSteps(state.treatmentSteps);
            if (Array.isArray(result.steps)) {
                state.treatmentSteps = result.steps.map(normalizeTreatmentStep).filter(step => step.is_active !== false);
                saveStoredTreatmentSteps();
            }
        } catch (error) {
            console.warn('Treatment step server delete failed, keeping local data:', error);
        }
        this.renderTreatmentSettings();
    },

    showTreatmentStepModal(stepId = '') {
        const modal = document.getElementById('treatmentStepModal');
        const title = document.getElementById('treatmentStepModalTitle');
        const form = document.getElementById('treatmentStepForm');
        const idInput = document.getElementById('treatmentStepId');
        const codeInput = document.getElementById('treatmentStepCode');
        const nameInput = document.getElementById('treatmentStepName');
        const descriptionInput = document.getElementById('treatmentStepDescription');
        if (!modal || !form || !nameInput) return;

        const step = stepId
            ? state.treatmentSteps.find(item => String(item.id) === String(stepId))
            : null;
        form.reset();
        title.textContent = step ? 'ステップ詳細' : 'ステップ追加';
        idInput.value = step?.id || '';
        codeInput.value = step?.code || '';
        nameInput.value = step?.name || '';
        descriptionInput.value = step?.description || '';
        this.renderTreatmentStepTypeOptions(step?.step_type || step?.stepType || 'treatment');
        this.renderTreatmentStepStaffAssignments(step?.staff_ids || step?.staffIds || []);
        this.renderTreatmentStepRoomEquipmentAssignments(
            step?.room_codes || step?.roomCodes || [],
            step?.equipment_codes || step?.equipmentCodes || []
        );
        document.getElementById('deleteTreatmentStepFromModal')?.classList.toggle('hidden', !step);
        modal.classList.remove('hidden');
        requestAnimationFrame(() => nameInput.focus());
    },

    hideTreatmentStepModal() {
        document.getElementById('treatmentStepModal')?.classList.add('hidden');
    },

    renderTreatmentStepTypeOptions(selectedType = 'treatment') {
        const container = document.getElementById('treatmentStepTypeOptions');
        if (!container) return;
        const selected = normalizeTreatmentStepType(selectedType);
        const notes = {
            diagnosis: '医師による診察に使用します',
            counseling: 'カウンセリングに使用します',
            treatment: '医師や看護師による施術に使用します',
            other: '上記に当てはまらないステップに使用します'
        };
        container.innerHTML = TREATMENT_STEP_TYPES.map(type => `
            <label class="treatment-step-type-option ${type.value === selected ? 'selected' : ''}">
                <input type="radio" name="treatmentStepType" value="${escapeHTML(type.value)}" ${type.value === selected ? 'checked' : ''}>
                <span class="treatment-step-type-name">${escapeHTML(type.label)}</span>
                <span class="treatment-step-type-note">${escapeHTML(notes[type.value] || '')}</span>
            </label>
        `).join('');
    },

    renderTreatmentStepStaffAssignments(selectedIds = []) {
        const container = document.getElementById('treatmentStepStaffAssignments');
        if (!container) return;
        const selected = new Set(normalizeTreatmentStaffIds(selectedIds));
        const staff = (state.treatmentStaff || [])
            .filter(item => item.is_active !== false && item.name)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
        if (!staff.length) {
            container.innerHTML = '<div class="treatment-step-assignment-empty">スタッフが未設定です</div>';
            return;
        }
        container.innerHTML = TREATMENT_RESOURCE_ROLES.map(role => {
            const roleStaff = staff.filter(item => item.role === role.value);
            if (!roleStaff.length) return '';
            return `
                <div class="treatment-step-assignment-column">
                    <div class="treatment-step-assignment-title">${escapeHTML(role.label)}</div>
                    ${roleStaff.map(item => `
                        <label class="treatment-step-assignment-check">
                            <input type="checkbox" class="treatment-step-staff-check" value="${escapeHTML(item.id)}" ${selected.has(String(item.id)) ? 'checked' : ''}>
                            <span>${escapeHTML(item.name)}</span>
                        </label>
                    `).join('')}
                </div>
            `;
        }).join('') || '<div class="treatment-step-assignment-empty">スタッフが未設定です</div>';
    },

    renderTreatmentStepRoomEquipmentAssignments(selectedRoomCodes = [], selectedEquipmentCodes = []) {
        const container = document.getElementById('treatmentStepRoomEquipmentAssignments');
        if (!container) return;
        const selectedRooms = new Set(normalizeTreatmentRoomCodes(selectedRoomCodes));
        const selectedEquipment = new Set(normalizeTreatmentEquipmentCodes(selectedEquipmentCodes));
        const rooms = (state.treatmentRooms || []).filter(item => item.is_active !== false);
        const equipment = (state.treatmentEquipment || []).filter(item => item.is_active !== false);
        container.innerHTML = `
            <div class="treatment-step-assignment-column">
                <div class="treatment-step-assignment-title">ルーム</div>
                ${rooms.length ? rooms.map(room => `
                    <label class="treatment-step-assignment-check">
                        <input type="checkbox" class="treatment-step-room-check" value="${escapeHTML(room.code)}" ${selectedRooms.has(room.code) ? 'checked' : ''}>
                        <span>${escapeHTML(room.label)}</span>
                    </label>
                `).join('') : '<div class="treatment-step-assignment-empty">ルームが未設定です</div>'}
            </div>
            <div class="treatment-step-assignment-column">
                <div class="treatment-step-assignment-title">機材</div>
                ${equipment.length ? equipment.map(item => `
                    <label class="treatment-step-assignment-check">
                        <input type="checkbox" class="treatment-step-equipment-check" value="${escapeHTML(item.code)}" ${selectedEquipment.has(item.code) ? 'checked' : ''}>
                        <span>${escapeHTML(item.label)}</span>
                    </label>
                `).join('') : '<div class="treatment-step-assignment-empty">機材が未設定です</div>'}
            </div>
        `;
    },

    readTreatmentStepModal() {
        const stepId = document.getElementById('treatmentStepId')?.value || '';
        const existing = stepId ? state.treatmentSteps.find(item => String(item.id) === String(stepId)) : null;
        const name = document.getElementById('treatmentStepName')?.value.trim() || '';
        if (!name) {
            showAlert('ステップ名を入力してください', 'error');
            return null;
        }
        const stepType = document.querySelector('input[name="treatmentStepType"]:checked')?.value || 'treatment';
        const staffIds = Array.from(document.querySelectorAll('.treatment-step-staff-check:checked')).map(input => input.value);
        const roomCodes = Array.from(document.querySelectorAll('.treatment-step-room-check:checked')).map(input => input.value);
        const equipmentCodes = Array.from(document.querySelectorAll('.treatment-step-equipment-check:checked')).map(input => input.value);
        const nextOrder = (state.treatmentSteps || []).reduce((max, step) => Math.max(max, Number(step.display_order || 0)), 0) + 10;
        const roleByType = {
            diagnosis: 'doctor',
            counseling: 'nurse',
            treatment: 'nurse',
            other: 'nurse'
        };
        return normalizeTreatmentStep({
            ...(existing || {}),
            id: stepId || generateLocalId('step'),
            code: document.getElementById('treatmentStepCode')?.value || existing?.code || createTreatmentStepCode(name),
            name,
            description: document.getElementById('treatmentStepDescription')?.value.trim() || '',
            duration_minutes: existing?.duration_minutes || 0,
            step_type: stepType,
            resource_type: existing?.resource_type || roleByType[stepType] || 'nurse',
            staff_ids: staffIds,
            room_codes: roomCodes,
            equipment_codes: equipmentCodes,
            display_order: existing?.display_order || nextOrder,
            is_active: true
        });
    },

    async saveTreatmentStepFromModal() {
        const step = this.readTreatmentStepModal();
        if (!step) return;
        const index = state.treatmentSteps.findIndex(item => String(item.id) === String(step.id));
        if (index >= 0) {
            state.treatmentSteps[index] = step;
        } else {
            state.treatmentSteps.push(step);
        }
        state.treatmentSteps = mergeSimpleTreatmentSteps(state.treatmentSteps);
        saveStoredTreatmentSteps();
        await this.saveTreatmentSteps();
        this.hideTreatmentStepModal();
    },

    treatmentMenuRowKey(menu = {}) {
        return String(menu.id || menu.local_id || menu.code || '');
    },

    getTreatmentMenuCategoryId(menu = {}) {
        return menu.beauty_category_id || menu.beautyCategoryId || menu.category_id || defaultBeautyCategoryIdForCode(menu.code) || '';
    },

    findTreatmentMenuByKey(rowKey = '') {
        const key = String(rowKey || '');
        return (state.treatmentMenus || []).find(menu =>
            String(menu.id || '') === key ||
            String(menu.local_id || '') === key ||
            String(menu.code || '') === key ||
            this.treatmentMenuRowKey(menu) === key
        ) || null;
    },

    findTreatmentMenuByCategory(categoryId = '') {
        const category = getBeautyCategoryById(categoryId);
        return (state.treatmentMenus || []).find(menu =>
            menu.is_active !== false &&
            String(this.getTreatmentMenuCategoryId(menu)) === String(categoryId)
        ) || (state.treatmentMenus || []).find(menu =>
            menu.is_active !== false &&
            category?.code &&
            String(menu.code || '') === String(category.code)
        ) || null;
    },

    getTreatmentDetailMenuRows() {
        const categoryOrders = new Map((state.beautyCategories || []).map(category => [
            String(category.id),
            Number(category.display_order || 0)
        ]));
        return [...(state.treatmentMenus || [])]
            .filter(menu => menu.is_active !== false)
            .flatMap(menu => {
                const parentKey = this.treatmentMenuRowKey(menu);
                const categoryId = this.getTreatmentMenuCategoryId(menu);
                const details = normalizeTreatmentDetailMenus(
                    getTreatmentDetailMenuData(menu),
                    menu,
                    { useDefaults: !hasTreatmentDetailMenuData(menu) }
                ).filter(detail => detail.is_active !== false);
                return details.map(detail => ({
                    parentKey,
                    parentLabel: menu.label || '',
                    categoryId,
                    categoryName: getBeautyCategoryName(categoryId),
                    categoryOrder: categoryOrders.get(String(categoryId)) ?? Number(menu.display_order || 0),
                    menuOrder: Number(menu.display_order || 0),
                    detailId: detail.id || createTreatmentDetailMenuId(detail.label),
                    detail
                }));
            })
            .sort((a, b) =>
                a.categoryOrder - b.categoryOrder ||
                a.menuOrder - b.menuOrder ||
                Number(a.detail.display_order || 0) - Number(b.detail.display_order || 0) ||
                String(a.detail.label || '').localeCompare(String(b.detail.label || ''), 'ja')
            );
    },

    renderTreatmentMenuTable() {
        const tbody = document.getElementById('treatmentMenuBody');
        if (!tbody) return;

        const rows = this.getTreatmentDetailMenuRows();
        let html = rows.map(row => {
            const detail = row.detail;
            const price = formatTreatmentMenuListPriceLabel(detail);
            const taxLabel = getTreatmentTaxCategoryLabel(detail.tax_category || detail.taxCategory);
            const stepSummary = renderTreatmentStepSummaryList(
                detail.step_assignments || detail.stepAssignments,
                detail.step_ids || detail.stepIds,
                detail.duration_minutes || detail.durationMinutes
            );
            const visibleLabel = detail.customer_visible === false || detail.customerVisible === false ? '非表示' : '表示';
            return `
                <tr class="treatment-detail-item-row" data-row-key="${escapeHTML(row.parentKey)}" data-detail-id="${escapeHTML(row.detailId)}">
                    <td>
                        <span class="treatment-resource-chip treatment-category-chip">${escapeHTML(row.categoryName)}</span>
                    </td>
                    <td>
                        <div class="treatment-detail-menu-name-cell">
                            <span class="treatment-detail-menu-name">${escapeHTML(detail.label || '未設定')}</span>
                            ${row.parentLabel && row.parentLabel !== row.categoryName ? `<span class="treatment-detail-menu-sub">${escapeHTML(row.parentLabel)}</span>` : ''}
                        </div>
                    </td>
                    <td>
                        ${stepSummary}
                    </td>
                    <td>
                        <div class="treatment-menu-price-block">
                            <span class="treatment-detail-menu-price">${escapeHTML(price || '未設定')}</span>
                            <span class="treatment-menu-tax-label">${escapeHTML(taxLabel)}</span>
                        </div>
                    </td>
                    <td>
                        <span class="treatment-menu-visible-badge ${visibleLabel === '表示' ? 'visible' : 'hidden-state'}">${escapeHTML(visibleLabel)}</span>
                    </td>
                    <td class="col-actions admin-row-actions">
                        <div class="admin-action-pair compact">
                            <button class="admin-action-edit" type="button" onclick="handlers.editTreatmentDetailMenuItem('${escapeHTML(row.parentKey)}', '${escapeHTML(row.detailId)}')">編集</button>
                            <button class="admin-action-delete" type="button" onclick="handlers.deleteTreatmentDetailMenuItem('${escapeHTML(row.parentKey)}', '${escapeHTML(row.detailId)}')">削除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (!html) {
            html = '<tr><td colspan="6" class="treatment-detail-empty-cell">美容施術を作成してから、配下のメニューを追加してください</td></tr>';
        }

        html += `
            <tr class="treatment-menu-add-row">
                <td colspan="6">
                    <button type="button" class="btn-add-menu" onclick="handlers.addTreatmentMenuRow()">
                        メニューを追加
                    </button>
                </td>
            </tr>
        `;

        tbody.innerHTML = html;
    },

    setupTreatmentMenuDragAndDrop(tbody) {
        let draggedRow = null;

        tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
            row.addEventListener('dragstart', (e) => {
                draggedRow = row;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                draggedRow = null;
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (draggedRow && draggedRow !== row) {
                    row.classList.add('drag-over');
                }
            });

            row.addEventListener('dragleave', () => {
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
                if (draggedRow && draggedRow !== row) {
                    const allRows = Array.from(tbody.querySelectorAll('tr'));
                    const draggedIndex = allRows.indexOf(draggedRow);
                    const dropIndex = allRows.indexOf(row);

                    if (draggedIndex < dropIndex) {
                        row.parentNode.insertBefore(draggedRow, row.nextSibling);
                    } else {
                        row.parentNode.insertBefore(draggedRow, row);
                    }

                    // state.treatmentMenusの並び順を更新
                    this.updateTreatmentMenuOrder();
                }
            });
        });
    },

    updateTreatmentMenuOrder() {
        const tbody = document.getElementById('treatmentMenuBody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr[data-row-key]');
        rows.forEach((row, index) => {
            const rowKey = row.dataset.rowKey;
            const menu = state.treatmentMenus.find(m => String(m.id || m.local_id) === String(rowKey));
            if (menu) {
                menu.display_order = (index + 1) * 10;
            }
        });
    },

    addTreatmentMenuRow() {
        this.showTreatmentDetailItemModal();
    },

    populateTreatmentDetailCategorySelect(select, selectedId = '') {
        this.populateTreatmentMenuCategorySelect(select, selectedId);
    },

    getTreatmentDetailItemsForMenu(menu = {}) {
        if (!menu) return [];
        return normalizeTreatmentDetailMenus(
            getTreatmentDetailMenuData(menu),
            menu,
            { useDefaults: !hasTreatmentDetailMenuData(menu) }
        ).filter(detail => detail.is_active !== false);
    },

    setTreatmentDetailItemsForMenu(menu, details = []) {
        if (!menu) return;
        const normalized = normalizeTreatmentDetailMenus(details, menu, { useDefaults: false })
            .map((detail, index) => ({
                ...detail,
                display_order: Number.isFinite(Number(detail.display_order)) ? Number(detail.display_order) : index * 10
            }));
        menu.detail_menus = normalized;
        menu.detailMenus = normalized;
    },

    createTreatmentMenuShellForCategory(categoryId = '') {
        const category = getBeautyCategoryById(categoryId);
        if (!category) {
            showAlert('美容施術カテゴリーを選択してください', 'error');
            return null;
        }

        const existing = this.findTreatmentMenuByCategory(categoryId);
        if (existing) {
            existing.beauty_category_id = category.id;
            existing.beautyCategoryId = category.id;
            if (!existing.label) existing.label = category.name;
            if (!existing.code) existing.code = category.code || createTreatmentMenuCode(category.name);
            return existing;
        }

        const template = DEFAULT_TREATMENT_MENUS.find(menu => menu.code === category.code) || {};
        const maxOrder = (state.treatmentMenus || []).reduce((max, menu) => Math.max(max, Number(menu.display_order || 0)), 0);
        const menu = normalizeTreatmentMenu({
            ...template,
            local_id: generateLocalId('menu'),
            code: category.code || createTreatmentMenuCode(category.name),
            label: category.name,
            beauty_category_id: category.id,
            beautyCategoryId: category.id,
            resource_type: template.resource_type || 'nurse',
            resource_types: template.resource_types || [template.resource_type || 'nurse'],
            menu_capacity: template.menu_capacity || 1,
            detail_menus: [],
            display_order: maxOrder + 10,
            is_active: true
        });
        menu.detail_menus = [];
        menu.detailMenus = [];
        state.treatmentMenus.push(menu);
        return menu;
    },

    createUniqueTreatmentDetailItemId(menu, label = '', ignoreId = '') {
        const base = createTreatmentDetailMenuId(label);
        const usedIds = new Set(this.getTreatmentDetailItemsForMenu(menu)
            .map(detail => String(detail.id || ''))
            .filter(id => id && id !== String(ignoreId || '')));
        if (!usedIds.has(base)) return base;
        let suffix = 2;
        while (usedIds.has(`${base}_${suffix}`)) suffix += 1;
        return `${base}_${suffix}`;
    },

    renderTreatmentDetailStepRow(item = {}) {
        const assignments = normalizeTreatmentDetailStepAssignments([item], [], item.duration_minutes ?? item.durationMinutes);
        const assignment = assignments[0] || {};
        const steps = (state.treatmentSteps || DEFAULT_TREATMENT_STEPS)
            .filter(step => step.is_active !== false)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
        const selectedStepId = assignment.step_id || steps[0]?.id || '';
        const selectedStep = getTreatmentStepById(selectedStepId);
        const duration = assignment.duration_minutes || selectedStep?.duration_minutes || 30;
        return `
            <div class="treatment-detail-step-row">
                <select class="treatment-detail-line-control treatment-detail-step-id" required>
                    ${steps.map(step => `
                        <option value="${escapeHTML(step.id)}" ${String(step.id) === String(selectedStepId) ? 'selected' : ''}>
                            ${escapeHTML(step.name)}
                        </option>
                    `).join('')}
                </select>
                <div class="treatment-detail-step-minutes">
                    <input type="number" class="treatment-detail-line-control treatment-detail-step-duration" value="${escapeHTML(duration)}" min="0" max="480" step="5">
                    <span>分</span>
                </div>
                <label class="dept-checkbox-label treatment-detail-inline-check">
                    <input type="checkbox" class="treatment-detail-step-nomination" ${assignment.nomination_enabled || assignment.nominationEnabled ? 'checked' : ''}>
                    <span>指名可能</span>
                </label>
                <button type="button" class="treatment-detail-step-icon-btn" data-action="add-detail-step" aria-label="ステップを追加">+</button>
                <button type="button" class="treatment-detail-step-icon-btn remove" data-action="remove-detail-step" aria-label="ステップを削除">−</button>
            </div>
        `;
    },

    renderTreatmentDetailStepRows(assignments = []) {
        const list = document.getElementById('treatmentDetailStepRows');
        if (!list) return;
        const rows = normalizeTreatmentDetailStepAssignments(assignments, []);
        list.innerHTML = rows.length
            ? rows.map(item => this.renderTreatmentDetailStepRow(item)).join('')
            : '<div class="treatment-detail-step-empty">ステップが未設定です</div>';
    },

    addTreatmentDetailStepRow(item = {}) {
        const list = document.getElementById('treatmentDetailStepRows');
        if (!list) return;
        const empty = list.querySelector('.treatment-detail-step-empty');
        if (empty) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', this.renderTreatmentDetailStepRow(item));
        this.updateTreatmentDetailDerivedDuration();
    },

    readTreatmentDetailStepRows() {
        const rows = Array.from(document.querySelectorAll('#treatmentDetailStepRows .treatment-detail-step-row'));
        return normalizeTreatmentDetailStepAssignments(rows.map((row, index) => ({
            step_id: row.querySelector('.treatment-detail-step-id')?.value || '',
            duration_minutes: row.querySelector('.treatment-detail-step-duration')?.value || '',
            nomination_enabled: row.querySelector('.treatment-detail-step-nomination')?.checked || false,
            display_order: index * 10
        })), []);
    },

    updateTreatmentDetailDerivedDuration() {
        const assignments = this.readTreatmentDetailStepRows();
        const durationMinutes = treatmentDetailDurationFromSteps(assignments) || '';
        const durationInput = document.getElementById('treatmentDetailItemDuration');
        const durationMinutesInput = document.getElementById('treatmentDetailItemDurationMinutes');
        const setDurationInput = document.getElementById('treatmentDetailItemSetDuration');
        if (durationInput) durationInput.value = durationMinutes ? `約${durationMinutes}分` : '';
        if (durationMinutesInput) durationMinutesInput.value = durationMinutes || '';
        if (setDurationInput) setDurationInput.value = durationMinutes || '';
    },

    showTreatmentDetailItemModal(parentKey = '', detailId = '') {
        const modal = document.getElementById('treatmentDetailItemModal');
        const form = document.getElementById('treatmentDetailItemForm');
        const title = document.getElementById('treatmentDetailItemModalTitle');
        const categorySelect = document.getElementById('treatmentDetailCategory');
        const parentKeyInput = document.getElementById('treatmentDetailParentMenuKey');
        const originalIdInput = document.getElementById('treatmentDetailOriginalId');
        const labelInput = document.getElementById('treatmentDetailItemLabel');
        const priceInput = document.getElementById('treatmentDetailItemPrice');
        const durationInput = document.getElementById('treatmentDetailItemDuration');
        const durationMinutesInput = document.getElementById('treatmentDetailItemDurationMinutes');
        const setDurationInput = document.getElementById('treatmentDetailItemSetDuration');
        const equipmentLabelInput = document.getElementById('treatmentDetailItemEquipmentLabel');
        const equipmentCodeInput = document.getElementById('treatmentDetailItemEquipmentCode');
        const descriptionInput = document.getElementById('treatmentDetailItemDescription');
        const deleteButton = document.getElementById('deleteTreatmentDetailItemModal');

        const categories = (state.beautyCategories || [])
            .filter(category => category.is_active !== false)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
        if (!categories.length) {
            showAlert('先に美容施術カテゴリーを作成してください', 'error');
            return;
        }

        form?.reset();
        const parentMenu = parentKey ? this.findTreatmentMenuByKey(parentKey) : null;
        const detail = parentMenu && detailId
            ? this.getTreatmentDetailItemsForMenu(parentMenu).find(item => String(item.id) === String(detailId))
            : null;
        const selectedCategoryId = parentMenu ? this.getTreatmentMenuCategoryId(parentMenu) : categories[0].id;

        if (title) title.textContent = detail ? 'メニュー編集' : 'メニュー追加';
        if (parentKeyInput) parentKeyInput.value = parentMenu ? this.treatmentMenuRowKey(parentMenu) : '';
        if (originalIdInput) originalIdInput.value = detail?.id || '';
        this.populateTreatmentDetailCategorySelect(categorySelect, selectedCategoryId);

        if (labelInput) labelInput.value = detail?.label || '';
        if (priceInput) priceInput.value = detail?.price || '';
        if (document.getElementById('treatmentDetailLowestPrice')) document.getElementById('treatmentDetailLowestPrice').checked = Boolean(detail?.lowest_price || detail?.lowestPrice);
        if (document.getElementById('treatmentDetailTaxCategory')) document.getElementById('treatmentDetailTaxCategory').value = detail?.tax_category || detail?.taxCategory || 'standard_10';
        if (durationInput) durationInput.value = detail?.duration || '';
        if (durationMinutesInput) durationMinutesInput.value = detail?.duration_minutes || '';
        if (setDurationInput) setDurationInput.value = detail?.set_duration_minutes || detail?.setDurationMinutes || '';
        if (equipmentLabelInput) equipmentLabelInput.value = detail?.equipment_label || detail?.equipmentLabel || '';
        if (equipmentCodeInput) equipmentCodeInput.value = detail?.equipment_code || detail?.equipmentCode || '';
        if (descriptionInput) descriptionInput.value = detail?.description || getDefaultTreatmentDetailDescription();
        if (document.getElementById('treatmentDetailCaution')) document.getElementById('treatmentDetailCaution').value = detail?.caution || detail?.notice || getDefaultTreatmentDetailCaution();
        if (document.getElementById('treatmentDetailCustomerVisible')) document.getElementById('treatmentDetailCustomerVisible').checked = detail ? detail.customer_visible !== false && detail.customerVisible !== false : true;
        if (document.getElementById('treatmentDetailAvailableFrom')) document.getElementById('treatmentDetailAvailableFrom').value = detail?.available_from || detail?.availableFrom || '';
        if (document.getElementById('treatmentDetailAvailableTo')) document.getElementById('treatmentDetailAvailableTo').value = detail?.available_to || detail?.availableTo || '';
        if (document.getElementById('treatmentDetailStartTimeLimited')) document.getElementById('treatmentDetailStartTimeLimited').checked = Boolean(detail?.start_time_limited || detail?.startTimeLimited);
        if (document.getElementById('treatmentDetailCloseBufferEnabled')) document.getElementById('treatmentDetailCloseBufferEnabled').checked = Boolean(detail?.closing_buffer_enabled || detail?.closingBufferEnabled);
        if (document.getElementById('treatmentDetailCloseBufferMinutes')) document.getElementById('treatmentDetailCloseBufferMinutes').value = detail?.closing_buffer_minutes || detail?.closingBufferMinutes || '';
        if (document.getElementById('treatmentDetailDailyLimitEnabled')) document.getElementById('treatmentDetailDailyLimitEnabled').checked = Boolean(detail?.daily_limit_enabled || detail?.dailyLimitEnabled);
        if (document.getElementById('treatmentDetailDailyLimit')) document.getElementById('treatmentDetailDailyLimit').value = detail?.daily_limit || detail?.dailyLimit || '';
        if (document.getElementById('treatmentDetailChangeCancelAllowed')) document.getElementById('treatmentDetailChangeCancelAllowed').checked = detail ? detail.change_cancel_allowed !== false && detail.changeCancelAllowed !== false : true;
        if (document.getElementById('treatmentDetailSkipDuplicate')) document.getElementById('treatmentDetailSkipDuplicate').checked = detail ? detail.skip_duplicate !== false && detail.skipDuplicate !== false : true;
        if (deleteButton) deleteButton.classList.toggle('hidden', !detail);

        const selectedCategory = getBeautyCategoryById(selectedCategoryId);
        const fallbackTemplate = parentMenu || DEFAULT_TREATMENT_MENUS.find(menu => menu.code === selectedCategory?.code) || { code: selectedCategory?.code || '', resource_type: 'nurse' };
        this.renderTreatmentDetailStepRows(detail?.step_assignments || detail?.stepAssignments || normalizeTreatmentDetailStepAssignments(
            [],
            detail?.step_ids || detail?.stepIds || fallbackTemplate.step_ids || fallbackTemplate.stepIds || defaultStepIdsForTreatmentMenu(fallbackTemplate),
            detail?.duration_minutes || detail?.durationMinutes
        ));
        this.updateTreatmentDetailDerivedDuration();

        modal?.classList.remove('hidden');
        setTimeout(() => labelInput?.focus(), 0);
    },

    hideTreatmentDetailItemModal() {
        document.getElementById('treatmentDetailItemModal')?.classList.add('hidden');
    },

    readTreatmentDetailItemModal() {
        const categoryId = document.getElementById('treatmentDetailCategory')?.value || '';
        const parentKey = document.getElementById('treatmentDetailParentMenuKey')?.value || '';
        const originalId = document.getElementById('treatmentDetailOriginalId')?.value || '';
        const label = document.getElementById('treatmentDetailItemLabel')?.value.trim() || '';
        const price = document.getElementById('treatmentDetailItemPrice')?.value.trim() || '';
        const stepAssignments = this.readTreatmentDetailStepRows();
        const durationMinutes = treatmentDetailDurationFromSteps(stepAssignments);
        const durationInput = durationMinutes ? `約${durationMinutes}分` : '';
        const setDurationMinutes = durationMinutes;
        const equipmentCodeInput = document.getElementById('treatmentDetailItemEquipmentCode')?.value.trim() || '';
        const equipmentLabelInput = document.getElementById('treatmentDetailItemEquipmentLabel')?.value.trim() || '';
        const description = document.getElementById('treatmentDetailItemDescription')?.value.trim() || '';
        const caution = document.getElementById('treatmentDetailCaution')?.value.trim() || '';

        if (!categoryId) {
            showAlert('美容施術カテゴリーを選択してください', 'error');
            return null;
        }
        if (!label) {
            showAlert('メニュー名を入力してください', 'error');
            return null;
        }
        if (!price) {
            showAlert('価格を入力してください', 'error');
            return null;
        }
        if (!stepAssignments.length) {
            showAlert('ステップを1つ以上設定してください', 'error');
            return null;
        }

        const equipmentCode = equipmentCodeInput || inferTreatmentEquipmentCode({ label, description }, createTreatmentMenuCode(label));
        const equipmentLabel = equipmentLabelInput || inferTreatmentEquipmentLabel({ label, equipment_code: equipmentCode }, label);
        const stepIds = treatmentDetailStepIds(stepAssignments);
        const closingBufferMinutes = normalizeTreatmentDurationMinutes(document.getElementById('treatmentDetailCloseBufferMinutes')?.value || '');
        const dailyLimit = Number(document.getElementById('treatmentDetailDailyLimit')?.value || '') || null;

        return {
            categoryId,
            parentKey,
            originalId,
            detail: {
                id: originalId || '',
                label,
                price,
                priceSub: '',
                lowest_price: document.getElementById('treatmentDetailLowestPrice')?.checked || false,
                lowestPrice: document.getElementById('treatmentDetailLowestPrice')?.checked || false,
                tax_category: document.getElementById('treatmentDetailTaxCategory')?.value || 'standard_10',
                taxCategory: document.getElementById('treatmentDetailTaxCategory')?.value || 'standard_10',
                duration: durationInput,
                duration_minutes: durationMinutes,
                equipment_code: equipmentCode,
                equipmentCode,
                equipment_label: equipmentLabel,
                equipmentLabel,
                set_duration_minutes: setDurationMinutes,
                setDurationMinutes: setDurationMinutes,
                description,
                benefit: getTreatmentDetailBenefitDefault(label, description),
                caution,
                notice: caution,
                customer_visible: document.getElementById('treatmentDetailCustomerVisible')?.checked !== false,
                customerVisible: document.getElementById('treatmentDetailCustomerVisible')?.checked !== false,
                available_from: document.getElementById('treatmentDetailAvailableFrom')?.value || '',
                availableFrom: document.getElementById('treatmentDetailAvailableFrom')?.value || '',
                available_to: document.getElementById('treatmentDetailAvailableTo')?.value || '',
                availableTo: document.getElementById('treatmentDetailAvailableTo')?.value || '',
                start_time_limited: document.getElementById('treatmentDetailStartTimeLimited')?.checked || false,
                startTimeLimited: document.getElementById('treatmentDetailStartTimeLimited')?.checked || false,
                closing_buffer_enabled: document.getElementById('treatmentDetailCloseBufferEnabled')?.checked || false,
                closingBufferEnabled: document.getElementById('treatmentDetailCloseBufferEnabled')?.checked || false,
                closing_buffer_minutes: closingBufferMinutes,
                closingBufferMinutes,
                daily_limit_enabled: document.getElementById('treatmentDetailDailyLimitEnabled')?.checked || false,
                dailyLimitEnabled: document.getElementById('treatmentDetailDailyLimitEnabled')?.checked || false,
                daily_limit: dailyLimit,
                dailyLimit,
                change_cancel_allowed: document.getElementById('treatmentDetailChangeCancelAllowed')?.checked !== false,
                changeCancelAllowed: document.getElementById('treatmentDetailChangeCancelAllowed')?.checked !== false,
                skip_duplicate: document.getElementById('treatmentDetailSkipDuplicate')?.checked !== false,
                skipDuplicate: document.getElementById('treatmentDetailSkipDuplicate')?.checked !== false,
                step_ids: stepIds,
                stepIds,
                step_assignments: stepAssignments,
                stepAssignments,
                is_active: true
            }
        };
    },

    async saveTreatmentDetailItemFromModal() {
        const formData = this.readTreatmentDetailItemModal();
        if (!formData) return;

        const { categoryId, parentKey, originalId, detail } = formData;
        const sourceParent = parentKey ? this.findTreatmentMenuByKey(parentKey) : null;
        const targetParent = this.createTreatmentMenuShellForCategory(categoryId);
        if (!targetParent) return;

        const sourceKey = sourceParent ? this.treatmentMenuRowKey(sourceParent) : '';
        const targetKey = this.treatmentMenuRowKey(targetParent);
        const sameParent = sourceParent && sourceKey === targetKey;
        const sourceDetails = sourceParent ? this.getTreatmentDetailItemsForMenu(sourceParent) : [];
        const existingDetail = originalId
            ? sourceDetails.find(item => String(item.id) === String(originalId))
            : null;
        const targetDetails = sameParent ? sourceDetails : this.getTreatmentDetailItemsForMenu(targetParent);
        const detailId = detail.id && !targetDetails.some(item => String(item.id) === String(detail.id) && String(item.id) !== String(originalId))
            ? detail.id
            : this.createUniqueTreatmentDetailItemId(targetParent, detail.label, sameParent ? originalId : '');
        const nextOrder = targetDetails.reduce((max, item) => Math.max(max, Number(item.display_order || 0)), -10) + 10;
        const mergedDetail = normalizeTreatmentDetailMenus([{
            ...(existingDetail || {}),
            ...detail,
            id: detailId,
            display_order: existingDetail?.display_order ?? nextOrder
        }], targetParent, { useDefaults: false })[0];

        if (sameParent && originalId) {
            let replaced = false;
            const updated = sourceDetails.map(item => {
                if (String(item.id) !== String(originalId)) return item;
                replaced = true;
                return mergedDetail;
            });
            if (!replaced) updated.push(mergedDetail);
            this.setTreatmentDetailItemsForMenu(targetParent, updated);
        } else {
            if (sourceParent && originalId) {
                this.setTreatmentDetailItemsForMenu(
                    sourceParent,
                    sourceDetails.filter(item => String(item.id) !== String(originalId))
                );
            }
            this.setTreatmentDetailItemsForMenu(targetParent, [
                ...targetDetails,
                {
                    ...mergedDetail,
                    display_order: nextOrder
                }
            ]);
        }

        saveStoredTreatmentMenus();
        let syncFailed = false;
        try {
            if (sourceParent && sourceParent !== targetParent) {
                await this.syncTreatmentMenuToServer(sourceParent);
            }
            await this.syncTreatmentMenuToServer(targetParent);
            saveStoredTreatmentMenus();
        } catch (error) {
            syncFailed = true;
            console.warn('Treatment detail menu server save failed, keeping local data:', error);
        }

        this.hideTreatmentDetailItemModal();
        this.renderTreatmentSettings();
        showAlert(syncFailed ? 'メニューをローカルに保存しました' : 'メニューを保存しました', 'success');
    },

    async deleteTreatmentDetailMenuItem(parentKey, detailId) {
        const parentMenu = this.findTreatmentMenuByKey(parentKey);
        if (!parentMenu) return false;
        const details = this.getTreatmentDetailItemsForMenu(parentMenu);
        const target = details.find(item => String(item.id) === String(detailId));
        if (!target) return false;
        if (!confirm(`「${target.label}」を削除しますか？`)) return false;

        this.setTreatmentDetailItemsForMenu(
            parentMenu,
            details
                .filter(item => String(item.id) !== String(detailId))
                .map((item, index) => ({ ...item, display_order: index * 10 }))
        );
        saveStoredTreatmentMenus();

        let syncFailed = false;
        try {
            await this.syncTreatmentMenuToServer(parentMenu);
            saveStoredTreatmentMenus();
        } catch (error) {
            syncFailed = true;
            console.warn('Treatment detail menu server delete failed, keeping local data:', error);
        }

        this.renderTreatmentSettings();
        showAlert(syncFailed ? 'メニューをローカルで削除しました' : 'メニューを削除しました', 'success');
        return true;
    },

    async deleteTreatmentDetailItemFromModal() {
        const parentKey = document.getElementById('treatmentDetailParentMenuKey')?.value || '';
        const detailId = document.getElementById('treatmentDetailOriginalId')?.value || '';
        if (!parentKey || !detailId) return;
        const deleted = await this.deleteTreatmentDetailMenuItem(parentKey, detailId);
        if (deleted) this.hideTreatmentDetailItemModal();
    },

    setTreatmentMenuResourceChecks(values, fallback = 'nurse', staffIds = []) {
        this.renderTreatmentMenuStaffChecks(staffIds, normalizeTreatmentResourceTypes(values, fallback));
    },

    renderTreatmentMenuStaffChecks(staffIds = [], fallbackRoles = ['nurse']) {
        const container = document.getElementById('treatmentMenuResource');
        if (!container) return;
        const staff = (state.treatmentStaff || [])
            .map(normalizeTreatmentStaff)
            .filter(item => item.is_active !== false && item.name);
        if (!staff.length) {
            container.innerHTML = '<span class="muted-cell">スタッフマスタが未設定です</span>';
            return;
        }

        const selected = new Set(normalizeTreatmentStaffIds(staffIds));
        const fallbackSet = new Set(normalizeTreatmentResourceTypes(fallbackRoles, 'nurse'));
        if (!selected.size) {
            staff
                .filter(item => fallbackSet.has(item.role))
                .forEach(item => selected.add(String(item.id)));
        }
        if (!selected.size) selected.add(String(staff[0].id));

        container.innerHTML = staff.map(item => `
            <label class="dept-checkbox-label">
                <input
                    type="checkbox"
                    class="treatment-menu-staff-checkbox"
                    value="${escapeHTML(item.id)}"
                    data-role="${escapeHTML(item.role)}"
                    ${selected.has(String(item.id)) ? 'checked' : ''}
                >
                <span>${escapeHTML(item.name)}（${escapeHTML(getTreatmentResourceLabel(item.role))}）</span>
            </label>
        `).join('');
    },

    readTreatmentMenuStaffChecks() {
        return normalizeTreatmentStaffIds(
            Array.from(document.querySelectorAll('#treatmentMenuResource .treatment-menu-staff-checkbox:checked'))
                .map(input => input.value)
        );
    },

    readTreatmentMenuResourceChecks(fallback = 'nurse') {
        const staffChecks = Array.from(document.querySelectorAll('#treatmentMenuResource .treatment-menu-staff-checkbox:checked'));
        if (staffChecks.length) {
            return normalizeTreatmentResourceTypes(staffChecks.map(input => input.dataset.role), fallback);
        }
        const checked = Array.from(document.querySelectorAll('#treatmentMenuResource .treatment-menu-resource-checkbox:checked'))
            .map(input => input.value);
        return normalizeTreatmentResourceTypes(checked, fallback);
    },

    renderTreatmentMenuRoomChecks(values = []) {
        const container = document.getElementById('treatmentMenuRooms');
        if (!container) return;
        const selected = new Set(normalizeTreatmentRoomCodes(values));
        const rooms = (state.treatmentRooms || []).filter(room => room.is_active !== false);
        if (!rooms.length) {
            container.innerHTML = '<span class="muted-cell">部屋マスタが未設定です</span>';
            return;
        }
        if (!selected.size) selected.add(rooms[0].code);
        container.innerHTML = rooms.map(room => `
            <label class="dept-checkbox-label">
                <input type="checkbox" class="treatment-menu-room-checkbox" value="${escapeHTML(room.code)}" ${selected.has(room.code) ? 'checked' : ''}>
                <span>${escapeHTML(room.label)}</span>
            </label>
        `).join('');
    },

    readTreatmentMenuRoomChecks() {
        return normalizeTreatmentRoomCodes(
            Array.from(document.querySelectorAll('#treatmentMenuRooms .treatment-menu-room-checkbox:checked'))
                .map(input => input.value)
        );
    },

    renderTreatmentMenuEquipmentRequirementRow(item = {}) {
        const equipment = (state.treatmentEquipment || []).filter(row => row.is_active !== false);
        const normalized = normalizeTreatmentEquipmentRequirements([item])[0] || {};
        const selectedCode = normalized.resource_code || equipment[0]?.code || '';
        const selectedMaster = equipment.find(row => row.code === selectedCode);
        const duration = normalized.duration_minutes || selectedMaster?.default_duration_minutes || selectedMaster?.defaultDurationMinutes || '';
        return `
            <div class="treatment-equipment-requirement-row">
                <select class="dept-form-select treatment-equipment-requirement-code">
                    <option value="">機器を選択</option>
                    ${equipment.map(master => `
                        <option value="${escapeHTML(master.code)}" ${master.code === selectedCode ? 'selected' : ''}>${escapeHTML(master.label)}</option>
                    `).join('')}
                </select>
                <input type="number" class="dept-group-modal-input treatment-equipment-requirement-duration" value="${escapeHTML(duration)}" min="1" max="480" step="5" placeholder="使用分">
                <button type="button" class="treatment-detail-menu-delete" data-action="delete-equipment-requirement">削除</button>
            </div>
        `;
    },

    renderTreatmentMenuEquipmentRequirements(items = []) {
        const list = document.getElementById('treatmentMenuEquipmentRequirements');
        if (!list) return;
        const requirements = normalizeTreatmentEquipmentRequirements(items);
        list.innerHTML = requirements.length
            ? requirements.map(item => this.renderTreatmentMenuEquipmentRequirementRow(item)).join('')
            : '<div class="treatment-equipment-requirement-empty">機器を追加してください</div>';
    },

    addTreatmentMenuEquipmentRequirement(item = {}) {
        const list = document.getElementById('treatmentMenuEquipmentRequirements');
        if (!list) return;
        const empty = list.querySelector('.treatment-equipment-requirement-empty');
        if (empty) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', this.renderTreatmentMenuEquipmentRequirementRow(item));
    },

    readTreatmentMenuEquipmentRequirements() {
        const rows = Array.from(document.querySelectorAll('#treatmentMenuEquipmentRequirements .treatment-equipment-requirement-row'));
        const byCode = new Map((state.treatmentEquipment || []).map(item => [item.code, item]));
        return normalizeTreatmentEquipmentRequirements(rows.map((row, index) => {
            const code = row.querySelector('.treatment-equipment-requirement-code')?.value || '';
            const master = byCode.get(code);
            return {
                resource_code: code,
                resource_label: master?.label || code,
                duration_minutes: row.querySelector('.treatment-equipment-requirement-duration')?.value || master?.default_duration_minutes || '',
                source: index === 0 ? 'main' : 'set'
            };
        }));
    },

    showTreatmentMenuModal(rowKey = null) {
        const modal = document.getElementById('treatmentMenuModal');
        const title = document.getElementById('treatmentMenuModalTitle');
        const form = document.getElementById('treatmentMenuForm');
        const idInput = document.getElementById('treatmentMenuId');
        const labelInput = document.getElementById('treatmentMenuLabel');
        const categorySelect = document.getElementById('treatmentMenuCategory');
        const departmentSelect = document.getElementById('treatmentMenuDepartment');
        const capacityInput = document.getElementById('treatmentMenuCapacity');
        const activeCheckbox = document.getElementById('treatmentMenuActive');
        const leadInput = document.getElementById('treatmentMenuLead');
        const tagsInput = document.getElementById('treatmentMenuTags');
        const downtimeInput = document.getElementById('treatmentMenuDowntime');
        const priceInput = document.getElementById('treatmentMenuPrice');
        const priceSubInput = document.getElementById('treatmentMenuPriceSub');
        const durationInput = document.getElementById('treatmentMenuDuration');
        const durationMinutesInput = document.getElementById('treatmentMenuDurationMinutes');
        const equipmentCodeInput = document.getElementById('treatmentMenuEquipmentCode');
        const equipmentLabelInput = document.getElementById('treatmentMenuEquipmentLabel');
        const setDurationMinutesInput = document.getElementById('treatmentMenuSetDurationMinutes');
        const staffLabelInput = document.getElementById('treatmentMenuStaffLabel');
        const recommendationsGrid = document.getElementById('treatmentMenuRecommendations');
        const badgesInput = document.getElementById('treatmentMenuBadges');
        const confirmationNotesInput = document.getElementById('treatmentMenuConfirmationNotes');
        const imageFileInput = document.getElementById('treatmentMenuImageFile');

        // 診療科オプションを構築
        this.populateTreatmentMenuDepartmentSelect(departmentSelect);
        this.populateTreatmentMenuCategorySelect(categorySelect);

        if (rowKey) {
            // 編集モード
            const menu = state.treatmentMenus.find(m => String(m.id || m.local_id) === String(rowKey));
            if (!menu) return;
            const cardDefaults = getTreatmentCardDefaults(menu);

            title.textContent = '施術メニュー編集';
            idInput.value = rowKey;
            labelInput.value = menu.label || '';
            this.populateTreatmentMenuCategorySelect(categorySelect, menu.beauty_category_id || menu.beautyCategoryId || '');
            departmentSelect.value = menu.department_id || '';
            this.renderTreatmentMenuStepChecks(menu.step_ids || menu.stepIds);
            this.setTreatmentMenuResourceChecks(
                menu.resource_types || menu.resourceTypes,
                menu.resource_type || menu.resourceType || 'nurse',
                menu.staff_ids || menu.staffIds
            );
            capacityInput.value = menu.menu_capacity ?? 1;
            activeCheckbox.checked = menu.is_active !== false;
            leadInput.value = menu.lead || menu.description || cardDefaults.lead || '';
            tagsInput.value = splitTreatmentMetaList(menu.tags || menu.concerns || cardDefaults.tags).join('、');
            downtimeInput.value = menu.downtime || cardDefaults.downtime || '';
            priceInput.value = menu.price || cardDefaults.price || '';
            priceSubInput.value = menu.priceSub || menu.price_sub || cardDefaults.priceSub || '';
            durationInput.value = menu.duration || menu.durationLabel || cardDefaults.duration || '';
            if (durationMinutesInput) {
                durationMinutesInput.value = normalizeTreatmentDurationMinutes(
                    menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel ?? cardDefaults.duration
                ) || '';
            }
            if (equipmentCodeInput) equipmentCodeInput.value = inferTreatmentEquipmentCode(menu, menu.code || '');
            if (equipmentLabelInput) equipmentLabelInput.value = inferTreatmentEquipmentLabel(menu, menu.label || '');
            this.renderTreatmentMenuRoomChecks(menu.room_codes || menu.roomCodes);
            this.renderTreatmentMenuEquipmentRequirements(menu.equipment_requirements || menu.equipmentRequirements);
            if (setDurationMinutesInput) {
                setDurationMinutesInput.value = (
                    normalizeTreatmentDurationMinutes(menu.set_duration_minutes ?? menu.setDurationMinutes) ||
                    getDefaultTreatmentSetDuration(menu.code || createTreatmentMenuCode(menu.label)) ||
                    normalizeTreatmentDurationMinutes(menu.duration_minutes ?? menu.durationMinutes ?? menu.duration ?? menu.durationLabel ?? cardDefaults.duration)
                ) || '';
            }
            staffLabelInput.value = menu.staffLabel || menu.staff_label || cardDefaults.staffLabel || '';
            const hasSavedRecommendations =
                Object.prototype.hasOwnProperty.call(menu, 'recommended_menu_codes') ||
                Object.prototype.hasOwnProperty.call(menu, 'recommendedMenuCodes') ||
                Object.prototype.hasOwnProperty.call(menu, 'recommendations');
            this.renderTreatmentRecommendationOptions(rowKey, hasSavedRecommendations
                ? normalizeTreatmentRecommendationCodes(menu.recommended_menu_codes || menu.recommendedMenuCodes || menu.recommendations)
                : getTreatmentRecommendationDefaults(menu));
            if (confirmationNotesInput) confirmationNotesInput.value = splitTreatmentConfirmationNotes(
                menu.confirmation_notes || menu.confirmationNotes || menu.confirmation_note || getTreatmentConfirmationDefaults(menu)
            ).join('\n');
            badgesInput.value = splitTreatmentMetaList(menu.badges || cardDefaults.badges).join('、');
            this.renderTreatmentDetailMenuRows(normalizeTreatmentDetailMenus(
                getTreatmentDetailMenuData(menu),
                menu,
                { useDefaults: !hasTreatmentDetailMenuData(menu) }
            ));
            imageFileInput.value = '';
            this.updateTreatmentMenuImagePreview(menu.image_url || menu.imageUrl || menu.visualImage || menu.visual_image || '');
        } else {
            // 新規モード
            title.textContent = '施術メニュー追加';
            form.reset();
            idInput.value = '';
            const firstCategory = (state.beautyCategories || []).find(category => category.is_active !== false);
            this.populateTreatmentMenuCategorySelect(categorySelect, firstCategory?.id || '');
            this.renderTreatmentMenuStepChecks(defaultStepIdsForTreatmentMenu({ resource_type: 'nurse' }));
            this.setTreatmentMenuResourceChecks(['nurse'], 'nurse', []);
            activeCheckbox.checked = true;
            if (durationMinutesInput) durationMinutesInput.value = '';
            if (equipmentCodeInput) equipmentCodeInput.value = '';
            if (equipmentLabelInput) equipmentLabelInput.value = '';
            this.renderTreatmentMenuRoomChecks([]);
            this.renderTreatmentMenuEquipmentRequirements([]);
            if (setDurationMinutesInput) setDurationMinutesInput.value = '';
            if (recommendationsGrid) recommendationsGrid.innerHTML = '<div class="treatment-recommendation-empty">保存後におすすめ施術を選択できます</div>';
            if (confirmationNotesInput) confirmationNotesInput.value = '';
            this.renderTreatmentDetailMenuRows([]);
            this.updateTreatmentMenuImagePreview('');
        }

        modal.classList.remove('hidden');
    },

    hideTreatmentMenuModal() {
        const modal = document.getElementById('treatmentMenuModal');
        modal.classList.add('hidden');
    },

    updateTreatmentMenuImagePreview(imageUrl) {
        const preview = document.getElementById('treatmentMenuImagePreview');
        if (!preview) return;
        preview.dataset.imageUrl = imageUrl || '';
        if (!imageUrl) {
            preview.classList.remove('has-image');
            preview.style.backgroundImage = '';
            preview.innerHTML = `
                <span class="treatment-menu-image-placeholder">画像をここにドラッグ＆ドロップ</span>
                <span class="treatment-menu-image-subtext">または</span>
                <span class="treatment-menu-file-button">ファイルを選択</span>
            `;
            return;
        }
        preview.classList.add('has-image');
        preview.style.backgroundImage = `url("${String(imageUrl).replace(/["\\]/g, '\\$&')}")`;
        preview.innerHTML = '<span class="treatment-menu-image-selected">画像を選択済み</span>';
    },

    async setTreatmentMenuImageFile(file) {
        try {
            const imageUrl = await readTreatmentImageFile(file);
            const fileInput = document.getElementById('treatmentMenuImageFile');
            if (fileInput) fileInput.value = '';
            this.updateTreatmentMenuImagePreview(imageUrl);
        } catch (error) {
            showAlert(error.message, 'error');
        }
    },

    renderTreatmentDetailMenuRow(item = {}) {
        const detail = normalizeTreatmentDetailMenus([{
            id: item.id || item.code || item.local_id || generateLocalId('detail'),
            ...item
        }], {}, { useDefaults: false })[0] || {
            id: item.id || item.code || item.local_id || generateLocalId('detail'),
            label: item.label || item.name || '',
            price: item.price || '',
            duration: item.duration || item.durationLabel || '',
            duration_minutes: normalizeTreatmentDurationMinutes(item.duration_minutes ?? item.durationMinutes ?? item.duration ?? item.durationLabel),
            equipment_code: inferTreatmentEquipmentCode(item, item.id || item.code || ''),
            equipment_label: inferTreatmentEquipmentLabel(item, item.label || item.name || ''),
            set_duration_minutes: normalizeTreatmentDurationMinutes(item.set_duration_minutes ?? item.setDurationMinutes ?? item.duration_minutes ?? item.durationMinutes ?? item.duration ?? item.durationLabel),
            description: item.description || item.note || '',
            benefit: item.benefit || item.merit || item.oneLine || item.one_line || getTreatmentDetailBenefitDefault(item.label || item.name || '', item.description || item.note || '')
        };
        const detailJson = escapeHTML(JSON.stringify(detail));

        return `
            <div class="treatment-detail-menu-row" data-detail-id="${escapeHTML(detail.id)}">
                <input type="hidden" class="treatment-detail-extra-json" value="${detailJson}">
                <div class="treatment-detail-menu-main">
                    <label class="treatment-detail-field treatment-detail-field-name">
                        <span>メニュー名</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-label" value="${escapeHTML(detail.label)}" placeholder="顔（フォトダブル）">
                    </label>
                    <label class="treatment-detail-field">
                        <span>料金</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-price" value="${escapeHTML(detail.price)}" placeholder="¥9,900">
                    </label>
                    <label class="treatment-detail-field treatment-detail-field-description">
                        <span>補足</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-description" value="${escapeHTML(detail.description)}" placeholder="補足（任意）">
                    </label>
                    <label class="treatment-detail-field treatment-detail-field-benefit">
                        <span>一言・メリット</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-benefit" value="${escapeHTML(detail.benefit)}" placeholder="くすみ・毛穴ケアに">
                    </label>
                </div>
                <div class="treatment-detail-menu-reservation">
                    <label class="treatment-detail-field">
                        <span>表示時間</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-duration" value="${escapeHTML(detail.duration)}" placeholder="約45分">
                    </label>
                    <label class="treatment-detail-field">
                        <span>セット時分</span>
                        <input type="number" class="dept-group-modal-input treatment-detail-set-duration" value="${escapeHTML(detail.set_duration_minutes || '')}" min="1" max="480" step="5" placeholder="20">
                    </label>
                    <label class="treatment-detail-field">
                        <span>機器名</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-equipment-label" value="${escapeHTML(detail.equipment_label)}" placeholder="エレポ">
                    </label>
                    <label class="treatment-detail-field">
                        <span>機器コード</span>
                        <input type="text" class="dept-group-modal-input treatment-detail-equipment-code" value="${escapeHTML(detail.equipment_code)}" placeholder="electroporation">
                    </label>
                </div>
                <button type="button" class="treatment-detail-menu-delete" data-action="delete-detail-menu">削除</button>
            </div>
        `;
    },

    renderTreatmentDetailMenuRows(items = []) {
        const list = document.getElementById('treatmentDetailMenuList');
        if (!list) return;
        const addButton = document.getElementById('addTreatmentDetailMenu');
        const rows = normalizeTreatmentDetailMenus(items, {}, { useDefaults: false });
        list.innerHTML = rows.length
            ? rows.map(item => this.renderTreatmentDetailMenuRow(item)).join('')
            : '<button type="button" class="treatment-detail-menu-empty" data-action="add-detail-menu">メニューを追加</button>';
        addButton?.classList.toggle('hidden', !rows.length);
    },

    addTreatmentDetailMenuRow(item = {}) {
        const list = document.getElementById('treatmentDetailMenuList');
        if (!list) return;
        const empty = list.querySelector('.treatment-detail-menu-empty');
        if (empty) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', this.renderTreatmentDetailMenuRow(item));
        document.getElementById('addTreatmentDetailMenu')?.classList.remove('hidden');
    },

    readTreatmentDetailMenuRows() {
        const rows = Array.from(document.querySelectorAll('#treatmentDetailMenuList .treatment-detail-menu-row'));
        return rows
            .map((row, index) => {
                let extra = {};
                try {
                    extra = JSON.parse(row.querySelector('.treatment-detail-extra-json')?.value || '{}');
                } catch (error) {
                    extra = {};
                }
                return {
                    ...extra,
                    id: row.dataset.detailId || extra.id || generateLocalId('detail'),
                    label: row.querySelector('.treatment-detail-label')?.value.trim() || '',
                    price: row.querySelector('.treatment-detail-price')?.value.trim() || '',
                    duration: row.querySelector('.treatment-detail-duration')?.value.trim() || '',
                    duration_minutes: normalizeTreatmentDurationMinutes(row.querySelector('.treatment-detail-duration')?.value.trim()) || extra.duration_minutes || extra.durationMinutes || null,
                    equipment_code: row.querySelector('.treatment-detail-equipment-code')?.value.trim() || extra.equipment_code || extra.equipmentCode || '',
                    equipment_label: row.querySelector('.treatment-detail-equipment-label')?.value.trim() || extra.equipment_label || extra.equipmentLabel || '',
                    set_duration_minutes: normalizeTreatmentDurationMinutes(row.querySelector('.treatment-detail-set-duration')?.value.trim()) || extra.set_duration_minutes || extra.setDurationMinutes || null,
                    description: row.querySelector('.treatment-detail-description')?.value.trim() || '',
                    benefit: row.querySelector('.treatment-detail-benefit')?.value.trim() || '',
                    is_active: true,
                    display_order: index * 10
                };
            })
            .filter(item => item.label || item.price || item.duration || item.description || item.benefit);
    },

    renderTreatmentRecommendationOptions(rowKey, selectedCodes = []) {
        const grid = document.getElementById('treatmentMenuRecommendations');
        if (!grid) return;
        const selected = new Set(normalizeTreatmentRecommendationCodes(selectedCodes));
        const currentMenu = state.treatmentMenus.find(menu => String(menu.id || menu.local_id) === String(rowKey));
        const currentCode = currentMenu?.code || '';
        const options = (state.treatmentMenus || [])
            .filter(menu => menu.is_active !== false)
            .filter(menu => menu.code && menu.code !== currentCode)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));

        if (!options.length) {
            grid.innerHTML = '<div class="treatment-recommendation-empty">他の施術メニューがありません</div>';
            return;
        }

        grid.innerHTML = options.map(menu => `
            <label class="treatment-recommendation-option">
                <input
                    type="checkbox"
                    class="treatment-recommendation-checkbox"
                    value="${escapeHTML(menu.code)}"
                    ${selected.has(menu.code) ? 'checked' : ''}
                >
                <span>${escapeHTML(menu.label || menu.code)}</span>
            </label>
        `).join('');
    },

    populateTreatmentMenuDepartmentSelect(select) {
        const departmentGroups = getDepartmentGroupsForDisplay();
        const apiDepartments = state.departments || [];

        const groupedDeptIds = new Set();
        departmentGroups.forEach(group => {
            (group.departments || []).forEach(dept => groupedDeptIds.add(dept.id));
        });

        const ungroupedDepts = apiDepartments.filter(d => !groupedDeptIds.has(d.id));

        let options = '<option value="">選択してください</option>';

        ungroupedDepts.forEach(dept => {
            options += `<option value="${escapeHTML(dept.id)}">${escapeHTML(dept.name)}</option>`;
        });

        departmentGroups.forEach(group => {
            if ((group.departments || []).length > 0) {
                options += `<optgroup label="${escapeHTML(group.name)}">`;
                (group.departments || []).forEach(dept => {
                    const deptId = dept.id || dept.local_id;
                    options += `<option value="${escapeHTML(deptId)}">${escapeHTML(dept.name)}</option>`;
                });
                options += '</optgroup>';
            }
        });

        select.innerHTML = options;
    },

    populateTreatmentMenuCategorySelect(select, selectedId = '') {
        if (!select) return;
        const categories = (state.beautyCategories || [])
            .filter(category => category.is_active !== false)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
        const options = [
            '<option value="">選択してください</option>',
            ...categories.map(category => `
                <option value="${escapeHTML(category.id)}" ${String(category.id) === String(selectedId) ? 'selected' : ''}>
                    ${escapeHTML(category.name)}
                </option>
            `)
        ];
        select.innerHTML = options.join('');
    },

    renderTreatmentMenuStepChecks(stepIds = []) {
        const container = document.getElementById('treatmentMenuSteps');
        if (!container) return;
        const selected = new Set(normalizeTreatmentStepIds(stepIds, []));
        const steps = (state.treatmentSteps || [])
            .filter(step => step.is_active !== false)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
        if (!steps.length) {
            container.innerHTML = '<span class="muted-cell">ステップが未設定です</span>';
            return;
        }
        container.innerHTML = steps.map(step => `
            <label class="treatment-resource-checkbox">
                <input
                    type="checkbox"
                    class="treatment-menu-step"
                    value="${escapeHTML(step.id)}"
                    ${selected.has(String(step.id)) ? 'checked' : ''}
                >
                <span>${escapeHTML(step.name)}${step.duration_minutes ? `（${Number(step.duration_minutes)}分）` : ''}</span>
            </label>
        `).join('');
    },

    readTreatmentMenuStepChecks() {
        return Array.from(document.querySelectorAll('#treatmentMenuSteps .treatment-menu-step:checked'))
            .map(input => input.value)
            .filter(Boolean);
    },

    async saveTreatmentMenuFromModal() {
        const idInput = document.getElementById('treatmentMenuId');
        const labelInput = document.getElementById('treatmentMenuLabel');
        const categorySelect = document.getElementById('treatmentMenuCategory');
        const departmentSelect = document.getElementById('treatmentMenuDepartment');
        const capacityInput = document.getElementById('treatmentMenuCapacity');
        const activeCheckbox = document.getElementById('treatmentMenuActive');
        const leadInput = document.getElementById('treatmentMenuLead');
        const tagsInput = document.getElementById('treatmentMenuTags');
        const downtimeInput = document.getElementById('treatmentMenuDowntime');
        const priceInput = document.getElementById('treatmentMenuPrice');
        const priceSubInput = document.getElementById('treatmentMenuPriceSub');
        const durationInput = document.getElementById('treatmentMenuDuration');
        const durationMinutesInput = document.getElementById('treatmentMenuDurationMinutes');
        const equipmentCodeInput = document.getElementById('treatmentMenuEquipmentCode');
        const equipmentLabelInput = document.getElementById('treatmentMenuEquipmentLabel');
        const setDurationMinutesInput = document.getElementById('treatmentMenuSetDurationMinutes');
        const staffLabelInput = document.getElementById('treatmentMenuStaffLabel');
        const recommendationInputs = Array.from(document.querySelectorAll('.treatment-recommendation-checkbox:checked'));
        const badgesInput = document.getElementById('treatmentMenuBadges');
        const confirmationNotesInput = document.getElementById('treatmentMenuConfirmationNotes');
        const imageFileInput = document.getElementById('treatmentMenuImageFile');
        const imagePreview = document.getElementById('treatmentMenuImagePreview');

        const rowKey = idInput.value;
        const label = labelInput.value.trim();

        if (!label) {
            showAlert('メニュー名を入力してください', 'error');
            return;
        }

        try {
            let imageUrl = imagePreview?.dataset.imageUrl || '';
            if (imageFileInput.files?.[0]) {
                imageUrl = await readTreatmentImageFile(imageFileInput.files[0]);
            }
            const durationMinutes = normalizeTreatmentDurationMinutes(durationMinutesInput?.value || durationInput.value);
            const durationLabel = durationInput.value.trim() || (durationMinutes ? `約${durationMinutes}分` : '');
            const staffIds = this.readTreatmentMenuStaffChecks();
            if ((state.treatmentStaff || []).some(staff => staff.is_active !== false && staff.name) && !staffIds.length) {
                showAlert('施術者を1人以上選択してください', 'error');
                return;
            }
            const resourceTypes = this.readTreatmentMenuResourceChecks('nurse');
            const roomCodes = this.readTreatmentMenuRoomChecks();
            if ((state.treatmentRooms || []).length && !roomCodes.length) {
                showAlert('部屋を1つ以上選択してください', 'error');
                return;
            }
            const equipmentRequirements = this.readTreatmentMenuEquipmentRequirements();
            const primaryEquipment = equipmentRequirements[0] || null;
            const stepIds = this.readTreatmentMenuStepChecks();

            const payload = {
                label: label,
                department_id: departmentSelect.value || null,
                beauty_category_id: categorySelect?.value || '',
                beautyCategoryId: categorySelect?.value || '',
                step_ids: stepIds,
                stepIds,
                resource_type: resourceTypes[0],
                resource_types: resourceTypes,
                staff_ids: staffIds,
                staffIds,
                menu_capacity: Number(capacityInput.value || 1),
                lead: leadInput.value.trim(),
                tags: splitTreatmentMetaList(tagsInput.value),
                downtime: downtimeInput.value.trim(),
                price: priceInput.value.trim(),
                priceSub: priceSubInput.value.trim(),
                duration: durationLabel,
                duration_minutes: durationMinutes,
                room_codes: roomCodes,
                equipment_requirements: equipmentRequirements,
                equipment_code: primaryEquipment?.resource_code || equipmentCodeInput?.value.trim() || inferTreatmentEquipmentCode({ label }, createTreatmentMenuCode(label)),
                equipment_label: primaryEquipment?.resource_label || equipmentLabelInput?.value.trim() || inferTreatmentEquipmentLabel({ label }, label),
                set_duration_minutes: normalizeTreatmentDurationMinutes(setDurationMinutesInput?.value) ||
                    getDefaultTreatmentSetDuration(primaryEquipment?.resource_code || equipmentCodeInput?.value.trim() || createTreatmentMenuCode(label)) ||
                    durationMinutes,
                staffLabel: staffLabelInput.value.trim(),
                recommended_menu_codes: recommendationInputs.map(input => input.value),
                badges: splitTreatmentMetaList(badgesInput.value),
                confirmation_notes: splitTreatmentConfirmationNotes(confirmationNotesInput?.value || ''),
                detail_menus: this.readTreatmentDetailMenuRows(),
                image_url: imageUrl,
                is_active: activeCheckbox.checked
            };

            let savedMenu = null;
            if (rowKey) {
                const menu = state.treatmentMenus.find(m => String(m.id || m.local_id) === String(rowKey));
                if (!menu) return;
                Object.assign(menu, payload, {
                    code: menu.code || createTreatmentMenuCode(label),
                    display_order: menu.display_order || 0,
                    visualTheme: menu.visualTheme || menu.visual_theme || ''
                });
                savedMenu = menu;
            } else {
                const maxOrder = state.treatmentMenus.reduce((max, m) => Math.max(max, Number(m.display_order || 0)), 0);
                savedMenu = normalizeTreatmentMenu({
                    ...payload,
                    local_id: generateLocalId('menu'),
                    code: createTreatmentMenuCode(label),
                    display_order: maxOrder + 10
                });
                state.treatmentMenus.push(savedMenu);
            }
            await this.syncTreatmentMenuToServer(savedMenu);
            saveStoredTreatmentMenus();
            this.hideTreatmentMenuModal();
            await this.loadTreatmentSettings();
            showAlert('施術メニューを保存しました', 'success');
        } catch (error) {
            showAlert('施術メニューの保存に失敗しました: ' + error.message, 'error');
        }
    },

    getTreatmentMenuRow(rowKey) {
        return Array.from(document.querySelectorAll('#treatmentMenuBody tr'))
            .find(row => row.dataset.rowKey === String(rowKey));
    },

    readTreatmentMenuRow(rowKey) {
        const row = this.getTreatmentMenuRow(rowKey);
        if (!row) return null;

        // display_orderはDOMの並び順から取得（state内で管理）
        const menu = state.treatmentMenus.find(m => String(m.id || m.local_id) === String(rowKey));
        const resourceTypes = normalizeTreatmentResourceTypes(
            row.querySelector('.treatment-menu-resource')?.value,
            menu?.resource_type || 'nurse'
        );

        return {
            label: row.querySelector('.treatment-menu-label')?.value.trim() || '',
            department_id: row.querySelector('.treatment-menu-department')?.value || null,
            resource_type: resourceTypes[0],
            resource_types: resourceTypes,
            menu_capacity: Number(row.querySelector('.treatment-menu-capacity')?.value || 1),
            display_order: menu?.display_order || 0,
            is_active: true
        };
    },

    async saveResourceCapacities() {
        state.treatmentStaff = this.readTreatmentStaffRows({ keepBlank: false });
        syncTreatmentResourceCapacitiesFromStaff();

        try {
            const result = await api.updateTreatmentStaff(state.treatmentStaff);
            if (Array.isArray(result.staff)) {
                state.treatmentStaff = result.staff.map(normalizeTreatmentStaff).filter(staff => staff.is_active !== false);
            }
            state.treatmentResourceCapacities = result.resource_capacities || state.treatmentResourceCapacities;
            saveStoredTreatmentStaff();
            saveStoredTreatmentResourceCapacities();
            this.renderTreatmentSettings();
            showAlert('スタッフを保存しました', 'success');
        } catch (error) {
            showAlert('スタッフの保存に失敗しました: ' + error.message, 'error');
        }
    },

    addTreatmentStaff() {
        state.treatmentStaff = this.readTreatmentStaffRows({ keepBlank: true });
        this.showTreatmentResourceModal('staff');
    },

    async saveTreatmentRooms() {
        state.treatmentRooms = this.readTreatmentRoomRows({ keepBlank: false });
        try {
            const result = await api.updateTreatmentRooms(state.treatmentRooms);
            if (Array.isArray(result.rooms)) {
                state.treatmentRooms = mergeDefaultTreatmentRooms(result.rooms);
            }
            saveStoredTreatmentRooms();
            this.renderTreatmentSettings();
            showAlert('部屋を保存しました', 'success');
        } catch (error) {
            showAlert('部屋の保存に失敗しました: ' + error.message, 'error');
        }
    },

    addTreatmentRoom() {
        state.treatmentRooms = this.readTreatmentRoomRows({ keepBlank: true });
        this.showTreatmentResourceModal('room');
    },

    deleteTreatmentRoom(roomId) {
        state.treatmentRooms = this.readTreatmentRoomRows({ keepBlank: true })
            .filter(room => String(room.id) !== String(roomId));
        saveStoredTreatmentRooms();
        this.renderTreatmentSettings();
    },

    async saveTreatmentEquipment() {
        state.treatmentEquipment = this.readTreatmentEquipmentRows({ keepBlank: false });
        try {
            const result = await api.updateTreatmentEquipment(state.treatmentEquipment);
            if (Array.isArray(result.equipment)) {
                state.treatmentEquipment = result.equipment.map(normalizeTreatmentEquipment).filter(item => item.is_active !== false);
            }
            saveStoredTreatmentEquipment();
            this.renderTreatmentSettings();
            showAlert('機器を保存しました', 'success');
        } catch (error) {
            showAlert('機器の保存に失敗しました: ' + error.message, 'error');
        }
    },

    addTreatmentEquipment() {
        state.treatmentEquipment = this.readTreatmentEquipmentRows({ keepBlank: true });
        this.showTreatmentResourceModal('equipment');
    },

    deleteTreatmentEquipment(equipmentId) {
        state.treatmentEquipment = this.readTreatmentEquipmentRows({ keepBlank: true })
            .filter(item => String(item.id) !== String(equipmentId));
        saveStoredTreatmentEquipment();
        this.renderTreatmentSettings();
    },

    async findServerTreatmentMenu(menu) {
        const settings = await api.getTreatmentSettings();
        const menus = Array.isArray(settings.menus) ? settings.menus : [];
        return menus.find(item =>
            (menu.id && String(item.id) === String(menu.id)) ||
            (menu.code && item.code === menu.code) ||
            (menu.label && item.label === menu.label)
        ) || null;
    },

    async syncTreatmentMenuToServer(menu) {
        if (!menu?.label) return null;
        const payload = buildTreatmentMenuApiPayload(menu);
        const existing = await this.findServerTreatmentMenu(menu);
        const saved = existing?.id
            ? await api.updateTreatmentMenu(existing.id, payload)
            : await api.createTreatmentMenu(payload);

        Object.assign(menu, normalizeTreatmentMenu({
            ...menu,
            ...saved,
            local_id: menu.local_id
        }));
        return saved;
    },

    async syncTreatmentMenusToServer(menus = state.treatmentMenus) {
        for (const menu of menus.filter(item => item?.label)) {
            await this.syncTreatmentMenuToServer(menu);
        }
    },

    async saveTreatmentMenu(rowKey) {
        const payload = this.readTreatmentMenuRow(rowKey);
        if (!payload) return;

        if (!payload.label) {
            showAlert('メニュー名を入力してください', 'error');
            return;
        }

        const menu = state.treatmentMenus.find(item => String(item.id || item.local_id) === String(rowKey));
        try {
            let savedMenu = menu;
            if (menu) {
                Object.assign(menu, payload, {
                    code: menu.code || createTreatmentMenuCode(payload.label)
                });
            } else {
                savedMenu = normalizeTreatmentMenu({
                    ...payload,
                    local_id: generateLocalId('menu'),
                    code: createTreatmentMenuCode(payload.label),
                    display_order: (state.treatmentMenus.length + 1) * 10
                });
                state.treatmentMenus.push(savedMenu);
            }
            await this.syncTreatmentMenuToServer(savedMenu);
            saveStoredTreatmentMenus();
            await this.loadTreatmentSettings();
            showAlert('施術メニューを保存しました', 'success');
        } catch (error) {
            showAlert('施術メニューの保存に失敗しました: ' + error.message, 'error');
        }
    },

    async deleteTreatmentMenu(rowKey) {
        const menu = state.treatmentMenus.find(item => String(item.id || item.local_id) === String(rowKey));
        if (!menu) return;

        if (!confirm('この施術メニューを患者予約画面で非表示にしますか？')) return;
        try {
            const serverMenu = await this.findServerTreatmentMenu(menu).catch(() => null);
            if (serverMenu?.id) {
                await api.deleteTreatmentMenu(serverMenu.id);
            }
            state.treatmentMenus = state.treatmentMenus.filter(item => String(item.id || item.local_id) !== String(rowKey));
            saveStoredTreatmentMenus();
            await this.loadTreatmentSettings();
            showAlert('施術メニューを非表示にしました', 'success');
        } catch (error) {
            showAlert('施術メニューの非表示に失敗しました: ' + error.message, 'error');
        }
    },

    deleteTreatmentStaff(staffId) {
        state.treatmentStaff = this.readTreatmentStaffRows({ keepBlank: true })
            .filter(staff => String(staff.id) !== String(staffId));
        saveStoredTreatmentStaff();
        ui.renderTreatmentSettings();
    },

    async saveTreatmentMenusAll() {
        const tbody = document.getElementById('treatmentMenuBody');
        if (!tbody) return;

        // DOMの並び順からstateを更新
        this.updateTreatmentMenuOrder();

        // 各行のデータを読み取ってstateを更新
        const rows = tbody.querySelectorAll('tr[data-row-key]');
        rows.forEach((row) => {
            const rowKey = row.dataset.rowKey;
            const menu = state.treatmentMenus.find(m => String(m.id || m.local_id) === String(rowKey));
            if (menu) {
                menu.label = row.querySelector('.treatment-menu-label')?.value.trim() || '';
                menu.department_id = row.querySelector('.treatment-menu-department')?.value || null;
                const resourceTypes = normalizeTreatmentResourceTypes(
                    row.querySelector('.treatment-menu-resource')?.value,
                    menu.resource_type || 'nurse'
                );
                menu.resource_type = resourceTypes[0];
                menu.resource_types = resourceTypes;
                menu.resourceTypes = resourceTypes;
                menu.menu_capacity = Number(row.querySelector('.treatment-menu-capacity')?.value || 1);
                const activeInput = row.querySelector('.treatment-menu-active');
                menu.is_active = activeInput ? activeInput.checked : menu.is_active !== false;
            }
        });

        try {
            state.treatmentMenus = state.treatmentMenus
                .filter(menu => menu.label)
                .map((menu, index) => normalizeTreatmentMenu({
                    ...menu,
                    code: menu.code || createTreatmentMenuCode(menu.label),
                    display_order: menu.display_order || (index + 1) * 10
                }));
            await this.syncTreatmentMenusToServer(state.treatmentMenus);
            saveStoredTreatmentMenus();
            await this.loadTreatmentSettings();
            showAlert('施術メニューを一括保存しました', 'success');
        } catch (error) {
            showAlert('一括保存に失敗しました: ' + error.message, 'error');
        }
    },

    // 予約一覧
    async loadReservations() {
        await this.ensureReservationResourceSettings();
        const range = this.syncReservationRangeInputs();
        const dateFrom = range.dateFrom;
        const dateTo = range.dateTo;
        const status = document.getElementById('filterStatus').value;
        const currentClinic = getCurrentClinic();

        const params = { limit: 200 };
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        if (currentClinic) {
            params.clinic_id = currentClinic.id;
            params.clinic_name = currentClinic.name;
        }
        if (status) params.status = status;
        const localReservations = loadLocalReservationsForCurrentClinic(params);

        try {
            // キャンセル済み予約を除外して表示
            let apiReservations = await api.getReservations(params);
            if (currentClinic && apiReservations.length === 0) {
                const broadParams = { ...params };
                delete broadParams.clinic_id;
                delete broadParams.clinic_name;
                apiReservations = (await api.getReservations(broadParams))
                    .filter(reservationBelongsToCurrentClinic);
            }
            const reservations = this.sortReservations(mergeReservationSources(apiReservations, localReservations, { includeLocalOnly: false }))
                .filter(reservationBelongsToCurrentClinic)
                .filter(r => r.status !== 'cancelled');
            upsertPatientReservationCache(reservations);
            state.reservations = reservations;
            this.renderReservationTable('reservationList', reservations, false);
            this.renderReservationViews(reservations);
        } catch (error) {
            console.error('Reservations load error:', error);
            state.reservations = this.sortReservations(localReservations);
            this.renderReservationTable('reservationList', state.reservations, false);
            this.renderReservationViews(state.reservations);
        }
    },

    async ensureReservationResourceSettings() {
        loadStoredTreatmentResourceCapacities();
        loadStoredTreatmentStaff();
        const storedMenus = loadStoredTreatmentMenus();
        if (storedMenus.length > 0) return;

        if ((state.treatmentMenus || []).length > 0 && state.treatmentResourceCapacities) return;
        try {
            const settings = await api.getTreatmentSettings();
            state.treatmentMenus = settings.menus || settings.treatment_menus || [];
            state.treatmentResourceCapacities = settings.resource_capacities || state.treatmentResourceCapacities || { doctor: 1, nurse: 2 };
        } catch (error) {
            console.warn('Reservation resource settings load skipped:', error);
        }
    },

    syncReservationRangeInputs() {
        const fromInput = document.getElementById('filterDateFrom');
        const toInput = document.getElementById('filterDateTo');
        const anchor = utils.parseDate(fromInput?.value || new Date());
        let from = anchor;
        let to = anchor;

        if (state.reservationRangeMode === 'week') {
            from = utils.startOfWeek(anchor);
            to = utils.endOfWeek(anchor);
        } else if (state.reservationRangeMode === 'month') {
            from = utils.startOfMonth(anchor);
            to = utils.endOfMonth(anchor);
        }

        const dateFrom = utils.formatDate(from);
        const dateTo = utils.formatDate(to);
        if (fromInput) fromInput.value = dateFrom;
        if (toInput) toInput.value = dateTo;
        this.updateReservationViewControls();
        this.updateReservationRangeCaption(dateFrom, dateTo);
        return { dateFrom, dateTo };
    },

    updateReservationViewControls() {
        document.querySelectorAll('[data-reservation-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.reservationView === state.reservationViewMode);
        });
        document.querySelectorAll('[data-reservation-range]').forEach(button => {
            button.classList.toggle('active', button.dataset.reservationRange === state.reservationRangeMode);
        });
        document.querySelectorAll('[data-reservation-resource-axis]').forEach(button => {
            button.classList.toggle('active', button.dataset.reservationResourceAxis === state.reservationResourceAxis);
        });
        document.getElementById('reservationResourceAxisGroup')?.classList.toggle('hidden', state.reservationViewMode !== 'resource');
    },

    updateReservationRangeCaption(dateFrom, dateTo) {
        const caption = document.getElementById('reservationRangeCaption');
        if (!caption) return;
        const labelMap = { day: '日表示', week: '週表示', month: '月表示' };
        const rangeText = dateFrom === dateTo
            ? utils.formatDateLabel(dateFrom)
            : `${utils.formatDateLabel(dateFrom)} 〜 ${utils.formatDateLabel(dateTo)}`;
        caption.textContent = `${labelMap[state.reservationRangeMode] || ''} / ${rangeText}`;
    },

    setReservationViewMode(mode) {
        state.reservationViewMode = mode;
        if (mode === 'resource' && state.reservationRangeMode !== 'day') {
            state.reservationRangeMode = 'day';
            this.loadReservations();
            return;
        }
        this.updateReservationViewControls();
        this.renderReservationViews(state.reservations || []);
    },

    setReservationRangeMode(mode) {
        state.reservationRangeMode = mode;
        if (state.reservationViewMode === 'resource' && mode !== 'day') {
            state.reservationViewMode = 'timeline';
        }
        this.loadReservations();
    },

    setReservationResourceAxis(axis) {
        state.reservationResourceAxis = axis;
        this.updateReservationViewControls();
        this.renderReservationResourceView(state.reservations || []);
    },

    sortReservations(reservations) {
        return [...(reservations || [])].sort((a, b) => {
            const aKey = `${a.reservation_date || ''} ${a.start_time || ''}`;
            const bKey = `${b.reservation_date || ''} ${b.start_time || ''}`;
            return aKey.localeCompare(bKey);
        });
    },

    getReservationDateList() {
        const from = document.getElementById('filterDateFrom')?.value || utils.formatDate(new Date());
        const to = document.getElementById('filterDateTo')?.value || from;
        return utils.eachDate(from, to);
    },

    groupReservationsByDate(reservations) {
        return (reservations || []).reduce((groups, reservation) => {
            const date = reservation.reservation_date || '';
            if (!date) return groups;
            groups[date] = groups[date] || [];
            groups[date].push(reservation);
            return groups;
        }, {});
    },

    reservationTimeText(reservation) {
        const start = (reservation.start_time || '').slice(0, 5);
        const end = (reservation.end_time || '').slice(0, 5);
        return end ? `${start}-${end}` : start;
    },

    reservationTreatmentText(reservation) {
        const main = reservation.treatment_menu_label || reservation.treatment_menu || '';
        const detail = reservation.treatment_detail_menu_label || reservation.treatment_detail_label || '';
        return [main, detail].filter(Boolean).join(' / ') || '施術未指定';
    },

    reservationDepartmentText(reservation) {
        return reservation.department_name || '-';
    },

    reservationClinicText(reservation) {
        const clinic = state.clinics.find(item => item.id === reservation.clinic_id);
        return reservation.clinic_name || clinic?.name || '';
    },

    renderReservationViews(reservations) {
        const timeline = document.getElementById('reservationTimelineView');
        const calendar = document.getElementById('reservationCalendarView');
        const resource = document.getElementById('reservationResourceView');
        if (!timeline || !calendar || !resource) return;

        timeline.classList.toggle('hidden', state.reservationViewMode !== 'timeline');
        calendar.classList.toggle('hidden', state.reservationViewMode !== 'calendar');
        resource.classList.toggle('hidden', state.reservationViewMode !== 'resource');

        this.renderReservationTimeline(reservations);
        this.renderReservationCalendar(reservations);
        this.renderReservationResourceView(reservations);
    },

    renderReservationTimeline(reservations) {
        const container = document.getElementById('reservationTimelineView');
        if (!container) return;

        const grouped = this.groupReservationsByDate(reservations);
        const dates = this.getReservationDateList();
        const visibleDates = state.reservationRangeMode === 'month'
            ? dates.filter(date => (grouped[date] || []).length > 0)
            : dates;

        if (!visibleDates.length) {
            container.innerHTML = '<div class="reservation-empty-state">この期間の予約はありません</div>';
            return;
        }

        container.innerHTML = `
            <div class="reservation-timeline">
                ${visibleDates.map(date => {
                    const items = grouped[date] || [];
                    return `
                        <section class="reservation-day-section">
                            <div class="reservation-day-heading">
                                <span>${utils.formatDateLabel(date)}</span>
                                <span>${items.length}件</span>
                            </div>
                            ${items.length ? `
                                <div class="reservation-timeline-list">
                                    ${items.map(reservation => this.renderReservationTimelineItem(reservation)).join('')}
                                </div>
                            ` : '<div class="reservation-empty-day">予約はありません</div>'}
                        </section>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderReservationTimelineItem(reservation) {
        return `
            <article class="reservation-timeline-item status-${escapeHTML(reservation.status)}" data-reservation-id="${escapeHTML(reservation.id)}" data-reservation-number="${escapeHTML(reservation.reservation_number || '')}">
                <div class="reservation-time-node">
                    <span>${escapeHTML(this.reservationTimeText(reservation))}</span>
                </div>
                <div class="reservation-timeline-dot"></div>
                <div class="reservation-timeline-card">
                    <div class="reservation-card-top">
                        <div>
                            <div class="reservation-department-label">${escapeHTML(this.reservationDepartmentText(reservation))}</div>
                            <div class="reservation-treatment">${escapeHTML(this.reservationTreatmentText(reservation))}</div>
                            <div class="reservation-patient">${escapeHTML(reservation.patient_name || '')}</div>
                        </div>
                        <span class="status status-${escapeHTML(reservation.status)}">${utils.statusText(reservation.status)}</span>
                    </div>
                    <div class="reservation-card-meta">
                        ${this.reservationClinicText(reservation) ? `<span>${escapeHTML(this.reservationClinicText(reservation))}</span>` : ''}
                        <span>${escapeHTML(reservation.patient_phone || '')}</span>
                    </div>
                    <div class="reservation-card-footer">
                        ${this.renderReservationSyncCell(reservation)}
                        ${this.renderReservationActions(reservation)}
                    </div>
                </div>
            </article>
        `;
    },

    renderReservationCalendar(reservations) {
        const container = document.getElementById('reservationCalendarView');
        if (!container) return;

        const grouped = this.groupReservationsByDate(reservations);
        let dates = this.getReservationDateList();
        if (state.reservationRangeMode === 'month' && dates.length) {
            const monthStart = utils.parseDate(dates[0]);
            const monthEnd = utils.parseDate(dates[dates.length - 1]);
            dates = utils.eachDate(utils.startOfWeek(monthStart), utils.endOfWeek(monthEnd));
        }
        const activeMonth = dates.length ? utils.parseDate(document.getElementById('filterDateFrom')?.value || dates[0]).getMonth() : null;

        container.innerHTML = `
            <div class="reservation-calendar-shell">
                <div class="reservation-calendar-grid reservation-calendar-range-${escapeHTML(state.reservationRangeMode)}">
                    ${dates.map(date => this.renderReservationCalendarDay(date, grouped[date] || [], activeMonth)).join('')}
                </div>
            </div>
        `;
    },

    renderReservationCalendarDay(date, reservations, activeMonth) {
        const dateObj = utils.parseDate(date);
        const outsideMonth = state.reservationRangeMode === 'month' && dateObj.getMonth() !== activeMonth;
        return `
            <section class="reservation-calendar-day ${outsideMonth ? 'outside-month' : ''}">
                <div class="reservation-calendar-day-head">
                    <span>${utils.formatDisplayDate(date)}</span>
                    <span>${reservations.length}件</span>
                </div>
                <div class="reservation-calendar-events">
                    ${reservations.length
                        ? reservations.map(reservation => this.renderReservationCalendarEvent(reservation)).join('')
                        : '<div class="reservation-calendar-empty">予約なし</div>'
                    }
                </div>
            </section>
        `;
    },

    renderReservationCalendarEvent(reservation) {
        return `
            <div class="reservation-calendar-event status-${escapeHTML(reservation.status)}" data-reservation-id="${escapeHTML(reservation.id)}" data-reservation-number="${escapeHTML(reservation.reservation_number || '')}">
                <span class="reservation-event-time">${escapeHTML((reservation.start_time || '').slice(0, 5))}</span>
                <span class="reservation-event-menu">${escapeHTML(this.reservationTreatmentText(reservation))}</span>
                <span class="reservation-event-patient">${escapeHTML(reservation.patient_name || '')}</span>
            </div>
        `;
    },

    timeStringToMinutes(timeValue, fallback = 0) {
        const [hour, minute] = String(timeValue || '').split(':').map(Number);
        if (!Number.isFinite(hour)) return fallback;
        return hour * 60 + (Number.isFinite(minute) ? minute : 0);
    },

    formatMinutesLabel(minutes) {
        const safeMinutes = Math.max(0, Math.min(24 * 60, minutes));
        const hour = Math.floor(safeMinutes / 60);
        const minute = safeMinutes % 60;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    },

    getResourceTimelineBounds(reservations) {
        const starts = reservations.map(r => this.timeStringToMinutes(r.start_time, 9 * 60));
        const ends = reservations.map(r => this.timeStringToMinutes(r.end_time, this.timeStringToMinutes(r.start_time, 9 * 60) + 15));
        const first = starts.length ? Math.min(...starts, 9 * 60) : 9 * 60;
        const last = ends.length ? Math.max(...ends, 18 * 60) : 18 * 60;
        const start = Math.max(0, Math.floor((first - 30) / 60) * 60);
        const end = Math.min(24 * 60, Math.ceil((last + 30) / 60) * 60);
        return {
            start,
            end: Math.max(end, start + 120)
        };
    },

    getResourceTimelineTicks(start, end) {
        const ticks = [];
        for (let minutes = start; minutes <= end; minutes += 60) {
            ticks.push(minutes);
        }
        return ticks;
    },

    getReservationMenuDefinition(reservation) {
        const code = reservation.treatment_menu;
        const label = reservation.treatment_menu_label;
        return (state.treatmentMenus || []).find(menu => {
            return (code && menu.code === code) || (label && menu.label === label);
        }) || null;
    },

    inferReservationResourceType(reservation) {
        const reservationResourceType = normalizeTreatmentResourceType(reservation.treatment_resource_type, '');
        if (reservationResourceType) {
            return reservationResourceType;
        }
        const menu = this.getReservationMenuDefinition(reservation);
        const menuResourceTypes = normalizeTreatmentResourceTypes(menu?.resource_types || menu?.resourceTypes, menu?.resource_type || 'nurse');
        if (menuResourceTypes.length) return menuResourceTypes[0];
        const treatmentText = this.reservationTreatmentText(reservation);
        return /ボトックス|ジュベルック|プルリアル|プロファイロ|医師カウンセリング/i.test(treatmentText) ? 'doctor' : 'nurse';
    },

    getReservationResourceColumns(axis) {
        if (axis === 'staff') {
            if (!state.treatmentStaff.length) {
                loadStoredTreatmentStaff();
            }
            const staffColumns = (state.treatmentStaff || [])
                .filter(staff => staff.is_active !== false && staff.name)
                .sort((a, b) => {
                    const roleOrder = { doctor: 1, nurse: 2, clerk: 3 };
                    if (a.role !== b.role) return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
                    return Number(a.display_order || 0) - Number(b.display_order || 0);
                })
                .map(staff => ({
                    id: `staff-${staff.id}`,
                    staffId: staff.id,
                    resourceType: staff.role,
                    label: staff.name,
                    groupLabel: getTreatmentResourceLabel(staff.role)
                }));

            if (staffColumns.length) return staffColumns;

            if (hasStoredTreatmentStaff()) {
                return [{ id: 'staff-unassigned', resourceType: 'nurse', label: '未割当', groupLabel: 'スタッフ未登録' }];
            }

            return makeDefaultTreatmentStaff().map(staff => ({
                id: `staff-${staff.id}`,
                staffId: staff.id,
                resourceType: staff.role,
                label: staff.name,
                groupLabel: getTreatmentResourceLabel(staff.role)
            }));
        }
        if (axis === 'room') {
            return [
                { id: 'room-consultation', label: '01.診察室' },
                { id: 'room-treatment-1', label: '02.処置室①' },
                { id: 'room-treatment-2', label: '03.処置室②' },
                { id: 'room-doctor', label: '04.医師施術室' }
            ];
        }

        const menuColumns = (state.treatmentMenus || [])
            .filter(menu => menu.is_active !== false)
            .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
            .map(menu => ({ id: `menu-${menu.code}`, label: menu.label || menu.code }));
        return menuColumns.length
            ? [...menuColumns, { id: 'menu-unspecified', label: '施術未指定' }]
            : [
                { id: 'menu-lala-doctor', label: 'ララドクター' },
                { id: 'menu-botox', label: 'ボトックス' },
                { id: 'menu-juvelook', label: 'ジュベルック' },
                { id: 'menu-potenza', label: 'ポテンツァ' },
                { id: 'menu-density', label: 'DENSITY' },
                { id: 'menu-ipl', label: 'IPL光治療' },
                { id: 'menu-electroporation', label: 'エレクトロポレーション' },
                { id: 'menu-nurse-counseling', label: '看護師カウンセリング' },
                { id: 'menu-doctor-counseling', label: '医師カウンセリング' },
                { id: 'menu-unspecified', label: '施術未指定' }
            ];
    },

    getReservationResourceColumnId(reservation, axis, index, columns) {
        const resourceType = this.inferReservationResourceType(reservation);
        if (axis === 'staff') {
            const typedColumns = columns.filter(column => column.resourceType === resourceType || column.id.startsWith(resourceType));
            return typedColumns[index % Math.max(1, typedColumns.length)]?.id || columns[0]?.id;
        }
        if (axis === 'room') {
            if (resourceType === 'doctor') return 'room-doctor';
            const treatmentRooms = columns.filter(column => column.id.startsWith('room-treatment'));
            return treatmentRooms[index % Math.max(1, treatmentRooms.length)]?.id || 'room-consultation';
        }
        const menuColumnId = reservation.treatment_menu ? `menu-${reservation.treatment_menu}` : 'menu-unspecified';
        return columns.some(column => column.id === menuColumnId) ? menuColumnId : 'menu-unspecified';
    },

    renderReservationResourceView(reservations) {
        const container = document.getElementById('reservationResourceView');
        if (!container) return;

        const date = document.getElementById('filterDateFrom')?.value || utils.formatDate(new Date());
        const dayReservations = this.sortReservations((reservations || []).filter(r => r.reservation_date === date));
        const columns = this.getReservationResourceColumns(state.reservationResourceAxis);
        const bounds = this.getResourceTimelineBounds(dayReservations);
        const ticks = this.getResourceTimelineTicks(bounds.start, bounds.end);
        const pxPerMinute = 1.45;
        const totalMinutes = bounds.end - bounds.start;
        const eventsByColumn = columns.reduce((map, column) => {
            map[column.id] = [];
            return map;
        }, {});

        dayReservations.forEach((reservation, index) => {
            const columnId = this.getReservationResourceColumnId(reservation, state.reservationResourceAxis, index, columns);
            if (eventsByColumn[columnId]) {
                eventsByColumn[columnId].push(reservation);
            }
        });

        container.innerHTML = `
            <div class="reservation-resource-shell">
                <div class="reservation-resource-head" style="grid-template-columns: 62px repeat(${columns.length}, minmax(170px, 1fr));">
                    <div class="reservation-resource-corner">${escapeHTML(utils.formatDisplayDate(date))}</div>
                    ${columns.map(column => `
                        <div class="reservation-resource-heading">
                            <span>${escapeHTML(column.label)}</span>
                            ${column.groupLabel ? `<small>${escapeHTML(column.groupLabel)}</small>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="reservation-resource-body" style="--resource-total-minutes: ${totalMinutes}; --resource-px-per-minute: ${pxPerMinute}px; --resource-quarter-height: ${15 * pxPerMinute}px; --resource-hour-height: ${60 * pxPerMinute}px; grid-template-columns: 62px repeat(${columns.length}, minmax(170px, 1fr));">
                    <div class="reservation-resource-time-rail">
                        ${ticks.map(minutes => `
                            <span style="top: ${(minutes - bounds.start) * pxPerMinute}px;">${escapeHTML(this.formatMinutesLabel(minutes))}</span>
                        `).join('')}
                    </div>
                    ${columns.map(column => `
                        <div class="reservation-resource-column">
                            ${this.renderResourceCurrentTimeLine(date, bounds, pxPerMinute)}
                            ${(eventsByColumn[column.id] || []).map(reservation => this.renderReservationResourceEvent(reservation, bounds, pxPerMinute)).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    renderResourceCurrentTimeLine(date, bounds, pxPerMinute) {
        const now = new Date();
        if (utils.formatDate(now) !== date) return '';
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (currentMinutes < bounds.start || currentMinutes > bounds.end) return '';
        return `<div class="reservation-resource-now-line" style="top: ${(currentMinutes - bounds.start) * pxPerMinute}px;"></div>`;
    },

    renderReservationResourceEvent(reservation, bounds, pxPerMinute) {
        const start = this.timeStringToMinutes(reservation.start_time, bounds.start);
        const end = Math.max(this.timeStringToMinutes(reservation.end_time, start + 15), start + 15);
        const top = Math.max(0, (start - bounds.start) * pxPerMinute);
        const height = Math.max(28, (end - start) * pxPerMinute - 2);
        return `
            <article class="reservation-resource-event status-${escapeHTML(reservation.status)}" style="top: ${top}px; height: ${height}px;" data-reservation-id="${escapeHTML(reservation.id)}" data-reservation-number="${escapeHTML(reservation.reservation_number || '')}">
                <div class="reservation-resource-event-title">${escapeHTML(reservation.patient_name || '')} ${escapeHTML(this.reservationTreatmentText(reservation))}</div>
                <div class="reservation-resource-event-time">${escapeHTML(this.reservationTimeText(reservation))}</div>
            </article>
        `;
    },

    renderReservationActions(reservation) {
        const actions = [];
        if (reservation.local_only) {
            actions.push(`<button class="btn btn-sm btn-danger" onclick="handlers.deleteLocalReservation('${escapeHTML(reservation.reservation_number || '')}')">削除</button>`);
            return actions.length ? `<div class="action-buttons">${actions.join('')}</div>` : '';
        }
        if (reservation.status === 'confirmed') {
            actions.push(`<button class="btn btn-sm btn-danger" onclick="handlers.cancel('${escapeHTML(reservation.id)}')">削除</button>`);
        }
        if (reservation.status === 'checked_in') {
            actions.push(`<button class="btn btn-sm" onclick="handlers.complete('${escapeHTML(reservation.id)}')">完了</button>`);
        }
        return actions.length ? `<div class="action-buttons">${actions.join('')}</div>` : '';
    },

    renderReservationTable(tableId, reservations, showTimeOnly = false) {
        const tbody = document.querySelector(`#${tableId} tbody`);

        if (reservations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--gray-500);">予約がありません</td></tr>';
            return;
        }

        tbody.innerHTML = reservations.map(r => `
            <tr data-reservation-id="${escapeHTML(r.id)}" data-reservation-number="${escapeHTML(r.reservation_number || '')}">
                <td>${showTimeOnly ? r.start_time.slice(0, 5) : `${utils.formatDisplayDate(r.reservation_date)} ${r.start_time.slice(0, 5)}`}</td>
                <td>
                    ${this.reservationClinicText(r) ? `<div class="reservation-table-clinic">${escapeHTML(this.reservationClinicText(r))}</div>` : ''}
                    ${escapeHTML(r.department_name)}
                </td>
                <td>${escapeHTML(this.reservationTreatmentText(r))}</td>
                <td>${escapeHTML(r.patient_name)}</td>
                <td>${escapeHTML(r.patient_phone)}</td>
                <td>${this.renderReservationSyncCell(r)}</td>
                <td><span class="status status-${r.status}">${utils.statusText(r.status)}</span></td>
                <td>${this.renderReservationActions(r)}</td>
            </tr>
        `).join('');
    },

    renderReservationSyncCell(reservation) {
        const questionnaireButton = reservation.questionnaire_response_id
            ? `<button class="sync-pill done" onclick="handlers.showReservationQuestionnaire('${reservation.id}')">問診</button>`
            : '<span class="sync-pill">問診未</span>';
        const insuranceButton = reservation.insurance_card_status
            ? `<button class="sync-pill done" onclick="handlers.showReservationAttachment('${reservation.id}', 'insurance_card', '保険証')">保険証</button>`
            : '<span class="sync-pill">保険証未</span>';
        const medicalButton = reservation.medical_certificate_status
            ? `<button class="sync-pill done" onclick="handlers.showReservationAttachment('${reservation.id}', 'medical_certificate', '医療証')">医療証</button>`
            : '<span class="sync-pill">医療証未</span>';
        return `<div class="sync-pill-list">${questionnaireButton}${insuranceButton}${medicalButton}</div>`;
    },

    // 診療科
    async loadDepartments() {
        loadStoredDepartmentGroups();
        if (state.departmentGroups.length) {
            state.departments = [];
            this.renderDepartmentTable();
            return;
        }

        try {
            // 非アクティブな診療科を除外して表示
            const allDepartments = await api.getDepartments();
            state.departments = allDepartments.filter(d => d.is_active !== false);
            this.renderDepartmentTable();
        } catch (error) {
            console.error('Departments load error:', error);
            // デモデータ
            state.departments = [
                { id: '1', name: '内科', description: '一般内科', default_duration: 15, is_visible: true, sort_order: 1 },
                { id: '2', name: '皮膚科', description: '皮膚疾患', default_duration: 15, is_visible: true, sort_order: 2 }
            ];
            this.renderDepartmentTable();
        }
    },

    renderDepartmentTable() {
        const tbody = document.getElementById('departmentListBody');
        if (!tbody) return;

        const storedGroups = loadStoredDepartmentGroups();
        const apiDepartments = state.departments || [];

        const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;

        // グループに属している診療科IDを収集
        const groupedDeptIds = new Set();
        storedGroups.forEach(group => {
            (group.departments || []).forEach(dept => groupedDeptIds.add(dept.id));
        });

        // グループに属さない診療科（フラット表示用）
        const ungroupedDepts = apiDepartments.filter(d => !groupedDeptIds.has(d.id));

        let html = '';

        // 診療科の行を生成するヘルパー関数
        const renderDeptRow = (dept, groupId = '') => `
            <tr class="dept-row ${groupId ? 'dept-row-child' : 'dept-row-flat'}" data-dept-id="${dept.id}" ${groupId ? `data-group-id="${groupId}"` : ''}>
                <td>
                    <div class="dept-name-cell">
                        <span class="dept-drag-handle">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="9" cy="6" r="2"></circle>
                                <circle cx="15" cy="6" r="2"></circle>
                                <circle cx="9" cy="12" r="2"></circle>
                                <circle cx="15" cy="12" r="2"></circle>
                                <circle cx="9" cy="18" r="2"></circle>
                                <circle cx="15" cy="18" r="2"></circle>
                            </svg>
                        </span>
                        <span class="dept-name">${dept.name}</span>
                        ${dept.isLocked ? '<span class="dept-lock-icon"><i class="fas fa-lock"></i></span>' : ''}
                    </div>
                </td>
                <td><span class="dept-calendar-name">${dept.firstVisit || '<span class="dept-none">-</span>'}</span></td>
                <td><span class="dept-calendar-name">${dept.revisit || '<span class="dept-none">-</span>'}</span></td>
                <td><span class="dept-calendar-name">${dept.calendarName || '<span class="dept-none">-</span>'}</span></td>
                <td><button class="dept-copy-btn" onclick="handlers.copyDepartmentUrl('questionnaire', '${dept.id}')" title="問診URLをコピー">${copyIcon}</button></td>
                <td><button class="dept-copy-btn" onclick="handlers.copyDepartmentUrl('reservation', '${dept.id}')" title="予約URLをコピー">${copyIcon}</button></td>
                <td><button class="dept-copy-btn" onclick="handlers.copyDepartmentUrl('html', '${dept.id}')" title="予約HTMLをコピー">${copyIcon}</button></td>
                <td>
                    <div class="dept-actions admin-action-pair">
                        <button class="admin-action-edit" type="button" onclick="handlers.editDepartment('${dept.id}')">編集</button>
                        <button class="admin-action-delete" type="button" onclick="handlers.deleteDepartment('${dept.id}')">削除</button>
                    </div>
                </td>
            </tr>
        `;

        // 1. グループに属さない診療科をフラット表示
        ungroupedDepts.forEach(dept => {
            html += renderDeptRow(dept);
        });

        // 2. グループとその中の診療科を表示
        storedGroups.forEach(group => {
            // グループヘッダー行
            html += `
                <tr class="dept-row dept-row-group" data-group-id="${group.id}">
                    <td>
                        <div class="dept-name-cell">
                            <span class="dept-drag-handle">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="9" cy="6" r="2"></circle>
                                    <circle cx="15" cy="6" r="2"></circle>
                                    <circle cx="9" cy="12" r="2"></circle>
                                    <circle cx="15" cy="12" r="2"></circle>
                                    <circle cx="9" cy="18" r="2"></circle>
                                    <circle cx="15" cy="18" r="2"></circle>
                                </svg>
                            </span>
                            <span class="dept-group-icon">
                                <i class="fas fa-folder${group.collapsed ? '' : '-open'}"></i>
                            </span>
                            <span class="dept-name" style="color: #334155;">${group.name}</span>
                        </div>
                    </td>
                    <td colspan="6"></td>
                    <td>
                        <div class="dept-actions admin-action-pair">
                            <button class="admin-action-edit" type="button" onclick="handlers.editDepartmentGroup('${group.id}')">編集</button>
                            <button class="admin-action-delete" type="button" onclick="handlers.deleteDepartmentGroup('${group.id}')">削除</button>
                        </div>
                    </td>
                </tr>
            `;

            // 子診療科の行
            if (!group.collapsed) {
                (group.departments || []).forEach(dept => {
                    html += renderDeptRow(dept, group.id);
                });
            }
        });

        tbody.innerHTML = html;
    },

    // 予約枠設定
    async loadSchedules() {
        try {
            const allDepts = await api.getDepartments();
            state.departments = (allDepts || []).filter(d => d.is_active !== false);
            state.templates = await api.getTemplates();
        } catch (error) {
            console.error('Schedules load error:', error);
            state.templates = [];
        }

        this.renderTemplateGrid();
        this.populateDepartmentSelects();
    },

    renderTemplateGrid() {
        const grid = document.getElementById('templateGrid');

        if (state.templates.length === 0) {
            grid.innerHTML = '<p style="color: var(--gray-500);">テンプレートがありません。追加してください。</p>';
            return;
        }

        grid.innerHTML = state.templates.map(t => {
            const dept = state.departments.find(d => d.id === t.department_id);
            return `
                <div class="template-card">
                    <div class="template-card-header">
                        <span class="template-dept">${dept?.name || '不明'}</span>
                        <span class="template-day">${utils.dayOfWeekName(t.day_of_week)}曜</span>
                    </div>
                    <div class="template-time">${t.start_time.slice(0, 5)} - ${t.end_time.slice(0, 5)}</div>
                    <div class="template-info">
                        ${t.slot_duration}分枠 / 同時${t.max_bookings}名
                    </div>
                    <div class="template-actions">
                        <button class="admin-action-delete" type="button" onclick="handlers.deleteTemplate('${t.id}')">削除</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    populateDepartmentSelects() {
        const selects = [
            'tmplDepartment', 'genDepartment', 'closureDepartment'
        ];

        const options = state.departments.map(d =>
            `<option value="${d.id}">${d.name}</option>`
        ).join('');

        selects.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = options;
        });
    },

    // 診療科ドロワー
    async showDepartmentDrawer(department = null) {
        const drawer = document.getElementById('departmentDrawer');
        const overlay = document.getElementById('departmentDrawerOverlay');
        const title = document.getElementById('departmentDrawerTitle');

        // 問診票データを取得（まだ読み込まれていない場合、非アクティブを除外）
        if (!state.questionnaires || state.questionnaires.length === 0) {
            try {
                const data = await api.getQuestionnaires();
                const allQuestionnaires = normalizeQuestionnaireList(data);
                state.questionnaires = allQuestionnaires.filter(q => q.is_active !== false);
            } catch (error) {
                console.error('問診票の読み込みに失敗:', error);
            }
        }

        // 選択肢を設定
        this.populateDepartmentGroupSelect();
        this.populateDepartmentDrawerSelects();

        if (department) {
            title.textContent = '診療科編集';
            document.getElementById('deptId').value = department.id;
            document.getElementById('deptName').value = department.name || '';
            document.getElementById('deptGroup').value = department.groupId || '';
            document.getElementById('deptDigitalName').value = department.digitalName || '';
            // 他のフィールドも必要に応じて設定
        } else {
            title.textContent = '診療科新規作成';
            document.getElementById('departmentForm').reset();
            document.getElementById('deptId').value = '';
        }

        overlay.classList.remove('hidden');
        drawer.classList.remove('hidden');
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            drawer.classList.add('active');
        });
    },

    hideDepartmentDrawer() {
        const drawer = document.getElementById('departmentDrawer');
        const overlay = document.getElementById('departmentDrawerOverlay');

        drawer.classList.remove('active');
        overlay.classList.remove('active');
        setTimeout(() => {
            drawer.classList.add('hidden');
            overlay.classList.add('hidden');
        }, 300);
    },

    populateDepartmentGroupSelect() {
        const select = document.getElementById('deptGroup');
        if (!select) return;

        const groups = getDepartmentGroupsForDisplay();
        select.innerHTML = '<option value="">選択してください</option>' +
            groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    },

    populateDepartmentDrawerSelects() {
        // 問診票の選択肢を設定（APIから取得した問診票を使用）
        const questionnaires = state.questionnaires || [];
        const questionnaireOptions = '<option value="">選択してください</option>' +
            questionnaires.map(q => `<option value="${q.id}">${q.name}</option>`).join('');

        const firstQSelect = document.getElementById('deptFirstQuestionnaire');
        const revisitQSelect = document.getElementById('deptRevisitQuestionnaire');
        if (firstQSelect) firstQSelect.innerHTML = questionnaireOptions;
        if (revisitQSelect) revisitQSelect.innerHTML = questionnaireOptions;
    },

    // 互換性のため旧名も残す
    async showDepartmentModal(department = null) {
        await this.showDepartmentDrawer(department);
    },

    hideDepartmentModal() {
        this.hideDepartmentDrawer();
    },

    showDepartmentGroupModal(group = null) {
        const modal = document.getElementById('departmentGroupModal');
        const form = document.getElementById('departmentGroupForm');
        const title = document.getElementById('departmentGroupModalTitle');
        const saveButton = document.getElementById('saveDepartmentGroupModal');
        const nameInput = document.getElementById('departmentGroupName');

        if (!modal || !form || !title || !saveButton || !nameInput) return;

        form.reset();
        document.getElementById('departmentGroupId').value = group?.id || '';
        nameInput.value = group?.name || '';
        title.textContent = group ? '診療科グループ編集' : '診療科グループ追加';
        saveButton.textContent = group ? '保存' : '作成';

        modal.classList.remove('hidden');
        requestAnimationFrame(() => nameInput.focus());
    },

    hideDepartmentGroupModal() {
        document.getElementById('departmentGroupModal')?.classList.add('hidden');
    },

    saveDepartmentGroupForm() {
        const idInput = document.getElementById('departmentGroupId');
        const nameInput = document.getElementById('departmentGroupName');
        const name = nameInput?.value.trim() || '';

        if (!name) {
            nameInput?.focus();
            showAlert('診療科グループ名を入力してください', 'warning');
            return;
        }

        const groups = ensureEditableDepartmentGroups();
        const groupId = idInput?.value || generateLocalId('group');
        const existingIndex = groups.findIndex(group => group.id === groupId);

        if (existingIndex >= 0) {
            groups[existingIndex] = { ...groups[existingIndex], name };
        } else {
            groups.push({
                id: groupId,
                name,
                collapsed: false,
                departments: []
            });
        }

        saveStoredDepartmentGroups();
        this.hideDepartmentGroupModal();
        this.renderDepartmentTable();
        this.populateDepartmentGroupSelect();
    },

    showTemplateModal() {
        const modal = document.getElementById('templateModal');
        document.getElementById('templateForm').reset();
        document.getElementById('tmplId').value = '';
        this.populateDepartmentSelects();
        modal.classList.remove('hidden');
    },

    hideTemplateModal() {
        document.getElementById('templateModal').classList.add('hidden');
    }
};

// イベントハンドラー
const handlers = {
    editCalendar(id) {
        const row = state.calendarRows.find(calendar => calendar.id === id);
        if (row?.calendarId) {
            // カスタムカレンダーの編集
            const calendar = state.customCalendars.find(item => item.id === row.calendarId);
            if (calendar) ui.showCalendarForm(calendar);
            return;
        }
        if (row?.departmentId) {
            // 診療科から生成されたカレンダーの編集
            const calendar = this.rowToCalendar(row);
            ui.showCalendarForm(calendar);
            return;
        }
        // プレビュー用サンプルデータの編集
        const calendar = this.rowToCalendar(row);
        ui.showCalendarForm(calendar);
    },

    // 一覧の行データをカレンダーフォーム用のデータに変換
    rowToCalendar(row) {
        return {
            id: null, // 新規として保存される
            name: row.name || '',
            departments: [],
            staff: [],
            closeOffset: parseInt(row.closeOffset?.match(/\d+/)?.[0] || '0', 10),
            weekRule: 'date',
            visitTimeMode: 'time',
            startRule: 'calendar',
            startMonthOffset: 6,
            startHour: 0,
            startMinute: 0,
            timeDisplay: 'range',
            holidayPriority: false,
            periods: row.periods?.map(period => ({
                id: generateLocalId('period'),
                effective_from: this.parseRangeDate(period.range, 'from'),
                effective_until: this.parseRangeDate(period.range, 'until'),
                rows: period.rows?.map(r => ({
                    start_time: r.time?.split('〜')[0] || '09:00',
                    end_time: r.time?.split('〜')[1] || '12:00',
                    days: r.days || [false, false, false, false, false, false, false, false],
                    slot_duration: parseInt(r.setting?.match(/(\d+)分枠/)?.[1] || '15', 10),
                    first_duration: parseInt(r.setting?.match(/初診(\d+)分/)?.[1] || '15', 10),
                    revisit_duration: parseInt(r.setting?.match(/再診(\d+)分/)?.[1] || '15', 10),
                    max_bookings: parseInt(r.setting?.match(/医師(\d+)人/)?.[1] || '1', 10),
                    weeks: [true, true, true, true, true, true]
                })) || [defaultScheduleRow()]
            })) || [defaultPeriod()],
            temporarySettings: []
        };
    },

    // 期間文字列から日付を抽出
    parseRangeDate(rangeStr, type) {
        if (!rangeStr) return null;
        // 例: "2023/12/01（金）〜2025/08/31（日）"
        const parts = rangeStr.split('〜');
        const target = type === 'from' ? parts[0] : parts[1];
        if (!target || target.trim() === '') return null;
        const match = target.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (!match) return null;
        return `${match[1]}-${match[2]}-${match[3]}`;
    },

    refreshAfterReservationUpdate() {
        if (document.getElementById('page-reservations')?.classList.contains('active')) {
            ui.loadReservations();
            return;
        }
        ui.loadDashboard();
    },

    async deleteCalendar(id) {
        const row = state.calendarRows.find(calendar => calendar.id === id);
        if (row?.calendarId) {
            if (!confirm('この予約カレンダーを削除しますか？')) return;
            if (isApiCalendarId(row.calendarId)) {
                try {
                    await api.deleteCalendar(row.calendarId);
                } catch (error) {
                    console.error('Calendar delete error:', error);
                    showAlert('API削除に失敗しました: ' + error.message, 'error');
                    return;
                }
            }
            state.customCalendars = state.customCalendars.filter(item => item.id !== row.calendarId);
            saveStoredCalendars();
            await ui.loadDashboard();
            return;
        }
        if (row?.departmentId) {
            await this.deleteDepartment(row.departmentId);
            ui.loadDashboard();
            return;
        }
        showAlert('この行はデザイン確認用です。実データの削除は追加後のカレンダーで使えます。');
    },

    async checkin(id) {
        if (!confirm('来院チェックインしますか？')) return;
        try {
            await api.checkinReservation(id);
            this.refreshAfterReservationUpdate();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    async cancel(id) {
        if (!confirm('この予約を削除しますか？')) return;
        try {
            await api.updateReservationStatus(id, 'cancelled');
            this.refreshAfterReservationUpdate();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    deleteLocalReservation(reservationNumber) {
        if (!reservationNumber) return;
        if (!confirm('この予約を削除しますか？')) return;
        if (removeLocalReservation(reservationNumber)) {
            ui.loadReservations();
            showAlert('予約を削除しました', 'success');
        } else {
            showAlert('削除対象の予約が見つかりません', 'error');
        }
    },

    async complete(id) {
        try {
            await api.updateReservationStatus(id, 'completed');
            this.refreshAfterReservationUpdate();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    async showReservationQuestionnaire(id) {
        try {
            const responses = await api.getQuestionnaireResponsesByReservation(id);
            alert(formatQuestionnaireResponsesForText(responses));
        } catch (error) {
            showAlert('問診回答の取得に失敗しました: ' + error.message, 'error');
        }
    },

    async showReservationAttachment(id, attachmentType, label) {
        try {
            const attachment = await api.getReservationAttachment(id, attachmentType);
            const imageWindow = window.open('', '_blank');
            if (!imageWindow) {
                showAlert(`${label}を開けませんでした。ポップアップ設定を確認してください。`, 'error');
                return;
            }
            imageWindow.document.write(`
                <title>${escapeHTML(label)}</title>
                <body style="margin:0; background:#f4f7fa; font-family:sans-serif;">
                    <div style="padding:16px; font-weight:700;">${escapeHTML(label)}</div>
                    <img src="${escapeHTML(attachment.data_url)}" alt="${escapeHTML(label)}" style="display:block; max-width:100%; height:auto; margin:0 auto;">
                </body>
            `);
            imageWindow.document.close();
        } catch (error) {
            showAlert(`${label}の取得に失敗しました: ` + error.message, 'error');
        }
    },

    async editDepartment(id) {
        const dept = state.departments.find(d => String(d.id) === String(id)) || findStoredDepartmentById(id);
        if (dept) await ui.showDepartmentModal(dept);
    },

    async deleteDepartment(id) {
        if (!confirm('この診療科を削除しますか？')) return;
        try {
            if (!isApiCalendarId(id)) {
                const groups = ensureEditableDepartmentGroups();
                let removed = false;
                groups.forEach(group => {
                    const before = group.departments?.length || 0;
                    group.departments = (group.departments || []).filter(dept => String(dept.id) !== String(id));
                    if ((group.departments?.length || 0) !== before) {
                        removed = true;
                    }
                });
                if (!removed) {
                    showAlert('削除対象の診療科が見つかりません', 'error');
                    return;
                }
                saveStoredDepartmentGroups();
                state.customCalendars = loadStoredCalendars()
                    .map(calendar => ({
                        ...calendar,
                        departments: (calendar.departments || []).filter(dept => String(dept.id) !== String(id))
                    }))
                    .filter(calendar => (calendar.departments || []).length > 0);
                saveStoredCalendars();
                state.treatmentMenus = loadStoredTreatmentMenus()
                    .filter(menu => String(menu.department_id || '') !== String(id));
                saveStoredTreatmentMenus();
                state.calendarRows = buildCalendarRows();
                ui.renderDepartmentTable();
                ui.populateDepartmentGroupSelect();
                ui.renderCalendarList();
                ui.renderTreatmentSettings();
                showAlert('診療科を削除しました', 'success');
                return;
            }
            await api.deleteDepartment(id);
            ui.loadDepartments();
            showAlert('診療科を削除しました', 'success');
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    saveTreatmentMenu(rowKey) {
        ui.saveTreatmentMenu(rowKey);
    },

    saveTreatmentMenuRow(rowKey) {
        ui.saveTreatmentMenu(rowKey);
    },

    deleteTreatmentMenu(rowKey) {
        ui.deleteTreatmentMenu(rowKey);
    },

    editTreatmentDetailMenuItem(parentKey, detailId) {
        ui.showTreatmentDetailItemModal(parentKey, detailId);
    },

    deleteTreatmentDetailMenuItem(parentKey, detailId) {
        ui.deleteTreatmentDetailMenuItem(parentKey, detailId);
    },

    deleteTreatmentStaff(staffId) {
        ui.deleteTreatmentStaff(staffId);
    },

    editTreatmentStaff(staffId) {
        ui.showTreatmentResourceModal('staff', staffId);
    },

    deleteTreatmentRoom(roomId) {
        ui.deleteTreatmentRoom(roomId);
    },

    editTreatmentRoom(roomId) {
        ui.showTreatmentResourceModal('room', roomId);
    },

    deleteTreatmentEquipment(equipmentId) {
        ui.deleteTreatmentEquipment(equipmentId);
    },

    editTreatmentEquipment(equipmentId) {
        ui.showTreatmentResourceModal('equipment', equipmentId);
    },

    editTreatmentMenu(rowKey) {
        ui.showTreatmentMenuModal(rowKey);
    },

    addTreatmentMenuRow() {
        ui.addTreatmentMenuRow();
    },

    addBeautyCategoryRow() {
        ui.addBeautyCategoryRow();
    },

    editBeautyCategory(categoryId) {
        ui.editBeautyCategory(categoryId);
    },

    saveBeautyCategories() {
        ui.saveBeautyCategories();
    },

    deleteBeautyCategory(categoryId) {
        ui.deleteBeautyCategory(categoryId);
    },

    addTreatmentStepRow() {
        ui.addTreatmentStepRow();
    },

    editTreatmentStep(stepId) {
        ui.showTreatmentStepModal(stepId);
    },

    saveTreatmentSteps() {
        ui.saveTreatmentSteps();
    },

    deleteTreatmentStep(stepId) {
        ui.deleteTreatmentStep(stepId);
    },

    async saveTreatmentMenusAll() {
        await ui.saveTreatmentMenusAll();
    },

    // 診療科グループ関連
    editDepartmentGroup(id) {
        const group = getDepartmentGroupsForDisplay().find(item => item.id === id);
        if (group) ui.showDepartmentGroupModal(group);
    },

    async deleteDepartmentGroup(id) {
        if (!confirm('このグループを削除しますか？グループ内の診療科も削除されます。')) return;
        try {
            const groups = ensureEditableDepartmentGroups();
            const idx = groups.findIndex(g => g.id === id);
            if (idx !== -1) {
                groups.splice(idx, 1);
                saveStoredDepartmentGroups();
                ui.renderDepartmentTable();
                ui.populateDepartmentGroupSelect();
                showAlert('グループを削除しました', 'success');
            }
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    // URLコピー
    async copyDepartmentUrl(type, deptId) {
        let url = '';
        const baseUrl = window.location.origin;

        switch (type) {
            case 'questionnaire':
                url = `${baseUrl}/questionnaire/${deptId}`;
                break;
            case 'reservation':
                url = `${baseUrl}/reserve/${deptId}`;
                break;
            case 'html':
                url = `<iframe src="${baseUrl}/reserve/${deptId}" width="100%" height="600" frameborder="0"></iframe>`;
                break;
        }

        try {
            await navigator.clipboard.writeText(url);
            showAlert('クリップボードにコピーしました', 'success');
        } catch (error) {
            showAlert('コピーに失敗しました', 'error');
        }
    },

    async deleteTemplate(id) {
        if (!confirm('このテンプレートを削除しますか？')) return;
        try {
            await api.deleteTemplate(id);
            ui.loadSchedules();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    },

    // =====================================================
    // 問診票ハンドラー
    // =====================================================
    async editQuestionnaire(id) {
        try {
            const questionnaire = await api.getQuestionnaire(id);
            ui.showQuestionnaireDrawer(normalizeQuestionnaireDetail(questionnaire));
        } catch (error) {
            console.error('問診票の読み込みに失敗:', error);
            const questionnaire = state.questionnaires.find(q => q.id === id);
            if (questionnaire) ui.showQuestionnaireDrawer(questionnaire);
        }
    },

    async duplicateQuestionnaire(id) {
        try {
            await api.duplicateQuestionnaire(id);
            await ui.renderQuestionnaireList();
        } catch (error) {
            console.error('問診票の複製に失敗:', error);
            showAlert('問診票の複製に失敗しました: ' + (error.message || 'エラーが発生しました'), 'error');
        }
    },

    async deleteQuestionnaire(id) {
        if (!confirm('この問診票を削除しますか？')) return;

        try {
            await api.deleteQuestionnaire(id);
            await ui.renderQuestionnaireList();
        } catch (error) {
            console.error('問診票の削除に失敗:', error);
            showAlert('問診票の削除に失敗しました: ' + (error.message || 'エラーが発生しました'), 'error');
        }
    },

    addQuestionItem(itemType) {
        const template = questionTemplates[itemType];
        if (!template) return;

        // カスタム項目の場合はモーダルを開く
        if (template.customizable) {
            this.openCustomItemModal(itemType, template);
            return;
        }

        const item = {
            ...template,
            id: generateLocalId('qi')
        };

        const container = document.getElementById('questionnaireItems');
        container.insertAdjacentHTML('beforeend', ui.renderQuestionnaireItem(item));
    },

    openCustomItemModal(itemType, template) {
        const modal = document.getElementById('customItemModal');
        const form = document.getElementById('customItemForm');
        const titleEl = document.getElementById('customItemModalTitle');
        const optionsContainer = document.getElementById('customOptionsContainer');
        const optionsList = document.getElementById('customOptionsList');
        const textSettings = document.getElementById('customTextSettings');
        const imageSettings = document.getElementById('customImageSettings');
        const dateSettings = document.getElementById('customDateSettings');
        const requiredRow = document.querySelector('.custom-required-row');

        // モーダルタイトルを設定
        const typeNames = {
            'custom_text': 'カスタム（テキスト）編集',
            'custom_single': 'カスタム（単一選択）編集',
            'custom_multi': 'カスタム（複数選択）編集',
            'custom_image': 'カスタム（画像）編集',
            'custom_date': 'カスタム（日付）編集',
            'custom_description': 'カスタム（説明のみ）編集'
        };
        titleEl.textContent = typeNames[itemType] || 'カスタム項目の設定';

        // フォームをリセット
        form.reset();
        document.getElementById('customItemType').value = itemType;
        document.querySelectorAll('.custom-date-weekday').forEach(input => {
            input.checked = true;
        });
        document.querySelector('input[name="customDateLimit"][value="none"]').checked = true;
        document.getElementById('customDateAfterType').disabled = true;
        optionsContainer.classList.add('hidden');
        textSettings.classList.add('hidden');
        imageSettings.classList.add('hidden');
        dateSettings.classList.add('hidden');
        requiredRow.classList.toggle('hidden', itemType === 'custom_description');

        // 選択肢が必要なタイプの場合は表示
        if (itemType === 'custom_single' || itemType === 'custom_multi') {
            optionsContainer.classList.remove('hidden');
            optionsList.innerHTML = `
                <div class="custom-option-row">
                    <input type="text" class="custom-option-input" placeholder="項目名を入力">
                    <button type="button" class="custom-option-remove" onclick="this.parentElement.remove()">×</button>
                </div>
            `;
        } else if (itemType === 'custom_text') {
            textSettings.classList.remove('hidden');
            optionsList.innerHTML = '';
        } else if (itemType === 'custom_image') {
            imageSettings.classList.remove('hidden');
            optionsList.innerHTML = '';
        } else if (itemType === 'custom_date') {
            dateSettings.classList.remove('hidden');
            optionsList.innerHTML = '';
        } else {
            optionsList.innerHTML = '';
        }

        modal.classList.remove('hidden');
        modal.classList.add('active');
    },

    closeCustomItemModal() {
        const modal = document.getElementById('customItemModal');
        modal.classList.remove('active');
        modal.classList.add('hidden');
    },

    addCustomOption() {
        const optionsList = document.getElementById('customOptionsList');
        const row = document.createElement('div');
        row.className = 'custom-option-row';
        row.innerHTML = `
            <input type="text" class="custom-option-input" placeholder="項目名を入力">
            <button type="button" class="custom-option-remove" onclick="this.parentElement.remove()">×</button>
        `;
        optionsList.appendChild(row);
    },

    addCustomOtherOption() {
        const optionsList = document.getElementById('customOptionsList');
        const hasOther = Array.from(optionsList.querySelectorAll('.custom-option-input'))
            .some(input => input.value.trim() === 'その他');
        if (hasOther) return;
        const row = document.createElement('div');
        row.className = 'custom-option-row';
        row.innerHTML = `
            <input type="text" class="custom-option-input" value="その他">
            <button type="button" class="custom-option-remove" onclick="this.parentElement.remove()">×</button>
        `;
        optionsList.appendChild(row);
    },

    saveCustomItem() {
        const itemType = document.getElementById('customItemType').value;
        const title = document.getElementById('customItemTitle').value.trim();
        const description = document.getElementById('customItemDescription').value.trim();
        const required = document.getElementById('customItemRequired').checked;

        if (!title) {
            showAlert('タイトルを入力してください');
            return;
        }

        // 選択肢を取得
        let customOptions = [];
        if (itemType === 'custom_single' || itemType === 'custom_multi') {
            const optionInputs = document.querySelectorAll('.custom-option-input');
            optionInputs.forEach(input => {
                const val = input.value.trim();
                if (val) customOptions.push(val);
            });

            if (customOptions.length === 0) {
                showAlert('選択肢を少なくとも1つ入力してください');
                return;
            }
        }

        const customSettings = {
            multiline: document.getElementById('customTextMultiline').checked,
            allowMultipleImages: document.getElementById('customImageMultiple').checked,
            saveAsAttachment: document.getElementById('customImageSaveAttachment').checked,
            weekdays: Array.from(document.querySelectorAll('.custom-date-weekday:checked')).map(input => input.value),
            dateLimit: document.querySelector('input[name="customDateLimit"]:checked')?.value || 'none',
            dateAfterType: document.getElementById('customDateAfterType').value,
            dateFrom: document.getElementById('customDateFrom').value,
            dateTo: document.getElementById('customDateTo').value
        };

        const item = {
            ...questionTemplates[itemType],
            id: generateLocalId('qi'),
            label: title,
            description: description,
            required: required,
            customOptions: customOptions,
            customSettings: customSettings
        };

        const container = document.getElementById('questionnaireItems');
        container.insertAdjacentHTML('beforeend', ui.renderQuestionnaireItem(item));

        this.closeCustomItemModal();
    },

    removeQuestionItem(itemId) {
        const el = document.querySelector(`.questionnaire-item[data-item-id="${itemId}"]`);
        if (el) el.remove();
    }
};

// グローバル公開
window.handlers = handlers;

// 初期化
function init() {
    // =====================================================
    // クリニック管理の初期化
    // =====================================================
    loadClinics();
    loadCurrentClinicId();
    migrateOldDataToCurrentClinic();  // 旧データを現在のクリニックに移行
    ui.renderClinicSelector();

    // クリニックセレクターの変更イベント
    document.getElementById('clinicSelector')?.addEventListener('change', (e) => {
        switchClinic(e.target.value);
    });

    // クリニック設定ボタン
    document.getElementById('clinicSettingsBtn')?.addEventListener('click', () => {
        ui.showClinicModal();
    });

    // クリニック管理モーダルのイベント
    document.getElementById('closeClinicModal')?.addEventListener('click', () => {
        ui.hideClinicModal();
    });
    document.getElementById('closeClinicModalBtn')?.addEventListener('click', () => {
        ui.hideClinicModal();
    });
    document.getElementById('clinicManageModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'clinicManageModal') ui.hideClinicModal();
    });
    document.getElementById('addClinicBtn')?.addEventListener('click', () => {
        ui.addNewClinic();
    });
    document.getElementById('newClinicName')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            ui.addNewClinic();
        }
    });

    // クリニック一覧の操作イベント（イベント委譲）
    document.getElementById('clinicList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const item = btn.closest('.clinic-list-item');
        const clinicId = item?.dataset.clinicId;
        if (!clinicId) return;

        const action = btn.dataset.action;
        if (action === 'edit') {
            ui.startEditClinic(clinicId);
        } else if (action === 'delete') {
            ui.confirmDeleteClinic(clinicId);
        } else if (action === 'save') {
            const input = item.querySelector('.clinic-item-input');
            if (input) {
                ui.saveEditClinic(clinicId, input.value);
            }
        } else if (action === 'cancel') {
            ui.renderClinicList();
        }
    });

    // 編集中のEnterキーで保存
    document.getElementById('clinicList')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('clinic-item-input')) {
            e.preventDefault();
            const clinicId = e.target.dataset.clinicId;
            if (clinicId) {
                ui.saveEditClinic(clinicId, e.target.value);
            }
        }
    });

    document.getElementById('facilityReviewForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveFacilityReviewSettings();
    });

    // =====================================================
    // 既存の初期化処理
    // =====================================================

    const getKarteReturnUrl = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('karte_return')
            || sessionStorage.getItem('digimaster_karte_url')
            || localStorage.getItem('digimaster_karte_url')
            || '';
    };

    // カルテに戻るボタン
    document.getElementById('backToKarte')?.addEventListener('click', (e) => {
        e.preventDefault();
        const karteUrl = getKarteReturnUrl();
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.focus();
                window.close();
                return;
            } catch (error) {
                console.info('元のカルテ画面へフォーカスできませんでした:', error);
            }
        }
        if (karteUrl) {
            window.location.href = karteUrl;
        } else {
            // フォールバック: 履歴で戻る
            window.history.back();
        }
    });

    // ナビゲーション
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (!item.dataset.page) return;
            ui.showPage(item.dataset.page);
        });
    });

    // タブ
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // 予約カレンダー追加画面
    document.getElementById('addCalendar').addEventListener('click', () => ui.showCalendarForm());

    // ドロワーを閉じる
    document.getElementById('cancelCalendarForm').addEventListener('click', () => {
        ui.hideCalendarDrawer();
    });
    document.getElementById('calendarDrawerOverlay').addEventListener('click', () => {
        ui.hideCalendarDrawer();
    });

    // ドロワーの保存ボタン
    document.getElementById('saveCalendarDrawer').addEventListener('click', async () => {
        await ui.saveCalendarForm();
    });

    // フォームのsubmit（Enterキーなど）
    document.getElementById('calendarForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await ui.saveCalendarForm();
    });
    document.getElementById('addCalendarTimeRow').addEventListener('click', () => {
        const lastPeriod = document.querySelector('#calendarPeriods .calendar-period-block:last-child .schedule-config-rows');
        if (lastPeriod) lastPeriod.insertAdjacentHTML('beforeend', renderScheduleRow());
    });
    document.getElementById('addCalendarPeriod').addEventListener('click', () => {
        document.getElementById('calendarPeriods').insertAdjacentHTML('beforeend', renderCalendarPeriod(defaultPeriod()));
    });
    document.getElementById('addTemporarySetting').addEventListener('click', () => {
        document.getElementById('temporarySettings').insertAdjacentHTML('beforeend', renderTemporarySetting());
    });
    document.getElementById('calendarPeriods').addEventListener('click', (e) => {
        const removeButton = e.target.closest('.remove-time-row');
        if (!removeButton) return;
        const rowsContainer = removeButton.closest('.schedule-config-rows');
        const rows = rowsContainer.querySelectorAll('.schedule-config-row');
        if (rows.length <= 1) {
            showAlert('診療時間は1行以上必要です');
            return;
        }
        removeButton.closest('.schedule-config-row').remove();
    });
    document.getElementById('temporarySettings').addEventListener('click', (e) => {
        const removeButton = e.target.closest('.remove-temporary-row');
        if (removeButton) removeButton.closest('.temporary-setting-block').remove();
    });

    // 臨時設定のラジオボタン切り替え
    document.getElementById('temporarySettings').addEventListener('change', (e) => {
        const block = e.target.closest('.temporary-setting-block');
        if (!block) return;

        // 対象期間の切り替え
        if (e.target.classList.contains('temp-period-type')) {
            const periodType = e.target.value;
            block.querySelector('.temp-yearly-fields').classList.toggle('hidden', periodType !== 'yearly');
            block.querySelector('.temp-once-fields').classList.toggle('hidden', periodType !== 'once');
        }

        // 診療・休診の切り替え
        if (e.target.classList.contains('temp-status')) {
            const status = e.target.value;
            block.querySelector('.temp-open-fields').classList.toggle('hidden', status !== 'open');
        }
    });

    // =====================================================
    // 問診票イベントリスナー
    // =====================================================
    document.getElementById('addQuestionnaire')?.addEventListener('click', () => {
        ui.showQuestionnaireDrawer();
    });

    document.getElementById('cancelQuestionnaireForm')?.addEventListener('click', () => {
        ui.hideQuestionnaireDrawer();
    });

    document.getElementById('questionnaireDrawerOverlay')?.addEventListener('click', () => {
        ui.hideQuestionnaireDrawer();
    });

    document.getElementById('saveQuestionnaireDrawer')?.addEventListener('click', async () => {
        await ui.saveQuestionnaireForm();
    });

    // 問診票タブ切り替え
    document.querySelectorAll('.questionnaire-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            ui.switchQuestionnaireTab(tab.dataset.tab);
        });
    });

    // 問診サイドバーから項目追加
    document.querySelectorAll('.questionnaire-sidebar-items .sidebar-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            handlers.addQuestionItem(item.dataset.item);
        });
    });

    // 問診項目追加ボタン（フォーム内）
    document.getElementById('addQuestionItem')?.addEventListener('click', () => {
        // デフォルトでテキスト項目を追加
        const item = {
            id: generateLocalId('qi'),
            label: '新しい質問',
            type: 'text',
            required: false
        };
        const container = document.getElementById('questionnaireItems');
        container.insertAdjacentHTML('beforeend', ui.renderQuestionnaireItem(item));
    });

    // カスタム項目モーダル
    document.getElementById('closeCustomItemModal')?.addEventListener('click', () => {
        handlers.closeCustomItemModal();
    });

    document.getElementById('cancelCustomItem')?.addEventListener('click', () => {
        handlers.closeCustomItemModal();
    });

    document.getElementById('addCustomOption')?.addEventListener('click', () => {
        handlers.addCustomOption();
    });

    document.getElementById('addCustomOtherOption')?.addEventListener('click', () => {
        handlers.addCustomOtherOption();
    });

    document.querySelectorAll('input[name="customDateLimit"]').forEach(input => {
        input.addEventListener('change', () => {
            document.getElementById('customDateAfterType').disabled =
                document.querySelector('input[name="customDateLimit"]:checked')?.value !== 'after';
        });
    });

    document.getElementById('customItemForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        handlers.saveCustomItem();
    });

    // 診療科ドロワー
    document.getElementById('addDepartment')?.addEventListener('click', async () => await ui.showDepartmentDrawer());
    document.getElementById('addDepartmentGroup')?.addEventListener('click', () => {
        ui.showDepartmentGroupModal();
    });
    document.getElementById('addTreatmentMenu')?.addEventListener('click', () => {
        ui.addTreatmentMenuRow();
    });
    document.getElementById('addBeautyCategory')?.addEventListener('click', () => {
        ui.addBeautyCategoryRow();
    });
    document.getElementById('saveBeautyCategories')?.addEventListener('click', () => {
        ui.saveBeautyCategories();
    });
    document.getElementById('addTreatmentStep')?.addEventListener('click', () => {
        ui.addTreatmentStepRow();
    });
    document.getElementById('saveTreatmentSteps')?.addEventListener('click', () => {
        ui.saveTreatmentSteps();
    });
    document.getElementById('bulkUpdateStepAssignments')?.addEventListener('click', () => {
        ui.saveTreatmentSteps();
    });
    document.getElementById('multiMenuStepReservationSettings')?.addEventListener('click', () => {
        showAlert('複数メニュー予約時の予約順設定はステップ割当に統合しています', 'info');
    });
    document.getElementById('multiMenuNoConcurrentSettings')?.addEventListener('click', () => {
        showAlert('同時予約不可設定は今後の詳細設定で扱います', 'info');
    });
    document.getElementById('treatmentStepIntervalSettings')?.addEventListener('click', () => {
        showAlert('施術間隔はメニュー編集のステップ時間で管理します', 'info');
    });
    document.getElementById('cancelTreatmentStepModal')?.addEventListener('click', () => {
        ui.hideTreatmentStepModal();
    });
    document.getElementById('closeTreatmentStepModal')?.addEventListener('click', () => {
        ui.hideTreatmentStepModal();
    });
    document.getElementById('treatmentStepModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'treatmentStepModal') ui.hideTreatmentStepModal();
    });
    document.getElementById('treatmentStepForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveTreatmentStepFromModal();
    });
    document.getElementById('deleteTreatmentStepFromModal')?.addEventListener('click', () => {
        const stepId = document.getElementById('treatmentStepId')?.value || '';
        if (stepId) {
            ui.hideTreatmentStepModal();
            ui.deleteTreatmentStep(stepId);
        }
    });
    document.getElementById('addTreatmentStaff')?.addEventListener('click', () => {
        ui.addTreatmentStaff();
    });
    document.getElementById('saveResourceCapacities')?.addEventListener('click', () => {
        ui.saveResourceCapacities();
    });
    document.getElementById('addTreatmentRoom')?.addEventListener('click', () => {
        ui.addTreatmentRoom();
    });
    document.getElementById('saveTreatmentRooms')?.addEventListener('click', () => {
        ui.saveTreatmentRooms();
    });
    document.getElementById('addTreatmentEquipment')?.addEventListener('click', () => {
        ui.addTreatmentEquipment();
    });
    document.getElementById('saveTreatmentEquipment')?.addEventListener('click', () => {
        ui.saveTreatmentEquipment();
    });
    document.getElementById('cancelTreatmentResourceModal')?.addEventListener('click', () => {
        ui.hideTreatmentResourceModal();
    });
    document.getElementById('closeTreatmentResourceModal')?.addEventListener('click', () => {
        ui.hideTreatmentResourceModal();
    });
    document.getElementById('treatmentResourceModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'treatmentResourceModal') ui.hideTreatmentResourceModal();
    });
    document.getElementById('treatmentResourceForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveTreatmentResourceFromModal();
    });
    document.getElementById('cancelTreatmentDetailItemModal')?.addEventListener('click', () => {
        ui.hideTreatmentDetailItemModal();
    });
    document.getElementById('closeTreatmentDetailItemModal')?.addEventListener('click', () => {
        ui.hideTreatmentDetailItemModal();
    });
    document.getElementById('treatmentDetailItemModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'treatmentDetailItemModal') ui.hideTreatmentDetailItemModal();
    });
    document.getElementById('treatmentDetailItemForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveTreatmentDetailItemFromModal();
    });
    document.getElementById('deleteTreatmentDetailItemModal')?.addEventListener('click', () => {
        ui.deleteTreatmentDetailItemFromModal();
    });
    document.getElementById('treatmentDetailCategory')?.addEventListener('change', (e) => {
        const originalId = document.getElementById('treatmentDetailOriginalId')?.value || '';
        if (originalId) return;
        const category = getBeautyCategoryById(e.target.value);
        const template = DEFAULT_TREATMENT_MENUS.find(menu => menu.code === category?.code) || { code: category?.code || '', resource_type: 'nurse' };
        ui.renderTreatmentDetailStepRows(normalizeTreatmentDetailStepAssignments([], defaultStepIdsForTreatmentMenu(template)));
        ui.updateTreatmentDetailDerivedDuration();
    });
    document.getElementById('treatmentDetailStepRows')?.addEventListener('click', (e) => {
        const addButton = e.target.closest('[data-action="add-detail-step"]');
        if (addButton) {
            ui.addTreatmentDetailStepRow();
            return;
        }
        const removeButton = e.target.closest('[data-action="remove-detail-step"]');
        if (!removeButton) return;
        const row = removeButton.closest('.treatment-detail-step-row');
        row?.remove();
        if (!document.querySelector('#treatmentDetailStepRows .treatment-detail-step-row')) {
            ui.addTreatmentDetailStepRow();
        }
        ui.updateTreatmentDetailDerivedDuration();
    });
    document.getElementById('treatmentDetailStepRows')?.addEventListener('change', (e) => {
        if (!e.target.classList.contains('treatment-detail-step-id')) {
            ui.updateTreatmentDetailDerivedDuration();
            return;
        }
        const row = e.target.closest('.treatment-detail-step-row');
        const durationInput = row?.querySelector('.treatment-detail-step-duration');
        const step = getTreatmentStepById(e.target.value);
        if (durationInput && step?.duration_minutes) {
            durationInput.value = step.duration_minutes;
        }
        ui.updateTreatmentDetailDerivedDuration();
    });
    document.getElementById('treatmentDetailStepRows')?.addEventListener('input', (e) => {
        if (e.target.classList.contains('treatment-detail-step-duration')) ui.updateTreatmentDetailDerivedDuration();
    });
    document.getElementById('saveTreatmentMenusAll')?.addEventListener('click', () => {
        handlers.saveTreatmentMenusAll();
    });
    // 施術メニューモーダル
    document.getElementById('cancelTreatmentMenuModal')?.addEventListener('click', () => {
        ui.hideTreatmentMenuModal();
    });
    document.getElementById('treatmentMenuModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'treatmentMenuModal') ui.hideTreatmentMenuModal();
    });
    document.getElementById('treatmentMenuForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveTreatmentMenuFromModal();
    });
    document.getElementById('addTreatmentDetailMenu')?.addEventListener('click', () => {
        ui.addTreatmentDetailMenuRow();
    });
    document.getElementById('addTreatmentMenuEquipmentRequirement')?.addEventListener('click', () => {
        ui.addTreatmentMenuEquipmentRequirement();
    });
    document.getElementById('treatmentMenuEquipmentRequirements')?.addEventListener('click', (e) => {
        const deleteButton = e.target.closest('[data-action="delete-equipment-requirement"]');
        if (!deleteButton) return;
        deleteButton.closest('.treatment-equipment-requirement-row')?.remove();
        if (!document.querySelector('#treatmentMenuEquipmentRequirements .treatment-equipment-requirement-row')) {
            ui.renderTreatmentMenuEquipmentRequirements([]);
        }
    });
    document.getElementById('treatmentMenuEquipmentRequirements')?.addEventListener('change', (e) => {
        if (!e.target.classList.contains('treatment-equipment-requirement-code')) return;
        const row = e.target.closest('.treatment-equipment-requirement-row');
        const durationInput = row?.querySelector('.treatment-equipment-requirement-duration');
        if (!durationInput || durationInput.value) return;
        const master = (state.treatmentEquipment || []).find(item => item.code === e.target.value);
        const duration = master?.default_duration_minutes || master?.defaultDurationMinutes;
        if (duration) durationInput.value = duration;
    });
    document.getElementById('treatmentDetailMenuList')?.addEventListener('click', (e) => {
        const addButton = e.target.closest('[data-action="add-detail-menu"]');
        if (addButton) {
            ui.addTreatmentDetailMenuRow();
            return;
        }
        const deleteButton = e.target.closest('[data-action="delete-detail-menu"]');
        if (!deleteButton) return;
        deleteButton.closest('.treatment-detail-menu-row')?.remove();
        if (!document.querySelector('#treatmentDetailMenuList .treatment-detail-menu-row')) {
            ui.renderTreatmentDetailMenuRows([]);
        }
    });
    document.getElementById('treatmentMenuImageFile')?.addEventListener('change', async (e) => {
        await ui.setTreatmentMenuImageFile(e.target.files?.[0]);
    });
    const treatmentImageDropzone = document.getElementById('treatmentMenuImageDropzone');
    const treatmentImageFileInput = document.getElementById('treatmentMenuImageFile');
    treatmentImageDropzone?.addEventListener('click', () => {
        treatmentImageFileInput?.click();
    });
    treatmentImageDropzone?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        treatmentImageFileInput?.click();
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        treatmentImageDropzone?.addEventListener(eventName, (e) => {
            e.preventDefault();
            treatmentImageDropzone.classList.add('dragging');
        });
    });
    ['dragleave', 'drop'].forEach(eventName => {
        treatmentImageDropzone?.addEventListener(eventName, (e) => {
            e.preventDefault();
            treatmentImageDropzone.classList.remove('dragging');
        });
    });
    treatmentImageDropzone?.addEventListener('drop', async (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) await ui.setTreatmentMenuImageFile(file);
    });
    document.getElementById('cancelDepartmentGroupModal')?.addEventListener('click', () => {
        ui.hideDepartmentGroupModal();
    });
    document.getElementById('departmentGroupModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'departmentGroupModal') ui.hideDepartmentGroupModal();
    });
    document.getElementById('departmentGroupForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.saveDepartmentGroupForm();
    });
    document.getElementById('cancelDepartmentDrawer')?.addEventListener('click', () => ui.hideDepartmentDrawer());
    document.getElementById('departmentDrawerOverlay')?.addEventListener('click', () => ui.hideDepartmentDrawer());

    document.getElementById('saveDepartmentDrawer')?.addEventListener('click', async () => {
        const id = document.getElementById('deptId').value;
        const data = {
            id: id || '',
            name: document.getElementById('deptName').value,
            groupId: document.getElementById('deptGroup').value,
            digitalName: document.getElementById('deptDigitalName').value,
            firstVisitType: document.getElementById('deptFirstVisitType').value,
            firstRoom: document.getElementById('deptFirstRoom').value,
            revisitRoom: document.getElementById('deptRevisitRoom').value,
            firstQuestionnaire: document.getElementById('deptFirstQuestionnaire').value,
            revisitQuestionnaire: document.getElementById('deptRevisitQuestionnaire').value,
            payment: document.querySelector('input[name="deptPayment"]:checked')?.value,
            fax: document.querySelector('input[name="deptFax"]:checked')?.value,
            contactDisplay: document.querySelector('input[name="deptContactDisplay"]:checked')?.value,
            bookingLimit: document.getElementById('deptBookingLimit').value,
            preBookingMsg: document.getElementById('deptPreBookingMsg').value,
            bookingCompleteMsg: document.getElementById('deptBookingCompleteMsg').value,
            fiveMinBeforeMsg: document.getElementById('dept5minBeforeMsg').value,
            justBeforeMsg: document.getElementById('deptJustBeforeMsg').value,
            paymentCompleteMsg: document.getElementById('deptPaymentCompleteMsg').value,
            showCheckinBtn: document.getElementById('deptShowCheckinBtn').checked,
            patientDisplay: document.querySelector('input[name="deptPatientDisplay"]:checked')?.value,
            cancelLimit: document.querySelector('input[name="deptCancelLimit"]:checked')?.value,
            cancelDays: document.getElementById('deptCancelDays').value,
            changeLimit: document.querySelector('input[name="deptChangeLimit"]:checked')?.value,
            changeDays: document.getElementById('deptChangeDays').value,
            visitType: document.querySelector('input[name="deptVisitType"]:checked')?.value
        };

        try {
            if (!data.name.trim()) {
                showAlert('診療科名を入力してください', 'error');
                return;
            }

            saveStoredDepartment(data);
            loadStoredDepartmentGroups();
            state.departments = [];
            state.calendarRows = buildCalendarRows();
            ui.hideDepartmentDrawer();
            ui.renderDepartmentTable();
            ui.renderCalendarList();
            showAlert(id ? '診療科を更新しました' : '診療科を作成しました', 'success');
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    });

    // テンプレートモーダル（将来用）
    document.getElementById('addTemplate')?.addEventListener('click', () => ui.showTemplateModal());
    document.getElementById('closeTemplateModal')?.addEventListener('click', ui.hideTemplateModal);
    document.getElementById('cancelTemplate')?.addEventListener('click', ui.hideTemplateModal);

    document.getElementById('templateForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            department_id: document.getElementById('tmplDepartment').value,
            day_of_week: parseInt(document.getElementById('tmplDayOfWeek').value),
            start_time: document.getElementById('tmplStartTime').value,
            end_time: document.getElementById('tmplEndTime').value,
            slot_duration: parseInt(document.getElementById('tmplDuration').value),
            max_bookings: parseInt(document.getElementById('tmplMaxBookings').value)
        };

        try {
            await api.createTemplate(data);
            ui.hideTemplateModal();
            ui.loadSchedules();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    });

    // 枠生成（将来用）
    document.getElementById('generateForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const departmentId = document.getElementById('genDepartment').value;
        const startDate = document.getElementById('genStartDate').value;
        const endDate = document.getElementById('genEndDate').value;

        try {
            const result = await api.generateSlots(departmentId, startDate, endDate);
            showAlert(result.message, 'success');
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    });

    // 休診設定（将来用）
    document.getElementById('closureForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            department_id: document.getElementById('closureDepartment').value,
            closure_date: document.getElementById('closureDate').value,
            closure_type: 'closed',
            reason: document.getElementById('closureReason').value || null
        };

        try {
            await api.createClosure(data);
            showAlert('休診を設定しました', 'success');
            document.getElementById('closureForm').reset();
        } catch (error) {
            showAlert('エラー: ' + error.message, 'error');
        }
    });

    // 予約検索
    document.getElementById('applyFilter')?.addEventListener('click', () => ui.loadReservations());
    document.querySelectorAll('[data-reservation-view]').forEach(button => {
        button.addEventListener('click', () => ui.setReservationViewMode(button.dataset.reservationView));
    });
    document.querySelectorAll('[data-reservation-range]').forEach(button => {
        button.addEventListener('click', () => ui.setReservationRangeMode(button.dataset.reservationRange));
    });
    document.querySelectorAll('[data-reservation-resource-axis]').forEach(button => {
        button.addEventListener('click', () => ui.setReservationResourceAxis(button.dataset.reservationResourceAxis));
    });
    document.getElementById('filterDateFrom')?.addEventListener('change', () => {
        ui.syncReservationRangeInputs();
    });

    // 初期日付設定
    const today = utils.formatDate(new Date());
    const setInputValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    };

    const reservationEndDate = new Date();
    reservationEndDate.setDate(reservationEndDate.getDate() + 6);
    setInputValue('filterDateFrom', today);
    setInputValue('filterDateTo', utils.formatDate(reservationEndDate));
    setInputValue('genStartDate', today);
    setInputValue('closureDate', today);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    setInputValue('genEndDate', utils.formatDate(nextWeek));

    // ダッシュボード表示
    ui.showPage('dashboard');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
