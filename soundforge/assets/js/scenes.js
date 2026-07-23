/**
 * シーンデータ定義 — 現代学生生活コレクション
 */
const COLLECTIONS = {
  "student-life": {
    id: "student-life",
    title: "現代学生生活",
    titleEn: "Modern Student Life",
    description: "ストーリー動画・ゲーム向け。学校・街・日常の汎用背景+BGMセット",
    scenes: [
      {
        id: "bedroom-morning",
        name: "自室（朝）",
        nameEn: "Bedroom - Morning",
        desc: "朝日が差し込む学生の部屋。目覚ましが鳴り、新しい一日が始まる",
        bgmStyle: "穏やかなアコースティックギター",
        image: "bedroom-morning.png",
        audio: "bedroom-morning.mp3",
        status: "ready"
      },
      {
        id: "bedroom-night",
        name: "自室（夜）",
        nameEn: "Bedroom - Night",
        desc: "デスクライトに照らされた勉強机。静かな夜の自室",
        bgmStyle: "Lo-Fi チルビート",
        image: "bedroom-night.png",
        audio: "bedroom-night.mp3",
        status: "ready"
      },
      {
        id: "living-room",
        name: "リビング",
        nameEn: "Living Room",
        desc: "テレビやソファのある一般的な家庭のリビング",
        bgmStyle: "温かいピアノとストリングス",
        image: "living-room.png",
        audio: "living-room.mp3",
        status: "ready"
      },
      {
        id: "commute-morning",
        name: "通学路（朝）",
        nameEn: "School Commute - Morning",
        desc: "桜並木や住宅街を抜ける朝の通学路",
        bgmStyle: "爽やかなポップ・アコースティック",
        image: "commute-morning.png",
        audio: "commute-morning.mp3",
        status: "ready"
      },
      {
        id: "commute-evening",
        name: "通学路（夕方）",
        nameEn: "School Commute - Evening",
        desc: "夕焼けに染まる帰り道。長い影が伸びる",
        bgmStyle: "ノスタルジックなアコースティックギター",
        image: "commute-evening.png",
        audio: "commute-evening.mp3",
        status: "ready"
      },
      {
        id: "classroom",
        name: "教室",
        nameEn: "Classroom",
        desc: "机と椅子が並ぶ標準的な学校の教室。黒板と窓",
        bgmStyle: "軽やかな日常系BGM",
        image: "classroom.png",
        audio: "classroom.mp3",
        status: "ready"
      },
      {
        id: "school-hallway",
        name: "学校・廊下",
        nameEn: "School Hallway",
        desc: "長く続く校舎の廊下。窓から光が差し込む",
        bgmStyle: "静かなアンビエント",
        image: "school-hallway.png",
        audio: "school-hallway.mp3",
        status: "ready"
      },
      {
        id: "school-rooftop",
        name: "学校・屋上",
        nameEn: "School Rooftop",
        desc: "フェンスに囲まれた屋上。青空と街並みが見える",
        bgmStyle: "開放的なシンセポップ",
        image: "school-rooftop.png",
        audio: "rooftop_sky_v1.mp3",
        status: "ready"
      },
      {
        id: "school-library",
        name: "図書室",
        nameEn: "School Library",
        desc: "本棚に囲まれた静かな図書室。柔らかい光",
        bgmStyle: "静かなピアノソロ",
        image: "school-library.png",
        audio: "quiet_library_v1.mp3",
        status: "ready"
      },
      {
        id: "club-room",
        name: "部室",
        nameEn: "Club Room",
        desc: "雑然とした部活動の部室。ホワイトボードとパイプ椅子",
        bgmStyle: "カジュアルなジャズ",
        image: "club-room.png",
        audio: "club_room_jazz_v1.mp3",
        status: "ready"
      },
      {
        id: "school-gate",
        name: "校門前",
        nameEn: "School Gate",
        desc: "校門と校舎の外観。登下校の場面",
        bgmStyle: "明るいマーチ風",
        image: "school-gate.png",
        audio: "school_gate_morning_v1.mp3",
        status: "ready"
      },
      {
        id: "school-gym",
        name: "体育館",
        nameEn: "School Gymnasium",
        desc: "広い体育館。バスケットゴールとステージ",
        bgmStyle: "アップテンポなロック",
        image: "school-gym.png",
        audio: "gym_energy_v1.mp3",
        status: "ready"
      },
      {
        id: "shopping-street",
        name: "商店街",
        nameEn: "Shopping Street",
        desc: "アーケード付きの商店街。様々な店が並ぶ",
        bgmStyle: "にぎやかで楽しいBGM",
        image: "shopping-street.png",
        audio: "shopping_arcade_v1.mp3",
        status: "ready"
      },
      {
        id: "convenience-store",
        name: "コンビニ",
        nameEn: "Convenience Store",
        desc: "明るい照明のコンビニエンスストア内部",
        bgmStyle: "ポップなエレクトロ",
        image: "convenience-store.png",
        audio: "convenience_store_nights_v1.mp3",
        status: "ready"
      },
      {
        id: "fast-food",
        name: "ファーストフード店",
        nameEn: "Fast Food Restaurant",
        desc: "カラフルな内装のファーストフード店。窓際の席",
        bgmStyle: "チルホップ・LoFi",
        image: "fast-food.png",
        audio: "fast_food_lounge_v1.mp3",
        status: "ready"
      },
      {
        id: "park",
        name: "公園",
        nameEn: "Park",
        desc: "ベンチと遊具のある緑豊かな公園",
        bgmStyle: "アコースティックギターとフルート",
        image: "park.png",
        audio: "park_afternoon_v1.mp3",
        status: "ready"
      },
      {
        id: "riverbank",
        name: "河川敷",
        nameEn: "Riverbank",
        desc: "広い河川敷。土手の上の道と遠くの橋",
        bgmStyle: "ゆったりしたアンビエント",
        image: "riverbank.png",
        audio: "riverbank_wind_v1.mp3",
        status: "ready"
      },
      {
        id: "train-station",
        name: "駅前",
        nameEn: "Train Station Area",
        desc: "駅前ロータリーとバス停。人通りの多い場所",
        bgmStyle: "都会的なエレクトロポップ",
        image: "train-station.png",
        audio: "station_plaza_v1.mp3",
        status: "ready"
      },
      {
        id: "cafe",
        name: "カフェ",
        nameEn: "Cafe",
        desc: "落ち着いた雰囲気のカフェ。木の内装とコーヒーの香り",
        bgmStyle: "ジャズピアノトリオ",
        image: "cafe.png",
        audio: "cafe_reverie_v1.mp3",
        status: "ready"
      },
      {
        id: "night-town",
        name: "夜の街",
        nameEn: "Night Town",
        desc: "街灯とネオンに照らされた夜の通り",
        bgmStyle: "ムーディーなシンセウェーブ",
        image: "night-town.png",
        audio: "neon_night_town_v1.mp3",
        status: "ready"
      }
    ]
  }
};
