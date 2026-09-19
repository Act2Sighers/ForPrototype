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

const MIDDLE_COLUMN_COUNT_MIN = 2;
const MIDDLE_COLUMN_COUNT_MAX = 4;
const ROW_COUNT_MIN = 2;
const ROW_COUNT_MAX = 4;

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

// 2列目〜X-1列目（中間列）のマス数を決める：1列目は2〜4のランダム、
// 以降は直前の列との差が1以内になるよう2〜4のランダムで続ける。
function generateColumnSizes() {
  const columnCount = pickRandomInt(MIDDLE_COLUMN_COUNT_MIN, MIDDLE_COLUMN_COUNT_MAX);
  const sizes = [pickRandomInt(ROW_COUNT_MIN, ROW_COUNT_MAX)];
  for (let i = 1; i < columnCount; i++) {
    const prev = sizes[i - 1];
    const lo = Math.max(ROW_COUNT_MIN, prev - 1);
    const hi = Math.min(ROW_COUNT_MAX, prev + 1);
    sizes.push(pickRandomInt(lo, hi));
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

// x/yはSVG座標（map.jsのviewBox "0 0 640 400"に合わせる）。行数が1個
// の列（スタート/ゴール）は常にy=200固定、複数マスの列は60〜340の範囲
// に均等割り。
function buildRouteLayout() {
  const columnSizes = generateColumnSizes();
  const totalColumns = columnSizes.length + 2;
  const xStep = 520 / (totalColumns - 1);
  const xFor = (colIndex) => 60 + colIndex * xStep;
  const yFor = (rowIndex, rowCount) => (rowCount === 1 ? 200 : 60 + rowIndex * (280 / (rowCount - 1)));

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

// nodeIds（列順に並んだ中間マスid列）にremainingBag（種別の多重集合）
// を過不足なく割り振る、完全なバックトラック探索。各マスで残っている
// 種別を（ランダム順で）片っ端から試し、制約を満たすものが見つかれば
// 次のマスへ進み、行き詰まれば1つ戻ってやり直す。
function backtrackAssign(index, nodeIds, remainingBag, assigned, reverseEdges) {
  if (index === nodeIds.length) return true;
  const nodeId = nodeIds[index];
  for (const type of shuffledCopy([...new Set(remainingBag)])) {
    if (violatesConstraints(nodeId, type, assigned, reverseEdges)) continue;
    const bagIndex = remainingBag.indexOf(type);
    const nextBag = [...remainingBag.slice(0, bagIndex), ...remainingBag.slice(bagIndex + 1)];
    assigned[nodeId] = type;
    if (backtrackAssign(index + 1, nodeIds, nextBag, assigned, reverseEdges)) return true;
    delete assigned[nodeId];
  }
  return false;
}

// 戦闘の目標比率5割から±0〜3個ずらした候補を近い順に試す（割合はご本人
// も「厳密な理由はない」とのことなので、この経路構造では厳密な5割が
// 収まらない場合に備えた幅として扱う）。全滴でも見つからなければnullを
// 返し、呼び出し元（generateDungeon）に経路そのものの作り直しを促す。
function findNodeTypeAssignment(columns, edges) {
  const reverseEdges = buildReverseEdges(edges);
  const middleNodeIds = columns.slice(1, -1).flat();
  const n = middleNodeIds.length;
  const baseBattle = Math.round(n / 2);

  for (const delta of [0, -1, 1, -2, 2, -3, 3]) {
    const battleCount = baseBattle + delta;
    if (battleCount < 0 || battleCount > n) continue;
    const bag = buildTypeBag(n, battleCount);
    const assigned = {};
    if (backtrackAssign(0, middleNodeIds, shuffledCopy(bag), assigned, reverseEdges)) return assigned;
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
