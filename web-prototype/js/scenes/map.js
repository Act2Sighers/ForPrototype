import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { moveRunTo, consumeStartEventTrigger, recordPeddlerTriggered } from "../state.js";
import { EVENT_SCENE_BY_NODE_TYPE, DUNGEON_PARAMS } from "../data/testDungeon.js";
import { peddlerEligibleTarget } from "../data/dungeonGenerator.js";
import { computeEffectiveMaxHp } from "../data/resourceCatalog.js";
import { pickRandomTimeEatsStoreMode } from "./timeEats.js";

// 通常マスを何回踏んだら行商イベントを再度出現させて良いか。
const PEDDLER_COOLDOWN_MOVES = 3;

// HPの現在値が最大値の1/3以下の隊員名一覧（何もいなければ空配列）。
function exhaustedAllyNames() {
  return state.formationSlots
    .filter((c) => {
      const maxHp = computeEffectiveMaxHp(c);
      const hp = c.currentHp ?? maxHp;
      return hp <= maxHp / 3;
    })
    .map((c) => c.name);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// マス種別ごとの色分け（.map-node--*、css/theme.cssの既存stat色トーク
// ンを流用）。start/goalは対象外（既存の中立色のまま）。
const NODE_TYPE_CLASS = {
  battle: "map-node--battle",
  exploration: "map-node--exploration",
  episode: "map-node--episode",
  village: "map-node--village",
  snack: "map-node--snack",
  workshop: "map-node--workshop",
};

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const kid of Array.isArray(children) ? children : [children]) {
    if (kid) el.appendChild(kid);
  }
  return el;
}

export function MapScene(container, params, api) {
  // Set right before callScene("episode", ...) whenever that episode's
  // close needs to chain into a further transition, rather than just
  // resuming the map as-is -- see onResume below.
  let awaitingHiringAfterOpening = false;
  let awaitingResultAfterEnding = false;
  let awaitingEndingAfterBossBattle = false;
  // 休憩/行商の仮想マスを解決した直後にセットする：現在地はそのまま
  // （まだ本来のマスへは実際に到達していない）に、reachableをこの1つ
  // だけへ絞り込む -- プレイヤーが仮想マスをクリックした時点でこれを
  // セットし、戻ってきたら本来のマスがreachableとして現れ、実際にそれを
  // クリックした時点（handleNodeClick）でnullへ戻す。
  let forcedNextNodeId = null;

  // exhaustedNames: イベントから戻った直後、消耗している隊員がいれば
  // 一度だけ見せる注意書き用（渡さなければ何も出さない -- 初回入場時や
  // openNext越しの遷移では呼ばない）。
  function render(exhaustedNames) {
    const dungeon = state.run.dungeon;
    const dungeonParams = DUNGEON_PARAMS[dungeon.id];
    const currentId = state.run.currentNodeId;
    const currentNode = dungeon.nodes[currentId];
    const visited = state.run.visitedNodeIds;
    const realReachable = dungeon.edges[currentId] ?? [];

    // Edges between two consecutively-visited nodes are drawn as "already
    // walked"; everything else is still just a possible route.
    const traveled = new Set();
    for (let i = 0; i < visited.length - 1; i++) {
      traveled.add(`${visited[i]}>${visited[i + 1]}`);
    }

    // 休憩/行商の仮想マス判定。forcedNextNodeIdが立っている間（仮想マス
    // を解決済みで、本来のマスへの到達待ち）は両方ともスキップする。
    let reachable = realReachable;
    let virtualStops = []; // [{kind: "rest" | "peddler", fromId, toId}]
    if (forcedNextNodeId) {
      reachable = [forcedNextNodeId];
    } else if (realReachable.length > 0 && dungeonParams.restClock.includes(currentNode.columnIndex)) {
      // 休憩発生クロックに該当する列：先へ向かう経路の全てが休憩の対象
      // になる（休憩を優先するため、行商の判定はここでスキップする）。
      virtualStops = realReachable.map((toId) => ({ kind: "rest", fromId: currentId, toId }));
      reachable = [];
    } else if (
      state.run.peddlerOccurrenceCount < dungeonParams.peddlerCount &&
      state.run.movesSincePeddler >= PEDDLER_COOLDOWN_MOVES
    ) {
      const target = peddlerEligibleTarget(dungeon, dungeonParams, currentId);
      if (target) {
        virtualStops = [{ kind: "peddler", fromId: currentId, toId: target }];
        reachable = realReachable.filter((id) => id !== target);
      }
    }

    function handleNodeClick(nodeId) {
      forcedNextNodeId = null;
      moveRunTo(nodeId);
      render();
      const node = dungeon.nodes[nodeId];
      if (node.type === "goal") {
        // ゴールマス到達時はまずボス戦（勝利すればreviveIncapacitatedAllies
        // を経てこのマップへcloseSceneで戻ってくる -- battle.jsの通常勝利
        // と同じ流儀）、その後にエピローグへ進む。ボス戦敗北時は
        // battle.js側が直接結果画面（ゲームオーバー）へnavigateToする
        // ので、そちらではこのマップのonResumeは呼ばれない。
        awaitingResultAfterEnding = true;
        awaitingEndingAfterBossBattle = true;
        api.callScene("battle", { mode: "boss" });
        return;
      }
      if (node.type === "episode") {
        api.callScene("episode", { mode: "encounter" });
        return;
      }
      if (node.type === "village" || node.type === "workshop") {
        api.callScene("trade", { mode: node.type });
        return;
      }
      if (node.type === "snack") {
        api.callScene("timeEats", { mode: pickRandomTimeEatsStoreMode() });
        return;
      }
      const sceneId = EVENT_SCENE_BY_NODE_TYPE[node.type];
      if (sceneId) api.callScene(sceneId);
    }

    // 休憩/行商の仮想マスをクリックした時点：現在地はそのまま、
    // forcedNextNodeIdだけをセットしてイベント画面へ進む。戻ってくると
    // （onResumeが素通しでrender()し直すだけで）本来のマスがreachableに
    // なる。
    function handleVirtualStopClick(stop) {
      forcedNextNodeId = stop.toId;
      if (stop.kind === "peddler") {
        recordPeddlerTriggered();
        render();
        api.callScene("peddlerShop", {});
      } else {
        render();
        api.callScene("episode", { mode: "rest" });
      }
    }

    const checkpointLineEls = [];
    const columnX = {};
    for (const node of Object.values(dungeon.nodes)) columnX[node.columnIndex] = node.x;
    for (const c of dungeonParams.restClock) {
      if (columnX[c] === undefined || columnX[c + 1] === undefined) continue;
      const lineX = (columnX[c] + columnX[c + 1]) / 2;
      checkpointLineEls.push(svg("line", { class: "map-checkpoint-line", x1: lineX, y1: 0, x2: lineX, y2: 400 }));
    }

    const edgeEls = [];
    const dotEls = [];
    for (const [fromId, targets] of Object.entries(dungeon.edges)) {
      const from = dungeon.nodes[fromId];
      for (const toId of targets) {
        const to = dungeon.nodes[toId];
        const isTraveled = traveled.has(`${fromId}>${toId}`);
        edgeEls.push(
          svg("line", {
            class: `map-edge${isTraveled ? " is-traveled" : ""}`,
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
          })
        );
        // 経路線分中央の常時表示ドット（経路と同色）。休憩/行商発生時は
        // この位置に仮想マスが重なって描かれる（後段のnodeEls側、ドット
        // より後に描画するので、常に上に乗る）。
        dotEls.push(
          svg("circle", {
            class: `map-edge-dot${isTraveled ? " is-traveled" : ""}`,
            cx: (from.x + to.x) / 2,
            cy: (from.y + to.y) / 2,
            r: 4,
          })
        );
      }
    }

    const nodeEls = Object.values(dungeon.nodes).map((node) => {
      const isCurrent = node.id === currentId;
      const isVisited = visited.includes(node.id) && !isCurrent;
      const isReachable = reachable.includes(node.id);
      const isLocked = !isCurrent && !isVisited && !isReachable;

      const classes = ["map-node"];
      if (NODE_TYPE_CLASS[node.type]) classes.push(NODE_TYPE_CLASS[node.type]);
      if (isCurrent) classes.push("is-current");
      if (isVisited) classes.push("is-visited");
      if (isReachable) classes.push("is-reachable");
      if (isLocked) classes.push("is-locked");

      return svg(
        "g",
        {
          class: classes.join(" "),
          onClick: isReachable ? () => handleNodeClick(node.id) : undefined,
        },
        [
          svg("circle", { cx: node.x, cy: node.y, r: 26 }),
          svg("text", { x: node.x, y: node.y + 44 }, document.createTextNode(node.label)),
        ]
      );
    });

    const virtualStopEls = virtualStops.map((stop) => {
      const from = dungeon.nodes[stop.fromId];
      const to = dungeon.nodes[stop.toId];
      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      const label = stop.kind === "rest" ? "休憩" : "行商";
      const typeClass = stop.kind === "rest" ? "map-node--rest" : "map-node--peddler";
      return svg(
        "g",
        { class: `map-node is-reachable ${typeClass}`, onClick: () => handleVirtualStopClick(stop) },
        [svg("circle", { cx: x, cy: y, r: 26 }), svg("text", { x, y: y + 44 }, document.createTextNode(label))]
      );
    });

    // マップの実横幅はダンジョンの列数（最長到達マス数Xしだい）で伸び縮
    // みする。表示幅をその座標幅に1:1で合わせる（CSSの固定widthではなく
    // ここでpxを直接指定する）ことで、列間隔（dungeonGenerator.jsの
    // COLUMN_SPACING）どおりの余白を保ったまま.map-scrollの横スクロール
    // で見せられる。
    const mapWidth = Math.max(...Object.values(dungeon.nodes).map((n) => n.x)) + 60;
    const mapSvg = svg(
      "svg",
      { class: "map-svg", viewBox: `0 0 ${mapWidth} 400`, style: `width: ${mapWidth}px` },
      [...checkpointLineEls, ...edgeEls, ...dotEls, ...nodeEls, ...virtualStopEls]
    );
    const mapScroll = h("div", { class: "map-scroll" }, [mapSvg]);

    const totalChoices = reachable.length + virtualStops.length;
    const hint =
      currentId === "goal"
        ? "ゴールに到達しました。"
        : totalChoices > 1
        ? "進むルートを選んでください。"
        : "進めるマスをクリックしてください（自動では進みません）。";

    const alertBanner = exhaustedNames?.length
      ? h("p", { class: "map-alert", text: `一部の隊員が消耗しています。（${exhaustedNames.join("、")}）` })
      : null;

    renderScreen(container, {
      eyebrow: "MAP",
      title: dungeon.name,
      subtitle: "イベントマスをたどって、スタートからゴールを目指します。",
      corner: resourceHud(state.run.resources),
      body: [alertBanner, mapScroll, h("p", { class: "map-hint", text: hint })].filter(Boolean),
      onPause: () => api.callScene("pause"),
      actions: [
        // ダミー（常にグレーアウト）: 部隊編成/武器/糖衣/荷物置き場の
        // 各画面がそれぞれ「マップ」「部隊編成」「武器」「糖衣」ダミー
        // ボタンを同じ位置に持つのに揃え、兄弟画面を行き来してもボタン
        // 位置が動かないようにするための1枠（このマップ自身のダミー）。
        button("マップ", { disabled: true }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("武器", { onClick: () => api.callScene("weaponStorage") }),
        button("糖衣", { onClick: () => api.callScene("coatingStorage") }),
        button("荷物", { onClick: () => api.callScene("resourceStorage") }),
      ],
    });

    // 横スクロール位置の自動調整：現在地の列と、次に進む先の列（reachable
    // /virtualStopsの行き先はどちらも必ず同じ1列に属する）のちょうど
    // 中央が画面中央に来るようにする。進む先が無い（ゴール到達時）は
    // 現在地だけを中央に据える。renderScreen直後・.screenがis-active
    // な状態でだけ呼ばれるので、clientWidthはこの時点で正しく取れる。
    const nextTargetIds = reachable.length > 0 ? reachable : virtualStops.map((stop) => stop.toId);
    const nextColumnX = nextTargetIds.length > 0 ? dungeon.nodes[nextTargetIds[0]].x : currentNode.x;
    const centerX = (currentNode.x + nextColumnX) / 2;
    const maxScrollLeft = Math.max(0, mapScroll.scrollWidth - mapScroll.clientWidth);
    mapScroll.scrollLeft = Math.min(maxScrollLeft, Math.max(0, centerX - mapScroll.clientWidth / 2));
  }

  render();

  // First time the player arrives on the start square this run: play
  // the オープニング episode (which grants the starting budget as its
  // own completion effect -- see data/scripts.js's OPENING_SCRIPT),
  // then chain into building the starting squad via 雇用画面 in
  // 初期雇用モード once it closes. Called after render() so the map
  // itself is already mounted underneath (matching how every other
  // event is entered), and synchronously enough that the player never
  // sees the map interactive before it's covered.
  if (consumeStartEventTrigger()) {
    awaitingHiringAfterOpening = true;
    api.callScene("episode", { mode: "opening" });
  }

  return {
    onResume: (result) => {
      // squadFormation/weaponStorage/resourceStorage's own "武器"/
      // "荷物"/"部隊編成" buttons close themselves with this flag set
      // instead of nesting a callScene -- see those files' shared
      // {openNext} convention -- so the three screens can freely swap
      // between each other without growing the scene stack.
      if (result?.openNext) {
        api.callScene(result.openNext);
        return;
      }
      if (awaitingHiringAfterOpening) {
        awaitingHiringAfterOpening = false;
        api.callScene("hiring", { mode: "initial" });
        return;
      }
      if (awaitingEndingAfterBossBattle) {
        awaitingEndingAfterBossBattle = false;
        api.callScene("episode", { mode: "ending" });
        return;
      }
      if (awaitingResultAfterEnding) {
        awaitingResultAfterEnding = false;
        api.navigateTo("result", { mode: "clear" });
        return;
      }
      render(exhaustedAllyNames());
    },
  };
}
