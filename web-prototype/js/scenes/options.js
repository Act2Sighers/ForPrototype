import { renderScreen, button, h } from "../dom.js";

// Intentionally empty per spec — placeholder only.
export function OptionsScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "SETTINGS",
    title: "オプション",
    body: h("p", { class: "lead", text: "（未実装：今後ここに各種設定項目が並びます）" }),
    actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
  });
  return {};
}
