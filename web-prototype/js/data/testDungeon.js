// ダンジョンのメタデータ（id/name）だけを持つ。マップ構造（マス配置・
// 経路・マス種別）自体はもう静的データではなく、挑戦開始のたびに
// dungeonGenerator.jsがランダム生成する（state.jsのstartNewRun参照）。

export const DIFFICULTIES = [{ id: "normal", name: "ノーマル" }];

export const DUNGEONS = [{ id: "test-dungeon", name: "テストダンジョン" }];

// ダンジョンパラメータ：ランダム生成に左右されない、ダンジョンごとの
// 固定設定。
//  - longestReachableNodeCount: 最長到達マス数（X）。dungeonGenerator.js
//    が経路生成の列数として使う。
//  - restClock: 休憩発生クロック。この配列に含まれる各列番号Cについて、
//    C列とC+1列の間に休憩イベントの機会が生まれる（map.js参照）。
//  - peddlerCount: 1回のランで必ず発生させる行商イベントの回数。
//  - environment: ダンジョンの環境（探索イベントの能力値補正などに
//    使う想定、現状は空実装で"normal"のみ）。
//  - bossEncounter: ゴールマスで戦闘（ボス戦モード）を呼ぶ際の固定の敵
//    構成（battle.js参照）。各エントリは{dataId, isBoss}（ボス本体、
//    resourceCatalog.jsのBOSS_MONSTER_DATAから固定の最終能力値で生成）
//    または{dataId, level}（道連れの通常モンスター、MONSTER_DATAの
//    Lv.1テンプレートから指定レベルまでランダムにレベルアップさせて
//    生成）のどちらか。
export const DUNGEON_PARAMS = {
  "test-dungeon": {
    longestReachableNodeCount: 12,
    restClock: [5, 10],
    peddlerCount: 2,
    environment: "normal",
    bossEncounter: [
      { dataId: "takeniniteiru", isBoss: true },
      { dataId: "karumeDog", level: 12 },
      { dataId: "merengeCat", level: 12 },
      { dataId: "electricJelly", level: 12 },
    ],
  },
};

// The world screen's destination list: 王城 (a non-dungeon "location"
// that just opens the gallery), 宿舎 (opens 探査記録画面, js/scenes/
// archive.js) plus every dungeon. Kept separate from DUNGEONS since
// neither the castle nor the dormitory is dungeon data.
export const WORLD_LOCATIONS = [
  { id: "castle", name: "王城", kind: "castle" },
  { id: "dormitory", name: "宿舎", kind: "dormitory" },
  ...DUNGEONS.map((d) => ({ id: d.id, name: d.name, kind: "dungeon" })),
];

// Node type -> the scene that gets called when the player steps on it,
// for the node types that need no extra params. "start"/"goal"/"episode"
// (script differs from the goal's own) and "village"/"workshop"/"snack"
// (each needs a params.mode -- village/workshop pick their own trade
// mode, snack picks a random 軽食 store mode) are all special-cased
// directly in map.js's handleNodeClick instead of going through this
// table.
export const EVENT_SCENE_BY_NODE_TYPE = {
  battle: "battle",
  exploration: "exploration",
};
