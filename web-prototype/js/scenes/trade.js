import { renderScreen, button, h, resourceHud } from "../dom.js";
import state from "../state.js";

// Empty implementation per spec.
export function TradeScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "TRADE",
    title: "取引",
    corner: resourceHud(state.run?.resources),
    body: h("p", { class: "lead", text: "（未実装：雇用・購入・工房などのやり取りが入ります）" }),
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
      button("倉庫を開く", { onClick: () => api.callScene("warehouse") }),
      button("店を出る", { variant: "primary", onClick: () => api.closeScene() }),
    ],
  });
  return {};
}
