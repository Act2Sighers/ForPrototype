// ダンジョンのメタデータ（id/name）だけを持つ。マップ構造（マス配置・
// 経路・マス種別）自体はもう静的データではなく、挑戦開始のたびに
// dungeonGenerator.jsがランダム生成する（state.jsのstartNewRun参照）。

export const DIFFICULTIES = [{ id: "normal", name: "ノーマル" }];

export const DUNGEONS = [{ id: "test-dungeon", name: "テストダンジョン" }];

// The world screen's destination list: 王城 (a non-dungeon "location"
// that just opens the gallery) plus every dungeon. Kept separate from
// DUNGEONS since the castle isn't dungeon data.
export const WORLD_LOCATIONS = [
  { id: "castle", name: "王城", kind: "castle" },
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
