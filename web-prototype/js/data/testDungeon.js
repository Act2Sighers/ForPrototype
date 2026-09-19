// Minimal test dungeon, 8 nodes across 4 layers:
//  ①start -> [②village, ③snack, ④workshop]
//  ②village -> [⑤battle, ⑥exploration]
//  ③snack -> [⑥exploration, ⑦episode]
//  ④workshop -> [⑤battle, ⑦episode]
//  [⑤battle, ⑥exploration, ⑦episode] -> ⑧goal
// Start and goal intentionally carry no event yet, matching the current
// spec (ボス戦 -- a real event on the goal square -- comes later).
//
// x/y are plain SVG coordinates for the map screen, not gameplay data.

export const TEST_DUNGEON = {
  id: "test-dungeon",
  name: "テストダンジョン",
  nodes: {
    start: { id: "start", type: "start", label: "スタート", x: 60, y: 200 },
    village: { id: "village", type: "village", label: "集落", x: 230, y: 70 },
    snack: { id: "snack", type: "snack", label: "軽食", x: 230, y: 200 },
    workshop: { id: "workshop", type: "workshop", label: "工房", x: 230, y: 330 },
    battle: { id: "battle", type: "battle", label: "戦闘", x: 430, y: 70 },
    exploration: { id: "exploration", type: "exploration", label: "探索", x: 430, y: 200 },
    episode: { id: "episode", type: "episode", label: "遭遇", x: 430, y: 330 },
    goal: { id: "goal", type: "goal", label: "ゴール", x: 580, y: 200 },
  },
  edges: {
    start: ["village", "snack", "workshop"],
    village: ["battle", "exploration"],
    snack: ["exploration", "episode"],
    workshop: ["battle", "episode"],
    battle: ["goal"],
    exploration: ["goal"],
    episode: ["goal"],
    goal: [],
  },
};

export const DIFFICULTIES = [{ id: "normal", name: "ノーマル" }];

export const DUNGEONS = [{ id: "test-dungeon", name: "テストダンジョン", data: TEST_DUNGEON }];

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id)?.data ?? null;
}

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
