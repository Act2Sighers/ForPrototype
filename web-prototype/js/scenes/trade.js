import { renderScreen, button, h } from "../dom.js";

// Empty implementation per spec.
export function TradeScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "TRADE",
    title: "取引",
    body: h("p", { class: "lead", text: "（未実装：雇用・購入・工房などのやり取りが入ります）" }),
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("倉庫を開く", { onClick: () => api.callScene("warehouse", { mode: "takeout" }) }),
      button("店を出る", { variant: "primary", onClick: () => api.closeScene() }),
    ],
  });
  return {};
}
