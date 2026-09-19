import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { moveRunTo, consumeStartEventTrigger } from "../state.js";
import { EVENT_SCENE_BY_NODE_TYPE } from "../data/testDungeon.js";
import { OPENING_SCRIPT, ENCOUNTER_SCRIPT, ENDING_SCRIPT } from "../data/scripts.js";
import { computeEffectiveMaxHp } from "../data/resourceCatalog.js";
import { pickRandomTimeEatsStoreMode } from "./timeEats.js";

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

  // exhaustedNames: イベントから戻った直後、消耗している隊員がいれば
  // 一度だけ見せる注意書き用（渡さなければ何も出さない -- 初回入場時や
  // openNext越しの遷移では呼ばない）。
  function render(exhaustedNames) {
    const dungeon = state.run.dungeon;
    const currentId = state.run.currentNodeId;
    const visited = state.run.visitedNodeIds;
    const reachable = dungeon.edges[currentId] ?? [];

    // Edges between two consecutively-visited nodes are drawn as "already
    // walked"; everything else is still just a possible route.
    const traveled = new Set();
    for (let i = 0; i < visited.length - 1; i++) {
      traveled.add(`${visited[i]}>${visited[i + 1]}`);
    }

    function handleNodeClick(nodeId) {
      moveRunTo(nodeId);
      render();
      const node = dungeon.nodes[nodeId];
      if (node.type === "goal") {
        awaitingResultAfterEnding = true;
        api.callScene("episode", { script: ENDING_SCRIPT });
        return;
      }
      if (node.type === "episode") {
        api.callScene("episode", { script: ENCOUNTER_SCRIPT });
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

    const edgeEls = [];
    for (const [fromId, targets] of Object.entries(dungeon.edges)) {
      const from = dungeon.nodes[fromId];
      for (const toId of targets) {
        const to = dungeon.nodes[toId];
        edgeEls.push(
          svg("line", {
            class: `map-edge${traveled.has(`${fromId}>${toId}`) ? " is-traveled" : ""}`,
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
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

    // マップの実横幅はダンジョンの列数（最長到達マス数Xしだい）で伸び縮
    // みする。表示幅をその座標幅に1:1で合わせる（CSSの固定widthではなく
    // ここでpxを直接指定する）ことで、列間隔（dungeonGenerator.jsの
    // COLUMN_SPACING）どおりの余白を保ったまま.map-scrollの横スクロール
    // で見せられる。
    const mapWidth = Math.max(...Object.values(dungeon.nodes).map((n) => n.x)) + 60;
    const mapSvg = svg(
      "svg",
      { class: "map-svg", viewBox: `0 0 ${mapWidth} 400`, style: `width: ${mapWidth}px` },
      [...edgeEls, ...nodeEls]
    );
    const mapScroll = h("div", { class: "map-scroll" }, [mapSvg]);

    const hint =
      currentId === "goal"
        ? "ゴールに到達しました。"
        : reachable.length > 1
        ? "進むルートを選んでください。"
        : "進めるマスをクリックしてください（自動では進みません）。";

    const alertBanner = exhaustedNames?.length
      ? h("p", { class: "map-alert", text: `一部の隊員が消耗しています。（${exhaustedNames.join("、")}）` })
      : null;

    renderScreen(container, {
      eyebrow: `MAP / ${dungeon.name}`,
      title: "マップ",
      subtitle: "イベントマスをたどって、スタートからゴールを目指します。",
      corner: resourceHud(state.run.resources),
      body: [alertBanner, mapScroll, h("p", { class: "map-hint", text: hint })].filter(Boolean),
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("武器", { onClick: () => api.callScene("weaponStorage") }),
        button("糖衣", { onClick: () => api.callScene("coatingStorage") }),
        button("荷物", { onClick: () => api.callScene("resourceStorage") }),
      ],
    });
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
    api.callScene("episode", { script: OPENING_SCRIPT });
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
      if (awaitingResultAfterEnding) {
        awaitingResultAfterEnding = false;
        api.navigateTo("result", { mode: "clear" });
        return;
      }
      render(exhaustedAllyNames());
    },
  };
}
