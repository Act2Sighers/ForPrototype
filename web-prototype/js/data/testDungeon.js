// Minimal test dungeon: start -> (battle / exploration / trade / episode)
// branch -> converge on goal. Start and goal intentionally carry no event
// yet, matching the current spec.
//
// x/y are plain SVG coordinates for the map screen, not gameplay data.

export const TEST_DUNGEON = {
  id: "test-dungeon",
  name: "テストダンジョン",
  nodes: {
    start: { id: "start", type: "start", label: "スタート", x: 60, y: 200 },
    battle: { id: "battle", type: "battle", label: "戦闘", x: 320, y: 60 },
    exploration: { id: "exploration", type: "exploration", label: "探索", x: 320, y: 153 },
    trade: { id: "trade", type: "trade", label: "取引", x: 320, y: 246 },
    episode: { id: "episode", type: "episode", label: "遭遇", x: 320, y: 340 },
    goal: { id: "goal", type: "goal", label: "ゴール", x: 580, y: 200 },
  },
  edges: {
    start: ["battle", "exploration", "trade", "episode"],
    battle: ["goal"],
    exploration: ["goal"],
    trade: ["goal"],
    episode: ["goal"],
    goal: [],
  },
};

export const DIFFICULTIES = [{ id: "normal", name: "ノーマル" }];

export const DUNGEONS = [{ id: "test-dungeon", name: "テストダンジョン", data: TEST_DUNGEON }];

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id)?.data ?? null;
}

// Node type -> the scene that gets called when the player steps on it.
// "start" and "goal" are handled specially by the map scene itself.
export const EVENT_SCENE_BY_NODE_TYPE = {
  battle: "battle",
  exploration: "exploration",
  trade: "trade",
  episode: "episode",
};
