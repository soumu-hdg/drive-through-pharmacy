// ============================================================
// SoundForge — シーン別タグ体系（横断ブラウズ用）
//   COLLECTIONS(collections.js) を読み、用途/気分で横断検索できる
//   統合トラック配列 UNIFIED_TRACKS を構築する。
// ============================================================

// ── シーン別タグ（主軸・用途/気分）──
// group: 表示グループ（戦闘系はまとめる）
const SCENE_TAGS = [
  { key: 'normal_battle', label: '通常戦闘',        short: '戦闘',   group: '戦闘',   icon: '⚔' },
  { key: 'boss_battle',   label: 'ボス戦',          short: 'ボス',   group: '戦闘',   icon: '☠' },
  { key: 'climax',        label: 'クライマックス',  short: '決戦',   group: '戦闘',   icon: '★' },
  { key: 'tension',       label: '緊迫・ハプニング', short: '緊迫',   group: '緊迫',   icon: '⚡' },
  { key: 'explore',       label: '探索・不穏',      short: '探索',   group: '探索',   icon: '◎' },
  { key: 'daily',         label: '日常',            short: '日常',   group: '日常',   icon: '☀' },
  { key: 'chill',         label: 'まったり',        short: 'まったり', group: 'まったり', icon: '～' },
  { key: 'emotional',     label: '感傷・シリアス',  short: '感傷',   group: '感傷',   icon: '❦' },
  { key: 'comical',       label: 'コミカル・軽快',  short: '軽快',   group: 'コミカル', icon: '♪' },
];

// ── 雰囲気タグ（補助・世界観）──
const MOOD_TAGS = [
  { key: 'modern',  label: '現代・都市' },
  { key: 'fantasy', label: 'ファンタジー' },
  { key: 'wafu',    label: '和風' },
  { key: 'scifi',   label: 'SF・サイバー' },
  { key: 'horror',  label: 'ホラー' },
  { key: 'lofi',    label: 'Lo-Fi・アコースティック' },
];

const SCENE_TAG_MAP = Object.fromEntries(SCENE_TAGS.map(t => [t.key, t]));
const MOOD_TAG_MAP  = Object.fromEntries(MOOD_TAGS.map(t => [t.key, t]));

// ── シーンID → [シーンタグ, 雰囲気タグ] の明示分類 ──
// （各コレクションの実際のシーン内容に基づき手動分類）
const SCENE_CLASS = {
  // ── trpg（ファンタジー/クトゥルフ/和風/現代異能）──
  coc_old_library:['explore','horror'], coc_victorian_mansion:['explore','horror'],
  coc_rainy_street_1920s:['explore','horror'], coc_underground_tunnel:['explore','horror'],
  coc_abandoned_chapel:['tension','horror'],
  fantasy_medieval_town:['daily','fantasy'], fantasy_tavern_interior:['daily','fantasy'],
  fantasy_crystal_cave:['explore','fantasy'], fantasy_ancient_ruins:['explore','fantasy'],
  fantasy_dragon_lair:['boss_battle','fantasy'],
  wafu_shrine_dawn:['chill','wafu'], wafu_yokai_forest:['explore','wafu'],
  wafu_old_house_hearth:['chill','wafu'], wafu_snow_mountain_pass:['emotional','wafu'],
  wafu_battle_eve:['tension','wafu'], wafu_oni_roar:['boss_battle','wafu'],
  wafu_cherry_garden:['chill','wafu'], wafu_kitsunebi_moonlight:['explore','wafu'],
  modern_after_school:['daily','modern'], modern_abandoned_school:['explore','modern'],
  modern_back_alley:['tension','modern'], modern_barrier_forest:['explore','modern'],
  modern_power_awakening:['normal_battle','modern'], modern_midnight_conbini:['daily','modern'],
  modern_dream_boundary:['chill','modern'], modern_rooftop_twilight:['emotional','modern'],
  // ── streaming（配信待機）──
  streaming_cute_cafe:['chill','lofi'], streaming_cozy_room:['chill','lofi'],
  streaming_night_window_city:['chill','lofi'], streaming_pastel_kitchen:['chill','lofi'],
  // ── story（ゆっくり解説）──
  yukkuri_peaceful_intro:['comical','lofi'], yukkuri_history:['chill','lofi'],
  yukkuri_trivia_pop:['comical','lofi'], yukkuri_mystery:['explore','horror'],
  yukkuri_tension:['tension','lofi'], yukkuri_occult:['explore','horror'],
  yukkuri_countdown:['comical','lofi'], yukkuri_lab_notes:['chill','lofi'],
  yukkuri_comic_beat:['comical','lofi'], yukkuri_thanks:['chill','lofi'],
  // ── cyberpunk（SF）──
  neon_night_market:['daily','scifi'], data_flood:['tension','scifi'],
  orbital_dawn:['chill','scifi'], heart_of_the_machine:['explore','scifi'],
  rebel_algorithm:['normal_battle','scifi'], ruins_of_tomorrow:['explore','scifi'],
  dream_of_ai:['chill','scifi'], high_speed_chase_2099:['tension','scifi'],
  // ── horror ──
  memory_of_ruins:['explore','horror'], something_is_here:['tension','horror'],
  prelude_to_carnage:['tension','horror'], nightmare_gate:['explore','horror'],
  spirit_footage_analysis:['explore','horror'], run_for_your_life:['tension','horror'],
  midnight_ward:['explore','horror'], the_ritual_night:['tension','horror'],
  // ── rpg-battle（シネマティック）──
  return_to_the_capital:['daily','fantasy'], blade_of_fate:['normal_battle','fantasy'],
  guardian_of_the_abyss:['boss_battle','fantasy'], the_last_fortress:['normal_battle','fantasy'],
  heros_proof:['climax','fantasy'], overture_of_ruin:['boss_battle','fantasy'],
  forgotten_temple:['explore','fantasy'], twilight_of_the_kingdom:['emotional','fantasy'],
  dawn_of_the_final_battle:['climax','fantasy'], a_new_horizon:['emotional','fantasy'],
  // ── vlog-cafe ──
  sunset_pasta:['chill','lofi'], weekend_market:['daily','lofi'], dessert_night:['chill','lofi'],
  morning_smoothie:['daily','lofi'], afternoon_kitchen:['chill','lofi'],
  window_seat_coffee:['chill','lofi'], sunday_morning_routine:['chill','lofi'],
  city_walk:['daily','lofi'], first_apartment:['daily','lofi'], seoul_cafe_afternoon:['chill','lofi'],
  // ── hebi_santos（都市RPG）──
  daily_bakery:['daily','modern'], chiefs_office:['daily','modern'],
  empires_shadow:['tension','modern'], silk_and_poison:['tension','modern'],
  drifting_green:['explore','modern'], silent_stall:['tension','modern'],
  taxi_cruise:['daily','modern'], conspiracy_unfolds:['tension','modern'],
  hebi_santos_radio:['daily','modern'], tears_in_the_city:['emotional','modern'],
  // ── sleep / focus / relax ──
  deep_sleep_river:['chill','lofi'], moonlit_forest_sleep:['chill','lofi'],
  rain_on_window:['chill','lofi'], ocean_drift_sleep:['chill','lofi'], baby_lullaby_dreams:['chill','lofi'],
  focus_zone_alpha:['chill','lofi'], cafe_study_session:['chill','lofi'], midnight_coding:['chill','lofi'],
  study_beats_lofi:['chill','lofi'], productivity_timer:['chill','lofi'],
  morning_yoga_flow:['chill','wafu'], hot_spring_healing:['chill','wafu'],
  fireplace_reading:['chill','lofi'], desk_workout_energy:['daily','lofi'], night_drive_ambient:['chill','lofi'],
  // ── modern_ability（新規：現代異能・都市）──
  ma_awakening_hour:['normal_battle','modern'], ma_crossfire:['normal_battle','modern'],
  ma_shadow_of_the_abyss:['boss_battle','modern'], ma_the_turning_point:['climax','modern'],
  ma_creeping_presence:['explore','modern'], ma_midnight_pursuit:['tension','modern'],
  ma_secret_pact:['tension','modern'], ma_afternoon_classroom:['daily','modern'],
  ma_neon_way_home:['chill','modern'], ma_the_briefing:['daily','modern'],
  ma_quiet_resolve:['emotional','modern'], ma_what_was_lost:['emotional','modern'],
};

// カテゴリ名 → デフォルト分類（SCENE_CLASS に無い場合のフォールバック）
const CATEGORY_FALLBACK = {
  'CoC探索':['explore','horror'],'CoC恐怖':['tension','horror'],
  'ファンタジー街':['daily','fantasy'],'ファンタジーDG':['explore','fantasy'],
  '和風ファンタジー':['explore','wafu'],'学園異能':['daily','modern'],
  '待機画面':['chill','lofi'],'深夜配信':['chill','lofi'],'朝配信':['chill','lofi'],
  '導入・イントロ':['comical','lofi'],'解説・語り':['chill','lofi'],'演出・ブリッジ':['tension','lofi'],'バラエティ':['comical','lofi'],
  'ストリート':['daily','scifi'],'サイバースペース':['tension','scifi'],'宇宙・SF':['chill','scifi'],
  '探索・雰囲気':['explore','horror'],'クライマックス':['tension','horror'],'超常現象':['explore','horror'],
  'フィールド':['daily','fantasy'],'バトル':['normal_battle','fantasy'],'ボスバトル':['boss_battle','fantasy'],'ダンジョン':['explore','fantasy'],'エンディング':['emotional','fantasy'],
  '料理・キッチン':['chill','lofi'],'お出かけ':['daily','lofi'],'ルーティン':['daily','lofi'],'カフェ':['chill','lofi'],
  '日常シーン':['daily','modern'],'緊迫シーン':['tension','modern'],'探索シーン':['explore','modern'],'移動シーン':['daily','modern'],'感傷シーン':['emotional','modern'],
  '睡眠導入':['chill','lofi'],'子守唄':['chill','lofi'],'集中':['chill','lofi'],
  'ヨガ・瞑想':['chill','wafu'],'くつろぎ':['chill','lofi'],'エクササイズ':['daily','lofi'],
  '戦闘・覚醒':['normal_battle','modern'],'緊迫・侵蝕':['tension','modern'],'都市・日常':['daily','modern'],'感傷・喪失':['emotional','modern'],
};

// ── COLLECTIONS を統合トラック配列へ ──
function buildUnifiedTracks() {
  const out = [];
  const cols = (typeof COLLECTIONS !== 'undefined') ? COLLECTIONS : {};
  for (const cid in cols) {
    const col = cols[cid];
    (col.scenes || []).forEach(sc => {
      const audioFolder = sc.audio_folder || col.audio_folder;
      const audioFile = sc.audio || sc.audio_v1 || null;
      if (!audioFile) return; // 音源なしは除外
      const imgFolder = sc.image_subdir || col.image_subdir || col.audio_folder;
      const cls = SCENE_CLASS[sc.id] || CATEGORY_FALLBACK[sc.category] || ['daily','lofi'];
      out.push({
        id: sc.id,
        title: sc.name,
        titleEn: sc.nameEn || '',
        collection: cid,
        collectionTitle: col.title,
        desc: sc.desc || '',
        style: sc.bgmStyle || '',
        sceneTag: cls[0],
        moodTag: cls[1],
        audio: `assets/audio/${audioFolder}/${audioFile}`,
        audioV2: sc.audio_v2 ? `assets/audio/${audioFolder}/${sc.audio_v2}` : null,
        image: sc.image ? `assets/images/${imgFolder}/${sc.image}` : null,
        status: sc.status || 'ready',
      });
    });
  }
  return out;
}

const UNIFIED_TRACKS = buildUnifiedTracks();
