import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { moveRunTo, grantStartReward } from "../state.js";
import { getDungeon, EVENT_SCENE_BY_NODE_TYPE } from "../data/testDungeon.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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
  // Fired once per run, right as the player arrives on the start square.
  let rewardText = grantStartReward();

  function render() {
    const dungeon = getDungeon(state.run.dungeonId);
    const currentId = state.run.currentNodeId;
    const visited = state.run.visitedNodeIds;
    // While the reward banner is up, no node is clickable — the player
    // must acknowledge it first (otherwise it's easy to click straight
    // into the next event and leave the banner stuck on-screen).
    const reachable = rewardText ? [] : dungeon.edges[currentId] ?? [];

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
        api.navigateTo("result", { mode: "clear" });
        return;
      }
      const sceneId = EVENT_SCENE_BY_NODE_TYPE[node.type];
      if (sceneId) api.callScene(sceneId, { fromScene: "map" });
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

    const mapSvg = svg("svg", { class: "map-svg", viewBox: "0 0 640 400" }, [
      ...edgeEls,
      ...nodeEls,
    ]);
    const mapScroll = h("div", { class: "map-scroll" }, [mapSvg]);

    const hint = rewardText
      ? "獲得内容を確認してください（OKを押すと先に進めます）。"
      : currentId === "goal"
      ? "ゴールに到達しました。"
      : reachable.length > 1
      ? "進むルートを選んでください。"
      : "進めるマスをクリックしてください（自動では進みません）。";

    const rewardBanner = rewardText
      ? h("div", { class: "panel reward-banner" }, [
          h("p", { class: "field-label", text: "獲得" }),
          h("p", { class: "lead", text: rewardText }),
          button("OK", {
            variant: "primary",
            onClick: () => {
              rewardText = null;
              render();
            },
          }),
        ])
      : null;

    renderScreen(container, {
      eyebrow: `MAP / ${dungeon.name}`,
      title: "マップ",
      subtitle: "イベントマスをたどって、スタートからゴールを目指します。",
      corner: resourceHud(state.run.resources),
      body: [rewardBanner, mapScroll, h("p", { class: "map-hint", text: hint })].filter(Boolean),
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}
