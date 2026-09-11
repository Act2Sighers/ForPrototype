import { renderScreen, button, h } from "../dom.js";
import { createNewSaveData } from "../state.js";

export function TitleScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "ROGUELIKE PROTOTYPE",
    title: "DISTOASTED（仮）",
    body: h("p", {
      class: "lead",
      text: "灰と燠に沈んだダンジョンを、サイコロとカードとトークンで渡り歩け。",
    }),
    actions: [
      button("はじめから", {
        variant: "primary",
        onClick: () => {
          createNewSaveData();
          api.navigateTo("dungeonSelect");
        },
      }),
      button("つづきから", {
        onClick: () => api.callScene("saveSlot", { mode: "load" }),
      }),
      button("オプション", {
        variant: "ghost",
        onClick: () => api.callScene("options"),
      }),
      button("ギャラリー", {
        variant: "ghost",
        onClick: () => api.callScene("warehouse", { mode: "view" }),
      }),
    ],
  });

  return {};
}
