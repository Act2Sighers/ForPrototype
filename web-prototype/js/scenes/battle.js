import { renderScreen, button, h } from "../dom.js";

// Empty implementation per spec — this screen is the game's most complex
// eventually, but for now it only needs to prove the transitions work.
export function BattleScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "BATTLE",
    title: "戦闘",
    body: h("p", { class: "lead", text: "（未実装：ここに戦闘の処理が入ります）" }),
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("全滅（テスト用）", {
        variant: "danger",
        onClick: () => api.navigateTo("result", { mode: "gameover" }),
      }),
      button("戦闘を終える", { variant: "primary", onClick: () => api.closeScene() }),
    ],
  });
  return {};
}
