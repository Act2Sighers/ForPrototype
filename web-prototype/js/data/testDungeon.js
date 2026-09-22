// ダンジョンのメタデータ（id/name）だけを持つ。マップ構造（マス配置・
// 経路・マス種別）自体はもう静的データではなく、挑戦開始のたびに
// dungeonGenerator.jsがランダム生成する（state.jsのstartNewRun参照）。
//
// ダンジョンパラメータ（休憩発生クロック・行商発生回数など）も同様に
// 「ダンジョンごとの固定値」ではなく、挑戦開始前にプレイヤーが選ぶ
// 難易度(D)と最深部の深度(=最長到達マス数、L)から毎回algorithmically
// 算出する（computeDungeonParams参照）。生成結果はstate.run.dungeonParams
// にそのまま保持され、以後そのランを通じて固定される。

// 難易度：内部数値(value)がボスレベル・行商発生回数・雇用候補者/
// モンスターのレベル算出式の全てに使われる（D）。旧仕様で唯一存在した
// 「ノーマル」は、新仕様では最も易しい「イージー」に相当する。
export const DIFFICULTIES = [
  { id: "easy", name: "イージー", value: 1 },
  { id: "normal", name: "ノーマル", value: 2 },
  { id: "hard", name: "ハード", value: 3 },
];

// 最深部の深度：選んだ値がそのまま最長到達マス数（L=M）になる。挑戦
// 開始前、難易度と並んでワールド画面で選択する（world.js参照）。
export const DEPTHS = [
  { id: "depth12", name: "12C", maxReachableNodeCount: 12 },
  { id: "depth24", name: "24C", maxReachableNodeCount: 24 },
  { id: "depth36", name: "36C", maxReachableNodeCount: 36 },
];

export const DUNGEONS = [{ id: "test-dungeon", name: "テストダンジョン" }];

// 休憩発生クロック：5刻みで、[最長到達マス数-2]以下の値まで（この配列に
// 含まれる各列番号CについてC列とC+1列の間に休憩イベントの機会が生まれる
// -- map.js参照）。
function buildRestClock(longestReachableNodeCount) {
  const clock = [];
  for (let c = 5; c <= longestReachableNodeCount - 2; c += 5) clock.push(c);
  return clock;
}

// ダンジョンパラメータの一般化：難易度D・最深部の深度Lから、その1回の
// ランを通じて固定のパラメータ一式を算出する（state.jsのstartNewRunが
// 呼び、結果をstate.run.dungeonParamsに保持する）。
//  - longestReachableNodeCount: 選んだ深度の値そのまま。
//  - restClock: buildRestClock参照。
//  - peddlerCount: 行商"最大"発生回数の目標値（D+2）。最長到達マス数の
//    関係で目標達成が不可能なこともあり得る（map.js側の発生条件任せ）。
//  - difficultyValue: D自体。ボスレベル算出（computeBossLevel）と、
//    雇用候補者/モンスターのレベル算出（resourceCatalog.jsの
//    computeProgressLevel）の両方で使う。
//  - environment: ダンジョンの環境（探索イベントの能力値補正などに
//    使う想定、現状は空実装で"normal"のみ）。
export function computeDungeonParams(difficultyId, depthId) {
  const difficulty = DIFFICULTIES.find((d) => d.id === difficultyId);
  const depth = DEPTHS.find((d) => d.id === depthId);
  const longestReachableNodeCount = depth.maxReachableNodeCount;
  return {
    longestReachableNodeCount,
    restClock: buildRestClock(longestReachableNodeCount),
    peddlerCount: difficulty.value + 2,
    difficultyValue: difficulty.value,
    environment: "normal",
  };
}

// ボス戦のタケニニテイルのレベル：D×M+3（M=longestReachableNodeCount）。
// 難易度D=1（イージー）・最長到達マス数M=12（12C）の組み合わせでLv.15
// になる（旧仕様の固定値と一致）。
export function computeBossLevel(difficultyValue, longestReachableNodeCount) {
  return difficultyValue * longestReachableNodeCount + 3;
}

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
