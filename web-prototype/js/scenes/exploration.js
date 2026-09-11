import { renderScreen, button, h } from "../dom.js";

// Empty implementation per spec.
export function ExplorationScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "EXPLORATION",
    title: "探索",
    body: h("p", { class: "lead", text: "（未実装：ここに簡易インタラクションが入ります）" }),
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("探索を終える", { variant: "primary", onClick: () => api.closeScene() }),
    ],
  });
  return {};
}
