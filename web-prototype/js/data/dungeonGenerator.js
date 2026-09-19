// ランダムダンジョン生成。2段階で組み立てる：
//  ①経路生成 (buildRouteLayout): 列(縦の位置)ごとにマス数を決め、
//    隣接列同士を「経路の横断が起きない、かつ全マスが入口/出口を
//    最低1つ持つ」形で結ぶ。
//  ②マス種別割り当て (findNodeTypeAssignment): ①で確定した経路構造
//    （スタート/ゴールを除く中間マスのみ）に、割合と隣接条件を満たす
//    ようバックトラック探索で種別を割り振る。
//
// generateDungeon()がこの2段階をまとめて呼び、state.js の startNewRun
// が呼び出す想定（生成結果は state.run.dungeon にそのまま保持され、
// map.js が testDungeon.js の静的マップだった頃と同じ形
// {id, name, nodes, edges} で消費する）。

// 最長到達マス数（X、スタート+ゴールを含む列数）。中間列数は常に
// LONGEST_REACHABLE_NODE_COUNT - 2。
const LONGEST_REACHABLE_NODE_COUNT = 16;
const MIDDLE_COLUMN_COUNT = LONGEST_REACHABLE_NODE_COUNT - 2;
const ROW_COUNT_MIN = 2;
const ROW_COUNT_MAX = 4;
// マス同士の縦方向の間隔（列のマス数によらず常に一定にする）。
const ROW_SPACING = 90;

const NON_BATTLE_TYPES = ["exploration", "episode", "village", "snack", "workshop"];

const NODE_TYPE_LABELS = {
  battle: "戦闘",
  exploration: "探索",
  episode: "遭遇",
  village: "集落",
  snack: "軽食",
  workshop: "工房",
};

function shuffledCopy(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickRandomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// -----------------------------------------------------------------------
// ①経路生成
// -----------------------------------------------------------------------

// 2列目〜X-1列目（中間列）のマス数を決める。2列目とX-1列目（＝中間列の
// 先頭と末尾）はそれぞれ独立に2〜4のランダムで決め、その間の列は
// 「隣の列との差が1以内」を保ちながら、必ずX-1列目の値にちょうど
// たどり着くようランダムに橋渡しする（残り列数的に間に合う候補だけを
// 毎回ランダムに選ぶので、途中の値も偏りなくランダムになる）。
function generateColumnSizes() {
  const first = pickRandomInt(ROW_COUNT_MIN, ROW_COUNT_MAX);
  const last = pickRandomInt(ROW_COUNT_MIN, ROW_COUNT_MAX);
  const sizes = new Array(MIDDLE_COLUMN_COUNT);
  sizes[0] = first;
  sizes[MIDDLE_COLUMN_COUNT - 1] = last;

  for (let i = 1; i < MIDDLE_COLUMN_COUNT - 1; i++) {
    const cur = sizes[i - 1];
    const remainingSteps = MIDDLE_COLUMN_COUNT - 1 - i; // このあと最終列まで残っている辺の数
    const candidates = [];
    for (let c = Math.max(ROW_COUNT_MIN, cur - 1); c <= Math.min(ROW_COUNT_MAX, cur + 1); c++) {
      if (Math.abs(last - c) <= remainingSteps) candidates.push(c);
    }
    sizes[i] = candidates[Math.floor(Math.random() * candidates.length)];
  }
  return sizes;
}

// total を parts 個の正の整数に分割する（合計は必ず total、各要素は
// 1以上）。stars and bars：まず全部1で埋め、余りをランダムな要素に
// 1ずつ足していく。
function pickRandomComposition(total, parts) {
  const sizes = new Array(parts).fill(1);
  let remaining = total - parts;
  while (remaining > 0) {
    sizes[Math.floor(Math.random() * parts)] += 1;
    remaining -= 1;
  }
  return sizes;
}

// 隣接する2列（ノードidの配列、上から下の順）を、経路の横断が起きない
// 形で結ぶ。小さい方の列を1本、大きい方の列をまとめて受ける片方向の
// 扇形分割：
//  - colAの方が少ない（または同数）: colBをcolA個の正整数に分割し、
//    colAの各ノードがその分だけ連続した範囲のcolBノードへ経路を持つ。
//  - colAの方が多い: colAをcolB個の正整数に分割し、colBの各ノードが
//    その分だけ連続した範囲のcolAノードから経路を受ける（＝colA側の
//    各ノードの出口はちょうど1本になる）。
// どちらの場合も先頭ブロックは必ずcolB[0]/colA[0]を含み、末尾ブロック
// は必ずcolB末尾/colA末尾を含むので、「最も上のマス同士」「最も下の
// マス同士」が必ず繋がる、という要件も特別扱いなしに自然に満たされる。
// start(1個)→中間列、中間列→goal(1個)の境界もこの関数だけで処理できる
// （どちらか一方が1個の場合として自然に含まれるため）。
function connectColumns(colA, colB, edges) {
  if (colA.length <= colB.length) {
    const sizes = pickRandomComposition(colB.length, colA.length);
    let cursor = 0;
    colA.forEach((aId, i) => {
      edges[aId] = colB.slice(cursor, cursor + sizes[i]);
      cursor += sizes[i];
    });
  } else {
    const sizes = pickRandomComposition(colA.length, colB.length);
    let cursor = 0;
    colB.forEach((bId, j) => {
      for (const aId of colA.slice(cursor, cursor + sizes[j])) {
        edges[aId].push(bId);
      }
      cursor += sizes[j];
    });
  }
}

// x/yはSVG座標（map.jsのviewBox "0 0 640 400"に合わせる）。yは常に
// y=200を中心に、列のマス数によらず隣接マス同士の間隔がROW_SPACING固定
// になるよう配置する（1個だけの列＝スタート/ゴールは自然にy=200になる）。
function buildRouteLayout() {
  const columnSizes = generateColumnSizes();
  const totalColumns = columnSizes.length + 2;
  const xStep = 520 / (totalColumns - 1);
  const xFor = (colIndex) => 60 + colIndex * xStep;
  const yFor = (rowIndex, rowCount) => 200 + (rowIndex - (rowCount - 1) / 2) * ROW_SPACING;

  const nodes = {};
  const edges = {};
  const columns = [];

  nodes.start = { id: "start", type: "start", label: "スタート", x: xFor(0), y: 200 };
  edges.start = [];
  columns.push(["start"]);

  columnSizes.forEach((size, ci) => {
    const colIds = [];
    for (let r = 0; r < size; r++) {
      const id = `col${ci}_row${r}`;
      nodes[id] = { id, type: null, x: xFor(ci + 1), y: yFor(r, size) };
      edges[id] = [];
      colIds.push(id);
    }
    columns.push(colIds);
  });

  nodes.goal = { id: "goal", type: "goal", label: "ゴール", x: xFor(totalColumns - 1), y: 200 };
  edges.goal = [];
  columns.push(["goal"]);

  for (let i = 0; i < columns.length - 1; i++) {
    connectColumns(columns[i], columns[i + 1], edges);
  }

  return { nodes, edges, columns };
}

// -----------------------------------------------------------------------
// ②マス種別割り当て
// -----------------------------------------------------------------------

function buildReverseEdges(edges) {
  const reverse = {};
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      reverse[to] = reverse[to] ?? [];
      reverse[to].push(from);
    }
  }
  return reverse;
}

// 戦闘battleCount個＋残りを非戦闘5種でなるべく均等に分けた「割り当て
// 予定種別の袋」を作る（合計は必ずnodeCount個）。
function buildTypeBag(nodeCount, battleCount) {
  const remaining = nodeCount - battleCount;
  const base = Math.floor(remaining / NON_BATTLE_TYPES.length);
  const extra = remaining - base * NON_BATTLE_TYPES.length;
  const counts = { battle: battleCount };
  for (const type of NON_BATTLE_TYPES) counts[type] = base;
  for (const type of shuffledCopy(NON_BATTLE_TYPES).slice(0, extra)) counts[type] += 1;

  const bag = [];
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) bag.push(type);
  }
  return bag;
}

// nodeIdに種別typeを割り当てても良いか（既に確定済みのassignedと、逆
// 辺reverseEdgesから見た「1つ前のマス」「2つ前のマス」との関係だけで
// 判定できる -- 列順（トポロジカル順）に割り当てていくので、判定に
// 必要な先行マスは必ず判定時点で確定済み）：
//  - 戦闘: 直前が戦闘、かつその直前も戦闘なら（3連続になる）NG。
//  - 非戦闘各種: 直前(距離1)・2つ前(距離2、経由マス問わず)のいずれかに
//    同じ種別があればNG。
//  - 集落⇔軽食: 直前(距離1)がもう片方ならNG（距離2は対象外）。
function violatesConstraints(nodeId, type, assigned, reverseEdges) {
  const parents = reverseEdges[nodeId] ?? [];

  if (type === "battle") {
    return parents.some((p) => {
      if (assigned[p] !== "battle") return false;
      const grandparents = reverseEdges[p] ?? [];
      return grandparents.some((gp) => assigned[gp] === "battle");
    });
  }

  if (parents.some((p) => assigned[p] === type)) return true;
  const grandparents = parents.flatMap((p) => reverseEdges[p] ?? []);
  if (grandparents.some((gp) => assigned[gp] === type)) return true;

  const forbiddenNeighbor = type === "village" ? "snack" : type === "snack" ? "village" : null;
  if (forbiddenNeighbor && parents.some((p) => assigned[p] === forbiddenNeighbor)) return true;

  return false;
}

function countBag(bag) {
  const counts = {};
  for (const type of bag) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}

// nodeIds（列順に並んだ中間マスid列）にbag（種別の多重集合）を割り振る、
// 貪欲＋丸ごとやり直し方式。制約がどれも「直前1〜2マスだけ」を見る局所
//的なものなので、各マスで残数があり制約に反しない種別からランダムに
// 1つ選ぶだけの1回の線形走査で、ほとんどの場合そのまま最後まで到達
// できる。途中で（残数はあるが全滴制約に反して）詰んだ場合は、そこだけ
// 戻ってやり直すのではなくnullを返し、呼び出し元にbag全体を仕切り直し
// てもらう -- 中間マスが最大56個にもなるため、厳密なバックトラック探索
// は最悪ケースで組み合わせ爆発を起こす一方、局所的な制約であればこの
// 「引き直し」の方が実用上ずっと速く、かつ十分な回数試せば高確率で
// 見つかる。
function tryAssign(nodeIds, bag, reverseEdges) {
  const remaining = countBag(bag);
  const assigned = {};
  for (const nodeId of nodeIds) {
    const candidates = Object.keys(remaining).filter(
      (type) => remaining[type] > 0 && !violatesConstraints(nodeId, type, assigned, reverseEdges)
    );
    if (candidates.length === 0) return null;
    const type = candidates[Math.floor(Math.random() * candidates.length)];
    assigned[nodeId] = type;
    remaining[type] -= 1;
  }
  return assigned;
}

const ASSIGN_ATTEMPTS_PER_BAG = 40;

// 戦闘の目標比率5割から±0〜4個ずらした候補を近い順に試す（割合はご本人
// も「厳密な理由はない」とのことなので、この経路構造では厳密な5割が
// 収まらない場合に備えた幅として扱う）。どの候補でも見つからなければ
// nullを返し、呼び出し元（generateDungeon）に経路そのものの作り直しを
// 促す。
function findNodeTypeAssignment(columns, edges) {
  const reverseEdges = buildReverseEdges(edges);
  const middleNodeIds = columns.slice(1, -1).flat();
  const n = middleNodeIds.length;
  const baseBattle = Math.round(n / 2);

  for (const delta of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const battleCount = baseBattle + delta;
    if (battleCount < 0 || battleCount > n) continue;
    const bag = buildTypeBag(n, battleCount);
    for (let attempt = 0; attempt < ASSIGN_ATTEMPTS_PER_BAG; attempt++) {
      const assigned = tryAssign(middleNodeIds, bag, reverseEdges);
      if (assigned) return assigned;
    }
  }
  return null;
}

// -----------------------------------------------------------------------

const MAX_ROUTE_ATTEMPTS = 50;

export function generateDungeon({ id, name }) {
  for (let attempt = 0; attempt < MAX_ROUTE_ATTEMPTS; attempt++) {
    const { nodes, edges, columns } = buildRouteLayout();
    const assignment = findNodeTypeAssignment(columns, edges);
    if (!assignment) continue;
    for (const [nodeId, type] of Object.entries(assignment)) {
      nodes[nodeId].type = type;
      nodes[nodeId].label = NODE_TYPE_LABELS[type];
    }
    return { id, name, nodes, edges };
  }
  throw new Error("generateDungeon: failed to generate a valid map after many attempts");
}
