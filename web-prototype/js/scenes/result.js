import { renderScreen, button, h } from "../dom.js";
import state, { retryRun, endRun, settleRunEnd } from "../state.js";

const MODE_INFO = {
  clear: { label: "クリア", className: "is-clear" },
  gameover: { label: "ゲームオーバー", className: "is-gameover" },
};

export function ResultScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "clear" && mode !== "gameover") {
    throw new Error('result scene requires params.mode of "clear" or "gameover"');
  }
  const info = MODE_INFO[mode];
  const visitedCount = state.run?.visitedNodeIds.length ?? 0;

  // The run ends the moment its result is shown, regardless of which
  // button the player picks next: formation/standby move to retired now
  // (see settleRunEnd's own guard against running twice for this run).
  settleRunEnd(mode);

  renderScreen(container, {
    eyebrow: "RESULT",
    title: "リザルト",
    body: [
      h("p", { class: `result-banner ${info.className}`, text: info.label }),
      h("div", { class: "result-grid" }, [
        h("div", { class: "stat-tile" }, [
          h("p", { class: "stat-tile__label", text: "到達マス数" }),
          h("p", { class: "stat-tile__value", text: String(visitedCount) }),
        ]),
        h("div", { class: "stat-tile" }, [
          h("p", { class: "stat-tile__label", text: "評価" }),
          h("p", { class: "stat-tile__value", text: "（未実装）" }),
        ]),
      ]),
    ],
    actions: [
      button("再挑戦", {
        variant: "primary",
        onClick: () => {
          retryRun();
          api.navigateTo("map");
        },
      }),
      button("挑戦終了", {
        onClick: () => {
          endRun();
          api.navigateTo("dungeonSelect");
        },
      }),
      button("タイトルへ", {
        variant: "ghost",
        onClick: () => {
          endRun();
          api.navigateTo("title");
        },
      }),
    ],
  });

  return {};
}
